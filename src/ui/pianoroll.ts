/**
 * 캔버스 피아노롤 — 세로가 음높이, 가로가 시간.
 *
 * 터치를 1순위로 만들었다. 마우스에서만 되는 동작(호버 툴팁, 우클릭 메뉴)에는
 * 기능을 숨기지 않는다. 폰에서 되는 것과 PC 에서 되는 것이 같아야 한다.
 *
 *   탭            노트 찍기
 *   건반 누르고 있기 누른 만큼 소리 (위아래로 밀면 음이 따라온다)
 *   노트 드래그    옮기기 (그리드에 붙음)
 *   오른쪽 끝 드래그 길이 조절
 *   노트 탭        꾸밈 고르기 (시김새) — 남의 트랙 노트면 그 트랙으로 갈아탄다
 *   길게 누르기    삭제
 *   빈 곳 드래그   화면 이동
 *   두 손가락 핀치 가로 확대 / 세로 이동
 *   위쪽 눈금 탭   재생 위치 / 눈금 드래그 = 루프 구간
 *
 * 손가락은 마우스 커서보다 훨씬 굵어서, 노트 오른쪽 '끝' 판정을 픽셀 몇 개로
 * 잡으면 아무도 길이를 못 늘린다. EDGE_GRAB(20px) 만큼 넉넉히 잡되, 짧은
 * 노트에서는 폭의 절반을 넘지 않게 해서 '옮기기' 를 잡아먹지 않도록 했다.
 */

import type { Note, Project } from "../model/types";
import { beatsPerBar, makeNote, snap, snapFloor, sortNotes, totalBeats } from "../model/project";
import { clampPitch, isBlackKey, isC, midiToName } from "../util/music";
import type { Ornament } from "../model/ornament";
import {
  C,
  EDGE_GRAB,
  GUTTER,
  LONG_PRESS_MS,
  MAX_KEY_HEIGHT,
  MAX_PX_PER_BEAT,
  MIN_KEY_HEIGHT,
  MIN_PX_PER_BEAT,
  PLAYHEAD_GRAB,
  RULER,
  PREVIEW_DELAY,
  TAP_MS,
  TAP_SLOP,
} from "./theme";

/** 노트 오른쪽 끝에 찍는 표시. 글자 하나라 좁은 노트에서도 자리를 안 먹는다. */
const ORNAMENT_MARK: Record<Ornament, string> = {
  none: "",
  vibrato: "〜",
  scoop: "↗",
  fall: "↘",
  bend: "∧",
};

type Ptr = { x: number; y: number; downX: number; downY: number; downAt: number };

type Drag =
  | { mode: "none" }
  | { mode: "pan"; scrollX: number; scrollY: number; moved: boolean }
  | {
      mode: "move";
      note: Note;
      grabOffsetBeat: number;
      startPitch: number;
      startBeat: number;
      moved: boolean;
    }
  | { mode: "resize"; note: Note; startLength: number; downBeat: number }
  | { mode: "loop"; anchorBeat: number }
  | { mode: "scrub" }
  | { mode: "key"; pitch: number }
  | { mode: "pinch"; startDist: number; startPx: number; anchorBeat: number; startMidY: number; startScrollY: number };

export type PianoRollCallbacks = {
  /** 이제 뭔가 바꾼다 — 되돌리기용으로 직전 상태를 찍어 두라는 신호. */
  onBeforeChange: () => void;
  /** 바꾸기가 끝났다. */
  onAfterChange: () => void;
  onEdit: () => void;
  onPreview: (pitch: number, trackIndex: number) => void;
  /** 누르는 순간 소리를 내고 뗄 때까지 붙잡는다. 반드시 onPreviewRelease 로 끝낸다. */
  onPreviewHold: (pitch: number, trackIndex: number) => void;
  onPreviewRelease: () => void;
  /** 노트를 톡 쳤다 — 꾸밈을 고르는 창을 열라는 뜻. */
  onNoteTap: (note: Note) => void;
  /** 활성 트랙이 아닌 노트를 만졌다 — 왜 반응이 없는지 알려 달라. */
  onForeignNote: (trackIndex: number) => void;
  onSeek: (beat: number) => void;
  onLoopChange: (startBeat: number, endBeat: number) => void;
  getPlayheadBeat: () => number;
  getLoop: () => { enabled: boolean; start: number; end: number };
};

