#!/usr/bin/env node
// Qualify the built product through a fresh, real Runtime. Only model output is
// scripted; never attach this test to an existing browser or user environment.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert(['--binary', '--output', '--canvas-library'].includes(key) && value, 'Required: --binary <built Runtime bundle> --output <evidence directory> [--canvas-library <historical SQLite library>]');
  options.set(key, path.resolve(value));
}
assert(options.has('--binary') && options.has('--output'), 'Required: --binary <built Runtime bundle> --output <evidence directory>');
const root = path.resolve(import.meta.dirname, '../../../..');
const output = options.get('--output');
const temp = await mkdtemp(path.join(os.tmpdir(), 'redeven-canvas-acceptance-'));
const state = path.join(temp, 'state');
const libraryPath = path.join(state, 'local-environment/apps/tessiven/canvases.sqlite');
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), scenarios: [], question_geometry: [] };
let runtime, browser, runtimeLog = '', providerCalls = 0, questionNext = false;
const reply = 'The storefront calls Orders API, which reads the Orders database.';
const question = {
  id: 'next', header: 'Next Step', question: 'What would you like me to do with the selected service canvas?',
  response_mode: 'select_or_write', choices_exhaustive: false, is_secret: false, write_label: 'Describe your own request',
  choices: [
    { choice_id: 'explain', label: 'Walk me through the current architecture', description: 'Explain the layers, services, instances and key relationships of the saved canvas.', kind: 'select' },
    { choice_id: 'change', label: 'Change the canvas', description: 'Add, remove or reorganize nodes, services, instances or relations, saved as a new version.', kind: 'select' },
    { choice_id: 'history', label: 'Show version history', description: 'List saved versions and summarize what changed across them.', kind: 'select' },
    { choice_id: 'runtime', label: 'Map it to a real environment', description: 'Inspect an explicitly connected Runtime and record observed services instead of the conceptual reference.', kind: 'select' },
  ],
};
const provider = http.createServer(async (request, response) => {
  if (request.url === '/v1/models') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'gpt-5-mini' }] }));
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const input = JSON.parse(raw);
  providerCalls++;
  response.setHeader('Content-Type', 'text/event-stream');
  const send = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  if (questionNext && input.tools?.some(tool => tool.name === 'ask_user')) {
    questionNext = false;
    const item = { type: 'function_call', id: `question-${providerCalls}`, call_id: `call-${providerCalls}`, name: 'ask_user',
      arguments: JSON.stringify({ reason_code: 'missing_external_input', required_from_user: ['Choose the next canvas action.'], evidence_refs: ['message:latest'], questions: [question] }) };
    send({ type: 'response.output_item.added', output_index: 0, item });
    send({ type: 'response.output_item.done', output_index: 0, item });
    send({ type: 'response.completed', response: { id: `response-${providerCalls}`, status: 'completed', output: [item], usage: { input_tokens: 20, output_tokens: 15 } } });
    response.end('data: [DONE]\n\n');
    return;
  }
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
  const composer = replies.locator('.flower-composer textarea');
  await composer.waitFor();
  assert.equal(await replies.locator('.tessiven-flower-composer').count(), 1, 'Existing canvases put the composer inside the conversation window');
  assert.equal(await page.locator('.tessiven-flower-composer--initial').count(), 0, 'Existing canvases do not use the new-canvas composer placement');
  assert.equal(await page.locator('.flower-composer-context-reference').count(), 0, 'Whole canvas context stays implicit');
  const replyCount = (await replies.innerText()).split(reply).length;
  await composer.fill('Explain the storefront and database relationship.');
  await replies.getByRole('button', { name: 'Send', exact: true }).click();
  await until(async () => (await replies.innerText()).split(reply).length > replyCount, 'new visible streamed Flower reply');
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

