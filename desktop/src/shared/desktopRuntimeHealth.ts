import {
  runtimeServiceIsOpenable,
  type RuntimeServiceSnapshot,
} from './runtimeService';

export type DesktopRuntimeStatus = 'online' | 'offline';
export type DesktopRuntimeHealthFreshness =
  | 'unknown'
  | 'checking'
  | 'fresh'
  | 'failed';
export type DesktopRuntimeMaintenanceKind =
  | 'runtime_update_required'
  | 'runtime_restart_required'
  | 'runtime_stale_lock'
  | 'desktop_model_source_requires_runtime_update';
export type DesktopRuntimeMaintenanceRequiredFor = 'open' | 'desktop_model_source';
export type DesktopRuntimeMaintenanceRecoveryAction =
  | 'update_runtime'
  | 'restart_runtime'
  | 'start_runtime'
  | 'refresh_status';
export type DesktopRuntimeMaintenanceRequirement = Readonly<{
  kind: DesktopRuntimeMaintenanceKind;
  required_for: DesktopRuntimeMaintenanceRequiredFor;
  recovery_action: DesktopRuntimeMaintenanceRecoveryAction;
  can_desktop_start: boolean;
  can_desktop_restart: boolean;
  has_active_work: boolean;
  active_work_label: string;
  current_runtime_version?: string;
  target_runtime_version?: string;
  attach_state?: string;
  failure_code?: string;
  lock_pid?: number;
  message: string;
}>;
export type DesktopRuntimeOfflineReasonCode =
  | 'not_started'
  | 'auth_required'
  | 'unverified'
  | 'container_not_running'
  | 'container_engine_unavailable'
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
  freshness?: DesktopRuntimeHealthFreshness;
  local_ui_url?: string;
  runtime_service?: RuntimeServiceSnapshot;
  runtime_maintenance?: DesktopRuntimeMaintenanceRequirement;
  offline_reason_code?: DesktopRuntimeOfflineReasonCode;
  offline_reason?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  const numberValue = Number(value ?? Number.NaN);
  return Number.isInteger(numberValue) ? numberValue : undefined;
}

function normalizeMaintenanceKind(value: unknown): DesktopRuntimeMaintenanceKind | null {
  const kind = compact(value);
  switch (kind) {
    case 'runtime_update_required':
    case 'runtime_restart_required':
    case 'runtime_stale_lock':
    case 'desktop_model_source_requires_runtime_update':
      return kind;
    default:
      return null;
  }
}

function normalizeRequiredFor(value: unknown): DesktopRuntimeMaintenanceRequiredFor {
  return compact(value) === 'desktop_model_source' ? 'desktop_model_source' : 'open';
}

