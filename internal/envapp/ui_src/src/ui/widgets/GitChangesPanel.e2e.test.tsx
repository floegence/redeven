// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redevenV1Contract } from '../protocol/redeven_v1';
import { GitChangesPanel } from './GitChangesPanel';

const resizeObserverState = {
  observers: [] as Array<{
    callback: ResizeObserverCallback;
    elements: Element[];
  }>,
};

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function defineElementWidth(element: Element, width: number) {
  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    get: () => width,
  });
}

function triggerResizeObservers() {
  for (const observer of resizeObserverState.observers) {
    observer.callback(
      observer.elements.map((element) => ({
        target: element,
        contentRect: {
          width: (element as HTMLElement).offsetWidth ?? 0,
          height: 0,
          top: 0,
          left: 0,
          bottom: 0,
          right: (element as HTMLElement).offsetWidth ?? 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
      }) as ResizeObserverEntry),
      {} as ResizeObserver,
    );
  }
}

async function setHeaderWidth(host: HTMLElement, width: number) {
  const header = host.querySelector('[data-git-changes-header-density]') as HTMLElement | null;
  expect(header).toBeTruthy();
  defineElementWidth(header!, width);
  triggerResizeObservers();
  await flush();
  return header;
}

async function clickDropdownMenuItem(trigger: HTMLButtonElement | null | undefined, label: string) {
  expect(trigger).toBeTruthy();
  trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();

  const menuItem = Array.from(document.body.querySelectorAll('[role="menu"] button'))
    .find((node) => node.textContent?.trim() === label) as HTMLButtonElement | undefined;
  expect(menuItem).toBeTruthy();
  menuItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();
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

  resizeObserverState.observers.length = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    return window.setTimeout(() => callback(performance.now()), 0);
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    window.clearTimeout(handle);
  });
  vi.stubGlobal('ResizeObserver', class {
    private readonly record: {
      callback: ResizeObserverCallback;
      elements: Element[];
    };

    constructor(callback: ResizeObserverCallback) {
      this.record = {
        callback,
        elements: [],
      };
      resizeObserverState.observers.push(this.record);
    }

    observe(element: Element) {
      this.record.elements.push(element);
    }

    unobserve(element: Element) {
      this.record.elements = this.record.elements.filter((entry) => entry !== element);
    }

    disconnect() {
      this.record.elements = [];
    }
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

function findGitTitleDot(container: ParentNode, label: string): HTMLSpanElement | null {
  const labelNode = Array.from(container.querySelectorAll('div')).find((node) => (
    node.textContent?.trim() === label
    && node.className.includes('tracking-[0.16em]')
  )) as HTMLDivElement | undefined;
  expect(labelNode).toBeTruthy();
  return labelNode?.parentElement?.querySelector('span[aria-hidden="true"]') as HTMLSpanElement | null;
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

  it('switches the workspace header between collapsed, compact, and comfortable densities based on container width', async () => {
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
                  workspaceSummary: { stagedCount: 0, unstagedCount: 19, untrackedCount: 0, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 0, unstagedCount: 19, untrackedCount: 0, conflictedCount: 0 },
                  staged: [],
                  unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/next.ts', displayPath: 'src/next.ts', additions: 4, deletions: 2 }],
                  untracked: [],
                  conflicted: [],
                }}
                selectedSection="changes"
                onAskFlower={() => undefined}
                onOpenInTerminal={() => undefined}
                onBrowseFiles={() => undefined}
                onOpenStash={() => undefined}
                onBulkAction={() => undefined}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const header = await setHeaderWidth(host, 560);
      expect(header?.getAttribute('data-git-changes-header-density')).toBe('collapsed');
      expect(host.querySelector('button[aria-label="Ask Flower"]')).toBeNull();
      expect(host.querySelector('button[aria-label="Terminal"]')).toBeNull();
      expect(host.querySelector('button[aria-label="Files"]')).toBeNull();
      expect(host.querySelector('button[aria-label="More actions"]')).toBeTruthy();

      await setHeaderWidth(host, 720);
      expect(header?.getAttribute('data-git-changes-header-density')).toBe('compact');
      expect(host.querySelector('button[aria-label="Ask Flower"]')).toBeNull();
      expect(host.querySelector('button[aria-label="Terminal"]')).toBeTruthy();
      expect(host.querySelector('button[aria-label="Files"]')).toBeTruthy();
      expect(host.querySelector('button[aria-label="More actions"]')).toBeTruthy();

      await setHeaderWidth(host, 960);
      expect(header?.getAttribute('data-git-changes-header-density')).toBe('comfortable');
      expect(host.querySelector('button[aria-label="Ask Flower"]')).toBeTruthy();
      expect(host.querySelector('button[aria-label="Terminal"]')).toBeTruthy();
      expect(host.querySelector('button[aria-label="Files"]')).toBeTruthy();
      expect(host.querySelector('button[aria-label="More actions"]')).toBeNull();
      expect(host.textContent).toContain('Stage what you want to keep, then commit.');
    } finally {
      dispose();
    }
  });

  it('keeps overflow actions wired to the same commands when the header collapses', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onOpenInTerminal = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitChangesPanel
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  workspaceSummary: { stagedCount: 0, unstagedCount: 19, untrackedCount: 0, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 0, unstagedCount: 19, untrackedCount: 0, conflictedCount: 0 },
                  staged: [],
                  unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/next.ts', displayPath: 'src/next.ts', additions: 4, deletions: 2 }],
                  untracked: [],
                  conflicted: [],
                }}
                selectedSection="changes"
                onAskFlower={() => undefined}
                onOpenInTerminal={onOpenInTerminal}
                onBrowseFiles={() => undefined}
                onOpenStash={() => undefined}
                onBulkAction={() => undefined}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await setHeaderWidth(host, 560);
      const moreActionsButton = host.querySelector('button[aria-label="More actions"]') as HTMLButtonElement | null;
      await clickDropdownMenuItem(moreActionsButton, 'Open in Terminal');

      expect(onOpenInTerminal).toHaveBeenCalledWith({
        path: '/workspace/repo',
        preferredName: 'repo',
      });
    } finally {
      dispose();
    }
  });

  it('renders a semantic warning dot for the workspace title block', () => {
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
                  workspaceSummary: { stagedCount: 0, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 0, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
                  staged: [],
                  unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/next.ts', displayPath: 'src/next.ts', additions: 4, deletions: 2 }],
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
      const workspaceDot = findGitTitleDot(host, 'Workspace');
      expect(workspaceDot?.className).toContain('git-tone-dot');
      expect(workspaceDot?.className).toContain('git-tone-dot--warning');
      expect(workspaceDot?.className).not.toContain('bg-warning/75');
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

      expect(host.textContent).toContain('Showing 2 of 40 files.');
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

      expect(document.body.textContent).toContain('More staged files are available.');
      expect(document.body.textContent).not.toContain('Loaded 2 of 40 staged files.');
    } finally {
      dispose();
    }
  });

  it('surfaces a clearer loading state for paged workspace footers', async () => {
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
                    loading: true,
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

      expect(host.textContent).toContain('Loading next page');
      expect(host.textContent).toContain('Loading more...');
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

  it('opens a discard confirmation for a pending file and emits the selected item on confirm', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onDiscardSelected = vi.fn();

    const item = {
      section: 'unstaged' as const,
      changeType: 'modified',
      path: 'src/next.ts',
      displayPath: 'src/next.ts',
      additions: 4,
      deletions: 2,
    };

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitChangesPanel
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
                  staged: [],
                  unstaged: [item],
                  untracked: [],
                  conflicted: [],
                }}
                selectedSection="changes"
                onDiscardSelected={onDiscardSelected}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const discardButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Discard...');
      expect(discardButton).toBeTruthy();
      discardButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.body.textContent).toContain('Discard file changes');
      expect(document.body.textContent).toContain('src/next.ts');

      const confirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Discard');
      expect(confirmButton).toBeTruthy();
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onDiscardSelected).toHaveBeenCalledWith(item);
    } finally {
      dispose();
    }
  });

  it('shows a discard-all confirmation for Changes and emits the current section on confirm', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onDiscardAll = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitChangesPanel
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 1, conflictedCount: 0 },
                  staged: [],
                  unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/next.ts', displayPath: 'src/next.ts' }],
                  untracked: [{ section: 'untracked', changeType: 'added', path: 'notes.txt', displayPath: 'notes.txt' }],
                  conflicted: [],
                }}
                selectedSection="changes"
                onDiscardAll={onDiscardAll}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await setHeaderWidth(host, 960);
      const discardAllButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Discard All...');
      expect(discardAllButton).toBeTruthy();
      discardAllButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.body.textContent).toContain('Discard pending changes');
      expect(document.body.textContent).toContain('Discard all 2 files in Changes?');

      const confirmButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Discard All');
      expect(confirmButton).toBeTruthy();
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onDiscardAll).toHaveBeenCalledWith('changes');
    } finally {
      dispose();
    }
  });

  it('renders breadcrumbs for nested folders and navigates when a directory row is opened', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onNavigateDirectory = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitChangesPanel
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 3, conflictedCount: 0 },
                  staged: [],
                  unstaged: [],
                  untracked: [],
                  conflicted: [],
                }}
                workspacePages={{
                  changes: {
                    items: [
                      {
                        section: 'changes',
                        entryKind: 'directory',
                        path: 'desktop/diagnostics',
                        displayPath: 'desktop/diagnostics',
                        directoryPath: 'desktop/diagnostics',
                        descendantFileCount: 2,
                        containsUntracked: true,
                      },
                      {
                        section: 'untracked',
                        entryKind: 'file',
                        path: 'desktop/readme.md',
                        displayPath: 'desktop/readme.md',
                      },
                    ],
                    totalCount: 2,
                    scopeFileCount: 3,
                    nextOffset: 2,
                    hasMore: false,
                    loading: false,
                    error: '',
                    initialized: true,
                    directoryPath: 'desktop',
                    breadcrumbs: [
                      { label: 'repo', path: '' },
                      { label: 'desktop', path: 'desktop' },
                    ],
                  },
                }}
                selectedSection="changes"
                onBulkAction={() => undefined}
                onNavigateDirectory={onNavigateDirectory}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Stage Folder');
      expect(host.textContent).toContain('repo');
      expect(host.textContent).toContain('desktop');
      expect(host.textContent).toContain('Folder');
      expect(host.textContent).toContain('3 files');

      const rootCrumb = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'repo');
      expect(rootCrumb).toBeTruthy();
      rootCrumb!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const directoryButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('diagnostics'));
      expect(directoryButton).toBeTruthy();
      directoryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onNavigateDirectory).toHaveBeenNthCalledWith(1, '');
      expect(onNavigateDirectory).toHaveBeenNthCalledWith(2, 'desktop/diagnostics');
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

  it('exposes Ask Flower, Terminal, and Files from the workspace card', async () => {
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
      await setHeaderWidth(host, 960);
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
      expect(askFlowerShell?.className).toContain('redeven-surface-control');
      expect(askFlowerShell?.className).toContain('text-slate-900');
      expect(askFlowerShell?.className).toContain('dark:text-slate-50');
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

  it('keeps clean-state headers quiet by hiding irrelevant disabled actions', async () => {
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
                selectedSection="changes"
                onAskFlower={() => {}}
                onOpenInTerminal={() => {}}
                onBrowseFiles={() => {}}
                onOpenStash={() => {}}
                onBulkAction={() => {}}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await setHeaderWidth(host, 960);

      expect(host.textContent).toContain('Clean');
      expect(host.textContent).toContain('No pending changes');
      expect(Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Stage All'))).toBeFalsy();
      expect(Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Commit...'))).toBeFalsy();
      expect(Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Discard All...'))).toBeFalsy();
      expect(host.querySelector('button[aria-label="Ask Flower"]')).toBeNull();
      expect(host.querySelector('button[aria-label="Terminal"]')).toBeTruthy();
      expect(host.querySelector('button[aria-label="Files"]')).toBeTruthy();
      expect(Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Stash...'))).toBeTruthy();
      expect(host.querySelector('[data-git-changes-header-actions="inline"]')).toBeTruthy();
      expect(host.querySelector('[data-git-changes-header-actions="separate"]')).toBeNull();
      expect(host.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('collapses breadcrumb middle segments when the header rail is narrow and keeps hidden segments navigable', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onNavigateDirectory = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitChangesPanel
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 5, conflictedCount: 0 },
                  staged: [],
                  unstaged: [],
                  untracked: [],
                  conflicted: [],
                }}
                workspacePages={{
                  changes: {
                    items: [],
                    totalCount: 5,
                    scopeFileCount: 5,
                    nextOffset: 5,
                    hasMore: false,
                    loading: false,
                    error: '',
                    initialized: true,
                    directoryPath: 'desktop/workbench/dialogs/routing',
                    breadcrumbs: [
                      { label: 'repo', path: '' },
                      { label: 'desktop', path: 'desktop' },
                      { label: 'workbench', path: 'desktop/workbench' },
                      { label: 'dialogs', path: 'desktop/workbench/dialogs' },
                      { label: 'routing', path: 'desktop/workbench/dialogs/routing' },
                    ],
                  },
                }}
                selectedSection="changes"
                onNavigateDirectory={onNavigateDirectory}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await setHeaderWidth(host, 720);

      const breadcrumb = host.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement | null;
      expect(breadcrumb).toBeTruthy();

      const hiddenMeasure = breadcrumb?.querySelector('div[aria-hidden="true"]') as HTMLDivElement | null;
      expect(hiddenMeasure).toBeTruthy();

      defineElementWidth(breadcrumb!, 276);
      const measureChildren = Array.from(hiddenMeasure!.children);
      const segmentWidths = [40, 68, 84, 72, 60];
      for (const [index, width] of segmentWidths.entries()) {
        defineElementWidth(measureChildren[index]!, width);
      }
      defineElementWidth(measureChildren[segmentWidths.length]!, 12);
      defineElementWidth(measureChildren[segmentWidths.length + 1]!, 28);

      triggerResizeObservers();
      await flush();

      const visibleButtons = Array.from(breadcrumb!.querySelectorAll('button'))
        .filter((node) => node.closest('[aria-hidden="true"]') === null)
        .map((node) => node.textContent?.trim())
        .filter(Boolean);

      expect(visibleButtons).toContain('repo');
      expect(visibleButtons).toContain('dialogs');
      expect(visibleButtons).toContain('routing');
      expect(visibleButtons).toContain('…');
      expect(visibleButtons).not.toContain('desktop');
      expect(visibleButtons).not.toContain('workbench');

      const ellipsisButton = Array.from(breadcrumb!.querySelectorAll('button'))
        .find((node) => node.closest('[aria-hidden="true"]') === null && node.textContent?.trim() === '…') as HTMLButtonElement | undefined;
      await clickDropdownMenuItem(ellipsisButton, 'workbench');
      expect(onNavigateDirectory).toHaveBeenCalledWith('desktop/workbench');
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
