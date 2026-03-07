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
  it('keeps mode and view switching in the sidebar while using the list as the primary selector', () => {
    let selectedPath = '';
    let closeCount = 0;
    let nextMode = '';
    let nextSubview = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="relative h-[520px]">
          <GitWorkbenchSidebar
            mode="git"
            onModeChange={(mode) => {
              nextMode = mode;
            }}
            subview="changes"
            onSubviewChange={(view) => {
              nextSubview = view;
            }}
            repoAvailable
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
              staged: [
                { section: 'staged', changeType: 'modified', path: 'src/app.ts', patchPath: 'src/app.ts', additions: 3, deletions: 1 },
              ],
              unstaged: [],
              untracked: [],
              conflicted: [],
            }}
            branches={{
              repoRootPath: '/workspace/repo',
              currentRef: 'main',
              local: [
                { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
              ],
              remote: [],
            }}
            selectedWorkspaceKey="staged:src/app.ts"
            onSelectWorkspaceItem={(item) => {
              selectedPath = String(item.path || '');
            }}
            onClose={() => {
              closeCount += 1;
            }}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const filesModeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Files');
      expect(filesModeButton).toBeTruthy();
      filesModeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const historyButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('History'));
      expect(historyButton).toBeTruthy();
      historyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const itemButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('src/app.ts'));
      expect(itemButton).toBeTruthy();
      itemButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(nextMode).toBe('files');
      expect(nextSubview).toBe('history');
      expect(selectedPath).toBe('src/app.ts');
      expect(closeCount).toBe(1);
    } finally {
      dispose();
    }
  });
});
