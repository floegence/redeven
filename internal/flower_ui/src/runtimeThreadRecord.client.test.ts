import { createComputed, createMemo, createRoot } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { expect, it } from 'vitest';
import { readPresentationValue } from './presentationIdentity';
import { createRuntimeThreadRecord } from './runtimeThreadRecord';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';
import { projectFlowerTurnProcess } from './flowerTurnPresentation';
import { createFlowerSequenceContent, projectFlowerToolSequences } from './flowerToolSequences';
import { createFlowerTimelineProjection } from './flowerTimelineProjection';
import type { FlowerRuntimeCurrentView, FlowerRuntimeUpdate, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

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
    expect(refreshed.initializeThread().messages[0]).toBe(prior);
    expect(prior.content).toBe('Text next');
    expect({ textRuns, sourceRuns, identityRuns }).toEqual({ textRuns: 2, sourceRuns: 2, identityRuns: 1 });
    refreshed.apply(refreshed.initializeThread(), { thread_id: 'thread', turn_id: 'turn', run_id: 'run', base_version: 2, view_version: 3,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, items: [{ kind: 'append', item_id: 'one', append: { offset_bytes: 9, text: '!' } }] });
    expect(prior.content).toBe('Text next!');
    expect(prior.text_source?.read(0)).toEqual([' next', '!']);
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
    const entries = createMemo(() => project(thread)), hasContent = createFlowerSequenceContent(entries);
    let processRuns = 0, sequenceRuns = 0;
    const process = createMemo(() => { processRuns++; return projectFlowerTurnProcess(entries(), thread.turns, ['turn']); });
    const sequences = createMemo(() => { sequenceRuns++; return projectFlowerToolSequences(entries(), thread.thread_id, thread.turns, undefined, undefined, undefined, hasContent); });
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
