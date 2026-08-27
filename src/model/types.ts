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

/**
 * 트랙이 어떤 음원을 쓰는지. M4 에서 sampleFolder 가 붙는다.
 *
 * `presetId` 는 뱅크와 프로그램을 한 숫자로 묶은 값이다 (bankMSB * 128 + program).
 * 모델이 숫자 하나만 허용해서 이렇게 눌러 담았다. 푸는 건 audio/soundfont.ts 의
 * packPresetId / unpackPresetId.
 */
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
  /**
   * 리버브로 보내는 양 0~1. 없으면 0 으로 읽는다.
   *
   * 솔로는 여기 없다. 솔로는 "지금 이것만 들어 보자" 는 **작업 중의 상태**지
   * 곡의 일부가 아니다. 저장했다 열었더니 한 트랙만 들리면 그게 더 이상하다.
   */
  reverbSend?: number;
  /**
   * 떨림(비브라토) 깊이 0~1. 없으면 0 — 안 떤다.
   *
   * 노트마다가 아니라 **트랙마다** 붙는다. 트럼펫이 얼마나 떠는지는 그
   * 트럼펫의 성질에 가깝고, 폰 화면에서 노트 하나씩 붙잡고 조절하는 건
   * 현실적이지 않다. 짧은 음이 안 떨게 하는 건 아래 딜레이가 맡는다.
   */
  vibrato?: number;
  /** 음이 시작하고 몇 초 뒤부터 떠는가. 긴 음만 떨게 만드는 장치다. */
  vibratoDelay?: number;
};

export type Project = {
  bpm: number;
  bars: number;
  timeSig: [number, number]; // 기본 [4, 4]
  tracks: Track[];
};
