/**
 * 사운드폰트 기억 검사 — 한 번 넣으면 다시 열 때 알아서 올라오는가.
 *
 *   npm run dev &  →  npm run persist
 *
 * smoke.mjs 는 "음원 없는 상태" 를 전제하고 곳곳에서 새로고침하므로 기억을
 * 일부러 지워 두고 돈다. 그래서 이 기능은 여기서 따로 본다.
 */
import { chromium } from "playwright";

const URL = process.env.SMOKE_URL ?? "http://127.0.0.1:5173/";
const SF = process.env.SF2 ?? "fixtures/test.sf2";
const launchOptions = { args: ["--autoplay-policy=no-user-gesture-required"] };
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const browser = await chromium.launch(launchOptions);
const errors = [];
const watch = (p) => {
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
};
const label = (p) => p.evaluate(() => document.getElementById("instrument").textContent);
const status = (p) => p.evaluate(() => document.getElementById("status")?.textContent ?? "");
const hasFont = (p) =>
  p.waitForFunction(() => !document.getElementById("instrument").textContent.includes("임시 신스"), null, {
    timeout: 20000,
  }).then(() => true, () => false);

// ① 처음 쓰는 기기: 조용해야 한다
const ctx = await browser.newContext();
const page = await ctx.newPage();
watch(page);
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
check("처음 열면 임시 신스이고 아무 말도 안 한다", (await label(page)).includes("임시 신스") &&
  (await page.evaluate(() => document.getElementById("status").classList.contains("hidden"))));

// ② 넣으면 기억했다고 알려 준다
await page.locator("#sf-file").setInputFiles(SF);
check("음원을 넣으면 올라온다", await hasFont(page), await label(page));
await page.waitForTimeout(500);
const st = await status(page);
check("「다음부터 자동으로 불러옵니다」 라고 알려 준다", st.includes("다음부터 자동"), st);
const name = await label(page);

// ③ 새로고침: 알아서 올라와야 한다
await page.reload({ waitUntil: "networkidle" });
check("새로고침하면 같은 악기로 알아서 올라온다", (await hasFont(page)) && (await label(page)) === name, await label(page));
check("저장해 둔 음원이라고 알려 준다", (await status(page)).includes("저장해 둔 음원"), await status(page));

// ④ 다른 기기(새 컨텍스트)에는 영향이 없다
const other = await (await browser.newContext()).newPage();
watch(other);
await other.goto(URL, { waitUntil: "networkidle" });
await other.waitForTimeout(1000);
check("기억은 그 브라우저 안에서만 있다", (await label(other)).includes("임시 신스"), await label(other));

// ⑤ 기억이 깨져 있어도 앱은 열린다
await page.evaluate(
  () =>
    new Promise((resolve) => {
      const r = indexedDB.open("pianoroll-sampler", 1);
      r.onsuccess = () => {
        const tx = r.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put({ file: "not a blob" }, "soundfont");
        tx.oncomplete = () => resolve();
      };
    }),
);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
check("저장된 값이 이상해도 임시 신스로 멀쩡히 열린다", (await label(page)).includes("임시 신스"), await label(page));

check("콘솔 오류 없음", errors.length === 0, errors);
await browser.close();
console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}개`);
process.exit(failed === 0 ? 0 : 1);
