import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTransportOutbox } from './transportOutbox';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TransportOutbox', () => {
  it('keeps only raw input until the typed current view confirms its request id', () => {
    let outbox = createTransportOutbox().put({
      requestId: 'request-1',
      threadId: 'thread-a',
      input: { client_request_id: 'request-1', thread_id: 'thread-a', prompt: 'hello' },
      attachmentLabels: ['notes.md'],
      createdAtMs: 10,
    });

    expect(outbox.entries.get('request-1')?.input.prompt).toBe('hello');
    outbox = outbox.confirm({
      thread_id: 'thread-a',
      view_version: 2,
      items: [{ id: 'user:request-1', ordinal: 1, kind: 'user', text: 'hello' }],
    });
    expect(outbox.entries.has('request-1')).toBe(false);
  });

  it('moves a new-thread request to the canonical thread without changing its identity', () => {
    const pending = createTransportOutbox().put({
      requestId: 'req-new',
      threadId: '__new_thread__',
      input: { client_request_id: 'req-new', prompt: 'hello' },
      attachmentLabels: [],
      createdAtMs: 1,
    });

    const assigned = pending.assignThread('req-new', 'thread-created');

    expect(assigned.forThread('__new_thread__')).toEqual([]);
    expect(assigned.forThread('thread-created')).toEqual([
      expect.objectContaining({ requestId: 'req-new', input: expect.objectContaining({ prompt: 'hello' }) }),
    ]);
  });

  it('confirms a busy send from the canonical queue without modeling queue state', () => {
    let outbox = createTransportOutbox().put({
      requestId: 'request-queued', threadId: 'thread-a', input: { client_request_id: 'request-queued', thread_id: 'thread-a', prompt: 'later' }, attachmentLabels: [], createdAtMs: 10,
    });
    outbox = outbox.confirm({
      thread_id: 'thread-a', view_version: 3,
      queue: [{ id: 'queue:request-queued', request_key: 'request-queued', input: { text: 'later' } }],
    });
    expect(outbox.entries.size).toBe(0);
  });

  it('keeps requests partitioned by thread and drops only explicit failures', () => {
    let outbox = createTransportOutbox()
      .put({ requestId: 'a', threadId: 'thread-a', input: { client_request_id: 'a', thread_id: 'thread-a', prompt: 'A' }, attachmentLabels: [], createdAtMs: 1 })
      .put({ requestId: 'b', threadId: 'thread-b', input: { client_request_id: 'b', thread_id: 'thread-b', prompt: 'B' }, attachmentLabels: [], createdAtMs: 2 });
    outbox = outbox.drop('a');
    expect([...outbox.entries.keys()]).toEqual(['b']);
    expect(outbox.forThread('thread-a')).toEqual([]);
    expect(outbox.forThread('thread-b').map((entry) => entry.requestId)).toEqual(['b']);
  });

  it('removes every pending request when its thread is deleted', () => {
    const outbox = createTransportOutbox()
      .put({ requestId: 'a', threadId: 'thread-a', input: { client_request_id: 'a', thread_id: 'thread-a', prompt: 'A' }, attachmentLabels: [], createdAtMs: 1 })
      .put({ requestId: 'b', threadId: 'thread-a', input: { client_request_id: 'b', thread_id: 'thread-a', prompt: 'B' }, attachmentLabels: [], createdAtMs: 2 })
      .put({ requestId: 'c', threadId: 'thread-b', input: { client_request_id: 'c', thread_id: 'thread-b', prompt: 'C' }, attachmentLabels: [], createdAtMs: 3 })
      .dropThread('thread-a');

    expect([...outbox.entries.keys()]).toEqual(['c']);
  });

  it('prunes entries beyond the bounded retry lifetime', () => {
    const now = 24 * 60 * 60 * 1000 + 100_000;
    const outbox = createTransportOutbox()
      .put({ requestId: 'fresh', threadId: 'thread-a', input: { client_request_id: 'fresh', thread_id: 'thread-a', prompt: 'fresh' }, attachmentLabels: [], createdAtMs: 100_000 })
      .put({ requestId: 'expired', threadId: 'thread-a', input: { client_request_id: 'expired', thread_id: 'thread-a', prompt: 'expired' }, attachmentLabels: [], createdAtMs: 1 })
      .pruneExpired(now);

    expect([...outbox.entries.keys()]).toEqual(['fresh']);
  });

  it('retains an explicit attachment recovery failure without treating it as pending work', () => {
    const outbox = createTransportOutbox().put({
      requestId: 'attachment-request',
      threadId: 'thread-a',
      input: {
        client_request_id: 'attachment-request',
        thread_id: 'thread-a',
        prompt: 'attached',
        attachment_ids: ['attachment-1'],
      },
      attachmentLabels: ['notes.md'],
      createdAtMs: 1,
      terminalError: 'attachments_unavailable_after_restart',
    });

    expect(outbox.entries.get('attachment-request')?.terminalError)
      .toBe('attachments_unavailable_after_restart');
  });

  it('keeps an unknown result recoverable and exposes IndexedDB persistence failure', async () => {
    const storageError = new Error('IndexedDB unavailable');
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        const request = {
          error: storageError,
          onerror: null as null | (() => void),
          onsuccess: null as null | (() => void),
          onupgradeneeded: null as null | (() => void),
        };
        queueMicrotask(() => request.onerror?.());
        return request;
      }),
    });
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const outbox = createTransportOutbox().put({
      requestId: 'transport-unknown',
      threadId: 'thread-a',
      input: { client_request_id: 'transport-unknown', thread_id: 'thread-a', prompt: 'keep me' },
      attachmentLabels: [],
      createdAtMs: Date.now(),
    });

    await expect(outbox.flushPersistence()).rejects.toThrow('IndexedDB unavailable');
    expect(outbox.persistenceError()?.message).toBe('IndexedDB unavailable');
    expect(outbox.entries.get('transport-unknown')?.input.prompt).toBe('keep me');
    expect(report).toHaveBeenCalledWith('Flower transport outbox persistence failed.', storageError);

    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        const request = {
          result: undefined as unknown,
          error: null,
          onerror: null as null | (() => void),
          onsuccess: null as null | (() => void),
          onupgradeneeded: null as null | (() => void),
        };
        queueMicrotask(() => {
          request.result = {
            objectStoreNames: { contains: () => true },
            transaction: () => {
              const transaction = {
                error: null,
                oncomplete: null as null | (() => void),
                onerror: null as null | (() => void),
                onabort: null as null | (() => void),
                objectStore: () => ({ clear: () => undefined, put: () => undefined }),
              };
              queueMicrotask(() => transaction.oncomplete?.());
              return transaction;
            },
            close: () => undefined,
          };
          request.onsuccess?.();
        });
        return request;
      }),
    });
    const recovered = outbox.assignThread('transport-unknown', 'thread-recovered');

    await expect(recovered.flushPersistence()).resolves.toBeUndefined();
    expect(recovered.persistenceError()).toBeNull();
    expect(recovered.entries.get('transport-unknown')?.threadId).toBe('thread-recovered');
    recovered.dispose();
  });

  it('expires terminal entries during a long-lived page session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const outbox = createTransportOutbox().put({
      requestId: 'terminal-entry',
      threadId: 'thread-a',
      input: { client_request_id: 'terminal-entry', thread_id: 'thread-a', prompt: 'attached', attachment_ids: ['attachment-1'] },
      attachmentLabels: ['notes.md'],
      createdAtMs: Date.now(),
      terminalError: 'attachments_unavailable_after_restart',
    });
    await outbox.flushPersistence();

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);

    expect(outbox.entries.has('terminal-entry')).toBe(false);
    await outbox.flushPersistence();
    outbox.dispose();
  });
});
