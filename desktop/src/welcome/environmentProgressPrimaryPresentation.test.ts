import { describe, expect, it } from 'vitest';

import type { DesktopLauncherActionKind, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import {
  openConnectionProgress as buildOpenConnectionProgress,
  type DesktopOpenConnectionPhase,
} from '../shared/desktopOpenConnectionProgress';
import {
  runtimeLifecycleProgress,
  type DesktopRuntimeLifecycleOperation,
  type DesktopRuntimeLifecyclePhase,
} from '../shared/desktopRuntimeLifecycleProgress';
import type { EnvironmentActionModel } from './viewModel';
import {
  environmentProgressPanelPrimaryAction,
  environmentProgressPrimaryPresentation,
  openConnectionFailurePrimaryAction,
  runtimeLifecycleReadyPrimaryAction,
  selectEnvironmentPanelProgress,
} from './environmentProgressPrimaryPresentation';

const openAction: EnvironmentActionModel = {
  intent: 'open',
  label: 'Open',
  enabled: true,
  variant: 'default',
};

function lifecycleActionProgress(input: Readonly<{
  action?: DesktopLauncherActionKind;
  operation?: DesktopRuntimeLifecycleOperation;
  phase?: DesktopRuntimeLifecyclePhase;
  status?: DesktopLauncherActionProgress['status'];
  startedAt?: number;
  updatedAt?: number;
}> = {}): DesktopLauncherActionProgress {
  const phase = input.phase ?? 'runtime_ready';
  return {
    action: input.action ?? 'restart_environment_runtime',
    environment_id: 'local-environment',
    environment_label: 'Local Environment',
    operation_key: 'runtime-operation',
    subject_kind: 'local_environment',
    subject_id: 'local-environment',
    started_at_unix_ms: input.startedAt ?? 100,
    updated_at_unix_ms: input.updatedAt,
    status: input.status ?? 'succeeded',
    phase,
    title: phase === 'runtime_ready' ? 'Runtime ready' : 'Runtime stopped',
    detail: 'Desktop updated the runtime lifecycle.',
    lifecycle_progress: runtimeLifecycleProgress({
      location: 'local_host',
      operation: input.operation ?? 'restart',
      phase,
      targetID: 'local-environment',
      targetLabel: 'Local Environment',
    }),
  };
}

function openConnectionProgress(
  status: DesktopLauncherActionProgress['status'],
  input: Readonly<{
    startedAt?: number;
    updatedAt?: number;
    nextActions?: DesktopLauncherActionProgress['next_actions'];
    failure?: DesktopLauncherActionProgress['failure'];
  }> = {},
): DesktopLauncherActionProgress {
  const phase = openConnectionPhaseForStatus(status);
  return {
    action: 'open_local_environment',
    environment_id: 'local-environment',
    environment_label: 'Local Environment',
    operation_key: 'open-operation',
    subject_kind: 'local_environment',
    subject_id: 'local-environment',
    started_at_unix_ms: input.startedAt ?? 200,
    updated_at_unix_ms: input.updatedAt,
    status,
    phase,
    title: status === 'failed' ? 'Open failed' : 'Opening environment',
    detail: 'Desktop is opening the environment.',
    ...(input.nextActions ? { next_actions: input.nextActions } : {}),
    ...(input.failure ? { failure: input.failure } : {}),
    open_progress: buildOpenConnectionProgress({
      location: 'local_host',
      phase,
      environmentID: 'local-environment',
      environmentLabel: 'Local Environment',
      targetID: 'local-environment',
      targetLabel: 'Local Environment',
    }),
  };
}

describe('runtimeLifecycleReadyPrimaryAction', () => {
  it('returns the Open action once a runtime start or restart reaches runtime_ready', () => {
    expect(runtimeLifecycleReadyPrimaryAction(lifecycleActionProgress(), openAction)).toBe(openAction);
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress({ action: 'start_environment_runtime', operation: 'start' }),
      openAction,
    )).toBe(openAction);
  });

  it('allows Focus when the environment window is already open', () => {
    const focusAction: EnvironmentActionModel = {
      intent: 'focus',
      label: 'Focus',
      enabled: true,
      variant: 'default',
    };

    expect(runtimeLifecycleReadyPrimaryAction(lifecycleActionProgress(), focusAction)).toBe(focusAction);
  });

  it('does not offer Open for stop or non-ready terminal lifecycle progress', () => {
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress({
        action: 'stop_environment_runtime',
        operation: 'stop',
        phase: 'runtime_stopped',
      }),
      openAction,
    )).toBeNull();
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress({
        action: 'update_environment_runtime',
        operation: 'update',
        phase: 'runtime_up_to_date',
      }),
      openAction,
    )).toBeNull();
  });

  it('requires a succeeded lifecycle and an enabled Open-owned primary action', () => {
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress({ status: 'failed' }),
      openAction,
    )).toBeNull();
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress(),
      { ...openAction, enabled: false },
    )).toBeNull();
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress(),
      { ...openAction, intent: 'restart_runtime', label: 'Restart runtime' },
    )).toBeNull();
  });
});

