import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-permissions-ui/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
try {
  const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { createDesktopI18n } = await load('../src/shared/i18n/index.ts');
  const source = compactEnvironmentPreviewFixture().coverage;
  const gateway = { ...source.gateway_sources[0], display_name: 'Office Gateway', sync_state: 'ready',
    connection_kind: 'url', management_capability: 'access_only', gateway_url: 'https://gateway.example/',
    permissions: { access: true, manage_members: true, configure_cloud: true }, environments: [] };
  const snapshot = { ...source, gateway_sources: [gateway] };
  for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'es-ES', 'fr-FR', 'pt-BR', 'ru-RU']) {
    const i18n = createDesktopI18n(locale);
    for (const width of [1280, 430]) {
      const context = await browser.newContext({ viewport: { width, height: 1050 }, colorScheme: width === 430 ? 'dark' : 'light' });
      try {
        const page = await context.newPage();
        page.on('pageerror', error => report.errors.push(error.message));
        await page.addInitScript(({ snapshot, locale }) => {
          window.settingsFixtureSnapshot = snapshot;
          const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
          window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
        }, { snapshot, locale });
        await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
        await page.getByRole('button', { name: i18n.t('environmentCenter.gatewaysSection'), exact: true }).click();
        const more = page.locator(`[data-gateway-id="${gateway.gateway_id}"]`).getByRole('button', { name: i18n.t('environmentCenter.moreActionsForLabel', { label: gateway.display_name }), exact: true });
        const openSettings = async () => {
          await more.click();
          await page.getByRole('menuitem', { name: i18n.t('environmentCenter.gatewayActionOpenSettings'), exact: true }).click();
          await page.getByRole('dialog').waitFor();
        };
        await openSettings();
        let dialog = page.getByRole('dialog');
        const fieldset = dialog.locator('fieldset').filter({ has: page.locator('legend', { hasText: i18n.t('gatewayDesktopAccess.title') }) });
        await fieldset.waitFor();
        assert.equal(await fieldset.getByRole('button', { name: i18n.t('gatewayDesktopAccess.administrator'), exact: true }).count(), 1);
        const detail = fieldset.locator('details');
        assert.equal(await detail.getAttribute('open'), null);
        assert.equal(await page.evaluate(() => window.settingsFixture.requests.length), 0, 'Opening settings never grants access');
        await fieldset.getByRole('button', { name: i18n.t('gatewayDesktopAccess.administrator'), exact: true }).click();
        await page.getByRole('menuitem', { name: i18n.t('gatewayDesktopAccess.viewer'), exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('menuitem', { name: i18n.t('gatewayDesktopAccess.viewer'), exact: true }).waitFor({ state: 'detached' });
        await page.waitForTimeout(180);
        assert.equal(await dialog.isVisible(), true);
        const before = await detail.boundingBox();
        await detail.locator('summary').focus(); await page.keyboard.press('Enter');
        await page.waitForTimeout(280);
        assert.equal(await detail.getAttribute('open'), '');
        assert.ok((await detail.boundingBox()).height > before.height);
        assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        assert.equal(await detail.locator('summary').evaluate(element => getComputedStyle(element).cursor), 'pointer');
        assert.equal(await fieldset.getByRole('checkbox', { name: i18n.t('gatewayDesktopAccess.cloud'), exact: true }).isChecked(), true);
        const checkboxBounds = await fieldset.getByRole('checkbox').evaluateAll(elements => elements.map(element => {
          const bounds = element.getBoundingClientRect(); return { top: bounds.top, bottom: bounds.bottom };
        }));
        assert.equal(checkboxBounds.length, 3);
        await page.screenshot({ path: `${output}/${locale}-${width}-custom.png` });
        assert.ok(checkboxBounds.every((bounds, index) => index === 0 || bounds.top >= checkboxBounds[index - 1].bottom + 6), `Custom permissions use distinct, comfortably spaced rows: ${JSON.stringify(checkboxBounds)}`);
        await page.keyboard.press('Enter'); await page.waitForTimeout(280);
        assert.equal(await detail.getAttribute('open'), null);
        assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.width <= width - 16 && (width < 1000 || bounds.width >= 760));
        await page.screenshot({ path: `${output}/${locale}-${width}.png` });
        await fieldset.getByRole('button', { name: i18n.t('gatewayDesktopAccess.administrator'), exact: true }).click();
        await page.getByRole('menuitem', { name: i18n.t('gatewayDesktopAccess.custom'), exact: true }).click();
        await fieldset.getByRole('button', { name: i18n.t('gatewayDesktopAccess.custom'), exact: true }).waitFor();
        assert.equal(await detail.getAttribute('open'), '');
        assert.equal(await page.evaluate(() => window.settingsFixture.requests.length), 0, 'Choosing custom only reveals existing permissions');
        await dialog.locator('#gateway-name').fill('Renamed Gateway');
        await dialog.getByRole('button', { name: i18n.t('connectionDialog.saveGateway'), exact: true }).click();
        const saved = await page.evaluate(() => window.settingsFixture.requests.at(-1));
        assert.equal(saved.kind, 'upsert_gateway');
        assert.equal(saved.permissions, undefined, 'Rename does not expand or normalize existing grants');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        await page.evaluate(({ snapshot, gateway }) => window.settingsFixture.publish({ ...snapshot,
          gateway_sources: [{ ...gateway, permissions: { access: true, manage_members: false, configure_cloud: false } }] }), { snapshot, gateway });
        await openSettings(); dialog = page.getByRole('dialog');
        const permissions = dialog.locator('fieldset').filter({ has: page.locator('legend', { hasText: i18n.t('gatewayDesktopAccess.title') }) });
        await permissions.getByRole('button', { name: i18n.t('gatewayDesktopAccess.viewer'), exact: true }).click();
        await page.getByRole('menuitem', { name: i18n.t('gatewayDesktopAccess.administrator'), exact: true }).click();
        const count = await page.evaluate(() => window.settingsFixture.requests.length);
        await dialog.getByRole('button', { name: i18n.t('connectionDialog.saveGateway'), exact: true }).click();
        assert.equal(await page.evaluate(() => window.settingsFixture.requests.length), count, 'Elevated permissions require pairing consent');
        assert.equal(await dialog.locator('#gateway-pairing-code').getAttribute('aria-invalid'), 'true');
        await dialog.locator('#gateway-pairing-code').fill('qualification-code');
        await dialog.getByRole('button', { name: i18n.t('connectionDialog.saveGateway'), exact: true }).click();
        assert.deepEqual((await page.evaluate(() => window.settingsFixture.requests.at(-1))).permissions, gateway.permissions);
        report.cases.push({ locale, width, recipientExplicit: true, mainPresetCompact: true, keyboardDisclosure: true,
          renamePreservesPermissions: true, newGrantRequiresConsent: true, viewportBounded: true });
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
  console.log(`PASS Gateway Desktop permission UI (${report.cases.length} locale/layout cases)`);
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
