import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stageComputerResources } from './stage_computer_resources.mjs';

test('immutable computer bundle starts without source, PATH, NODE_PATH or browser cache', { skip: process.env.REDEVEN_COMPUTER_BUNDLE_QUALIFICATION !== '1', timeout: 120000 }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'redeven-computer-bundle-'));
  let child;
  let exited;
  try {
    stageComputerResources(path.join(root, 'build'));
    renameSync(path.join(root, 'build'), path.join(root, 'relocated'));
    const resources = path.join(root, 'relocated');
    const manifest = JSON.parse(readFileSync(path.join(resources, 'manifest.json')));
    assert.ok(manifest.files.some(file => file.path === 'node_modules/playwright/package.json'));
    child = spawn(path.join(resources, 'node'), [path.join(resources, 'redevenComputerHost.mjs'), '--profile', path.join(root, 'profile')], {
      cwd: os.tmpdir(), env: { HOME: root, PATH: '/usr/bin:/bin', PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'absent-cache') }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000,
    });
    exited = new Promise(resolve => child.once('exit', resolve));
    let stderr = '';
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(0, 4096); });
    let pending = '';
    let ready = false;
    const result = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => reject(new Error(`Helper exited before screenshot: ${code}/${signal}: ${stderr}`)));
      child.stdout.on('data', bytes => {
        pending += bytes;
        while (pending.includes('\n')) {
          const end = pending.indexOf('\n');
          const line = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
          if (!ready) {
            if (line.type !== 'ready' || line.error) { reject(new Error(`Helper startup failed: ${line.error ?? line.type}/${line.reason ?? ''}`)); return; } ready = true;
            child.stdin.write(JSON.stringify({ id: 'observe', target_id: 'fixture', tool_name: 'computer.screenshot', args: {} }) + '\n');
          } else { resolve(line); }
        }
      });
    });
    const screenshot = await result;
    assert.equal(screenshot.id, 'observe');
    assert.equal(screenshot.error, undefined);
    assert.ok(Buffer.from(screenshot.screenshot.data, 'base64').length > 1000);
    child.stdin.end();
    await exited;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (exited) await exited;
    rmSync(root, { recursive: true, force: true });
  }
});
