/**
 * 변박 · 템포 변화 화면.
 *
 * 곡 **처음**의 박자와 빠르기는 위쪽 칸(박자·BPM)에서 바꾸고, 여기서는 **곡 중간에** 바뀌는
 * 것만 다룬다. 계산은 전부 model/timeline.ts 가 하고 이 화면은 목록을 보여 주고 고칠 뿐이다.
 *
 * 노트는 절대 움직이지 않는다. 노트의 자리는 박이고, 박자표와 템포는 그 박을 마디로 묶는 법과
 * 몇 초로 읽는 법만 바꾼다 (다른 DAW 도 그렇다).
 *
 * 입력은 사람이 읽는 번호로 받는다 (마디 · 박은 1부터). 저장은 마디 0부터, 박은 곡 처음부터의 박이다.
 */

import type { MeterChange, Project, TempoChange } from "../model/types";
import {
  barAt, barLength, barStartBeat, bpmAt, dropRedundantMeters, meterChangeList, sigLabel, tempoChangeList, type Sig,
} from "../model/timeline";

export type TimelineDeps = {
  getProject: () => Project;
  /** 재생 헤드의 박. 입력칸의 기본값을 「지금 있는 곳」 으로 채우는 데 쓴다. */
  playheadBeat: () => number;
  begin: () => void;
  commit: () => void;
  /** 바꾼 뒤 화면·재생을 다시 맞춘다. */
  onChange: () => void;
  onStatus: (message: string, kind?: "info" | "error") => void;
};

export const MAX_METER_CHANGES = 64;
export const MAX_TEMPO_CHANGES = 512;

export class TimelinePanel {
  private modal = el<HTMLDivElement>("tm-modal");
  private metersEl = el<HTMLDivElement>("tm-meters");
  private temposEl = el<HTMLDivElement>("tm-tempos");
  private msg = el<HTMLElement>("tm-msg");
  private mBar = el<HTMLInputElement>("tm-m-bar");
  private mSig = el<HTMLSelectElement>("tm-m-sig");
  private tBar = el<HTMLInputElement>("tm-t-bar");
  private tBeat = el<HTMLInputElement>("tm-t-beat");
  private tBpm = el<HTMLInputElement>("tm-t-bpm");

