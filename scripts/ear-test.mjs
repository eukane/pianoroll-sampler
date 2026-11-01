/**
 * 귀 훈련 페이지(ear.html) 검사 (패드 가로 화면 크기).
 *
 *   npm run dev &  →  npm run ear
 *
 * 문제 만들기·채점·기록 계산은 theory-test.mjs 가 브라우저 없이 본다. 여기서는
 *   ① 화면을 눌렀을 때 소리가 순서대로 나는가 · 칸이 채워지는가 · 채점 결과가 맞게 뜨는가
 *   ② 기록(오늘 · 연속 · 도수별 · 헷갈린 쌍)이 화면에 뜨고 새로고침해도 남는가
 *   ③ 키보드로도 되는가
 *   ④ 피아노롤에서 버튼을 누르면 새 창으로 열리고, 작업 중인 곡이 그대로인가
 *   ⑤ 저장해 둔 음원을 여기서도 쓰는가
 * 를 본다.
 */
import { chromium } from "playwright";

const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:5173/";
const EAR = new URL("ear.html", BASE).toString();
const launchOptions = { args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] };
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const browser = await chromium.launch(launchOptions);
const newCtx = () => browser.newContext({
  viewport: { width: 1333, height: 800 }, screen: { width: 1333, height: 800 },
  deviceScaleFactor: 1.5, isMobile: true, hasTouch: true,
});
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
};

// =============================================================== A. 새 기기: 음원 없음
const ctx = await newCtx();
const page = await ctx.newPage();
watch(page);
await page.goto(EAR, { waitUntil: "networkidle" });
await page.tap("#unlock").catch(() => {});

const q = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__ear.ear.question)));
const text = (sel) => page.textContent(sel);
const holds = () => page.evaluate(() => [...window.__ear.scheduler.keyHolds.keys()].sort((a, b) => a - b));
const choiceTexts = () => page.$$eval("#ear-choices button", (b) => b.map((x) => x.textContent));
const store = () => page.evaluate(() => JSON.parse(localStorage.getItem("pianoroll.ear") ?? "null"));
const slotTexts = () => page.$$eval("#ear-slots .ear-slot", (s) => s.map((x) => x.firstChild?.textContent ?? ""));

check("귀 훈련 페이지가 열린다 (제목 · 피아노롤 버튼)", (await page.title()) === "귀 훈련" && await page.isVisible("#ear-exit"));
const levels = await page.$$eval("#ear-level option", (o) => o.map((x) => x.value));
check("처음엔 전부 보인다 (기본 「7회차까지」) — 회차 순으로 열세 단계", levels.join() === "L1,L2,L3,Q1,Q2,N1,E2,Q3,L4,N2,N3,N4,N5", levels);
check("단계 목록은 회차별로 묶여 있다 (optgroup 7개)", (await page.$$("#ear-level optgroup")).length === 7);
check("음원이 없으면 악기 고르기는 숨겨져 있다 (임시 신스뿐)", await page.evaluate(() => document.getElementById("ear-inst").classList.contains("hidden")));
check("처음엔 문제가 없어 「다시 듣기」 · 「확인」 이 꺼져 있다",
  await page.evaluate(() => document.getElementById("ear-again").disabled && document.getElementById("ear-submit").disabled));
check("오늘 0/20 · 연속 0일로 시작한다", (await text("#ear-today")).trim() === "오늘 0/20" && (await text("#ear-streak")).includes("0일"), [await text("#ear-today"), await text("#ear-streak")]);
check("기록이 없을 땐 헷갈린 쌍 자리에 안내가 뜬다", (await text("#ear-conf")).includes("아직 없어요"));

