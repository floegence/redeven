import type {
  DesktopLauncherActionProgress,
  DesktopLauncherOperationNextAction,
} from '../shared/desktopLauncherIPC';

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
    case 'confirm_runtime_operation':
    case 'cancel_runtime_operation':
    case 'dismiss':
    case 'retry':
      return `${action.kind}:operation:${action.operation_key}`;
    default:
      return `${action.kind}:operation`;
  }
}

export function operationNextActionsByKind(
  progress: DesktopLauncherActionProgress,
): Map<DesktopLauncherOperationNextAction['kind'], DesktopLauncherOperationNextAction> {
  const actions = new Map<DesktopLauncherOperationNextAction['kind'], DesktopLauncherOperationNextAction>();
  for (const action of progress.next_actions ?? []) {
    if (!actions.has(action.kind)) {
      actions.set(action.kind, action);
    }
  }
  return actions;
}

export function visibleOperationNextActions(
  progress: DesktopLauncherActionProgress,
): readonly DesktopLauncherOperationNextAction[] {
  const actions: DesktopLauncherOperationNextAction[] = [];
  const byKind = operationNextActionsByKind(progress);
  const push = (kind: DesktopLauncherOperationNextAction['kind']) => {
    const action = byKind.get(kind);
    if (action && actions.every((item) => operationNextActionKey(item) !== operationNextActionKey(action))) {
      actions.push(action);
    }
  };
  if (progress.action === 'reinstall_target') {
    push('reinstall_target');
  } else if (progress.subject_kind !== 'gateway') {
    push('update_runtime');
    push('manage_desktop_update');
    push('retry');
    push('refresh_status');
  }
  push('confirm_runtime_operation');
  push('cancel_runtime_operation');
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
    || action.kind === 'confirm_runtime_operation'
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
