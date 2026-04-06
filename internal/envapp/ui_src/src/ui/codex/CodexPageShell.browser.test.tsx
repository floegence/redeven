import '../../index.css';

import { createEffect, createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFollowBottomController,
  type FollowBottomRequest,
} from '../chat/scroll/createFollowBottomController';
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

function expectInsideViewport(viewport: HTMLDivElement, button: HTMLButtonElement): void {
  const viewportBox = viewport.getBoundingClientRect();
  const buttonBox = button.getBoundingClientRect();
  expect(buttonBox.x).toBeGreaterThanOrEqual(viewportBox.x);
  expect(buttonBox.y).toBeGreaterThanOrEqual(viewportBox.y);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);
}

function TranscriptViewportHarness(props: Readonly<{
  initialRows: number;
  switchedRows?: number;
}>) {
  const [rowCount, setRowCount] = createSignal(props.initialRows);
  const [scrollRequest, setScrollRequest] = createSignal<FollowBottomRequest | null>(null);
  let requestSeq = 0;
  let viewportRef: HTMLDivElement | undefined;

  const followBottomController = createFollowBottomController();

  onCleanup(() => {
    followBottomController.dispose();
  });

  createEffect(() => {
    const nextRequest = scrollRequest();
    if (!nextRequest) return;
    followBottomController.requestFollowBottom(nextRequest);
  });

  const switchThread = (): void => {
    requestSeq += 1;
    setRowCount(props.switchedRows ?? props.initialRows);
    setScrollRequest({
      seq: requestSeq,
      reason: 'thread_switch',
      source: 'system',
      behavior: 'auto',
    });
  };

  return (
    <>
      <div class="codex-page-shell" style={{ width: '480px', height: '320px' }}>
        <div class="codex-page-main">
          <div class="codex-page-transcript">
            <div
              ref={(element) => {
                viewportRef = element;
              }}
              class="codex-page-transcript-viewport"
            >
              <div
                ref={(element) => {
                  followBottomController.setScrollContainer(element);
                }}
                class="codex-page-transcript-main"
                data-codex-transcript-scroll-region="true"
                onScroll={followBottomController.handleScroll}
              >
                <div ref={followBottomController.setContentRoot}>
                  {Array.from({ length: rowCount() }, (_, index) => (
                    <div
                      class="codex-transcript-row"
                      data-follow-bottom-anchor-id={`item:${index + 1}`}
                      style={{
                        height: '96px',
                        'box-sizing': 'border-box',
                        border: '1px solid transparent',
                      }}
                    >
                      Row {index + 1}
                    </div>
                  ))}
                </div>
              </div>
              <CodexFileBrowserFAB
                workingDir="/workspace/ui"
                homePath="/workspace"
                containerRef={() => viewportRef}
              />
            </div>
          </div>
        </div>
      </div>

      <button type="button" data-testid="switch-thread" onClick={switchThread}>
        Switch thread
      </button>
    </>
  );
}

afterEach(() => {
  document.body.innerHTML = '';
  fileBrowserSurfaceState.openBrowser.mockReset();
  fileBrowserSurfaceState.open.mockReset();
  fileBrowserSurfaceState.open.mockReturnValue(false);
});

describe('CodexPageShell browser layout behavior', () => {
  it('keeps the transcript as a bounded manual scroll surface while the FAB stays pinned in the viewport', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);

    render(() => (
      <TranscriptViewportHarness initialRows={32} />
    ), host);
    await settle();

    const viewport = host.querySelector('.codex-page-transcript-viewport') as HTMLDivElement | null;
    const scrollRegion = host.querySelector('[data-codex-transcript-scroll-region="true"]') as HTMLDivElement | null;
    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement | null;

    expect(viewport).toBeTruthy();
    expect(scrollRegion).toBeTruthy();
    expect(button).toBeTruthy();
    expect(scrollRegion!.scrollHeight).toBeGreaterThan(scrollRegion!.clientHeight);

    scrollRegion!.scrollTop = 720;
    scrollRegion!.dispatchEvent(new Event('scroll'));
    await settle();

    expect(scrollRegion!.scrollTop).toBeGreaterThan(0);
    expectInsideViewport(viewport!, button!);
  });

  it('lands on the latest output after a thread-switch follow-bottom request in the real browser layout', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);

    render(() => (
      <TranscriptViewportHarness initialRows={2} switchedRows={32} />
    ), host);
    await settle();

    const scrollRegion = host.querySelector('[data-codex-transcript-scroll-region="true"]') as HTMLDivElement | null;
    const switchButton = host.querySelector('[data-testid="switch-thread"]') as HTMLButtonElement | null;

    expect(scrollRegion).toBeTruthy();
    expect(switchButton).toBeTruthy();
    expect(scrollRegion!.scrollTop).toBe(0);

    switchButton!.click();
    await settle();
    await settle();

    const expectedBottom = scrollRegion!.scrollHeight - scrollRegion!.clientHeight;
    expect(expectedBottom).toBeGreaterThan(0);
    expect(Math.abs(scrollRegion!.scrollTop - expectedBottom)).toBeLessThanOrEqual(1);
  });
});
