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

describe('bootstrapDesktopDownloadsBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererInvoke.mockReset();
    ipcRendererInvoke.mockResolvedValue({ ok: true });
  });

  it('exposes the desktop download bridge and forwards normalized calls', async () => {
    const { bootstrapDesktopDownloadsBridge } = await import('./desktopDownloads');

    bootstrapDesktopDownloadsBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.prepare).toBe('function');
    expect(typeof bridge.write).toBe('function');
    expect(typeof bridge.complete).toBe('function');
    expect(typeof bridge.abort).toBe('function');
    expect(typeof bridge.reveal).toBe('function');
    expect(typeof bridge.open).toBe('function');

    await bridge.prepare({ task_id: ' task ', suggested_name: ' report.txt ' });
    await bridge.write({ token: ' token ', chunk: new Uint8Array([1]) });
    await bridge.complete({ token: ' token ' });
    await bridge.abort({ token: ' token ', reason: 'failed' });
    await bridge.reveal({ token: ' token ' });
    await bridge.open({ token: ' token ' });

    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(1, 'redeven-desktop:download-prepare', {
      task_id: 'task',
      suggested_name: 'report.txt',
      total_bytes: undefined,
    });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(2, 'redeven-desktop:download-write', {
      token: 'token',
      chunk: new Uint8Array([1]),
    });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(3, 'redeven-desktop:download-complete', { token: 'token' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(4, 'redeven-desktop:download-abort', {
      token: 'token',
      reason: 'failed',
    });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(5, 'redeven-desktop:download-reveal', { token: 'token' });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(6, 'redeven-desktop:download-open', { token: 'token' });
  });

  it('rejects malformed renderer payloads before IPC invocation', async () => {
    const { bootstrapDesktopDownloadsBridge } = await import('./desktopDownloads');

    bootstrapDesktopDownloadsBridge();
    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];

    expect(await bridge.prepare({ suggested_name: 'missing-task' })).toMatchObject({ ok: false });
    expect(await bridge.write({ token: 'token', chunk: 'bad' })).toMatchObject({ ok: false });
    expect(await bridge.complete({ token: '' })).toMatchObject({ ok: false });
    expect(ipcRendererInvoke).not.toHaveBeenCalled();
  });
});
