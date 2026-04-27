import type { BrowserWindow } from 'electron';

export type DesktopTrackedWindow = Readonly<{
  browserWindow: BrowserWindow;
  webContentsID: number;
}>;

export type DesktopClosedWindowSnapshot = Readonly<{
  webContentsID: number;
}>;

export function trackBrowserWindow(browserWindow: BrowserWindow): DesktopTrackedWindow {
  return {
    browserWindow,
    webContentsID: browserWindow.webContents.id,
  };
}

export function closedWindowSnapshot(windowRecord: DesktopTrackedWindow): DesktopClosedWindowSnapshot {
  return {
    webContentsID: windowRecord.webContentsID,
  };
}

export function liveTrackedBrowserWindow(windowRecord: DesktopTrackedWindow | null | undefined): BrowserWindow | null {
  const browserWindow = windowRecord?.browserWindow ?? null;
  if (!browserWindow || browserWindow.isDestroyed()) {
    return null;
  }
  return browserWindow;
}
