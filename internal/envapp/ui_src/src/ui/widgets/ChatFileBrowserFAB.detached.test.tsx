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

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Folder: (props: any) => <svg data-testid="folder-icon" class={props.class} />,
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => envState,
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

vi.mock('./PersistentFloatingWindow', () => ({
  PersistentFloatingWindow: (props: any) => (
    props.open
      ? (
        <div data-testid="floating-window" data-title={props.title}>
          {props.children}
        </div>
      )
      : null
  ),
}));

vi.mock('./RemoteFileBrowser', () => ({
  RemoteFileBrowser: () => <div data-testid="remote-file-browser" />,
}));

afterEach(() => {
  document.body.innerHTML = '';
  detachedSurfaceState.openDetachedSurfaceWindow.mockReset();
  controlplaneState.getLocalRuntime.mockClear();
  envState.localRuntime = () => null as any;
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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
    await flush();

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

    render(() => <ChatFileBrowserFAB workingDir="/workspace/project" homePath="/Users/demo" />, host);

    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement;
    clickFab(button);
    await flush();

    expect(detachedSurfaceState.openDetachedSurfaceWindow).not.toHaveBeenCalled();
    expect(controlplaneState.getLocalRuntime).toHaveBeenCalledTimes(1);
  });
});
