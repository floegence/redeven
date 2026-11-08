import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareDevelopmentApp } from './dev_desktop_macos.mjs';

test('Launch Services isolates permission identity and supervises the exact app', { skip: process.platform !== 'darwin', timeout: 60000 }, async () => {
  const desktop = fileURLToPath(new URL('../desktop', import.meta.url));
  const electron = createRequire(path.join(desktop, 'package.json'))('electron');
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-permission-launch-'));
  const children = [];
  try {
    const prepared = prepareDevelopmentApp(electron, root, 'acceptance', desktop);
    assert.deepEqual(prepareDevelopmentApp(electron, root, 'acceptance', desktop), prepared);
    const script = path.join(root, 'probe.cjs');
    const record = path.join(root, 'record.json');
    const pidFile = path.join(root, 'app.pid');
    writeFileSync(script, `const { app, BrowserWindow, systemPreferences } = require('electron');
const fs = require('node:fs');
app.setPath('userData', ${JSON.stringify(path.join(root, 'profile'))});
app.whenReady().then(async () => {
 const window = new BrowserWindow({show:false, webPreferences:{sandbox:true, contextIsolation:true}});
 await window.loadURL('data:text/html,<title>Permission launch acceptance</title>');
 const title = await window.webContents.executeJavaScript('document.title');
 fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({pid:process.pid, ppid:process.ppid, title, screen:systemPreferences.getMediaAccessStatus('screen'), input:systemPreferences.isTrustedAccessibilityClient(false), name:process.env.REDEVEN_HOST_PERMISSION_APP_NAME}));
 setTimeout(() => app.exit(Number(process.env.REDEVEN_TEST_EXIT)), Number(process.env.REDEVEN_TEST_DELAY));
});`);
    for (const scenario of [{ exit: 0, delay: 800 }, { exit: 23, delay: 800 }, { exit: 0, delay: 30000, interrupt: true }]) {
      rmSync(record, { force: true }); rmSync(pidFile, { force: true });
      const child = spawn(prepared.launcher, [prepared.app, pidFile, script], {
        env: { ...process.env, REDEVEN_TEST_EXIT: String(scenario.exit), REDEVEN_TEST_DELAY: String(scenario.delay) }, stdio: ['ignore', 'ignore', 'inherit'],
      });
      children.push(child);
      const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
      let observed;
      for (let attempt = 0; attempt < 150; attempt++) {
        try { observed = JSON.parse(readFileSync(record, 'utf8')); if (Number(readFileSync(pidFile, 'utf8')) === observed.pid) break; } catch {}
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      assert.ok(observed?.pid, 'The exact launched app reports readiness');
      assert.equal(Number(readFileSync(pidFile, 'utf8')), observed.pid);
      assert.equal(observed.name, undefined);
      assert.equal(observed.title, 'Permission launch acceptance');
      assert.equal(observed.input, false, 'A new launch identity must not inherit terminal accessibility grants');
      assert.notEqual(observed.screen, 'granted', 'A new launch identity must not inherit terminal capture grants');
      assert.equal(observed.ppid, 1, 'Launch Services owns the app, not the terminal supervisor');
      if (scenario.interrupt) child.kill('SIGTERM');
      const result = await ended;
      assert.deepEqual(result, { code: scenario.interrupt ? 143 : scenario.exit, signal: null });
      assert.throws(() => process.kill(observed.pid, 0), { code: 'ESRCH' });
    }
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    rmSync(root, { recursive: true, force: true });
  }
});
