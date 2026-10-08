import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-cloud-acceptance/', import.meta.url));
const officialCloudOrigin = `https://${['redeven', 'com'].join('.')}`;
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['gateway-cloud.html', 'gateway-cloud-panel.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
async function captureDialog(page, filename) {
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]');
    for (let ancestor = dialog; ancestor; ancestor = ancestor.parentElement) {
      if (Number(getComputedStyle(ancestor).opacity) < 0.99) return false;
    }
    return Boolean(dialog);
  });
  await page.screenshot({ path: `${output}/${filename}` });
}
try {
  const { createDesktopI18n, listDesktopI18nLocales } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/desktopI18n.ts', import.meta.url)));
  for (const locale of listDesktopI18nLocales()) {
    const i18n = createDesktopI18n(locale);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(() => {
      window.gatewayRequests = [];
      window.redevenDesktopLauncher = { performAction: async request => {
        window.gatewayRequests.push({ kind: request.kind, runtime_target_id: request.runtime_target_id, operation: request.operation });
        if (request.operation === 'status') {
          return { ok: true, outcome: 'runtime_gateway_status', gateway_membership: { joined: false } };
        }
        return { ok: false, code: 'GATEWAY_JOIN_FAILED' };
      } };
    });
    await page.goto(new URL(`gateway-cloud.html?locale=${locale}`, server.resolvedUrls.local[0]).href);
    const trigger = page.getByRole('button', { name: i18n.t('gatewayJoin.title'), exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await page.waitForFunction(() => window.gatewayRequests.length === 1);
    assert.deepEqual(await page.evaluate(() => window.gatewayRequests[0]), {
      kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:qualification', operation: 'status',
    }, 'opening must inspect membership without submitting consent');
    assert.ok((await dialog.innerText()).includes(i18n.t('gatewayMembership.not_joined')), `${locale}: missing membership phase must use a readable fallback`);
    assert.equal(await dialog.locator('details').evaluateAll(details => details.every(detail => !detail.open)), true, `${locale}: explanatory sections must start collapsed`);
    assert.equal(await dialog.getByRole('button', { name: i18n.t('gatewayJoin.chooseFile'), exact: true }).isVisible(), true, `${locale}: file selection must use a localized action`);
    const connectionDetails = dialog.locator('details').filter({ hasText: i18n.t('gatewayJoin.aboutConnection') }).first();
    await connectionDetails.locator('summary').click();
    assert.equal(await connectionDetails.evaluate(element => element.open), true, `${locale}: connection explanation must expand on demand`);
    await connectionDetails.locator('summary').click();
    assert.equal(await connectionDetails.evaluate(element => element.open), false, `${locale}: connection explanation must collapse again`);
    const material = { protocol_version: 'redeven-gateway-v5', gateway_id: 'gateway', gateway_name: 'Office Gateway', invitation_id: 'invitation', endpoints: [{ endpoint_id: 'lan', address: 'https://gateway.internal:7443', scope: 'lan', priority: 0 }], gateway_public_key: 'a'.repeat(43), gateway_tls_root_pem: '-----BEGIN CERTIFICATE-----\ntest', token: 'b'.repeat(43), signature: 'c'.repeat(86), issued_at_unix_ms: 1900000000000, expires_at_unix_ms: 1900000600000 };
    await dialog.locator('input[type=file]').setInputFiles({ name: 'join.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(material)) });
    const approve = dialog.getByRole('button', { name: i18n.t('gatewayJoin.approve'), exact: true });
    await approve.click({ trial: true });
    assert.equal(await approve.evaluate(el => getComputedStyle(el).cursor), 'pointer');
    await approve.click();
    await page.waitForFunction(() => window.gatewayRequests.length === 2);
    await dialog.getByRole('alert').waitFor();
    assert.equal(await approve.isEnabled(), true, 'failure must retain retry');
    assert.ok((await dialog.innerText()).includes(i18n.t('gatewayJoin.invitationReady')), 'failure must preserve selected material');
    assert.equal(await dialog.locator('details').evaluateAll(details => details.every(detail => !detail.open)), true, 'failure must keep technical connection details collapsed');
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'narrow dialog must fit');
    await captureDialog(page, `${locale}.png`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'cancel restores focus');
    report.cases.push(`${locale}: local consent, exact target, preserved retry, narrow layout and keyboard cancel`);
    await page.close();
  }
  {
    const locale = 'zh-CN';
    const i18n = createDesktopI18n(locale);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.gatewayRequests = [];
      window.redevenDesktopLauncher = { performAction: async request => {
        window.gatewayRequests.push(request);
        return { ok: true, outcome: 'runtime_gateway_status', gateway_membership: {
          joined: false, phase: 'not_joined', existing_environment_id: 'environment-qualification',
        } };
      } };
    });
    await page.goto(new URL(`gateway-cloud.html?locale=${locale}`, server.resolvedUrls.local[0]).href);
    const trigger = page.getByRole('button', { name: i18n.t('gatewayJoin.title'), exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await page.waitForFunction(() => window.gatewayRequests.length === 1);
    assert.equal(await dialog.getByRole('radio', { name: i18n.t('gatewayJoin.preserve'), exact: true }).isVisible(), true, 'existing environment choice must stay concise');
    assert.equal(await dialog.getByRole('radio', { name: i18n.t('gatewayJoin.createNew'), exact: true }).isVisible(), true, 'new environment choice must stay concise');
    assert.equal(await dialog.locator('details').evaluateAll(details => details.every(detail => !detail.open)), true, 'existing environment explanations must start collapsed');
    await captureDialog(page, `${locale}-existing-environment.png`);
    report.cases.push(`${locale}: existing environment choices remain concise with collapsed explanations`);
    await page.close();
  }
  for (const locale of listDesktopI18nLocales()) {
    const i18n = createDesktopI18n(locale);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(() => {
      window.gatewayRequests = [];
      window.openedGatewayURLs = [];
      window.redevenDesktopLauncher = { performAction: async request => {
        window.gatewayRequests.push(request);
        if (request.kind === 'inspect_gateway_cloud') {
          return { ok: true, outcome: 'gateway_cloud_inspected', gateway_cloud: { configured: false, state: 'unconfigured' } };
        }
        const origin = `https://${['redeven', 'com'].join('.')}`;
        return { ok: true, outcome: 'gateway_cloud_configured', gateway_cloud: {
          configured: true, state: 'pending', cloud_origin: origin,
          gateway_public_id: 'gateway-acceptance', namespace_public_id: 'namespace-acceptance',
          management_url: `${origin}/namespaces/namespace-acceptance/gateways/gateway-acceptance`,
        } };
      } };
      window.redevenDesktopShell = { openExternalURL: async url => {
        window.openedGatewayURLs.push(url);
        return { ok: true };
      } };
    });
    await page.goto(new URL(`gateway-cloud-panel.html?locale=${locale}`, server.resolvedUrls.local[0]).href);
    const trigger = page.getByRole('button', { name: i18n.t('gatewayCloud.title'), exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await page.waitForFunction(() => window.gatewayRequests.length === 1);
    assert.equal(await dialog.locator('input').count(), 0, `${locale}: Cloud address input must not be rendered`);
    assert.equal(await dialog.getByText(i18n.t('gatewayCloud.nextStep'), { exact: true }).count(), 1, `${locale}: Namespace next step must be visible`);
    const configure = dialog.getByRole('button', { name: i18n.t('gatewayCloud.configure'), exact: true });
    assert.equal(await configure.isEnabled(), true, `${locale}: configure action must be available without an address`);
    await configure.click();
    await page.waitForFunction(() => window.gatewayRequests.length === 2 && window.openedGatewayURLs.length === 1);
    assert.deepEqual(await page.evaluate(() => window.gatewayRequests[1]), {
      kind: 'configure_gateway_cloud', gateway_id: 'gateway-acceptance', configuration: {},
    }, `${locale}: renderer must submit intent only`);
    assert.deepEqual(await page.evaluate(() => window.openedGatewayURLs), [
      `${officialCloudOrigin}/namespaces/namespace-acceptance/gateways/gateway-acceptance`,
    ], `${locale}: configuration must open the Cloud management page`);
    assert.ok((await dialog.innerText()).includes(i18n.t('gatewayCloud.pending')), `${locale}: pending Namespace approval state must be visible`);
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${locale}: narrow dialog must fit`);
    await captureDialog(page, `${locale}-panel.png`);
    report.cases.push(`${locale}: fixed Cloud origin, no address input, Namespace approval and management handoff`);
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(`Gateway Cloud UI: ${report.cases.length} locales passed.`);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
