import { defineConfig } from "vite";

export default defineConfig({
  // 폰에서 열어 봐야 하는 앱이라 기본으로 0.0.0.0 에 바인드한다.
  // (npm run dev 하면 같은 와이파이의 폰에서 접속할 주소가 같이 찍힌다)
  server: { host: true, port: 5173 },
  build: { target: "es2020" },
});
