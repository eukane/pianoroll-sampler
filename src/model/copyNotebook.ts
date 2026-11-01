/**
 * 코드 따기 연습 — 마디 칸 계산 (순수).
 *
 * 곡 위에 「박자 눈금」 을 얹는다: BPM · 한 마디 몇 박 · 1박이 시작하는 시각(offset) 셋이면 곡의 어느 시각이든
 * 몇 번째 마디 몇 박인지가 정해진다. 그 눈금 위에서
 *   · 마디 단위로 구간 반복 (첫 후렴 4마디만 계속 듣기)
 *   · 마디마다 내가 딴 코드 적어 두기 → 곡에 맞춰 그 코드를 같이 들려 주기
 * 를 한다.
 *
 * 마디 번호는 화면에서 1부터 보이고 계산은 0부터다 (`bar` = 0 이 offset 에서 시작하는 첫 마디).
 * 박자가 곡 중간에 바뀌는 곡은 다루지 않는다 (한 곡에 눈금 하나).
 */

import { splitCell } from "./chordSymbol.ts";

export type CopyState = {
  bpm: number;
  /** 한 마디가 몇 박(4분음표 기준)인가. 4/4 = 4, 3/4 = 3, 6/8 은 3 이나 6 중 느끼는 대로 */
  beatsPerBar: number;
  /** 1박(첫 마디의 시작)이 곡의 몇 초에 있는가 */
  offset: number;
  /** 재생 속도 (1 = 원래대로). 음정은 그대로다. */
  speed: number;
  loop: { a: number; b: number } | null;
  loopOn: boolean;
  /** 구간을 한 바퀴 돌 때마다 속도를 한 단계씩 올린다 (느린 속도에서 시작해 원래 속도까지) */
  ramp: boolean;
  markers: { t: number; label: string }[];
  /** 코드 표가 시작하는 마디 (1부터) */
  firstBar: number;
  /** 마디마다 적은 코드. 한 칸에 「Am F」 처럼 둘 이상이면 그 마디를 똑같이 나눈다. */
  cells: string[];
  key?: { tonic: number; mode: "major" | "minor" };
  /** 내가 딴 코드를 곡과 같이 들려 줄까 */
  overlay: boolean;
  songVolume: number;
  chordVolume: number;
};

export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const SPEEDS = [0.5, 0.6, 0.75, 0.9, 1] as const;
export const MAX_CELLS = 64;
export const MAX_MARKERS = 40;

export function defaultState(): CopyState {
  return {
    bpm: 100, beatsPerBar: 4, offset: 0, speed: 0.75, loop: null, loopOn: false, ramp: false, markers: [],
    firstBar: 1, cells: Array(8).fill(""), overlay: true, songVolume: 0.9, chordVolume: 0.7,
  };
}

export const barSeconds = (bpm: number, beatsPerBar: number): number => (beatsPerBar * 60) / bpm;

/** 이 시각이 몇 번째 마디인가 (0부터, offset 앞이면 음수). */
export function barIndexAt(t: number, offset: number, barSec: number): number {
  return Math.floor((t - offset) / barSec + 1e-9);
}

export function barStartTime(bar: number, offset: number, barSec: number): number {
  return offset + bar * barSec;
}

/** 「3마디 2박」 처럼 사람이 읽는 위치. 박은 1부터, 소수 첫째 자리까지. */
export function positionLabel(t: number, st: Pick<CopyState, "bpm" | "beatsPerBar" | "offset">): string {
  const bs = barSeconds(st.bpm, st.beatsPerBar);
  const bar = barIndexAt(t, st.offset, bs);
  const beat = ((t - st.offset - bar * bs) / 60) * st.bpm;
  const b = Math.max(0, Math.min(st.beatsPerBar, beat));
  return `${bar + 1}마디 ${(Math.floor(b * 10 + 1e-6) / 10 + 1).toFixed(1)}박`;
}

/**
 * 지금 시각에 적어 둔 코드. 표 밖이거나 비어 있으면 null.
 * `slot` = 한 마디 안에서 몇 번째 코드, `count` = 그 마디의 코드 개수.
 */
export function cellAt(t: number, st: Pick<CopyState, "bpm" | "beatsPerBar" | "offset" | "firstBar" | "cells">):
  { cell: number; slot: number; count: number; symbol: string } | null {
  const bs = barSeconds(st.bpm, st.beatsPerBar);
  const bar = barIndexAt(t, st.offset, bs);
  const cell = bar - (st.firstBar - 1);
  if (cell < 0 || cell >= st.cells.length) return null;
  const tokens = splitCell(st.cells[cell]);
  if (tokens.length === 0) return null;
  const frac = (t - st.offset - bar * bs) / bs;
  const slot = Math.min(tokens.length - 1, Math.max(0, Math.floor(frac * tokens.length + 1e-9)));
  return { cell, slot, count: tokens.length, symbol: tokens[slot] };
}

