#!/usr/bin/env node
// Qualify the built product through a fresh, real Runtime. Only model output is
// scripted; never attach this test to an existing browser or user environment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { load as loadYAML } from 'js-yaml';

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
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  source_dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  runtime_executable_sha256: createHash('sha256').update(await readFile(options.get('--binary'))).digest('hex'),
  scenarios: [], question_geometry: [], canvas_context: [],
};
let runtime, browser, runtimeLog = '', providerCalls = 0, questionNext = false;
let streamProbe;
let canvasSaveNext;
let canvasSaveCallID;
const canvasToolOutputs = new Map();
let layeredCanvas;
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
  for (const item of input.input ?? []) {
    if (item.type === 'function_call_output' && item.call_id?.startsWith('canvas-'))
      canvasToolOutputs.set(item.call_id, JSON.parse(item.output.replace(/^ERROR: /, '')));
  }
  providerCalls++;
  response.setHeader('Content-Type', 'text/event-stream');
  const send = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  if (streamProbe && input.tools?.length) {
    const probe = streamProbe;
    if (probe.phase === 'seed') {
      streamProbe = undefined;
      const text = 'Historical observation. '.repeat(68000);
      const reasoning = { type: 'reasoning', id: `history-${providerCalls}`, summary: [{ type: 'summary_text', text }] };
      send({ type: 'response.reasoning_summary_text.delta', delta: text });
      send({ type: 'response.output_text.delta', delta: reply });
      const message = { type: 'message', id: `seed-${providerCalls}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] };
      send({ type: 'response.completed', response: { id: `response-${providerCalls}`, status: 'completed', output: [reasoning, message], usage: { input_tokens: 20, output_tokens: 15 } } });
      response.end('data: [DONE]\n\n');
      return;
    }
    if (probe.phase === 'thinking') {
      await probe.waiting.promise;
      send({ type: 'response.reasoning_summary_text.delta', delta: 'Checking the large canonical history before reading canvases.' });
      await probe.thinking.promise;
      const item = { type: 'function_call', id: `probe-${providerCalls}`, call_id: `probe-${providerCalls}`, name: 'tessiven_list', arguments: '{}' };
      send({ type: 'response.output_item.added', output_index: 0, item });
      send({ type: 'response.output_item.done', output_index: 0, item });
      probe.phase = 'body';
      send({ type: 'response.completed', response: { id: `response-${providerCalls}`, status: 'completed', output: [item], usage: { input_tokens: 20, output_tokens: 15 } } });
      response.end('data: [DONE]\n\n');
      return;
    }
    await probe.tool.promise;
    send({ type: 'response.output_text.delta', delta: 'The large-history stream is visible before completion.' });
    await probe.body.promise;
    streamProbe = undefined;
    const item = { type: 'message', id: `probe-reply-${providerCalls}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'The large-history stream is visible before completion.', annotations: [] }] };
    send({ type: 'response.completed', response: { id: `response-${providerCalls}`, status: 'completed', output: [item], usage: { input_tokens: 20, output_tokens: 15 } } });
    response.end('data: [DONE]\n\n');
    return;
  }
  if (canvasSaveNext && input.tools?.some(tool => tool.name === 'tessiven_save')) {
    const item = { type: 'function_call', id: `canvas-${providerCalls}`, call_id: `canvas-${providerCalls}`, name: 'tessiven_save',
      arguments: JSON.stringify(canvasSaveNext) };
    canvasSaveCallID = item.call_id;
    canvasSaveNext = undefined;
    send({ type: 'response.output_item.added', output_index: 0, item });
    send({ type: 'response.output_item.done', output_index: 0, item });
    send({ type: 'response.completed', response: { id: `response-${providerCalls}`, status: 'completed', output: [item], usage: { input_tokens: 20, output_tokens: 15 } } });
    response.end('data: [DONE]\n\n');
    return;
  }
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

async function sendCanvasMessage(page, text, objectRefs) {
  const replies = page.locator('.tessiven-flower-output');
  const request = page.waitForRequest(request => {
    if (request.method() !== 'POST' || !new URL(request.url()).pathname.endsWith('/turns')) return false;
    return request.postDataJSON()?.input?.text === text;
  });
  const replyCount = (await replies.innerText()).split(reply).length;
  await replies.locator('.flower-composer textarea').fill(text);
  await replies.getByRole('button', { name: 'Send', exact: true }).click();
  const body = (await request).postDataJSON();
  if (objectRefs === null) {
    assert.equal(body.input.context_action, undefined, 'Ordinary canvas follow-ups do not submit another whole-canvas reference');
  } else {
    assert.deepEqual(body.input.context_action?.context, [{ kind: 'tessiven_selection',
      canvas_id: body.input.context_action.context[0].canvas_id,
      version_id: body.input.context_action.context[0].version_id, object_refs: objectRefs }]);
  }
  await until(async () => (await replies.innerText()).split(reply).length > replyCount, 'new visible streamed Flower reply');
  await until(() => page.locator('.tessiven [data-flower-selected-thread-status="success"]').count(), 'canonical Flower completion');
  const message = replies.locator('[data-flower-message-role="user"]').filter({ hasText: text });
  await message.waitFor();
  assert.equal(await message.locator('.flower-chat-context-chips').count(), objectRefs === null ? 0 : 1,
    'Canonical user messages display references only when the turn submitted them');
  report.canvas_context.push({ text, object_refs: objectRefs, reference_cards: await message.locator('.flower-chat-context-chips').count() });
}

