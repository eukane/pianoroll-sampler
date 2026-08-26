/** 복사·붙여넣기 점검 — 브라우저 없이 돈다. */
import { copyRegion, pasteAt, lastBeat } from "../src/model/clipboard.ts";

const out = [];
const ok = (n, pass, d) => out.push({ n, pass: !!pass, d });

const track = () => ({
  id: "t", name: "t", source: { kind: "sf2", presetId: 0 },
  volume: 1, pan: 0, muted: false,
  notes: [
    // 1마디: 도미솔 코드
    { id: "a", pitch: 60, start: 0, length: 1, velocity: 100 },
    { id: "b", pitch: 64, start: 0, length: 1, velocity: 100 },
    { id: "c", pitch: 67, start: 0, length: 1, velocity: 100 },
    // 2마디: 다른 노트
    { id: "d", pitch: 72, start: 4, length: 1, velocity: 100 },
  ],
});

// --- 구간 안의 것만 가져간다 ---
const clip = copyRegion(track(), 0, 4);
ok("1마디 구간에서 코드 3음을 뜬다", clip.notes.length === 3, clip.notes.map(n => n.pitch));
ok("구간 길이를 같이 기억한다", clip.lengthBeats === 4, clip.lengthBeats);
ok("구간 시작 기준 상대 위치로 바뀐다", clip.notes.every(n => n.start === 0),
   clip.notes.map(n => n.start));

// --- 걸친 노트는 안 가져간다 ---
const straddle = track();
straddle.notes.push({ id: "e", pitch: 55, start: 3.5, length: 2, velocity: 100 });
const c2 = copyRegion(straddle, 4, 8);
ok("구간에 걸쳐 있지만 앞에서 시작한 노트는 안 가져간다",
   !c2.notes.some(n => n.pitch === 55), c2.notes.map(n => n.pitch));

// --- 붙여넣기 ---
const t = track();
const added = pasteAt(t, clip, 8);
ok("붙여넣으면 노트가 늘어난다", t.notes.length === 7, t.notes.length);
ok("붙여넣은 위치가 맞다", added.every(n => n.start === 8), added.map(n => n.start));
ok("붙여넣은 음높이가 그대로다",
   JSON.stringify(added.map(n => n.pitch).sort()) === JSON.stringify([60, 64, 67]),
   added.map(n => n.pitch));

// --- id 가 겹치지 않는다 ---
const ids = t.notes.map(n => n.id);
ok("붙여넣은 노트에 새 id 가 붙는다 (겹치면 엉뚱한 게 지워진다)",
   new Set(ids).size === ids.length, ids.length - new Set(ids).size);

// --- 정렬이 유지된다 ---
ok("붙여넣은 뒤에도 시작 순으로 정렬돼 있다",
   t.notes.every((n, i) => i === 0 || t.notes[i - 1].start <= n.start),
   t.notes.map(n => n.start));

// --- 연달아 붙여넣기 (한 마디씩 채우기) ---
const fill = { ...track(), notes: [] };
let at = 0;
for (let i = 0; i < 4; i++) { pasteAt(fill, clip, at); at += clip.lengthBeats; }
ok("연달아 붙여넣어 4마디를 채운다", fill.notes.length === 12, fill.notes.length);
ok("마디마다 4박씩 벌어진다",
   JSON.stringify([...new Set(fill.notes.map(n => n.start))]) === JSON.stringify([0, 4, 8, 12]),
   [...new Set(fill.notes.map(n => n.start))]);
ok("마지막이 끝나는 지점을 안다", lastBeat(fill.notes) === 13, lastBeat(fill.notes));

// --- 빈 구간 ---
const emptyClip = copyRegion(track(), 100, 104);
ok("노트가 없는 구간을 복사해도 터지지 않는다", emptyClip.notes.length === 0);

// --- 거꾸로 끈 구간 ---
const rev = copyRegion(track(), 4, 0);
ok("구간을 거꾸로 끌어도 같은 결과다", rev.notes.length === 3, rev.notes.length);

// --- 음수 위치 ---
const neg = { ...track(), notes: [] };
pasteAt(neg, clip, -5);
ok("음수 위치에 붙여넣으면 0 으로 맞춘다", neg.notes.every(n => n.start >= 0),
   neg.notes.map(n => n.start));

let bad = 0;
for (const r of out) { if (!r.pass) bad++; console.log(`${r.pass ? "✅" : "❌"} ${r.n}${r.pass ? "" : "  " + JSON.stringify(r.d)}`); }
console.log(bad === 0 ? `\n전부 통과 (${out.length}개)` : `\n실패 ${bad}개`);
process.exit(bad === 0 ? 0 : 1);
