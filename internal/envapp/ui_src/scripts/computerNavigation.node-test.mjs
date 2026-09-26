import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';

test('confirmed navigation failures preserve the page without replaying the command', async t => {
  const server = http.createServer((_request, response) => response.end('<h1>Recovered page</h1>'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const reason of ['ERR_TUNNEL_CONNECTION_FAILED', 'ERR_CONNECTION_FAILED', 'ERR_NAME_NOT_RESOLVED', 'private exception with credentials']) {
      await t.test(reason, async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(origin);
        await context.route(`${origin}/failed`, route => route.abort('connectionfailed'));
        const transport = await context.newCDPSession(page);
        const send = transport.send.bind(transport);
        let navigations = 0;
        transport.send = async (method, params) => {
          const reply = await send(method, params);
          if (method === 'Page.navigate') {
            navigations++;
            if (params.url.endsWith('/failed')) return { ...reply, errorText: `net::${reason}` };
          }
          return reply;
        };
        const controller = new BrowserComputerController(transport);
        try {
          await controller.initialize();
          const execute = (tool_name, args = {}) => controller.execute({ tool_name, args, allowed_origins: [origin], script_operation: true });
          await execute('computer.observe');
          assert.ok(controller.page.references.size > 0);
          const result = await execute('browser.navigate', { url: `${origin}/failed` });
          assert.equal(result.error, 'NAVIGATION_FAILED', JSON.stringify(result));
          assert.deepEqual(result.result, { action_executed: true, navigation_stage: 'response', network_error: reason.startsWith('ERR_') ? reason : 'NETWORK_ERROR' });
          assert.equal(controller.page.invalid, false);
          assert.equal(controller.page.references.size, 0);
          assert.equal(result.screenshot, undefined);
          await page.waitForFunction(() => globalThis.document.readyState === 'complete' && globalThis.location.protocol === 'chrome-error:');
          const observed = await execute('computer.observe');
          assert.equal(observed.error, undefined, JSON.stringify(observed));
          assert.equal(observed.safety.level, 'routine', JSON.stringify(observed));
          assert.ok(observed.result.observation);
          assert.equal(navigations, 1, 'observation must not repeat navigation');
          const revoked = await controller.execute({ tool_name: 'computer.observe', allowed_origins: [] });
          assert.equal(revoked.safety.required_origin, origin, JSON.stringify(revoked));
          assert.equal(revoked.safety.level, 'takeover');
          const recovered = await execute('browser.navigate', { url: origin });
          assert.equal(recovered.error, undefined, JSON.stringify(recovered));
          assert.equal(navigations, 2, JSON.stringify({ observed, recovered }));
          assert.equal(await page.locator('h1').textContent(), 'Recovered page');
        } finally {
          await controller.page.releasePage(); controller.close(); await context.close();
        }
      });
    }
  } finally { await browser.close(); server.close(); }
});

function navigationFixture() {
  const transport = new EventEmitter();
  const controller = new BrowserComputerController(transport);
  controller.page.beginObservation = async () => {};
  controller.page.safety = async () => ({ level: 'routine', safe_to_capture: true, safe_to_send_to_model: true });
  controller.page.preparePage = async () => {};
  return { transport, controller, execute: () => controller.execute({ tool_name: 'browser.navigate', args: { url: 'https://example.test/' }, full_access: true, script_operation: true }) };
}

test('loading timeout after acknowledgement is a known navigation result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { transport, controller, execute } = navigationFixture();
  let navigations = 0;
  transport.send = async method => { assert.equal(method, 'Page.navigate'); navigations++; return { loaderId: 'pending' }; };
  const pending = execute();
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  t.mock.timers.tick(20000);
  const result = await pending;
  assert.deepEqual(result, { error: 'NAVIGATION_TIMEOUT', result: { action_executed: true, navigation_stage: 'load' } });
  assert.equal(controller.page.invalid, false);
  assert.equal(controller.page.uncertainEffect, false);
  assert.equal(navigations, 1);
  assert.equal(transport.listenerCount('Page.loadEventFired'), 0);
});

test('lost navigation acknowledgement remains unknown and never replays', async () => {
  const { transport, controller, execute } = navigationFixture();
  let navigations = 0;
  transport.send = async () => { navigations++; throw new Error('lost acknowledgement with private details'); };
  assert.deepEqual(await execute(), { error: 'EFFECT_OUTCOME_UNKNOWN' });
  assert.equal(controller.page.invalid, true);
  assert.equal(navigations, 1);
});

test('invalid navigation replies cannot claim confirmed failure', async t => {
  for (const reply of [null, [], { errorText: true }, { errorText: 'net::ERR_ABORTED', isDownload: 'yes' }]) {
    await t.test(JSON.stringify(reply), async () => {
      const { transport, controller, execute } = navigationFixture();
      transport.send = async () => reply;
      assert.deepEqual(await execute(), { error: 'EFFECT_OUTCOME_UNKNOWN' });
      assert.equal(controller.page.invalid, true);
    });
  }
});

test('a failed key release still wins over a confirmed navigation failure', async () => {
  const { transport, controller, execute } = navigationFixture();
  controller.page.heldInput.set('key:Enter', { session: transport, method: 'Input.dispatchKeyEvent', parameters: { key: 'Enter', type: 'keyDown' } });
  let releases = 0;
  transport.send = async method => {
    if (method === 'Page.navigate') return { errorText: 'net::ERR_CONNECTION_FAILED' };
    assert.equal(method, 'Input.dispatchKeyEvent'); releases++; throw new Error('release acknowledgement lost');
  };
  assert.deepEqual(await execute(), { error: 'EFFECT_OUTCOME_UNKNOWN' });
  assert.equal(releases, 1);
  assert.equal(controller.page.invalid, true);
});

test('explicit Stop during the navigation load wait keeps the takeover boundary', async () => {
  const { transport, controller, execute } = navigationFixture();
  transport.send = async () => { queueMicrotask(() => controller.cancel()); return { loaderId: 'pending' }; };
  const response = await execute();
  assert.equal(response.result.code, 'TAKEOVER_REQUIRED');
  assert.equal(response.result.action_executed, true);
  assert.equal(response.safety.safe_to_send_to_model, false);
});