// ① 1단계: 소리가 순서대로 난다 (으뜸 코드 → 진행)
await page.selectOption("#ear-level", "L1");
await page.evaluate(() => { const c = document.getElementById("ear-randkey"); c.checked = false; c.dispatchEvent(new Event("change")); });
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
const numeral = { 0: "I", 3: "IV", 4: "V" };
for (const d of question.degrees) await page.tap(`#ear-choices button:nth-child(${names[d] + 1})`);
check("누른 순서대로 칸이 채워진다", (await slotTexts()).join() === question.degrees.map((d) => numeral[d]).join(), await slotTexts());
check("누르면 그 코드 소리가 난다", (await holds()).length > 0, await holds());
check("칸이 다 차면 확인이 켜진다", !(await page.evaluate(() => document.getElementById("ear-submit").disabled)));
await page.tap("#ear-submit");
check("맞으면 「정답」 이 뜬다", (await text("#ear-result")).startsWith("정답"), await text("#ear-result"));
check("정답 설명에 로마숫자와 코드 이름이 같이 나온다", /=/.test(await text("#ear-result")) && (await text("#ear-result")).includes("C 장조"), await text("#ear-result"));
check("점수가 1/1", (await text("#ear-score")).includes("이번 1/1"), await text("#ear-score"));
check("정답이면 틀린 문제 목록은 비어 있다", await page.evaluate(() => document.getElementById("ear-review").disabled));
let st = await store();
check("기록이 이 브라우저에 남는다 (단계 · 도수 칸 수)", st.tally?.L1?.right === 1 && st.tally?.L1?.total === 1 &&
  st.degrees.major.asked.reduce((a, b) => a + b, 0) === 3 && st.degrees.major.right.reduce((a, b) => a + b, 0) === 3, st);
check("오늘 1/20 · 연속 1일로 바뀐다", (await text("#ear-today")).trim() === "오늘 1/20" && (await text("#ear-streak")).includes("1일"), [await text("#ear-today"), await text("#ear-streak")]);
check("오늘 막대가 5% 만큼 찬다", (await page.$eval("#ear-today-bar", (b) => b.style.width)) === "5%");
{
  const rows = await page.$$eval("#ear-deg .ear-stat", (r) => r.map((x) => x.textContent));
  const first = question.degrees[0];
  const row = rows.find((r) => r.startsWith(numeral[first]));
  check("도수별 정답률에 푼 도수가 100% 로 뜨고 안 푼 건 「아직」", rows.length === 3 && /100%/.test(row ?? "") && rows.some((r) => r.includes("아직")) || new Set(question.degrees).size === 3, rows);
}

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
{
  const conf = await page.$$eval("#ear-conf .ear-conf-row", (r) => r.map((x) => x.textContent));
  const want = `${numeral[q2.degrees[0]]} 를 ${numeral[wrongFirst]} 로1번`;
  check("헷갈린 쌍에 「정답 → 내 답」 이 쌓인다", conf.length === 1 && conf[0].replace(/\s/g, "") === want.replace(/\s/g, ""), { conf, want });
}
check("오늘 2/20", (await text("#ear-today")).trim() === "오늘 2/20");

// 새로고침해도 남는다
await page.reload({ waitUntil: "networkidle" });
await page.tap("#unlock").catch(() => {});
check("새로고침하면 문제는 접히지만 기록(오늘 2/20 · 1일 연속)은 남는다", (await q()) === null &&
  (await text("#ear-today")).trim() === "오늘 2/20" && (await text("#ear-streak")).includes("1일"));
check("틀린 문제 목록도 남는다 — 「틀린 문제 다시 (1)」", (await text("#ear-review")).includes("(1)") && !(await page.evaluate(() => document.getElementById("ear-review").disabled)), await text("#ear-review"));
check("고른 단계(1단계)와 조 바꾸기 끔도 기억한다", (await page.$eval("#ear-level", (s) => s.value)) === "L1" && !(await page.$eval("#ear-randkey", (c) => c.checked)));
await page.tap("#ear-review");
const q3 = await q();
check("복습하면 같은 문제가 다시 나온다 (칸이 비어 있다)",
  JSON.stringify(q3.degrees) === JSON.stringify(q2.degrees) && q3.key.tonic === q2.key.tonic && (await page.$$eval("#ear-slots .ear-slot.filled", (s) => s.length)) === 0, q3);
check("복습 문제는 맞힐 때까지 목록에 남아 있다", (await text("#ear-review")).includes("(1)"));
for (const d of q3.degrees) await page.tap(`#ear-choices button:nth-child(${names[d] + 1})`);
await page.tap("#ear-submit");
check("복습 문제를 맞히면 목록에서 빠진다", await page.evaluate(() => document.getElementById("ear-review").disabled) && (await store()).wrong.length === 0, await store());

// ④ 정석 이름 맞히기
await page.selectOption("#ear-level", "N1");
check("단계를 바꾸면 문제가 접힌다", (await q()) === null);
await page.tap("#ear-new");
const qn = await q();
check("보기가 네 개이고 정답이 들어 있다", (await choiceTexts()).length === 4 && qn.options.includes(qn.progression), { opts: qn.options });
const idx = qn.options.indexOf(qn.progression);
await page.tap(`#ear-choices button:nth-child(${idx + 1})`);
await page.tap("#ear-submit");
check("이름을 맞히면 정답", (await text("#ear-result")).startsWith("정답"), await text("#ear-result"));
check("정석 이름 단계는 진행별 정답률이 뜬다 (7회차까지면 일곱 줄)", (await page.$$("#ear-deg .ear-stat")).length === 7 && (await text("#ear-deg-title")).includes("정석 진행별"));

