import { describe, expect, it } from 'vitest';

import {
  normalizeRuntimeFlowerStreamEvent,
  normalizeRuntimeFlowerStreamID,
  normalizeRuntimeFlowerStreamRequest,
} from './runtimeFlowerIPC';

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
