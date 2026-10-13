import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';
import { BrowserComputerPage, navigationURL, redactedNavigationURL } from './computerBrowserPage.mjs';

test('URL validation accepts native schemes and never treats null as an origin grant', () => {
  const page = new BrowserComputerPage({}, { allowedOrigins: ['null'] });
  for (const url of ['file:///tmp/test.html', 'data:text/html,hello', 'about:blank', 'chrome://version/', 'chrome-extension://id/page.html', 'custom:resource']) {
    assert(navigationURL(url).protocol);
    assert.equal(page.allowsURL(url), false);
    page.fullAccess = true; assert.equal(page.allowsURL(url), true); page.fullAccess = false;
  }
  page.allowedNavigationURLs.add('file:///tmp/test.html');
  assert.equal(page.allowsURL('file:///tmp/../tmp/test.html'), true);
  assert.equal(page.allowsURL('file:///tmp/other.html'), false);
  assert.equal(redactedNavigationURL('https://user:secret@example.test/path'), 'https://example.test/path');
  for (const url of ['relative.html', 'file:///tmp/\nsecret', 'http://[bad']) assert.throws(() => navigationURL(url), /INVALID_REQUEST/u);
});

test('real file navigation, SVG image, unique role, contains/exact, scoped refs and timeout', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flower-native-url-'));
  const filename = path.join(directory, 'animation.html');
  await writeFile(filename, `<!doctype html><title>Local animation</title>
    <svg role="img" aria-label="Flower animation preview" width="200" height="100"><circle cx="50" cy="50" r="20"/></svg>
    <div role="group" aria-label="Primary controls"><button onclick="this.textContent='Resume animation'">Pause animation</button></div>
    <button>Other action</button><input aria-label="Only input">`);
  const browser = await chromium.launch({ headless: true });
  try {
    const native = await browser.newPage();
    const controller = new BrowserComputerController(await native.context().newCDPSession(native));
    await controller.initialize();
    const execute = (tool_name, args = {}, fields = {}) => controller.execute({ tool_name, args, full_access: true, script_operation: true, ...fields });
    const url = pathToFileURL(filename).href;
    const navigation = await execute('browser.navigate', { url });
    assert.equal(navigation.error, undefined, JSON.stringify(navigation));
    assert.equal(native.url(), url);
    assert.equal(navigation.result.action_executed, true);
    const observation = await execute('computer.observe');
    assert.equal(observation.error, undefined, JSON.stringify(observation));
    const group = observation.result.observation.nodes.find(node => node.role === 'group');
    const image = await execute('computer.action', { action: 'read', selector: { roles: ['image', 'img'], name: 'animation' } });
    assert.equal(image.result.node.name, 'Flower animation preview');
    assert.equal((await execute('computer.action', { action: 'read', selector: { role: 'textbox' } })).result.node.name, 'Only input');
    assert.equal((await execute('computer.action', { action: 'read', selector: { role: 'button' } })).error, 'AMBIGUOUS_ELEMENT');
    assert.equal((await execute('computer.action', { action: 'read', selector: { roles: ['image', 'img'], name: 'animation', exact: true } })).error, 'ELEMENT_NOT_FOUND');
    const clicked = await execute('computer.action', { action: 'click', selector: { role: 'button', root_ref: group.ref } });
    assert.equal(clicked.error, undefined, JSON.stringify(clicked));
    assert.equal((await execute('computer.action', { action: 'read', selector: { role: 'button', name: 'Resume', exact: false } })).result.node.name, 'Resume animation');
    const timeout = await execute('computer.action', { action: 'wait', selector: { role: 'button', name: 'Missing' }, timeout_ms: 0 });
    assert.equal(timeout.result.state, 'timeout');
    assert.equal(timeout.result.requested_state, 'visible');
    const oldImageRef = image.result.node.ref;
    await execute('browser.navigate', { url: 'data:text/html,%3Ch1%3ENew%3C/h1%3E' });
    assert.equal((await execute('computer.action', { action: 'read', selector: { ref: oldImageRef } })).error, 'STALE_REFERENCE');
    assert.equal((await execute('browser.navigate', { url: 'about:blank' })).error, undefined);
    const restricted = await execute('browser.navigate', { url }, { full_access: false });
    assert.equal(restricted.error, 'TARGET_PERMISSION_REQUIRED');
    assert.equal(restricted.result.action_executed, false);
    const approved = await execute('browser.navigate', { url }, { full_access: false, allowed_navigation_urls: [url] });
    assert.equal(approved.error, undefined, JSON.stringify(approved));
    assert.equal((await execute('computer.observe', {}, { full_access: false, allowed_navigation_urls: [url] })).error, undefined);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});


test('redirect requires a fresh exact approval and recovers without takeover or replay', async () => {
  let destinationLoads = 0;
  const destination = http.createServer((_request, response) => { destinationLoads++; response.end('<h1>Approved destination</h1>'); });
  destination.listen(0, '127.0.0.1'); await once(destination, 'listening');
  const destinationURL = `http://127.0.0.1:${destination.address().port}/destination`;
  const source = http.createServer((_request, response) => { response.writeHead(302, { Location: destinationURL }); response.end(); });
  source.listen(0, '127.0.0.1'); await once(source, 'listening');
  const sourceURL = `http://127.0.0.1:${source.address().port}/redirect`;
  const browser = await chromium.launch({ headless: true });
  try {
    const native = await browser.newPage();
    const controller = new BrowserComputerController(await native.context().newCDPSession(native));
    await controller.initialize();
    const execute = (url, grants, full_access = false) => controller.execute({ tool_name: 'browser.navigate', args: { url }, allowed_navigation_urls: grants, full_access, script_operation: true });
    const blocked = await execute(sourceURL, [sourceURL]);
    assert.equal(blocked.error, 'TARGET_PERMISSION_REQUIRED', JSON.stringify(blocked));
    assert.equal(blocked.result.required_navigation_url, destinationURL);
    assert.equal(blocked.result.action_executed, true);
    assert.equal(destinationLoads, 0);
    await native.waitForLoadState('load');
    let approved = await execute(destinationURL, [destinationURL]);
    if (approved.result.observation_invalidated) {
      assert.equal(approved.result.action_executed, false, 'never repeat an executed action');
      approved = await execute(destinationURL, [destinationURL]);
    }
    assert.equal(approved.result.action_executed, true, JSON.stringify(approved));
    assert.equal(approved.error, undefined, JSON.stringify(approved));
    assert.equal(native.url(), destinationURL);
    assert.equal(destinationLoads, 1);
    const unrestricted = await execute(sourceURL, [], true);
    assert.equal(unrestricted.error, undefined, JSON.stringify(unrestricted));
    assert.equal(destinationLoads, 2);
  } finally { await browser.close(); await Promise.all([new Promise(resolve => source.close(resolve)), new Promise(resolve => destination.close(resolve))]); }
});
