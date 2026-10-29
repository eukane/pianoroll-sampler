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
import { beatsPerBar, emptyProject, makeNote, snap, sortNotes, totalBeats } from "./model/project";
import { assignChannels } from "./model/channels";
import type { Project } from "./model/types";
import { PianoRoll } from "./ui/pianoroll";
import { InstrumentPanel } from "./ui/instrumentPanel";
import { ExportPanel } from "./ui/exportPanel";
import { MixerPanel } from "./ui/mixerPanel";
import { NotePanel } from "./ui/notePanel";
import { History } from "./history";
import { copyNotes, copyRegion, pasteAt, lastBeat, type Clipboard } from "./model/clipboard";
import { boxFrom, deleteSelected, selectionRange, transpose } from "./model/selection";
import { keyChoices, keyFromValue, keyLabel, keyToValue, pcName } from "./model/scale";
import { chordLine, identifyChord } from "./model/chord";
import { midiToName } from "./util/music";
import { Metronome } from "./audio/metronome";
import { VelocityLane } from "./ui/velocityLane";
import { PlayKeyboard } from "./ui/playKeyboard";
import {
  clearCalibration,
  DEFAULT_SCREEN_CM,
  defaultPxPerCm,
  loadCalibration,
  plausible,
  saveCalibration,
  screenLongSidePx,
} from "./ui/calibration";

const project = emptyProject();

