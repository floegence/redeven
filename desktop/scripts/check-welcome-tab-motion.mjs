import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/welcome-tab-motion-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], state: server.config.cacheDir, output, cases: [], errors: [] };

try {
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/mixedEnvironmentFixture.ts', import.meta.url)));
  const { snapshot } = mixedEnvironmentFixture();
  for (const [locale, width] of [['en-US', 1367], ['zh-CN', 390]]) {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const label = `${locale}:${width}:${reducedMotion}`;
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion });
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

      // Exercise the real tab controls and rendered content. Read the content
      // through its existing page structure so the pre-fix regression is visible.
      const samples = await page.evaluate(async ({ snapshot, reducedMotion }) => {
        const content = document.querySelector('#redeven-desktop-main header').nextElementSibling;
        const tabs = [...document.querySelectorAll('.redeven-console-tab')];
        const read = () => ({ opacity: Number(getComputedStyle(content).opacity),
          transform: getComputedStyle(content).transform, bounds: content.getBoundingClientRect().toJSON(),
          scroll: document.querySelector('.redeven-welcome-surface').scrollTop });
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const results = [];
        check(content.getAnimations().length === 0, 'Initial content must not replay tab motion');
        for (const index of [1, 2, 0]) {
          tabs[index].focus();
          tabs[index].click();
          check(tabs[index].getAttribute('aria-pressed') === 'true', 'Tab selection is immediate');
          check(document.activeElement === tabs[index], 'Selection retains keyboard focus');
          check(content.children.length > 0 && content.getBoundingClientRect().height > 0, 'Target content is immediately rendered');
          check(index === 1 ? !!content.querySelector('[data-cloud-source]')
            : index === 2 ? !!content.querySelector('.redeven-empty-panel')
            : !!content.querySelector('[data-environment-group]') && !content.querySelector('[data-cloud-source]'), 'Correct tab content is visible');
          const animations = content.getAnimations();
          check(animations.length === (reducedMotion === 'reduce' ? 0 : 1), `Tab ${index} needs one entry animation unless motion is reduced; got ${animations.length}`);
          if (animations.length) {
            const animation = animations[0];
            animation.pause();
            const duration = Number(animation.effect.getTiming().duration);
            check(duration > 0 && duration <= 250, 'Content entry must remain brief');
            animation.currentTime = 0;
            const start = read();
            animation.currentTime = duration / 2;
            const middle = read();
            check(start.opacity < middle.opacity && middle.opacity < 1, 'Content visibly fades in');
            check(start.transform === 'none' && middle.transform === 'none', 'Motion does not move content or overlay coordinates');
            check(JSON.stringify(start.bounds) === JSON.stringify(middle.bounds) && start.scroll === middle.scroll, 'Motion preserves geometry and scroll');
            tabs[index].click();
            check(content.getAnimations()[0] === animation && animation.currentTime === duration / 2, 'Repeated selection does not restart motion');
            window.settingsFixture.publish(structuredClone(snapshot));
            check(content.getAnimations()[0] === animation && animation.currentTime === duration / 2, 'Snapshot refresh does not restart motion');
            animation.finish();
            await frame();
            check(read().opacity === 1, 'Completed content remains fully visible');
            results.push({ index, duration, start, middle, end: read() });
          } else {
            check(read().opacity === 1, 'Reduced motion content is fully visible');
          }
        }

        // Rapid changes replace motion instead of queuing it or delaying content.
        const started = [];
        for (const index of [1, 2, 0, 2, 1, 0]) {
          tabs[index].click();
          if (started.length) check(started.at(-1).playState === 'idle', 'Previous entry motion is canceled');
          const animations = content.getAnimations();
          check(animations.length <= 1, 'Entry animations never accumulate');
          if (animations[0]) started.push(animations[0]);
          check(tabs[index].getAttribute('aria-pressed') === 'true', 'Rapid selection never waits');
        }
        started.at(-1)?.pause();
        await frame(); await frame();
        const cards = [...content.querySelectorAll('[data-environment-group]')];
        const before = cards.map(card => card.getBoundingClientRect().toJSON());
        document.querySelector('.redeven-flower-topbar-button').click();
        check(content.getAnimations().length === 0, 'Hiding the page cancels unfinished entry motion');
        document.querySelector('.redeven-flower-back-button').click();
        await frame();
        check(content.getAnimations().length === 0 && read().opacity === 1, 'Returning from Flower does not replay motion');
        check(cards.every((card, index) => card === content.querySelectorAll('[data-environment-group]')[index]), 'Flower return retains card nodes');
        check(JSON.stringify(before) === JSON.stringify(cards.map(card => card.getBoundingClientRect().toJSON())), 'Flower return retains card geometry');
        window.settingsFixture.publish(structuredClone(snapshot));
        await frame();
        check(content.getAnimations().length === 0, 'Settled snapshots do not start motion');
        check(document.documentElement.scrollWidth <= innerWidth, 'Narrow layout does not overflow');
        return results;
      }, { snapshot, reducedMotion });

      // A native keyboard activation follows the same entry path as pointer input.
      await page.locator('.redeven-console-tab').nth(1).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.redeven-console-tab').nth(1).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.redeven-console-tab').nth(1).evaluate(el => document.activeElement === el), true);
      await page.evaluate(async () => {
        const content = document.querySelector('#redeven-desktop-main header').nextElementSibling;
        await Promise.all(content.getAnimations().map(animation => animation.finished));
      });
      await page.screenshot({ path: `${output}/${locale}-${reducedMotion}.png` });
      report.cases.push({ label, samples });
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = String(error?.stack || error); throw error;
} finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); await server.close();
}
console.log(JSON.stringify({ ...report, cases: report.cases.map(entry => entry.label) }, null, 2));
