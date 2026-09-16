import { execFile } from 'node:child_process';
import { sanitizeDesktopChildEnvironment } from './desktopProcessEnvironment';
import { parseDesktopCertificateReport, type DesktopCertificateOperation, type DesktopCertificateReport } from '../shared/desktopCertificate';

export function manageDesktopCertificate(
  executable: string, stateRoot: string, operation: DesktopCertificateOperation,
): Promise<DesktopCertificateReport> {
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
