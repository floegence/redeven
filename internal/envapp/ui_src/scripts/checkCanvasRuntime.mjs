#!/usr/bin/env node
// Qualify the built product through a fresh, real Runtime. Only model output is
// scripted; never attach this test to an existing browser or user environment.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert(['--binary', '--output'].includes(key) && value, 'Required: --binary <built Runtime bundle> --output <evidence directory>');
  options.set(key, path.resolve(value));
}
assert(options.has('--binary') && options.has('--output'), 'Required: --binary <built Runtime bundle> --output <evidence directory>');
const root = path.resolve(import.meta.dirname, '../../../..');
const output = options.get('--output');
const temp = await mkdtemp(path.join(os.tmpdir(), 'redeven-canvas-acceptance-'));
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), scenarios: [] };
let runtime, browser, runtimeLog = '', providerCalls = 0;
const reply = 'The storefront calls Orders API, which reads the Orders database.';
const provider = http.createServer(async (request, response) => {
  if (request.url === '/v1/models') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'gpt-5-mini' }] }));
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  JSON.parse(raw);
  providerCalls++;
  response.setHeader('Content-Type', 'text/event-stream');
  const send = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  const item = { type: 'message', id: `message-${providerCalls}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] };
  send({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
  send({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: reply });
  send({ type: 'response.output_item.done', output_index: 0, item });
  send({ type: 'response.completed', response: { id: `response-${providerCalls}`, status: 'completed', output: [item], usage: { input_tokens: 20, output_tokens: 15 } } });
  response.end('data: [DONE]\n\n');
});

async function until(read, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (runtime && (runtime.exitCode !== null || runtime.signalCode !== null)) throw new Error(`Runtime exited before ${label}: ${runtimeLog}`);
    const result = await read();
    if (result) return result;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}

async function requestJSON(origin, route, method = 'GET', body) {
  const response = await fetch(new URL(route, origin), {
    method, headers: { 'Content-Type': 'application/json', Origin: new URL(origin).origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, 200, `${method} ${route} must reach the Runtime`);
  const result = await response.json();
  assert.notEqual(result.ok, false, `${method} ${route} must succeed`);
  return result.data ?? result;
}

function observe(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.text().includes('Failed to load runtime workbench layout')) errors.push(message.text());
  });
  return errors;
}

async function verifyReplies(page, name) {
  const surface = page.locator('.tessiven');
  const replies = page.locator('.tessiven-flower-output');
  await surface.getByRole('button', { name: 'Commerce / Example', exact: true }).click();
  await surface.locator('.tessiven-node').waitFor();
  const composer = surface.locator('.flower-composer textarea');
  await composer.waitFor();
  assert.equal(await surface.locator('.flower-composer-context-reference').count(), 0, 'Whole canvas context stays implicit');
  await composer.fill('Explain the storefront and database relationship.');
  await surface.getByRole('button', { name: 'Send', exact: true }).click();
  await until(async () => (await replies.innerText()).includes(reply), 'visible streamed Flower reply');
  await until(() => surface.locator('[data-flower-selected-thread-status="success"]').count(), 'canonical Flower completion');
  const title = replies.locator('[data-floe-floating-window-titlebar]');
  assert.equal(Math.round((await title.boundingBox()).height), 43, 'Replies use the approved compact chrome');
  await replies.getByRole('button', { name: 'Reply actions', exact: true }).click();
  const menu = page.getByRole('menu');
  const firstAction = menu.getByRole('menuitem', { name: 'New conversation', exact: true });
  await firstAction.waitFor();
  await firstAction.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await replies.getAttribute('data-floating-presence'), 'open', 'Escape dismisses the menu and keeps replies open');
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('html.dark').waitFor();
  await page.screenshot({ path: path.join(output, `${name.replace('light', 'dark')}.png`), animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('html:not(.dark)').waitFor();
  assert.equal(await surface.locator('.tessiven-error, .tessiven-notice').count(), 0, 'Canvas and update connection have no error');
  report.scenarios.push(name);
}

try {
  await mkdir(output, { recursive: true });
  const binary = path.join(temp, 'redeven');
  await copyFile(options.get('--binary'), binary);
  // Carry the already staged published plugin bundle. Runtime owns its validation.
  for (const name of ['redevplugin-runtime', '.redevplugin-release-artifacts-verified.json', 'REDEVPLUGIN_RUNTIME.spdx.json', 'REDEVPLUGIN_THIRD_PARTY_NOTICES.md', 'redevplugin-runtime.provenance.json', 'redevplugin-runtime.sig', 'redevplugin-runtime.pem']) {
    await copyFile(path.join(path.dirname(options.get('--binary')), name), path.join(temp, name));
  }
  const startupFile = path.join(temp, 'startup.json');
  runtime = spawn(binary, ['run', '--mode', 'local', '--state-root', path.join(temp, 'state'), '--local-ui-bind', '127.0.0.1:0', '--presentation', 'machine', '--startup-report-file', startupFile], {
    cwd: temp, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  runtime.stdout.on('data', chunk => { runtimeLog += chunk; });
  runtime.stderr.on('data', chunk => { runtimeLog += chunk; });
  const startup = await until(async () => {
    try { return JSON.parse(await readFile(startupFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  }, 'startup report');
  assert.equal(startup.status, 'ready');
  const origin = startup.local_ui_url;
  report.runtime = { pid: runtime.pid, origin, state: path.join(temp, 'state') };
  const initialLayout = await requestJSON(origin, '/_redeven_proxy/api/workbench/layout/snapshot');
  assert.equal(initialLayout.revision, 0);
  await until(async () => {
    const state = (await requestJSON(origin, '/api/local/runtime')).runtime_service.ai_readiness;
    assert.notEqual(state.state, 'blocked', 'Flower startup must not be blocked');
    return state.state === 'ready' || state.state === 'degraded';
  }, 'Flower startup maintenance');
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  await requestJSON(origin, '/_redeven_proxy/api/ai/provider_bundle', 'PUT', {
    model_profile: { current_model_id: 'fixture/gpt-5-mini', providers: [{ id: 'fixture', name: 'Local acceptance', type: 'openai', base_url: `http://127.0.0.1:${provider.address().port}/v1`, models: [{ model_name: 'gpt-5-mini', input_modalities: ['text', 'image'], context_window: 400000, max_output_tokens: 8192 }] }] },
    provider_api_key_patches: [{ provider_id: 'fixture', api_key: 'fixture-only' }], web_search_provider_key_patches: [],
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-US' });
  let browserLayoutRequests = 0;
  await context.route('**/_redeven_proxy/api/workbench/layout/snapshot', async route => {
    browserLayoutRequests++;
    if (browserLayoutRequests === 1) {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  const page = await context.newPage(), errors = observe(page);
  await page.goto(new URL('/_redeven_proxy/env/', origin).href);
  await page.getByRole('tab', { name: 'Workbench', exact: true }).waitFor();
  await until(async () => (await requestJSON(origin, '/_redeven_proxy/api/workbench/layout/snapshot')).revision > 0, 'Workbench initial layout persisted');
  await page.locator('[data-workbench-dock-action="tessiven"]').waitFor();
  assert.ok(browserLayoutRequests >= 2, 'Workbench retries a transient layout request failure');
  assert.equal(await page.locator('[data-workbench-layout-error]').count(), 0, 'Workbench must load without a layout error');
  await page.screenshot({ path: path.join(output, 'workbench.png'), animations: 'disabled' });
  await page.reload();
  await page.locator('[data-workbench-dock-action="tessiven"]').waitFor();
  assert.equal(await page.locator('[data-workbench-layout-error]').count(), 0, 'Saved layout must load after reload');
  report.scenarios.push('workbench-load-and-reload');

  const opened = context.waitForEvent('page');
  await page.locator('[data-workbench-dock-action="tessiven"]').click();
  const popup = await opened, popupErrors = observe(popup);
  await popup.waitForLoadState('domcontentloaded');
  await popup.locator('.tessiven-library-card').waitFor();
  assert.equal(new URL(popup.url()).searchParams.get('window'), 'service-canvas');
  assert.equal(await popup.locator('[data-floe-shell-slot], [data-workbench-dock-action]').count(), 0, 'Standalone canvas has no Env App shell');
  await verifyReplies(popup, 'standalone-replies-light');
  await popup.close();

  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  const activityBar = page.locator('[data-floe-shell-slot="activity-bar"]');
  await activityBar.waitFor();
  await activityBar.getByRole('button', { name: 'Tessiven service canvas', exact: true }).click();
  await page.locator('.tessiven-library-card').waitFor();
  assert.ok(await activityBar.isVisible(), 'Activity keeps its navigation rail');
  assert.equal(await activityBar.getByRole('button', { name: 'Tessiven service canvas', exact: true }).getAttribute('aria-pressed'), 'true');
  await verifyReplies(page, 'activity-replies-light');
  assert.deepEqual(errors, [], 'Full Env App has no uncaught or layout-load errors');
  assert.deepEqual(popupErrors, [], 'Standalone canvas has no uncaught errors');
  assert.ok(providerCalls >= 2, 'Both surfaces completed real Flower turns');
  report.provider_calls = providerCalls;
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack;
  if (browser) for (const context of browser.contexts()) for (const [index, page] of context.pages().entries()) {
    await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
    await writeFile(path.join(output, `failure-${index}-activity.json`), JSON.stringify(await page.locator('[data-floe-shell-slot="activity-bar"] button').evaluateAll(buttons => buttons.map(button => ({ label: button.getAttribute('aria-label'), text: button.textContent })))));
  }
  throw error;
} finally {
  await browser?.close();
  if (provider.listening) await new Promise(resolve => provider.close(resolve));
  if (runtime && runtime.exitCode === null && runtime.signalCode === null) {
    const exited = new Promise(resolve => runtime.once('exit', resolve));
    runtime.kill('SIGTERM');
    await exited;
  }
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await rm(temp, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
