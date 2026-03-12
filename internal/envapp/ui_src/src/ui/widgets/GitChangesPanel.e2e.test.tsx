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
  it('renders only the selected section as a compact file table', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[620px]">
            <GitChangesPanel
              repoSummary={{
                repoRootPath: '/workspace/repo',
                headRef: 'main',
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
              selectedSection="unstaged"
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Unstaged');
      expect(host.textContent).toContain('Path');
      expect(host.textContent).toContain('Status');
      expect(host.textContent).toContain('src/next.ts');
      expect(host.textContent).toContain('+ Stage');
      expect(host.textContent).not.toContain('Patch');
      expect(host.textContent).not.toContain('Ready to Commit');
    } finally {
      dispose();
    }
  });

  it('opens the commit dialog and lists staged files there', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[620px]">
            <GitChangesPanel
              repoSummary={{
                repoRootPath: '/workspace/repo',
                headRef: 'main',
                workspaceSummary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
              }}
              workspace={{
                repoRootPath: '/workspace/repo',
                summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                staged: [{ section: 'staged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts', additions: 3, deletions: 1 }],
                unstaged: [],
                untracked: [],
                conflicted: [],
              }}
              selectedSection="staged"
              commitMessage="ship it"
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const commitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Commit...'));
      expect(commitButton).toBeTruthy();
      commitButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.body.textContent).toContain('Commit staged changes');
      expect(document.body.textContent).toContain('src/app.ts');
      expect(document.body.textContent).toContain('Files Ready');
      expect(document.body.textContent).toContain('1 file');
      expect(document.body.textContent).toContain('+3');
      expect(document.body.textContent).toContain('-1');
      expect(document.body.textContent).toContain('Message');
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('shows the section-specific bulk action button and emits the selected section', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onBulkAction = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[620px]">
            <GitChangesPanel
              workspace={{
                repoRootPath: '/workspace/repo',
                summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 1, conflictedCount: 0 },
                staged: [],
                unstaged: [],
                untracked: [{ section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt', additions: 10, deletions: 0 }],
                conflicted: [],
              }}
              selectedSection="untracked"
              onBulkAction={onBulkAction}
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const bulkButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Track All'));
      expect(bulkButton).toBeTruthy();
      bulkButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onBulkAction).toHaveBeenCalledWith('untracked');
    } finally {
      dispose();
    }
  });

  it('shows the section-specific empty state copy', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[620px]">
            <GitChangesPanel
              repoSummary={{
                repoRootPath: '/workspace/repo',
                headRef: 'main',
                workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
              }}
              workspace={{
                repoRootPath: '/workspace/repo',
                summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                staged: [],
                unstaged: [],
                untracked: [],
                conflicted: [],
              }}
              selectedSection="staged"
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('No staged files yet. Stage files from the pending sections, then open the commit dialog.');
      expect(host.textContent).not.toContain('Choose a file from the staged or pending lists to inspect its patch.');
    } finally {
      dispose();
    }
  });

  it('opens the diff dialog when the file name is clicked', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[620px]">
            <GitChangesPanel
              repoSummary={{
                repoRootPath: '/workspace/repo',
                headRef: 'main',
                workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
              }}
              workspace={{
                repoRootPath: '/workspace/repo',
                summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
                staged: [],
                unstaged: [{
                  section: 'unstaged',
                  changeType: 'modified',
                  path: 'src/next.ts',
                  displayPath: 'src/next.ts',
                  additions: 4,
                  deletions: 2,
                  patchText: ['@@ -1,2 +1,2 @@', '-oldLine();', '+newLine();'].join('\n'),
                }],
                untracked: [],
                conflicted: [],
              }}
              selectedSection="unstaged"
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const fileButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('src/next.ts'));
      expect(fileButton).toBeTruthy();
      fileButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.body.textContent).toContain('Workspace Diff');
      expect(document.body.textContent).toContain('src/next.ts');
      expect(document.body.textContent).toContain('newLine();');
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('renders untracked diff content when the file includes patch text', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[620px]">
            <GitChangesPanel
              workspace={{
                repoRootPath: '/workspace/repo',
                summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 1, conflictedCount: 0 },
                staged: [],
                unstaged: [],
                untracked: [{
                  section: 'untracked',
                  changeType: 'added',
                  path: 'docs/architecture/global-control-plane.md',
                  displayPath: 'docs/architecture/global-control-plane.md',
                  additions: 2,
                  deletions: 0,
                  patchText: [
                    'diff --git a/docs/architecture/global-control-plane.md b/docs/architecture/global-control-plane.md',
                    'new file mode 100644',
                    '--- /dev/null',
                    '+++ b/docs/architecture/global-control-plane.md',
                    '@@ -0,0 +1,2 @@',
                    '+# Control Plane',
                    '+More details',
                  ].join('\n'),
                }],
                conflicted: [],
              }}
              selectedSection="untracked"
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const fileButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('global-control-plane.md'));
      expect(fileButton).toBeTruthy();
      fileButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.body.textContent).toContain('Workspace Diff');
      expect(document.body.textContent).toContain('Control Plane');
      expect(document.body.textContent).toContain('More details');
    } finally {
      dispose();
    }
  });
});
