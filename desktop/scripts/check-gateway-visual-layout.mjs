import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-visual-layout/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['environment-settings.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
const locales = (process.env.REDEVEN_GATEWAY_QA_LOCALES || 'en-US,zh-CN,zh-TW,ja-JP,ko-KR,de-DE,es-ES,fr-FR,pt-BR,ru-RU').split(',');
const widths = (process.env.REDEVEN_GATEWAY_QA_WIDTHS || '390,430,768,1280').split(',').map(Number);
try {
  const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { createDesktopI18n } = await load('../src/shared/i18n/index.ts');
  const source = compactEnvironmentPreviewFixture().coverage;
  const gateway = { ...source.gateway_sources[0], display_name: 'Office Gateway', connection_kind: 'local_host', management_capability: 'managed_local_host',
    status: 'online', trust_state: 'paired', sync_state: 'ready', local_enabled: true,
    identity_fingerprint: 'SHA256:6d9f27c4e8093a1bdf6857eac23094f17ce932bd781c054a6f8b20195d4e7ac3',
    member_endpoints: [{ address: 'https://gateway.example.invalid:8443' }],
    permissions: { access: true, manage_members: true, configure_cloud: true },
    service_state: { status: 'ready', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } };
  const snapshot = { ...source, gateway_sources: [gateway], open_windows: [] };
  const scenarios = widths.map(width => ({ width, touch: false, largeText: false }));
  if (!process.env.REDEVEN_GATEWAY_QA_WIDTHS) scenarios.push({ width: 430, touch: true, largeText: false }, { width: 430, touch: false, largeText: true });
  for (const locale of locales) for (const { width, touch, largeText } of scenarios) {
    const dark = width === 430 || width === 1280;
    const caseID = locale + '-' + width + (touch ? '-touch' : largeText ? '-large-text' : '');
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    const i18n = createDesktopI18n(locale);
    try {
      await page.addInitScript(({ snapshot, locale }) => {
        window.settingsFixtureSnapshot = snapshot;
        const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
        window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
      }, { snapshot, locale });
      await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
      await page.evaluate(async ({ dark, largeText }) => {
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.classList.toggle('light', !dark);
        if (largeText) document.documentElement.style.fontSize = '20px';
        await document.fonts.ready;
      }, { dark, largeText });
      const button = (scope, key) => scope.getByRole('button', { name: i18n.t(key), exact: true });
      await button(page, 'environmentCenter.gatewaysSection').click();
      const card = page.locator('.redeven-gateway-card');
      await card.waitFor();
      await page.screenshot({ path: output + '/' + caseID + '-list.png', fullPage: true });
      const manage = await button(card, 'gatewayExperience.manage').boundingBox();
      const more = card.locator('[data-floe-dropdown-trigger]');
      const menu = await more.boundingBox();
      assert.ok(Math.abs(manage.height - menu.height) <= 1, 'Manage and More have equal target heights: ' + JSON.stringify({ manage, menu }));
      assert.ok(Math.abs(manage.y + manage.height / 2 - menu.y - menu.height / 2) <= 1, 'Manage and More share a centerline');
      const client = await button(card, 'gatewayExperience.connectClient').boundingBox();
      const runtime = await button(card, 'gatewayExperience.connectRuntime').boundingBox();
      assert.ok(Math.abs(client.height - runtime.height) <= 1 && Math.abs(client.width - runtime.width) <= 1, 'Peer enrollment actions have equal dimensions');
      assert.ok(Math.abs(client.y - runtime.y) <= 1, 'Peer enrollment actions remain together');
      if (touch) assert.ok(manage.height >= 44 && menu.height >= 44 && client.height >= 44, 'Touch targets are at least 44px');
      if (width >= 768) assert.ok(Math.abs(client.height - manage.height) <= 1, 'Single-line card controls share the same density');
      const bounds = await card.evaluate(element => ({ overflow: element.scrollWidth - element.clientWidth, right: element.getBoundingClientRect().right }));
      assert.ok(bounds.overflow <= 1 && bounds.right <= width, 'Card fits viewport');
      await more.focus(); await page.keyboard.press('Enter');
      await page.getByRole('menuitem').first().waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement?.matches('[data-floe-dropdown-trigger]'));
      assert.equal(await more.evaluate(element => element === document.activeElement), true, 'Menu restores focus');
      await button(card, 'gatewayExperience.manage').click();
      const workspace = page.locator('[data-gateway-management-page]');
      await workspace.waitFor();
      const trigger = workspace.locator('[data-floe-dropdown-trigger]');
      const triggerBounds = await trigger.boundingBox();
      assert.ok(Math.abs(triggerBounds.width - triggerBounds.height) <= 1 && triggerBounds.height >= manage.height, 'Management menu is a complete square control');
      await page.screenshot({ path: output + '/' + caseID + '-overview.png', fullPage: true });
      assert.equal(await workspace.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, 'Overview has no horizontal overflow');
      await button(workspace, 'gatewayExperience.allGateways').click();
      for (const variant of [
        { ...gateway, display_name: 'Office Gateway / International engineering and operations', connection_kind: 'ssh_host', endpoint_label: 'gateway-administration.example.invalid:2222' },
        { ...gateway, display_name: 'Office Gateway / Access only', connection_kind: 'url', management_capability: 'access_only', endpoint_label: 'https://gateway.example.invalid:8443', permissions: { access: true, manage_members: false, configure_cloud: false } },
        { ...gateway, local_enabled: false, status: 'offline' },
      ]) {
        await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), { ...snapshot, gateway_sources: [variant] });
        await card.waitFor();
        assert.equal(await card.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, 'Long names and connection states fit');
        const enrollments = card.locator('.redeven-gateway-enrollment-actions');
        assert.equal(await enrollments.count(), variant.connection_kind === 'url' ? 0 : 1, 'Access-only connections expose no administration actions');
        if (variant.local_enabled === false) assert.equal(await enrollments.locator('button:disabled').count(), 2, 'Disabled connections cannot enroll');
      }
      report.cases.push({ locale, width, dark, touch, largeText, manage, menu, client, runtime, connectionStates: 3 });
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
console.log(JSON.stringify({ cases: report.cases.length, output, errors: report.errors }));
