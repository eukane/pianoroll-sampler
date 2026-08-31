/**
 * UTAU 음원으로 **노래하는** 트랙.
 *
 * 계산은 전부 `model/phrase.ts` 가 미리 해 둔다. 여기는 그 목록대로 노드를
 * 만들어 거는 일만 한다 — 그래서 숫자가 맞는지는 브라우저 없이 검사할 수 있고,
 * 이 파일은 얇게 유지된다.
 *
 * ## 왜 노트 하나씩이 아니라 줄 단위인가
 *
 * 다른 악기는 노트마다 따로 소리를 내면 된다. 노래는 안 된다 — 한 음의 소리가
 * **앞뒤 음에 달려 있다.**
 *
 *   · 소리는 박보다 먼저 시작한다 (선행발성)
 *   · 앞 음의 꼬리와 겹쳐 섞는다 (오버랩)
 *   · 앞 음이 무엇이었는지에 따라 다른 녹음을 쓴다 (「あ」 / 「- あ」 / 「* あ」)
 *
 * 그래서 `Instrument.play(노트 하나)` 로는 만들 수 없다. 줄을 통째로 받는다.
 *
 * ## 모음 반복
 *
 * 녹음보다 긴 음은 모음 구간을 `AudioBufferSourceNode` 의 loop 로 채운다.
 * 반복 지점에서 딸깍 소리가 날 수 있는데, 없애려면 구간을 겹쳐 섞으며 새
 * 버퍼를 만들어야 한다. 폰에서 노트마다 그 일을 하는 건 **실제로 거슬리는지
 * 듣고 나서** 정할 일이라 지금은 그대로 둔다.
 */

import { indexOto, parseOto, resolveSound, type OtoIndex } from "../model/oto";
import { frqNameFor, hzToMidi, readFrqAverage } from "../model/frq";
import { planPhrase, type PhrasePlan, type SungNote } from "../model/phrase";

/** oto.ini 는 Shift-JIS 다. 실제로 브라우저가 읽는 걸 확인했다. */
export function decodeOtoText(bytes: ArrayBuffer): string {
  return new TextDecoder("shift_jis").decode(bytes);
}

export class VoiceBank {
  readonly name: string;
  private index: OtoIndex;
  /** 파일명 → 디코딩된 소리. 쓰는 것만 넣는다. */
  private buffers = new Map<string, AudioBuffer>();
  /** 파일명 → 아직 디코딩 안 한 원본. */
  private raw = new Map<string, ArrayBuffer>();
  /** oto.ini 에서 못 읽은 줄. 조용히 버리지 않는다. */
  readonly skipped: string[];
  /** 파일명 → 그 파일이 녹음된 음정(MIDI). 주파수표에서 읽는다. */
  private pitches = new Map<string, number>();
  /** 지금 울리고 있는(또는 예약된) 소리들. 정지·다시예약 때 끊어야 한다. */
  private active: { source: AudioBufferSourceNode; gain: GainNode }[] = [];

  /**
   * zip 처럼 **아직 안 꺼낸** 파일을 나중에 꺼내 오는 길. 없으면 안 쓴다.
   *
   * WAV 를 통째로 들고 있지 않아도 되게 하려고 열어 둔 문이다. 테토 약음원
   * zip 은 91MB 라, 넣자마자 전부 풀면 폰이 못 버틴다.
   */
  private fetch: ((fileName: string) => Promise<ArrayBuffer | null>) | null;

  constructor(
    name: string,
    otoText: string,
    files: Map<string, ArrayBuffer>,
    fetch: ((fileName: string) => Promise<ArrayBuffer | null>) | null = null,
  ) {
    this.name = name;
    this.fetch = fetch;
    const parsed = parseOto(otoText);
    this.index = indexOto(parsed.entries);
    this.skipped = parsed.skipped;
    this.raw = files;

    // 주파수표는 작아서(2KB 남짓) 통째로 읽어도 부담이 없다. WAV 와 달리
    // 디코딩도 필요 없다. 파일마다 녹음된 음정이 달라서 이게 있어야 음이 맞는다.
    for (const [name, bytes] of files) {
      if (!name.toLowerCase().endsWith(".frq")) continue;
      const hz = readFrqAverage(bytes);
      if (hz !== null) this.pitches.set(name, hzToMidi(hz));
    }
  }

  /** 주파수표에서 읽은 음정이 있는 파일 수. 화면에 "음정 보정됨" 을 보여 줄 때. */
  get tunedCount(): number {
    return this.pitches.size;
  }

  get soundCount(): number {
    return this.index.size;
  }

  /** 이 음원이 낼 수 있는 소리들. 화면에서 "쓸 수 있는 글자" 를 보여 줄 때 쓴다. */
  get sounds(): string[] {
    return [...this.index.keys()];
  }

  /**
   * 이 글자를 부를 수 있는가. 꼬리표(「か」 → 「か囁」)까지 감안한다.
   * 화면이 "이 음원에 없는 소리" 를 띄울지 정하는 자리라, 여기가 틀리면
   * 멀쩡한 글자를 없다고 한다.
   */
  canSing(lyric: string): boolean {
    return resolveSound(this.index, lyric.trim()) !== null;
  }

