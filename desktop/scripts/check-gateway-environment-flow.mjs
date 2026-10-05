import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-environment-flow/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
try {
  const { compactEnvironmentPreviewFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/compactEnvironmentPreviewFixture.ts', import.meta.url)));
  const { createDesktopI18n } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/index.ts', import.meta.url)));
  const source = compactEnvironmentPreviewFixture().coverage;
  const environment = source.environments.find(entry => entry.kind === 'gateway_environment');
  const gateway = { ...source.gateway_sources[0], sync_state: 'ready', display_name: 'Gateway-local' };
  const snapshot = { ...source, open_windows: [], environments: [], gateway_sources: [{ ...gateway, environments: [] }] };
  const i18n = createDesktopI18n('zh-CN');
  for (const [width, dark, largeText] of [[1280, false, false], [1280, true, false], [430, true, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 1050 }, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: 'zh-CN', resolved_locale: 'zh-CN', source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot });
    await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
    await page.getByRole('button', { name: i18n.t('environmentCenter.gatewaysSection'), exact: true }).click();
    await page.evaluate(async ({ dark, largeText }) => {
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.classList.toggle('light', !dark);
      if (largeText) document.documentElement.style.fontSize = '20px';
      await document.fonts.ready;
    }, { dark, largeText });
    const card = page.locator('[data-gateway-id="bastion"]');
    const add = card.getByRole('button', { name: i18n.t('gatewayAccess.addEnvironment'), exact: true });
    assert.ok((await card.innerText()).includes(i18n.tn('plural.environmentCount', 0)));
    assert.ok((await card.innerText()).includes(i18n.t('gatewayAccess.directoryEmpty')));
    assert.equal(await card.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    const suffix = `${width}-${dark ? 'dark' : 'light'}`;
    await page.screenshot({ path: `${output}/empty-${suffix}.png` });

    await add.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.locator('#gateway-environment-target-url').fill('https://workspace.example.invalid/');
    await dialog.locator('#environment-label').fill('Development');
    assert.equal(await card.isVisible(), true);
    assert.ok((await dialog.locator('.redeven-gateway-context').innerText()).includes('Gateway-local'));
    assert.equal(await dialog.locator('#gateway-environment-gateway').count(), 0);
    assert.equal(await dialog.locator('[data-floe-dialog-header] p').count(), 0);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: `${output}/add-${suffix}.png` });

    await page.evaluate(({ snapshot, gateway, environment }) => {
      let failNextSave = true;
      let failNextDelete = true;
      let current = snapshot;
      window.settingsFixture.actionResult = request => {
        if (request.kind === 'check_gateway_environment_profile') return { ok: true, outcome: 'checked_gateway_environment_profile', gateway_profile_check: { identity_verified: true } };
        if (request.kind === 'upsert_environment_registration') {
          if (failNextSave) {
            failNextSave = false;
            return { ok: false, scope: 'dialog', code: 'gateway_catalog_failed', message: 'Gateway unavailable.',
              failure: { code: 'operation_failed', severity: 'error', title: 'Gateway', summary: 'Gateway unavailable.', summary_key: 'gatewayAccess.unavailable' } };
          }
          const entry = { ...environment, label: request.registration.display_name };
          current = { ...current, environments: [entry], gateway_sources: [{ ...gateway, environments: [{ ...gateway.environments[0], display_name: entry.label }] }] };
          window.settingsFixture.publish(current);
          return { ok: true, outcome: 'saved_gateway_environment', environment_id: entry.id };
        }
        if (request.kind === 'delete_environment_registration') {
          if (failNextDelete) {
            failNextDelete = false;
            return { ok: false, scope: 'dialog', code: 'gateway_catalog_failed', message: 'Gateway unavailable.',
              failure: { code: 'operation_failed', severity: 'error', title: 'Gateway', summary: 'Gateway unavailable.', summary_key: 'gatewayAccess.unavailable' } };
          }
          current = { ...current, environments: [], gateway_sources: [{ ...gateway, environments: [] }] };
          window.settingsFixture.publish(current);
          return { ok: true, outcome: 'deleted_gateway_environment' };
        }
      };
    }, { snapshot, gateway, environment });
    const save = dialog.getByRole('button', { name: i18n.t('connectionDialog.save'), exact: true });
    assert.equal(await save.isDisabled(), true);
    await dialog.getByRole('button', { name: i18n.t('gatewayAccess.verifyConnection'), exact: true }).click();
    await save.click();
    await dialog.getByText(i18n.t('gatewayAccess.unavailable'), { exact: true }).waitFor();
    assert.equal(await dialog.locator('#environment-label').inputValue(), 'Development');
    assert.equal(await card.isVisible(), true);
    await save.click();
    await dialog.waitFor({ state: 'detached' });
    await card.getByText('Development', { exact: true }).waitFor();
    assert.ok((await card.innerText()).includes(i18n.tn('plural.environmentCount', 1)));
    await page.waitForFunction(() => document.activeElement?.classList.contains('redeven-gateway-card__add'));
    const row = card.locator('[data-gateway-environment-id]');
    assert.equal(await row.count(), 1);
    for (const button of await row.getByRole('button').all()) assert.equal(await button.evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
    assert.equal(await card.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: `${output}/saved-${suffix}.png` });

    await row.getByRole('button', { name: i18n.t('environmentCenter.settingsForLabel', { label: 'Development' }), exact: true }).click();
    await dialog.locator('#environment-label').fill('Design workspace');
    assert.equal(await dialog.locator('#gateway-environment-gateway').count(), 0);
    await save.click();
    await card.getByText('Design workspace', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await card.isVisible(), true);
    await page.waitForFunction(() => document.activeElement?.closest('.redeven-gateway-environment__controls'));
    const remove = row.getByRole('button', { name: i18n.t('environmentCenter.removeLabel', { label: 'Design workspace' }), exact: true });
    await remove.click();
    await dialog.getByRole('button', { name: i18n.t('common.cancel'), exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.closest('.redeven-gateway-environment__controls'));
    assert.equal((await page.evaluate(() => window.settingsFixture.requests)).filter(request => request.kind === 'delete_environment_registration').length, 0);
    await remove.click();
    const confirmDelete = dialog.getByRole('button', { name: i18n.t('confirm.deleteGatewayEnvironmentConfirm'), exact: true });
    await confirmDelete.click();
    await dialog.getByText(i18n.t('gatewayAccess.unavailable'), { exact: true }).waitFor();
    assert.equal(await row.count(), 1);
    await confirmDelete.click();
    await dialog.waitFor({ state: 'detached' });
    await card.getByText(i18n.tn('plural.environmentCount', 0), { exact: true }).waitFor();
    assert.equal(await card.locator('[data-gateway-environment-id]').count(), 0);
    await page.waitForFunction(() => document.activeElement?.classList.contains('redeven-gateway-card__add'));
    const requests = await page.evaluate(() => window.settingsFixture.requests);
    assert.equal(requests.filter(request => request.kind === 'upsert_environment_registration').length, 3);
    assert.equal(requests.filter(request => request.kind === 'delete_environment_registration').length, 2);
    assert.equal(requests.some(request => request.kind === 'start_gateway' || request.kind === 'open_gateway_environment'), false);

    // A stale populated list must stay readable while refresh failure is explicit.
    await page.evaluate(({ snapshot, gateway, environment }) => window.settingsFixture.publish({ ...snapshot,
      environments: [environment], gateway_sources: [{ ...gateway, sync_state: 'catalog_failed' }] }), { snapshot, gateway, environment });
    await card.getByText(i18n.t('gatewayAccess.environmentListStale'), { exact: true }).waitFor();
    await card.locator('[data-gateway-environment-id]').waitFor();
    assert.equal(await card.isVisible(), true);
    // Unknown is not zero; another Gateway never borrows this one's list or edit permission.
    await page.evaluate(({ snapshot, gateway, environment }) => window.settingsFixture.publish({ ...snapshot,
      environments: [{ ...environment, label: 'A long environment name with a clearly scoped Gateway owner', can_edit: false, can_delete: false }],
      gateway_sources: [{ ...gateway, capabilities: ['env_catalog', 'env_direct_open', 'env_proxy_open'] },
        { ...gateway, gateway_id: 'pending', display_name: 'Pending Gateway', environments: [], sync_state: 'idle', last_synced_at_ms: undefined }],
    }), { snapshot, gateway, environment });
    const pending = page.locator('[data-gateway-id="pending"]');
    assert.equal(await pending.locator('.redeven-gateway-card__count').innerText(), '—');
    assert.equal(await pending.locator('[data-gateway-environment-id]').count(), 0);
    assert.equal(await card.locator('.redeven-gateway-environment__controls button').count(), 1);
    assert.equal(await card.locator('.redeven-gateway-environment__controls button').isDisabled(), true);
    assert.equal(await card.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    report.cases.push({ width, dark, largeText, createRetryEditDeleteInPlace: true, focusRestored: true, canceledDelete: true, failedDeleteRetry: true, countUpdated: true, staleList: true, multipleGatewayIsolation: true, readOnly: true });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'passed', ...report }, null, 2));
  console.log('PASS Gateway environment create, retry, edit and delete in place');
} finally { await browser.close(); await server.close(); }
