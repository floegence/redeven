import { describe, expect, it, vi } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import {
  testDesktopPreferences,
  testLocalEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  continueEnvironmentOpenAfterLifecycle,
  reconcileEnvironmentOpenBeforeLifecycle,
  runConfirmedEnvironmentStart,
  runEnvironmentOpenPreflight,
} from './environmentOpenPreflight';
import {
  buildProviderBackedEnvironmentActionModel,
  environmentOpenFlow,
  environmentOpenFlowAfterPreflight,
} from './viewModel';

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

type DirectRuntimeSmokeCase = Readonly<{
  label: string;
  platform: 'darwin' | 'linux';
  kind: Extract<DesktopEnvironmentEntry['kind'], 'local_environment' | 'ssh_environment'>;
  runtimeRoot: string;
  sshDestination?: string;
}>;

const directRuntimeSmokeCases: readonly DirectRuntimeSmokeCase[] = [
  {
    label: 'macOS Local Env',
    platform: 'darwin',
    kind: 'local_environment',
    runtimeRoot: '/Users/developer/.redeven-smoke',
  },
  {
    label: 'Linux Local Env',
    platform: 'linux',
    kind: 'local_environment',
    runtimeRoot: '/home/developer/.redeven-smoke',
  },
  {
    label: 'macOS SSH Remote Env',
    platform: 'darwin',
    kind: 'ssh_environment',
    runtimeRoot: '/Users/remote/.redeven-smoke',
    sshDestination: 'remote@mac-builder.example.test',
  },
  {
    label: 'Linux SSH Remote Env',
    platform: 'linux',
    kind: 'ssh_environment',
    runtimeRoot: '/home/remote/.redeven-smoke',
    sshDestination: 'remote@linux-builder.example.test',
  },
];

function stoppedRuntimeEnvironment(testCase: DirectRuntimeSmokeCase): DesktopEnvironmentEntry {
  const environmentID = testCase.kind === 'local_environment'
    ? `local-${testCase.platform}`
    : `ssh-${testCase.platform}`;
  const localEnvironment = testLocalEnvironment({
    label: `${testCase.platform} Local`,
    stateDir: testCase.runtimeRoot,
  });
  const preferences = testDesktopPreferences({
    local_environment: localEnvironment,
    saved_ssh_environments: testCase.kind === 'ssh_environment'
      ? [{
          id: environmentID,
          label: testCase.label,
          ssh_destination: testCase.sshDestination ?? '',
          ssh_port: 22,
          auth_mode: 'key_agent',
          runtime_root: testCase.runtimeRoot,
          bootstrap_strategy: 'desktop_upload',
          release_base_url: '',
          connect_timeout_seconds: 10,
          pinned: false,
          created_at_ms: 10,
          last_used_at_ms: 10,
        }]
      : [],
  });
  const directEnvironmentID = testCase.kind === 'local_environment'
    ? preferences.local_environment.id
    : environmentID;
  const runtimeHealth: DesktopRuntimeHealth = {
    status: 'offline',
    checked_at_unix_ms: 10,
    source: testCase.kind === 'local_environment' ? 'local_runtime_probe' : 'ssh_runtime_probe',
    freshness: 'fresh',
    offline_reason_code: 'not_started',
    offline_reason: 'Runtime is not running.',
  };
  const gateway: DesktopGatewaySource = {
    gateway_id: `gw-${environmentID}`,
    display_name: `${testCase.label} supervisor`,
    local_enabled: true,
    connection_kind: testCase.kind === 'local_environment' ? 'local_host' : 'ssh_host',
    management_capability: testCase.kind === 'local_environment' ? 'managed_local_host' : 'managed_ssh_host',
    capabilities: ['env_lifecycle'],
    status: 'error',
    trust_state: 'paired',
    status_message: 'Gateway service must be started before this action can continue.',
    endpoint_label: testCase.sshDestination ?? 'This device',
    runtime_root: testCase.runtimeRoot,
    ...(testCase.kind === 'ssh_environment' ? {
      ssh_details: {
        ssh_destination: testCase.sshDestination ?? '',
        ssh_port: 22,
        auth_mode: 'key_agent' as const,
        connect_timeout_seconds: 10,
        runtime_root: testCase.runtimeRoot,
        bootstrap_strategy: 'desktop_upload' as const,
        release_base_url: '',
      },
    } : {}),
    created_at_ms: 10,
    updated_at_ms: 10,
    environments: [],
  };
  const snapshot = buildDesktopWelcomeSnapshot({
    preferences,
    localRuntimeHealth: testCase.kind === 'local_environment'
      ? { [directEnvironmentID]: runtimeHealth }
      : {},
    savedSSHRuntimeHealth: testCase.kind === 'ssh_environment'
      ? { [directEnvironmentID]: runtimeHealth }
      : {},
    gatewaySources: [gateway],
  });
  const entry = snapshot.environments.find((candidate) => (
    candidate.kind === testCase.kind && candidate.id === directEnvironmentID
  ));
  if (!entry) {
    throw new Error(`${testCase.label} fixture is missing`);
  }
  return entry;
}

