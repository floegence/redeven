// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHistoryBrowser } from './GitHistoryBrowser';

const mockGetCommitDetail = vi.hoisted(() => vi.fn());

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
