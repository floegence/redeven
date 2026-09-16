import { describe, expect, it } from 'vitest';
import { isDesktopCertificateOperation, parseDesktopCertificateReport } from './desktopCertificate';

describe('Desktop certificate boundary', () => {
  it('accepts only the explicit maintenance operations', () => {
    for (const operation of ['status', 'generate', 'install']) expect(isDesktopCertificateOperation(operation)).toBe(true);
    for (const operation of ['export', 'delete', '', null, { operation: 'install' }]) expect(isDesktopCertificateOperation(operation)).toBe(false);
  });

  it('projects public certificate metadata without private material', () => {
    const report = parseDesktopCertificateReport({
      schema_version: 'redeven.local_authority_maintenance.v1', status: 'ready', code: 'local_ui_device_ca_ready',
      identity: 'valid', trust: 'untrusted', certificate_path: '/runtime/device-ca.pem',
      private_key: 'must not reach renderer', token: 'must not reach renderer',
    });
    expect(report).toMatchObject({ identity: 'valid', trust: 'untrusted', certificate_path: '/runtime/device-ca.pem' });
    expect(JSON.stringify(report)).not.toContain('must not reach renderer');
  });

  it('rejects malformed or incompatible maintenance reports', () => {
    for (const report of [null, [], {}, { schema_version: 'future', status: 'ready', code: 'ready' }]) {
      expect(() => parseDesktopCertificateReport(report)).toThrow();
    }
  });
});
