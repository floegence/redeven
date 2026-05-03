import { describe, expect, it } from 'vitest';

import {
  buildDesktopWindowChromeStyleText,
  desktopWindowChromeCSSVariables,
  DESKTOP_WINDOW_CHROME_NO_DRAG_ATTR,
  DESKTOP_WINDOW_CHROME_NO_DRAG_SELECTOR,
  normalizeDesktopWindowChromeSnapshot,
} from './windowChromeContract';

describe('windowChromeContract', () => {
  it('normalizes reusable window chrome snapshots', () => {
    expect(normalizeDesktopWindowChromeSnapshot({
      mode: 'hidden-inset',
      controlsSide: 'left',
      titleBarHeight: 40,
      contentInsetStart: 84,
      contentInsetEnd: 16,
    })).toEqual({
      mode: 'hidden-inset',
      controlsSide: 'left',
      titleBarHeight: 40,
      contentInsetStart: 84,
      contentInsetEnd: 16,
    });

    expect(normalizeDesktopWindowChromeSnapshot({
      mode: 'overlay',
      controlsSide: 'right',
      titleBarHeight: 0,
      contentInsetStart: 16,
      contentInsetEnd: 144,
    })).toBeNull();
  });

  it('derives renderer CSS variables and the shared chrome style text from a snapshot', () => {
    const snapshot = {
      mode: 'overlay',
      controlsSide: 'right',
      titleBarHeight: 40,
      contentInsetStart: 16,
      contentInsetEnd: 144,
    } as const;

    expect(desktopWindowChromeCSSVariables(snapshot)).toEqual({
      '--redeven-desktop-titlebar-height': '40px',
      '--redeven-desktop-titlebar-start-inset': '16px',
      '--redeven-desktop-titlebar-end-inset': '144px',
      '--redeven-desktop-titlebar-balance-inset': '144px',
    });

    const styleText = buildDesktopWindowChromeStyleText(snapshot);
    expect(styleText).toContain("--redeven-desktop-titlebar-height: 40px;");
    expect(styleText).toContain("--redeven-desktop-titlebar-balance-inset: 144px;");
    expect(styleText).toContain("[data-floe-shell-slot='top-bar']");
    expect(styleText).toContain("[data-redeven-desktop-window-titlebar='true']");
    expect(styleText).toContain(DESKTOP_WINDOW_CHROME_NO_DRAG_SELECTOR);
    expect(DESKTOP_WINDOW_CHROME_NO_DRAG_ATTR).toBe('data-redeven-desktop-titlebar-no-drag');
    expect(styleText).toContain("grid-template-columns: minmax(0, 1fr) 4.5rem minmax(0, 24rem) 4.5rem minmax(0, 1fr);");
    expect(styleText).toContain("grid-column: 3;");
  });
});
