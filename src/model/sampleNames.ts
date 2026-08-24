/**
 * 샘플 파일 이름에서 음높이와 세기 층을 읽어낸다.
 *
 * 국악기는 SF2 로 배포되는 게 거의 없고 **음 하나가 WAV 파일 하나**로 온다.
 * 국립국악원 음원도 그렇다. 그래서 폴더를 통째로 받아 파일명만 보고 어느
 * 건반에 놓을지 정해야 한다. 이름 규칙이 배포처마다 달라서 몇 가지를 받는다.
 *
 *     가야금_C4.wav        음이름 + 옥타브
 *     gayageum-60.wav      MIDI 번호
 *     sax_A#3_mf.wav       올림표 + 세기 층
 *     해금_Bb3_f.wav       내림표
 *
 * **못 알아들은 건 조용히 버리지 않는다.** 알아듣지 못한 파일은 그대로
 * 돌려주고 화면에서 사람이 직접 건반을 골라 준다. 20개를 넣었는데 12개만
 * 소리가 나면 왜 그런지 알 수가 없다.
 *
 * 이 파일은 순수 계산만 한다 — 브라우저 없이 테스트하려고 오디오 계층 밖에 뒀다.
 */

/** 세기 층. 여린 소리와 센 소리를 따로 녹음해 두는 음원이 있다. */
export type Layer = "pp" | "p" | "mp" | "mf" | "f" | "ff";

export const LAYERS: Layer[] = ["pp", "p", "mp", "mf", "f", "ff"];

/** 층마다 대략 어느 세기 구간을 맡는지 (0~127). */
const LAYER_VELOCITY: Record<Layer, number> = {
  pp: 20,
  p: 40,
  mp: 60,
  mf: 80,
  f: 104,
  ff: 124,
};

export function layerVelocity(layer: Layer): number {
  return LAYER_VELOCITY[layer];
}

export type ParsedName = {
  /** MIDI 노트 번호. 못 알아들었으면 null. */
  pitch: number | null;
  layer: Layer | null;
  /** 음높이·세기를 빼고 남은 부분. 악기 이름으로 쓴다. */
  label: string;
};

const NOTE_STEPS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** `C4` `A#3` `Bb-1` → MIDI 번호. 아니면 null. (C4 = 60) */
export function noteNameToMidi(token: string): number | null {
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d{1,2})$/.exec(token);
  if (!m) return null;
  const step = NOTE_STEPS[m[1].toLowerCase()];
  const accidental = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "" ? 0 : -1;
  const octave = Number(m[3]);
  const pitch = (octave + 1) * 12 + step + accidental;
  return pitch >= 0 && pitch <= 127 ? pitch : null;
}

/**
 * 파일 이름 하나를 읽는다.
 *
 * 음이름을 먼저 찾고, 없을 때만 맨숭맨숭한 숫자를 MIDI 번호로 본다.
 * 순서가 중요하다 — `해금_2_A3.wav` 같은 이름에서 "2" 를 음높이로 잡으면
 * 안 된다.
 */
export function parseSampleName(fileName: string): ParsedName {
  const base = fileName.replace(/\.[^.]+$/, "");
  const tokens = base.split(/[_\-\s.()]+/).filter(Boolean);

  let pitch: number | null = null;
  let pitchAt = -1;
  let layer: Layer | null = null;
  let layerAt = -1;

  tokens.forEach((token, i) => {
    if (pitch === null) {
      const fromName = noteNameToMidi(token);
      if (fromName !== null) {
        pitch = fromName;
        pitchAt = i;
      }
    }
    if (layer === null) {
      const lower = token.toLowerCase();
      if ((LAYERS as string[]).includes(lower)) {
        layer = lower as Layer;
        layerAt = i;
      }
    }
  });

  if (pitch === null) {
    // 음이름이 없을 때만 숫자를 본다. 사람이 붙이는 일련번호(01, 02…)와
    // 헷갈릴 수 있어서 사람 목소리 범위 밖까지 넓게 잡지는 않는다.
    tokens.forEach((token, i) => {
      if (pitch !== null || i === layerAt) return;
      if (!/^\d{1,3}$/.test(token)) return;
      const value = Number(token);
      if (value >= 12 && value <= 127) {
        pitch = value;
        pitchAt = i;
      }
    });
  }

  const label = tokens.filter((_, i) => i !== pitchAt && i !== layerAt).join(" ").trim();
  return { pitch, layer, label: label || base };
}

/** 여러 파일에서 공통으로 쓰이는 이름. 트랙 이름으로 쓴다. */
export function commonLabel(names: string[]): string {
  const labels = names.map((n) => parseSampleName(n).label).filter(Boolean);
  if (labels.length === 0) return "샘플 악기";
  // 제일 자주 나온 것을 쓴다. 파일마다 조금씩 다를 수 있다.
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
