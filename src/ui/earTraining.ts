/**
 * 귀 훈련 화면.
 *
 * 흐름: 「▶ 문제 듣기」 → 으뜸 코드(I) 한 번 → 진행이 나온다 → 칸 순서대로 몇 도인지 누른다 →
 * 「확인」 → 맞았는지, 틀렸으면 정답이 뭔지. 틀린 문제는 쌓아 두었다가 「틀린 문제 다시」 로 푼다.
 *
 * 로마숫자 버튼을 누르면 **그 코드 소리가 난다.** 듣고 고르는 훈련인데 버튼이 말이 없으면
 * 「내가 들은 소리가 이게 맞나」 를 확인할 길이 없다. 눌러서 비교해 보는 게 수업에서 말한
 * 귀 훈련의 핵심이다.
 *
 * 문제와 채점은 model/ear.ts (순수 계산). 여기는 소리와 화면만 맡는다.
 */

import {
  LEVELS, degreeNumeral, describeAnswer, grade, levelById, makeQuestion, questionChords,
  type Question,
} from "../model/ear";
import { PROGRESSIONS, chordPitches } from "../model/progression";
import { keyLabel } from "../model/scale";

export type EarDeps = {
  /** 소리를 낼 트랙 (드럼 트랙은 피해서 고른다). */
  trackIndex: () => number;
  hold: (pitch: number, track: number) => void;
  release: (pitch: number) => void;
  isUnlocked: () => boolean;
  onStatus: (message: string, kind?: "info" | "error") => void;
};

const STORE_KEY = "pianoroll.ear";
/** 코드 하나 길이(ms)와 으뜸 코드 뒤의 쉼. 천천히 — 처음 듣는 사람이 따라갈 수 있게. */
const CHORD_MS = 1150;
const TONIC_MS = 1300;
const GAP_AFTER_TONIC = 450;
const HOLD_FRACTION = 0.92;

type Tally = { right: number; total: number };

export class EarTraining {
  private modal = el<HTMLDivElement>("ear-modal");
  private levelSel = el<HTMLSelectElement>("ear-level");
  private randKey = el<HTMLInputElement>("ear-randkey");
  private guide = el<HTMLElement>("ear-guide");
  private slotsEl = el<HTMLDivElement>("ear-slots");
  private choicesEl = el<HTMLDivElement>("ear-choices");
  private resultEl = el<HTMLDivElement>("ear-result");
  private scoreEl = el<HTMLElement>("ear-score");
  private newBtn = el<HTMLButtonElement>("ear-new");
  private againBtn = el<HTMLButtonElement>("ear-again");
  private tonicBtn = el<HTMLButtonElement>("ear-tonic");
  private backBtn = el<HTMLButtonElement>("ear-back");
  private submitBtn = el<HTMLButtonElement>("ear-submit");
  private revealBtn = el<HTMLButtonElement>("ear-reveal");
  private reviewBtn = el<HTMLButtonElement>("ear-review");

  /** 지금 문제. 아직 안 냈으면 null. */
  question: Question | null = null;
  private picked: number[] = [];
  private pickedName: string | null = null;
  private answered = false;
  private wrong: Question[] = [];
  private session: Tally = { right: 0, total: 0 };
  private timers: number[] = [];
  private sounding = new Set<number>();
  private lastQuestion?: Question;

