import { describe, expect, it, vi } from 'vitest';
import { EnvironmentManagementConnections } from './environmentManagementConnections';
import { RuntimeControlError } from './runtimeControlClient';
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
  return { registry, create, connect, disconnect, scopes: new EnvironmentManagementConnections(connect) };
}
const request = { environment_id: 'target', dialog_token: 1 };

describe('EnvironmentManagementConnections', () => {
  it('retains Gateway authentication across steps and retries a rejected password without saving it', async () => {
    const f = fixture();
    const connect = vi.fn(async (id: string, owner: string, signal: AbortSignal, password?: string) => {
      if (password !== ' temporary password ') throw new RuntimeControlError('SSH_AUTHENTICATION_REQUIRED', 'Authenticate');
      return f.connect(id, owner, signal);
    });
    const gateway = new EnvironmentManagementConnections(connect, 'gateway');
    await expect(gateway.use(1, request, async () => 'status')).rejects.toMatchObject({ code: 'SSH_AUTHENTICATION_REQUIRED' });
    await expect(gateway.use(1, request, async () => 'status', 'wrong')).rejects.toMatchObject({ code: 'SSH_AUTHENTICATION_REQUIRED' });
    await expect(gateway.use(1, request, async () => 'status', ' temporary password ')).resolves.toBe('status');
    const app = await f.registry.acquire('target' as DesktopRuntimeTargetID, 'app', f.create);
    await app.release();
    expect(f.disconnect).not.toHaveBeenCalled();
    await expect(gateway.use(1, request, async () => 'preview')).resolves.toBe('preview');
    await expect(gateway.use(1, request, async () => 'join')).resolves.toBe('join');
    expect(connect).toHaveBeenCalledTimes(3);
    gateway.close(1, 1);
    await vi.waitFor(() => expect(f.disconnect).toHaveBeenCalledTimes(1));
    await expect(gateway.use(1, request, async () => 'late')).rejects.toMatchObject({ code: 'GATEWAY_CONNECTION_CLOSED' });
  });
  it('releases a connection that finishes after the Gateway dialog is canceled', async () => {
    const f = fixture();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const connect = vi.fn(async (id: string, owner: string, signal: AbortSignal) => {
      const lease = await f.connect(id, owner, signal);
      await gate;
      return lease;
    });
    const gateway = new EnvironmentManagementConnections(connect, 'gateway');
    const operation = vi.fn(async () => 'status');
    const result = gateway.use(1, request, operation);
    const rejected = expect(result).rejects.toMatchObject({ code: 'GATEWAY_CONNECTION_CLOSED' });
    await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    gateway.close(1, 1); finish();
    await rejected;
    expect(operation).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.disconnect).toHaveBeenCalledOnce());
  });
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
