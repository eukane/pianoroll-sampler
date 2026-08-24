/**
 * 프로젝트 저장·불러오기 (JSON 파일 한 덩어리).
 *
 * localStorage 를 쓰지 않는다. 브라우저 데이터를 지우면 같이 날아가고, 폰에서
 * 만든 걸 컴퓨터로 옮길 수도 없다. **사용자가 손에 쥘 수 있는 파일**이어야 한다.
 *
 * 읽을 때는 남의 파일이라 치고 검사한다. 사람이 열어서 고칠 수 있는 형식이라
 * 오타가 들어오기 쉬운데, 조용히 넘기면 노트가 사라지거나 렌더가 깨진 채로
 * 진행된다. 무엇이 잘못됐는지 사람 말로 돌려준다.
 */

import type { Note, Project, Track } from "../model/types";
import { emptyTrack, newId, sortNotes } from "../model/project";
import { MAX_TRACKS } from "../model/channels";

export const FILE_VERSION = 1;

export function projectToJson(project: Project): string {
  return JSON.stringify({ version: FILE_VERSION, ...project }, null, 2);
}

export function projectFromJson(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("JSON 형식이 아닙니다. 이 앱에서 저장한 .json 파일인지 확인해 주세요.");
  }
  if (typeof raw !== "object" || raw === null) throw new Error("프로젝트 내용이 비어 있습니다.");

  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.tracks)) {
    throw new Error("트랙 목록이 없습니다. 프로젝트 파일이 아닌 것 같습니다.");
  }

  const tracks = (data.tracks as unknown[]).slice(0, MAX_TRACKS).map((t, i) => readTrack(t, i));

  return {
    bpm: clamp(num(data.bpm, 100), 20, 300),
    bars: Math.round(clamp(num(data.bars, 4), 1, 64)),
    timeSig: readTimeSig(data.timeSig),
    tracks: tracks.length > 0 ? tracks : [emptyTrack()],
  };
}

function readTrack(raw: unknown, index: number): Track {
  const t = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const track = emptyTrack(typeof t.name === "string" && t.name ? t.name : `트랙 ${index + 1}`);

  const source = t.source as Record<string, unknown> | undefined;
  if (source?.kind === "sampleFolder" && typeof source.folderId === "string") {
    track.source = { kind: "sampleFolder", folderId: source.folderId };
  } else {
    track.source = { kind: "sf2", presetId: Math.round(clamp(num(source?.presetId, 0), 0, 16383)) };
  }

  track.volume = clamp(num(t.volume, 0.8), 0, 1);
  track.pan = clamp(num(t.pan, 0), -1, 1);
  track.muted = t.muted === true;
  // 예전에 저장한 파일에는 없는 값이다. 없으면 울림 0.
  track.reverbSend = clamp(num(t.reverbSend, 0), 0, 1);
  track.notes = Array.isArray(t.notes) ? (t.notes as unknown[]).map(readNote).filter(isNote) : [];
  sortNotes(track);
  return track;
}

function readNote(raw: unknown): Note | null {
  if (typeof raw !== "object" || raw === null) return null;
  const n = raw as Record<string, unknown>;
  const pitch = Math.round(num(n.pitch, -1));
  const start = num(n.start, -1);
  const length = num(n.length, 0);
  // 말이 안 되는 노트는 버린다. 길이가 0 이하면 소리가 안 나고, 음높이가
  // 범위를 벗어나면 렌더에서 터진다.
  if (pitch < 0 || pitch > 127 || start < 0 || length <= 0) return null;
  return {
    id: typeof n.id === "string" && n.id ? n.id : newId("n"),
    pitch,
    start,
    length,
    velocity: Math.round(clamp(num(n.velocity, 100), 1, 127)),
  };
}

function isNote(n: Note | null): n is Note {
  return n !== null;
}

function readTimeSig(raw: unknown): [number, number] {
  if (Array.isArray(raw) && raw.length === 2) {
    const num0 = Math.round(clamp(num(raw[0], 4), 1, 32));
    const den = Math.round(clamp(num(raw[1], 4), 1, 32));
    // 분모는 2의 거듭제곱만 말이 된다 (4분음표, 8분음표…)
    const pow = 2 ** Math.round(Math.log2(den));
    return [num0, pow];
  }
  return [4, 4];
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
