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

import type { Note, Project } from "../model/types";
import type { Instrument } from "./instrument";
import type { AudioEngine } from "./engine";
import type { InstrumentRegistry } from "./registry";
import type { Mixer } from "./mixer";
import type { MixerState } from "./mixerState";
import { totalBeats } from "../model/project";
import { assignChannels, channelForTrack } from "../model/channels";
import { expressionFor, singingExpressions } from "./expression";
import type { SungNote } from "../model/phrase";
import type { VoiceBank } from "./voicebank";

const TICK_MS = 25;
const LOOKAHEAD_SEC = 0.12;

/**
 * 미리듣기가 최소한 이만큼은 울린다(ms).
 *
 * 손가락을 톡 대었다 떼면 5ms 만에 떼는 신호가 온다. 그대로 끊으면 '틱' 하고
 * 말지 소리를 확인할 수가 없다. 짧게 누르면 예전처럼 한 번 울리고, 길게 누르면
 * 누른 만큼 울린다.
 */
const MIN_PREVIEW_MS = 250;

/**
 * 노래 들어보기 길이(초).
 *
 * 노트 길이를 그대로 쓰면 16분음표에서 자음만 스치고 끝나서 「か」인지
 * 「が」인지 구분이 안 된다. 짧은 음이어도 이만큼은 불러 준다.
 */
const PREVIEW_SING_SEC = 0.6;

/** 미리듣기의 최대 길이(초). 꾸밈 곡선을 그릴 때 음 길이 대신 쓴다. */
const MAX_PREVIEW = 2;