async function verifyReplies(page, name, newConversation) {
  const surface = page.locator('.tessiven');
  const replies = page.locator('.tessiven-flower-output');
  const assertAskFlowerStyle = async (button, label, checkSeparator = false) => {
    const style = await button.evaluate(element => {
      const view = element.ownerDocument.defaultView;
      const computed = node => view.getComputedStyle(node);
      const icon = element.querySelector('.tessiven-ask-flower-mark');
      const panel = element.closest('.tessiven-popup');
      const lastObject = panel?.querySelector('.tessiven-detail-content > .tessiven-detail-object:last-child');
      return {
        actionBorder: computed(element).borderWidth,
        actionTinted: computed(element).backgroundColor !== computed(panel).backgroundColor,
        iconBackground: computed(icon).backgroundColor,
        iconBorder: computed(icon).borderWidth,
        iconRadius: computed(icon).borderRadius,
        separatorBorder: lastObject ? computed(lastObject).borderBottomWidth : '0px',
      };
    });
    assert.equal(style.actionBorder, '0px', `${label} has no action border`);
    assert.equal(style.actionTinted, true, `${label} is distinguished by color`);
    assert.equal(style.iconBackground, 'rgba(0, 0, 0, 0)', `${label} has no icon tile`);
    assert.equal(style.iconBorder, '0px', `${label} icon has no border`);
    assert.equal(style.iconRadius, '0px', `${label} icon has no rounded wrapper`);
    if (checkSeparator) assert.equal(style.separatorBorder, '0px', `${label} has no divider above it`);
  };
  await surface.getByRole('button', { name: 'Commerce / Example', exact: true }).click();
  await surface.locator('.tessiven-node').waitFor();
  assert.equal(await surface.locator('.tessiven-error, .tessiven-notice').count(), 0, 'Example canvas opens without a layout or routing error');
  const localCall = surface.locator('.tessiven-local-relation');
  assert.equal(await localCall.count(), 1, 'The example keeps its Storefront-to-Orders call inside the host');
  assert.ok((await localCall.innerText()).includes('Storefront') && (await localCall.innerText()).includes('Orders API'));
  assert.equal(await surface.locator('[data-graph-object="demo-application/demo-application"]').count(), 0, 'A local service call never becomes a group self-loop');
  for (const card of await surface.locator('.tessiven-node').all()) {
    const contained = await card.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      return [...node.querySelectorAll('.tessiven-service, .tessiven-local-relation')]
        .every(row => row.getBoundingClientRect().bottom <= bounds.bottom);
    });
    assert.ok(contained, 'Every service and relation row stays inside the host');
  }
  await replies.getByRole('button', { name: 'Hide replies', exact: true }).click();
  const relationships = surface.locator('.tessiven-local-relations');
  assert.equal(await relationships.locator('h3').innerText(), 'Service calls / access');
  assert.ok(await relationships.evaluate(element => parseFloat(element.ownerDocument.defaultView.getComputedStyle(element).borderTopWidth) > 0), 'Relationships are separated from the service inventory');
  assert.equal(await surface.locator('.tessiven-service-link-preview').count(), 0, 'Local service routes stay hidden by default');
  await localCall.hover();
  const preview = surface.locator('.tessiven-service-link-preview');
  await preview.waitFor();
  assert.equal(await surface.locator('.tessiven-service[data-relation-endpoint="source"] strong').innerText(), 'Storefront');
  assert.equal(await surface.locator('.tessiven-service[data-relation-endpoint="target"] strong').innerText(), 'Orders API');
  assert.equal(await surface.locator('.tessiven-popup').count(), 0, 'Hover traces the call without opening details');
  const inventoryStyle = await surface.locator('.tessiven-service[data-relation-endpoint="source"]').evaluate(row => ({
    left: row.offsetLeft, width: row.offsetWidth, inventoryWidth: row.parentElement.clientWidth,
    nodeOverflow: row.ownerDocument.defaultView.getComputedStyle(row.closest('.tessiven-node')).overflow,
  }));
  assert.equal(inventoryStyle.left, 0, 'Service rows keep their original alignment without a connector gutter');
  assert.equal(inventoryStyle.width, inventoryStyle.inventoryWidth, 'Service rows use the complete inventory width');
  assert.equal(inventoryStyle.nodeOverflow, 'visible', 'Preview routes can extend beyond node borders');
  assert.equal(await surface.locator('.tessiven-error, .tessiven-notice').count(), 0, 'Hover routing has no invalid geometry');
  const endpoints = await preview.evaluate(svg => {
    const line = svg.querySelector('path[data-relation-id]');
    const source = svg.parentElement.querySelector('[data-relation-endpoint="source"]');
    const target = svg.parentElement.querySelector('[data-relation-endpoint="target"]');
    const start = line.getPointAtLength(0), end = line.getPointAtLength(line.getTotalLength());
    return { start: [start.x, start.y], end: [end.x, end.y],
      routeLeft: line.getBBox().x,
      source: [source.offsetLeft, source.offsetTop + source.offsetHeight / 2],
      target: [target.offsetLeft, target.offsetTop + target.offsetHeight / 2] };
  });
  assert.deepEqual(endpoints.start, endpoints.source); assert.deepEqual(endpoints.end, endpoints.target);
  assert.ok(endpoints.routeLeft <= -20, 'Hover routes leave room outside the full-width service rows');
  for (const mode of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: mode });
    await page.locator(mode === 'dark' ? 'html.dark' : 'html:not(.dark)').waitFor();
    await page.screenshot({ path: path.join(output, `${name}-local-link-${mode}.png`), animations: 'disabled' });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  const canvasBounds = await surface.locator('.floe-infinite-canvas').boundingBox();
  assert.ok(canvasBounds, 'Canvas bounds are available for clearing relation hover');
  await page.mouse.move(canvasBounds.x + canvasBounds.width - 12, canvasBounds.y + canvasBounds.height - 12);
  await until(async () => await preview.count() === 0, 'local service route hides on pointer leave');
  report.scenarios.push(`${name}-local-service-hover-route`);
  await localCall.click();
  const detail = page.getByRole('dialog', { name: 'Details', exact: true });
  assert.equal(await detail.locator('.tessiven-detail-object > code').innerText(), 'demo-api-call');
  const detailAsk = detail.getByRole('button', { name: 'Ask Flower', exact: true });
  assert.equal(await detailAsk.locator('svg').count(), 1, 'Object details use the canonical Flower icon');
  await assertAskFlowerStyle(detailAsk, 'Object details Ask Flower action', true);
  await page.screenshot({ path: path.join(output, `${name}-local-call.png`), animations: 'disabled' });
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await surface.locator('.tessiven-canvas-tools').getByRole('button', { name: 'Canvas actions', exact: true }).click();
  const canvasMenu = page.getByRole('menu');
  const menuAsk = canvasMenu.getByRole('menuitem', { name: 'Ask Flower', exact: true });
  assert.equal(await menuAsk.locator('svg').count(), 1, 'Canvas menus use the canonical Flower icon');
  await assertAskFlowerStyle(menuAsk, 'Canvas menu Ask Flower action');
  await canvasMenu.getByRole('menuitem', { name: 'Ask Flower', exact: true }).press('Escape');
  await surface.getByRole('button', { name: 'Show replies', exact: true }).click();
  const composer = replies.locator('.flower-composer textarea');
  await composer.waitFor();
  assert.equal(await replies.locator('.tessiven-flower-composer').count(), 1, 'Existing canvases put the composer inside the conversation window');
  assert.equal(await page.locator('.tessiven-flower-composer--initial').count(), 0, 'Existing canvases do not use the new-canvas composer placement');
  assert.equal(await page.locator('.flower-composer-context-reference').count(), 0, 'Whole canvas context stays implicit');
  const replyCount = (await replies.innerText()).split(reply).length;
  const firstRequest = page.waitForRequest(request => request.method() === 'POST'
    && new URL(request.url()).pathname.endsWith('/turns')
    && request.postDataJSON()?.input?.text === 'Explain the storefront and database relationship.');
  await composer.fill('Explain the storefront and database relationship.');
  await replies.getByRole('button', { name: 'Send', exact: true }).click();
  const feedbackStyle = await replies.locator('.flower-model-status-lane--conversation').evaluate(lane => {
    const style = lane.ownerDocument.defaultView.getComputedStyle(lane);
    return { border: style.borderTopWidth, top: style.paddingTop, bottom: style.paddingBottom };
  });
  assert.deepEqual(feedbackStyle, { border: '0px', top: '4px', bottom: '8px' }, 'Live feedback uses compact spacing without a divider');
  await until(async () => (await replies.innerText()).split(reply).length > replyCount, 'new visible streamed Flower reply');
  await until(() => surface.locator('[data-flower-selected-thread-status="success"]').count(), 'canonical Flower completion');
  const initialContext = (await firstRequest).postDataJSON().input.context_action;
  if (newConversation) {
    assert.equal(initialContext?.context[0]?.kind, 'tessiven_selection');
    assert.deepEqual(initialContext.context[0].object_refs, [], 'A new canvas conversation starts with the implicit whole-canvas reference');
  } else assert.equal(initialContext, undefined, 'Restoring a saved canvas conversation does not add whole-canvas context');
  report.scenarios.push(newConversation ? 'new-conversation-initial-canvas-context' : 'restored-conversation-without-repeated-canvas-context');
  await sendCanvasMessage(page, `Explain the next step for ${name}.`, null);
  await replies.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await localCall.click();
  await detail.getByRole('button', { name: 'Ask Flower', exact: true }).click();
  await sendCanvasMessage(page, `Explain this selected call for ${name}.`, ['demo-api-call']);
  assert.equal(await replies.locator('.flower-composer-context-reference').count(), 0, 'Accepted sends consume the canvas reference');
  await sendCanvasMessage(page, `Continue without a reference for ${name}.`, null);
  report.scenarios.push(`${name}-explicit-reference-and-ordinary-follow-ups`);
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

