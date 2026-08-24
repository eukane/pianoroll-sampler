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
 * ## 릴리즈 꼬리를 남긴다
 *
 * 뜯는 악기(가야금)는 손을 떼도 소리가 바로 안 끊긴다. 노트 길이에서 딱 잘라
 * 버리면 "툭" 하고 끊겨서 악기 소리로 안 들린다. 그래서 노트가 끝난 뒤에도
 * 샘플을 조금 더 흘려보내며 서서히 줄인다. 샘플에 이미 여운이 녹음돼 있으면
 * 그게 그대로 들린다.
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
};

/** 재생 속도로 밀어낼 수 있는 한계(반음). 이보다 멀면 음색이 너무 망가진다. */
const MAX_STRETCH = 12;

/** 손을 뗀 뒤 남기는 여운(초). 뜯는 악기가 자연스럽게 들리는 최소치다. */
const RELEASE = 0.35;

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

    const hold = Math.max(0.05, durationSec);
    gain.gain.setValueAtTime(peak, when);
    gain.gain.setValueAtTime(peak, when + hold);
    // 여운. 지수 곡선이라야 사람 귀에 자연스럽게 잦아든다.
    gain.gain.exponentialRampToValueAtTime(0.0001, when + hold + RELEASE);

    source.connect(gain);
    gain.connect(this.mixer.input(channel));

    // 샘플이 노트보다 짧으면 그냥 끝난다. 길면 여운까지만 흘리고 끊는다.
    const sampleSeconds = entry.buffer.duration / source.playbackRate.value;
    const stopAt = when + Math.min(sampleSeconds, hold + RELEASE) + 0.02;
    source.start(when);
    source.stop(stopAt);

    const voice = { source, gain };
    this.playing.push(voice);
    source.onended = () => {
      gain.disconnect();
      const i = this.playing.indexOf(voice);
      if (i >= 0) this.playing.splice(i, 1);
    };
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
