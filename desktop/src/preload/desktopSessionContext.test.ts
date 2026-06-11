// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopSessionContextBridge } from './desktopSessionContext';

const exposeInMainWorld = vi.fn();
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
    send: ipcRendererSend,
    sendSync: ipcRendererSendSync,
  },
}));

describe('bootstrapDesktopSessionContextBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererSend.mockReset();
    ipcRendererSendSync.mockReset();
    ipcRendererSendSync.mockReturnValue({
      local_environment_id: 'local',
      renderer_storage_scope_id: 'local',
      target_kind: 'local_environment',
      target_route: 'local_host',
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
    bridge.notifyAppReady({ state: 'runtime_connected' });
    bridge.notifyAppReady({ state: 'invalid' as never });

    expect(ipcRendererSend).toHaveBeenNthCalledWith(
      1,
      'redeven-desktop:session-app-ready',
      { state: 'access_gate_interactive' },
    );
    expect(ipcRendererSend).toHaveBeenNthCalledWith(
      2,
      'redeven-desktop:session-app-ready',
      { state: 'runtime_connected' },
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
});
