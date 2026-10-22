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

describe('consecutive tool presentation', () => {
  it('includes only thinking bounded by tools and keeps factual counts', () => {
    const result = projectFlowerToolSequences([text('leading', true), tool('a'), text('middle', true), text('middle-two', true), tool('b'), text('trailing', true)]);
    const group = [...result.groups.values()][0];
    expect(result.groups.size).toBe(1);
    expect(group.toolCount).toBe(2);
    expect(group.thinkingCount).toBe(2);
    expect(result.members.has('leading')).toBe(false);
    expect(result.members.has('trailing')).toBe(false);
    expect(result.members.get('middle')?.group).toBe(group);
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
  it.each<Partial<FlowerActivityItem>>([
    { status: 'waiting' }, { requires_approval: true }, { needs_attention: true },
    { renderer: 'subagent_operation' }, { tool_name: 'subagent_events' }, { tool_name: 'goal' }, { kind: 'control' },
  ])('keeps attention and interactions as boundaries: %j', overrides => {
    expect(projectFlowerToolSequences([tool('a'), tool('boundary', overrides), tool('b')]).groups.size).toBe(0);
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
