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
import { amountOf, atOf, DEFAULT_AMOUNT, ORNAMENTS, type Ornament } from "../model/ornament";

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
    if ((note.ornament ?? "none") !== "none") {
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
