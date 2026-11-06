import type { FlowerComposerRestartDraft } from '../../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';

// Only canonical, authority-free restart snapshots enter this local cache. The
// server must authorize the product draft before callers read its opaque key.
const databaseName = 'redeven-plugin-composer';
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
    request.onsuccess = () => resolve(request.result);
  });
  return database;
}
async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const request = operation(tx.objectStore('drafts'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error ?? new Error('Draft storage transaction was interrupted'));
  });
}
export const loadPluginComposer = (id: string) =>
  transact<FlowerComposerRestartDraft | undefined>('readonly', (store) => store.get(id));
export async function savePluginComposer(id: string, snapshot: FlowerComposerRestartDraft): Promise<void> {
  if (snapshot.files.reduce((sum, item) => sum + item.file.size, 0) > 64 * 1024 * 1024)
    throw new Error('Unsent plugin attachments exceed the 64 MiB local draft limit.');
  await transact('readwrite', (store) => store.put(snapshot, id));
}
export async function removePluginComposer(id: string): Promise<void> {
  await transact('readwrite', (store) => {
    store.delete(id);
    return store.delete(`comment:${id}`);
  });
}

// Comments retain text only. A restored draft must select a fresh live target.
export const loadPluginComment = (id: string) => transact<string | undefined>('readonly', store => store.get(`comment:${id}`));
export async function savePluginComment(id: string, text: string): Promise<void> {
  if (text) await transact('readwrite', store => store.put(text.slice(0, 4000), `comment:${id}`));
  else await transact('readwrite', store => store.delete(`comment:${id}`));
}

export type PluginDraftRestartSnapshot = Readonly<{
  id: string;
  composer?: FlowerComposerRestartDraft;
  comment?: string;
}>;

// Desktop replaces both the private origin and its session storage on restart.
// Transfer user-authored cache entries through the existing bounded handoff;
// a restored cache entry still requires server authorization before use.
export async function capturePluginDraftsForRestart(): Promise<readonly PluginDraftRestartSnapshot[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly');
    const store = tx.objectStore('drafts');
    const keys = store.getAllKeys();
    const values = store.getAll();
    tx.oncomplete = () => {
      const entries = new Map<string, { id: string; composer?: FlowerComposerRestartDraft; comment?: string }>();
      keys.result.forEach((key, index) => {
        const name = String(key), comment = name.startsWith('comment:');
        const id = comment ? name.slice('comment:'.length) : name;
        const entry = entries.get(id) ?? { id };
        if (comment) entry.comment = values.result[index];
        else entry.composer = values.result[index];
        entries.set(id, entry);
      });
      resolve([...entries.values()]);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Draft storage transaction was interrupted'));
  });
}

export async function restorePluginDraftsAfterRestart(entries: readonly PluginDraftRestartSnapshot[]): Promise<void> {
  if (!entries.length) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    for (const entry of entries) {
      if (entry.composer) store.put(entry.composer, entry.id);
      if (entry.comment) store.put(entry.comment, `comment:${entry.id}`);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Draft storage transaction was interrupted'));
  });
}
