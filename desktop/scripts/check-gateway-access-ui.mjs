import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-ui-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
try {
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } = await load('../src/shared/i18n/index.ts');
  const { memberFixture, catalogFixture, invitationFixture } = await load('../src/testSupport/gatewayMembershipFixture.ts');
  const source = compactEnvironmentPreviewFixture().coverage;
  const members = ['Inherited', 'Explicit'].map((display_name, i) => ({ ...memberFixture, member_id: `member_${i}`, display_name, cloud_permission: i ? 'deny' : 'inherit' }));
  const gateway = { ...source.gateway_sources[0], sync_state: 'ready', policy: catalogFixture.policy,
    permissions: catalogFixture.gateway.permissions, environments: members };
  const snapshot = { ...source, open_windows: [], environments: [], gateway_sources: [gateway] };
  const locales = process.argv.length > 2 ? process.argv.slice(2) : REDEVEN_SUPPORTED_LOCALES;
  assert.ok(locales.every(locale => REDEVEN_SUPPORTED_LOCALES.includes(locale)));
  for (const locale of locales) {
    const i18n = createDesktopI18n(locale);
    for (const [width, dark, largeText] of [[1280, false, false], [760, true, true], [430, true, true]]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.errors.push(error.message));
      await page.addInitScript(({ snapshot, locale }) => {
        window.settingsFixtureSnapshot = snapshot;
        const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
        window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
      }, { snapshot, locale });
      await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
      await page.getByRole('button', { name: i18n.t('environmentCenter.gatewaysSection'), exact: true }).click();
      await page.evaluate(async ({ dark, largeText, invitation }) => {
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.classList.toggle('light', !dark);
        if (largeText) document.documentElement.style.fontSize = '20px';
        let inviteAttempts = 0;
        window.settingsFixture.actionResult = request => {
          if (request.kind === 'invite_gateway_runtime') return ++inviteAttempts === 1
            ? { ok: false, scope: 'gateway', code: 'gateway_catalog_failed', message: 'Unavailable' }
            : { ok: true, outcome: 'gateway_invitation_created', gateway_invitation: invitation };
          if (request.kind === 'update_gateway_members') return { ok: true, outcome: 'gateway_members_updated', gateway_member_results: request.items.map((item, index) => ({ member_id: item.member_id, ...(index ? { error_code: 'MEMBER_CONFLICT' } : {}) })) };
          return { ok: true, outcome: 'gateway_members_updated' };
        };
        await document.fonts.ready;
      }, { dark, largeText, invitation: invitationFixture });
      const card = page.locator(`[data-gateway-id="${gateway.gateway_id}"]`);
      const invite = card.getByRole('button', { name: i18n.t('gatewayMembers.invite'), exact: true });
      await invite.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: i18n.t('gatewayMembers.createInvitation'), exact: true }).click();
      await dialog.getByText(i18n.t('gatewayMembers.failed'), { exact: true }).waitFor();
      assert.equal(await dialog.getByText('Inherited', { exact: true }).isVisible(), true);
      await dialog.getByRole('button', { name: i18n.t('gatewayMembers.createInvitation'), exact: true }).click();
      await dialog.getByRole('button', { name: i18n.t('gatewayMembers.download'), exact: true }).waitFor();
      // A policy preview only includes inherited members; saving requires a second explicit action.
      await dialog.getByRole('checkbox', { name: i18n.t('gatewayMembers.defaultAllow'), exact: true }).focus();
      await page.keyboard.press('Space');
      const preview = dialog.locator('p').filter({ hasText: i18n.t('gatewayMembers.affected') });
      assert.ok((await preview.innerText()).includes('Inherited'));
      assert.ok(!(await preview.innerText()).includes('Explicit'));
      await dialog.getByRole('button', { name: i18n.t('common.save'), exact: true }).click();
      assert.equal((await page.evaluate(() => window.settingsFixture.requests)).some(r => r.kind === 'update_gateway_policy'), false);
      await dialog.getByRole('button', { name: i18n.t('gatewayMembers.confirmSave'), exact: true }).click();
      await page.waitForFunction(() => window.settingsFixture.requests.some(r => r.kind === 'update_gateway_policy'));
      for (const select of await dialog.locator('li select').all()) await select.selectOption('allow');
      await dialog.getByRole('button', { name: i18n.t('gatewayMembers.confirmSave'), exact: true }).click();
      await dialog.getByText('MEMBER_CONFLICT', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: i18n.t('gatewayMembers.confirmSave'), exact: true }).click();
      const batches = (await page.evaluate(() => window.settingsFixture.requests)).filter(r => r.kind === 'update_gateway_members');
      assert.deepEqual(batches.map(r => r.items.map(item => item.member_id)), [['member_0', 'member_1'], ['member_1']]);
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${locale}/${width}: dialog fits`);
      assert.equal(await dialog.locator('[data-floe-dialog-header] p').count(), 0);
      for (const control of await dialog.locator('button:enabled, select:enabled, [role="checkbox"]:not([aria-disabled="true"])').all()) {
        if (await control.isVisible()) assert.equal(await control.evaluate(el => getComputedStyle(el).cursor), 'pointer');
      }
      await page.screenshot({ path: `${output}/${locale}-${width}.png` });
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.activeElement?.classList.contains('redeven-gateway-card__add'));
      // Failed refresh retains the last directory; access-only identities never gain mutation rights.
      await page.evaluate(({ snapshot, gateway }) => window.settingsFixture.publish({ ...snapshot, gateway_sources: [{ ...gateway, sync_state: 'catalog_failed', permissions: { access: true, manage_members: false, configure_cloud: false } }] }), { snapshot, gateway });
      await card.getByText(i18n.t('gatewayAccess.environmentListStale'), { exact: true }).waitFor();
      assert.equal(await card.locator('.redeven-gateway-card__count').innerText(), i18n.tn('plural.environmentCount', 2));
      report.cases.push({ locale, width, dark, largeText, invitationRetry: true, partialBatch: true, policyPreview: true, restoredFocus: true, staleDirectory: true });
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'passed', ...report }, null, 2));
  console.log(`PASS Gateway membership UI (${report.cases.length} locale/layout cases)`);
} finally { await browser.close(); await server.close(); }
