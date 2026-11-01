/**
 * 귀 훈련 페이지의 진입점 (ear.html).
 *
 * 피아노롤과 같은 주소 아래에 있어서 두 가지를 그대로 같이 쓴다.
 *   · 저장해 둔 사운드폰트 (IndexedDB) — 여기서 다시 고를 필요가 없다
 *   · 소리 내는 길 (AudioEngine → 레지스트리 → 스케줄러의 건반 소리) — 건반을 누를 때와 같은 소리
 *
 * 곡(프로젝트)은 필요 없다. 트랙 하나짜리 빈 곡을 만들어 두고 거기에 악기만 건다.
 */

import "../style.css";
import "./ear.css";
import { AudioEngine } from "../audio/engine";
import { Mixer } from "../audio/mixer";
import { MixerState } from "../audio/mixerState";
import { InstrumentRegistry } from "../audio/registry";
import { Scheduler } from "../audio/scheduler";
import { canUseSoundFont, INSECURE_HINT } from "../audio/soundfont";
import { loadSavedSoundfont } from "../audio/sfStore";
import { emptyProject } from "../model/project";
import { EarTraining, type InstrumentChoice } from "../ui/earTraining";
import { TransposeQuiz } from "../ui/transposeQuiz";
import { applyBackup, makeBackup, parseBackup } from "../model/backup";

const project = emptyProject();
const engine = new AudioEngine();
const mixer = new Mixer(engine.ctx, engine.master);
const registry = new InstrumentRegistry(engine.ctx, mixer);
const mixerState = new MixerState();
const scheduler = new Scheduler(engine, registry, mixer, mixerState, () => project);
mixerState.apply(project, mixer);

