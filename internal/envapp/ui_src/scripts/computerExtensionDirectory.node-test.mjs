import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { for (const fn of this.listeners) fn(...args); } });
const flush = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'redeven-extension-directory-'));
  const previous = globalThis.chrome;
  const tabs = new Map([
    [7, { id: 7, windowId: 1, index: 0, active: true, title: 'Existing', url: 'https://example.test/' }],
    [8, { id: 8, windowId: 2, index: 0, active: true, title: 'Settings', url: 'chrome://settings/' }],
    [9, { id: 9, windowId: 3, index: 0, incognito: true, title: 'Private', url: 'https://private.test/' }],
  ]);
  const port = { onMessage: event(), onDisconnect: event(), replies: [], postMessage(value) { this.replies.push(value); }, disconnect() {} };
  let saved = {}, attaches = 0, sequence = 0;
  const chrome = globalThis.chrome = {
    webNavigation: { onCreatedNavigationTarget: event() },
    debugger: { onEvent: event(), onDetach: event(), getTargets: async () => { await options.beforeTargets?.(tabs, chrome); return [...tabs.values()].map(tab => ({ type: 'page', tabId: tab.id, id: tab.id.toString(16).padStart(32, '0') })); },
      attach: async () => { attaches++; throw new Error('Debugger unavailable'); }, detach: async () => {} },
    tabs: { onRemoved: event(), onCreated: event(), onUpdated: event(), onMoved: event(), onAttached: event(), onDetached: event(), onReplaced: event(),
      query: async () => [...tabs.values()], get: async id => { if (!tabs.has(id)) throw new Error('Closed'); return tabs.get(id); },
      create: async options => { assert.equal(options.active, false); const tab = { id: 10, windowId: 1, index: 1, title: '', url: options.url }; tabs.set(10, tab); chrome.tabs.onCreated.emit(tab); return tab; },
      remove: async id => { tabs.delete(id); chrome.tabs.onRemoved.emit(id); },
      update: async (id, options) => { assert.equal(options.active, undefined); Object.assign(tabs.get(id), options); chrome.tabs.onUpdated.emit(id, options, tabs.get(id)); return tabs.get(id); },
      move: async (id, options) => { Object.assign(tabs.get(id), options); chrome.tabs.onMoved.emit(id, options); return tabs.get(id); },
    },
    storage: { local: { get: async () => saved, set: async value => { saved = { ...saved, ...value }; } } },
    alarms: { onAlarm: event(), get: async () => ({}), create: async () => {}, clear: async () => {} },
    runtime: { id: 'fixture', onMessage: event(), onStartup: event(), sendMessage: async () => {}, getURL: name => `chrome-extension://fixture/${name}`, connectNative: () => port },
  };
  t.after(async () => { globalThis.chrome = previous; await rm(directory, { recursive: true, force: true }); });
  const source = (await readFile(new URL('../../../../browser-extension/background.mjs', import.meta.url), 'utf8'))
    .replace("'./tabLifecycle.mjs'", JSON.stringify(new URL('../../../../browser-extension/tabLifecycle.mjs', import.meta.url).href))
    .replace("'./computerBrowserLineage.mjs'", JSON.stringify(new URL('./computerBrowserLineage.mjs', import.meta.url).href));
  const module = path.join(directory, 'background.mjs'); await writeFile(module, source); await import(pathToFileURL(module).href);
  const connected = new Promise(resolve => chrome.runtime.onMessage.emit({ command: 'connect', nativeHost: 'dev.floegence.redeven.r123456789abcdef0', profileName: 'Fixture' }, { id: 'fixture', url: chrome.runtime.getURL('popup.html') }, resolve));
  await flush(); port.onMessage.emit({ type: 'ready', protocol_version: 9 }); await connected;
  return { tabs, chrome, port, attaches: () => attaches, async call(command, args) {
    const id = String(++sequence); port.onMessage.emit({ id, command, arguments: args });
    for (let i = 0; i < 30 && !port.replies.some(reply => reply.id === id); i++) await flush();
    const reply = port.replies.find(reply => reply.id === id); assert.ok(reply, 'Command must settle');
    assert.equal(reply.error, undefined, `Native command ${command} failed`); return reply.result;
  } };
}

test('new tab identity survives projection failure and creation never attaches a debugger', async t => {
  const f = await fixture(t);
  const tab = await f.call('new_tab');
  assert.equal(tab.tab_id, '10');
  assert.equal(tab.native_target_id, 'a'.padStart(32, '0'));
  assert.equal(f.attaches(), 0);
  assert.ok(f.tabs.has(10));
  assert.equal(f.tabs.get(7).active, true);
});

