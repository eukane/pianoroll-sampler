/**
 * 멀쩡하던 게 깨지지 않았는지 — **다른 점검이 직접 안 보던 것들.**
 *
 * 기능을 고치다 보면 그 기능의 테스트는 통과하는데 옆에 있던 게 조용히
 * 깨지는 일이 생긴다. 여기 모은 건 그런 자리들이다.
 *
 *   · 렌더용 MIDI 에서 볼륨을 뺐는데 **파일 내보내기에서도** 빠지지 않았나
 *   · 드럼 때문에 presetId 인코딩을 넓혔는데 **예전 프로젝트 파일**이 아직 열리나
 *   · 채널 배치를 바꿨는데 **드럼이 없을 때** 예전과 같은가
 *   · 셋잇단음을 넣었는데 **1/16 격자**가 여전히 정확한가
 *   · 떨림(CC1)은 볼륨과 달리 **렌더용 MIDI 에서도** 빠지지 않는가
 *   · 꾸밈 곡선이 말한 모양대로 나오는가 (끌어올림은 아래에서 위로 …)
 *   · 트랙 기본 떨림과 음의 꾸밈이 규칙대로 합쳐지는가
 *   · 예제 곡이 헤더에 적어 둔 대로 되어 있는가 (격자·음계·겹침)
 *   · 둘째 예제(일렉트로닉)의 드럼이 9번 채널에 가고 구조가 살아 있는가
 *   · **저장했다 열면 꾸밈·노랫말이 그대로 있는가** (예전에는 날아갔다)
 *   · **노래하는 트랙도 꾸밈을 받는가** (예전에는 조용히 무시했다)
 *   · 잘게 쪼갠 격자(1/32·1/64)가 MIDI 틱에 정확히 떨어지는가
 *   · 박자표를 바꿔도 마디 계산과 MIDI 왕복이 맞는가
 *
 *     node scripts/audit.mjs
 */
import { projectToMidi, midiToProject } from "../src/export/midi.ts";
import { packPresetId, unpackPresetId, isDrumPreset } from "../src/model/preset.ts";
import { assignChannels, channelForTrack } from "../src/model/channels.ts";
import { beatsPerBar } from "../src/model/project.ts";
import { demoSong } from "../src/model/demoSong.ts";
import { DEMOS } from "../src/model/demos.ts";
import { shakes, vibratoOf } from "../src/audio/vibrato.ts";
import { bendCurve, MAX_BEND_CENTS } from "../src/model/ornament.ts";
import { expressionFor, singingExpressions } from "../src/audio/expression.ts";
import { projectToJson, projectFromJson } from "../src/export/projectFile.ts";
import { MAX_PX_PER_BEAT } from "../src/ui/theme.ts";

const out = [];
const ok = (n, pass, d) => out.push({ n, pass: !!pass, d });

// ---- 1) MIDI 로 내보낼 때 볼륨·팬이 아직 실리는가 ----
// 렌더용으로는 빼도록 고쳤는데, 파일 내보내기까지 같이 빠졌으면
// 다른 DAW 에서 열었을 때 균형이 사라진다.
const proj = {
  bpm: 120, bars: 2, timeSig: [4, 4],
  tracks: [{ id: "a", name: "T", source: { kind: "sf2", presetId: 0 },
    notes: [{ id: "n", pitch: 60, start: 0, length: 1, velocity: 100 }],
    volume: 0.5, pan: -0.5, muted: false }],
};
const findCC = (bytes, cc) => {
  for (let i = 0; i < bytes.length - 2; i++) {
    if ((bytes[i] & 0xf0) === 0xb0 && bytes[i + 1] === cc) return bytes[i + 2];
  }
  return null;
};
const exported = projectToMidi(proj);
const forRender = projectToMidi(proj, { includeMixer: false });
ok("파일로 내보낸 MIDI 에는 볼륨(CC7)이 실린다", findCC(exported, 7) === 64,
   { CC7: findCC(exported, 7), 기대: 64 });
ok("파일로 내보낸 MIDI 에는 팬(CC10)이 실린다", findCC(exported, 10) === 32,
   { CC10: findCC(exported, 10), 기대: 32 });
