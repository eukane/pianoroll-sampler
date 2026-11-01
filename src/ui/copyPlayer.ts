/**
 * 코드 따기 연습 플레이어 (화면).
 *
 * 계산은 model/copyNotebook.ts · chordSymbol.ts 에 있고, 여기는 연결만 한다:
 *   음악 파일(<audio>, 이 기기 안에서만) → GainNode → 출력
 *   적어 둔 코드 → 곡 시각에 맞춰 스케줄러의 건반 소리로 같이 울림
 */

import { identifyChord, romanNumeral } from "../model/chord";
import { parseChordSymbol, splitCell } from "../model/chordSymbol";
import {
  MAX_BPM, MAX_CELLS, MAX_MARKERS, MIN_BPM, SPEEDS, barIndexAt, barSeconds, cellAt, defaultState, formatTime,
  loopFromBar, positionLabel, sanitizeState, shiftLoop, storageKey, tapTempo, type CopyState,
} from "../model/copyNotebook";
import { keyChoices, keyFromValue, keyToValue } from "../model/scale";

export type CopyDeps = {
  ctx: AudioContext;
  out: AudioNode;
  hold(pitch: number): void;
  release(pitch: number): void;
  releaseAll(): void;
  setChordVolume(v: number): void;
  onStatus(message: string, kind?: "info" | "error"): void;
};

