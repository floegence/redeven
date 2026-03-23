// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatFileBrowserFAB } from './ChatFileBrowserFAB';

const fileBrowserSurfaceState = vi.hoisted(() => ({
  openBrowser: vi.fn(async () => undefined),
  open: vi.fn(() => false),
}));

vi.mock('solid-motionone', () => ({
  Motion: {
    div: (props: any) => <div>{props.children}</div>,
  },
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Folder: (props: any) => <svg data-testid="folder-icon" class={props.class} />,
}));

vi.mock('./FileBrowserSurfaceContext', () => ({
  useFileBrowserSurfaceContext: () => ({
    controller: {
      open: fileBrowserSurfaceState.open,
    },
    openBrowser: fileBrowserSurfaceState.openBrowser,
    closeBrowser: vi.fn(),
  }),
}));

afterEach(() => {
  document.body.innerHTML = '';
  fileBrowserSurfaceState.openBrowser.mockReset();
  fileBrowserSurfaceState.open.mockReset();
  fileBrowserSurfaceState.open.mockReturnValue(false);
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

describe('ChatFileBrowserFAB', () => {
  it('routes a click through the shared file-browser opener', async () => {
    (window as any).PointerEvent = window.MouseEvent;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <ChatFileBrowserFAB workingDir="/workspace" homePath="/Users/demo" />, host);

    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement;
    clickFab(button);
    await flush();

    expect(fileBrowserSurfaceState.openBrowser).toHaveBeenCalledWith({
      path: '/workspace',
      homePath: '/Users/demo',
    });
  });

  it('hides the FAB while the shared browser surface is already open', () => {
    fileBrowserSurfaceState.open.mockReturnValue(true);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <ChatFileBrowserFAB workingDir="/workspace/project" homePath="/Users/demo" />, host);

    expect(host.querySelector('button[title="Browse files"]')).toBeNull();
  });
});
