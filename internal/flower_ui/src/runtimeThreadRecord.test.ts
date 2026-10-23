import { describe, expect, it, vi } from 'vitest';
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
  it('freezes observed thinking across replacement, hydration and reconnect without inventing historical timing', () => {
    const started = Date.parse('2026-10-23T12:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(started + 4000);
      const { current, initial } = fixture();
      const thinking = { ...current.items![0], kind: 'thinking' as const, created_at: new Date(started).toISOString() };
      const live = { ...current, items: [thinking] };
      const projected = applyFlowerRuntimeCurrentView(initial, live);
      const record = createRuntimeThreadRecord(live, projected);
      expect(record.initializeThread().messages[0].thinking_timing).toEqual({ started_at_ms: started });
      record.apply(record.initializeThread(), append());
      vi.setSystemTime(started + 9000);
      // Canonical installation may replace the draft creation timestamp.
      const sealed = { ...thinking, live: false, text: '中文', created_at: new Date(started + 9000).toISOString(),
        body: { field: 'reasoning', source_id: thinking.id, bytes: 10, preview_bytes: 6 } };
      const update = { ...append(2), items: [{ kind: 'replace' as const, item_id: thinking.id, item: sealed }] };
      record.apply(record.initializeThread(), update);
      const expected = { started_at_ms: started, ended_at_ms: started + 9000 };
      expect(record.initializeThread().messages[0].thinking_timing).toEqual(expected);
      vi.setSystemTime(started + 120_000);
      expect(record.hydrate(sealed, { ...sealed, body: undefined, text: '中文🌸' })).toBe(true);
      expect(record.initializeThread().messages[0].thinking_timing).toEqual(expected);
      const history = { ...live, view_version: 4, items: [sealed] };
      const refreshed = applyFlowerRuntimeCurrentView(record.initializeThread(), history);
      expect(refreshed.messages[0].thinking_timing).toEqual(expected);
      const reconnected = createRuntimeThreadRecord(history, applyFlowerRuntimeCurrentView(initial, history), record);
      expect(reconnected.initializeThread().messages[0].thinking_timing).toEqual(expected);
      expect(applyFlowerRuntimeCurrentView(initial, history).messages[0].thinking_timing).toBeUndefined();
      const otherRun = { ...history, items: [{ ...sealed, run_id: 'other-run' }] };
      expect(applyFlowerRuntimeCurrentView(refreshed, otherRun).messages[0].thinking_timing).toBeUndefined();
      const accepted = applyFlowerRuntimeCurrentView(projected, history);
      vi.setSystemTime(started + 180_000);
      const delayed = createRuntimeThreadRecord(history, accepted, createRuntimeThreadRecord(live, projected));
      expect(delayed.initializeThread().messages[0].thinking_timing).toEqual(accepted.messages[0].thinking_timing);
      const resumed = applyFlowerRuntimeCurrentView(refreshed, { ...live, view_version: 5 });
      expect(resumed.messages[0].thinking_timing).toEqual({ started_at_ms: started });
    } finally { vi.useRealTimers(); }
  });

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
  it('accepts an in-flight prefix while preserving the newer body extent', () => {
    const { current, initial } = fixture();
    const preview = { ...current.items![0], text: '中文', body: { field: 'content' as const, source_id: 'one', run_id: 'run', bytes: 10, preview_bytes: 6 } };
    const page = { ...current, items: [preview] };
    const record = createRuntimeThreadRecord(page, applyFlowerRuntimeCurrentView(initial, page));
    record.apply(record.initializeThread(), { ...append(), items: [{ kind: 'body', item_id: 'one', body: { ...preview.body, bytes: 11 } }] });
    expect(record.initializeThread().messages[0].body_pending?.bytes).toBe(11);
    expect(record.hydrate(preview, { ...preview, body: undefined, text: '中文🌸' })).toBe(true);
    expect(record.initializeThread().messages[0].content).toBe('中文🌸');
    expect(record.initializeThread().messages[0].body_pending?.bytes).toBe(11);
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


describe('continuous visible bodies', () => {
  it('keeps an ahead-of-observation read and settles trimmed canonical output once', () => {
    const { current, initial } = fixture();
    const preview = { ...current.items![0], text: '中文', body: { field: 'content', source_id: 'one', run_id: 'run', bytes: 10, preview_bytes: 6 } };
    const page = { ...current, items: [preview] };
    const record = createRuntimeThreadRecord(page, applyFlowerRuntimeCurrentView(initial, page));
    expect(record.hydrate(preview, { ...preview, body: undefined, text: '中文🌸!!  ' })).toBe(true);
    record.apply(record.initializeThread(), { ...append(), items: [{ kind: 'body', item_id: 'one', body: { ...preview.body, bytes: 11 } }] });
    expect(record.initializeThread().messages[0].content).toBe('中文🌸!!  ');
    expect(record.initializeThread().messages[0].body_pending).toBeUndefined();
    const canonical = { ...preview, live: false, canonical_ordinal: 2, body: { ...preview.body, run_id: undefined, bytes: 14 } };
    record.apply(record.initializeThread(), { ...append(2), items: [{ kind: 'replace', item_id: 'one', item: canonical }] });
    expect(record.hydrate(preview, { ...preview, body: undefined, text: '中文🌸wrong' })).toBe(false);
    expect(record.hydrate(record.item('one')!, { ...canonical, body: undefined, text: '中文🌸!!' })).toBe(true);
    expect(record.initializeThread().messages[0].content).toBe('中文🌸!!');
    expect(record.initializeThread().messages[0].body_pending).toBeUndefined();
  });
  it('advances only missing UTF-8 bytes and rejects duplicate or obsolete chunks', () => {
    const { current, initial } = fixture();
    const preview = { ...current.items![0], text: '中文', body: { field: 'content', source_id: 'one', run_id: 'run', bytes: 10, preview_bytes: 6 } };
    const page = { ...current, items: [preview] };
    const record = createRuntimeThreadRecord(page, applyFlowerRuntimeCurrentView(initial, page));
    const messages = record.initializeThread().messages;
    record.apply(record.initializeThread(), { ...append(), items: [{ kind: 'body', item_id: 'one', body: { ...preview.body, bytes: 11 } }] });
    const chunk = { thread_id: 'thread', run_id: 'run', source_id: 'one', offset_bytes: 6, through_bytes: 10, text: '🌸' };
    expect(record.appendBody({ ...chunk, run_id: 'obsolete' })).toBe(false);
    expect(record.appendBody(chunk)).toBe(true);
    expect(record.appendBody(chunk)).toBe(false);
    expect(record.bodyOffset('one')).toBe(10);
    expect(record.initializeThread().messages).toBe(messages);
    expect(messages[0].body_pending?.bytes).toBe(11);
    expect(record.appendBody({ ...chunk, offset_bytes: 10, through_bytes: 11, text: '!' })).toBe(true);
    expect(messages[0].content).toBe('中文🌸!');
    expect(messages[0].body_pending).toBeUndefined();
    expect(messages[0].text_source!.read(0)).toEqual(['🌸', '!']);
    const canonical = { ...preview, live: false, canonical_ordinal: 4, body: { ...preview.body, run_id: undefined, bytes: 11 } };
    record.apply(record.initializeThread(), { ...append(2), items: [{ kind: 'replace', item_id: 'one', item: canonical }] });
    expect(record.initializeThread().messages[0]).toBe(messages[0]);
    expect(messages[0].content).toBe('中文🌸!');
    expect(messages[0].body_pending?.retained).toBe(true);
    expect(record.appendBody({ ...chunk, offset_bytes: 11, through_bytes: 12, text: '?' })).toBe(false);
    expect(record.hydrate(record.item('one')!, { ...canonical, body: undefined, text: '中文🌸!' })).toBe(true);
    expect(messages[0].body_pending).toBeUndefined();
  });

  it('keeps accepted live text and message identity while its body grows', () => {
    const { current, initial } = fixture();
    const preview = { ...current.items![0], text: '中文', body: { field: 'content' as const, source_id: 'one', run_id: 'run', bytes: 10, preview_bytes: 6 } };
    const page = { ...current, items: [preview] };
    const record = createRuntimeThreadRecord(page, applyFlowerRuntimeCurrentView(initial, page));
    expect(record.hydrate(preview, { ...preview, body: undefined, text: '中文🌸' })).toBe(true);
    const message = record.initializeThread().messages[0];
    const messages = record.initializeThread().messages;
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    encode.mockClear();
    try {
      for (let version = 1; version <= 2000; version++) {
        record.apply(record.initializeThread(), { ...append(version), items: [{ kind: 'body', item_id: 'one', body: { ...preview.body, bytes: 10 + version } }] });
        expect(record.initializeThread().messages).toBe(messages);
        expect(record.initializeThread().messages[0]).toBe(message);
        expect(message.content).toBe('中文🌸');
        expect(message.body_pending).toMatchObject({ retained: true, bytes: 10 + version });
      }
      expect(encode).not.toHaveBeenCalled();
    } finally { encode.mockRestore(); }
  });

  it('retains expanded live text across an identical authoritative baseline', () => {
    const { current, initial } = fixture();
    const preview = { ...current.items![0], text: '中文', body: { field: 'content' as const, source_id: 'one', run_id: 'run', bytes: 10, preview_bytes: 6 } };
    const page = { ...current, items: [preview] };
    const record = createRuntimeThreadRecord(page, applyFlowerRuntimeCurrentView(initial, page));
    record.hydrate(preview, { ...preview, body: undefined, text: '中文🌸' });
    const next = createRuntimeThreadRecord({ ...page, view_version: 2 }, applyFlowerRuntimeCurrentView(initial, page), record);
    expect(next.initializeThread().messages[0].content).toBe('中文🌸');
    expect(next.initializeThread().messages[0].body_pending).toBeUndefined();
  });
});
