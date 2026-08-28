/**
 * 예제 곡 목록.
 *
 * 곡이 하나뿐일 때는 버튼도 하나면 됐다. 둘이 되면서 **어느 곡인지 고르는
 * 자리**가 필요해졌는데, 목록을 여기 한 곳에 두면 화면 쪽(ui/exportPanel.ts)은
 * 이 배열을 훑어 버튼을 만들기만 한다. 셋째 곡을 넣을 때 고칠 파일이 하나다.
 *
 * `needsDrums` 는 사운드폰트 없이 열었을 때 알려 주려고 둔다. 드럼은 음원이
 * 없으면 낮은 톱니파 웅웅거림이 될 뿐인데, 아무 말도 없으면 사용자는 앱이
 * 고장 난 줄 안다.
 */

import type { Project } from "./types";
import { demoSong } from "./demoSong.ts";
import { edmSong } from "./demoEdm.ts";

export type Demo = {
  id: string;
  /** 버튼에 크게 뜨는 이름. */
  title: string;
  /** 그 아래 한 줄 설명. */
  hint: string;
  needsDrums: boolean;
  make: () => Project;
};

export const DEMOS: Demo[] = [
  {
    id: "gugak",
    title: "🎵 예제 곡 · 국악풍",
    hint: "8마디 · 3트랙 — 악기를 바꿔 보라고 넣어 뒀다",
    needsDrums: false,
    make: demoSong,
  },
  {
    id: "edm",
    title: "🎛 예제 곡 · 일렉트로닉",
    hint: "16마디 · 5트랙 — 인트로에서 드롭까지. 드럼이 들어 있다",
    needsDrums: true,
    make: edmSong,
  },
];
