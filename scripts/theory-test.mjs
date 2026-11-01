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
import { chordNames, explainTranspose, gradeTranspose, makeTransposeQuestion, recordTranspose, sanitizeTransposeStore, emptyTransposeStore, TRANSPOSE_PROGS } from "../src/model/transpose.ts";
import { applyBackup, makeBackup, parseBackup } from "../src/model/backup.ts";
import { parseChordSymbol, splitCell } from "../src/model/chordSymbol.ts";
import {
  barIndexAt as copyBarIndexAt, cellAt, defaultState as copyDefault, loopFromBar, positionLabel, sanitizeState as copySanitize, shiftLoop, tapTempo, storageKey,
} from "../src/model/copyNotebook.ts";
import { chordLine, identifyChord, inversionLabel, romanNumeral } from "../src/model/chord.ts";
import {
  PROGRESSIONS, chordPitches, diatonicChords, progressionPitches, progressionsFor,
} from "../src/model/progression.ts";
import {
  LEVELS, QUALITIES, degreeNumeral, describeAnswer, grade, levelById, levelNames, levelsForLesson, makeQuestion,
  namedAnswer, qualityPitches, questionChords,
} from "../src/model/ear.ts";
import { LESSONS, clampLesson, focusLevels, visibleLevels } from "../src/model/lessons.ts";
import {
  MAX_WRONG, dayKey, degreeRows, emptyStore, questionId, recordAnswer, sanitizeQuestion, sanitizeStore, streak,
  namedConfusions, topConfusions, weakWeights, weakest,
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
        if (!level.allowRepeat && q.degrees.some((d, k) => k > 0 && d === q.degrees[k - 1])) bad.push(`${level.id}: 같은 코드 연속`);
        if (level.allowRepeat && new Set(q.degrees).size < 2) bad.push(`${level.id}: 전부 같은 코드`);
        if (prev && prev.degrees.join() === q.degrees.join()) bad.push(`${level.id}: 직전과 같은 문제`);
        const { chords, tonic } = questionChords(q);
        if (chords.length !== level.length || tonic.length !== 3) bad.push(`${level.id}: 들려줄 코드`);
      } else if (level.kind === "quality") {
        const o = q.options ?? [];
        if (q.progression || !level.choices.includes(q.quality) || o.join() !== level.choices.join()) bad.push(`${level.id}: 종류 보기 ${o}`);
        const { chords, tonic } = questionChords(q);
        if (tonic.length !== 0 || chords.length !== 1) bad.push(`${level.id}: 종류 문제는 코드 하나만`);
        if (prev && prev.quality === q.quality && prev.key.tonic === q.key.tonic) bad.push(`${level.id}: 직전과 같은 소리`);
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



// ------------------------------------------------------------ 수업 회차 연결 (model/lessons.ts · ear.ts)
{
  ok("회차는 1~7 일곱 개, 번호가 차례로", LESSONS.length === 7 && LESSONS.every((l, i) => l.n === i + 1));
  ok("추천 단계는 전부 실제로 있는 단계이고, 그 회차까지 배우면 풀 수 있다",
    LESSONS.every((l) => l.focus.length > 0 && l.focus.every((id) => { const lv = levelById(id); return lv && lv.lesson <= l.n; })),
    LESSONS.map((l) => [l.n, l.focus.map((id) => levelById(id)?.lesson)]));
  ok("노트에 적힌 귀 훈련은 1~3회차 (I 와 V 구분 · 장/단 코드 구분), 4회차부터는 내가 붙인 추천",
    LESSONS.slice(0, 3).every((l) => l.fromNotes) && LESSONS.slice(3).every((l) => !l.fromNotes) &&
    LESSONS[1].ear === "I 와 V 구분" && LESSONS[2].ear === "장/단 코드 구분");
  ok("1회차까지: 단조 · 7화음 · I-V 구분 · 5~7회차 단계는 아직 없다",
    visibleLevels(1).map((l) => l.id).join() === "L1,L2,L3,Q1,Q2,N1", visibleLevels(1).map((l) => l.id));
  ok("2회차에 E2, 3회차에 Q3, 4회차에 단조(L4 · N2), 5·6·7회차에 N3 · N4 · N5 가 열린다",
    levelsForLesson(2).map((l) => l.id).join() === "L1,L2,L3,Q1,Q2,N1,E2,B1" &&
    levelsForLesson(3).map((l) => l.id).includes("Q3") && !levelsForLesson(2).some((l) => l.id === "Q3") &&
    levelsForLesson(4).filter((l) => l.mode === "minor").map((l) => l.id).join() === "L4,N2,B3" &&
    ["N3", "N4", "N5"].every((id, i) => levelById(id).lesson === 5 + i));
  ok("단계는 회차 순으로 나열돼 있다 (선택 목록이 회차별로 묶이게)", LEVELS.every((l, i) => i === 0 || LEVELS[i - 1].lesson <= l.lesson));
  ok("7회차까지면 전부, 이상한 값은 7 로", visibleLevels(7).length === LEVELS.length && clampLesson(0) === 7 && clampLesson("3") === 7 && clampLesson(8) === 7 && clampLesson(3) === 3);
  ok("추천 단계는 배운 곳까지에 맞춰 걸러진다 (3회차 추천 Q1·Q3 인데 2회차까지만 배웠으면 Q1 만)",
    focusLevels(3).map((l) => l.id).join() === "Q1,Q3" && focusLevels(3, 2).map((l) => l.id).join() === "Q1");

  // 이름 맞히기: 아직 안 배운 진행은 후보가 아니다
  const n1 = levelById("N1");
  ok("1회차의 정석 이름: 왕도 · 코무로 · 카논 · I–vi–IV–V · I–IV–V–I 만 (2-5-1 은 아직)",
    levelNames(n1, 1).sort().join() === "basic,canon,doowop,komuro,oudou", levelNames(n1, 1));
  ok("2회차에 2-5-1(3화음), 3회차에 7화음 2-5-1 이 후보에 들어온다",
    levelNames(n1, 2).includes("251t") && !levelNames(n1, 2).includes("251") && levelNames(n1, 3).includes("251"));
  {
    const bad = [];
    const rand = lcg(2024);
    let prev;
    for (let i = 0; i < 300; i += 1) {
      const q = makeQuestion("N1", rand, true, prev, undefined, 1);
      if (!levelNames(n1, 1).includes(q.progression)) bad.push(`정답 ${q.progression}`);
      if (q.options.some((o) => !levelNames(n1, 1).includes(o))) bad.push(`보기 ${q.options}`);
      prev = q;
    }
    ok("1회차로 뽑으면 정답도 보기도 1회차까지 배운 진행뿐이다 (300문제)", bad.length === 0, bad.slice(0, 3));
    const seen = new Set();
    for (let i = 0; i < 300; i += 1) seen.add(makeQuestion("N1", rand, true, undefined, undefined, 3).progression);
    ok("3회차로 뽑으면 2-5-1 도 나온다", seen.has("251") && seen.has("251t"), [...seen]);
  }

  // 회차마다 늘어나는 코드가 실제로 그 소리인지 (이름이 곧 이론이라 박아 둔다)
  const names = (id) => progressionPitches(Cmaj, PROGRESSIONS.find((p) => p.id === id)).map((p) => identifyChord(p, Cmaj).name).join(" ");
  ok("2회차 2-5-1 3화음 = Dm G C", names("251t") === "Dm G C", names("251t"));
  ok("5회차: 왕도의 iii(Em) 를 III 로 바꾸면 E, III7 이면 E7 — 다음 코드 Am 을 끌어당긴다",
    names("oudou-III") === "F G E Am" && names("oudou-III7") === "F G E7 Am", [names("oudou-III"), names("oudou-III7")]);
  ok("6회차: IV(F) 를 단조로 빌리면 Fm — 3음이 조 밖(Ab)", names("borrow-iv") === "C F Fm C" && names("borrow-iv2") === "C Am Fm G" &&
    !inKey(chordPitches(Cmaj, { degree: 3, minor: true })[1], Cmaj));
  ok("7회차: add9 는 9음(레)이 얹히고 sus4 는 3음 자리에 4음(도)이 온다 (Gsus4 = 솔 도 레)", names("add9-pop") === "Cadd9 Am Fadd9 G" && names("sus-v") === "C F Gsus4 G" &&
    chordPitches(Cmaj, { degree: 4, sus4: true }).map((p) => p % 12).join() === "7,0,2", [names("add9-pop"), names("sus-v")]);
  ok("단조의 정석 진행에서도 새 변형이 원래 코드를 안 바꾼다 (옛 진행 그대로)",
    progressionPitches(Amin, PROGRESSIONS.find((p) => p.id === "m-andalus")).map((p) => identifyChord(p, Amin).name).join(" ") === "Am G F E");

  // 코드 종류 듣기: 수업 노트의 반음 세기 그대로
  const pcs = (root, quality) => qualityPitches(root, quality).map((p) => (p - root + 120) % 12).join();
  ok("종류별 근음 위 간격: 장 0,4,7 · 단 0,3,7 · 감 0,3,6 · maj7 0,4,7,11 · m7 0,3,7,10 · 7 0,4,7,10",
    pcs(0, "maj") === "0,4,7" && pcs(5, "min") === "0,3,7" && pcs(2, "dim") === "0,3,6" && pcs(7, "maj7") === "0,4,7,11" &&
    pcs(9, "m7") === "0,3,7,10" && pcs(11, "dom7") === "0,4,7,10");
  {
    const all = Object.keys(QUALITIES);
    const same = [];
    for (let root = 0; root < 12; root += 1) for (const qid of all) {
      const ps = qualityPitches(root, qid);
      const info = identifyChord(ps);
      if (!info || info.root !== root || !info.base.endsWith(QUALITIES[qid].suffix) || info.base.length > 8) same.push(`${root}:${qid}→${info?.name}`);
      if (info && QUALITIES[qid].suffix === "" && !/^[A-G][#b]?$/.test(info.base)) same.push(`${root}:${qid} 장3화음 이름 ${info.base}`);
      if (ps[0] < 55 || ps[0] > 66) same.push(`${root}:${qid} 음역 ${ps[0]}`);
    }
    ok("12개 근음 × 6가지 종류 전부, 코드 이름 읽기가 정답과 같고 건반 가운데 음역이다", same.length === 0, same.slice(0, 4));
  }
  {
    const q = { level: "Q1", key: { tonic: 3, mode: "major" }, degrees: [], quality: "min", options: ["maj", "min"] };
    ok("종류 문제 채점·설명: Eb 단3화음", grade(q, "min").correct && !grade(q, "maj").correct && namedAnswer(q) === "min" &&
      /^(Ebm|D#m) — 단3화음 \(.*반음 3개/.test(describeAnswer(q)), describeAnswer(q));
  }
  {
    const rand = lcg(31);
    const seenQ = new Set(); const seenRoot = new Set(); let prev;
    for (let i = 0; i < 200; i += 1) {
      const q = makeQuestion("Q2", rand, true, prev);
      seenQ.add(q.quality); seenRoot.add(q.key.tonic); prev = q;
    }
    ok("종류 문제는 근음이 12가지로 바뀌고, 보기 종류가 전부 나온다", seenQ.size === 3 && seenRoot.size === 12, [seenQ.size, seenRoot.size]);
    const fixed = makeQuestion("Q1", lcg(2), false);
    ok("조 바꾸기를 끄면 근음은 C", fixed.key.tonic === 0);
  }
  {
    const rand = lcg(77);
    const combos = new Set();
    for (let i = 0; i < 200; i += 1) combos.add(makeQuestion("E2", rand, false).degrees.join(""));
    ok("I·V 구분 단계는 같은 코드 연속을 허용해서 문제가 여러 가지다 (전부 같은 건 제외 = 14가지)", combos.size >= 10 && ![...combos].some((c) => /^(00000|0000|4444)$/.test(c)), combos.size);
  }
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
    named.degrees.major.asked.every((x) => x === 0) && Object.keys(named.confusions).join() === "p:komuro>oudou" && named.wrong.length === 1);
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

// ------------------------------------------------------------ 귀 훈련 기록: 회차 · 코드 종류 · 이름 헷갈림
{
  const today = new Date(2026, 10, 1, 12);
  ok("배운 곳까지: 없거나 이상하면 7(전부), 1~7 이면 그대로", sanitizeStore(null).lesson === 7 && sanitizeStore({ lesson: 0 }).lesson === 7 &&
    sanitizeStore({ lesson: "2" }).lesson === 7 && sanitizeStore({ lesson: 2.5 }).lesson === 7 && sanitizeStore({ lesson: 3 }).lesson === 3);
  const s = emptyStore();
  const q = { level: "Q2", key: { tonic: 4, mode: "major" }, degrees: [], quality: "maj", options: ["maj", "min", "dim"] };
  recordAnswer(s, q, "min", false, today);
  recordAnswer(s, { ...q, key: { tonic: 7, mode: "major" } }, "maj", true, today);
  ok("코드 종류: 종류별 기록 · 헷갈린 쌍 (장3화음을 단3화음으로) · 도수 기록은 그대로", s.quals.maj.total === 2 && s.quals.maj.right === 1 &&
    s.confusions["q:maj>min"] === 1 && s.degrees.major.asked.every((x) => x === 0) && s.wrong.length === 1 && s.wrong[0].quality === "maj", s);
  ok("틀린 문제 id 는 근음이 다르면 다른 문제 · 맞히면 그 문제만 빠진다", s.wrong.length === 1 && s.wrong[0].key.tonic === 4);
  const n = emptyStore();
  recordAnswer(n, { level: "N3", key: Cmaj, degrees: [], progression: "oudou-III", options: ["oudou", "oudou-III", "oudou-III7"] }, "oudou", false, today);
  recordAnswer(n, { level: "N3", key: Gmaj, degrees: [], progression: "oudou-III", options: ["oudou", "oudou-III", "oudou-III7"] }, "oudou", false, today);
  const nc = namedConfusions(n, "p");
  ok("진행 이름 헷갈림: 「왕도+III 를 왕도로」 2번, 종류와는 따로 센다", nc.length === 1 && nc[0].asked === "oudou-III" && nc[0].answered === "oudou" && nc[0].count === 2 && namedConfusions(n, "q").length === 0, nc);
  const back = sanitizeStore(JSON.parse(JSON.stringify({ ...n, confusions: { ...n.confusions, "q:zzz>maj": 3, "p:nope>oudou": 1, "major:9>1": 2 } })));
  ok("모르는 종류·진행·도수가 든 헷갈림 기록은 버린다 (읽을 때 걸러진다)", Object.keys(back.confusions).join() === "p:oudou-III>oudou", back.confusions);
  ok("저장된 틀린 문제가 코드 종류 문제여도 읽힌다 · 보기가 단계와 다르면 버린다",
    sanitizeStore({ wrong: [{ level: "Q1", key: { tonic: 2, mode: "major" }, degrees: [], quality: "min", options: ["maj", "min"] },
      { level: "Q1", key: { tonic: 2, mode: "major" }, degrees: [], quality: "dim" }] }).wrong.length === 1);
}

// ------------------------------------------------------------ 코드 따기 (model/chordSymbol.ts · copyNotebook.ts)
{
  const suffixes = ["", "m", "dim", "aug", "7", "maj7", "m7", "m7b5", "dim7", "mMaj7", "sus4", "sus2", "7sus4", "add9", "madd9", "6", "m6", "9", "maj9", "m9"];
  const bad = [];
  for (let root = 0; root < 12; root += 1) {
    for (const suf of suffixes) {
      const letters = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][root];
      const sym = letters + suf;
      const p = parseChordSymbol(sym);
      if (!p) { bad.push(["null", sym]); continue; }
      // 베이스(맨 앞)를 빼고 코드 음만 이름으로 되돌린다: 같은 소리가 같은 뜻이어야 한다
      const back = identifyChord(p.pitches.slice(1), null);
      if (!back || back.root !== root) bad.push([sym, back?.name]);
      const low = Math.min(...p.pitches);
      if (low < 36 || Math.max(...p.pitches) > 84) bad.push(["범위", sym, p.pitches]);
    }
  }
  ok("모든 근음 × 모든 꼬리: 읽힌 소리를 다시 이름 붙이면 같은 근음이다 · 음이 낮은 자리에 모인다", bad.length === 0, bad.slice(0, 5));
  ok("흔한 별칭: Am7 · C#m · Bb · Fmaj7 · Dsus · CM7 · C△7 · Cmin7 · Bø", ["Am7", "C#m", "Bb", "Fmaj7", "Dsus", "CM7", "C△7", "Cmin7", "Bø"].every((x) => parseChordSymbol(x) !== null));
  ok("♭ ♯ 와 공백도 받는다: 「B♭ maj7」 = Bbmaj7", parseChordSymbol("B♭ maj7")?.name === "Bbmaj7");
  const sl = parseChordSymbol("F/A");
  ok("슬래시 코드: F/A 는 맨 아래가 A, 그 위에 F 코드", sl?.bassPc === 9 && sl.name === "F/A" && sl.pitches[0] % 12 === 9 && sl.pitches[0] < sl.pitches[1], sl);
  ok("기본 베이스는 근음의 한 옥타브 아래", (() => { const p = parseChordSymbol("Am"); return p.pitches[0] === p.pitches[1] - 12; })());
  ok("읽을 수 없는 건 null: 빈칸 · H · Cxyz · C/ · C/H · 숫자", ["", "  ", "H", "Cxyz", "C/", "C/H", "7", "Am7/"].every((x) => parseChordSymbol(x) === null));
  ok("한 칸 나누기: 「Am F」 「Am,F」 「Am | F」 → 둘, 「-」는 버림", splitCell("Am F").length === 2 && splitCell("Am,F").length === 2 && splitCell("Am | F").join() === "Am,F" && splitCell(" - ").length === 0);

  const st = { ...copyDefault(), bpm: 120, beatsPerBar: 4, offset: 1, firstBar: 1, cells: ["C", "Am F", "", "G7"] };
  ok("마디 길이: 120BPM 4박 = 2초 · 1박 시작 1초 → 3초는 2번째 마디(색인 1)", copyBarIndexAt(3, 1, 2) === 1 && copyBarIndexAt(2.999, 1, 2) === 0);
  ok("offset 앞은 음수 마디", copyBarIndexAt(0.5, 1, 2) === -1);
  ok("위치 표시: 3.5초 = 2마디 2.0박", positionLabel(3.5, st) === "2마디 2.0박", positionLabel(3.5, st));
  ok("cellAt: 1.5초 = C(1마디)", cellAt(1.5, st)?.symbol === "C");
  ok("cellAt: 한 칸에 둘이면 반씩 — 3.5초 Am, 4.5초 F", cellAt(3.5, st)?.symbol === "Am" && cellAt(4.5, st)?.symbol === "F" && cellAt(3.5, st).count === 2);
  ok("cellAt: 빈 칸 · 표 밖 · offset 앞은 null", cellAt(5.5, st) === null && cellAt(99, st) === null && cellAt(0.5, st) === null);
  ok("cellAt: firstBar=3 이면 3마디부터 표가 시작", cellAt(1.5, { ...st, firstBar: 3 }) === null && cellAt(5.5, { ...st, firstBar: 3 })?.symbol === "C");
  const lb = loopFromBar(4.2, 2, st, 100);
  ok("이 마디부터 2마디: 4.2초는 2번째 마디 → 3~7초", lb.a === 3 && lb.b === 7, lb);
  ok("구간이 곡 끝을 넘으면 곡 길이에서 자른다", loopFromBar(9, 4, st, 10).b === 10);
  ok("다음 구간: 같은 길이만큼 · 끝을 넘어서면 그대로", shiftLoop({ a: 3, b: 7 }, 1, 100).a === 7 && (() => { const l = { a: 3, b: 7 }; return shiftLoop(l, 1, 6) === l && shiftLoop({ a: 0, b: 4 }, -1, 100).a === 0; })());
  ok("탭 템포: 0.5초 간격 = 120 · 한 번 늦어도 중앙값이라 흔들리지 않는다", tapTempo([0, 0.5, 1, 1.5, 2.1, 2.6]) === 120 && tapTempo([0, 0.5]) === null && tapTempo([0, 5, 10]) === null);
  ok("탭 템포는 30~300 안", tapTempo([0, 0.16, 0.32, 0.48]) === 300 || tapTempo([0, 0.16, 0.32, 0.48]) <= 300);
  ok("저장 키는 파일 이름·크기", storageKey("a.mp3", 5) === "pianoroll.copy:a.mp3:5");
  const dirty = copySanitize({ bpm: 9999, beatsPerBar: 99, offset: -3, speed: "x", loop: { a: 5, b: 2 }, loopOn: true, markers: [{ t: 3, label: "가" }, { t: -1 }, { t: 500 }, "x"], cells: ["Am", 4, "x".repeat(99)], key: { tonic: 12, mode: "major" }, overlay: 0 }, 100);
  ok("더러운 저장값: 범위로 자르고 · 뒤집힌 반복은 버리고 · 이상한 표시와 조는 버린다",
    dirty.bpm === 300 && dirty.beatsPerBar === 12 && dirty.offset === 0 && dirty.speed === 0.75 && dirty.loop === null && dirty.loopOn === false &&
    dirty.markers.length === 1 && dirty.markers[0].t === 3 && dirty.cells[0] === "Am" && dirty.cells[1] === "" && dirty.cells[2].length === 40 && dirty.cells.length >= 8 && dirty.key === undefined && dirty.overlay === true, dirty);
  ok("쓰레기 전체가 와도 기본값", JSON.stringify(copySanitize("zzz")) === JSON.stringify(copyDefault()) && copySanitize(null).bpm === 100);
}

// ------------------------------------------------------------ 베이스 단계 · 키 옮기기 · 백업
{
  const B = ["B1", "B2", "B3"].map((id) => LEVELS.find((l) => l.id === id));
  ok("베이스 단계 셋: 도수 단계이고 bassOnly, 회차 2·3·4", B.every((l) => l && l.kind === "degrees" && l.bassOnly) && B.map((l) => l.lesson).join() === "2,3,4");
  ok("1회차에는 베이스 단계가 안 나온다 (아직 안 배운 I·IV·V·vi 의 구별)", !levelsForLesson(1).some((l) => l.bassOnly));
  const rand = (() => { let x = 7; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); })();
  const q = makeQuestion("B2", rand, true);
  ok("베이스 문제도 일반 도수 문제와 같은 모양 (길이 4, 도수는 풀 안)", q.degrees.length === 4 && q.degrees.every((d) => d >= 0 && d < 7));

  const lines = new Set();
  let badQ = 0;
  for (let i = 0; i < 400; i += 1) {
    const t = makeTransposeQuestion(rand, 7);
    if (t.options.length !== 4 || new Set(t.options).size !== 4 || !t.options.includes(t.answer)) badQ += 1;
    if (t.from.tonic === t.to.tonic) badQ += 1;
    if (!gradeTranspose(t, t.answer) || t.options.filter((o) => gradeTranspose(t, o)).length !== 1) badQ += 1;
    lines.add(t.prog);
  }
  ok("키 옮기기 400문제: 보기 4개 서로 다름 · 정답 하나 · 조가 실제로 바뀐다", badQ === 0, badQ);
  ok("7회차면 퀴즈 진행 전부, 1회차면 1회차 진행만", lines.size === TRANSPOSE_PROGS.length && (() => { const set = new Set(); for (let i = 0; i < 100; i += 1) set.add(makeTransposeQuestion(rand, 1).prog); return [...set].every((id) => TRANSPOSE_PROGS.find((t) => t.id === id).lesson === 1); })());
  ok("정답 줄: C 장조 왕도 = F G Em Am → E♭ 장조면 A♭ B♭ Gm Cm", chordNames("oudou", { tonic: 0, mode: "major" }) === "F G Em Am" && chordNames("oudou", { tonic: 3, mode: "major" }) === "Ab Bb Gm Cm", chordNames("oudou", { tonic: 3, mode: "major" }));
  const ex = explainTranspose({ prog: "oudou", from: { tonic: 0, mode: "major" }, to: { tonic: 3, mode: "major" }, options: [], answer: "Ab Bb Gm Cm" });
  ok("풀이: 3반음 위로", ex.includes("3반음 위로"), ex);
  ok("아래로 옮기는 쪽이 가까우면 「아래로」 (C→A♭ 는 4반음 아래)", explainTranspose({ prog: "basic", from: { tonic: 0, mode: "major" }, to: { tonic: 8, mode: "major" }, options: [], answer: "" }).includes("4반음 아래로"));
  const tr = emptyTransposeStore(); recordTranspose(tr, "basic", true); recordTranspose(tr, "basic", false);
  ok("퀴즈 기록: 2번 중 1번", tr.total === 2 && tr.right === 1 && tr.byProg.basic.total === 2);
  const trBad = sanitizeTransposeStore({ total: 3, right: 99, byProg: { basic: { total: 2, right: 5 }, zzz: { total: 1, right: 1 } } });
  ok("퀴즈 기록 읽기: 맞힌 수가 푼 수를 못 넘고 모르는 진행은 버린다", trBad.right === 3 && trBad.byProg.basic.right === 2 && !("zzz" in trBad.byProg), trBad);

  // 백업
  const mem = new Map([["pianoroll.ear", JSON.stringify({ lesson: 3, goal: 20 })], ["pianoroll.transpose", JSON.stringify(tr)], ["pianoroll.copy:a.mp3:5", JSON.stringify({ bpm: 90, cells: ["Am"] })], ["other", "x"]]);
  const store = { get length() { return mem.size; }, key: (i) => [...mem.keys()][i] ?? null, getItem: (k) => mem.get(k) ?? null };
  const bk = makeBackup(store, new Date("2026-11-01T00:00:00Z"));
  ok("백업: 이 앱의 기록만 담는다 (other 는 제외)", bk.ear && bk.transpose && Object.keys(bk.copy).join() === "pianoroll.copy:a.mp3:5" && !JSON.stringify(bk).includes("\"other\""));
  const parsed = parseBackup(JSON.stringify(bk));
  ok("백업을 다시 읽으면 세 가지가 모두 걸러져 들어온다", parsed.ok && parsed.ear.lesson === 3 && parsed.transpose.total === 2 && parsed.copy["pianoroll.copy:a.mp3:5"].bpm === 90 && parsed.summary.includes("코드 수첩 1곡"), parsed);
  const dst = new Map();
  applyBackup({ setItem: (k, v) => dst.set(k, v) }, parsed);
  ok("불러오기: 저장소에 세 종류가 쓰인다", dst.size === 3 && JSON.parse(dst.get("pianoroll.ear")).lesson === 3);
  ok("망가진 백업은 거절: JSON 아님 · 다른 앱 · 버전 · 빈 내용", !parseBackup("{{").ok && !parseBackup("{}").ok && !parseBackup('{"app":"pianoroll-sampler","version":9}').ok && !parseBackup('{"app":"pianoroll-sampler","version":1}').ok);
  const evil = parseBackup(JSON.stringify({ app: "pianoroll-sampler", version: 1, ear: "zzz", copy: { "evil:key": { bpm: 1 }, "pianoroll.copy:b.mp3:1": { bpm: 99999, cells: [5] } } }));
  ok("남의 키는 쓰지 않고, 값은 범위로 자른다", evil.ok && Object.keys(evil.copy).join() === "pianoroll.copy:b.mp3:1" && evil.copy["pianoroll.copy:b.mp3:1"].bpm === 300 && evil.ear.lesson === 7, evil);
}


for (const r of out) console.log(`${r.pass ? "  ok" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${JSON.stringify(r.d)}`}`);
console.log(bad ? `\n${bad}개 실패` : `\n전부 통과 (${out.length}개)`);
process.exit(bad ? 1 : 0);
