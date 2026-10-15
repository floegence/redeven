import { describe, expect, it } from 'vitest';
import { projectFlowerTurnProcess, flowerDurationParts } from './flowerTurnPresentation';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerActivityItem, FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';

type MessageEntry = Extract<FlowerTimelineEntry, { type: 'message' }>;
const entry = (id: string, role: 'user' | 'assistant' = 'assistant'): MessageEntry => ({
  type: 'message', key: id,
  message: { id, role, turn_id: 'turn', run_id: 'run', content: id, status: 'complete', created_at_ms: 1 }, blocks: [],
});
const turn = (changes: Partial<FlowerRuntimeTurn> = {}): FlowerRuntimeTurn => ({
  turn_id: 'turn', run_id: 'run', started_at: '2026-10-11T12:00:00Z', ended_at: '2026-10-11T12:02:18Z',
  outcome: 'completed', elapsed_ms: 138000, waiting_ms: 0, work_duration_ms: 138000,
  final_item_ids: ['final-a', 'final-b'], final_boundary_complete: true, ...changes,
});
const entries = [entry('user', 'user'), entry('progress'), entry('final-a'), entry('final-b')];
const thinking: MessageEntry = {
  ...entry('thinking'), blocks: [{ type: 'content', key: 'thinking:0', block_index: 0, block_type: 'thinking', content: 'Inspecting evidence.' }],
};

describe('canonical turn process presentation', () => {
  it.each([
    ['computer.screenshot', `computer://browser/${'a'.repeat(64)}`, 'manual'],
    ['computer.screenshot', 'computer://browser/invalid', 'automatic'],
    ['computer.screenshot', undefined, 'automatic'],
    ['computer.observe', `computer://browser/${'a'.repeat(64)}`, 'automatic'],
  ] as const)('keeps saved screenshot turns visible for %s with %s', (tool_name, resource_ref, disclosure) => {
    const item: FlowerActivityItem = { item_id: 'capture', tool_id: 'capture', tool_name, kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
      target_refs: resource_ref ? [{ kind: 'computer_frame', label: 'Saved screenshot', resource_ref }] : [],
    };
    const screenshot: MessageEntry = { ...entry('capture'), blocks: [{ type: 'activity', key: 'capture:0', block_index: 0,
      block: { type: 'activity-timeline', schema_version: 1, items: [item], summary: { status: 'success', severity: 'quiet', needs_attention: false, total_items: 1, counts: { success: 1 } } },
    }] };
    expect(projectFlowerTurnProcess([screenshot, ...entries], [turn()]).get('turn')?.disclosure).toBe(disclosure);
  });
  it('defaults successful legacy process to collapsed without hiding uncertain assistant content', () => {
    const result = projectFlowerTurnProcess([entries[0], thinking, ...entries.slice(1)], [turn({ final_item_ids: [], final_boundary_complete: false })]).get('turn');
    expect(result?.disclosure).toBe('automatic');
    expect(result?.processKeys).toEqual(['thinking']);
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('offers expanded manual disclosure for %s work', (outcome) => {
    const result = projectFlowerTurnProcess([thinking, ...entries], [turn({ outcome, final_item_ids: [], final_boundary_complete: false })]).get('turn');
    expect(result?.disclosure).toBe('manual');
    expect(result?.processKeys).toEqual(['thinking']);
  });
  it('keeps mixed thinking and answer rows visible when their final boundary is unknown', () => {
    const mixed: MessageEntry = { ...thinking, blocks: [...thinking.blocks, { type: 'content', key: 'answer', block_index: 1, block_type: 'markdown', content: 'The answer.' }] };
    const result = projectFlowerTurnProcess([mixed, ...entries], [turn({ final_item_ids: [], final_boundary_complete: false })]).get('turn');
    expect(result?.disclosure).toBe('none');
    expect(result?.processKeys).toEqual([]);
  });
  it('never offers manual disclosure for active, pending, context-only, or unknown turns', () => {
    expect(projectFlowerTurnProcess([thinking], []).get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess([thinking], [turn({ ended_at: undefined, outcome: undefined })]).get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess([thinking], [turn({ kind: 'context_compaction' })]).get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess([thinking, ...entries], [turn()], ['turn']).get('turn')?.disclosure).toBe('none');
  });
  it('keeps attachments and user messages outside a legacy process', () => {
    const image: MessageEntry = { ...entry('image'), blocks: [...thinking.blocks, { type: 'image', key: 'image:0', block_index: 1, src: '/image.png' }] };
    const answer = entry('answer', 'user');
    const result = projectFlowerTurnProcess([thinking, image, answer, ...entries], [turn({ final_item_ids: [], final_boundary_complete: false })]).get('turn');
    expect(result?.processKeys).toEqual(['thinking']);
    expect(result?.disclosure).toBe('automatic');
  });
  it('keeps every explicit final segment and user message outside the process', () => {
    const result = projectFlowerTurnProcess(entries, [turn()]);
    expect(result.get('turn')?.processKeys).toEqual(['progress']);
    expect(result.get('turn')?.summaryKey).toBe('progress');
    expect(result.get('turn')?.disclosure).toBe('automatic');
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('keeps %s turns expanded', (outcome) => {
    expect(projectFlowerTurnProcess(entries, [turn({ outcome, final_item_ids: [], final_boundary_complete: false })]).get('turn')?.disclosure).toBe('none');
  });
  it('requires complete boundaries and all final segments', () => {
    expect(projectFlowerTurnProcess(entries, [turn({ final_boundary_complete: false })]).get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess(entries, [turn({ final_item_ids: [] })]).get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess(entries.slice(0, -1), [turn()]).get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess(entries, [turn({ ended_at: undefined, outcome: undefined })]).get('turn')?.disclosure).toBe('none');
  });
  it('does not create an empty summary or summarize context-only work', () => {
    expect(projectFlowerTurnProcess(entries.filter((e) => e.key !== 'progress'), [turn()]).get('turn')?.disclosure).toBe('none');
    expect(projectFlowerTurnProcess(entries, [turn({ kind: 'context_compaction' })]).get('turn')?.disclosure).toBe('none');
  });
  it('formats no more than two meaningful units with an explicit subsecond state', () => {
    expect(flowerDurationParts(999)).toEqual([]);
    expect(flowerDurationParts(42000)).toEqual([{ unit: 'second', count: 42 }]);
    expect(flowerDurationParts(138000)).toEqual([{ unit: 'minute', count: 2 }, { unit: 'second', count: 18 }]);
    expect(flowerDurationParts(3901000)).toEqual([{ unit: 'hour', count: 1 }, { unit: 'minute', count: 5 }]);
  });
});
