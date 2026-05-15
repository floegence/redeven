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
    ipcRendererInvoke.mockImplementation((channel: string) => {
      if (channel === 'redeven-desktop:launcher-get-ssh-config-hosts') {
        return Promise.resolve([
          {
            alias: 'devbox',
            host_name: 'devbox.internal',
            user: 'ops',
            port: 2222,
            source_path: '/Users/tester/.ssh/config',
          },
        ]);
      }
      if (channel === 'redeven-desktop:launcher-list-runtime-containers') {
        return Promise.resolve({
          ok: true,
          containers: [
            {
              engine: 'docker',
              container_id: 'container-stable-id',
              container_label: 'dev-container',
              image: 'redeven-dev:latest',
              status_text: 'Up 2 minutes',
            },
          ],
        });
      }
      return Promise.resolve({ ok: true, outcome: 'opened_environment_window' });
    });
  });

  it('exposes snapshot loading, SSH config hosts, container listing, action dispatch, and snapshot subscriptions to the renderer', async () => {
    const { bootstrapDesktopLauncherBridge } = await import('./desktopLauncher');

    bootstrapDesktopLauncherBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.getSnapshot).toBe('function');
    expect(typeof bridge.getSSHConfigHosts).toBe('function');
    expect(typeof bridge.listRuntimeContainers).toBe('function');
    expect(typeof bridge.performAction).toBe('function');
    expect(typeof bridge.subscribeActionProgress).toBe('function');
    expect(typeof bridge.subscribeSnapshot).toBe('function');

    await bridge.getSnapshot();
    await expect(bridge.getSSHConfigHosts()).resolves.toEqual([
      {
        alias: 'devbox',
        host_name: 'devbox.internal',
        user: 'ops',
        port: 2222,
        source_path: '/Users/tester/.ssh/config',
      },
    ]);
    await expect(bridge.listRuntimeContainers({
      host_access: { kind: 'local_host' },
      engine: 'docker',
    })).resolves.toEqual({
      ok: true,
      containers: [
        {
          engine: 'docker',
          container_id: 'container-stable-id',
          container_label: 'dev-container',
          image: 'redeven-dev:latest',
          status_text: 'Up 2 minutes',
        },
      ],
    });
    await bridge.performAction({
      kind: 'open_remote_environment',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      environment_id: 'env-1',
      label: 'Work laptop',
    });
    const unsubscribeProgress = bridge.subscribeActionProgress(() => undefined);
    const unsubscribe = bridge.subscribeSnapshot(() => undefined);

    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(1, 'redeven-desktop:launcher-get-snapshot');
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(2, 'redeven-desktop:launcher-get-ssh-config-hosts');
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(3, 'redeven-desktop:launcher-list-runtime-containers', {
      host_access: { kind: 'local_host' },
      engine: 'docker',
    });
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(4, 'redeven-desktop:launcher-perform-action', {
      kind: 'open_remote_environment',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      environment_id: 'env-1',
      label: 'Work laptop',
    });
    expect(ipcRendererInvoke).toHaveBeenCalledTimes(4);
    expect(ipcRendererOn).toHaveBeenCalledWith(
      'redeven-desktop:launcher-action-progress',
      expect.any(Function),
    );
    expect(ipcRendererOn).toHaveBeenCalledWith(
      'redeven-desktop:launcher-snapshot-updated',
      expect.any(Function),
    );

    unsubscribeProgress();
    unsubscribe();

    expect(ipcRendererRemoveListener).toHaveBeenCalledWith(
      'redeven-desktop:launcher-action-progress',
      expect.any(Function),
    );
    expect(ipcRendererRemoveListener).toHaveBeenCalledWith(
      'redeven-desktop:launcher-snapshot-updated',
      expect.any(Function),
    );
  });
});
