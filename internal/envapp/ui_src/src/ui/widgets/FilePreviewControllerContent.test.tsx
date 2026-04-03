// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewControllerContent } from './FilePreviewControllerContent';

const capturedProps = vi.hoisted(() => ({ current: null as any }));

vi.mock('./FilePreviewContent', () => ({
  FilePreviewContent: (props: any) => {
    capturedProps.current = props;
    const marker = document.createElement('div');
    props.contentRef?.(marker);
    return <div data-testid="file-preview-controller-content">{props.item?.path}</div>;
  },
}));

afterEach(() => {
  capturedProps.current = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('FilePreviewControllerContent', () => {
  it('passes the controller edit state and handlers through to FilePreviewContent', async () => {
    const beginEditing = vi.fn();
    const updateDraft = vi.fn();
    const updateSelection = vi.fn();
    const saveCurrent = vi.fn(async () => true);
    const revertCurrent = vi.fn();
    const onCopyPath = vi.fn(async () => true);
    const contentRef = vi.fn();
    const controller = {
      open: () => true,
      item: () => ({ id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' as const }),
      descriptor: () => ({ mode: 'text', textPresentation: 'code', language: 'typescript', wrapText: false }),
      text: () => 'const value = 1;\n',
      draftText: () => 'const value = 2;\n',
      editing: () => true,
      dirty: () => true,
      saving: () => false,
      saveError: () => 'save failed',
      selectedText: () => 'const value = 2;',
      canEdit: () => true,
      closeConfirmOpen: () => false,
      closeConfirmMessage: () => '',
      message: () => 'preview message',
      objectUrl: () => '',
      bytes: () => null,
      truncated: () => false,
      loading: () => false,
      error: () => null,
      xlsxSheetName: () => '',
      xlsxRows: () => [],
      downloadLoading: () => false,
      openPreview: vi.fn(async () => undefined),
      closePreview: vi.fn(),
      handleOpenChange: vi.fn(),
      cancelPendingAction: vi.fn(),
      confirmDiscardAndContinue: vi.fn(async () => undefined),
      beginEditing,
      updateDraft,
      updateSelection,
      saveCurrent,
      revertCurrent,
      downloadCurrent: vi.fn(async () => undefined),
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewControllerContent
        controller={controller as any}
        onCopyPath={onCopyPath}
        showHeader={false}
        contentRef={contentRef}
      />
    ), host);

    expect(host.querySelector('[data-testid="file-preview-controller-content"]')).toBeTruthy();
    expect(capturedProps.current.item.path).toBe('/workspace/demo.ts');
    expect(capturedProps.current.draftText).toBe('const value = 2;\n');
    expect(capturedProps.current.editing).toBe(true);
    expect(capturedProps.current.dirty).toBe(true);
    expect(capturedProps.current.saveError).toBe('save failed');
    expect(capturedProps.current.canEdit).toBe(true);
    expect(capturedProps.current.message).toBe('preview message');
    expect(capturedProps.current.onCopyPath).toBe(onCopyPath);
    expect(capturedProps.current.showHeader).toBe(false);
    expect(contentRef).toHaveBeenCalledTimes(1);

    capturedProps.current.onStartEdit?.();
    capturedProps.current.onDraftChange?.('const value = 3;\n');
    capturedProps.current.onSelectionChange?.('value = 3');
    capturedProps.current.onDiscard?.();
    await capturedProps.current.onSave?.();

    expect(beginEditing).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith('const value = 3;\n');
    expect(updateSelection).toHaveBeenCalledWith('value = 3');
    expect(revertCurrent).toHaveBeenCalledTimes(1);
    expect(saveCurrent).toHaveBeenCalledTimes(1);
  });
});
