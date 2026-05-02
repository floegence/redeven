export type RuntimeServiceOwner = 'desktop' | 'external' | 'unknown';

export type RuntimeServiceCompatibility =
  | 'compatible'
  | 'update_available'
  | 'restart_recommended'
  | 'update_required'
  | 'desktop_update_required'
  | 'managed_elsewhere'
  | 'unknown';

export type RuntimeServiceWorkload = Readonly<{
  terminal_count: number;
  session_count: number;
  task_count: number;
  port_forward_count: number;
}>;

export type RuntimeServiceSnapshot = Readonly<{
  runtime_version?: string;
  runtime_commit?: string;
  runtime_build_time?: string;
  protocol_version?: string;
  compatibility_epoch?: number;
  service_owner: RuntimeServiceOwner;
  desktop_managed: boolean;
  effective_run_mode?: string;
  remote_enabled: boolean;
  compatibility: RuntimeServiceCompatibility;
  compatibility_message?: string;
  minimum_desktop_version?: string;
  minimum_runtime_version?: string;
  compatibility_review_id?: string;
  active_workload: RuntimeServiceWorkload;
}>;

export const RUNTIME_SERVICE_PROTOCOL_VERSION = 'redeven-runtime-v1';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.floor(n));
}

function normalizeOwner(value: unknown, desktopManaged: boolean): RuntimeServiceOwner {
  const owner = compact(value);
  if (owner === 'desktop' || owner === 'external' || owner === 'unknown') {
    return owner;
  }
  return desktopManaged ? 'desktop' : 'unknown';
}

function normalizeCompatibility(value: unknown): RuntimeServiceCompatibility {
  const compatibility = compact(value);
  switch (compatibility) {
    case 'compatible':
    case 'update_available':
    case 'restart_recommended':
    case 'update_required':
    case 'desktop_update_required':
    case 'managed_elsewhere':
    case 'unknown':
      return compatibility;
    default:
      return 'unknown';
  }
}

export function normalizeRuntimeServiceSnapshot(
  value: unknown,
  fallback: Readonly<{
    desktopManaged?: boolean;
    effectiveRunMode?: string;
    remoteEnabled?: boolean;
  }> = {},
): RuntimeServiceSnapshot {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const workload = record.active_workload && typeof record.active_workload === 'object'
    ? record.active_workload as Record<string, unknown>
    : {};
  const desktopManaged = typeof record.desktop_managed === 'boolean'
    ? record.desktop_managed
    : fallback.desktopManaged === true;
  return {
    runtime_version: compact(record.runtime_version) || undefined,
    runtime_commit: compact(record.runtime_commit) || undefined,
    runtime_build_time: compact(record.runtime_build_time) || undefined,
    protocol_version: compact(record.protocol_version) || RUNTIME_SERVICE_PROTOCOL_VERSION,
    compatibility_epoch: normalizeCount(record.compatibility_epoch) || undefined,
    service_owner: normalizeOwner(record.service_owner, desktopManaged),
    desktop_managed: desktopManaged,
    effective_run_mode: compact(record.effective_run_mode) || compact(fallback.effectiveRunMode) || undefined,
    remote_enabled: typeof record.remote_enabled === 'boolean'
      ? record.remote_enabled
      : fallback.remoteEnabled === true,
    compatibility: normalizeCompatibility(record.compatibility),
    compatibility_message: compact(record.compatibility_message) || undefined,
    minimum_desktop_version: compact(record.minimum_desktop_version) || undefined,
    minimum_runtime_version: compact(record.minimum_runtime_version) || undefined,
    compatibility_review_id: compact(record.compatibility_review_id) || undefined,
    active_workload: {
      terminal_count: normalizeCount(workload.terminal_count),
      session_count: normalizeCount(workload.session_count),
      task_count: normalizeCount(workload.task_count),
      port_forward_count: normalizeCount(workload.port_forward_count),
    },
  };
}

export function runtimeServiceHasActiveWork(snapshot: RuntimeServiceSnapshot | null | undefined): boolean {
  const workload = snapshot?.active_workload;
  if (!workload) {
    return false;
  }
  return workload.terminal_count > 0
    || workload.session_count > 0
    || workload.task_count > 0
    || workload.port_forward_count > 0;
}

export function formatRuntimeServiceWorkload(snapshot: RuntimeServiceSnapshot | null | undefined): string {
  const workload = snapshot?.active_workload;
  if (!workload) {
    return 'No active work';
  }
  const parts = [
    workload.terminal_count > 0 ? `${workload.terminal_count} ${workload.terminal_count === 1 ? 'terminal' : 'terminals'}` : '',
    workload.session_count > 0 ? `${workload.session_count} ${workload.session_count === 1 ? 'session' : 'sessions'}` : '',
    workload.task_count > 0 ? `${workload.task_count} ${workload.task_count === 1 ? 'task' : 'tasks'}` : '',
    workload.port_forward_count > 0 ? `${workload.port_forward_count} ${workload.port_forward_count === 1 ? 'port forward' : 'port forwards'}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'No active work';
}
