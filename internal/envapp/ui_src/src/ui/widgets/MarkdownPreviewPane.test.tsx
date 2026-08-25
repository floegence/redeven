// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FilePreviewContextValue } from './FilePreviewContext';
import { FilePreviewContext } from './FilePreviewContext';
import { MarkdownPreviewPane } from './MarkdownPreviewPane';
import { MARKDOWN_PREVIEW_TEXT_SCALE_STORAGE_KEY } from '../services/markdownPreviewPreferences';
import { readUIStorageItem, removeUIStorageItem } from '../services/uiStorage';

vi.mock('../file-markdown/mermaidPlugin', () => ({
  resolveMermaidThemeContext: vi.fn(() => ({
    key: 'classic-light|light',
    mode: 'light',
    preset: 'classic-light',
    variables: {},
  })),
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
      resourceUrl: empty,
      bytes: nullValue,
      truncated: boolFalse,
      loading: boolFalse,
      error: nullValue,
      xlsxSheetName: empty,
      xlsxRows: () => [],
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
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  removeUIStorageItem(MARKDOWN_PREVIEW_TEXT_SCALE_STORAGE_KEY);
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
          text={'| Item | Link |\n| --- | --- |\n| Review | [`SECURITY_NOTES.md`](SECURITY_NOTES.md) |'}
        />
      </FilePreviewContext.Provider>
    ), host);

    try {
      await flushAsync();

      host.querySelector<HTMLAnchorElement>('a[href="SECURITY_NOTES.md"]')?.click();

      expect(openPreview).toHaveBeenCalledWith({
        id: '/workspace/SECURITY_NOTES.md',
        name: 'SECURITY_NOTES.md',
        path: '/workspace/SECURITY_NOTES.md',
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

  it('keeps all mounted markdown previews in sync and persists the selected size', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const context = createPreviewContext(vi.fn(async () => undefined));

    const dispose = render(() => (
      <FilePreviewContext.Provider value={context}>
        <MarkdownPreviewPane
          path="/workspace/first.md"
          descriptor={{ mode: 'markdown' }}
          text="# First"
        />
        <MarkdownPreviewPane
          path="/workspace/second.md"
          descriptor={{ mode: 'markdown' }}
          text="# Second"
        />
      </FilePreviewContext.Provider>
    ), host);

    try {
      await flushAsync();

      const increaseButtons = host.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Increase text size"]',
      );
      expect(increaseButtons.length).toBeGreaterThanOrEqual(2);
      increaseButtons[0]?.click();
      await flushAsync();

      const values = Array.from(host.querySelectorAll<HTMLElement>('.fm-text-size-value'));
      expect(values.length).toBeGreaterThanOrEqual(2);
      expect(values.every((value) => value.textContent === '110%')).toBe(true);
      expect(readUIStorageItem(MARKDOWN_PREVIEW_TEXT_SCALE_STORAGE_KEY)).toBe('110');

      values[0]?.click();
      await flushAsync();
      expect(values.every((value) => value.textContent === '100%')).toBe(true);
    } finally {
      dispose();
    }
  });
});
