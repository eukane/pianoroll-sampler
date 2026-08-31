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
import { FolderSampler } from "./folderSampler";
import type { VoiceBank } from "./voicebank";

export class InstrumentRegistry {
  readonly osc: OscInstrument;
  readonly soundfont: SoundFontInstrument;
  readonly folders: FolderSampler;
  /**
   * 노래하는 음원들. 다른 악기와 달리 `Instrument` 가 아니다 — 노트 하나씩
   * 소리를 낼 수 없어서다(model/phrase.ts). 재생·렌더 쪽이 줄 단위로 부른다.
   */
  readonly voices = new Map<string, VoiceBank>();

  constructor(
    private ctx: AudioContext,
    mixer: Mixer,
  ) {
    this.osc = new OscInstrument(ctx, mixer);
    this.soundfont = new SoundFontInstrument(ctx, mixer);
    this.folders = new FolderSampler(ctx, mixer);
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

  /** 이 트랙이 노래하는 트랙이면 그 음원. 아니거나 음원이 없으면 null. */
  voiceFor(track: Track): VoiceBank | null {
    if (track.source.kind !== "voice") return null;
    return this.voices.get(track.source.bankId) ?? null;
  }

  addVoice(bank: VoiceBank, id: string): void {
    this.voices.set(id, bank);
  }

  /**
   * 이 곡에 적힌 노랫말만 미리 풀어 둔다.
   *
   * 디코딩은 비동기라 재생·렌더 도중에는 못 한다. 그렇다고 폴더를 넣자마자
   * 전부 풀 수도 없다 — UTAU 음원은 파일이 백 개가 넘는다. 실제로 부르는
   * 글자만, 시작하기 직전에 푼다. 빼먹으면 노래 트랙만 조용히 빈다.
   */
  async prepareVoices(tracks: Track[]): Promise<void> {
    for (const track of tracks) {
      const bank = this.voiceFor(track);
      if (!bank) continue;
      await bank.prepare(this.ctx, track.notes.map((n) => n.lyric ?? ""));
    }
  }

  get voiceList(): { id: string; name: string; sounds: number }[] {
    return [...this.voices.entries()].map(([id, b]) => ({ id, name: b.name, sounds: b.soundCount }));
  }

  forTrack(track: Track): Instrument {
    // 노래하는 트랙은 여기로 오면 안 된다. 그래도 왔으면(음원이 아직 안 들어온
    // 경우 등) 임시 신스로 낸다 — 소리가 아예 안 나면 고장 난 줄 안다.
    if (track.source.kind === "voice") return this.osc;
    if (track.source.kind === "sampleFolder") {
      // 폴더가 아직 안 들어왔으면 임시 신스로. 소리가 아예 안 나면 사용자는
      // 앱이 고장 난 줄 안다.
      return this.folders.get(track.source.folderId) ? this.folders : this.osc;
    }
    if (this.soundfont.isReady) return this.soundfont;
    return this.osc;
  }

  /**
   * 연주 전에 채널을 트랙 설정대로 맞춰 둔다.
   * 노트마다 부르지 않고 트랙 설정이 바뀔 때만 부르면 된다.
   * `channel` 은 트랙 번호가 아니라 **MIDI 채널**이다 (model/channels.ts).
   */
  prepare(track: Track, channel: number): void {
    if (track.source.kind === "voice") return; // 채널에 걸 게 없다
    if (track.source.kind === "sampleFolder") {
      this.folders.setChannelFolder(channel, track.source.folderId);
      return;
    }
    if (this.soundfont.isReady) {
      this.soundfont.setPreset(channel, track.source.presetId);
    }
  }

  stopAll(): void {
    this.osc.stopAll();
    this.soundfont.stopAll();
    this.folders.stopAll();
    for (const bank of this.voices.values()) bank.stopAll();
  }
}
