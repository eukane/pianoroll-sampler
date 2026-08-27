/**
 * 비브라토(떨림) — 트랙에 하나씩 걸리는 연주 기교.
 *
 * 트럼펫이나 해금은 긴 음을 그냥 뻗지 않는다. 소리를 내다가 음정을 잘게
 * 흔든다. 그게 없으면 아무리 좋은 음원이어도 "찍은 것" 처럼 들린다.
 *
 * ## 왜 깊이만 조절하고 빠르기는 못 하는가
 *
 * 사운드폰트 재생은 우리가 직접 음정을 흔드는 게 아니라 **신스에게 시킨다**
 * (MIDI CC1 = 모듈레이션 휠). 그게 표준이고, 어느 사운드폰트에나 들어 있고,
 * 내보낸 MIDI 를 다른 DAW 에서 열어도 그대로 살아 있다.
 *
 * 대신 **흔드는 속도는 음원이 정한다.** 실제로 재 봤다 (fixtures/test.sf2,
 * 라 = 440Hz 를 길게 누르고 자기상관으로 음정을 추적):
 *
 *     설정                     흔들림 폭      빠르기
 *     ------------------------------------------------
 *     아무것도 안 함             0 cent        —
 *     CC1 = 64                34 cent      8.3 Hz
 *     CC1 = 127               86 cent      8.1 Hz
 *     CC76(빠르기) 20 / 100     변화 없음     8.1 Hz
 *     CC77(깊이) 단독           변화 없음      —
 *
 * CC1 은 깊이를 정확히 따라오는데, 빠르기를 바꾸는 CC76 은 아무 반응이 없다
 * (GS 시스템 익스클루시브로 켜야 하는 모듈레이터라서 그렇다). 8.1Hz 는
 * SF2 규격의 기본 비브라토 속도(8.176Hz)와 사실상 같은 값이다.
 *
 * 그래서 빠르기 슬라이더를 만들지 않았다. 만들면 임시 신스와 낱개 WAV 에서는
 * 먹고 사운드폰트에서만 조용히 무시되는데, 그건 **아무 말도 없이 안 먹는
 * 조절기**다. 이 저장소가 제일 싫어하는 종류다.
 *
 * 어차피 흔드는 속도는 악기의 성질에 가깝다 — 트럼펫이 얼마나 빨리 떠는지는
 * 그 트럼펫이 정할 일이지 사용자가 정할 일이 아니다. 대신 임시 신스와 낱개
 * WAV 도 **같은 8.1Hz** 로 흔들어서 셋이 따로 놀지 않게 맞췄다.
 *
 * ## 시작까지 기다리는 시간이 왜 필요한가
 *
 * 실제 연주자는 모든 음을 떨지 않는다. **긴 음만** 뻗다가 흔든다. 딜레이가
 * 없으면 16분음표까지 전부 떨어서 기계처럼 들린다. 늦게 시작하게 두면 짧은
 * 음은 저절로 안 떨린다.
 */

/** 흔드는 속도(Hz). 사운드폰트가 쓰는 값에 맞췄다 — 위 표 참고. */
export const VIBRATO_HZ = 8.1;

/**
 * 깊이 1.0 일 때 음정이 흔들리는 폭(센트, 진폭).
 *
 * SF2 규격이 모듈레이션 휠 최대치에 주는 값이 50센트다. 임시 신스와 낱개
 * WAV 도 같은 값을 써야 트랙을 바꿔 가며 들었을 때 깊이가 같게 느껴진다.
 */
export const VIBRATO_MAX_CENTS = 50;

/** 딜레이가 지난 뒤 최대 깊이까지 차오르는 시간(초). 뚝 켜지면 부자연스럽다. */
export const VIBRATO_FADE = 0.12;

export type VibratoSetting = {
  /** 0~1. 0 이면 안 건다. */
  depth: number;
  /** 음이 시작하고 몇 초 뒤부터 떠는가. */
  delay: number;
};

export const NO_VIBRATO: VibratoSetting = { depth: 0, delay: 0 };

/** 트랙 설정에서 읽어 온다. 값이 없거나 이상하면 안 거는 쪽으로 떨어진다. */
export function vibratoOf(track: { vibrato?: number; vibratoDelay?: number }): VibratoSetting {
  const depth = clamp(track.vibrato ?? 0, 0, 1);
  return { depth, delay: depth > 0 ? clamp(track.vibratoDelay ?? 0, 0, 2) : 0 };
}

/**
 * 이 음이 떨릴 자격이 있는가.
 *
 * 딜레이보다 짧은 음은 떨림이 시작하기도 전에 끝난다. 미리 걸러 두면 그런
 * 음에는 아무 신호도 안 보내게 되어 신스로 나가는 메시지가 줄어든다.
 */
export function shakes(v: VibratoSetting, durationSec: number): boolean {
  return v.depth > 0 && durationSec > v.delay + 0.02;
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;
}