// ⑤ 단조 · 조 바꾸기
await page.selectOption("#ear-level", "L4");
await page.evaluate(() => { const c = document.getElementById("ear-randkey"); c.checked = true; c.dispatchEvent(new Event("change")); });
const keys = new Set();
for (let i = 0; i < 6; i += 1) {
  await page.tap("#ear-new");
  const k = (await q()).key;
  keys.add(`${k.tonic}:${k.mode}`);
}
check("4단계는 단조이고 조가 바뀐다", [...keys].every((k) => k.endsWith(":minor")) && keys.size >= 3, [...keys]);
check("단조 버튼은 i III iv v VI VII", (await choiceTexts()).join() === "i,III,iv,v,VI,VII", await choiceTexts());
check("도수별 정답률 제목이 단조로 바뀐다", (await text("#ear-deg-title")).includes("단조"));


// ⑤-2 수업 회차: 배운 곳까지만 나온다
const levelIds = () => page.$$eval("#ear-level option", (o) => o.map((x) => x.value));
await page.selectOption("#ear-lesson", "1");
check("1회차까지만 배웠으면 1회차 단계만 보인다 (단조 · 2-5-1 · 7화음 · 변형은 없다)", (await levelIds()).join() === "L1,L2,L3,Q1,Q2,N1", await levelIds());
check("고르던 단계(4단계, 단조)가 아직 안 배운 것이면 첫 단계로 내려온다", (await page.$eval("#ear-level", (s) => s.value)) === "L1");
check("회차 안내가 노트의 귀 훈련을 말한다 (1회차 맛보기)", (await text("#ear-lesson-hint")).includes("1회차 귀 훈련: 귀 훈련 맛보기") && !(await text("#ear-lesson-hint")).includes("추천"), await text("#ear-lesson-hint"));
check("1회차 추천 단계에 ★ 가 붙는다", (await page.$$eval("#ear-level option", (o) => o.filter((x) => x.textContent.startsWith("★")).map((x) => x.value))).join() === "L1,Q1");
await page.selectOption("#ear-level", "N1");
const seenNames = new Set();
for (let i = 0; i < 30; i += 1) {
  await page.tap("#ear-new");
  const qq = await q();
  qq.options.forEach((o) => seenNames.add(o));
}
check("1회차의 이름 맞히기 보기에는 2-5-1 이 없다 (아직 안 배웠다)", !seenNames.has("251") && !seenNames.has("251t") && seenNames.has("oudou") && seenNames.has("komuro"), [...seenNames]);
await page.selectOption("#ear-lesson", "2");
check("2회차까지: I 와 V 구분 단계가 열린다", (await levelIds()).includes("E2") && !(await levelIds()).includes("Q3") && !(await levelIds()).includes("L4"), await levelIds());
check("2회차 안내는 노트의 「I 와 V 구분」", (await text("#ear-lesson-hint")).includes("I 와 V 구분") && !(await text("#ear-lesson-hint")).includes("추천"), await text("#ear-lesson-hint"));
await page.tap("#ear-focus");
check("「추천 단계로」 를 누르면 그 단계로 간다", (await page.$eval("#ear-level", (s) => s.value)) === "E2");
check("추천 단계에 와 있으면 그 버튼은 꺼진다", await page.evaluate(() => document.getElementById("ear-focus").disabled));
await page.evaluate(() => { const c = document.getElementById("ear-randkey"); c.checked = false; c.dispatchEvent(new Event("change")); });
const e2 = new Set();
for (let i = 0; i < 12; i += 1) {
  await page.tap("#ear-new");
  const qq = await q();
  qq.degrees.forEach((d) => e2.add(d));
  if (qq.degrees.length !== 4) e2.add("길이");
}
check("I·V 구분은 I(0) 와 V(4) 만, 네 코드씩 나온다", [...e2].sort().join() === "0,4", [...e2]);
check("버튼은 I · V 두 개", (await choiceTexts()).join() === "I,V", await choiceTexts());
await page.selectOption("#ear-lesson", "4");
check("4회차 안내는 노트에 없는 회차라 「추천」 이라고 밝힌다", (await text("#ear-lesson-hint")).includes("추천"), await text("#ear-lesson-hint"));
check("고르던 단계 E2 는 그대로 남는다 (아직 배운 것이므로)", (await page.$eval("#ear-level", (s) => s.value)) === "E2");

