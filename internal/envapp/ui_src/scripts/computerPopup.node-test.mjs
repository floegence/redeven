/* global window */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';

// Popups preserve native web behavior. The originating action can create a
// window, but never grants Flower control of that new target.
test('native popup workflows preserve effects and require separate target authority', async t => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    if (request.url !== '/') { response.end('<title>Child</title><button>Child action</button>'); return; }
    response.end(`<script>window.savedOpen=window.open</script>
      <button onclick="window.open('/child')">Open</button>
      <button onclick="window.savedOpen('/cached')">Cached open</button>
      <a href="/linked" target="_blank">Link</a>
      <form action="/submitted" method="post" target="_blank"><input name="value" value="fixture"><button>Submit</button></form>
      <button onclick="window.open('http://localhost:${server.address().port}/unapproved')">Other site</button>
      <button onclick="document.querySelector('output').textContent=String(window.open('/proxy')!==null)">Proxy</button><output></output>`);
  });
  server.listen(0); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of ['normal', 'link', 'form', 'other-site', 'proxy', 'cached', 'cancel', 'revoke', 'click-unknown']) await t.test(scenario, async () => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage(); await page.goto(origin);
        const session = await context.newCDPSession(page);
        const send = session.send.bind(session);
        const controller = new BrowserComputerController(session);
        let releases = 0;
        session.send = async (method, params) => {
          const result = await send(method, params);
          if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
            releases++;
            if (scenario === 'click-unknown') throw new Error('lost click acknowledgement');
          }
          return result;
        };
        await controller.initialize();
        if (scenario === 'cancel') controller.cancel();
        const children = [];
        context.on('page', child => children.push(child));
        const name = { link: 'Link', form: 'Submit', 'other-site': 'Other site', proxy: 'Proxy', cached: 'Cached open' }[scenario] || 'Open';
        const request = { tool_name: 'computer.action', args: { action: 'click', selector: { role: scenario === 'link' ? 'link' : 'button', name } }, allowed_origins: scenario === 'revoke' ? [] : [origin], script_operation: true };
        const result = await controller.execute(request);
        if (scenario === 'click-unknown') {
          assert.equal(result.error, 'EFFECT_OUTCOME_UNKNOWN', JSON.stringify(result));
          assert.equal(controller.page.invalid, true);
          assert.equal(controller.page.heldInput.size, 0);
        } else assert.equal(result.safety?.level, ['cancel', 'revoke'].includes(scenario) ? 'takeover' : 'routine', JSON.stringify(result));
        if (['cancel', 'revoke'].includes(scenario)) {
          assert.equal(result.result.action_executed, false);
          assert.equal(children.length, 0);
          assert.equal(releases, 0);
        } else {
          if (!children.length) await context.waitForEvent('page', { timeout: 5000 });
          assert.equal(children.length, 1, 'the originating effect must not be repeated');
          await children[0].waitForLoadState('domcontentloaded');
          const childPath = { normal: '/child', link: '/linked', form: '/submitted', 'other-site': '/unapproved', proxy: '/proxy', cached: '/cached', 'click-unknown': '/child' }[scenario];
          assert.equal(new URL(children[0].url()).pathname, childPath);
          if (scenario !== 'click-unknown') {
            assert.equal(releases, 1);
            assert.equal(result.result.action_executed, true);
            assert.equal(result.result.target_changed, true);
            assert.equal(result.result.opened_pages[0].url.endsWith(childPath), true);
            assert.equal(result.safety.required_origin, undefined, 'child access is checked after selection, without inventing user takeover on the opener');
            // Returning partial progress never implicitly follows a popup or
            // permits another effect on the stopped opener.
            const paused = await controller.execute(request);
            assert.equal(paused.result.action_executed, false);
            assert.equal(children.length, 1);
            assert.equal(releases, 1);
          }
          if (scenario === 'other-site') {
            await children[0].waitForURL(`http://localhost:${server.address().port}/unapproved`);
            const childSession = await context.newCDPSession(children[0]);
            const childController = new BrowserComputerController(childSession);
            await childController.initialize();
            try {
              const denied = await childController.execute({ tool_name: 'computer.observe', args: {}, allowed_origins: [origin], script_operation: true });
              assert.equal(denied.safety.level, 'takeover');
              assert.equal(denied.safety.required_origin, `http://localhost:${server.address().port}`);
              assert.equal(denied.result.observation, undefined);
              const allowed = await childController.execute({ tool_name: 'computer.screenshot', args: {}, full_access: true, recovery_observation: true });
              assert.equal(allowed.safety.level, 'routine');
              assert.ok(allowed.screenshot);
              assert.ok((await childController.execute({ tool_name: 'computer.observe', args: {}, full_access: true })).result.observation);
            } finally { await childController.page.releasePage(); childController.close(); await childSession.detach(); }
          }
          if (scenario === 'proxy') assert.equal(await page.locator('output').textContent(), 'true');
        }
        assert.equal(await page.evaluate(() => window.open === window.savedOpen), true, 'automation changed window.open semantics');
        await controller.page.releasePage(); controller.close(); await session.detach();
      } finally { await context.close(); }
    });
  } finally { await browser.close(); server.close(); }
});
