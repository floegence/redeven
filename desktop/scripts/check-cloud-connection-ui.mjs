import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/cloud-connection-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
let currentPage;
try {
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/mixedEnvironmentFixture.ts', import.meta.url)));
  const { createDesktopI18n, listDesktopI18nLocales } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/desktopI18n.ts', import.meta.url)));
  const { snapshot } = mixedEnvironmentFixture();
  const runtime = snapshot.environments.find(entry => entry.kind === 'local_environment');
  const cloud = snapshot.environments.find(entry => entry.env_public_id === 'env_0_0');
  function failedSnapshot(recovery = 'waiting_for_service', code = 'provider_connection_failed') {
    const next = structuredClone(snapshot);
    const local = next.environments.find(entry => entry.id === runtime.id);
    Object.assign(local.provider_runtime_link_target, {
      provider_connection_state: 'authorization_required', can_connect_provider: true,
      credential_recovery: recovery,
      credential_recovery_details: { last_error_code: code, last_attempt_at_unix_ms: 1_800_000_000_000,
        next_retry_at_unix_ms: recovery === 'waiting_for_service' ? 1_800_000_060_000 : undefined, attempt_count: 3 },
    });
    if (code === 'CONTROL_CREDENTIALS_EXPIRED') local.provider_runtime_link_target.provider_link_binding.last_error_code = code;
    const remote = next.environments.find(entry => entry.id === cloud.id);
    Object.assign(remote, { remote_route_state: 'offline', control_plane_sync_state: recovery === 'sign_in_required' ? 'auth_required' : 'ready' });
    return next;
  }
  for (const locale of listDesktopI18nLocales()) {
    const i18n = createDesktopI18n(locale);
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    currentPage = page;
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
    const pair = page.locator('[data-environment-group]').filter({ has: page.locator('[role="tablist"]') });
    const status = (role = 'cloud') => pair.locator(`[data-owner-role="${role}"] [data-cloud-connection-status]`);
    const details = page.locator('[data-cloud-connection-details]');
    const openDetails = async (role = 'cloud') => {
      await status(role).locator('[aria-haspopup="dialog"]').click();
      await details.waitFor();
    };
    const publish = async next => {
      await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), next);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const geometry = () => page.locator('[data-environment-group]').evaluateAll(cards => cards.map(card => {
      const box = card.getBoundingClientRect();
      const owner = [...card.querySelectorAll('[data-owner-id]')].find(el => !el.closest('[aria-hidden="true"]'));
      const origin = card.closest('.redeven-environment-library').getBoundingClientRect();
      return [box.x - origin.x, box.y - origin.y, box.width, box.height, owner.querySelector('.redeven-environment-owner-footer').getBoundingClientRect().y - origin.y];
    }));
    const sameGeometry = (before, after, label) => {
      assert.equal(after.length, before.length, label);
      before.forEach((box, index) => box.forEach((value, axis) => assert.ok(Math.abs(value - after[index][axis]) < 1, `${locale}: ${label} card ${index}, axis ${axis}`)));
    };
    await pair.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const healthyGeometry = await geometry();
    await publish(failedSnapshot());
    await status('runtime').getByText(i18n.t('providerRecovery.waitingShort'), { exact: true }).waitFor();
    sameGeometry(healthyGeometry, await geometry(), 'failure preserves the grid');
    assert.ok((await status('runtime').boundingBox()).height <= 32, 'Cloud recovery occupies one compact fact row');
    const cloudTab = pair.getByRole('tab').nth(1);
    assert.ok(await cloudTab.evaluate(tab => {
      const dot = tab.querySelector('.redeven-owner-tab-status').getBoundingClientRect();
      const icon = tab.querySelector('.redeven-owner-tab-icon > svg').getBoundingClientRect();
      return dot.left > icon.right && dot.right <= tab.getBoundingClientRect().right;
    }), 'warning dot trails the Cloud label without covering its icon');
    await cloudTab.click();
    sameGeometry(healthyGeometry, await geometry(), 'perspective switch preserves the grid');
    await openDetails();
    sameGeometry(healthyGeometry, await geometry(), 'details do not expand cards');
    assert.ok((await details.innerText()).includes(i18n.t('providerRecovery.localAvailable')));
    await details.getByRole('button', { name: i18n.t('providerRecovery.openLocally'), exact: true }).click();
    await page.waitForFunction(id => window.settingsFixture.requests.some(request => request.kind === 'open_local_environment' && request.environment_id === id), runtime.id);
    await details.waitFor({ state: 'detached' });
    await cloudTab.click();
    await status().getByRole('button', { name: i18n.t('providerRecovery.restoreAction'), exact: true }).click();
    assert.equal(await pair.getByRole('tab').nth(0).getAttribute('aria-selected'), 'true', 'restore selects the exact Runtime owner');
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.ok((await dialog.innerText()).includes(runtime.label), 'restore reviews the original Runtime');
    assert.equal(await page.evaluate(() => window.settingsFixture.requests.some(request => request.kind === 'connect_provider_runtime')), false);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await cloudTab.click();
    await openDetails();
    await details.locator('summary').click();
    await details.getByText('provider_connection_failed', { exact: true }).waitFor();
    assert.ok((await details.innerText()).includes(i18n.t('providerRecovery.nextCheck')));
    await details.getByRole('button', { name: i18n.t('providerRecovery.openLocally'), exact: true }).focus();
    await details.evaluate(el => { window.connectionDetailsNode = el; window.connectionDetailsFocus = document.activeElement; });
    await publish(failedSnapshot());
    assert.ok(await details.evaluate(el => el === window.connectionDetailsNode && document.activeElement === window.connectionDetailsFocus && el.querySelector('details').open), 'snapshot retains diagnostics, DOM and focus');
    await page.keyboard.press('Escape'); await details.waitFor({ state: 'detached' });
    assert.ok(await status().locator('[aria-haspopup="dialog"]').evaluate(el => el === document.activeElement), 'Escape restores status focus');
    await openDetails();
    await pair.getByRole('tab').nth(0).focus();
    await pair.getByRole('tab').nth(0).press('Enter');
    await details.waitFor({ state: 'detached' });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
      assert.equal(await page.locator('html').getAttribute('data-floe-shell-theme'), theme === 'dark' ? 'porcelain-dark' : 'porcelain-light');
      await pair.screenshot({ path: `${output}/${locale}-${theme}-desktop.png`, animations: 'disabled' });
      if (locale === 'en-US' || locale === 'zh-CN') await page.screenshot({ path: `${output}/${locale}-${theme}-grid.png`, fullPage: true });
    }
    await publish(failedSnapshot('authorization_required', 'CONTROL_CREDENTIALS_EXPIRED'));
    await status('runtime').getByText(i18n.t('providerRecovery.expired'), { exact: true }).waitFor();
    assert.equal(await status('runtime').locator('.redeven-cloud-connection-action').count(), 1);
    sameGeometry(healthyGeometry, await geometry(), 'expired credentials preserve the grid');
    if (locale === 'en-US' || locale === 'zh-CN') {
      await page.screenshot({ path: `${output}/${locale}-expired-grid.png`, fullPage: true });
      await openDetails('runtime');
      await details.locator('summary').click();
      await page.screenshot({ path: `${output}/${locale}-expired-details.png`, fullPage: true });
      await page.keyboard.press('Escape'); await details.waitFor({ state: 'detached' });
    }
    await publish(failedSnapshot());
    await cloudTab.click();
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
      await page.evaluate(() => document.fonts.ready);
      await status().scrollIntoViewIfNeeded();
      const before = await geometry();
      await openDetails();
      await details.locator('summary').click();
      sameGeometry(before, await geometry(), 'enlarged-text details preserve the grid');
      const overflow = await status().evaluate(el => [...el.querySelectorAll('button')].filter(button => {
        const bounds = el.getBoundingClientRect(), box = button.getBoundingClientRect();
        return box.right > bounds.right + 1 || box.left < bounds.left - 1
          || (button.classList.contains('redeven-cloud-connection-action') && button.scrollWidth > button.clientWidth + 1);
      }).map(button => button.textContent));
      assert.deepEqual(overflow, [], `${locale}: recovery controls fit ${width}px enlarged text`);
      const bounds = await details.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 901, `${locale}: details stay inside viewport`);
      assert.ok(await details.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${locale}: diagnostics do not overflow`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${output}/${locale}-${width}-details.png`, fullPage: true });
      await page.keyboard.press('Escape'); await details.waitFor({ state: 'detached' });
      await pair.screenshot({ path: `${output}/${locale}-${width}.png`, animations: 'disabled' });
    }
    await openDetails();
    const beforeStates = await geometry();
    for (const [state, code, key] of [
      ['restoring', '', 'restoringDetail'],
      ['permission_required', 'forbidden', 'permissionDetail'],
      ['binding_changed', 'PROVIDER_LINK_BINDING_CHANGED', 'bindingDetail'],
      ['attention', 'provider_tls_untrusted', 'tlsDetail'],
    ]) {
      await publish(failedSnapshot(state, code));
      await details.getByText(i18n.t(`providerRecovery.${key}`), { exact: true }).waitFor();
      sameGeometry(beforeStates, await geometry(), `${state} preserves the grid`);
      assert.equal(await status().getByRole('button', { name: i18n.t('providerRecovery.restoreAction'), exact: true }).count(), 0);
      assert.equal(await details.getByRole('button', { name: i18n.t('providerRecovery.restoreShort'), exact: true }).count(), 0);
      assert.equal(await details.getByRole('button', { name: i18n.t('providerRecovery.openLocally'), exact: true }).count(), 1);
    }
    await page.keyboard.press('Escape'); await details.waitFor({ state: 'detached' });
    await publish(failedSnapshot('sign_in_required', 'authorization_expired'));
    await status().getByRole('button', { name: i18n.t('providerRecovery.signInAction'), exact: true }).click();
    await page.waitForFunction(origin => window.settingsFixture.requests.some(request => request.kind === 'start_control_plane_connect' && request.provider_origin === origin), cloud.provider_origin);
    await publish(snapshot);
    await status().getByText(i18n.t('providerRecovery.connected'), { exact: true }).waitFor();
    assert.equal(await status().locator('.redeven-cloud-connection-action').count(), 0, 'recovered connection removes recovery actions');
    assert.equal(await cloudTab.locator('.redeven-owner-tab-status').count(), 0, 'recovered connection removes the warning dot');
    await openDetails();
    await details.getByText(i18n.t('providerRecovery.connectedDetail'), { exact: true }).waitFor();
    await publish({ ...snapshot, environments: snapshot.environments.filter(entry => entry.id !== runtime.id) });
    await details.waitFor({ state: 'detached' });
    report.cases.push(`${locale}:compact-grid-trailing-dot-exact-owner-review-local-open-stable-diagnostics-focus-terminal-states-sign-in-recovered-narrow-large-text`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = String(error?.stack || error);
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
    report.visibleState = await currentPage.locator('[data-cloud-connection-status]').evaluateAll(elements => elements.map(el => ({
      text: el.textContent, html: el.outerHTML, owner: el.closest('[data-owner-id]')?.outerHTML.slice(0, 500),
      visibility: getComputedStyle(el).visibility, bounds: el.getBoundingClientRect().toJSON(),
    })));
  }
  throw error;
}
finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); await server.close();
}
console.log(JSON.stringify(report, null, 2));
