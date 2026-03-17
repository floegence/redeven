// Markdown worker client — renders markdown to HTML off the main thread.
//
// This module owns a single shared Web Worker instance and a simple request/response
// multiplexer. Callers can throttle/coalesce requests on their side.

import type { MarkdownRenderSnapshot, MarkdownWorkerRequest, MarkdownWorkerResponse } from '../types';

type PendingRequest = {
  resolve: (snapshot: MarkdownRenderSnapshot) => void;
  reject: (err: Error) => void;
};

let worker: Worker | null = null;
let workerInitError: string | null = null;
let nextReqId = 0;
const pending = new Map<string, PendingRequest>();

function rejectAllPending(err: Error): void {
  for (const [, entry] of pending) {
    try {
      entry.reject(err);
    } catch {
      // ignore
    }
  }
  pending.clear();
}

function resetWorker(err?: unknown): void {
  try {
    worker?.terminate();
  } catch {
    // ignore
  }
  worker = null;

  if (err) {
    const msg = err instanceof Error ? err.message : String(err);
    workerInitError = msg || 'Markdown worker failed.';
  }

  rejectAllPending(new Error(workerInitError || 'Markdown worker failed.'));
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (workerInitError) return null;

  if (typeof Worker === 'undefined') {
    workerInitError = 'Web Worker is not available in this environment.';
    return null;
  }

  try {
    const w = new Worker(new URL('./markdown.worker.ts', import.meta.url), {
      type: 'module',
    });

    w.onmessage = (ev: MessageEvent<MarkdownWorkerResponse>) => {
      const data = ev.data;
      const id = String((data as any)?.id ?? '').trim();
      if (!id) return;

      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);

      const error = String((data as any)?.error ?? '').trim();
      if (error) {
        entry.reject(new Error(error));
        return;
      }

      const snapshot = (data as MarkdownWorkerResponse).snapshot;
      if (!snapshot) {
        entry.reject(new Error('Markdown worker returned an empty snapshot.'));
        return;
      }

      entry.resolve(snapshot);
    };

    w.onerror = (err) => {
      resetWorker(err);
    };

    w.onmessageerror = (err) => {
      resetWorker(err);
    };

    worker = w;
    return worker;
  } catch (err) {
    workerInitError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/**
 * Render markdown to a streaming snapshot in a shared Web Worker.
 *
 * Notes:
 * - Callers should throttle/coalesce requests to avoid flooding the worker.
 * - The returned promise resolves even when markdown is empty.
 */
export function renderMarkdownSnapshot(
  markdown: string,
  options?: { streaming?: boolean },
): Promise<MarkdownRenderSnapshot> {
  const w = ensureWorker();
  if (!w) {
    return Promise.reject(
      new Error(workerInitError || 'Markdown worker is unavailable.'),
    );
  }

  const id = `md_${++nextReqId}_${Date.now()}`;
  const req: MarkdownWorkerRequest = {
    id,
    content: String(markdown ?? ''),
    streaming: options?.streaming === true,
  };

  return new Promise<MarkdownRenderSnapshot>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage(req);
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