export class PianoRoll {
  private ctx2d: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  pxPerBeat = 96;
  keyHeight = 20;
  scrollX = 0;
  scrollY = 0;
  snapUnit = 0.5; // 1/8
  activeTrack = 0;

  private pointers = new Map<number, Ptr>();
  private drag: Drag = { mode: "none" };
  private longPressTimer: number | null = null;
  private previewTimer: number | null = null;
  /** 지금 미리듣기가 붙잡혀 있는가. 손을 뗄 때 끝내야 한다. */
  private previewHeld = false;
  private draggingNoteId: string | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private getProject: () => Project,
    private cb: PianoRollCallbacks,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다");
    this.ctx2d = ctx;

    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.resize();
    this.scrollToPitch(60);
  }

  // ------------------------------------------------------------ 좌표 변환

  private get track() {
    return this.getProject().tracks[this.activeTrack];
  }

  private beatToX(beat: number): number {
    return GUTTER + beat * this.pxPerBeat - this.scrollX;
  }

  private xToBeat(x: number): number {
    return (x - GUTTER + this.scrollX) / this.pxPerBeat;
  }

  private pitchToY(pitch: number): number {
    return RULER + (127 - pitch) * this.keyHeight - this.scrollY;
  }

  private yToPitch(y: number): number {
    return 127 - Math.floor((y - RULER + this.scrollY) / this.keyHeight);
  }

  private get contentHeight(): number {
    return 128 * this.keyHeight;
  }

  private get contentWidth(): number {
    return totalBeats(this.getProject()) * this.pxPerBeat;
  }

  private clampScroll(): void {
    const maxY = Math.max(0, this.contentHeight - (this.height - RULER));
    this.scrollY = Math.min(maxY, Math.max(0, this.scrollY));
    const maxX = Math.max(0, this.contentWidth - (this.width - GUTTER) + this.pxPerBeat);
    this.scrollX = Math.min(maxX, Math.max(0, this.scrollX));
  }

  scrollToPitch(pitch: number): void {
    const view = this.height - RULER;
    this.scrollY = (127 - pitch) * this.keyHeight - view / 2 + this.keyHeight / 2;
    this.clampScroll();
  }

  // ------------------------------------------------------------ 크기

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.clampScroll();
  }

  // ------------------------------------------------------------ 그리기

  render(): void {
    const g = this.ctx2d;
    const project = this.getProject();
    const bpb = beatsPerBar(project);

    g.fillStyle = C.bg;
    g.fillRect(0, 0, this.width, this.height);

    g.save();
    g.beginPath();
    g.rect(GUTTER, RULER, this.width - GUTTER, this.height - RULER);
    g.clip();

    this.drawRows();
    this.drawLoopShade();
    this.drawGrid(bpb);
    this.drawNotes();
    this.drawPlayhead();

    g.restore();

    this.drawKeyboard();
    this.drawRuler(bpb);
  }

  private drawRows(): void {
    const g = this.ctx2d;
    const first = Math.max(0, this.yToPitch(this.height) - 1);
    const last = Math.min(127, this.yToPitch(RULER) + 1);
    for (let p = first; p <= last; p += 1) {
      const y = this.pitchToY(p);
      g.fillStyle = isBlackKey(p) ? C.rowBlack : C.rowWhite;
      g.fillRect(GUTTER, y, this.width - GUTTER, this.keyHeight);
      if (isC(p)) {
        g.fillStyle = C.lineBeat;
        g.fillRect(GUTTER, y + this.keyHeight - 1, this.width - GUTTER, 1);
      }
    }
  }

  private drawGrid(bpb: number): void {
    const g = this.ctx2d;
    const startBeat = Math.max(0, Math.floor(this.xToBeat(GUTTER)));
    const endBeat = Math.ceil(this.xToBeat(this.width));

    // 잘게 나눈 선은 너무 촘촘하면 지저분하다. 8px 이하로 붙으면 그리지 않는다.
    const subVisible = this.snapUnit * this.pxPerBeat >= 8;
    if (subVisible) {
      g.fillStyle = C.lineSub;
      for (let b = snapFloor(startBeat, this.snapUnit); b <= endBeat; b += this.snapUnit) {
        const x = Math.round(this.beatToX(b));
        g.fillRect(x, RULER, 1, this.height - RULER);
      }
    }

    for (let b = startBeat; b <= endBeat; b += 1) {
      const x = Math.round(this.beatToX(b));
      const isBar = Math.abs(b % bpb) < 1e-6;
      g.fillStyle = isBar ? C.lineBar : C.lineBeat;
      g.fillRect(x, RULER, isBar ? 2 : 1, this.height - RULER);
    }
  }

  private drawLoopShade(): void {
    const loop = this.cb.getLoop();
    if (!loop.enabled) return;
    const g = this.ctx2d;
    const x1 = this.beatToX(loop.start);
    const x2 = this.beatToX(loop.end);
    g.fillStyle = C.loop;
    g.fillRect(x1, RULER, x2 - x1, this.height - RULER);
  }

  private drawNotes(): void {
    const project = this.getProject();
    // 다른 트랙은 흐리게 뒤에 깔아 준다. 여러 트랙을 겹쳐 만들 때
    // 남의 노트가 어디 있는지 안 보이면 같은 자리에 계속 찍게 된다.
    project.tracks.forEach((t, i) => {
      if (i !== this.activeTrack) this.drawTrackNotes(t.notes, false);
    });
    this.drawTrackNotes(project.tracks[this.activeTrack]?.notes ?? [], true);
  }

  private drawTrackNotes(notes: Note[], active: boolean): void {
    const g = this.ctx2d;

    for (const n of notes) {
      const x = this.beatToX(n.start);
      const w = Math.max(3, n.length * this.pxPerBeat);
      const y = this.pitchToY(n.pitch);
      const h = this.keyHeight;
      if (x + w < GUTTER || x > this.width || y + h < RULER || y > this.height) continue;

      const dragging = n.id === this.draggingNoteId;
      const alpha = (0.45 + (n.velocity / 127) * 0.55) * (active ? 1 : 0.34);
      g.globalAlpha = alpha;
      g.fillStyle = dragging ? C.noteActive : active ? C.note : C.noteOther;
      this.roundRect(x, y + 1, w, h - 2, Math.min(4, h / 3));
      g.fill();
      g.globalAlpha = active ? 1 : 0.45;

      g.strokeStyle = dragging ? C.noteActive : active ? C.noteEdge : C.noteOther;
      g.lineWidth = 1;
      this.roundRect(x + 0.5, y + 1.5, w - 1, h - 3, Math.min(4, h / 3));
      g.stroke();
      g.globalAlpha = 1;

      if (active && w > 34 && h >= 14) {
        g.fillStyle = "#0d1014";
        g.font = `600 ${Math.min(11, h - 6)}px system-ui, sans-serif`;
        g.textBaseline = "middle";
        g.fillText(midiToName(n.pitch), x + 5, y + h / 2);
      }

      // 꾸밈이 걸린 음은 눈에 보여야 한다. 안 보이면 "어디에 걸었더라" 를
      // 하나씩 눌러 확인해야 하고, 그건 조교가 아니라 수색이다.
      const mark = ORNAMENT_MARK[n.ornament ?? "none"];
      if (mark && h >= 10) {
        g.globalAlpha = active ? 1 : 0.4;
        g.fillStyle = "#0d1014";
        g.font = `700 ${Math.min(12, h - 3)}px system-ui, sans-serif`;
        g.textBaseline = "middle";
        g.textAlign = "right";
        g.fillText(mark, x + w - 4, y + h / 2);
        g.textAlign = "left";
        g.globalAlpha = 1;
      }
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const g = this.ctx2d;
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  private drawPlayhead(): void {
    const g = this.ctx2d;
    const x = this.beatToX(this.cb.getPlayheadBeat());
    g.fillStyle = C.playhead;
    g.fillRect(Math.round(x), RULER, 2, this.height - RULER);
  }

  private drawKeyboard(): void {
    const g = this.ctx2d;
    g.fillStyle = C.ruler;
    g.fillRect(0, RULER, GUTTER, this.height - RULER);

    const first = Math.max(0, this.yToPitch(this.height) - 1);
    const last = Math.min(127, this.yToPitch(RULER) + 1);
    for (let p = first; p <= last; p += 1) {
      const y = this.pitchToY(p);
      if (y + this.keyHeight < RULER || y > this.height) continue;
      const black = isBlackKey(p);
      g.fillStyle = black ? C.keyBlack : C.keyWhite;
      g.fillRect(0, y, black ? GUTTER * 0.62 : GUTTER, this.keyHeight - 1);
      g.fillStyle = C.keyLine;
      g.fillRect(0, y + this.keyHeight - 1, GUTTER, 1);

      if (isC(p) && this.keyHeight >= 12) {
        g.fillStyle = "#3a4152";
        g.font = "600 9px system-ui, sans-serif";
        g.textBaseline = "middle";
        g.textAlign = "right";
        g.fillText(midiToName(p), GUTTER - 4, y + this.keyHeight / 2);
        g.textAlign = "left";
      }
    }
    g.fillStyle = C.keyLine;
    g.fillRect(GUTTER - 1, RULER, 1, this.height - RULER);
  }

  private drawRuler(bpb: number): void {
    const g = this.ctx2d;
    g.fillStyle = C.ruler;
    g.fillRect(0, 0, this.width, RULER);

    g.save();
    g.beginPath();
    g.rect(GUTTER, 0, this.width - GUTTER, RULER);
    g.clip();

    const loop = this.cb.getLoop();
    if (loop.enabled) {
      const x1 = this.beatToX(loop.start);
      const x2 = this.beatToX(loop.end);
      g.fillStyle = C.loopEdge;
      g.globalAlpha = 0.28;
      g.fillRect(x1, 0, x2 - x1, RULER);
      g.globalAlpha = 1;
      g.fillRect(x1, 0, 2, RULER);
      g.fillRect(x2 - 2, 0, 2, RULER);
    }

    const startBeat = Math.max(0, Math.floor(this.xToBeat(GUTTER)));
    const endBeat = Math.ceil(this.xToBeat(this.width));
    g.font = "600 10px system-ui, sans-serif";
    g.textBaseline = "middle";
    for (let b = startBeat - (startBeat % bpb); b <= endBeat; b += bpb) {
      const x = Math.round(this.beatToX(b));
      g.fillStyle = C.lineBar;
      g.fillRect(x, RULER - 8, 1, 8);
      g.fillStyle = C.dim;
      g.fillText(String(Math.round(b / bpb) + 1), x + 4, RULER / 2);
    }

    // 재생 헤드 손잡이. 끌 수 있다는 걸 보여 주려면 잡을 만한 게 그려져 있어야 한다.
    const px = Math.round(this.beatToX(this.cb.getPlayheadBeat()));
    const scrubbing = this.drag.mode === "scrub";
    const w = 9;
    g.fillStyle = C.playhead;
    g.beginPath();
    g.moveTo(px - w, 2);
    g.lineTo(px + w, 2);
    g.lineTo(px + w, RULER - 12);
    g.lineTo(px, RULER - 3);
    g.lineTo(px - w, RULER - 12);
    g.closePath();
    g.fill();
    if (scrubbing) {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1.5;
      g.stroke();
    }

    g.restore();
    g.fillStyle = C.keyLine;
    g.fillRect(0, RULER - 1, this.width, 1);
  }

  // ------------------------------------------------------------ 히트 테스트

  private localPoint(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /**
   * 그 자리에 있는 노트. **활성 트랙을 먼저 보고, 없으면 다른 트랙도 본다.**
   *
   * 예전에는 활성 트랙만 봤다. 그래서 화면에 흐리게 보이는 남의 트랙 노트를
   * 누르면 아무 일도 안 일어나고, 대신 그 자리에 **활성 트랙의 새 노트가 조용히
   * 찍혔다.** 예제 곡처럼 트랙이 여럿이면 대부분의 탭이 그 경우라 "눌러도
   * 안 된다" 가 된다. 실제로 그렇게 됐다.
   *
   * 눈에 보이는 걸 눌렀으면 그게 잡혀야 한다. 다른 트랙이면 그 트랙으로
   * 갈아탄다 (조용히 갈아타지 않고 화면에 알린다 — onTrackSwitch).
   */
  private noteAt(x: number, y: number): { note: Note; trackIndex: number } | null {
    const project = this.getProject();
    const pitch = this.yToPitch(y);
    const beat = this.xToBeat(x);

    const inTrack = (trackIndex: number) => {
      const notes = project.tracks[trackIndex]?.notes ?? [];
      // 뒤에서부터 본다 = 나중에 찍은 노트가 위에 있다
      for (let i = notes.length - 1; i >= 0; i -= 1) {
        const n = notes[i];
        if (n.pitch !== pitch) continue;
        const w = Math.max(3, n.length * this.pxPerBeat);
        if (beat >= n.start && beat <= n.start + w / this.pxPerBeat) return n;
      }
      return null;
    };

    const mine = inTrack(this.activeTrack);
    if (mine) return { note: mine, trackIndex: this.activeTrack };
    for (let t = 0; t < project.tracks.length; t += 1) {
      if (t === this.activeTrack) continue;
      const found = inTrack(t);
      if (found) return { note: found, trackIndex: t };
    }
    return null;
  }

  /**
   * 노트의 오른쪽 끝을 잡았는가 (길이 조절).
   *
   * 고정 폭으로 잡으면 안 된다. 1/16 노트는 화면에서 20px 도 안 되는데
   * 거기에 20px 짜리 '끝' 판정을 붙이면 노트 전체가 길이 조절 구역이 되어
   * **옮기기가 아예 안 된다** (실제로 그랬다). 폭에 비례시키되 아래위로
   * 한계를 둔다: 짧은 노트에서도 옮길 자리가 남고, 긴 노트에서 끝이
   * 손가락보다 좁아지지도 않는다.
   */
  private onRightEdge(n: Note, x: number): boolean {
    const right = this.beatToX(n.start + n.length);
    const w = Math.max(3, n.length * this.pxPerBeat);
    const zone = clamp(w * 0.35, 8, EDGE_GRAB);
    return x >= right - zone && x <= right + EDGE_GRAB * 0.5;
  }

  // ------------------------------------------------------------ 입력

  private onDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.localPoint(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, downX: p.x, downY: p.y, downAt: performance.now() });

    if (this.pointers.size === 2) {
      this.cancelLongPress();
      // 두 손가락 = 확대. 첫 손가락으로 예약해 둔 소리를 취소한다.
      this.cancelPreview();
      this.beginPinch();
      return;
    }
    if (this.pointers.size > 2) return;

    if (p.y < RULER) {
      if (p.x < GUTTER) return;
      // 재생 헤드 손잡이를 잡았으면 **끌어서 옮긴다.**
      //
      // 예전에는 눈금에서 끌면 무조건 루프 구간이 잡혀서, 빨간 줄 자체를 끄는
      // 방법이 아예 없었다. 탭으로 한 번에 맞히는 수밖에 없었는데 그게 어렵다.
      const headX = this.beatToX(this.cb.getPlayheadBeat());
      if (Math.abs(p.x - headX) <= PLAYHEAD_GRAB) {
        this.drag = { mode: "scrub" };
        this.cb.onSeek(Math.max(0, snap(this.xToBeat(p.x), this.snapUnit)));
        return;
      }
      this.drag = { mode: "loop", anchorBeat: Math.max(0, snap(this.xToBeat(p.x), this.snapUnit)) };
      return;
    }

    if (p.x < GUTTER) {
      // 건반은 **누르고 있는 동안** 울린다. 음원을 고르려고 누르는 자리라,
      // 0.25초로 끊으면 가야금인지 색소폰인지 판단할 수가 없다.
      const pitch = clampPitch(this.yToPitch(p.y));
      this.holdPreview(pitch);
      this.drag = { mode: "key", pitch };
      return;
    }

    const found = this.noteAt(p.x, p.y);
    if (found) {
      const hit = found.note;
      // 남의 트랙 노트면 **아무것도 하지 않는다.** 작업하던 트랙을 마음대로
      // 바꾸면 다음에 찍는 노트가 엉뚱한 데로 간다. 다만 그 자리에 새 노트를
      // 찍지도 않는다 — 예전에는 그래서 남의 노트 위에 노트가 조용히 겹쳤다.
      // 왜 반응이 없는지는 말해 준다.
      if (found.trackIndex !== this.activeTrack) {
        this.cb.onForeignNote(found.trackIndex);
        this.drag = { mode: "none" };
        return;
      }

      // 끄는 동안 프레임마다 찍으면 되돌리기가 1픽셀씩 돌아간다.
      // 손가락을 대는 이 순간의 상태만 쌓는다.
      this.cb.onBeforeChange();
      this.draggingNoteId = hit.id;
      if (this.onRightEdge(hit, p.x)) {
        this.drag = { mode: "resize", note: hit, startLength: hit.length, downBeat: this.xToBeat(p.x) };
      } else {
        this.drag = {
          mode: "move",
          note: hit,
          grabOffsetBeat: this.xToBeat(p.x) - hit.start,
          startPitch: hit.pitch,
          startBeat: hit.start,
          moved: false,
        };
        this.startLongPress(hit);
      }
      return;
    }

    // 빈 격자를 누른 것 — 곧 그 음을 들려준다. 다만 아주 잠깐 기다린다.
    //
    // 예전에는 노트가 찍히는 순간(손가락을 뗄 때) 소리를 냈다. 그러면 누르고
    // 있는 시간이 그대로 지연이 됐다 — 실측 124ms, 천천히 누를수록 더.
    //
    // 그래서 대는 즉시로 옮겼더니 이번엔 **확대하거나 화면을 밀 때마다** 소리가
    // 났다. 핀치도 화면 밀기도 손가락 하나가 닿는 것으로 시작하기 때문에,
    // 닿자마자 소리를 내면 피할 방법이 없다.
    //
    // 아주 짧게 기다렸다가 낸다. 그 사이에 손가락이 움직이거나 두 번째 손가락이
    // 오면 취소한다. PREVIEW_DELAY 는 두 번째 손가락이 닿는 시간을 덮으면서
    // 사람이 지연으로 느끼지 않는 선에서 잡았다.
    const pitch = clampPitch(this.yToPitch(p.y));
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      this.holdPreview(pitch);
    }, PREVIEW_DELAY);
    this.drag = { mode: "pan", scrollX: this.scrollX, scrollY: this.scrollY, moved: false };
  };

  private onMove = (e: PointerEvent): void => {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    const p = this.localPoint(e);
    ptr.x = p.x;
    ptr.y = p.y;

    const movedFar = Math.hypot(p.x - ptr.downX, p.y - ptr.downY) > TAP_SLOP;
    if (movedFar) {
      this.cancelLongPress();
      // 화면을 미는 중이다 — 노트를 찍는 게 아니니 소리를 내지 않는다.
      if (this.drag.mode === "pan") this.cancelPreview();
    }

    switch (this.drag.mode) {
      case "pinch":
        this.updatePinch();
        break;

      case "pan": {
        if (movedFar) this.drag.moved = true;
        this.scrollX = this.drag.scrollX - (p.x - ptr.downX);
        this.scrollY = this.drag.scrollY - (p.y - ptr.downY);
        this.clampScroll();
        break;
      }

      case "move": {
        if (!movedFar) break;
        this.drag.moved = true;
        const n = this.drag.note;
        const rawStart = this.xToBeat(p.x) - this.drag.grabOffsetBeat;
        const newStart = Math.max(0, snap(rawStart, this.snapUnit));
        const newPitch = clampPitch(this.yToPitch(p.y));
        if (newPitch !== n.pitch) this.cb.onPreview(newPitch, this.activeTrack);
        n.start = newStart;
        n.pitch = newPitch;
        this.cb.onEdit();
        break;
      }

      case "resize": {
        const delta = this.xToBeat(p.x) - this.drag.downBeat;
        const raw = this.drag.startLength + delta;
        this.drag.note.length = Math.max(this.snapUnit, snap(raw, this.snapUnit));
        this.cb.onEdit();
        break;
      }

      case "key": {
        // 건반 위에서 손가락을 위아래로 미끄러뜨리면 그 음으로 갈아탄다.
        // 실제 건반에서 손가락을 미는 것과 같다.
        const pitch = clampPitch(this.yToPitch(p.y));
        if (pitch !== this.drag.pitch) {
          this.drag.pitch = pitch;
          this.holdPreview(pitch);
        }
        break;
      }

      case "scrub": {
        this.cb.onSeek(Math.max(0, snap(this.xToBeat(p.x), this.snapUnit)));
        break;
      }

      case "loop": {
        const b = Math.max(0, snap(this.xToBeat(p.x), this.snapUnit));
        const lo = Math.min(this.drag.anchorBeat, b);
        const hi = Math.max(this.drag.anchorBeat, b);
        if (hi - lo >= this.snapUnit) this.cb.onLoopChange(lo, hi);
        break;
      }

      default:
        break;
    }
  };

  private onUp = (e: PointerEvent): void => {
    const ptr = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.cancelLongPress();
    // 손을 뗐으니 붙잡고 있던 소리를 끝낸다. 예약만 해 두고 아직 안 낸
    // 소리라면 그대로 취소한다.
    this.cancelPreview();

    if (this.drag.mode === "pinch") {
      // 손가락 하나가 떨어지면 핀치 종료. 남은 손가락은 새 제스처로 치지 않는다.
      if (this.pointers.size < 2) this.drag = { mode: "none" };
      return;
    }

    if (!ptr) return;
    const p = this.localPoint(e);
    const quick = performance.now() - ptr.downAt < TAP_MS;
    const still = Math.hypot(p.x - ptr.downX, p.y - ptr.downY) <= TAP_SLOP;

    if (this.drag.mode === "loop" && quick && still) {
      this.cb.onSeek(Math.max(0, snap(this.xToBeat(p.x), this.snapUnit)));
    } else if (this.drag.mode === "pan" && still) {
      // 시간 제한을 두지 않는다. 빈 곳을 좀 오래 눌렀다 뗐다고 아무 일도
      // 안 일어나면 사용자는 앱이 고장 난 줄 안다.
      this.addNoteAt(p.x, p.y);
    } else if (this.drag.mode === "move" || this.drag.mode === "resize") {
      // **손가락이 움직였는지가 아니라, 노트가 실제로 바뀌었는지로 가른다.**
      //
      // 예전에는 "8px 안 움직였으면 탭" 이었다. 그런데 진짜 터치로 재 보니
      // 10px 만 흔들려도 탭으로 안 쳐 줬다. 노트는 격자에 붙어 있어서 제자리
      // 그대로인데 창만 안 열린다 — 사용자에게는 **눌렀는데 아무 일도 안
      // 일어나는 것**으로 보인다. 손가락은 원래 그만큼 흔들린다.
      //
      // 안 움직인 노트를 놓았으면 그건 탭이다. 얼마나 흔들렸든 상관없다.
      const changed =
        this.drag.mode === "move"
          ? this.drag.note.start !== this.drag.startBeat ||
            this.drag.note.pitch !== this.drag.startPitch
          : this.drag.note.length !== this.drag.startLength;

      if (changed) {
        const track = this.track;
        if (track) sortNotes(track);
      } else {
        // 길이 조절 자리(오른쪽 끝)에서도 받는다. 손가락 굵기 때문에 노트의
        // 오른쪽 20px 은 길이 조절로 잡히는데 좁은 노트에서는 그게 3분의 1이라,
        // 거기를 누르면 아무 일도 안 일어났다.
        this.cb.onNoteTap(this.drag.note);
      }
    }

    this.draggingNoteId = null;
    this.drag = { mode: "none" };
    this.cb.onAfterChange();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (e.ctrlKey || e.metaKey) {
      const anchorBeat = this.xToBeat(x);
      const factor = Math.exp(-e.deltaY * 0.002);
      this.pxPerBeat = clamp(this.pxPerBeat * factor, MIN_PX_PER_BEAT, MAX_PX_PER_BEAT);
      this.scrollX = anchorBeat * this.pxPerBeat - (x - GUTTER);
    } else if (e.shiftKey) {
      this.scrollX += e.deltaY;
    } else {
      this.scrollY += e.deltaY;
    }
    this.clampScroll();
  };

  // ------------------------------------------------------------ 제스처 보조

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    const dist = Math.max(1, Math.abs(a.x - b.x));
    const midX = (a.x + b.x) / 2;
    this.drag = {
      mode: "pinch",
      startDist: dist,
      startPx: this.pxPerBeat,
      anchorBeat: this.xToBeat(midX),
      startMidY: (a.y + b.y) / 2,
      startScrollY: this.scrollY,
    };
  }

  private updatePinch(): void {
    if (this.drag.mode !== "pinch") return;
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.max(1, Math.abs(a.x - b.x));
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    this.pxPerBeat = clamp(
      (this.drag.startPx * dist) / this.drag.startDist,
      MIN_PX_PER_BEAT,
      MAX_PX_PER_BEAT,
    );
    // 두 손가락 사이에 있던 박이 제자리에 있어야 확대가 자연스럽다.
    this.scrollX = this.drag.anchorBeat * this.pxPerBeat - (midX - GUTTER);
    this.scrollY = this.drag.startScrollY - (midY - this.drag.startMidY);
    this.clampScroll();
  }

  /** 그 박이 화면 왼쪽에 오도록 가로 스크롤을 옮긴다. */
  scrollToBeat(beat: number): void {
    this.scrollX = Math.max(0, beat * this.pxPerBeat - 40);
    this.clampScroll();
  }

  private startLongPress(note: Note): void {
    this.cancelLongPress();
    this.longPressTimer = window.setTimeout(() => {
      const track = this.track;
      if (!track) return;
      const i = track.notes.findIndex((n) => n.id === note.id);
      if (i >= 0) {
        track.notes.splice(i, 1);
        navigator.vibrate?.(15);
        this.cb.onEdit();
        this.cb.onAfterChange();
      }
      this.draggingNoteId = null;
      this.drag = { mode: "none" };
    }, LONG_PRESS_MS);
  }

  /** 소리를 내고 손을 뗄 때까지 붙잡는다. */
  private holdPreview(pitch: number): void {
    this.previewHeld = true;
    this.cb.onPreviewHold(pitch, this.activeTrack);
  }

  /** 예약해 둔 미리듣기를 취소하고, 이미 울리고 있으면 끝낸다. */
  private cancelPreview(): void {
    if (this.previewTimer !== null) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    if (this.previewHeld) {
      this.previewHeld = false;
      this.cb.onPreviewRelease();
    }
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private addNoteAt(x: number, y: number): void {
    const track = this.track;
    if (!track) return;
    this.cb.onBeforeChange();
    const pitch = clampPitch(this.yToPitch(y));
    const start = Math.max(0, snapFloor(this.xToBeat(x), this.snapUnit));
    const note = makeNote(pitch, start, this.snapUnit);
    track.notes.push(note);
    sortNotes(track);
    // 미리듣기는 손가락을 댈 때 이미 냈다. 여기서 또 내면 두 번 울린다.
    this.cb.onEdit();
    this.cb.onAfterChange();
  }

  // ------------------------------------------------------------ 외부 조작

  zoomBy(factor: number): void {
    const anchorBeat = this.xToBeat(this.width / 2);
    this.pxPerBeat = clamp(this.pxPerBeat * factor, MIN_PX_PER_BEAT, MAX_PX_PER_BEAT);
    this.scrollX = anchorBeat * this.pxPerBeat - (this.width / 2 - GUTTER);
    this.clampScroll();
  }

  zoomKeys(factor: number): void {
    const centerPitch = this.yToPitch(this.height / 2);
    this.keyHeight = clamp(this.keyHeight * factor, MIN_KEY_HEIGHT, MAX_KEY_HEIGHT);
    this.scrollToPitch(centerPitch);
  }

  /** 재생 헤드가 화면 밖으로 나가면 따라간다. */
  followPlayhead(beat: number): void {
    const x = this.beatToX(beat);
    if (x < GUTTER + 40 || x > this.width - 60) {
      this.scrollX = beat * this.pxPerBeat - (this.width - GUTTER) * 0.3;
      this.clampScroll();
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
