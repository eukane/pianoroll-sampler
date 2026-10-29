/**
 * 예제 곡 셋째 — **단조 아르페지오 위의 선율, 16마디.**
 *
 * ## 왜 이 곡인가
 *
 * "죠죠의 il vento d'oro 를 예제로 넣어 달라" 는 요청에서 나왔다. 그 곡은
 * **저작권이 있는 남의 곡**이라 옮겨 적어 이 저장소에 넣고 공개 배포할 수
 * 없다. 대신 그 곡이 왜 그렇게 들리는지 — **쉬지 않고 달리는 단조 아르페지오
 * 위에 느린 선율이 얹힌다** — 를 가져와 직접 썼다. 짜임새는 흔한 것이고
 * 저작권이 붙지 않는다. 가락은 이 파일에서 새로 지었다.
 *
 * 화음 진행도 일부러 제일 흔한 것을 골랐다 — Em - C - G - D (i-VI-III-VII).
 * 예제의 목적은 자랑이 아니라 **알아보게 하는 것**이라, 익숙한 쪽이 맞다.
 *
 * ## 앞의 두 예제와 어떻게 다른가
 *
 *     첫째(국악풍)   둘째(일렉트로닉)   이 곡
 *     ------------------------------------------------
 *     100 BPM       128 BPM           132 BPM
 *     8마디         16마디            16마디
 *     3트랙         5트랙(드럼)        4트랙(드럼 없음)
 *     5음계         화음 진행          자연 단음계
 *     조용함        드롭이 열림        쉬지 않고 달림
 *
 * 드럼은 넣지 않았다. 이 곡을 미는 건 드럼이 아니라 **16분음표 아르페지오**다.
 * 그래서 사운드폰트가 없어도 곡이 곡으로 들린다 (둘째 예제는 드럼이 곡
 * 자체라 음원이 없으면 반쪽이 된다).
 *
 * ## 조교를 보여 주는 곡이기도 하다
 *
 * 선율에 손본 자리가 넷이다. 앞의 두 예제와 달리 **직접 그린 음정 곡선**이
 * 하나 들어 있다 — 56박의 긴 음이 부풀었다 제자리로 돌아온다. 노트를 톡 쳐서
 * 열어 보면 그 곡선이 그려져 있다. 기능 설명서보다 이게 빠르다.
 *
 * 세기도 일부러 흔들어 뒀다. 아르페지오의 첫 박만 세게 치면 같은 음형인데도
 * 마디가 구분되어 들린다 — 세기 조절이 무엇을 하는지 그 자리에서 들린다.
 */

import type { CurvePoint, Ornament } from "./ornament.ts";
import type { Note, Project, Track } from "./types.ts";
import { makeNote, newId } from "./project.ts";
import { packPresetId } from "./preset.ts";

/** GM 프로그램 번호. */
const PIANO = 0; // Acoustic Grand — 아르페지오
const STRINGS = 48; // String Ensemble 1 — 선율
const PAD = 89; // Pad 2 (warm)
const BASS = 32; // Acoustic Bass

const BARS = 16;
const BPB = 4;

/**
 * 마디마다의 화음 (E 단조). 마지막 마디만 으뜸화음으로 돌아온다 —
 * 그냥 두면 D 로 끝나서 곡이 안 끝난 것처럼 들린다.
 */
const PROGRESSION: number[][] = [
  [52, 55, 59], // Em  (E3 G3 B3)
  [48, 52, 55], // C   (C3 E3 G3)
  [55, 59, 62], // G   (G3 B3 D4)
  [50, 54, 57], // D   (D3 F#3 A3)
];
const BASS_ROOT = [40, 36, 43, 38]; // E2 C2 G2 D2

const chordAt = (bar: number): number[] =>
  bar === BARS - 1 ? PROGRESSION[0] : PROGRESSION[bar % PROGRESSION.length];
const rootAt = (bar: number): number =>
  bar === BARS - 1 ? BASS_ROOT[0] : BASS_ROOT[bar % BASS_ROOT.length];

// ------------------------------------------------------------ 아르페지오

/**
 * 16분음표로 쉬지 않고 돈다. 한 마디에 열여섯 개.
 *
 * 화음의 세 음에 한 옥타브 위 뿌리음을 더해 네 음으로 돌린다. 세 음만
 * 돌리면 마디마다 시작 음이 달라져서 음형이 흔들리는데, 네 음이면 마디마다
 * 같은 자리에서 시작해 **달리는 느낌**이 산다.
 */
function arpNotes(): Note[] {
  const notes: Note[] = [];
  for (let bar = 0; bar < BARS; bar += 1) {
    const c = chordAt(bar);
    const shape = [c[0], c[1], c[2], c[0] + 12];
    for (let i = 0; i < 16; i += 1) {
      // 마디 첫 박만 세게. 같은 음형인데도 마디가 구분되어 들린다.
      const velocity = i === 0 ? 104 : i % 4 === 0 ? 88 : 74;
      notes.push(makeNote(shape[i % 4], bar * BPB + i * 0.25, 0.25, velocity));
    }
  }
  return notes;
}

// ------------------------------------------------------------------ 선율

