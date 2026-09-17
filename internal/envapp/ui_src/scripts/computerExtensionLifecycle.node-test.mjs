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
  const chrome = globalThis.chrome = {
    debugger: { onEvent: event(), onDetach: event(), detach: async () => {} },
    tabs: { onRemoved: event(), query: () => new Promise(resolve => { releaseInventory = resolve; }) },
    storage: { local: { get: async () => saved, set: async value => { saved = { ...saved, ...value }; } } },
    runtime: { id: 'fixture', onMessage: messages, getURL: name => `chrome-extension://fixture/${name}`, connectNative: () => {
      const port = { onMessage: event(), onDisconnect: event(), replies: [], disconnected: false,
        postMessage(value) { this.replies.push(value); }, disconnect() { this.disconnected = true; this.onDisconnect.emit(); } };
      ports.push(port); return port;
    } },
  };
  const ui = command => new Promise(resolve => messages.emit(command, { id: 'fixture', url: chrome.runtime.getURL('popup.html') }, resolve));
  const connect = () => ui({ command: 'connect', nativeHost: 'dev.floegence.redeven.r123456789abcdef0', profileName: 'Fixture' });
  try {
    const source = (await readFile(new URL('../../../../browser-extension/background.mjs', import.meta.url), 'utf8'))
      .replace("'./computerBrowserController.mjs'", JSON.stringify(new URL('./computerBrowserController.mjs', import.meta.url).href));
    const module = path.join(directory, 'background.mjs'); await writeFile(module, source);
    await import(pathToFileURL(module).href);
    const first = connect(); await flush();
    assert.equal(ports.length, 1);
    ports[0].onMessage.emit({ type: 'ready', protocol_version: 2 });
    assert.equal((await first).connected, true);
    ports[0].onMessage.emit({ id: '1', command: 'inventory' }); await flush();
    const next = connect(); await flush();
    assert.equal(ports[0].disconnected, true);
    assert.equal(ports.length, 1, 'a new connection must wait for the retired request cleanup');
    releaseInventory([]); await flush(); await flush();
    assert.equal(ports.length, 2);
    ports[1].onMessage.emit({ type: 'ready', protocol_version: 2 });
    assert.equal((await next).connected, true);
    ports[1].onMessage.emit({ id: '1', command: 'inventory' }); await flush();
    releaseInventory([{ id: 7, title: 'Selected', url: 'https://example.test' }]); await flush();
    assert.equal(ports[1].replies.find(value => value.id === '1').result[0].id, '7');
    assert.equal(ports[0].replies.some(value => value.id === '1'), false, 'old response escaped into a retired connection');
    ports[0].onDisconnect.emit(); await flush();
    assert.equal((await ui({ command: 'status' })).connected, true, 'old disconnect retired the new profile');
    assert.equal((await ui({ command: 'disconnect' })).connected, false);
  } finally { globalThis.chrome = original; await rm(directory, { recursive: true, force: true }); }
});
