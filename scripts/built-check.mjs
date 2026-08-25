/**
 * **빌드된 결과물**이 실제로 도는지 확인한다.
 *
 * 개발 서버에서 도는 것과 올려 둔 파일이 도는 것은 다른 얘기다. 차이가 나는
 * 지점이 실제로 있다.
 *   · 하위 경로(`/pianoroll-sampler/`)로 서빙된다 — 경로 하나만 어긋나도 백지가 뜬다
 *   · 워크렛 파일이 정적 파일로 같이 올라가 있어야 한다
 *   · 개발용 창구(`window.__app`)가 없다 — 그래서 **화면만 보고** 확인한다
 *
 * 화면만 쓴다는 게 오히려 낫다. 사용자가 실제로 겪는 경로 그대로이기 때문이다.
 *
 *     npm run build && npm run built-check
 */

import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

/**
 * 포트를 미리 정해 두면 안 된다. 그 포트가 이미 쓰이고 있으면 vite 는 조용히
 * 다른 포트로 옮겨 가는데, 그러면 **낡은 서버에 붙어서** 확인이 거짓이 된다.
 * 실제로 그것 때문에 한참 헤맸다. 서버가 찍어 주는 주소를 그대로 읽는다.
 */
const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
});
const stop = () => server.kill("SIGTERM");
process.on("exit", stop);

const URL = await new Promise((resolve, reject) => {
  let buffer = "";
  const timer = setTimeout(() => reject(new Error("미리보기 서버가 주소를 안 알려 줍니다")), 20000);
  const onData = (chunk) => {
    buffer += chunk.toString();
    const m = /(http:\/\/127\.0\.0\.1:\d+\/\S*)/.exec(buffer);
    if (m) {
      clearTimeout(timer);
      resolve(m[1].replace(/\u001b\[[0-9;]*m/g, ""));
    }
  };
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
});
console.log(`미리보기: ${URL}\n`);

const launch = { args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--no-proxy-server"] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
// 갤럭시 탭 크기로 본다 — 실제로 쓰는 기기가 패드다.
const context = await browser.newContext({ ...devices["Galaxy Tab S4"], acceptDownloads: true });
const page = await context.newPage();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
const failed = [];
page.on("requestfailed", (r) => failed.push(`${r.url()} — ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.url()} — ${r.status()}`); });

await page.goto(URL, { waitUntil: "networkidle" });

check("하위 경로에서 화면이 뜬다", await page.locator("#roll").isVisible());
check("404 나는 파일이 없다", failed.length === 0, failed);

// 개발용 창구가 빌드에 섞여 나가지 않았는가
check(
  "개발용 디버그 창구는 빌드에 없다",
  await page.evaluate(() => typeof window.__app === "undefined"),
);

await page.locator("#unlock").tap();
await page.waitForTimeout(400);
check("탭하면 소리가 켜진다", await page.locator("#unlock").evaluate((el) => el.classList.contains("hidden")));

// 노트 찍기
const box = await page.locator("#roll").boundingBox();
for (const [dx, ratio] of [[120, 0.45], [200, 0.4], [280, 0.5]]) {
  await page.touchscreen.tap(box.x + dx, box.y + box.height * ratio);
  await page.waitForTimeout(90);
}

// 사운드폰트 — 여기서 워크렛 경로가 틀리면 터진다
await page.locator("#sf-file").setInputFiles("fixtures/test.sf2");
await page.waitForFunction(
  () => (document.getElementById("instrument")?.textContent ?? "").includes("Acoustic"),
  null,
  { timeout: 20000 },
);
check("올려 둔 워크렛으로 사운드폰트가 열린다", true,
  await page.locator("#instrument").textContent());

// 악기 교체 — 두 번 탭
await page.locator("#instrument").click();
await page.waitForTimeout(200);
await page.locator("#preset-search").fill("sax");
await page.waitForTimeout(200);
await page.locator("#preset-list .preset", { hasText: "Alto Sax" }).click();
await page.waitForTimeout(300);
check(
  "두 번 탭으로 악기가 바뀐다",
  (await page.locator("#instrument").textContent())?.includes("Alto Sax"),
);

// WAV 내보내기 — 오프라인 렌더까지 전부 통과해야 나온다
await page.locator("#export").click();
await page.waitForTimeout(200);
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 90000 }),
  page.locator("#save-wav").click(),
]);
const bytes = readFileSync(await download.path());
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
let loudest = 0;
for (let i = 44; i + 1 < bytes.length; i += 2) loudest = Math.max(loudest, Math.abs(view.getInt16(i, true)));
check(
  "WAV 가 나오고 소리가 들어 있다",
  String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && loudest > 200,
  { name: download.suggestedFilename(), kb: Math.round(bytes.length / 1024), loudest },
);

check("콘솔 오류 없음", errors.length === 0, errors);

await browser.close();
stop();

let bad = 0;
for (const r of results) {
  if (!r.ok) bad += 1;
  console.log(`${r.ok ? "✅" : "❌"} ${r.name}${r.ok || r.detail === undefined ? "" : "  " + JSON.stringify(r.detail)}`);
}
console.log(bad === 0 ? `\n올려도 되는 상태입니다 (${results.length}개 통과)` : `\n실패 ${bad}개`);
process.exit(bad === 0 ? 0 : 1);
