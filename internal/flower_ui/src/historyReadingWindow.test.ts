import { describe, expect, it } from 'vitest';
import { historyFoldedNavigation, historyReadingKey, historyReadingRequest, HISTORY_READING_ITEMS, HISTORY_READING_BYTES, HISTORY_PAGE_ITEMS, historyReadingSelection, historyReadingGaps, historyGapRequest, historyReadingItemBytes } from './historyReadingWindow';

describe('continuous reading interest', () => {
  const window = { first_item_id: 'first', last_item_id: 'last', has_before: true, has_after: true };
  it('prefetches only adjacent membership without moving the visible interest', () => {
    expect(historyReadingRequest(window, { top: 600, height: 6000, viewport: 700 }, false, 'before'))
      .toEqual({ anchor_id: 'first', direction: 'before', limit: HISTORY_PAGE_ITEMS });
    expect(historyReadingRequest(window, { top: 4800, height: 6000, viewport: 700 }, false, 'after'))
      .toEqual({ anchor_id: 'last', direction: 'after', limit: HISTORY_PAGE_ITEMS });
  });
  it('reads the canonical edge when all loaded message bodies are folded', () => {
    expect(historyReadingRequest(window, { top: 0, height: 700, viewport: 700 }, false, 'before'))
      .toEqual({ anchor_id: 'first', direction: 'before', limit: HISTORY_PAGE_ITEMS });
  });
  it('does not traverse history on initial reveal or at the actual end', () => {
    const tail = { ...window, has_after: false };
    expect(historyReadingRequest(tail, { top: 0, height: 100, viewport: 700 }, true, undefined)).toBeUndefined();
    expect(historyReadingRequest(tail, { top: 5000, height: 6000, viewport: 700 }, false, 'after')).toBeUndefined();
    expect(historyReadingRequest(window, { top: 2000, height: 6000, viewport: 700 }, false, 'before')).toBeUndefined();
  });
  it('replaces a historical interest with a tail interest only at the actual bottom', () => {
    const tail = { ...window, has_after: false };
    const around = { anchor_id: 'middle', direction: 'around' as const, limit: 150 };
    expect(historyReadingRequest(tail, { top: 5299, height: 6000, viewport: 700 }, true, 'after', around))
      .toEqual({ direction: 'before', limit: HISTORY_READING_ITEMS });
    expect(historyReadingRequest(tail, { top: 5100, height: 6000, viewport: 700 }, false, 'after', around)).toBeUndefined();
    expect(historyReadingRequest(window, { top: 5300, height: 6000, viewport: 700 }, false, 'after', around))
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
  it('bounds large metadata while preserving visible islands and making progress', () => {
    const ids = Array.from({ length: 190 }, (_, i) => String(i + 1));
    const bytes = new Map(ids.map(id => [id, 8192]));
    const ordinals = new Map(ids.map(id => [id, Number(id)]));
    const selection = historyReadingSelection(ids.slice(40), ids.slice(0, 40), 'before', ['120', '190'], undefined, ordinals, bytes)!;
    expect(selection).toContain('1');
    expect(selection).toContain('120');
    expect(selection).toContain('190');
    expect(selection.length).toBeLessThan(HISTORY_READING_ITEMS);
    expect(selection.reduce((sum, id) => sum + bytes.get(id)!, 0)).toBeLessThanOrEqual(HISTORY_READING_BYTES);
    expect(historyReadingSelection(['1'], ['2'], 'after', ['1'], undefined, ordinals, new Map([['1', HISTORY_READING_BYTES], ['2', 1]]))).toBeUndefined();
  });
  it('accounts for canonical JSON escaping and UTF-8 metadata', () => {
    const item = { id: 'item', ordinal: 1, kind: 'assistant' as const, text: '<>&中🌸' };
    expect(historyReadingItemBytes(item)).toBeGreaterThan(new TextEncoder().encode(JSON.stringify(item)).length + 14);
  });
  it('budgets compact tool summaries by their canonical window cost', () => {
    const item = { id: 'tool', ordinal: 1, kind: 'tool' as const, window_bytes: 8192 };
    expect(historyReadingItemBytes(item)).toBe(8193);
    const ids = Array.from({ length: 150 }, (_, index) => String(index));
    const bytes = new Map(ids.map(id => [id, historyReadingItemBytes({ ...item, id })]));
    const selected = historyReadingSelection(ids.slice(40), ids.slice(0, 40), 'before', [], undefined, undefined, bytes)!;
    expect(selected.length).toBeLessThan(60);
  });
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
  it('retains source-bound sequence continuity through partial refill and rejects replacement endpoints', () => {
    const members = [1, 5, 10, 15, 20].map(ordinal => ({ id: String(ordinal), ordinal }));
    const proof = { before_id: '1', after_id: '20', first: 2, last: 20, turn_id: 'turn', run_id: 'run' };
    const initial = historyReadingGaps([], [members[0], members[4]], [], new Map(), undefined, [proof]);
    expect(initial[0].sequence).toEqual({ turnID: 'turn', runID: 'run' });
    const split = historyReadingGaps([members[0], members[4]], members, initial, new Map());
    expect(split).toHaveLength(4); expect(split.every(gap => gap.sequence && gap.folded)).toBe(true);
    const replaced = members.map(member => ({ ...member, id: 'replacement-' + member.id }));
    expect(historyReadingGaps(members, replaced, initial, new Map()).every(gap => !gap.sequence)).toBe(true);
    expect(historyReadingGaps([], [members[0], members[4]], [], new Map(), undefined, [{ ...proof, first: 3 }])[0].sequence).toBeUndefined();
  });
  function viewportGap(top: number, bottom: number, first: number, last: number): HTMLElement {
    return { getBoundingClientRect: () => ({ top: 0, bottom: 700 }), querySelectorAll: () => [{
      getBoundingClientRect: () => ({ top, bottom, height: bottom - top }),
      dataset: { flowerHistoryGapBefore: String(first - 1), flowerHistoryGapAfter: String(last), flowerHistoryGapFirst: String(first), flowerHistoryGapLast: String(last) },
    }] } as unknown as HTMLElement;
  }
  it('does not let a small gap refill evict unrelated retained history', () => {
    expect(historyGapRequest(viewportGap(750, 800, 2707, 2710), 'after'))
      .toEqual({ anchor_id: '2706', direction: 'after', limit: 3 });
    expect(historyGapRequest(viewportGap(-200, -150, 2707, 2710), 'before'))
      .toEqual({ anchor_id: '2710', direction: 'before', limit: 3 });
    expect(historyGapRequest(viewportGap(750, 800, 2705, 2706), 'after'))
      .toEqual({ anchor_id: '2704', direction: 'after', limit: 1 });
  });
  it('does not refill gaps behind the reading edge and alternate bounded windows', () => {
    // Collapsed tool groups can put both retained islands in one viewport.
    // Refilling either side here can evict the other within the byte budget.
    expect(historyGapRequest(viewportGap(150, 235, 2417, 2421), 'before')).toBeUndefined();
    expect(historyGapRequest(viewportGap(370, 402, 2517, 2520), 'before')).toBeUndefined();
    expect(historyGapRequest(viewportGap(150, 235, 2417, 2421), 'after')).toBeUndefined();
    expect(historyGapRequest(viewportGap(-10, 235, 2417, 2421), 'before'))
      .toEqual({ anchor_id: '2421', direction: 'before', limit: 4 });
    expect(historyGapRequest(viewportGap(600, 750, 2517, 2520), 'after'))
      .toEqual({ anchor_id: '2516', direction: 'after', limit: 3 });
  });
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

it('preserves split folded gaps only while their canonical endpoints survive', () => {
  const members = [1, 5, 10, 15, 20].map(ordinal => ({ id: String(ordinal), ordinal }));
  const skipped = { leaf_id: 'leaf', turn_id: 'turn', run_id: 'run', first_item_id: '1', last_item_id: '20', first_ordinal: 1, last_ordinal: 20 };
  const original = historyReadingGaps([], [members[0], members[4]], [], new Map(), skipped);
  expect(original[0].folded).toBe(true);
  const split = historyReadingGaps([members[0], members[4]], members, original, new Map());
  expect(split.every(gap => gap.folded)).toBe(true);
  const replaced = members.map(item => ({ ...item, id: 'replacement-' + item.id }));
  expect(historyReadingGaps(members, replaced, original, new Map()).every(gap => !gap.folded)).toBe(true);
});

it('bounds a folded navigation union and refuses live or oversized protected interests', () => {
  const row = { dataset: { flowerRowMessageId: '50', flowerTurnId: 'turn', flowerTurnProcess: 'true' }, querySelector: () => undefined };
  const summary = { getAttribute: () => 'false' };
  const turn = { dataset: { flowerTurnId: 'turn' }, querySelector: () => summary };
  const viewport = { querySelectorAll: (selector: string) => selector === '[data-flower-row-message-id]' ? [row]
    : selector === '[data-flower-turn-id]' ? [turn] : [] } as unknown as HTMLElement;
  const items = Array.from({ length: 150 }, (_, i) => ({ id: String(i), ordinal: i + 1, kind: 'tool' as const, window_bytes: 1024 }));
  const input = { anchor_id: '50', direction: 'before' as const, limit: 40 };
  const request = historyFoldedNavigation(viewport, input, items, ['149'])!;
  expect(request.skip_folded).toBe('turn');
  expect(request.retain_item_ids).toContain('149');
  expect(request.retain_item_ids).toContain('50');
  expect(request.retain_item_ids!.length + request.limit! + 2).toBeLessThanOrEqual(HISTORY_READING_ITEMS);
  expect(historyFoldedNavigation(viewport, input, items.map(item => ({ ...item, live: true })), [])).toBeUndefined();
  expect(historyFoldedNavigation(viewport, input, items.map(item => ({ ...item, window_bytes: HISTORY_READING_BYTES })), ['149'])).toBeUndefined();
  expect(historyFoldedNavigation(viewport, input, items, items.map(item => item.id))).toBeUndefined();
  expect(historyFoldedNavigation(viewport, { ...input, anchor_offset: 5 }, items, [])).toBeUndefined();
});
