/**
 * 뱅크와 프로그램을 presetId 하나로 묶고 푸는 곳.
 *
 * 모델의 `source.presetId` 가 숫자 하나라서 눌러 담아야 한다.
 * **오디오 계층에 두지 않는다** — MIDI 변환처럼 소리와 상관없는 코드도 이걸
 * 쓰는데, 거기서 샘플러 모듈을 끌어오면 브라우저 없이 테스트할 수가 없다.
 */

export function packPresetId(bankMSB: number, program: number): number {
  return bankMSB * 128 + program;
}

export function unpackPresetId(id: number): { bankMSB: number; program: number } {
  return { bankMSB: Math.floor(id / 128), program: id % 128 };
}
