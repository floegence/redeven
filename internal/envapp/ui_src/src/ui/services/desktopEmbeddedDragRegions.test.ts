// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDesktopEmbeddedDragRegionSnapshot,
  installDesktopEmbeddedDragRegionSync,
  subtractDesktopEmbeddedDragRegionRect,
} from './desktopEmbeddedDragRegions';

const originalParent = window.parent;
const originalTop = window.top;

type FakeWindow = Window & {
  location: { origin: string };
  parent: Window;
  top: Window;
  redevenDesktopEmbeddedDragRegions?: unknown;
};

type FakeSyncWindow = FakeWindow & {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
  setTimeout: Window['setTimeout'];
  clearTimeout: Window['clearTimeout'];
  addEventListener: Window['addEventListener'];
  removeEventListener: Window['removeEventListener'];
};

function createFakeWindow(origin = window.location.origin): FakeWindow {
  const fake = {
    location: { origin },
  } as FakeWindow;
  fake.parent = fake;
  fake.top = fake;
  return fake;
}

function createFakeSyncWindow(origin = window.location.origin): {
  currentWindow: FakeSyncWindow;
  frameCallbacks: FrameRequestCallback[];
} {
  const frameCallbacks: FrameRequestCallback[] = [];
  const currentWindow = Object.assign(createFakeWindow(origin), {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }),
    cancelAnimationFrame: vi.fn(),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as FakeSyncWindow;
  return { currentWindow, frameCallbacks };
}

function setWindowHierarchy(parent: Window, top: Window = parent): void {
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: parent,
  });
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: top,
  });
}

function stubRect(
  element: Element,
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
    }),
  });
}

function flushNextFrame(frameCallbacks: FrameRequestCallback[]): void {
  const callback = frameCallbacks.shift();
  if (!callback) {
    throw new Error('Expected a scheduled animation frame');
  }
  callback(performance.now());
}

afterEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: originalParent,
  });
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: originalTop,
  });
});