  constructor(private deps: EarDeps) {
    for (const l of LEVELS) {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.label;
      this.levelSel.appendChild(o);
    }
    const saved = this.readStore();
    if (saved.level && levelById(saved.level)) this.levelSel.value = saved.level;

    el<HTMLButtonElement>("ear").addEventListener("click", () => this.open());
    el<HTMLButtonElement>("ear-close").addEventListener("click", () => this.close());
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.close();
    });
    this.levelSel.addEventListener("change", () => {
      this.writeLevel();
      this.reset();
    });
    this.newBtn.addEventListener("click", () => this.next());
    this.againBtn.addEventListener("click", () => this.replay());
    this.tonicBtn.addEventListener("click", () => this.playTonic());
    this.backBtn.addEventListener("click", () => this.back());
    this.submitBtn.addEventListener("click", () => this.submit());
    this.revealBtn.addEventListener("click", () => this.replay());
    this.reviewBtn.addEventListener("click", () => this.review());
    this.reset();
  }

  open(): void {
    this.modal.classList.remove("hidden");
    this.renderScore();
  }

  close(): void {
    this.modal.classList.add("hidden");
    this.silence();
  }

  get isOpen(): boolean {
    return !this.modal.classList.contains("hidden");
  }

  // ------------------------------------------------------------ 흐름

  private get level() {
    return levelById(this.levelSel.value) ?? LEVELS[0];
  }

  /** 단계를 바꾸면 하던 문제는 접는다 (다른 단계의 칸 수로 이어 갈 수 없다). */
  private reset(): void {
    this.silence();
    this.question = null;
    this.picked = [];
    this.pickedName = null;
    this.answered = false;
    this.lastQuestion = undefined;
    this.session = { right: 0, total: 0 };
    this.resultEl.className = "ear-result";
    this.resultEl.textContent = "「▶ 문제 듣기」 를 누르세요";
    this.guide.textContent =
      this.level.kind === "named"
        ? "진행을 듣고 어떤 정석 진행인지 고르세요. 으뜸 코드(I)를 먼저 들려주고 진행이 나옵니다."
        : "으뜸 코드(I)를 먼저 들려주고 진행이 나옵니다. 코드가 나온 순서대로 몇 도인지 누르세요. 버튼을 누르면 그 코드 소리가 나니 비교해 보세요.";
    this.render();
  }

  private next(): void {
    const q = makeQuestion(this.level.id, Math.random, this.randKey.checked, this.lastQuestion);
    this.startQuestion(q);
  }

  private startQuestion(q: Question): void {
    this.question = q;
    this.lastQuestion = q;
    this.picked = [];
    this.pickedName = null;
    this.answered = false;
    this.resultEl.className = "ear-result";
    this.resultEl.textContent = q.progression ? "듣고 고르세요" : "듣고 순서대로 눌러 보세요";
    this.render();
    this.replay();
  }

  private submit(): void {
    const q = this.question;
    if (!q || this.answered) return;
    const answer = q.progression ? this.pickedName : this.picked;
    if (answer === null || (Array.isArray(answer) && answer.length !== q.degrees.length)) return;
    const g = grade(q, answer);
    this.answered = true;
    this.session.total += 1;
    if (g.correct) this.session.right += 1;
    this.tally(q.level, g.correct);

    const where = `${keyLabel(q.key)}`;
    const truth = describeAnswer(q);
    if (g.correct) {
      this.resultEl.className = "ear-result right";
      this.resultEl.textContent = `정답! ${q.progression ? progLabel(q.progression) + " — " : ""}${truth} (${where})`;
    } else {
      this.resultEl.className = "ear-result wrong";
      const mine = q.progression
        ? `내 답: ${progLabel(this.pickedName ?? "")}`
        : `내 답: ${this.picked.map((d) => degreeNumeral(this.level.mode, d)).join(" ")}`;
      this.resultEl.textContent = `아쉬워요. 정답: ${q.progression ? progLabel(q.progression) + " — " : ""}${truth} (${where}) · ${mine}`;
      this.wrong.push(q);
    }
    this.renderSlots(g.marks);
    this.render(g.marks);
    this.renderScore();
    // 정답을 바로 한 번 들려준다. 틀렸을 때 「아, 이 소리구나」 가 제일 잘 남는다.
    this.replay();
  }

  private review(): void {
    const q = this.wrong.shift();
    if (!q) return;
    if (this.level.id !== q.level) {
      this.levelSel.value = q.level;
      this.writeLevel();
    }
    this.startQuestion(q);
  }

  private back(): void {
    if (this.answered || !this.question) return;
    if (this.question.progression) this.pickedName = null;
    else this.picked.pop();
    this.render();
  }

  private choose(degree: number): void {
    const q = this.question;
    // 문제가 없어도 눌러 보면 소리는 난다 (코드 소리 익히기). 칸에는 아무것도 안 들어간다.
    const mode = this.level.mode;
    const key = q?.key ?? { tonic: mode === "major" ? 0 : 9, mode };
    this.playChordNow(chordPitches(key, { degree }));
    if (!q || this.answered || q.progression) return;
    if (this.picked.length >= q.degrees.length) return;
    this.picked.push(degree);
    this.render();
  }

  private chooseName(id: string): void {
    const q = this.question;
    if (!q || this.answered) return;
    this.pickedName = id;
    this.render();
  }

  // ------------------------------------------------------------ 소리

  private silence(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const p of this.sounding) this.deps.release(p);
    this.sounding.clear();
  }

  private at(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  /** 코드 하나를 ms 동안. 베이스(근음 한 옥타브 아래)를 얹어 코드 사이 이동이 또렷하게 들린다. */
  private chordAt(startMs: number, pitches: number[], lenMs: number): void {
    const track = this.deps.trackIndex();
    const all = [pitches[0] - 12, ...pitches];
    this.at(startMs, () => {
      for (const p of all) {
        this.deps.hold(p, track);
        this.sounding.add(p);
      }
    });
    this.at(startMs + lenMs * HOLD_FRACTION, () => {
      for (const p of all) {
        this.deps.release(p);
        this.sounding.delete(p);
      }
    });
  }

  private playChordNow(pitches: number[]): void {
    if (!this.deps.isUnlocked()) {
      this.deps.onStatus("화면을 한 번 탭해서 소리를 켜 주세요", "error");
      return;
    }
    this.silence();
    this.chordAt(0, pitches, 800);
  }

  private playTonic(): void {
    const q = this.question;
    if (!q) return;
    if (!this.deps.isUnlocked()) {
      this.deps.onStatus("화면을 한 번 탭해서 소리를 켜 주세요", "error");
      return;
    }
    this.silence();
    this.chordAt(0, questionChords(q).tonic, TONIC_MS);
  }

  /** 으뜸 코드 → 쉼 → 진행. */
  private replay(): void {
    const q = this.question;
    if (!q) return;
    if (!this.deps.isUnlocked()) {
      this.deps.onStatus("화면을 한 번 탭해서 소리를 켜 주세요", "error");
      return;
    }
    this.silence();
    const { tonic, chords } = questionChords(q);
    this.chordAt(0, tonic, TONIC_MS);
    let t = TONIC_MS + GAP_AFTER_TONIC;
    for (const c of chords) {
      this.chordAt(t, c, CHORD_MS);
      t += CHORD_MS;
    }
  }

  // ------------------------------------------------------------ 화면

  private render(marks?: boolean[]): void {
    const q = this.question;
    const lvl = this.level;
    this.renderSlots(marks);

    // 고르기 버튼
    this.choicesEl.textContent = "";
    if (lvl.kind === "degrees") {
      for (const d of lvl.pool) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = degreeNumeral(lvl.mode, d);
        b.addEventListener("click", () => this.choose(d));
        this.choicesEl.appendChild(b);
      }
    } else if (q?.options) {
      for (const id of q.options) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "named";
        b.textContent = progLabel(id);
        b.disabled = this.answered;
        if (this.pickedName === id) b.classList.add("on");
        b.addEventListener("click", () => this.chooseName(id));
        this.choicesEl.appendChild(b);
      }
    }

    const full = q
      ? q.progression
        ? this.pickedName !== null
        : this.picked.length === q.degrees.length
      : false;
    const has = q !== null;
    this.againBtn.disabled = !has;
    this.tonicBtn.disabled = !has;
    this.revealBtn.disabled = !(has && this.answered);
    this.backBtn.disabled = !has || this.answered || (q.progression ? this.pickedName === null : this.picked.length === 0);
    this.submitBtn.disabled = !has || this.answered || !full;
    this.reviewBtn.disabled = this.wrong.length === 0;
    this.reviewBtn.textContent = `틀린 문제 다시${this.wrong.length ? ` (${this.wrong.length})` : ""}`;
    this.newBtn.textContent = has && !this.answered ? "⏭ 새 문제" : "▶ 문제 듣기";
    if (!has) this.newBtn.textContent = "▶ 문제 듣기";
  }

  private renderSlots(marks?: boolean[]): void {
    const q = this.question;
    const lvl = this.level;
    this.slotsEl.textContent = "";
    if (!q) return;
    if (q.progression) {
      const s = document.createElement("div");
      s.className = "ear-slot";
      s.style.minWidth = "220px";
      if (this.pickedName) {
        s.classList.add("filled");
        s.textContent = progLabel(this.pickedName);
      } else s.textContent = "?";
      if (marks) s.classList.add(marks[0] ? "right" : "wrong");
      this.slotsEl.appendChild(s);
      return;
    }
    q.degrees.forEach((_, i) => {
      const s = document.createElement("div");
      s.className = "ear-slot";
      const d = this.picked[i];
      if (d !== undefined) {
        s.classList.add("filled");
        s.textContent = degreeNumeral(lvl.mode, d);
      } else s.textContent = String(i + 1);
      if (marks) {
        s.classList.add(marks[i] ? "right" : "wrong");
        if (!marks[i]) {
          const small = document.createElement("small");
          small.textContent = `정답 ${degreeNumeral(lvl.mode, q.degrees[i])}`;
          s.appendChild(small);
        }
      }
      this.slotsEl.appendChild(s);
    });
  }

  private renderScore(): void {
    const all = this.readStore().tally?.[this.level.id];
    const now = `이번 ${this.session.right}/${this.session.total}`;
    const total = all && all.total > 0 ? ` · 지금까지 ${all.right}/${all.total}` : "";
    this.scoreEl.textContent = now + total;
  }

  // ------------------------------------------------------------ 기록 (이 브라우저에만)

  private readStore(): { level?: string; tally?: Record<string, Tally> } {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const v = raw ? JSON.parse(raw) : null;
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }

  private writeStore(v: { level?: string; tally?: Record<string, Tally> }): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(v));
    } catch {
      /* 저장이 막혀 있어도 연습은 된다 */
    }
  }

  private writeLevel(): void {
    this.writeStore({ ...this.readStore(), level: this.levelSel.value });
  }

  private tally(level: string, correct: boolean): void {
    const s = this.readStore();
    const t = { ...(s.tally?.[level] ?? { right: 0, total: 0 }) };
    t.total += 1;
    if (correct) t.right += 1;
    this.writeStore({ ...s, tally: { ...(s.tally ?? {}), [level]: t } });
  }
}

function progLabel(id: string): string {
  return PROGRESSIONS.find((p) => p.id === id)?.label ?? id;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} 를 찾을 수 없습니다`);
  return e as T;
}
