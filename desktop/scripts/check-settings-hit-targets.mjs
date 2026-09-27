import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_HIT_AREA_OUTPUT || fileURLToPath(new URL('../dist/settings-hit-targets/', import.meta.url));
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
      await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
  }
  async function target(locator, name, padding = 8, height = 32) {
    await locator.scrollIntoViewIfNeeded();
    const geometry = await locator.evaluate(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), height: rect.height,
        overflow: element.scrollWidth > element.clientWidth, cursor: style.cursor, box: rect.toJSON() };
    });
    assert.ok(geometry.left >= padding && geometry.right >= padding, `${name}: text controls need horizontal breathing room (${geometry.left}/${geometry.right}px)`);
    assert.ok(geometry.height >= height, `${name}: the target is at least ${height}px tall`);
    assert.equal(geometry.overflow, false, `${name}: content stays inside the target`);
    assert.equal(geometry.cursor, 'pointer', `${name}: enabled actions remain discoverable`);
    return geometry;
  }
  for (const locale of ['en-US', 'zh-CN', 'de-DE']) for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}ssh-settings.html?locale=${locale}&preset=porcelain-dark`);
    await page.locator('#fixture-open').click(); await settle();
    const tabs = page.getByRole('tab');
    const original = await tabs.first().evaluate(element => ({ classes: element.className, padding: getComputedStyle(element).paddingInline }));
    report.upstream = original;
    await page.screenshot({ path: `${output}/tabs-${locale}-${width}.png`, animations: 'disabled' });
    for (const tab of await tabs.all()) await target(tab, `${locale}/${width} tab`, 12, 40);
    await tabs.nth(1).click({ position: { x: 4, y: 20 } }); await settle();
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true', 'the left padding selects the tab');
    await tabs.nth(0).click({ position: { x: 4, y: 20 } }); await settle();
    assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true');
    await target(page.locator('.ssh-settings-help-link').first(), `${locale}/${width} SSH help`);
    await target(page.locator('.ssh-settings-disclosure'), `${locale}/${width} SSH advanced`);
    await page.locator('.ssh-settings-disclosure').click({ position: { x: 4, y: 16 } }); await settle();
    assert.equal(await page.locator('.ssh-settings-disclosure').getAttribute('aria-expanded'), 'true');
    await tabs.first().focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await settle();
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true', 'keyboard tab switching remains available');
    const panel = page.getByRole('dialog');
    assert.equal(await panel.evaluate(element => element.scrollWidth > element.clientWidth), false);
    report.cases.push(`ssh-${locale}-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}environment-endpoints.html?locale=en-US&preset=porcelain-light`);
  await page.locator('[data-environment="gzcom"] > button').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.redeven-endpoint-listener > summary').waitFor(); await settle();
  await target(dialog.locator('.redeven-endpoint-listener > summary'), 'internal listener');
  await dialog.getByRole('button', { name: 'Change access', exact: true }).click(); await settle();
  await target(dialog.locator('.access-flow-back'), 'back to overview');
  await target(dialog.locator('.environment-access-advanced > summary'), 'advanced network');
  await dialog.locator('.access-flow-back').click({ position: { x: 4, y: 16 } }); await settle();
  await dialog.locator('.redeven-endpoint-listener > summary').waitFor();
  report.cases.push('access-disclosures-and-back');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await context.newPage();
  await mobile.goto(`${base}ssh-settings.html?locale=zh-CN&preset=porcelain-light`);
  await mobile.locator('#fixture-open').tap();
  for (const selector of ['[role="tab"]', '.ssh-settings-help-link', '.ssh-settings-disclosure']) {
    for (const control of await mobile.locator(selector).all()) {
      if (await control.isVisible()) await target(control, `touch ${selector}`, selector === '[role="tab"]' ? 12 : 8, 44);
    }
  }
  await mobile.screenshot({ path: `${output}/touch.png`, animations: 'disabled' });
  await context.close();
  report.cases.push('touch');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
console.log(JSON.stringify(report));
