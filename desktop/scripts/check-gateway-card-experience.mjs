import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-card-experience/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
try {
  const { compactEnvironmentPreviewFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/compactEnvironmentPreviewFixture.ts', import.meta.url)));
  const { createDesktopI18n } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/index.ts', import.meta.url)));
  const { gatewayServiceStepProgress } = await server.ssrLoadModule(fileURLToPath(new URL('../src/main/gatewayServiceProgress.ts', import.meta.url)));
  const source = compactEnvironmentPreviewFixture().coverage;
  const i18n = createDesktopI18n('zh-CN');
  const writable = { ...source.gateway_sources[0], sync_state: 'ready' };
  const local = { ...writable, gateway_id: 'local-preview', display_name: 'Gateway-local', connection_kind: 'local_host',
    management_capability: 'managed_local_host', status: 'offline', trust_state: 'unpaired', capabilities: [], sync_state: 'idle',
    endpoint_label: 'This device', environments: [], service_state: { status: 'not_started', can_start: true, can_stop: false, can_restart: false, can_update: false, can_pair_after_start: true } };
  const readonly = { ...writable, gateway_id: 'readonly-preview', display_name: 'Shared Gateway', capabilities: ['env_catalog'], environments: [] };
  const snapshot = { ...source, platform_capabilities: { ...source.platform_capabilities, native_host_runtime: true },
    open_windows: [], environments: source.environments.filter(entry => entry.kind === 'gateway_environment'), gateway_sources: [local, writable, readonly] };
  for (const [width, dark, largeText] of [[1400, true, false], [1280, false, false], [430, true, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 1050 }, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'no-preference' });
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
    const card = page.locator('[data-gateway-id="local-preview"]');
    const library = page.locator('.redeven-gateway-library');
    await card.waitFor();
    assert.ok((await card.innerText()).includes(i18n.t('gatewayAccess.directoryPending')));
    assert.equal(await card.getByRole('button', { name: i18n.t('gatewayAccess.addEnvironment'), exact: true }).isDisabled(), true);
    assert.equal(await library.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    for (const button of await library.getByRole('button').all()) assert.equal(await button.evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
    await library.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)); });
    await page.screenshot({ path: `${output}/cards-${width}.png`, fullPage: true });

    // A delayed service event must still open progress; dismissing it must not cancel or resubmit.
    await page.evaluate(() => { window.settingsFixture.beforeAction = () => new Promise(resolve => { window.finishGatewayRequest = resolve; }); });
    await card.getByRole('button', { name: i18n.t('environmentCenter.gatewayActionStart'), exact: true }).click();
    await page.waitForFunction(() => typeof window.finishGatewayRequest === 'function');
    const startedAt = Date.now();
    const progress = { action: 'start_gateway', subject_kind: 'gateway', subject_id: 'local-preview', gateway_id: 'local-preview',
      operation_key: 'local-preview:start_gateway', started_at_unix_ms: startedAt, updated_at_unix_ms: startedAt,
      status: 'running', active_progress_surface: 'gateway', environment_label: 'Gateway-local', phase: 'starting_gateway', title: 'Start Gateway', title_key: 'environmentCenter.gatewayActionStart', cancelable: true,
      step_progress: gatewayServiceStepProgress(gatewayServiceStepProgress(undefined, 'checking_gateway_service'), 'starting_gateway') };
    await page.evaluate(({ snapshot, progress }) => window.settingsFixture.publish({ ...snapshot, action_progress: [progress] }), { snapshot, progress });
    const popover = page.locator('.redeven-gateway-action-popover-surface');
    await popover.waitFor();
    const trigger = card.locator('.redeven-gateway-card__primary-button');
    assert.equal(await trigger.getAttribute('data-floe-progress-shimmer'), 'surface');
    assert.notEqual(await popover.evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await popover.locator('.redeven-environment-progress__meter').count(), 0);
    assert.ok((await popover.innerText()).includes('Gateway-local'));
    assert.equal(await popover.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await popover.evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
    await page.screenshot({ path: `${output}/progress-${width}.png`, animations: 'allow' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.redeven-gateway-action-popover-surface.redeven-action-popover-surface--closing'));
    await popover.waitFor({ state: 'detached' });
    assert.equal(await trigger.getAttribute('data-floe-progress-shimmer'), 'surface');
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    await trigger.click(); await popover.waitFor();
    assert.equal(await page.evaluate(() => window.settingsFixture.requests.filter(r => r.kind === 'start_gateway').length), 1);
    await page.evaluate(({ snapshot, progress }) => {
      window.settingsFixture.publish({ ...snapshot, action_progress: [{ ...progress, status: 'failed',
        failure: { code: 'operation_failed', severity: 'error', title: 'Gateway', summary: 'Gateway is unavailable.', summary_key: 'gatewayAccess.unavailable' },
        step_progress: { ...progress.step_progress, steps: progress.step_progress.steps.map(s => s.status === 'running' ? { ...s, status: 'failed' } : s) } }] });
      window.settingsFixture.actionResult = () => ({ ok: false, scope: 'gateway', code: 'gateway_service_start_failed', message: 'Gateway is unavailable.' });
      window.finishGatewayRequest();
    }, { snapshot, progress });
    await page.waitForFunction(() => !document.querySelector('.redeven-gateway-card [data-floe-progress-shimmer="surface"]'));
    await page.screenshot({ path: `${output}/failure-${width}.png` });
    await page.keyboard.press('Escape'); await popover.waitFor({ state: 'detached' });

    await card.getByRole('button', { name: i18n.t('environmentCenter.moreActionsForLabel', { label: 'Gateway-local' }), exact: true }).click();
    const menu = page.locator('.redeven-gateway-menu');
    await menu.waitFor();
    assert.notEqual(await menu.evaluate(el => getComputedStyle(el).animationName), 'none');
    const menuItems = menu.locator('[role="menuitem"]:not([disabled])');
    await page.keyboard.press('End');
    assert.equal(await menuItems.last().evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await menuItems.first().evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('ArrowUp');
    assert.equal(await menuItems.last().evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Home');
    assert.equal(await menuItems.first().evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.redeven-gateway-menu--closing'));
    await menu.waitFor({ state: 'detached' });
    assert.equal(await card.getByRole('button', { name: i18n.t('environmentCenter.moreActionsForLabel', { label: 'Gateway-local' }), exact: true }).evaluate(el => document.activeElement === el), true);

    await card.getByRole('button', { name: i18n.t('environmentCenter.manageGatewayForLabel', { label: 'Gateway-local' }), exact: true }).click();
    const setup = page.getByRole('dialog');
    await setup.getByRole('button', { name: i18n.t('gatewayAccess.profileHelpLabel'), exact: true }).click();
    await setup.getByText(i18n.t('gatewayAccess.profileHelpBody'), { exact: true }).waitFor();
    assert.equal(await setup.getByRole('checkbox', { name: i18n.t('gatewayAccess.grantWrite'), exact: true }).isChecked(), false);
    await setup.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)); });
    await page.screenshot({ path: `${output}/permission-${width}.png` });
    await page.keyboard.press('Escape'); await setup.waitFor({ state: 'detached' });
    report.cases.push({ width, dark, largeText, delayedProgress: true, dismissWithoutCancel: true, reopensWithoutResubmit: true, menuMotion: true, permission: true });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'passed', ...report }, null, 2));
  console.log('PASS Gateway card interaction and motion qualification');
} finally { await browser.close(); await server.close(); }
