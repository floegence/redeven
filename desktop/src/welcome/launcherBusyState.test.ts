import { describe, expect, it } from 'vitest';

import {
  busyStateForLauncherRequest,
  busyStateMatchesAction,
  busyStateMatchesAnyAction,
  busyStateMatchesControlPlane,
  busyStateMatchesEnvironment,
  IDLE_LAUNCHER_BUSY_STATE,
} from './launcherBusyState';

describe('launcherBusyState', () => {
  it('maps environment-scoped requests to the matching environment id', () => {
    const state = busyStateForLauncherRequest({
      kind: 'refresh_environment_runtime',
      environment_id: 'env_demo',
      label: 'Demo',
    });

    expect(state).toEqual({
      action: 'refresh_environment_runtime',
      environment_id: 'env_demo',
      provider_origin: '',
      provider_id: '',
    });
    expect(busyStateMatchesEnvironment(state, 'env_demo')).toBe(true);
    expect(busyStateMatchesEnvironment(state, 'env_other')).toBe(false);
  });

  it('maps environment save and delete flows to the normalized busy actions', () => {
    expect(busyStateForLauncherRequest({
      kind: 'upsert_managed_environment',
      environment_id: 'managed_demo',
      label: 'Demo',
      local_ui_bind: '127.0.0.1:24000',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
    })).toEqual({
      action: 'save_environment',
      environment_id: 'managed_demo',
      provider_origin: '',
      provider_id: '',
    });

    expect(busyStateForLauncherRequest({
      kind: 'delete_saved_environment',
      environment_id: 'saved_demo',
    })).toEqual({
      action: 'delete_environment',
      environment_id: 'saved_demo',
      provider_origin: '',
      provider_id: '',
    });
  });

  it('scopes control-plane requests by provider identity', () => {
    const refreshState = busyStateForLauncherRequest({
      kind: 'refresh_control_plane',
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'redeven_portal',
    });
    const connectState = busyStateForLauncherRequest({
      kind: 'start_control_plane_connect',
      provider_origin: 'https://cp.example.invalid',
      display_label: 'Demo Portal',
    });

    expect(busyStateMatchesControlPlane(
      refreshState,
      'https://cp.example.invalid',
      'redeven_portal',
      ['refresh_control_plane'],
    )).toBe(true);
    expect(busyStateMatchesControlPlane(
      refreshState,
      'https://cp.example.invalid',
      'other_provider',
      ['refresh_control_plane'],
    )).toBe(false);
    expect(busyStateMatchesControlPlane(
      connectState,
      'https://cp.example.invalid',
      'redeven_portal',
      ['start_control_plane_connect'],
    )).toBe(true);
  });

  it('supports helper checks for action matching', () => {
    const state = busyStateForLauncherRequest({
      kind: 'set_provider_environment_pinned',
      environment_id: 'env_demo',
      pinned: true,
    });

    expect(busyStateMatchesAction(state, 'set_provider_environment_pinned')).toBe(true);
    expect(busyStateMatchesAction(state, 'set_managed_environment_pinned')).toBe(false);
    expect(busyStateMatchesAnyAction(state, [
      'set_provider_environment_pinned',
      'set_saved_environment_pinned',
    ])).toBe(true);
    expect(busyStateMatchesAnyAction(IDLE_LAUNCHER_BUSY_STATE, ['set_provider_environment_pinned'])).toBe(false);
  });
});
