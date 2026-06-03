import type { DesktopSSHEnvironmentDetails } from './desktopSSH';
import type { DesktopContainerEngine } from './desktopRuntimePlacement';

export type DesktopGatewayConnectionKind = 'url' | 'ssh_host' | 'ssh_container';
export type DesktopGatewayManagementCapability = 'access_only' | 'managed_ssh_host' | 'managed_ssh_container';

export type DesktopGatewayCapability =
  | 'env_catalog'
  | 'env_open_session'
  | 'env_profile_write'
  | 'env_lifecycle'
  | 'terminal'
  | 'files'
  | 'web_service'
  | 'port_forward';

export type DesktopGatewayStatus =
  | 'unknown'
  | 'online'
  | 'offline'
  | 'needs_setup'
  | 'installing'
  | 'starting'
  | 'updating'
  | 'trust_changed'
  | 'pairing_required'
  | 'error';

export type DesktopGatewayTrustState =
  | 'unpaired'
  | 'paired'
  | 'trust_changed'
  | 'revoked';

export type DesktopGatewayEnvironmentState =
  | 'available'
  | 'starting'
  | 'stopped'
  | 'unknown'
  | 'archived';

export type DesktopGatewayEnvironmentCapability =
  | 'open'
  | 'start'
  | 'stop'
  | 'restart'
  | 'update_runtime'
  | 'terminal'
  | 'files'
  | 'web_service'
  | 'port_forward';

export type DesktopGatewayEnvironmentOriginKind =
  | 'gateway_host'
  | 'ssh_target'
  | 'container'
  | 'network_target';

export type DesktopGatewayEnvironmentProfileAccessRoute = Readonly<{
  kind: DesktopGatewayConnectionKind;
  url?: string;
  origin_label?: string;
  ssh_destination?: string;
  ssh_port?: number;
  ssh_runtime_root?: string;
  container_engine?: string;
  container_id?: string;
  container_runtime_root?: string;
}>;

export type DesktopGatewayEnvironment = Readonly<{
  gateway_env_id: string;
  display_name: string;
  env_kind: 'managed_local_env' | 'reachable_env';
  state: DesktopGatewayEnvironmentState;
  capabilities: readonly DesktopGatewayEnvironmentCapability[];
  access_capabilities?: readonly DesktopGatewayEnvironmentCapability[];
  control_capabilities?: readonly DesktopGatewayEnvironmentCapability[];
  profile_access_route?: DesktopGatewayEnvironmentProfileAccessRoute;
  origin: Readonly<{
    kind: DesktopGatewayEnvironmentOriginKind;
    label: string;
  }>;
  last_seen_at_unix_ms?: number;
}>;

export type DesktopGatewayRuntimeStatus =
  | 'not_applicable'
  | 'unknown'
  | 'not_started'
  | 'starting'
  | 'ready'
  | 'ssh_unreachable'
  | 'container_unavailable'
  | 'runtime_needs_update'
  | 'bridge_unavailable'
  | 'error';

export type DesktopGatewayRuntimeState = Readonly<{
  status: DesktopGatewayRuntimeStatus;
  can_start: boolean;
  can_stop: boolean;
  can_restart: boolean;
  can_update: boolean;
  can_pair_after_start: boolean;
  runtime_target_id?: string;
  runtime_state_root?: string;
  message?: string;
  checked_at_unix_ms?: number;
  lifecycle_operation_key?: string;
}>;

export type DesktopGatewaySyncState =
  | 'idle'
  | 'syncing'
  | 'ready'
  | 'gateway_unreachable'
  | 'pairing_failed'
  | 'catalog_failed';

export type DesktopGatewaySource = Readonly<{
  gateway_id: string;
  display_name: string;
  connection_kind: DesktopGatewayConnectionKind;
  management_capability: DesktopGatewayManagementCapability;
  capabilities: readonly DesktopGatewayCapability[];
  status: DesktopGatewayStatus;
  trust_state?: DesktopGatewayTrustState;
  status_message?: string;
  endpoint_label?: string;
  gateway_url?: string;
  allow_loopback_http?: boolean;
  ssh_details?: DesktopSSHEnvironmentDetails;
  ssh_password_configured?: boolean;
  container_engine?: DesktopContainerEngine;
  container_id?: string;
  container_ref?: string;
  container_label?: string;
  runtime_state?: DesktopGatewayRuntimeState;
  sync_state?: DesktopGatewaySyncState;
  last_sync_attempt_at_ms?: number;
  last_synced_at_ms?: number;
  last_sync_error_code?: string;
  last_sync_error_message?: string;
  created_at_ms: number;
  updated_at_ms: number;
  environments: readonly DesktopGatewayEnvironment[];
}>;

