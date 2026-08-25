/**
 * 폴더 샘플러 — 음 하나가 WAV 파일 하나로 오는 음원용.
 *
 * 국악기(가야금·해금·대금)는 SF2 로 배포되는 게 거의 없다. 국립국악원 음원도
 * 단음 WAV 낱개로 온다. 그래서 SF2 샘플러(M2)와 별개로 이게 필요하다.
 *
 * ## 없는 음은 가장 가까운 샘플을 당겨 쓴다
 *
 * 스무 개쯤 받아 봐야 두 옥타브가 다 차지 않는다. 빈 건반을 누르면 아무 일도
 * 안 일어나는 게 아니라, **제일 가까운 샘플을 재생 속도로 밀어서** 채운다.
 * 속도를 바꾸면 음색도 같이 변하니까(반음 몇 개까지가 한계다) 가장 가까운
 * 것을 고르는 게 중요하다.
 *
 * ## 여운을 자를지 말지를 **재서** 정한다
 *
 * 뜯는 악기(가야금)는 손을 떼도 소리가 안 끊긴다. 뜯으면 알아서 1~2초 울리다
 * 잦아든다. 그런데 처음엔 노트 길이 + 0.35초에서 무조건 잘랐다. 1/16 노트
 * (120BPM 에서 0.125초)에 1.2초짜리 샘플이면 **0.475초에서 끊고 여운 0.7초를
 * 버린다.** 가야금다움이 통째로 사라지는 자리다.
 *
 * 그렇다고 항상 끝까지 울리게 두면 부는 악기(대금·해금)가 이상해진다. 3초짜리
 * 지속음이 1/16 노트에서도 3초를 다 울린다.
 *
 * 둘을 가르는 건 **샘플 자체**다. 뜯는 소리는 뒤로 갈수록 작아지고, 부는 소리는
 * 유지된다. 그래서 파일을 읽을 때 앞뒤 음량을 재서 정한다.
 *
 *     앞 10% 구간 RMS 대비 뒤쪽 60% 지점 RMS 가 크게 떨어지면 → 뜯는 소리
 *
 * 뜯는 소리로 판정되면 노트 길이와 무관하게 **샘플이 다 울리게 둔다**(원샷).
 * 지속음으로 판정되면 예전처럼 노트 길이를 따르고 짧은 여운을 붙인다.
 *
 * 추측으로 숫자를 바꾸지 않고 샘플에서 재는 쪽을 골랐다. 국악기 음원은 악기마다
 * 성질이 달라서 하나로 정할 수가 없다.
 *
 * ## 세기 층
 *
 * `_p` `_mf` `_f` 로 여린 소리·센 소리를 따로 녹음해 둔 음원이 있다. 있으면
 * 벨로시티에 맞는 층을 고르고, 없으면 그냥 하나를 쓴다.
 */

import type { Instrument } from "./instrument";
import type { Mixer } from "./mixer";
import { commonLabel, layerVelocity, parseSampleName, type Layer } from "../model/sampleNames";

export type SampleEntry = {
  fileName: string;
  buffer: AudioBuffer;
  /** 이 샘플이 원래 어느 음인지. null 이면 아직 사람이 정해 주지 않은 것. */
  pitch: number | null;
  layer: Layer | null;
  /** 뒤로 갈수록 작아지는 소리인가 (뜯기·치기). 파일을 읽을 때 재서 정한다. */
  decaying: boolean;
};

/** 재생 속도로 밀어낼 수 있는 한계(반음). 이보다 멀면 음색이 너무 망가진다. */
const MAX_STRETCH = 12;

/** 지속음에서 손을 뗀 뒤 남기는 여운(초). */
const RELEASE = 0.35;

/** 동시에 울릴 수 있는 샘플 수. 뜯는 소리는 길게 남아서 금방 쌓인다. */
const MAX_VOICES = 32;

/**
 * 뒤로 갈수록 작아지는 소리인지 잰다.
 *
 * 앞부분(어택 직후)과 뒤쪽 60% 지점의 RMS 를 비교한다. 뜯거나 친 소리는 그때쯤
 * 이미 많이 잦아들어 있고, 활로 켜거나 부는 소리는 비슷하게 유지된다.
 */
