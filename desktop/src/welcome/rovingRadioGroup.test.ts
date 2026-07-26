import { describe, expect, it } from 'vitest';

import { rovingRadioIndexForKey } from './rovingRadioGroup';

describe('rovingRadioIndexForKey', () => {
  it.each([
    ['ArrowRight', 1],
    ['ArrowDown', 1],
    ['ArrowLeft', 2],
    ['ArrowUp', 2],
    ['Home', 0],
    ['End', 2],
  ])('moves %s from the first item to index %i', (key, expected) => {
    expect(rovingRadioIndexForKey(key, 0, 3)).toBe(expected);
  });

  it('wraps forward and backward navigation', () => {
    expect(rovingRadioIndexForKey('ArrowRight', 2, 3)).toBe(0);
    expect(rovingRadioIndexForKey('ArrowLeft', 0, 3)).toBe(2);
  });

  it('ignores unrelated keys and empty groups', () => {
    expect(rovingRadioIndexForKey('Enter', 1, 3)).toBeNull();
    expect(rovingRadioIndexForKey('ArrowRight', 0, 0)).toBeNull();
  });
});
