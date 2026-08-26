/**
 * 노트 복사·붙여넣기.
 *
 * 같은 코드를 마디마다 다시 찍는 게 번거롭다는 요청에서 나왔다. 그 일을
 * **한 마디에 탭 한 번**으로 만드는 게 목표다.
 *
 * ## 선택 UI 를 새로 만들지 않았다
 *
 * 보통 DAW 는 사각형으로 범위를 끌어 고르는데, 그건 폰에서 새 조작 방식을
 * 하나 더 배우는 일이다. 이 앱에는 이미 **무엇을** 가리키는 것과 **어디에**
 * 를 가리키는 것이 있다.
 *
 *     루프 구간  → 무엇을 복사할지
 *     재생 헤드  → 어디에 붙일지
 *
 * 둘 다 눈금에서 손가락으로 잡는 것이고 이미 화면에 보인다. 새로 배울 게 없다.
 *
 * ## 붙여넣으면 헤드가 앞으로 간다
 *
 * 이게 핵심이다. 안 그러면 마디마다 헤드를 옮기고 붙여넣기를 반복해야 해서
 * 손이 두 배로 간다. 붙여넣은 만큼 헤드를 밀어 두면 **복사 한 번 하고
 * 붙여넣기를 연달아 눌러** 여덟 마디를 채울 수 있다.
 *
 * 시간은 전부 박(beat) 단위이고, 복사한 것은 구간 시작 기준의 **상대 위치**로
 * 들고 있는다. 그래야 아무 데나 붙일 수 있다.
 */

import type { Note, Track } from "./types";
import { makeNote, sortNotes } from "./project.ts";

export type Clipboard = {
  /** 구간 시작을 0 으로 옮긴 노트들. */
  notes: Note[];
  /** 복사한 구간의 길이(박). 붙여넣은 뒤 헤드를 이만큼 민다. */
  lengthBeats: number;
};

/**
 * 구간 안의 노트를 뜬다.
 *
 * 구간에 **시작점이 들어 있는** 노트만 가져간다. 걸쳐 있는 노트를 잘라서
 * 가져가면 붙여넣었을 때 앞이 잘린 이상한 노트가 생긴다. 마디를 복사하는
 * 용도라 그 마디에서 시작한 것만 가져가는 게 맞다.
 */
export function copyRegion(track: Track, startBeat: number, endBeat: number): Clipboard {
  const start = Math.min(startBeat, endBeat);
  const end = Math.max(startBeat, endBeat);
  const notes = track.notes
    .filter((n) => n.start >= start - 1e-6 && n.start < end - 1e-6)
    .map((n) => ({ ...n, start: n.start - start }));
  return { notes, lengthBeats: Math.max(0, end - start) };
}

/**
 * 붙여넣는다. **새 id 를 준다** — 같은 id 가 둘이면 지우거나 옮길 때
 * 엉뚱한 게 잡힌다.
 */
export function pasteAt(track: Track, clip: Clipboard, atBeat: number): Note[] {
  const at = Math.max(0, atBeat);
  const added = clip.notes.map((n) =>
    makeNote(n.pitch, at + n.start, n.length, n.velocity),
  );
  track.notes.push(...added);
  sortNotes(track);
  return added;
}

/** 붙여넣은 것 중 제일 늦게 끝나는 지점(박). 마디 수를 늘려야 하는지 볼 때 쓴다. */
export function lastBeat(notes: Note[]): number {
  return notes.reduce((max, n) => Math.max(max, n.start + n.length), 0);
}
