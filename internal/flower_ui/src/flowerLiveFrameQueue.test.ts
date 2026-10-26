// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlowerLiveFrameQueue } from './flowerLiveFrameQueue';
import { FlowerLiveSyncError } from './flowerLiveWire';
import type { FlowerLiveStreamEnvelope } from './contracts/flowerSurfaceContracts';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

function append(version: number): FlowerLiveStreamEnvelope {
  return { schema_version: 3, kind: 'thread.batch', thread_id: 'thread', update: {
    thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: version - 1, view_version: version,
    facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
    items: [{ kind: 'append', item_id: 'answer', append: { offset_bytes: version - 1, text: 'x' } }],
  } };
}
function harness() {
  let epoch = 1; let next = 0; const callbacks = new Map<number, FrameRequestCallback>();
  const apply = vi.fn(); const onError = vi.fn(); const metrics = vi.fn();
  const queue = createFlowerLiveFrameQueue({ apply, onError, onPendingMetrics: metrics, connectionEpoch: () => epoch,
    requestFrame: callback => { callbacks.set(++next, callback); return next; },
    cancelFrame: id => { callbacks.delete(id); },
  });
  return { queue, apply, onError, metrics, callbacks, nextEpoch() { epoch++; }, flush() { [...callbacks.values()][0]?.(0); vi.advanceTimersByTime(0); } };
}

