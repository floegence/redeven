import { execFile } from 'node:child_process';
import { sanitizeDesktopChildEnvironment } from './desktopProcessEnvironment';
import { desktopCertificateIdentity, parseDesktopCertificateReport, type DesktopCertificateOperation, type DesktopCertificateReport } from '../shared/desktopCertificate';

type CertificateCommand = Exclude<DesktopCertificateOperation, 'setup'>;
export type CertificateRunner = (operation: CertificateCommand) => Promise<DesktopCertificateReport>;

export function runDesktopCertificateCommand(executable: string, stateRoot: string, operation: CertificateCommand): Promise<DesktopCertificateReport> {
  return new Promise((resolve, reject) => {
    execFile(executable, ['local-authority', 'device-ca', operation, '--state-root', stateRoot], {
      env: sanitizeDesktopChildEnvironment(process.env), timeout: 60_000, maxBuffer: 64 * 1024, windowsHide: true,
    }, (error, stdout, stderr) => {
      try {
        resolve(parseDesktopCertificateReport(JSON.parse(String(error ? stderr : stdout).trim())));
      } catch (parseError) {
        reject(error ?? parseError);
      }
    });
  });
}

// One owner sequences setup and retains completed work when a later step fails.
export async function performDesktopCertificateOperation(
  run: CertificateRunner, operation: DesktopCertificateOperation, canInstall: boolean,
): Promise<DesktopCertificateReport> {
  let current: DesktopCertificateReport | undefined;
  let stage: NonNullable<DesktopCertificateReport['failure_stage']> = 'status';
  const project = (report: DesktopCertificateReport): DesktopCertificateReport => ({ ...report, can_install: canInstall });
  const failed = (report: DesktopCertificateReport): DesktopCertificateReport => project({
    ...current, ...report, identity: report.identity ?? current?.identity,
    trust: report.trust ?? current?.trust, certificate_path: report.certificate_path ?? current?.certificate_path,
    not_after: report.not_after ?? current?.not_after, failure_stage: stage,
  });
  try {
    current = await run('status');
    if (operation === 'status' || current.status === 'failed' && desktopCertificateIdentity(current) !== 'missing') return project(current);
    if ((operation === 'setup' || operation === 'install') && !canInstall) {
      return project({ ...current, status: 'manual_required', code: 'local_ui_device_ca_manual_install_required' });
    }
    if (desktopCertificateIdentity(current) === 'missing' && operation !== 'install') {
      stage = 'generate';
      const generated = await run('generate');
      if (generated.status === 'failed' && generated.code !== 'local_ui_device_ca_exists') return failed(generated);
      stage = 'status';
      current = await run('status');
    }
    if (desktopCertificateIdentity(current) !== 'ready' || current.status === 'failed') return project(current);
    if (operation === 'generate' || current.trust === 'trusted') return project(current);
    stage = 'install';
    const installed = await run('install');
    if (installed.status === 'failed' || installed.status === 'manual_required') return failed(installed);
    stage = 'verify';
    const verified = await run('status');
    if (verified.status === 'failed') return failed(verified);
    current = verified;
    if (verified.trust !== 'trusted') return failed({ status: 'failed', code: 'local_ui_device_ca_trust_not_confirmed' });
    return project(verified);
  } catch (error) {
    const timeout = typeof error === 'object' && error !== null && 'killed' in error && error.killed;
    return failed({ status: 'failed', code: timeout ? 'local_ui_device_ca_timeout' : 'local_ui_device_ca_operation_failed',
      message: error instanceof Error ? error.message : String(error) });
  }
}

export function manageDesktopCertificate(executable: string, stateRoot: string, operation: DesktopCertificateOperation): Promise<DesktopCertificateReport> {
  return performDesktopCertificateOperation((command) => runDesktopCertificateCommand(executable, stateRoot, command), operation,
    process.platform === 'darwin' || process.platform === 'win32');
}

export async function requireHTTPSCertificateBeforeRestart(protocol: string | undefined, inspect: CertificateRunner): Promise<void> {
  if (protocol !== 'https') return;
  const report = await inspect('status');
  if (desktopCertificateIdentity(report) !== 'ready' || report.status === 'failed') {
    throw new Error('HTTPS certificate verification failed. Check HTTPS configuration before restarting; the current Runtime has been kept running.');
  }
}
