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
  it('uses the sidebar as the primary selector for workspace files', () => {
    let selectedPath = '';
    let closeCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="relative h-[520px]">
          <GitWorkbenchSidebar
          subview="changes"
          repoAvailable
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
      const itemButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('src/app.ts'));
      expect(itemButton).toBeTruthy();
      itemButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(selectedPath).toBe('src/app.ts');
      expect(closeCount).toBe(1);
    } finally {
      dispose();
    }
  });
});
