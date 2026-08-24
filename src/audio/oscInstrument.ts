/**
 * M1 용 **임시** 악기. 오실레이터 + ADSR.
 *
 * 이 앱의 목표는 색소폰·가야금 같은 실제 녹음 샘플을 재생하는 것이고, 그건
 * M2(SF2 샘플러) / M4(폴더 샘플러) 가 한다. 여기서는 **음정과 타이밍이
 * 맞는지 확인할 수 있으면 충분하다.** 소리를 그럴듯하게 만드는 데 시간을
 * 쓰지 않는다.
 *
 * 폴리포니 상한이 있는 이유는 소리 취향이 아니라 성능이다. 폰에서 오실레이터
 * 노드를 무제한으로 만들면 마디가 빽빽해질수록 오디오 스레드가 밀려 끊긴다.
 * 상한에 닿으면 **가장 오래된 소리를 뺏어서(voice stealing)** 새 음에 준다.
 */

import type { Instrument } from "./instrument";
import type { Mixer } from "./mixer";
import { midiToFreq } from "../util/music";

export type Waveform = "sine" | "sawtooth" | "square" | "triangle";

const MAX_VOICES = 24;

type Voice = {
  osc: OscillatorNode;
  gain: GainNode;
  endsAt: number;
};

export class OscInstrument implements Instrument {
  readonly name = "임시 신스";
  private voices: Voice[] = [];

  constructor(
    private ctx: AudioContext,
    private mixer: Mixer,
    public waveform: Waveform = "sawtooth",
  ) {}

  play(pitch: number, velocity: number, when: number, durationSec: number, channel: number): void {
    const dest = this.mixer.input(channel);
    this.prune(when);
    if (this.voices.length >= MAX_VOICES) this.steal();

    const attack = 0.006;
    const release = 0.09;
    const peak = Math.max(0.02, (velocity / 127) * 0.22);
    const hold = Math.max(0.03, durationSec);

    const osc = this.ctx.createOscillator();
    osc.type = this.waveform;
    osc.frequency.setValueAtTime(midiToFreq(pitch), when);

    const gain = this.ctx.createGain();
    // 0 에서 시작해 올렸다 내린다. 곧바로 값을 꽂으면 '틱' 하는 클릭음이 난다.
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + attack);
    gain.gain.setValueAtTime(peak, when + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + hold + release);

    osc.connect(gain);
    gain.connect(dest);

    const endsAt = when + hold + release;
    osc.start(when);
    osc.stop(endsAt + 0.01);

    const voice: Voice = { osc, gain, endsAt };
    this.voices.push(voice);
    osc.onended = () => {
      gain.disconnect();
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
    };
  }

  stopAll(): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
        v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
        v.osc.stop(now + 0.03);
      } catch {
        /* 이미 끝난 노드 */
      }
    }
    this.voices = [];
  }

  /** 이미 끝난 보이스를 목록에서 치운다. */
  private prune(now: number): void {
    this.voices = this.voices.filter((v) => v.endsAt > now - 0.05);
  }

  /** 가장 오래된 보이스를 즉시 뺏는다. */
  private steal(): void {
    const v = this.voices.shift();
    if (!v) return;
    const now = this.ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
      v.osc.stop(now + 0.02);
    } catch {
      /* 무시 */
    }
  }
}
