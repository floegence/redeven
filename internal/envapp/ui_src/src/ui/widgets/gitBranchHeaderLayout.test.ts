import { describe, expect, it } from 'vitest';

import {
  GIT_BRANCH_HEADER_INLINE_MIN_WIDTH,
  resolveGitBranchHeaderLayout,
} from './gitBranchHeaderLayout';

describe('resolveGitBranchHeaderLayout', () => {
  it('defaults to the stacked layout before a stable measurement exists', () => {
    expect(resolveGitBranchHeaderLayout(0)).toBe('stacked');
  });

  it('keeps narrow header widths stacked', () => {
    expect(resolveGitBranchHeaderLayout(GIT_BRANCH_HEADER_INLINE_MIN_WIDTH - 1)).toBe('stacked');
  });

  it('switches to inline once the measured width reaches the inline threshold', () => {
    expect(resolveGitBranchHeaderLayout(GIT_BRANCH_HEADER_INLINE_MIN_WIDTH)).toBe('inline');
    expect(resolveGitBranchHeaderLayout(GIT_BRANCH_HEADER_INLINE_MIN_WIDTH + 120)).toBe('inline');
  });
});
