/**
 * 기록 백업 (순수).
 *
 * 연습 기록은 이 브라우저(localStorage)에만 있다. 브라우저 데이터를 지우거나 기기를 바꾸면 사라지므로
 * 파일로 내보냈다가 다시 불러올 수 있게 한다. 묶음에는
 *   · 귀 훈련 기록 (pianoroll.ear)
 *   · 키 옮기기 기록 (pianoroll.transpose)
 *   · 코드 따기 수첩 (파일마다 pianoroll.copy:이름:크기)
 * 이 들어간다. **불러올 때는 내용을 믿지 않고** 각자의 sanitize 를 다시 거쳐 걸러낸다.
 */

import { sanitizeState as sanitizeCopy, type CopyState } from "./copyNotebook.ts";
import { sanitizeStore as sanitizeEar, type EarStore } from "./earStats.ts";
import { TRANSPOSE_KEY, sanitizeTransposeStore, type TransposeStore } from "./transpose.ts";

export const EAR_KEY = "pianoroll.ear";
export const COPY_PREFIX = "pianoroll.copy:";
const MAX_COPY_FILES = 200;

export type Backup = {
  app: "pianoroll-sampler";
  version: 1;
  exportedAt: string;
  ear?: unknown;
  transpose?: unknown;
  copy?: Record<string, unknown>;
};

type ReadStorage = Pick<Storage, "length" | "key" | "getItem">;
type WriteStorage = Pick<Storage, "setItem">;

function readJson(storage: ReadStorage, key: string): unknown {
  try {
    const t = storage.getItem(key);
    return t === null ? undefined : JSON.parse(t);
  } catch {
    return undefined;
  }
}

export function makeBackup(storage: ReadStorage, now: Date): Backup {
  const b: Backup = { app: "pianoroll-sampler", version: 1, exportedAt: now.toISOString() };
  const ear = readJson(storage, EAR_KEY);
  if (ear !== undefined) b.ear = ear;
  const tr = readJson(storage, TRANSPOSE_KEY);
  if (tr !== undefined) b.transpose = tr;
  const copy: Record<string, unknown> = {};
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k && k.startsWith(COPY_PREFIX)) {
      const v = readJson(storage, k);
      if (v !== undefined) copy[k] = v;
    }
  }
  if (Object.keys(copy).length) b.copy = copy;
  return b;
}

export type ParsedBackup =
  | { ok: true; ear?: EarStore; transpose?: TransposeStore; copy: Record<string, CopyState>; summary: string }
  | { ok: false; error: string };

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON 파일이 아닙니다 (내보내기로 만든 .json 파일을 고르세요)" };
  }
  if (typeof raw !== "object" || raw === null || (raw as Backup).app !== "pianoroll-sampler") {
    return { ok: false, error: "이 앱에서 내보낸 백업 파일이 아닙니다" };
  }
  const b = raw as Backup;
  if (b.version !== 1) return { ok: false, error: `지원하지 않는 백업 버전입니다 (${String(b.version)})` };
  const out: { ear?: EarStore; transpose?: TransposeStore; copy: Record<string, CopyState> } = { copy: {} };
  if (b.ear !== undefined) out.ear = sanitizeEar(b.ear);
  if (b.transpose !== undefined) out.transpose = sanitizeTransposeStore(b.transpose);
  if (typeof b.copy === "object" && b.copy !== null) {
    for (const [k, v] of Object.entries(b.copy).slice(0, MAX_COPY_FILES)) {
      if (k.startsWith(COPY_PREFIX) && k.length < 300) out.copy[k] = sanitizeCopy(v);
    }
  }
  const parts: string[] = [];
  if (out.ear) parts.push("귀 훈련 기록");
  if (out.transpose) parts.push("키 옮기기 기록");
  const n = Object.keys(out.copy).length;
  if (n) parts.push(`코드 수첩 ${n}곡`);
  if (parts.length === 0) return { ok: false, error: "백업 파일 안에 가져올 기록이 없습니다" };
  return { ok: true, ...out, summary: parts.join(" · ") };
}

/** 걸러진 내용을 저장소에 쓴다. 파일에 들어 있던 항목만 덮어쓰고 나머지는 건드리지 않는다. */
export function applyBackup(storage: WriteStorage, p: Extract<ParsedBackup, { ok: true }>): void {
  if (p.ear) storage.setItem(EAR_KEY, JSON.stringify(p.ear));
  if (p.transpose) storage.setItem(TRANSPOSE_KEY, JSON.stringify(p.transpose));
  for (const [k, v] of Object.entries(p.copy)) storage.setItem(k, JSON.stringify(v));
}