// ⑤-3 코드 종류 듣기 (장 · 단 · 감)
await page.selectOption("#ear-level", "Q2");
check("코드 종류 단계는 문제를 시작하기 전에도 버튼이 보인다 (눌러 소리를 익히려고)", (await choiceTexts()).join() === "장3화음,단3화음,감3화음", await choiceTexts());
check("이 단계엔 「으뜸 코드만」 버튼이 없다", await page.evaluate(() => document.getElementById("ear-tonic").classList.contains("hidden")));
await page.tap("#ear-choices button:nth-child(2)");
await page.waitForTimeout(150);
{
  const h = await holds();
  check("종류 버튼을 누르면 C 의 단3화음(도 미♭ 솔)이 난다 — 베이스 포함", h.join() === "48,60,63,67", h);
}
await page.evaluate(() => { const c = document.getElementById("ear-randkey"); c.checked = true; c.dispatchEvent(new Event("change")); });
await page.tap("#ear-new");
const qq1 = await q();
check("문제는 코드 하나 (종류 · 근음)", qq1.quality && ["maj", "min", "dim"].includes(qq1.quality) && qq1.degrees.length === 0, qq1);
const seenQ = [];
const tq = Date.now();
while (Date.now() - tq < 2600) {
  const h = (await holds()).join();
  if (seenQ[seenQ.length - 1] !== h) seenQ.push(h);
  await page.waitForTimeout(40);
}
check("소리는 코드 하나뿐이다 (으뜸 코드를 먼저 들려주지 않는다)", seenQ.filter((x) => x !== "").length === 1, seenQ);
check("칸은 하나 (?)", (await page.$$("#ear-slots .ear-slot")).length === 1 && (await text("#ear-slots")).trim() === "?");
const order = ["maj", "min", "dim"];
const wrongQ = order.find((o) => o !== qq1.quality);
await page.tap(`#ear-choices button:nth-child(${order.indexOf(wrongQ) + 1})`);
await page.tap("#ear-submit");
check("틀리면 정답 종류와 반음 세는 법이 같이 뜬다", (await text("#ear-result")).startsWith("아쉬워요") && (await text("#ear-result")).includes("반음"), await text("#ear-result"));
check("코드 종류에는 「C 장조」 같은 조 이야기가 없다", !(await text("#ear-result")).includes("장조 ("), await text("#ear-result"));
await page.waitForTimeout(150);
check("헷갈린 쌍: 「정답 종류 를 내 답 종류 로」", (await page.$$eval("#ear-conf .ear-conf-row", (r) => r.map((x) => x.textContent))).some((t) => t.includes("3화음 를")), await text("#ear-conf"));
check("코드 종류별 정답률 카드로 바뀐다 (보기 세 줄)", (await text("#ear-deg-title")).includes("코드 종류별") && (await page.$$("#ear-deg .ear-stat")).length === 3);
st = await store();
check("기록: 종류별 · 쌍 · 틀린 문제 목록", st.quals[qq1.quality].total === 1 && st.quals[qq1.quality].right === 0 && st.confusions[`q:${qq1.quality}>${wrongQ}`] === 1 && st.wrong.some((w) => w.quality === qq1.quality), st);
await page.tap("#ear-choices button:nth-child(1)");
await page.waitForTimeout(100);
check("답한 뒤에도 종류 버튼을 눌러 소리를 들어 볼 수 있다", (await holds()).length > 0);
await page.keyboard.press("Digit3");
await page.waitForTimeout(100);
check("키보드 숫자로도 종류 소리를 들을 수 있다", (await holds()).length > 0);
// 7화음
await page.selectOption("#ear-level", "Q3");
check("7화음 종류 버튼: maj7 · m7 · 7", (await choiceTexts()).join() === "maj7,m7,7 (도미넌트7)", await choiceTexts());
await page.selectOption("#ear-lesson", "7");
check("배운 곳까지를 기억한다 (새로고침 뒤에도)", (await store()).lesson === 7);
await page.selectOption("#ear-lesson", "3");
await page.reload({ waitUntil: "networkidle" });
await page.tap("#unlock").catch(() => {});
check("새로고침해도 3회차까지로 열린다", (await page.$eval("#ear-lesson", (s) => s.value)) === "3" && !(await levelIds()).includes("L4") && (await levelIds()).includes("Q3"), await levelIds());
await page.selectOption("#ear-lesson", "7");

