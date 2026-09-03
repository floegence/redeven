import type { DesktopLauncherActionKind, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import type { DesktopRuntimeLifecycleOperation } from '../shared/desktopRuntimeLifecycleProgress';
import type { DesktopTranslationKey } from '../shared/i18n';
import type { EnvironmentActionModel } from './viewModel';

export type EnvironmentProgressPrimaryPresentation = Readonly<
  | {
      kind: 'progress_trigger';
      progress: DesktopLauncherActionProgress;
      label: string;
      label_key: DesktopTranslationKey;
      ariaLabel: string;
      icon: 'play' | 'stop';
    }
  | {
      kind: 'attention_trigger';
      progress: DesktopLauncherActionProgress;
      label: string;
      label_key: DesktopTranslationKey;
      ariaLabel: string;
    }
>;

export type EnvironmentProgressPanelPrimaryActionPresentation = Readonly<{
  action: EnvironmentActionModel;
  label: string;
  icon: 'alert_triangle' | 'external_link' | 'refresh';
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
    progress.active_progress_surface !== 'runtime_lifecycle'
    || progress.status !== 'succeeded'
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
    progress.active_progress_surface !== 'open'
    || !progress.open_progress
    || (progress.status !== 'failed' && progress.status !== 'cleanup_failed')
    || !primaryAction
  ) {
    return null;
  }
  const desktopUpdateAction = progress.next_actions?.find((action) => action.kind === 'manage_desktop_update');
  if (progress.failure?.code === 'desktop_update_required' && desktopUpdateAction) {
    return {
      intent: 'update_desktop',
      label: 'Update Redeven Desktop',
      enabled: true,
      variant: 'default',
    };
  }
  const updateAction = progress.next_actions?.find((action) => action.kind === 'update_runtime');
  if (updateAction) {
    return {
      intent: 'update_runtime',
      label: 'Update runtime and open',
      enabled: true,
      variant: 'default',
      continue_open_after_completion: true,
    };
  }
  const refreshAction = progress.next_actions?.find((action) => action.kind === 'refresh_status');
  if (refreshAction) {
    return {
      intent: 'refresh_runtime',
      label: 'Refresh status',
      enabled: true,
      variant: 'default',
    };
  }
  return null;
}

export function environmentProgressPanelPrimaryAction(
  progress: DesktopLauncherActionProgress,
  primaryAction: EnvironmentActionModel | undefined,
  input: Readonly<{ busy?: boolean }> = {},
): EnvironmentProgressPanelPrimaryActionPresentation | null {
  const reinstallRequest = progress.next_actions?.find(
    (candidate) => candidate.kind === 'retry'
      && candidate.retry_action?.kind === 'preview_reinstall_target',
  );
  const reinstallAction =
    (progress.status === 'failed' || progress.status === 'cleanup_failed')
    && progress.failure?.code === 'reinstall_required'
    && reinstallRequest?.kind === 'retry'
    && reinstallRequest.retry_action?.kind === 'preview_reinstall_target'
      ? {
          intent: 'reinstall_target' as const,
          label: 'Reinstall Redeven',
          enabled: true,
          variant: 'default' as const,
          reinstall_mode: reinstallRequest.retry_action.mode ?? 'wipe_data',
        }
      : null;
  const action = reinstallAction
    ?? runtimeLifecycleReadyPrimaryAction(progress, primaryAction)
    ?? openConnectionFailurePrimaryAction(progress, primaryAction);
  if (!action) {
    return null;
  }
  const busy = input.busy === true;
  return {
    action,
    label: action.intent === 'focus' ? 'Focus' : action.label,
    icon: action.intent === 'reinstall_target'
      ? 'alert_triangle'
      : action.intent === 'update_runtime' || action.intent === 'refresh_runtime'
        ? 'refresh'
        : 'external_link',
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
      const { label, label_key } = runningProgressPrimaryLabel(progress);
      return {
        kind: 'progress_trigger',
        progress,
        label,
        label_key,
        ariaLabel: `${sentenceForLabel(label)} Show progress.`,
        icon: runningProgressPrimaryIcon(progress),
      };
    }
    case 'failed':
    case 'cleanup_failed': {
      const { label, label_key } = failedProgressPrimaryLabel(progress);
      return {
        kind: 'attention_trigger',
        progress,
        label,
        label_key,
        ariaLabel: `${sentenceForLabel(label)} Show details.`,
      };
    }
    case 'needs_confirmation':
      return {
        kind: 'attention_trigger',
        progress,
        label: 'Review required',
        label_key: 'progress.needsAttention',
        ariaLabel: 'Review required. Show details.',
      };
    default:
      return null;
  }
}

