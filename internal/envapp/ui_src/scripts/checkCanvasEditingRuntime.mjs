#!/usr/bin/env node
/* global window, document, innerHeight */
// Test a built canvas window against a fresh Runtime with a deliberately paused
// provider. Streaming assertions run before the provider is allowed to finish.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, _electron } from 'playwright';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const legacyDSL = process.argv.includes('--legacy-dsl');
const [binary, output, providerType = 'openai', desktopBundle] = process.argv.slice(2).filter(argument => argument !== '--legacy-dsl');
assert(binary && output, 'Usage: checkCanvasEditingRuntime.mjs <Runtime bundle binary> <evidence directory> [openai|deepseek] [Desktop bundle] [--legacy-dsl]');
assert(['openai', 'deepseek'].includes(providerType), 'Unknown fixture provider');
const modelName = providerType === 'deepseek' ? 'deepseek-v4-flash' : 'gpt-5-mini';
const initialTitle = 'Commerce / Example', updatedTitle = 'Commerce / Updated';
const root = path.resolve(import.meta.dirname, '../../../..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'redeven-canvas-editing-'));
const state = path.join(temp, 'state');
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), scenarios: [] };
let app, welcome, runtime, browser, page, runtimeLog = '', canvasID, origin, providerError;
let finishChunk = () => {};
let calls = 0;
let finalReplyPending = false;
const toolResults = new Map();
async function until(read, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (providerError) throw providerError;
    if (runtime?.exitCode !== null && runtime?.exitCode !== undefined) throw new Error(runtimeLog);
    const result = await read(); if (result) return result;
    await delay(40);
  }
  throw new Error(`Timed out: ${label}`);
}
async function api(route, method = 'GET', body) {
  if (welcome) {
    const result = await welcome.evaluate(request => window.redevenDesktopSettings.requestRuntimeFlower(request), { method, path: route, ...(body ? { body } : {}) });
    assert(result.ok, JSON.stringify(result)); return result.data;
  }
  const response = await fetch(new URL(route, origin), { method, headers: { 'Content-Type': 'application/json', Origin: new URL(origin).origin }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, 200, route);
  const data = await response.json(); assert.notEqual(data.ok, false, JSON.stringify(data)); return data.data ?? data;
}
async function startRuntime(staged) {
  const startup = path.join(temp, 'startup.json');
  await rm(startup, { force: true });
  runtime = spawn(staged, ['run', '--mode', 'local', '--state-root', state, '--local-ui-bind', '127.0.0.1:0', '--presentation', 'machine', '--startup-report-file', startup], { cwd: temp, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
  runtime.stdout.on('data', chunk => { runtimeLog += chunk; }); runtime.stderr.on('data', chunk => { runtimeLog += chunk; });
  origin = (await until(async () => { try { return JSON.parse(await readFile(startup, 'utf8')); } catch { return null; } }, 'Runtime readiness', 60000)).local_ui_url;
  report.runtime ??= { pid: runtime.pid, origin, state };
  report.runtime.starts ??= []; report.runtime.starts.push({ pid: runtime.pid, origin });
  await until(async () => ['ready', 'degraded'].includes((await api('/api/local/runtime')).runtime_service.ai_readiness.state), 'Flower readiness', 60000);
}
const provider = http.createServer(async (request, response) => {
  try {
    if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'gpt-5-mini' }] })); return; }
    let raw = ''; for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw);
    // Title requests do not use the model tool surface.
    const toolTurn = input.tools?.some(tool => tool.name === 'tessiven_save');
    const send = event => response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.setHeader('Content-Type', 'text/event-stream');
    const complete = (item, extra = []) => {
      send({ type: 'response.output_item.done', output_index: 0, item });
      send({ type: 'response.completed', response: { id: 'response', status: 'completed', output: [...extra, item], usage: { input_tokens: 30, output_tokens: 20 } } });
      response.end('data: [DONE]\n\n');
    };
    if (!toolTurn) {
      const item = { id: 'title', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Canvas editing' }] };
      send({ type: 'response.output_text.delta', item_id: 'title', output_index: 0, content_index: 0, delta: 'Canvas editing' }); complete(item); return;
    }
    for (const item of input.input ?? []) if (item.type === 'function_call_output') toolResults.set(item.call_id, item.output);
    calls++;
    if (calls === 1) {
      const extra = [];
      if (providerType === 'deepseek') {
        let reasoning = '';
        for (const delta of ['Inspecting the current canvas. ', 'Finding the exact fragment to preserve all other nodes.']) {
          send({ type: 'response.reasoning_text.delta', item_id: 'reasoning', delta });
          reasoning += delta;
          await new Promise(resolve => { finishChunk = resolve; });
        }
        extra.push({ type: 'reasoning', id: 'reasoning', content: [{ type: 'reasoning_text', text: reasoning }] });
      }
      const item = { id: 'live-reply', type: 'message', role: 'assistant', content: [] };
      send({ type: 'response.output_item.added', output_index: 0, item });
      let text = '';
      for (const delta of ['Reading the current canvas', ' and preserving its services', ' while updating only the title.']) {
        send({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta });
        text += delta;
        await new Promise(resolve => { finishChunk = resolve; });
      }
      complete({ ...item, content: [{ type: 'output_text', text }] }, extra); return;
    }
    const actions = [
      ['read', 'tessiven_read', { canvas_id: canvasID, start_line: 1, line_count: 10 }],
      ['edit', 'tessiven_edit', { canvas_id: canvasID, expected_version: 1, request_id: 'runtime-title-edit', summary: 'Rename the canvas', edits: [{ old_string: initialTitle, new_string: updatedTitle }] }],
      ['terminal', 'terminal_exec', { command: "printf 'Canvas verification complete\\n'", description: 'Verify the saved change' }],
    ];
    const action = actions[calls - 2];
    if (action) {
      const [id, name, args] = action; assert(input.tools.some(tool => tool.name === name), `${name} is exposed`);
      const item = { type: 'function_call', id, call_id: id, name, arguments: JSON.stringify(args) };
      send({ type: 'response.output_item.added', output_index: 0, item }); complete(item); return;
    }
    const item = { type: 'message', id: 'final', role: 'assistant', content: [{ type: 'output_text', text: 'The title is updated.' }] };
    send({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'The title is updated.' });
    finalReplyPending = true;
    await new Promise(resolve => { finishChunk = resolve; });
    complete(item);
  } catch (error) { providerError = error; response.destroy(); }
});
try {
  await mkdir(output, { recursive: true });
  if (legacyDSL) {
    // Seed only this run's isolated library, using the frozen distributed formats.
    const source = await readFile(path.join(root, 'internal/tessiven/testdata/dsl_v1.yaml'), 'utf8');
    const library = path.join(state, 'local-environment/apps/tessiven/canvases.sqlite');
    await mkdir(path.dirname(library), { recursive: true });
    const db = new DatabaseSync(library);
    try {
      db.exec(await readFile(path.join(root, 'internal/tessiven/testdata/schema_v1.sql'), 'utf8'));
      db.prepare('INSERT INTO canvases VALUES(?,?,?,1,0,100,100)').run('legacy-canvas', initialTitle, '');
      db.prepare('INSERT INTO versions VALUES(?,1,?,?,100,?,?)').run('legacy-canvas', source, createHash('sha256').update(source).digest('hex'), 'import', 'Legacy DSL fixture');
    } finally { db.close(); }
  }
  if (desktopBundle) {
    const require = createRequire(path.join(root, 'desktop/package.json'));
    const manifest = JSON.parse(await readFile(path.join(desktopBundle, 'desktop-bundle-manifest.json'), 'utf8'));
    await require(path.join(root, 'desktop/dist/main/desktopBundle.js')).loadDesktopBundle({
      root: desktopBundle, expectedPlatform: 'darwin', expectedArchitecture: 'arm64',
      expectedVersion: manifest.version, expectedCommit: report.commit,
    });
    app = await _electron.launch({ executablePath: require('electron'), cwd: temp,
      args: [path.join(root, 'desktop'), `--user-data-dir=${temp}/profile`, `--redeven-test-launch-id=${path.basename(temp)}`],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_STATE_ROOT: state,
        REDEVEN_DESKTOP_USER_DATA_ROOT: `${temp}/profile`, REDEVEN_DESKTOP_CACHE_ROOT: `${temp}/cache`, REDEVEN_DESKTOP_TEMP_ROOT: `${temp}/temp`,
        REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1', REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0', REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
        REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: desktopBundle, REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version, REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit } });
    welcome = await app.firstWindow();
    await welcome.waitForFunction(() => Boolean(window.redevenDesktopSettings && window.redevenDesktopLanguage));
    await welcome.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
    await until(async () => {
      const result = await welcome.evaluate(() => window.redevenDesktopSettings.requestRuntimeFlower({ method: 'GET', path: '/_redeven_proxy/api/ai/threads' }));
      return result.ok;
    }, 'Desktop Flower readiness', 60000);
    report.runtime = { desktop_pid: app.process().pid, state, bundle: desktopBundle, commit: manifest.commit };
  } else {
    const staged = path.join(temp, 'redeven'); await copyFile(binary, staged);
    for (const name of ['redevplugin-runtime', '.redevplugin-release-artifacts-verified.json', 'REDEVPLUGIN_RUNTIME.spdx.json', 'REDEVPLUGIN_THIRD_PARTY_NOTICES.md', 'redevplugin-runtime.provenance.json', 'redevplugin-runtime.sig', 'redevplugin-runtime.pem']) await copyFile(path.join(path.dirname(binary), name), path.join(temp, name));
    await startRuntime(staged);
  }
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  await api('/_redeven_proxy/api/ai/provider_bundle', 'PUT', { model_profile: { current_model_id: `fixture/${modelName}`, providers: [{ id: 'fixture', name: 'Acceptance', type: providerType, base_url: `http://127.0.0.1:${provider.address().port}/v1`, models: [{ model_name: modelName, input_modalities: ['text'], context_window: 400000, max_output_tokens: 8192 }] }] }, provider_api_key_patches: [{ provider_id: 'fixture', api_key: 'fixture-only' }], web_search_provider_key_patches: [] });
  // Exercise a populated canvas, including group geometry and the refresh after an edit.
  canvasID = (await api('/_redeven_proxy/api/tessiven/canvases')).canvases.find(canvas => canvas.title === initialTitle).id;
  const original = await api(`/_redeven_proxy/api/tessiven/canvases/${canvasID}/versions/latest`);
  assert(original.document.nodes.length && original.document.groups.length && original.document.relations.length);
  assert.equal(original.document.apiVersion, 'redeven.io/tessiven/v1.0.0');
  assert.equal(original.dsl_version, legacyDSL ? 'v1' : 'v1.0.0');
  const currentSchema = await api('/_redeven_proxy/api/tessiven/schema');
  const legacySchema = await api('/_redeven_proxy/api/tessiven/schema?version=v1');
  assert.equal(currentSchema.properties.apiVersion.const, 'redeven.io/tessiven/v1.0.0');
  assert.equal(legacySchema.properties.apiVersion.const, 'redeven.io/tessiven/v1');
  if (legacyDSL) assert.deepEqual(original.migrations, [{ from: 'v1', to: 'v1.0.0' }]);
  report.scenarios.push(legacyDSL ? 'legacy-schema-projected-at-startup' : 'current-semver-schema-at-startup');
  const errors = [];
  if (welcome) {
    page = welcome;
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: 'Tessiven', exact: true }).click();
    await page.getByRole('button', { name: initialTitle, exact: true }).click();
  } else {
    browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL(`/_redeven_proxy/env/?surface=tessiven&window=service-canvas&canvas=${canvasID}`, origin).href);
  }
  const editor = page.locator('.flower-composer textarea'); await editor.fill('Explain the canvas'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  if (providerType === 'deepseek') {
    for (const delta of ['Inspecting the current canvas.', 'Finding the exact fragment to preserve all other nodes.']) {
      await until(async () => (await page.locator('.flower-thinking-content').innerText()).includes(delta), 'visible streaming reasoning');
      assert(await page.locator('[data-flower-selected-thread-status="running"]').count());
      assert(await page.locator('.flower-thinking-content').isVisible());
      await page.screenshot({ path: path.join(output, `reasoning-${report.scenarios.length}.png`) });
      report.scenarios.push('reasoning-before-provider-completion'); finishChunk();
    }
  }
  let text = '';
  for (const delta of ['Reading the current canvas', ' and preserving its services', ' while updating only the title.']) {
    text += delta;
    await until(async () => (await page.locator('.tessiven-flower-output').innerText()).includes(text), `live chunk: ${delta}`);
    assert(await page.locator('[data-flower-selected-thread-status="running"]').count(), 'Turn remains active during visible output');
    await page.screenshot({ path: path.join(output, `stream-${report.scenarios.length}.png`), animations: 'disabled' });
    report.scenarios.push('visible-before-provider-completion'); finishChunk();
  }
  await until(() => page.locator('[data-flower-selected-thread-status="success"]').count(), 'first turn completed');
  await editor.fill('Rename the canvas'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await until(async () => {
    const approve = page.locator('.flower-approval-decision-approve:not([disabled])').first();
    if (await approve.count() && await approve.isVisible()) await approve.click();
    if (finalReplyPending && (await page.locator('.tessiven-flower-output').innerText()).includes('The title is updated.')) {
      assert(await page.locator('[data-flower-selected-thread-status="running"]').count());
      assert(await page.locator('[data-flower-activity-item-id]').filter({ hasText: 'Edit canvas' }).count());
      report.scenarios.push('tool-records-before-turn-completion');
      await page.screenshot({ path: path.join(output, 'tools-live.png') });
      finalReplyPending = false; finishChunk();
    }
    return await page.locator('[data-flower-selected-thread-status="success"]').count() && toolResults.has('terminal')
      && (await page.locator('.tessiven-flower-output').innerText()).includes('The title is updated.');
  }, 'edit completed', 20000);
  report.tool_statuses = Object.fromEntries([...toolResults].map(([id, result]) => [id, JSON.parse(result.replace(/^ERROR: /, '')).status]));
  for (const id of ['read', 'edit']) assert.equal(JSON.parse(toolResults.get(id).replace(/^ERROR: /, '')).status, 'success', id);
  assert.equal((await api('/_redeven_proxy/api/tessiven/canvases')).canvases.find(canvas => canvas.id === canvasID).title, updatedTitle);
  const saved = await api(`/_redeven_proxy/api/tessiven/canvases/${canvasID}/versions/latest`);
  assert.equal(saved.document_yaml, original.document_yaml.replace(initialTitle, updatedTitle).replace('apiVersion: redeven.io/tessiven/v1\n', 'apiVersion: redeven.io/tessiven/v1.0.0\n'));
  assert.equal(saved.dsl_version, 'v1.0.0');
  assert.equal(saved.document.apiVersion, 'redeven.io/tessiven/v1.0.0');
  const history = await api(`/_redeven_proxy/api/tessiven/canvases/${canvasID}/versions/1`);
  assert.equal(history.document_yaml, original.document_yaml);
  assert.equal(history.digest, original.digest);
  assert.equal(history.document.apiVersion, 'redeven.io/tessiven/v1.0.0');
  report.scenarios.push('current-snapshot-after-exact-edit', 'immutable-original-yaml-and-digest');
  await page.getByRole('heading', { name: updatedTitle, exact: true }).waitFor();
  const row = page.locator('[data-flower-activity-item-id]').filter({ hasText: 'Read canvas' }).first();
  await row.locator('button[aria-expanded]').first().click();
  await until(async () => (await row.innerText()).includes('apiVersion: redeven.io/tessiven/v1'), 'literal YAML read result');
  await row.locator('pre').first().waitFor({ state: 'visible' });
  assert(!(await page.locator('.tessiven-flower-output').innerText()).includes('local_runtime'));
  await page.screenshot({ path: path.join(output, 'editing.png'), animations: 'disabled' });
  await row.locator('button[aria-expanded]').first().click();
  const editRow = page.locator('[data-flower-activity-item-id]').filter({ hasText: 'Edit canvas' }).first();
  await editRow.locator('button[aria-expanded]').first().click();
  await editRow.locator('.flower-activity-script-toggle').click();
  await editRow.locator('pre').first().waitFor({ state: 'visible' });
  assert((await editRow.innerText()).includes(`-${initialTitle}`));
  assert((await editRow.innerText()).includes(`+${updatedTitle}`));
  await page.screenshot({ path: path.join(output, 'edit-fragments.png'), animations: 'disabled' });
  if (app) {
    await welcome.evaluate(() => window.redevenDesktopTheme.setSource('dark'));
    await page.waitForFunction(() => document.documentElement.classList.contains('dark') && !document.documentElement.dataset.redevenThemeSwitching);
    await page.screenshot({ path: path.join(output, 'edit-fragments-dark.png'), animations: 'disabled' });
    await app.evaluate(({ BrowserWindow }, url) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
      window.setMinimumSize(600, 320); window.setContentSize(900, 420);
    }, page.url());
    await page.waitForFunction(() => innerHeight <= 420);
    await page.screenshot({ path: path.join(output, 'edit-fragments-short.png'), animations: 'disabled' });
    assert(await page.locator('.flower-composer textarea').isVisible());
    const composer = await page.locator('.flower-composer').boundingBox();
    const viewportHeight = await page.evaluate(() => innerHeight);
    assert(composer.y >= 0 && composer.y + composer.height <= viewportHeight, 'Short window keeps the complete composer in view');
    report.scenarios.push('short-window-composer-visible');
  }
  await page.reload();
  if (welcome) {
    // Desktop reload restores Welcome; re-enter through its normal navigation.
    await page.getByRole('button', { name: 'Tessiven', exact: true }).click();
    await page.getByRole('button', { name: updatedTitle, exact: true }).click();
  }
  await page.getByRole('heading', { name: updatedTitle, exact: true }).waitFor();
  await until(() => page.locator('[data-node-id]').count(), 'Reload preserves rendered placements');
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'dsl-reopened.png'), animations: 'disabled' });
  report.scenarios.push('reload-and-reenter-current-canvas');
  if (runtime) {
    await browser.close(); browser = undefined;
    const stopped = new Promise(resolve => runtime.once('exit', resolve));
    runtime.kill('SIGTERM'); await stopped;
    await startRuntime(path.join(temp, 'redeven'));
    const restarted = await api(`/_redeven_proxy/api/tessiven/canvases/${canvasID}/versions/latest`);
    assert.equal(restarted.document_yaml, saved.document_yaml);
    assert.equal(restarted.digest, saved.digest);
    assert.equal(restarted.document.apiVersion, 'redeven.io/tessiven/v1.0.0');
    const originalAfterRestart = await api(`/_redeven_proxy/api/tessiven/canvases/${canvasID}/versions/1`);
    assert.equal(originalAfterRestart.document_yaml, original.document_yaml);
    assert.equal(originalAfterRestart.digest, original.digest);
    browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL(`/_redeven_proxy/env/?surface=tessiven&window=service-canvas&canvas=${canvasID}`, origin).href);
    await page.getByRole('heading', { name: updatedTitle, exact: true }).waitFor();
    await until(() => page.locator('[data-node-id]').count(), 'Restart preserves rendered placements');
    await page.screenshot({ path: path.join(output, 'dsl-after-restart.png'), animations: 'disabled' });
    report.scenarios.push('runtime-restart-preserves-current-and-legacy-history');
  }
  assert.deepEqual(errors, []); report.scenarios.push('bounded-read', 'exact-edit', 'visible-tool-details', 'no-local-runtime-suffix'); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }); await writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText()); }
} finally {
  finishChunk(); await browser?.close();
  if (app) {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await app.close();
    const inventory = JSON.parse(execFileSync(binary, ['desktop-target-process-inventory', '--target-root', state], { encoding: 'utf8' }));
    const stopped = JSON.parse(execFileSync(binary, ['desktop-target-process-stop', '--target-root', state, '--expected-inventory-digest', inventory.inventory_digest], { encoding: 'utf8' }));
    assert.deepEqual(stopped.after.instances, []);
  }
  if (runtime && runtime.exitCode === null) { runtime.kill('SIGTERM'); await new Promise(resolve => runtime.once('exit', resolve)); }
  provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  await writeFile(path.join(output, 'runtime.log'), runtimeLog); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await rm(temp, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
