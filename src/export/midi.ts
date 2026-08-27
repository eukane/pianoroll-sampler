/**
 * 프로젝트 ↔ 표준 MIDI 파일 (SMF 포맷 1).
 *
 * 이 파일이 M3 의 중심이다. **MIDI 내보내기와 WAV 내보내기가 둘 다 여기를
 * 거친다.** 샘플러의 오프라인 렌더가 MIDI 시퀀스를 받기 때문인데, 덕분에
 * 내려받은 .mid 와 뽑아낸 .wav 가 **같은 바이트에서 나온 결과**라는 게
 * 보장된다. 둘이 어긋날 여지가 없다.
 *
 * 직접 쓴 이유는 두 가지다.
 *   · 스펙이 "포맷 1, 트랙당 1채널" 을 못박았다. 남의 구현에 맡기면 확인이 어렵다
 *   · 읽기·쓰기가 대칭이라 **브라우저 없이** 왕복 테스트가 된다
 *     (scripts/midi-roundtrip.mjs)
 *
 * 시간 단위: 프로젝트는 박(beat), MIDI 는 틱(tick). PPQ 로 환산한다.
 */

// 확장자를 붙여 적는다. Node 의 ESM 은 확장자를 생략하면 못 찾는데, 이 모듈은
// 브라우저 없이 테스트해야 해서(scripts/midi-roundtrip.mjs) Node 에서도 그대로
// import 되어야 한다. Vite 는 양쪽 다 받는다.
import type { Note, Project, Track } from "../model/types";
import { beatsPerBar, emptyTrack, makeNote, sortNotes } from "../model/project.ts";
import { assignChannels, MAX_TRACKS } from "../model/channels.ts";
import { packPresetId, unpackPresetId } from "../model/preset.ts";
import { shakes, VIBRATO_FADE, vibratoOf } from "../audio/vibrato.ts";

/** 4분음표 하나를 몇 틱으로 볼지. 480 은 DAW 들이 흔히 쓰는 값이다. */
export const PPQ = 480;

// -------------------------------------------------------------------- 쓰기

class ByteWriter {
  private bytes: number[] = [];

