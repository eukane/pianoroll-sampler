/**
 * 실제 피아노 크기의 연주 건반.
 *
 * 피아노롤 왼쪽의 작은 건반은 **음을 확인하는** 자리다 — 한 번에 한 음, 손가락을
 * 미끄러뜨리면 음이 따라온다. 이건 **코드를 손으로 짚는** 자리라 성격이 다르다.
 *
 *   · 흰 건반 하나가 실제 피아노처럼 2.3cm 다. 손 모양이 그대로 진짜 건반으로 간다
 *   · 손가락마다 따로 울린다 (도·미·솔을 같이 누르면 셋 다 난다)
 *   · 손을 다 떼면, 눌렀던 음을 **한 번에** 알려 준다 → 화면이 재생 위치에 찍는다
 *
 * 「눌렀던 음」 은 **처음 손가락 하나가 떨어지는 순간** 눌려 있던 음들이다.
 * 사람은 화음을 동시에 떼지 못한다 — 하나씩 떨어지는 사이에 남은 손가락만 세면
 * 마지막 한 음만 찍힌다. 반대로 손가락이 지나간 건반을 전부 세면 미끄러진
 * 자리가 다 찍힌다. 첫 손가락이 떨어지는 순간이 "이게 내가 친 화음이다" 에
 * 제일 가깝다.
 *
 * 건반 위에서는 화면 밀기·확대를 하지 않는다. 손가락은 전부 건반이다.
 */

import type { Key } from "../model/scale";
import { inKey, isTonic, pcName, solfege } from "../model/scale";
import { isBlackKey } from "../util/music";
import { WHITE_KEY_CM } from "./calibration";

export type PlayKeyboardCallbacks = {
  onHold: (pitch: number) => void;
  /**
   * @param immediate 바로 끊는다. 손가락이 옆 건반으로 **미끄러졌을** 때다 — 손을
   *                  뗀 게 아니라 다른 음으로 넘어간 것이라, 앞 음이 남아 울리면
   *                  두 음이 겹쳐 들린다. 톡 치고 뗀 음만 최소 시간을 채운다.
   */
  onRelease: (pitch: number, immediate: boolean) => void;
  /** 지금 눌려 있는 음이 바뀌었다 (코드 이름 표시용). */
  onHeldChange: (pitches: number[]) => void;
  /** 손을 다 뗐다. 그동안 친 화음. */
  onChord: (pitches: number[]) => void;
  getKey: () => Key | null;
};

/** 화면에 그릴 건반 하나. */
type KeyRect = { pitch: number; x: number; w: number; h: number; black: boolean };

const C_KEY = {
  white: "#eceef3",
  whiteDown: "#4ec9b0",
  black: "#262a33",
  blackDown: "#2f9c86",
  edge: "#0d0f14",
  label: "#4a5263",
  labelDim: "#8a93a6",
  scaleDot: "#4ec9b0",
  tonic: "#ffd479",
};

export class PlayKeyboard {
  private g: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private keys: KeyRect[] = [];

  /** 1cm 가 몇 px 인가 (ui/calibration.ts). */
  pxPerCm: number;
  /** 맨 왼쪽 흰 건반. 언제나 도(C)에서 시작한다 — 손 위치를 잡기 쉽다. */
  lowC = 60;

  /** 손가락 → 그 손가락이 누르고 있는 음. */
  private fingers = new Map<number, number>();
  /** 이번에 친 화음. 첫 손가락이 떨어질 때 정해진다. */
  private chord: number[] | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    pxPerCm: number,
    private cb: PlayKeyboardCallbacks,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다");
    this.g = ctx;
    this.pxPerCm = pxPerCm;

    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("lostpointercapture", this.onUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    // 피아노롤과 같은 이유 — 터치가 끝나면 브라우저가 호환용 클릭을 한 번 더
    // 쏘는데, 그게 건반 위로 열린 창의 버튼에 꽂힐 수 있다. 터치 이벤트에서 막는다.
    for (const type of ["touchstart", "touchend"]) {
      canvas.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }
  }

