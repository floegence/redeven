// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  installDesktopWindowChromeDocumentSync,
  readDesktopWindowChromeSnapshot,
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
});
