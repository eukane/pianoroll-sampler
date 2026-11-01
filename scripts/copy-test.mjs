/**
 * 코드 따기 페이지(copy.html) 검사 (패드 가로 화면 크기).
 *
 *   npm run dev &  →  npm run copy
 *
 * 마디 계산·코드 이름 읽기는 theory-test.mjs 가 브라우저 없이 본다. 여기서는
 *   ① 파일을 열면 재생 준비가 되는가 · 느리게 틀면 정말 느린가 (음정 유지 켜짐)
 *   ② 구간 반복이 구간 밖으로 새지 않는가
 *   ③ 적어 둔 코드가 곡 위치에 맞게 울리고, 멈추거나 건너뛰면 끊기는가
 *   ④ 잘못 적은 코드 표시 · 탭 템포 · 건반 읽기
 *   ⑤ 새로고침 후 같은 파일을 열면 적어 둔 것이 남는가
 *   ⑥ 피아노롤의 버튼이 새 창으로 여는가
 * 를 본다. 음악 파일은 이 스크립트가 만든 사인파 WAV 다.
 */
import { chromium } from "playwright";

const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:5173/";
const COPY = new URL("copy.html", BASE).toString();
const launchOptions = { args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] };
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 12초짜리 모노 16bit WAV (440Hz 사인파) */
function makeWav(seconds = 12, rate = 22050) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000 * (0.4 + 0.6 * Math.abs(Math.sin(i / rate * 3)))), 44 + i * 2);
  return buf;
}
const wav = { name: "test-song.wav", mimeType: "audio/wav", buffer: makeWav() };

const browser = await chromium.launch(launchOptions);
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
};
const ctx = await browser.newContext({
  viewport: { width: 1333, height: 800 }, screen: { width: 1333, height: 800 },
  deviceScaleFactor: 1.5, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
watch(page);
await page.goto(COPY, { waitUntil: "networkidle" });
await page.tap("#unlock").catch(() => {});

const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__copy.copy.st)));
const now = () => page.evaluate(() => window.__copy.copy.audio.currentTime);
const holds = () => page.evaluate(() => [...window.__copy.scheduler.keyHolds.keys()].sort((a, b) => a - b));
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

