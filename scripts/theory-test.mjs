/**
 * 조·음계·코드 이름 점검. **브라우저 없이 돈다.**
 *
 * 코드 이름은 배우는 사람이 그대로 외우는 자리다. 틀린 이름이 한 번 나가면
 * 그게 틀린 줄도 모르고 외운다. 그래서 수업에서 쓰는 예를 그대로 박아 둔다.
 *
 *     node scripts/theory-test.mjs
 */

import {
  inKey, isTonic, keyChoices, keyFromValue, keyLabel, keyToValue, pcName, readKey,
  scalePitchClasses,
} from "../src/model/scale.ts";
import { chordLine, identifyChord, inversionLabel, romanNumeral } from "../src/model/chord.ts";
import {
  PROGRESSIONS, chordPitches, diatonicChords, progressionPitches, progressionsFor,
} from "../src/model/progression.ts";
import {
  LEVELS, degreeNumeral, describeAnswer, grade, levelById, makeQuestion, questionChords,
} from "../src/model/ear.ts";
import { DEMOS } from "../src/model/demos.ts";
import { projectFromJson, projectToJson } from "../src/export/projectFile.ts";

const out = [];
let bad = 0;
const ok = (name, pass, d) => { out.push({ name, pass: !!pass, d }); if (!pass) bad += 1; };

const C = 60, D = 62, E = 64, F = 65, G = 67, A = 69, B = 71;
const Cmaj = { tonic: 0, mode: "major" };
const Gmaj = { tonic: 7, mode: "major" };
const Amin = { tonic: 9, mode: "minor" };
const Cmin = { tonic: 0, mode: "minor" };
const Ebmaj = { tonic: 3, mode: "major" };

// ------------------------------------------------------------------ 음계

ok("C 장조 = 도레미파솔라시", scalePitchClasses(Cmaj).join() === "0,2,4,5,7,9,11", scalePitchClasses(Cmaj));
// 1회차 확인 문제 1번 그대로: D 장조는 샵 두 개(F#, C#).
{
  const d = scalePitchClasses({ tonic: 2, mode: "major" }).map((p) => pcName(p, { tonic: 2, mode: "major" }));
  ok("D 장조 = D E F# G A B C# (샵 둘)", d.join(" ") === "D E F# G A B C#", d);
}
ok("A 단조는 C 장조와 같은 음 (나란한조)",
  [...scalePitchClasses(Amin)].sort((a, b) => a - b).join() === [...scalePitchClasses(Cmaj)].sort((a, b) => a - b).join());
ok("C 단조 = 도 레 미♭ 파 솔 라♭ 시♭",
  scalePitchClasses(Cmin).map((p) => pcName(p, Cmin)).join(" ") === "C D Eb F G Ab Bb",
  scalePitchClasses(Cmin).map((p) => pcName(p, Cmin)));
ok("옥타브는 안 본다", inKey(C + 24, Cmaj) && inKey(C - 12, Cmaj));
ok("조 밖의 음은 밖이다 (C 장조의 F#)", !inKey(66, Cmaj));
ok("단조의 7음을 올린 음은 조 밖으로 본다 (A 단조의 G#)", !inKey(68, Amin));
ok("으뜸음을 안다", isTonic(A + 12, Amin) && !isTonic(C, Amin));
ok("E♭ 장조는 플랫으로 적는다", pcName(3, Ebmaj) === "Eb" && pcName(10, Ebmaj) === "Bb");
ok("조가 없으면 샵으로 적는다", pcName(3) === "D#");
ok("이름이 맞다", keyLabel(Gmaj) === "G 장조" && keyLabel(Amin) === "A 단조" && keyLabel(Ebmaj) === "Eb 장조");
ok("고르기 목록은 24개 (장조 12 + 단조 12)", keyChoices().length === 24);
ok("목록 값이 되읽힌다", keyChoices().every((c) => keyToValue(keyFromValue(c.value)) === c.value));
ok("「없음」 은 null", keyFromValue("none") === null && keyToValue(null) === "none");
ok("이상한 값은 null", keyFromValue("12:major") === null && keyFromValue("3:lydian") === null);
ok("저장 파일을 그대로 믿지 않는다",
  readKey({ tonic: 3, mode: "minor" })?.tonic === 3 &&
  readKey({ tonic: 13, mode: "major" }) === undefined &&
  readKey({ tonic: 2.5, mode: "major" }) === undefined &&
  readKey({ tonic: 2, mode: "dorian" }) === undefined &&
  readKey("C") === undefined && readKey(null) === undefined);

