export type DesktopFailureSeverity = 'info' | 'warning' | 'error';

export type DesktopFailureCode =
  | 'ssh_connection_failed'
  | 'ssh_runtime_status_unavailable'
  | 'ssh_runtime_install_failed'
  | 'ssh_runtime_launch_failed'
  | 'ssh_runtime_stop_failed'
  | 'ssh_forward_unavailable'
  | 'local_runtime_launch_failed'
  | 'local_runtime_stop_failed'
  | 'container_runtime_launch_failed'
  | 'container_runtime_stop_failed'
  | 'runtime_host_command_failed'
  | 'runtime_update_required'
  | 'environment_open_failed'
  | 'provider_link_failed'
  | 'workspace_engine_prepare_failed'
  | 'operation_canceled'
  | 'operation_failed';

export type DesktopFailureDiagnostic = Readonly<{
  channel: string;
  label: string;
  text: string;
  sensitive?: boolean;
}>;

export type DesktopOperationFailurePresentation = Readonly<{
  code: DesktopFailureCode;
  severity: DesktopFailureSeverity;
  title: string;
  summary: string;
  detail?: string;
  recovery_hint?: string;
  target_label?: string;
  diagnostics?: readonly DesktopFailureDiagnostic[];
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeFailureCode(value: unknown): DesktopFailureCode {
  const code = compact(value) as DesktopFailureCode;
  switch (code) {
    case 'ssh_connection_failed':
    case 'ssh_runtime_status_unavailable':
    case 'ssh_runtime_install_failed':
    case 'ssh_runtime_launch_failed':
    case 'ssh_runtime_stop_failed':
    case 'ssh_forward_unavailable':
    case 'local_runtime_launch_failed':
    case 'local_runtime_stop_failed':
    case 'container_runtime_launch_failed':
    case 'container_runtime_stop_failed':
    case 'runtime_host_command_failed':
    case 'runtime_update_required':
    case 'environment_open_failed':
    case 'provider_link_failed':
    case 'workspace_engine_prepare_failed':
    case 'operation_canceled':
    case 'operation_failed':
      return code;
    default:
      return 'operation_failed';
  }
}

function normalizeFailureSeverity(value: unknown): DesktopFailureSeverity {
  const severity = compact(value) as DesktopFailureSeverity;
  return severity === 'info' || severity === 'warning' || severity === 'error'
    ? severity
    : 'error';
}

export function normalizeDesktopFailureDiagnostic(value: unknown): DesktopFailureDiagnostic | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const text = compact(record.text);
  if (text === '') {
    return null;
  }
  const channel = compact(record.channel) || 'diagnostic';
  return {
    channel,
    label: compact(record.label) || channel,
    text,
    ...(record.sensitive === true ? { sensitive: true } : {}),
  };
}

export function normalizeDesktopOperationFailurePresentation(
  value: unknown,
): DesktopOperationFailurePresentation | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const summary = compact(record.summary);
  const title = compact(record.title);
  if (summary === '' || title === '') {
    return null;
  }
  const diagnostics = Array.isArray(record.diagnostics)
    ? record.diagnostics
      .map(normalizeDesktopFailureDiagnostic)
      .filter((item): item is DesktopFailureDiagnostic => item !== null)
    : [];
  return {
    code: normalizeFailureCode(record.code),
    severity: normalizeFailureSeverity(record.severity),
    title,
    summary,
    ...(compact(record.detail) ? { detail: compact(record.detail) } : {}),
    ...(compact(record.recovery_hint) ? { recovery_hint: compact(record.recovery_hint) } : {}),
    ...(compact(record.target_label) ? { target_label: compact(record.target_label) } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

export function formatDesktopOperationFailureForClipboard(
  failure: DesktopOperationFailurePresentation,
): string {
  const lines = [
    failure.title,
    failure.summary,
    failure.detail,
    failure.recovery_hint ? `Recovery: ${failure.recovery_hint}` : '',
    failure.target_label ? `Target: ${failure.target_label}` : '',
  ].filter((line): line is string => compact(line) !== '');

  const diagnostics = failure.diagnostics ?? [];
  if (diagnostics.length > 0) {
    lines.push('', 'Diagnostics:');
    for (const item of diagnostics) {
      lines.push(`${item.label} (${item.channel}):`, item.text);
    }
  }
  return lines.join('\n');
}

// IMPORTANT: User-visible runtime failure summaries must come from
// DesktopOperationFailurePresentation fields. Diagnostic stream names such as
// stderr/control_stderr/master_stderr are never valid summaries.
