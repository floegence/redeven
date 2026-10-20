// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowerLiveFrameQueue } from './flowerLiveFrameQueue';
import type { FlowerLiveStreamEnvelope } from './contracts/flowerSurfaceContracts';

const FLOE_HOT_INTERACTION_ATTR = 'data-floe-hot-interaction';

const envelope = (version: number): FlowerLiveStreamEnvelope => ({
  schema_version: 1, kind: 'thread.batch', thread_id: 'thread',
  current: { thread_id: 'thread', view_version: version, activity: 'active', turn_id: 'turn', run_id: 'run',
    items: [{ id: 'message', ordinal: 1, kind: 'assistant', turn_id: 'turn', run_id: 'run', live: true, text: 'x'.repeat(version) }],
    queue: [], interactions: [] },
});

function fixture() {
  vi.useFakeTimers();
  const root = document.createElement('div');
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  const apply = vi.fn();
  const validateAppend = vi.fn(() => true);
  const onError = vi.fn();
  let epoch = 1;
  const queue = createFlowerLiveFrameQueue({ apply, validateAppend, onError, interaction: { root, attribute: FLOE_HOT_INTERACTION_ATTR },
    connectionEpoch: () => epoch,
    requestFrame: callback => { callbacks.set(++id, callback); return id; },
    cancelFrame: key => { callbacks.delete(key); },
  });
  const frame = () => {
    const work = [...callbacks.values()]; callbacks.clear();
    work.forEach(callback => callback(performance.now()));
  };
  return { root, callbacks, apply, validateAppend, onError, queue, frame, setEpoch: (next: number) => { epoch = next; } };
}

afterEach(() => vi.useRealTimers());

