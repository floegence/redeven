import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/welcome-toolbar-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], state: server.config.cacheDir, output, cases: [], errors: [] };
try {
  const load = path => server.ssrLoadModule(fileURLToPath(new URL(path, import.meta.url)));
  const { mixedEnvironmentFixture } = await load('../src/testSupport/mixedEnvironmentFixture.ts');
  const { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } = await load('../src/shared/i18n/index.ts');
  const { snapshot } = mixedEnvironmentFixture();
  for (const locale of REDEVEN_SUPPORTED_LOCALES) {
    const i18n = createDesktopI18n(locale);
    const labels = ['environmentCenter.newEnvironmentTitle', 'environmentCenter.connectProvider', 'environmentCenter.addGateway'].map(key => i18n.t(key));
    const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('environment-settings.html', report.url).href);
    await page.locator('[data-environment-group]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('h1').evaluate(node => getComputedStyle(node).fontSize), '16px', 'Welcome page title uses the shared heading tier');
    for (const [width, fontSize] of [[320, 16], [390, 16], [768, 16], [1367, 16], [1024, 24]]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      for (const tab of [0, 1, 2]) {
        await page.locator('.redeven-console-tab').nth(tab).click();
        const geometry = await page.locator('.redeven-center-actions').evaluate(toolbar => {
          const input = toolbar.querySelector('input');
          const buttons = [...toolbar.querySelectorAll('button')];
          const read = element => ({ ...element.getBoundingClientRect().toJSON(), text: element.innerText?.trim(),
            name: element.getAttribute('aria-label'), cursor: getComputedStyle(element).cursor,
            iconWidth: element.querySelector('svg')?.getBoundingClientRect().width ?? 0 });
          return { toolbar: read(toolbar), input: read(input), buttons: buttons.map(read) };
        });
        const label = `${locale}:${width}:${fontSize}:tab-${tab}`;
        const primary = geometry.buttons.at(-1);
        if (width >= 640 && fontSize === 16) assert.equal(geometry.input.height, 32, `${label}: desktop toolbar uses the shared 32px scale`);
        for (const button of geometry.buttons) {
          assert.ok(Math.abs(button.y - geometry.input.y) < 1 && Math.abs(button.height - geometry.input.height) < 1, `${label}: search and actions share one aligned row`);
          assert.ok(button.x >= geometry.input.right && button.right <= geometry.toolbar.right + 1, `${label}: actions fit beside search`);
          assert.equal(button.cursor, 'pointer', `${label}: action affordance`);
          assert.ok(button.iconWidth >= 14, `${label}: action icon is visible`);
          if (width < 640) {
            assert.equal(button.text, '', `${label}: mobile action uses only an icon`);
            assert.ok(button.width >= 44 && button.height >= 44 && button.iconWidth >= 18, `${label}: touch target and icon stay clear`);
          }
        }
        assert.ok(geometry.input.width >= 120 && geometry.input.x >= geometry.toolbar.x, `${label}: search remains usable`);
        assert.equal(primary.name, labels[tab], `${label}: icon action retains its full accessible name`);
        if (width >= 640) assert.ok(primary.text && !primary.text.includes('Redeven Cloud'), `${label}: desktop label stays concise`);
        report.cases.push(label);
        if (tab === 1 && fontSize === 16 && [390, 1367].includes(width) && ['en-US', 'zh-CN'].includes(locale)) {
          await page.locator('.redeven-header-separator').screenshot({ path: `${output}/${locale}-${width}.png` });
        }
      }
    }

    // The same accessible buttons open the intended workflows at touch width.
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
    for (const tab of [0, 1, 2]) {
      await page.locator('.redeven-console-tab').nth(tab).click();
      const action = page.locator('.redeven-center-actions').getByRole('button', { name: labels[tab], exact: true });
      await action.focus();
      await page.getByRole('tooltip').filter({ hasText: labels[tab] }).waitFor();
      await page.keyboard.press('Enter');
      await page.locator('[role="dialog"][data-state="open"], [role="dialog"][data-floating-presence="open"]').first().waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = String(error?.stack || error); throw error;
} finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); await server.close();
}
console.log(JSON.stringify({ ...report, cases: report.cases.length }, null, 2));
