import { describe, expect, it } from 'vitest';

import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import type { DesktopRuntimePresence } from '../shared/desktopRuntimePresence';
import { normalizeRuntimeServiceSnapshot } from '../shared/runtimeService';
import {
  DesktopWelcomeRuntimeHealthStore,
  desktopWelcomeOnlineRuntimeHealth,
  desktopWelcomeRuntimeHealthIsFresh,
  desktopWelcomeRuntimeHealthForEnvironment,
  type DesktopWelcomeRuntimeHealthTarget,
} from './desktopWelcomeRuntimeHealth';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

function health(
  overrides: Partial<DesktopRuntimeHealth> = {},
): DesktopRuntimeHealth {
  return {
    status: 'offline',
    checked_at_unix_ms: Date.now(),
    source: 'external_local_ui_probe',
    offline_reason_code: 'unverified',
    offline_reason: 'Checking runtime status.',
    ...overrides,
  };
}

function target(
  probe: DesktopWelcomeRuntimeHealthTarget['probe'],
  overrides: Partial<DesktopWelcomeRuntimeHealthTarget> = {},
): DesktopWelcomeRuntimeHealthTarget {
  return {
    key: 'external:demo',
    environment_id: 'demo',
    slot: 'external_local_ui',
    auto_refresh_enabled: false,
    checking_health: health({ checked_at_unix_ms: 1 }),
    probe,
    ...overrides,
  };
}

function presence(
  overrides: Partial<DesktopRuntimePresence> = {},
): DesktopRuntimePresence {
  const base = {
    target_id: 'local:demo',
    placement_target_id: 'local:host:demo',
    kind: 'local_environment',
    environment_id: 'demo',
    label: 'Demo',
    runtime_key: 'demo',
    host_access: { kind: 'local_host' },
    placement: { kind: 'host_process', runtime_root: '' },
    running: true,
    local_ui_url: 'http://127.0.0.1:24000/',
    openable: true,
    runtime_control_status: { state: 'available' },
    operations: {},
    checked_at_unix_ms: 1,
    ...overrides,
  } as DesktopRuntimePresence;
  return base;
}

