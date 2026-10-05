import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/environment-access-routes/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { url: server.resolvedUrls.local[0], pid: process.pid, cases: [], errors: [] };
const load = path => server.ssrLoadModule(fileURLToPath(new URL(path, import.meta.url)));
try {
  const { linkedEnvironmentFixture } = await load('../src/testSupport/linkedEnvironmentFixture.ts');
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { decorateEnvironmentAccess, rememberEnvironmentIdentity } = await load('../src/main/environmentAccess.ts');
  const { defaultDesktopPreferences } = await load('../src/main/desktopPreferences.ts');
  const { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } = await load('../src/shared/i18n/index.ts');
  const { runtime, cloud, snapshot: base } = linkedEnvironmentFixture();
  const source = compactEnvironmentPreviewFixture().coverage;
  const gateway = { ...source.environments.find(entry => entry.kind === 'gateway_environment'), gateway_label: 'Office Gateway' };
  const identity = `runtime:${'a'.repeat(64)}`;
  const preferences = rememberEnvironmentIdentity(rememberEnvironmentIdentity(defaultDesktopPreferences(), runtime, identity), gateway, identity);
  const snapshot = { ...base, environments: decorateEnvironmentAccess([runtime, cloud, gateway], preferences), gateway_sources: source.gateway_sources };
  const readOnly = { ...base, environments: decorateEnvironmentAccess([{ ...gateway, can_edit: false, can_delete: false }], defaultDesktopPreferences()), gateway_sources: source.gateway_sources };
  for (const locale of REDEVEN_SUPPORTED_LOCALES) {
    const i18n = createDesktopI18n(locale);
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('environment-settings.html', report.url).href);
    const card = page.locator('[data-environment-group]:visible');
    await card.waitFor(); assert.equal(await card.count(), 1);
    assert.equal(await card.getByRole('tab').count(), 2, 'Gateway does not add an ownership tab');
    const owner = card.locator('[data-owner-role="runtime"]');
    await owner.locator('.redeven-split-action-primary button').first().click();
    assert.ok((await page.evaluate(() => window.settingsFixture.requests)).some(r => r.kind === 'open_local_environment'));
    await owner.locator('.redeven-split-action-toggle').click();
    const gatewayLabel = i18n.t('gatewayAccess.viaNamedGateway', { gateway: 'Office Gateway' });
    await page.getByRole('menuitem', { name: gatewayLabel, exact: true }).click();
    let requests = await page.evaluate(() => window.settingsFixture.requests);
    assert.ok(requests.some(r => r.kind === 'open_gateway_environment' && r.gateway_id === gateway.gateway_id && r.access_mode === 'gateway_proxy'));
    assert.equal(requests.some(r => r.kind === 'set_environment_access_route'), false);
    const settings = owner.getByRole('button', { name: i18n.t('environmentCenter.settingsForLabel', { label: i18n.t('environmentCenter.relationshipOwnerLabel', { label: runtime.label, owner: i18n.t('environmentCenter.runtimeOwner') }) }), exact: true });
    await settings.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: i18n.t('settings.connectionTab'), exact: true }).click();
    await dialog.getByRole('radio').nth(1).check();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => window.settingsFixture.requests)).some(r => r.kind === 'set_environment_access_route'), false);
    await settings.click();
    await dialog.getByRole('tab', { name: i18n.t('settings.connectionTab'), exact: true }).click();
    assert.equal(await dialog.getByRole('radio').first().isChecked(), true, 'Cancel retains saved default');
    await page.evaluate(snapshot => {
      window.settingsFixture.actionResult = request => {
        if (request.kind !== 'set_environment_access_route') return;
        window.settingsFixture.publish({ ...snapshot, environments: snapshot.environments.map(entry => entry.access_routes ? { ...entry, default_access_route_id: request.route_id } : entry) });
        return { ok: true, outcome: 'saved_environment' };
      };
    }, snapshot);
    await dialog.getByRole('radio').nth(1).check();
    await dialog.getByRole('button', { name: i18n.t('gatewayAccess.saveDefault'), exact: true }).click();
    await page.waitForFunction(() => window.settingsFixture.requests.some(r => r.kind === 'set_environment_access_route'));
    for (const [width, dark, large] of [[1280, false, false], [430, true, true]]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, dark);
      await page.evaluate(large => { document.documentElement.style.fontSize = large ? '20px' : '16px'; }, large);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${locale}: settings fit`);
      for (const button of await dialog.getByRole('button').all()) assert.equal(await button.evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
      await page.screenshot({ path: `${output}/${locale}-${width}-settings.png` });
    }
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await owner.locator('.redeven-split-action-primary button').first().click();
    requests = await page.evaluate(() => window.settingsFixture.requests);
    assert.equal(requests.at(-1).kind, 'open_gateway_environment');
    assert.equal(requests.at(-1).access_mode, 'gateway_proxy');
    await card.getByRole('tab').nth(1).click();
    await card.locator('[data-owner-role="cloud"] .redeven-split-action-primary button').first().click();
    requests = await page.evaluate(() => window.settingsFixture.requests);
    assert.equal(requests.at(-1).kind, 'open_provider_environment', 'Cloud retains its own route');
    await page.screenshot({ path: `${output}/${locale}-cloud.png` });
    await page.getByRole('button', { name: i18n.t('environmentCenter.gatewaysSection'), exact: true }).click();
    const gatewayCard = page.locator(`[data-gateway-id="${gateway.gateway_id}"]`);
    await gatewayCard.locator('.redeven-gateway-card__count').click();
    const row = gatewayCard.locator('[data-gateway-environment-id]');
    await row.getByRole('button', { name: i18n.t('environmentCenter.removeLabel', { label: gateway.label }), exact: true }).click();
    const remove = dialog.getByRole('button', { name: i18n.t('confirm.deleteGatewayEnvironmentConfirm'), exact: true });
    assert.equal(await remove.isDisabled(), true, 'deleting the default requires an explicit replacement');
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: `${output}/${locale}-delete-default.png` });
    await dialog.getByRole('radio').first().check();
    await remove.click();
    requests = await page.evaluate(() => window.settingsFixture.requests);
    assert.equal(requests.at(-1).kind, 'delete_environment_registration');
    assert.equal(requests.at(-1).replacement_route_id, `${runtime.id}:direct`);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: i18n.t('environmentCenter.environmentsSection'), exact: true }).click();
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), readOnly);
    await page.locator('[data-environment-group]:visible').getByRole('button', { name: i18n.t('environmentCenter.settingsForLabel', { label: gateway.label }), exact: true }).click();
    assert.equal(await dialog.getByRole('radio').count(), 2, 'read-only Gateway permits local default selection');
    assert.equal(await dialog.locator('#environment-label').count(), 0, 'shared profile stays read-only');
    assert.equal(await dialog.getByRole('button', { name: i18n.t('settings.manageCloud'), exact: true }).count(), 0);
    await dialog.getByText(i18n.t('gatewayAccess.writePermission'), { exact: true }).waitFor();
    report.cases.push(`${locale}: verified grouping, two owner tabs, explicit route, cancel/save default, Cloud ownership, narrow dark large text`);
    await context.close();
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
console.log(JSON.stringify(report, null, 2));
