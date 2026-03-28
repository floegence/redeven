// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCommitDetail = vi.fn();
const mockGetBranchCompare = vi.fn();
const mockListWorkspacePage = vi.fn();
const mockGetDiffContent = vi.fn();

vi.mock('../protocol/redeven_v1', async () => {
  const actual = await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1');
  return {
    ...actual,
    useRedevenRpc: () => ({
      git: {
        getCommitDetail: mockGetCommitDetail,
        getBranchCompare: mockGetBranchCompare,
        getDiffContent: mockGetDiffContent,
        listWorkspacePage: mockListWorkspacePage,
      },
    }),
  };
});

import { redevenV1Contract } from '../protocol/redeven_v1';
import { GitBranchesPanel } from './GitBranchesPanel';

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mockGetCommitDetail.mockReset();
  mockGetBranchCompare.mockReset();
  mockListWorkspacePage.mockReset();
  mockGetDiffContent.mockReset();
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
  mockGetDiffContent.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    mode: 'preview',
    file: {
      changeType: 'modified',
      path: 'src/compare.ts',
      displayPath: 'src/compare.ts',
      additions: 12,
      deletions: 4,
      patchText: '@@ -1 +1 @@\n-before\n+after',
    },
  });
  mockListWorkspacePage.mockResolvedValue({
    repoRootPath: '/workspace/repo-linked',
    section: 'changes',
    summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
    totalCount: 0,
    offset: 0,
    nextOffset: 0,
    hasMore: false,
    items: [],
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

async function revealTooltipForButton(button: HTMLButtonElement | undefined): Promise<HTMLElement | null> {
  const host = button?.closest('[data-redeven-tooltip-anchor]') as HTMLElement | null;
  expect(host).toBeTruthy();
  host!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await flush();
  return document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
}

function findGitTitleDot(container: ParentNode, label: string): HTMLSpanElement | null {
  const labelNode = Array.from(container.querySelectorAll('div')).find((node) => (
    node.textContent?.trim() === label
    && node.className.includes('tracking-[0.16em]')
  )) as HTMLDivElement | undefined;
  expect(labelNode).toBeTruthy();
  return labelNode?.parentElement?.querySelector('span[aria-hidden="true"]') as HTMLSpanElement | null;
}

describe('GitBranchesPanel interactions', () => {
  it('loads current branch status from the active worktree root', async () => {
    let checkoutCount = 0;
    let mergeCount = 0;
    let deleteCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo-linked',
      section: 'changes',
      summary: { stagedCount: 1, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
      totalCount: 2,
      offset: 0,
      nextOffset: 2,
      hasMore: false,
      items: [
        { section: 'unstaged', changeType: 'modified', path: 'src/linked.ts', displayPath: 'src/linked.ts', additions: 2, deletions: 1, patchText: '@@ -1 +1 @@' },
        { section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt' },
      ],
    });

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo-linked"
                repoSummary={{
                  repoRootPath: '/workspace/repo-linked',
                  headRef: 'feature/demo',
                  headCommit: 'abc1234',
                  workspaceSummary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 1, conflictedCount: 0 },
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
                onMergeBranch={() => {
                  mergeCount += 1;
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
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo-linked',
        section: 'changes',
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain('Status');
      expect(host.textContent).toContain('History');
      expect(host.textContent).toContain('Compare');
      expect(host.textContent).toContain('Checkout');
      expect(host.textContent).toContain('Merge');
      expect(host.textContent).toContain('Delete');
      expect(host.textContent).toContain('src/linked.ts');
      expect(host.textContent).toContain('notes.txt');
      expect(host.textContent).toContain('Upstream origin/feature/demo');
      expect(host.textContent).not.toContain('Current · Upstream origin/feature/demo');
      expect(host.textContent).toContain('Changes');
      expect(host.textContent).toContain('Staged');
      expect(host.textContent).toContain('Unstaged');
      expect(host.textContent).toContain('Untracked');
      expect(host.textContent).toContain('View Diff');
      expect(host.textContent).not.toContain('Select another branch to merge into the current branch.');
      expect(host.textContent).not.toContain('Switch to another branch before deleting it.');
      expect(host.textContent).not.toContain('pending review');
      const changesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Changes')) as HTMLButtonElement | undefined;
      const unstagedButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Unstaged')) as HTMLButtonElement | undefined;
      const untrackedButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Untracked')) as HTMLButtonElement | undefined;
      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Checkout')) as HTMLButtonElement | undefined;
      const mergeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Merge') as HTMLButtonElement | undefined;
      const deleteButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined;
      expect(changesButton).toBeTruthy();
      expect(changesButton?.className).toContain('redeven-surface-segmented__item--active');
      expect(changesButton?.className).toContain('text-foreground');
      expect(changesButton?.className).not.toContain('git-browser-selection-surface');
      expect(unstagedButton).toBeFalsy();
      expect(untrackedButton).toBeFalsy();
      expect(checkoutButton).toBeTruthy();
      expect(mergeButton).toBeTruthy();
      expect(deleteButton).toBeTruthy();
      expect(checkoutButton?.disabled).toBe(true);
      expect(mergeButton?.disabled).toBe(true);
      expect(deleteButton?.disabled).toBe(true);
      expect(checkoutCount).toBe(0);
      expect(mergeCount).toBe(0);
      expect(deleteCount).toBe(0);
    } finally {
      dispose();
    }
  });

  it('keeps paged branch totals in footer copy without inventing unloaded scroll space', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo-linked',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
      totalCount: 40,
      offset: 0,
      nextOffset: 2,
      hasMore: true,
      items: [
        { section: 'unstaged', changeType: 'modified', path: 'src/linked.ts', displayPath: 'src/linked.ts', additions: 2, deletions: 1, patchText: '@@ -1 +1 @@' },
        { section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt' },
      ],
    });

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo-linked"
                repoSummary={{
                  repoRootPath: '/workspace/repo-linked',
                  headRef: 'feature/demo',
                  headCommit: 'abc1234',
                  workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
                }}
                selectedBranch={{
                  name: 'feature/demo',
                  fullName: 'refs/heads/feature/demo',
                  kind: 'local',
                  current: true,
                }}
                branches={{
                  repoRootPath: '/workspace/repo-linked',
                  currentRef: 'feature/demo',
                  local: [
                    { name: 'main', fullName: 'refs/heads/main', kind: 'local' },
                    { name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local', current: true },
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
      await flush();

      expect(host.textContent).toContain('Showing 2 of 40 files.');
      expect(host.textContent).toContain('src/linked.ts');
      expect(host.textContent).toContain('notes.txt');
      expect(host.querySelectorAll('tr[aria-hidden="true"] td')).toHaveLength(0);
    } finally {
      dispose();
    }
  });

  it('renders semantic title dots for the branch summary and status headers', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo-linked',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [
        { section: 'unstaged', changeType: 'modified', path: 'src/linked.ts', displayPath: 'src/linked.ts', additions: 2, deletions: 1, patchText: '@@ -1 +1 @@' },
      ],
    });

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo-linked"
                repoSummary={{
                  repoRootPath: '/workspace/repo-linked',
                  headRef: 'feature/demo',
                  headCommit: 'abc1234',
                  workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
                }}
                selectedBranch={{
                  name: 'feature/demo',
                  fullName: 'refs/heads/feature/demo',
                  kind: 'local',
                  current: true,
                  upstreamRef: 'origin/feature/demo',
                }}
                branches={{
                  repoRootPath: '/workspace/repo-linked',
                  currentRef: 'feature/demo',
                  local: [
                    { name: 'main', fullName: 'refs/heads/main', kind: 'local' },
                    { name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local', current: true },
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
      await flush();

      const branchDot = findGitTitleDot(host, 'Branch');
      const statusDot = findGitTitleDot(host, 'Status');

      expect(branchDot?.className).toContain('git-tone-dot');
      expect(branchDot?.className).toContain('git-tone-dot--brand');
      expect(branchDot?.className).not.toContain('bg-blue-600/80');
      expect(statusDot?.className).toContain('git-tone-dot');
      expect(statusDot?.className).toContain('git-tone-dot--neutral');
      expect(statusDot?.className).not.toContain('bg-muted-foreground/55');
    } finally {
      dispose();
    }
  });

  it('enables checkout for a non-current remote branch', () => {
    let checkoutBranch: string | undefined;
    let mergeBranch: string | undefined;
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
                onMergeBranch={(branch) => {
                  mergeBranch = branch.name;
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
      expect(host.textContent).toContain('Remote branch is not checked out');
      expect(host.textContent).toContain('Status is only available for checked-out local worktrees.');
      expect(mockListWorkspacePage).not.toHaveBeenCalled();
      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Checkout')) as HTMLButtonElement | undefined;
      const mergeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Merge') as HTMLButtonElement | undefined;
      const deleteButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined;
      expect(checkoutButton).toBeTruthy();
      expect(mergeButton).toBeTruthy();
      expect(deleteButton).toBeFalsy();
      expect(checkoutButton?.disabled).toBe(false);
      expect(mergeButton?.disabled).toBe(false);
      checkoutButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      mergeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(checkoutBranch).toBe('origin/feature/demo');
      expect(mergeBranch).toBe('origin/feature/demo');
      expect(deleteBranch).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('loads linked worktree branch status from the linked worktree root', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo-linked',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
      totalCount: 2,
      offset: 0,
      nextOffset: 2,
      hasMore: false,
      items: [
        { section: 'unstaged', changeType: 'modified', path: 'src/linked.ts', displayPath: 'src/linked.ts', additions: 3, deletions: 1, patchText: '@@ -1 +1 @@\n-before\n+after' },
        { section: 'untracked', changeType: 'added', path: 'scratch.txt', displayPath: 'scratch.txt', patchText: '@@ -0,0 +1 @@\n+scratch' },
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
                  name: 'feature/linked',
                  fullName: 'refs/heads/feature/linked',
                  kind: 'local',
                  worktreePath: '/workspace/repo-linked',
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [
                    { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
                    { name: 'feature/linked', fullName: 'refs/heads/feature/linked', kind: 'local', worktreePath: '/workspace/repo-linked' },
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
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo-linked',
        section: 'changes',
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain('src/linked.ts');
      expect(host.textContent).toContain('scratch.txt');
      expect(host.textContent).toContain('Changes');
      expect(host.textContent).toContain('View Diff');

      const changesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Changes')) as HTMLButtonElement | undefined;
      const untrackedButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Untracked')) as HTMLButtonElement | undefined;
      expect(changesButton).toBeTruthy();
      expect(untrackedButton).toBeFalsy();
    } finally {
      dispose();
    }
  });

  it('loads staged files after explicitly switching sections', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mockListWorkspacePage
      .mockResolvedValueOnce({
        repoRootPath: '/workspace/repo-linked',
        section: 'changes',
        summary: { stagedCount: 1, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          { section: 'unstaged', changeType: 'modified', path: 'src/pending.ts', displayPath: 'src/pending.ts', additions: 3, deletions: 1 },
        ],
      })
      .mockResolvedValueOnce({
        repoRootPath: '/workspace/repo-linked',
        section: 'staged',
        summary: { stagedCount: 1, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          { section: 'staged', changeType: 'modified', path: 'src/indexed.ts', displayPath: 'src/indexed.ts', additions: 5, deletions: 2 },
        ],
      });

    const branch = {
      name: 'feature/linked',
      fullName: 'refs/heads/feature/linked',
      kind: 'local' as const,
      worktreePath: '/workspace/repo-linked',
    };

    const dispose = render(() => (
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
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const stagedButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Staged')) as HTMLButtonElement | undefined;
      expect(stagedButton).toBeTruthy();

      stagedButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledTimes(2);
      expect(mockListWorkspacePage).toHaveBeenLastCalledWith({
        repoRootPath: '/workspace/repo-linked',
        section: 'staged',
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain('src/indexed.ts');
      expect(host.textContent).not.toContain('src/pending.ts');
    } finally {
      dispose();
    }
  });

  it('keeps an explicit staged selection even when the previous summary reported no staged files', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mockListWorkspacePage
      .mockResolvedValueOnce({
        repoRootPath: '/workspace/repo-linked',
        section: 'changes',
        summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          { section: 'unstaged', changeType: 'modified', path: 'src/pending.ts', displayPath: 'src/pending.ts', additions: 2, deletions: 1 },
        ],
      })
      .mockResolvedValueOnce({
        repoRootPath: '/workspace/repo-linked',
        section: 'staged',
        summary: { stagedCount: 1, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          { section: 'staged', changeType: 'modified', path: 'src/indexed.ts', displayPath: 'src/indexed.ts', additions: 4, deletions: 1 },
        ],
      });

    const branch = {
      name: 'feature/linked',
      fullName: 'refs/heads/feature/linked',
      kind: 'local' as const,
      worktreePath: '/workspace/repo-linked',
    };

    const dispose = render(() => (
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
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const stagedButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Staged')) as HTMLButtonElement | undefined;
      expect(stagedButton).toBeTruthy();

      stagedButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledTimes(2);
      expect(mockListWorkspacePage).toHaveBeenLastCalledWith({
        repoRootPath: '/workspace/repo-linked',
        section: 'staged',
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain('src/indexed.ts');
      expect(host.textContent).not.toContain('src/pending.ts');
    } finally {
      dispose();
    }
  });

  it('auto-focuses conflicted files when a new branch context has no pending changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mockListWorkspacePage
      .mockResolvedValueOnce({
        repoRootPath: '/workspace/repo-linked',
        section: 'changes',
        summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 1 },
        totalCount: 0,
        offset: 0,
        nextOffset: 0,
        hasMore: false,
        items: [],
      })
      .mockResolvedValueOnce({
        repoRootPath: '/workspace/repo-linked',
        section: 'conflicted',
        summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 1 },
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          { section: 'conflicted', changeType: 'conflicted', path: 'src/conflict.ts', displayPath: 'src/conflict.ts', additions: 0, deletions: 0 },
        ],
      });

    const branch = {
      name: 'feature/linked',
      fullName: 'refs/heads/feature/linked',
      kind: 'local' as const,
      worktreePath: '/workspace/repo-linked',
    };

    const dispose = render(() => (
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
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledTimes(2);
      expect(mockListWorkspacePage).toHaveBeenNthCalledWith(1, {
        repoRootPath: '/workspace/repo-linked',
        section: 'changes',
        offset: 0,
        limit: 200,
      });
      expect(mockListWorkspacePage).toHaveBeenNthCalledWith(2, {
        repoRootPath: '/workspace/repo-linked',
        section: 'conflicted',
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain('src/conflict.ts');
    } finally {
      dispose();
    }
  });

  it('opens the stash window for a linked branch worktree from status actions', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onOpenStash = vi.fn();

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo-linked',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [{ section: 'unstaged', changeType: 'modified', path: 'src/linked.ts', displayPath: 'src/linked.ts' }],
    });

    const branch = {
      name: 'feature/linked',
      fullName: 'refs/heads/feature/linked',
      kind: 'local' as const,
      worktreePath: '/workspace/repo-linked',
    };

    const dispose = render(() => (
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
                onOpenStash={onOpenStash}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const stashButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Stash...')) as HTMLButtonElement | undefined;
      expect(stashButton).toBeTruthy();
      stashButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onOpenStash).toHaveBeenCalledWith({
        tab: 'save',
        repoRootPath: '/workspace/repo-linked',
        source: 'branch_status',
      });
    } finally {
      dispose();
    }
  });

  it('exposes Ask Flower, Terminal, and Files for linked branch worktrees', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onAskFlower = vi.fn();
    const onOpenInTerminal = vi.fn();
    const onBrowseFiles = vi.fn();

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo-linked',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
      totalCount: 2,
      offset: 0,
      nextOffset: 2,
      hasMore: false,
      items: [
        { section: 'unstaged', changeType: 'modified', path: 'src/linked.ts', displayPath: 'src/linked.ts', additions: 3, deletions: 1 },
        { section: 'untracked', changeType: 'added', path: 'scratch.txt', displayPath: 'scratch.txt' },
      ],
    });

    const branch = {
      name: 'feature/linked',
      fullName: 'refs/heads/feature/linked',
      kind: 'local' as const,
      worktreePath: '/workspace/repo-linked',
    };

    const dispose = render(() => (
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
                onAskFlower={onAskFlower}
                onOpenInTerminal={onOpenInTerminal}
                onBrowseFiles={onBrowseFiles}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const shortcutDocks = host.querySelectorAll('[data-git-shortcut-dock]');
      const askFlowerButton = host.querySelector('button[aria-label="Ask Flower"]') as HTMLButtonElement | null;
      const openInTerminalButton = host.querySelector('button[aria-label="Terminal"]') as HTMLButtonElement | null;
      const browseFilesButton = host.querySelector('button[aria-label="Files"]') as HTMLButtonElement | null;

      expect(shortcutDocks.length).toBeGreaterThan(0);
      expect(shortcutDocks[0]?.className).toContain('items-center');
      expect(askFlowerButton).toBeTruthy();
      expect(openInTerminalButton).toBeTruthy();
      expect(browseFilesButton).toBeTruthy();
      expect(askFlowerButton?.dataset.gitShortcutOrb).toBe('flower');
      expect(openInTerminalButton?.dataset.gitShortcutOrb).toBe('terminal');
      expect(browseFilesButton?.dataset.gitShortcutOrb).toBe('files');
      expect(askFlowerButton?.className).toContain('h-7');
      expect(openInTerminalButton?.className).toContain('h-7');
      expect(browseFilesButton?.className).toContain('h-7');
      expect(askFlowerButton?.textContent).toBe('');
      expect(openInTerminalButton?.textContent).toBe('');
      expect(browseFilesButton?.textContent).toBe('');

      askFlowerButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      openInTerminalButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      browseFilesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onAskFlower).toHaveBeenCalledWith({
        kind: 'branch_status',
        repoRootPath: '/workspace/repo',
        worktreePath: '/workspace/repo-linked',
        branch,
        section: 'changes',
        items: [
          { section: 'unstaged', changeType: 'modified', path: 'src/linked.ts', displayPath: 'src/linked.ts', additions: 3, deletions: 1 },
          { section: 'untracked', changeType: 'added', path: 'scratch.txt', displayPath: 'scratch.txt' },
        ],
      });
      expect(onOpenInTerminal).toHaveBeenCalledWith({
        path: '/workspace/repo-linked',
        preferredName: 'repo-linked',
      });
      expect(onBrowseFiles).toHaveBeenCalledWith({
        path: '/workspace/repo-linked',
        preferredName: 'repo-linked',
      });
    } finally {
      dispose();
    }
  });

  it('shows an unavailable status message for a local branch without a checked-out worktree', () => {
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
                  name: 'feature/offline',
                  fullName: 'refs/heads/feature/offline',
                  kind: 'local',
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [
                    { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
                    { name: 'feature/offline', fullName: 'refs/heads/feature/offline', kind: 'local' },
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
      expect(host.textContent).toContain('Branch is not checked out');
      expect(host.textContent).toContain('Status is only available for checked-out local worktrees.');
      expect(host.textContent).toContain('Use Compare to inspect file diffs, or open this branch in a worktree to review workspace changes.');
      expect(mockListWorkspacePage).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('shows tooltip reasons for disabled branch shortcuts without a checked-out worktree', async () => {
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
                  name: 'feature/offline',
                  fullName: 'refs/heads/feature/offline',
                  kind: 'local',
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [
                    { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
                    { name: 'feature/offline', fullName: 'refs/heads/feature/offline', kind: 'local' },
                  ],
                  remote: [],
                }}
                onAskFlower={() => {}}
                onOpenInTerminal={() => {}}
                onBrowseFiles={() => {}}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const askFlowerButton = host.querySelector('button[aria-label="Ask Flower"]') as HTMLButtonElement | undefined;
      const terminalButton = host.querySelector('button[aria-label="Terminal"]') as HTMLButtonElement | undefined;
      const filesButton = host.querySelector('button[aria-label="Files"]') as HTMLButtonElement | undefined;

      expect(askFlowerButton?.disabled).toBe(true);
      expect(terminalButton?.disabled).toBe(true);
      expect(filesButton?.disabled).toBe(true);

      const askTooltip = await revealTooltipForButton(askFlowerButton);
      expect(askTooltip?.textContent).toContain('Open this branch in a worktree first.');
      (askFlowerButton?.closest('[data-redeven-tooltip-anchor]') as HTMLElement | null)?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      await flush();

      const terminalTooltip = await revealTooltipForButton(terminalButton);
      expect(terminalTooltip?.textContent).toContain('Open this branch in a worktree first.');
      (terminalButton?.closest('[data-redeven-tooltip-anchor]') as HTMLElement | null)?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      await flush();

      const filesTooltip = await revealTooltipForButton(filesButton);
      expect(filesTooltip?.textContent).toContain('Open this branch in a worktree first.');
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
      forceDeleteAllowed: true,
      forceDeleteRequiresConfirm: true,
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
      expect(document.body.textContent).toContain('Delete Branch');
      expect(document.body.textContent).toContain('/workspace/repo-linked');
      expect(document.body.textContent).toContain('Delete the local branch reference for');
      expect(document.body.textContent).toContain('Remove the linked worktree at');
      expect(document.body.textContent).toContain('Uncommitted changes in that worktree will be discarded (1 untracked).');
      expect(document.body.textContent).not.toContain('Files discarded');
      expect(document.body.textContent).not.toContain('Safe delete ready');
      expect(document.body.textContent).not.toContain('Delete Confirmation');
      expect(document.body.textContent).not.toContain('Approve permanent file discard');
      expect(document.body.textContent).not.toContain('scratch.txt');
      const footer = Array.from(document.body.querySelectorAll('div')).find((node) => node.className.includes('border-t') && node.className.includes('redeven-surface-inset') && node.className.includes('px-4') && node.className.includes('pt-3') && node.className.includes('pb-4')) as HTMLDivElement | undefined;
      const confirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete Branch and Worktree') as HTMLButtonElement | undefined;
      expect(footer).toBeTruthy();
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.className).toContain('w-full');
      expect(confirmButton?.disabled).toBe(false);
    } finally {
      dispose();
    }
  });

  it('keeps branch header controls compact without squeezing branch metadata at mid widths', () => {
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
                onOpenInTerminal={() => {}}
                onBrowseFiles={() => {}}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const controlBar = Array.from(host.querySelectorAll('div')).find((node) => node.className.includes('rounded-xl') && node.className.includes('redeven-surface-control') && node.className.includes('bg-muted/[0.12]')) as HTMLDivElement | undefined;
      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Checkout')) as HTMLButtonElement | undefined;
      const deleteButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined;
      const tablist = host.querySelector('[aria-label="Branch detail tabs"]') as HTMLDivElement | null;
      const tablistRow = tablist?.parentElement as HTMLDivElement | null;
      const branchHeaderTopRow = tablistRow?.parentElement as HTMLDivElement | null;
      const shortcutDock = host.querySelector('[data-git-shortcut-dock]') as HTMLDivElement | null;
      const actionsGroup = Array.from(controlBar?.querySelectorAll('div') ?? []).find((node) =>
        node.className.includes('lg:ml-auto') &&
        node.textContent?.includes('Actions') &&
        node.textContent.includes('Checkout') &&
        node.textContent.includes('Delete')) as HTMLDivElement | undefined;

      expect(controlBar).toBeTruthy();
      expect(shortcutDock).toBeTruthy();
      expect(actionsGroup).toBeTruthy();
      expect(actionsGroup?.className).toContain('flex');
      expect(actionsGroup?.className).toContain('flex-wrap');
      expect(actionsGroup?.className).toContain('lg:ml-auto');
      expect(checkoutButton?.className).toContain('rounded-md');
      expect(deleteButton?.className).toContain('rounded-md');
      expect(checkoutButton?.className).toContain('cursor-pointer');
      expect(deleteButton?.className).toContain('bg-destructive/[0.08]');
      expect(checkoutButton?.className).not.toContain('w-full');
      expect(deleteButton?.className).not.toContain('w-full');
      expect(tablistRow?.className).toContain('flex');
      expect(tablistRow?.className).toContain('w-full');
      expect(tablistRow?.className).toContain('lg:w-auto');
      expect(tablistRow?.className).toContain('lg:justify-end');
      expect(branchHeaderTopRow?.className).toContain('grid');
      expect(branchHeaderTopRow?.className).toContain('grid-cols-1');
      expect(branchHeaderTopRow?.className).toContain('lg:grid-cols-[minmax(0,1fr)_auto]');
      expect(branchHeaderTopRow?.textContent).not.toContain('Checkout');
      expect(tablist?.className).toContain('grid');
      expect(tablist?.className).toContain('w-full');
      expect(tablist?.className).toContain('grid-cols-2');
      expect(tablist?.className).toContain('rounded-lg');
      expect(tablist?.className).toContain('redeven-surface-segmented');
      expect(tablist?.className).toContain('lg:w-[15rem]');
      expect(tablist?.className).not.toContain('sm:w-[15rem]');
      const activeTab = host.querySelector('#git-branch-subview-tab-status') as HTMLButtonElement | null;
      const historyTab = host.querySelector('#git-branch-subview-tab-history') as HTMLButtonElement | null;
      expect(activeTab?.className).toContain('cursor-pointer');
      expect(activeTab?.className).toContain('redeven-surface-segmented__item');
      expect(activeTab?.className).toContain('redeven-surface-segmented__item--active');
      expect(activeTab?.className).toContain('text-foreground');
      expect(activeTab?.className).not.toContain('git-browser-selection-chip');
      expect(historyTab?.className).toContain('text-muted-foreground');
    } finally {
      dispose();
    }
  });

  it('hides the empty branch summary instead of rendering no extra status copy', async () => {
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
                  name: 'feature/clean',
                  fullName: 'refs/heads/feature/clean',
                  kind: 'local',
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [
                    { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
                    { name: 'feature/clean', fullName: 'refs/heads/feature/clean', kind: 'local' },
                  ],
                  remote: [],
                }}
                onCheckoutBranch={() => {}}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      expect(host.textContent).toContain('feature/clean');
      expect(host.textContent).not.toContain('No extra status');
    } finally {
      dispose();
    }
  });

  it('supports keyboard navigation for the branch detail tabs', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => {
      const [subview, setSubview] = createSignal<'status' | 'history'>('status');
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranchSubview={subview()}
                  onSelectBranchSubview={setSubview}
                  selectedBranch={{
                    name: 'feature/demo',
                    fullName: 'refs/heads/feature/demo',
                    kind: 'local',
                    current: true,
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
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      const statusTab = host.querySelector('#git-branch-subview-tab-status') as HTMLButtonElement | null;
      expect(statusTab?.getAttribute('aria-controls')).toBe('git-branch-subview-panel-status');
      statusTab!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await Promise.resolve();

      const historyTab = host.querySelector('#git-branch-subview-tab-history') as HTMLButtonElement | null;
      expect(historyTab?.getAttribute('aria-selected')).toBe('true');
      expect(historyTab?.getAttribute('tabindex')).toBe('0');
      expect(document.activeElement).toBe(historyTab);
      expect(host.querySelector('#git-branch-subview-panel-history')).toBeTruthy();
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
      forceDeleteAllowed: true,
      forceDeleteRequiresConfirm: true,
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
      expect(document.body.textContent).toContain('Delete the local branch reference for');
      expect(document.body.textContent).toContain('Leave your current worktree and uncommitted files untouched.');
      expect(document.body.textContent).not.toContain('Delete base main');
      expect(document.body.textContent).not.toContain('Files discarded');
      expect(document.body.textContent).not.toContain('Safe delete ready');
      expect(document.body.textContent).not.toContain('Delete Confirmation');
      const footer = Array.from(document.body.querySelectorAll('div')).find((node) => node.className.includes('border-t') && node.className.includes('redeven-surface-inset') && node.className.includes('px-4') && node.className.includes('pt-3') && node.className.includes('pb-4')) as HTMLDivElement | undefined;
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

  it('shows a tooltip on the plain delete confirm button when safe delete is blocked', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const branch = {
      name: 'feature/unmerged',
      fullName: 'refs/heads/feature/unmerged',
      kind: 'local' as const,
    };
    const blockedReason = 'Branch is not fully merged into HEAD.';
    const preview = {
      repoRootPath: '/workspace/repo',
      name: 'feature/unmerged',
      fullName: 'refs/heads/feature/unmerged',
      kind: 'local' as const,
      requiresWorktreeRemoval: false,
      requiresDiscardConfirmation: false,
      safeDeleteAllowed: false,
      safeDeleteReason: blockedReason,
      safeDeleteBaseRef: 'HEAD',
      forceDeleteAllowed: true,
      forceDeleteRequiresConfirm: true,
      planFingerprint: 'plan-blocked-plain',
    };

    const dispose = render(() => (
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
                deleteReviewOpen
                deleteReviewBranch={branch}
                deletePreview={preview}
                onCloseDeleteReview={() => {}}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(document.body.textContent).toContain('Force delete consequences');
      const confirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Force Delete Branch') as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.disabled).toBe(true);
      const confirmationInput = document.body.querySelector('input[type="text"]') as HTMLInputElement | null;
      expect(confirmationInput?.placeholder).toBe('feature/unmerged');
      const tooltip = await revealTooltipForButton(confirmButton);
      expect(tooltip?.textContent).toContain('Type feature/unmerged to enable force delete.');
      confirmationInput!.value = 'feature/unmerged';
      confirmationInput!.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
      const enabledConfirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Force Delete Branch') as HTMLButtonElement | undefined;
      expect(enabledConfirmButton?.disabled).toBe(false);
    } finally {
      dispose();
    }
  });

  it('opens merge review dialog and confirms with the preview fingerprint', async () => {
    let requestedBranch: string | undefined;
    let confirmedFingerprint: string | undefined;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const branch = {
      name: 'feature/demo',
      fullName: 'refs/heads/feature/demo',
      kind: 'local' as const,
    };
    const preview = {
      repoRootPath: '/workspace/repo',
      currentRef: 'main',
      currentCommit: 'abc1234',
      sourceName: 'feature/demo',
      sourceFullName: 'refs/heads/feature/demo',
      sourceKind: 'local' as const,
      sourceCommit: 'fedcba9',
      mergeBase: 'abc1234',
      sourceAheadCount: 1,
      sourceBehindCount: 0,
      outcome: 'fast_forward' as const,
      planFingerprint: 'merge-plan-1',
      files: [
        {
          changeType: 'modified',
          path: 'src/merge.ts',
          displayPath: 'src/merge.ts',
          additions: 5,
          deletions: 2,
          patchText: '@@ -1 +1 @@\n-before\n+after',
        },
      ],
    };

    const dispose = render(() => {
      const [mergeReviewOpen, setMergeReviewOpen] = createSignal(false);
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  repoSummary={{
                    repoRootPath: '/workspace/repo',
                    headRef: 'main',
                    headCommit: 'abc1234',
                    workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                  }}
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
                  mergeReviewOpen={mergeReviewOpen()}
                  mergeReviewBranch={branch}
                  mergePreview={mergeReviewOpen() ? preview : null}
                  onMergeBranch={(selected) => {
                    requestedBranch = selected.name;
                    setMergeReviewOpen(true);
                  }}
                  onCloseMergeReview={() => setMergeReviewOpen(false)}
                  onConfirmMergeBranch={(_selected, options) => {
                    confirmedFingerprint = options.planFingerprint;
                    setMergeReviewOpen(false);
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      const mergeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Merge') as HTMLButtonElement | undefined;
      expect(mergeButton).toBeTruthy();
      expect(mergeButton?.disabled).toBe(false);
      mergeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();

      expect(requestedBranch).toBe('feature/demo');
      expect(document.body.textContent).toContain('Merge Branch');
      expect(document.body.textContent).toContain('Fast-forward');
      expect(document.body.textContent).toContain('feature/demo');
      expect(document.body.textContent).toContain('Changed Files');
      expect(document.body.textContent).toContain('src/merge.ts');
      expect(document.body.textContent).toContain('Fast-Forward main');

      const confirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Fast-Forward main') as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(confirmedFingerprint).toBe('merge-plan-1');
    } finally {
      dispose();
    }
  });

  it('keeps merge clickable for a dirty workspace and shows the blocked preview reason in the dialog', async () => {
    let requestedBranch: string | undefined;
    const onOpenStash = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    const branch = {
      name: 'feature/blocked',
      fullName: 'refs/heads/feature/blocked',
      kind: 'local' as const,
      worktreePath: '/workspace/repo-blocked',
    };
    const preview = {
      repoRootPath: '/workspace/repo',
      currentRef: 'main',
      currentCommit: 'abc1234',
      sourceName: 'feature/blocked',
      sourceFullName: 'refs/heads/feature/blocked',
      sourceKind: 'local' as const,
      sourceCommit: 'fedcba9',
      mergeBase: 'abc1234',
      sourceAheadCount: 1,
      sourceBehindCount: 0,
      outcome: 'blocked' as const,
      blocking: {
        kind: 'workspace_dirty',
        reason: 'Current workspace must be clean before merging (1 unstaged).',
        workspacePath: '/workspace/repo-blocked',
        workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
        canStashWorkspace: true,
      },
      planFingerprint: 'merge-plan-blocked',
      files: [],
    };

    const dispose = render(() => {
      const [mergeReviewOpen, setMergeReviewOpen] = createSignal(false);
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  repoSummary={{
                    repoRootPath: '/workspace/repo',
                    headRef: 'main',
                    headCommit: 'abc1234',
                    workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
                  }}
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
                  mergeReviewOpen={mergeReviewOpen()}
                  mergeReviewBranch={branch}
                  mergePreview={mergeReviewOpen() ? preview : null}
                  onMergeBranch={(selected) => {
                    requestedBranch = selected.name;
                    setMergeReviewOpen(true);
                  }}
                  onOpenStash={onOpenStash}
                  onCloseMergeReview={() => setMergeReviewOpen(false)}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      expect(host.textContent).not.toContain('Current workspace must be clean before merging.');
      expect(host.textContent).not.toContain('This branch is checked out in a linked worktree: /workspace/repo-blocked');

      const mergeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Merge') as HTMLButtonElement | undefined;
      expect(mergeButton).toBeTruthy();
      expect(mergeButton?.disabled).toBe(false);

      mergeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();

      expect(requestedBranch).toBe('feature/blocked');
      expect(document.body.textContent).toContain('Merge Branch');
      expect(document.body.textContent).toContain('Blocked');
      expect(document.body.textContent).toContain('Current workspace must be clean before merging (1 unstaged).');
      const stashShortcut = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Stash current changes') as HTMLButtonElement | undefined;
      expect(stashShortcut).toBeTruthy();
      stashShortcut!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onOpenStash).toHaveBeenCalledWith({
        tab: 'save',
        repoRootPath: '/workspace/repo-blocked',
        source: 'merge_blocker',
      });

      const confirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Merge Into main') as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.disabled).toBe(true);
    } finally {
      dispose();
    }
  });

  it('reloads linked worktree status when the refresh token changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValue({
      repoRootPath: '/workspace/repo-linked',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [{ section: 'unstaged', changeType: 'modified', path: 'src/linked.ts', displayPath: 'src/linked.ts' }],
    });

    let setRefreshToken!: (value: number) => number;
    const branch = {
      name: 'feature/linked',
      fullName: 'refs/heads/feature/linked',
      kind: 'local' as const,
      worktreePath: '/workspace/repo-linked',
    };

    const dispose = render(() => {
      const [refreshToken, updateRefreshToken] = createSignal(0);
      setRefreshToken = updateRefreshToken;
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  statusRefreshToken={refreshToken()}
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
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();
      expect(mockListWorkspacePage).toHaveBeenCalledTimes(1);

      setRefreshToken(1);
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledTimes(2);
      expect(mockListWorkspacePage).toHaveBeenLastCalledWith({
        repoRootPath: '/workspace/repo-linked',
        section: 'changes',
        offset: 0,
        limit: 200,
      });
    } finally {
      dispose();
    }
  });

  it('shows a tooltip on the linked-worktree delete confirm button when safe delete is blocked', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const branch = {
      name: 'feature/linked-blocked',
      fullName: 'refs/heads/feature/linked-blocked',
      kind: 'local' as const,
      worktreePath: '/workspace/repo-linked-blocked',
    };
    const blockedReason = 'Branch is not fully merged into HEAD.';
    const preview = {
      repoRootPath: '/workspace/repo',
      name: 'feature/linked-blocked',
      fullName: 'refs/heads/feature/linked-blocked',
      kind: 'local' as const,
      requiresWorktreeRemoval: true,
      requiresDiscardConfirmation: false,
      safeDeleteAllowed: false,
      safeDeleteReason: blockedReason,
      safeDeleteBaseRef: 'HEAD',
      forceDeleteAllowed: true,
      forceDeleteRequiresConfirm: true,
      planFingerprint: 'plan-blocked-linked',
      linkedWorktree: {
        worktreePath: '/workspace/repo-linked-blocked',
        accessible: true,
        summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
        staged: [],
        unstaged: [],
        untracked: [],
        conflicted: [],
      },
    };

    const dispose = render(() => (
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
                deleteReviewOpen
                deleteReviewBranch={branch}
                deletePreview={preview}
                onCloseDeleteReview={() => {}}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(document.body.textContent).toContain('Force delete consequences');
      const confirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Force Delete Branch and Worktree') as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.disabled).toBe(true);
      const confirmationInput = document.body.querySelector('input[type="text"]') as HTMLInputElement | null;
      expect(confirmationInput?.placeholder).toBe('feature/linked-blocked');
      const tooltip = await revealTooltipForButton(confirmButton);
      expect(tooltip?.textContent).toContain('Type feature/linked-blocked to enable force delete.');
      confirmationInput!.value = 'feature/linked-blocked';
      confirmationInput!.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
      const enabledConfirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Force Delete Branch and Worktree') as HTMLButtonElement | undefined;
      expect(enabledConfirmButton?.disabled).toBe(false);
    } finally {
      dispose();
    }
  });

  it('shows expandable commit files and opens diffs from branch history', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onAskFlower = vi.fn();

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
                onAskFlower={onAskFlower}
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

      const historyPanel = host.querySelector('#git-branch-subview-panel-history:not([hidden])') as HTMLElement | null;
      expect(historyPanel).toBeTruthy();
      const askFlowerButton = historyPanel!.querySelector('button[aria-label="Ask Flower"]') as HTMLButtonElement | null;
      expect(askFlowerButton).toBeTruthy();
      expect(askFlowerButton?.textContent).toBe('');
      askFlowerButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onAskFlower).toHaveBeenCalledWith({
        kind: 'commit',
        repoRootPath: '/workspace/repo',
        location: 'branch_history',
        branchName: 'feature/demo',
        commit: { hash: '2222222222222222', shortHash: '22222222', parents: ['1111111111111111', '9999999999999999'], subject: 'Merge feature', authorName: 'Bob', authorTimeMs: 1706003600000 },
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
      expect(closeButton?.className).toContain('hover:bg-error');
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

  it('preserves loaded commit details when toggling between status and history for the same branch', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mockGetCommitDetail.mockResolvedValue({
      repoRootPath: '/workspace/repo',
      commit: {
        hash: '2222222222222222',
        shortHash: '22222222',
        parents: ['1111111111111111'],
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

    const dispose = render(() => {
      const [subview, setSubview] = createSignal<'status' | 'history'>('history');
      return (
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
                  }}
                  selectedBranchSubview={subview()}
                  onSelectBranchSubview={setSubview}
                  commits={[
                    { hash: '2222222222222222', shortHash: '22222222', parents: ['1111111111111111'], subject: 'Merge feature', authorName: 'Bob', authorTimeMs: 1706003600000 },
                  ]}
                  selectedCommitHash="2222222222222222"
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();
      expect(mockGetCommitDetail).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain('src/history.ts');

      const statusTab = host.querySelector('#git-branch-subview-tab-status') as HTMLButtonElement | null;
      const historyTab = host.querySelector('#git-branch-subview-tab-history') as HTMLButtonElement | null;
      expect(statusTab).toBeTruthy();
      expect(historyTab).toBeTruthy();

      statusTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      historyTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockGetCommitDetail).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain('src/history.ts');
    } finally {
      dispose();
    }
  });

  it('offers a branch-history action to detach HEAD at the expanded commit', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onSwitchDetached = vi.fn();
    mockGetCommitDetail.mockResolvedValue({
      repoRootPath: '/workspace/repo',
      commit: {
        hash: '2222222222222222',
        shortHash: '22222222',
        parents: ['1111111111111111'],
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
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  headCommit: '1111111111111111',
                  workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                }}
                selectedBranch={{
                  name: 'feature/demo',
                  fullName: 'refs/heads/feature/demo',
                  kind: 'local',
                }}
                selectedBranchSubview="history"
                commits={[
                  { hash: '2222222222222222', shortHash: '22222222', parents: ['1111111111111111'], subject: 'Merge feature', authorName: 'Bob', authorTimeMs: 1706003600000 },
                ]}
                selectedCommitHash="2222222222222222"
                onSwitchDetached={onSwitchDetached}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const detachButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Switch --detach')) as HTMLButtonElement | undefined;
      expect(detachButton).toBeTruthy();

      detachButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onSwitchDetached).toHaveBeenCalledWith({
        commitHash: '2222222222222222',
        shortHash: '22222222',
        source: 'branch_history',
        branchName: 'feature/demo',
      });
    } finally {
      dispose();
    }
  });

  it('offers a one-click return to the suggested reattach branch in detached branch view', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onCheckoutBranch = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'HEAD',
                  headCommit: '1111111111111111',
                  detached: true,
                  reattachBranch: { name: 'main', fullName: 'refs/heads/main', kind: 'local', headCommit: 'aaaaaaaa' },
                  workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                }}
                selectedBranch={{
                  name: 'feature/demo',
                  fullName: 'refs/heads/feature/demo',
                  kind: 'local',
                }}
                onCheckoutBranch={onCheckoutBranch}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      expect(host.textContent).toContain('Detached HEAD');
      expect(host.textContent).toContain('Viewing 11111111 without a branch.');
      expect(host.textContent).toContain('Checkout a local branch to reattach HEAD before pull, push, or merge.');
      expect(host.textContent).toContain('Last attached branch: main.');
      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Checkout main')) as HTMLButtonElement | undefined;
      expect(checkoutButton).toBeTruthy();

      checkoutButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onCheckoutBranch).toHaveBeenCalledWith({
        name: 'main',
        fullName: 'refs/heads/main',
        kind: 'local',
        headCommit: 'aaaaaaaa',
      });
    } finally {
      dispose();
    }
  });
});
