/**
 * 꾸밈 — **음 하나에** 붙는 연주 기교 (시김새).
 *
 * 트랙에 떨림을 걸어 두면 그 악기가 내는 모든 긴 음이 똑같이 떤다. 그건
 * 기교가 아니라 그냥 그 악기의 버릇이다. 실제 연주에서 기교는 **음마다
 * 다르게** 들어간다 — 같은 음높이를 찍어도 어떤 건 밑에서 끌어올리고, 어떤 건
 * 끝에서 흘려 내리고, 어떤 건 아무것도 안 한다. 그 차이가 곡을 살린다.
 *
 * 그래서 꾸밈은 `Note` 에 붙는다.
 *
 * > 노트는 **악기 정보**를 갖지 않는다 — 그 원칙은 그대로다. 꾸밈은 악기가
 * > 아니라 **연주 방법**이다. 색소폰으로 찍어 둔 꺾는 음을 가야금으로 바꾸면
 * > 가야금이 그 자리를 꺾어 준다. 오히려 원칙이 지켜지는 쪽이다.
 *
 * ## 무엇을 넣고 무엇을 뺐나
 *
 * 넣은 것은 넷뿐이다. 폰 화면에서 음 하나를 눌러 고르는 것이라, 목록이 길면
 * 고르는 데 시간이 더 걸려서 안 쓰게 된다.
 *
 *     떨림      뒷부분에서 음정이 흔들린다 (긴 음에만)
 *     끌어올림   아래에서 붙여 올려 시작한다 (추성 · 스쿱)
 *     흘러내림   끝에서 음정이 떨어진다 (퇴성 · 폴)
 *     꺾기      한 번 위로 꺾었다 제자리로 온다 (전성)
 *
 * 자유 곡선(보카로의 그 곡선)은 안 넣었다. 폰에서 손가락으로 곡선을 그리는
 * 건 정확도가 안 나오고, 위 넷이면 "이 음만 다르게" 는 이미 된다.
 *
 * ## 음정을 어떻게 흔드는가 — 두 갈래
 *
 * **떨림**은 신스에게 시킨다(CC1). 8Hz 로 흔드는 걸 우리가 점으로 그리면
 * 1초짜리 음 하나에 백 개가 넘는 이벤트가 나간다 — 폰에서 못 쓸 짓이다.
 *
 * **나머지 셋은 음정 곡선**이라 점 몇 개면 된다. 아래 `bendCurve` 가 그
 * 점들을 만든다. 임시 신스와 낱개 WAV 는 보이스마다 detune 을 직접 그리고,
 * 사운드폰트는 피치 벤드로 그린다.
 *
 * ## 사운드폰트에서는 화음이 같이 휜다
 *
 * MIDI 피치 벤드는 **채널 전체**에 걸린다. 그래서 사운드폰트 트랙에서 겹친
 * 음 중 하나만 꺾을 수는 없다 — 같이 휜다. 기교를 넣는 자리는 대개 멜로디
 * 한 줄이라 실제로 걸릴 일은 드물지만, 안 되는 건 안 된다고 적어 둔다.
 * (임시 신스와 낱개 WAV 는 보이스마다 따로 휘어서 이 제한이 없다.)
 *
 * 휘는 폭은 **±200센트(온음)** 를 넘지 않게 잡았다. MIDI 피치 벤드의 기본
 * 범위가 ±2반음이라, 넘기면 신스마다 다르게 들린다.
 */

/** 음 하나에 붙는 꾸밈. 없으면 `none`. */
export type Ornament = "none" | "vibrato" | "scoop" | "fall" | "bend";

export const ORNAMENTS: { id: Ornament; label: string; hint: string }[] = [
  { id: "none", label: "그냥", hint: "꾸미지 않는다" },
  { id: "vibrato", label: "떨림", hint: "뒷부분에서 흔든다" },
  { id: "scoop", label: "끌어올림", hint: "아래에서 붙여 올린다" },
  { id: "fall", label: "흘러내림", hint: "끝에서 떨어뜨린다" },
  { id: "bend", label: "꺾기", hint: "위로 꺾었다 제자리로" },
];

/** 피치 벤드의 기본 범위(±2반음)를 넘지 않는다. */
export const MAX_BEND_CENTS = 200;

/** 세기를 안 정했을 때. 너무 얌전하면 넣은 티가 안 나고, 세면 음정이 틀린 것처럼 들린다. */
export const DEFAULT_AMOUNT = 0.6;

/** 음정 곡선의 한 점. `t` 는 음이 시작하고 몇 초 뒤인가. */
export type BendPoint = { t: number; cents: number };

export type NoteLike = { ornament?: Ornament; ornamentAmount?: number; ornamentAt?: number };

