import type { DesktopConfirmationDialogModel } from '../shared/desktopConfirmationContract';

export type DesktopQuitSource = 'explicit' | 'system' | 'last_window_close';

export type DesktopQuitImpactRuntime = Readonly<{
  id: string;
  label: string;
  kind: 'local_environment' | 'ssh_environment';
}>;

export type DesktopQuitImpactInput = Readonly<{
  environment_window_count: number;
  local_environment_runtimes: readonly Readonly<{
    id: string;
    label: string;
    lifecycle_owner: 'desktop' | 'external';
  }>[];
  ssh_runtimes: readonly Readonly<{
    id: string;
    label: string;
    lifecycle_owner: 'desktop' | 'external';
  }>[];
}>;

export type DesktopQuitImpact = Readonly<{
  environment_window_count: number;
  desktop_owned_runtimes: readonly DesktopQuitImpactRuntime[];
  external_runtime_count: number;
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
  const desktopOwnedRuntimes: DesktopQuitImpactRuntime[] = [];
  let externalRuntimeCount = 0;

  for (const runtime of input.local_environment_runtimes) {
    if (runtime.lifecycle_owner === 'desktop') {
      desktopOwnedRuntimes.push({
        id: runtime.id,
        label: runtime.label,
        kind: 'local_environment',
      });
    } else {
      externalRuntimeCount += 1;
    }
  }

  for (const runtime of input.ssh_runtimes) {
    if (runtime.lifecycle_owner === 'desktop') {
      desktopOwnedRuntimes.push({
        id: runtime.id,
        label: runtime.label,
        kind: 'ssh_environment',
      });
    } else {
      externalRuntimeCount += 1;
    }
  }

  desktopOwnedRuntimes.sort((left, right) => left.label.localeCompare(right.label));

  return {
    environment_window_count: Math.max(0, Math.trunc(input.environment_window_count)),
    desktop_owned_runtimes: desktopOwnedRuntimes,
    external_runtime_count: externalRuntimeCount,
  };
}

export function shouldConfirmDesktopQuit(
  impact: DesktopQuitImpact,
  source: DesktopQuitSource,
): boolean {
  if (impact.desktop_owned_runtimes.length > 0) {
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
  return impact.desktop_owned_runtimes.length > 0 || impact.environment_window_count > 0;
}

export function buildDesktopQuitConfirmationModel(impact: DesktopQuitImpact): DesktopConfirmationDialogModel {
  const runtimeCount = impact.desktop_owned_runtimes.length;
  const sessionCount = impact.environment_window_count;
  const externalRuntimeCount = impact.external_runtime_count;
  const summary: string[] = [];

  if (runtimeCount > 0) {
    summary.push(
      `stop ${runtimeCount} Desktop-managed ${pluralize(runtimeCount, 'runtime')}`,
    );
  }
  if (sessionCount > 0) {
    summary.push(
      `close ${sessionCount} environment ${pluralize(sessionCount, 'window')}`,
    );
  }

  const message = summary.length > 0
    ? `This will ${joinWithAnd(summary)}.`
    : 'Redeven Desktop will quit.';
  const detail = externalRuntimeCount > 0
    ? `${externalRuntimeCount} externally managed ${pluralize(externalRuntimeCount, 'runtime')} will keep running.`
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
  const runtimeCount = impact.desktop_owned_runtimes.length;
  const runtimeLabel = `${runtimeCount} Desktop-managed ${pluralize(runtimeCount, 'runtime')}`;
  const message = runtimeCount > 0
    ? `The last window will close, but ${runtimeLabel} will keep running in the background.`
    : impact.environment_window_count > 0
      ? 'The last window will close, but Redeven Desktop will keep running in the background.'
      : 'Redeven Desktop will keep running in the background.';

  return {
    title: 'Close the Last Window?',
    message,
    detail: 'Reopen the launcher from the Dock or app menu.',
    confirm_label: 'Close Window',
    cancel_label: 'Cancel',
    confirm_tone: 'warning',
  };
}
