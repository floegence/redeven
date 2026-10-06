import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { build } from 'esbuild';
import electron from 'electron';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

// Cloud approval belongs to the private integration runner. This fixture only
// exercises the real local consent UI and owner-authenticated Runtime bridge.
for (const key of ['REDEVEN_GATEWAY_JOIN_CONTAINER', 'REDEVEN_GATEWAY_JOIN_STATE_ROOT', 'REDEVEN_GATEWAY_JOIN_MATERIAL']) {
  assert.ok(process.env[key], `${key} is required`);
}
execFileSync('../scripts/check_desktop_electron_test_runtime.sh', [process.cwd()], { stdio: 'inherit' });
const directory = await mkdtemp(path.join(tmpdir(), 'redeven-gateway-electron-'));
await mkdir('dist/gateway-cloud-acceptance', { recursive: true });
const marker = randomUUID();
const server = await createSSHSettingsPreviewServer(0, ['gateway-cloud.html']);
await server.watcher.close();
let child;
let browser;
try {
  for (const entry of ['gateway-cloud-electron', 'gateway-cloud-preload']) {
    await build({ entryPoints: [`scripts/fixtures/${entry}.ts`], outfile: path.join(directory, `${entry}.cjs`),
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  }
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  child = spawn(electron, [path.join(directory, 'gateway-cloud-electron.cjs'), `--user-data-dir=${directory}/profile`,
    `--remote-debugging-port=${port}`, `--redeven-gateway-qualification=${marker}`], {
    cwd: directory, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
      REDEVEN_GATEWAY_JOIN_PRELOAD: path.join(directory, 'gateway-cloud-preload.cjs'),
      REDEVEN_GATEWAY_JOIN_RENDERER: new URL('gateway-cloud.html?locale=en-US', server.resolvedUrls.local[0]).href },
  });
  let ready = false;
  let startupOutput = '';
  child.stdout.on('data', chunk => { startupOutput += chunk; ready = startupOutput.includes('Gateway qualification Electron ready'); });
  // Drain diagnostics without logging request payloads or bridge credentials.
  child.stderr.on('data', () => {});
  child.on('error', () => {});
  console.log(`Owned Gateway Electron: pid=${child.pid}, port=${port}, marker=${marker}, state=${directory}`);
  const deadline = Date.now() + 90_000;
  while (!ready) {
    assert.ok(child.exitCode === null && child.signalCode === null, `Electron exited: ${child.exitCode}/${child.signalCode}`);
    assert.ok(Date.now() < deadline, 'Electron trusted bridge startup timed out');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages().find(p => p.url().includes('/gateway-cloud.html'));
  assert.ok(page, 'Owned Gateway renderer was not found');
  const trigger = page.getByRole('button', { name: 'Connect via Gateway', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'join.json', mimeType: 'application/json',
    buffer: await readFile(process.env.REDEVEN_GATEWAY_JOIN_MATERIAL) });
  await dialog.getByRole('button', { name: 'Agree and connect', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('approval'), null, { timeout: 120_000 });
  await page.keyboard.press('Escape');
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  await trigger.click();
  await dialog.getByRole('button', { name: 'Resume enrollment', exact: true }).click();
  console.log('Gateway Desktop: durable local consent submitted; awaiting Cloud approval.');
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.trim() === 'Connected', null, { timeout: 180_000 });
  assert.equal(await dialog.getByRole('alert').count(), 0);
  await page.screenshot({ path: path.resolve('dist/gateway-cloud-acceptance/electron-connected.png') });
  console.log('PASS Gateway Desktop: real Electron consent, pause/resume, trusted container bridge and Cloud registration.');
  assert.ok(child.exitCode === null && child.signalCode === null, 'Electron terminated unexpectedly');
} finally {
  await browser?.close();
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
    await exited;
  }
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
