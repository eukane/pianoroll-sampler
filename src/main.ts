/**
 * 화면 조립 + 이벤트 배선.
 *
 * M1 의 목표는 "폰에서 4마디 멜로디를 찍고 재생해서 들린다" 하나다.
 * 악기(샘플러)는 M2, 내보내기는 M3 이라 여기에는 없다.
 */

import "./style.css";
import { AudioEngine } from "./audio/engine";
import { Mixer } from "./audio/mixer";
import { InstrumentRegistry } from "./audio/registry";
import type { Waveform } from "./audio/oscInstrument";
import { Scheduler } from "./audio/scheduler";
import { beatsPerBar, emptyProject, totalBeats } from "./model/project";
import { PianoRoll } from "./ui/pianoroll";
import { InstrumentPanel } from "./ui/instrumentPanel";

const project = emptyProject();

const engine = new AudioEngine();
const mixer = new Mixer(engine.ctx, engine.master);
const registry = new InstrumentRegistry(engine.ctx, mixer);
const scheduler = new Scheduler(engine, registry, mixer, () => project);

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 를 찾을 수 없습니다`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>("roll");
const playBtn = $<HTMLButtonElement>("play");
const loopBtn = $<HTMLButtonElement>("loop");
const posLabel = $<HTMLSpanElement>("pos");
const bpmInput = $<HTMLInputElement>("bpm");
const barsInput = $<HTMLInputElement>("bars");
const snapSelect = $<HTMLSelectElement>("snap");
const waveSelect = $<HTMLSelectElement>("wave");
const unlockOverlay = $<HTMLDivElement>("unlock");

scheduler.loopStart = 0;
scheduler.loopEnd = totalBeats(project);

const roll = new PianoRoll(canvas, () => project, {
  onEdit: () => scheduler.invalidate(),
  onPreview: (pitch, trackIndex) => {
    if (engine.isUnlocked) scheduler.preview(pitch, trackIndex);
  },
  onSeek: (beat) => scheduler.seek(beat),
  onLoopChange: (start, end) => {
    scheduler.loopStart = start;
    scheduler.loopEnd = end;
    if (!scheduler.loopEnabled) setLoop(true);
  },
  getPlayheadBeat: () => scheduler.positionBeats(),
  getLoop: () => ({
    enabled: scheduler.loopEnabled,
    start: scheduler.loopStart,
    end: scheduler.loopEnd,
  }),
});

// ---------------------------------------------------------------- 오디오 잠금

/**
 * 첫 터치 전에는 소리가 안 난다. 안내를 띄워 두고, 어디를 만지든 해제한다.
 * 오버레이를 닫은 뒤에도 해제가 안 됐을 수 있어서(브라우저가 거절하는 경우)
 * 해제될 때까지 전역 리스너를 남겨 둔다.
 */
async function tryUnlock(): Promise<void> {
  const ok = await engine.unlock();
  if (ok) {
    unlockOverlay.classList.add("hidden");
    window.removeEventListener("pointerup", tryUnlock);
  }
}
unlockOverlay.addEventListener("pointerup", tryUnlock);
window.addEventListener("pointerup", tryUnlock);

// ---------------------------------------------------------------- 트랜스포트

function setPlaying(on: boolean): void {
  if (on) {
    void engine.unlock();
    scheduler.play();
    playBtn.textContent = "■ 정지";
    playBtn.classList.remove("primary");
  } else {
    scheduler.stop();
    playBtn.textContent = "▶︎ 재생";
    playBtn.classList.add("primary");
  }
}

scheduler.onStop = () => {
  playBtn.textContent = "▶︎ 재생";
  playBtn.classList.add("primary");
};

playBtn.addEventListener("click", () => setPlaying(!scheduler.isPlaying));

function setLoop(on: boolean): void {
  scheduler.loopEnabled = on;
  loopBtn.classList.toggle("on", on);
  if (scheduler.isPlaying) {
    scheduler.stop();
    scheduler.play();
  }
}
loopBtn.addEventListener("click", () => setLoop(!scheduler.loopEnabled));

bpmInput.addEventListener("change", () => {
  const v = Number(bpmInput.value);
  project.bpm = Number.isFinite(v) ? Math.min(300, Math.max(20, v)) : 100;
  bpmInput.value = String(project.bpm);
  scheduler.invalidate();
});

barsInput.addEventListener("change", () => {
  const v = Number(barsInput.value);
  project.bars = Number.isFinite(v) ? Math.min(64, Math.max(1, Math.round(v))) : 4;
  barsInput.value = String(project.bars);
  const end = totalBeats(project);
  if (scheduler.loopEnd > end) scheduler.loopEnd = end;
  scheduler.invalidate();
});

snapSelect.addEventListener("change", () => {
  roll.snapUnit = Number(snapSelect.value);
});

waveSelect.addEventListener("change", () => {
  registry.setWaveform(waveSelect.value as Waveform);
});

// ------------------------------------------------------- 악기 / 트랙 패널

const statusEl = $<HTMLDivElement>("status");
let statusTimer: number | null = null;

function showStatus(message: string, kind: "info" | "error" = "info"): void {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
  statusEl.classList.toggle("error", kind === "error");
  if (statusTimer !== null) clearTimeout(statusTimer);
  // 오류는 읽을 시간을 더 준다.
  statusTimer = window.setTimeout(() => statusEl.classList.add("hidden"), kind === "error" ? 6000 : 3500);
}

// 사운드폰트가 올라오면 임시 신스 파형 선택은 의미가 없어진다.
const waveRow = waveSelect.closest("label") as HTMLLabelElement;

const panel = new InstrumentPanel(project, registry, {
  onTrackChange: (index) => {
    roll.activeTrack = index;
  },
  onSourceChange: () => {
    // 노트는 그대로 두고 악기만 바뀐다. 재생 중이면 다음 노트부터 새 소리다.
    project.tracks.forEach((t, i) => registry.prepare(t, i));
    scheduler.invalidate();
    waveRow.hidden = registry.usingSoundFont;
  },
  onStatus: showStatus,
});
roll.activeTrack = panel.activeTrack;

$("zoom-in").addEventListener("click", () => roll.zoomBy(1.35));
$("zoom-out").addEventListener("click", () => roll.zoomBy(1 / 1.35));
$("keys-in").addEventListener("click", () => roll.zoomKeys(1.25));
$("keys-out").addEventListener("click", () => roll.zoomKeys(1 / 1.25));

// ---------------------------------------------------------------- 그리기 루프

function formatPosition(beat: number): string {
  const bpb = beatsPerBar(project);
  const bar = Math.floor(beat / bpb) + 1;
  const inBar = Math.floor(beat % bpb) + 1;
  return `${bar} : ${inBar}`;
}

let lastPos = "";
function frame(): void {
  const pos = scheduler.positionBeats();
  if (scheduler.isPlaying) roll.followPlayhead(pos);
  roll.render();

  const text = formatPosition(pos);
  if (text !== lastPos) {
    posLabel.textContent = text;
    lastPos = text;
  }
  requestAnimationFrame(frame);
}

const resize = (): void => roll.resize();
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 150));
// 폰에서 주소창이 접히면 높이가 바뀐다. 레이아웃이 잡힌 다음 한 번 더 맞춘다.
setTimeout(resize, 60);

requestAnimationFrame(frame);

// 개발 중 콘솔에서 상태를 들여다보기 위한 창구. 빌드하면 사라진다.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__app = { project, scheduler, roll, engine, registry, panel, mixer };
}
