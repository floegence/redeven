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

  it('prefers the canonical connection-center and advanced-settings bridge methods', async () => {
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

  it('falls back to the legacy aliases for compatibility', async () => {
    const openConnectToRedevenBridge = vi.fn().mockResolvedValue(undefined);
    const openDesktopSettingsBridge = vi.fn().mockResolvedValue(undefined);
    window.redevenDesktopShell = {
      openConnectToRedeven: openConnectToRedevenBridge,
      openDesktopSettings: openDesktopSettingsBridge,
    };

    expect(desktopShellBridgeAvailable()).toBe(true);
    await expect(openDesktopConnectToRedeven()).resolves.toBe(true);
    await expect(openDesktopSettings()).resolves.toBe(true);

    expect(openConnectToRedevenBridge).toHaveBeenCalledTimes(1);
    expect(openDesktopSettingsBridge).toHaveBeenCalledTimes(1);
  });
});
