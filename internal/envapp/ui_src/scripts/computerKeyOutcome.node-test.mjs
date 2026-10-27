import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';

test('document and nonfocusable keys reject without input or disconnect; page keys recover', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage();
    await tab.setContent('<h1>Heading</h1><input aria-label="Probe"><main style="height:5000px">Scroll fixture</main>');
    const transport = await tab.context().newCDPSession(tab);
    const send = transport.send.bind(transport), inputs = [];
    transport.send = async (method, params) => {
      if (method.startsWith('Input.')) inputs.push(params);
      return send(method, params);
    };
    const controller = new BrowserComputerController(transport);
    try {
      await controller.initialize();
      const execute = (tool_name, args = {}) => controller.execute({ tool_name, args, full_access: true, script_operation: true });
      const observed = await execute('computer.observe');
      const root = observed.result.observation.nodes.find(node => node.role === 'RootWebArea');
      for (const selector of [{ ref: root.ref }, { role: 'heading' }]) {
        const response = await execute('computer.action', { action: 'key', selector, key: 'PageDown' });
        assert.equal(response.error, 'ELEMENT_NOT_ACTIONABLE', JSON.stringify(response));
        assert.equal(response.result.action_executed, false);
        assert.equal(response.result.stage, 'focus');
        assert.equal(response.result.reason, 'not_focusable');
        assert.equal(controller.page.invalid, false);
        assert.equal(controller.page.uncertainEffect, false);
        assert.equal(inputs.length, 0);
      }
      const pageKey = await execute('computer.key', { key: 'PageDown' });
      assert.equal(pageKey.error, undefined, JSON.stringify(pageKey));
      await tab.waitForFunction(() => globalThis.scrollY > 0);
      assert.deepEqual(inputs.map(input => input.type), ['keyDown', 'keyUp']);
      const textbox = await execute('computer.action', { action: 'key', selector: { role: 'textbox' }, key: 'a' });
      assert.equal(textbox.error, undefined, JSON.stringify(textbox));
      assert.equal(await tab.locator('input').inputValue(), 'a');
    } finally { await controller.page.releasePage(); controller.close(); }
  } finally { await browser.close(); }
});

test('lost focus, keyDown and keyUp acknowledgements remain uncertain without replay', async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const stage of ['focus', 'keyDown', 'keyUp']) await t.test(stage, async () => {
      const context = await browser.newContext(), tab = await context.newPage();
      await tab.setContent('<input aria-label="Probe">');
      const transport = await context.newCDPSession(tab), send = transport.send.bind(transport);
      let lost = 0, keyDowns = 0;
      transport.send = async (method, params) => {
        if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown') keyDowns++;
        const reply = await send(method, params);
        if (method === 'DOM.focus' && stage === 'focus' || method === 'Input.dispatchKeyEvent' && params.type === stage) {
          lost++; throw new Error('private lost acknowledgement');
        }
        return reply;
      };
      const controller = new BrowserComputerController(transport);
      try {
        await controller.initialize();
        const response = await controller.execute({ tool_name: 'computer.action', full_access: true, script_operation: true,
          args: { action: 'key', selector: { role: 'textbox' }, key: 'a' } });
        assert.equal(response.error, 'EFFECT_OUTCOME_UNKNOWN');
        assert.equal(response.result.needs_observation, true);
        assert.equal(response.result.stage, stage === 'focus' ? 'focus' : stage === 'keyUp' ? 'input_release' : 'input_delivery');
        assert.equal(response.result.reason, 'response_unavailable');
        assert.equal(controller.page.invalid, true);
        assert.equal(keyDowns, stage === 'focus' ? 0 : 1);
        assert.ok(lost > 0);
        assert.ok(!JSON.stringify(response).includes('private'));
      } finally { await controller.page.releasePage(); controller.close(); await context.close(); }
    });
  } finally { await browser.close(); }
});
