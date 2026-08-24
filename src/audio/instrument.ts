/**
 * 악기 인터페이스.
 *
 * M1 은 오실레이터, M2 는 SF2 샘플러, M4 는 폴더 샘플러가 이걸 구현한다.
 * 피아노롤과 스케줄러는 **이 인터페이스만** 보고 어떤 악기인지 모른다.
 * 악기 교체가 트랙 설정 한 줄로 끝나야 하기 때문이다.
 *
 * `play(..., durationSec)` 한 방으로 잡은 이유: 피아노롤은 노트 길이를
 * **연주하기 전에 이미 알고 있다.** 미리 알고 예약하면 M3 의 오프라인 렌더에서
 * 실시간 이벤트 루프 없이 같은 코드로 렌더할 수 있다.
 *
 * 목적지를 AudioNode 가 아니라 **채널 번호**로 받는다. 샘플러는 출력이 MIDI
 * 채널에 묶여 있어서(`connectIndividualOutputs`) 노드를 넘겨받아 봐야 쓸 수가
 * 없다. 채널 번호로 통일하면 두 방식이 같은 인터페이스에 들어온다.
 */

export interface Instrument {
  /** 화면에 보여 줄 이름. */
  readonly name: string;

  /**
   * @param when        AudioContext 시각(초). 지금이 아니라 **미래 시각**이다
   * @param durationSec 눌려 있는 길이(초). 릴리즈 꼬리는 이 뒤에 더 붙어도 된다
   * @param channel     트랙 번호 = MIDI 채널 (0~15)
   */
  play(pitch: number, velocity: number, when: number, durationSec: number, channel: number): void;

  /** 정지 버튼. 예약해 둔 것까지 전부 끊는다. */
  stopAll(): void;
}
