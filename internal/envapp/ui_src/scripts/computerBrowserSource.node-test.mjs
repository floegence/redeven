/* global document, window */
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserProjection } from '@floegence/floebrowser';
import { BrowserComputerPage } from './computerBrowserPage.mjs';

test('input retirement attempts every held key and button while preserving a failed drain', async () => {
  const released = [];
  const transport = { async send(method, parameters) {
    released.push({ method, parameters });
    if (parameters.key === 'Shift') throw new Error('fixture key release failed');
  } };
  const page = new BrowserComputerPage(transport);
  page.heldInput.set('key:Shift', { session: transport, method: 'Input.dispatchKeyEvent', parameters: { type: 'keyDown', key: 'Shift' } });
  page.heldInput.set('key:a', { session: transport, method: 'Input.dispatchKeyEvent', parameters: { type: 'keyDown', key: 'a', text: 'a' } });
  page.heldInput.set('mouse:left', { session: transport, method: 'Input.dispatchMouseEvent', parameters: { type: 'mousePressed', button: 'left', x: 20, y: 20 } });
  await assert.rejects(page.releaseInput(), /release failed/u);
  assert.deepEqual(released.map(item => item.parameters.type), ['keyUp', 'keyUp', 'mouseReleased']);
  assert.equal(released.some(item => item.parameters.text), false);
  assert.equal(page.heldInput.size, 0);
});

test('a source popup waits for Runtime admission before acquiring its shared identity', { timeout: 10000 }, async t => {
  const { createComputerBrowserSource } = await import('./computerBrowserSource.mjs');
  const browser = await chromium.launch();
  let owner, popupOwner;
  t.after(async () => { await popupOwner?.dispose(); await owner?.dispose(); await browser.close(); });
  const page = await browser.newPage();
  await page.goto('data:text/html,<title>Authorized opener</title>');
  let resolvePopup;
  const announced = new Promise(resolve => { resolvePopup = resolve; });
  owner = await createComputerBrowserSource(page, 'runtime-opener', { onPopup: (popup, opener) => resolvePopup({ popup, opener }) });
  const opened = page.waitForEvent('popup');
  await page.evaluate(() => window.open('about:blank'));
  const popup = await opened;
  const event = await Promise.race([announced, new Promise(resolve => { const timer = setTimeout(() => resolve(undefined), 1000); timer.unref(); })]);
  assert.ok(event, 'The Runtime must receive popup admission before any debugger identity is assigned');
  assert.equal(event.popup, popup);
  assert.equal(event.opener.id, 'runtime-opener');
  popupOwner = await createComputerBrowserSource(popup, 'runtime-approved-popup');
  assert.equal(popupOwner.source.id, 'runtime-approved-popup');
});

test('source retirement keeps navigation guards until the debugger detaches', { timeout: 10000 }, async t => {
  const { createComputerBrowserSource } = await import('./computerBrowserSource.mjs');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const context = page.context();
  const attach = context.newCDPSession.bind(context);
  let guardListeners;
  context.newCDPSession = async target => {
    const transport = await attach(target);
    const detach = transport.detach.bind(transport);
    transport.detach = async () => {
      guardListeners = transport.listenerCount('Fetch.requestPaused');
      return detach();
    };
    return transport;
  };
  const owner = await createComputerBrowserSource(page, 'retiring-source');
  await owner.setUserBrowsing(true);
  await owner.dispose();
  assert.ok(guardListeners > 0, 'An enabled navigation guard must survive until its debugger is detached');
  assert.equal(owner.controller.page.sessions.size, 0);
});

