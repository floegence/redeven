/* global document */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

test('semantic browser reads, fills, waits and rejects stale or ambiguous nodes without per-action images', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'https://unapproved.invalid/landing' }); res.end(); return; }
    res.setHeader('content-type', 'text/html');
    res.end(req.url === '/next' ? '<h1>Next document</h1>' : `<!doctype html><title>Semantic fixture</title>
      <label>Search<input aria-label="Search"></label>
      <button onclick="document.querySelector('output').textContent=document.querySelector('input').value">Apply</button>
      <output aria-label="Result"></output><button>Duplicate</button><button>Duplicate</button>
      <div style="position:absolute;top:100px;left:100px;width:200px;height:100px;overflow:auto" onscroll="document.querySelector('output').setAttribute('aria-label','Scrolled region')"><div style="height:1000px">Scroll region</div></div>
      <button onclick="setTimeout(()=>{const b=document.createElement('button');b.textContent='Ready';document.body.append(b)},100)">Load</button>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(path.join(os.tmpdir(), 'flower-semantic-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./redevenComputerHost.mjs', import.meta.url)), '--profile', root], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data.toString(); });
  const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let nextID = 0;
  const next = async () => {
    let timer;
    try {
      const result = await Promise.race([lines.next(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`helper timed out: ${stderr}`)), 15000); })]);
      assert.equal(result.done, false, stderr);
      return JSON.parse(result.value);
    } finally { clearTimeout(timer); }
  };
  const send = async (tool_name, args = {}, fields = {}) => {
    const id = String(++nextID);
    child.stdin.write(JSON.stringify({ id, target_id: 'fixture', session_id: 'test-turn', allowed_origins: [origin], tool_name, args, ...fields }) + '\n');
    const result = await next();
    assert.equal(result.id, id);
    return result;
  };
  try {
    const ready = await next();
    assert.equal(ready.protocol_version, 2);
    assert.equal(ready.error, undefined, JSON.stringify(ready));
    assert.ok((await send('browser.navigate', { url: origin })).screenshot);
    const observed = await send('computer.observe');
    assert.equal(observed.error, undefined, JSON.stringify(observed));
    assert.equal(observed.screenshot, undefined);
    const input = observed.result.observation.nodes.find(node => node.role === 'textbox' && node.name === 'Search');
    assert.ok(input, JSON.stringify(observed));
    const perform = async (args) => send('computer.action', args, { script_operation: true });
    const filled = await perform({ action: 'fill', selector: { ref: input.ref }, text: 'Completed' });
    assert.equal(filled.error, undefined, JSON.stringify(filled));
    assert.equal(filled.screenshot, undefined);
    const read = await perform({ action: 'read', selector: { role: 'textbox', name: 'Search' } });
    assert.equal(read.result.node.value, 'Completed');
    const ambiguous = await perform({ action: 'click', selector: { role: 'button', name: 'Duplicate' } });
    assert.equal(ambiguous.error, 'AMBIGUOUS_ELEMENT');
    const invalidScroll = await send('computer.scroll', { x: 150, delta_y: 200 }, { script_operation: true });
    assert.equal(invalidScroll.error, 'INVALID_REQUEST');
    const scrolled = await send('computer.scroll', { x: 150, y: 150, delta_y: 200 }, { script_operation: true });
    assert.equal(scrolled.error, undefined, JSON.stringify(scrolled));
    const scrollResult = await perform({ action: 'wait', selector: { role: 'status', name: 'Scrolled region' }, timeout_ms: 3000 });
    assert.equal(scrollResult.error, undefined, JSON.stringify(scrollResult));
    await perform({ action: 'click', selector: { role: 'button', name: 'Load' } });
    const waited = await perform({ action: 'wait', selector: { role: 'button', name: 'Ready' }, timeout_ms: 3000 });
    assert.equal(waited.error, undefined, JSON.stringify(waited));
    await send('browser.navigate', { url: origin + '/next' });
    const stale = await perform({ action: 'click', selector: { ref: input.ref } });
    assert.equal(stale.error, 'STALE_REFERENCE');
    const denied = await send('browser.navigate', { url: 'https://unapproved.invalid' });
    assert.equal(denied.safety.level, 'takeover');
    assert.equal(denied.result.action_executed, false);
    assert.equal(denied.screenshot, undefined);
    // An allowed URL may redirect to an ungranted origin. Fetch interception
    // stops the document request before Chromium contacts the new site.
    await send('computer.screenshot', {}, { return_control: true });
    const redirect = await send('browser.navigate', { url: origin + '/redirect' }, { script_operation: true });
    assert.equal(redirect.safety.level, 'takeover');
    assert.equal(redirect.safety.required_origin, 'https://unapproved.invalid');
    assert.equal(redirect.screenshot, undefined);

  } finally {
    child.stdin.end();
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('inventory and explicit tab attachment preserve the browser, other tabs and signed-in state', async () => {
  const { chromium } = await import('playwright');
  const { readFile } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execute = promisify(execFile);
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<title>Signed-in task</title><label>Search<input aria-label="Search"></label>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flower-connected-'));
  const context = await chromium.launchPersistentContext(directory, { headless: true, args: ['--remote-debugging-port=0'] });
  let helper;
  try {
    const other = await context.newPage(); await other.goto('about:blank#user-work');
    const selected = await context.newPage(); await selected.goto(origin);
    await context.addCookies([{ name: 'fixture_login', value: 'signed-in', url: origin }]);
    const port = (await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    const endpoint = `http://127.0.0.1:${port}`;
    const inventoryPath = fileURLToPath(new URL('./redevenBrowserInventory.mjs', import.meta.url));
    const inventory = JSON.parse((await execute(process.execPath, [inventoryPath, endpoint], { timeout: 10000 })).stdout);
    assert.equal(inventory.protocol_version, 2);
    assert.equal(other.isClosed(), false); assert.equal(selected.isClosed(), false);
    const chosen = inventory.tabs.find(tab => tab.url === origin + '/');
    assert.ok(chosen);
    const tabCount = context.pages().length;
    helper = spawn(process.execPath, [fileURLToPath(new URL('./redevenComputerHost.mjs', import.meta.url)), '--cdp-url', endpoint, '--tab-id', chosen.id, '--browser-context-id', chosen.profile_id], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = readline.createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
    const next = async () => {
      let timeout;
      try { return JSON.parse((await Promise.race([lines.next(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('helper timed out')), 10000); })])).value); }
      finally { clearTimeout(timeout); }
    };
    assert.equal((await next()).protocol_version, 2);
    helper.stdin.write(JSON.stringify({ id: 'observe', target_id: 'connected', session_id: 'turn', tool_name: 'computer.observe', args: {}, allowed_origins: [origin] }) + '\n');
    const observed = await next();
    assert.equal(observed.result.title, 'Signed-in task');
    assert.ok(observed.result.observation.nodes.some(node => node.name === 'Search'));
    assert.equal(context.pages().length, tabCount); assert.equal(other.url(), 'about:blank#user-work');
    assert.equal((await context.cookies(origin)).find(cookie => cookie.name === 'fixture_login').value, 'signed-in');
    const exited = once(helper, 'exit'); helper.stdin.end(); await exited;
    assert.equal(selected.isClosed(), false); assert.equal(other.isClosed(), false);
    assert.equal(await selected.title(), 'Signed-in task');
    // The same endpoint is still reachable after both inventory and control
    // disconnect; no first-page or replacement-tab selection takes place.
    const again = JSON.parse((await execute(process.execPath, [inventoryPath, endpoint], { timeout: 10000 })).stdout);
    assert.ok(again.tabs.some(tab => tab.id === chosen.id));
  } finally {
    if (helper && helper.exitCode === null) { const exited = once(helper, 'exit'); helper.kill(); await exited; }
    await context.close(); server.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('keyboard and iframe input continue through incidental input; explicit cancellation releases held buttons', async () => {
  const { chromium } = await import('playwright');
  const { BrowserComputerController } = await import('./computerBrowserController.mjs');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<input aria-label="Entry"><iframe srcdoc="<input aria-label=Nested>"></iframe>');
    const session = await page.context().newCDPSession(page);
    const controller = new BrowserComputerController(session); await controller.initialize();
    const call = (action, args = {}) => controller.execute({ tool_name: 'computer.action', args: { action, ...args }, script_operation: true });
    const selector = { role: 'textbox', name: 'Entry' };
    for (const [key, value] of [['a', 'a'], ['Shift+b', 'aB'], ['Backspace', 'a'], ['Home', 'a'], ['Delete', ''], ['End', ''], ['Space', ' ']]) {
      const result = await call('key', { selector, key });
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.safety.level, 'routine', JSON.stringify(result));
      assert.equal(await page.locator('input').inputValue(), value, key);
    }
    await call('fill', { selector, text: 'Erase me' });
    const empty = await call('fill', { selector, text: '' });
    assert.equal(empty.safety.level, 'routine', JSON.stringify(empty));
    assert.equal(await page.locator('input').inputValue(), '');
    assert.equal((await call('key', { selector, key: 'Control+v' })).error, 'TARGET_NOT_ALLOWED');
    // Programmatic focus does not represent user keyboard or pointer input.
    await page.frameLocator('iframe').locator('input').focus();
    const typed = await call('type', { text: 'Nested value' });
    assert.equal(typed.safety.level, 'routine', JSON.stringify(typed));
    assert.equal(await page.frameLocator('iframe').locator('input').inputValue(), 'Nested value');
    // Incidental input is not an explicit Flower takeover request.
    await page.keyboard.press('x');
    const continued = await call('fill', { selector, text: 'Continued' });
    assert.equal(continued.safety.level, 'routine');
    assert.equal(continued.result.action_executed, true);
    assert.equal(await page.locator('input').inputValue(), 'Continued');
    const original = session.send.bind(session);
    let interruptedDown = false, releases = 0;
    session.send = async (method, parameters) => {
      const result = await original(method, parameters);
      if (method === 'Input.dispatchMouseEvent' && parameters.type === 'mousePressed') {
        interruptedDown = true;
        controller.cancel();
      }
      if (method === 'Input.dispatchMouseEvent' && parameters.type === 'mouseReleased') releases++;
      return result;
    };
    const stopped = await call('pointer_click', { x: 20, y: 20 });
    assert.equal(interruptedDown, true);
    assert.equal(stopped.safety.level, 'takeover');
    assert.equal(releases, 1, 'the interrupted press must have exactly one balancing release');
    assert.equal(controller.page.heldInput.size, 0);
  } finally { await browser.close(); }
});

