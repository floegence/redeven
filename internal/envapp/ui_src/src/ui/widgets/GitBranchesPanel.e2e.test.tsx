// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitBranchesPanel } from './GitBranchesPanel';

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

describe('GitBranchesPanel interactions', () => {
  it('renders compare patches inline from the embedded payload', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[640px]">
            <GitBranchesPanel
              repoRootPath="/workspace/repo"
              selectedBranch={{
                name: 'feature/demo',
                fullName: 'refs/heads/feature/demo',
                kind: 'local',
                headCommit: 'abc1234',
                subject: 'Feature branch change',
                authorTimeMs: 1706000000000,
              }}
              compare={{
                repoRootPath: '/workspace/repo',
                baseRef: 'main',
                targetRef: 'feature/demo',
                targetAheadCount: 1,
                targetBehindCount: 0,
                commits: [],
                files: [
                  {
                    changeType: 'added',
                    path: 'feature/branch-only.txt',
                    displayPath: 'feature/branch-only.txt',
                    additions: 1,
                    deletions: 0,
                    patchText: [
                      'diff --git a/feature/branch-only.txt b/feature/branch-only.txt',
                      'new file mode 100644',
                      '--- /dev/null',
                      '+++ b/feature/branch-only.txt',
                      '@@ -0,0 +1 @@',
                      '+feature branch',
                    ].join('\n'),
                  },
                ],
              }}
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const fileButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('feature/branch-only.txt'));
      expect(fileButton).toBeTruthy();
      fileButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.body.textContent).toContain('Changed Files');
      expect(document.body.textContent).toContain('Copy Patch');
      expect(document.body.textContent).toContain('+feature branch');
      expect(document.body.textContent).not.toContain('No inline diff lines available');
    } finally {
      dispose();
    }
  });

  it('stacks branch, compare, commit range, and changed files vertically', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[640px]">
            <GitBranchesPanel
              repoRootPath="/workspace/repo"
              selectedBranch={{
                name: 'feature/demo',
                fullName: 'refs/heads/feature/demo',
                kind: 'local',
                current: true,
                upstreamRef: 'origin/feature/demo',
                headCommit: 'abc1234def5678',
                subject: 'Feature branch change',
                authorTimeMs: 1706000000000,
                aheadCount: 1,
                behindCount: 0,
              }}
              compare={{
                repoRootPath: '/workspace/repo',
                baseRef: 'main',
                targetRef: 'feature/demo',
                targetAheadCount: 1,
                targetBehindCount: 0,
                mergeBase: 'ff00aa11223344',
                commits: [{ hash: 'abc1234def5678', shortHash: 'abc1234', parents: ['base123'], subject: 'Feature branch change', authorName: 'Alice', authorTimeMs: 1706000000000 }],
                files: [],
              }}
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.querySelectorAll('section')).toHaveLength(5);
      expect(host.textContent).toContain('Branch Snapshot');
      expect(host.textContent).toContain('Compare Summary');
      expect(host.textContent).toContain('Commit Range');
      expect(host.textContent).toContain('Changed Files');
      expect(host.textContent).toContain('Diff Inspector');
    } finally {
      dispose();
    }
  });

  it('uses the left-rail empty-state copy before a branch is selected', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[640px]">
            <GitBranchesPanel repoRootPath="/workspace/repo" />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Choose a branch from the left rail to inspect compare details.');
      expect(host.textContent).not.toContain('Select a branch from the sidebar to inspect compare details.');
    } finally {
      dispose();
    }
  });
});
