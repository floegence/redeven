import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

import { desktopTheme } from './desktopTheme';
import type { DesktopWindowThemeSnapshot } from '../shared/desktopTheme';
import {
  resolveDesktopWindowChromeConfig,
  resolveDesktopWindowChromeSnapshot,
  usesDesktopWindowThemeOverlay,
} from '../shared/windowChromePlatform';
import { DESKTOP_WINDOW_CHROME_UPDATED_CHANNEL } from '../shared/windowChromeIPC';

export function defaultDesktopWindowThemeSnapshot(): DesktopWindowThemeSnapshot {
  return {
    backgroundColor: desktopTheme.nativeWindow.backgroundColor,
    symbolColor: desktopTheme.nativeWindow.symbolColor,
  };
}

export function buildDesktopWindowChromeOptions(
  platform: NodeJS.Platform = process.platform,
  snapshot: DesktopWindowThemeSnapshot = defaultDesktopWindowThemeSnapshot(),
): Pick<BrowserWindowConstructorOptions, 'backgroundColor' | 'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition'> {
  const chrome = resolveDesktopWindowChromeConfig(platform);

  if (chrome.mode === 'overlay') {
    return {
      backgroundColor: snapshot.backgroundColor,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: snapshot.backgroundColor,
        symbolColor: snapshot.symbolColor,
        height: chrome.titleBarHeight,
      },
    };
  }

  return {
    backgroundColor: snapshot.backgroundColor,
    titleBarStyle: 'hidden',
    trafficLightPosition: chrome.trafficLightPosition,
  };
}

export function applyDesktopWindowTheme(
  win: Pick<BrowserWindow, 'setBackgroundColor' | 'setTitleBarOverlay'>,
  snapshot: DesktopWindowThemeSnapshot,
  platform: NodeJS.Platform = process.platform,
): void {
  win.setBackgroundColor(snapshot.backgroundColor);

  if (usesDesktopWindowThemeOverlay(platform)) {
    const chrome = resolveDesktopWindowChromeConfig(platform);
    win.setTitleBarOverlay({
      color: snapshot.backgroundColor,
      symbolColor: snapshot.symbolColor,
      height: chrome.titleBarHeight,
    });
  }
}

type DesktopWindowChromeSnapshotTarget = Pick<BrowserWindow, 'isDestroyed' | 'isFullScreen'>;
type DesktopWindowChromeBroadcastTarget = Pick<BrowserWindow, 'isDestroyed' | 'isFullScreen' | 'on' | 'removeListener' | 'webContents'>;

export function desktopWindowChromeSnapshotForWindow(
  win: DesktopWindowChromeSnapshotTarget | null | undefined,
  platform: NodeJS.Platform = process.platform,
) {
  const fullScreen = Boolean(win && !win.isDestroyed() && win.isFullScreen());
  return resolveDesktopWindowChromeSnapshot(platform, { fullScreen });
}

export function attachDesktopWindowChromeBroadcast(
  win: DesktopWindowChromeBroadcastTarget,
  platform: NodeJS.Platform = process.platform,
): () => void {
  const broadcast = () => {
    if (win.isDestroyed()) {
      return;
    }
    win.webContents.send(
      DESKTOP_WINDOW_CHROME_UPDATED_CHANNEL,
      desktopWindowChromeSnapshotForWindow(win, platform),
    );
  };

  win.on('enter-full-screen', broadcast);
  win.on('leave-full-screen', broadcast);

  return () => {
    win.removeListener('enter-full-screen', broadcast);
    win.removeListener('leave-full-screen', broadcast);
  };
}
