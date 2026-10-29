import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, symlinkSync, chmodSync, openSync, fstatSync, futimesSync, writeSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { treeDigest, lookupBuild, recordBuild, buildInputKey, dependencyDigests } from './dev_desktop_build_cache.mjs';
import { captureSourceBuildIdentity } from './source_build_identity.mjs';

function fixture(t) {
  const base = mkdtempSync(path.join(tmpdir(), 'redeven-build-cache-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'source'), state = path.join(base, 'state');
  mkdirSync(path.join(root, 'desktop/dist'), { recursive: true });
  writeFileSync(path.join(root, '.gitignore'), 'desktop/dist/\n');
  writeFileSync(path.join(root, 'input.ts'), 'original');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'fixture');
  const manifest = '{"schema_version":5}';
  const bundle = path.join(state, 'desktop/bundles', createHash('sha256').update(manifest).digest('hex'));
  mkdirSync(bundle, { recursive: true });
  writeFileSync(path.join(bundle, 'desktop-bundle-manifest.json'), manifest);
  writeFileSync(path.join(bundle, 'redeven'), 'runtime', { mode: 0o755 });
  writeFileSync(path.join(root, 'desktop/dist/main.js'), 'desktop');
  const context = () => ({ schema: 1, source: captureSourceBuildIdentity(root), tools: { version: 1 }, dependencies: ['dependency-hash'] });
  return { root, state, bundle, context, git };
}

test('unchanged dirty sources reuse a verified snapshot; added, deleted and committed sources invalidate it', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, 'input.ts'), 'dirty source');
  const context = f.context();
  recordBuild(f.root, f.state, context, f.bundle);
  assert.equal(lookupBuild(f.root, f.state, f.context()).bundle, f.bundle);
  writeFileSync(path.join(f.root, 'new.ts'), 'new file');
  assert.ok(lookupBuild(f.root, f.state, f.context()).reason);
  rmSync(path.join(f.root, 'new.ts'));
  rmSync(path.join(f.root, 'input.ts'));
  assert.ok(lookupBuild(f.root, f.state, f.context()).reason);
  writeFileSync(path.join(f.root, 'input.ts'), 'dirty source');
  f.git('add', '.'); f.git('commit', '-qm', 'new commit');
  assert.ok(lookupBuild(f.root, f.state, f.context()).reason);
});

for (const target of ['desktop', 'runtime', 'mode', 'extra', 'missing', 'symlink', 'manifest', 'receipt']) test('rejects damaged cached ' + target, t => {
  const f = fixture(t), context = f.context();
  recordBuild(f.root, f.state, context, f.bundle);
  const desktop = path.join(f.root, 'desktop/dist/main.js');
  const runtime = path.join(f.bundle, 'redeven');
  if (target === 'desktop') writeFileSync(desktop, 'corrupt');
  if (target === 'runtime') writeFileSync(runtime, 'corrupt');
  if (target === 'mode') chmodSync(runtime, 0o644);
  if (target === 'extra') writeFileSync(path.join(f.bundle, 'extra'), 'extra');
  if (target === 'missing') rmSync(runtime);
  if (target === 'symlink') { renameSync(runtime, runtime + '.original'); symlinkSync(runtime + '.original', runtime); }
  if (target === 'manifest') writeFileSync(path.join(f.bundle, 'desktop-bundle-manifest.json'), '{}');
  if (target === 'receipt') writeFileSync(path.join(f.state, 'desktop/dev-build-v1.json'), '{broken');
  assert.ok(lookupBuild(f.root, f.state, context).reason);
});

test('toolchain and dependency changes miss; drift during lookup or publication fails closed', t => {
  const f = fixture(t), context = f.context();
  recordBuild(f.root, f.state, context, f.bundle);
  assert.ok(lookupBuild(f.root, f.state, { ...context, tools: { version: 2 } }).reason);
  assert.ok(lookupBuild(f.root, f.state, { ...context, dependencies: ['new hash'] }).reason);
  writeFileSync(path.join(f.root, 'input.ts'), 'concurrent edit');
  assert.throws(() => lookupBuild(f.root, f.state, context), /Source changed/);
  assert.throws(() => recordBuild(f.root, f.state, context, f.bundle), /Source changed/);
});