// ------------------------------------------------------------------ 코드

const name = (ps, key) => identifyChord(ps, key)?.name ?? null;

// 1회차의 C 장조 일곱 코드
const diatonic = [
  [[C, E, G], "C"], [[D, F, A], "Dm"], [[E, G, B], "Em"], [[F, A, C + 12], "F"],
  [[G, B, D + 12], "G"], [[A, C + 12, E + 12], "Am"], [[B, D + 12, F + 12], "Bdim"],
];
for (const [ps, want] of diatonic) ok(`다이아토닉 3화음 ${want}`, name(ps) === want, name(ps));

ok("음이 하나면 이름이 없다", name([C]) === null);
ok("같은 음을 옥타브로만 겹치면 이름이 없다", name([C, C + 12, C + 24]) === null);
ok("자리를 바꿔도 같은 코드 (미 솔 도 = C/E)", name([E, G, C + 12]) === "C/E", name([E, G, C + 12]));
ok("1전위라고 알려 준다", inversionLabel(identifyChord([E, G, C + 12])).startsWith("1전위"));
ok("2전위 (솔 도 미 = C/G)", name([G - 12, C, E]) === "C/G" && identifyChord([G - 12, C, E]).inversion === 2);
ok("겹친 음은 하나로 친다", name([C, E, G, C + 12, E + 12]) === "C");
ok("음 순서는 상관없다 (적은 순서가 아니라 제일 낮은 음이 베이스)",
  name([G, C, E]) === "C" && name([E, G, C]) === "C" && name([G - 12, E, C]) === "C/G");

// 7화음 (3회차)
ok("Cmaj7", name([C, E, G, B]) === "Cmaj7");
ok("Dm7", name([D, F, A, C + 12]) === "Dm7");
ok("G7", name([G, B, D + 12, F + 12]) === "G7");
ok("Bm7b5", name([B, D + 12, F + 12, A + 12]) === "Bm7b5");
ok("Bdim7", name([B, D + 12, F + 12, 80]) === "Bdim7");
ok("Csus4", name([C, F, G]) === "Csus4");
ok("C6", name([C, E, G, A]) === "C6");

// 같은 음 묶음 — 베이스가 가른다
ok("라 도 미 솔 (베이스 라) = Am7", name([A - 12, C, E, G]) === "Am7", name([A - 12, C, E, G]));
ok("도 미 솔 라 (베이스 도) = C6", name([C, E, G, A]) === "C6");
ok("Csus2 와 Gsus4 는 같은 음 — 베이스가 솔이면 Gsus4", name([G - 12, C, D]) === "Gsus4", name([G - 12, C, D]));
ok("베이스가 근음이 아닌데 근음 후보도 없으면 슬래시로 (Am7/C)",
  name([C, E, G, A + 12]) === "C6" && name([C - 12, A, E + 12, G + 12]) === "C6", name([C - 12, A, E + 12, G + 12]));

// 셸 보이싱
ok("근음·3음·7음만 쳐도 G7", name([G, B, F + 12]) === "G7" && identifyChord([G, B, F + 12]).omit5);
ok("파워 코드", name([C, G]) === "C5");
ok("장3도 두 음만으로는 이름을 지어내지 않는다", name([C, E]) === null);
ok("표에 없는 묶음은 null (도 도# 레)", name([C, 61, D]) === null);

// 조에 맞는 글자
ok("E♭ 장조에서 E♭ G B♭ = Eb", name([63, 67, 70], Ebmaj) === "Eb", name([63, 67, 70], Ebmaj));
// 조가 없을 때는 코드 전체가 덜 지저분한 쪽으로 적는다. D# 장코드는
// D# F## A# 이라 같은 소리를 Eb G Bb 로 적는 게 읽기 쉽다.
ok("조가 없으면 덜 지저분한 쪽 (Eb, D# 아님)", name([63, 67, 70]) === "Eb", name([63, 67, 70]));
ok("조가 없어도 F# 장코드는 F#", name([66, 70, 73]) === "F#", name([66, 70, 73]));
ok("C 장조의 B♭ 은 A# 가 아니라 Bb", name([70, D + 12, F + 12], Cmaj) === "Bb", name([70, D + 12, F + 12], Cmaj));
ok("A 단조의 E 장코드 철자 = E G# B", identifyChord([E, 68, B], Amin).tones.join(" ") === "E G# B");
ok("C 장조의 Fm 철자 = F Ab C", identifyChord([F, 68, C + 12], Cmaj).tones.join(" ") === "F Ab C",
  identifyChord([F, 68, C + 12], Cmaj).tones);
