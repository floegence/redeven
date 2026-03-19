// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatFileBrowserFAB } from './ChatFileBrowserFAB';

const detachedSurfaceState = vi.hoisted(() => ({
  openDetachedSurfaceWindow: vi.fn(),
}));

const controlplaneState = vi.hoisted(() => ({
  getLocalRuntime: vi.fn(async () => null),
}));

const envState = {
  localRuntime: () => null as any,
};

vi.mock('solid-motionone', () => ({
  Motion: {
    div: (props: any) => <div>{props.children}</div>,
  },
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Folder: (props: any) => <svg data-testid="folder-icon" class={props.class} />,
}));

vi.mock('@floegence/floe-webapp-core/file-browser', () => ({
  FileBrowser: () => <div data-testid="file-browser" />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  ConfirmDialog: () => null,
  DirectoryPicker: () => null,
  Dialog: (props: any) => (props.open ? <div>{props.children}</div> : null),
  FileSavePicker: () => null,
  FloatingWindow: (props: any) => (props.open ? <div data-testid="floating-window">{props.children}</div> : null),
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: () => null,
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    client: () => ({}),
  }),
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => envState,
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    fs: {
      list: vi.fn(async () => ({ entries: [] })),
      delete: vi.fn(async () => ({ success: true })),
      rename: vi.fn(async () => ({ success: true, newPath: '/workspace/renamed.txt' })),
      copy: vi.fn(async () => ({ success: true, newPath: '/workspace/copy.txt' })),
    },
  }),
}));

vi.mock('../services/controlplaneApi', () => ({
  getLocalRuntime: controlplaneState.getLocalRuntime,
}));

vi.mock('../services/detachedSurface', async () => {
  const actual = await vi.importActual('../services/detachedSurface');
  return {
    ...actual,
    openDetachedSurfaceWindow: detachedSurfaceState.openDetachedSurfaceWindow,
  };
});

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    openPreview: vi.fn(async () => undefined),
  }),
}));

afterEach(() => {
  document.body.innerHTML = '';
  detachedSurfaceState.openDetachedSurfaceWindow.mockReset();
  controlplaneState.getLocalRuntime.mockClear();
  envState.localRuntime = () => null as any;
});

function clickFab(button: HTMLButtonElement): void {
  (button as any).setPointerCapture = vi.fn();
  (button as any).releasePointerCapture = vi.fn();

  const pointerDown = new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
  const pointerUp = new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperty(pointerUp, 'pointerId', { value: 1 });

  button.dispatchEvent(pointerDown);
  button.dispatchEvent(pointerUp);
}

describe('ChatFileBrowserFAB detached windows', () => {
  it('opens a detached desktop file browser instead of the in-app floating window', async () => {
    envState.localRuntime = () => ({ mode: 'local', env_public_id: 'env_demo', desktop_managed: true });
    (window as any).PointerEvent = window.MouseEvent;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <ChatFileBrowserFAB workingDir="/workspace" homePath="/Users/demo" />, host);

    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement;
    clickFab(button);
    await Promise.resolve();

    expect(detachedSurfaceState.openDetachedSurfaceWindow).toHaveBeenCalledWith({
      kind: 'file_browser',
      path: '/workspace',
      homePath: '/Users/demo',
    });
    expect(host.querySelector('[data-testid="floating-window"]')).toBeNull();
  });

  it('keeps detached-window promotion disabled outside desktop-managed runtime', async () => {
    (window as any).PointerEvent = window.MouseEvent;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <ChatFileBrowserFAB workingDir="/workspace" homePath="/Users/demo" />, host);

    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement;
    clickFab(button);
    await Promise.resolve();

    expect(detachedSurfaceState.openDetachedSurfaceWindow).not.toHaveBeenCalled();
    expect(controlplaneState.getLocalRuntime).toHaveBeenCalledTimes(1);
  });
});
