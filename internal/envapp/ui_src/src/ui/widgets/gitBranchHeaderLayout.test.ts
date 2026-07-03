import { describe, expect, it } from 'vitest';

import {
  GIT_BRANCH_HEADER_STACKED_MIN_WIDTH,
  GIT_BRANCH_HEADER_INLINE_MIN_WIDTH,
  resolveGitBranchHeaderLayout,
} from './gitBranchHeaderLayout';

describe('resolveGitBranchHeaderLayout', () => {
  it('defaults to the compact layout before a stable measurement exists', () => {
    expect(resolveGitBranchHeaderLayout(0)).toBe('compact');
  });

  it('keeps narrow header widths compact', () => {
    expect(resolveGitBranchHeaderLayout(320)).toBe('compact');
    expect(resolveGitBranchHeaderLayout(420)).toBe('compact');
    expect(resolveGitBranchHeaderLayout(GIT_BRANCH_HEADER_STACKED_MIN_WIDTH - 1)).toBe('compact');
  });

  it('uses the stacked layout between compact and inline thresholds', () => {
    expect(resolveGitBranchHeaderLayout(GIT_BRANCH_HEADER_STACKED_MIN_WIDTH)).toBe('stacked');
    expect(resolveGitBranchHeaderLayout(720)).toBe('stacked');
    expect(resolveGitBranchHeaderLayout(GIT_BRANCH_HEADER_INLINE_MIN_WIDTH - 1)).toBe('stacked');
  });

  it('switches to inline once the measured width reaches the inline threshold', () => {
    expect(resolveGitBranchHeaderLayout(GIT_BRANCH_HEADER_INLINE_MIN_WIDTH)).toBe('inline');
    expect(resolveGitBranchHeaderLayout(GIT_BRANCH_HEADER_INLINE_MIN_WIDTH + 120)).toBe('inline');
  });
});
