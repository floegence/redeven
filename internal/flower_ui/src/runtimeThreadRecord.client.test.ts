import { createComputed, createMemo, createRoot } from 'solid-js';
import { $RAW, createStore, unwrap } from 'solid-js/store';
import { expect, it } from 'vitest';
import { readPresentationValue } from './presentationIdentity';
import { createRuntimeThreadRecord } from './runtimeThreadRecord';
import { createThreadCache } from './threadCache';
import { retainThreadFileActivityTargets } from './fileActivityTargets';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';
import { projectFlowerTurnProcess } from './flowerTurnPresentation';
import { createFlowerSequenceTokens, projectFlowerToolSequences } from './flowerToolSequences';
import { buildFlowerTimelineEntries, createFlowerTimelineProjection } from './flowerTimelineProjection';
import type { FlowerRuntimeCurrentView, FlowerRuntimeUpdate, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

it('adopts equal-version observation membership without scanning or remounting retained history', () => createRoot(dispose => {
  try {
    const all = Array.from({ length: 600 }, (_, index) => ({ id: 'history-' + index, ordinal: index + 1, canonical_ordinal: index + 1,
      kind: 'assistant' as const, turn_id: 'turn', run_id: 'run', text: 'Completed prose ' + index }));
    const turn = { turn_id: 'turn', run_id: 'run', started_at: '2026-01-01T00:00:00Z', ended_at: '2026-01-01T00:00:01Z',
      outcome: 'completed' as const, final_boundary_complete: true, elapsed_ms: 1000, waiting_ms: 0, work_duration_ms: 1000 };
    const turns = (items: typeof all) => [{ ...turn, final_item_ids: items.map(item => item.id) }];
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 7, activity: 'idle', items: all, turns: turns(all),
      window: { leaf_id: 'leaf', first_item_id: all[0].id, last_item_id: all.at(-1)!.id, has_before: false, has_after: false } };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'idle', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const receive = (cache: ReturnType<typeof createThreadCache>, next: FlowerRuntimeCurrentView) => cache.receiveCurrent({
      version: 7, thread: applyFlowerRuntimeCurrentView(base, next),
    }, { current: next });
    let cache = receive(createThreadCache().select('thread'), current).cache;
    const document = cache.runtimeDocument('thread');
    const thread = cache.views.get('thread')!.thread, messages = thread.messages;
    let renders = 0;
    createComputed(() => { void thread.messages; renders++; });
    const narrow = { ...current, items: all.slice(-2), turns: turns(all.slice(-2)), window: { ...current.window!, first_item_id: all.at(-2)!.id, has_before: true } };
    cache = receive(cache, narrow).cache;
    expect(cache.runtimeDocument('thread')).toBe(document);
    expect(cache.runtimeItemIDs('thread')).toEqual(all.slice(-2).map(item => item.id));
    const raw = readPresentationValue(messages), historical = raw[200];
    let historicalReads = 0;
    Object.defineProperty(raw, 200, { configurable: true, get() { historicalReads++; return historical; } });
    try {
      const expandedItems = [all[100], ...all.slice(-2)];
      const expanded = { ...narrow, items: expandedItems, turns: turns(expandedItems), window: { ...narrow.window, first_item_id: all[100].id } };
      const result = receive(cache, expanded);
      cache = result.cache;
      expect(result.runtimeState).toBe('accepted');
      expect(cache.runtimeDocument('thread')).toBe(document);
      expect(cache.runtimeItemIDs('thread')).toEqual(expanded.items.map(item => item.id));
      expect(cache.readingItemIDs('thread')).toHaveLength(600);
      const duplicate = receive(cache, structuredClone(expanded));
      expect(duplicate.runtimeState).toBe('unchanged');
      expect(duplicate.cache).toBe(cache);
      expect(historicalReads).toBe(0);
      expect(thread.messages).toBe(messages);
      expect(renders).toBe(1);
      cache.receiveUpdate({ thread_id: 'thread', base_version: 7, view_version: 8, facts: { activity: 'idle', queue_count: 0 },
        items: [{ kind: 'replace', item_id: all[100].id, item: expanded.items[0] }] }, { installedInterest: true });
      expect(cache.views.get('thread')!.version).toBe(8);
      expect(thread.turns?.[0].final_item_ids).toEqual(all.map(item => item.id));
    } finally { Object.defineProperty(raw, 200, { configurable: true, writable: true, value: historical }); }
  } finally { dispose(); }
}));

