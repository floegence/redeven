import type { RuntimeServiceSnapshot } from './runtimeService';

export type DesktopRuntimeStatus = 'online' | 'offline';
export type DesktopRuntimeControlCapability = 'start_stop' | 'observe_only';
export type DesktopRuntimeOfflineReasonCode =
  | 'not_started'
  | 'probe_failed'
  | 'provider_reported_offline'
  | 'provider_unavailable'
  | 'environment_removed'
  | 'environment_inactive'
  | 'external_unreachable';

export type DesktopRuntimeHealthSource =
  | 'local_runtime_probe'
  | 'provider_batch_probe'
  | 'external_local_ui_probe'
  | 'ssh_runtime_probe';

export type DesktopEnvironmentWindowState = 'closed' | 'opening' | 'open';

export type DesktopRuntimeHealth = Readonly<{
  status: DesktopRuntimeStatus;
  checked_at_unix_ms: number;
  source: DesktopRuntimeHealthSource;
  local_ui_url?: string;
  runtime_service?: RuntimeServiceSnapshot;
  offline_reason_code?: DesktopRuntimeOfflineReasonCode;
  offline_reason?: string;
}>;
