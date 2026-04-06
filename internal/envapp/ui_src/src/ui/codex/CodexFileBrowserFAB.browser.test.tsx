import '../../index.css';

import { page } from '@vitest/browser/context';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexFileBrowserFAB } from './CodexFileBrowserFAB';

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

vi.mock('../widgets/FileBrowserSurfaceContext', () => ({
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

function dispatchPointerTap(button: HTMLButtonElement): void {
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

describe('CodexFileBrowserFAB browser behavior', () => {
  it('stays visible and topmost while the shared browser surface is already open', async () => {
    fileBrowserSurfaceState.open.mockReturnValue(true);

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);
    let viewportRef: HTMLDivElement | undefined;

    render(() => (
      <div class="codex-page-shell" style={{ width: '480px', height: '320px' }}>
        <div
          ref={(element) => {
            viewportRef = element;
          }}
          class="codex-page-transcript-viewport"
          style={{ position: 'relative', width: '480px', height: '320px' }}
        >
          <div class="codex-page-transcript-main" style={{ width: '480px', height: '320px' }} />
          <CodexFileBrowserFAB
            workingDir="/workspace/ui"
            homePath="/workspace"
            containerRef={() => viewportRef}
          />
        </div>
      </div>
    ), host);
    await settle();

    const wrapper = host.querySelector('.codex-page-file-browser-fab') as HTMLDivElement | null;
    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement | null;
    const buttonLocator = page.getByTitle('Browse files');
    expect(wrapper).toBeTruthy();
    expect(button).toBeTruthy();
    expect(getComputedStyle(wrapper!).zIndex).toBe('46');
    await expect.element(buttonLocator).toBeVisible();
    dispatchPointerTap(button!);
    await settle();

    expect(fileBrowserSurfaceState.openBrowser).toHaveBeenCalledWith({
      path: '/workspace/ui',
      homePath: '/workspace',
    });
  });

  it('renders a visible disabled button when no usable path seed exists', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);
    let viewportRef: HTMLDivElement | undefined;

    render(() => (
      <div class="codex-page-shell" style={{ width: '480px', height: '320px' }}>
        <div
          ref={(element) => {
            viewportRef = element;
          }}
          class="codex-page-transcript-viewport"
          style={{ position: 'relative', width: '480px', height: '320px' }}
        >
          <div class="codex-page-transcript-main" style={{ width: '480px', height: '320px' }} />
          <CodexFileBrowserFAB
            workingDir=""
            homePath=""
            containerRef={() => viewportRef}
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

  it('stays inside the Codex transcript viewport after the transcript content scrolls', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);
    let viewportRef: HTMLDivElement | undefined;
    let scrollRef: HTMLDivElement | undefined;

    render(() => (
      <div class="codex-page-shell" style={{ width: '480px', height: '320px' }}>
        <div
          ref={(element) => {
            viewportRef = element;
          }}
          class="codex-page-transcript-viewport"
          style={{ position: 'relative', width: '480px', height: '320px' }}
        >
          <div
            ref={(element) => {
              scrollRef = element;
            }}
            class="codex-page-transcript-main"
            style={{ width: '480px', height: '320px', overflow: 'auto' }}
          >
            <div style={{ height: '2400px' }} />
          </div>
          <CodexFileBrowserFAB
            workingDir="/workspace/ui"
            homePath="/workspace"
            containerRef={() => viewportRef}
          />
        </div>
      </div>
    ), host);
    await settle();

    scrollRef!.scrollTop = 1800;
    scrollRef!.dispatchEvent(new Event('scroll'));
    await settle();

    const viewport = host.querySelector('.codex-page-transcript-viewport') as HTMLDivElement | null;
    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement | null;
    const viewportBox = viewport?.getBoundingClientRect();
    const buttonBox = button?.getBoundingClientRect();
    expect(viewportBox).toBeTruthy();
    expect(buttonBox).toBeTruthy();
    expect(buttonBox!.x).toBeGreaterThanOrEqual(viewportBox!.x);
    expect(buttonBox!.y).toBeGreaterThanOrEqual(viewportBox!.y);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(viewportBox!.x + viewportBox!.width);
    expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(viewportBox!.y + viewportBox!.height);
  });
});
