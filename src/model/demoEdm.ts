/**
 * 예제 곡 둘째 — **일렉트로닉 (NCS 풍) 16마디.**
 *
 * 첫 예제(demoSong.ts)는 5음계에 세 트랙짜리 조용한 곡이다. 그것만 있으면 이
 * 앱이 그런 곡만 만드는 물건처럼 보인다. 성격이 정반대인 곡을 하나 더 둬서
 * **같은 도구로 다른 장르가 나온다**는 걸 보여 준다.
 *
 * 그래서 첫 예제와 일부러 반대로 갔다.
 *
 *     첫 예제        이 곡
 *     -----------------------------------------
 *     100 BPM       128 BPM
 *     8마디         16마디 (인트로 → 빌드 → 드롭)
 *     3트랙         5트랙 (드럼 포함)
 *     5음계         단조 + 화음 진행 (Am-F-C-G)
 *     1/8 격자      1/16 격자
 *
 * ## 드럼을 넣었다
 *
 * 첫 예제에서는 드럼을 뺐다. 사운드폰트가 없으면 낮은 톱니파 웅웅거림이 될
 * 뿐이라서다. 그런데 이 장르는 **드럼이 곡 자체**다. 4분음표 킥이 없으면
 * 일렉트로닉이 아니라 그냥 신스 소리다. 그래서 넣되, 사운드폰트 없이 이 곡을
 * 열면 화면이 그 사실을 알려 준다 (ui/exportPanel.ts).
 *
 * ## 화음 진행
 *
 * Am - F - C - G 를 네 마디마다 돈다. 이 장르에서 제일 흔한 진행이고, 그래서
 * 듣는 사람이 "아 이런 곡" 하고 바로 알아듣는다. 예제의 목적이 자랑이 아니라
 * **알아보게 하는 것**이라 익숙한 쪽을 골랐다.
 *
 * ## 구조
 *
 *     1~2마디    패드만          — 시작
 *     3~4마디    + 아르페지오·하이햇
 *     5~8마디    + 킥·클랩·베이스  — 쌓기 (8마디 끝에 필인)
 *     9~16마디   + 리드          — 드롭
 *
 * 리드가 9마디에서 들어오면서 곡이 열린다. 그 자리 첫 음에 **끌어올림**을
 * 걸어 뒀다 — 드롭으로 미끄러져 들어가는 그 소리다. 꾸밈이 국악에만 쓰는
 * 게 아니라는 걸 여기서 보여 준다.
 */

import { makeNote, newId } from "./project.ts";
import { packPresetId } from "./preset.ts";
import type { Ornament } from "./ornament.ts";
import type { Note, Project, Track } from "./types";

/** GM 프로그램 번호(0부터). */
const LEAD_SAW = 81; // Lead 2 (sawtooth)
const PLUCK = 80; // Lead 1 (square) — 아르페지오
const PAD = 89; // Pad 2 (warm)
const SYNTH_BASS = 38; // Synth Bass 1

/** GM 드럼 건반 번호. 드럼 킷에서는 음높이가 곧 악기다. */
const KICK = 36;
const CLAP = 39;
const HAT = 42; // 닫은 하이햇
const OPEN_HAT = 46;
const CRASH = 49;

const BARS = 16;
const BPB = 4;

/** 네 마디마다 도는 화음. 마디 → 쌓아 올린 세 음. */
const PROGRESSION: number[][] = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [60, 64, 67], // C
  [55, 59, 62], // G
];

/** 마디마다의 베이스 뿌리음. */
const BASS_ROOT = [33, 29, 36, 31]; // A1 F1 C2 G1

const chordAt = (bar: number) => PROGRESSION[bar % PROGRESSION.length];
const rootAt = (bar: number) => BASS_ROOT[bar % BASS_ROOT.length];

// ------------------------------------------------------------------ 리드

/** [시작 박, 음높이, 길이 박] — 9마디(32박)부터 들어온다. */
const LEAD: [number, number, number][] = [
  [32, 76, 1.5], [33.5, 74, 0.5], [34, 72, 1], [35, 74, 1],
  [36, 77, 2], [38, 76, 2],
  [40, 72, 1], [41, 76, 1], [42, 79, 2],
  [44, 76, 1], [45, 74, 1], [46, 71, 2],

  [48, 76, 1.5], [49.5, 74, 0.5], [50, 72, 1], [51, 74, 1],
  [52, 77, 2], [54, 81, 2],
  [56, 79, 1], [57, 76, 1], [58, 72, 2],
  [60, 74, 1], [61, 71, 1], [62, 69, 2],
];

/**
 * 손으로 손본 자리. 셋뿐인 건 첫 예제와 같은 이유다 — 기교는 아껴 써야 기교다.
 *
 *     32박  드롭이 열리는 첫 음    끌어올림
 *     48박  둘째 드롭의 첫 음      끌어올림
 *     54박  제일 높은 자리(라5)    떨림
 */
const LEAD_ORNAMENTS: Record<number, Ornament> = {
  32: "scoop",
  48: "scoop",
  54: "vibrato",
};

function leadNotes(): Note[] {
  return LEAD.map(([start, pitch, length]) => {
    const note = makeNote(pitch, start, length, start % BPB === 0 ? 112 : 98);
    const o = LEAD_ORNAMENTS[start];
    if (o) {
      note.ornament = o;
      note.ornamentAmount = o === "scoop" ? 0.5 : 0.45;
    }
    return note;
  });
}

