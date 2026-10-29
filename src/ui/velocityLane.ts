/**
 * 세기 줄 (벨로시티 레인) — 피아노롤 아래, 음마다 세기 막대.
 *
 * 노트 창에서 하나씩 고치는 길은 이미 있다. 그런데 「마디 첫 박만 세게」 처럼
 * **여러 음의 강약을 한 번에** 손보려면 창을 열 번 열어야 한다. DAW 들이 피아노롤
 * 밑에 이 줄을 두는 이유다.
 *
 *   막대를 누르면     그 높이로 세기가 바뀐다
 *   옆으로 끌면       지나가는 음마다 손가락 높이로 바뀐다 (붓질)
 *   고른 음이 있으면  고른 음만 바뀐다 — 화음 중 위 음만 바꾸고 싶을 때
 *
 * **가로는 피아노롤과 똑같다.** 같은 확대, 같은 스크롤. 따로 두면 막대가 어느
 * 음인지 눈으로 짝지을 수가 없다. 그래서 좌표 변환을 피아노롤에게 묻는다.
 *
 * 되돌리기는 손가락을 대는 순간 한 번 찍는다 — 끄는 동안 프레임마다 찍으면
 * 되돌리기 한 번에 음 하나씩 돌아간다 (피아노롤과 같은 규칙).
 */

import type { Note, Project } from "../model/types";
import { GUTTER, C } from "./theme";

export type LaneHost = {
  xOfBeat: (beat: number) => number;
  readonly pxPerBeat: number;
  readonly activeTrack: number;
  isSelected: (id: string) => boolean;
  readonly selectedCount: number;
};

export type LaneCallbacks = {
  onBeforeChange: () => void;
  onAfterChange: () => void;
  onEdit: () => void;
  onStatus: (message: string) => void;
};

/** 막대 위아래 여백. 맨 위·맨 아래를 손가락으로 짚을 자리를 남긴다. */
const PAD_TOP = 8;
const PAD_BOTTOM = 6;
/** 막대를 짚었다고 볼 거리(px). 막대 자체는 얇지만 손가락은 굵다. */
const GRAB = 14;
/** 세기 1 아래로는 안 내린다 — 0 이면 소리가 안 나서 음이 사라진 줄 안다. */
const MIN_VEL = 1;

export class VelocityLane {
  private g: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dragging: { pointerId: number; touched: Set<string> } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private getProject: () => Project,
    private host: LaneHost,
    private cb: LaneCallbacks,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다");
    this.g = ctx;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    for (const type of ["touchstart", "touchend"]) {
      canvas.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = r.width;
    this.height = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private get notes(): Note[] {
    return this.getProject().tracks[this.host.activeTrack]?.notes ?? [];
  }

  /** 고른 게 있으면 고른 음만 만진다. */
  private editable(n: Note): boolean {
    return this.host.selectedCount === 0 || this.host.isSelected(n.id);
  }

  private velToY(v: number): number {
    const span = this.height - PAD_TOP - PAD_BOTTOM;
    return PAD_TOP + span * (1 - v / 127);
  }

  private yToVel(y: number): number {
    const span = Math.max(1, this.height - PAD_TOP - PAD_BOTTOM);
    const v = Math.round(127 * (1 - (y - PAD_TOP) / span));
    return Math.min(127, Math.max(MIN_VEL, v));
  }

  // ------------------------------------------------------------ 그리기

  render(): void {
    if (this.width === 0) return;
    const g = this.g;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, this.width, this.height);
    // 왼쪽은 피아노롤의 건반 자리다. 같은 폭을 비워 둬야 막대가 음 아래에 선다.
    g.fillStyle = C.ruler;
    g.fillRect(0, 0, GUTTER, this.height);
    g.fillStyle = C.dim;
    g.font = "600 10px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.fillText("세기", 8, this.height / 2);

    // 눈금: 64(중간), 100(찍을 때 기본값)
    g.fillStyle = C.lineBeat;
    for (const v of [64, 100, 127]) g.fillRect(GUTTER, Math.round(this.velToY(v)), this.width - GUTTER, 1);

    const selecting = this.host.selectedCount > 0;
    for (const n of this.notes) {
      const x = this.host.xOfBeat(n.start);
      if (x < GUTTER - 4 || x > this.width + 4) continue;
      const y = this.velToY(n.velocity);
      const on = this.editable(n);
      g.globalAlpha = selecting && !on ? 0.3 : 1;
      g.fillStyle = on && selecting ? C.noteActive : C.note;
      g.fillRect(Math.round(x), y, 3, this.height - PAD_BOTTOM - y);
      g.beginPath();
      g.arc(x + 1.5, y, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------ 입력

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /**
   * 그 x 에 걸리는 음들. 같은 박에서 시작한 음(화음)은 **같이** 든다 — 막대가
   * 같은 자리에 겹쳐 그려져서 손가락으로 하나만 고를 방법이 없다. 하나만
   * 바꾸고 싶으면 고르기로 골라 두면 된다.
   */
  private notesNear(x: number): Note[] {
    let best = Infinity;
    for (const n of this.notes) {
      if (!this.editable(n)) continue;
      const d = Math.abs(this.host.xOfBeat(n.start) + 1.5 - x);
      if (d < best) best = d;
    }
    if (best > GRAB) return [];
    return this.notes.filter((n) => this.editable(n) && Math.abs(Math.abs(this.host.xOfBeat(n.start) + 1.5 - x) - best) < 0.5);
  }

  private apply(x: number, y: number, touched: Set<string>): void {
    const v = this.yToVel(y);
    let changed = false;
    for (const n of this.notesNear(x)) {
      touched.add(n.id);
      if (n.velocity !== v) {
        n.velocity = v;
        changed = true;
      }
    }
    if (changed) this.cb.onEdit();
  }

  private onDown = (e: PointerEvent): void => {
    if (this.dragging) return; // 손가락 하나로만 붓질한다
    const p = this.local(e);
    if (p.x < GUTTER) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.cb.onBeforeChange();
    this.dragging = { pointerId: e.pointerId, touched: new Set() };
    this.lastX = p.x;
    this.apply(p.x, p.y, this.dragging.touched);
  };

  /**
   * 끄는 동안은 지나간 자리를 **빠짐없이** 칠한다. 손가락이 빨리 움직이면 이벤트
   * 사이에 수십 px 이 건너뛰는데, 그 사이의 음을 놓치면 붓질에 구멍이 난다.
   */
  private lastX: number | null = null;

  private onMove = (e: PointerEvent): void => {
    const d = this.dragging;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = this.local(e);
    const from = this.lastX ?? p.x;
    const steps = Math.max(1, Math.ceil(Math.abs(p.x - from) / 4));
    for (let i = 1; i <= steps; i += 1) this.apply(from + ((p.x - from) * i) / steps, p.y, d.touched);
    this.lastX = p.x;
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.dragging;
    if (!d || d.pointerId !== e.pointerId) return;
    this.dragging = null;
    this.lastX = null;
    this.cb.onAfterChange();
    if (d.touched.size === 0) {
      this.cb.onStatus(
        this.host.selectedCount > 0
          ? "고른 음의 막대를 누르세요 (고른 음만 바뀝니다)"
          : "막대(음이 시작하는 자리)를 누르거나 끌어서 세기를 바꿉니다",
      );
    } else {
      const v = this.notes.find((n) => d.touched.has(n.id))?.velocity;
      this.cb.onStatus(`${d.touched.size}개 음의 세기를 바꿨습니다${d.touched.size === 1 && v !== undefined ? ` (${v})` : ""}`);
    }
  };
}
