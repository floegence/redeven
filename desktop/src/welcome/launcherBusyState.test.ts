import { describe, expect, it } from 'vitest';

import {
  busyStateForLauncherRequest,
  activeProgressForEnvironment,
  busyStateMatchesActionProgress,
  busyStateMatchesAction,
  busyStateMatchesAnyAction,
  busyStateMatchesControlPlane,
  busyStateMatchesEnvironment,
  busyStateWithActionProgress,
  environmentMatchesActionProgress,
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
      progress: null,
    });
    expect(busyStateMatchesEnvironment(state, 'env_demo')).toBe(true);
    expect(busyStateMatchesEnvironment(state, 'env_other')).toBe(false);
  });

  it('maps Local Environment settings save and connection delete flows to normalized busy actions', () => {
    expect(busyStateForLauncherRequest({
      kind: 'save_local_environment_settings',
      local_ui_bind: '127.0.0.1:24000',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
    })).toEqual({
      action: 'save_settings',
      environment_id: '',
      provider_origin: '',
      provider_id: '',
      progress: null,
    });

    expect(busyStateForLauncherRequest({
      kind: 'delete_saved_environment',
      environment_id: 'saved_demo',
    })).toEqual({
      action: 'delete_environment',
      environment_id: 'saved_demo',
      provider_origin: '',
      provider_id: '',
      progress: null,
    });
  });

  it('scopes control-plane requests by provider identity', () => {
    const refreshState = busyStateForLauncherRequest({
      kind: 'refresh_control_plane',
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'example_control_plane',
    });
    const connectState = busyStateForLauncherRequest({
      kind: 'start_control_plane_connect',
      provider_origin: 'https://cp.example.invalid',
      display_label: 'Demo Control Plane',
    });

    expect(busyStateMatchesControlPlane(
      refreshState,
      'https://cp.example.invalid',
      'example_control_plane',
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
      'example_control_plane',
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
    expect(busyStateMatchesAction(state, 'set_local_environment_pinned')).toBe(false);
    expect(busyStateMatchesAnyAction(state, [
      'set_provider_environment_pinned',
      'set_saved_environment_pinned',
    ])).toBe(true);
    expect(busyStateMatchesAnyAction(IDLE_LAUNCHER_BUSY_STATE, ['set_provider_environment_pinned'])).toBe(false);
  });

  it('attaches matching action progress to the active busy state', () => {
    const state = busyStateForLauncherRequest({
      kind: 'start_environment_runtime',
      environment_id: 'ssh-1',
      ssh_destination: 'devbox',
    });

    expect(busyStateWithActionProgress(state, {
      action: 'start_environment_runtime',
      environment_id: 'ssh-1',
      phase: 'ssh_starting_runtime',
      title: 'Starting remote runtime',
      detail: 'Waiting for the startup report.',
    })).toEqual({
      ...state,
      progress: {
        action: 'start_environment_runtime',
        environment_id: 'ssh-1',
        phase: 'ssh_starting_runtime',
        title: 'Starting remote runtime',
        detail: 'Waiting for the startup report.',
      },
    });

    expect(busyStateWithActionProgress(state, {
      action: 'refresh_environment_runtime',
      environment_id: 'ssh-1',
      phase: 'ignored',
      title: 'Ignored',
      detail: '',
    })).toBe(state);
  });

  it('matches persisted SSH runtime progress by environment id and operation key', () => {
    const state = busyStateForLauncherRequest({
      kind: 'start_environment_runtime',
      environment_id: 'ssh:%64evbox:default:key_agent:remote_default:envinst_demo',
      ssh_destination: 'devbox',
    });
    const progress = {
      action: 'start_environment_runtime' as const,
      environment_id: 'ssh:%64evbox:default:key_agent:remote_default:envinst_demo',
      operation_key: 'ssh:%64evbox:default:key_agent:remote_default:envinst_demo',
      phase: 'ssh_remote_installing',
      title: 'Installing remote runtime',
      detail: 'Running the remote installer.',
    };

    expect(environmentMatchesActionProgress(progress.environment_id, progress)).toBe(true);
    expect(busyStateMatchesActionProgress(state, progress)).toBe(true);
    expect(activeProgressForEnvironment(progress.environment_id, state, [])).toBeNull();

    const stateWithProgress = busyStateWithActionProgress(state, progress);
    expect(activeProgressForEnvironment(progress.environment_id, stateWithProgress, [])).toBe(progress);
    expect(activeProgressForEnvironment('other', stateWithProgress, [progress])).toBeNull();
    expect(activeProgressForEnvironment(progress.environment_id, IDLE_LAUNCHER_BUSY_STATE, [progress])).toBe(progress);
    expect(activeProgressForEnvironment(progress.operation_key, IDLE_LAUNCHER_BUSY_STATE, [progress])).toBe(progress);
  });
});
