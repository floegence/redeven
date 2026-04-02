// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  desktopShellExternalURLOpenAvailable,
  desktopShellBridgeAvailable,
  openAdvancedSettings,
  openConnectionCenter,
  openDesktopConnectToRedeven,
  openDesktopSettings,
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

  it('prefers the canonical chooser and advanced bridge methods', async () => {
    const openDeviceChooserBridge = vi.fn().mockResolvedValue(undefined);
    const openConnectionCenterBridge = vi.fn().mockResolvedValue(undefined);
    const openAdvancedSettingsBridge = vi.fn().mockResolvedValue(undefined);
    window.redevenDesktopShell = {
      openDeviceChooser: openDeviceChooserBridge,
      openConnectionCenter: openConnectionCenterBridge,
      openAdvancedSettings: openAdvancedSettingsBridge,
    };

    expect(desktopShellBridgeAvailable()).toBe(true);
    await expect(openConnectionCenter()).resolves.toBe(true);
    await expect(openAdvancedSettings()).resolves.toBe(true);

    expect(openDeviceChooserBridge).toHaveBeenCalledTimes(1);
    expect(openConnectionCenterBridge).toHaveBeenCalledTimes(0);
    expect(openAdvancedSettingsBridge).toHaveBeenCalledTimes(1);
  });

  it('falls back to switch-device and legacy aliases for compatibility', async () => {
    const switchDeviceBridge = vi.fn().mockResolvedValue(undefined);
    const openConnectToRedevenBridge = vi.fn().mockResolvedValue(undefined);
    const openDesktopSettingsBridge = vi.fn().mockResolvedValue(undefined);
    window.redevenDesktopShell = {
      switchDevice: switchDeviceBridge,
      openConnectToRedeven: openConnectToRedevenBridge,
      openDesktopSettings: openDesktopSettingsBridge,
    };

    expect(desktopShellBridgeAvailable()).toBe(true);
    await expect(openDesktopConnectToRedeven()).resolves.toBe(true);
    await expect(openDesktopSettings()).resolves.toBe(true);

    expect(switchDeviceBridge).toHaveBeenCalledTimes(1);
    expect(openConnectToRedevenBridge).toHaveBeenCalledTimes(0);
    expect(openDesktopSettingsBridge).toHaveBeenCalledTimes(1);
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
