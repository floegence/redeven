import type { DesktopConfirmationDialogModel } from '../shared/desktopConfirmationContract';

export type DesktopQuitSource = 'explicit' | 'system' | 'last_window_close';

export type DesktopQuitImpactInput = Readonly<{
  environment_window_count: number;
  pending_operation_count?: number;
  running_runtime_count?: number;
}>;

export type DesktopQuitImpact = Readonly<{
  environment_window_count: number;
  pending_operation_count: number;
  running_runtime_count: number;
}>;

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 0) {
    return '';
  }
  if (parts.length === 1) {
    return parts[0] ?? '';
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export function buildDesktopQuitImpact(input: DesktopQuitImpactInput): DesktopQuitImpact {
  return {
    environment_window_count: Math.max(0, Math.trunc(input.environment_window_count)),
    pending_operation_count: Math.max(0, Math.trunc(input.pending_operation_count ?? 0)),
    running_runtime_count: Math.max(0, Math.trunc(input.running_runtime_count ?? 0)),
  };
}

export function shouldConfirmDesktopQuit(
  impact: DesktopQuitImpact,
  source: DesktopQuitSource,
): boolean {
  if (impact.pending_operation_count > 0) {
    return true;
  }
  if (source === 'last_window_close') {
    return false;
  }
  return impact.environment_window_count > 0;
}

export function shouldConfirmDesktopLastWindowClose(
  impact: DesktopQuitImpact,
): boolean {
  return impact.pending_operation_count > 0 || impact.environment_window_count > 0;
}

export function buildDesktopQuitConfirmationModel(impact: DesktopQuitImpact): DesktopConfirmationDialogModel {
  const sessionCount = impact.environment_window_count;
  const operationCount = impact.pending_operation_count;
  const runtimeCount = impact.running_runtime_count;
  const summary: string[] = [];

  if (sessionCount > 0) {
    summary.push(
      `close ${sessionCount} environment ${pluralize(sessionCount, 'window')}`,
    );
  }
  if (operationCount > 0) {
    summary.push(
      `cancel ${operationCount} background ${pluralize(operationCount, 'task')}`,
    );
  }

  const message = summary.length > 0
    ? `This will ${joinWithAnd(summary)}.`
    : 'Redeven Desktop will quit.';
  const detail = runtimeCount > 0
    ? `${runtimeCount} runtime ${pluralize(runtimeCount, 'process', 'processes')} will keep running.`
    : '';

  return {
    title: 'Quit Redeven Desktop?',
    message,
    detail,
    confirm_label: 'Quit',
    cancel_label: 'Cancel',
    confirm_tone: 'danger',
  };
}

export function buildDesktopLastWindowCloseConfirmationModel(
  impact: DesktopQuitImpact,
): DesktopConfirmationDialogModel {
  const operationCount = impact.pending_operation_count;
  const runtimeCount = impact.running_runtime_count;
  const message = operationCount > 0
    ? `The last window will close, but ${operationCount} background ${pluralize(operationCount, 'task')} will keep running.`
    : impact.environment_window_count > 0
      ? 'The last window will close, but Redeven Desktop will keep running in the background.'
      : 'Redeven Desktop will keep running in the background.';
  const runtimeDetail = runtimeCount > 0
    ? `${runtimeCount} runtime ${pluralize(runtimeCount, 'process', 'processes')} will keep running.`
    : '';

  return {
    title: 'Close the Last Window?',
    message,
    detail: [runtimeDetail, 'Reopen the launcher from the Dock or app menu.'].filter(Boolean).join(' '),
    confirm_label: 'Close Window',
    cancel_label: 'Cancel',
    confirm_tone: 'warning',
  };
}
