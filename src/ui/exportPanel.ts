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
import { totalBeats, beatsPerBar } from "../model/project";
import { projectToJson, projectFromJson } from "../export/projectFile";
import { DEMOS, type Demo } from "../model/demos";
import { audioBufferToWav, peakOf } from "../export/wav";
import { onlyTrack, projectSeconds, renderProject } from "../export/render";
import type { InstrumentRegistry } from "../audio/registry";
import type { MixerState } from "../audio/mixerState";

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
    private mixerState: MixerState,
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
    this.buildDemoButtons();

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

  /**
   * 곡에 적힌 노랫말을 미리 풀어 둔다.
   *
   * 디코딩은 비동기라 렌더 도중에는 못 한다. 빼먹으면 노래 트랙만 조용히
   * 비어서 나온다 — 왜 안 들리는지 알 수가 없는 종류의 실패다.
   */
  private prepareVoices(project: Project): Promise<void> {
    return this.registry.prepareVoices(project.tracks);
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
      await nextFrame();
      // 노랫말은 렌더 직전에 풀어 둔다. 안 그러면 노래 트랙만 조용히 빈다.
      await this.prepareVoices(project);
      const buffer = await renderProject(
        project,
        this.bankSource,
        this.registry.folders.list,
        this.mixerState,
        this.registry.voices,
      );
      download(audioBufferToWav(buffer), `${this.baseName()}.wav`);

      // 안내는 **저장 메시지보다 나중에** 낸다.
      //
      // 예전에는 warnIfSilent() 로 경고를 띄운 바로 다음 줄에서 "저장했습니다" 로
      // 덮어써 버렸다. 무음 WAV 가 나와도 사용자는 성공 메시지만 봤다.
      // 조용한 실패다.
      const problem = this.problemWith(project, buffer);
      this.cb.onStatus(
        problem ?? `${this.baseName()}.wav 를 저장했습니다`,
        problem ? "error" : "info",
      );
    } catch (err) {
      this.fail("WAV", err);
    } finally {
      this.busy = false;
    }
  }

  /**
   * 트랙별 WAV.
   *
   * 트랙 수만큼 렌더하고, 렌더할 때마다 사운드폰트를 **다시 읽는다.** 100MB
   * 짜리를 넣고 4트랙을 뽑으면 400MB 를 읽는 셈이다. 수백 MB 를 메모리에 두 벌
   * 들고 있지 않으려는 대가인데(export/render.ts 참고), 그동안 화면이 조용하면
   * 사용자는 앱이 죽은 줄 알고 나가 버린다.
   *
   * 그래서 트랙 번호만이 아니라 **지금 무엇을 하고 있는지**까지 적는다.
   * 음원을 읽는 중인지 소리를 만드는 중인지가 보이면 기다릴 수 있다.
   */
  private async exportStems(): Promise<void> {
    const project = this.getProject();
    if (!this.hasNotes(project)) return;

    this.busy = true;
    this.close();
    try {
      // 음소거한 트랙은 빼고 뽑는다.
      //
      // 예전에는 음소거된 트랙도 파일을 만들었는데 **속이 완전히 빈 WAV** 가
      // 나왔다. 다른 앱에 얹으려고 뽑는 파일인데 아무 소리도 없으면 쓸모가
      // 없고, 왜 비었는지도 알 수가 없다.
      const muted = project.tracks.filter((t) => t.notes.length > 0 && t.muted).length;
      const usable = project.tracks
        .map((track, index) => ({ track, index }))
        .filter(({ track }) => track.notes.length > 0 && !track.muted);

      if (usable.length === 0) {
        this.cb.onStatus("뽑을 트랙이 없습니다. 음소거를 풀거나 노트를 찍어 주세요.", "error");
        return;
      }

      const bankMB = Math.round(this.registry.soundfont.bankSizeBytes / 1024 / 1024);
      const hint = bankMB > 20 ? ` · 음원 ${bankMB}MB` : "";

      for (const [n, { track, index }] of usable.entries()) {
        const step = `트랙별 WAV ${n + 1}/${usable.length} — ${track.name}`;
        this.cb.onStatus(`${step} · 음원 읽는 중…${hint}`);
        // 화면이 한 번 그려질 틈을 준다. 안 그러면 안내가 안 보인 채로
        // 렌더가 시작돼서, 적어 놓은 의미가 없다.
        await nextFrame();

        this.cb.onStatus(`${step} · 소리 만드는 중…`);
        await nextFrame();
        const buffer = await renderProject(
          onlyTrack(project, index),
          this.bankSource,
          this.registry.folders.list,
          this.mixerState,
          this.registry.voices,
        );

        const safe = track.name.replace(/[^\w가-힣 -]/g, "").trim() || `track${index + 1}`;
        this.cb.onStatus(`${step} · 저장 중…`);
        download(audioBufferToWav(buffer), `${index + 1}_${safe}.wav`);
        // 브라우저가 연속 다운로드를 막지 않게 한 박자 쉰다.
        await sleep(350);
      }
      this.cb.onStatus(
        muted > 0
          ? `트랙별 WAV ${usable.length}개를 저장했습니다 (음소거된 ${muted}개는 뺐습니다)`
          : `트랙별 WAV ${usable.length}개를 저장했습니다`,
      );
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

  /** 예제 곡 버튼은 목록(model/demos.ts)에서 만든다. 곡을 늘려도 여기는 안 고친다. */
  private buildDemoButtons(): void {
    const slot = document.getElementById("demo-list") as HTMLDivElement;
    for (const demo of DEMOS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "big";
      b.id = `open-demo-${demo.id}`;
      b.textContent = demo.title;
      const small = document.createElement("small");
      small.textContent = demo.hint;
      b.appendChild(small);
      b.addEventListener("click", () => this.openDemo(demo));
      slot.appendChild(b);
    }
  }

  /**
   * 예제 곡 열기.
   *
   * 지금 만들던 것을 **덮어쓴다.** 저장 안 한 걸 말없이 날리면 안 되니까,
   * 노트가 하나라도 있으면 물어보고 연다. 빈 화면이면 그냥 연다 — 아무것도
   * 없는데 물어보는 건 그냥 귀찮게 하는 것이다.
   */
  private openDemo(demo: Demo): void {
    const hasNotes = this.getProject().tracks.some((t) => t.notes.length > 0);
    if (hasNotes && !window.confirm("지금 만들던 것을 덮어씁니다. 예제 곡을 불러올까요?")) return;
    this.close();
    const project = demo.make();
    this.cb.onProjectReplaced(project);

    // 드럼이 든 곡을 음원 없이 열면 드럼만 이상하게 들린다. 왜 그런지 알려 준다.
    const bars = `${project.bars}마디`;
    if (demo.needsDrums && !this.registry.usingSoundFont) {
      this.cb.onStatus(
        `${demo.title} (${bars}) — 드럼은 사운드폰트(.sf2)를 넣어야 제대로 들립니다`,
      );
      return;
    }
    this.cb.onStatus(`${demo.title} (${bars}) — 트랙 이름을 눌러 악기를 바꿔 보세요`);
  }

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

  /**
   * 뽑은 WAV 에 문제가 있으면 사람 말로. 없으면 null.
   *
   * 조용히 넘어가면 안 되는 것 둘을 본다.
   *   · 소리가 하나도 없는 파일
   *   · **곡 길이 뒤에 있는 노트** — WAV 에는 안 들어가는데 화면에는 보인다
   */
  private problemWith(project: Project, buffer: AudioBuffer): string | null {
    if (peakOf(buffer) <= 0.0001) {
      return "소리가 없는 WAV 가 나왔습니다. 트랙이 전부 음소거는 아닌지, 음원이 올라왔는지 확인해 주세요.";
    }

    const end = totalBeats(project);
    const beyond = project.tracks.reduce(
      (n, t) => n + t.notes.filter((note) => note.start >= end - 1e-6).length,
      0,
    );
    if (beyond > 0) {
      const bpb = beatsPerBar(project);
      const last = Math.max(
        ...project.tracks.flatMap((t) => t.notes.map((n) => n.start + n.length)),
      );
      return (
        `저장했지만 ${beyond}개 음이 빠졌습니다. 곡 길이가 ${project.bars}마디인데` +
        ` ${Math.ceil(last / bpb)}마디까지 노트가 있습니다 — 마디 수를 늘리고 다시 뽑으세요.`
      );
    }
    return null;
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

/** 화면이 한 번 그려지도록 양보한다. 안내를 적어 놓고 바로 렌더에 들어가면 안 보인다. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
