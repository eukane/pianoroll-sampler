/**
 * 트랙별 출력 배선.
 *
 * MIDI 채널 16개마다 게인 → 팬 → 마스터를 하나씩 둔다. 샘플러(spessasynth)는
 * `connectIndividualOutputs` 로 채널 출력을 따로 뽑아 주고, 임시 신스는 여기에
 * 직접 연결한다. **어느 악기를 쓰든 트랙 소리가 갈라져 있다.**
 *
 * 지금 당장은 볼륨·팬을 화면에서 못 만지지만(M5), 배선을 미리 갈라 두면
 * M3 의 트랙별 WAV(스템) 내보내기와 M5 의 믹서가 이 위에 그냥 얹힌다.
 * 나중에 갈라내려면 신스 출력을 통째로 다시 짜야 한다.
 */

export const MAX_CHANNELS = 16;

export class Mixer {
  readonly inputs: GainNode[] = [];
  private pans: StereoPannerNode[] = [];

  constructor(ctx: AudioContext | OfflineAudioContext, master: AudioNode) {
    for (let i = 0; i < MAX_CHANNELS; i += 1) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.connect(pan);
      pan.connect(master);
      this.inputs.push(gain);
      this.pans.push(pan);
    }
  }

  /** 이 채널로 소리를 넣으면 된다. */
  input(channel: number): GainNode {
    return this.inputs[Math.max(0, Math.min(MAX_CHANNELS - 1, channel))];
  }

  set(channel: number, volume: number, pan: number, muted: boolean): void {
    const i = Math.max(0, Math.min(MAX_CHANNELS - 1, channel));
    this.inputs[i].gain.value = muted ? 0 : volume;
    this.pans[i].pan.value = Math.max(-1, Math.min(1, pan));
  }
}
