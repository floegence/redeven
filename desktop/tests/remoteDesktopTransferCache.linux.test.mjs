import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { desktopTransferNames, desktopTransferProbeCommand, desktopTransferPublishCommand } from '../src/main/remoteDesktopTransferCache.ts';

const run = promisify(execFile);
const temporary = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });
const content = new Map(desktopTransferNames.map(name => [name, Buffer.from(`verified-${name}`)]));
const files = [...content].map(([name, data]) => ({ name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }));
async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-transfer-test-'));
  temporary.push(home);
  const shell = (script) => run('/bin/sh', ['-c', script], { env: { ...process.env, HOME: home }, timeout: 30000 });
  const probe = async (expected = files) => {
    const { stdout } = await shell(desktopTransferProbeCommand(expected));
    const [directory, ...missing] = stdout.trimEnd().split('\n');
    temporary.push(directory);
    return { directory, missing };
  };
  const cache = path.join(home, '.cache/redeven/desktop-transfer-v1');
  const populate = async () => {
    const state = await probe();
    assert.deepEqual(state.missing, [...desktopTransferNames]);
    for (const [name, data] of content) await fs.writeFile(path.join(state.directory, name), data);
    await shell(desktopTransferPublishCommand(state.directory, files));
    return state;
  };
  return { home, cache, shell, probe, populate };
}

describe('real Linux transfer cache', { skip: process.platform !== 'linux' }, () => {
  it('reuses every verified byte in private, independent transaction copies', async () => {
    const f = await fixture();
    await f.populate();
    const state = await f.probe();
    assert.deepEqual(state.missing, []);
    for (const [name, data] of content) {
      assert.deepEqual(await fs.readFile(path.join(state.directory, name)), data);
      assert.equal((await fs.stat(path.join(f.cache, name))).mode & 0o777, 0o400);
    }
    await fs.writeFile(path.join(state.directory, 'redeven'), 'private mutation');
    assert.deepEqual(await fs.readFile(path.join(f.cache, 'redeven')), content.get('redeven'));
  });
  it('detects same-size corruption, missing files and changed versions independently', async () => {
    const f = await fixture();
    await f.populate();
    const damaged = path.join(f.cache, 'desktop-drm');
    await fs.chmod(damaged, 0o600);
    await fs.writeFile(damaged, Buffer.alloc(content.get('desktop-drm').length));
    await fs.chmod(damaged, 0o400);
    await fs.unlink(path.join(f.cache, 'libdrmtap.LICENSE'));
    const expected = files.map(file => file.name === 'redeven' ? { ...file, sha256: 'f'.repeat(64) } : file);
    const state = await f.probe(expected);
    assert.deepEqual(state.missing, ['desktop-drm', 'libdrmtap.LICENSE', 'redeven']);
    for (const name of state.missing) await fs.writeFile(path.join(state.directory, name), content.get(name));
    await f.shell(desktopTransferPublishCommand(state.directory, files.filter(file => state.missing.includes(file.name))));
    assert.deepEqual((await f.probe()).missing, []);
  });
  it('handles simultaneous first-time inspection without duplicate cache directories', async () => {
    const f = await fixture();
    const states = await Promise.all(Array.from({ length: 4 }, () => f.probe()));
    for (const state of states) assert.deepEqual(state.missing, [...desktopTransferNames]);
    assert.equal(new Set(states.map(state => state.directory)).size, states.length);
    assert.deepEqual(await fs.readdir(f.cache), []);
  });
  it('rejects symlinks, writable files and untrusted cache directories', async () => {
    const f = await fixture();
    await f.populate();
    await fs.unlink(path.join(f.cache, 'desktop-drm'));
    await fs.symlink(path.join(f.cache, 'redeven'), path.join(f.cache, 'desktop-drm'));
    await fs.chmod(path.join(f.cache, 'redeven'), 0o600);
    assert.deepEqual((await f.probe()).missing, ['desktop-drm', 'redeven']);
    await fs.chmod(f.cache, 0o777);
    await assert.rejects(f.probe());
    await fs.chmod(f.cache, 0o700);
    await fs.rename(f.cache, f.cache + '-real');
    await fs.symlink(f.cache + '-real', f.cache);
    await assert.rejects(f.probe());
    await fs.unlink(f.cache);
    await fs.writeFile(f.cache, 'not a directory', { mode: 0o700 });
    await assert.rejects(f.probe());
  });
  it('keeps atomic cache entries valid across concurrent publications', async () => {
    const f = await fixture();
    const first = await f.populate();
    const second = await f.probe();
    await Promise.all([first, second].map(state => f.shell(desktopTransferPublishCommand(state.directory, files))));
    assert.deepEqual((await f.probe()).missing, []);
    assert.deepEqual((await fs.readdir(f.cache)).sort(), [...desktopTransferNames].sort());
  });
  it('does not publish corrupt uploads or trust metadata without checking bytes', async () => {
    const f = await fixture();
    const state = await f.probe();
    for (const [name, data] of content) await fs.writeFile(path.join(state.directory, name), Buffer.alloc(data.length));
    await assert.rejects(f.shell(desktopTransferPublishCommand(state.directory, files)));
    assert.deepEqual((await f.probe()).missing, [...desktopTransferNames]);
  });
  it('rejects a symbolic link even when its target matches the trusted bytes', async () => {
    const f = await fixture();
    const state = await f.probe();
    const file = files[0];
    const target = path.join(f.home, 'redirected-service');
    await fs.writeFile(target, content.get(file.name));
    await fs.symlink(target, path.join(state.directory, file.name));
    await assert.rejects(f.shell(desktopTransferPublishCommand(state.directory, [file])));
    assert.deepEqual(await fs.readdir(f.cache), []);
  });
});
