// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  desktopFloatingWindowSafeAreaFromSnapshot,
  installDesktopWindowChromeDocumentSync,
  readDesktopFloatingWindowSafeArea,
  readDesktopWindowChromeSnapshot,
  subscribeDesktopFloatingWindowSafeArea,
} from './desktopWindowChrome';

const originalParent = window.parent;
const originalTop = window.top;

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

function chromeSnapshot() {
  return {
    mode: 'hidden-inset' as const,
    controlsSide: 'left' as const,
    titleBarHeight: 40,
    contentInsetStart: 84,
    contentInsetEnd: 16,
  };
}

type ChromeSnapshot = ReturnType<typeof chromeSnapshot>;

afterEach(() => {
  delete window.redevenDesktopWindowChrome;
  document.head.innerHTML = '';
  document.documentElement.dataset.redevenDesktopWindowChromeMode = '';
  document.documentElement.dataset.redevenDesktopWindowControlsSide = '';
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: originalParent,
  });
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: originalTop,
  });
});

describe('desktopWindowChrome', () => {
  it('reads and applies desktop window chrome from the current window', () => {
    window.redevenDesktopWindowChrome = {
      getSnapshot: () => chromeSnapshot(),
      subscribe: () => () => undefined,
    };

    expect(readDesktopWindowChromeSnapshot()).toEqual(chromeSnapshot());
    expect(installDesktopWindowChromeDocumentSync()).toEqual(chromeSnapshot());
    expect(document.documentElement.dataset.redevenDesktopWindowChromeMode).toBe('hidden-inset');
    expect(document.documentElement.dataset.redevenDesktopWindowControlsSide).toBe('left');
    expect(document.getElementById('redeven-desktop-window-chrome')?.textContent).toContain(
      '--redeven-desktop-titlebar-start-inset: 84px;',
    );
  });

  it('inherits desktop window chrome from a same-origin parent host window', () => {
    const parentWindow = {
      location: { origin: window.location.origin },
      redevenDesktopWindowChrome: {
        getSnapshot: () => chromeSnapshot(),
        subscribe: () => () => undefined,
      },
    } as unknown as Window;
    setWindowHierarchy(parentWindow);

    expect(readDesktopWindowChromeSnapshot()).toEqual(chromeSnapshot());
    installDesktopWindowChromeDocumentSync();

    expect(document.getElementById('redeven-desktop-window-chrome')?.textContent).toContain(
      "[data-floe-shell-slot='top-bar']",
    );
    expect(document.getElementById('redeven-desktop-window-chrome')?.textContent).toContain(
      "[data-redeven-desktop-titlebar-no-drag='true']",
    );
  });

  it('derives floating window safe area from desktop titlebar chrome', () => {
    expect(desktopFloatingWindowSafeAreaFromSnapshot(null)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });

    window.redevenDesktopWindowChrome = {
      getSnapshot: () => chromeSnapshot(),
      subscribe: () => () => undefined,
    };

    expect(readDesktopFloatingWindowSafeArea()).toEqual({
      top: 40,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('notifies subscribers when desktop floating window safe area changes', () => {
    let listener: ((snapshot: ChromeSnapshot) => void) | null = null;
    window.redevenDesktopWindowChrome = {
      getSnapshot: () => chromeSnapshot(),
      subscribe: (nextListener: (snapshot: ChromeSnapshot) => void) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
    };
    const safeAreaListener = vi.fn();

    const unsubscribe = subscribeDesktopFloatingWindowSafeArea(safeAreaListener);
    const currentListener = listener as ((snapshot: ChromeSnapshot) => void) | null;
    currentListener?.({
      ...chromeSnapshot(),
      titleBarHeight: 56,
    });

    expect(safeAreaListener).toHaveBeenCalledWith({
      top: 56,
      right: 0,
      bottom: 0,
      left: 0,
    });

    unsubscribe();
    expect(listener).toBeNull();
  });

  it('updates the document when the host window broadcasts a new chrome snapshot', () => {
    let listener: ((snapshot: ChromeSnapshot) => void) | null = null;
    const doc = document.implementation.createHTMLDocument('window-chrome-sync');
    window.redevenDesktopWindowChrome = {
      getSnapshot: () => chromeSnapshot(),
      subscribe: (nextListener: (snapshot: ChromeSnapshot) => void) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
    };

    installDesktopWindowChromeDocumentSync(doc);
    const currentListener = listener as ((snapshot: ChromeSnapshot) => void) | null;
    expect(typeof currentListener).toBe('function');
    currentListener?.({
      ...chromeSnapshot(),
      contentInsetStart: 16,
      contentInsetEnd: 16,
    });

    expect(doc.getElementById('redeven-desktop-window-chrome')?.textContent).toContain(
      '--redeven-desktop-titlebar-balance-inset: 16px;',
    );
  });
});