const $ = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} 를 찾을 수 없습니다`);
  return e as T;
};

const KB_LOW = 48; // C3
const KB_HIGH = 83; // B5
const BLACK = new Set([1, 3, 6, 8, 10]);

export class CopyPlayer {
  st: CopyState = defaultState();
  readonly audio = new Audio();
  private songGain: GainNode;
  private url: string | null = null;
  private fileKey: string | null = null;
  private peaks: Float32Array | null = null;
  private view = { start: 0, end: 10 };
  private taps: number[] = [];
  private selCell = 0;
  private heldSymbol: string | null = null;
  private heldPitches: number[] = [];
  private saveTimer: number | null = null;

  private kbHeld = new Map<number, number>(); // pointerId → pitch
  private kbLatched: number[] = [];

  private el = {
    wave: $<HTMLCanvasElement>("copy-wave"),
    play: $<HTMLButtonElement>("copy-play"),
    cells: $<HTMLDivElement>("copy-cells"),
    readout: $<HTMLDivElement>("copy-readout"),
    insert: $<HTMLButtonElement>("copy-insert"),
    key: $<HTMLSelectElement>("copy-key"),
  };

  constructor(private deps: CopyDeps) {
    this.songGain = deps.ctx.createGain();
    this.songGain.connect(deps.out);
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
    // 속도를 바꿔도 음정이 그대로여야 코드가 들린다.
    const a = this.audio as HTMLAudioElement & { webkitPreservesPitch?: boolean };
    a.preservesPitch = true;
    a.webkitPreservesPitch = true;
    deps.ctx.createMediaElementSource(this.audio).connect(this.songGain);

    this.buildStatic();
    this.bind();
    this.refreshAll();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /** 소리를 모두 멈춘다 (창을 닫거나 나갈 때). */
  silence(): void {
    this.audio.pause();
    this.clearHeld();
    this.deps.releaseAll();
  }

  // ------------------------------------------------------------ 파일

  async loadFile(file: File): Promise<void> {
    this.silence();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(file);
    this.audio.src = this.url;
    this.peaks = null;
    $("copy-filename").textContent = `${file.name} (불러오는 중…)`;
    try {
      await new Promise<void>((resolve, reject) => {
        const ok = () => { cleanup(); resolve(); };
        const bad = () => { cleanup(); reject(new Error("이 파일은 브라우저가 재생하지 못합니다 (mp3·m4a·wav·ogg 를 써 보세요)")); };
        const cleanup = () => { this.audio.removeEventListener("loadedmetadata", ok); this.audio.removeEventListener("error", bad); };
        this.audio.addEventListener("loadedmetadata", ok);
        this.audio.addEventListener("error", bad);
      });
    } catch (err) {
      $("copy-filename").textContent = "파일을 열지 못했습니다";
      this.deps.onStatus(err instanceof Error ? err.message : String(err), "error");
      return;
    }
    const duration = this.audio.duration;
    this.fileKey = storageKey(file.name, file.size);
    let raw: unknown = null;
    try { raw = JSON.parse(localStorage.getItem(this.fileKey) ?? "null"); } catch { raw = null; }
    this.st = sanitizeState(raw, duration);
    this.audio.playbackRate = this.st.speed;
    this.view = { start: 0, end: duration };
    $("copy-filename").textContent = `${file.name} · ${formatTime(duration)}${raw ? " · 저장해 둔 내용 불러옴" : ""}`;
    for (const id of ["copy-play", "copy-back2", "copy-fwd2"]) $<HTMLButtonElement>(id).disabled = false;
    this.applyVolumes();
    this.refreshAll();
    void this.computePeaks(file);
  }

  private async computePeaks(file: File): Promise<void> {
    try {
      // 8kHz 로 내려받아 디코딩: 파형만 그리면 되니 메모리를 아낀다.
      const off = new OfflineAudioContext(1, 1, 8000);
      const buf = await off.decodeAudioData(await file.arrayBuffer());
      const data = buf.getChannelData(0);
      const n = Math.max(1, Math.ceil(buf.duration * 50));
      const per = data.length / n;
      const peaks = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        let m = 0;
        const end = Math.min(data.length, Math.floor((i + 1) * per));
        for (let j = Math.floor(i * per); j < end; j += 1) m = Math.max(m, Math.abs(data[j]));
        peaks[i] = m;
      }
      this.peaks = peaks;
    } catch {
      this.peaks = null; // 파형이 없어도 듣고 반복하는 데는 지장 없다
    }
    this.drawWave();
  }

  private get duration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }

  // ------------------------------------------------------------ 저장

  private changed(): void {
    if (!this.fileKey) return;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 300);
  }
  saveNow(): void {
    if (!this.fileKey) return;
    try { localStorage.setItem(this.fileKey, JSON.stringify(this.st)); } catch { /* 저장 공간이 없어도 연습은 된다 */ }
  }

  // ------------------------------------------------------------ 만들기 · 연결

  private buildStatic(): void {
    const speed = $("copy-speed");
    for (const s of SPEEDS) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.speed = String(s);
      b.textContent = `${s}×`;
      speed.appendChild(b);
    }
    const beats = $<HTMLSelectElement>("copy-beats");
    for (let i = 1; i <= 12; i += 1) beats.add(new Option(String(i), String(i)));
    for (const c of keyChoices()) this.el.key.add(new Option(c.label, c.value));

    const kbd = $("copy-kbd");
    const whites: number[] = [];
    for (let p = KB_LOW; p <= KB_HIGH; p += 1) if (!BLACK.has(p % 12)) whites.push(p);
    const w = 100 / whites.length;
    whites.forEach((p, i) => {
      const k = document.createElement("div");
      k.className = "wk";
      k.dataset.pitch = String(p);
      k.style.left = `${i * w}%`;
      k.style.width = `${w}%`;
      kbd.appendChild(k);
    });
    for (let p = KB_LOW; p <= KB_HIGH; p += 1) {
      if (!BLACK.has(p % 12)) continue;
      const i = whites.indexOf(p - 1);
      const k = document.createElement("div");
      k.className = "bk";
      k.dataset.pitch = String(p);
      k.style.left = `${(i + 1) * w - w * 0.3}%`;
      k.style.width = `${w * 0.6}%`;
      kbd.appendChild(k);
    }
  }

  private bind(): void {
    const { audio } = this;
    $<HTMLInputElement>("copy-file").addEventListener("change", (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) void this.loadFile(f);
    });
    this.el.play.addEventListener("click", () => this.togglePlay());
    $("copy-back2").addEventListener("click", () => this.seek(audio.currentTime - 2));
    $("copy-fwd2").addEventListener("click", () => this.seek(audio.currentTime + 2));
    audio.addEventListener("pause", () => { this.clearHeld(); this.refreshTransport(); });
    audio.addEventListener("play", () => this.refreshTransport());
    audio.addEventListener("ended", () => { this.clearHeld(); this.refreshTransport(); });

    $("copy-speed").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      this.st.speed = Number(b.dataset.speed);
      audio.playbackRate = this.st.speed;
      this.refreshAll();
      this.changed();
    });

    // 반복
    $("copy-a").addEventListener("click", () => this.setLoopEdge("a"));
    $("copy-b").addEventListener("click", () => this.setLoopEdge("b"));
    $("copy-loop").addEventListener("click", () => {
      if (!this.st.loop) { this.deps.onStatus("먼저 A 와 B 를 정하거나 「이 마디부터」를 눌러 주세요"); return; }
      this.st.loopOn = !this.st.loopOn;
      this.refreshAll(); this.changed();
    });
    $("copy-loopbar").addEventListener("click", () => {
      if (!this.duration) return;
      const n = Number($<HTMLSelectElement>("copy-loopn").value);
      this.st.loop = loopFromBar(audio.currentTime, n, this.st, this.duration);
      this.st.loopOn = true;
      this.seek(this.st.loop.a);
      this.refreshAll(); this.changed();
    });
    $("copy-next").addEventListener("click", () => this.moveLoop(1));
    $("copy-prev").addEventListener("click", () => this.moveLoop(-1));

    // 보기
    $("copy-zoom-all").addEventListener("click", () => { this.view = { start: 0, end: this.duration || 10 }; this.drawWave(); });
    $("copy-zoom-loop").addEventListener("click", () => {
      if (!this.st.loop) return;
      const pad = (this.st.loop.b - this.st.loop.a) * 0.05;
      this.view = { start: Math.max(0, this.st.loop.a - pad), end: Math.min(this.duration, this.st.loop.b + pad) };
      this.drawWave();
    });
    $("copy-zoom-in").addEventListener("click", () => this.zoom(0.5));
    $("copy-zoom-out").addEventListener("click", () => this.zoom(2));
    this.bindWave();

    // 박자 눈금
    const bpm = $<HTMLInputElement>("copy-bpm");
    bpm.addEventListener("change", () => {
      const v = Number(bpm.value);
      if (Number.isFinite(v)) this.st.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, v));
      this.refreshAll(); this.changed();
    });
    $("copy-tap").addEventListener("click", () => {
      const now = performance.now() / 1000;
      if (this.taps.length && now - this.taps[this.taps.length - 1] > 2.5) this.taps = [];
      this.taps.push(now);
      const v = tapTempo(this.taps);
      if (v !== null) { this.st.bpm = v; this.refreshAll(); this.changed(); }
    });
    $<HTMLSelectElement>("copy-beats").addEventListener("change", (e) => {
      this.st.beatsPerBar = Number((e.target as HTMLSelectElement).value);
      this.refreshAll(); this.changed();
    });
    $("copy-here").addEventListener("click", () => {
      this.st.offset = Math.max(0, this.audio.currentTime);
      this.refreshAll(); this.changed();
    });
    $("copy-off-m").addEventListener("click", () => this.nudge(-0.05));
    $("copy-off-p").addEventListener("click", () => this.nudge(0.05));

    // 표시
    $("copy-mark").addEventListener("click", () => {
      if (!this.duration) return;
      if (this.st.markers.length >= MAX_MARKERS) { this.deps.onStatus(`표시는 ${MAX_MARKERS}개까지`, "error"); return; }
      this.st.markers.push({ t: this.audio.currentTime, label: "" });
      this.st.markers.sort((x, y) => x.t - y.t);
      this.refreshAll(); this.changed();
    });
    $("copy-markers").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      const i = Number(b.dataset.i);
      if (b.dataset.act === "del") this.st.markers.splice(i, 1);
      else if (this.st.markers[i]) this.seek(this.st.markers[i].t);
      this.refreshAll(); this.changed();
    });

    // 수첩
    this.el.key.addEventListener("change", () => {
      const k = keyFromValue(this.el.key.value);
      if (k) this.st.key = k; else delete this.st.key;
      this.refreshReadout(); this.changed();
    });
    $<HTMLInputElement>("copy-overlay").addEventListener("change", (e) => {
      this.st.overlay = (e.target as HTMLInputElement).checked;
      if (!this.st.overlay) this.clearHeld();
      this.changed();
    });
    $<HTMLInputElement>("copy-songvol").addEventListener("input", (e) => {
      this.st.songVolume = Number((e.target as HTMLInputElement).value); this.applyVolumes(); this.changed();
    });
    $<HTMLInputElement>("copy-chordvol").addEventListener("input", (e) => {
      this.st.chordVolume = Number((e.target as HTMLInputElement).value); this.applyVolumes(); this.changed();
    });
    $<HTMLInputElement>("copy-firstbar").addEventListener("change", (e) => {
      const v = Math.round(Number((e.target as HTMLInputElement).value));
      this.st.firstBar = Math.min(999, Math.max(1, Number.isFinite(v) ? v : 1));
      this.refreshAll(); this.changed();
    });
    $("copy-addcells").addEventListener("click", () => {
      for (let i = 0; i < 4 && this.st.cells.length < MAX_CELLS; i += 1) this.st.cells.push("");
      this.renderCells(); this.changed();
    });
    $("copy-clearcells").addEventListener("click", () => {
      if (!this.st.cells.some((c) => c.trim())) return;
      if (!window.confirm("적어 둔 코드를 모두 지울까요?")) return;
      this.st.cells = this.st.cells.map(() => "");
      this.clearHeld(); this.renderCells(); this.changed();
    });
    this.el.cells.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      const i = Number(input.dataset.i);
      this.st.cells[i] = input.value;
      this.markCell(input.parentElement as HTMLElement, input.value);
      this.changed();
    });
    this.el.cells.addEventListener("focusin", (e) => {
      const i = Number((e.target as HTMLInputElement).dataset.i);
      if (Number.isFinite(i)) this.selectCell(i);
    });

    // 건반
    const kbd = $("copy-kbd");
    kbd.addEventListener("pointerdown", (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>("[data-pitch]");
      if (!k) return;
      e.preventDefault();
      try { kbd.setPointerCapture?.(e.pointerId); } catch { /* 합성 이벤트 */ }
      this.kbDown(e.pointerId, Number(k.dataset.pitch));
    });
    kbd.addEventListener("pointermove", (e) => {
      if (!this.kbHeld.has(e.pointerId)) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-pitch]");
      if (el && Number(el.dataset.pitch) !== this.kbHeld.get(e.pointerId)) this.kbDown(e.pointerId, Number(el.dataset.pitch));
    });
    for (const t of ["pointerup", "pointercancel"] as const) kbd.addEventListener(t, (e) => this.kbUp(e.pointerId));
    this.el.insert.addEventListener("click", () => {
      const info = identifyChord(this.kbLatched, this.st.key ?? null);
      if (!info) return;
      this.st.cells[this.selCell] = info.name;
      this.renderCells(); this.changed();
    });

    // 키보드 단축키 (입력칸에 글을 쓰는 중이면 건드리지 않는다)
    window.addEventListener("keydown", (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.code === "Space") { e.preventDefault(); this.togglePlay(); }
      else if (e.code === "ArrowLeft") this.seek(this.audio.currentTime - 2);
      else if (e.code === "ArrowRight") this.seek(this.audio.currentTime + 2);
    });
  }

  // ------------------------------------------------------------ 재생

  togglePlay(): void {
    if (!this.duration) return;
    if (this.audio.paused) {
      void this.deps.ctx.resume();
      void this.audio.play().catch((err) => this.deps.onStatus(`재생하지 못했습니다: ${String(err)}`, "error"));
    } else this.audio.pause();
  }

  seek(t: number): void {
    if (!this.duration) return;
    this.audio.currentTime = Math.min(this.duration, Math.max(0, t));
    this.clearHeld();
    this.refreshPos();
  }

  private setLoopEdge(which: "a" | "b"): void {
    if (!this.duration) return;
    const t = this.audio.currentTime;
    const cur = this.st.loop ?? { a: 0, b: this.duration };
    const next = { ...cur, [which]: t };
    if (next.b <= next.a + 0.05) {
      if (which === "a") next.b = Math.min(this.duration, t + 4);
      else next.a = Math.max(0, t - 4);
    }
    this.st.loop = next;
    this.st.loopOn = true;
    this.refreshAll(); this.changed();
  }

  private moveLoop(dir: 1 | -1): void {
    if (!this.st.loop) return;
    const next = shiftLoop(this.st.loop, dir, this.duration);
    if (next === this.st.loop) { this.deps.onStatus(dir > 0 ? "곡 끝입니다" : "곡 처음입니다"); return; }
    this.st.loop = next;
    this.seek(next.a);
    this.refreshAll(); this.changed();
  }

  private nudge(d: number): void {
    this.st.offset = Math.max(0, Math.round((this.st.offset + d) * 1000) / 1000);
    this.refreshAll(); this.changed();
  }

  private applyVolumes(): void {
    this.songGain.gain.value = this.st.songVolume;
    this.deps.setChordVolume(this.st.chordVolume);
    $<HTMLInputElement>("copy-songvol").value = String(this.st.songVolume);
    $<HTMLInputElement>("copy-chordvol").value = String(this.st.chordVolume);
  }

  /** 매 프레임: 구간 반복, 재생 위치 표시, 적어 둔 코드 울리기. */
  private loop(): void {
    requestAnimationFrame(this.loop);
    if (!this.duration) return;
    const t = this.audio.currentTime;
    if (!this.audio.paused && this.st.loopOn && this.st.loop && t >= this.st.loop.b) {
      this.audio.currentTime = this.st.loop.a;
      this.clearHeld();
    }
    if (!this.audio.paused) this.followView(t);
    this.refreshPos();
    this.updateOverlay();
    this.drawWave();
  }

  private clearHeld(): void {
    for (const p of this.heldPitches) this.deps.release(p);
    this.heldPitches = [];
    this.heldSymbol = null;
  }

  private updateOverlay(): void {
    if (this.audio.paused || !this.st.overlay) {
      if (this.heldSymbol !== null) this.clearHeld();
      return;
    }
    const hit = cellAt(this.audio.currentTime, this.st);
    const id = hit ? `${hit.cell}:${hit.slot}:${hit.symbol}` : null;
    if (id === this.heldSymbol) return;
    this.clearHeld();
    this.heldSymbol = id;
    const parsed = hit ? parseChordSymbol(hit.symbol) : null;
    if (!parsed) return;
    this.heldPitches = parsed.pitches;
    for (const p of parsed.pitches) this.deps.hold(p);
  }

  // ------------------------------------------------------------ 파형

  private zoom(f: number): void {
    const d = this.duration;
    if (!d) return;
    const mid = (this.view.start + this.view.end) / 2;
    const half = Math.min(d, Math.max(0.5, (this.view.end - this.view.start) * f)) / 2;
    let s = mid - half;
    let e = mid + half;
    if (s < 0) { e -= s; s = 0; }
    if (e > d) { s = Math.max(0, s - (e - d)); e = d; }
    this.view = { start: s, end: e };
    this.drawWave();
  }

  private followView(t: number): void {
    const { start, end } = this.view;
    if (t < start || t > end) {
      const w = end - start;
      const s = Math.max(0, Math.min(this.duration - w, t - w * 0.1));
      this.view = { start: s, end: s + w };
    }
  }

  private bindWave(): void {
    const c = this.el.wave;
    let down: { x: number; start: number; moved: boolean; id: number } | null = null;
    c.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, start: this.view.start, moved: false, id: e.pointerId };
      try { c.setPointerCapture?.(e.pointerId); } catch { /* 합성 이벤트 */ }
    });
    c.addEventListener("pointermove", (e) => {
      if (!down || down.id !== e.pointerId) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 5) down.moved = true;
      if (!down.moved) return;
      const w = this.view.end - this.view.start;
      const dt = (-dx / c.clientWidth) * w;
      const s = Math.max(0, Math.min(this.duration - w, down.start + dt));
      this.view = { start: s, end: s + w };
      this.drawWave();
    });
    c.addEventListener("pointerup", (e) => {
      if (!down || down.id !== e.pointerId) return;
      if (!down.moved) {
        const r = c.getBoundingClientRect();
        this.seek(this.view.start + ((e.clientX - r.left) / r.width) * (this.view.end - this.view.start));
      }
      down = null;
    });
    c.addEventListener("pointercancel", () => { down = null; });
  }

  private drawWave(): void {
    const c = this.el.wave;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.floor(c.clientWidth * dpr));
    const H = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, W, H);
    const d = this.duration;
    if (!d) return;
    const { start, end } = this.view;
    const span = Math.max(1e-6, end - start);
    const X = (t: number) => ((t - start) / span) * W;

    if (this.st.loop) {
      g.fillStyle = this.st.loopOn ? "rgba(78,201,176,0.20)" : "rgba(139,149,168,0.15)";
      g.fillRect(X(this.st.loop.a), 0, X(this.st.loop.b) - X(this.st.loop.a), H);
    }
    // 마디 눈금
    const bs = barSeconds(this.st.bpm, this.st.beatsPerBar);
    if ((bs / span) * W >= 6 * dpr) {
      const first = barIndexAt(start, this.st.offset, bs);
      g.font = `${10 * dpr}px sans-serif`;
      for (let bar = Math.max(0, first); bar < first + (span / bs) + 2; bar += 1) {
        const t = this.st.offset + bar * bs;
        if (t > end) break;
        if (t < start) continue;
        g.strokeStyle = bar % 4 === 0 ? "rgba(230,233,239,0.35)" : "rgba(230,233,239,0.15)";
        g.beginPath(); g.moveTo(X(t), 0); g.lineTo(X(t), H); g.stroke();
        if ((bs / span) * W >= 24 * dpr) { g.fillStyle = "#8b95a8"; g.fillText(String(bar + 1), X(t) + 3 * dpr, 11 * dpr); }
      }
    }
    // 파형
    if (this.peaks) {
      g.fillStyle = "#4ec9b0";
      const per = this.peaks.length / d;
      for (let x = 0; x < W; x += 1) {
        const t0 = start + (x / W) * span;
        const t1 = start + ((x + 1) / W) * span;
        let m = 0;
        for (let i = Math.floor(t0 * per); i <= Math.min(this.peaks.length - 1, Math.floor(t1 * per)); i += 1) m = Math.max(m, this.peaks[i]);
        const h = Math.max(1, m * H * 0.9);
        g.fillRect(x, (H - h) / 2, 1, h);
      }
    }
    // 표시
    g.fillStyle = "#d29922";
    for (const m of this.st.markers) if (m.t >= start && m.t <= end) g.fillRect(X(m.t) - 1, 0, 2 * dpr, H);
    // 재생 위치
    const t = this.audio.currentTime;
    g.fillStyle = "#fff";
    g.fillRect(X(t) - dpr, 0, 2 * dpr, H);
  }

  // ------------------------------------------------------------ 건반

  private kbDown(id: number, pitch: number): void {
    const prev = this.kbHeld.get(id);
    if (prev !== undefined) this.deps.release(prev);
    this.kbHeld.set(id, pitch);
    this.deps.hold(pitch);
    // 코드 이름은 **누른 순간**의 음 묶음으로 정한다. 손을 뗄 때 하나씩 줄어드는 중간 상태를 이름 붙이면 안 된다.
    this.kbLatched = [...new Set(this.kbHeld.values())].sort((a, b) => a - b);
    this.refreshKbd();
  }
  private kbUp(id: number): void {
    const p = this.kbHeld.get(id);
    if (p === undefined) return;
    this.kbHeld.delete(id);
    this.deps.release(p);
    this.refreshKbd();
  }
  private refreshKbd(): void {
    const on = new Set(this.kbHeld.values());
    document.querySelectorAll<HTMLElement>("#copy-kbd [data-pitch]").forEach((k) => k.classList.toggle("on", on.has(Number(k.dataset.pitch))));
    this.refreshReadout();
  }
  private refreshReadout(): void {
    const info = this.kbLatched.length >= 2 ? identifyChord(this.kbLatched, this.st.key ?? null) : null;
    let text = "건반을 눌러 보세요 (셋 이상 누르면 코드 이름이 나옵니다)";
    if (this.kbLatched.length >= 2) {
      if (!info) text = "이름을 붙일 수 없는 소리예요";
      else {
        text = info.name;
        if (this.st.key) text += ` · ${romanNumeral(info, this.kbLatched, this.st.key).numeral}`;
      }
    }
    this.el.readout.textContent = text;
    this.el.insert.disabled = !info;
  }

  // ------------------------------------------------------------ 칸

  private selectCell(i: number): void {
    this.selCell = i;
    this.el.cells.querySelectorAll(".copy-cell").forEach((c, k) => c.classList.toggle("sel", k === i));
    $("copy-sel").textContent = `${this.st.firstBar + i}마디 칸 선택됨`;
  }

  private markCell(wrap: HTMLElement, value: string): void {
    const bad = splitCell(value).some((t) => parseChordSymbol(t) === null);
    wrap.classList.toggle("bad", bad);
    wrap.title = bad ? "읽을 수 없는 코드 이름이 있어요 (예: C Am7 F/A Bbmaj7 Dsus4)" : "";
  }

  private renderCells(): void {
    const box = this.el.cells;
    // 칸 수가 같으면 입력칸을 다시 만들지 않고 값만 맞춘다. BPM 칸에서 칸으로 넘어가는 순간 일어나는
    // 화면 갱신이, 막 쓰기 시작한 글자를 지워 버리는 일이 없게.
    if (box.children.length === this.st.cells.length) {
      this.st.cells.forEach((text, i) => {
        const w = box.children[i] as HTMLElement;
        w.querySelector("small")!.textContent = `${this.st.firstBar + i}`;
        const input = w.querySelector("input")!;
        if (input !== document.activeElement && input.value !== text) input.value = text;
        this.markCell(w, input.value);
      });
      this.selectCell(Math.min(this.selCell, this.st.cells.length - 1));
      return;
    }
    box.textContent = "";
    this.st.cells.forEach((text, i) => {
      const w = document.createElement("div");
      w.className = "copy-cell";
      const small = document.createElement("small");
      small.textContent = `${this.st.firstBar + i}`;
      const input = document.createElement("input");
      input.type = "text";
      input.value = text;
      input.dataset.i = String(i);
      input.autocomplete = "off";
      input.setAttribute("autocapitalize", "off");
      input.spellcheck = false;
      input.maxLength = 40;
      w.append(small, input);
      this.markCell(w, text);
      box.appendChild(w);
    });
    this.selectCell(Math.min(this.selCell, this.st.cells.length - 1));
  }

  // ------------------------------------------------------------ 화면 갱신

  private refreshTransport(): void {
    this.el.play.textContent = this.audio.paused ? "▶ 재생" : "⏸ 일시정지";
  }

  private refreshPos(): void {
    const t = this.audio.currentTime || 0;
    $("copy-time").textContent = formatTime(t);
    $("copy-pos").textContent = this.duration ? positionLabel(t, this.st) : "–";
    const hit = cellAt(t, this.st);
    const bar = barIndexAt(t, this.st.offset, barSeconds(this.st.bpm, this.st.beatsPerBar));
    this.el.cells.querySelectorAll(".copy-cell").forEach((c, i) => c.classList.toggle("now", !!hit && hit.cell === i && bar >= 0));
  }

  private refreshAll(): void {
    const st = this.st;
    document.querySelectorAll<HTMLButtonElement>("#copy-speed button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === st.speed)));
    const lp = $("copy-loop");
    lp.setAttribute("aria-pressed", String(st.loopOn));
    lp.textContent = st.loopOn ? "🔁 반복 켜짐" : "🔁 반복 꺼짐";
    $("copy-loopinfo").textContent = st.loop ? `${formatTime(st.loop.a)} ~ ${formatTime(st.loop.b)}` : "A·B 를 정해 주세요";
    $<HTMLInputElement>("copy-bpm").value = String(st.bpm);
    $<HTMLSelectElement>("copy-beats").value = String(st.beatsPerBar);
    $("copy-offinfo").textContent = `1박 = ${st.offset.toFixed(2)}초`;
    $<HTMLInputElement>("copy-overlay").checked = st.overlay;
    $<HTMLInputElement>("copy-firstbar").value = String(st.firstBar);
    this.el.key.value = st.key ? keyToValue(st.key) : "";
    this.applyVolumes();
    this.refreshTransport();
    this.refreshMarkers();
    this.renderCells();
    this.refreshReadout();
    this.refreshPos();
    this.drawWave();
  }

  private refreshMarkers(): void {
    const box = $("copy-markers");
    box.textContent = "";
    this.st.markers.forEach((m, i) => {
      const w = document.createElement("span");
      w.className = "mk";
      const go = document.createElement("button");
      go.type = "button"; go.dataset.i = String(i); go.dataset.act = "go";
      go.textContent = `🚩 ${formatTime(m.t)}`;
      const del = document.createElement("button");
      del.type = "button"; del.dataset.i = String(i); del.dataset.act = "del";
      del.textContent = "✕"; del.title = "표시 지우기";
      w.append(go, del);
      box.appendChild(w);
    });
  }
}
