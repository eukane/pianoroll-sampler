/**
 * 시험용 **일본어 이름 zip** 을 만든다.
 *
 * 왜 이게 필요한가. 사용자가 받은 테토 음원 zip 이 폰에서 안 풀렸다 —
 * "폴더에 문제가 있어 추출할 수 없다". 원인은 파일 이름이다. 일본에서 만든
 * zip 은 이름이 **CP932(Shift-JIS)** 로 들어 있고, UTF-8 로만 읽는 압축
 * 프로그램은 「重音テト単独音」을 깨뜨린 뒤 그 경로를 못 만들어 멈춘다.
 *
 * 그래서 검사용 zip 도 **실물과 같은 방식으로**, 즉 이름을 CP932 로 넣어
 * 만든다. UTF-8 로 만든 zip 만 통과시키는 검사는 이 버그를 못 잡는다.
 * 비교하려고 UTF-8 판(플래그 11번 비트를 세운 것)도 같이 만든다.
 *
 *     node scripts/gen-voicezip.mjs   →  fixtures/voice-cp932.zip, fixtures/voice-utf8.zip
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";

const SRC = "fixtures/voicebank";
/** 실물 배포본과 같은 모양으로 폴더 하나를 감싼다. */
export const DIR = "重音テト単独音";

/**
 * CP932 로 인코딩한다. Node 에는 인코더가 없어서 **디코더로 표를 거꾸로**
 * 만든다. 표를 손으로 박아 넣는 것보다 정직하다 — 실제로 브라우저·Node 가
 * 읽는 그 표를 그대로 쓰게 된다.
 */
function cp932Table() {
  const dec = new TextDecoder("shift_jis", { fatal: false });
  const map = new Map();
  for (let b = 0x20; b < 0x80; b += 1) map.set(String.fromCharCode(b), [b]);
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xfc; lead += 1) {
    for (let trail = 0x40; trail <= 0xfc; trail += 1) {
      pair[0] = lead;
      pair[1] = trail;
      const ch = dec.decode(pair);
      if (ch.length !== 1 || ch === "�") continue;
      if (!map.has(ch)) map.set(ch, [lead, trail]);
    }
  }
  return map;
}

const TABLE = cp932Table();

function cp932(text) {
  const out = [];
  for (const ch of text) {
    const bytes = TABLE.get(ch);
    if (!bytes) throw new Error(`CP932 로 못 적는 글자: ${ch}`);
    out.push(...bytes);
  }
  return Buffer.from(out);
}

/** 파일 목록 → zip 바이트. utf8 이면 이름을 UTF-8 로 넣고 플래그 11번 비트를 세운다. */
export function makeZip(files, { utf8 = false, store = new Set() } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { path, data } of files) {
    const name = utf8 ? Buffer.from(path, "utf8") : cp932(path);
    const flags = utf8 ? 0x800 : 0;
    const method = store.has(path) ? 0 : 8;
    const body = method === 0 ? data : deflateRawSync(data);
    const sum = crc32(data);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(flags, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt32LE(sum, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    locals.push(head, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(flags, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += head.length + name.length + body.length;
  }

  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, dirBytes, end]);
}

/** 검사용 음원 파일 목록. `fixtures/voicebank` 가 있어야 한다. */
export function voiceFiles() {
  if (!existsSync(SRC)) throw new Error(`${SRC} 가 없습니다. 먼저 npm run gen-voicebank`);
  const files = [];
  for (const name of readdirSync(SRC).sort()) {
    files.push({ path: `${DIR}/${name}`, data: readFileSync(join(SRC, name)) });
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = voiceFiles();
  // WAV 하나는 압축 없이 넣는다. 실물 zip 도 이미 압축된 파일은 그냥 담는다.
  const store = new Set([files.find((f) => f.path.endsWith(".wav"))?.path ?? ""]);
  writeFileSync("fixtures/voice-cp932.zip", makeZip(files, { store }));
  writeFileSync("fixtures/voice-utf8.zip", makeZip(files, { utf8: true }));
  console.log(`fixtures/voice-cp932.zip · voice-utf8.zip — 파일 ${files.length}개`);
}
