/**
 * 재생 스케줄러 (lookahead 방식).
 *
 * setInterval 이 부르는 시각에 맞춰 소리를 내면 안 된다. 타이머는 수십 ms 씩
 * 밀리고, 폰에서는 스크롤만 해도 더 밀린다. 그 위에 음악을 얹으면 박자가
 * 흔들린다.
 *
 * 그래서 **타이머는 '예약'만 하고, 실제 시각은 AudioContext 시계가 잡는다.**
 *   · 25ms 마다 깨어나서
 *   · 앞으로 120ms 안에 시작할 노트를 미리 예약해 둔다
 *   · 예약은 ctx.currentTime 기준 절대 시각으로 넣는다 (오디오 스레드가 지킨다)
 *
 * 120ms 는 타협값이다. 짧으면 타이머가 한 번 밀렸을 때 노트를 놓치고, 길면
 * 재생 중에 노트를 고쳤을 때 반영이 늦다. 폰에서 25/120 이 둘 다 안전했다.
 *
 * 재생 위치(재생 헤드)는 예약 상태와 **따로** 계산한다. 예약은 미래로 앞서
 * 나가 있어서 그걸로 위치를 그리면 헤드가 앞질러 간다.
 */

import type { Project } from "../model/types";
import type { AudioEngine } from "./engine";
import type { InstrumentRegistry } from "./registry";
import type { Mixer } from "./mixer";
import type { MixerState } from "./mixerState";
import { totalBeats } from "../model/project";
import { assignChannels, channelForTrack } from "../model/channels";

const TICK_MS = 25;
const LOOKAHEAD_SEC = 0.12;

type Event = {
  trackIndex: number;
  pitch: number;
  velocity: number;
  start: number; // 박
  length: number; // 박
};

export class Scheduler {
  private playing = false;
  private timer: number | null = null;

  private events: Event[] = [];
  private evIdx = 0;

  private startTime = 0; // regionStart 에 해당하는 ctx 시각
  private passBase = 0; // 지금 예약 중인 루프 회차의 시작 ctx 시각
  private regionStart = 0;
  private regionEnd = 0;

  private stoppedAt = 0; // 정지 상태에서 헤드를 그릴 위치(박)

  loopEnabled = false;
  loopStart = 0;
  loopEnd = 4;

  onStop: (() => void) | null = null;

