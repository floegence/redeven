import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-dialog-polish/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
async function checkDisclosure(detail, reducedMotion) {
  const frames = await detail.evaluate(async element => {
    const heights = [];
    const opening = !element.open;
    element.querySelector('summary').click();
    const started = performance.now();
    while (performance.now() - started < 280) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      heights.push(parseFloat(getComputedStyle(element, '::details-content').blockSize));
    }
    return { opening, heights };
  });
  assert.ok(frames.heights.every(Number.isFinite));
  const maximum = Math.max(...frames.heights);
  assert.ok(maximum > 0 || !frames.opening);
  if (!reducedMotion) assert.ok(frames.heights.some(height => height > 0.5 && height < maximum - 0.5), 'Disclosure has intermediate animation frames');
  else assert.equal(await detail.evaluate(element => getComputedStyle(element, '::details-content').transitionDuration), '0s');
  if (!frames.opening) assert.equal(frames.heights.at(-1), 0);
  return frames;
}
async function checkDialog(dialog, width) {
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.width <= width - 16);
  if (width > 1000) assert.ok(bounds.width >= 760, 'Desktop dialogs are comfortably wide');
  assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
}
async function capture(page, filename) {
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]');
    for (let parent = dialog; parent; parent = parent.parentElement) if (Number(getComputedStyle(parent).opacity) < .99) return false;
    return Boolean(dialog);
  });
  await page.screenshot({ path: `${output}/${filename}.png` });
}
try {
  const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { mixedEnvironmentFixture } = await load('../src/testSupport/mixedEnvironmentFixture.ts');
  const { catalogFixture } = await load('../src/testSupport/gatewayMembershipFixture.ts');
  const { createDesktopI18n } = await load('../src/shared/i18n/index.ts');
  const source = compactEnvironmentPreviewFixture().coverage;
  const gateway = { ...source.gateway_sources[0], display_name: 'Office Gateway', sync_state: 'ready',
    connection_kind: 'local_host', management_capability: 'managed_local_host',
    member_endpoints: [{ ...catalogFixture.gateway.member_endpoints[0], address: 'https://gateway-office.example.internal:7443' }],
    listener_addresses: [':7443'], listener_running: true, policy: catalogFixture.policy,
    permissions: catalogFixture.gateway.permissions, environments: [] };
  const mixed = mixedEnvironmentFixture().snapshot;
  const runtime = mixed.environments.find(entry => entry.kind === 'local_environment');
  runtime.runtime_service.capabilities.runtime_gateway = { supported: true };
  const snapshot = { ...mixed, gateway_sources: [gateway] };
  for (const locale of ['en-US', 'zh-CN']) {
    const i18n = createDesktopI18n(locale);
    for (const [width, reducedMotion] of [[1280, false], [430, false], [1280, true]]) {
      const context = await browser.newContext({ viewport: { width, height: 1050 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
      try {
        const page = await context.newPage();
        page.on('pageerror', error => report.errors.push(error.message));
        await page.addInitScript(({ snapshot, locale }) => {
          window.settingsFixtureSnapshot = snapshot;
          const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
          window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
        }, { snapshot, locale });
        await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
        await page.evaluate(() => {
          window.settingsFixture.actionResult = request => request.kind === 'manage_runtime_gateway'
            ? { ok: true, outcome: 'runtime_gateway_status', gateway_membership: { joined: false, existing_environment_id: 'env_current' } }
            : request.kind === 'inspect_gateway_cloud' ? { ok: true, outcome: 'gateway_cloud_inspected', gateway_cloud: { configured: false, state: 'unconfigured' } } : undefined;
        });
        await page.evaluate(() => document.fonts.ready);
        await page.getByRole('button', { name: i18n.t('environmentCenter.gatewaysSection'), exact: true }).click();
        const card = page.locator(`[data-gateway-id="${gateway.gateway_id}"]`);
        const more = card.getByRole('button', { name: i18n.t('environmentCenter.moreActionsForLabel', { label: gateway.display_name }), exact: true });
        await page.evaluate(({ snapshot, gateway }) => window.settingsFixture.publish({ ...snapshot, gateway_sources: [{ ...gateway, connection_kind: 'url', management_capability: 'access_only', capabilities: ['member_access'], permissions: { access: true, manage_members: false, configure_cloud: false } }] }), { snapshot, gateway });
        await more.click();
        assert.equal(await page.getByRole('menuitem', { name: i18n.t('gatewayMembers.grantAccess'), exact: true }).count(), 0);
        assert.equal(await page.getByRole('menuitem', { name: i18n.t('gatewayMembers.invite'), exact: true }).count(), 0);
        await page.getByRole('menuitem', { name: i18n.t('environmentCenter.gatewayActionOpenSettings'), exact: true }).click();
        let dialog = page.getByRole('dialog');
        await checkDialog(dialog, width);
        await dialog.locator('#gateway-pairing-code').waitFor();
        assert.equal(await dialog.locator('#gateway-pairing-code').count(), 1);
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), snapshot);
        assert.equal(await card.getByRole('button', { name: i18n.t('gatewayCloud.title'), exact: true }).count(), 1);
        await more.click();
        await page.getByRole('menuitem', { name: i18n.t('gatewayMembers.invite'), exact: true }).click();
        dialog = page.getByRole('dialog'); await checkDialog(dialog, width);
        const address = dialog.getByRole('textbox', { name: i18n.t('gatewayMembers.address'), exact: true });
        if (width > 1000) assert.ok((await address.boundingBox()).width > 600);
        assert.equal(await dialog.getByRole('spinbutton', { name: i18n.t('gatewayMembers.priority'), exact: true }).inputValue(), '0');
        const network = dialog.locator('.redeven-gateway-endpoint__options').getByRole('button', { name: i18n.t('gatewayMembers.scopeLAN'), exact: true });
        await network.click();
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), true, 'Select closes before its enclosing dialog');
        const policy = dialog.locator('details').filter({ has: page.locator('summary', { hasText: i18n.t('gatewayMembers.policy') }) }).first();
        await capture(page, `${locale}-${width}-${reducedMotion}-members-compact`);
        const policyOpening = await checkDisclosure(policy, reducedMotion);
        await capture(page, `${locale}-${width}-${reducedMotion}-members`);
        const policyClosing = await checkDisclosure(policy, reducedMotion);
        const listener = dialog.locator('details').filter({ has: page.locator('summary', { hasText: i18n.t('gatewayMembers.listenerAddress') }) }).first();
        await listener.locator('summary').focus(); await page.keyboard.press('Enter');
        assert.equal(await listener.getAttribute('open'), '');
        await page.keyboard.press('Enter'); assert.equal(await listener.getAttribute('open'), null);
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: i18n.t('environmentCenter.environmentsSection'), exact: true }).click();
        const owner = page.locator(`[data-owner-id="${runtime.id}"]`);
        await owner.getByRole('button', { name: i18n.t('environmentAction.runtimeActions'), exact: true }).click();
        await page.getByRole('menuitem', { name: i18n.t('gatewayJoin.menuAction'), exact: true }).click();
        dialog = page.getByRole('dialog'); await checkDialog(dialog, width);
        const chooser = dialog.getByRole('button', { name: i18n.t('gatewayJoin.importInvitation'), exact: true });
        await chooser.click();
        await page.getByRole('menuitem', { name: gateway.display_name, exact: true }).waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), true);
        const about = dialog.locator('details').filter({ has: page.locator('summary', { hasText: i18n.t('gatewayJoin.aboutConnection') }) }).first();
        await capture(page, `${locale}-${width}-${reducedMotion}-runtime-compact`);
        const aboutOpening = await checkDisclosure(about, reducedMotion);
        await capture(page, `${locale}-${width}-${reducedMotion}-runtime`);
        const aboutClosing = await checkDisclosure(about, reducedMotion);
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => window.settingsFixture.requests.some(request => ['upsert_gateway', 'update_gateway_policy', 'configure_gateway_cloud'].includes(request.kind))), false);
        report.cases.push({ locale, width, reducedMotion, policyOpening, policyClosing, aboutOpening, aboutClosing,
          singleSettingsEntry: true, labelledEndpoints: true, nestedSelectDismissal: true, keyboardDisclosure: true, unchangedPermissions: true });
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
console.log(`PASS Gateway dialog polish (${report.cases.length} cases)`);