  /** 흰 건반 한 개의 폭(px). */
  get whiteW(): number {
    return WHITE_KEY_CM * this.pxPerCm;
  }

  /** 지금 화면에 흰 건반이 몇 개 들어가는가. */
  get whiteCount(): number {
    return this.keys.filter((k) => !k.black).length;
  }

  /** 지금 보이는 맨 아래·맨 위 음. */
  get range(): { low: number; high: number } {
    const ps = this.keys.map((k) => k.pitch);
    return { low: Math.min(...ps), high: Math.max(...ps) };
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = r.width;
    this.height = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
    this.render();
  }

  /**
   * 건반을 늘어놓는다. **잘린 건반은 그리지 않는다** — 반쪽짜리 건반은 손가락이
   * 어디까지가 그 음인지 모른다. 남는 폭은 양옆에 나눠 가운데 둔다.
   */
  private layout(): void {
    const ww = this.whiteW;
    const count = Math.max(1, Math.floor(this.width / ww));
    const left = (this.width - count * ww) / 2;
    const whites: number[] = [];
    for (let p = this.lowC; whites.length < count && p <= 127; p += 1) if (!isBlackKey(p)) whites.push(p);

    const keys: KeyRect[] = whites.map((pitch, i) => ({ pitch, x: left + i * ww, w: ww, h: this.height, black: false }));
    // 검은 건반은 실제 피아노 비율대로 — 폭은 흰 건반의 약 60%, 길이는 약 62%.
    const bw = ww * 0.6;
    const bh = this.height * 0.62;
    whites.forEach((pitch, i) => {
      const up = pitch + 1;
      if (i < whites.length - 1 && isBlackKey(up)) {
        keys.push({ pitch: up, x: left + (i + 1) * ww - bw / 2, w: bw, h: bh, black: true });
      }
    });
    this.keys = keys;
  }

  shiftOctave(dir: number): boolean {
    const next = this.lowC + 12 * dir;
    // 맨 아래 C-1(0) 부터, 맨 위는 건반이 127 을 넘지 않을 만큼.
    if (next < 0 || next > 120) return false;
    this.releaseAll();
    this.lowC = next;
    this.layout();
    this.render();
    return true;
  }

  // ------------------------------------------------------------ 입력