function looksDecaying(buffer: AudioBuffer): boolean {
  const data = buffer.getChannelData(0);
  const n = data.length;
  if (n < 4410) return true; // 아주 짧은 건 원샷으로 봐도 무방하다

  const rms = (from: number, to: number) => {
    let sum = 0;
    const a = Math.max(0, Math.floor(from));
    const b = Math.min(n, Math.floor(to));
    for (let i = a; i < b; i += 1) sum += data[i] * data[i];
    return Math.sqrt(sum / Math.max(1, b - a));
  };

  // 어택 자체를 피해 5~15% 구간을 '앞' 으로 본다.
  const head = rms(n * 0.05, n * 0.15);
  const tail = rms(n * 0.55, n * 0.65);
  if (head <= 1e-6) return true;
  // 절반 아래로 떨어졌으면 잦아드는 소리로 본다 (-6dB).
  return tail / head < 0.5;
}

export class SampleFolder {
  readonly id: string;
  name: string;
  entries: SampleEntry[] = [];

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  get mapped(): SampleEntry[] {
    return this.entries.filter((e) => e.pitch !== null);
  }

  get unmapped(): SampleEntry[] {
    return this.entries.filter((e) => e.pitch === null);
  }

  /** 실제로 소리가 나는 음역. 사람에게 "여기부터 여기까지 됩니다" 를 보여 준다. */
  get range(): { low: number; high: number } | null {
    const pitches = this.mapped.map((e) => e.pitch as number);
    if (pitches.length === 0) return null;
    return {
      low: Math.max(0, Math.min(...pitches) - MAX_STRETCH),
      high: Math.min(127, Math.max(...pitches) + MAX_STRETCH),
    };
  }

  get layers(): Layer[] {
    const found = new Set<Layer>();
    for (const e of this.entries) if (e.layer) found.add(e.layer);
    return [...found];
  }

