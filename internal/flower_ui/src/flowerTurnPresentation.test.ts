import { describe, expect, it } from 'vitest';
import { projectFlowerHistorySections, projectFlowerTurnProcess, flowerDurationParts } from './flowerTurnPresentation';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerActivityItem, FlowerRuntimeTurn, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { parentProcessEvents } from './flowerParentEventProcess.testFixture';

type MessageEntry = Extract<FlowerTimelineEntry, { type: 'message' }>;
const entry = (id: string, role: 'user' | 'assistant' = 'assistant'): MessageEntry => ({
  type: 'message', key: id,
  message: { id, role, turn_id: 'turn', run_id: 'run', content: id, status: 'complete', created_at_ms: 1 }, blocks: [],
});
const turn = (changes: Partial<FlowerRuntimeTurn> = {}): FlowerRuntimeTurn => ({
  turn_id: 'turn', run_id: 'run', started_at: '2026-10-11T12:00:00Z', ended_at: '2026-10-11T12:02:18Z',
  outcome: 'completed', elapsed_ms: 138000, waiting_ms: 0, work_duration_ms: 138000,
  intermediate_item_ids: ['progress'], final_item_ids: ['final-a', 'final-b'], final_boundary_complete: true, ...changes,
});
const entries = [entry('user', 'user'), entry('progress'), entry('final-a'), entry('final-b')];
const thinking: MessageEntry = {
  ...entry('thinking'), blocks: [{ type: 'content', key: 'thinking:0', block_index: 0, block_type: 'thinking', content: 'Inspecting evidence.' }],
};
const toolEntry = (id: string, status: FlowerActivityItem['status'] = 'success'): MessageEntry => ({
  ...entry(id), blocks: [{ type: 'activity', key: `${id}:0`, block_index: 0,
    block: { type: 'activity-timeline', schema_version: 1, thread_id: 'thread', turn_id: 'turn', run_id: 'run',
      summary: { status, severity: status === 'error' ? 'error' : 'quiet', needs_attention: status === 'error', total_items: 1, counts: { [status]: 1 } },
      items: [{ item_id: id, tool_id: id, tool_name: 'terminal.exec', kind: 'tool', status,
        severity: status === 'error' ? 'error' : 'quiet', needs_attention: status === 'error', requires_approval: false }],
    },
  }],
});
const inputResponse = (): MessageEntry => ({
  ...entry('answer', 'user'), blocks: [{ type: 'input_response', key: 'answer:0', block_index: 0,
    block: { type: 'input-response', questions: [{ question_id: 'retry', question: 'Retry the hook?', answer: 'Yes' }] },
  }],
});
const withRun = (value: MessageEntry, runID: string): MessageEntry => ({
  ...value,
  message: { ...value.message, run_id: runID },
  blocks: value.blocks.map((block) => block.type === 'activity'
    ? { ...block, block: { ...block.block, run_id: runID } }
    : block),
});

