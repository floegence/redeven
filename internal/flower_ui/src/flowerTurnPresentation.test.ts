import { describe, expect, it } from 'vitest';
import { projectFlowerTurnProcess, flowerDurationParts } from './flowerTurnPresentation';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';

const entry = (id: string, role: 'user' | 'assistant' = 'assistant'): FlowerTimelineEntry => ({
  type: 'message', key: id,
  message: { id, role, turn_id: 'turn', run_id: 'run', content: id, status: 'complete', created_at_ms: 1 }, blocks: [],
});
const turn = (changes: Partial<FlowerRuntimeTurn> = {}): FlowerRuntimeTurn => ({
  turn_id: 'turn', run_id: 'run', started_at: '2026-10-11T12:00:00Z', ended_at: '2026-10-11T12:02:18Z',
  outcome: 'completed', elapsed_ms: 138000, waiting_ms: 0, work_duration_ms: 138000,
  final_item_ids: ['final-a', 'final-b'], final_boundary_complete: true, ...changes,
});
const entries = [entry('user', 'user'), entry('progress'), entry('final-a'), entry('final-b')];

describe('canonical turn process presentation', () => {
  it('keeps every explicit final segment and user message outside the process', () => {
    const result = projectFlowerTurnProcess(entries, [turn()]);
    expect(result.get('turn')?.processKeys).toEqual(['progress']);
    expect(result.get('turn')?.summaryKey).toBe('progress');
    expect(result.get('turn')?.eligible).toBe(true);
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('keeps %s turns expanded', (outcome) => {
    expect(projectFlowerTurnProcess(entries, [turn({ outcome })]).get('turn')?.eligible).toBe(false);
  });
  it('requires complete boundaries and all final segments', () => {
    expect(projectFlowerTurnProcess(entries, [turn({ final_boundary_complete: false })]).get('turn')?.eligible).toBe(false);
    expect(projectFlowerTurnProcess(entries, [turn({ final_item_ids: [] })]).get('turn')?.eligible).toBe(false);
    expect(projectFlowerTurnProcess(entries.slice(0, -1), [turn()]).get('turn')?.eligible).toBe(false);
    expect(projectFlowerTurnProcess(entries, [turn({ ended_at: undefined, outcome: undefined })]).get('turn')?.eligible).toBe(false);
  });
  it('does not create an empty summary or summarize context-only work', () => {
    expect(projectFlowerTurnProcess(entries.filter((e) => e.key !== 'progress'), [turn()]).get('turn')?.eligible).toBe(false);
    expect(projectFlowerTurnProcess(entries, [turn({ kind: 'context_compaction' })]).get('turn')?.eligible).toBe(false);
  });
  it('formats no more than two meaningful units with an explicit subsecond state', () => {
    expect(flowerDurationParts(999)).toEqual([]);
    expect(flowerDurationParts(42000)).toEqual([{ unit: 'second', count: 42 }]);
    expect(flowerDurationParts(138000)).toEqual([{ unit: 'minute', count: 2 }, { unit: 'second', count: 18 }]);
    expect(flowerDurationParts(3901000)).toEqual([{ unit: 'hour', count: 1 }, { unit: 'minute', count: 5 }]);
  });
});
