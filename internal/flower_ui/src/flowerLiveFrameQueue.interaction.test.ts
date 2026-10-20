// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowerLiveFrameQueue } from './flowerLiveFrameQueue';
import type { FlowerLiveStreamEnvelope } from './contracts/flowerSurfaceContracts';

const attribute = 'data-floe-hot-interaction';
const envelope = (version: number): FlowerLiveStreamEnvelope => ({
  schema_version: 2, kind: 'thread.batch', thread_id: 'thread', update: {
    thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: version - 1, view_version: version,
    facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
    items: [{ kind: 'append', item_id: 'message', append: { offset_bytes: version - 1, text: 'x' } }],
  },
});
function fixture() {
  vi.useFakeTimers();
  const root = document.createElement('div');
  const callbacks = new Map<number, FrameRequestCallback>(); let id = 0; let epoch = 1;
  const apply = vi.fn(); const onError = vi.fn();
  const queue = createFlowerLiveFrameQueue({ apply, onError, interaction: { root, attribute }, connectionEpoch: () => epoch,
    requestFrame: callback => { callbacks.set(++id, callback); return id; }, cancelFrame: key => { callbacks.delete(key); } });
  const frame = () => { const work = [...callbacks.values()]; callbacks.clear(); work.forEach(callback => callback(performance.now())); };
  return { root, callbacks, apply, onError, queue, frame, setEpoch: (next: number) => { epoch = next; } };
}
afterEach(() => vi.useRealTimers());
describe('native live update interaction scheduling', () => {
  it('coalesces active preview growth but flushes a new attempt and completion immediately', () => {
    const f = fixture();
    const call = { thread_id: 'thread', turn_id: 'turn', run_id: 'run', logical_request_id: 'request', attempt_id: 'attempt', attempt_epoch: 1, call_id: 'tool', name: 'apply_patch', arguments_complete: false, preview: { additions: 1 } };
    const preview = (version: number, patch = {}) => ({ ...envelope(version), update: { ...envelope(version).update!, tool_call_previews: { value: [{ ...call, ...patch }] } } });
    try {
      f.queue.push(preview(1)); f.apply.mockClear(); f.root.setAttribute(attribute, 'drag');
      f.queue.push(preview(2, { preview: { additions: 2 } }));
      expect(f.apply).not.toHaveBeenCalled();
      f.queue.push(preview(3, { attempt_id: 'retry', attempt_epoch: 2 }));
      expect(f.apply.mock.calls.map(([value]) => value.update.view_version)).toEqual([2, 3]);
      f.apply.mockClear();
      f.queue.push(preview(4, { attempt_id: 'retry', attempt_epoch: 2, preview: { additions: 3 } }));
      expect(f.apply).not.toHaveBeenCalled();
      f.queue.push(preview(5, { attempt_id: 'retry', attempt_epoch: 2, arguments_complete: true }));
      expect(f.apply.mock.calls.map(([value]) => value.update.view_version)).toEqual([4, 5]);
    } finally { f.queue.dispose(); }
  });
  it.each(['drag', 'resize'])('keeps every delta and the original %s deadline, then flushes on release', async kind => {
    const f = fixture();
    try {
      f.queue.push({ schema_version: 2, kind: 'ready' }); f.apply.mockClear();
      f.root.setAttribute(attribute, kind);
      for (let version = 1; version <= 10; version++) { f.queue.push(envelope(version)); await vi.advanceTimersByTimeAsync(7); }
      f.frame(); expect(f.apply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5); f.frame();
      expect(f.apply.mock.calls.map(([value]) => value.update.view_version)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
      f.queue.push(envelope(11)); f.root.removeAttribute(attribute); await Promise.resolve(); f.frame();
      expect(f.apply).toHaveBeenLastCalledWith(envelope(11), 1); expect(vi.getTimerCount()).toBe(0);
    } finally { f.queue.dispose(); }
  });
  it.each(['approval', 'error', 'terminal', 'preview'])('flushes before a %s boundary even during dragging', kind => {
    const f = fixture();
    try {
      f.root.setAttribute(attribute, 'drag'); f.queue.push(envelope(1)); f.queue.push(envelope(2));
      const base = envelope(3); const value: FlowerLiveStreamEnvelope = { ...base, update: { ...base.update!,
        ...(kind === 'approval' ? { interactions: { value: [] } } : {}),
        ...(kind === 'error' ? { facts: { ...base.update!.facts, error: 'failed' } } : {}),
        ...(kind === 'terminal' ? { facts: { ...base.update!.facts, activity: 'idle' } } : {}),
        ...(kind === 'preview' ? { tool_call_previews: { value: [] } } : {}),
      } };
      f.queue.push(value); expect(f.apply.mock.calls.map(([item]) => item.update.view_version)).toEqual([1, 2, 3]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { f.queue.dispose(); }
  });
  it('fences callbacks across reconnect and disposal and reports the originating epoch', async () => {
    const f = fixture();
    try {
      f.queue.push(envelope(1)); const cancelled = [...f.callbacks.values()][0]!;
      f.setEpoch(2); f.queue.boundary(); cancelled(0); expect(f.apply).not.toHaveBeenCalled();
      f.queue.push(envelope(2)); f.apply.mockImplementation(() => { throw new Error('invalid update'); }); f.frame();
      expect(f.onError).toHaveBeenCalledWith(expect.any(Error), 2);
      f.queue.push(envelope(3)); f.queue.dispose(); await vi.advanceTimersByTimeAsync(100); f.frame();
      expect(vi.getTimerCount()).toBe(0); expect(f.callbacks.size).toBe(0);
    } finally { f.queue.dispose(); }
  });
});
