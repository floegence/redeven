// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetFullContextDiff = vi.hoisted(() => vi.fn());

vi.mock('../protocol/redeven_v1', async () => {
  const actual = await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1');
  return {
    ...actual,
    useRedevenRpc: () => ({
      git: {
        getFullContextDiff: mockGetFullContextDiff,
      },
    }),
  };
});

import { GitDiffDialog } from './GitDiffDialog';

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

  mockGetFullContextDiff.mockReset();
  mockGetFullContextDiff.mockResolvedValue({
    repoRootPath: '/workspace/repo',
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
        '@@ -1,5 +1,5 @@',
        ' context-before',
        ' stable-line',
        '-oldMiddle();',
        '+newMiddle();',
        ' context-after',
        ' trailing-line',
      ].join('\n'),
    },
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('GitDiffDialog', () => {
  it('keeps patch mode as the default and fetches full context only on demand', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <GitDiffDialog
            open
            onOpenChange={() => {}}
            item={{
              changeType: 'modified',
              path: 'src/app.ts',
              displayPath: 'src/app.ts',
              additions: 1,
              deletions: 1,
              patchText: ['@@ -4,1 +4,1 @@', '-oldMiddle();', '+newMiddle();'].join('\n'),
            }}
            source={{
              kind: 'commit',
              repoRootPath: '/workspace/repo',
              commit: 'abc123',
            }}
            title="Commit Diff"
            emptyMessage="Select a file to inspect its diff."
          />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(document.body.textContent).toContain('Patch');
      expect(document.body.textContent).toContain('Full Context');
      expect(document.body.textContent).toContain('Compact patch preview from the current Git payload.');
      expect(document.body.textContent).toContain('newMiddle();');
      expect(mockGetFullContextDiff).not.toHaveBeenCalled();

      const patchButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Patch');
      const fullContextButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Full Context');
      expect(patchButton).toBeTruthy();
      expect(fullContextButton).toBeTruthy();
      expect(patchButton!.className).toContain('cursor-pointer');
      expect(fullContextButton!.className).toContain('cursor-pointer');
      expect(fullContextButton!.className).toContain('disabled:cursor-not-allowed');
      fullContextButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockGetFullContextDiff).toHaveBeenCalledTimes(1);
      expect(mockGetFullContextDiff.mock.calls[0]?.[0]).toMatchObject({
        repoRootPath: '/workspace/repo',
        sourceKind: 'commit',
        commit: 'abc123',
        file: {
          changeType: 'modified',
          path: 'src/app.ts',
        },
      });
      expect(document.body.textContent).toContain('Includes unchanged lines for broader review context.');
      expect(document.body.textContent).toContain('context-before');
      expect(document.body.textContent).toContain('trailing-line');
    } finally {
      dispose();
    }
  });

  it('keeps the existing patch preview visible while full context is loading', async () => {
    let resolveFullContext: ((value: Awaited<ReturnType<typeof mockGetFullContextDiff>>) => void) | undefined;
    mockGetFullContextDiff.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFullContext = resolve;
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <GitDiffDialog
            open
            onOpenChange={() => {}}
            item={{
              changeType: 'modified',
              path: 'src/app.ts',
              displayPath: 'src/app.ts',
              additions: 1,
              deletions: 1,
              patchText: ['@@ -4,1 +4,1 @@', '-oldMiddle();', '+newMiddle();'].join('\n'),
            }}
            source={{
              kind: 'commit',
              repoRootPath: '/workspace/repo',
              commit: 'abc123',
            }}
            title="Commit Diff"
            emptyMessage="Select a file to inspect its diff."
          />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const fullContextButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Full Context');
      expect(fullContextButton).toBeTruthy();
      fullContextButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockGetFullContextDiff).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain('Loading full-context diff...');
      expect(document.body.textContent).toContain('newMiddle();');
      expect(resolveFullContext).toBeTruthy();

      resolveFullContext!({
        repoRootPath: '/workspace/repo',
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
            '@@ -1,5 +1,5 @@',
            ' context-before',
            ' stable-line',
            '-oldMiddle();',
            '+newMiddle();',
            ' context-after',
            ' trailing-line',
          ].join('\n'),
        },
      });
      await flush();

      expect(document.body.textContent).toContain('Includes unchanged lines for broader review context.');
      expect(document.body.textContent).toContain('context-before');
      expect(document.body.textContent).not.toContain('Loading full-context diff...');
    } finally {
      dispose();
    }
  });

  it('keeps unavailable full-context mode visibly disabled with a non-clickable cursor affordance', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <GitDiffDialog
            open
            onOpenChange={() => {}}
            item={{
              changeType: 'modified',
              path: 'src/app.ts',
              displayPath: 'src/app.ts',
              patchText: ['@@ -4,1 +4,1 @@', '-oldMiddle();', '+newMiddle();'].join('\n'),
            }}
            title="Workspace Diff"
            emptyMessage="Select a file to inspect its diff."
          />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const patchButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Patch');
      const fullContextButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Full Context') as HTMLButtonElement | undefined;
      expect(patchButton).toBeTruthy();
      expect(fullContextButton).toBeTruthy();
      expect(patchButton!.className).toContain('cursor-pointer');
      expect(fullContextButton!.className).toContain('cursor-pointer');
      expect(fullContextButton!.className).toContain('disabled:cursor-not-allowed');
      expect(fullContextButton!.disabled).toBe(true);
    } finally {
      dispose();
    }
  });

  it('resets back to patch mode when the selected file changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => {
      const [selection, setSelection] = createSignal<'first' | 'second'>('first');
      return (
        <LayoutProvider>
          <NotificationProvider>
            <button type="button" onClick={() => setSelection('second')}>Swap File</button>
            <GitDiffDialog
              open
              onOpenChange={() => {}}
              item={selection() === 'first'
                ? {
                  changeType: 'modified',
                  path: 'src/app.ts',
                  displayPath: 'src/app.ts',
                  patchText: ['@@ -4,1 +4,1 @@', '-oldMiddle();', '+newMiddle();'].join('\n'),
                }
                : {
                  changeType: 'modified',
                  path: 'src/other.ts',
                  displayPath: 'src/other.ts',
                  patchText: ['@@ -2,1 +2,1 @@', '-beforeSwap();', '+afterSwap();'].join('\n'),
                }}
              source={selection() === 'first'
                ? {
                  kind: 'commit',
                  repoRootPath: '/workspace/repo',
                  commit: 'abc123',
                }
                : {
                  kind: 'commit',
                  repoRootPath: '/workspace/repo',
                  commit: 'def456',
                }}
              title="Commit Diff"
              emptyMessage="Select a file to inspect its diff."
            />
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      const fullContextButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Full Context'));
      expect(fullContextButton).toBeTruthy();
      fullContextButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockGetFullContextDiff).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain('context-before');

      const swapButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Swap File'));
      expect(swapButton).toBeTruthy();
      swapButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(document.body.textContent).toContain('Compact patch preview from the current Git payload.');
      expect(document.body.textContent).toContain('afterSwap();');
      expect(document.body.textContent).not.toContain('context-before');
      expect(mockGetFullContextDiff).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('shows an error state when the full-context request fails', async () => {
    mockGetFullContextDiff.mockRejectedValueOnce(new Error('full context failed'));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <GitDiffDialog
            open
            onOpenChange={() => {}}
            item={{
              changeType: 'modified',
              path: 'src/app.ts',
              displayPath: 'src/app.ts',
              patchText: ['@@ -4,1 +4,1 @@', '-oldMiddle();', '+newMiddle();'].join('\n'),
            }}
            source={{
              kind: 'compare',
              repoRootPath: '/workspace/repo',
              baseRef: 'main',
              targetRef: 'feature/demo',
            }}
            title="Compare Diff"
            emptyMessage="Select a file to inspect its diff."
          />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const fullContextButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Full Context'));
      expect(fullContextButton).toBeTruthy();
      fullContextButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockGetFullContextDiff).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain('full context failed');
    } finally {
      dispose();
    }
  });
});
