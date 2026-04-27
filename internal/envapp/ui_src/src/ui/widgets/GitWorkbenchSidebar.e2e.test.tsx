// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitWorkbenchSidebar, resolveGitSidebarAnchorScrollTop, resolveGitSidebarRevealScrollTop } from './GitWorkbenchSidebar';

beforeEach(() => {
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

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

function mockElementRect(element: Element, rect: { top: number; bottom: number }) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: rect.top,
      width: 240,
      height: rect.bottom - rect.top,
      top: rect.top,
      right: 240,
      bottom: rect.bottom,
      left: 0,
      toJSON: () => ({}),
    }),
  });
}

function findBranchButton(host: HTMLElement, key: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-git-sidebar-branch-key]'))
    .find((node) => node.dataset.gitSidebarBranchKey === key);
  expect(button).toBeTruthy();
  return button!;
}

function installAnimationFrameMock() {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const scheduledFrames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      scheduledFrames.set(id, callback);
      return id;
    }),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn((id: number) => {
      scheduledFrames.delete(id);
    }),
  });
  return {
    clearScheduledFrames: () => scheduledFrames.clear(),
    runScheduledFrames: () => {
      const callbacks = Array.from(scheduledFrames.values());
      scheduledFrames.clear();
      callbacks.forEach((callback) => callback(0));
    },
    restore: () => {
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        value: originalRequestAnimationFrame,
      });
      Object.defineProperty(window, 'cancelAnimationFrame', {
        configurable: true,
        value: originalCancelAnimationFrame,
      });
    },
  };
}

