import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const ipcRendererInvoke = vi.fn();
const ipcRendererOn = vi.fn();
const ipcRendererRemoveListener = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: ipcRendererInvoke,
    on: ipcRendererOn,
    removeListener: ipcRendererRemoveListener,
  },
}));

describe('bootstrapDesktopLauncherBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererInvoke.mockReset();
    ipcRendererOn.mockReset();
    ipcRendererRemoveListener.mockReset();
    ipcRendererInvoke.mockResolvedValue({ outcome: 'opened_environment_window' });
  });

  it('exposes snapshot loading, action dispatch, and snapshot subscriptions to the renderer', async () => {
    const { bootstrapDesktopLauncherBridge } = await import('./desktopLauncher');

    bootstrapDesktopLauncherBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.getSnapshot).toBe('function');
    expect(typeof bridge.performAction).toBe('function');
    expect(typeof bridge.subscribeSnapshot).toBe('function');

    await bridge.getSnapshot();
    await bridge.performAction({
      kind: 'open_remote_environment',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      environment_id: 'env-1',
      label: 'Work laptop',
    });
    const unsubscribe = bridge.subscribeSnapshot(() => undefined);

    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(1, 'redeven-desktop:launcher-get-snapshot');
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(2, 'redeven-desktop:launcher-perform-action', {
      kind: 'open_remote_environment',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      environment_id: 'env-1',
      label: 'Work laptop',
    });
    expect(ipcRendererInvoke).toHaveBeenCalledTimes(2);
    expect(ipcRendererOn).toHaveBeenCalledWith(
      'redeven-desktop:launcher-snapshot-updated',
      expect.any(Function),
    );

    unsubscribe();

    expect(ipcRendererRemoveListener).toHaveBeenCalledWith(
      'redeven-desktop:launcher-snapshot-updated',
      expect.any(Function),
    );
  });
});
