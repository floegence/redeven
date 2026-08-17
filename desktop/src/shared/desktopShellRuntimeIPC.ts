import {
  normalizeDesktopOperationFailurePresentation,
  type DesktopOperationFailurePresentation,
} from './desktopOperationFailure';

export const DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL = 'redeven-desktop:shell-runtime-action';
export const DESKTOP_SHELL_RUNTIME_MAINTENANCE_CONTEXT_CHANNEL = 'redeven-desktop:shell-runtime-maintenance-context';
export const DESKTOP_SHELL_RUNTIME_MAINTENANCE_STARTED_CHANNEL = 'redeven-desktop:shell-runtime-maintenance-started';

export type DesktopShellRuntimeMaintenanceStartedKind = 'restart' | 'update';

export type DesktopShellRuntimeMaintenanceStartedNotification = Readonly<{
  kind: DesktopShellRuntimeMaintenanceStartedKind;
}>;

export type DesktopShellRuntimeAction =
  | 'manage_desktop_update'
  | 'restart_runtime'
  | 'upgrade_runtime';

export type DesktopShellRuntimeMaintenanceAuthority =
  | 'gateway_supervisor'
  | 'host_device'
  | 'manual';

export type DesktopShellRuntimeMaintenanceAvailability = 'available' | 'unavailable' | 'external';

export type DesktopShellRuntimeMaintenanceMethod =
  | 'gateway_supervisor'
  | 'host_device_handoff'
  | 'manual';

export type DesktopShellRuntimeMaintenanceRuntimeKind = 'local_environment' | 'ssh' | 'external' | 'unknown';
export type DesktopShellRuntimeMaintenanceUpgradePolicy = 'self_upgrade' | 'desktop_release' | 'manual';

export type DesktopShellRuntimeManagementCapability = Readonly<{
  support: 'supported' | 'unsupported' | 'unknown';
  authorization: 'allowed' | 'denied' | 'unknown';
  readiness: 'ready' | 'setup_required' | 'temporarily_unavailable' | 'unknown';
  presentation_state: 'allowed' | 'denied' | 'setup_required' | 'temporarily_unavailable' | 'unsupported' | 'unknown';
  reason_code?: string;
}>;

export type DesktopShellRuntimeMaintenanceWorkload = Readonly<{
  terminal_count: number;
  session_count: number;
  task_count: number;
  port_forward_count: number;
}>;

export type DesktopShellRuntimeMaintenanceActionPlan = Readonly<{
  availability: DesktopShellRuntimeMaintenanceAvailability;
  method: DesktopShellRuntimeMaintenanceMethod;
  label: string;
  title: string;
  message: string;
  detail?: string;
  unavailable_reason_code?: string;
  release_page_url?: string;
  requires_target_version?: boolean;
}>;

export type DesktopShellRuntimeMaintenanceContext = Readonly<{
  available: boolean;
  authority: DesktopShellRuntimeMaintenanceAuthority;
  runtime_kind: DesktopShellRuntimeMaintenanceRuntimeKind;
  management: DesktopShellRuntimeManagementCapability;
  upgrade_policy: DesktopShellRuntimeMaintenanceUpgradePolicy;
  current_version?: string;
  latest_version?: string;
  recommended_version?: string;
  active_workload?: DesktopShellRuntimeMaintenanceWorkload;
  restart: DesktopShellRuntimeMaintenanceActionPlan;
  upgrade: DesktopShellRuntimeMaintenanceActionPlan;
}>;

export type DesktopShellRuntimeActionRequest = Readonly<{
  action: DesktopShellRuntimeAction;
  target_version?: string;
}>;