describe('desktopEmbeddedDragRegions', () => {
  it('subtracts exclusions from drag rectangles without leaving overlaps', () => {
    expect(subtractDesktopEmbeddedDragRegionRect(
      { x: 0, y: 0, width: 300, height: 40 },
      { x: 80, y: 0, width: 40, height: 40 },
    )).toEqual([
      { x: 0, y: 0, width: 80, height: 40 },
      { x: 120, y: 0, width: 180, height: 40 },
    ]);
  });

  it('builds drag regions from the top bar minus interactive descendants', () => {
    document.body.innerHTML = `
      <div data-floe-shell-slot="top-bar">
        <button id="left-action">Left</button>
        <div id="center"></div>
        <button id="right-action">Right</button>
      </div>
    `;

    const topBar = document.querySelector('[data-floe-shell-slot="top-bar"]') as HTMLElement;
    const leftAction = document.getElementById('left-action') as HTMLButtonElement;
    const rightAction = document.getElementById('right-action') as HTMLButtonElement;

    stubRect(topBar, { x: 0, y: 0, width: 320, height: 40 });
    stubRect(leftAction, { x: 0, y: 0, width: 72, height: 40 });
    stubRect(rightAction, { x: 264, y: 0, width: 56, height: 40 });

    expect(buildDesktopEmbeddedDragRegionSnapshot()).toEqual({
      version: 1,
      regions: [
        { x: 72, y: 0, width: 192, height: 40 },
      ],
    });
  });

  it('publishes and clears drag snapshots through a same-origin parent bridge', () => {
    document.body.innerHTML = `
      <div data-floe-shell-slot="top-bar">
        <button id="left-action">Left</button>
      </div>
    `;

    const topBar = document.querySelector('[data-floe-shell-slot="top-bar"]') as HTMLElement;
    const leftAction = document.getElementById('left-action') as HTMLButtonElement;

    stubRect(topBar, { x: 0, y: 0, width: 240, height: 40 });
    stubRect(leftAction, { x: 0, y: 0, width: 64, height: 40 });

    const setSnapshot = vi.fn();
    const clear = vi.fn();
    const parentWindow = createFakeWindow();
    parentWindow.redevenDesktopEmbeddedDragRegions = { setSnapshot, clear };
    setWindowHierarchy(parentWindow);

    const sync = installDesktopEmbeddedDragRegionSync({
      createResizeObserver: () => null,
    });
    expect(sync).toBeTruthy();

    expect(sync?.refresh()).toEqual({
      version: 1,
      regions: [
        { x: 64, y: 0, width: 176, height: 40 },
      ],
    });
    expect(setSnapshot).toHaveBeenCalledWith({
      version: 1,
      regions: [
        { x: 64, y: 0, width: 176, height: 40 },
      ],
    });

    sync?.dispose();
    expect(clear).toHaveBeenCalled();
  });

  it('does not reconnect resize observers or republish identical snapshots during resize notifications', () => {
    document.body.innerHTML = `
      <div data-floe-shell-slot="top-bar">
        <button id="left-action">Left</button>
      </div>
    `;

    const topBar = document.querySelector('[data-floe-shell-slot="top-bar"]') as HTMLElement;
    const leftAction = document.getElementById('left-action') as HTMLButtonElement;
    stubRect(topBar, { x: 0, y: 0, width: 240, height: 40 });
    stubRect(leftAction, { x: 0, y: 0, width: 64, height: 40 });

    const setSnapshot = vi.fn();
    const clear = vi.fn();
    const { currentWindow, frameCallbacks } = createFakeSyncWindow();
    currentWindow.redevenDesktopEmbeddedDragRegions = { setSnapshot, clear };

    let resizeCallback: ResizeObserverCallback = () => undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    const sync = installDesktopEmbeddedDragRegionSync({
      currentWindow,
      createResizeObserver: (callback) => {
        resizeCallback = callback;
        return { observe, unobserve, disconnect };
      },
    });
    expect(sync).toBeTruthy();

    flushNextFrame(frameCallbacks);
    expect(setSnapshot).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(disconnect).not.toHaveBeenCalled();

    resizeCallback([] as ResizeObserverEntry[], {} as ResizeObserver);
    flushNextFrame(frameCallbacks);

    expect(setSnapshot).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(unobserve).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();

    sync?.dispose();
  });

  it('unobserves removed drag targets without recreating the resize observer', () => {
    document.body.innerHTML = `
      <div data-floe-shell-slot="top-bar">
        <button id="left-action">Left</button>
      </div>
    `;

    const topBar = document.querySelector('[data-floe-shell-slot="top-bar"]') as HTMLElement;
    const leftAction = document.getElementById('left-action') as HTMLButtonElement;
    stubRect(topBar, { x: 0, y: 0, width: 240, height: 40 });
    stubRect(leftAction, { x: 0, y: 0, width: 64, height: 40 });

    const setSnapshot = vi.fn();
    const clear = vi.fn();
    const { currentWindow, frameCallbacks } = createFakeSyncWindow();
    currentWindow.redevenDesktopEmbeddedDragRegions = { setSnapshot, clear };

    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    const sync = installDesktopEmbeddedDragRegionSync({
      currentWindow,
      createResizeObserver: () => ({ observe, unobserve, disconnect }),
    });
    expect(sync).toBeTruthy();

    flushNextFrame(frameCallbacks);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(setSnapshot).toHaveBeenCalledWith({
      version: 1,
      regions: [
        { x: 64, y: 0, width: 176, height: 40 },
      ],
    });

    leftAction.remove();
    expect(sync?.refresh()).toEqual({
      version: 1,
      regions: [
        { x: 0, y: 0, width: 240, height: 40 },
      ],
    });

    expect(unobserve).toHaveBeenCalledWith(leftAction);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(disconnect).not.toHaveBeenCalled();

    sync?.dispose();
  });
});
