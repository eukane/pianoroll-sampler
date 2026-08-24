/**
 * 트랙별 출력 배선.
 *
 * MIDI 채널 16개마다 게인 → 팬 → 마스터를 하나씩 두고, 팬 뒤에서 리버브로
 * 갈라 보내는 길(센드)을 하나 더 낸다. 샘플러(spessasynth)는
 * `connectIndividualOutputs` 로 채널 출력을 따로 뽑아 주고, 임시 신스와 폴더
 * 샘플러는 여기에 직접 연결한다. **어느 악기를 쓰든 트랙 소리가 갈라져 있다.**
 *
 * 이 배선이 재생과 오프라인 렌더 **양쪽에 똑같이** 쓰인다. 개별 출력이
 * OfflineAudioContext 에서도 살아 있는 걸 확인하고 이렇게 잡았다. 그래서
 * 화면에서 들은 균형이 뽑아낸 WAV 와 같다.
 *
 * 센드를 팬 **뒤**에 둔 이유: 볼륨을 내리면 울림도 같이 줄어야 자연스럽다.
 * 앞에 두면 소리를 완전히 줄여도 울림만 남아서 유령처럼 들린다.
 */

import { createReverb } from "./reverb";

export const MAX_CHANNELS = 16;

export type ChannelSettings = {
  volume: number;
  pan: number;
  muted: boolean;
  /** 리버브로 보내는 양 0~1. */
  send: number;
};

export class Mixer {
  readonly inputs: GainNode[] = [];
  private pans: StereoPannerNode[] = [];
  private sends: GainNode[] = [];
  private wet: GainNode;

  constructor(ctx: BaseAudioContext, master: AudioNode) {
    const reverb = createReverb(ctx);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.9;
    reverb.connect(this.wet);
    this.wet.connect(master);

    for (let i = 0; i < MAX_CHANNELS; i += 1) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const send = ctx.createGain();
      send.gain.value = 0;

      gain.connect(pan);
      pan.connect(master);
      pan.connect(send);
      send.connect(reverb);

      this.inputs.push(gain);
      this.pans.push(pan);
      this.sends.push(send);
    }
  }

  /** 이 채널로 소리를 넣으면 된다. */
  input(channel: number): GainNode {
    return this.inputs[this.clamp(channel)];
  }

  set(channel: number, s: ChannelSettings): void {
    const i = this.clamp(channel);
    this.inputs[i].gain.value = s.muted ? 0 : Math.max(0, Math.min(1, s.volume));
    this.pans[i].pan.value = Math.max(-1, Math.min(1, s.pan));
    this.sends[i].gain.value = s.muted ? 0 : Math.max(0, Math.min(1, s.send));
  }

  private clamp(channel: number): number {
    return Math.max(0, Math.min(MAX_CHANNELS - 1, channel));
  }
}
