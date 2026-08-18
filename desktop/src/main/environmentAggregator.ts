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
  const disabledGatewayIDs = new Set(
    input.gatewaySources
      .filter((gateway) => gateway.local_enabled === false)
      .map((gateway) => gateway.gateway_id),
  );
  for (const gateway of input.gatewaySources) {
    if (gateway.local_enabled === false) {
      continue;
    }
    const source = gatewayEnvironmentSource(gateway);
    if (!source) {
      continue;
    }
    for (const environment of gateway.environments) {
      const entry = buildGatewayEnvironmentEntry(gateway, environment, source, createdAtMS);
      if (entry) {
        entries.push(entry);
      }
    }
  }
  const sources = input.gatewaySources
    .map(gatewayEnvironmentSource)
    .filter((source): source is DesktopEnvironmentSource => source !== null);
  const openSessionEntries = attachEnvironmentSources(
    (input.openSessions ?? []).filter((entry) => (
      entry.open_session_key
      && !(entry.kind === 'gateway_environment' && entry.gateway_id && disabledGatewayIDs.has(entry.gateway_id))
    )),
    sources,
  );
  return [
    ...entries,
    ...openSessionEntries,
  ];
}

function buildGatewayEnvironmentEntry(
  gateway: DesktopGatewaySource,
  environment: DesktopGatewayEnvironment,
  source: DesktopEnvironmentSource,
  createdAtMS: number,
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
  const runtimeOperations = gatewayRuntimeOperations({
    openable: isOpenable,
    canStart,
    canStop,
    canRestart,
    canUpdate,
    needsResolve,
  });
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
    runtime_management: environment.runtime_management,
    environment_source: source,
    pinned: false,
    tag: gateway.status === 'online' ? 'Gateway' : 'Resolve',
    category: 'gateway',
    window_state: 'closed',
    is_open: false,
    is_opening: false,
    runtime_health: {
      status: isOpenable || canStart ? 'online' : 'offline',
      checked_at_unix_ms: Date.now(),
      source: 'gateway_service_probe',
      freshness: needsResolve ? 'failed' : 'fresh',
      offline_reason_code: gatewayOfflineReasonCode(gateway.status, environment.state),
      offline_reason: gatewayOfflineReason(gateway, environment),
    },
    runtime_operations: runtimeOperations,
    open_session_key: '',
    open_session_lifecycle: undefined,
    open_action: 'open',
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
      label: 'Refresh Gateway',
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
      return 'This Gateway has an issue.';
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
  const gatewaySources = input.gatewaySources ?? [];
  const projectedDirectEntries = nonGatewayEntries.map((entry) => (
    projectDirectRuntimeManagement(entry, gatewaySources)
  ));
  const gatewaySourcesForCards = gatewaySources.map((gateway) => {
    const projectedOntoDirectCard = nonGatewayEntries.some((entry) => (
      entry.kind !== 'provider_environment'
      && entry.kind !== 'external_local_ui'
      && gatewayMatchesDirectRuntimeTarget(gateway, entry)
    ));
    return projectedOntoDirectCard
      ? {
          ...gateway,
          environments: gateway.environments.filter((environment) => environment.gateway_env_id !== 'env_local'),
        }
      : gateway;
  });
  return [
    ...attachEnvironmentSources(projectedDirectEntries, sources),
    ...buildGatewayEnvironmentEntries({
      gatewaySources: gatewaySourcesForCards,
      openSessions: gatewayOpenSessions,
      createdAtMS: input.gatewayEntriesCreatedAtMS,
    }),
  ];
}

function gatewayMatchesDirectRuntimeTarget(
  gateway: DesktopGatewaySource,
  entry: DesktopEnvironmentEntry,
): boolean {
  const hostAccess = entry.managed_runtime_host_access;
  const placement = entry.managed_runtime_placement;
  if (!hostAccess || !placement || compact(gateway.runtime_root) !== compact(placement.runtime_root)) {
    return false;
  }
  if (hostAccess.kind === 'local_host') {
    if (placement.kind === 'host_process') {
      return gateway.connection_kind === 'local_host';
    }
    return gateway.connection_kind === 'local_container'
      && gateway.container_engine === placement.container_engine
      && gateway.container_id === placement.container_id;
  }
  const gatewaySSH = gateway.ssh_details;
  if (!gatewaySSH
    || gatewaySSH.ssh_destination !== hostAccess.ssh.ssh_destination
    || (gatewaySSH.ssh_port ?? null) !== (hostAccess.ssh.ssh_port ?? null)) {
    return false;
  }
  if (placement.kind === 'host_process') {
    return gateway.connection_kind === 'ssh_host';
  }
  return gateway.connection_kind === 'ssh_container'
    && gateway.container_engine === placement.container_engine
    && gateway.container_id === placement.container_id;
}

