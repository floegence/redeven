// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCommitDetail = vi.fn();
const mockGetBranchCompare = vi.fn();
const mockListWorkspaceChanges = vi.fn();

vi.mock('../protocol/redeven_v1', async () => {
  const actual = await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1');
  return {
    ...actual,
    useRedevenRpc: () => ({
      git: {
        getCommitDetail: mockGetCommitDetail,
        getBranchCompare: mockGetBranchCompare,
        listWorkspaceChanges: mockListWorkspaceChanges,
      },
    }),
  };
});

import { redevenV1Contract } from '../protocol/redeven_v1';
import { GitBranchesPanel } from './GitBranchesPanel';

beforeEach(() => {
  mockGetCommitDetail.mockReset();
  mockGetBranchCompare.mockReset();
  mockListWorkspaceChanges.mockReset();
  mockGetCommitDetail.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    commit: {
      hash: '2222222222222222',
      shortHash: '22222222',
      parents: ['1111111111111111'],
      subject: 'Merge feature',
    },
    files: [],
  });
  mockGetBranchCompare.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    baseRef: 'main',
    targetRef: 'feature/demo',
    aheadCount: 1,
    behindCount: 0,
    mergeBase: 'abc1234',
    commits: [],
    files: [
      {
        changeType: 'modified',
        path: 'src/compare.ts',
        displayPath: 'src/compare.ts',
        additions: 12,
        deletions: 4,
        patchText: '@@ -1 +1 @@\n-before\n+after',
      },
    ],
  });
  mockListWorkspaceChanges.mockResolvedValue({
    repoRootPath: '/workspace/repo-linked',
    summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  });

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GitBranchesPanel interactions', () => {
  it('renders status as the default branch detail view', () => {
    let checkoutCount = 0;
    let deleteCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'feature/demo',
                  headCommit: 'abc1234',
                  workspaceSummary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 1, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 1, conflictedCount: 0 },
                  staged: [{ section: 'staged', changeType: 'modified', path: 'README.md', displayPath: 'README.md', additions: 1, deletions: 0, patchText: '@@ -1 +1 @@' }],
                  unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/linked.ts', displayPath: 'src/linked.ts', additions: 2, deletions: 1, patchText: '@@ -1 +1 @@' }],
                  untracked: [{ section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt' }],
                  conflicted: [],
                }}
                selectedBranch={{
                  name: 'feature/demo',
                  fullName: 'refs/heads/feature/demo',
                  kind: 'local',
                  current: true,
                  aheadCount: 2,
                  behindCount: 1,
                  upstreamRef: 'origin/feature/demo',
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'feature/demo',
                  local: [
                    { name: 'main', fullName: 'refs/heads/main', kind: 'local' },
                    { name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local', current: true },
                  ],
                  remote: [],
                }}
                onCheckoutBranch={() => {
                  checkoutCount += 1;
                }}
                onDeleteBranch={() => {
                  deleteCount += 1;
                }}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Status');
      expect(host.textContent).toContain('History');
      expect(host.textContent).toContain('Compare');
      expect(host.textContent).toContain('Checkout');
      expect(host.textContent).toContain('Delete');
      expect(host.textContent).toContain('src/linked.ts');
      expect(host.textContent).toContain('Upstream origin/feature/demo');
      expect(host.textContent).not.toContain('Current · Upstream origin/feature/demo');
      expect(host.textContent).toContain('Staged');
      expect(host.textContent).toContain('View Diff');
      expect(host.textContent).toContain('Switch to another branch before deleting it.');
      expect(host.textContent).not.toContain('pending review');
      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Checkout')) as HTMLButtonElement | undefined;
      const deleteButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined;
      expect(checkoutButton).toBeTruthy();
      expect(deleteButton).toBeTruthy();
      expect(checkoutButton?.disabled).toBe(true);
      expect(deleteButton?.disabled).toBe(true);
      expect(checkoutCount).toBe(0);
      expect(deleteCount).toBe(0);
    } finally {
      dispose();
    }
  });

  it('enables checkout for a non-current remote branch', () => {
    let checkoutBranch: string | undefined;
    let deleteBranch: string | undefined;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                selectedBranch={{
                  name: 'origin/feature/demo',
                  fullName: 'refs/remotes/origin/feature/demo',
                  kind: 'remote',
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
                  remote: [{ name: 'origin/feature/demo', fullName: 'refs/remotes/origin/feature/demo', kind: 'remote' }],
                }}
                onCheckoutBranch={(branch) => {
                  checkoutBranch = branch.name;
                }}
                onDeleteBranch={(branch) => {
                  deleteBranch = branch.name;
                }}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Checkout')) as HTMLButtonElement | undefined;
      const deleteButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined;
      expect(checkoutButton).toBeTruthy();
      expect(deleteButton).toBeFalsy();
      expect(checkoutButton?.disabled).toBe(false);
      checkoutButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(checkoutBranch).toBe('origin/feature/demo');
      expect(deleteBranch).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('opens linked worktree review for a linked branch and keeps delete enabled', async () => {
    let deleteCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const linkedBranch = {
      name: 'feature/linked',
      fullName: 'refs/heads/feature/linked',
      kind: 'local' as const,
      worktreePath: '/workspace/repo-linked',
    };
    const linkedPreview = {
      repoRootPath: '/workspace/repo',
      name: 'feature/linked',
      fullName: 'refs/heads/feature/linked',
      kind: 'local' as const,
      requiresWorktreeRemoval: true,
      requiresDiscardConfirmation: true,
      safeDeleteAllowed: true,
      safeDeleteBaseRef: 'main',
      planFingerprint: 'plan-1',
      linkedWorktree: {
        worktreePath: '/workspace/repo-linked',
        accessible: true,
        summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 1, conflictedCount: 0 },
        staged: [],
        unstaged: [],
        untracked: [{ section: 'untracked', changeType: 'added', path: 'scratch.txt', displayPath: 'scratch.txt', patchText: '@@ -0,0 +1 @@\n+scratch' }],
        conflicted: [],
      },
    };

    const dispose = render(() => {
      const [deleteReviewOpen, setDeleteReviewOpen] = createSignal(false);
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={linkedBranch}
                  branches={{
                    repoRootPath: '/workspace/repo',
                    currentRef: 'main',
                    local: [
                      { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
                      linkedBranch,
                    ],
                    remote: [],
                  }}
                  deleteReviewOpen={deleteReviewOpen()}
                  deleteReviewBranch={linkedBranch}
                  deletePreview={deleteReviewOpen() ? linkedPreview : null}
                  onDeleteBranch={() => {
                    deleteCount += 1;
                    setDeleteReviewOpen(true);
                  }}
                  onCloseDeleteReview={() => setDeleteReviewOpen(false)}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      const deleteButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined;
      expect(deleteButton).toBeTruthy();
      expect(deleteButton?.disabled).toBe(false);
      deleteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();

      expect(deleteCount).toBe(1);
      expect(document.body.textContent).toContain('Delete Branch Review');
      expect(document.body.textContent).toContain('/workspace/repo-linked');
      expect(document.body.textContent).toContain('scratch.txt');
      expect(document.body.textContent).toContain('Safe delete ready');
      expect(document.body.textContent).toContain('Final checkpoint');
      expect(document.body.textContent).toContain('Approve permanent file discard');
      expect(host.textContent).toContain('linked worktree');
      expect(host.textContent).toContain('/workspace/repo-linked');
      const footer = Array.from(document.body.querySelectorAll('div')).find((node) => node.className.includes('border-t border-border/60 bg-background/88 px-4 pt-3 pb-4')) as HTMLDivElement | undefined;
      const confirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Discard Changes, Delete Worktree and Branch') as HTMLButtonElement | undefined;
      expect(footer).toBeTruthy();
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.className).toContain('w-full');
      expect(confirmButton?.disabled).toBe(true);
    } finally {
      dispose();
    }
  });

  it('stacks branch actions into full-width rows for narrow layouts', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px] w-[320px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                selectedBranch={{
                  name: 'feature/mobile',
                  fullName: 'refs/heads/feature/mobile',
                  kind: 'local',
                  worktreePath: '/workspace/repo-mobile',
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [
                    { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
                    { name: 'feature/mobile', fullName: 'refs/heads/feature/mobile', kind: 'local', worktreePath: '/workspace/repo-mobile' },
                  ],
                  remote: [],
                }}
                onCheckoutBranch={() => {}}
                onDeleteBranch={() => {}}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const branchHeader = Array.from(host.querySelectorAll('div')).find((node) => node.className.includes('sm:flex-row sm:flex-wrap sm:items-start sm:justify-between')) as HTMLDivElement | undefined;
      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Checkout')) as HTMLButtonElement | undefined;
      const deleteButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined;
      const tablist = host.querySelector('[aria-label="Branch detail tabs"]') as HTMLDivElement | null;
      const disabledReason = Array.from(host.querySelectorAll('div')).find((node) => node.className.includes('sm:text-right') && node.textContent?.includes('This branch is checked out in a linked worktree: /workspace/repo-mobile')) as HTMLDivElement | undefined;

      expect(branchHeader).toBeTruthy();
      expect(checkoutButton?.className).toContain('flex-1');
      expect(deleteButton?.className).toContain('flex-1');
      expect(tablist?.className).toContain('grid');
      expect(tablist?.className).toContain('w-full');
      expect(tablist?.className).toContain('grid-cols-2');
      expect(disabledReason?.className).toContain('w-full');
      expect(disabledReason?.className).toContain('sm:text-right');
    } finally {
      dispose();
    }
  });

  it('opens a lightweight confirmation dialog before deleting a local branch', async () => {
    let requestedBranch: string | undefined;
    let confirmedBranch: string | undefined;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const branch = {
      name: 'feature/demo',
      fullName: 'refs/heads/feature/demo',
      kind: 'local' as const,
    };
    const preview = {
      repoRootPath: '/workspace/repo',
      name: 'feature/demo',
      fullName: 'refs/heads/feature/demo',
      kind: 'local' as const,
      requiresWorktreeRemoval: false,
      requiresDiscardConfirmation: false,
      safeDeleteAllowed: true,
      safeDeleteBaseRef: 'main',
      planFingerprint: 'plan-1',
    };

    const dispose = render(() => {
      const [deleteReviewOpen, setDeleteReviewOpen] = createSignal(false);
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: '/workspace/repo',
                    currentRef: 'main',
                    local: [
                      { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
                      branch,
                    ],
                    remote: [],
                  }}
                  deleteReviewOpen={deleteReviewOpen()}
                  deleteReviewBranch={branch}
                  deletePreview={deleteReviewOpen() ? preview : null}
                  onDeleteBranch={(selected) => {
                    requestedBranch = selected.name;
                    setDeleteReviewOpen(true);
                  }}
                  onCloseDeleteReview={() => setDeleteReviewOpen(false)}
                  onConfirmDeleteBranch={(selected) => {
                    confirmedBranch = selected.name;
                    setDeleteReviewOpen(false);
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      const deleteButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined;
      expect(deleteButton).toBeTruthy();
      deleteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();

      expect(requestedBranch).toBe('feature/demo');
      expect(document.body.textContent).toContain('Delete Branch');
      expect(document.body.textContent).toContain('Delete base main');
      expect(document.body.textContent).toContain('Safe delete ready');
      expect(document.body.textContent).toContain('Final action');
      const footer = Array.from(document.body.querySelectorAll('div')).find((node) => node.className.includes('border-t border-border/60 bg-background/88 px-4 pt-3 pb-4')) as HTMLDivElement | undefined;
      const confirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete Branch') as HTMLButtonElement | undefined;
      expect(footer).toBeTruthy();
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.className).toContain('w-full');
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(confirmedBranch).toBe('feature/demo');
    } finally {
      dispose();
    }
  });

  it('shows expandable commit files and opens diffs from branch history', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mockGetCommitDetail.mockResolvedValue({
      repoRootPath: '/workspace/repo',
      commit: {
        hash: '2222222222222222',
        shortHash: '22222222',
        parents: ['1111111111111111', '9999999999999999'],
        subject: 'Merge feature',
      },
      files: [
        {
          changeType: 'modified',
          path: 'src/history.ts',
          displayPath: 'src/history.ts',
          additions: 8,
          deletions: 3,
          patchText: '@@ -1 +1 @@\n-history\n+history updated',
        },
      ],
    });

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                selectedBranch={{
                  name: 'feature/demo',
                  fullName: 'refs/heads/feature/demo',
                  kind: 'local',
                  current: true,
                  aheadCount: 1,
                  behindCount: 0,
                }}
                selectedBranchSubview="history"
                commits={[
                  { hash: '1111111111111111', shortHash: '11111111', parents: ['0000000000000000'], subject: 'First commit', authorName: 'Alice', authorTimeMs: 1706000000000 },
                  { hash: '2222222222222222', shortHash: '22222222', parents: ['1111111111111111', '9999999999999999'], subject: 'Merge feature', authorName: 'Bob', authorTimeMs: 1706003600000 },
                ]}
                selectedCommitHash="2222222222222222"
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await Promise.resolve();
      await Promise.resolve();

      expect(host.textContent).toContain('First commit');
      expect(host.textContent).toContain('Merge feature');
      expect(host.textContent).toContain('11111111');
      expect(host.textContent).toContain('Files in Commit');
      expect(host.textContent).toContain('src/history.ts');
      expect(host.textContent).toContain('+8');
      expect(host.textContent).toContain('-3');

      const diffButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('View Diff')) as HTMLButtonElement | undefined;
      expect(diffButton).toBeTruthy();
      diffButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await Promise.resolve();
      expect(document.body.textContent).toContain('Commit Diff');
      expect(document.body.textContent).toContain('history updated');
    } finally {
      dispose();
    }
  });

  it('keeps compare dialog scrolling inside the changed files table region', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                selectedBranch={{
                  name: 'feature/demo',
                  fullName: 'refs/heads/feature/demo',
                  kind: 'local',
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [
                    { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
                    { name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local' },
                  ],
                  remote: [],
                }}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const compareButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Compare')) as HTMLButtonElement | undefined;
      expect(compareButton).toBeTruthy();
      compareButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(document.body.textContent).toContain('Compare branches');
      expect(document.body.textContent).toContain('Changed Files');
      expect(document.body.textContent).toContain('src/compare.ts');

      const dialogRoot = Array.from(document.body.querySelectorAll('[role="dialog"]')).find((node) => node.textContent?.includes('Compare branches')) as HTMLDivElement | undefined;
      expect(dialogRoot).toBeTruthy();
      expect(dialogRoot?.className).toContain('[&>div:last-child]:!overflow-hidden');
      expect(dialogRoot?.className).toContain('[&>div:last-child]:flex');
      expect(dialogRoot?.className).toContain('[&>div:last-child]:!p-0');
      const closeButton = dialogRoot?.querySelector('button[aria-label="Close"]') as HTMLButtonElement | null | undefined;
      expect(closeButton).toBeTruthy();
      expect(closeButton?.className).toContain('hover:bg-red-500');
      expect(closeButton?.className).not.toContain('hover:bg-muted/80');

      const changedFilesScrollRegion = Array.from(dialogRoot?.querySelectorAll('div') ?? []).find((node) => node.className.includes('min-h-0 flex-1 overflow-auto')) as HTMLDivElement | undefined;
      expect(changedFilesScrollRegion).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('uses the branch empty-state copy before a branch is selected', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel repoRootPath="/workspace/repo" />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Choose a branch from the sidebar to inspect its status or history.');
    } finally {
      dispose();
    }
  });
});
