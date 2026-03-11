import { describe, expect, it } from 'vitest';

import { buildGitMutationRefreshPlan } from './gitMutationRefresh';

describe('buildGitMutationRefreshPlan', () => {
  it('keeps fetch focused on summary and branches while skipping workspace reloads', () => {
    expect(buildGitMutationRefreshPlan('fetch', { subview: 'changes', branchSubview: 'status' })).toEqual({
      refreshRepoSummary: true,
      refreshWorkspace: false,
      refreshBranches: true,
      refreshCommits: false,
    });
  });

  it('refreshes workspace after pull and checkout', () => {
    expect(buildGitMutationRefreshPlan('pull', { subview: 'changes', branchSubview: 'status' })).toEqual({
      refreshRepoSummary: true,
      refreshWorkspace: true,
      refreshBranches: true,
      refreshCommits: false,
    });
    expect(buildGitMutationRefreshPlan('checkout', { subview: 'changes', branchSubview: 'status' })).toEqual({
      refreshRepoSummary: true,
      refreshWorkspace: true,
      refreshBranches: true,
      refreshCommits: false,
    });
  });

  it('refreshes visible history after history-affecting mutations', () => {
    expect(buildGitMutationRefreshPlan('commit', { subview: 'history', branchSubview: 'status' }).refreshCommits).toBe(true);
    expect(buildGitMutationRefreshPlan('fetch', { subview: 'branches', branchSubview: 'history' }).refreshCommits).toBe(true);
    expect(buildGitMutationRefreshPlan('push', { subview: 'branches', branchSubview: 'status' }).refreshCommits).toBe(false);
  });
});
