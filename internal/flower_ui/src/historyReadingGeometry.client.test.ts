// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { historyReadingGaps, measureHistoryReadingHeights } from './historyReadingWindow';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
const members = Array.from({ length: 1200 }, (_, index) => ({ id: String(index + 1), ordinal: index + 1 }));
const fixture = () => {
  const viewport = document.createElement('div');
  for (const item of members) {
    const row = document.createElement('div');
    row.dataset.flowerRowMessageId = item.id;
    row.getBoundingClientRect = vi.fn(() => ({ top: item.ordinal * 20, bottom: item.ordinal * 20 + 20, height: 20 } as DOMRect));
    viewport.append(row);
  }
  document.body.append(viewport);
  return viewport;
};

it('does not inspect retained DOM when live baselines preserve or append reading membership', () => {
  const viewport = fixture(), query = vi.spyOn(viewport, 'querySelectorAll');
  expect(measureHistoryReadingHeights(viewport, members, members).size).toBe(0);
  expect(measureHistoryReadingHeights(viewport, members, [...members, { id: 'tail', ordinal: 1201 }]).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it('measures only removed interior rows and preserves exact gap geometry', () => {
  const viewport = fixture(), next = members.filter(item => item.ordinal !== 600);
  const heights = measureHistoryReadingHeights(viewport, members, next);
  expect([...heights]).toEqual([['600', 20]]);
  expect(historyReadingGaps(members, next, [], heights)).toEqual([{ beforeID: '599', afterID: '601', first: 600, last: 601, height: 20 }]);
  const reads = [...viewport.children].reduce((sum, row) => sum + vi.mocked(row.getBoundingClientRect).mock.calls.length, 0);
  expect(reads).toBe(2);
});

it('does not measure removed outer pages that cannot create an interior gap', () => {
  const viewport = fixture(), query = vi.spyOn(viewport, 'querySelectorAll');
  expect(measureHistoryReadingHeights(viewport, members, members.slice(100, 1100)).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});
