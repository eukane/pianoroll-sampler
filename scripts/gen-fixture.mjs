/**
 * 테스트용 SF2 를 만든다. **다운로드 없이.**
 *
 * M2 를 확인하려면 "악기를 바꿨더니 소리가 바뀐다" 를 봐야 하고, 그러려면
 * 프리셋이 최소 두 개인 사운드폰트가 필요하다. 진짜 GM 사운드폰트는 수십 MB 라
 * 저장소에 넣을 수도, 테스트마다 받을 수도 없다.
 *
 * spessasynth_core 에 들어 있는 890바이트짜리 샘플 뱅크(프리셋 1개)를 읽어서
 * 프리셋만 여러 개로 늘린다. 소리는 전부 같은 톱니파지만, **프리셋 목록 ·
 * 검색 · 프로그램 체인지 경로**를 실제로 통과시키는 게 목적이라 충분하다.
 *
 *     node scripts/gen-fixture.mjs   →  fixtures/test.sf2
 */

import { BasicPreset, BasicPresetZone, BasicSoundBank, SoundBankLoader } from "spessasynth_core";
import { mkdirSync, writeFileSync } from "node:fs";

const bank = SoundBankLoader.fromArrayBuffer(BasicSoundBank.getSampleSoundBankFile());
const source = bank.presets[0];
const instrument = source.zones[0].instrument;

// 이름은 실제 GM 배치를 흉내 낸다. "sax" 검색이 되는지 봐야 해서.
const wanted = [
  [0, "Acoustic Grand Piano"],
  [56, "Trumpet"],
  [64, "Soprano Sax"],
  [65, "Alto Sax"],
  [66, "Tenor Sax"],
  [67, "Baritone Sax"],
  [105, "Gayageum"],
];

source.name = wanted[0][1];
source.program = wanted[0][0];

for (const [program, name] of wanted.slice(1)) {
  const preset = new BasicPreset(bank);
  preset.name = name;
  preset.program = program;
  preset.bankMSB = 0;
  preset.bankLSB = 0;
  preset.zones.push(new BasicPresetZone(preset, instrument));
  bank.addPresets(preset);
}

bank.flush();
const out = bank.writeSF2();
mkdirSync("fixtures", { recursive: true });
writeFileSync("fixtures/test.sf2", Buffer.from(out));

const check = SoundBankLoader.fromArrayBuffer(out);
console.log(`fixtures/test.sf2 — ${out.byteLength} bytes`);
console.log("프리셋:", check.presets.map((p) => `${p.program} ${p.name}`).join(" | "));
