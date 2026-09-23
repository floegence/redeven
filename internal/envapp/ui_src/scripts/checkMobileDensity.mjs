/* global document, getComputedStyle, innerWidth */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { createBuiltDistServer, createBuiltDistTLS, trustBuiltDistWebTransport } from './checkPackagedRenderer.mjs';
import { createContinuityServer, navigationKey, navigationRecord } from './fixtures/startupContinuity.mjs';

const output = path.resolve(process.env.REDEVEN_MOBILE_DENSITY_REPORT ?? 'node_modules/.cache/mobile-density');
await mkdir(output, { recursive: true });
const tls = await createBuiltDistTLS();
const server = await createContinuityServer(tls, { fileContinuity: true });
const locked = await createBuiltDistServer();
const results = [];
const surfaces = {
  ports: { ready: '[data-testid="unified-web-services-list"] .web-service-row', header: '.web-services-header', limit: 56, search: '.web-services-search input' },
  applications: { ready: 'button.host-app-tile', header: '.host-apps-header', limit: 56, search: '.host-apps-search input' },
  containers: { ready: 'button.container-mobile-card', header: '.container-resource-toolbar', limit: 48, search: '.container-search-control input' },
  'plugin-center': { ready: '[data-plugin-center-item]', header: '[data-plugin-center-toolbar]', limit: 156, search: '[data-plugin-center-search]' },
  files: { ready: '[data-file-browser-item-id="/workspace/continuity-file.txt"]', search: '[data-toolbar-layout] label input' },
  codespaces: { ready: '.codespace-card:not([data-codespace-skeleton])', header: '.codespaces-header', limit: 56 },
  settings: { ready: '.redeven-settings-mobile-nav', header: '.redeven-settings-header', limit: 56 },
};
const failures = [];
try {
  for (const name of (process.env.REDEVEN_MOBILE_BROWSERS ?? 'chromium,webkit').split(',')) {
    const browser = await ({ chromium, webkit })[name].launch({ args: name === 'chromium' ? [`--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`] : [] });
    try {
      for (const width of [320, 360, 393, 430, 767, 768]) {
        for (const [id, surface] of Object.entries(surfaces)) {
          const context = await browser.newContext({ viewport: { width, height: 700 }, ignoreHTTPSErrors: true });
          const page = await context.newPage();
          const errors = []; page.on('pageerror', error => errors.push(error.message));
          page.setDefaultTimeout(20000);
          await trustBuiltDistWebTransport(page, tls);
          await page.addInitScript(({ key, record, dark }) => {
            localStorage.setItem(key, JSON.stringify(record));
            localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
            localStorage.setItem('redeven_ui_language_preference', 'zh-CN');
            if (dark) localStorage.setItem('floe-theme', 'dark');
          }, { key: navigationKey, record: navigationRecord(id), dark: width === 430 });
          try {
            await page.goto(new URL('_redeven_proxy/env/', server.baseURL).href);
            await page.locator(id === 'containers' ? 'button.container-mobile-card:visible, [data-container-resource-row]:visible' : surface.ready).first().waitFor({ state: id === 'settings' ? 'attached' : 'visible' });
            if (surface.header) await page.locator(surface.header).waitFor();
            await page.evaluate(() => document.fonts.ready);
            await page.waitForFunction(() => [...document.getAnimations()].every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState === 'finished'));
            const geometry = await page.evaluate(({ id, surface }) => {
              const rect = selector => { const element = document.querySelector(selector); if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right, fontSize: getComputedStyle(element.querySelector('input') ?? element).fontSize }; };
              return { header: surface.header ? rect(surface.header) : null, search: surface.search ? rect(id === 'files' ? '[data-toolbar-layout] label' : surface.search) : null, overflow: document.documentElement.scrollWidth > innerWidth,
                firstRecord: id === 'ports' ? rect(surface.ready).y - rect('.web-services').y : undefined,
                fileToolbar: id === 'files' ? rect('[data-toolbar-layout]') : undefined,
                extraSettingsNavigation: id === 'settings' && Boolean(document.querySelector('.floe-settings-layout__mobile')),
              };
            }, { id, surface });
            assert.equal(geometry.overflow, false, `${id} horizontal overflow`);
            if (width < 768) {
              if (surface.limit) assert.ok(geometry.header.height <= surface.limit, `${id} header ${geometry.header.height} > ${surface.limit}`);
              if (surface.search) { assert.ok(geometry.search.width >= 128, `${id} search width ${geometry.search.width}`); assert.ok(parseFloat(geometry.search.fontSize) >= 16, `${id} input font ${geometry.search.fontSize}`); }
              if (id === 'ports') assert.ok(geometry.firstRecord <= 180, `first service starts at ${geometry.firstRecord}`);
              if (id === 'files') assert.ok(geometry.fileToolbar.height <= 96, `file toolbar has extra rows: ${geometry.fileToolbar.height}`);
              assert.equal(geometry.extraSettingsNavigation, false);
            }
            assert.deepEqual(errors, []);
            if (width === 393 || width === 320) await page.screenshot({ path: path.join(output, `${name}-${id}-${width}.png`) });
            results.push({ browser: name, page: id, width, ...geometry });
          } catch (error) {
            failures.push({ browser: name, page: id, width, error: error.message, pageErrors: errors });
            console.error(JSON.stringify(failures.at(-1)));
            await page.screenshot({ path: path.join(output, `${name}-${id}-${width}-failure.png`) }).catch(() => {});
          } finally { await context.close(); }
        }
        const page = await browser.newPage({ viewport: { width, height: width === 320 ? 430 : 700 } });
        try {
          await page.goto(new URL('_redeven_proxy/env/', locked.baseURL).href);
          const trigger = page.locator('[data-envapp-language-trigger="access_gate"]');
          await trigger.click();
          const menu = page.locator('[data-envapp-language-menu="access_gate"]');
          await menu.waitFor();
          await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-envapp-language-menu]')).opacity === '1');
          const rect = await menu.boundingBox();
          const viewport = page.viewportSize();
          assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height, `language menu exceeds viewport: ${JSON.stringify(rect)}`);
          await menu.press('End');
          assert.equal(await page.locator(':focus').getAttribute('data-envapp-language-option'), 'ru-RU');
          await menu.press('Escape');
          assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
          await trigger.click(); await menu.waitFor();
          await page.screenshot({ path: path.join(output, `${name}-language-${width}.png`) });
          results.push({ browser: name, page: 'language', width, rect });
        } catch (error) { failures.push({ browser: name, page: 'language', width, error: error.message }); }
        finally { await page.close(); }
      }
    } finally { await browser.close(); }
  }
} finally {
  await server.close(); await locked.close(); await tls.cleanup();
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, failures }, null, 2));
}
console.log(JSON.stringify({ passed: results.length, failures, output }));
assert.equal(failures.length, 0, 'mobile density acceptance failed');
