/**
 * 곡의 시간 — 마디가 어디서 시작하는지, 몇 박이 몇 초인지.
 *
 * 곡이 한 박자·한 빠르기로만 가던 때는 `마디 = 박 ÷ beatsPerBar`, `초 = 박 × 60 ÷ bpm` 이면
 * 끝났다. 변박과 템포 변화가 생기면 그 두 식이 곳곳에서 틀린다 (피아노롤 마디선, 재생 헤드,
 * 메트로놈, 복사·붙여넣기, 내보내기 …). 그래서 **시간에 관한 계산은 전부 여기서만** 한다.
 *
 *   · 박(beat)은 4분음표 하나다. 노트의 자리와 길이는 언제나 박이다 — 템포가 바뀌어도 노트는
 *     그대로고, 소리 나는 초만 달라진다.
 *   · 변박은 **마디 경계**에서만 바뀐다 (악보처럼). 한 마디의 길이는 `분자 × 4 ÷ 분모` 박이다.
 *       4/4 = 4박   3/4 = 3박   6/8 = 3박   7/8 = 3.5박   5/4 = 5박
 *   · 템포는 **계단식**이다. 그 박부터 새 BPM 으로 바뀐다 (서서히 느려지는 건 아직 없다).
 *
 * 변박·템포 변화가 없는 곡(예전 파일 전부)은 옛 식과 **정확히 같은 값**이 나온다 — 이 파일이
 * 틀리면 기존 곡이 먼저 어긋나므로, 그 동치를 theory-test 가 따로 못박는다.
 *
 * 순수 계산이다 (브라우저 없이 node 로 검사한다).
 */

import type { MeterChange, Project, TempoChange } from "./types.ts";

export type Sig = [number, number];

/** 박자 하나의 한 마디 길이(박). 4/4 → 4, 6/8 → 3, 7/8 → 3.5 */
export function sigBeats(sig: Sig): number {
  return (sig[0] * 4) / sig[1];
}

const MIN_BPM = 20;
const EPS = 1e-9;

type Run = { fromBar: number; sig: Sig; len: number; startBeat: number };
type Seg = { beat: number; bpm: number; sec: number };
type Cache = { key: string; runs: Run[]; segs: Seg[]; total: number };

const cache = new WeakMap<Project, Cache>();

function keyOf(p: Project): string {
  return JSON.stringify([p.bpm, p.bars, p.timeSig, p.meterChanges ?? null, p.tempoChanges ?? null]);
}

/** 쓸 수 있는 변박만, 마디 순으로. 이상한 값(0마디 · 중복 · 소수)은 건너뛴다 — 계산이 터지지 않게. */
function cleanMeters(list: readonly MeterChange[] | undefined): MeterChange[] {
  const out: MeterChange[] = [];
  for (const m of [...(list ?? [])].sort((a, b) => a.bar - b.bar)) {
    if (!Number.isInteger(m.bar) || m.bar < 1) continue;
    if (out.length > 0 && out[out.length - 1].bar === m.bar) continue;
    if (!(m.sig[0] > 0) || !(m.sig[1] > 0)) continue;
    out.push(m);
  }
  return out;
}

function cleanTempos(list: readonly TempoChange[] | undefined): TempoChange[] {
  const out: TempoChange[] = [];
  for (const t of [...(list ?? [])].sort((a, b) => a.beat - b.beat)) {
    if (!(t.beat > 0) || !(t.bpm > 0)) continue;
    if (out.length > 0 && Math.abs(out[out.length - 1].beat - t.beat) < EPS) continue;
    out.push(t);
  }
  return out;
}

