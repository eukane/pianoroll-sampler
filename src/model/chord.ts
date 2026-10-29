/**
 * 누른 음 / 고른 음이 무슨 코드인지 읽어 준다.
 *
 * 귀카피(코드 따기)와 코드 공부를 돕는 자리다. 「도 미 솔」 을 누르면 C,
 * 「라 도 미 솔」 이면 Am7, 조를 정해 두면 그 조의 로마숫자(vi7)까지.
 *
 * **이름을 못 붙이면 지어내지 않는다.** 표에 없는 묶음은 null 이다 — 그럴듯한
 * 이름을 억지로 붙이면 배우는 사람이 틀린 걸 외운다.
 *
 * 읽는 법:
 *   1. 옥타브를 지우고 음이름(0~11)만 남긴다. 겹친 음도 하나로 친다
 *   2. 그 음들 하나하나를 근음이라고 가정하고, 근음에서 떨어진 반음 수의 묶음이
 *      아래 표에 **정확히** 있는지 본다
 *   3. 여럿이 맞으면(C6 = Am7 처럼 같은 음 묶음) **맨 아래 음(베이스)이 근음인
 *      쪽**을 고른다. 그런 게 없으면 표의 순서(흔한 것 먼저)로 고르고, 베이스를
 *      「/E」 처럼 붙인다
 *
 * **글자(철자)는 코드 모양을 따른다.** 같은 건반이라도 C 장조에서 빌려 온 Fm 의
 * 3음은 「G#」 이 아니라 「Ab」 이다 — 근음 F 에서 3도 위의 글자가 A 이기 때문이다.
 * 조 이름(샵 조/플랫 조)만 보고 적으면 이런 데서 틀린 철자가 나온다.
 */

import { pc, pcName, SCALE_STEPS, type Key } from "./scale.ts";

type Quality =
  | "maj" | "min" | "dim" | "aug" | "sus4" | "sus2" | "5"
  | "7" | "maj7" | "m7" | "m7b5" | "dim7" | "mMaj7" | "7sus4"
  | "6" | "m6" | "add9" | "madd9" | "9" | "maj9" | "m9";

type Template = {
  quality: Quality;
  /** 근음에서 떨어진 반음 수. 0 을 포함한다. */
  set: readonly number[];
  /** 코드 이름에 붙는 꼬리 (C 뒤에 붙는 것). */
  suffix: string;
  /** 5음을 뺀 모양인가 (재즈 피아노의 셸 보이싱). 이름은 같고 안내만 다르다. */
  omit5?: boolean;
};

/**
 * 순서가 곧 우선순위다 — 같은 음 묶음에 이름이 둘 붙을 때 앞엣것을 쓴다.
 * 3화음과 흔한 7화음을 앞에, 6·sus2·add9 처럼 다르게도 읽히는 것을 뒤에 뒀다.
 * (베이스가 근음인 쪽이 있으면 순서보다 그게 먼저다.)
 */
