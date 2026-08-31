/**
 * 브라우저에서 실제로 되는지 확인하는 연기(smoke) 테스트.
 *
 * 오디오는 귀로 들어야 알지만, **들리기 전에 깨지는 것들**은 자동으로 잡을 수
 * 있다. 여기서 보는 것:
 *   · 첫 터치 전 오디오 잠금 안내가 뜨고, 탭하면 실제로 풀리는가
 *   · 탭으로 노트가 찍히고 그리드에 붙는가
 *   · 몸통 드래그 = 이동, 오른쪽 끝 드래그 = 길이 (서로 안 잡아먹는가)
 *   · 천천히 눌러도 안 지워지고 세부 설정 창이 열리는가
 *   · 상자를 끌어 여러 노트를 고르고, 고른 것만 지우고 복사할 수 있는가
 *   · 16분음표보다 잘게(1/32·1/64) 쪼개 찍고 소리까지 나는가
 *   · 재생 헤드가 BPM 에 맞는 속도로 나아가는가
 *   · 루프 구간을 벗어나지 않고 되돌아오는가
 *   · SF2 를 읽고 프리셋 목록·검색이 되는가
 *   · **악기를 바꿔도 노트 데이터가 그대로인가** (M2 의 핵심)
 *   · 트랙을 늘리면 채널이 갈라지는가
 *   · 사운드폰트를 바꿔 끼우면 목록과 트랙이 따라오는가
 *   · 깨진 파일이 앱을 굳히지 않는가
 *   · WAV / 트랙별 WAV / MIDI / 프로젝트가 실제로 내려받아지는가
 *   · 내보낸 걸 다시 읽으면 노트가 그대로인가 (왕복)
 *   · 낱개 WAV 폴더를 넣으면 건반에 놓이고 없는 음은 채워지는가
 *   · 음소거·솔로·음량이 재생과 렌더 양쪽에 같이 먹히는가
 *   · 되돌리기가 제스처 단위로 돌아가는가
 *   · 손가락을 대는 순간 소리가 나는가 (떼는 순간이 아니라)
 *   · 건반을 길게 누르면 누르는 내내 소리가 나는가 (톡 치면 짧게)
 *   · 붙잡기가 뜯는 소리의 여운을 잘라 먹지 않는가
 *   · 떨림(비브라토)이 세 음원 경로에서 **전부** 실제로 흔들리는가
 *   · 떨림 시작을 늦추면 짧은 음이 안 떨리는가
 *   · 음 하나에 건 꾸밈이 말한 방향으로 휘는가 (끌어올림 · 흘러내림)
 *   · 노트를 톡 치면 꾸밈 창이 열리고, 고른 게 그 음에 남는가
 *     (오른쪽 끝을 쳐도 · 사람 손가락처럼 천천히 흔들리게 쳐도)
 *   · 손가락이 흔들려도(12px) 탭으로 쳐 주는가 — **진짜 터치 이벤트로** 확인
 *   · 다른 트랙에 노트가 있는 자리에도 노트를 찍을 수 있는가 (노래에 필요)
 *   · ⏮ 이 재생 위치를 맨 앞으로 되돌리는가 (재생 중에 눌러도 버튼이 안 뒤집히는가)
 *   · 렌더 경로가 둘로 갈리는데 서로 정렬돼 있는가
 *   · 재생에서 사운드폰트가 임시 신스와 같은 시각에 울리는가 (워크렛 시계 보정)
 *   · 뜯는 소리의 여운을 자르지 않는가 (부는 소리는 자르는가)
 *   · 복사 한 번 + 붙여넣기 연타로 마디가 채워지는가
 *   · 내보내기가 조용히 실패하지 않는가 (무음 · 곡 밖 노트 · 음소거 트랙)
 *   · 예제 곡이 열리고 실제로 소리가 나는가 (덮어쓰기 전에 물어보는가)
 *   · 둘째 예제(일렉트로닉)가 드럼을 9번 채널에 놓고, 드롭에서 커지는가
 *   · UTAU 음원을 넣으면 노래하는 트랙이 되고, 가사대로 실제로 부르는가
 *   · 콘솔 오류가 하나도 없는가
 *
 * 쓰는 법: 다른 창에서 `npm run dev` 를 띄워 두고 `npm run smoke`.
 * 크로미움 경로는 CHROMIUM_PATH 로 지정할 수 있다(없으면 playwright 기본값).
 */

import { chromium, devices } from "playwright";
import { readFileSync, readdirSync } from "node:fs";

const URL = process.env.SMOKE_URL ?? "http://127.0.0.1:5173/";
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

const launchOptions = {
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
};
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ ...devices["Pixel 5"], acceptDownloads: true });
const page = await context.newPage();
// 진짜 터치 이벤트를 보내려면 CDP 가 필요하다. Playwright 의 touchscreen.tap 은
// 0ms 만에 정확한 좌표를 찍어서, 손가락이 흔들리는 걸 흉내낼 수가 없다.
const cdp = await context.newCDPSession(page);

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });

// ---------------------------------------------------------- 오디오 잠금 해제
check("첫 화면에 소리 켜기 안내가 뜬다", await page.locator("#unlock").isVisible());
await page.locator("#unlock").tap();
await page.waitForTimeout(300);
check(
  "탭하면 안내가 사라지고 오디오가 열린다",
  (await page.locator("#unlock").evaluate((el) => el.classList.contains("hidden"))) &&
    (await page.evaluate(() => window.__app.engine.ctx.state)) === "running",
);

// ---------------------------------------------------------------- 노트 찍기
const box = await page.locator("#roll").boundingBox();
const taps = [
  [box.x + 90, box.y + box.height * 0.45],
  [box.x + 170, box.y + box.height * 0.4],
  [box.x + 250, box.y + box.height * 0.5],
  [box.x + 330, box.y + box.height * 0.35],
];
for (const [x, y] of taps) {
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(80);
}
const notes = await page.evaluate(() => window.__app.project.tracks[0].notes.map((n) => ({ ...n })));
const snapUnit = await page.evaluate(() => window.__app.roll.snapUnit);
check("탭 4번 = 노트 4개", notes.length === 4, notes.length);
check(
  "노트가 그리드에 붙는다",
  notes.every((n) => Math.abs(n.start / snapUnit - Math.round(n.start / snapUnit)) < 1e-6),
  notes.map((n) => n.start),
);

const posOf = (id) =>
  page.evaluate((noteId) => {
    const a = window.__app.roll;
    const n = window.__app.project.tracks[0].notes.find((x) => x.id === noteId);
    return {
      left: 46 + n.start * a.pxPerBeat - a.scrollX,
      right: 46 + (n.start + n.length) * a.pxPerBeat - a.scrollX,
      y: 26 + (127 - n.pitch) * a.keyHeight - a.scrollY + a.keyHeight / 2,
      note: { pitch: n.pitch, start: n.start, length: n.length },
    };
  }, id);

// -------------------------------------------------------- 몸통 드래그 = 이동
const id0 = notes[0].id;
let p0 = await posOf(id0);
const beforeMove = p0.note;
await page.mouse.move(box.x + p0.left + 8, box.y + p0.y);
await page.mouse.down();
// 다른 노트와 겹치지 않는 빈 자리로 (겹치면 히트 테스트가 그쪽을 잡는다)
await page.mouse.move(box.x + p0.left + 108, box.y + p0.y + 45, { steps: 10 });
await page.mouse.up();
const afterMove = (await posOf(id0)).note;
check(
  "몸통 드래그는 위치·음높이만 바꾸고 길이는 그대로",
  afterMove.pitch < beforeMove.pitch &&
    afterMove.start > beforeMove.start &&
    afterMove.length === beforeMove.length,
  { beforeMove, afterMove },
);

// --------------------------------------------------- 오른쪽 끝 드래그 = 길이
p0 = await posOf(id0);
await page.mouse.move(box.x + p0.right - 4, box.y + p0.y);
await page.mouse.down();
await page.mouse.move(box.x + p0.right + 90, box.y + p0.y, { steps: 10 });
await page.mouse.up();
const afterResize = (await posOf(id0)).note;
check(
  "오른쪽 끝 드래그는 길이만 바꾼다",
  afterResize.length > afterMove.length &&
    afterResize.start === afterMove.start &&
    afterResize.pitch === afterMove.pitch,
  { afterMove, afterResize },
);

// ------------------------------------------------- 천천히 눌러도 안 지워진다
//
// 예전에는 480ms 를 넘기면 노트가 지워졌다. 그런데 노트를 톡 치면 세부 설정
// 창이 열린다. 둘 사이에 있는 건 **누르고 있던 시간뿐**이라, 폰에서 작은
// 노트를 정확히 누르려고 조금 오래 잡고 있으면 창이 열리는 대신 노트가
// 사라졌다. 사용자 말 그대로: "세부 설정 창이 뜨는 경우도 있고 지워지는
// 경우도 있어."
//
// 길게 눌러 삭제를 없앴다. 지우기는 그 창 안의 🗑 버튼이다.
const countBefore = await page.evaluate(() => window.__app.project.tracks[0].notes.length);
const p2 = await posOf(notes[2].id);
await page.mouse.move(box.x + p2.left + 8, box.y + p2.y);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(200);
const countAfter = await page.evaluate(() => window.__app.project.tracks[0].notes.length);
check("700ms 눌러도 노트가 안 지워진다", countAfter === countBefore, { countBefore, countAfter });
// 창이 안 열렸을 때 여기서 멈추면 뒤 검사가 통째로 안 돈다. 실패로만 남긴다.
const slowOpened = await page.evaluate(
  () => !document.getElementById("note-modal").classList.contains("hidden"));
check("대신 세부 설정 창이 열린다", slowOpened);
if (slowOpened) {
  await page.locator("#note-close").click();
  await page.waitForTimeout(150);
}

// -------------------------------------------------- 재생 헤드가 BPM 대로 간다
await page.evaluate(() => {
  window.__app.scheduler.loopEnabled = false;
  window.__app.project.bpm = 120;
});
await page.locator("#play").click();
await page.waitForTimeout(400);
const t0 = await page.evaluate(() => ({
  beat: window.__app.scheduler.positionBeats(),
  time: window.__app.engine.ctx.currentTime,
}));
await page.waitForTimeout(1000);
const t1 = await page.evaluate(() => ({
  beat: window.__app.scheduler.positionBeats(),
  time: window.__app.engine.ctx.currentTime,
}));
await page.locator("#play").click();
const measuredBpm = ((t1.beat - t0.beat) / (t1.time - t0.time)) * 60;
check("재생 헤드 속도가 BPM 과 맞는다 (120±3)", Math.abs(measuredBpm - 120) < 3, measuredBpm.toFixed(2));

// ------------------------------------------------------------------- 루프
await page.evaluate(() => {
  const { scheduler } = window.__app;
  scheduler.loopStart = 0;
  scheduler.loopEnd = 2;
  scheduler.loopEnabled = true;
});
await page.locator("#play").click();
const samples = [];
for (let i = 0; i < 24; i += 1) {
  samples.push(await page.evaluate(() => window.__app.scheduler.positionBeats()));
  await page.waitForTimeout(120);
}
await page.locator("#play").click();
let wraps = 0;
for (let i = 1; i < samples.length; i += 1) if (samples[i] < samples[i - 1] - 0.2) wraps += 1;
check(
  "루프 구간 안에서만 돌고 되돌아온다",
  samples.every((s) => s >= -1e-6 && s <= 2 + 1e-6) && wraps >= 1,
  { wraps, max: Math.max(...samples).toFixed(3) },
);
check("정지 버튼으로 실제로 멈춘다", !(await page.evaluate(() => window.__app.scheduler.isPlaying)));

// =========================================================== M2: 샘플러

// 사운드폰트 넣기 (실제 사용자 경로 그대로: 파일 선택 → ArrayBuffer → 로드)
await page.locator("#sf-file").setInputFiles("fixtures/test.sf2");
await page.waitForFunction(() => window.__app.registry.usingSoundFont, null, { timeout: 15000 });
const presetCount = await page.evaluate(() => window.__app.registry.soundfont.presetList.length);
check("SF2 를 읽고 프리셋 목록이 나온다", presetCount === 7, presetCount);

// 음원을 넣으면 트랙이 무슨 악기인지 화면에 나와야 한다.
// (예전에는 첫 악기 id 가 0 이면 자동 배정이 통째로 건너뛰어져 "트랙 1" 로 남았다)
const named = await page.evaluate(() => ({
  track: window.__app.project.tracks[0].name,
  button: document.getElementById("instrument").textContent,
}));
check(
  "음원을 넣으면 트랙에 악기 이름이 붙는다",
  named.track === "Acoustic Grand Piano" && named.button.includes("Acoustic Grand Piano"),
  named,
);

// 악기 목록 열기 = 첫 번째 탭
await page.locator("#instrument").click();
await page.waitForTimeout(150);
check("악기 버튼 한 번에 목록이 열린다", await page.locator("#preset-modal").isVisible());

// 검색이 목록을 좁히는가
await page.locator("#preset-search").fill("sax");
await page.waitForTimeout(150);
const saxRows = await page.locator("#preset-list .preset").count();
const saxNames = await page.locator("#preset-list .preset .pname").allTextContents();
check('"sax" 검색이 색소폰만 남긴다', saxRows === 4, saxNames);

// ---- M2 완료 기준: 두 번째 탭으로 악기가 바뀌고 노트는 그대로 ----
const notesBefore = await page.evaluate(() =>
  JSON.stringify(window.__app.project.tracks[0].notes),
);
const sourceBefore = await page.evaluate(() => ({ ...window.__app.project.tracks[0].source }));

await page.locator("#preset-list .preset", { hasText: "Alto Sax" }).click();
await page.waitForTimeout(200);

