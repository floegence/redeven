import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HostApplicationComponents } from './hostApplicationComponents';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture(slow = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-native-relay-')); roots.push(root);
  const executable = path.join(root, 'runtime');
  await fs.writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv.includes('--maintenance'))process.exit(0);const out=process.argv[process.argv.indexOf('--output')+1];fs.writeFileSync(require('node:path').join(require('node:path').dirname(out),'pid'),String(process.pid));console.log(JSON.stringify({phase:'packing',component_bytes:8,cached_bytes:8,download_bytes:0,downloaded_bytes:0}));setTimeout(()=>{fs.writeFileSync(out,'verified');},${slow ? 10000 : 5});\n`, { mode: 0o700 });
  return { manager: new HostApplicationComponents(() => executable, () => path.join(root, 'components')), root };
}
describe.skipIf(process.platform === 'win32')('Desktop component acquisition adapter', () => {
  it('delegates to the fixed Runtime and scopes chunk access to its initiating document', async () => {
    const { manager } = await fixture(); const events: unknown[] = [];
    expect(await manager.acquire(10, 'arm64', value => events.push(value))).toEqual({ ok: true, size: 8 });
    expect(events).toEqual([{ phase: 'packing', component_bytes: 8, cached_bytes: 8, download_bytes: 0, downloaded_bytes: 0 }]);
    expect(await manager.read(11, 0)).toEqual({ ok: false });
    expect(await manager.read(10, -1)).toEqual({ ok: false });
    expect(Buffer.from((await manager.read(10, 0)).data!).toString()).toBe('verified');
    await manager.cancel(10); expect(await manager.read(10, 0)).toEqual({ ok: false });
  });
  it('cancels a reservation before filesystem preparation can start a process', async () => {
    const { manager, root } = await fixture(true);
    const acquisition = manager.acquire(10, 'amd64', () => {});
    await manager.cancel(10);
    expect(await acquisition).toEqual({ ok: false });
    expect((await fs.readdir(path.join(root, 'components'))).filter(name => name.startsWith('transfer-'))).toEqual([]);
  });
  it('passes the exact receiver plan to the fixed Runtime and reports an unknown catalog', async () => {
    const { manager, root } = await fixture();
    await fs.writeFile(path.join(root, 'runtime'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'arguments'))},JSON.stringify(process.argv.slice(2)));process.exit(3);\n`, { mode: 0o700 });
    const plan = { package_digest: 'a'.repeat(64), architecture: 'arm64' as const, missing_artifacts: ['b'.repeat(64)], missing_bytes: 50 };
    expect(await manager.acquire(10, 'arm64', () => {}, plan)).toEqual({ ok: false, error: 'target_mismatch' });
    const args: string[] = JSON.parse(await fs.readFile(path.join(root, 'arguments'), 'utf8'));
    expect(JSON.parse(args[args.indexOf('--plan') + 1])).toEqual(plan);
    expect(args.slice(0, 3)).toEqual(['host-application-package', '--arch', 'arm64']);
    expect(await manager.read(10, 0)).toEqual({ ok: false });
    expect((await fs.readdir(path.join(root, 'components'))).filter(name => name.startsWith('transfer-'))).toEqual([]);
  });
  it('rejects cross-architecture and path-like artifact selectors before starting acquisition', async () => {
    const { manager, root } = await fixture();
    const plan = { package_digest: 'a'.repeat(64), architecture: 'arm64' as const, missing_artifacts: ['b'.repeat(64)], missing_bytes: 50 };
    expect(await manager.acquire(10, 'amd64', () => {}, plan)).toEqual({ ok: false, error: 'target_mismatch' });
    expect(await manager.acquire(10, 'arm64', () => {}, { ...plan, missing_artifacts: ['../../payload'] })).toEqual({ ok: false, error: 'target_mismatch' });
    await expect(fs.stat(path.join(root, 'components'))).rejects.toThrow();
  });
});

it.skipIf(process.platform === 'win32')('waits for the exact acquisition process to exit before cancellation completes', async () => {
 const { manager, root } = await fixture(true);
 let started!: () => void;
 const progress = new Promise<void>(resolve => { started = resolve; });
 const acquisition = manager.acquire(10, 'arm64', () => started());
 await progress;
 const directory = (await fs.readdir(path.join(root, 'components'))).find(name => name.startsWith('transfer-'))!;
 const pid = Number(await fs.readFile(path.join(root, 'components', directory, 'pid'), 'utf8'));
 await manager.cancel(10);
 expect(await acquisition).toEqual({ ok: false });
 expect(() => process.kill(pid, 0)).toThrow();
 expect(await manager.read(10, 0)).toEqual({ ok: false });
});

it.skipIf(process.platform === 'win32')('reports cache inspection without inventing download bytes and preserves cached files on cleanup', async () => {
 const { manager, root } = await fixture();
 const cache = path.join(root, 'components', 'cache', 'archives');
 await fs.mkdir(cache, { recursive: true });
 await fs.writeFile(path.join(cache, 'a'.repeat(64)), 'cached');
 await fs.writeFile(path.join(root, 'runtime'), `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv.includes('--maintenance'))process.exit(0);console.log(JSON.stringify({phase:'checking',component_bytes:8,downloaded_bytes:0}));console.log(JSON.stringify({phase:'packing',component_bytes:8,cached_bytes:8,download_bytes:0,downloaded_bytes:0}));fs.writeFileSync(process.argv[process.argv.indexOf('--output')+1],'verified');\n`, { mode: 0o700 });
 const events: unknown[] = [];
 expect(await manager.acquire(10, 'arm64', value => events.push(value))).toEqual({ ok: true, size: 8 });
 expect(events).toEqual([{ phase: 'checking', component_bytes: 8, downloaded_bytes: 0 }, { phase: 'packing', component_bytes: 8, cached_bytes: 8, download_bytes: 0, downloaded_bytes: 0 }]);
 await manager.cancel(10);
 expect(await fs.readFile(path.join(cache, 'a'.repeat(64)), 'utf8')).toBe('cached');
});

it.skipIf(process.platform === 'win32')('cleans only previous transfer directories before creating a current transfer', async () => {
 const { manager, root } = await fixture();
 const base = path.join(root, 'components');
 await fs.mkdir(path.join(base, 'transfer-ABC123'), { recursive: true });
 await fs.mkdir(path.join(base, 'transfer-user-notes'));
 const outside = path.join(root, 'outside'); await fs.mkdir(outside);
 await fs.writeFile(path.join(outside, 'keep'), 'keep');
 await fs.symlink(outside, path.join(base, 'transfer-XYZ789'));
 await manager.initialize();
 await expect(fs.stat(path.join(base, 'transfer-ABC123'))).rejects.toThrow();
 expect((await fs.lstat(path.join(base, 'transfer-XYZ789'))).isSymbolicLink()).toBe(true);
 expect((await fs.stat(path.join(base, 'transfer-user-notes'))).isDirectory()).toBe(true);
 expect(await manager.acquire(1, 'arm64', () => {})).toEqual({ ok: true, size: 8 });
 await manager.initialize();
 expect((await manager.read(1, 0)).ok).toBe(true);
 await manager.cancel(1);
 expect(await fs.readFile(path.join(outside, 'keep'), 'utf8')).toBe('keep');
});
