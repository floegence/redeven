import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import {
  desktopPreferencesToDraft,
  findManagedEnvironmentByID,
  type DesktopSavedEnvironment,
  type DesktopSavedSSHEnvironment,
  type DesktopPreferences,
  defaultSavedEnvironmentLabel,
  desktopEnvironmentID,
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
import {
  defaultSavedSSHEnvironmentLabel,
  desktopSSHEnvironmentID,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  createManagedLocalEnvironment,
  type DesktopManagedEnvironment,
} from '../shared/desktopManagedEnvironment';

export type BuildDesktopWelcomeSnapshotArgs = Readonly<{
  preferences: DesktopPreferences;
  openSessions?: readonly DesktopSessionSummary[];
  surface?: DesktopLauncherSurface;
  entryReason?: DesktopWelcomeEntryReason;
  issue?: DesktopWelcomeIssue | null;
  selectedManagedEnvironmentID?: string;
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

export function buildSSHConnectionIssue(
  details: DesktopSSHEnvironmentDetails,
  code: string,
  message: string,
): DesktopWelcomeIssue {
  return {
    scope: 'remote_environment',
    code,
    title: 'Unable to open that SSH Environment',
    message,
    diagnostics_copy: diagnosticsLines([
      'status: blocked',
      `code: ${code}`,
      `message: ${message}`,
      `ssh destination: ${details.ssh_destination}`,
      `ssh port: ${details.ssh_port ?? 'default'}`,
      `remote install dir: ${details.remote_install_dir}`,
      `bootstrap strategy: ${details.bootstrap_strategy}`,
      `release base url: ${details.release_base_url || 'default'}`,
    ]),
    target_url: '',
    ssh_details: details,
  };
}

export function buildControlPlaneIssue(
  code: string,
  message: string,
): DesktopWelcomeIssue {
  return {
    scope: 'startup',
    code,
    title: code === 'control_plane_invalid' ? 'Control Plane configuration is invalid' : 'Unable to use that Control Plane',
    message,
    diagnostics_copy: diagnosticsLines([
      'status: blocked',
      `code: ${code}`,
      `message: ${message}`,
    ]),
    target_url: '',
  };
}

export function buildBlockedLaunchIssue(report: LaunchBlockedReport): DesktopWelcomeIssue {
  if (report.code === 'state_dir_locked') {
    if (report.lock_owner?.local_ui_enabled === true) {
      return {
        scope: 'managed_environment',
        code: report.code,
        title: 'Redeven is already starting elsewhere',
        message: 'Another Redeven runtime instance is using the default state directory and appears to provide Local UI. Retry in a moment so Desktop can attach to it.',
        diagnostics_copy: formatBlockedLaunchDiagnostics(report),
        target_url: '',
      };
    }
    return {
      scope: 'managed_environment',
      code: report.code,
      title: 'Redeven is already running',
      message: 'Another Redeven runtime instance is using the default state directory without an attachable Local UI. Stop that runtime or restart it in a Local UI mode, then try again.',
      diagnostics_copy: formatBlockedLaunchDiagnostics(report),
      target_url: '',
    };
  }

  return {
    scope: 'managed_environment',
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
    if (left.target.kind === 'managed_environment' && right.target.kind !== 'managed_environment') {
      return -1;
    }
    if (left.target.kind !== 'managed_environment' && right.target.kind === 'managed_environment') {
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

function openSessionBySSHEnvironment(
  sessions: readonly DesktopSessionSummary[],
  environment: DesktopSavedSSHEnvironment,
): DesktopSessionSummary | null {
  return sessions.find((session) => (
    session.target.kind === 'ssh_environment'
    && (
      session.target.environment_id === environment.id
      || (
        session.target.ssh_destination === environment.ssh_destination
        && session.target.ssh_port === environment.ssh_port
        && session.target.remote_install_dir === environment.remote_install_dir
      )
    )
  )) ?? null;
}

function openSessionByManagedEnvironment(
  sessions: readonly DesktopSessionSummary[],
  environment: DesktopManagedEnvironment,
): DesktopSessionSummary | null {
  return sessions.find((session) => (
    session.target.kind === 'managed_environment' && session.target.environment_id === environment.id
  )) ?? null;
}

function buildManagedEnvironmentEntry(
  environment: DesktopManagedEnvironment,
  openSession: DesktopSessionSummary | null,
): DesktopEnvironmentEntry {
  const isOpen = openSession !== null;
  return {
    id: environment.id,
    kind: 'managed_environment',
    label: environment.label,
    local_ui_url: openSession?.startup.local_ui_url ?? '',
    secondary_text: environment.kind === 'local'
      ? environment.access.local_ui_bind
      : `${environment.provider_origin} · ${environment.env_public_id}`,
    managed_environment_kind: environment.kind,
    managed_environment_name: environment.kind === 'local' ? environment.name : undefined,
    managed_local_ui_bind: environment.access.local_ui_bind,
    managed_local_ui_password_configured: environment.access.local_ui_password_configured,
    provider_origin: environment.kind === 'controlplane' ? environment.provider_origin : undefined,
    provider_id: environment.kind === 'controlplane' ? environment.provider_id : undefined,
    env_public_id: environment.kind === 'controlplane' ? environment.env_public_id : undefined,
    tag: isOpen ? 'Open' : 'Managed',
    category: 'managed',
    is_open: isOpen,
    open_session_key: openSession?.session_key ?? '',
    open_action_label: isOpen ? 'Focus' : 'Open',
    can_edit: true,
    can_delete: false,
    can_save: false,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function buildEnvironmentEntries(
  preferences: DesktopPreferences,
  openSessions: readonly DesktopSessionSummary[],
): readonly DesktopEnvironmentEntry[] {
  const openRemoteSessions = openSessions.filter((session) => session.target.kind === 'external_local_ui');
  const openSSHSessions = openSessions.filter((session) => session.target.kind === 'ssh_environment');
  const entries: DesktopEnvironmentEntry[] = preferences.managed_environments.map((environment) => (
    buildManagedEnvironmentEntry(environment, openSessionByManagedEnvironment(openSessions, environment))
  ));

  const catalog = preferences.saved_environments;
  const sshCatalog = preferences.saved_ssh_environments;
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

  for (const session of openSSHSessions) {
    const target = session.target;
    if (target.kind !== 'ssh_environment') {
      continue;
    }
    if (sshCatalog.some((environment) => (
      environment.id === target.environment_id
      || (
        environment.ssh_destination === target.ssh_destination
        && environment.ssh_port === target.ssh_port
        && environment.remote_install_dir === target.remote_install_dir
      )
    ))) {
      continue;
    }
    entries.push({
      id: desktopSSHEnvironmentID(target),
      kind: 'ssh_environment',
      label: target.label || defaultSavedSSHEnvironmentLabel(target),
      local_ui_url: session.startup.local_ui_url,
      secondary_text: target.ssh_port === null
        ? target.ssh_destination
        : `${target.ssh_destination}:${target.ssh_port}`,
      ssh_details: {
        ssh_destination: target.ssh_destination,
        ssh_port: target.ssh_port,
        remote_install_dir: target.remote_install_dir,
        bootstrap_strategy: target.bootstrap_strategy,
        release_base_url: target.release_base_url,
      },
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
  for (const environment of sshCatalog) {
    entries.push(buildSavedSSHEnvironmentEntry(environment, openSessionBySSHEnvironment(openSessions, environment)));
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

function buildSavedSSHEnvironmentEntry(
  environment: DesktopSavedSSHEnvironment,
  openSession: DesktopSessionSummary | null,
): DesktopEnvironmentEntry {
  const isOpen = openSession !== null;
  return {
    id: environment.id,
    kind: 'ssh_environment',
    label: environment.label,
    local_ui_url: openSession?.startup.local_ui_url ?? '',
    secondary_text: environment.ssh_port === null
      ? environment.ssh_destination
      : `${environment.ssh_destination}:${environment.ssh_port}`,
    ssh_details: {
      ssh_destination: environment.ssh_destination,
      ssh_port: environment.ssh_port,
      remote_install_dir: environment.remote_install_dir,
      bootstrap_strategy: environment.bootstrap_strategy,
      release_base_url: environment.release_base_url,
    },
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
  if (issue?.scope === 'remote_environment' && issue.target_url && !issue.ssh_details) {
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
  const selectedManagedEnvironment = (
    findManagedEnvironmentByID(preferences, args.selectedManagedEnvironmentID ?? '')
    ?? preferences.managed_environments[0]
    ?? createManagedLocalEnvironment('default')
  );
  const managedSession = openSessionByManagedEnvironment(openSessions, selectedManagedEnvironment);

  return {
    surface,
    entry_reason: args.entryReason ?? 'app_launch',
    close_action_label: openSessions.length > 0 ? 'Close Launcher' : 'Quit',
    open_windows: buildOpenEnvironmentWindows(openSessions),
    environments,
    control_planes: preferences.control_planes,
    suggested_remote_url: suggestedRemoteURL(issue, openSessions, environments),
    issue,
    settings_surface: buildDesktopSettingsSurfaceSnapshot('managed_environment_settings', desktopPreferencesToDraft(preferences, selectedManagedEnvironment.id), {
      environment_id: selectedManagedEnvironment.id,
      environment_label: selectedManagedEnvironment.label,
      environment_kind: selectedManagedEnvironment.kind,
      current_runtime_url: managedSession?.startup.local_ui_url ?? '',
      local_ui_password_configured: selectedManagedEnvironment.access.local_ui_password_configured,
      runtime_password_required: managedSession?.startup.password_required === true,
    }),
  };
}
