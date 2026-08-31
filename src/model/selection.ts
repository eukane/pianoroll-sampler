/**
 * 상자를 끌어 여러 노트를 한 번에 고르기.
 *
 * ## 왜 뒤늦게 넣었나
 *
 * 복사·붙여넣기를 처음 만들 때는 선택 UI 를 **일부러 안 만들었다.** 이 앱에는
 * 이미 "무엇을"(루프 구간)과 "어디에"(재생 헤드)가 있었고, 둘 다 폰에서
 * 손가락으로 잡는 것이라 새로 배울 게 없었기 때문이다. 마디 단위로 코드를
 * 반복하는 데는 그걸로 충분했다.
 *
 * 충분하지 않은 경우가 나왔다. 루프 구간은 **시간만** 가리킨다. 한 마디 안에서
 * 베이스만 빼고 위쪽 화음만 가져가거나, 찍어 둔 것 중 몇 개만 지우려면
 * 시간과 **음높이**를 같이 가리켜야 한다.
 *
 * ## 자르지 않는다
 *
 * 상자에 **걸치기만 해도** 그 노트는 통째로 들어온다. 반쯤 걸친 노트를 잘라서
 * 가져가면 붙여넣었을 때 앞뒤가 잘린 이상한 노트가 생긴다. 사람이 상자를
 * 정확히 노트 경계에 맞춰 그릴 수 있다고 보면 안 된다 — 손가락이다.
 *
 * ## 구간은 상자와 노트 중 넓은 쪽
 *
 * 복사 구간을 상자 그대로 쓰면, 앞으로 삐져나온 노트가 음수 위치가 되어
 * 붙여넣을 때 앞으로 밀린다. 그렇다고 노트만 보면 사용자가 일부러 비워 둔
 * 뒷부분(쉼표 자리)이 사라져서 붙여넣기를 연달아 눌렀을 때 간격이 좁아진다.
 * **둘을 다 담는 구간**을 쓴다.
 */

import type { Note, Track } from "./types";

/** 손가락으로 그린 상자. 시간은 박, 음높이는 MIDI 번호. */
export type SelectBox = {
  startBeat: number;
  endBeat: number;
  lowPitch: number;
  highPitch: number;
};

/** 두 점에서 상자를 만든다. 어느 방향으로 끌었든 같은 상자가 된다. */
export function boxFrom(
  a: { beat: number; pitch: number },
  b: { beat: number; pitch: number },
): SelectBox {
  return {
    startBeat: Math.min(a.beat, b.beat),
    endBeat: Math.max(a.beat, b.beat),
    lowPitch: Math.min(a.pitch, b.pitch),
    highPitch: Math.max(a.pitch, b.pitch),
  };
}

/** 상자에 걸치는 노트들. 걸치기만 해도 통째로 든다. */
export function notesInBox(track: Track, box: SelectBox): Note[] {
  return track.notes.filter(
    (n) =>
      n.pitch >= box.lowPitch &&
      n.pitch <= box.highPitch &&
      n.start < box.endBeat &&
      n.start + n.length > box.startBeat,
  );
}

/**
 * 고른 것을 복사할 때 쓸 구간. 상자와 노트를 **둘 다 담는다.**
 *
 * 노트가 없으면 상자 그대로다 (빈 구간을 복사해도 터지지 않아야 한다).
 */
export function selectionRange(box: SelectBox, notes: Note[]): { start: number; end: number } {
  let start = box.startBeat;
  let end = box.endBeat;
  for (const n of notes) {
    start = Math.min(start, n.start);
    end = Math.max(end, n.start + n.length);
  }
  return { start: Math.max(0, start), end: Math.max(start, end) };
}

/**
 * 고른 노트들을 지운다. 돌려주는 건 **지운 개수** — 화면이 몇 개 지웠는지
 * 말해 줘야 한다. 조용히 사라지면 실수로 지운 건지 알 수가 없다.
 */
export function deleteSelected(track: Track, ids: ReadonlySet<string>): number {
  const before = track.notes.length;
  track.notes = track.notes.filter((n) => !ids.has(n.id));
  return before - track.notes.length;
}

/** 이제 없는 노트의 id 를 걷어낸다 (되돌리기·트랙 바꾸기 뒤). */
export function pruneSelection(track: Track | undefined, ids: ReadonlySet<string>): Set<string> {
  const alive = new Set<string>();
  for (const n of track?.notes ?? []) if (ids.has(n.id)) alive.add(n.id);
  return alive;
}