// ============================================================= ① 열기 · 느린 재생
check("파일을 열기 전에는 재생 버튼이 잠겨 있다", await page.locator("#copy-play").isDisabled());
await page.setInputFiles("#copy-file", wav);
await page.waitForFunction(() => !document.getElementById("copy-play").disabled, null, { timeout: 15000 });
check("파일을 열면 이름과 길이가 뜨고 재생이 켜진다", (await page.textContent("#copy-filename")).includes("test-song.wav") && (await page.textContent("#copy-filename")).includes("0:12"), await page.textContent("#copy-filename"));
check("기본 속도 0.75× · 음정 유지가 켜져 있다", await page.evaluate(() => window.__copy.copy.audio.playbackRate === 0.75 && window.__copy.copy.audio.preservesPitch === true));
await sleep(600);
check("파형이 그려진다 (캔버스에 칠한 픽셀이 있다)", await page.evaluate(() => {
  const c = document.getElementById("copy-wave"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1; return n > 500;
}));

await click('#copy-speed [data-speed="0.5"]');
check("0.5× 를 누르면 재생 속도가 0.5", await page.evaluate(() => window.__copy.copy.audio.playbackRate) === 0.5);
await click("#copy-play");
await sleep(2000);
const t05 = await now();
check("0.5× 로 2초 틀면 곡은 1초쯤 간다", t05 > 0.6 && t05 < 1.5, t05);
check("재생 중 버튼 글자가 일시정지로 바뀐다", (await page.textContent("#copy-play")).includes("일시정지"));
await click("#copy-play");
check("일시정지하면 멈춘다", await page.evaluate(() => window.__copy.copy.audio.paused));

// ============================================================= ② 구간 반복
await click('#copy-speed [data-speed="1"]');
await page.fill("#copy-bpm", "120"); await page.dispatchEvent("#copy-bpm", "change");
await page.evaluate(() => { window.__copy.copy.seek(0.5); });
await page.selectOption("#copy-loopn", "1");
await click("#copy-loopbar");
let s = await st();
check("「이 마디부터 1마디」: 0.5초에서 누르면 0~2초 반복이 켜진다", s.loop && Math.abs(s.loop.a) < 1e-6 && Math.abs(s.loop.b - 2) < 1e-6 && s.loopOn, s.loop);
await click("#copy-play");
let max = 0, wrapped = false, last = -1;
for (let i = 0; i < 40; i += 1) {
  const t = await now(); max = Math.max(max, t); if (last >= 0 && t < last - 0.5) wrapped = true; last = t; await sleep(100);
}
check("4초 동안 틀어도 구간 끝(2초)을 0.3초 넘게 새지 않고, 처음으로 돌아간다", max < 2.3 && wrapped, { max, wrapped });
await click("#copy-next");
s = await st();
check("「다음 구간」: 2~4초로 옮기고 그 자리에서 시작", Math.abs(s.loop.a - 2) < 1e-6 && Math.abs(s.loop.b - 4) < 1e-6, s.loop);
await click("#copy-play");

// ============================================================= ③ 적은 코드 울리기
await page.evaluate(() => { window.__copy.copy.st.loopOn = false; });
await click("#copy-loop"); await click("#copy-loop"); // 켰다 끄기 (화면 갱신)
await page.evaluate(() => { const c = window.__copy.copy; c.st.loopOn = false; });
await page.fill('#copy-cells input[data-i="0"]', "C");
await page.fill('#copy-cells input[data-i="1"]', "F/A");
await page.fill('#copy-cells input[data-i="2"]', "Am G");
await page.fill('#copy-cells input[data-i="3"]', "H");
check("읽을 수 없는 이름(H)을 적은 칸은 빨갛게 표시된다", await page.locator('.copy-cell.bad input[data-i="3"]').count() === 1 && await page.locator('.copy-cell.bad').count() === 1);
await page.evaluate(() => { const c = window.__copy.copy; c.st.offset = 0; c.st.bpm = 120; c.seek(0.2); });
await click("#copy-play");
await sleep(400);
let h = await holds();
check("0.2초: 1마디 C — 베이스 C 와 C·E·G 가 울린다", h.length === 4 && h[0] % 12 === 0 && h.slice(1).map((p) => p % 12).sort((a, b) => a - b).join() === "0,4,7", h);
await page.evaluate(() => window.__copy.copy.seek(2.3)); await sleep(400);
h = await holds();
check("2.3초: 2마디 F/A — 맨 아래가 A", h.length === 4 && h[0] % 12 === 9 && h.slice(1).map((p) => p % 12).sort((a, b) => a - b).join() === "0,5,9", h);
await page.evaluate(() => window.__copy.copy.seek(4.2)); await sleep(400);
h = await holds();
check("4.2초: 3마디 앞 절반 Am", h[0] % 12 === 9 && h.slice(1).map((p) => p % 12).includes(0), h);
await page.evaluate(() => window.__copy.copy.seek(5.2)); await sleep(400);
h = await holds();
check("5.2초: 3마디 뒤 절반 G — 코드가 바뀌어도 앞 코드는 끊긴다", h[0] % 12 === 7 && !h.some((p) => p % 12 === 9 && p > 40 && h.length > 4), h);
check("지금 칸이 강조된다", await page.locator(".copy-cell.now").count() === 1);
await page.evaluate(() => window.__copy.copy.seek(6.5)); await sleep(400);
check("읽을 수 없는 칸(H)에서는 소리를 내지 않는다", (await holds()).length === 0, await holds());
await page.evaluate(() => window.__copy.copy.seek(0.3)); await sleep(300);
check("다시 코드가 있는 곳으로 가면 울린다", (await holds()).length === 4);
await click("#copy-play");
await sleep(150);
check("일시정지하면 코드 소리도 끊긴다", (await holds()).length === 0, await holds());

// ============================================================= ④ 탭 템포 · 건반
for (let i = 0; i < 5; i += 1) { await click("#copy-tap"); await sleep(500); }
const bpm = (await st()).bpm;
check("탭 템포: 0.5초 간격으로 5번 → 120 근처", bpm > 110 && bpm < 130, bpm);
await page.selectOption("#copy-key", "0:major").catch(() => {});
for (const p of [60, 64, 67]) await page.dispatchEvent(`#copy-kbd [data-pitch="${p}"]`, "pointerdown", { pointerId: p, bubbles: true });
check("건반 C·E·G 를 누르면 「C」(조를 고르면 로마숫자 I)가 뜬다", /^C( · I)?$/.test(await page.textContent("#copy-readout")), await page.textContent("#copy-readout"));
for (const p of [60, 64, 67]) await page.dispatchEvent(`#copy-kbd [data-pitch="${p}"]`, "pointerup", { pointerId: p, bubbles: true });
check("손을 떼어도 마지막 코드 이름이 남는다", /^C/.test(await page.textContent("#copy-readout")));
await page.focus('#copy-cells input[data-i="5"]');
await click("#copy-insert");
check("「이 코드를 선택한 칸에」: 6번째 칸에 C 가 들어간다", (await st()).cells[5] === "C", (await st()).cells);

// ============================================================= ⑤ 저장 · 불러오기
await page.evaluate(() => window.__copy.copy.saveNow());
await page.reload({ waitUntil: "networkidle" });
await page.tap("#unlock").catch(() => {});
await page.setInputFiles("#copy-file", wav);
await page.waitForFunction(() => !document.getElementById("copy-play").disabled, null, { timeout: 15000 });
s = await st();
check("새로고침 후 같은 파일을 열면 적은 코드·속도·박자가 남아 있다", s.cells[0] === "C" && s.cells[1] === "F/A" && s.cells[2] === "Am G" && s.cells[5] === "C" && s.speed === 1 && Math.abs(s.bpm - bpm) < 0.2, s);
check("다른 파일(이름이 다름)은 따로 저장한다", await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pianoroll.copy:")).length === 1));

// ============================================================= ⑥ 피아노롤에서 열기
const roll = await ctx.newPage();
watch(roll);
await roll.goto(BASE, { waitUntil: "networkidle" });
await roll.tap("#unlock").catch(() => {});
const before = await roll.evaluate(() => document.querySelectorAll("#tracks button").length);
const [popup] = await Promise.all([ctx.waitForEvent("page"), roll.evaluate(() => document.getElementById("copy-page").click())]);
await popup.waitForLoadState("networkidle");
check("피아노롤의 🎼 버튼이 코드 따기를 새 창으로 연다", popup.url() === COPY, popup.url());
check("피아노롤 창은 그대로 남아 있다", (await roll.evaluate(() => document.querySelectorAll("#tracks button").length)) === before);

check("콘솔 오류 없음", errors.length === 0, errors);
await browser.close();
console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}개`);
process.exit(failed === 0 ? 0 : 1);
