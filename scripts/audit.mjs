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
 *
 *     node scripts/audit.mjs
 */
import { projectToMidi, midiToProject } from "../src/export/midi.ts";
import { packPresetId, unpackPresetId, isDrumPreset } from "../src/model/preset.ts";
import { assignChannels, channelForTrack } from "../src/model/channels.ts";

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

let bad = 0;
for (const r of out) { if (!r.pass) bad++; console.log(`${r.pass ? "✅" : "❌"} ${r.n}${r.pass ? "" : "  " + JSON.stringify(r.d)}`); }
console.log(bad === 0 ? `\n깨진 것 없음 (${out.length}개 확인)` : `\n의심 ${bad}개`);
process.exit(bad === 0 ? 0 : 1);
