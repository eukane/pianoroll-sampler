/**
 * 시험용 **가짜 UTAU 음원**을 만든다. 진짜 음원을 저장소에 넣을 수 없어서다
 * (사용허락조건이 배포를 금지한다).
 *
 * 소리는 사인파지만 **모양은 실물과 같다** — WAV + oto.ini + 주파수표(.frq),
 * 별칭 세 갈래(「あ」「- あ」「* あ」), 자음 구간과 선행발성까지.
 * 앱이 음원을 읽고 이어 붙이는 길을 그대로 통과시키는 게 목적이다.
 *
 *     node scripts/gen-voicebank.mjs   →  fixtures/voicebank/
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SR = 44100;
const OUT = "fixtures/voicebank";
/** 녹음된 척하는 음정. 실물 테토가 63 언저리라 비슷하게 잡았다. */
const RECORDED_HZ = 311.13; // 레#4

/** 자음처럼 들리는 짧은 잡음 + 모음처럼 이어지는 사인파. */
function syllable(seconds = 0.9, consonantSec = 0.06) {
  const n = Math.floor(SR * seconds);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    if (t < consonantSec) {
      // 자음 — 짧은 잡음. 여기를 늘이면 안 된다는 걸 검사가 볼 수 있게 둔다.
      data[i] = (Math.random() * 2 - 1) * 0.25;
    } else {
      // 모음 — 배음을 섞어야 음정 추적이 옥타브를 안 틀린다.
      const p = 2 * Math.PI * RECORDED_HZ * t;
      data[i] = (Math.sin(p) * 0.5 + Math.sin(p * 2) * 0.2 + Math.sin(p * 3) * 0.1) * 0.6;
    }
  }
  const fade = Math.floor(SR * 0.01);
  for (let i = 0; i < fade; i += 1) {
    data[i] *= i / fade;
    data[n - 1 - i] *= i / fade;
  }
  return data;
}

function toWav(data) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i += 1) {
    buf.writeInt16LE(Math.max(-1, Math.min(1, data[i])) * 32767, 44 + i * 2);
  }
  return buf;
}

/** 실물과 같은 FREQ0003 형식. 머리에 평균 주파수가 들어간다. */
function toFrq(hz, samples) {
  const count = Math.max(1, Math.floor(samples / 256));
  const buf = Buffer.alloc(40 + count * 16);
  buf.write("FREQ0003", 0);
  buf.writeInt32LE(256, 8);
  buf.writeDoubleLE(hz, 12);
  buf.writeInt32LE(count, 36);
  for (let i = 0; i < count; i += 1) {
    buf.writeDoubleLE(hz, 40 + i * 16);
    buf.writeDoubleLE(0.5, 48 + i * 16);
  }
  return buf;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 「かさねてと」를 부를 수 있을 만큼. 「さ」는 일부러 반음 낮게 녹음한다 —
// 실물 테토가 그렇고, 주파수표를 안 읽으면 그 글자만 음이 틀리는 게 드러난다.
const KANA = ["あ", "か", "さ", "ね", "て", "と"];
const lines = [];
for (const kana of KANA) {
  const file = `_${kana}.wav`;
  const flat = kana === "さ";
  const hz = flat ? RECORDED_HZ * 2 ** (-1 / 12) : RECORDED_HZ;
  const data = syllable();
  // 낮게 녹음한 척하려면 실제로 낮은 소리를 넣어야 한다.
  if (flat) {
    for (let i = 0; i < data.length; i += 1) {
      const t = i / SR;
      if (t >= 0.06) {
        const p = 2 * Math.PI * hz * t;
        data[i] = (Math.sin(p) * 0.5 + Math.sin(p * 2) * 0.2 + Math.sin(p * 3) * 0.1) * 0.6;
      }
    }
  }
  writeFileSync(join(OUT, file), toWav(data));
  writeFileSync(join(OUT, `_${kana}_wav.frq`), toFrq(hz, data.length));

  // offset, consonant, cutoff, preutter, overlap  (실물과 같은 다섯 숫자)
  lines.push(`${file}=${kana},10,60,-800,25,20`);
  lines.push(`${file}=- ${kana},10,60,-800,25,20`);
  lines.push(`${file}=* ${kana},80,60,-700,50,60`);
}
// oto.ini 는 Shift-JIS 다 — 실물과 같아야 브라우저의 디코딩까지 검사된다.
// Node 에는 CP932 인코더가 없어서 쓰는 가나만 표에서 찾아 바이트로 쓴다.
const CP932 = { "あ": [0x82, 0xa0], "か": [0x82, 0xa9], "さ": [0x82, 0xb3],
  "ね": [0x82, 0xcb], "て": [0x82, 0xc4], "と": [0x82, 0xc6] };
const bytes = [];
for (const line of lines) {
  for (const ch of line) {
    if (CP932[ch]) bytes.push(...CP932[ch]);
    else bytes.push(ch.charCodeAt(0));
  }
  bytes.push(0x0d, 0x0a);
}
writeFileSync(join(OUT, "oto.ini"), Buffer.from(bytes));

console.log(`${OUT} — 가짜 UTAU 음원 (소리 ${KANA.length}가지 · Shift-JIS oto.ini · 주파수표 포함)`);
console.log(`  「さ」만 반음 낮게 녹음 — 주파수표를 안 읽으면 그 글자만 음이 틀린다`);