const notesAfter = await page.evaluate(() =>
  JSON.stringify(window.__app.project.tracks[0].notes),
);
const sourceAfter = await page.evaluate(() => ({ ...window.__app.project.tracks[0].source }));
check(
  "두 번 탭으로 악기가 바뀐다 (알토 색소폰)",
  sourceAfter.presetId === 65 && sourceAfter.presetId !== sourceBefore.presetId,
  { sourceBefore, sourceAfter },
);
check(
  "악기를 바꿔도 노트 데이터는 한 글자도 안 바뀐다",
  notesBefore === notesAfter,
  notesBefore === notesAfter ? undefined : { notesBefore, notesAfter },
);
check("목록이 닫히고 악기 이름이 반영된다", (await page.locator("#instrument").textContent())?.includes("Alto Sax"));

// ---- 사운드폰트 바꿔 끼우기 ----
await page.locator("#sf-file").setInputFiles("fixtures/test-b.sf2");
await page.waitForFunction(
  () => window.__app.registry.soundfont.presetList.some((p) => p.name === "Marimba"),
  null,
  { timeout: 15000 },
);
const swapped = await page.evaluate(() => ({
  presets: window.__app.registry.soundfont.presetList.map((p) => p.name),
  trackName: window.__app.project.tracks[0].name,
  presetId: window.__app.project.tracks[0].source.presetId,
}));
check(
  "음원을 바꾸면 목록이 교체되고 트랙이 없는 악기를 안 가리킨다",
  swapped.presets.length === 3 &&
    !swapped.presets.includes("Alto Sax") &&
    swapped.presets.includes(swapped.trackName),
  swapped,
);

// ---- 깨진 파일이 앱을 굳히지 않는가 ----
// 예전에는 워크렛이 응답을 안 보내 "읽는 중…" 에서 영원히 멈췄다.
await page.locator("#sf-file").setInputFiles({
  name: "깨진.sf2",
  mimeType: "application/octet-stream",
  buffer: Buffer.from("RIFFxxxxgarbage-not-a-real-soundfont"),
});
await page.waitForFunction(
  () => (document.getElementById("status")?.textContent ?? "").includes("읽지 못했습니다"),
  null,
  { timeout: 8000 },
);
const survived = await page.evaluate(() => ({
  stillPlayable: window.__app.registry.usingSoundFont,
  presets: window.__app.registry.soundfont.presetList.length,
}));
check(
  "깨진 파일은 오류를 알리고 쓰던 음원을 날리지 않는다",
  survived.stillPlayable && survived.presets === 3,
  survived,
);

// ---- 다중 트랙 ----
await page.locator(".chip.add").click();
await page.waitForTimeout(150);
const trackCount = await page.evaluate(() => window.__app.project.tracks.length);
check("트랙을 늘릴 수 있다", trackCount === 2, trackCount);

// 2번 트랙에 노트를 찍고 두 트랙 동시 재생
await page.touchscreen.tap(box.x + 140, box.y + box.height * 0.6);
await page.waitForTimeout(100);
const perTrack = await page.evaluate(() =>
  window.__app.project.tracks.map((t) => t.notes.length),
);
check("새 노트는 선택된 트랙에 들어간다", perTrack[1] === 1, perTrack);

await page.evaluate(() => {
  window.__app.scheduler.loopEnabled = false;
});
await page.locator("#play").click();
await page.waitForTimeout(1200);
const playingOk = await page.evaluate(() => window.__app.scheduler.isPlaying);
await page.locator("#play").click();
check("사운드폰트로 여러 트랙이 재생된다", playingOk);

// =========================================================== M3: 내보내기

/** 버튼을 눌러 실제로 내려받고, 파일 내용을 돌려준다. */
async function grab(buttonId, timeout = 60000) {
  await page.locator("#export").click();
  await page.waitForTimeout(120);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout }),
    page.locator(`#${buttonId}`).click(),
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: readFileSync(path) };
}

// 알기 쉬운 멜로디를 하나 심어 둔다 (앞의 검사들이 노트를 흩어 놨다)
await page.evaluate(() => {
  const p = window.__app.project;
  p.bpm = 120;
  p.bars = 2;
  p.tracks.length = 1;
  p.tracks[0].notes = [60, 62, 64, 65].map((pitch, i) => ({
    id: "m" + i, pitch, start: i * 0.5, length: 0.5, velocity: 100,
  }));
  window.__app.scheduler.loopEnabled = false;
});

// ---- WAV ----
const wav = await grab("save-wav");
const wv = new DataView(wav.bytes.buffer, wav.bytes.byteOffset, wav.bytes.byteLength);
const tagAt = (n) => String.fromCharCode(...wav.bytes.subarray(n, n + 4));
let loudest = 0;
for (let i = 44; i + 1 < wav.bytes.length; i += 2) loudest = Math.max(loudest, Math.abs(wv.getInt16(i, true)));
check(
  "WAV 가 내려받아진다 (44.1kHz · 16bit · 무음 아님)",
  tagAt(0) === "RIFF" && tagAt(8) === "WAVE" &&
    wv.getUint32(24, true) === 44100 && wv.getUint16(34, true) === 16 && loudest > 200,
  { name: wav.name, kb: Math.round(wav.bytes.length / 1024), sr: wv.getUint32(24, true), bits: wv.getUint16(34, true), loudest },
);

// ---- MIDI ----
const mid = await grab("save-midi");
const mv = new DataView(mid.bytes.buffer, mid.bytes.byteOffset, mid.bytes.byteLength);
check(
  "MIDI 가 내려받아진다 (SMF 포맷 1)",
  String.fromCharCode(...mid.bytes.subarray(0, 4)) === "MThd" && mv.getUint16(8) === 1,
  { name: mid.name, bytes: mid.bytes.length, format: mv.getUint16(8) },
);

// ---- 트랙별 WAV(스템) ----
await page.evaluate(() => {
  const p = window.__app.project;
  p.tracks.push({
    id: "t2", name: "Tenor Sax", source: { kind: "sf2", presetId: 66 },
    notes: [{ id: "x", pitch: 48, start: 0, length: 2, velocity: 100 }],
    volume: 0.8, pan: 0, muted: false,
  });
});
await page.locator("#export").click();
await page.waitForTimeout(120);
const stems = [];
page.on("download", (d) => stems.push(d.suggestedFilename()));
await page.locator("#save-stems").click();
await page.waitForFunction(
  () => (document.getElementById("status")?.textContent ?? "").includes("트랙별 WAV 2개"),
  null,
  { timeout: 90000 },
);
check("트랙별 WAV 가 트랙 수만큼 나온다", stems.length === 2, stems);

// ---- 프로젝트 JSON 왕복 ----
const before = await page.evaluate(() => JSON.stringify(window.__app.project.tracks.map(t => t.notes)));
const json = await grab("save-json");
await page.evaluate(() => {
  // 다른 상태에서 열어야 진짜로 덮어썼는지 알 수 있다
  window.__app.project.tracks.forEach((t) => (t.notes.length = 0));
  window.__app.project.bpm = 90;
});
await page.locator("#export").click();
await page.waitForTimeout(120);
await page.locator("#import-file").setInputFiles({
  name: json.name, mimeType: "application/json", buffer: json.bytes,
});
await page.waitForTimeout(600);
const afterJson = await page.evaluate(() => ({
  notes: JSON.stringify(window.__app.project.tracks.map(t => t.notes)),
  bpm: window.__app.project.bpm,
}));
check("프로젝트를 저장했다가 열면 그대로 돌아온다",
  afterJson.notes === before && afterJson.bpm === 120, { bpm: afterJson.bpm });

// ---- MIDI 왕복 (화면을 통해) ----
await page.evaluate(() => { window.__app.project.tracks.forEach((t) => (t.notes.length = 0)); });
await page.locator("#export").click();
await page.waitForTimeout(120);
await page.locator("#import-file").setInputFiles({
  name: mid.name, mimeType: "audio/midi", buffer: mid.bytes,
});
await page.waitForTimeout(600);
const afterMidi = await page.evaluate(() => ({
  pitches: window.__app.project.tracks[0].notes.map((n) => n.pitch),
  starts: window.__app.project.tracks[0].notes.map((n) => n.start),
  bpm: window.__app.project.bpm,
}));
check(
  "내보낸 MIDI 를 다시 열면 노트와 BPM 이 살아 있다",
  JSON.stringify(afterMidi.pitches) === JSON.stringify([60, 62, 64, 65]) &&
    JSON.stringify(afterMidi.starts) === JSON.stringify([0, 0.5, 1, 1.5]) &&
    afterMidi.bpm === 120,
  afterMidi,
);

// ---- 노트가 없으면 빈 파일을 내려받게 두지 않는다 ----
await page.evaluate(() => { window.__app.project.tracks.forEach((t) => (t.notes.length = 0)); });
await page.locator("#export").click();
await page.waitForTimeout(120);
await page.locator("#save-wav").click();
await page.waitForTimeout(400);
check(
  "노트가 없으면 빈 파일 대신 안내를 낸다",
  (await page.locator("#status").textContent())?.includes("노트가 하나도 없습니다"),
  await page.locator("#status").textContent(),
);

// =========================================================== M4: 폴더 샘플러

// 경로가 아니라 내용으로 넘긴다. playwright 가 한글 파일명을 경로로 받으면
// 조용히 흘려서 ASCII 이름만 도착한다 (앱이 아니라 테스트 도구 쪽 한계다).
const sampleFiles = readdirSync("fixtures/samples").map((f) => ({
  name: f,
  mimeType: "audio/wav",
  buffer: readFileSync(`fixtures/samples/${f}`),
}));

// 새 트랙에 폴더를 넣는다
await page.evaluate(() => {
  document.getElementById("export-modal")?.classList.add("hidden");
  const p = window.__app.project;
  p.tracks.length = 1;
  p.tracks[0].notes = [];
  window.__app.panel.activeTrack = 0;
});
await page.locator("#instrument").click();
await page.waitForTimeout(150);
await page.locator("#sample-files").setInputFiles(sampleFiles);
await page.waitForFunction(() => window.__app.registry.folders.list.length > 0, null, { timeout: 20000 });
await page.waitForTimeout(400);

const folder = await page.evaluate(() => {
  const f = window.__app.registry.folders.list[0];
  return {
    name: f.name,
    mapped: f.mapped.length,
    unmapped: f.unmapped.map((e) => e.fileName),
    range: f.range,
    trackSource: window.__app.project.tracks[0].source,
    trackName: window.__app.project.tracks[0].name,
  };
});
check(
  "폴더 악기를 쓰는 트랙은 악기 이름이 폴더 이름으로 나온다",
  (await page.locator("#instrument").textContent())?.includes("가야금"),
  await page.locator("#instrument").textContent(),
);
check(
  "낱개 WAV 폴더를 넣으면 파일명대로 건반에 놓인다",
  folder.mapped === 10 && folder.name === "가야금" && folder.trackSource.kind === "sampleFolder",
  folder,
);
check(
  "이름으로 음높이를 모르는 파일은 버리지 않고 따로 세운다",
  folder.unmapped.length === 1 && folder.unmapped[0] === "녹음본.wav",
  folder.unmapped,
);
check(
  "그 파일들을 정하라고 건반 화면을 띄운다",
  await page.locator("#map-modal").isVisible(),
);

// 수동으로 건반 정하기
await page.locator("#map-list select").first().selectOption("64");
await page.waitForTimeout(200);
const afterMap = await page.evaluate(() => ({
  mapped: window.__app.registry.folders.list[0].mapped.length,
  unmapped: window.__app.registry.folders.list[0].unmapped.length,
}));
check("건반을 골라 주면 그 샘플도 쓰인다", afterMap.mapped === 11 && afterMap.unmapped === 0, afterMap);
await page.locator("#map-close").click();

// 두 옥타브가 실제로 소리 나는가 — 샘플이 없는 음은 피치 시프트로 채워야 한다
const coverage = await page.evaluate(() => {
  const f = window.__app.registry.folders.list[0];
  const out = { covered: 0, total: 0, exact: 0 };
  for (let pitch = 48; pitch <= 72; pitch += 1) {
    out.total += 1;
    const hit = f.pick(pitch, 100);
    if (hit) {
      out.covered += 1;
      if (hit.pitch === pitch) out.exact += 1;
    }
  }
  return out;
});
check(
  "샘플이 없는 음도 가장 가까운 것으로 채운다 (두 옥타브 전부)",
  coverage.covered === coverage.total && coverage.exact < coverage.total,
  coverage,
);

// 폴더 악기로 실제 렌더가 되는가
await page.evaluate(() => {
  const t = window.__app.project.tracks[0];
  t.notes = [60, 62, 64, 65, 67].map((pitch, i) => ({
    id: "g" + i, pitch, start: i * 0.5, length: 0.5, velocity: 100,
  }));
  window.__app.project.bpm = 120;
  window.__app.project.bars = 2;
});
const folderRender = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const { peakOf } = await import("/src/export/wav.ts");
  const buf = await renderProject(
    window.__app.project,
    () => window.__app.registry.soundfont.bankBuffer(),
    window.__app.registry.folders.list,
  );
  return { peak: +peakOf(buf).toFixed(4) };
});
check("폴더 악기도 WAV 로 렌더된다 (무음 아님)", folderRender.peak > 0.01, folderRender);

// 사운드폰트 트랙 + 폴더 트랙이 섞여도 둘 다 들어가는가
const mixedRender = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const { peakOf } = await import("/src/export/wav.ts");
  const p = window.__app.project;
  p.tracks.push({
    id: "sf", name: "Marimba", source: { kind: "sf2", presetId: 12 },
    notes: [{ id: "sf1", pitch: 48, start: 0, length: 2, velocity: 110 }],
    volume: 0.8, pan: 0, muted: false,
  });
  const only = await renderProject(
    { ...p, tracks: [p.tracks[0]] },
    () => window.__app.registry.soundfont.bankBuffer(),
    window.__app.registry.folders.list,
  );
  const both = await renderProject(
    p,
    () => window.__app.registry.soundfont.bankBuffer(),
    window.__app.registry.folders.list,
  );
  return { onlyFolder: +peakOf(only).toFixed(4), mixed: +peakOf(both).toFixed(4) };
});
check(
  "사운드폰트 트랙과 폴더 트랙이 섞여도 둘 다 소리가 난다",
  mixedRender.mixed > mixedRender.onlyFolder,
  mixedRender,
);

