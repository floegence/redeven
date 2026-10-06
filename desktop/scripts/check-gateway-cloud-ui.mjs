import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-cloud-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['gateway-cloud.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
try {
  const { createDesktopI18n, listDesktopI18nLocales } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/desktopI18n.ts', import.meta.url)));
  for (const locale of listDesktopI18nLocales()) {
    const i18n = createDesktopI18n(locale);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(() => {
      window.gatewayRequests = [];
      window.redevenDesktopLauncher = { performAction: async request => {
        window.gatewayRequests.push({ kind: request.kind, runtime_target_id: request.runtime_target_id });
        return { ok: false, code: 'GATEWAY_JOIN_FAILED' };
      } };
    });
    await page.goto(new URL(`gateway-cloud.html?locale=${locale}`, server.resolvedUrls.local[0]).href);
    const trigger = page.getByRole('button', { name: i18n.t('gatewayJoin.title'), exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await page.evaluate(() => window.gatewayRequests.length), 0, 'opening must not submit consent');
    const material = { protocol_version: 1, cloud_origin: 'https://cloud.example', region_origin: 'https://sg.cloud.example', namespace_public_id: 'namespace', gateway_public_id: 'gateway', request_public_id: 'request', gateway_url: 'https://gateway.internal:7443', gateway_tls_root_pem: '-----BEGIN CERTIFICATE-----\ntest', join_token: 'a'.repeat(43), gateway_enrollment_token: 'b'.repeat(43), expires_at_unix_ms: 1900000000000 };
    await dialog.locator('input[type=file]').setInputFiles({ name: 'join.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(material)) });
    const approve = dialog.getByRole('button', { name: i18n.t('gatewayJoin.approve'), exact: true });
    await approve.click({ trial: true });
    assert.equal(await approve.evaluate(el => getComputedStyle(el).cursor), 'pointer');
    await approve.click();
    await page.waitForFunction(() => window.gatewayRequests.length === 1);
    await dialog.getByRole('alert').waitFor();
    assert.equal(await approve.isEnabled(), true, 'failure must retain retry');
    assert.ok((await dialog.innerText()).includes(material.gateway_url), 'failure must preserve selected material');
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'narrow dialog must fit');
    await page.screenshot({ path: `${output}/${locale}.png` });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'cancel restores focus');
    report.cases.push(`${locale}: local consent, exact target, preserved retry, narrow layout and keyboard cancel`);
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(`Gateway Cloud UI: ${report.cases.length} locales passed.`);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
