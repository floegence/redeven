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
import type { DesktopSessionLifecycle, DesktopSessionSummary } from './desktopTarget';
import { buildDesktopSettingsSurfaceSnapshot } from './settingsPageContent';
import type {
  DesktopEnvironmentEntry,
  DesktopLauncherSurface,
  DesktopManagedLocalCloseBehavior,
  DesktopManagedLocalRuntimeState,
  DesktopManagedEnvironmentRoute,
  DesktopOpenEnvironmentWindow,
  DesktopWelcomeEntryReason,
  DesktopWelcomeIssue,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import type { DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import {
  defaultSavedSSHEnvironmentLabel,
  desktopSSHEnvironmentID,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  createManagedLocalEnvironment,
  desktopManagedControlPlaneEnvironmentID,
  isDefaultLocalManagedEnvironment,
  managedEnvironmentKind,
  managedEnvironmentLocalAccess,
  managedEnvironmentLocalName,
  managedEnvironmentDefaultOpenRoute,
  managedEnvironmentProviderID,
  managedEnvironmentProviderOrigin,
  managedEnvironmentPublicID,
  managedEnvironmentSupportsLocalHosting,
  managedEnvironmentSupportsRemoteDesktop,
  type DesktopManagedEnvironment,
} from '../shared/desktopManagedEnvironment';
import {
  desktopProviderCatalogFreshness,
  desktopProviderRemoteRouteState,
  type DesktopManagedLocalRouteState,
  type DesktopProviderCatalogFreshness,
  type DesktopProviderRemoteRouteState,
} from '../shared/providerEnvironmentState';

export type BuildDesktopWelcomeSnapshotArgs = Readonly<{
  preferences: DesktopPreferences;
  controlPlanes?: readonly DesktopControlPlaneSummary[];
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
  options: Readonly<{
    providerOrigin?: string;
    status?: number;
  }> = {},
): DesktopWelcomeIssue {
  const providerOrigin = compact(options.providerOrigin);
  const status = Number.isInteger(options.status) && Number(options.status) >= 100
    ? Math.floor(Number(options.status))
    : 0;
  return {
    scope: 'startup',
    code,
    title: (() => {
      if (code === 'control_plane_invalid') {
        return 'Control Plane configuration is invalid';
      }
      if (code === 'provider_tls_untrusted') {
        return 'Trust the Control Plane certificate';
      }
      if (code === 'provider_dns_failed' || code === 'provider_connection_failed' || code === 'provider_timeout') {
        return 'Control Plane is unreachable';
      }
      if (code === 'provider_invalid_json' || code === 'provider_invalid_response') {
        return 'Control Plane returned an invalid response';
      }
      return 'Unable to use that Control Plane';
    })(),
    message,
    diagnostics_copy: diagnosticsLines([
      'status: blocked',
      `code: ${code}`,
      `message: ${message}`,
      providerOrigin !== '' ? `provider origin: ${providerOrigin}` : '',
      status > 0 ? `http status: ${status}` : '',
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
    return left.target.label.localeCompare(right.target.label)
      || (left.entry_url ?? left.startup?.local_ui_url ?? '').localeCompare(right.entry_url ?? right.startup?.local_ui_url ?? '');
  });
}

function sessionLifecycle(session: DesktopSessionSummary | null | undefined): DesktopSessionLifecycle | undefined {
  return session?.lifecycle;
}

function sessionIsOpen(session: DesktopSessionSummary | null | undefined): boolean {
  return session?.lifecycle === 'open';
}

function sessionIsOpening(session: DesktopSessionSummary | null | undefined): boolean {
  return session?.lifecycle === 'opening';
}

function buildOpenEnvironmentWindows(
  sessions: readonly DesktopSessionSummary[],
): readonly DesktopOpenEnvironmentWindow[] {
  return sortOpenSessions(sessions)
    .filter((session) => session.lifecycle === 'open')
    .map((session) => ({
    session_key: session.session_key,
    target_kind: session.target.kind,
    environment_id: session.target.environment_id,
    label: session.target.label,
    local_ui_url: session.entry_url ?? session.startup?.local_ui_url ?? '',
    lifecycle: 'open',
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

function openSessionsByManagedEnvironment(
  sessions: readonly DesktopSessionSummary[],
  environment: DesktopManagedEnvironment,
): Readonly<Partial<Record<DesktopManagedEnvironmentRoute, DesktopSessionSummary>>> {
  const out: Partial<Record<DesktopManagedEnvironmentRoute, DesktopSessionSummary>> = {};
  for (const session of sessions) {
    if (session.target.kind !== 'managed_environment' || session.target.environment_id !== environment.id) {
      continue;
    }
    out[session.target.route] = session;
  }
  return out;
}

function openSessionByProviderEnvironment(
  sessions: readonly DesktopSessionSummary[],
  providerOrigin: string,
  envPublicID: string,
): DesktopSessionSummary | null {
  const environmentID = desktopManagedControlPlaneEnvironmentID(providerOrigin, envPublicID);
  return sessions.find((session) => (
    session.target.kind === 'managed_environment'
    && session.target.route === 'remote_desktop'
    && session.target.environment_id === environmentID
  )) ?? null;
}

function providerEnvironmentPreference(
  preferences: DesktopPreferences,
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): DesktopPreferences['provider_environment_preferences'][number] | null {
  return preferences.provider_environment_preferences.find((preference) => (
    preference.provider_origin === providerOrigin
    && preference.provider_id === providerID
    && preference.env_public_id === envPublicID
  )) ?? null;
}

function fallbackControlPlaneSummaries(
  controlPlanes: DesktopPreferences['control_planes'],
): readonly DesktopControlPlaneSummary[] {
  return controlPlanes.map((controlPlane) => ({
    ...controlPlane,
    sync_state: controlPlane.last_synced_at_ms > 0 ? 'ready' : 'idle',
    last_sync_attempt_at_ms: controlPlane.last_synced_at_ms,
    last_sync_error_code: '',
    last_sync_error_message: '',
    catalog_freshness: desktopProviderCatalogFreshness(controlPlane.last_synced_at_ms),
  }));
}

function controlPlaneSummaryByIdentity(
  controlPlanes: readonly DesktopControlPlaneSummary[],
  providerOrigin: string,
  providerID: string,
): DesktopControlPlaneSummary | null {
  const cleanProviderOrigin = compact(providerOrigin);
  const cleanProviderID = compact(providerID);
  if (cleanProviderOrigin === '' || cleanProviderID === '') {
    return null;
  }
  return controlPlanes.find((entry) => (
    entry.provider.provider_origin === cleanProviderOrigin
    && entry.provider.provider_id === cleanProviderID
  )) ?? null;
}

function controlPlaneEnvironmentSummary(
  controlPlanes: readonly DesktopControlPlaneSummary[],
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): DesktopControlPlaneSummary['environments'][number] | null {
  const cleanEnvPublicID = compact(envPublicID);
  if (cleanEnvPublicID === '') {
    return null;
  }
  const controlPlane = controlPlaneSummaryByIdentity(controlPlanes, providerOrigin, providerID);
  if (!controlPlane) {
    return null;
  }
  return controlPlane.environments.find((entry) => entry.env_public_id === cleanEnvPublicID) ?? null;
}

function managedLocalRouteState(
  environment: DesktopManagedEnvironment,
  localSession: DesktopSessionSummary | null,
): DesktopManagedLocalRouteState {
  if (sessionIsOpen(localSession)) {
    return 'open';
  }
  if (sessionIsOpening(localSession)) {
    return 'opening';
  }
  return managedEnvironmentSupportsLocalHosting(environment) ? 'ready' : 'unavailable';
}

function managedLocalRuntimeState(
  environment: DesktopManagedEnvironment,
  localSession: DesktopSessionSummary | null,
): DesktopManagedLocalRuntimeState {
  if (!managedEnvironmentSupportsLocalHosting(environment)) {
    return 'not_running';
  }
  if (localSession?.target.kind === 'managed_environment' && localSession.target.route === 'local_host') {
    return localSession.runtime_lifecycle_owner === 'external'
      ? 'running_external'
      : 'running_desktop';
  }
  const currentRuntime = environment.local_hosting?.current_runtime;
  if (!currentRuntime?.local_ui_url) {
    return 'not_running';
  }
  return currentRuntime.desktop_managed === true ? 'running_desktop' : 'running_external';
}

function managedLocalRuntimeURL(
  environment: DesktopManagedEnvironment,
  localSession: DesktopSessionSummary | null,
): string {
  if (localSession?.target.kind === 'managed_environment' && localSession.target.route === 'local_host') {
    return compact(localSession.entry_url) || compact(localSession.startup?.local_ui_url);
  }
  return compact(environment.local_hosting?.current_runtime?.local_ui_url);
}

function managedLocalCloseBehavior(
  environment: DesktopManagedEnvironment,
  runtimeState: DesktopManagedLocalRuntimeState,
): DesktopManagedLocalCloseBehavior {
  if (!managedEnvironmentSupportsLocalHosting(environment)) {
    return 'not_applicable';
  }
  return runtimeState === 'running_external' ? 'detaches' : 'stops_runtime';
}

function managedEnvironmentOpenActionLabel(input: Readonly<{
  isOpen: boolean;
  isOpening: boolean;
  defaultRoute: DesktopManagedEnvironmentRoute;
  localRuntimeState: DesktopManagedLocalRuntimeState;
}>): DesktopEnvironmentEntry['open_action_label'] {
  if (input.isOpen) {
    return 'Focus';
  }
  if (input.isOpening) {
    return 'Opening…';
  }
  if (input.defaultRoute === 'local_host' && input.localRuntimeState !== 'not_running') {
    return 'Attach';
  }
  return 'Open';
}

function managedRemoteRouteDetails(
  environment: DesktopManagedEnvironment,
  controlPlanes: readonly DesktopControlPlaneSummary[],
): Readonly<{
  providerEnvironment: DesktopControlPlaneSummary['environments'][number] | null;
  remoteRouteState: DesktopProviderRemoteRouteState;
  remoteCatalogFreshness: DesktopProviderCatalogFreshness;
  remoteStateReason: string;
}> {
  if (!managedEnvironmentSupportsRemoteDesktop(environment)) {
    return {
      providerEnvironment: null,
      remoteRouteState: 'unknown',
      remoteCatalogFreshness: 'unknown',
      remoteStateReason: '',
    };
  }

  const providerOrigin = managedEnvironmentProviderOrigin(environment);
  const providerID = managedEnvironmentProviderID(environment);
  const envPublicID = managedEnvironmentPublicID(environment);
  const controlPlane = controlPlaneSummaryByIdentity(controlPlanes, providerOrigin, providerID);
  if (!controlPlane) {
    return {
      providerEnvironment: null,
      remoteRouteState: 'auth_required',
      remoteCatalogFreshness: 'unknown',
      remoteStateReason: 'Reconnect this Control Plane in Desktop to restore remote access.',
    };
  }

  const providerEnvironment = controlPlaneEnvironmentSummary(
    controlPlanes,
    providerOrigin,
    providerID,
    envPublicID,
  );
  const remoteRouteState = desktopProviderRemoteRouteState({
    syncState: controlPlane.sync_state,
    environmentPresent: providerEnvironment !== null,
    providerStatus: providerEnvironment?.status,
    providerLifecycleStatus: providerEnvironment?.lifecycle_status,
    lastSyncedAtMS: controlPlane.last_synced_at_ms,
  });
  const remoteCatalogFreshness = controlPlane.catalog_freshness;
  const remoteStateReason = (() => {
    switch (remoteRouteState) {
      case 'ready':
        return 'Remote Desktop is ready.';
      case 'offline':
        return 'The provider currently reports this environment as offline.';
      case 'stale':
        return 'Remote status is stale. Refresh the provider to confirm the current state.';
      case 'removed':
        return 'This environment is no longer published by the provider.';
      case 'auth_required':
        return 'Reconnect this Control Plane in your browser to restore access.';
      case 'provider_unreachable':
        return 'Desktop could not refresh this provider from the current machine.';
      case 'provider_invalid':
        return 'The provider returned an invalid response while Desktop refreshed status.';
      default:
        return 'Remote status is not yet confirmed.';
    }
  })();

  return {
    providerEnvironment,
    remoteRouteState,
    remoteCatalogFreshness,
    remoteStateReason,
  };
}

function buildManagedEnvironmentEntry(
  environment: DesktopManagedEnvironment,
  openSessions: Readonly<Partial<Record<DesktopManagedEnvironmentRoute, DesktopSessionSummary>>>,
  controlPlanes: readonly DesktopControlPlaneSummary[],
): DesktopEnvironmentEntry {
  const localSession = openSessions.local_host ?? null;
  const isOpen = sessionIsOpen(localSession);
  const isOpening = sessionIsOpening(localSession);
  const access = managedEnvironmentLocalAccess(environment);
  const kind = managedEnvironmentKind(environment);
  const providerOrigin = managedEnvironmentProviderOrigin(environment);
  const providerID = managedEnvironmentProviderID(environment);
  const envPublicID = managedEnvironmentPublicID(environment);
  const localRuntimeState = managedLocalRuntimeState(environment, localSession);
  const localRuntimeURL = managedLocalRuntimeURL(environment, localSession);
  const localCloseBehavior = managedLocalCloseBehavior(environment, localRuntimeState);
  const localRouteState = managedLocalRouteState(environment, localSession);
  const remoteRoute = kind === 'controlplane'
    ? managedRemoteRouteDetails(environment, controlPlanes)
    : {
      providerEnvironment: null,
      remoteRouteState: 'unknown' as DesktopProviderRemoteRouteState,
      remoteCatalogFreshness: 'unknown' as DesktopProviderCatalogFreshness,
      remoteStateReason: '',
    };
  const remoteEnvironmentURL = kind === 'controlplane'
    ? String(remoteRoute.providerEnvironment?.environment_url ?? '').trim()
    : '';
  const providerIdentitySummary = kind === 'controlplane'
    ? [providerOrigin, envPublicID].filter(Boolean).join(' / ')
    : '';
  return {
    id: environment.id,
    kind: 'managed_environment',
    label: environment.label,
    local_ui_url: localSession?.entry_url ?? localSession?.startup?.local_ui_url ?? localRuntimeURL,
    secondary_text: kind === 'local'
      ? access.local_ui_bind
      : [access.local_ui_bind, remoteEnvironmentURL || providerIdentitySummary].filter(Boolean).join(' · '),
    managed_environment_kind: kind,
    managed_local_scope_kind: environment.local_hosting?.scope.kind,
    managed_environment_name: managedEnvironmentLocalName(environment),
    managed_local_ui_bind: access.local_ui_bind,
    managed_local_ui_password_configured: access.local_ui_password_configured,
    managed_local_owner: environment.local_hosting?.owner,
    managed_local_runtime_state: localRuntimeState,
    managed_local_runtime_url: localRuntimeURL || undefined,
    managed_local_close_behavior: localCloseBehavior,
    managed_has_local_hosting: true,
    managed_has_remote_desktop: false,
    managed_preferred_open_route: 'local_host',
    default_open_route: 'local_host',
    open_local_session_key: localSession?.session_key,
    open_local_session_lifecycle: sessionLifecycle(localSession),
    provider_origin: kind === 'controlplane' ? providerOrigin : undefined,
    provider_id: kind === 'controlplane' ? providerID : undefined,
    env_public_id: kind === 'controlplane' ? envPublicID : undefined,
    remote_environment_url: kind === 'controlplane' ? (remoteEnvironmentURL || undefined) : undefined,
    provider_status: remoteRoute.providerEnvironment?.status,
    provider_lifecycle_status: remoteRoute.providerEnvironment?.lifecycle_status,
    provider_last_seen_at_unix_ms: remoteRoute.providerEnvironment?.last_seen_at_unix_ms,
    control_plane_sync_state: kind === 'controlplane'
      ? controlPlaneSummaryByIdentity(controlPlanes, providerOrigin, providerID)?.sync_state
      : undefined,
    local_route_state: localRouteState,
    remote_route_state: kind === 'controlplane' ? remoteRoute.remoteRouteState : undefined,
    remote_catalog_freshness: kind === 'controlplane' ? remoteRoute.remoteCatalogFreshness : undefined,
    remote_state_reason: kind === 'controlplane' ? remoteRoute.remoteStateReason : undefined,
    pinned: environment.pinned,
    control_plane_label: kind === 'controlplane'
      ? controlPlaneSummaryByIdentity(controlPlanes, providerOrigin, providerID)?.display_label
      : undefined,
    tag: isOpen ? 'Open' : 'Managed',
    category: 'managed',
    is_open: isOpen,
    is_opening: isOpening,
    open_session_key: localSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(localSession),
    open_action_label: managedEnvironmentOpenActionLabel({
      isOpen,
      isOpening,
      defaultRoute: 'local_host',
      localRuntimeState,
    }),
    can_edit: true,
    can_delete: !isDefaultLocalManagedEnvironment(environment),
    can_save: false,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function buildProviderEnvironmentEntry(
  preferences: DesktopPreferences,
  controlPlane: DesktopControlPlaneSummary,
  providerEnvironment: DesktopControlPlaneSummary['environments'][number],
  openSessions: readonly DesktopSessionSummary[],
): DesktopEnvironmentEntry {
  const remoteSession = openSessionByProviderEnvironment(
    openSessions,
    controlPlane.provider.provider_origin,
    providerEnvironment.env_public_id,
  );
  const localServeEnvironment = preferences.managed_environments.find((environment) => (
    managedEnvironmentProviderOrigin(environment) === controlPlane.provider.provider_origin
    && managedEnvironmentProviderID(environment) === controlPlane.provider.provider_id
    && managedEnvironmentPublicID(environment) === providerEnvironment.env_public_id
  )) ?? null;
  const preference = providerEnvironmentPreference(
    preferences,
    controlPlane.provider.provider_origin,
    controlPlane.provider.provider_id,
    providerEnvironment.env_public_id,
  );
  const remoteRouteState = desktopProviderRemoteRouteState({
    syncState: controlPlane.sync_state,
    environmentPresent: true,
    providerStatus: providerEnvironment.status,
    providerLifecycleStatus: providerEnvironment.lifecycle_status,
    lastSyncedAtMS: controlPlane.last_synced_at_ms,
  });
  const remoteStateReason = (() => {
    switch (remoteRouteState) {
      case 'ready':
        return 'Remote Desktop is ready.';
      case 'offline':
        return 'The provider currently reports this environment as offline.';
      case 'stale':
        return 'Remote status is stale. Refresh the provider to confirm the current state.';
      case 'removed':
        return 'This environment is no longer published by the provider.';
      case 'auth_required':
        return 'Reconnect this Control Plane in your browser to restore access.';
      case 'provider_unreachable':
        return 'Desktop could not refresh this provider from the current machine.';
      case 'provider_invalid':
        return 'The provider returned an invalid response while Desktop refreshed status.';
      default:
        return 'Remote status is not yet confirmed.';
    }
  })();
  const localServeSessions: Readonly<Partial<Record<DesktopManagedEnvironmentRoute, DesktopSessionSummary>>> = localServeEnvironment
    ? openSessionsByManagedEnvironment(openSessions, localServeEnvironment)
    : {};
  const localServeSession = localServeSessions.local_host ?? null;
  const localServeAccess = localServeEnvironment ? managedEnvironmentLocalAccess(localServeEnvironment) : null;
  const localServeRuntimeState = localServeEnvironment
    ? managedLocalRuntimeState(localServeEnvironment, localServeSession)
    : 'not_running';
  const localServeRuntimeURL = localServeEnvironment
    ? managedLocalRuntimeURL(localServeEnvironment, localServeSession)
    : '';
  const localServeCloseBehavior = localServeEnvironment
    ? managedLocalCloseBehavior(localServeEnvironment, localServeRuntimeState)
    : 'not_applicable';
  const localServeSessionOpen = sessionIsOpen(localServeSession);
  const remoteSessionOpen = sessionIsOpen(remoteSession);
  const localServeSessionOpening = sessionIsOpening(localServeSession);
  const remoteSessionOpening = sessionIsOpening(remoteSession);
  return {
    id: desktopManagedControlPlaneEnvironmentID(
      controlPlane.provider.provider_origin,
      providerEnvironment.env_public_id,
    ),
    kind: 'provider_environment',
    label: providerEnvironment.label,
    local_ui_url: localServeRuntimeURL
      || remoteSession?.entry_url
      || remoteSession?.startup?.local_ui_url
      || providerEnvironment.environment_url
      || '',
    secondary_text: providerEnvironment.environment_url
      || [controlPlane.display_label, providerEnvironment.env_public_id].filter(Boolean).join(' / '),
    open_local_session_key: localServeSession?.session_key,
    open_local_session_lifecycle: sessionLifecycle(localServeSession),
    provider_local_ui_bind: localServeAccess?.local_ui_bind,
    provider_local_ui_password_configured: localServeAccess?.local_ui_password_configured,
    provider_local_owner: localServeEnvironment?.local_hosting?.owner,
    provider_local_runtime_state: localServeRuntimeState,
    provider_local_runtime_url: localServeRuntimeURL || undefined,
    provider_local_close_behavior: localServeCloseBehavior,
    provider_origin: controlPlane.provider.provider_origin,
    provider_id: controlPlane.provider.provider_id,
    env_public_id: providerEnvironment.env_public_id,
    remote_environment_url: providerEnvironment.environment_url,
    provider_status: providerEnvironment.status,
    provider_lifecycle_status: providerEnvironment.lifecycle_status,
    provider_last_seen_at_unix_ms: providerEnvironment.last_seen_at_unix_ms,
    control_plane_sync_state: controlPlane.sync_state,
    remote_route_state: remoteRouteState,
    remote_catalog_freshness: controlPlane.catalog_freshness,
    remote_state_reason: remoteStateReason,
    provider_local_serve_environment_id: localServeEnvironment?.id,
    provider_local_serve_state: localServeEnvironment
      ? localServeSessionOpen
        ? 'open'
        : localServeSessionOpening
          ? 'opening'
          : 'saved'
      : 'absent',
    pinned: preference?.pinned ?? false,
    control_plane_label: controlPlane.display_label,
    tag: localServeSessionOpen || remoteSessionOpen ? 'Open' : 'Managed',
    category: 'provider',
    is_open: localServeSessionOpen || remoteSessionOpen,
    is_opening: localServeSessionOpening || remoteSessionOpening,
    open_remote_session_key: remoteSession?.session_key,
    open_remote_session_lifecycle: sessionLifecycle(remoteSession),
    open_session_key: remoteSession?.session_key ?? localServeSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(remoteSession ?? localServeSession),
    open_action_label: localServeSessionOpen
      ? 'Focus'
      : sessionIsOpen(remoteSession)
      ? 'Focus'
      : localServeSessionOpening || sessionIsOpening(remoteSession)
        ? 'Opening…'
        : 'Open',
    can_edit: false,
    can_delete: false,
    can_save: false,
    last_used_at_ms: preference?.last_used_at_ms ?? 0,
  };
}

function buildEnvironmentEntries(
  preferences: DesktopPreferences,
  controlPlanes: readonly DesktopControlPlaneSummary[],
  openSessions: readonly DesktopSessionSummary[],
): readonly DesktopEnvironmentEntry[] {
  const openRemoteSessions = openSessions.filter((session) => session.target.kind === 'external_local_ui');
  const openSSHSessions = openSessions.filter((session) => session.target.kind === 'ssh_environment');
  const entries: DesktopEnvironmentEntry[] = [
    ...preferences.managed_environments.map((environment) => (
      buildManagedEnvironmentEntry(
        environment,
        openSessionsByManagedEnvironment(openSessions, environment),
        controlPlanes,
      )
    )),
    ...controlPlanes.flatMap((controlPlane) => controlPlane.environments.map((providerEnvironment) => (
      buildProviderEnvironmentEntry(preferences, controlPlane, providerEnvironment, openSessions)
    ))),
  ];

  const catalog = preferences.saved_environments;
  const sshCatalog = preferences.saved_ssh_environments;
  const seenRemoteURLs = new Set<string>();

  for (const session of openRemoteSessions) {
    const entryURL = session.entry_url ?? session.startup?.local_ui_url ?? '';
    if (seenRemoteURLs.has(entryURL)) {
      continue;
    }
    seenRemoteURLs.add(entryURL);
  }

  for (const session of openRemoteSessions) {
    const localUIURL = session.entry_url ?? session.startup?.local_ui_url ?? '';
    if (catalog.some((environment) => environment.local_ui_url === localUIURL)) {
      continue;
    }
    const isOpen = session.lifecycle === 'open';
    const isOpening = session.lifecycle === 'opening';
    entries.push({
      id: desktopEnvironmentID(localUIURL),
      kind: 'external_local_ui',
      label: session.target.label || defaultSavedEnvironmentLabel(localUIURL),
      local_ui_url: localUIURL,
      secondary_text: localUIURL,
      pinned: false,
      tag: isOpen ? 'Open' : '',
      category: 'open_unsaved',
      is_open: isOpen,
      is_opening: isOpening,
      open_session_key: session.session_key,
      open_session_lifecycle: session.lifecycle,
      open_action_label: isOpen ? 'Focus' : isOpening ? 'Opening…' : 'Open',
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
    const isOpen = session.lifecycle === 'open';
    const isOpening = session.lifecycle === 'opening';
    entries.push({
      id: desktopSSHEnvironmentID(target),
      kind: 'ssh_environment',
      label: target.label || defaultSavedSSHEnvironmentLabel(target),
      local_ui_url: session.entry_url ?? session.startup?.local_ui_url ?? '',
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
      pinned: false,
      tag: isOpen ? 'Open' : '',
      category: 'open_unsaved',
      is_open: isOpen,
      is_opening: isOpening,
      open_session_key: session.session_key,
      open_session_lifecycle: session.lifecycle,
      open_action_label: isOpen ? 'Focus' : isOpening ? 'Opening…' : 'Open',
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
  const isOpen = sessionIsOpen(openSession);
  const isOpening = sessionIsOpening(openSession);
  return {
    id: environment.id,
    kind: 'external_local_ui',
    label: environment.label,
    local_ui_url: environment.local_ui_url,
    secondary_text: environment.local_ui_url,
    pinned: environment.pinned,
    tag: isOpen ? 'Open' : environment.source === 'recent_auto' ? 'Recent' : 'Saved',
    category: environment.source,
    is_open: isOpen,
    is_opening: isOpening,
    open_session_key: openSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(openSession),
    open_action_label: isOpen ? 'Focus' : isOpening ? 'Opening…' : 'Open',
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
  const isOpen = sessionIsOpen(openSession);
  const isOpening = sessionIsOpening(openSession);
  return {
    id: environment.id,
    kind: 'ssh_environment',
    label: environment.label,
    local_ui_url: openSession?.entry_url ?? openSession?.startup?.local_ui_url ?? '',
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
    pinned: environment.pinned,
    tag: isOpen ? 'Open' : environment.source === 'recent_auto' ? 'Recent' : 'Saved',
    category: environment.source,
    is_open: isOpen,
    is_opening: isOpening,
    open_session_key: openSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(openSession),
    open_action_label: isOpen ? 'Focus' : isOpening ? 'Opening…' : 'Open',
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
  const controlPlanes = args.controlPlanes ?? fallbackControlPlaneSummaries(preferences.control_planes);
  const openSessions = sortOpenSessions(args.openSessions ?? []);
  const issue = args.issue ?? null;
  const surface = args.surface ?? 'connect_environment';
  const environments = buildEnvironmentEntries(preferences, controlPlanes, openSessions);
  const selectedManagedEnvironment = (
    findManagedEnvironmentByID(preferences, args.selectedManagedEnvironmentID ?? '')
    ?? preferences.managed_environments.find((environment) => Boolean(environment.local_hosting))
    ?? preferences.managed_environments[0]
    ?? createManagedLocalEnvironment('default')
  );
  const managedSessions = openSessionsByManagedEnvironment(openSessions, selectedManagedEnvironment);
  const managedSession = (
    (managedEnvironmentDefaultOpenRoute(selectedManagedEnvironment) === 'remote_desktop'
      ? managedSessions.remote_desktop ?? managedSessions.local_host
      : managedSessions.local_host ?? managedSessions.remote_desktop)
    ?? null
  );

  return {
    surface,
    entry_reason: args.entryReason ?? 'app_launch',
    close_action_label: openSessions.length > 0 ? 'Close Launcher' : 'Quit',
    open_windows: buildOpenEnvironmentWindows(openSessions),
    environments,
    control_planes: controlPlanes,
    suggested_remote_url: suggestedRemoteURL(issue, openSessions, environments),
    issue,
    settings_surface: buildDesktopSettingsSurfaceSnapshot('managed_environment_settings', desktopPreferencesToDraft(preferences, selectedManagedEnvironment.id), {
      environment_id: selectedManagedEnvironment.id,
      environment_label: selectedManagedEnvironment.label,
      environment_kind: managedEnvironmentKind(selectedManagedEnvironment),
      current_runtime_url: managedSession?.entry_url ?? managedSession?.startup?.local_ui_url ?? '',
      local_ui_password_configured: managedEnvironmentLocalAccess(selectedManagedEnvironment).local_ui_password_configured,
      runtime_password_required: managedSession?.startup?.password_required === true,
    }),
  };
}