/**
 * 이 꾸밈이 **음 안에서 언제** 일어나는가 (0~1, 음 길이에 대한 비율).
 *
 * 안 정하면 `null` 이고, 그러면 아래 `bendCurve` 가 알아서 잡는다(예전 그대로).
 * 정해 두면 그 자리에 딱 붙는다 — 긴 음에서 "3박째에 꺾어라" 를 하려면
 * 이게 있어야 한다.
 */
export function atOf(note: NoteLike): number | null {
  const a = note.ornamentAt;
  if (typeof a !== "number" || !Number.isFinite(a)) return null;
  return Math.max(0, Math.min(1, a));
}

export function ornamentOf(note: NoteLike): Ornament {
  return note.ornament ?? "none";
}

export function amountOf(note: NoteLike): number {
  const a = note.ornamentAmount ?? DEFAULT_AMOUNT;
  return Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : DEFAULT_AMOUNT;
}

/**
 * 이 음의 음정 곡선. 점 사이는 곧게 잇는다.
 *
 * ## 두 가지가 곡선을 정한다 — **얼마나**(amount)와 **언제**(at)
 *
 * 처음에는 「언제」가 없었다. 꺾기는 언제나 음 길이의 **45% 자리**에서
 * 났고, 끌어올림은 머리, 흘러내림은 꼬리에 붙박이였다. 8분음표에서는 그게
 * 맞는데 **긴 음에서는 안 맞는다** — 4박을 끄는 음에서 "3박째에 꺾어라" 를
 * 할 방법이 없었다. 사용자가 정확히 그걸 지적했다.
 *
 * 그래서 음마다 `ornamentAt`(0~1)을 둔다. 네 꾸밈에서 뜻이 하나로 통한다.
 *
 *     끌어올림   그 지점**까지** 올라온다
 *     흘러내림   그 지점**부터** 내려간다
 *     꺾기       그 지점**에서** 꺾는다
 *     떨림       그 지점**부터** 떨린다 (audio/expression.ts)
 *
 * 안 정하면 예전 그대로다. 이미 만들어 둔 곡의 소리가 바뀌면 안 된다.
 *
 * ## 짧은 음에서도 모양이 살아 있어야 한다
 *
 * 구간 길이를 초로 못 박지 않고 **음 길이의 비율과 초 중 짧은 쪽**을 쓴다.
 * 0.1초짜리 16분음표에 0.15초짜리 끌어올림을 붙이면 음이 끝날 때까지 제
 * 음정에 도착하지 못한다.
 */
export function bendCurve(
  o: Ornament,
  amount: number,
  durationSec: number,
  at: number | null = null,
): BendPoint[] {
  const d = Math.max(0.02, durationSec);
  const cents = Math.round(amount * MAX_BEND_CENTS);
  if (cents === 0) return [];
  const span = (seconds: number, ratio: number) => Math.min(seconds, d * ratio);
  /** 정해 준 지점(초). 음 밖으로 못 나간다. */
  const point = at === null ? null : Math.max(0, Math.min(d, d * at));

  switch (o) {
    case "scoop": {
      // 아래에서 붙여 올린다. 도착이 늦으면 음정이 틀린 것처럼 들려서
      // 안 정했을 땐 앞쪽만 쓴다. 정해 주면 거기까지 끌어올린다.
      const rise = point ?? span(0.13, 0.3);
      return [
        { t: 0, cents: -cents },
        { t: Math.max(0.01, rise), cents: 0 },
      ];
    }
    case "fall": {
      // 끝에서 떨어뜨린다. 음이 끝나는 순간까지 내려간다.
      const from = point ?? d - span(0.18, 0.35);
      return [
        { t: 0, cents: 0 },
        { t: Math.min(d - 0.01, Math.max(0, from)), cents: 0 },
        { t: d, cents: -cents },
      ];
    }
    case "bend": {
      // 한 번 위로 꺾었다 제자리. 안 정했을 땐 중간보다 조금 뒤에서 꺾는다 —
      // 정확히 가운데면 "꺾었다" 보다 "흔들렸다" 로 들린다.
      const up = span(0.09, 0.18);
      const back = span(0.14, 0.28);
      // 꺾고 돌아오는 데 걸리는 만큼은 음 안에 남겨 둔다. 끝에 붙여 두면
      // 제자리로 돌아오기 전에 음이 끝나서 음정이 틀어진 채로 끝난다.
      const room = Math.max(0, d - up - back);
      const start = Math.min(point ?? d * 0.45, room);
      return [
        { t: 0, cents: 0 },
        { t: start, cents: 0 },
        { t: start + up, cents },
        { t: start + up + back, cents: 0 },
      ];
    }
    default:
      return [];
  }
}
