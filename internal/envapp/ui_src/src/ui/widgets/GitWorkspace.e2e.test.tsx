// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitWorkspace } from './GitWorkspace';

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
            subview="overview"
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
      const historyButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim().startsWith('History'));
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
});
