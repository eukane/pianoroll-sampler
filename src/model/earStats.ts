/**
 * 귀 훈련 기록 — 순수 계산 (저장소는 건드리지 않는다. 읽고 쓰는 건 화면 쪽이 한다).
 *
 * 「몇 문제 맞혔나」 만으로는 공부가 안 된다. 어디가 약한지를 알아야 거기를 더 듣는다.
 * 그래서 문제를 풀 때마다 **칸 하나하나**를 기록한다.
 *
 *   · 도수별 정답률      — I 는 잘 맞히는데 vi 는 반도 못 맞힌다 …
 *   · 헷갈린 쌍          — 「vi 를 iii 로 답했다」 가 몇 번인가 (귀가 어디서 섞이는지)
 *   · 정석 진행별 정답률 — 이름 맞히기 단계
 *   · 하루 풀이 수 · 연속 일수 — 매일 조금씩 하게 만드는 용도
 *   · 틀린 문제 목록     — 창을 닫아도 남는다
 *
 * 저장된 값은 사람이 못 믿을 수 있다 (옛 버전 · 깨진 JSON · 손으로 고친 값). `sanitizeStore` 가
 * 모양이 이상한 건 버리고 쓸 수 있는 것만 남긴다.
 */

import { LAST_LESSON, LEVELS, QUALITIES, levelById, namedAnswer, type Question } from "./ear.ts";
import { clampLesson } from "./lessons.ts";
import { PROGRESSIONS } from "./progression.ts";
import type { Mode } from "./scale.ts";

export type Tally = { right: number; total: number };

/** 한 조(장/단)의 도수별 기록. 배열 길이는 7 (I~VII). */
export type DegreeStats = { asked: number[]; right: number[] };

export type EarStore = {
  level?: string;
  /** 단계별 문제 수 (칸이 아니라 문제 단위) */
  tally: Record<string, Tally>;
  degrees: Record<Mode, DegreeStats>;
  /**
   * 헷갈린 쌍 (정답>내 답) 횟수.
   *   「major:5>2」 장조에서 vi 인데 iii 로 답함 · 「q:maj>min」 장3화음을 단3화음으로 ·
   *   「p:oudou>komuro」 왕도를 코무로로
   */
  confusions: Record<string, number>;
  /** 정석 진행 id → 맞힘/풂 */
  progs: Record<string, Tally>;
  /** 코드 종류 id(maj · min · dim · maj7 · m7 · dom7) → 맞힘/풂 */
  quals: Record<string, Tally>;
  /** 「2026-11-01」 → 그날 푼 문제 */
  days: Record<string, Tally>;
  /** 틀린 문제 (오래된 것이 앞) */
  wrong: Question[];
  /**
   * 틀린 문제의 복습 일정 (간격 반복). 키는 questionId.
   * box = 복습에서 날을 달리해 맞힌 횟수(0~2), due = 이 날부터 복습할 차례 (「2026-11-02」).
   * 세 번째로 맞히면 목록에서 졸업한다.
   */
  srs: Record<string, { box: number; due: string }>;
  /** 하루 목표 문제 수 */
  goal: number;
  /** 수업에서 여기(회차)까지 배웠다 — 이 회차까지의 단계와 진행만 나온다 (1~7, 7 = 전부) */
  lesson: number;
  /** 약한 도수를 더 자주 낸다 */
  focusWeak: boolean;
  /** 조를 매번 바꾼다 */
  randomKey: boolean;
  /** GM 프로그램 번호 (사운드폰트가 있을 때 고른 악기). 없으면 첫 피아노. */
  instrument?: number;
};

export const MAX_WRONG = 30;
/** 복습에서 맞힐 때마다 다음 복습까지 며칠. 마지막 칸을 맞히면 졸업. */
export const REVIEW_DAYS = [1, 3] as const;
export const MAX_DAYS = 400;
export const GOALS = [10, 20, 30, 50] as const;

function emptyDegrees(): DegreeStats {
  return { asked: Array(7).fill(0), right: Array(7).fill(0) };
}

export function emptyStore(): EarStore {
  return {
    tally: {},
    degrees: { major: emptyDegrees(), minor: emptyDegrees() },
    confusions: {},
    progs: {},
    quals: {},
    days: {},
    wrong: [],
    srs: {},
    goal: 20,
    lesson: LAST_LESSON,
    focusWeak: false,
    randomKey: true,
  };
}

