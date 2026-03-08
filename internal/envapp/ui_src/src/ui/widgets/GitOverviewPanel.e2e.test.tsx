// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitOverviewPanel } from './GitOverviewPanel';

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

describe('GitOverviewPanel interactions', () => {
  it('renders compact vertical overview sections for workspace, branch, repo signals, and compare', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[640px]">
          <GitOverviewPanel
            currentPath="/workspace/repo/src"
            repoSummary={{
              repoRootPath: '/workspace/repo',
              headRef: 'main',
              headCommit: 'abc1234',
              upstreamRef: 'origin/main',
              aheadCount: 1,
              behindCount: 0,
              stashCount: 2,
              isWorktree: false,
              workspaceSummary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
            }}
            workspace={{
              repoRootPath: '/workspace/repo',
              summary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
              staged: [],
              unstaged: [],
              untracked: [],
              conflicted: [],
            }}
            branches={{
              repoRootPath: '/workspace/repo',
              currentRef: 'main',
              local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
              remote: [{ name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote' }],
            }}
            selectedBranch={{
              name: 'feature/demo',
              fullName: 'refs/heads/feature/demo',
              kind: 'local',
              subject: 'Feature branch change',
              aheadCount: 2,
              behindCount: 0,
            }}
            compare={{
              repoRootPath: '/workspace/repo',
              baseRef: 'main',
              targetRef: 'feature/demo',
              mergeBase: 'ff00aa11223344',
              targetAheadCount: 2,
              targetBehindCount: 0,
              commits: [
                { hash: 'a1', shortHash: 'a1', parents: [] },
                { hash: 'b2', shortHash: 'b2', parents: [] },
              ],
              files: [{ path: 'src/app.ts' }],
            }}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      expect(host.querySelectorAll('section')).toHaveLength(4);
      expect(host.textContent).toContain('Workspace Summary');
      expect(host.textContent).toContain('Selected Branch');
      expect(host.textContent).toContain('Repository Signals');
      expect(host.textContent).toContain('Compare Snapshot');
      expect(host.textContent).toContain('Local branches');
      expect(host.textContent).toContain('Remote branches');
    } finally {
      dispose();
    }
  });
});
