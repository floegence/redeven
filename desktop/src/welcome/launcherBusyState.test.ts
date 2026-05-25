import { describe, expect, it } from 'vitest';

import type { DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import {
  openConnectionProgress as buildOpenConnectionProgress,
  type DesktopOpenConnectionPhase,
} from '../shared/desktopOpenConnectionProgress';
import {
  runtimeLifecycleProgress,
  type DesktopRuntimeLifecycleOperation,
  type DesktopRuntimeLifecyclePhase,
} from '../shared/desktopRuntimeLifecycleProgress';
import type { DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import type { DesktopProviderRuntimeLinkTarget } from '../shared/providerRuntimeLinkTarget';
import {
  busyStateForLauncherRequest,
  busyStateBlocksEnvironmentAction,
  busyStateMatchesActionProgress,
  busyStateMatchesAction,
  busyStateMatchesAnyAction,
  busyStateMatchesControlPlane,
  busyStateMatchesEnvironment,
  busyStateWithActionProgress,
  environmentMatchesActionProgress,
  environmentMatchesRuntimeLifecycleProgress,
  IDLE_LAUNCHER_BUSY_STATE,
  launcherProgressBlocksPrimaryAction,
  selectedRuntimeLifecycleProgressForEnvironment,
  selectedOpenConnectionProgressForEnvironment,
  selectedProgressForEnvironment,
} from './launcherBusyState';
import type { RuntimeProgressEnvironmentMatch } from './launcherBusyState';
import { environmentProgressPrimaryPresentation } from './environmentProgressPrimaryPresentation';

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

type LauncherProgressStatus = NonNullable<DesktopLauncherActionProgress['status']>;

function localOpenActionProgress(input: Readonly<{
  status: LauncherProgressStatus;
  phase: DesktopOpenConnectionPhase;
  title: string;
  operationKey?: string;
  startedAt?: number;
  updatedAt?: number;
}>): DesktopLauncherActionProgress {
  return {
    action: 'open_local_environment',
    environment_id: 'local',
    environment_label: 'Local Environment',
    operation_key: input.operationKey ?? 'local:host:local:open',
    subject_kind: 'local_environment',
    subject_id: 'local',
    started_at_unix_ms: input.startedAt ?? 100,
    updated_at_unix_ms: input.updatedAt,
    status: input.status,
    phase: input.phase,
    title: input.title,
    detail: 'Desktop is updating the local Env App window.',
    open_progress: buildOpenConnectionProgress({
      location: 'local_host',
      phase: input.phase,
      environmentID: 'local',
      environmentLabel: 'Local Environment',
      targetID: 'local:local',
      targetLabel: 'Local Environment',
    }),
  };
}

function localRuntimeLifecycleActionProgress(input: Readonly<{
  status: LauncherProgressStatus;
  action: Extract<DesktopLauncherActionProgress['action'], 'start_environment_runtime' | 'restart_environment_runtime' | 'update_environment_runtime' | 'stop_environment_runtime'>;
  operation: DesktopRuntimeLifecycleOperation;
  phase: DesktopRuntimeLifecyclePhase;
  title: string;
  operationKey?: string;
  startedAt?: number;
  updatedAt?: number;
}>): DesktopLauncherActionProgress {
  return {
    action: input.action,
    environment_id: 'local',
    environment_label: 'Local Environment',
    operation_key: input.operationKey ?? 'local:host:local:lifecycle',
    subject_kind: 'local_environment',
    subject_id: 'local',
    started_at_unix_ms: input.startedAt ?? 100,
    updated_at_unix_ms: input.updatedAt,
    status: input.status,
    phase: input.phase,
    title: input.title,
    detail: 'Desktop is updating the local runtime lifecycle.',
    lifecycle_progress: runtimeLifecycleProgress({
      location: 'local_host',
      operation: input.operation,
      phase: input.phase,
      failedPhase: input.status === 'failed' || input.status === 'cleanup_failed' ? input.phase : undefined,
      targetID: 'local:local',
      targetLabel: 'Local Environment',
    }),
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
      auto_runtime_probe_enabled: false,
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
    expect(selectedProgressForEnvironment(progress.environment_id, state, [])).toBeNull();

    const stateWithProgress = busyStateWithActionProgress(state, progress);
    expect(selectedProgressForEnvironment(progress.environment_id, stateWithProgress, [])).toBe(progress);
    expect(selectedProgressForEnvironment('other', stateWithProgress, [progress])).toBeNull();
    expect(selectedProgressForEnvironment(progress.environment_id, IDLE_LAUNCHER_BUSY_STATE, [progress])).toBe(progress);
    expect(selectedProgressForEnvironment(progress.operation_key, IDLE_LAUNCHER_BUSY_STATE, [progress])).toBe(progress);
  });

  it('blocks primary actions only while launcher progress is still active', () => {
    const progress = {
      action: 'open_local_environment' as const,
      environment_id: 'local',
      phase: 'opening_window',
      title: 'Opening environment',
      detail: 'Desktop is opening the local Env App window.',
    };

    expect(launcherProgressBlocksPrimaryAction({ ...progress, status: 'running' })).toBe(true);
    expect(launcherProgressBlocksPrimaryAction({ ...progress, status: 'canceling' })).toBe(true);
    expect(launcherProgressBlocksPrimaryAction({ ...progress, status: 'cleanup_running' })).toBe(true);

    expect(launcherProgressBlocksPrimaryAction({ ...progress, status: 'succeeded' })).toBe(false);
    expect(launcherProgressBlocksPrimaryAction({ ...progress, status: 'failed' })).toBe(false);
    expect(launcherProgressBlocksPrimaryAction({ ...progress, status: 'canceled' })).toBe(false);
    expect(launcherProgressBlocksPrimaryAction({ ...progress, status: 'cleanup_failed' })).toBe(false);
    expect(launcherProgressBlocksPrimaryAction(progress)).toBe(false);
    expect(launcherProgressBlocksPrimaryAction(null)).toBe(false);
  });

  it('keeps retained terminal Open progress inspectable without blocking the primary action', () => {
    const environment: RuntimeProgressEnvironmentMatch = {
      id: 'local',
      managed_runtime_target_id: runtimeID('local:local'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: undefined,
    };
    const succeededOpenProgress = {
      action: 'open_local_environment' as const,
      environment_id: 'local',
      operation_key: 'local:host:local:open',
      subject_kind: 'local_environment' as const,
      subject_id: 'local',
      phase: 'open_ready',
      title: 'Open ready',
      detail: 'Desktop opened the local Env App window.',
      status: 'succeeded' as const,
      open_progress: buildOpenConnectionProgress({
        location: 'local_host',
        phase: 'open_ready',
        environmentID: 'local',
        environmentLabel: 'Local Environment',
        targetID: 'local:local',
        targetLabel: 'Local Environment',
      }),
    };
    const runningOpenProgress = {
      ...succeededOpenProgress,
      phase: 'opening_window',
      title: 'Opening environment',
      detail: 'Desktop is opening the local Env App window.',
      status: 'running' as const,
      open_progress: buildOpenConnectionProgress({
        location: 'local_host',
        phase: 'opening_window',
        environmentID: 'local',
        environmentLabel: 'Local Environment',
        targetID: 'local:local',
        targetLabel: 'Local Environment',
      }),
    };

    expect(selectedOpenConnectionProgressForEnvironment(
      environment as never,
      IDLE_LAUNCHER_BUSY_STATE,
      [succeededOpenProgress],
    )).toBe(succeededOpenProgress);
    expect(launcherProgressBlocksPrimaryAction(succeededOpenProgress)).toBe(false);
    expect(selectedOpenConnectionProgressForEnvironment(
      environment as never,
      IDLE_LAUNCHER_BUSY_STATE,
      [runningOpenProgress],
    )).toBe(runningOpenProgress);
    expect(launcherProgressBlocksPrimaryAction(runningOpenProgress)).toBe(true);
  });

  it('prefers a terminal Open progress update over stale running busy progress for the same operation', () => {
    const environment: RuntimeProgressEnvironmentMatch = {
      id: 'local',
      managed_runtime_target_id: runtimeID('local:local'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: undefined,
    };
    const runningOpenProgress = localOpenActionProgress({
      status: 'running',
      phase: 'opening_window',
      title: 'Opening environment',
      operationKey: 'local:host:local:open:123',
      startedAt: 100,
      updatedAt: 110,
    });
    const failedOpenProgress = localOpenActionProgress({
      status: 'failed',
      phase: 'failed',
      title: 'Open failed',
      operationKey: 'local:host:local:open:123',
      startedAt: 100,
      updatedAt: 120,
    });
    const selectedProgress = selectedOpenConnectionProgressForEnvironment(
      environment as never,
      {
        ...IDLE_LAUNCHER_BUSY_STATE,
        action: 'open_local_environment',
        environment_id: 'local',
        progress: runningOpenProgress,
      },
      [failedOpenProgress],
    );

    expect(selectedProgress).toBe(failedOpenProgress);
    expect(launcherProgressBlocksPrimaryAction(selectedProgress)).toBe(false);
    expect(busyStateBlocksEnvironmentAction(
      {
        ...IDLE_LAUNCHER_BUSY_STATE,
        action: 'open_local_environment',
        environment_id: 'local',
        progress: runningOpenProgress,
      },
      'local',
      ['open_local_environment'],
      selectedProgress,
    )).toBe(false);
    expect(environmentProgressPrimaryPresentation(selectedProgress)).toMatchObject({
      kind: 'attention_trigger',
      label: 'Open failed',
    });
  });

  it('prefers snapshot terminal Open progress over busy running progress when timestamps tie on the same attempt', () => {
    const environment: RuntimeProgressEnvironmentMatch = {
      id: 'local',
      managed_runtime_target_id: runtimeID('local:local'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: undefined,
    };
    const operationKey = 'local:host:local:open';
    const runningBusyProgress = localOpenActionProgress({
      status: 'running',
      phase: 'opening_window',
      title: 'Opening environment',
      operationKey,
      startedAt: 100,
      updatedAt: 100,
    });
    const failedSnapshotProgress = localOpenActionProgress({
      status: 'failed',
      phase: 'failed',
      title: 'Open failed',
      operationKey,
      startedAt: 100,
      updatedAt: 100,
    });

    expect(selectedOpenConnectionProgressForEnvironment(
      environment as never,
      {
        ...IDLE_LAUNCHER_BUSY_STATE,
        action: 'open_local_environment',
        environment_id: 'local',
        progress: runningBusyProgress,
      },
      [failedSnapshotProgress],
    )).toBe(failedSnapshotProgress);
  });

  it('keeps a retrying Open attempt ahead of a retained failure for the previous attempt', () => {
    const environment: RuntimeProgressEnvironmentMatch = {
      id: 'local',
      managed_runtime_target_id: runtimeID('local:local'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: undefined,
    };
    const operationKey = 'local:host:local:open';
    const failedPreviousAttempt = localOpenActionProgress({
      status: 'failed',
      phase: 'failed',
      title: 'Open failed',
      operationKey,
      startedAt: 100,
      updatedAt: 200,
    });
    const runningRetryAttempt = localOpenActionProgress({
      status: 'running',
      phase: 'opening_window',
      title: 'Opening environment',
      operationKey,
      startedAt: 200,
      updatedAt: 200,
    });

    expect(selectedOpenConnectionProgressForEnvironment(
      environment as never,
      IDLE_LAUNCHER_BUSY_STATE,
      [failedPreviousAttempt, runningRetryAttempt],
    )).toBe(runningRetryAttempt);
    expect(launcherProgressBlocksPrimaryAction(runningRetryAttempt)).toBe(true);
    expect(environmentProgressPrimaryPresentation(runningRetryAttempt)).toMatchObject({
      kind: 'progress_trigger',
      label: 'Opening...',
    });
  });

  it('releases stale Open busy state when succeeded or canceled progress lands for the same attempt', () => {
    const environment: RuntimeProgressEnvironmentMatch = {
      id: 'local',
      managed_runtime_target_id: runtimeID('local:local'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: undefined,
    };
    const operationKey = 'local:host:local:open';
    const runningOpenProgress = localOpenActionProgress({
      status: 'running',
      phase: 'opening_window',
      title: 'Opening environment',
      operationKey,
      startedAt: 100,
      updatedAt: 100,
    });
    const busyState = {
      ...IDLE_LAUNCHER_BUSY_STATE,
      action: 'open_local_environment' as const,
      environment_id: 'local',
      progress: runningOpenProgress,
    };
    const succeededOpenProgress = localOpenActionProgress({
      status: 'succeeded',
      phase: 'open_ready',
      title: 'Environment open',
      operationKey,
      startedAt: 100,
      updatedAt: 100,
    });
    const canceledOpenProgress = localOpenActionProgress({
      status: 'canceled',
      phase: 'canceled',
      title: 'Open canceled',
      operationKey,
      startedAt: 100,
      updatedAt: 100,
    });

    for (const releasedProgress of [succeededOpenProgress, canceledOpenProgress]) {
      const selectedProgress = selectedOpenConnectionProgressForEnvironment(
        environment as never,
        busyState,
        [releasedProgress],
      );
      expect(selectedProgress).toBe(releasedProgress);
      expect(launcherProgressBlocksPrimaryAction(selectedProgress)).toBe(false);
      expect(busyStateBlocksEnvironmentAction(
        busyState,
        'local',
        ['open_local_environment'],
        selectedProgress,
      )).toBe(false);
    }
  });

  it('matches runtime lifecycle progress for local host, container, SSH host, and SSH container targets', () => {
    const localHostEnvironment: RuntimeProgressEnvironmentMatch = {
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
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_host',
        phase: 'checking_existing_runtime',
        targetID: 'local:local',
        targetLabel: 'Local Environment',
      }),
    };

    const localContainerEnvironment: RuntimeProgressEnvironmentMatch = {
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
      phase: 'installing_runtime_package',
      title: 'Installing runtime in container',
      detail: 'Desktop is installing Redeven inside the running container.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_container',
        phase: 'installing_runtime_package',
        targetID: 'local:container:docker:dev:abcd1234',
        targetLabel: 'Dev Container',
      }),
    };

    const sshHostEnvironment: RuntimeProgressEnvironmentMatch = {
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
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'ssh_host',
        phase: 'installing_runtime_package',
        targetID: 'ssh:%64evbox:default:key_agent:remote_default:envinst_demo',
        targetLabel: 'Devbox',
      }),
    };

    const sshContainerEnvironment: RuntimeProgressEnvironmentMatch = {
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
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'ssh_container',
        phase: 'checking_host',
        targetID: 'ssh:container:devbox:docker:dev:abcd1234',
        targetLabel: 'Devbox Container',
      }),
    };

    expect(environmentMatchesRuntimeLifecycleProgress(localHostEnvironment, localHostProgress)).toBe(true);
    expect(environmentMatchesRuntimeLifecycleProgress(localContainerEnvironment, localContainerProgress)).toBe(true);
    expect(environmentMatchesRuntimeLifecycleProgress(sshHostEnvironment, sshHostProgress)).toBe(true);
    expect(environmentMatchesRuntimeLifecycleProgress(sshContainerEnvironment, sshContainerProgress)).toBe(true);
    expect(environmentMatchesRuntimeLifecycleProgress(localHostEnvironment, localContainerProgress)).toBe(false);

    expect(selectedRuntimeLifecycleProgressForEnvironment(
      localContainerEnvironment as never,
      IDLE_LAUNCHER_BUSY_STATE,
      [localHostProgress, localContainerProgress, sshHostProgress, sshContainerProgress],
    )).toBe(localContainerProgress);
    expect(selectedRuntimeLifecycleProgressForEnvironment(
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

  it('prefers terminal runtime lifecycle progress over stale running busy progress for the same operation', () => {
    const environment: RuntimeProgressEnvironmentMatch = {
      id: 'local',
      managed_runtime_target_id: runtimeID('local:local'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: undefined,
    };
    const runningStopProgress = localRuntimeLifecycleActionProgress({
      status: 'running',
      action: 'stop_environment_runtime',
      operation: 'stop',
      phase: 'stopping_runtime_process',
      title: 'Stopping runtime',
      operationKey: 'local:host:local:stop:456',
      startedAt: 100,
      updatedAt: 110,
    });
    const stopFailedProgress = localRuntimeLifecycleActionProgress({
      status: 'failed',
      action: 'stop_environment_runtime',
      operation: 'stop',
      phase: 'stopping_runtime_process',
      title: 'Stop failed',
      operationKey: 'local:host:local:stop:456',
      startedAt: 100,
      updatedAt: 120,
    });
    const cleanupFailedProgress = localRuntimeLifecycleActionProgress({
      status: 'cleanup_failed',
      action: 'stop_environment_runtime',
      operation: 'stop',
      phase: 'verifying_runtime_stopped',
      title: 'Cleanup failed',
      operationKey: 'local:host:local:stop:456',
      startedAt: 100,
      updatedAt: 130,
    });
    const busyState = {
      ...IDLE_LAUNCHER_BUSY_STATE,
      action: 'stop_environment_runtime' as const,
      environment_id: 'local',
      progress: runningStopProgress,
    };

    const selectedStopFailedProgress = selectedRuntimeLifecycleProgressForEnvironment(
      environment as never,
      busyState,
      [stopFailedProgress],
    );
    const selectedCleanupFailedProgress = selectedRuntimeLifecycleProgressForEnvironment(
      environment as never,
      busyState,
      [cleanupFailedProgress],
    );

    expect(selectedStopFailedProgress).toBe(stopFailedProgress);
    expect(launcherProgressBlocksPrimaryAction(selectedStopFailedProgress)).toBe(false);
    expect(busyStateBlocksEnvironmentAction(
      busyState,
      'local',
      ['stop_environment_runtime'],
      selectedStopFailedProgress,
    )).toBe(false);
    expect(environmentProgressPrimaryPresentation(selectedStopFailedProgress)).toMatchObject({
      kind: 'attention_trigger',
      label: 'Stop failed',
    });

    expect(selectedCleanupFailedProgress).toBe(cleanupFailedProgress);
    expect(launcherProgressBlocksPrimaryAction(selectedCleanupFailedProgress)).toBe(false);
    expect(busyStateBlocksEnvironmentAction(
      busyState,
      'local',
      ['stop_environment_runtime'],
      selectedCleanupFailedProgress,
    )).toBe(false);
    expect(environmentProgressPrimaryPresentation(selectedCleanupFailedProgress)).toMatchObject({
      kind: 'attention_trigger',
      label: 'Cleanup failed',
    });
  });

  it('prefers snapshot terminal runtime lifecycle progress over busy running progress when timestamps tie on the same attempt', () => {
    const environment: RuntimeProgressEnvironmentMatch = {
      id: 'local',
      managed_runtime_target_id: runtimeID('local:local'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: undefined,
    };
    const operationKey = 'local:host:local:restart';
    const runningBusyProgress = localRuntimeLifecycleActionProgress({
      status: 'running',
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'starting_runtime_process',
      title: 'Restarting runtime',
      operationKey,
      startedAt: 100,
      updatedAt: 100,
    });
    const failedSnapshotProgress = localRuntimeLifecycleActionProgress({
      status: 'failed',
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'starting_runtime_process',
      title: 'Restart failed',
      operationKey,
      startedAt: 100,
      updatedAt: 100,
    });

    expect(selectedRuntimeLifecycleProgressForEnvironment(
      environment as never,
      {
        ...IDLE_LAUNCHER_BUSY_STATE,
        action: 'restart_environment_runtime',
        environment_id: 'local',
        progress: runningBusyProgress,
      },
      [failedSnapshotProgress],
    )).toBe(failedSnapshotProgress);
  });

  it('releases stale lifecycle busy state when the same attempt succeeds or is canceled', () => {
    const environment: RuntimeProgressEnvironmentMatch = {
      id: 'local',
      managed_runtime_target_id: runtimeID('local:local'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: undefined,
    };
    const operationKey = 'local:host:local:restart';
    const runningRestartProgress = localRuntimeLifecycleActionProgress({
      status: 'running',
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'starting_runtime_process',
      title: 'Restarting runtime',
      operationKey,
      startedAt: 100,
      updatedAt: 100,
    });
    const busyState = {
      ...IDLE_LAUNCHER_BUSY_STATE,
      action: 'restart_environment_runtime' as const,
      environment_id: 'local',
      progress: runningRestartProgress,
    };
    const succeededRestartProgress = localRuntimeLifecycleActionProgress({
      status: 'succeeded',
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'runtime_ready',
      title: 'Runtime ready',
      operationKey,
      startedAt: 100,
      updatedAt: 100,
    });
    const canceledRestartProgress = localRuntimeLifecycleActionProgress({
      status: 'canceled',
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      title: 'Restart canceled',
      operationKey,
      startedAt: 100,
      updatedAt: 100,
    });

    for (const releasedProgress of [succeededRestartProgress, canceledRestartProgress]) {
      const selectedProgress = selectedRuntimeLifecycleProgressForEnvironment(
        environment as never,
        busyState,
        [releasedProgress],
      );
      expect(selectedProgress).toBe(releasedProgress);
      expect(launcherProgressBlocksPrimaryAction(selectedProgress)).toBe(false);
      expect(busyStateBlocksEnvironmentAction(
        busyState,
        'local',
        ['restart_environment_runtime'],
        selectedProgress,
      )).toBe(false);
    }
  });

  it('matches Open connection progress without treating it as runtime lifecycle progress', () => {
    const localHostEnvironment: RuntimeProgressEnvironmentMatch = {
      id: 'local',
      managed_runtime_target_id: undefined,
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: providerRuntimeTarget('local', 'local:local'),
    };
    const localHostProgress = {
      action: 'open_local_environment' as const,
      environment_id: 'local',
      operation_key: 'local:host:local:open',
      subject_kind: 'local_environment' as const,
      subject_id: 'local',
      phase: 'checking_runtime_record',
      title: 'Checking runtime status',
      detail: 'Desktop is checking the runtime status before opening this environment.',
      open_progress: {
        kind: 'open_connection' as const,
        location: 'local_host' as const,
        phase: 'checking_runtime_record' as const,
        stage_index: 1,
        stage_count: 4,
        environment_id: 'local',
        environment_label: 'Local Environment',
        target_id: 'local:host:local',
        target_label: 'Local Environment',
      },
    };
    const environment: RuntimeProgressEnvironmentMatch = {
      id: 'ssh-env',
      managed_runtime_target_id: runtimeID('ssh:devbox'),
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: providerRuntimeTarget('ssh:devbox'),
    };
    const progress = {
      action: 'open_ssh_environment' as const,
      environment_id: 'ssh-env',
      operation_key: 'ssh:devbox:open',
      subject_kind: 'ssh_environment' as const,
      subject_id: 'ssh:devbox',
      phase: 'opening_local_tunnel',
      title: 'Opening local tunnel',
      detail: 'Desktop is opening the local SSH tunnel.',
      open_progress: {
        kind: 'open_connection' as const,
        location: 'ssh_host' as const,
        phase: 'opening_local_tunnel' as const,
        stage_index: 4,
        stage_count: 9,
        environment_id: 'ssh-env',
        environment_label: 'Devbox',
        target_id: 'ssh:devbox',
        target_label: 'Devbox',
      },
    };

    expect(environmentMatchesRuntimeLifecycleProgress(localHostEnvironment, localHostProgress)).toBe(false);
    expect(selectedOpenConnectionProgressForEnvironment(
      localHostEnvironment as never,
      IDLE_LAUNCHER_BUSY_STATE,
      [localHostProgress],
    )).toBe(localHostProgress);
    expect(environmentMatchesRuntimeLifecycleProgress(environment, progress)).toBe(false);
    expect(selectedOpenConnectionProgressForEnvironment(
      environment as never,
      IDLE_LAUNCHER_BUSY_STATE,
      [progress],
    )).toBe(progress);
  });
});
