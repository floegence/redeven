#!/usr/bin/env node
/* global document */
// Run after building Env App assets, the native Runtime, and Desktop main modules.
// Fixtures are eight-second ffmpeg testsrc2/sine media encoded as H.264/AAC;
// optional --local-video is read only and is never copied into the fixture set.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { installReDevPluginRuntimeFixture } from './redevpluginRuntimeFixture.mjs';

const root = path.resolve(import.meta.dirname, '../../../..');
const requireDesktop = createRequire(path.join(root, 'desktop/package.json'));
const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const reportPath = option('--report');
const carrier = option('--carrier') ?? 'all';
assert.ok(['all', 'chromium', 'electron'].includes(carrier), 'Invalid --carrier');
if (!reportPath || !option('--binary')) throw new Error('Required: --binary <built runtime> --report <output.json>');
const temp = await mkdtemp(path.join(os.homedir(), '.redeven-preview-media-'));
const marker = randomUUID();
const owned = [];
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), marker, state: temp, carriers: [] };
let browser;

function start(command, commandArgs, extra = {}) {
  const child = spawn(command, commandArgs, {
    cwd: temp, env: { ...process.env, GOWORK: 'off', ELECTRON_RUN_AS_NODE: undefined },
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], ...extra,
  });
  const state = { child, output: '', stopped: false };
  child.stdout.on('data', (chunk) => { state.output += chunk; });
  child.stderr.on('data', (chunk) => { state.output += chunk; });
  child.once('error', (error) => { state.error = error; });
  owned.push(state);
  return state;
}
async function until(read, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const state of owned) {
      if (state.error) throw state.error;
      if (!state.stopped && (state.child.exitCode !== null || state.child.signalCode !== null)) {
        throw new Error(`Owned process exited: ${state.child.exitCode}/${state.child.signalCode}\n${state.output}`);
      }
    }
    const result = await read();
    if (result) return result;
    await delay(50);
  }
  throw new Error('Media acceptance timed out');
}
async function stop(state) {
  if (!state || state.stopped) return;
  if (state.child.exitCode !== null || state.child.signalCode !== null) {
    throw new Error(`Owned process exited unexpectedly: ${state.child.exitCode}/${state.child.signalCode}`);
  }
  state.stopped = true;
  const exited = new Promise((resolve) => state.child.once('exit', resolve));
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(state.child.pid), '/T', '/F']);
  else process.kill(-state.child.pid, 'SIGTERM');
  const timeout = new AbortController();
  try {
    await Promise.race([exited, delay(10000, undefined, { signal: timeout.signal }).then(() => { throw new Error('Owned process did not stop'); })]);
  } finally {
    timeout.abort();
  }
}
async function openFile(page, file) {
  const workbench = await page.getByRole('tab', { name: 'Workbench', exact: true }).getAttribute('aria-selected') === 'true';
  if (workbench) await page.locator('[data-workbench-dock-component="redeven.files"]').click();
  const scope = workbench ? page.locator('[data-workbench-widget-type="redeven.files"]').last() : page;
  await scope.getByTitle('Go to path', { exact: true }).filter({ visible: true }).last().click();
  const input = scope.getByRole('textbox', { name: 'Go to path', exact: true });
  await input.fill(path.dirname(file));
  await input.press('Enter');
  await input.waitFor({ state: 'hidden', timeout: 30000 });
  await scope.getByRole('textbox', { name: 'Filter files', exact: true }).filter({ visible: true }).last().fill(path.basename(file));
  const item = scope.getByText(path.basename(file), { exact: true }).filter({ visible: true }).last().locator('xpath=ancestor::*[@data-file-browser-item-path][1]');
  await item.dblclick({ position: { x: 12, y: 12 } });
}
async function checkMedia(page, kind, file, output, surface, observer) {
  const startTime = Date.now();
  await openFile(page, file);
  const media = page.locator(`${kind}:visible`).last();
  await media.waitFor();
  await page.waitForFunction((kind) => [...document.querySelectorAll(kind)].some((el) => el.getBoundingClientRect().width > 0 && el.readyState >= 2), kind, { timeout: 5000 });
  const readyWithinMs = Date.now() - startTime;
  const ready = await media.evaluate((el) => ({ duration: el.duration, width: el.videoWidth ?? 0, readyState: el.readyState }));
  assert.ok(Number.isFinite(ready.duration) && ready.duration > 5);
  if (kind === 'video') assert.ok(ready.width > 0);
  await media.evaluate(async (el) => { el.muted = true; await el.play(); });
  await page.waitForFunction((kind) => [...document.querySelectorAll(kind)].some((el) => el.getBoundingClientRect().width > 0 && el.currentTime > 0.25), kind, { timeout: 5000 });
  const target = Math.min(ready.duration * 0.7, ready.duration - 1);
  await media.evaluate((el, time) => { el.pause(); el.currentTime = time; }, target);
  await page.waitForFunction(({ kind, target }) => [...document.querySelectorAll(kind)].some((el) => !el.seeking && Math.abs(el.currentTime - target) < 0.2 && el.readyState >= 2), { kind, target }, { timeout: 5000 });
  output.media.push({ surface, kind, file: path.basename(file), ...ready, readyWithinMs, seek: target });
  if (output.name === 'chromium' && surface === 'Activity' && !output.download) {
    const expectedBytes = await readFile(file);
    // Select an isolated real browser file handle without a native picker dialog.
    // The product download manager and session file stream remain unchanged.
    await page.evaluate(async () => {
      const directory = await globalThis.navigator.storage.getDirectory();
      const handle = await directory.getFileHandle('event-transport-download', { create: true });
      globalThis.showSaveFilePicker = async () => { globalThis.__downloadPickerCalled = true; return handle; };
    });
    const download = page.getByRole('button', { name: 'Download file', exact: true }).filter({ visible: true }).last();
    if (await download.count()) await download.click();
    else {
      await page.getByRole('button', { name: 'More actions', exact: true }).filter({ visible: true }).last().click();
      await page.getByRole('menuitem', { name: 'Download file', exact: true }).click();
    }
    await page.getByRole('banner', { name: 'Redeven environment toolbar' }).getByRole('button', { name: 'Downloads', exact: true }).click();
    await page.screenshot({ path: `${reportPath}.download-start.png` });
    const saved = await until(async () => page.evaluate(async (expectedSize) => {
      const failed = document.querySelector('[data-download-task-status="failed"]');
      if (failed) throw new Error(failed.textContent);
      const directory = await globalThis.navigator.storage.getDirectory();
      const file = await (await directory.getFileHandle('event-transport-download')).getFile();
      if (file.size !== expectedSize) return null;
      const bytes = await file.arrayBuffer();
      const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return { bytes: file.size, sha256: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('') };
    }, expectedBytes.length)).catch(async (error) => {
      throw new Error(`File download failed: ${JSON.stringify({ pickerCalled: await page.evaluate(() => globalThis.__downloadPickerCalled === true), task: await page.getByRole('dialog', { name: 'Downloads', exact: true }).innerText() })}`, { cause: error });
    });
    assert.equal(saved.sha256, createHash('sha256').update(expectedBytes).digest('hex'));
    output.download = saved;
    await page.getByRole('banner', { name: 'Redeven environment toolbar' }).getByRole('button', { name: 'Downloads', exact: true }).click();
  }
  if (reportPath) await page.screenshot({ path: `${reportPath}.${output.name}.${surface}.${kind}.png` });
  const preview = media.locator('xpath=ancestor::*[@data-floe-geometry-surface="floating-window"][1]');
  if (await preview.count()) {
    await preview.locator('[data-floe-floating-window-control="close"]').click();
    await preview.waitFor({ state: 'detached' });
  } else {
    const widget = media.locator('xpath=ancestor::article[contains(@class,"workbench-widget")][1]');
    const widgetID = await widget.getAttribute('data-floe-workbench-widget-id');
    const observedWidget = observer.locator(`[data-floe-workbench-widget-id="${widgetID}"]`);
    await observedWidget.waitFor({ state: 'attached' });
    // Finish the persisted close before opening a new preview lifetime.
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/workbench/layout')
      && response.request().method() === 'PUT' && response.ok()
      && !response.request().postDataJSON().widgets.some((entry) => entry.widget_id === widgetID));
    await widget.locator('.workbench-widget__window-control--close').click();
    await widget.waitFor({ state: 'detached' });
    await saved;
    await observedWidget.waitFor({ state: 'detached' });
    output.workbenchSharedUpdates = (output.workbenchSharedUpdates ?? 0) + 1;
  }
  await media.waitFor({ state: 'hidden' });
}
async function openNotesObserver(page) {
  if (await page.locator('.notes-overlay').isVisible()) return;
  // The controller can finish its snapshot while the window is changing focus.
  // The visible overlay is the lifecycle boundary; the later topic assertion
  // proves that its session event observation is live.
  const snapshot = page.waitForResponse(
    (response) => response.url().includes('/api/notes/snapshot') && response.ok(),
    { timeout: 5000 },
  ).catch(() => undefined);
  await page.getByRole('button', { name: 'Notes overlay', exact: true }).click();
  await page.locator('.notes-overlay').waitFor({ state: 'visible' });
  await snapshot;
}
async function verify(page, url, name, suppliedObserver) {
  page.setDefaultTimeout(10000);
  const output = { name, media: [], streams: [], sessionConnections: 0 };
  report.carriers.push(output);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const streams = new Map();
  cdp.on('Network.webSocketCreated', () => { output.sessionConnections += 1; });
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    const url = new URL(request.url);
    if (/\/(events|stream)$/.test(url.pathname) && url.pathname.startsWith('/_redeven_proxy/')) {
      const stream = { path: url.pathname, priority: request.initialPriority, chunks: 0, active: true };
      streams.set(requestId, stream); output.streams.push(stream);
    }
  });
  cdp.on('Network.dataReceived', ({ requestId }) => { const stream = streams.get(requestId); if (stream) stream.chunks += 1; });
  cdp.on('Network.loadingFinished', ({ requestId }) => { const stream = streams.get(requestId); if (stream) stream.active = false; });
  cdp.on('Network.loadingFailed', ({ requestId }) => { const stream = streams.get(requestId); if (stream) stream.active = false; });
  await page.bringToFront();
  await page.goto(url);
  await page.getByRole('tab', { name: 'Activity', exact: true }).waitFor();
  output.effectiveType = await page.evaluate(() => navigator.connection.effectiveType);
  assert.equal(output.effectiveType, '3g');
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  const observer = suppliedObserver ?? await page.context().newPage();
  await observer.bringToFront();
  await observer.goto(url);
  await observer.getByRole('tab', { name: 'Activity', exact: true }).click();
  await openNotesObserver(observer);
  await page.bringToFront();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.getByRole('button', { name: 'File Browser', exact: true }).filter({ visible: true }).last().click();
  const files = [path.join(temp, 'media/preview.mp4'), path.join(temp, 'media/preview.m4a')];
  for (const surface of ['Activity', 'Workbench']) {
    if (surface === 'Workbench') {
      await observer.bringToFront();
      await observer.getByRole('tab', { name: 'Workbench', exact: true }).click();
      await page.bringToFront();
      await page.getByRole('tab', { name: 'Workbench', exact: true }).click();
      await page.getByTitle('Go to path', { exact: true }).filter({ visible: true }).last().waitFor();
    }
    await checkMedia(page, 'video', files[0], output, surface, observer);
    await checkMedia(page, 'video', files[0], output, surface, observer);
    await checkMedia(page, 'audio', files[1], output, surface, observer);
    if (option('--local-video')) await checkMedia(page, 'video', path.resolve(option('--local-video')), output, surface, observer);
  }
  // Workbench owns the observer window while shared widget changes are checked;
  // return it to Activity before opening Notes because its control is Activity-scoped.
  await observer.bringToFront();
  await observer.getByRole('tab', { name: 'Activity', exact: true }).click();
  await openNotesObserver(observer);
  await page.bringToFront();
  const topic = `Media acceptance ${name}`;
  const result = await page.evaluate(async (topic) => {
    const response = await fetch('/_redeven_proxy/api/notes/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: topic }) });
    return response.status;
  }, topic);
  assert.equal(result, 200);
  await observer.getByText(topic, { exact: true }).waitFor();
  output.notesObservation = 'received';
  output.streams = [...streams.values()];
  assert.equal(output.streams.length, 0, 'Env App must not open native HTTP event subscriptions');
  assert.equal(output.sessionConnections, 1, 'media and events share one Flowersec session');
  await observer.close();
  output.status = 'passed';
  await cdp.detach();
}
const cleanupErrors = [];
try {
  await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  await mkdir(path.join(temp, 'media'));
  for (const file of ['preview.mp4', 'preview.m4a']) await copyFile(path.join(import.meta.dirname, 'fixtures/media', file), path.join(temp, 'media', file));
  const binary = path.join(temp, 'redeven');
  await copyFile(path.resolve(option('--binary')), binary);
  await installReDevPluginRuntimeFixture(temp);
  const startupFile = path.join(temp, 'startup.json');
  const runtime = start(binary, ['run', '--mode', 'desktop', '--state-root', path.join(temp, 'state'), '--local-ui-bind', '127.0.0.1:0', '--local-ui-protocol', 'http', '--presentation', 'machine', '--startup-report-file', startupFile]);
  const startup = await until(async () => {
    try { const value = JSON.parse(await readFile(startupFile, 'utf8')); return value.status === 'ready' ? value : null; }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  });
  report.runtime = { pid: runtime.child.pid, url: startup.local_ui_url, bridgeURL: startup.local_ui_bridge_url };
  console.log('Owned media acceptance runtime:', JSON.stringify(report));
  if (carrier !== 'electron') {
    browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--force-effective-connection-type=3G'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-US' });
    const page = await context.newPage();
    await verify(page, startup.local_ui_url, 'chromium');
    await browser.close(); browser = null;
  }
  if (carrier !== 'chromium') {
    execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), { cwd: root, stdio: 'inherit' });
    const config = path.join(temp, 'electron.json');
    await writeFile(config, JSON.stringify(startup), { mode: 0o600 });
    const preload = path.join(temp, 'preload.cjs');
    await requireDesktop('esbuild').build({
      stdin: { contents: "import { bootstrapDesktopSessionContextBridge } from './src/preload/desktopSessionContext'; bootstrapDesktopSessionContextBridge();", resolveDir: path.join(root, 'desktop') },
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: preload,
    });
    const entry = path.join(temp, 'electron.cjs');
    await writeFile(entry, `const { app, BrowserWindow, session, ipcMain } = require('electron');
const startup = require(${JSON.stringify(config)});
const { desktopPrivateBridgeRequestHeaders } = require(${JSON.stringify(path.join(root, 'desktop/dist/main/desktopSessionTransport.js'))});
const { desktopSessionContextSnapshotFromTarget } = require(${JSON.stringify(path.join(root, 'desktop/dist/main/desktopSessionContext.js'))});
const channels = require(${JSON.stringify(path.join(root, 'desktop/dist/shared/desktopSessionContextIPC.js'))});
ipcMain.on(channels.DESKTOP_SESSION_CONTEXT_GET_CHANNEL, (event) => { event.returnValue = desktopSessionContextSnapshotFromTarget({ kind: 'local_environment', environment_id: 'media-acceptance', route: 'local_host', label: 'Media acceptance' }, undefined, 'native_local_bridge'); });
ipcMain.on(channels.DESKTOP_SESSION_TRANSPORT_RECOVERY_GET_CHANNEL, (event) => { event.returnValue = null; });
app.commandLine.appendSwitch('force-effective-connection-type', '3G');
app.commandLine.appendSwitch('lang', 'en-US');
app.whenReady().then(() => {
 session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => callback({requestHeaders: desktopPrivateBridgeRequestHeaders({kind: 'native_local_bridge', allowedBaseURL: startup.local_ui_bridge_url}, startup, details.url, details.requestHeaders)}));
 for (let index = 0; index < 2; index += 1) {
  const window = new BrowserWindow({width: 1440, height: 960, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, preload: ${JSON.stringify(preload)}}});
  window.loadURL('about:blank');
 }
});
app.on('window-all-closed', () => app.quit());
  `);
    const electron = start(requireDesktop('electron'), [entry, '--remote-debugging-port=0', `--user-data-dir=${temp}/profile`, `--redeven-media-test=${marker}`]);
    report.electronPID = electron.child.pid;
    const endpoint = await until(() => electron.output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1]);
    browser = await chromium.connectOverCDP(endpoint);
    const electronPages = await until(() => { const pages = browser.contexts()[0]?.pages(); return pages?.length === 2 ? pages : null; });
    await verify(electronPages[0], new URL('/_redeven_proxy/env/', startup.local_ui_bridge_url).href, 'electron', electronPages[1]);
    await browser.close(); browser = null;
    await stop(electron);
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack ?? String(error);
  for (const [index, page] of (browser?.contexts()[0]?.pages() ?? []).entries()) await page.screenshot({ path: `${reportPath}.failure-${index}.png` }).catch(() => {});
  throw error;
} finally {
  try { if (browser) await browser.close(); } catch (error) { cleanupErrors.push(error); }
  for (const state of owned.reverse()) {
    try { await stop(state); } catch (error) { cleanupErrors.push(error); }
  }
  if (cleanupErrors.length) {
    report.status = 'failed';
    report.cleanupErrors = cleanupErrors.map((error) => error.stack ?? String(error));
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (!cleanupErrors.length) await rm(temp, { recursive: true, force: true });
}
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, `Media acceptance cleanup failed; inspect ${temp}`);
