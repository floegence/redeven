// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  desktopShellExternalURLOpenAvailable,
  desktopShellBridgeAvailable,
  openAdvancedSettings,
  openConnectionCenter,
  openExternalURLInDesktopShell,
  restartDesktopManagedRuntime,
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
});