/** 헷갈린 쌍의 열쇠가 알려진 모양인가 (모르는 종류·진행 id 는 버린다) */
function isConfusionKey(k: string): boolean {
  if (/^(major|minor):[0-6]>[0-6]$/.test(k)) return true;
  const m = /^(q|p):([\w-]+)>([\w-]+)$/.exec(k);
  if (!m) return false;
  const known = m[1] === "q" ? Object.keys(QUALITIES) : PROGRESSIONS.map((p) => p.id);
  return known.includes(m[2]) && known.includes(m[3]);
}

// ------------------------------------------------------------------ 읽기 (믿지 않는다)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function sanitizeTally(v: unknown): Tally {
  const t = isObj(v) ? v : {};
  const total = count(t.total);
  return { right: Math.min(count(t.right), total), total };
}

function sanitizeDegrees(v: unknown): DegreeStats {
  const out = emptyDegrees();
  if (!isObj(v)) return out;
  for (let i = 0; i < 7; i += 1) {
    const a = Array.isArray(v.asked) ? count(v.asked[i]) : 0;
    const r = Array.isArray(v.right) ? count(v.right[i]) : 0;
    out.asked[i] = a;
    out.right[i] = Math.min(r, a);
  }
  return out;
}

/** 저장된 문제 하나. 단계가 없어졌거나 도수가 풀 밖이면 버린다. */
export function sanitizeQuestion(v: unknown): Question | null {
  if (!isObj(v) || typeof v.level !== "string") return null;
  const level = levelById(v.level);
  if (!level || !isObj(v.key)) return null;
  const tonic = v.key.tonic;
  if (typeof tonic !== "number" || !Number.isInteger(tonic) || tonic < 0 || tonic > 11) return null;
  if (v.key.mode !== level.mode) return null;
  const key = { tonic, mode: level.mode };
  const strings = (x: unknown, allowed: readonly string[]) =>
    Array.isArray(x) ? x.filter((o): o is string => typeof o === "string" && allowed.includes(o)) : [];
  if (level.kind === "named") {
    const id = v.progression;
    if (typeof id !== "string" || !level.names?.includes(id)) return null;
    const opts = strings(v.options, level.names);
    if (!opts.includes(id)) return null;
    return { level: level.id, key, degrees: [], progression: id, options: [...new Set(opts)] };
  }
  if (level.kind === "quality") {
    const id = v.quality;
    const choices = level.choices ?? [];
    if (typeof id !== "string" || !choices.includes(id)) return null;
    return { level: level.id, key, degrees: [], quality: id, options: [...choices] };
  }
  const d = v.degrees;
  if (!Array.isArray(d) || d.length !== level.length) return null;
  if (!d.every((x) => typeof x === "number" && level.pool.includes(x))) return null;
  return { level: level.id, key, degrees: [...d] as number[] };
}

export function sanitizeStore(raw: unknown): EarStore {
  const s = emptyStore();
  if (!isObj(raw)) return s;

  if (typeof raw.level === "string" && levelById(raw.level)) s.level = raw.level;
  if (isObj(raw.tally)) {
    for (const l of LEVELS) if (raw.tally[l.id] !== undefined) s.tally[l.id] = sanitizeTally(raw.tally[l.id]);
  }
  if (isObj(raw.degrees)) {
    s.degrees.major = sanitizeDegrees(raw.degrees.major);
    s.degrees.minor = sanitizeDegrees(raw.degrees.minor);
  }
  if (isObj(raw.confusions)) {
    for (const [k, n] of Object.entries(raw.confusions)) {
      if (isConfusionKey(k) && count(n) > 0) s.confusions[k] = count(n);
    }
  }
  if (isObj(raw.progs)) {
    for (const p of PROGRESSIONS) if (raw.progs[p.id] !== undefined) s.progs[p.id] = sanitizeTally(raw.progs[p.id]);
  }
  if (isObj(raw.quals)) {
    for (const id of Object.keys(QUALITIES)) if (raw.quals[id] !== undefined) s.quals[id] = sanitizeTally(raw.quals[id]);
  }
  if (isObj(raw.days)) {
    const keys = Object.keys(raw.days).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    for (const k of keys.slice(-MAX_DAYS)) s.days[k] = sanitizeTally(raw.days[k]);
  }
  if (Array.isArray(raw.wrong)) {
    const seen = new Set<string>();
    for (const w of raw.wrong) {
      const q = sanitizeQuestion(w);
      if (q && !seen.has(questionId(q))) {
        seen.add(questionId(q));
        s.wrong.push(q);
      }
    }
    s.wrong = s.wrong.slice(-MAX_WRONG);
  }
  const ids = new Set(s.wrong.map(questionId));
  if (isObj(raw.srs)) {
    for (const [k, v] of Object.entries(raw.srs)) {
      if (!ids.has(k) || !isObj(v)) continue;
      const box = typeof v.box === "number" && Number.isInteger(v.box) && v.box >= 0 && v.box <= REVIEW_DAYS.length ? v.box : 0;
      if (typeof v.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.due)) s.srs[k] = { box, due: v.due };
    }
  }
  s.lesson = clampLesson(raw.lesson);
  if (typeof raw.goal === "number" && (GOALS as readonly number[]).includes(raw.goal)) s.goal = raw.goal;
  if (typeof raw.focusWeak === "boolean") s.focusWeak = raw.focusWeak;
  if (typeof raw.randomKey === "boolean") s.randomKey = raw.randomKey;
  if (typeof raw.instrument === "number" && Number.isInteger(raw.instrument) && raw.instrument >= 0 && raw.instrument < 128) {
    s.instrument = raw.instrument;
  }
  return s;
}

