/**
 * 조(키)와 음계.
 *
 * 조는 "이 곡은 주로 이 일곱 음을 쓰고, 이 음이 집이다" 는 **설명**이지
 * 규칙이 아니다. 그래서 조를 정해도 노트를 막지 않는다 — 조 밖의 음도
 * 얼마든지 찍힌다. 하는 일은 셋뿐이다.
 *
 *   · 피아노롤과 연주 건반에서 조 안의 음을 밝게 보여 준다
 *   · 코드 이름을 그 조의 로마숫자(I · vi · V7 …)로도 읽어 준다
 *   · 코드 이름을 그 조에 맞는 글자(샵 / 플랫)로 적는다
 *
 * 노트처럼 **박이나 악기와 아무 상관이 없다.** 조를 바꿔도 노트는 그대로다.
 * 다른 DAW 의 스케일 표시와 같다.
 */

export type Mode = "major" | "minor";

export type Key = {
  /** 으뜸음의 음이름 번호 0~11 (C=0, C#=1 … B=11). 옥타브는 없다. */
  tonic: number;
  mode: Mode;
};

/**
 * 으뜸음에서 몇 반음씩 떨어진 음들이 그 조의 일곱 음인가.
 *
 *     장조   온 온 반 온 온 온 반    0 2 4 5 7 9 11
 *     단조   온 반 온 온 반 온 온    0 2 3 5 7 8 10   (자연단음계)
 *
 * 단조는 **자연단음계**로 잡았다. 단조 곡에서 V 를 장코드로 바꾸려고 7음을
 * 올리는 일(화성단음계)은 흔하지만, 그건 "조 밖의 음을 빌려 쓰는 것" 으로
 * 보여 주는 게 배우는 쪽에 더 정직하다 — 코드 이름 옆에 「조 밖 음」 이라고
 * 뜨는 그 자리가 바로 수업에서 말한 이끎음이다.
 */
export const SCALE_STEPS: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** 고정 도 계이름. 수업이 「도레미」 와 「C D E」 를 같이 쓴다. */
const SOLFEGE = ["도", "도#", "레", "레#", "미", "파", "파#", "솔", "솔#", "라", "라#", "시"];

/**
 * 플랫으로 적는 조.
 *
 * 샵 조와 플랫 조는 같은 건반을 다르게 부를 뿐이지만, 악보와 코드표는 조마다
 * 정해진 쪽으로 적는다. E♭ 장조에서 「D# 」 이라고 적으면 맞는 음인데도 낯설다.
 *
 *     장조  F  B♭  E♭  A♭  D♭  G♭      단조  D  G  C  F  B♭  E♭
 *
 * F# 장조와 G♭ 장조는 같은 소리라 어느 쪽이든 맞다. 샵(F#)으로 둔다.
 */
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]);
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);

export function pc(pitch: number): number {
  return ((Math.round(pitch) % 12) + 12) % 12;
}

/** 이 조는 플랫으로 적는가. 조가 없으면 샵이다. */
export function prefersFlats(key: Key | null | undefined): boolean {
  if (!key) return false;
  return key.mode === "major" ? FLAT_MAJOR.has(key.tonic) : FLAT_MINOR.has(key.tonic);
}

/** 음이름 (옥타브 없이). 조에 맞춰 샵이나 플랫으로. */
export function pcName(pitchClass: number, key?: Key | null): string {
  return (prefersFlats(key) ? FLAT_NAMES : SHARP_NAMES)[pc(pitchClass)];
}

export function solfege(pitchClass: number): string {
  return SOLFEGE[pc(pitchClass)];
}

/** 조의 일곱 음 (음이름 번호). 으뜸음부터 순서대로. */
export function scalePitchClasses(key: Key): number[] {
  return SCALE_STEPS[key.mode].map((s) => (key.tonic + s) % 12);
}

/** 그 음이 조 안에 있는가. 옥타브는 보지 않는다. */
export function inKey(pitch: number, key: Key): boolean {
  return SCALE_STEPS[key.mode].includes((pc(pitch) - key.tonic + 12) % 12);
}

export function isTonic(pitch: number, key: Key): boolean {
  return pc(pitch) === key.tonic;
}

/** 「D 장조」「A 단조」 */
export function keyLabel(key: Key): string {
  return `${pcName(key.tonic, key)} ${key.mode === "major" ? "장조" : "단조"}`;
}

/** 화면의 고르기 칸 값 ↔ Key. "none" 이면 조 없음. */
export function keyToValue(key: Key | null | undefined): string {
  return key ? `${key.tonic}:${key.mode}` : "none";
}

export function keyFromValue(value: string): Key | null {
  const m = /^(\d{1,2}):(major|minor)$/.exec(value);
  if (!m) return null;
  const tonic = Number(m[1]);
  if (!Number.isInteger(tonic) || tonic < 0 || tonic > 11) return null;
  return { tonic, mode: m[2] as Mode };
}

/**
 * 고르기 칸에 올릴 목록. 장조 12 개, 단조 12 개.
 *
 * 순서는 건반 순서(C → B)다. 5도권 순서가 이론적으로는 예쁘지만, 처음
 * 배우는 사람이 「G 장조」 를 찾으려면 건반 순서가 더 빠르다.
 */
export function keyChoices(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const mode of ["major", "minor"] as Mode[]) {
    for (let tonic = 0; tonic < 12; tonic += 1) {
      const key = { tonic, mode };
      out.push({ value: keyToValue(key), label: keyLabel(key) });
    }
  }
  return out;
}

/** 저장 파일에서 읽는다. 사람이 고칠 수 있는 파일이라 그대로 믿지 않는다. */
export function readKey(raw: unknown): Key | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const tonic = r.tonic;
  if (typeof tonic !== "number" || !Number.isInteger(tonic) || tonic < 0 || tonic > 11) return undefined;
  if (r.mode !== "major" && r.mode !== "minor") return undefined;
  return { tonic, mode: r.mode };
}
