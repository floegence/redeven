import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-cloud-acceptance/', import.meta.url));
const officialCloudOrigin = `https://${['redeven', 'com'].join('.')}`;
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['gateway-cloud.html']);
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
          return { ok: true, outcome: 'runtime_gateway_status', gateway_membership: {attachments:[],counts:{total:0,joined:0,connected:0,joining:0,removing:0},runtime_running:true,observed_at_unix_ms:Date.now()} };
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
    await dialog.getByLabel(i18n.t('gatewayJoin.code'), { exact: true }).waitFor();
    assert.equal(await dialog.locator('input').count(), 2, `${locale}: address and code inputs must be visible`);
    assert.equal(await dialog.locator('input[type="file"]').count(), 0);
    assert.equal(await dialog.getByRole('radio').count(), 0, 'Gateway enrollment does not change Cloud ownership');
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
          target_runtime_id: 'ssh:qualification', expires_at_unix_ms: Date.now() + 300_000,
        } };
        return { ok: true, outcome: 'runtime_gateway_status', gateway_membership: {attachments:[],counts:{total:0,joined:0,connected:0,joining:0,removing:0},runtime_running:true,observed_at_unix_ms:Date.now()} };
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
    assert.equal(await dialog.getByRole('radio').count(), 0);
    assert.equal(await dialog.getByRole('button', { name: i18n.t('gatewayJoin.confirmEnable'), exact: true }).isEnabled(), true);
    await captureDialog(page, `${locale}-existing-environment.png`);
    report.cases.push(`${locale}: verified preview leaves Cloud association unchanged`);
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(`Gateway independent join UI: ${report.cases.length} locales passed.`);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
