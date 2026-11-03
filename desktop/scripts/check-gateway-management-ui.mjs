import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-management-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['environment-settings.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
async function settleVisuals(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}
const locales = (process.env.REDEVEN_GATEWAY_QA_LOCALES || 'en-US,zh-CN,zh-TW,ja-JP,ko-KR,de-DE,es-ES,fr-FR,pt-BR,ru-RU').split(',');
try {
  const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { catalogFixture, invitationFixture } = await load('../src/testSupport/gatewayMembershipFixture.ts');
  const { createDesktopI18n } = await load('../src/shared/i18n/index.ts');
  const source = compactEnvironmentPreviewFixture().coverage;
  const gateway = { ...source.gateway_sources[0], display_name: 'Office Gateway', connection_kind: 'local_host', management_capability: 'managed_local_host',
    client_key_id:'studio', status: 'online', trust_state: 'paired', sync_state: 'ready', local_enabled: true, policy: catalogFixture.policy, endpoints: catalogFixture.gateway.endpoints,
    permissions: { access: true, manage_attachments: true, manage_network: true }, environments: [catalogFixture.attachments[0]],
    service_state: { status: 'ready', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } };
  const snapshot = { ...source, gateway_sources: [gateway], open_windows: [] };
  for (const locale of locales) {
    const i18n = createDesktopI18n(locale);
    for (const width of [390, 430, 768, 1280]) {
      const dark = width === 430 || width === 1280;
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light', reducedMotion: dark ? 'no-preference' : 'reduce' });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.errors.push(error.message));
      try {
        await page.addInitScript(({ snapshot, locale, invitationFixture }) => {
          window.settingsFixtureSnapshot = snapshot;
          const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
          window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
          window.gatewayInvitationFixture = invitationFixture;
        }, { snapshot, locale, invitationFixture });
        await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href, { timeout: 60000 });
        await page.evaluate(async dark => {
          document.documentElement.classList.toggle('dark', dark); document.documentElement.classList.toggle('light', !dark);
          await document.fonts.ready;
          window.settingsFixture.actionResult = request => {
            if (request.kind === 'list_gateway_clients') return { ok: true, outcome: 'gateway_clients_listed', gateway_clients: [{ client_key_id: 'studio', client_name: 'Studio Desktop', paired_at_unix_ms: Date.now(), last_verified_at_unix_ms: Date.now(), revoked_at_unix_ms: 0 }] };
            if (request.kind === 'revoke_gateway_client') return { ok: true, gateway_clients: [{ client_key_id: 'studio', client_name: 'Studio Desktop', paired_at_unix_ms: Date.now(), last_verified_at_unix_ms: Date.now(), revoked_at_unix_ms: Date.now() }] };
            if (request.kind === 'issue_gateway_access_code') return { ok: true, outcome: 'gateway_access_code_created', gateway_access_code: { access_code: 'qa-explicit-access-code', expires_at_unix_ms: Date.now() + 600000 } };
            if (request.kind === 'invite_gateway_runtime') return { ok: true, outcome: 'gateway_invitation_created', gateway_invitation_code: { ...window.gatewayInvitationFixture, expires_at_unix_ms: Date.now() + 600000 } };
            return { ok: true, outcome: 'saved_gateway' };
          };
        }, dark);
        const button = (scope, key) => scope.getByRole('button', { name: i18n.t(key), exact: true });
        await button(page, 'environmentCenter.gatewaysSection').click();
        const card = page.locator('.redeven-gateway-card');
        await card.waitFor();
        const query = page.getByRole('textbox', { name: i18n.t('environmentCenter.gatewaySearchPlaceholder'), exact: true });
        await query.fill('Office');
        await settleVisuals(page);
        const cardHeight = await card.evaluate(element => element.getBoundingClientRect().height);
        for (const syncState of ['pairing_failed', 'catalog_failed', 'gateway_unreachable', 'syncing']) {
          await page.evaluate(({ snapshot, syncState }) => window.settingsFixture.publish({ ...snapshot, gateway_sources: [{ ...snapshot.gateway_sources[0], status: 'error', sync_state: syncState,
            last_sync_error_code: syncState === 'pairing_failed' ? 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED' : '', background_sync_running: syncState === 'syncing' }] }), { snapshot, syncState });
          await settleVisuals(page);
          const height = await card.evaluate(element => element.getBoundingClientRect().height);
          assert.ok(Math.abs(height - cardHeight) < 1, locale + '/' + width + '/' + syncState + ' keeps card height: ' + JSON.stringify({cardHeight, height}));
          assert.equal(await card.locator('.redeven-gateway-card__empty').count(), 0);
          assert.equal(await card.locator('.redeven-gateway-card__primary-button svg').isVisible(), true, 'Compact primary action retains its icon');
        }
        await page.evaluate(snapshot => window.settingsFixture.publish({ ...snapshot, gateway_sources: [{ ...snapshot.gateway_sources[0], status: 'error', sync_state: 'pairing_failed', last_sync_error_code: 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED' }] }), snapshot);
        await settleVisuals(page);
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-card-error.png' });
        await card.locator('.redeven-gateway-card__help').click();
        await page.getByRole('dialog', { name: i18n.t('gatewayAccess.directoryHelpLabel'), exact: true }).waitFor();
        assert.ok(Math.abs(await card.evaluate(element => element.getBoundingClientRect().height) - cardHeight) < 1, 'Error details do not reflow the card');
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({state:'detached'});
        await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), snapshot);
        await button(card, 'gatewayExperience.manage').click();
        const workspace = page.locator('[data-gateway-management-page]');
        const nav = workspace.locator('[data-gateway-management-nav]');
        await workspace.waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0);
        const keys = ['gatewayExperience.overview', 'gatewayExperience.clients', 'gatewayClients.runtimes', 'gatewayExperience.network', 'gatewayExperience.maintenance'];
        assert.deepEqual(await nav.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), keys.map(key => i18n.t(key)));
        for (const [index, key] of keys.entries()) {
          await button(nav, key).click();
          assert.equal(await button(nav, key).getAttribute('aria-current'), 'page');
          assert.equal(await button(nav, key).evaluate(element => getComputedStyle(element).boxShadow), 'none', 'Selected navigation has no decorative edge marker');
          if (width < 768) {
            const label = button(nav, key).locator('span');
            assert.equal(await label.evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap', 'Compact navigation keeps labels intact');
          }
          const panel = workspace.locator('.redeven-gateway-workspace-section:visible');
          assert.equal(await panel.count(), 1);
          const metrics = await workspace.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            const scroller = element.closest('.redeven-welcome-surface');
            scroller.scrollTop = scroller.scrollHeight;
            const contentEnd = element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop;
            return { overflow: element.scrollWidth - element.clientWidth, left: bounds.left, right: bounds.right, viewport: innerWidth,
              excess: scroller.scrollHeight - Math.max(scroller.clientHeight, Math.ceil(contentEnd)) };
          });
          assert.ok(metrics.overflow <= 1 && metrics.left >= 0 && metrics.right <= width + 1, locale + '/' + width + ' fits: ' + JSON.stringify(metrics));
          assert.ok(metrics.excess <= 32, 'No blank scroll tail: ' + JSON.stringify(metrics));
          if (index === 4) {
            await button(panel, 'gatewayMaintenance.reinstall').waitFor();
            assert.equal(await button(panel, 'environmentCenter.gatewayActionUpdate').isEnabled(), true);
            assert.equal(await button(panel, 'gatewayMaintenance.reinstall').isEnabled(), true);
            await settleVisuals(page);
            const controls = await panel.locator('.redeven-gateway-maintenance-actions button').evaluateAll(buttons => buttons.map(button => ({
              width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height,
              font: getComputedStyle(button).fontSize, icon: !!button.querySelector('svg'),
            })));
            assert.ok(controls.every(control => control.icon), 'Every operation has its own icon');
            assert.equal(new Set(controls.map(control => control.font)).size, 1, 'Consistent action typography');
            assert.ok(Math.max(...controls.map(control => control.width)) - Math.min(...controls.map(control => control.width)) <= 1, 'Aligned action widths');
            assert.ok(Math.max(...controls.map(control => control.height)) - Math.min(...controls.map(control => control.height)) <= 1, 'Aligned action heights');
            assert.equal(await panel.locator('p').count(), 0, 'Impact copy belongs in confirmations');
            await workspace.screenshot({ path: output + '/' + locale + '-' + width + '-maintenance.png' });
          }
          if (index === 3) {
            await workspace.locator('#gateway-listen-addresses').fill('127.0.0.1:7555');
            assert.equal(await panel.getByPlaceholder(i18n.t('gatewayNetwork.addressPlaceholder'), { exact: true }).count(), 1);
          }
        }
        await button(nav, 'gatewayExperience.clients').click();
        await button(workspace, 'gatewayExperience.connectClient').click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        assert.equal(await dialog.locator('.redeven-gateway-access-code').count(), 0);
        await button(dialog, 'gatewayClients.createCode').click();
        await dialog.locator('.redeven-gateway-access-code code').waitFor();
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.height <= 900);
        assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        await settleVisuals(page);
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-client.png' });
        await button(dialog, 'common.close').click(); await page.locator('[data-floe-dialog-panel].redeven-gateway-dialog').waitFor({ state: 'detached' });
        await button(workspace, 'gatewayExperience.allGateways').click(); await card.waitFor();
        assert.equal(await query.inputValue(), 'Office');
        await button(card, 'gatewayExperience.manage').click();
        await button(nav, 'gatewayExperience.network').click();
        assert.equal(await workspace.locator('#gateway-listen-addresses').inputValue(), '127.0.0.1:7555');
        await button(nav, 'gatewayExperience.clients').click(); await button(workspace, 'gatewayExperience.connectClient').click();
        assert.equal(await dialog.locator('.redeven-gateway-access-code code').innerText(), 'qa-explicit-access-code');
        await button(dialog, 'common.close').click(); await page.locator('[data-floe-dialog-panel].redeven-gateway-dialog').waitFor({ state: 'detached' });
        const beforeRevoke = await page.evaluate(() => window.settingsFixture.requests.length);
        await button(workspace, 'gatewayClients.revoke').click();
        assert.equal(await page.evaluate(() => window.settingsFixture.requests.length), beforeRevoke, 'Revocation awaits explicit confirmation');
        await button(workspace, 'gatewayClients.confirmRevoke').click();
        await workspace.getByText(i18n.t('gatewayClients.revoked'), { exact: true }).waitFor();
        await workspace.getByText(i18n.t('gatewayClients.currentDevice'),{exact:true}).waitFor();
        const reauthorize=button(workspace,'gatewayClients.reauthorize');await reauthorize.waitFor();
        assert.ok(await reauthorize.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'Reauthorization text must fit');
        await settleVisuals(page);
        await page.screenshot({path:output+'/'+locale+'-'+width+'-revoked-device.png'});
        await reauthorize.click();
        assert.equal(await page.evaluate(()=>window.settingsFixture.requests.filter(request=>request.kind==='pair_gateway').length),1);
        await button(nav, 'gatewayClients.runtimes').click(); await button(workspace, 'gatewayExperience.connectRuntime').click();
        await button(dialog, 'gatewayExperience.otherRuntime').click();
        await button(dialog, 'gatewayMembers.createInvitation').click();
        await dialog.getByRole('timer').waitFor();
        await button(dialog, 'common.close').click(); await page.locator('[data-floe-dialog-panel].redeven-gateway-dialog').waitFor({ state: 'detached' });
        await button(nav, 'gatewayExperience.maintenance').click();
        await button(workspace, 'environmentCenter.gatewayActionRestart').click();
        await dialog.locator('.redeven-gateway-action-panel').waitFor();
        assert.equal(await page.evaluate(() => window.settingsFixture.requests.some(r => r.kind === 'restart_gateway')), false);
        assert.equal(await page.locator('.redeven-gateway-action-popover-surface').count(), 0);
        await button(dialog, 'common.close').first().click(); await page.locator('[data-floe-dialog-panel].redeven-gateway-dialog').waitFor({ state: 'detached' });
        await button(nav, 'gatewayExperience.network').click();
        await settleVisuals(page);
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-network.png' });
        await button(nav, 'gatewayExperience.overview').click();
        await button(workspace, 'gatewayExperience.moreActions').click();
        assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['gatewayExperience.editConnection', 'gatewayExperience.disableConnection', 'gatewayExperience.removeConnection'].map(key => i18n.t(key)));
        await page.waitForFunction(() => document.querySelector('[role=menu]')?.contains(document.activeElement));
        await page.keyboard.press('End');
        assert.equal(await page.getByRole('menuitem').last().evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Home');
        assert.equal(await page.getByRole('menuitem').first().evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Escape');
        await page.getByRole('menu').waitFor({ state: 'detached' });
        await page.waitForFunction(element => document.activeElement === element, await button(workspace, 'gatewayExperience.moreActions').elementHandle());
        await button(workspace, 'gatewayExperience.moreActions').click();
        await page.getByRole('menuitem', { name: i18n.t('gatewayExperience.editConnection'), exact: true }).click();
        await dialog.locator('#gateway-name').fill('Connection draft');
        await button(dialog, 'common.cancel').click(); await page.locator('[data-floe-dialog-panel].redeven-gateway-dialog').waitFor({ state: 'detached' });
        await settleVisuals(page);
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-overview.png' });
        assert.equal(await page.locator('select').count(), 0);
        assert.equal(await nav.locator('button svg').count(), keys.length, 'Every navigation destination has an icon');
        assert.equal(await workspace.locator('.redeven-gateway-identity-details').getAttribute('open'), null, 'Identity is disclosed on demand');
        const emptySnapshot = { ...snapshot, gateway_sources: [{ ...gateway, endpoints: [], environments: [], gateway_url: '', listener_running: true, listener_address: ':7443', active_listener_addresses: ['[::]:7443'] }] };
        await page.addInitScript(snapshot => { window.settingsFixtureSnapshot = snapshot; }, emptySnapshot);
        await page.reload({ timeout: 60000 });
        await page.evaluate(async dark => {
          document.documentElement.classList.toggle('dark', dark); document.documentElement.classList.toggle('light', !dark);
          await document.fonts.ready;
          window.settingsFixture.actionResult = request => request.kind === 'list_gateway_clients' ? { ok: true, gateway_clients: [] } : { ok: true, outcome: 'saved_gateway' };
        }, dark);
        await button(page, 'environmentCenter.gatewaysSection').click();
        await button(page.locator('.redeven-gateway-card'), 'gatewayExperience.manage').click();
        await button(nav, 'gatewayExperience.overview').click();
        await workspace.getByText(i18n.t('gatewayWorkspace.addressMissing'), { exact: true }).waitFor();
        await settleVisuals(page);
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-overview-empty.png' });
        await button(nav, 'gatewayExperience.clients').click();
        await button(workspace, 'common.refresh').click();
        await workspace.getByText(i18n.t('gatewayWorkspace.emptyClients'), { exact: true }).waitFor();
        assert.equal(await workspace.locator('#gateway-management-clients h3').count(), 1, 'Client page has one heading and toolbar');
        assert.equal(await workspace.locator('#gateway-management-clients [role=alert]').count(), 0, 'No stale access error');
        await settleVisuals(page);
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-clients-empty.png' });
        await button(nav, 'gatewayExperience.network').click();
        assert.equal(await workspace.locator('[data-gateway-panel=connection] .redeven-gateway-setting-row').count(), 2);
        assert.equal(await workspace.locator('[data-gateway-panel=connection] .redeven-gateway-help-trigger').count(), 3, 'Address, listener and host help are available on demand');
        await settleVisuals(page);
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-network-empty.png' });

        await page.evaluate(snapshot => window.settingsFixture.publish({ ...snapshot, gateway_sources: [{
          ...snapshot.gateway_sources[0], status: 'offline', permissions: { access: false, manage_attachments: false, manage_network: false },
          service_state: { status: 'needs_reinstall', can_start: false, can_stop: false, can_restart: false, can_update: true, can_pair_after_start: false },
        }] }), emptySnapshot);
        await button(nav, 'gatewayExperience.maintenance').click();
        await button(workspace, 'gatewayMaintenance.reset').waitFor();
        assert.ok(await button(workspace, 'environmentCenter.gatewayActionUpdate').isEnabled());
        assert.ok(await button(workspace, 'gatewayMaintenance.reinstall').isEnabled());
        await settleVisuals(page);
        await workspace.screenshot({ path: output + '/' + locale + '-' + width + '-recovery.png' });
        await button(workspace, 'gatewayMaintenance.reset').click();
        await dialog.waitFor();
        await button(dialog, 'gatewayMaintenance.reset').waitFor();
        assert.equal(await page.evaluate(() => window.settingsFixture.requests.some(r => r.reset_configuration)), false);
        assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        await settleVisuals(page);
        const confirmationButton = button(dialog, 'gatewayMaintenance.reset');
        const confirmationLabel = confirmationButton.getByText(i18n.t('gatewayMaintenance.resetAction'), { exact: true });
        assert.equal(await confirmationLabel.count(), 1);
        assert.ok(await confirmationLabel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Recovery action text fits');
        const bindInput = dialog.getByRole('textbox', { name: i18n.t('gatewayNetwork.listenAddress'), exact: true });
        assert.equal(await bindInput.inputValue(), ':7443');
        const inputFits = () => bindInput.evaluate(element => {
          const input = element.getBoundingClientRect();
          const body = element.closest('.redeven-gateway-action-panel__body').getBoundingClientRect();
          return input.top >= body.top && input.bottom <= body.bottom + 1;
        });
        assert.ok(await inputFits(), 'Bind input is fully visible without scrolling');
        const validBounds = await dialog.boundingBox();
        await bindInput.fill('invalid');
        await settleVisuals(page);
        assert.equal(await confirmationButton.isEnabled(), false);
        const invalidBounds = await dialog.boundingBox();
        assert.ok(Math.abs(validBounds.height - invalidBounds.height) < 1 && Math.abs(validBounds.y - invalidBounds.y) < 1, 'Validation keeps confirmation geometry stable');
        await bindInput.fill('127.0.0.1:0, [::1]:0');
        assert.equal(await confirmationButton.isEnabled(), true);
        await bindInput.fill(':7443');
        await page.screenshot({ path: output + '/' + locale + '-' + width + '-recovery-confirmation.png' });
        await button(dialog, 'common.close').first().click();
        await page.locator('[data-floe-dialog-panel].redeven-gateway-dialog').waitFor({ state: 'detached' });
        report.cases.push({ locale, width, dark, sections: keys.length, draftsRetained: true, explicitIssuance: true, serviceConfirmed: true, revocationConfirmed: true, keyboardMenu: true });
      } catch (error) {
        await page.screenshot({ path: output + '/failure-' + locale + '-' + width + '.png', fullPage: true });
        throw error;
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []);
  await writeFile(output + '/report.json', JSON.stringify({ status: 'passed', ...report }, null, 2));
  console.log('PASS Gateway management: ' + report.cases.length + ' locale/viewport cases');
} finally { await browser.close(); await server.close(); }
