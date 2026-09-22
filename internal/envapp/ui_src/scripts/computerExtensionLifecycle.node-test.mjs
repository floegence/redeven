import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { for (const fn of this.listeners) fn(...args); } });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('reconnection drains old requests before binding and reusing native request IDs', { timeout: 5000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flower-extension-lifecycle-'));
  const original = globalThis.chrome;
  const ports = [], messages = event();
  let saved = {}, releaseInventory;
  const alarms = new Map();
  const chrome = globalThis.chrome = {
    webNavigation: { onCreatedNavigationTarget: event() },
    debugger: { onEvent: event(), onDetach: event(), detach: async () => {}, getTargets: async () => [{ type: 'page', tabId: 7, id: 'a'.repeat(32) }] },
    tabs: { onRemoved: event(), query: () => new Promise(resolve => { releaseInventory = resolve; }) },
    storage: { local: { get: async () => saved, set: async value => { saved = { ...saved, ...value }; } } },
    alarms: { onAlarm: event(), get: async name => alarms.get(name), create: async (name, value) => { alarms.set(name, value); }, clear: async name => alarms.delete(name) },
    runtime: { id: 'fixture', onMessage: messages, onStartup: event(), sendMessage: async () => {}, getURL: name => `chrome-extension://fixture/${name}`, connectNative: () => {
      const port = { onMessage: event(), onDisconnect: event(), replies: [], disconnected: false,
        postMessage(value) { this.replies.push(value); }, disconnect() { this.disconnected = true; this.onDisconnect.emit(); } };
      ports.push(port); return port;
    } },
  };
  const ui = command => new Promise(resolve => messages.emit(command, { id: 'fixture', url: chrome.runtime.getURL('popup.html') + '#dev.floegence.redeven.r123456789abcdef0' }, resolve));
  const connect = () => ui({ command: 'connect', nativeHost: 'dev.floegence.redeven.r123456789abcdef0', profileName: 'Fixture' });
  try {
    const source = (await readFile(new URL('../../../../browser-extension/background.mjs', import.meta.url), 'utf8'))
      .replace("'./computerBrowserLineage.mjs'", JSON.stringify(new URL('./computerBrowserLineage.mjs', import.meta.url).href));
    const module = path.join(directory, 'background.mjs'); await writeFile(module, source);
    await import(pathToFileURL(module).href);
    for (const url of ['https://example.test/popup.html', chrome.runtime.getURL('popup.html') + '?host=anything', chrome.runtime.getURL('other.html')]) {
      assert.equal(messages.listeners[0]({ command: 'connect' }, { id: 'fixture', url }, () => assert.fail('untrusted sender was admitted')), false);
    }
    const first = connect(); await flush();
    assert.equal(ports.length, 1);
    ports[0].onMessage.emit({ type: 'ready', protocol_version: 7 });
    assert.equal((await first).connected, true);
    ports[0].onMessage.emit({ id: '1', command: 'inventory' }); await flush();
    const next = connect(); await flush();
    assert.equal(ports[0].disconnected, true);
    assert.equal(ports.length, 1, 'a new connection must wait for the retired request cleanup');
    releaseInventory([]); await flush(); await flush();
    assert.equal(ports.length, 2);
    ports[1].onMessage.emit({ type: 'ready', protocol_version: 7 });
    assert.equal((await next).connected, true);
    ports[1].onMessage.emit({ id: '1', command: 'inventory' }); await flush();
    releaseInventory([{ id: 7, title: 'Selected', url: 'https://example.test' }]); await flush();
    assert.equal(ports[1].replies.find(value => value.id === '1').result[0].id, '7');
    assert.equal(ports[0].replies.some(value => value.id === '1'), false, 'old response escaped into a retired connection');
    ports[0].onDisconnect.emit(); await flush();
    assert.equal((await ui({ command: 'status' })).connected, true, 'old disconnect retired the new profile');
    assert.equal((await ui({ command: 'disconnect' })).connected, false);
    const missing = connect(); await flush(); await flush();
    chrome.runtime.lastError = { message: 'Specified native messaging host not found.' };
    ports.at(-1).onDisconnect.emit(); delete chrome.runtime.lastError;
    assert.equal((await missing).error, 'native_host_missing');
    assert.equal((await ui({ command: 'status' })).error, 'native_host_missing');
    const incompatible = connect(); await flush(); await flush();
    ports.at(-1).onMessage.emit({ type: 'connection_error', code: 'extension_update_required' });
    assert.equal((await incompatible).error, 'extension_update_required');
    const recovered = connect(); await flush(); await flush();
    ports.at(-1).onMessage.emit({ type: 'ready', protocol_version: 7 });
    assert.equal((await recovered).connected, true);
    assert.equal((await ui({ command: 'status' })).error, '');
    await ui({ command: 'disconnect' });
    assert.equal((await ui({ command: 'status' })).error, '');
  } finally { globalThis.chrome = original; await rm(directory, { recursive: true, force: true }); }
});

