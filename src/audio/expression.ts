/**
 * 이 음을 실제로 어떻게 연주할 것인가 — 트랙 기본값과 음의 꾸밈을 합친 결과.
 *
 * 규칙은 한 줄이다.
 *
 *   **트랙의 기본 떨림은 꾸밈을 정하지 않은 음에만 걸린다.
 *   꾸밈을 정하면(「그냥」 포함) 그 음은 오로지 그 꾸밈대로만 연주된다.**
 *
 * 숨은 조합을 만들지 않으려고 이렇게 잘랐다. "꺾으면서 동시에 떨기" 같은 건
 * 안 된다 — 되게 하려면 음마다 두 개를 고르게 해야 하는데, 폰에서 음 하나를
 * 눌러 고르는 화면에 선택지를 두 겹으로 쌓으면 아무도 안 쓴다.
 *
 * 트랙 기본 떨림을 남겨 둔 이유: 관악기처럼 **긴 음이면 으레 떠는** 악기가
 * 있다. 그걸 음마다 찍는 건 노동이다. 기본으로 깔아 두고, 특별한 음만 눌러
 * 바꾸는 게 실제 조교 방식과 같다.
 */

import type { Note, Track } from "../model/types";
import { amountOf, atOf, bendCurve, ornamentOf, type BendPoint } from "../model/ornament.ts";
import { NO_VIBRATO, vibratoOf, type VibratoSetting } from "./vibrato.ts";

export type Expression = {
  vibrato: VibratoSetting;
  /** 음정 곡선. 빈 배열이면 안 휜다. */
  bend: BendPoint[];
};

export const PLAIN: Expression = { vibrato: NO_VIBRATO, bend: [] };

export function expressionFor(track: Track, note: Note, durationSec: number): Expression {
  const o = note.ornament;
  if (o === undefined) return { vibrato: vibratoOf(track), bend: [] };
  if (o === "none") return PLAIN;
  if (o === "vibrato") {
    // 음마다 세기를 따로 준다. 시작 시점은 **정해 줬으면 그것**, 안 정했으면
    // 트랙 설정을 쓴다. 트랙 설정은 짧은 음이 안 떨게 하는 장치라 대부분의
    // 음에는 그걸로 충분한데, 긴 음에서 "여기서부터 떨어라" 를 하려면
    // 음마다 정할 수 있어야 한다.
    const at = atOf(note);
    const delay = at === null ? vibratoOf(track).delay : at * Math.max(0.02, durationSec);
    return { vibrato: { depth: amountOf(note), delay }, bend: [] };
  }
  return {
    vibrato: NO_VIBRATO,
    bend: bendCurve(ornamentOf(note), amountOf(note), durationSec, atOf(note)),
  };
}

/** 곡선을 곧은 구간들로 잘라 준다. MIDI 처럼 계단으로만 표현되는 쪽에서 쓴다. */
export function sampleBend(bend: BendPoint[], stepSec = 0.03): BendPoint[] {
  if (bend.length === 0) return [];
  const out: BendPoint[] = [bend[0]];
  for (let i = 1; i < bend.length; i += 1) {
    const from = bend[i - 1];
    const to = bend[i];
    const span = to.t - from.t;
    const steps = Math.max(1, Math.ceil(span / stepSec));
    for (let s = 1; s <= steps; s += 1) {
      const k = s / steps;
      out.push({ t: from.t + span * k, cents: from.cents + (to.cents - from.cents) * k });
    }
  }
  return out;
}

/**
 * 노래하는 줄 하나에 붙는 꾸밈들. 노트 id 로 찾는다.
 *
 * 노래는 노트 하나씩 소리를 내지 않고 **줄을 통째로** 예약한다
 * (audio/voicebank.ts). 그래서 꾸밈도 줄 단위로 미리 모아 넘겨야 한다.
 * 아무 꾸밈도 없는 음은 담지 않는다 — 담아 봐야 노드만 늘어난다.
 */
export function singingExpressions(
  track: Track,
  notes: Note[],
  secondsOf: (note: Note) => number,
): Map<string, Expression> {
  const out = new Map<string, Expression>();
  for (const note of notes) {
    const e = expressionFor(track, note, secondsOf(note));
    if (e.bend.length > 0 || e.vibrato.depth > 0) out.set(note.id, e);
  }
  return out;
}
