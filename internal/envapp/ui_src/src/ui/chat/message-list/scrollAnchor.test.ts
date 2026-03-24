import { describe, expect, it } from 'vitest';

import { captureViewportAnchor, resolveViewportAnchorScrollTop } from './scrollAnchor';

describe('scrollAnchor', () => {
  it('captures the first actually visible item instead of the overscanned start', () => {
    const messageIds = ['m1', 'm2', 'm3'];
    const offsets = [0, 120, 260];
    const heights = [120, 140, 180];

    const anchor = captureViewportAnchor({
      messageIds,
      visibleRangeStart: 0,
      scrollTop: 150,
      getItemOffset: (index) => offsets[index],
      getItemHeight: (index) => heights[index],
    });

    expect(anchor).toEqual({
      messageId: 'm2',
      offsetWithinItem: 30,
    });
  });

  it('resolves the new scrollTop from the anchored message offset', () => {
    const nextScrollTop = resolveViewportAnchorScrollTop(
      { messageId: 'm2', offsetWithinItem: 30 },
      new Map([['m1', 0], ['m2', 1], ['m3', 2]]),
      (index) => [0, 180, 360][index],
    );

    expect(nextScrollTop).toBe(210);
  });
});
