/* global chrome */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { stageBrowserExtension } from '../../../../scripts/stage_browser_extension.mjs';

// A real Chrome native-host launch and the production Runtime CLI byte relay.
// The disposable registration has a unique name and is removed by exact bytes.
test('native messaging launches the Runtime bridge and exchanges bounded profile commands', { skip: !process.env.REDEVEN_BROWSER_BRIDGE_BINARY, timeout: 20000 }, async () => {
  const directory = await mkdtemp('/tmp/flower-native-');
  const extension = path.join(directory, 'extension'); stageBrowserExtension(extension);
  const socket = path.join(directory, 'bridge');
  const peers = new Set();
  const server = net.createServer(peer => { peers.add(peer); peer.once('close', () => peers.delete(peer)); });
  server.listen(socket); await once(server, 'listening');
  const registrationRoot = path.join(directory, 'profile', 'NativeMessagingHosts');
  const name = `dev.floegence.redeven.r${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const registration = path.join(registrationRoot, name + '.json');
  const wrapper = path.join(directory, 'native-host');
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(wrapper, `#!/bin/sh\nexec ${quote(process.env.REDEVEN_BROWSER_BRIDGE_BINARY)} browser-bridge ${quote(socket)} "$@"\n`, { mode: 0o700 });
  const extensionID = 'mgfbpkkmocckooenpdfpefknffjanjce';
  const manifest = JSON.stringify({ name, description: 'Flower native test', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${extensionID}/`] });
  await mkdir(registrationRoot, { recursive: true }); await writeFile(registration, manifest, { flag: 'wx', mode: 0o600 });
  let context, peer;
  try {
    const accepted = once(server, 'connection');
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionID}/popup.html`);
    await popup.locator('#profile').fill('Native fixture'); await popup.locator('#bridge').fill(name); await popup.locator('#connect-button').click();
    let timer;
    try { [peer] = await Promise.race([accepted, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Chrome did not launch the native host')), 6000); })]); }
    catch (error) {
      const worker = context.serviceWorkers()[0];
      const reason = await worker.evaluate(name => new Promise(resolve => {
        const port = chrome.runtime.connectNative(name);
        port.onDisconnect.addListener(() => resolve(chrome.runtime.lastError?.message || 'disconnected'));
        setTimeout(() => { port.disconnect(); resolve('native host did not close'); }, 1000);
      }), name);
      throw new Error(`${error.message}: ${reason}`);
    }
    finally { clearTimeout(timer); }
    let buffer = Buffer.alloc(0); const messages = []; const waiters = [];
    peer.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
        const size = buffer.readUInt32LE(); messages.push(JSON.parse(buffer.subarray(4, 4 + size))); buffer = buffer.subarray(4 + size); waiters.shift()?.();
      }
    });
    const receive = async () => { if (!messages.length) await new Promise(resolve => waiters.push(resolve)); return messages.shift(); };
    const send = value => { const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4); header.writeUInt32LE(body.length); peer.write(Buffer.concat([header, body])); };
    assert.deepEqual(await receive(), { type: 'native_host', protocol_version: 5, extension_id: extensionID });
    const hello = await receive(); assert.equal(hello.type, 'hello'); assert.equal(hello.profile_name, 'Native fixture');
    send({ type: 'ready', protocol_version: 5 });
    await popup.waitForFunction(async () => (await chrome.runtime.sendMessage({ command: 'status' })).connected === true);
    send({ id: '1', command: 'inventory' });
    const inventory = await receive(); assert.equal(inventory.id, '1'); assert.ok(Array.isArray(inventory.result));
    send({ id: '2', command: 'new_tab' });
    const created = await receive(); assert.equal(created.id, '2'); assert.ok(created.result.tab_id);
    peer.end();
    await popup.waitForFunction(async () => (await chrome.runtime.sendMessage({ command: 'status' })).connected === false);
  } finally {
    for (const connection of peers) connection.destroy();
    peer?.destroy(); await context?.close(); server.close();
    if (await readFile(registration, 'utf8').catch(() => '') === manifest) await rm(registration);
    await rm(directory, { recursive: true, force: true });
  }
});