it('keeps covered body responses inert for text, timeline and historical subscribers', () => createRoot(dispose => {
  try {
    const item = { id: 'one', kind: 'assistant' as const, ordinal: 2, turn_id: 'turn', run_id: 'run', text: '中文', live: true,
      body: { field: 'content', source_id: 'one', run_id: 'run', bytes: 11, preview_bytes: 6 } };
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'streaming' },
      items: [{ id: 'old', kind: 'assistant', ordinal: 1, turn_id: 'oldturn', run_id: 'oldrun', text: 'History' }, item] };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    record.apply(record.initializeThread(), { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 1, view_version: 2,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, items: [{ kind: 'replace', item_id: 'one', item: { ...item, live: false, text: '中文🌸', body: { ...item.body, preview_bytes: 10 } } }] });
    const thread = record.initializeThread();
    const timeline = createFlowerTimelineProjection();
    let text = 0, structure = 0, historical = 0;
    createComputed(() => { void thread.messages[1].content; text++; });
    createComputed(() => { timeline(thread); structure++; });
    createComputed(() => { void thread.messages[0].content; historical++; });
    for (let index = 0; index < 100; index++) {
      expect(record.appendBody({ ...item.body, thread_id: 'thread', item_id: 'one', offset_bytes: 6, through_bytes: 11, text: '🌸' })).toBe('covered');
    }
    expect({ text, structure, historical }).toEqual({ text: 1, structure: 1, historical: 1 });
    expect(record.bodyOffset('one')).toBe(10);
    expect(record.appendBody({ ...item.body, thread_id: 'thread', item_id: 'one', offset_bytes: 10, through_bytes: 11, text: '!' })).toBe('applied');
    expect({ text, structure, historical }).toEqual({ text: 2, structure: 1, historical: 1 });
  } finally { dispose(); }
}));

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
    expect(refreshed.initializeThread()).toBe(record.initializeThread());
    expect(refreshed.initializeThread().messages[0]).toBe(prior);
    expect(prior.content).toBe('Text next');
    expect({ textRuns, sourceRuns, identityRuns }).toEqual({ textRuns: 2, sourceRuns: 2, identityRuns: 1 });
    refreshed.apply(refreshed.initializeThread(), { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 2, view_version: 3,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, items: [{ kind: 'append', item_id: 'one', append: { offset_bytes: 9, text: '!' } }] });
    expect(prior.content).toBe('Text next!');
    expect(prior.text_source?.read(0)).toEqual([' next', '!']);
  } finally { dispose(); }
}));

it('keeps completed tool and thinking owners across a narrowed same-run baseline', () => createRoot(dispose => {
  try {
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'streaming' },
      window: { leaf_id: 'leaf', first_item_id: 'thought-0', last_item_id: 'tool-599', has_before: false, has_after: false },
      items: Array.from({ length: 600 }, (_, i) => [
        { id: 'thought-' + i, kind: 'thinking' as const, ordinal: i * 2 + 1, turn_id: 'turn', run_id: 'run', text: 'Completed thought ' + i },
        { id: 'tool-' + i, kind: 'tool' as const, ordinal: i * 2 + 2, turn_id: 'turn', run_id: 'run',
          activity: { item_id: 'tool-' + i, tool_id: 'call-' + i, tool_name: 'inspect', kind: 'tool', status: 'success', severity: 'normal' } },
      ]).flat() };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    let record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread(), members = thread.messages;
    const rows = [...members];
    const next = { ...current, view_version: 2, items: current.items!.slice(-50).map(item => structuredClone(item)),
      window: { ...current.window!, first_item_id: 'thought-575', has_before: true } };
    record = createRuntimeThreadRecord(next, applyFlowerRuntimeCurrentView(thread, next), record);
    expect(record.initializeThread()).toBe(thread);
    expect(thread.messages).toBe(members);
    expect(thread.messages.every((message, i) => message === rows[i])).toBe(true);
  } finally { dispose(); }
}));


