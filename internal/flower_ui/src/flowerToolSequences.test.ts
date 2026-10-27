import { describe, expect, it } from 'vitest';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerActivityItem, FlowerParentEvent, FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';
import { projectFlowerToolSequences } from './flowerToolSequences';

type Message = Extract<FlowerTimelineEntry, { type: 'message' }>;
const text = (id: string, thinking = false): Message => ({ type: 'message', key: id,
  message: { id, role: 'assistant', content: '', created_at_ms: 1, status: 'complete', thread_id: 'thread', turn_id: 'turn', run_id: 'run' },
  blocks: [{ type: 'content', key: id, block_index: 0, block_type: thinking ? 'thinking' : 'text', content: id }],
});
const emptyLiveText = (id: string): Message => ({ ...text(id),
  message: { ...text(id).message, live: true, status: 'streaming' },
  blocks: [{ type: 'content', key: id, block_index: 0, block_type: 'text', content: '' }],
});
const tool = (id: string, overrides: Partial<FlowerActivityItem> = {}): Message => ({ ...text(id), blocks: [{
  type: 'activity', key: id, block_index: 0, block: { type: 'activity-timeline', schema_version: 1,
    thread_id: 'thread', run_id: 'run', turn_id: 'turn',
    summary: { status: 'success', severity: 'quiet', needs_attention: false, total_items: 1, counts: { success: 1 } },
    items: [{ item_id: id, tool_id: id, tool_name: 'terminal.exec', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false, ...overrides }],
  },
}] });
const scopedTool = (id: string, runID: string, overrides: Partial<FlowerActivityItem> = {}): Message => {
  const value = tool(id, overrides);
  const block = value.blocks[0];
  if (block.type !== 'activity') throw new Error('test tool fixture must be an activity');
  return { ...value, message: { ...value.message, run_id: runID }, blocks: [{ ...block, block: { ...block.block, run_id: runID } }] };
};
const toolPreview = (id: string, name: string): Message => ({ ...text(id), blocks: [{
  type: 'tool_preview', key: `activity:${id}`, block_index: 0, block: { type: 'tool-call-preview', call: {
    thread_id: 'thread', turn_id: 'turn', run_id: 'run', logical_request_id: 'request',
    attempt_id: 'attempt', attempt_epoch: 0, call_id: id, name, arguments_complete: true, preview: null,
  } },
}] });
const runtimeTurn = (changes: Partial<FlowerRuntimeTurn> = {}): FlowerRuntimeTurn => ({
  turn_id: 'turn', run_id: 'run', started_at: '2026-10-21T10:00:00Z', elapsed_ms: 0, waiting_ms: 0,
  work_duration_ms: 0, final_item_ids: [], final_boundary_complete: false, ...changes,
});
const parentEvent = (id: string, kind: FlowerParentEvent['kind'] = 'completed'): FlowerTimelineEntry => ({
  type: 'parent_event', key: `parent-event:${id}`, event: {
    id, parent_thread_id: 'thread', parent_turn_id: 'turn', source_thread_id: `child-${id}`,
    source_turn_id: `child-turn-${id}`, source_run_id: `child-run-${id}`, source_entry_id: `child-entry-${id}`,
    kind, received_at: '2026-10-21T10:00:00Z', admitted: true,
  },
});

