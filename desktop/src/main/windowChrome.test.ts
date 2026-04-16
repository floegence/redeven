import { describe, expect, it, vi } from 'vitest';

import {
  attachDesktopWindowChromeBroadcast,
  applyDesktopWindowTheme,
  buildDesktopWindowChromeOptions,
  desktopWindowChromeSnapshotForWindow,
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

  it('removes the traffic-light inset when a macOS window enters fullscreen', () => {
    const win = {
      isDestroyed: () => false,
      isFullScreen: () => true,
    };

    expect(desktopWindowChromeSnapshotForWindow(win, 'darwin')).toEqual({
      mode: 'hidden-inset',
      controlsSide: 'left',
      titleBarHeight: 40,
      contentInsetStart: 16,
      contentInsetEnd: 16,
    });
  });

  it('broadcasts window chrome changes when fullscreen state flips', () => {
    const listeners = new Map<string, () => void>();
    let fullScreen = false;
    const win = {
      isDestroyed: () => false,
      isFullScreen: () => fullScreen,
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
      removeListener: vi.fn((event: string) => {
        listeners.delete(event);
      }),
      webContents: {
        send: vi.fn(),
      },
    };

    const dispose = attachDesktopWindowChromeBroadcast(win as never, 'darwin');
    fullScreen = true;
    listeners.get('enter-full-screen')?.();

    expect(win.webContents.send).toHaveBeenCalledWith('redeven-desktop:window-chrome-updated', {
      mode: 'hidden-inset',
      controlsSide: 'left',
      titleBarHeight: 40,
      contentInsetStart: 16,
      contentInsetEnd: 16,
    });

    dispose();
    expect(win.removeListener).toHaveBeenCalledWith('enter-full-screen', expect.any(Function));
    expect(win.removeListener).toHaveBeenCalledWith('leave-full-screen', expect.any(Function));
  });
});
