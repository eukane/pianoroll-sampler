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
 *   · 예제 곡이 헤더에 적어 둔 대로 되어 있는가 (격자·음계·겹침)
 *
 *     node scripts/audit.mjs
 */
import { projectToMidi, midiToProject } from "../src/export/midi.ts";
import { packPresetId, unpackPresetId, isDrumPreset } from "../src/model/preset.ts";
import { assignChannels, channelForTrack } from "../src/model/channels.ts";
import { demoSong } from "../src/model/demoSong.ts";
import { shakes, vibratoOf } from "../src/audio/vibrato.ts";

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

// ---- 7) 예제 곡이 스스로 적어 둔 규칙을 지키는가 ----
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
const shaking = mel.notes.filter((n) => shakes(melVib, n.length * secPerBeat));
ok("예제 곡 멜로디에 떨림이 걸려 있다", melVib.depth > 0 && melVib.delay > 0, melVib);
ok("예제 곡에서 긴 음은 떨리고 짧은 음은 안 떨린다",
   shaking.length > 3 && shaking.length < mel.notes.length,
   { 떠는음: shaking.length, 전체: mel.notes.length });
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

let bad = 0;
for (const r of out) { if (!r.pass) bad++; console.log(`${r.pass ? "✅" : "❌"} ${r.n}${r.pass ? "" : "  " + JSON.stringify(r.d)}`); }
console.log(bad === 0 ? `\n깨진 것 없음 (${out.length}개 확인)` : `\n의심 ${bad}개`);
process.exit(bad === 0 ? 0 : 1);
