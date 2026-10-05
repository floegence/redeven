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
  const { gatewayServiceStepProgress } = await server.ssrLoadModule(fileURLToPath(new URL('../src/main/gatewayServiceProgress.ts', import.meta.url)));
  const { decorateEnvironmentAccess } = await server.ssrLoadModule(fileURLToPath(new URL('../src/main/environmentAccess.ts', import.meta.url)));
  const { defaultDesktopPreferences } = await server.ssrLoadModule(fileURLToPath(new URL('../src/main/desktopPreferences.ts', import.meta.url)));
  const source = compactEnvironmentPreviewFixture().coverage;
  const snapshot = { ...source, open_windows: [], environments: decorateEnvironmentAccess(source.environments.filter(entry => entry.kind === 'gateway_environment'), defaultDesktopPreferences()) };
  const locales = process.argv.length > 2 ? process.argv.slice(2) : REDEVEN_SUPPORTED_LOCALES;
  assert.ok(locales.every(locale => REDEVEN_SUPPORTED_LOCALES.includes(locale)));
  for (const locale of locales) {
    const i18n = createDesktopI18n(locale);
    for (const [width, dark, largeText] of [[1280, false, false], [760, true, true], [430, true, true]]) {
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
        const label = key === 'openProxy' ? `${i18n.t('gatewayAccess.viaNamedGateway', { gateway: snapshot.environments[0].gateway_label })} · ${i18n.t('gatewayAccess.defaultLabel')}` : i18n.t('gatewayAccess.direct');
        const action = page.getByRole('menuitem', { name: label, exact: true });
        await action.waitFor();
        assert.equal(await action.evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap');
        await action.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(mode => window.settingsFixture.requests.some(request => request.kind === 'open_gateway_environment' && request.access_mode === mode), mode);
      }
      await card.getByRole('button', { name: i18n.t('environmentCenter.settingsForLabel', { label: 'Gateway workspace' }), exact: true }).click();
      const dialog = page.getByRole('dialog');
      assert.equal(await dialog.locator('#gateway-environment-access-mode').count(), 0);
      const select = dialog.locator('.redeven-access-settings');
      assert.equal(await select.getByRole('radio').first().isChecked(), true);
      await select.getByRole('radio').nth(1).check();
      await dialog.locator('#environment-label').fill('Edited Gateway workspace');
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
      assert.equal(await select.getByRole('radio').nth(1).isChecked(), true);
      assert.equal(await page.evaluate(() => window.settingsFixture.requests.filter(request => request.kind === 'set_environment_access_route').length), 0);
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
      assert.equal(await gatewayCard.evaluate(element => element.scrollWidth > element.clientWidth + 1), false,
        `${locale} ${width}px: ${JSON.stringify(await gatewayCard.evaluate(card => {
          const bounds = card.getBoundingClientRect();
          return [...card.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > bounds.right + 1).map(el => ({ class: el.className, text: el.textContent, width: el.getBoundingClientRect().width }));
        }))}`);
      const clippedControls = await gatewayCard.locator('button').evaluateAll(buttons => buttons.flatMap(button => {
        const bounds = button.getBoundingClientRect();
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (!node.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          if ([...range.getClientRects()].some(rect => rect.left < bounds.left - 2 || rect.right > bounds.right + 2)) return [button.textContent];
        }
        return [];
      }));
      assert.deepEqual(clippedControls, [], `${locale}: ${width}px Gateway labels remain visible`);

      if (locale === 'zh-CN') await page.screenshot({ path: `${output}/gateway-card-${dark ? 'dark-narrow' : 'light'}.png` });
      const addEnvironment = gatewayCard.getByRole('button', { name: i18n.t('gatewayAccess.addEnvironment'), exact: true });
      await addEnvironment.focus();
      await page.keyboard.press('Enter');
      const create = page.getByRole('dialog');
      await create.locator('#gateway-environment-target-url').waitFor();
      assert.equal(await gatewayCard.isVisible(), true, 'Adding stays on the originating Gateway');
      assert.ok((await create.locator('.redeven-gateway-context').innerText()).includes('Bastion'));
      assert.equal(await create.locator('#gateway-environment-gateway').count(), 0, 'The originating Gateway is fixed');
      assert.equal(await create.getByText(i18n.t('connectionDialog.environmentType'), { exact: true }).count(), 0);
      assert.equal(await create.locator('#gateway-environment-access-mode').count(), 0);
      assert.equal(await create.getByRole('button', { name: i18n.t('connectionDialog.save'), exact: true }).isDisabled(), true);
      assert.equal(await create.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      if (locale === 'zh-CN') await page.screenshot({ path: `${output}/gateway-add-${dark ? 'dark-narrow' : 'light'}.png` });
      await page.keyboard.press('Escape');
      await create.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.activeElement?.classList.contains('redeven-gateway-card__add'), undefined, { timeout: 3000 });
      await gatewayCard.locator('[data-gateway-environment-id="internal-workspace"]').waitFor();
      assert.equal(await gatewayCard.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      if (locale === 'zh-CN') await page.screenshot({ path: `${output}/gateway-expanded-${dark ? 'dark-narrow' : 'light'}.png` });
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

      const now = Date.now();
      await page.clock.setFixedTime(now);
      const progress = {
        action: 'update_gateway', subject_kind: 'gateway', subject_id: 'bastion', gateway_id: 'bastion',
        operation_key: 'bastion:update_gateway', active_progress_surface: 'gateway',
        status: 'running', phase: 'installing_gateway', title: 'Update Gateway',
        title_key: 'environmentCenter.gatewayActionUpdate', started_at_unix_ms: now, updated_at_unix_ms: now,
        step_progress: gatewayServiceStepProgress(undefined, 'installing_gateway', 'running', now),
      };
      const managedSnapshot = { ...snapshot, gateway_sources: snapshot.gateway_sources.map(gateway => ({
        ...gateway, connection_kind: 'local_host', management_capability: 'managed_local_host', status: 'needs_update',
        service_state: { status: 'service_needs_update', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false },
      })) };
      await page.evaluate(snapshot => {
        window.settingsFixture.publish(snapshot);
        window.settingsFixture.beforeAction = () => new Promise(() => {});
      }, managedSnapshot);
      const primary = gatewayCard.locator('.redeven-gateway-card__primary-button');
      await primary.click();
      const popup = page.locator('.redeven-gateway-action-popover-surface');
      await popup.getByRole('button', { name: i18n.t('environmentCenter.gatewayActionUpdate'), exact: true }).click();
      await page.evaluate(({ snapshot, progress }) => window.settingsFixture.publish({ ...snapshot, action_progress: [progress] }), { snapshot: managedSnapshot, progress });
      await page.clock.setFixedTime(now + 61_000);
      await popup.getByText(i18n.t('progress.operationElapsed', { seconds: 61 }), { exact: true }).waitFor();
      assert.ok((await primary.innerText()).includes(i18n.t('progress.updatingEllipsis')));
      assert.equal(await popup.getByRole('progressbar').getAttribute('aria-valuenow'), null);
      assert.equal(await popup.getByRole('progressbar').locator('span').evaluate(el => getComputedStyle(el).animationName), 'none');
      assert.equal(await popup.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      if (locale === 'zh-CN') await page.screenshot({ path: `${output}/gateway-progress-${dark ? 'dark-narrow' : 'light'}.png` });
      await page.keyboard.press('Escape');
      await popup.waitFor({ state: 'detached' });
      report.cases.push({ locale, width, dark, largeText, progressElapsed: true, reducedMotion: true });
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'passed', ...report }, null, 2));
  console.log(`PASS Gateway UI qualification (${report.cases.length} locale/layout cases)`);
} finally { await browser.close(); await server.close(); }
