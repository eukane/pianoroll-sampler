/**
 * 코드 이름(「Am7」 「F/A」 「Gsus4」) → 음높이.
 *
 * 코드를 귀로 딴 뒤 그 이름을 적어 두면, 적은 이름 그대로 **소리로 들어 볼 수 있어야** 맞게 땄는지 확인된다.
 * chord.ts 는 반대 방향(음 → 이름)이고 이쪽은 이름 → 음이다. 두 쪽이 같은 이름표를 쓰는지는 테스트가
 * 왕복으로 잠근다 (이름을 읽어 음으로 바꾼 뒤 다시 이름을 읽으면 처음과 같아야 한다).
 *
 * **모르는 표기는 지어내지 않는다.** 읽을 수 없으면 null — 화면이 그 칸을 틀렸다고 보여 준다.
 */

import { lowRootPitch } from "./progression.ts";

/** 이름 꼬리 → 근음에서 떨어진 반음 수. 앞엣것이 정식 표기다. */
const SUFFIXES: ReadonlyArray<readonly [string, readonly number[]]> = [
  ["", [0, 4, 7]],
  ["m", [0, 3, 7]],
  ["dim", [0, 3, 6]],
  ["aug", [0, 4, 8]],
  ["7", [0, 4, 7, 10]],
  ["maj7", [0, 4, 7, 11]],
  ["m7", [0, 3, 7, 10]],
  ["m7b5", [0, 3, 6, 10]],
  ["dim7", [0, 3, 6, 9]],
  ["mMaj7", [0, 3, 7, 11]],
  ["sus4", [0, 5, 7]],
  ["sus2", [0, 2, 7]],
  ["7sus4", [0, 5, 7, 10]],
  ["add9", [0, 4, 7, 14]],
  ["madd9", [0, 3, 7, 14]],
  ["6", [0, 4, 7, 9]],
  ["m6", [0, 3, 7, 9]],
  ["9", [0, 4, 7, 10, 14]],
  ["maj9", [0, 4, 7, 11, 14]],
  ["m9", [0, 3, 7, 10, 14]],
  ["5", [0, 7]],
];

/** 다르게 적는 표기 → 정식 꼬리 */
const ALIASES: Readonly<Record<string, string>> = {
  maj: "", M: "", min: "m", "-": "m", mi: "m", "°": "dim", o: "dim", "+": "aug",
  M7: "maj7", "Δ7": "maj7", "△7": "maj7", Maj7: "maj7", min7: "m7", mi7: "m7", "-7": "m7",
  "ø": "m7b5", "ø7": "m7b5", "m7-5": "m7b5", "°7": "dim7", mM7: "mMaj7", "m(maj7)": "mMaj7",
  "sus": "sus4", "7sus": "7sus4", "add2": "add9", "2": "sus2", min9: "m9", M9: "maj9",
};

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export type ParsedChord = {
  /** 읽은 그대로가 아니라 정식으로 적은 이름: 「Am7/C」 */
  name: string;
  rootPc: number;
  /** 정식 꼬리 (「m7」) */
  suffix: string;
  bassPc: number | null;
  /** 낮은 음부터. 맨 앞은 베이스(근음 또는 슬래시 뒤의 음), 그 위로 코드 음들. */
  pitches: number[];
};

function readNote(s: string): { pc: number; rest: string } | null {
  const m = /^([A-Ga-g])([#b]?)/.exec(s);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return { pc: (LETTER_PC[letter] + acc + 12) % 12, rest: s.slice(m[0].length) };
}

/** 코드 이름 한 칸을 읽는다. 읽을 수 없으면 null. */
export function parseChordSymbol(text: string): ParsedChord | null {
  const raw = text.trim().replace(/♭/g, "b").replace(/♯/g, "#").replace(/\s+/g, "");
  if (!raw) return null;
  const slash = raw.lastIndexOf("/");
  const head = slash >= 0 ? raw.slice(0, slash) : raw;
  const bassText = slash >= 0 ? raw.slice(slash + 1) : "";

  const root = readNote(head);
  if (!root) return null;
  let tail = root.rest;
  if (ALIASES[tail] !== undefined) tail = ALIASES[tail];
  const found = SUFFIXES.find(([suffix]) => suffix === tail);
  if (!found) return null;

  let bassPc: number | null = null;
  if (slash >= 0) {
    const bass = readNote(bassText);
    if (!bass || bass.rest !== "") return null;
    bassPc = bass.pc;
  }

  const rootPitch = lowRootPitch(root.pc);
  const bassPitch = bassPc === null ? rootPitch - 12 : lowRootPitch(bassPc) - 12;
  const names = prefersFlat(root.pc, tail) ? FLATS : LETTERS;
  const name = `${names[root.pc]}${found[0]}${bassPc === null ? "" : `/${names[bassPc]}`}`;
  return {
    name,
    rootPc: root.pc,
    suffix: found[0],
    bassPc,
    pitches: [bassPitch, ...found[1].map((i) => rootPitch + i)],
  };
}

/** 정식 이름의 철자: 처음 쓴 글자를 따르지는 못하므로, 플랫 조에서 흔한 근음만 플랫으로 적는다. */
function prefersFlat(pc: number, _suffix: string): boolean {
  return pc === 3 || pc === 8 || pc === 10; // Eb · Ab · Bb
}

/** 한 칸에 적힌 글을 코드 이름 토큰으로 나눈다. 「Am F」 「Am,F」 「Am | F」 모두 둘로. */
export function splitCell(text: string): string[] {
  return text
    .split(/[\s,|]+/)
    .map((t) => t.trim())
    .filter((t) => t !== "" && t !== "-" && t !== "|");
}
