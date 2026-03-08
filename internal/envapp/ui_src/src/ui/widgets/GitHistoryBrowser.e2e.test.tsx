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
      body: 'Keep diff rendering stable.',
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
  it('renders commit diff directly from the commit detail payload', async () => {
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

      expect(document.body.textContent).toContain('Commit Diff');
      expect(document.body.textContent).toContain('+newValue');
      expect(document.body.textContent).not.toContain('No inline diff lines available');
      expect(mockGetCommitDetail).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });
});
