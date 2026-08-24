/**
 * 샘플 파일명 읽기 점검 — 브라우저 없이 돈다.
 *
 * M4 는 "폴더를 넣으면 알아서 건반에 놓인다" 가 전부라, 여기가 틀리면 음원을
 * 넣어도 소리가 안 나거나 엉뚱한 음이 난다. 실제 배포처들이 쓰는 이름 모양을
 * 그대로 넣어 본다.
 */

import { parseSampleName, noteNameToMidi, commonLabel } from "../src/model/sampleNames.ts";

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

// --- 음이름 → MIDI ---
eq("C4 는 미들 C(60)", noteNameToMidi("C4"), 60);
eq("A4 는 440Hz 자리(69)", noteNameToMidi("A4"), 69);
eq("A#3 = 58", noteNameToMidi("A#3"), 58);
eq("Bb3 도 58 (내림표)", noteNameToMidi("Bb3"), 58);
eq("C-1 은 0", noteNameToMidi("C-1"), 0);
eq("음이름이 아니면 null", noteNameToMidi("hello"), null);
eq("범위를 벗어나면 null", noteNameToMidi("C12"), null);

// --- 실제로 있을 법한 파일 이름들 ---
const cases = [
  ["가야금_C4.wav", 60, null, "가야금"],
  ["gayageum-60.wav", 60, null, "gayageum"],
  ["sax_A#3_mf.wav", 58, "mf", "sax"],
  ["해금_Bb3_f.wav", 58, "f", "해금"],
  ["대금 G5 pp.wav", 79, "pp", "대금"],
  ["Daegeum_D#4_ff.wav", 63, "ff", "Daegeum"],
  ["아쟁-48.wav", 48, null, "아쟁"],
];
for (const [file, pitch, layer, label] of cases) {
  const got = parseSampleName(file);
  eq(`${file}`, [got.pitch, got.layer, got.label], [pitch, layer, label]);
}

// --- 헷갈리기 쉬운 것들 ---
const numbered = parseSampleName("해금_2_A3.wav");
check("일련번호보다 음이름이 우선한다", numbered.pitch === 57, numbered);

const noPitch = parseSampleName("녹음본.wav");
check("음높이를 못 찾으면 null 로 돌려준다 (조용히 버리지 않는다)", noPitch.pitch === null, noPitch);

const tinyNumber = parseSampleName("sample_01.wav");
check("한 자리 일련번호를 음높이로 착각하지 않는다", tinyNumber.pitch === null, tinyNumber);

const layerOnly = parseSampleName("가야금_f.wav");
check("세기만 있고 음높이가 없어도 세기는 읽는다", layerOnly.layer === "f" && layerOnly.pitch === null, layerOnly);

// --- 트랙 이름 ---
check(
  "여러 파일에서 공통 이름을 뽑는다",
  commonLabel(["가야금_C4.wav", "가야금_D4.wav", "가야금_E4.wav"]) === "가야금",
  commonLabel(["가야금_C4.wav", "가야금_D4.wav", "가야금_E4.wav"]),
);

let bad = 0;
for (const r of results) {
  if (!r.ok) bad += 1;
  console.log(`${r.ok ? "✅" : "❌"} ${r.name}${r.ok ? "" : "  " + JSON.stringify(r.detail)}`);
}
console.log(bad === 0 ? `\n전부 통과 (${results.length}개)` : `\n실패 ${bad}개`);
process.exit(bad === 0 ? 0 : 1);
