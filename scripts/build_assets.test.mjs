import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function fixture(t, profile, failure = '') {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-assets-order-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'events'), '');
  for (const dir of ['scripts', 'bin', 'desktop', 'internal/envapp/ui_src', 'internal/codeapp/ui_src']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  for (const name of ['build_assets.sh', 'run_parallel_builds.mjs']) {
    copyFileSync(new URL(name, import.meta.url), path.join(root, 'scripts', name));
  }
  writeFileSync(path.join(root, 'internal/envapp/ui_src/package.json'), '{}');
  writeFileSync(path.join(root, 'scripts/ui_package_common.sh'), `
ui_pkg_log() { printf '%s\n' "$*"; }
ui_pkg_die() { printf '%s\n' "$*" >&2; exit 1; }
ui_pkg_ensure_dependencies() { node "$ROOT_DIR/scripts/task.mjs" install "$1"; }
ui_pkg_run_pnpm() { node "$ROOT_DIR/scripts/task.mjs" build Env-App; }
`);
  writeFileSync(path.join(root, 'bin/npm'), '#!/bin/sh\nexec node "$TEST_ROOT/scripts/task.mjs" build Code-App\n', { mode: 0o755 });
  writeFileSync(path.join(root, 'scripts/build_okf_bundle.sh'), '#!/usr/bin/env node\nimport("./task.mjs");\n', { mode: 0o755 });
  writeFileSync(path.join(root, 'scripts/task.mjs'), String.raw`
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = process.env.TEST_ROOT;
const [action = 'knowledge', target] = process.argv.slice(2);
const label = action === 'install'
  ? (target.endsWith('/desktop') ? 'Desktop' : target.includes('/envapp/') ? 'Env-App' : 'Code-App')
  : target ?? 'Knowledge';
function record(event) { appendFileSync(path.join(root, 'events'), event + '\n'); }
record(action + ':' + label + ':started');
if (action === 'knowledge') {
  // Hold cold installs until the Knowledge task exits. This deterministically
  // exposes a verifier incorrectly nested inside that parallel task.
  writeFileSync(path.join(root, 'knowledge-pid'), String(process.ppid));
}
if (action === 'install' && label !== 'Desktop' && process.env.REDEVEN_ASSET_BUILD_PROFILE === 'development') {
  const deadline = Date.now() + 5000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('Knowledge task did not finish');
    const pidFile = path.join(root, 'knowledge-pid');
    if (existsSync(pidFile)) {
      try { process.kill(Number(readFileSync(pidFile, 'utf8')), 0); }
      catch (error) { if (error.code === 'ESRCH') break; throw error; }
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
if (process.env.TEST_FAILURE === action + ':' + label) {
  console.error('fixture failure: ' + process.env.TEST_FAILURE);
  process.exit(23);
}
if (action === 'install' && label === 'Env-App') {
  const moduleRoot = path.join(target, 'node_modules/js-yaml');
  mkdirSync(moduleRoot, { recursive: true });
  writeFileSync(path.join(moduleRoot, 'index.js'), 'exports.load = () => ({});');
}
record(action + ':' + label + ':finished');
`);
  writeFileSync(path.join(root, 'scripts/generate_third_party_notices.mjs'), String.raw`
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const root = process.env.TEST_ROOT;
appendFileSync(root + '/events', 'notices:started\n');
const require = createRequire(root + '/internal/envapp/ui_src/package.json');
require('js-yaml');
const events = readFileSync(root + '/events', 'utf8');
for (const event of ['install:Desktop', 'install:Env-App', 'install:Code-App', 'build:Env-App', 'build:Code-App', 'knowledge:Knowledge']) {
  assert.ok(events.includes(event + ':finished'), event + ' must finish before verification');
}
assert.deepEqual(process.argv.slice(2), ['--check']);
if (process.env.TEST_FAILURE === 'notices') process.exit(29);
appendFileSync(root + '/events', 'notices:finished\n');
`);
  const result = spawnSync('bash', [path.join(root, 'scripts/build_assets.sh')], {
    env: { ...process.env, PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH,
      TEST_ROOT: root, TEST_FAILURE: failure, REDEVEN_ASSET_BUILD_PROFILE: profile },
    encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  return { ...result, events: readFileSync(path.join(root, 'events'), 'utf8').trim().split('\n') };
}

for (const profile of ['development', 'release']) {
  test(profile + ': cold asset builds verify notices after all package tasks finish', t => {
    const result = fixture(t, profile);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.events.filter(event => event === 'notices:finished').length, 1);
    for (const label of ['Desktop', 'Env-App', 'Code-App']) {
      assert.equal(result.events.filter(event => event === 'install:' + label + ':started').length, 1);
    }
    assert.match(result.stdout, /All embedded assets built/u);
  });

  for (const failure of ['install:Env-App', 'build:Code-App', 'knowledge:Knowledge', 'notices']) {
    test(profile + ': preserves ' + failure + ' failure without reporting success', t => {
      const result = fixture(t, profile, failure);
      assert.equal(result.status, failure === 'notices' ? 29 : 23, result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout, /All embedded assets built/u);
      if (failure !== 'notices') assert.ok(!result.events.includes('notices:started'));
    });
  }
}
