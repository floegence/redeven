import type { CodeDiffRenderModel, DiffWorkerRequest, DiffWorkerResponse } from '../types';
import { computeCodeDiffModel } from '../diff/diffModel';

type PendingDiffRequest = Readonly<{
  resolve: (model: CodeDiffRenderModel) => void;
  reject: (error: Error) => void;
}>;

const MAX_CACHE_SIZE = 80;

let worker: Worker | null = null;
let workerInitError: string | null = null;
let nextRequestId = 0;
const pending = new Map<string, PendingDiffRequest>();
const cache = new Map<string, CodeDiffRenderModel>();

function hashString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cacheKey(oldCode: string, newCode: string): string {
  return `${oldCode.length}:${newCode.length}:${hashString(oldCode)}:${hashString(newCode)}`;
}

function cacheSet(key: string, value: CodeDiffRenderModel): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
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
  rejectAllPending(new Error(workerInitError || 'Diff worker failed.'));
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (workerInitError) return null;
  if (typeof Worker === 'undefined') {
    workerInitError = 'Web Worker is not available in this environment.';
    return null;
  }

  try {
    const nextWorker = new Worker(new URL('./diff.worker.ts', import.meta.url), {
      type: 'module',
    });

    nextWorker.onmessage = (event: MessageEvent<DiffWorkerResponse | { type: 'ready' }>) => {
      if ('type' in event.data && event.data.type === 'ready') {
        return;
      }

      const data = event.data as DiffWorkerResponse;
      const id = String(data.id ?? '').trim();
      if (!id) return;

      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);

      if (data.error) {
        request.reject(new Error(data.error));
        return;
      }
      request.resolve(data.model);
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

export function hasDiffWorkerSupport(): boolean {
  return typeof Worker !== 'undefined';
}

export function renderCodeDiffModelSync(oldCode: string, newCode: string): CodeDiffRenderModel {
  const key = cacheKey(oldCode, newCode);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const model = computeCodeDiffModel(oldCode, newCode);
  cacheSet(key, model);
  return model;
}

export function renderCodeDiffModel(oldCode: string, newCode: string): Promise<CodeDiffRenderModel> {
  const key = cacheKey(oldCode, newCode);
  const cached = cache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  const nextWorker = ensureWorker();
  if (!nextWorker) {
    return Promise.reject(new Error(workerInitError || 'Diff worker is unavailable.'));
  }

  const id = `diff_${++nextRequestId}_${Date.now()}`;
  const request: DiffWorkerRequest = {
    id,
    oldCode,
    newCode,
  };

  return new Promise<CodeDiffRenderModel>((resolve, reject) => {
    pending.set(id, {
      resolve: (model) => {
        cacheSet(key, model);
        resolve(model);
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
