/**
 * 트랙의 `source` → 실제 악기 객체.
 *
 * **악기 교체가 일어나는 유일한 지점이다.** 피아노롤도 스케줄러도 트랙이 무슨
 * 음원을 쓰는지 모르고 이 레지스트리에게 `Instrument` 를 달라고만 한다.
 * M4 에서 폴더 샘플러를 붙일 때도 고칠 파일은 여기 하나다.
 *
 * 사운드폰트가 아직 안 올라왔으면 임시 오실레이터로 돌려준다. **음원이 없다고
 * 앱이 멈추면 안 된다** — 사운드폰트는 사용자가 직접 넣는 파일이라 없는 상태가
 * 정상적인 시작점이다.
 */

import type { Track } from "../model/types";
import type { Instrument } from "./instrument";
import type { Mixer } from "./mixer";
import { OscInstrument, type Waveform } from "./oscInstrument";
import { SoundFontInstrument } from "./soundfont";

export class InstrumentRegistry {
  readonly osc: OscInstrument;
  readonly soundfont: SoundFontInstrument;

  constructor(ctx: AudioContext, mixer: Mixer) {
    this.osc = new OscInstrument(ctx, mixer);
    this.soundfont = new SoundFontInstrument(ctx, mixer);
  }

  get usingSoundFont(): boolean {
    return this.soundfont.isReady;
  }

  setWaveform(w: Waveform): void {
    this.osc.waveform = w;
  }

  get waveform(): Waveform {
    return this.osc.waveform;
  }

  forTrack(track: Track): Instrument {
    if (track.source.kind === "sf2" && this.soundfont.isReady) return this.soundfont;
    return this.osc;
  }

  /**
   * 연주 전에 채널을 트랙 설정대로 맞춰 둔다.
   * 노트마다 부르지 않고 트랙 설정이 바뀔 때만 부르면 된다.
   * `channel` 은 트랙 번호가 아니라 **MIDI 채널**이다 (model/channels.ts).
   */
  prepare(track: Track, channel: number): void {
    if (track.source.kind === "sf2" && this.soundfont.isReady) {
      this.soundfont.setPreset(channel, track.source.presetId);
    }
  }

  stopAll(): void {
    this.osc.stopAll();
    this.soundfont.stopAll();
  }
}
