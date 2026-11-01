/**
 * 귀 훈련 문제 만들기와 채점.
 *
 * 수업이 말하는 귀 훈련은 「진행을 듣고 몇 도 코드인지 맞히는 것」 이다. 절대음감이 아니라
 * **상대음감** — 조가 뭐든 으뜸음(도)에 대해 어떤 소리인지를 듣는다. 그래서
 *
 *   · 조를 매번 바꿀 수 있게 했다 (C 에서만 들으면 「도 소리」 를 외우게 된다)
 *   · 진행 앞에 으뜸 코드(I)를 한 번 들려준다 — 이 곡의 집이 어디인지 알려 주는 기준이다
 *
 * 화면과 소리는 ui/earTraining.ts 가 맡고, 여기는 **순수 계산**이다 (난수도 바깥에서 받는다).
 * 그래서 node 로 그대로 검사한다.
 */

import { chordPitches, lowRootPitch, progressionPitches, PROGRESSIONS, type ChordSpec } from "./progression.ts";
import { identifyChord, romanNumeral } from "./chord.ts";
import { pcName, type Key, type Mode } from "./scale.ts";

/** 0 이상 1 미만의 난수. 검사에서는 정해진 수열을 넣는다. */
export type Rand = () => number;

export type Level = {
  id: string;
  label: string;
  /** 몇 회차에서 배운 내용이어야 풀 수 있는가 (수업 노트의 진도표 기준, model/lessons.ts) */
  lesson: number;
  /** 어떤 조(장/단)에서 내는가 */
  mode: Mode;
  /**
   * degrees: 코드를 순서대로 몇 도인지 맞힌다.
   * named:   정석 진행의 이름을 고른다.
   * quality: 코드 하나를 듣고 종류(장 · 단 · 감 · 7화음)를 고른다. 으뜸 코드는 들려주지 않는다 —
   *          조와 상관없이 코드 한 개의 생김새를 듣는 훈련이다.
   */
  kind: "degrees" | "named" | "quality";
  /** degrees: 나올 수 있는 도수 (0 = I) */
  pool: number[];
  /** degrees: 코드 개수 */
  length: number;
  /**
   * degrees: 코드 대신 **베이스 음(근음 한 옥타브 아래) 하나씩만** 들려준다. 으뜸 코드(I)는 기준으로 그대로 들려준다.
   * 코드 위의 화음 없이 맨 아래 음만으로 도수를 알아듣는 훈련 — 곡에서 베이스라인을 따는 데 쓴다.
   */
  bassOnly?: boolean;
  /** degrees: 같은 코드가 연달아 나와도 되는가 (I 와 V 둘뿐이라 금지하면 문제가 두 가지밖에 안 나온다) */
  allowRepeat?: boolean;
  /** named: 후보 진행 id */
  names?: string[];
  /** named: 이 진행은 level.lesson 보다 늦은 회차부터 후보에 넣는다 (아직 안 배운 코드가 들어 있어서) */
  nameLesson?: Record<string, number>;
  /** quality: 보기로 나올 종류 id (QUALITIES 의 키, 버튼은 이 순서 그대로) */
  choices?: string[];
};

/**
 * 코드 종류 듣기용 목록. 수업 노트 1회차 「3화음 쌓기」 와 3회차 「7화음」 의 말 그대로다.
 * `how` 는 틀렸을 때 정답 옆에 붙는 한 줄 — 노트에서 반음을 세던 방법과 같다.
 */
export const QUALITIES: Record<string, { label: string; suffix: string; set: readonly number[]; how: string }> = {
  maj: { label: "장3화음", suffix: "", set: [0, 4, 7], how: "근음→3음 반음 4개 + 3음→5음 반음 3개, 밝음" },
  min: { label: "단3화음", suffix: "m", set: [0, 3, 7], how: "근음→3음 반음 3개 + 3음→5음 반음 4개, 어두움" },
  dim: { label: "감3화음", suffix: "dim", set: [0, 3, 6], how: "반음 3개 + 3개 — 근음에서 5음까지 6개라 불안함" },
  maj7: { label: "maj7", suffix: "maj7", set: [0, 4, 7, 11], how: "장3화음 + 7음(근음에서 반음 11개, 한 옥타브 위 근음 바로 아래) — 맑고 부드러움" },
  m7: { label: "m7", suffix: "m7", set: [0, 3, 7, 10], how: "단3화음 + 7음(근음에서 반음 10개) — 어둡지만 부드러움" },
  dom7: { label: "7 (도미넌트7)", suffix: "7", set: [0, 4, 7, 10], how: "장3화음 + 7음(근음에서 반음 10개) — 장3화음인데 집으로 가고 싶은 긴장" },
};