function directRuntimeGatewayOperations(
  entry: DesktopEnvironmentEntry,
  gateway: DesktopGatewaySource,
  environment: DesktopGatewayEnvironment | undefined,
): DesktopRuntimeOperationPlans {
  if (!environment || gateway.status !== 'online') {
    const message = gateway.status === 'pairing_required'
      ? 'Initialize this environment before using lifecycle actions.'
      : 'Lifecycle actions are temporarily unavailable. Try again shortly.';
    const reasonCode = gateway.status === 'pairing_required'
      ? 'runtime_gateway_setup_required'
      : 'runtime_gateway_temporarily_unavailable';
    const blocked = (operation: 'start' | 'stop' | 'restart' | 'update') => desktopRuntimeOperationPlan(
      operation,
      'blocked',
      'runtime_gateway',
      {
        reasonCode,
        message,
        menuVisibility: operation === 'start' ? 'contextual' : 'stable',
      },
    );
    return {
      ...entry.runtime_operations,
      start: blocked('start'),
      stop: blocked('stop'),
      restart: blocked('restart'),
      update: blocked('update'),
    };
  }
  const hasLifecycle = gateway.capabilities.includes('env_lifecycle');
  const gatewayOperations = gatewayRuntimeOperations({
    openable: false,
    canStart: hasLifecycle
      && environment.state === 'stopped'
      && desktopGatewayEnvironmentHasControlCapability(environment, 'start'),
    canStop: hasLifecycle
      && environment.state === 'available'
      && desktopGatewayEnvironmentHasControlCapability(environment, 'stop'),
    canRestart: hasLifecycle
      && (environment.state === 'available' || environment.state === 'stopped')
      && desktopGatewayEnvironmentHasControlCapability(environment, 'restart'),
    canUpdate: hasLifecycle
      && (environment.state === 'available' || environment.state === 'stopped')
      && desktopGatewayEnvironmentHasControlCapability(environment, 'update_runtime'),
    needsResolve: false,
  });
  return {
    ...entry.runtime_operations,
    start: gatewayOperations.start,
    stop: gatewayOperations.stop,
    restart: gatewayOperations.restart,
    update: gatewayOperations.update,
  };
}

function projectDirectRuntimeManagement(
  entry: DesktopEnvironmentEntry,
  gatewaySources: readonly DesktopGatewaySource[],
): DesktopEnvironmentEntry {
  if (
    entry.kind === 'provider_environment'
    || entry.kind === 'gateway_environment'
    || entry.kind === 'external_local_ui'
  ) {
    return entry;
  }
  const gateway = gatewaySources.find((candidate) => gatewayMatchesDirectRuntimeTarget(candidate, entry));
  if (!gateway) {
    return {
      ...entry,
      runtime_management: {
        support: 'supported',
        authorization: {
          state: 'allowed',
          grants: ['manage_runtime', 'deploy_custom_runtime', 'manage_runtime_binding'],
        },
        readiness: 'setup_required',
        presentation_state: 'setup_required',
        operations: [],
        artifact_policies: [],
        binding_actions: ['setup_gateway'],
        supervision_mode: 'redeven_gateway',
        reason_code: 'runtime_gateway_setup_required',
        checked_at_unix_ms: Date.now(),
      },
    };
  }
  const environment = gateway.environments.find((candidate) => candidate.gateway_env_id === 'env_local');
  const fallbackManagement = {
    support: 'supported' as const,
    authorization: {
      state: gateway.trust_state === 'paired' ? 'allowed' as const : 'unknown' as const,
      ...(gateway.trust_state === 'paired' ? {
        grants: ['manage_runtime', 'deploy_custom_runtime', 'manage_runtime_binding'] as const,
      } : {}),
    },
    readiness: gateway.status === 'pairing_required' ? 'setup_required' as const : 'temporarily_unavailable' as const,
    presentation_state: gateway.status === 'pairing_required' ? 'setup_required' as const : 'temporarily_unavailable' as const,
    reason_code: gateway.status === 'pairing_required'
      ? 'runtime_gateway_setup_required'
      : 'runtime_gateway_temporarily_unavailable',
    checked_at_unix_ms: Date.now(),
  };
  return {
    ...entry,
    gateway_id: gateway.gateway_id,
    gateway_label: gateway.display_name,
    gateway_env_id: environment?.gateway_env_id ?? 'env_local',
    gateway_status: gateway.status,
    gateway_connection_kind: gateway.connection_kind,
    gateway_trust_state: gateway.trust_state,
    gateway_status_message: gateway.status_message,
    gateway_endpoint_label: gateway.endpoint_label,
    gateway_environment_state: environment?.state,
    gateway_environment_kind: environment?.env_kind,
    gateway_environment_capabilities: environment?.capabilities,
    gateway_environment_access_capabilities: environment?.access_capabilities,
    gateway_environment_control_capabilities: environment?.control_capabilities,
    gateway_environment_origin: environment?.origin,
    runtime_management: environment?.runtime_management ?? fallbackManagement,
    runtime_operations: directRuntimeGatewayOperations(entry, gateway, environment),
  };
}