export type DesktopEnvironmentSourceKind = 'local' | 'provider' | 'gateway';

export type DesktopEnvironmentSource = Readonly<{
  kind: DesktopEnvironmentSourceKind;
  source_id: string;
  label: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function desktopGatewaySourceID(gatewayID: string): string {
  const cleanGatewayID = compact(gatewayID);
  return cleanGatewayID ? `gateway:${cleanGatewayID}` : '';
}

export function desktopGatewayEnvironmentEntryID(
  gatewayID: string,
  gatewayEnvID: string,
): string {
  const cleanGatewayID = compact(gatewayID);
  const cleanGatewayEnvID = compact(gatewayEnvID);
  return cleanGatewayID && cleanGatewayEnvID
    ? `gateway:${cleanGatewayID}:env:${cleanGatewayEnvID}`
    : '';
}

export function desktopGatewayProfileURLHasEmbeddedCredentials(value: string | undefined): boolean {
  const raw = compact(value);
  if (!raw) {
    return false;
  }
  try {
    const parsed = new URL(raw);
    return parsed.username !== '' || parsed.password !== '';
  } catch {
    return false;
  }
}

export function desktopGatewayConnectionKindLabel(kind: DesktopGatewayConnectionKind): string {
  switch (kind) {
    case 'url':
      return 'URL transport';
    case 'ssh_host':
      return 'SSH host';
    case 'ssh_container':
      return 'SSH container';
  }
}

export function desktopGatewayManagementCapability(
  kind: DesktopGatewayConnectionKind,
): DesktopGatewayManagementCapability {
  switch (kind) {
    case 'url':
      return 'access_only';
    case 'ssh_host':
      return 'managed_ssh_host';
    case 'ssh_container':
      return 'managed_ssh_container';
  }
}

export function desktopGatewayCanManageRuntime(
  gateway: Pick<DesktopGatewaySource, 'management_capability'>,
): boolean {
  return gateway.management_capability === 'managed_ssh_host'
    || gateway.management_capability === 'managed_ssh_container';
}

export function desktopGatewayStatusLabel(status: DesktopGatewayStatus): string {
  switch (status) {
    case 'online':
      return 'Online';
    case 'offline':
      return 'Offline';
    case 'needs_setup':
      return 'Needs setup';
    case 'installing':
      return 'Installing';
    case 'starting':
      return 'Starting';
    case 'updating':
      return 'Updating';
    case 'trust_changed':
      return 'Trust changed';
    case 'pairing_required':
      return 'Pairing required';
    case 'error':
      return 'Needs attention';
    case 'unknown':
      return 'Unknown';
  }
}

export function desktopGatewayNeedsResolution(status: DesktopGatewayStatus): boolean {
  switch (status) {
    case 'offline':
    case 'needs_setup':
    case 'trust_changed':
    case 'pairing_required':
    case 'error':
    case 'unknown':
      return true;
    case 'online':
    case 'installing':
    case 'starting':
    case 'updating':
      return false;
  }
}

export function desktopGatewayCanOpenEnvironment(
  gateway: Pick<DesktopGatewaySource, 'status'>,
  environment: Pick<DesktopGatewayEnvironment, 'state' | 'capabilities' | 'access_capabilities'>,
): boolean {
  const explicitAccessCapabilities = environment.access_capabilities ?? [];
  const accessCapabilities: readonly DesktopGatewayEnvironmentCapability[] = explicitAccessCapabilities.length > 0
    ? explicitAccessCapabilities
    : environment.capabilities;
  return gateway.status === 'online'
    && environment.state === 'available'
    && accessCapabilities.includes('open');
}

export function desktopGatewayEnvironmentHasControlCapability(
  environment: Pick<DesktopGatewayEnvironment, 'capabilities' | 'control_capabilities'>,
  capability: Extract<DesktopGatewayEnvironmentCapability, 'start' | 'stop' | 'restart' | 'update_runtime'>,
): boolean {
  const explicitControlCapabilities = environment.control_capabilities ?? [];
  const controlCapabilities: readonly DesktopGatewayEnvironmentCapability[] = explicitControlCapabilities.length > 0
    ? explicitControlCapabilities
    : environment.capabilities;
  return controlCapabilities.includes(capability);
}
