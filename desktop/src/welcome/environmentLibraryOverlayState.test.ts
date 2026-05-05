import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  testDesktopPreferences,
  testProviderBoundLocalEnvironment,
  testLocalEnvironment,
  testLocalEnvironmentSession,
} from '../testSupport/desktopTestHelpers';
import {
  closeEnvironmentLibraryOverlayState,
  closedEnvironmentLibraryOverlayState,
  environmentLibraryOverlayOpenFor,
  openEnvironmentLibraryOverlayState,
  reconcileEnvironmentLibraryOverlayState,
} from './environmentLibraryOverlayState';

describe('environmentLibraryOverlayState', () => {
  it('opens and closes runtime menu state by environment id', () => {
    const open = openEnvironmentLibraryOverlayState('runtime_menu', 'env_demo');

    expect(environmentLibraryOverlayOpenFor(open, 'runtime_menu', 'env_demo')).toBe(true);
    expect(closeEnvironmentLibraryOverlayState(open, 'runtime_menu', 'env_demo')).toEqual(closedEnvironmentLibraryOverlayState());
  });

  it('keeps a runtime menu open across refresh while the same environment remains visible', () => {
    const localServe = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const initialSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: localServe,
      }),
    });
    const refreshedSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: localServe,
      }),
      openSessions: [
        testLocalEnvironmentSession(localServe, 'http://127.0.0.1:24001/'),
      ],
    });
    const providerEntry = initialSnapshot.environments.find((environment) => environment.kind === 'provider_environment');

    expect(providerEntry).toBeTruthy();

    const state = openEnvironmentLibraryOverlayState('runtime_menu', providerEntry!.id);
    expect(reconcileEnvironmentLibraryOverlayState(state, refreshedSnapshot.environments)).toEqual(state);
  });

  it('keeps a guidance overlay open across refresh while the same environment still exposes popover guidance', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo'),
      }),
    });
    const providerEntry = snapshot.environments.find((environment) => environment.kind === 'provider_environment');

    expect(providerEntry).toBeTruthy();

    const state = openEnvironmentLibraryOverlayState('primary_action_guidance', providerEntry!.id);
    expect(reconcileEnvironmentLibraryOverlayState(state, snapshot.environments)).toEqual(state);
  });

  it('closes a guidance overlay when the environment is no longer visible in the current card list', () => {
    const localServe = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo');
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: localServe,
      }),
    });
    const providerEntry = snapshot.environments.find((environment) => environment.kind === 'provider_environment');
    const visibleEntries = snapshot.environments.filter((environment) => environment.id !== providerEntry!.id);
    const state = openEnvironmentLibraryOverlayState('primary_action_guidance', providerEntry!.id);

    expect(reconcileEnvironmentLibraryOverlayState(state, visibleEntries)).toEqual(closedEnvironmentLibraryOverlayState());
  });

  it('closes a guidance overlay once the same environment no longer exposes blocked-action guidance', () => {
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
    const providerEntry = snapshot.environments.find((environment) => environment.kind === 'provider_environment');
    const state = openEnvironmentLibraryOverlayState('primary_action_guidance', localServe.id);

    expect(providerEntry).toBeTruthy();
    expect(reconcileEnvironmentLibraryOverlayState(state, snapshot.environments)).toEqual(closedEnvironmentLibraryOverlayState());
  });

  it('closes a guidance overlay when the same environment now only exposes tooltip guidance', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment('default'),
        saved_environments: [{
          id: 'http://192.168.1.12:24000/',
          label: 'Staging',
          local_ui_url: 'http://192.168.1.12:24000/',
          source: 'saved',
          pinned: false,
          last_used_at_ms: 200,
        }],
      }),
    });
    const savedEntry = snapshot.environments.find((environment) => environment.kind === 'external_local_ui');
    const state = openEnvironmentLibraryOverlayState('primary_action_guidance', 'http://192.168.1.12:24000/');

    expect(savedEntry).toBeTruthy();
    expect(reconcileEnvironmentLibraryOverlayState(state, snapshot.environments)).toEqual(closedEnvironmentLibraryOverlayState());
  });
});
