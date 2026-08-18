import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  testDesktopPreferences,
  testLocalEnvironment,
  testProviderEnvironment,
  testProviderBoundLocalEnvironment,
  testLocalEnvironmentSession,
} from '../testSupport/desktopTestHelpers';
import {
  closeEnvironmentGuidanceSession,
  completeEnvironmentGuidanceRefresh,
  environmentSupportsGuidancePopover,
  failEnvironmentGuidanceIntent,
  guidanceSessionNotice,
  guidanceSessionOwnsOpenFlowPanel,
  isEnvironmentGuidancePendingIntent,
  openEnvironmentGuidanceSession,
  reconcileEnvironmentGuidanceSession,
  startEnvironmentGuidanceIntent,
} from './environmentGuidanceSession';

describe('environmentGuidanceSession', () => {
  it('opens a clean session for the selected environment', () => {
    expect(openEnvironmentGuidanceSession('env_demo')).toEqual({
      environment_id: 'env_demo',
      pending_intent: null,
      feedback: null,
    });
    expect(closeEnvironmentGuidanceSession()).toBeNull();
  });

  it('tracks pending refresh and exposes the matching inline notice', () => {
    const state = startEnvironmentGuidanceIntent(null, 'env_demo', 'refresh_runtime');

    expect(state).toEqual({
      environment_id: 'env_demo',
      pending_intent: 'refresh_runtime',
      feedback: null,
    });
    expect(guidanceSessionNotice(state)).toEqual({
      tone: 'info',
      title: 'Checking runtime status…',
      detail: 'Desktop is probing the latest runtime health for this environment.',
    });
  });

  it('tracks open-flow stages and preserves a retry action after initialization fails', () => {
    const state = startEnvironmentGuidanceIntent(null, 'env_demo', 'initialize_and_open');
    expect(state).toEqual({
      environment_id: 'env_demo',
      pending_intent: 'initialize_and_open',
      open_flow_stage: 'checking_access',
      feedback: null,
    });
    expect(guidanceSessionNotice(state)).toEqual({
      tone: 'info',
      title: 'Checking access',
      detail: 'Redeven is checking access before changing this environment.',
    });
    const failed = failEnvironmentGuidanceIntent(state, 'Permission denied.');
    expect(failed).toMatchObject({
      pending_intent: null,
      retry_intent: 'initialize_and_open',
      feedback: {
        tone: 'error',
        title: 'Initialization failed',
        detail: 'Permission denied.',
      },
    });
    expect(guidanceSessionOwnsOpenFlowPanel(state)).toBe(true);
    expect(guidanceSessionOwnsOpenFlowPanel(failed)).toBe(true);
  });

  it('keeps an unchecked Open preflight inside the open-flow panel and offers Open again on failure', () => {
    const checking = startEnvironmentGuidanceIntent(null, 'env_demo', 'open_with_preflight');

    expect(checking).toEqual({
      environment_id: 'env_demo',
      pending_intent: 'open_with_preflight',
      open_flow_stage: 'checking_access',
      feedback: null,
    });
    expect(guidanceSessionNotice(checking)).toEqual({
      tone: 'info',
      title: 'Checking access',
      detail: 'Redeven is checking access before changing this environment.',
    });
    expect(guidanceSessionOwnsOpenFlowPanel(checking)).toBe(true);
    expect(failEnvironmentGuidanceIntent(checking, 'The environment could not be reached.')).toMatchObject({
      pending_intent: null,
      retry_intent: 'open_with_preflight',
      feedback: {
        tone: 'error',
        title: 'Open failed',
        detail: 'The environment could not be reached.',
      },
    });
  });

  it('turns an early authorization failure into a request-access retry', () => {
    const checking = startEnvironmentGuidanceIntent(null, 'env_demo', 'request_open_access');
    expect(failEnvironmentGuidanceIntent(checking, 'Access is required.')).toMatchObject({
      pending_intent: null,
      retry_intent: 'request_open_access',
      feedback: {
        tone: 'error',
        title: 'Request access',
        detail: 'Access is required.',
      },
    });
  });

  it('keeps start failures distinct from initialization failures', () => {
    const starting = startEnvironmentGuidanceIntent(null, 'env_demo', 'start_and_open');
    expect(failEnvironmentGuidanceIntent(starting, 'The environment did not start.')).toMatchObject({
      retry_intent: 'start_and_open',
      feedback: {
        title: 'Start failed',
        detail: 'The environment did not start.',
      },
    });
  });

  it('does not claim runtime lifecycle operations as guidance pending intents', () => {
    expect(isEnvironmentGuidancePendingIntent('open_with_preflight')).toBe(true);
    expect(isEnvironmentGuidancePendingIntent('start_runtime')).toBe(false);
    expect(isEnvironmentGuidancePendingIntent('stop_runtime')).toBe(false);
    expect(isEnvironmentGuidancePendingIntent('restart_runtime')).toBe(false);
    expect(isEnvironmentGuidancePendingIntent('update_runtime')).toBe(false);
  });

  it('stores inline failures without dropping the active session', () => {
    const state = failEnvironmentGuidanceIntent(
      startEnvironmentGuidanceIntent(null, 'env_demo', 'refresh_runtime'),
      'Provider request timed out.',
    );

    expect(state).toEqual({
      environment_id: 'env_demo',
      pending_intent: null,
      feedback: {
        tone: 'error',
        title: 'Status refresh failed',
        detail: 'Provider request timed out.',
      },
    });
  });

  it('keeps the panel open with plan guidance when refresh still resolves to a blocked environment', () => {
    const environment = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment({
          currentRuntime: {
            local_ui_url: 'http://127.0.0.1:24001/',
            effective_run_mode: 'desktop',
            runtime_service: {
              protocol_version: 'redeven-runtime-v1',
              effective_run_mode: 'desktop',
              remote_enabled: false,
              compatibility: 'compatible',
              open_readiness: { state: 'openable' },
              active_workload: {
                terminal_count: 1,
                session_count: 0,
                task_count: 0,
                port_forward_count: 0,
              },
            },
          },
        }),
        provider_environments: [
          testProviderEnvironment('https://provider.example.invalid', 'env_demo', {
            preferredOpenRoute: 'local_host',
          }),
        ],
      }),
    }).environments.find((entry) => entry.kind === 'provider_environment');

    expect(environment).toBeTruthy();
    expect(completeEnvironmentGuidanceRefresh(
      startEnvironmentGuidanceIntent(null, environment!.id, 'refresh_runtime'),
      environment,
    )).toEqual(expect.objectContaining({
      environment_id: environment!.id,
      pending_intent: null,
      feedback: {
        tone: 'warning',
        title: 'Refresh provider status',
        detail: 'Reconnect this provider in Desktop to restore remote access.',
      },
    }));
  });

  it('settles the active session once the local runtime no longer exposes a guidance popover', () => {
    const localServe = testProviderBoundLocalEnvironment('https://provider.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: localServe,
      }),
      openSessions: [
        testLocalEnvironmentSession(localServe, 'http://127.0.0.1:24001/'),
      ],
    });
    const localEntry = snapshot.environments.find((entry) => entry.kind === 'local_environment');

    expect(localEntry).toBeTruthy();
    expect(environmentSupportsGuidancePopover(localEntry!)).toBe(false);
    expect(reconcileEnvironmentGuidanceSession(
      startEnvironmentGuidanceIntent(null, localEntry!.id, 'refresh_runtime'),
      snapshot.environments,
    )).toEqual({
      environment_id: localEntry!.id,
      pending_intent: null,
      feedback: {
        tone: 'success',
        title: 'Runtime ready',
        detail: 'The environment window is open and ready to focus.',
      },
    });
  });

  it('keeps settled success reconciliation referentially stable', () => {
    const localServe = testProviderBoundLocalEnvironment('https://provider.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: localServe,
      }),
      openSessions: [
        testLocalEnvironmentSession(localServe, 'http://127.0.0.1:24001/'),
      ],
    });
    const localEntry = snapshot.environments.find((entry) => entry.kind === 'local_environment');

    expect(localEntry).toBeTruthy();
    const settled = reconcileEnvironmentGuidanceSession(
      startEnvironmentGuidanceIntent(null, localEntry!.id, 'refresh_runtime'),
      snapshot.environments,
    );

    expect(reconcileEnvironmentGuidanceSession(settled, snapshot.environments)).toBe(settled);
  });

  it('replaces a stale Start and open retry when the refreshed target requires initialization', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({ local_environment: testLocalEnvironment() }),
    });
    const base = snapshot.environments.find((entry) => entry.kind === 'local_environment');
    expect(base).toBeTruthy();
    const missingRuntime = {
      ...base!,
      gateway_id: 'gw_local',
      gateway_env_id: 'env_local',
      runtime_health: {
        ...base!.runtime_health,
        status: 'offline' as const,
        freshness: 'fresh' as const,
      },
      runtime_management: {
        support: 'supported' as const,
        authorization: {
          state: 'allowed' as const,
          grants: ['manage_runtime', 'deploy_custom_runtime', 'manage_runtime_binding'] as const,
        },
        readiness: 'ready' as const,
        presentation_state: 'allowed' as const,
        target: { lifecycle_target_id: 'rlt_local', target_generation: 1 },
        compatibility: {
          gateway_protocol: 'redeven-gateway-v2',
          runtime_platform: 'darwin' as const,
          runtime_architecture: 'arm64' as const,
          runtime_service_protocol: 'redeven-runtime-v2',
          compatibility_epoch: 9,
          capabilities: ['runtime_operations_v2'],
        },
        operations: ['update_runtime', 'reconcile'] as const,
        artifact_policies: ['custom_build'] as const,
        checked_at_unix_ms: 10,
      },
      runtime_operations: {
        ...base!.runtime_operations,
        open: { ...base!.runtime_operations.open, availability: 'blocked' as const },
        start: {
          ...base!.runtime_operations.start,
          availability: 'hidden' as const,
          method: 'runtime_gateway' as const,
          reason_code: undefined,
        },
        update: {
          ...base!.runtime_operations.update,
          availability: 'available' as const,
          method: 'runtime_gateway' as const,
          reason_code: undefined,
        },
      },
    };
    const failedStart = failEnvironmentGuidanceIntent(
      startEnvironmentGuidanceIntent(null, base!.id, 'start_and_open'),
      'The runtime is unavailable.',
    );

    expect(reconcileEnvironmentGuidanceSession(failedStart, [missingRuntime])).toMatchObject({
      environment_id: base!.id,
      pending_intent: null,
      retry_intent: 'initialize_and_open',
    });
  });
});