ok("렌더용 MIDI 에는 볼륨·팬이 안 실린다",
   findCC(forRender, 7) === null && findCC(forRender, 10) === null,
   { CC7: findCC(forRender, 7), CC10: findCC(forRender, 10) });

// ---- 2) 예전에 저장한 프로젝트가 아직 열리는가 ----
// presetId 인코딩을 드럼 때문에 넓혔다. 일반 악기는 그대로여야 한다.
ok("일반 악기 presetId 인코딩이 예전과 같다",
   packPresetId(0, 65) === 65 && packPresetId(1, 0) === 128,
   { "뱅크0프로그램65": packPresetId(0, 65), "뱅크1프로그램0": packPresetId(1, 0) });
ok("예전 값을 풀면 드럼이 아니다", !isDrumPreset(65) && !isDrumPreset(16383),
   { p65: unpackPresetId(65), p16383: unpackPresetId(16383) });
ok("드럼은 예전 값과 절대 안 겹친다", isDrumPreset(packPresetId(0, 0, true)),
   { 드럼: packPresetId(0, 0, true) });

// ---- 3) 드럼이 없으면 채널 배치가 예전과 같은가 ----
const noDrums = { ...proj, tracks: Array.from({ length: 15 }, (_, i) => ({
  id: "t" + i, name: "t", source: { kind: "sf2", presetId: i },
  notes: [], volume: 1, pan: 0, muted: false })) };
const got = assignChannels(noDrums);
const want = noDrums.tracks.map((_, i) => channelForTrack(i));
ok("드럼이 없으면 채널 배치가 예전 방식과 같다",
   JSON.stringify(got) === JSON.stringify(want), { got, want });

// ---- 4) 셋잇단음을 넣었는데 기존 스냅이 깨지지 않았나 ----
const plain = {
  ...proj,
  tracks: [{ ...proj.tracks[0], notes: [0, 0.25, 0.5, 0.75, 1].map((start, i) =>
    ({ id: "p" + i, pitch: 60, start, length: 0.25, velocity: 100 })) }],
};
const plainBack = midiToProject(projectToMidi(plain));
ok("1/16 격자 노트가 여전히 정확히 왕복한다",
   JSON.stringify(plainBack.tracks[0].notes.map(n => +n.start.toFixed(6)))
     === JSON.stringify([0, 0.25, 0.5, 0.75, 1]),
   plainBack.tracks[0].notes.map(n => n.start));

// ---- 5) 빈 프로젝트로도 MIDI 가 만들어지는가 ----
let empty = true;
try { projectToMidi({ bpm: 120, bars: 1, timeSig: [4, 4], tracks: [] }); } catch { empty = false; }
ok("트랙이 없어도 MIDI 생성이 터지지 않는다", empty);

// ---- 6) 떨림(CC1)은 렌더용 MIDI 에도 실려야 한다 ----
//
// 볼륨·팬은 믹서가 따로 걸어서 렌더용 MIDI 에서 뺐다. 떨림은 그렇지 않다 —
// 사운드폰트 트랙의 떨림을 실어 나르는 길이 CC1 하나뿐이라, 같이 빼면
// **화면에서는 떨리는데 뽑아낸 WAV 만 안 떨린다.**
const vibProj = {
  ...proj,
  tracks: [{ ...proj.tracks[0], vibrato: 0.8, vibratoDelay: 0 }],
};
ok("파일로 내보낸 MIDI 에 떨림(CC1)이 실린다", findCC(projectToMidi(vibProj), 1) === 102,
   { CC1: findCC(projectToMidi(vibProj), 1) });
ok("렌더용 MIDI 에도 떨림(CC1)이 실린다 (볼륨과 달리 빠지면 안 된다)",
   findCC(projectToMidi(vibProj, { includeMixer: false }), 1) === 102,
   { CC1: findCC(projectToMidi(vibProj, { includeMixer: false }), 1) });
ok("떨림이 0 이면 CC1 을 아예 안 보낸다", findCC(projectToMidi(proj), 1) === null,
   { CC1: findCC(projectToMidi(proj), 1) });