describe('canonical turn process presentation', () => {
  it('reads canonical membership once when projecting a long turn', () => {
    const rows = Array.from({ length: 600 }, (_, index) => entry('part-' + index));
    let reads = 0;
    const members = new Proxy(rows.map(row => row.message.id), { get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    } });
    const projected = projectFlowerTurnProcess(rows, [turn({ intermediate_item_ids: members, final_item_ids: [] })]);
    expect(projected.groups.get('turn')?.processKeys).toEqual(rows.map(row => row.key));
    expect(reads).toBeLessThanOrEqual(rows.length);
  });

  it('retains the complete projection through content-only updates', () => {
    const facts = [turn()];
    const first = projectFlowerTurnProcess(entries, facts);
    const changed = entries.map(row => ({ ...row, message: { ...row.message, content: 'Updated text' } }));
    expect(projectFlowerTurnProcess(changed, facts, [], first)).toBe(first);
    const next = projectFlowerTurnProcess([...changed, entry('new')], facts, [], first);
    expect(next).not.toBe(first);
    expect(next.rows.has('new')).toBe(true);
  });

  it('treats goal continuation as business work with the existing disclosure owner', () => {
    expect(projectFlowerTurnProcess(entries, [turn({ kind: 'goal_continuation' })]).groups.get('turn')?.disclosure).toBe('automatic');
    expect(projectFlowerTurnProcess([thinking], [turn({ kind: 'goal_continuation', outcome: 'failed' })]).groups.get('turn')?.disclosure).toBe('none');
  });

  it('preserves historical groups when only the active turn structure changes', () => {
    const previousTurn = turn();
    const first = projectFlowerTurnProcess([thinking, ...entries], [previousTurn]);
    const active = { ...entry('new'), message: { ...entry('new').message, turn_id: 'next', run_id: 'next-run' } };
    const next = projectFlowerTurnProcess([thinking, ...entries, active], [previousTurn, turn({ turn_id: 'next', run_id: 'next-run', outcome: undefined, ended_at: undefined })], ['next'], first);
    expect(next.groups.get('turn')).toBe(first.groups.get('turn'));
    expect(next.rows.get('progress')).toBe(first.rows.get('progress'));
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('collapses historical %s work after a newer ordinary turn starts', outcome => {
    const old = turn({ outcome, final_item_ids: [], final_boundary_complete: false });
    const next = turn({ turn_id: 'next', run_id: 'next-run', outcome: undefined, ended_at: undefined });
    expect(projectFlowerTurnProcess([thinking, ...entries], [old, next]).groups.get('turn')?.disclosure).toBe('automatic');
    expect(projectFlowerTurnProcess([thinking, ...entries], [old, turn({ turn_id: 'compact', kind: 'context_compaction' })]).groups.get('turn')?.disclosure).toBe('automatic');
  });
  it.each(['set', 'completed', 'delete'] as const)('folds canonical in-turn Goal %s facts across runs and leaves unowned edits visible', operation => {
    const goal = { goal: { version: 1, text: 'Verify changes', status: 'active' as const, actor: 'model' as const }, actor: 'model' as const, operation, at: '2026-10-18T12:00:00Z' };
    const model: MessageEntry = { ...entry('goal'), message: { ...entry('goal').message, role: 'system', goal } };
    const independent: MessageEntry = { ...model, key: 'independent-goal', message: { ...model.message, id: 'independent-goal', turn_id: undefined, run_id: undefined } };
    const mismatched: MessageEntry = { ...model, key: 'mismatched-goal', message: { ...model.message, id: 'mismatched-goal', run_id: 'other-run' } };
    const projected = projectFlowerTurnProcess([entries[0], model, thinking, independent, mismatched, ...entries.slice(1)], [turn()]);
    expect(projected.groups.get('turn')?.processKeys).toEqual(['goal', 'thinking', 'mismatched-goal', 'progress']);
    expect(projected.rows.has('independent-goal')).toBe(false);
    expect(projected.rows.get('mismatched-goal')?.processKeys).toContain('mismatched-goal');
  });

  const events: FlowerTimelineEntry[] = parentProcessEvents.map((event) => ({ type: 'parent_event', key: 'parent-event:' + event.id, event }));
  it('folds all eleven canonical child dynamics with failed work, including late receipts', () => {
    const projected = projectFlowerTurnProcess([thinking, ...entries, ...events], [turn({ outcome: 'failed', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })]);
    const group = projected.groups.get('turn')!;
    expect(group.disclosure).toBe('automatic');
    expect(group.parentEventCount).toBe(11);
    expect(group.processKeys).toEqual(['thinking', ...events.map((event) => event.key)]);
    expect(events.every((event) => projected.rows.get(event.key) === group)).toBe(true);
    expect(group.terminalKey).toBe('final-b');
  });
  it('uses explicit ownership across turns and leaves missing or unknown authority visible', () => {
    const first = events[0] as Extract<FlowerTimelineEntry, { type: 'parent_event' }>;
    const input = [first, { ...first, key: 'next', event: { ...first.event, parent_turn_id: 'next' } },
      { ...first, key: 'unowned', event: { ...first.event, parent_turn_id: undefined } },
      { ...first, key: 'missing', event: { ...first.event, parent_turn_id: 'missing' } }];
    const projected = projectFlowerTurnProcess(input, [turn(), turn({ turn_id: 'next', run_id: 'next-run' })]);
    expect(projected.groups.get('turn')?.processKeys).toEqual([first.key]);
    expect(projected.groups.get('next')?.summaryKey).toBe('next');
    expect(projected.rows.has('unowned')).toBe(false);
    expect(projected.rows.get('missing')?.disclosure).toBe('none');
  });
  it.each(['input_required', 'approval_required'] as const)('keeps admitted unresolved %s visible until explicitly resolved', (kind) => {
    const base = parentProcessEvents[0];
    const pending: FlowerTimelineEntry = { type: 'parent_event', key: 'pending', event: { ...base, kind, interaction_id: 'interaction', admitted: true } };
    const unsafe: FlowerTimelineEntry = { type: 'parent_event', key: 'unsafe', event: { ...base, kind: 'failed', reason_code: 'effect_outcome_unknown', resolved: true } };
    const projected = projectFlowerTurnProcess([thinking, pending, unsafe], [turn()]);
    expect(projected.groups.get('turn')?.processKeys).toEqual(['thinking']);
    expect(projected.groups.get('turn')?.parentEventCount).toBe(0);
    const resolved = { ...pending, event: { ...pending.event, resolved: true } };
    expect(projectFlowerTurnProcess([resolved], [turn()]).groups.get('turn')?.processKeys).toEqual(['pending']);
  });
  it.each([
    ['computer.screenshot', `computer://browser/${'a'.repeat(64)}`, 'automatic'],
    ['computer.screenshot', 'computer://browser/invalid', 'automatic'],
    ['computer.screenshot', undefined, 'automatic'],
    ['computer.observe', `computer://browser/${'a'.repeat(64)}`, 'automatic'],
  ] as const)('collapses successful work including %s with %s', (tool_name, resource_ref, disclosure) => {
    const item: FlowerActivityItem = { item_id: 'capture', tool_id: 'capture', tool_name, kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
      target_refs: resource_ref ? [{ kind: 'computer_frame', label: 'Saved screenshot', resource_ref }] : [],
    };
    const screenshot: MessageEntry = { ...entry('capture'), blocks: [{ type: 'activity', key: 'capture:0', block_index: 0,
      block: { type: 'activity-timeline', schema_version: 1, items: [item], summary: { status: 'success', severity: 'quiet', needs_attention: false, total_items: 1, counts: { success: 1 } } },
    }] };
    expect(projectFlowerTurnProcess([screenshot, ...entries], [turn()]).groups.get('turn')?.disclosure).toBe(disclosure);
  });
  it('retains the thinking disclosure without wrapping uncertain assistant content', () => {
    const result = projectFlowerTurnProcess([entries[0], thinking, ...entries.slice(1)], [turn({ intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })]).groups.get('turn');
    expect(result?.disclosure).toBe('none');
    expect(result?.processKeys).toEqual(['thinking']);
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('retains the single thinking disclosure after %s work', (outcome) => {
    const result = projectFlowerTurnProcess([thinking, ...entries], [turn({ outcome, intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })]).groups.get('turn');
    expect(result?.disclosure).toBe('none');
    expect(result?.processKeys).toEqual(['thinking']);
  });
  it('keeps mixed thinking and answer rows visible when their final boundary is unknown', () => {
    const mixed: MessageEntry = { ...thinking, blocks: [...thinking.blocks, { type: 'content', key: 'answer', block_index: 1, block_type: 'markdown', content: 'The answer.' }] };
    const result = projectFlowerTurnProcess([mixed, ...entries], [turn({ intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })]).groups.get('turn');
    expect(result?.disclosure).toBe('none');
    expect(result?.processKeys).toEqual([]);
  });
  it('never offers manual disclosure for active, pending, context-only, or unknown turns', () => {
    expect(projectFlowerTurnProcess([thinking], []).groups.get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess([thinking], [turn({ ended_at: undefined, outcome: undefined })]).groups.get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess([thinking], [turn({ kind: 'context_compaction' })]).groups.get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess([thinking, ...entries], [turn()], ['turn']).groups.get('turn')?.disclosure).toBe('none');
  });
  it('keeps attachments and user messages outside a legacy process', () => {
    const image: MessageEntry = { ...entry('image'), blocks: [...thinking.blocks, { type: 'image', key: 'image:0', block_index: 1, src: '/image.png' }] };
    const answer = entry('answer', 'user');
    const result = projectFlowerTurnProcess([thinking, image, answer, ...entries], [turn({ intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })]).groups.get('turn');
    expect(result?.processKeys).toEqual(['thinking']);
    expect(result?.disclosure).toBe('none');
  });
  it('keeps every explicit final segment and user message outside the process', () => {
    const result = projectFlowerTurnProcess(entries, [turn()]);
    expect(result.groups.get('turn')?.processKeys).toEqual(['progress']);
    expect(result.groups.get('turn')?.summaryKey).toBe('progress');
    expect(result.groups.get('turn')?.disclosure).toBe('automatic');
  });
  it('reports whole-turn counts only with complete loaded boundaries and no gaps', () => {
    const rows = [entry('user', 'user'), toolEntry('before'), inputResponse(), toolEntry('after')];
    const project = (values: readonly FlowerTimelineEntry[], coverage: Parameters<typeof projectFlowerTurnProcess>[4]) =>
      projectFlowerTurnProcess(values, [turn()], [], undefined, coverage).groups.get('turn');
    expect(project(rows, { hasBefore: true, hasAfter: false })?.countsComplete).toBe(true);
    expect(project(rows.slice(1), { hasBefore: true, hasAfter: false })?.countsComplete).toBe(false);
    expect(project(rows, { hasBefore: false, hasAfter: true })?.countsComplete).toBe(false);
    expect(project(rows, { hasBefore: false, hasAfter: false, readingBreaks: new Set(['after']) })?.countsComplete).toBe(false);
    expect(project(rows, { hasBefore: false, hasAfter: false, missingEvents: [{ after: 1, before: 10 }] })?.countsComplete).toBe(false);
    expect(project(rows, { hasBefore: false, hasAfter: false })?.countsComplete).toBe(true);
    const neighbor = { ...entry('neighbor', 'user'), message: { ...entry('neighbor', 'user').message, turn_id: 'neighbor' } };
    expect(project([neighbor, ...rows.slice(1)], { hasBefore: true, hasAfter: false, readingBreaks: new Set(['before']) })?.countsComplete).toBe(false);
    expect(project([...rows, neighbor], { hasBefore: false, hasAfter: true, readingBreaks: new Set(['neighbor']) })?.countsComplete).toBe(false);
  });
  it('allows manual folding when an answered interaction separates work segments', () => {
    const before = [toolEntry('before-one'), toolEntry('before-two')];
    const after = [toolEntry('after-one'), toolEntry('after-two', 'error')];
    const result = projectFlowerTurnProcess([...before, inputResponse(), ...after], [turn({
      outcome: 'interrupted', ended_at: '2026-10-11T12:02:18Z', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false,
    })]).groups.get('turn');
    expect(result).toMatchObject({
      disclosure: 'manual', interleavedInputs: true, inputResponseCount: 1, toolCallCount: 4, failedCallCount: 1,
      processKeys: [...before, ...after].map(value => value.key),
    });
  });
  it('anchors before old-run prose while folding only canonically confirmed work', () => {
    const intro = withRun(entry('intro'), 'run-a');
    const unknown = withRun(entry('unknown'), 'run-a');
    const goal: MessageEntry = { ...entry('goal'), message: { ...entry('goal').message, role: 'system', run_id: 'run-a',
      goal: { actor: 'model', operation: 'set', at: '2026-10-18T12:00:00Z', goal: { version: 1, text: 'Inspect', status: 'active', actor: 'model' } } } };
    const rows = [entry('user', 'user'), unknown, intro, goal, withRun(toolEntry('before'), 'run-a'), inputResponse(), withRun(toolEntry('after'), 'run-b')];
    const result = projectFlowerTurnProcess(rows, [turn({ run_id: 'run-b', intermediate_item_ids: ['intro'] })]).groups.get('turn');
    expect(result?.summaryKey).toBe('unknown');
    expect(result?.processKeys).toEqual(['intro', 'goal', 'before', 'after']);
    expect(result?.interleavedInputs).toBe(true);
  });
  it('moves the header when pagination prepends visible prose without changing process membership', () => {
    const facts = [turn({ intermediate_item_ids: [] })];
    const tail = [toolEntry('tool')];
    const first = projectFlowerTurnProcess(tail, facts, [], undefined, { hasBefore: true, hasAfter: false });
    const next = projectFlowerTurnProcess([entry('user', 'user'), entry('unknown'), ...tail], facts, [], first);
    expect(first.groups.get('turn')?.summaryKey).toBe('tool');
    expect(next.groups.get('turn')?.summaryKey).toBe('unknown');
    expect(next.groups.get('turn')).not.toBe(first.groups.get('turn'));
  });
  it('allows manual folding and counts work across a continuation run', () => {
    const before = [withRun(toolEntry('before-one'), 'run-a'), withRun(toolEntry('before-two'), 'run-a')];
    const answer = withRun(inputResponse(), 'run-a');
    const after = [withRun(toolEntry('after-one'), 'run-b'), withRun(toolEntry('after-two', 'error'), 'run-b')];
    const result = projectFlowerTurnProcess([...before, answer, ...after], [turn({ run_id: 'run-b', outcome: 'interrupted',
      ended_at: '2026-10-11T12:02:18Z', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })]).groups.get('turn');
    expect(result).toMatchObject({ disclosure: 'manual', interleavedInputs: true, inputResponseCount: 1, toolCallCount: 4, failedCallCount: 1 });
  });
  it('keeps ordinary dialogue outside the process without changing its disclosure', () => {
    const result = projectFlowerTurnProcess([toolEntry('before-one'), toolEntry('before-two'), entry('ordinary-user', 'user'), toolEntry('after-one')], [turn()]).groups.get('turn');
    expect(result?.interleavedInputs).toBe(false);
    expect(result?.disclosure).toBe('automatic');
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('keeps %s turns expanded', (outcome) => {
    expect(projectFlowerTurnProcess(entries, [turn({ outcome, intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })]).groups.get('turn')?.disclosure).toBe('none');
  });
  it('uses explicit intermediate references without depending on successful final boundaries', () => {
    for (const outcome of ['completed', 'failed', 'cancelled', 'interrupted'] as const) {
      const group = projectFlowerTurnProcess(entries, [turn({ outcome, final_item_ids: [], final_boundary_complete: false })]).groups.get('turn');
      expect(group?.processKeys).toEqual(['progress']);
      expect(group?.disclosure).toBe('automatic');
    }
    expect(projectFlowerTurnProcess(entries, [turn({ intermediate_item_ids: undefined })]).groups.get('turn')?.processKeys).toEqual([]);
    expect(projectFlowerTurnProcess(entries.slice(0, -1), [turn()]).groups.get('turn')?.processKeys).toEqual(['progress']);
  });
  it('does not create an empty summary or summarize context-only work', () => {
    expect(projectFlowerTurnProcess(entries.filter((e) => e.key !== 'progress'), [turn()]).groups.get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess(entries, [turn({ kind: 'context_compaction' })]).groups.get('turn')?.disclosure).toBe('none');
  });
  it('formats no more than two meaningful units with an explicit subsecond state', () => {
    expect(flowerDurationParts(999)).toEqual([]);
    expect(flowerDurationParts(42000)).toEqual([{ unit: 'second', count: 42 }]);
    expect(flowerDurationParts(138000)).toEqual([{ unit: 'minute', count: 2 }, { unit: 'second', count: 18 }]);
    expect(flowerDurationParts(3901000)).toEqual([{ unit: 'hour', count: 1 }, { unit: 'minute', count: 5 }]);
  });
});

it('folds every automatic compaction by its own turn and leaves manual compaction independent', () => {
  const compact = (id: string, turnID: string): FlowerTimelineEntry => ({
    type: 'context_compaction', key: id, decoration: {
      decoration_id: id, kind: 'context_compaction', ordinal: 0,
      anchor: { target_kind: 'message', message_id: 'final-b', edge: 'after' },
      compaction: { operation_id: id, turn_id: turnID, canonical_ordinal: 10, run_id: 'run', phase: 'complete', status: 'compacted', updated_at_ms: 1 },
    },
  });
  const rows = [compact('one', 'turn'), compact('two', 'turn'), compact('three', 'turn'), compact('manual', 'manual')];
  const projected = projectFlowerTurnProcess(rows, [turn(), turn({ turn_id: 'manual', kind: 'context_compaction' })]);
  expect(projected.groups.get('turn')?.processKeys).toEqual(['one', 'two', 'three']);
  expect(projected.groups.get('turn')?.summaryKey).toBe('one');
  expect(projected.groups.get('turn')?.disclosure).toBe('automatic');
  expect(projected.groups.get('manual')?.disclosure).toBe('none');
});

describe('history layout sections', () => {
  const active = { thread_id: 'thread', status: 'running', current_execution: { turn_id: 'turn', run_id: 'run' } } as FlowerThreadSnapshot;
  const row = (index: number): MessageEntry => ({ ...entry('row-' + index), blocks: [{ type: 'content', key: 'text-' + index, block_index: 0, block_type: 'markdown', content: 'Visible prose' }] });

  it('bounds membership reads linearly as one active turn grows', () => {
    const rows = Array.from({ length: 6000 }, (_, i) => row(i));
    let reads = 0;
    for (const value of rows) Object.defineProperty(value.message, 'turn_id', { get() { reads++; return 'turn'; } });
    const sections = projectFlowerHistorySections(rows, active);
    expect(sections).toHaveLength(250);
    expect(sections.every(section => section.entries.length === 24)).toBe(true);
    expect(sections.flatMap(section => section.entries)).toEqual(rows);
    expect(reads).toBeLessThanOrEqual(rows.length * 4);
  });

  it('preserves mounted partitions through growth, prepend and terminal settlement', () => {
    const rows = Array.from({ length: 70 }, (_, i) => row(i));
    const before = projectFlowerHistorySections(rows, active);
    const expanded = [...Array.from({ length: 3 }, (_, i) => ({ ...row(-i - 1), message: { ...row(-i - 1).message, turn_id: 'older' } })), ...rows, row(70)];
    const after = projectFlowerHistorySections(expanded, active, before);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    expect(after[3].key).toBe(before[2].key);
    expect(after[3].entries).toEqual([...before[2].entries, expanded.at(-1)]);
    expect(projectFlowerHistorySections(expanded, { ...active, status: 'success' }, after)).toEqual(after);
  });

  it('preserves interleaved turn boundaries', () => {
    const rows = ['a', 'b', 'b', 'a', 'c', 'd', 'c'].map((id, i) => {
      const value = row(i);
      return { ...value, message: { ...value.message, turn_id: id }, blocks: [] };
    });
    const sections = projectFlowerHistorySections(rows, undefined);
    expect(sections.map(section => section.entries.map(entry => entry.key))).toEqual([['row-0', 'row-1', 'row-2', 'row-3'], ['row-4', 'row-5', 'row-6']]);
  });
});
