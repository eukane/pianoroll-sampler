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
import {
  MAX_WRONG, dayKey, degreeRows, emptyStore, questionId, recordAnswer, sanitizeQuestion, sanitizeStore, streak,
  topConfusions, weakWeights, weakest,
} from "../src/model/earStats.ts";
import {
  dropRedundantMeters, barAt, barBeatLabel, barIndexAt, barLength, barStartBeat, beatToSec, bpmAt, clickAtOrAfter, hasMeterChanges,
  isBarStart, nextClick, secToBeat, secondsBetween, sigAtBar, sigBeats, totalBeats as tlTotal, totalSeconds,
} from "../src/model/timeline.ts";
import { midiToProject, projectToMidi, PPQ } from "../src/export/midi.ts";
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

// ------------------------------------------------------------ 변박 · 템포 변화
//
// 가장 중요한 검사는 **변박·템포 변화가 없는 곡이 옛 식과 똑같은 값을 내는가** 다.
// 옛 식: 마디 = 박 ÷ beatsPerBar, 초 = 박 × 60 ÷ bpm. 기존 곡이 어긋나면 이 기능은 못 낸다.
{
  const bad = [];
  for (const sig of [[4, 4], [3, 4], [2, 4], [5, 4], [6, 8], [12, 8], [2, 2], [7, 8]]) {
    for (const bpm of [20, 60, 100, 137.5, 300]) {
      const p = { bpm, bars: 9, timeSig: sig, tracks: [] };
      const bpb = (sig[0] * 4) / sig[1];
      if (Math.abs(tlTotal(p) - 9 * bpb) > 1e-9) bad.push(["total", sig, bpm]);
      for (const beat of [0, 0.5, 1, bpb - 0.001, bpb, bpb + 0.25, 3 * bpb, 8.999 * bpb, 9 * bpb]) {
        if (Math.abs(beatToSec(p, beat) - (beat * 60) / bpm) > 1e-9) bad.push(["sec", sig, bpm, beat]);
        if (Math.abs(secToBeat(p, (beat * 60) / bpm) - beat) > 1e-9) bad.push(["beat", sig, bpm, beat]);
        if (barIndexAt(p, beat) !== Math.floor(beat / bpb + 1e-9)) bad.push(["bar", sig, bpm, beat]);
      }
      for (let b = 0; b <= 12; b += 1) if (Math.abs(barStartBeat(p, b) - b * bpb) > 1e-9) bad.push(["start", sig, b]);
      if (hasMeterChanges(p)) bad.push(["hasMeter", sig]);
    }
  }
  ok("변박·템포 변화가 없으면 옛 식과 똑같다 (8가지 박자 × 5가지 빠르기)", bad.length === 0, bad.slice(0, 4));
}
{
  // 4/4 두 마디 → 3/4 두 마디 → 7/8 한 마디 → (4/4 로 복귀) 한 마디. 박 단위로 손으로 센 값.
  const p = {
    bpm: 120, bars: 6, timeSig: [4, 4], tracks: [],
    meterChanges: [{ bar: 2, sig: [3, 4] }, { bar: 4, sig: [7, 8] }, { bar: 5, sig: [4, 4] }],
  };
  ok("마디 시작: 0 4 8 11 14 17.5", [0, 1, 2, 3, 4, 5].map((b) => barStartBeat(p, b)).join() === "0,4,8,11,14,17.5",
    [0, 1, 2, 3, 4, 5].map((b) => barStartBeat(p, b)));
  ok("곡 길이 = 4+4+3+3+3.5+4 = 21.5박", tlTotal(p) === 21.5, tlTotal(p));
  ok("마디 길이", [0, 2, 4, 5].map((b) => barLength(p, b)).join() === "4,3,3.5,4");
  ok("박 → 마디 번호 (마디선 위는 그 마디)", [0, 3.99, 4, 7.99, 8, 10.99, 11, 13.99, 14, 17.49, 17.5, 21.49].map((b) => barIndexAt(p, b)).join() === "0,0,1,1,2,2,3,3,4,4,5,5",
    [0, 3.99, 4, 7.99, 8, 10.99, 11, 13.99, 14, 17.49, 17.5, 21.49].map((b) => barIndexAt(p, b)));
  ok("박자 이름", [0, 1, 2, 3, 4, 5].map((b) => sigAtBar(p, b).join("/")).join() === "4/4,4/4,3/4,3/4,7/8,4/4");
  ok("곡 끝을 넘은 마디는 마지막 박자를 이어 센다", barStartBeat(p, 6) === 21.5 && barStartBeat(p, 7) === 25.5 && barLength(p, 9) === 4);
  const bar4 = barAt(p, 15);
  ok("barAt: 15박은 5번째 마디(7/8) [14, 17.5)", bar4.index === 4 && bar4.start === 14 && bar4.end === 17.5 && bar4.sig.join("/") === "7/8", bar4);
  ok("마디 라벨 「마디 : 박」", barBeatLabel(p, 0) === "1 : 1" && barBeatLabel(p, 9.5) === "3 : 2" && barBeatLabel(p, 17.5) === "6 : 1", [barBeatLabel(p, 9.5), barBeatLabel(p, 17.5)]);
  // 메트로놈: 마디마다 첫 박부터 센다. 7/8 마디(3.5박) 다음 마디는 정수 박이 아닌 17.5 에서 시작한다.
  const clicks = [];
  let c = clickAtOrAfter(p, 12);
  for (let i = 0; i < 9 && c < tlTotal(p) - 1e-6; i += 1) { clicks.push(c); c = nextClick(p, c); }
  ok("메트로놈 틱이 마디마다 마디 첫 박에서 다시 센다 (…12 13 14 15 16 17 17.5 18.5 19.5 20.5)", clicks.join() === "12,13,14,15,16,17,17.5,18.5,19.5", clicks);
  ok("마디 첫 박만 높은 틱", [11, 14, 17.5, 8].every((b) => isBarStart(p, b)) && ![12, 15, 17, 18.5].some((b) => isBarStart(p, b)));
  ok("틱을 박 중간에서 시작해도 다음 박에 맞춘다", clickAtOrAfter(p, 12.2) === 13 && clickAtOrAfter(p, 17.2) === 17.5 && clickAtOrAfter(p, 14) === 14);
  ok("마디 수를 줄여 변박이 곡 끝 뒤로 밀려도 곡 길이가 맞다", tlTotal({ ...p, bars: 3 }) === 11 && tlTotal({ ...p, bars: 1 }) === 4);
  const messy = { ...p, meterChanges: [{ bar: 0, sig: [9, 8] }, { bar: 2.5, sig: [3, 4] }, { bar: 2, sig: [3, 4] }, { bar: 2, sig: [6, 8] }, { bar: 3, sig: [0, 4] }] };
  ok("이상한 변박(0마디 · 소수 · 중복 · 분자 0)은 건너뛰고 계산이 터지지 않는다", barStartBeat(messy, 3) === 11 && tlTotal(messy) === 20 && hasMeterChanges(messy), [barStartBeat(messy, 3), tlTotal(messy)]);
}
{
  // 템포: 4박은 120, 이후는 60. 0~4박 = 2초, 4~8박 = 4초.
  const p = { bpm: 120, bars: 4, timeSig: [4, 4], tracks: [], tempoChanges: [{ beat: 4, bpm: 60 }, { beat: 12, bpm: 240 }] };
  ok("박 → 초: 0→0, 4→2, 8→6, 12→10, 14→10.5", [0, 4, 8, 12, 14].map((b) => beatToSec(p, b)).join() === "0,2,6,10,10.5", [0, 4, 8, 12, 14].map((b) => beatToSec(p, b)));
  ok("초 → 박 (거꾸로) — 왕복해도 같다", [0, 1, 2, 5.5, 10, 10.25].map((s) => beatToSec(p, secToBeat(p, s))).every((v, i) => Math.abs(v - [0, 1, 2, 5.5, 10, 10.25][i]) < 1e-9));
  ok("박 → 초 → 박 왕복", [0, 1.5, 4, 6.25, 12, 15.9].every((b) => Math.abs(secToBeat(p, beatToSec(p, b)) - b) < 1e-9));
  ok("그 박의 빠르기 (바뀌는 박 위는 새 빠르기)", [0, 3.99, 4, 11.99, 12, 15].map((b) => bpmAt(p, b)).join() === "120,120,60,60,240,240");
  ok("구간 사이 초", Math.abs(secondsBetween(p, 2, 6) - (1 + 2)) < 1e-9, secondsBetween(p, 2, 6));
  ok("곡 전체 초 = 2 + 8 + 1 = 11", Math.abs(totalSeconds(p) - 11) < 1e-9, totalSeconds(p));
  ok("20 BPM 아래는 20 으로 본다 (재생기가 늘 그렇게 했다)", beatToSec({ bpm: 5, bars: 1, timeSig: [4, 4], tracks: [] }, 4) === 12);
  const unsorted = { ...p, tempoChanges: [{ beat: 12, bpm: 240 }, { beat: 4, bpm: 60 }, { beat: 4, bpm: 99 }, { beat: -1, bpm: 80 }, { beat: 0, bpm: 70 }] };
  ok("템포 목록이 뒤섞이거나 이상해도 정리해서 계산한다", beatToSec(unsorted, 8) === 6 && bpmAt(unsorted, 0) === 120, beatToSec(unsorted, 8));
}
{
  // 변박 + 템포를 같이: 마디 길이는 박이라 템포와 무관하다.
  const p = { bpm: 90, bars: 4, timeSig: [3, 4], tracks: [], meterChanges: [{ bar: 2, sig: [4, 4] }], tempoChanges: [{ beat: 6, bpm: 180 }] };
  ok("변박과 템포를 같이 써도 마디는 박으로, 시간은 초로 따로 계산된다",
    barStartBeat(p, 2) === 6 && tlTotal(p) === 14 && Math.abs(beatToSec(p, 14) - (6 * 60 / 90 + 8 * 60 / 180)) < 1e-9, [tlTotal(p), beatToSec(p, 14)]);
}

