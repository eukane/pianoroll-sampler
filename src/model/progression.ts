/**
 * 조의 코드와 정석 진행.
 *
 * 수업에서 배운 것을 손으로 옮기는 용도다.
 *   · 조를 고르면 그 조의 코드 일곱 개(I ii iii IV V vi vii°)가 나온다
 *   · 정석 진행(왕도 · 코무로 · 카논 · 2-5-1 …)을 한 번에 넣는다
 *
 * 코드는 **조의 음계에서 세 음씩 건너 쌓아** 만든다 (1·3·5도, 7th 는 7도까지).
 * 그래서 장조인지 단조인지, 몇 도인지에 따라 장·단·감 3화음이 저절로 정해진다 —
 * 수업의 「장-단-단-장-장-단-감」 을 표로 외워 둔 게 아니라 같은 규칙으로 뽑는다.
 *
 * 노트나 악기와 아무 상관이 없는 순수 계산이다 (node 로 그대로 검사한다).
 */

import { SCALE_STEPS, type Key, type Mode } from "./scale.ts";

/** 몇 도 코드인가(0~6 = I~VII) + 7th 를 얹을지 + 딸림화음으로 바꿀지. */
export type ChordSpec = {
  degree: number;
  seventh?: boolean;
  /**
   * 근음 위에 **장3화음**(+7th 면 단7도)을 쌓는다. 단조의 V 를 V7 로 만들 때 쓴다.
   * 자연단음계에는 이끎음이 없어서 조 밖 음이 하나 생긴다 — 코드 이름 옆에 「조 밖」
   * 이라고 뜨는 바로 그 자리다.
   */
  dominant?: boolean;
};

/** 코드 음을 제일 낮은 음이 G3~F#4 안에 놓이게 쌓는다 (건반 가운데 근처). */
const LOW = 55;

/** 근음의 음높이. 으뜸음 번호 + 음계 간격을 LOW 이상 12 칸 안으로 접는다. */
function rootPitch(key: Key, degree: number): number {
  const pcRoot = (key.tonic + SCALE_STEPS[key.mode][degree]) % 12;
  return LOW + ((((pcRoot - LOW) % 12) + 12) % 12);
}

/** 음계에서 `degree + 위로 몇 칸` 의 음이 근음에서 몇 반음 위인가. 옥타브를 넘으면 12 를 더한다. */
function stackedOffset(mode: Mode, degree: number, up: number): number {
  const steps = SCALE_STEPS[mode];
  const idx = degree + up;
  return steps[idx % 7] + 12 * Math.floor(idx / 7) - steps[degree];
}

/** 조와 코드 지정 → MIDI 음높이들(낮은 음부터). */
export function chordPitches(key: Key, spec: ChordSpec): number[] {
  const root = rootPitch(key, spec.degree);
  if (spec.dominant) {
    const out = [root, root + 4, root + 7];
    if (spec.seventh) out.push(root + 10);
    return out;
  }
  const ups = spec.seventh ? [0, 2, 4, 6] : [0, 2, 4];
  return ups.map((u) => root + stackedOffset(key.mode, spec.degree, u));
}

/** 그 조의 코드 일곱 개. */
export function diatonicChords(key: Key, seventh: boolean): number[][] {
  return Array.from({ length: 7 }, (_, degree) => chordPitches(key, { degree, seventh }));
}

export type Progression = {
  id: string;
  /** 화면에 보일 이름 */
  label: string;
  mode: Mode;
  chords: ChordSpec[];
};

const d = (degree: number, seventh = false, dominant = false): ChordSpec => ({
  degree,
  ...(seventh ? { seventh } : {}),
  ...(dominant ? { dominant } : {}),
});

/**
 * 정석 진행. 도수는 0 부터다 (I = 0, ii = 1 … vii = 6).
 * 장조와 단조를 따로 둔다 — 같은 도수라도 소리의 느낌이 다르고, 단조에는 단조의 정석이 있다.
 */
export const PROGRESSIONS: readonly Progression[] = [
  { id: "oudou", label: "왕도 IV–V–iii–vi", mode: "major", chords: [d(3), d(4), d(2), d(5)] },
  { id: "komuro", label: "코무로 vi–IV–V–I", mode: "major", chords: [d(5), d(3), d(4), d(0)] },
  { id: "canon", label: "카논 I–V–vi–iii–IV–I–IV–V", mode: "major", chords: [d(0), d(4), d(5), d(2), d(3), d(0), d(3), d(4)] },
  { id: "doowop", label: "I–vi–IV–V", mode: "major", chords: [d(0), d(5), d(3), d(4)] },
  { id: "basic", label: "I–IV–V–I", mode: "major", chords: [d(0), d(3), d(4), d(0)] },
  { id: "251", label: "2-5-1 ii7–V7–Imaj7", mode: "major", chords: [d(1, true), d(4, true), d(0, true)] },
  { id: "m-flat", label: "i–VI–III–VII", mode: "minor", chords: [d(0), d(5), d(2), d(6)] },
  { id: "m-andalus", label: "안달루시아 i–VII–VI–V", mode: "minor", chords: [d(0), d(6), d(5), d(4, false, true)] },
  { id: "m-iv", label: "i–iv–VII–III", mode: "minor", chords: [d(0), d(3), d(6), d(2)] },
  { id: "m-251", label: "2-5-1 iiø7–V7–i7", mode: "minor", chords: [d(1, true), d(4, true, true), d(0, true)] },
];

export function progressionsFor(mode: Mode): readonly Progression[] {
  return PROGRESSIONS.filter((p) => p.mode === mode);
}

export function progressionPitches(key: Key, p: Progression): number[][] {
  return p.chords.map((spec) => chordPitches(key, spec));
}
