#!/usr/bin/env node
// Qualify the built Flower canvas against configured DeepSeek, isolated from user state.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

process.umask(0o077);
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(['--binary', '--source', '--output'].includes(process.argv[i]) && process.argv[i + 1]);
  args.set(process.argv[i], path.resolve(process.argv[i + 1]));
}
for (const key of ['--binary', '--source', '--output']) assert(args.has(key), `Missing ${key}`);
const output = args.get('--output');
const state = path.join(output, 'state');
const local = path.join(state, 'local-environment');
const startupFile = path.join(output, 'startup.json');
const root = path.resolve(import.meta.dirname, '../../../..');
const deadline = Date.now() + 30 * 60_000;
const report = { passed: false, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), requests: [], scenarios: [] };
const fact = 'UI_COMPACTION_FACT_7B91';
let runtime, browser, origin;
let gatedSummary;
let releaseSummary;
const source = JSON.parse(await readFile(path.join(args.get('--source'), 'config.json'), 'utf8'));
const providerConfig = source.ai?.providers.find(p => p.type === 'deepseek');
assert(providerConfig && new URL(providerConfig.base_url).hostname === 'api.deepseek.com', 'Configured official DeepSeek required');
const modelID = `${providerConfig.id}/deepseek-flash`;
const recorder = http.createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks), input = JSON.parse(raw);
    const text = JSON.stringify(input);
    const kind = text.includes('You are a context compaction writer.') ? 'summary' : text.includes('You generate concise thread titles for an interactive AI agent.') ? 'title' : 'main';
    const observed = { kind, bytes: raw.length, hash: createHash('sha256').update(raw).digest('hex'), model: input.model, continuation: Boolean(input.previous_response_id), input_tokens: 0, output_tokens: 0 };
    report.requests.push(observed);
    if (kind === 'summary' && gatedSummary) {
      await gatedSummary;
      gatedSummary = undefined;
    }
    const headers = { 'Content-Type': 'application/json' };
    if (request.headers.authorization) headers.Authorization = request.headers.authorization;
    const upstream = await fetch(new URL(request.url, providerConfig.base_url.endsWith('/') ? providerConfig.base_url : `${providerConfig.base_url}/`), { method: 'POST', headers, body: raw, signal: AbortSignal.timeout(180_000) });
    assert.equal(upstream.status, 200, 'DeepSeek request must succeed');
    response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream' });
    let events = '';
    for await (const chunk of upstream.body) {
      events += Buffer.from(chunk).toString('utf8');
      response.write(chunk);
    }
    for (const line of events.split('\n')) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
      try {
        const event = JSON.parse(line.slice(6)), usage = event.response?.usage ?? event.usage;
        if (usage) {
          observed.input_tokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
          observed.output_tokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
        }
      } catch { /* SSE contains only complete JSON data rows used for accounting. */ }
    }
    observed.fact_in_response = events.includes(fact);
    response.end();
  } catch {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  }
});
async function until(read, label, timeout = 180_000) {
  const end = Math.min(deadline, Date.now() + timeout);
  while (Date.now() < end) {
    assert(!runtime || (runtime.exitCode === null && runtime.signalCode === null), `Runtime exited before ${label}`);
    const value = await read();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function start() {
  await rm(startupFile, { force: true });
  runtime = spawn(args.get('--binary'), ['run', '--mode', 'local', '--state-root', state, '--local-ui-bind', '127.0.0.1:0', '--presentation', 'machine', '--startup-report-file', startupFile], { cwd: output, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', 'ignore', 'ignore'] });
  const startup = await until(async () => { try { return JSON.parse(await readFile(startupFile, 'utf8')); } catch { return null; } }, 'Runtime ready', 60_000);
  assert.equal(startup.status, 'ready');
  origin = startup.local_ui_url;
  report.runtime = { pid: runtime.pid, origin, state };
}
async function stop() {
  if (!runtime || runtime.exitCode !== null || runtime.signalCode !== null) return;
  const exited = new Promise(resolve => runtime.once('exit', resolve));
  runtime.kill('SIGTERM');
  await exited;
}
async function api(route, method = 'GET', body) {
  const response = await fetch(new URL(route, origin), { method, headers: { 'Content-Type': 'application/json', Origin: new URL(origin).origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert([200, 202].includes(response.status), `${method} ${route}: status ${response.status}, ${result.error_code ?? ''} ${result.error ?? ''}`);
  assert.notEqual(result.ok, false, 'Runtime command must succeed');
  return result.data ?? result;
}
const counts = kind => report.requests.filter(r => r.kind === kind).length;
const detail = id => api(`/_redeven_proxy/api/ai/threads/${id}`);
async function idle(id, turnID) {
  return until(async () => { const d = await detail(id); return d.current.activity === 'idle' && (!turnID || d.current.turn_id === turnID) && d.current.last_outcome === 'completed' ? d : null; }, 'canonical terminal');
}
function ballast(round) {
  const line = 'Disposable synthetic context alpha beta gamma delta. ';
  return { text: line.repeat(800) + '\nReply exactly ACK. Do not repeat filler or call tools.', context_action: {
    schema_version: 2, action_id: 'assistant.ask.flower', provider: 'flower', target: { target_id: 'local-environment', locality: 'current_runtime' }, source: { surface: 'git_browser' }, presentation: { label: 'Synthetic pressure' },
    context: Array.from({ length: 18 }, (_, index) => ({ kind: 'text_snapshot', title: `Synthetic record ${index}`, content: `Record ${round}/${index}. ` + line.repeat(160) })),
  } };
}
try {
  await mkdir(output, { recursive: true });
  assert(!await readFile(startupFile).then(() => true, () => false), 'Use a fresh output directory');
  await start();
  await stop();
  const config = JSON.parse(await readFile(path.join(local, 'config.json'), 'utf8'));
  await new Promise(resolve => recorder.listen(0, '127.0.0.1', resolve));
  config.ai = { ...source.ai, current_model_id: modelID, providers: [{ ...providerConfig, base_url: `http://127.0.0.1:${recorder.address().port}` }] };
  await writeFile(path.join(local, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  // Runtime's production secret store resolves the copied provider credential.
  await copyFile(path.join(args.get('--source'), 'secrets.json'), path.join(local, 'secrets.json'));
  await start();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-US' });
  const page = await context.newPage();
  await page.goto(new URL('/_redeven_proxy/env/', origin).href);
  await page.locator('[data-workbench-dock-action="tessiven"]').waitFor();
  const opened = context.waitForEvent('page');
  await page.locator('[data-workbench-dock-action="tessiven"]').click();
  const canvas = await opened;
  await canvas.locator('.tessiven-library-card').first().waitFor();
  await canvas.getByRole('button', { name: 'Commerce / Example', exact: true }).click();
  const replies = canvas.locator('.tessiven-flower-output');
  const composer = replies.locator('.flower-composer textarea');
  await composer.waitFor();
  const admission = canvas.waitForResponse(r => r.request().method() === 'POST' && /\/ai\/(?:threads\/[^/]+\/)?turns$/.test(new URL(r.url()).pathname));
  await composer.fill(`Remember the deployment tag ${fact} and port 7319. Reply exactly ACK without repeating either fact or calling tools.`);
  await composer.press('Enter');
  const receipt = (await (await admission).json()).data;
  const id = receipt.thread_id;
  assert(id);
  report.thread_id = id;
  let d = await idle(id, receipt.current.turn_id);
  const generation = (await api('/_redeven_proxy/api/ai/storage-generation')).storage_generation;
  const seededItems = d.current.items.length;
  const compactResponse = canvas.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/threads/${id}/context/compact`));
  const smallMain = counts('main'), smallSummaries = counts('summary');
  await composer.fill('/compact'); await composer.press('Enter');
  const smallReceipt = (await (await compactResponse).json()).data;
  d = await idle(id, smallReceipt.current.turn_id);
  assert.equal(d.current.items.length, seededItems);
  assert.equal(counts('main'), smallMain); assert.equal(counts('summary'), smallSummaries);
  assert.equal(d.thread.context_compactions.at(-1).status, 'noop');
  report.scenarios.push('canvas-small-history-noop-without-model-request');
  for (let round = 0; round < 3; round++) {
    const sent = await api(`/_redeven_proxy/api/ai/threads/${id}/turns`, 'POST', { storage_generation: generation, client_request_id: `ui-ballast-${round}`, input: ballast(round), options: {} });
    d = await idle(id, sent.current.turn_id);
  }
  assert(!d.thread.context_compactions.some(c => c.status === 'compacted'));
  // Select a real canvas reference; it must survive the independent command.
  await canvas.locator('[data-graph-object="demo-application"] .tessiven-node').first().click().catch(async () => canvas.locator('.tessiven-node').first().click());
  const objectDetail = canvas.getByRole('dialog', { name: 'Details', exact: true });
  await objectDetail.getByRole('button', { name: 'Ask Flower', exact: true }).click();
  await composer.waitFor();
  const referenceCount = await canvas.locator('.flower-composer-context-reference').count();
  assert(referenceCount > 0, 'Canvas selection must be explicit');
  const beforeMain = counts('main'), beforeSummary = counts('summary'), beforeItems = d.current.items.length;
  gatedSummary = new Promise(resolve => { releaseSummary = resolve; });
  const acceptedResponse = canvas.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/threads/${id}/context/compact`));
  await composer.fill('/compact'); await composer.press('Enter');
  const compactHTTP = await acceptedResponse;
  assert.equal(compactHTTP.status(), 202);
  const compactBody = compactHTTP.request().postDataJSON();
  assert.deepEqual(Object.keys(compactBody).sort(), ['client_request_id', 'storage_generation']);
  const compactReceipt = (await compactHTTP.json()).data;
  await until(() => counts('summary') > beforeSummary, 'summary dispatch');
  await composer.fill('Draft preserved while compaction runs');
  assert.equal(await composer.isEnabled(), true);
  releaseSummary();
  d = await idle(id, compactReceipt.current.turn_id);
  assert.equal(d.current.turn_kind, 'context_compaction'); assert.equal(d.current.items.length, beforeItems);
  assert.equal(counts('main'), beforeMain); assert.equal(counts('summary'), beforeSummary + 1);
  assert.equal(d.thread.context_compactions.at(-1).status, 'compacted');
  await until(async () => await replies.locator('[data-flower-compaction-status="compacted"]').count() === 1, 'one manual divider');
  assert.equal(await composer.inputValue(), 'Draft preserved while compaction runs');
  assert.equal(await canvas.locator('.flower-composer-context-reference').count(), referenceCount);
  await canvas.screenshot({ path: path.join(output, 'canvas-manual-compaction.png'), animations: 'disabled' });
  const replay = await api(`/_redeven_proxy/api/ai/threads/${id}/context/compact`, 'POST', compactBody);
  assert.equal(replay.current.turn_id, d.current.turn_id); assert.equal(counts('summary'), beforeSummary + 1);
  await canvas.reload();
  await canvas.locator('.tessiven-library-card').first().waitFor();
  await canvas.getByRole('button', { name: 'Commerce / Example', exact: true }).click();
  await until(async () => await canvas.locator('[data-flower-compaction-status="compacted"]').count() === 1, 'manual divider after refresh');
  report.scenarios.push('manual-summary-only-draft-reference-replay-refresh');
  // Natural full-window automatic pressure, then the UI observes task completion.
  let automatic = false;
  for (let round = 0; round < 24; round++) {
    const sent = await api(`/_redeven_proxy/api/ai/threads/${id}/turns`, 'POST', { storage_generation: generation, client_request_id: `ui-auto-${round}`, input: ballast(round + 10), options: {} });
    d = await idle(id, sent.current.turn_id);
    if (d.thread.context_compactions.some(c => c.trigger !== 'manual' && c.status === 'compacted')) { automatic = true; break; }
    assert(d.thread.context_usage.confirmed?.input_tokens > 0, 'Native usage is required');
  }
  assert(automatic, 'Automatic compaction must trigger within pressure bound');
  assert.notEqual(d.current.turn_kind, 'context_compaction');
  await until(async () => await canvas.locator('[data-flower-compaction-status="compacted"]').count() === 2, 'automatic divider and continued task');
  await canvas.screenshot({ path: path.join(output, 'canvas-automatic-compaction.png'), animations: 'disabled' });
  const recall = await api(`/_redeven_proxy/api/ai/threads/${id}/turns`, 'POST', { storage_generation: generation, client_request_id: 'ui-recall', input: { text: 'What are the original deployment tag and port? Answer briefly without tools.' }, options: {} });
  d = await idle(id, recall.current.turn_id);
  assert(JSON.stringify(d.current.items.filter(i => i.turn_id === d.current.turn_id && i.kind === 'assistant')).includes(fact));
  report.scenarios.push('automatic-full-window-continue-and-recall');
  report.compactions = d.thread.context_compactions;
  await writeFile(path.join(output, 'canonical.json'), JSON.stringify(d, null, 2));
  assert(report.requests.filter(r => r.kind === 'summary').every(r => r.input_tokens > 0), 'Real summary usage is required');
  report.passed = true;
} finally {
  releaseSummary?.();
  await browser?.close();
  await stop();
  if (recorder.listening) await new Promise(resolve => recorder.close(resolve));
  await rm(path.join(local, 'secrets.json'), { force: true });
  await rm(startupFile, { force: true });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(`Real DeepSeek Flower compaction UI passed. Evidence: ${output}`);
