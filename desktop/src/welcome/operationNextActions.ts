import type {
  DesktopLauncherActionRequest,
  DesktopLauncherActionProgress,
  DesktopLauncherOperationNextAction,
} from '../shared/desktopLauncherIPC';
import type { EnvironmentActionModel } from './viewModel';

export function environmentActionForLauncherRetry(
  request: DesktopLauncherActionRequest | undefined,
): EnvironmentActionModel | null {
  if (!request) {
    return null;
  }
  switch (request.kind) {
    case 'open_local_environment':
    case 'open_ssh_environment':
      return { intent: 'open_with_preflight', label: 'Open', enabled: true, variant: 'default' };
    case 'start_environment_runtime':
      return { intent: 'start_runtime', label: 'Start', enabled: true, variant: 'default' };
    case 'stop_environment_runtime':
      return { intent: 'stop_runtime', label: 'Stop', enabled: true, variant: 'default' };
    case 'restart_environment_runtime':
      return { intent: 'restart_runtime', label: 'Restart', enabled: true, variant: 'default' };
    case 'update_environment_runtime':
      return { intent: 'update_runtime', label: 'Update', enabled: true, variant: 'default' };
    case 'preview_reinstall_target':
      return {
        intent: 'reinstall_target',
        label: 'Review reinstall target',
        enabled: true,
        variant: 'default',
        reinstall_mode: request.mode ?? 'wipe_data',
      };
    default:
      return null;
  }
}

function operationNextActionKey(action: DesktopLauncherOperationNextAction): string {
  switch (action.kind) {
    case 'refresh_status':
    case 'update_runtime':
    case 'manage_desktop_update':
      return `${action.kind}:environment:${action.environment_id ?? ''}`;
    case 'refresh_gateway':
    case 'check_gateway':
    case 'refresh_gateway_status':
    case 'refresh_gateway_catalog':
      return `${action.kind}:gateway:${action.gateway_id}`;
    case 'reinstall_target':
      return `${action.kind}:environment:${action.environment_id}`;
    case 'resolve_gateway':
      return `${action.kind}:gateway:${action.gateway_id}:${action.resolve_focus ?? ''}`;
    case 'open_gateway_environment':
      return `${action.kind}:gateway:${action.gateway_id}:environment:${action.environment_id}:${action.start_policy ?? ''}`;
    case 'copy_diagnostics':
    case 'dismiss':
    case 'retry':
      return `${action.kind}:operation:${action.operation_key}`;
    default:
      return `${action.kind}:operation`;
  }
}

function operationCanDismiss(progress: DesktopLauncherActionProgress): boolean {
  return progress.status === 'failed'
    || progress.status === 'cleanup_failed'
    || progress.status === 'canceled'
    || progress.status === 'needs_confirmation';
}

export function visibleOperationNextActions(
  progress: DesktopLauncherActionProgress,
): readonly DesktopLauncherOperationNextAction[] {
  const actions: DesktopLauncherOperationNextAction[] = [];
  const normalizedActions: DesktopLauncherOperationNextAction[] = [...(progress.next_actions ?? [])];
  const operationKey = progress.operation_key?.trim() ?? '';
  if (
    operationKey !== ''
    && progress.failure !== undefined
    && !normalizedActions.some((action) => action.kind === 'copy_diagnostics')
  ) {
    normalizedActions.push({
      kind: 'copy_diagnostics',
      operation_key: operationKey,
      label: 'Copy log',
      label_key: 'progress.copyLog',
    });
  }
  if (
    operationKey !== ''
    && progress.subject_kind !== 'gateway'
    && operationCanDismiss(progress)
    && !normalizedActions.some((action) => action.kind === 'dismiss')
  ) {
    normalizedActions.push({
      kind: 'dismiss',
      operation_key: operationKey,
      label: 'Dismiss',
      label_key: 'progress.dismiss',
    });
  }
  const byKind = new Map<DesktopLauncherOperationNextAction['kind'], DesktopLauncherOperationNextAction>();
  for (const action of normalizedActions) {
    if (action.kind === 'retry' && !environmentActionForLauncherRetry(action.retry_action)) {
      continue;
    }
    if (action.kind === 'reinstall_target' && (!action.operation_key || !action.preflight_id)) {
      continue;
    }
    if (!byKind.has(action.kind)) {
      byKind.set(action.kind, action);
    }
  }
  const push = (kind: DesktopLauncherOperationNextAction['kind']) => {
    const action = byKind.get(kind);
    if (action && actions.every((item) => operationNextActionKey(item) !== operationNextActionKey(action))) {
      actions.push(action);
    }
  };
  if (progress.action === 'reinstall_target') {
    push('reinstall_target');
    // A recovered journal may need a new target review instead of the
    // original reinstall action. Keep that retry visible for the same
    // operation so a failed confirmation never becomes a dead end.
    push('retry');
  } else if (progress.subject_kind !== 'gateway') {
    push('update_runtime');
    push('manage_desktop_update');
    push('retry');
    push('refresh_status');
  }
  push('copy_diagnostics');
  push('dismiss');
  return actions;
}

export type OperationNextActionLayoutGroup = Readonly<{
  kind: 'primary' | 'secondary';
  actions: readonly DesktopLauncherOperationNextAction[];
}>;

function operationNextActionIsPrimary(action: DesktopLauncherOperationNextAction): boolean {
  return action.kind === 'refresh_status'
    || action.kind === 'retry'
    || action.kind === 'update_runtime'
    || action.kind === 'manage_desktop_update'
    || action.kind === 'refresh_gateway'
    || action.kind === 'reinstall_target';
}

export function groupedVisibleOperationNextActions(
  progress: DesktopLauncherActionProgress,
): readonly OperationNextActionLayoutGroup[] {
  const primary: DesktopLauncherOperationNextAction[] = [];
  const secondary: DesktopLauncherOperationNextAction[] = [];

  for (const action of visibleOperationNextActions(progress)) {
    if (operationNextActionIsPrimary(action)) {
      primary.push(action);
    } else {
      secondary.push(action);
    }
  }

  return [
    ...(primary.length > 0 ? [{ kind: 'primary' as const, actions: primary }] : []),
    ...(secondary.length > 0 ? [{ kind: 'secondary' as const, actions: secondary }] : []),
  ];
}
