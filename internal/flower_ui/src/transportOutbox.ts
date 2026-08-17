import type { FlowerRuntimeCurrentView, FlowerTurnLaunchInput } from './contracts/flowerSurfaceContracts';

export type TransportOutboxInput = FlowerTurnLaunchInput;

export type TransportOutboxEntry = Readonly<{
  requestId: string;
  threadId: string;
  input: TransportOutboxInput;
  attachmentLabels: readonly string[];
  createdAtMs: number;
  /** A durable terminal state that must not be retried automatically. */
  terminalError?: 'attachments_unavailable_after_restart';
}>;

export type TransportOutbox = Readonly<{
  entries: ReadonlyMap<string, TransportOutboxEntry>;
  put(entry: TransportOutboxEntry): TransportOutbox;
  assignThread(requestId: string, threadId: string): TransportOutbox;
  dropThread(threadId: string): TransportOutbox;
  drop(requestId: string): TransportOutbox;
  pruneExpired(nowMs?: number): TransportOutbox;
  confirm(current: FlowerRuntimeCurrentView): TransportOutbox;
  forThread(threadId: string): readonly TransportOutboxEntry[];
}>;

const OUTBOX_DB = 'redeven-flower-transport';
const OUTBOX_STORE = 'outbox';
const OUTBOX_DB_VERSION = 1;
const OUTBOX_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function openOutboxDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OUTBOX_DB, OUTBOX_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        database.createObjectStore(OUTBOX_STORE, { keyPath: 'requestId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Flower transport outbox is unavailable.'));
  });
}

async function persistEntries(entries: ReadonlyMap<string, TransportOutboxEntry>): Promise<void> {
  const database = await openOutboxDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OUTBOX_STORE, 'readwrite');
    const store = transaction.objectStore(OUTBOX_STORE);
    store.clear();
    for (const entry of entries.values()) store.put(entry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Flower transport outbox write failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Flower transport outbox write was aborted.'));
  });
  database.close();
}

function durableEntry(entry: TransportOutboxEntry): TransportOutboxEntry {
  const { staging_scope: _stagingScope, ...durableInput } = entry.input;
  return {
    ...entry,
    input: durableInput,
  };
}

let persistenceTail = Promise.resolve();

function persist(entries: ReadonlyMap<string, TransportOutboxEntry>): void {
  const durable = new Map([...entries].map(([id, entry]) => [id, durableEntry(entry)]));
  persistenceTail = persistenceTail.then(() => persistEntries(durable)).catch(() => undefined);
}

function create(entries: ReadonlyMap<string, TransportOutboxEntry>): TransportOutbox {
  return {
    entries,
    put(entry) {
      const requestId = clean(entry.requestId);
      if (!requestId) return this;
      const next = new Map(entries);
      next.set(requestId, {
        ...entry,
        requestId,
        threadId: clean(entry.threadId),
        input: { ...entry.input, client_request_id: requestId },
        attachmentLabels: entry.attachmentLabels.map(clean).filter(Boolean),
        terminalError: entry.terminalError === 'attachments_unavailable_after_restart'
          ? entry.terminalError
          : undefined,
      });
      persist(next);
      return create(next);
    },
    assignThread(requestId, threadId) {
      const id = clean(requestId);
      const target = clean(threadId);
      const entry = entries.get(id);
      if (!entry || !target || entry.threadId === target) return this;
      const next = new Map(entries);
      next.set(id, { ...entry, threadId: target, input: { ...entry.input, thread_id: target } });
      persist(next);
      return create(next);
    },
    dropThread(threadId) {
      const id = clean(threadId);
      if (!id) return this;
      const next = new Map([...entries].filter(([, entry]) => entry.threadId !== id));
      if (next.size === entries.size) return this;
      persist(next);
      return create(next);
    },
    drop(requestId) {
      const id = clean(requestId);
      if (!id || !entries.has(id)) return this;
      const next = new Map(entries);
      next.delete(id);
      persist(next);
      return create(next);
    },
    pruneExpired(nowMs = Date.now()) {
      const cutoff = Number.isFinite(nowMs) ? nowMs - OUTBOX_ENTRY_TTL_MS : Date.now() - OUTBOX_ENTRY_TTL_MS;
      const next = new Map([...entries].filter(([, entry]) => Number.isFinite(entry.createdAtMs) && entry.createdAtMs >= cutoff));
      if (next.size === entries.size) return this;
      persist(next);
      return create(next);
    },
    confirm(current) {
      const threadId = clean(current.thread_id);
      if (!threadId || entries.size === 0) return this;
      const confirmed = new Set<string>();
      for (const item of current.items ?? []) {
        if (item.kind !== 'user') continue;
        const id = clean(item.id);
        if (id.startsWith('user:')) confirmed.add(id.slice('user:'.length));
      }
      for (const queued of current.queue ?? []) confirmed.add(clean(queued.request_key));
      if (confirmed.size === 0) return this;
      const next = new Map(entries);
      for (const requestId of confirmed) {
        if (next.get(requestId)?.threadId === threadId) next.delete(requestId);
      }
      if (next.size === entries.size) return this;
      persist(next);
      return create(next);
    },
    forThread(threadId) {
      const id = clean(threadId);
      return [...entries.values()].filter((entry) => entry.threadId === id);
    },
  };
}

export function createTransportOutbox(): TransportOutbox {
  return create(new Map());
}

export async function restoreTransportOutbox(): Promise<TransportOutbox> {
  const database = await openOutboxDatabase();
  if (!database) return createTransportOutbox();
  const entries = await new Promise<TransportOutboxEntry[]>((resolve, reject) => {
    const request = database.transaction(OUTBOX_STORE, 'readonly').objectStore(OUTBOX_STORE).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error ?? new Error('Flower transport outbox read failed.'));
  });
  database.close();
  const restored = new Map<string, TransportOutboxEntry>();
  for (const entry of entries) {
    const requestId = clean(entry.requestId);
    if (!requestId) continue;
    const legacy = entry as TransportOutboxEntry & { text?: unknown; attachmentNames?: unknown };
    const input = entry.input && typeof entry.input === 'object'
      ? { ...entry.input, client_request_id: requestId }
      : { client_request_id: requestId, thread_id: clean(entry.threadId) || undefined, prompt: String(legacy.text ?? '') };
    restored.set(requestId, {
      ...entry,
      requestId,
      threadId: clean(entry.threadId),
      input,
      attachmentLabels: Array.isArray(entry.attachmentLabels)
        ? entry.attachmentLabels.map(clean).filter(Boolean)
        : Array.isArray(legacy.attachmentNames) ? legacy.attachmentNames.map(clean).filter(Boolean) : [],
      terminalError: entry.terminalError === 'attachments_unavailable_after_restart' ? entry.terminalError : (
        (Array.isArray(input.attachment_ids) && input.attachment_ids.length > 0)
          ? 'attachments_unavailable_after_restart'
          : undefined
      ),
    });
  }
  return create(restored).pruneExpired();
}
