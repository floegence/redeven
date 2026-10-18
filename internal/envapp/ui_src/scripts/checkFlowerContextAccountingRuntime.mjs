#!/usr/bin/env node
/* global document */
// Qualify context accounting through a task-owned production Runtime and UI.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], path.resolve(process.argv[i + 1]));
assert(args.has('--binary') && args.has('--output'), 'Required: --binary <bundled executable> --output <fresh evidence directory>');
const binary = args.get('--binary'), output = args.get('--output');
const root = path.resolve(import.meta.dirname, '../../../..');
const state = path.join(output, 'state'), workspace = path.join(output, 'workspace'), startup = path.join(output, 'startup.json');
const report = { passed: false, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  source_dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  runtime_sha256: createHash('sha256').update(await readFile(binary)).digest('hex'), runtimes: [], requests: [], scenarios: [] };
let runtime, browser, canvas, origin, log = '', release, waiting = false;
let failedOnce = false;
const provider = http.createServer(async (request, response) => {
  try {
    if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'gpt-5-mini' }] })); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    const main = input.tools?.length > 0;
    const latest = JSON.stringify([...(input.input ?? [])].reverse().find(item => item.role === 'user' && JSON.stringify(item).includes('QUALIFY_')) ?? {});
    const index = report.requests.length + 1;
    report.requests.push({ index, main, latest: latest.slice(0, 160) });
    if (main && latest.includes('QUALIFY_FAIL') && !failedOnce) {
      failedOnce = true; response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Qualification authentication failure', type: 'authentication_error', code: 'invalid_api_key' } })); return;
    }
    response.setHeader('Content-Type', 'text/event-stream');
    const event = value => response.write('data: ' + JSON.stringify(value) + '\n\n');
    if (main && latest.includes('QUALIFY_PAUSE')) {
      event({ type: 'response.reasoning_summary_text.delta', delta: 'Waiting for the accounting qualification.' });
      waiting = true;
      await new Promise(resolve => { release = resolve; response.once('close', resolve); });
      waiting = false;
      if (response.destroyed) return;
    }
    const item = { type: 'message', id: 'message-' + index, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ACK', annotations: [] }] };
    event({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
    event({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: 'ACK' });
    event({ type: 'response.output_item.done', output_index: 0, item });
    event({ type: 'response.completed', response: { id: 'accounting-' + index, status: 'completed', output: [item], ...(main && latest.includes('QUALIFY_MISSING') ? {} : { usage: { input_tokens: main ? 90000 : 100, input_tokens_details: { cached_tokens: main ? 18000 : 0 }, output_tokens: 40, output_tokens_details: { reasoning_tokens: 20 }, total_tokens: main ? 90040 : 140 } }) } });
    response.end('data: [DONE]\n\n');
  } catch (error) { report.provider_error = error.stack; if (!response.headersSent) response.writeHead(500); response.end(); }
});
async function until(read, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    assert(!runtime || (runtime.exitCode === null && runtime.signalCode === null), 'Runtime exited: ' + log);
    assert(!report.provider_error, report.provider_error);
    const value = await read(); if (value) return value; await delay(50);
  }
  throw new Error('Timed out: ' + label);
}
async function api(route, method = 'GET', body) {
  const response = await fetch(new URL(route, origin), { method, headers: { 'Content-Type': 'application/json', Origin: new URL(origin).origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert([200, 202].includes(response.status) && result.ok !== false, method + ' ' + route + ': ' + JSON.stringify(result));
  return result.data ?? result;
}
async function start() {
  await rm(startup, { force: true });
  runtime = spawn(binary, ['run', '--mode', 'local', '--state-root', state, '--local-ui-bind', '127.0.0.1:0', '--presentation', 'machine', '--startup-report-file', startup], { cwd: workspace, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
  runtime.stdout.on('data', bytes => { log += bytes; }); runtime.stderr.on('data', bytes => { log += bytes; });
  const ready = await until(async () => { try { return JSON.parse(await readFile(startup, 'utf8')); } catch { return null; } }, 'startup');
  assert.equal(ready.status, 'ready'); origin = ready.local_ui_url; report.runtimes.push({ pid: runtime.pid, origin, state });
  await until(async () => ['ready', 'degraded'].includes((await api('/api/local/runtime')).runtime_service.ai_readiness.state), 'AI readiness');
}
async function stop() {
  release?.();
  if (!runtime || runtime.exitCode !== null || runtime.signalCode !== null) return;
  const exited = new Promise(resolve => runtime.once('exit', resolve));
  runtime.kill('SIGTERM');
  let timeout;
  try { await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(() => { runtime.kill('SIGKILL'); resolve(); }, 5000); })]); }
  finally { clearTimeout(timeout); }
  await exited;
}
try {
  await mkdir(output, { recursive: true }); await mkdir(workspace, { recursive: true });
  assert(!await readFile(startup).then(() => true, () => false), 'Use a fresh evidence directory');
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  await start(); await stop();
  const configFile = path.join(state, 'local-environment/config.json');
  const config = JSON.parse(await readFile(configFile, 'utf8')); config.agent_home_dir = workspace; await writeFile(configFile, JSON.stringify(config));
  await start();
  await api('/_redeven_proxy/api/ai/provider_bundle', 'PUT', { model_profile: { current_model_id: 'fixture/gpt-5-mini', providers: [{ id: 'fixture', name: 'Qualification only', type: 'openai', base_url: 'http://127.0.0.1:' + provider.address().port + '/v1', models: [{ model_name: 'gpt-5-mini', input_modalities: ['text'], context_window: 2000000, max_output_tokens: 8192 }] }] }, provider_api_key_patches: [{ provider_id: 'fixture', api_key: 'qualification-only' }], web_search_provider_key_patches: [] });
  report.readiness = await api('/_redeven_proxy/api/ai/readiness');
  const models = await api('/_redeven_proxy/api/ai/models?mode=baseline'); report.model = models.models.find(model => model.id === 'fixture/gpt-5-mini');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-US' });
  const page = await context.newPage(); await page.goto(new URL('/_redeven_proxy/env/', origin).href);
  await page.locator('[data-workbench-dock-action="tessiven"]').waitFor();
  const opened = context.waitForEvent('page'); await page.locator('[data-workbench-dock-action="tessiven"]').click();
  canvas = await opened;
  canvas.on('console', message => { if (message.type() === 'error') (report.browser_errors ??= []).push(message.text()); });
  canvas.on('request', request => { if (request.url().includes('/ai/')) (report.browser_requests ??= []).push({ method: request.method(), url: request.url() }); });
  await canvas.locator('.tessiven-library-card').first().waitFor();
  await canvas.getByRole('button', { name: 'Commerce / Example', exact: true }).click();
  const composer = canvas.locator('.tessiven-flower-output .flower-composer textarea'); await composer.waitFor();
  const admission = canvas.waitForResponse(r => r.request().method() === 'POST' && /\/ai\/(?:threads\/[^/]+\/)?turns$/.test(new URL(r.url()).pathname));
  await composer.fill('QUALIFY_INITIAL: reply ACK.'); await canvas.screenshot({ path: path.join(output, 'before-send.png') });
  await canvas.locator('.tessiven-flower-output .flower-composer').getByRole('button', { name: 'Send', exact: true }).click();
  const receipt = (await (await admission).json()).data, id = receipt.thread_id; assert(id); report.thread_id = id;
  const route = '/_redeven_proxy/api/ai/threads/' + id;
  const detail = await until(async () => { const d = await api(route); return d.current.activity === 'idle' && d.current.last_outcome === 'completed' ? d : null; }, 'first confirmed request');
  const usage = detail.context_usage ?? detail.thread.context_usage; assert(usage, JSON.stringify(detail).slice(0, 600));
  const sample = usage.confirmed; assert(sample?.available && sample.measured && sample.breakdown_available, JSON.stringify(usage));
  assert.equal(sample.input_tokens, 90000); assert(sample.unattributed_tokens > 0);
  assert.equal(usage.recent_request_usage.cache_read_tokens, 18000);
  report.confirmed = sample;
  const trigger = canvas.locator('.tessiven-flower-output .flower-composer-context-progress');
  const panel = canvas.locator('.flower-composer-context-tooltip[data-open=true]');
  const openPanel = async () => {
    const bounds = await trigger.boundingBox(); assert(bounds);
    await canvas.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await panel.waitFor();
    await panel.locator('.flower-context-total').click();
    await until(() => panel.evaluate(element => element === document.activeElement), 'mouse activation focus');
  };
  await openPanel();
  assert((await panel.locator('.flower-context-total').innerText()).includes('= 90k'));
  assert((await panel.locator('[data-category="unattributed_usage"]').innerText()).includes('≈'));
  assert.equal(await panel.locator('.flower-context-cache-stats strong').first().innerText(), '20%');
  const categories = await panel.locator('.flower-context-categories').innerText();
  await until(() => panel.evaluate(element => element === document.activeElement), 'mouse activation focus');
  await canvas.screenshot({ path: path.join(output, 'confirmed.png') });
  await canvas.keyboard.press('Escape'); await until(() => trigger.evaluate(element => element === document.activeElement), 'focus return');
  const second = canvas.waitForResponse(r => r.request().method() === 'POST' && /\/ai\/(?:threads\/[^/]+\/)?turns$/.test(new URL(r.url()).pathname));
  await composer.fill('QUALIFY_PAUSE: hold this next request.');
  await canvas.locator('.tessiven-flower-output .flower-composer').getByRole('button', { name: 'Send', exact: true }).click();
  await second; await until(() => waiting, 'next provider request');
  await openPanel();
  assert((await panel.locator('.flower-context-total').innerText()).includes('= 90k'));
  assert.equal(await panel.locator('.flower-context-categories').innerText(), categories);
  assert.equal(await panel.locator('.flower-context-cache-stats strong').first().innerText(), '20%');
  const during = await api(route); assert.equal((during.context_usage ?? during.thread.context_usage).confirmed.request_id, sample.request_id);
  report.scenarios.push('confirmed-total-categories-and-cache-stay-on-one-request-during-next-estimate');
  await canvas.keyboard.press('Escape');
  const stopButton = canvas.locator('.tessiven-flower-output .flower-composer-stop');
  if (await stopButton.count()) await stopButton.click();
  else await canvas.locator('.tessiven-flower-output').getByRole('button', { name: /stop/i }).click();
  const stopped = await until(async () => { const d = await api(route); return d.current.activity === 'idle' ? d : null; }, 'stopped request');
  assert.equal((stopped.context_usage ?? stopped.thread.context_usage).confirmed.request_id, sample.request_id);
  report.scenarios.push('stop-retains-valid-confirmed-sample-and-releases-composer');
  const send = async text => {
    const admitted = canvas.waitForResponse(r => r.request().method() === 'POST' && /\/ai\/(?:threads\/[^/]+\/)?turns$/.test(new URL(r.url()).pathname));
    await composer.fill(text);
    await canvas.locator('.tessiven-flower-output .flower-composer').getByRole('button', { name: 'Send', exact: true }).click();
    const receipt = (await (await admitted).json()).data;
    return receipt.current.turn_id;
  };
  const missingTurn = await send('QUALIFY_MISSING: complete without usage.');
  const missing = await until(async () => { const d = await api(route); return d.current.turn_id === missingTurn && d.current.activity === 'idle' && d.current.last_outcome === 'completed' ? d : null; }, 'missing-usage completion');
  assert.equal((missing.context_usage ?? missing.thread.context_usage).confirmed.request_id, sample.request_id);
  const failedTurn = await send('QUALIFY_FAIL: fail once then recover when retried.');
  const failed = await until(async () => { const d = await api(route); return d.current.turn_id === failedTurn && d.current.activity === 'idle' && d.current.last_outcome === 'failed' ? d : null; }, 'failed request');
  assert.equal((failed.context_usage ?? failed.thread.context_usage).confirmed.request_id, sample.request_id);
  assert(await composer.isEnabled());
  await canvas.locator('.tessiven-flower-output').getByRole('button', { name: 'Retry reply', exact: true }).click();
  const recovered = await until(async () => { const d = await api(route); return d.current.activity === 'idle' && d.current.last_outcome === 'completed' ? d : null; }, 'user retry completion');
  const recoveredSample = (recovered.context_usage ?? recovered.thread.context_usage).confirmed;
  assert(recoveredSample.measured && recoveredSample.request_id !== sample.request_id);
  assert.equal(recoveredSample.input_tokens, 90000);
  report.scenarios.push('missing-usage-and-failure-retain-sample-user-retry-restores-confirmed');
  await openPanel();
  const recoveredCategories = await panel.locator('.flower-context-categories').innerText();
  await canvas.keyboard.press('Escape');
  await canvas.reload();
  await canvas.getByRole('button', { name: 'Commerce / Example', exact: true }).click();
  await composer.waitFor(); await openPanel();
  assert((await panel.locator('.flower-context-total').innerText()).includes('= 90k'));
  assert.equal(await panel.locator('.flower-context-categories').innerText(), recoveredCategories);
  await canvas.setViewportSize({ width: 360, height: 640 });
  await panel.locator('.flower-context-close').click(); await trigger.focus(); await canvas.keyboard.press('Enter'); await panel.waitFor();
  const close = panel.locator('.flower-context-close'); await close.scrollIntoViewIfNeeded();
  const box = await close.boundingBox(); assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 360 && box.y + box.height <= 640);
  await canvas.screenshot({ path: path.join(output, 'narrow.png') }); await close.click();
  await until(() => trigger.evaluate(element => element === document.activeElement), 'narrow close focus');
  report.scenarios.push('canonical-reload-and-narrow-keyboard-close-focus');
  await stop(); await start();
  const restarted = await api(route);
  assert.deepEqual((restarted.context_usage ?? restarted.thread.context_usage).confirmed, recoveredSample);
  report.scenarios.push('runtime-restart-preserves-canonical-confirmed-sample');
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  if (canvas && !canvas.isClosed()) { await canvas.screenshot({ path: path.join(output, 'failure.png') }); await writeFile(path.join(output, 'failure.html'), await canvas.content()); }
  throw error;
}
finally {
  await browser?.close(); await stop(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await writeFile(path.join(output, 'runtime.log'), log);
  process.stdout.write(JSON.stringify({ passed: report.passed, output, scenarios: report.scenarios }) + '\n');
}