  /**
   * 이 음·이 세기에 제일 맞는 샘플.
   * 음높이가 먼저고 세기는 그다음이다 — 음정이 틀리면 아무 소용이 없다.
   */
  pick(pitch: number, velocity: number): SampleEntry | null {
    const candidates = this.mapped;
    if (candidates.length === 0) return null;

    let best: SampleEntry | null = null;
    let bestScore = Infinity;
    for (const entry of candidates) {
      const distance = Math.abs((entry.pitch as number) - pitch);
      const layerGap = entry.layer ? Math.abs(layerVelocity(entry.layer) - velocity) / 127 : 0.5;
      // 반음 하나 차이가 세기 층 차이보다 훨씬 중요하다.
      const score = distance * 10 + layerGap;
      if (score < bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    return best;
  }
}

export class FolderSampler implements Instrument {
  readonly name = "샘플 폴더";
  private folders = new Map<string, SampleFolder>();
  private playing: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  /** 트랙(채널)마다 어느 폴더를 쓰는지. */
  private channelFolder = new Map<number, string>();

  constructor(
    private ctx: BaseAudioContext,
    private mixer: Mixer,
  ) {}

  get list(): SampleFolder[] {
    return [...this.folders.values()];
  }

  get(id: string): SampleFolder | undefined {
    return this.folders.get(id);
  }

  /**
   * WAV 파일들을 읽어 폴더 하나로 만든다.
   * 못 읽은 파일은 이름과 이유를 돌려준다 — 조용히 빠지면 왜 소리가 안 나는지
   * 알 수가 없다.
   */
  async addFolder(id: string, files: File[]): Promise<{ folder: SampleFolder; failed: string[] }> {
    const folder = new SampleFolder(id, commonLabel(files.map((f) => f.name)));
    const failed: string[] = [];

    for (const file of files) {
      try {
        const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
        const parsed = parseSampleName(file.name);
        folder.entries.push({
          fileName: file.name,
          buffer,
          pitch: parsed.pitch,
          layer: parsed.layer,
          decaying: looksDecaying(buffer),
        });
      } catch {
        failed.push(file.name);
      }
    }

    folder.entries.sort((a, b) => (a.pitch ?? 999) - (b.pitch ?? 999) || a.fileName.localeCompare(b.fileName));
    this.folders.set(id, folder);
    return { folder, failed };
  }

  setChannelFolder(channel: number, folderId: string): void {
    this.channelFolder.set(channel, folderId);
  }

  /**
   * 이미 읽어 둔 폴더를 다른 컨텍스트의 샘플러가 그대로 쓰게 넘겨준다.
   * 오프라인 렌더는 별도의 OfflineAudioContext 를 쓰는데, WAV 를 다시 디코딩할
   * 이유가 없다 — AudioBuffer 는 컨텍스트를 가리지 않는 순수한 데이터다.
   */
  adopt(folders: SampleFolder[]): void {
    for (const folder of folders) this.folders.set(folder.id, folder);
  }

  play(pitch: number, velocity: number, when: number, durationSec: number, channel: number): void {
    const folderId = this.channelFolder.get(channel);
    const folder = folderId ? this.folders.get(folderId) : undefined;
    const entry = folder?.pick(pitch, velocity);
    if (!entry || entry.pitch === null) return;

    const semitones = pitch - entry.pitch;
    if (Math.abs(semitones) > MAX_STRETCH) return; // 너무 멀면 소리를 내지 않는다

    const source = this.ctx.createBufferSource();
    source.buffer = entry.buffer;
    // 재생 속도를 바꿔 음정을 옮긴다. 반음 = 2^(1/12) 배.
    source.playbackRate.value = 2 ** (semitones / 12);

    const gain = this.ctx.createGain();
    // 층이 있으면 이미 세기가 녹음에 담겨 있으니 볼륨을 덜 건드린다.
    const scale = entry.layer ? 0.55 + (velocity / 127) * 0.35 : (velocity / 127) * 0.9;
    const peak = Math.max(0.02, scale);

    const sampleSeconds = entry.buffer.duration / source.playbackRate.value;
    const hold = Math.max(0.05, durationSec);
    let stopAt: number;

    if (entry.decaying) {
      // 뜯거나 친 소리 — 노트 길이와 무관하게 다 울리게 둔다.
      // 실제 가야금이 그렇다. 손을 떼도 줄은 계속 울린다.
      gain.gain.setValueAtTime(peak, when);
      stopAt = when + sampleSeconds + 0.02;
    } else {
      // 활·입으로 내는 소리 — 손을 떼면 멎어야 한다.
      gain.gain.setValueAtTime(peak, when);
      gain.gain.setValueAtTime(peak, when + hold);
      // 지수 곡선이라야 사람 귀에 자연스럽게 잦아든다.
      gain.gain.exponentialRampToValueAtTime(0.0001, when + hold + RELEASE);
      stopAt = when + Math.min(sampleSeconds, hold + RELEASE) + 0.02;
    }

    source.connect(gain);
    gain.connect(this.mixer.input(channel));

    source.start(when);
    source.stop(stopAt);

    // 여운을 길게 남기면 보이스가 금방 쌓인다. 상한을 두고 오래된 것부터 뺏는다.
    if (this.playing.length >= MAX_VOICES) this.steal();

    const voice = { source, gain };
    this.playing.push(voice);
    source.onended = () => {
      gain.disconnect();
      const i = this.playing.indexOf(voice);
      if (i >= 0) this.playing.splice(i, 1);
    };
  }

  /** 가장 오래된 보이스를 짧게 페이드아웃시키고 자리를 넘긴다. */
  private steal(): void {
    const v = this.playing.shift();
    if (!v) return;
    const now = this.ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
      v.source.stop(now + 0.03);
    } catch {
      /* 이미 끝난 노드 */
    }
  }

  stopAll(): void {
    const now = this.ctx.currentTime;
    for (const v of this.playing) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
        v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
        v.source.stop(now + 0.04);
      } catch {
        /* 이미 끝난 노드 */
      }
    }
    this.playing = [];
  }
}