export type DesktopShellRuntimeActionResponse = Readonly<{
  ok: boolean;
  started: boolean;
  code?: 'runtime_lifecycle_in_progress' | 'confirmation_required';
  operation_key?: string;
  message?: string;
  failure?: DesktopOperationFailurePresentation;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function compactRaw(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopShellRuntimeAction(value: unknown): DesktopShellRuntimeAction | '' {
  const action = compact(value);
  if (action === 'manage_desktop_update' || action === 'desktop_update') {
    return 'manage_desktop_update';
  }
  if (action === 'restart_runtime' || action === 'restart') {
    return 'restart_runtime';
  }
  if (action === 'upgrade_runtime' || action === 'upgrade' || action === 'update') {
    return 'upgrade_runtime';
  }
  return '';
}

export function normalizeDesktopShellRuntimeActionRequest(value: unknown): DesktopShellRuntimeActionRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopShellRuntimeActionRequest>;
  const action = normalizeDesktopShellRuntimeAction(candidate.action);
  if (!action) {
    return null;
  }

  const targetVersion = String((candidate as { target_version?: unknown }).target_version ?? '').trim();
  return {
    action,
    ...(targetVersion ? { target_version: targetVersion } : {}),
  };
}

export function normalizeDesktopShellRuntimeMaintenanceStartedNotification(
  value: unknown,
): DesktopShellRuntimeMaintenanceStartedNotification | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const kind = compact((value as Partial<DesktopShellRuntimeMaintenanceStartedNotification>).kind);
  if (kind !== 'restart' && kind !== 'update') {
    return null;
  }
  return { kind };
}

export function normalizeDesktopShellRuntimeActionResponse(value: unknown): DesktopShellRuntimeActionResponse {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      started: false,
      message: 'Desktop runtime action failed.',
    };
  }

  const candidate = value as Partial<DesktopShellRuntimeActionResponse>;
  const failure = normalizeDesktopOperationFailurePresentation(candidate.failure);
  const message = failure?.summary || String(candidate.message ?? '').trim();
  const code = candidate.code === 'runtime_lifecycle_in_progress' || candidate.code === 'confirmation_required'
    ? candidate.code
    : undefined;
  const operationKey = String(candidate.operation_key ?? '').trim() || undefined;
  return {
    ok: candidate.ok === true,
    started: candidate.started === true,
    ...(code ? { code } : {}),
    ...(operationKey ? { operation_key: operationKey } : {}),
    message: message || undefined,
    ...(failure ? { failure } : {}),
  };
}

function normalizeAuthority(value: unknown): DesktopShellRuntimeMaintenanceAuthority {
  const authority = compact(value);
  switch (authority) {
    case 'gateway_supervisor':
    case 'host_device':
    case 'manual':
      return authority;
    default:
      return 'manual';
  }
}

function normalizeRuntimeKind(value: unknown): DesktopShellRuntimeMaintenanceRuntimeKind {
  const runtimeKind = compact(value);
  switch (runtimeKind) {
    case 'local_environment':
    case 'ssh':
    case 'external':
    case 'unknown':
      return runtimeKind;
    default:
      return 'unknown';
  }
}

function normalizeUpgradePolicy(value: unknown): DesktopShellRuntimeMaintenanceUpgradePolicy {
  const policy = compact(value);
  switch (policy) {
    case 'self_upgrade':
    case 'desktop_release':
    case 'manual':
      return policy;
    default:
      return 'manual';
  }
}

function normalizeAvailability(value: unknown): DesktopShellRuntimeMaintenanceAvailability {
  const availability = compact(value);
  switch (availability) {
    case 'available':
    case 'unavailable':
    case 'external':
      return availability;
    default:
      return 'unavailable';
  }
}

function normalizeMethod(value: unknown): DesktopShellRuntimeMaintenanceMethod {
  const method = compact(value);
  switch (method) {
    case 'gateway_supervisor':
    case 'host_device_handoff':
    case 'manual':
      return method;
    default:
      return 'manual';
  }
}

function normalizeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.floor(n));
}

function normalizeWorkload(value: unknown): DesktopShellRuntimeMaintenanceWorkload | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Partial<DesktopShellRuntimeMaintenanceWorkload>;
  return {
    terminal_count: normalizeCount(record.terminal_count),
    session_count: normalizeCount(record.session_count),
    task_count: normalizeCount(record.task_count),
    port_forward_count: normalizeCount(record.port_forward_count),
  };
}

function defaultActionPlan(kind: 'restart' | 'upgrade', message: string): DesktopShellRuntimeMaintenanceActionPlan {
  return {
    availability: 'unavailable',
    method: 'manual',
    label: kind === 'restart' ? 'Restart runtime' : 'Update Redeven',
    title: kind === 'restart' ? 'Restart Runtime Service' : 'Update Runtime Service',
    message,
    unavailable_reason_code: 'runtime_maintenance_context_unavailable',
    requires_target_version: kind === 'upgrade',
  };
}

