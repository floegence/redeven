import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

import { desktopTheme } from './desktopTheme';
import { type DesktopWindowThemeSnapshot } from '../shared/windowThemeIPC';
import { LINUX_TITLE_BAR_OVERLAY_HEIGHT, usesDesktopWindowThemeOverlay } from '../shared/windowChromePlatform';

export function defaultDesktopWindowThemeSnapshot(): DesktopWindowThemeSnapshot {
  return {
    backgroundColor: desktopTheme.windowBackground,
    symbolColor: desktopTheme.text,
  };
}

export function buildDesktopWindowChromeOptions(
  platform: NodeJS.Platform = process.platform,
  snapshot: DesktopWindowThemeSnapshot = defaultDesktopWindowThemeSnapshot(),
): Pick<BrowserWindowConstructorOptions, 'backgroundColor' | 'titleBarStyle' | 'titleBarOverlay'> {
  if (usesDesktopWindowThemeOverlay(platform)) {
    return {
      backgroundColor: snapshot.backgroundColor,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: snapshot.backgroundColor,
        symbolColor: snapshot.symbolColor,
        height: LINUX_TITLE_BAR_OVERLAY_HEIGHT,
      },
    };
  }

  return {
    backgroundColor: snapshot.backgroundColor,
  };
}

export function applyDesktopWindowTheme(
  win: Pick<BrowserWindow, 'setBackgroundColor' | 'setTitleBarOverlay'>,
  snapshot: DesktopWindowThemeSnapshot,
  platform: NodeJS.Platform = process.platform,
): void {
  win.setBackgroundColor(snapshot.backgroundColor);

  if (usesDesktopWindowThemeOverlay(platform)) {
    win.setTitleBarOverlay({
      color: snapshot.backgroundColor,
      symbolColor: snapshot.symbolColor,
      height: LINUX_TITLE_BAR_OVERLAY_HEIGHT,
    });
  }
}
