/** Project 를 만들고 고치는 헬퍼. 순수 함수 위주라 나중에 실행취소를 얹기 쉽다. */

import type { Note, Project, Track } from "./types";

let idCounter = 0;

export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function emptyTrack(name = "트랙 1"): Track {
  return {
    id: newId("trk"),
    name,
    // M1 에는 아직 음원 로더가 없다. 자리만 잡아 두고, 실제 재생은
    // InstrumentRegistry 가 임시 오실레이터로 대신한다 (audio/registry.ts).
    source: { kind: "sf2", presetId: 0 },
    notes: [],
    volume: 0.8,
    pan: 0,
    muted: false,
    reverbSend: 0,
  };
}

export function emptyProject(): Project {
  return {
    bpm: 100,
    bars: 4,
    timeSig: [4, 4],
    tracks: [emptyTrack()],
  };
}

/** 한 마디에 몇 박인가. 4/4 면 4, 6/8 이면 3박(8분음표 6개 = 4분음표 3개). */
export function beatsPerBar(project: Project): number {
  const [num, den] = project.timeSig;
  return (num * 4) / den;
}

/** 곡 전체 길이(박). */
export function totalBeats(project: Project): number {
  return project.bars * beatsPerBar(project);
}

export function makeNote(pitch: number, start: number, length: number, velocity = 100): Note {
  return { id: newId("n"), pitch, start, length, velocity };
}

/** 스케줄러가 순서대로 훑을 수 있게 시작 박 기준으로 정렬해 둔다. */
export function sortNotes(track: Track): void {
  track.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/**
 * 그리드 스냅. unit 은 박 단위.
 *
 *     1/4 = 1      1/8 = 0.5      1/16 = 0.25
 *     1/8 셋잇단 = 1/3            1/16 셋잇단 = 1/6
 *
 * 셋잇단은 한 박을 셋으로 나눈 것이라 1/16 격자로는 **절대 못 찍는다.**
 * 0.25 격자에 0.333… 을 올릴 방법이 없다.
 *
 * 소수점이 딱 떨어지지 않지만 MIDI 로 나갈 때는 정확하다. 4분음표를 480틱으로
 * 쓰는데(PPQ) 480 은 3으로 나누어떨어져서, 1/3박 = 160틱, 1/6박 = 80틱으로
 * 정수가 된다. 다른 DAW 에서 열어도 어긋나지 않는다.
 */
export function snap(beat: number, unit: number): number {
  if (unit <= 0) return beat;
  return Math.round(beat / unit) * unit;
}

export function snapFloor(beat: number, unit: number): number {
  if (unit <= 0) return beat;
  return Math.floor(beat / unit) * unit;
}
