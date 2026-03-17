// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitWorkspace } from './GitWorkspace';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });
}

beforeEach(() => {
  mockMatchMedia(false);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GitWorkspace interactions', () => {
  it('keeps mode switching and git view switching pinned inside the shared sidebar shell', () => {
    let nextMode = '';
    let nextSubview = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[620px]">
          <GitWorkspace
            mode="git"
            onModeChange={(mode) => {
              nextMode = mode;
            }}
            subview="changes"
            onSubviewChange={(view) => {
              nextSubview = view;
            }}
            width={280}
            open
            currentPath="/workspace/repo/src"
            repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
            repoSummary={{
              repoRootPath: '/workspace/repo',
              headRef: 'main',
              headCommit: 'abc1234',
              aheadCount: 1,
              behindCount: 0,
              workspaceSummary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
            }}
            workspace={{
              repoRootPath: '/workspace/repo',
              summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
              staged: [],
              unstaged: [],
              untracked: [],
              conflicted: [],
            }}
            branches={{
              repoRootPath: '/workspace/repo',
              currentRef: 'main',
              local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
              remote: [],
            }}
            commits={[]}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Mode');
      expect(host.textContent).toContain('View');
      expect(host.querySelectorAll('[role="radiogroup"][aria-label="Browser mode"]').length).toBe(1);
      expect(host.querySelectorAll('[role="tablist"][aria-label="Git views"]').length).toBe(1);
      const scrollRegion = host.querySelector('[data-testid="git-sidebar-scroll-region"]');
      expect(scrollRegion).toBeTruthy();
      expect(scrollRegion?.querySelector('[role="tablist"][aria-label="Git views"]')).toBeNull();

      const historyButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim().startsWith('Graph'));
      expect(historyButton).toBeTruthy();
      historyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const filesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Files'));
      expect(filesButton).toBeTruthy();
      filesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(nextSubview).toBe('history');
      expect(nextMode).toBe('files');
    } finally {
      dispose();
    }
  });

  it('does not render a mobile sidebar button unless requested explicitly', () => {
    mockMatchMedia(true);
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[620px]">
          <GitWorkspace
            mode="git"
            onModeChange={() => {}}
            subview="changes"
            onSubviewChange={() => {}}
            width={280}
            open={false}
            currentPath="/workspace/repo/src"
            repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
            repoSummary={{
              repoRootPath: '/workspace/repo',
              headRef: 'main',
              headCommit: 'abc1234',
              aheadCount: 1,
              behindCount: 0,
              workspaceSummary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
            }}
            workspace={{
              repoRootPath: '/workspace/repo',
              summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
              staged: [],
              unstaged: [],
              untracked: [],
              conflicted: [],
            }}
            branches={{
              repoRootPath: '/workspace/repo',
              currentRef: 'main',
              local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
              remote: [],
            }}
            commits={[]}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      expect(host.querySelector('button[aria-label="Toggle browser sidebar"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('uses the content header button to reopen the git sidebar on mobile widgets', () => {
    mockMatchMedia(true);
    let toggleSidebarCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[620px]">
          <GitWorkspace
            mode="git"
            onModeChange={() => {}}
            subview="changes"
            onSubviewChange={() => {}}
            width={280}
            open={false}
            showMobileSidebarButton
            onToggleSidebar={() => {
              toggleSidebarCount += 1;
            }}
            currentPath="/workspace/repo/src"
            repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
            repoSummary={{
              repoRootPath: '/workspace/repo',
              headRef: 'main',
              headCommit: 'abc1234',
              aheadCount: 1,
              behindCount: 0,
              workspaceSummary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
            }}
            workspace={{
              repoRootPath: '/workspace/repo',
              summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
              staged: [],
              unstaged: [],
              untracked: [],
              conflicted: [],
            }}
            branches={{
              repoRootPath: '/workspace/repo',
              currentRef: 'main',
              local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
              remote: [],
            }}
            commits={[]}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const sidebarButton = host.querySelector('button[aria-label="Toggle browser sidebar"]');
      expect(sidebarButton).toBeTruthy();
      expect(sidebarButton?.textContent).toContain('Sidebar');
      sidebarButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(toggleSidebarCount).toBe(1);
    } finally {
      dispose();
    }
  });

  it('routes initial git bootstrap through one shell-owned loading pane', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[620px]">
          <GitWorkspace
            mode="git"
            onModeChange={() => {}}
            subview="branches"
            onSubviewChange={() => {}}
            width={280}
            open
            currentPath="/workspace/repo/src"
            repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
            shellLoadingMessage="Loading branches..."
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Preparing the active Git view...');
      expect(host.textContent).toContain('Loading branches...');
      expect(host.querySelector('[data-testid="git-sidebar-scroll-region"]')).toBeNull();
      expect(host.textContent).not.toContain('Current path is not inside a Git repository.');
    } finally {
      dispose();
    }
  });
});
