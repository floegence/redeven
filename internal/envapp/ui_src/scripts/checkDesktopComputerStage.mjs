/* global window, document */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { findDeepSeekProvider } from '../../../../scripts/smoke_flower_deepseek.mjs';

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
const { provider, apiKey } = findDeepSeekProvider(config, secrets);
const model = 'deepseek-v4-flash-vision-exp';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const browser = await chromium.connectOverCDP(cdp);
const page = browser.contexts()[0].pages().find((entry) => entry.url() === new URL('desktop/dist/welcome/index.html', `file://${root}`).href);
assert(page, 'CDP does not belong to this checkout built Desktop');
await mkdir(output, { recursive: true });
let completed = 0;
let loginCompleted = false;
let loginInputVerified = false;
const privateFixtureInput = "qualification-private-input";
let takeoverEvidence;
const controls = { double: false, entered: false, scrolled: false, loads: 0, second: false };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname === '/signin') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><title>Sign-in fixture</title><style>body{background:#d6e5f5;font:24px system-ui;padding:60px}input,button{display:block;font:24px system-ui;margin:20px;padding:12px}</style>
      <h1>Sign in to the fixture</h1><form onsubmit="event.preventDefault();fetch('/signin-complete',{method:'POST',body:new URLSearchParams(new FormData(this))}).then(r=>{if(r.ok)location.href='/signed-in'})">
      <input name="user" aria-label="User" autofocus><input name="password" aria-label="Password" type="password"><button>Continue</button></form>`);
    return;
  }
  if (url.pathname === '/signin-complete' && request.method === 'POST') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; if (body.length > 1024) request.destroy(); });
    request.on('end', () => {
      const fields = new URLSearchParams(body);
      loginInputVerified = fields.get('user') === 'u' && fields.get('password') === privateFixtureInput;
      loginCompleted = loginInputVerified;
      response.writeHead(loginInputVerified ? 204 : 400); response.end();
    });
    return;
  }
  if (url.pathname === '/signed-in') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><title>Signed in</title><style>body{background:#d6f5e5;font:32px system-ui;padding:60px}</style><h1>Sign-in complete</h1>'); return;
  }
  if (url.pathname === '/control-event') {
    const event = url.searchParams.get('event');
    if (event === 'double') controls.double = true;
    if (event === 'enter' && url.searchParams.get('value') === 'Flower') controls.entered = true;
    if (event === 'scroll') controls.scrolled = true;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(controls));
    return;
  }
  if (url.pathname === '/controls' || url.pathname === '/second') {
    if (url.pathname === '/controls') controls.loads += 1;
    else controls.second = true;
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><title>Flower action qualification</title>
      <style>body{font:24px system-ui;margin:48px;min-height:1800px;background:#d6f5e5;color:#17304a}button,input{font:24px system-ui;padding:18px;margin:12px 0}input{display:block}footer{margin-top:1100px}</style>
      <h1>${url.pathname === '/second' ? 'Second page' : 'Browser actions'}</h1>
      <button ondblclick="report('double')">Double click me</button>
      <label>Enter Flower, then press Enter<input onkeydown="if(event.key==='Enter')report('enter',this.value)"></label>
      <output>${JSON.stringify(controls)}</output><footer>Bottom of page</footer>
      <script>function report(event,value=''){fetch('/control-event?event='+event+'&value='+encodeURIComponent(value)).then(r=>r.json()).then(r=>document.querySelector('output').textContent=JSON.stringify(r))}addEventListener('scroll',()=>report('scroll'))</script>`);
    return;
  }
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
    let record;
    if (request.url === '/responses') {
      const body = JSON.parse(raw.toString());
      assert.equal(body.model, model);
      assert.equal(raw.includes(Buffer.from(privateFixtureInput)), false, 'private user input entered the provider request');
      assert((body.tools ?? []).every((tool) => tool.type === 'function'));
      record = { model: body.model, wireBytes: raw.length, toolCount: body.tools?.length ?? 0, tools: (body.tools ?? []).map((tool) => tool.name),
        imageCount: (body.input ?? []).reduce((count, item) => {
          const content = item.type === 'function_call_output' ? item.output : item.content;
          return count + (Array.isArray(content) ? content.filter((part) => part.type === 'input_image').length : 0);
        }, 0),
        imageToolOutput: (body.input ?? []).some((item) => item.type === 'function_call_output' && Array.isArray(item.output) && item.output.some((part) => part.type === 'input_image')),
        // Record only numeric pointer geometry from this qualification. Never
        // retain text input, URLs, raw provider bodies, or image transport data.
        pointerCalls: (body.input ?? []).filter((item) => item.type === 'function_call' && /^computer[_.](click|double_click|scroll|drag)$/u.test(item.name ?? '')).map((item) => {
          const args = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments;
          return { id: item.call_id, tool: item.name, coordinates: Object.fromEntries(Object.entries(args ?? {}).filter(([key, value]) => /^(x|y|from_x|from_y|to_x|to_y|delta_x|delta_y)$/u.test(key) && typeof value === 'number')) };
        }) };
      protocol.push(record);

    }
    const upstream = await fetch(new URL(request.url, provider.base_url), {
      method: request.method, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      ...(raw.length ? { body: raw } : {}),
    });
    if (record) record.httpStatus = upstream.status;
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
async function waitForProgress(predicate, label, timeout = 180_000, requireActiveTurn = false) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const status = await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-status');
    if (status === 'failed' || status === 'canceled') {
      const id = await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-id');
      const response = await request('GET', `/_redeven_proxy/api/ai/threads/${id}`);
      const root = response.data ?? response;
      throw new Error(`${label}: thread ${id} ${status} (${root.thread?.run_error_code ?? 'unknown'})`);
    }
    if (await predicate()) return;
    if (requireActiveTurn && status === 'success') throw new Error(`${label}: model turn completed without the required fixture outcome`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out`);
}
const stageHasImage = () => page.evaluate(() => {
  const image = document.querySelector('.flower-computer-stage-frame');
  return image?.naturalWidth >= 640 && image.complete;
});

const evidence = [];
const ownedThreads = new Set();
let threadID;
let nativeDirectory;
let nativeProcess;
let nativeExit;
let nativeEvidence;
const nativeRequested = process.env.REDEVEN_COMPUTER_NATIVE_E2E === '1';
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
    `Open ${fixtureURL}/controls using browser.navigate. Inspect it with computer.screenshot. Use computer.double_click on Double click me. Click the text input, use computer.type to enter Flower, and computer.key to press Enter. Use computer.scroll to scroll down and computer.wait to wait for the page. Use browser.reload to reload it. Navigate to ${fixtureURL}/second, then use browser.back to return to /controls. Take a final screenshot and report the result. Use only browser and computer tools; do not use terminal or HTTP fetch.`,
  ].entries()) {
    const composer = page.locator('.flower-surface textarea').first();
    await composer.fill(prompt);
    await composer.press('Enter');
    await page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline').first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => Boolean(document.querySelector('.flower-surface')?.getAttribute('data-flower-selected-thread-id')));
    threadID = await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-id');
    ownedThreads.add(threadID);
    console.log(`Turn ${index + 1} submitted through Flower Composer.`);
    await waitForProgress(stageHasImage, 'Stage image');
    if (index < 2) {
      await waitForProgress(() => completed >= index + 1, 'fixture click');
      assert.equal(completed, index + 1, 'the actual fixture click did not finish');
    }
    await waitForProgress(async () => await page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline').count() === 0, 'turn completion');
    await page.waitForFunction(() => {
      const image = document.querySelector('.flower-computer-stage-frame');
      return image?.naturalWidth >= 640 && image.complete;
    });
    if (index === 2) {
      assert(controls.double && controls.entered && controls.scrolled && controls.loads >= 3 && controls.second,
        'the actual double click, text entry, keyboard, scroll, reload, and history fixture did not finish');
    }
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
    evidence.push({ turn: index + 1, fixtureCompleted: completed, ...(index === 2 ? { controls: { ...controls } } : {}), frame, screenshot });
    console.log(JSON.stringify(evidence.at(-1)));
  }
  if (nativeRequested) {
    assert.equal(process.platform, 'darwin', 'native qualification requires macOS');
    nativeDirectory = await mkdtemp(path.join(output, 'native-fixture-'));
    const executable = path.join(nativeDirectory, 'Fixture');
    const resultFile = path.join(nativeDirectory, 'result.json');
    await promisify(execFile)('swiftc', [path.join(root, 'scripts/fixtures/nativeComputerUse.swift'), '-o', executable, '-framework', 'AppKit']);
    nativeProcess = spawn(executable, [resultFile], { stdio: 'ignore' });
    nativeExit = once(nativeProcess, 'exit');
    await waitForProgress(() => readFile(resultFile).then(() => true, () => false), 'native fixture readiness', 15_000);
    const nativeTurns = [];
    for (const [index, prompt] of [
      'In the macOS Flower Native Fixture application, inspect the desktop and click Complete native step exactly twice. Take a fresh screenshot to check that Clicks is 2. Use computer tools for the native desktop, not the managed browser or terminal.',
      'Continue in the macOS Flower Native Fixture application. Double click the blue area. Enter Flower in the text field and press Enter. Click inside the Scroll area and scroll down. Wait for the app to settle, then take a fresh screenshot to verify all four indicators are complete. Use only computer tools on the native desktop.',
      'In the same macOS Flower Native Fixture application, click Complete native step exactly two more times. Take a fresh screenshot after each click and confirm Clicks is 4, with the other indicators still complete. Use only computer tools on the native desktop.',
    ].entries()) {
      const expectedClicks = index === 2 ? 4 : 2;
      const composer = page.locator('.flower-surface textarea').first();
      await composer.fill(prompt); await composer.press('Enter');
      await page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline').first().waitFor({ state: 'visible' });
      console.log(`Native application turn ${index + 1} submitted through Flower Composer.`);
      await waitForProgress(async () => {
        const state = JSON.parse(await readFile(resultFile, 'utf8'));
        return state.clicks === expectedClicks && (index === 0 || state.complete && state.scrollOffset > 0 && state.wheelEvents > 0);
      }, 'native fixture effects', 180_000, true);
      await waitForProgress(async () => await page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline').count() === 0, 'native turn completion');
      await waitForProgress(stageHasImage, 'native Stage image');
      const frame = await page.evaluate(() => {
        const img = document.querySelector('.flower-computer-stage-frame');
        const stage = document.querySelector('.flower-computer-stage');
        return { target: stage.getAttribute('data-computer-target'), width: img.naturalWidth, height: img.naturalHeight, blob: img.src.startsWith('blob:'), visibleText: stage.innerText.trim(), role: stage.getAttribute('role') };
      });
      assert(frame.blob && frame.visibleText === '' && frame.role === 'dialog');
      const state = JSON.parse(await readFile(resultFile, 'utf8'));
      assert.equal(state.clicks, expectedClicks, 'native action count changed after reaching the intermediate success state');
      if (index > 0) assert(state.complete && state.scrollOffset > 0 && state.wheelEvents > 0, 'native final state regressed before turn completion');
      assert.equal(frame.target, 'desktop-main', 'Stage is showing another target');
      assert.equal(frame.width, state.geometry.displayWidth);
      assert.equal(frame.height, state.geometry.displayHeight);
      const screenshot = path.join(output, `native-turn-${index + 1}.png`);
      await page.screenshot({ path: screenshot });
      nativeTurns.push({ frame, state, screenshot });
      console.log(JSON.stringify({ nativeTurn: index + 1, frame, state }));
    }
    nativeEvidence = { turns: nativeTurns };
    nativeProcess.kill('SIGTERM');
    await nativeExit;
    nativeProcess = undefined;
    await rm(nativeDirectory, { recursive: true, force: true });
    nativeDirectory = undefined;
  }
  console.log('Browser and native task effects verified; checking Stage reopen and settings.');
  await page.locator('.flower-computer-stage-close').click();
  assert.equal(await page.locator('.flower-computer-stage').count(), 0, 'closing Stage must hide the viewer');
  await page.locator('.flower-activity-inline-button[aria-expanded="false"]').filter({ hasText: /^screenshot/u }).last().click();
  await page.locator('.flower-activity-computer-block .flower-activity-inline-button').last().click();
  await waitForProgress(stageHasImage, 'reopened Stage image');
  await page.locator('.flower-chat-header-actions > .flower-header-icon-button').last().click();
  const toggle = page.locator('.flower-settings-computer-use-section [role="switch"]');
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await toggle.click();
  await page.waitForFunction(() => {
    const toggle = document.querySelector('.flower-settings-computer-use-section [role="switch"]');
    return toggle?.getAttribute('aria-checked') === 'false' && !toggle.disabled;
  });
  await page.locator('.flower-settings-back-button').click();
  await page.locator('.flower-new-chat-button').click();
  const disabledRequestStart = protocol.length;
  const composer = page.locator('.flower-surface textarea').first();
  await composer.fill('Reply Ready without using tools.');
  await composer.press('Enter');
  await page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline').first().waitFor({ state: 'visible' });
  ownedThreads.add(await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-id'));
  await waitForProgress(async () => await page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline').count() === 0, 'turn completion');
  const disabledRequests = protocol.slice(disabledRequestStart);
  assert(disabledRequests.length > 0, 'disabled-settings turn never reached the provider');
  assert(disabledRequests.every((entry) => entry.tools.every((tool) => !/^(computer|browser)[_.]/u.test(tool))), 'disabled setting still registered computer/browser tools');
  assert.equal(await page.locator('.flower-computer-stage').count(), 0, 'new disabled turn displayed a stale Stage');
  await page.locator('.flower-chat-header-actions > .flower-header-icon-button').last().click();
  await toggle.waitFor();
  await toggle.click();
  await page.waitForFunction(() => {
    const toggle = document.querySelector('.flower-settings-computer-use-section [role="switch"]');
    return toggle?.getAttribute('aria-checked') === 'true' && !toggle.disabled;
  });
  await page.locator('.flower-settings-back-button').click();
  await page.locator('.flower-new-chat-button').click();
  const enabledRequestStart = protocol.length;
  await composer.fill(`Open ${fixtureURL} using browser.navigate, inspect it with computer.screenshot, and report the button label. Do not click it or use terminal or HTTP fetch.`);
  await composer.press('Enter');
  await page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline').first().waitFor({ state: 'visible' });
  ownedThreads.add(await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-id'));
  await page.waitForFunction(() => document.querySelector('.flower-computer-stage-frame')?.naturalWidth === 1280, null, { timeout: 180_000 });
  await waitForProgress(async () => await page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline').count() === 0, 'turn completion');
  assert(protocol.slice(enabledRequestStart).some((entry) => entry.imageToolOutput), 're-enabled setting did not restore visual tool execution');
  assert.equal(completed, 2, 'observation-only turn unexpectedly mutated the fixture');
  console.log('Settings disabled and re-enabled through Flower; starting a separate sign-in thread.');
  await page.locator('.flower-new-chat-button').click();
  await composer.fill(`Open ${fixtureURL}/signin in the managed browser. Pause for me to sign in, then report the heading after I return control. Use only browser and computer tools.`);
  await composer.press('Enter');
  const takeControl = page.locator('[data-computer-control-action="take"]');
  await takeControl.waitFor({ timeout: 180_000 });
  const takeoverThread = await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-id');
  ownedThreads.add(takeoverThread);
  assert.equal(await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-status'), 'waiting_user');
  console.log('Canonical computer takeover is visible; entering private fixture input through Stage.');
  await takeControl.click();
  await waitForProgress(stageHasImage, 'user takeover image');
  const userImage = page.locator('.flower-computer-stage-frame');
  await userImage.focus();
  // Desktop IPC has no renderer HTTP response. Wait for each returned frame
  // before the next input so an unknown input outcome is never replayed.
  const userKey = async (key) => {
    const before = await userImage.getAttribute('src');
    await userImage.press(key);
    await waitForProgress(async () => await userImage.getAttribute('src') !== before, 'user key frame', 15000);
  };
  await userKey('u');
  await userKey('Tab');
  // Paste is not used: the fixture verifies actual per-key input and keeps it
  // out of model history, activity and persisted evidence.
  for (const key of privateFixtureInput) await userKey(key);
  await userKey('Enter');
  await waitForProgress(() => loginCompleted, 'sign-in fixture completion', 15000);
  const userPixels = await page.evaluate(() => {
    const image = document.querySelector('.flower-computer-stage-frame');
    return { width: image.naturalWidth, height: image.naturalHeight, role: image.closest('[role="dialog"]').getAttribute('role'), visibleText: image.closest('[role="dialog"]').innerText.trim() };
  });
  assert.equal(userPixels.visibleText, '');
  const pending = await request('GET', `/_redeven_proxy/api/ai/threads/${takeoverThread}`);
  assert.equal(JSON.stringify(pending).includes(privateFixtureInput), false, 'private user input entered thread history');
  await page.locator('[data-computer-control-action="return"]').click();
  await waitForProgress(async () => await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-status') === 'success', 'model continuation after handback');
  takeoverEvidence = { threadID: takeoverThread, fixtureComplete: loginCompleted, inputVerified: loginInputVerified, userPixels, privateInputExcluded: true, continued: true };
  assert(threadID, 'Composer did not expose the actual selected thread');
  const detail = await request('GET', `/_redeven_proxy/api/ai/threads/${threadID}`);
  const activities = [];
  const collect = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.presentation && /^(computer|browser)\./u.test(value.tool_name ?? '')) activities.push({ tool: value.tool_name, toolID: value.tool_id, targetRefs: value.presentation.target_refs });
    for (const child of Object.values(value)) if (typeof child === 'object') collect(child);
  };
  collect(detail);
  const expectedTools = ['browser.navigate', 'browser.back', 'browser.reload', 'computer.screenshot', 'computer.click', 'computer.double_click', 'computer.type', 'computer.key', 'computer.scroll', 'computer.wait'];
  for (const tool of expectedTools) assert(activities.some((item) => item.tool === tool), `actual thread did not execute ${tool}`);
  assert(activities.some((item) => item.targetRefs?.some((ref) => ref.resource_ref?.startsWith('computer://'))), 'public thread lost media provenance');
  if (nativeRequested) {
    const nativeTools = activities.filter((item) => item.targetRefs?.some((ref) => ref.resource_ref?.startsWith('computer://desktop-main/'))).map((item) => item.tool);
    for (const tool of expectedTools.filter((name) => name.startsWith('computer.'))) assert(nativeTools.includes(tool), `native desktop did not complete ${tool}`);
  }
  assert(protocol.some((entry) => entry.imageToolOutput), 'the actual provider never received a tool-result image');
  assert.equal(protocolErrors.length, 0, 'provider protocol assertions failed');
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify({ scope: nativeRequested ? 'managed-browser-and-native-desktop-ui' : 'managed-browser-desktop-ui', nativeEvidence, takeoverEvidence, model, fixtureURL, evidence, protocol, threadID, settingsThreadIDs: [...ownedThreads].filter((id) => id !== threadID), activities, stageReopened: true, settingsToggle: 'on-off-on', disabledToolsAbsent: true, reenabledVisualExecution: true }, null, 2));
  console.log(`${nativeRequested ? 'Managed-browser and native desktop' : 'Managed-browser'} Desktop UI qualification passed; login takeover passed; other target and safety scenarios require separate qualification.`);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), mask: [page.locator('.flower-computer-stage')] }).catch(() => undefined);
  const nativeState = nativeDirectory ? await readFile(path.join(nativeDirectory, 'result.json'), 'utf8').then(JSON.parse, () => null) : null;
  const failedThreadID = await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-id').catch(() => null);
  const current = failedThreadID ? await request('GET', `/_redeven_proxy/api/ai/threads/${failedThreadID}`).catch(() => null) : null;
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ threadID: failedThreadID, completed, controls, evidence, nativeEvidence, nativeState, protocol, protocolErrors, current, failure: String(error).split('\n')[0] }, null, 2));
  throw error;
} finally {
  if (nativeProcess) { nativeProcess.kill('SIGKILL'); await nativeExit; }
  if (nativeDirectory) await rm(nativeDirectory, { recursive: true, force: true });
  for (const id of ownedThreads) if (id) await request('POST', `/_redeven_proxy/api/ai/threads/${id}/cancel`).catch(() => undefined);
  await request('PUT', '/_redeven_proxy/api/ai/provider_bundle', {
    model_profile: { current_model_id: `${provider.id}/${model}`, providers: [provider] },
    provider_api_key_patches: [], web_search_provider_key_patches: [],
  }).catch(() => undefined);
  server.closeAllConnections(); server.close();
  proxy.closeAllConnections(); proxy.close();
  await browser.close();
}
