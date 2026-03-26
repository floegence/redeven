import type { GitBranchSubview, GitWorkbenchSubview } from './gitWorkbench';

export type GitMutationRefreshKind = 'commit' | 'fetch' | 'pull' | 'push' | 'checkout' | 'switchDetached' | 'merge';

export type GitMutationRefreshPlan = {
  refreshRepoSummary: boolean;
  refreshWorkspace: boolean;
  refreshBranches: boolean;
  refreshCommits: boolean;
};

export function buildGitMutationRefreshPlan(
  kind: GitMutationRefreshKind,
  context: {
    subview: GitWorkbenchSubview;
    branchSubview: GitBranchSubview;
  },
): GitMutationRefreshPlan {
  const refreshCommits = context.subview === 'history'
    || (context.subview === 'branches' && context.branchSubview === 'history');

  switch (kind) {
    case 'fetch':
      return {
        refreshRepoSummary: true,
        refreshWorkspace: false,
        refreshBranches: true,
        refreshCommits,
      };
    case 'push':
      return {
        refreshRepoSummary: true,
        refreshWorkspace: false,
        refreshBranches: true,
        refreshCommits: false,
      };
    case 'commit':
      return {
        refreshRepoSummary: true,
        refreshWorkspace: false,
        refreshBranches: true,
        refreshCommits,
      };
    case 'pull':
    case 'checkout':
    case 'switchDetached':
    case 'merge':
    default:
      return {
        refreshRepoSummary: true,
        refreshWorkspace: true,
        refreshBranches: true,
        refreshCommits,
      };
  }
}
