import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';
import { continuityLocales, continuityViewports, continuityBrowserContracts, assertContinuityBrowserCoverage } from '../../scripts/interaction_continuity_contract.mjs';
const output = fileURLToPath(new URL('../dist/interaction-continuity-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
try {
  const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
  const { runtimeGatewayBackgroundProbeFixture } = await load('../src/testSupport/runtimeGatewayBackgroundProbeFixture.ts');
  const { createDesktopI18n } = await load('../src/shared/i18n/index.ts');
  for (const locale of continuityLocales) for (const viewport of continuityViewports) {
    const i18n = createDesktopI18n(locale);
    const f = await runtimeGatewayBackgroundProbeFixture('ssh');
    const snapshot = f.snapshot();
    const context = await browser.newContext({ viewport, reducedMotion: viewport.width === 430 ? 'reduce' : 'no-preference' });
    try {
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning' && message.text().includes('will never be disposed')) report.errors.push(message.text()); });
      await page.addInitScript(({ snapshot, locale }) => {
        window.settingsFixtureSnapshot = snapshot;
        const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
        window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
      }, { snapshot, locale });
      const fixtureURL = new URL('environment-settings.html', server.resolvedUrls.local[0]).href;
      await page.goto(fixtureURL); await page.evaluate(() => document.fonts.ready);
      if (viewport.width === 430) await page.evaluate(() => { document.documentElement.style.fontSize = '19px'; });
      await page.evaluate(() => {
        window.settingsFixture.beforeAction = () => new Promise(resolve => { window.releaseAdmission = resolve; });
        window.settingsFixture.actionResult = () => ({ ok: false, message: 'Admission refused', code: 'action_invalid', scope: 'environment' });
      });
      const owner = page.locator('[data-owner-id]').first();
      const toggle = owner.getByRole('button', { name: i18n.t('environmentAction.runtimeActions'), exact: true });
      const menu = page.getByRole('menu');
      const openAction = async () => {
        await toggle.click();
        const target = menu.getByRole('menuitem').filter({ hasText: i18n.t('environmentAction.reinstallRedevenWipeData') }).first();
        await target.waitFor(); await target.click({ trial: true }); return target;
      };
      const target = await openAction(); await target.focus();
      const node = await target.elementHandle();
      const bounds = await target.boundingBox(); assert.ok(bounds);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
      await page.evaluate(value => window.settingsFixture.publish(value), structuredClone(snapshot));
      assert.equal(await target.evaluate((el, previous) => el === previous && document.activeElement === el, node), true);
      await page.mouse.up();
      const progress = page.locator('.redeven-environment-progress'); await progress.waitFor();
      assert.equal(await page.evaluate(() => window.settingsFixture.requests.length), 1);
      await page.evaluate(value => window.settingsFixture.publish(value), structuredClone(snapshot));
      assert.equal(await progress.count(), 1);
      await page.evaluate(() => window.releaseAdmission());
      await progress.getByRole('alert').waitFor();
      await progress.getByRole('button', { name: i18n.t('common.retry'), exact: true }).click();
      await page.waitForFunction(() => window.settingsFixture.requests.length === 2);
      await progress.getByRole('button', { name: i18n.t('common.close'), exact: true }).click();
      await progress.waitFor({ state: 'detached' });
      await page.evaluate(() => window.releaseAdmission());
      await page.evaluate(value => window.settingsFixture.publish(value), structuredClone(snapshot));
      assert.equal(await progress.count(), 0, 'late failure cannot reopen a closed operation');
      await (await openAction()).click(); await progress.waitFor();
      assert.equal(await progress.getByRole('alert').count(), 0, 'new attempt does not inherit the old failure');
      await page.evaluate(() => window.releaseAdmission()); await progress.getByRole('alert').waitFor();
      await page.keyboard.press('Escape'); await progress.waitFor({ state: 'detached' });
      await page.evaluate(() => {
        window.settingsFixture.beforeAction = undefined;
        window.settingsFixture.actionResult = request => request.kind === 'manage_runtime_gateway'
          ? { ok: true, gateway_membership: { joined: false, phase: 'not_joined' } } : undefined;
      });
      await toggle.click(); await menu.getByRole('menuitem', { name: i18n.t('gatewayJoin.menuAction'), exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      await dialog.getByRole('button', { name: i18n.t('gatewayJoin.connectAndContinue'), exact: true }).click();
      const input = dialog.locator('input').first(); await input.fill('https://office.example'); await input.focus();
      const inputNode = await input.elementHandle();
      await input.evaluate(el => { el.setSelectionRange(2, 8); el.dispatchEvent(new CompositionEvent('compositionstart', { data: '输入', bubbles: true })); });
      const check = f.beginProbe();
      await page.evaluate(value => window.settingsFixture.publish(value), check.checking);
      await page.evaluate(value => window.settingsFixture.publish(value), await check.finish());
      assert.deepEqual(await input.evaluate((el, previous) => [el === previous, document.activeElement === el, el.value, el.selectionStart, el.selectionEnd], inputNode), [true, true, 'https://office.example', 2, 8]);
      await input.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { data: '输入', bubbles: true })));
      await page.evaluate(value => window.settingsFixture.publish({ ...value, environments: [] }), snapshot);
      assert.equal(await dialog.count(), 1); assert.equal(await input.inputValue(), 'https://office.example');
      const cancel = dialog.getByRole('button', { name: i18n.t('common.cancel'), exact: true });
      await cancel.scrollIntoViewIfNeeded(); await cancel.click(); await dialog.waitFor({ state: 'detached' });
      await page.evaluate(value => window.settingsFixture.publish(value), snapshot);
      await owner.getByRole('button', { name: i18n.t('environmentCenter.settingsForLabel', { label: f.environment.label }), exact: true }).click();
      const settings = page.locator('.redeven-environment-settings-dialog'); await settings.waitFor();
      const name = settings.locator('#ssh-settings-label'); await name.fill('Unsubmitted connection'); await name.focus();
      const nameNode = await name.elementHandle();
      await name.evaluate(el => el.setSelectionRange(1, 7));
      const scroll = settings.locator('.environment-settings-scroll').first();
      const scrollTop = await scroll.evaluate(el => { el.scrollTop = 35; return el.scrollTop; });
      await page.evaluate(value => window.settingsFixture.publish(value), structuredClone(snapshot));
      assert.deepEqual(await name.evaluate((el, previous) => [el === previous, document.activeElement === el, el.value, el.selectionStart, el.selectionEnd], nameNode), [true, true, 'Unsubmitted connection', 1, 7]);
      assert.equal(await scroll.evaluate(el => el.scrollTop), scrollTop);
      await page.keyboard.press('Escape'); await settings.waitFor({ state: 'detached' });
      await page.goto(new URL('interaction-layers.html', server.resolvedUrls.local[0]).href);
      const parent = page.locator('.redeven-action-popover-surface'); await parent.waitFor();
      const draft = parent.getByRole('textbox', { name: 'Parent draft' }); await draft.fill('Retained parent');
      const retained = await draft.elementHandle();
      await parent.getByRole('button', { name: 'Open child' }).click();
      const child = page.getByRole('dialog', { name: 'Child dialog' }); await child.waitFor();
      await child.getByRole('textbox').fill('Retained child');
      await page.keyboard.press('Escape'); await child.waitFor({ state: 'detached' });
      assert.equal(await parent.count(), 1); assert.equal(await draft.inputValue(), 'Retained parent');
      const retiringState = await parent.evaluate(el => {
        window.continuityLayers.open(false);
        const state = [el.inert, el.getAttribute('aria-hidden')];
        // Keep reversal inside the exit window even when browser round trips are delayed.
        window.continuityLayers.open(true);
        return state;
      });
      assert.deepEqual(retiringState, [true, 'true']);
      assert.equal(await draft.evaluate((el, previous) => el === previous, retained), true);
      assert.equal(await draft.inputValue(), 'Retained parent');
      assert.equal(await page.evaluate(() => window.continuityLayers.exits), 0);
      const recovery = parent.getByRole('button', { name: 'Open child' }); await recovery.scrollIntoViewIfNeeded();
      const recoveryBounds = await recovery.boundingBox(); assert.ok(recoveryBounds && recoveryBounds.y >= 0 && recoveryBounds.y + recoveryBounds.height <= viewport.height);
      await page.getByRole('button', { name: 'Outside', exact: true }).click(); await parent.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.continuityLayers.exits), 1);
      const id = locale + '/' + viewport.width + 'x' + viewport.height;
      report.cases.push({ id, contracts: [...continuityBrowserContracts] });
      await page.screenshot({ path: output + '/' + locale + '-' + viewport.width + 'x' + viewport.height + '.png' });
    } catch (error) {
      const page = context.pages()[0];
      if (page) {
        report.diagnostic = await page.evaluate(() => ({ requests: window.settingsFixture?.requests, progress: document.querySelector('.redeven-environment-progress')?.outerHTML }));
        await page.screenshot({ path: output + '/failure.png' });
      }
      throw error;
    } finally { await context.close(); }
  }
  report.status = 'passed'; assertContinuityBrowserCoverage(report);
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(output + '/report.json', JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
console.log('PASS interaction continuity (' + report.cases.length + ' cases)');