describe('GitWorkbenchSidebar interactions', () => {
  it('calculates the nearest selected-branch reveal offset', () => {
    expect(resolveGitSidebarRevealScrollTop({
      scrollTop: 320,
      viewportTop: 0,
      viewportBottom: 100,
      itemTop: 140,
      itemBottom: 170,
    })).toBe(398);

    expect(resolveGitSidebarRevealScrollTop({
      scrollTop: 398,
      viewportTop: 0,
      viewportBottom: 100,
      itemTop: 24,
      itemBottom: 56,
    })).toBe(398);

    expect(resolveGitSidebarAnchorScrollTop({
      scrollTop: 0,
      viewportTop: 0,
      itemTop: 100,
      anchorItemTopOffset: 60,
    })).toBe(40);
  });

  it('uses section cards instead of file rows in changes mode', () => {
    let selectedSection = '';
    let closeCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="relative h-[520px]">
          <GitWorkbenchSidebar
            subview="changes"
            repoAvailable
            repoSummary={{
              repoRootPath: '/workspace/repo',
              headRef: 'main',
              headCommit: 'abc1234',
              aheadCount: 1,
              behindCount: 0,
              workspaceSummary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 1, conflictedCount: 0 },
            }}
            workspace={{
              repoRootPath: '/workspace/repo',
              summary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 1, conflictedCount: 0 },
              staged: [{ section: 'staged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts', additions: 3, deletions: 1 }],
              unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/next.ts', displayPath: 'src/next.ts', additions: 4, deletions: 2 }],
              untracked: [{ section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt', additions: 10, deletions: 0 }],
              conflicted: [],
            }}
            selectedWorkspaceSection="changes"
            onSelectWorkspaceSection={(section) => {
              selectedSection = section;
            }}
            onClose={() => {
              closeCount += 1;
            }}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const activeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Changes')) as HTMLButtonElement | undefined;
      const sectionButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Staged'));
      expect(activeButton?.className).toContain('git-browser-selection-surface');
      expect(sectionButton).toBeTruthy();
      sectionButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(host.textContent).toContain('Changes');
      expect(host.textContent).toContain('main');
      expect(host.textContent).toContain('Conflicted');
      expect(host.textContent).toContain('Staged');
      expect(host.textContent).not.toContain('Untracked');
      expect(host.textContent).not.toContain('Unstaged');
      expect(host.textContent).not.toContain('src/app.ts');
      expect(selectedSection).toBe('staged');
      expect(closeCount).toBe(1);
    } finally {
      dispose();
    }
  });

  it('renders the commit graph rail inside the history sidebar', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="relative h-[520px]">
          <GitWorkbenchSidebar
            subview="history"
            repoAvailable
            commits={[
              { hash: '1111111111111111', shortHash: '11111111', parents: ['0000000000000000'], subject: 'First commit', authorName: 'Alice', authorEmail: 'alice@example.com', authorTimeMs: Date.now() - 120000 },
              { hash: '2222222222222222', shortHash: '22222222', parents: ['1111111111111111', '9999999999999999'], subject: 'Merge feature', authorName: 'Bob', authorEmail: 'bob@example.com', authorTimeMs: Date.now() - 240000 },
            ]}
            selectedCommitHash="2222222222222222"
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Commit Graph');
      expect(host.textContent).toContain('Merge x2');
      const scrollRegion = host.querySelector('[data-testid="git-sidebar-scroll-region"]');
      expect(scrollRegion).toBeTruthy();
      expect(scrollRegion?.querySelector('[data-commit-graph-rails]')).toBeTruthy();
      expect(host.querySelectorAll('svg')).not.toHaveLength(0);
      expect(host.textContent).not.toContain('Recent history with merge structure.');
    } finally {
      dispose();
    }
  });

  it('keeps branches mode focused on branch selection only', () => {
    let selectedBranch = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="relative h-[520px]">
          <GitWorkbenchSidebar
            subview="branches"
            repoAvailable
            repoSummary={{
              repoRootPath: '/workspace/repo',
              headRef: 'main',
              headCommit: 'abc1234',
              aheadCount: 1,
              behindCount: 0,
              workspaceSummary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 1, conflictedCount: 0 },
            }}
            branches={{
              repoRootPath: '/workspace/repo',
              currentRef: 'main',
              local: [
                { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
                { name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local', subject: 'Feature branch' },
              ],
              remote: [
                { name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote', subject: 'Remote main' },
              ],
            }}
            selectedBranchKey="refs/heads/feature/demo"
            onSelectBranch={(branch) => {
              selectedBranch = branch.fullName || branch.name || '';
            }}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Pick a branch to inspect its status or history in the main pane.');
      expect(host.textContent).toContain('Local');
      expect(host.textContent).toContain('Remote');
      expect(host.textContent).not.toContain('Compare');
      const mainButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('main'));
      expect(mainButton).toBeTruthy();
      mainButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(selectedBranch).toBe('refs/heads/main');
    } finally {
      dispose();
    }
  });

  it('does not move the branch list just because the selected branch key changed', async () => {
    const targetBranchKey = 'refs/heads/feature/24';
    const featureBranches = Array.from({ length: 32 }, (_, index) => {
      const name = `feature/${String(index).padStart(2, '0')}`;
      return {
        name,
        fullName: `refs/heads/${name}`,
        kind: 'local' as const,
        subject: `Feature branch ${index}`,
      };
    });
    const [selectedBranchKey, setSelectedBranchKey] = createSignal('refs/heads/main');
    const [branches] = createSignal({
      repoRootPath: '/workspace/repo',
      currentRef: 'main',
      local: [
        { name: 'main', fullName: 'refs/heads/main', kind: 'local' as const, current: true },
        ...featureBranches,
      ],
      remote: [],
    });

    const animationFrame = installAnimationFrameMock();

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="relative h-[180px]">
          <GitWorkbenchSidebar
            subview="branches"
            repoAvailable
            branches={branches()}
            selectedBranchKey={selectedBranchKey()}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flushMicrotasks();
      animationFrame.clearScheduledFrames();

      const scrollRegion = host.querySelector('[data-testid="git-sidebar-scroll-region"]') as HTMLDivElement | null;
      expect(scrollRegion).toBeTruthy();
      mockElementRect(scrollRegion!, { top: 0, bottom: 100 });
      scrollRegion!.scrollTop = 320;

      setSelectedBranchKey(targetBranchKey);
      await flushMicrotasks();
      mockElementRect(findBranchButton(host, targetBranchKey), { top: 140, bottom: 170 });
      animationFrame.runScheduledFrames();
      expect(scrollRegion!.scrollTop).toBe(320);
    } finally {
      dispose();
      animationFrame.restore();
    }
  });

  it('restores the exact branch list offset after a selection refresh with unchanged identities', async () => {
    const targetBranchKey = 'refs/heads/feature/24';
    const featureBranches = Array.from({ length: 32 }, (_, index) => {
      const name = `feature/${String(index).padStart(2, '0')}`;
      return {
        name,
        fullName: `refs/heads/${name}`,
        kind: 'local' as const,
        subject: `Feature branch ${index}`,
      };
    });
    const [selectedBranchKey, setSelectedBranchKey] = createSignal('refs/heads/main');
    const [branches, setBranches] = createSignal({
      repoRootPath: '/workspace/repo',
      currentRef: 'main',
      local: [
        { name: 'main', fullName: 'refs/heads/main', kind: 'local' as const, current: true },
        ...featureBranches,
      ],
      remote: [],
    });
    const animationFrame = installAnimationFrameMock();

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="relative h-[180px]">
          <GitWorkbenchSidebar
            subview="branches"
            repoAvailable
            branches={branches()}
            selectedBranchKey={selectedBranchKey()}
            onSelectBranch={(branch) => setSelectedBranchKey(branch.fullName || branch.name || '')}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flushMicrotasks();
      animationFrame.clearScheduledFrames();

      const scrollRegion = host.querySelector('[data-testid="git-sidebar-scroll-region"]') as HTMLDivElement | null;
      expect(scrollRegion).toBeTruthy();
      mockElementRect(scrollRegion!, { top: 0, bottom: 100 });
      scrollRegion!.scrollTop = 320;
      mockElementRect(findBranchButton(host, targetBranchKey), { top: 40, bottom: 70 });

      findBranchButton(host, targetBranchKey).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushMicrotasks();
      animationFrame.runScheduledFrames();
      expect(scrollRegion!.scrollTop).toBe(320);

      scrollRegion!.scrollTop = 0;
      setBranches({
        ...branches(),
        local: branches().local.map((branch) => (
          branch.fullName === targetBranchKey
            ? { ...branch, subject: 'Feature branch 24 refreshed' }
            : branch
        )),
      });
      await flushMicrotasks();
      mockElementRect(findBranchButton(host, targetBranchKey), { top: 180, bottom: 210 });
      animationFrame.runScheduledFrames();
      expect(scrollRegion!.scrollTop).toBe(320);
    } finally {
      dispose();
      animationFrame.restore();
    }
  });

  it('preserves the clicked branch viewport position after a selection refresh changes identities', async () => {
    const targetBranchKey = 'refs/heads/feature/24';
    const featureBranches = Array.from({ length: 32 }, (_, index) => {
      const name = `feature/${String(index).padStart(2, '0')}`;
      return {
        name,
        fullName: `refs/heads/${name}`,
        kind: 'local' as const,
        subject: `Feature branch ${index}`,
      };
    });
    const [selectedBranchKey, setSelectedBranchKey] = createSignal('refs/heads/main');
    const [branches, setBranches] = createSignal({
      repoRootPath: '/workspace/repo',
      currentRef: 'main',
      local: [
        { name: 'main', fullName: 'refs/heads/main', kind: 'local' as const, current: true },
        ...featureBranches,
      ],
      remote: [],
    });
    const animationFrame = installAnimationFrameMock();

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="relative h-[180px]">
          <GitWorkbenchSidebar
            subview="branches"
            repoAvailable
            branches={branches()}
            selectedBranchKey={selectedBranchKey()}
            onSelectBranch={(branch) => setSelectedBranchKey(branch.fullName || branch.name || '')}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flushMicrotasks();
      animationFrame.clearScheduledFrames();

      const scrollRegion = host.querySelector('[data-testid="git-sidebar-scroll-region"]') as HTMLDivElement | null;
      expect(scrollRegion).toBeTruthy();
      mockElementRect(scrollRegion!, { top: 0, bottom: 100 });
      scrollRegion!.scrollTop = 220;
      mockElementRect(findBranchButton(host, targetBranchKey), { top: 60, bottom: 90 });

      findBranchButton(host, targetBranchKey).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushMicrotasks();
      animationFrame.runScheduledFrames();
      expect(scrollRegion!.scrollTop).toBe(220);

      scrollRegion!.scrollTop = 0;
      setBranches({
        ...branches(),
        local: [
          { name: 'feature/new', fullName: 'refs/heads/feature/new', kind: 'local' as const, subject: 'New feature branch' },
          ...branches().local.map((branch) => ({ ...branch })),
        ],
      });
      await flushMicrotasks();
      mockElementRect(findBranchButton(host, targetBranchKey), { top: 100, bottom: 130 });
      animationFrame.runScheduledFrames();
      expect(scrollRegion!.scrollTop).toBe(40);
    } finally {
      dispose();
      animationFrame.restore();
    }
  });

  it('shows detached HEAD explicitly in the changes sidebar card', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="relative h-[520px]">
          <GitWorkbenchSidebar
            subview="changes"
            repoAvailable
            repoSummary={{
              repoRootPath: '/workspace/repo',
              headRef: 'HEAD',
              headCommit: '89abcdef12345678',
              detached: true,
              workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
            }}
            workspace={{
              repoRootPath: '/workspace/repo',
              summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
              staged: [],
              unstaged: [],
              untracked: [],
              conflicted: [],
            }}
            selectedWorkspaceSection="changes"
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Detached HEAD');
      expect(host.textContent).toContain('89abcdef');
      expect(host.textContent).toContain('Detached HEAD keeps history browsing read-only for pull and push.');
    } finally {
      dispose();
    }
  });
});
