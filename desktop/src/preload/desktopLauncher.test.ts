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

describe('bootstrapDesktopLauncherBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererInvoke.mockReset();
    ipcRendererInvoke.mockResolvedValue(undefined);
  });

  it('exposes snapshot loading and action dispatch to the renderer', async () => {
    const { bootstrapDesktopLauncherBridge } = await import('./desktopLauncher');

    bootstrapDesktopLauncherBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.getSnapshot).toBe('function');
    expect(typeof bridge.performAction).toBe('function');

    await bridge.getSnapshot();
    await bridge.performAction({ kind: 'open_remote_device', external_local_ui_url: 'http://192.168.1.11:24000/' });

    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(1, 'redeven-desktop:launcher-get-snapshot');
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(2, 'redeven-desktop:launcher-perform-action', {
      kind: 'open_remote_device',
      external_local_ui_url: 'http://192.168.1.11:24000/',
    });
    expect(ipcRendererInvoke).toHaveBeenCalledTimes(2);
  });
});
