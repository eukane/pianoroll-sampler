/**
 * 귀 훈련 페이지 (ear.html).
 *
 * 흐름: 「▶ 문제 듣기」 → 으뜸 코드(I) 한 번 → 진행이 나온다 → 칸 순서대로 몇 도인지 누른다 →
 * 「확인」 → 맞았는지, 틀렸으면 정답이 뭔지. 틀린 문제는 쌓아 두었다가 「틀린 문제 다시」 로 푼다.
 *
 * 로마숫자 버튼을 누르면 **그 코드 소리가 난다.** 듣고 고르는 훈련인데 버튼이 말이 없으면
 * 「내가 들은 소리가 이게 맞나」 를 확인할 길이 없다. 눌러서 비교해 보는 게 수업에서 말한
 * 귀 훈련의 핵심이다.
 *
 * 피아노롤 위의 팝업이었던 것을 따로 떼어 낸 화면이다. 떼어 낸 까닭은 기록 때문이다 —
 * 도수별 정답률 · 헷갈린 쌍 · 오늘 푼 수 · 연속 일수를 옆에 늘 띄워 두려면 팝업으로는 좁다.
 *
 * 문제와 채점은 model/ear.ts, 기록 계산은 model/earStats.ts (둘 다 순수 계산).
 * 여기는 소리와 화면과 저장만 맡는다.
 */

import {
  LAST_LESSON, LEVELS, degreeNumeral, describeAnswer, grade, levelById, levelNames, makeQuestion, namedAnswer, qualityLabel,
  qualityPitches, questionChords, type Question, type Rand,
} from "../model/ear";
import {
  GOALS, MIN_SAMPLE, degreeRows, dayKey, namedConfusions, recordAnswer, sanitizeStore, streak, topConfusions,
  weakWeights, weakest, emptyStore, type EarStore, type Tally,
} from "../model/earStats";
import { LESSONS, focusLevels, lessonByNumber, visibleLevels } from "../model/lessons";
import { PROGRESSIONS, chordPitches } from "../model/progression";
import { keyLabel } from "../model/scale";

export type InstrumentChoice = { presetId: number; program: number; name: string };

export type EarDeps = {
  hold: (pitch: number) => void;
  release: (pitch: number) => void;
  isUnlocked: () => boolean;
  onStatus: (message: string, kind?: "info" | "error") => void;
  /** 고를 수 있는 악기. 사운드폰트가 없으면 빈 목록 (임시 신스 하나뿐). */
  instruments: () => InstrumentChoice[];
  setInstrument: (presetId: number) => void;
  /** 검사에서 시계·난수·저장소를 바꿔 끼우는 자리 */
  now?: () => Date;
  rand?: Rand;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
};

export const STORE_KEY = "pianoroll.ear";
/** 코드 하나 길이(ms)와 으뜸 코드 뒤의 쉼. 천천히 — 처음 듣는 사람이 따라갈 수 있게. */
const CHORD_MS = 1150;
const TONIC_MS = 1300;
const GAP_AFTER_TONIC = 450;
const HOLD_FRACTION = 0.92;
/** 코드 종류 문제의 코드 길이 — 하나뿐이라 충분히 길게 */
const QUALITY_MS = 2000;
/** 기본으로 걸어 줄 악기 (GM 프로그램 번호): 어쿠스틱 피아노 */
const DEFAULT_PROGRAM = 0;