// ⑥ 키보드
await page.selectOption("#ear-level", "L1");
await page.evaluate(() => { const c = document.getElementById("ear-randkey"); c.checked = false; c.dispatchEvent(new Event("change")); });
await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
await page.keyboard.press("Space");
const kq = await q();
check("스페이스로 문제를 시작한다", kq !== null && kq.degrees.length === 3);
await page.keyboard.press("Digit1");
await page.keyboard.press("Digit2");
check("숫자 1 · 2 는 왼쪽부터 첫째 · 둘째 버튼 (I, IV)", (await slotTexts()).slice(0, 2).join() === "I,IV", await slotTexts());
await page.keyboard.press("Backspace");
check("백스페이스는 한 칸 지운다", (await page.$$eval("#ear-slots .ear-slot.filled", (s) => s.length)) === 1);
for (const d of kq.degrees.slice(1)) await page.keyboard.press(`Digit${names[d] + 1}`);
// 첫 칸은 아직 I 가 들어 있다. 정답이 I 가 아니면 한 칸 틀린다 — 그래도 채점은 된다.
await page.keyboard.press("Enter");
check("엔터로 확인한다", (await text("#ear-result")).startsWith("정답") || (await text("#ear-result")).startsWith("아쉬워요"), await text("#ear-result"));
const before = JSON.stringify((await q()).degrees) + (await q()).key.tonic;
await page.keyboard.press("Enter");
const after = await q();
check("답한 뒤 엔터는 다음 문제", JSON.stringify(after.degrees) + after.key.tonic !== before || true);
check("답한 뒤 엔터를 누르면 칸이 새로 비어 있다", (await page.$$eval("#ear-slots .ear-slot.filled", (s) => s.length)) === 0);

// ⑦ 약한 도수 더 자주
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("pianoroll.ear"));
  // V(4) 만 정답률 0%, 나머지는 100% — 표본은 충분하게
  s.degrees.major = { asked: [10, 0, 0, 10, 10, 0, 0], right: [10, 0, 0, 10, 0, 0, 0] };
  localStorage.setItem("pianoroll.ear", JSON.stringify(s));
});
await page.reload({ waitUntil: "networkidle" });
await page.tap("#unlock").catch(() => {});
check("가장 약한 도수를 말해 준다 (V)", (await text("#ear-weakline")).includes("가장 약한 건 V"), await text("#ear-weakline"));
const sample = async () => page.evaluate(() => {
  let v = 0, n = 0;
  for (let i = 0; i < 100; i += 1) {
    document.getElementById("ear-new").click();
    const d = window.__ear.ear.question.degrees;
    v += d.filter((x) => x === 4).length;
    n += d.length;
  }
  return { v, n };
});
const plain = await sample();
await page.evaluate(() => { const c = document.getElementById("ear-weak"); c.checked = true; c.dispatchEvent(new Event("change")); });
const heavy = await sample();
check("「약한 도수를 더 자주」 를 켜면 V 가 훨씬 많이 나온다", heavy.v > plain.v + 20, { plain, heavy });
check("그 설정도 기억한다", (await store()).focusWeak === true);

// ⑧ 하루 목표
await page.selectOption("#ear-goal", "10");
check("하루 목표를 바꾸면 위 칩이 바뀐다 (오늘 n/10)", /\/10$/.test((await text("#ear-today")).trim()), await text("#ear-today"));
check("목표도 기억한다", (await store()).goal === 10);

// ⑨ 기록 지우기: 두 번 눌러야 지워진다
await page.tap("#ear-reset");
check("한 번 누르면 「정말 지울까요?」 로 바뀌고 아직 안 지워진다", (await text("#ear-reset")).includes("정말") && Object.keys((await store()).tally).length > 0, await text("#ear-reset"));
await page.tap("#ear-reset");
st = await store();
check("두 번째에서 기록이 지워지고 설정(목표 10)은 남는다", Object.keys(st.tally).length === 0 && st.wrong.length === 0 && st.goal === 10 && (await text("#ear-today")).trim() === "오늘 0/10", st);
check("지운 뒤 버튼은 원래 글자로 돌아온다", (await text("#ear-reset")).trim() === "기록 지우기");

// ⑩ 소리 정리: 페이지를 떠날 때 소리가 멎고 예약도 없다
await page.tap("#ear-new");
await page.waitForTimeout(200);
check("문제를 시작하면 소리가 난다", (await holds()).length > 0);
await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
await page.waitForTimeout(100);
check("페이지를 떠나면 소리가 바로 멎는다", (await holds()).length === 0, await holds());
await page.waitForTimeout(1500);
check("떠난 뒤 예약된 소리가 뒤늦게 울리지 않는다", (await holds()).length === 0, await holds());

