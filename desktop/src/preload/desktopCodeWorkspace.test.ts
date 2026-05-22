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

describe('bootstrapDesktopCodeWorkspaceBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererInvoke.mockReset();
  });

  it('forwards explicit workspace preparation requests to electron main', async () => {
    ipcRendererInvoke.mockResolvedValue({ ok: true, prepared: true });
    const { bootstrapDesktopCodeWorkspaceBridge } = await import('./desktopCodeWorkspace');

    bootstrapDesktopCodeWorkspaceBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.prepareWorkspaceEngine).toBe('function');
    const result = await bridge.prepareWorkspaceEngine({ reason: 'open' });

    expect(result).toEqual({ ok: true, prepared: true, message: undefined, status: undefined });
    expect(ipcRendererInvoke).toHaveBeenCalledWith('redeven-desktop:code-workspace-prepare', { reason: 'open' });
  });

  it('exposes session-mediated package job methods', async () => {
    ipcRendererInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'redeven-desktop:code-workspace-package-prepare') {
        return {
          ok: true,
          job: {
            job_id: 'job_1',
            manifest: { engine: 'code-server' },
            archive_size_bytes: 3,
            chunk_size_bytes: 2,
            from_cache: true,
          },
        };
      }
      if (channel === 'redeven-desktop:code-workspace-package-chunk') {
        return {
          ok: true,
          chunk: new Uint8Array([1, 2]),
          offset_bytes: 0,
          length_bytes: 2,
          done: false,
        };
      }
      if (channel === 'redeven-desktop:code-workspace-package-dispose') {
        return { ok: true };
      }
      return { ok: false };
    });
    const { bootstrapDesktopCodeWorkspaceBridge } = await import('./desktopCodeWorkspace');

    bootstrapDesktopCodeWorkspaceBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.prepareWorkspaceEnginePackage).toBe('function');
    expect(typeof bridge.readWorkspaceEnginePackageChunk).toBe('function');
    expect(typeof bridge.disposeWorkspaceEnginePackage).toBe('function');

    await expect(bridge.prepareWorkspaceEnginePackage({
      platform: { os: 'linux', arch: 'amd64', libc: 'glibc', platform_id: 'linux-amd64-glibc' },
    })).resolves.toMatchObject({ ok: true, job: { job_id: 'job_1' } });
    await expect(bridge.readWorkspaceEnginePackageChunk({ job_id: 'job_1', offset_bytes: 0, length_bytes: 2 }))
      .resolves.toMatchObject({ ok: true, offset_bytes: 0, length_bytes: 2 });
    await expect(bridge.disposeWorkspaceEnginePackage({ job_id: 'job_1' })).resolves.toEqual({ ok: true, message: undefined });

    expect(ipcRendererInvoke).toHaveBeenCalledWith('redeven-desktop:code-workspace-package-prepare', {
      platform: { os: 'linux', arch: 'amd64', libc: 'glibc', platform_id: 'linux-amd64-glibc' },
    });
    expect(ipcRendererInvoke).toHaveBeenCalledWith('redeven-desktop:code-workspace-package-chunk', {
      job_id: 'job_1',
      offset_bytes: 0,
      length_bytes: 2,
    });
    expect(ipcRendererInvoke).toHaveBeenCalledWith('redeven-desktop:code-workspace-package-dispose', { job_id: 'job_1' });
  });
});
