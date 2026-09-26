/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { createBuiltDistServer, createBuiltDistTLS, trustBuiltDistWebTransport } from './checkPackagedRenderer.mjs';

const output = path.resolve(process.env.REDEVEN_DESKTOP_RESPONSIVE_REPORT ?? 'node_modules/.cache/desktop-responsive');
await mkdir(output, { recursive: true });
const tls = await createBuiltDistTLS();
const server = await createBuiltDistServer({ accessReady: true, gitReady: true, fileContinuity: true, tls, renewPeerOnConnect: true });
await writeFile(path.join(output, 'runtime.json'), JSON.stringify({
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, port: Number(new URL(server.baseURL).port), statePath: tls.directory,
}, null, 2));
const results = [];
const settle = page => page.waitForFunction(() => [...document.getAnimations()].every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState === 'finished'));
const waitMode = (page, mode) => page.waitForFunction(mode => document.querySelector('[data-env-shell-background]')?.getAttribute('data-redeven-interaction-mode') === mode, mode);
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'page has no horizontal overflow');
try {
  for (const engine of (process.env.REDEVEN_RESPONSIVE_BROWSERS ?? 'chromium,webkit').split(',')) {
    const browser = await ({ chromium, webkit })[engine].launch({ args: engine === 'chromium' ? [`--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`] : [] });
    try {
      for (const input of (process.env.REDEVEN_RESPONSIVE_INPUTS ?? 'mouse,hybrid,native').split(',')) {
        const native = input === 'native';
        const context = await browser.newContext({ viewport: { width: 1024, height: 720 }, ignoreHTTPSErrors: true, hasTouch: native });
        await context.addInitScript(({ native, input }) => {
          localStorage.setItem('redeven-envapp:env_local-activity-navigation', JSON.stringify({ version: 1, target: { kind: 'builtin', page: 'ai' }, recentBuiltins: ['ai', 'terminal'] }));
          localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
          localStorage.setItem('redeven_ui_language_preference', 'en-US');
          if (native) window.redevenDesktopShell = { openConnectionCenter: async () => {} };
          // A secondary touchscreen does not change a mouse's primary media capabilities.
          if (input === 'hybrid') Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
        }, { native, input });
        const page = await context.newPage();
        const errors = []; page.on('pageerror', error => errors.push({ message: error.message, stack: error.stack }));
        page.setDefaultTimeout(15000);
        try {
          await trustBuiltDistWebTransport(page, tls);
          await page.goto(`${server.baseURL}_redeven_proxy/env/`);
          await page.locator('.flower-empty-hero').waitFor();
          const editor = page.locator('.flower-composer textarea');
          for (const width of [1024, 800, 767, 640, 1280]) {
            await page.setViewportSize({ width, height: 720 });
            await waitMode(page, 'desktop');
            await page.getByRole('tab', { name: 'Workbench', exact: true }).filter({ visible: true }).waitFor();
            assert.equal(await page.locator('[data-floe-shell-slot="mobile-tab-bar"]').count(), 0);
            await noOverflow(page);
            await page.screenshot({ path: path.join(output, `${engine}-${input}-${width}.png`) });
          }
          await page.getByRole('tab', { name: 'Workbench', exact: true }).filter({ visible: true }).click();
          await page.locator('.workbench-surface').waitFor();
          await page.setViewportSize({ width: 640, height: 720 });
          await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.includes('Workbench'));
          await page.getByRole('tab', { name: 'Activity', exact: true }).filter({ visible: true }).click();
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.locator('.flower-empty-hero').waitFor();
          const surface = page.locator('.flower-component-shell[data-flower-presentation="full"]');
          for (const width of [800, 768, 767, 600, 480]) {
            await surface.evaluate((element, width) => {
              const rail = parseFloat(getComputedStyle(element).getPropertyValue('--flower-thread-rail-width'));
              element.style.width = `${width + rail}px`;
            }, width);
            await settle(page);
            await page.waitForFunction(width => Math.abs(document.querySelector('.flower-chat-shell').getBoundingClientRect().width - width) < 1, width);
            assert.equal(await page.locator('.flower-empty-hero').isVisible(), true);
            assert.equal(await page.locator('.flower-empty-hint').isVisible(), true);
            assert.equal(await page.locator('.flower-empty-suggestion:visible').count(), 4);
            for (const card of await page.locator('.flower-empty-suggestion').all()) {
              await card.click();
              assert.ok((await editor.inputValue()).length > 0);
            }
            await editor.fill('');
            await page.locator('.flower-chat-transcript').evaluate(element => { element.scrollTop = 0; });
            await surface.screenshot({ path: path.join(output, `${engine}-${input}-welcome-${width}.png`) });
          }
          await surface.evaluate(element => { element.style.width = ''; });
          await editor.fill('Retained desktop draft 中文');
          await editor.evaluate(element => { window.__adaptiveEditor = element; element.setSelectionRange(2, 7); });
          await page.setViewportSize({ width: 640, height: 720 });
          await page.waitForFunction(() => document.querySelector('[data-flower-sidebar-presentation]')?.getAttribute('data-flower-sidebar-presentation') === 'overlay');
          const trigger = page.locator('.flower-chat-header .flower-mobile-navigation-button');
          await trigger.click();
          const drawer = page.locator('.flower-desktop-thread-drawer');
          await drawer.waitFor(); await settle(page);
          const bounds = await drawer.boundingBox(); const host = await surface.boundingBox();
          assert.ok(Math.abs(bounds.x - host.x) < 2 && bounds.width <= host.width - 48 + 1);
          assert.equal(await page.locator('.flower-thread-search-input').evaluate(element => element === document.activeElement), false);
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Tab');
          assert.equal(await drawer.evaluate(element => element.contains(document.activeElement)), true, 'Tab stays inside navigation');
          await drawer.press('Escape'); await drawer.waitFor({ state: 'detached' });
          await page.waitForFunction(() => document.activeElement?.matches('.flower-chat-header .flower-mobile-navigation-button'));
          await trigger.click(); await drawer.waitFor(); await settle(page);
          await surface.locator('[data-floe-dialog-backdrop]').click({ position: { x: host.width - 20, y: 50 } });
          await drawer.waitFor({ state: 'detached' });
          await page.waitForFunction(() => document.activeElement?.matches('.flower-chat-header .flower-mobile-navigation-button'));
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.waitForFunction(() => document.querySelector('[data-flower-sidebar-presentation]')?.getAttribute('data-flower-sidebar-presentation') === 'inline');
          assert.equal(await editor.evaluate(element => element === window.__adaptiveEditor), true);
          assert.equal(await editor.inputValue(), 'Retained desktop draft 中文');
          assert.deepEqual(await editor.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 7]);
          assert.deepEqual(errors, []);
          results.push({ engine, input, status: 'passed' });
        } catch (error) {
          console.error({ engine, input, activeElement: await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id, class: document.activeElement?.className })) });
          await page.screenshot({ path: path.join(output, `${engine}-${input}-failure.png`) });
          throw error;
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`Desktop responsive acceptance passed: ${results.map(result => `${result.engine}/${result.input}`).join(', ')}. Verified display mode, full welcome content, left navigation and retained draft.`);
} finally { await server.close(); await tls.cleanup(); }
