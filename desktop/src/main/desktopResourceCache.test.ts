import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

let DesktopResourceCache: typeof import('./desktopResourceCache').DesktopResourceCache;
let compiled: string;
beforeAll(async () => {
  compiled = await mkdtemp(path.join(process.cwd(), '.resource-cache-unit-'));
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--outDir', compiled, '--noEmitOnError']);
  DesktopResourceCache = createRequire(path.join(process.cwd(), 'package.json'))(path.join(compiled, 'main/desktopResourceCache.js')).DesktopResourceCache;
}, 30_000);
afterAll(async () => { if (compiled) await rm(compiled, { recursive: true, force: true }); });

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'redeven-resource-cache-')); roots.push(root); return root; }

describe('asynchronous Desktop presentation snapshots', () => {
  it('survives a new store instance without touching UI preference files', async () => {
    const root = await fixture();
    await new DesktopResourceCache(root).set('host/alice', 'applications', '[]');
    const reopened = new DesktopResourceCache(root);
    expect(await reopened.get('host/alice', 'applications')).toBe('[]');
    expect(await reopened.get('host/bob', 'applications')).toBeNull();
    expect(await reopened.list('host/alice')).toEqual([expect.objectContaining({ key: 'applications', bytes: 2 })]);
    expect((await readdir(root)).some(name => name.includes('ui-state'))).toBe(false);
  });
  it('enforces one byte budget across owners without exposing their keys', async () => {
    const root = await fixture();
    const cache = new DesktopResourceCache(root, 10);
    await cache.set('alice', 'old', '123456');
    await new Promise(resolve => setTimeout(resolve, 10));
    await cache.set('bob', 'new', '123456');
    expect(await cache.get('alice', 'old')).toBeNull();
    expect(await cache.get('bob', 'new')).toBe('123456');
    expect(await cache.list('alice')).toEqual([]);
    const before = await cache.list('bob');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(await cache.list('bob')).toEqual(before);
  });
  it('uses opaque filenames, handles corrupt snapshots and serializes writes with removal', async () => {
    const root = await fixture();
    const cache = new DesktopResourceCache(root);
    await cache.set('owner', '../../outside', 'first');
    await Promise.all([cache.set('owner', '../../outside', 'second'), cache.remove('owner', '../../outside')]);
    expect(await cache.get('owner', '../../outside')).toBeNull();
    expect(await cache.list('another-owner')).toEqual([]);
    await cache.set('owner', 'broken', 'valid');
    const ownerDirectory = path.join(root, (await readdir(root))[0]);
    const file = path.join(ownerDirectory, (await readdir(ownerDirectory))[0]);
    await writeFile(file, 'invalid JSON');
    expect(await cache.get('owner', 'broken')).toBeNull();
    await writeFile(path.join(root, 'unrelated'), 'not a snapshot');
    expect(await cache.list('owner')).toEqual([]);
  });
});
