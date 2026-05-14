import type {
  RuntimeServiceProviderLinkBinding,
  RuntimeServiceProviderLinkState,
  RuntimeServiceSnapshot,
} from './runtimeService';
import type { DesktopRuntimeControlStatus } from './desktopRuntimePresence';

export type DesktopProviderRuntimeLinkTargetKind = 'local_environment' | 'ssh_environment';

export type DesktopProviderRuntimeLinkTargetID = `local:${string}` | `ssh:${string}`;

export type DesktopProviderEnvironmentCandidate = Readonly<{
  provider_environment_id: string;
  label: string;
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  provider_label?: string;
  route_state: 'online' | 'offline' | 'unknown';
  disabled_reason_code?: string;
  disabled_reason?: string;
}>;

export type DesktopProviderRuntimeLinkTarget = Readonly<{
  id: DesktopProviderRuntimeLinkTargetID;
  kind: DesktopProviderRuntimeLinkTargetKind;
  environment_id: string;
  label: string;
  runtime_key: string;
  runtime_url: string;
  runtime_running: boolean;
  runtime_openable: boolean;
  runtime_control_status: DesktopRuntimeControlStatus;
  runtime_service?: RuntimeServiceSnapshot;
  provider_link_state: RuntimeServiceProviderLinkState;
  provider_link_binding?: RuntimeServiceProviderLinkBinding;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  can_connect_provider: boolean;
  can_disconnect_provider: boolean;
  blocked_reason_code?: string;
  blocked_reason?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function desktopProviderRuntimeLinkTargetID(
  kind: DesktopProviderRuntimeLinkTargetKind,
  runtimeKey: string,
): DesktopProviderRuntimeLinkTargetID {
  const cleanRuntimeKey = compact(runtimeKey);
  if (cleanRuntimeKey === '') {
    throw new Error('Runtime target key is required.');
  }
  return `${kind === 'ssh_environment' ? 'ssh' : 'local'}:${cleanRuntimeKey}`;
}

export function normalizeDesktopProviderRuntimeLinkTargetID(
  value: unknown,
): DesktopProviderRuntimeLinkTargetID | null {
  const cleanValue = compact(value);
  if (cleanValue.startsWith('local:') && cleanValue.length > 'local:'.length) {
    return cleanValue as DesktopProviderRuntimeLinkTargetID;
  }
  if (cleanValue.startsWith('ssh:') && cleanValue.length > 'ssh:'.length) {
    return cleanValue as DesktopProviderRuntimeLinkTargetID;
  }
  return null;
}

export function desktopProviderRuntimeLinkTargetKindFromID(
  value: DesktopProviderRuntimeLinkTargetID,
): DesktopProviderRuntimeLinkTargetKind {
  return value.startsWith('ssh:') ? 'ssh_environment' : 'local_environment';
}

export function desktopProviderRuntimeLinkTargetRuntimeKey(
  value: DesktopProviderRuntimeLinkTargetID,
): string {
  return value.replace(/^(local|ssh):/u, '');
}