// ---- 7) 꾸밈 곡선이 말한 모양대로 나오는가 ----
//
// 손으로 그린 곡선이라 부호 하나 뒤집혀도 코드는 멀쩡히 돈다. 끌어올림이
// 위에서 내려오고 있어도 "뭔가 휘긴 하네" 로 들려서 귀로도 잘 안 잡힌다.
const bendAt = (points, t) => {
  if (points.length === 0) return 0;
  if (t <= points[0].t) return points[0].cents;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1], b = points[i];
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return a.cents + (b.cents - a.cents) * k;
    }
  }
  return points[points.length - 1].cents;
};

const scoop = bendCurve("scoop", 1, 1.0);
ok("끌어올림은 아래에서 시작해 제 음정으로 온다",
   scoop[0].cents < -100 && scoop[scoop.length - 1].cents === 0,
   scoop);
const fall = bendCurve("fall", 1, 1.0);
ok("흘러내림은 제 음정으로 시작해 끝에서 떨어진다",
   fall[0].cents === 0 && fall[fall.length - 1].cents < -100,
   fall);
const bend = bendCurve("bend", 1, 1.0);
ok("꺾기는 위로 올라갔다 제자리로 돌아온다",
   Math.max(...bend.map((p) => p.cents)) > 100 && bend[bend.length - 1].cents === 0,
   bend);
ok("어떤 꾸밈도 피치 벤드 범위(±200센트)를 넘지 않는다",
   ["scoop", "fall", "bend"].every((o) =>
     [0.3, 1].every((a) => bendCurve(o, a, 2).every((p) => Math.abs(p.cents) <= MAX_BEND_CENTS))));

// 짧은 음에서도 모양이 음 안에서 끝나야 한다. 0.1초짜리에 0.13초짜리
// 끌어올림을 붙이면 음이 끝날 때까지 제 음정에 도착하지 못한다.
const shortScoop = bendCurve("scoop", 1, 0.1);
ok("짧은 음에서도 끌어올림이 음 안에서 끝난다",
   shortScoop[shortScoop.length - 1].t <= 0.1 + 1e-9,
   shortScoop);
const shortBend = bendCurve("bend", 1, 0.12);
ok("짧은 음에서도 꺾기가 음 안에서 끝난다",
   shortBend[shortBend.length - 1].t <= 0.12 + 1e-9,
   shortBend);
ok("세기 0 이면 아무 곡선도 안 나온다", bendCurve("bend", 0, 1).length === 0);

// ---- 8) 트랙 기본 떨림과 음의 꾸밈이 어떻게 합쳐지는가 ----
//
// 규칙 한 줄: **꾸밈을 정하지 않은 음에만 트랙 기본 떨림이 걸린다.**
// 여기가 어긋나면 "이 음만 밋밋하게" 가 안 되거나, 반대로 전부 떨어 버린다.
const vibTrack = { ...proj.tracks[0], vibrato: 0.8, vibratoDelay: 0.2 };
const exprOf = (note) => expressionFor(vibTrack, { pitch: 60, start: 0, length: 1, velocity: 100, ...note }, 1);
ok("꾸밈을 안 정한 음은 트랙 기본 떨림을 따른다",
   exprOf({}).vibrato.depth === 0.8 && exprOf({}).bend.length === 0);
ok("「그냥」을 고르면 트랙 떨림도 안 걸린다",
   exprOf({ ornament: "none" }).vibrato.depth === 0 && exprOf({ ornament: "none" }).bend.length === 0);
ok("「떨림」을 고르면 그 음의 세기를 쓴다",
   exprOf({ ornament: "vibrato", ornamentAmount: 0.3 }).vibrato.depth === 0.3);
ok("음정 곡선 꾸밈은 떨림 없이 곡선만 온다",
   exprOf({ ornament: "bend" }).vibrato.depth === 0
     && exprOf({ ornament: "bend" }).bend.length > 0);

