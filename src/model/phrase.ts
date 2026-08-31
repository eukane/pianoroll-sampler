/**
 * 노랫말이 붙은 노트들을 **어떻게 이어 부를지** 계산한다.
 *
 * 여기는 소리를 내지 않는다. "몇 초에, 버퍼의 어디부터, 얼마나 빠르게, 어디를
 * 반복하며, 언제까지" 를 적은 목록만 만든다. 그래야 브라우저 없이 검사할 수
 * 있다 — 이어붙이기는 숫자가 조금만 어긋나도 "왜 이 글자만 짧지" 가 되는데,
 * 그건 귀로 잡기 아주 어렵다.
 *
 * ## 선행발성 — 소리는 박보다 **먼저** 시작한다
 *
 * 「か」는 'k' 를 먼저 뱉고 'a' 가 나온다. 박에 맞아야 하는 건 'a' 쪽이다.
 * oto.ini 의 `preutter` 가 그 지점이라, 소리 자체는 박보다 그만큼 앞서 시작한다.
 *
 *     박(노트 시작) ────────────────┐
 *     소리 시작 ──┐                 │
 *                 │←─ preutter ─→│
 *                 [ k ][ ----- a ----- ]
 *
 * ## 겹침 — 앞 음과 섞는다
 *
 * `overlap` 만큼 앞 음의 꼬리와 새 음의 머리를 겹쳐 섞으면 이음새가 덜 들린다.
 * **음수인 설정이 실제로 있다**(테토 단독음의 「- か」는 -10ms). 그건 겹치지
 * 말고 그만큼 **떼어 놓으라**는 뜻이라, 그때는 앞 음을 먼저 끝낸다.
 *
 * ## 모음 늘이기
 *
 * 녹음은 1초 남짓인데 2초짜리 음을 부르라고 하면 모자란다. 자음 구간
 * (`consonant`)은 **절대 늘이지 않는다** — 늘이면 「카」가 「크아」가 된다.
 * 그 뒤 모음 구간만 반복해서 채운다.
 *
 * 반복 지점에서 딸깍 소리가 날 수 있다. 지금은 그대로 둔다 — 없애려면 구간을
 * 겹쳐 섞으며 새 버퍼를 만들어야 하는데, 폰에서 노트마다 그 일을 하는 건
 * 나중에 실제로 거슬리는지 듣고 정할 일이다.
 *
 * ## 음정
 *
 * 재생 속도를 바꿔 음을 옮긴다. 속도가 바뀌면 **선행발성·겹침도 같이 빨라진다**
 * — 초 단위로 쓸 때 그만큼 나눠 줘야 자리가 맞는다. 여기서 제일 틀리기 쉬운
 * 자리다.
 *
 * 기준이 되는 "녹음된 음정" 은 **파일마다 다르다.** 사람이 부른 녹음이라
 * 음절마다 조금씩 어긋나 있고, 한 값으로 뭉뚱그리면 어떤 글자만 음이 틀린다.
 * 음원에 같이 든 주파수표에서 읽어 쓴다 (model/frq.ts).
 */

import { pickEntry, regionOf, vowelOf, type OtoIndex } from "./oto.ts";

/**
 * 이 음원이 녹음된 음높이 (MIDI 번호).
 *
 * oto.ini 에는 안 적혀 있어서 **소리에서 직접 쟀다.** 테토 단독음의 모음·비음
 * 여덟 개를 자기상관으로 재니 62.7~63.0 으로 일정했다 (약 311Hz).
 * 음원을 바꾸면 이 값도 다시 재야 한다.
 */
export const DEFAULT_RECORDED_PITCH = 63;

/** 앞 음과 이만큼 이상 벌어져 있으면 "쉬었다" 로 보고 처음부터 부른다(초). */
const REST_GAP = 0.08;

/** 마지막 음이 뚝 끊기지 않게 남기는 여운(초). */
export const RELEASE = 0.06;

/** 이보다 짧은 구간은 반복해 봐야 딸깍거리기만 한다(초). */
const MIN_LOOP = 0.05;

/** 겹침이 없을 때 머리에 넣는 아주 짧은 페이드(초). 없으면 '틱' 한다. */
const CLICK_GUARD = 0.005;

export type SungNote = {
  id: string;
  pitch: number;
  /** 곡 시작부터 몇 초인가. */
  startSec: number;
  /** 길이(초). */
  lengthSec: number;
  /** 노랫말 한 글자(또는 한 소리). 비어 있으면 앞 음의 모음을 이어 부른다. */
  lyric: string;
};

/** 이 음을 실제로 어떻게 낼 것인가. 시간은 전부 초, 곡 시작 기준. */
export type PhrasePiece = {
  noteId: string;
  fileName: string;
  alias: string;
  /** 소리를 시작하는 시각. 노트 시작보다 **앞선다**(선행발성). */
  startAt: number;
  /** 버퍼의 어디부터 읽는가. */
  bufferOffset: number;
  /** 재생 속도(=음정). 1 이면 녹음 그대로. */
  rate: number;
  /** 모음을 반복할 구간(버퍼 기준 초). 안 늘여도 되면 null. */
  loop: { start: number; end: number } | null;
  /** 머리에서 소리를 키우는 시간. 앞 음과 겹쳐 섞는 구간이기도 하다. */
  fadeIn: number;
  /** 소리를 끝내는 시각. */
  endAt: number;
  /** 끝에서 소리를 줄이는 시간. */
  fadeOut: number;
};

