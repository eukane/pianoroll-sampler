/**
 * UTAU 주파수표(`*.frq`) 읽기 — **파일마다 실제로 녹음된 음정.**
 *
 * 왜 필요한가. 처음에는 음원 전체가 한 음으로 녹음돼 있다고 보고 상수 하나를
 * 썼다(측정값 MIDI 63). 그걸로 「かさねてと」를 불러 보니 「さ」만 반음 낮게
 * 나왔다. 파일별로 재 보니 이랬다.
 *
 *     _あ  62.92        _ね  62.78
 *     _か  63.03        _て  62.69
 *     _さ  62.06  ←     _と  62.86
 *
 * 사람이 부른 녹음이라 음절마다 조금씩 다르다. 「さ」는 거의 반음 낮다.
 * 한 값으로 뭉뚱그리면 그 글자만 음정이 틀린다 — 노래에서는 바로 티가 난다.
 *
 * 다행히 UTAU 음원에는 WAV 마다 `.frq` 가 같이 들어 있고, 그 머리에 **평균
 * 주파수**가 적혀 있다. 그걸 쓰면 파일마다 정확히 맞출 수 있다.
 *
 * 형식 (FREQ0003):
 *
 *     0  ~ 8   "FREQ0003"
 *     8  ~ 12  int32   몇 샘플마다 한 값인가 (보통 256)
 *     12 ~ 20  double  **평균 주파수(Hz)** ← 우리가 쓰는 값
 *     20 ~ 36  16바이트 메모
 *     36 ~ 40  int32   항목 수
 *     그 뒤     항목마다 double 주파수 + double 진폭
 *
 * 파일 크기가 `40 + 항목수 × 16` 과 맞는지로 형식을 확인한다. 실제 테토 음원
 * 142개가 전부 맞았다.
 *
 * 이름 규칙: `_あ.wav` → `_あ_wav.frq`
 */

const TAG = "FREQ0003";
const HEADER = 40;
const ENTRY = 16;

/** WAV 파일명에 대응하는 주파수표 파일명. */
export function frqNameFor(wavName: string): string {
  return `${wavName.replace(/\.wav$/i, "")}_wav.frq`;
}

/**
 * 주파수표에서 평균 주파수(Hz)를 읽는다. 형식이 아니면 null.
 *
 * 없어도 노래는 나와야 한다 — 음원에 따라 frq 가 아예 없기도 하다.
 * 그때는 부르는 쪽이 기본값으로 떨어진다.
 */
export function readFrqAverage(bytes: ArrayBuffer): number | null {
  if (bytes.byteLength < HEADER) return null;
  const view = new DataView(bytes);
  for (let i = 0; i < TAG.length; i += 1) {
    if (view.getUint8(i) !== TAG.charCodeAt(i)) return null;
  }
  const count = view.getInt32(36, true);
  // 크기가 안 맞으면 다른 형식이거나 깨진 파일이다. 믿고 쓰면 엉뚱한 음이 된다.
  if (count < 0 || HEADER + count * ENTRY !== bytes.byteLength) return null;

  const average = view.getFloat64(12, true);
  // 사람 목소리 범위를 벗어나면 안 믿는다.
  return Number.isFinite(average) && average > 40 && average < 2000 ? average : null;
}

/** 주파수(Hz) → MIDI 음 번호(소수 허용). */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}
