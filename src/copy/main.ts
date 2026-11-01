/**
 * 코드 따기 페이지의 진입점 (copy.html).
 * 귀 훈련 페이지와 같은 틀: 같은 주소 아래라 저장해 둔 음원(사운드폰트)을 같이 쓰고, 건반 소리는 스케줄러의 건반 길을 쓴다.
 */

import "../style.css";
import "./copy.css";
import { AudioEngine } from "../audio/engine";
import { Mixer } from "../audio/mixer";
import { MixerState } from "../audio/mixerState";
import { InstrumentRegistry } from "../audio/registry";
import { Scheduler } from "../audio/scheduler";
import { canUseSoundFont, INSECURE_HINT } from "../audio/soundfont";
import { loadSavedSoundfont } from "../audio/sfStore";
import { emptyProject } from "../model/project";
import { CopyPlayer } from "../ui/copyPlayer";

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

const statusEl = $<HTMLDivElement>("status");
let statusTimer: number | null = null;
function showStatus(message: string, kind: "info" | "error" = "info"): void {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
  statusEl.classList.toggle("error", kind === "error");
  if (statusTimer !== null) clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => statusEl.classList.add("hidden"), kind === "error" ? 6000 : 3500);
}

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

const copy = new CopyPlayer({
  ctx: engine.ctx,
  out: engine.master,
  hold: (pitch) => scheduler.keyHold(pitch, 0),
  release: (pitch) => scheduler.keyRelease(pitch, true),
  releaseAll: () => scheduler.keyReleaseAll(),
  setChordVolume: (v) => {
    project.tracks[0].volume = v;
  },
  onStatus: showStatus,
});

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
    const preset = registry.soundfont.presetList.find((x) => !x.isDrum && x.bankMSB === 0 && x.program === 0) ?? registry.soundfont.defaultPreset;
    if (preset) project.tracks[0].source = { kind: "sf2", presetId: preset.id };
    showStatus(`${registry.soundfont.name} — 저장해 둔 음원을 불러왔습니다`);
  } catch (err) {
    showStatus(`저장해 둔 음원을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}
void restoreSoundfont();

$<HTMLButtonElement>("copy-exit").addEventListener("click", () => {
  copy.silence();
  window.close();
  window.setTimeout(() => {
    if (!window.closed) window.location.href = new URL("./", window.location.href).toString();
  }, 200);
});

window.addEventListener("pagehide", () => {
  copy.silence();
  scheduler.keyReleaseAll();
});

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__copy = { copy, scheduler, registry, engine, project };
}