export class EarTraining {
  private levelSel = el<HTMLSelectElement>("ear-level");
  private instSel = el<HTMLSelectElement>("ear-inst");
  private randKey = el<HTMLInputElement>("ear-randkey");
  private weakBox = el<HTMLInputElement>("ear-weak");
  private guide = el<HTMLElement>("ear-guide");
  private slotsEl = el<HTMLDivElement>("ear-slots");
  private choicesEl = el<HTMLDivElement>("ear-choices");
  private resultEl = el<HTMLDivElement>("ear-result");
  private scoreEl = el<HTMLElement>("ear-score");
  private newBtn = el<HTMLButtonElement>("ear-new");
  private againBtn = el<HTMLButtonElement>("ear-again");
  private tonicBtn = el<HTMLButtonElement>("ear-tonic");
  private backBtn = el<HTMLButtonElement>("ear-back");
  private submitBtn = el<HTMLButtonElement>("ear-submit");
  private revealBtn = el<HTMLButtonElement>("ear-reveal");
  private reviewBtn = el<HTMLButtonElement>("ear-review");
  private resetBtn = el<HTMLButtonElement>("ear-reset");
  private goalSel = el<HTMLSelectElement>("ear-goal");
  private lessonSel = el<HTMLSelectElement>("ear-lesson");
  private lessonHint = el<HTMLElement>("ear-lesson-hint");
  private focusBtn = el<HTMLButtonElement>("ear-focus");

  /** 지금 문제. 아직 안 냈으면 null. */
  question: Question | null = null;
  /** 저장되는 기록 전체 (model/earStats.ts) */
  store: EarStore;
  private picked: number[] = [];
  private pickedName: string | null = null;
  private answered = false;
  private session = { right: 0, total: 0 };
  private timers: number[] = [];
  private sounding = new Set<number>();
  private lastQuestion?: Question;
  private resetArmed: number | null = null;
  private deps: EarDeps;

  constructor(deps: EarDeps) {
    this.deps = deps;
    this.store = this.load();

    for (const l of LESSONS) {
      const o = document.createElement("option");
      o.value = String(l.n);
      o.textContent = `${l.n}회차까지${l.n === LAST_LESSON ? " (전부)" : ""} — ${l.title}`;
      this.lessonSel.appendChild(o);
    }
    this.lessonSel.value = String(this.store.lesson);
    this.rebuildLevels(this.store.level);
    for (const g of GOALS) {
      const o = document.createElement("option");
      o.value = String(g);
      o.textContent = `${g}문제`;
      this.goalSel.appendChild(o);
    }
    this.goalSel.value = String(this.store.goal);
    this.randKey.checked = this.store.randomKey;
    this.weakBox.checked = this.store.focusWeak;

    this.lessonSel.addEventListener("change", () => {
      this.store.lesson = Number(this.lessonSel.value);
      this.rebuildLevels(this.levelSel.value);
      this.store.level = this.levelSel.value;
      this.save();
      this.reset();
    });
    this.focusBtn.addEventListener("click", () => {
      const f = focusLevels(this.store.lesson)[0];
      if (!f) return;
      this.levelSel.value = f.id;
      this.store.level = f.id;
      this.save();
      this.reset();
    });
    this.levelSel.addEventListener("change", () => {
      this.store.level = this.levelSel.value;
      this.save();
      this.reset();
    });
    this.randKey.addEventListener("change", () => {
      this.store.randomKey = this.randKey.checked;
      this.save();
    });
    this.weakBox.addEventListener("change", () => {
      this.store.focusWeak = this.weakBox.checked;
      this.save();
    });
    this.goalSel.addEventListener("change", () => {
      this.store.goal = Number(this.goalSel.value);
      this.save();
      this.renderStats();
    });
    this.instSel.addEventListener("change", () => this.pickInstrument(Number(this.instSel.value)));
    this.newBtn.addEventListener("click", () => this.next());
    this.againBtn.addEventListener("click", () => this.replay());
    this.tonicBtn.addEventListener("click", () => this.playTonic());
    this.backBtn.addEventListener("click", () => this.back());
    this.submitBtn.addEventListener("click", () => this.submit());
    this.revealBtn.addEventListener("click", () => this.replay(true));
    this.reviewBtn.addEventListener("click", () => this.review());
    this.resetBtn.addEventListener("click", () => this.resetStats());
    window.addEventListener("keydown", (e) => this.onKey(e));
    this.reset();
  }

  // ------------------------------------------------------------ 배운 곳까지 · 단계 목록

