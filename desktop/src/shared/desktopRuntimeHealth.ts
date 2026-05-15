import type { RuntimeServiceSnapshot } from './runtimeService';

export type DesktopRuntimeStatus = 'online' | 'offline';
export type DesktopRuntimeControlCapability = 'start_stop' | 'observe_only';
export type DesktopRuntimeMaintenanceKind =
  | 'ssh_runtime_update_required'
  | 'ssh_runtime_restart_required'
  | 'desktop_model_source_requires_runtime_update';
export type DesktopRuntimeMaintenanceRequiredFor = 'open' | 'desktop_model_source';
export type DesktopRuntimeMaintenanceRequirement = Readonly<{
  kind: DesktopRuntimeMaintenanceKind;
  required_for: DesktopRuntimeMaintenanceRequiredFor;
  can_desktop_restart: boolean;
  has_active_work: boolean;
  active_work_label: string;
  current_runtime_version?: string;
  target_runtime_version?: string;
  message: string;
}>;
export type DesktopRuntimeOfflineReasonCode =
  | 'not_started'
  | 'probe_failed'
  | 'provider_reported_offline'
  | 'provider_unavailable'
  | 'runtime_disconnected'
  | 'binding_replaced'
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
  runtime_maintenance?: DesktopRuntimeMaintenanceRequirement;
  offline_reason_code?: DesktopRuntimeOfflineReasonCode;
  offline_reason?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeMaintenanceKind(value: unknown): DesktopRuntimeMaintenanceKind | null {
  const kind = compact(value);
  switch (kind) {
    case 'ssh_runtime_update_required':
    case 'ssh_runtime_restart_required':
    case 'desktop_model_source_requires_runtime_update':
      return kind;
    default:
      return null;
  }
}

function normalizeRequiredFor(value: unknown): DesktopRuntimeMaintenanceRequiredFor {
  return compact(value) === 'desktop_model_source' ? 'desktop_model_source' : 'open';
}

export function normalizeDesktopRuntimeMaintenanceRequirement(
  value: unknown,
): DesktopRuntimeMaintenanceRequirement | undefined {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const kind = normalizeMaintenanceKind(record.kind);
  if (!kind) {
    return undefined;
  }
  const activeWorkLabel = compact(record.active_work_label);
  const message = compact(record.message);
  return {
    kind,
    required_for: normalizeRequiredFor(record.required_for),
    can_desktop_restart: record.can_desktop_restart === true,
    has_active_work: record.has_active_work === true,
    active_work_label: activeWorkLabel || 'No active work',
    current_runtime_version: compact(record.current_runtime_version) || undefined,
    target_runtime_version: compact(record.target_runtime_version) || undefined,
    message: message || 'Runtime maintenance is required before this environment can open.',
  };
}