it('updates a preview subscriber without rebuilding completed tools or the timeline', () => createRoot(dispose => {
  try {
    const call = { thread_id: 'thread', turn_id: 'turn', run_id: 'run', logical_request_id: 'request',
      attempt_id: 'attempt', attempt_epoch: 1, call_id: 'call', name: 'write', arguments_complete: false, preview: { additions: 1 } };
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'streaming' }, tool_call_previews: [call], items: [{ id: 'done', kind: 'tool', ordinal: 1, turn_id: 'turn', run_id: 'run',
        activity: { item_id: 'done', tool_id: 'done', tool_name: 'read', kind: 'tool', status: 'success', severity: 'normal' } }] };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread();
    const messages = thread.messages, preview = messages.at(-1)!;
    const timeline = createFlowerTimelineProjection();
    let previews = 0, historical = 0, structures = 0;
    createComputed(() => { const block = preview.blocks?.[0]; if (block?.type === 'tool-call-preview') void block.call.preview; previews++; });
    createComputed(() => { void thread.messages[0].blocks; historical++; });
    createComputed(() => { timeline(thread); structures++; });
    record.apply(thread, { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 1, view_version: 2,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
      tool_call_previews: { value: [{ ...call, preview: { additions: 2 } }] } });
    expect({ previews, historical, structures }).toEqual({ previews: 2, historical: 1, structures: 1 });
    expect(thread.messages).toBe(messages);
    expect(thread.messages.at(-1)).toBe(preview);
    expect(preview.blocks?.[0]).toMatchObject({ type: 'tool-call-preview', call: { preview: { additions: 2 } } });
    record.apply(thread, { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 2, view_version: 3,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, tool_call_previews: { value: [] } });
    expect(thread.messages).toHaveLength(1);
    expect(structures).toBe(2);
  } finally { dispose(); }
}));

it('does not reproject completed tools when unrelated argument previews arrive or leave', () => createRoot(dispose => {
  try {
    let activityReads = 0;
    const items = Array.from({ length: 600 }, (_, index) => ({ id: 'done-' + index, kind: 'tool' as const, ordinal: index, turn_id: 'turn', run_id: 'run',
      activity: { item_id: 'done-' + index, tool_id: 'done-' + index, tool_name: 'read', kind: 'tool' as const,
        get status() { activityReads++; return 'success' as const; }, severity: 'normal' as const } }));
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'streaming' }, tool_call_previews: [], items };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread();
    const call = { thread_id: 'thread', turn_id: 'turn', run_id: 'run', logical_request_id: 'request',
      attempt_id: 'attempt', attempt_epoch: 1, call_id: 'new-call', name: 'write', arguments_complete: false, preview: { additions: 1 } };
    activityReads = 0;
    record.apply(thread, { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 1, view_version: 2,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, tool_call_previews: { value: [call] } });
    expect(thread.messages.at(-1)?.blocks?.[0]).toMatchObject({ type: 'tool-call-preview', call });
    record.apply(thread, { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 2, view_version: 3,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, tool_call_previews: { value: [] } });
    expect(thread.messages).toHaveLength(600);
    expect(activityReads).toBe(0);
  } finally { dispose(); }
}));

