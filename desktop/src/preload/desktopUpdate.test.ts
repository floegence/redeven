// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const ipcRendererInvoke = vi.fn();
const ipcRendererOn = vi.fn();
const ipcRendererRemoveListener = vi.fn();
let snapshotListener: ((event: unknown, payload: unknown) => void) | null = null;
let openListener: (() => void) | null = null;

function exposedBridge<T>(name: string): T {
  const bridge = exposeInMainWorld.mock.calls.find(([bridgeName]) => bridgeName === name)?.[1];
  if (!bridge) throw new Error(`Missing exposed bridge: ${name}`);
  return bridge as T;
}

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    invoke: ipcRendererInvoke,
    on: ipcRendererOn,
    removeListener: ipcRendererRemoveListener,
  },
}));

const snapshot = {
  platform: 'linux_package',
  state: 'available',
  current_version: '1.0.0',
  available_version: '1.1.0',
  automatically_checks_for_updates: true,
  capabilities: ['check', 'download', 'open_update_ui'],
};

describe('bootstrapDesktopUpdateBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererInvoke.mockReset();
    ipcRendererOn.mockReset();
    ipcRendererRemoveListener.mockReset();
    snapshotListener = null;
    openListener = null;
    ipcRendererInvoke.mockResolvedValue(snapshot);
    ipcRendererOn.mockImplementation((channel: string, listener: (...args: unknown[]) => void) => {
      if (channel.endsWith('snapshot-updated')) snapshotListener = listener as typeof snapshotListener;
      if (channel.endsWith('open-requested')) openListener = listener as typeof openListener;
    });
  });

  it('normalizes actions, forwards IPC, and receives update snapshots', async () => {
    const { bootstrapDesktopUpdateBridge } = await import('./desktopUpdate');
    bootstrapDesktopUpdateBridge();
    const bridge = exposedBridge<{
      getSnapshot: () => Promise<unknown>;
      perform: (action: unknown) => Promise<unknown>;
      subscribe: (listener: (value: unknown) => void) => () => void;
      subscribeOpenRequested: (listener: () => void) => () => void;
    }>('redevenDesktopUpdate');

    const listener = vi.fn();
    const open = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    const unsubscribeOpen = bridge.subscribeOpenRequested(open);
    expect(await bridge.getSnapshot()).toMatchObject({ state: 'available', available_version: '1.1.0' });
    await bridge.perform({ kind: 'check_for_updates' });
    expect(ipcRendererInvoke).toHaveBeenCalledWith('redeven-desktop:update-perform-action', { kind: 'check_for_updates' });

    snapshotListener?.({}, snapshot);
    openListener?.();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ state: 'available' }));
    expect(open).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribeOpen();
    expect(ipcRendererRemoveListener).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed actions without invoking main-process IPC', async () => {
    const { bootstrapDesktopUpdateBridge } = await import('./desktopUpdate');
    bootstrapDesktopUpdateBridge();
    const bridge = exposedBridge<{ perform: (action: unknown) => Promise<{ ok: boolean; message: string }> }>('redevenDesktopUpdate');
    const result = await bridge.perform({ kind: 'unknown' });
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Invalid Desktop update action.');
    expect(ipcRendererInvoke).not.toHaveBeenCalled();
  });
});
