/**
 * 화면에서 1cm 가 몇 px(브라우저 단위) 인가.
 *
 * 연주 건반을 **실제 피아노 크기**(흰 건반 폭 2.3cm)로 그리려면 이 값이 필요한데,
 * 브라우저는 알려 주지 않는다. CSS 의 `1cm` 는 「96px = 1인치」 라는 약속일 뿐이라
 * 폰·패드에서는 실제 길이와 한참 다르다.
 *
 * 그래서 **기기의 실제 화면 길이**로 계산한다.
 *
 *     1cm 의 px = 화면 긴 변의 px ÷ 화면 긴 변의 실제 길이(cm)
 *
 * 기본값은 이 앱을 주로 쓰는 **뮤패드 K10 PLUS** 다. 제조사 사양이 2000×1200,
 * 10.4인치라서
 *
 *     대각선 √(2000² + 1200²) ≈ 2332 픽셀 → 1인치에 2332 ÷ 10.4 ≈ 224 픽셀
 *     긴 변 2000 ÷ 224 ≈ 8.92인치 ≈ 22.65cm
 *
 * **브라우저가 화면 폭을 정말 그대로 알려 주는지는 그 기기에서만 확인할 수 있다.**
 * 그래서 숫자를 믿고 끝내지 않고, 5cm 막대를 띄워 자로 대 보게 한다. 다르면
 * 거기서 맞춘다. 다른 기기라면 그 기기의 화면 길이를 넣으면 된다.
 *
 * 맞춘 값은 **이 기기의 브라우저에만** 남긴다(localStorage). 곡이 아니라 기기의
 * 성질이라 프로젝트 파일에 넣으면 안 된다 — 패드에서 맞춘 값이 폰에서 열린다.
 * 못 읽으면(사생활 보호 창 등) 기본값으로 돈다.
 */

/** 뮤패드 K10 PLUS 화면 긴 변의 실제 길이(cm). 위 주석의 계산. */
export const DEFAULT_SCREEN_CM = 22.65;

/** 실제 피아노 흰 건반의 폭(cm). 일반 어쿠스틱 피아노 기준. */
export const WHITE_KEY_CM = 2.3;

const STORE = "pianoroll.pxPerCm";

/** 화면 긴 변(px). 가로·세로를 돌려도 같은 값이어야 해서 긴 쪽을 쓴다. */
export function screenLongSidePx(): number {
  const w = window.screen?.width ?? window.innerWidth;
  const h = window.screen?.height ?? window.innerHeight;
  return Math.max(w, h, 1);
}

export function defaultPxPerCm(screenCm = DEFAULT_SCREEN_CM): number {
  return screenLongSidePx() / screenCm;
}

/** 말이 되는 값인가. 1cm 가 10px 도 안 되거나 200px 를 넘는 화면은 없다. */
export function plausible(pxPerCm: number): boolean {
  return Number.isFinite(pxPerCm) && pxPerCm >= 10 && pxPerCm <= 200;
}

export type Calibration = {
  pxPerCm: number;
  /** 사용자가 맞춘 값인가 (아니면 뮤패드 기준으로 계산한 값). */
  custom: boolean;
};

export function loadCalibration(): Calibration {
  try {
    const raw = window.localStorage.getItem(STORE);
    const v = raw === null ? NaN : Number(raw);
    if (plausible(v)) return { pxPerCm: v, custom: true };
  } catch {
    // 저장소를 못 쓰는 창이다. 기본값으로 간다.
  }
  return { pxPerCm: defaultPxPerCm(), custom: false };
}

/** 저장에 실패해도 이번 화면에서는 그 값으로 돈다. 실패했는지만 돌려준다. */
export function saveCalibration(pxPerCm: number): boolean {
  try {
    window.localStorage.setItem(STORE, String(pxPerCm));
    return true;
  } catch {
    return false;
  }
}

export function clearCalibration(): void {
  try {
    window.localStorage.removeItem(STORE);
  } catch {
    // 지울 게 없으면 그만이다.
  }
}
