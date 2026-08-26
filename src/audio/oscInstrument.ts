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

/**
 * 누르고 있는 소리의 상한(초). 손가락을 떼는 신호를 놓치는 경우가 있다
 * (브라우저가 pointercancel 을 안 주거나, 화면이 꺼지거나). 그때 소리가
 * 영원히 남으면 끌 방법이 없어서 여기서 끊는다.
 */
const MAX_HOLD = 10;

type Voice = {
  osc: OscillatorNode;
  gain: GainNode;
  endsAt: number;
};

export class OscInstrument implements Instrument {
  readonly name = "임시 신스";
  private voices: Voice[] = [];
  /**
   * 지금 눌려 있는 소리들. `voices` 와 따로 둔다 — 저기에 섞어 두면 보이스가
   * 모자랄 때 뺏겨 나가는데, 그러면 손을 떼도 끌 대상이 없어진다.
   */
  private held = new Map<string, Voice>();

  constructor(
    private ctx: BaseAudioContext,
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

  hold(pitch: number, velocity: number, channel: number): void {
    this.release(pitch, channel);
    const now = this.ctx.currentTime;
    const peak = Math.max(0.02, (velocity / 127) * 0.22);

    const osc = this.ctx.createOscillator();
    osc.type = this.waveform;
    osc.frequency.setValueAtTime(midiToFreq(pitch), now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    // 여기서 끝나는 예약을 걸지 않는다. 손을 뗄 때까지 이 크기를 유지한다.

    osc.connect(gain);
    gain.connect(this.mixer.input(channel));
    osc.start(now);
    osc.stop(now + MAX_HOLD);

    const voice: Voice = { osc, gain, endsAt: now + MAX_HOLD };
    const key = holdKey(pitch, channel);
    this.held.set(key, voice);
    osc.onended = () => {
      gain.disconnect();
      if (this.held.get(key) === voice) this.held.delete(key);
    };
  }

  release(pitch: number, channel: number): void {
    const key = holdKey(pitch, channel);
    const v = this.held.get(key);
    if (!v) return;
    this.held.delete(key);
    this.fadeOut(v, 0.09);
  }

  stopAll(): void {
    for (const v of this.held.values()) this.fadeOut(v, 0.02);
    this.held.clear();
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

  /** 소리를 부드럽게 줄이고 끈다. 뚝 끊으면 '틱' 소리가 난다. */
  private fadeOut(v: Voice, seconds: number): void {
    const now = this.ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      v.osc.stop(now + seconds + 0.01);
    } catch {
      /* 이미 끝난 노드 */
    }
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

function holdKey(pitch: number, channel: number): string {
  return `${channel}:${pitch}`;
}
