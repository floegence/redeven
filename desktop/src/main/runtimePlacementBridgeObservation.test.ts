import { describe, expect, it, vi } from 'vitest';

import { observeRuntimePlacementBridge } from './runtimePlacementBridgeObservation';
import {
  RuntimePlacementBridgeRegistry,
  type RuntimePlacementBridgeRecord,
} from './runtimePlacementBridgeRegistry';
import type {
  RuntimePlacementBridgeSession,
  RuntimePlacementBridgeTermination,
} from './runtimePlacementBridgeSession';
import type { DesktopSessionTransportRecoverySnapshot } from '../shared/desktopSessionContextIPC';
import type { DesktopProviderRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import type { DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function observationFixture(targetIDValue: string) {
  const targetID = targetIDValue as DesktopRuntimeTargetID;
  const closed = deferred<RuntimePlacementBridgeTermination>();
  let recovery: DesktopSessionTransportRecoverySnapshot = {
    generation: 0,
    revision: 0,
    phase: 'ready',
    attempt_count: 0,
    actions: [],
  };
  let settled = false;
  const disconnect = vi.fn(async () => {
    if (!settled) {
      settled = true;
      closed.resolve({ kind: 'closed' });
    }
  });
  const session = {
    placement_target_id: targetID,
    getRecoverySnapshot: () => recovery,
    closed: closed.promise,
    disconnect,
  } as unknown as RuntimePlacementBridgeSession;
  const record = {
    runtime_key: targetID,
    environment_id: targetID,
    label: targetID,
    target_id: `ssh_environment:${targetID}` as DesktopProviderRuntimeLinkTargetID,
    runtime_binary_path: 'redeven',
    session,
    startup: {
      local_ui_url: 'http://127.0.0.1:3000/',
      local_ui_urls: ['http://127.0.0.1:3000/'],
      started_at_unix_ms: 10,
    },
    runtime_handle: {
      runtime_kind: 'ssh',
      lifecycle_owner: 'desktop',
      launch_mode: 'spawned',
      stop: disconnect,
    },
  } as RuntimePlacementBridgeRecord;
  return {
    targetID,
    session,
    record,
    disconnect,
    setRecovery: (next: DesktopSessionTransportRecoverySnapshot) => {
      recovery = next;
    },
  };
}

describe('observeRuntimePlacementBridge', () => {
  it('refreshes startup only after a ready health probe', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = observationFixture('target-one');
    registry.trackOpening(fixture.record, 'target-one:open');
    const probe = vi.fn(async () => ({
      ok: true as const,
      value: {
        local_ui_url: 'http://127.0.0.1:3000/',
        local_ui_urls: ['http://127.0.0.1:3000/'],
        started_at_unix_ms: 20,
      },
    }));

    const observation = await observeRuntimePlacementBridge(registry, fixture.targetID, probe);

    expect(observation.kind).toBe('ready');
    expect(observation.kind === 'ready' ? observation.record.startup.started_at_unix_ms : null).toBe(20);
    expect(probe).toHaveBeenCalledWith(fixture.record);
  });

  it.each(['waiting', 'connecting'] as const)('skips health probes while the bridge is %s', async (phase) => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = observationFixture('target-one');
    fixture.setRecovery({
      generation: 1,
      revision: 1,
      phase,
      attempt_count: phase === 'connecting' ? 1 : 0,
      actions: phase === 'waiting' ? ['retry_now'] : [],
    });
    registry.trackOpening(fixture.record, 'target-one:open');
    const probe = vi.fn();

    const observation = await observeRuntimePlacementBridge(registry, fixture.targetID, probe);

    expect(observation).toMatchObject({ kind: 'recovering', recovery: { phase } });
    expect(probe).not.toHaveBeenCalled();
    expect(fixture.disconnect).not.toHaveBeenCalled();
  });

  it('returns recovery when interruption is published during a health probe', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = observationFixture('target-one');
    registry.trackOpening(fixture.record, 'target-one:open');
    const probe = vi.fn(async () => {
      fixture.setRecovery({
        generation: 1,
        revision: 1,
        phase: 'waiting',
        attempt_count: 0,
        actions: ['retry_now'],
      });
      return { ok: false as const, failure: { kind: 'network_error' as const, code: 'ECONNRESET' } };
    });

    const observation = await observeRuntimePlacementBridge(registry, fixture.targetID, probe);

    expect(observation).toMatchObject({ kind: 'recovering', recovery: { generation: 1, phase: 'waiting' } });
    expect(registry.get(fixture.targetID)).toBe(fixture.record);
    expect(fixture.disconnect).not.toHaveBeenCalled();
  });

  it('reports a typed unavailable observation without retiring the bridge', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = observationFixture('target-one');
    registry.trackOpening(fixture.record, 'target-one:open');

    const observation = await observeRuntimePlacementBridge(registry, fixture.targetID, async () => ({
      ok: false,
      failure: { kind: 'timeout' },
    }));

    expect(observation).toMatchObject({ kind: 'unavailable', failure: { kind: 'timeout' } });
    expect(registry.get(fixture.targetID)).toBe(fixture.record);
    expect(fixture.disconnect).not.toHaveBeenCalled();
  });

  it('discards an old probe result after the registry session changes', async () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const first = observationFixture('target-one');
    const second = observationFixture('target-one');
    registry.trackOpening(first.record, 'first:open');
    const firstProbe = deferred<{ ok: false; failure: { kind: 'network_error'; code: string } }>();
    const probe = vi.fn()
      .mockImplementationOnce(() => firstProbe.promise)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          local_ui_url: 'http://127.0.0.1:4000/',
          local_ui_urls: ['http://127.0.0.1:4000/'],
        },
      });

    const observationTask = observeRuntimePlacementBridge(registry, first.targetID, probe);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    await registry.retire(first.targetID);
    registry.trackOpening(second.record, 'second:open');
    firstProbe.resolve({ ok: false, failure: { kind: 'network_error', code: 'ECONNRESET' } });

    const observation = await observationTask;

    expect(observation.kind).toBe('ready');
    expect(observation.kind === 'ready' ? observation.record.session : null).toBe(second.session);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
