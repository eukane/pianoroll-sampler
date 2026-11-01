/**
 * 키 옮기기 퀴즈 (순수).
 *
 * 「C 장조의 F G Em Am 을 E♭ 장조로 옮기면?」 — 곡의 조를 바꿔 적는 일은 도수(로마숫자)가 **그대로**이고
 * 으뜸음만 움직인다는 것을 알면 코드 하나하나 계산하지 않아도 된다. 이 퀴즈는 그 감각을 만든다.
 *
 *   · 보기 넷은 코드 이름 줄이다. 틀린 보기는 「반음 하나 어긋난 조」 「반대 방향으로 옮긴 조」 같은
 *     **실수하기 쉬운 오답**이다 (아무 코드나 늘어놓은 오답은 풀 필요가 없다).
 *   · 옮긴 조의 철자(♭ · ♯)는 chord.ts 의 이름 붙이기를 그대로 쓴다.
 */

import { identifyChord } from "./chord.ts";
import { PROGRESSIONS, progressionPitches } from "./progression.ts";
import { keyLabel, type Key } from "./scale.ts";
import type { Rand } from "./ear.ts";

/** 퀴즈에 쓰는 진행과 그것을 배운 회차 (model/lessons.ts 의 진도표) */
export const TRANSPOSE_PROGS: ReadonlyArray<{ id: string; lesson: number }> = [
  { id: "basic", lesson: 1 }, { id: "doowop", lesson: 1 }, { id: "oudou", lesson: 1 }, { id: "komuro", lesson: 1 },
  { id: "251t", lesson: 2 }, { id: "251", lesson: 3 },
  { id: "m-flat", lesson: 4 }, { id: "m-iv", lesson: 4 },
  { id: "oudou-III", lesson: 5 }, { id: "borrow-iv", lesson: 6 }, { id: "add9-pop", lesson: 7 },
];

export type TransposeQuestion = {
  prog: string;
  from: Key;
  to: Key;
  /** 화면에 보일 보기 (코드 이름 줄), 섞여 있다 */
  options: string[];
  answer: string;
};

/** 어떤 조에서 이 진행의 코드 이름 줄: 「F G Em Am」 */
export function chordNames(progId: string, key: Key): string {
  const prog = PROGRESSIONS.find((p) => p.id === progId);
  if (!prog) return "";
  return progressionPitches(key, prog).map((p) => identifyChord(p, key)?.name ?? "?").join(" ");
}

const pcMod = (n: number) => ((n % 12) + 12) % 12;

function shuffle<T>(rand: Rand, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function makeTransposeQuestion(rand: Rand, lesson: number, previous?: TransposeQuestion): TransposeQuestion {
  const pool = TRANSPOSE_PROGS.filter((t) => t.lesson <= lesson);
  const list = pool.length ? pool : TRANSPOSE_PROGS.slice(0, 1);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const id = list[Math.min(list.length - 1, Math.floor(rand() * list.length))].id;
    const mode = PROGRESSIONS.find((p) => p.id === id)?.mode ?? "major";
    const fromTonic = Math.floor(rand() * 12) % 12;
    const shift = 1 + (Math.floor(rand() * 11) % 11); // 1~11 반음
    const from: Key = { tonic: fromTonic, mode };
    const to: Key = { tonic: pcMod(fromTonic + shift), mode };
    if (previous && previous.prog === id && previous.to.tonic === to.tonic) continue;
    const answer = chordNames(id, to);
    // 실수하기 쉬운 오답: 반음 어긋난 조, 반대 방향으로 옮긴 조, 옮기지 않은 원래 줄
    const wrongKeys = [shift + 1, shift - 1, -shift, shift + 2, shift - 2, shift + 7, shift + 5]
      .map((n) => pcMod(fromTonic + n))
      .filter((t) => t !== to.tonic);
    const wrongLines = [chordNames(id, from), ...shuffle(rand, [...new Set(wrongKeys)]).map((t) => chordNames(id, { tonic: t, mode }))];
    const distinct = [...new Set(wrongLines)].filter((l) => l !== answer);
    // 원래 줄은 같은 조일 수 있어 겹치지 않았을 때만 후보. 앞에서부터 셋.
    const options = shuffle(rand, [answer, ...distinct.slice(0, 3)]);
    if (options.length < 4) continue;
    return { prog: id, from, to, options, answer };
  }
  const from: Key = { tonic: 0, mode: "major" };
  const to: Key = { tonic: 2, mode: "major" };
  const answer = chordNames("basic", to);
  return { prog: "basic", from, to, options: [answer, chordNames("basic", from), chordNames("basic", { tonic: 1, mode: "major" }), chordNames("basic", { tonic: 3, mode: "major" })], answer };
}

export function gradeTranspose(q: TransposeQuestion, picked: string): boolean {
  return picked === q.answer;
}

/** 틀렸을 때 보여 줄 풀이: 도수는 그대로, 으뜸음만 몇 반음 움직였는가. */
export function explainTranspose(q: TransposeQuestion): string {
  const up = pcMod(q.to.tonic - q.from.tonic);
  const dir = up <= 6 ? `${up}반음 위로` : `${12 - up}반음 아래로`;
  return `${keyLabel(q.from)} → ${keyLabel(q.to)}: 으뜸음이 ${dir}. 코드 이름도 하나하나 ${dir} 옮기면 됩니다 (도수·종류는 그대로). ${chordNames(q.prog, q.from)} → ${q.answer}`;
}

// ------------------------------------------------------------------ 기록 (이 브라우저에만)

export type TransposeStore = { right: number; total: number; byProg: Record<string, { right: number; total: number }> };
export const TRANSPOSE_KEY = "pianoroll.transpose";

export const emptyTransposeStore = (): TransposeStore => ({ right: 0, total: 0, byProg: {} });

const cnt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e7) : 0);

export function sanitizeTransposeStore(raw: unknown): TransposeStore {
  const out = emptyTransposeStore();
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, unknown>;
  out.total = cnt(r.total);
  out.right = Math.min(cnt(r.right), out.total);
  if (typeof r.byProg === "object" && r.byProg !== null) {
    for (const t of TRANSPOSE_PROGS) {
      const e = (r.byProg as Record<string, unknown>)[t.id];
      if (typeof e === "object" && e !== null) {
        const total = cnt((e as Record<string, unknown>).total);
        out.byProg[t.id] = { total, right: Math.min(cnt((e as Record<string, unknown>).right), total) };
      }
    }
  }
  return out;
}

export function recordTranspose(store: TransposeStore, progId: string, correct: boolean): void {
  store.total += 1;
  if (correct) store.right += 1;
  const e = store.byProg[progId] ?? { right: 0, total: 0 };
  e.total += 1;
  if (correct) e.right += 1;
  store.byProg[progId] = e;
}
