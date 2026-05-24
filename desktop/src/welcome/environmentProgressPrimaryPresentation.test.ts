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
  environmentProgressPrimaryPresentation,
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
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    case 'succeeded':
      return 'open_ready';
    default:
      return 'checking_runtime_record';
  }
}
