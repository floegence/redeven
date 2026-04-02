import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import {
  defaultSavedEnvironmentLabel,
  desktopEnvironmentID,
  desktopPreferencesToDraft,
  type DesktopPreferences,
} from './desktopPreferences';
import type { DesktopSessionTarget } from './desktopTarget';
import { buildDesktopSettingsSurfaceSnapshot } from './settingsPageContent';
import type { StartupReport } from './startup';
import type {
  DesktopEnvironmentEntry,
  DesktopLauncherSurface,
  DesktopWelcomeEntryReason,
  DesktopWelcomeIssue,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';

export type BuildDesktopWelcomeSnapshotArgs = Readonly<{
  preferences: DesktopPreferences;
  managedStartup?: StartupReport | null;
  externalStartup?: StartupReport | null;
  activeSessionTarget?: DesktopSessionTarget | null;
  surface?: DesktopLauncherSurface;
  entryReason?: DesktopWelcomeEntryReason;
  issue?: DesktopWelcomeIssue | null;
}>;

function diagnosticsLines(lines: readonly string[]): string {
  return lines.filter((value) => String(value ?? '').trim() !== '').join('\n');
}

export function buildRemoteConnectionIssue(
  targetURL: string,
  code: string,
  message: string,
): DesktopWelcomeIssue {
  return {
    scope: 'remote_device',
    code,
    title: code === 'external_target_invalid' ? 'Check the Environment URL' : 'Unable to open that Environment',
    message,
    diagnostics_copy: diagnosticsLines([
      'status: blocked',
      `code: ${code}`,
      `message: ${message}`,
      `target url: ${targetURL}`,
    ]),
    target_url: targetURL,
  };
}

export function buildBlockedLaunchIssue(report: LaunchBlockedReport): DesktopWelcomeIssue {
  if (report.code === 'state_dir_locked') {
    if (report.lock_owner?.local_ui_enabled === true) {
      return {
        scope: 'this_device',
        code: report.code,
        title: 'Redeven is already starting elsewhere',
        message: 'Another Redeven runtime instance is using the default state directory and appears to provide Local UI. Retry in a moment so Desktop can attach to it.',
        diagnostics_copy: formatBlockedLaunchDiagnostics(report),
        target_url: '',
      };
    }
    return {
      scope: 'this_device',
      code: report.code,
      title: 'Redeven is already running',
      message: 'Another Redeven runtime instance is using the default state directory without an attachable Local UI. Stop that runtime or restart it in a Local UI mode, then try again.',
      diagnostics_copy: formatBlockedLaunchDiagnostics(report),
      target_url: '',
    };
  }

  return {
    scope: 'this_device',
    code: report.code,
    title: 'This Device needs attention',
    message: report.message,
    diagnostics_copy: formatBlockedLaunchDiagnostics(report),
    target_url: '',
  };
}

function activeSessionLocalUIURL(
  activeSessionTarget: DesktopSessionTarget | null,
  managedStartup: StartupReport | null,
  externalStartup: StartupReport | null,
): string {
  if (!activeSessionTarget) {
    return '';
  }
  if (activeSessionTarget.kind === 'external_local_ui') {
    return externalStartup?.local_ui_url ?? activeSessionTarget.external_local_ui_url;
  }
  return managedStartup?.local_ui_url ?? '';
}

function currentSessionLabel(activeSessionTarget: DesktopSessionTarget | null): string {
  if (!activeSessionTarget) {
    return 'No environment open';
  }
  return activeSessionTarget.kind === 'managed_local'
    ? 'This Device environment is open'
    : 'Another environment is open';
}

function currentSessionDescription(
  activeSessionTarget: DesktopSessionTarget | null,
  managedStartup: StartupReport | null,
  externalStartup: StartupReport | null,
): string {
  if (!activeSessionTarget) {
    return 'Choose an Environment to open in Redeven Desktop.';
  }
  if (activeSessionTarget.kind === 'managed_local') {
    return managedStartup?.local_ui_url
      ? `Current environment: ${managedStartup.local_ui_url}`
      : 'Redeven Desktop is currently attached to This Device.';
  }
  return externalStartup?.local_ui_url
    ? `Current environment: ${externalStartup.local_ui_url}`
    : 'Redeven Desktop is currently attached to another Environment.';
}

function buildEnvironmentEntries(
  preferences: DesktopPreferences,
  managedStartup: StartupReport | null,
  externalStartup: StartupReport | null,
  activeSessionTarget: DesktopSessionTarget | null,
): readonly DesktopEnvironmentEntry[] {
  const currentExternalURL = activeSessionTarget?.kind === 'external_local_ui'
    ? (externalStartup?.local_ui_url || activeSessionTarget.external_local_ui_url)
    : '';
  const currentManaged = activeSessionTarget?.kind === 'managed_local';
  const entries: DesktopEnvironmentEntry[] = [
    {
      id: 'this_device',
      kind: 'this_device',
      label: 'This Device',
      local_ui_url: managedStartup?.local_ui_url ?? '',
      secondary_text: managedStartup?.local_ui_url || 'Open the desktop-managed Environment on this machine.',
      tag: currentManaged ? 'Current' : 'This Device',
      is_current: currentManaged,
      can_edit: true,
      can_delete: false,
      last_used_at_ms: currentManaged ? Date.now() : 0,
    },
  ];

  const catalog = preferences.saved_environments;
  const currentExternalExistsInCatalog = currentExternalURL !== '' && catalog.some((environment) => environment.local_ui_url === currentExternalURL);
  if (currentExternalURL !== '' && !currentExternalExistsInCatalog) {
    entries.push({
      id: desktopEnvironmentID(currentExternalURL),
      kind: 'external_local_ui',
      label: defaultSavedEnvironmentLabel(currentExternalURL),
      local_ui_url: currentExternalURL,
      secondary_text: currentExternalURL,
      tag: 'Current',
      is_current: true,
      can_edit: true,
      can_delete: false,
      last_used_at_ms: Date.now(),
    });
  }
  for (let index = 0; index < catalog.length; index += 1) {
    const environment = catalog[index];
    const isCurrent = currentExternalURL !== '' && environment.local_ui_url === currentExternalURL;
    entries.push({
      id: environment.id,
      kind: 'external_local_ui',
      label: environment.label,
      local_ui_url: environment.local_ui_url,
      secondary_text: environment.local_ui_url,
      tag: isCurrent ? 'Current' : index < 3 ? 'Recent' : 'Saved',
      is_current: isCurrent,
      can_edit: true,
      can_delete: true,
      last_used_at_ms: environment.last_used_at_ms,
    });
  }

  return entries;
}

function suggestedRemoteURL(
  issue: DesktopWelcomeIssue | null,
  activeSessionTarget: DesktopSessionTarget | null,
  environments: readonly DesktopEnvironmentEntry[],
): string {
  if (issue?.scope === 'remote_device' && issue.target_url) {
    return issue.target_url;
  }
  if (activeSessionTarget?.kind === 'external_local_ui' && activeSessionTarget.external_local_ui_url) {
    return activeSessionTarget.external_local_ui_url;
  }
  return environments.find((environment) => environment.kind === 'external_local_ui')?.local_ui_url ?? '';
}

export function buildDesktopWelcomeSnapshot(
  args: BuildDesktopWelcomeSnapshotArgs,
): DesktopWelcomeSnapshot {
  const preferences = args.preferences;
  const managedStartup = args.managedStartup ?? null;
  const externalStartup = args.externalStartup ?? null;
  const activeSessionTarget = args.activeSessionTarget ?? null;
  const issue = args.issue ?? null;
  const surface = args.surface ?? 'connect_environment';
  const environments = buildEnvironmentEntries(preferences, managedStartup, externalStartup, activeSessionTarget);

  return {
    surface,
    entry_reason: args.entryReason ?? 'app_launch',
    current_session_target_kind: activeSessionTarget?.kind ?? null,
    current_session_local_ui_url: activeSessionLocalUIURL(activeSessionTarget, managedStartup, externalStartup),
    current_session_label: currentSessionLabel(activeSessionTarget),
    current_session_description: currentSessionDescription(activeSessionTarget, managedStartup, externalStartup),
    close_action_label: activeSessionTarget ? 'Back to current environment' : 'Quit',
    environments,
    suggested_remote_url: suggestedRemoteURL(issue, activeSessionTarget, environments),
    issue,
    settings_surface: buildDesktopSettingsSurfaceSnapshot('advanced_settings', desktopPreferencesToDraft(preferences)),
  };
}