// ------------------------------------------------------------------ 날짜

/** 이 기기의 날짜 기준 「2026-11-01」. 자정이 지나면 새 날이다 (UTC 가 아니다). */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * 연속으로 푼 날 수.
 * 오늘 아직 안 풀었어도 어제까지 이어졌다면 끊긴 게 아니다 (하루가 끝나기 전에는 잇는 중).
 */
export function streak(days: Record<string, Tally>, today: Date): number {
  const did = (d: Date) => (days[dayKey(d)]?.total ?? 0) > 0;
  let cursor = did(today) ? today : addDays(today, -1);
  let n = 0;
  while (did(cursor)) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

// ------------------------------------------------------------------ 쓰기

/** 같은 문제인가 (틀린 문제 목록에서 중복을 막는 용도) */
export function questionId(q: Question): string {
  const named = namedAnswer(q);
  return named !== undefined
    ? `${q.level}|${q.key.tonic}|${named}`
    : `${q.level}|${q.key.tonic}|${q.degrees.join(",")}`;
}

/**
 * 문제 하나를 풀었다.
 *
 * @param answer 도수 단계는 고른 도수 배열, 이름 단계는 고른 진행 id
 * @param correct 채점 결과 (ear.ts 의 grade)
 *
 * 문제 단위 기록(단계 · 하루)과 칸 단위 기록(도수 · 헷갈림)을 같이 남긴다. 틀리면 틀린 문제
 * 목록에 넣고, 맞히면 같은 문제가 목록에 있었을 때 뺀다 (복습으로 맞힌 문제는 졸업).
 */
export function recordAnswer(
  store: EarStore,
  q: Question,
  answer: readonly number[] | string,
  correct: boolean,
  today: Date,
): EarStore {
  const level = levelById(q.level);
  if (!level) return store;

  const bump = (t: Tally | undefined): Tally => ({ right: (t?.right ?? 0) + (correct ? 1 : 0), total: (t?.total ?? 0) + 1 });
  store.tally[q.level] = bump(store.tally[q.level]);
  const dk = dayKey(today);
  store.days[dk] = bump(store.days[dk]);
  const dayKeys = Object.keys(store.days).sort();
  for (const k of dayKeys.slice(0, Math.max(0, dayKeys.length - MAX_DAYS))) delete store.days[k];

  if (q.progression || q.quality) {
    const want = (q.progression ?? q.quality) as string;
    const book = q.progression ? store.progs : store.quals;
    book[want] = bump(book[want]);
    if (!correct && typeof answer === "string") {
      const key = `${q.progression ? "p" : "q"}:${want}>${answer}`;
      if (isConfusionKey(key)) store.confusions[key] = (store.confusions[key] ?? 0) + 1;
    }
  } else if (Array.isArray(answer)) {
    const stats = store.degrees[level.mode];
    q.degrees.forEach((d, i) => {
      const a = answer[i];
      stats.asked[d] += 1;
      if (a === d) stats.right[d] += 1;
      else if (typeof a === "number") {
        const key = `${level.mode}:${d}>${a}`;
        store.confusions[key] = (store.confusions[key] ?? 0) + 1;
      }
    });
  }

  const id = questionId(q);
  const listed = store.wrong.some((w) => questionId(w) === id);
  const todayKey = dayKey(today);
  if (!correct) {
    // 틀리면 처음부터: 오늘 바로 복습 대상
    store.wrong = store.wrong.filter((w) => questionId(w) !== id);
    store.wrong.push(q);
    store.srs[id] = { box: 0, due: todayKey };
  } else if (listed) {
    const cur = store.srs[id] ?? { box: 0, due: todayKey };
    if (cur.due <= todayKey) {
      // 차례가 된 복습을 맞혔다: 다음 간격으로. 마지막 간격까지 맞히면 졸업.
      if (cur.box >= REVIEW_DAYS.length) {
        store.wrong = store.wrong.filter((w) => questionId(w) !== id);
        delete store.srs[id];
      } else {
        store.srs[id] = { box: cur.box + 1, due: dayKey(addDays(today, REVIEW_DAYS[cur.box])) };
      }
    }
    // 아직 차례가 아닌데 맞힌 건(미리 해 본 연습) 일정을 앞당기지 않는다.
  }
  store.wrong = store.wrong.slice(-MAX_WRONG);
  const keep = new Set(store.wrong.map(questionId));
  for (const k of Object.keys(store.srs)) if (!keep.has(k)) delete store.srs[k];
  return store;
}

/** 오늘 복습할 차례인 틀린 문제들 (오래된 것이 앞). 일정이 없는 문제는 차례로 본다. */
export function dueWrong(store: EarStore, today: Date): Question[] {
  const t = dayKey(today);
  return store.wrong.filter((w) => (store.srs[questionId(w)]?.due ?? t) <= t);
}

/** 아직 차례가 안 된 문제 중 가장 빠른 복습 날 (없으면 null) */
export function nextDue(store: EarStore, today: Date): string | null {
  const t = dayKey(today);
  const days = store.wrong.map((w) => store.srs[questionId(w)]?.due).filter((d): d is string => !!d && d > t).sort();
  return days[0] ?? null;
}

// ------------------------------------------------------------------ 읽어서 보여 주기

export type DegreeRow = { degree: number; asked: number; right: number; rate: number | null };

/** 도수별 정답률. 한 번도 안 나온 도수는 rate 가 null (0% 와 다르다). */
export function degreeRows(store: EarStore, mode: Mode, pool: readonly number[]): DegreeRow[] {
  const s = store.degrees[mode];
  return pool.map((degree) => ({
    degree,
    asked: s.asked[degree],
    right: s.right[degree],
    rate: s.asked[degree] > 0 ? s.right[degree] / s.asked[degree] : null,
  }));
}

export type Confusion = { asked: number; answered: number; count: number };

/** 가장 많이 헷갈린 쌍. 많은 순, 같으면 도수 순. */
export function topConfusions(store: EarStore, mode: Mode, limit = 5): Confusion[] {
  const out: Confusion[] = [];
  for (const [k, n] of Object.entries(store.confusions)) {
    const m = /^(major|minor):([0-6])>([0-6])$/.exec(k);
    if (!m || m[1] !== mode) continue;
    out.push({ asked: Number(m[2]), answered: Number(m[3]), count: n });
  }
  out.sort((a, b) => b.count - a.count || a.asked - b.asked || a.answered - b.answered);
  return out.slice(0, limit);
}

export type NamedConfusion = { asked: string; answered: string; count: number };

/** 진행 이름(`p`) 또는 코드 종류(`q`) 를 헷갈린 쌍. 많은 순. */
export function namedConfusions(store: EarStore, kind: "p" | "q", limit = 5): NamedConfusion[] {
  const out: NamedConfusion[] = [];
  for (const [k, n] of Object.entries(store.confusions)) {
    const m = /^(q|p):([\w-]+)>([\w-]+)$/.exec(k);
    if (m && m[1] === kind) out.push({ asked: m[2], answered: m[3], count: n });
  }
  out.sort((a, b) => b.count - a.count || a.asked.localeCompare(b.asked) || a.answered.localeCompare(b.answered));
  return out.slice(0, limit);
}

/** 이 정도는 풀어 봐야 약하다 강하다를 말할 수 있다 */
export const MIN_SAMPLE = 4;

/**
 * 약한 도수를 더 자주 내기 위한 가중치 (풀 `pool` 과 같은 순서).
 * 정답률 100% → 1, 0% → 4. 표본이 모자란 도수는 1 (아직 모른다).
 */
export function weakWeights(store: EarStore, mode: Mode, pool: readonly number[]): number[] {
  return degreeRows(store, mode, pool).map((r) => (r.rate === null || r.asked < MIN_SAMPLE ? 1 : 1 + 3 * (1 - r.rate)));
}

/** 가장 약한 도수 (표본이 충분한 것 중 정답률이 가장 낮고 100% 가 아닌 것). 없으면 null. */
export function weakest(store: EarStore, mode: Mode, pool: readonly number[]): DegreeRow | null {
  const rows = degreeRows(store, mode, pool).filter((r) => r.rate !== null && r.asked >= MIN_SAMPLE && r.rate < 1);
  rows.sort((a, b) => (a.rate as number) - (b.rate as number) || b.asked - a.asked);
  return rows[0] ?? null;
}