ok("슬래시 베이스도 코드 철자대로 (C 장조 Fm/Ab)", name([68 - 12, C, F], Cmaj) === "Fm/Ab", name([68 - 12, C, F], Cmaj));

// ------------------------------------------------------------- 로마숫자

const roman = (ps, key) => {
  const info = identifyChord(ps, key);
  return info ? romanNumeral(info, ps, key) : null;
};

const want = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
diatonic.forEach(([ps], i) => ok(`C 장조 ${want[i]}`, roman(ps, Cmaj)?.numeral === want[i] && roman(ps, Cmaj)?.diatonic, roman(ps, Cmaj)));

// 왕도진행 IV-V-iii-vi 를 G 장조로 옮기면 C-D-Bm-Em (1회차 확인 문제 3번)
{
  const prog = [[C, E, G], [D, 66, A], [B - 12, D, 66], [E, G, B]];
  const names = prog.map((ps) => name(ps, Gmaj));
  const nums = prog.map((ps) => roman(ps, Gmaj).numeral);
  ok("왕도진행 G 장조 = C D Bm Em", names.join(" ") === "C D Bm Em", names);
  ok("왕도진행 로마숫자 = IV V iii vi", nums.join(" ") === "IV V iii vi", nums);
}
ok("G 장조 vi = Em (확인 문제 2번)", name([E, G, B], Gmaj) === "Em" && roman([E, G, B], Gmaj).numeral === "vi");

ok("7화음 로마숫자 V7 · ii7 · Imaj7 · viiø7",
  roman([G, B, D + 12, F + 12], Cmaj).numeral === "V7" &&
  roman([D, F, A, C + 12], Cmaj).numeral === "ii7" &&
  roman([C, E, G, B], Cmaj).numeral === "Imaj7" &&
  roman([B, D + 12, F + 12, A + 12], Cmaj).numeral === "viiø7");

// 단조 (4회차) — 자연단음계 기준
ok("A 단조 i · iv · v · VI · VII · III",
  roman([A, C + 12, E + 12], Amin).numeral === "i" &&
  roman([D, F, A], Amin).numeral === "iv" &&
  roman([E, G, B], Amin).numeral === "v" &&
  roman([F, A, C + 12], Amin).numeral === "VI" &&
  roman([G, B, D + 12], Amin).numeral === "VII" &&
  roman([C, E, G], Amin).numeral === "III");
// 수업: 단조에서 V 를 장코드로 바꾸면 이끎음(G#)이 조 밖으로 나온다
{
  const r = roman([E, 68, B], Amin);
  ok("A 단조의 E 장코드 = V, 조 밖 G#", r.numeral === "V" && !r.diatonic && r.outside.join() === "G#", r);
}

// 빌려 온 코드 (6회차)
{
  const r = roman([F, 68, C + 12], Cmaj);
  ok("C 장조의 Fm = iv, 조 밖 Ab", r.numeral === "iv" && r.outside.join() === "Ab", r);
  ok("C 장조의 B♭ = ♭VII", roman([70, D + 12, F + 12], Cmaj).numeral === "♭VII");
  ok("C 장조의 F#m7b5 = ♯ivø7 (♭V 가 아니라)", roman([66, A, C + 12, E + 12], Cmaj).numeral === "♯ivø7",
    roman([66, A, C + 12, E + 12], Cmaj));
}
// 세컨더리 도미넌트 (5회차): 왕도진행의 iii 를 III7 로
ok("C 장조의 E7 = III7", roman([E, 68, B, D + 12], Cmaj).numeral === "III7", roman([E, 68, B, D + 12], Cmaj));

