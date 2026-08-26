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
import { MAX_CHANNELS, type Mixer } from "./mixer";
import { packPresetId, unpackPresetId } from "../model/preset";

/** 화면에 뿌리는 프리셋 한 줄. */
export type Preset = {
  /** Track.source.presetId 에 저장되는 값. 뱅크·프로그램·드럼 여부를 한 숫자로 묶었다. */
  id: number;
  program: number;
  bankMSB: number;
  bankLSB: number;
  name: string;
  /** 드럼 킷인가. 번호가 일반 악기와 겹쳐서 이 구분이 없으면 엉뚱한 악기가 걸린다. */
  isDrum: boolean;
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
  /**
   * 신스 안쪽 시계가 AudioContext 시계보다 얼마나 뒤처져 있는가(초).
   * `calibrate()` 가 실측해서 넣는다. 자세한 사연은 아래 calibrate() 주석.
   */
  private clockOffset = 0;
  /** 지금 돌고 있는 보정 작업. 끝나야 값이 확정된다. */
  private calibration: Promise<number> = Promise.resolve(0);
  private calibrating = false;

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
  /**
   * 사운드폰트 파일 크기(바이트). 안 읽고 알 수 있다.
   *
   * 크기를 알려고 `bankBuffer()` 를 부르면 **파일을 통째로 읽는다.** 100MB 짜리면
   * 100MB 를 읽어 놓고 byteLength 만 보고 버리는 셈이다. File 은 크기를 그냥
   * 들고 있으니 그걸 쓴다.
   */
  get bankSizeBytes(): number {
    return this.sourceFile?.size ?? 0;
  }

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
      // 이벤트 시스템은 쓰지 않는다. 워크렛이 노트마다 메인 스레드로 알림을
      // 보내는데, 우리는 듣는 쪽이 없어서 그대로 버려진다. 폰에서는 그 왕복이
      // 그냥 낭비다.
      const synth = new WorkletSynthesizer(this.ctx, { eventsEnabled: false });
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
        // isDrum 이 라이브러리가 권하는 판별 방법이다 (isGMGSDrum 은 GM/GS 만 잡는다).
        id: packPresetId(p.bankMSB ?? 0, p.program, p.isDrum === true),
        program: p.program,
        bankMSB: p.bankMSB ?? 0,
        bankLSB: p.bankLSB ?? 0,
        name: (p.name ?? "").trim() || `프로그램 ${p.program}`,
        isDrum: p.isDrum === true,
      }))
      // 일반 악기를 먼저, 드럼 킷을 뒤로. 대부분 악기를 찾는다.
      .sort((a, b) =>
        Number(a.isDrum) - Number(b.isDrum) || a.bankMSB - b.bankMSB || a.program - b.program);

    // 사운드폰트를 바꿔 끼우면 채널에 걸린 프리셋도 다시 보내야 한다.
    this.channelPreset.clear();
    this.loaded = true;
    this.sourceFile = file;

    // 실제로 소리가 나는 시각을 재서 어긋난 만큼을 보정한다.
    // **기다리지 않는다.** 재는 데 2초쯤 걸리는데, 그동안 악기 목록을 못 보고
    // 있으면 "멈춘 줄 알았다" 가 된다. 목록은 지금 바로 주고 보정은 뒤에서 한다.
    // 실패해도 0 으로 두고 넘어간다 — 박자가 조금 밀릴 뿐 소리는 난다.
    void this.calibrate();
  }

  /** 보정이 끝나기를 기다린다. 끝난 뒤의 보정값(ms)을 돌려준다. */
  async whenCalibrated(): Promise<number> {
    await this.calibration;
    return this.clockOffsetMs;
  }

  /**
   * 신스가 예약을 얼마나 늦게 지키는지 **실측**해서 `clockOffset` 에 넣는다.
   *
   * 왜 필요한가. 우리는 노트를 `noteOn(..., { time: 절대시각 })` 으로 미리
   * 예약한다. 그런데 그 시각을 판정하는 시계는 AudioContext 의 시계가 아니라
   * **워크렛 안에서 따로 세는 시계**다 (spessasynth 는 프로세서가 만들어진
   * 순간의 시각을 시작점으로 잡고, 그 뒤로는 렌더한 샘플 수만큼 더한다).
   *
   * 프로세서가 만들어진 시점과 그래프가 실제로 그 노드를 돌리기 시작한 시점
   * 사이의 틈이 그대로 **영구 오차**로 남는다. 헤드리스 크로미움에서 재 보니
   * 70.9ms 였고, 27초 동안 한 샘플도 안 변했다 — 흘러가는 게 아니라 처음에
   * 한 번 어긋난 채로 고정되는 종류다.
   *
   *     임시 신스 / 낱개 WAV : 정확히 제시간   (AudioBufferSourceNode 가 지킨다)
   *     사운드폰트          : 70.9ms 늦음
   *
   * 120BPM 에서 한 박의 14% 다. 두 트랙을 같이 들으면 바로 어긋나게 들린다.
   *
   * 값이 기기마다 다르므로 상수로 박을 수 없다. 그래서 잰다.
   *
   * 재는 법: 채널 하나(15번)를 믹서에서 잠깐 떼어 **분석기에만** 물리고, 같은
   * 시각에 예약한 기준 오실레이터(역시 분석기에만 연결)와 비교한다. 둘 다
   * 스피커로 가지 않으므로 **소리가 나지 않는다.** 분석기 두 개를 같은 틱에
   * 읽으면 버퍼 끝 시각이 같아서, 두 파형의 시작 샘플 차이가 곧 어긋난 양이다.
   */
  calibrate(): Promise<number> {
    // 두 번 겹쳐 돌면 채널을 떼었다 붙였다 하는 게 엉킨다. 돌고 있으면 그걸 준다.
    if (this.calibrating) return this.calibration;
    this.calibrating = true;
    this.calibration = this.runCalibration().finally(() => {
      this.calibrating = false;
    });
    return this.calibration;
  }

  private async runCalibration(): Promise<number> {
    const synth = this.synth;
    // 드럼 킷을 15번 채널(타악기 채널이 아니다)에 걸면 소리가 안 날 수 있다.
    const preset = this.presets.find((p) => !p.isDrum) ?? this.presets[0];
    if (!synth || !preset) return this.clockOffset;

    // 소리가 아직 잠겨 있으면(첫 터치 전) 잴 수가 없다. 잠깐 기다려 본다.
    const running = () => this.ctx.state === "running";
    if (!running()) {
      await Promise.race([
        new Promise<void>((resolve) => {
          this.ctx.addEventListener("statechange", () => {
            if (running()) resolve();
          });
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (!running()) return this.clockOffset;
    }

    // 15번 채널을 잠깐 빌린다. 드럼 채널(9)이 아니고, 트랙이 15개를 넘지 않는
    // 한 비어 있다. 보정하는 2초 동안만 믹서에서 떨어져 있다.
    const CH = MAX_CHANNELS - 1;
    const mixerInput = this.mixer.inputs[CH];
    const measured: number[] = [];

    try {
      synth.disconnectChannel(mixerInput, CH);
      // 프리셋 캐시를 비워 두지 않으면 아래 setPreset 이 걸러진다.
      this.channelPreset.delete(CH);
      this.setPreset(CH, preset.id);

      // 3회. 첫 회는 버린다 — 프로그램 체인지 뒤 **첫 음**은 워크렛이 샘플을
      // 처음 만지느라 따로 늦다(같은 조건에서 123ms 대 55ms). 그건 매번 생기는
      // 지연이 아니라서 보정값으로 삼으면 나머지가 전부 당겨진다.
      for (let round = 0; round < 3; round += 1) {
        const value = await this.measureOnce(synth, CH);
        if (round > 0 && value !== null && value > 0.002 && value < 0.4) measured.push(value);
      }
    } catch {
      /* 못 재면 보정하지 않는다 */
    } finally {
      try {
        synth.connectChannel(mixerInput, CH);
      } catch {
        /* 이미 연결돼 있으면 그만이다 */
      }
      this.channelPreset.delete(CH);
    }

    // 가장 작은 값. 측정 오차는 늦는 쪽으로만 생긴다.
    // 말이 되는 범위를 벗어난 회차는 위에서 이미 버렸다 — 잘못 잰 값으로
    // 박자를 밀면 안 고친 것보다 나쁘다.
    if (measured.length > 0) this.clockOffset = Math.min(...measured);
    return this.clockOffset;
  }

  /** calibrate() 한 회차. 실패하면 null. */
  private async measureOnce(synth: WorkletSynthesizer, channel: number): Promise<number | null> {
    const FFT = 32768; // 743ms 창. 노트가 이 안에 들어와야 잡힌다
    const ctx = this.ctx;

    // 앞 회차의 여운이 창(743ms) 안에 남아 있으면 그걸 시작점으로 잡아
    // 말도 안 되는 값이 나온다. 끊고, 잦아들 때까지 기다린 뒤에 분석기를 단다.
    //
    // stopAll 이 아니라 **이 채널만** 끈다(CC120). 보정은 뒤에서 도는 작업이라,
    // 그 사이 사용자가 재생을 눌렀으면 stopAll 은 그 소리까지 잘라 버린다.
    synth.controllerChange(channel, 120, 0);
    await new Promise((r) => setTimeout(r, 180));

    const tap = () => {
      const a = ctx.createAnalyser();
      a.fftSize = FFT;
      return a;
    };
    const refTap = tap();
    const synthTap = tap();
    synth.connectChannel(synthTap, channel);

    // 기준음. 분석기에만 연결하므로 스피커로 나가지 않는다.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    osc.connect(gain);
    gain.connect(refTap);

    const when = ctx.currentTime + 0.15;
    osc.start(when);
    osc.stop(when + 0.12);
    synth.noteOn(channel, 69, 100, { time: when });
    synth.noteOff(channel, 69, { time: when + 0.12 });

    await new Promise((r) => setTimeout(r, 430));

    const refBuf = new Float32Array(FFT);
    const synthBuf = new Float32Array(FFT);
    // 같은 틱에 연달아 읽어야 두 버퍼의 끝 시각이 같다.
    refTap.getFloatTimeDomainData(refBuf);
    synthTap.getFloatTimeDomainData(synthBuf);

    osc.disconnect();
    gain.disconnect();
    refTap.disconnect();
    try {
      synth.disconnectChannel(synthTap, channel);
    } catch {
      /* 무시 */
    }
    synthTap.disconnect();

    const refAt = firstAudible(refBuf);
    const synthAt = firstAudible(synthBuf);
    if (refAt < 0 || synthAt < 0) return null;
    return (synthAt - refAt) / ctx.sampleRate;
  }

  /** 실측한 어긋남(밀리초). 화면에 보여 주거나 시험에서 확인할 때 쓴다. */
  get clockOffsetMs(): number {
    return this.clockOffset * 1000;
  }

  /** 채널에 프리셋을 건다. 악기 교체가 실제로 일어나는 곳. */
  setPreset(channel: number, presetId: number, when?: number): void {
    if (!this.synth) return;
    if (this.channelPreset.get(channel) === presetId) return;
    this.channelPreset.set(channel, presetId);

    const { bankMSB, program, isDrum } = unpackPresetId(presetId);
    const options = when === undefined ? undefined : { time: when - this.clockOffset };
    // 드럼은 9번 채널에 놓기 때문에(model/channels.ts) 뱅크를 따로 보내지 않는다.
    // 신스가 그 채널을 알아서 타악기로 다룬다.
    if (!isDrum) {
      // 뱅크 선택(CC0/CC32) 후 프로그램 체인지. 표준 MIDI 순서다.
      this.synth.controllerChange(channel, 0, bankMSB, options);
      this.synth.controllerChange(channel, 32, 0, options);
    }
    this.synth.programChange(channel, program, options);
  }

  play(pitch: number, velocity: number, when: number, durationSec: number, channel: number): void {
    if (!this.synth) return;
    // 신스 안쪽 시계가 뒤처져 있는 만큼 당겨서 준다 (calibrate() 참고).
    const at = when - this.clockOffset;
    this.synth.noteOn(channel, pitch, Math.max(1, Math.round(velocity)), { time: at });
    this.synth.noteOff(channel, pitch, { time: at + durationSec });
  }

  /**
   * 건반을 누르고 있는 동안 나는 소리. 신스는 원래 MIDI 대로 noteOn/noteOff 를
   * 따로 받는 물건이라 여기서는 그대로 흘려 보내면 된다.
   *
   * 시각은 `clockOffset` 만큼 당긴다 — 신스 시계가 그만큼 뒤처져 있어서, 빼 주지
   * 않으면 "지금" 이 신스에게는 미래가 되어 늦게 울린다 (calibrate() 참고).
   */
  hold(pitch: number, velocity: number, channel: number): void {
    if (!this.synth) return;
    this.synth.noteOn(channel, pitch, Math.max(1, Math.round(velocity)), {
      time: this.ctx.currentTime - this.clockOffset,
    });
  }

  release(pitch: number, channel: number): void {
    if (!this.synth) return;
    this.synth.noteOff(channel, pitch, { time: this.ctx.currentTime - this.clockOffset });
  }

  stopAll(): void {
    this.synth?.stopAll(true);
  }
}

/** 파형에서 소리가 시작한 샘플 번호. 없으면 -1. */
function firstAudible(data: Float32Array): number {
  for (let i = 0; i < data.length; i += 1) if (Math.abs(data[i]) > 1e-4) return i;
  return -1;
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
