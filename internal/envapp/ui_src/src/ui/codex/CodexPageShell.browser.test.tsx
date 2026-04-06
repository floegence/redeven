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

function expectInsideRect(container: HTMLElement, button: HTMLButtonElement): void {
  const viewportBox = container.getBoundingClientRect();
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
  const [trackWidth, setTrackWidth] = createSignal(360);
  let requestSeq = 0;
  let trackRef: HTMLDivElement | undefined;

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

  const widenLane = (): void => {
    setTrackWidth(420);
  };

  return (
    <>
      <div class="codex-page-shell" style={{ width: '480px', height: '320px' }}>
        <div class="codex-page-main">
          <div class="codex-page-transcript">
            <div class="codex-page-transcript-viewport">
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
              <div class="codex-page-transcript-overlay">
                <div
                  ref={(element) => {
                    trackRef = element;
                  }}
                  class="codex-page-transcript-overlay-track"
                  data-codex-transcript-overlay-track="true"
                  style={{
                    width: `${trackWidth()}px`,
                    height: '100%',
                  }}
                >
                  <CodexFileBrowserFAB
                    workingDir="/workspace/ui"
                    homePath="/workspace"
                    containerRef={() => trackRef}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <button type="button" data-testid="switch-thread" onClick={switchThread}>
        Switch thread
      </button>
      <button type="button" data-testid="resize-lane" onClick={widenLane}>
        Resize lane
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
  it('keeps the transcript as a bounded manual scroll surface while the FAB stays pinned to the transcript lane', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);

    render(() => (
      <TranscriptViewportHarness initialRows={32} />
    ), host);
    await settle();

    const track = host.querySelector('[data-codex-transcript-overlay-track="true"]') as HTMLDivElement | null;
    const scrollRegion = host.querySelector('[data-codex-transcript-scroll-region="true"]') as HTMLDivElement | null;
    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement | null;

    expect(track).toBeTruthy();
    expect(scrollRegion).toBeTruthy();
    expect(button).toBeTruthy();
    expect(scrollRegion!.scrollHeight).toBeGreaterThan(scrollRegion!.clientHeight);

    scrollRegion!.scrollTop = 720;
    scrollRegion!.dispatchEvent(new Event('scroll'));
    await settle();

    expect(scrollRegion!.scrollTop).toBeGreaterThan(0);
    expectInsideRect(track!, button!);
  });

  it('realigns the FAB when the transcript lane width changes', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);

    render(() => (
      <TranscriptViewportHarness initialRows={12} />
    ), host);
    await settle();

    const track = host.querySelector('[data-codex-transcript-overlay-track="true"]') as HTMLDivElement | null;
    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement | null;
    const resizeButton = host.querySelector('[data-testid="resize-lane"]') as HTMLButtonElement | null;

    expect(track).toBeTruthy();
    expect(button).toBeTruthy();
    expect(resizeButton).toBeTruthy();

    const beforeTrackBox = track!.getBoundingClientRect();
    const beforeButtonBox = button!.getBoundingClientRect();
    expect(Math.abs(beforeButtonBox.right - (beforeTrackBox.right - 12))).toBeLessThanOrEqual(1);

    resizeButton!.click();
    await settle();
    await settle();

    const afterTrackBox = track!.getBoundingClientRect();
    const afterButtonBox = button!.getBoundingClientRect();
    expect(afterTrackBox.width).toBeGreaterThan(beforeTrackBox.width);
    expect(Math.abs(afterButtonBox.right - (afterTrackBox.right - 12))).toBeLessThanOrEqual(1);
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
