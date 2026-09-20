import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const environment = { ...process.env };
for (const key of execFileSync('git', ['rev-parse', '--local-env-vars'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n')) {
  delete environment[key];
}
const lockPath = 'internal/envapp/ui_src/package-lock.json';

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-notice-hook-test-'));
  const root = path.join(temporary, 'repo with spaces');
  const log = path.join(temporary, 'generator.json');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const env = { ...environment, REDEVEN_NOTICE_TEST_LOG: log };
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), value);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Notice Hook Test');
  git('config', 'user.email', 'notice-hook@invalid.example');
  write('.githooks/pre-commit', fs.readFileSync(path.join(sourceRoot, '.githooks/pre-commit')));
  fs.chmodSync(path.join(root, '.githooks/pre-commit'), 0o755);
  const checker = path.join(sourceRoot, 'scripts/check_staged_third_party_notices.mjs');
  if (fs.existsSync(checker)) write('scripts/check_staged_third_party_notices.mjs', fs.readFileSync(checker));
  write('scripts/check_readme_localizations.mjs', '');
  write('scripts/open_source_hygiene_check.sh', '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(root, 'scripts/open_source_hygiene_check.sh'), 0o755);
  write('scripts/generate_third_party_notices.mjs', `
import fs from 'node:fs';
import assert from 'node:assert/strict';
assert.deepEqual(process.argv.slice(2), ['--check']);
for (const [key, value] of Object.entries({ GOWORK: 'off', GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local', GOVCS: '*:off', GOFLAGS: '' })) {
  assert.equal(process.env[key], value, key);
}
assert.equal(process.env.GIT_INDEX_FILE, undefined);
fs.readFileSync('go.sum');
assert.equal(fs.readFileSync('internal/envapp/ui_src/node_modules/license-evidence', 'utf8'), 'installed');
fs.writeFileSync(process.env.REDEVEN_NOTICE_TEST_LOG, JSON.stringify({ snapshot: process.cwd() }));
assert.equal(fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8'), fs.readFileSync('${lockPath}', 'utf8'), 'notices are stale');
`);
  write(lockPath, 'v1\n');
  write('THIRD_PARTY_NOTICES.md', 'v1\n');
  write('go.sum', 'baseline\n');
  git('add', '.');
  git('commit', '-q', '-m', 'fixture baseline');
  git('config', 'core.hooksPath', '.githooks');
  write('internal/envapp/ui_src/node_modules/license-evidence', 'installed');
  const run = () => spawnSync('bash', ['.githooks/pre-commit'], { cwd: root, env: { ...env, GIT_INDEX_FILE: path.join(root, '.git/index') }, encoding: 'utf8' });
  return { root, log, git, write, run };
}

function success(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function rejected(result) {
  assert.notEqual(result.status, 0, 'The hook must reject inconsistent staged notices');
  assert.match(result.stdout + result.stderr, /generate_third_party_notices\.mjs/);
}

test('unrelated commits do not require installed dependencies or invoke the generator', (t) => {
  const f = fixture(t);
  fs.rmSync(path.join(f.root, 'internal/envapp/ui_src/node_modules'), { recursive: true });
  f.write('feature.txt', 'an unrelated change\n');
  f.git('add', 'feature.txt');
  success(f.run());
  assert.equal(fs.existsSync(f.log), false);
});

test('dependency changes with an unstaged notice update are rejected until both are staged', (t) => {
  const f = fixture(t);
  f.write(lockPath, 'v2\n');
  f.git('add', lockPath);
  rejected(f.run());
  const failedSnapshot = JSON.parse(fs.readFileSync(f.log)).snapshot;
  assert.equal(fs.existsSync(failedSnapshot), false, 'Failure removes the temporary snapshot');
  f.write('THIRD_PARTY_NOTICES.md', 'v2\n');
  rejected(f.run());
  f.git('add', 'THIRD_PARTY_NOTICES.md');
  const index = f.git('write-tree');
  success(f.run());
  assert.equal(f.git('write-tree'), index, 'The check must not stage or rewrite files');
  assert.equal(fs.existsSync(JSON.parse(fs.readFileSync(f.log)).snapshot), false);
});

test('checks staged content and generator even when working files contain later edits', (t) => {
  const f = fixture(t);
  f.write(lockPath, 'v2\n');
  f.write('THIRD_PARTY_NOTICES.md', 'v2\n');
  f.git('add', lockPath, 'THIRD_PARTY_NOTICES.md');
  f.write(lockPath, 'unstaged v3\n');
  f.write('THIRD_PARTY_NOTICES.md', 'unstaged draft\n');
  f.write('scripts/generate_third_party_notices.mjs', 'throw new Error("unstaged generator must not run");');
  const before = f.git('diff');
  success(f.run());
  assert.equal(f.git('diff'), before, 'Unstaged edits remain untouched');
});

test('notice-only changes are checked and a real commit is blocked', (t) => {
  const f = fixture(t);
  f.write('THIRD_PARTY_NOTICES.md', 'incorrect\n');
  f.git('add', 'THIRD_PARTY_NOTICES.md');
  const head = f.git('rev-parse', 'HEAD');
  assert.throws(() => f.git('commit', '-m', 'must not commit stale notices'));
  assert.equal(f.git('rev-parse', 'HEAD'), head);
});

test('missing installed metadata fails with preparation guidance instead of installing', (t) => {
  const f = fixture(t);
  f.write(lockPath, 'v2\n');
  f.git('add', lockPath);
  fs.rmSync(path.join(f.root, 'internal/envapp/ui_src/node_modules'), { recursive: true });
  const result = f.run();
  rejected(result);
  assert.match(result.stderr, /installed|install/);
  assert.match(result.stderr, /git add/);
  assert.equal(fs.existsSync(path.join(f.root, 'internal/envapp/ui_src/node_modules')), false);
});

test('deleted and renamed inputs and generator changes cannot skip verification', (t) => {
  for (const target of ['go.sum', lockPath, 'scripts/generate_third_party_notices.mjs']) {
    const f = fixture(t);
    f.git('rm', target);
    rejected(f.run());
  }
  const f = fixture(t);
  f.git('mv', lockPath, `${lockPath}.retired`);
  rejected(f.run());
});

test('dependency and bundled-license inputs all trigger the existing generator', (t) => {
  const f = fixture(t);
  for (const name of [
    'go.mod',
    'desktop/pnpm-lock.yaml',
    'internal/codeapp/ui_src/package-lock.json',
    'internal/envapp/ui_src/package.json',
    'assets/licenses/component-MIT.txt',
    'assets/terminal_agent_icons.json',
    'assets/container_service_icons.json',
    'internal/envapp/ui_src/public/agent-cli-icons/fixture.svg',
    'internal/envapp/ui_src/public/container-service-icons/fixture.svg',
    'scripts/model-catalog/models-dev.LICENSE',
    'scripts/javascript_lock_inventory.mjs',
    'scripts/terminal_agent_icon_integrity.mjs',
  ]) {
    fs.rmSync(f.log, { force: true });
    f.write(name, 'changed fixture input\n');
    f.git('add', name);
    success(f.run());
    assert.ok(fs.existsSync(f.log), `The generator must run for ${name}`);
    f.git('reset', '-q', 'HEAD', '--', name);
  }
});

test('initial commits check the staged tree without requiring an existing HEAD', (t) => {
  const f = fixture(t);
  f.git('update-ref', '-d', 'refs/heads/main');
  success(f.run());
  assert.ok(fs.existsSync(f.log));
});
