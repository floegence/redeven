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

  it('forwards desktop shell actions to electron main through the canonical bridge', async () => {
    const { bootstrapDesktopShellBridge } = await import('./desktopShell');

    bootstrapDesktopShellBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.openConnectionCenter).toBe('function');
    expect(typeof bridge.openAdvancedSettings).toBe('function');
    expect(typeof bridge.openWindow).toBe('function');
    expect(typeof bridge.openExternalURL).toBe('function');
    expect(typeof bridge.restartManagedRuntime).toBe('function');

    await bridge.openConnectionCenter();
    await bridge.openAdvancedSettings();
    await bridge.openWindow('connect');
    await bridge.openWindow('advanced_settings');
    await bridge.openWindow('invalid');
    await bridge.openExternalURL('http://127.0.0.1:43123/cs/demo/');
    await bridge.restartManagedRuntime();

    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(1, 'redeven-desktop:shell-open-window', { kind: 'connection_center' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(2, 'redeven-desktop:shell-open-window', { kind: 'settings' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(3, 'redeven-desktop:shell-open-window', { kind: 'connection_center' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(4, 'redeven-desktop:shell-open-window', { kind: 'settings' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(5, 'redeven-desktop:shell-open-external-url', { url: 'http://127.0.0.1:43123/cs/demo/' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(6, 'redeven-desktop:shell-runtime-action', { action: 'restart_managed_runtime' });
    expect(ipcRendererInvoke).toHaveBeenCalledTimes(6);
  });
});
