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
try {
  const { compactEnvironmentPreviewFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/compactEnvironmentPreviewFixture.ts', import.meta.url)));
  const { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/index.ts', import.meta.url)));
  const source = compactEnvironmentPreviewFixture().coverage;
  const snapshot = { ...source, open_windows: [], environments: source.environments.filter(entry => entry.kind === 'gateway_environment') };
  for (const locale of REDEVEN_SUPPORTED_LOCALES) {
    const i18n = createDesktopI18n(locale);
    for (const [width, dark, largeText] of [[1280, false, false], [760, true, true]]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      await page.addInitScript(({ snapshot, locale }) => {
        window.settingsFixtureSnapshot = snapshot;
        const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
        window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
      }, { snapshot, locale });
      await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
      const card = page.locator('[data-environment-group]').filter({ has: page.getByRole('heading', { name: 'Gateway workspace', exact: true }) });
      await card.waitFor();
      await page.evaluate(({ dark, largeText }) => {
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.classList.toggle('light', !dark);
        if (largeText) document.documentElement.style.fontSize = '20px';
        return document.fonts.ready;
      }, { dark, largeText });
      assert.ok((await card.innerText()).includes(i18n.t('gatewayAccess.proxy')));
      for (const [key, mode] of [['openProxy', 'gateway_proxy'], ['openDirect', 'direct_url']]) {
        await card.locator('.redeven-split-action-toggle').click();
        const action = page.getByRole('menuitem', { name: i18n.t(`gatewayAccess.${key}`), exact: true });
        await action.waitFor();
        assert.equal(await action.evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap');
        await action.focus();
        await page.keyboard.press('Enter');
        const requests = await page.evaluate(() => window.settingsFixture.requests);
        assert.ok(requests.some(request => request.kind === 'open_gateway_environment' && request.access_mode === mode));
      }
      await card.getByRole('button', { name: i18n.t('environmentCenter.settingsForLabel', { label: 'Gateway workspace' }), exact: true }).click();
      const select = page.locator('#gateway-environment-access-mode');
      await select.waitFor();
      assert.equal(await select.getByRole('radio', { name: i18n.t('gatewayAccess.proxy'), exact: true }).getAttribute('aria-checked'), 'true');
      await select.getByRole('radio', { name: i18n.t('gatewayAccess.direct'), exact: true }).click();
      assert.equal(await select.getByRole('radio', { name: i18n.t('gatewayAccess.direct'), exact: true }).getAttribute('aria-checked'), 'true');
      const dialog = page.getByRole('dialog');
      await page.evaluate(() => {
        window.settingsFixture.actionResult = request => {
          if (request.kind === 'upsert_environment_registration') return {
            ok: false, scope: 'dialog', code: 'gateway_start_required', message: 'Gateway service is stopped.',
            gateway_id: 'bastion', continuation_action: { kind: 'start_gateway', gateway_id: 'bastion' },
          };
          if (request.kind === 'start_gateway') return { ok: true, outcome: 'started_gateway' };
        };
      });
      await dialog.getByRole('button', { name: i18n.t('connectionDialog.save'), exact: true }).click();
      const start = dialog.getByRole('button', { name: i18n.t('environmentCenter.gatewayActionStart'), exact: true });
      await start.waitFor();
      assert.equal(await start.evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap');
      assert.notEqual(await start.evaluate(element => getComputedStyle(element).cursor), 'default');
      assert.equal(await page.evaluate(() => window.settingsFixture.requests.filter(request => request.kind === 'start_gateway').length), 0);
      await start.focus();
      await page.keyboard.press('Enter');
      await dialog.getByText(i18n.t('gatewayAccess.profileServiceReady'), { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.settingsFixture.requests.filter(request => request.kind === 'upsert_environment_registration').length), 1);
      assert.equal(await select.getByRole('radio', { name: i18n.t('gatewayAccess.direct'), exact: true }).getAttribute('aria-checked'), 'true');
      assert.equal(await dialog.locator('[data-floe-dialog-header] p').count(), 0);
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      if (locale === 'zh-CN') await page.screenshot({ path: `${output}/gateway-profile-${dark ? 'dark-narrow' : 'light'}.png` });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: i18n.t('environmentCenter.gatewaysSection'), exact: true }).click();
      const gatewayCard = page.locator('[data-gateway-id="bastion"]');
      await gatewayCard.waitFor();
      assert.ok((await gatewayCard.innerText()).includes(i18n.t('gatewayAccess.directory')));
      const directoryHelp = gatewayCard.getByRole('button', { name: i18n.t('gatewayAccess.directoryHelpLabel'), exact: true });
      await directoryHelp.click();
      await gatewayCard.getByText(i18n.t('gatewayAccess.directoryAccessHint'), { exact: true }).waitFor();
      await directoryHelp.click();
      await gatewayCard.locator('.redeven-gateway-card__explanation').waitFor({ state: 'detached' });
      for (const control of await gatewayCard.getByRole('button').all()) {
        assert.equal(await control.evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap');
      }
      assert.equal(await gatewayCard.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      if (locale === 'zh-CN') await page.screenshot({ path: `${output}/gateway-card-${dark ? 'dark-narrow' : 'light'}.png` });
      await gatewayCard.getByRole('button', { name: i18n.t('gatewayAccess.addEnvironment'), exact: true }).click();
      const create = page.getByRole('dialog');
      await create.locator('#gateway-environment-target-url').waitFor();
      assert.ok((await create.locator('#gateway-environment-gateway').innerText()).includes('Bastion'));
      assert.equal(await create.locator('#gateway-environment-access-mode').getByRole('radio', { name: i18n.t('gatewayAccess.proxy'), exact: true }).getAttribute('aria-checked'), 'true');
      await page.keyboard.press('Escape');
      await create.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: i18n.t('environmentCenter.gatewaysSection'), exact: true }).click();
      await page.getByRole('button', { name: i18n.t('environmentCenter.addGateway'), exact: true }).first().click();
      const setup = page.getByRole('dialog');
      const help = setup.getByRole('button', { name: i18n.t('gatewayAccess.profileHelpLabel'), exact: true });
      await help.focus();
      await page.keyboard.press('Enter');
      await setup.getByText(i18n.t('gatewayAccess.profileHelpBoundary'), { exact: true }).waitFor();
      assert.equal(await setup.getByRole('checkbox', { name: i18n.t('gatewayAccess.grantWrite'), exact: true }).isChecked(), false);
      await setup.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)); });
      if (locale === 'zh-CN') await page.screenshot({ path: `${output}/gateway-permission-${dark ? 'dark-narrow' : 'light'}.png` });
      await setup.getByRole('button', { name: i18n.t('connectionDialog.gatewayTransportSshHost'), exact: true }).click();
      await setup.locator('#gateway-ssh-destination').fill('dev@bastion');
      await setup.getByRole('checkbox', { name: i18n.t('gatewayAccess.grantWrite'), exact: true }).focus();
      await page.keyboard.press('Space');
      await page.evaluate(() => {
        window.settingsFixture.actionResult = request => {
          if (request.kind === 'upsert_gateway') return { ok: false, scope: 'dialog', code: 'gateway_start_required',
            gateway_id: 'bastion', message: 'Gateway service has not been started.',
            continuation_action: { kind: 'start_gateway', gateway_id: 'bastion' },
            failure: { code: 'operation_failed', severity: 'error', title: 'Gateway', summary: 'Gateway connection saved.', summary_key: 'gatewayAccess.setupServiceRequired' } };
          if (request.kind === 'start_gateway') return { ok: true, outcome: 'started_gateway' };
        };
      });
      await setup.getByRole('button', { name: i18n.t('connectionDialog.saveGateway'), exact: true }).click();
      await setup.getByText(i18n.t('gatewayAccess.setupServiceRequired'), { exact: true }).waitFor();
      const setupStart = setup.getByRole('button', { name: i18n.t('environmentCenter.gatewayActionStart'), exact: true });
      assert.equal(await setupStart.evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap');
      await setupStart.focus();
      await page.keyboard.press('Enter');
      await setup.getByText(i18n.t('gatewayAccess.profileServiceReady'), { exact: true }).waitFor();
      assert.equal(await setup.locator('#gateway-ssh-destination').inputValue(), 'dev@bastion');
      assert.ok((await setup.innerText()).includes(i18n.t('gatewayAccess.managedServiceHelp')));
      assert.equal(await setup.locator('[data-floe-dialog-header] p').count(), 0);
      assert.equal(await setup.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      for (const control of await setup.getByRole('button').all()) {
        if (await control.isVisible()) assert.notEqual(await control.evaluate(element => getComputedStyle(element).cursor), 'default');
      }
      if (locale === 'zh-CN') await page.screenshot({ path: `${output}/gateway-service-${dark ? 'dark-narrow' : 'light'}.png` });
      await page.keyboard.press('Escape');
      await setup.waitFor({ state: 'detached' });
      report.cases.push({ locale, width, dark, largeText });
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'passed', ...report }, null, 2));
  console.log(`PASS Gateway UI qualification (${report.cases.length} locale/layout cases)`);
} finally { await browser.close(); await server.close(); }
