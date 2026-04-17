export type DesktopQuitSource = 'explicit' | 'system' | 'last_window_close';

export type DesktopQuitImpactRuntime = Readonly<{
  id: string;
  label: string;
  kind: 'managed_environment' | 'ssh_environment';
}>;

export type DesktopQuitImpactInput = Readonly<{
  environment_window_count: number;
  managed_environment_runtimes: readonly Readonly<{
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

export type DesktopQuitDialogCopy = Readonly<{
  title: string;
  message: string;
  detail: string;
  buttons: readonly ['Cancel', 'Quit'];
  default_id: 1;
  cancel_id: 0;
}>;

const LABEL_PREVIEW_LIMIT = 4;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function displayRuntimeLabel(label: string): string {
  const clean = compact(label);
  return clean === '' ? 'Untitled Environment' : clean;
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

function formatRuntimeLabels(runtimes: readonly DesktopQuitImpactRuntime[]): string[] {
  const preview = runtimes.slice(0, LABEL_PREVIEW_LIMIT).map((runtime) => `- ${displayRuntimeLabel(runtime.label)}`);
  const remaining = runtimes.length - preview.length;
  if (remaining > 0) {
    preview.push(`- ${remaining} more ${pluralize(remaining, 'environment')}`);
  }
  return preview;
}

export function buildDesktopQuitImpact(input: DesktopQuitImpactInput): DesktopQuitImpact {
  const desktopOwnedRuntimes: DesktopQuitImpactRuntime[] = [];
  let externalRuntimeCount = 0;

  for (const runtime of input.managed_environment_runtimes) {
    if (runtime.lifecycle_owner === 'desktop') {
      desktopOwnedRuntimes.push({
        id: runtime.id,
        label: runtime.label,
        kind: 'managed_environment',
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

export function buildDesktopQuitDialogCopy(impact: DesktopQuitImpact): DesktopQuitDialogCopy {
  const runtimeCount = impact.desktop_owned_runtimes.length;
  const sessionCount = impact.environment_window_count;
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

  const detailLines: string[] = [];
  if (summary.length > 0) {
    detailLines.push(`Quitting now will ${joinWithAnd(summary)}.`);
  } else {
    detailLines.push('Redeven Desktop will quit.');
  }

  if (runtimeCount > 0) {
    detailLines.push('');
    detailLines.push(
      runtimeCount === 1
        ? 'This environment may become unavailable from this machine until Redeven Desktop starts it again:'
        : 'These environments may become unavailable from this machine until Redeven Desktop starts them again:',
    );
    detailLines.push(...formatRuntimeLabels(impact.desktop_owned_runtimes));
  }

  return {
    title: 'Quit Redeven Desktop?',
    message: 'Quit Redeven Desktop?',
    detail: detailLines.join('\n'),
    buttons: ['Cancel', 'Quit'],
    default_id: 1,
    cancel_id: 0,
  };
}
