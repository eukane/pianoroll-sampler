/**
 * UTAU 원음설정(`oto.ini`) 읽기.
 *
 * UTAU 음원은 암호화가 없다. **WAV 파일 더미 + oto.ini 텍스트** 한 장이 전부다.
 * 그래서 이 앱이 이미 갖고 있는 "폴더째로 WAV 읽기" 위에 얹을 수 있다.
 *
 *     _あ.wav=あ,24,56,73,5,20
 *     └파일명┘ └별칭┘ └─── 다섯 숫자 (전부 밀리초) ───┘
 *
 * 다섯 숫자의 뜻 (UTAU 규약):
 *
 *     offset   파일 앞을 이만큼 버린다. 여기서부터가 쓸 구간이다
 *     consonant 자음 구간. **여기는 늘이지 않는다** — 늘이면 "카" 가 "크아" 가 된다
 *     cutoff   파일 뒤를 버리는 양. **양수면 파일 끝에서부터, 음수면 offset 에서부터**
 *              (이 부호 규칙이 UTAU 포맷에서 제일 많이 틀리는 자리다)
 *     preutter 선행발성. 이 지점이 **박에 맞는다** — 즉 소리는 박보다 먼저 시작한다
 *     overlap  앞 음과 겹쳐 섞는 구간
 *
 * ## 한 파일에 별칭이 여러 개 붙는다
 *
 *     _あ.wav=あ        ← 그냥 「あ」
 *     _あ.wav=- あ      ← **무음 뒤**에 오는 「あ」 (첫 음)
 *     _あ.wav=* あ      ← 앞 음에 **이어지는** 「あ」
 *
 * 같은 WAV 를 쓰지만 설정값이 다르다. 이어지는 음은 앞을 더 잘라내고 선행발성을
 * 크게 잡는다. 실제 테토 단독음 음원이 그렇다 — 「あ」는 offset 24 인데
 * 「* あ」는 78 이다.
 *
 * ## 왜 별칭을 정규화하는가
 *
 * 사용자는 가사에 「あ」라고 쓴다. 앞 음이 있는지 없는지는 **앱이 안다.**
 * 그래서 별칭을 (머리표, 소리) 로 갈라서 넣어 두고, 재생할 때 상황에 맞는
 * 걸 고른다. 사용자가 「- あ」를 직접 칠 이유가 없다.
 *
 * 파일은 Shift-JIS(CP932)다. 브라우저의 `TextDecoder("shift_jis")` 가 읽는다 —
 * 실제로 확인했다.
 */

/** oto.ini 한 줄. 시간 단위는 전부 **밀리초**다 (초로 바꾸는 건 재생하는 쪽에서). */
export type OtoEntry = {
  /** 이 설정이 가리키는 WAV 파일명 (폴더 안 이름 그대로). */
  fileName: string;
  /** oto.ini 에 적힌 별칭 그대로. 비어 있으면 파일명에서 만든다. */
  alias: string;
  /** 별칭에서 머리표를 뗀 소리. 「- あ」 → 「あ」 */
  sound: string;
  /** 머리표. `""`(그냥) · `"-"`(무음 뒤) · `"*"`(이어지는 음) · 그 밖(앞 음의 모음 등). */
  prefix: string;
  offset: number;
  consonant: number;
  cutoff: number;
  preutter: number;
  overlap: number;
};

/** 소리 하나에 딸린 상황별 설정. */
export type OtoIndex = Map<string, OtoEntry[]>;

/**
 * oto.ini 본문을 줄 단위로 읽는다.
 *
 * 깨진 줄은 **버리되 세어 둔다.** 남의 음원이라 별별 줄이 다 들어 있는데,
 * 조용히 넘기면 "왜 이 글자만 소리가 안 나지" 를 사용자가 혼자 알아내야 한다.
 */
export function parseOto(text: string): { entries: OtoEntry[]; skipped: string[] } {
  const entries: OtoEntry[] = [];
  const skipped: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const eq = line.indexOf("=");
    if (eq < 0) {
      skipped.push(line);
      continue;
    }
    const fileName = line.slice(0, eq).trim();
    const parts = line.slice(eq + 1).split(",");
    if (!fileName || parts.length < 6) {
      skipped.push(line);
      continue;
    }

    const alias = parts[0].trim();
    const nums = parts.slice(1, 6).map((p) => Number(p.trim()));
    if (nums.some((n) => !Number.isFinite(n))) {
      skipped.push(line);
      continue;
    }

    const [offset, consonant, cutoff, preutter, overlap] = nums;
    // 별칭이 비면 파일명에서 만든다. `_あ.wav` → `あ`
    const named = alias || fileName.replace(/\.wav$/i, "").replace(/^_/, "");
    const { prefix, sound } = splitAlias(named);
    entries.push({ fileName, alias: named, sound, prefix, offset, consonant, cutoff, preutter, overlap });
  }

  return { entries, skipped };
}

/**
 * 별칭을 머리표와 소리로 가른다.
 *
 *     "- あ"  → { prefix: "-", sound: "あ" }
 *     "* あ"  → { prefix: "*", sound: "あ" }
 *     "a か"  → { prefix: "a", sound: "か" }   (연속음: 앞 음의 모음이 머리표)
 *     "あ"    → { prefix: "",  sound: "あ" }
 */
export function splitAlias(alias: string): { prefix: string; sound: string } {
  const space = alias.indexOf(" ");
  if (space > 0) {
    return { prefix: alias.slice(0, space), sound: alias.slice(space + 1).trim() };
  }
  return { prefix: "", sound: alias };
}

