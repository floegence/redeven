// @vitest-environment jsdom

import { untrack } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutProvider, useLayout } from '@floegence/floe-webapp-core';

import { GitHistoryPageSidebar } from './GitHistoryPageSidebar';

function ForceMobile(props: { mobile: boolean; children: unknown }) {
  const layout = useLayout();
  const mobile = untrack(() => props.mobile);
  layout.setIsMobile(mobile);
  return <>{props.children}</>;
}


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

describe('GitHistoryPageSidebar mobile drawer', () => {
  it('selects a commit and requests drawer close from the native mobile sidebar', () => {
    let selectedCommit = '';
    let closeCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <ForceMobile mobile>
          <div class="relative h-[520px]">
            <GitHistoryPageSidebar
              mode="git_history"
              onModeChange={() => {}}
              currentPath="/workspace/repo"
              width={240}
              open
              repoInfo={{
                available: true,
                repoRootPath: '/workspace/repo',
                headRef: 'main',
                headCommit: 'abc1234',
                dirty: false,
              }}
              commits={[
                {
                  hash: 'abc1234567',
                  shortHash: 'abc1234',
                  parents: [],
                  authorName: 'Alice',
                  authorTimeMs: Date.now(),
                  subject: 'Add sidebar pane shell',
                },
              ]}
              onSelectCommit={(hash) => {
                selectedCommit = hash;
              }}
              onClose={() => {
                closeCount += 1;
              }}
            />
          </div>
        </ForceMobile>
      </LayoutProvider>
    ), host);

    try {
      const closeButton = host.querySelector('button[aria-label="Close sidebar"]');
      expect(closeButton).toBeTruthy();

      const commitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Add sidebar pane shell'));
      expect(commitButton).toBeTruthy();

      commitButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(selectedCommit).toBe('abc1234567');
      expect(closeCount).toBe(1);
    } finally {
      dispose();
    }
  });
});
