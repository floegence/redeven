import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = resolve(process.env.REDEVEN_ASK_CARD_OUTPUT || fileURLToPath(new URL('../dist/flower-ask-card-acceptance/', import.meta.url)));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['flower-navigation.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const sources = ['internal/flower_ui/src/FlowerAskCard.tsx', 'internal/flower_ui/src/FlowerTurnLauncherWindow.tsx', 'internal/flower_ui/src/styles/flower.css'];
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sources: Object.fromEntries(await Promise.all(sources.map(async name => [name, createHash('sha256').update(await readFile(new URL(`../../${name}`, import.meta.url))).digest('hex')]))),
  publishedCore: JSON.parse(await readFile(new URL('../node_modules/@floegence/floe-webapp-core/package.json', import.meta.url))).version,
  cases: [], errors: [] };
try {
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/mixedEnvironmentFixture.ts', import.meta.url)));
  const { RUNTIME_SERVICE_COMPATIBILITY_EPOCH: epoch, RUNTIME_SERVICE_PROTOCOL_VERSION: protocol } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/runtimeService.ts', import.meta.url)));
  const snapshot = mixedEnvironmentFixture().snapshot;
  snapshot.environments = snapshot.environments.map(entry => {
    const service = entry.runtime_service ?? entry.local_environment_runtime_service;
    return { ...entry, runtime_service: service ? { ...service, compatibility_epoch: epoch, protocol_version: protocol, compatibility: 'compatible',
      compatibility_message: undefined, open_readiness: { state: 'openable' }, ai_readiness: { state: 'ready' } } : undefined };
  });
  for (const width of [1440, 390]) for (const theme of ['porcelain-light', 'porcelain-dark']) for (const locale of ['en-US', 'zh-CN']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.navigationSnapshot = { ...snapshot, navigation_revision: 1 };
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('flower-navigation.html', server.resolvedUrls.local[0]).href);
    const trigger = page.locator('.redeven-environment-card__flower-button').first();
    await trigger.waitFor();
    await page.evaluate(async theme => {
      document.documentElement.dataset.floeShellTheme = theme;
      document.documentElement.classList.toggle('dark', theme.endsWith('dark'));
      document.documentElement.classList.toggle('light', theme.endsWith('light'));
      await document.fonts.ready;
    }, theme);
    await trigger.click();
    const card = page.locator('[data-flower-ask-card]');
    await card.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-flower-ask-card]')?.dataset.floatingPresence === 'open');
    await card.evaluate(async element => { await Promise.allSettled(element.getAnimations().map(animation => animation.finished)); });
    const editor = card.locator('textarea');
    assert.equal(await editor.evaluate(element => element === document.activeElement), true, 'opening focuses the editor');
    const bounds = await card.boundingBox();
    assert.ok(bounds.width <= 512 && bounds.height < 340, 'content-sized question card');
    assert.ok(bounds.x >= 7 && bounds.x + bounds.width <= width - 7 && bounds.y + bounds.height < 900, 'card stays inside viewport');
    assert.equal(await card.locator('[data-floe-floating-window-titlebar], [data-floe-floating-window-resize-handle]').count(), 0);
    assert.ok(await card.getAttribute('aria-labelledby'), 'card has an accessible title');
    assert.ok(await editor.getAttribute('aria-label'), 'editor has an accessible name');
    assert.equal(await card.locator('.flower-turn-launcher-editor-shell').evaluate(element => getComputedStyle(element).borderWidth), '0px', 'single integrated surface');
    const name = `${width}-${theme}-${locale}`;
    await page.screenshot({ path: `${output}/${name}.png` });
    await editor.fill(locale === 'zh-CN' ? '帮我检查这个环境的运行状态，看看有什么需要处理。' : 'Check this environment and explain what needs attention.');
    await page.screenshot({ path: `${output}/${name}-draft.png` });
    const exit = await editor.evaluate(element => {
      const card = element.closest('[data-flower-ask-card]');
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return { state: card.dataset.floatingPresence, inert: card.inert, retained: element.value, hidden: card.getAttribute('aria-hidden') };
    });
    assert.equal(exit.state, 'exiting'); assert.equal(exit.inert, true); assert.equal(exit.hidden, 'true'); assert.ok(exit.retained.length > 0);
    await card.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Escape restores trigger focus');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await trigger.click(); await card.waitFor();
    const motion = await card.evaluate(element => ({ duration: getComputedStyle(element).transitionDuration, transform: getComputedStyle(element).transform }));
    assert.equal(motion.duration, '0s'); assert.equal(motion.transform, 'none');
    await card.locator('[data-testid="flower-ask-card-close"]').click();
    await card.waitFor({ state: 'detached' });
    report.cases.push({ width, theme, locale, bounds, exit, reducedMotion: motion });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors, output }));
} finally { await browser.close(); await server.close(); }
