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
  for (const [width, dark, largeText] of [[1824, true, false], [1280, false, false], [430, true, true]]) {
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
    assert.equal(await card.locator('[data-gateway-mark]').count(), 1);
    assert.equal(await card.locator('.redeven-gateway-card__endpoint').count(), 0, 'Local host is identified once');
    await page.screenshot({ path: `${output}/cards-${width}.png`, fullPage: true });

    // Reproduce an update already in flight when a launcher snapshot arrives:
    // there is no card-local foreground yet, so the default button owns loading.
    const needsUpdate = { ...local, status: 'needs_update', trust_state: 'paired',
      service_state: { ...local.service_state, status: 'service_needs_update', can_start: false, can_update: true } };
    const updateSnapshot = { ...snapshot, gateway_sources: [needsUpdate, writable, readonly] };
    const backgroundUpdate = { action: 'update_gateway', subject_kind: 'gateway', subject_id: 'local-preview', gateway_id: 'local-preview',
      operation_key: 'local-preview:update_gateway', started_at_unix_ms: Date.now(), updated_at_unix_ms: Date.now(),
      status: 'running', phase: 'installing_gateway', title: 'Update Gateway', active_progress_surface: 'gateway',
      step_progress: gatewayServiceStepProgress(undefined, 'installing_gateway') };
    await page.evaluate(({ snapshot, progress }) => window.settingsFixture.publish({ ...snapshot, action_progress: [progress] }), { snapshot: updateSnapshot, progress: backgroundUpdate });
    const primary = card.locator('.redeven-gateway-card__primary-button');
    await page.waitForFunction(() => document.querySelector('.redeven-gateway-card__primary-button[aria-busy="true"]'));
    assert.equal(await primary.locator('svg').count(), 1, 'Background update must show one loading icon');
    assert.equal(await primary.getAttribute('data-floe-progress-shimmer'), 'surface');
    await page.screenshot({ path: `${output}/updating-${width}.png` });
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), snapshot);
    await page.waitForFunction(() => !document.querySelector('.redeven-gateway-card__primary-button[aria-busy="true"]'));

    // The desktop-width case exercises the actual update confirmation and progress.
    const isUpdate = width === 1824;
    const action = isUpdate ? 'update_gateway' : 'start_gateway';
    const actionKey = isUpdate ? 'environmentCenter.gatewayActionUpdate' : 'environmentCenter.gatewayActionStart';
    const workflowSnapshot = isUpdate ? updateSnapshot : snapshot;
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), workflowSnapshot);
    // A delayed service event must still open progress; dismissing it must not cancel or resubmit.
    await page.evaluate(() => { window.settingsFixture.beforeAction = () => new Promise(resolve => { window.finishGatewayRequest = resolve; }); });
    await card.getByRole('button', { name: i18n.t(actionKey), exact: true }).click();
    if (isUpdate) await page.locator('.redeven-gateway-action-popover-surface').getByRole('button', { name: i18n.t(actionKey), exact: true }).click();
    await page.waitForFunction(() => typeof window.finishGatewayRequest === 'function');
    const trigger = card.locator('.redeven-gateway-card__primary-button');
    assert.equal(await trigger.locator('svg').count(), 1, 'Admission must have a single icon, including the loading spinner');
    const startedAt = Date.now();
    const progress = { action, subject_kind: 'gateway', subject_id: 'local-preview', gateway_id: 'local-preview',
      operation_key: `local-preview:${action}`, started_at_unix_ms: startedAt, updated_at_unix_ms: startedAt,
      status: 'running', active_progress_surface: 'gateway', environment_label: 'Gateway-local', phase: 'preparing_gateway_package', title: isUpdate ? 'Update Gateway' : 'Start Gateway', title_key: actionKey, cancelable: true,
      step_progress: gatewayServiceStepProgress(gatewayServiceStepProgress(undefined, 'checking_gateway_service', 'running', startedAt), 'preparing_gateway_package', 'running', startedAt) };
    await page.evaluate(({ snapshot, progress }) => window.settingsFixture.publish({ ...snapshot, action_progress: [progress] }), { snapshot: workflowSnapshot, progress });
    const popover = page.locator('.redeven-gateway-action-popover-surface');
    await popover.waitFor();
    assert.equal(await trigger.locator('svg').count(), 1, 'Progress must retain one icon');
    assert.equal(await trigger.getAttribute('data-floe-progress-shimmer'), 'surface');
    assert.notEqual(await popover.evaluate(el => getComputedStyle(el).animationName), 'none');
    const meter = popover.getByRole('progressbar');
    await meter.waitFor();
    assert.equal(await meter.getAttribute('aria-valuenow'), null, 'Observed service phases must not invent a percentage');
    assert.notEqual(await meter.locator('span').evaluate(el => getComputedStyle(el).animationName), 'none');
    const elapsed = popover.locator('.redeven-environment-progress__elapsed');
    await elapsed.waitFor();
    assert.ok((await trigger.innerText()).includes(i18n.t(isUpdate ? 'progress.updatingEllipsis' : 'progress.startingEllipsis')));
    await page.clock.setFixedTime(startedAt + 65_000);
    await page.waitForFunction(text => document.querySelector('.redeven-environment-progress__elapsed')?.textContent === text, i18n.t('progress.operationElapsed', { seconds: 65 }));
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
    assert.equal(await page.evaluate(action => window.settingsFixture.requests.filter(r => r.kind === action).length, action), 1);
    assert.equal(await elapsed.innerText(), i18n.t('progress.operationElapsed', { seconds: 65 }), 'Reopening retains operation time');
    progress.phase = 'installing_gateway';
    progress.step_progress = gatewayServiceStepProgress(progress.step_progress, 'installing_gateway', 'running', startedAt + 65_000);
    await page.evaluate(({ snapshot, progress }) => window.settingsFixture.publish({ ...snapshot, action_progress: [progress] }), { snapshot: workflowSnapshot, progress });
    assert.equal(await elapsed.innerText(), i18n.t('progress.operationElapsed', { seconds: 65 }), 'Changing stage retains operation time');
    await page.evaluate(({ snapshot, progress }) => {
      window.settingsFixture.publish({ ...snapshot, action_progress: [{ ...progress, status: 'failed', updated_at_unix_ms: progress.started_at_unix_ms + 68_000,
        failure: { code: 'operation_failed', severity: 'error', title: 'Gateway', summary: 'Gateway is unavailable.', summary_key: 'gatewayAccess.unavailable' },
        step_progress: { ...progress.step_progress, steps: progress.step_progress.steps.map(s => s.status === 'running' ? { ...s, status: 'failed' } : s) } }] });
      window.settingsFixture.actionResult = () => ({ ok: false, scope: 'gateway', code: 'gateway_service_start_failed', message: 'Gateway is unavailable.' });
      window.finishGatewayRequest();
    }, { snapshot, progress });
    await page.waitForFunction(() => !document.querySelector('.redeven-gateway-card [data-floe-progress-shimmer="surface"]'));
    assert.equal(await meter.getAttribute('data-plan-state'), 'executing');
    assert.equal(await meter.locator('span').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await elapsed.innerText(), i18n.t('progress.operationElapsed', { seconds: 68 }));
    await page.clock.setFixedTime(startedAt + 100_000);
    await page.waitForTimeout(1100);
    assert.equal(await elapsed.innerText(), i18n.t('progress.operationElapsed', { seconds: 68 }), 'Terminal elapsed time is frozen');
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

    await card.getByRole('button', { name: i18n.t('environmentCenter.moreActionsForLabel', { label: 'Gateway-local' }), exact: true }).click();
    await page.getByRole('menuitem', { name: i18n.t('environmentCenter.gatewayActionOpenSettings'), exact: true }).click();
    const setup = page.getByRole('dialog');
    await setup.getByRole('button', { name: i18n.t('gatewayAccess.profileHelpLabel'), exact: true }).click();
    await setup.getByText(i18n.t('gatewayAccess.profileHelpBody'), { exact: true }).waitFor();
    assert.equal(await setup.getByRole('checkbox', { name: i18n.t('gatewayAccess.grantWrite'), exact: true }).isChecked(), false);
    await setup.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)); });
    await page.screenshot({ path: `${output}/permission-${width}.png` });
    await page.keyboard.press('Escape'); await setup.waitFor({ state: 'detached' });
    report.cases.push({ width, dark, largeText, action, delayedProgress: true, indeterminateMeter: true, elapsedAcrossStagesAndReopen: true, terminalElapsedFrozen: true, dismissWithoutCancel: true, reopensWithoutResubmit: true, menuMotion: true, permission: true });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'passed', ...report }, null, 2));
  console.log('PASS Gateway card interaction and motion qualification');
} finally { await browser.close(); await server.close(); }
