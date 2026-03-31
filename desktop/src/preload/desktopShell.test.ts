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

  it('forwards connect and settings actions to electron main', async () => {
    const { bootstrapDesktopShellBridge } = await import('./desktopShell');

    bootstrapDesktopShellBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.openConnectToRedeven).toBe('function');
    expect(typeof bridge.openDesktopSettings).toBe('function');
    expect(typeof bridge.openWindow).toBe('function');

    await bridge.openConnectToRedeven();
    await bridge.openDesktopSettings();
    await bridge.openWindow('connect');
    await bridge.openWindow('invalid');

    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(1, 'redeven-desktop:shell-open-window', { kind: 'connect' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(2, 'redeven-desktop:shell-open-window', { kind: 'settings' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(3, 'redeven-desktop:shell-open-window', { kind: 'connect' });
    expect(ipcRendererInvoke).toHaveBeenCalledTimes(3);
  });
});