test('incidental wheel input does not pause browser work', async () => {
  const { chromium } = await import('playwright');
  const { BrowserComputerController } = await import('./computerBrowserController.mjs');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<style>body{height:5000px}</style><h1>Wheel fixture</h1>');
    const session = await page.context().newCDPSession(page);
    const controller = new BrowserComputerController(session); await controller.initialize();
    const send = session.send.bind(session);
    let delayed = false;
    session.send = async (method, parameters) => {
      if (method === 'Input.dispatchMouseEvent' && parameters.type === 'mouseWheel' && !delayed) {
        delayed = true;
        // A busy renderer/transport may deliver a dispatched event more than
        // a second after its provenance token was installed.
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
      return send(method, parameters);
    };
    const scrolled = await controller.execute({ tool_name: 'computer.scroll', args: { delta_y: 600, delta_x: 0 } });
    assert.equal(scrolled.safety.level, 'routine', JSON.stringify(scrolled.safety));
    await page.waitForFunction(() => document.scrollingElement.scrollTop > 0);
    assert.equal((await controller.execute({ tool_name: 'computer.observe', args: {} })).safety.level, 'routine');
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(() => document.scrollingElement.scrollTop > 600);
    const continued = await controller.execute({ tool_name: 'computer.observe', args: {} });
    assert.equal(continued.safety.level, 'routine');
  } finally { await browser.close(); }
});

