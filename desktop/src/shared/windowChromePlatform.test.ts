import { describe, expect, it } from 'vitest';

import {
  DESKTOP_TITLE_BAR_HEIGHT,
  desktopWindowChromeCSSVariables,
  desktopWindowTitleBarInsetCSSValue,
  resolveDesktopWindowChromeConfig,
  usesDesktopWindowThemeOverlay,
} from './windowChromePlatform';

describe('windowChromePlatform', () => {
  it('resolves platform-aware chrome configs for macOS, Windows, and Linux', () => {
    expect(resolveDesktopWindowChromeConfig('darwin')).toEqual({
      mode: 'hidden-inset',
      controlsSide: 'left',
      titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
      contentInsetStart: 84,
      contentInsetEnd: 16,
      trafficLightPosition: { x: 14, y: 12 },
    });
    expect(resolveDesktopWindowChromeConfig('win32')).toEqual({
      mode: 'overlay',
      controlsSide: 'right',
      titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
      contentInsetStart: 16,
      contentInsetEnd: 144,
    });
    expect(resolveDesktopWindowChromeConfig('linux')).toEqual({
      mode: 'overlay',
      controlsSide: 'right',
      titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
      contentInsetStart: 16,
      contentInsetEnd: 136,
    });
  });

  it('uses a themed title bar overlay on Windows and Linux, but not on macOS', () => {
    expect(usesDesktopWindowThemeOverlay('darwin')).toBe(false);
    expect(usesDesktopWindowThemeOverlay('win32')).toBe(true);
    expect(usesDesktopWindowThemeOverlay('linux')).toBe(true);
  });

  it('returns a titlebar inset CSS value for every supported desktop platform', () => {
    expect(desktopWindowTitleBarInsetCSSValue('darwin')).toBe('40px');
    expect(desktopWindowTitleBarInsetCSSValue('win32')).toBe('env(titlebar-area-height, 40px)');
    expect(desktopWindowTitleBarInsetCSSValue('linux')).toBe('env(titlebar-area-height, 40px)');
  });

  it('provides reusable renderer CSS variables from the chrome config', () => {
    expect(desktopWindowChromeCSSVariables('darwin')).toEqual({
      '--redeven-desktop-titlebar-height': '40px',
      '--redeven-desktop-titlebar-start-inset': '84px',
      '--redeven-desktop-titlebar-end-inset': '16px',
    });
  });
});