// ----------------------------------------------- 변박 · 템포: 파일과 MIDI 로 나갔다 들어오기
{
  const note = (id, pitch, start, length) => ({ id, pitch, start, length, velocity: 100 });
  const base = () => ({
    bpm: 100, bars: 5, timeSig: [4, 4],
    meterChanges: [{ bar: 2, sig: [3, 4] }, { bar: 4, sig: [7, 8] }],
    tempoChanges: [{ beat: 6, bpm: 140 }, { beat: 13, bpm: 90.5 }],
    tracks: [{
      id: "t", name: "피아노", source: { kind: "sf2", presetId: 0 }, volume: 0.8, pan: 0, muted: false,
      notes: [note("a", 60, 0, 1), note("b", 64, 8, 2), note("c", 67, 11, 3), note("d", 72, 14, 3.5)],
    }],
  });
  const p0 = base();

  // 저장 파일
  const back = projectFromJson(projectToJson(p0));
  ok("저장했다 열면 변박이 그대로다", JSON.stringify(back.meterChanges) === JSON.stringify(p0.meterChanges), back.meterChanges);
  ok("저장했다 열면 템포 변화가 그대로다", JSON.stringify(back.tempoChanges) === JSON.stringify(p0.tempoChanges), back.tempoChanges);
  ok("저장했다 열어도 곡 길이(박·초)가 그대로다", tlTotal(back) === tlTotal(p0) && Math.abs(totalSeconds(back) - totalSeconds(p0)) < 1e-9);
  const old = projectFromJson(JSON.stringify({ bpm: 100, bars: 4, timeSig: [3, 4], tracks: [] }));
  ok("예전 파일(변박·템포 없음)은 그 필드 없이 열린다", !("meterChanges" in old) && !("tempoChanges" in old) && old.timeSig.join() === "3,4", old);
  const junk = projectFromJson(JSON.stringify({
    bpm: 100, bars: 4, timeSig: [4, 4], tracks: [],
    meterChanges: [{ bar: 0, sig: [3, 4] }, { bar: 1.5, sig: [3, 4] }, "x", null, { bar: 2, sig: [3, 4] }, { bar: 2, sig: [5, 4] }, { sig: [2, 4] }],
    tempoChanges: [{ beat: 0, bpm: 90 }, { beat: -3, bpm: 90 }, { beat: 8, bpm: 9999 }, { beat: 8, bpm: 70 }, { beat: "a", bpm: 80 }, null],
  }));
  ok("이상한 항목만 버리고 쓸 수 있는 건 남긴다 (변박)", JSON.stringify(junk.meterChanges) === JSON.stringify([{ bar: 2, sig: [3, 4] }]), junk.meterChanges);
  ok("이상한 항목만 버리고 쓸 수 있는 건 남긴다 (템포: 범위 밖 BPM 은 300 으로)", JSON.stringify(junk.tempoChanges) === JSON.stringify([{ beat: 8, bpm: 300 }]), junk.tempoChanges);
  ok("전부 쓸 수 없으면 필드가 아예 없다", !("meterChanges" in projectFromJson(JSON.stringify({ tracks: [], meterChanges: [{ bar: 0, sig: [3, 4] }], tempoChanges: [{ beat: 0, bpm: 90 }] }))));

  // MIDI 왕복
  const bytes = projectToMidi(p0);
  const mid = midiToProject(bytes);
  ok("MIDI 왕복: 처음 박자·빠르기", mid.timeSig.join() === "4,4" && mid.bpm === 100, [mid.timeSig, mid.bpm]);
  ok("MIDI 왕복: 변박이 같은 마디에 같은 박자로 돌아온다", JSON.stringify(mid.meterChanges) === JSON.stringify(p0.meterChanges), mid.meterChanges);
  ok("MIDI 왕복: 템포 변화가 같은 박에 같은 값으로 돌아온다 (90.5 도 소수 첫째 자리까지)",
    JSON.stringify(mid.tempoChanges) === JSON.stringify(p0.tempoChanges), mid.tempoChanges);
  ok("MIDI 왕복: 노트가 그대로 (박 단위로 변박·템포와 무관)",
    JSON.stringify(mid.tracks[0].notes.map((n) => [n.pitch, n.start, n.length])) === JSON.stringify(p0.tracks[0].notes.map((n) => [n.pitch, n.start, n.length])));
  ok("MIDI 왕복: 곡 길이(박)가 마지막 노트를 담는다 — 17.5박이 끝이라 변박 5마디", tlTotal(mid) >= 17.5 && mid.bars === 5, [mid.bars, tlTotal(mid)]);
  ok("MIDI 왕복 두 번째도 같다", JSON.stringify(midiToProject(projectToMidi(mid)).tempoChanges) === JSON.stringify(mid.tempoChanges));
  ok("틱은 박 × " + PPQ + " 라 템포가 바뀌어도 노트 틱이 안 변한다", (() => {
    const flat = { ...p0 }; delete flat.tempoChanges;
    const a = midiToProject(projectToMidi(flat)).tracks[0].notes.map((n) => n.start).join();
    return a === mid.tracks[0].notes.map((n) => n.start).join();
  })());
  const plain = midiToProject(projectToMidi({ bpm: 120, bars: 2, timeSig: [3, 4], tracks: p0.tracks.map((t) => ({ ...t, notes: [note("z", 60, 0, 1)] })) }));
  ok("변박·템포가 없는 곡은 MIDI 로 나갔다 와도 그 필드가 안 생긴다", !("meterChanges" in plain) && !("tempoChanges" in plain) && plain.timeSig.join() === "3,4", plain);

  // 마디 중간에 놓인 박자 이벤트와 같은 값 반복은 정리된다
  ok("같은 박자로 「바뀌는」 항목은 변박이 아니다", JSON.stringify(dropRedundantMeters([4, 4], [{ bar: 2, sig: [4, 4] }, { bar: 3, sig: [3, 4] }, { bar: 5, sig: [3, 4] }, { bar: 6, sig: [4, 4] }])) ===
    JSON.stringify([{ bar: 3, sig: [3, 4] }, { bar: 6, sig: [4, 4] }]));
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


// ------------------------------------------------------------ 귀 훈련 기록 (model/earStats.ts)
{
  const day = (y, m, d) => new Date(y, m - 1, d, 12);
  const today = day(2026, 11, 1);

  // 읽기: 믿지 않는다
  const e0 = sanitizeStore(null);
  ok("저장된 게 없거나 깨졌으면 빈 기록", e0.goal === 20 && e0.wrong.length === 0 && Object.keys(e0.tally).length === 0 &&
    sanitizeStore("zzz").goal === 20 && sanitizeStore([1, 2]).wrong.length === 0);
  const old = sanitizeStore({ level: "L2", tally: { L2: { right: 3, total: 5 }, ZZ: { right: 1, total: 1 } } });
  ok("옛 형식(단계 · 단계별 맞힘)은 그대로 읽는다 / 없는 단계는 버린다", old.level === "L2" && old.tally.L2.right === 3 && old.tally.L2.total === 5 && !("ZZ" in old.tally), old);
  const odd = sanitizeStore({ tally: { L1: { right: 9, total: 4 } }, goal: 7, degrees: { major: { asked: [1, -3, "x"], right: [5, 1, 1] } }, days: { "abc": { right: 1, total: 1 }, "2026-11-01": { right: 2, total: 3 } } });
  ok("맞힌 수가 푼 수보다 크거나 음수·글자면 바로잡는다", odd.tally.L1.right === 4 && odd.goal === 20 && odd.degrees.major.asked.slice(0, 3).join() === "1,0,0" && odd.degrees.major.right[0] === 1 && !("abc" in odd.days) && odd.days["2026-11-01"].total === 3, odd);
  ok("고른 질문 모양 검사: 맞는 것만 통과", sanitizeQuestion({ level: "L2", key: { tonic: 7, mode: "major" }, degrees: [0, 3, 4, 5] })?.degrees.length === 4 &&
    sanitizeQuestion({ level: "L2", key: { tonic: 7, mode: "minor" }, degrees: [0, 3, 4, 5] }) === null &&
    sanitizeQuestion({ level: "L2", key: { tonic: 7, mode: "major" }, degrees: [0, 3, 4, 2] }) === null &&
    sanitizeQuestion({ level: "L2", key: { tonic: 7, mode: "major" }, degrees: [0, 3, 4] }) === null &&
    sanitizeQuestion({ level: "L2", key: { tonic: 12, mode: "major" }, degrees: [0, 3, 4, 5] }) === null &&
    sanitizeQuestion({ level: "N1", key: { tonic: 0, mode: "major" }, degrees: [], progression: "komuro", options: ["komuro", "oudou"] })?.progression === "komuro" &&
    sanitizeQuestion({ level: "N1", key: { tonic: 0, mode: "major" }, degrees: [], progression: "komuro", options: ["oudou"] }) === null &&
    sanitizeQuestion({ level: "N1", key: { tonic: 0, mode: "major" }, degrees: [], progression: "m-flat", options: ["m-flat"] }) === null);

  // 쓰기: 칸마다 센다
  const s = emptyStore();
  const q = { level: "L2", key: Gmaj, degrees: [0, 3, 4, 5] };
  recordAnswer(s, q, [0, 3, 0, 5], false, today);
  ok("칸 하나하나가 기록된다 (4칸 중 3칸 맞음)", s.degrees.major.asked[0] === 1 && s.degrees.major.right[0] === 1 && s.degrees.major.asked[4] === 1 && s.degrees.major.right[4] === 0 && s.degrees.major.right[5] === 1);
  ok("틀린 칸의 헷갈린 쌍이 남는다 (V 를 I 로)", s.confusions["major:4>0"] === 1, s.confusions);
  ok("문제 단위: 단계 기록은 0/1, 오늘은 0/1", s.tally.L2.total === 1 && s.tally.L2.right === 0 && s.days["2026-11-01"].total === 1);
  ok("틀린 문제 목록에 들어간다", s.wrong.length === 1 && questionId(s.wrong[0]) === questionId(q));
  recordAnswer(s, q, [0, 3, 4, 5], true, today);
  ok("같은 문제를 맞히면 목록에서 빠진다 (복습 졸업) · 조 다르면 다른 문제", s.wrong.length === 0 &&
    questionId(q) !== questionId({ ...q, key: Ebmaj }));
  const q2 = { level: "L2", key: Gmaj, degrees: [3, 4, 0, 5] };
  recordAnswer(s, q, [0, 3, 0, 5], false, today);
  recordAnswer(s, q2, [3, 4, 0, 4], false, today);
  recordAnswer(s, q, [0, 3, 0, 5], false, today);
  ok("같은 문제를 또 틀리면 목록에서 맨 뒤로 간다 (중복 없음)", s.wrong.length === 2 && questionId(s.wrong[0]) === questionId(q2) && questionId(s.wrong[1]) === questionId(q));
  const many = emptyStore();
  for (let i = 0; i < 45; i += 1) recordAnswer(many, { level: "L1", key: { tonic: i % 12, mode: "major" }, degrees: [0, 3, 4].map((d, k) => [0, 3, 4][(k + i) % 3]) }, [9, 9, 9], false, today);
  ok(`틀린 문제는 ${MAX_WRONG}개까지만 남긴다`, many.wrong.length <= MAX_WRONG, many.wrong.length);
  const named = emptyStore();
  recordAnswer(named, { level: "N1", key: Cmaj, degrees: [], progression: "komuro", options: ["komuro", "oudou"] }, "oudou", false, today);
  ok("정석 이름 단계는 진행별로 기록하고 도수 기록은 건드리지 않는다", named.progs.komuro.total === 1 && named.progs.komuro.right === 0 &&
    named.degrees.major.asked.every((x) => x === 0) && Object.keys(named.confusions).length === 0 && named.wrong.length === 1);
  ok("저장했다 읽어도 같다", JSON.stringify(sanitizeStore(JSON.parse(JSON.stringify(s)))) === JSON.stringify(s));

  // 보여 주기
  const rows = degreeRows(s, "major", [0, 3, 4, 5]);
  ok("도수별 정답률: 한 번도 안 나온 도수는 0% 가 아니라 null", degreeRows(emptyStore(), "major", [0]).every((r) => r.rate === null) && rows.find((r) => r.degree === 0).rate === 1 && rows.find((r) => r.degree === 4).rate === 0.4, rows);
  const cs = emptyStore();
  cs.confusions = { "major:5>2": 4, "major:4>0": 4, "major:1>3": 1, "minor:5>2": 9 };
  const top = topConfusions(cs, "major", 2);
  ok("헷갈린 쌍: 많은 순, 같으면 도수 순 · 다른 조 종류는 섞지 않는다", top.length === 2 && top[0].asked === 4 && top[1].asked === 5 && topConfusions(cs, "minor").length === 1);

  // 약한 도수
  const w = emptyStore();
  w.degrees.major = { asked: [10, 0, 0, 3, 8, 8, 0], right: [10, 0, 0, 0, 2, 8, 0] };
  const wts = weakWeights(w, "major", [0, 3, 4, 5]);
  ok("가중치: 100% → 1, 표본 모자라면(3번) 1, 25% → 3.25, 100% → 1", wts[0] === 1 && wts[1] === 1 && Math.abs(wts[2] - 3.25) < 1e-9 && wts[3] === 1, wts);
  ok("가장 약한 도수: V (표본이 모자란 IV 는 제외)", weakest(w, "major", [0, 3, 4, 5])?.degree === 4 && weakest(emptyStore(), "major", [0, 3, 4]) === null);
  {
    const pool = [0, 3, 4];
    const count4 = (weights, seed) => {
      const r = lcg(seed);
      let n = 0; let prev;
      for (let i = 0; i < 600; i += 1) {
        const qq = makeQuestion("L1", r, true, prev, weights);
        for (let k = 1; k < qq.degrees.length; k += 1) if (qq.degrees[k] === qq.degrees[k - 1]) throw new Error("연속");
        n += qq.degrees.filter((d) => d === 4).length;
        prev = qq;
      }
      return n;
    };
    const plain = count4(undefined, 99);
    const heavy = count4([1, 1, 4], 99);
    ok("약한 도수 가중치를 주면 그 도수가 더 자주 나온다 (규칙은 그대로)", heavy > plain * 1.15, { plain, heavy });
    const a = []; const b = [];
    { const r1 = lcg(5); const r2 = lcg(5); for (let i = 0; i < 30; i += 1) { a.push(makeQuestion("L3", r1, true).degrees.join()); b.push(makeQuestion("L3", r2, true, undefined, [1, 2]).degrees.join()); } }
    ok("가중치가 없거나 길이가 안 맞으면 예전과 똑같이 뽑는다", a.join("|") === b.join("|"));
    void pool;
  }

  // 날짜 · 연속 일수
  ok("날짜 키는 이 기기의 날짜 (한 자리 월·일에 0 을 붙인다)", dayKey(new Date(2026, 0, 5, 23, 59)) === "2026-01-05" && dayKey(new Date(2026, 10, 1, 0, 0)) === "2026-11-01");
  const T = (n) => ({ right: n, total: n });
  ok("연속 일수: 오늘·어제·그제 → 3", streak({ "2026-11-01": T(1), "2026-10-31": T(2), "2026-10-30": T(1) }, today) === 3);
  ok("오늘 아직 안 풀었어도 어제까지 이어졌으면 끊기지 않았다", streak({ "2026-10-31": T(2), "2026-10-30": T(1) }, today) === 2);
  ok("하루 건너뛰면 끊긴다", streak({ "2026-11-01": T(1), "2026-10-30": T(1) }, today) === 1 && streak({ "2026-10-30": T(5) }, today) === 0);
  ok("달이 바뀌어도 이어진다 (10월 31일 → 11월 1일)", streak({ "2026-11-01": T(1), "2026-10-31": T(1) }, today) === 2 && streak({ "2026-03-01": T(1), "2026-02-28": T(1) }, day(2026, 3, 1)) === 2);
  ok("풀이 수가 0 인 날은 푼 날이 아니다", streak({ "2026-11-01": { right: 0, total: 0 } }, today) === 0);
}

for (const r of out) console.log(`${r.pass ? "  ok" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${JSON.stringify(r.d)}`}`);
console.log(bad ? `\n${bad}개 실패` : `\n전부 통과 (${out.length}개)`);
process.exit(bad ? 1 : 0);
