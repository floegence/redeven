/* global document, window, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { createBuiltDistServer, createBuiltDistTLS, trustBuiltDistWebTransport } from './checkPackagedRenderer.mjs';

const output = path.resolve(process.env.REDEVEN_MOBILE_NAVIGATION_REPORT ?? 'node_modules/.cache/mobile-navigation');
await mkdir(output, { recursive: true });
const tls = await createBuiltDistTLS();
const server = await createBuiltDistServer({ accessReady: true, tls, renewPeerOnConnect: true,
  handleRequest: async (_request, response, url) => {
    if (url.pathname !== '/__mobile-navigation') return false;
    const surface = url.searchParams.get('surface') === 'terminal' ? 'terminal' : 'ai';
    const locale = url.searchParams.get('locale') ?? 'zh-CN';
    const preferences = {
      'redeven-envapp:env_local-activity-navigation': JSON.stringify({ version: 1, target: { kind: 'builtin', page: surface }, recentBuiltins: [surface, 'terminal'] }),
      redeven_envapp_desktop_view_mode: 'activity',
      redeven_ui_language_preference: locale,
      'floe-theme': url.searchParams.get('theme') ?? 'light',
    };
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<script>for (const [key,value] of Object.entries(${JSON.stringify(preferences)})) localStorage.setItem(key,value); location.replace('/_redeven_proxy/env/');</script>`);
    return true;
  },
});
const fixture = { pid: process.pid, baseURL: server.baseURL, certificatePath: tls.certificatePath, output };
await writeFile(path.join(output, 'runtime.json'), JSON.stringify(fixture, null, 2));
if (process.env.REDEVEN_MOBILE_NAVIGATION_SERVE === '1') {
  console.log(JSON.stringify(fixture));
  await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
  await server.close(); await tls.cleanup();
} else {
  const results = [];
  const failures = [];
  const settle = async page => page.waitForFunction(() => [...document.getAnimations()].every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState === 'finished'));
  const geometry = async locator => locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, radius: getComputedStyle(element).borderTopLeftRadius };
  });
  const assertBounds = (rect, viewport) => {
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1, JSON.stringify(rect));
  };
  try {
    for (const name of (process.env.REDEVEN_MOBILE_NAVIGATION_BROWSERS ?? 'chromium,webkit').split(',')) {
      const browser = await ({ chromium, webkit })[name].launch({ args: name === 'chromium' ? [`--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`] : [] });
      try {
        for (const viewport of [{ width: 320, height: 700 }, { width: 393, height: 740 }, { width: 430, height: 740 }, { width: 767, height: 740 }, { width: 667, height: 390 }]) {
          const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, hasTouch: true, isMobile: true });
          const page = await context.newPage();
          const errors = []; page.on('pageerror', error => errors.push(error.message));
          page.setDefaultTimeout(15000);
          await trustBuiltDistWebTransport(page, tls);
          const prefix = `${name}-${viewport.width}x${viewport.height}`;
          try {
            await page.goto(`${server.baseURL}__mobile-navigation?theme=${viewport.width === 430 ? 'dark' : 'light'}`);
            const editor = page.locator('.flower-composer textarea');
            await editor.waitFor();
            await page.locator('.flower-empty-suggestion').first().waitFor();
            await settle(page);
            const cards = page.locator('.flower-empty-suggestion');
            const first = await geometry(cards.nth(0)); const second = await geometry(cards.nth(1));
            assert.ok(Math.abs(first.y - second.y) < 1 && second.x > first.right);
            await page.screenshot({ path: path.join(output, `${prefix}-suggestions.png`) });
            await editor.fill('Retained draft 中文');
            await editor.evaluate(element => { window.__drawerEditor = element; element.setSelectionRange(2, 7); });
            const tab = page.getByRole('tab', { name: 'Flower', exact: true });
            await tab.click();
            const drawer = page.locator('.flower-mobile-thread-drawer');
            await drawer.waitFor(); await settle(page);
            const flower = await geometry(drawer); assertBounds(flower, viewport);
            assert.equal(await tab.getAttribute('aria-expanded'), 'true');
            assert.equal(await page.locator('.flower-component-main').evaluate(element => element.inert), true);
            assert.ok(!['INPUT', 'TEXTAREA'].includes(await page.evaluate(() => document.activeElement?.tagName)));
            await page.screenshot({ path: path.join(output, `${prefix}-flower.png`) });
            await tab.click(); await drawer.waitFor({ state: 'detached' });
            assert.equal(await editor.evaluate(element => element === window.__drawerEditor), true);
            assert.equal(await editor.inputValue(), 'Retained draft 中文');
            await tab.click(); await drawer.waitFor(); await drawer.press('Escape'); await drawer.waitFor({ state: 'detached' });
            const plugins = page.locator('[aria-controls="redeven-plugin-switcher"]:visible');
            await plugins.click();
            const pluginDrawer = page.locator('.plugin-mobile-launcher-drawer');
            await pluginDrawer.waitFor(); await settle(page);
            const plugin = await geometry(pluginDrawer); assertBounds(plugin, viewport);
            assert.ok(plugin.y >= 24 && parseFloat(plugin.radius) >= 20);
            assert.ok(!['INPUT', 'TEXTAREA'].includes(await page.evaluate(() => document.activeElement?.tagName)));
            await page.screenshot({ path: path.join(output, `${prefix}-plugins.png`) });
            await pluginDrawer.press('Escape'); await pluginDrawer.waitFor({ state: 'detached' });
            await page.getByRole('tab', { name: '终端', exact: true }).click();
            await page.locator('[data-testid="terminal-session-drawer-open"]').click();
            const terminal = page.locator('[data-terminal-mobile-drawer][role="dialog"]');
            await terminal.waitFor(); await settle(page);
            const terminalBounds = await geometry(terminal); assertBounds(terminalBounds, viewport);
            assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'terminal-session-drawer-close');
            assert.equal(await page.locator('[data-testid="terminal-session-filter"]').evaluate(element => parseFloat(getComputedStyle(element).fontSize)), 16);
            await page.screenshot({ path: path.join(output, `${prefix}-terminal.png`) });
            await terminal.press('Escape');
            assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'terminal-session-drawer-open');
            assert.deepEqual(errors, []);
            results.push({ browser: name, viewport, flower, plugin, terminal: terminalBounds, errors });
          } catch (error) {
            failures.push({ browser: name, viewport, error: error.message, errors });
            await page.screenshot({ path: path.join(output, `${prefix}-failure.png`) }).catch(() => {});
            console.error(JSON.stringify(failures.at(-1)));
          } finally { await context.close(); }
        }
      } finally { await browser.close(); }
    }
  } finally {
    await server.close(); await tls.cleanup();
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, failures }, null, 2));
  }
  console.log(JSON.stringify({ passed: results.length, failures, output }));
  assert.equal(failures.length, 0, 'mobile navigation acceptance failed');
}