export function qualityLabel(id: string): string {
  return QUALITIES[id]?.label ?? id;
}

/** 근음(음이름 0~11)과 종류 → 음높이들 (낮은 음부터). */
export function qualityPitches(rootPc: number, quality: string): number[] {
  const root = lowRootPitch(rootPc);
  return (QUALITIES[quality]?.set ?? QUALITIES.maj.set).map((i) => root + i);
}

export const LAST_LESSON = 7;

export const LEVELS: readonly Level[] = [
  // ---- 1회차: 코드 기초 · 왕도 · 코무로 · 귀 훈련 맛보기
  { id: "L1", label: "장조 I · IV · V (3코드)", lesson: 1, mode: "major", kind: "degrees", pool: [0, 3, 4], length: 3 },
  { id: "L2", label: "장조 I ii IV V vi (4코드)", lesson: 1, mode: "major", kind: "degrees", pool: [0, 1, 3, 4, 5], length: 4 },
  { id: "L3", label: "장조 일곱 코드 (4코드)", lesson: 1, mode: "major", kind: "degrees", pool: [0, 1, 2, 3, 4, 5, 6], length: 4 },
  { id: "Q1", label: "코드 종류: 장 · 단 구분", lesson: 1, mode: "major", kind: "quality", pool: [], length: 0, choices: ["maj", "min"] },
  { id: "Q2", label: "코드 종류: 장 · 단 · 감 구분", lesson: 1, mode: "major", kind: "quality", pool: [], length: 0, choices: ["maj", "min", "dim"] },
  {
    id: "N1", label: "정석 진행 이름 맞히기 (장조)", lesson: 1, mode: "major", kind: "named", pool: [], length: 0,
    names: ["oudou", "komuro", "doowop", "basic", "canon", "251t", "251"],
    nameLesson: { "251t": 2, "251": 3 },
  },
  // ---- 2회차: 2-5-1 — 귀 훈련 「I 와 V 구분」
  { id: "E2", label: "I 와 V 구분 (장조, 4코드)", lesson: 2, mode: "major", kind: "degrees", pool: [0, 4], length: 4, allowRepeat: true },
  { id: "B1", label: "베이스 음만 듣기: I · IV · V · vi (장조, 3음)", lesson: 2, mode: "major", kind: "degrees", pool: [0, 3, 4, 5], length: 3, bassOnly: true },
  // ---- 3회차: 7화음 — 귀 훈련 「장/단 코드 구분」
  { id: "Q3", label: "7화음 종류: maj7 · m7 · 7 구분", lesson: 3, mode: "major", kind: "quality", pool: [], length: 0, choices: ["maj7", "m7", "dom7"] },
  { id: "B2", label: "베이스 음만 듣기: 일곱 도수 (장조, 4음)", lesson: 3, mode: "major", kind: "degrees", pool: [0, 1, 2, 3, 4, 5, 6], length: 4, bassOnly: true },
  // ---- 4회차: 단조
  { id: "L4", label: "단조 i III iv v VI VII (4코드)", lesson: 4, mode: "minor", kind: "degrees", pool: [0, 2, 3, 4, 5, 6], length: 4 },
  {
    id: "N2", label: "정석 진행 이름 맞히기 (단조)", lesson: 4, mode: "minor", kind: "named", pool: [], length: 0,
    names: ["m-flat", "m-andalus", "m-iv", "m-251"],
  },
  { id: "B3", label: "베이스 음만 듣기: 단조 (4음)", lesson: 4, mode: "minor", kind: "degrees", pool: [0, 2, 3, 4, 5, 6], length: 4, bassOnly: true },
  // ---- 5회차 이후는 노트에 귀 훈련 내용이 따로 적혀 있지 않다. 그 회차의 만들기·이론에서 바뀐 코드를
  //      「귀로 구별하기」 로 옮긴 것이다 (추천일 뿐이다).
  { id: "N3", label: "왕도의 iii 와 III · III7 구분 (장조)", lesson: 5, mode: "major", kind: "named", pool: [], length: 0, names: ["oudou", "oudou-III", "oudou-III7"] },
  { id: "N4", label: "IV 와 빌려 온 IVm 구분 (장조)", lesson: 6, mode: "major", kind: "named", pool: [], length: 0, names: ["basic", "doowop", "borrow-iv", "borrow-iv2"] },
  { id: "N5", label: "같은 뼈대의 색깔 구분: add9 · sus4 (장조)", lesson: 7, mode: "major", kind: "named", pool: [], length: 0, names: ["doowop", "add9-pop", "basic", "sus-v"] },
];

