/**
 * 음 하나 조교하기 — 노트를 톡 치면 열리는 창.
 *
 * 트랙에 떨림을 걸어 두면 그 악기의 긴 음이 전부 똑같이 떤다. 그건 기교가
 * 아니라 버릇이다. 실제 연주는 **음마다 다르다** — 같은 음높이를 찍어도
 * 어떤 건 밑에서 끌어올리고 어떤 건 끝에서 흘려 내린다. 그 차이를 여기서 준다.
 *
 * ## 왜 탭인가
 *
 * 노트 위에서 탭은 원래 **아무 일도 안 하던** 동작이다 (끌면 이동, 오른쪽 끝을
 * 끌면 길이). 비어 있던 자리라 새 모드나 토글 버튼을 만들지
 * 않고 그대로 쓴다. 폰 화면에 버튼을 하나라도 덜 얹는 쪽이 낫다.
 *
 * ## 고르면 바로 들린다
 *
 * 꾸밈은 글로 설명해 봐야 모른다. 버튼을 누르는 순간 그 음을 그 꾸밈대로
 * 들려준다. 귀로 고르는 것이지 이름으로 고르는 게 아니다.
 */

import type { Note, Project } from "../model/types";
import {
  amountOf,
  atOf,
  curveOf,
  DEFAULT_AMOUNT,
  FLAT_CURVE,
  MAX_BEND_CENTS,
  MAX_CURVE_POINTS,
  ORNAMENTS,
  type CurvePoint,
  type Ornament,
} from "../model/ornament";

export type NotePanelCallbacks = {
  /** 지금 트랙이 노래하는 트랙인가. 맞으면 가사칸을 띄운다. */
  isSinging: () => boolean;
  /** 이 음원이 낼 수 있는 소리인가. 아니면 사용자에게 알려 준다. */
  canSing: (lyric: string) => boolean;
  onBeforeChange: () => void;
  onAfterChange: () => void;
  /** 값이 바뀌었다 — 예약을 다시 하고 화면을 다시 그려 달라. */
  onEdit: () => void;
  /** 이 음을 지금 들려 달라. */
  onAudition: (note: Note) => void;
  onDelete: (note: Note) => void;
};

export class NotePanel {
  private modal: HTMLDivElement;
  private body: HTMLDivElement;
  private title: HTMLElement;
  private note: Note | null = null;

  constructor(
    private getProject: () => Project,
    private cb: NotePanelCallbacks,
  ) {
    this.modal = document.getElementById("note-modal") as HTMLDivElement;
    this.body = document.getElementById("note-body") as HTMLDivElement;
    this.title = document.getElementById("note-title") as HTMLElement;

    (document.getElementById("note-close") as HTMLButtonElement).addEventListener("click", () =>
      this.close(),
    );
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.modal.classList.contains("hidden");
  }

  open(note: Note): void {
    this.note = note;
    this.render();
    this.modal.classList.remove("hidden");
  }

  close(): void {
    this.modal.classList.add("hidden");
    this.note = null;
  }

  /** 노트가 사라졌으면(되돌리기·삭제) 창도 닫는다. */
  syncWithProject(): void {
    if (!this.note || !this.isOpen) return;
    const alive = this.getProject().tracks.some((t) => t.notes.some((n) => n.id === this.note?.id));
    if (!alive) this.close();
  }

  private render(): void {
    const note = this.note;
    if (!note) return;
    this.body.textContent = "";
    this.title.textContent = `${nameOf(note.pitch)} · ${beatText(note.length)}`;

    // 노래하는 트랙이면 가사가 제일 위다. 꾸밈보다 먼저 정할 것이다.
    if (this.cb.isSinging()) this.body.appendChild(this.lyricInput(note));

    const row = document.createElement("div");
    row.className = "ornaments";
    for (const o of ORNAMENTS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "orn" + ((note.ornament ?? "none") === o.id ? " on" : "");
      b.dataset.orn = o.id;
      const label = document.createElement("b");
      label.textContent = o.label;
      const hint = document.createElement("small");
      hint.textContent = o.hint;
      b.append(label, hint);
      b.addEventListener("click", () => this.choose(o.id));
      row.appendChild(b);
    }
    this.body.appendChild(row);

    // 「그냥」에는 세기가 없다. 있을 이유가 없는 조절기를 띄워 두면
    // 움직여 보고 아무 일도 안 일어나서 고장인 줄 안다.
    // 「직접」은 곡선을 그리는 것이라 세기·시점 슬라이더가 뜻이 없다.
    // 곡선이 그 둘을 통째로 대신한다.
    if ((note.ornament ?? "none") === "free") {
      this.body.appendChild(this.curveEditor(note));
    } else if ((note.ornament ?? "none") !== "none") {
      this.body.appendChild(this.strengthSlider(note));
      this.body.appendChild(this.timingSlider(note));
    }

    const foot = document.createElement("div");
    foot.className = "note-foot";

    const play = document.createElement("button");
    play.type = "button";
    play.id = "note-audition";
    play.textContent = "▶︎ 들어보기";
    play.addEventListener("click", () => this.cb.onAudition(note));

    const del = document.createElement("button");
    del.type = "button";
    del.id = "note-delete";
    del.className = "danger";
    del.textContent = "🗑 이 음 지우기";
    del.addEventListener("click", () => {
      this.cb.onDelete(note);
      this.close();
    });

    foot.append(play, del);
    this.body.appendChild(foot);
  }

