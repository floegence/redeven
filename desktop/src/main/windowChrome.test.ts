import { describe, expect, it, vi } from 'vitest';

import {
  applyDesktopWindowTheme,
  buildDesktopWindowChromeOptions,
  defaultDesktopWindowThemeSnapshot,
} from './windowChrome';

describe('windowChrome', () => {
  it('uses a hidden macOS title bar with a traffic-light position so content owns the top chrome', () => {
    expect(buildDesktopWindowChromeOptions('darwin')).toEqual({
      backgroundColor: defaultDesktopWindowThemeSnapshot().backgroundColor,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 14, y: 12 },
    });
  });

  it('uses a themed title bar overlay on Windows and Linux', () => {
    expect(buildDesktopWindowChromeOptions('win32')).toEqual({
      backgroundColor: defaultDesktopWindowThemeSnapshot().backgroundColor,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: defaultDesktopWindowThemeSnapshot().backgroundColor,
        symbolColor: defaultDesktopWindowThemeSnapshot().symbolColor,
        height: 40,
      },
    });
    expect(buildDesktopWindowChromeOptions('linux')).toEqual({
      backgroundColor: defaultDesktopWindowThemeSnapshot().backgroundColor,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: defaultDesktopWindowThemeSnapshot().backgroundColor,
        symbolColor: defaultDesktopWindowThemeSnapshot().symbolColor,
        height: 40,
      },
    });
  });

  it('updates overlay colors for overlay-backed platforms only', () => {
    const win = {
      setBackgroundColor: vi.fn(),
      setTitleBarOverlay: vi.fn(),
    };

    applyDesktopWindowTheme(win, {
      backgroundColor: '#0e121b',
      symbolColor: '#f9fafb',
    }, 'win32');

    expect(win.setBackgroundColor).toHaveBeenCalledWith('#0e121b');
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#0e121b',
      symbolColor: '#f9fafb',
      height: 40,
    });
  });

  it('does not call setTitleBarOverlay for macOS hidden-inset chrome', () => {
    const win = {
      setBackgroundColor: vi.fn(),
      setTitleBarOverlay: vi.fn(),
    };

    applyDesktopWindowTheme(win, {
      backgroundColor: '#f0eeea',
      symbolColor: '#141f2e',
    }, 'darwin');

    expect(win.setBackgroundColor).toHaveBeenCalledWith('#f0eeea');
    expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
  });
});