function build(project: Project): Cache {
  const hit = cache.get(project);
  const key = keyOf(project);
  if (hit && hit.key === key) return hit;

  // 마디 구간들: 박자가 같은 마디가 이어지는 동안이 한 구간이다.
  const runs: Run[] = [];
  const first: Sig = [project.timeSig[0], project.timeSig[1]];
  runs.push({ fromBar: 0, sig: first, len: sigBeats(first), startBeat: 0 });
  for (const m of cleanMeters(project.meterChanges)) {
    const prev = runs[runs.length - 1];
    const startBeat = prev.startBeat + (m.bar - prev.fromBar) * prev.len;
    runs.push({ fromBar: m.bar, sig: [m.sig[0], m.sig[1]], len: sigBeats(m.sig), startBeat });
  }

  // 템포 구간들: 누적 초를 미리 계산해 둔다.
  const segs: Seg[] = [{ beat: 0, bpm: Math.max(MIN_BPM, project.bpm), sec: 0 }];
  for (const t of cleanTempos(project.tempoChanges)) {
    const prev = segs[segs.length - 1];
    segs.push({ beat: t.beat, bpm: Math.max(MIN_BPM, t.bpm), sec: prev.sec + ((t.beat - prev.beat) * 60) / prev.bpm });
  }

  // 곡 끝 = 마지막 마디(bars - 1) 다음 마디가 시작하는 자리. 변박이 곡 끝 뒤에 걸려 있어도
  // (마디 수를 줄였을 때) 곡 끝이 속한 구간으로 센다.
  const endRun = runOfBar(runs, project.bars);
  const total = endRun.startBeat + (project.bars - endRun.fromBar) * endRun.len;
  const built = { key, runs, segs, total: Math.max(0, total) };
  cache.set(project, built);
  return built;
}

function runOfBar(runs: Run[], bar: number): Run {
  let r = runs[0];
  for (const x of runs) {
    if (x.fromBar <= bar) r = x;
    else break;
  }
  return r;
}

// ------------------------------------------------------------------ 마디

/** 곡 전체 길이(박). */
export function totalBeats(project: Project): number {
  return build(project).total;
}

/** `bar` 마디(0부터)의 박자. 곡 끝을 넘어선 마디는 마지막 박자를 이어 간다 (마디를 늘렸을 때의 모양). */
export function sigAtBar(project: Project, bar: number): Sig {
  return runOfBar(build(project).runs, Math.max(0, bar)).sig;
}

/** `bar` 마디가 시작하는 박. 곡 끝을 넘어선 마디도 마지막 박자로 이어 센다. */
export function barStartBeat(project: Project, bar: number): number {
  const b = Math.max(0, bar);
  const r = runOfBar(build(project).runs, b);
  return r.startBeat + (b - r.fromBar) * r.len;
}

/** `bar` 마디의 길이(박). */
export function barLength(project: Project, bar: number): number {
  return runOfBar(build(project).runs, Math.max(0, bar)).len;
}

/** 이 박이 몇 번째 마디(0부터)인가. 마디선 위의 박은 **그 마디**에 속한다. */
export function barIndexAt(project: Project, beat: number): number {
  if (beat <= 0) return 0;
  const runs = build(project).runs;
  let r = runs[0];
  for (const x of runs) {
    if (x.startBeat <= beat + EPS) r = x;
    else break;
  }
  return r.fromBar + Math.floor((beat - r.startBeat) / r.len + EPS);
}

/** 이 박이 든 마디의 [시작, 끝) 박과 번호. */
export function barAt(project: Project, beat: number): { index: number; start: number; end: number; sig: Sig } {
  const index = barIndexAt(project, beat);
  const start = barStartBeat(project, index);
  return { index, start, end: start + barLength(project, index), sig: sigAtBar(project, index) };
}

/** 변박이 하나라도 있는가. 없으면 모든 마디가 같은 길이다. */
export function hasMeterChanges(project: Project): boolean {
  return build(project).runs.length > 1;
}

/** 곡 처음 박자 말고 따로 바뀐 박자 목록 (정리된 것). */
export function meterChangeList(project: Project): MeterChange[] {
  return cleanMeters(project.meterChanges);
}

/** 템포 변화 목록 (정리된 것). */
export function tempoChangeList(project: Project): TempoChange[] {
  return cleanTempos(project.tempoChanges);
}

