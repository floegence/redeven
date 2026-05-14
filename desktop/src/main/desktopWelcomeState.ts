import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import {
  desktopPreferencesToDraft,
  findLocalEnvironmentByID,
  findProviderEnvironmentByID,
  type DesktopSavedEnvironment,
  type DesktopSavedSSHEnvironment,
  type DesktopPreferences,
} from './desktopPreferences';
import type { DesktopSessionLifecycle, DesktopSessionSummary } from './desktopTarget';
import { buildDesktopSettingsSurfaceSnapshot } from './settingsPageContent';
import type {
  DesktopEnvironmentEntry,
  DesktopLauncherSurface,
  DesktopLocalCloseBehavior,
  DesktopLocalRuntimeState,
  DesktopLocalEnvironmentStateRoute,
  DesktopOpenEnvironmentWindow,
  DesktopWelcomeEntryReason,
  DesktopWelcomeIssue,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import type { DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import { desktopSSHEnvironmentID, type DesktopSSHEnvironmentDetails } from '../shared/desktopSSH';
import {
  localEnvironmentStateKind,
  localEnvironmentAccess,
  localEnvironmentDefaultOpenRoute,
  localEnvironmentProviderID,
  localEnvironmentProviderOrigin,
  localEnvironmentPublicID,
  localEnvironmentSupportsRemoteDesktop,
  type DesktopLocalEnvironmentState,
} from '../shared/desktopLocalEnvironmentState';
import {
  createDesktopProviderEnvironmentRecord,
  desktopProviderEnvironmentRemoteCatalogEntryFromPublished,
  type DesktopProviderEnvironmentRecord,
} from '../shared/desktopProviderEnvironment';
import {
  desktopProviderCatalogFreshness,
  desktopProviderRemoteRouteState,
  type DesktopLocalRouteState,
  type DesktopProviderCatalogFreshness,
  type DesktopProviderRemoteRouteState,
} from '../shared/providerEnvironmentState';
import type {
  DesktopRuntimeControlCapability,
  DesktopRuntimeHealth,
} from '../shared/desktopRuntimeHealth';
import {
  normalizeDesktopRuntimeMaintenanceRequirement,
} from '../shared/desktopRuntimeHealth';
import {
  defaultRuntimeControlStatusForRunningState,
  type DesktopManagedRuntimePresence,
  type DesktopRuntimeControlStatus,
} from '../shared/desktopRuntimePresence';
import {
  normalizeRuntimeServiceSnapshot,
  runtimeServiceProviderLinkBinding,
  runtimeServiceIsOpenable,
  runtimeServiceSupportsProviderLink,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';
import {
  buildDesktopLocalRuntimeOpenPlan,
} from '../shared/localRuntimeSupervisor';
import {
  desktopProviderRuntimeLinkTargetID,
  type DesktopProviderEnvironmentCandidate,
  type DesktopProviderRuntimeLinkTarget,
} from '../shared/providerRuntimeLinkTarget';
import { normalizeLocalUIBaseURL } from './localUIURL';

export {
  desktopProviderRuntimeLinkTargetID,
};

export type BuildDesktopWelcomeSnapshotArgs = Readonly<{
  preferences: DesktopPreferences;
  controlPlanes?: readonly DesktopControlPlaneSummary[];
  openSessions?: readonly DesktopSessionSummary[];
  savedExternalRuntimeHealth?: Readonly<Record<string, DesktopRuntimeHealth>>;
  savedSSHRuntimeHealth?: Readonly<Record<string, DesktopRuntimeHealth>>;
  managedRuntimePresenceByTargetID?: Readonly<Record<string, DesktopManagedRuntimePresence>>;
  actionProgress?: DesktopWelcomeSnapshot['action_progress'];
  operations?: DesktopWelcomeSnapshot['operations'];
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

function normalizeRuntimeURLForComparison(value: unknown): string {
  const raw = compact(value);
  if (raw === '') {
    return '';
  }
  try {
    return normalizeLocalUIBaseURL(raw);
  } catch {
    return raw;
  }
}

function localRuntimeURLMatches(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeRuntimeURLForComparison(left);
  const normalizedRight = normalizeRuntimeURLForComparison(right);
  return normalizedLeft !== '' && normalizedLeft === normalizedRight;
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
    if (left.target.kind === 'local_environment' && right.target.kind !== 'local_environment') {
      return -1;
    }
    if (left.target.kind !== 'local_environment' && right.target.kind === 'local_environment') {
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

function managedRuntimeEntryFields(
  presence: DesktopManagedRuntimePresence | undefined,
): Partial<Pick<
  DesktopEnvironmentEntry,
  | 'managed_runtime_target_id'
  | 'managed_runtime_placement_target_id'
  | 'managed_runtime_host_access'
  | 'managed_runtime_placement'
>> {
  if (!presence) {
    return {};
  }
  return {
    managed_runtime_target_id: presence.target_id,
    managed_runtime_placement_target_id: presence.placement_target_id,
    managed_runtime_host_access: presence.host_access,
    managed_runtime_placement: presence.placement,
  };
}

function managedRuntimeControlCapability(
  presence: DesktopManagedRuntimePresence | undefined,
): DesktopRuntimeControlCapability {
  return presence?.lifecycle_control ?? 'start_stop';
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

function openSessionsByLocalEnvironment(
  sessions: readonly DesktopSessionSummary[],
  environment: DesktopLocalEnvironmentState,
): Readonly<Partial<Record<DesktopLocalEnvironmentStateRoute, DesktopSessionSummary>>> {
  const out: Partial<Record<DesktopLocalEnvironmentStateRoute, DesktopSessionSummary>> = {};
  for (const session of sessions) {
    if (session.target.kind !== 'local_environment' || session.target.environment_id !== environment.id) {
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
    if (session.target.kind !== 'local_environment') {
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

function providerEnvironmentRecordsFromControlPlanes(
  controlPlanes: readonly DesktopControlPlaneSummary[],
): readonly DesktopProviderEnvironmentRecord[] {
  const records: DesktopProviderEnvironmentRecord[] = [];
  for (const controlPlane of controlPlanes) {
    for (const environment of controlPlane.environments) {
      records.push(createDesktopProviderEnvironmentRecord(
        controlPlane.provider.provider_origin,
        environment.env_public_id,
        {
          providerID: controlPlane.provider.provider_id,
          label: environment.label,
          remoteCatalogEntry: desktopProviderEnvironmentRemoteCatalogEntryFromPublished(environment),
          createdAtMS: controlPlane.last_synced_at_ms,
          updatedAtMS: controlPlane.last_synced_at_ms,
        },
      ));
    }
  }
  return records;
}

function providerEnvironmentRecordsForSnapshot(
  stored: readonly DesktopProviderEnvironmentRecord[],
  controlPlanes: readonly DesktopControlPlaneSummary[],
): readonly DesktopProviderEnvironmentRecord[] {
  const recordsByID = new Map(stored.map((environment) => [environment.id, environment] as const));
  for (const environment of providerEnvironmentRecordsFromControlPlanes(controlPlanes)) {
    if (!recordsByID.has(environment.id)) {
      recordsByID.set(environment.id, environment);
    }
  }
  return [...recordsByID.values()];
}

function providerEnvironmentCandidateRouteState(
  remoteRouteState: DesktopProviderRemoteRouteState,
): DesktopProviderEnvironmentCandidate['route_state'] {
  return remoteRouteState === 'ready'
    ? 'online'
    : remoteRouteState === 'unknown'
      ? 'unknown'
      : 'offline';
}

function providerEnvironmentCandidatesForSnapshot(
  environments: readonly DesktopProviderEnvironmentRecord[],
  controlPlanes: readonly DesktopControlPlaneSummary[],
): readonly DesktopProviderEnvironmentCandidate[] {
  return environments.map((environment) => {
    const routeDetails = providerEnvironmentRouteDetails(environment, controlPlanes);
    return {
      provider_environment_id: environment.id,
      label: compact(routeDetails.providerEnvironment?.label) || compact(environment.label) || environment.env_public_id,
      provider_origin: environment.provider_origin,
      provider_id: environment.provider_id,
      env_public_id: environment.env_public_id,
      provider_label: compact(routeDetails.controlPlane?.display_label) || environment.provider_origin,
      route_state: providerEnvironmentCandidateRouteState(routeDetails.remoteRouteState),
    };
  });
}

function runtimeControlBlockedReasonCode(
  running: boolean,
  status: DesktopRuntimeControlStatus,
): string {
  if (!running) {
    return 'target_not_running';
  }
  switch (status.state) {
    case 'available':
      return '';
    case 'owner_mismatch':
      return 'runtime_control_owner_mismatch';
    case 'missing':
      return 'runtime_control_missing';
  }
}

function buildProviderRuntimeLinkTarget(input: Readonly<{
  id: DesktopProviderRuntimeLinkTarget['id'];
  kind: DesktopProviderRuntimeLinkTarget['kind'];
  environmentID: string;
  label: string;
  runtimeKey: string;
  runtimeURL: string;
  runtimeControlStatus?: DesktopProviderRuntimeLinkTarget['runtime_control_status'];
  runtimeService?: RuntimeServiceSnapshot;
}>): DesktopProviderRuntimeLinkTarget {
  const runtimeURL = compact(input.runtimeURL);
  const runtimeService = input.runtimeService
    ? normalizeRuntimeServiceSnapshot(input.runtimeService)
    : undefined;
  const providerLinkBinding = runtimeServiceProviderLinkBinding(runtimeService);
  const runtimeRunning = runtimeURL !== '';
  const providerLinkSupported = runtimeServiceSupportsProviderLink(runtimeService);
  const runtimeControlStatus = input.runtimeControlStatus ?? defaultRuntimeControlStatusForRunningState(runtimeRunning);
  const blockedReasonCode = (() => {
    const runtimeControlBlocked = runtimeControlBlockedReasonCode(runtimeRunning, runtimeControlStatus);
    if (runtimeControlBlocked !== '') {
      return runtimeControlBlocked;
    }
    if (!providerLinkSupported) {
      return 'provider_link_unsupported';
    }
    if (providerLinkBinding.state === 'linking' || providerLinkBinding.state === 'disconnecting') {
      return 'provider_link_busy';
    }
    if (providerLinkBinding.state === 'error') {
      return 'provider_link_error';
    }
    return '';
  })();
  const blockedReason = (() => {
    switch (blockedReasonCode) {
      case 'target_not_running':
        return 'Start this runtime before connecting it to a provider.';
      case 'runtime_control_missing':
        return runtimeControlStatus.state === 'missing'
          ? runtimeControlStatus.message
          : 'Restart this runtime from Desktop so runtime-control can be prepared.';
      case 'runtime_control_owner_mismatch':
        return runtimeControlStatus.state === 'owner_mismatch'
          ? runtimeControlStatus.message
          : 'This runtime is owned by another Desktop instance.';
      case 'provider_link_unsupported':
        return 'Restart this runtime with the current Desktop runtime before connecting it to a provider.';
      case 'provider_link_busy':
        return 'Provider-link is already changing state for this runtime.';
      case 'provider_link_error':
        return providerLinkBinding.last_error_message || 'Provider-link needs attention on this runtime.';
      default:
        return '';
    }
  })();
  return {
    id: input.id,
    kind: input.kind,
    environment_id: input.environmentID,
    label: input.label,
    runtime_key: input.runtimeKey,
    runtime_url: runtimeURL,
    runtime_running: runtimeRunning,
    runtime_openable: runtimeServiceIsOpenable(runtimeService),
    runtime_control_status: runtimeControlStatus,
    ...(runtimeService ? { runtime_service: runtimeService } : {}),
    provider_link_state: providerLinkBinding.state,
    provider_link_binding: providerLinkBinding,
    provider_origin: providerLinkBinding.provider_origin,
    provider_id: providerLinkBinding.provider_id,
    env_public_id: providerLinkBinding.env_public_id,
    can_connect_provider: blockedReasonCode === '' && (
      providerLinkBinding.state !== 'linked'
      || providerLinkBinding.remote_enabled !== true
      || runtimeService?.remote_enabled !== true
    ),
    can_disconnect_provider: providerLinkBinding.state === 'linked',
    ...(blockedReasonCode !== '' ? { blocked_reason_code: blockedReasonCode } : {}),
    ...(blockedReason !== '' ? { blocked_reason: blockedReason } : {}),
  };
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

function localRouteState(
  _environment: DesktopLocalEnvironmentState,
  localSession: DesktopSessionSummary | null,
): DesktopLocalRouteState {
  if (sessionIsOpen(localSession)) {
    return 'open';
  }
  if (sessionIsOpening(localSession)) {
    return 'opening';
  }
  return 'ready';
}

function localRuntimeState(
  environment: DesktopLocalEnvironmentState,
): DesktopLocalRuntimeState {
  const currentRuntime = environment.local_hosting?.current_runtime;
  if (!currentRuntime?.local_ui_url) {
    return 'not_running';
  }
  if (currentRuntime.desktop_ownership) {
    return currentRuntime.desktop_ownership === 'owned' ? 'running_desktop' : 'running_external';
  }
  return currentRuntime.desktop_managed === true ? 'running_desktop' : 'running_external';
}

function localRuntimeURL(
  environment: DesktopLocalEnvironmentState,
): string {
  return compact(environment.local_hosting?.current_runtime?.local_ui_url);
}

function localEnvironmentRuntimeService(
  environment: DesktopLocalEnvironmentState,
): DesktopEnvironmentEntry['local_environment_runtime_service'] {
  return environment.local_hosting?.current_runtime?.runtime_service;
}

function runtimeServiceFromHealth(health: DesktopRuntimeHealth | undefined): RuntimeServiceSnapshot | undefined {
  return health?.runtime_service ? normalizeRuntimeServiceSnapshot(health.runtime_service) : undefined;
}

function runtimeServiceFromPresence(presence: DesktopManagedRuntimePresence | undefined): RuntimeServiceSnapshot | undefined {
  return presence?.runtime_service ? normalizeRuntimeServiceSnapshot(presence.runtime_service) : undefined;
}

function runtimeMaintenanceFromHealth(
  health: DesktopRuntimeHealth | null | undefined,
): DesktopEnvironmentEntry['runtime_maintenance'] {
  return normalizeDesktopRuntimeMaintenanceRequirement(health?.runtime_maintenance);
}

function preferredRuntimeService(
  primary: RuntimeServiceSnapshot | undefined,
  health: DesktopRuntimeHealth | null | undefined,
  presence?: DesktopManagedRuntimePresence | undefined,
): RuntimeServiceSnapshot | undefined {
  const snapshot = runtimeServiceFromPresence(presence) ?? primary ?? runtimeServiceFromHealth(health ?? undefined);
  return snapshot ? normalizeRuntimeServiceSnapshot(snapshot) : undefined;
}

function localCloseBehavior(runtimeState: DesktopLocalRuntimeState): DesktopLocalCloseBehavior {
  return runtimeState === 'running_external' ? 'detaches' : 'stops_runtime';
}

function localEnvironmentRuntimeHealth(
  runtimeState: DesktopLocalRuntimeState,
  localRuntimeURL: string,
  runtimeService?: RuntimeServiceSnapshot,
): DesktopRuntimeHealth {
  if (runtimeState === 'running_desktop' || runtimeState === 'running_external') {
    return onlineRuntimeHealth('local_runtime_probe', localRuntimeURL, runtimeService);
  }
  return offlineRuntimeHealth('local_runtime_probe', 'not_started', 'Serve the runtime first');
}

function runtimeHealthFromPresence(
  source: DesktopRuntimeHealth['source'],
  presence: DesktopManagedRuntimePresence | undefined,
  fallback: DesktopRuntimeHealth,
): DesktopRuntimeHealth {
  if (!presence) {
    return fallback;
  }
  if (!presence.running) {
    return {
      ...fallback,
      runtime_maintenance: presence.maintenance ?? fallback.runtime_maintenance,
    };
  }
  return {
    status: 'online',
    checked_at_unix_ms: presence.checked_at_unix_ms,
    source,
    local_ui_url: presence.local_ui_url || undefined,
    runtime_service: presence.runtime_service ? normalizeRuntimeServiceSnapshot(presence.runtime_service) : undefined,
    runtime_maintenance: presence.maintenance,
  };
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

function localEnvironmentOpenActionLabel(input: Readonly<{
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

function localEnvironmentRemoteRouteDetails(
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

function buildLocalEnvironmentEntry(
  environment: DesktopLocalEnvironmentState,
  openSessions: Readonly<Partial<Record<DesktopLocalEnvironmentStateRoute, DesktopSessionSummary>>>,
  controlPlanes: readonly DesktopControlPlaneSummary[],
  providerEnvironmentCandidates: readonly DesktopProviderEnvironmentCandidate[],
  presence: DesktopManagedRuntimePresence | undefined,
): DesktopEnvironmentEntry {
  const localSession = openSessions.local_host ?? null;
  const isOpen = sessionIsOpen(localSession);
  const isOpening = sessionIsOpening(localSession);
  const access = localEnvironmentAccess(environment);
  const kind = localEnvironmentStateKind(environment);
  const providerOrigin = localEnvironmentProviderOrigin(environment);
  const providerID = localEnvironmentProviderID(environment);
  const envPublicID = localEnvironmentPublicID(environment);
  const resolvedLocalRuntimeState = localRuntimeState(environment);
  const resolvedLocalRuntimeURL = presence?.local_ui_url ?? localRuntimeURL(environment);
  const runtimeService = preferredRuntimeService(localEnvironmentRuntimeService(environment), undefined, presence);
  const localRuntimePlan = buildDesktopLocalRuntimeOpenPlan(
    { kind: 'local_environment' },
    environment.local_hosting?.current_runtime,
  );
  const providerLink = runtimeService?.bindings?.provider_link;
  const resolvedLocalCloseBehavior = localCloseBehavior(resolvedLocalRuntimeState);
  const runtimeHealth = runtimeHealthFromPresence(
    'local_runtime_probe',
    presence,
    localEnvironmentRuntimeHealth(resolvedLocalRuntimeState, resolvedLocalRuntimeURL, runtimeService),
  );
  const providerRuntimeLinkTarget = buildProviderRuntimeLinkTarget({
    id: desktopProviderRuntimeLinkTargetID('local_environment', environment.id),
    kind: 'local_environment',
    environmentID: environment.id,
    label: environment.label,
    runtimeKey: environment.id,
    runtimeURL: resolvedLocalRuntimeURL,
    runtimeControlStatus: presence?.runtime_control_status,
    runtimeService,
  });
  const resolvedLocalRouteState = localRouteState(environment, localSession);
  const remoteRoute = kind === 'controlplane'
    ? localEnvironmentRemoteRouteDetails(environment, controlPlanes)
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
    kind: 'local_environment',
    label: environment.label,
    local_ui_url: localSession?.entry_url ?? localSession?.startup?.local_ui_url ?? resolvedLocalRuntimeURL,
    secondary_text: kind === 'local'
      ? access.local_ui_bind
      : [access.local_ui_bind, remoteEnvironmentURL || providerIdentitySummary].filter(Boolean).join(' · '),
    local_environment_kind: kind,
    local_environment_ui_bind: access.local_ui_bind,
    local_environment_ui_password_configured: access.local_ui_password_configured,
    local_environment_owner: environment.local_hosting?.owner,
    local_environment_runtime_state: resolvedLocalRuntimeState,
    local_environment_runtime_url: resolvedLocalRuntimeURL || undefined,
    local_environment_runtime_plan: localRuntimePlan,
    local_environment_runtime_service: runtimeService,
    local_environment_close_behavior: resolvedLocalCloseBehavior,
    provider_runtime_link_target: providerRuntimeLinkTarget,
    provider_environment_candidates: providerEnvironmentCandidates,
    ...managedRuntimeEntryFields(presence),
    local_environment_has_local_hosting: true,
    local_environment_has_remote_desktop: false,
    local_environment_preferred_open_route: 'local_host',
    default_open_route: 'local_host',
    open_local_session_key: localSession?.session_key,
    open_local_session_lifecycle: sessionLifecycle(localSession),
    provider_origin: providerLink?.state === 'linked'
      ? providerLink.provider_origin
      : kind === 'controlplane'
        ? providerOrigin
        : undefined,
    provider_id: providerLink?.state === 'linked'
      ? providerLink.provider_id
      : kind === 'controlplane'
        ? providerID
        : undefined,
    env_public_id: providerLink?.state === 'linked'
      ? providerLink.env_public_id
      : kind === 'controlplane'
        ? envPublicID
        : undefined,
    remote_environment_url: kind === 'controlplane' ? (remoteEnvironmentURL || undefined) : undefined,
    provider_status: remoteRoute.providerEnvironment?.status,
    provider_lifecycle_status: remoteRoute.providerEnvironment?.lifecycle_status,
    provider_last_seen_at_unix_ms: remoteRoute.providerEnvironment?.last_seen_at_unix_ms,
    control_plane_sync_state: kind === 'controlplane'
      ? controlPlaneSummaryByIdentity(controlPlanes, providerOrigin, providerID)?.sync_state
      : undefined,
    local_route_state: resolvedLocalRouteState,
    remote_route_state: kind === 'controlplane' ? remoteRoute.remoteRouteState : undefined,
    remote_catalog_freshness: kind === 'controlplane' ? remoteRoute.remoteCatalogFreshness : undefined,
    remote_state_reason: kind === 'controlplane' ? remoteRoute.remoteStateReason : undefined,
    pinned: environment.pinned,
    control_plane_label: kind === 'controlplane'
      ? controlPlaneSummaryByIdentity(controlPlanes, providerOrigin, providerID)?.display_label
      : undefined,
    tag: isOpen ? 'Open' : 'Local',
    category: 'local',
    window_state: environmentWindowState(localSession),
    is_open: isOpen,
    is_opening: isOpening,
    runtime_health: runtimeHealth,
    runtime_service: runtimeService,
    runtime_control_capability: managedRuntimeControlCapability(presence),
    open_session_key: localSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(localSession),
    open_action_label: localEnvironmentOpenActionLabel({
      isOpen,
      isOpening,
    }),
    can_edit: true,
    can_delete: false,
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

function buildProviderEnvironmentEntry(
  environment: DesktopProviderEnvironmentRecord,
  controlPlanes: readonly DesktopControlPlaneSummary[],
  openSessions: readonly DesktopSessionSummary[],
  runtimeLinkTargets: readonly DesktopProviderRuntimeLinkTarget[],
): DesktopEnvironmentEntry {
  const sessions = openSessionsByProviderEnvironment(openSessions, environment);
  const remoteSession = sessions.remote_desktop ?? null;
  const routeDetails = providerEnvironmentRouteDetails(environment, controlPlanes);
  const linkedRuntime = runtimeLinkTargets.find((target) => (
    target.provider_link_state === 'linked'
    && target.provider_origin === environment.provider_origin
    && target.provider_id === environment.provider_id
    && target.env_public_id === environment.env_public_id
  )) ?? null;
  const remoteRuntimeHealth = routeDetails.providerEnvironment
    ? providerEnvironmentRuntimeHealth(routeDetails.providerEnvironment)
    : offlineRuntimeHealthForProviderRoute(routeDetails.remoteRouteState, routeDetails.remoteStateReason);
  const effectiveWindowRoute: DesktopLocalEnvironmentStateRoute | '' = (() => {
    if (sessionIsOpen(remoteSession) || sessionIsOpening(remoteSession)) {
      return 'remote_desktop';
    }
    return '';
  })();
  const effectiveSession = effectiveWindowRoute === 'remote_desktop' ? remoteSession : null;
  const runtimeHealth = remoteRuntimeHealth;
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
    local_ui_url: remoteSession?.entry_url ?? remoteSession?.startup?.local_ui_url ?? remoteEnvironmentURL ?? '',
    secondary_text: remoteEnvironmentURL || [controlPlaneLabel, environment.env_public_id].filter(Boolean).join(' / '),
    open_local_session_key: undefined,
    open_local_session_lifecycle: undefined,
    open_remote_session_key: remoteSession?.session_key,
    open_remote_session_lifecycle: sessionLifecycle(remoteSession),
    provider_linked_runtime_summary: linkedRuntime
      ? {
          runtime_target_id: linkedRuntime.id,
          runtime_kind: linkedRuntime.kind,
          label: linkedRuntime.label,
          provider_link_remote_enabled: linkedRuntime.provider_link_binding?.remote_enabled === true,
          runtime_remote_enabled: linkedRuntime.runtime_service?.remote_enabled === true,
        }
      : undefined,
    provider_origin: environment.provider_origin,
    provider_id: environment.provider_id,
    env_public_id: environment.env_public_id,
    remote_environment_url: remoteEnvironmentURL || undefined,
    provider_status: routeDetails.providerEnvironment?.status ?? environment.remote_catalog_entry?.status,
    provider_lifecycle_status: routeDetails.providerEnvironment?.lifecycle_status ?? environment.remote_catalog_entry?.lifecycle_status,
    provider_last_seen_at_unix_ms: routeDetails.providerEnvironment?.last_seen_at_unix_ms ?? environment.remote_catalog_entry?.last_seen_at_unix_ms,
    control_plane_sync_state: routeDetails.controlPlane?.sync_state,
    remote_route_state: routeDetails.remoteRouteState,
    remote_catalog_freshness: routeDetails.remoteCatalogFreshness,
    remote_state_reason: routeDetails.remoteStateReason,
    pinned: environment.pinned,
    control_plane_label: controlPlaneLabel || undefined,
    tag: effectiveWindowState === 'open' ? 'Open' : 'Provider',
    category: 'provider',
    window_state: effectiveWindowState,
    is_open: effectiveWindowState === 'open',
    is_opening: effectiveWindowState === 'opening',
    runtime_health: runtimeHealth,
    runtime_service: undefined,
    runtime_control_capability: 'observe_only',
    open_session_key: effectiveSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(effectiveSession),
    open_action_label: localEnvironmentOpenActionLabel({
      isOpen: effectiveWindowState === 'open',
      isOpening: effectiveWindowState === 'opening',
    }),
    can_edit: true,
    can_delete: false,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function buildEnvironmentEntries(
  preferences: DesktopPreferences,
  controlPlanes: readonly DesktopControlPlaneSummary[],
  openSessions: readonly DesktopSessionSummary[],
  savedExternalRuntimeHealth: Readonly<Record<string, DesktopRuntimeHealth>>,
  savedSSHRuntimeHealth: Readonly<Record<string, DesktopRuntimeHealth>>,
  managedRuntimePresenceByTargetID: Readonly<Record<string, DesktopManagedRuntimePresence>>,
): readonly DesktopEnvironmentEntry[] {
  const localLocalEnvironments = [preferences.local_environment];
  const providerEnvironmentCandidates = providerEnvironmentCandidatesForSnapshot(preferences.provider_environments, controlPlanes);
  const localRuntimeTargetID = desktopProviderRuntimeLinkTargetID('local_environment', preferences.local_environment.id);
  const localPresence = managedRuntimePresenceByTargetID[localRuntimeTargetID];
  const localRuntimeTarget = buildProviderRuntimeLinkTarget({
    id: localRuntimeTargetID,
    kind: 'local_environment',
    environmentID: preferences.local_environment.id,
    label: preferences.local_environment.label,
    runtimeKey: preferences.local_environment.id,
    runtimeURL: localPresence?.local_ui_url ?? localRuntimeURL(preferences.local_environment),
    runtimeControlStatus: localPresence?.runtime_control_status,
    runtimeService: preferredRuntimeService(localEnvironmentRuntimeService(preferences.local_environment), undefined, localPresence),
  });
  const sshRuntimeTargets = preferences.saved_ssh_environments.map((environment) => {
    const runtimeHealth = savedSSHRuntimeHealth[environment.id];
    const runtimeKey = desktopSSHEnvironmentID(environment);
    const runtimeTargetID = desktopProviderRuntimeLinkTargetID('ssh_environment', runtimeKey);
    const presence = managedRuntimePresenceByTargetID[runtimeTargetID];
    return buildProviderRuntimeLinkTarget({
      id: runtimeTargetID,
      kind: 'ssh_environment',
      environmentID: environment.id,
      label: environment.label,
      runtimeKey,
      runtimeURL: presence?.local_ui_url ?? runtimeHealth?.local_ui_url ?? '',
      runtimeControlStatus: presence?.runtime_control_status,
      runtimeService: preferredRuntimeService(undefined, runtimeHealth, presence),
    });
  });
  const runtimeLinkTargets = [localRuntimeTarget, ...sshRuntimeTargets];
  const entries: DesktopEnvironmentEntry[] = [
    ...localLocalEnvironments
      .map((environment) => (
        buildLocalEnvironmentEntry(
          environment,
          openSessionsByLocalEnvironment(openSessions, environment),
          controlPlanes,
          providerEnvironmentCandidates,
          localPresence,
        )
      )),
    ...preferences.provider_environments.map((environment) => (
      buildProviderEnvironmentEntry(
        environment,
        controlPlanes,
        openSessions,
        runtimeLinkTargets,
      )
    )),
  ];

  const catalog = preferences.saved_environments;
  const sshCatalog = preferences.saved_ssh_environments;
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
      managedRuntimePresenceByTargetID[desktopProviderRuntimeLinkTargetID('ssh_environment', desktopSSHEnvironmentID(environment))],
      providerEnvironmentCandidates,
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
  const sessionRuntimeHealth = (isOpen || isOpening)
    && localRuntimeURLMatches(openSession?.entry_url ?? openSession?.startup?.local_ui_url, environment.local_ui_url)
    ? onlineRuntimeHealth('external_local_ui_probe', openSession?.entry_url ?? openSession?.startup?.local_ui_url ?? environment.local_ui_url, openSession?.startup?.runtime_service)
    : undefined;
  const runtimeHealth = sessionRuntimeHealth
    ?? savedRuntimeHealth
    ?? offlineRuntimeHealth(
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
    tag: isOpen ? 'Open' : 'Saved',
    category: 'saved',
    window_state: environmentWindowState(openSession),
    is_open: isOpen,
    is_opening: isOpening,
    runtime_health: runtimeHealth,
    runtime_service: preferredRuntimeService(openSession?.startup?.runtime_service, savedRuntimeHealth),
    runtime_maintenance: runtimeMaintenanceFromHealth(runtimeHealth),
    runtime_control_capability: 'observe_only',
    open_session_key: openSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(openSession),
    open_action_label: isOpen ? 'Focus' : isOpening ? 'Opening…' : 'Open',
    can_edit: true,
    can_delete: true,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function buildSavedSSHEnvironmentEntry(
  environment: DesktopSavedSSHEnvironment,
  openSession: DesktopSessionSummary | null,
  savedRuntimeHealth: DesktopRuntimeHealth | undefined,
  presence: DesktopManagedRuntimePresence | undefined,
  providerEnvironmentCandidates: readonly DesktopProviderEnvironmentCandidate[],
): DesktopEnvironmentEntry {
  const isOpen = sessionIsOpen(openSession);
  const isOpening = sessionIsOpening(openSession);
  const sessionRuntimeHealth = (isOpen || isOpening)
    ? onlineRuntimeHealth('ssh_runtime_probe', openSession?.entry_url ?? openSession?.startup?.local_ui_url ?? '', openSession?.startup?.runtime_service)
    : undefined;
  const runtimeHealth = sessionRuntimeHealth
    ?? runtimeHealthFromPresence(
      'ssh_runtime_probe',
      presence,
      savedRuntimeHealth
        ?? offlineRuntimeHealth(
          'ssh_runtime_probe',
          'not_started',
          'Serve the runtime first',
        ),
    )
    ?? savedRuntimeHealth
    ?? offlineRuntimeHealth(
      'ssh_runtime_probe',
      'not_started',
      'Serve the runtime first',
    );
  const runtimeService = preferredRuntimeService(openSession?.startup?.runtime_service, savedRuntimeHealth, presence);
  const runtimeKey = desktopSSHEnvironmentID(environment);
  const providerRuntimeLinkTarget = buildProviderRuntimeLinkTarget({
    id: desktopProviderRuntimeLinkTargetID('ssh_environment', runtimeKey),
    kind: 'ssh_environment',
    environmentID: environment.id,
    label: environment.label,
    runtimeKey,
    runtimeURL: presence?.local_ui_url ?? openSession?.entry_url ?? openSession?.startup?.local_ui_url ?? runtimeHealth.local_ui_url ?? '',
    runtimeControlStatus: presence?.runtime_control_status,
    runtimeService,
  });
  return {
    id: environment.id,
    kind: 'ssh_environment',
    label: environment.label,
    local_ui_url: presence?.local_ui_url ?? openSession?.entry_url ?? openSession?.startup?.local_ui_url ?? runtimeHealth.local_ui_url ?? '',
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
      connect_timeout_seconds: environment.connect_timeout_seconds,
    },
    pinned: environment.pinned,
    tag: isOpen ? 'Open' : 'Saved',
    category: 'saved',
    window_state: environmentWindowState(openSession),
    is_open: isOpen,
    is_opening: isOpening,
    runtime_health: runtimeHealth,
    runtime_service: runtimeService,
    runtime_maintenance: runtimeMaintenanceFromHealth(runtimeHealth),
    provider_runtime_link_target: providerRuntimeLinkTarget,
    provider_environment_candidates: providerEnvironmentCandidates,
    ...managedRuntimeEntryFields(presence),
    runtime_control_capability: managedRuntimeControlCapability(presence),
    open_session_key: openSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(openSession),
    open_action_label: isOpen ? 'Focus' : isOpening ? 'Opening…' : 'Open',
    can_edit: true,
    can_delete: true,
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
  const snapshotPreferences: DesktopPreferences = {
    ...preferences,
    provider_environments: providerEnvironmentRecordsForSnapshot(preferences.provider_environments, controlPlanes),
  };
  const openSessions = sortOpenSessions(args.openSessions ?? []);
  const issue = args.issue ?? null;
  const surface = args.surface ?? 'connect_environment';
  const environments = buildEnvironmentEntries(
    snapshotPreferences,
    controlPlanes,
    openSessions,
    args.savedExternalRuntimeHealth ?? {},
    args.savedSSHRuntimeHealth ?? {},
    args.managedRuntimePresenceByTargetID ?? {},
  );
  const selectedEnvironmentID = args.selectedEnvironmentID ?? '';
  const selectedLocalEnvironment = findLocalEnvironmentByID(snapshotPreferences, selectedEnvironmentID);
  const selectedProviderEnvironment = selectedLocalEnvironment
    ? null
    : findProviderEnvironmentByID(snapshotPreferences, selectedEnvironmentID);
  const selectedSettingsState = (() => {
    if (selectedProviderEnvironment) {
      const localEnvironment = snapshotPreferences.local_environment;
      const providerSessions = openSessionsByProviderEnvironment(openSessions, selectedProviderEnvironment);
      const providerSession = providerSessions.remote_desktop ?? null;
      const providerRoute = providerEnvironmentRouteDetails(selectedProviderEnvironment, controlPlanes);
      return {
        environment_id: selectedProviderEnvironment.id,
        environment_label: selectedProviderEnvironment.label,
        environment_kind: 'controlplane' as const,
        current_runtime_url: providerSession?.entry_url
          ?? providerSession?.startup?.local_ui_url
          ?? compact(providerRoute.providerEnvironment?.environment_url)
          ?? compact(selectedProviderEnvironment.remote_catalog_entry?.environment_url),
        local_ui_password_configured: localEnvironmentAccess(localEnvironment).local_ui_password_configured,
        runtime_password_required: providerSession?.startup?.password_required === true,
      };
    }
    const localEnvironment = (
      selectedLocalEnvironment
      ?? snapshotPreferences.local_environment
    );
    const managedSessions = openSessionsByLocalEnvironment(openSessions, localEnvironment);
    const managedSession = (
      localEnvironmentDefaultOpenRoute(localEnvironment) === 'remote_desktop'
        ? managedSessions.remote_desktop ?? managedSessions.local_host
        : managedSessions.local_host ?? managedSessions.remote_desktop
    ) ?? null;
    return {
      environment_id: localEnvironment.id,
      environment_label: localEnvironment.label,
      environment_kind: localEnvironmentStateKind(localEnvironment),
      current_runtime_url: managedSession?.entry_url ?? managedSession?.startup?.local_ui_url ?? '',
      local_ui_password_configured: localEnvironmentAccess(localEnvironment).local_ui_password_configured,
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
    operations: args.operations ?? [],
    suggested_remote_url: suggestedRemoteURL(issue, openSessions, environments),
    issue,
    settings_surface: buildDesktopSettingsSurfaceSnapshot('environment_settings', desktopPreferencesToDraft(snapshotPreferences, selectedSettingsState.environment_id), selectedSettingsState),
  };
}
