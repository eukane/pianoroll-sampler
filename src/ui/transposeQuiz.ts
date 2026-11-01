/**
 * 키 옮기기 퀴즈 화면 (귀 훈련 페이지의 두 번째 탭).
 * 계산은 model/transpose.ts. 여기는 문제를 보여 주고, 고른 답을 채점하고, 정답을 들려준다.
 */

import { PROGRESSIONS, progressionPitches } from "../model/progression";
import { keyLabel } from "../model/scale";
import {
  TRANSPOSE_KEY, chordNames, emptyTransposeStore, explainTranspose, gradeTranspose, makeTransposeQuestion,
  recordTranspose, sanitizeTransposeStore, type TransposeQuestion, type TransposeStore,
} from "../model/transpose";

export type TransposeDeps = {
  hold: (pitch: number) => void;
  release: (pitch: number) => void;
  isUnlocked: () => boolean;
  getLesson: () => number;
  rand?: () => number;
};

const $ = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} 를 찾을 수 없습니다`);
  return e as T;
};

const CHORD_MS = 900;

export class TransposeQuiz {
  question: TransposeQuestion | null = null;
  store: TransposeStore = emptyTransposeStore();
  private answered = false;
  private picked: string | null = null;
  private timers: number[] = [];
  private sounding = new Set<number>();

  constructor(private deps: TransposeDeps) {
    try {
      this.store = sanitizeTransposeStore(JSON.parse(localStorage.getItem(TRANSPOSE_KEY) ?? "null"));
    } catch {
      this.store = emptyTransposeStore();
    }
    $("tq-new").addEventListener("click", () => this.next());
    $("tq-listen").addEventListener("click", () => this.listen());
    $("tq-options").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (b) this.choose(Number(b.dataset.i));
    });
    window.addEventListener("keydown", (e) => {
      if (document.body.classList.contains("tq-mode") === false) return;
      if (/^Digit[1-4]$/.test(e.code)) this.choose(Number(e.code.slice(5)) - 1);
      else if (e.code === "Enter") { e.preventDefault(); this.next(); }
    });
    this.render();
  }

  silence(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const p of this.sounding) this.deps.release(p);
    this.sounding.clear();
  }

  next(): void {
    this.silence();
    this.question = makeTransposeQuestion(this.deps.rand ?? Math.random, this.deps.getLesson(), this.question ?? undefined);
    this.answered = false;
    this.picked = null;
    this.render();
  }

  private choose(i: number): void {
    const q = this.question;
    if (!q || this.answered || !q.options[i]) return;
    this.picked = q.options[i];
    this.answered = true;
    const ok = gradeTranspose(q, this.picked);
    recordTranspose(this.store, q.prog, ok);
    try { localStorage.setItem(TRANSPOSE_KEY, JSON.stringify(this.store)); } catch { /* 저장 못 해도 연습은 된다 */ }
    this.render();
    this.listen();
  }

  /** 옮긴 조의 정답 진행을 들려준다 (으뜸 코드 먼저). */
  listen(): void {
    const q = this.question;
    if (!q || !this.deps.isUnlocked()) return;
    this.silence();
    const prog = PROGRESSIONS.find((p) => p.id === q.prog);
    if (!prog) return;
    const chords = progressionPitches(q.to, prog);
    chords.forEach((c, idx) => {
      const all = [c[0] - 12, ...c];
      this.timers.push(window.setTimeout(() => { for (const p of all) { this.deps.hold(p); this.sounding.add(p); } }, idx * CHORD_MS));
      this.timers.push(window.setTimeout(() => { for (const p of all) { this.deps.release(p); this.sounding.delete(p); } }, idx * CHORD_MS + CHORD_MS * 0.9));
    });
  }

  private render(): void {
    const q = this.question;
    const prompt = $("tq-prompt");
    const opts = $("tq-options");
    const result = $("tq-result");
    opts.textContent = "";
    $<HTMLButtonElement>("tq-listen").disabled = !(q && this.answered);
    $("tq-new").textContent = q && !this.answered ? "⏭ 새 문제" : "▶ 문제 내기";
    $("tq-score").textContent = this.store.total ? `지금까지 ${this.store.right}/${this.store.total}` : "";
    if (!q) {
      prompt.textContent = "「문제 내기」를 누르세요. 코드 진행을 다른 조로 옮겨 적는 연습입니다.";
      result.textContent = "";
      result.className = "ear-result";
      return;
    }
    const label = PROGRESSIONS.find((p) => p.id === q.prog)?.label ?? q.prog;
    prompt.textContent = `${keyLabel(q.from)}에서 「${label}」은  ${chordNames(q.prog, q.from)}.  이것을 ${keyLabel(q.to)}로 옮기면?`;
    q.options.forEach((line, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "named tq-opt";
      b.dataset.i = String(i);
      b.textContent = `${i + 1}. ${line}`;
      b.disabled = this.answered;
      if (this.answered && line === q.answer) b.classList.add("right");
      else if (this.answered && line === this.picked) b.classList.add("wrong");
      opts.appendChild(b);
    });
    if (!this.answered) {
      result.className = "ear-result";
      result.textContent = "도수는 그대로, 으뜸음만 움직입니다";
    } else if (this.picked === q.answer) {
      result.className = "ear-result right";
      result.textContent = `정답! ${explainTranspose(q)}`;
    } else {
      result.className = "ear-result wrong";
      result.textContent = `아쉬워요. ${explainTranspose(q)}`;
    }
  }
}