const TEMPLATES: readonly Template[] = [
  { quality: "maj", set: [0, 4, 7], suffix: "" },
  { quality: "min", set: [0, 3, 7], suffix: "m" },
  { quality: "dim", set: [0, 3, 6], suffix: "dim" },
  { quality: "aug", set: [0, 4, 8], suffix: "aug" },
  { quality: "7", set: [0, 4, 7, 10], suffix: "7" },
  { quality: "maj7", set: [0, 4, 7, 11], suffix: "maj7" },
  { quality: "m7", set: [0, 3, 7, 10], suffix: "m7" },
  { quality: "m7b5", set: [0, 3, 6, 10], suffix: "m7b5" },
  { quality: "dim7", set: [0, 3, 6, 9], suffix: "dim7" },
  { quality: "mMaj7", set: [0, 3, 7, 11], suffix: "mMaj7" },
  { quality: "sus4", set: [0, 5, 7], suffix: "sus4" },
  { quality: "7sus4", set: [0, 5, 7, 10], suffix: "7sus4" },
  { quality: "9", set: [0, 2, 4, 7, 10], suffix: "9" },
  { quality: "maj9", set: [0, 2, 4, 7, 11], suffix: "maj9" },
  { quality: "m9", set: [0, 2, 3, 7, 10], suffix: "m9" },
  { quality: "6", set: [0, 4, 7, 9], suffix: "6" },
  { quality: "m6", set: [0, 3, 7, 9], suffix: "m6" },
  { quality: "add9", set: [0, 2, 4, 7], suffix: "add9" },
  { quality: "madd9", set: [0, 2, 3, 7], suffix: "madd9" },
  { quality: "sus2", set: [0, 2, 7], suffix: "sus2" },
  // 5음 생략. 재즈 피아노는 근음·3음·7음만 치는 일이 아주 많다
  // (피아노×포르테×스캔들 같은 곡을 딸 때 나온다). 이름은 그대로 C7 이다.
  { quality: "7", set: [0, 4, 10], suffix: "7", omit5: true },
  { quality: "maj7", set: [0, 4, 11], suffix: "maj7", omit5: true },
  { quality: "m7", set: [0, 3, 10], suffix: "m7", omit5: true },
  // 근음과 5음뿐. 3음이 없어 장·단을 가를 수 없다 — 록의 파워 코드.
  { quality: "5", set: [0, 7], suffix: "5" },
];

// -------------------------------------------------------------- 철자

const LETTERS = "CDEFGAB";
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

/**
 * 근음에서 반음 몇 개 위인가 → 글자 몇 칸 위인가.
 *
 *   2(9음) → 1   3·4(3음) → 2   5(sus4) → 3   6·7·8(5음) → 4   9(6음) → 5   10·11(7음) → 6
 *
 * 감7화음의 7음(반음 9개)은 이론상 「B♭♭」 이지만 6음 자리 글자(A)로 적는다.
 * 코드표도 그렇게 적고, 처음 배우는 사람에게 겹플랫은 읽는 법부터 막힌다.
 */
const LETTER_STEP = [0, 1, 1, 2, 2, 3, 4, 4, 4, 5, 6, 6];

/** 글자 + 그 글자에서 pitchClass 까지의 샵/플랫. 셋 이상 벌어지면 null. */
function spell(letter: number, pitchClass: number): string | null {
  const l = ((letter % 7) + 7) % 7;
  let diff = (pitchClass - LETTER_PC[l] + 12) % 12;
  if (diff > 6) diff -= 12;
  if (Math.abs(diff) > 2) return null;
  return LETTERS[l] + (diff > 0 ? "#".repeat(diff) : "b".repeat(-diff));
}

const accidentals = (s: string | null): number => (s === null ? 99 : s.length - 1);

/** 근음 글자를 정한다. 조가 있으면 그 조의 몇 도인지로, 없으면 덜 지저분한 쪽으로. */
function rootLetter(root: number, quality: Quality, key: Key | null | undefined, set: readonly number[]): number {
  if (key) {
    const tonicLetter = LETTERS.indexOf(pcName(key.tonic, key)[0]);
    const [, deg] = degreeOf(root, quality, key);
    return tonicLetter + deg;
  }
  // 조가 없으면 샵으로 적을지 플랫으로 적을지를 **코드 전체의 철자**로 고른다.
  // D# 장코드는 D# F## A# 이 되지만 Eb 로 적으면 Eb G Bb — 같은 소리를 훨씬
  // 읽기 쉽게 적는다. 비기면 샵.
  const sharp = LETTERS.indexOf(pcName(root)[0]);
  const flat = LETTERS.indexOf(pcName(root, { tonic: 5, mode: "major" })[0]);
  const cost = (letter: number) =>
    set.reduce((sum, i) => sum + accidentals(spell(letter + LETTER_STEP[i], (root + i) % 12)), 0);
  return cost(flat) < cost(sharp) ? flat : sharp;
}

