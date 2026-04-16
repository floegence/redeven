import { describe, expect, it } from 'vitest';

import { liveTrackedBrowserWindow, trackBrowserWindow } from './windowRecord';
import type { BrowserWindow } from 'electron';

class FakeWindow {
  destroyed = false;
  webContents = { id: 17 };

  isDestroyed() {
    return this.destroyed;
  }
}

function asBrowserWindow(value: FakeWindow): BrowserWindow {
  return value as unknown as BrowserWindow;
}

describe('windowRecord', () => {
  it('captures a stable web contents id at window creation time', () => {
    const browserWindow = new FakeWindow();

    const trackedWindow = trackBrowserWindow(asBrowserWindow(browserWindow));
    browserWindow.webContents.id = 99;

    expect(trackedWindow.webContentsID).toBe(17);
    expect(trackedWindow.browserWindow).toBe(browserWindow);
  });

  it('returns null once the tracked browser window is destroyed', () => {
    const browserWindow = new FakeWindow();
    const trackedWindow = trackBrowserWindow(asBrowserWindow(browserWindow));

    expect(liveTrackedBrowserWindow(trackedWindow)).toBe(browserWindow);

    browserWindow.destroyed = true;
    expect(liveTrackedBrowserWindow(trackedWindow)).toBeNull();
    expect(liveTrackedBrowserWindow(null)).toBeNull();
    expect(liveTrackedBrowserWindow(undefined)).toBeNull();
  });
});