test('profile directory sends one snapshot then ordered native changes without binding pages', async t => {
  const f = await fixture(t);
  await f.call('watch_tabs');
  const changes = () => f.port.replies.filter(reply => reply.type === 'tabs_changed');
  assert.equal(changes().length, 1);
  assert.deepEqual(changes()[0].tabs.map(tab => tab.id), ['7', '8']);
  assert.equal(changes()[0].tabs[1].availability, 'unsupported');
  assert.equal(f.attaches(), 0);
  f.tabs.get(7).title = 'Updated'; f.chrome.tabs.onUpdated.emit(7, { title: 'Updated' }, f.tabs.get(7));
  await flush(); await flush();
  assert.equal(changes().at(-1).upsert[0].title, 'Updated');
  await f.call('new_tab');
  await f.call('sync_tabs');
  assert.equal(changes().at(-1).order.at(-1), '8');
  f.tabs.delete(7); f.chrome.tabs.onRemoved.emit(7); await flush(); await flush();
  assert.deepEqual(changes().at(-1).removed, ['7']);
  assert.deepEqual(changes().map(change => change.revision), changes().map((_, index) => index + 1));
  assert.equal(changes().slice(1).some(change => 'tabs' in change), false);
  assert.equal(f.attaches(), 0);
});


test('native removal during the initial snapshot settles on the current directory', async t => {
  let removed = false;
  const f = await fixture(t, { beforeTargets(tabs, chrome) {
    if (removed) return;
    removed = true; tabs.delete(7); chrome.tabs.onRemoved.emit(7);
  } });
  await f.call('watch_tabs');
  const updates = f.port.replies.filter(reply => reply.type === 'tabs_changed');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].tabs.map(tab => tab.id), ['8']);
  assert.equal(f.port.replies.some(reply => reply.type === 'tabs_unavailable'), false);
});

test('failed binding finalization retires only the debugger acquired by that request', async t => {
  const f = await fixture(t);
  let attached = 0, detached = 0;
  f.chrome.debugger.attach = async () => { attached++; };
  f.chrome.debugger.detach = async () => { detached++; };
  f.chrome.debugger.getTargets = async () => { throw new Error('Native identity unavailable'); };
  await assert.rejects(f.call('bind', { tab_id: '7', tab_url: 'https://example.test/', tab_title: 'Existing' }));
  assert.equal(attached, 1);
  assert.equal(detached, 1, 'A newly acquired debugger must not survive failed identity finalization');
  await assert.rejects(f.call('status', { tab_id: '7' }));
});

test('cancelling a reused binding cannot detach its existing source owner', async t => {
  const f = await fixture(t);
  let attached = 0, detached = 0;
  f.chrome.debugger.attach = async () => { attached++; };
  f.chrome.debugger.detach = async () => { detached++; };
  const args = { tab_id: '7', tab_url: 'https://example.test/', tab_title: 'Existing' };
  const binding = await f.call('bind', args);
  assert.equal(binding.created, true);
  const targets = f.chrome.debugger.getTargets;
  let release;
  f.chrome.debugger.getTargets = () => new Promise(resolve => { release = () => resolve(targets()); });
  f.port.onMessage.emit({ id: 'reuse', command: 'bind', arguments: args });
  await flush();
  f.port.onMessage.emit({ type: 'cancel', id: 'reuse' });
  release(); await flush(); await flush();
  assert.equal(attached, 1);
  assert.equal(detached, 0, 'Cancellation owns no permission to retire a reused generation');
  f.chrome.debugger.getTargets = targets;
  const reused = await f.call('bind', args);
  assert.equal(reused.binding, binding.binding);
  assert.equal(reused.created, false);
});

test('background input prepares virtual focus without activating the physical tab', async t => {
  const f = await fixture(t);
  const commands = [];
  f.chrome.debugger.attach = async () => {};
  f.chrome.debugger.sendCommand = async (target, method, params) => {
    commands.push({ target, method, params });
    return {};
  };
  const binding = await f.call('bind', { tab_id: '7', tab_url: 'https://example.test/', tab_title: 'Existing' });
  await f.call('cdp', { tab_id: '7', binding: binding.binding, method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10, y: 10 } });
  assert.deepEqual(commands, [
    { target: { tabId: 7 }, method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } },
    { target: { tabId: 7 }, method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10, y: 10 } },
  ]);
  assert.equal(f.tabs.get(7).active, true);
  commands.length = 0;
  f.chrome.debugger.sendCommand = async (target, method, params) => {
    commands.push({ target, method, params });
    if (method === 'Emulation.setFocusEmulationEnabled') throw new Error('focus unavailable');
    return {};
  };
  await assert.rejects(f.call('cdp', { tab_id: '7', binding: binding.binding, method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'a' } }));
  assert.deepEqual(commands.map(command => command.method), ['Emulation.setFocusEmulationEnabled']);
});
