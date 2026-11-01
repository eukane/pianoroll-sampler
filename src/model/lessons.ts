/**
 * 수업 회차와 귀 훈련 단계의 연결.
 *
 * 수업 노트(보카로 작곡 수업 노트)의 진도표가 원본이다. 귀 훈련은 「배운 것까지만」 나와야 한다 —
 * 아직 안 배운 코드가 섞여 나오면 틀린 이유가 귀가 아니라 이론이라, 훈련이 되지 않는다.
 *
 *   회차  이론                              노트에 적힌 귀 훈련
 *   1     코드 기초 · 왕도 · 코무로           맛보기
 *   2     2-5-1 (ii–V–I)                   I 와 V 구분
 *   3     7화음 (Cmaj7 · Dm7 · G7 …)         장/단 코드 구분
 *   4     단조 (나란한조 · vi 가 집 · V 장코드)  (적혀 있지 않음)
 *   5     세컨더리 도미넌트                   (적혀 있지 않음)
 *   6     빌려 온 코드 (IVm 등)               (적혀 있지 않음)
 *   7     색깔 변형 (sus4 · add9 · 분수코드)    (적혀 있지 않음)
 *
 * 노트는 「귀 훈련 5분은 매 회차 계속한다」 고만 적고, 4회차 이후의 내용은 정해 두지 않았다. 그래서
 * 4~7회차의 추천 단계는 **그 회차에서 바뀐 코드를 귀로 구별해 보는 것**으로 내가 붙인 것이다.
 * 노트와 다르게 진행하면 화면에서 「배운 곳까지」 만 바꾸면 된다.
 *
 * 순수 데이터 + 계산이다 (node 로 검사한다).
 */

import { LAST_LESSON, LEVELS, levelsForLesson, type Level } from "./ear.ts";

export type Lesson = {
  n: number;
  title: string;
  /** 그 회차에 하라고 노트에 적힌(또는 내가 붙인) 귀 훈련 */
  ear: string;
  /** 노트에 적힌 것이면 true, 내가 붙인 추천이면 false */
  fromNotes: boolean;
  /** 그 회차에 추천하는 단계 (맨 앞이 대표) */
  focus: string[];
};

export const LESSONS: readonly Lesson[] = [
  { n: 1, title: "코드 기초 · 왕도 · 코무로", ear: "귀 훈련 맛보기", fromNotes: true, focus: ["L1", "Q1"] },
  { n: 2, title: "2-5-1 진행 (ii–V–I)", ear: "I 와 V 구분", fromNotes: true, focus: ["E2"] },
  { n: 3, title: "7화음", ear: "장/단 코드 구분", fromNotes: true, focus: ["Q1", "Q3"] },
  { n: 4, title: "단조 · V 를 장코드로", ear: "단조 코드 듣기", fromNotes: false, focus: ["L4", "N2"] },
  { n: 5, title: "세컨더리 도미넌트", ear: "iii 와 III 구분", fromNotes: false, focus: ["N3"] },
  { n: 6, title: "빌려 온 코드 (IVm)", ear: "IV 와 IVm 구분", fromNotes: false, focus: ["N4"] },
  { n: 7, title: "색깔 변형 (sus4 · add9)", ear: "같은 뼈대의 색깔 구분", fromNotes: false, focus: ["N5"] },
];

export function lessonByNumber(n: number): Lesson | undefined {
  return LESSONS.find((l) => l.n === n);
}

/** 저장된 값이 이상해도 1~7 로 돌려놓는다. 기본은 전부(7). */
export function clampLesson(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= LAST_LESSON ? v : LAST_LESSON;
}

/** 이 회차까지 배웠을 때 보여 줄 단계들 (회차 순). */
export function visibleLevels(lesson: number): Level[] {
  return levelsForLesson(clampLesson(lesson));
}

/** 이 회차의 추천 단계 중 지금 풀 수 있는 것들 (배운 곳까지가 더 앞이면 아직 못 푸는 건 뺀다). */
export function focusLevels(lesson: number, upTo: number = lesson): Level[] {
  const l = lessonByNumber(lesson);
  if (!l) return [];
  return l.focus.map((id) => LEVELS.find((x) => x.id === id)).filter((x): x is Level => !!x && x.lesson <= upTo);
}
