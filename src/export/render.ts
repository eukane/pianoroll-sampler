/**
 * 오프라인 렌더 — 소리를 실시간보다 빠르게 뽑아 AudioBuffer 로 받는다.
 *
 * 여기서 한 번 헛발을 짚었다. 평소처럼 OfflineAudioContext 에 신스를 만들고
 * noteOn 을 예약했더니 **완전한 무음**이 나왔다. 원인은 라이브러리 문서에
 * 한 줄로 적혀 있다.
 *
 *     Chromium seems to ignore worklet messages for OfflineAudioContext.
 *
 * 오프라인 컨텍스트에서는 워크렛으로 보낸 메시지(noteOn·programChange 등)가
 * 그냥 버려진다. 그래서 **연주 내용을 미리 통째로 넘기는** 전용 입구가 따로
 * 있다: `startOfflineRender({ midiSequence, soundBankList })`.
 *
 * 그 입구가 MIDI 를 받기 때문에 WAV 내보내기가 MIDI 변환을 거친다. 돌아가는
 * 길처럼 보이지만 오히려 낫다 — 내려받은 .mid 와 뽑아낸 .wav 가 **같은
 * 바이트에서 나온 결과**라 둘이 어긋날 수가 없다.
 *
 * 사운드폰트가 없으면 임시 신스로 렌더한다. 음원은 사용자가 직접 넣는
 * 파일이라 없는 게 정상적인 시작점이고, 없다고 내보내기가 막히면 안 된다.
 *
 * 사운드폰트를 ArrayBuffer 가 아니라 **"가져오는 함수"** 로 받는 이유가 있다.
 * `startOfflineRender` 는 넘긴 버퍼를 워크렛으로 transfer 해서 **원본을
 * detach 시킨다.** 그래서 같은 버퍼로 두 번 렌더하면 두 번째가 이렇게 죽는다.
 *
 *     Failed to execute 'postMessage' on 'MessagePort':
 *     ArrayBuffer at index 0 is already detached.
 *
 * 트랙별 WAV(스템)는 트랙 수만큼 렌더하니까 정확히 이 상황이다. 실제로 첫
 * 트랙만 나오고 나머지가 전부 실패했다. 버퍼 대신 함수를 받으면 렌더할 때마다
 * 새로 읽어 오므로 부르는 쪽이 이 함정을 알 필요가 없다.
 */

import { WorkletSynthesizer } from "spessasynth_lib";
import { BasicMIDI } from "spessasynth_core";
import type { Project, Track } from "../model/types";
import { totalBeats } from "../model/project";
import { assignChannels } from "../model/channels";
import { Mixer } from "../audio/mixer";
import { MixerState } from "../audio/mixerState";
import { OscInstrument } from "../audio/oscInstrument";
import { FolderSampler, type SampleFolder } from "../audio/folderSampler";
import { projectToMidi } from "./midi";

export const SAMPLE_RATE = 44100;

/** 마지막 음이 끊기지 않게 뒤에 남기는 여유(초). 릴리즈 꼬리가 여기 들어간다. */
const TAIL_SECONDS = 2.0;

export function projectSeconds(project: Project): number {
  return (totalBeats(project) * 60) / Math.max(1, project.bpm) + TAIL_SECONDS;
}

function workletUrl(): string {
  return `${import.meta.env.BASE_URL}spessasynth_processor.min.js`;
}

/** 트랙 하나만 남긴 프로젝트. 스템(트랙별 WAV)을 뽑을 때 쓴다. */
export function onlyTrack(project: Project, index: number): Project {
  return { ...project, tracks: [project.tracks[index]] };
}

/** 렌더할 때마다 새 버퍼를 내주는 함수. 없으면 null 을 돌려주면 된다. */
export type SoundBankSource = () => Promise<ArrayBuffer | null>;

/**
 * 한 프로젝트에 사운드폰트 트랙과 샘플 폴더 트랙이 섞여 있을 수 있다.
 * 둘은 렌더 방식이 완전히 달라서(하나는 MIDI 를 통째로 넘기고, 하나는 노트를
 * 직접 꽂는다) **각각 렌더한 뒤 더한다.** 한 컨텍스트에 억지로 밀어 넣으면
 * startOfflineRender 가 컨텍스트를 가져가 버려 나머지가 묻힌다.
 */
export async function renderProject(
  project: Project,
  getSoundBank: SoundBankSource,
  folders: SampleFolder[] = [],
  mixerState: MixerState = new MixerState(),
): Promise<AudioBuffer> {
  const frames = Math.max(1, Math.ceil(projectSeconds(project) * SAMPLE_RATE));
  const soundBank = await getSoundBank();

  const isFolderTrack = (t: Track) => t.source.kind === "sampleFolder";
  const sfTracks = project.tracks.filter((t) => !isFolderTrack(t));
  const localTracks = project.tracks.filter(isFolderTrack);

  const passes: AudioBuffer[] = [];

  // 사운드폰트 트랙 (음원이 없으면 임시 신스로)
  if (sfTracks.length > 0) {
    const ctx = new OfflineAudioContext(2, frames, SAMPLE_RATE);
    const part = { ...project, tracks: sfTracks };
    if (soundBank) {
      await renderWithSoundFont(ctx, part, project, soundBank, mixerState);
    } else {
      renderLocally(ctx, part, project, [], mixerState);
    }
    passes.push(await ctx.startRendering());
  }

  // 샘플 폴더 트랙
  if (localTracks.length > 0) {
    const ctx = new OfflineAudioContext(2, frames, SAMPLE_RATE);
    renderLocally(ctx, { ...project, tracks: localTracks }, project, folders, mixerState);
    passes.push(await ctx.startRendering());
  }

  if (passes.length === 0) {
    return new OfflineAudioContext(2, frames, SAMPLE_RATE).startRendering();
  }
  return passes.length === 1 ? passes[0] : mixDown(passes, frames);
}

