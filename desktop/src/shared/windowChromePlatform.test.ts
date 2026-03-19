import { describe, expect, it } from 'vitest';

import {
  LINUX_TITLE_BAR_OVERLAY_HEIGHT,
  desktopWindowTitleBarInsetCSSValue,
  usesDesktopWindowThemeOverlay,
} from './windowChromePlatform';

describe('windowChromePlatform', () => {
  it('uses a themed title bar overlay only on Linux', () => {
    expect(usesDesktopWindowThemeOverlay('linux')).toBe(true);
    expect(usesDesktopWindowThemeOverlay('darwin')).toBe(false);
    expect(usesDesktopWindowThemeOverlay('win32')).toBe(false);
  });

  it('returns the expected title bar inset CSS value per platform', () => {
    expect(desktopWindowTitleBarInsetCSSValue('linux')).toBe('env(titlebar-area-height, 0px)');
    expect(desktopWindowTitleBarInsetCSSValue('darwin')).toBe('0px');
  });

  it('keeps the Linux title bar overlay height stable', () => {
    expect(LINUX_TITLE_BAR_OVERLAY_HEIGHT).toBe(40);
  });
});
