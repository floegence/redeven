import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { observeContinuityFrames, cachePages } from '../../internal/envapp/ui_src/scripts/fixtures/startupContinuity.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(desktop, 'package.json'));
const { chromium } = createRequire(path.join(desktop, '../internal/envapp/ui_src/package.json'))('playwright');
const bundle = process.env.REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT;
assert.ok(bundle, 'Build a task-owned Runtime and set REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT');
const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
const directory = await mkdtemp(path.join(tmpdir(), 'redeven-content-'));
const marker = randomUUID();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(probe, message, timeout = 60000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const result = await probe(); if (result) return result; await sleep(50); }
  throw new Error(message);
}
async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
execFileSync(path.join(desktop, '../scripts/check_desktop_electron_test_runtime.sh'), [desktop], { stdio: 'inherit' });
console.log('Production continuity artifact:', JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: desktop, encoding: 'utf8' }).trim(), manifest, directory, marker }));
try {
  for (const phase of ['initial', 'restart']) {
    const port = await freePort();
    const runtimePort = await freePort();
    const child = spawn(require('electron'), [desktop, `--user-data-dir=${directory}/profile`, `--redeven-content-run=${marker}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
      cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_STATE_ROOT: `${directory}/state`, REDEVEN_DESKTOP_USER_DATA_ROOT: `${directory}/profile`, REDEVEN_DESKTOP_CACHE_ROOT: `${directory}/cache`, REDEVEN_DESKTOP_TEMP_ROOT: `${directory}/temp`, REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1', REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0', REDEVEN_DESKTOP_LOCAL_UI_BIND: `127.0.0.1:${runtimePort}`, REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle },
    });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    let browser;
    try {
      await eventually(async () => {
        assert.equal(child.exitCode, null, `Electron exited before CDP: ${log}`);
        return fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.ok).catch(() => false);
      }, 'Production Electron CDP did not start');
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const context = browser.contexts()[0];
      const welcome = await eventually(() => context.pages().find(page => page.url().includes('/welcome/')), `Welcome did not open: ${log}`);
      const open = () => welcome.getByRole('button', { name: /^(Open|Show|打开|显示) Env App$/ }).first();
      await open().click({ timeout: 60000 });
      let page = await eventually(() => context.pages().find(page => page.url().includes('/_redeven_proxy/env/')), 'Env App did not open from Welcome');
      page.setDefaultTimeout(30000);
      if (phase === 'initial') {
        await page.getByText('Activity', { exact: true }).click();
        await page.getByRole('button', { name: /^(Host Applications|主机应用)$/ }).click();
      }
      await page.locator('button.host-app-tile').first().waitFor();
      await page.waitForFunction(() => !document.querySelector('.host-apps-header .animate-spin'));
      const assets = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
      console.log('PASS production Welcome entry:', JSON.stringify({ phase, pid: child.pid, port, runtimePort, url: page.url(), assets, fingerprint: createHash('sha256').update(JSON.stringify(assets.map(url => new URL(url).pathname))).digest('hex') }));
      if (phase === 'initial') {
        await page.evaluate(observeContinuityFrames, cachePages.applications);
        await page.locator('button.host-app-tile').first().evaluate(row => { globalThis.__retainedRow = row; });
        await page.evaluate(() => window.redevenDesktopShell.minimizeWindow());
        await open().click();
        assert.equal(await page.locator('button.host-app-tile').first().evaluate(row => row === globalThis.__retainedRow), true);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await page.waitForTimeout(1000);
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await page.getByRole('button', { name: /^(Reconnect|重新连接|重连)$/ }).waitFor({ timeout: 60000 });
        await page.waitForFunction(() => !document.querySelector('.host-apps-header .animate-spin'));
        assert.equal(await page.locator('button.host-app-tile').first().evaluate(row => row === globalThis.__retainedRow), true);
        const frames = await page.evaluate(() => globalThis.__continuityFrames);
        assert.ok(frames.length && frames.every(frame => frame.row && !frame.skeleton), JSON.stringify(frames));
        console.log('PASS production hide/show and reconnect:', JSON.stringify(frames));
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        await page.evaluate(() => window.redevenDesktopShell.closeWindow()).catch(() => {});
        await eventually(() => page.isClosed(), 'Env App close did not destroy its window');
        await open().click();
        page = await eventually(() => context.pages().find(candidate => candidate.url().includes('/_redeven_proxy/env/')), 'Env App did not reopen');
        await page.locator('button.host-app-tile').first().waitFor();
        console.log('PASS production close/reopen retains Activity target and inventory');
      }
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await eventually(async () => (await page.evaluate(() => window.redevenDesktopResourceCache.list())).length > 0, 'Desktop cache did not persist');
    } catch (error) {
      console.error('Production Desktop failure:', error, log.slice(-16000));
      if (browser) for (const page of browser.contexts()[0].pages()) console.error('Window:', page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
      throw error;
    } finally {
      await browser?.close();
      if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGTERM');
      const result = await exited;
      assert.notEqual(result.signal, 'SIGKILL', 'An external SIGKILL is a test failure');
    }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