function releaseGate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function verifyLargeHistoryStream(page, origin) {
  const replies = page.locator('.tessiven-flower-output');
  streamProbe = { phase: 'seed' };
  let threadID;
  const receipt = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/turns')
    && response.request().postDataJSON()?.input?.text === 'Create the large-history transport fixture.');
  await sendCanvasMessage(page, 'Create the large-history transport fixture.', null);
  threadID = (await (await receipt).json()).data.thread_id;
  const detail = await requestJSON(origin, `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}`);
  const bytes = Buffer.byteLength(JSON.stringify(detail.current));
  assert.ok(bytes >= 1_489_792, `Current must reproduce the incident size, got ${bytes}`);
  const probe = { phase: 'thinking', waiting: releaseGate(), thinking: releaseGate(), tool: releaseGate(), body: releaseGate() };
  streamProbe = probe;
  try {
    await replies.locator('.flower-composer textarea').fill('Verify progressive delivery with the full large history.');
    await replies.getByRole('button', { name: 'Send', exact: true }).click();
    await replies.locator('[data-flower-progress-kind="waiting_response"]').waitFor();
    probe.waiting.release();
    await replies.locator('[data-flower-thinking-active="true"]').filter({ hasText: 'Checking the large canonical history' }).waitFor();
    assert.equal(await page.locator('.tessiven [data-flower-selected-thread-status="success"]').count(), 0);
    probe.thinking.release();
    await until(async () => {
      const current = (await requestJSON(origin, `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}`)).current;
      return current.items.some(item => item.kind === 'tool' && item.activity?.tool_name === 'tessiven.list' && item.activity.status === 'success');
    }, 'canonical tool result before provider completion');
    await replies.locator('.flower-activity-inline-row').filter({ hasText: /canvas/i }).last().waitFor();
    probe.tool.release();
    await replies.getByText('The large-history stream is visible before completion.', { exact: true }).waitFor();
    assert.equal(await page.locator('.tessiven [data-flower-selected-thread-status="success"]').count(), 0);
    await page.screenshot({ path: path.join(output, 'flower-large-history-before-completion.png'), animations: 'disabled' });
    probe.body.release();
    await until(() => page.locator('.tessiven [data-flower-selected-thread-status="success"]').count(), 'large-history completion');
    // A new connection must reconstruct the same large full history baseline.
    await page.reload();
    await page.locator('.tessiven').getByRole('button', { name: 'Commerce / Example', exact: true }).click();
    await replies.locator('.flower-composer textarea').waitFor();
    await replies.getByText('The large-history stream is visible before completion.', { exact: true }).waitFor();
    assert.ok(!/reason=(oversized_envelope|envelope_encoding_failed)/u.test(runtimeLog), 'Large history must not cause an envelope synchronization error');
    report.large_history_stream = { thread_id: threadID, current_bytes: bytes, updates_before_completion: ['waiting_response', 'thinking', 'tool_result', 'assistant'], reload: true };
    report.scenarios.push('large-history-progressive-stream-and-reload');
  } finally {
    for (const name of ['waiting', 'thinking', 'tool', 'body']) probe[name].release();
  }
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

