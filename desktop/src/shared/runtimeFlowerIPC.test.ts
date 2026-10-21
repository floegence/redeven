import { describe, expect, it } from 'vitest';

import {
  isRuntimeFlowerCancellableRead,
  normalizeRuntimeFlowerStreamEvent,
  normalizeRuntimeFlowerStreamID,
  normalizeRuntimeFlowerStreamRequest,
} from './runtimeFlowerIPC';

describe('runtime Flower read cancellation', () => {
  it.each([
    '/_redeven_proxy/api/settings',
    '/_redeven_proxy/api/ai/models?mode=baseline',
    '/_redeven_proxy/api/ai/conversation_preferences',
    '/_redeven_proxy/api/ai/threads/thread-1',
  ])('allows cancellation for a body-free GET read at %s', path => {
    expect(isRuntimeFlowerCancellableRead({ method: 'GET', path })).toBe(true);
  });

  it.each([
    { method: 'POST' as const, path: '/_redeven_proxy/api/ai/turns' },
    { method: 'PUT' as const, path: '/_redeven_proxy/api/fs/directory_favorites' },
    { method: 'PATCH' as const, path: '/_redeven_proxy/api/ai/conversation_preferences' },
    { method: 'DELETE' as const, path: '/_redeven_proxy/api/fs/directory_favorites' },
    { method: 'GET' as const, path: '/_redeven_proxy/api/settings', body: {} },
    { method: 'GET' as const, path: '/_redeven_proxy/api/settings', staging_scope_id: 'scope', staging_capability: 'secret' },
  ])('rejects cancellation for non-read requests %#', request => {
    expect(isRuntimeFlowerCancellableRead(request)).toBe(false);
  });
});

describe('runtime Flower stream IPC normalization', () => {
  it('accepts bounded opaque stream identities and absolute request paths', () => {
    expect(normalizeRuntimeFlowerStreamID('stream_1-a')).toBe('stream_1-a');
    expect(normalizeRuntimeFlowerStreamRequest({
      stream_id: 'stream_1-a',
      path: '/_redeven_proxy/api/ai/flower/stream?thread_id=thread-1',
    })).toEqual({
      stream_id: 'stream_1-a',
      path: '/_redeven_proxy/api/ai/flower/stream?thread_id=thread-1',
    });
  });

  it.each(['', '../stream', 'stream id', 'a'.repeat(101)])('rejects invalid stream identity %j', (streamID) => {
    expect(normalizeRuntimeFlowerStreamID(streamID)).toBeNull();
  });

  it('rejects malformed requests and events while preserving raw chunks', () => {
    expect(normalizeRuntimeFlowerStreamRequest({ stream_id: 'stream-1', path: 'https://example.test/' })).toBeNull();
    expect(normalizeRuntimeFlowerStreamRequest({ stream_id: 'stream-1', path: `/${'a'.repeat(4_096)}` })).toBeNull();
    const chunk = new Uint8Array([1, 2, 3]);
    expect(normalizeRuntimeFlowerStreamEvent({ stream_id: 'stream-1', kind: 'chunk', chunk }))
      .toEqual({ stream_id: 'stream-1', kind: 'chunk', chunk });
    expect(normalizeRuntimeFlowerStreamEvent({ stream_id: 'stream-1', kind: 'chunk', chunk: [1, 2, 3] })).toBeNull();
    expect(normalizeRuntimeFlowerStreamEvent({ stream_id: 'stream-1', kind: 'error', message: '' })).toBeNull();
  });
});
