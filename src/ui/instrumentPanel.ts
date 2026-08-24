/**
 * 사운드폰트 넣기 · 프리셋 고르기 · 트랙 목록.
 *
 * 프리셋 검색을 넣은 이유는 GM 사운드폰트 하나에 프리셋이 128개(뱅크까지 치면
 * 수백 개) 들어 있어서다. 목록을 끝까지 넘겨 색소폰을 찾는 건 폰에서 못 할
 * 짓이다. "sax" 를 치면 네 개로 줄어든다.
 *
 * 악기 교체는 **두 번 탭**으로 끝나야 한다 (M2 완료 기준).
 *   ① 툴바의 악기 이름을 탭 → 목록이 뜬다
 *   ② 원하는 악기를 탭 → 바로 그 소리로 바뀐다
 * 노트는 건드리지 않는다. 트랙의 presetId 만 바뀐다.
 */

import type { Project } from "../model/types";
import { emptyTrack } from "../model/project";
import { MAX_TRACKS, channelForTrack } from "../model/channels";
import type { InstrumentRegistry } from "../audio/registry";
import type { Preset } from "../audio/soundfont";

export type PanelCallbacks = {
  onTrackChange: (index: number) => void;
  onSourceChange: () => void;
  onStatus: (message: string, kind?: "info" | "error") => void;
};

export class InstrumentPanel {
  private searchInput: HTMLInputElement;
  private listEl: HTMLDivElement;
  private modal: HTMLDivElement;
  private trackStrip: HTMLDivElement;
  private instrumentBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private query = "";

  activeTrack = 0;

