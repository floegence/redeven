import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import {
  defaultSavedEnvironmentLabel,
  desktopEnvironmentID,
  desktopPreferencesToDraft,
  type DesktopSavedEnvironment,
  type DesktopPreferences,
} from './desktopPreferences';
import type { DesktopSessionSummary } from './desktopTarget';
import { buildDesktopSettingsSurfaceSnapshot } from './settingsPageContent';
import type {
  DesktopEnvironmentEntry,
  DesktopLauncherSurface,
  DesktopOpenEnvironmentWindow,
  DesktopWelcomeEntryReason,
  DesktopWelcomeIssue,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';

export type BuildDesktopWelcomeSnapshotArgs = Readonly<{
  preferences: DesktopPreferences;
  openSessions?: readonly DesktopSessionSummary[];
  surface?: DesktopLauncherSurface;
  entryReason?: DesktopWelcomeEntryReason;
  issue?: DesktopWelcomeIssue | null;
}>;

function diagnosticsLines(lines: readonly string[]): string {
  return lines.filter((value) => String(value ?? '').trim() !== '').join('\n');
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function buildRemoteConnectionIssue(
  targetURL: string,
  code: string,
  message: string,
): DesktopWelcomeIssue {
  return {
    scope: 'remote_environment',
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
        scope: 'local_environment',
        code: report.code,
        title: 'Redeven is already starting elsewhere',
        message: 'Another Redeven runtime instance is using the default state directory and appears to provide Local UI. Retry in a moment so Desktop can attach to it.',
        diagnostics_copy: formatBlockedLaunchDiagnostics(report),
        target_url: '',
      };
    }
    return {
      scope: 'local_environment',
      code: report.code,
      title: 'Redeven is already running',
      message: 'Another Redeven runtime instance is using the default state directory without an attachable Local UI. Stop that runtime or restart it in a Local UI mode, then try again.',
      diagnostics_copy: formatBlockedLaunchDiagnostics(report),
      target_url: '',
    };
  }

  return {
    scope: 'local_environment',
    code: report.code,
    title: 'Local Environment needs attention',
    message: report.message,
    diagnostics_copy: formatBlockedLaunchDiagnostics(report),
    target_url: '',
  };
}

function sortOpenSessions(
  sessions: readonly DesktopSessionSummary[],
): readonly DesktopSessionSummary[] {
  return [...sessions].sort((left, right) => {
    if (left.target.kind === 'managed_local' && right.target.kind !== 'managed_local') {
      return -1;
    }
    if (left.target.kind !== 'managed_local' && right.target.kind === 'managed_local') {
      return 1;
    }
    return left.target.label.localeCompare(right.target.label) || left.startup.local_ui_url.localeCompare(right.startup.local_ui_url);
  });
}

function buildOpenEnvironmentWindows(
  sessions: readonly DesktopSessionSummary[],
): readonly DesktopOpenEnvironmentWindow[] {
  return sortOpenSessions(sessions).map((session) => ({
    session_key: session.session_key,
    target_kind: session.target.kind,
    environment_id: session.target.environment_id,
    label: session.target.label,
    local_ui_url: session.startup.local_ui_url,
  }));
}

function openSessionByURL(
  sessions: readonly DesktopSessionSummary[],
  rawURL: string,
): DesktopSessionSummary | null {
  const targetURL = compact(rawURL);
  if (targetURL === '') {
    return null;
  }
  return sessions.find((session) => (
    session.target.kind === 'external_local_ui' && session.target.external_local_ui_url === targetURL
  )) ?? null;
}

