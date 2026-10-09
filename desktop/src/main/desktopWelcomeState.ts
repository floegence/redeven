import { decorateEnvironmentAccess } from './environmentAccess';
import { reportedRuntimeURLs } from '../shared/desktopEnvironmentConnection';
import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import {
  type DesktopSavedEnvironment,
  type DesktopSavedRuntimeTarget,
  type DesktopPreferences,
} from './desktopPreferences';
import type { DesktopSessionLifecycle, DesktopSessionSummary } from './desktopTarget';
import type { GatewayDesktopTarget } from './desktopTarget';
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
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import {
  desktopControlPlaneKey,
  type DesktopControlPlaneSummary,
  type DesktopCloudEnvironment,
} from '../shared/cloud';
import {
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  localEnvironmentStateKind,
  localEnvironmentAccess,
  localEnvironmentCloudID,
  localEnvironmentCloudOrigin,
  localEnvironmentPublicID,
  localEnvironmentSupportsRemoteDesktop,
  type DesktopLocalEnvironmentState,
} from '../shared/desktopLocalEnvironmentState';
import {
  createDesktopCloudEnvironmentRecord,
  desktopCloudEnvironmentRemoteCatalogEntryFromPublished,
  type DesktopCloudEnvironmentRecord,
} from '../shared/desktopCloudEnvironment';
import {
  desktopProviderCatalogFreshness,
  desktopProviderRemoteRouteState,
  type DesktopLocalRouteState,
  type DesktopProviderCatalogFreshness,
  type DesktopProviderRemoteRouteState,
} from '../shared/providerEnvironmentState';
import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import {
  desktopRuntimeMaintenanceForRuntimeService,
  normalizeDesktopRuntimeMaintenanceRequirement,
} from '../shared/desktopRuntimeHealth';
import {
  defaultRuntimeControlStatusForRunningState,
  type DesktopRuntimePresence,
  type DesktopRuntimeControlStatus,
} from '../shared/desktopRuntimePresence';
import { buildDesktopRuntimeOperationPlans } from '../shared/desktopRuntimeOperationPlanner';
import type { DesktopRuntimeOperationPlans } from '../shared/desktopRuntimeOperations';
import { desktopRuntimePackageStateFromRuntimeService } from '../shared/desktopRuntimePackageState';
import {
  normalizeRuntimeServiceSnapshot,
  runtimeServiceProviderConnectionState,
  runtimeServiceCloudLinkBinding,
  runtimeServiceIsOpenable,
  runtimeServiceSupportsCloudLink,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';
import {
  desktopCloudRuntimeLinkTargetID,
  type DesktopCloudEnvironmentCandidate,
  type DesktopCloudEnvironmentOccupancy,
  type DesktopCloudRuntimeLinkTargetKind,
  type DesktopCloudRuntimeLinkTarget,
  type DesktopCloudRuntimeLinkTargetID,
} from '../shared/providerRuntimeLinkTarget';
import {
  desktopRuntimeTargetID,
  desktopRuntimeTargetAutoStatusDetectionConfigurable,
  desktopRuntimeTargetAutoStatusDetectionEnabled,
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import { normalizeLocalUIBaseURL } from './localUIURL';
import { aggregateDesktopEnvironmentEntries } from './environmentAggregator';
import {
  resolveDesktopPlatformCapabilities,
  type DesktopPlatformCapabilities,
} from '../shared/desktopPlatformCapabilities';
import type { DesktopWSLDiscoverySnapshot } from '../shared/desktopWSL';
import {
  isRedevenCloudOrigin,
  redevenCloudAllowedOrigins,
  type RedevenCloudOriginPolicy,
} from '../shared/redevenCloud';

export {
  desktopCloudRuntimeLinkTargetID,
};

export type BuildDesktopWelcomeSnapshotArgs = Readonly<{
  preferences: DesktopPreferences;
  controlPlanes?: readonly DesktopControlPlaneSummary[];
  openSessions?: readonly DesktopSessionSummary[];
  localRuntimeHealth?: Readonly<Record<string, DesktopRuntimeHealth>>;
  savedExternalRuntimeHealth?: Readonly<Record<string, DesktopRuntimeHealth>>;
  savedRuntimeTargetHealth?: Readonly<Record<string, DesktopRuntimeHealth>>;
  managedRuntimePresenceByTargetID?: Readonly<Record<string, DesktopRuntimePresence>>;
  gatewaySources?: readonly DesktopGatewaySource[];
  actionProgress?: DesktopWelcomeSnapshot['action_progress'];
  operations?: DesktopWelcomeSnapshot['operations'];
  surface?: DesktopLauncherSurface;
  entryReason?: DesktopWelcomeEntryReason;
  issue?: DesktopWelcomeIssue | null;
  selectedEnvironmentID?: string;
  navigationRevision?: number;
  flowerSettingsFocusRevision?: number;
  platformCapabilities?: DesktopPlatformCapabilities;
  wslDiscovery?: DesktopWSLDiscoverySnapshot | null;
  redevenCloudOriginPolicy?: RedevenCloudOriginPolicy;
}>;

function diagnosticsLines(lines: readonly string[]): string {
  return lines.filter((value) => String(value ?? '').trim() !== '').join('\n');
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function positiveUnixMS(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function runtimeStartedAtUnixMS(
  ...candidates: readonly unknown[]
): number | undefined {
  for (const candidate of candidates) {
    const value = positiveUnixMS(candidate);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
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
  const titleKey = code === 'external_target_invalid'
    ? 'issue.remoteEnvironmentInvalidTitle'
    : 'issue.remoteEnvironmentOpenTitle';
  return {
    scope: 'remote_environment',
    code,
    title: code === 'external_target_invalid' ? 'Check the Environment URL' : 'Unable to open that Environment',
    title_key: titleKey,
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
    title_key: 'issue.sshEnvironmentOpenTitle',
    message,
    diagnostics_copy: diagnosticsLines([
      'status: blocked',
      `code: ${code}`,
      `message: ${message}`,
      `ssh destination: ${details.ssh_destination}`,
      `ssh port: ${details.ssh_port ?? 'default'}`,
      `ssh auth mode: ${details.auth_mode}`,
      `runtime root: ${details.runtime_root}`,
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
    cloudOrigin?: string;
    status?: number;
  }> = {},
): DesktopWelcomeIssue {
  const cloudOrigin = compact(options.cloudOrigin);
  const status = Number.isInteger(options.status) && Number(options.status) >= 100
    ? Math.floor(Number(options.status))
    : 0;
  return {
    scope: 'startup',
    code,
    title_key: (() => {
      if (code === 'control_plane_invalid') {
        return 'issue.providerInvalidTitle';
      }
      if (code === 'provider_tls_untrusted') {
        return 'issue.providerTlsUntrustedTitle';
      }
      if (code === 'provider_dns_failed' || code === 'provider_connection_failed' || code === 'provider_timeout') {
        return 'issue.providerUnreachableTitle';
      }
      if (code === 'provider_invalid_json' || code === 'provider_invalid_response') {
        return 'issue.providerInvalidResponseTitle';
      }
      return 'issue.providerGenericTitle';
    })(),
    title: (() => {
      if (code === 'control_plane_invalid') {
        return 'Redeven Cloud configuration is invalid';
      }
      if (code === 'provider_tls_untrusted') {
        return 'Trust the Redeven Cloud certificate';
      }
      if (code === 'provider_dns_failed' || code === 'provider_connection_failed' || code === 'provider_timeout') {
        return 'Redeven Cloud is unreachable';
      }
      if (code === 'provider_invalid_json' || code === 'provider_invalid_response') {
        return 'Redeven Cloud returned an invalid response';
      }
      return 'Unable to use Redeven Cloud';
    })(),
    message,
    diagnostics_copy: diagnosticsLines([
      'status: blocked',
      `code: ${code}`,
      `message: ${message}`,
      cloudOrigin !== '' ? `provider origin: ${cloudOrigin}` : '',
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
        title_key: 'issue.stateDirLockedAttachTitle',
        message: 'Another Redeven runtime instance is using the default state directory and appears to provide Local UI. Retry in a moment so Desktop can attach to it.',
        message_key: 'issue.stateDirLockedAttachMessage',
        diagnostics_copy: formatBlockedLaunchDiagnostics(report),
        target_url: '',
      };
    }
    return {
      scope: 'local_environment',
      code: report.code,
      title: 'Redeven is already running',
      title_key: 'issue.stateDirLockedNoAttachTitle',
      message: 'Another Redeven runtime instance is using the default state directory without an attachable Local UI. Stop that runtime or restart it in a Local UI mode, then try again.',
      message_key: 'issue.stateDirLockedNoAttachMessage',
      diagnostics_copy: formatBlockedLaunchDiagnostics(report),
      target_url: '',
    };
  }
  if (report.code === 'startup_invalid') {
    return {
      scope: 'startup',
      code: report.code,
      title: 'Local Environment startup needs a setting',
      title_key: 'issue.startupInvalidTitle',
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
      title_key: 'issue.startupFailedTitle',
      message: report.message,
      diagnostics_copy: formatBlockedLaunchDiagnostics(report),
      target_url: '',
    };
  }

  return {
    scope: 'local_environment',
    code: report.code,
    title: 'Local Environment needs attention',
    title_key: 'issue.localEnvironmentAttentionTitle',
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

function unknownRuntimeHealth(
  source: DesktopRuntimeHealth['source'],
): DesktopRuntimeHealth {
  return {
    ...offlineRuntimeHealth(source, 'unverified', 'Status has not been checked yet'),
    freshness: 'unknown',
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

function sortEnvironmentEntriesByStableOrder(
  entries: readonly DesktopEnvironmentEntry[],
): readonly DesktopEnvironmentEntry[] {
  return [...entries].sort((left, right) => (
    (left.pinned ? 0 : 1) - (right.pinned ? 0 : 1)
    || left.created_at_ms - right.created_at_ms
    || left.label.toLowerCase().localeCompare(right.label.toLowerCase())
    || left.id.localeCompare(right.id)
  ));
}

function managedRuntimeEntryFields(
  presence: DesktopRuntimePresence | undefined,
): Partial<Pick<
  DesktopEnvironmentEntry,
  | 'managed_runtime_target_id'
  | 'managed_runtime_placement_target_id'
  | 'managed_runtime_host_access'
  | 'managed_runtime_placement'
  | 'managed_runtime_open_connection_required'
>> {
  if (!presence) {
    return {};
  }
  return {
    managed_runtime_target_id: presence.target_id,
    managed_runtime_placement_target_id: presence.placement_target_id,
    managed_runtime_host_access: presence.host_access,
    managed_runtime_placement: presence.placement,
    ...(presence.open_connection_required ? { managed_runtime_open_connection_required: true } : {}),
  };
}

function managedRuntimeOperations(args: Readonly<{
  presence?: DesktopRuntimePresence;
  hostAccess?: DesktopRuntimeHostAccess;
  placement?: DesktopRuntimePlacement;
  running: boolean;
  openable: boolean;
  openConnectionRequired?: boolean;
  runtimeService?: RuntimeServiceSnapshot;
  runtimeControlStatus?: DesktopRuntimeControlStatus;
  maintenance?: DesktopEnvironmentEntry['runtime_maintenance'];
}>): DesktopRuntimeOperationPlans {
  const runtimeService = args.presence?.runtime_service
    ? normalizeRuntimeServiceSnapshot(args.presence.runtime_service)
    : args.runtimeService;
  const maintenance = desktopRuntimeMaintenanceForRuntimeService(
    args.presence?.maintenance ?? args.maintenance,
    runtimeService,
  );
  const runtimePackageState = desktopRuntimePackageStateFromRuntimeService(runtimeService, maintenance);
  return buildDesktopRuntimeOperationPlans({
    surface: 'managed_runtime_card',
    host_access: args.presence?.host_access ?? args.hostAccess,
    placement: args.presence?.placement ?? args.placement,
    running: args.presence?.running ?? args.running,
    openable: args.presence?.openable ?? args.openable,
    open_connection_required: args.presence?.open_connection_required ?? (args.openConnectionRequired === true),
    package_state: runtimePackageState,
    runtime_service: runtimeService,
    runtime_control_status: args.presence?.runtime_control_status ?? args.runtimeControlStatus,
    maintenance,
  });
}

function externalLocalUIRuntimeOperations(openable: boolean): DesktopRuntimeOperationPlans {
  return buildDesktopRuntimeOperationPlans({
    surface: 'external_local_ui',
    running: openable,
    openable,
  });
}

function providerRuntimeOperations(
  openable: boolean,
): DesktopRuntimeOperationPlans {
  return buildDesktopRuntimeOperationPlans({
    surface: 'provider_card',
    running: openable,
    openable,
  });
}

function gatewayRuntimeOperations(openable: boolean): DesktopRuntimeOperationPlans {
  return buildDesktopRuntimeOperationPlans({
    surface: 'gateway_card',
    running: openable,
    openable,
  });
}

function gatewaySessionTarget(session: DesktopSessionSummary): GatewayDesktopTarget | null {
  return session.target.kind === 'gateway_environment' ? session.target : null;
}

function gatewaySessionEnvironmentEntryID(target: GatewayDesktopTarget): string {
  return target.session_key;
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

function providerRuntimeLinkKindForHostAccess(
  hostAccess: DesktopRuntimeHostAccess,
): DesktopCloudRuntimeLinkTargetKind {
  return hostAccess.kind === 'ssh_host'
    ? 'ssh_environment'
    : hostAccess.kind === 'wsl_host'
      ? 'wsl_environment'
      : 'local_environment';
}

function openSessionByRuntimeTarget(
  sessions: readonly DesktopSessionSummary[],
  target: DesktopSavedRuntimeTarget,
): DesktopSessionSummary | null {
  return sessions.find((session) => (
    session.target.environment_id === target.id
    || session.session_key === target.id
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

function openSessionsByCloudEnvironment(
  sessions: readonly DesktopSessionSummary[],
  environment: DesktopCloudEnvironmentRecord,
): Readonly<Partial<Record<DesktopLocalEnvironmentStateRoute, DesktopSessionSummary>>> {
  const out: Partial<Record<DesktopLocalEnvironmentStateRoute, DesktopSessionSummary>> = {};
  for (const session of sessions) {
    if (session.target.kind !== 'local_environment') {
      continue;
    }
    const matchesProviderIdentity = (
      session.target.cloud_origin === environment.cloud_origin
      && session.target.cloud_id === environment.cloud_id
      && session.target.env_public_id === environment.env_public_id
    );
    if (!matchesProviderIdentity && session.target.environment_id !== environment.id) {
      continue;
    }
    out[session.target.route] = session;
  }
  return out;
}

function providerEnvironmentSummaryFromRecord(
  environment: DesktopCloudEnvironmentRecord,
): DesktopCloudEnvironment {
  return {
    cloud_id: environment.cloud_id,
    cloud_origin: environment.cloud_origin,
    env_public_id: environment.env_public_id,
    region: environment.region,
    access_point_id: environment.access_point_id,
    access_point_origin: environment.access_point_origin,
    label: environment.label,
    environment_url: environment.remote_catalog_entry?.environment_url || undefined,
    description: environment.remote_catalog_entry?.description ?? '',
    namespace_public_id: environment.remote_catalog_entry?.namespace_public_id ?? '',
    namespace_name: environment.remote_catalog_entry?.namespace_name ?? '',
    status: environment.remote_catalog_entry?.status ?? '',
    lifecycle_status: environment.remote_catalog_entry?.lifecycle_status ?? '',
    last_seen_at_unix_ms: environment.remote_catalog_entry?.last_seen_at_unix_ms ?? 0,
    access: environment.remote_catalog_entry?.access,
  };
}

function fallbackControlPlaneSummaries(
  controlPlanes: DesktopPreferences['control_planes'],
  providerEnvironments: readonly DesktopCloudEnvironmentRecord[],
): readonly DesktopControlPlaneSummary[] {
  return controlPlanes.map((controlPlane) => ({
    ...controlPlane,
    environments: providerEnvironments
      .filter((environment) => (
        environment.cloud_origin === controlPlane.cloud.cloud_origin
        && environment.cloud_id === controlPlane.cloud.cloud_id
      ))
      .map(providerEnvironmentSummaryFromRecord),
    sync_state: controlPlane.last_synced_at_ms > 0 ? 'ready' : 'idle',
    last_sync_attempt_at_ms: controlPlane.last_synced_at_ms,
    last_sync_error_code: '',
    last_sync_error_message: '',
    catalog_freshness: desktopProviderCatalogFreshness(controlPlane.last_synced_at_ms),
  }));
}

function providerEnvironmentCandidateRouteState(
  remoteRouteState: DesktopProviderRemoteRouteState,
): DesktopCloudEnvironmentCandidate['route_state'] {
  return remoteRouteState === 'ready'
    ? 'online'
    : remoteRouteState === 'unknown' || remoteRouteState === 'stale'
      ? 'unknown'
      : 'offline';
}

function providerEnvironmentCandidatesForSnapshot(
  environments: readonly DesktopCloudEnvironmentRecord[],
  controlPlanes: readonly DesktopControlPlaneSummary[],
  runtimeLinkTargets: readonly DesktopCloudRuntimeLinkTarget[],
  selectedRuntimeTargetID: DesktopCloudRuntimeLinkTargetID,
): readonly DesktopCloudEnvironmentCandidate[] {
  return environments.map((environment) => {
    const routeDetails = providerEnvironmentRouteDetails(environment, controlPlanes);
    const linkedRuntime = linkedRuntimeTargetForCloudEnvironment(environment, runtimeLinkTargets);
    const occupancy = providerEnvironmentOccupancyForRuntimeTarget(
      routeDetails,
      linkedRuntime,
      selectedRuntimeTargetID,
    );
    return {
      provider_environment_id: environment.id,
      label: compact(routeDetails.providerEnvironment?.label) || compact(environment.label) || environment.env_public_id,
      cloud_origin: environment.cloud_origin,
      cloud_id: environment.cloud_id,
      env_public_id: environment.env_public_id,
      access_point_origin: environment.access_point_origin,
      provider_label: compact(routeDetails.controlPlane?.display_label) || environment.cloud_origin,
      route_state: providerEnvironmentCandidateRouteState(routeDetails.remoteRouteState),
      occupancy,
    };
  });
}

function linkedRuntimeTargetForCloudEnvironment(
  environment: DesktopCloudEnvironmentRecord,
  runtimeLinkTargets: readonly DesktopCloudRuntimeLinkTarget[],
  includeInFlightBinding = false,
): DesktopCloudRuntimeLinkTarget | null {
  return runtimeLinkTargets.find((target) => (
    (target.cloud_link_state === 'linked' || (includeInFlightBinding && ['linking', 'disconnecting'].includes(target.cloud_link_state)))
    && target.cloud_origin === environment.cloud_origin
    && target.cloud_id === environment.cloud_id
    && target.env_public_id === environment.env_public_id
    && target.access_point_origin === environment.access_point_origin
  )) ?? null;
}

function occupancyFromLinkedRuntimeTarget(
  linkedRuntime: DesktopCloudRuntimeLinkTarget,
  state: Extract<DesktopCloudEnvironmentOccupancy['state'], 'linked_here' | 'occupied_by_known_runtime'>,
): DesktopCloudEnvironmentOccupancy {
  return {
    state,
    runtime_target_id: linkedRuntime.id,
    runtime_kind: linkedRuntime.kind,
    runtime_label: linkedRuntime.label,
    provider_connection_state: linkedRuntime.provider_connection_state,
  };
}

function providerEnvironmentOccupancyForRuntimeTarget(
  routeDetails: ReturnType<typeof providerEnvironmentRouteDetails>,
  linkedRuntime: DesktopCloudRuntimeLinkTarget | null,
  selectedRuntimeTargetID: DesktopCloudRuntimeLinkTargetID,
): DesktopCloudEnvironmentOccupancy {
  if (linkedRuntime) {
    return occupancyFromLinkedRuntimeTarget(
      linkedRuntime,
      linkedRuntime.id === selectedRuntimeTargetID ? 'linked_here' : 'occupied_by_known_runtime',
    );
  }
  if (routeDetails.providerEnvironment?.runtime_health?.runtime_status === 'online') {
    return { state: 'occupied_by_provider_online_runtime' };
  }
  return { state: 'available' };
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
    case 'missing':
      return 'runtime_control_missing';
  }
}

function buildCloudRuntimeLinkTarget(input: Readonly<{
  id: DesktopCloudRuntimeLinkTarget['id'];
  kind: DesktopCloudRuntimeLinkTarget['kind'];
  environmentID: string;
  label: string;
  runtimeKey: string;
  runtimeURL: string;
  runtimeRunning?: boolean;
  runtimeControlStatus?: DesktopCloudRuntimeLinkTarget['runtime_control_status'];
  runtimeService?: RuntimeServiceSnapshot;
  redevenCloudOriginPolicy: RedevenCloudOriginPolicy;
}>): DesktopCloudRuntimeLinkTarget {
  const runtimeURL = compact(input.runtimeURL);
  const runtimeService = input.runtimeService
    ? normalizeRuntimeServiceSnapshot(input.runtimeService)
    : undefined;
  const cloudLinkBinding = runtimeServiceCloudLinkBinding(runtimeService);
  const providerConnectionState = runtimeServiceProviderConnectionState(runtimeService);
  const runtimeRunning = input.runtimeRunning ?? runtimeURL !== '';
  const cloudLinkSupported = runtimeServiceSupportsCloudLink(runtimeService);
  const runtimeControlStatus = input.runtimeControlStatus ?? defaultRuntimeControlStatusForRunningState(runtimeRunning);
  const blockedReasonCode = (() => {
    const runtimeControlBlocked = runtimeControlBlockedReasonCode(runtimeRunning, runtimeControlStatus);
    if (runtimeControlBlocked !== '') {
      return runtimeControlBlocked;
    }
    if (!cloudLinkSupported) {
      return 'cloud_link_unsupported';
    }
    if (cloudLinkBinding.state === 'linking' || cloudLinkBinding.state === 'disconnecting') {
      return 'cloud_link_busy';
    }
    return '';
  })();
  const blockedReason = (() => {
    switch (blockedReasonCode) {
      case 'target_not_running':
        return 'Start this runtime before connecting it to Redeven Cloud.';
      case 'runtime_control_missing':
        return runtimeControlStatus.state === 'missing'
          ? runtimeControlStatus.message
          : 'Restart this runtime from Desktop so runtime-control can be prepared.';
      case 'cloud_link_unsupported':
        return 'Restart this runtime with the current Desktop Runtime before connecting it to Redeven Cloud.';
      case 'cloud_link_busy':
        return 'The Redeven Cloud link is already changing state for this Runtime.';
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
    provider_connection_state: providerConnectionState,
    cloud_link_state: cloudLinkBinding.state,
    cloud_link_binding: cloudLinkBinding,
    cloud_origin: cloudLinkBinding.cloud_origin,
    cloud_origin_supported: isRedevenCloudOrigin(
      cloudLinkBinding.cloud_origin ?? '',
      input.redevenCloudOriginPolicy,
    ),
    cloud_id: cloudLinkBinding.cloud_id,
    env_public_id: cloudLinkBinding.env_public_id,
    access_point_origin: cloudLinkBinding.access_point_origin,
    can_connect_cloud: blockedReasonCode === '' && ['unlinked', 'authorization_required', 'disabled', 'error'].includes(providerConnectionState),
    can_disconnect_cloud: cloudLinkBinding.state === 'linked',
    ...(blockedReasonCode !== '' ? { blocked_reason_code: blockedReasonCode } : {}),
    ...(blockedReason !== '' ? { blocked_reason: blockedReason } : {}),
  };
}

function controlPlaneSummaryByIdentity(
  controlPlanes: readonly DesktopControlPlaneSummary[],
  cloudOrigin: string,
  cloudID: string,
): DesktopControlPlaneSummary | null {
  const cleanCloudOrigin = compact(cloudOrigin);
  const cleanProviderID = compact(cloudID);
  if (cleanCloudOrigin === '' || cleanProviderID === '') {
    return null;
  }
  return controlPlanes.find((entry) => (
    entry.cloud.cloud_origin === cleanCloudOrigin
    && entry.cloud.cloud_id === cleanProviderID
  )) ?? null;
}

function controlPlaneEnvironmentSummary(
  controlPlanes: readonly DesktopControlPlaneSummary[],
  cloudOrigin: string,
  cloudID: string,
  envPublicID: string,
): DesktopControlPlaneSummary['environments'][number] | null {
  const cleanEnvPublicID = compact(envPublicID);
  if (cleanEnvPublicID === '') {
    return null;
  }
  const controlPlane = controlPlaneSummaryByIdentity(controlPlanes, cloudOrigin, cloudID);
  if (!controlPlane) {
    return null;
  }
  return controlPlane.environments.find((entry) => entry.env_public_id === cleanEnvPublicID) ?? null;
}

function providerEnvironmentRecordKey(
  cloudOrigin: string,
  cloudID: string,
  envPublicID: string,
): string {
  return `${compact(cloudOrigin)}\n${compact(cloudID)}\n${compact(envPublicID)}`;
}

function providerEnvironmentRecordsFromControlPlanes(
  controlPlanes: readonly DesktopControlPlaneSummary[],
): readonly DesktopCloudEnvironmentRecord[] {
  const records: DesktopCloudEnvironmentRecord[] = [];
  for (const controlPlane of controlPlanes) {
    for (const environment of controlPlane.environments) {
      records.push(createDesktopCloudEnvironmentRecord(
        controlPlane.cloud.cloud_origin,
        environment.env_public_id,
        {
          cloudID: controlPlane.cloud.cloud_id,
          region: environment.region,
          accessPointID: environment.access_point_id,
          accessPointOrigin: environment.access_point_origin,
          label: environment.label,
          remoteCatalogEntry: desktopCloudEnvironmentRemoteCatalogEntryFromPublished(environment),
          createdAtMS: controlPlane.last_synced_at_ms,
          updatedAtMS: controlPlane.last_synced_at_ms,
        },
      ));
    }
  }
  return records;
}

function providerEnvironmentRecordsForSnapshot(
  stored: readonly DesktopCloudEnvironmentRecord[],
  controlPlanes: readonly DesktopControlPlaneSummary[],
): readonly DesktopCloudEnvironmentRecord[] {
  const activeCatalogKeys = new Set<string>();
  const recordsByKey = new Map<string, DesktopCloudEnvironmentRecord>();
  const storedByKey = new Map(stored.map((environment) => [
    providerEnvironmentRecordKey(environment.cloud_origin, environment.cloud_id, environment.env_public_id),
    environment,
  ] as const));

  for (const environment of providerEnvironmentRecordsFromControlPlanes(controlPlanes)) {
    const key = providerEnvironmentRecordKey(environment.cloud_origin, environment.cloud_id, environment.env_public_id);
    activeCatalogKeys.add(key);
    const storedEnvironment = storedByKey.get(key);
    recordsByKey.set(key, storedEnvironment
      ? createDesktopCloudEnvironmentRecord(environment.cloud_origin, environment.env_public_id, {
          cloudID: environment.cloud_id,
          region: environment.region,
          accessPointID: environment.access_point_id,
          accessPointOrigin: environment.access_point_origin,
          label: environment.label,
          pinned: storedEnvironment.pinned,
          preferredOpenRoute: storedEnvironment.preferred_open_route,
          remoteWebSupported: environment.remote_web_supported,
          remoteDesktopSupported: environment.remote_desktop_supported,
          remoteCatalogEntry: environment.remote_catalog_entry,
          createdAtMS: storedEnvironment.created_at_ms,
          updatedAtMS: Math.max(storedEnvironment.updated_at_ms, environment.updated_at_ms),
          lastUsedAtMS: storedEnvironment.last_used_at_ms,
        })
      : environment);
  }

  for (const environment of stored) {
    const key = providerEnvironmentRecordKey(environment.cloud_origin, environment.cloud_id, environment.env_public_id);
    if (recordsByKey.has(key)) {
      continue;
    }
    const controlPlane = controlPlaneSummaryByIdentity(controlPlanes, environment.cloud_origin, environment.cloud_id);
    const hasFreshCatalog = controlPlane?.sync_state === 'ready' && controlPlane.catalog_freshness === 'fresh';
    if (!hasFreshCatalog || activeCatalogKeys.has(key)) {
      recordsByKey.set(key, environment);
    }
  }

  return [...recordsByKey.values()];
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
  if (!currentRuntime) {
    return 'not_running';
  }
  return 'running';
}

function localEnvironmentRuntimeService(
  environment: DesktopLocalEnvironmentState,
): DesktopEnvironmentEntry['local_environment_runtime_service'] {
  return environment.local_hosting?.current_runtime?.runtime_service;
}

function runtimeServiceFromHealth(health: DesktopRuntimeHealth | undefined): RuntimeServiceSnapshot | undefined {
  return health?.runtime_service ? normalizeRuntimeServiceSnapshot(health.runtime_service) : undefined;
}

function runtimeServiceFromPresence(presence: DesktopRuntimePresence | undefined): RuntimeServiceSnapshot | undefined {
  return presence?.runtime_service ? normalizeRuntimeServiceSnapshot(presence.runtime_service) : undefined;
}

function runtimeMaintenanceFromHealth(
  health: DesktopRuntimeHealth | null | undefined,
): DesktopEnvironmentEntry['runtime_maintenance'] {
  return desktopRuntimeMaintenanceForRuntimeService(
    normalizeDesktopRuntimeMaintenanceRequirement(health?.runtime_maintenance),
    health?.runtime_service,
  );
}

function runtimeHealthWithEffectiveMaintenance(health: DesktopRuntimeHealth): DesktopRuntimeHealth {
  const runtimeMaintenance = runtimeMaintenanceFromHealth(health);
  const { runtime_maintenance: _runtimeMaintenance, ...rest } = health;
  return runtimeMaintenance
    ? { ...rest, runtime_maintenance: runtimeMaintenance }
    : rest;
}

function preferredRuntimeService(
  startup: RuntimeServiceSnapshot | undefined,
  health: DesktopRuntimeHealth | null | undefined,
  presence?: DesktopRuntimePresence | undefined,
): RuntimeServiceSnapshot | undefined {
  // A startup report can precede AI publication. Keep the latest observed
  // service, including during a health refresh, ahead of that historical report.
  const snapshot = runtimeServiceFromPresence(presence) ?? runtimeServiceFromHealth(health ?? undefined) ?? startup;
  return snapshot ? normalizeRuntimeServiceSnapshot(snapshot) : undefined;
}

function localCloseBehavior(runtimeState: DesktopLocalRuntimeState): DesktopLocalCloseBehavior {
  return runtimeState === 'not_running' ? 'not_applicable' : 'detaches';
}

function localEnvironmentRuntimeHealth(
  runtimeState: DesktopLocalRuntimeState,
  localRuntimeURL: string,
  runtimeService?: RuntimeServiceSnapshot,
): DesktopRuntimeHealth {
  if (runtimeState === 'running') {
    return onlineRuntimeHealth('local_runtime_probe', localRuntimeURL, runtimeService);
  }
  return offlineRuntimeHealth('local_runtime_probe', 'not_started', 'Serve the runtime first');
}

function runtimeHealthFromPresence(
  source: DesktopRuntimeHealth['source'],
  presence: DesktopRuntimePresence | undefined,
  fallback: DesktopRuntimeHealth,
): DesktopRuntimeHealth {
  if (!presence) {
    return runtimeHealthWithEffectiveMaintenance(fallback);
  }
  const presenceRuntimeService = presence.runtime_service ? normalizeRuntimeServiceSnapshot(presence.runtime_service) : undefined;
  const presenceMaintenance = desktopRuntimeMaintenanceForRuntimeService(presence.maintenance, presenceRuntimeService);
  if (!presence.running) {
    const runtimeControlMissing = presence.runtime_control_status.state === 'missing'
      ? presence.runtime_control_status
      : null;
    return {
      ...fallback,
      status: 'offline',
      ...(presence.started_at_unix_ms ? { started_at_unix_ms: presence.started_at_unix_ms } : {}),
      checked_at_unix_ms: presence.checked_at_unix_ms,
      source,
      freshness: fallback.freshness === 'unknown' ? undefined : fallback.freshness,
      offline_reason_code:
        runtimeControlMissing?.reason_code === 'not_started'
        || runtimeControlMissing?.reason_code === 'auth_required'
        || runtimeControlMissing?.reason_code === 'unverified'
        || runtimeControlMissing?.reason_code === 'reinstall_required'
        || runtimeControlMissing?.reason_code === 'container_not_running'
        || runtimeControlMissing?.reason_code === 'container_engine_unavailable'
          ? runtimeControlMissing.reason_code
          : fallback.offline_reason_code,
      offline_reason: runtimeControlMissing?.message || fallback.offline_reason,
      runtime_maintenance: presenceMaintenance ?? runtimeMaintenanceFromHealth(fallback),
    };
  }
  return {
    status: 'online',
    checked_at_unix_ms: presence.checked_at_unix_ms,
    source,
    freshness: fallback.freshness === 'unknown' ? undefined : fallback.freshness,
    local_ui_url: presence.local_ui_url || undefined,
    local_ui_urls: presence.local_ui_urls,
    local_ui_address_issues: presence.local_ui_address_issues,
    ...(presence.started_at_unix_ms ? { started_at_unix_ms: presence.started_at_unix_ms } : {}),
    runtime_service: presenceRuntimeService,
    runtime_maintenance: presenceMaintenance,
  };
}

function localRuntimeStateFromCachedHealth(
  fallback: DesktopLocalRuntimeState,
  health: DesktopRuntimeHealth | undefined,
): DesktopLocalRuntimeState {
  if (!health) return fallback;
  return health.status === 'online' ? 'running' : 'not_running';
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
    offline_reason_code: normalizeProviderRuntimeOfflineReasonCode(providerHealth?.offline_reason_code),
    offline_reason: providerHealth?.offline_reason || 'The runtime offline / unavailable',
  };
}

function normalizeProviderRuntimeOfflineReasonCode(
  reasonCode: string | undefined,
): NonNullable<DesktopRuntimeHealth['offline_reason_code']> {
  switch (compact(reasonCode)) {
    case 'runtime_disconnected':
      return 'runtime_disconnected';
    case 'binding_replaced':
      return 'binding_replaced';
    case 'environment_inactive':
      return 'environment_inactive';
    default:
      return 'provider_unavailable';
  }
}

function localEnvironmentOpenActionLabel(input: Readonly<{
  isOpen: boolean;
  isOpening: boolean;
}>): DesktopEnvironmentEntry['open_action'] {
  if (input.isOpen) {
    return 'focus';
  }
  if (input.isOpening) {
    return 'opening';
  }
  return 'open';
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

  const cloudOrigin = localEnvironmentCloudOrigin(environment);
  const cloudID = localEnvironmentCloudID(environment);
  const envPublicID = localEnvironmentPublicID(environment);
  const controlPlane = controlPlaneSummaryByIdentity(controlPlanes, cloudOrigin, cloudID);
  if (!controlPlane) {
    return {
      providerEnvironment: null,
      remoteRouteState: 'auth_required',
      remoteCatalogFreshness: 'unknown',
      remoteStateReason: 'Reconnect Redeven Cloud in Desktop to restore remote access.',
    };
  }

  const providerEnvironment = controlPlaneEnvironmentSummary(
    controlPlanes,
    cloudOrigin,
    cloudID,
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
        return 'Redeven Cloud currently reports this Environment as offline.';
      case 'stale':
        return 'Remote status is stale. Refresh Redeven Cloud to confirm the current state.';
      case 'removed':
        return 'This Environment is no longer published by Redeven Cloud.';
      case 'auth_required':
        return 'Reconnect Redeven Cloud in Desktop to restore access.';
      case 'provider_unreachable':
        return 'Desktop could not refresh Redeven Cloud from this device.';
      case 'provider_invalid':
        return 'Redeven Cloud returned an invalid response while Desktop refreshed status.';
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
  cachedRuntimeHealth: DesktopRuntimeHealth | undefined,
  presence: DesktopRuntimePresence | undefined,
  redevenCloudOriginPolicy: RedevenCloudOriginPolicy,
): DesktopEnvironmentEntry {
  const localSession = openSessions.local_host ?? null;
  const isOpen = sessionIsOpen(localSession);
  const isOpening = sessionIsOpening(localSession);
  const access = localEnvironmentAccess(environment);
  const kind = localEnvironmentStateKind(environment);
  const cloudOrigin = localEnvironmentCloudOrigin(environment);
  const cloudID = localEnvironmentCloudID(environment);
  const envPublicID = localEnvironmentPublicID(environment);
  const resolvedLocalRuntimeState = presence
    ? (presence.running ? 'running' : 'not_running')
    : localRuntimeStateFromCachedHealth(
      localSession?.startup ? 'running' : localRuntimeState(environment), cachedRuntimeHealth,
    );
  const runtimeRunning = resolvedLocalRuntimeState === 'running';
  const runtimeObservation = presence ?? cachedRuntimeHealth ?? localSession?.startup ?? environment.local_hosting.current_runtime;
  const resolvedLocalRuntimeURLs = runtimeRunning ? reportedRuntimeURLs(runtimeObservation) : [];
  const resolvedLocalRuntimeURL = resolvedLocalRuntimeURLs[0] ?? '';
  const startedAtUnixMS = runtimeStartedAtUnixMS(runtimeObservation?.started_at_unix_ms);
  const runtimeService = preferredRuntimeService(localEnvironmentRuntimeService(environment), cachedRuntimeHealth, presence);
  const cloudLink = runtimeService?.bindings?.cloud_link;
  const resolvedLocalCloseBehavior = localCloseBehavior(resolvedLocalRuntimeState);
  const localRuntimeFallbackHealth = cachedRuntimeHealth
    ?? (
      resolvedLocalRuntimeState === 'not_running'
        ? unknownRuntimeHealth('local_runtime_probe')
        : localEnvironmentRuntimeHealth(resolvedLocalRuntimeState, resolvedLocalRuntimeURL, runtimeService)
    );
  const runtimeHealth = runtimeHealthFromPresence(
    'local_runtime_probe',
    presence,
    localRuntimeFallbackHealth,
  );
  const runtimeMaintenance = runtimeMaintenanceFromHealth(runtimeHealth);
  const effectiveHostAccess = presence?.host_access ?? { kind: 'local_host' as const };
  const effectivePlacement = presence?.placement ?? {
    kind: 'host_process' as const,
    runtime_root: environment.local_hosting.state_dir,
  };
  const runtimeOperations = managedRuntimeOperations({
    presence,
    hostAccess: effectiveHostAccess,
    placement: effectivePlacement,
    running: runtimeHealth.status === 'online',
    openable: runtimeServiceIsOpenable(runtimeService),
    openConnectionRequired: presence?.open_connection_required === true,
    runtimeService,
    runtimeControlStatus: presence?.runtime_control_status ?? defaultRuntimeControlStatusForRunningState(runtimeHealth.status === 'online'),
    maintenance: runtimeMaintenance,
  });
  const providerRuntimeLinkTarget = buildCloudRuntimeLinkTarget({
    id: desktopCloudRuntimeLinkTargetID('local_environment', environment.id),
    kind: 'local_environment',
    environmentID: environment.id,
    label: environment.label,
    runtimeKey: environment.id,
    runtimeURL: resolvedLocalRuntimeURL,
    runtimeRunning: runtimeHealth.status === 'online',
    runtimeControlStatus: presence?.runtime_control_status,
    runtimeService,
    redevenCloudOriginPolicy,
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
    ? [cloudOrigin, envPublicID].filter(Boolean).join(' / ')
    : '';
  return {
    id: environment.id,
    kind: 'local_environment',
    registration_ref: { kind: 'local_environment', id: environment.id },
    label: environment.label,
    local_ui_url: resolvedLocalRuntimeURL,
    secondary_text: kind === 'local'
      ? access.local_ui_bind
      : [access.local_ui_bind, remoteEnvironmentURL || providerIdentitySummary].filter(Boolean).join(' · '),
    local_environment_kind: kind,
    local_environment_ui_bind: access.local_ui_bind,
    local_ui_urls: resolvedLocalRuntimeURLs,
    local_environment_ui_password_configured: access.local_ui_password_configured,
    local_environment_runtime_state: resolvedLocalRuntimeState,
    local_environment_runtime_url: resolvedLocalRuntimeURL || undefined,
    local_environment_runtime_service: runtimeService,
    local_environment_close_behavior: resolvedLocalCloseBehavior,
    provider_runtime_link_target: providerRuntimeLinkTarget,
    ...managedRuntimeEntryFields(presence),
    managed_runtime_target_id: presence?.target_id
      ?? desktopRuntimeTargetID(effectiveHostAccess, effectivePlacement),
    managed_runtime_placement_target_id: presence?.placement_target_id
      ?? desktopRuntimeTargetID(effectiveHostAccess, effectivePlacement, environment.id),
    managed_runtime_host_access: effectiveHostAccess,
    managed_runtime_placement: effectivePlacement,
    local_environment_has_local_hosting: true,
    local_environment_has_remote_desktop: false,
    local_environment_preferred_open_route: 'local_host',
    default_open_route: 'local_host',
    open_local_session_key: localSession?.session_key,
    open_local_session_lifecycle: sessionLifecycle(localSession),
    cloud_origin: cloudLink?.state === 'linked'
      ? cloudLink.cloud_origin
      : kind === 'controlplane'
        ? cloudOrigin
        : undefined,
    cloud_id: cloudLink?.state === 'linked'
      ? cloudLink.cloud_id
      : kind === 'controlplane'
        ? cloudID
        : undefined,
    env_public_id: cloudLink?.state === 'linked'
      ? cloudLink.env_public_id
      : kind === 'controlplane'
        ? envPublicID
        : undefined,
    remote_environment_url: kind === 'controlplane' ? (remoteEnvironmentURL || undefined) : undefined,
    provider_status: remoteRoute.providerEnvironment?.status,
    provider_lifecycle_status: remoteRoute.providerEnvironment?.lifecycle_status,
    provider_last_seen_at_unix_ms: remoteRoute.providerEnvironment?.last_seen_at_unix_ms,
    control_plane_sync_state: kind === 'controlplane'
      ? controlPlaneSummaryByIdentity(controlPlanes, cloudOrigin, cloudID)?.sync_state
      : undefined,
    local_route_state: resolvedLocalRouteState,
    remote_route_state: kind === 'controlplane' ? remoteRoute.remoteRouteState : undefined,
    remote_catalog_freshness: kind === 'controlplane' ? remoteRoute.remoteCatalogFreshness : undefined,
    remote_state_reason: kind === 'controlplane' ? remoteRoute.remoteStateReason : undefined,
    pinned: environment.pinned,
    control_plane_label: kind === 'controlplane'
      ? controlPlaneSummaryByIdentity(controlPlanes, cloudOrigin, cloudID)?.display_label
      : undefined,
    tag: isOpen ? 'Open' : 'Local',
    category: 'local',
    window_state: environmentWindowState(localSession),
    is_open: isOpen,
    is_opening: isOpening,
    runtime_health: runtimeHealth,
    runtime_service: runtimeService,
    runtime_started_at_unix_ms: startedAtUnixMS,
    runtime_maintenance: runtimeMaintenance,
    runtime_operations: runtimeOperations,
    auto_runtime_probe_enabled: environment.auto_runtime_probe_enabled,
    open_session_key: localSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(localSession),
    open_action: localEnvironmentOpenActionLabel({
      isOpen,
      isOpening,
    }),
    can_edit: true,
    can_delete: false,
    created_at_ms: environment.created_at_ms,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function providerRemoteStateReason(remoteRouteState: DesktopProviderRemoteRouteState): string {
  switch (remoteRouteState) {
    case 'ready':
      return 'Remote Desktop is ready.';
    case 'offline':
      return 'Redeven Cloud currently reports this Environment as offline.';
    case 'stale':
      return 'Remote status is stale. Refresh Redeven Cloud to confirm the current state.';
    case 'removed':
      return 'This Environment is no longer published by Redeven Cloud.';
    case 'auth_required':
      return 'Reconnect Redeven Cloud in Desktop to restore remote access.';
    case 'provider_unreachable':
      return 'Desktop could not refresh Redeven Cloud from this device.';
    case 'provider_invalid':
      return 'Redeven Cloud returned an invalid response while Desktop refreshed status.';
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
  environment: DesktopCloudEnvironmentRecord,
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
    environment.cloud_origin,
    environment.cloud_id,
  );
  const providerEnvironment = controlPlaneEnvironmentSummary(
    controlPlanes,
    environment.cloud_origin,
    environment.cloud_id,
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

function buildCloudEnvironmentEntry(
  environment: DesktopCloudEnvironmentRecord,
  controlPlanes: readonly DesktopControlPlaneSummary[],
  openSessions: readonly DesktopSessionSummary[],
  runtimeLinkTargets: readonly DesktopCloudRuntimeLinkTarget[],
): DesktopEnvironmentEntry {
  const sessions = openSessionsByCloudEnvironment(openSessions, environment);
  const remoteSession = sessions.remote_desktop ?? null;
  const routeDetails = providerEnvironmentRouteDetails(environment, controlPlanes);
  // Display identity survives in-flight binding changes; candidate occupancy still requires linked.
  const linkedRuntime = linkedRuntimeTargetForCloudEnvironment(environment, runtimeLinkTargets, true);
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
  const controlPlaneLabel = compact(routeDetails.controlPlane?.display_label) || environment.cloud_origin;
  const label = compact(routeDetails.providerEnvironment?.label)
    || compact(environment.label)
    || environment.env_public_id;
  const effectiveWindowState = effectiveSession
    ? environmentWindowState(effectiveSession)
    : 'closed';
  const startedAtUnixMS = runtimeStartedAtUnixMS(
    effectiveSession?.startup?.started_at_unix_ms,
  );
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
    cloud_linked_runtime_summary: linkedRuntime
      ? {
          runtime_target_id: linkedRuntime.id,
          runtime_kind: linkedRuntime.kind,
          label: linkedRuntime.label,
          provider_connection_state: linkedRuntime.provider_connection_state,
        }
      : undefined,
    cloud_origin: environment.cloud_origin,
    cloud_id: environment.cloud_id,
    env_public_id: environment.env_public_id,
    provider_source_id: routeDetails.controlPlane
      ? desktopControlPlaneKey(routeDetails.controlPlane.cloud.cloud_origin, routeDetails.controlPlane.cloud.cloud_id)
      : undefined,
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
    runtime_started_at_unix_ms: startedAtUnixMS,
    runtime_operations: providerRuntimeOperations(effectiveWindowState === 'open' || routeDetails.remoteRouteState === 'ready'),
    open_session_key: effectiveSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(effectiveSession),
    open_action: localEnvironmentOpenActionLabel({
      isOpen: effectiveWindowState === 'open',
      isOpening: effectiveWindowState === 'opening',
    }),
    can_edit: true,
    can_delete: false,
    created_at_ms: environment.created_at_ms,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function buildEnvironmentEntries(
  preferences: DesktopPreferences,
  controlPlanes: readonly DesktopControlPlaneSummary[],
  openSessions: readonly DesktopSessionSummary[],
  localRuntimeHealth: Readonly<Record<string, DesktopRuntimeHealth>>,
  savedExternalRuntimeHealth: Readonly<Record<string, DesktopRuntimeHealth>>,
  savedRuntimeTargetHealth: Readonly<Record<string, DesktopRuntimeHealth>>,
  managedRuntimePresenceByTargetID: Readonly<Record<string, DesktopRuntimePresence>>,
  platformCapabilities: DesktopPlatformCapabilities,
  redevenCloudOriginPolicy: RedevenCloudOriginPolicy,
): readonly DesktopEnvironmentEntry[] {
  const localLocalEnvironments = platformCapabilities.native_local_environment
    ? [preferences.local_environment]
    : [];
  const visibleSavedRuntimeTargets = preferences.saved_runtime_targets.filter((target) => (
    platformCapabilities.native_host_runtime || target.host_access.kind !== 'local_host'
  ));
  const runtimeEntries = [
    ...localLocalEnvironments.map(environment => buildLocalEnvironmentEntry(
      environment,
      openSessionsByLocalEnvironment(openSessions, environment),
      controlPlanes,
      localRuntimeHealth[environment.id],
      managedRuntimePresenceByTargetID[desktopCloudRuntimeLinkTargetID('local_environment', environment.id)],
      redevenCloudOriginPolicy,
    )),
    ...visibleSavedRuntimeTargets.map(target => buildSavedRuntimeTargetEntry(
      target,
      openSessionByRuntimeTarget(openSessions, target),
      savedRuntimeTargetHealth[target.id],
      managedRuntimePresenceByTargetID[desktopCloudRuntimeLinkTargetID(providerRuntimeLinkKindForHostAccess(target.host_access), target.id)],
      redevenCloudOriginPolicy,
    )),
  ];
  // Runtime cards, Cloud summaries and candidate occupancy share one observed
  // binding, including cached health while a probe withdraws live presence.
  const runtimeLinkTargets = runtimeEntries.flatMap(entry => entry.provider_runtime_link_target ? [entry.provider_runtime_link_target] : []);
  const entries: DesktopEnvironmentEntry[] = [
    ...runtimeEntries.map(entry => ({
      ...entry,
      provider_environment_candidates: entry.provider_runtime_link_target
        ? providerEnvironmentCandidatesForSnapshot(preferences.cloud_environments, controlPlanes, runtimeLinkTargets, entry.provider_runtime_link_target.id)
        : [],
    })),
    ...preferences.cloud_environments.map((environment) => (
      buildCloudEnvironmentEntry(
        environment,
        controlPlanes,
        openSessions,
        runtimeLinkTargets,
      )
    )),
    ...openSessions.flatMap((session) => {
      const target = gatewaySessionTarget(session);
      if (!target) {
        return [];
      }
      return [{
        id: gatewaySessionEnvironmentEntryID(target),
        kind: 'gateway_environment' as const,
        registration_ref: {
          kind: 'gateway_environment' as const,
          gateway_id: target.gateway_id,
          gateway_env_id: target.gateway_env_id,
        },
        label: target.label,
        local_ui_url: session.entry_url ?? session.startup?.local_ui_url ?? '',
        secondary_text: target.gateway_label,
        gateway_id: target.gateway_id,
        gateway_label: target.gateway_label,
        gateway_env_id: target.gateway_env_id,
        gateway_status: 'online' as const,
        gateway_connection_kind: undefined,
        gateway_trust_state: 'paired' as const,
        pinned: false,
        tag: 'Open' as const,
        category: 'gateway' as const,
        window_state: environmentWindowState(session),
        is_open: sessionIsOpen(session),
        is_opening: sessionIsOpening(session),
        runtime_health: onlineRuntimeHealth(
          'gateway_service_probe',
          session.entry_url ?? session.startup?.local_ui_url ?? '',
          session.startup?.runtime_service,
        ),
        runtime_service: session.startup?.runtime_service,
        runtime_operations: gatewayRuntimeOperations(true),
        open_session_key: session.session_key,
        open_session_lifecycle: sessionLifecycle(session),
        open_action: sessionIsOpen(session) ? 'focus' as const : sessionIsOpening(session) ? 'opening' as const : 'open' as const,
        can_edit: false,
        can_delete: false,
        created_at_ms: session.startup?.started_at_unix_ms ?? Date.now(),
        last_used_at_ms: session.startup?.started_at_unix_ms ?? Date.now(),
      }];
    }),
  ];

  const catalog = preferences.saved_environments;
  for (const environment of catalog) {
    entries.push(buildSavedEnvironmentEntry(
      environment,
      openSessionByURL(openSessions, environment.local_ui_url),
      savedExternalRuntimeHealth[environment.id],
    ));
  }

  return sortEnvironmentEntriesByStableOrder(entries);
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
    ?? unknownRuntimeHealth('external_local_ui_probe');
  const startedAtUnixMS = runtimeStartedAtUnixMS(
    openSession?.startup?.started_at_unix_ms,
    savedRuntimeHealth?.started_at_unix_ms,
  );
  const externalOpenable = runtimeHealth.status === 'online'
    || runtimeHealth.offline_reason_code === 'unverified'
    || runtimeHealth.offline_reason_code === 'external_unreachable';
  return {
    id: environment.id,
    kind: 'external_local_ui',
    registration_ref: { kind: 'saved_environment', id: environment.id },
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
    runtime_started_at_unix_ms: startedAtUnixMS,
    runtime_maintenance: runtimeMaintenanceFromHealth(runtimeHealth),
    runtime_operations: externalLocalUIRuntimeOperations(externalOpenable),
    auto_runtime_probe_enabled: environment.auto_runtime_probe_enabled,
    open_session_key: openSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(openSession),
    open_action: isOpen ? 'focus' : isOpening ? 'opening' : 'open',
    can_edit: true,
    can_delete: true,
    created_at_ms: environment.created_at_ms,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function runtimeTargetSecondaryText(target: DesktopSavedRuntimeTarget): string {
  if (target.host_access.kind === 'wsl_host') {
    return `WSL 2 · ${target.host_access.distribution_name} · ${target.host_access.linux_user}`;
  }
  if (target.host_access.kind === 'ssh_host') {
    const ssh = target.host_access.ssh;
    const authority = ssh.ssh_port === null ? ssh.ssh_destination : `${ssh.ssh_destination}:${ssh.ssh_port}`;
    if (target.placement.kind === 'container_process') {
      return `${authority} · ${target.placement.container_label || target.placement.container_id}`;
    }
    return authority;
  }
  if (target.placement.kind === 'container_process') {
    return target.placement.container_label || target.placement.container_id;
  }
  return 'This device';
}

function sshDetailsFromRuntimeTarget(target: DesktopSavedRuntimeTarget): DesktopSSHEnvironmentDetails | undefined {
  if (target.host_access.kind !== 'ssh_host') {
    return undefined;
  }
  const placement = target.placement;
  return {
    ...target.host_access.ssh,
    runtime_root: placement.runtime_root || DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
    bootstrap_strategy: placement.kind === 'host_process'
      ? placement.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY
      : DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
    release_base_url: placement.kind === 'host_process'
      ? placement.release_base_url ?? DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL
      : DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  };
}

function buildSavedRuntimeTargetEntry(
  target: DesktopSavedRuntimeTarget,
  openSession: DesktopSessionSummary | null,
  cachedRuntimeHealth: DesktopRuntimeHealth | undefined,
  presence: DesktopRuntimePresence | undefined,
  redevenCloudOriginPolicy: RedevenCloudOriginPolicy,
): DesktopEnvironmentEntry {
  const probeSource = target.host_access.kind === 'ssh_host'
    ? 'ssh_runtime_probe'
    : target.host_access.kind === 'wsl_host'
      ? 'wsl_runtime_probe'
      : 'local_runtime_probe';
  const isOpen = sessionIsOpen(openSession);
  const isOpening = sessionIsOpening(openSession);
  const sessionRuntimeHealth = (isOpen || isOpening)
    ? onlineRuntimeHealth(
      probeSource,
      openSession?.entry_url ?? openSession?.startup?.local_ui_url ?? '',
      openSession?.startup?.runtime_service,
    )
    : undefined;
  const runtimeHealth = runtimeHealthFromPresence(
    probeSource,
    presence,
    cachedRuntimeHealth
    ?? sessionRuntimeHealth
    ?? unknownRuntimeHealth(probeSource),
  );
  const runtimeObservation = presence ?? cachedRuntimeHealth ?? openSession?.startup;
  const startedAtUnixMS = runtimeStartedAtUnixMS(runtimeObservation?.started_at_unix_ms);
  const runtimeService = preferredRuntimeService(openSession?.startup?.runtime_service, runtimeHealth, presence);
  const targetKind = providerRuntimeLinkKindForHostAccess(target.host_access);
  const providerRuntimeLinkTarget = buildCloudRuntimeLinkTarget({
    id: desktopCloudRuntimeLinkTargetID(targetKind, target.id),
    kind: targetKind,
    environmentID: target.id,
    label: target.label,
    runtimeKey: target.id,
    runtimeURL: presence?.local_ui_url ?? openSession?.entry_url ?? openSession?.startup?.local_ui_url ?? runtimeHealth.local_ui_url ?? '',
    runtimeRunning: runtimeHealth.status === 'online',
    runtimeControlStatus: presence?.runtime_control_status,
    runtimeService,
    redevenCloudOriginPolicy,
  });
  const localUIURLs = runtimeHealth.status !== 'online' ? [] : reportedRuntimeURLs(runtimeObservation);
  const localUIURL = localUIURLs[0] ?? '';
  const effectiveHostAccess = presence?.host_access ?? target.host_access;
  const effectivePlacement = presence?.placement ?? target.placement;
  const runtimeMaintenance = runtimeMaintenanceFromHealth(runtimeHealth);
  const runtimeOperations = managedRuntimeOperations({
    presence,
    hostAccess: effectiveHostAccess,
    placement: effectivePlacement,
    running: runtimeHealth.status === 'online',
    openable: runtimeServiceIsOpenable(runtimeService),
    openConnectionRequired: presence?.open_connection_required === true,
    runtimeService,
    runtimeControlStatus: presence?.runtime_control_status ?? defaultRuntimeControlStatusForRunningState(runtimeHealth.status === 'online'),
    maintenance: runtimeMaintenance,
  });
  const effectiveTarget = {
    ...target,
    host_access: effectiveHostAccess,
    placement: effectivePlacement,
  };
  const managedFields = managedRuntimeEntryFields(presence);
  return {
    id: target.id,
    kind: targetKind,
    registration_ref: { kind: 'runtime_target', id: target.id },
    label: target.label,
    local_ui_url: localUIURL,
    local_ui_urls: localUIURLs,
    secondary_text: runtimeTargetSecondaryText(effectiveTarget),
    ssh_details: sshDetailsFromRuntimeTarget(target),
    ssh_password_configured: target.ssh_password_configured,
    pinned: target.pinned,
    tag: isOpen ? 'Open' : 'Saved',
    category: 'saved',
    window_state: environmentWindowState(openSession),
    is_open: isOpen,
    is_opening: isOpening,
    runtime_health: runtimeHealth,
    runtime_service: runtimeService,
    runtime_started_at_unix_ms: startedAtUnixMS,
    runtime_maintenance: runtimeMaintenance,
    provider_runtime_link_target: providerRuntimeLinkTarget,
    ...managedFields,
    managed_runtime_target_id: desktopRuntimeTargetID(effectiveHostAccess, effectivePlacement),
    managed_runtime_placement_target_id: target.id,
    managed_runtime_host_access: effectiveHostAccess,
    managed_runtime_placement: effectivePlacement,
    runtime_operations: runtimeOperations,
    auto_runtime_probe_enabled: desktopRuntimeTargetAutoStatusDetectionEnabled(
      effectiveHostAccess,
      effectivePlacement,
      target.auto_runtime_probe_enabled,
    ),
    auto_runtime_probe_configurable: desktopRuntimeTargetAutoStatusDetectionConfigurable(
      effectiveHostAccess,
      effectivePlacement,
    ),
    open_session_key: openSession?.session_key ?? '',
    open_session_lifecycle: sessionLifecycle(openSession),
    open_action: isOpen ? 'focus' : isOpening ? 'opening' : 'open',
    can_edit: true,
    can_delete: true,
    created_at_ms: target.created_at_ms,
    last_used_at_ms: target.last_used_at_ms,
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
  const redevenCloudOriginPolicy = args.redevenCloudOriginPolicy ?? { allow_development: false };
  const platformCapabilities = args.platformCapabilities ?? resolveDesktopPlatformCapabilities(process.platform);
  const controlPlanes = args.controlPlanes ?? fallbackControlPlaneSummaries(
    preferences.control_planes,
    preferences.cloud_environments,
  );
  const snapshotPreferences: DesktopPreferences = {
    ...preferences,
    cloud_environments: providerEnvironmentRecordsForSnapshot(preferences.cloud_environments, controlPlanes),
  };
  const openSessions = sortOpenSessions(args.openSessions ?? []);
  const issue = args.issue ?? null;
  const surface = args.surface ?? 'connect_environment';
  const baseEnvironments = buildEnvironmentEntries(
    snapshotPreferences,
    controlPlanes,
    openSessions,
    args.localRuntimeHealth ?? {},
    args.savedExternalRuntimeHealth ?? {},
    args.savedRuntimeTargetHealth ?? {},
    args.managedRuntimePresenceByTargetID ?? {},
    platformCapabilities,
    redevenCloudOriginPolicy,
  );
  // GatewayStore excludes legacy Runtime registrations before this projection.
  // Standalone Gateways retain their explicit URL or managed service transport.
  const gatewaySources = args.gatewaySources ?? [];
  const environments = sortEnvironmentEntriesByStableOrder(aggregateDesktopEnvironmentEntries({
    entries: baseEnvironments,
    controlPlanes,
    gatewaySources,
    localLabel: snapshotPreferences.local_environment.label,
  }));
  const selectedEnvironmentID = args.selectedEnvironmentID ?? '';

  return {
    surface,
    platform_capabilities: platformCapabilities,
    wsl_discovery: args.wslDiscovery ?? null,
    default_flower_runtime_target_id: preferences.default_flower_runtime_target_id,
    navigation_revision: args.navigationRevision ?? 0,
    flower_settings_focus_revision: Math.max(0, Math.floor(Number(args.flowerSettingsFocusRevision ?? 0))),
    entry_reason: args.entryReason ?? 'app_launch',
    close_action: openSessions.length > 0 ? 'close_launcher' : 'quit',
    open_windows: buildOpenEnvironmentWindows(openSessions),
    environments: decorateEnvironmentAccess(environments, preferences),
    gateway_sources: gatewaySources,
    redeven_cloud_origins: redevenCloudAllowedOrigins(redevenCloudOriginPolicy),
    control_planes: controlPlanes,
    action_progress: args.actionProgress ?? [],
    operations: args.operations ?? [],
    suggested_remote_url: suggestedRemoteURL(issue, openSessions, environments),
    issue,
    settings_environment_id: selectedEnvironmentID,
  };
}