// -------------------------------------------------------------- 아르페지오

/**
 * 8분음표로 화음을 굴린다. 두 박에 여덟 음, 한 마디에 두 번.
 *
 * 16분음표가 이 장르에 더 흔하지만 8분으로 잡았다. 앱의 기본 스냅이 1/8 이라
 * 열자마자 손으로 고쳐도 격자가 안 어긋나고, 128BPM 에서 8분음표는 0.23초라
 * 뜯는 리듬으로 충분히 빠르다.
 */
function arpNotes(): Note[] {
  const notes: Note[] = [];
  for (let bar = 2; bar < BARS; bar += 1) {
    const [a, b, c] = chordAt(bar);
    const cell = [a, b, c, a + 12, c, b, a + 12, c];
    for (let i = 0; i < 8; i += 1) {
      notes.push(makeNote(cell[i], bar * BPB + i * 0.5, 0.25, 82));
    }
  }
  return notes;
}

// -------------------------------------------------------------------- 패드

/** 마디를 통째로 누르고 있는 화음. 곡을 바닥에서 받쳐 준다. */
function padNotes(): Note[] {
  const notes: Note[] = [];
  for (let bar = 0; bar < BARS; bar += 1) {
    for (const pitch of chordAt(bar)) {
      notes.push(makeNote(pitch, bar * BPB, BPB, 70));
    }
  }
  return notes;
}

// ------------------------------------------------------------------ 베이스

/**
 * 5마디부터 8분음표로 민다. 킥이 4분음표라 그 사이를 베이스가 메운다 —
 * 이 장르의 추진력이 대부분 이 맞물림에서 나온다.
 */
function bassNotes(): Note[] {
  const notes: Note[] = [];
  for (let bar = 4; bar < BARS; bar += 1) {
    const root = rootAt(bar);
    for (let i = 0; i < 8; i += 1) {
      notes.push(makeNote(root, bar * BPB + i * 0.5, 0.25, i % 2 === 0 ? 108 : 92));
    }
  }
  return notes;
}

// -------------------------------------------------------------------- 드럼

function drumNotes(): Note[] {
  const notes: Note[] = [];
  const hit = (pitch: number, start: number, velocity: number) =>
    notes.push(makeNote(pitch, start, 0.25, velocity));

  for (let bar = 0; bar < BARS; bar += 1) {
    const at = bar * BPB;

    // 하이햇 — 3마디부터. 박 사이(엇박)에 놓는다.
    if (bar >= 2) for (let i = 0; i < 4; i += 1) hit(HAT, at + i + 0.5, 78);

    if (bar >= 4) {
      // 클랩은 둘째·넷째 박. 8마디 넷째 박은 아래 필인이 가져간다 —
      // 둘 다 치면 같은 자리에 클랩이 두 번 겹치고, 겹치면 앞 소리의
      // noteOff 가 뒤 소리를 끊는다.
      hit(CLAP, at + 1, 104);
      if (bar !== 7) hit(CLAP, at + 3, 104);

      // **킥은 드롭에서 들어온다.** 쌓는 구간(5~8마디)에서는 마디 첫 박만
      // 친다. 처음엔 여기서도 4분음표를 다 쳤는데, 뽑아 놓고 마디마다 음량을
      // 재 보니 빌드 0.065 · 드롭 0.075 로 거의 차이가 없었다 — 드롭이 열리는
      // 느낌이 안 났다. 킥을 빼 두니 빌드가 0.045 로 내려가면서 9마디에서
      // 확 열린다. 이 장르에서 제일 중요한 한 순간이 여기다.
      if (bar >= 8) for (let i = 0; i < 4; i += 1) hit(KICK, at + i, 118);
      else hit(KICK, at, 110);
    }

    // 네 마디가 끝나는 자리에 열린 하이햇 — 다음 구절로 넘어가는 신호.
    if (bar >= 4 && bar % 4 === 3) hit(OPEN_HAT, at + 3.5, 96);
  }

  // 8마디 끝 필인. 드롭 직전에 클랩을 잘게 몰아친다 — 이거 하나로
  // "이제 터진다" 가 들린다.
  for (let i = 0; i < 4; i += 1) hit(CLAP, 7 * BPB + 3 + i * 0.25, 88 + i * 8);

  // 크래시 — 곡 시작, 드롭(9마디), 둘째 드롭(13마디).
  for (const bar of [0, 8, 12]) hit(CRASH, bar * BPB, 110);

  notes.sort((a, b) => a.start - b.start);
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
  vibrato = 0,
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
    vibrato,
    vibratoDelay: vibrato > 0 ? 0.35 : 0,
  };
}

/** 이 곡은 드럼 트랙이 있어서 사운드폰트가 없으면 반쪽이다. */
export const EDM_NEEDS_SOUNDFONT = true;

export function edmSong(): Project {
  return {
    bpm: 128,
    bars: BARS,
    timeSig: [4, 4],
    tracks: [
      track("리드", packPresetId(0, LEAD_SAW), leadNotes(), 0.8, 0, 0.2, 0.35),
      track("아르페지오", packPresetId(0, PLUCK), arpNotes(), 0.5, -0.3, 0.25),
      track("패드", packPresetId(0, PAD), padNotes(), 0.42, 0.25, 0.4),
      track("베이스", packPresetId(0, SYNTH_BASS), bassNotes(), 0.78, 0, 0),
      track("드럼", packPresetId(0, 0, true), drumNotes(), 0.85, 0, 0.05),
    ],
  };
}
