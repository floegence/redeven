import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const ipcRendererInvoke = vi.fn();
const ipcRendererSend = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: ipcRendererInvoke,
    send: ipcRendererSend,
  },
}));

describe('bootstrapDesktopSettingsBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererInvoke.mockReset();
    ipcRendererSend.mockReset();
    ipcRendererInvoke.mockResolvedValue({ ok: true });
  });

  it('exposes Local Environment settings and runtime Flower IPC methods to Welcome', async () => {
    const { bootstrapDesktopSettingsBridge } = await import('./desktopSettingsBridge');

    bootstrapDesktopSettingsBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.save).toBe('function');
    expect(typeof bridge.requestRuntimeFlower).toBe('function');
    expect(typeof bridge.cancel).toBe('function');

    await bridge.save({
      local_ui_bind: 'localhost:23998',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      auto_runtime_probe_enabled: true,
    });
    await bridge.requestRuntimeFlower({
      method: 'GET',
      path: '/_redeven_proxy/api/settings',
    });
    bridge.cancel();

    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(1, 'redeven-desktop:save-settings', {
      local_ui_bind: 'localhost:23998',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      auto_runtime_probe_enabled: true,
    });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(2, 'redeven-desktop:runtime-flower-request', {
      method: 'GET',
      path: '/_redeven_proxy/api/settings',
    });
    expect(ipcRendererSend).toHaveBeenCalledWith('redeven-desktop:cancel-settings');
    expect(Object.keys(bridge).sort()).toEqual(['cancel', 'requestRuntimeFlower', 'save']);
  });
});