describe('environment Open click smoke', () => {
  it.each([
    'initialization',
    'start',
  ] as const)(
    'continues %s into the real Open request when the first post-lifecycle snapshot is still offline',
    async () => {
      const staleOffline = environment({
        runtime_health: {
          ...environment().runtime_health,
          status: 'offline',
          freshness: 'fresh',
          offline_reason_code: 'not_started',
        },
      });
      const attemptOpen = vi.fn(async () => ({ opened: true, message: '' }));

      await expect(continueEnvironmentOpenAfterLifecycle({
        environment: staleOffline,
        loadLatestEnvironment: async () => staleOffline,
        attemptOpen,
      })).resolves.toEqual({ kind: 'opened' });
      expect(attemptOpen).toHaveBeenCalledOnce();
      expect(attemptOpen).toHaveBeenCalledWith(staleOffline);
    },
  );

  it('keeps the real Open failure after a successful lifecycle operation', async () => {
    const staleOffline = environment();

    await expect(continueEnvironmentOpenAfterLifecycle({
      environment: staleOffline,
      loadLatestEnvironment: async () => staleOffline,
      attemptOpen: async () => ({
        opened: false,
        message: 'The Runtime did not become ready before the Open request completed.',
      }),
    })).resolves.toEqual({
      kind: 'failed',
      message: 'The Runtime did not become ready before the Open request completed.',
    });
  });

  it('preserves the typed Runtime recovery after a lifecycle operation', async () => {
    const staleOffline = environment();

    await expect(continueEnvironmentOpenAfterLifecycle({
      environment: staleOffline,
      loadLatestEnvironment: async () => staleOffline,
      attemptOpen: async () => ({
        opened: false,
        message: 'Update the Runtime before opening this environment.',
        recovery: 'update_runtime',
      }),
    })).resolves.toEqual({
      kind: 'failed',
      message: 'Update the Runtime before opening this environment.',
      recovery: 'update_runtime',
    });
  });

  it('continues a user-confirmed Start and open through the Gateway confirmation', async () => {
    const calls: unknown[] = [];
    const perform = vi.fn(async (request) => {
      calls.push(request);
      if (request.kind === 'confirm_runtime_operation') {
        return { ok: true as const, outcome: 'started_gateway_environment_runtime' as const };
      }
      return {
        ok: false as const,
        code: 'confirmation_required' as const,
        scope: 'environment' as const,
        message: 'Review the Runtime impact and confirm before this operation can continue.',
      };
    });

    await expect(runConfirmedEnvironmentStart({
      environmentID: 'env_local',
      request: {
        kind: 'run_gateway_environment_lifecycle',
        environment_id: 'env_local',
        gateway_id: 'gw_local',
        gateway_env_id: 'env_local',
        operation: 'start',
      },
      perform,
    })).resolves.toEqual({ ok: true, outcome: 'started_gateway_environment_runtime' });
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'run_gateway_environment_lifecycle', operation: 'start' }),
      { kind: 'confirm_runtime_operation', operation_key: 'env_local:start' },
    ]);
  });

  it('does not turn an ordinary start failure into a confirmation', async () => {
    const perform = vi.fn(async () => ({
      ok: false as const,
      code: 'runtime_start_failed' as const,
      scope: 'environment' as const,
      message: 'Runtime failed to start.',
    }));
    const request = {
      kind: 'run_gateway_environment_lifecycle' as const,
      environment_id: 'env_local',
      gateway_id: 'gw_local',
      gateway_env_id: 'env_local',
      operation: 'start' as const,
    };

    await expect(runConfirmedEnvironmentStart({
      environmentID: 'env_local',
      request,
      perform,
    })).resolves.toMatchObject({ ok: false, code: 'runtime_start_failed' });
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it.each(directRuntimeSmokeCases)(
    'offers Start and open for $label after Desktop restarts with the managed service and Runtime stopped',
    (testCase) => {
      const stopped = stoppedRuntimeEnvironment(testCase);

      expect(stopped).toMatchObject({
        kind: testCase.kind,
        runtime_health: {
          status: 'offline',
          freshness: 'fresh',
          offline_reason_code: 'not_started',
        },
        runtime_management: {
          support: 'supported',
          authorization: { state: 'allowed' },
          readiness: 'temporarily_unavailable',
          reason_code: 'runtime_gateway_temporarily_unavailable',
        },
        runtime_operations: {
          start: {
            availability: 'available',
            method: 'runtime_gateway',
          },
          restart: { availability: 'available', method: 'runtime_gateway' },
          update: { availability: 'available', method: 'runtime_gateway' },
        },
      });
      expect(stopped.gateway_id).toBe(`gw-${testCase.kind === 'local_environment'
        ? `local-${testCase.platform}`
        : `ssh-${testCase.platform}`}`);
      expect(stopped.gateway_env_id).toBe('env_local');
      expect(environmentOpenFlow(stopped)).toBe('start');
      expect(environmentOpenFlowAfterPreflight(stopped)).toBe('start');
      expect(buildProviderBackedEnvironmentActionModel(stopped).action_presentation).toMatchObject({
        primary_action: { label: 'Open' },
        primary_action_overlay: {
          title: 'Start and open',
          actions: expect.arrayContaining([expect.objectContaining({
            action: expect.objectContaining({ intent: 'start_and_open' }),
          })]),
        },
      });
    },
  );

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

  it('preserves Runtime update recovery when the open attempt reports an old Runtime', async () => {
    const unchecked = environment();
    const checked = environment({
      runtime_health: {
        ...unchecked.runtime_health,
        status: 'online',
        checked_at_unix_ms: 10,
        freshness: 'fresh',
      },
    });

    await expect(runEnvironmentOpenPreflight({
      environment: unchecked,
      attemptOpen: async () => ({
        opened: false,
        message: 'Update the Runtime before opening this environment.',
        recovery: 'update_runtime',
      }),
      loadLatestEnvironment: async () => checked,
    })).resolves.toEqual({
      kind: 'failed',
      message: 'Update the Runtime before opening this environment.',
      recovery: 'update_runtime',
    });
  });

  it('rechecks Runtime state before starting and skips Start when the refreshed state is online', async () => {
    const stale = environment({
      runtime_operations: {
        ...environment().runtime_operations,
        start: {
          ...environment().runtime_operations.start,
          availability: 'available',
          reason_code: undefined,
        },
      },
    });
    const running = environment({
      runtime_health: {
        ...stale.runtime_health,
        status: 'online',
        freshness: 'fresh',
        checked_at_unix_ms: 20,
      },
    });
    const refreshRuntime = vi.fn(async () => undefined);
    let reads = 0;

    await expect(reconcileEnvironmentOpenBeforeLifecycle({
      environment: stale,
      loadLatestEnvironment: async () => {
        reads += 1;
        return reads === 1 ? stale : running;
      },
      refreshRuntime,
    })).resolves.toMatchObject({
      environment: running,
      flow: 'direct',
    });
    expect(refreshRuntime).toHaveBeenCalledWith(stale);
  });
});
