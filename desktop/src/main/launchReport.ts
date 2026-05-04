import { parseStartupReport, type StartupReport } from './startup';

export type LaunchReportDiagnostics = Readonly<{
  lock_path?: string;
  state_dir?: string;
  runtime_state_path?: string;
  target_url?: string;
  config_path?: string;
  command?: string;
}>;

export type LaunchReportLockOwner = Readonly<{
  pid?: number;
  mode?: string;
  desktop_managed?: boolean;
  local_ui_enabled?: boolean;
  config_path?: string;
  state_dir?: string;
  runtime_state_path?: string;
}>;

export type LaunchReadyReport = Readonly<{
  status: 'ready' | 'attached';
  startup: StartupReport;
}>;

export type LaunchBlockedReport = Readonly<{
  status: 'blocked';
  code: string;
  message: string;
  lock_owner?: LaunchReportLockOwner;
  diagnostics?: LaunchReportDiagnostics;
}>;

export type LaunchReport = LaunchReadyReport | LaunchBlockedReport;

function normalizeOptionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) ? Number(value) : undefined;
}

export function parseLaunchReport(raw: string): LaunchReport {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const status = String(parsed.status ?? '').trim();
  if (!status || status === 'ready' || status === 'attached') {
    return {
      status: status === 'attached' ? 'attached' : 'ready',
      startup: parseStartupReport(raw),
    };
  }

  if (status !== 'blocked') {
    throw new Error(`unsupported desktop launch status: ${status}`);
  }

  const code = String(parsed.code ?? '').trim();
  const message = String(parsed.message ?? '').trim();
  if (!code) {
    throw new Error('blocked launch report missing code');
  }
  if (!message) {
    throw new Error('blocked launch report missing message');
  }

  const lockOwnerRecord = parsed.lock_owner;
  const diagnosticsRecord = parsed.diagnostics;

  return {
    status: 'blocked',
    code,
    message,
    lock_owner: lockOwnerRecord && typeof lockOwnerRecord === 'object'
      ? {
          pid: normalizeInteger((lockOwnerRecord as Record<string, unknown>).pid),
          mode: normalizeOptionalString((lockOwnerRecord as Record<string, unknown>).mode),
          desktop_managed: normalizeBoolean((lockOwnerRecord as Record<string, unknown>).desktop_managed),
          local_ui_enabled: normalizeBoolean((lockOwnerRecord as Record<string, unknown>).local_ui_enabled),
          config_path: normalizeOptionalString((lockOwnerRecord as Record<string, unknown>).config_path),
          state_dir: normalizeOptionalString((lockOwnerRecord as Record<string, unknown>).state_dir),
          runtime_state_path: normalizeOptionalString((lockOwnerRecord as Record<string, unknown>).runtime_state_path),
        }
      : undefined,
    diagnostics: diagnosticsRecord && typeof diagnosticsRecord === 'object'
      ? {
          lock_path: normalizeOptionalString((diagnosticsRecord as Record<string, unknown>).lock_path),
          state_dir: normalizeOptionalString((diagnosticsRecord as Record<string, unknown>).state_dir),
          runtime_state_path: normalizeOptionalString((diagnosticsRecord as Record<string, unknown>).runtime_state_path),
          target_url: normalizeOptionalString((diagnosticsRecord as Record<string, unknown>).target_url),
          config_path: normalizeOptionalString((diagnosticsRecord as Record<string, unknown>).config_path),
          command: normalizeOptionalString((diagnosticsRecord as Record<string, unknown>).command),
        }
      : undefined,
  };
}

export function formatBlockedLaunchDiagnostics(report: LaunchBlockedReport): string {
  const lines = [
    `status: ${report.status}`,
    `code: ${report.code}`,
    `message: ${report.message}`,
  ];

  if (report.lock_owner?.mode) {
    lines.push(`lock owner mode: ${report.lock_owner.mode}`);
  }
  if (typeof report.lock_owner?.pid === 'number') {
    lines.push(`lock owner pid: ${report.lock_owner.pid}`);
  }
  if (typeof report.lock_owner?.local_ui_enabled === 'boolean') {
    lines.push(`lock owner local_ui_enabled: ${String(report.lock_owner.local_ui_enabled)}`);
  }
  if (report.diagnostics?.state_dir) {
    lines.push(`state dir: ${report.diagnostics.state_dir}`);
  }
  if (report.diagnostics?.lock_path) {
    lines.push(`lock path: ${report.diagnostics.lock_path}`);
  }
  if (report.diagnostics?.runtime_state_path) {
    lines.push(`runtime state path: ${report.diagnostics.runtime_state_path}`);
  }
  if (report.diagnostics?.config_path) {
    lines.push(`config path: ${report.diagnostics.config_path}`);
  }
  if (report.diagnostics?.command) {
    lines.push(`command: ${report.diagnostics.command}`);
  }
  if (report.diagnostics?.target_url) {
    lines.push(`target url: ${report.diagnostics.target_url}`);
  }

  return lines.join('\n');
}
