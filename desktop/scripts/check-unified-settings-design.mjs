import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

// IMPORTANT: Mount the production Welcome host, appearance, Flower, extensions
// and computer owners. Only their external data/persistence boundary is a fixture.
const output = process.env.REDEVEN_SETTINGS_DESIGN_OUTPUT || fileURLToPath(new URL('../dist/unified-settings-design/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['unified-settings.html']);
const browser = await chromium.launch();
const report = { cases: [], errors: [], status: 'running' };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  async function settle() {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
    });
  }
  for (const locale of ['en-US', 'zh-CN', 'de-DE']) for (const mode of ['light', 'dark']) for (const width of [1280, 768, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: mode, reducedMotion: width === 320 ? 'reduce' : 'no-preference' });
    await page.goto(`${server.resolvedUrls.local[0]}unified-settings.html?locale=${locale}&mode=${mode}`);
    await page.locator('#fixture-open').click();
    await page.locator('.floe-theme-picker').waitFor(); await settle();
    const dialog = page.locator('.redeven-unified-settings-dialog');
    assert.equal(await dialog.locator('.floe-settings-navigation__label').count(), 0, 'no empty group heading');
    assert.equal(await dialog.locator('h1').count(), 0, 'the category title belongs to the header');
    assert.equal(await dialog.locator('h2:not(.sr-only)').count(), 1, 'Theme appears once');
    const modeBox = await page.locator('.floe-theme-picker__modes').boundingBox();
    assert.ok(modeBox.width < 340 && modeBox.height <= 36, JSON.stringify({ locale, width, modeBox }));
    const checkedPresets = await page.locator('.floe-theme-picker__caption > .floe-theme-picker__check').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).visibility === 'visible').map(node => node.closest('[data-theme-preset]').getAttribute('aria-checked')));
    assert.deepEqual(checkedPresets, ['true'], 'only the selected theme shows a check');
    const language = dialog.locator('.floe-setting-row__control [role="combobox"]');
    assert.ok((await language.boundingBox()).width <= 330);
    const appearanceInput = await language.elementHandle();
    for (const kind of ['mode', 'preset']) {
      await page.evaluate(kind => {
        const selector = kind === 'mode' ? '.floe-theme-picker__modes [aria-checked=false]' : '[data-theme-preset][aria-checked=false]';
        document.querySelector(selector).click();
        window.unifiedSettingsFixture.session.open({ section: 'ai' });
        window.unifiedSettingsFixture.session.open({ section: 'appearance' });
      }, kind);
      await page.waitForFunction(() => !document.querySelector('.floe-theme-picker [aria-busy=true]'));
      assert.equal(await page.evaluate(() => window.unifiedSettingsFixture.writes()), 0, 'returning does not revive a deferred choice');
    }
    if (width < 800) {
      const navigation = dialog.locator('.redeven-settings-dialog-mobile [role=combobox]');
      await navigation.click();
      await page.getByRole('listbox').waitFor();
      assert.equal(await page.getByRole('listbox').count(), 1, 'the header mounts one category popup');
      const revision = await page.evaluate(() => window.unifiedSettingsFixture.session.revision());
      await page.getByRole('option').nth(2).click();
      assert.deepEqual(await page.evaluate(() => ({ section: window.unifiedSettingsFixture.session.target().section, revision: window.unifiedSettingsFixture.session.revision() })), { section: 'ai', revision: revision + 1 }, 'one selection admits one navigation');
      await page.getByRole('listbox').waitFor({ state: 'hidden' });
      await page.evaluate(() => window.unifiedSettingsFixture.session.open({ section: 'appearance' }));
      await navigation.click(); await page.getByRole('listbox').waitFor();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole('listbox').waitFor({ state: 'hidden' });
      await page.setViewportSize({ width, height: 900 }); await settle();
      assert.equal(await page.getByRole('listbox').count(), 0, 'resizing back cannot revive a hidden header popup');
    }
    for (const category of ['appearance', 'ai', 'extensions', 'browser']) {
      await page.evaluate(section => window.unifiedSettingsFixture.session.open({ section }), category);
      if (category === 'ai') await page.locator('.flower-settings-current-model').waitFor();
      if (category === 'browser') await page.locator('.flower-computer-host').filter({ hasText: 'Development Mac' }).waitFor();
      await settle();
      const metrics = await dialog.evaluate(element => {
        const page = [...element.querySelectorAll('.redeven-settings-dialog-page')].find(e => !e.hidden);
        const selected = element.querySelector('.floe-settings-navigation__item[aria-current]');
        const header = element.querySelector('.redeven-settings-dialog-heading');
        const content = element.querySelector('.floe-settings-layout__content');
        const sidebar = element.querySelector('.floe-settings-layout__sidebar');
        const model = page.querySelector('.flower-settings-current-model');
        return { overflow: page.scrollWidth > page.clientWidth + 1, width: element.getBoundingClientRect().width,
          rail: getComputedStyle(selected, '::before').content,
          colors: [header, content.parentElement, sidebar].map(e => getComputedStyle(e).backgroundColor),
          modelInset: model ? model.getBoundingClientRect().top - page.getBoundingClientRect().top : undefined,
          emptyFlowerHeader: !!page.querySelector('.flower-settings-title-row') };
      });
      assert.equal(metrics.overflow, false, `${locale}/${mode}/${width}/${category}: overflow`);
      assert.equal(metrics.rail, 'none', 'selected rows never have a left rail');
      assert.equal(new Set(metrics.colors).size, 1, 'header/sidebar/body use a continuous background');
      if (category === 'ai') {
        assert.equal(metrics.emptyFlowerHeader, false);
        assert.ok(metrics.modelInset <= 26, `unexpected space before Models: ${metrics.modelInset}`);
      }
      assert.equal(await dialog.locator('.redeven-unified-settings-dialog-root').getByText('Local Environment', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.unifiedSettingsFixture.writes()), 0, 'navigation does not save');
      await page.screenshot({ path: `${output}/${locale}-${mode}-${width}-${category}.png`, animations: 'disabled' });
      report.cases.push({ locale, mode, width, category, ...metrics });
    }
    await page.evaluate(() => window.unifiedSettingsFixture.session.open({ section: 'appearance' }));
    assert.equal(await language.evaluate((element, original) => element === original, appearanceInput), true, 'language control retains identity');
    await language.click(); await page.getByRole('listbox').waitFor();
    await page.evaluate(() => window.unifiedSettingsFixture.session.open({ section: 'ai' }));
    await page.getByRole('listbox').waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement === document.getElementById('fixture-open'));
    assert.equal(await page.locator('#fixture-open').evaluate(e => e === document.activeElement), true);
    await page.locator('#fixture-open').click(); await settle();
    if (width === 1280) {
      await page.mouse.click(4, 450); await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement === document.getElementById('fixture-open'));
      assert.equal(await page.locator('#fixture-open').evaluate(e => e === document.activeElement), true);
    } else { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log(`Welcome settings design passed: ${report.cases.length} populated cases, compact controls, single headings, no rails, continuous surfaces, retained inputs, Escape/backdrop and focus return.`);
} finally {
  await writeFile(`${output}/acceptance.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
