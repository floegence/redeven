import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-auth-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['gateway-auth.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
function mockActions({ environment, connected, gateways }) {
  window.gatewayEnvironment = environment;
  window.savedGateways = gateways;
  window.gatewayRequests = [];
  window.gatewayConnected = connected;
  window.redevenDesktopLauncher = { performAction: async request => {
    window.gatewayRequests.push(request);
    if (request.kind === 'close_runtime_gateway') { window.gatewayConnected = false; return { ok: true }; }
    if (request.operation === 'status' && request.ssh_password === ' fixture password ') window.gatewayConnected = true;
    if (!window.gatewayConnected) return { ok: false, gateway_error_code: 'SSH_AUTHENTICATION_REQUIRED' };
    if (request.operation === 'preview') return { ok: true, gateway_preview: {
      preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'office', gateway_name: 'Office Gateway',
      target_runtime_id: 'udesk26', expires_at_unix_ms: Date.now() + 600000,
    } };
    return { ok: true, gateway_membership: { joined: request.operation === 'join', phase: request.operation === 'join' ? 'joined' : 'not_joined' } };
  } };
}
try {
  const { createDesktopI18n, listDesktopI18nLocales } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/desktopI18n.ts', import.meta.url)));
  const { runtimeGatewayAccessFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/runtimeGatewayAccessFixture.ts', import.meta.url)));
  const { buildDesktopWelcomeSnapshot } = await server.ssrLoadModule(fileURLToPath(new URL('../src/main/desktopWelcomeState.ts', import.meta.url)));
  const fixture = runtimeGatewayAccessFixture('ssh');
  const saved = fixture.inputs.preferences.saved_runtime_targets[0];
  const target = { ...saved, ssh_password: '', ssh_password_configured: false,
    host_access: { ...saved.host_access, ssh: { ...saved.host_access.ssh, auth_mode: 'password' } } };
  const environment = buildDesktopWelcomeSnapshot({ ...fixture.inputs, managedRuntimePresenceByTargetID: {},
    preferences: { ...fixture.inputs.preferences, saved_runtime_targets: [target] },
    savedRuntimeTargetHealth: { [target.id]: { status: 'offline', source: 'ssh_runtime_probe', checked_at_unix_ms: Date.now(),
      freshness: 'fresh', offline_reason_code: 'auth_required', offline_reason: 'Waiting for SSH authentication.' } },
  }).environments.find(entry => entry.id === target.id);
  environment.label = 'udesk26';
  environment.managed_runtime_host_access.ssh.auth_mode = 'password';
  for (const [locale, width, connected] of [...listDesktopI18nLocales().map(locale => [locale, 390]), ['zh-CN', 1280]]
    .flatMap(([locale, width]) => [false, true].map(connected => [locale, width, connected]))) {
    const i18n = createDesktopI18n(locale);
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(mockActions, { environment, connected });
    await page.goto(new URL('gateway-auth.html?locale=' + locale, server.resolvedUrls.local[0]).href);
    const dialog = page.getByRole('dialog');
    const button = key => dialog.getByRole('button', { name: i18n.t(key), exact: true });
    const password = dialog.getByLabel(i18n.t('gatewayJoin.sshPassword'), { exact: true });
    await button('gatewayJoin.connectAndContinue').waitFor();
    assert.equal(await password.count(), 0);
    assert.equal(await button('gatewayJoin.connectAndContinue').isDisabled(), false);
    assert.equal(await page.evaluate(() => window.gatewayRequests.length), 0);
    await button('gatewayJoin.connectAndContinue').click();
    if (!connected) {
      await password.waitFor();
      assert.equal(await button('common.retry').isDisabled(), true);
      assert.equal(await page.evaluate(() => window.gatewayRequests.length), 1);
      assert.equal(await password.evaluate(el => el === document.activeElement), true);
      if (['zh-CN', 'de-DE', 'en-US'].includes(locale)) await page.screenshot({ path: output + '/' + locale + '-' + width + '-password-entry.png' });
      await password.fill('wrong'); await password.press('Enter');
      await dialog.getByText(i18n.t('gatewayJoin.sshAuthenticationFailed'), { exact: true }).waitFor();
      assert.equal(await password.inputValue(), '');
      assert.equal(await password.evaluate(el => el === document.activeElement), true);
      const layout = await dialog.evaluate(el => ({ width: el.getBoundingClientRect().width, overflow: el.scrollWidth - el.clientWidth }));
      assert.ok(layout.width <= width, locale + ': dialog exceeds viewport');
      assert.ok(layout.overflow <= 1, locale + ': horizontal overflow');
      if (['zh-CN', 'de-DE', 'en-US'].includes(locale)) await page.screenshot({ path: output + '/' + locale + '-' + width + '-authentication.png' });
      await password.fill(' fixture password '); await password.press('Enter');
    }
    const address = dialog.getByLabel(i18n.t('gatewayJoin.address'), { exact: true });
    const invitation = dialog.getByLabel(i18n.t('gatewayJoin.code'), { exact: true });
    await address.waitFor(); await address.fill('https://office.example:7443'); await invitation.fill('retained-code');
    if (connected) {
      assert.equal(await password.count(), 0);
      assert.equal(await page.evaluate(() => window.gatewayRequests.length), 1);
      assert.equal(await page.evaluate(() => window.gatewayRequests[0].ssh_password), undefined);
      if (locale === 'zh-CN') await page.screenshot({ path: output + '/' + locale + '-' + width + '-reused-connection.png' });
    }
    if (!connected) {
      await page.evaluate(() => { window.gatewayConnected = false; });
      await button('gatewayJoin.verify').click(); await password.waitFor();
      assert.equal(await button('gatewayJoin.verify').isDisabled(), true);
      assert.equal(await address.inputValue(), 'https://office.example:7443'); assert.equal(await invitation.inputValue(), 'retained-code');
      await password.fill(' fixture password '); await password.press('Enter');
    }
    await button('gatewayJoin.verify').click(); await button('gatewayJoin.confirmEnable').waitFor();
    assert.equal(await page.evaluate(() => window.gatewayRequests.some(request => request.operation === 'join')), false);
    await button('gatewayJoin.confirmEnable').click(); await dialog.waitFor({ state: 'hidden' });
    const requests = await page.evaluate(() => window.gatewayRequests);
    assert.equal(new Set(requests.map(request => request.connection_token)).size, 1);
    assert.equal(requests.at(-1).kind, 'close_runtime_gateway');
    assert.equal(requests.filter(request => request.operation === 'join').length, 1);
    assert.ok(requests.filter(request => request.ssh_password).every(request => request.operation === 'status'));
    if (connected) assert.equal(requests.some(request => request.ssh_password), false);
    await page.getByRole('button', { name: i18n.t('gatewayJoin.title'), exact: true }).click();
    await button('gatewayJoin.connectAndContinue').click();
    await password.waitFor();
    assert.equal(await password.inputValue(), '');
    await password.fill(' fixture password '); await password.press('Enter'); await address.waitFor();
    const reopened = await page.evaluate(() => window.gatewayRequests.at(-1));
    assert.ok(reopened.connection_token > requests[0].connection_token);
    await button('common.cancel').click(); await dialog.waitFor({ state: 'hidden' });
    report.cases.push({ locale, width, connected, status: 'passed' }); await page.close();
  }
  for (const [locale, width, theme, kind] of [
    ['zh-CN', 1280, 'dark', 'ssh_host'], ['zh-CN', 390, 'light', 'ssh_container'],
    ['zh-CN', 1280, 'light', 'url'], ['de-DE', 390, 'dark', 'url'],
  ]) {
    const i18n = createDesktopI18n(locale);
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => report.errors.push(error.message));
    const gateways = [{ gateway_id: 'saved-office', display_name: 'Office Gateway', local_enabled: true,
      connection_kind: kind, management_capability: 'access_only', capabilities: [], status: 'offline',
      trust_state: 'paired', listener_running: false, created_at_ms: 1, updated_at_ms: 1, environments: [],
      ...(kind === 'url' ? { gateway_url: 'https://office.example:7443/' }
        : { member_endpoints: [{ endpoint_id: 'public', address: 'https://office.example:7443', priority: 0, scope: 'public' }] }),
    }];
    await page.addInitScript(mockActions, { environment, connected: true, gateways });
    await page.goto(new URL(`gateway-auth.html?locale=${locale}&theme=${theme}`, server.resolvedUrls.local[0]).href);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: i18n.t('gatewayJoin.connectAndContinue'), exact: true }).click();
    const picker = dialog.getByRole('combobox', { name: i18n.t('gatewayDiscovery.savedGateway'), exact: true });
    await picker.waitFor();
    assert.equal(await picker.locator('option').count(), 2);
    await picker.selectOption('https://office.example:7443');
    const invitation = dialog.getByLabel(i18n.t('gatewayJoin.code'), { exact: true });
    assert.equal(await invitation.evaluate(el => el === document.activeElement), true);
    await invitation.fill('saved-gateway-invitation');
    const layout = await dialog.evaluate(el => ({ width: el.getBoundingClientRect().width, overflow: el.scrollWidth - el.clientWidth }));
    assert.ok(layout.width <= width - 16 && layout.overflow <= 1);
    await dialog.screenshot({ path: `${output}/${locale}-${width}-${theme}-saved-${kind}.png` });
    await dialog.getByRole('button', { name: i18n.t('gatewayJoin.verify'), exact: true }).click();
    await dialog.getByRole('button', { name: i18n.t('gatewayJoin.confirmEnable'), exact: true }).waitFor();
    const requests = await page.evaluate(() => window.gatewayRequests);
    assert.equal(requests.find(request => request.operation === 'preview').address, 'https://office.example:7443');
    assert.equal(requests.some(request => request.operation === 'join' || request.ssh_password), false);
    report.cases.push({ locale, width, theme, kind, savedGateway: true, status: 'passed' });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close(); await server.close();
}
