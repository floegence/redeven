import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserPackages, browserPackageOwner } from './browserPackage';
const roots: string[] = [];
const services: BrowserPackages[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.close())); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const pkg = { id: 'chromium-linux-arm64', sha256: 'a'.repeat(64), size_bytes: 8 };
async function fixture(slow = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-browser-package-')); roots.push(root);
  const executable = path.join(root, 'runtime');
  await fs.writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');const arg=n=>process.argv[process.argv.indexOf(n)+1];const root=arg('--cache'),id=arg('--package-id'),sha256=arg('--sha256'),size_bytes=Number(arg('--size'));fs.writeFileSync(path.join(root,'pid'),String(process.pid));console.log(JSON.stringify({phase:'checking',received_bytes:0,total_bytes:size_bytes}));setTimeout(()=>{const file=path.join(root,sha256),from_cache=fs.existsSync(file);fs.writeFileSync(file,'verified');console.log(JSON.stringify({complete:true,from_cache,package:{id,sha256,size_bytes}}))},${slow ? 10000 : 5});\n`, { mode: 0o700 });
  const service = new BrowserPackages(() => executable, () => path.join(root, 'cache')); services.push(service);
  return { root, service };
}
describe.skipIf(process.platform === 'win32')('Desktop browser package ownership', () => {
  it('keeps target identity, scopes reads and cancellation, and reuses cache after release', async () => {
    const { service } = await fixture(); const progress: unknown[] = [];
    expect(await service.request(10, 'environment-1', { action: 'acquire', operation_id: 'first', package: pkg }, p => progress.push(p))).toEqual({ ok: true, package: pkg, from_cache: false });
    expect(progress).toContainEqual({ operation_id: 'first', phase: 'checking', received_bytes: 0, total_bytes: 8 });
    expect((await service.request(11, 'environment-1', { action: 'read', operation_id: 'first', offset: 0 }, () => {})).ok).toBe(false);
    expect((await service.request(10, 'other-environment', { action: 'read', operation_id: 'first', offset: 0 }, () => {})).ok).toBe(false);
    await service.cancel(11, 'first'); await service.cancel(10, 'other');
    expect(Buffer.from((await service.request(10, 'environment-1', { action: 'read', operation_id: 'first', offset: 0 }, () => {})).data!).toString()).toBe('verified');
    expect((await service.request(10, 'environment-1', { action: 'acquire', operation_id: 'duplicate', package: pkg }, () => {})).ok).toBe(false);
    await service.request(10, 'environment-1', { action: 'release', operation_id: 'first' }, () => {});
    expect((await service.request(10, 'environment-1', { action: 'read', operation_id: 'first', offset: 0 }, () => {})).ok).toBe(false);
    expect(await service.request(10, 'environment-1', { action: 'acquire', operation_id: 'second', package: pkg }, () => {})).toMatchObject({ ok: true, from_cache: true });
    await service.cancelEnvironment('environment-1');
    expect((await service.request(10, 'environment-1', { action: 'read', operation_id: 'second', offset: 0 }, () => {})).ok).toBe(false);
  });
  it('cancellation waits for its exact child and preserves existing cache bytes', async () => {
    const { service, root } = await fixture(true);
    let started!: () => void; const progress = new Promise<void>(resolve => { started = resolve; });
    const acquisition = service.request(10, 'environment-1', { action: 'acquire', operation_id: 'slow', package: pkg }, () => started());
    await progress; const pid = Number(await fs.readFile(path.join(root, 'cache', 'pid'), 'utf8'));
    await service.cancel(10, 'slow'); expect((await acquisition).ok).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('cancels before process startup without losing ownership', async () => {
    const { service } = await fixture(true);
    const acquisition = service.request(10, 'environment-1', { action: 'acquire', operation_id: 'early', package: pkg }, () => {});
    await service.cancel(10); expect((await acquisition).ok).toBe(false);
  });
});

it('authorizes only the current main frame of the environment or live launcher', () => {
  const mainFrame = {};
  const event = { sender: { id: 10, mainFrame, isDestroyed: () => false }, senderFrame: mainFrame } as unknown as Parameters<typeof browserPackageOwner>[0];
  const session = { closing: false, target: { environment_id: 'environment-1' }, root_window: { webContentsID: 10 } };
  expect(browserPackageOwner(event, session)).toEqual({ id: 10, environmentID: 'environment-1' });
  expect(browserPackageOwner(event, null, 'local')).toEqual({ id: 10, environmentID: 'local' });
  expect(browserPackageOwner(event, null)).toBeUndefined();
  expect(browserPackageOwner(event, { ...session, closing: true })).toBeUndefined();
  expect(browserPackageOwner(event, { ...session, root_window: { webContentsID: 11 } })).toBeUndefined();
  expect(browserPackageOwner({ ...event, senderFrame: {} as typeof event.senderFrame }, session, 'local')).toBeUndefined();
});