test('dependency digest checks bytes even when mtimes are restored and rejects external symlinks', t => {
  const f = fixture(t), root = path.join(f.root, 'desktop/dist');
  const file = path.join(root, 'main.js');
  const before = treeDigest(root, { dependencies: true });
  replaceBytesPreservingTimes(file, 'changed');
  assert.notEqual(treeDigest(root, { dependencies: true }), before);
  symlinkSync(path.join(f.root, 'input.ts'), path.join(root, 'external'));
  assert.throws(() => treeDigest(root, { dependencies: true }), /leaves its package/);
});

test('first toolchain preparation is allowed but installed compiler changes are rejected', async () => {
  const { verifyBuildContexts } = await import('./dev_desktop_build_cache.mjs');
  const before = { source: 'original', tools: { rust: { cargo: null, rustc: null } } };
  const after = { source: 'original', tools: { rust: { cargo: ['cargo', 'hash'], rustc: ['rustc', 'hash'] } } };
  assert.doesNotThrow(() => verifyBuildContexts(before, after));
  assert.throws(() => verifyBuildContexts(before, { ...after, source: 'changed' }), /Build inputs changed/);
  assert.throws(() => verifyBuildContexts(after, { ...after, tools: { rust: { cargo: ['changed'], rustc: ['rustc', 'hash'] } } }), /Build inputs changed/);
});

test('Gateway cache key binds dirty source, dependencies and compression profile', t => {
  const f = fixture(t), context = f.context();
  const key = buildInputKey(context);
  assert.equal(buildInputKey(f.context()), key);
  writeFileSync(path.join(f.root, 'input.ts'), 'latest uncommitted code');
  assert.notEqual(buildInputKey(f.context()), key);
  assert.notEqual(buildInputKey({ ...context, dependencies: ['changed'] }), key);
  assert.notEqual(buildInputKey({ ...context, environment: { REDEVEN_ASSET_BUILD_PROFILE: 'development' } }), key);
});

test('parallel dependency verification matches serial bytes and rejects a broken package', async t => {
  const f = fixture(t);
  const packages = ['desktop', 'internal/envapp/ui_src', 'internal/codeapp/ui_src'];
  for (const directory of packages) {
    const modules = path.join(f.root, directory, 'node_modules');
    mkdirSync(modules, { recursive: true });
    writeFileSync(path.join(modules, 'input'), directory);
  }
  const expected = packages.map(directory => [directory, treeDigest(path.join(f.root, directory, 'node_modules'), { dependencies: true })]);
  assert.deepEqual(await dependencyDigests(f.root), expected);
  const file = path.join(f.root, packages[1], 'node_modules/input');
  replaceBytesPreservingTimes(file, 'changed bytes');
  assert.notDeepEqual(await dependencyDigests(f.root), expected);
  symlinkSync(path.join(f.root, 'input.ts'), path.join(f.root, packages[2], 'node_modules/external'));
  await assert.rejects(dependencyDigests(f.root), /leaves its package/);
});


test('build digest rejects a file swapped to a symlink before opening', t => {
  const f = fixture(t), file = path.join(f.root, 'desktop/dist/main.js');
  const original = fs.openSync;
  t.mock.method(fs, 'openSync', (name, ...args) => {
    if (name === file) {
      fs.unlinkSync(file);
      fs.symlinkSync(path.join(f.root, 'input.ts'), file);
    }
    return original(name, ...args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => treeDigest(path.dirname(file)), /ELOOP|changed|symbolic link/iu);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

function replaceBytesPreservingTimes(file, value) {
  const fd = openSync(file, 'r+');
  try {
    const stat = fstatSync(fd);
    writeSync(fd, value, 0, 'utf8');
    futimesSync(fd, stat.atime, stat.mtime);
  } finally { closeSync(fd); }
}