/** 지금 마디부터 n마디. 마디 시작이 아니라 그 마디 안에 있어도 그 마디의 시작으로 맞춘다. */
export function loopFromBar(t: number, n: number, st: Pick<CopyState, "bpm" | "beatsPerBar" | "offset">, duration: number): { a: number; b: number } {
  const bs = barSeconds(st.bpm, st.beatsPerBar);
  const bar = Math.max(0, barIndexAt(t, st.offset, bs));
  const a = Math.max(0, barStartTime(bar, st.offset, bs));
  const b = Math.min(duration, a + n * bs);
  return { a, b };
}

/** 같은 길이로 다음(또는 이전) 구간. 곡 끝을 넘으면 그대로 둔다. */
export function shiftLoop(loop: { a: number; b: number }, dir: 1 | -1, duration: number): { a: number; b: number } {
  const len = loop.b - loop.a;
  const a = loop.a + dir * len;
  if (a < 0 || a >= duration) return loop;
  return { a, b: Math.min(duration, a + len) };
}

/**
 * 탭 템포. 박에 맞춰 누른 시각들(초)로 BPM 을 짐작한다.
 * 마지막 8번만 보고, 간격의 **중앙값**을 쓴다 (한두 번 늦게 눌러도 안 흔들린다).
 * 누른 횟수가 모자라면(간격 둘 미만) null.
 */
export function tapTempo(times: readonly number[]): number | null {
  const t = times.slice(-8);
  if (t.length < 3) return null;
  const gaps = t.slice(1).map((x, i) => x - t[i]).filter((g) => g > 0.15 && g < 2);
  if (gaps.length < 2) return null;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  const bpm = 60 / mid;
  return Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) * 10) / 10;
}

/** 지금보다 한 단계 빠른 속도. 이미 가장 빠르면 그대로. */
export function nextSpeed(cur: number): number {
  return SPEEDS.find((s) => s > cur + 1e-9) ?? cur;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** 파일마다 따로 저장한다. 이름과 크기가 같으면 같은 파일로 본다. */
export function storageKey(name: string, size: number): string {
  return `pianoroll.copy:${name}:${size}`;
}

// ------------------------------------------------------------------ 읽기 (믿지 않는다)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

export function sanitizeState(raw: unknown, duration = Infinity): CopyState {
  const d = defaultState();
  if (!isObj(raw)) return d;
  const bpm = num(raw.bpm, MIN_BPM, MAX_BPM, d.bpm);
  const st: CopyState = {
    bpm,
    beatsPerBar: Math.round(num(raw.beatsPerBar, 1, 12, d.beatsPerBar)),
    offset: num(raw.offset, 0, Number.isFinite(duration) ? duration : 1e6, d.offset),
    speed: num(raw.speed, 0.25, 2, d.speed),
    loop: null,
    loopOn: raw.loopOn === true,
    ramp: raw.ramp === true,
    markers: [],
    firstBar: Math.round(num(raw.firstBar, 1, 9999, d.firstBar)),
    cells: [],
    overlay: raw.overlay !== false,
    songVolume: num(raw.songVolume, 0, 1, d.songVolume),
    chordVolume: num(raw.chordVolume, 0, 1, d.chordVolume),
  };
  if (isObj(raw.loop)) {
    const a = num(raw.loop.a, 0, 1e6, NaN);
    const b = num(raw.loop.b, 0, 1e6, NaN);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a + 0.05 && a < duration) st.loop = { a, b: Math.min(b, duration) };
  }
  if (!st.loop) st.loopOn = false;
  if (Array.isArray(raw.markers)) {
    for (const m of raw.markers.slice(0, MAX_MARKERS)) {
      if (isObj(m) && typeof m.t === "number" && Number.isFinite(m.t) && m.t >= 0 && m.t <= duration) {
        st.markers.push({ t: m.t, label: typeof m.label === "string" ? m.label.slice(0, 20) : "" });
      }
    }
    st.markers.sort((x, y) => x.t - y.t);
  }
  if (Array.isArray(raw.cells)) st.cells = raw.cells.slice(0, MAX_CELLS).map((c) => (typeof c === "string" ? c.slice(0, 40) : ""));
  while (st.cells.length < 8) st.cells.push("");
  if (isObj(raw.key) && typeof raw.key.tonic === "number" && Number.isInteger(raw.key.tonic) && raw.key.tonic >= 0 && raw.key.tonic < 12 &&
    (raw.key.mode === "major" || raw.key.mode === "minor")) {
    st.key = { tonic: raw.key.tonic, mode: raw.key.mode };
  }
  return st;
}