  private keyAt(x: number, y: number): KeyRect | null {
    // 검은 건반이 흰 건반 위에 얹혀 있다 — 먼저 본다.
    for (const k of this.keys) if (k.black && x >= k.x && x < k.x + k.w && y < k.h) return k;
    for (const k of this.keys) if (!k.black && x >= k.x && x < k.x + k.w) return k;
    return null;
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private held(): number[] {
    return [...new Set(this.fingers.values())].sort((a, b) => a - b);
  }

  private press(pointerId: number, pitch: number): void {
    const before = this.fingers.get(pointerId);
    if (before === pitch) return;
    this.fingers.set(pointerId, pitch);
    // 다른 손가락이 같은 건반을 누르고 있으면 소리는 그대로 둔다.
    if (before !== undefined && ![...this.fingers.values()].includes(before)) this.cb.onRelease(before, true);
    if ([...this.fingers.entries()].filter(([, p]) => p === pitch).length === 1) this.cb.onHold(pitch);
    this.cb.onHeldChange(this.held());
    this.render();
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    const k = this.keyAt(p.x, p.y);
    if (!k) return;
    // 새 화음의 첫 손가락이다. 지난번 것은 이미 넘겼다.
    if (this.fingers.size === 0) this.chord = null;
    this.press(e.pointerId, k.pitch);
  };

  /** 누른 채로 옆 건반으로 미끄러지면 그 음으로 갈아탄다 (실제 건반과 같다). */
  private onMove = (e: PointerEvent): void => {
    if (!this.fingers.has(e.pointerId)) return;
    const p = this.local(e);
    const k = this.keyAt(p.x, p.y);
    if (k) this.press(e.pointerId, k.pitch);
  };

  private onUp = (e: PointerEvent): void => {
    const pitch = this.fingers.get(e.pointerId);
    if (pitch === undefined) return;
    // 첫 손가락이 떨어지는 순간이 이번 화음이다 (위의 설명).
    if (this.chord === null) this.chord = this.held();
    this.fingers.delete(e.pointerId);
    if (![...this.fingers.values()].includes(pitch)) this.cb.onRelease(pitch, false);
    this.cb.onHeldChange(this.held());
    if (this.fingers.size === 0) {
      const chord = this.chord;
      this.chord = null;
      if (chord.length > 0) this.cb.onChord(chord);
    }
    this.render();
  };

  /** 손 떼는 신호를 놓쳤을 때(화면이 꺼짐 등). 찍지는 않고 소리만 끊는다. */
  releaseAll(): void {
    for (const p of new Set(this.fingers.values())) this.cb.onRelease(p, true);
    this.fingers.clear();
    this.chord = null;
    this.cb.onHeldChange([]);
  }

  // ------------------------------------------------------------ 그리기

  render(): void {
    const g = this.g;
    g.clearRect(0, 0, this.width, this.height);
    const key = this.cb.getKey();
    const down = new Set(this.fingers.values());

    for (const k of this.keys) {
      if (k.black) continue;
      g.fillStyle = down.has(k.pitch) ? C_KEY.whiteDown : C_KEY.white;
      g.fillRect(k.x + 1, 0, k.w - 2, k.h - 1);
      this.drawMarks(k, key, down.has(k.pitch));
    }
    for (const k of this.keys) {
      if (!k.black) continue;
      g.fillStyle = down.has(k.pitch) ? C_KEY.blackDown : C_KEY.black;
      g.fillRect(k.x, 0, k.w, k.h);
      g.fillStyle = C_KEY.edge;
      g.fillRect(k.x, k.h - 3, k.w, 3);
      this.drawMarks(k, key, down.has(k.pitch));
    }
  }

  /**
   * 건반에 적는 글자와 조 표시.
   *
   * 흰 건반에는 음이름(C)과 고정 도 계이름(도)을 같이 적는다 — 수업이 둘을 같이
   * 쓴다. 도(C)에는 옥타브 번호까지(C4). 검은 건반은 좁아서 조 표시만.
   *
   * 조를 정했으면 **조 안의 음에 점**, 으뜸음에는 노란 점을 찍는다. 막지는 않는다 —
   * 조 밖의 음도 그대로 쳐진다. 조는 규칙이 아니라 설명이다.
   */
  private drawMarks(k: KeyRect, key: Key | null, down: boolean): void {
    const g = this.g;
    const cx = k.x + k.w / 2;
    if (key && inKey(k.pitch, key)) {
      const r = Math.max(3, Math.min(6, k.w * 0.09));
      g.fillStyle = isTonic(k.pitch, key) ? C_KEY.tonic : C_KEY.scaleDot;
      g.beginPath();
      g.arc(cx, k.h - (k.black ? 12 : 54), r, 0, Math.PI * 2);
      g.fill();
    }
    if (k.black) return;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillStyle = down ? "#06120f" : C_KEY.label;
    const fs = Math.max(11, Math.min(18, k.w * 0.16));
    g.font = `700 ${fs}px system-ui, sans-serif`;
    const octave = Math.floor(k.pitch / 12) - 1;
    const name = pcName(k.pitch, key) + (k.pitch % 12 === 0 ? String(octave) : "");
    g.fillText(name, cx, k.h - 24);
    g.font = `500 ${Math.max(10, fs - 4)}px system-ui, sans-serif`;
    g.fillStyle = down ? "#06120f" : C_KEY.labelDim;
    g.fillText(solfege(k.pitch), cx, k.h - 8);
    g.textAlign = "left";
  }
}
