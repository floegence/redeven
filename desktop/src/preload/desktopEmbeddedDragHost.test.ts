// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const originalIsMainFrame = (process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
}));

type ResizeObserverCallbackMock = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

function stubRect(
  element: Element,
  rect: Readonly<{ left: number; top: number; width: number; height: number }>,
): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => undefined,
    }),
  });
}

async function flushHostWork(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, 0);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('desktopEmbeddedDragHost preload', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    Object.defineProperty(process, 'isMainFrame', {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    delete window.redevenDesktopEmbeddedDragRegions;
    Object.defineProperty(process, 'isMainFrame', {
      configurable: true,
      value: originalIsMainFrame,
    });
  });

  it('projects iframe-relative drag regions into top-level overlay coordinates', async () => {
    const { projectDesktopEmbeddedDragRegions } = await import('./desktopEmbeddedDragHost');

    expect(projectDesktopEmbeddedDragRegions(
      { left: 10, top: 20, width: 400, height: 300 },
      {
        version: 1,
        regions: [
          { x: 64, y: 0, width: 200, height: 40 },
        ],
      },
    )).toEqual([
      { left: 74, top: 20, width: 200, height: 40 },
    ]);
  });

  it('renders drag overlays only after a valid drag snapshot and frame are both available', async () => {
    const resizeObserverCallbacks: ResizeObserverCallbackMock[] = [];
    const observedTargets: Element[] = [];
    const disconnectResizeObserver = vi.fn();

    const { installDesktopEmbeddedDragHost } = await import('./desktopEmbeddedDragHost');
    const host = installDesktopEmbeddedDragHost({
      createResizeObserver: (callback) => {
        resizeObserverCallbacks.push(callback);
        return {
          observe: (target) => {
            observedTargets.push(target);
          },
          disconnect: disconnectResizeObserver,
        };
      },
    });

    host.bridge.setSnapshot({
      version: 1,
      regions: [
        { x: 80, y: 0, width: 160, height: 40 },
      ],
    });
    await flushHostWork();
    expect(document.querySelector('[data-redeven-desktop-embedded-drag-overlay="true"]')).toBeNull();

    document.body.innerHTML = '<iframe id="app_frame"></iframe>';
    const frame = document.getElementById('app_frame') as HTMLIFrameElement;
    stubRect(frame, { left: 0, top: 0, width: 320, height: 200 });

    host.bridge.setSnapshot({
      version: 1,
      regions: [
        { x: 96, y: 0, width: 144, height: 40 },
      ],
    });
    await flushHostWork();

    expect(observedTargets).toEqual([frame]);
    expect(document.getElementById('redeven-desktop-embedded-drag-host')).toBeTruthy();

    const overlayRoot = document.querySelector('[data-redeven-desktop-embedded-drag-overlay="true"]') as HTMLElement | null;
    const overlay = overlayRoot?.querySelector('[data-redeven-desktop-embedded-drag-region="true"]') as HTMLElement | null;
    expect(overlayRoot).toBeTruthy();
    expect(overlay?.style.left).toBe('96px');
    expect(overlay?.style.width).toBe('144px');

    stubRect(frame, { left: 24, top: 12, width: 320, height: 200 });
    resizeObserverCallbacks[0]?.([] as ResizeObserverEntry[], {} as ResizeObserver);
    await flushHostWork();

    expect(overlayRoot?.querySelector('[data-redeven-desktop-embedded-drag-region="true"]')?.getAttribute('style'))
      .toContain('left: 120px;');

    host.clear();
    expect(overlayRoot?.children).toHaveLength(0);

    host.dispose();
    expect(disconnectResizeObserver).toHaveBeenCalled();
  });

  it('clears stale overlays when the embedded app frame is replaced', async () => {
    document.body.innerHTML = '<iframe id="app_frame" src="/first"></iframe>';
    const firstFrame = document.getElementById('app_frame') as HTMLIFrameElement;
    stubRect(firstFrame, { left: 0, top: 0, width: 320, height: 200 });

    const { installDesktopEmbeddedDragHost } = await import('./desktopEmbeddedDragHost');
    const host = installDesktopEmbeddedDragHost({
      createResizeObserver: () => null,
    });

    host.bridge.setSnapshot({
      version: 1,
      regions: [
        { x: 80, y: 0, width: 160, height: 40 },
      ],
    });
    await flushHostWork();

    let overlayRoot = document.querySelector('[data-redeven-desktop-embedded-drag-overlay="true"]') as HTMLElement | null;
    expect(overlayRoot?.children).toHaveLength(1);

    document.body.innerHTML = '<iframe id="app_frame" src="/second"></iframe>';
    const secondFrame = document.getElementById('app_frame') as HTMLIFrameElement;
    stubRect(secondFrame, { left: 12, top: 16, width: 320, height: 200 });
    await flushHostWork();

    overlayRoot = document.querySelector('[data-redeven-desktop-embedded-drag-overlay="true"]') as HTMLElement | null;
    expect(overlayRoot?.children.length ?? 0).toBe(0);

    host.bridge.setSnapshot({
      version: 1,
      regions: [
        { x: 60, y: 0, width: 180, height: 40 },
      ],
    });
    await flushHostWork();

    overlayRoot = document.querySelector('[data-redeven-desktop-embedded-drag-overlay="true"]') as HTMLElement | null;
    const overlay = overlayRoot?.querySelector('[data-redeven-desktop-embedded-drag-region="true"]') as HTMLElement | null;
    expect(overlay?.style.left).toBe('72px');
    expect(overlay?.style.top).toBe('16px');
    host.dispose();
  });

  it('renders drag overlays only when an embedded app frame exists', async () => {
    const { installDesktopEmbeddedDragHost } = await import('./desktopEmbeddedDragHost');
    const host = installDesktopEmbeddedDragHost();
    host.bridge.setSnapshot({
      version: 1,
      regions: [
        { x: 80, y: 0, width: 160, height: 40 },
      ],
    });
    await flushHostWork();
    expect(document.querySelector('[data-redeven-desktop-embedded-drag-overlay="true"]')).toBeNull();

    document.body.innerHTML = '<iframe id="app_frame"></iframe>';
    const frame = document.getElementById('app_frame') as HTMLIFrameElement;
    stubRect(frame, { left: 0, top: 0, width: 320, height: 200 });
    host.refresh();
    const overlayRoot = document.querySelector('[data-redeven-desktop-embedded-drag-overlay="true"]') as HTMLElement | null;
    expect(overlayRoot).toBeTruthy();

    host.clear();
    expect(overlayRoot?.children).toHaveLength(0);
    host.dispose();
  });

  it('exposes the desktop embedded drag bridge and renders overlays above the iframe', async () => {
    document.body.innerHTML = '<iframe id="app_frame"></iframe>';
    const frame = document.getElementById('app_frame') as HTMLIFrameElement;
    stubRect(frame, { left: 0, top: 0, width: 320, height: 200 });

    const { bootstrapDesktopEmbeddedDragHostBridge } = await import('./desktopEmbeddedDragHost');

    bootstrapDesktopEmbeddedDragHostBridge();

    const [, bridge] = exposeInMainWorld.mock.calls.find(([name]) => name === 'redevenDesktopEmbeddedDragRegions') ?? [];
    expect(bridge).toBeTruthy();

    bridge.setSnapshot({
      version: 1,
      regions: [
        { x: 80, y: 0, width: 160, height: 40 },
      ],
    });

    await flushHostWork();

    const overlayRoot = document.querySelector('[data-redeven-desktop-embedded-drag-overlay="true"]') as HTMLElement | null;
    expect(overlayRoot).toBeTruthy();
    const overlay = overlayRoot?.querySelector('[data-redeven-desktop-embedded-drag-region="true"]') as HTMLElement | null;
    expect(overlay).toBeTruthy();
    expect(overlay?.style.left).toBe('80px');
    expect(overlay?.style.width).toBe('160px');

    bridge.clear();
    expect(overlayRoot?.children).toHaveLength(0);
  });

  it('does not expose a top-level drag bridge from iframe preloads', async () => {
    Object.defineProperty(process, 'isMainFrame', {
      configurable: true,
      value: false,
    });

    const { bootstrapDesktopEmbeddedDragHostBridge } = await import('./desktopEmbeddedDragHost');
    bootstrapDesktopEmbeddedDragHostBridge();

    expect(exposeInMainWorld).not.toHaveBeenCalled();
  });
});