const engine = new AudioEngine();
const mixer = new Mixer(engine.ctx, engine.master);
const registry = new InstrumentRegistry(engine.ctx, mixer);
const mixerState = new MixerState();
const scheduler = new Scheduler(engine, registry, mixer, mixerState, () => project);
const history = new History(() => project);
// 메트로놈은 믹서를 안 거치고 마스터에 바로 간다 — 곡의 일부가 아니다 (audio/metronome.ts).
const metronome = new Metronome(engine.ctx, engine.master);
scheduler.metronome = metronome;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 를 찾을 수 없습니다`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>("roll");
const rewindBtn = $<HTMLButtonElement>("rewind");
const playBtn = $<HTMLButtonElement>("play");
const loopBtn = $<HTMLButtonElement>("loop");
const posLabel = $<HTMLSpanElement>("pos");
const bpmInput = $<HTMLInputElement>("bpm");
const barsInput = $<HTMLInputElement>("bars");
const snapSelect = $<HTMLSelectElement>("snap");
const timeSigSelect = $<HTMLSelectElement>("timesig");
const waveSelect = $<HTMLSelectElement>("wave");
const keySelect = $<HTMLSelectElement>("key");
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
  onPreviewHold: (pitch, trackIndex) => {
    if (engine.isUnlocked) scheduler.previewHold(pitch, trackIndex);
  },
  onPreviewRelease: () => scheduler.previewRelease(),
  onNoteTap: (note) => notePanel.open(note),
  onSelectionChange: (count) => refreshSelection(count),
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

const singingTrack = () => {
  const track = project.tracks[roll.activeTrack];
  return track ? registry.voiceFor(track) : null;
};

const notePanel = new NotePanel(() => project, {
  isSinging: () => singingTrack() !== null,
  canSing: (lyric) => singingTrack()?.canSing(lyric) ?? false,
  onBeforeChange: () => history.begin(),
  onAfterChange: () => {
    history.commit();
    refreshHistoryButtons();
  },
  onEdit: () => scheduler.invalidate(),
  onAudition: (note) => {
    if (!engine.isUnlocked) return;
    // 노래하는 트랙이면 그 글자를 실제로 불러 준다. 임시 신스 소리를 들려주면
    // 가사를 고르는 데 아무 도움이 안 된다.
    const bank = singingTrack();
    if (bank) {
      void scheduler.previewSing(bank, note);
      return;
    }
    // 그 음의 꾸밈대로 들려준다. 음이 짧아도 꾸밈은 끝까지 들려야 고를 수 있다.
    scheduler.preview(note.pitch, roll.activeTrack, note.velocity, note);
  },
  onDelete: (note) => {
    history.begin();
    for (const t of project.tracks) {
      const i = t.notes.findIndex((n) => n.id === note.id);
      if (i >= 0) t.notes.splice(i, 1);
    }
    scheduler.invalidate();
    history.commit();
    refreshHistoryButtons();
  },
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
    // 노랫말은 재생 직전에 푼다 (디코딩은 비동기라 재생 중에는 못 한다).
    // 이미 풀린 글자는 그냥 넘어가므로 두 번째 재생부터는 값이 없다.
    void scheduler.prepareVoices().then(() => {
      if (scheduler.isPlaying) scheduler.invalidate();
    });
    scheduler.play(undefined, { countIn: countInOn });
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

/**
 * 맨 앞으로.
 *
 * 루프가 켜져 있으면 **루프 시작**으로 간다. 재생도 어차피 거기서 시작하니까,
 * 0박으로 보내면 빨간 줄이 있지도 않을 자리를 가리키게 된다.
 *
 * 재생 중에 눌러도 된다 — `seek` 이 알아서 그 자리부터 다시 튼다.
 * 화면도 같이 앞으로 밀어 준다. 12마디쯤 보고 있다가 눌렀는데 빨간 줄이
 * 화면 밖으로 가 버리면 "아무 일도 안 일어났다" 로 보인다.
 */
function rewind(): void {
  const to = scheduler.loopEnabled ? scheduler.loopStart : 0;
  scheduler.seek(to);
  roll.scrollToBeat(to);
}
rewindBtn.addEventListener("click", rewind);

function setLoop(on: boolean): void {
  scheduler.loopEnabled = on;
  loopBtn.classList.toggle("on", on);
  scheduler.restart();
}
loopBtn.addEventListener("click", () => setLoop(!scheduler.loopEnabled));

// ---------------------------------------------------------------- 메트로놈

const metroBtn = $<HTMLButtonElement>("metro");
const countInBtn = $<HTMLButtonElement>("countin");
/**
 * 예비박. 재생 버튼으로 시작할 때만 친다 — 재생 위치를 옮기거나 루프를 켤 때마다
 * 나오면 곡이 툭툭 끊긴다 (audio/scheduler.ts 의 play).
 */
let countInOn = false;

metroBtn.addEventListener("click", () => {
  scheduler.metronomeOn = !scheduler.metronomeOn;
  metroBtn.classList.toggle("on", scheduler.metronomeOn);
  // 재생 중에 켜면 다음 박부터 친다. 다시 틀 필요 없다.
  showStatus(scheduler.metronomeOn ? "박마다 틱 — 마디 첫 박은 높게 칩니다 (내보내기에는 안 들어갑니다)" : "박자 소리를 껐습니다");
});

countInBtn.addEventListener("click", () => {
  countInOn = !countInOn;
  countInBtn.classList.toggle("on", countInOn);
  showStatus(countInOn ? "재생을 누르면 한 마디 예비박을 치고 시작합니다" : "예비박을 껐습니다");
});

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

/**
 * 박자표 바꾸기.
 *
 * **노트는 움직이지 않는다.** 노트의 시각은 박이고 박자표는 그 박을 몇 개씩
 * 묶어 마디로 볼지만 정한다. 그래서 마디 선과 마디 번호가 다시 그어질 뿐,
 * 찍어 둔 것은 그대로다 (다른 DAW 도 그렇게 동작한다).
 *
 * 분모가 4 가 아닌 박자(6/8·12/8·2/2)는 마디 선까지는 정확히 맞는데,
 * **BPM 과 격자는 4분음표 기준**이라 세는 단위가 다르다. 6/8 을 골랐을 때
 * 위치 표시가 1:1~1:3 으로 나오는 게 그 때문이다. 조용히 두면 고장으로
 * 보이니 고를 때 말해 준다.
 */
timeSigSelect.addEventListener("change", () => {
  const [num, den] = timeSigSelect.value.split("/").map(Number);
  history.begin();
  project.timeSig = [num, den];
  history.commit();
  refreshHistoryButtons();

  // 마디 길이가 바뀌면 곡 전체 길이도 바뀐다. 루프가 곡 밖으로 나가면
  // 재생이 빈 데를 돈다.
  if (scheduler.loopEnd > totalBeats(project)) scheduler.loopEnd = totalBeats(project);
  scheduler.invalidate();
  roll.render();

  const bpb = beatsPerBar(project);
  showStatus(
    den === 4
      ? `${num}/${den} 박자 — 한 마디가 ${bpb}박입니다`
      : `${num}/${den} 박자 — 한 마디가 4분음표 ${bpb}개 길이입니다.` +
        " BPM 과 격자는 4분음표 기준이라 위치 표시도 4분음표로 셉니다.",
  );
});

// ---------------------------------------------------------------------- 조

for (const c of keyChoices()) {
  const o = document.createElement("option");
  o.value = c.value;
  o.textContent = c.label;
  keySelect.appendChild(o);
}

/**
 * 조 바꾸기. **노트는 손대지 않는다** — 조는 설명이지 규칙이 아니다. 조 안의
 * 음 줄이 밝아지고, 코드 이름에 그 조의 로마숫자가 붙을 뿐이다.
 * 되돌리기에 넣는다. 박자표처럼 곡의 일부다.
 */
keySelect.addEventListener("change", () => {
  const key = keyFromValue(keySelect.value);
  history.begin();
  if (key) project.key = key;
  else delete project.key;
  history.commit();
  refreshHistoryButtons();
  roll.render();
  keyboard.render();
  showStatus(
    key
      ? `${keyLabel(key)} — 조 안의 음 줄이 밝아집니다. 조 밖의 음도 그대로 찍힙니다.`
      : "조를 정하지 않았습니다",
  );
});

snapSelect.addEventListener("change", () => {
  roll.snapUnit = Number(snapSelect.value);
  // 잘게 쪼갠 격자는 배율이 낮으면 화면에 선이 안 그려진다. 고르기만 하고
  // 화면이 그대로면 "안 먹었나" 싶다. 보일 만큼 확대해 주고, 확대했다는
  // 사실도 말해 준다 — 화면이 말없이 움직이는 것도 놀라운 일이다.
  const label = snapSelect.options[snapSelect.selectedIndex]?.textContent ?? "";
  if (roll.zoomToSnap()) {
    showStatus(`${label} 격자가 보이도록 확대했습니다`);
  } else {
    showStatus(`${label} 격자`);
  }
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
    // 고르기는 작업 트랙 안의 일이다. 트랙을 바꿨는데 남아 있으면 지우기
    // 버튼이 켜져 있는데 화면에는 아무것도 안 골라진 것처럼 보인다.
    roll.clearSelection();
  },
  onSourceChange: () => {
    // 노래 음원으로 바뀌었을 수 있다. 쓸 글자를 미리 풀어 둔다.
    void scheduler.prepareVoices();
    // 노트는 그대로 두고 악기만 바뀐다. 재생 중이면 다음 노트부터 새 소리다.
    const chs = assignChannels(project);
    project.tracks.forEach((t, i) => registry.prepare(t, chs[i]));
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

  // 조는 있을 때만 달린다. Object.assign 은 없는 칸을 **지우지 않으므로**, 조가 없는
  // 상태로 되돌렸는데 조가 남아 화면이 거짓말을 한다. 직접 맞춘다.
  if (loaded.key) project.key = { ...loaded.key };
  else delete project.key;
  keySelect.value = keyToValue(project.key);

  bpmInput.value = String(project.bpm);
  barsInput.value = String(project.bars);
  // 불러온 곡(또는 되돌리기)의 박자표를 칸에 맞춘다. 목록에 없는 박자표면
  // 그대로 두고 건드리지 않는다 — 화면이 거짓말을 하느니 비워 두는 게 낫다.
  const sig = `${project.timeSig[0]}/${project.timeSig[1]}`;
  if ([...timeSigSelect.options].some((o) => o.value === sig)) timeSigSelect.value = sig;
  if (scheduler.loopEnd > totalBeats(project)) scheduler.loopEnd = totalBeats(project);

  panel.activeTrack = Math.min(panel.activeTrack, project.tracks.length - 1);
  roll.activeTrack = panel.activeTrack;
  panel.refresh();
  mixerPanel.render();
  // 되돌리기로 노트가 사라졌으면 열려 있던 창도 닫고, 고른 것도 걷어낸다.
  notePanel.syncWithProject();
  roll.syncSelection();
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

// ------------------------------------------------------- 복사 / 붙여넣기

const copyBtn = $<HTMLButtonElement>("copy");
const pasteBtn = $<HTMLButtonElement>("paste");
const selectBtn = $<HTMLButtonElement>("select-mode");
const deleteBtn = $<HTMLButtonElement>("delete-selected");
const upBtn = $<HTMLButtonElement>("move-up");
const downBtn = $<HTMLButtonElement>("move-down");
let clipboard: Clipboard | null = null;

/**
 * 상자로 고르기.
 *
 * **버튼으로 켜고 끈다.** 길게 누르기 같은 시간 기반 제스처는 쓰지 않았다 —
 * 바로 앞에서 그것 때문에 물렸고(누른 시간으로 창 열기와 삭제를 갈랐다가
 * 어느 쪽이 나올지 예측이 안 됐다), 빈 곳 드래그는 화면 밀기라 양보할 수도
 * 없다. 폰에서는 숨은 제스처보다 눈에 보이는 버튼이 낫다.
 */
function refreshSelection(count = roll.selectedCount): void {
  deleteBtn.disabled = count === 0;
  upBtn.disabled = count === 0;
  downBtn.disabled = count === 0;
  deleteBtn.textContent = count > 0 ? `🗑 ${count}` : "🗑";
  copyBtn.title =
    count > 0 ? `고른 노트 ${count}개 복사` : "루프 구간(없으면 이 마디) 복사";
}

selectBtn.addEventListener("click", () => {
  roll.selectMode = !roll.selectMode;
  selectBtn.classList.toggle("on", roll.selectMode);
  if (!roll.selectMode) roll.clearSelection();
  showStatus(
    roll.selectMode
      ? "끌어서 여러 노트를 고르세요. 톡 치면 하나씩 넣고 뺍니다."
      : "고르기를 껐습니다.",
  );
});

/**
 * 고른 음을 통째로 올리고 내린다.
 *
 * **누르고 있으면 계속 옮긴다.** 한 옥타브를 열두 번 누르게 할 수는 없다.
 * 누른 시간으로 동작이 갈리는 게 아니라 같은 동작이 반복될 뿐이라, 앞서
 * 물렸던 "길게 누르면 다른 일이 일어난다" 와는 다른 얘기다.
 */
function moveSelection(semitones: number): void {
  const track = project.tracks[panel.activeTrack];
  const ids = new Set(roll.selectedNotes().map((n) => n.id));
  if (!track || ids.size === 0) return;
  history.begin();
  const moved = transpose(track, ids, semitones);
  history.commit();
  refreshHistoryButtons();
  if (!moved) {
    // 조용히 안 움직이면 고장으로 보인다. 왜 안 되는지 말해 준다.
    showStatus("더 옮기면 음역(0~127)을 벗어나는 음이 있습니다", "error");
    return;
  }
  scheduler.invalidate();
  roll.render();
  showStatus(`${ids.size}개 음을 ${semitones > 0 ? "올렸습니다" : "내렸습니다"}`);
}

for (const [btn, step] of [[upBtn, 1], [downBtn, -1]] as [HTMLButtonElement, number][]) {
  let timer: number | null = null;
  const stop = (): void => {
    if (timer === null) return;
    // 처음 것은 타임아웃, 그 뒤는 인터벌이다. 둘 다 걷어낸다.
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  };
  btn.addEventListener("pointerdown", () => {
    moveSelection(step);
    stop();
    // 처음 한 번은 바로, 그 다음부터 반복. 한 번만 누르려는 손을 방해하지 않는다.
    timer = window.setTimeout(() => {
      timer = window.setInterval(() => moveSelection(step), 110);
    }, 400) as unknown as number;
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    btn.addEventListener(type, stop);
  }
}

deleteBtn.addEventListener("click", () => {
  const track = project.tracks[panel.activeTrack];
  const ids = new Set(roll.selectedNotes().map((n) => n.id));
  if (!track || ids.size === 0) return;
  history.begin();
  const removed = deleteSelected(track, ids);
  history.commit();
  refreshHistoryButtons();
  roll.clearSelection();
  scheduler.invalidate();
  roll.render();
  showStatus(`${removed}개 음을 지웠습니다 (↶ 로 되돌릴 수 있습니다)`);
});

/**
 * 무엇을 복사할지.
 *
 * 루프 구간이 잡혀 있으면 그것, 아니면 **재생 헤드가 있는 마디**. 마디마다
 * 같은 코드를 찍는 게 원래 불편했던 일이라, 아무것도 안 잡아도 한 마디가
 * 잡히는 게 맞다.
 */
function copyRange(): { start: number; end: number } {
  const bpb = beatsPerBar(project);
  if (scheduler.loopEnabled && scheduler.loopEnd - scheduler.loopStart > 0.01) {
    return { start: scheduler.loopStart, end: scheduler.loopEnd };
  }
  const bar = Math.floor(scheduler.positionBeats() / bpb);
  return { start: bar * bpb, end: (bar + 1) * bpb };
}

copyBtn.addEventListener("click", () => {
  const track = project.tracks[panel.activeTrack];
  if (!track) return;
  // 고른 게 있으면 그게 우선이다. 일부러 골라 놓고 복사를 눌렀는데 엉뚱한
  // 마디가 복사되면 그것만큼 황당한 게 없다.
  const picked = roll.selectedNotes();
  let copied: Clipboard;
  let end: number;
  if (picked.length > 0) {
    const box = boxFrom(
      { beat: Math.min(...picked.map((n) => n.start)), pitch: 0 },
      { beat: Math.max(...picked.map((n) => n.start + n.length)), pitch: 0 },
    );
    const range = selectionRange(box, picked);
    copied = copyNotes(picked, range.start, range.end);
    end = range.end;
  } else {
    const r = copyRange();
    copied = copyRegion(track, r.start, r.end);
    end = r.end;
  }
  if (copied.notes.length === 0) {
    showStatus("복사할 노트가 없습니다. 루프 구간을 잡거나 노트가 있는 마디로 옮겨 주세요.", "error");
    return;
  }
  clipboard = copied;
  pasteBtn.disabled = false;

  // 복사한 구간 **끝으로** 헤드를 옮긴다.
  //
  // 안 그러면 헤드가 복사한 자리에 그대로 있어서, 붙여넣기를 누르는 순간
  // 원본 위에 똑같은 노트가 겹쳐 쌓인다. 같은 코드를 이어 붙이려는 게 목적이니
  // 다음 자리에서 시작하는 게 맞다.
  scheduler.seek(end);
  roll.followPlayhead(scheduler.positionBeats());
  const bars = (copied.lengthBeats / beatsPerBar(project)).toFixed(
    copied.lengthBeats % beatsPerBar(project) === 0 ? 0 : 1,
  );
  showStatus(`${copied.notes.length}개 음을 복사했습니다 (${bars}마디). 붙여넣기를 연달아 누르면 계속 채워집니다.`);
});

pasteBtn.addEventListener("click", () => {
  const track = project.tracks[panel.activeTrack];
  if (!clipboard || !track) return;

  history.begin();
  const at = scheduler.positionBeats();
  const added = pasteAt(track, clipboard, at);

  // 곡 끝을 넘겨 붙였으면 마디를 늘린다. 조용히 잘라내면 붙인 게 사라진다.
  const bpb = beatsPerBar(project);
  const needed = Math.ceil(lastBeat(added) / bpb);
  if (needed > project.bars) {
    project.bars = Math.min(64, needed);
    barsInput.value = String(project.bars);
  }

  // **헤드를 붙인 만큼 민다.** 이게 없으면 마디마다 헤드를 옮겨야 해서
  // 손이 두 배로 간다. 이걸로 붙여넣기 연타만으로 마디가 채워진다.
  scheduler.seek(at + clipboard.lengthBeats);

  history.commit();
  refreshHistoryButtons();
  mixerState.apply(project, mixer);
  scheduler.invalidate();
  roll.followPlayhead(scheduler.positionBeats());
  showStatus(`${added.length}개 음을 붙여넣었습니다 → 다음 자리로 이동`);
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


// ------------------------------------------------------------- 세기 줄

const velCanvas = $<HTMLCanvasElement>("vel");
const velBtn = $<HTMLButtonElement>("vel-toggle");
const lane = new VelocityLane(velCanvas, () => project, roll, {
  onBeforeChange: () => history.begin(),
  onAfterChange: () => {
    history.commit();
    refreshHistoryButtons();
  },
  onEdit: () => scheduler.invalidate(),
  onStatus: showStatus,
});

velBtn.addEventListener("click", () => {
  const on = velCanvas.classList.toggle("hidden") === false;
  velBtn.classList.toggle("on", on);
  relayout();
  if (on) showStatus("막대를 누르거나 옆으로 끌어서 세기를 바꿉니다. 고른 음이 있으면 고른 음만 바뀝니다.");
});

// ---------------------------------------------------------- 연주 건반

const kbPanel = $<HTMLElement>("kb-panel");
const kbCanvas = $<HTMLCanvasElement>("kb");
const kbBtn = $<HTMLButtonElement>("kb-toggle");
const kbRange = $<HTMLSpanElement>("kb-range");
const kbStepBtn = $<HTMLButtonElement>("kb-step");
const kbLen = $<HTMLSelectElement>("kb-len");
const calibration = loadCalibration();

/** 지금 연주 건반에 눌려 있는 음. 코드 이름은 이게 있으면 이것부터 읽는다. */
let heldKeys: number[] = [];
/** 손을 떼면 찍는가. 끄면 건반은 소리만 낸다 (코드 연습). */
let stepOn = true;

const keyboard = new PlayKeyboard(kbCanvas, calibration.pxPerCm, {
  onHold: (pitch) => {
    if (engine.isUnlocked) scheduler.keyHold(pitch, panel.activeTrack);
  },
  onRelease: (pitch, immediate) => scheduler.keyRelease(pitch, immediate),
  onHeldChange: (pitches) => {
    heldKeys = pitches;
  },
  onChord: (pitches) => stepInsert(pitches),
  getKey: () => project.key ?? null,
});

/** 건반 패널 높이. 실제 cm 로 정하되 화면을 너무 먹지 않게 묶는다. */
function sizeKeyboard(): void {
  const want = 4.2 * keyboard.pxPerCm;
  const h = Math.round(Math.min(Math.max(want, 110), window.innerHeight * 0.36));
  kbCanvas.style.height = `${h}px`;
}

function refreshKbRange(): void {
  if (kbPanel.classList.contains("hidden")) return;
  const { low, high } = keyboard.range;
  kbRange.textContent = `${midiToName(low)} – ${midiToName(high)}`;
}

let kbHintShown = false;
kbBtn.addEventListener("click", () => {
  const on = kbPanel.classList.toggle("hidden") === false;
  kbBtn.classList.toggle("on", on);
  if (!on) {
    keyboard.releaseAll();
    scheduler.keyReleaseAll();
  }
  sizeKeyboard();
  relayout();
  if (!on) return;
  // 몇 개 들어가는지는 그려 봐야 안다. 그 다음 프레임에 말해 준다.
  requestAnimationFrame(() => {
    const n = keyboard.whiteCount;
    if (n < 7) {
      showStatus(`흰 건반이 ${n}개만 들어갑니다 — 가로로 돌리면 더 들어갑니다`, "error");
    } else if (!calibration.custom && !kbHintShown) {
      showStatus("건반 크기는 뮤패드 K10 PLUS 화면으로 계산했습니다. 자로 재 보고 다르면 📏 크기에서 맞추세요.");
    } else {
      showStatus("누르면 소리가 나고, 손을 떼면 재생 위치에 찍힙니다 (✎ 찍기를 끄면 소리만)");
    }
    kbHintShown = true;
  });
});

$("kb-down").addEventListener("click", () => {
  if (keyboard.shiftOctave(-1)) refreshKbRange();
});
$("kb-up").addEventListener("click", () => {
  if (keyboard.shiftOctave(1)) refreshKbRange();
});

kbStepBtn.addEventListener("click", () => {
  stepOn = !stepOn;
  kbStepBtn.classList.toggle("on", stepOn);
  showStatus(stepOn ? "손을 떼면 재생 위치에 찍고 다음 칸으로 갑니다" : "찍지 않고 소리만 냅니다 (코드 연습)");
});

/** 한 칸이 몇 박인가. */
function stepBeats(): number {
  const v = kbLen.value;
  if (v === "snap") return roll.snapUnit;
  if (v === "bar") return beatsPerBar(project);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : roll.snapUnit;
}

/** 찍을 자리. 재생 위치를 격자에 붙인다 — 손으로 끌어 둔 헤드가 칸 사이에 있을 수 있다. */
function stepAt(): number {
  const pos = scheduler.positionBeats();
  return Math.max(0, snap(pos + 1e-9, roll.snapUnit));
}

/** 곡 끝을 넘기면 마디를 늘린다 (붙여넣기와 같다). 64마디가 끝이다. */
function growTo(endBeat: number): boolean {
  const bpb = beatsPerBar(project);
  const needed = Math.ceil(endBeat / bpb - 1e-9);
  if (needed > 64) return false;
  if (needed > project.bars) {
    project.bars = needed;
    barsInput.value = String(project.bars);
  }
  return true;
}

/**
 * 한 칸씩 찍기 (스텝 입력).
 *
 * 손을 다 떼는 순간, 눌렀던 음을 **재생 위치에 한꺼번에** 찍고 헤드를 한 칸 민다.
 * 붙여넣기에서 이미 손에 익은 흐름이다 — 다음 코드를 바로 누르면 된다.
 *
 * 재생하면서 치는 실시간 녹음은 일부러 안 했다. 이 앱에서 제일 고생한 게 박자
 * 맞추기였고(사운드폰트 70.9ms, 기기마다 52~71ms), 실시간 녹음은 그 어긋남이
 * 그대로 노트 자리로 들어간다. 한 칸씩 찍으면 어긋날 일이 없다.
 *
 * **같은 음이 이미 걸쳐 있는 자리는 덮지 않는다.** 같은 트랙에서 같은 음이
 * 겹치면 앞 음의 noteOff 가 뒤 음을 끊는다 (DECISIONS.md). 건너뛰고 몇 개를
 * 건너뛰었는지 말해 준다 — 조용히 빼먹지 않는다.
 */
function stepInsert(pitches: number[]): void {
  if (!stepOn) return;
  if (scheduler.isPlaying) {
    showStatus("재생 중에는 찍지 않습니다 — 소리만 냅니다. 멈추면 찍힙니다.");
    return;
  }
  const track = project.tracks[panel.activeTrack];
  if (!track) return;
  const at = stepAt();
  const len = stepBeats();

  history.begin();
  if (!growTo(at + len)) {
    history.commit();
    showStatus("곡이 64마디를 넘어서 더 찍을 수 없습니다", "error");
    return;
  }
  let skipped = 0;
  for (const pitch of pitches) {
    const clash = track.notes.some((n) => n.pitch === pitch && n.start < at + len - 1e-9 && n.start + n.length > at + 1e-9);
    if (clash) {
      skipped += 1;
      continue;
    }
    track.notes.push(makeNote(pitch, at, len));
  }
  sortNotes(track);
  scheduler.seek(at + len);
  history.commit();
  refreshHistoryButtons();
  scheduler.invalidate();
  roll.followPlayhead(scheduler.positionBeats());

  const placed = pitches.length - skipped;
  const what = chordLine(pitches, project.key) ?? pitches.map((p) => midiToName(p)).join(" ");
  const where = formatPosition(at);
  if (placed === 0) {
    showStatus(`${where} 에 같은 음이 이미 있어 아무것도 안 찍었습니다 (헤드만 넘겼습니다)`, "error");
  } else if (skipped > 0) {
    showStatus(`${where} ${what} — 같은 음이 이미 있던 ${skipped}개는 건너뛰었습니다`);
  } else {
    showStatus(`${where} ${what} → 다음 칸`);
  }
}

$("kb-rest").addEventListener("click", () => {
  const at = stepAt();
  const len = stepBeats();
  if (!growTo(at + len)) {
    showStatus("곡이 64마디를 넘어서 더 넘길 수 없습니다", "error");
    return;
  }
  scheduler.seek(at + len);
  roll.followPlayhead(scheduler.positionBeats());
  showStatus(`쉼표 → ${formatPosition(at + len)}`);
});

// ------------------------------------------------------- 건반 크기 맞추기

const calModal = $<HTMLDivElement>("cal-modal");
const calBar = $<HTMLDivElement>("cal-bar");
const calReadout = $<HTMLElement>("cal-readout");
const calCm = $<HTMLInputElement>("cal-cm");

function refreshCal(): void {
  const px = keyboard.pxPerCm;
  calBar.style.width = `${(5 * px).toFixed(1)}px`;
  calCm.value = (screenLongSidePx() / px).toFixed(2);
  calReadout.textContent = `1cm = ${px.toFixed(1)}px`;
}

function applyCal(px: number, { remember = true } = {}): void {
  if (!plausible(px)) {
    showStatus("말이 안 되는 크기입니다", "error");
    return;
  }
  keyboard.pxPerCm = px;
  calibration.pxPerCm = px;
  calibration.custom = remember;
  if (remember && !saveCalibration(px)) {
    showStatus("이 브라우저는 값을 기억하지 못해 다음에 열면 처음 값으로 돌아갑니다", "error");
  }
  sizeKeyboard();
  relayout();
  refreshCal();
}

$("kb-cal").addEventListener("click", () => {
  refreshCal();
  calModal.classList.remove("hidden");
});
$("cal-close").addEventListener("click", () => calModal.classList.add("hidden"));
calModal.addEventListener("click", (e) => {
  if (e.target === calModal) calModal.classList.add("hidden");
});
$("cal-less").addEventListener("click", () => applyCal(keyboard.pxPerCm * 0.99));
$("cal-more").addEventListener("click", () => applyCal(keyboard.pxPerCm * 1.01));
calCm.addEventListener("change", () => {
  const cm = Number(calCm.value);
  if (!Number.isFinite(cm) || cm < 5 || cm > 80) {
    showStatus("화면 길이는 5~80cm 사이로 넣어 주세요", "error");
    refreshCal();
    return;
  }
  applyCal(screenLongSidePx() / cm);
});
$("cal-reset").addEventListener("click", () => {
  clearCalibration();
  applyCal(defaultPxPerCm(DEFAULT_SCREEN_CM), { remember: false });
  showStatus(`처음 값(뮤패드 K10 PLUS, 화면 긴 변 ${DEFAULT_SCREEN_CM}cm)으로 돌렸습니다`);
});

// ----------------------------------------------------------- 코드 이름

const chordLabel = $<HTMLSpanElement>("chord");
let lastChord = "";

/**
 * 위 줄에 띄울 코드. 무엇을 읽을지는 이 순서로 고른다.
 *
 *   🎹 연주 건반에 눌려 있는 음      (치는 대로 바로 보여야 연습이 된다)
 *   ⬚  고른 음                       (찍어 둔 화음이 무엇인지 확인)
 *   ▶  재생 위치에서 울리는 음       (작업 트랙만 — 반주와 멜로디가 섞이면 코드가 아니다)
 *
 * 이름을 못 붙이면 지어내지 않고 음이름만 보여 준다.
 */
function currentChordText(): { text: string; live: boolean } {
  const key = project.key ?? null;
  let pitches: number[] = [];
  let mark = "";
  if (heldKeys.length > 0) {
    pitches = heldKeys;
    mark = "🎹";
  } else if (roll.selectedCount > 0) {
    pitches = roll.selectedNotes().map((n) => n.pitch);
    mark = "⬚";
  } else {
    const pos = scheduler.positionBeats();
    const track = project.tracks[panel.activeTrack];
    pitches = (track?.notes ?? []).filter((n) => n.start <= pos + 1e-6 && n.start + n.length > pos + 1e-6).map((n) => n.pitch);
    mark = "▶";
  }
  if (pitches.length === 0) return { text: "—", live: false };
  const live = heldKeys.length > 0;
  const line = chordLine(pitches, key);
  if (line) return { text: `${mark} ${line}`, live };
  const names = [...new Set(pitches)].sort((a, b) => a - b).map((p) => pcName(p, key));
  const unique = [...new Set(names)];
  return { text: `${mark} ${unique.join(" ")}${unique.length > 1 && !identifyChord(pitches, key) ? " (이름 없음)" : ""}`, live };
}

// ------------------------------------------------------------ 화면 배치

/** 패널을 켜고 끄면 피아노롤 높이가 바뀐다. 배치가 끝난 다음 프레임에 다시 잰다. */
function relayout(): void {
  requestAnimationFrame(() => {
    roll.resize();
    if (!velCanvas.classList.contains("hidden")) lane.resize();
    if (!kbPanel.classList.contains("hidden")) {
      keyboard.resize();
      refreshKbRange();
    }
  });
}

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
  if (!velCanvas.classList.contains("hidden")) lane.render();

  const chord = currentChordText();
  if (chord.text !== lastChord) {
    chordLabel.textContent = chord.text;
    chordLabel.classList.toggle("live", chord.live);
    lastChord = chord.text;
  }

  const text = scheduler.countingIn ? "예비박" : formatPosition(pos);
  if (text !== lastPos) {
    posLabel.textContent = text;
    lastPos = text;
  }
  requestAnimationFrame(frame);
}

const resize = (): void => {
  sizeKeyboard();
  relayout();
};
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 150));
// 폰에서 주소창이 접히면 높이가 바뀐다. 레이아웃이 잡힌 다음 한 번 더 맞춘다.
setTimeout(resize, 60);

requestAnimationFrame(frame);

// 개발 중 콘솔에서 상태를 들여다보기 위한 창구. 빌드하면 사라진다.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__app = {
    project, scheduler, roll, engine, registry, panel, mixer, mixerState, history,
    keyboard, lane, metronome, calibration,
  };
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
  if (e.key === "Home" && !mod) {
    e.preventDefault();
    rewind();
    return;
  }
  if (e.key === "Escape") {
    for (const id of ["preset-modal", "export-modal", "mixer-modal", "map-modal", "note-modal", "cal-modal"]) {
      document.getElementById(id)?.classList.add("hidden");
    }
    roll.clearSelection();
  }
  // 고른 것을 Delete 로도 지운다. 폰에는 없는 키지만 PC 에서는 이게 자연스럽다.
  if ((e.key === "Delete" || e.key === "Backspace") && roll.selectedCount > 0) {
    e.preventDefault();
    deleteBtn.click();
  }
});

refreshHistoryButtons();
refreshSelection(0);
mixerState.apply(project, mixer);

// 폰에서 와이파이로 붙었을 때 미리 알려 준다. 사운드폰트를 넣어 보고 나서
// 안 된다는 걸 알면 이미 파일을 고르느라 시간을 쓴 뒤다.
if (!canUseSoundFont()) {
  showStatus(INSECURE_HINT, "error");
}
