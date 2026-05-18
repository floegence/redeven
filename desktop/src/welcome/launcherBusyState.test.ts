import { describe, expect, it } from 'vitest';

import type { DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import type { DesktopProviderRuntimeLinkTarget } from '../shared/providerRuntimeLinkTarget';
import {
  activeRuntimeStartupProgressForEnvironment,
  activeProgressForEnvironment,
  busyStateForLauncherRequest,
  busyStateMatchesActionProgress,
  busyStateMatchesAction,
  busyStateMatchesAnyAction,
  busyStateMatchesControlPlane,
  busyStateMatchesEnvironment,
  busyStateWithActionProgress,
  environmentMatchesActionProgress,
  environmentMatchesRuntimeStartupProgress,
  IDLE_LAUNCHER_BUSY_STATE,
} from './launcherBusyState';
import type { RuntimeStartupProgressEnvironmentMatch } from './launcherBusyState';

function runtimeID(value: `local:${string}` | `ssh:${string}`): DesktopRuntimeTargetID {
  return value as DesktopRuntimeTargetID;
}

function providerRuntimeTarget(
  runtimeKey: string,
  id: `local:${string}` | `ssh:${string}` = 'ssh:target',
): DesktopProviderRuntimeLinkTarget {
  return {
    id,
    kind: id.startsWith('ssh:') ? 'ssh_environment' : 'local_environment',
    environment_id: 'provider-env',
    label: 'Provider target',
    runtime_key: runtimeKey,
    runtime_url: 'http://127.0.0.1:24000/',
    runtime_running: true,
    runtime_openable: false,
    runtime_control_status: {
      state: 'available',
      owner: 'current_desktop',
    },
    provider_connection_state: 'connected',
    provider_link_state: 'linked',
    can_connect_provider: false,
    can_disconnect_provider: true,
  };
}

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

  it('matches persisted runtime progress by environment id and operation key', () => {
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

  it('matches runtime startup progress for local host, container, SSH host, and SSH container targets', () => {
    const localHostEnvironment: RuntimeStartupProgressEnvironmentMatch = {
      id: 'local',
      managed_runtime_target_id: runtimeID('local:local'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: undefined,
    };
    const localHostProgress = {
      action: 'start_environment_runtime' as const,
      environment_id: 'local',
      operation_key: 'local:host:local',
      subject_kind: 'local_environment' as const,
      subject_id: 'local',
      phase: 'checking_existing_runtime',
      title: 'Checking existing runtime',
      detail: 'Desktop is checking whether a compatible local runtime is already running.',
      runtime_startup: {
        kind: 'runtime_startup' as const,
        location: 'local_host' as const,
        phase: 'checking_existing_runtime' as const,
        stage_index: 1,
        stage_count: 4,
        target_label: 'Local Environment',
      },
    };

    const localContainerEnvironment: RuntimeStartupProgressEnvironmentMatch = {
      id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
      managed_runtime_target_id: runtimeID('local:container:docker:dev:abcd1234'),
      managed_runtime_placement_target_id: runtimeID('local:container:docker:dev:abcd1234'),
      provider_runtime_link_target: undefined,
    };
    const localContainerProgress = {
      action: 'start_environment_runtime' as const,
      environment_id: localContainerEnvironment.id,
      operation_key: 'local:container:docker:dev:abcd1234',
      subject_kind: 'runtime_target' as const,
      subject_id: 'local:container:docker:dev:abcd1234',
      phase: 'installing_runtime',
      title: 'Installing runtime in container',
      detail: 'Desktop is installing Redeven inside the running container.',
      runtime_startup: {
        kind: 'runtime_startup' as const,
        location: 'local_container' as const,
        phase: 'installing_runtime' as const,
        stage_index: 5,
        stage_count: 8,
        target_label: 'Dev Container',
      },
    };

    const sshHostEnvironment: RuntimeStartupProgressEnvironmentMatch = {
      id: 'ssh:%64evbox:default:key_agent:remote_default:envinst_demo',
      managed_runtime_target_id: runtimeID('ssh:ssh%3A%2564evbox%3Adefault%3Akey_agent%3Aremote_default%3Aenvinst_demo'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: providerRuntimeTarget('ssh:%64evbox:default:key_agent:remote_default:envinst_demo'),
    };
    const sshHostProgress = {
      action: 'start_environment_runtime' as const,
      environment_id: sshHostEnvironment.id,
      operation_key: 'ssh:%64evbox:default:key_agent:remote_default:envinst_demo',
      subject_kind: 'ssh_environment' as const,
      subject_id: 'ssh:%64evbox:default:key_agent:remote_default:envinst_demo',
      phase: 'ssh_remote_installing',
      title: 'Installing remote runtime',
      detail: 'Running the remote installer.',
      runtime_startup: {
        kind: 'runtime_startup' as const,
        location: 'ssh_host' as const,
        phase: 'installing_runtime' as const,
        stage_index: 5,
        stage_count: 8,
        target_label: 'Devbox',
      },
    };

    const sshContainerEnvironment: RuntimeStartupProgressEnvironmentMatch = {
      id: 'ssh-container-env',
      managed_runtime_target_id: runtimeID('ssh:container:devbox:docker:dev:abcd1234'),
      managed_runtime_placement_target_id: runtimeID('ssh:container:devbox:docker:dev:abcd1234'),
      provider_runtime_link_target: providerRuntimeTarget('ssh:container:devbox:docker:dev:abcd1234'),
    };
    const sshContainerProgress = {
      action: 'start_environment_runtime' as const,
      environment_id: 'ssh-container-env',
      operation_key: 'ssh:container:devbox:docker:dev:abcd1234',
      subject_kind: 'runtime_target' as const,
      subject_id: 'ssh:container:devbox:docker:dev:abcd1234',
      phase: 'checking_host',
      title: 'Checking SSH container',
      detail: 'Desktop is checking the SSH host and selected running container.',
      runtime_startup: {
        kind: 'runtime_startup' as const,
        location: 'ssh_container' as const,
        phase: 'checking_host' as const,
        stage_index: 1,
        stage_count: 9,
        target_label: 'Devbox Container',
      },
    };

    expect(environmentMatchesRuntimeStartupProgress(localHostEnvironment, localHostProgress)).toBe(true);
    expect(environmentMatchesRuntimeStartupProgress(localContainerEnvironment, localContainerProgress)).toBe(true);
    expect(environmentMatchesRuntimeStartupProgress(sshHostEnvironment, sshHostProgress)).toBe(true);
    expect(environmentMatchesRuntimeStartupProgress(sshContainerEnvironment, sshContainerProgress)).toBe(true);
    expect(environmentMatchesRuntimeStartupProgress(localHostEnvironment, localContainerProgress)).toBe(false);

    expect(activeRuntimeStartupProgressForEnvironment(
      localContainerEnvironment as never,
      IDLE_LAUNCHER_BUSY_STATE,
      [localHostProgress, localContainerProgress, sshHostProgress, sshContainerProgress],
    )).toBe(localContainerProgress);
    expect(activeRuntimeStartupProgressForEnvironment(
      sshHostEnvironment as never,
      {
        ...IDLE_LAUNCHER_BUSY_STATE,
        action: 'start_environment_runtime',
        environment_id: sshHostEnvironment.id,
        progress: sshHostProgress,
      },
      [],
    )).toBe(sshHostProgress);
  });
});
