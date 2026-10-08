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
    connection_kind: 'local_host', management_capability: 'managed_local_host',
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
        await page.evaluate(() => {
          const client = { client_key_id: 'desktop-client', client_name: 'Studio Desktop', paired_at_unix_ms: Date.now(), last_verified_at_unix_ms: Date.now(), revoked_at_unix_ms: 0 };
          window.settingsFixture.actionResult = request => {
            if (request.kind === 'list_gateway_clients') return { ok: true, outcome: 'gateway_clients_listed', gateway_clients: [{ ...client }] };
            if (request.kind === 'issue_gateway_access_code') return { ok: true, outcome: 'gateway_access_code_created', gateway_access_code: { access_code: 'private-one-time-code', expires_at_unix_ms: Date.now() + 600000 } };
            if (request.kind === 'revoke_gateway_client') { client.revoked_at_unix_ms = Date.now(); return { ok: true, outcome: 'gateway_client_revoked', gateway_clients: [{ ...client }] }; }
            return { ok: true, outcome: 'saved_gateway' };
          };
        });
        await page.getByRole('button', { name: i18n.t('environmentCenter.gatewaysSection'), exact: true }).click();
        const card = page.locator('[data-gateway-id="' + gateway.gateway_id + '"]');
        const more = card.getByRole('button', { name: i18n.t('environmentCenter.moreActionsForLabel', { label: gateway.display_name }), exact: true });
        const openSettings = async () => {
          await more.click();
          assert.equal(await page.getByRole('menuitem', { name: i18n.t('gatewayMembers.invite'), exact: true }).count(), 0);
          await page.getByRole('menuitem', { name: i18n.t('environmentCenter.gatewayActionOpenSettings'), exact: true }).click();
          await page.getByRole('dialog').waitFor();
        };
        await openSettings();
        const dialog = page.getByRole('dialog');
        assert.equal(await dialog.getByRole('tab').count(), 3);
        assert.equal(await dialog.locator('fieldset').count(), 0);
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.width <= width - 16 && (width < 1000 || bounds.width >= 760));
        const fixedHeight = bounds.height;
        for (const translationKey of ['runtimes', 'clientAccess', 'connectionSettings']) {
          await dialog.getByRole('tab', { name: i18n.t(`gatewayClients.${translationKey}`), exact: true }).click();
          await page.waitForTimeout(240);
          assert.ok(Math.abs((await dialog.boundingBox()).height - fixedHeight) < 1, `${locale}/${width}: fixed dialog height across tabs`);
        }
        assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        const connection = dialog.getByRole('tab', { name: i18n.t('gatewayClients.connectionSettings'), exact: true });
        await connection.focus(); await page.keyboard.press('End');
        const clientsTab = dialog.getByRole('tab', { name: i18n.t('gatewayClients.clientAccess'), exact: true });
        assert.equal(await clientsTab.getAttribute('aria-selected'), 'true');
        assert.equal(await clientsTab.evaluate(element => element === document.activeElement), true);
        await dialog.getByText('Studio Desktop', { exact: true }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: i18n.t('connectionDialog.saveGateway'), exact: true }).count(), 0);
        await dialog.getByRole('button', { name: i18n.t('gatewayClients.createCode'), exact: true }).click();
        await dialog.getByText('private-one-time-code', { exact: true }).waitFor();
        assert.equal(await dialog.locator('.redeven-gateway-content-enter').filter({ hasText: 'private-one-time-code' }).evaluate(element => getComputedStyle(element).animationName), 'redeven-gateway-content-in');
        const detail = dialog.locator('details:visible').first();
        assert.equal(await detail.getAttribute('open'), null);
        await detail.locator('summary').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(280);
        assert.equal(await detail.getAttribute('open'), '');
        assert.equal(await detail.locator('summary').evaluate(element => getComputedStyle(element).cursor), 'pointer');
        await dialog.getByRole('tab', { name: i18n.t('gatewayClients.runtimes'), exact: true }).click();
        await clientsTab.click();
        assert.equal(await dialog.getByText('private-one-time-code', { exact: true }).isVisible(), true, 'Tab changes retain an issued code');
        const beforeRevoke = await page.evaluate(() => window.settingsFixture.requests.length);
        await dialog.getByRole('button', { name: i18n.t('gatewayClients.revoke'), exact: true }).click();
        assert.equal(await page.evaluate(() => window.settingsFixture.requests.length), beforeRevoke);
        await dialog.getByText(i18n.t('gatewayClients.revokeHelp'), { exact: true }).waitFor();
        assert.equal(await dialog.locator('div.redeven-gateway-content-enter').filter({ hasText: i18n.t('gatewayClients.revokeHelp') }).evaluate(element => getComputedStyle(element).animationName), 'redeven-gateway-content-in');
        await dialog.getByRole('button', { name: i18n.t('gatewayClients.confirmRevoke'), exact: true }).click();
        await dialog.getByText(i18n.t('gatewayClients.revoked'), { exact: true }).waitFor();
        assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-host.png' });
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        await page.waitForFunction(element => element === document.activeElement, await more.elementHandle(), { timeout: 3000 });
        await page.evaluate(({ snapshot, gateway }) => window.settingsFixture.publish({ ...snapshot, gateway_sources: [{
          ...gateway, connection_kind: 'url', management_capability: 'access_only', gateway_url: 'https://gateway.example/'
        }] }), { snapshot, gateway });
        await openSettings();
        assert.equal(await dialog.getByRole('tab').count(), 0, 'URL cannot gain management from stale local permissions');
        assert.equal(await dialog.getByRole('checkbox').count(), 1);
        await dialog.getByText(i18n.t('gatewayClients.clientOnly'), { exact: true }).waitFor();
        await dialog.locator('#gateway-name').fill('Renamed Gateway');
        await dialog.getByRole('button', { name: i18n.t('connectionDialog.saveGateway'), exact: true }).click();
        const saved = await page.evaluate(() => window.settingsFixture.requests.at(-1));
        assert.equal(saved.kind, 'upsert_gateway');
        assert.equal(saved.permissions, undefined);
        assert.equal(saved.access_code, undefined, 'A paired URL client reconnects without a new code');
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-client.png' });
        report.cases.push({ locale, width, fixedHostAuthority: true, consumerOnly: true, keyboardTabs: true, codeRetained: true, revokeConfirmation: true, focusRestored: true, viewportBounded: true });
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
  console.log('PASS Gateway host/client UI (' + report.cases.length + ' locale/layout cases)');
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(output + '/report.json', JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
