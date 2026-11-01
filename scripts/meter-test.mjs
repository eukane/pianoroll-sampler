/**
 * 변박 · 템포 변화 검사 (패드 가로 화면 크기).
 *
 *   npm run dev &  →  npm run meter
 *
 * 시간 계산 자체는 theory-test.mjs 가 브라우저 없이 본다. 여기서는 **실제로 그 박자로 소리가
 * 나는가**를 잰다: 재생 헤드, 노트가 울리는 시각, 메트로놈 틱, WAV 렌더, 화면 조작.
 */
import { chromium } from "playwright";

const URL = process.env.SMOKE_URL ?? "http://127.0.0.1:5173/";
const launchOptions = { args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] };
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await chromium.launch(launchOptions);
const ctx = await browser.newContext({
  viewport: { width: 1333, height: 800 }, screen: { width: 1333, height: 800 },
  deviceScaleFactor: 1.5, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => indexedDB.deleteDatabase("pianoroll-sampler"));
await page.tap("#unlock").catch(() => {});

const setProject = (patch) =>
  page.evaluate((patch) => {
    const a = window.__app;
    const p = a.project;
    p.tracks[0].notes = patch.notes ?? [];
    p.bpm = patch.bpm ?? 120;
    p.bars = patch.bars ?? 4;
    p.timeSig = patch.timeSig ?? [4, 4];
    if (patch.meterChanges) p.meterChanges = patch.meterChanges; else delete p.meterChanges;
    if (patch.tempoChanges) p.tempoChanges = patch.tempoChanges; else delete p.tempoChanges;
    a.scheduler.loopEnabled = false;
    a.scheduler.loopStart = 0;
    a.scheduler.loopEnd = 9999;
    a.scheduler.seek(0);
    a.roll.render();
  }, patch);
const note = (id, pitch, start, length) => ({ id, pitch, start, length, velocity: 100 });

// ① 노트가 울리는 시각 (템포 변화)
//    120BPM 으로 시작, 4박부터 240BPM. 노트 0박·4박·8박 → 0초·2초·3초.
await setProject({
  bpm: 120, bars: 3,
  tempoChanges: [{ beat: 4, bpm: 240 }],
  notes: [note("a", 60, 0, 1), note("b", 62, 4, 4), note("c", 64, 8, 1)],
});
const played = await page.evaluate(async () => {
  const a = window.__app;
  const log = [];
  const orig = a.registry.forTrack.bind(a.registry);
  a.registry.forTrack = (t) => {
    const inst = orig(t);
    return new Proxy(inst, {
      get(target, prop) {
        if (prop === "play") return (...args) => { log.push({ pitch: args[0], when: args[2], dur: args[3] }); return target.play(...args); };
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  };
  a.scheduler.play(0);
  await new Promise((r) => setTimeout(r, 3600));
  a.scheduler.stop();
  a.registry.forTrack = orig;
  return log;
});
const t0 = played[0]?.when ?? 0;
check("노트 세 개가 모두 울린다", played.length === 3, played);
check("울리는 시각 0초 · 2초 · 3초 (템포가 4박부터 두 배)",
  played.length === 3 && near(played[1].when - t0, 2, 0.04) && near(played[2].when - t0, 3, 0.04),
  played.map((p) => +(p.when - t0).toFixed(3)));
check("템포가 바뀐 뒤 노트 길이도 초로 맞다 (4박 = 1초)", played.length === 3 && near(played[1].dur, 1, 0.03) && near(played[0].dur, 0.5, 0.03),
  played.map((p) => +p.dur.toFixed(3)));

// ② 재생 헤드가 템포를 따라간다
await page.evaluate(() => {
  const a = window.__app;
  a.scheduler.seek(0);
  a.scheduler.play(0);
});
const heads = [];
const start = Date.now();
while (Date.now() - start < 3300) {
  heads.push(await page.evaluate(() => ({ t: window.__app.engine.currentTime, b: window.__app.scheduler.positionBeats() })));
  await page.waitForTimeout(250);
}
await page.evaluate(() => window.__app.scheduler.stop());
{
  const t00 = heads[0].t;
  const bad = heads.filter((h) => {
    const sec = h.t - t00;
    const expected = sec <= 2 ? sec * 2 : 4 + (sec - 2) * 4; // 120BPM = 초당 2박, 240BPM = 초당 4박
    return !near(h.b, expected, 0.35);
  });
  check("재생 헤드가 템포대로 움직인다 (2초까지 초당 2박, 이후 초당 4박)", bad.length === 0,
    bad.map((h) => [+(h.t - t00).toFixed(2), +h.b.toFixed(2)]));
}

// ③ 메트로놈: 변박에서 마디마다 첫 박에 높은 틱
await setProject({
  bpm: 300, bars: 3,
  meterChanges: [{ bar: 1, sig: [7, 8] }, { bar: 2, sig: [4, 4] }], // 4/4 → 7/8(3.5박) → 4/4
});
const clicks = await page.evaluate(async () => {
  const a = window.__app;
  const log = [];
  const orig = a.metronome.click.bind(a.metronome);
  a.metronome.click = (when, accent) => { log.push({ when, accent }); orig(when, accent); };
  a.scheduler.metronomeOn = true;
  a.scheduler.play(0);
  await new Promise((r) => setTimeout(r, 3200)); // 11.5박 × 0.2초 = 2.3초
  a.scheduler.stop();
  a.metronome.click = orig;
  a.scheduler.metronomeOn = false;
  return log;
});
{
  const c0 = clicks[0]?.when ?? 0;
  const beats = clicks.map((c) => +(((c.when - c0) / 0.2)).toFixed(2));
  check("틱이 4/4 한 마디(4) + 7/8 한 마디(4: 3.5박) + 4/4 한 마디(4) = 12번", clicks.length === 12, beats);
  check("틱 자리: 0 1 2 3 · 4 5 6 7 · 7.5 8.5 9.5 10.5 (마디마다 첫 박부터 센다)",
    beats.join() === "0,1,2,3,4,5,6,7,7.5,8.5,9.5,10.5", beats);
  check("높은 틱은 마디 첫 박(0 · 4 · 7.5)에서만",
    clicks.map((c, i) => (c.accent ? beats[i] : null)).filter((x) => x !== null).join() === "0,4,7.5",
    clicks.map((c, i) => [beats[i], c.accent]));
}

// ④ 예비박: 시작하는 자리의 마디 길이만큼 (3/4 마디에서 시작하면 3번)
await setProject({ bpm: 300, bars: 3, meterChanges: [{ bar: 1, sig: [3, 4] }] });
const countIn = await page.evaluate(async () => {
  const a = window.__app;
  const log = [];
  const orig = a.metronome.click.bind(a.metronome);
  a.metronome.click = (when, accent) => { log.push({ when, accent }); orig(when, accent); };
  a.scheduler.play(4, { countIn: true }); // 4박 = 2번째 마디(3/4) 시작
  await new Promise((r) => setTimeout(r, 900));
  a.scheduler.stop();
  a.metronome.click = orig;
  return log;
});
check("3/4 마디에서 시작하는 예비박은 세 번이고 첫 틱만 높다", countIn.length === 3 && countIn.map((c) => c.accent).join() === "true,false,false", countIn);

// ⑤ WAV 렌더: 템포 변화가 파일에도 반영된다
await setProject({
  bpm: 120, bars: 3,
  tempoChanges: [{ beat: 4, bpm: 60 }],
  notes: [note("a", 69, 0, 0.5), note("b", 69, 8, 0.5)],
});
const wav = await page.evaluate(async () => {
  const { renderProject, projectSeconds } = await import("/src/export/render.ts");
  const buf = await renderProject(window.__app.project, () => window.__app.registry.soundfont.bankBuffer(), window.__app.registry.folders.list, window.__app.mixerState);
  const ch = buf.getChannelData(0);
  const win = Math.round(buf.sampleRate * 0.01);
  const onsets = [];
  let quiet = true;
  for (let i = 0; i + win < ch.length; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j += 1) sum += ch[i + j] * ch[i + j];
    const rms = Math.sqrt(sum / win);
    if (quiet && rms > 0.01) { onsets.push(+(i / buf.sampleRate).toFixed(2)); quiet = false; }
    if (rms < 0.002) quiet = true;
  }
  return { onsets, duration: buf.duration, expected: projectSeconds(window.__app.project) };
});
check("WAV 의 두 번째 노트는 6초에 시작한다 (4박@120BPM = 2초 + 4박@60BPM = 4초)", wav.onsets.length >= 2 && near(wav.onsets[1], 6, 0.05), wav);
check("WAV 길이 = 곡 길이(2 + 8 = 10초) + 꼬리 2초", near(wav.duration, 12, 0.05) && near(wav.expected, 12, 0.001), wav);

// ⑥ 화면: 변박·템포 창
await setProject({ bpm: 120, bars: 6, notes: [note("a", 60, 0, 1), note("b", 64, 10, 1)] });
await page.tap("#tm");
check("변박·템포 창이 열린다", !(await page.evaluate(() => document.getElementById("tm-modal").classList.contains("hidden"))));
check("처음엔 곡 처음 박자·빠르기 한 줄씩만 있다", (await page.$$("#tm-meters .tm-row")).length === 1 && (await page.$$("#tm-tempos .tm-row")).length === 1);

await page.fill("#tm-m-bar", "3");
await page.selectOption("#tm-m-sig", "3/4");
await page.tap("#tm-m-add");
const m1 = await page.evaluate(() => window.__app.project.meterChanges);
check("3마디부터 3/4 가 들어간다 (저장은 0부터라 bar: 2)", JSON.stringify(m1) === JSON.stringify([{ bar: 2, sig: [3, 4] }]), m1);
check("곡 길이가 줄어든다 (4/4 6마디 = 24박 → 8 + 4×3 = 20박)", (await page.evaluate(() => window.__app.project.bars)) === 6 &&
  (await page.evaluate(async () => (await import("/src/model/timeline.ts")).totalBeats(window.__app.project))) === 20);
check("노트는 움직이지 않는다", (await page.evaluate(() => window.__app.project.tracks[0].notes.map((n) => n.start).join())) === "0,10");
check("목록에 한 줄이 늘고 「3마디부터 3/4」 라고 보인다", (await page.textContent("#tm-meters")).includes("3마디부터  3/4"), await page.textContent("#tm-meters"));

await page.fill("#tm-m-bar", "1");
await page.tap("#tm-m-add");
check("1마디에는 박자 바꾸기를 못 넣고 이유를 말해 준다", (await page.textContent("#tm-msg")).includes("2 ~ 6") && (await page.evaluate(() => window.__app.project.meterChanges.length)) === 1, await page.textContent("#tm-msg"));
await page.fill("#tm-m-bar", "9");
await page.tap("#tm-m-add");
check("곡 끝 뒤 마디도 못 넣는다", (await page.textContent("#tm-msg")).includes("2 ~ 6"), await page.textContent("#tm-msg"));

await page.fill("#tm-m-bar", "3");
await page.selectOption("#tm-m-sig", "4/4");
await page.tap("#tm-m-add");
check("같은 마디에 다시 넣으면 바꿔 쓴다 (앞 박자와 같아지면 변박이 아니라 사라진다)", (await page.evaluate(() => window.__app.project.meterChanges)) === undefined);

await page.fill("#tm-m-bar", "3");
await page.selectOption("#tm-m-sig", "3/4");
await page.tap("#tm-m-add");
await page.fill("#tm-t-bar", "4");
await page.fill("#tm-t-beat", "2");
await page.fill("#tm-t-bpm", "90");
await page.tap("#tm-t-add");
const tc = await page.evaluate(() => window.__app.project.tempoChanges);
// 4마디는 8 + 3 = 11박에서 시작, 2박째 = 12박
check("템포: 4마디 2박은 곡의 12박 (변박을 반영해 센다)", JSON.stringify(tc) === JSON.stringify([{ beat: 12, bpm: 90 }]), tc);
await page.fill("#tm-t-bar", "4");
await page.fill("#tm-t-beat", "4");
await page.tap("#tm-t-add");
check("3/4 마디에는 4박이 없다고 말해 준다", (await page.textContent("#tm-msg")).includes("3박까지"), await page.textContent("#tm-msg"));
await page.fill("#tm-t-bar", "1");
await page.fill("#tm-t-beat", "1");
await page.tap("#tm-t-add");
check("곡 맨 처음 템포는 위 BPM 칸에서 바꾸라고 말해 준다", (await page.textContent("#tm-msg")).includes("BPM 칸"), await page.textContent("#tm-msg"));
await page.fill("#tm-t-bar", "5");
await page.fill("#tm-t-beat", "1");
await page.fill("#tm-t-bpm", "500");
await page.tap("#tm-t-add");
check("BPM 범위(20~300)를 벗어나면 막는다", (await page.textContent("#tm-msg")).includes("20 ~ 300"), await page.textContent("#tm-msg"));

// 재생 위치 표시: 위치 라벨 · 마디 번호
await page.tap("#tm-close");
await page.evaluate(() => window.__app.scheduler.seek(8));
await page.waitForTimeout(150);
check("재생 위치 표시가 변박을 따른다 (8박 = 3마디 1박)", (await page.textContent("#pos")).trim() === "3 : 1", await page.textContent("#pos"));
await page.evaluate(() => window.__app.scheduler.seek(11));
await page.waitForTimeout(150);
check("11박 = 4마디 1박", (await page.textContent("#pos")).trim() === "4 : 1", await page.textContent("#pos"));

// ⑦ 되돌리기 · 다시 실행
await page.tap("#undo");
check("되돌리면 템포 변화가 사라진다 (남은 값이 없다)", (await page.evaluate(() => "tempoChanges" in window.__app.project)) === false &&
  JSON.stringify(await page.evaluate(() => window.__app.project.meterChanges)) === JSON.stringify([{ bar: 2, sig: [3, 4] }]));
await page.tap("#undo");
check("한 번 더 되돌리면 변박도 사라진다 (남은 값이 없다)", (await page.evaluate(() => "meterChanges" in window.__app.project)) === false);
await page.tap("#redo");
await page.tap("#redo");
check("다시 실행하면 둘 다 돌아온다", (await page.evaluate(() => window.__app.project.meterChanges?.length)) === 1 && (await page.evaluate(() => window.__app.project.tempoChanges?.length)) === 1);

// ⑧ 지우기
await page.tap("#tm");
await page.tap("#tm-tempos .tm-row button");
check("템포 줄의 🗑 로 지운다", (await page.evaluate(() => "tempoChanges" in window.__app.project)) === false);
await page.tap("#tm-meters .tm-row button");
check("박자 줄의 🗑 로 지운다", (await page.evaluate(() => "meterChanges" in window.__app.project)) === false);
await page.tap("#tm-close");

// ⑨ 복사 · 한 마디 찍기가 변박을 따른다
await setProject({ bpm: 120, bars: 4, meterChanges: [{ bar: 1, sig: [3, 4] }], notes: [note("a", 60, 4, 1), note("b", 62, 5, 1), note("c", 64, 6, 1), note("d", 65, 7, 1)] });
await page.evaluate(() => window.__app.scheduler.seek(4));
await page.tap("#copy");
const clip = await page.evaluate(() => window.__app.scheduler.positionBeats());
check("복사는 헤드가 있는 마디(3/4 = 4~7박)만 잡고 헤드가 그 끝(7박)으로 간다", clip === 7, clip);
await page.tap("#paste");
const pasted = await page.evaluate(() => window.__app.project.tracks[0].notes.filter((n) => n.start >= 7 && n.pitch !== 65).map((n) => [n.pitch, n.start]));
check("붙여넣으면 3박 뒤(7박)에 세 음이 붙는다", JSON.stringify(pasted.slice(0, 3)) === JSON.stringify([[60, 7], [62, 8], [64, 9]]), pasted);
await page.tap("#kb-toggle");
await page.selectOption("#kb-len", "bar");
await page.selectOption("#key", "0:major");
await page.evaluate(() => { window.__app.project.tracks[0].notes = []; window.__app.scheduler.seek(4); });
await page.tap("#kb-degrees button:nth-child(1)");
const bar3 = await page.evaluate(() => window.__app.project.tracks[0].notes.map((n) => [n.start, n.length]));
check("「한 마디」 길이로 찍으면 3/4 마디는 3박이다", bar3.length === 3 && bar3.every(([s, l]) => s === 4 && l === 3), bar3);
check("찍고 나면 헤드가 7박으로 간다", (await page.evaluate(() => window.__app.scheduler.positionBeats())) === 7);
// 마디를 늘려야 하는 만큼 늘어난다
await page.evaluate(() => { window.__app.scheduler.seek(11); });
await page.tap("#kb-degrees button:nth-child(2)");
check("곡 끝을 넘으면 마디가 변박에 맞게 늘어난다 (11박+3박 = 14박 > 13박 → 5마디)", (await page.evaluate(() => window.__app.project.bars)) === 5, await page.evaluate(() => window.__app.project.bars));

// ⑩ 피아노롤이 마디선을 변박대로 그린다 (눈금자 숫자와 마디선 위치)
await setProject({ bpm: 120, bars: 4, meterChanges: [{ bar: 1, sig: [3, 4] }] });
const geometry = await page.evaluate(() => {
  const r = window.__app.roll;
  return [0, 4, 7, 10].map((b) => Math.round(r.beatToX(b)));
});
check("마디선 위치: 0 · 4 · 7 · 10 박이 같은 간격이 아니다 (4박 마디 다음은 3박 마디)",
  geometry[2] - geometry[1] < geometry[1] - geometry[0] && near(geometry[3] - geometry[2], geometry[2] - geometry[1], 1), geometry);
await page.screenshot({ path: process.env.SHOT ?? "/tmp/meter.png" });

check("콘솔 오류 없음", errors.length === 0, errors);
await browser.close();
console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}개`);
process.exit(failed === 0 ? 0 : 1);