async function saveLayeredCanvas(page, origin) {
  const document = JSON.parse(await readFile(path.join(root, 'internal/envapp/ui_src/src/styles/fixtures/tessiven-hadoop.json'), 'utf8'));
  document.metadata.title = 'Hadoop / Layered acceptance';
  const validation = await requestJSON(origin, '/_redeven_proxy/api/tessiven/validate', 'POST', { document_yaml: JSON.stringify(document) });
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics));
  canvasSaveNext = { request_id: 'acceptance-layered-hadoop', expected_version: 0, document_yaml: JSON.stringify(document), summary: 'Arrange the five Hadoop architecture layers.' };
  const replies = page.locator('.tessiven-flower-output');
  await replies.locator('.flower-composer textarea').fill('Create a separate Hadoop architecture canvas with access, control, coordination, worker and ecosystem layers, in that left-to-right order.');
  await replies.getByRole('button', { name: 'Send', exact: true }).click();
  layeredCanvas = await until(async () => {
    const approve = replies.locator('.flower-approval-decision-approve:not([disabled])');
    if (await approve.count()) await approve.first().click();
    const library = await requestJSON(origin, '/_redeven_proxy/api/tessiven/canvases');
    return library.canvases.find(canvas => canvas.title === document.metadata.title);
  }, 'Flower saves the layered Hadoop canvas');
  const saved = await requestJSON(origin, `/_redeven_proxy/api/tessiven/canvases/${layeredCanvas.id}/versions/latest`);
  assert.deepEqual(saved.document.presentation.layers, document.presentation.layers);
  assert.deepEqual(saved.document.presentation.positions, document.presentation.positions, 'Saving retains historical coordinate hints');
  report.scenarios.push('flower-validates-and-saves-layered-hadoop');
}

