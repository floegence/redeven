import type {
  DesktopLauncherActionProgress,
  DesktopLauncherOperationNextAction,
} from '../shared/desktopLauncherIPC';

function operationNextActionKey(action: DesktopLauncherOperationNextAction): string {
  switch (action.kind) {
    case 'refresh_status':
    case 'update_runtime':
    case 'manage_desktop_update':
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
  if (progress.subject_kind !== 'gateway') {
    push('manage_desktop_update');
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
    || action.kind === 'update_runtime'
    || action.kind === 'manage_desktop_update';
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
