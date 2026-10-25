import { describe, expect, it } from 'vitest';
import { historyReadingKey, historyReadingRequest, HISTORY_READING_ITEMS, HISTORY_PAGE_ITEMS, historyReadingSelection, historyReadingGaps } from './historyReadingWindow';

describe('continuous reading interest', () => {
  const window = { first_item_id: 'first', last_item_id: 'last', has_before: true, has_after: true };
  it('prefetches only adjacent membership without moving the visible interest', () => {
    expect(historyReadingRequest(window, 'visible', { top: 600, height: 6000, viewport: 700 }, false, 'before'))
      .toEqual({ anchor_id: 'first', direction: 'before', limit: HISTORY_PAGE_ITEMS });
    expect(historyReadingRequest(window, 'visible', { top: 4800, height: 6000, viewport: 700 }, false, 'after'))
      .toEqual({ anchor_id: 'last', direction: 'after', limit: HISTORY_PAGE_ITEMS });
  });
  it('does not traverse history on initial reveal or at the actual end', () => {
    const tail = { ...window, has_after: false };
    expect(historyReadingRequest(tail, 'last', { top: 0, height: 100, viewport: 700 }, true, undefined)).toBeUndefined();
    expect(historyReadingRequest(tail, 'last', { top: 5000, height: 6000, viewport: 700 }, false, 'after')).toBeUndefined();
    expect(historyReadingRequest(window, 'middle', { top: 2000, height: 6000, viewport: 700 }, false, 'before')).toBeUndefined();
  });
  it('replaces a historical interest with a tail interest only at the actual bottom', () => {
    const tail = { ...window, has_after: false };
    const around = { anchor_id: 'middle', direction: 'around' as const, limit: 150 };
    expect(historyReadingRequest(tail, 'last', { top: 5299, height: 6000, viewport: 700 }, true, 'after', around))
      .toEqual({ direction: 'before', limit: HISTORY_READING_ITEMS });
    expect(historyReadingRequest(tail, 'last', { top: 5100, height: 6000, viewport: 700 }, false, 'after', around)).toBeUndefined();
    expect(historyReadingRequest(window, 'last', { top: 5300, height: 6000, viewport: 700 }, false, 'after', around))
      .toEqual({ anchor_id: 'last', direction: 'after', limit: HISTORY_PAGE_ITEMS });
  });
  it('changes request identity only with relevant bounds or reading intent', () => {
    const request = { anchor_id: 'visible', direction: 'around' as const, limit: HISTORY_READING_ITEMS };
    expect(historyReadingKey('thread', window, request)).toBe(historyReadingKey('thread', { ...window }, request));
    expect(historyReadingKey('thread', window, request)).not.toBe(historyReadingKey('thread', { ...window, first_item_id: 'older' }, request));
    expect(historyReadingKey('thread', window, request)).not.toBe(historyReadingKey('other', window, request));
  });
});

describe('finite adjacent history selection', () => {
  it('adds adjacent membership and evicts only the opposite unprotected edge', () => {
    expect(historyReadingSelection(['3', '4', '5'], ['1', '2'], 'before', ['3'], 4)).toEqual(['1', '2', '3', '4']);
    expect(historyReadingSelection(['1', '2', '3'], ['4', '5'], 'after', ['3'], 4)).toEqual(['2', '3', '4', '5']);
  });
  it('retains protected islands while making bounded progress', () => {
    expect(historyReadingSelection(['3', '4', '5'], ['1', '2'], 'before', ['5'], 4)).toEqual(['1', '2', '3', '5']);
    expect(historyReadingSelection(['1', '2', '3'], ['4', '5'], 'after', ['1'], 4)).toEqual(['1', '3', '4', '5']);
    expect(historyReadingSelection(['1', '2'], ['1', '2'], 'before', [], 4)).toBeUndefined();
  });
  it('places a gap refill between its canonical neighbors instead of at an outer edge', () => {
    const ordinals = new Map(Array.from({ length: 10 }, (_, i) => [String(i + 1), i + 1]));
    expect(historyReadingSelection(['1', '2', '3', '8', '9', '10'], ['4', '5'], 'after', ['2', '10'], 5, ordinals))
      .toEqual(['2', '3', '4', '5', '10']);
    expect(historyReadingSelection(['1', '2', '3', '8', '9', '10'], ['6', '7'], 'before', ['1', '8'], 5, ordinals))
      .toEqual(['1', '6', '7', '8', '9']);
  });
  it('deduplicates overlaps and rejects malformed identities', () => {
    expect(historyReadingSelection(['2', '3'], ['1', '2'], 'before', [], 4)).toEqual(['1', '2', '3']);
    expect(() => historyReadingSelection(['1', '1'], ['2'], 'after', [])).toThrow();
    expect(() => historyReadingSelection(['1'], [''], 'after', [])).toThrow();
  });
});

describe('finite history gap geometry', () => {
  const members = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), ordinal: i + 1 }));
  const heights = new Map(members.map(item => [item.id, item.ordinal * 10]));
  it('records only evicted intervals between protected islands', () => {
    const gaps = historyReadingGaps(members, [members[0], ...members.slice(10)], [], heights);
    expect(gaps).toEqual([{ beforeID: '1', afterID: '11', first: 2, last: 11, height: 540 }]);
    expect(historyReadingGaps(members, members.slice(10), [], heights)).toEqual([]);
  });
  it('splits a measured gap without accumulating previous pages', () => {
    const old = [members[0], members[19]];
    const gaps = [{ beforeID: '1', afterID: '20', first: 2, last: 20, height: 1800 }];
    const next = [members[0], members[9], members[10], members[19]];
    expect(historyReadingGaps(old, next, gaps, heights)).toEqual([
      { beforeID: '1', afterID: '10', first: 2, last: 10, height: 800 },
      { beforeID: '11', afterID: '20', first: 12, last: 20, height: 800 },
    ]);
    expect(historyReadingGaps(next, members.slice(8, 15), gaps, heights)).toEqual([]);
  });
});
