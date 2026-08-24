/**
 * 트랙 번호 ↔ MIDI 채널.
 *
 * 그냥 같은 숫자를 쓰면 안 된다. **MIDI 채널 10(0부터 세면 9)은 드럼 자리다.**
 * GM 규약이라 우리 신스만의 얘기가 아니고, 내보낸 .mid 를 다른 DAW 에서 열어도
 * 그 채널은 타악기로 읽힌다. 트랙을 열 개 만들었더니 열 번째만 갑자기 드럼
 * 소리가 나는 셈이다.
 *
 * 그래서 9번을 건너뛴다. 대신 쓸 수 있는 트랙이 15개가 된다 (요구는 최소 4개).
 * 드럼 트랙은 M5 에서 "이 트랙은 드럼" 을 켜면 9번에 놓는 식으로 붙이면 된다.
 */

export const DRUM_CHANNEL = 9;
export const MAX_TRACKS = 15;

export function channelForTrack(trackIndex: number): number {
  return trackIndex < DRUM_CHANNEL ? trackIndex : trackIndex + 1;
}
