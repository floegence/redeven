// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitPatchViewer, type GitPatchRenderable } from './GitPatchViewer';

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

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

describe('GitPatchViewer', () => {
  it('supports embedded reuse without the copy action and with custom viewport sizing', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <GitPatchViewer
            item={{
              changeType: 'added',
              path: 'src/example.ts',
              displayPath: 'src/example.ts',
              additions: 2,
              deletions: 0,
              patchText: [
                'diff --git a/src/example.ts b/src/example.ts',
                'new file mode 100644',
                '--- /dev/null',
                '+++ b/src/example.ts',
                '@@ -0,0 +1,2 @@',
                '+export const value = 1;',
                '+export const next = 2;',
              ].join('\n'),
            }}
            emptyMessage="No patch"
            showCopyButton={false}
            showMobileHint={false}
            desktopPatchViewportClass="max-h-[22rem]"
            mobilePatchViewportClass="max-h-none"
          />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(document.body.textContent).toContain('Added');
      expect(document.body.textContent).toContain('+2 / −0');
      expect(document.body.textContent).toContain('src/example.ts');
      expect(document.body.textContent).toContain('+export const value = 1;');
      expect(document.body.textContent).not.toContain('Copy Patch');
      expect(Array.from(document.querySelectorAll('div')).some((node) => node.className.includes('max-h-[22rem]'))).toBe(true);
    } finally {
      dispose();
    }
  });

  it('updates the rendered patch when the item prop changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [item, setItem] = createSignal<GitPatchRenderable>({
      changeType: 'modified',
      path: 'src/first.ts',
      displayPath: 'src/first.ts',
      additions: 1,
      deletions: 1,
      patchText: [
        'diff --git a/src/first.ts b/src/first.ts',
        '--- a/src/first.ts',
        '+++ b/src/first.ts',
        '@@ -1 +1 @@',
        '-export const first = "old";',
        '+export const first = "new";',
      ].join('\n'),
    });

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <GitPatchViewer
            item={item()}
            emptyMessage="No patch"
            showCopyButton={false}
            showMobileHint={false}
          />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('src/first.ts');
      expect(host.textContent).toContain('+export const first = "new";');

      setItem({
        changeType: 'modified',
        path: 'src/second.ts',
        displayPath: 'src/second.ts',
        additions: 1,
        deletions: 1,
        patchText: [
          'diff --git a/src/second.ts b/src/second.ts',
          '--- a/src/second.ts',
          '+++ b/src/second.ts',
          '@@ -1 +1 @@',
          '-export const second = "old";',
          '+export const second = "new";',
        ].join('\n'),
      });
      await Promise.resolve();

      expect(host.textContent).toContain('src/second.ts');
      expect(host.textContent).toContain('+export const second = "new";');
      expect(host.textContent).not.toContain('+export const first = "new";');
    } finally {
      dispose();
    }
  });
});
