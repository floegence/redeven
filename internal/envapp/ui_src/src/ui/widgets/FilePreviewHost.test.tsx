// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openFilePreviewWindow } from '../services/filePreviewWindow';
import { FilePreviewDocument, FilePreviewHost } from './FilePreviewHost';

vi.mock('../services/filePreviewWindow', () => ({ openFilePreviewWindow: vi.fn(async () => undefined) }));

const openFlowerTurnLauncherMock = vi.fn();
const notificationErrorMock = vi.fn();
const enqueueDownloadMock = vi.fn();

const filePreviewController = {
  open: () => true,
  handleOpenChange: vi.fn(),
  item: () => ({
    type: 'file',
    name: 'demo.txt',
    path: '/workspace/demo.txt',
    isDirectory: false,
  }),
  descriptor: () => ({ mode: 'text' }),
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
  resourceUrl: () => '',
  bytes: () => null,
  truncated: () => false,
  loading: () => false,
  error: () => null,
};

vi.mock('@floegence/floe-webapp-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core')>(),
  useNotification: () => ({
    error: notificationErrorMock,
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    openFlowerTurnLauncher: openFlowerTurnLauncherMock,
  }),
}));

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    controller: filePreviewController,
    openPreview: vi.fn(async () => undefined),
    closePreview: vi.fn(),
  }),
}));

vi.mock('../downloads/DownloadContext', () => ({
  useDownloadManager: () => ({
    enqueue: enqueueDownloadMock,
  }),
}));

vi.mock('./FilePreviewSurface', () => ({
  FilePreviewSurface: (props: any) => (
    <div>
      <button data-testid="popout" onClick={props.onOpenSeparately}>Open separately</button>
      <button
        type="button"
        data-testid="ask-flower"
        disabled={!props.onAskFlower}
        onClick={() => props.onAskFlower?.('selected line', { x: 820, y: 520 })}
      >
        Ask Flower
      </button>
      <button
        type="button"
        data-testid="download"
        onClick={() => props.onDownload()}
      >
        Download
      </button>
    </div>
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  filePreviewController.dirty = () => false;
  filePreviewController.saving = () => false;
  filePreviewController.loading = () => false;
  vi.mocked(openFilePreviewWindow).mockResolvedValue(undefined);
});

describe('FilePreviewHost', () => {
  it('keeps Ask Flower available in separate file previews', () => {
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <FilePreviewDocument controller={filePreviewController as any} standalone />, host);
    try {
      const ask = host.querySelector<HTMLButtonElement>('[data-testid="ask-flower"]')!;
      expect(ask.disabled).toBe(false); ask.click();
      expect(openFlowerTurnLauncherMock).toHaveBeenCalledWith(expect.objectContaining({ source_surface: 'file_preview', context_items: [{ kind: 'file_path', path: '/workspace/demo.txt', is_directory: false }] }), { x: 820, y: 520 });
    } finally { dispose(); }
  });
  it.each(['dirty', 'saving', 'loading'] as const)('protects the original preview while %s', state => {
    filePreviewController[state] = () => true;
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <FilePreviewHost />, host);
    try {
      (host.querySelector('[data-testid="popout"]') as HTMLButtonElement).click();
      expect(openFilePreviewWindow).not.toHaveBeenCalled();
      expect(filePreviewController.confirmDiscardAndContinue).not.toHaveBeenCalled();
      expect(filePreviewController.handleOpenChange).not.toHaveBeenCalled();
      if (state === 'dirty') expect(notificationErrorMock).toHaveBeenCalledWith('Open separately', 'Save your changes before opening a separate preview.');
    } finally { dispose(); }
  });
  it('opens the current file once and retains the original preview', async () => {
    let resolve!: () => void;
    vi.mocked(openFilePreviewWindow).mockReturnValue(new Promise<void>(done => { resolve = done; }));
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <FilePreviewHost />, host);
    try {
      const button = host.querySelector<HTMLButtonElement>('[data-testid="popout"]')!;
      button.click(); button.click(); expect(openFilePreviewWindow).toHaveBeenCalledOnce();
      expect(openFilePreviewWindow).toHaveBeenCalledWith('/workspace/demo.txt', expect.any(Object));
      expect(filePreviewController.handleOpenChange).not.toHaveBeenCalled(); resolve(); await Promise.resolve();
    } finally { dispose(); }
  });
  it('reports native failure without closing the original document', async () => {
    vi.mocked(openFilePreviewWindow).mockRejectedValue(new Error('Native open failed'));
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <FilePreviewHost />, host);
    try {
      host.querySelector<HTMLButtonElement>('[data-testid="popout"]')!.click(); await Promise.resolve();
      expect(notificationErrorMock).toHaveBeenCalledWith('Could not open the preview', 'Native open failed');
      expect(filePreviewController.handleOpenChange).not.toHaveBeenCalled();
    } finally { dispose(); }
  });
  it('opens Ask Flower directly from the floating preview host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <FilePreviewHost />, host);

    (host.querySelector('[data-testid="ask-flower"]') as HTMLButtonElement).click();

    expect(openFlowerTurnLauncherMock).toHaveBeenCalledTimes(1);
    expect(openFlowerTurnLauncherMock).toHaveBeenCalledWith(expect.objectContaining({
      source_surface: 'file_preview',
      suggested_working_dir: '/workspace',
      context_items: [
        {
          kind: 'file_path',
          path: '/workspace/demo.txt',
          is_directory: false,
        },
      ],
      pending_attachments: [],
    }), { x: 820, y: 520 });
    expect(notificationErrorMock).not.toHaveBeenCalled();
  });

  it('submits preview downloads to the shared download manager', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <FilePreviewHost />, host);

    (host.querySelector('[data-testid="download"]') as HTMLButtonElement).click();

    expect(enqueueDownloadMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'file_preview',
      source: expect.objectContaining({
        kind: 'runtime_file',
        path: '/workspace/demo.txt',
        name: 'demo.txt',
      }),
    }));
  });
});