  constructor(
    private engine: AudioEngine,
    private registry: InstrumentRegistry,
    private mixer: Mixer,
    private mixerState: MixerState,
    private getProject: () => Project,
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  private get secPerBeat(): number {
    return 60 / Math.max(20, this.getProject().bpm);
  }

  private get regionBeats(): number {
    return Math.max(0.0001, this.regionEnd - this.regionStart);
  }

  // ------------------------------------------------------------- 재생 제어

  play(fromBeat?: number): void {
    if (this.playing) return;
    const project = this.getProject();

    if (this.loopEnabled && this.loopEnd - this.loopStart > 0.01) {
      this.regionStart = this.loopStart;
      this.regionEnd = this.loopEnd;
    } else {
      this.regionStart = 0;
      this.regionEnd = totalBeats(project);
    }

    let from = fromBeat ?? this.stoppedAt;
    if (from < this.regionStart || from >= this.regionEnd) from = this.regionStart;

    this.buildEvents();
    // 채널마다 악기와 음량을 걸어 둔다. 노트마다 보내면 같은 메시지가 수백 번 나간다.
    const channels = assignChannels(project);
    project.tracks.forEach((t, i) => this.registry.prepare(t, channels[i]));
    this.mixerState.apply(project, this.mixer);
    this.startTime = this.engine.currentTime - (from - this.regionStart) * this.secPerBeat;
    this.passBase = this.startTime;
    this.evIdx = this.firstEventAtOrAfter(from);

    this.playing = true;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (!this.playing) return;
    this.stoppedAt = this.positionBeats();
    this.playing = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.registry.stopAll();
    this.onStop?.();
  }

  /** 정지 상태에서 헤드 위치만 옮긴다 (룰러를 탭했을 때). */
  seek(beat: number): void {
    this.stoppedAt = Math.max(0, beat);
    if (this.playing) {
      this.stop();
      this.play(this.stoppedAt);
    }
  }

  /**
   * 노트나 BPM 이 바뀌었다. 예약 목록을 다시 만들고 현재 위치에 다시 맞춘다.
   * 이미 예약된 120ms 안의 노트는 그대로 울린다 (귀로 구분 못 하는 차이다).
   */
  invalidate(): void {
    if (!this.playing) return;
    const pos = this.positionBeats();
    this.buildEvents();
    this.startTime = this.engine.currentTime - (pos - this.regionStart) * this.secPerBeat;
    this.passBase = this.startTime;
    this.evIdx = this.firstEventAtOrAfter(pos);
  }

  /** 지금 재생 헤드가 몇 박에 있는가. */
  positionBeats(): number {
    if (!this.playing) return this.stoppedAt;
    const elapsedBeats = (this.engine.currentTime - this.startTime) / this.secPerBeat;
    if (this.loopEnabled) {
      const len = this.regionBeats;
      const wrapped = ((elapsedBeats % len) + len) % len;
      return this.regionStart + wrapped;
    }
    return Math.min(this.regionEnd, this.regionStart + Math.max(0, elapsedBeats));
  }

  // ------------------------------------------------------------- 내부

  private buildEvents(): void {
    const project = this.getProject();
    const events: Event[] = [];
    project.tracks.forEach((track, trackIndex) => {
      // 뮤트·솔로 판단은 MixerState 한 곳에서만 한다.
      if (!this.mixerState.isAudible(track)) return;
      for (const n of track.notes) {
        if (n.start >= this.regionEnd) continue;
        if (n.start + n.length <= this.regionStart) continue;
        if (n.start < this.regionStart) continue; // 구간 밖에서 시작한 음은 건너뛴다
        events.push({
          trackIndex,
          pitch: n.pitch,
          velocity: n.velocity,
          start: n.start,
          length: n.length,
        });
      }
    });
    events.sort((a, b) => a.start - b.start);
    this.events = events;
  }

  private firstEventAtOrAfter(beat: number): number {
    let i = 0;
    while (i < this.events.length && this.events[i].start < beat - 1e-6) i += 1;
    return i;
  }

  private tick(): void {
    if (!this.playing) return;
    const now = this.engine.currentTime;
    const ahead = now + LOOKAHEAD_SEC;
    const spb = this.secPerBeat;

    // guard: 루프 구간이 아주 짧고 노트가 없으면 무한루프가 될 수 있다.
    for (let guard = 0; guard < 2000; guard += 1) {
      if (this.evIdx >= this.events.length) {
        if (!this.loopEnabled) {
          const endTime = this.passBase + this.regionBeats * spb;
          if (endTime <= now) this.stop();
          return;
        }
        this.passBase += this.regionBeats * spb;
        this.evIdx = 0;
        if (this.passBase > ahead) return;
        continue;
      }

      const ev = this.events[this.evIdx];
      const when = this.passBase + (ev.start - this.regionStart) * spb;
      if (when >= ahead) return;

      this.scheduleEvent(ev, Math.max(when, now));
      this.evIdx += 1;
    }
  }

  private scheduleEvent(ev: Event, when: number): void {
    const project = this.getProject();
    const track = project.tracks[ev.trackIndex];
    if (!track) return;

    // 루프 끝을 넘어가는 꼬리는 잘라 준다. 안 그러면 루프가 겹쳐 들린다.
    let lengthBeats = ev.length;
    if (this.loopEnabled) {
      lengthBeats = Math.min(lengthBeats, this.regionEnd - ev.start);
    }
    const durationSec = Math.max(0.02, lengthBeats * this.secPerBeat);

    // 트랙 번호와 MIDI 채널은 같지 않다 (드럼은 9번, 나머지는 9번을 건너뛴다).
    // 음량·팬은 play() 에서 한 번 걸어 뒀다 — 노트마다 다시 걸 필요가 없다.
    const channel = assignChannels(project)[ev.trackIndex] ?? channelForTrack(ev.trackIndex);
    this.registry.forTrack(track).play(ev.pitch, ev.velocity, when, durationSec, channel);
  }

  /** 노트를 찍거나 끌 때 한 번 들려주는 미리듣기. */
  preview(pitch: number, trackIndex = 0, velocity = 100): void {
    const project = this.getProject();
    const track = project.tracks[trackIndex];
    if (!track) return;
    const channel = assignChannels(project)[trackIndex] ?? channelForTrack(trackIndex);
    // 미리듣기는 뮤트여도 들려준다 — 사용자가 방금 그 건반을 누른 것이다.
    this.mixer.set(channel, {
      volume: track.volume,
      pan: track.pan,
      muted: false,
      send: track.reverbSend ?? 0,
    });
    this.registry.prepare(track, channel);
    const when = this.engine.currentTime + 0.005;
    this.registry.forTrack(track).play(pitch, velocity, when, 0.25, channel);
  }
}
