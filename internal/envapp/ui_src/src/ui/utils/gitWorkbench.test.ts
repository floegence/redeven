import { describe, expect, it } from 'vitest';
import {
  branchStatusSummary,
  buildGitWorkbenchSubviewItems,
  changeSecondaryPath,
  compareHeadline,
  summarizeWorkspaceCount,
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

  it('formats rename path fallback', () => {
    expect(changeSecondaryPath({ oldPath: 'src/old.ts', newPath: 'src/new.ts' })).toBe('src/old.ts → src/new.ts');
    expect(changeSecondaryPath({ path: 'src/app.ts' })).toBe('src/app.ts');
  });
});
