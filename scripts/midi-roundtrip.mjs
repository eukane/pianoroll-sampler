/**
 * MIDI 왕복 테스트 — **브라우저 없이** 돈다.
 *
 * M3 의 완료 기준이 "다른 DAW 에서 만든 MIDI 를 가져와 악기만 바꿔 다시 내보낸다"
 * 라서, 쓴 걸 그대로 다시 읽어낼 수 있는지가 전부다. 여기가 틀리면 왕복이
 * 통째로 깨지는데, 브라우저를 띄워야만 확인할 수 있으면 자주 못 돌린다.
 * 그래서 MIDI 변환을 오디오 계층에서 떼어 놨다.
 *
 *     node scripts/midi-roundtrip.mjs
 */

import { projectToMidi, midiToProject, PPQ } from "../src/export/midi.ts";
import { packPresetId, isDrumPreset } from "../src/model/preset.ts";

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

const source = {
  bpm: 138,
  bars: 4,
  timeSig: [4, 4],
  tracks: [
    {
      id: "t1",
      name: "Alto Sax",
      source: { kind: "sf2", presetId: packPresetId(0, 65) },
      notes: [
        { id: "a", pitch: 60, start: 0, length: 1, velocity: 100 },
        { id: "b", pitch: 64, start: 1, length: 0.5, velocity: 80 },
        { id: "c", pitch: 67, start: 1.5, length: 2.25, velocity: 127 },
        // 같은 음을 붙여 친다 — 오프/온 순서가 틀리면 여기서 무너진다
        { id: "d", pitch: 72, start: 4, length: 1, velocity: 90 },
        { id: "e", pitch: 72, start: 5, length: 1, velocity: 90 },
      ],
      volume: 0.8, pan: 0, muted: false,
    },
    {
      id: "t2",
      name: "Gayageum",
      source: { kind: "sf2", presetId: packPresetId(0, 105) },
      notes: [
        { id: "f", pitch: 48, start: 0, length: 4, velocity: 70 },
        { id: "g", pitch: 55, start: 4, length: 4, velocity: 70 },
      ],
      volume: 0.8, pan: 0, muted: false,
    },
  ],
};

const bytes = projectToMidi(source);

// --- 헤더가 스펙대로인가 (포맷 1, 트랙당 1채널) ---
const tag = String.fromCharCode(...bytes.slice(0, 4));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const format = view.getUint16(8);
const ntrks = view.getUint16(10);
const division = view.getUint16(12);
check("MThd 헤더로 시작한다", tag === "MThd", tag);
check("SMF 포맷 1 이다", format === 1, format);
check("템포 트랙 + 프로젝트 트랙 수", ntrks === 3, ntrks);
check("분해능이 PPQ 와 맞는다", division === PPQ, division);

// --- 다시 읽기 ---
const back = midiToProject(bytes);
check("BPM 이 살아 돌아온다", back.bpm === 138, back.bpm);
check("박자표가 살아 돌아온다", back.timeSig[0] === 4 && back.timeSig[1] === 4, back.timeSig);
check("트랙 수가 같다", back.tracks.length === 2, back.tracks.length);

const flat = (p) =>
  p.tracks.map((t) =>
    t.notes
      .map((n) => `${n.pitch}@${n.start.toFixed(4)}+${n.length.toFixed(4)}v${n.velocity}`)
      .sort()
      .join(","),
  );
const before = flat(source);
const after = flat(back);
check("모든 노트가 음높이·위치·길이·세기까지 그대로다", JSON.stringify(before) === JSON.stringify(after), { before, after });

check(
  "악기(뱅크+프로그램)가 트랙마다 보존된다",
  back.tracks[0].source.presetId === packPresetId(0, 65) &&
    back.tracks[1].source.presetId === packPresetId(0, 105),
  back.tracks.map((t) => t.source.presetId),
);
check("트랙 이름이 보존된다", back.tracks[0].name === "Alto Sax" && back.tracks[1].name === "Gayageum",
  back.tracks.map((t) => t.name));
