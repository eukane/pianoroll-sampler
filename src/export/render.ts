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
import type { Project } from "../model/types";
import { totalBeats } from "../model/project";
import { channelForTrack } from "../model/channels";
import { Mixer } from "../audio/mixer";
import { OscInstrument } from "../audio/oscInstrument";
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

export async function renderProject(
  project: Project,
  getSoundBank: SoundBankSource,
): Promise<AudioBuffer> {
  const frames = Math.ceil(projectSeconds(project) * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, Math.max(1, frames), SAMPLE_RATE);

  const soundBank = await getSoundBank();
  if (soundBank) {
    await renderWithSoundFont(ctx, project, soundBank);
  } else {
    renderWithOscillator(ctx, project);
  }
  return ctx.startRendering();
}

async function renderWithSoundFont(
  ctx: OfflineAudioContext,
  project: Project,
  soundBank: ArrayBuffer,
): Promise<void> {
  await ctx.audioWorklet.addModule(workletUrl());
  const synth = new WorkletSynthesizer(ctx);
  synth.connect(ctx.destination);

  const midi = BasicMIDI.fromArrayBuffer(toArrayBuffer(projectToMidi(project)));
  // 문서 경고: 신스를 만든 직후, 다른 걸 부르기 전에 이걸 불러야 한다.
  await synth.startOfflineRender({
    midiSequence: midi,
    loopCount: 0,
    soundBankList: [{ bankOffset: 0, soundBankBuffer: soundBank }],
  });
}

/** 음원이 없을 때. 스케줄러 없이 모든 노트를 절대 시각으로 미리 꽂는다. */
function renderWithOscillator(ctx: OfflineAudioContext, project: Project): void {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const mixer = new Mixer(ctx, master);
  const osc = new OscInstrument(ctx as unknown as AudioContext, mixer);
  const secPerBeat = 60 / Math.max(1, project.bpm);

  project.tracks.forEach((track, index) => {
    if (track.muted) return;
    const channel = channelForTrack(index);
    mixer.set(channel, track.volume, track.pan, false);
    for (const note of track.notes) {
      osc.play(
        note.pitch,
        note.velocity,
        note.start * secPerBeat,
        Math.max(0.02, note.length * secPerBeat),
        channel,
      );
    }
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
