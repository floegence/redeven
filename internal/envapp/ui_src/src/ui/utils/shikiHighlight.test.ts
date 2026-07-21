import { describe, expect, it } from 'vitest';

import {
  decodeCodeHighlightTheme,
  encodeCodeHighlightTheme,
  resolveCodeHighlightTheme,
} from './shikiHighlight';

describe('shikiHighlight theme identity', () => {
  it('keeps the Floe preset in the request identity while decoding the syntax family', () => {
    const encoded = encodeCodeHighlightTheme('github-dark', 'midnight');

    expect(encoded).toBe('github-dark::midnight');
    expect(decodeCodeHighlightTheme(encoded)).toBe('github-dark');
  });

  it('retains the original light and dark syntax families', () => {
    expect(resolveCodeHighlightTheme('light')).toBe('github-light');
    expect(resolveCodeHighlightTheme('dark')).toBe('github-dark');
    expect(decodeCodeHighlightTheme('github-light::paper')).toBe('github-light');
  });
});