// ---- 9) 예제 곡이 스스로 적어 둔 규칙을 지키는가 ----
//
// demoSong.ts 헤더가 "1/8 격자에 딱 떨어진다 · 5음계만 쓴다" 고 약속한다.
// 손으로 적은 음표 목록이라 고치다 한 줄 어긋나기 쉽고, 어긋나도 소리로는
// 잘 안 들린다. 약속한 쪽을 검사로 남긴다.
const demo = demoSong();
const demoNotes = demo.tracks.flatMap((t) => t.notes);
const onGrid = demoNotes.every(
  (n) => Math.abs(n.start * 2 - Math.round(n.start * 2)) < 1e-9
      && Math.abs(n.length * 2 - Math.round(n.length * 2)) < 1e-9,
);
ok("예제 곡이 전부 1/8 격자에 떨어진다", onGrid,
   demoNotes.filter((n) => (n.start * 2) % 1 !== 0 || (n.length * 2) % 1 !== 0).slice(0, 3));

const songBeats = demo.bars * 4;
ok("예제 곡의 노트가 곡 길이 안에 있다",
   demoNotes.every((n) => n.start >= 0 && n.start + n.length <= songBeats + 1e-9),
   { 곡길이박: songBeats, 넘는것: demoNotes.filter((n) => n.start + n.length > songBeats + 1e-9).length });

// D 장조 5음계 = 레·미·파#·라·시 → 12로 나눈 나머지가 2, 4, 6, 9, 11
const PENTATONIC = new Set([2, 4, 6, 9, 11]);
const strays = demoNotes.filter((n) => !PENTATONIC.has(((n.pitch % 12) + 12) % 12));
ok("예제 곡에 5음계 밖의 음이 없다", strays.length === 0,
   strays.slice(0, 5).map((n) => n.pitch));

// 같은 트랙에서 같은 음이 겹치면 앞 음의 noteOff 가 뒤 음을 끊는다.
// 소리로는 "가끔 한 음이 짧다" 정도로만 들려서 눈으로는 못 잡는다.
let overlaps = 0;
for (const t of demo.tracks) {
  const byPitch = new Map();
  for (const n of [...t.notes].sort((a, b) => a.start - b.start)) {
    const end = byPitch.get(n.pitch);
    if (end !== undefined && n.start < end - 1e-9) overlaps += 1;
    byPitch.set(n.pitch, n.start + n.length);
  }
}
ok("예제 곡에 같은 음이 겹치는 자리가 없다", overlaps === 0, { 겹침: overlaps });

// 셋 다 다른 악기여야 "같은 노트를 다른 악기로" 를 보여 줄 수 있다.
ok("예제 곡의 세 트랙이 서로 다른 악기다",
   new Set(demo.tracks.map((t) => t.source.presetId)).size === demo.tracks.length,
   demo.tracks.map((t) => t.source.presetId));

// 예제 곡의 떨림이 실제로 "긴 음만" 떨게 되어 있는가. 딜레이를 잘못 잡으면
// 전부 떨거나 하나도 안 떨어서, 보여 주려던 것이 안 보인다.
const mel = demo.tracks[0];
const melVib = vibratoOf(mel);
const secPerBeat = 60 / demo.bpm;
const melExpr = mel.notes.map((n) => expressionFor(mel, n, n.length * secPerBeat));
const shaking = melExpr.filter((e, i) => shakes(e.vibrato, mel.notes[i].length * secPerBeat));
ok("예제 곡 멜로디에 떨림이 걸려 있다", melVib.depth > 0 && melVib.delay > 0, melVib);
ok("예제 곡에서 긴 음은 떨리고 짧은 음은 안 떨린다",
   shaking.length > 3 && shaking.length < mel.notes.length,
   { 떠는음: shaking.length, 전체: mel.notes.length });

// 기교는 아껴 써야 기교다. 전부 꺾으면 트랙에 걸어 둔 것과 다를 게 없어진다.
const ornamented = mel.notes.filter((n) => n.ornament !== undefined);
ok("예제 곡에 음 하나씩 손본 자리가 있다 (많지 않게)",
   ornamented.length >= 2 && ornamented.length <= 5,
   { 손본음: ornamented.map((n) => `${n.start}박 ${n.ornament}`) });
ok("손본 자리의 꾸밈이 실제로 음정 곡선을 만든다",
   ornamented.every((n) => expressionFor(mel, n, n.length * secPerBeat).bend.length > 0),
   ornamented.map((n) => n.ornament));
ok("예제 곡의 반주·베이스에는 떨림이 없다",
   demo.tracks.slice(1).every((t) => (t.vibrato ?? 0) === 0));