it('keeps thinking text growth local to its content subscriber', () => createRoot(dispose => {
  try {
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run', run_progress: { phase: 'streaming' },
      items: [{ id: 'thinking', kind: 'thinking', ordinal: 1, turn_id: 'turn', run_id: 'run', text: 'Plan', live: true }] };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread();
    const timeline = createFlowerTimelineProjection();
    const message = thread.messages[0], blocks = message.blocks, block = blocks![0];
    let structures = 0, contents = 0;
    createComputed(() => { timeline(thread); structures++; });
    createComputed(() => { const value = message.blocks?.[0]; if (value?.type === 'thinking') void value.content; contents++; });
    let text = 'Plan';
    for (let index = 0; index < 100; index++) {
      record.apply(thread, { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: index + 1, view_version: index + 2,
        facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, items: [{ kind: 'append', item_id: 'thinking', append: { offset_bytes: new TextEncoder().encode(text).length, text: '中🌸' } }] });
      text += '中🌸';
    }
    expect(message.blocks?.[0]).toMatchObject({ type: 'thinking', content: text });
    expect(contents).toBe(101);
    expect(structures).toBe(1);
    expect(message.blocks).toBe(blocks);
    expect(message.blocks?.[0]).toBe(block);
  } finally { dispose(); }
}));

it('keeps grouping structural while observing sealed prose and tool outcomes', () => createRoot(dispose => {
  try {
    const start = '2026-10-28T00:00:00Z';
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run', run_progress: { phase: 'streaming' },
      turns: [{ turn_id: 'turn', run_id: 'run', started_at: start, elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0, final_item_ids: [], intermediate_item_ids: ['prose'], final_boundary_complete: false }],
      items: [{ id: 'prose', ordinal: 1, kind: 'assistant', turn_id: 'turn', run_id: 'run', text: 'Answer', live: true },
        ...['first', 'second'].map((id, i) => ({ id, ordinal: i + 2, kind: 'tool' as const, turn_id: 'turn', run_id: 'run',
          activity: { item_id: id, tool_id: id, tool_name: 'read', kind: 'tool', status: 'running', severity: 'normal' } }))] };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread(), project = createFlowerTimelineProjection();
    const entries = createMemo(() => project(thread)), sequenceTokens = createFlowerSequenceTokens(entries);
    let processRuns = 0, sequenceRuns = 0;
    const process = createMemo(() => { processRuns++; return projectFlowerTurnProcess(entries(), thread.turns, ['turn']); });
    const sequences = createMemo(() => { sequenceRuns++; return projectFlowerToolSequences(entries(), thread.thread_id, thread.turns, undefined, undefined, undefined, sequenceTokens()); });
    createComputed(process); createComputed(sequences);
    let text = 'Answer', version = 1;
    const apply = (items: FlowerRuntimeUpdate['items']) => record.apply(thread, { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: version++, view_version: version,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, items });
    for (let i = 0; i < 100; i++) {
      apply([{ kind: 'append', item_id: 'prose', append: { offset_bytes: new TextEncoder().encode(text).length, text: '中🌸' } }]); text += '中🌸';
    }
    expect({ processRuns, sequenceRuns }).toEqual({ processRuns: 1, sequenceRuns: 1 });
    expect(process().groups.get('turn')?.processMembers.has('message:prose')).toBe(false);
    apply([{ kind: 'replace', item_id: 'prose', item: { ...current.items![0], text, live: false } }]);
    expect(process().groups.get('turn')?.processMembers.has('message:prose')).toBe(true);
    const tool = current.items![2];
    apply([{ kind: 'replace', item_id: tool.id, item: { ...tool, activity: { ...tool.activity!, status: 'error', severity: 'error' } } }]);
    expect(process().groups.get('turn')?.failedCallCount).toBe(1);
    expect([...sequences().groups.values()][0]).toMatchObject({ toolCount: 2, failedCount: 1, runningCount: 1 });
    expect(thread.messages[0].content).toBe(text);
  } finally { dispose(); }
}));

