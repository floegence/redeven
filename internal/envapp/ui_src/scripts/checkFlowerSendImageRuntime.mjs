#!/usr/bin/env node
/* global window, document, IDBObjectStore, MutationObserver */
// Qualify real Local Env admission and image history in a task-owned Runtime.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

process.umask(0o077);
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(['--binary', '--output'].includes(process.argv[i]) && process.argv[i + 1], 'Required: --binary <Runtime bundle> --output <evidence directory>');
  options.set(process.argv[i], path.resolve(process.argv[i + 1]));
}
assert(options.has('--binary') && options.has('--output'));
const root = path.resolve(import.meta.dirname, '../../../..');
const output = options.get('--output');
const temp = await mkdtemp(path.join(os.tmpdir(), 'redeven-flower-send-image-'));
const state = path.join(temp, 'state');
const workspace = path.join(temp, 'workspace');
const startupFile = path.join(temp, 'startup.json');
const model = 'fixture/gpt-5-mini';
const report = { passed: false, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  source_dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  runtime_executable_sha256: createHash('sha256').update(await readFile(options.get('--binary'))).digest('hex'),
  runtimes: [], provider_requests: [], admission: [], scenarios: [] };
let runtime, browser, origin, generation, runtimeLog = '', providerIndex = 0;
let activeGate;
let nativeImage;
const imageReadCalls = new Set();
const seedCalls = new Set();
const gates = new Set();
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  const result = { promise, release };
  gates.add(result);
  return result;
}
function pngFixture() {
  const width = 3614, height = 1920;
  const data = Buffer.alloc((width * 4 + 1) * height);
  let random = 0x735a2bc9;
  for (let y = 100; y < 500; y++) for (let x = 100; x < 500; x++) {
    const at = y * (width * 4 + 1) + 1 + x * 4;
    data[at] = 255; data[at + 3] = 255;
  }
  for (let y = 600; y < 1640; y++) for (let x = 600; x < 1624; x++) {
    const at = y * (width * 4 + 1) + 1 + x * 4;
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    data[at] = random & 255; data[at + 1] = (random >>> 8) & 255; data[at + 2] = (random >>> 16) & 255; data[at + 3] = 255;
  }
  const crc = bytes => {
    let result = 0xffffffff;
    for (const byte of bytes) {
      result ^= byte;
      for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0);
    }
    return (result ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, bytes) => {
    const body = Buffer.concat([Buffer.from(name), bytes]);
    const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(body));
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
  assert(bytes.length >= 3_400_000 && bytes.length <= 4_300_000, `qualification image bytes=${bytes.length}`);
  return { bytes, width, height };
}
const provider = http.createServer(async (request, response) => {
  try {
    if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'gpt-5-mini' }] })); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    const id = ++providerIndex;
    response.setHeader('Content-Type', 'text/event-stream');
    const send = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    const done = items => {
      send({ type: 'response.completed', response: { id: `qualification-${id}`, status: 'completed', output: items, usage: { input_tokens: 200, output_tokens: 40 } } });
      response.end('data: [DONE]\n\n');
    };
    const message = text => ({ type: 'message', id: `message-${id}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
    const answer = text => {
      const item = message(text);
      send({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      send({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text });
      send({ type: 'response.output_item.done', output_index: 0, item });
      done([item]);
    };
    if (!input.tools?.length) { answer('Image qualification'); return; }
    const text = JSON.stringify(input.input ?? []);
    const imageParts = value => {
      if (!value || typeof value !== 'object') return [];
      if (value.type === 'input_image') return [value];
      return Object.values(value).flatMap(imageParts);
    };
    const images = imageParts(input.input);
    const latest = [...(input.input ?? [])].reverse().find(item => item.role === 'user');
    const latestText = JSON.stringify(latest ?? {});
    const toolOutputs = (input.input ?? []).filter(item => item.type === 'function_call_output');
    report.provider_requests.push({ index: id, latest_user: latestText.slice(0, 180), image_parts: images.length, tool_outputs: toolOutputs.length,
      tool_errors: toolOutputs.filter(item => typeof item.output === 'string' && item.output.startsWith('ERROR')).map(item => item.output) });
    if (images.length) {
      assert(images.some(part => part.image_url === `data:image/png;base64,${nativeImage}`), 'The provider receives exact immutable image bytes');
    }
    if (latestText.includes('QUALIFY_IMAGE') && !toolOutputs.some(item => imageReadCalls.has(item.call_id))) {
      assert(input.tools.some(tool => tool.name === 'image_read'), 'Direct image.read is available');
      const callID = `image-${id}`;
      imageReadCalls.add(callID);
      const call = { type: 'function_call', id: callID, call_id: callID, name: 'image_read', arguments: JSON.stringify({ file_path: 'source.png' }) };
      send({ type: 'response.output_item.added', output_index: 0, item: call });
      send({ type: 'response.output_item.done', output_index: 0, item: call });
      done([call]); return;
    }
    if (latestText.includes('QUALIFY_SEED') && !toolOutputs.some(item => seedCalls.has(item.call_id))) {
      const calls = Array.from({ length: 68 }, (_, index) => {
        const callID = `seed-${id}-${index}`;
        seedCalls.add(callID);
        return { type: 'function_call', id: callID, call_id: callID, name: 'file_read', arguments: JSON.stringify({ file_path: 'fixture.txt' }) };
      });
      calls.forEach((item, output_index) => { send({ type: 'response.output_item.added', output_index, item }); send({ type: 'response.output_item.done', output_index, item }); });
      done(calls); return;
    }
    if (latestText.includes('QUALIFY_LARGE_HISTORY') && !text.includes('Historical transport fixture')) {
      const history = 'Historical transport fixture. '.repeat(55_000);
      send({ type: 'response.reasoning_summary_text.delta', delta: history });
      done([{ type: 'reasoning', id: `history-${id}`, summary: [{ type: 'summary_text', text: history }] }, message('Large history is ready.')]); return;
    }
    if (latestText.includes('QUALIFY_PAUSE')) {
      const paused = gate();
      activeGate = paused;
      send({ type: 'response.reasoning_summary_text.delta', delta: 'Working while guidance is submitted.' });
      const heartbeat = setInterval(() => send({ type: 'response.reasoning_summary_text.delta', delta: '.' }), 5000);
      response.once('close', paused.release);
      await paused.promise;
      clearInterval(heartbeat);
      if (!response.destroyed) answer('Paused work is complete.');
      return;
    }
    if (latestText.includes('QUALIFY_IMAGE') || latestText.includes('QUALIFY_FOLLOWUP')) {
      if (!images.length) await writeFile(path.join(output, 'missing-native-request.json'), JSON.stringify(input, null, 2));
      assert(images.length > 0, 'An image conversation retains native media');
    }
    answer(images.length ? 'The original image contains a red square and a colored region.' : 'ACK');
  } catch (error) {
    report.provider_error = error.stack;
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});
async function until(read, label, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    assert(!runtime || (runtime.exitCode === null && runtime.signalCode === null), `Runtime exited before ${label}: ${runtimeLog}`);
    assert(!report.provider_error, report.provider_error);
    const result = await read();
    if (result) return result;
    await delay(30);
  }
  throw new Error(`Timed out: ${label}`);
}
async function api(route, method = 'GET', body, observed) {
  const started = performance.now();
  const response = await fetch(new URL(route, origin), { method, headers: { 'Content-Type': 'application/json', Origin: new URL(origin).origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const firstByte = performance.now();
  const raw = await response.text();
  const finished = performance.now();
  if (observed) Object.assign(observed, { ttfb_ms: firstByte - started, transfer_ms: finished - firstByte, bytes: Buffer.byteLength(raw), total_ms: finished - started });
  const result = JSON.parse(raw);
  assert([200, 202].includes(response.status) && result.ok !== false, `${method} ${route}: ${response.status} ${result.error ?? ''}`);
  return result.data ?? result;
}
const threadRoute = id => `/_redeven_proxy/api/ai/threads/${encodeURIComponent(id)}`;
async function idle(id) {
  return until(async () => {
    const detail = await api(threadRoute(id));
    assert.notEqual(detail.current.last_outcome, 'failed', JSON.stringify(detail.current));
    return detail.current.activity === 'idle' && detail.current.last_outcome === 'completed' ? detail : null;
  }, `completed thread ${id}`);
}
async function send(id, text, observed) {
  return api(`${threadRoute(id)}/turns`, 'POST', { client_request_id: `qualification-${createHash('sha256').update(`${id}:${text}`).digest('hex')}`, storage_generation: generation, input: { text } }, observed);
}
async function start(binary) {
  await rm(startupFile, { force: true });
  runtime = spawn(binary, ['run', '--mode', 'local', '--state-root', state, '--local-ui-bind', '127.0.0.1:0', '--presentation', 'machine', '--startup-report-file', startupFile], {
    cwd: temp, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  runtime.stdout.on('data', bytes => { runtimeLog += bytes; }); runtime.stderr.on('data', bytes => { runtimeLog += bytes; });
  const startup = await until(async () => { try { return JSON.parse(await readFile(startupFile, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; } }, 'Runtime startup');
  assert.equal(startup.status, 'ready'); origin = startup.local_ui_url;
  report.runtimes.push({ pid: runtime.pid, origin, state, started_at: new Date().toISOString() });
  await until(async () => { const ready = (await api('/api/local/runtime')).runtime_service.ai_readiness; assert.notEqual(ready.state, 'blocked', JSON.stringify(ready)); return ['ready', 'degraded'].includes(ready.state); }, 'Flower readiness');
  generation = (await api('/_redeven_proxy/api/ai/storage-generation')).storage_generation;
}
async function stop() {
  for (const pending of gates) pending.release();
  if (!runtime || runtime.exitCode !== null || runtime.signalCode !== null) return;
  const exited = new Promise(resolve => runtime.once('exit', resolve)); runtime.kill('SIGTERM'); await exited;
}
async function createThread(title) {
  const result = await api('/_redeven_proxy/api/ai/threads', 'POST', { client_request_id: `create-${createHash('sha256').update(title).digest('hex')}`, title, model_id: model, permission_type: 'readonly', working_dir: workspace });
  return result.thread.thread_id;
}
async function media(ref, id) {
  const response = await fetch(new URL(`${threadRoute(id)}/tool-media/${ref.slice('image://'.length)}`, origin));
  assert.equal(response.status, 200);
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(body).digest('hex'), report.image.sha256);
  return body;
}
async function queueSamples(id, stage, count = 8) {
  for (let index = 0; index < count; index++) {
    const observed = { stage, index };
    const receipt = await send(id, `QUALIFY_QUEUE_${stage}_${index}`, observed);
    assert.equal(receipt.kind, 'queued');
    report.admission.push(observed);
    await api(`${threadRoute(id)}/queue/${encodeURIComponent(receipt.queue_id)}`, 'DELETE');
  }
}
try {
  await mkdir(output, { recursive: true }); await mkdir(workspace, { recursive: true });
  const binary = path.join(temp, 'redeven'); await copyFile(options.get('--binary'), binary);
  for (const name of ['redevplugin-runtime', '.redevplugin-release-artifacts-verified.json', 'REDEVPLUGIN_RUNTIME.spdx.json', 'REDEVPLUGIN_THIRD_PARTY_NOTICES.md', 'redevplugin-runtime.provenance.json', 'redevplugin-runtime.sig', 'redevplugin-runtime.pem'])
    await copyFile(path.join(path.dirname(options.get('--binary')), name), path.join(temp, name));
  const fixture = pngFixture(); nativeImage = fixture.bytes.toString('base64');
  report.image = { width: fixture.width, height: fixture.height, bytes: fixture.bytes.length, sha256: createHash('sha256').update(fixture.bytes).digest('hex') };
  await writeFile(path.join(workspace, 'source.png'), fixture.bytes); await writeFile(path.join(workspace, 'fixture.txt'), 'Qualification fixture only.\n');
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  await start(binary);
	await stop();
	const configPath = path.join(state, 'local-environment/config.json');
	const configured = JSON.parse(await readFile(configPath, 'utf8'));
	configured.agent_home_dir = workspace;
	await writeFile(configPath, JSON.stringify(configured));
	await start(binary);
  await api('/_redeven_proxy/api/ai/provider_bundle', 'PUT', { model_profile: { current_model_id: model, providers: [{ id: 'fixture', name: 'Qualification only', type: 'openai', base_url: `http://127.0.0.1:${provider.address().port}/v1`, models: [
    { model_name: 'gpt-5-mini', input_modalities: ['text', 'image'], context_window: 2000000, max_output_tokens: 8192 },
    { model_name: 'text-only', input_modalities: ['text'], context_window: 2000000, max_output_tokens: 8192 },
  ] }] }, provider_api_key_patches: [{ provider_id: 'fixture', api_key: 'qualification-only' }], web_search_provider_key_patches: [] });
  const imageThread = await createThread('Qualification image');
  await send(imageThread, 'QUALIFY_IMAGE: read source.png directly.');
  const imageDetail = await idle(imageThread);
  const imageRef = imageDetail.current.items.flatMap(item => item.activity?.presentation?.target_refs ?? []).find(ref => ref.kind === 'tool_image')?.resource_ref;
  assert(imageRef); await media(imageRef, imageThread);
  const foreign = await createThread('Qualification foreign');
  assert.equal((await fetch(new URL(`${threadRoute(foreign)}/tool-media/${imageRef.slice('image://'.length)}`, origin))).status, 404);
  const incompatible = await fetch(new URL(threadRoute(imageThread), origin), { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: new URL(origin).origin }, body: JSON.stringify({ model_id: 'fixture/text-only' }) });
  assert.equal(incompatible.status, 409); assert.equal((await incompatible.json()).error_code, 'thread_image_model_unsupported');
  await rm(path.join(workspace, 'source.png')); await stop(); await start(binary);
  const fork = await api(`${threadRoute(imageThread)}/fork`, 'POST', { client_request_id: 'qualification-fork', title: 'Qualification image fork' });
  const forkID = fork.thread.thread_id;
  await api(threadRoute(imageThread), 'DELETE'); await media(imageRef, forkID);
  await send(forkID, 'QUALIFY_FOLLOWUP: describe the original image again.'); await idle(forkID);
  report.scenarios.push('native-image-authorized-preview-model-guard-source-deletion-restart-fork');
  const target = await createThread('Qualification fixed performance target');
  await send(target, 'QUALIFY_LARGE_HISTORY');
  const large = await idle(target); report.large_current_bytes = Buffer.byteLength(JSON.stringify(large.current));
  assert(report.large_current_bytes >= 1_489_792);
  await send(target, 'QUALIFY_PAUSE'); await until(() => activeGate, 'paused provider');
  await queueSamples(target, 'before_unrelated_history');
  let visibleItems = 0;
  for (let index = 0; index < 151; index++) {
    const id = await createThread(`Qualification history ${index}`);
    await send(id, `QUALIFY_SEED_${index}`);
    const seeded = await idle(id); visibleItems += seeded.current.items.length;
    if ((index + 1) % 25 === 0) process.stdout.write(`Seeded ${index + 1} isolated threads, ${visibleItems} canonical items\n`);
  }
  assert(visibleItems >= 10_000, `canonical items=${visibleItems}`);
  report.scale = { unrelated_threads: 151, unrelated_canonical_items: visibleItems };
  await queueSamples(target, 'after_unrelated_history');
  const concurrentMedia = Promise.all(Array.from({ length: 8 }, () => media(imageRef, forkID)));
  await queueSamples(target, 'concurrent_media'); await concurrentMedia;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-US' });
  await context.addInitScript(() => {
    window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
    window.__flowerProbe = { samples: [], current: null };
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = originalPut.apply(this, args), probe = window.__flowerProbe.current;
      if (this.name === 'outbox' && probe) {
        probe.persist_start = performance.now();
        this.transaction.addEventListener('complete', () => { probe.persist_complete = performance.now(); }, { once: true });
      }
      return request;
    };
    document.addEventListener('click', event => {
      if (!event.target.closest('[data-flower-primary-action="send"]')) return;
      const probe = { click: performance.now(), text: document.querySelector('.flower-composer textarea')?.value };
      window.__flowerProbe.current = probe; window.__flowerProbe.samples.push(probe);
    }, true);
    new MutationObserver(() => {
      const probe = window.__flowerProbe.current;
      if (!probe) return;
      const row = [...document.querySelectorAll('[data-flower-transport-outbox-id]')].find(item => item.textContent.includes(probe.text));
      if (row && !probe.pending) { probe.pending = performance.now(); probe.request_id = row.dataset.flowerTransportOutboxId; }
      const canonical = [...document.querySelectorAll('[data-flower-queued-turn-dock-id]')].find(item => item.textContent.includes(probe.text) && !item.hasAttribute('data-flower-transport-outbox-id'));
      if (canonical && !probe.canonical) probe.canonical = performance.now();
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
  // A controlled slow HTTP response verifies feedback before admission returns.
  await context.route('**/_redeven_proxy/api/ai/threads/*/turns', async route => { if (route.request().postDataJSON()?.input?.text.startsWith('QUALIFY_UI_')) await delay(400); await route.continue(); });
  const page = await context.newPage(); const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(new URL('/_redeven_proxy/env/', origin).href);
  await page.getByRole('button', { name: 'Flower', exact: true }).click();
  const row = page.locator(`[data-thread-id="${target}"]`);
  await row.locator('button').first().click();
  const editor = page.locator('.flower-composer textarea'); await editor.waitFor();
  for (let index = 0; index < 20; index++) {
    const text = `QUALIFY_UI_${index}`;
    const receiptPromise = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.input?.text === text);
    await editor.fill(text); await page.locator('[data-flower-primary-action="send"]').click();
    await until(() => page.evaluate(value => window.__flowerProbe.samples.find(sample => sample.text === value)?.pending, text), 'immediate pending queue row');
    const response = await receiptPromise; assert.equal(response.status(), 202); const receipt = (await response.json()).data;
    await until(() => page.evaluate(value => window.__flowerProbe.samples.find(sample => sample.text === value)?.canonical, text), 'canonical queue confirmation');
    await api(`${threadRoute(target)}/queue/${encodeURIComponent(receipt.queue_id)}`, 'DELETE');
  }
  report.ui = await page.evaluate(() => window.__flowerProbe.samples);
  const feedback = report.ui.map(sample => sample.pending - sample.click).sort((a, b) => a - b);
  report.feedback_p95_ms = feedback[Math.ceil(feedback.length * .95) - 1];
  assert(report.feedback_p95_ms <= 100, `queue feedback P95=${report.feedback_p95_ms} ms`);
  assert(report.ui.every(sample => sample.persist_complete && sample.canonical), 'Every sent input is persisted and canonically confirmed');
  await page.screenshot({ path: path.join(output, 'large-history-admission.png'), animations: 'disabled' });
  assert.deepEqual(pageErrors, []); report.scenarios.push('151-threads-10000-items-large-current-media-concurrency-and-ui-admission');
  activeGate.release(); await idle(target);
  assert(!report.provider_error, report.provider_error); report.passed = true;
} catch (error) {
  report.error = error.stack; throw error;
} finally {
  await browser?.close(); await stop(); provider.closeAllConnections();
  if (provider.listening) await new Promise(resolve => provider.close(resolve));
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, 'runtime.log'), runtimeLog);
  if (!report.passed) await cp(state, path.join(output, 'failure-state'), { recursive: true, force: true });
  else { await rm(path.join(output, 'failure-state'), { recursive: true, force: true }); await rm(path.join(output, 'missing-native-request.json'), { force: true }); }
  await rm(temp, { recursive: true, force: true });
}
