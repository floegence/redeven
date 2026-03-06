import { describe, expect, it } from 'vitest';
import {
  allGitBranches,
  branchIdentity,
  branchStatusSummary,
  buildGitWorkbenchSubviewItems,
  changeSecondaryPath,
  compareHeadline,
  findWorkspaceChangeByKey,
  repoDisplayName,
  summarizeWorkspaceCount,
  workspaceEntryKey,
  workspaceSectionCount,
} from './gitWorkbench';

describe('gitWorkbench helpers', () => {
  it('builds subview badges from workspace and branch counts', () => {
    const items = buildGitWorkbenchSubviewItems({
      repoSummary: {
        repoRootPath: '/',
        workspaceSummary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 0, conflictedCount: 1 },
      },
      branchesCount: 5,
    });

    expect(items).toEqual([
      { id: 'overview', label: 'Overview' },
      { id: 'changes', label: 'Changes', count: 4 },
      { id: 'branches', label: 'Branches', count: 5 },
      { id: 'history', label: 'History' },
    ]);
  });

  it('summarizes workspace counters by section', () => {
    const summary = { stagedCount: 2, unstagedCount: 3, untrackedCount: 4, conflictedCount: 1 };
    expect(summarizeWorkspaceCount(summary)).toBe(10);
    expect(workspaceSectionCount(summary, 'staged')).toBe(2);
    expect(workspaceSectionCount(summary, 'unstaged')).toBe(3);
    expect(workspaceSectionCount(summary, 'untracked')).toBe(4);
    expect(workspaceSectionCount(summary, 'conflicted')).toBe(1);
  });

  it('formats branch status and compare summary text', () => {
    expect(branchStatusSummary({ current: true, upstreamRef: 'origin/main', aheadCount: 2, behindCount: 1, worktreePath: '/wt' }))
      .toContain('Current');
    expect(compareHeadline({ repoRootPath: '/', baseRef: 'main', targetRef: 'feature', targetAheadCount: 3, targetBehindCount: 0, commits: [], files: [] }))
      .toContain('ahead by 3');
    expect(compareHeadline({ repoRootPath: '/', baseRef: 'main', targetRef: 'feature', targetAheadCount: 0, targetBehindCount: 0, commits: [], files: [] }))
      .toContain('matches');
  });

  it('formats rename path fallback and repo display name', () => {
    expect(changeSecondaryPath({ oldPath: 'src/old.ts', newPath: 'src/new.ts' })).toBe('src/old.ts → src/new.ts');
    expect(changeSecondaryPath({ path: 'src/app.ts' })).toBe('src/app.ts');
    expect(repoDisplayName('/workspace/repo')).toBe('repo');
    expect(repoDisplayName('/')).toBe('Repository');
  });

  it('builds stable workspace and branch identities', () => {
    const workspace = {
      repoRootPath: '/',
      summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
      staged: [{ section: 'staged', path: 'src/app.ts', patchPath: 'src/app.ts' }],
      unstaged: [],
      untracked: [],
      conflicted: [],
    };
    expect(workspaceEntryKey(workspace.staged[0])).toBe('staged:src/app.ts');
    expect(findWorkspaceChangeByKey(workspace, 'staged:src/app.ts')?.path).toBe('src/app.ts');

    const branches = {
      repoRootPath: '/',
      local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
      remote: [{ name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote' }],
    };
    expect(branchIdentity(branches.local[0])).toBe('refs/heads/main');
    expect(allGitBranches(branches)).toHaveLength(2);
  });
});
