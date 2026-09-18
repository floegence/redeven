/* global chrome, document, fixtureResponses, fixtureWaiters, fixtureWait, fixtureDeliver */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { stageBrowserExtension } from '../../../../scripts/stage_browser_extension.mjs';

// Native framing and Runtime authorization have independent Go coverage. This
// fixture substitutes only the native port and uses real extension/debugger
// APIs against a disposable Chromium profile, never the user's browser.
test('extension binds one tab, creates background tabs, preserves login, and fails closed on detach', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flower-extension-'));
  const extension = path.join(directory, 'extension'); stageBrowserExtension(extension);
  // Attach without Playwright's page defaults: real user Chrome has no
  // pre-existing focus emulation from a second automation owner.
  const chromeProcess = spawn(chromium.executablePath(), ['--headless=new', '--no-first-run', '--remote-debugging-port=0',
    `--user-data-dir=${path.join(directory, 'profile')}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const chromeExited = once(chromeProcess, 'exit');
  t.after(async () => { chromeProcess.kill('SIGTERM'); await chromeExited; await rm(directory, { recursive: true, force: true }); });
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('fixture Chrome startup timeout')), 10000);
    chromeProcess.once('error', error => { clearTimeout(timer); reject(error); });
    chromeProcess.once('exit', () => { clearTimeout(timer); reject(new Error('fixture Chrome exited')); });
    chromeProcess.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-8192);
      const address = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(stderr)?.[1];
      if (address) { clearTimeout(timer); resolve(address); }
    });
  });
  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  const context = browser.contexts()[0];
  const server = http.createServer((request, response) => {
    if (request.url === '/export') {
      response.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename=extension.csv' });
      response.end('fixture,42\n'); return;
    }
    response.setHeader('content-type', 'text/html');
    if (request.url === '/nested') { response.end('<input aria-label="Nested query"><button onclick="this.textContent=\'Nested done\'">Nested apply</button>'); return; }
    if (request.url === '/outer') { response.end(`<iframe src="http://127.0.0.1:${server.address().port}/nested"></iframe>`); return; }
    response.end("<title>Work</title><input aria-label='Query'><button>Apply</button><a href='/export'>Export</a><button onclick=\"window.open('/popup')\">Open details</button>"
      + (request.url === '/task' ? `<iframe src="http://localhost:${server.address().port}/outer"></iframe>` : ''));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const origins = [origin, `http://localhost:${server.address().port}`];
  try {
    const identity = await readFile(fileURLToPath(new URL('../../../browserbridge/identity.go', import.meta.url)), 'utf8');
    const extensionID = /const ExtensionID = "([a-p]+)"/u.exec(identity)[1];
    const isFlower = worker => worker.url() === `chrome-extension://${extensionID}/background.mjs`;
    const worker = context.serviceWorkers().find(isFlower) || await context.waitForEvent('serviceworker', { predicate: isFlower, timeout: 10000 });
    await worker.evaluate(() => {
      globalThis.fixtureResponses = [];
      globalThis.fixtureWaiters = new Map();
      globalThis.fixtureWait = id => {
        if (fixtureResponses.some(message => (message.id || message.type) === id)) return Promise.resolve();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { fixtureWaiters.delete(id); reject(new Error('native response timeout')); }, 5000);
          fixtureWaiters.set(id, () => { clearTimeout(timer); resolve(); });
        });
      };
      chrome.runtime.connectNative = () => ({
        onMessage: { addListener(fn) { globalThis.fixtureDeliver = fn; } },
        onDisconnect: { addListener(fn) { globalThis.fixtureDisconnect = fn; } },
        postMessage(message) { globalThis.fixtureResponses.push(message); globalThis.fixtureWaiters.get(message.id || message.type)?.(); }, disconnect() {},
      });
    });
    const user = await context.newPage(); await user.goto(origin + '/user');
    const task = await context.newPage(); await task.goto(origin + '/task');
    await context.addCookies([{ name: 'login', value: 'present', url: origin }]);
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionID}/popup.html#dev.floegence.redeven.r123456789abcdef0`);
    await popup.locator('#connect-button').click();
    await worker.evaluate(() => fixtureWait('hello'));
    await worker.evaluate(() => fixtureDeliver({ type: 'ready', protocol_version: 6 }));
    let sequence = 0;
    const call = async (command, args = {}) => {
      const id = String(++sequence);
      await worker.evaluate(message => fixtureDeliver(message), { id, command, arguments: args });
      await worker.evaluate(id => fixtureWait(id), id);
      const response = await worker.evaluate(id => fixtureResponses.find(message => message.id === id), id);
      if (response.error) throw new Error(response.error); return response.result;
    };
    const inventory = await call('inventory');
    const selected = inventory.find(tab => tab.url === origin + '/task');
    assert.ok(selected);
    await task.evaluate(() => { document.title = 'Changed since selection'; });
    await assert.rejects(call('bind', { tab_id: selected.id, tab_title: selected.title, tab_url: selected.url }), /EXTENSION_COMMAND_FAILED/);
    await task.evaluate(() => { document.title = 'Work'; });
    await user.bringToFront();
    assert.equal(await task.evaluate(() => document.hasFocus()), false);
    await call('bind', { tab_id: selected.id, tab_title: selected.title, tab_url: selected.url });
    await call('reveal', { tab_id: selected.id });
    const activated = await worker.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }));
    assert.equal(String(activated[0].id), selected.id, 'reveal must activate exactly the bound browser tab');
    await assert.rejects(call('reveal', { tab_id: '99999999' }), /EXTENSION_COMMAND_FAILED/);
    await user.bringToFront();

    const execute = async (tool_name, args = {}) => call('execute', { tab_id: selected.id, request: { tool_name, args, full_access: true, script_operation: true } });
    // OOP frame attachment can invalidate an initial read. Follow the explicit
    // observation contract without repeating any effect or selecting a new tab.
    let observed;
    for (let reads = 0; reads < 3; reads++) {
      observed = await execute('computer.observe');
      if (!observed.result?.observation_invalidated) break;
    }
    assert.ok(observed.result?.observation, JSON.stringify(observed));
    assert.equal(observed.safety?.level, 'routine', JSON.stringify(observed));
    assert.equal(observed.error, undefined, JSON.stringify(observed));
    assert.equal(observed.screenshot, undefined);
    await t.test('debugger inspection failure stays technical and permits a fresh observation', async () => {
      await worker.evaluate(() => {
        globalThis.fixtureSendCommand = chrome.debugger.sendCommand.bind(chrome.debugger);
        chrome.debugger.sendCommand = async (target, method, args) => {
          if (method === 'DOMSnapshot.captureSnapshot') throw new Error('private inspection failure');
          return globalThis.fixtureSendCommand(target, method, args);
        };
      });
      try {
        const failed = await execute('computer.screenshot');
        assert.equal(failed.error, 'TARGET_OBSERVATION_UNAVAILABLE');
        assert.equal(failed.result.action_executed, false);
        assert.equal(failed.result.observation_stage, 'safety_scan');
        assert.equal(failed.screenshot, undefined);
        assert.equal(failed.safety, undefined);
        assert.equal(JSON.stringify(failed).includes('private inspection failure'), false);
      } finally {
        await worker.evaluate(() => { chrome.debugger.sendCommand = globalThis.fixtureSendCommand; delete globalThis.fixtureSendCommand; });
      }
      const fresh = await execute('computer.observe');
      assert.equal(fresh.safety.level, 'routine', JSON.stringify(fresh));
      assert.ok(fresh.result.observation);
    });
    await user.bringToFront();
    const activeBeforeInput = await worker.evaluate(async () => (await chrome.tabs.query({ active: true })).map(tab => tab.id));
    assert.equal(await task.evaluate(() => document.hasFocus()), true, 'background page needs virtual focus without activating its tab: ' + JSON.stringify(observed));
    await call('unbind', { tab_id: selected.id });
    assert.equal(await task.evaluate(() => document.hasFocus()), false, 'detach must release virtual focus');
    await call('bind', { tab_id: selected.id, tab_title: selected.title, tab_url: selected.url });
    await execute('computer.observe');
    const nested = await execute('computer.action', { action: 'fill', selector: { role: 'textbox', name: 'Nested query' }, text: 'Cross-site value' });
    assert.equal(nested.error, undefined, JSON.stringify(nested));
    assert.equal(nested.safety?.level, 'routine', JSON.stringify(nested));
    assert.equal(nested.result?.action_executed, true, JSON.stringify(nested));
    assert.equal(await task.frameLocator('iframe').frameLocator('iframe').locator('input').inputValue(), 'Cross-site value');
    const nestedClick = await execute('computer.action', { action: 'click', selector: { role: 'button', name: 'Nested apply' } });
    assert.equal(nestedClick.error, undefined, JSON.stringify(nestedClick));
    assert.equal(await task.frameLocator('iframe').frameLocator('iframe').locator('button').textContent(), 'Nested done');
    await execute('computer.action', { action: 'fill', selector: { role: 'textbox', name: 'Query' }, text: 'Completed' });
    assert.equal(await task.locator('input').inputValue(), 'Completed');
    assert.equal(await user.locator('input').inputValue(), '');
    assert.deepEqual(await worker.evaluate(async () => (await chrome.tabs.query({ active: true })).map(tab => tab.id)), activeBeforeInput);
    assert.equal((await context.cookies(origin))[0].value, 'present');
    await user.bringToFront();
    const activeBefore = await worker.evaluate(async () => (await chrome.tabs.query({ active: true })).map(tab => tab.id));
    const created = await call('new_tab');
    assert.ok(created.tab_id);
    assert.deepEqual(await worker.evaluate(async () => (await chrome.tabs.query({ active: true })).map(tab => tab.id)), activeBefore);
    // A slow wait on one target must not block another target or tear down the
    // profile when cancelled. The extension receives real concurrent messages.
    const waitID = String(++sequence);
    await worker.evaluate(message => fixtureDeliver(message), { id: waitID, command: 'execute', arguments: { tab_id: selected.id,
      request: { tool_name: 'computer.action', script_operation: true, allowed_origins: origins, args: { action: 'wait', selector: { role: 'button', name: 'Never present' }, timeout_ms: 10000 } } } });
    const sibling = await call('execute', { tab_id: created.tab_id, request: { tool_name: 'computer.observe', args: {}, allowed_origins: [] } });
    assert.equal(sibling.safety.level, 'routine');
    await worker.evaluate(id => fixtureDeliver({ type: 'cancel', id }), waitID);
    await worker.evaluate(id => fixtureWait(id), waitID);
    const cancelled = await worker.evaluate(id => fixtureResponses.find(message => message.id === id), waitID);
    assert.equal(cancelled.result.safety.level, 'takeover');
    assert.equal((await call('execute', { tab_id: created.tab_id, request: { tool_name: 'computer.observe', args: {} } })).safety.level, 'routine');
    await call('execute', { tab_id: selected.id, request: { tool_name: 'computer.screenshot', return_control: true, allowed_origins: origins } });
    await task.keyboard.press('Escape');
    assert.equal((await execute('computer.action', { action: 'fill', selector: { role: 'textbox', name: 'Query' }, text: 'Continued' })).safety.level, 'routine');
    assert.equal(await task.locator('input').inputValue(), 'Continued');
    await call('execute', { tab_id: selected.id, request: { tool_name: 'computer.screenshot', return_control: true, allowed_origins: origins } });
    await user.bringToFront();
    const activeBeforeDownload = await worker.evaluate(async () => (await chrome.tabs.query({ active: true })).map(tab => tab.id));
    await execute('computer.action', { action: 'click', selector: { role: 'link', name: 'Export' } });
    const downloaded = await execute('browser.wait_for_download', { timeout_ms: 5000 });
    assert.equal(downloaded.result.download.state, 'completed', JSON.stringify(downloaded));
    assert.equal(downloaded.result.download.filename, 'extension.csv');
    assert.equal(downloaded.result.download.path, undefined, 'extension must not expose filesystem paths');
    assert.deepEqual(await worker.evaluate(async () => (await chrome.tabs.query({ active: true })).map(tab => tab.id)), activeBeforeDownload);
    await t.test('native popup remains a separate unbound target', async () => {
    const popupResult = await execute('computer.action', { action: 'click', selector: { role: 'button', name: 'Open details' } });
    assert.equal(popupResult.safety.level, 'routine');
    assert.equal(popupResult.result.target_changed, true);
    assert.equal(popupResult.result.action_executed, true);
    const popupTabs = await call('inventory');
    const child = popupTabs.find(tab => tab.url === origin + '/popup');
    assert.ok(child);
    assert.equal(child.opener_tab_id, popupResult.result.opener_tab_id);
    assert.equal(child.opener_tab_id, selected.id);
    assert.equal((await call('execute', { tab_id: child.id, request: { tool_name: 'computer.observe', args: {} } })).error, 'TARGET_CONNECTION_REQUIRED');
    await call('bind', { tab_id: child.id, tab_url: child.url, tab_title: child.title });
    const childResult = await call('execute', { tab_id: child.id, request: { tool_name: 'computer.observe', args: {}, full_access: true } });
    assert.equal(childResult.safety.level, 'routine');
    assert.equal((await call('inventory')).filter(tab => tab.url === origin + '/popup').length, 1);
    });
    await call('unbind', { tab_id: selected.id });
    assert.equal((await execute('computer.action', { action: 'fill', selector: { role: 'textbox', name: 'Query' }, text: 'Forbidden' })).error, 'TARGET_CONNECTION_REQUIRED');
    assert.equal(await task.locator('input').inputValue(), 'Continued');
    await task.close();
    assert.equal((await execute('computer.observe')).error, 'TARGET_CONNECTION_REQUIRED');
  } finally { await browser.close(); server.close(); }
});
