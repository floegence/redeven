import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

import { desktopTheme } from './desktopTheme';
import type { DesktopWindowThemeSnapshot } from '../shared/desktopTheme';
import {
  resolveDesktopWindowChromeConfig,
  usesDesktopWindowThemeOverlay,
} from '../shared/windowChromePlatform';

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
