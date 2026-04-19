// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilePreviewHost } from './FilePreviewHost';

const openAskFlowerComposerMock = vi.fn();
const notificationErrorMock = vi.fn();

const filePreviewController = {
  open: () => true,
  handleOpenChange: vi.fn(),
  item: () => ({
    type: 'file',
    name: 'demo.txt',
    path: '/workspace/demo.txt',
    isDirectory: false,
  }),
  descriptor: () => null,
  text: () => 'file text',
  draftText: () => 'file text',
  editing: () => false,
  dirty: () => false,
  saving: () => false,
  saveError: () => null,
  canEdit: () => true,
  selectedText: () => '',
  closeConfirmOpen: () => false,
  closeConfirmMessage: () => '',
  cancelPendingAction: vi.fn(),
  confirmDiscardAndContinue: vi.fn(async () => undefined),
  beginEditing: vi.fn(),
  updateDraft: vi.fn(),
  updateSelection: vi.fn(),
  saveCurrent: vi.fn(async () => undefined),
  revertCurrent: vi.fn(),
  message: () => '',
  objectUrl: () => '',
  bytes: () => null,
  truncated: () => false,
  loading: () => false,
  error: () => null,
  xlsxSheetName: () => '',
  xlsxRows: () => [],
  downloadLoading: () => false,
  downloadCurrent: vi.fn(async () => undefined),
};

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => ({
    error: notificationErrorMock,
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    openAskFlowerComposer: openAskFlowerComposerMock,
  }),
}));

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    controller: filePreviewController,
    openPreview: vi.fn(async () => undefined),
    closePreview: vi.fn(),
  }),
}));

vi.mock('./FilePreviewSurface', () => ({
  FilePreviewSurface: (props: any) => (
    <button
      type="button"
      data-testid="ask-flower"
      onClick={() => props.onAskFlower('selected line')}
    >
      Ask Flower
    </button>
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FilePreviewHost', () => {
  it('opens Ask Flower directly from the floating preview host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <FilePreviewHost />, host);

    (host.querySelector('[data-testid="ask-flower"]') as HTMLButtonElement).click();

    expect(openAskFlowerComposerMock).toHaveBeenCalledTimes(1);
    expect(openAskFlowerComposerMock).toHaveBeenCalledWith(expect.objectContaining({
      source: 'file_preview',
      suggestedWorkingDirAbs: '/workspace',
      contextItems: [
        {
          kind: 'file_selection',
          path: '/workspace/demo.txt',
          selection: 'selected line',
          selectionChars: 'selected line'.length,
        },
      ],
    }));
    expect(notificationErrorMock).not.toHaveBeenCalled();
  });
});
