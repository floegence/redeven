import { createComputed, createRoot } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { expect, it } from 'vitest';
import { createRuntimeThreadRecord } from './runtimeThreadRecord';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';
import { createFlowerTimelineProjection } from './flowerTimelineProjection';
import type { FlowerRuntimeCurrentView, FlowerRuntimeUpdate, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

it('notifies only affected text subscribers and preserves structural presentation identities', () => createRoot(dispose => {
  try {
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run', run_progress: { phase: 'streaming' }, interactions: [], queue: [], turns: [],
      items: [{ id: 'old', kind: 'assistant', ordinal: 1, turn_id: 'oldturn', run_id: 'oldrun', text: 'History' },
        { id: 'one', kind: 'assistant', ordinal: 2, turn_id: 'turn', run_id: 'run', text: 'Text', live: true }] };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1, model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [], read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread(); const messages = thread.messages;
    const timeline = createFlowerTimelineProjection(); const initial = timeline(thread);
    let oldRuns = 0; let newRuns = 0; let listRuns = 0; let sourceRuns = 0; let timelineRuns = 0;
    let executionRuns = 0; let progressRuns = 0; let restoredRuns = 0;
    createComputed(() => { void thread.messages[0].content; oldRuns++; });
    createComputed(() => { void thread.messages[1].content; newRuns++; });
    createComputed(() => { void thread.messages; listRuns++; });
    createComputed(() => { void thread.messages[1].text_source?.revision; sourceRuns++; });
    createComputed(() => { timeline(thread); timelineRuns++; });
    createComputed(() => { void thread.current_execution; executionRuns++; });
    createComputed(() => { void thread.run_progress; progressRuns++; });
    createComputed(() => { void thread.restored_inputs; restoredRuns++; });
    const value: FlowerRuntimeUpdate = { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 1, view_version: 2,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, items: [{ kind: 'append', item_id: 'one', append: { offset_bytes: 4, text: '!' } }] };
    record.apply(thread, value);
    expect(thread).toBe(record.initializeThread()); expect(thread.messages).toBe(messages); expect(timeline(thread)).toBe(initial);
    expect({ oldRuns, newRuns, listRuns, sourceRuns, timelineRuns }).toEqual({ oldRuns: 1, newRuns: 2, listRuns: 1, sourceRuns: 2, timelineRuns: 1 });
    expect({ executionRuns, progressRuns, restoredRuns }).toEqual({ executionRuns: 1, progressRuns: 1, restoredRuns: 1 });
    expect(thread.messages[1].text_source?.read(0)).toEqual(['!']);
    const raw = unwrap(thread.messages);
    const historical = raw[0];
    let historicalReads = 0;
    Object.defineProperty(raw, 0, { configurable: true, get() { historicalReads++; return historical; } });
    record.apply(thread, { ...value, base_version: 2, view_version: 3, items: [{ kind: 'append', item_id: 'one', append: { offset_bytes: 5, text: ' Again' } }] });
    expect(historicalReads).toBe(0);
    Object.defineProperty(raw, 0, { configurable: true, writable: true, value: historical });
    const replaced = { ...value, base_version: 3, view_version: 4, items: [{ kind: 'replace' as const, item_id: 'one', item: { ...current.items![1], text: 'Final', live: false } }] };
    record.apply(thread, replaced);
    expect(thread.messages).not.toBe(messages); expect(timeline(thread)).not.toBe(initial); expect(thread.messages[1].content).toBe('Final');
  } finally { dispose(); }
}));


it('retains growing records across an authoritative snapshot and continues the same text source', () => createRoot(dispose => {
  try {
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run', run_progress: { phase: 'streaming' },
      interactions: [], queue: [], turns: [], items: [{ id: 'one', kind: 'assistant', ordinal: 1, turn_id: 'turn', run_id: 'run', text: 'Text', live: true }] };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1, model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [], read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const prior = record.initializeThread().messages[0];
    let textRuns = 0; let sourceRuns = 0; let identityRuns = 0;
    createComputed(() => { void prior.content; textRuns++; });
    createComputed(() => { void prior.text_source?.revision; sourceRuns++; });
    createComputed(() => { void record.initializeThread().messages; identityRuns++; });
    const next = { ...current, view_version: 2, items: [{ ...current.items![0], text: 'Text next' }] };
    const refreshed = createRuntimeThreadRecord(next, applyFlowerRuntimeCurrentView(base, next), record);
    expect(refreshed.initializeThread().messages[0]).toBe(prior);
    expect(prior.content).toBe('Text next');
    expect({ textRuns, sourceRuns, identityRuns }).toEqual({ textRuns: 2, sourceRuns: 2, identityRuns: 1 });
    refreshed.apply(refreshed.initializeThread(), { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 2, view_version: 3,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, items: [{ kind: 'append', item_id: 'one', append: { offset_bytes: 9, text: '!' } }] });
    expect(prior.content).toBe('Text next!');
    expect(prior.text_source?.read(0)).toEqual([' next', '!']);
  } finally { dispose(); }
}));
