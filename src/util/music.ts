/** 음높이 관련 잡다한 변환. */

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

export const MIN_PITCH = 0;
export const MAX_PITCH = 127;

/** MIDI 노트 번호 → 헤르츠. A4(69) = 440Hz. */
export function midiToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** 60 → "C4" (야마하 표기. 미들 C 를 C4 로 본다) */
export function midiToName(pitch: number): string {
  const name = NAMES[((pitch % 12) + 12) % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return `${name}${octave}`;
}

export function isBlackKey(pitch: number): boolean {
  return BLACK[((pitch % 12) + 12) % 12];
}

/** 도(C) 자리인가. 피아노롤에서 옥타브 선을 굵게 그을 때 쓴다. */
export function isC(pitch: number): boolean {
  return ((pitch % 12) + 12) % 12 === 0;
}

export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, Math.round(pitch)));
}
