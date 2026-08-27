/**
 * 가이드용 예제 곡 — **8마디짜리 임시 곡.**
 *
 * 빈 화면으로 시작하면 이 앱이 뭘 하는 물건인지 알기가 어렵다. 노트를 몇 개
 * 찍어 봐도 "그래서 악기를 바꾼다는 게 무슨 뜻이지" 는 여전히 안 보인다.
 * 그걸 한 번에 보여 주려고 넣은 곡이다.
 *
 * 그래서 곡보다 **무엇을 보여 주는가**를 기준으로 짰다.
 *
 *   · 트랙이 셋이다 — 멜로디 · 반주 · 베이스. 믹서에서 하나씩 꺼 보면 바로 안다
 *   · 멜로디에만 **떨림**이 걸려 있다. 긴 음만 떨리고 짧은 음은 안 떨린다
 *   · 두 번째 트랙이 **바꿔 보라고 만든 자리**다. 가야금(Koto)으로 걸어 뒀는데
 *     색소폰이든 마림바든 눌러 바꾸면 같은 노트가 그대로 다른 악기로 난다
 *   · 전부 **1/8 격자에 딱 떨어진다.** 기본 스냅이 1/8 이라, 열자마자 손으로
 *     고쳐도 격자가 어긋나지 않는다
 *   · 8마디 = 32박. 루프를 걸고 돌려 놓기에 적당하고, 폰 화면에서 몇 번만
 *     밀면 끝까지 본다
 *
 * ## 음을 고른 기준
 *
 * **D 장조 5음계**(레·미·파#·라·시)만 쓴다. 반음이 없어서 아무 음이나 겹쳐도
 * 부딪히지 않는다. 사용자가 노트를 마구 옮겨 봐도 곡이 안 망가진다는 뜻이라,
 * 만져 보라고 내놓는 곡에는 이게 맞다. 가야금·거문고가 쓰는 음계이기도 해서
 * 이 앱이 겨냥한 국악기 음원과도 어울린다.
 *
 * 반주 화음은 D → Bm → A 세 개만 돈다. 역시 5음계 안에서만 골라서, 반주만
 * 따로 들어도 5음계 밖으로 나가지 않는다.
 *
 * ## 음원이 없어도 들려야 한다
 *
 * 사운드폰트를 아직 안 넣은 상태에서 예제를 열면 세 트랙이 전부 임시 신스로
 * 난다. 그래도 **곡으로 들려야** 한다 — 첫인상이 여기서 갈린다. 그래서
 * 드럼 트랙을 넣지 않았다. 드럼은 음원이 없으면 낮은 톱니파 웅웅거림이 될
 * 뿐이고, 애초에 "악기를 바꿔 본다" 는 이 앱의 요점과도 상관이 없다.
 *
 * 악기 번호는 GM 표준 번호라 어느 사운드폰트에나 있다. 없으면 앱이 알아서
 * 첫 악기로 떨어뜨린다(instrumentPanel 의 resnapTracks).
 */

// 브라우저 없이 도는 점검(scripts/audit.mjs)이 이 파일을 그대로 읽는다.
// Node 의 타입 스트리핑은 확장자를 요구해서 값 import 에는 .ts 를 붙인다
// (타입만 가져오는 줄은 지워지므로 상관없다). Vite 는 양쪽 다 받는다.
import { makeNote, newId } from "./project.ts";
import { packPresetId } from "./preset.ts";
import type { Note, Project, Track } from "./types";

/** GM 프로그램 번호(0부터). 어느 사운드폰트에나 같은 자리에 있다. */
const ALTO_SAX = 65;
const KOTO = 107;
const ACOUSTIC_BASS = 32;

/** [시작 박, 음높이, 길이 박] */
type Hit = [number, number, number];

/**
 * 멜로디. 8마디를 A - A' - B - 맺음 으로 잡았다.
 * 5마디(16박)에서 한 옥타브 위로 올라갔다가 내려와 D 로 맺는다.
 */
const MELODY: Hit[] = [
  [0, 69, 1], [1, 71, 0.5], [1.5, 69, 0.5], [2, 66, 1], [3, 64, 1],
  [4, 62, 1.5], [5.5, 64, 0.5], [6, 66, 2],
  [8, 69, 1], [9, 71, 1], [10, 74, 2],
  [12, 71, 1], [13, 69, 1], [14, 66, 2],
  [16, 74, 0.5], [16.5, 76, 0.5], [17, 78, 1], [18, 76, 1], [19, 74, 1],
  [20, 71, 1], [21, 74, 1], [22, 69, 2],
  [24, 66, 1], [25, 64, 1], [26, 62, 1], [27, 64, 1],
  [28, 66, 1], [29, 69, 1], [30, 62, 2],
];

