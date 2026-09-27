import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

for (const [message, reason] of [
  ['No usable sandbox! private launch arguments', 'browser_sandbox_unavailable'],
  ['Failed to move to new namespace: Operation not permitted', 'browser_sandbox_unavailable'],
  ['error while loading shared libraries: libfixture.so', 'browser_dependency_missing'],
  ['Host system is missing dependencies', 'browser_dependency_missing'],
  ['unexpected error with private profile details', 'browser_launch_failed'],
]) test(`classifies ${reason} without exposing raw launch diagnostics`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'redeven-managed-launch-'));
  try {
    await cp(new URL('./redevenManagedBrowser.mjs', import.meta.url), path.join(root, 'launcher.mjs'));
    const module = path.join(root, 'node_modules/playwright');
    await mkdir(module, { recursive: true });
    await writeFile(path.join(module, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }));
    await writeFile(path.join(module, 'index.mjs'), `export const chromium = { launchPersistentContext() { throw new Error(${JSON.stringify(message)}); } };`);
    const result = spawnSync(process.execPath, [path.join(root, 'launcher.mjs'), path.join(root, 'profile'), '/fixture/chrome'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), { type: 'ready', protocol_version: 2, error: 'TARGET_SETUP_REQUIRED', reason });
    assert.equal(result.stderr, '');
  } finally { await rm(root, { recursive: true, force: true }); }
});
