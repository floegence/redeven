export type GitBranchHeaderLayout = 'stacked' | 'inline';

export const GIT_BRANCH_HEADER_INLINE_MIN_WIDTH = 720;

export function resolveGitBranchHeaderLayout(width: number): GitBranchHeaderLayout {
  return width >= GIT_BRANCH_HEADER_INLINE_MIN_WIDTH ? 'inline' : 'stacked';
}
