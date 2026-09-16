export const DESKTOP_CERTIFICATE_CHANNEL = 'redeven-desktop:local-certificate';
export type DesktopCertificateOperation = 'status' | 'generate' | 'install' | 'setup' | 'import' | 'regenerate' | 'remove';
export type DesktopCertificateRequest = Readonly<{ environment_id: string; operation: DesktopCertificateOperation; confirmed?: true }>;
export type DesktopCertificateIdentity = 'ready' | 'missing' | 'expired' | 'not_yet_valid' | 'invalid' | 'unknown';
export type DesktopCertificateReport = Readonly<{
  status: string;
  code: string;
  message?: string;
  identity?: string;
  trust?: string;
  not_after?: string;
  certificate_path?: string;
  can_install?: boolean;
  can_manage?: boolean;
  certificate_kind?: string;
  fingerprint?: string;
  failure_stage?: 'status' | 'generate' | 'install' | 'verify' | 'import' | 'regenerate' | 'remove';
}>;

export function isDesktopCertificateOperation(value: unknown): value is DesktopCertificateOperation {
  return value === 'status' || value === 'generate' || value === 'install' || value === 'setup' || isCertificateReplacement(value);
}

export function isCertificateReplacement(value: unknown): value is 'import' | 'regenerate' | 'remove' {
  return value === 'import' || value === 'regenerate' || value === 'remove';
}

export function parseDesktopCertificateRequest(value: unknown): DesktopCertificateRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid certificate request.');
  const request = value as Record<string, unknown>;
  if (typeof request.environment_id !== 'string' || !request.environment_id.trim()
    || !isDesktopCertificateOperation(request.operation)) throw new Error('Invalid certificate request.');
  if (isCertificateReplacement(request.operation) && request.confirmed !== true) throw new Error('Certificate replacement or removal requires confirmation.');
  return { environment_id: request.environment_id.trim(), operation: request.operation,
    ...(isCertificateReplacement(request.operation) ? { confirmed: true } : {}) };
}

export function desktopCertificateIdentity(report: DesktopCertificateReport | undefined): DesktopCertificateIdentity {
  if (!report) return 'unknown';
  switch (report.code) {
    case 'local_ui_device_ca_missing': return 'missing';
    case 'local_ui_device_ca_expired': return 'expired';
    case 'local_ui_device_ca_not_yet_valid': return 'not_yet_valid';
    case 'local_ui_device_ca_invalid': return 'invalid';
  }
  switch (report.identity) {
    case 'ready': case 'missing': case 'expired': case 'not_yet_valid': case 'invalid': return report.identity;
    default: return 'unknown';
  }
}

export function parseDesktopCertificateReport(value: unknown): DesktopCertificateReport {
  if (!value || typeof value !== 'object') throw new Error('Invalid certificate status.');
  const report = value as Record<string, unknown>;
  if (report.schema_version !== 'redeven.local_authority_maintenance.v1'
    || typeof report.status !== 'string' || typeof report.code !== 'string') {
    throw new Error('The Runtime returned an incompatible certificate status.');
  }
  const text = (name: string) => typeof report[name] === 'string' ? report[name] as string : undefined;
  // Epoch 18 runtimes reported successful identity inspection as failed when only client trust was missing.
  const legacyUntrusted = report.status === 'failed' && report.identity === 'ready'
    && report.trust === 'untrusted' && report.code === 'local_ui_device_ca_untrusted';
  return {
    status: legacyUntrusted ? 'ready' : report.status, code: report.code, message: text('message'),
    identity: text('identity'), trust: text('trust'), not_after: text('not_after'),
    certificate_path: text('certificate_path'), certificate_kind: text('certificate_kind'), fingerprint: text('fingerprint'),
    can_manage: report.certificate_management === true,
  };
}