describe('ordered native live frame queue', () => {
  it('commits batched recovery notifications before reporting an application failure', () => {
    const recover = vi.fn();
    const failure = new Error('invalid canonical update');
    const committed = vi.fn();
    const queue = createFlowerLiveFrameQueue({
      apply: () => { throw failure; },
      batch: callback => { callback(); committed(); },
      onError: error => { expect(committed).toHaveBeenCalledOnce(); recover(error); },
      requestFrame: () => 1, cancelFrame: () => {},
    });
    try {
      queue.push({ schema_version: 3, kind: 'ready', baseline_complete: true });
      vi.advanceTimersByTime(0);
      expect(recover).toHaveBeenCalledExactlyOnceWith(failure);
      expect(queue.waitUntilIdle()).toBeUndefined();
    } finally { queue.dispose(); }
  });

  it('delivers semantic boundaries promptly when an earlier animation frame is stalled', () => {
    const h = harness();
    try {
      h.queue.push(append(1));
      const boundary = { ...append(2), update: { ...append(2).update!, interactions: { value: [] } } };
      h.queue.push(boundary);
      expect(h.apply).not.toHaveBeenCalled();
      vi.advanceTimersByTime(0);
      expect(h.apply.mock.calls.map(([value]) => value)).toEqual([append(1), boundary]);
      expect(h.callbacks.size).toBe(0);
    } finally { h.queue.dispose(); }
  });

  it('admits a supported large atomic baseline and backpressures the next read', async () => {
    const h = harness();
    const value: FlowerLiveStreamEnvelope = { schema_version: 3, kind: 'thread.batch', thread_id: 'thread', current: {
      thread_id: 'thread', view_version: 1, activity: 'idle', items: [{ id: 'body', ordinal: 1, kind: 'assistant', text: 'x'.repeat(5 << 20) }],
    } };
    try {
      h.queue.push(value);
      expect(h.onError).not.toHaveBeenCalled();
      const capacity = h.queue.waitForCapacity();
      expect(capacity).toBeInstanceOf(Promise);
      h.flush(); await capacity;
      expect(h.apply).toHaveBeenCalledExactlyOnceWith(value, 1);
    } finally { h.queue.dispose(); }
  });

  it('releases bounded consumer backpressure after draining or invalidating the epoch', async () => {
    const h = harness();
    try {
      for (let version = 1; version <= 16; version++) {
        const value = append(version);
        h.queue.push({ ...value, update: { ...value.update!, interactions: { value: [] } } });
      }
      const ready = vi.fn(); const waiting = h.queue.waitForCapacity();
      expect(waiting).toBeInstanceOf(Promise);
      void waiting!.then(ready); await Promise.resolve(); expect(ready).not.toHaveBeenCalled();
      h.flush(); await waiting; expect(ready).toHaveBeenCalledOnce();
      for (let version = 17; version <= 32; version++) {
        const value = append(version);
        h.queue.push({ ...value, update: { ...value.update!, interactions: { value: [] } } });
      }
      const cancelled = h.queue.waitForCapacity();
      h.queue.boundary(); await cancelled;
      expect(h.queue.waitForCapacity()).toBeUndefined();
    } finally { h.queue.dispose(); }
  });

  it('yields semantic bursts between bounded batches while preserving every boundary', () => {
    vi.useFakeTimers();
    const h = harness(); let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    h.apply.mockImplementation(() => { now += 3; });
    try {
      for (let version = 1; version <= 8; version++) {
        const value = append(version);
        h.queue.push({ ...value, update: { ...value.update!, interactions: { value: [] } } });
      }
      expect(h.apply).not.toHaveBeenCalled();
      vi.advanceTimersToNextTimer();
      expect(h.apply.mock.calls.map(([value]) => value.update.view_version)).toEqual([1, 2]);
      expect(vi.getTimerCount()).toBe(1);
      vi.runAllTimers();
      expect(h.apply.mock.calls.map(([value]) => value.update.view_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(h.callbacks.size).toBe(0);
      expect(h.onError).not.toHaveBeenCalled();
    } finally { h.queue.dispose(); clock.mockRestore(); vi.useRealTimers(); }
  });

  it('coalesces 2000 body extents into one constant-size frame without polling', () => {
    const h = harness();
    for (let version = 1; version <= 2000; version++) {
      const value = append(version);
      h.queue.push({ ...value, reading_revision: 3, update: { ...value.update!, items: [{ kind: 'body', item_id: 'answer', body: { field: 'content', source_id: 'answer', run_id: 'run', bytes: 70000 + version, preview_bytes: 100 } }] } });
    }
    expect(h.apply).not.toHaveBeenCalled(); expect(h.callbacks.size).toBe(1);
    h.flush();
    expect(h.onError).not.toHaveBeenCalled(); expect(h.apply).toHaveBeenCalledOnce();
    const value = h.apply.mock.calls[0][0];
    expect(value.update).toMatchObject({ base_version: 0, view_version: 2000, items: [{ kind: 'body', body: { bytes: 72000 } }] });
    expect(value.reading_revision).toBe(3);
    expect(h.metrics.mock.calls[0][0].bytes).toBeLessThan(4096);
    expect(h.callbacks.size).toBe(0); h.queue.dispose();
  });
  it('uses one host-owned reactive batch for a queued frame', () => {
    let inside = false;
    const apply = vi.fn(() => expect(inside).toBe(true));
    let frame: FrameRequestCallback | undefined;
    const batch = vi.fn((flush: () => void) => { inside = true; try { flush(); } finally { inside = false; } });
    const queue = createFlowerLiveFrameQueue({ apply, batch, requestFrame: callback => { frame = callback; return 1; }, cancelFrame: () => {} });
    queue.push(append(1)); queue.push(append(2)); frame!(0);
    expect(batch).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce();
    queue.dispose();
  });
  it('coalesces contiguous appends into one render update without overwriting text', () => {
    const h = harness();
    for (let version = 1; version <= 40; version++) h.queue.push(append(version));
    expect(h.apply).not.toHaveBeenCalled(); expect(h.callbacks.size).toBe(1);
    h.flush();
    expect(h.apply).toHaveBeenCalledOnce();
    const [value] = h.apply.mock.calls[0]!;
    expect(value.update.base_version).toBe(0);
    expect(value.update.view_version).toBe(40);
    expect(value.update.items?.[0]?.append?.text).toBe('x'.repeat(40));
    h.queue.dispose();
  });
  it('keeps 20000 Unicode appends complete through slow presentation and reconnect', () => {
    const h = harness();
    const utf8 = new TextEncoder();
    let acceptedVersion = 0; let acceptedBytes = 0; let text = '';
    h.apply.mockImplementation((envelope: FlowerLiveStreamEnvelope) => {
      const update = envelope.update!;
      expect(update.base_version).toBe(acceptedVersion);
      const fragment = update.items![0]!.append!;
      expect(fragment.offset_bytes).toBe(acceptedBytes);
      acceptedVersion = update.view_version;
      acceptedBytes += utf8.encode(fragment.text).byteLength;
      text += fragment.text;
    });
    for (let version = 1; version <= 20000; version++) {
      const value = append(version);
      h.queue.push({ ...value, update: { ...value.update!, items: [{ kind: 'append', item_id: 'answer', append: { offset_bytes: (version - 1) * 7, text: '花🌸' } }] } });
      if (version % 200 === 0) h.flush();
    }
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.apply).toHaveBeenCalledTimes(100);
    expect(text).toBe('花🌸'.repeat(20000));
    h.queue.boundary(); h.nextEpoch();
    const next = append(20001);
    h.queue.push({ ...next, update: { ...next.update!, items: [{ kind: 'append', item_id: 'answer', append: { offset_bytes: acceptedBytes, text: 'done' } }] } });
    h.flush();
    expect(text.endsWith('done')).toBe(true);
    expect(h.onError).not.toHaveBeenCalled();
    h.queue.dispose();
  });
  it('flushes growth before semantic boundaries and retains component clears', () => {
    const h = harness(); h.queue.push(append(1));
    const boundary = { ...append(2), update: { ...append(2).update!, interactions: { value: [] } } };
    h.queue.push(boundary); h.flush();
    expect(h.apply.mock.calls.map(([value]) => value)).toEqual([append(1), boundary]);
    h.queue.dispose();
  });
  it('merges growing request counters but flushes attempt changes and counter regressions', () => {
    const h = harness();
    const request = { logical_request_id: 'request', attempt_id: 'attempt', attempt_epoch: 1,
      started_at: '2026-10-22T00:00:00Z', first_output_at: '2026-10-22T00:00:01Z', estimated_output_tokens: 1 };
    const progress = (version: number, patch = {}) => {
      const value = append(version);
      return { ...value, update: { ...value.update!, facts: { ...value.update!.facts, run_progress: { phase: 'streaming' as const,
        request: { ...request, estimated_output_tokens: version, last_progress_at: `2026-10-22T00:00:0${version}Z`, ...patch } } } } };
    };
    h.queue.push(progress(1)); h.queue.push(progress(2)); h.flush();
    expect(h.apply).toHaveBeenCalledOnce();
    expect(h.apply.mock.calls[0]![0].update.items[0].append.text).toBe('xx');
    expect(h.apply.mock.calls[0]![0].update.facts.run_progress.request.estimated_output_tokens).toBe(2);
    h.queue.push(progress(3)); h.queue.push(progress(4, { attempt_id: 'new', attempt_epoch: 2 })); h.flush();
    expect(h.apply.mock.calls.map(([value]) => value.update.view_version)).toEqual([2, 3, 4]);
    h.queue.push(progress(5)); h.queue.push(progress(6, { estimated_output_tokens: 1 })); h.flush();
    expect(h.apply.mock.calls.map(([value]) => value.update.view_version)).toEqual([2, 3, 4, 5, 6]);
    h.queue.dispose();
  });
  it('invalidates a pending batch atomically on a version or offset gap', () => {
    const h = harness();
    h.queue.push(append(1));
    const gap = append(3);
    h.queue.push({ ...gap, update: { ...gap.update!, base_version: 2, items: [{ ...gap.update!.items![0]!, append: { offset_bytes: 2, text: 'z' } }] } });
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledExactlyOnceWith(expect.any(FlowerLiveSyncError), 1);
    h.queue.dispose();
  });
  it('invalidates overflow without blocking providers or discarding semantic facts', () => {
    const h = harness();
    for (let version = 1; version <= 65; version++) {
      const value = append(version);
      const update = value.update!;
      h.queue.push({ ...value, update: { ...update, items: [{ ...update.items![0]!, append: { offset_bytes: (version - 1) * 70000, text: 'x'.repeat(70000) } }] } });
    }
    expect(h.onError).toHaveBeenCalledOnce(); expect(h.apply).not.toHaveBeenCalled();
    expect(h.callbacks.size).toBe(0);
    h.queue.dispose();
  });
  it('merges Unicode at UTF-8 offsets and leaves the producer envelopes immutable', () => {
    const h = harness();
    const first = append(1); const second = append(2);
    const a = { ...first, update: { ...first.update!, items: [{ kind: 'append' as const, item_id: 'answer', append: { offset_bytes: 0, text: '花🌷' } }] } };
    const b = { ...second, update: { ...second.update!, items: [{ kind: 'append' as const, item_id: 'answer', append: { offset_bytes: 7, text: '开' } }] } };
    h.queue.push(a); h.queue.push(b); h.flush();
    expect(h.apply).toHaveBeenCalledOnce();
    expect(h.apply.mock.calls[0]![0].update.items[0].append).toEqual({ offset_bytes: 0, text: '花🌷开' });
    expect(a.update.items[0]!.append.text).toBe('花🌷'); expect(b.update.items[0]!.append.text).toBe('开');
    h.queue.dispose();
  });
  it('keeps different item, turn, run and child streams separate', () => {
    const h = harness();
    h.queue.push(append(1));
    const changed = append(2);
    const item = { ...changed, update: { ...changed.update!, items: [{ kind: 'append' as const, item_id: 'thinking', append: { offset_bytes: 0, text: 'y' } }] } };
    h.queue.push(item);
    h.queue.push({ ...item, update: { ...item.update, turn_id: 'turn2', run_id: 'run2' } });
    h.queue.push({ schema_version: 3, kind: 'thread.batch', thread_id: 'parent', subagent_update: { ...append(1).update!, thread_id: 'child1' } });
    h.queue.push({ schema_version: 3, kind: 'thread.batch', thread_id: 'parent', subagent_update: { ...append(1).update!, thread_id: 'child2' } });
    h.flush(); expect(h.onError).not.toHaveBeenCalled(); expect(h.apply).toHaveBeenCalledTimes(5);
    h.queue.dispose();
  });
  it('bounds item-switch queues independently of bytes', () => {
    const h = harness();
    for (let index = 0; index < 100; index++) {
      const value = append(index + 1);
      h.queue.push({ ...value, update: { ...value.update!, items: [{ kind: 'append', item_id: `item-${index}`, append: { offset_bytes: 0, text: 'x' } }] } });
    }
    expect(h.onError).toHaveBeenCalledExactlyOnceWith(expect.any(FlowerLiveSyncError), 1);
    expect(h.callbacks.size).toBe(0); expect(h.apply).not.toHaveBeenCalled(); h.queue.dispose();
  });
  it('flushes without an animation frame by the pending-age deadline and retains bounded metrics', () => {
    vi.useFakeTimers();
    const h = harness();
    try {
      h.queue.push(append(1)); vi.advanceTimersByTime(250);
      expect(h.apply).toHaveBeenCalledOnce(); expect(h.callbacks.size).toBe(0);
      expect(h.metrics).toHaveBeenCalledOnce();
      expect(h.metrics.mock.calls[0]![0].bytes).toBeGreaterThan(0);
      expect(h.metrics.mock.calls[0]![0].ageMs).toBeGreaterThanOrEqual(250);
    } finally { h.queue.dispose(); vi.useRealTimers(); }
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