  /**
   * 노랫말 한 글자.
   *
   * 적자마자 들려준다 — 「か」와 「が」를 글자로 구분하는 것보다 귀로 듣는 게
   * 빠르다. 음원에 없는 글자면 **그 자리에서 알려 준다.** 소리만 안 나면
   * 오타인지 음원에 없는 건지 알 수가 없다.
   */
  private lyricInput(note: Note): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "lyricrow";

    const text = document.createElement("span");
    text.textContent = "가사";

    const input = document.createElement("input");
    input.id = "note-lyric";
    input.type = "text";
    input.value = note.lyric ?? "";
    input.placeholder = "か";
    input.autocomplete = "off";

    const mark = document.createElement("i");
    const show = () => {
      const v = input.value.trim();
      if (!v) {
        mark.textContent = "비어 있음";
        mark.className = "";
        return;
      }
      const okay = this.cb.canSing(v);
      mark.textContent = okay ? "✓ 낼 수 있음" : "이 음원에 없는 소리";
      mark.className = okay ? "" : "bad";
    };
    show();

    input.addEventListener("input", () => {
      const v = input.value.trim();
      if (v) note.lyric = v;
      else delete note.lyric;
      show();
      this.cb.onEdit();
    });
    input.addEventListener("pointerdown", () => this.cb.onBeforeChange());
    input.addEventListener("change", () => {
      this.cb.onAfterChange();
      if (this.cb.canSing(input.value.trim())) this.cb.onAudition(note);
    });