async function verifyShortQuestion(page, name) {
  const replies = page.locator('.tessiven-flower-output');
  const viewport = page.viewportSize();
  questionNext = true;
  await replies.locator('.flower-composer textarea').fill('Help me choose the next canvas action.');
  await replies.getByRole('button', { name: 'Send', exact: true }).click();
  await replies.locator('.flower-input-request-questions').waitFor();
  for (const [width, height] of [[800, 320], [320, 320]]) {
    await page.setViewportSize({ width, height });
    await until(() => replies.evaluate(window => window.getBoundingClientRect().bottom <= window.ownerDocument.defaultView.innerHeight), 'short window boundary clamped');
    const geometry = await replies.evaluate(window => {
      const content = window.querySelector('[data-floe-floating-window-content]').getBoundingClientRect();
      const composer = window.querySelector('.flower-composer');
      const scroll = window.querySelector('.flower-input-request-questions');
      const actions = window.querySelector('.flower-input-request-actions');
      const view = window.ownerDocument.defaultView;
      const buttons = [...window.querySelectorAll('.flower-input-request-actions button')].map(button => {
        const rect = button.getBoundingClientRect();
        return { bottom: rect.bottom, right: rect.right, top: rect.top };
      });
      scroll.scrollTop = scroll.scrollHeight;
      return { bottom: content.bottom, right: content.right, top: content.top, buttons,
        border: window.ownerDocument.defaultView.getComputedStyle(composer).borderTopWidth, radius: parseFloat(window.ownerDocument.defaultView.getComputedStyle(composer).borderRadius),
        actionBorder: view.getComputedStyle(actions).borderTopWidth, mask: view.getComputedStyle(scroll).maskImage,
        scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, scrollTop: scroll.scrollTop };
    });
    assert.equal(geometry.border, '1px');
    assert.ok(geometry.radius >= 8);
    assert.equal(geometry.actionBorder, '0px');
    assert.ok(geometry.mask.includes('linear-gradient'));
    report.question_geometry.push({ name, width, height, ...geometry });
    assert.ok(geometry.clientHeight >= 24 && geometry.scrollHeight > geometry.clientHeight && geometry.scrollTop > 0, 'All question choices remain reachable by internal scrolling');
    for (const button of geometry.buttons) assert.ok(button.bottom <= geometry.bottom - 8 && button.right <= geometry.right - 8 && button.top >= geometry.top, 'Question controls stay inside the short window');
    await replies.locator('.flower-input-request-questions').evaluate(scroll => { scroll.scrollTop = 0; });
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.locator(mode === 'dark' ? 'html.dark' : 'html:not(.dark)').waitFor();
      await page.screenshot({ path: path.join(output, `${name}-short-question-${width}-${mode}.png`), animations: 'disabled' });
    }
    report.scenarios.push(`${name}-short-question-${width}`);
  }
  await replies.locator('.flower-input-request-questions').getByText('Map it to a real environment', { exact: true }).click();
  await replies.getByRole('button', { name: 'Continue', exact: true }).click();
  await until(() => replies.locator('.flower-composer textarea').count(), 'short question submitted and composer restored');
  await until(() => page.locator('.tessiven [data-flower-selected-thread-status="success"]').count(), 'short question continuation completed');
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('html:not(.dark)').waitFor();
}

async function verifyEmptyCanvas(page) {
  const surface = page.locator('.tessiven');
  await surface.getByRole('button', { name: 'Canvases', exact: true }).click();
  await surface.getByRole('button', { name: 'New canvas', exact: true }).click();
  const initialComposer = page.locator('.tessiven-flower-composer--initial');
  await initialComposer.waitFor();
  assert.equal(await page.locator('.tessiven-flower-output').count(), 0, 'An empty new canvas starts without a floating conversation window');
  const textarea = initialComposer.locator('.flower-composer textarea');
  await textarea.fill('Describe a small service architecture.');
  await initialComposer.getByRole('button', { name: 'Send', exact: true }).click();
  const replies = page.locator('.tessiven-flower-output');
  await replies.waitFor();
  assert.equal(await page.locator('.tessiven-flower-composer--initial').count(), 0, 'The initial composer moves into the conversation window after send');
  assert.equal(await replies.locator('.flower-composer textarea').count(), 1, 'The conversation window contains the canonical composer');
  await until(() => replies.getByText(reply, { exact: true }).count(), 'new-canvas Flower reply');
  await until(() => surface.locator('[data-flower-selected-thread-status="success"]').count(), 'new-canvas Flower completion');
  await page.screenshot({ path: path.join(output, 'activity-empty-canvas-chat-window.png'), animations: 'disabled' });
  report.scenarios.push('empty-canvas-composer-transitions-into-conversation-window');
}

function readLibraryRecords(db) {
  return {
    canvases: db.prepare('SELECT id,title,description,latest_version,archived,created_at,updated_at FROM canvases ORDER BY id').all(),
    versions: db.prepare('SELECT * FROM versions ORDER BY canvas_id,number').all(),
    requests: db.prepare('SELECT * FROM requests ORDER BY request_id').all(),
  };
}

async function stopRuntime() {
  if (runtime && runtime.exitCode === null && runtime.signalCode === null) {
    const exited = new Promise(resolve => runtime.once('exit', resolve));
    runtime.kill('SIGTERM');
    await exited;
  }
}