/**
 * 메트로놈이 칠 틱 — **마디마다 그 마디의 첫 박부터** 4분음표 간격이다.
 * 7/8 (3.5박) 마디 다음 마디는 정수 박이 아닌 자리(3.5)에서 시작하므로, 곡 전체의 정수 박에 칠 수 없다.
 * `beat` 이상에서 처음 오는 틱의 자리를 돌려준다.
 */
export function clickAtOrAfter(project: Project, beat: number): number {
  const b = Math.max(0, beat);
  const bar = barAt(project, b);
  const k = Math.ceil(b - bar.start - 1e-6);
  const at = bar.start + k;
  if (at < bar.end - 1e-6) return at;
  return bar.end;
}

/** 방금 친 틱 다음 틱. */
export function nextClick(project: Project, beat: number): number {
  const bar = barAt(project, beat + 1e-6);
  const next = beat + 1;
  return next < bar.end - 1e-6 ? next : bar.end;
}

/** 이 자리가 마디의 첫 박인가 (메트로놈의 높은 틱). */
export function isBarStart(project: Project, beat: number): boolean {
  const bar = barAt(project, beat + 1e-6);
  return Math.abs(beat - bar.start) < 1e-6;
}

// ------------------------------------------------------------------ 시간

function segOfBeat(segs: Seg[], beat: number): Seg {
  let s = segs[0];
  for (const x of segs) {
    if (x.beat <= beat + EPS) s = x;
    else break;
  }
  return s;
}

/** 그 박의 빠르기. 템포가 바뀌는 박 위에서는 **새** 빠르기다. */
export function bpmAt(project: Project, beat: number): number {
  return segOfBeat(build(project).segs, beat).bpm;
}

/** 곡 처음(0박)부터 그 박까지 몇 초. */
export function beatToSec(project: Project, beat: number): number {
  const b = Math.max(0, beat);
  const s = segOfBeat(build(project).segs, b);
  return s.sec + ((b - s.beat) * 60) / s.bpm;
}

/** 곡 처음부터 `sec` 초 지난 자리는 몇 박. beatToSec 의 거꾸로. */
export function secToBeat(project: Project, sec: number): number {
  const t = Math.max(0, sec);
  const segs = build(project).segs;
  let s = segs[0];
  for (const x of segs) {
    if (x.sec <= t + EPS) s = x;
    else break;
  }
  return s.beat + ((t - s.sec) * s.bpm) / 60;
}

/** `from` 박에서 `to` 박까지 몇 초 (to 가 앞이면 음수). */
export function secondsBetween(project: Project, from: number, to: number): number {
  return beatToSec(project, to) - beatToSec(project, from);
}

/** 곡 전체 길이(초). 꼬리 여유는 안 더했다. */
export function totalSeconds(project: Project): number {
  return beatToSec(project, totalBeats(project));
}

/** 화면용: 「3 : 2」 — 마디 번호(1부터)와 그 마디 안의 박(1부터). */
export function barBeatLabel(project: Project, beat: number): string {
  const bar = barAt(project, Math.max(0, beat));
  const inBar = Math.floor(Math.max(0, beat - bar.start) + 1e-6) + 1;
  return `${bar.index + 1} : ${inBar}`;
}

/** 박자를 사람 말로. 「3/4」 */
export function sigLabel(sig: Sig): string {
  return `${sig[0]}/${sig[1]}`;
}

/** 앞 마디와 같은 박자로 「바뀌는」 항목은 뺀다. 3/4 → 3/4 는 변박이 아니다. */
export function dropRedundantMeters(first: Sig, list: MeterChange[]): MeterChange[] {
  const out: MeterChange[] = [];
  let cur: Sig = first;
  for (const m of list) {
    if (m.sig[0] === cur[0] && m.sig[1] === cur[1]) continue;
    out.push(m);
    cur = m.sig;
  }
  return out;
}

