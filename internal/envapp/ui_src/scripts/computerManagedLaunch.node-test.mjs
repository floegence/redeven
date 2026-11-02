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
    await writeFile(path.join(module, 'index.mjs'), `export const chromium = { connectOverCDP() { throw new Error(${JSON.stringify(message)}); } };`);
    const result = spawnSync(process.execPath, [path.join(root, 'launcher.mjs'), path.join(root, 'profile'), 'http://127.0.0.1:9222'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), { type: 'ready', protocol_version: 2, error: 'TARGET_SETUP_REQUIRED', reason });
    assert.equal(result.stderr, '');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('idle release requires zero page targets and zero unfinished downloads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'redeven-managed-idle-'));
  try {
    await cp(new URL('./redevenManagedBrowser.mjs', import.meta.url), path.join(root, 'launcher.mjs'));
    const module = path.join(root, 'node_modules/playwright');
    await mkdir(module, { recursive: true });
    await writeFile(path.join(module, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }));
    const stub = [
      'const handlers = new Map(); let count = 0;',
      "const session = {on(name, fn) {handlers.set(name, fn)}, async send(name) {",
      "if (name !== 'Target.getTargets') return {}; count++;",
      "if (count === 1) handlers.get('Browser.downloadWillBegin')({guid:'download'});",
      "if (count === 2) handlers.get('Browser.downloadProgress')({guid:'download', state:'inProgress'});",
      "if (count === 3) handlers.get('Browser.downloadProgress')({guid:'download', state:'completed'});",
      "return {targetInfos:count === 4 ? [{type:'page'}] : []}; }};",
      'export const chromium = {async connectOverCDP(){return {contexts(){return [{on(){}}]}, async newBrowserCDPSession(){return session}, isConnected(){return true}, async close(){}}}};',
    ].join('\n');
    await writeFile(path.join(module, 'index.mjs'), stub);
    const input = [1, 2, 3, 4, 5].map(id => JSON.stringify({ id: String(id), command: 'idle_status' })).join('\n') + '\n';
    const result = spawnSync(process.execPath, [path.join(root, 'launcher.mjs'), path.join(root, 'profile'), 'http://127.0.0.1:9222'], { encoding: 'utf8', input, timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(replies[0].type, 'ready');
    assert.deepEqual(replies.slice(1).map(reply => reply.idle), [false, false, true, false, true]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