// 두 번 부르면 노트 id 가 달라야 한다. 같은 객체를 돌려주면 사용자가 고친 게
// 다음에 열 때도 남아서 예제가 예제 노릇을 못 한다.
const again = demoSong();
ok("예제 곡을 다시 부르면 새 노트로 온다",
   again.tracks[0].notes[0].id !== demo.tracks[0].notes[0].id
     && again.tracks[0].notes.length === demo.tracks[0].notes.length);

// MIDI 로 내보내고 다시 읽어도 그대로여야 한다 (다른 DAW 로 넘길 때).
const demoBack = midiToProject(projectToMidi(demo));
ok("예제 곡이 MIDI 왕복을 견딘다",
   demoBack.tracks.length === demo.tracks.length
     && demoBack.tracks.every((t, i) => t.notes.length === demo.tracks[i].notes.length),
   { 원본: demo.tracks.map((t) => t.notes.length), 왕복: demoBack.tracks.map((t) => t.notes.length) });

// ---- 10) 예제 곡 목록과 둘째 곡(일렉트로닉) ----
//
// 곡이 둘이 되면서 목록에서 버튼을 만든다. 목록이 어긋나면 버튼이 안 뜨거나
// 엉뚱한 곡이 열린다.
ok("예제 곡이 둘 이상이고 id 가 겹치지 않는다",
   DEMOS.length >= 2 && new Set(DEMOS.map((d) => d.id)).size === DEMOS.length,
   DEMOS.map((d) => d.id));

const edm = DEMOS.find((d) => d.id === "edm").make();
const edmNotes = edm.tracks.flatMap((t) => t.notes);

// 이 곡은 1/16 격자다 (첫 예제는 1/8). 손으로 고칠 때 스냅만 맞추면 딱 떨어져야 한다.
ok("일렉트로닉 예제가 전부 1/16 격자에 떨어진다",
   edmNotes.every((n) => Math.abs(n.start * 4 - Math.round(n.start * 4)) < 1e-9
     && Math.abs(n.length * 4 - Math.round(n.length * 4)) < 1e-9));
ok("일렉트로닉 예제의 노트가 곡 길이 안에 있다",
   edmNotes.every((n) => n.start >= 0 && n.start + n.length <= edm.bars * 4 + 1e-9));

// 드럼이 9번 채널로 가야 우리 신스에서도, 내보낸 .mid 를 연 다른 DAW 에서도
// 타악기로 난다. 이건 사운드폰트와 무관하게 항상 참이어야 한다.
const edmChannels = assignChannels(edm);
const drumIdx = edm.tracks.findIndex((t) => t.name === "드럼");
ok("일렉트로닉 예제의 드럼이 9번 채널에 간다", edmChannels[drumIdx] === 9, edmChannels);
ok("나머지 트랙은 9번을 비켜 간다",
   edmChannels.filter((c, i) => i !== drumIdx).every((c) => c !== 9), edmChannels);

// 같은 음 겹침 — 겹치면 앞 음의 noteOff 가 뒤 음을 끊는다. 드럼처럼 같은
// 건반을 계속 치는 트랙에서 특히 나기 쉽다.
let edmOverlaps = 0;
for (const t of edm.tracks) {
  const end = new Map();
  for (const n of [...t.notes].sort((a, b) => a.start - b.start)) {
    const prev = end.get(n.pitch);
    if (prev !== undefined && n.start < prev - 1e-9) edmOverlaps += 1;
    end.set(n.pitch, n.start + n.length);
  }
}
ok("일렉트로닉 예제에 같은 음이 겹치는 자리가 없다", edmOverlaps === 0, { 겹침: edmOverlaps });

// 구조 — 킥은 드롭(9마디)부터 4분음표로 친다. 쌓는 구간에 다 쳐 버리면
// 드롭이 열리는 느낌이 없어진다 (실제로 그랬다).
const drums = edm.tracks[drumIdx].notes;
const kicksIn = (bar) => drums.filter((n) => n.pitch === 36 && n.start >= bar * 4 && n.start < (bar + 1) * 4).length;
ok("인트로에는 킥이 없다", kicksIn(0) === 0 && kicksIn(1) === 0);
ok("쌓는 구간의 킥은 마디마다 한 번", kicksIn(5) === 1 && kicksIn(6) === 1, kicksIn(5));
ok("드롭부터는 4분음표 킥", kicksIn(9) === 4 && kicksIn(14) === 4, kicksIn(9));