async function seedHistoricalPlacementFixture() {
  // Only the isolated qualification library is written. The two immutable
  // versions model a document that the former contract admitted.
  const document = loadYAML(await readFile(path.join(root, 'internal/tessiven/testdata/dsl_v1.yaml'), 'utf8'));
  document.metadata.title = 'Placement / Reference';
  const complete = JSON.stringify(document);
  document.instances = document.instances.filter(instance => instance.serviceRef !== 'demo-worker');
  document.presentation.layers = [['demo-application'], ['demo-worker']];
  document.presentation.positions = [{ objectRef: 'demo-worker', x: 400, y: 0 }];
  const historical = JSON.stringify(document);
  const db = new DatabaseSync(libraryPath);
  try {
    db.exec('BEGIN');
    db.prepare('INSERT INTO canvases(id,title,description,latest_version,archived,created_at,updated_at) VALUES(?,?,?,2,0,0,0)')
      .run('placement-qualification', document.metadata.title, document.metadata.description);
    const insert = db.prepare('INSERT INTO versions(canvas_id,number,document_yaml,digest,created_at,source,summary) VALUES(?,?,?,?,0,?,?)');
    for (const [index, yaml] of [complete, historical].entries())
      insert.run('placement-qualification', index + 1, yaml, createHash('sha256').update(yaml).digest('hex'), 'example', 'Historical placement qualification');
    db.exec('COMMIT');
  } finally { db.close(); }
}

async function verifyPlacementRepair(page, origin) {
  const surface = page.locator('.tessiven');
  await surface.getByRole('button', { name: 'Canvases', exact: true }).click();
  await surface.getByRole('button', { name: 'Placement / Reference', exact: true }).click();
  const missing = surface.locator('[data-placement="missing"]');
  await missing.waitFor();
  assert.equal(await missing.locator('small').innerText(), 'No node assigned');
  assert.equal(await surface.locator('.tessiven-error, .tessiven-notice').count(), 0);
  const versionPath = '/_redeven_proxy/api/tessiven/canvases/placement-qualification/versions/';
  const historical = await requestJSON(origin, `${versionPath}2`);
  assert.equal(historical.diagnostics.length, 3);
  const validation = await requestJSON(origin, '/_redeven_proxy/api/tessiven/validate', 'POST', { document_yaml: historical.document_yaml });
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.diagnostics, historical.diagnostics);
  await page.screenshot({ path: path.join(output, 'placement-historical.png'), animations: 'disabled' });
  await missing.click();
  await page.getByRole('button', { name: 'Ask Flower', exact: true }).click();
  const replies = page.locator('.tessiven-flower-output');
  const sendDocument = async (requestID, yaml, prompt) => {
    canvasSaveCallID = undefined;
    canvasSaveNext = { request_id: requestID, canvas_id: 'placement-qualification', expected_version: 2, document_yaml: yaml, summary: prompt };
    await replies.locator('.flower-composer textarea').fill(prompt);
    await replies.getByRole('button', { name: 'Send', exact: true }).click();
    const result = await until(async () => {
      const approve = replies.locator('.flower-approval-decision-approve:not([disabled])');
      if (await approve.count()) await approve.first().click();
      return canvasSaveCallID && canvasToolOutputs.get(canvasSaveCallID);
    }, 'Flower receives the placement save result');
    await until(() => surface.locator('[data-flower-selected-thread-status="success"]').count(), 'placement turn completes');
    return result;
  };
  const refused = await sendDocument('placement-invalid', historical.document_yaml, 'Keep the service without a host placement.');
  report.placement_tool_results = { refused };
  assert.equal(refused.status, 'error');
  assert.match(JSON.stringify(refused), /tessiven.invalid_document/);
  assert.match(JSON.stringify(refused), /\/services\/2\/id/);
  assert.equal(refused.error.meta.validation_details.path, '/services/2/id');
  assert.equal(refused.data.diagnostics[0].path, '/services/2/id');
  assert.equal(refused.data.diagnostics.length, 3);
  assert.equal((await requestJSON(origin, `${versionPath}latest`)).number, 2, 'Rejected Flower save does not create a version');
  const complete = await requestJSON(origin, `${versionPath}1`);
  const saved = await sendDocument('placement-repaired', complete.document_yaml, 'Restore Background jobs on app-01 using the placements in version 1.');
  assert.equal(saved.status, 'success');
  await until(async () => (await requestJSON(origin, `${versionPath}latest`)).number === 3, 'Flower saves the repaired version');
  await until(async () => await missing.count() === 0, 'live canvas removes the missing-node card');
  await surface.locator('.tessiven-service[data-service-id="demo-worker"]').waitFor();
  const repaired = await requestJSON(origin, `${versionPath}latest`);
  assert.equal(repaired.diagnostics, undefined);
  assert.equal(repaired.document.instances.length, complete.document.instances.length);
  const preserved = await requestJSON(origin, `${versionPath}2`);
  assert.equal(preserved.document_yaml, historical.document_yaml);
  assert.equal(preserved.digest, historical.digest);
  await page.reload();
  await page.locator('.tessiven-library-card').first().waitFor();
  await surface.getByRole('button', { name: 'Placement / Reference', exact: true }).click();
  await surface.locator('.tessiven-service[data-service-id="demo-worker"]').waitFor();
  assert.equal(await missing.count(), 0);
  assert.equal(await surface.locator('.tessiven-error, .tessiven-notice').count(), 0);
  await page.screenshot({ path: path.join(output, 'placement-repaired.png'), animations: 'disabled' });
  report.scenarios.push('historical-placement-read-rejected-flower-save-repair-live-update-refresh');
}

