import { describe, expect, it, vi } from 'vitest';
import type { DownloadCommand, DownloadSink, PreparedDownloadSink, RuntimeDownloadSource } from './types';
import { createDownloadManager } from './createDownloadManager';

function runtimeFileCommand(path = '/workspace/app.log'): DownloadCommand {
  return {
    entryKind: 'file',
    origin: 'file_browser_context_menu',
    preferredName: 'app.log',
    source: {
      kind: 'runtime_file',
      path,
      name: 'app.log',
      size: 6,
    },
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 20; i += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushAsync();
    }
  }
  throw lastError;
}

function createMemorySink() {
  const writes: number[] = [];
  const abort = vi.fn(async () => undefined);
  const complete = vi.fn(async () => ({
    label: 'app.log',
    detail: '/tmp/app.log',
    canReveal: true,
    canOpen: true,
  }));
  const prepared: PreparedDownloadSink = {
    destination: {
      label: 'app.log',
      detail: '/tmp/app.log',
      canReveal: true,
      canOpen: true,
    },
    write: async (chunk) => {
      writes.push(chunk.byteLength);
    },
    complete,
    abort,
  };
  const sink: DownloadSink = {
    kind: 'web_file_system',
    prepare: vi.fn(async () => prepared),
  };
  return { sink, writes, abort, complete };
}

describe('createDownloadManager', () => {
  it('streams source chunks into the selected sink while publishing progress', async () => {
    const { sink, writes, complete } = createMemorySink();
    const source: RuntimeDownloadSource = {
      open: vi.fn(async () => ({
        totalBytes: 6,
        chunks: (async function* chunks() {
          yield new Uint8Array([1, 2]);
          yield new Uint8Array([3, 4, 5, 6]);
        })(),
      })),
    };
    let now = 1_000;
    const manager = createDownloadManager({
      source,
      sink,
      now: () => {
        now += 500;
        return now;
      },
      createId: () => 'download-1',
    });

    const id = manager.enqueue(runtimeFileCommand());

    await waitFor(() => {
      expect(manager.getTask(id)?.status).toBe('completed');
    });

    expect(writes).toEqual([2, 4]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(manager.getTask(id)).toMatchObject({
      bytesRead: 6,
      totalBytes: 6,
      progressRatio: 1,
      cancelable: false,
    });
  });

  it('aborts the prepared sink when the user cancels an active task', async () => {
    const gate = deferred<void>();
    const { sink, abort } = createMemorySink();
    const source: RuntimeDownloadSource = {
      open: vi.fn(async () => ({
        totalBytes: 4,
        chunks: (async function* chunks() {
          yield new Uint8Array([1, 2]);
          await gate.promise;
          yield new Uint8Array([3, 4]);
        })(),
      })),
    };
    const manager = createDownloadManager({
      source,
      sink,
      createId: () => 'download-cancel',
    });

    const id = manager.enqueue(runtimeFileCommand());
    await waitFor(() => {
      expect(manager.getTask(id)?.bytesRead).toBe(2);
    });

    manager.cancel(id);
    gate.resolve();

    await waitFor(() => {
      expect(manager.getTask(id)?.status).toBe('canceled');
    });
    expect(abort).toHaveBeenCalledWith('canceled');
  });

  it('keeps failed tasks retryable through the original command', async () => {
    const { sink } = createMemorySink();
    const source: RuntimeDownloadSource = {
      open: vi.fn()
        .mockRejectedValueOnce(new Error('Runtime is offline.'))
        .mockResolvedValueOnce({
          totalBytes: 1,
          chunks: (async function* chunks() {
            yield new Uint8Array([1]);
          })(),
        }),
    };
    let idSeq = 0;
    const manager = createDownloadManager({
      source,
      sink,
      createId: () => `download-${++idSeq}`,
    });

    const firstId = manager.enqueue(runtimeFileCommand('/workspace/offline.log'));
    await waitFor(() => {
      expect(manager.getTask(firstId)?.status).toBe('failed');
    });

    const retryId = manager.retry(firstId);
    expect(retryId).toBe('download-2');
    await waitFor(() => {
      expect(manager.getTask('download-2')?.status).toBe('completed');
    });
    expect(source.open).toHaveBeenCalledTimes(2);
    expect(source.open).toHaveBeenLastCalledWith(runtimeFileCommand('/workspace/offline.log'), expect.any(AbortSignal));
  });
});