export type ChordInfo = {
  /** 「Am7」. 베이스가 근음이 아니면 「Am7/C」. */
  name: string;
  /** 베이스를 뺀 이름. 「Am7」 */
  base: string;
  root: number;
  bass: number;
  quality: Quality;
  /** 0 = 기본형, 1 = 3음이 베이스(1전위), 2 = 5음, 3 = 7음. 그 밖의 음이 베이스면 null. */
  inversion: number | null;
  omit5: boolean;
  /** 코드의 음을 근음부터 철자대로. 「F Ab C」 */
  tones: string[];
};

/**
 * 음 묶음 → 코드. 음이 둘 미만이거나 표에 없으면 null.
 *
 * @param pitches MIDI 음높이 (옥타브 포함). 순서는 상관없다
 * @param key     있으면 그 조의 몇 도인지에 맞춰 철자를 정한다
 */
export function identifyChord(pitches: readonly number[], key?: Key | null): ChordInfo | null {
  if (pitches.length < 2) return null;
  const bass = pc(Math.min(...pitches));
  const pcs = [...new Set(pitches.map(pc))];
  if (pcs.length < 2) return null; // 같은 음을 옥타브로만 겹친 것

  type Hit = { root: number; t: Template; order: number };
  const hits: Hit[] = [];
  for (const root of pcs) {
    const rel = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b);
    TEMPLATES.forEach((t, order) => {
      if (t.set.length === rel.length && t.set.every((v, i) => v === rel[i])) {
        hits.push({ root, t, order });
      }
    });
  }
  if (hits.length === 0) return null;

  // 베이스가 근음인 것 먼저, 그 다음 표 순서.
  hits.sort((a, b) => Number(b.root === bass) - Number(a.root === bass) || a.order - b.order);
  const { root, t } = hits[0];

  const letter = rootLetter(root, t.quality, key, t.set);
  const tones = t.set.map((i) => spell(letter + LETTER_STEP[i], (root + i) % 12) ?? pcName(root + i, key));
  const baseName = tones[0] + t.suffix;
  const bassIndex = t.set.indexOf((bass - root + 12) % 12);
  const slash = root === bass ? "" : `/${tones[bassIndex] ?? pcName(bass, key)}`;
  return {
    name: baseName + slash,
    base: baseName,
    root,
    bass,
    quality: t.quality,
    inversion: inversionOf(t, root, bass),
    omit5: !!t.omit5,
    tones,
  };
}

function inversionOf(t: Template, root: number, bass: number): number | null {
  if (root === bass) return 0;
  const rel = (bass - root + 12) % 12;
  // 3음 (장3·단3, sus 는 sus 음을 3음 자리로 친다)
  if ([3, 4].includes(rel) || (t.quality === "sus4" && rel === 5) || (t.quality === "sus2" && rel === 2)) return 1;
  if ([6, 7, 8].includes(rel)) return 2;
  if ([9, 10, 11].includes(rel) && t.set.length >= 4) return 3;
  return null;
}

/** 「1전위 (3음이 맨 아래)」 같은 안내. 기본형이면 빈 문자열. */
export function inversionLabel(info: ChordInfo): string {
  switch (info.inversion) {
    case 0:
      return "";
    case 1:
      return "1전위 (3음이 맨 아래)";
    case 2:
      return "2전위 (5음이 맨 아래)";
    case 3:
      return "3전위 (7음이 맨 아래)";
    default:
      return "베이스가 코드 밖의 음";
  }
}

// ----------------------------------------------------------- 로마숫자

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];

/**
 * 으뜸음에서 몇 반음 떨어졌나 → [♭·♯, 몇 도(0~6)].
 *
 * 장조는 장음계 자리를 기준으로 한다 (J팝 코드 이론의 「♭VII」 「♭VI」 그대로).
 * 단조는 **단음계 자리**를 기준으로 한다 — 단조 곡에서 III · VI · VII 는 조 안의
 * 코드라 ♭ 을 붙이지 않는다 (교과서 표기). 그 대신 단조에서 7음을 올린 V 의
 * 이끎음 같은 「올린 음」 이 ♯ 으로 나온다.
 *
 * 6반음(증4도·감5도)은 코드 종류로 가른다. 반감7·감화음이면 ♯IV (J팝의
 * ♯IVm7♭5 진행), 나머지는 ♭V.
 */
