/**
 * UTAU 원음설정(oto.ini) 읽기 점검. **브라우저 없이 돈다.**
 *
 * 음원 자체는 저장소에 못 넣는다 (사용허락조건: 저작자 승낙 없이 전부/일부를
 * 배포 금지). 그래서 검사는 **진짜 음원에서 그대로 베낀 형식의 가짜 설정**을
 * 쓴다. 숫자만 바꿨을 뿐 줄 모양은 실물과 같다.
 *
 * 개발할 때 실물이 `.teto/` 에 풀려 있으면 그쪽도 같이 훑는다 (없으면 건너뜀).
 *
 * 이어붙이기 계획(model/phrase.ts)도 여기서 같이 본다 — 그쪽도 순수 함수다.
 *
 *     node scripts/oto-test.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { parseOto, indexOto, pickEntry, regionOf, splitAlias, vowelOf } from "../src/model/oto.ts";
import { planPhrase, DEFAULT_RECORDED_PITCH, RELEASE } from "../src/model/phrase.ts";
import { readFrqAverage, frqNameFor, hzToMidi } from "../src/model/frq.ts";

const out = [];
const ok = (n, pass, d) => out.push({ n, pass: !!pass, d });

// 실물과 같은 모양. 파일명=별칭,offset,consonant,cutoff,preutter,overlap
const SAMPLE = `
_あ.wav=あ,24,56,73,5,20
_あ.wav=- あ,24,56,73,5,20
_あ.wav=* あ,78,100,73,50,100
_か.wav=か,27,80,-925,19,-10
_か.wav=- か,27,80,-925,19,-10
_きゃ.wav=きゃ,30,70,100,25,15
_ん.wav=ん,10,40,50,12,8
# 주석
망가진줄
_없는칸.wav=단독,1,2
`;

const { entries, skipped } = parseOto(SAMPLE);
ok("정상적인 줄만 읽는다", entries.length === 7, entries.length);
// 못 읽은 줄을 조용히 버리지 않는다 — 왜 그 글자만 소리가 안 나는지 알아야 한다.
ok("망가진 줄은 세어서 돌려준다", skipped.length === 2, skipped);

const a = entries[0];
ok("다섯 숫자를 제자리에 넣는다",
   a.offset === 24 && a.consonant === 56 && a.cutoff === 73 && a.preutter === 5 && a.overlap === 20, a);

// ---- 별칭 가르기 ----
ok("「- あ」는 머리표와 소리로 갈린다",
   splitAlias("- あ").prefix === "-" && splitAlias("- あ").sound === "あ");
ok("「* あ」도 마찬가지", splitAlias("* あ").prefix === "*");
ok("연속음 「a か」는 앞 모음이 머리표", splitAlias("a か").prefix === "a" && splitAlias("a か").sound === "か");
ok("머리표가 없으면 빈 문자열", splitAlias("あ").prefix === "" && splitAlias("あ").sound === "あ");

// ---- 구간 계산: cutoff 의 부호 ----
//
// 이게 UTAU 포맷에서 제일 자주 틀리는 자리다. 반대로 읽으면 소리가 통째로
// 잘리거나 뒤쪽 잡음까지 다 들어간다. 진짜 테토 음원 319줄로 확인했다.
const positive = regionOf(entries[0], 0.652); // cutoff 73 (양수)
ok("cutoff 가 양수면 파일 끝에서 잘라낸다",
   Math.abs(positive.start - 0.024) < 1e-9 && Math.abs(positive.end - (0.652 - 0.073)) < 1e-9, positive);
const negative = regionOf(entries[3], 1.2); // cutoff -925 (음수)
ok("cutoff 가 음수면 offset 에서 그 길이만큼만 쓴다",
   Math.abs(negative.start - 0.027) < 1e-9 && Math.abs(negative.end - (0.027 + 0.925)) < 1e-9, negative);

// ---- 상황에 맞는 설정 고르기 ----
const index = indexOto(entries);
ok("소리별로 묶인다", index.get("あ")?.length === 3, index.get("あ")?.length);
ok("첫 음(앞이 무음)이면 「- あ」를 쓴다", pickEntry(index, "あ", null)?.prefix === "-");
ok("이어지는 음이면 「* あ」를 쓴다", pickEntry(index, "あ", "a")?.prefix === "*");
// 무음용 설정을 곡 중간에 쓰면 매번 새로 말하는 것처럼 들린다.
ok("이어지는 자리에서 무음용을 고르지 않는다", pickEntry(index, "あ", "a")?.prefix !== "-");
ok("그 소리가 없으면 null", pickEntry(index, "ぴ", null) === null);
// 「か」는 「* か」가 없다 — 있는 것 중에서 골라야지 소리를 안 내면 안 된다.
ok("이어지는 설정이 없으면 있는 것으로 떨어진다", pickEntry(index, "か", "a") !== null);

// ---- 모음 뽑기 (다음 음이 무엇을 이어 쓸지 정한다) ----
ok("か 의 모음은 a", vowelOf("か") === "a");
// 작은 가나가 뒤에 붙으므로 뒤에서부터 봐야 한다. きゃ 는 i 가 아니라 a 다.
ok("きゃ 의 모음은 a (i 가 아니다)", vowelOf("きゃ") === "a");
ok("ん 은 n", vowelOf("ん") === "n");
ok("가타카나도 읽는다", vowelOf("ヴァ") === "a", vowelOf("ヴァ"));
ok("모를 글자는 null", vowelOf("?") === null);

// ---- 주파수표(.frq) — 파일마다 녹음된 음정 ----
//
// 음원 전체를 한 음으로 보면 어떤 글자만 음정이 틀린다. 실제로 테토 단독음의
// 「さ」는 다른 글자보다 거의 반음 낮게 녹음돼 있다.
const makeFrq = (hz, count = 2) => {
  const buf = new ArrayBuffer(40 + count * 16);
  const v = new DataView(buf);
  for (let i = 0; i < 8; i += 1) v.setUint8(i, "FREQ0003".charCodeAt(i));
  v.setInt32(8, 256, true);
  v.setFloat64(12, hz, true);
  v.setInt32(36, count, true);
  return buf;
};
ok("주파수표에서 평균 주파수를 읽는다", Math.abs(readFrqAverage(makeFrq(309.73)) - 309.73) < 1e-9);
ok("주파수 → MIDI 변환", Math.abs(hzToMidi(440) - 69) < 1e-9 && Math.abs(hzToMidi(220) - 57) < 1e-9);
ok("파일 이름 규칙 (_あ.wav → _あ_wav.frq)", frqNameFor("_あ.wav") === "_あ_wav.frq");
// 크기가 안 맞으면 다른 형식이거나 깨진 파일이다. 믿고 쓰면 엉뚱한 음이 된다.
ok("항목 수와 파일 크기가 안 맞으면 안 믿는다",
   readFrqAverage(makeFrq(300).slice(0, 60)) === null);
ok("머리글자가 다르면 null", readFrqAverage(new ArrayBuffer(80)) === null);
ok("사람 목소리 범위 밖이면 null", readFrqAverage(makeFrq(5)) === null);

// 파일마다 다른 음정을 실제로 쓰는가. 같은 「あ」를 두 파일로 두고 확인한다.
const tuned = planPhrase(
  [{ id: "n", pitch: 63, startSec: 0, lengthSec: 0.5, lyric: "あ" }],
  { index, fileSeconds: () => 0.652, pitchOf: (f) => (f === "_あ.wav" ? 62 : undefined) },
);
// 녹음이 62 인데 63 을 부르라고 했으니 반음 올려야 한다.
ok("파일별 녹음 음정을 반영해 속도를 정한다",
   Math.abs(tuned.pieces[0].rate - 2 ** (1 / 12)) < 1e-9, tuned.pieces[0].rate);

// ---- 실물이 있으면 같이 훑는다 ----
const real = ".teto/bank/重音テト音声ライブラリー/重音テト単独音";
if (existsSync(`${real}/oto.ini`)) {
  const text = new TextDecoder("shift_jis").decode(readFileSync(`${real}/oto.ini`));
  const r = parseOto(text);
  ok("[실물] 못 읽은 줄이 없다", r.skipped.length === 0, r.skipped.slice(0, 3));
  ok("[실물] 설정이 300줄 넘게 읽힌다", r.entries.length > 300, r.entries.length);

  const wavs = new Set(readdirSync(real).filter((f) => f.toLowerCase().endsWith(".wav")));
  const missing = [...new Set(r.entries.map((e) => e.fileName))].filter((f) => !wavs.has(f));
  ok("[실물] oto 가 가리키는 WAV 가 전부 있다", missing.length === 0, missing.slice(0, 3));

  // 구간이 파일 밖으로 나가면 cutoff 를 잘못 읽고 있는 것이다.
  const seconds = new Map();
  let outside = 0;
  for (const e of r.entries) {
    if (!wavs.has(e.fileName)) continue;
    if (!seconds.has(e.fileName)) {
      seconds.set(e.fileName, (readFileSync(`${real}/${e.fileName}`).length - 44) / (44100 * 2));
    }
    const dur = seconds.get(e.fileName);
    const g = regionOf(e, dur);
    if (!(g.end > g.start) || g.end > dur + 0.001 || g.start < 0) outside += 1;
  }
  ok("[실물] 모든 구간이 파일 안에 들어온다", outside === 0, { 밖으로나감: outside });

  // 주파수표가 WAV 마다 붙어 있고 전부 읽히는가.
  const frqs = readdirSync(real).filter((f) => f.toLowerCase().endsWith(".frq"));
  let readable = 0;
  const pitches = [];
  for (const f of frqs) {
    // Node 의 Buffer 는 큰 풀을 공유한다. .buffer 를 그냥 넘기면 파일이 아니라
    // 풀 전체가 넘어가서 크기 검사가 어긋난다. 그 파일 몫만 잘라 넘긴다.
    const raw = readFileSync(`${real}/${f}`);
    const hz = readFrqAverage(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    if (hz !== null) { readable += 1; pitches.push(hzToMidi(hz)); }
  }
  ok("[실물] 주파수표가 전부 읽힌다", readable === frqs.length, { 읽힘: readable, 전체: frqs.length });
  // 한 사람이 한 음으로 부른 녹음이라 좁게 모여 있어야 한다. 넓게 흩어지면
  // 형식을 잘못 읽고 있는 것이다.
  pitches.sort((a, b) => a - b);
  const lo = pitches[Math.floor(pitches.length * 0.1)];
  const hi = pitches[Math.floor(pitches.length * 0.9)];
  ok("[실물] 녹음 음정이 한 음 언저리에 모여 있다", hi - lo < 3,
     { 아래: +lo.toFixed(2), 위: +hi.toFixed(2) });
} else {
  console.log("(실물 음원이 없어 실물 검사는 건너뜀 — .teto/ 에 풀어 두면 같이 본다)\n");
}

// ---- 이어붙이기 계획 ----
//
// 소리를 내기 전에 숫자부터 맞아야 한다. 여기가 어긋나면 "왜 이 글자만 짧지"
// 가 되는데 귀로는 아주 잡기 어렵다.
const secs = { "_あ.wav": 0.652, "_か.wav": 1.2, "_きゃ.wav": 0.8, "_ん.wav": 0.5 };
const plan = (notes) => planPhrase(notes, { index, fileSeconds: (f) => secs[f] });
const note = (id, pitch, startSec, lengthSec, lyric) => ({ id, pitch, startSec, lengthSec, lyric });

// 선행발성: 소리는 박보다 **먼저** 시작한다. 「- か」의 preutter 는 19ms.
const one = plan([note("n1", DEFAULT_RECORDED_PITCH, 1.0, 0.5, "か")]);
ok("못 부른 노랫말이 없다", one.missing.length === 0, one.missing);
ok("첫 음은 무음용 설정을 쓴다", one.pieces[0].alias === "- か", one.pieces[0].alias);
ok("소리가 박보다 선행발성만큼 앞서 시작한다",
   Math.abs(one.pieces[0].startAt - (1.0 - 0.019)) < 1e-9, one.pieces[0].startAt);
ok("녹음 음정 그대로면 재생 속도가 1", Math.abs(one.pieces[0].rate - 1) < 1e-9);

// 음정을 옮기면 선행발성도 같이 빨라진다. 안 나눠 주면 자리가 밀린다.
const high = plan([note("n1", DEFAULT_RECORDED_PITCH + 12, 1.0, 0.5, "か")]);
ok("한 옥타브 위면 재생 속도가 2배", Math.abs(high.pieces[0].rate - 2) < 1e-9);
ok("빨라진 만큼 선행발성도 줄어든다",
   Math.abs(high.pieces[0].startAt - (1.0 - 0.019 / 2)) < 1e-9, high.pieces[0].startAt);

// 이어지는 두 음: 앞 음은 뒤 음의 겹침만큼 물고 있다가 끝난다.
const two = plan([
  note("n1", DEFAULT_RECORDED_PITCH, 0, 0.5, "か"),
  note("n2", DEFAULT_RECORDED_PITCH, 0.5, 0.5, "あ"),
]);
ok("이어지는 음은 이어짐용 설정을 쓴다", two.pieces[1].alias === "* あ", two.pieces[1].alias);
// 「* あ」의 overlap 은 100ms.
ok("뒤 음이 겹침만큼 페이드인한다", Math.abs(two.pieces[1].fadeIn - 0.1) < 1e-9, two.pieces[1].fadeIn);
ok("앞 음이 그 겹침이 끝날 때까지 물고 있다",
   Math.abs(two.pieces[0].endAt - (two.pieces[1].startAt + 0.1)) < 1e-9,
   { 앞끝: two.pieces[0].endAt, 뒤시작: two.pieces[1].startAt });

// 겹침이 음수면 겹치는 게 아니라 떼어 놓으라는 뜻이다. 실물에 실제로 있다.
const negOverlap = plan([
  note("n1", DEFAULT_RECORDED_PITCH, 0, 0.5, "あ"),
  note("n2", DEFAULT_RECORDED_PITCH, 0.5, 0.5, "か"), // 「か」의 이어짐 설정이 없어 "か"(overlap -10)
]);
ok("겹침이 음수면 앞 음을 먼저 뗀다",
   negOverlap.pieces[0].endAt < negOverlap.pieces[1].startAt + 1e-9,
   { 앞끝: negOverlap.pieces[0].endAt, 뒤시작: negOverlap.pieces[1].startAt });

// 쉬었다 다시 부르면 처음부터 — 무음용 설정으로 돌아가야 한다.
const rested = plan([
  note("n1", DEFAULT_RECORDED_PITCH, 0, 0.3, "か"),
  note("n2", DEFAULT_RECORDED_PITCH, 2.0, 0.3, "あ"),
]);
ok("쉬고 나면 다시 무음용 설정", rested.pieces[1].alias === "- あ", rested.pieces[1].alias);

// 모음 늘이기: 녹음보다 긴 음은 반복해서 채운다. 자음은 안 늘인다.
const long = plan([note("n1", DEFAULT_RECORDED_PITCH, 0, 3.0, "あ")]);
ok("녹음보다 길면 모음을 반복한다", long.pieces[0].loop !== null, long.pieces[0].loop);
ok("반복 구간이 자음 뒤에서 시작한다",
   long.pieces[0].loop.start > long.pieces[0].bufferOffset, long.pieces[0].loop);
ok("긴 음도 노트 끝까지 소리가 이어진다",
   Math.abs(long.pieces[0].endAt - (3.0 + RELEASE)) < 1e-9, long.pieces[0].endAt);
const short = plan([note("n1", DEFAULT_RECORDED_PITCH, 0, 0.2, "あ")]);
ok("짧은 음은 반복하지 않는다", short.pieces[0].loop === null);

// 음원에 없는 글자는 조용히 빼먹지 않는다.
const unknown = plan([note("n1", DEFAULT_RECORDED_PITCH, 0, 0.5, "ぴ")]);
ok("없는 노랫말은 못 불렀다고 돌려준다",
   unknown.pieces.length === 0 && unknown.missing[0]?.lyric === "ぴ", unknown);

// 노랫말을 안 적으면 기본 소리로 부른다 (소리가 아예 안 나면 고장인 줄 안다).
const blank = plan([note("n1", DEFAULT_RECORDED_PITCH, 0, 0.5, "")]);
ok("노랫말이 비면 기본 소리로 부른다", blank.pieces.length === 1 && blank.missing.length === 0);

let bad = 0;
for (const r of out) {
  if (!r.pass) bad += 1;
  console.log(`${r.pass ? "✅" : "❌"} ${r.n}${r.pass ? "" : "  " + JSON.stringify(r.d)}`);
}
console.log(bad === 0 ? `\n전부 통과 (${out.length}개)` : `\n실패 ${bad}개`);
process.exit(bad === 0 ? 0 : 1);
