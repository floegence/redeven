import '../../index.css';

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

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function clickFab(button: HTMLButtonElement): void {
  (button as any).setPointerCapture = vi.fn();
  (button as any).releasePointerCapture = vi.fn();

  const pointerDown = new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 });
  Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
  const pointerUp = new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, button: 0 });
  Object.defineProperty(pointerUp, 'pointerId', { value: 1 });

  button.dispatchEvent(pointerDown);
  button.dispatchEvent(pointerUp);
}

afterEach(() => {
  document.body.innerHTML = '';
  fileBrowserSurfaceState.openBrowser.mockReset();
  fileBrowserSurfaceState.open.mockReset();
  fileBrowserSurfaceState.open.mockReturnValue(false);
});

describe('ChatFileBrowserFAB browser behavior', () => {
  it('stays visible above the Codex page while the shared browser surface is open', async () => {
    fileBrowserSurfaceState.open.mockReturnValue(true);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <div class="codex-page-shell">
        <div class="codex-page-transcript-main" style={{ width: '480px', height: '320px' }}>
          <ChatFileBrowserFAB
            workingDir="/workspace/ui"
            homePath="/workspace"
            persistentVisible
            class="codex-page-file-browser-fab"
          />
        </div>
      </div>
    ), host);
    await settle();

    const wrapper = host.querySelector('.codex-page-file-browser-fab') as HTMLDivElement | null;
    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement | null;
    expect(wrapper).toBeTruthy();
    expect(button).toBeTruthy();
    expect(getComputedStyle(wrapper!).zIndex).toBe('46');

    clickFab(button!);
    await settle();

    expect(fileBrowserSurfaceState.openBrowser).toHaveBeenCalledWith({
      path: '/workspace/ui',
      homePath: '/workspace',
    });
  });

  it('renders a visible disabled button when persistent mode has no usable path seed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <div class="codex-page-shell">
        <div class="codex-page-transcript-main" style={{ width: '480px', height: '320px' }}>
          <ChatFileBrowserFAB
            workingDir=""
            homePath=""
            persistentVisible
            class="codex-page-file-browser-fab"
          />
        </div>
      </div>
    ), host);
    await settle();

    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    expect(button?.disabled).toBe(true);
    expect(getComputedStyle(button!).cursor).toBe('not-allowed');
  });
});
