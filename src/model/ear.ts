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

import { chordPitches, progressionPitches, PROGRESSIONS, type ChordSpec } from "./progression.ts";
import { identifyChord, romanNumeral } from "./chord.ts";
import type { Key, Mode } from "./scale.ts";

/** 0 이상 1 미만의 난수. 검사에서는 정해진 수열을 넣는다. */
export type Rand = () => number;

export type Level = {
  id: string;
  label: string;
  /** 어떤 조(장/단)에서 내는가 */
  mode: Mode;
  /**
   * degrees: 코드를 순서대로 몇 도인지 맞힌다.
   * named:   정석 진행의 이름을 고른다.
   */
  kind: "degrees" | "named";
  /** degrees: 나올 수 있는 도수 (0 = I) */
  pool: number[];
  /** degrees: 코드 개수 */
  length: number;
  /** named: 후보 진행 id */
  names?: string[];
};

export const LEVELS: readonly Level[] = [
  { id: "L1", label: "1단계 — 장조 I · IV · V (3코드)", mode: "major", kind: "degrees", pool: [0, 3, 4], length: 3 },
  { id: "L2", label: "2단계 — 장조 I ii IV V vi (4코드)", mode: "major", kind: "degrees", pool: [0, 1, 3, 4, 5], length: 4 },
  { id: "L3", label: "3단계 — 장조 일곱 코드 (4코드)", mode: "major", kind: "degrees", pool: [0, 1, 2, 3, 4, 5, 6], length: 4 },
  { id: "L4", label: "4단계 — 단조 i III iv v VI VII (4코드)", mode: "minor", kind: "degrees", pool: [0, 2, 3, 4, 5, 6], length: 4 },
  {
    id: "N1", label: "정석 진행 이름 맞히기 (장조)", mode: "major", kind: "named", pool: [], length: 0,
    names: ["oudou", "komuro", "doowop", "basic", "251", "canon"],
  },
  {
    id: "N2", label: "정석 진행 이름 맞히기 (단조)", mode: "minor", kind: "named", pool: [], length: 0,
    names: ["m-flat", "m-andalus", "m-iv", "m-251"],
  },
];

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
  options?: string[];
};

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
 */
export function makeQuestion(
  levelId: string,
  rand: Rand,
  randomKey: boolean,
  previous?: Question,
  weights?: readonly number[],
): Question {
  const level = levelById(levelId);
  if (!level) throw new Error(`없는 단계: ${levelId}`);
  const key = pickKey(rand, level.mode, randomKey, previous?.key);

  if (level.kind === "named") {
    const names = level.names ?? [];
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
      while (i > 0 && d === degrees[i - 1] && guard < 20) {
        d = pickWeighted(rand, level.pool, weights);
        guard += 1;
      }
      degrees.push(d);
    }
    const same =
      previous && previous.level === levelId && previous.degrees.length === degrees.length &&
      previous.degrees.every((x, i) => x === degrees[i]);
    const repeats = degrees.some((d, i) => i > 0 && d === degrees[i - 1]);
    if (!same && !repeats) return { level: levelId, key, degrees };
  }
  // 풀이 너무 작아 못 만든 경우는 없지만, 무한히 돌지 않게 마지막 안전장치.
  return { level: levelId, key, degrees: Array.from({ length: level.length }, (_, i) => level.pool[i % level.pool.length]) };
}

/** 들려줄 코드들 (음높이). `tonic` 은 기준으로 먼저 들려줄 으뜸 코드. */
export function questionChords(q: Question): { tonic: number[]; chords: number[][] } {
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

/** degrees 는 도수 배열, named 는 진행 id 하나가 답이다. */
export function grade(q: Question, answer: readonly number[] | string): Grade {
  if (q.progression) {
    const ok = answer === q.progression;
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
  const { chords } = questionChords(q);
  const names = chords.map((p) => identifyChord(p, q.key)?.name ?? "?");
  const romans = chords.map((p) => {
    const info = identifyChord(p, q.key);
    return info ? romanNumeral(info, p, q.key).numeral : "?";
  });
  return `${romans.join(" ")} = ${names.join(" ")}`;
}
