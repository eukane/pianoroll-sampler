/**
 * 악기 인터페이스.
 *
 * M1 은 오실레이터, M2 는 SF2 샘플러, M4 는 폴더 샘플러가 이 인터페이스를
 * 구현한다. 피아노롤과 스케줄러는 **이 인터페이스만** 보고, 어떤 악기인지
 * 모른다. 악기 교체가 트랙 설정 한 줄로 끝나야 하기 때문이다.
 *
 * API 를 noteOn/noteOff 짝이 아니라 `play(..., durationSec)` 한 방으로 잡은
 * 이유: 피아노롤에서는 노트 길이를 **연주하기 전에 이미 알고 있다.** 미리
 * 알고 스케줄하면 오프라인 렌더(M3)에서 실시간 이벤트 루프 없이 같은 코드로
 * 렌더할 수 있다.
 */

export interface Instrument {
  /** 화면에 보여 줄 이름. */
  readonly name: string;

  /**
   * @param pitch       MIDI 노트 번호
   * @param velocity    0..127
   * @param when        AudioContext 시각(초). 지금이 아니라 **미래 시각**이다
   * @param durationSec 눌려 있는 길이(초). 릴리즈 꼬리는 이 뒤에 더 붙어도 된다
   * @param dest        연결할 목적지 노드 (보통 트랙 게인)
   */
  play(pitch: number, velocity: number, when: number, durationSec: number, dest: AudioNode): void;

  /** 정지 버튼. 예약해 둔 것까지 전부 끊는다. */
  stopAll(): void;
}
