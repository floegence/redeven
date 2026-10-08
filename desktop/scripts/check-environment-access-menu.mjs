import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/environment-access-menu-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
try {
  const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
  const { mixedEnvironmentFixture } = await load('../src/testSupport/mixedEnvironmentFixture.ts');
  const { createDesktopI18n } = await load('../src/shared/i18n/index.ts');
  for (const locale of ['en-US', 'zh-CN']) {
    const i18n = createDesktopI18n(locale);
    for (const width of [1280, 430]) {
      for (const connectionState of ['connected', 'authorization_required', 'unlinked']) {
        const { snapshot } = mixedEnvironmentFixture({ linkState: connectionState === 'unlinked' ? 'unbound' : 'linked' });
        const runtime = snapshot.environments.find(entry => entry.kind === 'local_environment');
        runtime.runtime_service.capabilities.runtime_gateway = { supported: true };
        Object.assign(runtime.provider_runtime_link_target, {
          provider_connection_state: connectionState, can_connect_provider: true, can_disconnect_provider: true,
        });
        const context = await browser.newContext({ viewport: { width, height: 1050 }, reducedMotion: 'reduce' });
        try {
          const page = await context.newPage();
          page.on('pageerror', error => report.errors.push(error.message));
          await page.addInitScript(({ snapshot, locale }) => {
            window.settingsFixtureSnapshot = snapshot;
            const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
            window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
          }, { snapshot, locale });
          await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
          const owner = page.locator(`[data-owner-id="${runtime.id}"]`);
          const toggle = owner.getByRole('button', { name: i18n.t('environmentAction.runtimeActions'), exact: true });
          await toggle.waitFor();
          await page.evaluate(() => document.fonts.ready);
          await toggle.scrollIntoViewIfNeeded();
          const boundsBefore = await owner.boundingBox();
          await toggle.click();
          const menu = page.getByRole('menu');
          await menu.waitFor();
          const labels = (await menu.getByRole('menuitem').allTextContents()).map(label => label.trim());
          const gatewayIndex = labels.indexOf(i18n.t('gatewayJoin.menuAction'));
          const cloudLabel = i18n.t(connectionState === 'connected' ? 'environmentAction.disconnectFromProvider'
            : connectionState === 'unlinked' ? 'environmentAction.connectToProviderEllipsis' : 'providerRecovery.restore');
          assert.ok(gatewayIndex > 0);
          assert.equal(labels.indexOf(cloudLabel), gatewayIndex + 1);
          assert.equal(await menu.getByRole('separator').count(), 1);
          const adjacent = await menu.getByRole('menuitem').nth(gatewayIndex + 1).evaluate(element =>
            element.previousElementSibling?.getAttribute('role') === 'menuitem');
          assert.equal(adjacent, true);
          const menuBounds = await menu.boundingBox();
          assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width + 1);
          assert.deepEqual(await owner.boundingBox(), boundsBefore);
          const gateway = menu.getByRole('menuitem').nth(gatewayIndex);
          assert.equal(await gateway.evaluate(element => getComputedStyle(element).cursor), 'pointer');
          await gateway.focus();
          await page.keyboard.press('Tab');
          const enabled = await menu.getByRole('menuitem').evaluateAll(elements => elements
            .filter(element => !element.disabled).map(element => element.textContent.trim()));
          assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()),
            enabled[enabled.indexOf(i18n.t('gatewayJoin.menuAction')) + 1]);
          await page.screenshot({ path: `${output}/${locale}-${width}-${connectionState}.png` });
          await page.keyboard.press('Escape');
          await menu.waitFor({ state: 'detached' });
          assert.deepEqual(await page.evaluate(() => window.settingsFixture.requests), []);
          report.cases.push(`${locale}/${width}/${connectionState}: adjacent access actions, one divider, stable card, keyboard and pointer`);
        } finally { await context.close(); }
      }
    }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
console.log(`PASS Environment access menu (${report.cases.length} cases)`);