describe('live text interaction scheduling', () => {
  it('bounds same-attempt tool argument preview and progress paints without delaying invocation', async () => {
    const f = fixture();
    const preview = (version: number): FlowerLiveStreamEnvelope => ({ ...envelope(version), current: { ...envelope(version).current!,
      sampled_at_ms: 1000 + version, items: [],
      run_progress: { phase: 'streaming', request: { logical_request_id: 'request', attempt_id: 'attempt', attempt_epoch: 1,
        started_at: '2026-10-19T00:00:00Z', first_output_at: '2026-10-19T00:00:01Z',
        last_progress_at: new Date(1000 + version).toISOString(), estimated_output_tokens: version } },
      tool_call_previews: [{ thread_id: 'thread', turn_id: 'turn', run_id: 'run', logical_request_id: 'request', attempt_id: 'attempt',
        attempt_epoch: 1, call_id: 'call', name: 'terminal.exec', arguments_complete: false, preview: { additions: version } }],
    } });
    try {
      f.root.setAttribute(FLOE_HOT_INTERACTION_ATTR, 'drag');
      f.queue.push(preview(1));
      for (let version = 2; version <= 301; version++) f.queue.push(preview(version));
      expect(f.validateAppend).toHaveBeenCalledTimes(300);
      expect(f.apply).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(75); f.frame();
      expect(f.apply).toHaveBeenLastCalledWith(preview(301), 1);
      f.queue.push(preview(302));
      const next = preview(303);
      const ready = { ...next, current: { ...next.current!, tool_call_previews: next.current!.tool_call_previews!.map(call => ({ ...call, arguments_complete: true })) } };
      f.queue.push(ready);
      expect(f.apply.mock.calls.map(([value]) => value.current.view_version)).toEqual([1, 301, 302, 303]);
    } finally { f.queue.dispose(); }
  });

  it.each(['drag', 'resize'])('bounds %s text paints while validating every append and converges on release', async kind => {
    const f = fixture();
    try {
      f.root.setAttribute(FLOE_HOT_INTERACTION_ATTR, kind);
      f.queue.push(envelope(1));
      for (let version = 2; version <= 301; version++) f.queue.push(envelope(version));
      expect(f.validateAppend).toHaveBeenCalledTimes(300);
      expect(f.callbacks.size).toBe(0);
      await vi.advanceTimersByTimeAsync(74); f.frame();
      expect(f.apply).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); f.frame();
      expect(f.apply).toHaveBeenLastCalledWith(envelope(301), 1);
      f.queue.push(envelope(302));
      f.root.removeAttribute(FLOE_HOT_INTERACTION_ATTR);
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(0);
      expect(f.callbacks.size).toBe(1); f.frame();
      expect(f.apply.mock.calls.map(([value]) => value.current.view_version)).toEqual([1, 301, 302]);
    } finally { f.queue.dispose(); }
  });

  it('yields a previously requested frame when an interaction starts', async () => {
    const f = fixture();
    try {
      f.queue.push(envelope(1)); f.queue.push(envelope(2));
      f.root.setAttribute(FLOE_HOT_INTERACTION_ATTR, 'drag'); f.frame();
      expect(f.apply).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(75); f.frame();
      expect(f.apply).toHaveBeenLastCalledWith(envelope(2), 1);
    } finally { f.queue.dispose(); }
  });

  it('does not postpone the paint deadline under continuous input and ignores a cancelled callback', async () => {
    const f = fixture();
    try {
      f.queue.push(envelope(1)); f.queue.push(envelope(2));
      const cancelled = [...f.callbacks.values()][0]!;
      f.root.setAttribute(FLOE_HOT_INTERACTION_ATTR, 'drag'); f.frame();
      for (let version = 3; version <= 11; version++) {
        await vi.advanceTimersByTimeAsync(8); f.queue.push(envelope(version));
      }
      expect(f.apply).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3);
      cancelled(0);
      expect(f.apply).toHaveBeenCalledTimes(1);
      f.frame();
      expect(f.apply).toHaveBeenLastCalledWith(envelope(11), 1);
      expect(f.validateAppend).toHaveBeenCalledTimes(10);
      f.queue.push(envelope(12)); f.queue.dispose();
      await vi.advanceTimersByTimeAsync(100); f.frame();
      expect(f.apply).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { f.queue.dispose(); }
  });

  it.each(['approval', 'error', 'terminal'])('applies a %s boundary immediately during dragging', kind => {
    const f = fixture();
    try {
      f.root.setAttribute(FLOE_HOT_INTERACTION_ATTR, 'drag');
      f.queue.push(envelope(1)); f.queue.push(envelope(2));
      const base = envelope(3);
      const value: FlowerLiveStreamEnvelope = { ...base, current: { ...base.current!,
        ...(kind === 'approval' ? { interactions: [{ id: 'approval', turn_id: 'turn', run_id: 'run', kind: 'approval' as const }] } : {}),
        ...(kind === 'error' ? { error: 'failed' } : {}),
        ...(kind === 'terminal' ? { activity: 'idle' as const } : {}),
      } };
      f.queue.push(value);
      expect(f.apply.mock.calls.map(([item]) => item.current.view_version)).toEqual([1, 2, 3]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { f.queue.dispose(); }
  });

  it('drops delayed text across reconnect and disposal and reports delayed errors with their epoch', async () => {
    const f = fixture();
    f.root.setAttribute(FLOE_HOT_INTERACTION_ATTR, 'drag');
    f.queue.push(envelope(1)); f.queue.push(envelope(2));
    f.setEpoch(2); f.queue.boundary();
    await vi.advanceTimersByTimeAsync(75); f.frame();
    expect(f.apply).toHaveBeenCalledTimes(1);
    f.queue.push(envelope(3)); f.queue.push(envelope(4));
    f.apply.mockImplementation(() => { throw new Error('failed'); });
    await vi.advanceTimersByTimeAsync(75); f.frame();
    expect(f.onError).toHaveBeenCalledWith(expect.any(Error), 2);
    f.queue.dispose();
    f.root.removeAttribute(FLOE_HOT_INTERACTION_ATTR);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.callbacks.size).toBe(0);
  });
});