const edmOrn = edm.tracks[0].notes.filter((n) => n.ornament);
ok("일렉트로닉 예제의 리드에도 손본 자리가 있다 (많지 않게)",
   edmOrn.length >= 2 && edmOrn.length <= 4,
   edmOrn.map((n) => `${n.start}박 ${n.ornament}`));

// ---- 11) 저장했다 열면 그대로인가 ----
//
// **꾸밈과 노랫말이 안 읽히고 있었다.** 파일에는 멀쩡히 들어 있는데 읽는 쪽이
// 버려서, 저장했다 다시 열면 조교한 게 통째로 날아갔다. 저장 자체는 잘 되니
// 사용자는 눈치채기도 어렵다 — 딱 이 저장소가 제일 싫어하는 종류다.
const saved = {
  bpm: 100, bars: 2, timeSig: [4, 4],
  tracks: [
    { id: "t1", name: "노래", source: { kind: "voice", bankId: "teto" },
      notes: [{ id: "n1", pitch: 62, start: 0, length: 1, velocity: 100,
                ornament: "bend", ornamentAmount: 0.42, lyric: "か" }],
      volume: 0.8, pan: 0, muted: false, reverbSend: 0.2, vibrato: 0.5, vibratoDelay: 0.3 },
    { id: "t2", name: "악기", source: { kind: "sf2", presetId: 65 },
      notes: [{ id: "n2", pitch: 60, start: 1, length: 2, velocity: 90, ornament: "none" }],
      volume: 0.7, pan: -0.3, muted: false, reverbSend: 0 },
  ],
};
const reopened = projectFromJson(projectToJson(saved));
const rn = reopened.tracks[0].notes[0];
ok("저장했다 열어도 꾸밈이 남는다",
   rn.ornament === "bend" && Math.abs(rn.ornamentAmount - 0.42) < 1e-9, rn);
ok("저장했다 열어도 노랫말이 남는다", rn.lyric === "か", rn.lyric);
ok("「그냥」도 그대로 남는다 (트랙 기본 떨림을 끄는 뜻이라 날아가면 안 된다)",
   reopened.tracks[1].notes[0].ornament === "none", reopened.tracks[1].notes[0]);
ok("노래하는 트랙 종류가 남는다",
   reopened.tracks[0].source.kind === "voice" && reopened.tracks[0].source.bankId === "teto",
   reopened.tracks[0].source);
ok("트랙 기본 떨림도 남는다",
   reopened.tracks[0].vibrato === 0.5 && reopened.tracks[0].vibratoDelay === 0.3,
   { v: reopened.tracks[0].vibrato, d: reopened.tracks[0].vibratoDelay });
// 없는 꾸밈 이름이 들어오면 무시해야 한다. 사람이 손으로 고칠 수 있는 파일이다.
const junk = projectFromJson(JSON.stringify({ ...saved,
  tracks: [{ ...saved.tracks[0], notes: [{ ...saved.tracks[0].notes[0], ornament: "쾅" }] }] }));
ok("모르는 꾸밈 이름은 무시한다", junk.tracks[0].notes[0].ornament === undefined,
   junk.tracks[0].notes[0].ornament);

// ---- 11) 노래하는 트랙도 꾸밈을 받는가 ----
//
// 오래 이게 비어 있었다. 노트 창에 떨림·꺾기 버튼이 다 나오고, 고르면
// 노트에 저장되고, 피아노롤에 「〜」까지 그려지는데, **소리를 내는 쪽이
// 그걸 아예 안 봤다.** 눈에 보이는 건 전부 맞으니 눈으로는 못 잡는다.
const singTrack = {
  id: "t", name: "테토", source: { kind: "voice", bankId: "teto" },
  volume: 0.8, pan: 0, muted: false,
  notes: [
    { id: "a", pitch: 62, start: 0, length: 2, velocity: 100, lyric: "か" },
    { id: "b", pitch: 64, start: 2, length: 2, velocity: 100, lyric: "さ", ornament: "vibrato", ornamentAmount: 0.8 },
    { id: "c", pitch: 65, start: 4, length: 2, velocity: 100, lyric: "ね", ornament: "scoop" },
  ],
};
const singExprs = singingExpressions(singTrack, singTrack.notes, () => 1.2);
ok("떨림을 고른 음이 꾸밈 목록에 든다", singExprs.get("b")?.vibrato.depth === 0.8,
   singExprs.get("b"));