test('nested cross-site frames use semantic actions and downloads survive helper shutdown', { timeout: 30000 }, async () => {
  const { readFile } = await import('node:fs/promises');
  let port;
  const server = http.createServer((request, response) => {
    if (request.url === '/export') {
      response.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="results.csv"' });
      response.end('name,count\nfixture,42\n'); return;
    }
    response.setHeader('content-type', 'text/html');
    if (request.url === '/nested') response.end('<input aria-label="Deep entry"><button onclick="this.textContent=\'Applied\'">Apply nested</button>');
    else if (request.url === '/frame') response.end(`<iframe src="http://127.0.0.1:${port}/nested"></iframe>`);
    else response.end(`<a href="/export">Export</a><iframe src="http://localhost:${port}/frame"></iframe>`);
  });
  server.listen(0); await once(server, 'listening'); port = server.address().port;
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flower-frames-downloads-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./redevenComputerHost.mjs', import.meta.url)), '--profile', directory], { stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async () => {
    let timer;
    try { const item = await Promise.race([lines.next(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('helper timed out')), 10000); })]); assert.equal(item.done, false); return JSON.parse(item.value); }
    finally { clearTimeout(timer); }
  };
  let sequence = 0;
  const call = async (tool_name, args = {}) => {
    const id = String(++sequence);
    child.stdin.write(JSON.stringify({ id, target_id: 'fixture', tool_name, args, allowed_origins: origins, script_operation: true }) + '\n');
    const result = await next(); assert.equal(result.id, id); assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.safety?.level, 'routine', JSON.stringify(result)); return result.result;
  };
  try {
    assert.equal((await next()).protocol_version, 2);
    await call('browser.navigate', { url: origins[0] });
    const selector = { role: 'textbox', name: 'Deep entry' };
    assert.equal((await call('computer.action', { action: 'wait', selector, timeout_ms: 5000 })).state, 'visible');
    await call('computer.action', { action: 'fill', selector, text: 'Across processes' });
    assert.equal((await call('computer.action', { action: 'read', selector })).node.value, 'Across processes');
    await call('computer.action', { action: 'click', selector: { role: 'button', name: 'Apply nested' } });
    assert.equal((await call('computer.action', { action: 'wait', selector: { role: 'button', name: 'Applied' }, timeout_ms: 2000 })).state, 'visible');
    await call('computer.action', { action: 'click', selector: { role: 'link', name: 'Export' } });
    const first = (await call('browser.wait_for_download', { timeout_ms: 5000 })).download;
    assert.equal(first.state, 'completed'); assert.equal(first.filename, 'results.csv');
    assert.equal(await readFile(first.path, 'utf8'), 'name,count\nfixture,42\n');
    assert.equal((await call('browser.navigate', { url: origins[0] + '/export' })).download_started, true);
    const second = (await call('browser.wait_for_download', { timeout_ms: 5000 })).download;
    assert.equal(second.state, 'completed'); assert.notEqual(first.id, second.id);
    const timeout = await call('browser.wait_for_download', { id: 'missing', timeout_ms: 5 });
    assert.equal(timeout.state, 'timeout');
    child.stdin.end();
    const shutdown = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await exited; assert.equal(child.exitCode, 0, 'helper must shut down cleanly'); } finally { clearTimeout(shutdown); }
    assert.equal(await readFile(first.path, 'utf8'), 'name,count\nfixture,42\n');
    assert.equal(await readFile(second.path, 'utf8'), 'name,count\nfixture,42\n');
  } finally {
    child.stdin.end();
    const cleanup = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await exited; } finally { clearTimeout(cleanup); }
    server.close(); await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('sensitive DOM transitions during observation discard pixels even after the field disappears', async () => {
  const { chromium } = await import('playwright');
  const { BrowserComputerController } = await import('./computerBrowserController.mjs');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent('<h1>Ordinary page</h1>');
    const session = await page.context().newCDPSession(page);
    const controller = new BrowserComputerController(session); await controller.initialize();
    const send = session.send.bind(session);
    session.send = async (method, parameters) => {
      if (method !== 'Page.captureScreenshot') return send(method, parameters);
      await page.evaluate(() => { const input = document.createElement('input'); input.type = 'password'; input.value = 'private-fixture'; input.id = 'transient'; document.body.append(input); });
      const result = await send(method, parameters);
      await page.evaluate(() => document.getElementById('transient').remove());
      return result;
    };
    const result = await controller.execute({ tool_name: 'computer.screenshot' });
    assert.equal(result.safety.level, 'takeover');
    assert.ok(result.safety.reason_codes.includes('secret_input'));
    assert.equal(result.screenshot, undefined); assert.equal(JSON.stringify(result).includes('private-fixture'), false);
    session.send = send;
    assert.equal((await controller.execute({ tool_name: 'computer.screenshot', return_control: true })).safety.level, 'routine');
    await page.evaluate(() => {
      const host = document.createElement('div'); document.body.append(host);
      host.attachShadow({ mode: 'open' }).innerHTML = '<input autocomplete="one-time-code" aria-label="Private code" value="fixture-code">';
    });
    const shadow = await controller.execute({ tool_name: 'computer.observe' });
    assert.equal(shadow.safety.level, 'takeover');
    assert.equal(shadow.result.observation, undefined);
    assert.equal(JSON.stringify(shadow).includes('fixture-code'), false);
  } finally { await browser.close(); }
});

