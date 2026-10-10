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
    assert.equal(await dialog.getByText(i18n.t('gatewayJoin.codeHelp'), { exact: true }).count() > 0, true);
    assert.equal(await dialog.locator('input').count(), 2, `${locale}: address and code inputs must be visible`);
    assert.equal(await dialog.locator('input[type="file"]').count(), 0);
    assert.equal(await dialog.getByRole('radio').count(), 0, 'Cloud choice requires a verified preview');
    const inputs = dialog.locator('input');
    await inputs.nth(0).fill('https://gateway.internal:7443');
    await inputs.nth(1).fill('123456789ABCDEFGHJKMNPQRSTV');
    const verify = dialog.getByRole('button', { name: i18n.t('gatewayJoin.verify'), exact: true });
    await verify.click({ trial: true });
    assert.equal(await verify.evaluate(el => getComputedStyle(el).cursor), 'pointer');
    await verify.click();
    await page.waitForFunction(() => window.gatewayRequests.length === 2);
    await dialog.getByRole('alert').waitFor();
    assert.equal(await verify.isEnabled(), true, 'failure must retain retry');
    assert.equal(await inputs.nth(0).inputValue(), 'https://gateway.internal:7443', 'failure must preserve address');
    assert.equal(await inputs.nth(1).inputValue(), '123456789ABCDEFGHJKMNPQRSTV', 'failure must preserve code');
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
        if (request.operation === 'preview') return { ok: true, outcome: 'gateway_previewed', gateway_preview: {
          preview_id: 'p'.repeat(43), purpose: request.purpose, gateway_id: 'gateway-qualification', gateway_name: 'Office Gateway',
          target_runtime_id: 'ssh:qualification', expires_at_unix_ms: Date.now() + 300_000, existing_environment_id: 'environment-qualification',
        } };
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
    assert.equal(await dialog.getByRole('radio').count(), 0);
    await dialog.getByRole('textbox').nth(0).fill('https://gateway.internal:7443');
    await dialog.getByRole('textbox').nth(1).fill('123456789ABCDEFGHJKMNPQRSTV');
    await dialog.getByRole('button', { name: i18n.t('gatewayJoin.verify'), exact: true }).click();
    await dialog.getByText(i18n.t('gatewayJoin.verified'), { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('radio').count(), 2);
    assert.equal(await dialog.getByRole('button', { name: i18n.t('gatewayJoin.confirmEnable'), exact: true }).isDisabled(), true);
    await captureDialog(page, `${locale}-existing-environment.png`);
    report.cases.push(`${locale}: verified preview requires an explicit existing environment choice`);
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
    assert.equal(await dialog.getByText(i18n.t('gatewayCloud.nextStep'), { exact: true }).count(), 1, `${locale}: Cloud approval next step must be visible`);
    assert.equal(await dialog.getByText('namespace-acceptance', { exact: true }).count(), 0, `${locale}: internal Namespace ID must stay hidden`);
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
    const cloudDialogText = await dialog.innerText();
    assert.ok(cloudDialogText.includes(i18n.t('gatewayCloud.pending')), `${locale}: Cloud approval state must be visible`);
    assert.doesNotMatch(cloudDialogText, /namespace|命名空间|命名空間/iu, `${locale}: internal ownership terms must stay hidden`);
    assert.equal(await dialog.getByRole('button', { name: i18n.t('gatewayCloud.manage'), exact: true }).count(), 1, `${locale}: follow-up action must describe opening the Runtime in Cloud`);
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