describe('openConnectionFailurePrimaryAction', () => {
  it('promotes runtime update to the primary recovery action', () => {
    const focusAction: EnvironmentActionModel = {
      intent: 'focus',
      label: 'Focus',
      enabled: true,
      variant: 'default',
    };
    const nextActions: DesktopLauncherActionProgress['next_actions'] = [
      { kind: 'refresh_status', environment_id: 'local-environment', label: 'Refresh status' },
      { kind: 'update_runtime', environment_id: 'local-environment', label: 'Update runtime' },
    ];

    expect(openConnectionFailurePrimaryAction(openConnectionProgress('failed', { nextActions }), openAction)).toEqual({
      intent: 'update_runtime',
      label: 'Update runtime and open',
      enabled: true,
      variant: 'default',
      continue_open_after_completion: true,
    });
    expect(openConnectionFailurePrimaryAction(openConnectionProgress('cleanup_failed', { nextActions }), focusAction)).toMatchObject({
      intent: 'update_runtime',
      continue_open_after_completion: true,
    });
  });

  it('uses refresh status when the failure cannot identify a recovery operation', () => {
    const nextActions: DesktopLauncherActionProgress['next_actions'] = [
      { kind: 'refresh_status', environment_id: 'local-environment', label: 'Refresh status' },
    ];

    expect(openConnectionFailurePrimaryAction(openConnectionProgress('failed', { nextActions }), openAction)).toEqual({
      intent: 'refresh_runtime',
      label: 'Refresh status',
      enabled: true,
      variant: 'default',
    });
  });

  it('promotes the Desktop update handoff when the Runtime requires a newer Desktop', () => {
    const nextActions: DesktopLauncherActionProgress['next_actions'] = [
      { kind: 'refresh_status', environment_id: 'local-environment', label: 'Refresh status' },
      { kind: 'manage_desktop_update', environment_id: 'local-environment', label: 'Update Redeven Desktop' },
    ];

    expect(openConnectionFailurePrimaryAction(openConnectionProgress('failed', {
      nextActions,
      failure: {
        code: 'desktop_update_required',
        severity: 'error',
        title: 'Desktop update required',
        summary: 'Update Redeven Desktop before opening this environment.',
      },
    }), openAction)).toEqual({
      intent: 'update_desktop',
      label: 'Update Redeven Desktop',
      enabled: true,
      variant: 'default',
    });
  });

  it('does not offer Open again after a failed Open operation', () => {
    expect(openConnectionFailurePrimaryAction(openConnectionProgress('failed'), openAction)).toBeNull();
    expect(openConnectionFailurePrimaryAction(openConnectionProgress('cleanup_failed'), openAction)).toBeNull();
    expect(openConnectionFailurePrimaryAction(
      openConnectionProgress('failed'),
      { ...openAction, enabled: false },
    )).toBeNull();
    expect(openConnectionFailurePrimaryAction(
      openConnectionProgress('failed'),
      { ...openAction, intent: 'restart_runtime', label: 'Restart runtime' },
    )).toBeNull();
    expect(openConnectionFailurePrimaryAction(openConnectionProgress('running'), openAction)).toBeNull();
    expect(openConnectionFailurePrimaryAction(lifecycleActionProgress({ status: 'failed' }), openAction)).toBeNull();
  });
});

