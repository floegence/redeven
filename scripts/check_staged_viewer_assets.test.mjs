import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const checker = 'scripts/check_staged_viewer_assets.mjs';
const generator = 'internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs';
const catalogSource = 'internal/envapp/ui_src/src/ui/i18n/locales/en-US.ts';
const catalogOutput = 'internal/codeapp/appserver/remote_desktop_viewer/catalog.generated.js';
const dependencies = 'internal/envapp/ui_src/node_modules';
const environment = { ...process.env };
for (const key of execFileSync('git', ['rev-parse', '--local-env-vars'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n')) {
  delete environment[key];
}

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-viewer-hook-test-'));
  const root = path.join(temporary, 'repo with spaces');
  const log = path.join(temporary, 'generator.json');
  const env = { ...environment, REDEVEN_VIEWER_TEST_LOG: log };
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), value);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Viewer Hook Test');
  git('config', 'user.email', 'viewer-hook@invalid.example');
  git('config', 'core.hooksPath', '/dev/null');
  write('.githooks/pre-commit', fs.readFileSync(path.join(sourceRoot, 'scripts/local_gate_commit_checks.sh')));
  write('scripts/desktop_test_session_policy.test.mjs', '');
  write(checker, fs.readFileSync(path.join(sourceRoot, checker)));
  for (const script of ['check_staged_third_party_notices.mjs', 'check_readme_localizations.mjs']) write(`scripts/${script}`, '');
  write('scripts/open_source_hygiene_check.sh', '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(root, 'scripts/open_source_hygiene_check.sh'), 0o755);
  fs.chmodSync(path.join(root, '.githooks/pre-commit'), 0o755);
  write(generator, `
import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.deepEqual(process.argv.slice(2), ['--check']);
assert.equal(process.env.GIT_INDEX_FILE, undefined);
assert.equal(fs.readFileSync('${dependencies}/installed', 'utf8'), 'locked');
fs.writeFileSync(process.env.REDEVEN_VIEWER_TEST_LOG, JSON.stringify({ snapshot: process.cwd() }));
assert.equal(fs.readFileSync('${catalogOutput}', 'utf8'), fs.readFileSync('${catalogSource}', 'utf8'), 'Desktop catalog is stale');
`);
  write(catalogSource, 'v1\n');
  write(catalogOutput, 'v1\n');
  git('add', '.');
  git('commit', '-q', '-m', 'test(repo): initialize fixture');
  git('config', 'core.hooksPath', '.githooks');
  write(`${dependencies}/installed`, 'locked');
  const run = () => spawnSync('bash', ['.githooks/pre-commit'], { cwd: root, env: { ...env, GIT_INDEX_FILE: path.join(root, '.git/index') }, encoding: 'utf8' });
  return { root, log, git, write, run };
}

function success(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function rejected(result) {
  assert.notEqual(result.status, 0, 'The hook must reject stale staged viewer assets');
  assert.match(result.stderr, /node internal\/envapp\/ui_src\/scripts\/buildHostApplicationAppearance\.mjs/);
  assert.match(result.stderr, /git add/);
}

test('unrelated commits skip viewer checks without requiring dependencies', (t) => {
  const f = fixture(t);
  fs.rmSync(path.join(f.root, dependencies), { recursive: true });
  f.write('feature.go', 'package feature\n');
  f.git('add', 'feature.go');
  success(f.run());
  assert.equal(fs.existsSync(f.log), false);
});

test('stale staged catalogs block commits even with a corrected working output', (t) => {
  const f = fixture(t);
  f.write(catalogSource, 'v2\n');
  f.git('add', catalogSource);
  f.write(catalogOutput, 'v2\n');
  const index = f.git('write-tree');
  rejected(f.run());
  assert.equal(f.git('write-tree'), index);
  assert.equal(fs.existsSync(JSON.parse(fs.readFileSync(f.log)).snapshot), false);
  const head = f.git('rev-parse', 'HEAD');
  assert.throws(() => f.git('commit', '-m', 'fix(build): reject stale assets'));
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  f.git('add', catalogOutput);
  success(f.run());
  assert.equal(fs.existsSync(JSON.parse(fs.readFileSync(f.log)).snapshot), false);
});

test('checks staged inputs without changing later working edits', (t) => {
  const f = fixture(t);
  f.write(catalogSource, 'v2\n');
  f.write(catalogOutput, 'v2\n');
  f.git('add', catalogSource, catalogOutput);
  f.write(catalogOutput, 'unstaged stale output\n');
  f.write(generator, 'throw Error();');
  const index = f.git('write-tree');
  const working = f.git('diff');
  success(f.run());
  assert.equal(f.git('write-tree'), index);
  assert.equal(f.git('diff'), working);
});

test('missing dependencies fail with preparation guidance without installing', (t) => {
  const f = fixture(t);
  f.write(catalogOutput, 'stale\n');
  f.git('add', catalogOutput);
  fs.rmSync(path.join(f.root, dependencies), { recursive: true });
  const result = f.run();
  rejected(result);
  assert.match(result.stderr, /pnpm install --frozen-lockfile/);
  assert.equal(fs.existsSync(f.log), false);
  assert.equal(fs.existsSync(path.join(f.root, dependencies)), false);
});

test('all generator input and output families trigger verification', (t) => {
  const f = fixture(t);
  for (const name of [
    'internal/envapp/ui_src/src/ui/i18n/locales/catalogs/zh-CN.json',
    'internal/envapp/ui_src/src/ui/i18n/localeMeta.ts',
    'internal/envapp/ui_src/src/ui/services/hostApplicationPresentation.ts',
    'internal/envapp/ui_src/package.json',
    'internal/envapp/ui_src/pnpm-lock.yaml',
    'internal/flower_ui/src/i18n/flowerSurfaceMessages.ts',
    'desktop/src/shared/floeStandaloneStyles.generated.ts',
    'internal/codeapp/appserver/host_application_viewer/remote-input.generated.css',
    'internal/codeapp/appserver/host_application_viewer/viewport.generated.js',
    'internal/codeapp/appserver/remote_desktop_viewer/icons.generated.js',
    generator,
  ]) {
    fs.rmSync(f.log, { force: true });
    const original = fs.existsSync(path.join(f.root, name)) ? fs.readFileSync(path.join(f.root, name), 'utf8') : '';
    f.write(name, original + '\n// changed input\n');
    f.git('add', name);
    success(f.run());
    assert.ok(fs.existsSync(f.log), `Verification must run for ${name}`);
    f.git('reset', '-q', 'HEAD', '--', name);
  }
});

test('deleted and renamed catalog inputs cannot bypass verification', (t) => {
  for (const name of [catalogSource, catalogOutput, generator]) {
    const f = fixture(t);
    f.git('rm', name);
    rejected(f.run());
  }
  const f = fixture(t);
  f.git('mv', catalogSource, `${catalogSource}.retired`);
  rejected(f.run());
});

test('initial commits verify the index without requiring HEAD', (t) => {
  const f = fixture(t);
  f.git('update-ref', '-d', 'refs/heads/main');
  success(f.run());
  assert.ok(fs.existsSync(f.log));
});
