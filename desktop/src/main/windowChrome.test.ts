import { describe, expect, it, vi } from 'vitest';

import {
  applyDesktopWindowTheme,
  buildDesktopWindowChromeOptions,
  defaultDesktopWindowThemeSnapshot,
} from './windowChrome';
import { LINUX_TITLE_BAR_OVERLAY_HEIGHT } from '../shared/windowChromePlatform';

describe('windowChrome', () => {
  it('uses the native macOS title bar so the system controls and drag region stay intact', () => {
    expect(buildDesktopWindowChromeOptions('darwin')).toEqual({
      backgroundColor: defaultDesktopWindowThemeSnapshot().backgroundColor,
    });
  });

  it('uses a themed title bar overlay on Linux', () => {
    expect(buildDesktopWindowChromeOptions('linux')).toEqual({
      backgroundColor: defaultDesktopWindowThemeSnapshot().backgroundColor,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: defaultDesktopWindowThemeSnapshot().backgroundColor,
        symbolColor: defaultDesktopWindowThemeSnapshot().symbolColor,
        height: LINUX_TITLE_BAR_OVERLAY_HEIGHT,
      },
    });
  });

  it('updates the Linux title bar overlay colors from the renderer theme', () => {
    const win = {
      setBackgroundColor: vi.fn(),
      setTitleBarOverlay: vi.fn(),
    };

    applyDesktopWindowTheme(win, {
      backgroundColor: '#0e121b',
      symbolColor: '#f9fafb',
    }, 'linux');

    expect(win.setBackgroundColor).toHaveBeenCalledWith('#0e121b');
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#0e121b',
      symbolColor: '#f9fafb',
      height: LINUX_TITLE_BAR_OVERLAY_HEIGHT,
    });
  });

  it('does not apply a title bar overlay on macOS', () => {
    const win = {
      setBackgroundColor: vi.fn(),
      setTitleBarOverlay: vi.fn(),
    };

    applyDesktopWindowTheme(win, {
      backgroundColor: '#f3e5de',
      symbolColor: '#181311',
    }, 'darwin');

    expect(win.setBackgroundColor).toHaveBeenCalledWith('#f3e5de');
    expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
  });
});