export type PlanOptions = {
  index: OtoIndex;
  /** 파일명 → 길이(초). 디코딩해 봐야 아는 값이라 밖에서 넣어 준다. */
  fileSeconds: (fileName: string) => number | undefined;
  /**
   * 파일명 → **그 파일이 실제로 녹음된 음정**(MIDI, 소수 허용).
   *
   * 음원 전체를 한 값으로 뭉뚱그리면 어떤 글자만 음정이 틀린다. 실제로
   * 테토 단독음의 「さ」는 다른 글자보다 거의 반음 낮게 녹음돼 있다.
   * 주파수표(model/frq.ts)에서 읽어 넣는다. 없으면 아래 기본값.
   */
  pitchOf?: (fileName: string) => number | undefined;
  recordedPitch?: number;
};

export type PhrasePlan = {
  pieces: PhrasePiece[];
  /** 음원에 없어서 못 부른 노랫말. **조용히 빼먹지 않는다.** */
  missing: { noteId: string; lyric: string }[];
};

/** 노랫말이 비었을 때 쓸 소리. */
const DEFAULT_LYRIC = "あ";

export function planPhrase(notes: SungNote[], options: PlanOptions): PhrasePlan {
  const recorded = options.recordedPitch ?? DEFAULT_RECORDED_PITCH;
  const sorted = [...notes].sort((a, b) => a.startSec - b.startSec);

  const pieces: PhrasePiece[] = [];
  const missing: { noteId: string; lyric: string }[] = [];

  // 앞 음의 모음. 이어지는 소리를 고를 때 쓴다. 쉬면 null 로 돌아간다.
  let prevVowel: string | null = null;
  let prevEnd = -Infinity;

  for (const note of sorted) {
    const lyric = (note.lyric || "").trim() || DEFAULT_LYRIC;
    const linked = note.startSec - prevEnd < REST_GAP;
    const entry = pickEntry(options.index, lyric, linked ? prevVowel : null);
    if (!entry) {
      missing.push({ noteId: note.id, lyric });
      // 못 부른 음에서 이어짐이 끊긴다. 다음 음은 처음부터 부른다.
      prevVowel = null;
      prevEnd = -Infinity;
      continue;
    }
    const seconds = options.fileSeconds(entry.fileName);
    if (seconds === undefined || !(seconds > 0)) {
      missing.push({ noteId: note.id, lyric });
      prevVowel = null;
      prevEnd = -Infinity;
      continue;
    }

    const from = options.pitchOf?.(entry.fileName) ?? recorded;
    const rate = 2 ** ((note.pitch - from) / 12);
    // 속도를 바꾸면 선행발성·겹침도 같이 빨라진다. 초로 쓸 땐 나눠 준다.
    const preutterSec = entry.preutter / 1000 / rate;
    const overlapSec = entry.overlap / 1000 / rate;

    const startAt = Math.max(0, note.startSec - preutterSec);
    const region = regionOf(entry, seconds);
    const noteEnd = note.startSec + note.lengthSec;

    // 앞 음을 언제 끝낼지. 겹침이 있으면 그만큼 물고 있고, 음수면 먼저 뗀다.
    const previous = pieces[pieces.length - 1];
    if (previous && linked) {
      if (overlapSec > 0) {
        previous.endAt = Math.max(previous.startAt + CLICK_GUARD, startAt + overlapSec);
        previous.fadeOut = overlapSec;
      } else {
        previous.endAt = Math.max(previous.startAt + CLICK_GUARD, startAt + overlapSec);
        previous.fadeOut = CLICK_GUARD;
      }
    }

    const fadeIn = linked && overlapSec > 0 ? overlapSec : CLICK_GUARD;

    // 모자라면 모음을 반복해 채운다. 자음 구간은 건드리지 않는다.
    const needSec = noteEnd + RELEASE - startAt;
    const availSec = (region.end - region.start) / rate;
    const loopStart = region.start + entry.consonant / 1000;
    const canLoop = region.end - loopStart > MIN_LOOP;
    const loop = needSec > availSec && canLoop ? { start: loopStart, end: region.end } : null;

    pieces.push({
      noteId: note.id,
      fileName: entry.fileName,
      alias: entry.alias,
      startAt,
      bufferOffset: region.start,
      rate,
      loop,
      fadeIn,
      // 다음 음이 들어오면 위에서 다시 잡는다.
      endAt: loop ? noteEnd + RELEASE : Math.min(noteEnd + RELEASE, startAt + availSec),
      fadeOut: RELEASE,
    });

    prevVowel = vowelOf(lyric);
    prevEnd = noteEnd;
  }

  return { pieces, missing };
}
