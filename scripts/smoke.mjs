/**
 * 브라우저에서 실제로 되는지 확인하는 연기(smoke) 테스트.
 *
 * 오디오는 귀로 들어야 알지만, **들리기 전에 깨지는 것들**은 자동으로 잡을 수
 * 있다. 여기서 보는 것:
 *   · 첫 터치 전 오디오 잠금 안내가 뜨고, 탭하면 실제로 풀리는가
 *   · 탭으로 노트가 찍히고 그리드에 붙는가
 *   · 몸통 드래그 = 이동, 오른쪽 끝 드래그 = 길이 (서로 안 잡아먹는가)
 *   · 길게 누르면 지워지는가
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
 *   · ⏮ 이 재생 위치를 맨 앞으로 되돌리는가 (재생 중에 눌러도 버튼이 안 뒤집히는가)
 *   · 렌더 경로가 둘로 갈리는데 서로 정렬돼 있는가
 *   · 재생에서 사운드폰트가 임시 신스와 같은 시각에 울리는가 (워크렛 시계 보정)
 *   · 뜯는 소리의 여운을 자르지 않는가 (부는 소리는 자르는가)
 *   · 복사 한 번 + 붙여넣기 연타로 마디가 채워지는가
 *   · 내보내기가 조용히 실패하지 않는가 (무음 · 곡 밖 노트 · 음소거 트랙)
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

// ------------------------------------------------------------ 길게 눌러 삭제
const countBefore = await page.evaluate(() => window.__app.project.tracks[0].notes.length);
const p2 = await posOf(notes[2].id);
await page.mouse.move(box.x + p2.left + 8, box.y + p2.y);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
const countAfter = await page.evaluate(() => window.__app.project.tracks[0].notes.length);
check("길게 누르면 노트가 지워진다", countAfter === countBefore - 1, { countBefore, countAfter });

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
check("트랙마다 음량·팬·울림 세 개가 있다", sliders === 3, sliders);
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
check(
  "재생에서 사운드폰트가 임시 신스와 같은 시각에 울린다 (10ms 이내)",
  livePlay.ok && Math.abs(livePlay.gapMs) < 10,
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