it('preserves retained turn and coverage identities when only an observed tool changes', () => createRoot(dispose => {
  try {
    const turn = { turn_id: 'turn', run_id: 'run', started_at: '2026-10-28T00:00:00Z', elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0,
      final_item_ids: [], intermediate_item_ids: ['prose'], final_boundary_complete: false };
    const tool = { id: 'tool', ordinal: 2, kind: 'tool' as const, turn_id: 'turn', run_id: 'run',
      activity: { item_id: 'tool', tool_id: 'call', tool_name: 'read', kind: 'tool', status: 'running', severity: 'normal' } };
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'streaming' }, turns: [turn],
      window: { leaf_id: 'leaf', first_item_id: 'prose', last_item_id: 'tool', has_before: false, has_after: false },
      items: [{ id: 'prose', ordinal: 1, kind: 'assistant', turn_id: 'turn', run_id: 'run', text: 'Earlier explanation', canonical_ordinal: 1 }, tool] };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    let cache = createThreadCache().receiveCurrent({ version: 1, thread: applyFlowerRuntimeCurrentView(base, current) }, { current }).cache;
    const owner = cache.views.get('thread')!.thread;
    const narrowed = { ...current, view_version: 2, items: [tool], turns: [{ ...turn, intermediate_item_ids: [] }],
      window: { ...current.window!, first_item_id: 'tool', has_before: true } };
    cache = cache.receiveCurrent({ version: 2, thread: applyFlowerRuntimeCurrentView(base, narrowed) }, { current: narrowed }).cache;
    const thread = cache.views.get('thread')!.thread, turns = thread.turns, coverage = thread.history_window;
    expect(thread).toBe(owner);
    const archivedItem = cache.runtimeItem('thread', 'prose')!;
    const archivedOrdinal = archivedItem.ordinal;
    let archivedReads = 0;
    Object.defineProperty(archivedItem, 'ordinal', { configurable: true, get() { archivedReads++; return archivedOrdinal; } });
    cache = cache.receiveUpdate({ thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 2, view_version: 3,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
      items: [{ kind: 'replace', item_id: 'tool', item: { ...tool, window_bytes: 1000 } }] }).cache;
    expect(archivedReads).toBe(0);
    Object.defineProperty(archivedItem, 'ordinal', { configurable: true, value: archivedOrdinal });
    let turnRuns = 0, coverageRuns = 0;
    createComputed(() => { void thread.turns; turnRuns++; });
    createComputed(() => { void thread.history_window; coverageRuns++; });
    cache = cache.receiveUpdate({ thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 3, view_version: 4,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
      items: [{ kind: 'replace', item_id: 'tool', item: { ...tool, activity: { ...tool.activity, status: 'success' } } }] }).cache;
    expect(cache.views.get('thread')!.thread).toBe(thread);
    expect(thread.messages.find(message => message.id === 'tool')?.blocks?.[0]).toMatchObject({ type: 'activity-timeline', items: [{ status: 'success' }] });
    expect(thread.turns?.[0].intermediate_item_ids).toEqual(['prose']);
    expect(thread.turns).toBe(turns);
    expect(thread.history_window).toBe(coverage);
    expect({ turnRuns, coverageRuns }).toEqual({ turnRuns: 1, coverageRuns: 1 });
    cache = cache.receiveUpdate({ thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 4, view_version: 5,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
      turns: { value: [{ ...narrowed.turns[0], intermediate_item_ids: ['new-prose'] }] },
      items: [{ kind: 'add', item_id: 'new-prose', item: { id: 'new-prose', ordinal: 3, kind: 'assistant',
        turn_id: 'turn', run_id: 'run', text: 'Next explanation', live: true } }] }).cache;
    expect(cache.views.get('thread')!.thread.turns?.[0].intermediate_item_ids).toEqual(['prose', 'new-prose']);
    expect(thread.history_window?.last_item_id).toBe('new-prose');
    expect({ turnRuns, coverageRuns }).toEqual({ turnRuns: 2, coverageRuns: 2 });
  } finally { dispose(); }
}));

