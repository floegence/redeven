// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createFlowerLiveFrameQueue } from './flowerLiveFrameQueue';
import type { FlowerLiveStreamEnvelope } from './contracts/flowerSurfaceContracts';

function append(version: number): FlowerLiveStreamEnvelope {
  return { schema_version: 2, kind: 'thread.batch', thread_id: 'thread', update: {
    thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: version - 1, view_version: version,
    facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
    items: [{ kind: 'append', item_id: 'answer', append: { offset_bytes: version - 1, text: 'x' } }],
  } };
}
function harness() {
  let epoch = 1; let next = 0; const callbacks = new Map<number, FrameRequestCallback>();
  const apply = vi.fn(); const onError = vi.fn();
  const queue = createFlowerLiveFrameQueue({ apply, onError, connectionEpoch: () => epoch,
    requestFrame: callback => { callbacks.set(++next, callback); return next; },
    cancelFrame: id => { callbacks.delete(id); },
  });
  return { queue, apply, onError, callbacks, nextEpoch() { epoch++; }, flush() { [...callbacks.values()][0]?.(0); } };
}

describe('ordered native live frame queue', () => {
  it('uses one host-owned reactive batch for a queued frame', () => {
    let inside = false;
    const apply = vi.fn(() => expect(inside).toBe(true));
    let frame: FrameRequestCallback | undefined;
    const batch = vi.fn((flush: () => void) => { inside = true; try { flush(); } finally { inside = false; } });
    const queue = createFlowerLiveFrameQueue({ apply, batch, requestFrame: callback => { frame = callback; return 1; }, cancelFrame: () => {} });
    queue.push(append(1)); queue.push(append(2)); frame!(0);
    expect(batch).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledTimes(2);
    queue.dispose();
  });
  it('applies every append in order in one render batch without overwriting deltas', () => {
    const h = harness();
    for (let version = 1; version <= 40; version++) h.queue.push(append(version));
    expect(h.apply).not.toHaveBeenCalled(); expect(h.callbacks.size).toBe(1);
    h.flush();
    expect(h.apply.mock.calls.map(([value]) => value.update.view_version)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(h.callbacks.size).toBe(0); h.queue.dispose();
  });
  it('flushes growth before semantic boundaries and retains component clears', () => {
    const h = harness(); h.queue.push(append(1));
    const boundary = { ...append(2), update: { ...append(2).update!, interactions: { value: [] } } };
    h.queue.push(boundary);
    expect(h.apply.mock.calls.map(([value]) => value)).toEqual([append(1), boundary]);
    expect(h.callbacks.size).toBe(0); h.queue.dispose();
  });
  it('invalidates overflow without blocking providers or discarding semantic facts', () => {
    const h = harness(); for (let version = 1; version <= 65; version++) h.queue.push(append(version));
    expect(h.onError).toHaveBeenCalledOnce(); expect(h.apply).not.toHaveBeenCalled();
    expect(h.callbacks.size).toBe(0); h.queue.dispose();
  });
  it('fences old epochs, disposal, and scheduled callbacks', () => {
    const h = harness(); h.queue.push(append(1)); const late = [...h.callbacks.values()][0];
    h.queue.boundary(); h.nextEpoch(); late(0);
    h.queue.push(append(2), 1); expect(h.apply).not.toHaveBeenCalled();
    h.queue.push(append(3), 2); h.queue.dispose(); h.flush();
    expect(h.callbacks.size).toBe(0); expect(h.apply).not.toHaveBeenCalled();
  });
  it('routes application failures to the single transport owner', () => {
    const error = new Error('invalid offset'); const h = harness();
    h.apply.mockImplementation(() => { throw error; }); h.queue.push(append(1)); h.flush();
    expect(h.onError).toHaveBeenCalledExactlyOnceWith(error, 1); h.queue.dispose();
  });
});