  constructor(
    private project: Project,
    private registry: InstrumentRegistry,
    private cb: PanelCallbacks,
  ) {
    this.modal = document.getElementById("preset-modal") as HTMLDivElement;
    this.searchInput = document.getElementById("preset-search") as HTMLInputElement;
    this.listEl = document.getElementById("preset-list") as HTMLDivElement;
    this.trackStrip = document.getElementById("tracks") as HTMLDivElement;
    this.instrumentBtn = document.getElementById("instrument") as HTMLButtonElement;
    this.fileInput = document.getElementById("sf-file") as HTMLInputElement;

    this.instrumentBtn.addEventListener("click", () => this.openPicker());
    (document.getElementById("preset-close") as HTMLButtonElement).addEventListener("click", () =>
      this.closePicker(),
    );
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.closePicker();
    });
    this.searchInput.addEventListener("input", () => {
      this.query = this.searchInput.value.trim().toLowerCase();
      this.renderList();
    });

    (document.getElementById("load-sf") as HTMLButtonElement).addEventListener("click", () =>
      this.fileInput.click(),
    );
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      if (file) void this.loadFile(file);
      this.fileInput.value = "";
    });

    // 드래그해서 떨어뜨리기 (PC)
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) void this.loadFile(file);
    });

    this.renderTracks();
    this.renderInstrumentButton();
  }

  /** 프로젝트가 통째로 바뀌었을 때 (파일 열기) 화면을 다시 맞춘다. */
  refresh(): void {
    this.resnapTracks();
    this.renderTracks();
    this.renderInstrumentButton();
  }

  // ------------------------------------------------------------ 사운드폰트

  async loadFile(file: File): Promise<void> {
    if (!/\.(sf2|sf3|dls)$/i.test(file.name)) {
      this.cb.onStatus(`${file.name} 은(는) 사운드폰트 파일이 아닙니다 (.sf2 / .sf3)`, "error");
      return;
    }
    const mb = (file.size / 1024 / 1024).toFixed(0);
    this.cb.onStatus(`${file.name} 읽는 중… (${mb}MB)`);
    try {
      await this.registry.soundfont.load(file);
      this.resnapTracks();
      this.cb.onSourceChange();
      this.renderTracks();
      this.renderInstrumentButton();
      this.cb.onStatus(
        `${this.registry.soundfont.name} — 악기 ${this.registry.soundfont.presetList.length}개`,
      );
    } catch (err) {
      this.cb.onStatus(
        `사운드폰트를 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  }

  // ------------------------------------------------------------ 프리셋 고르기

  private openPicker(): void {
    this.modal.classList.remove("hidden");
    this.renderList();
    // 폰에서 자동 포커스는 키보드를 띄워 목록을 가린다. 사용자가 검색칸을
    // 직접 눌렀을 때만 키보드가 뜨게 둔다.
    if (!matchMedia("(pointer: coarse)").matches) this.searchInput.focus();
  }

  private closePicker(): void {
    this.modal.classList.add("hidden");
  }

  private renderList(): void {
    const presets = this.registry.soundfont.presetList;
    this.listEl.textContent = "";

    if (presets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML =
        "아직 음원이 없습니다.<br><b>📂 음원</b> 을 눌러 <code>.sf2</code> 파일을 넣으세요." +
        "<br><small>General MIDI 사운드폰트 하나면 색소폰까지 128개 악기가 들어 있습니다." +
        " 지금은 임시 신스 소리로 납니다.</small>";
      this.listEl.appendChild(empty);
      return;
    }

    const q = this.query;
    const matched = q ? presets.filter((p) => p.name.toLowerCase().includes(q)) : presets;

    if (matched.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = `"${this.searchInput.value}" 에 맞는 악기가 없습니다`;
      this.listEl.appendChild(empty);
      return;
    }

    const current = this.currentPresetId();
    // 목록이 수백 줄이라 한 번에 다 그리면 폰에서 버벅인다. 검색 없이 열면
    // 앞쪽만 보여 주고 나머지는 검색으로 찾게 한다.
    const shown = matched.slice(0, 300);
    for (const preset of shown) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "preset" + (preset.id === current ? " current" : "");
      row.innerHTML =
        `<span class="pname"></span><span class="pnum">${preset.bankMSB}:${preset.program}</span>`;
      (row.querySelector(".pname") as HTMLSpanElement).textContent = preset.name;
      row.addEventListener("click", () => this.choose(preset));
      this.listEl.appendChild(row);
    }
    if (matched.length > shown.length) {
      const more = document.createElement("div");
      more.className = "empty";
      more.textContent = `…외 ${matched.length - shown.length}개. 검색해서 좁혀 보세요.`;
      this.listEl.appendChild(more);
    }
  }

  /** 악기 교체. **노트는 손대지 않는다.** */
  private choose(preset: Preset): void {
    const track = this.project.tracks[this.activeTrack];
    if (!track) return;
    track.source = { kind: "sf2", presetId: preset.id };
    track.name = preset.name;
    this.registry.prepare(track, channelForTrack(this.activeTrack));
    this.cb.onSourceChange();
    this.renderTracks();
    this.renderInstrumentButton();
    this.closePicker();
    this.cb.onStatus(`${this.activeTrack + 1}번 트랙 → ${preset.name}`);
  }

  /**
   * 새 사운드폰트에 맞춰 트랙의 악기를 다시 붙인다.
   *
   * 두 가지를 고친다.
   *   · 트랙이 **없는 악기**를 가리키고 있으면 첫 악기로 내린다. 사운드폰트를
   *     바꾸면 프리셋 번호는 그대로인데 가리키는 악기가 사라질 수 있다.
   *   · 트랙 이름을 악기 이름으로 맞춘다. 예전에는 첫 악기의 id 가 마침 0 이면
   *     "이미 0 이니 바꿀 것 없다" 로 빠져서 트랙이 계속 "트랙 1" 로 남았다.
   *     화면에 무슨 악기가 걸렸는지 안 나오는 게 이 버그였다.
   */
  private resnapTracks(): void {
    const sf = this.registry.soundfont;
    const fallback = sf.defaultPreset;
    if (!fallback) return;

    this.project.tracks.forEach((track, i) => {
      if (track.source.kind !== "sf2") return;
      const preset = sf.findPreset(track.source.presetId) ?? fallback;
      track.source = { kind: "sf2", presetId: preset.id };
      track.name = preset.name;
      this.registry.prepare(track, channelForTrack(i));
    });
  }

  private currentPresetId(): number | null {
    const source = this.project.tracks[this.activeTrack]?.source;
    return source && source.kind === "sf2" ? source.presetId : null;
  }

  // ------------------------------------------------------------ 트랙 목록

  private renderInstrumentButton(): void {
    const track = this.project.tracks[this.activeTrack];
    const label = this.registry.usingSoundFont ? (track?.name ?? "악기") : "임시 신스";
    this.instrumentBtn.textContent = `🎹 ${label}`;
  }

  renderTracks(): void {
    this.trackStrip.textContent = "";
    this.project.tracks.forEach((track, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (i === this.activeTrack ? " on" : "");
      chip.textContent = `${i + 1} ${track.name}`;
      chip.addEventListener("click", () => this.selectTrack(i));
      this.trackStrip.appendChild(chip);
    });

    if (this.project.tracks.length < MAX_TRACKS) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "chip add";
      add.textContent = "＋";
      add.title = "트랙 추가";
      add.addEventListener("click", () => this.addTrack());
      this.trackStrip.appendChild(add);
    }
  }

  private selectTrack(index: number): void {
    this.activeTrack = index;
    this.renderTracks();
    this.renderInstrumentButton();
    this.cb.onTrackChange(index);
  }

  private addTrack(): void {
    if (this.project.tracks.length >= MAX_TRACKS) {
      // 15개인 이유는 model/channels.ts 참고 (MIDI 채널 9번은 드럼 자리라 비운다).
      this.cb.onStatus(`트랙은 ${MAX_TRACKS}개까지입니다`, "error");
      return;
    }
    const index = this.project.tracks.length;
    const track = emptyTrack(`트랙 ${index + 1}`);
    const preset = this.registry.soundfont.presetList[0];
    if (preset) {
      track.source = { kind: "sf2", presetId: preset.id };
      track.name = preset.name;
    }
    this.project.tracks.push(track);
    this.registry.prepare(track, channelForTrack(index));
    this.selectTrack(index);
  }
}