test('AI and DOM projection borrow the same debugger and frame owner', { timeout: 30000 }, async t => {
  const { createComputerBrowserSource } = await import('./computerBrowserSource.mjs');
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<title>Shared source</title><label>Name<input aria-label="Name"></label>');
  });
  server.listen(0);
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--site-per-process'] });
  let owner, projection, observation;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let rootAttachments = 0;
    const attach = context.newCDPSession.bind(context);
    context.newCDPSession = (...args) => { if (args[0] === page) rootAttachments++; return attach(...args); };
    owner = await createComputerBrowserSource(page, 'shared-target');
    assert.equal(owner.controller.transport, owner.source.transport);
    assert.equal(rootAttachments, 1);
    const execute = (tool_name, args = {}) => owner.controller.execute({ tool_name, args, allowed_origins: [origin], script_operation: true });
    assert.equal((await execute('browser.navigate', { url: origin })).error, undefined);
    projection = await BrowserProjection.attach(owner.source, { authorize: () => false });
    const messages = [];
    observation = await projection.observe(message => messages.push(message), { media: false });
    assert.equal(rootAttachments, 1, 'Projection must borrow the existing root debugger');
    const observed = await execute('computer.observe');
    assert.equal(observed.error, undefined);
    assert.ok(observed.result.observation.nodes.some(node => node.name === 'Name'));
    assert.ok(messages.some(message => message.type === 'snapshot'));
    await observation.close(); observation = undefined;
    await projection.close(); projection = undefined;
    assert.equal(page.isClosed(), false, 'Closing the view preserves the source page');
    assert.equal((await execute('computer.observe')).error, undefined, 'Closing the view preserves the AI debugger');
    const childURL = origin.replace('127.0.0.1', 'localhost');
    owner.controller.page.allowedOrigins.add(childURL);
    for (let index = 0; index < 3; index++) {
      const attached = once(owner.source, 'sessionattached', { signal: t.signal });
      await page.evaluate(url => {
        const frame = document.createElement('iframe');
        frame.src = url;
        document.body.append(frame);
      }, childURL);
      const [session] = await attached;
      await page.frameLocator('iframe').getByRole('textbox', { name: 'Name' }).waitFor();
      await owner.controller.page.frames();
      assert.ok(owner.controller.page.sessions.has(session));
      const detached = once(owner.source, 'sessiondetached', { signal: t.signal });
      await page.locator('iframe').evaluate(element => element.remove());
      await detached;
      assert.equal(owner.controller.page.sessions.has(session), false, 'Detached child sessions must not accumulate in the AI controller');
    }
    owner.controller.page.releaseInput = async () => { throw new Error('fixture input drain failed'); };
    await assert.rejects(owner.dispose(), /fixture input drain failed/u, 'Failed input release must remain an explicit retirement failure');
    await assert.rejects(owner.dispose(), /fixture input drain failed/u, 'Repeated cleanup must preserve the failed drain barrier');
    assert.equal(owner.controller.page.sessions.size, 0, 'Debugger resources are still released after a drain failure');
    owner = undefined;
  } finally {
    await observation?.close();
    await projection?.close();
    await owner?.dispose();
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('source ownership releases AI navigation restrictions only for user browsing', { timeout: 30000 }, async () => {
  const { createComputerBrowserSource } = await import('./computerBrowserSource.mjs');
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<title>Personal navigation</title><p>Source document</p>');
  });
  server.listen(0);
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let owner;
  try {
    const page = await browser.newPage();
    owner = await createComputerBrowserSource(page, 'navigation-owner');
    const execute = (tool_name, args = {}, extra = {}) => owner.controller.execute({ tool_name, args, allowed_origins: [], script_operation: true, ...extra });
    assert.equal((await execute('browser.navigate', { url: origin })).result.code, 'TAKEOVER_REQUIRED');
    await owner.setUserBrowsing(true);
    await page.goto(origin);
    assert.equal(await page.title(), 'Personal navigation');
    assert.equal((await execute('computer.observe')).error, 'TARGET_NOT_ALLOWED', 'User ownership rejects observation before reading the page');
    await owner.setUserBrowsing(false);
    const denied = await execute('browser.navigate', { url: origin }, { return_control: true });
    assert.equal(denied.result.code, 'TAKEOVER_REQUIRED', 'Handback cannot replay a navigation');
    assert.equal(denied.result.action_executed, false);
    const returned = await execute('computer.screenshot', {}, { return_control: true, allowed_origins: [origin] });
    assert.equal(returned.error, undefined);
    assert.equal(returned.safety.safe_to_send_to_model, true);
    assert.equal((await execute('browser.navigate', { url: origin })).result.code, 'TAKEOVER_REQUIRED', 'AI still needs its current explicit origin grant');
    await assert.rejects(page.goto(origin + '/blocked'), /ERR_BLOCKED_BY_CLIENT/u);
  } finally {
    await owner?.dispose();
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});
