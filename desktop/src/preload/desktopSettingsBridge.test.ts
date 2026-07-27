import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const ipcRendererInvoke = vi.fn();
const ipcRendererSend = vi.fn();
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
    send: ipcRendererSend,
  },
}));

describe('bootstrapDesktopSettingsBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererInvoke.mockReset();
    ipcRendererSend.mockReset();
    ipcRendererOn.mockReset();
    ipcRendererRemoveListener.mockReset();
    ipcRendererInvoke.mockResolvedValue({ ok: true });
  });

  it('exposes Local Environment settings and runtime Flower IPC methods to Welcome', async () => {
    const { bootstrapDesktopSettingsBridge } = await import('./desktopSettingsBridge');

    bootstrapDesktopSettingsBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.save).toBe('function');
    expect(typeof bridge.requestRuntimeFlower).toBe('function');
    expect(typeof bridge.prepareRuntimeFlowerAttachment).toBe('function');
    expect(typeof bridge.writeRuntimeFlowerAttachmentChunk).toBe('function');
    expect(typeof bridge.commitRuntimeFlowerAttachment).toBe('function');
    expect(typeof bridge.cancelRuntimeFlowerAttachment).toBe('function');
    expect(typeof bridge.previewRuntimeFlowerAttachment).toBe('function');
    expect(typeof bridge.subscribeRuntimeFlowerAttachmentProgress).toBe('function');
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
    const digest = 'a'.repeat(64);
    await bridge.prepareRuntimeFlowerAttachment({
      operation_id: 'operation-1', upload_request_id: 'upload-1', staging_scope_id: 'staging-1', staging_capability: 'secret-1', source: 'uploaded_file',
      display_name: 'notes.txt', media_type: 'text/plain', size_bytes: 3,
      content_sha256: digest, display_name_sha256: digest,
    });
    await bridge.writeRuntimeFlowerAttachmentChunk({
      operation_id: 'operation-1', offset_bytes: 0, chunk: new Uint8Array([1, 2, 3]),
    });
    await bridge.commitRuntimeFlowerAttachment({ operation_id: 'operation-1' });
    await bridge.cancelRuntimeFlowerAttachment({ operation_id: 'operation-1' });
    await bridge.previewRuntimeFlowerAttachment({
      attachment_id: 'upl-preview-1', staging_scope_id: 'staging-1', staging_capability: 'secret-1', display_name: 'notes.txt',
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
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(3, 'redeven-desktop:runtime-flower-attachment-prepare', expect.objectContaining({
      operation_id: 'operation-1',
    }));
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(4, 'redeven-desktop:runtime-flower-attachment-chunk', expect.objectContaining({
      operation_id: 'operation-1', offset_bytes: 0,
    }));
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(5, 'redeven-desktop:runtime-flower-attachment-commit', { operation_id: 'operation-1' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(6, 'redeven-desktop:runtime-flower-attachment-cancel', { operation_id: 'operation-1' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(7, 'redeven-desktop:runtime-flower-attachment-preview', {
      attachment_id: 'upl-preview-1', staging_scope_id: 'staging-1', staging_capability: 'secret-1', display_name: 'notes.txt',
    });
    expect(ipcRendererSend).toHaveBeenCalledWith('redeven-desktop:cancel-settings');
    expect(Object.keys(bridge).sort()).toEqual([
      'cancel',
      'cancelRuntimeFlowerAttachment',
      'commitRuntimeFlowerAttachment',
      'prepareRuntimeFlowerAttachment',
      'previewRuntimeFlowerAttachment',
      'requestRuntimeFlower',
      'save',
      'subscribeRuntimeFlowerAttachmentProgress',
      'writeRuntimeFlowerAttachmentChunk',
    ]);
  });

  it('passes structured runtime Flower error data through IPC unchanged', async () => {
    const { bootstrapDesktopSettingsBridge } = await import('./desktopSettingsBridge');
    const result = {
      ok: false as const,
      error: {
        code: 'AI_THREAD_DELETE_OPERATION_FAILED',
        message: 'Thread delete failed.',
        status: 500,
        data: {
          operation_id: 'delete_operation_1',
          status: 'failed',
          intent_persisted: true,
        },
      },
      failureKind: 'response' as const,
    };
    ipcRendererInvoke.mockResolvedValueOnce(result);
    bootstrapDesktopSettingsBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    await expect(bridge.requestRuntimeFlower({
      method: 'DELETE',
      path: '/_redeven_proxy/api/ai/threads/thread-1?force=true',
    })).resolves.toEqual(result);
  });
});
