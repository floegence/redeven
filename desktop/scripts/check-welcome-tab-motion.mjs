import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/welcome-tab-motion-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sources: Object.fromEntries(await Promise.all(['../src/welcome/App.tsx', '../src/welcome/EnvironmentCards.tsx'].map(async path => [path, createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex')]))),
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

      // Sample actual destination cards: a pane fade alone cannot pass.
      const samples = await page.evaluate(async ({ snapshot, reducedMotion }) => {
        const content = document.querySelector('.redeven-center-content');
        const tabs = [...document.querySelectorAll('.redeven-console-tab')];
        const selector = '.redeven-environment-card, .redeven-cloud-source-header, .redeven-empty-panel, .redeven-console-empty';
        const targets = () => [...content.querySelectorAll(selector)].filter(el => !el.closest('[hidden]'));
        const animations = () => content.getAnimations({ subtree: true }).filter(animation => targets().includes(animation.effect?.target));
        const read = el => {
          const style = getComputedStyle(el);
          return { opacity: Number(style.opacity), y: new DOMMatrixReadOnly(style.transform).m42,
            transform: style.transform, width: el.offsetWidth, height: el.offsetHeight,
            top: el.offsetTop, left: el.offsetLeft };
        };
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const results = [];
        check(animations().length === 0, 'Initial cards must not replay tab motion');
        for (const index of [1, 2, 0]) {
          tabs[index].focus();
          tabs[index].click();
          check(tabs[index].getAttribute('aria-pressed') === 'true', 'Tab selection is immediate');
          check(document.activeElement === tabs[index], 'Selection retains keyboard focus');
          check(index === 1 ? !!content.querySelector('[data-cloud-source]')
            : index === 2 ? !!content.querySelector('.redeven-empty-panel')
            : !!content.querySelector('[data-environment-group]') && !content.querySelector('[data-cloud-source]'), 'Correct tab content is immediately rendered');
          await Promise.resolve();
          const nodes = targets();
          const entries = animations();
          check(nodes.length > 0, 'Destination contains presentation targets');
          check(entries.length === (reducedMotion === 'reduce' ? 0 : nodes.length), `Tab ${index} must animate each destination card or empty surface; got ${entries.length} for ${nodes.length} targets`);
          check(content.getAnimations().length === 0, 'The whole pane must not compound card motion');
          if (entries.length) {
            entries.forEach(animation => { animation.pause(); animation.currentTime = 0; });
            const start = nodes.map(read);
            const timings = nodes.map(node => entries.find(animation => animation.effect.target === node).effect.getTiming());
            check(start.every(sample => sample.opacity === 0 && sample.y >= 6), 'Each card starts transparent and below its final position');
            check(timings.every(timing => timing.duration >= 300 && timing.duration <= 400 && timing.delay <= 150), 'Entrance is perceptible and the stagger remains bounded');
            if (nodes.length > 1) {
              check(timings[0].delay === 0 && timings[1].delay > 0, 'Cards enter in staggered visual order');
              check(timings.every((timing, i) => i === 0 || timing.delay >= timings[i - 1].delay), 'Stagger follows reading order across sections');
            }
            const scroll = document.querySelector('.redeven-welcome-surface').scrollTop;
            entries.forEach(animation => { animation.currentTime = 100; });
            const middle = nodes.map(read);
            check(middle[0].opacity > 0 && middle[0].opacity < 1 && middle[0].y > 0 && middle[0].y < start[0].y, 'The leading card visibly fades and rises');
            if (nodes.length > 1) check(middle[0].opacity > middle[1].opacity && middle[0].y < middle[1].y, 'Later cards trail the leading card');
            check(middle.every((sample, i) => ['width', 'height', 'top', 'left'].every(key => sample[key] === start[i][key])), 'Motion preserves layout geometry');
            check(document.querySelector('.redeven-welcome-surface').scrollTop === scroll, 'Motion preserves scroll position');
            tabs[index].click();
            await Promise.resolve();
            window.settingsFixture.publish(structuredClone(snapshot));
            await Promise.resolve();
            check(entries.every(animation => animations().includes(animation) && animation.currentTime === 100), 'Repeated selection and equivalent snapshots preserve in-flight animations');
            check(nodes.every((node, i) => node === targets()[i]), 'Refresh preserves destination DOM identity');
            entries.forEach(animation => animation.finish());
            await frame(); await frame();
            const end = nodes.map(read);
            check(end.every(sample => sample.opacity === 1 && sample.transform === 'none'), 'Completed cards have no residual transform or opacity');
            check(animations().length === 0, 'Completed effects are released');
            results.push({ index, timings, start, middle, end });
          } else {
            check(nodes.every(node => read(node).opacity === 1 && read(node).transform === 'none'), 'Reduced motion content is immediately settled');
          }
        }

        let previous = [];
        for (const index of [1, 2, 0, 2, 1, 0]) {
          tabs[index].click();
          check(previous.every(animation => animation.playState === 'idle'), 'Rapid selection cancels all previous effects');
          check(tabs[index].getAttribute('aria-pressed') === 'true', 'Rapid selection never waits');
          await Promise.resolve();
          previous = animations();
          check(previous.length <= targets().length, 'Effects never accumulate');
        }
        for (const index of [1, 2, 0]) tabs[index].click();
        await Promise.resolve();
        check(animations().length === (reducedMotion === 'reduce' ? 0 : targets().length), 'Same-task switches animate only the final destination');
        check(previous.every(animation => animation.playState === 'idle'), 'Superseded effects stay canceled');
        document.querySelector('.redeven-flower-topbar-button').click();
        check(animations().length === 0, 'Hiding the page cancels unfinished entry motion');
        document.querySelector('.redeven-flower-back-button').click();
        await frame(); await frame();
        check(animations().length === 0, 'Returning from Flower does not replay motion');
        const cards = [...content.querySelectorAll('[data-environment-group]')];
        const before = cards.map(card => card.getBoundingClientRect().toJSON());
        document.querySelector('.redeven-flower-topbar-button').click();
        document.querySelector('.redeven-flower-back-button').click();
        await frame(); await frame();
        check(cards.every((card, index) => card === content.querySelectorAll('[data-environment-group]')[index]), 'Flower return retains card nodes');
        check(JSON.stringify(before) === JSON.stringify(cards.map(card => card.getBoundingClientRect().toJSON())), 'Flower return retains settled card geometry');
        // Hide before scheduled entrance work runs, then return.
        tabs[1].click();
        document.querySelector('.redeven-flower-topbar-button').click();
        await Promise.resolve();
        document.querySelector('.redeven-flower-back-button').click();
        check(animations().length === 0, 'Hidden pages cannot start pending entrance motion');
        window.settingsFixture.publish(structuredClone(snapshot));
        await frame();
        check(animations().length === 0, 'Settled snapshots do not start motion');
        check(document.documentElement.scrollWidth <= innerWidth, 'Narrow layout does not overflow');
        return results;
      }, { snapshot, reducedMotion });

      // Native keyboard activation follows the same path as pointer input.
      await page.locator('.redeven-console-tab').nth(0).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.redeven-console-tab').nth(0).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.redeven-console-tab').nth(0).evaluate(el => document.activeElement === el), true);
      await page.evaluate(async () => {
        const content = document.querySelector('.redeven-center-content');
        await Promise.all(content.getAnimations({ subtree: true }).map(animation => animation.finished));
      });
      // Populated gateways and Cloud connection cards use the same explicit entry.
      const additional = await page.evaluate(async ({ snapshot, reducedMotion }) => {
        const content = document.querySelector('.redeven-center-content');
        const tabs = [...document.querySelectorAll('.redeven-console-tab')];
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        const gateways = [0, 1].map(index => ({ gateway_id: `motion-gateway-${index}`, display_name: `Gateway ${index + 1}`,
          local_enabled: true, connection_kind: 'url', management_capability: 'access_only', capabilities: [],
          status: 'pairing_required', trust_state: 'unpaired', gateway_url: `https://gateway-${index}.example.invalid`,
          created_at_ms: 1, updated_at_ms: 1, environments: [] }));
        window.settingsFixture.publish({ ...structuredClone(snapshot), gateway_sources: gateways, control_planes: [] });
        const counts = [];
        for (const [index, selector, count] of [[2, '.redeven-gateway-card', 2], [1, '.redeven-quick-add-card', 1]]) {
          tabs[index].click();
          await Promise.resolve();
          const nodes = [...content.querySelectorAll(selector)];
          check(nodes.length === count, 'Additional destination is populated');
          const entries = nodes.flatMap(node => node.getAnimations());
          check(entries.length === (reducedMotion === 'reduce' ? 0 : count), 'Populated gateways and Cloud connection cards enter individually');
          counts.push({ index, cards: nodes.length, animations: entries.length });
        }
        tabs[0].click();
        await Promise.resolve();
        await Promise.all(content.getAnimations({ subtree: true }).map(animation => animation.finished));
        return counts;
      }, { snapshot, reducedMotion });
      // Search-result replacement never starts independent mount animations.
      await page.locator('.redeven-center-search input').fill('no matching environment motion fixture');
      await page.locator('.redeven-console-empty').waitFor();
      assert.equal(await page.locator('.redeven-center-content').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
      await page.locator('.redeven-console-tab').nth(1).click();
      await page.locator('.redeven-console-tab').nth(0).click();
      const emptyAnimations = await page.locator('.redeven-console-empty').evaluate(el => el.getAnimations().length);
      assert.equal(emptyAnimations, reducedMotion === 'reduce' ? 0 : 1);
      await page.locator('.redeven-center-search input').fill('');
      await page.screenshot({ path: `${output}/${locale}-${reducedMotion}.png` });
      report.cases.push({ label, samples, additional });
      await context.close();
    }
  }
  // Record and sample uninterrupted browser playback, without seeking animations.
  const videoContext = await browser.newContext({ viewport: { width: 1367, height: 1000 },
    reducedMotion: 'no-preference', recordVideo: { dir: output, size: { width: 1367, height: 1000 } } });
  const videoPage = await videoContext.newPage();
  videoPage.on('pageerror', error => report.errors.push(error.message));
  await videoPage.addInitScript(snapshot => { window.settingsFixtureSnapshot = snapshot; }, snapshot);
  await videoPage.goto(new URL('environment-settings.html', report.url).href);
  await videoPage.locator('[data-environment-group]').first().waitFor();
  await videoPage.evaluate(() => document.fonts.ready);
  report.playback = await videoPage.evaluate(async () => {
    const tabs = [...document.querySelectorAll('.redeven-console-tab')];
    const frames = [];
    for (const tab of [1, 0, 2, 0]) {
      tabs[tab].click();
      const start = performance.now();
      do {
        await new Promise(resolve => requestAnimationFrame(resolve));
        frames.push({ tab, time: performance.now() - start,
          cards: [...document.querySelectorAll('.redeven-center-content .redeven-environment-card')].map(card => {
            const style = getComputedStyle(card);
            return { opacity: Number(style.opacity), y: new DOMMatrixReadOnly(style.transform).m42 };
          }) });
      } while (performance.now() - start < 1200);
    }
    return frames;
  });
  const moving = report.playback.filter(frame => frame.tab === 0 && frame.cards.some(card => card.opacity > 0 && card.opacity < 1 && card.y > 0));
  assert.ok(moving.length >= 3, 'Natural playback contains multiple painted fade-and-rise frames');
  assert.ok(moving.some(frame => frame.cards[0].opacity > frame.cards[1].opacity), 'Natural playback shows staggered cards');
  assert.ok(report.playback.filter(frame => frame.time > 600).every(frame => frame.cards.every(card => card.opacity === 1 && card.y === 0)), 'Natural playback settles without residual translation');
  await videoContext.close();
  await videoPage.video().saveAs(`${output}/welcome-card-entrance.webm`);
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = String(error?.stack || error); throw error;
} finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); await server.close();
}
console.log(JSON.stringify({ ...report, cases: report.cases.map(entry => entry.label), playback: `${report.playback?.length ?? 0} natural frames` }, null, 2));