describe('consecutive tool presentation', () => {
  it('reports counts only when the loaded sequence has both boundaries', () => {
    const entries = [tool('a'), tool('b')];
    for (const [hasBefore, hasAfter, complete] of [[true, false, false], [false, true, false], [true, true, false], [false, false, true]]) {
      const value = projectFlowerToolSequences(entries, 'thread', [], undefined, new Set(), { hasBefore, hasAfter });
      expect([...value.groups.values()][0].countsComplete).toBe(complete);
    }
    const bounded = projectFlowerToolSequences([text('before'), ...entries, text('after')], 'thread', [], undefined, new Set(), { hasBefore: true, hasAfter: true });
    expect([...bounded.groups.values()][0].countsComplete).toBe(true);
  });
  it('does not mistake an unloaded interval for a known sequence boundary', () => {
    const value = projectFlowerToolSequences([tool('a'), tool('b'), tool('c'), tool('d')], 'thread', [], undefined, new Set(['c']));
    expect([...value.groups.values()].map(group => group.countsComplete)).toEqual([false, false]);
    const bounded = projectFlowerToolSequences([tool('a'), tool('b'), text('before'), tool('c'), tool('d'), text('after')], 'thread', [], undefined, new Set(['before']));
    expect([...bounded.groups.values()].map(group => group.countsComplete)).toEqual([false, true]);
  });
  it('counts complete running sequences without requiring a settled turn or full bodies', () => {
    const entries = [text('before'), tool('a'), tool('b', { status: 'running' }), { ...text('thinking', true), message: { ...text('thinking', true).message, live: true, status: 'streaming' as const } }];
    const value = projectFlowerToolSequences(entries, 'thread', [], undefined, new Set(), { hasBefore: true, hasAfter: false });
    expect([...value.groups.values()][0]).toMatchObject({ countsComplete: true, toolCount: 2, thinkingCount: 1, runningCount: 1 });
  });
  it('retains a partial group identity when normal pagination completes its prefix', () => {
    const first = projectFlowerToolSequences([tool('c'), tool('d')], 'thread', [], undefined, new Set(), { hasBefore: true, hasAfter: false });
    const prior = [...first.groups.values()][0];
    const next = projectFlowerToolSequences([text('boundary'), tool('a'), tool('b'), tool('c'), tool('d')], 'thread', [], first, new Set(), { hasBefore: true, hasAfter: false });
    expect([...next.groups.values()][0]).toMatchObject({ key: prior.key, countsComplete: true, toolCount: 4 });
    expect(prior.countsComplete).toBe(false);
  });
  it('keeps empty pending text uncertain without downloading its body for counts', () => {
    const pending = { ...emptyLiveText('pending'), message: { ...text('pending').message, body_pending: { kind: 'text' as const, bytes: 8000 } } };
    const value = projectFlowerToolSequences([tool('a'), tool('b'), pending, tool('c'), tool('d')]);
    expect([...value.groups.values()].map(group => group.countsComplete)).toEqual([false, false]);
  });
  it('withholds only groups that overlap missing parent event intervals', () => {
    const entries = [text('start'), tool('a'), tool('b'), text('middle'), tool('c'), tool('d'), text('end')]
      .map((entry, index) => ({ ...entry, message: { ...entry.message, canonical_ordinal: index * 10 + 10 } }));
    for (const missingEvents of [[{ after: 15, before: 35 }], [{ after: -Infinity, before: 15 }]]) {
      const value = projectFlowerToolSequences(entries, 'thread', [], undefined, new Set(), { hasBefore: false, hasAfter: false, missingEvents });
      expect([...value.groups.values()].map(group => group.countsComplete)).toEqual([false, true]);
    }
    const complete = projectFlowerToolSequences(entries, 'thread', [], undefined, new Set(), { hasBefore: true, hasAfter: true,
      missingEvents: [{ after: -Infinity, before: 10 }, { after: 70, before: Infinity }] });
    expect([...complete.groups.values()].map(group => group.countsComplete)).toEqual([true, true]);
  });
  it('waits through tool gaps and streaming prose, then folds after output completes', () => {
    const calls = [tool('a'), tool('b')];
    const policy = (entries: FlowerTimelineEntry[], turns: FlowerRuntimeTurn[] = []) =>
      [...projectFlowerToolSequences(entries, 'thread', turns).groups.values()][0].disclosure;
    expect(policy(calls)).toBe('manual');
    expect(policy([...calls, emptyLiveText('next')])).toBe('manual');
    expect(policy([...calls, { ...text('next'), message: { ...text('next').message, live: true, status: 'streaming' } }])).toBe('manual');
    expect(policy([...calls, text('next')])).toBe('automatic');
    for (const outcome of ['completed', 'failed', 'cancelled', 'interrupted'] as const) {
      expect(policy(calls, [runtimeTurn({ outcome, ended_at: '2026-10-21T10:01:00Z' })])).toBe('automatic');
    }
  });
  it('does not join tool sequences across an unloaded reading interval', () => {
    const entries = [tool('a'), tool('b'), tool('c'), tool('d')];
    const value = projectFlowerToolSequences(entries, 'thread', [], undefined, new Set(['c']));
    expect([...value.groups.values()].map(group => group.toolCount)).toEqual([2, 2]);
    expect([...value.groups.values()].map(group => group.entryKeys)).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('keeps field-backed safety facts identical to complete presentation boundaries', () => {
    for (const [complete, summary] of [
      [{ payload: { error: { message: 'unconfirmed' } } }, { has_error: true }],
      [{ chips: [{ kind: 'effect_outcome', label: 'Result unconfirmed', value: 'uncertain' }] }, { uncertain_effect: true }],
    ] as const) {
      const full = projectFlowerToolSequences([tool('a'), tool('boundary', complete), tool('b')]);
      const partial = projectFlowerToolSequences([tool('a'), tool('boundary', { field_summary: { fields: [], ...summary } }), tool('b')]);
      expect(partial).toEqual(full);
      expect(partial.groups.size).toBe(0);
    }
    const wait = { tool_name: 'subagents', renderer: 'subagent_operation' as const, status: 'waiting' as const, severity: 'blocking' as const,
      needs_attention: true, attention_reasons: ['waiting' as const] };
    expect(projectFlowerToolSequences([tool('a'), tool('wait', { ...wait, field_summary: { action: 'wait', fields: [] } }), tool('b')]))
      .toEqual(projectFlowerToolSequences([tool('a'), tool('wait', { ...wait, payload: { action: 'wait' } }), tool('b')]));
  });
  it('retains unchanged projections and replaces only changed groups', () => {
    const entries = [tool('a'), tool('b'), text('prose'), tool('c'), tool('d')];
    const first = projectFlowerToolSequences(entries, 'thread');
    const contentOnly = [...entries, { ...text('streamed prose'), message: { ...text('streamed prose').message, live: true, status: 'streaming' as const } }];
    const unchanged = projectFlowerToolSequences(contentOnly, 'thread', [], first);
    expect(unchanged).toBe(first);
    const changed = projectFlowerToolSequences([tool('a'), tool('b'), text('prose'), tool('c'), tool('d', { status: 'running' })], 'thread', [], first);
    const [stableKey, changedKey] = [...first.groups.keys()];
    expect(changed.groups.get(stableKey)).toBe(first.groups.get(stableKey));
    expect(changed.members.get(stableKey)).toBe(first.members.get(stableKey));
    expect(changed.groups.get(changedKey)).not.toBe(first.groups.get(changedKey));
    expect(changed.groups.get(changedKey)?.runningCount).toBe(1);
    expect(first.groups.get(changedKey)?.runningCount).toBe(0);
    const removed = projectFlowerToolSequences([text('only prose')], 'thread', [], changed);
    expect(removed).toEqual(projectFlowerToolSequences([text('only prose')], 'thread'));
  });
  it('matches fresh projection through membership, authority and status changes', () => {
    const variants = [
      [tool('a'), tool('b')],
      [tool('a'), tool('b'), text('thinking', true)],
      [tool('a'), tool('b', { status: 'running' }), text('thinking', true)],
      [tool('a'), tool('b', { requires_approval: true }), text('thinking', true)],
      [tool('a'), scopedTool('b', 'other-run'), text('thinking', true)],
      [tool('a'), tool('b'), text('prose'), tool('c'), tool('d')],
      [tool('c'), tool('d'), text('prose'), tool('a'), tool('b')],
      [tool('c'), tool('d', { status: 'error', needs_attention: true, severity: 'error' })],
      [],
    ];
    let previous = projectFlowerToolSequences([], 'thread');
    for (const entries of variants) {
      const before = structuredClone(previous);
      const next = projectFlowerToolSequences(entries, 'thread', [], previous);
      expect(next).toEqual(projectFlowerToolSequences(entries, 'thread'));
      expect(previous).toEqual(before);
      previous = next;
    }
  });
  it('groups adjacent leading, middle, and trailing thinking with tools', () => {
    const result = projectFlowerToolSequences([text('leading', true), tool('a'), text('middle', true), text('middle-two', true), tool('b'), text('trailing', true)]);
    const group = [...result.groups.values()][0];
    expect(result.groups.size).toBe(1);
    expect(group.toolCount).toBe(2);
    expect(group.thinkingCount).toBe(4);
    expect(result.members.get('leading')?.group).toBe(group);
    expect(result.members.get('trailing')?.group).toBe(group);
    expect(result.members.get('middle')?.group).toBe(group);
  });
  it('groups web search, goal tools and trailing thinking under one disclosure', () => {
    const result = projectFlowerToolSequences([
      tool('search', { tool_name: 'web_search', renderer: 'web_search' }),
      tool('goal', { tool_name: 'goal', renderer: 'structured' }),
      text('after-goal', true),
    ]);
    const group = [...result.groups.values()][0];
    expect(result.groups.size).toBe(1);
    expect(group).toMatchObject({ toolCount: 2, thinkingCount: 1, failedCount: 0 });
    expect(group.nodeKeys).toHaveLength(3);
    expect([...result.members.values()].filter(member => member.group === group)).toHaveLength(3);
  });
  it('allows one tool and its following thought to be folded together', () => {
    const result = projectFlowerToolSequences([tool('only'), text('after', true)]);
    const group = [...result.groups.values()][0];
    expect(group).toMatchObject({ toolCount: 1, thinkingCount: 1 });
    expect(result.members.get('after')?.group).toBe(group);
  });
  it('treats goal call previews like ordinary calls while preserving explicit input boundaries', () => {
    const goalPreview = projectFlowerToolSequences([tool('search'), toolPreview('goal-preview', 'goal'), tool('last')]);
    expect([...goalPreview.groups.values()][0]).toMatchObject({ toolCount: 3 });
    expect(projectFlowerToolSequences([tool('a'), toolPreview('question', 'ask_user'), tool('b')]).groups.size).toBe(0);
  });
  it('folds older settled sequences while retaining the latest and active calls', () => {
    const result = projectFlowerToolSequences([tool('a'), tool('b'), text('progress'), tool('c'), tool('d', { status: 'running' }), text('update'), tool('e'), tool('f')]);
    expect([...result.groups.values()].map(group => group.disclosure)).toEqual(['automatic', 'manual', 'manual']);
    expect([...result.groups.values()][1].runningCount).toBe(1);
  });
  it('groups failed and successful tool calls and reports failures without treating them as active', () => {
    const failed = tool('failed', { status: 'error', severity: 'error', needs_attention: true, attention_reasons: ['error'], payload: { error: { message: 'Denied' } } });
    const result = projectFlowerToolSequences([failed, tool('success')]);
    const group = [...result.groups.values()][0];
    expect(result.groups.size).toBe(1);
    expect(group.toolCount).toBe(2);
    expect(group.failedCount).toBe(1);
    expect(group.runningCount).toBe(0);
  });
  it('groups failed tools with any error attention shape', () => {
    const result = projectFlowerToolSequences([
      tool('failed', { status: 'error', severity: 'error', needs_attention: true }),
      tool('succeeded'),
    ]);
    expect([...result.groups.values()][0]).toMatchObject({ toolCount: 2, failedCount: 1 });
  });
  it('keeps normal running attention inside the tool sequence', () => {
    const result = projectFlowerToolSequences([
      tool('a'),
      tool('running', { status: 'running', severity: 'normal', needs_attention: true, attention_reasons: ['running'] }),
      tool('c'),
    ]);
    expect([...result.groups.values()][0]).toMatchObject({ toolCount: 3, runningCount: 1 });
  });
  it('keeps an active SubAgent wait foldable and counts it as running', () => {
    const result = projectFlowerToolSequences([
      tool('before'),
      tool('wait', { tool_name: 'subagents', renderer: 'subagent_operation', status: 'waiting', severity: 'blocking',
        needs_attention: true, attention_reasons: ['waiting'], payload: { action: 'wait' } }),
      tool('after'),
    ]);
    expect([...result.groups.values()][0]).toMatchObject({ toolCount: 3, runningCount: 1 });
  });
  it.each<Partial<FlowerActivityItem>>([
    { status: 'waiting' }, { requires_approval: true }, { needs_attention: true },
    { status: 'running', severity: 'normal', needs_attention: true, attention_reasons: ['approval'] },
    { status: 'running', severity: 'normal', needs_attention: true, attention_reasons: ['running', 'approval'] },
    { tool_name: 'ask_user' }, { kind: 'control' },
  ])('keeps attention and interactions as boundaries: %j', overrides => {
    expect(projectFlowerToolSequences([tool('a'), tool('boundary', overrides), tool('b')]).groups.size).toBe(0);
  });
  it('folds SubAgent activity, adjacent thinking, and ordinary tools as one sequence', () => {
    const result = projectFlowerToolSequences([
      text('leading', true),
      tool('subagent-a', { tool_name: 'subagents', renderer: 'subagent_operation' }),
      text('middle', true),
      tool('subagent-b', { tool_name: 'subagents', renderer: 'subagent_operation' }),
      text('trailing', true),
    ]);
    expect(result.groups.size).toBe(1);
    const group = [...result.groups.values()][0];
    expect(group).toMatchObject({ toolCount: 2, thinkingCount: 3, subagentEventCount: 0 });
    expect([...result.members.values()].map(member => [member.first, member.last])).toEqual([
      [true, false], [false, false], [false, false], [false, false], [false, true],
    ]);
  });
  it('folds canonical SubAgent reports and completion rows between tools and thinking', () => {
    const entries = [
      text('thinking-before', true),
      tool('spawn', { tool_name: 'subagents', renderer: 'subagent_operation' }),
      parentEvent('report', 'report'),
      text('thinking-middle', true),
      parentEvent('completed'),
      tool('read-result', { tool_name: 'subagent_events', renderer: 'subagent' }),
      parentEvent('failed', 'failed'),
    ];
    const result = projectFlowerToolSequences(entries, 'thread', [runtimeTurn()]);
    const group = [...result.groups.values()][0];
    expect(result.groups.size).toBe(1);
    expect(group).toMatchObject({ toolCount: 2, thinkingCount: 2, subagentEventCount: 3, failedSubagentEventCount: 1 });
    expect(group.entryKeys).toEqual(entries.map(entry => entry.key));
    expect(group.disclosure).toBe('manual');
    expect(result.members.get('parent-event:report')?.group).toBe(group);
    expect(result.members.get('parent-event:completed')?.group).toBe(group);
    expect(result.continuingEntries).toEqual(new Set(entries.slice(0, -1).map(entry => entry.key)));
  });
  it.each(['input_required', 'approval_required'] as const)('keeps parent %s events as sequence boundaries', kind => {
    const entries = [tool('a'), parentEvent('interaction', kind), tool('b')];
    expect(projectFlowerToolSequences(entries, 'thread', [runtimeTurn()]).groups.size).toBe(0);
  });
  it('auto-collapses an older SubAgent sequence and keeps the newest one available', () => {
    const result = projectFlowerToolSequences([
      tool('older-tool'), parentEvent('older-event'), tool('separating-tool'),
      text('prose'), tool('newer-tool'), parentEvent('newer-event'),
    ], 'thread', [runtimeTurn()]);
    expect([...result.groups.values()].map(group => group.disclosure)).toEqual(['automatic', 'manual']);
  });
  it('requires exact parent-thread and turn-to-run authority for SubAgent event continuity', () => {
    const event = parentEvent('completed');
    const otherThread = { ...event, event: { ...(event as Extract<FlowerTimelineEntry, { type: 'parent_event' }>).event, parent_thread_id: 'other' } };
    const otherTurn = { ...event, event: { ...(event as Extract<FlowerTimelineEntry, { type: 'parent_event' }>).event, parent_turn_id: 'missing' } };
    const uncertain = { ...event, event: { ...(event as Extract<FlowerTimelineEntry, { type: 'parent_event' }>).event, reason_code: 'effect_outcome_unknown' } };
    for (const candidate of [otherThread, otherTurn, uncertain]) {
      expect(projectFlowerToolSequences([tool('a'), candidate, tool('b')], 'thread', [runtimeTurn()]).groups.size).toBe(0);
    }
    expect(projectFlowerToolSequences([tool('a'), event, tool('b')], 'thread').groups.size).toBe(0);
    expect(projectFlowerToolSequences([tool('a'), event, tool('b')], 'thread', [runtimeTurn(), runtimeTurn({ run_id: 'other-run' })]).groups.size).toBe(0);
  });
  it('folds report_to_parent tool results while preserving interaction and uncertainty boundaries', () => {
    const report = tool('report', { tool_name: 'report_to_parent', target_refs: [{ kind: 'parent_event', label: 'parent' }] });
    expect(projectFlowerToolSequences([report, tool('next')]).groups.values().next().value?.toolCount).toBe(2);
    const uncertain = tool('uncertain', { chips: [{ kind: 'effect_outcome', label: 'uncertain', value: 'uncertain' }] });
    expect(projectFlowerToolSequences([tool('a'), uncertain, tool('b')]).groups.size).toBe(0);
  });
  it('keeps returned uncertain errors in one stable sequence with a visible count', () => {
    const prior = projectFlowerToolSequences([tool('a'), tool('uncertain', { status: 'running' })]);
    const uncertain = { status: 'error' as const, severity: 'error' as const, needs_attention: true };
    const full = projectFlowerToolSequences([tool('a'), tool('uncertain', { ...uncertain,
      chips: [{ kind: 'effect_outcome', label: 'result', value: 'uncertain' }] }), tool('b')], undefined, [], prior);
    const partial = projectFlowerToolSequences([tool('a'), tool('uncertain', { ...uncertain,
      field_summary: { fields: [], uncertain_effect: true } }), tool('b')]);
    expect(partial).toEqual(full);
    expect(full.groups.size).toBe(1);
    const group = [...full.groups.values()][0];
    expect(group).toMatchObject({ toolCount: 3, failedCount: 1, uncertainCount: 1 });
    expect(group.key).toBe([...prior.groups.keys()][0]);
    expect(projectFlowerToolSequences([tool('a'), tool('uncertain', { ...uncertain, requires_approval: true }), tool('b')]).groups.size).toBe(0);
  });
  it('keeps recorded goal state messages outside tool sequences', () => {
    const source = text('goal-state');
    const goalState: Message = { ...source, message: { ...source.message, goal: {
      goal: { version: 1, text: 'Review the release', status: 'active', actor: 'model' },
      operation: 'set', actor: 'model', at: '2026-10-21T10:00:00Z',
    } } };
    expect(projectFlowerToolSequences([tool('a'), goalState, tool('b')]).groups.size).toBe(0);
  });
  it('does not cross prose, user, event, compaction, run or turn boundaries', () => {
    const boundaries: FlowerTimelineEntry[] = [text('prose'), { ...text('user'), message: { ...text('user').message, role: 'user' } },
      { type: 'error', key: 'error', error: { message: 'Failure' } }];
    for (const boundary of boundaries) expect(projectFlowerToolSequences([tool('a'), boundary, tool('b')]).groups.size).toBe(0);
    const other = tool('other');
    expect(projectFlowerToolSequences([tool('a'), { ...other, message: { ...other.message, run_id: 'other' } }]).groups.size).toBe(0);
  });
  it('keeps both tool groups folded when a resolved user interaction separates them', () => {
    const answer: Message = { ...text('answer'), message: { ...text('answer').message, role: 'user' }, blocks: [{
      type: 'input_response', key: 'answer:0', block_index: 0,
      block: { type: 'input-response', questions: [{ question_id: 'continue', question: 'Continue?', answer: 'Yes' }] },
    }] };
    const result = projectFlowerToolSequences([
      tool('before-one'), tool('before-two'), answer, tool('after-one'), tool('after-two'),
    ], 'thread', [runtimeTurn({ outcome: 'interrupted', ended_at: '2026-10-21T10:01:00Z' })]);
    expect([...result.groups.values()].map(group => [group.toolCount, group.disclosure])).toEqual([
      [2, 'automatic'], [2, 'automatic'],
    ]);
  });
  it('keeps continuation-run tool groups folded after a resolved interaction', () => {
    const answer: Message = { ...text('answer'), message: { ...text('answer').message, role: 'user', run_id: 'run-a' }, blocks: [{
      type: 'input_response', key: 'answer:0', block_index: 0,
      block: { type: 'input-response', questions: [{ question_id: 'continue', question: 'Continue?', answer: 'Yes' }] },
    }] };
    const result = projectFlowerToolSequences([
      scopedTool('before-one', 'run-a'), scopedTool('before-two', 'run-a'), answer,
      scopedTool('after-one', 'run-b'), scopedTool('after-two', 'run-b'),
    ], 'thread', [runtimeTurn({ run_id: 'run-b', outcome: 'interrupted', ended_at: '2026-10-21T10:01:00Z' })]);
    expect([...result.groups.values()].map(group => [group.toolCount, group.disclosure])).toEqual([
      [2, 'automatic'], [2, 'automatic'],
    ]);
  });
  it('ages an earlier group when the newest segment contains just one tool', () => {
    expect([...projectFlowerToolSequences([tool('a'), tool('b'), text('progress'), tool('c')]).groups.values()][0].disclosure).toBe('automatic');
  });
  it('rejects activity whose execution scope differs from its containing message', () => {
    const other = tool('other');
    expect(projectFlowerToolSequences([tool('a'), { ...other, message: { ...other.message, thread_id: 'different' } }]).groups.size).toBe(0);
  });
  it('retains a sequence identity through status updates and later appends', () => {
    const first = projectFlowerToolSequences([tool('a'), tool('b', { status: 'running' })]);
    const next = projectFlowerToolSequences([tool('a'), tool('b'), text('thought', true), tool('c')]);
    expect([...first.groups.keys()]).toEqual([...next.groups.keys()]);
    expect([...next.groups.values()][0].toolCount).toBe(3);
  });
  it('keeps live empty assistant placeholders transparent to tool continuity and row spacing', () => {
    const result = projectFlowerToolSequences([
      tool('a'), tool('b'), emptyLiveText('live-empty-1'), tool('c', { status: 'running' }),
      emptyLiveText('live-empty-2'), tool('d', { status: 'running' }),
    ]);
    const group = [...result.groups.values()][0];
    expect(result.groups.size).toBe(1);
    expect(group.toolCount).toBe(4);
    expect(group.runningCount).toBe(2);
    expect(group.entryKeys).toEqual(['a', 'b', 'live-empty-1', 'c', 'live-empty-2', 'd']);
    expect([...result.continuingEntries]).toEqual(['a', 'b', 'live-empty-1', 'c', 'live-empty-2']);
  });
});