// =========================================================== M5: 믹서 · 되돌리기

// 깨끗한 상태에서 시작
await page.evaluate(() => {
  const p = window.__app.project;
  p.bpm = 120;
  p.bars = 2;
  p.tracks.length = 1;
  p.tracks[0].source = { kind: "sf2", presetId: 0 };
  p.tracks[0].notes = [60, 64, 67].map((pitch, i) => ({
    id: "v" + i, pitch, start: i * 0.5, length: 0.5, velocity: 110,
  }));
  p.tracks[0].volume = 1;
  p.tracks[0].muted = false;
  p.tracks[0].reverbSend = 0;
  window.__app.mixerState.clearSolo();
  window.__app.panel.activeTrack = 0;
  window.__app.roll.activeTrack = 0;
});

const renderPeak = () =>
  page.evaluate(async () => {
    const { renderProject } = await import("/src/export/render.ts");
    const { peakOf } = await import("/src/export/wav.ts");
    const buf = await renderProject(
      window.__app.project,
      () => window.__app.registry.soundfont.bankBuffer(),
      window.__app.registry.folders.list,
      window.__app.mixerState,
    );
    return +peakOf(buf).toFixed(4);
  });

const loud = await renderPeak();
check("기준 렌더에 소리가 있다", loud > 0.01, loud);

// ---- 음량 ----
await page.evaluate(() => (window.__app.project.tracks[0].volume = 0.25));
const quiet = await renderPeak();
check("음량을 줄이면 렌더도 같이 작아진다", quiet < loud * 0.6 && quiet > 0.001, { loud, quiet });

// ---- 음소거 ----
await page.evaluate(() => {
  window.__app.project.tracks[0].volume = 1;
  window.__app.project.tracks[0].muted = true;
});
const muted = await renderPeak();
check("음소거한 트랙은 렌더에서도 안 들린다", muted < 0.001, muted);

// ---- 솔로 ----
await page.evaluate(() => {
  const p = window.__app.project;
  p.tracks[0].muted = false;
  p.tracks.push({
    id: "solo2", name: "둘째", source: { kind: "sf2", presetId: 0 },
    notes: [{ id: "s1", pitch: 48, start: 0, length: 2, velocity: 120 }],
    volume: 1, pan: 0, muted: false, reverbSend: 0,
  });
});
const bothTracks = await renderPeak();
await page.evaluate(() => {
  window.__app.mixerState.toggleSolo(window.__app.project.tracks[1]);
});
const soloOnly = await renderPeak();
check(
  "솔로를 걸면 그 트랙만 렌더된다",
  soloOnly > 0.001 && soloOnly < bothTracks,
  { bothTracks, soloOnly },
);
await page.evaluate(() => window.__app.mixerState.clearSolo());

// ---- 재생과 렌더가 같은 음량인가 ----
// 렌더는 MIDI 를 거치는데 거기에 CC7(볼륨)을 실으면 신스가 한 번 더 줄인다.
// GM 의 CC7 은 제곱 곡선이라 결과가 **세제곱**으로 줄어들었다 (실측 0.5→0.127).
// 기본값 볼륨 0.8 에서 WAV 가 재생의 절반 음량으로 나갔다.
const linearity = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const { peakOf } = await import("/src/export/wav.ts");
  const p = window.__app.project;
  p.bars = 1;
  p.tracks.length = 1;
  p.tracks[0].source = { kind: "sf2", presetId: 0 };
  p.tracks[0].pan = 0; p.tracks[0].muted = false; p.tracks[0].reverbSend = 0;
  p.tracks[0].notes = [{ id: "v", pitch: 60, start: 0, length: 1, velocity: 100 }];
  const at = async (v) => {
    p.tracks[0].volume = v;
    const b = await renderProject(p, () => window.__app.registry.soundfont.bankBuffer(),
      [], window.__app.mixerState);
    return peakOf(b);
  };
  const full = await at(1.0);
  const half = await at(0.5);
  return { ratio: +(half / full).toFixed(3) };
});
check(
  "음량이 렌더에 한 번만 걸린다 (재생과 같은 크기)",
  Math.abs(linearity.ratio - 0.5) < 0.03,
  { "볼륨0.5일때비율": linearity.ratio, 기대: 0.5 },
);

// ---- 리버브 센드 ----
await page.evaluate(() => {
  const p = window.__app.project;
  p.tracks.length = 1;
  p.tracks[0].notes = [{ id: "r1", pitch: 60, start: 0, length: 0.25, velocity: 110 }];
  p.tracks[0].reverbSend = 0;
});
const dryTail = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const tailEnergy = (buf) => {
    const d = buf.getChannelData(0);
    // 노트(0.125초)가 끝나고 릴리즈까지 지난 뒤부터 잰다. 울림 자체가 1.8초
    // 짜리라 2초 뒤부터 재면 이미 다 잦아든 다음이라 양쪽 다 0 이 나온다.
    let sum = 0;
    for (let i = Math.floor(buf.sampleRate * 0.4); i < Math.floor(buf.sampleRate * 2); i++) {
      sum += Math.abs(d[i]);
    }
    return sum;
  };
  const render = async () =>
    tailEnergy(await renderProject(
      window.__app.project,
      () => window.__app.registry.soundfont.bankBuffer(),
      window.__app.registry.folders.list,
      window.__app.mixerState,
    ));
  const dry = await render();
  window.__app.project.tracks[0].reverbSend = 1;
  const wet = await render();
  return { dry: +dry.toFixed(2), wet: +wet.toFixed(2) };
});
check(
  "울림을 올리면 소리가 끝난 뒤에도 꼬리가 남는다",
  dryTail.wet > dryTail.dry * 2,
  dryTail,
);

// ---- 믹서 화면 ----
await page.evaluate(() => (window.__app.project.tracks[0].reverbSend = 0));
await page.locator("#mixer").click();
await page.waitForTimeout(200);
check("믹서 화면이 열린다", await page.locator("#mixer-modal").isVisible());
const sliders = await page.locator("#mixer-list .mixslider input").count();
// 음량 · 팬 · 떨림 · 울림. "떨림 시작" 은 떨림이 0 보다 클 때만 나온다.
check("트랙마다 음량·팬·떨림·울림 네 개가 있다", sliders === 4, sliders);
await page.locator("#mixer-close").click();

// ---- 되돌리기 ----
const beforeUndo = await page.evaluate(() => window.__app.project.tracks[0].notes.length);
const rollBox = await page.locator("#roll").boundingBox();
await page.touchscreen.tap(rollBox.x + 200, rollBox.y + rollBox.height * 0.5);
await page.waitForTimeout(200);
const afterTap = await page.evaluate(() => window.__app.project.tracks[0].notes.length);
check("노트를 찍으면 되돌리기 버튼이 살아난다",
  afterTap === beforeUndo + 1 && !(await page.locator("#undo").isDisabled()),
  { beforeUndo, afterTap });

await page.locator("#undo").click();
await page.waitForTimeout(200);
const afterUndo = await page.evaluate(() => window.__app.project.tracks[0].notes.length);
check("되돌리면 찍은 노트가 사라진다", afterUndo === beforeUndo, { afterUndo, beforeUndo });

await page.locator("#redo").click();
await page.waitForTimeout(200);
const afterRedo = await page.evaluate(() => window.__app.project.tracks[0].notes.length);
check("다시 실행하면 되살아난다", afterRedo === beforeUndo + 1, afterRedo);

// 드래그 한 번은 되돌리기 한 번이어야 한다 (프레임마다 쌓이면 안 된다)
const dragTarget = await page.evaluate(() => {
  const a = window.__app.roll;
  const n = window.__app.project.tracks[0].notes[0];
  // 노트를 화면 안으로 가져온 뒤 좌표를 잰다. 스크롤이 딴 데 가 있으면
  // 계산한 자리가 캔버스 밖이라 마우스가 노트에 닿지도 않는다.
  // (재생 중에 followPlayhead 가 가로 스크롤을 옮겨 놓는다)
  a.scrollToPitch(n.pitch);
  a.scrollX = 0;
  return {
    x: 46 + n.start * a.pxPerBeat - a.scrollX + 8,
    y: 26 + (127 - n.pitch) * a.keyHeight - a.scrollY + a.keyHeight / 2,
    pitch: n.pitch,
  };
});
await page.mouse.move(rollBox.x + dragTarget.x, rollBox.y + dragTarget.y);
await page.mouse.down();
for (let i = 1; i <= 12; i += 1) {
  await page.mouse.move(rollBox.x + dragTarget.x + i * 8, rollBox.y + dragTarget.y + i * 3);
  await page.waitForTimeout(12);
}
await page.mouse.up();
await page.waitForTimeout(200);
const movedPitch = await page.evaluate(() => window.__app.project.tracks[0].notes[0].pitch);
await page.locator("#undo").click();
await page.waitForTimeout(200);
const restoredPitch = await page.evaluate(() => window.__app.project.tracks[0].notes[0].pitch);
check(
  "끌어서 옮긴 것은 되돌리기 한 번에 통째로 돌아온다",
  movedPitch !== dragTarget.pitch && restoredPitch === dragTarget.pitch,
  { 원래: dragTarget.pitch, 옮긴뒤: movedPitch, 되돌린뒤: restoredPitch },
);

// ---- 단축키 ----
await page.locator("#roll").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Space");
await page.waitForTimeout(400);
const playingBySpace = await page.evaluate(() => window.__app.scheduler.isPlaying);
await page.keyboard.press("Space");
await page.waitForTimeout(200);
check(
  "스페이스로 재생·정지가 된다",
  playingBySpace && !(await page.evaluate(() => window.__app.scheduler.isPlaying)),
  playingBySpace,
);

// ---- 누르는 즉시 소리가 나는가 ----
// 예전에는 노트가 찍히는 순간(= 손가락을 뗄 때) 소리를 냈다. 그러면 누르고
// 있는 시간이 그대로 지연이 된다 — 실측 124ms 였다. 조용히 되돌아가기 쉬운
// 종류라 못 박아 둔다.
await page.evaluate(() => {
  window.__previewAt = [];
  const s = window.__app.scheduler;
  // 소리를 실제로 내는 자리는 previewHold 다 (preview 도 이걸 부른다).
  const orig = s.previewHold.bind(s);
  s.previewHold = (...a) => { window.__previewAt.push(performance.now()); return orig(...a); };
  const canvas = document.getElementById("roll");
  window.__downAt = 0;
  canvas.addEventListener("pointerdown", () => (window.__downAt = performance.now()), true);
});
const latBox = await page.locator("#roll").boundingBox();
await page.mouse.move(latBox.x + 150, latBox.y + latBox.height * 0.55);
await page.mouse.down();
await page.waitForTimeout(150);   // 사람이 탭할 때만큼 누르고 있는다
await page.mouse.up();
await page.waitForTimeout(150);
const latency = await page.evaluate(() => {
  const p = window.__previewAt;
  return p.length ? +(p[0] - window.__downAt).toFixed(1) : null;
});
check(
  "누른 뒤 곧바로 소리가 난다 (떼는 순간이 아니라)",
  latency !== null && latency < 90,
  { 누른뒤ms: latency, 손가락댄시간ms: 150, 예전동작: "떼는 순간 = 150ms+" },
);


// ---- 길게 누르면 길게 소리 나는가 ----
//
// 예전에는 건반을 누르면 무조건 0.25초짜리 한 방이었다. 가야금·색소폰처럼 길게
// 끄는 음원은 0.25초로는 무슨 소리인지 알 수가 없다 — 음원을 고르려고 누르는
// 자리인데 정작 그 판단을 못 했다.
//
// 함수가 불렸는지가 아니라 **소리가 계속 났는지**를 본다. 마스터에 분석기를
// 물려 놓고 누르고 있는 동안의 음량을 기록한다.
const holdTrace = async (holdMs) => {
  await page.evaluate(() => {
    const app = window.__app;
    const ctx = app.engine.ctx;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    app.engine.master.connect(an);
    const buf = new Float32Array(an.fftSize);
    window.__rms = [];
    window.__rmsStop = () => {
      clearInterval(timer);
      an.disconnect();
    };
    const t0 = performance.now();
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      window.__rms.push({ t: performance.now() - t0, v: Math.sqrt(sum / buf.length) });
    }, 25);
  });
  const box = await page.locator("#roll").boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height * 0.55); // 왼쪽 건반(GUTTER 46px 안쪽)
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const trace = await page.evaluate(() => {
    window.__rmsStop();
    return window.__rms;
  });
  // 손가락을 댄 시각을 0 으로 잡는다. 기록은 대기 직전에 시작했으니 거의 같다.
  const at = (ms) => trace.find((r) => r.t >= ms)?.v ?? 0;
  const peak = Math.max(...trace.map((r) => r.v));
  return { at, peak, trace };
};

const longHold = await holdTrace(1200);
check(
  "건반을 길게 누르면 누르는 내내 소리가 난다",
  longHold.at(1000) > longHold.peak * 0.2,
  { "1000ms 음량": +longHold.at(1000).toFixed(4), 최대: +longHold.peak.toFixed(4) },
);
check(
  "손을 떼면 소리가 멎는다",
  longHold.at(1700) < longHold.peak * 0.1,
  { "뗀 뒤 500ms": +longHold.at(1700).toFixed(4), 최대: +longHold.peak.toFixed(4) },
);

const quickTap = await holdTrace(40);
check(
  "톡 치고 떼도 소리는 들린다 (최소 250ms)",
  quickTap.at(200) > quickTap.peak * 0.2,
  { "200ms 음량": +quickTap.at(200).toFixed(4), 최대: +quickTap.peak.toFixed(4) },
);

