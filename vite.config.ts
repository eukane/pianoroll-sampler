import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * `npm run dev`       → http, 이 컴퓨터에서 볼 때
 * `npm run dev:https` → https, **폰·패드에서 컴퓨터에 접속할 때**
 * `npm run build`     → dist/, 어딘가에 올려 두고 주소만 여는 용도
 *
 * 폰에서 컴퓨터로 붙으려면 https 여야 한다. AudioWorklet(사운드폰트 재생)이
 * 보안 컨텍스트에서만 동작하는데, `http://192.168.0.5:5173` 은 보안 컨텍스트가
 * 아니기 때문이다. localhost 만 예외로 인정받는다.
 *
 * base 를 두는 이유: GitHub Pages 는 `https://<계정>.github.io/<저장소>/` 처럼
 * **하위 경로**로 서빙한다. 이걸 안 맞추면 자바스크립트도 워크렛도 404 가 난다.
 * 나중에 루트 도메인에 올릴 수도 있으니 환경변수로 덮어쓸 수 있게 뒀다.
 *
 *     BASE_PATH=/ npm run build
 *
 * `vite preview` 는 command 가 "serve" 라서 조건을 build 로만 잡으면 base 가 안
 * 붙는다. 그러면 index.html 은 하위 경로를 가리키는데 서버는 루트로 내주어
 * 자바스크립트가 통째로 404 가 난다. 올리기 전 확인이 실제와 달라지므로
 * isPreview 도 같이 본다.
 */
const BASE = process.env.BASE_PATH ?? "/pianoroll-sampler/";

export default defineConfig(({ command, mode, isPreview }) => ({
  base: command === "build" || isPreview ? BASE : "/",
  plugins: mode === "https" ? [basicSsl()] : [],
  // 폰에서 열어 봐야 하는 앱이라 기본으로 0.0.0.0 에 바인드한다.
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: "es2020" },
}));