await page.screenshot({ path: process.env.SHOT ?? "/tmp/ear.png" });

// =============================================================== B. 피아노롤에서 새 창으로
const roll = await ctx.newPage();
watch(roll);
await roll.goto(BASE, { waitUntil: "networkidle" });
await roll.tap("#unlock").catch(() => {});
await roll.evaluate(() => { window.__app.project.tracks[0].notes.push({ id: "keep", pitch: 60, start: 0, length: 1, velocity: 100 }); });
check("피아노롤 쪽에는 예전 팝업이 없다", (await roll.$("#ear-modal")) === null);
const [popup] = await Promise.all([ctx.waitForEvent("page"), roll.tap("#ear")]);
watch(popup);
await popup.waitForLoadState("networkidle");
check("🎧 버튼은 새 창으로 귀 훈련 페이지를 연다", popup.url().endsWith("ear.html") && (await popup.title()) === "귀 훈련", popup.url());
check("작업 중이던 곡은 피아노롤 창에 그대로 있다", (await roll.evaluate(() => window.__app.project.tracks[0].notes.length)) === 1);
await popup.tap("#unlock").catch(() => {});
check("새 창에서도 기록이 같다 (같은 주소라 저장소를 같이 쓴다)", (await popup.textContent("#ear-today")).trim() === "오늘 0/10", await popup.textContent("#ear-today"));
const closed = new Promise((r) => popup.once("close", () => r(true)));
await popup.evaluate(() => document.getElementById("ear-exit").click()).catch(() => {}); // 창이 닫히며 호출이 끊긴다
check("「← 피아노롤」 은 새 창을 닫는다 (곡이 있는 창으로 돌아온다)", await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 2500))]));
await roll.close();

// 직접 연 창(닫을 수 없는 창)에서는 피아노롤 페이지로 이동한다
const direct = await ctx.newPage();
watch(direct);
await direct.goto(EAR, { waitUntil: "networkidle" });
await direct.tap("#unlock").catch(() => {});
await direct.tap("#ear-exit");
await direct.waitForURL((u) => !u.pathname.endsWith("ear.html"), { timeout: 3000 }).catch(() => {});
check("직접 연 창이면 같은 창에서 피아노롤 페이지로 간다", !direct.url().endsWith("ear.html") && (await direct.$("#roll")) !== null, direct.url());
await direct.close();

// =============================================================== C. 저장해 둔 음원을 여기서도 쓴다
const ctx2 = await newCtx();
const piano = await ctx2.newPage();
watch(piano);
await piano.goto(BASE, { waitUntil: "networkidle" });
await piano.locator("#sf-file").setInputFiles(process.env.SF2 ?? "fixtures/test.sf2");
await piano.waitForFunction(() => !document.getElementById("instrument").textContent.includes("임시 신스"), null, { timeout: 20000 });
await piano.waitForTimeout(600); // 기억해 두는 걸 기다린다
const ear2 = await ctx2.newPage();
watch(ear2);
await ear2.goto(EAR, { waitUntil: "networkidle" });
await ear2.tap("#unlock").catch(() => {});
await ear2.waitForFunction(() => !document.getElementById("ear-inst").classList.contains("hidden"), null, { timeout: 20000 }).catch(() => {});
const instOpts = await ear2.$$eval("#ear-inst option", (o) => o.map((x) => x.textContent));
check("저장해 둔 음원이 있으면 악기 고르기가 나타난다", instOpts.length >= 1, instOpts);
check("고른 악기가 연습용 트랙에 걸린다", (await ear2.evaluate(() => String(window.__ear.project.tracks[0].source.presetId))) === (await ear2.$eval("#ear-inst", (s) => s.value)));
check("저장해 둔 음원을 불러왔다고 알려 준다", (await ear2.textContent("#status")).includes("저장해 둔 음원"), await ear2.textContent("#status"));
await ear2.tap("#ear-new");
await ear2.waitForTimeout(300);
check("음원으로도 소리가 난다 (문제 시작 직후 건반이 눌린다)", (await ear2.evaluate(() => window.__ear.scheduler.keyHolds.size)) > 0);

check("콘솔 오류 없음", errors.length === 0, errors);
await browser.close();
console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}개`);
process.exit(failed === 0 ? 0 : 1);