// ---- 렌더 경로 둘이 정렬돼 있는가 ----
//
// SF2 트랙은 startOfflineRender(MIDI 경유), 폴더 샘플러 트랙은 노트를 직접
// 꽂는다. 경로가 갈려서 각각은 잘 되는데 **합칠 때 어긋날** 수 있다.
// 실제로 어긋나 있었다 — 시퀀서의 skipToFirstNoteOn 이 앞 무음을 잘라서
// SF2 트랙만 맨 앞으로 당겨졌다. 1박에 놓은 노트가 497ms 밀렸다.
// 한 트랙씩 뽑아 보면 절대 안 잡히는 종류라 못 박아 둔다.
const alignment = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const app = window.__app;
  const folderId = app.registry.folders.list[0]?.id;
  if (!folderId) return { skipped: true };

  const at = (source) => ({
    bpm: 120, bars: 2, timeSig: [4, 4],
    tracks: [{
      id: "x", name: "t", source,
      notes: [{ id: "n", pitch: 60, start: 1, length: 0.5, velocity: 120 }],
      volume: 1, pan: 0, muted: false, reverbSend: 0,
    }],
  });
  const firstAudible = (buf) => {
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 1e-5) return i;
    return -1;
  };
  const render = (p) => renderProject(p, () => app.registry.soundfont.bankBuffer(),
    app.registry.folders.list, app.mixerState);

  const sf = await render(at({ kind: "sf2", presetId: 0 }));
  const fl = await render(at({ kind: "sampleFolder", folderId }));
  const ideal = Math.round(1 * (60 / 120) * sf.sampleRate);
  return {
    skipped: false,
    sfLateMs: +(((firstAudible(sf) - ideal) / sf.sampleRate) * 1000).toFixed(3),
    flLateMs: +(((firstAudible(fl) - ideal) / fl.sampleRate) * 1000).toFixed(3),
    gapMs: +(((firstAudible(fl) - firstAudible(sf)) / sf.sampleRate) * 1000).toFixed(3),
  };
});
check(
  "SF2 트랙과 폴더 트랙이 같은 자리에서 소리 난다 (렌더 퀀텀 1개 이내)",
  alignment.skipped || Math.abs(alignment.gapMs) < 3.0,
  alignment,
);

// ---- 실시간 재생에서도 정렬돼 있는가 ----
//
// 위 검사는 **내보내기** 경로다. 화면에서 듣는 재생은 noteOn(..., {time}) 으로
// 예약하는 다른 경로이고, 여기가 실제로 밀려 있었다 — 사운드폰트만 70.9ms 늦게
// 울렸다(임시 신스·폴더 샘플러는 정확). 워크렛이 자기 시계를 따로 세는데 그
// 시작점이 어긋나서 생긴 고정 오차라, 재서 당겨 주는 수밖에 없다
// (audio/soundfont.ts 의 calibrate).
//
// 재는 법: 채널 0(임시 신스)과 1(사운드폰트)에 분석기를 하나씩 물리고 같은
// 시각에 예약한 뒤, 한 틱 안에서 두 파형의 시작 샘플을 비교한다.
const livePlay = await page.evaluate(async () => {
  const app = window.__app;
  const ctx = app.engine.ctx;
  const tap = (ch) => {
    const a = ctx.createAnalyser();
    a.fftSize = 32768;
    app.mixer.inputs[ch].connect(a);
    return a;
  };
  const a0 = tap(0);
  const a1 = tap(1);
  app.registry.soundfont.setPreset(1, app.registry.soundfont.presetList[0].id);
  for (const ch of [0, 1]) app.mixer.set(ch, { volume: 1, pan: 0, muted: false, send: 0 });
  await new Promise((r) => setTimeout(r, 200));

  const T = ctx.currentTime + 0.3;
  app.registry.osc.play(69, 110, T, 0.4, 0);
  app.registry.soundfont.play(69, 110, T, 0.4, 1);
  await new Promise((r) => setTimeout(r, 600));

  const b0 = new Float32Array(a0.fftSize);
  const b1 = new Float32Array(a1.fftSize);
  a0.getFloatTimeDomainData(b0);
  a1.getFloatTimeDomainData(b1);
  a0.disconnect();
  a1.disconnect();
  const onset = (x) => {
    for (let i = 0; i < x.length; i += 1) if (Math.abs(x[i]) > 1e-4) return i;
    return -1;
  };
  const i0 = onset(b0);
  const i1 = onset(b1);
  return {
    ok: i0 >= 0 && i1 >= 0,
    gapMs: +(((i1 - i0) / ctx.sampleRate) * 1000).toFixed(1),
    offsetMs: +app.registry.soundfont.clockOffsetMs.toFixed(1),
  };
});
// 문턱을 15ms 로 잡는다. 보정값 자체를 실측으로 뽑는데 그 측정에 ±5ms 쯤
// 흔들림이 있어서, 남는 오차도 그만큼 흔들린다. 고치기 전이 55~110ms 였으니
// 이 문턱은 여전히 회귀를 잡는다. 15ms 는 120BPM 에서 한 박의 3% 다.
check(
  "재생에서 사운드폰트가 임시 신스와 같은 시각에 울린다 (15ms 이내)",
  livePlay.ok && Math.abs(livePlay.gapMs) < 15,
  livePlay,
);
check("사운드폰트 지연을 실제로 재서 보정했다", livePlay.offsetMs > 0, livePlay.offsetMs);

// ---- 뜯는 악기의 여운 ----
//
// 가야금은 손을 떼도 줄이 계속 울린다. 노트 길이에서 자르면 가야금다움이
// 통째로 사라진다. 그렇다고 늘 끝까지 두면 부는 악기가 늘어진다.
// 샘플 자체를 재서 가른다 (audio/folderSampler.ts 의 looksDecaying).
await page.locator("#instrument").click();
await page.waitForTimeout(150);
await page.locator("#sample-files").setInputFiles(
  readdirSync("fixtures/sustained").map((f) => ({
    name: f, mimeType: "audio/wav", buffer: readFileSync(`fixtures/sustained/${f}`),
  })),
);
await page.waitForFunction(() => window.__app.registry.folders.list.length > 1, null, { timeout: 30000 });
await page.waitForTimeout(400);
await page.locator("#map-close").click().catch(() => {});

const decay = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const app = window.__app;
  const [pluck, sus] = app.registry.folders.list;
  const lastSound = async (folderId) => {
    const p = {
      bpm: 120, bars: 2, timeSig: [4, 4],
      tracks: [{ id: "t", name: "t", source: { kind: "sampleFolder", folderId },
        notes: [{ id: "n", pitch: 72, start: 0, length: 0.25, velocity: 110 }],
        volume: 1, pan: 0, muted: false, reverbSend: 0 }],
    };
    const b = await renderProject(p, async () => null, app.registry.folders.list, app.mixerState);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 1e-4) last = i;
    return +(last / b.sampleRate).toFixed(3);
  };
  return {
    뜯는판정: pluck.entries.every((e) => e.decaying),
    부는판정: sus.entries.every((e) => !e.decaying),
    뜯는끝초: await lastSound(pluck.id),
    부는끝초: await lastSound(sus.id),
  };
});
check("뜯는 소리와 부는 소리를 샘플에서 재서 가른다", decay.뜯는판정 && decay.부는판정, decay);
check(
  "짧은 노트여도 뜯는 소리는 여운이 그대로 남는다 (1.2초 샘플)",
  decay.뜯는끝초 > 1.0,
  { 노트길이초: 0.125, 실제끝초: decay.뜯는끝초 },
);
check(
  "부는 소리는 노트 길이를 따른다 (3초 샘플이 늘어지지 않는다)",
  decay.부는끝초 < 0.6,
  { 노트길이초: 0.125, 실제끝초: decay.부는끝초 },
);

// ---- 붙잡기가 여운 규칙을 어기지 않는가 ----
//
// "길게 누르면 길게" 를 넣으면서 뜯는 소리까지 붙잡아 버리면, 손을 뗄 때
// 가야금 여운을 잘라 먹게 된다. 위에서 어렵게 살려 놓은 그 여운이다.
// 뜯는 소리는 붙잡지 않고 그냥 울리게 두고, 부는 소리만 붙잡는다.
const holdKinds = await page.evaluate(async () => {
  const app = window.__app;
  const ctx = app.engine.ctx;
  const [pluck, sus] = app.registry.folders.list;
  const measure = async (folderId, channel) => {
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    app.mixer.inputs[channel].connect(an);
    const buf = new Float32Array(an.fftSize);
    const rms = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.sqrt(sum / buf.length);
    };
    app.mixer.set(channel, { volume: 1, pan: 0, muted: false, send: 0 });
    app.registry.folders.setChannelFolder(channel, folderId);
    app.registry.folders.hold(72, 110, channel);
    await new Promise((r) => setTimeout(r, 120));
    app.registry.folders.release(72, channel); // 아주 짧게 누르고 뗀다
    await new Promise((r) => setTimeout(r, 500));
    const after = rms();
    await new Promise((r) => setTimeout(r, 900));
    an.disconnect();
    return +after.toFixed(4);
  };
  return { 뜯기: await measure(pluck.id, 4), 불기: await measure(sus.id, 5) };
});
check(
  "짧게 눌렀다 떼도 뜯는 소리의 여운은 남는다",
  holdKinds.뜯기 > 0.001,
  holdKinds,
);
check("부는 소리는 떼면 멎는다", holdKinds.불기 < 0.001, holdKinds);

// ---- 떨림(비브라토) ----
//
// 사운드폰트는 CC1(모듈레이션 휠)로 신스에게 흔들라고 시키고, 임시 신스와
// 낱개 WAV 는 우리가 LFO 로 직접 흔든다. **경로가 셋인데 하나만 안 먹으면
// 슬라이더가 거짓말을 한다.** 셋 다 실제로 음정이 흔들리는지 잰다.
//
// 재는 법: 긴 음 하나를 렌더해서 자기상관으로 음정을 추적하고, 흔들린 폭을
// 센트로 낸다. 깊이 0 이면 폭이 0 이어야 하고, 깊이 1 이면 벌어져야 한다.
const vibrato = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const app = window.__app;
  const folderId = app.registry.folders.list[1]?.id; // 지속음 폴더(부는 소리)

  const at = (source, depth) => ({
    bpm: 100, bars: 2, timeSig: [4, 4],
    tracks: [{
      id: "v", name: "v", source,
      notes: [{ id: "n", pitch: 69, start: 0, length: 4, velocity: 110 }],
      volume: 1, pan: 0, muted: false, reverbSend: 0,
      vibrato: depth, vibratoDelay: 0,
    }],
  });

  // 자기상관으로 구간마다 기본 주파수를 재고, 흔들린 폭을 센트로 낸다.
  const spreadCents = (buf) => {
    const d = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const SUB = 1024;
    const minLag = Math.floor(sr / 1200);
    const maxLag = Math.floor(sr / 200);
    const cents = [];
    for (let s = Math.floor(sr * 0.25); s + SUB + maxLag < d.length && s < sr * 1.8; s += SUB) {
      let energy = 0;
      for (let i = s; i < s + SUB; i++) energy += d[i] * d[i];
      if (Math.sqrt(energy / SUB) < 0.003) continue;
      // 자기상관. 순수한 사인파는 주기의 배수마다 상관이 똑같이 높아서
      // 그냥 최대값을 고르면 한 옥타브 아래를 짚는다. 최대값의 92% 를 넘는
      // **가장 짧은** 주기를 고르면 그 함정을 피한다.
      const r = [];
      for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i < SUB; i++) sum += d[s + i] * d[s + i + lag];
        r.push(sum);
      }
      const peak = Math.max(...r);
      if (peak <= 0) continue;
      let idx = r.findIndex((v) => v >= peak * 0.92);
      // 그 근처의 진짜 봉우리로 올라간다.
      while (idx + 1 < r.length && r[idx + 1] > r[idx]) idx += 1;
      if (idx <= 0 || idx + 1 >= r.length) continue;
      // 정수 lag 만 쓰면 440Hz 근처에서 눈금이 17센트다 — 떨림보다 굵다.
      // 봉우리 좌우로 포물선을 맞춰 소수점 아래를 찾는다.
      const denom = r[idx - 1] - 2 * r[idx] + r[idx + 1];
      const delta = denom === 0 ? 0 : (0.5 * (r[idx - 1] - r[idx + 1])) / denom;
      const bestLag = minLag + idx + Math.max(-1, Math.min(1, delta));
      cents.push(1200 * Math.log2(sr / bestLag / 440));
    }
    if (cents.length < 8) return null;
    // 자기상관은 가끔 한 옥타브를 틀린다. 중앙값에서 300센트 넘게 벗어나면 버린다.
    const mid = [...cents].sort((a, b) => a - b)[Math.floor(cents.length / 2)];
    const good = cents.filter((c) => Math.abs(c - mid) < 300).sort((a, b) => a - b);
    return good.length < 8 ? null : +(good[good.length - 1] - good[0]).toFixed(1);
  };

  window.__spread = spreadCents; // 아래 딜레이 점검에서 다시 쓴다
  const render = (p) => renderProject(p, () => app.registry.soundfont.bankBuffer(),
    app.registry.folders.list, app.mixerState);
  const measure = async (source) => ({
    없음: spreadCents(await render(at(source, 0))),
    최대: spreadCents(await render(at(source, 1))),
  });

  return {
    사운드폰트: await measure({ kind: "sf2", presetId: 0 }),
    낱개WAV: folderId ? await measure({ kind: "sampleFolder", folderId }) : null,
    // 폴더가 없으면 임시 신스로 떨어진다 (audio/registry.ts).
    임시신스: await measure({ kind: "sampleFolder", folderId: "없는폴더" }),
  };
});
// 딜레이 — 짧은 음은 저절로 안 떨려야 한다. 이게 없으면 16분음표까지 전부
// 떨어서 기계처럼 들린다. 떨림 기능의 절반은 사실 이쪽이다.
const vibDelay = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const app = window.__app;
  const short = (delay) => ({
    bpm: 100, bars: 2, timeSig: [4, 4],
    tracks: [{
      id: "v", name: "v", source: { kind: "sf2", presetId: 0 },
      notes: [{ id: "n", pitch: 69, start: 0, length: 0.5, velocity: 110 }], // 0.3초
      volume: 1, pan: 0, muted: false, reverbSend: 0,
      vibrato: 1, vibratoDelay: delay,
    }],
  });
  const render = (p) => renderProject(p, () => app.registry.soundfont.bankBuffer(),
    app.registry.folders.list, app.mixerState);
  return {
    바로: window.__spread(await render(short(0))),
    "0.6초뒤": window.__spread(await render(short(0.6))),
  };
});
// ---- 음 하나 조교 (꾸밈) ----
//
// 트랙에 떨림을 걸면 그 악기의 긴 음이 전부 똑같이 떤다 — 기교가 아니라 버릇이다.
// 꾸밈은 **음마다** 붙어서, 같은 음높이를 찍어도 하나는 끌어올리고 하나는
// 흘려 내릴 수 있어야 한다. 모양이 실제로 그 방향으로 나오는지 렌더해서 잰다.
// (부호 하나만 뒤집혀도 "뭔가 휘긴 하네" 로 들려서 귀로는 안 잡힌다.)
const ornamentShape = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const app = window.__app;
  const one = (ornament) => ({
    bpm: 100, bars: 2, timeSig: [4, 4],
    tracks: [{
      id: "o", name: "o", source: { kind: "sf2", presetId: 0 },
      notes: [{ id: "n", pitch: 69, start: 0, length: 4, velocity: 110, ornament, ornamentAmount: 1 }],
      volume: 1, pan: 0, muted: false, reverbSend: 0,
    }],
  });
  const render = (p) => renderProject(p, () => app.registry.soundfont.bankBuffer(),
    app.registry.folders.list, app.mixerState);
  // 그 시각 근처의 음정(센트)을 하나만 집어 낸다.
  const at = (buf, seconds) => {
    const d = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const SUB = 1024;
    const minLag = Math.floor(sr / 1200);
    const maxLag = Math.floor(sr / 200);
    const s = Math.max(0, Math.min(d.length - SUB - maxLag - 1, Math.floor(seconds * sr)));
    const r = [];
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i < SUB; i++) sum += d[s + i] * d[s + i + lag];
      r.push(sum);
    }
    const peak = Math.max(...r);
    if (peak <= 0) return null;
    let idx = r.findIndex((v) => v >= peak * 0.92);
    while (idx + 1 < r.length && r[idx + 1] > r[idx]) idx += 1;
    return +(1200 * Math.log2(sr / (minLag + idx) / 440)).toFixed(0);
  };
  const shape = async (ornament) => {
    const buf = await render(one(ornament));
    return { 시작: at(buf, 0.02), 중간: at(buf, 1.2), 끝: at(buf, 2.3) };
  };
  return { 끌어올림: await shape("scoop"), 흘러내림: await shape("fall"), 그냥: await shape("none") };
});
check(
  "꾸밈이 없으면 음정이 처음부터 끝까지 그대로다",
  Math.abs(ornamentShape.그냥.시작) < 25 && Math.abs(ornamentShape.그냥.끝) < 25,
  ornamentShape.그냥,
);
check(
  "끌어올림은 아래에서 붙여 올린다",
  ornamentShape.끌어올림.시작 < -80 && Math.abs(ornamentShape.끌어올림.중간) < 25,
  ornamentShape.끌어올림,
);
check(
  "흘러내림은 끝에서만 떨어진다",
  Math.abs(ornamentShape.흘러내림.시작) < 25 && ornamentShape.흘러내림.끝 < -80,
  ornamentShape.흘러내림,
);

