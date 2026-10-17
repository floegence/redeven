import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const folders = ['desktop/scripts', 'internal/envapp/ui_src/scripts', 'scripts'];
test('maintained Electron launch entries use the supervised lifecycle', async () => {
  let entries = 0;
  for (const folder of folders)
    for (const name of await readdir(path.join(root, folder))) {
      if (!name.endsWith('.mjs') || name.endsWith('.test.mjs') || name === 'desktop_test_session.mjs') continue;
      const file = path.join(folder, name);
      const source = await readFile(path.join(root, file), 'utf8');
      const launchesElectron =
        /(?:from\s+['"]electron['"]|(?:require|requireDesktop|desktopRequire)\(['"]electron['"]\)|\b_electron\b|_electron\s*:|session\.launchElectron\s*\()/u.test(
          source,
        );
      if (!launchesElectron) continue;
      entries++;
      assert.ok(source.includes('createDesktopTestSession'), file);
      assert.ok(source.includes('await session.run('), file);
      assert.ok(!source.includes('_electron.launch('), file);
      assert.ok(!source.includes('spawn(electron,') || source.includes('session.spawn(electron,'), file);
      assert.ok(!source.includes('process.kill(-'), file);
      assert.ok(!source.includes('dialog.showMessageBox = async () => ({ response: 0'), file);
      assert.ok(!/(?<!session\.)\bspawn\s*\(/u.test(source), `${file}: spawn must have a session owner`);
      assert.ok(!/\b(?:chromium|browserType)\.launch\s*\(/u.test(source), `${file}: browser launches must have the same session owner`);
      assert.ok(!source.includes('connectOverCDP('), `${file}: use the existing Electron context`);
    }
  assert.ok(entries >= 25, `Expected the maintained launch inventory, found ${entries}`);
});

test('default Desktop checks and ordinary gates cannot enable full qualification', async () => {
  const desktop = await readFile(path.join(root, 'scripts/check_desktop.sh'), 'utf8');
  assert.ok(desktop.includes('local mode="ci"'));
  assert.ok(desktop.includes('--full)'));
  for (const file of [
    '.githooks/pre-commit',
    '.githooks/pre-push',
    'scripts/local_gate_commit_checks.sh',
    'scripts/check_final_integration.sh',
    'scripts/check_quick_ci.sh',
    'scripts/local_gate_groups.json',
    '.github/workflows/ci-check.yml',
  ]) {
    const source = await readFile(path.join(root, file), 'utf8');
    assert.ok(!source.includes('check_desktop.sh --full'), file);
    assert.ok(!source.includes('check-service-canvas-window.mjs'), file);
    assert.ok(!source.includes('test:interaction-continuity:browser'), file);
  }
});
