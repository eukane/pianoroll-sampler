/**
 * 마지막으로 넣은 사운드폰트를 브라우저(IndexedDB)에 기억해 두었다가
 * 앱을 열 때 자동으로 다시 불러온다.
 *
 * 저장소(깃)에 .sf2 를 넣지 않는 이유는 .gitignore 에 적어 둔 그대로다 —
 * 음원은 사용자가 직접 넣는 구조고, 30MB 짜리를 기록에 영원히 남기고 싶지
 * 않다. 대신 한 번만 넣으면 이 기기에서는 계속 기억한다.
 *
 * 실패해도 앱은 멀쩡해야 한다. 사생활 보호 모드나 저장 공간 부족으로
 * IndexedDB 가 막혀 있을 수 있어서 모든 함수는 던지지 않고 결과로 알려 준다.
 */

const DB_NAME = "pianoroll-sampler";
const STORE = "kv";
const KEY = "soundfont";

export type SavedSoundfont = { file: File; savedAt: number };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 를 열 수 없습니다"));
  });
}

function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = work(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("저장소 오류"));
        };
      }),
  );
}

/** 저장. 성공하면 null, 실패하면 사람이 읽을 이유를 돌려준다. */
export async function saveSoundfont(file: File): Promise<string | null> {
  try {
    if (typeof indexedDB === "undefined") return "이 브라우저는 저장소를 지원하지 않습니다";
    // 브라우저가 공간이 모자랄 때 먼저 지워 버리지 않도록 부탁해 둔다. 거절돼도 저장은 한다.
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* 무시 */
    }
    await run("readwrite", (s) => s.put({ file, savedAt: Date.now() } satisfies SavedSoundfont, KEY));
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export async function loadSavedSoundfont(): Promise<SavedSoundfont | null> {
  try {
    if (typeof indexedDB === "undefined") return null;
    const v = await run<SavedSoundfont | undefined>("readonly", (s) => s.get(KEY));
    if (!v || !(v.file instanceof Blob)) return null;
    return v;
  } catch {
    return null;
  }
}

export async function forgetSoundfont(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    /* 이미 없거나 막혀 있으면 지울 것도 없다 */
  }
}
