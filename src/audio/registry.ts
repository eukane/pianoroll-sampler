/**
 * 트랙의 `source` → 실제 악기 객체.
 *
 * 여기가 **악기 교체가 일어나는 유일한 지점**이다. 피아노롤도 스케줄러도
 * 트랙이 무슨 음원을 쓰는지 모르고, 이 함수만 부른다. M2 에서 SF2 샘플러를
 * 붙일 때 고칠 파일도 여기 하나다.
 *
 * M1 에는 아직 음원 로더가 없으므로 어떤 source 든 임시 오실레이터를 돌려준다.
 */

import type { Track } from "../model/types";
import type { Instrument } from "./instrument";
import { OscInstrument, type Waveform } from "./oscInstrument";

export class InstrumentRegistry {
  private fallback: OscInstrument;

  constructor(ctx: AudioContext) {
    this.fallback = new OscInstrument(ctx);
  }

  /** M1 한정: 파형 바꾸기. M2 부터는 프리셋 선택이 이 자리를 대신한다. */
  setWaveform(w: Waveform): void {
    this.fallback.waveform = w;
  }

  get waveform(): Waveform {
    return this.fallback.waveform;
  }

  /** 트랙이 무슨 음원을 쓰든 M1 에서는 임시 신스로 돌려준다. */
  forTrack(_track: Track): Instrument {
    return this.fallback;
  }

  stopAll(): void {
    this.fallback.stopAll();
  }
}
