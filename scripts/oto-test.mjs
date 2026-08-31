/**
 * UTAU 원음설정(oto.ini) 읽기 점검. **브라우저 없이 돈다.**
 *
 * 음원 자체는 저장소에 못 넣는다 (사용허락조건: 저작자 승낙 없이 전부/일부를
 * 배포 금지). 그래서 검사는 **진짜 음원에서 그대로 베낀 형식의 가짜 설정**을
 * 쓴다. 숫자만 바꿨을 뿐 줄 모양은 실물과 같다.
 *
 * 개발할 때 실물이 `.teto/` 에 풀려 있으면 그쪽도 같이 훑는다 (없으면 건너뜀).
 *
 *     node scripts/oto-test.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { parseOto, indexOto, pickEntry, regionOf, splitAlias, vowelOf } from "../src/model/oto.ts";

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
} else {
  console.log("(실물 음원이 없어 실물 검사는 건너뜀 — .teto/ 에 풀어 두면 같이 본다)\n");
}

let bad = 0;
for (const r of out) {
  if (!r.pass) bad += 1;
  console.log(`${r.pass ? "✅" : "❌"} ${r.n}${r.pass ? "" : "  " + JSON.stringify(r.d)}`);
}
console.log(bad === 0 ? `\n전부 통과 (${out.length}개)` : `\n실패 ${bad}개`);
process.exit(bad === 0 ? 0 : 1);
