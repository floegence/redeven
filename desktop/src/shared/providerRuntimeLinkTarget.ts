import type {
  RuntimeServiceProviderConnectionState,
  RuntimeServiceCloudLinkBinding,
  RuntimeServiceCloudLinkState,
  RuntimeServiceSnapshot,
} from './runtimeService';
import type { DesktopRuntimeControlStatus } from './desktopRuntimePresence';

export type DesktopCloudRuntimeLinkTargetKind = 'local_environment' | 'wsl_environment' | 'ssh_environment';

export type DesktopCloudRuntimeLinkTargetID = `local:${string}` | `wsl:${string}` | `ssh:${string}`;

export type DesktopCloudEnvironmentOccupancyState =
  | 'available'
  | 'linked_here'
  | 'occupied_by_known_runtime'
  | 'occupied_by_provider_online_runtime';

export type DesktopCloudEnvironmentOccupancy = Readonly<{
  state: DesktopCloudEnvironmentOccupancyState;
  runtime_target_id?: DesktopCloudRuntimeLinkTargetID;
  runtime_kind?: DesktopCloudRuntimeLinkTargetKind;
  runtime_label?: string;
  provider_connection_state?: RuntimeServiceProviderConnectionState;
}>;

export type DesktopCloudEnvironmentCandidate = Readonly<{
  provider_environment_id: string;
  label: string;
  cloud_origin: string;
  cloud_id: string;
  env_public_id: string;
  access_point_origin: string;
  provider_label?: string;
  route_state: 'online' | 'offline' | 'unknown';
  occupancy: DesktopCloudEnvironmentOccupancy;
  disabled_reason_code?: string;
  disabled_reason?: string;
}>;

export type DesktopCloudRuntimeLinkTarget = Readonly<{
  id: DesktopCloudRuntimeLinkTargetID;
  kind: DesktopCloudRuntimeLinkTargetKind;
  environment_id: string;
  label: string;
  runtime_key: string;
  runtime_url: string;
  runtime_running: boolean;
  runtime_openable: boolean;
  runtime_control_status: DesktopRuntimeControlStatus;
  runtime_service?: RuntimeServiceSnapshot;
  provider_connection_state: RuntimeServiceProviderConnectionState;
  credential_recovery?: 'restoring' | 'waiting' | 'waiting_for_service' | 'attention' | 'sign_in_required' | 'permission_required' | 'binding_changed';
  credential_recovery_details?: Readonly<{
    last_error_code?: string;
    last_attempt_at_unix_ms: number;
    next_retry_at_unix_ms?: number;
    attempt_count: number;
  }>;
  cloud_link_state: RuntimeServiceCloudLinkState;
  cloud_link_binding?: RuntimeServiceCloudLinkBinding;
  cloud_origin?: string;
  cloud_origin_supported: boolean;
  cloud_id?: string;
  env_public_id?: string;
  access_point_origin?: string;
  can_connect_cloud: boolean;
  can_disconnect_cloud: boolean;
  blocked_reason_code?: string;
  blocked_reason?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function desktopCloudRuntimeLinkTargetID(
  kind: DesktopCloudRuntimeLinkTargetKind,
  runtimeKey: string,
): DesktopCloudRuntimeLinkTargetID {
  const cleanRuntimeKey = compact(runtimeKey);
  if (cleanRuntimeKey === '') {
    throw new Error('Runtime target key is required.');
  }
  const prefix = kind === 'ssh_environment'
    ? 'ssh'
    : kind === 'wsl_environment'
      ? 'wsl'
      : 'local';
  return `${prefix}:${cleanRuntimeKey}`;
}

export function normalizeDesktopCloudRuntimeLinkTargetID(
  value: unknown,
): DesktopCloudRuntimeLinkTargetID | null {
  const cleanValue = compact(value);
  if (cleanValue.startsWith('local:') && cleanValue.length > 'local:'.length) {
    return cleanValue as DesktopCloudRuntimeLinkTargetID;
  }
  if (cleanValue.startsWith('ssh:') && cleanValue.length > 'ssh:'.length) {
    return cleanValue as DesktopCloudRuntimeLinkTargetID;
  }
  if (cleanValue.startsWith('wsl:') && cleanValue.length > 'wsl:'.length) {
    return cleanValue as DesktopCloudRuntimeLinkTargetID;
  }
  return null;
}

export function desktopCloudRuntimeLinkTargetKindFromID(
  value: DesktopCloudRuntimeLinkTargetID,
): DesktopCloudRuntimeLinkTargetKind {
  return value.startsWith('ssh:')
    ? 'ssh_environment'
    : value.startsWith('wsl:')
      ? 'wsl_environment'
      : 'local_environment';
}

export function desktopCloudRuntimeLinkTargetRuntimeKey(
  value: DesktopCloudRuntimeLinkTargetID,
): string {
  return value.replace(/^(local|wsl|ssh):/u, '');
}
