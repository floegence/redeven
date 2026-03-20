// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetachedSurfaceScene } from './DetachedSurfaceScene';

const openAskFlowerComposer = vi.fn();
const requestDesktopAskFlowerMainWindowHandoff = vi.hoisted(() => vi.fn(() => false));
const openPreview = vi.fn(async () => undefined);
const closePreview = vi.fn();
const downloadCurrent = vi.fn(async () => undefined);
const protocolState: {
  status: () => string;
  client: () => Record<string, never> | null;
} = {
  status: () => 'connected',
  client: () => ({}),
};

const previewItem = {
  id: '/workspace/demo.txt',
  name: 'demo.txt',
  path: '/workspace/demo.txt',
  type: 'file' as const,
};

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => ({
    error: vi.fn(),
  }),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" class={props.class} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => protocolState,
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    openAskFlowerComposer,
  }),
}));

vi.mock('../services/desktopAskFlowerBridge', () => ({
  requestDesktopAskFlowerMainWindowHandoff,
}));

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    controller: {
      openPreview,
      closePreview,
      downloadCurrent,
      item: () => previewItem,
      descriptor: () => ({ mode: 'text', textPresentation: 'plain', wrapText: true }),
      text: () => 'selected line',
      message: () => '',
      objectUrl: () => '',
      bytes: () => null,
      truncated: () => false,
      loading: () => false,
      error: () => null,
      xlsxSheetName: () => '',
      xlsxRows: () => [],
      downloadLoading: () => false,
    },
  }),
}));

vi.mock('./FilePreviewContent', () => ({
  FilePreviewContent: (props: any) => (
    <div data-testid="preview-content" ref={props.contentRef}>
      {props.item?.path}
    </div>
  ),
}));

vi.mock('./RemoteFileBrowser', () => ({
  RemoteFileBrowser: (props: any) => (
    <div
      data-testid="detached-file-browser"
      data-state-scope={props.stateScope}
      data-initial-path={props.initialPathOverride}
      data-home-path={props.homePathOverride}
    />
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
  openAskFlowerComposer.mockReset();
  requestDesktopAskFlowerMainWindowHandoff.mockReset();
  requestDesktopAskFlowerMainWindowHandoff.mockReturnValue(false);
  openPreview.mockClear();
  closePreview.mockClear();
  downloadCurrent.mockClear();
  protocolState.status = () => 'connected';
  protocolState.client = () => ({});
  vi.restoreAllMocks();
});

describe('DetachedSurfaceScene', () => {
  it('mounts a focused preview scene and routes actions through the shared preview controller', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_preview', path: '/workspace/demo.txt' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    expect(openPreview).toHaveBeenCalledWith(previewItem);
    expect(document.title).toBe('demo.txt - File Preview');

    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      toString: () => 'selected line',
      getRangeAt: () => ({ commonAncestorContainer: host.querySelector('[data-testid="preview-content"]') }) as unknown as Range,
    } as unknown as Selection);

    const buttons = Array.from(host.querySelectorAll('button'));
    buttons.find((button) => button.textContent?.includes('Ask Flower'))?.click();
    buttons.find((button) => button.textContent?.includes('Download'))?.click();

    expect(openAskFlowerComposer).toHaveBeenCalledTimes(1);
    expect(downloadCurrent).toHaveBeenCalledTimes(1);
  });

  it('prefers the desktop main-window handoff before falling back to the local composer', () => {
    requestDesktopAskFlowerMainWindowHandoff.mockReturnValue(true);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_preview', path: '/workspace/demo.txt' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      toString: () => 'selected line',
      getRangeAt: () => ({ commonAncestorContainer: host.querySelector('[data-testid="preview-content"]') }) as unknown as Range,
    } as unknown as Selection);

    const askFlowerButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Ask Flower'));
    askFlowerButton?.click();

    expect(requestDesktopAskFlowerMainWindowHandoff).toHaveBeenCalledWith({
      source: 'file_preview',
      path: '/workspace/demo.txt',
      selectionText: 'selected line',
    });
    expect(openAskFlowerComposer).not.toHaveBeenCalled();
  });

  it('renders the detached file browser scene with isolated state scope', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_browser', path: '/workspace', homePath: '/Users/demo' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    const scene = host.querySelector('[data-testid="detached-file-browser"]');
    expect(scene?.getAttribute('data-state-scope')).toBe('detached-surface');
    expect(scene?.getAttribute('data-initial-path')).toBe('/workspace');
    expect(scene?.getAttribute('data-home-path')).toBe('/Users/demo');
    expect(document.title).toBe('/workspace - File Browser');
  });

  it('waits for the shared protocol client before opening detached previews', () => {
    protocolState.status = () => 'connecting';
    protocolState.client = () => null;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_preview', path: '/workspace/demo.txt' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    expect(openPreview).not.toHaveBeenCalled();
  });
});
