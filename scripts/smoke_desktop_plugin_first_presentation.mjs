import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Acceptance observes the real isolated plugin from the browser driver. Product
// code never reads its DOM, intercepts its bridge or substitutes its resources.
export async function verifyPluginFirstPresentation(page, reportRoot) {
  const cases = [];
  const switchMode = async name => {
    await page.getByRole('tab', { name, exact: true }).filter({ visible: true }).evaluate(node => node.click());
    await page.getByRole('tab', { name, exact: true, selected: true }).filter({ visible: true }).waitFor();
  };
  const selector = '[data-redeven-plugin-activity-window="true"]';
  const theme = await page.evaluate(() => window.redevenDesktopTheme.getSnapshot().source);
  const network = await page.context().newCDPSession(page);
  await network.send('Network.enable');
  await network.send('Network.setCacheDisabled', { cacheDisabled: true });
  try {
    for (const colorScheme of ['dark', 'light']) {
      await page.evaluate(value => window.redevenDesktopTheme.setSource(value), colorScheme);
      for (const delayed of [false, true]) {
        await page.reload();
        await switchMode('Activity');
        await page.locator('[aria-controls="redeven-plugin-switcher"]').click();
        const tile = page.locator('[data-plugin-panel-tile]').filter({ hasText: 'Weather' });
        await tile.waitFor();
        let moduleFinished;
        const finished = new Promise(resolve => { moduleFinished = resolve; });
        let heldModule = false;
        let releaseModule;
        const released = new Promise(resolve => { releaseModule = resolve; });
        let requestedModule;
        const requested = new Promise(resolve => { requestedModule = resolve; });
        const modulePattern = '**/assets/index-*.js';
        if (delayed) await page.route(modulePattern, async route => {
          if (!new URL(route.request().url()).hostname.endsWith('.localhost')) return route.continue();
          heldModule = true; requestedModule(); await released;
          try { await route.continue(); } finally { moduleFinished(); }
        });
        try {
          await tile.click();
          const window = page.locator(selector);
          await window.waitFor();
          assert.equal(await window.locator('[data-plugin-quick-pin]').count(), 0);
          if (delayed) {
            await Promise.race([requested, new Promise((_, reject) => setTimeout(() => reject(new Error('No cold application module request')), 10000))]);
            await page.waitForTimeout(250);
            assert.equal(await window.locator('[data-plugin-surface-opening]').count(), 1, 'retain one waiting surface while the module is held');
            assert.deepEqual(await window.locator('iframe').evaluate(frame => ({ opacity: frame.style.opacity, inert: frame.inert })), { opacity: '0', inert: true });
            await page.screenshot({ path: path.join(reportRoot, `${colorScheme}-cold-waiting.png`) });
          }
          releaseModule();
          await window.locator('[data-plugin-surface-host][data-surface-instance-id]').waitFor();
          const frame = await (await window.locator('iframe').elementHandle()).contentFrame();
          const presentation = await frame.evaluate(() => ({
            mounted: Boolean(document.getElementById('app')?.childElementCount),
            theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          }));
          assert.deepEqual(presentation, { mounted: true, theme: colorScheme });
          const search = frame.locator('input[name="query"]');
          await search.fill('Retained query');
          const surface = await window.locator('[data-plugin-surface-host]').getAttribute('data-surface-instance-id');
          await switchMode('Workbench');
          await switchMode('Activity');
          assert.equal(await window.locator('[data-plugin-surface-host]').getAttribute('data-surface-instance-id'), surface);
          assert.equal(await search.inputValue(), 'Retained query');
          await page.screenshot({ path: path.join(reportRoot, `${colorScheme}-${delayed ? 'delayed' : 'cold'}-ready.png`) });
          await window.getByRole('button', { name: 'Close', exact: true }).click();
          await window.waitFor({ state: 'detached' });
          await page.locator('[aria-controls="redeven-plugin-switcher"]').click();
          await page.locator('[data-plugin-panel-tile]').filter({ hasText: 'Weather' }).click();
          await window.locator('[data-plugin-surface-host][data-surface-instance-id]').waitFor();
          assert.notEqual(await window.locator('[data-plugin-surface-host]').getAttribute('data-surface-instance-id'), surface);
          await window.getByRole('button', { name: 'Close', exact: true }).click();
          await window.waitFor({ state: 'detached' });
          cases.push({ colorScheme, delayed, presentation, retainedAcrossModes: true, freshReopen: true, headerPin: false });
        } finally { releaseModule(); if (heldModule) await finished; if (delayed) await page.unroute(modulePattern); }
      }
    }
    return { passed: true, cases };
  } finally {
    await network.send('Network.setCacheDisabled', { cacheDisabled: false });
    await network.detach();
    await page.evaluate(value => window.redevenDesktopTheme.setSource(value), theme);
  }
}

async function main() {
  const [rawPort, reportRoot] = process.argv.slice(2);
  const port = Number(rawPort);
  assert(Number.isInteger(port) && port > 1024 && reportRoot, 'Usage: node scripts/smoke_desktop_plugin_first_presentation.mjs <task-owned CDP port> <report directory>');
  const require = createRequire(import.meta.url);
  const { chromium } = require('../internal/envapp/ui_src/node_modules/playwright');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('http') && page.url().includes('/_redeven_proxy/env/'));
    assert(page, 'Open the task-owned Desktop environment with released Weather installed');
    await fs.mkdir(reportRoot, { recursive: true });
    const report = await verifyPluginFirstPresentation(page, reportRoot);
    await fs.writeFile(path.join(reportRoot, 'first-presentation.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