  /**
   * 「배운 곳까지」 에 맞춰 단계 목록을 다시 채운다. 회차별로 묶고, 지금 회차의 추천 단계에 ★.
   * 고르고 있던 단계가 아직 안 배운 것이 되면 첫 단계로 내린다.
   */
  private rebuildLevels(want?: string): void {
    const lesson = this.store.lesson;
    const stars = new Set(lessonByNumber(lesson)?.focus ?? []);
    this.levelSel.textContent = "";
    let group: HTMLOptGroupElement | null = null;
    let groupLesson = 0;
    for (const l of visibleLevels(lesson)) {
      if (l.lesson !== groupLesson) {
        groupLesson = l.lesson;
        group = document.createElement("optgroup");
        group.label = `${l.lesson}회차 · ${lessonByNumber(l.lesson)?.title ?? ""}`;
        this.levelSel.appendChild(group);
      }
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = `${stars.has(l.id) ? "★ " : ""}${l.label}`;
      group?.appendChild(o);
    }
    const ok = visibleLevels(lesson).some((l) => l.id === want);
    this.levelSel.value = ok && want ? want : visibleLevels(lesson)[0].id;
    this.renderLessonHint();
  }

  private renderLessonHint(): void {
    const n = this.store.lesson;
    const l = lessonByNumber(n);
    const f = focusLevels(n)[0];
    if (!l) return;
    this.lessonHint.textContent =
      `${n}회차 귀 훈련: ${l.ear}${l.fromNotes ? "" : " (노트에 따로 없어 이번 회차 내용으로 붙인 추천)"}`;
    this.focusBtn.classList.toggle("hidden", !f);
    this.focusBtn.textContent = f ? `★ 추천 단계로: ${f.label}` : "";
    this.focusBtn.disabled = !!f && this.levelSel.value === f.id;
  }

  // ------------------------------------------------------------ 악기

  /** 사운드폰트가 들어온 뒤(또는 처음) 악기 목록을 다시 채운다. */
  refreshInstruments(): void {
    const list = this.deps.instruments();
    this.instSel.textContent = "";
    this.instSel.classList.toggle("hidden", list.length === 0);
    if (list.length === 0) return;
    for (const i of list) {
      const o = document.createElement("option");
      o.value = String(i.presetId);
      o.textContent = i.name;
      o.dataset.program = String(i.program);
      this.instSel.appendChild(o);
    }
    const want = this.store.instrument ?? DEFAULT_PROGRAM;
    const match = list.find((i) => i.program === want) ?? list[0];
    this.instSel.value = String(match.presetId);
    this.deps.setInstrument(match.presetId);
  }

  private pickInstrument(presetId: number): void {
    const opt = [...this.instSel.options].find((o) => Number(o.value) === presetId);
    this.deps.setInstrument(presetId);
    if (opt?.dataset.program !== undefined) {
      this.store.instrument = Number(opt.dataset.program);
      this.save();
    }
    // 바꾼 악기로 바로 들려준다 — 소리가 달라졌는지 확인할 길이 있어야 한다.
    if (this.question) this.replay();
  }

  // ------------------------------------------------------------ 흐름

