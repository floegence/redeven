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

  it('uses action-specific failure copy for runtime starts', () => {
    const state = failEnvironmentGuidanceIntent(
      startEnvironmentGuidanceIntent(null, 'env_demo', 'start_runtime'),
      '',
    );

    expect(state).toEqual({
      environment_id: 'env_demo',
      pending_intent: null,
      feedback: {
        tone: 'error',
        title: 'Runtime start failed',
        detail: 'Desktop could not start the runtime for this environment.',
      },
    });
  });

  it('keeps the panel open with plan guidance when refresh still resolves to a blocked environment', () => {
    const environment = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment({
          currentRuntime: {
            local_ui_url: 'http://127.0.0.1:24001/',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            runtime_service: {
              protocol_version: 'redeven-runtime-v1',
              service_owner: 'desktop',
              desktop_managed: true,
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
          testProviderEnvironment('https://cp.example.invalid', 'env_demo'),
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
        title: 'Runtime is busy',
        detail: 'The Local Runtime is busy. Close active runtime work before Desktop relinks it to this provider Environment.',
      },
    }));
  });

  it('settles the active session once the environment no longer exposes a guidance popover', () => {
    const localServe = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo', {
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
    const providerEntry = snapshot.environments.find((entry) => entry.kind === 'provider_environment');

    expect(providerEntry).toBeTruthy();
    expect(environmentSupportsGuidancePopover(providerEntry!)).toBe(false);
    expect(reconcileEnvironmentGuidanceSession(
      startEnvironmentGuidanceIntent(null, providerEntry!.id, 'start_runtime'),
      snapshot.environments,
    )).toEqual({
      environment_id: providerEntry!.id,
      pending_intent: null,
      feedback: {
        tone: 'success',
        title: 'Runtime ready',
        detail: 'The environment window is open and ready to focus.',
      },
    });
  });

  it('keeps settled success reconciliation referentially stable', () => {
    const localServe = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo', {
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
    const providerEntry = snapshot.environments.find((entry) => entry.kind === 'provider_environment');

    expect(providerEntry).toBeTruthy();
    const settled = reconcileEnvironmentGuidanceSession(
      startEnvironmentGuidanceIntent(null, providerEntry!.id, 'start_runtime'),
      snapshot.environments,
    );

    expect(reconcileEnvironmentGuidanceSession(settled, snapshot.environments)).toBe(settled);
  });
});