/** 이 회차까지 배웠을 때 풀 수 있는 단계. */
export function levelsForLesson(lesson: number): Level[] {
  return LEVELS.filter((l) => l.lesson <= lesson);
}

/** 이름 맞히기 단계에서 이 회차까지 배운 진행만. */
export function levelNames(level: Level, lesson: number): string[] {
  return (level.names ?? []).filter((n) => (level.nameLesson?.[n] ?? level.lesson) <= lesson);
}

export function levelById(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}

export type Question = {
  level: string;
  key: Key;
  /** degrees: 정답 도수들 */
  degrees: number[];
  /** named: 정답 진행 id, 그리고 화면에 보일 보기(정답 포함, 섞여 있다) */
  progression?: string;
  /** quality: 정답 종류 id (QUALITIES 의 키). 근음은 key.tonic. 보기는 options (단계가 정한 순서 그대로) */
  quality?: string;
  options?: string[];
};

/** 이름·종류 고르기 문제의 정답 (진행 id 또는 종류 id). 도수 문제면 undefined. */
export function namedAnswer(q: Question): string | undefined {
  return q.progression ?? q.quality;
}

function pick<T>(rand: Rand, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
}

/** 가중치대로 뽑는다. 가중치가 없거나 길이가 안 맞으면 그냥 고르게 뽑는다 (난수를 한 번 쓰는 것도 같다). */
function pickWeighted(rand: Rand, list: readonly number[], weights?: readonly number[]): number {
  if (!weights || weights.length !== list.length) return pick(rand, list);
  const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (!(total > 0)) return pick(rand, list);
  let x = rand() * total;
  for (let i = 0; i < list.length; i += 1) {
    x -= Math.max(0, weights[i]);
    if (x < 0) return list[i];
  }
  return list[list.length - 1];
}

function shuffle<T>(rand: Rand, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 으뜸음을 조금씩 달리 — 같은 조가 연달아 나오지 않게 한다. */
function pickKey(rand: Rand, mode: Mode, randomKey: boolean, previous?: Key): Key {
  if (!randomKey) return { tonic: mode === "major" ? 0 : 9, mode };
  let tonic = Math.floor(rand() * 12) % 12;
  if (previous && previous.mode === mode && previous.tonic === tonic) tonic = (tonic + 1 + Math.floor(rand() * 11)) % 12;
  return { tonic, mode };
}

/**
 * 문제 하나.
 *
 * degrees 단계의 규칙
 *   · 같은 코드가 **연달아** 나오지 않는다 (귀로 구별할 게 없다)
 *   · 첫 코드는 으뜸(I)일 때가 많게 한다. 정석 진행이 대개 그렇고, 집에서 출발해 어디로
 *     가는지를 듣는 게 이 훈련의 핵심이다. 그래도 매번은 아니다 (그러면 첫 코드는 외워진다).
 *   · 직전 문제와 똑같은 문제는 내지 않는다
 *
 * @param weights 도수 단계에서 `pool` 과 같은 순서의 가중치. 약한 도수를 더 자주 내고 싶을 때
 *                (model/earStats.ts 의 weakWeights). 없으면 고르게 뽑는다.
 * @param lesson  이름 맞히기에서 이 회차까지 배운 진행만 후보로 쓴다 (기본: 전부)
 */
export function makeQuestion(
  levelId: string,
  rand: Rand,
  randomKey: boolean,
  previous?: Question,
  weights?: readonly number[],
  lesson: number = LAST_LESSON,
): Question {
  const level = levelById(levelId);
  if (!level) throw new Error(`없는 단계: ${levelId}`);
  const key = pickKey(rand, level.mode, randomKey, previous?.key);

  if (level.kind === "quality") {
    // 근음(= key.tonic)과 종류를 정한다. 같은 소리가 연달아 나오지 않게, 직전과 같은 (근음, 종류) 는 피한다.
    const choices = level.choices ?? ["maj"];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const quality = pick(rand, choices);
      const same = previous?.quality === quality && previous.key.tonic === key.tonic;
      if (!same || attempt === 29) return { level: levelId, key, degrees: [], quality, options: [...choices] };
    }
  }

  if (level.kind === "named") {
    const all = levelNames(level, lesson);
    const names = all.length >= 2 ? all : (level.names ?? []);
    let id = pick(rand, names);
    if (previous?.progression === id && names.length > 1) id = pick(rand, names.filter((n) => n !== id));
    const others = shuffle(rand, names.filter((n) => n !== id)).slice(0, 3);
    return { level: levelId, key, degrees: [], progression: id, options: shuffle(rand, [id, ...others]) };
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const degrees: number[] = [];
    for (let i = 0; i < level.length; i += 1) {
      let d: number;
      if (i === 0 && level.pool.includes(0) && rand() < 0.6) d = 0;
      else d = pickWeighted(rand, level.pool, weights);
      let guard = 0;
      while (!level.allowRepeat && i > 0 && d === degrees[i - 1] && guard < 20) {
        d = pickWeighted(rand, level.pool, weights);
        guard += 1;
      }
      degrees.push(d);
    }
    const same =
      previous && previous.level === levelId && previous.degrees.length === degrees.length &&
      previous.degrees.every((x, i) => x === degrees[i]);
    // 같은 코드 연속은 금지 — 단, 둘뿐인 단계(I · V)는 허용하되 전부 같은 코드인 문제는 낸다고 해도 구별할 게 없다
    const repeats = level.allowRepeat
      ? new Set(degrees).size < 2
      : degrees.some((d, i) => i > 0 && d === degrees[i - 1]);
    if (!same && !repeats) return { level: levelId, key, degrees };
  }
  // 풀이 너무 작아 못 만든 경우는 없지만, 무한히 돌지 않게 마지막 안전장치.
  return { level: levelId, key, degrees: Array.from({ length: level.length }, (_, i) => level.pool[i % level.pool.length]) };
}

