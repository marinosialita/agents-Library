// The files people attach, kept as they are (12 Nov 2026, his «the right panel should be identical to the document I
// uploaded, not a wall of text»): the chat keeps the text the agent reads; this keeps the original file in the
// browser's own database (IndexedDB), by the document's id, so the right panel can show the real pages. Nothing here
// leaves the browser. Any failure (private window, full storage) only means the panel falls back to the text.
const DB = 'agents-files', STORE = 'files';
export const FILE_KEEP_BYTES = 40_000_000;
export type KeptFile = { name: string; type: string; blob: Blob };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function keepFile(id: string, file: File): Promise<void> {
  if (file.size > FILE_KEEP_BYTES) return;
  try { await run('readwrite', store => store.put({ name: file.name, type: file.type, blob: file } satisfies KeptFile, id)); } catch { /* the text view stays */ }
}
export async function keptFile(id: string): Promise<KeptFile | null> {
  try { const found = await run<KeptFile>('readonly', store => store.get(id)); return found?.blob ? found : null; } catch { return null; }
}
export async function forgetFile(id: string): Promise<void> { try { await run('readwrite', store => store.delete(id)); } catch { /* nothing kept */ } }
