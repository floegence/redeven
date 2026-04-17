import type {
  DesktopConfirmationDialogModel,
  DesktopConfirmationMetric,
  DesktopConfirmationRuntimePreviewItem,
} from './desktopConfirmation';

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

function runtimePreviewBadge(kind: DesktopQuitImpactRuntime['kind']): string {
  return kind === 'ssh_environment' ? 'SSH Host' : 'Managed Environment';
}

function formatRuntimePreview(
  runtimes: readonly DesktopQuitImpactRuntime[],
): Readonly<{
  items: readonly DesktopConfirmationRuntimePreviewItem[];
  overflow_count: number;
}> {
  const items = runtimes.slice(0, LABEL_PREVIEW_LIMIT).map((runtime) => ({
    label: displayRuntimeLabel(runtime.label),
    badge: runtimePreviewBadge(runtime.kind),
  }));
  return {
    items,
    overflow_count: Math.max(0, runtimes.length - items.length),
  };
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
  const runtimePreview = formatRuntimePreview(impact.desktop_owned_runtimes);

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
  }

  const message = detailLines[0] ?? 'Redeven Desktop will quit.';
  const summaryItems: DesktopConfirmationMetric[] = [
    {
      value: String(runtimeCount),
      label: runtimeCount === 1 ? 'Runtime to stop' : 'Runtimes to stop',
      detail: runtimeCount > 0
        ? 'Desktop-owned runtimes shut down with the app.'
        : 'No Desktop-managed runtime will be stopped.',
      tone: runtimeCount > 0 ? 'danger' : 'neutral',
    },
    {
      value: String(sessionCount),
      label: sessionCount === 1 ? 'Window to close' : 'Windows to close',
      detail: sessionCount > 0
        ? 'Every open environment window closes immediately.'
        : 'No environment windows are currently open.',
      tone: sessionCount > 0 ? 'warning' : 'neutral',
    },
  ];
  if (externalRuntimeCount > 0) {
    summaryItems.push({
      value: String(externalRuntimeCount),
      label: externalRuntimeCount === 1 ? 'Runtime unchanged' : 'Runtimes unchanged',
      detail: 'Externally managed runtimes keep their current state.',
      tone: 'success',
    });
  }

  return {
    title: 'Quit Redeven Desktop?',
    eyebrow: 'Redeven Desktop',
    heading: 'Quit Redeven Desktop?',
    message,
    impact_label: runtimeCount > 0 ? 'Runtime impact' : 'Window impact',
    confirm_label: 'Quit Desktop',
    cancel_label: 'Keep Running',
    confirm_tone: 'danger',
    summary_items: summaryItems,
    runtime_section_title: runtimeCount > 0 ? 'Affected environments' : undefined,
    runtime_section_body: runtimeCount > 0
      ? runtimeCount === 1
        ? 'Stopping this Desktop-managed runtime may make the environment unavailable from this machine until Redeven Desktop starts it again.'
        : 'Stopping these Desktop-managed runtimes may make the following environments unavailable from this machine until Redeven Desktop starts them again.'
      : undefined,
    runtime_preview: runtimePreview.items,
    runtime_overflow_count: runtimePreview.overflow_count,
    callout: runtimeCount > 0
      ? {
        eyebrow: 'Access impact',
        body: runtimeCount === 1
          ? 'This machine may stop serving the affected environment until Redeven Desktop starts that runtime again.'
          : 'This machine may stop serving the affected environments until Redeven Desktop starts those runtimes again.',
        tone: 'warning',
      }
      : undefined,
    footnote: 'Press Esc to cancel, or Cmd/Ctrl+Enter to quit Desktop.',
  };
}

export function buildDesktopLastWindowCloseConfirmationModel(
  impact: DesktopQuitImpact,
): DesktopConfirmationDialogModel {
  const runtimeCount = impact.desktop_owned_runtimes.length;
  const sessionCount = impact.environment_window_count;
  const externalRuntimeCount = impact.external_runtime_count;
  const summary: string[] = [];
  const runtimePreview = formatRuntimePreview(impact.desktop_owned_runtimes);

  if (sessionCount > 0) {
    summary.push(`close ${sessionCount} environment ${pluralize(sessionCount, 'window')}`);
  }
  if (runtimeCount > 0) {
    summary.push(`keep ${runtimeCount} Desktop-managed ${pluralize(runtimeCount, 'runtime')} running in the background`);
  }

  const message = summary.length > 0
    ? `Closing the last window will ${joinWithAnd(summary)}. Redeven Desktop will stay open.`
    : 'Closing the last window will keep Redeven Desktop open without any visible windows.';
  const summaryItems: DesktopConfirmationMetric[] = [
    {
      value: String(sessionCount),
      label: sessionCount === 1 ? 'Window to close' : 'Windows to close',
      detail: sessionCount > 0
        ? 'The final visible Desktop surface will disappear.'
        : 'Desktop has no visible environment windows to close.',
      tone: sessionCount > 0 ? 'warning' : 'neutral',
    },
    {
      value: String(runtimeCount),
      label: runtimeCount === 1 ? 'Runtime left running' : 'Runtimes left running',
      detail: runtimeCount > 0
        ? 'Desktop-managed runtimes continue in the background.'
        : 'No Desktop-managed runtime continues in the background.',
      tone: runtimeCount > 0 ? 'success' : 'neutral',
    },
  ];
  if (externalRuntimeCount > 0) {
    summaryItems.push({
      value: String(externalRuntimeCount),
      label: externalRuntimeCount === 1 ? 'Runtime unchanged' : 'Runtimes unchanged',
      detail: 'Externally managed runtimes are not affected by this window close.',
      tone: 'success',
    });
  }

  return {
    title: 'Close the Last Window?',
    eyebrow: 'Redeven Desktop',
    heading: 'Close the Last Window?',
    message,
    impact_label: runtimeCount > 0 ? 'Background activity' : 'Window visibility',
    confirm_label: 'Close Window',
    cancel_label: 'Keep Window Open',
    confirm_tone: 'warning',
    summary_items: summaryItems,
    runtime_section_title: runtimeCount > 0 ? 'Still running after the window closes' : undefined,
    runtime_section_body: runtimeCount > 0
      ? runtimeCount === 1
        ? 'This environment will keep running until you quit Redeven Desktop.'
        : 'These environments will keep running until you quit Redeven Desktop.'
      : undefined,
    runtime_preview: runtimePreview.items,
    runtime_overflow_count: runtimePreview.overflow_count,
    callout: {
      eyebrow: 'Reopen later',
      body: 'Redeven Desktop stays active after the final macOS window closes. Reopen the launcher from the Dock or the Redeven Desktop app menu.',
      tone: 'info',
    },
    footnote: 'Press Esc to keep the window open, or Cmd/Ctrl+Enter to close it.',
  };
}