it('reads structural presentation values shallowly without changing ordinary inputs', () => createRoot(dispose => {
  try {
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'idle', items: [] };
    const ordinary = Object.freeze({ nested: Object.freeze({ value: 1 }) });
    expect(readPresentationValue(ordinary)).toBe(ordinary);
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'idle', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread();
    expect(readPresentationValue(thread)).toBe(unwrap(thread));
    let runs = 0; createComputed(() => { void readPresentationValue(thread).title; runs++; });
    record.syncMetadata({ ...thread, title: 'Updated' });
    expect(readPresentationValue(thread).title).toBe('Updated');
    expect(runs).toBe(1);
  } finally { dispose(); }
}));

it('does not reopen every retained reactive row when one timeline item arrives', () => createRoot(dispose => {
  try {
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'idle',
      items: Array.from({ length: 600 }, (_, index) => ({ id: 'retained-' + index, ordinal: index,
        kind: 'assistant' as const, turn_id: 'turn', run_id: 'run', text: 'Retained answer' })) };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'idle', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread(), project = createFlowerTimelineProjection();
    const before = project(thread);
    const arrived = { ...readPresentationValue(thread.messages[0]), id: 'arrived' };
    const raw = [...readPresentationValue(thread.messages), arrived];
    let indexedReads = 0;
    const source = new Proxy([...thread.messages, arrived], { get(target, key, receiver) {
      if (key === $RAW) return raw;
      if (typeof key === 'string' && /^\d+$/.test(key)) indexedReads++;
      return Reflect.get(target, key, receiver);
    } });
    const after = project({ ...thread, messages: source });
    expect(after).toHaveLength(601);
    expect(after[0]).toBe(before[0]);
    expect(indexedReads).toBeLessThan(4);
  } finally { dispose(); }
}));

it('reads retained baseline membership without opening each historical message proxy', () => createRoot(dispose => {
  try {
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'idle',
      items: Array.from({ length: 600 }, (_, index) => ({ id: 'history-' + index, ordinal: index + 1, kind: 'thinking' as const,
        turn_id: 'turn', run_id: 'run', text: 'Completed reasoning' })) };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'idle', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread(), raw = readPresentationValue(thread.messages);
    let indexedReads = 0;
    const messages = new Proxy(thread.messages, { get(target, key, receiver) {
      if (key === $RAW) return raw;
      if (typeof key === 'string' && /^\d+$/.test(key)) indexedReads++;
      return Reflect.get(target, key, receiver);
    } });
    const inspected = { ...thread, messages };
    const refreshed = applyFlowerRuntimeCurrentView(inspected, { ...current, view_version: 2, items: [current.items!.at(-1)!] });
    expect(refreshed.messages[0].id).toBe('history-599');
    expect(retainThreadFileActivityTargets(refreshed, inspected)).toBe(inspected);
    expect(indexedReads).toBe(0);
  } finally { dispose(); }
}));

it('retains timeline membership for identical replacements and empty preview boundaries', () => createRoot(dispose => {
  try {
    const items = Array.from({ length: 600 }, (_, index) => ({ id: 'item-' + index, kind: 'thinking' as const,
      ordinal: index + 1, turn_id: 'turn', run_id: 'run', text: 'Completed reasoning', live: false }));
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'streaming' }, interactions: [], queue: [], turns: [], tool_call_previews: [], items };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread();
    const original = thread.messages;
    const timeline = createFlowerTimelineProjection();
    let projections = 0;
    createComputed(() => { timeline(thread); projections++; });
    for (let version = 2; version <= 5; version++) record.apply(thread, { thread_id: 'thread', turn_id: 'turn', run_id: 'run',
      base_version: version - 1, view_version: version,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
      items: [{ kind: 'replace', item_id: items[0].id, item: { ...items[0] } }], tool_call_previews: { value: [] } });
    expect(thread.messages).toBe(original);
    expect(projections).toBe(1);
    expect(record.version).toBe(5);
  } finally { dispose(); }
}));

