import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/environment-card-tabs/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], output, cases: [], errors: [] };
try {
  const load = path => server.ssrLoadModule(fileURLToPath(new URL(path, import.meta.url)));
  const { runtimeConnectionFixture } = await load('../src/testSupport/runtimeConnectionFixture.ts');
  const { mixedEnvironmentFixture } = await load('../src/testSupport/mixedEnvironmentFixture.ts');
  const { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } = await load('../src/shared/i18n/index.ts');
  const variants = [
    { snapshot: mixedEnvironmentFixture().snapshot, tabCount: 2, runtime: 'local' },
    { snapshot: runtimeConnectionFixture().snapshot, tabCount: 3, runtime: 'local' },
    { snapshot: runtimeConnectionFixture({ kind: 'ssh_environment' }).snapshot, tabCount: 3, runtime: 'ssh' },
  ];
  for (const locale of REDEVEN_SUPPORTED_LOCALES) {
    const i18n = createDesktopI18n(locale);
    const context = await browser.newContext({ viewport: { width: 1408, height: 1050 }, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      await page.addInitScript(({ snapshot, locale }) => {
        window.settingsFixtureSnapshot = snapshot;
        const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
        window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
      }, { snapshot: variants[0].snapshot, locale });
      await page.goto(new URL('environment-settings.html', report.url).href);
      const pair = page.locator('[data-environment-group]').filter({ has: page.locator('[role="tablist"]') });
      await pair.waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const [variant, { snapshot, tabCount, runtime }] of variants.entries()) {
        await page.evaluate(value => window.settingsFixture.publish(value), snapshot);
        await pair.getByRole('tab').nth(tabCount - 1).waitFor();
        for (const [width, fontSize, scheme] of [[1408, 16, 'light'], [1920, 16, 'dark'], [653, 20, 'light']]) {
          await page.setViewportSize({ width, height: 1050 });
          await page.emulateMedia({ colorScheme: scheme });
          await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
          await page.waitForFunction(() => {
            const grid = document.querySelector('.redeven-environment-grid');
            return grid && getComputedStyle(grid).gridTemplateColumns !== 'none';
          });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const label = `${locale}/${runtime}/${tabCount} tabs/${width}px/${fontSize}px/${scheme}`;
          const tabs = pair.getByRole('tab');
          assert.equal(await tabs.count(), tabCount, label);
          assert.equal(await tabs.first().locator('span').last().textContent(), i18n.t(`environmentCenter.accessTabs.${runtime}`), label);
          const fullNames = (await pair.locator('.redeven-environment-owner-tabs').getAttribute('title')).split(' / ');
          assert.equal(fullNames.length, tabCount, label);
          assert.equal(fullNames[1], 'Redeven Cloud', label);
          if (tabCount === 3) assert.equal(fullNames[2], i18n.t('gatewayConnections.tab'), label);
          const failures = await pair.evaluate(card => {
            const rail = card.querySelector('[role="tablist"]').getBoundingClientRect();
            const title = card.querySelector('[role="tabpanel"]:not([aria-hidden="true"]) h3').getBoundingClientRect();
            const failures = [];
            if (title.top < rail.bottom) failures.push('selector overlaps environment name');
            for (const tab of card.querySelectorAll('[role="tab"]')) {
              const text = tab.lastElementChild;
              const icon = tab.querySelector('.redeven-owner-tab-icon');
              const mark = tab.querySelector('.redeven-owner-tab-status');
              const box = tab.getBoundingClientRect();
              if (text.scrollWidth > text.clientWidth + 1) failures.push(`clipped label: ${text.textContent}`);
              if (box.left < rail.left - 1 || box.right > rail.right + 1) failures.push('tab outside track');
              if (getComputedStyle(tab).userSelect !== 'none') failures.push('selectable tab');
              if (mark && mark.getBoundingClientRect().right > text.getBoundingClientRect().left) failures.push('status overlaps label');
              if (icon.getBoundingClientRect().width < 1) failures.push('missing access icon');
            }
            const last = card.querySelector('[role="tab"]:last-child').getBoundingClientRect();
            if (Math.abs(last.right - rail.right) > 1) failures.push('unused track segment');
            if (card.querySelector('[role="tablist"] > [aria-hidden="true"]')) failures.push('decorative indicator');
            return failures;
          });
          assert.deepEqual(failures, [], label);
          if (width >= 1408) {
            assert.equal(await page.locator('.redeven-environment-grid').first().evaluate(grid =>
              getComputedStyle(grid).gridTemplateColumns.split(' ').length), 5, `${label}: five columns`);
          }
          const bounds = await pair.boundingBox();
          await tabs.first().click({ clickCount: 2 });
          assert.equal(await page.evaluate(() => getSelection().toString()), '', `${label}: double click selects no text`);
          const start = await tabs.first().boundingBox();
          const end = await tabs.last().boundingBox();
          await page.evaluate(() => getSelection().removeAllRanges());
          await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
          await page.mouse.down();
          await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
          await page.mouse.up();
          assert.equal(await page.evaluate(() => getSelection().toString()), '', `${label}: drag selects no text`);
          await tabs.first().focus();
          await page.keyboard.press('End');
          assert.equal(await tabs.last().getAttribute('aria-selected'), 'true');
          await page.keyboard.press('Home');
          await page.keyboard.press('ArrowRight');
          assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
          assert.equal(await pair.getByRole('tabpanel').count(), 1);
          assert.ok(Math.abs((await pair.boundingBox()).height - bounds.height) < 1, `${label}: stable card height`);
          await page.evaluate(async snapshot => {
            const focused = document.activeElement;
            window.settingsFixture.publish(structuredClone(snapshot));
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (focused !== document.activeElement) throw new Error('Snapshot replaced tab focus');
          }, snapshot);
          await page.keyboard.press('Home');
          if (locale === 'zh-CN' && variant === 1 && width === 1408) {
            await pair.locator('[data-owner-role="runtime"]').first().waitFor({ state: 'visible' });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.screenshot({ path: `${output}/zh-CN-five-columns.png` });
          }
          report.cases.push(label);
        }
      }
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
console.log(`PASS compact environment tabs (${report.cases.length} cases)`);