    wrap.append(text, input, mark);
    return wrap;
  }

  private choose(o: Ornament): void {
    const note = this.note;
    if (!note) return;
    this.cb.onBeforeChange();
    note.ornament = o;
    if (o !== "none" && note.ornamentAmount === undefined) note.ornamentAmount = DEFAULT_AMOUNT;
    // 「직접」을 처음 고르면 그릴 것이 있어야 한다. 빈 화면에서 시작하면
    // 무엇을 하라는 건지 알 수가 없다. 평평한 선에서 시작한다.
    if (o === "free" && curveOf(note) === null) note.bend = FLAT_CURVE.map((p) => ({ ...p }));
    this.cb.onEdit();
    this.cb.onAfterChange();
    this.render();
    // 고른 순간 들려준다. 이름만 보고는 무슨 소리인지 알 수 없다.
    if (o !== "none") this.cb.onAudition(note);
  }

  private strengthSlider(note: Note): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "mixslider";

    const text = document.createElement("span");
    text.textContent = "세기";

    const input = document.createElement("input");
    input.id = "note-amount";
    input.type = "range";
    input.min = "0.1";
    input.max = "1";
    input.step = "0.05";
    input.value = String(amountOf(note));

    const readout = document.createElement("i");
    readout.textContent = String(Math.round(amountOf(note) * 100));

    input.addEventListener("pointerdown", () => this.cb.onBeforeChange());
    input.addEventListener("input", () => {
      note.ornamentAmount = Number(input.value);
      readout.textContent = String(Math.round(Number(input.value) * 100));
      this.cb.onEdit();
    });
    input.addEventListener("change", () => {
      this.cb.onAfterChange();
      this.cb.onAudition(note);
    });

    wrap.append(text, input, readout);
    return wrap;
  }

  /**
   * 곡선을 손으로 그리는 자리 — 보카로의 그 곡선.
   *
   * ## 왜 노트 위가 아니라 여기인가
   *
   * "노트를 꾹 누르면 파형을 노트 위에 표시하고 조정" 이 원래 요청이었다.
   * 둘 다 안 되는 이유가 있었다.
   *
   * **꾹 누르기**: 바로 앞에서 없앤 동작이다. 노트 탭이 이미 이 창을 여는데,
   * 그 옆에 누른 시간으로 갈리는 동작을 또 두면 "창이 뜨기도 하고 지워지기도
   * 하는" 그 문제가 그대로 돌아온다.
   *
   * **노트 위에서 조정**: 세로가 안 나온다. 노트 한 칸이 기본 20px(최대
   * 40px)인데 벤드 범위는 ±200센트다. 한 칸에 담으면 1px = 10센트가 되고,
   * 손끝 접촉면 40px 이 곧 400센트 — **범위 전체**다. 겨눌 수가 없다.
   *
   * 이 창은 화면 폭을 다 쓰므로 세로 140px 을 준다. 400센트를 140px 에
   * 펴면 1px ≈ 2.9센트. 그제야 손가락으로 고를 수 있는 크기가 된다.
   * 보여 주는 건 노트 위에 그대로 하고(ui/pianoroll.ts), 고치는 건 여기서.
   *
   * ## 양 끝은 세로로만 움직인다
   *
   * 곡선은 음의 처음부터 끝까지를 덮어야 한다. 양 끝을 가로로 옮길 수 있게
   * 하면 덮이지 않는 구간이 생기고, 거기서 음정이 어디 있는지가 정해지지 않는다.
   */
  private curveEditor(note: Note): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "curvebox";

    const canvas = document.createElement("canvas");
    canvas.id = "note-curve";
    canvas.className = "curve";
    const H = 140;

    const readout = document.createElement("i");
    const foot = document.createElement("div");
    foot.className = "curvefoot";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.id = "curve-add";
    addBtn.textContent = "＋ 점";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.id = "curve-del";
    delBtn.textContent = "− 점";
    const flatBtn = document.createElement("button");
    flatBtn.type = "button";
    flatBtn.id = "curve-flat";
    flatBtn.textContent = "↔ 평평하게";
    foot.append(addBtn, delBtn, flatBtn, readout);

    const points = (): CurvePoint[] => curveOf(note) ?? FLAT_CURVE.map((p) => ({ ...p }));
    let picked = -1;

    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 300;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(H * dpr);
      const g = canvas.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, H);

      const px = (at: number) => 10 + at * (w - 20);
      const py = (cents: number) => H / 2 - (cents / MAX_BEND_CENTS) * (H / 2 - 12);

      // 눈금 — 가운데(제 음정)와 위아래 반음. 기준선이 없으면 얼마나 휘었는지 모른다.
      g.strokeStyle = "#2b3140";
      g.lineWidth = 1;
      for (const c of [-200, -100, 0, 100, 200]) {
        g.globalAlpha = c === 0 ? 1 : 0.55;
        g.beginPath();
        g.moveTo(8, py(c));
        g.lineTo(w - 8, py(c));
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = "#8b95a8";
      g.font = "10px system-ui, sans-serif";
      g.textBaseline = "middle";
      g.fillText("+1", 10, py(100));
      g.fillText("−1", 10, py(-100));

      const pts = points();
      g.strokeStyle = "#4ec9b0";
      g.lineWidth = 2;
      g.beginPath();
      pts.forEach((p, i) => (i === 0 ? g.moveTo(px(p.at), py(p.cents)) : g.lineTo(px(p.at), py(p.cents))));
      g.stroke();

      pts.forEach((p, i) => {
        g.fillStyle = i === picked ? "#ffd479" : "#8ff0dc";
        g.beginPath();
        // 손가락으로 잡을 것이라 점을 크게 그린다. 작으면 못 잡는다.
        g.arc(px(p.at), py(p.cents), i === picked ? 8 : 6, 0, Math.PI * 2);
        g.fill();
      });

      readout.textContent =
        picked >= 0 && pts[picked]
          ? `${Math.round(pts[picked].at * 100)}% · ${pts[picked].cents > 0 ? "+" : ""}${pts[picked].cents}센트`
          : `점 ${pts.length}개`;
    };

    const save = (pts: CurvePoint[]): void => {
      note.bend = pts;
      this.cb.onEdit();
      draw();
    };

    const nearest = (x: number, y: number): number => {
      const w = canvas.clientWidth || 300;
      const px = (at: number) => 10 + at * (w - 20);
      const py = (c: number) => H / 2 - (c / MAX_BEND_CENTS) * (H / 2 - 12);
      let best = -1;
      let bestD = 30; // 손끝만 한 거리 안에 있어야 잡은 것으로 본다
      points().forEach((p, i) => {
        const d = Math.hypot(px(p.at) - x, py(p.cents) - y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    };

    const toValue = (x: number, y: number): CurvePoint => {
      const w = canvas.clientWidth || 300;
      const at = Math.max(0, Math.min(1, (x - 10) / Math.max(1, w - 20)));
      const cents = Math.round(((H / 2 - y) / (H / 2 - 12)) * MAX_BEND_CENTS);
      return { at, cents: Math.max(-MAX_BEND_CENTS, Math.min(MAX_BEND_CENTS, cents)) };
    };

    let dragging = false;
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const hit = nearest(x, y);
      this.cb.onBeforeChange();
      if (hit >= 0) {
        picked = hit;
        dragging = true;
        draw();
        return;
      }
      // 빈 데를 누르면 거기에 점을 하나 놓는다.
      const pts = points();
      if (pts.length >= MAX_CURVE_POINTS) {
        picked = -1;
        draw();
        return;
      }
      const v = toValue(x, y);
      pts.push(v);
      pts.sort((a, b) => a.at - b.at);
      picked = pts.findIndex((p) => p === v);
      dragging = true;
      save(pts);
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!dragging || picked < 0) return;
      const r = canvas.getBoundingClientRect();
      const v = toValue(e.clientX - r.left, e.clientY - r.top);
      const pts = points();
      const p = pts[picked];
      if (!p) return;
      // 양 끝은 세로로만. 곡선이 음 전체를 덮어야 한다.
      p.cents = v.cents;
      if (picked !== 0 && picked !== pts.length - 1) {
        // 이웃을 넘어가지 않게 막는다. 넘어가면 곡선이 뒤로 접힌다.
        const lo = pts[picked - 1].at + 0.01;
        const hi = pts[picked + 1].at - 0.01;
        p.at = Math.max(lo, Math.min(hi, v.at));
      }
      save(pts);
    });

    const end = (): void => {
      if (!dragging) return;
      dragging = false;
      this.cb.onAfterChange();
      this.cb.onAudition(note);
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    addBtn.addEventListener("click", () => {
      const pts = points();
      if (pts.length >= MAX_CURVE_POINTS) return;
      // 제일 넓은 사이에 하나 끼운다. 어디에 생길지 예측할 수 있어야 한다.
      let gap = 0;
      let idx = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const d = pts[i].at - pts[i - 1].at;
        if (d > gap) {
          gap = d;
          idx = i;
        }
      }
      const at = (pts[idx].at + pts[idx - 1].at) / 2;
      const cents = Math.round((pts[idx].cents + pts[idx - 1].cents) / 2);
      this.cb.onBeforeChange();
      pts.splice(idx, 0, { at, cents });
      picked = idx;
      save(pts);
      this.cb.onAfterChange();
    });

    delBtn.addEventListener("click", () => {
      const pts = points();
      // 양 끝은 못 지운다. 지우면 곡선이 음 전체를 안 덮는다.
      if (picked <= 0 || picked >= pts.length - 1) return;
      this.cb.onBeforeChange();
      pts.splice(picked, 1);
      picked = -1;
      save(pts);
      this.cb.onAfterChange();
    });

    flatBtn.addEventListener("click", () => {
      this.cb.onBeforeChange();
      picked = -1;
      save(FLAT_CURVE.map((p) => ({ ...p })));
      this.cb.onAfterChange();
    });

    wrap.append(canvas, foot);
    // 창에 붙은 뒤라야 폭을 안다. 다음 프레임에 그린다.
    requestAnimationFrame(draw);
    return wrap;
  }

  /**
   * 꾸밈이 **음 안에서 언제** 일어나는가.
   *
   * 이게 없을 때는 꺾기가 언제나 음 길이의 45% 자리에서 났다. 8분음표에서는
   * 그게 맞는데 4박을 끄는 음에서는 안 맞는다 — "3박째에 꺾어라" 를 할 방법이
   * 없었다.
   *
   * **맨 왼쪽은 「자동」이다.** 값이 없는 것과 0 은 다르다 — 없으면 꾸밈마다
   * 알맞은 자리를 알아서 잡고(예전 그대로), 0 이면 음 맨 앞이다. 슬라이더로
   * 「값 없음」을 표현할 수 없어서 왼쪽 끝 한 칸을 그 자리로 뒀다.
   */
  private timingSlider(note: Note): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "mixslider";

    const text = document.createElement("span");
    text.textContent = "시점";

    const input = document.createElement("input");
    input.id = "note-at";
    input.type = "range";
    input.min = "-1";
    input.max = "100";
    input.step = "1";
    const at = atOf(note);
    input.value = at === null ? "-1" : String(Math.round(at * 100));

    const readout = document.createElement("i");
    const label = (v: number) => (v < 0 ? "자동" : `${v}%`);
    readout.textContent = label(Number(input.value));

    input.addEventListener("pointerdown", () => this.cb.onBeforeChange());
    input.addEventListener("input", () => {
      const v = Number(input.value);
      if (v < 0) delete note.ornamentAt;
      else note.ornamentAt = v / 100;
      readout.textContent = label(v);
      this.cb.onEdit();
    });
    input.addEventListener("change", () => {
      this.cb.onAfterChange();
      this.cb.onAudition(note);
    });

    wrap.append(text, input, readout);
    return wrap;
  }
}

function nameOf(pitch: number): string {
  const names = ["도", "도#", "레", "레#", "미", "파", "파#", "솔", "솔#", "라", "라#", "시"];
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function beatText(length: number): string {
  if (Math.abs(length - Math.round(length)) < 1e-6) return `${Math.round(length)}박`;
  return `${length.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}박`;
}
