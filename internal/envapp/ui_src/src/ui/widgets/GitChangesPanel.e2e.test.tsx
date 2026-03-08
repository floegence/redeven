// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitChangesPanel } from './GitChangesPanel';

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

describe('GitChangesPanel interactions', () => {
  it('opens a floating diff dialog and renders the embedded patch', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[620px]">
            <GitChangesPanel
              repoRootPath="/workspace/repo"
              workspace={{
                repoRootPath: '/workspace/repo',
                summary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
                staged: [],
                unstaged: [],
                untracked: [],
                conflicted: [],
              }}
              selectedItem={{
                section: 'staged',
                changeType: 'modified',
                path: 'src/app.ts',
                displayPath: 'src/app.ts',
                additions: 3,
                deletions: 1,
                patchText: [
                  'diff --git a/src/app.ts b/src/app.ts',
                  '--- a/src/app.ts',
                  '+++ b/src/app.ts',
                  '@@ -1 +1 @@',
                  '-before',
                  '+after',
                ].join('\n'),
              }}
              inspectNonce={1}
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
      expect(document.body.textContent).toContain('Workspace Diff');
      expect(document.body.textContent).toContain('src/app.ts');
      expect(document.body.textContent).toContain('+after');
    } finally {
      dispose();
    }
  });


  it('keeps workspace summary and focused file in compact stacked sections', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[620px]">
            <GitChangesPanel
              repoRootPath="/workspace/repo"
              workspace={{
                repoRootPath: '/workspace/repo',
                summary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
                staged: [],
                unstaged: [],
                untracked: [],
                conflicted: [],
              }}
              selectedItem={{
                section: 'staged',
                changeType: 'modified',
                path: 'src/app.ts',
                displayPath: 'src/app.ts',
                additions: 3,
                deletions: 1,
                patchText: 'diff --git a/src/app.ts b/src/app.ts',
              }}
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.querySelectorAll('section')).toHaveLength(2);
      expect(host.textContent).toContain('Workspace Summary');
      expect(host.textContent).toContain('Focused File');
      expect(host.textContent).not.toContain('Focus stays here while diffs open in a separate floating surface.');
    } finally {
      dispose();
    }
  });
});
