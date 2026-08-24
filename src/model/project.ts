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

export function addNote(track: Track, note: Note): void {
  track.notes.push(note);
  sortNotes(track);
}

export function removeNote(track: Track, noteId: string): void {
  const i = track.notes.findIndex((n) => n.id === noteId);
  if (i >= 0) track.notes.splice(i, 1);
}

/** 스케줄러가 순서대로 훑을 수 있게 시작 박 기준으로 정렬해 둔다. */
export function sortNotes(track: Track): void {
  track.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** 그리드 스냅. unit 은 박 단위 (1/4음표=1, 1/8=0.5, 1/16=0.25). */
export function snap(beat: number, unit: number): number {
  if (unit <= 0) return beat;
  return Math.round(beat / unit) * unit;
}

export function snapFloor(beat: number, unit: number): number {
  if (unit <= 0) return beat;
  return Math.floor(beat / unit) * unit;
}
