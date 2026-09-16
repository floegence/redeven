/* global window, document */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

// Use a task-owned built Desktop. Only the provider is scripted; Runtime,
// browser helper, workspace stream, IPC, decoder and user input stay production.
const cdp = process.env.REDEVEN_DESKTOP_CDP;
const output = process.env.REDEVEN_COMPUTER_EVIDENCE_DIR;
assert(cdp && output && path.isAbsolute(output), 'task CDP and absolute evidence directory required');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const browser = await chromium.connectOverCDP(cdp);
const page = browser.contexts()[0].pages().find(entry => entry.url() === new URL('desktop/dist/welcome/index.html', `file://${root}`).href);
assert(page, 'CDP must identify this checkout Desktop');
let navigations = 0, providerCalls = 0, changedAt = 0, privateText = '';
const marker = 'private-fixture-\u79c1\u5bc6'; // Deliberately exercises native IME.
const fixture = http.createServer(async (req, res) => {
  if (req.url === '/changed') { changedAt = Date.now(); res.end('ok'); return; }
  if (req.url === '/input') {
    for await (const chunk of req) privateText += chunk;
    res.end('ok'); return;
  }
  if (req.url === '/public') {
    res.setHeader('Content-Type', 'text/html');
    res.end("<!doctype html><title>Ordinary preview</title><body style='margin:0;background:#ac2030'><script>setTimeout(()=>document.body.style.background='#20ac40',1100)</script>"); return;
  }
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  navigations++;
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>Verification fixture</title><style>body{margin:0;background:#ac2030;font:24px system-ui}button,input{position:absolute;left:40px;top:140px;font:24px;padding:20px}input{top:240px}</style>
  <h1>CAPTCHA verification</h1><button onclick="setTimeout(()=>{document.body.style.background='#20ac40';fetch('/changed')},600)">Change page</button><input autofocus oninput="fetch('/input',{method:'POST',body:this.value});this.value=''">
  <button style="top:340px" onclick="document.querySelector('h1').textContent='Complete';document.title='Complete'">Finish</button>`);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const fixtureURL = `http://127.0.0.1:${fixture.address().port}`;
const provider = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  assert(!raw.includes(marker), 'private text entered model history');
  const body = JSON.parse(raw);
  res.setHeader('Content-Type', 'text/event-stream');
  const send = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
  const active = body.tools?.length > 0;
  if (active) providerCalls++;
  if (active && providerCalls <= 2) {
    if (providerCalls === 2) await new Promise(resolve => setTimeout(resolve, 3000));
    const item = { type: 'function_call', id: `fc_fixture_${providerCalls}`, call_id: `navigate-fixture-${providerCalls}`, name: 'browser_navigate', arguments: JSON.stringify({ url: providerCalls === 1 ? `${fixtureURL}/public` : fixtureURL }) };
    send({ type: 'response.output_item.added', output_index: 0, item });
    send({ type: 'response.output_item.done', output_index: 0, item });
    send({ type: 'response.completed', response: { id: 'fixture-pause', status: 'completed', output: [item] } });
  } else {
    send({ type: 'response.output_text.delta', delta: 'Complete.' });
    send({ type: 'response.completed', response: { id: 'fixture-complete', status: 'completed', usage: { input_tokens: 1, output_tokens: 1 } } });
  }
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const request = (method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const result = await window.redevenDesktopSettings.requestRuntimeFlower({ method, path: url, ...(body ? { body } : {}) });
  if (!result.ok) throw new Error(`Runtime request: ${result.error.code}`);
  return result.data;
}, { method, url, body });
const wait = async (check, label, timeout = 15000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`${label} timed out`);
};
let threadID;
try {
  await mkdir(output, { recursive: true });
  await request('PUT', '/_redeven_proxy/api/ai/provider_bundle', {
    model_profile: { current_model_id: 'fixture/gpt-5-mini', providers: [{ id: 'fixture', name: 'Local fixture', type: 'openai', base_url: `http://127.0.0.1:${provider.address().port}/v1`, models: [{ model_name: 'gpt-5-mini' }] }] },
    provider_api_key_patches: [{ provider_id: 'fixture', api_key: 'fixture-only' }], web_search_provider_key_patches: [],
  });
  await request('PUT', '/_redeven_proxy/api/ai/default_permission', { permission_type: 'full_access' });
  await request('PUT', '/_redeven_proxy/api/ai/computer_use', { enabled: true });
  await page.evaluate(() => window.redevenDesktopStateStorage.setItem('flower.computer-viewer.fps', '3'));
  await page.reload();
  if (!await page.locator('.flower-surface').count()) await page.getByRole('button', { name: /^Flower$/ }).click();
  await page.locator('.flower-new-chat-button').click();
  const composer = page.locator('.flower-surface textarea').first();
  await composer.fill(`Open ${fixtureURL} and let me complete verification.`); await composer.press('Enter');
  await wait(() => page.locator('.flower-computer-stage img').evaluateAll(images => images.some(img => {
    if (!img.naturalWidth) return false;
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return r === 32 && g === 172 && b === 64;
  })), 'ordinary preview after unchanged samples');
  const take = page.locator('[data-computer-control-action="take"]');
  await take.waitFor({ timeout: 60000 });
  threadID = await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-id');
  await take.click();
  await wait(() => page.locator('.flower-computer-stage img').evaluateAll(images => images.some(img => img.naturalWidth >= 640)), 'decoded private frame');
  const image = page.locator('.flower-computer-stage img');
  const rate = page.locator('.flower-computer-frame-rate select');
  assert.equal(await rate.inputValue(), '3');
  const clickPixel = async (x, y) => {
    const point = await image.evaluate((img, { x, y }) => {
      const box = img.getBoundingClientRect(), scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
      return { x: box.x + (box.width - img.naturalWidth * scale) / 2 + x * scale, y: box.y + (box.height - img.naturalHeight * scale) / 2 + y * scale };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
  };
  await clickPixel(100, 175);
  await wait(() => changedAt > 0, 'delayed fixture change');
  await wait(() => image.evaluate(img => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return r === 32 && g === 172 && b === 64;
  }), 'continuous decoded change', 1000);
  const delayMS = Date.now() - changedAt;
  const handback = page.locator('[data-computer-control-action="return"]');
  await handback.click();
  await wait(() => page.locator('.flower-surface [role="alert"]').count().then(Boolean), 'structured handback feedback');
  assert.equal(await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-status'), 'waiting_user');
  await wait(() => page.locator('.flower-computer-stage .flower-computer-state').getAttribute('data-session-state').then(value => value === 'user_control'), 'private control retained');
  await page.locator('.flower-composer').screenshot({ path: path.join(output, 'takeover-card.png') });
  const windowBox = () => page.locator('[data-floe-geometry-surface="floating-window"]').boundingBox();
  for (const fps of ['5', '10', '15', '30', '3']) {
    const before = await windowBox(); await rate.selectOption(fps);
    await wait(() => page.locator('.flower-computer-stage .flower-computer-state').getAttribute('data-session-state').then(value => value === 'user_control'), `FPS ${fps}`);
    const after = await windowBox(); assert.equal(after.x, before.x); assert.equal(after.y, before.y);
  }
  await clickPixel(100, 270);
  await page.keyboard.insertText('private-fixture-');
  const ime = await page.context().newCDPSession(page);
  await ime.send('Input.imeSetComposition', { text: '\u79c1\u5bc6', selectionStart: 2, selectionEnd: 2 });
  await ime.send('Input.insertText', { text: '\u79c1\u5bc6' }); await ime.detach();
  await wait(() => privateText === marker, 'private paste and native IME');
  assert(!JSON.stringify(await request('GET', `/_redeven_proxy/api/ai/threads/${threadID}`)).includes(marker));
  await rate.selectOption('15');
  await page.locator('[data-floe-floating-window-control="close"]').click();
  await page.locator('.flower-computer-stage-ball').click();
  await wait(() => page.locator('.flower-computer-stage .flower-computer-state').getAttribute('data-session-state').then(value => value === 'user_control'), 'reopened private viewer');
  assert.equal(await rate.inputValue(), '15');
  await page.setViewportSize({ width: 390, height: 800 });
  assert(await rate.isVisible());
  const box = await rate.boundingBox(); assert(box.x >= 0 && box.x + box.width <= 390);
  await page.setViewportSize({ width: 1280, height: 900 });
  await clickPixel(100, 375);
  await handback.click();
  await wait(() => page.locator('.flower-surface').getAttribute('data-flower-selected-thread-status').then(value => value === 'success'), 'safe handback');
  assert.equal(navigations, 1); assert.equal(providerCalls, 3);
  await page.reload();
  assert.equal(await page.evaluate(() => window.redevenDesktopStateStorage.getItem('flower.computer-viewer.fps')), '15');
  await writeFile(path.join(output, 'private-viewer.json'), JSON.stringify({ ordinaryPreviewContinued: true, delayMS, rates: [3,5,10,15,30], paste: true, nativeIME: true, rejectedHandbackRetained: true, safeHandbackOnce: true, navigationOnce: true, narrowHeader: true, persisted: true, threadID }, null, 2));
  console.log(`Private Desktop qualification passed: delayed pixels visible in ${delayMS}ms; all FPS, handback, paste and IME passed.`);
} finally {
  if (threadID) await request('DELETE', `/_redeven_proxy/api/ai/threads/${threadID}?force=true`).catch(() => undefined);
  await browser.close(); fixture.closeAllConnections(); provider.closeAllConnections();
  await Promise.all([new Promise(resolve => fixture.close(resolve)), new Promise(resolve => provider.close(resolve))]);
}