check(
  "떨림 시작을 늦추면 짧은 음은 안 떨린다",
  vibDelay["0.6초뒤"] !== null && vibDelay["0.6초뒤"] < 12 && vibDelay.바로 > 40,
  vibDelay,
);

for (const [name, r] of Object.entries(vibrato)) {
  if (!r) continue;
  // 문턱은 실측에서 잡았다. 안 걸었을 때 9센트 안쪽(음정 추적기 자체의 오차),
  // 최대로 걸면 90~120센트. 열 배 차이라 문턱이 어디 있든 회귀는 잡힌다.
  check(`떨림 없음이면 음정이 안 흔들린다 — ${name}`, r.없음 !== null && r.없음 < 12, r);
  check(`떨림 최대면 음정이 흔들린다 — ${name}`, r.최대 !== null && r.최대 > 40, r);
}

// ---- 확대·화면 밀기에서는 소리가 나지 않는가 ----
// 지연을 없애려고 "대는 즉시" 로 바꿨더니 확대할 때마다 소리가 났다.
// 핀치도 밀기도 손가락 하나가 닿는 것으로 시작하기 때문이다.
await page.evaluate(() => { window.__previewAt.length = 0; });
const zoomBox = await page.locator("#roll").boundingBox();
// 화면 밀기
await page.mouse.move(zoomBox.x + 200, zoomBox.y + zoomBox.height * 0.5);
await page.mouse.down();
for (let i = 1; i <= 8; i += 1) {
  await page.mouse.move(zoomBox.x + 200 + i * 10, zoomBox.y + zoomBox.height * 0.5 + i * 4);
  await page.waitForTimeout(8);
}
await page.mouse.up();
await page.waitForTimeout(250);
check(
  "화면을 밀 때는 소리가 나지 않는다",
  (await page.evaluate(() => window.__previewAt.length)) === 0,
  await page.evaluate(() => window.__previewAt.length),
);

// ---- 재생 위치(빨간 줄)를 끌어서 옮길 수 있는가 ----
// 예전에는 눈금에서 끌면 무조건 루프 구간이 잡혀서 헤드를 끌 방법이 없었다.
await page.evaluate(() => {
  window.__app.scheduler.loopEnabled = false;
  window.__app.scheduler.seek(0);
  window.__app.roll.scrollX = 0;
});
await page.waitForTimeout(100);
const headStart = await page.evaluate(() => window.__app.scheduler.positionBeats());
const headX = await page.evaluate(() => 46 + 0 * window.__app.roll.pxPerBeat - window.__app.roll.scrollX);
await page.mouse.move(zoomBox.x + headX, zoomBox.y + 14);
await page.mouse.down();
await page.mouse.move(zoomBox.x + headX + 180, zoomBox.y + 14, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
const headEnd = await page.evaluate(() => ({
  pos: window.__app.scheduler.positionBeats(),
  loopOn: window.__app.scheduler.loopEnabled,
}));
check(
  "빨간 줄을 잡아 끌면 재생 위치가 따라온다",
  headEnd.pos > headStart + 0.5 && !headEnd.loopOn,
  { 시작: headStart, 끝: headEnd.pos, 루프가켜졌나: headEnd.loopOn },
);

// ---- ⏮ 맨 앞으로 ----
// 12마디쯤 보고 있다가 처음부터 다시 들으려면 빨간 줄을 정확히 0박에 맞혀야
// 했다. 화면도 같이 앞으로 밀어 준다 — 안 그러면 빨간 줄이 화면 밖에 있어서
// 아무 일도 안 일어난 것처럼 보인다.
await page.evaluate(() => {
  window.__app.scheduler.loopEnabled = false;
  window.__app.scheduler.seek(9);
  window.__app.roll.scrollX = 400;
});
await page.locator("#rewind").click();
await page.waitForTimeout(150);
const rewound = await page.evaluate(() => ({
  pos: window.__app.scheduler.positionBeats(),
  scrollX: window.__app.roll.scrollX,
}));
check("⏮ 이 재생 위치를 맨 앞으로 되돌린다", rewound.pos === 0 && rewound.scrollX === 0, rewound);

// 루프가 켜져 있으면 루프 시작으로 간다 — 재생도 어차피 거기서 시작한다
await page.evaluate(() => {
  const s = window.__app.scheduler;
  s.loopStart = 4;
  s.loopEnd = 8;
  s.loopEnabled = true;
  s.seek(7);
});
await page.locator("#rewind").click();
await page.waitForTimeout(150);
const rewoundLoop = await page.evaluate(() => window.__app.scheduler.positionBeats());
check("루프가 켜져 있으면 ⏮ 이 루프 시작으로 간다", rewoundLoop === 4, rewoundLoop);

// 재생 중에 ⏮ 을 눌러도 재생은 이어져야 하고, 버튼도 그렇게 보여야 한다.
// 안에서 stop → play 를 하는데 그때 onStop 이 불려서 버튼만 "재생" 으로
// 되돌아가 있었다. 재생 위치를 끌 때도, 루프를 켤 때도 같이 나던 증상이다.
await page.evaluate(() => {
  window.__app.scheduler.loopEnabled = false;
  window.__app.scheduler.seek(0);
});

// ---- 노트를 톡 치면 꾸밈 창 ----
//
// 노트 위에서 탭은 원래 아무 일도 안 하던 동작이다 (끌면 이동, 끝을 끌면 길이,
// 길게 누르면 삭제). 비어 있던 자리라 새 모드나 토글을 안 만들고 그대로 썼다.
const notePos = await page.evaluate(() => {
  const app = window.__app;
  const roll = app.roll;
  roll.scrollX = 0;
  roll.scrollToPitch(72);
  const t = app.project.tracks[roll.activeTrack];
  t.notes.length = 0;
  t.notes.push({ id: "orn-test", pitch: 72, start: 1, length: 2, velocity: 100 });
  app.scheduler.invalidate();
  const left = 46 + 1 * roll.pxPerBeat - roll.scrollX;
  return {
    x: left + roll.pxPerBeat * 0.4,
    // 오른쪽 끝에서 6px 안쪽 — 길이 조절로 잡히는 자리
    rightEdge: left + roll.pxPerBeat * 2 - 6,
    y: 36 + (127 - 72) * roll.keyHeight - roll.scrollY + roll.keyHeight / 2,
  };
});
const ornBox = await page.locator("#roll").boundingBox();
// **사람 손가락처럼** 친다. 합성 탭(0ms · 정확히 그 좌표)으로만 시험하면
// 실제로 안 되는 걸 통과시킨다 — 처음에 그래서 놓쳤다. 폰에서 작은 노트를
// 정확히 누르려면 300ms 쯤 걸리고 손가락은 몇 px 씩 흔들린다.
const fingerTap = async (x, y, drift = 12) => {
  const X = ornBox.x + x;
  const Y = ornBox.y + y;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: X, y: Y }] });
  await page.waitForTimeout(120);
  // **12px 흔든다.** 예전 탭 기준이 8px 이었는데, 진짜 손가락은 그보다 훨씬
  // 많이 흔들린다. 마우스로만 시험할 때는 이 값을 3px 로 뒀고, 그래서 실제로
  // 안 열리는 걸 통과시켰다. 사람이 실제로 하는 만큼 흔든다.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: X + drift, y: Y + drift * 0.6 }],
  });
  await page.waitForTimeout(150);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
};
await fingerTap(notePos.x, notePos.y);
check("노트를 톡 치면 꾸밈 창이 열린다", await page.locator("#note-modal").isVisible());
await page.locator("#note-close").click();
await page.waitForTimeout(150);
// 노트 오른쪽 끝은 길이 조절 자리다. 좁은 노트에서는 그게 3분의 1이라
// 거기를 눌러도 창이 떠야 한다 — 안 그러면 "안 뜬다" 가 된다.
await fingerTap(notePos.rightEdge, notePos.y);
const ornOpen = await page.locator("#note-modal").isVisible();
check("노트 오른쪽 끝을 쳐도 꾸밈 창이 열린다", ornOpen);
// 창이 안 열렸으면 아래 검사는 눌러 볼 데가 없다. 멈추지 말고 실패로 남긴다.
if (!ornOpen) {
  for (const name of [
    "고른 꾸밈이 그 음에 남는다",
    "꾸밈을 고르면 세기 조절이 따라 나온다",
    "「그냥」을 고르면 세기 조절이 사라진다",
    "꾸밈 창에서 그 음을 지울 수 있다",
    "지운 것은 되돌리기 한 번에 돌아온다",
  ]) check(name, false, "꾸밈 창이 안 열려서 확인 못 함");
}
if (ornOpen) {
await page.locator('button.orn[data-orn="bend"]').click();
await page.waitForTimeout(200);
const ornPicked = await page.evaluate(() => {
  const n = window.__app.project.tracks[window.__app.roll.activeTrack].notes.find((x) => x.id === "orn-test");
  return { ornament: n?.ornament, amount: n?.ornamentAmount, hasSlider: !!document.getElementById("note-amount") };
});
check("고른 꾸밈이 그 음에 남는다", ornPicked.ornament === "bend" && ornPicked.amount > 0, ornPicked);
check("꾸밈을 고르면 세기 조절이 따라 나온다", ornPicked.hasSlider);
await page.locator('button.orn[data-orn="none"]').click();
await page.waitForTimeout(150);
const ornPlain = await page.evaluate(() => ({
  ornament: window.__app.project.tracks[window.__app.roll.activeTrack].notes.find((x) => x.id === "orn-test")?.ornament,
  hasSlider: !!document.getElementById("note-amount"),
}));
// 「그냥」에는 세기가 없다. 아무 일도 안 하는 조절기를 띄워 두면 고장인 줄 안다.
check("「그냥」을 고르면 세기 조절이 사라진다", ornPlain.ornament === "none" && !ornPlain.hasSlider, ornPlain);
await page.locator("#note-delete").click();
await page.waitForTimeout(200);
const afterDelete = await page.evaluate(() => ({
  gone: !window.__app.project.tracks[window.__app.roll.activeTrack].notes.some((x) => x.id === "orn-test"),
  closed: document.getElementById("note-modal").classList.contains("hidden"),
}));
check("꾸밈 창에서 그 음을 지울 수 있다", afterDelete.gone && afterDelete.closed, afterDelete);
await page.locator("#undo").click();
await page.waitForTimeout(150);
check(
  "지운 것은 되돌리기 한 번에 돌아온다",
  await page.evaluate(() =>
    window.__app.project.tracks[window.__app.roll.activeTrack].notes.some((x) => x.id === "orn-test")),
);
}
await page.locator("#play").click();
await page.waitForTimeout(250);
await page.locator("#rewind").click();
await page.waitForTimeout(150);
const afterRewind = await page.evaluate(() => ({
  playing: window.__app.scheduler.isPlaying,
  label: document.getElementById("play").textContent.trim(),
}));
check(
  "재생 중에 ⏮ 을 눌러도 재생이 이어지고 버튼이 거짓말하지 않는다",
  afterRewind.playing && afterRewind.label.includes("정지"),
  afterRewind,
);
await page.locator("#play").click();
await page.waitForTimeout(100);
await page.evaluate(() => {
  window.__app.scheduler.loopEnabled = false;
  window.__app.scheduler.seek(0);
});

