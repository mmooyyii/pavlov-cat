import type { TargetTrack } from './music';
import { t } from './i18n';

// Score library backed by IndexedDB. Importing a folder brings in dozens of
// scores at once — more than localStorage should hold, and re-parsing every
// file on each page load would be wasteful — so the parsed tracks are kept
// here and the score picker is populated from them.

export interface ScoreEntry {
  id: string;        // path inside the picked folder — unique and human-readable
  title: string;
  track: TargetTrack;
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