function buildEnvironmentEntries(
  preferences: DesktopPreferences,
  openSessions: readonly DesktopSessionSummary[],
): readonly DesktopEnvironmentEntry[] {
  const managedSession = openSessions.find((session) => session.target.kind === 'managed_local') ?? null;
  const openRemoteSessions = openSessions.filter((session) => session.target.kind === 'external_local_ui');
  const entries: DesktopEnvironmentEntry[] = [
    {
      id: 'local_environment',
      kind: 'local_environment',
      label: 'Local Environment',
      local_ui_url: managedSession?.startup.local_ui_url ?? '',
      secondary_text: managedSession?.startup.local_ui_url || 'Open the desktop-managed environment on this machine.',
      tag: managedSession ? 'Open' : 'Local',
      category: 'local_environment',
      is_open: managedSession !== null,
      open_session_key: managedSession?.session_key ?? '',
      open_action_label: managedSession ? 'Focus' : 'Open',
      can_edit: true,
      can_delete: false,
      can_save: false,
      last_used_at_ms: managedSession ? Date.now() : 0,
    },
  ];

  const catalog = preferences.saved_environments;
  const seenRemoteURLs = new Set<string>();

  for (const session of openRemoteSessions) {
    if (seenRemoteURLs.has(session.startup.local_ui_url)) {
      continue;
    }
    seenRemoteURLs.add(session.startup.local_ui_url);
  }

  for (const session of openRemoteSessions) {
    const localUIURL = session.startup.local_ui_url;
    if (catalog.some((environment) => environment.local_ui_url === localUIURL)) {
      continue;
    }
    entries.push({
      id: desktopEnvironmentID(localUIURL),
      kind: 'external_local_ui',
      label: session.target.label || defaultSavedEnvironmentLabel(localUIURL),
      local_ui_url: localUIURL,
      secondary_text: localUIURL,
      tag: 'Open',
      category: 'open_unsaved',
      is_open: true,
      open_session_key: session.session_key,
      open_action_label: 'Focus',
      can_edit: true,
      can_delete: false,
      can_save: true,
      last_used_at_ms: Date.now(),
    });
  }

  for (const environment of catalog) {
    entries.push(buildSavedEnvironmentEntry(environment, openSessionByURL(openSessions, environment.local_ui_url)));
  }

  return entries;
}

function buildSavedEnvironmentEntry(
  environment: DesktopSavedEnvironment,
  openSession: DesktopSessionSummary | null,
): DesktopEnvironmentEntry {
  const isOpen = openSession !== null;
  return {
    id: environment.id,
    kind: 'external_local_ui',
    label: environment.label,
    local_ui_url: environment.local_ui_url,
    secondary_text: environment.local_ui_url,
    tag: isOpen ? 'Open' : environment.source === 'recent_auto' ? 'Recent' : 'Saved',
    category: environment.source,
    is_open: isOpen,
    open_session_key: openSession?.session_key ?? '',
    open_action_label: isOpen ? 'Focus' : 'Open',
    can_edit: true,
    can_delete: true,
    can_save: environment.source === 'recent_auto',
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function suggestedRemoteURL(
  issue: DesktopWelcomeIssue | null,
  openSessions: readonly DesktopSessionSummary[],
  environments: readonly DesktopEnvironmentEntry[],
): string {
  if (issue?.scope === 'remote_environment' && issue.target_url) {
    return issue.target_url;
  }

  const openRemote = openSessions.find((session) => session.target.kind === 'external_local_ui');
  if (openRemote?.target.kind === 'external_local_ui') {
    return openRemote.target.external_local_ui_url;
  }

  return environments.find((environment) => environment.kind === 'external_local_ui')?.local_ui_url ?? '';
}

export function buildDesktopWelcomeSnapshot(
  args: BuildDesktopWelcomeSnapshotArgs,
): DesktopWelcomeSnapshot {
  const preferences = args.preferences;
  const openSessions = sortOpenSessions(args.openSessions ?? []);
  const issue = args.issue ?? null;
  const surface = args.surface ?? 'connect_environment';
  const environments = buildEnvironmentEntries(preferences, openSessions);
  const managedSession = openSessions.find((session) => session.target.kind === 'managed_local') ?? null;

  return {
    surface,
    entry_reason: args.entryReason ?? 'app_launch',
    close_action_label: openSessions.length > 0 ? 'Close Launcher' : 'Quit',
    open_windows: buildOpenEnvironmentWindows(openSessions),
    environments,
    suggested_remote_url: suggestedRemoteURL(issue, openSessions, environments),
    issue,
    settings_surface: buildDesktopSettingsSurfaceSnapshot('local_environment_settings', desktopPreferencesToDraft(preferences), {
      current_runtime_url: managedSession?.startup.local_ui_url ?? '',
      local_ui_password_configured: preferences.local_ui_password_configured,
      runtime_password_required: managedSession?.startup.password_required === true,
    }),
  };
}
