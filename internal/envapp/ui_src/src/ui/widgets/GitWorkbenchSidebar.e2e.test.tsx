// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitWorkbenchSidebar } from './GitWorkbenchSidebar';

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

describe('GitWorkbenchSidebar interactions', () => {
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
});
