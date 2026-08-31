/**
 * 상자로 고르기 점검. **브라우저 없이 돈다.**
 *
 * 고르는 규칙은 순수 함수라 여기서 다 볼 수 있다. 화면 쪽(손가락으로 상자를
 * 그리는 것)은 smoke 가 진짜 터치로 확인한다.
 *
 *     node scripts/selection-test.mjs
 */

import { boxFrom, notesInBox, selectionRange, deleteSelected, pruneSelection }
  from "../src/model/selection.ts";
import { copyNotes, pasteAt } from "../src/model/clipboard.ts";

const out = [];
let bad = 0;
const ok = (name, pass, d) => { out.push({ name, pass: !!pass, d }); if (!pass) bad += 1; };

const note = (id, pitch, start, length) => ({ id, pitch, start, length, velocity: 100 });
const track = () => ({
  id: "t", name: "t", source: { kind: "sf2", presetId: 0 },
  volume: 0.8, pan: 0, muted: false,
  notes: [
    note("a", 60, 0, 1),    // 상자 안
    note("b", 64, 0, 1),    // 상자 안 (같은 시각, 높은 음)
    note("c", 60, 4, 1),    // 시간 밖
    note("d", 48, 0, 1),    // 음높이 밖 (베이스)
    note("e", 62, 1.5, 2),  // 상자 끝에 걸침 — 걸치면 통째로 든다
  ],
});

// 어느 방향으로 끌어도 같은 상자가 나와야 한다. 손가락은 오른쪽 위에서
// 왼쪽 아래로도 끈다.
{
  const f = boxFrom({ beat: 2, pitch: 70 }, { beat: 0, pitch: 60 });
  const g = boxFrom({ beat: 0, pitch: 60 }, { beat: 2, pitch: 70 });
  ok("어느 방향으로 끌어도 같은 상자", JSON.stringify(f) === JSON.stringify(g), { f, g });
}

const t = track();
const box = boxFrom({ beat: 0, pitch: 58 }, { beat: 2, pitch: 66 });
const picked = notesInBox(t, box);
const ids = picked.map((n) => n.id).sort().join("");
ok("상자 안의 노트를 고른다", ids === "abe", ids);
ok("시간 밖은 안 고른다", !picked.some((n) => n.id === "c"));
ok("음높이 밖은 안 고른다", !picked.some((n) => n.id === "d"));
// 걸친 노트를 자르면 붙여넣었을 때 앞뒤가 잘린 이상한 노트가 생긴다.
ok("걸친 노트는 통째로 든다", picked.find((n) => n.id === "e")?.length === 2);

// 구간은 상자와 노트를 둘 다 담아야 한다. 노트만 보면 사용자가 비워 둔
// 뒷부분이 사라지고, 상자만 보면 삐져나온 노트가 음수 위치가 된다.
{
  const r = selectionRange(box, picked);
  ok("구간이 상자와 노트를 둘 다 담는다", r.start === 0 && r.end === 3.5, r);
  const wide = selectionRange(boxFrom({ beat: 0, pitch: 58 }, { beat: 8, pitch: 66 }), picked);
  ok("상자가 더 넓으면 상자를 쓴다 (쉼표 자리가 안 사라진다)", wide.end === 8, wide);
  const empty = selectionRange(box, []);
  ok("고른 게 없어도 터지지 않는다", empty.start === 0 && empty.end === 2, empty);
}

// 복사 → 붙여넣기. 고른 모양이 그대로 나와야 한다.
{
  const r = selectionRange(box, picked);
  const clip = copyNotes(picked, r.start, r.end);
  ok("복사한 것의 위치가 상대값이 된다", clip.notes.every((n) => n.start >= 0), clip.notes);
  ok("붙여넣기가 밀 거리는 구간 길이", clip.lengthBeats === 3.5, clip.lengthBeats);

  const dest = track();
  dest.notes = [];
  const added = pasteAt(dest, clip, 8);
  ok("붙여넣으면 고른 개수만큼 생긴다", added.length === 3, added.length);
  ok("붙여넣은 자리가 맞다", added.every((n) => n.start >= 8), added.map((n) => n.start));
  // 같은 id 가 둘이면 지우거나 옮길 때 엉뚱한 게 잡힌다.
  ok("붙여넣은 노트는 새 id 를 받는다",
    added.every((n) => !picked.some((p) => p.id === n.id)));
  // 음높이 간격과 시간 간격이 그대로 유지되는가 (모양이 안 뭉개졌나)
  const shape = added.map((n) => `${n.pitch}@${n.start - 8}`).sort().join(",");
  ok("고른 모양 그대로 붙는다", shape === "60@0,62@1.5,64@0", shape);
}

// 지우기 — 고른 것만 없어져야 한다.
{
  const d = track();
  const removed = deleteSelected(d, new Set(["a", "e"]));
  ok("고른 것만 지운다", removed === 2 && d.notes.length === 3, d.notes.map((n) => n.id));
  ok("안 고른 것은 남는다", d.notes.map((n) => n.id).sort().join("") === "bcd");
  ok("없는 id 를 지우라고 해도 터지지 않는다", deleteSelected(d, new Set(["없음"])) === 0);
}

// 되돌리기로 노트가 사라지면 고른 것도 걷어내야 한다. 안 그러면 "3개 고름"
// 이라고 떠 있는데 지울 게 없는 상태가 된다.
{
  const gone = track();
  gone.notes = gone.notes.filter((n) => n.id !== "a");
  const alive = pruneSelection(gone, new Set(["a", "b"]));
  ok("사라진 노트의 id 는 걷어낸다", alive.size === 1 && alive.has("b"), [...alive]);
  ok("트랙이 없어도 터지지 않는다", pruneSelection(undefined, new Set(["a"])).size === 0);
}

for (const r of out) console.log(`${r.pass ? "✅" : "❌"} ${r.name}${r.pass || r.d === undefined ? "" : "  " + JSON.stringify(r.d)}`);
console.log(bad === 0 ? `\n전부 통과 (${out.length}개)` : `\n실패 ${bad}개`);
process.exit(bad === 0 ? 0 : 1);