function normalizeActionPlan(
  kind: 'restart' | 'upgrade',
  value: unknown,
  fallbackMessage: string,
): DesktopShellRuntimeMaintenanceActionPlan {
  if (!value || typeof value !== 'object') {
    return defaultActionPlan(kind, fallbackMessage);
  }
  const record = value as Partial<DesktopShellRuntimeMaintenanceActionPlan>;
  const fallback = defaultActionPlan(kind, fallbackMessage);
  const availability = normalizeAvailability(record.availability);
  const method = normalizeMethod(record.method);
  return {
    availability,
    method,
    label: compactRaw(record.label) || fallback.label,
    title: compactRaw(record.title) || fallback.title,
    message: compactRaw(record.message) || fallback.message,
    detail: compactRaw(record.detail) || undefined,
    unavailable_reason_code: compactRaw(record.unavailable_reason_code) || undefined,
    release_page_url: compactRaw(record.release_page_url) || undefined,
    requires_target_version: record.requires_target_version ?? kind === 'upgrade',
  };
}

export function unavailableDesktopShellRuntimeMaintenanceContext(
  message = 'Runtime maintenance is not available from this Desktop session.',
): DesktopShellRuntimeMaintenanceContext {
  return {
    available: false,
    authority: 'manual',
    runtime_kind: 'unknown',
    management: normalizeRuntimeManagementCapability(undefined),
    upgrade_policy: 'manual',
    restart: defaultActionPlan('restart', message),
    upgrade: defaultActionPlan('upgrade', message),
  };
}

export function normalizeDesktopShellRuntimeMaintenanceContext(value: unknown): DesktopShellRuntimeMaintenanceContext {
  if (!value || typeof value !== 'object') {
    return unavailableDesktopShellRuntimeMaintenanceContext();
  }
  const record = value as Partial<DesktopShellRuntimeMaintenanceContext>;
  const restart = normalizeActionPlan('restart', record.restart, 'Runtime restart is not available from this Desktop session.');
  const upgrade = normalizeActionPlan('upgrade', record.upgrade, 'Runtime update is not available from this Desktop session.');
  return {
    available: record.available === true,
    authority: normalizeAuthority(record.authority),
    runtime_kind: normalizeRuntimeKind(record.runtime_kind),
    management: normalizeRuntimeManagementCapability(record.management),
    upgrade_policy: normalizeUpgradePolicy(record.upgrade_policy),
    current_version: compactRaw(record.current_version) || undefined,
    latest_version: compactRaw(record.latest_version) || undefined,
    recommended_version: compactRaw(record.recommended_version) || undefined,
    active_workload: normalizeWorkload(record.active_workload),
    restart,
    upgrade,
  };
}

function projectRuntimeManagementState(
  support: DesktopShellRuntimeManagementCapability['support'],
  authorization: DesktopShellRuntimeManagementCapability['authorization'],
  readiness: DesktopShellRuntimeManagementCapability['readiness'],
): DesktopShellRuntimeManagementCapability['presentation_state'] {
  if (support === 'unsupported') return 'unsupported';
  if (support !== 'supported') return 'unknown';
  if (authorization === 'denied') return 'denied';
  if (authorization !== 'allowed') return 'unknown';
  if (readiness === 'ready') return 'allowed';
  if (readiness === 'setup_required') return 'setup_required';
  if (readiness === 'temporarily_unavailable') return 'temporarily_unavailable';
  return 'unknown';
}

function normalizeRuntimeManagementCapability(value: unknown): DesktopShellRuntimeManagementCapability {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const support = record.support === 'supported' || record.support === 'unsupported' ? record.support : 'unknown';
  const authorization = record.authorization === 'allowed' || record.authorization === 'denied' ? record.authorization : 'unknown';
  const readiness = record.readiness === 'ready'
    || record.readiness === 'setup_required'
    || record.readiness === 'temporarily_unavailable'
    ? record.readiness
    : 'unknown';
  return {
    support,
    authorization,
    readiness,
    presentation_state: projectRuntimeManagementState(support, authorization, readiness),
    reason_code: compactRaw(record.reason_code) || undefined,
  };
}

export function desktopShellRuntimeMaintenanceMethodUsesDesktop(
  method: DesktopShellRuntimeMaintenanceMethod,
): boolean {
  return method === 'gateway_supervisor';
}