// 헤드에서 떨어진 곳을 끌면 여전히 루프 구간이 잡혀야 한다
await page.mouse.move(zoomBox.x + headX + 320, zoomBox.y + 14);
await page.mouse.down();
await page.mouse.move(zoomBox.x + headX + 460, zoomBox.y + 14, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
check(
  "헤드에서 떨어진 곳을 끌면 루프 구간이 잡힌다",
  await page.evaluate(() => window.__app.scheduler.loopEnabled),
);

// ---- 복사 / 붙여넣기 ----
// 마디마다 같은 코드를 다시 찍는 게 번거롭다는 요청에서 나왔다. 그 일이
// **복사 한 번 + 붙여넣기 연타**로 끝나야 의미가 있다.
await page.evaluate(() => {
  const p = window.__app.project;
  p.bpm = 120; p.bars = 8; p.timeSig = [4, 4];
  p.tracks.length = 1;
  p.tracks[0].source = { kind: "sf2", presetId: 0 };
  p.tracks[0].notes = [60, 64, 67].map((pitch, i) => ({
    id: "ch" + i, pitch, start: 0, length: 1, velocity: 100,
  }));
  window.__app.panel.activeTrack = 0;
  window.__app.roll.activeTrack = 0;
  window.__app.scheduler.loopEnabled = false;
  window.__app.scheduler.seek(0);
});
await page.waitForTimeout(150);

await page.locator("#copy").click();
await page.waitForTimeout(150);
check(
  "루프를 안 잡아도 헤드가 있는 마디가 복사된다",
  (await page.locator("#status").textContent())?.includes("3개 음을 복사") &&
    !(await page.locator("#paste").isDisabled()),
  await page.locator("#status").textContent(),
);

// 붙여넣기를 세 번 연달아 — 헤드가 알아서 밀려야 한다
for (let i = 0; i < 3; i += 1) {
  await page.locator("#paste").click();
  await page.waitForTimeout(150);
}
const filled = await page.evaluate(() => {
  const notes = window.__app.project.tracks[0].notes;
  return {
    총노트: notes.length,
    시작점들: [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b),
    헤드: +window.__app.scheduler.positionBeats().toFixed(2),
  };
});
check(
  "붙여넣기 연타만으로 마디가 하나씩 채워진다",
  filled.총노트 === 12 &&
    JSON.stringify(filled.시작점들) === JSON.stringify([0, 4, 8, 12]),
  filled,
);
check("붙여넣을 때마다 헤드가 다음 마디로 간다", Math.abs(filled.헤드 - 16) < 0.01, filled.헤드);

// 되돌리기가 붙여넣기 한 번을 통째로 되돌리는가
await page.locator("#undo").click();
await page.waitForTimeout(200);
check(
  "붙여넣기 한 번이 되돌리기 한 번으로 사라진다",
  (await page.evaluate(() => window.__app.project.tracks[0].notes.length)) === 9,
  await page.evaluate(() => window.__app.project.tracks[0].notes.length),
);

// 곡 끝을 넘겨 붙이면 마디가 늘어나는가
await page.evaluate(() => {
  window.__app.project.bars = 2;
  window.__app.scheduler.seek(20);
});
await page.locator("#paste").click();
await page.waitForTimeout(200);
check(
  "곡 끝을 넘겨 붙이면 마디가 늘어난다 (조용히 잘리지 않는다)",
  (await page.evaluate(() => window.__app.project.bars)) >= 6,
  await page.evaluate(() => window.__app.project.bars),
);

// ---- 내보내기가 조용히 실패하지 않는가 ----
//
// 셋 다 실제로 조용히 넘어가고 있었다.
//   · 전부 음소거하고 뽑으면 무음 WAV 가 나오는데 "저장했습니다" 만 떴다
//     (경고를 띄운 바로 다음 줄에서 성공 메시지로 덮어쓰고 있었다)
//   · 곡 길이 뒤의 노트는 WAV 에서 빠지는데 아무 말이 없었다
//   · 음소거한 트랙도 스템 파일을 만들었는데 속이 완전히 비어 있었다
const exportSetup = () => page.evaluate(() => {
  const p = window.__app.project;
  p.bpm = 120; p.bars = 2; p.tracks.length = 1;
  p.tracks[0].source = { kind: "sf2", presetId: 0 };
  p.tracks[0].notes = [{ id: "e1", pitch: 60, start: 0, length: 1, velocity: 110 }];
  p.tracks[0].volume = 1; p.tracks[0].muted = false; p.tracks[0].reverbSend = 0;
  p.tracks.push({ id: "e2", name: "둘째", source: { kind: "sf2", presetId: 0 },
    notes: [{ id: "e3", pitch: 48, start: 0, length: 1, velocity: 110 }],
    volume: 1, pan: 0, muted: false, reverbSend: 0 });
  window.__app.mixerState.clearSolo();
  window.__app.panel.refresh();
});

const runExport = async (buttonId, waitMs = 20000) => {
  await page.locator("#export").click();
  await page.waitForTimeout(150);
  const seen = [];
  const on = (d) => seen.push(d.suggestedFilename());
  page.on("download", on);
  await page.locator(`#${buttonId}`).click();
  await page.waitForFunction(
    () => /저장했습니다|없습니다|빠졌습니다|못했습니다/.test(
      document.getElementById("status")?.textContent ?? ""),
    null, { timeout: waitMs },
  ).catch(() => {});
  await page.waitForTimeout(500);
  page.off("download", on);
  return { status: await page.locator("#status").textContent(), files: seen };
};

// 전부 음소거 → 무음인데 성공 메시지가 뜨면 안 된다
await exportSetup();
await page.evaluate(() => window.__app.project.tracks.forEach((t) => (t.muted = true)));
const silent = await runExport("save-wav");
check(
  "무음 WAV 가 나오면 성공 메시지 대신 안내가 뜬다",
  silent.status?.includes("소리가 없는"),
  silent.status,
);

// 곡 길이 뒤에 노트가 있으면 알려 준다
await exportSetup();
await page.evaluate(() => {
  const p = window.__app.project;
  p.bars = 1;
  p.tracks[0].notes.push({ id: "far", pitch: 72, start: 12, length: 1, velocity: 110 });
});
const beyond = await runExport("save-wav");
check(
  "곡 길이 뒤의 노트가 빠지면 그 사실을 알려 준다",
  beyond.status?.includes("빠졌습니다"),
  beyond.status,
);

// 음소거한 트랙은 빈 스템 파일을 만들지 않는다
await exportSetup();
await page.evaluate(() => (window.__app.project.tracks[1].muted = true));
const mutedStems = await runExport("save-stems", 90000);
check(
  "음소거한 트랙은 빈 스템 파일을 만들지 않는다",
  mutedStems.files.length === 1 && mutedStems.status?.includes("음소거된 1개는 뺐습니다"),
  mutedStems,
);

// ---- 예제 곡 ----
//
// 맨 마지막에 한다 — 지금까지 만든 프로젝트를 통째로 덮어쓰기 때문이다.
// 노트가 있으면 물어보고 열어야 한다(말없이 날리지 않는다). 그리고 열린
// 결과가 **실제로 소리가 나야** 한다 — 사운드폰트 없이 임시 신스로도.
let askedBeforeOverwrite = false;
page.on("dialog", (d) => {
  askedBeforeOverwrite = true;
  void d.accept();
});
await page.locator("#export").click();
await page.waitForTimeout(150);
await page.locator("#open-demo-gugak").click();
await page.waitForTimeout(400);
const demo = await page.evaluate(() => {
  const p = window.__app.project;
  return {
    bpm: p.bpm,
    bars: p.bars,
    tracks: p.tracks.length,
    notes: p.tracks.map((t) => t.notes.length),
    presets: p.tracks.map((t) => t.source.presetId),
  };
});
check("덮어쓰기 전에 물어본다", askedBeforeOverwrite);
check(
  "예제 곡이 8마디 3트랙으로 들어온다",
  demo.bars === 8 && demo.tracks === 3 && demo.notes.every((n) => n > 10),
  demo,
);
// 악기가 셋 다 다른지는 audit 이 본다. 여기 시험용 SF2 에는 프리셋이 일곱
// 개뿐이라 GM 번호(65·107·32)가 없고, 앱이 제대로 첫 악기로 떨어뜨린다.
check(
  "없는 악기 번호여도 있는 악기로 떨어져 들어온다",
  demo.presets.every((id) => Number.isFinite(id)),
  demo.presets,
);
const demoSound = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const { peakOf } = await import("/src/export/wav.ts");
  const app = window.__app;
  const buf = await renderProject(
    app.project,
    () => app.registry.soundfont.bankBuffer(),
    app.registry.folders.list,
    app.mixerState,
  );
  return { peak: peakOf(buf), seconds: +buf.duration.toFixed(1) };
});
check(
  "예제 곡이 실제로 소리가 난다 (찌그러지지 않고)",
  demoSound.peak > 0.02 && demoSound.peak < 0.99 && demoSound.seconds > 18,
  demoSound,
);

// ---- 다른 트랙에 노트가 있는 자리에 찍기 ----
//
// 한때 여기를 막아 뒀다 — 다른 트랙 노트를 누르면 "그 노트는 3번 트랙에
// 있습니다" 하고 아무 일도 안 했다. 그런데 그러면 **다른 트랙에 노트가
// 있는 자리에는 노트를 찍을 수가 없다.**
//
// 노래에서는 그게 치명적이다. 반주가 깔린 자리에 가사를 얹는 게 노래인데
// 반주 노트가 먼저 있으면 그 위에 음을 못 놓는다. 트랙이 여럿인 곡은
// 대부분의 자리가 그렇다. 트랙은 서로 독립이고 겹쳐 찍는 게 정상이다.
//
// 작업 트랙을 자동으로 갈아타지 않는 것만 그대로다.
const otherTrack = await page.evaluate(() => {
  const app = window.__app, r = app.roll;
  r.scrollX = 0;
  const n = app.project.tracks[1].notes[0]; // 반주 트랙 — 활성 트랙이 아니다
  r.scrollToPitch(n.pitch);
  return {
    x: 46 + n.start * r.pxPerBeat - r.scrollX + Math.min(20, n.length * r.pxPerBeat * 0.4),
    y: 36 + (127 - n.pitch) * r.keyHeight - r.scrollY + r.keyHeight / 2,
    counts: app.project.tracks.map((t) => t.notes.length),
    active: r.activeTrack,
  };
});
const otherBox = await page.locator("#roll").boundingBox();
{
  const X = otherBox.x + otherTrack.x;
  const Y = otherBox.y + otherTrack.y;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: X, y: Y }] });
  await page.waitForTimeout(150);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
}
const afterOther = await page.evaluate(() => ({
  opened: !document.getElementById("note-modal").classList.contains("hidden"),
  counts: window.__app.project.tracks.map((t) => t.notes.length),
  active: window.__app.roll.activeTrack,
  status: document.getElementById("status")?.textContent ?? "",
}));
check(
  "다른 트랙에 노트가 있는 자리에도 노트가 찍힌다",
  afterOther.counts[0] === otherTrack.counts[0] + 1,
  { 전: otherTrack.counts, 후: afterOther.counts },
);
// 남의 트랙 노트는 건드리지 않는다. 겹쳐 찍는 것이지 옮기는 게 아니다.
check("남의 트랙 노트는 그대로 있다",
  afterOther.counts[1] === otherTrack.counts[1],
  { 전: otherTrack.counts[1], 후: afterOther.counts[1] });
// 작업하던 트랙을 마음대로 바꾸지 않는다. 바꾸면 다음에 찍는 노트가 엉뚱한
// 데로 간다 — 사용자가 그러지 말라고 했고, 그게 맞다.
check("작업하던 트랙이 안 바뀐다", afterOther.active === 0, afterOther.active);
if (afterOther.opened) {
  await page.locator("#note-close").click();
  await page.waitForTimeout(150);
}

