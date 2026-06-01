export type DesktopGatewayConnectionKind = 'url' | 'ssh_host' | 'ssh_container';

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

export type DesktopGatewayEnvironment = Readonly<{
  gateway_env_id: string;
  display_name: string;
  env_kind: 'managed_local_env' | 'reachable_env';
  state: DesktopGatewayEnvironmentState;
  capabilities: readonly DesktopGatewayEnvironmentCapability[];
  origin: Readonly<{
    kind: DesktopGatewayEnvironmentOriginKind;
    label: string;
  }>;
  last_seen_at_unix_ms?: number;
}>;

export type DesktopGatewaySource = Readonly<{
  gateway_id: string;
  display_name: string;
  connection_kind: DesktopGatewayConnectionKind;
  status: DesktopGatewayStatus;
  trust_state?: DesktopGatewayTrustState;
  status_message?: string;
  endpoint_label?: string;
  gateway_url?: string;
  allow_loopback_http?: boolean;
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
  environment: Pick<DesktopGatewayEnvironment, 'state' | 'capabilities'>,
): boolean {
  return gateway.status === 'online'
    && environment.state === 'available'
    && environment.capabilities.includes('open');
}