/**
 * 반주 화음 — 마디마다 네 음을 8분음표로 두 번 굴린다.
 * 손으로 서른두 줄을 쓰는 대신 마디별 음만 적고 아래에서 펼친다.
 */
const CHORD_BY_BAR: number[][] = [
  [62, 66, 69, 71], // D
  [62, 66, 69, 71], // D
  [59, 62, 66, 69], // Bm
  [64, 66, 69, 71], // A (5음계 안에서만)
  [62, 66, 69, 74], // D
  [59, 62, 66, 69], // Bm
  [64, 66, 69, 71], // A
  [62, 66, 69, 74], // D — 마지막 마디는 아래에서 따로 맺는다
];

/** 베이스 — 마디마다 뿌리음과 5도를 2박씩. */
const BASS_BY_BAR: [number, number][] = [
  [38, 45], // D2 A2
  [38, 45],
  [35, 42], // B1 F#2
  [40, 45], // E2 A2
  [38, 45],
  [35, 42],
  [40, 45],
  [38, 38], // 마지막은 뿌리음을 길게
];

const BARS = 8;
const BEATS_PER_BAR = 4;

function track(
  name: string,
  program: number,
  notes: Note[],
  volume: number,
  pan: number,
  vibrato = 0,
): Track {
  return {
    id: newId("trk"),
    name,
    source: { kind: "sf2", presetId: packPresetId(0, program) },
    notes,
    volume,
    pan,
    muted: false,
    reverbSend: 0.18,
    vibrato,
    vibratoDelay: vibrato > 0 ? MELODY_VIBRATO_DELAY : 0,
  };
}

/**
 * 멜로디에만 떨림을 건다. 관악기는 긴 음을 그냥 뻗지 않는다.
 *
 * 0.4초로 잡은 이유: 100BPM 에서 한 박이 0.6초다. 8분음표(0.3초)는 떨림이
 * 시작하기도 전에 끝나고, 2박짜리 긴 음은 뒤쪽에서 충분히 떨린다. 실제 연주와
 * 같은 모양이 되고, "떨림 시작" 슬라이더가 뭘 하는지도 이 한 트랙에서 보인다.
 */
const MELODY_VIBRATO_DELAY = 0.4;

function melodyNotes(): Note[] {
  return MELODY.map(([start, pitch, length]) =>
    // 마디 첫 박은 조금 세게. 밋밋하게 나열된 것과 연주된 것의 차이가 여기서 난다.
    makeNote(pitch, start, length, start % BEATS_PER_BAR === 0 ? 108 : 92),
  );
}

function chordNotes(): Note[] {
  const notes: Note[] = [];
  CHORD_BY_BAR.forEach((cell, bar) => {
    const barStart = bar * BEATS_PER_BAR;
    const last = bar === BARS - 1;
    // 마지막 마디는 앞 2박만 굴리고 남은 2박은 길게 눌러 맺는다.
    const rounds = last ? 1 : 2;
    for (let round = 0; round < rounds; round += 1) {
      cell.forEach((pitch, i) => {
        notes.push(makeNote(pitch, barStart + round * 2 + i * 0.5, 0.5, 70));
      });
    }
    if (last) notes.push(makeNote(cell[0], barStart + 2, 2, 62));
  });
  return notes;
}

function bassNotes(): Note[] {
  const notes: Note[] = [];
  BASS_BY_BAR.forEach(([root, fifth], bar) => {
    const barStart = bar * BEATS_PER_BAR;
    if (bar === BARS - 1) {
      notes.push(makeNote(root, barStart, 4, 88));
      return;
    }
    notes.push(makeNote(root, barStart, 2, 92));
    notes.push(makeNote(fifth, barStart + 2, 2, 82));
  });
  return notes;
}

/**
 * 예제 곡을 새로 만들어 돌려준다.
 *
 * 부를 때마다 노트 id 를 새로 뽑는다. 같은 객체를 돌려주면 사용자가 고친 게
 * 다음에 열 때 그대로 남아서, 예제가 예제 노릇을 못 한다.
 */
export function demoSong(): Project {
  return {
    bpm: 100,
    bars: BARS,
    timeSig: [4, 4],
    tracks: [
      // 이름은 사운드폰트를 넣는 순간 그 악기 이름으로 바뀐다(resnapTracks).
      // 그래서 이름에 안내를 넣지 않는다 — 사라질 자리에 적어 두면 거짓말이 된다.
      track("멜로디", ALTO_SAX, melodyNotes(), 0.85, 0, 0.55),
      track("반주", KOTO, chordNotes(), 0.6, -0.25),
      track("베이스", ACOUSTIC_BASS, bassNotes(), 0.75, 0.15),
    ],
  };
}