ok("한 줄 표시 (조 없음)", chordLine([A - 12, C, E, G]) === "Am7");
ok("한 줄 표시 (조 있음)", chordLine([A - 12, C, E, G], Cmaj) === "Am7 · vi7", chordLine([A - 12, C, E, G], Cmaj));
ok("한 줄 표시 (조 밖 음)", chordLine([E, 68, B], Amin) === "E · V · 조 밖 G#", chordLine([E, 68, B], Amin));
ok("이름을 못 붙이면 한 줄도 null", chordLine([C, 61, D], Cmaj) === null);

// ------------------------------------------------------- 조의 코드 · 정석 진행
//
// 코드 버튼은 배우는 사람이 눌러서 외우는 자리다. 이름은 chord.ts 가 지어 주는 걸 쓰므로
// 여기서는 「쌓은 음이 수업과 같은가」 와 「이름이 수업과 같은가」 를 같이 본다.
const names = (key, seventh) =>
  diatonicChords(key, seventh).map((p) => identifyChord(p, key)?.name ?? "?").join(" ");
const romans = (key, seventh) =>
  diatonicChords(key, seventh).map((p) => {
    const info = identifyChord(p, key);
    return info ? romanNumeral(info, p, key).numeral : "?";
  }).join(" ");

ok("C 장조 코드 = C Dm Em F G Am Bdim (장-단-단-장-장-단-감)", names(Cmaj, false) === "C Dm Em F G Am Bdim", names(Cmaj, false));
ok("C 장조 로마숫자 = I ii iii IV V vi vii°", romans(Cmaj, false) === "I ii iii IV V vi vii°", romans(Cmaj, false));
ok("C 장조 7th 코드 = Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7b5", names(Cmaj, true) === "Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7b5", names(Cmaj, true));
ok("G 장조 코드 = G Am Bm C D Em F#dim (1회차 확인 문제 2번: vi 는 Em)", names(Gmaj, false) === "G Am Bm C D Em F#dim", names(Gmaj, false));
ok("A 단조 코드 = Am Bdim C Dm Em F G", names(Amin, false) === "Am Bdim C Dm Em F G", names(Amin, false));
ok("A 단조 로마숫자 = i ii° III iv v VI VII", romans(Amin, false) === "i ii° III iv v VI VII", romans(Amin, false));
ok("D 장조 코드 = D Em F#m G A Bm C#dim", names({ tonic: 2, mode: "major" }, false) === "D Em F#m G A Bm C#dim", names({ tonic: 2, mode: "major" }, false));
ok("E♭ 장조는 플랫으로 쓴다", names(Ebmaj, false) === "Eb Fm Gm Ab Bb Cm Ddim", names(Ebmaj, false));
{
  // 열두 조 × 장·단 × 3화음·7th 전부: 이름이 붙고, 조 안의 음만 쓰고, 건반 가운데에 놓인다.
  let bad24 = [];
  for (const mode of ["major", "minor"]) for (let tonic = 0; tonic < 12; tonic += 1) for (const sev of [false, true]) {
    const key = { tonic, mode };
    diatonicChords(key, sev).forEach((p, deg) => {
      const info = identifyChord(p, key);
      const r = info && romanNumeral(info, p, key);
      const sorted = [...p].sort((a, b) => a - b).join() === p.join();
      if (!info || !r.diatonic || !sorted || p[0] < 55 || p[0] > 66 || p.length !== (sev ? 4 : 3)) bad24.push(`${tonic}:${mode}:${sev}:${deg}`);
    });
  }
  ok("24개 조 전부에서 코드마다 이름이 붙고 조 안의 음만 쓰며 오름차순이고 G3~F#4 에서 시작한다", bad24.length === 0, bad24.slice(0, 6));
}
ok("왕도 IV–V–iii–vi 를 G 장조로 옮기면 C D Bm Em (1회차 확인 문제 3번)",
  progressionPitches(Gmaj, PROGRESSIONS.find((p) => p.id === "oudou")).map((p) => identifyChord(p, Gmaj).name).join(" ") === "C D Bm Em");
ok("코무로 vi–IV–V–I 를 C 장조로 하면 Am F G C",
  progressionPitches(Cmaj, PROGRESSIONS.find((p) => p.id === "komuro")).map((p) => identifyChord(p, Cmaj).name).join(" ") === "Am F G C");
