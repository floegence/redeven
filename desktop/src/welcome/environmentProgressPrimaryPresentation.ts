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
  if (openRank.priority !== runtimeRank.priority) {
    return openRank.priority > runtimeRank.priority ? openRank.progress : runtimeRank.progress;
  }
  if (openRank.timestamp !== runtimeRank.timestamp) {
    return openRank.timestamp > runtimeRank.timestamp ? openRank.progress : runtimeRank.progress;
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
  switch (progress.action) {
    case 'stop_environment_runtime':
      return 'Stopping...';
    case 'restart_environment_runtime':
      return 'Restarting...';
    case 'update_environment_runtime':
      return 'Updating...';
    default:
      return 'Starting...';
  }
}

function runningProgressPrimaryIcon(progress: DesktopLauncherActionProgress): 'play' | 'stop' {
  if (progress.status === 'canceling' || progress.status === 'cleanup_running') {
    return 'stop';
  }
  return progress.action === 'stop_environment_runtime' ? 'stop' : 'play';
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
  timestamp: number;
  tieBreak: number;
}> | null {
  if (!progress) {
    return null;
  }
  return {
    progress,
    priority: progressSelectionPriority(progress),
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
    case 'start_environment_runtime':
      return 'Start failed';
    case 'restart_environment_runtime':
      return 'Restart failed';
    case 'update_environment_runtime':
      return 'Update failed';
    case 'stop_environment_runtime':
      return 'Stop failed';
    default:
      return 'Needs attention';
  }
}
