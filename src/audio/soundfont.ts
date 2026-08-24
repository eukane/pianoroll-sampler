/**
 * SF2 / SF3 사운드폰트 재생 (spessasynth_lib).
 *
 * 고른 이유와 확인 과정은 DECISIONS.md 참고. 요약하면
 *   · SF2·SF3·DLS 를 ArrayBuffer 로 바로 읽는다
 *   · noteOn 이 **절대 시각**을 받아서 M1 의 lookahead 스케줄러를 그대로 쓴다
 *   · 채널 16개 출력을 따로 뽑을 수 있어 트랙별 배선이 된다
 *   · Apache-2.0
 *
 * 사운드폰트 파일은 저장소에 넣지 않는다. 사용자가 직접 넣는다.
 */

import { WorkletSynthesizer } from "spessasynth_lib";
import type { Instrument } from "./instrument";
import type { Mixer } from "./mixer";

/** 화면에 뿌리는 프리셋 한 줄. */
export type Preset = {
  /** Track.source.presetId 에 저장되는 값. 뱅크와 프로그램을 한 숫자로 묶었다. */
  id: number;
  program: number;
  bankMSB: number;
  bankLSB: number;
  name: string;
};

/** 뱅크와 프로그램을 presetId 하나로 묶는다 (모델의 source.presetId 가 number 라서). */
export function packPresetId(bankMSB: number, program: number): number {
  return bankMSB * 128 + program;
}

export function unpackPresetId(id: number): { bankMSB: number; program: number } {
  return { bankMSB: Math.floor(id / 128), program: id % 128 };
}

export class SoundFontInstrument implements Instrument {
  private synth: WorkletSynthesizer | null = null;
  /**
   * 신스 객체가 있는 것과 **소리 낼 준비가 된 것**은 다르다. 워크렛을 올리고
   * 신스를 만든 시점에는 아직 사운드폰트가 안 들어와 있어서, 여기서 준비됐다고
   * 하면 프리셋 목록이 빈 채로 화면이 그려진다.
   */
  private loaded = false;
  private loadedName = "";
  private presets: Preset[] = [];
  /** 채널에 지금 걸려 있는 프리셋. 같은 값을 또 보내지 않으려고 들고 있는다. */
  private channelPreset = new Map<number, number>();

  constructor(
    private ctx: AudioContext,
    private mixer: Mixer,
  ) {}

  get name(): string {
    return this.loadedName || "사운드폰트";
  }

  get isReady(): boolean {
    return this.loaded;
  }

  get presetList(): Preset[] {
    return this.presets;
  }

  /**
   * 사운드폰트를 읽어 들인다. 처음 부를 때 워크렛도 같이 올린다.
   *
   * 워크렛 파일은 번들러를 거치지 않고 **페이지 기준 URL** 로만 불러올 수 있어서
   * public/ 에 복사해 둔다 (scripts/copy-worklet.mjs).
   */
  async load(buffer: ArrayBuffer, fileName: string): Promise<void> {
    if (!this.synth) {
      await this.ctx.audioWorklet.addModule(
        `${import.meta.env.BASE_URL}spessasynth_processor.min.js`,
      );
      const synth = new WorkletSynthesizer(this.ctx);
      // 채널 16개를 트랙별 게인으로 각각 뽑는다. 마스터로 한 번에 받으면
      // 트랙별 음량도, M3 의 스템 내보내기도 못 한다.
      synth.connectIndividualOutputs(this.mixer.inputs);
      this.synth = synth;
    }

    await this.synth.soundBankManager.addSoundBank(buffer, "main");
    await this.synth.isReady;

    this.loadedName = fileName.replace(/\.(sf2|sf3|dls)$/i, "");
    this.presets = this.synth.presetList
      .map((p) => ({
        id: packPresetId(p.bankMSB ?? 0, p.program),
        program: p.program,
        bankMSB: p.bankMSB ?? 0,
        bankLSB: p.bankLSB ?? 0,
        name: (p.name ?? "").trim() || `프로그램 ${p.program}`,
      }))
      .sort((a, b) => a.bankMSB - b.bankMSB || a.program - b.program);

    // 사운드폰트를 바꿔 끼우면 채널에 걸린 프리셋도 다시 보내야 한다.
    this.channelPreset.clear();
    this.loaded = true;
  }

  /** 채널에 프리셋을 건다. 악기 교체가 실제로 일어나는 곳. */
  setPreset(channel: number, presetId: number, when?: number): void {
    if (!this.synth) return;
    if (this.channelPreset.get(channel) === presetId) return;
    this.channelPreset.set(channel, presetId);

    const { bankMSB, program } = unpackPresetId(presetId);
    const options = when === undefined ? undefined : { time: when };
    // 뱅크 선택(CC0/CC32) 후 프로그램 체인지. 표준 MIDI 순서다.
    this.synth.controllerChange(channel, 0, bankMSB, options);
    this.synth.controllerChange(channel, 32, 0, options);
    this.synth.programChange(channel, program, options);
  }

  play(pitch: number, velocity: number, when: number, durationSec: number, channel: number): void {
    if (!this.synth) return;
    this.synth.noteOn(channel, pitch, Math.max(1, Math.round(velocity)), { time: when });
    this.synth.noteOff(channel, pitch, { time: when + durationSec });
  }

  stopAll(): void {
    this.synth?.stopAll(true);
  }
}