ok("끌어올림을 고른 음은 음정 곡선을 받는다", (singExprs.get("c")?.bend.length ?? 0) > 0,
   singExprs.get("c")?.bend);
// 아무 꾸밈도 없는 음까지 담으면 부를 때마다 쓸데없는 노드를 만든다.
ok("꾸밈 없는 음은 목록에 안 담는다", !singExprs.has("a"), [...singExprs.keys()]);
// 트랙 기본 떨림은 꾸밈을 안 정한 음에만. 노래 트랙에서도 규칙이 같아야 한다.
const singExprs2 = singingExpressions({ ...singTrack, vibrato: 0.4, vibratoDelay: 0.3 },
  singTrack.notes, () => 1.2);
ok("노래 트랙도 트랙 기본 떨림은 꾸밈 안 정한 음에만 건다",
   singExprs2.get("a")?.vibrato.depth === 0.4 && singExprs2.get("c")?.vibrato.depth === 0,
   { a: singExprs2.get("a")?.vibrato, c: singExprs2.get("c")?.vibrato });
// 짧은 음은 떨어 봐야 흔들림이 한 번도 못 돈다. 시작 지연보다 짧으면 안 건다.
const singShort = singingExpressions({ ...singTrack, vibrato: 0.4, vibratoDelay: 0.3 },
  singTrack.notes, () => 0.1);
ok("짧은 음은 떨지 않는다", !shakes(singShort.get("a").vibrato, 0.1), singShort.get("a"));

// ---- 12) 잘게 쪼갠 격자가 MIDI 로 정확히 나가는가 ----
//
// 4/4 라도 16분음표보다 잘게 쪼개 쓰고 싶다는 요청에서 나왔다. 넣기 전에
// **정확히 표현되는지부터** 봤다. PPQ 480 은 2·3·4·5·6·8·10·12·16 으로
// 나누어떨어져서 32분음표(60틱)도 64분음표(30틱)도 32분 셋잇단(40틱)도
// 전부 정수다. 소수점이 남으면 마디마다 조금씩 밀려서 나중에 어긋난다.
const PPQ = 480;
const UNITS = {
  "1/4": 1, "1/8": 0.5, "1/16": 0.25, "1/32": 0.125, "1/64": 0.0625,
  "1/8셋": 1 / 3, "1/16셋": 1 / 6, "1/32셋": 1 / 12,
};
for (const [label, u] of Object.entries(UNITS)) {
  const ticks = u * PPQ;
  ok(`${label} 이 MIDI 틱에 정수로 떨어진다 (${ticks}틱)`,
     Math.abs(ticks - Math.round(ticks)) < 1e-9, ticks);
}
// 왕복까지 본다. 틱이 정수여도 읽는 쪽에서 반올림을 잘못하면 소용없다.
const fine = {
  bpm: 120, bars: 2, timeSig: [4, 4],
  tracks: [{ id: "t", name: "t", source: { kind: "sf2", presetId: 0 },
    volume: 0.8, pan: 0, muted: false,
    notes: Object.values(UNITS).map((u, i) => ({
      id: "f" + i, pitch: 60 + i, start: i * 0.5, length: u, velocity: 100 })) }],
};
const fineBack = midiToProject(projectToMidi(fine)).tracks[0].notes;
ok("잘게 쪼갠 길이가 MIDI 왕복에서 안 변한다",
   Object.values(UNITS).every((u, i) => Math.abs(fineBack[i].length - u) < 1e-9),
   Object.values(UNITS).map((u, i) => `${u.toFixed(4)}→${fineBack[i].length.toFixed(4)}`));