// ---- 둘째 예제 곡 (일렉트로닉) ----
//
// 성격이 정반대인 곡을 하나 더 둔다 — 같은 도구로 다른 장르가 나온다는 걸
// 보여 주려고. 이쪽은 드럼이 있어서 채널 배치(드럼은 9번)까지 같이 걸린다.
// **음원을 안 넣은 새 화면**에서 연다. 지금까지 쓰던 시험용 SF2 에는 드럼
// 킷이 없어서, 그 상태로 열면 앱이 드럼 트랙을 (제대로) 첫 악기로 떨어뜨린다.
// 그러면 드럼이 9번 채널로 가는지도, 안내가 뜨는지도 확인할 수가 없다.
// 사용자가 앱을 처음 열고 예제를 눌러 보는 상황이 실제로 이쪽이기도 하다.
await page.reload({ waitUntil: "networkidle" });
await page.locator("#unlock").tap();
await page.waitForTimeout(300);
await page.locator("#export").click();
await page.waitForTimeout(150);
await page.locator("#open-demo-edm").click();
await page.waitForTimeout(500);
const edm = await page.evaluate(async () => {
  const { assignChannels } = await import("/src/model/channels.ts");
  const p = window.__app.project;
  return {
    bpm: p.bpm,
    bars: p.bars,
    tracks: p.tracks.length,
    notes: p.tracks.reduce((n, t) => n + t.notes.length, 0),
    channels: assignChannels(p),
    drumIndex: p.tracks.findIndex((t) => t.name === "드럼"),
    status: document.getElementById("status")?.textContent ?? "",
  };
});
check(
  "일렉트로닉 예제가 16마디 5트랙으로 들어온다",
  edm.bars === 16 && edm.tracks === 5 && edm.bpm === 128 && edm.notes > 300,
  edm,
);
// 드럼이 9번 채널에 안 가면 다른 DAW 에서도 우리 신스에서도 타악기로 안 난다.
check("드럼 트랙이 9번 채널에 간다", edm.channels[edm.drumIndex] === 9, edm.channels);
// 사운드폰트 없이 열면 드럼이 낮은 톱니파가 된다. 왜 그런지 말해 줘야 한다.
check(
  "음원 없이 열면 드럼 얘기를 해 준다",
  edm.status.includes("드럼") && edm.status.includes("사운드폰트"),
  edm.status,
);
const edmSound = await page.evaluate(async () => {
  const { renderProject } = await import("/src/export/render.ts");
  const app = window.__app;
  const buf = await renderProject(
    app.project,
    () => app.registry.soundfont.bankBuffer(),
    app.registry.folders.list,
    app.mixerState,
  );
  // 마디마다 음량을 재서 "인트로 → 쌓기 → 드롭" 이 실제로 커지는지 본다.
  const d = buf.getChannelData(0);
  const perBar = (bar) => {
    const secPerBar = (60 / 128) * 4;
    const s = Math.floor(bar * secPerBar * buf.sampleRate);
    const e = Math.min(d.length, Math.floor((bar + 1) * secPerBar * buf.sampleRate));
    let sum = 0;
    for (let i = s; i < e; i += 7) sum += d[i] * d[i];
    return Math.sqrt(sum / Math.max(1, (e - s) / 7));
  };
  let peak = 0;
  for (const v of d) peak = Math.max(peak, Math.abs(v));
  return {
    peak: +peak.toFixed(3),
    인트로: +perBar(1).toFixed(4),
    쌓기: +perBar(6).toFixed(4),
    드롭: +perBar(10).toFixed(4),
  };
});
check(
  "일렉트로닉 예제가 소리가 난다 (찌그러지지 않고)",
  edmSound.peak > 0.05 && edmSound.peak < 0.99,
  edmSound,
);
// 드롭이 안 커지면 구조가 없는 것이다. 처음에 킥을 빌드부터 다 쳤더니
// 빌드와 드롭이 거의 같은 크기여서 열리는 느낌이 없었다.
check(
  "인트로 → 쌓기 → 드롭 순으로 커진다",
  edmSound.인트로 < edmSound.쌓기 * 0.75 && edmSound.쌓기 < edmSound.드롭 * 0.85,
  edmSound,
);

// ---- 노래하는 트랙 (UTAU 음원) ----
//
// 진짜 음원은 저장소에 못 넣는다(배포 금지). 형식만 실물과 같게 만든 가짜
// 음원을 쓴다 — WAV + Shift-JIS oto.ini + 주파수표, 별칭 세 갈래까지.
//
// 「さ」만 반음 낮게 녹음해 뒀다. 주파수표를 안 읽으면 그 글자만 음이 틀리는데,
// 실물 테토가 정확히 그랬다.
await page.reload({ waitUntil: "networkidle" });
await page.locator("#unlock").tap();
await page.waitForTimeout(300);
await page.evaluate((items) => {
  const dt = new DataTransfer();
  for (const it of items) {
    const bin = atob(it.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
    dt.items.add(new File([u], it.name));
  }
  const el = document.getElementById("voice-files");
  el.files = dt.files;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, readdirSync("fixtures/voicebank").map((f) => ({
  name: f, b64: readFileSync(`fixtures/voicebank/${f}`).toString("base64"),
})));
await page.waitForTimeout(1500);

const voice = await page.evaluate(() => ({
  source: window.__app.project.tracks[0].source,
  button: document.getElementById("instrument")?.textContent ?? "",
  status: document.getElementById("status")?.textContent ?? "",
}));
check("UTAU 음원 폴더를 넣으면 노래하는 트랙이 된다", voice.source.kind === "voice", voice);
check("악기 이름에 노래 음원이 보인다", voice.button.includes("🎤"), voice.button);
// oto.ini 는 Shift-JIS 다. 브라우저가 못 읽으면 소리 가짓수가 0 이 된다.
check("Shift-JIS oto.ini 를 읽는다 (소리 6가지)", voice.status.includes("6가지"), voice.status);
check("주파수표도 같이 읽는다", voice.status.includes("음정표"), voice.status);

// 노트를 톡 치면 가사칸이 나온다 — 노래하는 트랙에서만.
await page.evaluate(() => {
  const app = window.__app, r = app.roll;
  r.scrollX = 0;
  r.scrollToPitch(63);
  const t = app.project.tracks[0];
  t.notes.length = 0;
  t.notes.push({ id: "s0", pitch: 63, start: 0, length: 1, velocity: 100 });
  app.scheduler.invalidate();
});
const singPos = await page.evaluate(() => {
  const r = window.__app.roll;
  return { x: 46 + 0 * r.pxPerBeat - r.scrollX + r.pxPerBeat * 0.4,
           y: 36 + (127 - 63) * r.keyHeight - r.scrollY + r.keyHeight / 2 };
});
const singBox = await page.locator("#roll").boundingBox();
{
  const X = singBox.x + singPos.x, Y = singBox.y + singPos.y;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: X, y: Y }] });
  await page.waitForTimeout(150);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
}
check("노래하는 트랙에서는 노트 창에 가사칸이 나온다",
  await page.locator("#note-lyric").count() > 0);
if (await page.locator("#note-lyric").count() > 0) {
  await page.locator("#note-lyric").fill("か");
  await page.waitForTimeout(200);
  check("적은 가사가 노트에 남는다",
    await page.evaluate(() => window.__app.project.tracks[0].notes[0].lyric) === "か");
  // 음원에 없는 글자는 그 자리에서 알려 준다. 소리만 안 나면 오타인지 알 수 없다.
  await page.locator("#note-lyric").fill("ぴ");
  await page.waitForTimeout(200);
  check("음원에 없는 글자는 그 자리에서 알려 준다",
    (await page.locator(".lyricrow i").textContent())?.includes("없는"),
    await page.locator(".lyricrow i").textContent());
  await page.locator("#note-lyric").fill("か");
  await page.waitForTimeout(150);
  await page.locator("#note-close").click();
}

// 실제로 부르는가. 가사를 붙인 다섯 음을 렌더해서 음정을 추적한다.
const sang = await page.evaluate(async () => {
  const app = window.__app;
  const t = app.project.tracks[0];
  t.notes.length = 0;
  ["か", "さ", "ね", "て", "と"].forEach((lyric, i) => t.notes.push({
    id: "s" + i, pitch: [62, 64, 65, 64, 62][i], start: i, length: 1, velocity: 100, lyric,
  }));
  app.project.bars = 2;
  await app.registry.prepareVoices(app.project.tracks);

  const { renderProject } = await import("/src/export/render.ts");
  const buf = await renderProject(app.project, () => app.registry.soundfont.bankBuffer(),
    app.registry.folders.list, app.mixerState, app.registry.voices);

  const d = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const pitchAt = (sec) => {
    const SUB = 2048, minLag = Math.floor(sr / 600), maxLag = Math.floor(sr / 200);
    const s0 = Math.floor(sec * sr);
    let energy = 0;
    for (let i = s0; i < s0 + SUB; i += 1) energy += d[i] * d[i];
    if (Math.sqrt(energy / SUB) < 0.01) return null;
    const r = [];
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let i = 0; i < SUB; i += 1) sum += d[s0 + i] * d[s0 + i + lag];
      r.push(sum);
    }
    const peak = Math.max(...r);
    let idx = r.findIndex((v) => v >= peak * 0.92);
    while (idx + 1 < r.length && r[idx + 1] > r[idx]) idx += 1;
    return +(69 + 12 * Math.log2(sr / (minLag + idx) / 440)).toFixed(2);
  };
  // 100BPM 이라 한 박이 0.6초.
  return { pitches: [0, 1, 2, 3, 4].map((i) => pitchAt(i * 0.6 + 0.3)), seconds: +buf.duration.toFixed(1) };
});
const want = [62, 64, 65, 64, 62];
check(
  "가사를 붙인 음을 실제로 부른다 (음정 반음 이내)",
  sang.pitches.every((p, i) => p !== null && Math.abs(p - want[i]) < 0.5),
  { 잰음정: sang.pitches, 기대: want },
);
// 「さ」가 반음 낮게 녹음돼 있어서, 주파수표를 안 읽으면 여기만 틀린다.
check(
  "파일마다 다른 녹음 음정을 주파수표로 바로잡는다",
  sang.pitches[1] !== null && Math.abs(sang.pitches[1] - 64) < 0.5,
  { さ: sang.pitches[1] },
);

// 노래하는 트랙에도 음마다 꾸밈이 걸리는가.
//
// 이걸 넣기 전까지 노래 트랙은 **꾸밈을 조용히 무시하고 있었다.** 노트 창에
// 떨림·꺾기 버튼이 다 나오고, 고르면 노트에 저장되고, 피아노롤에 「〜」까지
// 그려지는데, 소리는 하나도 안 변했다. 그래서 소리를 직접 재서 확인한다.
const singOrn = await page.evaluate(async () => {
  const app = window.__app;
  const t = app.project.tracks[0];
  app.project.bars = 2;

  const spread = async (ornament) => {
    t.notes.length = 0;
    t.notes.push({ id: "v0", pitch: 62, start: 0, length: 2, velocity: 100, lyric: "か",
      ...(ornament ? { ornament, ornamentAmount: 0.8 } : {}) });
    await app.registry.prepareVoices(app.project.tracks);
    const { renderProject } = await import("/src/export/render.ts");
    const buf = await renderProject(app.project, () => app.registry.soundfont.bankBuffer(),
      app.registry.folders.list, app.mixerState, app.registry.voices);
    const d = buf.getChannelData(0), sr = buf.sampleRate;
    const at = (sec) => {
      const SUB = 1024, minLag = Math.floor(sr / 600), maxLag = Math.floor(sr / 200);
      const s0 = Math.floor(sec * sr);
      const r = [];
      for (let lag = minLag; lag <= maxLag; lag += 1) {
        let sum = 0;
        for (let i = 0; i < SUB; i += 1) sum += d[s0 + i] * d[s0 + i + lag];
        r.push(sum);
      }
      const peak = Math.max(...r);
      let idx = r.findIndex((v) => v >= peak * 0.92);
      while (idx + 1 < r.length && r[idx + 1] > r[idx]) idx += 1;
      return 69 + 12 * Math.log2(sr / (minLag + idx) / 440);
    };
    // 100BPM 이라 2박 = 1.2초. 머리(자음)와 꼬리(페이드)는 빼고 잰다.
    const got = [];
    for (let sec = 0.25; sec <= 0.95; sec += 0.02) got.push(at(sec));
    return +((Math.max(...got) - Math.min(...got)) * 100).toFixed(1); // 센트
  };

  return { 그냥: await spread(null), 떨림: await spread("vibrato") };
});
// 실측: 꾸밈 없음 11.5센트(= 음정 추적기의 잡음 바닥), 떨림 0.8 → 80.5센트.
// 이론값과 맞는다 — 0.8 × VIBRATO_MAX_CENTS(50) = ±40, 위아래로 80센트.
// 고치기 전에는 둘 다 11.5 였다. 즉 꾸밈이 소리에 아무 영향이 없었다.
check("노래 트랙: 꾸밈 없는 음은 음정이 곧다", singOrn.그냥 < 25, singOrn);
check("노래 트랙: 떨림을 고른 음이 실제로 떤다", singOrn.떨림 > 55, singOrn);

// ---- 받은 zip 을 안 풀고 넣기 ----
//
// 사용자의 폰이 테토 음원 zip 을 못 풀었다 — "폴더에 문제가 있어 추출할 수
// 없다". 이름이 CP932 라 UTF-8 로만 읽는 압축 프로그램이 경로를 못 만든 것이다.
// 그래서 검사도 **CP932 이름 zip** 으로 한다. 그리고 여기서 확인하는 건
// 목차만이 아니라 **그 zip 에서 WAV 를 꺼내 실제로 부르는가** 까지다.
await page.reload({ waitUntil: "networkidle" });
await page.locator("#unlock").tap();
await page.waitForTimeout(300);
await page.evaluate((b64) => {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([u], "TETO-tandoku.zip", { type: "application/zip" }));
  const el = document.getElementById("voice-zip");
  el.files = dt.files;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, readFileSync("fixtures/voice-cp932.zip").toString("base64"));
const zipOpenAt = Date.now();
await page.waitForFunction(() => window.__app.project.tracks[0].source.kind === "voice", null,
  { timeout: 20000 }).catch(() => {});
const zipOpenMs = Date.now() - zipOpenAt;

const zipped = await page.evaluate(() => ({
  source: window.__app.project.tracks[0].source,
  button: document.getElementById("instrument")?.textContent ?? "",
  status: document.getElementById("status")?.textContent ?? "",
}));
check("zip 을 안 풀고 넣어도 노래하는 트랙이 된다", zipped.source.kind === "voice", zipped);
// 이름이 깨졌다면 「重音テト単独音」 대신 「\u91cd\u97f3...」 같은 글자가 온다.
check("일본어 폴더 이름이 안 깨진다", zipped.button.includes("重音テト単独音"), zipped.button);
check("zip 안의 oto.ini 도 읽는다 (소리 6가지)", zipped.status.includes("6가지"), zipped.status);
// 여는 순간에는 oto.ini 한 장만 읽는다. 주파수표를 미리 다 꺼내던 때는
// 공식 통합 음원(474MB · 음원 13개 · 주파수표 1900개)이 데스크톱에서도
// 7.6초 걸렸다 — 폰이면 1분이 넘고 그동안 멈춘 것처럼 보인다. 지금은 0.5초.
check("음원 크기와 상관없이 즉시 열린다", zipOpenMs < 3000, { 걸린ms: zipOpenMs });

