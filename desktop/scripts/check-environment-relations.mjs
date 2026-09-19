import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/environment-relation-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], output, cases: [], errors: [] };
try {
  const { linkedEnvironmentFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/linkedEnvironmentFixture.ts', import.meta.url)));
  const fixture = linkedEnvironmentFixture();
  for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'de-DE', 'es-ES', 'fr-FR', 'ja-JP', 'ko-KR', 'pt-BR', 'ru-RU']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot: fixture.snapshot, locale });
    await page.goto(new URL('environment-settings.html', report.url).href);
    const card = page.locator('[data-environment-group]');
    await card.waitFor();
    assert.equal(await card.count(), 1);
    const runtime = page.locator('[data-owner-role="runtime"]');
    const cloud = page.locator('[data-owner-role="cloud"]');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/${locale}.png`, animations: 'disabled' });
    // Real Renderer actions still name the original owners and remote route.
    await runtime.locator('.redeven-split-action-primary button').first().click();
    await cloud.locator('.redeven-split-action-primary button').first().click();
    const requests = await page.evaluate(() => window.settingsFixture.requests);
    assert.ok(requests.some(request => request.kind === 'open_local_environment' && request.environment_id === fixture.runtime.id));
    assert.ok(requests.some(request => request.kind === 'open_provider_environment' && request.environment_id === fixture.cloud.id && request.route === 'remote_desktop'));
    const endpoints = cloud.locator('.redeven-card-fact-endpoint-trigger');
    await endpoints.click();
    const popup = page.locator('.redeven-endpoints-popover');
    await popup.waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.redeven-endpoints-popover')).opacity === '1');
    await page.evaluate(async snapshot => {
      const popup = document.querySelector('.redeven-endpoints-popover');
      const button = popup.querySelector('button'); button.focus();
      const cloud = document.querySelector('[data-owner-role="cloud"]');
      for (let tick = 0; tick < 5; tick++) {
        window.settingsFixture.publish(structuredClone(snapshot));
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (document.querySelector('.redeven-endpoints-popover') !== popup || document.activeElement !== button
          || document.querySelector('[data-owner-role="cloud"]') !== cloud) throw new Error('Cloud refresh replaced interactive state');
      }
    }, fixture.snapshot);
    await page.keyboard.press('Escape'); await popup.waitFor({ state: 'detached' });
    assert.equal(await endpoints.evaluate(el => document.activeElement === el), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: `${output}/${locale}-narrow-dark.png`, animations: 'disabled' });
    const bounds = await card.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'relationship stays within narrow viewport');
    const overflow = await card.evaluate(el => [...el.querySelectorAll('button')].filter(button => button.offsetWidth)
      .filter(button => { const box = button.getBoundingClientRect(); const card = el.getBoundingClientRect(); return box.right > card.right + 1; }).map(button => ({ text: button.textContent, label: button.getAttribute('aria-label'), class: button.className, right: button.getBoundingClientRect().right })));
    assert.deepEqual(overflow, [], `${locale}: actions fit the card`);
    assert.equal(await cloud.locator('.redeven-cloud-identity').evaluate(el =>
      el.getBoundingClientRect().right <= el.parentElement.parentElement.getBoundingClientRect().right + 1),
    true, `${locale}: Cloud label leaves room for owner controls`);
    await page.evaluate(snapshot => window.settingsFixture.publish({ ...snapshot, environments: [
      { ...snapshot.environments[0], provider_runtime_link_target: { ...snapshot.environments[0].provider_runtime_link_target, provider_link_state: 'unbound' } },
      { ...snapshot.environments[1], provider_linked_runtime_summary: undefined },
    ] }), fixture.snapshot);
    await page.waitForFunction(() => document.querySelectorAll('[data-environment-group]').length === 2);
    report.cases.push(`${locale}:merge-owner-actions-refresh-focus-narrow-dark-unlink`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error?.stack || error); throw error; }
finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); await server.close();
}
console.log(JSON.stringify(report, null, 2));
