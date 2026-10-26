import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const common = path.join(import.meta.dirname, 'ui_package_common.sh');
function fixture(t, manager) {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'package');
  mkdirSync(dir); mkdirSync(path.join(root, 'bin'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', ...(manager === 'pnpm' ? { packageManager: 'pnpm@10.32.1' } : {}) }));
  writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  for (const executable of ['npm', 'corepack', 'pnpm']) {
    writeFileSync(path.join(root, 'bin', executable), '#!/bin/sh\nset -eu\ncase \"$*\" in *--version*) echo 10.32.1; exit 0;; esac\necho install >> "$TEST_ROOT/calls"\nmkdir -p node_modules\nprintf "{}" > node_modules/.package-lock.json\nprintf "installed" > node_modules/.modules.yaml\n', { mode: 0o755 });
  }
  function run(script) {
    const result = spawnSync('bash', ['-c', 'set -euo pipefail; source "$1"; ROOT_DIR="$2"; cd "$3"; ' + script, 'bash', common, path.resolve(import.meta.dirname, '..'), dir], {
      env: { ...process.env, PATH: root + '/bin:' + process.env.PATH, TEST_ROOT: root, REDEVEN_AGENT_FORCE_INSTALL: '' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  return { root, dir, run, calls: () => readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n').length };
}
for (const manager of ['npm', 'pnpm']) test(manager + ': unchanged dependencies install once even with both lockfiles', t => {
  const f = fixture(t, manager);
  f.run('ui_pkg_ensure_dependencies "$PWD"; ui_pkg_ensure_dependencies "$PWD"');
  assert.equal(f.calls(), 1);
  writeFileSync(path.join(f.dir, manager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml'), 'changed lock');
  f.run('ui_pkg_ensure_dependencies "$PWD"');
  assert.equal(f.calls(), 2);
  writeFileSync(path.join(f.dir, 'package.json'), '{"name":"fixture-changed"' + (manager === 'pnpm' ? ',"packageManager":"pnpm@10.32.1"' : '') + '}');
  f.run('ui_pkg_ensure_dependencies "$PWD"');
  assert.equal(f.calls(), 3);
  symlinkSync('missing', path.join(f.dir, 'node_modules', 'broken'));
  assert.match(f.run('if ui_pkg_need_install "$PWD"; then echo stale; fi'), /stale/);
});

for (const manager of ['npm', 'pnpm']) test(manager + ': a failed install preserves its status without a reusable receipt', t => {
  const f = fixture(t, manager);
  writeFileSync(path.join(f.root, 'bin', manager === 'pnpm' ? 'corepack' : 'npm'), '#!/bin/sh\ncase \"$*\" in *--version*) echo 10.32.1; exit 0;; esac\nexit 23\n');
  const result = spawnSync('bash', ['-c', 'set -e; source "$1"; ROOT_DIR="$2"; ui_pkg_ensure_dependencies "$3"', 'bash', common, path.resolve(import.meta.dirname, '..'), f.dir], { env: { ...process.env, PATH: f.root + '/bin:' + process.env.PATH } });
  assert.equal(result.status, 23);
  assert.throws(() => readFileSync(path.join(f.dir, "node_modules/.redeven-install-v1")), /ENOENT/);
});

test('force installation is explicit and missing install metadata cannot reuse the receipt', t => {
  const f = fixture(t, 'npm');
  f.run('ui_pkg_ensure_dependencies "$PWD"; REDEVEN_AGENT_FORCE_INSTALL=1 ui_pkg_ensure_dependencies "$PWD"');
  assert.equal(f.calls(), 2);
  rmSync(path.join(f.dir, 'node_modules/.package-lock.json'));
  f.run('ui_pkg_ensure_dependencies "$PWD"');
  assert.equal(f.calls(), 3);
});
