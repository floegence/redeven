import { describe, expect, it } from 'vitest';

import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import {
  DesktopWelcomeRuntimeHealthStore,
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

describe('DesktopWelcomeRuntimeHealthStore', () => {
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