it('does not republish unchanged tool presentation for transport extent replacements', () => createRoot(dispose => {
  try {
    const tool = { id: 'tool', ordinal: 1, kind: 'tool' as const, turn_id: 'turn', run_id: 'run', window_bytes: 100,
      activity: { item_id: 'tool', tool_id: 'call', tool_name: 'read', kind: 'tool', status: 'running', severity: 'normal' } };
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'streaming' }, items: [tool] };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread(), membership = thread.messages, project = createFlowerTimelineProjection();
    let projections = 0; createComputed(() => { project(thread); projections++; });
    for (let version = 2; version <= 10; version++) record.apply(thread, { thread_id: 'thread', turn_id: 'turn', run_id: 'run',
      base_version: version - 1, view_version: version, facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
      items: [{ kind: 'replace', item_id: 'tool', item: { ...tool, window_bytes: version * 100 } }] });
    expect(record.item('tool')?.window_bytes).toBe(1000);
    expect(thread.messages).toBe(membership);
    expect(projections).toBe(1);
  } finally { dispose(); }
}));

it('publishes a structural batch without rescanning membership for each replaced message', () => createRoot(dispose => {
  try {
    const items = Array.from({ length: 80 }, (_, index) => ({ id: 'item-' + index, kind: 'thinking' as const,
      ordinal: index + 1, turn_id: 'turn', run_id: 'run', text: 'Original reasoning', live: true }));
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'streaming' }, interactions: [], queue: [], turns: [], items };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const record = createRuntimeThreadRecord(current, applyFlowerRuntimeCurrentView(base, current));
    const thread = record.initializeThread();
    const firstMessage = thread.messages[0];
    const membership = readPresentationValue(thread.messages);
    const first = membership[0];
    let scans = 0;
    Object.defineProperty(membership, 0, { configurable: true, get() { scans++; return first; } });
    const published: string[][] = [];
    createComputed(() => published.push(thread.messages.map(message => message.id)));
    scans = 0;
    record.apply(thread, { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 1, view_version: 2,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
      items: items.slice(1).map(item => ({ kind: 'replace', item_id: item.id, item: { ...item, text: 'Canonical reasoning', live: false } })) });
    Object.defineProperty(membership, 0, { configurable: true, writable: true, value: first });
    expect(scans).toBeLessThanOrEqual(2);
    expect(published).toHaveLength(2);
    expect(published[1]).toEqual(items.map(item => item.id));
    expect(thread.messages[0]).toBe(firstMessage);
    expect(thread.messages.slice(1).every(message => message.blocks?.[0]?.type === 'thinking'
      && message.blocks[0].content === 'Canonical reasoning' && !message.live)).toBe(true);
  } finally { dispose(); }
}));

it('keeps plain snapshot projections separate from their reactive message owners', () => createRoot(dispose => {
  try {
    const message = { id: 'live', turn_id: 'turn', run_id: 'run', role: 'assistant' as const,
      content: 'First', status: 'streaming' as const, live: true, created_at_ms: 1 };
    const base = { thread_id: 'thread', title: '', title_status: 'unset', title_generation: 0, created_at_ms: 1, updated_at_ms: 1,
      model_id: 'model', working_dir: '/', settings_revision: 0, status: 'running', source_label: '', target_labels: [], messages: [message],
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } } satisfies FlowerThreadSnapshot;
    const plain = buildFlowerTimelineEntries(base);
    const [live, set] = createStore(base);
    const reactive = createFlowerTimelineProjection()(live);
    expect(reactive[0]).not.toBe(plain[0]);
    let runs = 0, text = '';
    createComputed(() => {
      const entry = reactive[0];
      if (entry.type === 'message' && entry.blocks[0].type === 'content') text = entry.blocks[0].content;
      runs++;
    });
    set('messages', 0, 'content', 'Next');
    expect({ runs, text }).toEqual({ runs: 2, text: 'Next' });
    expect(buildFlowerTimelineEntries({ ...base, messages: [message] })[0]).toBe(plain[0]);
  } finally { dispose(); }
}));
