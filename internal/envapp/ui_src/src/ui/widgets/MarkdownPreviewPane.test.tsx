// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FilePreviewContextValue } from './FilePreviewContext';
import { FilePreviewContext } from './FilePreviewContext';
import { MarkdownPreviewPane } from './MarkdownPreviewPane';

vi.mock('../file-markdown/mermaidPlugin', () => ({
  setupMermaid: vi.fn(),
  runMermaid: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../file-markdown/postProcess', () => ({
  postProcess: vi.fn(),
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createPreviewContext(openPreview: FilePreviewContextValue['openPreview']): FilePreviewContextValue {
  const [open] = createSignal(false);
  const [item] = createSignal(null);
  const [descriptor] = createSignal({ mode: 'markdown' as const });
  const [empty] = createSignal('');
  const [boolFalse] = createSignal(false);
  const [nullValue] = createSignal(null);

  return {
    openPreview,
    closePreview: vi.fn(),
    controller: {
      open,
      item,
      descriptor,
      text: empty,
      draftText: empty,
      editing: boolFalse,
      dirty: boolFalse,
      saving: boolFalse,
      saveError: nullValue,
      selectedText: empty,
      canEdit: boolFalse,
      closeConfirmOpen: boolFalse,
      closeConfirmMessage: empty,
      message: empty,
      objectUrl: empty,
      bytes: nullValue,
      truncated: boolFalse,
      loading: boolFalse,
      error: nullValue,
      xlsxSheetName: empty,
      xlsxRows: () => [],
      downloadLoading: boolFalse,
      openPreview: vi.fn(async () => undefined),
      closePreview: vi.fn(),
      handleOpenChange: vi.fn(),
      cancelPendingAction: vi.fn(),
      confirmDiscardAndContinue: vi.fn(async () => undefined),
      beginEditing: vi.fn(),
      updateDraft: vi.fn(),
      updateSelection: vi.fn(),
      saveCurrent: vi.fn(async () => true),
      revertCurrent: vi.fn(),
      downloadCurrent: vi.fn(async () => undefined),
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('MarkdownPreviewPane', () => {
  it('routes relative file links through FilePreviewContext instead of app navigation', async () => {
    const openPreview = vi.fn(async () => undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.history.replaceState(null, '', '/_redeven_proxy/env/');

    const dispose = render(() => (
      <FilePreviewContext.Provider value={createPreviewContext(openPreview)}>
        <MarkdownPreviewPane
          path="/workspace/README.md"
          descriptor={{ mode: 'markdown' }}
          text={'| Item | Link |\n| --- | --- |\n| Review | [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md) |'}
        />
      </FilePreviewContext.Provider>
    ), host);

    try {
      await flushAsync();

      host.querySelector<HTMLAnchorElement>('a[href="docs/CAPABILITY_PERMISSIONS.md"]')?.click();

      expect(openPreview).toHaveBeenCalledWith({
        id: '/workspace/docs/CAPABILITY_PERMISSIONS.md',
        name: 'CAPABILITY_PERMISSIONS.md',
        path: '/workspace/docs/CAPABILITY_PERMISSIONS.md',
        type: 'file',
      }, {
        reusePolicy: 'same_file_or_create',
        focus: true,
        ensureVisible: true,
      });
      expect(window.location.pathname).toBe('/_redeven_proxy/env/');
    } finally {
      dispose();
    }
  });
});
