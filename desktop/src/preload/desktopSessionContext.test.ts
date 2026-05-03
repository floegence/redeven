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
      managed_environment_id: 'env_demo',
      environment_storage_scope_id: 'env_demo',
    });
  });

  it('exposes session context reads and app-ready notifications', async () => {
    const { bootstrapDesktopSessionContextBridge } = await import('./desktopSessionContext');

    bootstrapDesktopSessionContextBridge();
    const bridge = exposedBridge();

    expect(bridge.getSnapshot()).toEqual({
      managed_environment_id: 'env_demo',
      environment_storage_scope_id: 'env_demo',
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
});
