import { describe, expect, it } from 'vitest';
import { historyItemConfirmsPrefix, historyWindowForItems } from './historyWindowRetention';
import type { FlowerHistoryWindow, FlowerRuntimeCurrentItem } from './contracts/flowerSurfaceContracts';

const item = (ordinal: number): FlowerRuntimeCurrentItem => ({ id: String(ordinal), ordinal, canonical_ordinal: ordinal + 10, kind: 'tool', turn_id: 'turn', run_id: 'run' });
const window = (first: number, last: number, before: boolean, after: boolean): FlowerHistoryWindow => ({ leaf_id: 'leaf', first_item_id: String(first), last_item_id: String(last), has_before: before, has_after: after });

describe('retained history window evidence', () => {
  it('retains a prefix only for the exact sealed canonical member', () => {
    const original = item(2);
    expect(historyItemConfirmsPrefix({ ...original }, original)).toBe(true);
    for (const changes of [{ live: true }, { id: 'other' }, { ordinal: 3 }, { canonical_ordinal: undefined }, { canonical_ordinal: 42 }, { turn_id: 'other' }, { run_id: 'other' }, { kind: 'thinking' as const }]) {
      expect(historyItemConfirmsPrefix({ ...original, ...changes }, original)).toBe(false);
      expect(historyItemConfirmsPrefix(original, { ...original, ...changes })).toBe(false);
    }
  });
  it('uses independent source evidence for the retained first and last boundaries', () => {
    expect(historyWindowForItems(window(3, 4, true, false), [window(1, 2, false, true)], [1, 2, 3, 4].map(item)))
      .toEqual(window(1, 4, false, false));
    expect(historyWindowForItems(window(3, 4, true, true), [], [1, 3, 4, 6].map(item)))
      .toEqual(window(1, 6, true, true));
  });
  it('keeps current boundary evidence authoritative and does not invent missing bounds', () => {
    const current = window(1, 3, true, true);
    expect(historyWindowForItems(current, [window(1, 3, false, false)], [1, 2, 3].map(item))).toEqual(current);
    expect(historyWindowForItems(undefined, [], [item(1)])).toBeUndefined();
    expect(historyWindowForItems(current, [], [])).toBe(current);
  });
});
