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
    expect(typeof bridge.markFlowerHostThreadRead).toBe('function');
    expect(typeof bridge.renameFlowerHostThread).toBe('function');
    expect(typeof bridge.setFlowerHostThreadPinned).toBe('function');
    expect(typeof bridge.forkFlowerHostThread).toBe('function');
    expect(typeof bridge.resolveFlowerHostHandler).toBe('function');
    expect(typeof bridge.sendFlowerHostChat).toBe('function');
    expect(typeof bridge.submitFlowerHostInput).toBe('function');
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
    await bridge.markFlowerHostThreadRead({ thread_id: 'thread-1' });
    await bridge.renameFlowerHostThread({ thread_id: 'thread-1', title: 'Renamed' });
    await bridge.setFlowerHostThreadPinned({ thread_id: 'thread-1', pinned: true });
    await bridge.forkFlowerHostThread({ thread_id: 'thread-1' });
    await bridge.resolveFlowerHostHandler({ thread_kind: 'chat', client_surface: 'flower_surface' });
    await bridge.sendFlowerHostChat({ prompt: 'hello' });
    await bridge.submitFlowerHostInput({
      thread_id: 'thread-1',
      prompt_id: 'prompt-1',
      answers: {
        target: { choice_id: 'staging' },
      },
    });
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
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(6, 'redeven-desktop:flower-host-thread-read-mark', { thread_id: 'thread-1' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(7, 'redeven-desktop:flower-host-thread-rename', { thread_id: 'thread-1', title: 'Renamed' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(8, 'redeven-desktop:flower-host-thread-pinned-set', { thread_id: 'thread-1', pinned: true });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(9, 'redeven-desktop:flower-host-thread-fork', { thread_id: 'thread-1' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(10, 'redeven-desktop:flower-host-handler-resolve', { thread_kind: 'chat', client_surface: 'flower_surface' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(11, 'redeven-desktop:flower-host-chat-send', { prompt: 'hello' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(12, 'redeven-desktop:flower-host-input-submit', {
      thread_id: 'thread-1',
      prompt_id: 'prompt-1',
      answers: {
        target: { choice_id: 'staging' },
      },
    });
    expect(ipcRendererSend).toHaveBeenCalledWith('redeven-desktop:cancel-settings');
  });
});
