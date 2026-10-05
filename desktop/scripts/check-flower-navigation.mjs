import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/flower-navigation-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], output, cases: [], errors: [] };

try {
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/mixedEnvironmentFixture.ts', import.meta.url)));
  const { RUNTIME_SERVICE_COMPATIBILITY_EPOCH: epoch, RUNTIME_SERVICE_PROTOCOL_VERSION: protocol } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/runtimeService.ts', import.meta.url)));
  const snapshot = mixedEnvironmentFixture().snapshot;
  snapshot.environments = snapshot.environments.map(entry => {
    const service = entry.runtime_service ?? entry.local_environment_runtime_service;
    return { ...entry, runtime_service: service ? { ...service, compatibility_epoch: epoch, protocol_version: protocol, compatibility: 'compatible', compatibility_message: undefined, open_readiness: { state: 'openable' }, ai_readiness: { state: 'inspecting' } } : undefined };
  });
  for (const locale of ['en-US', 'zh-CN']) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 720 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.navigationSnapshot = { ...snapshot, navigation_revision: 1 };
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('flower-navigation.html', report.url).href);
    await page.locator('.redeven-flower-topbar-button').waitFor();
    await page.evaluate(() => document.fonts.ready);

    // Sample the second animation frame so a paint opportunity separates the
    // click from measurement. IPC promises deliberately never resolve.
    async function navigate(selector, destination) {
      const elapsed = await page.evaluate(async ({ selector, destination }) => {
        const start = performance.now();
        document.querySelector(selector).click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const target = document.querySelector(`[data-desktop-page="${destination}"]`);
        if (!target || target.getBoundingClientRect().height <= 0 || target.closest('[inert]')) throw new Error(`Navigation stalled: ${destination}`);
        return performance.now() - start;
      }, { selector, destination });
      assert.ok(elapsed < 250, `${locale}: ${destination} must paint within 250ms; took ${elapsed.toFixed(1)}ms`);
      return elapsed;
    }
    const timings = [await navigate('.redeven-flower-topbar-button', 'flower')];
    await page.locator('[data-flower-runtime-availability="preparing"]').waitFor();
    assert.equal(await page.locator('[data-flower-engaged]').count(), 0, 'AI startup does not mount Flower requests');
    assert.equal(await page.evaluate(() => window.navigationFixture.requests.length), 0);
    await page.screenshot({ path: `${output}/${locale}-preparing.png`, animations: 'disabled' });
    timings.push(await navigate('.redeven-flower-back-button', 'environments'));
    await page.locator('.redeven-flower-topbar-button').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.redeven-flower-back-button').evaluate(el => document.activeElement === el), true, 'keyboard entry preserves a visible navigation focus');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.redeven-flower-topbar-button').evaluate(el => document.activeElement === el), true, 'keyboard return restores the Flower entry');
    timings.push(await navigate('.redeven-flower-topbar-button', 'flower'));
    await page.evaluate(() => window.navigationFixture.releaseRuntime());
    await page.locator('[data-flower-engaged]').waitFor();
    assert.equal(await page.locator('[data-flower-runtime-availability]').count(), 0, 'AI readiness replaces preparation automatically');
    await page.locator('.flower-empty-hero').waitFor({ state: 'visible' });
    const scale = await page.locator('.flower-chat-header').evaluate(header => ({
      height: header.getBoundingClientRect().height,
      family: getComputedStyle(header).fontFamily,
    }));
    assert.equal(scale.height, 40, 'Desktop Flower uses the shared 40px header');
    assert.ok(scale.family.includes('Inter Variable'), 'Desktop and Env App use the same UI font');
    assert.equal(await page.getByText('AI service is unavailable', { exact: false }).count(), 0);
    for (const width of [1024, 800, 640, 1440]) {
      await page.setViewportSize({ width, height: 720 });
      await page.waitForFunction(() => document.querySelector('[data-flower-interaction-mode]')?.getAttribute('data-flower-interaction-mode') === 'desktop');
      assert.equal(await page.locator('.flower-empty-hero').isVisible(), true);
      assert.equal(await page.locator('.flower-empty-suggestion:visible').count(), 4);
      assert.equal(await page.locator('.flower-empty-hint').isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Desktop has no page overflow');
      await page.screenshot({ path: `${output}/${locale}-welcome-${width}.png`, animations: 'disabled' });
    }
    try {
      await page.locator('[data-thread-id="navigation-thread"] button').first().click({ timeout: 5000 });
    } catch (error) {
      console.log(await page.evaluate(() => ({ text: document.body.innerText, requests: window.navigationFixture.requests })));
      await page.screenshot({ path: `${output}/failure.png` });
      throw error;
    }
    await page.locator('[data-flower-selected-thread-id="navigation-thread"][data-flower-selected-thread-loading="false"]').waitFor();
    const composer = page.locator('.flower-composer-content textarea').first();
    await composer.focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await composer.inputValue(), 'Inspect this workspace', `${locale}: Desktop recalls canonical user text`);
    await page.keyboard.press('Escape');
    assert.equal(await composer.inputValue(), '', `${locale}: Escape restores the empty Desktop draft`);
    await composer.fill('Keep this unsent draft');
    await page.evaluate(() => {
      window.navigationNodes = { flower: document.querySelector('[data-flower-engaged]'),
        environment: document.querySelector('[data-environment-group]'), composer: document.querySelector('.flower-composer-content textarea') };
    });
    await composer.evaluate(element => element.setSelectionRange(2, 7));
    await page.setViewportSize({ width: 640, height: 720 });
    await page.waitForFunction(() => document.querySelector('[data-flower-sidebar-presentation]')?.getAttribute('data-flower-sidebar-presentation') === 'overlay');
    const drawerTrigger = page.locator('.flower-chat-header .flower-mobile-navigation-button');
    await drawerTrigger.click();
    const drawer = page.locator('[data-floe-drawer-side="left"]');
    await drawer.waitFor();
    await page.waitForFunction(() => Boolean(document.querySelector('[data-floe-drawer-side="left"]')?.contains(document.activeElement)));
    assert.equal(await page.locator('.flower-thread-search-input').evaluate(element => element === document.activeElement), false, 'opening navigation does not focus search');
    await page.screenshot({ path: `${output}/${locale}-narrow-navigation.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.matches('.flower-chat-header .flower-mobile-navigation-button'));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => document.querySelector('[data-flower-sidebar-presentation]')?.getAttribute('data-flower-sidebar-presentation') === 'inline');
    assert.equal(await composer.evaluate(element => element === window.navigationNodes.composer), true);
    assert.equal(await composer.inputValue(), 'Keep this unsent draft');
    assert.deepEqual(await composer.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 7]);
    for (let round = 0; round < 6; round++) {
      timings.push(await navigate(round % 2 ? '.flower-sidebar-leading-action' : '.redeven-flower-back-button', 'environments'));
      assert.equal(await page.locator('[data-desktop-page="flower"]').evaluate(el => {
        const button = el.querySelector('button'); button.focus();
        return el.inert && getComputedStyle(el).display === 'none' && document.activeElement !== button;
      }), true, 'hidden Flower cannot receive keyboard focus');
      // An environment refresh describes the host's original surface, without
      // being a new request to leave the user's selected page.
      await page.evaluate(() => window.navigationFixture.publish({ surface: 'connect_environment' }));
      timings.push(await navigate('.redeven-flower-topbar-button', 'flower'));
      await page.evaluate(() => window.navigationFixture.publish({ surface: 'connect_environment' }));
      assert.equal(await composer.inputValue(), 'Keep this unsent draft');
      assert.equal(await page.locator('[data-flower-engaged]').getAttribute('data-flower-selected-thread-id'), 'navigation-thread');
      assert.equal(await page.evaluate(() => window.navigationNodes.flower === document.querySelector('[data-flower-engaged]')
        && window.navigationNodes.environment === document.querySelector('[data-environment-group]')
        && window.navigationNodes.composer === document.querySelector('.flower-composer-content textarea')), true);
    }
    await page.screenshot({ path: `${output}/${locale}-flower.png`, animations: 'disabled' });
    await page.evaluate(() => window.navigationFixture.publish({ surface: 'connect_environment', navigation_revision: 2 }));
    await page.locator('.redeven-flower-topbar-button').waitFor();
    await navigate('.redeven-flower-topbar-button', 'flower');
    await page.evaluate(() => window.navigationFixture.publish({ surface: 'connect_environment', navigation_revision: 3 }));
    await page.locator('.redeven-flower-topbar-button').waitFor();
    await page.screenshot({ path: `${output}/${locale}-environments.png`, animations: 'disabled' });
    const counters = await page.evaluate(() => ({ requests: window.navigationFixture.requests,
      streams: window.navigationFixture.streams, cancellations: window.navigationFixture.cancellations,
      prematureRequests: window.navigationFixture.prematureRequests }));
    assert.equal(counters.prematureRequests, 0, 'no settings/model/stream bootstrap races AI publication');
    assert.equal(counters.requests.filter(value => value === 'GET settings').length, 1, 'settings load once across visits');
    assert.equal(counters.requests.filter(value => value === 'GET ai/threads').length, 1, 'thread list loads once across visits');
    assert.equal(counters.streams, 1, 'one workspace stream survives navigation');
    assert.equal(counters.cancellations, 0, 'returning to Environments does not tear down Flower');
    assert.ok(!counters.requests.some(value => ['snapshot', 'open_flower', 'open_environment_center'].includes(value)), 'local navigation needs no Launcher IPC');
    await page.evaluate(() => window.navigationFixture.dispose());
    assert.ok(await page.evaluate(() => window.navigationFixture.cancellations > 0), 'disposing Welcome releases the workspace stream');
    report.cases.push({ locale, timingsMs: timings, maxMs: Math.max(...timings), ...counters });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
