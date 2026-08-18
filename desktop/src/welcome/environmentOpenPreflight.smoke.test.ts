import { describe, expect, it, vi } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import {
  testDesktopPreferences,
  testLocalEnvironment,
} from '../testSupport/desktopTestHelpers';
import { runEnvironmentOpenPreflight } from './environmentOpenPreflight';

function environment(overrides: Partial<DesktopEnvironmentEntry> = {}): DesktopEnvironmentEntry {
  const base = buildDesktopWelcomeSnapshot({
    preferences: testDesktopPreferences({
      local_environment: testLocalEnvironment(),
    }),
  }).environments.find((entry) => entry.kind === 'local_environment');
  if (!base) {
    throw new Error('local environment fixture is missing');
  }
  const { runtime_health: runtimeHealthOverride, runtime_operations: runtimeOperationsOverride, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    runtime_health: {
      ...base.runtime_health,
      status: 'offline',
      checked_at_unix_ms: 0,
      freshness: 'unknown',
      ...runtimeHealthOverride,
    },
    runtime_operations: {
      ...base.runtime_operations,
      ...runtimeOperationsOverride,
      start: {
        ...base.runtime_operations.start,
        availability: 'blocked',
        method: 'runtime_gateway',
        reason_code: 'runtime_gateway_setup_required',
        ...runtimeOperationsOverride?.start,
      },
    },
    managed_runtime_host_access: { kind: 'local_host' },
    managed_runtime_placement: { kind: 'host_process', runtime_root: '/tmp/redeven' },
  };
}

describe('environment Open click smoke', () => {
  it('turns a failed unchecked Open preflight into initialization guidance without surfacing the old error', async () => {
    const unchecked = environment();
    const checked = environment({
      runtime_health: {
        ...unchecked.runtime_health,
        checked_at_unix_ms: 10,
        freshness: 'fresh',
      },
    });
    const events: string[] = [];

    const result = await runEnvironmentOpenPreflight({
      environment: unchecked,
      attemptOpen: async () => {
        events.push('preflight');
        return { opened: false, message: 'This Runtime is offline or unavailable right now.' };
      },
      loadLatestEnvironment: async () => {
        events.push('refresh');
        return checked;
      },
    });

    expect(events).toEqual(['preflight', 'refresh']);
    expect(result).toEqual({
      kind: 'guidance',
      flow: 'initialize',
      environment: checked,
    });
  });

  it('opens a running Runtime directly and does not refresh into lifecycle guidance', async () => {
    const loadLatestEnvironment = vi.fn();

    await expect(runEnvironmentOpenPreflight({
      environment: environment(),
      attemptOpen: async () => ({ opened: true, message: '' }),
      loadLatestEnvironment,
    })).resolves.toEqual({ kind: 'opened' });
    expect(loadLatestEnvironment).not.toHaveBeenCalled();
  });

  it('continues into Start and open after preflight confirms an initialized Runtime is stopped', async () => {
    const unchecked = environment();
    const checked = environment({
      runtime_health: {
        ...unchecked.runtime_health,
        checked_at_unix_ms: 10,
        freshness: 'fresh',
      },
      runtime_operations: {
        ...unchecked.runtime_operations,
        start: {
          ...unchecked.runtime_operations.start,
          availability: 'available',
          reason_code: undefined,
        },
      },
    });

    await expect(runEnvironmentOpenPreflight({
      environment: unchecked,
      attemptOpen: async () => ({ opened: false, message: 'offline' }),
      loadLatestEnvironment: async () => checked,
    })).resolves.toEqual({
      kind: 'guidance',
      flow: 'start',
      environment: checked,
    });
  });

  it('continues into Request access as soon as preflight reports denied authorization', async () => {
    const unchecked = environment();
    const checked = environment({
      runtime_health: {
        ...unchecked.runtime_health,
        checked_at_unix_ms: 10,
        freshness: 'fresh',
        offline_reason_code: 'auth_required',
      },
    });

    await expect(runEnvironmentOpenPreflight({
      environment: unchecked,
      attemptOpen: async () => ({ opened: false, message: 'permission denied' }),
      loadLatestEnvironment: async () => checked,
    })).resolves.toEqual({
      kind: 'guidance',
      flow: 'request_access',
      environment: checked,
    });
  });
});
