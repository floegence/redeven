import { describe, expect, it } from 'vitest';
import type { FlowerRuntimeCurrentView, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';
import { createThreadCache } from './threadCache';
import { buildFlowerTimelineEntries } from './flowerTimelineProjection';

function summary(): FlowerThreadSnapshot {
  return {
    thread_id: 'stable-thread', title: 'Stable thread', title_status: 'ready', title_generation: 1,
    model_id: 'fake/model', working_dir: '/', settings_revision: 1,
    created_at_ms: 1, updated_at_ms: 2, status: 'idle', source_label: 'Test', target_labels: [], messages: [],
    read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } },
  };
}

function current(version: number): FlowerRuntimeCurrentView {
  return {
    thread_id: 'stable-thread', view_version: version, activity: 'active', turn_id: 'turn', run_id: 'run',
    run_progress: { phase: 'streaming' },
    items: [
      { id: 'history', turn_id: 'older-turn', run_id: 'older-run', ordinal: 1, kind: 'assistant', text: 'Stable history' },
      { id: 'tail', turn_id: 'turn', run_id: 'run', ordinal: 2, kind: 'assistant', live: true, text: `Tail ${version}` },
    ],
    queue: ['first', 'second'].map((id) => ({ id, request_key: id, created_at: '2026-09-09T00:00:00Z', input: { text: id } })),
  };
}

describe('current view presentation stability', () => {
  it('uses the validated timeline after cache acceptance without deriving it again', () => {
    let cache = createThreadCache();
    for (let version = 1; version <= 3; version += 1) {
      const projected = applyFlowerRuntimeCurrentView(cache.views.get('stable-thread')?.thread ?? summary(), current(version));
      const validated = buildFlowerTimelineEntries(projected);
      cache = cache.receiveView({ thread: projected, version }).cache;
      expect(buildFlowerTimelineEntries(cache.views.get('stable-thread')!.thread)).toBe(validated);
    }
  });
  it('retains history and queue data through 300 unrelated text updates', () => {
    let thread = applyFlowerRuntimeCurrentView(summary(), current(1));
    const history = thread.messages[0];
    const queued = thread.queued_turns;
    const firstEntries = buildFlowerTimelineEntries(thread);
    for (let version = 2; version <= 301; version += 1) {
      thread = applyFlowerRuntimeCurrentView(thread, current(version));
      expect(thread.messages[0]).toBe(history);
      expect(thread.queued_turns).toBe(queued);
      expect(buildFlowerTimelineEntries(thread)[0]).toBe(firstEntries[0]);
      expect(thread.messages[1]?.content).toBe(`Tail ${version}`);
    }
  });

  it('retains queue members across reordering and applies real content changes', () => {
    const first = applyFlowerRuntimeCurrentView(summary(), current(1));
    const next = current(2);
    const reordered = applyFlowerRuntimeCurrentView(first, { ...next, queue: [...next.queue!].reverse() });
    expect(reordered.queued_turns?.[0]).toBe(first.queued_turns?.[1]);
    expect(reordered.queued_turns?.[1]).toBe(first.queued_turns?.[0]);
    const changed = applyFlowerRuntimeCurrentView(reordered, {
      ...current(3), queue: [{ ...next.queue![1]!, input: { text: 'Changed' } }],
    });
    expect(changed.queued_turns).toHaveLength(1);
    expect(changed.queued_turns?.[0]?.prompt).toBe('Changed');
    expect(changed.queued_turns?.[0]).not.toBe(reordered.queued_turns?.[0]);
  });

  it('does not replace a cached detail for unrelated summary updates or selection', () => {
    const thread = applyFlowerRuntimeCurrentView(summary(), current(1));
    let cache = createThreadCache().receiveView({ thread, version: 1 }).cache.select(thread.thread_id);
    const original = cache.views.get(thread.thread_id);
    cache = cache.replaceSummary({ ...summary(), thread_id: 'other' });
    expect(cache.views.get(thread.thread_id)).toBe(original);
    cache = cache.select('other');
    expect(cache.views.get(thread.thread_id)).toBe(original);
  });

  it('retains unresolved interactions but does not suppress a changed question or approval', () => {
    const initial = { ...current(1), interactions: [
      { id: 'approval', turn_id: 'turn', run_id: 'run', kind: 'approval' as const, approval: { label: 'Inspect', tool_name: 'read_file', tool_call_id: 'call' } },
      { id: 'input', turn_id: 'turn', run_id: 'run', kind: 'input' as const, input: { summary: 'Choose', questions: [{ id: 'color', prompt: 'Color?', kind: 'select', options: ['Blue', 'Green'] }] } },
    ] };
    const first = applyFlowerRuntimeCurrentView(summary(), initial);
    const second = applyFlowerRuntimeCurrentView(first, structuredClone({ ...initial, view_version: 2 }));
    expect(second.approval_actions).toBe(first.approval_actions);
    expect(second.input_request).toBe(first.input_request);
    const changed = structuredClone({ ...initial, view_version: 3 });
    changed.interactions[0]!.approval!.label = 'Inspect another file';
    changed.interactions[1]!.input!.questions[0]!.prompt = 'Favorite color?';
    const third = applyFlowerRuntimeCurrentView(second, changed);
    expect(third.approval_actions?.[0]?.summary?.label).toBe('Inspect another file');
    expect(third.input_request?.questions[0]?.question).toBe('Favorite color?');
  });
});
