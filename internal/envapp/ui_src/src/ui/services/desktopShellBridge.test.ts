// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  desktopShellBridgeAvailable,
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

  it('forwards Desktop shell actions to the browser bridge', async () => {
    const openConnectToRedeven = vi.fn().mockResolvedValue(undefined);
    const openDesktopSettingsBridge = vi.fn().mockResolvedValue(undefined);
    window.redevenDesktopShell = {
      openConnectToRedeven,
      openDesktopSettings: openDesktopSettingsBridge,
    };

    expect(desktopShellBridgeAvailable()).toBe(true);
    await expect(openDesktopConnectToRedeven()).resolves.toBe(true);
    await expect(openDesktopSettings()).resolves.toBe(true);

    expect(openConnectToRedeven).toHaveBeenCalledTimes(1);
    expect(openDesktopSettingsBridge).toHaveBeenCalledTimes(1);
  });
});
