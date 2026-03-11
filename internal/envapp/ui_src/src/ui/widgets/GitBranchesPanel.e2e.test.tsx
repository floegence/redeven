// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCommitDetail = vi.fn();
const mockGetBranchCompare = vi.fn();

vi.mock('../protocol/redeven_v1', async () => {
  const actual = await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1');
  return {
    ...actual,
    useRedevenRpc: () => ({
      git: {
        getCommitDetail: mockGetCommitDetail,
        getBranchCompare: mockGetBranchCompare,
        listWorkspaceChanges: vi.fn(),
      },
    }),
  };
});

import { redevenV1Contract } from '../protocol/redeven_v1';
import { GitBranchesPanel } from './GitBranchesPanel';

beforeEach(() => {
  mockGetCommitDetail.mockReset();
  mockGetBranchCompare.mockReset();
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
      expect(host.textContent).toContain('src/linked.ts');
      expect(host.textContent).toContain('Staged');
      expect(host.textContent).toContain('View Diff');
      expect(host.textContent).not.toContain('pending review');
      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Checkout')) as HTMLButtonElement | undefined;
      expect(checkoutButton).toBeTruthy();
      expect(checkoutButton?.disabled).toBe(true);
      expect(checkoutCount).toBe(0);
    } finally {
      dispose();
    }
  });

  it('enables checkout for a non-current remote branch', () => {
    let checkoutBranch: string | undefined;
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
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Checkout')) as HTMLButtonElement | undefined;
      expect(checkoutButton).toBeTruthy();
      expect(checkoutButton?.disabled).toBe(false);
      checkoutButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(checkoutBranch).toBe('origin/feature/demo');
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
