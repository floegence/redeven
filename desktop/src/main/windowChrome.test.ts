import { describe, expect, it, vi } from 'vitest';

import {
  LINUX_TITLE_BAR_OVERLAY_HEIGHT,
  applyDesktopWindowTheme,
  buildDesktopWindowChromeOptions,
  defaultDesktopWindowThemeSnapshot,
} from './windowChrome';

describe('windowChrome', () => {
  it('uses a hidden inset title bar on macOS so the chrome follows the app background', () => {
    expect(buildDesktopWindowChromeOptions('darwin')).toEqual({
      backgroundColor: defaultDesktopWindowThemeSnapshot().backgroundColor,
      titleBarStyle: 'hiddenInset',
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
});
