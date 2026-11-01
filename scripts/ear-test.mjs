/**
 * 귀 훈련 화면 검사 (패드 가로 화면 크기).
 *
 *   npm run dev &  →  npm run ear
 *
 * 문제 만들기·채점 규칙은 theory-test.mjs 가 브라우저 없이 본다. 여기서는 **화면을 눌렀을 때
 * 소리가 순서대로 나는가 · 칸이 채워지는가 · 채점 결과가 맞게 뜨는가** 를 본다.
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
await page.tap("#unlock").catch(() => {});
await page.evaluate(() => localStorage.removeItem("pianoroll.ear"));

const q = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.ear.question)));
const text = (sel) => page.textContent(sel);
const holds = () => page.evaluate(() => [...window.__app.scheduler.keyHolds.keys()].sort((a, b) => a - b));
const choiceTexts = () => page.$$eval("#ear-choices button", (b) => b.map((x) => x.textContent));

await page.tap("#ear");
check("귀 훈련 창이 열린다", !(await page.evaluate(() => document.getElementById("ear-modal").classList.contains("hidden"))));
const levels = await page.$$eval("#ear-level option", (o) => o.map((x) => x.value));
check("단계가 여섯 개 (1~4단계 + 정석 이름 장·단조)", levels.join() === "L1,L2,L3,L4,N1,N2", levels);
check("처음엔 문제가 없어 「다시 듣기」 · 「확인」 이 꺼져 있다",
  await page.evaluate(() => document.getElementById("ear-again").disabled && document.getElementById("ear-submit").disabled));

// ① 1단계: 소리가 순서대로 난다 (으뜸 코드 → 진행)
await page.selectOption("#ear-level", "L1");
await page.evaluate(() => { document.getElementById("ear-randkey").checked = false; });
await page.tap("#ear-new");
const question = await q();
check("문제가 나온다 (C 장조 · 3코드 · 조 바꾸기 끔)", question.key.tonic === 0 && question.degrees.length === 3, question);
check("고르기 버튼은 I IV V 세 개", (await choiceTexts()).join() === "I,IV,V", await choiceTexts());
check("칸이 세 개 비어 있다", (await page.$$("#ear-slots .ear-slot")).length === 3);

const seen = [];
const t0 = Date.now();
while (Date.now() - t0 < 6200) {
  // 비는 순간도 기록한다 — 첫 코드가 I 면 으뜸 코드와 같은 소리라, 사이가 비는 것으로만 갈린다.
  const h = (await holds()).join();
  if (seen[seen.length - 1] !== h) seen.push(h);
  await page.waitForTimeout(40);
}
const sounds = seen.filter((x) => x !== "");
check("소리가 으뜸 코드 한 번 + 진행 세 코드 = 네 번 난다", sounds.length === 4, seen);
check("첫 소리는 으뜸 코드 C — C E G 위에 베이스 C 한 옥타브 아래", sounds[0] === "48,60,64,67", sounds[0]);
await page.waitForTimeout(300);
check("끝나면 소리가 다 멎는다", (await holds()).length === 0, await holds());

// ② 맞게 누르기
const names = { 0: 0, 3: 1, 4: 2 }; // 도수 → 버튼 순서(I IV V)
for (const d of question.degrees) await page.tap(`#ear-choices button:nth-child(${names[d] + 1})`);
const slotTexts = await page.$$eval("#ear-slots .ear-slot", (s) => s.map((x) => x.textContent));
check("누른 순서대로 칸이 채워진다", slotTexts.join() === question.degrees.map((d) => ["I", "", "", "IV", "V"][d]).join(), slotTexts);
check("누르면 그 코드 소리가 난다", (await holds()).length > 0, await holds());
check("칸이 다 차면 확인이 켜진다", !(await page.evaluate(() => document.getElementById("ear-submit").disabled)));
await page.tap("#ear-submit");
check("맞으면 「정답」 이 뜬다", (await text("#ear-result")).startsWith("정답"), await text("#ear-result"));
check("정답 설명에 로마숫자와 코드 이름이 같이 나온다", /=/.test(await text("#ear-result")) && (await text("#ear-result")).includes("C 장조"), await text("#ear-result"));
check("점수가 1/1", (await text("#ear-score")).includes("이번 1/1"), await text("#ear-score"));
check("정답이면 틀린 문제 목록은 비어 있다", await page.evaluate(() => document.getElementById("ear-review").disabled));
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pianoroll.ear")));
check("기록이 이 브라우저에 남는다", stored.tally?.L1?.right === 1 && stored.tally?.L1?.total === 1, stored);

// ③ 틀리게 누르기 → 틀린 문제 복습
await page.tap("#ear-new");
const q2 = await q();
check("다음 문제는 직전과 다르다", JSON.stringify(q2.degrees) !== JSON.stringify(question.degrees));
// 첫 칸을 일부러 틀리게
const wrongFirst = [0, 3, 4].find((d) => d !== q2.degrees[0]);
await page.tap(`#ear-choices button:nth-child(${names[wrongFirst] + 1})`);
for (const d of q2.degrees.slice(1)) await page.tap(`#ear-choices button:nth-child(${names[d] + 1})`);
await page.tap("#ear-back");
check("⌫ 지우기는 마지막 한 칸을 비운다", (await page.$$eval("#ear-slots .ear-slot", (s) => s.filter((x) => x.classList.contains("filled")).length)) === 2);
await page.tap(`#ear-choices button:nth-child(${names[q2.degrees[2]] + 1})`);
await page.tap("#ear-submit");
check("틀리면 「아쉬워요」 와 정답이 뜬다", (await text("#ear-result")).startsWith("아쉬워요") && (await text("#ear-result")).includes("정답:"), await text("#ear-result"));
check("틀린 칸만 빨갛게 표시된다 (첫 칸)",
  (await page.$$eval("#ear-slots .ear-slot", (s) => s.map((x) => x.classList.contains("wrong")))).join() === "true,false,false");
check("점수가 1/2", (await text("#ear-score")).includes("이번 1/2"), await text("#ear-score"));
check("틀린 문제 다시 (1)", (await text("#ear-review")).includes("(1)"), await text("#ear-review"));
await page.tap("#ear-review");
const q3 = await q();
check("복습하면 같은 문제가 다시 나온다 (칸이 비어 있다)",
  JSON.stringify(q3.degrees) === JSON.stringify(q2.degrees) && (await page.$$eval("#ear-slots .ear-slot.filled", (s) => s.length)) === 0, q3);
check("복습으로 꺼낸 문제는 목록에서 빠진다", await page.evaluate(() => document.getElementById("ear-review").disabled));

// ④ 정석 이름 맞히기
await page.selectOption("#ear-level", "N1");
check("단계를 바꾸면 문제가 접힌다", (await page.evaluate(() => window.__app.ear.question)) === null);
await page.tap("#ear-new");
const qn = await q();
check("보기가 네 개이고 정답이 들어 있다", (await choiceTexts()).length === 4 && qn.options.includes(qn.progression), { opts: qn.options });
const idx = qn.options.indexOf(qn.progression);
await page.tap(`#ear-choices button:nth-child(${idx + 1})`);
await page.tap("#ear-submit");
check("이름을 맞히면 정답", (await text("#ear-result")).startsWith("정답"), await text("#ear-result"));

// ⑤ 단조 · 조 바꾸기
await page.selectOption("#ear-level", "L4");
await page.evaluate(() => { document.getElementById("ear-randkey").checked = true; });
const keys = new Set();
for (let i = 0; i < 6; i += 1) {
  await page.tap("#ear-new");
  const k = (await q()).key;
  keys.add(`${k.tonic}:${k.mode}`);
}
check("4단계는 단조이고 조가 바뀐다", [...keys].every((k) => k.endsWith(":minor")) && keys.size >= 3, [...keys]);
check("단조 버튼은 i III iv v VI VII", (await choiceTexts()).join() === "i,III,iv,v,VI,VII", await choiceTexts());

// ⑥ 닫으면 소리가 멎는다
await page.tap("#ear-again");
await page.waitForTimeout(200);
check("다시 듣기를 누르면 소리가 난다", (await holds()).length > 0);
await page.tap("#ear-close");
await page.waitForTimeout(100);
check("닫으면 소리가 바로 멎는다", (await holds()).length === 0, await holds());
await page.waitForTimeout(1500);
check("닫은 뒤 예약된 소리가 뒤늦게 울리지 않는다", (await holds()).length === 0, await holds());

check("콘솔 오류 없음", errors.length === 0, errors);
await browser.close();
console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}개`);
process.exit(failed === 0 ? 0 : 1);