  constructor(private deps: TimelineDeps) {
    el<HTMLButtonElement>("tm").addEventListener("click", () => this.open());
    el<HTMLButtonElement>("tm-close").addEventListener("click", () => this.close());
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.close();
    });
    el<HTMLButtonElement>("tm-m-add").addEventListener("click", () => this.addMeter());
    el<HTMLButtonElement>("tm-t-add").addEventListener("click", () => this.addTempo());
  }

  get isOpen(): boolean {
    return !this.modal.classList.contains("hidden");
  }

  open(): void {
    this.fillDefaults();
    this.render();
    this.say("");
    this.modal.classList.remove("hidden");
  }

  close(): void {
    this.modal.classList.add("hidden");
  }

  /** 프로젝트가 통째로 바뀌었을 때(파일 열기 · 되돌리기). 열려 있으면 목록을 다시 그린다. */
  refresh(): void {
    if (this.isOpen) this.render();
  }

  // ------------------------------------------------------------ 입력칸 기본값

  /** 재생 헤드가 있는 곳을 기본값으로 — 「지금 여기서부터 바꾸기」 가 제일 흔한 쓰임이다. */
  private fillDefaults(): void {
    const p = this.deps.getProject();
    const at = barAt(p, this.deps.playheadBeat());
    // 박자는 1마디(곡 처음)에서는 못 바꾼다. 헤드가 첫 마디면 다음 마디를 권한다.
    this.mBar.value = String(Math.max(2, at.index + 1));
    this.mBar.max = String(p.bars);
    this.mSig.value = sigLabel(at.sig);
    this.tBar.value = String(at.index + 1);
    this.tBar.max = String(p.bars);
    this.tBeat.value = String(Math.floor(Math.max(0, this.deps.playheadBeat() - at.start) + 1e-6) + 1);
    this.tBpm.value = String(Math.round(bpmAt(p, this.deps.playheadBeat())));
  }

  // ------------------------------------------------------------ 목록

  private render(): void {
    const p = this.deps.getProject();

    this.metersEl.textContent = "";
    this.metersEl.appendChild(
      this.row(`1마디부터  ${sigLabel(p.timeSig)}`, "곡 처음 — 위쪽 박자 칸", null, "first"),
    );
    for (const m of meterChangeList(p)) {
      const unused = m.bar >= p.bars;
      this.metersEl.appendChild(
        this.row(
          `${m.bar + 1}마디부터  ${sigLabel(m.sig)}`,
          unused ? "곡 끝(마디 수) 뒤라 쓰이지 않습니다" : `한 마디 ${Number(barLength(p, m.bar).toFixed(2))}박`,
          () => this.removeMeter(m.bar),
          unused ? "unused" : "",
        ),
      );
    }

    this.temposEl.textContent = "";
    this.temposEl.appendChild(this.row(`처음  ♩ = ${p.bpm}`, "곡 처음 — 위쪽 BPM 칸", null, "first"));
    const end = barStartBeat(p, p.bars);
    for (const t of tempoChangeList(p)) {
      const at = barAt(p, t.beat);
      const inBar = Number((t.beat - at.start + 1).toFixed(2));
      const unused = t.beat >= end - 1e-9;
      this.temposEl.appendChild(
        this.row(
          `${at.index + 1}마디 ${inBar}박  ♩ = ${t.bpm}`,
          unused ? "곡 끝 뒤라 쓰이지 않습니다" : "",
          () => this.removeTempo(t.beat),
          unused ? "unused" : "",
        ),
      );
    }
  }

  private row(title: string, sub: string, onRemove: (() => void) | null, cls: string): HTMLElement {
    const r = document.createElement("div");
    r.className = `tm-row ${cls}`.trim();
    const t = document.createElement("b");
    t.textContent = title;
    const s = document.createElement("small");
    s.className = "grow";
    s.textContent = sub;
    r.append(t, s);
    if (onRemove) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "🗑";
      b.title = "이 변화 지우기";
      b.addEventListener("click", onRemove);
      r.appendChild(b);
    }
    return r;
  }

  private say(text: string, kind: "info" | "error" = "info"): void {
    this.msg.textContent = text;
    this.msg.classList.toggle("error", kind === "error");
  }

  // ------------------------------------------------------------ 고치기

  private addMeter(): void {
    const p = this.deps.getProject();
    const n = Number(this.mBar.value);
    if (!Number.isInteger(n) || n < 2 || n > p.bars) {
      this.say(`마디는 2 ~ ${p.bars} 사이의 정수로 넣어 주세요 (1마디는 곡 처음 박자입니다)`, "error");
      return;
    }
    const sig = parseSig(this.mSig.value);
    if (!sig) return;
    const bar = n - 1;
    if (meterChangeList(p).length >= MAX_METER_CHANGES && !meterChangeList(p).some((m) => m.bar === bar)) {
      this.say(`박자 바꾸기는 ${MAX_METER_CHANGES}개까지입니다`, "error");
      return;
    }

    this.deps.begin();
    const list: MeterChange[] = meterChangeList(p).filter((m) => m.bar !== bar);
    list.push({ bar, sig });
    list.sort((a, b) => a.bar - b.bar);
    // 앞 박자와 같으면 바뀐 게 아니다 — 목록에 쌓지 않는다.
    p.meterChanges = dropRedundantMeters(p.timeSig, list);
    if (p.meterChanges.length === 0) delete p.meterChanges;
    this.deps.commit();
    this.deps.onChange();
    this.render();
    this.say(`${n}마디부터 ${sigLabel(sig)}`);
    this.deps.onStatus(`${n}마디부터 ${sigLabel(sig)} 박자 — 노트는 그대로, 마디선만 다시 그었습니다`);
  }

  private removeMeter(bar: number): void {
    const p = this.deps.getProject();
    this.deps.begin();
    const list = meterChangeList(p).filter((m) => m.bar !== bar);
    p.meterChanges = dropRedundantMeters(p.timeSig, list);
    if (p.meterChanges.length === 0) delete p.meterChanges;
    this.deps.commit();
    this.deps.onChange();
    this.render();
    this.say(`${bar + 1}마디의 박자 바꾸기를 지웠습니다`);
  }

  private addTempo(): void {
    const p = this.deps.getProject();
    const barN = Number(this.tBar.value);
    const beatN = Number(this.tBeat.value);
    const bpm = Number(this.tBpm.value);
    if (!Number.isInteger(barN) || barN < 1 || barN > p.bars) {
      this.say(`마디는 1 ~ ${p.bars} 사이의 정수로 넣어 주세요`, "error");
      return;
    }
    const bar = barN - 1;
    const len = barLength(p, bar);
    if (!Number.isInteger(beatN) || beatN < 1 || beatN > Math.ceil(len - 1e-9)) {
      this.say(`${barN}마디는 ${Math.ceil(len - 1e-9)}박까지 있습니다`, "error");
      return;
    }
    if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) {
      this.say("BPM 은 20 ~ 300 사이로 넣어 주세요", "error");
      return;
    }
    const beat = barStartBeat(p, bar) + (beatN - 1);
    if (beat <= 1e-9) {
      this.say("곡 맨 처음(1마디 1박)의 빠르기는 위쪽 BPM 칸에서 바꾸세요", "error");
      return;
    }
    const existing = tempoChangeList(p);
    if (existing.length >= MAX_TEMPO_CHANGES && !existing.some((t) => Math.abs(t.beat - beat) < 1e-9)) {
      this.say(`템포 바꾸기는 ${MAX_TEMPO_CHANGES}개까지입니다`, "error");
      return;
    }

    this.deps.begin();
    const list: TempoChange[] = existing.filter((t) => Math.abs(t.beat - beat) > 1e-9);
    list.push({ beat, bpm: Math.round(bpm * 10) / 10 });
    list.sort((a, b) => a.beat - b.beat);
    p.tempoChanges = list;
    this.deps.commit();
    this.deps.onChange();
    this.render();
    this.say(`${barN}마디 ${beatN}박부터 ♩ = ${bpm}`);
    this.deps.onStatus(`${barN}마디 ${beatN}박부터 ♩ = ${bpm}`);
  }

  private removeTempo(beat: number): void {
    const p = this.deps.getProject();
    this.deps.begin();
    const list = tempoChangeList(p).filter((t) => Math.abs(t.beat - beat) > 1e-9);
    if (list.length > 0) p.tempoChanges = list;
    else delete p.tempoChanges;
    this.deps.commit();
    this.deps.onChange();
    this.render();
    this.say("템포 바꾸기를 지웠습니다");
  }
}

function parseSig(v: string): Sig | null {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const d = Number(m[2]);
  return n > 0 && d > 0 ? [n, d] : null;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} 를 찾을 수 없습니다`);
  return e as T;
}