describe('environmentProgressPanelPrimaryAction', () => {
  it('promotes runtime update inside the popup without changing failed card presentation', () => {
    const failedOpen = openConnectionProgress('failed', {
      nextActions: [
        { kind: 'refresh_status', environment_id: 'local-environment', label: 'Refresh status' },
        { kind: 'update_runtime', environment_id: 'local-environment', label: 'Update runtime' },
      ],
    });
    const focusAction: EnvironmentActionModel = {
      intent: 'focus',
      label: 'Focus',
      enabled: true,
      variant: 'default',
    };

    expect(environmentProgressPrimaryPresentation(failedOpen)).toMatchObject({
      kind: 'attention_trigger',
      label: 'Open failed',
    });
    expect(environmentProgressPanelPrimaryAction(failedOpen, openAction)).toEqual({
      action: expect.objectContaining({
        intent: 'update_runtime',
        continue_open_after_completion: true,
      }),
      label: 'Update runtime and open',
      icon: 'refresh',
      loading: false,
      disabled: false,
    });
    expect(environmentProgressPanelPrimaryAction(failedOpen, focusAction, { busy: true })).toEqual({
      action: expect.objectContaining({
        intent: 'update_runtime',
        continue_open_after_completion: true,
      }),
      label: 'Update runtime and open',
      icon: 'refresh',
      loading: true,
      disabled: true,
    });
  });

  it('offers status refresh for cleanup-failed Open receipts inside the popup', () => {
    const cleanupFailedOpen = openConnectionProgress('cleanup_failed', {
      nextActions: [
        { kind: 'refresh_status', environment_id: 'local-environment', label: 'Refresh status' },
      ],
    });

    expect(environmentProgressPrimaryPresentation(cleanupFailedOpen)).toMatchObject({
      kind: 'attention_trigger',
      label: 'Cleanup failed',
    });
    expect(environmentProgressPanelPrimaryAction(cleanupFailedOpen, openAction)).toEqual({
      action: expect.objectContaining({ intent: 'refresh_runtime' }),
      label: 'Refresh status',
      icon: 'refresh',
      loading: false,
      disabled: false,
    });
  });

  it('offers the current primary action for runtime-ready receipts only in the popup', () => {
    const readyProgress = lifecycleActionProgress({
      action: 'restart_environment_runtime',
      operation: 'restart',
      status: 'succeeded',
      phase: 'runtime_ready',
    });
    const stoppedProgress = lifecycleActionProgress({
      action: 'stop_environment_runtime',
      operation: 'stop',
      status: 'succeeded',
      phase: 'runtime_stopped',
    });

    expect(environmentProgressPrimaryPresentation(readyProgress)).toBeNull();
    expect(environmentProgressPanelPrimaryAction(readyProgress, openAction, { busy: true })).toEqual({
      action: openAction,
      label: 'Open',
      icon: 'external_link',
      loading: true,
      disabled: true,
    });
    expect(environmentProgressPrimaryPresentation(stoppedProgress)).toBeNull();
    expect(environmentProgressPanelPrimaryAction(stoppedProgress, openAction)).toBeNull();
  });
});

