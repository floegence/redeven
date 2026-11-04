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
          const oldRefs=[...controller.page.references.keys()];
          const result = await execute('browser.navigate', { url: `${origin}/failed` });
          assert.equal(result.error, 'NAVIGATION_FAILED', JSON.stringify(result));
          assert.deepEqual(result.result, { action_executed: true, navigation_stage: 'response', network_error: reason.startsWith('ERR_') ? reason : 'NETWORK_ERROR' });
          assert.equal(controller.page.invalid, false);
          for(const ref of oldRefs)await assert.rejects(controller.page.resolve({ref}),/STALE_REFERENCE/);
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
  assert.equal(result.error, undefined);
  assert.equal(result.result.action_executed, true);
  assert.equal(result.result.wait.state, 'timeout');
  assert.equal(result.result.navigation_stage, 'response');
  assert.equal(controller.page.invalid, false);
  assert.equal(controller.page.uncertainEffect, false);
  assert.equal(navigations, 1);
  assert.equal(transport.listenerCount('Page.loadEventFired'), 0);
});

test('lost navigation acknowledgement remains unknown and never replays', async () => {
  const { transport, controller, execute } = navigationFixture();
  let navigations = 0;
  transport.send = async () => { navigations++; throw new Error('lost acknowledgement with private details'); };
  assert.deepEqual(await execute(), { error: 'EFFECT_OUTCOME_UNKNOWN', result: { stage: 'action', reason: 'response_unavailable', needs_observation: true } });
  assert.equal(controller.page.invalid, true);
  assert.equal(navigations, 1);
});

test('invalid navigation replies cannot claim confirmed failure', async t => {
  for (const reply of [null, [], { errorText: true }, { errorText: 'net::ERR_ABORTED', isDownload: 'yes' }]) {
    await t.test(JSON.stringify(reply), async () => {
      const { transport, controller, execute } = navigationFixture();
      transport.send = async () => reply;
      assert.deepEqual(await execute(), { error: 'EFFECT_OUTCOME_UNKNOWN', result: { stage: 'action', reason: 'response_unavailable', needs_observation: true } });
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
  assert.deepEqual(await execute(), { error: 'EFFECT_OUTCOME_UNKNOWN', result: { stage: 'input_release', reason: 'response_unavailable', needs_observation: true } });
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

test('script navigation publishes only its receipt without a post-navigation page read', async () => {
  const { transport, controller, execute } = navigationFixture();
  let navigations = 0, safetyReads = 0;
  controller.page.safety = async () => {
    safetyReads++;
    if (navigations) throw new Error('new document context unavailable');
    return { level: 'routine', safe_to_capture: true, safe_to_send_to_model: true };
  };
  transport.send = async method => {
    assert.equal(method, 'Page.navigate'); navigations++;
    queueMicrotask(() => transport.emit('Page.lifecycleEvent', { name: 'load', loaderId: 'new' }));
    return { loaderId: 'new' };
  };
  const response = await execute();
  assert.equal(response.error, undefined, JSON.stringify(response));
  assert.equal(response.result.navigation_stage,'load');
  assert.equal(response.result.wait.state,'reached');
  assert.equal(response.result.command_acknowledged,true);
  assert.equal(response.result.action_executed,true);
  assert.equal(response.result.needs_observation,true);
  assert.equal(response.result.observation_invalidated,true);
  assert.equal(response.safety.safe_to_send_to_model, false);
  assert.equal(response.screenshot, undefined);
  assert.equal(safetyReads, 0);
  assert.equal(navigations, 1);
  const read = await controller.execute({ tool_name: 'computer.observe', script_operation: true, full_access: true });
  assert.equal(read.error, 'TARGET_OBSERVATION_UNAVAILABLE');
  assert.equal(read.result.action_executed, false);
  assert.equal(navigations, 1, 'a failed explicit read never replays navigation');
});

for (const boundary of ['permission', 'stop', 'connection', 'cancel']) test('navigation receipts respect cleanup boundary: ' + boundary, async () => {
  const { transport, controller, execute } = navigationFixture();
  transport.send = async () => {
    queueMicrotask(() => transport.emit('Page.lifecycleEvent', { name: 'load', loaderId: 'new' }));
    return { loaderId: 'new' };
  };
  controller.page.releaseInput = async () => {
    if (boundary === 'permission') controller.page.requiredOrigin = 'https://private.test';
    if (boundary === 'stop') controller.page.stopped = true;
    if (boundary === 'connection') controller.page.invalid = true;
    if (boundary === 'cancel') controller.page.operationCancelled = true;
  };
  const response = await execute();
  assert.equal(response.result.action_executed, true);
  assert.equal(response.screenshot, undefined);
  if (boundary === 'permission' || boundary === 'stop') assert.equal(response.safety.level, 'takeover');
  else assert.equal(response.error, boundary === 'connection' ? 'TARGET_CONNECTION_REQUIRED' : 'TARGET_OBSERVATION_UNAVAILABLE');
});

test('real navigation receipts survive delayed documents, redirects and frame replacement without post-action reads', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/loaded' }); response.end(); return; }
    const finish = () => { response.setHeader('content-type','text/html'); response.end('<title>Loaded</title><h1>Current page</h1>' + (request.url === '/frames' ? '<iframe src="/loaded"></iframe>' : '')); };
    if (request.url === '/delayed') setTimeout(finish, 80); else finish();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({headless:true});
  try {
    for (const path of ['/delayed','/redirect','/frames']) {
      const context = await browser.newContext(); const page = await context.newPage(); await page.goto(origin);
      const transport = await context.newCDPSession(page); const controller = new BrowserComputerController(transport); await controller.initialize();
      const send = transport.send.bind(transport); let navigations = 0, rejectReads = false;
      transport.send = async (method, parameters) => {
        if (rejectReads && method === 'DOMSnapshot.captureSnapshot') throw new Error('transient context unavailable');
        const response = await send(method, parameters);
        if (method === 'Page.navigate') { navigations++; rejectReads = true; }
        return response;
      };
      const execute = (tool_name, args = {}) => controller.execute({tool_name,args,allowed_origins:[origin],script_operation:true});
      const receipt = await execute('browser.navigate', {url:origin+path});
      assert.equal(receipt.error, undefined, JSON.stringify(receipt));
      assert.equal(receipt.result.navigation_stage, 'load');
      assert.equal(receipt.result.observation, undefined);
      assert.equal(receipt.result.title, undefined);
      const unavailable = await execute('computer.observe');
      assert.equal(unavailable.error, 'TARGET_OBSERVATION_UNAVAILABLE');
      assert.deepEqual(unavailable.result.diagnostic, {phase:'protocol',method:'DOMSnapshot.captureSnapshot'});
      assert.equal(unavailable.result.action_executed, false);
      rejectReads = false;
      const fresh = await execute('computer.observe');
      assert.ok(fresh.result.observation.nodes.some(node => node.name === 'Current page'), JSON.stringify(fresh));
      assert.equal(navigations, 1);
      await controller.page.releasePage(); controller.close(); await context.close();
    }
  } finally { await browser.close(); server.closeAllConnections(); server.close(); }
});
