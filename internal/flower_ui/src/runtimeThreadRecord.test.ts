import { describe, expect, it } from 'vitest';
import { createRuntimeThreadRecord } from './runtimeThreadRecord';
import { FlowerLiveSyncError } from './flowerLiveWire';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';
import type { FlowerRuntimeCurrentView, FlowerRuntimeUpdate, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

function fixture() {
  const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run',
    run_progress: { phase: 'streaming' }, interactions: [], queue: [], turns: [],
    items: [{ id: 'one', kind: 'assistant', ordinal: 1, turn_id: 'turn', run_id: 'run', text: '中文🌸', live: true }] };
  const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
    model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
    read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
  const initial = applyFlowerRuntimeCurrentView(base, current);
  return { current, initial, record: createRuntimeThreadRecord(current, initial) };
}
function append(base = 1, text = '!', offset = 10): FlowerRuntimeUpdate {
  return { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: base, view_version: base + 1,
    facts: { activity: 'active', attention: {}, queue_count: 0, run_progress: { phase: 'streaming' } },
    items: [{ kind: 'append', item_id: 'one', append: { offset_bytes: offset, text } }] };
}

describe('runtime item records', () => {
  it('appends using UTF-8 offsets and retains message and list identity', () => {
    const { record } = fixture();
    const thread = record.initializeThread();
    const message = thread.messages[0];
    const next = record.apply(thread, append())!.thread;
    expect(next.messages).toBe(thread.messages);
    expect(next.messages[0]).toBe(message);
    expect(next.messages[0].content).toBe('中文🌸!');
    expect(record.apply(next, append())).toBeUndefined();
    expect(record.apply(next, append(2, 'a', 11))!.thread.messages[0].content).toBe('中文🌸!a');
  });
  it('rejects gaps, stale execution, and UTF-16 offsets without partial mutation', () => {
    const { record } = fixture(); const thread = record.initializeThread();
    for (const value of [append(3), append(1, '!', 4), { ...append(), run_id: 'old' }, { ...append(), items: [...append().items!, { kind: 'remove' as const, item_id: 'missing' }] }]) {
      expect(() => record.apply(thread, value)).toThrow();
      expect(record.version).toBe(1); expect(thread.messages[0].content).toBe('中文🌸');
    }
    expect(record.apply(thread, append())!.thread.messages[0].content).toBe('中文🌸!');
  });
  it('recovers offset gaps across presentation frames while rejecting invalid identities', () => {
    const { record } = fixture(); const thread = record.initializeThread();
    expect(() => record.apply(thread, append(1, '!', 4))).toThrow(FlowerLiveSyncError);
    for (const value of [{ ...append(), run_id: 'old' }, append(1, '!', -1)]) {
      try { record.apply(thread, value); throw new Error('accepted invalid update'); }
      catch (error) { expect(error).not.toBeInstanceOf(FlowerLiveSyncError); }
    }
    expect(record.version).toBe(1);
    expect(thread.messages[0].content).toBe('中文🌸');
  });
  it('does not enumerate historical presentation or unrelated components on an append', () => {
    const { record } = fixture(); const thread = record.initializeThread();
    const guarded = new Proxy(thread.messages, { get(target, key, receiver) {
      if (key === Symbol.iterator || ['map', 'filter', 'find', 'forEach', 'some'].includes(String(key))) throw new Error('historical traversal');
      return Reflect.get(target, key, receiver);
    } });
    expect(record.apply({ ...thread, messages: guarded }, append())!.thread.messages[0].content).toBe('中文🌸!');
  });
  it('distinguishes unchanged and cleared components and preserves terminal outcome', () => {
    const { record } = fixture(); const thread = record.initializeThread();
    const ended: FlowerRuntimeUpdate = { ...append(), facts: { activity: 'idle', attention: {}, queue_count: 0, last_outcome: 'completed' }, items: [], goal: { value: null }, interactions: { value: [] }, queue: { value: [] } };
    const next = record.apply(thread, ended)!.thread;
    expect(next.status).toBe('success'); expect(next.run_progress).toBeNull(); expect(next.goal).toBeUndefined();
    expect(next.queued_turns).toEqual([]); expect(next.approval_actions).toEqual([]);
  });
});

describe('bounded history body residency', () => {
  it('retains an expanded immutable body across an identical baseline without another fetch', () => {
    const { current, initial } = fixture();
    const preview = { ...current.items![0], live: false, text: '中文', body: { field: 'content' as const, source_id: 'one', bytes: 10, preview_bytes: 6 } };
    const page = { ...current, items: [preview] };
    const first = createRuntimeThreadRecord(page, applyFlowerRuntimeCurrentView(initial, page));
    expect(first.hydrate(preview, { ...preview, body: undefined, text: '中文🌸' })).toBe(true);
    expect(first.initializeThread().messages[0].body_pending).toBeUndefined();
    const next = createRuntimeThreadRecord({ ...page, view_version: 2 }, applyFlowerRuntimeCurrentView(initial, page), first);
    expect(next.item('one')!.text).toBe('中文🌸');
    expect(next.initializeThread().messages[0].content).toBe('中文🌸');
    expect(next.initializeThread().messages[0].body_pending).toBeUndefined();
  });
  it('rejects stale body completions and renders a growing body locator immediately', () => {
    const { current, initial } = fixture();
    const preview = { ...current.items![0], text: '中文', body: { field: 'content' as const, source_id: 'one', run_id: 'run', bytes: 10, preview_bytes: 6 } };
    const page = { ...current, items: [preview] };
    const record = createRuntimeThreadRecord(page, applyFlowerRuntimeCurrentView(initial, page));
    record.apply(record.initializeThread(), { ...append(), items: [{ kind: 'body', item_id: 'one', body: { ...preview.body, bytes: 11 } }] });
    expect(record.initializeThread().messages[0].body_pending?.bytes).toBe(11);
    expect(record.hydrate(preview, { ...preview, body: undefined, text: '中文🌸' })).toBe(false);
    expect(record.initializeThread().messages[0].content).toBe('中文');
  });
});


describe('history page anchors', () => {
  it('advances page edges with accepted membership changes', () => {
    const { current, initial } = fixture();
    const page = { ...current, window: { first_item_id: 'one', last_item_id: 'one', has_before: true, has_after: false } };
    const record = createRuntimeThreadRecord(page, applyFlowerRuntimeCurrentView(initial, page));
    record.apply(record.initializeThread(), { ...append(), items: [{ kind: 'add', item_id: 'two', item: { ...current.items![0], id: 'two', ordinal: 2 } }] });
    expect(record.initializeThread().history_window).toEqual({ first_item_id: 'one', last_item_id: 'two', has_before: true, has_after: false });
    record.apply(record.initializeThread(), { ...append(2), items: [{ kind: 'remove', item_id: 'one' }] });
    expect(record.initializeThread().history_window?.first_item_id).toBe('two');
  });
});
