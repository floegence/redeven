import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
const sources = ['internal/flower_ui/src/FlowerTurnLauncherWindow.tsx', 'internal/flower_ui/src/styles/flower.css'];
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
    await page.evaluate(() => window.navigationFixture.releaseRuntime());
    await trigger.click();
    const card = page.locator('[data-floe-prompt-card]');
    await card.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-floe-prompt-card]')?.dataset.floatingPresence === 'open');
    await card.evaluate(async element => { await Promise.allSettled(element.getAnimations().map(animation => animation.finished)); });
    const editor = card.locator('textarea');
    assert.equal(await editor.evaluate(element => element === document.activeElement), true, 'opening focuses the editor');
    assert.equal(await editor.getAttribute('placeholder'), null, 'the question replaces redundant placeholder copy');
    assert.equal(await editor.evaluate(element => getComputedStyle(element).caretColor === getComputedStyle(element).color), true, 'the writing caret uses primary text ink');
    const bounds = await card.boundingBox();
    assert.ok(bounds.width <= 400 && bounds.height < 220, 'content-sized question card');
    assert.ok(bounds.x >= 7 && bounds.x + bounds.width <= width - 7 && bounds.y + bounds.height < 900, 'card stays inside viewport');
    assert.equal(await card.locator('[data-floe-floating-window-titlebar], [data-floe-floating-window-resize-handle]').count(), 0);
    assert.ok(await card.getAttribute('aria-labelledby'), 'card has an accessible title');
    assert.ok(await editor.getAttribute('aria-label'), 'editor has an accessible name');
    assert.equal(await card.locator('.floe-prompt-card-field').evaluate(element => getComputedStyle(element).borderBottomWidth), '0px', 'editor and toolbar have no separator');
    assert.deepEqual(await card.locator('.floe-prompt-card-attach svg path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))), ['M5 12h14', 'M12 5v14'], 'attachments use the shared plus icon');
    const fillSeparation = await card.evaluate(element => {
      const canvas = document.createElement('canvas').getContext('2d');
      const luminance = color => {
        canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1);
        const [r, g, b] = [...canvas.getImageData(0, 0, 1, 1).data].map(v => {
          const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
        });
        return r * .2126 + g * .7152 + b * .0722;
      };
      const fill = luminance(getComputedStyle(element).backgroundColor);
      const root = getComputedStyle(document.documentElement);
      return ['--background', '--card'].map(token => {
        const base = luminance(root.getPropertyValue(token));
        return (Math.max(fill, base) + .05) / (Math.min(fill, base) + .05);
      });
    });
    assert.ok(fillSeparation.every(ratio => ratio >= 1.12), `visible card fill: ${fillSeparation}`);
    const model = card.getByRole('combobox');
    await page.waitForFunction(() => document.querySelector('.floe-prompt-card-selection')?.textContent?.includes('gpt-4.1'));
    assert.equal(await card.evaluate(element => getComputedStyle(element).borderWidth), '0px', 'background and elevation distinguish the card');
    const name = `${width}-${theme}-${locale}`;
    await page.screenshot({ caret: 'initial', path: `${output}/${name}.png` });
    await editor.fill(locale === 'zh-CN' ? '帮我检查这个环境的运行状态，看看有什么需要处理。' : 'Check this environment and explain what needs attention.');
    await page.screenshot({ caret: 'initial', path: `${output}/${name}-draft.png` });
    const exit = await editor.evaluate(element => {
      const card = element.closest('[data-floe-prompt-card]');
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return { state: card.dataset.floatingPresence, inert: card.inert, retained: element.value, hidden: card.getAttribute('aria-hidden') };
    });
    assert.equal(exit.state, 'exiting'); assert.equal(exit.inert, true); assert.equal(exit.hidden, 'true'); assert.ok(exit.retained.length > 0);
    await card.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Escape restores trigger focus');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await trigger.click(); await card.waitFor();
    const motion = await card.evaluate(element => ({ duration: getComputedStyle(element).transitionDuration, transform: getComputedStyle(element).transform }));
    assert.equal(motion.duration, '0s'); assert.ok(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(motion.transform));
    await model.click();
    await page.getByRole('option', { name: 'claude-sonnet-4.5', exact: true }).click();
    assert.equal(await card.getAttribute('aria-hidden'), null);
    assert.equal(await editor.evaluate(element => element === document.activeElement), true, 'choosing a model resumes editing');
    await card.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Review this attachment') });
    assert.equal(await editor.evaluate(element => element === document.activeElement), true, 'adding an attachment resumes editing');
    assert.equal(await editor.inputValue(), '');
    await page.screenshot({ caret: 'initial', path: `${output}/${name}-attachment.png` });
    const send = card.locator('.floe-prompt-card-submit');
    await send.click();
    await page.waitForFunction(() => window.navigationFixture.turnRequests.length === 1 || document.querySelector('.floe-prompt-card-feedback [role=alert]'));
    assert.equal(await page.evaluate(() => window.navigationFixture.turnRequests.length), 1, await card.textContent());
    await page.waitForFunction(() => !document.querySelector('.floe-prompt-card-submit').disabled);
    assert.equal(await editor.isDisabled(), true, 'unknown admission freezes the captured request');
    assert.equal(await model.isDisabled(), true);
    await send.click();
    await page.waitForFunction(() => window.navigationFixture.turnRequests.length === 2);
    const submitted = await page.evaluate(() => ({ requests: window.navigationFixture.turnRequests, uploads: window.navigationFixture.uploads }));
    assert.deepEqual(submitted.requests[0], submitted.requests[1], 'retry preserves exact model, files and identity');
    assert.equal(submitted.requests[0].model, 'fixture/claude-sonnet-4.5');
    assert.equal(submitted.requests[0].input.text, '');
    assert.deepEqual(submitted.requests[0].input.attachments, [{ attachment_id: 'upload-1' }]);
    assert.equal(submitted.uploads.length, 1, 'unknown admission never reuploads files');
    await page.waitForFunction(() => !document.querySelector('.floe-prompt-card-submit').disabled);
    await card.locator('.floe-prompt-card-close').click();
    await card.waitFor({ state: 'detached' });
    report.cases.push({ width, theme, locale, bounds, exit, reducedMotion: motion });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors, output }));
} finally { await browser.close(); await server.close(); }
