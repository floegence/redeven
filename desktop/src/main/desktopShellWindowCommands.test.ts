import { describe, expect, it, vi } from 'vitest';

import {
  captureDesktopShellWindowState,
  performDesktopShellWindowCommand,
} from './desktopShellWindowCommands';

class FakeWindow {
  destroyed = false;
  minimized = false;
  maximized = false;
  fullScreen = false;
  minimizable = true;
  maximizable = true;
  fullScreenable = true;
  closable = true;

  minimize = vi.fn(() => {
    this.minimized = true;
  });

  maximize = vi.fn(() => {
    this.maximized = true;
  });

  unmaximize = vi.fn(() => {
    this.maximized = false;
  });

  setFullScreen = vi.fn((value: boolean) => {
    this.fullScreen = value;
  });

  close = vi.fn(() => {
    this.destroyed = true;
  });

  isDestroyed() {
    return this.destroyed;
  }

  isMinimized() {
    return this.minimized;
  }

  isMaximized() {
    return this.maximized;
  }

  isFullScreen() {
    return this.fullScreen;
  }

  isMinimizable() {
    return this.minimizable;
  }

  isMaximizable() {
    return this.maximizable;
  }

  isFullScreenable() {
    return this.fullScreenable;
  }

  isClosable() {
    return this.closable;
  }
}

describe('desktopShellWindowCommands', () => {
  it('captures the current window state', () => {
    const win = new FakeWindow();
    win.maximized = true;

    expect(captureDesktopShellWindowState(win as never)).toEqual({
      minimized: false,
      maximized: true,
      full_screen: false,
      minimizable: true,
      maximizable: true,
      full_screenable: true,
      closable: true,
    });
  });

  it('minimizes a minimizable window once', () => {
    const win = new FakeWindow();

    expect(performDesktopShellWindowCommand(win as never, 'minimize')).toEqual({
      ok: true,
      performed: true,
      state: {
        minimized: true,
        maximized: false,
        full_screen: false,
        minimizable: true,
        maximizable: true,
        full_screenable: true,
        closable: true,
      },
    });
    expect(win.minimize).toHaveBeenCalledTimes(1);
  });

  it('closes a closable window explicitly', () => {
    const win = new FakeWindow();

    const response = performDesktopShellWindowCommand(win as never, 'close');
    expect(response.ok).toBe(true);
    expect(response.performed).toBe(true);
    expect(response.state).toBeNull();
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it('toggles maximized state when supported', () => {
    const win = new FakeWindow();

    const maximizeResult = performDesktopShellWindowCommand(win as never, 'toggle_maximize');
    expect(maximizeResult.ok).toBe(true);
    expect(maximizeResult.performed).toBe(true);
    expect(maximizeResult.state?.maximized).toBe(true);
    expect(win.maximize).toHaveBeenCalledTimes(1);

    const restoreResult = performDesktopShellWindowCommand(win as never, 'toggle_maximize');
    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.performed).toBe(true);
    expect(restoreResult.state?.maximized).toBe(false);
    expect(win.unmaximize).toHaveBeenCalledTimes(1);
  });

  it('toggles full screen when supported', () => {
    const win = new FakeWindow();

    const enterResult = performDesktopShellWindowCommand(win as never, 'toggle_full_screen');
    expect(enterResult.ok).toBe(true);
    expect(enterResult.state?.full_screen).toBe(true);
    expect(win.setFullScreen).toHaveBeenCalledWith(true);

    const exitResult = performDesktopShellWindowCommand(win as never, 'toggle_full_screen');
    expect(exitResult.ok).toBe(true);
    expect(exitResult.state?.full_screen).toBe(false);
    expect(win.setFullScreen).toHaveBeenCalledWith(false);
  });

  it('reports unsupported commands without mutating the window', () => {
    const win = new FakeWindow();
    win.minimizable = false;

    expect(performDesktopShellWindowCommand(win as never, 'minimize')).toEqual({
      ok: false,
      performed: false,
      state: {
        minimized: false,
        maximized: false,
        full_screen: false,
        minimizable: false,
        maximizable: true,
        full_screenable: true,
        closable: true,
      },
      message: 'Desktop cannot minimize this window.',
    });
    expect(win.minimize).not.toHaveBeenCalled();
  });

  it('reports close as unsupported when the window is not closable', () => {
    const win = new FakeWindow();
    win.closable = false;

    expect(performDesktopShellWindowCommand(win as never, 'close')).toEqual({
      ok: false,
      performed: false,
      state: {
        minimized: false,
        maximized: false,
        full_screen: false,
        minimizable: true,
        maximizable: true,
        full_screenable: true,
        closable: false,
      },
      message: 'Desktop cannot close this window.',
    });
    expect(win.close).not.toHaveBeenCalled();
  });
});
