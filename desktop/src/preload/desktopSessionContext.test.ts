// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopSessionContextBridge } from './desktopSessionContext';

const exposeInMainWorld = vi.fn();
const ipcRendererInvoke = vi.fn();
const ipcRendererOn = vi.fn();
const ipcRendererSend = vi.fn();
const ipcRendererSendSync = vi.fn();

function exposedBridge(): DesktopSessionContextBridge {
  const bridge = exposeInMainWorld.mock.calls.find(([bridgeName]) => bridgeName === 'redevenDesktopSessionContext')?.[1];
  if (!bridge) {
    throw new Error('Missing exposed desktop session context bridge.');
  }
  return bridge as DesktopSessionContextBridge;
}

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: ipcRendererInvoke,
    on: ipcRendererOn,
    send: ipcRendererSend,
    sendSync: ipcRendererSendSync,
  },
}));

describe('bootstrapDesktopSessionContextBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererInvoke.mockReset();
    ipcRendererOn.mockReset();
    ipcRendererSend.mockReset();
    ipcRendererSendSync.mockReset();
    ipcRendererInvoke.mockResolvedValue(false);
    ipcRendererSendSync.mockImplementation((channel: string) => {
      if (channel === 'redeven-desktop:session-transport-recovery-get') {
        return null;
      }
      return {
        local_environment_id: 'local',
        renderer_storage_scope_id: 'local',
        target_kind: 'local_environment',
        target_route: 'local_host',
      };
    });
  });

  it('exposes session context reads and app-ready notifications', async () => {
    const { bootstrapDesktopSessionContextBridge } = await import('./desktopSessionContext');

    bootstrapDesktopSessionContextBridge();
    const bridge = exposedBridge();

    expect(bridge.getSnapshot()).toEqual({
      local_environment_id: 'local',
      renderer_storage_scope_id: 'local',
      target_kind: 'local_environment',
      target_route: 'local_host',
    });

    bridge.notifyAppReady({ state: 'access_gate_interactive' });
    bridge.notifyAppReady({
      state: 'runtime_connected',
      timings: {
        bootstrap_ms: 12.4,
        access_ready_ms: 35.6,
        protocol_connected_ms: 98.2,
        shell_painted_ms: 112.8,
      },
    });
    bridge.notifyAppReady({ state: 'invalid' as never });

    expect(ipcRendererSend).toHaveBeenNthCalledWith(
      1,
      'redeven-desktop:session-app-ready',
      { state: 'access_gate_interactive' },
    );
    expect(ipcRendererSend).toHaveBeenNthCalledWith(
      2,
      'redeven-desktop:session-app-ready',
      {
        state: 'runtime_connected',
        timings: {
          bootstrap_ms: 12,
          access_ready_ms: 36,
          protocol_connected_ms: 98,
          shell_painted_ms: 113,
        },
      },
    );
    expect(ipcRendererSend).toHaveBeenCalledTimes(2);
  });

  it('exposes provider session identity fields through the session bridge', async () => {
    ipcRendererSendSync.mockReturnValue({
      local_environment_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      renderer_storage_scope_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      target_kind: 'local_environment',
      target_route: 'remote_desktop',
      session_source: 'provider_environment',
      provider_origin: ' https://provider.example.invalid ',
      provider_id: ' provider-1 ',
      env_public_id: ' env_demo ',
      label: ' Demo Environment ',
    });

    const { bootstrapDesktopSessionContextBridge } = await import('./desktopSessionContext');

    bootstrapDesktopSessionContextBridge();
    const bridge = exposedBridge();

    expect(bridge.getSnapshot()).toEqual({
      local_environment_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      renderer_storage_scope_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      target_kind: 'local_environment',
      target_route: 'remote_desktop',
      session_source: 'provider_environment',
      provider_origin: 'https://provider.example.invalid',
      provider_id: 'provider-1',
      env_public_id: 'env_demo',
      label: 'Demo Environment',
    });
  });

  it('preserves Gateway session identity fields through the session bridge', async () => {
    ipcRendererSendSync.mockReturnValue({
      local_environment_id: 'gateway:gw_demo:env:env_demo',
      renderer_storage_scope_id: 'gateway:gw_demo:env:env_demo',
      target_kind: 'gateway_environment',
      target_route: 'remote_desktop',
      session_source: 'runtime_gateway',
      env_public_id: ' env_demo ',
      label: ' Gateway Environment ',
    });

    const { bootstrapDesktopSessionContextBridge } = await import('./desktopSessionContext');

    bootstrapDesktopSessionContextBridge();
    const bridge = exposedBridge();

    expect(bridge.getSnapshot()).toEqual({
      local_environment_id: 'gateway:gw_demo:env:env_demo',
      renderer_storage_scope_id: 'gateway:gw_demo:env:env_demo',
      target_kind: 'gateway_environment',
      target_route: 'remote_desktop',
      session_source: 'runtime_gateway',
      env_public_id: 'env_demo',
      label: 'Gateway Environment',
    });
  });

  it.each([
    ['missing route', {
      local_environment_id: 'ssh:devbox',
      renderer_storage_scope_id: 'ssh:devbox',
      target_kind: 'ssh_environment',
    }],
    ['invalid route', {
      local_environment_id: 'ssh:devbox',
      renderer_storage_scope_id: 'ssh:devbox',
      target_kind: 'ssh_environment',
      target_route: 'browser',
    }],
  ])('rejects an incomplete session contract with %s', async (_label, snapshot) => {
    ipcRendererSendSync.mockReturnValue(snapshot);
    const { bootstrapDesktopSessionContextBridge } = await import('./desktopSessionContext');

    bootstrapDesktopSessionContextBridge();

    expect(exposedBridge().getSnapshot()).toBeNull();
  });

  it('publishes only monotonic transport recovery snapshots and requests an immediate retry', async () => {
    ipcRendererSendSync.mockImplementation((channel: string) => {
      if (channel === 'redeven-desktop:session-transport-recovery-get') {
        return {
          generation: 2,
          revision: 4,
          phase: 'waiting',
          attempt_count: 1,
          started_at_unix_ms: 100,
          next_attempt_at_unix_ms: 200,
          failure: {
            code: 'transport_interrupted',
            error_name: 'DesktopSSHTransportInterruptedError',
            technical_detail: 'SSH transport was interrupted.',
          },
          actions: ['retry_now'],
        };
      }
      return {
        local_environment_id: 'ssh:demo',
        renderer_storage_scope_id: 'ssh:demo',
        target_kind: 'ssh_environment',
        target_route: 'remote_desktop',
      };
    });
    ipcRendererInvoke.mockResolvedValue(true);
    const { bootstrapDesktopSessionContextBridge } = await import('./desktopSessionContext');

    bootstrapDesktopSessionContextBridge();
    const bridge = exposedBridge();
    const snapshots: unknown[] = [];
    bridge.subscribeTransportRecovery((snapshot) => snapshots.push(snapshot));
    const eventListener = ipcRendererOn.mock.calls.find(([
      channel,
    ]) => channel === 'redeven-desktop:session-transport-recovery-updated')?.[1];
    if (typeof eventListener !== 'function') {
      throw new Error('Missing transport recovery event listener.');
    }

    eventListener({}, {
      generation: 2,
      revision: 3,
      phase: 'connecting',
      attempt_count: 2,
      actions: [],
    });
    eventListener({}, {
      generation: 2,
      revision: 5,
      phase: 'ready',
      attempt_count: 2,
      started_at_unix_ms: 100,
      recovered_at_unix_ms: 240,
      actions: [],
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({ phase: 'waiting', revision: 4 });
    expect(snapshots[1]).toMatchObject({ phase: 'ready', revision: 5, attempt_count: 2 });
    await expect(bridge.requestTransportRecoveryNow()).resolves.toBe(true);
    expect(ipcRendererInvoke).toHaveBeenCalledWith('redeven-desktop:session-transport-recovery-retry');
  });
});
