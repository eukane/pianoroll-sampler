/**
 * 100MB 급 사운드폰트를 만든다 — 큰 파일을 넣었을 때 버티는지 보려고.
 * 실제 GM 뱅크는 100~300MB 짜리가 흔하고, 거기서 뻗는 앱이 많다.
 *
 * 기본 점검(`npm run smoke`)에는 넣지 않았다. 만드는 데만 한참 걸리고 디스크를
 * 100MB 먹어서, 매번 돌릴 일이 아니다. 메모리 구조를 건드렸을 때만 돌리면 된다.
 *
 *     node scripts/gen-big-sf2.mjs     →  fixtures/big.sf2 (101MB)
 *
 * 확인된 결과 (2026-08, 갤럭시 탭 화면 크기 · 크로미움):
 *   · 101MB 로드 2.0초, JS 힙 25MB → 24MB (거의 안 늘어남)
 *   · ArrayBuffer 가 워크렛으로 transfer 되어 메인 스레드에 안 남는다
 *   · 내보낼 때는 원본 File 에서 다시 읽는다 (수백 MB 를 두 벌 들고 있지 않으려고)
 */
import { BasicSoundBank, SoundBankLoader, BasicPreset, BasicPresetZone,
         BasicSample, BasicInstrument, BasicInstrumentZone } from "spessasynth_core";
import { writeFileSync } from "node:fs";

const bank = SoundBankLoader.fromArrayBuffer(BasicSoundBank.getSampleSoundBankFile());
const SR = 44100;
const SECONDS = 20;
const COUNT = 60;                       // 60 × 20초 × 44.1k × 2byte ≈ 105MB

const frames = SR * SECONDS;
console.log(`샘플 ${COUNT}개 × ${SECONDS}초 만드는 중…`);

for (let i = 0; i < COUNT; i++) {
  const data = new Float32Array(frames);
  const f = 110 * Math.pow(2, i / 12);
  for (let n = 0; n < frames; n++) {
    data[n] = Math.sin((2 * Math.PI * f * n) / SR) * 0.5;
  }
  const sample = new BasicSample(`big${i}`, SR, 60, 0, 1, 1000, frames - 1000);
  sample.setAudioData(data, SR);

  const inst = new BasicInstrument();
  inst.name = `inst${i}`;
  const iz = new BasicInstrumentZone(inst, sample);
  inst.zones.push(iz);
  bank.addInstruments(inst);
  bank.addSamples(sample);

  const preset = new BasicPreset(bank);
  preset.name = `Big ${i}`;
  preset.program = i % 128;
  preset.bankMSB = Math.floor(i / 128) + 1;   // 원본 프리셋과 안 겹치게
  preset.bankLSB = 0;
  preset.zones.push(new BasicPresetZone(preset, inst));
  bank.addPresets(preset);
}

bank.flush();
const out = bank.writeSF2();
writeFileSync("fixtures/big.sf2", Buffer.from(out));
console.log(`fixtures/big.sf2 — ${(out.byteLength / 1024 / 1024).toFixed(1)} MB, 프리셋 ${bank.presets.length}개`);
