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

import type { Ornament } from "./ornament";

export type Note = {
  id: string;
  pitch: number; // MIDI 노트 번호 (60 = C4)
  start: number; // 곡 시작부터 몇 박인지 (소수 허용)
  length: number; // 길이(박)
  velocity: number; // 0..127
  /**
   * 꾸밈(시김새) — 이 음만 어떻게 연주할지. 없으면 트랙 기본값을 따른다.
   *
   * **악기 정보가 아니다.** 색소폰으로 찍어 둔 꺾는 음을 가야금으로 바꾸면
   * 가야금이 그 자리를 꺾는다. 자세한 건 model/ornament.ts.
   */
  ornament?: Ornament;
  /** 꾸밈의 세기 0~1. */
  ornamentAmount?: number;
  /**
   * 노랫말 한 글자(「か」「さ」…). 노래하는 트랙에서만 쓴다.
   *
   * 다른 악기 트랙에서는 그냥 남아 있다 — 악기를 바꿨다가 되돌렸을 때 적어 둔
   * 가사가 사라지면 안 된다. "노트는 악기 정보를 갖지 않는다" 와 같은 이유다.
   */
  lyric?: string;
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
  | { kind: "sampleFolder"; folderId: string }
  /**
   * 노래하는 트랙. UTAU 음원(WAV 더미 + oto.ini)을 쓴다.
   *
   * 다른 둘과 다른 점이 하나 있다 — **노트마다 따로 소리를 낼 수 없다.**
   * 한 음의 소리가 앞뒤 음에 달려 있어서(선행발성·겹침·이어짐용 녹음) 줄을
   * 통째로 계산한다. 자세한 건 model/phrase.ts.
   */
  | { kind: "voice"; bankId: string };

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
   * **기본** 떨림 깊이 0~1. 없으면 0 — 안 떤다.
   *
   * 이건 "이 악기는 긴 음을 으레 이렇게 분다" 는 설정이고, **꾸밈을 정하지
   * 않은 음에만** 걸린다. 음 하나만 다르게 하려면 `Note.ornament` 를 쓴다
   * (model/ornament.ts). 둘을 합치는 규칙은 audio/expression.ts 한 곳에 있다.
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
