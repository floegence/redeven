import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';
import { createBuiltDistServer, createBuiltDistTLS, trustBuiltDistWebTransport } from '../../internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'desktop/dist/flower-media-acceptance');
execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
await mkdir(output, { recursive: true });
const state = await mkdtemp(path.join(tmpdir(), 'redeven-flower-media-'));
const tls = await createBuiltDistTLS();
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDiff: execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).trim(),
  floe: JSON.parse(await readFile(new URL('../node_modules/@floegence/floe-webapp-core/package.json', import.meta.url))).version,
  state, marker: randomUUID(), url: server.resolvedUrls.local[0], errors: [], status: 'running' };
let child;
let exited;
let browser;
let page;
let envServer;
try {
  const entry = path.join(state, 'main.cjs');
  await writeFile(entry, `const { app, BrowserWindow } = require('electron');
    app.whenReady().then(() => { const win = new BrowserWindow({ width: 1240, height: 900, useContentSize: true,
      webPreferences: { contextIsolation: true, sandbox: true } }); win.loadURL('about:blank'); });`);
  child = spawn(electron, [entry, `--user-data-dir=${state}/profile`, `--redeven-smoke-run=${report.marker}`,
    `--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`,
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], {
    cwd: state, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  report.pid = child.pid;
  exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('Owned Electron CDP startup timed out')), 15000);
    child.once('error', reject);
    exited.then(result => { clearTimeout(timer); reject(new Error(`Owned Electron exited: ${JSON.stringify(result)}`)); });
    child.stderr.on('data', chunk => {
      log += chunk;
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  report.cdp = endpoint;
  console.log('Owned Flower media runtime:', JSON.stringify(report));
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.errors.push(error.message));
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(path.join(root, 'desktop/src/testSupport/mixedEnvironmentFixture.ts'));
  const { RUNTIME_SERVICE_COMPATIBILITY_EPOCH: epoch, RUNTIME_SERVICE_PROTOCOL_VERSION: protocol } = await server.ssrLoadModule(path.join(root, 'desktop/src/shared/runtimeService.ts'));
  const snapshot = mixedEnvironmentFixture().snapshot;
  snapshot.environments = snapshot.environments.map(entry => ({ ...entry, runtime_service: {
    ...(entry.runtime_service ?? entry.local_environment_runtime_service), compatibility_epoch: epoch, protocol_version: protocol,
    compatibility: 'compatible', open_readiness: { state: 'openable' }, ai_readiness: { state: 'inspecting' },
  } }));
  await page.addInitScript(snapshot => {
    window.navigationSnapshot = { ...snapshot, navigation_revision: 1 };
    const language = { preference: 'zh-CN', resolved_locale: 'zh-CN', source: 'explicit', system_candidates: [] };
    window.redevenDesktopLanguage = { getSnapshot: () => language, subscribe: () => () => {} };
  }, snapshot);
  await page.goto(new URL('flower-navigation.html?media=1', report.url).href);
  await page.locator('.redeven-flower-topbar-button').click();
  await page.evaluate(() => window.navigationFixture.releaseRuntime());
  await page.locator('[data-thread-id="navigation-thread"] button').first().click();
  await page.waitForFunction(() => document.querySelector('.chat-media-image')?.naturalWidth > 0);
  await page.locator('.chat-media-image').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'before.png') });
  report.stability = await page.evaluate(async () => {
    const image = document.querySelector('.chat-media-image');
    const src = image.src;
    const before = { requests: window.navigationFixture.requests.length, streams: window.navigationFixture.streams,
      cancellations: window.navigationFixture.cancellations };
    let reloads = 0;
    let snapshots = 0;
    const observer = new MutationObserver(() => {
      if (document.querySelector('.chat-media-image') !== image || image.src !== src) reloads++;
    });
    observer.observe(image.closest('[data-floe-markdown-media]'), { subtree: true, childList: true, attributes: true });
    const timer = setInterval(() => { window.navigationFixture.refreshHealth(); snapshots++; }, 500);
    await new Promise(resolve => setTimeout(resolve, 30000));
    clearInterval(timer); observer.disconnect();
    return { seconds: 30, snapshots, reloads, sameNode: document.querySelector('.chat-media-image') === image,
      sameURL: image.src === src, extraRequests: window.navigationFixture.requests.slice(before.requests),
      requests: [...window.navigationFixture.requests],
      extraStreams: window.navigationFixture.streams - before.streams,
      cancellations: window.navigationFixture.cancellations - before.cancellations };
  });
  assert.equal(report.stability.sameNode, true);
  assert.equal(report.stability.sameURL, true);
  assert.equal(report.stability.reloads, 0);
  assert.ok(report.stability.snapshots >= 50);
  assert.deepEqual(report.stability.extraRequests, []);
  assert.equal(report.stability.extraStreams, 0);
  assert.equal(report.stability.cancellations, 0);
  await page.screenshot({ path: path.join(output, 'after.png') });
  await page.locator('.chat-media-image-button').click();
  await page.locator('.chat-media-preview-window').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.chat-media-preview-window').waitFor({ state: 'detached' });
  const screenshotBytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(
    await (await fetch(document.querySelector('.chat-media-image').src)).arrayBuffer(),
  ))));
  await page.evaluate(() => window.navigationFixture.dispose());
  assert.ok(await page.evaluate(() => window.navigationFixture.cancellations > 0), 'Disposal releases the workspace stream');

  const thread = { thread_id: 'env-media-thread', title: 'Workspace preview', title_status: 'ready', title_generation: 1,
    model_id: 'fixture/fixture-model', run_status: 'idle', working_dir: '/workspace',
    created_at_unix_ms: 1, updated_at_unix_ms: 2, last_message_at_unix_ms: 2,
    read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } };
  const resourceRef = `computer://browser-main/${'a'.repeat(64)}`;
  const current = { thread_id: thread.thread_id, view_version: 1, activity: 'idle', queue: [], interactions: [],
    items: [{ id: 'env-reply', kind: 'assistant', turn_id: 'env-turn', run_id: 'env-run', ordinal: 1,
      text: `Here is the workspace preview.\n\n![Workspace](${resourceRef})` }] };
  const requests = [];
  const streams = new Set();
  envServer = await createBuiltDistServer({ accessReady: true, fileContinuity: true, tls,
    handleRequest: async (request, response, url) => {
      const route = url.pathname;
      if (route.startsWith('/_redeven_proxy/api/ai/')) requests.push(`${request.method} ${route}`);
      let value;
      if (route.endsWith('/ai/threads')) value = { threads: [thread] };
      else if (route.endsWith(`/ai/threads/${thread.thread_id}`)) value = { thread, current };
      else if (route.endsWith(`/ai/threads/${thread.thread_id}/read`)) value = thread.read_status;
      else if (route.endsWith('/ai/attachments/capabilities')) value = { model_id: thread.model_id, revision: '1', enabled: false };
      else if (route.includes('/computer-media/')) {
        response.writeHead(200, { 'content-type': 'image/png' }); response.end(screenshotBytes); return true;
      } else if (route.endsWith('/ai/flower/stream')) {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        response.write(`data: ${JSON.stringify({ schema_version: 1, kind: 'ready', summaries: [thread] })}\n\n`);
        streams.add(response); request.on('close', () => streams.delete(response)); return true;
      } else return false;
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(value)); return true;
    },
  });
  report.envURL = envServer.baseURL;
  await trustBuiltDistWebTransport(page, tls);
  await page.addInitScript(() => {
    localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
    localStorage.setItem('redeven-envapp:env_local-activity-navigation', JSON.stringify({
      version: 1, target: { kind: 'builtin', page: 'ai' }, recentBuiltins: ['ai'],
    }));
  });
  await page.goto(new URL('_redeven_proxy/env/', envServer.baseURL).href);
  await page.locator(`[data-thread-id="${thread.thread_id}"] button`).first().click();
  await page.waitForFunction(() => document.querySelector('.chat-media-image')?.naturalWidth > 0);
  await page.locator('.chat-media-image').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'env-before.png') });
  const requestCount = requests.length;
  const heartbeat = setInterval(() => { for (const stream of streams) stream.write(': keepalive\n\n'); }, 500);
  try {
    report.envStability = await page.evaluate(async () => {
      const image = document.querySelector('.chat-media-image');
      const src = image.src;
      let reloads = 0;
      const observer = new MutationObserver(() => {
        if (document.querySelector('.chat-media-image') !== image || image.src !== src) reloads++;
      });
      observer.observe(image.closest('[data-floe-markdown-media]'), { subtree: true, childList: true, attributes: true });
      await new Promise(resolve => setTimeout(resolve, 30000));
      observer.disconnect();
      return { seconds: 30, reloads, sameNode: document.querySelector('.chat-media-image') === image, sameURL: image.src === src };
    });
  } finally { clearInterval(heartbeat); }
  report.envStability.extraRequests = requests.slice(requestCount);
  report.envStability.requests = [...requests];
  assert.equal(report.envStability.sameNode, true);
  assert.equal(report.envStability.sameURL, true);
  assert.equal(report.envStability.reloads, 0);
  assert.deepEqual(report.envStability.extraRequests, []);
  await page.screenshot({ path: path.join(output, 'env-after.png') });
  assert.deepEqual(report.errors, []);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null, 'External termination is a visible verification failure');
  report.status = 'passed';
  console.log(JSON.stringify(report.stability));
  console.log(JSON.stringify(report.envStability));
} catch (error) {
  report.status = 'failed'; report.failure = String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
    await exited;
  }
  await envServer?.close();
  await tls.cleanup(); await server.close(); await rm(state, { recursive: true, force: true });
}
