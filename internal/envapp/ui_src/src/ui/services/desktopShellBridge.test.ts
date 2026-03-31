// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  desktopShellBridgeAvailable,
  openAdvancedSettings,
  openConnectionCenter,
  openDesktopConnectToRedeven,
  openDesktopSettings,
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
});
