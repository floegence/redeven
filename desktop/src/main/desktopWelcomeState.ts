import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import {
  desktopPreferencesToDraft,
  findManagedEnvironmentByID,
  findProviderEnvironmentByID,
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
  DesktopLocalEnvironmentStateRoute,
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
  isDefaultDesktopLocalEnvironmentState,
  localEnvironmentStateKind,
  localEnvironmentAccess,
  localEnvironmentName,
  localEnvironmentDefaultOpenRoute,
  localEnvironmentProviderID,
  localEnvironmentProviderOrigin,
  localEnvironmentPublicID,
  localEnvironmentSupportsLocalHosting,
  localEnvironmentSupportsRemoteDesktop,
  type DesktopLocalEnvironmentState,
} from '../shared/desktopLocalEnvironmentState';
import type { DesktopProviderEnvironmentRecord } from '../shared/desktopProviderEnvironment';
import {
  desktopProviderCatalogFreshness,
  desktopProviderRemoteRouteState,
  type DesktopManagedLocalRouteState,
  type DesktopProviderCatalogFreshness,
  type DesktopProviderRemoteRouteState,
} from '../shared/providerEnvironmentState';
import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import {
  normalizeRuntimeServiceSnapshot,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';

export type BuildDesktopWelcomeSnapshotArgs = Readonly<{
  preferences: DesktopPreferences;
  controlPlanes?: readonly DesktopControlPlaneSummary[];
  openSessions?: readonly DesktopSessionSummary[];
  savedExternalRuntimeHealth?: Readonly<Record<string, DesktopRuntimeHealth>>;
  savedSSHRuntimeHealth?: Readonly<Record<string, DesktopRuntimeHealth>>;
  actionProgress?: DesktopWelcomeSnapshot['action_progress'];
  surface?: DesktopLauncherSurface;
  entryReason?: DesktopWelcomeEntryReason;
  issue?: DesktopWelcomeIssue | null;
  selectedEnvironmentID?: string;
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
      `ssh auth mode: ${details.auth_mode}`,
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
        return 'Provider configuration is invalid';
      }
      if (code === 'provider_tls_untrusted') {
        return 'Trust the provider certificate';
      }
      if (code === 'provider_dns_failed' || code === 'provider_connection_failed' || code === 'provider_timeout') {
        return 'Provider is unreachable';
      }
      if (code === 'provider_invalid_json' || code === 'provider_invalid_response') {
        return 'Provider returned an invalid response';
      }
      return 'Unable to use that provider';
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
  if (report.code === 'startup_invalid') {
    return {
      scope: 'startup',
      code: report.code,
      title: 'Local Environment startup needs a setting',
      message: report.message,
      diagnostics_copy: formatBlockedLaunchDiagnostics(report),
      target_url: '',
    };
  }
  if (report.code === 'startup_failed') {
    return {
      scope: 'startup',
      code: report.code,
      title: 'Local Environment startup failed',
      message: report.message,
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

function environmentWindowState(
  session: DesktopSessionSummary | null | undefined,
): DesktopEnvironmentEntry['window_state'] {
  if (session?.lifecycle === 'open') {
    return 'open';
  }
  if (session?.lifecycle === 'opening') {
    return 'opening';
  }
  return 'closed';
}

function onlineRuntimeHealth(
  source: DesktopRuntimeHealth['source'],
  localUIURL: string,
  runtimeService?: RuntimeServiceSnapshot | null,
): DesktopRuntimeHealth {
  return {
    status: 'online',
    checked_at_unix_ms: Date.now(),
    source,
    local_ui_url: compact(localUIURL) || undefined,
    runtime_service: normalizeRuntimeServiceSnapshot(runtimeService ?? {}),
  };
}

function offlineRuntimeHealth(
  source: DesktopRuntimeHealth['source'],
  offlineReasonCode: NonNullable<DesktopRuntimeHealth['offline_reason_code']>,
  offlineReason: string,
): DesktopRuntimeHealth {
  return {
    status: 'offline',
    checked_at_unix_ms: Date.now(),
    source,
    offline_reason_code: offlineReasonCode,
    offline_reason: offlineReason,
  };
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
  environment: DesktopLocalEnvironmentState,
): Readonly<Partial<Record<DesktopLocalEnvironmentStateRoute, DesktopSessionSummary>>> {
  const out: Partial<Record<DesktopLocalEnvironmentStateRoute, DesktopSessionSummary>> = {};
  for (const session of sessions) {
    if (session.target.kind !== 'managed_environment' || session.target.environment_id !== environment.id) {
      continue;
    }
    out[session.target.route] = session;
  }
  return out;
}

function openSessionsByProviderEnvironment(
  sessions: readonly DesktopSessionSummary[],
  environment: DesktopProviderEnvironmentRecord,
): Readonly<Partial<Record<DesktopLocalEnvironmentStateRoute, DesktopSessionSummary>>> {
  const out: Partial<Record<DesktopLocalEnvironmentStateRoute, DesktopSessionSummary>> = {};
  for (const session of sessions) {
    if (session.target.kind !== 'managed_environment') {
      continue;
    }
    const matchesProviderIdentity = (
      session.target.provider_origin === environment.provider_origin
      && session.target.provider_id === environment.provider_id
      && session.target.env_public_id === environment.env_public_id
    );
    if (!matchesProviderIdentity && session.target.environment_id !== environment.id) {
      continue;
    }
    out[session.target.route] = session;
  }
  return out;
}

function providerRuntimeBindingMatches(
  environment: DesktopProviderEnvironmentRecord,
  runtime: Readonly<{
    controlplane_base_url?: string;
    controlplane_provider_id?: string;
    env_public_id?: string;
  }> | null | undefined,
): boolean {
  return Boolean(
    runtime
    && compact(runtime.controlplane_base_url) === environment.provider_origin
    && compact(runtime.controlplane_provider_id) === environment.provider_id
    && compact(runtime.env_public_id) === environment.env_public_id,
  );
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
  environment: DesktopLocalEnvironmentState,
  localSession: DesktopSessionSummary | null,
): DesktopManagedLocalRouteState {
  if (sessionIsOpen(localSession)) {
    return 'open';
  }
  if (sessionIsOpening(localSession)) {
    return 'opening';
  }
  return localEnvironmentSupportsLocalHosting(environment) ? 'ready' : 'unavailable';
}

function managedLocalRuntimeState(
  environment: DesktopLocalEnvironmentState,
  localSession: DesktopSessionSummary | null,
): DesktopManagedLocalRuntimeState {
  if (!localEnvironmentSupportsLocalHosting(environment)) {
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
  environment: DesktopLocalEnvironmentState,
  localSession: DesktopSessionSummary | null,
): string {
  if (localSession?.target.kind === 'managed_environment' && localSession.target.route === 'local_host') {
    return compact(localSession.entry_url) || compact(localSession.startup?.local_ui_url);
  }
  return compact(environment.local_hosting?.current_runtime?.local_ui_url);
}

function managedRuntimeService(
  environment: DesktopLocalEnvironmentState,
  localSession: DesktopSessionSummary | null,
): DesktopEnvironmentEntry['managed_runtime_service'] {
  if (localSession?.target.kind === 'managed_environment' && localSession.target.route === 'local_host') {
    return localSession.startup?.runtime_service;
  }
  return environment.local_hosting?.current_runtime?.runtime_service;
}

function runtimeServiceFromHealth(health: DesktopRuntimeHealth | undefined): RuntimeServiceSnapshot | undefined {
  return health?.runtime_service ? normalizeRuntimeServiceSnapshot(health.runtime_service) : undefined;
}

function preferredRuntimeService(
  primary: RuntimeServiceSnapshot | undefined,
  health: DesktopRuntimeHealth | null | undefined,
): RuntimeServiceSnapshot | undefined {
  const snapshot = primary ?? runtimeServiceFromHealth(health ?? undefined);
  return snapshot ? normalizeRuntimeServiceSnapshot(snapshot) : undefined;
}

function managedLocalCloseBehavior(
  environment: DesktopLocalEnvironmentState,
  runtimeState: DesktopManagedLocalRuntimeState,
): DesktopManagedLocalCloseBehavior {
  if (!localEnvironmentSupportsLocalHosting(environment)) {
    return 'not_applicable';
  }
  return runtimeState === 'running_external' ? 'detaches' : 'stops_runtime';
}

function managedEnvironmentRuntimeHealth(
  runtimeState: DesktopManagedLocalRuntimeState,
  localRuntimeURL: string,
  runtimeService?: RuntimeServiceSnapshot,
): DesktopRuntimeHealth {
  if (runtimeState === 'running_desktop' || runtimeState === 'running_external') {
    return onlineRuntimeHealth('local_runtime_probe', localRuntimeURL, runtimeService);
  }
  return offlineRuntimeHealth('local_runtime_probe', 'not_started', 'Serve the runtime first');
}

function providerEnvironmentRuntimeHealth(
  environment: DesktopControlPlaneSummary['environments'][number],
): DesktopRuntimeHealth {
  const providerHealth = environment.runtime_health;
  if (providerHealth?.runtime_status === 'online') {
    return {
      status: 'online',
      checked_at_unix_ms: providerHealth.observed_at_unix_ms || Date.now(),
      source: 'provider_batch_probe',
      local_ui_url: compact(environment.environment_url) || undefined,
    };
  }
  return {
    status: 'offline',
    checked_at_unix_ms: providerHealth?.observed_at_unix_ms || Date.now(),
    source: 'provider_batch_probe',
    offline_reason_code: (providerHealth?.offline_reason_code as DesktopRuntimeHealth['offline_reason_code']) || 'provider_unavailable',
    offline_reason: providerHealth?.offline_reason || 'The runtime offline / unavailable',
  };
}

function managedEnvironmentOpenActionLabel(input: Readonly<{
  isOpen: boolean;
  isOpening: boolean;
}>): DesktopEnvironmentEntry['open_action_label'] {
  if (input.isOpen) {
    return 'Focus';
  }
  if (input.isOpening) {
    return 'Opening…';
  }
  return 'Open';
}

function managedRemoteRouteDetails(
  environment: DesktopLocalEnvironmentState,
  controlPlanes: readonly DesktopControlPlaneSummary[],
): Readonly<{
  providerEnvironment: DesktopControlPlaneSummary['environments'][number] | null;
  remoteRouteState: DesktopProviderRemoteRouteState;
  remoteCatalogFreshness: DesktopProviderCatalogFreshness;
  remoteStateReason: string;
}> {
  if (!localEnvironmentSupportsRemoteDesktop(environment)) {
    return {
      providerEnvironment: null,
      remoteRouteState: 'unknown',
      remoteCatalogFreshness: 'unknown',
      remoteStateReason: '',
    };
  }

  const providerOrigin = localEnvironmentProviderOrigin(environment);
  const providerID = localEnvironmentProviderID(environment);
  const envPublicID = localEnvironmentPublicID(environment);
  const controlPlane = controlPlaneSummaryByIdentity(controlPlanes, providerOrigin, providerID);
  if (!controlPlane) {
    return {
      providerEnvironment: null,
      remoteRouteState: 'auth_required',
      remoteCatalogFreshness: 'unknown',
      remoteStateReason: 'Reconnect this provider in Desktop to restore remote access.',
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
    providerRuntimeStatus: providerEnvironment?.runtime_health?.runtime_status,
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
        return 'Reconnect this provider in Desktop to restore access.';
      case 'provider_unreachable':
        return 'Desktop could not refresh this provider from this device.';
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
  environment: DesktopLocalEnvironmentState,
  openSessions: Readonly<Partial<Record<DesktopLocalEnvironmentStateRoute, DesktopSessionSummary>>>,
  controlPlanes: readonly DesktopControlPlaneSummary[],
): DesktopEnvironmentEntry {
  const localSession = openSessions.local_host ?? null;
  const isOpen = sessionIsOpen(localSession);
  const isOpening = sessionIsOpening(localSession);
  const access = localEnvironmentAccess(environment);
  const kind = localEnvironmentStateKind(environment);
  const providerOrigin = localEnvironmentProviderOrigin(environment);
  const providerID = localEnvironmentProviderID(environment);
  const envPublicID = localEnvironmentPublicID(environment);
  const localRuntimeState = managedLocalRuntimeState(environment, localSession);
  const localRuntimeURL = managedLocalRuntimeURL(environment, localSession);
  const runtimeService = preferredRuntimeService(managedRuntimeService(environment, localSession), undefined);
  const localCloseBehavior = managedLocalCloseBehavior(environment, localRuntimeState);
  const runtimeHealth = managedEnvironmentRuntimeHealth(localRuntimeState, localRuntimeURL, runtimeService);
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
    managed_environment_name: localEnvironmentName(environment),
    managed_local_ui_bind: access.local_ui_bind,
    managed_local_ui_password_configured: access.local_ui_password_configured,
    managed_local_owner: environment.local_hosting?.owner,
    managed_local_runtime_state: localRuntimeState,
    managed_local_runtime_url: localRuntimeURL || undefined,
    managed_runtime_service: runtimeService,
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
    window_state: environmentWindowState(localSession),
    is_open: isOpen,
    is_opening: isOpening,
    runtime_health: runtimeHealth,
    runtime_service: runtimeService,
    runtime_control_capability: 'start_stop',
    open_session_key: localSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(localSession),
    open_action_label: managedEnvironmentOpenActionLabel({
      isOpen,
      isOpening,
    }),
    can_edit: true,
    can_delete: !isDefaultDesktopLocalEnvironmentState(environment),
    can_save: false,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function providerRemoteStateReason(remoteRouteState: DesktopProviderRemoteRouteState): string {
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
      return 'Reconnect this provider in Desktop to restore remote access.';
    case 'provider_unreachable':
      return 'Desktop could not refresh this provider from this device.';
    case 'provider_invalid':
      return 'The provider returned an invalid response while Desktop refreshed status.';
    default:
      return 'Remote status is not yet confirmed.';
  }
}

function offlineRuntimeHealthForProviderRoute(
  remoteRouteState: DesktopProviderRemoteRouteState,
  remoteStateReason: string,
): DesktopRuntimeHealth {
  switch (remoteRouteState) {
    case 'offline':
      return offlineRuntimeHealth(
        'provider_batch_probe',
        'provider_reported_offline',
        remoteStateReason,
      );
    case 'removed':
      return offlineRuntimeHealth(
        'provider_batch_probe',
        'environment_removed',
        remoteStateReason,
      );
    default:
      return offlineRuntimeHealth(
        'provider_batch_probe',
        'provider_unavailable',
        remoteStateReason || 'The runtime offline / unavailable',
      );
  }
}

function providerEnvironmentRouteDetails(
  environment: DesktopProviderEnvironmentRecord,
  controlPlanes: readonly DesktopControlPlaneSummary[],
): Readonly<{
  controlPlane: DesktopControlPlaneSummary | null;
  providerEnvironment: DesktopControlPlaneSummary['environments'][number] | null;
  remoteRouteState: DesktopProviderRemoteRouteState;
  remoteCatalogFreshness: DesktopProviderCatalogFreshness;
  remoteStateReason: string;
}> {
  const controlPlane = controlPlaneSummaryByIdentity(
    controlPlanes,
    environment.provider_origin,
    environment.provider_id,
  );
  const providerEnvironment = controlPlaneEnvironmentSummary(
    controlPlanes,
    environment.provider_origin,
    environment.provider_id,
    environment.env_public_id,
  );
  const remoteRouteState = controlPlane
    ? desktopProviderRemoteRouteState({
      syncState: controlPlane.sync_state,
      environmentPresent: providerEnvironment !== null,
      providerRuntimeStatus: providerEnvironment?.runtime_health?.runtime_status,
      providerStatus: providerEnvironment?.status,
      providerLifecycleStatus: providerEnvironment?.lifecycle_status,
      lastSyncedAtMS: controlPlane.last_synced_at_ms,
    })
    : 'auth_required';
  return {
    controlPlane,
    providerEnvironment,
    remoteRouteState,
    remoteCatalogFreshness: controlPlane?.catalog_freshness ?? 'unknown',
    remoteStateReason: providerRemoteStateReason(remoteRouteState),
  };
}

function providerLocalRouteState(
  environment: DesktopProviderEnvironmentRecord,
  localEnvironment: DesktopLocalEnvironmentState,
  localSession: DesktopSessionSummary | null,
): DesktopManagedLocalRouteState {
  if (localSession && providerRuntimeBindingMatches(environment, localSession.startup)) {
    if (sessionIsOpen(localSession)) {
      return 'open';
    }
    if (sessionIsOpening(localSession)) {
      return 'opening';
    }
  }
  return localEnvironmentSupportsLocalHosting(localEnvironment) ? 'ready' : 'unavailable';
}

function providerLocalRuntimeState(
  environment: DesktopProviderEnvironmentRecord,
  localEnvironment: DesktopLocalEnvironmentState,
  localSession: DesktopSessionSummary | null,
): DesktopManagedLocalRuntimeState {
  if (localSession?.target.kind === 'managed_environment'
    && localSession.target.route === 'local_host'
    && providerRuntimeBindingMatches(environment, localSession.startup)) {
    return localSession.runtime_lifecycle_owner === 'external'
      ? 'running_external'
      : 'running_desktop';
  }
  const currentRuntime = localEnvironment.local_hosting?.current_runtime;
  if (!providerRuntimeBindingMatches(environment, currentRuntime) || !currentRuntime?.local_ui_url) {
    return 'not_running';
  }
  return currentRuntime.desktop_managed === true ? 'running_desktop' : 'running_external';
}

function providerLocalRuntimeURL(
  environment: DesktopProviderEnvironmentRecord,
  localEnvironment: DesktopLocalEnvironmentState,
  localSession: DesktopSessionSummary | null,
): string {
  if (localSession?.target.kind === 'managed_environment'
    && localSession.target.route === 'local_host'
    && providerRuntimeBindingMatches(environment, localSession.startup)) {
    return compact(localSession.entry_url) || compact(localSession.startup?.local_ui_url);
  }
  const currentRuntime = localEnvironment.local_hosting?.current_runtime;
  return providerRuntimeBindingMatches(environment, currentRuntime)
    ? compact(currentRuntime?.local_ui_url)
    : '';
}

function providerRuntimeService(
  environment: DesktopProviderEnvironmentRecord,
  localEnvironment: DesktopLocalEnvironmentState,
  localSession: DesktopSessionSummary | null,
): DesktopEnvironmentEntry['provider_runtime_service'] {
  if (localSession?.target.kind === 'managed_environment'
    && localSession.target.route === 'local_host'
    && providerRuntimeBindingMatches(environment, localSession.startup)) {
    return localSession.startup?.runtime_service;
  }
  const currentRuntime = localEnvironment.local_hosting?.current_runtime;
  return providerRuntimeBindingMatches(environment, currentRuntime)
    ? currentRuntime?.runtime_service
    : undefined;
}

function providerLocalCloseBehavior(
  _environment: DesktopProviderEnvironmentRecord,
  runtimeState: DesktopManagedLocalRuntimeState,
): DesktopManagedLocalCloseBehavior {
  return runtimeState === 'running_external' ? 'detaches' : 'stops_runtime';
}

function defaultProviderOpenRoute(
  environment: DesktopProviderEnvironmentRecord,
  localRouteState: DesktopManagedLocalRouteState,
  remoteRouteState: DesktopProviderRemoteRouteState,
): DesktopLocalEnvironmentStateRoute {
  if (
    environment.preferred_open_route === 'local_host'
    && localRouteState !== 'unavailable'
  ) {
    return 'local_host';
  }
  if (
    environment.preferred_open_route === 'remote_desktop'
    && remoteRouteState === 'ready'
  ) {
    return 'remote_desktop';
  }
  if (localRouteState !== 'unavailable') {
    return 'local_host';
  }
  return 'remote_desktop';
}

function buildProviderEnvironmentEntry(
  environment: DesktopProviderEnvironmentRecord,
  controlPlanes: readonly DesktopControlPlaneSummary[],
  openSessions: readonly DesktopSessionSummary[],
  localEnvironment: DesktopLocalEnvironmentState,
): DesktopEnvironmentEntry {
  const sessions = openSessionsByProviderEnvironment(openSessions, environment);
  const localSession = sessions.local_host ?? null;
  const remoteSession = sessions.remote_desktop ?? null;
  const routeDetails = providerEnvironmentRouteDetails(environment, controlPlanes);
  const localAccess = localEnvironmentAccess(localEnvironment);
  const localRuntimeState = providerLocalRuntimeState(environment, localEnvironment, localSession);
  const localRuntimeURL = providerLocalRuntimeURL(environment, localEnvironment, localSession);
  const runtimeService = providerRuntimeService(environment, localEnvironment, localSession);
  const localCloseBehavior = providerLocalCloseBehavior(environment, localRuntimeState);
  const localRouteState = providerLocalRouteState(environment, localEnvironment, localSession);
  const localRuntimeHealth = managedEnvironmentRuntimeHealth(localRuntimeState, localRuntimeURL, runtimeService);
  const remoteRuntimeHealth = routeDetails.providerEnvironment
    ? providerEnvironmentRuntimeHealth(routeDetails.providerEnvironment)
    : offlineRuntimeHealthForProviderRoute(routeDetails.remoteRouteState, routeDetails.remoteStateReason);
  const defaultOpenRoute = defaultProviderOpenRoute(
    environment,
    localRouteState,
    routeDetails.remoteRouteState,
  );
  const effectiveWindowRoute: DesktopLocalEnvironmentStateRoute | '' = (() => {
    if (sessionIsOpen(localSession) || sessionIsOpening(localSession)) {
      return 'local_host';
    }
    if (sessionIsOpen(remoteSession) || sessionIsOpening(remoteSession)) {
      return 'remote_desktop';
    }
    return '';
  })();
  const effectiveSession = effectiveWindowRoute === 'local_host'
    ? localSession
    : effectiveWindowRoute === 'remote_desktop'
      ? remoteSession
      : null;
  const effectiveRoute = effectiveWindowRoute || defaultOpenRoute;
  const runtimeHealth = localRuntimeHealth?.status === 'online'
    ? localRuntimeHealth
    : remoteRuntimeHealth.status === 'online'
      ? remoteRuntimeHealth
      : localRuntimeHealth ?? remoteRuntimeHealth;
  const remoteEnvironmentURL = compact(routeDetails.providerEnvironment?.environment_url)
    || compact(environment.remote_catalog_entry?.environment_url);
  const controlPlaneLabel = compact(routeDetails.controlPlane?.display_label) || environment.provider_origin;
  const label = compact(routeDetails.providerEnvironment?.label)
    || compact(environment.label)
    || environment.env_public_id;
  const effectiveWindowState = effectiveSession
    ? environmentWindowState(effectiveSession)
    : 'closed';
  return {
    id: environment.id,
    kind: 'provider_environment',
    label,
    local_ui_url: effectiveRoute === 'local_host'
      ? (localSession?.entry_url ?? localSession?.startup?.local_ui_url ?? localRuntimeURL)
      : (remoteSession?.entry_url ?? remoteSession?.startup?.local_ui_url ?? remoteEnvironmentURL ?? localRuntimeURL),
    secondary_text: remoteEnvironmentURL || [controlPlaneLabel, environment.env_public_id].filter(Boolean).join(' / '),
    open_local_session_key: localSession?.session_key,
    open_local_session_lifecycle: sessionLifecycle(localSession),
    open_remote_session_key: remoteSession?.session_key,
    open_remote_session_lifecycle: sessionLifecycle(remoteSession),
    provider_local_ui_bind: localAccess.local_ui_bind,
    provider_local_ui_password_configured: localAccess.local_ui_password_configured,
    provider_local_owner: localEnvironment.local_hosting?.owner,
    provider_preferred_open_route: environment.preferred_open_route,
    provider_default_open_route: defaultOpenRoute,
    provider_effective_window_route: effectiveWindowRoute,
    provider_local_runtime_configured: localEnvironmentSupportsLocalHosting(localEnvironment),
    provider_local_runtime_state: localRuntimeState,
    provider_local_runtime_url: localRuntimeURL || undefined,
    provider_runtime_service: preferredRuntimeService(runtimeService, localRuntimeHealth),
    provider_local_close_behavior: localCloseBehavior,
    provider_origin: environment.provider_origin,
    provider_id: environment.provider_id,
    env_public_id: environment.env_public_id,
    remote_environment_url: remoteEnvironmentURL || undefined,
    provider_status: routeDetails.providerEnvironment?.status ?? environment.remote_catalog_entry?.status,
    provider_lifecycle_status: routeDetails.providerEnvironment?.lifecycle_status ?? environment.remote_catalog_entry?.lifecycle_status,
    provider_last_seen_at_unix_ms: routeDetails.providerEnvironment?.last_seen_at_unix_ms ?? environment.remote_catalog_entry?.last_seen_at_unix_ms,
    control_plane_sync_state: routeDetails.controlPlane?.sync_state,
    local_route_state: localRouteState,
    remote_route_state: routeDetails.remoteRouteState,
    remote_catalog_freshness: routeDetails.remoteCatalogFreshness,
    remote_state_reason: routeDetails.remoteStateReason,
    pinned: environment.pinned,
    control_plane_label: controlPlaneLabel || undefined,
    tag: effectiveWindowState === 'open' ? 'Open' : 'Managed',
    category: 'provider',
    window_state: effectiveWindowState,
    is_open: effectiveWindowState === 'open',
    is_opening: effectiveWindowState === 'opening',
    runtime_health: runtimeHealth,
    runtime_service: preferredRuntimeService(runtimeService, localRuntimeHealth),
    runtime_control_capability: localEnvironmentSupportsLocalHosting(localEnvironment) ? 'start_stop' : 'observe_only',
    open_session_key: effectiveSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(effectiveSession),
    open_action_label: managedEnvironmentOpenActionLabel({
      isOpen: effectiveWindowState === 'open',
      isOpening: effectiveWindowState === 'opening',
    }),
    can_edit: true,
    can_delete: false,
    can_save: false,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function buildEnvironmentEntries(
  preferences: DesktopPreferences,
  controlPlanes: readonly DesktopControlPlaneSummary[],
  openSessions: readonly DesktopSessionSummary[],
  savedExternalRuntimeHealth: Readonly<Record<string, DesktopRuntimeHealth>>,
  savedSSHRuntimeHealth: Readonly<Record<string, DesktopRuntimeHealth>>,
): readonly DesktopEnvironmentEntry[] {
  const localManagedEnvironments = [preferences.local_environment];
  const openRemoteSessions = openSessions.filter((session) => session.target.kind === 'external_local_ui');
  const openSSHSessions = openSessions.filter((session) => session.target.kind === 'ssh_environment');
  const entries: DesktopEnvironmentEntry[] = [
    ...localManagedEnvironments
      .map((environment) => (
        buildManagedEnvironmentEntry(
          environment,
          openSessionsByManagedEnvironment(openSessions, environment),
          controlPlanes,
        )
      )),
    ...preferences.provider_environments.map((environment) => (
      buildProviderEnvironmentEntry(
        environment,
        controlPlanes,
        openSessions,
        preferences.local_environment,
      )
    )),
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
      window_state: environmentWindowState(session),
      is_open: isOpen,
      is_opening: isOpening,
      runtime_health: onlineRuntimeHealth('external_local_ui_probe', localUIURL, session.startup?.runtime_service),
      runtime_service: preferredRuntimeService(session.startup?.runtime_service, null),
      runtime_control_capability: 'observe_only',
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
        && environment.auth_mode === target.auth_mode
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
        auth_mode: target.auth_mode,
        remote_install_dir: target.remote_install_dir,
        bootstrap_strategy: target.bootstrap_strategy,
        release_base_url: target.release_base_url,
      },
      pinned: false,
      tag: isOpen ? 'Open' : '',
      category: 'open_unsaved',
      window_state: environmentWindowState(session),
      is_open: isOpen,
      is_opening: isOpening,
      runtime_health: onlineRuntimeHealth('ssh_runtime_probe', session.entry_url ?? session.startup?.local_ui_url ?? '', session.startup?.runtime_service),
      runtime_service: preferredRuntimeService(session.startup?.runtime_service, null),
      runtime_control_capability: 'start_stop',
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
    entries.push(buildSavedEnvironmentEntry(
      environment,
      openSessionByURL(openSessions, environment.local_ui_url),
      savedExternalRuntimeHealth[environment.id],
    ));
  }
  for (const environment of sshCatalog) {
    entries.push(buildSavedSSHEnvironmentEntry(
      environment,
      openSessionBySSHEnvironment(openSessions, environment),
      savedSSHRuntimeHealth[environment.id],
    ));
  }

  return entries;
}

function buildSavedEnvironmentEntry(
  environment: DesktopSavedEnvironment,
  openSession: DesktopSessionSummary | null,
  savedRuntimeHealth: DesktopRuntimeHealth | undefined,
): DesktopEnvironmentEntry {
  const isOpen = sessionIsOpen(openSession);
  const isOpening = sessionIsOpening(openSession);
  const runtimeHealth = isOpen || isOpening
    ? onlineRuntimeHealth('external_local_ui_probe', openSession?.entry_url ?? openSession?.startup?.local_ui_url ?? environment.local_ui_url, openSession?.startup?.runtime_service)
    : savedRuntimeHealth ?? offlineRuntimeHealth(
      'external_local_ui_probe',
      'external_unreachable',
      'The runtime offline / unavailable',
    );
  return {
    id: environment.id,
    kind: 'external_local_ui',
    label: environment.label,
    local_ui_url: environment.local_ui_url,
    secondary_text: environment.local_ui_url,
    pinned: environment.pinned,
    tag: isOpen ? 'Open' : environment.source === 'recent_auto' ? 'Recent' : 'Saved',
    category: environment.source,
    window_state: environmentWindowState(openSession),
    is_open: isOpen,
    is_opening: isOpening,
    runtime_health: runtimeHealth,
    runtime_service: preferredRuntimeService(openSession?.startup?.runtime_service, savedRuntimeHealth),
    runtime_control_capability: 'observe_only',
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
  savedRuntimeHealth: DesktopRuntimeHealth | undefined,
): DesktopEnvironmentEntry {
  const isOpen = sessionIsOpen(openSession);
  const isOpening = sessionIsOpening(openSession);
  const runtimeHealth = isOpen || isOpening
    ? onlineRuntimeHealth('ssh_runtime_probe', openSession?.entry_url ?? openSession?.startup?.local_ui_url ?? '', openSession?.startup?.runtime_service)
    : savedRuntimeHealth ?? offlineRuntimeHealth(
      'ssh_runtime_probe',
      'not_started',
      'Serve the runtime first',
    );
  return {
    id: environment.id,
    kind: 'ssh_environment',
    label: environment.label,
    local_ui_url: openSession?.entry_url ?? openSession?.startup?.local_ui_url ?? runtimeHealth.local_ui_url ?? '',
    secondary_text: environment.ssh_port === null
      ? environment.ssh_destination
      : `${environment.ssh_destination}:${environment.ssh_port}`,
    ssh_details: {
      ssh_destination: environment.ssh_destination,
      ssh_port: environment.ssh_port,
      auth_mode: environment.auth_mode,
      remote_install_dir: environment.remote_install_dir,
      bootstrap_strategy: environment.bootstrap_strategy,
      release_base_url: environment.release_base_url,
    },
    pinned: environment.pinned,
    tag: isOpen ? 'Open' : environment.source === 'recent_auto' ? 'Recent' : 'Saved',
    category: environment.source,
    window_state: environmentWindowState(openSession),
    is_open: isOpen,
    is_opening: isOpening,
    runtime_health: runtimeHealth,
    runtime_service: preferredRuntimeService(openSession?.startup?.runtime_service, savedRuntimeHealth),
    runtime_control_capability: 'start_stop',
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
  const environments = buildEnvironmentEntries(
    preferences,
    controlPlanes,
    openSessions,
    args.savedExternalRuntimeHealth ?? {},
    args.savedSSHRuntimeHealth ?? {},
  );
  const selectedEnvironmentID = args.selectedEnvironmentID ?? '';
  const selectedManagedEnvironment = findManagedEnvironmentByID(preferences, selectedEnvironmentID);
  const selectedProviderEnvironment = selectedManagedEnvironment
    ? null
    : findProviderEnvironmentByID(preferences, selectedEnvironmentID);
  const selectedSettingsState = (() => {
    if (selectedProviderEnvironment) {
      const localEnvironment = preferences.local_environment;
      const providerSessions = openSessionsByProviderEnvironment(openSessions, selectedProviderEnvironment);
      const defaultRoute = defaultProviderOpenRoute(
        selectedProviderEnvironment,
        providerLocalRouteState(selectedProviderEnvironment, localEnvironment, providerSessions.local_host ?? null),
        providerEnvironmentRouteDetails(selectedProviderEnvironment, controlPlanes).remoteRouteState,
      );
      const providerSession = (
        defaultRoute === 'remote_desktop'
          ? providerSessions.remote_desktop ?? providerSessions.local_host
          : providerSessions.local_host ?? providerSessions.remote_desktop
      ) ?? null;
      return {
        environment_id: selectedProviderEnvironment.id,
        environment_label: 'Local Environment',
        environment_kind: 'controlplane' as const,
        current_runtime_url: providerSession?.entry_url
          ?? providerSession?.startup?.local_ui_url
          ?? providerLocalRuntimeURL(selectedProviderEnvironment, localEnvironment, providerSessions.local_host ?? null),
        local_ui_password_configured: localEnvironmentAccess(localEnvironment).local_ui_password_configured,
        runtime_password_required: providerSession?.startup?.password_required === true,
      };
    }
    const managedEnvironment = (
      selectedManagedEnvironment
      ?? preferences.local_environment
    );
    const managedSessions = openSessionsByManagedEnvironment(openSessions, managedEnvironment);
    const managedSession = (
      localEnvironmentDefaultOpenRoute(managedEnvironment) === 'remote_desktop'
        ? managedSessions.remote_desktop ?? managedSessions.local_host
        : managedSessions.local_host ?? managedSessions.remote_desktop
    ) ?? null;
    return {
      environment_id: managedEnvironment.id,
      environment_label: managedEnvironment.label,
      environment_kind: localEnvironmentStateKind(managedEnvironment),
      current_runtime_url: managedSession?.entry_url ?? managedSession?.startup?.local_ui_url ?? '',
      local_ui_password_configured: localEnvironmentAccess(managedEnvironment).local_ui_password_configured,
      runtime_password_required: managedSession?.startup?.password_required === true,
    };
  })();

  return {
    surface,
    entry_reason: args.entryReason ?? 'app_launch',
    close_action_label: openSessions.length > 0 ? 'Close Launcher' : 'Quit',
    open_windows: buildOpenEnvironmentWindows(openSessions),
    environments,
    control_planes: controlPlanes,
    action_progress: args.actionProgress ?? [],
    suggested_remote_url: suggestedRemoteURL(issue, openSessions, environments),
    issue,
    settings_surface: buildDesktopSettingsSurfaceSnapshot('environment_settings', desktopPreferencesToDraft(preferences, selectedSettingsState.environment_id), selectedSettingsState),
  };
}
