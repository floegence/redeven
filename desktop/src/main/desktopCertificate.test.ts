import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { selectDesktopCertificateImport, certificateCommandArguments, performDesktopCertificateOperation, requireHTTPSCertificateBeforeRestart, type CertificateRunner } from './desktopCertificate';
import type { DesktopCertificateReport } from '../shared/desktopCertificate';

const missing: DesktopCertificateReport = { status: 'failed', code: 'local_ui_device_ca_missing', identity: 'missing', trust: 'unknown' };
const ready: DesktopCertificateReport = { status: 'ready', code: 'local_ui_device_ca_untrusted', identity: 'ready', trust: 'untrusted', certificate_path: '/state/device-ca.pem', can_manage: true };
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
  it.each([missing, { ...missing, identity: 'invalid' }, { ...ready, status: 'failed', code: 'local_ui_device_ca_operation_failed' }, { ...ready, status: 'failed', code: 'local_ui_certificate_bind_invalid', message: 'Server certificate does not cover 192.0.2.1' }])('rejects an unusable or unverified identity before restart', async (report) => {
    await expect(requireHTTPSCertificateBeforeRestart('https', runner(report))).rejects.toThrow('kept running');
  });
  it('allows an untrusted valid identity and never checks certificates for HTTP', async () => {
    await expect(requireHTTPSCertificateBeforeRestart('https', runner(ready))).resolves.toBeUndefined();
    const inspect = runner();
    await requireHTTPSCertificateBeforeRestart('http', inspect);
    expect(inspect).not.toHaveBeenCalled();
  });
});


describe('certificate replacement orchestration', () => {
 it.each(['import','regenerate','remove'] as const)('executes %s explicitly without installing trust',async(operation)=>{
  const run=runner({...ready,identity:'invalid',status:'failed',code:'local_ui_device_ca_invalid'}, {...ready,status:'updated'},operation==='remove'?missing:ready);
  const result=await performDesktopCertificateOperation(run,operation,true);
  expect(result.status).toBe('updated'); expect(run.mock.calls.flat()).toEqual(['status',operation,'status']);
 });
 it('retains the existing identity after picker cancellation or invalid input',async()=>{
  const canceled=runner(ready,{status:'canceled',code:'local_ui_certificate_selection_canceled'});
  expect(await performDesktopCertificateOperation(canceled,'import',true)).toMatchObject({status:'canceled',identity:'ready'});
  const invalid=runner(ready,{status:'failed',code:'local_ui_certificate_import_failed',message:'Keys do not match'});
  expect(await performDesktopCertificateOperation(invalid,'import',true)).toMatchObject({status:'failed',identity:'ready',failure_stage:'import'});
 });
 it('never offers server leaf installation as a root',async()=>{
  const run=runner({...ready,certificate_kind:'server'});
  expect(await performDesktopCertificateOperation(run,'setup',true)).toMatchObject({status:'manual_required',can_install:false});
  expect(run).toHaveBeenCalledTimes(1);
 });
 it('requires Runtime support for explicit replacement',async()=>{
  const run=runner({...ready,can_manage:false});
  expect(await performDesktopCertificateOperation(run,'regenerate',true)).toMatchObject({code:'local_ui_certificate_upgrade_required'});
  expect(run).toHaveBeenCalledTimes(1);
 });
});


describe('main process certificate file selection', () => {
  it('cancels at either picker without reading files or requesting a key unnecessarily', async () => {
    const select = vi.fn().mockResolvedValueOnce(undefined);
    expect(await selectDesktopCertificateImport(select)).toBeUndefined();
    expect(select.mock.calls.flat()).toEqual(['certificate']);
    const keyCanceled = vi.fn().mockResolvedValueOnce('/not-read').mockResolvedValueOnce(undefined);
    expect(await selectDesktopCertificateImport(keyCanceled)).toBeUndefined();
  });
  it('reads bounded files privately and reports errors without private paths or file contents', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-certificate-picker-'));
    const cert = path.join(dir, 'cert.pem');
    const key = path.join(dir, 'private-secret.key');
    try {
      await fs.writeFile(cert, 'public certificate');
      await fs.writeFile(key, 'private material', { mode: 0o600 });
      const select = async (kind: 'certificate' | 'key') => kind === 'certificate' ? cert : key;
      expect(await selectDesktopCertificateImport(select)).toEqual({ certificate_pem: 'public certificate', private_key_pem: 'private material' });
      await fs.writeFile(key, Buffer.alloc(1024 * 1024 + 1));
      await expect(selectDesktopCertificateImport(select)).rejects.toThrow('at most 1 MiB');
      await fs.unlink(key);
      try { await selectDesktopCertificateImport(select); throw new Error('Expected read failure'); }
      catch (error) { expect(String(error)).not.toContain(dir); expect(String(error)).not.toContain('private-secret'); }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('keeps PEM out of process arguments and supports bind coverage checks', () => {
    expect(certificateCommandArguments('import')).toEqual(['device-ca', 'import', '--confirm']);
    expect(certificateCommandArguments('status', 'localhost:23998')).toEqual(['device-ca', 'status', '--bind', 'localhost:23998']);
  });
});