export function desktopRuntimeMaintenanceDefaultRecoveryAction(
  kind: DesktopRuntimeMaintenanceKind,
): DesktopRuntimeMaintenanceRecoveryAction {
  switch (kind) {
    case 'runtime_update_required':
    case 'desktop_model_source_requires_runtime_update':
      return 'update_runtime';
    case 'runtime_restart_required':
      return 'restart_runtime';
    case 'runtime_stale_lock':
      return 'start_runtime';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function normalizeRecoveryAction(
  value: unknown,
  kind: DesktopRuntimeMaintenanceKind,
): DesktopRuntimeMaintenanceRecoveryAction {
  const action = compact(value);
  switch (action) {
    case 'update_runtime':
    case 'restart_runtime':
    case 'start_runtime':
    case 'refresh_status':
      return action;
    default:
      return desktopRuntimeMaintenanceDefaultRecoveryAction(kind);
  }
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
  const attachState = compact(record.attach_state);
  const failureCode = compact(record.failure_code);
  return {
    kind,
    required_for: normalizeRequiredFor(record.required_for),
    recovery_action: normalizeRecoveryAction(record.recovery_action, kind),
    can_desktop_start: record.can_desktop_start === true,
    can_desktop_restart: record.can_desktop_restart === true,
    has_active_work: record.has_active_work === true,
    active_work_label: activeWorkLabel || 'No active work',
    current_runtime_version: compact(record.current_runtime_version) || undefined,
    target_runtime_version: compact(record.target_runtime_version) || undefined,
    attach_state: attachState || undefined,
    failure_code: failureCode || undefined,
    lock_pid: normalizeOptionalInteger(record.lock_pid),
    message: message || 'Runtime maintenance is required before this environment can open.',
  };
}

export function desktopRuntimeMaintenanceForRuntimeService(
  maintenance: DesktopRuntimeMaintenanceRequirement | null | undefined,
  runtimeService: RuntimeServiceSnapshot | null | undefined,
): DesktopRuntimeMaintenanceRequirement | undefined {
  const normalized = normalizeDesktopRuntimeMaintenanceRequirement(maintenance);
  if (!normalized) {
    return undefined;
  }
  if (normalized.required_for === 'open' && runtimeServiceIsOpenable(runtimeService)) {
    return undefined;
  }
  return normalized;
}

export function buildDesktopRuntimeMaintenanceRequirement(
  input: Readonly<{
    kind: DesktopRuntimeMaintenanceKind;
    required_for?: DesktopRuntimeMaintenanceRequiredFor;
    recovery_action?: DesktopRuntimeMaintenanceRecoveryAction;
    can_desktop_start?: boolean;
    can_desktop_restart?: boolean;
    has_active_work?: boolean;
    active_work_label?: string;
    current_runtime_version?: string;
    target_runtime_version?: string;
    attach_state?: string;
    failure_code?: string;
    lock_pid?: number;
    message: string;
  }>,
): DesktopRuntimeMaintenanceRequirement {
  const hasActiveWork = input.has_active_work === true;
  const activeWorkLabel = compact(input.active_work_label);
  const currentRuntimeVersion = compact(input.current_runtime_version);
  const targetRuntimeVersion = compact(input.target_runtime_version);
  const attachState = compact(input.attach_state);
  const failureCode = compact(input.failure_code);
  const lockPID = normalizeOptionalInteger(input.lock_pid);
  return {
    kind: input.kind,
    required_for: input.required_for ?? 'open',
    recovery_action: input.recovery_action ?? desktopRuntimeMaintenanceDefaultRecoveryAction(input.kind),
    can_desktop_start: input.can_desktop_start === true,
    can_desktop_restart: input.can_desktop_restart === true,
    has_active_work: hasActiveWork,
    active_work_label: activeWorkLabel || (hasActiveWork ? 'Existing runtime work may be active' : 'No active work'),
    current_runtime_version: currentRuntimeVersion || undefined,
    target_runtime_version: targetRuntimeVersion || undefined,
    attach_state: attachState || undefined,
    failure_code: failureCode || undefined,
    lock_pid: lockPID,
    message: compact(input.message) || 'Runtime maintenance is required before this environment can open.',
  };
}

export function desktopRuntimeMaintenanceRequiresUpdate(
  maintenance: DesktopRuntimeMaintenanceRequirement | null | undefined,
): boolean {
  return maintenance?.kind === 'runtime_update_required'
    || maintenance?.kind === 'desktop_model_source_requires_runtime_update';
}

export function desktopRuntimeMaintenanceRequiresRestart(
  maintenance: DesktopRuntimeMaintenanceRequirement | null | undefined,
): boolean {
  return maintenance?.kind === 'runtime_restart_required';
}

export function desktopRuntimeMaintenanceIsStaleLock(
  maintenance: DesktopRuntimeMaintenanceRequirement | null | undefined,
): boolean {
  return maintenance?.kind === 'runtime_stale_lock';
}

type DesktopRuntimeBlockedReportLike = Readonly<{
  code?: string;
  message?: string;
  lock_owner?: Readonly<{
    pid?: number;
    desktop_managed?: boolean;
  }>;
  diagnostics?: Readonly<{
    attach_state?: string;
    failure_code?: string;
    lock_pid?: number;
  }>;
}>;

export function desktopRuntimeBlockedReportIsStaleLock(
  report: DesktopRuntimeBlockedReportLike,
): boolean {
  const code = compact(report.code);
  const attachState = compact(report.diagnostics?.attach_state);
  const failureCode = compact(report.diagnostics?.failure_code);
  return code === 'stale_lock'
    || attachState === 'stale_lock'
    || failureCode === 'lock_pid_not_alive'
    || failureCode === 'lock_without_runtime_metadata';
}

function launchBlockedReportPID(report: DesktopRuntimeBlockedReportLike): number {
  const candidates = [
    report.lock_owner?.pid,
    report.diagnostics?.lock_pid,
  ];
  for (const candidate of candidates) {
    const pid = normalizeOptionalInteger(candidate);
    if (typeof pid === 'number' && pid > 0) {
      return pid;
    }
  }
  return 0;
}

export function desktopRuntimeMaintenanceFromBlockedLaunchReport(
  report: DesktopRuntimeBlockedReportLike,
  options: Readonly<{
    target_runtime_version?: string;
    fallback_message?: string;
  }> = {},
): DesktopRuntimeMaintenanceRequirement {
  const staleLock = desktopRuntimeBlockedReportIsStaleLock(report);
  const lockPID = launchBlockedReportPID(report);
  const canRestart = !staleLock && lockPID > 0 && report.lock_owner?.desktop_managed !== false;
  return buildDesktopRuntimeMaintenanceRequirement({
    kind: staleLock ? 'runtime_stale_lock' : 'runtime_restart_required',
    required_for: 'open',
    recovery_action: staleLock ? 'start_runtime' : 'restart_runtime',
    can_desktop_start: staleLock,
    can_desktop_restart: canRestart,
    has_active_work: !staleLock,
    active_work_label: staleLock ? 'No active work' : 'Existing runtime work may be active',
    target_runtime_version: options.target_runtime_version,
    attach_state: report.diagnostics?.attach_state,
    failure_code: report.diagnostics?.failure_code,
    lock_pid: lockPID || undefined,
    message: compact(report.message) || compact(options.fallback_message)
      || (staleLock
        ? 'Runtime lock metadata is present but no live runtime is reachable.'
        : 'Runtime maintenance is required before this environment can open.'),
  });
}
