/**
 * 내보내기 / 가져오기 시트.
 *
 * 렌더는 시간이 걸린다(폰에서는 더). 그동안 화면이 멈춘 것처럼 보이면 사용자는
 * 앱이 죽은 줄 알고 나가 버리므로, 무엇을 하고 있는지 계속 적어 준다.
 *
 * 스템(트랙별 WAV)이 따로 있는 이유는 FL Studio Mobile 같은 데에 **트랙 단위로**
 * 얹으려면 섞이지 않은 파일이 필요해서다. 하나로 합친 믹스는 나중에 손댈 수 없다.
 */

import type { Project } from "../model/types";
import { projectToMidi, midiToProject } from "../export/midi";
import { projectToJson, projectFromJson } from "../export/projectFile";
import { audioBufferToWav, peakOf } from "../export/wav";
import { onlyTrack, projectSeconds, renderProject } from "../export/render";
import type { InstrumentRegistry } from "../audio/registry";

export type ExportCallbacks = {
  onStatus: (message: string, kind?: "info" | "error") => void;
  onProjectReplaced: (project: Project) => void;
};

export class ExportPanel {
  private sheet: HTMLDivElement;
  private busy = false;

  constructor(
    private getProject: () => Project,
    private registry: InstrumentRegistry,
    private cb: ExportCallbacks,
  ) {
    this.sheet = document.getElementById("export-modal") as HTMLDivElement;

    (document.getElementById("export") as HTMLButtonElement).addEventListener("click", () =>
      this.sheet.classList.remove("hidden"),
    );
    (document.getElementById("export-close") as HTMLButtonElement).addEventListener("click", () =>
      this.close(),
    );
    this.sheet.addEventListener("click", (e) => {
      if (e.target === this.sheet) this.close();
    });

    this.on("save-wav", () => this.exportWav());
    this.on("save-stems", () => this.exportStems());
    this.on("save-midi", () => this.exportMidi());
    this.on("save-json", () => this.exportJson());

    const importInput = document.getElementById("import-file") as HTMLInputElement;
    (document.getElementById("open-file") as HTMLButtonElement).addEventListener("click", () =>
      importInput.click(),
    );
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      if (file) void this.importFile(file);
      importInput.value = "";
    });
  }

  /** 렌더 한 번마다 사운드폰트를 새로 읽어 온다 (export/render.ts 헤더 참고). */
  private bankSource = (): Promise<ArrayBuffer | null> => this.registry.soundfont.bankBuffer();

  private on(id: string, fn: () => void | Promise<void>): void {
    (document.getElementById(id) as HTMLButtonElement).addEventListener("click", () => {
      if (this.busy) {
        this.cb.onStatus("아직 만드는 중입니다. 끝나면 알려 드릴게요.");
        return;
      }
      void fn();
    });
  }

  private close(): void {
    this.sheet.classList.add("hidden");
  }

  private baseName(): string {
    const name = this.getProject().tracks[0]?.name ?? "project";
    return name.replace(/[^\w가-힣 -]/g, "").trim() || "project";
  }

  // ------------------------------------------------------------ 내보내기

  private async exportWav(): Promise<void> {
    const project = this.getProject();
    if (!this.hasNotes(project)) return;

    this.busy = true;
    this.close();
    try {
      const seconds = projectSeconds(project);
      this.cb.onStatus(`WAV 만드는 중… (${seconds.toFixed(1)}초 분량)`);
      const buffer = await renderProject(project, this.bankSource, this.registry.folders.list);
      this.warnIfSilent(buffer);
      download(audioBufferToWav(buffer), `${this.baseName()}.wav`);
      this.cb.onStatus(`${this.baseName()}.wav 를 저장했습니다`);
    } catch (err) {
      this.fail("WAV", err);
    } finally {
      this.busy = false;
    }
  }

  private async exportStems(): Promise<void> {
    const project = this.getProject();
    if (!this.hasNotes(project)) return;

    this.busy = true;
    this.close();
    try {
      const usable = project.tracks
        .map((track, index) => ({ track, index }))
        .filter(({ track }) => track.notes.length > 0);

      for (const [n, { track, index }] of usable.entries()) {
        this.cb.onStatus(`트랙별 WAV ${n + 1}/${usable.length} — ${track.name}`);
        const buffer = await renderProject(onlyTrack(project, index), this.bankSource, this.registry.folders.list);
        const safe = track.name.replace(/[^\w가-힣 -]/g, "").trim() || `track${index + 1}`;
        download(audioBufferToWav(buffer), `${index + 1}_${safe}.wav`);
        // 브라우저가 연속 다운로드를 막지 않게 한 박자 쉰다.
        await sleep(350);
      }
      this.cb.onStatus(`트랙별 WAV ${usable.length}개를 저장했습니다`);
    } catch (err) {
      this.fail("트랙별 WAV", err);
    } finally {
      this.busy = false;
    }
  }

  private exportMidi(): void {
    const project = this.getProject();
    if (!this.hasNotes(project)) return;
    const bytes = projectToMidi(project);
    // Uint8Array 를 그대로 넘기면 타입이 안 맞는다 (SharedArrayBuffer 가능성).
    // 새 ArrayBuffer 에 담아 넘긴다.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    download(new Blob([buffer], { type: "audio/midi" }), `${this.baseName()}.mid`);
    this.cb.onStatus(`${this.baseName()}.mid 를 저장했습니다`);
    this.close();
  }

  private exportJson(): void {
    const json = projectToJson(this.getProject());
    download(new Blob([json], { type: "application/json" }), `${this.baseName()}.json`);
    this.cb.onStatus("프로젝트를 저장했습니다");
    this.close();
  }

  // ------------------------------------------------------------ 가져오기

  private async importFile(file: File): Promise<void> {
    this.close();
    try {
      if (/\.json$/i.test(file.name)) {
        this.cb.onProjectReplaced(projectFromJson(await file.text()));
        this.cb.onStatus(`${file.name} 을(를) 열었습니다`);
        return;
      }
      if (/\.midi?$/i.test(file.name)) {
        const project = midiToProject(new Uint8Array(await file.arrayBuffer()));
        this.cb.onProjectReplaced(project);
        const notes = project.tracks.reduce((n, t) => n + t.notes.length, 0);
        this.cb.onStatus(
          `${file.name} — 트랙 ${project.tracks.length}개 · 노트 ${notes}개 · ${project.bpm}BPM`,
        );
        return;
      }
      this.cb.onStatus(`${file.name} 은(는) .mid 나 .json 이 아닙니다`, "error");
    } catch (err) {
      this.fail("불러오기", err);
    }
  }

  // ------------------------------------------------------------ 잔소리

  private hasNotes(project: Project): boolean {
    const total = project.tracks.reduce((n, t) => n + t.notes.length, 0);
    if (total > 0) return true;
    // 빈 파일을 내려받게 두면 사용자는 앱이 고장 났다고 생각한다.
    //
    // 시트를 닫고 나서 알린다. 안내는 화면 아래쪽에 뜨는데 시트가 그 위를
    // 덮고 있어서, 열어 둔 채로 알리면 **아무것도 안 보인다.** 버튼을 눌렀는데
    // 반응이 없는 것과 똑같아진다.
    this.close();
    this.cb.onStatus("노트가 하나도 없습니다. 먼저 격자를 눌러 찍어 주세요.", "error");
    return false;
  }

  private warnIfSilent(buffer: AudioBuffer): void {
    if (peakOf(buffer) > 0.0001) return;
    this.cb.onStatus(
      "소리가 없는 WAV 가 나왔습니다. 음원이 제대로 올라왔는지 확인해 주세요.",
      "error",
    );
  }

  private fail(what: string, err: unknown): void {
    this.cb.onStatus(
      `${what} 를 만들지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 곧바로 지우면 다운로드가 시작도 못 하고 끊긴다.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