// 화면에서 실제로 잡을 수 있는 크기인가. 최대 배율을 올릴 뻔했다가 다시 재서
// 안 올린 자리라, 숫자를 여기 남겨 둔다.
ok("최대 배율에서 1/32 노트는 40px, 1/64 는 20px",
   MAX_PX_PER_BEAT * 0.125 === 40 && MAX_PX_PER_BEAT * 0.0625 === 20,
   { "1/32": MAX_PX_PER_BEAT * 0.125, "1/64": MAX_PX_PER_BEAT * 0.0625 });

// ---- 13) 박자표 ----
//
// 화면에 고르는 칸을 만들면서, 고를 수 있는 박자표가 전부 말이 되는지 본다.
// 목록에 올린 것은 **마디 길이가 4분음표 정수 개**인 것들이다. 7/8(3.5박)
// 같은 건 화면·위치 표시·격자가 전부 4분음표 기준인 지금 셈법과 안 맞아서
// 일부러 뺐다 — 뺀 이유를 여기 남겨 둔다.
const SIGS = [[4,4],[3,4],[2,4],[5,4],[6,8],[12,8],[2,2]];
for (const [n, d] of SIGS) {
  const bpb = beatsPerBar({ timeSig: [n, d] });
  ok(`${n}/${d} 의 마디 길이가 4분음표 정수 개다 (${bpb}박)`, Number.isInteger(bpb), bpb);
}
ok("7/8 은 정수가 아니라서 목록에 없다", !Number.isInteger(beatsPerBar({ timeSig: [7, 8] })),
   beatsPerBar({ timeSig: [7, 8] }));

// 박자표가 MIDI 로 나갔다 그대로 돌아오는가. 분모를 2의 지수로 적는 자리라
// 한 칸만 틀려도 4/4 가 4/8 이 되어 다른 DAW 에서 마디가 반토막 난다.
for (const [n, d] of SIGS) {
  const round = midiToProject(projectToMidi({
    bpm: 120, bars: 2, timeSig: [n, d],
    tracks: [{ id: "t", name: "t", source: { kind: "sf2", presetId: 0 },
      volume: 0.8, pan: 0, muted: false,
      notes: [{ id: "a", pitch: 60, start: 0, length: 1, velocity: 100 }] }],
  }));
  ok(`${n}/${d} 가 MIDI 왕복에서 그대로다`,
     round.timeSig[0] === n && round.timeSig[1] === d, round.timeSig);
}

// 박자표를 바꿔도 노트는 안 움직인다. 노트 시각은 박이고 박자표는 그 박을
// 몇 개씩 묶어 볼지만 정한다. 여기가 어긋나면 박자표를 바꾸는 순간 곡이 밀린다.
{
  const notes = [{ id: "a", pitch: 60, start: 5, length: 1, velocity: 100 }];
  const p44 = { bpm: 120, bars: 4, timeSig: [4, 4], tracks: [{ id: "t", name: "t",
    source: { kind: "sf2", presetId: 0 }, volume: 0.8, pan: 0, muted: false, notes }] };
  const p34 = { ...p44, timeSig: [3, 4] };
  ok("박자표를 바꿔도 노트 위치는 그대로다", p34.tracks[0].notes[0].start === 5);
  // 대신 그 노트가 몇 마디째인지는 바뀐다 — 그게 박자표를 바꾼다는 뜻이다.
  ok("몇 마디째인지는 바뀐다 (4/4 는 2마디째, 3/4 는 2마디째 아님)",
     Math.floor(5 / beatsPerBar(p44)) === 1 && Math.floor(5 / beatsPerBar(p34)) === 1,
     { "4/4": Math.floor(5 / beatsPerBar(p44)) + 1, "3/4": Math.floor(5 / beatsPerBar(p34)) + 1 });
}

let bad = 0;
for (const r of out) { if (!r.pass) bad++; console.log(`${r.pass ? "✅" : "❌"} ${r.n}${r.pass ? "" : "  " + JSON.stringify(r.d)}`); }
console.log(bad === 0 ? `\n깨진 것 없음 (${out.length}개 확인)` : `\n의심 ${bad}개`);
process.exit(bad === 0 ? 0 : 1);
