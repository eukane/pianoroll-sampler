/**
 * 앱 전체가 주고받는 데이터 구조.
 *
 * 가장 중요한 규칙 하나:
 *
 *   **노트는 악기 정보를 갖지 않는다. 악기는 트랙에 붙는다.**
 *
 * 그래야 Track.source 한 줄만 바꿔서 이미 찍어 둔 노트가 통째로 다른 악기로
 * 연주된다. 이게 이 앱의 핵심 기능이라 이 구조는 바꾸지 않는다.
 *
 * 시간 단위는 전부 '박(beat)' 이다. 초가 아니다. BPM 을 바꿔도 노트를 다시
 * 계산할 필요가 없어야 하기 때문이다. 초로의 환산은 재생/렌더 시점에만 한다.
 */

export type Note = {
  id: string;
  pitch: number; // MIDI 노트 번호 (60 = C4)
  start: number; // 곡 시작부터 몇 박인지 (소수 허용)
  length: number; // 길이(박)
  velocity: number; // 0..127
};

/** 트랙이 어떤 음원을 쓰는지. M2 에서 sf2, M4 에서 sampleFolder 가 실제로 붙는다. */
export type TrackSource =
  | { kind: "sf2"; presetId: number }
  | { kind: "sampleFolder"; folderId: string };

export type Track = {
  id: string;
  name: string;
  source: TrackSource;
  notes: Note[];
  volume: number; // 0..1
  pan: number; // -1..1
  muted: boolean;
};

export type Project = {
  bpm: number;
  bars: number;
  timeSig: [number, number]; // 기본 [4, 4]
  tracks: Track[];
};
