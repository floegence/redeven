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
    }, { snapshot: failedSnapshot(), locale });
    await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
    const pair = page.locator('[data-environment-group]').filter({ has: page.locator('[role="tablist"]') });
    const status = (role = 'cloud') => pair.locator(`[data-owner-role="${role}"] [data-cloud-connection-status]`);
    await pair.getByRole('tab').nth(1).click();
    await status().getByText(i18n.t('providerRecovery.waitingService'), { exact: false }).waitFor();
    assert.ok((await status().innerText()).includes(i18n.t('providerRecovery.localAvailable')));
    await status().getByRole('button', { name: i18n.t('providerRecovery.openLocally'), exact: true }).click();
    await page.waitForFunction(id => window.settingsFixture.requests.some(request => request.kind === 'open_local_environment' && request.environment_id === id), runtime.id);
    await pair.getByRole('tab').nth(0).click();
    await status('runtime').getByRole('button', { name: i18n.t('providerRecovery.restoreShort'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.ok((await dialog.innerText()).includes(runtime.label), 'restore reviews the original Runtime');
    assert.equal(await page.evaluate(() => window.settingsFixture.requests.some(request => request.kind === 'connect_provider_runtime')), false);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await pair.getByRole('tab').nth(1).click();
    await status().locator('summary').click();
    await status().getByText('provider_connection_failed', { exact: true }).waitFor();
    assert.ok((await status().innerText()).includes(i18n.t('providerRecovery.nextCheck')));
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.style.fontSize = '20px'; });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await status().evaluate(el => [...el.querySelectorAll('button,summary')].filter(button => {
        const bounds = el.getBoundingClientRect(), box = button.getBoundingClientRect();
        return box.right > bounds.right + 1 || box.left < bounds.left - 1 || button.scrollWidth > button.clientWidth + 1;
      }).map(button => button.textContent));
      assert.deepEqual(overflow, [], `${locale}: recovery actions fit ${width}px enlarged text`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await pair.screenshot({ path: `${output}/${locale}-${width}.png`, animations: 'disabled' });
    }
    for (const [state, code, key] of [
      ['restoring', '', 'restoringDetail'],
      ['permission_required', 'forbidden', 'permissionDetail'],
      ['binding_changed', 'PROVIDER_LINK_BINDING_CHANGED', 'bindingDetail'],
      ['attention', 'provider_tls_untrusted', 'tlsDetail'],
    ]) {
      await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), failedSnapshot(state, code));
      await status().getByText(i18n.t(`providerRecovery.${key}`), { exact: true }).waitFor();
      assert.equal(await status().getByRole('button', { name: i18n.t('providerRecovery.restoreShort'), exact: true }).count(), 0);
      assert.equal(await status().getByRole('button', { name: i18n.t('providerRecovery.openLocally'), exact: true }).count(), 1);
    }
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), failedSnapshot('sign_in_required', 'authorization_expired'));
    await status().getByRole('button', { name: i18n.t('environmentCenter.cloudSignInAgain'), exact: true }).click();
    await page.waitForFunction(origin => window.settingsFixture.requests.some(request => request.kind === 'start_control_plane_connect' && request.provider_origin === origin), cloud.provider_origin);
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), snapshot);
    await status().getByText(i18n.t('providerRecovery.connected'), { exact: false }).waitFor();
    assert.equal(await status().locator('details, button').count(), 0, 'recovered connection removes warning and recovery actions');
    report.cases.push(`${locale}:visible-reason-exact-owner-review-local-open-diagnostics-terminal-states-sign-in-recovered-narrow-large-text`);
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