const MAJOR_DEGREE: Record<number, [string, number]> = {
  0: ["", 0], 1: ["♭", 1], 2: ["", 1], 3: ["♭", 2], 4: ["", 2], 5: ["", 3],
  6: ["♭", 4], 7: ["", 4], 8: ["♭", 5], 9: ["", 5], 10: ["♭", 6], 11: ["", 6],
};
const MINOR_DEGREE: Record<number, [string, number]> = {
  0: ["", 0], 1: ["♭", 1], 2: ["", 1], 3: ["", 2], 4: ["♯", 2], 5: ["", 3],
  6: ["♭", 4], 7: ["", 4], 8: ["", 5], 9: ["♯", 5], 10: ["", 6], 11: ["♯", 6],
};

function degreeOf(root: number, quality: Quality, key: Key): [string, number] {
  const d = (root - key.tonic + 12) % 12;
  if (d === 6 && (quality === "m7b5" || quality === "dim" || quality === "dim7")) return ["♯", 3];
  return (key.mode === "major" ? MAJOR_DEGREE : MINOR_DEGREE)[d];
}

const LOWER = new Set<Quality>(["min", "dim", "m7", "m7b5", "dim7", "mMaj7", "m6", "madd9", "m9"]);

const ROMAN_SUFFIX: Record<Quality, string> = {
  maj: "", min: "", dim: "°", aug: "+", sus4: "sus4", sus2: "sus2", "5": "5",
  "7": "7", maj7: "maj7", m7: "7", m7b5: "ø7", dim7: "°7", mMaj7: "(maj7)", "7sus4": "7sus4",
  "6": "6", m6: "6", add9: "add9", madd9: "add9", "9": "9", maj9: "maj9", m9: "9",
};

export type RomanInfo = {
  /** 「vi7」「♭VII」「V7」 */
  numeral: string;
  /** 코드의 음이 전부 그 조 안에 있는가. */
  diatonic: boolean;
  /** 조 밖의 음 (코드 철자대로). 「Ab」 처럼. */
  outside: string[];
};

export function romanNumeral(info: ChordInfo, _pitches: readonly number[], key: Key): RomanInfo {
  const [acc, deg] = degreeOf(info.root, info.quality, key);
  let numeral = NUMERALS[deg];
  if (LOWER.has(info.quality)) numeral = numeral.toLowerCase();
  numeral = acc + numeral + ROMAN_SUFFIX[info.quality];

  // 조 밖의 음은 **코드의 철자대로** 알려 준다 (Fm 의 Ab). 근음부터 순서대로.
  const steps = SCALE_STEPS[key.mode];
  const tmpl = TEMPLATES.find((t) => t.quality === info.quality && !!t.omit5 === info.omit5);
  const outside: string[] = [];
  tmpl?.set.forEach((i, idx) => {
    const p = (info.root + i) % 12;
    if (!steps.includes((p - key.tonic + 12) % 12)) outside.push(info.tones[idx]);
  });
  return { numeral, diatonic: outside.length === 0, outside };
}

/**
 * 화면 한 줄용. 「Am7 · vi7」, 조 밖 음이 있으면 「E · V · 조 밖 G#」.
 * 이름을 못 붙이면 null — 지어내지 않는다.
 */
export function chordLine(pitches: readonly number[], key?: Key | null): string | null {
  const info = identifyChord(pitches, key);
  if (!info) return null;
  if (!key) return info.name;
  const r = romanNumeral(info, pitches, key);
  return `${info.name} · ${r.numeral}${r.diatonic ? "" : ` · 조 밖 ${r.outside.join(" ")}`}`;
}
