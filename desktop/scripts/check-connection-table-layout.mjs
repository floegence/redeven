import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_CONNECTION_TABLE_OUTPUT || fileURLToPath(new URL('../dist/connection-table-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
const browser = await chromium.launch();
const report = { cases: [], errors: [], status: 'running' };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  const base = server.resolvedUrls.local[0];
  async function settle() {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
  }
  async function inspect(surface, name) {
    await settle();
    const groups = surface.locator('[data-address-scope="this_device"], [data-address-scope="network"]');
    for (const group of await groups.all()) {
      const summary = group.locator('.redeven-address-summary');
      if (await summary.count() && !await group.evaluate(element => element.open)) await summary.click();
      await settle();
      const metrics = await group.evaluate(element => {
        const heading = element.querySelector('th').getBoundingClientRect();
        const viewport = element.querySelector('.redeven-address-viewport');
        const scopeStyle = getComputedStyle(element.querySelector('.redeven-card-endpoint-label'));
        const columnStyle = getComputedStyle(element.querySelector('th'));
        const viewportStyle = getComputedStyle(viewport);
        const rows = [...element.querySelectorAll('[data-endpoint-kind="address"]')].map(row => {
          const value = row.querySelector('.redeven-card-endpoint-value').getBoundingClientRect();
          const actions = row.querySelector('.redeven-endpoint-actions').getBoundingClientRect();
          return { left: value.left, right: actions.right, height: row.getBoundingClientRect().height, background: getComputedStyle(row).backgroundColor,
            overlap: value.right > actions.left + 1, buttons: [...row.querySelectorAll('button')].map(button => {
              const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height };
            }) };
        });
        return { heading: heading.left + 12, rows, scopeWeight: Number(scopeStyle.fontWeight), columnWeight: Number(columnStyle.fontWeight),
          frameWidth: viewportStyle.borderTopWidth, frameColor: viewportStyle.borderTopColor, fill: viewportStyle.backgroundColor,
          paragraphs: element.querySelectorAll('.redeven-card-endpoint-detail').length,
          tables: element.querySelectorAll('table[aria-labelledby]').length, overflow: viewport.scrollWidth > viewport.clientWidth,
          outerOverflow: element.scrollWidth > element.clientWidth, tableBottom: viewport.getBoundingClientRect().bottom };
      });
      assert.ok(metrics.rows.length > 0, `${name}: addresses remain visible`);
      assert.ok(metrics.rows.every(row => Math.abs(row.left - metrics.heading) <= 1), `${name}: URL rows align with their column heading; no phantom label column`);
      assert.equal(metrics.paragraphs, 0, `${name}: scope help does not consume a body row`);
      assert.equal(metrics.tables, 1, `${name}: addresses form one labelled table`);
      assert.equal(metrics.frameWidth, '1px', `${name}: the URL list has a visible frame`);
      assert.notEqual(metrics.frameColor, metrics.fill, `${name}: the frame contrasts with the table fill`);
      assert.ok(metrics.scopeWeight > metrics.columnWeight, `${name}: scope titles are stronger than column headers`);
      assert.equal(new Set(metrics.rows.map(row => row.background)).size, 1, `${name}: data rows use one uniform fill without zebra stripes`);
      assert.equal(metrics.overflow || metrics.outerOverflow, false, `${name}: values wrap inside the available width`);
      assert.ok(metrics.rows.every(row => !row.overlap), `${name}: URL and action cells do not overlap`);
      assert.ok(metrics.rows.every(row => row.buttons.every(button => button.width === 28 && button.height === 28)), `${name}: action targets have one consistent size`);
      if (!name.includes('long')) assert.ok(metrics.rows.every(row => row.height <= 40), `${name}: single-line address rows are compact`);
      assert.ok(metrics.rows.every(row => Math.abs(row.right - metrics.rows[0].right) <= 1), `${name}: actions share a trailing edge`);
    }
    report.cases.push(name);
  }
  for (const preset of ['porcelain-light', 'porcelain-dark', 'hc-light']) {
    for (const locale of ['en-US', 'zh-CN', 'de-DE']) {
      await page.goto(`${base}environment-endpoints.html?preset=${preset}&locale=${locale}&network-local=1`);
      await page.locator('[data-environment="Local Environment"] > button').click();
      await inspect(page.getByRole('dialog'), `settings-${preset}-${locale}`);
      await page.goto(`${base}environment-endpoints.html?preset=${preset}&locale=${locale}`);
      await page.locator('[data-environment="Network"] .redeven-card-fact-endpoint-trigger').click();
      await inspect(page.locator('.redeven-endpoints-popover'), `popover-${preset}-${locale}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}environment-endpoints.html?preset=porcelain-dark&locale=en-US&multiple=1`);
  await page.locator('[data-environment="Network"] .redeven-card-fact-endpoint-trigger').click();
  await inspect(page.locator('.redeven-endpoints-popover'), 'popover-narrow-long');
  await page.screenshot({ path: `${output}/narrow.png`, animations: 'disabled' });
  await page.getByRole('button', { name: 'Copy Environment URL', exact: true }).first().click();
  assert.ok((await page.locator('[data-copy-result]').innerText()).startsWith('https://'));
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.matches('button:focus-visible')), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-environment="Network"] .redeven-card-fact-endpoint-trigger').evaluate(element => element === document.activeElement), true);
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await touch.newPage();
  await mobile.goto(`${base}environment-endpoints.html?locale=en-US`);
  await mobile.locator('[data-environment="Network"] .redeven-card-fact-endpoint-trigger').tap();
  const targets = await mobile.locator('.redeven-endpoint-actions button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect(); return [rect.width, rect.height];
  }));
  assert.ok(targets.length >= 3 && targets.every(([width, height]) => width >= 44 && height >= 44), 'touch actions retain full targets');
  await touch.close();
  report.cases.push('keyboard-copy-and-touch');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
console.log(JSON.stringify(report));
