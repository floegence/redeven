import { describe, expect, it, vi } from 'vitest';
import { performDesktopCertificateOperation, requireHTTPSCertificateBeforeRestart, type CertificateRunner } from './desktopCertificate';
import type { DesktopCertificateReport } from '../shared/desktopCertificate';

const missing: DesktopCertificateReport = { status: 'failed', code: 'local_ui_device_ca_missing', identity: 'missing', trust: 'unknown' };
const ready: DesktopCertificateReport = { status: 'ready', code: 'local_ui_device_ca_untrusted', identity: 'ready', trust: 'untrusted', certificate_path: '/state/device-ca.pem' };
const trusted = { ...ready, trust: 'trusted' };
function runner(...reports: Array<DesktopCertificateReport | Error>) {
  const run = vi.fn<CertificateRunner>();
  for (const report of reports) {
    if (report instanceof Error) run.mockRejectedValueOnce(report);
    else run.mockResolvedValueOnce(report);
  }
  return run;
}

describe('explicit HTTPS setup', () => {
  it('creates only a missing identity, installs trust and verifies the result', async () => {
    const run = runner(missing, { ...ready, status: 'generated' }, ready, { status: 'installed', code: 'installed' }, trusted);
    expect(await performDesktopCertificateOperation(run, 'setup', true)).toMatchObject({ identity: 'ready', trust: 'trusted' });
    expect(run.mock.calls.flat()).toEqual(['status', 'generate', 'status', 'install', 'status']);
  });
  it('reuses an existing certificate and does nothing when already trusted', async () => {
    const run = runner(ready, { status: 'installed', code: 'installed' }, trusted);
    await performDesktopCertificateOperation(run, 'setup', true);
    expect(run.mock.calls.flat()).toEqual(['status', 'install', 'status']);
    const done = runner(trusted);
    await performDesktopCertificateOperation(done, 'setup', true);
    expect(done.mock.calls.flat()).toEqual(['status']);
  });
  it.each(['local_ui_device_ca_install_canceled', 'local_ui_device_ca_install_failed', 'local_ui_device_ca_timeout'])(
    'retains a created certificate after %s and resumes without generation', async (code) => {
      const run = runner(missing, ready, ready, { status: 'failed', code });
      expect(await performDesktopCertificateOperation(run, 'setup', true)).toMatchObject({ status: 'failed', code, identity: 'ready', trust: 'untrusted', failure_stage: 'install', certificate_path: ready.certificate_path });
      const retry = runner(ready, { status: 'installed', code: 'installed' }, trusted);
      await performDesktopCertificateOperation(retry, 'install', true);
      expect(retry).not.toHaveBeenCalledWith('generate');
    });
  it('does not hide a certificate that becomes invalid during trust installation', async () => {
    const run = runner(ready, { status: 'failed', code: 'local_ui_device_ca_invalid' });
    const report = await performDesktopCertificateOperation(run, 'install', true);
    await expect(requireHTTPSCertificateBeforeRestart('https', runner(report))).rejects.toThrow();
  });
  it('does not claim success merely because the install command succeeded', async () => {
    const run = runner(ready, { status: 'installed', code: 'installed' }, ready);
    expect(await performDesktopCertificateOperation(run, 'install', true)).toMatchObject({ status: 'failed', identity: 'ready', code: 'local_ui_device_ca_trust_not_confirmed', failure_stage: 'verify' });
  });
  it('distinguishes a query failure from a damaged certificate', async () => {
    const run = runner(new Error('unavailable'));
    expect(await performDesktopCertificateOperation(run, 'status', true)).toMatchObject({ status: 'failed', failure_stage: 'status', code: 'local_ui_device_ca_operation_failed' });
  });
  it('does not generate or install over an invalid identity', async () => {
    const run = runner({ ...missing, identity: 'invalid', code: 'local_ui_device_ca_invalid' });
    await performDesktopCertificateOperation(run, 'setup', true);
    expect(run.mock.calls.flat()).toEqual(['status']);
  });
  it('does not replace a certificate created concurrently', async () => {
    const run = runner(missing, { status: 'failed', code: 'local_ui_device_ca_exists' }, ready);
    expect(await performDesktopCertificateOperation(run, 'generate', false)).toMatchObject({ identity: 'ready', can_install: false });
    expect(run.mock.calls.flat()).toEqual(['status', 'generate', 'status']);
  });
  it('keeps unsupported platforms and remote runtimes on the manual trust path', async () => {
    const run = runner(ready);
    expect(await performDesktopCertificateOperation(run, 'setup', false)).toMatchObject({ status: 'manual_required', can_install: false });
    expect(run.mock.calls.flat()).toEqual(['status']);
  });
});

describe('HTTPS restart preflight', () => {
  it.each([missing, { ...missing, identity: 'invalid' }, { ...ready, status: 'failed', code: 'local_ui_device_ca_operation_failed' }])('rejects an unusable or unverified identity before restart', async (report) => {
    await expect(requireHTTPSCertificateBeforeRestart('https', runner(report))).rejects.toThrow('kept running');
  });
  it('allows an untrusted valid identity and never checks certificates for HTTP', async () => {
    await expect(requireHTTPSCertificateBeforeRestart('https', runner(ready))).resolves.toBeUndefined();
    const inspect = runner();
    await requireHTTPSCertificateBeforeRestart('http', inspect);
    expect(inspect).not.toHaveBeenCalled();
  });
});