ok("2-5-1 장조 = Dm7 G7 Cmaj7",
  progressionPitches(Cmaj, PROGRESSIONS.find((p) => p.id === "251")).map((p) => identifyChord(p, Cmaj).name).join(" ") === "Dm7 G7 Cmaj7");
ok("카논은 여덟 코드 C G Am Em F C F G",
  progressionPitches(Cmaj, PROGRESSIONS.find((p) => p.id === "canon")).map((p) => identifyChord(p, Cmaj).name).join(" ") === "C G Am Em F C F G");
{
  const names2 = (id) => progressionPitches(Amin, PROGRESSIONS.find((p) => p.id === id)).map((p) => identifyChord(p, Amin)?.name).join(" ");
  ok("안달루시아 i–VII–VI–V 를 A 단조로 하면 Am G F E (마지막 E 는 장코드)", names2("m-andalus") === "Am G F E", names2("m-andalus"));
  ok("단조 2-5-1 = Bm7b5 E7 Am7", names2("m-251") === "Bm7b5 E7 Am7", names2("m-251"));
  const e = chordPitches(Amin, { degree: 4, dominant: true });
  ok("단조의 V 를 장코드로 하면 조 밖 G# 이 뜬다", chordLine(e, Amin) === "E · V · 조 밖 G#", chordLine(e, Amin));
}
ok("장조 진행과 단조 진행이 섞여 나오지 않는다",
  progressionsFor("major").every((p) => p.mode === "major") && progressionsFor("minor").every((p) => p.mode === "minor") &&
  progressionsFor("major").length >= 5 && progressionsFor("minor").length >= 3);
ok("정석 진행의 도수는 전부 0~6", PROGRESSIONS.every((p) => p.chords.every((c) => Number.isInteger(c.degree) && c.degree >= 0 && c.degree <= 6)));
ok("진행 id 가 겹치지 않는다", new Set(PROGRESSIONS.map((p) => p.id)).size === PROGRESSIONS.length);