const $ = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} 를 찾을 수 없습니다`);
  return e as T;
};

// ------------------------------------------------------------ 알림

const statusEl = $<HTMLDivElement>("status");
let statusTimer: number | null = null;
function showStatus(message: string, kind: "info" | "error" = "info"): void {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
  statusEl.classList.toggle("error", kind === "error");
  if (statusTimer !== null) clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => statusEl.classList.add("hidden"), kind === "error" ? 6000 : 3500);
}

// ------------------------------------------------------------ 오디오 잠금 (피아노롤과 같은 방식)

const unlockOverlay = $<HTMLDivElement>("unlock");
async function tryUnlock(): Promise<void> {
  const ok = await engine.unlock();
  if (ok) {
    unlockOverlay.classList.add("hidden");
    window.removeEventListener("pointerup", tryUnlock);
  }
}
unlockOverlay.addEventListener("pointerup", tryUnlock);
window.addEventListener("pointerup", tryUnlock);

// ------------------------------------------------------------ 악기

/** 귀 훈련에 어울리는 소리만 추린다: GM 번호 → 이름. 사운드폰트에 없으면 목록에서 빠진다. */
const CHOICES: ReadonlyArray<[number, string]> = [
  [0, "어쿠스틱 피아노"],
  [4, "전기 피아노"],
  [19, "오르간"],
  [24, "나일론 기타"],
  [25, "스틸 기타"],
  [48, "스트링스"],
  [73, "플루트"],
];

function instruments(): InstrumentChoice[] {
  const list = registry.soundfont.presetList;
  const out: InstrumentChoice[] = [];
  for (const [program, name] of CHOICES) {
    const p = list.find((x) => !x.isDrum && x.bankMSB === 0 && x.program === program);
    if (p) out.push({ presetId: p.id, program, name });
  }
  // GM 번호가 맞는 게 하나도 없으면(음원이 GM 이 아닐 때) 목록의 첫 악기라도 쓴다.
  if (out.length === 0 && registry.soundfont.defaultPreset) {
    const d = registry.soundfont.defaultPreset;
    out.push({ presetId: d.id, program: d.program, name: d.name });
  }
  return out;
}

function setInstrument(presetId: number): void {
  project.tracks[0].source = { kind: "sf2", presetId };
}

const ear = new EarTraining({
  hold: (pitch) => scheduler.keyHold(pitch, 0),
  release: (pitch) => scheduler.keyRelease(pitch, true),
  isUnlocked: () => engine.isUnlocked,
  onStatus: showStatus,
  instruments,
  setInstrument,
});

const quiz = new TransposeQuiz({
  hold: (pitch) => scheduler.keyHold(pitch, 0),
  release: (pitch) => scheduler.keyRelease(pitch, true),
  isUnlocked: () => engine.isUnlocked,
  getLesson: () => ear.store.lesson,
});

// 탭: 듣기 훈련 ↔ 키 옮기기
function setTab(transpose: boolean): void {
  ear.silence();
  quiz.silence();
  document.body.classList.toggle("tq-mode", transpose);
  $("ear-tab-listen").setAttribute("aria-pressed", String(!transpose));
  $("ear-tab-transpose").setAttribute("aria-pressed", String(transpose));
  $("tq-pane").classList.toggle("hidden", !transpose);
  $("ear-stats").classList.toggle("hidden", transpose);
}
$("ear-tab-listen").addEventListener("click", () => setTab(false));
$("ear-tab-transpose").addEventListener("click", () => setTab(true));

// 기록 백업: 내보내기 / 불러오기
$("ear-export").addEventListener("click", () => {
  const now = new Date();
  const blob = new Blob([JSON.stringify(makeBackup(localStorage, now), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pianoroll-backup-${now.toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  showStatus("백업 파일을 저장했습니다 (다운로드 폴더를 확인하세요)");
});
const importFile = $<HTMLInputElement>("ear-import-file");
$("ear-import").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const f = importFile.files?.[0];
  importFile.value = "";
  if (!f) return;
  const parsed = parseBackup(await f.text());
  if (!parsed.ok) {
    showStatus(parsed.error, "error");
    return;
  }
  if (!window.confirm(`${parsed.summary} 을(를) 불러옵니다. 같은 항목은 파일 내용으로 덮어써요. 계속할까요?`)) return;
  applyBackup(localStorage, parsed);
  showStatus("불러왔습니다. 화면을 새로 고칩니다…");
  window.setTimeout(() => window.location.reload(), 600);
});

// 저장해 둔 음원이 있으면 올리고, 악기 목록을 채운다. 없으면 임시 신스로 그대로 연습한다.
async function restoreSoundfont(): Promise<void> {
  if (!canUseSoundFont()) {
    showStatus(INSECURE_HINT, "error");
    return;
  }
  const saved = await loadSavedSoundfont();
  if (!saved) {
    showStatus("음원(.sf2)이 없어 임시 신스로 들려 드려요. 피아노롤에서 📂 음원을 한 번 넣으면 여기서도 씁니다.");
    return;
  }
  try {
    await registry.soundfont.load(saved.file);
    ear.refreshInstruments();
    showStatus(`${registry.soundfont.name} — 저장해 둔 음원을 불러왔습니다`);
  } catch (err) {
    showStatus(`저장해 둔 음원을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}
void restoreSoundfont();

// ------------------------------------------------------------ 나가기 · 정리

/**
 * 「← 피아노롤」. 피아노롤에서 새 창으로 열었다면 이 창만 닫으면 작업하던 곡이 그대로 있다.
 * 직접 열었거나 브라우저가 닫기를 막으면 같은 창에서 피아노롤 페이지로 간다.
 */
$<HTMLButtonElement>("ear-exit").addEventListener("click", () => {
  ear.silence();
  quiz.silence();
  window.close();
  window.setTimeout(() => {
    if (!window.closed) window.location.href = new URL("./", window.location.href).toString();
  }, 200);
});

// 탭을 떠나거나 닫을 때 소리가 남지 않게 한다.
window.addEventListener("pagehide", () => {
  ear.silence();
  scheduler.keyReleaseAll();
});

// 개발 중 콘솔에서 상태를 들여다보기 위한 창구. 빌드하면 사라진다.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ear = { ear, quiz, scheduler, registry, engine, project };
}