test('a confirmed profile reconnects after disconnect and worker restart, while explicit disconnect stays off', { timeout: 5000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flower-extension-reconnect-'));
  const original = globalThis.chrome;
  const host = 'dev.floegence.redeven.r123456789abcdef0';
  let saved = {}, generation = 0, chrome;
  const alarms = new Map(), ports = [];
  const source = (await readFile(new URL('../../../../browser-extension/background.mjs', import.meta.url), 'utf8'))
    .replace("'./computerBrowserLineage.mjs'", JSON.stringify(new URL('./computerBrowserLineage.mjs', import.meta.url).href));
  const module = path.join(directory, 'background.mjs'); await writeFile(module, source);
  const startWorker = async () => {
    chrome = globalThis.chrome = {
      webNavigation: { onCreatedNavigationTarget: event() },
      debugger: { onEvent: event(), onDetach: event(), detach: async () => assert.fail('reconnection must not bind a tab') },
      tabs: { onRemoved: event(), query: async () => assert.fail('reconnection must not inspect tabs') },
      storage: { local: { get: async () => structuredClone(saved), set: async value => { saved = { ...saved, ...structuredClone(value) }; } } },
      alarms: { onAlarm: event(), get: async name => alarms.get(name), create: async (name, value) => { alarms.set(name, value); }, clear: async name => alarms.delete(name) },
      runtime: { id: 'fixture', onMessage: event(), onStartup: event(), sendMessage: async () => {}, getURL: name => `chrome-extension://fixture/${name}`, connectNative: name => {
        assert.equal(name, host, 'reconnect must use the explicitly confirmed host');
        const port = { onMessage: event(), onDisconnect: event(), replies: [], postMessage(value) { this.replies.push(value); }, disconnect() { this.onDisconnect.emit(); } };
        ports.push(port); return port;
      } },
    };
    await import(`${pathToFileURL(module).href}?worker=${generation++}`);
    await flush(); await flush();
  };
  const ui = command => new Promise(resolve => chrome.runtime.onMessage.emit(command, { id: 'fixture', url: chrome.runtime.getURL('popup.html') }, resolve));
  const ready = async () => { await flush(); await flush(); ports.at(-1).onMessage.emit({ type: 'ready', protocol_version: 7 }); await flush(); await flush(); };
  try {
    await startWorker();
    assert.equal(ports.length, 0, 'installation alone must not connect');
    const first = ui({ command: 'connect', nativeHost: host, profileName: 'Work' });
    await flush(); await flush();
    assert.equal(saved.autoConnect, false, 'a pending handshake must not opt in');
    await ready(); assert.equal((await first).connected, true);
    assert.equal(saved.autoConnect, true);
    assert.equal(alarms.size, 1);
    const profileID = saved.profile.id;
    ports[0].onDisconnect.emit(); await ready();
    assert.equal(ports.length, 2, 'a lost native connection must reconnect automatically');
    assert.equal((await ui({ command: 'status' })).connected, true);
    assert.equal(saved.profile.id, profileID);
    ports.at(-1).onDisconnect.emit(); await flush(); await flush();
    assert.equal(ports.length, 3);
    chrome.runtime.lastError = { message: 'Specified native messaging host not found.' };
    ports.at(-1).onDisconnect.emit(); delete chrome.runtime.lastError;
    await flush(); await flush();
    assert.equal((await ui({ command: 'status' })).error, 'native_host_missing');
    assert.equal(ports.length, 3, 'an unavailable Runtime must not cause a tight reconnect loop');
    assert.equal(saved.autoConnect, true, 'temporary unavailability must retain confirmed consent');
    chrome.alarms.onAlarm.emit({ name: [...alarms.keys()][0] }); await ready();
    assert.equal(ports.length, 4, 'the alarm must recover when Runtime becomes available');
    assert.equal((await ui({ command: 'status' })).connected, true);
    assert.equal((await ui({ command: 'status' })).error, '');
    await startWorker(); await ready();
    assert.equal(ports.length, 5, 'a restarted service worker must reuse confirmed settings');
    chrome.runtime.onStartup.emit(); chrome.alarms.onAlarm.emit({ name: [...alarms.keys()][0] });
    await flush(); await flush();
    assert.equal(ports.length, 5, 'startup and alarm events must not duplicate a live connection');
    await ui({ command: 'disconnect' });
    assert.equal(saved.autoConnect, false); assert.equal(alarms.size, 0);
    await startWorker();
    chrome.runtime.onStartup.emit(); await flush(); await flush();
    assert.equal(ports.length, 5, 'explicit disconnect must survive restart');
    saved = { profile: { id: profileID, name: 'Work' }, nativeName: host };
    await startWorker();
    assert.equal(ports.length, 5, 'unconfirmed saved input must not opt in to reconnection');
  } finally { globalThis.chrome = original; await rm(directory, { recursive: true, force: true }); }
});