check("마디 수가 마지막 노트를 담는다", back.bars === 2, { bars: back.bars });

// --- 두 번 왕복해도 안 변하는가 ---
const twice = midiToProject(projectToMidi(back));
check("두 번 왕복해도 결과가 같다", JSON.stringify(flat(twice)) === JSON.stringify(after), flat(twice));

// --- 드럼 채널을 피해 갔는가 ---
const many = {
  ...source,
  tracks: Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`, name: `T${i}`, source: { kind: "sf2", presetId: i },
    notes: [{ id: `n${i}`, pitch: 60 + i, start: 0, length: 1, velocity: 100 }],
    volume: 0.8, pan: 0, muted: false,
  })),
};
const manyBytes = projectToMidi(many);
const channels = new Set();
for (let i = 0; i < manyBytes.length - 2; i++) {
  if ((manyBytes[i] & 0xf0) === 0x90 && manyBytes[i + 2] > 0) channels.add(manyBytes[i] & 0x0f);
}
check("트랙이 12개여도 드럼 채널(9)에 노트를 쓰지 않는다", !channels.has(9), [...channels].sort((a, b) => a - b));

// --- 드럼은 9번 채널로 나가고, 다시 읽어도 드럼이다 ---
const withDrum = {
  bpm: 100, bars: 2, timeSig: [4, 4],
  tracks: [
    { id: "d1", name: "Standard 1", source: { kind: "sf2", presetId: packPresetId(0, 0, true) },
      notes: [{ id: "k", pitch: 36, start: 0, length: 0.5, velocity: 120 }],
      volume: 0.8, pan: 0, muted: false },
    { id: "p1", name: "Grand Piano", source: { kind: "sf2", presetId: packPresetId(0, 0) },
      notes: [{ id: "c", pitch: 60, start: 0, length: 1, velocity: 100 }],
      volume: 0.8, pan: 0, muted: false },
  ],
};
check(
  "드럼과 피아노는 프로그램 번호가 같아도 다른 id 다",
  withDrum.tracks[0].source.presetId !== withDrum.tracks[1].source.presetId,
  withDrum.tracks.map((t) => t.source.presetId),
);

const drumBytes = projectToMidi(withDrum);
const drumChannels = new Set();
for (let i = 0; i < drumBytes.length - 2; i++) {
  if ((drumBytes[i] & 0xf0) === 0x90 && drumBytes[i + 2] > 0) drumChannels.add(drumBytes[i] & 0x0f);
}
check("드럼 트랙은 9번 채널로 나간다", drumChannels.has(9), [...drumChannels].sort((a, b) => a - b));
check("일반 트랙은 9번을 피한다", drumChannels.has(0), [...drumChannels].sort((a, b) => a - b));

const drumBack = midiToProject(drumBytes);
const drumTrack = drumBack.tracks.find((t) => isDrumPreset(t.source.presetId));
const toneTrack = drumBack.tracks.find((t) => !isDrumPreset(t.source.presetId));
check(
  "다시 읽어도 드럼은 드럼, 악기는 악기다",
  !!drumTrack && !!toneTrack && drumTrack.notes[0].pitch === 36 && toneTrack.notes[0].pitch === 60,
  drumBack.tracks.map((t) => `${t.name}:${t.source.presetId}`),
);

// --- 쓰레기 입력 ---
let rejected = false;
try { midiToProject(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])); } catch { rejected = true; }
check("MIDI 가 아닌 파일은 사람 말로 거절한다", rejected);

let bad = 0;
for (const r of results) {
  if (!r.ok) bad += 1;
  console.log(`${r.ok ? "✅" : "❌"} ${r.name}${r.ok ? "" : "  " + JSON.stringify(r.detail)}`);
}
console.log(bad === 0 ? `\n전부 통과 (${results.length}개)` : `\n실패 ${bad}개`);
process.exit(bad === 0 ? 0 : 1);
