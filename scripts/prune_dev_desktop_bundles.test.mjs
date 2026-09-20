import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { pruneDevelopmentBundles } from './prune_dev_desktop_bundles.mjs';

function fixture(t) {
  const stateRoot = realpathSync(mkdtempSync(join(tmpdir(), 'redeven bundle retention ')));
  const bundles = join(stateRoot, 'desktop', 'bundles');
  mkdirSync(bundles, { recursive: true });
  t.after(() => {
    function writable(path) {
      chmodSync(path, 0o700);
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isDirectory()) writable(join(path, entry.name));
      }
    }
    writable(stateRoot);
    rmSync(stateRoot, { recursive: true, force: true });
  });
  function bundle(index) {
    const manifest = JSON.stringify({ schema_version: 1, fixture: index });
    const path = join(bundles, createHash('sha256').update(manifest).digest('hex'));
    mkdirSync(join(path, 'nested'), { recursive: true });
    writeFileSync(join(path, 'desktop-bundle-manifest.json'), manifest, { mode: 0o400 });
    writeFileSync(join(path, 'nested', 'runtime'), 'rebuildable binary', { mode: 0o500 });
    chmodSync(join(path, 'nested'), 0o500);
    chmodSync(path, 0o500);
    utimesSync(path, index + 1, index + 1);
    return path;
  }
  return { stateRoot, bundles, bundle };
}

const noProcesses = () => '';

test('repeated builds retain only three recent immutable bundles', t => {
  const { stateRoot, bundles, bundle } = fixture(t);
  for (let i = 0; i < 9; i++) {
    const currentBundle = bundle(i);
    const result = pruneDevelopmentBundles({ stateRoot, currentBundle, readProcesses: noProcesses });
    assert.equal(result.removed.length, i < 3 ? 0 : 1);
    assert.equal(readdirSync(bundles).length, Math.min(i + 1, 3));
    assert.ok(existsSync(currentBundle));
    assert.equal(statSync(currentBundle).mode & 0o777, 0o500);
  }
});

test('preserves a reused current bundle and old bundles referenced in arguments or environment', t => {
  const { stateRoot, bundle } = fixture(t);
  const paths = Array.from({ length: 8 }, (_, i) => bundle(i));
  const readProcesses = () => `12 ${paths[1]}/redeven run\n13 electron REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT=${paths[2]} PATH=/usr/bin`;
  const result = pruneDevelopmentBundles({ stateRoot, currentBundle: paths[0], readProcesses });
  assert.deepEqual(result.removed.sort(), paths.slice(3, 5).sort());
  for (const path of [paths[0], paths[1], paths[2], ...paths.slice(5)]) assert.ok(existsSync(path));
  const later = pruneDevelopmentBundles({ stateRoot, readProcesses: noProcesses });
  assert.equal(later.removed.length, 3, 'exited processes must not pin old bundles indefinitely');
});

test('dry run reports candidates without changing any bytes or permissions', t => {
  const { stateRoot, bundle } = fixture(t);
  const paths = Array.from({ length: 5 }, (_, i) => bundle(i));
  const result = pruneDevelopmentBundles({ stateRoot, dryRun: true, readProcesses: noProcesses });
  assert.equal(result.removed.length, 0);
  assert.deepEqual(result.candidates.sort(), paths.slice(0, 2).sort());
  for (const path of paths) {
    assert.equal(statSync(path).mode & 0o777, 0o500);
    assert.equal(readFileSync(join(path, 'nested', 'runtime'), 'utf8'), 'rebuildable binary');
  }
});

test('failed process inventory prevents every deletion', t => {
  const { stateRoot, bundle } = fixture(t);
  const paths = Array.from({ length: 5 }, (_, i) => bundle(i));
  assert.throws(() => pruneDevelopmentBundles({ stateRoot, readProcesses() { throw new Error('inventory unavailable'); } }), /inventory unavailable/);
  paths.forEach(path => assert.ok(existsSync(path)));
});