/**
 * 사용자가 적은 글자를 이 음원의 소리 이름으로 바꾼다.
 *
 * 음원마다 별칭에 **꼬리표**가 붙어 있는 경우가 많다. 같은 성우의 다른 창법을
 * 한 이름 공간에서 구분하려고 UTAU 가 쓰는 관습이다.
 *
 *     기본 단독음    「か」
 *     속삭임 음원    「か囁」   (囁 = 속삭임)
 *     약한 음원      「か弱」
 *     매끄러운 음원  「か滑」
 *
 * 사용자는 「か」라고 적지 실제 꼬리표까지 적지 않는다. 그대로 찾으면 못 찾고,
 * **음원 여섯 개 중 넷이 아예 한 글자도 못 부르는 상태**가 된다. 실제로 그랬다.
 *
 * 그래서 정확히 없으면 **그 글자로 시작하는 가장 짧은 이름**을 쓴다. 정확한
 * 이름이 언제나 먼저이고, 짧은 쪽을 고르니 「か」가 「かぁ」로 새지 않는다.
 */
export function resolveSound(index: OtoIndex, sound: string): string | null {
  if (index.has(sound)) return sound;
  let best: string | null = null;
  for (const key of index.keys()) {
    if (!key.startsWith(sound)) continue;
    if (best === null || key.length < best.length) best = key;
  }
  return best;
}

/** 소리별로 묶는다. 가사 「あ」로 찾으면 「あ」「- あ」「* あ」가 다 나온다. */
export function indexOto(entries: OtoEntry[]): OtoIndex {
  const index: OtoIndex = new Map();
  for (const e of entries) {
    const list = index.get(e.sound);
    if (list) list.push(e);
    else index.set(e.sound, [e]);
  }
  return index;
}

/**
 * 이 가사를, 이 상황에서 쓸 설정 하나를 고른다.
 *
 * `after` 는 앞 음이 무엇이었나다 — 없으면(첫 음이거나 쉬었으면) `null`.
 * 고르는 차례는 실제로 소리가 자연스러운 순서다.
 *
 *   1. 앞 음의 **모음**에 맞춘 연속음 (「a か」) — 있으면 제일 매끄럽다
 *   2. 이어지는 음 (「* か」)
 *   3. 그냥 (「か」)
 *   4. 무음 뒤 (「- か」)
 *
 * 첫 음이면 4번을 먼저 본다. 무음에서 시작하는 소리는 자음이 또렷하게
 * 녹음돼 있어서, 그걸 곡 중간에 쓰면 매번 새로 말하는 것처럼 들린다.
 */
export function pickEntry(index: OtoIndex, sound: string, afterVowel: string | null): OtoEntry | null {
  const key = resolveSound(index, sound);
  const list = key === null ? undefined : index.get(key);
  if (!list || list.length === 0) return null;
  const byPrefix = (p: string) => list.find((e) => e.prefix === p) ?? null;

  if (afterVowel === null) return byPrefix("-") ?? byPrefix("") ?? list[0];
  return byPrefix(afterVowel) ?? byPrefix("*") ?? byPrefix("") ?? byPrefix("-") ?? list[0];
}

/**
 * 이 설정이 실제로 파일의 어느 구간을 쓰는가 (초 단위).
 *
 * `cutoff` 의 부호 규칙이 여기서 풀린다. 양수면 **파일 끝에서** 그만큼 버리고,
 * 음수면 **offset 에서** 그 길이만큼만 쓴다. 부호를 반대로 읽으면 소리가
 * 통째로 잘리거나 뒤쪽 잡음까지 다 들어간다.
 */
export function regionOf(entry: OtoEntry, fileSeconds: number): { start: number; end: number } {
  const start = entry.offset / 1000;
  const end =
    entry.cutoff < 0 ? start + -entry.cutoff / 1000 : Math.max(start, fileSeconds - entry.cutoff / 1000);
  return { start, end };
}

/** 모음 하나로 줄인다. 다음 음이 이어 붙을 때 어느 연속음을 쓸지 정하는 데 쓴다. */
export function vowelOf(sound: string): string | null {
  for (let i = sound.length - 1; i >= 0; i -= 1) {
    const v = KANA_VOWEL[sound[i]];
    if (v) return v;
  }
  return null;
}

/**
 * 가나 → 모음.
 *
 * 작은 가나(ゃゅょ)가 뒤에 붙으므로 **뒤에서부터** 본다 — 「きゃ」의 모음은
 * 「き」의 i 가 아니라 「ゃ」의 a 다. 가타카나(ヴァ 등)도 별칭에 나와서 같이 넣는다.
 */
const KANA_VOWEL: Record<string, string> = {};
for (const [vowel, kana] of [
  ["a", "あかさたなはまやらわがざだばぱゃぁアカサタナハマヤラワガザダバパャァ"],
  ["i", "いきしちにひみりぎじぢびぴぃイキシチニヒミリギジヂビピィ"],
  ["u", "うくすつぬふむゆるぐずづぶぷゅぅヴウクスツヌフムユルグズヅブプュゥヴ"],
  ["e", "えけせてねへめれげぜでべぺぇエケセテネヘメレゲゼデベペェ"],
  ["o", "おこそとのほもよろをごぞどぼぽょぉオコソトノホモヨロヲゴゾドボポョォ"],
  ["n", "んン"],
] as const) {
  for (const ch of kana) KANA_VOWEL[ch] = vowel;
}
