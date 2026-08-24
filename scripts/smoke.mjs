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
 *   · 콘솔 오류가 하나도 없는가
 *
 * 쓰는 법: 다른 창에서 `npm run dev` 를 띄워 두고 `npm run smoke`.
 * 크로미움 경로는 CHROMIUM_PATH 로 지정할 수 있다(없으면 playwright 기본값).
 */

import { chromium, devices } from "playwright";

const URL = process.env.SMOKE_URL ?? "http://127.0.0.1:5173/";
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

const launchOptions = {
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
};
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ ...devices["Pixel 5"] });
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
