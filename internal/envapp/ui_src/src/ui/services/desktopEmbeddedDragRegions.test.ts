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

function createFakeWindow(origin = window.location.origin): FakeWindow {
  const fake = {
    location: { origin },
  } as FakeWindow;
  fake.parent = fake;
  fake.top = fake;
  return fake;
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
});
