import { describe, expect, it } from 'vitest';
import { createRuntimeThreadRecord } from './runtimeThreadRecord';
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
