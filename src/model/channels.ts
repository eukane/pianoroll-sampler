/**
 * 트랙 번호 ↔ MIDI 채널.
 *
 * 그냥 같은 숫자를 쓰면 안 된다. **MIDI 채널 10(0부터 세면 9)은 드럼 자리다.**
 * GM 규약이라 우리 신스만의 얘기가 아니고, 내보낸 .mid 를 다른 DAW 에서 열어도
 * 그 채널은 타악기로 읽힌다.
 *
 * 그래서 배치를 이렇게 한다.
 *   · 드럼 킷을 고른 트랙  → 9번. 그래야 재생도 내보내기도 드럼으로 난다
 *   · 나머지 트랙          → 9번을 건너뛰고 순서대로
 *
 * 드럼 트랙을 9번에 놓으면 신스에 따로 "이 채널은 드럼" 이라고 말할 필요가
 * 없다. MIDI 파일로 내보내도 마찬가지다 — 규약 하나로 두 경로가 같이 맞는다.
 */

import type { Project, Track } from "./types";
import { isDrumPreset } from "./preset.ts";

export const DRUM_CHANNEL = 9;
export const MAX_TRACKS = 15;

export function isDrumTrack(track: Track): boolean {
  return track.source.kind === "sf2" && isDrumPreset(track.source.presetId);
}

/** 드럼을 모르는 자리에서 쓰는 단순 배치 (9번을 비운다). */
export function channelForTrack(trackIndex: number): number {
  return trackIndex < DRUM_CHANNEL ? trackIndex : trackIndex + 1;
}

/**
 * 프로젝트 전체를 보고 트랙마다 채널을 정한다.
 * 트랙 순서대로 `[채널, 채널, …]` 을 돌려준다.
 */
export function assignChannels(project: Project): number[] {
  const out: number[] = [];
  let next = 0;
  for (const track of project.tracks) {
    if (isDrumTrack(track)) {
      out.push(DRUM_CHANNEL);
      continue;
    }
    if (next === DRUM_CHANNEL) next += 1; // 드럼 자리는 비워 둔다
    out.push(Math.min(15, next));
    next += 1;
  }
  return out;
}