// ------------------------------------------------------------------ 귀 훈련
//
// 문제는 난수로 나오지만 규칙은 지켜야 한다. 정해진 수열(LCG)로 많이 뽑아 규칙을 센다.
const lcg = (seed) => { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); };
{
  const bad = [];
  for (const level of LEVELS) {
    const rand = lcg(12345 + level.id.charCodeAt(0));
    let prev;
    const seenKeys = new Set();
    const seenFirst = new Set();
    for (let i = 0; i < 400; i += 1) {
      const q = makeQuestion(level.id, rand, true, prev);
      seenKeys.add(q.key.tonic);
      if (q.key.mode !== level.mode) bad.push(`${level.id}: 조 종류`);
      if (prev && prev.key.tonic === q.key.tonic && prev.key.mode === q.key.mode) bad.push(`${level.id}: 같은 조 연속`);
      if (level.kind === "degrees") {
        seenFirst.add(q.degrees[0]);
        if (q.degrees.length !== level.length) bad.push(`${level.id}: 길이`);
        if (q.degrees.some((d) => !level.pool.includes(d))) bad.push(`${level.id}: 풀 밖 도수`);
        if (q.degrees.some((d, k) => k > 0 && d === q.degrees[k - 1])) bad.push(`${level.id}: 같은 코드 연속`);
        if (prev && prev.degrees.join() === q.degrees.join()) bad.push(`${level.id}: 직전과 같은 문제`);
        const { chords, tonic } = questionChords(q);
        if (chords.length !== level.length || tonic.length !== 3) bad.push(`${level.id}: 들려줄 코드`);
      } else {
        const o = q.options ?? [];
        if (!o.includes(q.progression) || new Set(o).size !== o.length || o.length < 2 || o.length > 4) bad.push(`${level.id}: 보기 ${o}`);
        if (o.some((n) => !level.names.includes(n))) bad.push(`${level.id}: 보기가 단계 밖`);
        if (prev && prev.progression === q.progression) bad.push(`${level.id}: 직전과 같은 진행`);
      }
      prev = q;
    }
    if (seenKeys.size < 10) bad.push(`${level.id}: 조가 ${seenKeys.size}가지뿐`);
    if (level.kind === "degrees" && level.pool.includes(0) && seenFirst.size < 2) bad.push(`${level.id}: 첫 코드가 늘 같다`);
  }
  ok("모든 단계에서 400문제씩 뽑아도 규칙(조 종류·길이·풀·연속 금지·보기)이 지켜진다", bad.length === 0, [...new Set(bad)].slice(0, 6));
}
{
  const rand = lcg(7);
  let first0 = 0;
  for (let i = 0; i < 400; i += 1) if (makeQuestion("L2", rand, true).degrees[0] === 0) first0 += 1;
  ok("첫 코드는 으뜸이 많지만(절반 넘게) 늘 그렇지는 않다", first0 > 200 && first0 < 400, first0);
}
{
  const fixed = makeQuestion("L1", lcg(1), false);
  ok("조 바꾸기를 끄면 C 장조 / A 단조", fixed.key.tonic === 0 && fixed.key.mode === "major" &&
    makeQuestion("L4", lcg(1), false).key.tonic === 9);
  const q = { level: "L2", key: Gmaj, degrees: [3, 4, 2, 5] };
  ok("정답 설명: G 장조에서 IV V iii vi = C D Bm Em", describeAnswer(q) === "IV V iii vi = C D Bm Em", describeAnswer(q));
  ok("채점: 다 맞으면 정답", grade(q, [3, 4, 2, 5]).correct);
  ok("채점: 하나 틀리면 그 칸만 틀림", JSON.stringify(grade(q, [3, 4, 5, 5]).marks) === "[true,true,false,true]" && !grade(q, [3, 4, 5, 5]).correct);
  ok("채점: 덜 눌렀으면 정답이 아니다", !grade(q, [3, 4, 2]).correct);
  const n = { level: "N1", key: Cmaj, degrees: [], progression: "komuro", options: ["komuro", "oudou"] };
  ok("정석 이름 채점", grade(n, "komuro").correct && !grade(n, "oudou").correct);
  ok("정석 진행을 설명하면 코드가 나온다", describeAnswer(n) === "vi IV V I = Am F G C", describeAnswer(n));
  ok("로마숫자 글자 (장조 · 단조)", [0, 1, 2, 3, 4, 5, 6].map((d) => degreeNumeral("major", d)).join(" ") === "I ii iii IV V vi vii°" &&
    [0, 1, 2, 3, 4, 5, 6].map((d) => degreeNumeral("minor", d)).join(" ") === "i ii° III iv v VI VII");
  ok("없는 단계는 undefined", levelById("zzz") === undefined && levelById("L3")?.pool.length === 7);
}

// ------------------------------------------------------------- 예제 곡의 조
//
// 예제 곡에 조를 달아 뒀다. 달린 조와 실제로 쓴 음이 어긋나면 화면이 「조 밖」
// 줄에 음을 잔뜩 그려 보여 주게 된다 — 예제가 틀린 걸 가르친다. 드럼은 음높이가
// 악기 번호라 빼고 본다.
for (const d of DEMOS) {
  const p = d.make();
  const pitched = p.tracks.filter((t) => !(t.source.kind === "sf2" && t.source.presetId >= 16384));
  const outside = pitched.flatMap((t) => t.notes.filter((n) => !inKey(n.pitch, p.key)).map((n) => `${t.name}:${n.pitch}`));
  ok(`예제 「${d.id}」 에 조가 있고 음이 전부 그 조 안이다`, !!p.key && outside.length === 0, { key: p.key, outside: outside.slice(0, 6) });
}

// ------------------------------------------------------------ 저장 파일
{
  const p = DEMOS[0].make();
  const back = projectFromJson(projectToJson(p));
  ok("저장했다 열면 조가 그대로다", back.key?.tonic === p.key.tonic && back.key?.mode === p.key.mode, back.key);
  const none = projectFromJson(JSON.stringify({ tracks: [] }));
  ok("조가 없는 파일은 조 없이 열린다 (빈 칸을 만들지 않는다)", !("key" in none), none.key);
  const bogus = projectFromJson(JSON.stringify({ tracks: [], key: { tonic: 99, mode: "major" } }));
  ok("이상한 조는 버리고 연다", !("key" in bogus), bogus.key);
}

for (const r of out) console.log(`${r.pass ? "  ok" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${JSON.stringify(r.d)}`}`);
console.log(bad ? `\n${bad}개 실패` : `\n전부 통과 (${out.length}개)`);
process.exit(bad ? 1 : 0);