  private get level() {
    return levelById(this.levelSel.value) ?? LEVELS[0];
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** 단계를 바꾸면 하던 문제는 접는다 (다른 단계의 칸 수로 이어 갈 수 없다). */
  private reset(): void {
    this.silence();
    this.question = null;
    this.picked = [];
    this.pickedName = null;
    this.answered = false;
    this.lastQuestion = undefined;
    this.session = { right: 0, total: 0 };
    this.resultEl.className = "ear-result";
    this.resultEl.textContent = "「▶ 문제 듣기」 를 누르세요";
    this.guide.textContent =
      this.level.kind === "quality"
        ? "코드 하나가 나옵니다. 어떤 종류인지 고르세요. 아래 버튼은 누르면 그 종류의 소리가 나요 — 먼저 눌러서 소리를 익히고, 문제와 비교해 보세요."
        : this.level.kind === "named"
          ? "진행을 듣고 어떤 정석 진행인지 고르세요. 으뜸 코드(I)를 먼저 들려주고 진행이 나옵니다."
          : this.level.bassOnly
            ? "으뜸 코드(I)를 먼저 들려주고, 이어서 **베이스 음만** 하나씩 나옵니다 (코드의 맨 아래 음). 그 음이 몇 도 코드의 베이스인지 순서대로 누르세요. 버튼을 누르면 그 코드 소리가 나니 비교해 보세요. 정답을 맞힌 뒤 「정답 들려주기」로 코드로도 들어 보세요."
            : "으뜸 코드(I)를 먼저 들려주고 진행이 나옵니다. 코드가 나온 순서대로 몇 도인지 누르세요. 버튼을 누르면 그 코드 소리가 나니 비교해 보세요.";
    this.renderLessonHint();
    this.render();
    this.renderScore();
    this.renderStats();
  }

  private next(): void {
    const lvl = this.level;
    const weights =
      this.store.focusWeak && lvl.kind === "degrees" ? weakWeights(this.store, lvl.mode, lvl.pool) : undefined;
    const rand = this.deps.rand ?? Math.random;
    this.startQuestion(makeQuestion(lvl.id, rand, this.randKey.checked, this.lastQuestion, weights, this.store.lesson));
  }

  private startQuestion(q: Question): void {
    this.question = q;
    this.lastQuestion = q;
    this.picked = [];
    this.pickedName = null;
    this.answered = false;
    this.resultEl.className = "ear-result";
    this.resultEl.textContent = namedAnswer(q) !== undefined ? "듣고 고르세요" : "듣고 순서대로 눌러 보세요";
    this.render();
    this.replay();
  }

  private submit(): void {
    const q = this.question;
    if (!q || this.answered) return;
    const named = namedAnswer(q) !== undefined;
    const answer = named ? this.pickedName : this.picked;
    if (answer === null || (Array.isArray(answer) && answer.length !== q.degrees.length)) return;
    const g = grade(q, answer);
    this.answered = true;
    this.session.total += 1;
    if (g.correct) this.session.right += 1;
    recordAnswer(this.store, q, answer, g.correct, this.now());
    this.save();

    const lvl = levelById(q.level) ?? this.level;
    // 코드 종류 문제는 조가 없다 (근음만 있다) — 「C 장조」 같은 말을 붙이지 않는다.
    const where = q.quality ? "" : ` (${keyLabel(q.key)})`;
    const truth = describeAnswer(q);
    const head = named ? `${optLabel(q, namedAnswer(q) as string)}${q.progression ? " — " : ": "}` : "";
    if (g.correct) {
      this.resultEl.className = "ear-result right";
      this.resultEl.textContent = `정답! ${q.quality ? "" : head}${truth}${where}`;
    } else {
      this.resultEl.className = "ear-result wrong";
      const mine = named
        ? `내 답: ${optLabel(q, this.pickedName ?? "")}`
        : `내 답: ${this.picked.map((d) => degreeNumeral(lvl.mode, d)).join(" ")}`;
      this.resultEl.textContent = `아쉬워요. 정답: ${q.quality ? "" : head}${truth}${where} · ${mine}`;
    }
    this.render(g.marks);
    this.renderScore();
    this.renderStats();
    // 정답을 바로 한 번 들려준다. 틀렸을 때 「아, 이 소리구나」 가 제일 잘 남는다. (베이스 단계는 이제 코드째로)
    this.replay(true);
  }

  /** 틀린 문제 중 가장 오래된 것부터. 맞힐 때까지 목록에 남는다. */
  private review(): void {
    const q = this.store.wrong[0];
    if (!q) return;
    if (this.level.id !== q.level) {
      this.levelSel.value = q.level;
      this.store.level = q.level;
      this.save();
      this.reset();
    }
    this.startQuestion(q);
  }

  private back(): void {
    if (this.answered || !this.question) return;
    if (namedAnswer(this.question) !== undefined) this.pickedName = null;
    else this.picked.pop();
    this.render();
  }

  private choose(degree: number): void {
    const q = this.question;
    // 문제가 없어도 눌러 보면 소리는 난다 (코드 소리 익히기). 칸에는 아무것도 안 들어간다.
    const mode = this.level.mode;
    const key = q?.key ?? { tonic: mode === "major" ? 0 : 9, mode };
    this.playChordNow(chordPitches(key, { degree }));
    if (!q || this.answered || namedAnswer(q) !== undefined) return;
    if (this.picked.length >= q.degrees.length) return;
    this.picked.push(degree);
    this.render();
  }

  private chooseName(id: string): void {
    const q = this.question;
    // 코드 종류는 누르면 그 소리가 난다 (문제의 근음 위에서 — 같은 근음이라야 소리만 비교된다).
    if (this.level.kind === "quality") this.playChordNow(qualityPitches(q?.key.tonic ?? 0, id));
    if (!q || this.answered) return;
    this.pickedName = id;
    this.render();
  }

  // ------------------------------------------------------------ 키보드 (PC)

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // 버튼에 초점이 있으면 스페이스·엔터는 그 버튼이 누른다. 두 번 처리하지 않는다.
    if (t?.tagName === "BUTTON" && (e.code === "Space" || e.code === "Enter")) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (this.question) this.replay();
      else this.next();
    } else if (e.code === "Enter") {
      e.preventDefault();
      if (this.question && !this.answered) this.submit();
      else this.next();
    } else if (e.code === "Backspace") {
      e.preventDefault();
      this.back();
    } else if (/^Digit[1-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5)) - 1;
      const lvl = this.level;
      if (lvl.kind === "degrees") {
        if (n < lvl.pool.length) this.choose(lvl.pool[n]);
      } else {
        const id = (lvl.kind === "quality" ? lvl.choices : this.question?.options)?.[n];
        if (id) this.chooseName(id);
      }
    }
  }

  // ------------------------------------------------------------ 소리

  /** 소리를 전부 멈추고 예약된 것도 취소한다. 페이지를 떠날 때도 부른다. */
  silence(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const p of this.sounding) this.deps.release(p);
    this.sounding.clear();
  }

  private at(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  /** 코드 하나를 ms 동안. 베이스(근음 한 옥타브 아래)를 얹어 코드 사이 이동이 또렷하게 들린다. */
  private chordAt(startMs: number, pitches: number[], lenMs: number, bassOnly = false): void {
    const all = bassOnly ? [pitches[0] - 12] : [pitches[0] - 12, ...pitches];
    this.at(startMs, () => {
      for (const p of all) {
        this.deps.hold(p);
        this.sounding.add(p);
      }
    });
    this.at(startMs + lenMs * HOLD_FRACTION, () => {
      for (const p of all) {
        this.deps.release(p);
        this.sounding.delete(p);
      }
    });
  }

  private ensureUnlocked(): boolean {
    if (this.deps.isUnlocked()) return true;
    this.deps.onStatus("화면을 한 번 탭해서 소리를 켜 주세요", "error");
    return false;
  }

  private playChordNow(pitches: number[]): void {
    if (!this.ensureUnlocked()) return;
    this.silence();
    this.chordAt(0, pitches, 800);
  }

  private playTonic(): void {
    const q = this.question;
    if (!q || !this.ensureUnlocked()) return;
    this.silence();
    this.chordAt(0, questionChords(q).tonic, TONIC_MS);
  }

  /** 으뜸 코드 → 쉼 → 진행. */
  private replay(full = false): void {
    const q = this.question;
    if (!q || !this.ensureUnlocked()) return;
    this.silence();
    const { tonic, chords } = questionChords(q);
    // 으뜸 코드가 없는 문제(코드 종류)는 바로 그 코드부터, 조금 더 길게 들려준다.
    let t = 0;
    if (tonic.length > 0) {
      this.chordAt(0, tonic, TONIC_MS);
      t = TONIC_MS + GAP_AFTER_TONIC;
    }
    const len = q.quality ? QUALITY_MS : CHORD_MS;
    const bassOnly = !full && levelById(q.level)?.bassOnly === true;
    for (const c of chords) {
      this.chordAt(t, c, len, bassOnly);
      t += len;
    }
  }

  // ------------------------------------------------------------ 연습 화면

  private render(marks?: boolean[]): void {
    const q = this.question;
    const lvl = this.level;
    this.renderSlots(marks);

    // 고르기 버튼
    this.choicesEl.textContent = "";
    if (lvl.kind === "degrees") {
      for (const d of lvl.pool) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = degreeNumeral(lvl.mode, d);
        b.addEventListener("click", () => this.choose(d));
        this.choicesEl.appendChild(b);
      }
    } else {
      // 코드 종류는 문제가 없어도 버튼이 보인다 — 눌러서 소리를 익히는 게 먼저다.
      const options = lvl.kind === "quality" ? lvl.choices : q?.options;
      for (const id of options ?? []) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = lvl.kind === "quality" ? "qual" : "named";
        b.textContent = lvl.kind === "quality" ? qualityLabel(id) : progLabel(id);
        // 종류 버튼은 답한 뒤에도 눌러 들어 볼 수 있다. 진행 이름 버튼은 답을 바꾸지 못하게 잠근다.
        b.disabled = this.answered && lvl.kind !== "quality";
        if (this.pickedName === id) b.classList.add("on");
        b.addEventListener("click", () => this.chooseName(id));
        this.choicesEl.appendChild(b);
      }
    }

    const named = q ? namedAnswer(q) !== undefined : false;
    const full = q ? (named ? this.pickedName !== null : this.picked.length === q.degrees.length) : false;
    const has = q !== null;
    const wrong = this.store.wrong.length;
    this.againBtn.disabled = !has;
    this.tonicBtn.disabled = !has;
    this.tonicBtn.classList.toggle("hidden", lvl.kind === "quality"); // 코드 하나만 나오는 문제엔 으뜸 코드가 없다
    // 약한 도수 가중치는 도수 단계에만 뜻이 있다 (이름·종류 고르기에는 도수가 없다)
    this.weakBox.closest("label")?.classList.toggle("hidden", lvl.kind !== "degrees");
    this.revealBtn.disabled = !(has && this.answered);
    this.backBtn.disabled = !has || this.answered || (named ? this.pickedName === null : this.picked.length === 0);
    this.submitBtn.disabled = !has || this.answered || !full;
    this.reviewBtn.disabled = wrong === 0;
    this.reviewBtn.textContent = `틀린 문제 다시${wrong ? ` (${wrong})` : ""}`;
    this.newBtn.textContent = has && !this.answered ? "⏭ 새 문제" : "▶ 문제 듣기";
  }

  private renderSlots(marks?: boolean[]): void {
    const q = this.question;
    const lvl = this.level;
    this.slotsEl.textContent = "";
    if (!q) return;
    if (namedAnswer(q) !== undefined) {
      const s = document.createElement("div");
      s.className = "ear-slot wide";
      if (this.pickedName) {
        s.classList.add("filled");
        s.textContent = optLabel(q, this.pickedName);
      } else s.textContent = "?";
      if (marks) s.classList.add(marks[0] ? "right" : "wrong");
      this.slotsEl.appendChild(s);
      return;
    }
    q.degrees.forEach((_, i) => {
      const s = document.createElement("div");
      s.className = "ear-slot";
      const d = this.picked[i];
      if (d !== undefined) {
        s.classList.add("filled");
        s.textContent = degreeNumeral(lvl.mode, d);
      } else s.textContent = String(i + 1);
      if (marks) {
        s.classList.add(marks[i] ? "right" : "wrong");
        if (!marks[i]) {
          const small = document.createElement("small");
          small.textContent = `정답 ${degreeNumeral(lvl.mode, q.degrees[i])}`;
          s.appendChild(small);
        }
      }
      this.slotsEl.appendChild(s);
    });
  }

  private renderScore(): void {
    const all = this.store.tally[this.level.id];
    const now = `이번 ${this.session.right}/${this.session.total}`;
    const total = all && all.total > 0 ? ` · 지금까지 ${all.right}/${all.total}` : "";
    this.scoreEl.textContent = now + total;
  }

  // ------------------------------------------------------------ 기록 화면

  private renderStats(): void {
    const s = this.store;
    const lvl = this.level;
    const today = this.now();
    const done = s.days[dayKey(today)]?.total ?? 0;
    const run = streak(s.days, today);

    el<HTMLElement>("ear-streak").textContent = run > 0 ? `🔥 ${run}일 연속` : "🔥 0일";
    el<HTMLElement>("ear-today").textContent = `오늘 ${done}/${s.goal}`;
    el<HTMLElement>("ear-today-bar").style.width = `${Math.min(100, (done / s.goal) * 100).toFixed(0)}%`;
    el<HTMLElement>("ear-today-text").textContent =
      done >= s.goal ? `오늘 ${done}문제 — 목표를 채웠어요 🎉` : `오늘 ${done}문제 · 목표까지 ${s.goal - done}문제`;

    // 도수별 (도수 단계) / 진행별 (이름 단계) / 종류별 (코드 종류 단계)
    const degEl = el<HTMLElement>("ear-deg");
    degEl.textContent = "";
    const weakLine = el<HTMLElement>("ear-weakline");
    const modeName = lvl.mode === "major" ? "장조" : "단조";
    const tallyRow = (label: string, t: Tally | undefined) => {
      const rate = t && t.total > 0 ? t.right / t.total : null;
      return statRow(label, rate, t && t.total > 0 ? `${pct(rate as number)} (${t.right}/${t.total})` : "아직", true);
    };
    if (lvl.kind === "degrees") {
      el<HTMLElement>("ear-deg-title").textContent = `도수별 정답률 · ${modeName}`;
      for (const r of degreeRows(s, lvl.mode, lvl.pool)) {
        degEl.appendChild(
          statRow(degreeNumeral(lvl.mode, r.degree), r.rate, r.rate === null ? "아직" : `${pct(r.rate)} (${r.right}/${r.asked})`),
        );
      }
      const w = weakest(s, lvl.mode, lvl.pool);
      weakLine.textContent = w
        ? `가장 약한 건 ${degreeNumeral(lvl.mode, w.degree)} — ${w.asked}번 중 ${w.right}번 맞혔어요. 「약한 도수를 더 자주」 를 켜면 이쪽이 많이 나옵니다.`
        : `도수마다 ${MIN_SAMPLE}번 넘게 풀면 약한 도수를 알려 드려요 (칸 하나가 한 번입니다).`;
    } else if (lvl.kind === "quality") {
      el<HTMLElement>("ear-deg-title").textContent = "코드 종류별 정답률";
      for (const id of lvl.choices ?? []) degEl.appendChild(tallyRow(qualityLabel(id), s.quals[id]));
      weakLine.textContent = "틀리면 정답 옆의 반음 세기를 따라 직접 세어 보세요. 소리가 머리에 들어올 때까지 아래 버튼을 눌러 비교하는 게 제일 빠릅니다.";
    } else {
      el<HTMLElement>("ear-deg-title").textContent = `정석 진행별 정답률 · ${modeName}`;
      for (const id of levelNames(lvl, s.lesson)) degEl.appendChild(tallyRow(progLabel(id), s.progs[id]));
      weakLine.textContent = "이름이 헷갈리면 도수 단계에서 그 진행의 코드를 하나씩 먼저 익혀 보세요.";
    }

    // 헷갈린 쌍
    const confEl = el<HTMLElement>("ear-conf");
    confEl.textContent = "";
    const pairs: { text: string; count: number }[] =
      lvl.kind === "degrees"
        ? topConfusions(s, lvl.mode, 5).map((c) => ({
            text: `${degreeNumeral(lvl.mode, c.asked)} 를 ${degreeNumeral(lvl.mode, c.answered)} 로`,
            count: c.count,
          }))
        : namedConfusions(s, lvl.kind === "quality" ? "q" : "p", 5).map((c) => ({
            text: `${lvl.kind === "quality" ? qualityLabel(c.asked) : progLabel(c.asked)} 를 ${lvl.kind === "quality" ? qualityLabel(c.answered) : progLabel(c.answered)} 로`,
            count: c.count,
          }));
    if (pairs.length === 0) {
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = "아직 없어요. 틀리면 「무엇을 무엇으로 답했는지」 가 여기 쌓입니다.";
      confEl.appendChild(p);
    }
    for (const c of pairs) {
      const r = document.createElement("div");
      r.className = "ear-conf-row";
      const text = document.createElement("span");
      text.textContent = c.text;
      const n = document.createElement("b");
      n.textContent = `${c.count}번`;
      r.append(text, n);
      confEl.appendChild(r);
    }

    // 단계별 (배운 곳까지만)
    const levEl = el<HTMLElement>("ear-levels");
    levEl.textContent = "";
    for (const l of visibleLevels(s.lesson)) {
      const row = tallyRow(`${l.lesson}회 · ${l.label}`, s.tally[l.id]);
      if (l.id === lvl.id) row.classList.add("current");
      levEl.appendChild(row);
    }
  }

  // ------------------------------------------------------------ 기록 지우기 (두 번 눌러야 지워진다)

  private resetStats(): void {
    if (this.resetArmed === null) {
      this.resetBtn.textContent = "정말 지울까요? 한 번 더";
      this.resetBtn.classList.add("danger");
      this.resetArmed = window.setTimeout(() => this.disarmReset(), 3500);
      return;
    }
    this.disarmReset();
    const keep = this.store;
    const fresh = emptyStore();
    // 설정(단계 · 목표 · 악기 …)은 남기고 쌓인 기록만 지운다.
    fresh.level = keep.level;
    fresh.lesson = keep.lesson;
    fresh.goal = keep.goal;
    fresh.focusWeak = keep.focusWeak;
    fresh.randomKey = keep.randomKey;
    fresh.instrument = keep.instrument;
    this.store = fresh;
    this.save();
    this.render();
    this.renderScore();
    this.renderStats();
    this.deps.onStatus("기록을 지웠습니다");
  }

  private disarmReset(): void {
    if (this.resetArmed !== null) clearTimeout(this.resetArmed);
    this.resetArmed = null;
    this.resetBtn.textContent = "기록 지우기";
    this.resetBtn.classList.remove("danger");
  }

  // ------------------------------------------------------------ 저장 (이 브라우저에만)

  private get storage() {
    if (this.deps.storage !== undefined) return this.deps.storage;
    try {
      return localStorage;
    } catch {
      return null; // 저장이 막혀 있어도 연습은 된다
    }
  }

  private load(): EarStore {
    try {
      const raw = this.storage?.getItem(STORE_KEY);
      return sanitizeStore(raw ? JSON.parse(raw) : null);
    } catch {
      return emptyStore();
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(STORE_KEY, JSON.stringify(this.store));
    } catch {
      /* 저장이 막혀 있어도 연습은 된다 */
    }
  }
}

function statRow(label: string, rate: number | null, text: string, wide = false): HTMLElement {
  const r = document.createElement("div");
  r.className = `ear-stat${wide ? " wide" : ""}`;
  const l = document.createElement("span");
  l.className = "ear-stat-label";
  l.textContent = label;
  const bar = document.createElement("span");
  bar.className = "ear-stat-bar";
  const fill = document.createElement("i");
  if (rate !== null) {
    fill.style.width = `${Math.round(rate * 100)}%`;
    fill.className = rate >= 0.85 ? "good" : rate < 0.6 ? "weak" : "mid";
  }
  bar.appendChild(fill);
  const v = document.createElement("span");
  v.className = "ear-stat-val";
  v.textContent = text;
  r.append(l, bar, v);
  return r;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** 이름·종류 고르기 문제의 보기 한 칸 글자 */
function optLabel(q: Question, id: string): string {
  return q.quality ? qualityLabel(id) : progLabel(id);
}

function progLabel(id: string): string {
  return PROGRESSIONS.find((p) => p.id === id)?.label ?? id;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} 를 찾을 수 없습니다`);
  return e as T;
}