describe('DesktopWelcomeRuntimeHealthStore', () => {
  it('caches observed startup age and identity without copying live control credentials', async () => {
    const startup = {
      local_ui_url: 'http://localhost:24000/',
      started_at_unix_ms: 123456,
      pid: 123,
      local_ui_bridge_token: 'private-bridge-token',
      runtime_control: { token: 'private-control-token' },
    };
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
    const observedHealth = desktopWelcomeOnlineRuntimeHealth('local_runtime_probe', startup);
    const runtimeTarget = target(async () => ({ health: observedHealth }), { slot: 'local_environment' });
    await store.refresh([runtimeTarget]);
    const probe = deferred<{ health: DesktopRuntimeHealth }>();
    const refreshing = store.refresh([{ ...runtimeTarget, probe: () => probe.promise }], { force: true });
    expect(store.snapshot().localRuntimeHealth.demo).toEqual({
      status: 'online', source: 'local_runtime_probe', checked_at_unix_ms: expect.any(Number),
      local_ui_url: startup.local_ui_url, started_at_unix_ms: startup.started_at_unix_ms,
      runtime_pid: startup.pid, freshness: 'checking',
    });
    probe.resolve({ health: health({ status: 'offline' }) });
    await refreshing;
    expect(store.snapshot().localRuntimeHealth.demo.started_at_unix_ms).toBeUndefined();
  });

  it('resolves managed Runtime health for an Open preflight by registration id', () => {
    const sshHealth = health({
      offline_reason_code: 'not_started',
      offline_reason: 'Runtime daemon is not running.',
      freshness: 'fresh',
    });

    expect(desktopWelcomeRuntimeHealthForEnvironment({
      localRuntimeHealth: {},
      savedExternalRuntimeHealth: {},
      savedRuntimeTargetHealth: { env_ssh: sshHealth },
      managedRuntimePresenceByTargetID: {},
    }, 'env_ssh', 'ssh:host:demo:1234')).toBe(sshHealth);
  });

  it('does not borrow another Environment health record from the target fallback', () => {
    const otherHealth = health({ status: 'online', freshness: 'fresh' });

    expect(desktopWelcomeRuntimeHealthForEnvironment({
      localRuntimeHealth: {},
      savedExternalRuntimeHealth: {},
      savedRuntimeTargetHealth: { env_other: otherHealth },
      managedRuntimePresenceByTargetID: {},
    }, 'env_ssh')).toBeUndefined();
  });

  it('treats only fresh health inside the TTL as reusable', () => {
    const checkedAtUnixMS = 10_000;
    const freshHealth = health({ freshness: 'fresh', checked_at_unix_ms: checkedAtUnixMS });

    expect(desktopWelcomeRuntimeHealthIsFresh(freshHealth, checkedAtUnixMS + 29_999)).toBe(true);
    expect(desktopWelcomeRuntimeHealthIsFresh(freshHealth, checkedAtUnixMS + 30_000)).toBe(false);
    expect(desktopWelcomeRuntimeHealthIsFresh({ ...freshHealth, freshness: 'failed' }, checkedAtUnixMS + 1)).toBe(false);
  });

  it.each(['starting', 'inspecting', 'backing_up', 'optimizing', 'migrating', 'verifying', 'recovering', 'restoring'])(
    'observes AI %s on the next existing health tick instead of caching startup for 30 seconds', async state => {
      let probes = 0;
      const service = (state: string) => normalizeRuntimeServiceSnapshot({ ai_readiness: { state } });
      const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
      const runtimeTarget = target(async () => ({ health: health({ status: 'online', runtime_service: service(++probes === 1 ? state : 'ready') }) }));
      await store.refresh([runtimeTarget]);
      await store.refresh([runtimeTarget]);
      expect(probes).toBe(2);
      expect(store.snapshot().savedExternalRuntimeHealth.demo.runtime_service?.ai_readiness?.state).toBe('ready');
      await store.refresh([runtimeTarget]);
      expect(probes).toBe(2);
    },
  );

  it('primes missing targets without starting probes or fabricating health', () => {
    let probeCount = 0;
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);

    store.prime([target(async () => {
      probeCount += 1;
      return { health: health({ status: 'online' }) };
    })], { pruneMissing: true });

    expect(store.snapshot().savedExternalRuntimeHealth.demo).toBeUndefined();
    expect(probeCount).toBe(0);
  });

  it('marks a target as checking immediately and publishes the fresh result in memory', async () => {
    const changes: string[] = [];
    const probeResult = deferred<{ health: DesktopRuntimeHealth }>();
    const store = new DesktopWelcomeRuntimeHealthStore(() => changes.push('changed'));

    const refresh = store.refresh([target(() => probeResult.promise)]);

    expect(store.snapshot().savedExternalRuntimeHealth.demo).toEqual(expect.objectContaining({
      freshness: 'checking',
      offline_reason: 'Checking runtime status.',
    }));

    probeResult.resolve({
      health: health({
        status: 'online',
        local_ui_url: 'http://127.0.0.1:24000/',
        checked_at_unix_ms: Date.now(),
      }),
    });
    await refresh;

    expect(store.snapshot().savedExternalRuntimeHealth.demo).toEqual(expect.objectContaining({
      freshness: 'fresh',
      status: 'online',
      local_ui_url: 'http://127.0.0.1:24000/',
    }));
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates in-flight probes', async () => {
    let probeCount = 0;
    const probeResult = deferred<{ health: DesktopRuntimeHealth }>();
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
    const runtimeTarget = target(() => {
      probeCount += 1;
      return probeResult.promise;
    });

    const first = store.refresh([runtimeTarget]);
    const second = store.refresh([runtimeTarget]);

    expect(probeCount).toBe(1);
    probeResult.resolve({ health: health({ status: 'online' }) });
    await Promise.all([first, second]);
  });

  it('reuses an in-flight probe even when the caller forces refresh', async () => {
    const firstProbe = deferred<{ health: DesktopRuntimeHealth }>();
    let probeCount = 0;
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);

    const runtimeTarget = target(() => {
      probeCount += 1;
      return firstProbe.promise;
    });
    const first = store.refresh([runtimeTarget]);
    const second = store.refresh([runtimeTarget], { force: true });

    firstProbe.resolve({
      health: health({
        status: 'online',
        local_ui_url: 'http://127.0.0.1:24000/',
        checked_at_unix_ms: Date.now(),
      }),
    });
    await Promise.all([first, second]);

    expect(probeCount).toBe(1);
    expect(store.snapshot().savedExternalRuntimeHealth.demo).toEqual(expect.objectContaining({
      freshness: 'fresh',
      local_ui_url: 'http://127.0.0.1:24000/',
    }));
  });

  it('records probe failures as failed freshness without persisting fallback state', async () => {
    const events: string[] = [];
    const store = new DesktopWelcomeRuntimeHealthStore(
      () => undefined,
      (event) => events.push(`${event.outcome}:${event.message ?? ''}`),
    );

    await store.refresh([target(async () => {
      throw new Error('ssh timed out');
    })]);

    expect(store.snapshot().savedExternalRuntimeHealth.demo).toEqual(expect.objectContaining({
      freshness: 'failed',
      status: 'offline',
      offline_reason: 'ssh timed out',
    }));
    expect(events).toEqual(['failed:ssh timed out']);
  });

  it('does not carry previous presence into checking state', async () => {
    const probeResult = deferred<{ health: DesktopRuntimeHealth }>();
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
    const runtimePresence = presence();

    await store.refresh([target(async () => ({
      health: health({
        status: 'online',
        local_ui_url: runtimePresence.local_ui_url,
      }),
      presence: runtimePresence,
    }), {
      slot: 'local_environment',
      presence_target_id: runtimePresence.target_id,
    })]);
    expect(store.snapshot().managedRuntimePresenceByTargetID[runtimePresence.target_id]).toBeTruthy();

    const refresh = store.refresh([target(() => probeResult.promise, {
      slot: 'local_environment',
      presence_target_id: runtimePresence.target_id,
    })], { force: true });

    expect(store.snapshot().managedRuntimePresenceByTargetID[runtimePresence.target_id]).toBeUndefined();
    probeResult.resolve({ health: health({ status: 'offline' }) });
    await refresh;
  });

  it('clears previous presence when a fresh probe does not return presence', async () => {
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
    const runtimePresence = presence();

    await store.refresh([target(async () => ({
      health: health({
        status: 'online',
        local_ui_url: runtimePresence.local_ui_url,
      }),
      presence: runtimePresence,
    }), {
      slot: 'local_environment',
      presence_target_id: runtimePresence.target_id,
    })]);
    await store.refresh([target(async () => ({
      health: health({
        status: 'offline',
        offline_reason: 'Runtime stopped.',
      }),
    }), {
      slot: 'local_environment',
      presence_target_id: runtimePresence.target_id,
    })], { force: true });

    expect(store.snapshot().managedRuntimePresenceByTargetID[runtimePresence.target_id]).toBeUndefined();
    expect(store.snapshot().localRuntimeHealth.demo).toEqual(expect.objectContaining({
      freshness: 'fresh',
      status: 'offline',
      offline_reason: 'Runtime stopped.',
    }));
  });

  it('clears previous presence when a probe fails', async () => {
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
    const runtimePresence = presence();

    await store.refresh([target(async () => ({
      health: health({
        status: 'online',
        local_ui_url: runtimePresence.local_ui_url,
      }),
      presence: runtimePresence,
    }), {
      slot: 'local_environment',
      presence_target_id: runtimePresence.target_id,
    })]);
    await store.refresh([target(async () => {
      throw new Error('runtime unavailable');
    }, {
      slot: 'local_environment',
      presence_target_id: runtimePresence.target_id,
    })], { force: true });

    expect(store.snapshot().managedRuntimePresenceByTargetID[runtimePresence.target_id]).toBeUndefined();
    expect(store.snapshot().localRuntimeHealth.demo).toEqual(expect.objectContaining({
      freshness: 'failed',
      status: 'offline',
      offline_reason: 'runtime unavailable',
    }));
  });

  it('skips fresh entries inside the in-memory TTL and prunes removed targets only on full refreshes', async () => {
    let probeCount = 0;
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined, () => undefined, 60_000);
    const runtimeTarget = target(async () => {
      probeCount += 1;
      return { health: health({ checked_at_unix_ms: Date.now() }) };
    });

    await store.refresh([runtimeTarget]);
    await store.refresh([runtimeTarget]);
    await store.refresh([], { pruneMissing: false });
    expect(store.snapshot().savedExternalRuntimeHealth.demo).toBeTruthy();

    await store.refresh([], { pruneMissing: true });
    expect(store.snapshot().savedExternalRuntimeHealth.demo).toBeUndefined();
    expect(probeCount).toBe(1);
  });
});
