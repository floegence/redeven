import { describe, expect, it } from 'vitest';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerActivityItem } from './contracts/flowerSurfaceContracts';
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
const toolPreview = (id: string, name: string): Message => ({ ...text(id), blocks: [{
  type: 'tool_preview', key: `activity:${id}`, block_index: 0, block: { type: 'tool-call-preview', call: {
    thread_id: 'thread', turn_id: 'turn', run_id: 'run', logical_request_id: 'request',
    attempt_id: 'attempt', attempt_epoch: 0, call_id: id, name, arguments_complete: true, preview: null,
  } },
}] });

describe('consecutive tool presentation', () => {
  it('keeps leading thinking independent and groups thinking after the first tool', () => {
    const result = projectFlowerToolSequences([text('leading', true), tool('a'), text('middle', true), text('middle-two', true), tool('b'), text('trailing', true)]);
    const group = [...result.groups.values()][0];
    expect(result.groups.size).toBe(1);
    expect(group.toolCount).toBe(2);
    expect(group.thinkingCount).toBe(3);
    expect(result.members.has('leading')).toBe(false);
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
  it.each<Partial<FlowerActivityItem>>([
    { status: 'waiting' }, { requires_approval: true }, { needs_attention: true },
    { status: 'running', severity: 'normal', needs_attention: true, attention_reasons: ['approval'] },
    { status: 'running', severity: 'normal', needs_attention: true, attention_reasons: ['running', 'approval'] },
    { renderer: 'subagent_operation' }, { tool_name: 'subagent_events' }, { tool_name: 'subagents' },
    { tool_name: 'report_to_parent', target_refs: [{ kind: 'parent_event', label: 'parent' }] },
    { tool_name: 'ask_user' }, { kind: 'control' },
  ])('keeps attention and interactions as boundaries: %j', overrides => {
    expect(projectFlowerToolSequences([tool('a'), tool('boundary', overrides), tool('b')]).groups.size).toBe(0);
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