describe('environmentProgressPrimaryPresentation', () => {
  it('uses running lifecycle progress as the primary trigger', () => {
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'restart_environment_runtime', status: 'running' }),
    )).toMatchObject({
      kind: 'progress_trigger',
      label: 'Restarting...',
      icon: 'play',
    });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'stop_environment_runtime', operation: 'stop', status: 'running', phase: 'checking_existing_runtime' }),
    )).toMatchObject({
      kind: 'progress_trigger',
      label: 'Stopping...',
      icon: 'stop',
    });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'pair_gateway', operation: 'start', status: 'running', phase: 'starting_runtime_process' }),
    )).toMatchObject({
      kind: 'progress_trigger',
      label: 'Refreshing...',
      icon: 'play',
    });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'refresh_gateway_catalog', operation: 'start', status: 'running', phase: 'starting_runtime_process' }),
    )).toMatchObject({
      kind: 'progress_trigger',
      label: 'Refreshing...',
      icon: 'play',
    });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'start_gateway', operation: 'start', status: 'running', phase: 'starting_gateway_service' }),
    )).toMatchObject({
      kind: 'progress_trigger',
      label: 'Starting...',
      icon: 'play',
    });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'restart_gateway', operation: 'restart', status: 'running', phase: 'starting_gateway_service' }),
    )).toMatchObject({
      kind: 'progress_trigger',
      label: 'Restarting...',
      icon: 'play',
    });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'update_gateway', operation: 'update', status: 'running', phase: 'installing_gateway_package' }),
    )).toMatchObject({
      kind: 'progress_trigger',
      label: 'Updating...',
      icon: 'play',
    });
    expect(environmentProgressPrimaryPresentation({
      action: 'check_gateway',
      operation_key: 'gw-demo:check',
      subject_kind: 'gateway',
      subject_id: 'gw-demo',
      gateway_id: 'gw-demo',
      started_at_unix_ms: 400,
      status: 'running',
      phase: 'checking_gateway',
      title: 'Check Gateway',
      detail: 'Desktop is checking the Gateway.',
      step_progress: {
        active_step_id: 'checking_gateway',
        steps: [{ id: 'checking_gateway', label: 'Checking Gateway', status: 'running' }],
      },
    })).toMatchObject({
      kind: 'progress_trigger',
      label: 'Refreshing...',
      icon: 'play',
    });
  });

  it('releases the primary trigger for successful or canceled lifecycle progress', () => {
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'stop_environment_runtime', operation: 'stop', phase: 'runtime_stopped', status: 'succeeded' }),
    )).toBeNull();
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'restart_environment_runtime', status: 'succeeded' }),
    )).toBeNull();
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress({ action: 'restart_environment_runtime', status: 'succeeded' }),
      openAction,
    )).toBe(openAction);
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'stop_environment_runtime', operation: 'stop', phase: 'runtime_stopped', status: 'canceled' }),
    )).toBeNull();
  });

  it('uses explicit copy for cancellation and cleanup-running states', () => {
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'start_environment_runtime', operation: 'start', status: 'canceling', phase: 'starting_runtime_process' }),
    )).toMatchObject({
      kind: 'progress_trigger',
      label: 'Canceling...',
      ariaLabel: 'Canceling... Show progress.',
      icon: 'stop',
    });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'restart_environment_runtime', status: 'cleanup_running' }),
    )).toMatchObject({
      kind: 'progress_trigger',
      label: 'Cleaning up...',
      ariaLabel: 'Cleaning up... Show progress.',
      icon: 'stop',
    });
  });

  it('keeps failed lifecycle progress visible on the primary trigger', () => {
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'stop_environment_runtime', operation: 'stop', status: 'failed', phase: 'runtime_stopped' }),
    )).toMatchObject({
      kind: 'attention_trigger',
      label: 'Stop failed',
      ariaLabel: 'Stop failed. Show details.',
    });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'restart_environment_runtime', status: 'cleanup_failed' }),
    )).toMatchObject({
      kind: 'attention_trigger',
      label: 'Cleanup failed',
      ariaLabel: 'Cleanup failed. Show details.',
    });
  });

  it('maps lifecycle actions to stable failure labels', () => {
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'start_environment_runtime', operation: 'start', status: 'failed', phase: 'starting_runtime_process' }),
    )).toMatchObject({ label: 'Start failed' });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'restart_environment_runtime', status: 'failed' }),
    )).toMatchObject({ label: 'Restart failed' });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'update_environment_runtime', operation: 'update', status: 'failed', phase: 'runtime_up_to_date' }),
    )).toMatchObject({ label: 'Update failed' });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'pair_gateway', operation: 'start', status: 'failed', phase: 'starting_runtime_process' }),
    )).toMatchObject({ label: 'Refresh failed' });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'refresh_gateway_catalog', operation: 'start', status: 'failed', phase: 'starting_runtime_process' }),
    )).toMatchObject({ label: 'Refresh failed' });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'start_gateway', operation: 'start', status: 'failed', phase: 'starting_gateway_service' }),
    )).toMatchObject({ label: 'Start failed' });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'restart_gateway', operation: 'restart', status: 'failed', phase: 'starting_gateway_service' }),
    )).toMatchObject({ label: 'Restart failed' });
    expect(environmentProgressPrimaryPresentation(
      lifecycleActionProgress({ action: 'update_gateway', operation: 'update', status: 'failed', phase: 'installing_gateway_package' }),
    )).toMatchObject({ label: 'Update failed' });
    expect(environmentProgressPrimaryPresentation({
      action: 'check_gateway',
      operation_key: 'gw-demo:check',
      subject_kind: 'gateway',
      subject_id: 'gw-demo',
      gateway_id: 'gw-demo',
      started_at_unix_ms: 500,
      status: 'failed',
      phase: 'checking_gateway',
      title: 'Check failed',
      detail: 'Desktop could not check the Gateway.',
      step_progress: {
        active_step_id: 'checking_gateway',
        steps: [{ id: 'checking_gateway', label: 'Checking Gateway', status: 'failed' }],
      },
    })).toMatchObject({
      kind: 'attention_trigger',
      label: 'Refresh failed',
      ariaLabel: 'Refresh failed. Show details.',
    });
  });

  it('applies the same primary ownership rules to open connection progress', () => {
    expect(environmentProgressPrimaryPresentation(openConnectionProgress('running'))).toMatchObject({
      kind: 'progress_trigger',
      label: 'Opening...',
      icon: 'play',
      ariaLabel: 'Opening... Show progress.',
    });
    expect(environmentProgressPrimaryPresentation(openConnectionProgress('failed'))).toMatchObject({
      kind: 'attention_trigger',
      label: 'Open failed',
      ariaLabel: 'Open failed. Show details.',
    });
    expect(environmentProgressPrimaryPresentation(openConnectionProgress('cleanup_failed'))).toMatchObject({
      kind: 'attention_trigger',
      label: 'Cleanup failed',
      ariaLabel: 'Cleanup failed. Show details.',
    });
    expect(environmentProgressPrimaryPresentation(openConnectionProgress('canceling'))).toMatchObject({
      kind: 'progress_trigger',
      label: 'Canceling...',
      icon: 'stop',
    });
    expect(environmentProgressPrimaryPresentation(openConnectionProgress('cleanup_running'))).toMatchObject({
      kind: 'progress_trigger',
      label: 'Cleaning up...',
      icon: 'stop',
    });
    expect(environmentProgressPrimaryPresentation(openConnectionProgress('succeeded'))).toBeNull();
    expect(environmentProgressPrimaryPresentation(openConnectionProgress('canceled'))).toBeNull();
  });

  it('returns null for missing progress and a generic label for unknown failures', () => {
    expect(environmentProgressPrimaryPresentation(null)).toBeNull();
    expect(environmentProgressPrimaryPresentation(undefined)).toBeNull();
    expect(environmentProgressPrimaryPresentation({
      action: 'refresh_control_plane',
      operation_key: 'control-plane-refresh',
      started_at_unix_ms: 300,
      status: 'failed',
      phase: 'failed',
      title: 'Refresh failed',
      detail: 'Desktop could not refresh the provider.',
    })).toMatchObject({
      kind: 'attention_trigger',
      label: 'Needs attention',
      ariaLabel: 'Needs attention. Show details.',
    });
  });
});

