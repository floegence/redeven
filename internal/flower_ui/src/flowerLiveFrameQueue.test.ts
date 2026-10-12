import { describe, expect, it, vi } from 'vitest';
import { createFlowerLiveFrameQueue, flowerLiveTextAppend } from './flowerLiveFrameQueue';
import type { FlowerLiveStreamEnvelope } from './contracts/flowerSurfaceContracts';

const envelope = (version: number, text = 'x'.repeat(version)): FlowerLiveStreamEnvelope => ({
  schema_version: 1, kind: 'thread.batch', thread_id: 'thread',
  current: { thread_id: 'thread', view_version: version, activity: 'active', turn_id: 'turn', run_id: 'run', run_progress: { phase: 'streaming' },
    items: [{ id: 'message', ordinal: 1, kind: 'assistant', turn_id: 'turn', run_id: 'run', live: true, text }], queue: [], interactions: [] },
});

describe('live frame queue', () => {
  it('validates all 300 appends, applies once per frame, and flushes before semantic boundaries', () => {
    const callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
    const apply = vi.fn(); const validateAppend = vi.fn(() => true);
    const queue = createFlowerLiveFrameQueue({ apply, validateAppend, requestFrame: (callback) => { callbacks.set(++id, callback); return id; }, cancelFrame: (key) => { callbacks.delete(key); } });
    queue.push(envelope(1));
    for (let version = 2; version <= 301; version += 1) queue.push(envelope(version));
    expect(validateAppend).toHaveBeenCalledTimes(300);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(1);
    const terminal = envelope(302);
    queue.push({ ...terminal, current: { ...terminal.current!, activity: 'idle', last_outcome: 'completed' } });
    expect(apply.mock.calls.map(([value]) => value.current.view_version)).toEqual([1, 301, 302]);
    expect(callbacks.size).toBe(0);
    queue.push(envelope(303)); queue.push(envelope(304)); queue.boundary();
    expect(apply.mock.calls.at(-1)?.[0]).toEqual(envelope(303));
    queue.push(envelope(305)); queue.push(envelope(306)); queue.dispose();
    expect(callbacks.size).toBe(0);
    expect(apply.mock.calls.at(-1)?.[0]).toEqual(envelope(305));
  });

  it('drops boundary frames and ignores an already dispatched callback or a stale connection', () => {
    let epoch = 1; let scheduled: FrameRequestCallback | undefined;
    const apply = vi.fn(); const cancelFrame = vi.fn();
    const queue = createFlowerLiveFrameQueue({ apply, connectionEpoch: () => epoch, validateAppend: () => true,
      requestFrame: callback => { scheduled = callback; return 1; }, cancelFrame });
    queue.push(envelope(1), 1); queue.push(envelope(2), 1);
    const staleCallback = scheduled!;
    epoch = 2; queue.boundary();
    queue.push(envelope(3), 1); staleCallback(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith(envelope(1), 1);
    queue.push(envelope(3), 2); queue.push(envelope(4), 2);
    staleCallback(0);
    expect(apply).toHaveBeenCalledTimes(2);
    scheduled!(0);
    expect(apply).toHaveBeenLastCalledWith(envelope(4), 2);
    queue.dispose();
    queue.push(envelope(5), 2);
    expect(apply).toHaveBeenCalledTimes(3);
    expect(cancelFrame).toHaveBeenCalled();
  });

  it.each(['immediate', 'animation_frame', 'validation'])('reports a %s failure through the same epoch-aware error callback', (phase) => {
    const failure = new Error('presentation failed');
    let scheduled: FrameRequestCallback | undefined;
    const apply = vi.fn((value: FlowerLiveStreamEnvelope) => {
      if ((phase === 'immediate' && value.current!.view_version === 1)
        || (phase === 'animation_frame' && value.current!.view_version === 2)) throw failure;
    });
    const onError = vi.fn(); const cancelFrame = vi.fn();
    const queue = createFlowerLiveFrameQueue({ apply, onError, connectionEpoch: () => 7,
      validateAppend: () => { if (phase === 'validation') throw failure; return true; },
      requestFrame: callback => { scheduled = callback; return 1; }, cancelFrame });
    queue.push(envelope(1), 7);
    if (phase !== 'immediate') queue.push(envelope(2), 7);
    if (phase === 'animation_frame') scheduled!(0);
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure, 7);
    queue.boundary();
    expect(onError).toHaveBeenCalledOnce();
    if (phase === 'animation_frame') expect(cancelFrame).toHaveBeenCalled();
  });

  it('never drops invalid input or coalesces execution, queue, interaction, tool, error or envelope changes', () => {
    const first = envelope(1); const next = envelope(2);
    const changes = [
      { ...next, schema_version: 2 },
      { ...next, context_usage: null },
      { ...next, current: { ...next.current!, view_version: 0 } },
      { ...next, current: { ...next.current!, error: 'failed' } },
      { ...next, current: { ...next.current!, queue: [{ id: 'queue', request_key: 'request', input: { text: 'Next' } }] } },
      { ...next, current: { ...next.current!, run_id: 'other-run' } },
      { ...next, current: { ...next.current!, items: next.current!.items!.map((item) => ({ ...item, live: false })) } },
      { ...next, current: { ...next.current!, items: next.current!.items!.map((item) => ({ ...item, kind: 'tool' as const })) } },
      { ...next, current: { ...next.current!, interactions: [{ id: 'approval', turn_id: 'turn', run_id: 'run', kind: 'approval' as const }] } },
      envelope(2, 'replacement'),
    ];
    for (const changed of changes) expect(flowerLiveTextAppend(first, changed)).toBe(false);
    const apply = vi.fn(); const queue = createFlowerLiveFrameQueue({ apply, validateAppend: () => false, requestFrame: vi.fn(), cancelFrame: vi.fn() });
    queue.push(first); queue.push(next);
    expect(apply.mock.calls.map(([value]) => value)).toEqual([first, next]);
  });
});