  u8(v: number): void {
    this.bytes.push(v & 0xff);
  }

  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }

  u32(v: number): void {
    this.u8(v >> 24);
    this.u8(v >> 16);
    this.u8(v >> 8);
    this.u8(v);
  }

  str(text: string): void {
    for (const ch of text) this.u8(ch.charCodeAt(0));
  }

  raw(values: number[]): void {
    for (const v of values) this.u8(v);
  }

  /** 가변 길이 수치. MIDI 의 델타 타임 표기법. */
  varint(value: number): void {
    let v = Math.max(0, Math.round(value));
    const stack = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      stack.push((v & 0x7f) | 0x80);
      v >>= 7;
    }
    this.raw(stack.reverse());
  }

  get length(): number {
    return this.bytes.length;
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const w = new ByteWriter();
  w.str(id);
  w.u32(body.length);
  const head = w.toBytes();
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

type Event = { tick: number; order: number; data: number[] };

export type MidiOptions = {
  /**
   * 트랙 음량·팬을 CC7/CC10 으로 실어 보낼지.
   *
   * **파일로 내보낼 때는 실어야 하고, 우리 렌더에 먹일 때는 실으면 안 된다.**
   *
   * 우리 렌더는 신스 출력을 믹서로 받아서 거기서 음량·팬을 건다. 그런데 MIDI 에
   * CC7 을 같이 실으면 신스가 **한 번 더** 줄인다. 게다가 GM 의 CC7 은 제곱
   * 곡선이라 결과가 세제곱으로 줄어든다. 실측이 정확히 그랬다.
   *
   *     볼륨 0.5 → 렌더 피크가 0.127배   (0.5³ = 0.125)
   *     볼륨 0.25 → 0.016배              (0.25³ = 0.0156)
   *
   * 기본값인 볼륨 0.8 에서 WAV 가 재생의 절반 음량으로 나갔다. "들을 때는
   * 괜찮았는데 파일로 뽑으니 다르다" 가 되는 전형적인 자리다.
   */
  includeMixer?: boolean;
};

/**
 * 프로젝트를 SMF 포맷 1 로 쓴다.
 *
 * 포맷 1 은 "트랙 여러 개를 동시에 재생" 이라는 뜻이고, 첫 트랙에 템포·박자를
 * 몰아 넣는 게 관례다. FL Studio Mobile 을 포함해 대부분의 DAW 가 이걸 기대한다.
 */
export function projectToMidi(project: Project, options: MidiOptions = {}): Uint8Array {
  const includeMixer = options.includeMixer !== false;
  const tracks: Uint8Array[] = [];

  // 0번 트랙: 템포와 박자만. 노트는 없다.
  const tempo = new ByteWriter();
  const usPerQuarter = Math.round(60_000_000 / Math.max(1, project.bpm));
  tempo.varint(0);
  tempo.raw([0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff]);
  tempo.varint(0);
  // 분모는 2의 지수로 적는다 (4 → 2, 8 → 3).
  const [num, den] = project.timeSig;
  tempo.raw([0xff, 0x58, 0x04, num, Math.round(Math.log2(den)), 24, 8]);
  tempo.varint(0);
  tempo.raw([0xff, 0x2f, 0x00]); // 트랙 끝
  tracks.push(chunk("MTrk", tempo.toBytes()));

  const channels = assignChannels(project);
  project.tracks.forEach((track, index) => {
    tracks.push(chunk("MTrk", writeTrack(track, channels[index], includeMixer, project.bpm)));
  });

  const header = new ByteWriter();
  header.u16(1); // 포맷 1
  header.u16(tracks.length);
  header.u16(PPQ);

  const parts = [chunk("MThd", header.toBytes()), ...tracks];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function writeTrack(
  track: Track,
  channel: number,
  includeMixer: boolean,
  bpm: number,
): Uint8Array {
  const events: Event[] = [];

  // 트랙 이름 (다른 DAW 에서 트랙 목록에 뜬다)
  const nameBytes = [...new TextEncoder().encode(track.name)];
  events.push({ tick: 0, order: 0, data: [0xff, 0x03, nameBytes.length, ...nameBytes] });

  if (track.source.kind === "sf2") {
    const { bankMSB, program, isDrum } = unpackPresetId(track.source.presetId);
    // 드럼은 9번 채널이라는 것 자체가 규약이다. 뱅크를 보내면 오히려 어긋난다.
    if (!isDrum) {
      events.push({ tick: 0, order: 1, data: [0xb0 | channel, 0, bankMSB] });
      events.push({ tick: 0, order: 2, data: [0xb0 | channel, 32, 0] });
    }
    events.push({ tick: 0, order: 3, data: [0xc0 | channel, program] });
  }

  // 볼륨·팬은 **파일로 내보낼 때만** 싣는다. 다른 DAW 에서 열었을 때 균형이
  // 유지되어야 하기 때문이다. 우리 렌더에 먹일 때는 믹서가 이미 걸고 있어서
  // 여기서 또 실으면 두 번 줄어든다 (MidiOptions 주석 참고).
  if (includeMixer) {
    events.push({ tick: 0, order: 4, data: [0xb0 | channel, 7, clamp7(track.volume * 127)] });
    events.push({ tick: 0, order: 5, data: [0xb0 | channel, 10, clamp7((track.pan + 1) * 63.5)] });
  }

  // 떨림(CC1)은 **언제나** 싣는다. 볼륨·팬과 달리 우리 렌더에서 따로 거는
  // 데가 없어서, 여기서 빼면 뽑아낸 WAV 에만 떨림이 사라진다.
  const vib = vibratoOf(track);
  const secToTick = (sec: number) => Math.round((sec * Math.max(1, bpm) * PPQ) / 60);
  if (vib.depth > 0 && vib.delay === 0) {
    events.push({ tick: 0, order: 4, data: [0xb0 | channel, 1, clamp7(vib.depth * 127)] });
  }

  let vibBusyUntil = -1;
  for (const note of track.notes) {
    const on = Math.round(note.start * PPQ);
    const off = Math.round((note.start + note.length) * PPQ);
    if (vib.delay > 0) {
      // 재생과 같은 규칙: 앞 음이 아직 울리는 중이면 0 으로 되돌리지 않는다
      // (audio/soundfont.ts 의 scheduleVibrato 와 짝이다).
      const overlapping = on < vibBusyUntil;
      const seconds = (note.length * 60) / Math.max(1, bpm);
      if (!overlapping) events.push({ tick: on, order: 5, data: [0xb0 | channel, 1, 0] });
      if (shakes(vib, seconds)) {
        const full = clamp7(vib.depth * 127);
        for (const step of [1 / 3, 2 / 3, 1]) {
          events.push({
            tick: on + secToTick(vib.delay + VIBRATO_FADE * step),
            order: 5,
            data: [0xb0 | channel, 1, clamp7(full * step)],
          });
        }
      }
      vibBusyUntil = Math.max(vibBusyUntil, off);
    }
    const velocity = clamp7(note.velocity);
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    // 같은 틱에서는 노트 오프가 먼저다. 안 그러면 같은 음을 이어 칠 때
    // 뒤 노트의 온이 먼저 나가고 앞 노트의 오프가 그걸 꺼버린다.
    events.push({ tick: off, order: 6, data: [0x80 | channel, pitch, 0] });
    events.push({ tick: on, order: 7, data: [0x90 | channel, pitch, velocity] });
  }

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const w = new ByteWriter();
  let last = 0;
  for (const ev of events) {
    w.varint(ev.tick - last);
    w.raw(ev.data);
    last = ev.tick;
  }
  w.varint(0);
  w.raw([0xff, 0x2f, 0x00]);
  return w.toBytes();
}

function clamp7(v: number): number {
  return Math.max(0, Math.min(127, Math.round(v)));
}

// -------------------------------------------------------------------- 읽기

class ByteReader {
  at = 0;
  // 생성자 파라미터 프로퍼티를 안 쓴다. Node 의 타입 제거 모드가 그 문법을
  // 지원하지 않아서, 그대로 두면 브라우저 없이 테스트를 못 돌린다.
  private view: DataView;

  constructor(view: DataView) {
    this.view = view;
  }

  get done(): boolean {
    return this.at >= this.view.byteLength;
  }

  u8(): number {
    return this.view.getUint8(this.at++);
  }

  u16(): number {
    const v = this.view.getUint16(this.at);
    this.at += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.at);
    this.at += 4;
    return v;
  }

  str(n: number): string {
    let out = "";
    for (let i = 0; i < n; i += 1) out += String.fromCharCode(this.u8());
    return out;
  }

  varint(): number {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return value;
  }
}

type PendingNote = { pitch: number; startTick: number; velocity: number };

/**
 * .mid 를 읽어 프로젝트로. 다른 DAW 에서 찍은 걸 여기서 **악기만 바꾸려는**
 * 용도라, 노트와 템포·악기만 가져오고 나머지는 버린다.
 *
 * 포맷 0(모든 채널이 한 트랙에 섞여 있음)도 받는다. 채널별로 갈라서 트랙을
 * 만든다 — 안 그러면 FL Studio Mobile 에서 나온 파일 절반이 안 열린다.
 */
export function midiToProject(bytes: Uint8Array): Project {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r = new ByteReader(view);

  if (r.str(4) !== "MThd") throw new Error("MIDI 파일이 아닙니다 (MThd 헤더가 없습니다)");
  const headerLength = r.u32();
  const headerEnd = r.at + headerLength;
  r.u16(); // 포맷 — 0/1 둘 다 같은 방식으로 훑는다
  const trackCount = r.u16();
  const division = r.u16();
  r.at = headerEnd;

  if (division & 0x8000) {
    throw new Error("SMPTE 시간 단위의 MIDI 는 아직 읽지 못합니다");
  }
  const ppq = division || PPQ;

  let bpm = 120;
  let timeSig: [number, number] = [4, 4];
  /** MIDI 채널 → 노트 목록. 채널이 곧 악기라 이 단위로 트랙을 만든다. */
  const byChannel = new Map<number, { notes: Note[]; name: string; program: number; bankMSB: number }>();

  const lane = (channel: number) => {
    let l = byChannel.get(channel);
    if (!l) {
      l = { notes: [], name: "", program: 0, bankMSB: 0 };
      byChannel.set(channel, l);
    }
    return l;
  };

  for (let t = 0; t < trackCount && !r.done; t += 1) {
    const id = r.str(4);
    const length = r.u32();
    const end = r.at + length;
    if (id !== "MTrk") {
      r.at = end;
      continue;
    }

    let tick = 0;
    let running = 0;
    let trackName = "";
    const pending = new Map<number, PendingNote[]>();

    while (r.at < end) {
      tick += r.varint();
      let status = r.u8();
      if (status < 0x80) {
        // 러닝 스테이터스: 상태 바이트를 생략하고 데이터만 보낸다
        r.at -= 1;
        status = running;
      } else if (status < 0xf0) {
        running = status;
      }

      if (status === 0xff) {
        const type = r.u8();
        const len = r.varint();
        const from = r.at;
        if (type === 0x51 && len === 3) {
          const us = (r.u8() << 16) | (r.u8() << 8) | r.u8();
          if (us > 0) bpm = Math.round(60_000_000 / us);
        } else if (type === 0x58 && len >= 2) {
          timeSig = [r.u8(), 2 ** r.u8()];
        } else if (type === 0x03) {
          trackName = new TextDecoder().decode(bytes.subarray(from, from + len));
        }
        r.at = from + len;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        r.at += r.varint();
        continue;
      }

      const channel = status & 0x0f;
      const kind = status & 0xf0;

      if (kind === 0x90 || kind === 0x80) {
        const pitch = r.u8();
        const velocity = r.u8();
        const queue = pending.get(pitch) ?? [];
        // 벨로시티 0 인 노트 온은 노트 오프와 같은 뜻이다 (러닝 스테이터스 관습)
        if (kind === 0x90 && velocity > 0) {
          queue.push({ pitch, startTick: tick, velocity });
          pending.set(pitch, queue);
        } else {
          const started = queue.shift();
          pending.set(pitch, queue);
          if (started) {
            const l = lane(channel);
            const beats = (tick - started.startTick) / ppq;
            if (beats > 0) {
              l.notes.push(makeNote(pitch, started.startTick / ppq, beats, started.velocity));
            }
            if (trackName && !l.name) l.name = trackName;
          }
        }
      } else if (kind === 0xc0) {
        lane(channel).program = r.u8();
      } else if (kind === 0xb0) {
        const cc = r.u8();
        const value = r.u8();
        if (cc === 0) lane(channel).bankMSB = value;
      } else if (kind === 0xa0 || kind === 0xe0) {
        r.at += 2;
      } else if (kind === 0xd0) {
        r.at += 1;
      }
    }
    r.at = end;
  }

  const lanes = [...byChannel.entries()]
    .filter(([, l]) => l.notes.length > 0)
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_TRACKS);

  const tracks: Track[] = lanes.map(([channel, l], i) => {
    const track = emptyTrack(l.name || `트랙 ${i + 1}`);
    // 9번 채널에서 온 노트는 드럼이다 (GM 규약).
    track.source = { kind: "sf2", presetId: packPresetId(l.bankMSB, l.program, channel === 9) };
    track.notes = l.notes;
    sortNotes(track);
    // 드럼 채널에서 온 노트라는 걸 이름에 남긴다. 지금은 드럼 재생을 안 하지만
    // 사용자가 왜 소리가 이상한지는 알 수 있어야 한다.
    if (channel === 9 && !l.name) track.name = "드럼";
    return track;
  });

  const project: Project = {
    bpm,
    bars: 4,
    timeSig,
    tracks: tracks.length > 0 ? tracks : [emptyTrack()],
  };

  // 마디 수는 제일 늦게 끝나는 노트에 맞춘다.
  const lastBeat = Math.max(
    0,
    ...project.tracks.flatMap((t) => t.notes.map((n) => n.start + n.length)),
  );
  project.bars = Math.max(1, Math.ceil(lastBeat / beatsPerBar(project)));
  return project;
}
