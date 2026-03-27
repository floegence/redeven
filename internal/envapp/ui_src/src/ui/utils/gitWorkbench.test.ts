import { describe, expect, it } from 'vitest';

import {
  allGitBranches,
  branchContextSummary,
  applyWorkspaceSectionMutation,
  branchIdentity,
  branchStatusSummary,
  buildGitWorkbenchSubviewItems,
  changeSecondaryPath,
  compareHeadline,
  describeLoadedFileCount,
  findWorkspaceChangeByKey,
  pickDefaultWorkspaceViewSection,
  repoDisplayName,
  summarizeWorkspaceCount,
  unstageWorkspaceDestination,
  workspaceEntryKey,
  workspaceSectionCount,
  workspaceViewBulkActionLabel,
  workspaceViewSectionCount,
  workspaceViewSectionForItem,
  workspaceViewSectionItems,
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
      { id: 'changes', label: 'Changes', count: 4 },
      { id: 'branches', label: 'Branches', count: 5 },
      { id: 'history', label: 'Graph' },
    ]);
  });

  it('summarizes workspace counters by section', () => {
    const summary = { stagedCount: 2, unstagedCount: 3, untrackedCount: 4, conflictedCount: 1 };
    expect(summarizeWorkspaceCount(summary)).toBe(10);
    expect(workspaceSectionCount(summary, 'staged')).toBe(2);
    expect(workspaceSectionCount(summary, 'unstaged')).toBe(3);
    expect(workspaceSectionCount(summary, 'untracked')).toBe(4);
    expect(workspaceSectionCount(summary, 'conflicted')).toBe(1);
    expect(workspaceViewSectionCount(summary, 'changes')).toBe(7);
  });

  it('formats branch status and compare summary text', () => {
    expect(branchStatusSummary({ current: true, upstreamRef: 'origin/main', aheadCount: 2, behindCount: 1, worktreePath: '/wt' }))
      .toContain('Current');
    expect(branchContextSummary({ current: true, upstreamRef: 'origin/main', aheadCount: 2, behindCount: 1, worktreePath: '/wt' }))
      .toBe('Upstream origin/main · ↑2 ↓1 · Linked worktree');
    expect(compareHeadline({ repoRootPath: '/', baseRef: 'main', targetRef: 'feature', targetAheadCount: 3, targetBehindCount: 0, commits: [], files: [] }))
      .toContain('Compared branch is ahead by 3');
    expect(compareHeadline({ repoRootPath: '/', baseRef: 'main', targetRef: 'feature', targetAheadCount: 0, targetBehindCount: 0, commits: [], files: [] }))
      .toContain('matches the reference branch');
  });

  it('formats rename path fallback and repo display name', () => {
    expect(changeSecondaryPath({ oldPath: 'src/old.ts', newPath: 'src/new.ts' })).toBe('src/old.ts → src/new.ts');
    expect(changeSecondaryPath({ path: 'src/app.ts', displayPath: 'src/app.ts' })).toBe('src/app.ts');
    expect(repoDisplayName('/workspace/repo')).toBe('repo');
    expect(repoDisplayName('/')).toBe('Repository');
  });

  it('describes partially loaded file slices without conflating them with rendered rows', () => {
    expect(describeLoadedFileCount(2, 40)).toBe('Loaded 2 of 40 files');
    expect(describeLoadedFileCount(2, 40, 'staged')).toBe('Loaded 2 of 40 staged files');
    expect(describeLoadedFileCount(1, 1, 'staged')).toBe('Loaded 1 staged file');
  });

  it('builds stable workspace and branch identities', () => {
    const workspace = {
      repoRootPath: '/',
      summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
      staged: [{ section: 'staged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts' }],
      unstaged: [],
      untracked: [],
      conflicted: [],
    };
    expect(workspaceEntryKey(workspace.staged[0])).toBe('staged:modified:src/app.ts::');
    expect(findWorkspaceChangeByKey(workspace, 'staged:modified:src/app.ts::')?.path).toBe('src/app.ts');

    const branches = {
      repoRootPath: '/',
      local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
      remote: [{ name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote' }],
    };
    expect(branchIdentity(branches.local[0])).toBe('refs/heads/main');
    expect(allGitBranches(branches)).toHaveLength(2);
  });

  it('combines unstaged and untracked files into the changes view', () => {
    const workspace = {
      repoRootPath: '/',
      summary: { stagedCount: 1, unstagedCount: 1, untrackedCount: 1, conflictedCount: 1 },
      staged: [{ section: 'staged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts' }],
      unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/next.ts', displayPath: 'src/next.ts' }],
      untracked: [{ section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt' }],
      conflicted: [{ section: 'conflicted', changeType: 'modified', path: 'src/conflict.ts', displayPath: 'src/conflict.ts' }],
    };

    expect(workspaceViewSectionItems(workspace, 'changes').map((item) => item.path)).toEqual(['src/next.ts', 'notes.txt']);
    expect(workspaceViewSectionForItem(workspace.untracked[0])).toBe('changes');
    expect(workspaceViewSectionForItem(workspace.conflicted[0])).toBe('conflicted');
    expect(pickDefaultWorkspaceViewSection(workspace)).toBe('changes');
  });
});

describe('gitWorkbench workspace mutations', () => {
  it('moves tracked workspace items into staged and recounts the summary', () => {
    const next = applyWorkspaceSectionMutation({
      repoRootPath: '/workspace/repo',
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
      staged: [],
      unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts', additions: 2, deletions: 1 }],
      untracked: [{ section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt', additions: 5, deletions: 0 }],
      conflicted: [],
    }, {
      sourceSection: 'unstaged',
      paths: ['src/app.ts'],
      destinationSection: 'staged',
    });

    expect(next?.staged).toHaveLength(1);
    expect(next?.staged[0]?.section).toBe('staged');
    expect(next?.unstaged).toHaveLength(0);
    expect(next?.summary).toEqual({
      stagedCount: 1,
      unstagedCount: 0,
      untrackedCount: 1,
      conflictedCount: 0,
    });
  });

  it('returns newly added staged files back to untracked when unstaging', () => {
    const next = applyWorkspaceSectionMutation({
      repoRootPath: '/workspace/repo',
      summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
      staged: [{ section: 'staged', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt', additions: 5, deletions: 0 }],
      unstaged: [],
      untracked: [],
      conflicted: [],
    }, {
      sourceSection: 'staged',
      paths: ['notes.txt'],
      destinationSection: (item) => unstageWorkspaceDestination(item),
    });

    expect(next?.staged).toHaveLength(0);
    expect(next?.untracked).toHaveLength(1);
    expect(next?.untracked[0]?.section).toBe('untracked');
  });

  it('maps bulk button labels to the visible section', () => {
    expect(workspaceViewBulkActionLabel('changes')).toBe('Stage All');
    expect(workspaceViewBulkActionLabel('conflicted')).toBe('Stage All');
    expect(workspaceViewBulkActionLabel('staged')).toBe('Unstage All');
  });
});
