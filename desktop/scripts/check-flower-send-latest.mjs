import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/flower-send-latest-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['flower-navigation.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
try {
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/mixedEnvironmentFixture.ts', import.meta.url)));
  const { RUNTIME_SERVICE_COMPATIBILITY_EPOCH: epoch, RUNTIME_SERVICE_PROTOCOL_VERSION: protocol } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/runtimeService.ts', import.meta.url)));
  const snapshot = mixedEnvironmentFixture().snapshot;
  snapshot.environments = snapshot.environments.map(entry => {
    const service = entry.runtime_service ?? entry.local_environment_runtime_service;
    return { ...entry, runtime_service: service ? { ...service, compatibility_epoch: epoch, protocol_version: protocol, compatibility: 'compatible',
      compatibility_message: undefined, open_readiness: { state: 'openable' }, ai_readiness: { state: 'inspecting' } } : undefined };
  });
  for (const locale of ['en-US', 'zh-CN']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: locale === 'zh-CN' ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.navigationSnapshot = { ...snapshot, navigation_revision: 1 };
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('flower-navigation.html?send-latest', server.resolvedUrls.local[0]).href);
    await page.locator('.redeven-flower-topbar-button[aria-label="Flower"]').click();
    await page.evaluate(() => window.navigationFixture.releaseRuntime());
    await page.locator('[data-thread-id="navigation-thread"] button').first().click();
    const viewport = page.locator('.flower-chat-transcript');
    await page.waitForFunction(() => document.querySelector('[data-flower-message-id="history-329"]')
      && !document.querySelector('.flower-chat-transcript')?.hasAttribute('data-flower-tail-preparing'));
    await viewport.hover();
    await page.mouse.wheel(0, -200000);
    await page.waitForFunction(() => window.navigationFixture.historyRequests.some(input => input.item_ids));
    await page.locator('[data-flower-message-id="history-150"]').waitFor({ state: 'attached' });
    const editor = page.locator('.flower-composer textarea');
    await editor.fill('continue');
    const readsBeforeSend = await page.evaluate(() => {
      const before = window.navigationFixture.historyRequests.length;
      document.querySelector('[data-flower-primary-action="send"]').click();
      return before;
    });
    // No wheel or Latest action is allowed after this send.
    await page.locator('[data-flower-message-id="sent-reply"]').waitFor();
    const bottom = () => page.waitForFunction(() => {
      const viewport = document.querySelector('.flower-chat-transcript');
      return viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 2;
    });
    await bottom();
    assert.equal(await page.locator('[data-flower-pending-message]').count(), 0);
    assert.equal(await page.locator('[data-flower-message-id="sent-reply"]').evaluate(element => {
      const view = element.closest('.flower-chat-transcript').getBoundingClientRect();
      const rect = element.getBoundingClientRect(); return rect.bottom <= view.bottom + 2 && rect.bottom > view.top;
    }), true);
    await page.evaluate(() => window.navigationFixture.growSentReply());
    await page.locator('[data-flower-message-id="sent-growth"]').waitFor();
    await bottom();
    const facts = await page.evaluate(() => ({ sends: window.navigationFixture.turnRequests.length,
      reads: window.navigationFixture.historyRequests, streams: window.navigationFixture.streams }));
    assert.equal(facts.sends, 1);
    assert.equal(facts.streams, 1);
    assert.ok(facts.reads.length - readsBeforeSend <= 2, JSON.stringify({ readsBeforeSend, reads: facts.reads }));
    assert.equal(facts.reads.at(-1).item_ids, undefined);
    assert.equal(facts.reads.at(-1).anchor_id, undefined);
    await page.screenshot({ path: `${output}/${locale}.png`, animations: 'disabled' });
    report.cases.push({ locale, sends: facts.sends, readsAfterSend: facts.reads.length - readsBeforeSend, streams: facts.streams });
    await page.evaluate(() => window.navigationFixture.dispose());
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
