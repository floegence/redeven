import { describe, expect, it, vi } from 'vitest';
import { createFlowerLiveFrameQueue, flowerLivePresentationAppend } from './flowerLiveFrameQueue';
import type { FlowerLiveStreamEnvelope } from './contracts/flowerSurfaceContracts';

const envelope = (version: number, text = 'x'.repeat(version)): FlowerLiveStreamEnvelope => ({
  schema_version: 1, kind: 'thread.batch', thread_id: 'thread',
  current: { thread_id: 'thread', view_version: version, activity: 'active', turn_id: 'turn', run_id: 'run', run_progress: { phase: 'streaming' },
    items: [{ id: 'message', ordinal: 1, kind: 'assistant', turn_id: 'turn', run_id: 'run', live: true, text }], queue: [], interactions: [] },
});

describe('live frame queue', () => {
  it('coalesces complete display progress while preserving every attempt, lifecycle and unknown-field boundary', () => {
    const progress = (version: number): FlowerLiveStreamEnvelope => ({ ...envelope(version), current: { ...envelope(version).current!,
      sampled_at_ms: 1000 + version, run_progress: { phase: 'streaming', request: { logical_request_id: 'request', attempt_id: 'attempt', attempt_epoch: 1,
        started_at: '2026-10-19T00:00:00Z', first_output_at: '2026-10-19T00:00:01Z', estimated_output_tokens: version } },
      tool_call_previews: [{ thread_id: 'thread', turn_id: 'turn', run_id: 'run', logical_request_id: 'request', attempt_id: 'attempt',
        attempt_epoch: 1, call_id: 'call', name: 'terminal.exec', arguments_complete: false, preview: { display_name: 'build', additions: version } }],
    } });
    const first = progress(1); const next = progress(2);
    expect(flowerLivePresentationAppend(first, next)).toBe(true);
    const request = next.current!.run_progress!.request!;
    const changes = [
      { ...next.current!, sampled_at_ms: 1 },
      { ...next.current!, cancellation: { thread_id: 'thread', turn_id: 'turn', run_id: 'run', source: 'user', mode: 'immediate' as const, requested_at: 'now' } },
      ...[
        { ...request, attempt_id: 'replacement' }, { ...request, logical_request_id: 'replacement' }, { ...request, attempt_epoch: 2 },
        { ...request, first_output_at: '2026-10-19T00:00:02Z' }, { ...request, estimated_output_tokens: 0 },
        { ...request, future_field: true },
      ].map(request => ({ ...next.current!, run_progress: { ...next.current!.run_progress!, request } })),
      { ...next.current!, run_progress: { ...next.current!.run_progress!, phase: 'tool_execution' as const } },
      ...[
        { arguments_complete: true }, { call_id: 'other' }, { name: 'file.write' }, { attempt_epoch: 2 }, { preview: null },
        { preview: { ...next.current!.tool_call_previews![0]!.preview!, future_field: true } },
      ].map(patch => ({ ...next.current!, tool_call_previews: next.current!.tool_call_previews!.map(call => ({ ...call, ...patch })) })),
      { ...next.current!, tool_call_previews: [] },
    ];
    for (const current of changes) expect(flowerLivePresentationAppend(first, { ...next, current })).toBe(false);
    const child = ({ current, ...outer }: FlowerLiveStreamEnvelope): FlowerLiveStreamEnvelope => ({ ...outer, thread_id: 'parent', subagent_current: current });
    expect(flowerLivePresentationAppend(child(first), child(next))).toBe(true);
    const apply = vi.fn(); const validateAppend = vi.fn(() => false);
    const queue = createFlowerLiveFrameQueue({ apply, validateAppend, requestFrame: vi.fn(), cancelFrame: vi.fn() });
    queue.push(first); queue.push(next);
    expect(validateAppend).toHaveBeenCalledOnce();
    expect(apply.mock.calls.map(([value]) => value)).toEqual([first, next]);
    queue.dispose();
  });

  it('coalesces identical complete context snapshots and flushes clears or compaction changes immediately', () => {
    const snapshot = { model_context: null, context_usage: {}, context_compactions: [], timeline_decorations: [] };
    expect(flowerLivePresentationAppend({ ...envelope(1), ...snapshot }, { ...envelope(2), ...snapshot })).toBe(true);
    expect(flowerLivePresentationAppend({ ...envelope(1), ...snapshot }, { ...envelope(2), ...snapshot, context_usage: null })).toBe(false);
    const compact = { operation_id: 'operation', turn_id: 'turn', canonical_ordinal: 7, phase: 'start' as const, status: 'compacting' as const, updated_at_ms: 1 };
    const first = { ...envelope(1), ...snapshot, context_compactions: [compact] };
    const completed = { ...envelope(2), ...snapshot, context_compactions: [{ ...compact, phase: 'complete' as const, status: 'compacted' as const }] };
    expect(flowerLivePresentationAppend(first, completed)).toBe(false);
    const apply = vi.fn();
    const queue = createFlowerLiveFrameQueue({ apply, validateAppend: () => true, requestFrame: () => 1, cancelFrame: vi.fn() });
    queue.push(first); queue.push(completed);
    expect(apply).toHaveBeenCalledTimes(2);
    queue.dispose();
  });

  it('coalesces child text with the same rules while preserving parent, child and semantic boundaries', () => {
    const child = (version: number): FlowerLiveStreamEnvelope => {
      const { current, ...outer } = envelope(version);
      return { ...outer, thread_id: 'parent', subagent_current: current };
    };
    expect(flowerLivePresentationAppend(child(1), child(2))).toBe(true);
    expect(flowerLivePresentationAppend(child(1), { ...child(2), thread_id: 'other-parent' })).toBe(false);
    expect(flowerLivePresentationAppend(child(1), { ...child(2), subagent_current: { ...child(2).subagent_current!, thread_id: 'other-child' } })).toBe(false);
    expect(flowerLivePresentationAppend(child(1), envelope(2))).toBe(false);
    expect(flowerLivePresentationAppend(child(1), { ...child(2), current: envelope(2).current })).toBe(false);
    const apply = vi.fn(); let scheduled: FrameRequestCallback | undefined;
    const validateAppend = vi.fn(() => true);
    const queue = createFlowerLiveFrameQueue({ apply, validateAppend,
      requestFrame: callback => { scheduled = callback; return 1; }, cancelFrame: vi.fn() });
    queue.push(child(1)); queue.push(child(2)); queue.push(child(3));
    expect(apply).toHaveBeenCalledTimes(1);
    scheduled!(0);
    expect(apply).toHaveBeenLastCalledWith(child(3), 0);
    queue.push(child(4));
    const terminal = { ...child(5), subagent_current: { ...child(5).subagent_current!, activity: 'idle' as const, last_outcome: 'completed' as const } };
    queue.push(terminal);
    expect(apply.mock.calls.map(([value]) => value.subagent_current.view_version)).toEqual([1, 3, 4, 5]);
    expect(validateAppend).toHaveBeenCalledTimes(3);
    queue.dispose();
  });

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
    for (const changed of changes) expect(flowerLivePresentationAppend(first, changed)).toBe(false);
    const apply = vi.fn(); const queue = createFlowerLiveFrameQueue({ apply, validateAppend: () => false, requestFrame: vi.fn(), cancelFrame: vi.fn() });
    queue.push(first); queue.push(next);
    expect(apply.mock.calls.map(([value]) => value)).toEqual([first, next]);
  });
});
