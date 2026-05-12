// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  closeDesktopWindow,
  desktopShellExternalURLOpenAvailable,
  desktopShellBridgeAvailable,
  minimizeDesktopWindow,
  openAdvancedSettings,
  openConnectionCenter,
  openDashboardInDesktopShell,
  openExternalURLInDesktopShell,
  restartDesktopManagedRuntime,
  toggleDesktopWindowFullScreen,
  toggleDesktopWindowMaximize,
} from './desktopShellBridge';

afterEach(() => {
  delete window.redevenDesktopShell;
});

describe('desktopShellBridge', () => {
  it('reports unavailable when the desktop shell bridge is missing', () => {
    expect(desktopShellBridgeAvailable()).toBe(false);
  });

  it('prefers the canonical launcher and settings bridge methods', async () => {
    const openConnectionCenterBridge = vi.fn().mockResolvedValue(undefined);
    const openAdvancedSettingsBridge = vi.fn().mockResolvedValue(undefined);
    window.redevenDesktopShell = {
      openConnectionCenter: openConnectionCenterBridge,
      openAdvancedSettings: openAdvancedSettingsBridge,
    };

    expect(desktopShellBridgeAvailable()).toBe(true);
    await expect(openConnectionCenter()).resolves.toBe(true);
    await expect(openAdvancedSettings()).resolves.toBe(true);

    expect(openConnectionCenterBridge).toHaveBeenCalledTimes(1);
    expect(openAdvancedSettingsBridge).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic openWindow bridge when explicit methods are unavailable', async () => {
    const openWindowBridge = vi.fn().mockResolvedValue(undefined);
    window.redevenDesktopShell = {
      openWindow: openWindowBridge,
    };

    expect(desktopShellBridgeAvailable()).toBe(true);
    await expect(openConnectionCenter()).resolves.toBe(true);
    await expect(openAdvancedSettings()).resolves.toBe(true);

    expect(openWindowBridge).toHaveBeenNthCalledWith(1, 'connection_center');
    expect(openWindowBridge).toHaveBeenNthCalledWith(2, 'settings');
    expect(openWindowBridge).toHaveBeenCalledTimes(2);
  });

  it('prefers explicit native window command bridge methods when present', async () => {
    const minimizeWindowBridge = vi.fn().mockResolvedValue({
      ok: true,
      performed: true,
      state: null,
    });
    const closeWindowBridge = vi.fn().mockResolvedValue({
      ok: true,
      performed: true,
      state: null,
    });
    const toggleMaximizeWindowBridge = vi.fn().mockResolvedValue({
      ok: true,
      performed: true,
      state: { minimized: false, maximized: true, full_screen: false, minimizable: true, maximizable: true, full_screenable: true, closable: true },
    });
    const toggleFullScreenWindowBridge = vi.fn().mockResolvedValue({
      ok: true,
      performed: true,
      state: { minimized: false, maximized: false, full_screen: true, minimizable: true, maximizable: true, full_screenable: true, closable: true },
    });
    window.redevenDesktopShell = {
      minimizeWindow: minimizeWindowBridge,
      closeWindow: closeWindowBridge,
      toggleMaximizeWindow: toggleMaximizeWindowBridge,
      toggleFullScreenWindow: toggleFullScreenWindowBridge,
    };

    await expect(minimizeDesktopWindow()).resolves.toEqual({
      ok: true,
      performed: true,
      state: null,
      message: undefined,
    });
    await expect(closeDesktopWindow()).resolves.toEqual({
      ok: true,
      performed: true,
      state: null,
      message: undefined,
    });
    await expect(toggleDesktopWindowMaximize()).resolves.toEqual({
      ok: true,
      performed: true,
      state: { minimized: false, maximized: true, full_screen: false, minimizable: true, maximizable: true, full_screenable: true, closable: true },
      message: undefined,
    });
    await expect(toggleDesktopWindowFullScreen()).resolves.toEqual({
      ok: true,
      performed: true,
      state: { minimized: false, maximized: false, full_screen: true, minimizable: true, maximizable: true, full_screenable: true, closable: true },
      message: undefined,
    });

    expect(minimizeWindowBridge).toHaveBeenCalledTimes(1);
    expect(closeWindowBridge).toHaveBeenCalledTimes(1);
    expect(toggleMaximizeWindowBridge).toHaveBeenCalledTimes(1);
    expect(toggleFullScreenWindowBridge).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic window-command bridge when explicit methods are unavailable', async () => {
    const performWindowCommandBridge = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        performed: true,
        state: { minimized: true, maximized: false, full_screen: false, minimizable: true, maximizable: true, full_screenable: true, closable: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        performed: true,
        state: { minimized: false, maximized: true, full_screen: false, minimizable: true, maximizable: true, full_screenable: true, closable: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        performed: true,
        state: { minimized: false, maximized: false, full_screen: true, minimizable: true, maximizable: true, full_screenable: true, closable: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        performed: true,
        state: null,
      });
    window.redevenDesktopShell = {
      performWindowCommand: performWindowCommandBridge,
    };

    await minimizeDesktopWindow();
    await toggleDesktopWindowMaximize();
    await toggleDesktopWindowFullScreen();
    await closeDesktopWindow();

    expect(performWindowCommandBridge).toHaveBeenNthCalledWith(1, 'minimize');
    expect(performWindowCommandBridge).toHaveBeenNthCalledWith(2, 'toggle_maximize');
    expect(performWindowCommandBridge).toHaveBeenNthCalledWith(3, 'toggle_full_screen');
    expect(performWindowCommandBridge).toHaveBeenNthCalledWith(4, 'close');
  });

  it('forwards managed runtime restart when the desktop bridge exposes it', async () => {
    const restartManagedRuntimeBridge = vi.fn().mockResolvedValue({
      ok: true,
      started: true,
      message: 'Desktop restarted the managed runtime.',
    });
    window.redevenDesktopShell = {
      openConnectionCenter: vi.fn().mockResolvedValue(undefined),
      restartManagedRuntime: restartManagedRuntimeBridge,
    };

    await expect(restartDesktopManagedRuntime()).resolves.toEqual({
      ok: true,
      started: true,
      message: 'Desktop restarted the managed runtime.',
    });
    expect(restartManagedRuntimeBridge).toHaveBeenCalledTimes(1);
  });

  it('forwards external browser requests when the desktop bridge exposes them', async () => {
    const openExternalURLBridge = vi.fn().mockResolvedValue({
      ok: true,
      message: 'Opened in the system browser.',
    });
    window.redevenDesktopShell = {
      openConnectionCenter: vi.fn().mockResolvedValue(undefined),
      openExternalURL: openExternalURLBridge,
    };

    expect(desktopShellExternalURLOpenAvailable()).toBe(true);
    await expect(openExternalURLInDesktopShell('http://127.0.0.1:43123/cs/demo/')).resolves.toEqual({
      ok: true,
      message: 'Opened in the system browser.',
    });
    expect(openExternalURLBridge).toHaveBeenCalledWith('http://127.0.0.1:43123/cs/demo/');
  });

  it('forwards dashboard requests through the semantic desktop bridge method', async () => {
    const openDashboardBridge = vi.fn().mockResolvedValue({
      ok: true,
      message: 'Opened in the system browser.',
    });
    window.redevenDesktopShell = {
      openDashboard: openDashboardBridge,
    };

    await expect(openDashboardInDesktopShell()).resolves.toEqual({
      ok: true,
      message: 'Opened in the system browser.',
    });
    expect(openDashboardBridge).toHaveBeenCalledTimes(1);
  });
});