type Event = {
  trackIndex: number;
  /** 원본 노트. 꾸밈을 읽으려면 필요하다. */
  note: Note;
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
  /**
   * 트랙 → MIDI 채널 배치. buildEvents 에서 한 번 만들어 둔다.
   *
   * `scheduleEvent` 는 **노트마다** 도는 자리라 거기서 매번 다시 계산하면
   * 재생 내내 배열을 새로 만들어 버린다. 폰에서 굳이 만들 쓰레기가 아니다.
   */
  private channels: number[] = [];

  private startTime = 0; // regionStart 에 해당하는 ctx 시각
  private passBase = 0; // 지금 예약 중인 루프 회차의 시작 ctx 시각
  private regionStart = 0;
  private regionEnd = 0;

  private stoppedAt = 0; // 정지 상태에서 헤드를 그릴 위치(박)

  /** 지금 손가락에 눌려 있는 미리듣기. 뗄 때 이걸 끝낸다. */
  private heldPreview:
    | { instrument: Instrument; pitch: number; channel: number; startedAt: number; token: number }
    | null = null;
  private previewToken = 0;
  private previewOffTimer: number | null = null;

  loopEnabled = false;
  loopStart = 0;
  loopEnd = 4;

  onStop: (() => void) | null = null;
  /**
   * 지금 멈추는 게 **곧바로 다시 트는 중**인가.
   *
   * 재생 위치를 옮기거나 루프를 켜면 안에서 stop → play 를 한다. 그때도
   * onStop 을 부르면 화면의 버튼이 "▶︎ 재생" 으로 바뀐다 — 실제로는 재생 중인데
   * 버튼이 거짓말을 한다. 재시작 중에는 알리지 않는다.
   */
  private restarting = false;

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
    project.tracks.forEach((t, i) => this.registry.prepare(t, this.channels[i]));
    this.mixerState.apply(project, this.mixer);
    this.startTime = this.engine.currentTime - (from - this.regionStart) * this.secPerBeat;
    this.passBase = this.startTime;
    this.evIdx = this.firstEventAtOrAfter(from);

    this.playing = true;
    this.singVoices(this.startTime, from);
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
    this.endPreview();
    this.registry.stopAll();
    if (!this.restarting) this.onStop?.();
  }

  /** 헤드 위치를 옮긴다. 재생 중이면 그 자리부터 다시 튼다. */
  seek(beat: number): void {
    this.stoppedAt = Math.max(0, beat);
    if (this.playing) this.replay(this.stoppedAt);
  }

  /** 재생 중이면 지금 위치에서 다시 시작한다 (루프를 켜고 끌 때 등). */
  restart(): void {
    if (this.playing) this.replay(this.positionBeats());
  }

  private replay(from: number): void {
    this.restarting = true;
    this.stop();
    this.play(from);
    this.restarting = false;
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
    // 노래는 줄 통째로 예약돼 있다. 걷어내고 지금 위치부터 다시 건다 — 안 그러면
    // 고치기 전 가사와 고친 가사가 겹쳐 들린다.
    for (const bank of this.registry.voices.values()) bank.stopAll();
    this.singVoices(this.engine.currentTime, pos);
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
      // 노래하는 트랙은 노트 하나씩 예약할 수 없다. 아래 singVoices 가 맡는다.
      if (track.source.kind === "voice") return;
      for (const n of track.notes) {
        if (n.start >= this.regionEnd) continue;
        if (n.start + n.length <= this.regionStart) continue;
        if (n.start < this.regionStart) continue; // 구간 밖에서 시작한 음은 건너뛴다
        events.push({
          trackIndex,
          note: n,
          pitch: n.pitch,
          velocity: n.velocity,
          start: n.start,
          length: n.length,
        });
      }
    });
    events.sort((a, b) => a.start - b.start);
    this.events = events;
    this.channels = assignChannels(project);
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
        // 새 회차가 시작된다 — 노래도 그 회차만큼 다시 예약해야 한다.
        this.singVoices(this.passBase, this.regionStart);
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

  /**
   * 곡에 적힌 노랫말을 미리 풀어 둔다.
   *
   * WAV 디코딩은 비동기라 재생 도중에는 못 한다. 그런데 UTAU 음원은 파일이
   * 백 개가 넘어서 통째로 풀 수도 없다 — **실제로 쓰는 글자만** 재생·렌더
   * 직전에 푼다. 안 부르면 그냥 소리가 안 나서, 이걸 빼먹으면 조용히 실패한다.
   */
  async prepareVoices(): Promise<void> {
    await this.registry.prepareVoices(this.getProject().tracks);
  }

  /**
   * 노래하는 트랙을 **줄 통째로** 예약한다.
   *
   * 다른 악기는 25ms 마다 깨어나서 앞으로 120ms 안의 노트를 하나씩 넣는다.
   * 노래는 그럴 수가 없다 — 한 음의 소리가 앞뒤 음에 달려 있고(선행발성·겹침),
   * 심지어 **소리가 박보다 먼저 시작**해서 120ms 앞만 봐서는 늦는다.
   *
   * 그래서 재생을 시작할 때(그리고 루프가 한 바퀴 돌 때마다) 그 회차의 줄을
   * 한 번에 예약한다. 노트를 고치면 `invalidate()` 가 걷어내고 다시 건다.
   *
   * @param base    이 회차의 0박이 실제로 몇 초인가 (ctx 시각)
   * @param fromBeat 이 회차에서 어느 박부터 부르는가
   */
  private singVoices(base: number, fromBeat: number): void {
    const project = this.getProject();
    const spb = this.secPerBeat;

    for (const track of project.tracks) {
      if (track.source.kind !== "voice") continue;
      if (!this.mixerState.isAudible(track)) continue;
      const bank = this.registry.voiceFor(track);
      if (!bank) continue;

      const notes: SungNote[] = track.notes
        .filter((n) => n.start >= fromBeat - 1e-6 && n.start < this.regionEnd)
        .map((n) => ({
          id: n.id,
          pitch: n.pitch,
          startSec: (n.start - this.regionStart) * spb,
          lengthSec: Math.max(0.02, n.length * spb),
          lyric: n.lyric ?? "",
        }));
      if (notes.length === 0) continue;

      const channel = this.channels[project.tracks.indexOf(track)] ?? 0;
      this.mixer.set(channel, {
        volume: track.volume,
        pan: track.pan,
        muted: false,
        send: track.reverbSend ?? 0,
      });
      const result = bank.sing(
        this.engine.ctx,
        this.mixer.input(channel),
        notes,
        base,
        singingExpressions(track, track.notes, (n) => Math.max(0.02, n.length * spb)),
      );
      if (result.missing.length > 0) this.onMissingLyrics?.(result.missing.map((m) => m.lyric));
    }
  }

  /** 음원에 없는 글자를 만났다 — 화면이 알려 줘야 한다. 조용히 빼먹지 않는다. */
  onMissingLyrics: ((lyrics: string[]) => void) | null = null;

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
    const channel = this.channels[ev.trackIndex] ?? channelForTrack(ev.trackIndex);
    this.registry
      .forTrack(track)
      .play(ev.pitch, ev.velocity, when, durationSec, channel, expressionFor(track, ev.note, durationSec));
  }

  /**
   * 건반을 누르는 순간 소리를 내고, **뗄 때까지 붙잡는다.**
   *
   * 예전에는 무조건 0.25초짜리 한 방이었다. 가야금이나 색소폰처럼 길게 끄는
   * 음원은 0.25초로는 무슨 소리인지 알 수가 없다 — 음원을 고르려고 누르는
   * 건데 정작 그 판단을 못 하는 셈이었다.
   *
   * 같은 미리듣기를 겹쳐 쌓지 않는다. 새 건반을 누르면 앞엣것을 끝낸다.
   */
  previewHold(pitch: number, trackIndex = 0, velocity = 100, note?: Note): void {
    const project = this.getProject();
    const track = project.tracks[trackIndex];
    if (!track) return;

    this.endPreview();

    // 재생 중이 아니면 채널 배치가 아직 없다. 탭할 때마다 부르는 자리라 매번 계산해도 된다.
    const channel = assignChannels(project)[trackIndex] ?? channelForTrack(trackIndex);
    // 미리듣기는 뮤트여도 들려준다 — 사용자가 방금 그 건반을 누른 것이다.
    this.mixer.set(channel, {
      volume: track.volume,
      pan: track.pan,
      muted: false,
      send: track.reverbSend ?? 0,
    });
    this.registry.prepare(track, channel);

    // 악기 객체를 들고 있는다. 누르고 있는 사이에 트랙 음원이 바뀌어도
    // **소리를 낸 그 악기**에게 끝내라고 해야 한다.
    const instrument = this.registry.forTrack(track);
    this.previewToken += 1;
    this.heldPreview = {
      instrument,
      pitch,
      channel,
      startedAt: this.engine.currentTime,
      token: this.previewToken,
    };
    // 음을 하나 넘기면 그 음의 꾸밈대로 들려준다 — 꾸밈을 고르고 바로 확인하는 자리.
    instrument.hold(pitch, velocity, channel, note ? expressionFor(track, note, MAX_PREVIEW) : undefined);
  }

  /**
   * 손가락을 뗐다. 다만 너무 빨리 뗐으면 최소 시간은 채우고 끝낸다
   * (MIN_PREVIEW_MS) — 톡 치고 마는 탭에서도 소리가 들려야 한다.
   */
  previewRelease(): void {
    const held = this.heldPreview;
    if (!held) return;
    const soundedMs = (this.engine.currentTime - held.startedAt) * 1000;
    if (soundedMs >= MIN_PREVIEW_MS) {
      this.endPreview();
      return;
    }
    const token = held.token;
    this.clearPreviewTimer();
    this.previewOffTimer = window.setTimeout(() => {
      this.previewOffTimer = null;
      // 그 사이 다른 건반을 눌렀으면 그건 아직 눌려 있는 것이다. 건드리지 않는다.
      if (this.heldPreview?.token === token) this.endPreview();
    }, MIN_PREVIEW_MS - soundedMs);
  }

  /**
   * 노래하는 트랙에서 그 음 하나만 불러 준다.
   *
   * 가사를 적자마자 들려주는 자리다. 짧은 음이어도 **최소 0.6초는** 불러야
   * 「か」인지 「が」인지 구분이 된다 — 노트 길이를 그대로 쓰면 16분음표에서
   * 자음만 스치고 끝난다.
   */
  async previewSing(bank: VoiceBank, note: Note): Promise<void> {
    const project = this.getProject();
    const trackIndex = project.tracks.findIndex((t) => t.notes.some((n) => n.id === note.id));
    const track = project.tracks[Math.max(0, trackIndex)];
    if (!track) return;

    bank.stopAll();
    const lyric = note.lyric ?? "";
    await bank.prepare(this.engine.ctx, [lyric]);

    const channel = assignChannels(project)[Math.max(0, trackIndex)] ?? 0;
    this.mixer.set(channel, {
      volume: track.volume,
      pan: track.pan,
      muted: false,
      send: track.reverbSend ?? 0,
    });
    bank.sing(
      this.engine.ctx,
      this.mixer.input(channel),
      [{ id: note.id, pitch: note.pitch, startSec: 0, lengthSec: PREVIEW_SING_SEC, lyric }],
      this.engine.currentTime + 0.02,
      // 들어보기도 꾸밈을 걸어 들려준다. 여기서만 안 걸리면 "적용이 안 됐나" 싶다.
      singingExpressions(track, [note], () => PREVIEW_SING_SEC),
    );
  }

  /**
   * 노트를 끌 때처럼 한 번만 들려주면 되는 자리.
   *
   * **꾸밈이 붙은 음은 끝까지 들려준다.** 예전에는 여기서도 250ms 만 울렸는데
   * (MIN_PREVIEW_MS), 꾸밈 곡선은 2초짜리 창에 그려진다. 음 길이의 45% 자리에서
   * 꺾는 음이면 0.9초에 꺾이니 **꺾이기도 전에 소리가 끝났다.** 꾸밈을 고르고
   * 바로 들어 보는 자리인데 정작 그 꾸밈이 안 들렸다.
   */
  preview(pitch: number, trackIndex = 0, velocity = 100, note?: Note): void {
    this.previewHold(pitch, trackIndex, velocity, note);
    if (!note || (note.ornament ?? "none") === "none") {
      this.previewRelease();
      return;
    }
    const token = this.heldPreview?.token;
    this.clearPreviewTimer();
    this.previewOffTimer = window.setTimeout(() => {
      this.previewOffTimer = null;
      if (this.heldPreview?.token === token) this.endPreview();
    }, MAX_PREVIEW * 1000);
  }

  private endPreview(): void {
    this.clearPreviewTimer();
    const held = this.heldPreview;
    if (!held) return;
    this.heldPreview = null;
    held.instrument.release(held.pitch, held.channel);
  }

  private clearPreviewTimer(): void {
    if (this.previewOffTimer !== null) {
      clearTimeout(this.previewOffTimer);
      this.previewOffTimer = null;
    }
  }
}