test('only digest-verified direct child bundles are deleted; symlink targets and other state survive', t => {
  const { stateRoot, bundles, bundle } = fixture(t);
  const other = fixture(t);
  const outside = other.bundle(0);
  const old = bundle(0);
  chmodSync(old, 0o700);
  symlinkSync(outside, join(old, 'external'));
  chmodSync(old, 0o500);
  utimesSync(old, 1, 1);
  const targetMode = statSync(outside).mode;
  symlinkSync(outside, join(bundles, 'a'.repeat(64)));
  mkdirSync(join(bundles, '.build.active'));
  mkdirSync(join(bundles, 'unknown'));
  const damaged = join(bundles, 'b'.repeat(64));
  mkdirSync(damaged);
  writeFileSync(join(damaged, 'desktop-bundle-manifest.json'), '{}');
  mkdirSync(join(stateRoot, 'local-environment', 'ai'), { recursive: true });
  writeFileSync(join(stateRoot, 'local-environment', 'ai', 'threads.sqlite'), 'user data');
  [1, 2, 3].forEach(bundle);
  const result = pruneDevelopmentBundles({ stateRoot, readProcesses: noProcesses });
  assert.deepEqual(result.removed, [old]);
  assert.ok(existsSync(outside));
  assert.equal(statSync(outside).mode, targetMode, 'must not chmod through a symlink');
  for (const name of ['a'.repeat(64), 'b'.repeat(64), '.build.active', 'unknown']) assert.ok(existsSync(join(bundles, name)));
  assert.equal(readFileSync(join(stateRoot, 'local-environment', 'ai', 'threads.sqlite'), 'utf8'), 'user data');
});

test('rejects a symlinked bundle root and a current bundle outside the selected environment', t => {
  const first = fixture(t);
  const second = fixture(t);
  const other = second.bundle(0);
  [0, 1, 2, 3].forEach(first.bundle);
  assert.throws(() => pruneDevelopmentBundles({ stateRoot: first.stateRoot, currentBundle: other, readProcesses: noProcesses }), /current bundle/);
  const third = fixture(t);
  rmSync(third.bundles, { recursive: true });
  symlinkSync(first.bundles, third.bundles);
  assert.throws(() => pruneDevelopmentBundles({ stateRoot: third.stateRoot, readProcesses: noProcesses }), /symlink/);
  assert.equal(readdirSync(first.bundles).length, 4);
});

test('real process inventory protects an old bundle inherited by a running Desktop process', async t => {
  const { stateRoot, bundle } = fixture(t);
  const paths = Array.from({ length: 5 }, (_, i) => bundle(i));
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'], {
    env: { ...process.env, REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: paths[0] },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  t.after(() => child.kill());
  await once(child.stdout, 'data');
  const result = pruneDevelopmentBundles({ stateRoot });
  assert.deepEqual(result.removed, [paths[1]]);
  assert.ok(existsSync(paths[0]));
  child.kill();
  await once(child, 'exit');
  assert.deepEqual(pruneDevelopmentBundles({ stateRoot }).removed, [paths[0]]);
});

test('state-root aliases preserve inherited references and resolve the selected bundle', t => {
  const { stateRoot, bundle } = fixture(t);
  const paths = Array.from({ length: 6 }, (_, i) => bundle(i));
  const other = fixture(t);
  const alias = join(other.stateRoot, 'state-link');
  symlinkSync(stateRoot, alias);
  const viaAlias = path => path.replace(stateRoot, alias);
  const result = pruneDevelopmentBundles({
    stateRoot: alias, currentBundle: viaAlias(paths[0]),
    readProcesses: () => `13 electron REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT=${viaAlias(paths[1])}`,
  });
  assert.deepEqual(result.removed, [paths[2]]);
});

test('CLI refuses an incomplete or failed process inventory without leaking its output', t => {
  const { stateRoot, bundle } = fixture(t);
  const paths = Array.from({ length: 5 }, (_, i) => bundle(i));
  const bin = join(stateRoot, 'bin');
  mkdirSync(bin);
  for (const status of [0, 1]) {
    writeFileSync(join(bin, 'ps'), `#!/bin/sh\nprintf '12 electron SECRET=do-not-log\\n'\nexit ${status}\n`, { mode: 0o700 });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./prune_dev_desktop_bundles.mjs', import.meta.url)), '--state-root', stateRoot], {
      env: { ...process.env, PATH: bin }, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot inspect process arguments and environments/);
    assert.doesNotMatch(result.stdout + result.stderr, /SECRET|do-not-log/);
    paths.forEach(path => assert.ok(existsSync(path)));
  }
});