test('a document change during capture discards the stale frame and requests a fresh observation', async () => {
  const { chromium } = await import('playwright');
  const { BrowserComputerController } = await import('./computerBrowserController.mjs');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent('<h1>Before navigation</h1>');
    const session = await page.context().newCDPSession(page);
    const controller = new BrowserComputerController(session); await controller.initialize();
    const send = session.send.bind(session);
    session.send = async (method, parameters) => {
      const result = await send(method, parameters);
      if (method === 'Page.captureScreenshot') await page.setContent('<h1>After navigation</h1>');
      return result;
    };
    const result = await controller.execute({ tool_name: 'computer.screenshot' });
    assert.equal(result.screenshot, undefined);
    assert.equal(result.safety.level, 'routine', JSON.stringify(result));
    assert.equal(result.result.observation_invalidated, true);
    session.send = send;
    const fresh = await controller.execute({ tool_name: 'computer.observe' });
    assert.ok(fresh.result.observation.nodes.some(node => node.name === 'After navigation'));
  } finally { await browser.close(); }
});

test('closed shadow inputs cannot expose passwords or verification codes to observations', async () => {
  const { chromium } = await import('playwright');
  const { BrowserComputerController } = await import('./computerBrowserController.mjs');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const attributes of ['type="password"', 'autocomplete="one-time-code"']) {
      const page = await browser.newPage();
      await page.setContent('<h1>Account</h1><div id="host"></div>');
      await page.evaluate(attributes => {
        document.getElementById('host').attachShadow({ mode: 'closed' }).innerHTML = `<input ${attributes} aria-label="Private" value="never-export">`;
      }, attributes);
      const controller = new BrowserComputerController(await page.context().newCDPSession(page));
      await controller.initialize();
      const result = await controller.execute({ tool_name: 'computer.observe', args: { screenshot: true } });
      assert.equal(result.safety.level, 'takeover', JSON.stringify(result));
      assert.ok(result.safety.reason_codes.includes('secret_input'));
      assert.equal(result.screenshot, undefined);
      assert.equal(JSON.stringify(result).includes('never-export'), false);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('navigation during a safety read preserves the confirmed action without exporting stale data or requesting takeover', async () => {
  const { chromium } = await import('playwright');
  const { BrowserComputerController } = await import('./computerBrowserController.mjs');
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(request.url === '/saved' ? '<h1>Saved</h1>' : '<input aria-label="Entry">');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    const session = await page.context().newCDPSession(page);
    const controller = new BrowserComputerController(session); await controller.initialize();
    const send = session.send.bind(session);
    let edited = false, invalidated = false;
    session.send = async (method, parameters) => {
      if (edited && !invalidated && method === 'Runtime.evaluate' && parameters.expression.includes('document.body?.innerText')) {
        invalidated = true;
        // Destroy the exact context that safety was about to inspect. This is
        // the real CDP failure produced when a submitted form navigates.
        await page.goto(origin + '/saved');
      }
      const response = await send(method, parameters);
      if (method === 'Runtime.callFunctionOn') edited = true;
      return response;
    };
    const result = await controller.execute({ tool_name: 'computer.action', script_operation: true, allowed_origins: [origin],
      args: { action: 'fill', selector: { role: 'textbox', name: 'Entry' }, text: 'confirmed' } });
    assert.equal(invalidated, true);
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.safety.level, 'routine', JSON.stringify(result));
    assert.deepEqual(result.result, { observation_invalidated: true, action_executed: true, execution_mode: 'background' });
    assert.equal(result.screenshot, undefined);
    assert.equal(controller.userInControl, false);
    session.send = send;
    const fresh = await controller.execute({ tool_name: 'computer.observe', allowed_origins: [origin] });
    assert.ok(fresh.result.observation.nodes.some(node => node.name === 'Saved'), JSON.stringify(fresh));
    // A privacy read failure without navigation remains a real unknown state.
    session.send = async (method, parameters) => {
      if (method === 'DOMSnapshot.captureSnapshot') throw new Error('privacy scan unavailable');
      return send(method, parameters);
    };
    const failed = await controller.execute({ tool_name: 'computer.observe', allowed_origins: [origin] });
    assert.equal(failed.safety.level, 'takeover');
    assert.ok(failed.safety.reason_codes.includes('unknown'));
    assert.equal(failed.result.action_executed, false);
    assert.equal(failed.screenshot, undefined);
  } finally { await browser.close(); server.close(); }
});
