import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  testDesktopPreferences,
  testManagedControlPlaneEnvironment,
  testManagedLocalEnvironment,
  testManagedSession,
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

  it('keeps the panel open with a warning when refresh still resolves to an offline environment', () => {
    const environment = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [
          testManagedLocalEnvironment('default'),
          testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
            label: 'Demo Local Serve',
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
        title: 'Runtime is still offline',
        detail: 'The runtime is still offline on this device. Start it from its source, then try again.',
      },
    }));
  });

  it('reconciles away the session once the environment no longer exposes a guidance popover', () => {
    const localServe = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [testManagedLocalEnvironment('default'), localServe],
      }),
      openSessions: [
        testManagedSession(localServe, 'http://127.0.0.1:24001/'),
      ],
    });
    const providerEntry = snapshot.environments.find((entry) => entry.kind === 'provider_environment');

    expect(providerEntry).toBeTruthy();
    expect(environmentSupportsGuidancePopover(providerEntry!)).toBe(false);
    expect(reconcileEnvironmentGuidanceSession(
      openEnvironmentGuidanceSession(localServe.id),
      snapshot.environments,
    )).toBeNull();
  });
});
