import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * `npm run dev`      → http, 이 컴퓨터에서 볼 때
 * `npm run dev:https` → https, **폰에서 접속할 때**
 *
 * 폰에서 컴퓨터로 붙으려면 https 여야 한다. AudioWorklet(사운드폰트 재생)이
 * 보안 컨텍스트에서만 동작하는데, `http://192.168.0.5:5173` 은 보안 컨텍스트가
 * 아니기 때문이다. localhost 만 예외로 인정받는다.
 *
 * 인증서는 그 자리에서 만든 것이라 브라우저가 "안전하지 않다" 고 경고한다.
 * 내 컴퓨터에 내가 붙는 것이니 `고급 → 계속` 을 누르면 된다.
 */
export default defineConfig(({ mode }) => ({
  plugins: mode === "https" ? [basicSsl()] : [],
  // 폰에서 열어 봐야 하는 앱이라 기본으로 0.0.0.0 에 바인드한다.
  // (npm run dev 하면 같은 와이파이의 폰에서 접속할 주소가 같이 찍힌다)
  server: { host: true, port: 5173 },
  build: { target: "es2020" },
}));
