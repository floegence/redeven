import { desktopRuntimeOperationPlan, hiddenDesktopRuntimeOperationPlan, type DesktopRuntimeOperationPlans } from '../shared/desktopRuntimeOperations';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import {
  desktopGatewayCanOpenEnvironment,
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
import type { DesktopControlPlaneSummary } from '../shared/cloud';

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
  const id = desktopGatewayEnvironmentEntryID(gateway.gateway_id, environment.member_id);
  if (!id) {
    return null;
  }
  const displayName = compact(environment.display_name) || environment.member_id;
  const gatewayLabel = compact(gateway.display_name) || gateway.gateway_id;
  const isOpenable = desktopGatewayCanOpenEnvironment(gateway, environment);
  const needsResolve = desktopGatewayNeedsResolution(gateway.status);
  const runtimeOperations = gatewayRuntimeOperations({
    openable: isOpenable,
    needsResolve,
  });
  return {
    id,
    kind: 'gateway_environment',
    registration_ref: {
      kind: 'gateway_environment',
      gateway_id: gateway.gateway_id,
      gateway_env_id: environment.member_id,
    },
    label: displayName,
    local_ui_url: '',
    secondary_text: environment.metadata.hostname || gatewayLabel,
    gateway_id: gateway.gateway_id,
    gateway_identity_fingerprint: gateway.identity_fingerprint,
    gateway_label: gatewayLabel,
    gateway_env_id: environment.member_id,
    gateway_status: gateway.status,
    gateway_connection_kind: gateway.connection_kind,
    gateway_trust_state: gateway.trust_state,
    gateway_status_message: gateway.status_message,
    gateway_endpoint_label: gateway.endpoint_label,
    gateway_member: environment,
    gateway_access_result: environment.last_access_result,
    gateway_sync_state: gateway.sync_state,
    environment_source: source,
    pinned: false,
    tag: gateway.status === 'online' ? 'Gateway' : 'Resolve',
    category: 'gateway',
    window_state: 'closed',
    is_open: false,
    is_opening: false,
    runtime_health: {
      status: 'offline',
      checked_at_unix_ms: 0,
      source: 'gateway_service_probe',
      freshness: 'unknown',
      offline_reason_code: gatewayOfflineReasonCode(gateway.status, environment),
      offline_reason: gatewayOfflineReason(gateway, environment),
    },
    runtime_operations: runtimeOperations,
    open_session_key: '',
    open_session_lifecycle: undefined,
    open_action: 'open',
    can_edit: false,
    can_delete: false,
    created_at_ms: createdAtMS,
    last_used_at_ms: environment.last_seen_at_unix_ms ?? gateway.updated_at_ms,
  };
}

function gatewayRuntimeOperations(input: Readonly<{
  openable: boolean;
  needsResolve: boolean;
}>): DesktopRuntimeOperationPlans {
  const hidden = {
    open: hiddenDesktopRuntimeOperationPlan('open'),
    refresh: hiddenDesktopRuntimeOperationPlan('refresh'),
    start: hiddenDesktopRuntimeOperationPlan('start'),
    stop: hiddenDesktopRuntimeOperationPlan('stop'),
    restart: hiddenDesktopRuntimeOperationPlan('restart'),
    update: hiddenDesktopRuntimeOperationPlan('update'),
    connect_cloud: hiddenDesktopRuntimeOperationPlan('connect_cloud'),
    disconnect_cloud: hiddenDesktopRuntimeOperationPlan('disconnect_cloud'),
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
  };
}

function gatewayOfflineReasonCode(
  gatewayStatus: DesktopGatewaySource['status'],
  member: DesktopGatewayEnvironment,
): NonNullable<DesktopEnvironmentEntry['runtime_health']['offline_reason_code']> | undefined {
  if (gatewayStatus === 'online' && member.state === 'active' && member.connected) {
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
  if (gateway.status === 'online' && environment.state === 'active' && environment.connected) {
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
      return 'This Runtime member is not connected to its Gateway.';
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
