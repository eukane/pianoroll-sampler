/**
 * zip 읽기 점검. **브라우저 없이 돈다.**
 *
 * 이 검사가 지키는 것은 하나다 — **받은 zip 을 안 풀고 읽을 수 있는가.**
 * 사용자의 폰이 테토 음원 zip 을 못 풀었고("폴더에 문제가 있다"), 원인이
 * 파일 이름의 CP932 인코딩이었다. 그래서 검사도 CP932 이름 zip 으로 한다.
 *
 *     node scripts/gen-voicebank.mjs && node scripts/gen-voicezip.mjs
 *     node scripts/zip-test.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { readZipIndex, readZipEntry, findVoiceBanks } from "../src/model/zip.ts";
import { parseOto } from "../src/model/oto.ts";
import { DIR, makeZip, voiceFiles } from "./gen-voicezip.mjs";

const out = [];
let bad = 0;

function check(label, ok, detail = "") {
  out.push(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) bad += 1;
}

const blobOf = (path) => new Blob([readFileSync(path)]);

for (const [label, path] of [
  ["CP932 이름", "fixtures/voice-cp932.zip"],
  ["UTF-8 이름", "fixtures/voice-utf8.zip"],
]) {
  if (!existsSync(path)) {
    check(`${label} zip 준비`, false, `${path} 없음 — node scripts/gen-voicezip.mjs`);
    continue;
  }
  const blob = blobOf(path);
  const entries = await readZipIndex(blob);
  check(`${label}: 목차를 읽는다`, entries !== null && entries.length === 13, `${entries?.length}개`);
  if (!entries) continue;

  // 이름이 깨지면 여기서 걸린다. 사용자의 압축 프로그램이 멈춘 바로 그 지점.
  const wav = entries.find((e) => e.name === "_あ.wav");
  check(`${label}: 일본어 이름이 그대로다`, !!wav, wav?.path ?? entries[0].path);

  const banks = findVoiceBanks(entries);
  check(`${label}: 음원 폴더를 하나 찾는다`, banks.length === 1, `${banks.length}개`);
  check(`${label}: 폴더 이름이 음원 이름이 된다`, banks[0]?.name === DIR, banks[0]?.name);
  // oto.ini 는 wav·frq 목록에서 빠져야 한다 (12개 = wav 5 + frq 5 + …).
  check(`${label}: 소리 파일만 모은다`, banks[0]?.files.size === 12, `${banks[0]?.files.size}개`);

  const otoBytes = await readZipEntry(blob, banks[0].oto);
  const oto = parseOto(new TextDecoder("shift_jis").decode(otoBytes));
  check(`${label}: oto.ini 를 꺼내 읽는다`, oto.entries.length > 0, `${oto.entries.length}줄`);

  // 압축 방식 두 가지를 다 지난다 — 실물 zip 은 섞여 있다.
  const original = new Map(voiceFiles().map((f) => [f.path.split("/").pop(), f.data]));
  for (const name of ["_あ.wav", "_か.wav", "_あ_wav.frq"]) {
    const entry = banks[0].files.get(name);
    const got = entry ? new Uint8Array(await readZipEntry(blob, entry)) : null;
    const want = original.get(name);
    const same = got !== null && want.length === got.length && Buffer.compare(want, Buffer.from(got)) === 0;
    check(`${label}: ${name} 바이트가 원본과 같다`, same, `${got?.length ?? "못 꺼냄"}/${want.length}`);
  }
}

// zip 이 아닌 것을 넣으면 던지지 말고 null 을 줘야 한다. 부르는 쪽이
// "zip 이 아니면 다른 길" 을 자연스럽게 고르게 하려고 그렇게 정했다.
check("zip 이 아니면 null", (await readZipIndex(new Blob([Buffer.alloc(500, 7)]))) === null);
check("빈 파일도 null", (await readZipIndex(new Blob([]))) === null);

// 뒤에 주석이 붙은 zip. 실물에서 흔하고, 끝에서 EOCD 를 거꾸로 찾는 이유다.
{
  const base = makeZip([{ path: "音/oto.ini", data: Buffer.from("_あ.wav=あ,0,0,-500,0,0\n", "utf8") }]);
  const withComment = Buffer.concat([base, Buffer.from("주석" .repeat(200), "utf8")]);
  withComment.writeUInt16LE(Buffer.byteLength("주석".repeat(200), "utf8"), base.length - 2);
  const entries = await readZipIndex(new Blob([withComment]));
  check("끝에 주석이 붙어도 읽는다", entries !== null && entries.length === 1, `${entries?.length}`);
}

// 폴더가 여럿인 zip (실물 약음원이 단독음·연속음을 같이 담고 있다).
{
  const zip = makeZip([
    { path: "テト/単独音/oto.ini", data: Buffer.from("a.wav=あ,0,0,-500,0,0\n") },
    { path: "テト/単独音/a.wav", data: Buffer.alloc(10) },
    { path: "テト/連続音/oto.ini", data: Buffer.from("b.wav=- あ,0,0,-500,0,0\n") },
    { path: "テト/連続音/b.wav", data: Buffer.alloc(10) },
    { path: "テト/連続音/c.wav", data: Buffer.alloc(10) },
    { path: "__MACOSX/テト/._oto.ini", data: Buffer.alloc(10) },
    { path: "テト/readme.txt", data: Buffer.alloc(10) },
  ]);
  const banks = findVoiceBanks(await readZipIndex(new Blob([zip])));
  check("음원이 여럿이면 전부 찾는다", banks.length === 2, banks.map((b) => b.name).join(", "));
  check("큰 것이 먼저 온다", banks[0]?.name === "連続音", banks[0]?.name);
  check("맥 부가정보는 버린다", !banks.some((b) => b.dir.startsWith("__MACOSX")));
  check("읽을 수 없는 파일은 안 담는다", banks[1]?.files.size === 1, `${banks[1]?.files.size}개`);
}

console.log(out.join("\n"));
console.log(bad === 0 ? "\n전부 통과" : `\n${bad}개 실패`);
process.exit(bad === 0 ? 0 : 1);