// zip 안의 WAV 와 주파수표를 **부를 때** 꺼내 오는 길이 정말 도는가.
// 「さ」는 반음 낮게 녹음돼 있어서, 주파수표를 늦게 못 꺼내면 여기만 틀린다.
// 미리 꺼내기를 그만두면서 제일 깨지기 쉬워진 자리라 음정까지 잰다.
const zipSang = await page.evaluate(async () => {
  const app = window.__app;
  const t = app.project.tracks[0];
  t.notes.length = 0;
  ["か", "さ", "ね"].forEach((lyric, i) => t.notes.push({
    id: "z" + i, pitch: [62, 64, 65][i], start: i, length: 1, velocity: 100, lyric,
  }));
  app.project.bars = 2;
  await app.registry.prepareVoices(app.project.tracks);
  const { renderProject } = await import("/src/export/render.ts");
  const buf = await renderProject(app.project, () => app.registry.soundfont.bankBuffer(),
    app.registry.folders.list, app.mixerState, app.registry.voices);
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  let peak = 0;
  for (let i = 0; i < d.length; i += 1) peak = Math.max(peak, Math.abs(d[i]));
  const at = (sec) => {
    const SUB = 2048, minLag = Math.floor(sr / 600), maxLag = Math.floor(sr / 200);
    const s0 = Math.floor(sec * sr);
    const r = [];
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let i = 0; i < SUB; i += 1) sum += d[s0 + i] * d[s0 + i + lag];
      r.push(sum);
    }
    const pk = Math.max(...r);
    let idx = r.findIndex((v) => v >= pk * 0.92);
    while (idx + 1 < r.length && r[idx + 1] > r[idx]) idx += 1;
    return +(69 + 12 * Math.log2(sr / (minLag + idx) / 440)).toFixed(2);
  };
  return { peak: +peak.toFixed(3), pitches: [0, 1, 2].map((i) => at(i * 0.6 + 0.3)) };
});
check("zip 안의 WAV 를 꺼내 실제로 부른다", zipSang.peak > 0.02, zipSang);
check("zip 안의 주파수표를 부를 때 꺼내 음정을 맞춘다",
  zipSang.pitches.every((p, i) => Math.abs(p - [62, 64, 65][i]) < 0.5),
  { 잰음정: zipSang.pitches, 기대: [62, 64, 65] });

// ---- 상자로 여러 노트 고르기 ----
//
// 손가락으로 상자를 그리는 부분은 순수 함수로 못 본다 (고르는 규칙 자체는
// npm run select 가 브라우저 없이 19가지를 본다). 여기서는 **진짜 터치로**
// 끌어서, 화면에 보이는 것이 실제로 골라지는지만 확인한다.
await page.reload({ waitUntil: "networkidle" });
await page.locator("#unlock").tap();
await page.waitForTimeout(300);

// 한 트랙에 두 줄로 노트를 놓는다. 위 줄만 상자로 고를 것이다.
await page.evaluate(() => {
  const app = window.__app, r = app.roll;
  r.scrollX = 0;
  r.scrollToPitch(64);
  const t = app.project.tracks[0];
  t.notes.length = 0;
  for (let i = 0; i < 4; i += 1) {
    t.notes.push({ id: "hi" + i, pitch: 67, start: i, length: 1, velocity: 100 });
    t.notes.push({ id: "lo" + i, pitch: 55, start: i, length: 1, velocity: 100 });
  }
  app.project.bars = 4;
  app.scheduler.invalidate();
  r.render();
});

const selBox = await page.locator("#roll").boundingBox();
const pt = async (beat, pitch) => await page.evaluate(([b, p]) => {
  const r = window.__app.roll;
  return { x: 46 + b * r.pxPerBeat - r.scrollX, y: 36 + (127 - p) * r.keyHeight - r.scrollY + r.keyHeight / 2 };
}, [beat, pitch]);

// 고르기를 켜기 전에는 격자 드래그가 화면 밀기여야 한다 (기존 동작 유지).
{
  const a = await pt(0.5, 67);
  const scrollBefore = await page.evaluate(() => window.__app.roll.scrollX);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: selBox.x + a.x, y: selBox.y + a.y + 60 }] });
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: selBox.x + a.x - 90, y: selBox.y + a.y + 60 }] });
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(200);
  const scrollAfter = await page.evaluate(() => window.__app.roll.scrollX);
  check("고르기가 꺼져 있으면 격자 드래그는 화면 밀기다",
    scrollAfter > scrollBefore, { 전: scrollBefore, 후: scrollAfter });
  await page.evaluate(() => { window.__app.roll.scrollX = 0; window.__app.roll.render(); });
}

await page.locator("#select-mode").tap();
await page.waitForTimeout(150);

// 위 줄(67)만 감싸는 상자를 끈다.
{
  const a = await pt(0.2, 69);
  const b = await pt(2.8, 66);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: selBox.x + a.x, y: selBox.y + a.y }] });
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: selBox.x + (a.x + b.x) / 2, y: selBox.y + (a.y + b.y) / 2 }] });
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: selBox.x + b.x, y: selBox.y + b.y }] });
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
}
const picked = await page.evaluate(() => ({
  ids: window.__app.roll.selectedNotes().map((n) => n.id).sort(),
  del: document.getElementById("delete-selected").textContent,
  disabled: document.getElementById("delete-selected").disabled,
  scrollX: window.__app.roll.scrollX,
}));
check("끌면 상자 안의 노트가 골라진다",
  JSON.stringify(picked.ids) === JSON.stringify(["hi0", "hi1", "hi2"]), picked.ids);
check("고르는 중에는 화면이 밀리지 않는다", picked.scrollX === 0, picked.scrollX);
check("지우기 버튼에 고른 개수가 보인다", picked.del.includes("3") && !picked.disabled, picked);

// 톡 치면 하나씩 넣고 뺀다 — 하나만 빼려고 상자를 다시 그리는 건 고역이다.
{
  const a = await pt(0.5, 67);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: selBox.x + a.x, y: selBox.y + a.y }] });
  await page.waitForTimeout(120);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(200);
}
check("톡 치면 그 노트를 뺀다",
  (await page.evaluate(() => window.__app.roll.selectedNotes().length)) === 2);

// 고른 것만 지운다.
const beforeDel = await page.evaluate(() => window.__app.project.tracks[0].notes.length);
await page.locator("#delete-selected").tap();
await page.waitForTimeout(250);
const afterDel = await page.evaluate(() => ({
  n: window.__app.project.tracks[0].notes.length,
  ids: window.__app.project.tracks[0].notes.map((x) => x.id).sort(),
  disabled: document.getElementById("delete-selected").disabled,
}));
check("고른 것만 지워진다", beforeDel - afterDel.n === 2, { 전: beforeDel, 후: afterDel.n });
check("안 고른 노트는 남는다", afterDel.ids.filter((x) => x.startsWith("lo")).length === 4, afterDel.ids);
check("지운 뒤 버튼이 다시 꺼진다", afterDel.disabled);
// 실수로 지웠어도 되돌릴 수 있어야 한다. 여러 개를 한꺼번에 지우는 기능이라
// 되돌리기가 없으면 무섭다.
await page.locator("#undo").tap();
await page.waitForTimeout(250);
check("한 번 되돌리면 지운 것이 다 돌아온다",
  (await page.evaluate(() => window.__app.project.tracks[0].notes.length)) === beforeDel);

// 고른 것을 복사해서 붙여넣기 — 코드 진행 반복이 목적이다.
await page.evaluate(() => {
  const app = window.__app;
  app.project.tracks[0].notes.length = 0;
  // 화음 하나: 도·미·솔 을 0박에
  [60, 64, 67].forEach((p, i) => app.project.tracks[0].notes.push(
    { id: "ch" + i, pitch: p, start: 0, length: 2, velocity: 100 }));
  app.roll.render();
});
{
  const a = await pt(-0.2, 69);
  const b = await pt(2.2, 58);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: selBox.x + Math.max(48, a.x), y: selBox.y + a.y }] });
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: selBox.x + b.x, y: selBox.y + b.y }] });
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
}
check("화음 세 음이 한 번에 골라진다",
  (await page.evaluate(() => window.__app.roll.selectedNotes().length)) === 3);
await page.locator("#copy").tap();
await page.waitForTimeout(200);
await page.locator("#paste").tap();
await page.waitForTimeout(200);
await page.locator("#paste").tap();
await page.waitForTimeout(250);
const chords = await page.evaluate(() => {
  const ns = window.__app.project.tracks[0].notes;
  const starts = [...new Set(ns.map((n) => n.start))].sort((a, b) => a - b);
  return { n: ns.length, starts };
});
// 고른 화음이 그대로 두 번 더 붙어야 한다 — 이게 "코드 진행 반복" 이다.
check("고른 화음을 붙여넣기 연타로 반복할 수 있다",
  chords.n === 9 && chords.starts.length === 3, chords);

// ---- 16분음표보다 잘게 쪼개기 ----
//
// "4/4 라도 16분음표로 악기를 쓰거나 하는 등 더 작게 쪼개 써야 하지 않나"
// 라는 물음에서 나왔다. 값이 MIDI 틱에 정확히 떨어지는지는 audit 이 보고,
// 여기서는 **화면에서 실제로 되는지**를 본다.
await page.reload({ waitUntil: "networkidle" });
await page.locator("#unlock").tap();
await page.waitForTimeout(300);

const snapOpts = await page.evaluate(() =>
  [...document.getElementById("snap").options].map((o) => o.textContent.trim()));
check("1/32 · 1/64 격자를 고를 수 있다",
  snapOpts.includes("1/32") && snapOpts.includes("1/64"), snapOpts);
check("셋잇단도 1/32 까지 있다", snapOpts.includes("1/32 셋잇단"), snapOpts);

// 잘은 격자를 고르면 보일 만큼 확대해 준다. 안 그러면 격자를 바꿨는데
// 화면이 하나도 안 변해서 "안 먹었나" 가 된다.
await page.evaluate(() => { window.__app.roll.pxPerBeat = 40; window.__app.roll.render(); });
await page.selectOption("#snap", "0.0625");
await page.waitForTimeout(250);
const zoomed = await page.evaluate(() => ({
  px: window.__app.roll.pxPerBeat,
  visible: window.__app.roll.snapVisible,
  status: document.getElementById("status")?.textContent ?? "",
}));
check("잘은 격자를 고르면 보일 만큼 확대한다", zoomed.visible && zoomed.px > 40, zoomed);
check("확대했다는 사실을 말해 준다", zoomed.status.includes("확대"), zoomed.status);

// 이미 충분히 확대돼 있으면 건드리지 않는다 — 화면이 제멋대로 움직이면 안 된다.
await page.evaluate(() => { window.__app.roll.pxPerBeat = 320; window.__app.roll.render(); });
await page.selectOption("#snap", "0.125");
await page.waitForTimeout(200);
check("이미 보이면 배율을 안 건드린다",
  (await page.evaluate(() => window.__app.roll.pxPerBeat)) === 320);

// 1/32 격자로 실제로 찍어 본다. 격자가 잘아도 찍히는 자리와 길이가 맞아야 한다.
await page.evaluate(() => {
  const app = window.__app, r = app.roll;
  app.project.tracks[0].notes.length = 0;
  r.scrollX = 0;
  r.scrollToPitch(60);
  r.render();
});
const fineBox = await page.locator("#roll").boundingBox();
for (let i = 0; i < 4; i += 1) {
  const pos = await page.evaluate((k) => {
    const r = window.__app.roll;
    return { x: 46 + (k * 0.125 + 0.06) * r.pxPerBeat - r.scrollX,
             y: 36 + (127 - 60) * r.keyHeight - r.scrollY + r.keyHeight / 2 };
  }, i);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fineBox.x + pos.x, y: fineBox.y + pos.y }] });
  await page.waitForTimeout(80);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(120);
}
const fine = await page.evaluate(() => window.__app.project.tracks[0].notes
  .map((n) => ({ start: n.start, length: n.length })).sort((a, b) => a.start - b.start));
check("1/32 격자에 노트 넷이 붙는다", fine.length === 4, fine);
check("1/32 자리에 정확히 떨어진다",
  fine.every((n, i) => Math.abs(n.start - i * 0.125) < 1e-9), fine.map((n) => n.start));
check("찍은 노트 길이도 1/32 이다",
  fine.every((n) => Math.abs(n.length - 0.125) < 1e-9), fine.map((n) => n.length));

// 소리까지 난다. 128BPM 에서 1/32 은 58ms 인데, 그 정도로 짧은 노트가
// 스케줄러·렌더를 지나 실제로 소리가 되는지는 재 봐야 안다.
const fineSound = await page.evaluate(async () => {
  const app = window.__app;
  app.project.bpm = 128;
  app.project.bars = 1;
  const { renderProject } = await import("/src/export/render.ts");
  const buf = await renderProject(app.project, () => app.registry.soundfont.bankBuffer(),
    app.registry.folders.list, app.mixerState, app.registry.voices);
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i += 1) peak = Math.max(peak, Math.abs(d[i]));
  return { peak: +peak.toFixed(3), ms: +(0.125 * (60 / 128) * 1000).toFixed(0) };
});
check("1/32 짜리 짧은 노트도 실제로 소리가 난다", fineSound.peak > 0.02, fineSound);

check("콘솔 오류 없음", errors.length === 0, errors);

await page.screenshot({ path: "scripts/smoke.png" });
await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  const mark = r.ok ? "✅" : "❌";
  const detail = r.detail === undefined ? "" : `  ${JSON.stringify(r.detail)}`;
  console.log(`${mark} ${r.name}${r.ok ? "" : detail}`);
}
console.log(failed === 0 ? `\n전부 통과 (${results.length}개)` : `\n실패 ${failed}개`);
process.exit(failed === 0 ? 0 : 1);