describe('selectEnvironmentPanelProgress', () => {
  it('presents operation confirmation as terminal attention instead of active work', () => {
    const progress = lifecycleActionProgress({
      action: 'restart_environment_runtime',
      status: 'needs_confirmation',
      startedAt: 200,
      updatedAt: 210,
    });
    expect(environmentProgressPrimaryPresentation(progress)).toMatchObject({
      kind: 'attention_trigger',
      label: 'Review required',
    });
  });

  it('uses an active runtime operation instead of a stale Open failure', () => {
    const staleOpenFailure = openConnectionProgress('failed', { startedAt: 100, updatedAt: 110 });
    const runtimeRunning = lifecycleActionProgress({
      action: 'restart_environment_runtime',
      status: 'running',
      startedAt: 200,
      updatedAt: 210,
    });

    expect(selectEnvironmentPanelProgress(staleOpenFailure, runtimeRunning)).toBe(runtimeRunning);
  });

  it('uses a newer Gateway Runtime confirmation instead of the Open failure that requested it', () => {
    const openFailure = openConnectionProgress('failed', { startedAt: 100, updatedAt: 110 });
    const runtimeConfirmation: DesktopLauncherActionProgress = {
      action: 'run_gateway_environment_lifecycle',
      environment_id: 'local-environment',
      environment_label: 'Local Environment',
      operation_key: 'local-environment:update_runtime',
      subject_kind: 'gateway',
      subject_id: 'gateway-local',
      started_at_unix_ms: 200,
      updated_at_unix_ms: 210,
      status: 'needs_confirmation',
      phase: 'runtime_operation_confirmation_required',
      title: 'Review Runtime impact',
      detail: 'Confirm the Runtime update.',
      runtime_confirmation: {
        operation: 'update_runtime',
        snapshot_revision: 1,
        workload_knowledge: 'unknown',
        protected_workload_present: false,
      },
    };

    expect(selectEnvironmentPanelProgress(openFailure, runtimeConfirmation)).toBe(runtimeConfirmation);
  });

  it('uses an active Open operation instead of a stale runtime failure', () => {
    const openRunning = openConnectionProgress('running', { startedAt: 300, updatedAt: 310 });
    const staleRuntimeFailure = lifecycleActionProgress({
      action: 'stop_environment_runtime',
      operation: 'stop',
      status: 'failed',
      startedAt: 100,
      updatedAt: 120,
    });

    expect(selectEnvironmentPanelProgress(openRunning, staleRuntimeFailure)).toBe(openRunning);
  });

  it('uses the newest operation instead of letting stale active progress mask a newer failure', () => {
    const staleOpenRunning = openConnectionProgress('running', { startedAt: 100, updatedAt: 500 });
    const newerRuntimeFailure = lifecycleActionProgress({
      action: 'stop_environment_runtime',
      operation: 'stop',
      status: 'failed',
      startedAt: 200,
      updatedAt: 220,
    });
    const staleRuntimeRunning = lifecycleActionProgress({
      action: 'restart_environment_runtime',
      status: 'running',
      startedAt: 100,
      updatedAt: 500,
    });
    const newerOpenFailure = openConnectionProgress('failed', { startedAt: 200, updatedAt: 220 });

    expect(selectEnvironmentPanelProgress(staleOpenRunning, newerRuntimeFailure)).toBe(newerRuntimeFailure);
    expect(selectEnvironmentPanelProgress(newerOpenFailure, staleRuntimeRunning)).toBe(newerOpenFailure);
  });

  it('uses the latest progress within the same priority and Open as the final tie breaker', () => {
    const openFailure = openConnectionProgress('failed', { startedAt: 100, updatedAt: 150 });
    const newerRuntimeFailure = lifecycleActionProgress({
      action: 'restart_environment_runtime',
      status: 'failed',
      startedAt: 100,
      updatedAt: 200,
    });

    expect(selectEnvironmentPanelProgress(openFailure, newerRuntimeFailure)).toBe(newerRuntimeFailure);
    expect(selectEnvironmentPanelProgress(
      openConnectionProgress('succeeded', { startedAt: 500, updatedAt: 600 }),
      lifecycleActionProgress({ status: 'succeeded', startedAt: 500, updatedAt: 600 }),
    )?.open_progress).toBeDefined();
  });
});

function openConnectionPhaseForStatus(status: DesktopLauncherActionProgress['status']): DesktopOpenConnectionPhase {
  switch (status) {
    case 'succeeded':
      return 'open_ready';
    default:
      return 'checking_runtime_record';
  }
}
