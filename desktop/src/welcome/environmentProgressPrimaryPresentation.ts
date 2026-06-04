import type { DesktopLauncherActionKind, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import type { DesktopRuntimeLifecycleOperation } from '../shared/desktopRuntimeLifecycleProgress';
import type { EnvironmentActionModel } from './viewModel';

export type EnvironmentProgressPrimaryPresentation = Readonly<
  | {
      kind: 'progress_trigger';
      progress: DesktopLauncherActionProgress;
      label: string;
      ariaLabel: string;
      icon: 'play' | 'stop';
    }
  | {
      kind: 'attention_trigger';
      progress: DesktopLauncherActionProgress;
      label: string;
      ariaLabel: string;
    }
>;

export type EnvironmentProgressPanelPrimaryActionPresentation = Readonly<{
  action: EnvironmentActionModel;
  label: string;
  icon: 'external_link';
  loading: boolean;
  disabled: boolean;
}>;

const RUNTIME_READY_ACTIONS: readonly DesktopLauncherActionKind[] = [
  'start_environment_runtime',
  'restart_environment_runtime',
  'update_environment_runtime',
];

const RUNTIME_READY_OPERATIONS: readonly DesktopRuntimeLifecycleOperation[] = [
  'start',
  'restart',
  'update',
];

export function runtimeLifecycleReadyPrimaryAction(
  progress: DesktopLauncherActionProgress,
  primaryAction: EnvironmentActionModel | undefined,
): EnvironmentActionModel | null {
  const lifecycle = progress.lifecycle_progress;
  if (
    progress.status !== 'succeeded'
    || lifecycle?.phase !== 'runtime_ready'
    || !RUNTIME_READY_ACTIONS.includes(progress.action)
    || !RUNTIME_READY_OPERATIONS.includes(lifecycle.operation)
    || !primaryAction?.enabled
    || (primaryAction.intent !== 'open' && primaryAction.intent !== 'focus')
  ) {
    return null;
  }
  return primaryAction;
}

export function openConnectionFailurePrimaryAction(
  progress: DesktopLauncherActionProgress,
  primaryAction: EnvironmentActionModel | undefined,
): EnvironmentActionModel | null {
  if (
    !progress.open_progress
    || (progress.status !== 'failed' && progress.status !== 'cleanup_failed')
    || !primaryAction?.enabled
    || (primaryAction.intent !== 'open' && primaryAction.intent !== 'focus')
  ) {
    return null;
  }
  return primaryAction;
}

export function environmentProgressPanelPrimaryAction(
  progress: DesktopLauncherActionProgress,
  primaryAction: EnvironmentActionModel | undefined,
  input: Readonly<{ busy?: boolean }> = {},
): EnvironmentProgressPanelPrimaryActionPresentation | null {
  const action = runtimeLifecycleReadyPrimaryAction(progress, primaryAction)
    ?? openConnectionFailurePrimaryAction(progress, primaryAction);
  if (!action) {
    return null;
  }
  const busy = input.busy === true;
  return {
    action,
    label: action.intent === 'focus' ? 'Focus' : action.label,
    icon: 'external_link',
    loading: busy,
    disabled: busy,
  };
}

export function environmentProgressPrimaryPresentation(
  progress: DesktopLauncherActionProgress | null | undefined,
): EnvironmentProgressPrimaryPresentation | null {
  if (!progress) {
    return null;
  }
  switch (progress.status) {
    case 'running':
    case 'canceling':
    case 'cleanup_running': {
      const label = runningProgressPrimaryLabel(progress);
      return {
        kind: 'progress_trigger',
        progress,
        label,
        ariaLabel: `${sentenceForLabel(label)} Show progress.`,
        icon: runningProgressPrimaryIcon(progress),
      };
    }
    case 'failed':
    case 'cleanup_failed': {
      const label = failedProgressPrimaryLabel(progress);
      return {
        kind: 'attention_trigger',
        progress,
        label,
        ariaLabel: `${sentenceForLabel(label)} Show details.`,
      };
    }
    default:
      return null;
  }
}

export function selectEnvironmentPanelProgress(
  openConnectionProgress: DesktopLauncherActionProgress | null | undefined,
  runtimeLifecycleProgress: DesktopLauncherActionProgress | null | undefined,
): DesktopLauncherActionProgress | null {
  const openRank = rankedProgressCandidate(openConnectionProgress, 1);
  const runtimeRank = rankedProgressCandidate(runtimeLifecycleProgress, 0);
  if (!openRank) {
    return runtimeRank?.progress ?? null;
  }
  if (!runtimeRank) {
    return openRank.progress;
  }
  if (openRank.startedAt !== runtimeRank.startedAt) {
    return openRank.startedAt > runtimeRank.startedAt ? openRank.progress : runtimeRank.progress;
  }
  if (openRank.timestamp !== runtimeRank.timestamp) {
    return openRank.timestamp > runtimeRank.timestamp ? openRank.progress : runtimeRank.progress;
  }
  if (openRank.priority !== runtimeRank.priority) {
    return openRank.priority > runtimeRank.priority ? openRank.progress : runtimeRank.progress;
  }
  return openRank.tieBreak > runtimeRank.tieBreak ? openRank.progress : runtimeRank.progress;
}

function runningProgressPrimaryLabel(progress: DesktopLauncherActionProgress): string {
  if (progress.status === 'canceling') {
    return 'Canceling...';
  }
  if (progress.status === 'cleanup_running') {
    return 'Cleaning up...';
  }
  if (progress.open_progress) {
    return 'Opening...';
  }
  if (
    progress.subject_kind === 'gateway'
    && (
      progress.step_progress?.active_step_id === 'refreshing_gateway_catalog'
      || progress.title === 'Sync Gateway'
    )
  ) {
    return 'Syncing...';
  }
  switch (progress.action) {
    case 'check_gateway':
      return 'Checking...';
    case 'stop_environment_runtime':
    case 'stop_gateway':
      return 'Stopping...';
    case 'restart_environment_runtime':
    case 'restart_gateway':
      return 'Restarting...';
    case 'update_environment_runtime':
    case 'update_gateway':
      return 'Updating...';
    case 'sync_gateway':
    case 'pair_gateway':
    case 'refresh_gateway_catalog':
    case 'refresh_gateway_status':
      return 'Syncing...';
    default:
      return 'Starting...';
  }
}

function runningProgressPrimaryIcon(progress: DesktopLauncherActionProgress): 'play' | 'stop' {
  if (progress.status === 'canceling' || progress.status === 'cleanup_running') {
    return 'stop';
  }
  return progress.action === 'stop_environment_runtime' || progress.action === 'stop_gateway'
    ? 'stop'
    : 'play';
}

function sentenceForLabel(label: string): string {
  return label.endsWith('.') || label.endsWith('...') ? label : `${label}.`;
}

function rankedProgressCandidate(
  progress: DesktopLauncherActionProgress | null | undefined,
  tieBreak: number,
): Readonly<{
  progress: DesktopLauncherActionProgress;
  priority: number;
  startedAt: number;
  timestamp: number;
  tieBreak: number;
}> | null {
  if (!progress) {
    return null;
  }
  return {
    progress,
    priority: progressSelectionPriority(progress),
    startedAt: progress.started_at_unix_ms ?? 0,
    timestamp: progress.updated_at_unix_ms ?? progress.started_at_unix_ms ?? 0,
    tieBreak,
  };
}

function progressSelectionPriority(progress: DesktopLauncherActionProgress): number {
  switch (progress.status) {
    case 'running':
    case 'canceling':
    case 'cleanup_running':
      return 3;
    case 'failed':
    case 'cleanup_failed':
      return 2;
    case 'succeeded':
    case 'canceled':
      return 1;
    default:
      return 0;
  }
}

function failedProgressPrimaryLabel(progress: DesktopLauncherActionProgress): string {
  if (progress.status === 'cleanup_failed') {
    return 'Cleanup failed';
  }
  if (progress.open_progress) {
    return 'Open failed';
  }
  switch (progress.action) {
    case 'check_gateway':
      return 'Check failed';
    case 'start_environment_runtime':
    case 'start_gateway':
      return 'Start failed';
    case 'restart_environment_runtime':
    case 'restart_gateway':
      return 'Restart failed';
    case 'update_environment_runtime':
    case 'update_gateway':
      return 'Update failed';
    case 'stop_environment_runtime':
    case 'stop_gateway':
      return 'Stop failed';
    case 'sync_gateway':
    case 'pair_gateway':
    case 'refresh_gateway_catalog':
    case 'refresh_gateway_status':
      return 'Sync failed';
    default:
      return 'Needs attention';
  }
}
