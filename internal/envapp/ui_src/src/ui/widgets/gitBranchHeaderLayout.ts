export type GitBranchHeaderLayout = 'compact' | 'stacked' | 'inline';

export const GIT_BRANCH_HEADER_STACKED_MIN_WIDTH = 620;
export const GIT_BRANCH_HEADER_INLINE_MIN_WIDTH = 960;

export function resolveGitBranchHeaderLayout(width: number): GitBranchHeaderLayout {
  if (width >= GIT_BRANCH_HEADER_INLINE_MIN_WIDTH) return 'inline';
  if (width >= GIT_BRANCH_HEADER_STACKED_MIN_WIDTH) return 'stacked';
  return 'compact';
}
