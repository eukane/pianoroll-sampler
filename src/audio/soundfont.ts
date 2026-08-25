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
import { packPresetId, unpackPresetId } from "../model/preset";

/** 화면에 뿌리는 프리셋 한 줄. */
export type Preset = {
  /** Track.source.presetId 에 저장되는 값. 뱅크와 프로그램을 한 숫자로 묶었다. */
  id: number;
  program: number;
  bankMSB: number;
  bankLSB: number;
  name: string;
};

/**
 * 사운드폰트 파일인지 앞 12바이트로 먼저 본다.
 *
 * 깨진 파일을 그냥 넘기면 워크렛이 파싱하다 조용히 멈춘다 — resolve 도 reject
 * 도 안 해서 `await` 가 영원히 안 끝나고, 화면은 "읽는 중…" 에서 굳는다.
 * 실제로 그렇게 굳는 걸 확인하고 넣은 검사다.
 *
 * 게다가 헤더를 먼저 보면 **멀쩡히 쓰던 사운드폰트를 깨진 파일로 날리는 일**도
 * 막는다. 신스에 넘기기 전에 걸러내기 때문이다.
 *
 *   RIFF....sfbk  = SF2 / SF3
 *   RIFF....DLS   = DLS
 */
export function looksLikeSoundBank(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const head = new Uint8Array(buffer, 0, 12);
  const tag = (from: number) => String.fromCharCode(...head.slice(from, from + 4));
  if (tag(0) !== "RIFF") return false;
  const form = tag(8);
  return form === "sfbk" || form === "DLS ";
}

/** 워크렛이 응답 없이 멈추는 경우를 대비한 상한. 큰 파일도 이 안에는 끝난다. */
const LOAD_TIMEOUT_MS = 60_000;

/**
 * 이 주소에서 사운드폰트를 쓸 수 있는가.
 *
 * AudioWorklet 은 **보안 컨텍스트**에서만 있다. `localhost` 는 예외로 쳐 주지만
 * `http://192.168.0.5:5173` 처럼 IP 로 붙으면 없다. 폰에서 같은 와이파이의
 * 컴퓨터에 접속하는 게 정확히 그 경우라, 아무 처리도 안 하면
 *
 *     Cannot read properties of undefined (reading 'addModule')
 *
 * 이 뜬다. 사용자가 알아들을 수 없는 말이고, 무엇을 하면 되는지도 알 수 없다.
 * 미리 확인해서 사람 말로 알려 준다.
 */
export function canUseSoundFont(): boolean {
  return typeof AudioWorkletNode !== "undefined" && window.isSecureContext;
}

export const INSECURE_HINT =
  "이 주소에서는 사운드폰트(.sf2)를 쓸 수 없습니다. 브라우저가 https 나 localhost 에서만" +
  " 허용하는 기능을 씁니다. 폰에서 쓰려면 `npm run dev:https` 로 띄운 https 주소로 접속하거나," +
  " 폰 안에서 직접 실행하세요. (낱개 WAV 폴더와 임시 신스는 지금도 됩니다)";

export class SoundFontInstrument implements Instrument {
  private synth: WorkletSynthesizer | null = null;
  /**
   * 신스 객체가 있는 것과 **소리 낼 준비가 된 것**은 다르다. 워크렛을 올리고
   * 신스를 만든 시점에는 아직 사운드폰트가 안 들어와 있어서, 여기서 준비됐다고
   * 하면 프리셋 목록이 빈 채로 화면이 그려진다.
   */
  private loaded = false;
  private loadedName = "";
  /**
   * 원본 파일을 들고 있는다. 내보내기(M3)에서 오프라인 렌더용으로 같은
   * 사운드폰트를 **다시** 넘겨야 하는데, ArrayBuffer 를 복사해 두면 수백 MB 가
   * 메모리에 그대로 남는다. File 은 디스크를 가리키는 손잡이라 거의 공짜다.
   */
  private sourceFile: File | null = null;
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

  findPreset(id: number): Preset | undefined {
    return this.presets.find((p) => p.id === id);
  }

  /** 트랙에 걸 만한 기본 악기. 목록의 첫 번째. */
  get defaultPreset(): Preset | undefined {
    return this.presets[0];
  }

  /**
   * 사운드폰트를 읽어 들인다. 처음 부를 때 워크렛도 같이 올린다.
   *
   * 워크렛 파일은 번들러를 거치지 않고 **페이지 기준 URL** 로만 불러올 수 있어서
   * public/ 에 복사해 둔다 (scripts/copy-worklet.mjs).
   */
  /** 내보낼 때 쓸 사운드폰트를 다시 읽어 온다. 없으면 null. */
  async bankBuffer(): Promise<ArrayBuffer | null> {
    if (!this.loaded || !this.sourceFile) return null;
    return this.sourceFile.arrayBuffer();
  }

  async load(file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    const fileName = file.name;
    if (!looksLikeSoundBank(buffer)) {
      throw new Error("사운드폰트 파일이 아니거나 파일이 깨졌습니다 (RIFF/sfbk 헤더가 없습니다)");
    }
    if (!canUseSoundFont()) {
      throw new Error(INSECURE_HINT);
    }

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

    // 헤더가 맞아도 안쪽이 깨져 있으면 워크렛이 응답을 안 보낼 수 있다.
    // 영원히 기다리느니 시간을 끊고 사람 말로 알려 준다.
    await withTimeout(
      (async () => {
        await this.synth!.soundBankManager.addSoundBank(buffer, "main");
        await this.synth!.isReady;
      })(),
      LOAD_TIMEOUT_MS,
      "사운드폰트를 읽다가 응답이 없습니다. 파일이 손상됐을 수 있습니다.",
    );

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
    this.sourceFile = file;
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

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: number;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}