async function verifyLayeredCanvas(page, name) {
  const surface = page.locator('.tessiven');
  const replies = page.locator('.tessiven-flower-output');
  if (await replies.count()) {
    await replies.getByRole('button', { name: 'Hide replies', exact: true }).click();
    await replies.waitFor({ state: 'detached' });
  }
  await surface.getByRole('button', { name: 'Canvases', exact: true }).click();
  await surface.getByRole('button', { name: layeredCanvas.title, exact: true }).click();
  await until(async () => await surface.locator('.tessiven-node').count() === 10, 'complete layered Hadoop graph');
  if (await replies.count()) {
    await replies.getByRole('button', { name: 'Hide replies', exact: true }).click();
    await replies.waitFor({ state: 'detached' });
  }
  const roots = ['g-access', 'g-master', 'g-coord', 'g-worker', 'g-eco'];
  const geometry = () => surface.locator('.floe-graph__node, .floe-graph__group').evaluateAll(nodes => nodes.map(node => ({
    id: node.dataset.graphObject, x: parseFloat(node.style.left), y: parseFloat(node.style.top),
    width: parseFloat(node.style.width), height: parseFloat(node.style.height),
  })));
  const ordered = nodes => {
    const groups = roots.map(id => nodes.find(node => node.id === id));
    assert.ok(groups.every(Boolean), 'All five declared layers remain visible');
    for (let i = 1; i < groups.length; i++) assert.ok(groups[i].x >= groups[i - 1].x + groups[i - 1].width, 'Architecture layers never overlap or reverse');
  };
  const extent = nodes => Math.max(...nodes.map(node => node.x + node.width)) - Math.min(...nodes.map(node => node.x));
  const initial = await geometry();
  const palettePaths = await surface.locator('.floe-graph__minimap path').count();
  assert.ok(palettePaths > 1, 'The overview distinguishes topology colors');
  ordered(initial);
  const graphBounds = await surface.locator('.floe-infinite-canvas').boundingBox();
  const viewportTransform = () => surface.locator('.floe-infinite-canvas__viewport').evaluate(element => element.style.transform);
  const panStart = await viewportTransform();
  await page.mouse.move(graphBounds.x + graphBounds.width / 2, graphBounds.y + 96);
  await page.mouse.down();
  await page.mouse.move(graphBounds.x + graphBounds.width / 2 + 60, graphBounds.y + 136, { steps: 8 });
  await page.mouse.up();
  await until(async () => await viewportTransform() !== panStart, 'canvas drag changes the viewport');
  assert.equal(await page.evaluate(() => globalThis.getSelection()?.toString() ?? ''), '', 'Dragging never selects canvas text');
  const beforeZoom = await viewportTransform();
  const zoomLabel = surface.locator('.tessiven-canvas-zoom output');
  const beforeZoomLabel = await zoomLabel.innerText();
  await page.mouse.wheel(0, -200);
  await until(async () => await viewportTransform() !== beforeZoom, 'canvas wheel zoom');
  await until(async () => await zoomLabel.innerText() !== beforeZoomLabel, 'committed canvas zoom');
  await surface.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  report.scenarios.push(`${name}-pan-zoom-without-text-selection`);
  for (const mode of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: mode });
    await page.locator(mode === 'dark' ? 'html.dark' : 'html:not(.dark)').waitFor();
    await page.screenshot({ path: path.join(output, `${name}-expanded-${mode}.png`), animations: 'disabled' });
  }
  await surface.locator('[data-graph-object="n-coord-1"] .tessiven-node > header strong').click();
  await page.getByRole('dialog', { name: 'Details', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  let anchorId = await surface.locator('[data-graph-object][data-selected="true"]').getAttribute('data-graph-object');
  for (const id of roots) {
    const before = (await geometry()).find(node => node.id === id);
    if (id === 'g-coord') anchorId = id;
    const anchor = (await geometry()).find(node => node.id === anchorId);
    const view = await viewportTransform();
    await surface.locator(`[data-graph-object="${id}"]`).getByRole('button', { name: 'Collapse group', exact: true }).click();
    await until(async () => {
      const after = (await geometry()).find(node => node.id === id);
      return after && (after.width !== before.width || after.height !== before.height);
    }, `compact geometry for ${id}`);
    const after = (await geometry()).find(node => node.id === anchorId);
    assert.equal(after.x, anchor.x); assert.equal(after.y, anchor.y);
    assert.equal(await viewportTransform(), view, 'Compaction preserves the viewport center');
    assert.equal(await surface.locator('[data-graph-object][data-selected="true"]').getAttribute('data-graph-object'), anchorId);
    ordered(await geometry());
  }
  assert.equal(await surface.locator('.tessiven-node').count(), 0);
  const compact = await geometry();
  assert.ok(extent(compact) < extent(initial), 'Hidden nodes no longer reserve the expanded horizontal bounds');
  report.layer_geometry ??= [];
  report.layer_geometry.push({ name, expanded: extent(initial), collapsed: extent(compact) });
  await surface.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await page.screenshot({ path: path.join(output, `${name}-collapsed.png`), animations: 'disabled' });
  for (const id of roots) {
    const before = (await geometry()).find(node => node.id === id);
    const anchor = (await geometry()).find(node => node.id === anchorId);
    await surface.locator(`[data-graph-object="${id}"]`).getByRole('button', { name: 'Expand group', exact: true }).click();
    await until(async () => {
      const after = (await geometry()).find(node => node.id === id);
      return after && (after.width !== before.width || after.height !== before.height);
    }, `expanded geometry for ${id}`);
    const after = (await geometry()).find(node => node.id === anchorId);
    assert.equal(after.x, anchor.x); assert.equal(after.y, anchor.y);
    await surface.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    ordered(await geometry());
  }
  assert.equal(await surface.locator('.tessiven-node').count(), 10);
  await surface.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  const anchorBeforeBulk = (await geometry()).find(node => node.id === anchorId);
  const viewportBeforeBulk = await viewportTransform();
  await surface.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Collapse all', exact: true }).click();
  await until(async () => await surface.locator('.tessiven-node').count() === 0, 'bulk compact collapse');
  const anchorAfterBulk = (await geometry()).find(node => node.id === anchorId);
  assert.equal(anchorAfterBulk.x, anchorBeforeBulk.x);
  assert.equal(anchorAfterBulk.y, anchorBeforeBulk.y);
  assert.equal(await viewportTransform(), viewportBeforeBulk);
  await surface.getByRole('button', { name: 'View', exact: true }).click();
  assert.ok(await page.getByRole('menuitem', { name: 'Collapse all', exact: true }).isDisabled());
  await page.getByRole('menuitem', { name: 'Expand all', exact: true }).click();
  await until(async () => await surface.locator('.tessiven-node').count() === 10, 'bulk expand restores all hosts');
  await surface.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Current group services', exact: true }).click();
  await until(async () => await surface.getByRole('status', { name: 'Arranging canvas', exact: true }).count() === 0, 'group service scope');
  await surface.getByRole('button', { name: 'View', exact: true }).click();
  assert.equal(await page.getByRole('menuitem', { name: 'Current group services', exact: true }).locator('svg').count(), 1);
  await page.getByRole('menuitem', { name: 'All host services', exact: true }).click();
  await until(async () => await surface.getByRole('status', { name: 'Arranging canvas', exact: true }).count() === 0, 'all host service scope');
  await surface.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  const overview = surface.getByRole('region', { name: 'Canvas overview', exact: true });
  assert.equal(await overview.locator('path').count(), palettePaths, 'Restored inventory retains its overview palette');
  const mini = await overview.boundingBox();
  const indicator = await overview.locator('rect').boundingBox();
  const dragX = (Math.max(mini.x, indicator.x) + Math.min(mini.x + mini.width, indicator.x + indicator.width)) / 2;
  const dragY = (Math.max(mini.y, indicator.y) + Math.min(mini.y + mini.height, indicator.y + indicator.height)) / 2;
  const beforeMiniDrag = await viewportTransform();
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  assert.equal(await viewportTransform(), beforeMiniDrag, 'Dragging the overview viewport does not jump on press');
  await page.mouse.move(dragX - 16, dragY - 6, { steps: 8 });
  await page.mouse.up();
  await until(async () => await viewportTransform() !== beforeMiniDrag, 'overview pointer drag pans the main graph');
  assert.equal(await page.evaluate(() => globalThis.getSelection()?.toString() ?? ''), '');
  await overview.focus();
  await page.keyboard.press('Home');
  report.scenarios.push(`${name}-bulk-groups-service-scope-draggable-overview`);
  const viewport = page.viewportSize();
  for (const size of [{ width: 480, height: 360 }, viewport]) {
    await page.setViewportSize(size);
    await surface.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    const tools = await surface.locator('.tessiven-canvas-tools').boundingBox();
    const navigator = await overview.boundingBox();
    assert.ok(tools.x + tools.width <= navigator.x || navigator.x + navigator.width <= tools.x
      || tools.y + tools.height <= navigator.y || navigator.y + navigator.height <= tools.y,
    'Canvas controls and overview never overlap in a narrow low-height window');
    await page.screenshot({ path: path.join(output, `${name}-${size.width}.png`), animations: 'disabled' });
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await page.screenshot({ path: path.join(output, `${name}-high-contrast.png`), animations: 'disabled' });
  await page.emulateMedia({ forcedColors: 'none', colorScheme: 'light' });
  assert.equal(await surface.locator('.tessiven-error, .tessiven-notice').count(), 0);
  await page.reload();
  await surface.locator('.tessiven-library-card').first().waitFor();
  await surface.getByRole('button', { name: layeredCanvas.title, exact: true }).click();
  await until(async () => await surface.locator('.tessiven-node').count() === 10, 'layered canvas after refresh and reentry');
  assert.equal(await surface.locator('.tessiven-error, .tessiven-notice').count(), 0);
  report.scenarios.push(`${name}-layers-collapse-expand-themes-small-window-refresh`);
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

async function waitFlowerReady(origin) {
  await until(async () => {
    const state = (await requestJSON(origin, '/api/local/runtime')).runtime_service.ai_readiness;
    assert.notEqual(state.state, 'blocked', `Flower startup must not be blocked: ${JSON.stringify(state)}`);
    return state.state === 'ready' || state.state === 'degraded';
  }, 'Flower startup maintenance');
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
    await waitFlowerReady(startup.local_ui_url);
    await stopRuntime();
    startup = await startRuntime(binary, startupFile);
    verifyMigration();
    report.migration = { from: 1, to: 2, canvases: originalRecords.canvases.length, versions: originalRecords.versions.length, requests: originalRecords.requests.length };
    report.scenarios.push('historical-library-upgrade-and-runtime-restart');
  }
  // Let the thread-store owner finish its first initialization before testing
  // a deliberate restart; never interrupt or repair that owner's bootstrap.
  await waitFlowerReady(startup.local_ui_url);
  await stopRuntime();
  await seedHistoricalPlacementFixture();
  startup = await startRuntime(binary, startupFile);
  report.scenarios.push('historical-placement-runtime-restart');
  const origin = startup.local_ui_url;
  const initialLayout = await requestJSON(origin, '/_redeven_proxy/api/workbench/layout/snapshot');
  assert.equal(initialLayout.revision, 0);
  await waitFlowerReady(origin);
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  await requestJSON(origin, '/_redeven_proxy/api/ai/provider_bundle', 'PUT', {
    model_profile: { current_model_id: 'fixture/gpt-5-mini', providers: [{ id: 'fixture', name: 'Local acceptance', type: 'openai', base_url: `http://127.0.0.1:${provider.address().port}/v1`, models: [{ model_name: 'gpt-5-mini', input_modalities: ['text', 'image'], context_window: 2000000, max_output_tokens: 8192 }] }] },
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
  await verifyReplies(popup, 'standalone-replies-light', true);
  await verifyLargeHistoryStream(popup, origin);
  await verifyShortQuestion(popup, 'standalone');
  await saveLayeredCanvas(popup, origin);
  await verifyLayeredCanvas(popup, 'standalone-hadoop');
  await popup.close();

  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  const activityBar = page.locator('[data-floe-shell-slot="activity-bar"]');
  await activityBar.waitFor();
  await activityBar.getByRole('button', { name: 'Tessiven service canvas', exact: true }).click();
  await page.locator('.tessiven-library-card').first().waitFor();
  assert.ok(await activityBar.isVisible(), 'Activity keeps its navigation rail');
  assert.equal(await activityBar.getByRole('button', { name: 'Tessiven service canvas', exact: true }).getAttribute('aria-pressed'), 'true');
  await verifyReplies(page, 'activity-replies-light', false);
  await verifyShortQuestion(page, 'activity');
  await verifyEmptyCanvas(page);
  await verifyLayeredCanvas(page, 'activity-hadoop');
  await verifyPlacementRepair(page, origin);
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
