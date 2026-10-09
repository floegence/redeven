import type { ManagedDesktopModelSource } from './desktopModelSource';
import { describe, expect, it, vi } from 'vitest';

import {
  RuntimePlacementBridgeRegistry,
  type RuntimePlacementBridgeRecord,
} from './runtimePlacementBridgeRegistry';
import type {
  RuntimePlacementBridgeSession,
  RuntimePlacementBridgeTermination,
} from './runtimePlacementBridgeSession';
import type { DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import type { DesktopSessionKey } from './desktopTarget';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function bridgeFixture(targetIDValue: string) {
  const targetID = targetIDValue as DesktopRuntimeTargetID;
  const closed = deferred<RuntimePlacementBridgeTermination>();
  let settled = false;
  const disconnect = vi.fn(async () => {
    if (!settled) {
      settled = true;
      closed.resolve({ kind: 'closed' });
    }
  });
  const session = {
    placement_target_id: targetID,
    closed: closed.promise,
    disconnect,
  } as unknown as RuntimePlacementBridgeSession;
  const record = {
    runtime_key: targetID,
    environment_id: targetID,
    label: targetID,
    target_id: `ssh_environment:${targetID}` as DesktopCloudRuntimeLinkTargetID,
    runtime_binary_path: 'redeven',
    session,
    startup: { local_ui_url: 'http://127.0.0.1:3000/', local_ui_urls: ['http://127.0.0.1:3000/'] },
    runtime_handle: {
      runtime_kind: 'ssh',
      launch_mode: 'spawned',
      stop: disconnect,
    },
  } as RuntimePlacementBridgeRecord;
  return {
    targetID,
    session,
    record,
    disconnect,
    close: (termination: RuntimePlacementBridgeTermination) => {
      if (!settled) {
        settled = true;
        closed.resolve(termination);
      }
    },
  };
}

describe('RuntimePlacementBridgeRegistry', () => {
  it('shares one creation across twenty consumers and releases only after the last owner', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = bridgeFixture('shared');
    const gate = deferred<void>();
    const create = vi.fn(async () => { await gate.promise; return fixture.record; });
    const requests = Array.from({ length: 20 }, (_, index) => registry.acquire(fixture.targetID, `owner-${index}`, create));
    gate.resolve();
    const leases = await Promise.all(requests);
    expect(create).toHaveBeenCalledTimes(1);
    expect(leases.every(lease => lease.record === fixture.record)).toBe(true);
    await Promise.all(leases.slice(0, 19).map(lease => lease.release()));
    expect(fixture.disconnect).not.toHaveBeenCalled();
    await leases[19]!.release();
    expect(fixture.disconnect).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('cancels one waiter without canceling a shared creation', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = bridgeFixture('shared');
    const gate = deferred<void>();
    let creationSignal!: AbortSignal;
    const create = vi.fn(async (signal: AbortSignal) => { creationSignal = signal; await gate.promise; return fixture.record; });
    const controller = new AbortController();
    const canceled = registry.acquire(fixture.targetID, 'settings', create, controller.signal);
    const expectedCancellation = expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    const retained = registry.acquire(fixture.targetID, 'app', create);
    controller.abort();
    await expectedCancellation;
    expect(creationSignal.aborted).toBe(false);
    gate.resolve();
    const lease = await retained;
    expect(create).toHaveBeenCalledTimes(1);
    await lease.release();
  });

  it('disposes a late creation after retirement without replacing its successor', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const first = bridgeFixture('target');
    const second = bridgeFixture('target');
    const gate = deferred<void>();
    const opening = registry.acquire(first.targetID, 'old', async () => { await gate.promise; return first.record; });
    const canceled = expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    const retirement = registry.retire(first.targetID);
    gate.resolve();
    await Promise.all([canceled, retirement]);
    const next = await registry.acquire(second.targetID, 'new', async () => second.record);
    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(registry.get(second.targetID)).toBe(second.record);
    await next.release();
  });

  it('notifies only retained consumers when a shared connection fails', async () => {
    const settled = vi.fn();
    const registry = new RuntimePlacementBridgeRegistry(settled);
    const fixture = bridgeFixture('target');
    const settings = await registry.acquire(fixture.targetID, 'settings', async () => fixture.record);
    const app = await registry.acquire(fixture.targetID, 'app', async () => fixture.record);
    app.attachSession('ssh:session' as DesktopSessionKey);
    await settings.release();
    fixture.close({ kind: 'closed' });
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    expect(settled).toHaveBeenCalledWith(fixture.record, [{ kind: 'session', session_key: 'ssh:session' }], { kind: 'closed' });
    expect(app.active).toBe(false);
    await app.release();
  });

  it('does not retire a connection still owned by settings when the Env App closes', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = bridgeFixture('target');
    const settings = await registry.acquire(fixture.targetID, 'settings', async () => fixture.record);
    const app = await registry.acquire(fixture.targetID, 'app', async () => fixture.record);
    app.attachSession('ssh:session' as DesktopSessionKey);
    await app.release();
    expect(settings.active).toBe(true);
    expect(fixture.disconnect).not.toHaveBeenCalled();
    await settings.release();
    expect(fixture.disconnect).toHaveBeenCalledTimes(1);
  });

  it('updates the current record without changing connection identity', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = bridgeFixture('target');
    const lease = await registry.acquire(fixture.targetID, 'settings', async () => fixture.record);
    registry.updateIfCurrent(fixture.targetID, fixture.session, record => ({ ...record, label: 'updated' }));
    expect(lease.record.label).toBe('updated');
    expect(registry.updateIfCurrent(fixture.targetID, bridgeFixture('other').session, record => record)).toBeNull();
    await lease.release();
  });

  it('shutdown cancels pending creation and rejects future consumers', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = bridgeFixture('target');
    const gate = deferred<void>();
    const pending = registry.acquire(fixture.targetID, 'settings', async () => { await gate.promise; return fixture.record; });
    const canceled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const shutdown = registry.retireAll();
    gate.resolve();
    await Promise.all([shutdown, canceled]);
    await expect(registry.acquire(fixture.targetID, 'later', async () => fixture.record)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.disconnect).toHaveBeenCalledTimes(1);
  });
  it('shares models only between model consumers and cleans them while settings retain transport', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = bridgeFixture('target');
    const settings = await registry.acquire(fixture.targetID, 'settings', async () => fixture.record);
    const app = await registry.acquire(fixture.targetID, 'app', async () => fixture.record);
    const flower = await registry.acquire(fixture.targetID, 'flower', async () => fixture.record);
    const closed = deferred<{ stopped: boolean; message?: string }>();
    const stop = vi.fn(async () => { closed.resolve({ stopped: true }); });
    const start = vi.fn(async () => ({ sessionID: 'model', expiresAtUnixMs: Date.now() + 1000,
      ready: Promise.resolve({ pid: 1, configured: true, modelCount: 1, missingKeyProviderIDs: [] }),
      closed: closed.promise, stop,
    } satisfies ManagedDesktopModelSource));
    await Promise.all([app.ensureModelSource(start), flower.ensureModelSource(start)]);
    expect(start).toHaveBeenCalledTimes(1);
    await app.release();
    expect(stop).not.toHaveBeenCalled();
    await flower.release();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(settings.active).toBe(true);
    expect(fixture.disconnect).not.toHaveBeenCalled();
    await settings.release();
  });

  it('starts a new model consumer after an earlier consumer finishes stopping', async () => {
    const fixture = bridgeFixture('target');
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const settings = await registry.acquire(fixture.targetID, 'settings', async () => fixture.record);
    const first = await settings.retain('first-app');
    const stopping = deferred<void>();
    const closed = deferred<{ stopped: boolean }>();
    const start = vi.fn(async () => ({ sessionID: 'model', expiresAtUnixMs: Date.now() + 1000,
      ready: Promise.resolve({ pid: 1, configured: true, modelCount: 1, missingKeyProviderIDs: [] }),
      closed: closed.promise, stop: async () => { await stopping.promise; closed.resolve({ stopped: true }); },
    } satisfies ManagedDesktopModelSource));
    await first.ensureModelSource(start);
    const release = first.release();
    const second = await settings.retain('next-app');
    const prepare = second.ensureModelSource(start);
    stopping.resolve();
    await Promise.all([release, prepare]);
    expect(start).toHaveBeenCalledTimes(2);
    await second.release();
    await settings.release();
  });

  it('clears failed creation so a later explicit consumer can connect', async () => {
    const fixture = bridgeFixture('target');
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const create = vi.fn(async () => { throw new Error('SSH unavailable'); });
    await Promise.all(Array.from({ length: 20 }, () => expect(registry.acquire(fixture.targetID, 'settings', create)).rejects.toThrow('SSH unavailable')));
    expect(create).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
    const next = await registry.acquire(fixture.targetID, 'retry', async () => fixture.record);
    await next.release();
  });

  it('retains a model failure until explicit retry without holding its dead process', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = bridgeFixture('target');
    const app = await registry.acquire(fixture.targetID, 'app', async () => fixture.record);
    const exits: Array<ReturnType<typeof deferred<{ stopped: boolean; message?: string }>>> = [];
    const start = vi.fn(async () => {
      const closed = deferred<{ stopped: boolean; message?: string }>(); exits.push(closed);
      return { sessionID: 'model', expiresAtUnixMs: Date.now() + 1000,
        ready: Promise.resolve({ pid: 1, configured: true, modelCount: 1, missingKeyProviderIDs: [] }),
        closed: closed.promise, stop: async () => { closed.resolve({ stopped: true }); },
      } satisfies ManagedDesktopModelSource;
    });
    await app.ensureModelSource(start);
    exits[0]!.resolve({ stopped: false, message: 'AI service requires attention' });
    await vi.waitFor(() => expect(app.modelSourceState.phase).toBe('failed'));
    await app.ensureModelSource(start);
    expect(start).toHaveBeenCalledTimes(1);
    await Promise.all([app.ensureModelSource(start, true), app.ensureModelSource(start, true)]);
    expect(start).toHaveBeenCalledTimes(2);
    await app.release();
  });

});