/** 들려줄 코드들 (음높이). `tonic` 은 기준으로 먼저 들려줄 으뜸 코드. */
export function questionChords(q: Question): { tonic: number[]; chords: number[][] } {
  // 코드 종류 문제: 으뜸 코드 없이 코드 하나만 (비어 있는 tonic = 먼저 들려줄 게 없다)
  if (q.quality) return { tonic: [], chords: [qualityPitches(q.key.tonic, q.quality)] };
  const tonicSpec: ChordSpec = { degree: 0 };
  const tonic = chordPitches(q.key, tonicSpec);
  if (q.progression) {
    const prog = PROGRESSIONS.find((p) => p.id === q.progression);
    return { tonic, chords: prog ? progressionPitches(q.key, prog) : [] };
  }
  return { tonic, chords: q.degrees.map((degree) => chordPitches(q.key, { degree })) };
}

export type Grade = {
  correct: boolean;
  /** degrees: 칸마다 맞았는가. named: 길이 1. */
  marks: boolean[];
};

/** degrees 는 도수 배열, named · quality 는 id 하나가 답이다. */
export function grade(q: Question, answer: readonly number[] | string): Grade {
  const want = namedAnswer(q);
  if (want !== undefined) {
    const ok = answer === want;
    return { correct: ok, marks: [ok] };
  }
  const a = Array.isArray(answer) ? (answer as readonly number[]) : [];
  const marks = q.degrees.map((d, i) => a[i] === d);
  return { correct: a.length === q.degrees.length && marks.every(Boolean), marks };
}

/** 로마숫자 한 칸의 글자. 도수 → 「vi」「vii°」. 단조는 자연단음계 기준이다. */
export function degreeNumeral(mode: Mode, degree: number): string {
  const key: Key = { tonic: mode === "major" ? 0 : 9, mode };
  const p = chordPitches(key, { degree });
  const info = identifyChord(p, key);
  return info ? romanNumeral(info, p, key).numeral : "?";
}

/** 정답을 사람 말로: 「IV V iii vi = F G Em Am」 */
export function describeAnswer(q: Question): string {
  if (q.quality) {
    const info = QUALITIES[q.quality];
    // 이름은 화면의 다른 곳(코드 이름 읽기)과 같은 철자 규칙으로 붙인다 — 같은 소리가 두 가지 이름으로 보이면 헷갈린다.
    const read = identifyChord(qualityPitches(q.key.tonic, q.quality));
    const name = read?.base ?? `${pcName(q.key.tonic)}${info?.suffix ?? ""}`;
    return `${name} — ${info?.label ?? q.quality} (${info?.how ?? ""})`;
  }
  const { chords } = questionChords(q);
  const names = chords.map((p) => identifyChord(p, q.key)?.name ?? "?");
  const romans = chords.map((p) => {
    const info = identifyChord(p, q.key);
    return info ? romanNumeral(info, p, q.key).numeral : "?";
  });
  return `${romans.join(" ")} = ${names.join(" ")}`;
}
