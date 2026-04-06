// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitPatchViewer } from './GitPatchViewer';

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
});
