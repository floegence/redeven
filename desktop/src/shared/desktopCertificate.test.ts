import { describe, expect, it } from 'vitest';
import { isDesktopCertificateOperation, parseDesktopCertificateReport, parseDesktopCertificateRequest, desktopCertificateIdentity } from './desktopCertificate';

describe('Desktop certificate boundary', () => {
  it('accepts only the explicit maintenance operations', () => {
    for (const operation of ['status', 'generate', 'install', 'setup', 'import', 'regenerate', 'remove']) expect(isDesktopCertificateOperation(operation)).toBe(true);
    for (const operation of ['export', 'delete', '', null, { operation: 'install' }]) expect(isDesktopCertificateOperation(operation)).toBe(false);
  });

  it('projects public certificate metadata without private material', () => {
    const report = parseDesktopCertificateReport({
      schema_version: 'redeven.local_authority_maintenance.v1', status: 'ready', code: 'local_ui_device_ca_ready',
      identity: 'ready', trust: 'untrusted', certificate_path: '/runtime/device-ca.pem',
      private_key: 'must not reach renderer', token: 'must not reach renderer',
    });
    expect(report).toMatchObject({ identity: 'ready', trust: 'untrusted', certificate_path: '/runtime/device-ca.pem' });
    expect(JSON.stringify(report)).not.toContain('must not reach renderer');
  });

  it('normalizes the epoch 18 untrusted status without misclassifying other failures', () => {
    const legacy = parseDesktopCertificateReport({ schema_version: 'redeven.local_authority_maintenance.v1', status: 'failed',
      code: 'local_ui_device_ca_untrusted', identity: 'ready', trust: 'untrusted' });
    expect(legacy.status).toBe('ready');
    expect(desktopCertificateIdentity(legacy)).toBe('ready');
    expect(desktopCertificateIdentity({ status: 'failed', code: 'permission_denied' })).toBe('unknown');
  });

  it('requires an explicit environment without accepting renderer paths', () => {
    expect(parseDesktopCertificateRequest({ environment_id: 'local', operation: 'setup', state_root: '/foreign' })).toEqual({ environment_id: 'local', operation: 'setup' });
    for (const input of ['setup', {}, { environment_id: '', operation: 'setup' }, { environment_id: 'local', operation: 'delete' }]) {
      expect(() => parseDesktopCertificateRequest(input)).toThrow();
    }
  });

  it('rejects malformed or incompatible maintenance reports', () => {
    for (const report of [null, [], {}, { schema_version: 'future', status: 'ready', code: 'ready' }]) {
      expect(() => parseDesktopCertificateReport(report)).toThrow();
    }
  });
});

 it('requires explicit replacement confirmation and strips renderer file paths and PEM', () => {
   for (const operation of ['import', 'regenerate', 'remove']) {
     expect(() => parseDesktopCertificateRequest({ environment_id: 'local', operation })).toThrow('confirmation');
     expect(parseDesktopCertificateRequest({ environment_id: 'local', operation, confirmed: true, private_key_pem: 'secret', certificate_path: '/untrusted' })).toEqual({ environment_id: 'local', operation, confirmed: true });
   }
 });
