import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const integrate = new URL('./integrate_service_template_update.sh', import.meta.url).pathname;
const hook = fs.readFileSync(new URL('../.githooks/pre-push', import.meta.url));
const installer = fs.readFileSync(new URL('./install_git_hooks.sh', import.meta.url));

for (const scenario of ['success', 'main-race', 'gate-failure', 'push-race']) {
  test(`publication enforces the exact-main contract: ${scenario}`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-publication-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const remote = path.join(root, 'remote.git');
    const main = path.join(root, 'main');
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(root, 'init', '--bare', '--initial-branch=main', remote);
    git(root, 'clone', remote, main);
    git(main, 'config', 'user.name', 'Test');
    git(main, 'config', 'user.email', 'test@example.invalid');
    git(main, 'config', 'core.hooksPath', path.join(root, 'disabled'));
    fs.mkdirSync(path.join(main, '.githooks'));
    fs.mkdirSync(path.join(main, 'scripts'));
    fs.writeFileSync(path.join(main, '.githooks/pre-push'), hook, { mode: 0o755 });
    fs.writeFileSync(path.join(main, 'scripts/install_git_hooks.sh'), installer, { mode: 0o755 });
    fs.writeFileSync(path.join(main, 'scripts/check_final_integration.sh'), `#!/bin/bash
set -euo pipefail
test "$(git symbolic-ref HEAD)" = refs/heads/main
test "$1" = --base
test "$3" = --tip
test "$4" = "$(git rev-parse main)"
test -z "$(git status --porcelain)"
echo "$2 $4" >> "$TEST_GATE_LOG"
if [ "$TEST_SCENARIO" = gate-failure ]; then exit 1; fi
if [ "$TEST_SCENARIO" = push-race ]; then git --git-dir="$TEST_REMOTE" update-ref refs/heads/main "$TEST_COMPETITOR"; fi
`, { mode: 0o755 });
    fs.writeFileSync(path.join(main, 'go.mod'), 'module example\n');
    git(main, 'add', '.');
    git(main, 'commit', '-m', 'test(repo): baseline');
    git(main, 'push', 'origin', 'main');
    const base = git(main, 'rev-parse', 'HEAD');
    const feature = path.join(root, 'feature');
    git(main, 'worktree', 'add', '-b', 'codex/automation/catalog-test', feature, base);
    fs.writeFileSync(path.join(feature, 'go.mod'), 'module example\n\ngo 1.27.0\n');
    git(feature, 'add', 'go.mod');
    git(feature, 'commit', '-m', 'chore(deps): update');
    const tip = git(feature, 'rev-parse', 'HEAD');
    const competitor = git(main, 'commit-tree', base + '^{tree}', '-p', base, '-m', 'fix(repo): competitor');
    git(main, 'push', 'origin', competitor + ':refs/heads/competitor');
    if (scenario === 'main-race') git(root, '--git-dir=' + remote, 'update-ref', 'refs/heads/main', competitor);
    const log = path.join(root, 'gate.log');
    const result = spawnSync('bash', [integrate, base, 'codex/automation/catalog-test'], {
      cwd: main, encoding: 'utf8', env: { ...process.env, TEST_GATE_LOG: log, TEST_SCENARIO: scenario, TEST_REMOTE: remote, TEST_COMPETITOR: competitor },
    });
    const remoteTip = git(root, '--git-dir=' + remote, 'rev-parse', 'main');
    if (scenario === 'success') {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(remoteTip, tip);
      assert.equal(git(main, 'rev-parse', 'origin/main'), tip);
    } else {
      assert.notEqual(result.status, 0);
      assert.equal(remoteTip, scenario === 'gate-failure' ? base : competitor);
    }
    if (scenario === 'main-race') {
      assert.equal(fs.existsSync(log), false);
      assert.equal(git(main, 'rev-parse', 'main'), base);
    } else {
      assert.equal(fs.readFileSync(log, 'utf8'), `${base} ${tip}\n`);
    }
    assert.equal(git(main, 'ls-remote', '--tags', 'origin'), '');
  });
}
