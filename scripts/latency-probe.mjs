/**
 * 이 기기에서 사운드폰트가 얼마나 늦게 울리는지 **재는 자**.
 *
 * smoke 는 "10ms 안에 들어왔나" 만 보고 통과/실패를 말한다. 이 스크립트는
 * 숫자를 보여 준다 — 폰에서 "아직도 밀리는 것 같다" 는 말이 나왔을 때
 * 얼마나 밀리는지 먼저 재려고 남겨 둔 도구다.
 *
 * 오프라인 렌더(내보내기)는 이미 정렬을 확인해 뒀지만 그건 워크렛 안의
 * 시퀀서를 쓰는 **다른 경로**다. 화면에서 듣는 재생은 noteOn(..., {time}) 으로
 * 예약하는 경로라 따로 재야 한다.
 *
 * 재는 법: 믹서 채널 0(임시 신스)과 1(사운드폰트)에 AnalyserNode 를 하나씩
 * 물리고, 두 노트를 **같은 시각**에 예약한 뒤 한 틱 안에서 두 분석기를 연달아
 * 읽는다. 같은 순간에 읽은 두 버퍼 안에서 소리가 시작한 샘플 번호를 세면
 * 둘 사이 어긋난 양이 샘플 단위로 나온다.
 *
 * 쓰는 법: 다른 창에서 `npm run dev` 를 띄워 두고 `npm run latency`.
 */

import { chromium, devices } from "playwright";

const URL = process.env.SMOKE_URL ?? "http://127.0.0.1:5173/";
const launchOptions = { args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] };
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ ...devices["Pixel 5"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("  [err]", e.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator("#unlock").tap();
await page.waitForTimeout(300);
await page.locator("#sf-file").setInputFiles("fixtures/test.sf2");
await page.waitForTimeout(2500);

const measure = async (waitBeforeSec) =>
  page.evaluate(async (waitBefore) => {
    const app = window.__app;
    const ctx = app.engine.ctx;
    const mixer = app.mixer;
    const reg = app.registry;

    const makeAnalyser = (ch) => {
      const a = ctx.createAnalyser();
      a.fftSize = 32768;
      mixer.inputs[ch].connect(a);
      return a;
    };
    const a0 = makeAnalyser(0);
    const a1 = makeAnalyser(1);

    const preset = reg.soundfont.presetList[0];
    reg.soundfont.setPreset(1, preset.id);
    mixer.set(0, { volume: 1, pan: 0, muted: false, send: 0 });
    mixer.set(1, { volume: 1, pan: 0, muted: false, send: 0 });

    // 신스가 자리 잡을 시간을 준다 (프로그램 체인지 처리) + 준비운동 한 음.
    // 첫 음은 워크렛이 샘플을 처음 만지느라 늦을 수 있어 재는 대상에서 뺀다.
    await new Promise((r) => setTimeout(r, 300));
    reg.soundfont.play(69, 100, ctx.currentTime + 0.05, 0.2, 1);
    reg.osc.play(69, 100, ctx.currentTime + 0.05, 0.2, 0);
    await new Promise((r) => setTimeout(r, 1200));

    // 여기가 핵심 변수: 얼마나 미리 예약하는가.
    const T = ctx.currentTime + waitBefore;
    reg.osc.play(69, 110, T, 0.5, 0);
    reg.soundfont.play(69, 110, T, 0.5, 1);

    // 두 소리가 다 시작하고 분석기 창(32768샘플 = 743ms) 안에 남아 있을 때 읽는다.
    await new Promise((r) => setTimeout(r, (waitBefore + 0.3) * 1000));

    const b0 = new Float32Array(a0.fftSize);
    const b1 = new Float32Array(a1.fftSize);
    a0.getFloatTimeDomainData(b0);
    a1.getFloatTimeDomainData(b1);
    const readAt = ctx.currentTime;

    const onset = (arr, th) => {
      for (let i = 0; i < arr.length; i += 1) if (Math.abs(arr[i]) > th) return i;
      return -1;
    };
    const peakOf = (arr) => { let p = 0; for (const v of arr) p = Math.max(p, Math.abs(v)); return p; };
    const p0 = peakOf(b0);
    const p1 = peakOf(b1);
    // 문턱값을 셋으로 재서 "예약이 밀린 것"과 "소리 자체가 천천히 커지는 것"을 가른다.
    const o0 = { peak: p0, idx: onset(b0, p0 * 0.08), abs: onset(b0, 1e-4), half: onset(b0, p0 * 0.5) };
    const o1 = { peak: p1, idx: onset(b1, p1 * 0.08), abs: onset(b1, 1e-4), half: onset(b1, p1 * 0.5) };
    // 창(fftSize) 안에서 osc 가 있어야 할 자리. 여기서 크게 벗어나면 잰 값이 못 믿을 값이다.
    const expected = a0.fftSize - (readAt - T) * ctx.sampleRate;

    a0.disconnect();
    a1.disconnect();
    return {
      sr: ctx.sampleRate,
      fftSize: a0.fftSize,
      T,
      readAt,
      osc: o0,
      sf: o1,
      expected,
      offsetMs: reg.soundfont.clockOffsetMs,
      baseLatency: ctx.baseLatency,
      outputLatency: ctx.outputLatency,
    };
  }, waitBeforeSec);

for (const lead of [0.4, 0.4, 0.2, 0.12, 0.05]) {
  const r = await measure(lead);
  const ms = (n) => (n / r.sr) * 1000;
  const off = Math.abs(r.osc.abs - r.expected);
  const trust = r.osc.idx >= 0 && off < 1500 ? "" : `  ⚠ 못 믿을 값 (osc 기대 ${r.expected.toFixed(0)})`;
  const line =
    r.osc.idx < 0 || r.sf.idx < 0
      ? `잡히지 않음 (osc idx=${r.osc.idx} peak=${r.osc.peak.toFixed(5)}, sf idx=${r.sf.idx} peak=${r.sf.peak.toFixed(5)})`
      : `사운드폰트가 ${ms(r.sf.idx - r.osc.idx).toFixed(1)}ms 늦음 (8% 기준)` +
        ` / ${ms(r.sf.abs - r.osc.abs).toFixed(1)}ms (절대 1e-4) / ${ms(r.sf.half - r.osc.half).toFixed(1)}ms (50%)` +
        `  [osc ${r.osc.abs}→${r.osc.idx}→${r.osc.half}, sf ${r.sf.abs}→${r.sf.idx}→${r.sf.half}]${trust}`;
  console.log(`미리 예약 ${(lead * 1000).toFixed(0)}ms → ${line}  [보정 ${r.offsetMs.toFixed(1)}ms]`);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#unlock").tap();
  await page.waitForTimeout(200);
  await page.locator("#sf-file").setInputFiles("fixtures/test.sf2");
  await page.waitForTimeout(2500);
}

await browser.close();
