import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';
import { assertGatewayEnvironmentChoiceLayout } from './gateway-environment-choice-layout.mjs';

const output = fileURLToPath(new URL('../dist/gateway-environment-choice/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['environment-settings.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
const locales = (process.env.REDEVEN_GATEWAY_QA_LOCALES || 'en-US,zh-CN,zh-TW,ja-JP,ko-KR,de-DE,es-ES,fr-FR,pt-BR,ru-RU').split(',');
try {
  const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { runtimeGatewayAccessFixture } = await load('../src/testSupport/runtimeGatewayAccessFixture.ts');
  const { createDesktopI18n } = await load('../src/shared/i18n/index.ts');
  const source = compactEnvironmentPreviewFixture().coverage;
  const local = runtimeGatewayAccessFixture('local', 'ready').environment;
  const stopped = runtimeGatewayAccessFixture('ssh', 'stopped').environment;
  const gateway = { ...source.gateway_sources[0], display_name: 'Office Gateway', connection_kind: 'local_host', management_capability: 'managed_local_host',
    status: 'online', trust_state: 'paired', sync_state: 'ready', local_enabled: true, environments: [],
    permissions: { access: true, manage_attachments: true, manage_network: true },
    service_state: { status: 'ready', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } };
  for (const locale of locales) for (const viewport of [{ width: 390, height: 900 }, { width: 1280, height: 1050 }, { width: 568, height: 420, large: true }]) {
    for (const state of ['single', 'multiple', 'empty']) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.width === 390, reducedMotion: 'reduce' });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.errors.push(error.message));
      const name = `${locale}-${viewport.width}-${state}`;
      const environments = state === 'empty' ? [] : state === 'single' ? [local] : [local, stopped];
      try {
        await page.addInitScript(({ snapshot, locale }) => {
          window.settingsFixtureSnapshot = snapshot;
          const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
          window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
        }, { snapshot: { ...source, gateway_sources: [gateway], environments, open_windows: [] }, locale });
        await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href, { timeout: 60000 });
        if (viewport.large) await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
        const i18n = createDesktopI18n(locale);
        const button = (scope, key) => scope.getByRole('button', { name: i18n.t(key), exact: true });
        await button(page, 'environmentCenter.gatewaysSection').click();
        await button(page.locator('.redeven-gateway-card'), 'gatewayExperience.manage').click();
        const workspace = page.locator('[data-gateway-management-page]');
        await button(workspace.locator('[data-gateway-management-nav]'), 'gatewayClients.runtimes').click();
        await button(workspace, 'gatewayExperience.connectRuntime').click();
        const dialog = page.getByRole('dialog');
        await button(dialog, 'gatewayExperience.ownedRuntime').waitFor();
        const choices = await dialog.locator('.redeven-gateway-onboarding-choices > button').evaluateAll(buttons => buttons.map(button => {
          const outer = button.getBoundingClientRect(), text = button.querySelector('span').getBoundingClientRect();
          return { height: outer.height, textTop: text.top - outer.top, textBottom: outer.bottom - text.bottom, overflow: button.scrollWidth > button.clientWidth + 1 };
        }));
        assert.ok(choices.every(choice => choice.height >= 64 && choice.textTop >= 8 && choice.textBottom >= 8 && !choice.overflow), 'Enrollment choices must contain their text with padding: ' + JSON.stringify(choices));
        if (state === 'single') await page.screenshot({ path: `${output}/${name}-modes.png` });
        if (viewport.large && state === 'single') {
          await button(dialog, 'gatewayExperience.ownedRuntime').focus();
          await page.keyboard.press('Tab');
          const other = button(dialog, 'gatewayExperience.otherRuntime');
          assert.ok(await other.evaluate(element => element === document.activeElement));
          const optionBounds = await other.boundingBox(), panelBounds = await dialog.boundingBox();
          assert.ok(optionBounds.y >= panelBounds.y && optionBounds.y + optionBounds.height <= panelBounds.y + panelBounds.height + 1, 'Keyboard navigation must scroll the lower choice into view');
          await page.screenshot({ path: `${output}/${name}-modes-scrolled.png` });
          await page.keyboard.press('Enter');
          await dialog.locator('[data-gateway-invite-others]').waitFor();
          await button(dialog, 'gatewayJoin.back').click();
          await button(dialog, 'gatewayExperience.ownedRuntime').waitFor();
        }
        await button(dialog, 'gatewayExperience.ownedRuntime').click();
        await dialog.locator('[data-gateway-environment-choice]').waitFor();
        const layout = await assertGatewayEnvironmentChoiceLayout(dialog, { empty: state === 'empty' });
        await page.screenshot({ path: `${output}/${name}.png` });
        if (state === 'empty') {
          await dialog.getByText(i18n.t('gatewayExperience.noManagedEnvironments'), { exact: true }).waitFor();
          assert.equal(await dialog.locator('[data-floe-dropdown-trigger]').count(), 0, 'Empty state must not offer an inert selector');
        } else {
          const choice = dialog.locator('[data-gateway-environment-choice] [data-floe-dropdown-trigger]');
          await choice.focus(); await page.keyboard.press('Enter');
          const options = page.getByRole('menuitem');
          await options.first().waitFor();
          assert.equal(await options.count(), environments.length);
          await page.screenshot({ path: `${output}/${name}-menu.png` });
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => document.activeElement === document.querySelector('[data-gateway-environment-choice] [data-floe-dropdown-trigger]'));
          assert.ok(await choice.evaluate(element => element === document.activeElement), 'Escape returns focus to the selector');
          await choice.click();
          const target = environments.at(-1);
          await page.getByRole('menuitem').filter({ hasText: target.label }).click();
          await dialog.locator('.redeven-gateway-wizard-steps').waitFor();
          assert.equal(await dialog.locator('[data-gateway-environment-choice]').count(), 0);
          await button(dialog, target === stopped ? 'gatewayJoin.startAndContinue' : 'gatewayJoin.connectAndContinue').waitFor();
          assert.equal(await page.evaluate(() => window.settingsFixture.requests.some(request => /^(start|restart|update)_environment_runtime$/.test(request.kind))), false, 'Selecting a Runtime never mutates its lifecycle');
          await page.screenshot({ path: `${output}/${name}-selected.png` });
        }
        await button(dialog, 'common.cancel').click();
        await button(dialog, 'gatewayExperience.ownedRuntime').waitFor();
        await button(dialog, 'gatewayExperience.ownedRuntime').click();
        await assertGatewayEnvironmentChoiceLayout(dialog, { empty: state === 'empty' });
        await button(dialog, 'common.close').click();
        await button(dialog, 'gatewayExperience.ownedRuntime').waitFor();
        report.cases.push({ locale, viewport, state, choices, layout, keyboardAndReentry: true });
      } catch (error) {
        await page.screenshot({ path: `${output}/${name}-failure.png` });
        throw error;
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'passed', ...report }, null, 2));
  console.log(`PASS Gateway environment choice: ${report.cases.length} layout and interaction cases`);
} finally { await browser.close(); await server.close(); }
