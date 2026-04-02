import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const ipcRendererInvoke = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: ipcRendererInvoke,
  },
}));

describe('bootstrapDesktopShellBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererInvoke.mockReset();
    ipcRendererInvoke.mockResolvedValue(undefined);
  });

  it('forwards chooser actions to electron main while keeping legacy aliases', async () => {
    const { bootstrapDesktopShellBridge } = await import('./desktopShell');

    bootstrapDesktopShellBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.openDeviceChooser).toBe('function');
    expect(typeof bridge.switchDevice).toBe('function');
    expect(typeof bridge.openConnectionCenter).toBe('function');
    expect(typeof bridge.openAdvancedSettings).toBe('function');
    expect(typeof bridge.openConnectToRedeven).toBe('function');
    expect(typeof bridge.openDesktopSettings).toBe('function');
    expect(typeof bridge.openWindow).toBe('function');
    expect(typeof bridge.openExternalURL).toBe('function');
    expect(typeof bridge.restartManagedRuntime).toBe('function');

    await bridge.openDeviceChooser();
    await bridge.switchDevice();
    await bridge.openConnectionCenter();
    await bridge.openAdvancedSettings();
    await bridge.openConnectToRedeven();
    await bridge.openDesktopSettings();
    await bridge.openWindow('switch_device');
    await bridge.openWindow('connect');
    await bridge.openWindow('advanced_settings');
    await bridge.openWindow('invalid');
    await bridge.openExternalURL('http://127.0.0.1:43123/cs/demo/');
    await bridge.restartManagedRuntime();

    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(1, 'redeven-desktop:shell-open-window', { kind: 'connection_center' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(2, 'redeven-desktop:shell-open-window', { kind: 'connection_center' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(3, 'redeven-desktop:shell-open-window', { kind: 'connection_center' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(4, 'redeven-desktop:shell-open-window', { kind: 'settings' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(5, 'redeven-desktop:shell-open-window', { kind: 'connection_center' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(6, 'redeven-desktop:shell-open-window', { kind: 'settings' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(7, 'redeven-desktop:shell-open-window', { kind: 'connection_center' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(8, 'redeven-desktop:shell-open-window', { kind: 'connection_center' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(9, 'redeven-desktop:shell-open-window', { kind: 'settings' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(10, 'redeven-desktop:shell-open-external-url', { url: 'http://127.0.0.1:43123/cs/demo/' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(11, 'redeven-desktop:shell-runtime-action', { action: 'restart_managed_runtime' });
    expect(ipcRendererInvoke).toHaveBeenCalledTimes(11);
  });
});
