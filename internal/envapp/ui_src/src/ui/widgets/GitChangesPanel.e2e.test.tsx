// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redevenV1Contract } from '../protocol/redeven_v1';
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

async function revealTooltipForButton(button: HTMLButtonElement | null | undefined): Promise<HTMLElement | null> {
  const host = button?.closest('[data-redeven-tooltip-anchor]') as HTMLElement | null;
  expect(host).toBeTruthy();
  host!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
}

describe('GitChangesPanel interactions', () => {
  it('renders only the selected section as a compact file table', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
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
                selectedSection="changes"
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Changes');
      expect(host.textContent).toContain('Path');
      expect(host.textContent).toContain('Status');
      expect(host.textContent).toContain('Modified');
      expect(host.textContent).toContain('src/next.ts');
      expect(host.textContent).toContain('+ Stage');
      expect(host.textContent).not.toContain('Patch');
      expect(host.textContent).not.toContain('Ready to Commit');
      expect(host.querySelector('tbody tr td:nth-child(2) .rounded-full')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('keeps paged totals in footer copy without inventing unloaded scroll space', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitChangesPanel
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  workspaceSummary: { stagedCount: 2, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 2, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                  staged: [
                    { section: 'staged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts', additions: 4, deletions: 2 },
                    { section: 'staged', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt', additions: 10, deletions: 0 },
                  ],
                  unstaged: [],
                  untracked: [],
                  conflicted: [],
                }}
                workspacePages={{
                  staged: {
                    items: [],
                    totalCount: 40,
                    nextOffset: 2,
                    hasMore: true,
                    loading: false,
                    error: '',
                    initialized: true,
                  },
                }}
                selectedSection="staged"
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(host.textContent).toContain('Loaded 2 of 40 files.');
      expect(host.textContent).toContain('Visible rows render while you scroll.');
      expect(host.textContent).toContain('src/app.ts');
      expect(host.textContent).toContain('notes.txt');
      expect(host.querySelectorAll('tr[aria-hidden="true"] td')).toHaveLength(0);
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
          <ProtocolProvider contract={redevenV1Contract}>
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
          </ProtocolProvider>
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
      expect(document.body.textContent).toContain('Status');
      expect(document.body.textContent).toContain('Modified');
      expect(document.body.textContent).toContain('1 file');
      expect(document.body.textContent).toContain('+3');
      expect(document.body.textContent).toContain('-1');
      expect(document.body.textContent).toContain('Message');
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('describes partially loaded staged snapshots in the commit dialog', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitChangesPanel
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  workspaceSummary: { stagedCount: 2, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 2, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                  staged: [
                    { section: 'staged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts', additions: 3, deletions: 1 },
                    { section: 'staged', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt', additions: 10, deletions: 0 },
                  ],
                  unstaged: [],
                  untracked: [],
                  conflicted: [],
                }}
                workspacePages={{
                  staged: {
                    items: [],
                    totalCount: 40,
                    nextOffset: 2,
                    hasMore: true,
                    loading: false,
                    error: '',
                    initialized: true,
                  },
                }}
                selectedSection="staged"
                commitMessage="ship it"
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const commitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Commit...'));
      expect(commitButton).toBeTruthy();
      commitButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.body.textContent).toContain('Loaded 2 of 40 staged files.');
      expect(document.body.textContent).toContain('More staged files are available.');
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
          <ProtocolProvider contract={redevenV1Contract}>
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
                selectedSection="changes"
                onBulkAction={onBulkAction}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const bulkButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Stage All'));
      expect(bulkButton).toBeTruthy();
      bulkButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onBulkAction).toHaveBeenCalledWith('changes');
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
          <ProtocolProvider contract={redevenV1Contract}>
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
          </ProtocolProvider>
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

  it('opens the stash window from the workspace actions', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onOpenStash = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitChangesPanel
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  stashCount: 1,
                  workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
                  staged: [],
                  unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/next.ts', displayPath: 'src/next.ts' }],
                  untracked: [{ section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt' }],
                  conflicted: [],
                }}
                selectedSection="changes"
                onOpenStash={onOpenStash}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const stashButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Stash...')) as HTMLButtonElement | undefined;
      expect(stashButton).toBeTruthy();
      stashButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onOpenStash).toHaveBeenCalledWith({
        tab: 'save',
        repoRootPath: '/workspace/repo',
        source: 'changes',
      });
    } finally {
      dispose();
    }
  });

  it('exposes Ask Flower, Terminal, and Files from the workspace card', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onAskFlower = vi.fn();
    const onOpenInTerminal = vi.fn();
    const onBrowseFiles = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitChangesPanel
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
                  staged: [],
                  unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/next.ts', displayPath: 'src/next.ts', additions: 4, deletions: 2 }],
                  untracked: [{ section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt' }],
                  conflicted: [],
                }}
                selectedSection="changes"
                onAskFlower={onAskFlower}
                onOpenInTerminal={onOpenInTerminal}
                onBrowseFiles={onBrowseFiles}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const shortcutDock = host.querySelector('[data-git-shortcut-dock]');
      const askFlowerButton = host.querySelector('button[aria-label="Ask Flower"]') as HTMLButtonElement | null;
      const openInTerminalButton = host.querySelector('button[aria-label="Terminal"]') as HTMLButtonElement | null;
      const browseFilesButton = host.querySelector('button[aria-label="Files"]') as HTMLButtonElement | null;
      const askFlowerShell = askFlowerButton?.firstElementChild as HTMLSpanElement | null;
      const askFlowerIcon = askFlowerShell?.querySelector('svg') as SVGElement | null;

      expect(shortcutDock).toBeTruthy();
      expect(shortcutDock?.className).toContain('items-center');
      expect(askFlowerButton).toBeTruthy();
      expect(openInTerminalButton).toBeTruthy();
      expect(browseFilesButton).toBeTruthy();
      expect(askFlowerButton?.dataset.gitShortcutOrb).toBe('flower');
      expect(openInTerminalButton?.dataset.gitShortcutOrb).toBe('terminal');
      expect(browseFilesButton?.dataset.gitShortcutOrb).toBe('files');
      expect(askFlowerButton?.className).toContain('h-7');
      expect(openInTerminalButton?.className).toContain('h-7');
      expect(browseFilesButton?.className).toContain('h-7');
      expect(askFlowerButton?.className).not.toContain('hover:-translate-y-0.5');
      expect(askFlowerShell?.className).toContain('bg-slate-200');
      expect(askFlowerShell?.className).toContain('border-slate-400/90');
      expect(askFlowerShell?.className).not.toContain('backdrop-blur');
      expect(askFlowerShell?.className).not.toContain('bg-gradient');
      expect(askFlowerIcon?.className.baseVal ?? '').toContain('text-orange-700');
      expect(askFlowerButton?.textContent).toBe('');
      expect(openInTerminalButton?.textContent).toBe('');
      expect(browseFilesButton?.textContent).toBe('');

      askFlowerButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      openInTerminalButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      browseFilesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onAskFlower).toHaveBeenCalledWith({
        kind: 'workspace_section',
        repoRootPath: '/workspace/repo',
        headRef: 'main',
        section: 'changes',
        items: [
          { section: 'unstaged', changeType: 'modified', path: 'src/next.ts', displayPath: 'src/next.ts', additions: 4, deletions: 2 },
          { section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt' },
        ],
      });
      expect(onOpenInTerminal).toHaveBeenCalledWith({
        path: '/workspace/repo',
        preferredName: 'repo',
      });
      expect(onBrowseFiles).toHaveBeenCalledWith({
        path: '/workspace/repo',
        preferredName: 'repo',
      });
    } finally {
      dispose();
    }
  });

  it('shows a tooltip when Ask Flower is disabled for an empty section', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
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
                selectedSection="conflicted"
                onAskFlower={() => {}}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const askFlowerButton = host.querySelector('button[aria-label="Ask Flower"]') as HTMLButtonElement | null;
      expect(askFlowerButton?.disabled).toBe(true);

      const tooltip = await revealTooltipForButton(askFlowerButton);
      expect(tooltip?.textContent).toContain('No files in this section.');
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
          <ProtocolProvider contract={redevenV1Contract}>
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
                selectedSection="changes"
              />
            </div>
          </ProtocolProvider>
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
      const dialogRoot = document.querySelector('[role="dialog"]') as HTMLDivElement | null;
      expect(dialogRoot).toBeTruthy();
      const closeButton = dialogRoot?.querySelector('button[aria-label="Close"]') as HTMLButtonElement | null;
      expect(closeButton).toBeTruthy();
      expect(closeButton?.className).toContain('hover:bg-error');
      expect(closeButton?.className).not.toContain('hover:bg-muted/80');
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
          <ProtocolProvider contract={redevenV1Contract}>
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
                selectedSection="changes"
              />
            </div>
          </ProtocolProvider>
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
