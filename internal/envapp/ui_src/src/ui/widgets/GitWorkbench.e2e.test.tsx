// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitWorkbench } from './GitWorkbench';

describe('GitWorkbench interactions', () => {
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

  it('keeps refresh and subview controls interactive while rendering overview state', () => {
    let refreshCount = 0;
    let openSidebarCount = 0;
    let nextSubview = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <div class="h-[640px]">
        <GitWorkbench
          currentPath="/workspace/repo"
          subview="overview"
          onSubviewChange={(value) => {
            nextSubview = value;
          }}
          repoSummary={{
            repoRootPath: '/workspace/repo',
            headRef: 'main',
            headCommit: 'abc1234',
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
            local: [
              { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
              { name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local' },
            ],
            remote: [],
          }}
          compare={{
            repoRootPath: '/workspace/repo',
            baseRef: 'main',
            targetRef: 'feature/demo',
            targetAheadCount: 1,
            targetBehindCount: 0,
            commits: [],
            files: [],
          }}
          commits={[]}
          showSidebarToggle
          onOpenSidebar={() => {
            openSidebarCount += 1;
          }}
          onRefresh={() => {
            refreshCount += 1;
          }}
        />
      </div>
    ), host);

    try {
      const refreshButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Refresh'));
      expect(refreshButton).toBeTruthy();
      refreshButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const subviewButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Branches (2)'));
      expect(subviewButton).toBeTruthy();
      subviewButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const openSidebarButton = host.querySelector('button[aria-label="Open Git sidebar"]');
      expect(openSidebarButton).toBeTruthy();
      openSidebarButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(refreshCount).toBe(1);
      expect(nextSubview).toBe('branches');
      expect(openSidebarCount).toBe(1);
    } finally {
      dispose();
    }
  });
});
