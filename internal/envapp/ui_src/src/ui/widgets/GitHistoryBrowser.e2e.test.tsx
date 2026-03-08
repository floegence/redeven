// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHistoryBrowser } from './GitHistoryBrowser';

const mockReadGitPatchTextOnce = vi.hoisted(() => vi.fn());
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

vi.mock('../utils/gitPatchStreamReader', async () => {
  const actual = await vi.importActual<typeof import('../utils/gitPatchStreamReader')>('../utils/gitPatchStreamReader');
  return {
    ...actual,
    readGitPatchTextOnce: mockReadGitPatchTextOnce,
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
        patchPath: 'src/app.ts',
        additions: 1,
        deletions: 1,
      },
    ],
  });

  mockReadGitPatchTextOnce.mockImplementation(async ({ filePath }: { filePath?: string }) => {
    if (filePath) {
      return {
        text: '\n',
        meta: { ok: true, content_len: 1 },
      };
    }
    const patch = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      '-oldValue',
      '+newValue',
      'diff --git a/src/other.ts b/src/other.ts',
      '--- a/src/other.ts',
      '+++ b/src/other.ts',
      '@@ -2 +2 @@',
      '-otherOld',
      '+otherNew',
    ].join('\n');
    return {
      text: patch,
      meta: { ok: true, content_len: patch.length },
    };
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('GitHistoryBrowser interactions', () => {
  it('shows extracted diff content when the file-scoped commit patch comes back blank', async () => {
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
      expect(mockReadGitPatchTextOnce).toHaveBeenCalledTimes(2);
      expect(mockReadGitPatchTextOnce.mock.calls[0]?.[0]?.filePath).toBe('src/app.ts');
      expect(mockReadGitPatchTextOnce.mock.calls[1]?.[0]?.filePath).toBeUndefined();
    } finally {
      dispose();
    }
  });
});
