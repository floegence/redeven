/* global window */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

for (const colorScheme of ['light', 'dark']) test(`extension popup exposes one useful action while connecting or requiring update (${colorScheme})`, async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ colorScheme });
  await page.route('http://popup.test/**', async route => {
    const asset = new URL(route.request().url()).pathname.slice(1) || 'popup.html';
    if (!['popup.html', 'popup.mjs', 'popup.css', 'messages.mjs'].includes(asset)) return route.fulfill({ body: '' });
    await route.fulfill({ body: await readFile(new URL(`../../../../browser-extension/${asset}`, import.meta.url)), contentType: asset.endsWith('.mjs') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.addInitScript(() => {
    window.commands = []; window.opened = [];
    window.chrome = {
      i18n: { getUILanguage: () => 'en-US' },
      runtime: { id: 'fixture', onMessage: { addListener() {} }, sendMessage: async message => {
        window.commands.push(message);
        if (message.command === 'connect') return new Promise(resolve => { window.completeConnection = resolve; });
        return { connected: false, error: '', nativeHost: 'dev.floegence.redeven.r123456789abcdef0' };
      } },
      tabs: { create: async request => { window.opened.push(request); } },
    };
  });
  await page.goto('http://popup.test/popup.html#dev.floegence.redeven.r123456789abcdef0');
  await page.locator('#connect-button').click();
  assert.equal(await page.locator('#connect-button').isDisabled(), true);
  assert.equal(await page.locator('#status').textContent(), 'Connecting…');
  await page.evaluate(() => window.completeConnection({ connected: false, error: 'extension_update_required' }));
  await page.locator('#repair').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#connect').isVisible(), false, 'incompatible code cannot connect; the update is the only primary action');
  assert.match(await page.locator('#status').textContent(), /update/);
  await page.locator('#repair').click();
  assert.deepEqual(await page.evaluate(() => window.opened), [{ url: 'chrome://extensions/?id=fixture' }]);
  assert.equal(await page.evaluate(() => window.commands.filter(value => value.command === 'connect').length), 1);
});
