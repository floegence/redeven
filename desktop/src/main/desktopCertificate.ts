import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { sanitizeDesktopChildEnvironment } from './desktopProcessEnvironment';
import { desktopCertificateIdentity, isCertificateReplacement, parseDesktopCertificateReport, type DesktopCertificateOperation, type DesktopCertificateReport } from '../shared/desktopCertificate';

export type CertificateCommand = Exclude<DesktopCertificateOperation, 'setup'>;
export type CertificateRunner = (operation: CertificateCommand) => Promise<DesktopCertificateReport>;

export type CertificateImport = Readonly<{ certificate_pem: string; private_key_pem: string }>;

// Paths and PEM data stay in main; only a validated public report crosses IPC.
export async function selectDesktopCertificateImport(select: (kind: 'certificate' | 'key') => Promise<string | undefined>): Promise<CertificateImport | undefined> {
  const certificate = await select('certificate');
  if (!certificate) return undefined;
  const key = await select('key');
  if (!key) return undefined;
  async function read(filePath: string): Promise<string> {
    let file: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      file = await fs.open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > 1024 * 1024) throw new Error('size');
      const buffer = Buffer.alloc(1024 * 1024 + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== stat.size) throw new Error('changed');
      return buffer.subarray(0, bytesRead).toString('utf8');
    } catch { throw new Error('Could not read the selected PEM files. Choose readable certificate and private key files, at most 1 MiB each.'); }
    finally { await file?.close(); }
  }
  return { certificate_pem: await read(certificate), private_key_pem: await read(key) };
}

export function certificateCommandArguments(operation: CertificateCommand, bind?: string): string[] {
  return ['device-ca', operation, ...(isCertificateReplacement(operation) ? ['--confirm'] : []),
    ...(operation === 'status' && bind ? ['--bind', bind] : [])];
}

export function runDesktopCertificateCommand(executable: string, stateRoot: string, operation: CertificateCommand, input?: CertificateImport, bind?: string): Promise<DesktopCertificateReport> {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, ['local-authority', ...certificateCommandArguments(operation, bind), '--state-root', stateRoot], {
      env: sanitizeDesktopChildEnvironment(process.env), timeout: 60_000, maxBuffer: 64 * 1024, windowsHide: true,
    }, (error, stdout, stderr) => {
      try {
        resolve(parseDesktopCertificateReport(JSON.parse(String(error ? stderr : stdout).trim())));
      } catch (parseError) {
        reject(error ?? parseError);
      }
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input ? JSON.stringify(input) : undefined);
  });
}

// One owner sequences setup and retains completed work when a later step fails.
export async function performDesktopCertificateOperation(
  run: CertificateRunner, operation: DesktopCertificateOperation, canInstall: boolean,
): Promise<DesktopCertificateReport> {
  let current: DesktopCertificateReport | undefined;
  let stage: NonNullable<DesktopCertificateReport['failure_stage']> = 'status';
  const project = (report: DesktopCertificateReport): DesktopCertificateReport => ({ ...report, can_install: canInstall && report.certificate_kind !== 'server' });
  const failed = (report: DesktopCertificateReport): DesktopCertificateReport => project({
    ...current, ...report, identity: report.identity ?? current?.identity,
    trust: report.trust ?? current?.trust, certificate_path: report.certificate_path ?? current?.certificate_path,
    not_after: report.not_after ?? current?.not_after, failure_stage: stage,
  });
  try {
    current = await run('status');
    if (isCertificateReplacement(operation)) {
      stage = operation;
      if (current.can_manage !== true) return failed({ status: 'failed', code: 'local_ui_certificate_upgrade_required' });
      const changed = await run(operation);
      if (changed.status === 'canceled') return project({ ...current, status: 'canceled', code: changed.code });
      if (changed.status === 'failed') return failed(changed);
      stage = 'verify';
      const verified = await run('status');
      if (operation === 'remove' && desktopCertificateIdentity(verified) === 'missing') {
        return project({ ...verified, status: 'updated', code: changed.code });
      }
      if (verified.status === 'failed') return failed(verified);
      return project({ ...verified, status: 'updated', code: changed.code });
    }
    if (operation === 'status' || current.status === 'failed' && desktopCertificateIdentity(current) !== 'missing') return project(current);
    if ((operation === 'setup' || operation === 'install') && (!canInstall || current.certificate_kind === 'server')) {
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

export async function requireHTTPSCertificateBeforeRestart(protocol: string | undefined, inspect: CertificateRunner): Promise<void> {
  if (protocol !== 'https') return;
  const report = await inspect('status');
  if (desktopCertificateIdentity(report) !== 'ready' || report.status === 'failed') {
    throw new Error(['HTTPS certificate verification failed. Check HTTPS configuration before restarting; the current Runtime has been kept running.', report.message].filter(Boolean).join(' '));
  }
}
