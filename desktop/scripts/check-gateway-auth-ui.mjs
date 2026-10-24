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
function mockActions(environment) {
  window.gatewayEnvironment = environment;
  window.gatewayRequests = [];
  window.gatewayConnected = false;
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
  const environment = runtimeGatewayAccessFixture('ssh', 'management_unavailable').environment;
  environment.label = 'udesk26';
  environment.managed_runtime_host_access.ssh.auth_mode = 'password';
  for (const [locale, width] of [...listDesktopI18nLocales().map(locale => [locale, 390]), ['zh-CN', 1280]]) {
    const i18n = createDesktopI18n(locale);
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(mockActions, environment);
    await page.goto(new URL('gateway-auth.html?locale=' + locale, server.resolvedUrls.local[0]).href);
    const dialog = page.getByRole('dialog');
    const button = key => dialog.getByRole('button', { name: i18n.t(key), exact: true });
    await button('gatewayJoin.connectAndContinue').click();
    const password = dialog.getByLabel(i18n.t('gatewayJoin.sshPassword'), { exact: true });
    await password.waitFor();
    assert.equal(await password.evaluate(el => el === document.activeElement), true);
    await password.fill('wrong'); await password.press('Enter');
    await dialog.getByText(i18n.t('gatewayJoin.sshAuthenticationFailed'), { exact: true }).waitFor();
    assert.equal(await password.inputValue(), '');
    assert.equal(await password.evaluate(el => el === document.activeElement), true);
    const layout = await dialog.evaluate(el => ({ width: el.getBoundingClientRect().width, overflow: el.scrollWidth - el.clientWidth }));
    assert.ok(layout.width <= width, locale + ': dialog exceeds viewport');
    assert.ok(layout.overflow <= 1, locale + ': horizontal overflow');
    if (['zh-CN', 'de-DE', 'en-US'].includes(locale)) await page.screenshot({ path: output + '/' + locale + '-' + width + '-authentication.png' });
    await password.fill(' fixture password '); await password.press('Enter');
    const address = dialog.getByLabel(i18n.t('gatewayJoin.address'), { exact: true });
    const invitation = dialog.getByLabel(i18n.t('gatewayJoin.code'), { exact: true });
    await address.waitFor(); await address.fill('https://office.example:7443'); await invitation.fill('retained-code');
    await page.evaluate(() => { window.gatewayConnected = false; });
    await button('gatewayJoin.verify').click(); await password.waitFor();
    assert.equal(await button('gatewayJoin.verify').isDisabled(), true);
    assert.equal(await address.inputValue(), 'https://office.example:7443'); assert.equal(await invitation.inputValue(), 'retained-code');
    await password.fill(' fixture password '); await password.press('Enter');
    await button('gatewayJoin.verify').click(); await button('gatewayJoin.confirmEnable').waitFor();
    assert.equal(await page.evaluate(() => window.gatewayRequests.some(request => request.operation === 'join')), false);
    await button('gatewayJoin.confirmEnable').click(); await dialog.waitFor({ state: 'hidden' });
    const requests = await page.evaluate(() => window.gatewayRequests);
    assert.equal(new Set(requests.map(request => request.connection_token)).size, 1);
    assert.equal(requests.at(-1).kind, 'close_runtime_gateway');
    assert.equal(requests.filter(request => request.operation === 'join').length, 1);
    assert.ok(requests.filter(request => request.ssh_password).every(request => request.operation === 'status'));
    await page.getByRole('button', { name: i18n.t('gatewayJoin.title'), exact: true }).click();
    await button('gatewayJoin.connectAndContinue').click(); await password.waitFor();
    assert.equal(await password.inputValue(), '');
    const reopened = await page.evaluate(() => window.gatewayRequests.at(-1));
    assert.ok(reopened.connection_token > requests[0].connection_token);
    await button('common.cancel').click(); await dialog.waitFor({ state: 'hidden' });
    report.cases.push({ locale, width, status: 'passed' }); await page.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close(); await server.close();
}
