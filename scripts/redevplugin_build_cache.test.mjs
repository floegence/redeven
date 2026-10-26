import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createHash } from 'node:crypto';

const source = readFileSync(new URL('./stage_redevplugin_release_artifacts.sh', import.meta.url), 'utf8');
const start = source.indexOf('# Only development launches opt into');
const end = source.indexOf('\nruntime_sources=()', start);
assert.ok(start >= 0 && end > start);

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-cargo-cache-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'toolchain/bin'), { recursive: true });
  const cargo = path.join(root, 'toolchain/bin/cargo');
  writeFileSync(cargo, '#!/bin/sh\nset -eu\nprintf "%s|%s|%s|%s\\n" "$CARGO_HOME" "$CARGO_TARGET_DIR" "$*" "${CARGO_NET_OFFLINE:-}" >> "$FIXTURE_CALLS"\nif [ "$1" = metadata ] && [ "${FIXTURE_MISSING:-}" = 1 ]; then echo "missing cached dependency" >&2; exit 42; fi\n', { mode: 0o755 });
  function run(profile, index, options = {}) {
    const staging = path.join(root, 'stage-' + index); mkdirSync(staging);
    const script = path.join(root, 'run.sh');
    writeFileSync(script, 'set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\n' + source.slice(start, end));
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: {
      ...process.env, profile, tmpdir: staging, REDEVEN_REDEVPLUGIN_BUILD_CACHE: path.join(root, 'persistent'),
      RUST_TOOLCHAIN: '1.88.0', rust_target: 'aarch64-apple-darwin', goos: 'darwin', version: '3.0.36',
      SCRIPT_DIR: import.meta.dirname, expected_runtime_crate_sha: createHash('sha256').update('published crate').digest('hex'), cargo_version: 'cargo 1.88.0', rustc_version: 'rustc 1.88.0',
      toolchain_root: path.join(root, 'toolchain'), toolchain_cargo: cargo, FIXTURE_CALLS: path.join(root, 'calls'),
      CARGO_TARGET_DIR: path.join(root, 'unrelated'),
      CARGO_NET_OFFLINE: '', FIXTURE_MISSING: options.missing ? '1' : '',
    } });
    if (options.failure) { assert.notEqual(result.status, 0); assert.match(result.stderr, /crate digest/); return; }
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n').at(-1).split('|');
  }
  return { root, run };
}

function seedCache(cargoHome) {
  const source = path.join(cargoHome, 'registry/src/index/redevplugin-runtime-3.0.36');
  const archive = path.join(cargoHome, 'registry/cache/index/redevplugin-runtime-3.0.36.crate');
  mkdirSync(source, { recursive: true }); mkdirSync(path.dirname(archive), { recursive: true });
  writeFileSync(path.join(source, 'Cargo.toml'), 'manifest');
  writeFileSync(archive, 'published crate');
  return archive;
}

test('complete verified development caches avoid registry requests and still install fresh', t => {
  const f = fixture(t), first = f.run('development', 1);
  seedCache(first[0]);
  const warm = f.run('development', 2);
  assert.match(warm[2], /install --locked/);
  assert.equal(warm[3], 'true');
});

test('partial caches preserve normal acquisition and corrupt crates fail before installation', t => {
  const f = fixture(t), first = f.run('development', 1);
  const archive = seedCache(first[0]);
  assert.equal(f.run('development', 2, { missing: true })[3], '');
  writeFileSync(archive, 'corrupt');
  const before = readFileSync(path.join(f.root, 'calls'), 'utf8');
  f.run('development', 3, { failure: true });
  assert.equal(readFileSync(path.join(f.root, 'calls'), 'utf8'), before);
});

test('development reuses Cargo directories and always installs the exact locked crate afresh', t => {
  const f = fixture(t), first = f.run('development', 1), second = f.run('development', 2);
  assert.equal(first[0], second[0]); assert.equal(first[1], second[1]);
  assert.match(first[0], /persistent\/1\.88\.0\/aarch64-apple-darwin\/[a-f0-9]{64}\/cargo-home$/);
  assert.match(second[2], /install --locked --root .*stage-2\/runtime-install --target aarch64-apple-darwin --version =3\.0\.36 redevplugin-runtime/);
});
test('release staging isolates Cargo despite inherited development caches', t => {
  const f = fixture(t), first = f.run('release', 1), second = f.run('release', 2);
  assert.notEqual(first[0], second[0]); assert.notEqual(first[1], second[1]);
  assert.match(second[0], /stage-2\/cargo-home$/); assert.match(second[1], /stage-2\/cargo-target$/);
});
