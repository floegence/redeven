import { describe, expect, it, vi } from 'vitest';
import { EnvironmentSettingsConnections } from './environmentSettingsConnections';
import { RuntimePlacementBridgeRegistry, type RuntimePlacementBridgeRecord } from './runtimePlacementBridgeRegistry';
import type { DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import type { RuntimePlacementBridgeTermination } from './runtimePlacementBridgeSession';

function fixture() {
  const targetID = 'target' as DesktopRuntimeTargetID;
  let close!: (value: RuntimePlacementBridgeTermination) => void;
  const closed = new Promise<RuntimePlacementBridgeTermination>(resolve => { close = resolve; });
  const disconnect = vi.fn(async () => { close({ kind: 'closed' }); });
  const record = { session: { placement_target_id: targetID, closed, disconnect } } as unknown as RuntimePlacementBridgeRecord;
  const registry = new RuntimePlacementBridgeRegistry(vi.fn());
  const create = vi.fn(async () => record);
  const connect = vi.fn((_id: string, owner: string, signal: AbortSignal) => registry.acquire(targetID, owner, create, signal));
  return { registry, create, connect, disconnect, scopes: new EnvironmentSettingsConnections(connect) };
}
const request = { environment_id: 'target', dialog_token: 1 };

describe('EnvironmentSettingsConnections', () => {
  it('rejects the first request when its close message arrived first', async () => {
    const { scopes, create } = fixture();
    scopes.close(1, 1);
    await expect(scopes.use(1, request, async () => null)).rejects.toMatchObject({ code: 'SETTINGS_CLOSED' });
    expect(create).not.toHaveBeenCalled();
    await scopes.use(1, { ...request, dialog_token: 2 }, async () => null);
    scopes.destroy(1);
  });

  it('shares one connection for parallel reads and rejects late requests after close', async () => {
    const { scopes, create, disconnect } = fixture();
    await Promise.all(Array.from({ length: 20 }, () => scopes.use(1, request, async () => 'status')));
    expect(create).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
    scopes.close(1, 1);
    await expect(scopes.use(1, request, async () => 'late')).rejects.toMatchObject({ code: 'SETTINGS_CLOSED' });
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  });

  it('finishes an admitted write after the settings dialog closes', async () => {
    const { scopes, disconnect } = fixture();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    let entered = false;
    const write = scopes.use(1, request, async () => { entered = true; await gate; return 'saved'; });
    await vi.waitFor(() => expect(entered).toBe(true));
    scopes.close(1, 1);
    expect(disconnect).not.toHaveBeenCalled();
    finish();
    await expect(write).resolves.toBe('saved');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('binds each opening to its sender and environment', async () => {
    const { scopes, create } = fixture();
    await scopes.use(1, request, async () => null);
    await expect(scopes.use(1, { ...request, environment_id: 'other' }, async () => null)).rejects.toMatchObject({ code: 'SETTINGS_CLOSED' });
    await scopes.use(2, request, async () => null);
    scopes.destroy(1);
    await scopes.use(2, request, async () => null);
    expect(create).toHaveBeenCalledTimes(1);
    scopes.destroy(2);
  });
});
