import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-state-recovery/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
try {
  const { compactEnvironmentPreviewFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/compactEnvironmentPreviewFixture.ts', import.meta.url)));
  const { createDesktopI18n } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/index.ts', import.meta.url)));
  for (const [locale, width] of [['en-US', 1280], ['zh-CN', 430]]) {
    const i18n = createDesktopI18n(locale);
    const source = compactEnvironmentPreviewFixture().coverage;
    const failed = { ...source.gateway_sources[0], connection_id: 'failed-gateway', display_name: 'Failed Gateway',
      connection_kind: 'local_host', management_capability: 'managed_local_host', local_enabled: true,
      status: 'pairing_required', trust_state: 'unpaired', sync_state: 'gateway_unreachable', environments: [], diagnosis: undefined,
      service_state: { status: 'needs_reinstall', can_start: false, can_stop: false, can_restart: false, can_update: false,
        can_pair_after_start: false, error_code: 'gateway_state_unsupported', message: 'members.json: unsupported schema_version 4; expected 5' } };
    const stopped = { ...failed, service_state: { status: 'not_started', can_start: true, can_stop: false, can_restart: false,
      can_update: false, can_pair_after_start: true } };
    const snapshot = { ...source, open_windows: [], action_progress: [], gateway_sources: [stopped, ...source.gateway_sources] };
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
    await page.getByRole('button', { name: i18n.t('environmentCenter.gatewaysSection'), exact: true }).click();
    const card = page.locator('[data-gateway-id="failed-gateway"]');
    await card.waitFor();
    await page.evaluate(({ snapshot, failed }) => {
      window.settingsFixture.actionResult = request => {
        if (request.kind !== 'start_gateway') return undefined;
        const diagnosis = { checked_at_unix_ms: Date.now(), manageable: true, classification: 'needs_reinstall',
          summary: 'Gateway requires host maintenance', detail: failed.service_state.message,
          service_state: failed.service_state, error_code: failed.service_state.error_code };
        window.settingsFixture.publish({ ...snapshot, gateway_sources: [{ ...failed, diagnosis }, ...snapshot.gateway_sources.slice(1)],
          action_progress: [{ action: 'start_gateway', connection_id: failed.connection_id, subject_kind: 'gateway', subject_id: failed.connection_id,
            operation_key: `${failed.connection_id}:start_gateway`, started_at_unix_ms: Date.now(), updated_at_unix_ms: Date.now(),
            status: 'failed', phase: 'starting_gateway', title: 'Start Gateway', detail: failed.service_state.message,
            active_progress_surface: 'gateway',
            step_progress: { active_step_id: 'starting_gateway', steps: [{ id: 'starting_gateway', label: 'Starting Gateway service',
              label_key: 'progress.startingGatewayService', status: 'failed', started_at_unix_ms: Date.now() }] },
            failure: { code: 'operation_failed', severity: 'error', title: 'Start Gateway', summary: failed.service_state.message } }] });
        return { ok: false, scope: 'gateway', code: 'gateway_reinstall_required', message: failed.service_state.message,
          gateway_diagnosis: diagnosis, should_refresh_snapshot: true };
      };
    }, { snapshot, failed });
    await card.locator('.redeven-gateway-card__primary-button').click();
    const panel = page.locator('.redeven-gateway-action-popover-surface');
    await panel.getByRole('button', { name: i18n.t('gatewayExperience.maintenance'), exact: true }).waitFor().catch(async error => {
      await writeFile(`${output}/failure-${locale}.txt`, await page.locator('body').innerText());
      await page.screenshot({ path: `${output}/failure-${locale}.png` });
      throw error;
    });
    for (const key of ['gatewayActionStart', 'gatewayActionRestart', 'gatewayActionUpdate']) {
      assert.equal(await panel.getByRole('button', { name: i18n.t(`environmentCenter.${key}`), exact: true }).count(), 0);
    }
    await panel.evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
    });
    await page.screenshot({ path: `${output}/maintenance-${locale}.png` });
    const beforeMaintenance = await page.evaluate(() => window.settingsFixture.requests.length);
    await panel.getByRole('button', { name: i18n.t('gatewayExperience.maintenance'), exact: true }).click();
    await panel.waitFor({ state: 'detached' });
    await page.locator('[aria-controls="gateway-management-maintenance"][aria-current="page"]').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'Managed unpaired maintenance must not open the connection editor');
    assert.equal(await page.evaluate(() => window.settingsFixture.requests.length), beforeMaintenance, 'Opening maintenance must not retry a failed operation');
    await page.getByRole('button', { name: i18n.t('gatewayMaintenance.reset'), exact: true }).click();
    const confirmation = page.getByRole('dialog');
    await confirmation.waitFor();
    assert.equal(await page.evaluate(() => window.settingsFixture.requests.some(request => request.reset_configuration)), false);
    await page.keyboard.press('Escape');
    await confirmation.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.settingsFixture.requests.some(request => request.reset_configuration)), false, 'Cancel must not rebuild configuration');
    await page.screenshot({ path: `${output}/recovery-${locale}.png` });
    await page.getByRole('button', { name: i18n.t('gatewayExperience.allGateways'), exact: true }).click();
    await card.getByRole('button', { name: i18n.t('environmentCenter.moreActionsForLabel', { label: failed.display_name }), exact: true }).click();
    const disable = page.getByRole('menuitem', { name: i18n.t('gatewayExperience.disableConnection'), exact: true });
    assert.equal(await disable.evaluate(el => getComputedStyle(el).cursor), 'pointer');
    await disable.click();
    await page.waitForFunction(() => window.settingsFixture.requests.some(r => r.kind === 'set_gateway_enabled' && !r.enabled));
    assert.equal(await page.evaluate(() => window.settingsFixture.requests.filter(r => r.kind === 'set_gateway_enabled' && !r.enabled).length), 1);
    assert.ok(await page.locator('[data-gateway-id]').count() > 1, 'Other Gateways remain reachable in the list');
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), { ...snapshot, gateway_sources: [{ ...failed, local_enabled: false }, ...source.gateway_sources] });
    await card.getByRole('button', { name: i18n.t('environmentCenter.moreActionsForLabel', { label: failed.display_name }), exact: true }).click();
    await page.getByRole('menuitem', { name: i18n.t('gatewayExperience.enableConnection'), exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: i18n.t('environmentCenter.gatewayActionEnable'), exact: true }).click();
    await page.waitForFunction(() => window.settingsFixture.requests.some(r => r.kind === 'set_gateway_enabled' && r.enabled));
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.settingsFixture.requests.filter(r => r.kind === 'start_gateway').length), 1, 'Recovery navigation never replays Start');
    const repaired = { ...failed, service_state: { status: 'not_started', can_start: true, can_stop: false,
      can_restart: false, can_update: false, can_pair_after_start: true } };
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), { ...snapshot, gateway_sources: [repaired, ...source.gateway_sources] });
    await card.getByRole('button', { name: i18n.t('environmentCenter.gatewayActionStart'), exact: true }).waitFor();
    report.cases.push({ locale, width, directMaintenance: true, noAutomaticReplay: true, resetCancellation: true, disableAndEnable: true, dismiss: true, otherGatewaysAvailable: true, repairRestoresStart: true });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'passed', ...report }, null, 2));
  console.log('PASS Gateway state maintenance and recovery browser qualification');
} finally { await browser.close(); await server.close(); }
