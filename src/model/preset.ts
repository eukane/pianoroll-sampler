/**
 * 뱅크와 프로그램을 presetId 하나로 묶고 푸는 곳.
 *
 * 모델의 `source.presetId` 가 숫자 하나라서 눌러 담아야 한다.
 * **오디오 계층에 두지 않는다** — MIDI 변환처럼 소리와 상관없는 코드도 이걸
 * 쓰는데, 거기서 샘플러 모듈을 끌어오면 브라우저 없이 테스트할 수가 없다.
 *
 * ## 드럼을 128번 뱅크로 담는 이유
 *
 * 드럼 킷은 뱅크·프로그램 번호가 **일반 악기와 그대로 겹친다.** GeneralUser GS
 * 를 넣어 보고 알았다.
 *
 *     0:0  Grand Piano
 *     0:0  Standard 1      ← 드럼 킷인데 번호가 똑같다
 *
 * 뱅크와 프로그램만으로 담으면 둘이 같은 id 가 되어, 목록에서 드럼을 골라도
 * 피아노가 걸린다. **화면이 거짓말을 하는 셈이다.**
 *
 * 실제 뱅크 MSB 는 0~127 이라 128 은 절대 나오지 않는다. 드럼을 거기 담으면
 * 겹칠 일이 없고, 마침 128 은 SF2 에서 드럼 뱅크로 쓰는 관례 번호이기도 하다.
 */

/**
 * 드럼 표시를 얹는 자리. 뱅크(0~127) × 프로그램(0~127) 위쪽 비트다.
 *
 * 드럼을 그냥 "128번 뱅크" 로 담았다가 한 번 더 걸렸다. GeneralUser GS 는
 * 드럼 킷이 26개인데 그것들도 **뱅크가 여럿**이라, 뱅크를 뭉개니 드럼끼리
 * 13개가 겹쳤다. 드럼 여부와 뱅크는 서로 다른 정보라 각자 자리를 줘야 한다.
 */
const DRUM_FLAG = 128 * 128;

export function packPresetId(bankMSB: number, program: number, isDrum = false): number {
  return (isDrum ? DRUM_FLAG : 0) + bankMSB * 128 + program;
}

export function unpackPresetId(id: number): { bankMSB: number; program: number; isDrum: boolean } {
  const isDrum = id >= DRUM_FLAG;
  const rest = isDrum ? id - DRUM_FLAG : id;
  return { bankMSB: Math.floor(rest / 128) % 128, program: rest % 128, isDrum };
}

export function isDrumPreset(id: number): boolean {
  return id >= DRUM_FLAG;
}

/** presetId 가 가질 수 있는 최댓값. 파일에서 읽을 때 범위 검사에 쓴다. */
export const MAX_PRESET_ID = DRUM_FLAG * 2 - 1;
