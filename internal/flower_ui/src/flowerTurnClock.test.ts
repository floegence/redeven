import { describe, expect, it, vi } from 'vitest';
import type { FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';
import { flowerTurnElapsedMS, sampleFlowerTurnClock } from './flowerTurnClock';

const start = Date.parse('2026-11-02T10:00:00Z');
const turn: FlowerRuntimeTurn = { turn_id: 'turn', run_id: 'run', started_at: new Date(start).toISOString(),
  elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0, final_item_ids: [], final_boundary_complete: false };

describe('turn elapsed presentation', () => {
  it('uses server samples and monotonic elapsed time, independently of the browser wall clock', () => {
    const sample = sampleFlowerTurnClock('turn', start + 10000, undefined, 1000);
    const wall = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      expect(flowerTurnElapsedMS(turn, sample, 2500)).toBe(11500);
      wall.mockReturnValue(start + 900000000);
      expect(flowerTurnElapsedMS(turn, sample, 3000)).toBe(12000);
    } finally { wall.mockRestore(); }
  });
  it('retains a same-turn sample through waiting and continuation runs, but never borrows another turn', () => {
    const sample = sampleFlowerTurnClock('turn', start + 10000, undefined, 1000);
    expect(sampleFlowerTurnClock('turn', undefined, sample, 2000)).toBe(sample);
    expect(sampleFlowerTurnClock('turn', start + 10000, sample, 2000)).toBe(sample);
    expect(sampleFlowerTurnClock('turn', start + 9000, sample, 2000)).toBe(sample);
    expect(flowerTurnElapsedMS({ ...turn, run_id: 'continued' }, sample, 61000)).toBe(70000);
    expect(sampleFlowerTurnClock('other', undefined, sample)).toBeUndefined();
    expect(sampleFlowerTurnClock(undefined, start + 10000, sample)).toBeUndefined();
    expect(flowerTurnElapsedMS({ ...turn, turn_id: 'other' }, sample, 2000)).toBeUndefined();
  });
  it('reanchors on the next existing server sample after reconnect or browser sleep', () => {
    const initial = sampleFlowerTurnClock('turn', start + 10000, undefined, 1000);
    const resumed = sampleFlowerTurnClock('turn', start + 301000, initial, 2000);
    expect(flowerTurnElapsedMS(turn, resumed, 3000)).toBe(302000);
    const delayed = sampleFlowerTurnClock('turn', start + 11000, initial, 5000);
    expect(flowerTurnElapsedMS(turn, delayed, 5000)).toBe(14000);
  });
  it('does not invent timing without a valid sample or before canonical admission', () => {
    for (const sample of [undefined, NaN, Infinity, -1, 0, 1.5]) {
      expect(sampleFlowerTurnClock('turn', sample)).toBeUndefined();
    }
    expect(flowerTurnElapsedMS(turn, undefined, 1000)).toBeUndefined();
    expect(flowerTurnElapsedMS(turn, sampleFlowerTurnClock('turn', start - 1), 1000)).toBeUndefined();
  });
  it('settles total time from canonical facts including waits, without a clock sample', () => {
    const settled = { ...turn, outcome: 'completed' as const, ended_at: new Date(start + 70000).toISOString(),
      elapsed_ms: 70000, work_duration_ms: 10000, waiting_ms: 60000 };
    expect(flowerTurnElapsedMS(settled, undefined, 900000)).toBe(70000);
    expect(flowerTurnElapsedMS({ ...settled, elapsed_ms: 0 }, undefined, 900000)).toBe(0);
  });
});
