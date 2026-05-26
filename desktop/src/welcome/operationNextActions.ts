import type {
  DesktopLauncherActionProgress,
  DesktopLauncherOperationNextAction,
} from '../shared/desktopLauncherIPC';

function operationNextActionKey(action: DesktopLauncherOperationNextAction): string {
  switch (action.kind) {
    case 'refresh_status':
    case 'update_runtime':
      return `${action.kind}:${action.environment_id ?? ''}:${action.label}`;
    case 'copy_diagnostics':
    case 'dismiss':
    case 'retry':
      return `${action.kind}:${action.operation_key}:${action.label}`;
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
  push('refresh_status');
  push('update_runtime');
  push('copy_diagnostics');
  push('dismiss');
  return actions;
}
