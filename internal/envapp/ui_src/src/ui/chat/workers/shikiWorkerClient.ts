import type { ShikiWorkerRequest, ShikiWorkerResponse } from '../types';

type PendingShikiRequest = Readonly<{
  resolve: (html: string) => void;
  reject: (error: Error) => void;
}>;

const MAX_CACHE_SIZE = 240;

let worker: Worker | null = null;
let workerInitError: string | null = null;
let nextRequestId = 0;
const pending = new Map<string, PendingShikiRequest>();
const cache = new Map<string, string>();

function hashString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cacheKey(code: string, language: string, theme: string): string {
  return `${theme}:${language}:${code.length}:${hashString(code)}`;
}

function cacheSet(key: string, html: string): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, html);
}

function rejectAllPending(error: Error): void {
  for (const [, request] of pending) {
    request.reject(error);
  }
  pending.clear();
}

function resetWorker(error?: unknown): void {
  try {
    worker?.terminate();
  } catch {
    // Ignore worker termination failures.
  }

  worker = null;
  if (error) {
    workerInitError = error instanceof Error ? error.message : String(error);
  }
  rejectAllPending(new Error(workerInitError || 'Shiki worker failed.'));
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (workerInitError) return null;
  if (typeof Worker === 'undefined') {
    workerInitError = 'Web Worker is not available in this environment.';
    return null;
  }

  try {
    const nextWorker = new Worker(new URL('./shiki.worker.ts', import.meta.url), {
      type: 'module',
    });

    nextWorker.onmessage = (event: MessageEvent<ShikiWorkerResponse | { type: 'ready' }>) => {
      if ('type' in event.data && event.data.type === 'ready') {
        return;
      }

      const data = event.data as ShikiWorkerResponse;
      const id = String(data.id ?? '').trim();
      if (!id) return;

      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);

      if (data.error) {
        request.reject(new Error(data.error));
        return;
      }
      request.resolve(data.html);
    };

    nextWorker.onerror = (error) => {
      resetWorker(error);
    };

    nextWorker.onmessageerror = (error) => {
      resetWorker(error);
    };

    worker = nextWorker;
    return worker;
  } catch (error) {
    workerInitError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

export function hasShikiWorkerSupport(): boolean {
  return typeof Worker !== 'undefined';
}

export function highlightCodeToHtmlInWorker(code: string, language: string, theme: string): Promise<string> {
  const key = cacheKey(code, language, theme);
  const cached = cache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  const nextWorker = ensureWorker();
  if (!nextWorker) {
    return Promise.reject(new Error(workerInitError || 'Shiki worker is unavailable.'));
  }

  const id = `shiki_${++nextRequestId}_${Date.now()}`;
  const request: ShikiWorkerRequest = {
    id,
    code,
    language,
    theme,
  };

  return new Promise<string>((resolve, reject) => {
    pending.set(id, {
      resolve: (html) => {
        cacheSet(key, html);
        resolve(html);
      },
      reject,
    });

    try {
      nextWorker.postMessage(request);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
