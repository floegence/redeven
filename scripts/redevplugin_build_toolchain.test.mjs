import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildToolchainSourceIdentity } from './prepare_redevplugin_build_toolchain.mjs';

const root = path.resolve(import.meta.dirname, '..');
const helper = path.join(root, 'scripts/prepare_redevplugin_build_toolchain.mjs');
function run(args, env = {}) {
  return spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 180_000 });
}
test('target and cache admission reject invalid inputs without downloading', () => {
  const result = run(['--goos', 'windows', '--goarch', 'amd64']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /toolchain:unavailable.*Unsupported Runtime target/);
  assert.doesNotMatch(result.stderr, /downloading|Compiling/);
});
test('the toolchain CLI executes through a managed checkout alias', t => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'redeven-toolchain-alias-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const alias = path.join(temporary, 'checkout');
  symlinkSync(root, alias, 'dir');
  const result = spawnSync(process.execPath, [path.join(alias, 'scripts/prepare_redevplugin_build_toolchain.mjs'), '--goos', 'windows', '--goarch', 'amd64'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /toolchain:unavailable.*Unsupported Runtime target/);
});
test('complete pinned build inputs bind the source identity', t => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'redeven-toolchain-identity-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const config = JSON.parse(readFileSync(path.join(root, 'scripts/redevplugin_build_toolchain.json')));
  mkdirSync(path.join(temporary, 'scripts'));
  for (const file of config.build_inputs) cpSync(path.join(root, 'scripts', file), path.join(temporary, 'scripts', file));
  let previous = buildToolchainSourceIdentity(temporary);
  for (const file of config.build_inputs.filter(file => file.endsWith('.sh'))) {
    writeFileSync(path.join(temporary, 'scripts', file), readFileSync(path.join(temporary, 'scripts', file), 'utf8') + '\n# identity change\n');
    const current = buildToolchainSourceIdentity(temporary);
    assert.notEqual(current, previous, file);
    previous = current;
  }
});
test('real macOS cross compilation validates C, archiving, Rust linking and static PIE for both targets', {
  skip: os.platform() !== 'darwin' || process.env.REDEVEN_TEST_REAL_CROSS_TOOLCHAIN !== '1', timeout: 360_000,
}, t => {
  const cacheRoot = process.env.REDEVEN_REDEVPLUGIN_TOOLCHAIN_CACHE;
  assert.ok(cacheRoot, 'explicit task-owned cache is required');
  for (const arch of ['amd64', 'arm64']) {
    const result = run(['--goos', 'linux', '--goarch', arch, '--cache-root', cacheRoot]);
    assert.equal(result.status, 0, result.stderr);
    const toolchain = JSON.parse(result.stdout);
    assert.match(toolchain.identity, /^[a-f0-9]{64}$/);
    assert.ok(toolchain.env[`CC_${toolchain.rust_target.replaceAll('-', '_')}`]);
    assert.ok(toolchain.env[`AR_${toolchain.rust_target.replaceAll('-', '_')}`]);
    assert.match(result.stderr, /archive and link probe ready/);
  }
  assert.deepEqual(readdirSync(cacheRoot).filter(name => name.startsWith('.probe-') || name.startsWith('.zig-download-') || name.startsWith('.zig-extract-')), []);
});

test('real offline and download failures remain distinct and clean their temporary directories', {
  skip: os.platform() !== 'darwin' || process.env.REDEVEN_TEST_REAL_CROSS_TOOLCHAIN !== '1', timeout: 180_000,
}, t => {
  const cacheRoot = mkdtempSync(path.join(os.tmpdir(), 'redeven-toolchain-failure-'));
  t.after(() => rmSync(cacheRoot, { recursive: true, force: true }));
  const args = ['--goos', 'linux', '--goarch', 'amd64', '--cache-root', cacheRoot];
  const offline = run([...args, '--offline', '1']);
  assert.equal(offline.status, 1);
  assert.match(offline.stderr, /toolchain:cache_miss/);
  const network = run(args, { HTTPS_PROXY: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1', NO_PROXY: '', no_proxy: '' });
  assert.equal(network.status, 1);
  assert.match(network.stderr, /toolchain:download_failed/);
  assert.deepEqual(readdirSync(cacheRoot), []);
  const missing = run(args, { PATH: '/usr/bin:/bin', REDEVEN_RUSTUP_OFFLINE: '1' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /toolchain:rust_unavailable/);
  assert.match(missing.stderr, /rustup is required/);
});
