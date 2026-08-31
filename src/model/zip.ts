/**
 * ZIP 안을 **필요한 것만** 꺼내 읽는다. 라이브러리 없이.
 *
 * 왜 필요한가. UTAU 음원은 폴더로 배포된다. 그런데 **폰에서 폴더를 고르는 건
 * 못 미더운 일이다** — 안드로이드 파일 선택기는 폴더 선택을 제대로 지원하지
 * 않는 경우가 많고, 지원해도 파일이 300개면 고르는 것 자체가 고역이다.
 * 받은 zip 을 그대로 넣게 하는 쪽이 폰에서는 압도적으로 낫다.
 *
 * ## 통째로 풀지 않는다
 *
 * 테토 약음원 zip 은 91MB 다. 통째로 풀면 폰 메모리가 그만큼 날아간다.
 * 그래서 **중앙 디렉터리만 먼저 읽어 목차를 만들고**, 실제 바이트는 부르는
 * 글자에 해당하는 파일만 그때그때 꺼낸다. `File.slice()` 가 디스크에서
 * 그 구간만 읽어 주므로 목차를 만드는 데는 몇 KB 면 된다.
 *
 * ## 압축 풀기
 *
 * `DecompressionStream("deflate-raw")` 가 브라우저에 들어 있다. 라이브러리를
 * 안 붙여도 된다는 뜻이고, 이 저장소가 의존성을 늘리지 않는 이유와 맞는다.
 *
 * ## 파일 이름
 *
 * 일본어 zip 은 이름이 **CP932(Shift-JIS)** 인 경우가 많다. UTF-8 로 읽으면
 * 「重音テト単独音」이 깨져서 폴더를 못 찾는다. 플래그 11번 비트가 UTF-8 을
 * 뜻하므로 그걸 보고 가른다.
 */

/** ZIP 안의 파일 하나. `read()` 를 부르기 전에는 바이트를 안 읽는다. */
export type ZipEntry = {
  /** zip 안의 경로 (폴더 구분은 `/`). */
  path: string;
  /** 파일 이름만. */
  name: string;
  /** 압축 푼 크기(바이트). */
  size: number;
  compression: number;
  /** 로컬 헤더 위치. 실제 데이터는 이 뒤에 있다. */
  headerOffset: number;
  compressedSize: number;
};

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
/** 끝에 붙는 주석까지 감안한 탐색 범위. 주석은 최대 64KB 다. */
const EOCD_SEARCH = 66 * 1024;

/**
 * 목차만 읽는다. 파일 바이트는 안 읽는다.
 *
 * zip 이 아니거나 형식이 낯설면 **null 을 돌려준다.** 던지지 않는 이유는
 * 부르는 쪽이 "zip 이 아니면 파일 목록으로 취급" 을 자연스럽게 하게 하려고다.
 */
export async function readZipIndex(file: Blob): Promise<ZipEntry[] | null> {
  if (file.size < 22) return null;

  const tailSize = Math.min(file.size, EOCD_SEARCH);
  const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());

  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = tail.getUint16(eocd + 10, true);
  const dirSize = tail.getUint32(eocd + 12, true);
  const dirOffset = tail.getUint32(eocd + 16, true);
  // ZIP64 는 여기에 0xffffffff 가 들어온다. 4GB 넘는 음원은 없으니 안 다룬다.
  if (dirOffset === 0xffffffff || dirOffset + dirSize > file.size) return null;

  const dir = new DataView(await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  const bytes = new Uint8Array(dir.buffer);
  const entries: ZipEntry[] = [];

  let at = 0;
  for (let i = 0; i < count && at + 46 <= dir.byteLength; i += 1) {
    if (dir.getUint32(at, true) !== CENTRAL_SIG) break;
    const flags = dir.getUint16(at + 8, true);
    const compression = dir.getUint16(at + 10, true);
    const compressedSize = dir.getUint32(at + 20, true);
    const size = dir.getUint32(at + 24, true);
    const nameLen = dir.getUint16(at + 28, true);
    const extraLen = dir.getUint16(at + 30, true);
    const commentLen = dir.getUint16(at + 32, true);
    const headerOffset = dir.getUint32(at + 42, true);

    const raw = bytes.subarray(at + 46, at + 46 + nameLen);
    // 플래그 11번 비트가 서면 UTF-8, 아니면 일본어 zip 은 대개 CP932 다.
    const label = (flags & 0x800) !== 0 ? "utf-8" : "shift_jis";
    const path = new TextDecoder(label).decode(raw);

    if (!path.endsWith("/")) {
      entries.push({
        path,
        name: path.split("/").pop() ?? path,
        size,
        compression,
        headerOffset,
        compressedSize,
      });
    }
    at += 46 + nameLen + extraLen + commentLen;
  }

  return entries.length > 0 ? entries : null;
}