/** [시작 박, 음높이, 길이 박] — 5마디(16박)부터 들어온다. E 자연단음계. */
const MELODY: [number, number, number][] = [
  // 5~8마디 — 낮게 시작한다
  [16, 71, 1.5], [17.5, 69, 0.5], [18, 67, 2],
  [20, 64, 1.5], [21.5, 67, 0.5], [22, 69, 2],
  [24, 71, 1], [25, 74, 1], [26, 71, 2],
  [28, 69, 1.5], [29.5, 66, 0.5], [30, 62, 2],
  // 9~12마디 — 한 옥타브 가까이 올라가며 열린다
  [32, 76, 1.5], [33.5, 74, 0.5], [34, 71, 2],
  [36, 72, 1.5], [37.5, 74, 0.5], [38, 76, 2],
  [40, 79, 2], [42, 76, 2],
  [44, 74, 1.5], [45.5, 71, 0.5], [46, 69, 2],
  // 13~16마디 — 가장 높은 자리를 지나 내려앉는다
  [48, 71, 2], [50, 76, 2],
  [52, 74, 2], [54, 72, 2],
  [56, 71, 4],
  [60, 64, 4],
];

/**
 * 손본 자리 넷. 앞의 두 예제와 같은 이유로 아껴 썼다 — 전부 꺾으면 트랙에
 * 걸어 둔 것과 다를 게 없어진다.
 *
 *     16박  선율이 처음 들어오는 음     끌어올림
 *     40박  가장 높은 자리(솔5)        떨림
 *     56박  4박짜리 긴 음             직접 그린 곡선 (아래 참고)
 *     60박  마지막 음                 흘러내림
 */
const MELODY_ORNAMENTS: Record<number, Ornament> = {
  16: "scoop",
  40: "vibrato",
  56: "free",
  60: "fall",
};

/**
 * 56박의 긴 음에 그려 둔 곡선.
 *
 * 4박(1.8초)을 그냥 뻗으면 밋밋하다. 살짝 아래에서 붙여 올라와 가운데에서
 * 반음 가까이 부풀었다가 제자리로 돌아온다 — 현악기가 긴 음을 미는 그
 * 소리다. 프리셋 넷으로는 이 모양이 안 나온다. 그래서 여기 하나를 둬서
 * **직접 그리기가 무엇을 할 수 있는지** 열어 보면 바로 보이게 했다.
 */
const SWELL: CurvePoint[] = [
  { at: 0, cents: -60 },
  { at: 0.12, cents: 0 },
  { at: 0.45, cents: 70 },
  { at: 0.62, cents: 90 },
  { at: 0.85, cents: 20 },
  { at: 1, cents: 0 },
];

function melodyNotes(): Note[] {
  return MELODY.map(([start, pitch, length]) => {
    // 마디 첫 박은 세게, 이어지는 음은 여리게. 선율에 숨이 생긴다.
    const note = makeNote(pitch, start, length, start % BPB === 0 ? 108 : 92);
    const o = MELODY_ORNAMENTS[start];
    if (o) {
      note.ornament = o;
      note.ornamentAmount = o === "vibrato" ? 0.7 : 0.5;
      if (o === "free") note.bend = SWELL.map((p) => ({ ...p }));
    }
    return note;
  });
}

// ------------------------------------------------------------- 패드 · 베이스

/** 3마디부터. 아르페지오만으로 두 마디를 두면 곡이 열리는 자리가 생긴다. */
function padNotes(): Note[] {
  const notes: Note[] = [];
  for (let bar = 2; bar < BARS; bar += 1) {
    for (const pitch of chordAt(bar)) {
      notes.push(makeNote(pitch + 12, bar * BPB, BPB, 58));
    }
  }
  return notes;
}

/** 3마디부터. 뿌리음을 2박씩 둘로 나눠 짚는다 — 곡이 앞으로 나간다. */
function bassNotes(): Note[] {
  const notes: Note[] = [];
  for (let bar = 2; bar < BARS; bar += 1) {
    const root = rootAt(bar);
    notes.push(makeNote(root, bar * BPB, 2, 100));
    notes.push(makeNote(root, bar * BPB + 2, 2, 84));
  }
  return notes;
}

// -------------------------------------------------------------------- 조립

function track(
  name: string,
  presetId: number,
  notes: Note[],
  volume: number,
  pan: number,
  reverbSend: number,
): Track {
  return {
    id: newId("trk"),
    name,
    source: { kind: "sf2", presetId },
    notes,
    volume,
    pan,
    muted: false,
    reverbSend,
  };
}

export function minorSong(): Project {
  return {
    bpm: 132,
    bars: BARS,
    timeSig: [4, 4],
    // E 자연단음계 (위 설명). Em-C-G-D 가 i-VI-III-VII 로 읽힌다.
    key: { tonic: 4, mode: "minor" },
    tracks: [
      track("선율", packPresetId(0, STRINGS), melodyNotes(), 0.82, 0, 0.35),
      track("아르페지오", packPresetId(0, PIANO), arpNotes(), 0.6, -0.2, 0.2),
      track("패드", packPresetId(0, PAD), padNotes(), 0.4, 0.25, 0.45),
      track("베이스", packPresetId(0, BASS), bassNotes(), 0.75, 0, 0.1),
    ],
  };
}
