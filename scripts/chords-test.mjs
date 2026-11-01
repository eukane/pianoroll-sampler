/**
 * 코드 버튼 · 정석 진행 검사 (패드 가로 화면 크기).
 *
 *   npm run dev &  →  npm run chords
 *
 * 이름과 음 쌓기 자체는 theory-test.mjs 가 브라우저 없이 본다. 여기서는 **화면에서 누르면
 * 실제로 그 자리에 그 음이 찍히는가** 를 본다.
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

const notes = () => page.evaluate(() => window.__app.project.tracks[0].notes.map((n) => [n.pitch, n.start, n.length]));
const head = () => page.evaluate(() => window.__app.scheduler.positionBeats());
const labels = () => page.$$eval("#kb-degrees button", (bs) => bs.map((b) => b.querySelector("b").textContent));
const romans = () => page.$$eval("#kb-degrees button", (bs) => bs.map((b) => b.querySelector("small").textContent));
const clearAll = async () => {
  await page.evaluate(() => {
    const a = window.__app;
    a.project.tracks[0].notes.length = 0;
    a.scheduler.seek(0);
  });
};

await page.tap("#kb-toggle");
await page.waitForTimeout(300);

// ① 조가 없을 때
check("조가 없으면 코드 버튼 대신 안내가 보인다",
  (await page.$$("#kb-degrees button")).length === 0 && (await page.textContent("#kb-degrees")).includes("조를 고르면"));
check("조가 없으면 7th · 진행 넣기가 꺼져 있다",
  await page.evaluate(() => ["kb-seventh", "kb-prog", "kb-prog-go"].every((id) => document.getElementById(id).disabled)));

// ② C 장조
await page.selectOption("#key", "0:major");
check("C 장조 = C Dm Em F G Am Bdim", (await labels()).join(" ") === "C Dm Em F G Am Bdim", await labels());
check("로마숫자 = I ii iii IV V vi vii°", (await romans()).join(" ") === "I ii iii IV V vi vii°", await romans());
check("조를 고르면 7th · 진행 넣기가 켜진다",
  await page.evaluate(() => ["kb-seventh", "kb-prog", "kb-prog-go"].every((id) => !document.getElementById(id).disabled)));

// ③ 버튼을 누르면 재생 위치에 찍히고 헤드가 한 칸 간다 (✎ 찍기가 꺼져 있어도)
await page.selectOption("#kb-len", "bar");
await page.tap("#kb-step"); // 찍기 끄기
check("✎ 찍기를 껐다", !(await page.evaluate(() => document.getElementById("kb-step").classList.contains("on"))));
await page.tap("#kb-degrees button:nth-child(4)"); // F
check("F 버튼 → F A C 가 0박에 한 마디로 찍힌다",
  JSON.stringify(await notes()) === JSON.stringify([[65, 0, 4], [69, 0, 4], [72, 0, 4]]), await notes());
check("헤드가 한 마디 앞으로 간다", (await head()) === 4, await head());
await page.tap("#kb-degrees button:nth-child(5)"); // G
check("이어 G 버튼 → 다음 칸에 G B D", JSON.stringify((await notes()).slice(3)) === JSON.stringify([[55, 4, 4], [59, 4, 4], [62, 4, 4]]), await notes());

// ④ 같은 코드를 같은 자리에 또 찍으면 겹치지 않는다 → 되돌리고 다시
await page.evaluate(() => window.__app.scheduler.seek(0));
await page.tap("#kb-degrees button:nth-child(4)");
check("같은 자리에 같은 코드는 겹쳐 쌓지 않고 알려 준다",
  (await notes()).length === 6 && (await page.textContent("#status")).includes("이미 있어"), await page.textContent("#status"));

// ⑤ 7th
await page.tap("#kb-seventh");
check("7th 를 켜면 Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7b5",
  (await labels()).join(" ") === "Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7b5", await labels());
check("로마숫자도 7th (Imaj7 → I7 형태)", (await romans())[4] === "V7" && (await romans())[5] === "vi7", await romans());
await clearAll();
await page.tap("#kb-degrees button:nth-child(5)");
check("G7 버튼 → G B D F 네 음", JSON.stringify((await notes()).map((n) => n[0])) === "[55,59,62,65]", await notes());
await page.tap("#kb-seventh");
check("7th 를 끄면 다시 3화음", (await labels()).join(" ") === "C Dm Em F G Am Bdim", await labels());

// ⑥ 진행 넣기: 한 번에 찍히고, 되돌리기 한 번에 통째로 사라진다
await clearAll();
await page.selectOption("#kb-prog", "oudou");
await page.tap("#kb-prog-go");
const oudou = await notes();
check("왕도 IV–V–iii–vi (C 장조) = F G Em Am 네 마디",
  oudou.length === 12 && JSON.stringify([...new Set(oudou.map((n) => n[1]))]) === "[0,4,8,12]" && oudou.every((n) => n[2] === 4), oudou);
check("헤드가 네 마디 뒤(16박)로 간다", (await head()) === 16, await head());
await page.tap("#kb-undo");
check("「방금 것」 한 번에 진행 전체가 지워지고 헤드가 처음으로 돌아온다", (await notes()).length === 0 && (await head()) === 0, { n: await notes(), h: await head() });
await page.tap("#kb-prog-go");
await page.tap("#undo");
check("툴바 되돌리기 한 번에도 진행 전체가 사라진다", (await notes()).length === 0, await notes());

// ⑦ 2-5-1
await clearAll();
await page.selectOption("#kb-prog", "251");
await page.tap("#kb-prog-go");
const k251 = await notes();
check("2-5-1 = Dm7 G7 Cmaj7 (4음씩 세 마디)", k251.length === 12 && JSON.stringify([...new Set(k251.map((n) => n[1]))]) === "[0,4,8]", k251);

// ⑧ 단조: 목록이 단조 진행으로 바뀌고 7th 설정은 그대로
await page.selectOption("#key", "9:minor");
check("A 단조 = Am Bdim C Dm Em F G", (await labels()).join(" ") === "Am Bdim C Dm Em F G", await labels());
const minorProgs = await page.$$eval("#kb-prog option", (os) => os.map((o) => o.value));
check("단조에서는 단조 진행만 나온다", minorProgs.includes("m-andalus") && minorProgs.includes("m-251") && !minorProgs.includes("oudou"), minorProgs);
await clearAll();
await page.selectOption("#kb-prog", "m-andalus");
await page.tap("#kb-prog-go");
const andal = await notes();
check("안달루시아 마지막 E 코드는 장3화음 (G# 이 들어간다)", andal.slice(9).map((n) => n[0] % 12).sort((a, b) => a - b).join() === "4,8,11", andal);

// ⑨ 재생 중에는 찍지 않는다
await clearAll();
await page.tap("#play");
await page.tap("#kb-degrees button:nth-child(1)");
const dur = await notes();
await page.tap("#play");
check("재생 중에는 코드 버튼도 찍지 않고 그렇다고 말해 준다", dur.length === 0, dur);

// ⑩ 조를 없애면 다시 안내로
await page.selectOption("#key", "none");
check("조를 없애면 코드 버튼이 사라지고 안내가 돌아온다", (await page.$$("#kb-degrees button")).length === 0);

check("콘솔 오류 없음", errors.length === 0, errors);
await browser.close();
console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}개`);
process.exit(failed === 0 ? 0 : 1);
