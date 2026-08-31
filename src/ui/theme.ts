/** 화면 치수·색. 폰 기준으로 잡았다. */

export const GUTTER = 46; // 왼쪽 건반 폭
/**
 * 위쪽 마디 눈금 높이.
 *
 * 26px 이었는데 손가락으로 재생 위치를 잡기가 어려웠다. 손끝이 닿는 면적이
 * 보통 40px 언저리라 26px 짜리 띠는 조준해서 눌러야 한다. 36px 로 올렸다.
 */
export const RULER = 36;

/** 재생 헤드 손잡이를 잡았다고 볼 거리(px). 손가락 굵기를 감안한 값. */
export const PLAYHEAD_GRAB = 26;

export const MIN_PX_PER_BEAT = 18;
export const MAX_PX_PER_BEAT = 320;
export const MIN_KEY_HEIGHT = 10;
export const MAX_KEY_HEIGHT = 40;

/** 터치로 잡을 수 있는 최소 크기. 손가락은 마우스보다 훨씬 굵다. */
export const EDGE_GRAB = 20;
export const TAP_SLOP = 8; // 이만큼 움직이면 탭이 아니라 드래그
export const TAP_MS = 400;

/**
 * 빈 격자를 눌렀을 때 소리를 내기까지 기다리는 시간(ms).
 *
 * 0 으로 두면 확대·화면 밀기에도 소리가 난다. 핀치는 손가락 하나가 닿는 것으로
 * 시작하기 때문이다. 이 사이에 두 번째 손가락이 오거나 손가락이 움직이면
 * 취소한다.
 *
 * 왼쪽 건반을 누르는 건 이 지연이 없다. 거기서는 확대도 밀기도 안 하니
 * 기다릴 이유가 없다.
 */
export const PREVIEW_DELAY = 45;

export const C = {
  bg: "#12141a",
  rowWhite: "#181b22",
  rowBlack: "#14161c",
  lineSub: "#20242e",
  lineBeat: "#2b3140",
  lineBar: "#454e63",
  note: "#4ec9b0",
  noteOther: "#7f8ba3",
  noteEdge: "#8ff0dc",
  noteActive: "#ffd479",
  text: "#e6e9ef",
  dim: "#8b95a8",
  ruler: "#1a1d25",
  playhead: "#ff6b6b",
  loop: "rgba(120, 160, 255, 0.13)",
  loopEdge: "#6f8fff",
  // 고르기 상자. 루프와 색을 갈랐다 — 둘 다 파랗게 두면 무엇을 잡았는지 모른다.
  selectBox: "rgba(255, 212, 121, 0.16)",
  selectEdge: "#ffd479",
  keyWhite: "#e8eaf0",
  keyBlack: "#2a2f3a",
  keyLine: "#0d0f14",
};
