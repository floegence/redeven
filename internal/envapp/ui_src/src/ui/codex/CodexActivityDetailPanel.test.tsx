// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexActivityDetailPanel } from './CodexActivityDetailPanel';
import type { CodexActivityDetailRef } from './transcriptDisplayModel';
import type { CodexTranscriptItem } from './types';

vi.mock('@floegence/floe-webapp-core', async () => {
  const actual = await vi.importActual<typeof import('@floegence/floe-webapp-core')>('@floegence/floe-webapp-core');
  return {
    ...actual,
    useLayout: () => ({
      isMobile: () => false,
    }),
    useNotification: () => ({
      error: vi.fn(),
    }),
  };
});

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

describe('CodexActivityDetailPanel', () => {
  it('updates the displayed file diff when the detail changeIndex changes', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const item: CodexTranscriptItem = {
      id: 'item_multi_file_change',
      type: 'fileChange',
      changes: [
        {
          path: 'src/ui/codex/FirstChangedFile.tsx',
          kind: 'modified',
          diff: [
            'diff --git a/src/ui/codex/FirstChangedFile.tsx b/src/ui/codex/FirstChangedFile.tsx',
            '--- a/src/ui/codex/FirstChangedFile.tsx',
            '+++ b/src/ui/codex/FirstChangedFile.tsx',
            '@@ -1 +1 @@',
            '-const first = "old";',
            '+const first = "new";',
          ].join('\n'),
        },
        {
          path: 'src/ui/codex/SecondChangedFile.tsx',
          kind: 'modified',
          diff: [
            'diff --git a/src/ui/codex/SecondChangedFile.tsx b/src/ui/codex/SecondChangedFile.tsx',
            '--- a/src/ui/codex/SecondChangedFile.tsx',
            '+++ b/src/ui/codex/SecondChangedFile.tsx',
            '@@ -1 +1 @@',
            '-const second = "old";',
            '+const second = "new";',
          ].join('\n'),
        },
      ],
      order: 0,
    };
    const [detail, setDetail] = createSignal<CodexActivityDetailRef>({
      type: 'file_diff',
      sourceItemID: item.id,
      changeIndex: 0,
    });

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <CodexActivityDetailPanel detail={detail()} item={item} onClose={() => undefined} />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('FirstChangedFile.tsx');
      expect(host.textContent).toContain('+const first = "new";');

      setDetail({
        type: 'file_diff',
        sourceItemID: item.id,
        changeIndex: 1,
      });
      await Promise.resolve();

      expect(host.textContent).toContain('SecondChangedFile.tsx');
      expect(host.textContent).toContain('+const second = "new";');
      expect(host.textContent).not.toContain('+const first = "new";');
    } finally {
      dispose();
    }
  });
});
