/** 화면 치수·색. 폰 기준으로 잡았다. */

export const GUTTER = 46; // 왼쪽 건반 폭
export const RULER = 26; // 위쪽 마디 눈금 높이

export const MIN_PX_PER_BEAT = 18;
export const MAX_PX_PER_BEAT = 320;
export const MIN_KEY_HEIGHT = 10;
export const MAX_KEY_HEIGHT = 40;

/** 터치로 잡을 수 있는 최소 크기. 손가락은 마우스보다 훨씬 굵다. */
export const EDGE_GRAB = 20;
export const TAP_SLOP = 8; // 이만큼 움직이면 탭이 아니라 드래그
export const TAP_MS = 400;
export const LONG_PRESS_MS = 480;

export const C = {
  bg: "#12141a",
  rowWhite: "#181b22",
  rowBlack: "#14161c",
  lineSub: "#20242e",
  lineBeat: "#2b3140",
  lineBar: "#454e63",
  note: "#4ec9b0",
  noteEdge: "#8ff0dc",
  noteActive: "#ffd479",
  text: "#e6e9ef",
  dim: "#8b95a8",
  ruler: "#1a1d25",
  playhead: "#ff6b6b",
  loop: "rgba(120, 160, 255, 0.13)",
  loopEdge: "#6f8fff",
  keyWhite: "#e8eaf0",
  keyBlack: "#2a2f3a",
  keyLine: "#0d0f14",
};
