import {
  desktopRuntimeOperationPlan,
  hiddenDesktopRuntimeOperationPlan,
  type DesktopRuntimeOperationPlans,
} from '../shared/desktopRuntimeOperations';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import {
  desktopGatewayCanOpenEnvironment,
  desktopGatewayEnvironmentHasControlCapability,
  desktopGatewayEnvironmentEntryID,
  desktopGatewayNeedsResolution,
  desktopGatewaySourceID,
  type DesktopEnvironmentSource,
  type DesktopGatewayEnvironment,
  type DesktopGatewaySource,
} from '../shared/desktopGateway';
import {
  gatewayEnvironmentSource,
  localEnvironmentSource,
  providerEnvironmentSource,
} from './environmentSourceRegistry';
import type { DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function environmentSourceForEntry(
  entry: DesktopEnvironmentEntry,
  sources: readonly DesktopEnvironmentSource[],
): DesktopEnvironmentSource {
  const sourceID = compact(entry.environment_source?.source_id);
  if (sourceID && entry.environment_source) {
    return entry.environment_source;
  }
  if (entry.kind === 'gateway_environment') {
    const gatewaySourceID = desktopGatewaySourceID(entry.gateway_id ?? '');
    const gatewaySource = sources.find((source) => source.source_id === gatewaySourceID);
    return gatewaySource ?? {
      kind: 'gateway',
      source_id: gatewaySourceID || 'gateway:unknown',
      label: compact(entry.gateway_label) || 'Gateway',
    };
  }
  if (entry.kind === 'provider_environment') {
    const providerSource = sources.find((source) => (
      source.kind === 'provider'
      && source.source_id === entry.provider_source_id
    ));
    return providerSource ?? {
      kind: 'provider',
      source_id: compact(entry.provider_source_id) || 'provider:unknown',
      label: compact(entry.control_plane_label) || 'Provider',
    };
  }
  if (entry.kind === 'local_environment') {
    return localEnvironmentSource(entry.label);
  }
  return {
    kind: 'local',
    source_id: 'local',
    label: 'Saved',
  };
}

export function attachEnvironmentSources(
  entries: readonly DesktopEnvironmentEntry[],
  sources: readonly DesktopEnvironmentSource[],
): readonly DesktopEnvironmentEntry[] {
  return entries.map((entry) => ({
    ...entry,
    environment_source: environmentSourceForEntry(entry, sources),
  }));
}

export type BuildGatewayEnvironmentEntriesInput = Readonly<{
  gatewaySources: readonly DesktopGatewaySource[];
  openSessions?: readonly DesktopEnvironmentEntry[];
  createdAtMS?: number;
}>;

export function buildGatewayEnvironmentEntries(
  input: BuildGatewayEnvironmentEntriesInput,
): readonly DesktopEnvironmentEntry[] {
  const createdAtMS = input.createdAtMS ?? Date.now();
  const entries: DesktopEnvironmentEntry[] = [];
  const matchedOpenSessionKeys = new Set<string>();
  for (const gateway of input.gatewaySources) {
    const source = gatewayEnvironmentSource(gateway);
    if (!source) {
      continue;
    }
    for (const environment of gateway.environments) {
      const entry = buildGatewayEnvironmentEntry(gateway, environment, source, createdAtMS, input.openSessions ?? []);
      if (entry) {
        if (entry.open_session_key) {
          matchedOpenSessionKeys.add(entry.open_session_key);
        }
        entries.push(entry);
      }
    }
  }
  return [
    ...entries,
    ...(input.openSessions ?? []).filter((entry) => (
      entry.open_session_key && !matchedOpenSessionKeys.has(entry.open_session_key)
    )),
  ];
}

function buildGatewayEnvironmentEntry(
  gateway: DesktopGatewaySource,
  environment: DesktopGatewayEnvironment,
  source: DesktopEnvironmentSource,
  createdAtMS: number,
  openSessionEntries: readonly DesktopEnvironmentEntry[],
): DesktopEnvironmentEntry | null {
  const id = desktopGatewayEnvironmentEntryID(gateway.gateway_id, environment.gateway_env_id);
  if (!id) {
    return null;
  }
  const displayName = compact(environment.display_name) || environment.gateway_env_id;
  const gatewayLabel = compact(gateway.display_name) || gateway.gateway_id;
  const accessCapabilities = environment.access_capabilities ?? [];
  const controlCapabilities = environment.control_capabilities ?? [];
  const isOpenable = desktopGatewayCanOpenEnvironment(gateway, environment);
  const needsResolve = desktopGatewayNeedsResolution(gateway.status);
  const canWriteGatewayProfile = gateway.status === 'online'
    && gateway.capabilities.includes('env_profile_write');
  const hasManagedGatewayProfile = environment.profile?.managed === true
    && !!environment.profile.access_route_kind;
  const hasEditableGatewayProfile = hasManagedGatewayProfile
    && !!environment.profile_access_route
    && environment.profile_access_route.kind === environment.profile?.access_route_kind;
  const canEditGatewayProfile = canWriteGatewayProfile && hasEditableGatewayProfile;
  const hasGatewayLifecycleControl = gateway.status === 'online'
    && gateway.capabilities.includes('env_lifecycle');
  const canStart = hasGatewayLifecycleControl
    && environment.state === 'stopped'
    && desktopGatewayEnvironmentHasControlCapability(environment, 'start');
  const canStop = hasGatewayLifecycleControl
    && environment.state === 'available'
    && desktopGatewayEnvironmentHasControlCapability(environment, 'stop');
  const canRestart = hasGatewayLifecycleControl
    && (environment.state === 'available' || environment.state === 'stopped')
    && desktopGatewayEnvironmentHasControlCapability(environment, 'restart');
  const canUpdate = hasGatewayLifecycleControl
    && (environment.state === 'available' || environment.state === 'stopped')
    && desktopGatewayEnvironmentHasControlCapability(environment, 'update_runtime');
  const openSession = openSessionEntries.find((entry) => (
    entry.gateway_id === gateway.gateway_id
    && entry.gateway_env_id === environment.gateway_env_id
  )) ?? null;
  const runtimeOperations = gatewayRuntimeOperations({
    openable: isOpenable,
    canStart,
    canStop,
    canRestart,
    canUpdate,
    needsResolve,
  });
  const windowState = openSession?.window_state ?? 'closed';
  return {
    id,
    kind: 'gateway_environment',
    label: displayName,
    local_ui_url: '',
    secondary_text: environment.origin.label || gatewayLabel,
    gateway_id: gateway.gateway_id,
    gateway_label: gatewayLabel,
    gateway_env_id: environment.gateway_env_id,
    gateway_status: gateway.status,
    gateway_connection_kind: gateway.connection_kind,
    gateway_trust_state: gateway.trust_state,
    gateway_status_message: gateway.status_message,
    gateway_endpoint_label: gateway.endpoint_label,
    gateway_environment_state: environment.state,
    gateway_environment_kind: environment.env_kind,
    gateway_environment_capabilities: environment.capabilities,
    gateway_environment_access_capabilities: accessCapabilities,
    gateway_environment_control_capabilities: controlCapabilities,
    gateway_environment_profile: environment.profile,
    gateway_environment_profile_access_route: environment.profile_access_route,
    gateway_environment_origin: environment.origin,
    environment_source: source,
    pinned: false,
    tag: gateway.status === 'online' ? 'Gateway' : 'Resolve',
    category: 'gateway',
    window_state: windowState,
    is_open: windowState === 'open',
    is_opening: windowState === 'opening',
    runtime_health: {
      status: isOpenable || canStart ? 'online' : 'offline',
      checked_at_unix_ms: Date.now(),
      source: 'gateway_service_probe',
      freshness: needsResolve ? 'failed' : 'fresh',
      offline_reason_code: gatewayOfflineReasonCode(gateway.status, environment.state),
      offline_reason: gatewayOfflineReason(gateway, environment),
    },
    runtime_operations: runtimeOperations,
    open_session_key: openSession?.open_session_key ?? '',
    open_session_lifecycle: openSession?.open_session_lifecycle,
    open_action: windowState === 'open' ? 'focus' : windowState === 'opening' ? 'opening' : 'open',
    can_edit: canEditGatewayProfile,
    can_delete: canWriteGatewayProfile && hasManagedGatewayProfile,
    created_at_ms: createdAtMS,
    last_used_at_ms: environment.last_seen_at_unix_ms ?? gateway.updated_at_ms,
  };
}

function gatewayRuntimeOperations(input: Readonly<{
  openable: boolean;
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
  canUpdate: boolean;
  needsResolve: boolean;
}>): DesktopRuntimeOperationPlans {
  const hidden = {
    open: hiddenDesktopRuntimeOperationPlan('open'),
    refresh: hiddenDesktopRuntimeOperationPlan('refresh'),
    start: hiddenDesktopRuntimeOperationPlan('start'),
    stop: hiddenDesktopRuntimeOperationPlan('stop'),
    restart: hiddenDesktopRuntimeOperationPlan('restart'),
    update: hiddenDesktopRuntimeOperationPlan('update'),
    connect_provider: hiddenDesktopRuntimeOperationPlan('connect_provider'),
    disconnect_provider: hiddenDesktopRuntimeOperationPlan('disconnect_provider'),
  };
  return {
    ...hidden,
    open: desktopRuntimeOperationPlan(
      'open',
      input.openable ? 'available' : 'blocked',
      'runtime_gateway',
      {
        reasonCode: input.openable
          ? undefined
          : input.needsResolve
            ? 'gateway_requires_resolution'
            : 'gateway_environment_not_openable',
        message: input.openable
          ? undefined
          : input.needsResolve
            ? 'Resolve this Gateway before opening the environment.'
            : 'This Gateway environment is not openable right now.',
      },
    ),
    refresh: desktopRuntimeOperationPlan('refresh', 'available', 'runtime_gateway', {
      label: 'Refresh Gateway status',
    }),
    start: desktopRuntimeOperationPlan(
      'start',
      input.canStart ? 'available' : 'hidden',
      'runtime_gateway',
      {
        label: 'Start through Gateway',
        menuVisibility: input.canStart ? 'contextual' : 'hidden',
      },
    ),
    stop: desktopRuntimeOperationPlan(
      'stop',
      input.canStop ? 'available' : 'hidden',
      'runtime_gateway',
      {
        label: 'Stop through Gateway',
        menuVisibility: input.canStop ? 'stable' : 'hidden',
      },
    ),
    restart: desktopRuntimeOperationPlan(
      'restart',
      input.canRestart ? 'available' : 'hidden',
      'runtime_gateway',
      {
        label: 'Restart through Gateway',
        menuVisibility: input.canRestart ? 'stable' : 'hidden',
      },
    ),
    update: desktopRuntimeOperationPlan(
      'update',
      input.canUpdate ? 'available' : 'hidden',
      'runtime_gateway',
      {
        label: 'Update through Gateway',
        menuVisibility: input.canUpdate ? 'stable' : 'hidden',
      },
    ),
  };
}

function gatewayOfflineReasonCode(
  gatewayStatus: DesktopGatewaySource['status'],
  environmentState: DesktopGatewayEnvironment['state'],
): NonNullable<DesktopEnvironmentEntry['runtime_health']['offline_reason_code']> | undefined {
  if (gatewayStatus === 'online' && (environmentState === 'available' || environmentState === 'stopped')) {
    return undefined;
  }
  switch (gatewayStatus) {
    case 'pairing_required':
    case 'trust_changed':
      return 'auth_required';
    case 'offline':
    case 'needs_setup':
    case 'error':
    case 'unknown':
    case 'installing':
    case 'starting':
    case 'updating':
    case 'online':
      return 'gateway_unavailable';
  }
}

function gatewayOfflineReason(
  gateway: DesktopGatewaySource,
  environment: DesktopGatewayEnvironment,
): string | undefined {
  if (gateway.status === 'online' && environment.state === 'available') {
    return undefined;
  }
  const message = compact(gateway.status_message);
  if (message) {
    return message;
  }
  switch (gateway.status) {
    case 'pairing_required':
      return 'Pair this Gateway before opening environments through it.';
    case 'trust_changed':
      return 'Review the Gateway identity change before opening environments through it.';
    case 'offline':
      return 'The Gateway is offline.';
    case 'needs_setup':
      return 'Set up this Gateway before opening environments through it.';
    case 'error':
      return 'This Gateway needs attention.';
    case 'installing':
    case 'starting':
    case 'updating':
      return 'The Gateway is preparing. Try again after it is ready.';
    case 'unknown':
      return 'Gateway status has not been checked yet.';
    case 'online':
      return environment.state === 'stopped'
        ? 'Start this Gateway-managed environment before opening it.'
        : 'This Gateway environment is not available right now.';
  }
}

export type AggregateDesktopEnvironmentEntriesInput = Readonly<{
  entries: readonly DesktopEnvironmentEntry[];
  controlPlanes?: readonly DesktopControlPlaneSummary[];
  gatewaySources?: readonly DesktopGatewaySource[];
  localLabel?: string;
  gatewayEntriesCreatedAtMS?: number;
}>;

export function aggregateDesktopEnvironmentEntries(
  input: AggregateDesktopEnvironmentEntriesInput,
): readonly DesktopEnvironmentEntry[] {
  const sources: DesktopEnvironmentSource[] = [];
  sources.push(localEnvironmentSource(input.localLabel));
  for (const controlPlane of input.controlPlanes ?? []) {
    const source = providerEnvironmentSource(controlPlane);
    if (source) {
      sources.push(source);
    }
  }
  for (const gateway of input.gatewaySources ?? []) {
    const source = gatewayEnvironmentSource(gateway);
    if (source) {
      sources.push(source);
    }
  }
  const gatewayOpenSessions = input.entries.filter((entry) => entry.kind === 'gateway_environment');
  const nonGatewayEntries = input.entries.filter((entry) => entry.kind !== 'gateway_environment');
  return [
    ...attachEnvironmentSources(nonGatewayEntries, sources),
    ...buildGatewayEnvironmentEntries({
      gatewaySources: input.gatewaySources ?? [],
      openSessions: gatewayOpenSessions,
      createdAtMS: input.gatewayEntriesCreatedAtMS,
    }),
  ];
}