export function selectEnvironmentPanelProgress(
  openConnectionProgress: DesktopLauncherActionProgress | null | undefined,
  runtimeLifecycleProgress: DesktopLauncherActionProgress | null | undefined,
): DesktopLauncherActionProgress | null {
  if (runtimeLifecycleProgress?.active_progress_surface === 'runtime_lifecycle') {
    return runtimeLifecycleProgress;
  }
  if (openConnectionProgress?.active_progress_surface === 'open') {
    return openConnectionProgress;
  }
  return null;
}

type ProgressPrimaryLabel = Readonly<{ label: string; label_key: DesktopTranslationKey }>;

function runningProgressPrimaryLabel(progress: DesktopLauncherActionProgress): ProgressPrimaryLabel {
  if (progress.status === 'canceling') {
    return { label: 'Canceling...', label_key: 'progress.canceling' };
  }
  if (progress.status === 'cleanup_running') {
    return { label: 'Cleaning up...', label_key: 'progress.cleaningUp' };
  }
  if (progress.active_progress_surface === 'open' && progress.open_progress) {
    return { label: 'Opening...', label_key: 'progress.opening' };
  }
  if (
    progress.subject_kind === 'gateway'
    && (
      progress.step_progress?.active_step_id === 'refreshing_gateway_catalog'
      || progress.title === 'Refresh Gateway'
      || progress.action === 'refresh_gateway'
    )
  ) {
    return { label: 'Refreshing...', label_key: 'environmentCenter.gatewayActionSyncing' };
  }
  switch (progress.action) {
    case 'refresh_gateway':
    case 'check_gateway':
      return { label: 'Refreshing...', label_key: 'environmentCenter.gatewayActionSyncing' };
    case 'stop_environment_runtime':
      return { label: 'Stopping...', label_key: 'progress.stoppingEllipsis' };
    case 'restart_environment_runtime':
      return { label: 'Restarting...', label_key: 'progress.restartingEllipsis' };
    case 'update_environment_runtime':
      return { label: 'Updating...', label_key: 'progress.updatingEllipsis' };
    case 'refresh_environment_runtime':
      return { label: 'Refreshing...', label_key: 'environmentCenter.gatewayActionSyncing' };
    case 'reinstall_target':
      return { label: 'Reinstalling...', label_key: 'progress.reinstalling' };
    case 'sync_gateway':
    case 'pair_gateway':
    case 'refresh_gateway_catalog':
    case 'refresh_gateway_status':
      return { label: 'Refreshing...', label_key: 'environmentCenter.gatewayActionSyncing' };
    default:
      return { label: 'Starting...', label_key: 'progress.startingEllipsis' };
  }
}

function runningProgressPrimaryIcon(progress: DesktopLauncherActionProgress): 'play' | 'stop' {
  if (progress.status === 'canceling' || progress.status === 'cleanup_running') {
    return 'stop';
  }
  return progress.action === 'stop_environment_runtime'
    ? 'stop'
    : 'play';
}

function sentenceForLabel(label: string): string {
  return label.endsWith('.') || label.endsWith('...') ? label : `${label}.`;
}


function failedProgressPrimaryLabel(progress: DesktopLauncherActionProgress): ProgressPrimaryLabel {
  if (progress.status === 'cleanup_failed') {
    return { label: 'Cleanup failed', label_key: 'progress.cleanupFailed' };
  }
  if (progress.active_progress_surface === 'open' && progress.open_progress) {
    return { label: 'Open failed', label_key: 'progress.openFailed' };
  }
  switch (progress.action) {
    case 'refresh_gateway':
    case 'check_gateway':
      return { label: 'Refresh failed', label_key: 'progress.checkFailed' };
    case 'start_environment_runtime':
      return { label: 'Start failed', label_key: 'progress.startFailed' };
    case 'restart_environment_runtime':
      return { label: 'Restart failed', label_key: 'progress.restartFailed' };
    case 'update_environment_runtime':
      return { label: 'Update failed', label_key: 'progress.updateFailed' };
    case 'stop_environment_runtime':
      return { label: 'Stop failed', label_key: 'progress.stopFailed' };
    case 'refresh_environment_runtime':
      return { label: 'Refresh failed', label_key: 'progress.checkFailed' };
    case 'sync_gateway':
    case 'pair_gateway':
    case 'refresh_gateway_catalog':
    case 'refresh_gateway_status':
      return { label: 'Refresh failed', label_key: 'progress.checkFailed' };
    default:
      return { label: 'Needs attention', label_key: 'progress.needsAttention' };
  }
}
