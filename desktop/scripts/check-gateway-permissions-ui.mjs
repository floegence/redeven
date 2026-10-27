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
const report = { cases: [], errors: [], scroll: [] };
async function measureScrollExtent(dialog, context) {
  const metrics = await dialog.locator('.redeven-gateway-settings-panels').evaluate(async scroller => {
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const active = scroller.querySelector(':scope > [role="tabpanel"]:not([aria-hidden="true"])');
    const contentEnd = active.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop;
    const expectedHeight = Math.max(scroller.clientHeight, Math.ceil(contentEnd));
    return { tab: active.id, viewportHeight: scroller.clientHeight, contentHeight: contentEnd, scrollHeight: scroller.scrollHeight, excess: scroller.scrollHeight - expectedHeight };
  });
  report.scroll.push({ ...context, ...metrics });
  return metrics;
}
function assertScrollExtent(metrics, context) {
  assert.ok(Math.abs(metrics.excess) <= 2, `${context}: only active content defines scroll extent: ${JSON.stringify(metrics)}`);
}
async function checkScrollExtent(dialog, context) {
  const metrics = await measureScrollExtent(dialog, context);
  assertScrollExtent(metrics, JSON.stringify(context));
}
try {
  const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { catalogFixture } = await load('../src/testSupport/gatewayMembershipFixture.ts');
  const { createDesktopI18n } = await load('../src/shared/i18n/index.ts');
  const source = compactEnvironmentPreviewFixture().coverage;
  const gateway = { ...source.gateway_sources[0], display_name: 'Office Gateway', sync_state: 'ready',
    connection_kind: 'local_host', management_capability: 'managed_local_host',
    policy: catalogFixture.policy,
    permissions: { access: true, manage_members: true, configure_cloud: true }, environments: [] };
  const snapshot = { ...source, gateway_sources: [gateway] };
  for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'es-ES', 'fr-FR', 'pt-BR', 'ru-RU']) {
    const i18n = createDesktopI18n(locale);
    for (const { width, height } of [{ width: 1280, height: 1050 }, { width: 430, height: 740 }, { width: 1280, height: 600 }]) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: width === 430 ? 'dark' : 'light' });
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
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        assert.equal(await card.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, 'Gateway card actions remain within the viewport');
        assert.equal(await card.locator('.redeven-gateway-card__empty').count(), 0, 'A ready empty Gateway needs no instructional banner');
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-' + height + '-card.png' });
        for (const [key, tab] of [['connectClient', 'clients'], ['connectRuntime', 'runtimes']]) {
          const action = card.getByRole('button', { name: i18n.t('gatewayExperience.' + key), exact: true });
          await action.click();
          const taskDialog = page.getByRole('dialog');
          await taskDialog.getByRole('heading', { name: i18n.t('gatewayExperience.' + key), exact: true }).waitFor();
          assert.equal(await taskDialog.locator('#gateway-settings-tab-' + tab).getAttribute('aria-selected'), 'true');
          assert.equal(await page.evaluate(() => window.settingsFixture.requests.some(request => ['issue_gateway_access_code', 'invite_gateway_runtime', 'inspect_gateway_cloud'].includes(request.kind))), false, 'Opening an enrollment action grants nothing and does not initialize Cloud');
          await page.keyboard.press('Escape'); await taskDialog.waitFor({ state: 'detached' });
          await page.waitForFunction(element => element === document.activeElement, await action.elementHandle());
          await page.waitForTimeout(300);
        }
        const openSettings = async () => {
          await more.click();
          assert.equal(await page.getByRole('menuitem', { name: i18n.t('gatewayMembers.invite'), exact: true }).count(), 0);
          await page.getByRole('menuitem', { name: i18n.t('environmentCenter.gatewayActionOpenSettings'), exact: true }).click();
          await page.getByRole('dialog').waitFor();
          await page.waitForTimeout(300);
        };
        await openSettings();
        const dialog = page.getByRole('dialog');
        assert.equal(await dialog.getByRole('tab').count(), 5);
        assert.equal(await dialog.locator('fieldset').count(), 0);
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.width <= width - 16 && (width < 1000 || bounds.width >= 760));
        const fixedHeight = bounds.height;
        // Keep a long Settings draft mounted while measuring shorter tabs.
        await dialog.getByRole('tab', { name: i18n.t('common.settings'), exact: true }).click();
        await dialog.locator('#gateway-name').fill('Unsaved Gateway name');
        for (let index = 0; index < 4; index++) await dialog.getByRole('button', { name: i18n.t('gatewayMembers.addAddress'), exact: true }).click();
        const scrollMetrics = [];
        for (const translationKey of ['gatewayExperience.overview', 'gatewayExperience.clients', 'gatewayClients.runtimes', 'gatewayExperience.cloud', 'common.settings']) {
          await dialog.getByRole('tab', { name: i18n.t(translationKey), exact: true }).click();
          await page.waitForTimeout(240);
          assert.ok(Math.abs((await dialog.boundingBox()).height - fixedHeight) < 1, `${locale}/${width}: fixed dialog height across tabs`);
          scrollMetrics.push(await measureScrollExtent(dialog, { locale, width, height, stage: 'initial' }));
          await page.screenshot({ path: output + '/' + locale + '-' + width + '-' + height + '-' + translationKey.split('.').at(-1) + '-scroll.png' });
        }
        for (const metrics of scrollMetrics) assertScrollExtent(metrics, `${locale}/${width}`);
        assert.equal(await dialog.locator('#gateway-name').inputValue(), 'Unsaved Gateway name', 'Tab changes retain unsaved fields');
        assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        const connection = dialog.getByRole('tab', { name: i18n.t('common.settings'), exact: true });
        await connection.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
        const clientsTab = dialog.getByRole('tab', { name: i18n.t('gatewayExperience.clients'), exact: true });
        assert.equal(await clientsTab.getAttribute('aria-selected'), 'true');
        assert.equal(await clientsTab.evaluate(element => element === document.activeElement), true);
        await dialog.getByText('Studio Desktop', { exact: true }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: i18n.t('connectionDialog.saveGateway'), exact: true }).count(), 0);
        await dialog.getByRole('button', { name: i18n.t('gatewayExperience.connectClient'), exact: true }).click();
        await dialog.getByRole('textbox', { name: i18n.t('gatewayJoin.address'), exact: true }).fill('https://gateway.example:7443');
        await dialog.getByRole('button', { name: i18n.t('gatewayClients.createCode'), exact: true }).click();
        await dialog.getByText('private-one-time-code', { exact: true }).waitFor();
        assert.equal(await dialog.locator('.redeven-gateway-content-enter').filter({ hasText: 'private-one-time-code' }).evaluate(element => getComputedStyle(element).animationName), 'redeven-gateway-content-in');
        const detail = dialog.locator('details:visible').first();
        assert.equal(await detail.getAttribute('open'), null);
        await detail.locator('summary').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(280);
        assert.equal(await detail.getAttribute('open'), '');
        assert.equal(await detail.locator('summary').evaluate(element => getComputedStyle(element).cursor), 'pointer');
        await checkScrollExtent(dialog, { locale, width, height, stage: 'access-expanded' });
        await detail.locator('summary').click(); await page.waitForTimeout(280);
        await checkScrollExtent(dialog, { locale, width, height, stage: 'access-collapsed' });
        await dialog.getByRole('tab', { name: i18n.t('gatewayExperience.cloud'), exact: true }).click();
        const policy = dialog.locator('#gateway-settings-panel-cloud details').filter({ has: page.locator('summary', { hasText: i18n.t('gatewayMembers.policy') }) }).first();
        await policy.locator(':scope > summary').click(); await page.waitForTimeout(280);
        await checkScrollExtent(dialog, { locale, width, height, stage: 'environments-expanded' });
        await policy.locator(':scope > summary').click(); await page.waitForTimeout(280);
        await checkScrollExtent(dialog, { locale, width, height, stage: 'environments-collapsed' });
        await clientsTab.click();
        assert.equal(await dialog.getByText('private-one-time-code', { exact: true }).isVisible(), true, 'Tab changes retain an issued code');
        await dialog.getByRole('button', { name: i18n.t('gatewayJoin.back'), exact: true }).click();
        const beforeRevoke = await page.evaluate(() => window.settingsFixture.requests.length);
        await dialog.getByRole('button', { name: i18n.t('gatewayClients.revoke'), exact: true }).click();
        assert.equal(await page.evaluate(() => window.settingsFixture.requests.length), beforeRevoke);
        await dialog.getByText(i18n.t('gatewayClients.revokeHelp'), { exact: true }).waitFor();
        assert.equal(await dialog.locator('div.redeven-gateway-content-enter').filter({ hasText: i18n.t('gatewayClients.revokeHelp') }).evaluate(element => getComputedStyle(element).animationName), 'redeven-gateway-content-in');
        await dialog.getByRole('button', { name: i18n.t('gatewayClients.confirmRevoke'), exact: true }).click();
        await dialog.getByText(i18n.t('gatewayClients.revoked'), { exact: true }).waitFor();
        assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-' + height + '-host.png' });
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        await page.waitForFunction(element => element === document.activeElement, await more.elementHandle(), { timeout: 3000 });
        await page.evaluate(({ snapshot, gateway }) => window.settingsFixture.publish({ ...snapshot, gateway_sources: [{
          ...gateway, connection_kind: 'url', management_capability: 'access_only', gateway_url: 'https://gateway.example/'
        }] }), { snapshot, gateway });
        await openSettings();
        assert.equal(await dialog.getByRole('tab').count(), 5, 'All connections retain the same navigation groups');
        await dialog.getByRole('tab', { name: i18n.t('gatewayExperience.clients'), exact: true }).click();
        assert.equal(await dialog.getByRole('button', { name: i18n.t('gatewayClients.createCode'), exact: true }).count(), 0, 'URL cannot gain management from stale local permissions');
        await dialog.getByRole('tab', { name: i18n.t('common.settings'), exact: true }).click();
        assert.equal(await dialog.getByRole('button', { name: i18n.t('gatewayMembers.createInvitation'), exact: true }).count(), 0);
        await dialog.locator('.redeven-gateway-authority').getByText(i18n.t('gatewayClients.clientOnly'), { exact: true }).waitFor();
        await dialog.locator('#gateway-name').fill('Renamed Gateway');
        await dialog.getByRole('button', { name: i18n.t('connectionDialog.saveGateway'), exact: true }).click();
        const saved = await page.evaluate(() => window.settingsFixture.requests.at(-1));
        assert.equal(saved.kind, 'upsert_gateway');
        assert.equal(saved.permissions, undefined);
        assert.equal(saved.access_code, undefined, 'A paired URL client reconnects without a new code');
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-' + height + '-client.png' });
        report.cases.push({ locale, width, height, fixedHostAuthority: true, consumerOnly: true, keyboardTabs: true, codeRetained: true, draftRetained: true, activeScrollExtent: true, revokeConfirmation: true, focusRestored: true, viewportBounded: true });
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
  console.log('PASS Gateway host/client UI (' + report.cases.length + ' locale/layout cases)');
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(output + '/report.json', JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
