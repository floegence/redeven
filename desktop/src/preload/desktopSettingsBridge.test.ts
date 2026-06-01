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

  it('exposes Local Environment and Flower Host settings IPC methods to Welcome', async () => {
    const { bootstrapDesktopSettingsBridge } = await import('./desktopSettingsBridge');

    bootstrapDesktopSettingsBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.save).toBe('function');
    expect(typeof bridge.loadFlowerHostSettings).toBe('function');
    expect(typeof bridge.saveFlowerHostSettings).toBe('function');
    expect(typeof bridge.listFlowerHostThreads).toBe('function');
    expect(typeof bridge.loadFlowerHostThread).toBe('function');
    expect(typeof bridge.resolveFlowerHostHandler).toBe('function');
    expect(typeof bridge.sendFlowerHostChat).toBe('function');
    expect(typeof bridge.cancel).toBe('function');

    await bridge.save({
      local_ui_bind: 'localhost:23998',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      auto_runtime_probe_enabled: true,
    });
    await bridge.loadFlowerHostSettings();
    await bridge.saveFlowerHostSettings({
      config: {
        schema_version: 1,
        enabled: false,
        current_model_id: '',
        execution_policy: {
          require_user_approval: true,
          block_dangerous_commands: true,
        },
        terminal_exec_policy: {
          default_timeout_ms: 120_000,
          max_timeout_ms: 600_000,
        },
        providers: [],
      },
    });
    await bridge.listFlowerHostThreads();
    await bridge.loadFlowerHostThread('thread-1');
    await bridge.resolveFlowerHostHandler({ thread_kind: 'chat', client_surface: 'flower_surface' });
    await bridge.sendFlowerHostChat({ prompt: 'hello' });
    bridge.cancel();

    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(1, 'redeven-desktop:save-settings', {
      local_ui_bind: 'localhost:23998',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      auto_runtime_probe_enabled: true,
    });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(2, 'redeven-desktop:flower-host-settings-load');
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(3, 'redeven-desktop:flower-host-settings-save', {
      config: expect.objectContaining({
        schema_version: 1,
        providers: [],
      }),
    });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(4, 'redeven-desktop:flower-host-threads-list');
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(5, 'redeven-desktop:flower-host-thread-load', 'thread-1');
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(6, 'redeven-desktop:flower-host-handler-resolve', { thread_kind: 'chat', client_surface: 'flower_surface' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(7, 'redeven-desktop:flower-host-chat-send', { prompt: 'hello' });
    expect(ipcRendererSend).toHaveBeenCalledWith('redeven-desktop:cancel-settings');
  });
});