async function startRuntime(binary, startupFile) {
  await rm(startupFile, { force: true });
  runtime = spawn(binary, ['run', '--mode', 'local', '--state-root', state, '--local-ui-bind', '127.0.0.1:0', '--presentation', 'machine', '--startup-report-file', startupFile], {
    cwd: temp, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  runtime.stdout.on('data', chunk => { runtimeLog += chunk; });
  runtime.stderr.on('data', chunk => { runtimeLog += chunk; });
  const startup = await until(async () => {
    try { return JSON.parse(await readFile(startupFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  }, 'startup report');
  assert.equal(startup.status, 'ready');
  report.runtime = { pid: runtime.pid, origin: startup.local_ui_url, state };
  return startup;
}

try {
  await mkdir(output, { recursive: true });
  const binary = path.join(temp, 'redeven');
  await copyFile(options.get('--binary'), binary);
  // Carry the already staged published plugin bundle. Runtime owns its validation.
  for (const name of ['redevplugin-runtime', '.redevplugin-release-artifacts-verified.json', 'REDEVPLUGIN_RUNTIME.spdx.json', 'REDEVPLUGIN_THIRD_PARTY_NOTICES.md', 'redevplugin-runtime.provenance.json', 'redevplugin-runtime.sig', 'redevplugin-runtime.pem']) {
    await copyFile(path.join(path.dirname(options.get('--binary')), name), path.join(temp, name));
  }
  let originalRecords;
  if (options.has('--canvas-library')) {
    const source = new DatabaseSync(options.get('--canvas-library'), { readOnly: true });
    try {
      assert.equal(source.prepare('PRAGMA user_version').get().user_version, 1, 'Historical qualification starts from v1');
      originalRecords = readLibraryRecords(source);
      await mkdir(path.dirname(libraryPath), { recursive: true });
      await backup(source, libraryPath);
    } finally {
      source.close();
    }
  }
  const startupFile = path.join(temp, 'startup.json');
  let startup = await startRuntime(binary, startupFile);
  if (originalRecords) {
    const verifyMigration = () => {
      const db = new DatabaseSync(libraryPath, { readOnly: true });
      try {
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
        assert.deepEqual(readLibraryRecords(db), originalRecords, 'Upgrade preserves all canvas, version, and request records');
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM canvases WHERE flower_thread_id <> ''").get().count, 0);
      } finally {
        db.close();
      }
    };
    verifyMigration();
    await stopRuntime();
    startup = await startRuntime(binary, startupFile);
    verifyMigration();
    report.migration = { from: 1, to: 2, canvases: originalRecords.canvases.length, versions: originalRecords.versions.length, requests: originalRecords.requests.length };
    report.scenarios.push('historical-library-upgrade-and-runtime-restart');
  }
  const origin = startup.local_ui_url;
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
  await popup.locator('.tessiven-library-card').first().waitFor();
  assert.equal(new URL(popup.url()).searchParams.get('window'), 'service-canvas');
  assert.equal(await popup.locator('[data-floe-shell-slot], [data-workbench-dock-action]').count(), 0, 'Standalone canvas has no Env App shell');
  await verifyReplies(popup, 'standalone-replies-light');
  await verifyShortQuestion(popup, 'standalone');
  await popup.close();

  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  const activityBar = page.locator('[data-floe-shell-slot="activity-bar"]');
  await activityBar.waitFor();
  await activityBar.getByRole('button', { name: 'Tessiven service canvas', exact: true }).click();
  await page.locator('.tessiven-library-card').first().waitFor();
  assert.ok(await activityBar.isVisible(), 'Activity keeps its navigation rail');
  assert.equal(await activityBar.getByRole('button', { name: 'Tessiven service canvas', exact: true }).getAttribute('aria-pressed'), 'true');
  await verifyReplies(page, 'activity-replies-light');
  await verifyShortQuestion(page, 'activity');
  await verifyEmptyCanvas(page);
  if (originalRecords) {
    const surface = page.locator('.tessiven');
    for (const canvas of originalRecords.canvases.filter(canvas => !canvas.archived)) {
      await surface.getByRole('button', { name: 'Canvases', exact: true }).click();
      await surface.getByRole('button', { name: canvas.title, exact: true }).click();
      await surface.locator('.tessiven-node').first().waitFor();
      assert.equal(await surface.locator('.tessiven-error, .tessiven-notice').count(), 0, 'Migrated canvas renders without an error');
      await page.screenshot({ path: path.join(output, `migrated-canvas-${canvas.id}.png`), animations: 'disabled' });
    }
    report.scenarios.push('all-migrated-active-canvases-render');
  }
  assert.deepEqual(errors, [], 'Full Env App has no uncaught or layout-load errors');
  assert.deepEqual(popupErrors, [], 'Standalone canvas has no uncaught errors');
  assert.ok(providerCalls >= 3, 'Both surfaces and the empty-canvas transition completed Flower turns');
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
  await stopRuntime();
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(output, 'runtime.log'), runtimeLog);
  await rm(temp, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
