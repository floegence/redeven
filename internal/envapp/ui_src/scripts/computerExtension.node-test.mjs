/* global chrome, document, fixtureResponses, fixtureWaiters, fixtureWait, fixtureDeliver, fixtureDisconnect */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { once, EventEmitter } from 'node:events';
import { BrowserProjection } from '@floegence/floebrowser';
import { createExtensionBrowserSource } from './computerBrowserSource.mjs';
import { spawn } from 'node:child_process';
import { stageBrowserExtension } from '../../../../scripts/stage_browser_extension.mjs';

// Native framing and Runtime authorization have independent Go coverage. This
// fixture substitutes only the native port and uses real extension/debugger
// APIs against a disposable Chromium profile, never the user's browser.
test('extension binds one tab, creates background tabs, preserves login, and fails closed on detach', { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flower-extension-'));
  const extension = path.join(directory, 'extension'); stageBrowserExtension(extension);
  // Attach without Playwright's page defaults: real user Chrome has no
  // pre-existing focus emulation from a second automation owner.
  // Disposable fixtures must not wait for the user's macOS keychain. These
  // storage flags do not enable Playwright focus or other page overrides.
  const chromeProcess = spawn(chromium.executablePath(), ['--headless=new', '--no-first-run', '--remote-debugging-port=0', '--use-mock-keychain', '--password-store=basic',
    `--user-data-dir=${path.join(directory, 'profile')}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const chromeExited = once(chromeProcess, 'exit');
  t.after(async () => {
    chromeProcess.kill('SIGTERM');
    const kill = setTimeout(() => chromeProcess.kill('SIGKILL'), 2000);
    try { await chromeExited; } finally { clearTimeout(kill); }
    await rm(directory, { recursive: true, force: true });
  });
  let sourceDiagnostics = '';
  chromeProcess.stderr.on('data', chunk => { sourceDiagnostics = (sourceDiagnostics + chunk).slice(-8192); });
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
      globalThis.fixtureEvents = [];
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
        postMessage(message) {
          if (message.type === 'cdp_event' || message.type === 'target_unavailable') { globalThis.fixtureEvents.push(message); globalThis.fixtureEventWake?.(); }
          else { globalThis.fixtureResponses.push(message); globalThis.fixtureWaiters.get(message.id || message.type)?.(); }
        }, disconnect() {},
      });
    });
    const user = await context.newPage();
    const navigationEvents = [];
    user.on('request', request => navigationEvents.push(['request', request.url()]));
    user.on('response', response => navigationEvents.push(['response', response.status(), response.url()]));
    user.on('domcontentloaded', () => navigationEvents.push(['domcontentloaded']));
    user.on('load', () => navigationEvents.push(['load']));
    try { await user.goto(origin + '/user'); }
    catch (error) { t.diagnostic(JSON.stringify({ url: user.url(), navigationEvents })); t.diagnostic(sourceDiagnostics); throw error; }
    const task = await context.newPage(); await task.goto(origin + '/task');
    await context.addCookies([{ name: 'login', value: 'present', url: origin }]);
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionID}/popup.html#dev.floegence.redeven.r123456789abcdef0`);
    await t.test('shows Redeven Flower branding in the installed extension and connection page', async () => {
      assert.equal(await popup.title(), 'Redeven Flower');
      assert.equal(await popup.locator('h1').textContent(), 'Redeven Flower');
      await popup.locator('header img').evaluate(image => image.decode());
      assert.equal(await popup.evaluate(() => chrome.runtime.getManifest().action.default_title), 'Redeven Flower');
      const extensions = await context.newPage();
      try {
        await extensions.goto('chrome://extensions/');
        const card = extensions.locator(`extensions-item[id="${extensionID}"]`);
        await card.waitFor({ state: 'visible' });
        assert.equal((await card.locator('#name').textContent()).trim(), 'Redeven Flower');
        const icon = card.locator('img#icon');
        await icon.evaluate(image => image.decode());
        assert(await icon.evaluate(image => image.naturalWidth > 0));
        if (process.env.REDEVEN_EXTENSION_SCREENSHOT_DIR) {
          const output = path.resolve(process.env.REDEVEN_EXTENSION_SCREENSHOT_DIR);
          await mkdir(output, { recursive: true });
          await card.screenshot({ path: path.join(output, 'redeven-flower-extension.png') });
          await popup.bringToFront();
          await popup.locator('main').screenshot({ path: path.join(output, 'redeven-flower-connect.png') });
        }
      } finally { await extensions.close(); }
    });
    await popup.locator('#connect-button').click();
    await worker.evaluate(() => fixtureWait('hello'));
    await worker.evaluate(() => fixtureDeliver({ type: 'ready', protocol_version: 7 }));
    let sequence = 0;
    const nativeCall = async (command, args = {}) => {
      const id = String(++sequence);
      await worker.evaluate(message => fixtureDeliver(message), { id, command, arguments: args });
      await worker.evaluate(id => fixtureWait(id), id);
      const response = await worker.evaluate(id => {
        const index = fixtureResponses.findIndex(message => message.id === id);
        const response = fixtureResponses.splice(index, 1)[0];
        if (response.sequence) fixtureDeliver({ type: 'cdp_ack', sequence: response.sequence });
        return response;
      }, id);
      if (response.error) throw new Error(response.error); return response.result;
    };
    const owners = new Map();
    const transports = new Map();
    let pumpClosed = false;
    let withheldCredits = '';
    const pump = (async () => {
      while (!pumpClosed) {
        const events = await worker.evaluate(async () => {
          if (!globalThis.fixtureEvents.length) await new Promise(resolve => { globalThis.fixtureEventWake = resolve; });
          globalThis.fixtureEventWake = undefined;
          return globalThis.fixtureEvents.splice(0);
        });
        for (const message of events) {
          const root = transports.get(message.tab_id);
          if (message.type === 'target_unavailable') root?.close();
          else if (root?.binding === message.binding) (message.session ? root.children.get(message.session) : root)?.emit(message.method, message.params);
          if (message.sequence && message.binding !== withheldCredits) await worker.evaluate(sequence => fixtureDeliver({ type: 'cdp_ack', sequence }), message.sequence);
        }
      }
    })();
    void pump.catch(() => {});
    t.after(async () => {
      pumpClosed = true;
      await worker.evaluate(() => globalThis.fixtureEventWake?.()).catch(() => {});
      await Promise.allSettled([...owners.values()].map(owner => owner.dispose()));
    });
    const call = async (command, args = {}) => {
      if (command === 'execute') {
        const owner = owners.get(args.tab_id);
        return owner && !owner.source.isClosed() ? owner.controller.execute(args.request) : { error: 'TARGET_CONNECTION_REQUIRED' };
      }
      if (command === 'unbind') {
        await owners.get(args.tab_id)?.dispose(); owners.delete(args.tab_id);
      }
      const result = await nativeCall(command, args);
      if (command === 'bind' || command === 'new_tab') {
        if (owners.has(result.tab_id)) return result;
        const root = new EventEmitter();
        root.tabId = result.tab_id; root.binding = result.binding; root.children = new Map();
        root.send = (method, params, session = '') => nativeCall('cdp', { tab_id: result.tab_id, binding: result.binding, session, method, params });
        root.child = session => {
          if (!root.children.has(session)) {
            const child = new EventEmitter(); child.send = (method, params) => root.send(method, params, session);
            root.children.set(session, child);
          }
          return root.children.get(session);
        };
        root.removeChild = session => root.children.delete(session);
        root.close = () => {
          if (root.closed) return;
          root.closed = true; root.emit('close');
          for (const child of root.children.values()) child.emit('close');
          root.children.clear(); transports.delete(result.tab_id);
        };
        transports.set(result.tab_id, root);
        owners.set(result.tab_id, await createExtensionBrowserSource(root, 'extension-' + result.tab_id));
      }
      return result;
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
    await t.test('the admitted extension debugger also produces the DOM projection', async () => {
      const owner = owners.get(selected.id);
      assert.equal(owner.controller.transport, owner.source.transport);
      const projection = await BrowserProjection.attach(owner.source, { authorize: () => false });
      const messages = [];
      let snapshotReady;
      const snapshot = new Promise(resolve => { snapshotReady = resolve; });
      const observation = await projection.observe(message => { messages.push(message); if (message.type === 'snapshot') snapshotReady(); }, { media: false });
      try {
        await Promise.race([snapshot, new Promise(resolve => setTimeout(resolve, 3000))]);
        assert.ok(messages.some(message => message.type === 'snapshot'), JSON.stringify(messages));
        assert.equal((await execute('computer.observe')).error, undefined);
        await assert.rejects(owner.source.transport.send('Target.getTargetInfo', { targetId: 'ungranted' }), /EXTENSION_COMMAND_FAILED/);
        await assert.rejects(owner.source.transport.send('Browser.getVersion'), /EXTENSION_COMMAND_FAILED/);
        await assert.rejects(owner.source.transport.send('IO.read', { handle: 'ungranted' }), /EXTENSION_COMMAND_FAILED/);
      } finally { await observation.close(); await projection.close(); }
      assert.equal(task.isClosed(), false);
    });

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
    const waiting = call('execute', { tab_id: selected.id, request: { tool_name: 'computer.action', script_operation: true, allowed_origins: origins, args: { action: 'wait', selector: { role: 'button', name: 'Never present' }, timeout_ms: 10000 } } });
    const sibling = await call('execute', { tab_id: created.tab_id, request: { tool_name: 'computer.observe', args: {}, allowed_origins: [] } });
    assert.equal(sibling.safety.level, 'routine');
    owners.get(selected.id).controller.cancel();
    const cancelled = { result: await waiting };
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
    await t.test('a native event flood retires only its producing binding', async () => {
      const root = transports.get(selected.id);
      withheldCredits = root.binding;
      await root.send('Runtime.evaluate', { expression: "for(let i=0;i<1100;i++)console.log('bounded-native-event-fixture')" }).catch(() => undefined);
      await assert.rejects(nativeCall('status', { tab_id: selected.id }), /EXTENSION_COMMAND_FAILED/);
      assert.equal((await call('execute', { tab_id: created.tab_id, request: { tool_name: 'computer.observe', args: {} } })).safety.level, 'routine');
      await nativeCall('status', { tab_id: created.tab_id });
      withheldCredits = '';
    });
    await call('unbind', { tab_id: selected.id });
    assert.equal((await execute('computer.action', { action: 'fill', selector: { role: 'textbox', name: 'Query' }, text: 'Forbidden' })).error, 'TARGET_CONNECTION_REQUIRED');
    assert.equal(await task.locator('input').inputValue(), 'Continued');
    await task.close();
    assert.equal((await execute('computer.observe')).error, 'TARGET_CONNECTION_REQUIRED');
    await t.test('reconnect updates an open popup without restoring tab authority', async () => {
      const activeTabs = await worker.evaluate(async () => (await chrome.tabs.query({ active: true })).map(tab => tab.id));
      const profile = await worker.evaluate(async () => (await chrome.storage.local.get('profile')).profile);
      for (const transport of transports.values()) transport.close();
      await worker.evaluate(() => { fixtureResponses.length = 0; fixtureDisconnect(); });
      await worker.evaluate(() => fixtureWait('hello'));
      await worker.evaluate(() => fixtureDeliver({ type: 'connection_error', code: 'extension_update_required' }));
      await popup.locator('#repair').waitFor({ state: 'visible' });
      await popup.locator('#connect-button').waitFor({ state: 'visible' });
      await worker.evaluate(async () => {
        fixtureResponses.length = 0;
        await chrome.alarms.create('redeven-native-reconnect', { when: Date.now() });
      });
      await worker.evaluate(() => fixtureWait('hello'));
      await worker.evaluate(() => fixtureDeliver({ type: 'ready', protocol_version: 7 }));
      await popup.locator('#disconnect').waitFor({ state: 'visible' });
      await popup.locator('#repair').waitFor({ state: 'hidden' });
      await popup.locator('#connect-button').waitFor({ state: 'hidden' });
      const state = await popup.evaluate(() => chrome.runtime.sendMessage({ command: 'status' }));
      assert.equal(state.connected, true); assert.equal(state.tabs, 0); assert.equal(state.error, '');
      assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('profile')).profile), profile);
      assert.deepEqual(await worker.evaluate(async () => (await chrome.tabs.query({ active: true })).map(tab => tab.id)), activeTabs);
      assert.equal((await call('execute', { tab_id: created.tab_id, request: { tool_name: 'computer.observe', args: {} } })).error, 'TARGET_CONNECTION_REQUIRED');
      await popup.bringToFront();
      await popup.locator('#disconnect').click();
      await popup.locator('#connect-button').waitFor({ state: 'visible' });
      assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('autoConnect')).autoConnect), false);
      assert.equal(await worker.evaluate(() => chrome.alarms.get('redeven-native-reconnect')), undefined);
    });
  } finally { await browser.close(); server.close(); }
});
