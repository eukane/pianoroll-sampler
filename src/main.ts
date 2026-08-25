/**
 * 화면 조립 + 이벤트 배선.
 *
 * M1 의 목표는 "폰에서 4마디 멜로디를 찍고 재생해서 들린다" 하나다.
 * 악기(샘플러)는 M2, 내보내기는 M3 이라 여기에는 없다.
 */

import "./style.css";
import { AudioEngine } from "./audio/engine";
import { Mixer } from "./audio/mixer";
import { MixerState } from "./audio/mixerState";
import { InstrumentRegistry } from "./audio/registry";
import { canUseSoundFont, INSECURE_HINT } from "./audio/soundfont";
import type { Waveform } from "./audio/oscInstrument";
import { Scheduler } from "./audio/scheduler";
import { beatsPerBar, emptyProject, totalBeats } from "./model/project";
import { channelForTrack } from "./model/channels";
import type { Project } from "./model/types";
import { PianoRoll } from "./ui/pianoroll";
import { InstrumentPanel } from "./ui/instrumentPanel";
import { ExportPanel } from "./ui/exportPanel";
import { MixerPanel } from "./ui/mixerPanel";
import { History } from "./history";

const project = emptyProject();

const engine = new AudioEngine();
const mixer = new Mixer(engine.ctx, engine.master);
const registry = new InstrumentRegistry(engine.ctx, mixer);
const mixerState = new MixerState();
const scheduler = new Scheduler(engine, registry, mixer, mixerState, () => project);
const history = new History(() => project);

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
  onBeforeChange: () => history.begin(),
  onAfterChange: () => {
    history.commit();
    refreshHistoryButtons();
  },
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
    project.tracks.forEach((t, i) => registry.prepare(t, channelForTrack(i)));
    mixerState.apply(project, mixer);
    scheduler.invalidate();
    waveRow.hidden = registry.usingSoundFont;
    refreshHistoryButtons();
  },
  onStatus: showStatus,
});
roll.activeTrack = panel.activeTrack;

// ------------------------------------------------------------ 실행 취소

const undoBtn = $<HTMLButtonElement>("undo");
const redoBtn = $<HTMLButtonElement>("redo");

function refreshHistoryButtons(): void {
  undoBtn.disabled = !history.canUndo;
  redoBtn.disabled = !history.canRedo;
}

/** 되돌린 결과를 화면 전체에 반영한다. */
function applyProject(loaded: Project, { keepHistory = true } = {}): void {
  scheduler.stop();
  Object.assign(project, loaded);
  if (!keepHistory) history.clear();

  bpmInput.value = String(project.bpm);
  barsInput.value = String(project.bars);
  if (scheduler.loopEnd > totalBeats(project)) scheduler.loopEnd = totalBeats(project);

  panel.activeTrack = Math.min(panel.activeTrack, project.tracks.length - 1);
  roll.activeTrack = panel.activeTrack;
  panel.refresh();
  mixerPanel.render();
  mixerState.apply(project, mixer);
  scheduler.invalidate();
  refreshHistoryButtons();
}

undoBtn.addEventListener("click", () => {
  const previous = history.undo();
  if (previous) {
    applyProject(previous);
    showStatus("되돌렸습니다");
  }
});
redoBtn.addEventListener("click", () => {
  const next = history.redo();
  if (next) {
    applyProject(next);
    showStatus("다시 실행했습니다");
  }
});

// ---------------------------------------------------------------- 믹서

const mixerPanel = new MixerPanel(() => project, mixerState, {
  onBeforeChange: () => history.begin(),
  onAfterChange: () => {
    history.commit();
    refreshHistoryButtons();
  },
  onChange: () => {
    mixerState.apply(project, mixer);
    scheduler.invalidate();
  },
  onStatus: showStatus,
});

// -------------------------------------------------------- 내보내기 / 가져오기

new ExportPanel(() => project, registry, mixerState, {
  onStatus: showStatus,
  onProjectReplaced: (loaded) => {
    // 통째로 갈아끼우지 않고 **같은 객체 안을 바꾼다.** 스케줄러·피아노롤·패널이
    // 전부 이 객체를 붙들고 있어서, 새 객체로 바꾸면 옛것을 계속 보게 된다.
    mixerState.clearSolo();
    scheduler.loopStart = 0;
    scheduler.loopEnd = totalBeats(loaded);
    // 다른 곡을 열었으니 앞 곡의 되돌리기 이력은 의미가 없다.
    applyProject(loaded, { keepHistory: false });
    scheduler.seek(0);
    roll.scrollToPitch(averagePitch(project) || 60);
  },
});

/** 불러온 곡이 화면 밖에 있으면 안 보인다. 노트가 몰린 높이로 옮겨 준다. */
function averagePitch(p: typeof project): number {
  const notes = p.tracks.flatMap((t) => t.notes);
  if (notes.length === 0) return 0;
  return Math.round(notes.reduce((sum, n) => sum + n.pitch, 0) / notes.length);
}

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
  (window as unknown as Record<string, unknown>).__app = { project, scheduler, roll, engine, registry, panel, mixer, mixerState, history };
}


// ------------------------------------------------------------ 키보드 (PC)

/**
 * 폰이 주 환경이라 단축키는 최소한만 둔다. **화면에서 되는 일을 키보드로도
 * 되게 하는 것**이지, 키보드로만 되는 기능을 만들지는 않는다 (그러면 폰에서
 * 못 쓴다).
 */
window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  // 글자를 치는 중이면 손대지 않는다 (BPM 칸, 악기 검색칸 등).
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

  const mod = e.ctrlKey || e.metaKey;

  if (e.code === "Space" && !mod) {
    e.preventDefault();
    setPlaying(!scheduler.isPlaying);
    return;
  }
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    (e.shiftKey ? redoBtn : undoBtn).click();
    return;
  }
  if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redoBtn.click();
    return;
  }
  if (e.key === "Escape") {
    for (const id of ["preset-modal", "export-modal", "mixer-modal", "map-modal"]) {
      document.getElementById(id)?.classList.add("hidden");
    }
  }
});

refreshHistoryButtons();
mixerState.apply(project, mixer);

// 폰에서 와이파이로 붙었을 때 미리 알려 준다. 사운드폰트를 넣어 보고 나서
// 안 된다는 걸 알면 이미 파일을 고르느라 시간을 쓴 뒤다.
if (!canUseSoundFont()) {
  showStatus(INSECURE_HINT, "error");
}
