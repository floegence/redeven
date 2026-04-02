// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHistoryBrowser } from './GitHistoryBrowser';

const mockGetCommitDetail = vi.hoisted(() => vi.fn());
const mockGetDiffContent = vi.hoisted(() => vi.fn());

vi.mock('@floegence/floe-webapp-protocol', async () => {
  const actual = await vi.importActual<typeof import('@floegence/floe-webapp-protocol')>('@floegence/floe-webapp-protocol');
  return {
    ...actual,
    useProtocol: () => ({
      client: () => ({ connected: true }),
    }),
  };
});

vi.mock('../protocol/redeven_v1', async () => {
  const actual = await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1');
  return {
    ...actual,
    useRedevenRpc: () => ({
      git: {
        getCommitDetail: mockGetCommitDetail,
        getDiffContent: mockGetDiffContent,
      },
    }),
  };
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  mockGetCommitDetail.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    commit: {
      hash: '3a47b67b1234567890',
      shortHash: '3a47b67b',
      parents: [],
      subject: 'Refine bootstrap',
      body: ['Refine bootstrap', '', 'Keep diff rendering stable.'].join('\n'),
    },
    files: [
      {
        changeType: 'modified',
        path: 'src/app.ts',
        displayPath: 'src/app.ts',
        additions: 1,
        deletions: 1,
        patchText: [
          'diff --git a/src/app.ts b/src/app.ts',
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
          '@@ -1 +1 @@',
          '-oldValue',
          '+newValue',
        ].join('\n'),
      },
    ],
  });
  mockGetDiffContent.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    mode: 'preview',
    file: {
      changeType: 'modified',
      path: 'src/app.ts',
      displayPath: 'src/app.ts',
      additions: 1,
      deletions: 1,
      patchText: [
        'diff --git a/src/app.ts b/src/app.ts',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -1 +1 @@',
        '-oldValue',
        '+newValue',
      ].join('\n'),
    },
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('GitHistoryBrowser interactions', () => {
  it('renders commit patches inline from the commit detail payload', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[640px]">
            <GitHistoryBrowser
              repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: '3a47b67b1234567890' }}
              currentPath="/workspace/repo/src"
              selectedCommitHash="3a47b67b1234567890"
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const fileButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('src/app.ts'));
      expect(fileButton).toBeTruthy();
      fileButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(document.body.textContent).toContain('Commit');
      expect(document.body.textContent).toContain('Files in Commit');
      expect(document.body.textContent).toContain('Copy Patch');
      expect(document.body.textContent).toContain('+newValue');
      expect(mockGetCommitDetail).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('loads patch previews on demand when commit detail only returns file summaries', async () => {
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo',
      commit: {
        hash: '3a47b67b1234567890',
        shortHash: '3a47b67b',
        parents: [],
        subject: 'Refine bootstrap',
        body: ['Refine bootstrap', '', 'Keep diff rendering stable.'].join('\n'),
      },
      files: [
        {
          changeType: 'modified',
          path: 'src/app.ts',
          displayPath: 'src/app.ts',
          additions: 1,
          deletions: 1,
        },
      ],
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[640px]">
            <GitHistoryBrowser
              repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: '3a47b67b1234567890' }}
              currentPath="/workspace/repo/src"
              selectedCommitHash="3a47b67b1234567890"
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const fileButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('src/app.ts'));
      expect(fileButton).toBeTruthy();

      fileButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(mockGetDiffContent.mock.calls[0]?.[0]).toMatchObject({
        repoRootPath: '/workspace/repo',
        sourceKind: 'commit',
        commit: '3a47b67b1234567890',
        mode: 'preview',
        file: {
          changeType: 'modified',
          path: 'src/app.ts',
        },
      });
      expect(document.body.textContent).toContain('Copy Patch');
      expect(document.body.textContent).toContain('+newValue');
    } finally {
      dispose();
    }
  });

  it('keeps the opened commit diff stable while the external graph selection changes', async () => {
    let resolvePreview: ((value: Awaited<ReturnType<typeof mockGetDiffContent>>) => void) | undefined;
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo',
      commit: {
        hash: '3a47b67b1234567890',
        shortHash: '3a47b67b',
        parents: [],
        subject: 'Refine bootstrap',
        body: ['Refine bootstrap', '', 'Keep diff rendering stable.'].join('\n'),
      },
      files: [
        {
          changeType: 'modified',
          path: 'src/app.ts',
          displayPath: 'src/app.ts',
          additions: 1,
          deletions: 1,
        },
      ],
    });
    mockGetDiffContent.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePreview = resolve;
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => {
      const [selectedCommitHash, setSelectedCommitHash] = createSignal('3a47b67b1234567890');
      return (
        <LayoutProvider>
          <NotificationProvider>
            <button type="button" onClick={() => setSelectedCommitHash('')}>
              Clear Selection
            </button>
            <div class="h-[640px]">
              <GitHistoryBrowser
                repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: '3a47b67b1234567890' }}
                currentPath="/workspace/repo/src"
                selectedCommitHash={selectedCommitHash()}
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();
      const fileButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('src/app.ts'));
      expect(fileButton).toBeTruthy();

      fileButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain('Loading patch preview...');

      const clearButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Clear Selection'));
      expect(clearButton).toBeTruthy();
      clearButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      resolvePreview?.({
        repoRootPath: '/workspace/repo',
        mode: 'preview',
        file: {
          changeType: 'modified',
          path: 'src/app.ts',
          displayPath: 'src/app.ts',
          additions: 1,
          deletions: 1,
          patchText: [
            'diff --git a/src/app.ts b/src/app.ts',
            '--- a/src/app.ts',
            '+++ b/src/app.ts',
            '@@ -1 +1 @@',
            '-oldValue',
            '+newValue',
          ].join('\n'),
        },
      });
      await flush();

      expect(document.body.textContent).toContain('Commit Diff');
      expect(document.body.textContent).toContain('+newValue');
    } finally {
      dispose();
    }
  });

  it('collapses normalized commit message details to two lines and lets the user expand them', async () => {
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo',
      commit: {
        hash: '9750efa31234567890',
        shortHash: '9750efa3',
        parents: ['ef07ecc1234567890'],
        subject: 'fix(region): avoid route props spread recursion',
        body: [
          'fix(region): avoid route props spread recursion',
          '',
          'Move route props out of the recursive spread path.',
          'Keep the branch shell stable during nested renders.',
          'Preserve layout hydration ordering for portal bootstrap.',
        ].join('\n'),
      },
      files: [],
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[640px]">
            <GitHistoryBrowser
              repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: '9750efa31234567890' }}
              currentPath="/workspace/repo/src"
              selectedCommitHash="9750efa31234567890"
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const messageBlock = Array.from(host.querySelectorAll('div')).find((node) => {
        const className = node.className?.toString?.() ?? '';
        return className.includes('whitespace-pre-wrap') && node.textContent?.includes('Move route props out of the recursive spread path.');
      });
      const toggleButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Show more'));

      expect(messageBlock).toBeTruthy();
      expect(messageBlock?.textContent).not.toContain('fix(region): avoid route props spread recursion');
      expect(messageBlock?.getAttribute('style')).toContain('-webkit-line-clamp: 2');
      expect(toggleButton).toBeTruthy();
      expect(toggleButton?.getAttribute('aria-expanded')).toBe('false');

      toggleButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(toggleButton?.textContent).toContain('Show less');
      expect(toggleButton?.getAttribute('aria-expanded')).toBe('true');
      expect(messageBlock?.getAttribute('style') ?? '').not.toContain('-webkit-line-clamp');
    } finally {
      dispose();
    }
  });

  it('shows a commit-scoped Ask Flower action in graph detail', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onAskFlower = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[640px]">
            <GitHistoryBrowser
              repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: '3a47b67b1234567890' }}
              currentPath="/workspace/repo/src"
              selectedCommitHash="3a47b67b1234567890"
              onAskFlower={onAskFlower}
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const shortcutDock = host.querySelector('[data-git-shortcut-dock]');
      const askFlowerButton = host.querySelector('button[aria-label="Ask Flower"]') as HTMLButtonElement | null;
      expect(shortcutDock).toBeTruthy();
      expect(shortcutDock?.className).toContain('items-center');
      expect(askFlowerButton).toBeTruthy();
      expect(askFlowerButton?.dataset.gitShortcutOrb).toBe('flower');
      expect(askFlowerButton?.className).toContain('h-7');
      expect(askFlowerButton?.textContent).toBe('');

      askFlowerButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onAskFlower).toHaveBeenCalledWith({
        kind: 'commit',
        repoRootPath: '/workspace/repo',
        location: 'graph',
        commit: {
          hash: '3a47b67b1234567890',
          shortHash: '3a47b67b',
          parents: [],
          subject: 'Refine bootstrap',
          body: ['Refine bootstrap', '', 'Keep diff rendering stable.'].join('\n'),
        },
        files: [
          {
            changeType: 'modified',
            path: 'src/app.ts',
            displayPath: 'src/app.ts',
            additions: 1,
            deletions: 1,
            patchText: [
              'diff --git a/src/app.ts b/src/app.ts',
              '--- a/src/app.ts',
              '+++ b/src/app.ts',
              '@@ -1 +1 @@',
              '-oldValue',
              '+newValue',
            ].join('\n'),
          },
        ],
      });
    } finally {
      dispose();
    }
  });

  it('offers a graph action to detach HEAD at the selected commit', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onSwitchDetached = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[640px]">
            <GitHistoryBrowser
              repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: '3a47b67b1234567890' }}
              repoSummary={{
                repoRootPath: '/workspace/repo',
                headRef: 'main',
                headCommit: '3a47b67b1234567890',
                workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
              }}
              currentPath="/workspace/repo/src"
              selectedCommitHash="3a47b67b1234567890"
              onSwitchDetached={onSwitchDetached}
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const detachButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Switch --detach')) as HTMLButtonElement | undefined;
      expect(detachButton).toBeTruthy();
      expect(detachButton?.disabled).toBe(false);

      detachButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onSwitchDetached).toHaveBeenCalledWith({
        commitHash: '3a47b67b1234567890',
        shortHash: '3a47b67b',
        source: 'graph',
      });
    } finally {
      dispose();
    }
  });

  it('uses left-rail guidance before a commit is selected', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[640px]">
            <GitHistoryBrowser
              repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: '3a47b67b1234567890' }}
              currentPath="/workspace/repo/src"
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      expect(host.textContent).toContain('Choose a commit from the left rail to load its details.');
      expect(host.textContent).not.toContain('Select a commit from the sidebar to inspect its details.');
    } finally {
      dispose();
    }
  });
});
