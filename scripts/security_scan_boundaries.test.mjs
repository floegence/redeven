import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureSourceBuildIdentity } from './source_build_identity.mjs';
import { renderBootstrap, renderFromBuild } from './render_installer_bootstrap.mjs';

test('source identity rejects a regular input replaced by a symlink before opening', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-source-race-'));
  const originalLstat = fs.lstatSync;
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    assert.equal(spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root }).status, 0);
    const file = path.join(root, 'source.ts');
    const replacement = path.join(root, '.git', 'replacement');
    fs.writeFileSync(file, 'reviewed source');
    fs.writeFileSync(replacement, 'unreviewed source');
    t.mock.method(fs, 'lstatSync', (name, ...args) => {
      const info = originalLstat(name, ...args);
      if (name === file) {
        fs.unlinkSync(file);
        fs.symlinkSync(replacement, file);
      }
      return info;
    });
    syncBuiltinESMExports();
    assert.throws(() => captureSourceBuildIdentity(root), /ELOOP|changed|symbolic link/iu);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer pins use the verified descriptor even if its pathname is replaced', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-installer-race-'));
  const originalLstat = fs.lstatSync;
  const originalFstat = fs.fstatSync;
  try {
    const platforms = ['darwin_amd64', 'darwin_arm64', 'linux_amd64', 'linux_arm64'];
    const reviewed = 'reviewed installer';
    for (const platform of platforms) fs.writeFileSync(path.join(root, `redeven-installer_${platform}`), reviewed);
    const file = path.join(root, 'redeven-installer_darwin_amd64');
    const replacement = path.join(root, 'replacement');
    fs.writeFileSync(replacement, 'unreviewed installer');
    let replaced = false;
    const replace = () => {
      if (replaced) return;
      replaced = true;
      fs.unlinkSync(file);
      fs.symlinkSync(replacement, file);
    };
    t.mock.method(fs, 'lstatSync', (name, ...args) => {
      const info = originalLstat(name, ...args);
      if (name === file) replace();
      return info;
    });
    t.mock.method(fs, 'fstatSync', (fd, ...args) => {
      const info = originalFstat(fd, ...args);
      replace();
      return info;
    });
    syncBuiltinESMExports();
    const digest = createHash('sha256').update(reviewed).digest('hex');
    assert.equal(renderFromBuild(root, 'v0.13.13'), renderBootstrap('v0.13.13', Object.fromEntries(platforms.map(platform => [platform, digest]))));
    assert.ok(replaced, 'the pathname replacement must actually run');
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
