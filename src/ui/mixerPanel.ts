/**
 * 믹서 — 트랙별 음량·팬·뮤트·솔로·리버브.
 *
 * 폰에서 쓰는 화면이라 손가락으로 잡을 수 있는 크기를 우선했다. 노브 대신
 * 가로 슬라이더를 쓴 것도 그래서다 — 노브는 원을 그리며 끌어야 해서 작은
 * 화면에서 정확도가 떨어진다.
 *
 * 값을 숫자로 같이 적는다. 슬라이더만 있으면 "지금 얼마인지" 를 알 수 없어
 * 원래대로 되돌리질 못한다.
 */

import type { Project } from "../model/types";
import type { MixerState } from "../audio/mixerState";

export type MixerCallbacks = {
  /** 슬라이더를 잡는 순간 (되돌리기용 스냅숏). */
  onBeforeChange: () => void;
  onAfterChange: () => void;
  /** 값이 바뀌었다 — 믹서에 반영해 달라. */
  onChange: () => void;
  onStatus: (message: string) => void;
};

export class MixerPanel {
  private modal: HTMLDivElement;
  private list: HTMLDivElement;

  constructor(
    private getProject: () => Project,
    private state: MixerState,
    private cb: MixerCallbacks,
  ) {
    this.modal = document.getElementById("mixer-modal") as HTMLDivElement;
    this.list = document.getElementById("mixer-list") as HTMLDivElement;

    (document.getElementById("mixer") as HTMLButtonElement).addEventListener("click", () => {
      this.render();
      this.modal.classList.remove("hidden");
    });
    (document.getElementById("mixer-close") as HTMLButtonElement).addEventListener("click", () =>
      this.modal.classList.add("hidden"),
    );
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.modal.classList.add("hidden");
    });
  }

  render(): void {
    const project = this.getProject();
    this.list.textContent = "";

    project.tracks.forEach((track, index) => {
      const row = document.createElement("div");
      row.className = "mixrow";

      const head = document.createElement("div");
      head.className = "mixhead";

      const name = document.createElement("b");
      name.textContent = `${index + 1} ${track.name}`;

      const mute = document.createElement("button");
      mute.type = "button";
      mute.className = "tiny" + (track.muted ? " on" : "");
      mute.textContent = "음소거";
      mute.addEventListener("click", () => {
        this.cb.onBeforeChange();
        track.muted = !track.muted;
        this.cb.onAfterChange();
        this.after();
      });

      const solo = document.createElement("button");
      solo.type = "button";
      solo.className = "tiny solo" + (this.state.isSolo(track) ? " on" : "");
      solo.textContent = "솔로";
      solo.addEventListener("click", () => {
        // 솔로는 곡의 일부가 아니라 작업 중 상태라 되돌리기에 쌓지 않는다.
        this.state.toggleSolo(track);
        this.after();
      });

      head.append(name, mute, solo);
      row.appendChild(head);

      row.appendChild(
        this.slider("음량", track.volume, 0, 1, 0.01, (v) => (track.volume = v), (v) =>
          `${Math.round(v * 100)}`,
        ),
      );
      row.appendChild(
        this.slider("팬", track.pan, -1, 1, 0.02, (v) => (track.pan = v), (v) =>
          v === 0 ? "가운데" : v < 0 ? `왼쪽 ${Math.round(-v * 100)}` : `오른쪽 ${Math.round(v * 100)}`,
        ),
      );
      // 떨림은 긴 음에만 걸리게 하는 게 자연스럽다. 그래서 깊이 옆에 늘
      // "시작까지" 를 같이 둔다 — 둘이 짝이라 하나만 있으면 쓸모가 반이다.
      // 깊이가 0 에서 벗어나면 "떨림 시작" 줄이 새로 생기거나 사라져야 한다.
      const hadVibrato = (track.vibrato ?? 0) > 0;
      row.appendChild(
        this.slider(
          "떨림",
          track.vibrato ?? 0,
          0,
          1,
          0.02,
          (v) => (track.vibrato = v),
          (v) => (v === 0 ? "없음" : `${Math.round(v * 100)}`),
          () => {
            if (((track.vibrato ?? 0) > 0) !== hadVibrato) this.render();
          },
        ),
      );
      if ((track.vibrato ?? 0) > 0) {
        row.appendChild(
          this.slider(
            "떨림 시작",
            track.vibratoDelay ?? 0,
            0,
            1.2,
            0.05,
            (v) => (track.vibratoDelay = v),
            (v) => (v === 0 ? "바로" : `${v.toFixed(2)}초 뒤`),
          ),
        );
      }
      row.appendChild(
        this.slider(
          "울림",
          track.reverbSend ?? 0,
          0,
          1,
          0.01,
          (v) => (track.reverbSend = v),
          (v) => (v === 0 ? "없음" : `${Math.round(v * 100)}`),
        ),
      );

      this.list.appendChild(row);
    });

    if (this.state.hasSolo) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = "솔로가 걸려 있어 나머지 트랙은 들리지 않습니다. (저장되지 않는 상태입니다)";
      this.list.appendChild(note);
    }
  }

  private slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    set: (v: number) => void,
    format: (v: number) => string,
    /** 손을 뗀 뒤 줄 구성이 달라져야 할 때 (떨림 0 ↔ 0 초과). */
    onSettled?: () => void,
  ): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "mixslider";

    const text = document.createElement("span");
    text.textContent = label;

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const readout = document.createElement("i");
    readout.textContent = format(value);

    // 잡는 순간 한 번만 찍는다. 끄는 내내 찍으면 되돌리기가 무의미해진다.
    input.addEventListener("pointerdown", () => this.cb.onBeforeChange());
    input.addEventListener("input", () => {
      const v = Number(input.value);
      set(v);
      readout.textContent = format(v);
      this.cb.onChange();
    });
    input.addEventListener("change", () => {
      this.cb.onAfterChange();
      onSettled?.();
    });

    wrap.append(text, input, readout);
    return wrap;
  }

  private after(): void {
    this.cb.onChange();
    this.render();
  }
}
