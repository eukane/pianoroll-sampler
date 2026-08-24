/**
 * spessasynth 의 AudioWorklet 프로세서를 public/ 으로 복사한다.
 *
 * `audioWorklet.addModule()` 은 번들러의 모듈 해석을 거치지 않고 **페이지 기준
 * URL** 을 요구한다. 그래서 node_modules 에서 import 할 수가 없고, 정적 파일로
 * 내보내 줘야 한다.
 *
 * 손으로 복사해 두면 npm update 후에 프로세서만 옛 버전으로 남는다(라이브러리
 * 문서도 이 점을 경고한다). dev·build 전에 매번 복사해서 항상 짝을 맞춘다.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve("spessasynth_lib/package.json"));
const from = join(pkg, "dist", "spessasynth_processor.min.js");
const to = join(process.cwd(), "public", "spessasynth_processor.min.js");

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log(`워크렛 복사: ${from} → ${to}`);