/** 여러 번 나눠 렌더한 결과를 하나로 더한다. */
function mixDown(buffers: AudioBuffer[], frames: number): AudioBuffer {
  const out = buffers[0];
  for (let c = 0; c < out.numberOfChannels; c += 1) {
    const target = out.getChannelData(c);
    for (let b = 1; b < buffers.length; b += 1) {
      const src = buffers[b].getChannelData(Math.min(c, buffers[b].numberOfChannels - 1));
      for (let i = 0; i < frames; i += 1) target[i] += src[i];
    }
  }
  return out;
}

async function renderWithSoundFont(
  ctx: OfflineAudioContext,
  part: Project,
  full: Project,
  soundBank: ArrayBuffer,
  mixerState: MixerState,
): Promise<void> {
  await ctx.audioWorklet.addModule(workletUrl());
  const synth = new WorkletSynthesizer(ctx);

  // 마스터로 한 번에 받지 않고 채널을 따로 뽑아 믹서를 거친다.
  // 개별 출력이 OfflineAudioContext 에서도 살아 있는 걸 확인하고 이렇게 했다.
  // 덕분에 화면에서 들은 음량·팬·리버브가 뽑아낸 WAV 와 같다.
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const mixer = new Mixer(ctx, master);
  synth.connectIndividualOutputs(mixer.inputs);
  mixerState.apply(full, mixer);

  // 안 들리는 트랙은 아예 빼고 MIDI 를 만든다. 믹서에서 0 으로 눌러도 되지만,
  // 소리를 만들지 않는 쪽이 렌더가 빠르다.
  const audible = part.tracks.filter((t) => mixerState.isAudible(t));
  // 음량·팬은 싣지 않는다. 믹서가 이미 걸고 있어서 여기서 또 실으면 두 번
  // 줄어든다 (export/midi.ts 의 MidiOptions 참고).
  const midi = BasicMIDI.fromArrayBuffer(
    toArrayBuffer(
      projectToMidi(
        { ...full, tracks: full.tracks.map((t) => (audible.includes(t) ? t : { ...t, notes: [] })) },
        { includeMixer: false },
      ),
    ),
  );
  // 문서 경고: 신스를 만든 직후, 다른 걸 부르기 전에 이걸 불러야 한다.
  await synth.startOfflineRender({
    midiSequence: midi,
    loopCount: 0,
    soundBankList: [{ bankOffset: 0, soundBankBuffer: soundBank }],
    sequencerOptions: {
      /**
       * **앞 무음을 자르지 않는다.**
       *
       * 기본값은 켜져 있다. MIDI 플레이어에서는 맞는 편의 기능이다 — 파일을
       * 틀었는데 3초를 기다리게 하지 않으니까. 그런데 우리는 플레이어가 아니라
       * 편집기다. 첫 노트가 1박에 있으면 그 자리에서 나야 한다.
       *
       * 이걸 모르고 뒀다가 렌더 경로 둘이 어긋났다. 1박(0.5초)에 같은 노트를
       * 놓고 재 보니
       *
       *     폴더 샘플러 트랙 → 22062번째 샘플 (이론값 22050, 정확)
       *     SF2 트랙        →   136번째 샘플 (맨 앞으로 당겨짐)
       *
       * 497ms 차이다. 트랙 하나만 뽑아 보면 "좀 일찍 시작하네" 정도라 그냥
       * 넘어가는데, 두 종류를 같이 뽑으면 가야금만 반 박 밀려 들린다.
       */
      skipToFirstNoteOn: false,
    },
  });
}

/**
 * 샘플 폴더와 임시 신스는 스케줄러 없이 모든 노트를 절대 시각으로 미리 꽂는다.
 * 실시간 이벤트 루프가 필요 없는 게 `play(..., when)` 설계의 값이다 (M1 참고).
 *
 * `full` 은 원본 프로젝트다. 채널 번호를 원래 트랙 순서에서 뽑아야 트랙별
 * 음량·팬이 실제 재생과 같아진다.
 */
function renderLocally(
  ctx: OfflineAudioContext,
  part: Project,
  full: Project,
  folders: SampleFolder[],
  mixerState: MixerState,
): void {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const mixer = new Mixer(ctx, master);
  const osc = new OscInstrument(ctx, mixer);
  const sampler = new FolderSampler(ctx, mixer);
  sampler.adopt(folders);

  const secPerBeat = 60 / Math.max(1, part.bpm);

  for (const track of part.tracks) {
    if (!mixerState.isAudible(track)) continue;
    const channel = assignChannels(full)[Math.max(0, full.tracks.indexOf(track))];
    mixer.set(channel, {
      volume: track.volume,
      pan: track.pan,
      muted: false,
      send: track.reverbSend ?? 0,
    });

    let instrument: OscInstrument | FolderSampler = osc;
    if (track.source.kind === "sampleFolder") {
      if (sampler.get(track.source.folderId)) {
        sampler.setChannelFolder(channel, track.source.folderId);
        instrument = sampler;
      }
    }

    for (const note of track.notes) {
      instrument.play(
        note.pitch,
        note.velocity,
        note.start * secPerBeat,
        Math.max(0.02, note.length * secPerBeat),
        channel,
      );
    }
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
