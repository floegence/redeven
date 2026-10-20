import type { WebContents } from 'electron';
import { bindRuntimeFlowerStreamOwner } from './runtimeFlowerStreamOwner';
import { isRuntimeFlowerDetailRead, normalizeRuntimeFlowerReadID, type RuntimeFlowerRequest } from '../shared/runtimeFlowerIPC';
type Sender = Pick<WebContents, 'id' | 'on' | 'removeListener'>;

/** Cancellation belongs to one renderer document and never controls a command. */
export function createRuntimeFlowerReadOwner() {
  const reads = new Map<string, { controller: AbortController; release: () => void }>();
  const keyFor = (sender: Sender, document: string, id: string) => JSON.stringify([sender.id, document, id]);
  return {
    async run<T>(sender: Sender, request: RuntimeFlowerRequest, read: (signal?: AbortSignal) => Promise<T>, document: string): Promise<T> {
      if (request.read_id === undefined) return read();
      const id = normalizeRuntimeFlowerReadID(request.read_id);
      if (!id || !document || !isRuntimeFlowerDetailRead(request)) throw new Error('Invalid cancellable Flower detail read.');
      const key = keyFor(sender, document, id);
      if (reads.has(key)) throw new Error('Flower detail read identity is already active.');
      const controller = new AbortController();
      const operation = { controller, release: () => {} };
      reads.set(key, operation);
      operation.release = bindRuntimeFlowerStreamOwner(sender, () => controller.abort());
      try { return await read(controller.signal); }
      finally { operation.release(); if (reads.get(key) === operation) reads.delete(key); }
    },
    cancel(sender: Sender, raw: unknown, document: string) {
      const id = normalizeRuntimeFlowerReadID(raw);
      if (id) reads.get(keyFor(sender, document, id))?.controller.abort();
    },
    size: () => reads.size,
  };
}

/** Stop this wait, without cancelling shared Runtime preparation. */
export function awaitRuntimeFlowerRead<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException('Flower read was cancelled.', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    operation.then(value => { cleanup(); if (!signal.aborted) resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
  });
}