/**
 * 파일 하나를 꺼낸다. 이때 처음으로 그 구간을 디스크에서 읽는다.
 *
 * 로컬 헤더의 이름·부가정보 길이는 중앙 디렉터리와 다를 수 있어서, 데이터가
 * 어디서 시작하는지는 **로컬 헤더를 직접 보고** 정한다. 이걸 중앙 쪽 값으로
 * 때우면 어떤 zip 에서는 몇 바이트씩 밀린 소리가 나온다.
 */
export async function readZipEntry(file: Blob, entry: ZipEntry): Promise<ArrayBuffer | null> {
  const head = new DataView(await file.slice(entry.headerOffset, entry.headerOffset + 30).arrayBuffer());
  if (head.byteLength < 30 || head.getUint32(0, true) !== 0x04034b50) return null;
  const nameLen = head.getUint16(26, true);
  const extraLen = head.getUint16(28, true);
  const start = entry.headerOffset + 30 + nameLen + extraLen;
  const raw = await file.slice(start, start + entry.compressedSize).arrayBuffer();

  if (entry.compression === 0) return raw; // 압축 안 함
  if (entry.compression !== 8) return null; // deflate 말고는 안 다룬다

  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).arrayBuffer();
}

/** zip 안에서 찾아낸 음원 하나. 폴더 하나 = 음원 하나다. */
export type ZipVoiceBank = {
  /** zip 안의 폴더 경로. 최상위면 빈 문자열. */
  dir: string;
  /** 사람에게 보여 줄 이름 (폴더 이름). */
  name: string;
  oto: ZipEntry;
  /** 파일 이름 → 자리. oto.ini 가 파일을 이름만으로 가리키므로 열쇠도 이름이다. */
  files: Map<string, ZipEntry>;
};

/**
 * zip 목차에서 음원 폴더들을 골라낸다.
 *
 * 배포되는 음원 zip 은 폴더가 여럿인 경우가 흔하다 — 테토 약음원 하나에
 * 단독음과 연속음이 같이 들어 있다. **oto.ini 가 있는 폴더마다 음원 하나**로
 * 보고 전부 돌려준다. 고르는 건 사람이 한다.
 *
 * 맥에서 만든 zip 에 붙는 `__MACOSX` 는 실제 파일이 아니라 부가정보라 버린다.
 */
export function findVoiceBanks(entries: ZipEntry[]): ZipVoiceBank[] {
  const banks: ZipVoiceBank[] = [];
  const real = entries.filter((e) => !e.path.startsWith("__MACOSX/") && !e.name.startsWith("._"));

  for (const oto of real) {
    if (oto.name.toLowerCase() !== "oto.ini") continue;
    const dir = oto.path.slice(0, oto.path.length - oto.name.length);
    const files = new Map<string, ZipEntry>();
    for (const e of real) {
      if (e.path.slice(0, e.path.length - e.name.length) !== dir) continue;
      if (!/\.(wav|frq)$/i.test(e.name)) continue;
      files.set(e.name, e);
    }
    if (files.size === 0) continue;
    const name = dir.replace(/\/$/, "").split("/").pop() || "노래 음원";
    banks.push({ dir, name, oto, files });
  }

  // 소리가 많은 것부터. 첫 줄에 오는 게 대개 사람이 찾던 음원이다.
  banks.sort((a, b) => b.files.size - a.files.size);
  return banks;
}
