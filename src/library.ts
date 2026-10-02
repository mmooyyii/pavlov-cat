import type { TargetTrack } from './music';
import { t } from './i18n';

// Score library backed by IndexedDB. A folder picked through
// showDirectoryPicker is stored as an index only — one file handle per score,
// no content — and a score is read and parsed the first time it's opened;
// the parsed track is then cached on the entry. Picks that come as plain File
// objects (multi-file pick, webkitdirectory) can't be re-read after a reload,
// so those are parsed up front and stored with their track.

export interface ScoreEntry {
  id: string;        // path inside the picked folder — unique and human-readable
  title: string;
  track?: TargetTrack;               // absent until a lazily indexed score is first opened
  handle?: FileSystemFileHandle;     // where to read it from, for folder-indexed scores
  xml?: string;                      // source MusicXML, kept for drawing the staff
  builtin?: boolean;                 // shipped sample — not in IndexedDB, not deletable
  addedAt: number;
}

const DB_NAME = 'pavlov-cat';
const DB_VERSION = 1;
const STORE = 'scores';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(t('err.dbOpen')));
  });
  return dbPromise;
}

// Sorted by title so the picker reads like a song list. Chinese titles sort by
// pinyin, which is what a zh-CN user expects.
export async function scoresAll(): Promise<ScoreEntry[]> {
  const db = await openDb();
  const all = await new Promise<ScoreEntry[]>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as ScoreEntry[]);
    req.onerror = () => reject(req.error ?? new Error(t('err.dbRead')));
  });
  return all.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
}

// One transaction for the whole batch: a folder import is all-or-nothing.
export async function scoresPut(entries: readonly ScoreEntry[]): Promise<void> {
  if (!entries.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const e of entries) store.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(t('err.dbWrite')));
    tx.onabort = () => reject(tx.error ?? new Error(t('err.dbAbort')));
  });
}

// Re-indexing a folder: write the fresh index and drop what vanished from disk
// in one transaction, so the tree never shows a half-updated folder.
export async function scoresReplace(put: readonly ScoreEntry[], del: readonly string[]): Promise<void> {
  if (!put.length && !del.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of del) store.delete(id);
    for (const e of put) store.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(t('err.dbWrite')));
    tx.onabort = () => reject(tx.error ?? new Error(t('err.dbAbort')));
  });
}

export async function scoresDelete(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(t('err.dbDelete')));
  });
}

export async function scoresClear(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(t('err.dbClear')));
  });
}
