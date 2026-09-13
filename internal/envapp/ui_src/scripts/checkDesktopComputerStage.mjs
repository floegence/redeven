/* global window, document */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

// This qualification drives the built Desktop welcome surface. It deliberately
// does not replace its adapter, provider, Activity mapper, or media loader.
assert.equal(process.env.REDEVEN_COMPUTER_USE_E2E, '1');
const cdp = process.env.REDEVEN_DESKTOP_CDP;
assert(cdp, 'REDEVEN_DESKTOP_CDP must identify a task-owned dev Desktop');
const output = process.env.REDEVEN_COMPUTER_EVIDENCE_DIR;
assert(output && path.isAbsolute(output), 'an absolute evidence directory is required');
const source = process.env.REDEVEN_COMPUTER_CONFIG_ROOT;
assert(source, 'REDEVEN_COMPUTER_CONFIG_ROOT must contain the authorized local DeepSeek configuration');
const config = JSON.parse(await readFile(path.join(source, 'config.json'), 'utf8'));
const secrets = JSON.parse(await readFile(path.join(source, 'secrets.json'), 'utf8'));
const provider = config.ai.providers.find((entry) => entry.type === 'deepseek');
const apiKey = secrets.ai.provider_api_keys[provider?.id];
assert(provider && apiKey, 'local DeepSeek configuration is missing');
const model = 'deepseek-v4-flash-vision-exp';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const browser = await chromium.connectOverCDP(cdp);
const page = browser.contexts()[0].pages().find((entry) => entry.url() === new URL('desktop/dist/welcome/index.html', `file://${root}`).href);
assert(page, 'CDP does not belong to this checkout built Desktop');
await mkdir(output, { recursive: true });
let completed = 0;
const server = http.createServer((request, response) => {
  if (request.url === '/complete' && request.method === 'POST') {
    completed += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ completed }));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><title>Flower visual qualification</title>
    <style>body{font:24px system-ui;background:#ecf3fb;color:#17304a;padding:60px}button{font:24px system-ui;background:#126846;color:white;padding:24px 40px;border:0}output{display:block;margin-top:28px}</style>
    <h1>Visual task</h1><button onclick="fetch('/complete',{method:'POST'}).then(r=>r.json()).then(r=>{document.querySelector('output').textContent='Completed '+r.completed;document.body.style.background='#d6f5e5'})">Complete step</button><output>Ready</output>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const fixtureURL = `http://127.0.0.1:${server.address().port}`;
const protocol = [];
const protocolErrors = [];
const proxy = http.createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    if (request.url === '/responses') {
      const body = JSON.parse(raw.toString());
      assert.equal(body.model, model);
      assert((body.tools ?? []).every((tool) => tool.type === 'function'));
      protocol.push({ model: body.model, toolCount: body.tools?.length ?? 0,
        imageToolOutput: (body.input ?? []).some((item) => item.type === 'function_call_output' && Array.isArray(item.output) && item.output.some((part) => part.type === 'input_image')) });
    }
    const upstream = await fetch(new URL(request.url, provider.base_url), {
      method: request.method, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      ...(raw.length ? { body: raw } : {}),
    });
    response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
    Readable.fromWeb(upstream.body).pipe(response);
  } catch (error) {
    protocolErrors.push(error instanceof assert.AssertionError ? error.message : 'Qualification proxy transport failed');
    response.writeHead(502); response.end('Qualification proxy failed.');
  }
});
proxy.listen(0, '127.0.0.1');
await once(proxy, 'listening');
const request = (method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const result = await window.redevenDesktopSettings.requestRuntimeFlower({ method, path: url, ...(body ? { body } : {}) });
  if (!result.ok) throw new Error(`Runtime request failed: ${result.error.code || result.error.status}`);
  return result.data;
}, { method, url, body });
const evidence = [];
try {
  await page.bringToFront();
  await request('PUT', '/_redeven_proxy/api/ai/provider_bundle', {
    model_profile: { current_model_id: `${provider.id}/${model}`, providers: [{ ...provider, base_url: `http://127.0.0.1:${proxy.address().port}` }] },
    provider_api_key_patches: [{ provider_id: provider.id, api_key: apiKey }],
    web_search_provider_key_patches: [],
  });
  await request('PUT', '/_redeven_proxy/api/ai/default_permission', { permission_type: 'full_access' });
  await request('PUT', '/_redeven_proxy/api/ai/computer_use', { enabled: true });
  await page.reload();
  console.log('Desktop configured; opening Flower through its visible controls.');
  if (!await page.locator('.flower-surface').count()) {
    await page.getByRole('button', { name: /^Flower$/ }).click();
  }
  await page.locator('.flower-new-chat-button').click();
  for (const [index, prompt] of [
    `Open ${fixtureURL} in the managed browser, use computer.screenshot to inspect it, then use computer.click to click Complete step once. Take another screenshot and report the completed number. Do not use terminal or HTTP fetch.`,
    'On the current page, use computer.screenshot and computer.click to click Complete step once more. Take a screenshot and report the completed number. Use only computer tools; do not navigate or use terminal or HTTP fetch.',
  ].entries()) {
    const composer = page.locator('.flower-surface textarea').first();
    await composer.fill(prompt);
    await composer.press('Enter');
    console.log(`Turn ${index + 1} submitted through Flower Composer.`);
    await page.waitForFunction(() => {
      const image = document.querySelector('.flower-computer-stage-frame');
      return image?.naturalWidth >= 640 && image?.complete;
    }, null, { timeout: 180_000 });
    const deadline = Date.now() + 180_000;
    while (completed < index + 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(completed, index + 1, 'the actual fixture click did not finish');
    await page.waitForFunction(() => !document.querySelector('[data-flower-primary-action="stop"], .flower-composer-stop-inline'), null, { timeout: 180_000 });
    await page.waitForFunction(() => {
      const image = document.querySelector('.flower-computer-stage-frame');
      return image?.naturalWidth >= 640 && image.complete;
    });
    const frame = await page.evaluate(() => {
      const image = document.querySelector('.flower-computer-stage-frame');
      const stage = document.querySelector('.flower-computer-stage');
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 100;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 160, 100);
      const bytes = ctx.getImageData(0, 0, 160, 100).data;
      const colors = new Set(); for (let i = 0; i < bytes.length; i += 4) colors.add(`${bytes[i]},${bytes[i+1]},${bytes[i+2]}`);
      return { width: image.naturalWidth, height: image.naturalHeight, blob: image.src.startsWith('blob:'), colors: colors.size, background: Array.from(bytes.slice(0, 3)), visibleText: stage.innerText.trim(), role: stage.getAttribute('role') };
    });
    assert(frame.blob && frame.colors > 10 && frame.visibleText === '' && frame.role === 'dialog', 'the media-only Stage did not display actual pixels');
    assert.deepEqual(frame.background, [214, 245, 229], 'Stage did not advance to the completed fixture screenshot');
    const screenshot = path.join(output, `desktop-turn-${index + 1}.png`);
    await page.screenshot({ path: screenshot });
    evidence.push({ turn: index + 1, fixtureCompleted: completed, frame, screenshot });
    console.log(JSON.stringify(evidence.at(-1)));
  }
  await page.locator('.flower-computer-stage-close').click();
  assert.equal(await page.locator('.flower-computer-stage').count(), 0, 'closing Stage must hide the viewer');
  await page.locator('.flower-activity-inline-button[aria-expanded="false"]').filter({ hasText: /^screenshot/u }).last().click();
  await page.locator('.flower-activity-computer-block .flower-activity-inline-button').last().click();
  await page.waitForFunction(() => document.querySelector('.flower-computer-stage-frame')?.naturalWidth === 1280);
  await page.locator('.flower-header-icon-button').last().click();
  const toggle = page.locator('.flower-settings-computer-use-section [role="switch"]');
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await toggle.click();
  await page.waitForFunction(() => {
    const toggle = document.querySelector('.flower-settings-computer-use-section [role="switch"]');
    return toggle?.getAttribute('aria-checked') === 'false' && !toggle.disabled;
  });
  await toggle.click();
  await page.waitForFunction(() => {
    const toggle = document.querySelector('.flower-settings-computer-use-section [role="switch"]');
    return toggle?.getAttribute('aria-checked') === 'true' && !toggle.disabled;
  });
  await page.locator('.flower-settings-back-button').click();
  const listing = await request('GET', '/_redeven_proxy/api/ai/threads?limit=20');
  const threadID = listing.threads[0].thread_id;
  const detail = await request('GET', `/_redeven_proxy/api/ai/threads/${threadID}`);
  const activities = [];
  const collect = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.presentation && /^(computer|browser)\./u.test(value.tool_name ?? '')) activities.push({ tool: value.tool_name, toolID: value.tool_id, targetRefs: value.presentation.target_refs });
    for (const child of Object.values(value)) if (typeof child === 'object') collect(child);
  };
  collect(detail);
  assert(activities.some((item) => item.tool === 'browser.navigate') && activities.some((item) => item.tool === 'computer.click'), 'actual thread did not execute browser and computer tools');
  assert(activities.some((item) => item.targetRefs?.some((ref) => ref.resource_ref?.startsWith('computer://'))), 'public thread lost media provenance');
  assert(protocol.some((entry) => entry.imageToolOutput), 'the actual provider never received a tool-result image');
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify({ model, fixtureURL, evidence, protocol, threadID, activities, stageReopened: true, settingsToggle: 'on-off-on' }, null, 2));
  console.log('Desktop computer media qualification passed.');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ completed, evidence, protocol, protocolErrors, failure: String(error).split('\n')[0] }, null, 2));
  throw error;
} finally {
  await request('PUT', '/_redeven_proxy/api/ai/provider_bundle', {
    model_profile: { current_model_id: `${provider.id}/${model}`, providers: [provider] },
    provider_api_key_patches: [], web_search_provider_key_patches: [],
  }).catch(() => undefined);
  server.closeAllConnections(); server.close();
  proxy.closeAllConnections(); proxy.close();
  await browser.close();
}
