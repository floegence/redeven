import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({
  primaryWorkArea: { x: 0, y: 0, width: 1440, height: 900 },
  matchedWorkArea: { x: 0, y: 0, width: 1440, height: 900 },
}));

vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => ({ workArea: electronState.primaryWorkArea }),
    getDisplayMatching: () => ({ workArea: electronState.matchedWorkArea }),
  },
}));

import {
  applyRestoredWindowState,
  attachDesktopWindowStatePersistence,
  captureDesktopWindowState,
  resolveRestoredWindowBounds,
  restoreBrowserWindowBounds,
} from './windowState';
import type { BrowserWindow } from 'electron';
import type { DesktopStateStore } from './desktopStateStore';
import type { DesktopWindowSpec } from './windowSpec';

class FakeWindow extends EventEmitter {
  destroyed = false;
  maximized = false;
  fullScreen = false;
  bounds = { x: 10, y: 20, width: 1100, height: 760 };
  normalBounds = { x: 12, y: 24, width: 960, height: 640 };
  maximize = vi.fn(() => {
    this.maximized = true;
  });
  setFullScreen = vi.fn((value: boolean) => {
    this.fullScreen = value;
  });

  isDestroyed() {
    return this.destroyed;
  }

  isMaximized() {
    return this.maximized;
  }

  isFullScreen() {
    return this.fullScreen;
  }

  getBounds() {
    return this.bounds;
  }

  getNormalBounds() {
    return this.normalBounds;
  }
}

const defaultSpec: DesktopWindowSpec = {
  width: 1280,
  height: 860,
  minWidth: 900,
  minHeight: 640,
};

function asBrowserWindow(value: FakeWindow): BrowserWindow {
  return value as unknown as BrowserWindow;
}

describe('windowState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    electronState.primaryWorkArea = { x: 0, y: 0, width: 1440, height: 900 };
    electronState.matchedWorkArea = { x: 0, y: 0, width: 1440, height: 900 };
  });

  it('captures normal bounds while maximized or fullscreen', () => {
    const win = new FakeWindow();
    win.maximized = true;
    expect(captureDesktopWindowState(asBrowserWindow(win))).toEqual({
      x: 12,
      y: 24,
      width: 960,
      height: 640,
      maximized: true,
      full_screen: false,
    });

    win.maximized = false;
    win.fullScreen = true;
    expect(captureDesktopWindowState(asBrowserWindow(win))?.width).toBe(960);
  });

  it('clamps restored bounds into the visible work area', () => {
    const restored = resolveRestoredWindowBounds(defaultSpec, {
      x: -1200,
      y: 2000,
      width: 2400,
      height: 1600,
    }, { x: 100, y: 50, width: 1200, height: 800 });

    expect(restored.width).toBe(1200);
    expect(restored.height).toBe(800);
    expect(restored.x).toBeLessThanOrEqual(1220);
    expect(restored.x).toBeGreaterThanOrEqual(-1020);
    expect(restored.y).toBeLessThanOrEqual(770);
    expect(restored.y).toBeGreaterThanOrEqual(50 - (800 - 80));
  });

  it('restores persisted bounds from the matching display work area', () => {
    electronState.matchedWorkArea = { x: 1920, y: 0, width: 1600, height: 1000 };
    const store = {
      getWindowState: vi.fn(() => ({ x: 2100, y: 40, width: 1200, height: 860 })),
    } as unknown as DesktopStateStore;

    expect(restoreBrowserWindowBounds(defaultSpec, store, 'window:main')).toEqual({
      x: 2100,
      y: 40,
      width: 1200,
      height: 860,
    });
  });

  it('reapplies maximized and fullscreen state to restored windows', () => {
    const maximizedWindow = new FakeWindow();
    applyRestoredWindowState(asBrowserWindow(maximizedWindow), { x: 0, y: 0, width: 10, height: 10, maximized: true });
    expect(maximizedWindow.maximize).toHaveBeenCalledTimes(1);

    const fullScreenWindow = new FakeWindow();
    applyRestoredWindowState(asBrowserWindow(fullScreenWindow), { x: 0, y: 0, width: 10, height: 10, full_screen: true });
    expect(fullScreenWindow.setFullScreen).toHaveBeenCalledWith(true);
  });

  it('persists window changes through the desktop state store after the debounce window', () => {
    const win = new FakeWindow();
    const setWindowState = vi.fn();
    const store = {
      setWindowState,
    } as unknown as DesktopStateStore;

    const dispose = attachDesktopWindowStatePersistence(asBrowserWindow(win), store, 'window:main');
    win.emit('move');
    vi.advanceTimersByTime(199);
    expect(setWindowState).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(setWindowState).toHaveBeenCalledWith('window:main', {
      x: 10,
      y: 20,
      width: 1100,
      height: 760,
      maximized: false,
      full_screen: false,
    });

    dispose();
  });
});
