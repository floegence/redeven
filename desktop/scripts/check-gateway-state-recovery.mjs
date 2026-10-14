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
    const failed = { ...source.gateway_sources[0], gateway_id: 'failed-gateway', display_name: 'Failed Gateway',
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
          action_progress: [{ action: 'start_gateway', gateway_id: failed.gateway_id, subject_kind: 'gateway', subject_id: failed.gateway_id,
            operation_key: `${failed.gateway_id}:start_gateway`, started_at_unix_ms: Date.now(), updated_at_unix_ms: Date.now(),
            status: 'failed', phase: 'starting_gateway', title: 'Start Gateway', detail: failed.service_state.message,
            failure: { code: 'operation_failed', severity: 'error', title: 'Start Gateway', summary: failed.service_state.message } }] });
        return { ok: false, scope: 'gateway', code: 'gateway_reinstall_required', message: failed.service_state.message,
          gateway_diagnosis: diagnosis, should_refresh_snapshot: true };
      };
    }, { snapshot, failed });
    await card.locator('.redeven-gateway-card__primary-button').click();
    const panel = page.locator('.redeven-gateway-action-popover-surface');
    await panel.getByText(i18n.t('environmentCenter.gatewayGuidanceHostMaintenanceTitle'), { exact: true }).waitFor();
    await panel.getByText(i18n.t('environmentCenter.gatewayGuidanceStateRecoveryDetail'), { exact: true }).waitFor();
    const disable = panel.getByRole('button', { name: i18n.t('environmentCenter.gatewayActionDisable'), exact: true });
    assert.equal(await disable.evaluate(el => getComputedStyle(el).cursor), 'pointer');
    for (const key of ['gatewayActionStart', 'gatewayActionRestart', 'gatewayActionUpdate']) {
      assert.equal(await panel.getByRole('button', { name: i18n.t(`environmentCenter.${key}`), exact: true }).count(), 0);
    }
    await panel.evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
    });
    await page.screenshot({ path: `${output}/maintenance-${locale}.png` });
    await disable.click();
    assert.equal(await page.evaluate(() => window.settingsFixture.requests.filter(r => r.kind === 'set_gateway_enabled' && !r.enabled).length), 1);
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    assert.ok(await page.locator('[data-gateway-id]').count() > 1, 'Other Gateways remain reachable in the list');
    const repaired = { ...failed, service_state: { status: 'not_started', can_start: true, can_stop: false,
      can_restart: false, can_update: false, can_pair_after_start: true } };
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), { ...snapshot, gateway_sources: [repaired, ...source.gateway_sources] });
    await card.getByRole('button', { name: i18n.t('environmentCenter.gatewayActionStart'), exact: true }).waitFor();
    report.cases.push({ locale, width, maintenanceGuidance: true, disable: true, dismiss: true, otherGatewaysAvailable: true, repairRestoresStart: true });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'passed', ...report }, null, 2));
  console.log('PASS Gateway state maintenance and recovery browser qualification');
} finally { await browser.close(); await server.close(); }