  /**
   * 이 줄에 필요한 파일만 디코딩한다.
   *
   * UTAU 음원은 파일이 백 개가 넘는다. 폴더를 넣자마자 전부 디코딩하면 폰에서
   * 수백 MB 가 메모리에 올라간다. **부르는 글자만** 푼다.
   */
  async prepare(ctx: BaseAudioContext, lyrics: string[]): Promise<void> {
    const wanted = new Set<string>();
    for (const lyric of lyrics) {
      const key = resolveSound(this.index, lyric.trim() || "あ");
      for (const entry of (key === null ? [] : this.index.get(key) ?? [])) wanted.add(entry.fileName);
    }
    for (const fileName of wanted) {
      if (this.buffers.has(fileName)) continue;
      // 손에 든 게 없으면 그때 꺼내 온다 (zip 안에 있는 경우).
      const bytes = this.raw.get(fileName) ?? (this.fetch ? await this.fetch(fileName) : null);
      if (!bytes) continue;
      try {
        // decodeAudioData 는 넘긴 버퍼를 가져가 버린다. 다시 쓸 수 있게 복사해 준다.
        this.buffers.set(fileName, await ctx.decodeAudioData(bytes.slice(0)));
      } catch {
        /* 깨진 WAV 하나 때문에 나머지가 안 나오면 안 된다 */
      }
    }
  }

  /** 미리 푼 파일 길이. 계획을 세우는 쪽에 넘긴다. */
  private seconds = (fileName: string): number | undefined => this.buffers.get(fileName)?.duration;

  private pitchOf = (fileName: string): number | undefined => this.pitches.get(frqNameFor(fileName));

  /** 계산만 한다 (소리는 안 냄). 검사와 화면 표시에 쓴다. */
  plan(notes: SungNote[]): PhrasePlan {
    return planPhrase(notes, {
      index: this.index,
      fileSeconds: this.seconds,
      pitchOf: this.pitchOf,
    });
  }

  /**
   * 줄 하나를 예약한다. `at` 은 곡의 0초가 실제로 언제인가.
   *
   * 돌려주는 계획에는 **못 부른 글자**가 들어 있다. 화면이 그걸 사용자에게
   * 알려 줘야 한다 — 소리만 안 나면 왜 안 나는지 알 수가 없다.
   */
  sing(ctx: BaseAudioContext, dest: AudioNode, notes: SungNote[], at = 0): PhrasePlan {
    this.ctxTime = ctx.currentTime;
    const plan = this.plan(notes);

    for (const piece of plan.pieces) {
      const buffer = this.buffers.get(piece.fileName);
      if (!buffer) continue;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = piece.rate;
      if (piece.loop) {
        source.loop = true;
        source.loopStart = piece.loop.start;
        source.loopEnd = piece.loop.end;
      }

      const gain = ctx.createGain();
      const start = at + piece.startAt;
      const end = at + piece.endAt;

      // 페이드가 서로 잡아먹지 않게 자른다. 아주 짧은 음에서 뒤집히면
      // 소리가 아예 안 나거나 뚝 끊긴다.
      const room = Math.max(0.002, end - start);
      const fadeIn = Math.min(piece.fadeIn, room * 0.5);
      const fadeOut = Math.min(piece.fadeOut, room * 0.5);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(1, start + fadeIn);
      gain.gain.setValueAtTime(1, end - fadeOut);
      gain.gain.linearRampToValueAtTime(0, end);

      source.connect(gain);
      gain.connect(dest);
      source.start(start, piece.bufferOffset);
      source.stop(end + 0.02);

      const voice = { source, gain };
      this.active.push(voice);
      source.onended = () => {
        gain.disconnect();
        const i = this.active.indexOf(voice);
        if (i >= 0) this.active.splice(i, 1);
      };
    }

    return plan;
  }

  /**
   * 예약해 둔 것까지 전부 끊는다.
   *
   * 노래는 **곡이 시작할 때 줄을 통째로 예약**한다(재생 중에 한 음씩 넣는 게
   * 아니다). 그래서 정지하거나 노트를 고쳤을 때 예약된 걸 걷어내지 않으면,
   * 멈춘 뒤에도 계속 부르거나 옛 가사와 새 가사가 겹쳐 들린다.
   */
  stopAll(): void {
    const now = this.ctxTime ?? 0;
    for (const v of this.active) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
        v.gain.gain.linearRampToValueAtTime(0, now + 0.02);
        v.source.stop(now + 0.03);
      } catch {
        /* 아직 시작 안 했거나 이미 끝난 노드 */
        try {
          v.source.stop();
        } catch {
          /* 무시 */
        }
      }
    }
    this.active = [];
  }

  /** 정지할 때 쓸 현재 시각. sing() 이 불릴 때마다 갱신한다. */
  private ctxTime: number | null = null;
}
