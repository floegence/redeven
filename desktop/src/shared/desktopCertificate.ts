export const DESKTOP_CERTIFICATE_CHANNEL = 'redeven-desktop:local-certificate';
export type DesktopCertificateOperation = 'status' | 'generate' | 'install';
export type DesktopCertificateReport = Readonly<{
  status: string;
  code: string;
  message?: string;
  identity?: string;
  trust?: string;
  not_after?: string;
  certificate_path?: string;
}>;

export function isDesktopCertificateOperation(value: unknown): value is DesktopCertificateOperation {
  return value === 'status' || value === 'generate' || value === 'install';
}

export function parseDesktopCertificateReport(value: unknown): DesktopCertificateReport {
  if (!value || typeof value !== 'object') throw new Error('Invalid certificate status.');
  const report = value as Record<string, unknown>;
  if (report.schema_version !== 'redeven.local_authority_maintenance.v1'
    || typeof report.status !== 'string' || typeof report.code !== 'string') {
    throw new Error('The Runtime returned an incompatible certificate status.');
  }
  const text = (name: string) => typeof report[name] === 'string' ? report[name] as string : undefined;
  return {
    status: report.status, code: report.code, message: text('message'),
    identity: text('identity'), trust: text('trust'), not_after: text('not_after'),
    certificate_path: text('certificate_path'),
  };
}
