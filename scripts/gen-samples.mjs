/**
 * 테스트용 단음 WAV 를 만든다. **국악기 음원을 받지 않고도** M4 를 확인하려고.
 *
 * 실제 국립국악원 음원처럼 "음 하나 = 파일 하나" 로 만들고, 파일 이름도 배포처
 * 마다 다른 모양을 섞어 둔다. 뜯는 소리를 흉내 내려고 빠르게 잦아드는 사인파를
 * 쓴다 — 릴리즈 꼬리가 붙는지 보려면 원래 소리에 여운이 있어야 한다.
 *
 *     node scripts/gen-samples.mjs   →  fixtures/samples/
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const SR = 44100;
const DIR = "fixtures/samples";

function noteToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** 뜯은 소리 비슷하게: 배음 몇 개 + 지수 감쇠. */
function pluck(midi, seconds = 1.2) {
  const n = Math.floor(SR * seconds);
  const f = noteToFreq(midi);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    const decay = Math.exp(-3.2 * t);
    data[i] =
      decay *
      (Math.sin(2 * Math.PI * f * t) * 0.6 +
        Math.sin(2 * Math.PI * f * 2 * t) * 0.22 +
        Math.sin(2 * Math.PI * f * 3 * t) * 0.1);
  }
  // 시작 클릭 제거
  const fade = Math.floor(SR * 0.004);
  for (let i = 0; i < fade; i += 1) data[i] *= i / fade;
  return data;
}

function toWav(samples) {
  const bytes = samples.length * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); // 모노
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), 44 + i * 2);
  }
  return buf;
}

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

// 두 옥타브를 띄엄띄엄 (실제 음원도 반음마다 다 녹음하지는 않는다)
const names = [
  ["가야금_C3.wav", 48], ["가야금_E3.wav", 52], ["가야금_G3.wav", 55],
  ["가야금_C4.wav", 60], ["가야금_D#4.wav", 63], ["가야금_G4.wav", 67],
  ["가야금_Bb4.wav", 70], ["가야금_C5.wav", 72],
  // 다른 이름 모양들도 섞는다
  ["gayageum-74.wav", 74], ["가야금 E5 mf.wav", 76],
];
for (const [file, midi] of names) writeFileSync(join(DIR, file), toWav(pluck(midi)));

// 파일 이름으로 음높이를 알 수 없는 것 — 수동 매핑 화면이 떠야 한다
writeFileSync(join(DIR, "녹음본.wav"), toWav(pluck(64)));

console.log(`${DIR} — WAV ${names.length + 1}개 (그중 1개는 이름으로 음높이를 알 수 없음)`);

/**
 * 부는 악기 흉내 — 끝까지 음량이 유지되는 소리.
 *
 * 뜯는 소리와 다르게 다뤄져야 한다. 뜯는 건 손을 떼도 울리고, 부는 건 멎는다.
 * 그 판정이 맞는지 보려면 두 종류가 다 있어야 한다.
 */
function sustained(midi, seconds = 3.0) {
  const n = Math.floor(SR * seconds);
  const f = noteToFreq(midi);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    // 살짝 흔들리지만 잦아들지는 않는다.
    // 흔들림은 **위상**에 더한다. f * (1 + 흔들림) * t 로 쓰면 흔들리는 폭이
    // t 에 비례해서 커진다 — 3초 끝에서는 반음이 넘게 벗어난다. 음정을 재는
    // 검사(떨림 점검)가 그 샘플을 쓰면 아무것도 못 잰다.
    const phase = 2 * Math.PI * f * t + 0.03 * Math.sin(2 * Math.PI * 5 * t);
    data[i] = Math.sin(phase) * 0.45;
  }
  const fade = Math.floor(SR * 0.03);
  for (let i = 0; i < fade; i += 1) {
    data[i] *= i / fade;
    data[n - 1 - i] *= i / fade;
  }
  return data;
}

const SUS = "fixtures/sustained";
rmSync(SUS, { recursive: true, force: true });
mkdirSync(SUS, { recursive: true });
for (const [file, midi] of [["대금_C5.wav", 72], ["대금_E5.wav", 76], ["대금_G5.wav", 79]]) {
  writeFileSync(join(SUS, file), toWav(sustained(midi)));
}
console.log(`${SUS} — 지속음 WAV 3개 (여운 판정이 갈리는지 보려고)`);
