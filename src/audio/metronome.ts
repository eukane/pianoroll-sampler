/**
 * 메트로놈 — 박마다 「틱」, 마디 첫 박은 높게 「띡」.
 *
 * **곡의 일부가 아니다.** 그래서 트랙도 채널도 믹서도 안 거치고 마스터에 바로
 * 물린다. 내보내기(WAV·MIDI)는 스케줄러를 안 쓰고 따로 렌더하므로 여기서 낸
 * 소리가 파일에 섞일 길이 없다 — 일부러 그렇게 갈라 둔 것이다.
 *
 * 소리는 음원 없이 계산으로 만든다(사인파에 짧은 감쇠). 리버브와 같은 이유다 —
 * 이 앱은 사용자가 넣는 음원 말고는 아무 파일도 들고 있지 않는다.
 *
 * 시각은 스케줄러가 정해서 넘긴다. 노트와 같은 lookahead 예약이라 박자가
 * 노트와 어긋나지 않는다 (타이머가 부르는 순간에 내면 수십 ms 씩 흔들린다).
 */

/** 마디 첫 박 / 나머지 박. 귀로 마디를 셀 수 있게 높이와 크기를 둘 다 다르게. */
const ACCENT = { freq: 1760, gain: 0.32 };
const BEAT = { freq: 1175, gain: 0.2 };
const LENGTH = 0.045;

export class Metronome {
  private live = new Set<OscillatorNode>();

  constructor(
    private ctx: BaseAudioContext,
    private dest: AudioNode,
  ) {}

  /** `when` 은 AudioContext 시각(미래). */
  click(when: number, accent: boolean): void {
    const { freq, gain } = accent ? ACCENT : BEAT;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + LENGTH);
    osc.connect(g);
    g.connect(this.dest);
    osc.start(when);
    osc.stop(when + LENGTH + 0.01);
    this.live.add(osc);
    osc.onended = () => {
      this.live.delete(osc);
      g.disconnect();
    };
  }

  /** 정지 버튼. 이미 예약해 둔 것(앞으로 120ms 안)까지 끊는다. */
  stopAll(): void {
    for (const osc of this.live) {
      try {
        osc.stop();
      } catch {
        // 이미 끝난 것이다.
      }
    }
    this.live.clear();
  }

  /** 예약돼 있거나 울리는 중인 틱 개수. 점검용. */
  get pending(): number {
    return this.live.size;
  }
}
