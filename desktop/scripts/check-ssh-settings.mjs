import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
const require = createRequire(new URL('../../internal/envapp/ui_src/package.json', import.meta.url));
const axePath = require.resolve('axe-core/axe.min.js');
const base = process.env.REDEVEN_SSH_PREVIEW_URL || 'http://127.0.0.1:43817';
const output =
  process.env.REDEVEN_SSH_PREVIEW_OUTPUT || fileURLToPath(new URL('../dist/ssh-settings-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const launchDirectory = await mkdtemp(join(tmpdir(), 'redeven-ssh-scrollbars-'));
const errors = [];
async function launchBrowser(scrollbars) {
  let executablePath;
  if (process.platform === 'darwin') {
    // Argument-domain preferences affect only this test process, never system defaults.
    executablePath = join(launchDirectory, scrollbars);
    const binary = chromium.executablePath().replaceAll("'", "'\\''");
    await writeFile(executablePath, `#!/bin/sh\nexec '${binary}' -AppleShowScrollBars ${scrollbars} "$@"\n`, { mode: 0o755 });
  }
  return chromium.launch({ headless: true, executablePath, ignoreDefaultArgs: ['--hide-scrollbars'] });
}
async function createPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}
let browser = await launchBrowser('Always');
let page = await createPage(browser);
async function motion(action = 'open') {
  const frames = await page.evaluate(async (action) => {
    const frames = [], started = performance.now();
    const sample = () => {
      const panel = document.querySelector('.redeven-ssh-settings-dialog');
      if (panel) {
        const body = panel.children[1];
        frames.push({ elapsed: performance.now() - started, width: body.clientWidth, overflow: body.scrollHeight - body.clientHeight, focus: document.activeElement?.id });
      }
    };
    if (action === 'open') { const trigger = document.querySelector('#fixture-open'); trigger.focus(); trigger.click(); }
    else document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    sample();
    await new Promise(resolve => {
      const next = () => { sample(); if (performance.now() - started >= 420) resolve(); else requestAnimationFrame(next); };
      requestAnimationFrame(next);
    });
    return frames;
  }, action);
  assert.ok(frames.length > 1, `${action}: animation frames captured`);
  for (const frame of frames) {
    assert.equal(frame.overflow, 0, `${action}: transient overflow at ${frame.elapsed.toFixed(1)}ms`);
    assert.equal(frame.width, frames[0].width, `${action}: body width changed`);
  }
  if (action === 'open') {
    assert.ok(frames.at(-1).elapsed >= 400);
    assert.equal(frames.at(-1).focus, 'ssh-settings-label');
  }
}
async function assertFieldFocus() {
  const values = await page.evaluate(() => {
    const snapshot = (el) => { const s = getComputedStyle(el); return { width: el.offsetWidth, height: el.offsetHeight, border: s.borderWidth, padding: s.padding, shadow: s.boxShadow, outline: s.outlineStyle, color: s.borderColor }; };
    return [...document.querySelectorAll('.ssh-settings-form input:not([type="checkbox"]),.ssh-settings-form select')].map(el => {
      el.style.transition = 'none'; el.blur(); const before = snapshot(el); el.focus(); return { id: el.id, before, after: snapshot(el) };
    });
  });
  for (const field of values) {
    for (const key of ['width','height','border','padding','shadow']) assert.equal(field.after[key], field.before[key], `${field.id}: focus changes ${key}`);
    assert.equal(field.after.outline, 'none', `${field.id}: focus outline`);
    assert.notEqual(field.after.color, field.before.color, `${field.id}: invisible focus border`);
  }
}
async function open(locale = 'en-US', theme = 'dark', suffix = '') {
  await page.goto(`${base}/ssh-settings.html?locale=${locale}&theme=${theme}${suffix}`);
  await page.evaluate(() => document.fonts.ready);
  await motion();
  await page.locator('.redeven-ssh-settings-dialog').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.redeven-ssh-settings-dialog')).opacity === '1',
  );
}
async function geometry() {
  return page.locator('.redeven-ssh-settings-dialog').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const body = el.children[1];
    const footer = el.lastElementChild.getBoundingClientRect();
    return {
      width: rect.width,
      bottom: rect.bottom,
      right: rect.right,
      horizontalOverflow: el.scrollWidth > el.clientWidth,
      scroll: body.scrollHeight - body.clientHeight,
      footerBottom: footer.bottom,
    };
  });
}
try {
  for (const preset of (process.argv.includes('--interactions-only') ? [] : builtInShellThemePresets)) {
    const theme = preset.mode;
    for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU']) {
      await open(locale, theme, `&preset=${preset.name}`);
      const bounds = await geometry();
      assert.equal(bounds.width, 640);
      assert.equal(bounds.horizontalOverflow, false, `${theme}/${locale}: horizontal overflow`);
      assert.ok(bounds.footerBottom < 800, `${theme}/${locale}: actions clipped`);
      assert.equal(bounds.scroll, 0, `${theme}/${locale}: default view scrolls`);
      await assertFieldFocus();
      if (['classic-light','ocean'].includes(preset.name) && (locale === 'zh-CN' || locale === 'en-US'))
        await page.screenshot({ path: `${output}/${theme}-${locale}.png`, animations: 'disabled' });
    }
  }
  console.log(process.argv.includes('--interactions-only') ? 'Running focused SSH interactions.' : 'SSH theme/locale and frame checks passed.');
  await open();
  await motion('close');
  await motion('open');
  const typography = await page.locator('.redeven-ssh-settings-dialog').evaluate((el) => ({
    title: getComputedStyle(el.querySelector('h2')).fontSize,
    field: getComputedStyle(el.querySelector('input')).fontSize,
    radius: parseFloat(getComputedStyle(el).borderRadius),
  }));
  assert.equal(typography.title, '14px');
  assert.equal(typography.field, '13px');
  assert.ok(typography.radius <= 6, 'shared compact Dialog radius');
  await page.addScriptTag({ path: axePath });
  const accessibility = await page.evaluate(async () => {
    const result = await window.axe.run('.redeven-ssh-settings-dialog', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] });
    return result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    }));
  });
  assert.deepEqual(accessibility, [], 'default editor accessibility');
  await page.keyboard.press('Escape');
  await page.locator('.redeven-ssh-settings-dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.id === 'fixture-open');
  for (const action of ['backdrop', 'Close', 'Cancel', 'Escape']) {
    await page.locator('#fixture-open').click();
    await page.locator('#ssh-settings-label').fill('Discarded draft');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.redeven-ssh-settings-dialog')).opacity === '1');
    const exit = await page.evaluate(async (action) => {
      const panel = document.querySelector('.redeven-ssh-settings-dialog');
      if (action === 'backdrop') document.querySelector('[data-floe-dialog-backdrop]').click();
      else if (action === 'Escape') document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      else [...panel.querySelectorAll('button')].find((button) => button.textContent.trim() === action || button.getAttribute('aria-label') === action).click();
      const retained = panel.isConnected && panel.dataset.floatingPresence === 'exiting';
      const draft = panel.querySelector('#ssh-settings-label').value;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { retained, draft, duration: getComputedStyle(panel).transitionDuration };
    }, action);
    assert.equal(exit.retained, true, `${action}: must retain the panel for exit motion`);
    assert.equal(exit.draft, 'Discarded draft');
    assert.notEqual(exit.duration, '0s');
    await page.locator('.redeven-ssh-settings-dialog').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.id === 'fixture-open');
    assert.equal(await page.locator('#fixture-saved').textContent(), '');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#fixture-open').click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.redeven-ssh-settings-dialog').waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#fixture-open').click();
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'gzcom');
  await page.locator('#ssh-settings-label').fill('Production');
  await page.locator('.ssh-settings-disclosure').click();
  await page.locator('#ssh-settings-bootstrap_strategy').selectOption('remote_install');
  await page.locator('#ssh-settings-runtime_root').fill('/srv/redeven');
  await page.locator('#ssh-settings-release_base_url').fill(`https://mirror.example.com/${'release/'.repeat(18)}`);
  await page.locator('#ssh-settings-connect_timeout_seconds').fill('0');
  await page.locator('.ssh-settings-disclosure').click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === 'ssh-settings-connect_timeout_seconds');
  await page.locator('#ssh-settings-connect_timeout_seconds').fill('30');
  await page.getByRole('radio', { name: 'Password', exact: true }).click();
  await page.getByRole('button', { name: 'Remove stored password', exact: true }).click();
  await page.setViewportSize({ width: 480, height: 640 });
  let bounds = await geometry();
  assert.equal(bounds.horizontalOverflow, false);
  assert.ok(bounds.scroll > 0);
  assert.ok(bounds.footerBottom <= 640);
  await page.screenshot({ path: `${output}/narrow-advanced.png`, animations: 'disabled' });
  // Simulate enlarged text without changing the viewport or shrinking the dialog.
  await page.addStyleTag({
    content:
      '.redeven-ssh-settings-dialog { font-size: 28px; } .redeven-ssh-settings-dialog input, .redeven-ssh-settings-dialog select, .redeven-ssh-settings-dialog button, .redeven-ssh-settings-dialog label, .redeven-ssh-settings-dialog p, .redeven-ssh-settings-dialog span { font-size: 24px !important; }',
  });
  bounds = await geometry();
  assert.equal(bounds.horizontalOverflow, false);
  assert.ok(bounds.footerBottom <= 640);
  await page.screenshot({ path: `${output}/enlarged-text.png`, animations: 'disabled' });
  await page.locator('#ssh-settings-connect_timeout_seconds').focus();
  await page.keyboard.press('Control+Enter');
  await page.locator('.redeven-ssh-settings-dialog').waitFor({ state: 'detached' });
  const saved = JSON.parse(await page.locator('#fixture-saved').textContent());
  assert.equal(saved.label, 'Production');
  assert.equal(saved.bootstrap_strategy, 'remote_install');
  assert.equal(saved.ssh_password_mode, 'clear');
  assert.equal(saved.runtime_root, '/srv/redeven');
  assert.equal(saved.connect_timeout_seconds, '30');
  await page.setViewportSize({ width: 1280, height: 800 });
  await open('en-US', 'dark', '&fail-save=1');
  await page.locator('#ssh-settings-label').fill('Unsaved');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'could not save' }).waitFor();
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'Unsaved');
  await page.getByRole('button', { name: 'About this connection', exact: true }).click();
  await page.locator('.ssh-settings-help-popover').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.ssh-settings-help-popover').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.redeven-ssh-settings-dialog').count(), 1);
  const scrollbarModes = process.platform === 'darwin' ? ['Always', 'WhenScrolling'] : ['native'];
  for (const mode of scrollbarModes) {
    if (mode === 'WhenScrolling') {
      await browser.close();
      browser = await launchBrowser(mode);
      page = await createPage(browser);
    }
    await open();
    await motion('close');
    await motion('open');
    await page.locator('.ssh-settings-disclosure').click();
    await page.getByRole('radio', { name: 'Password', exact: true }).click();
    await page.locator('#ssh-settings-release_base_url').fill(`https://mirror.example.com/${'release/'.repeat(18)}`);
    await page.setViewportSize({ width: 480, height: 640 });
    const scrolling = await page.locator('.redeven-ssh-settings-dialog').evaluate(panel => {
      const body = panel.children[1];
      const header = panel.firstElementChild.getBoundingClientRect();
      const footer = panel.lastElementChild.getBoundingClientRect();
      body.scrollTop = 0;
      body.scrollTop = body.scrollHeight;
      return {
        overflow: body.scrollHeight - body.clientHeight,
        scrollTop: body.scrollTop,
        gutter: body.offsetWidth - body.clientWidth,
        panelScroll: panel.scrollTop,
        headerStable: header.top === panel.firstElementChild.getBoundingClientRect().top,
        footerStable: footer.bottom === panel.lastElementChild.getBoundingClientRect().bottom,
        actionsVisible: footer.bottom <= innerHeight,
      };
    });
    assert.ok(scrolling.overflow > 0 && scrolling.scrollTop > 0, `${mode}: real body scrolling`);
    assert.equal(scrolling.panelScroll, 0, `${mode}: only the body scrolls`);
    assert.ok(scrolling.headerStable && scrolling.footerStable && scrolling.actionsVisible);
    if (mode === 'Always') assert.ok(scrolling.gutter > 0, 'native persistent scrollbar reserves space');
    if (mode === 'WhenScrolling') assert.equal(scrolling.gutter, 0, 'native overlay scrollbar reserves no space');
    console.log(`SSH scrollbar mode ${mode} passed (gutter ${scrolling.gutter}px).`);
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      themes: process.argv.includes('--interactions-only') ? 0 : builtInShellThemePresets.length,
      locales: process.argv.includes('--interactions-only') ? 0 : 10,
      scenarios: [
        'first 420ms geometry and autofocus',
        'reopen and closing frames',
        'single input focus border',
        'native persistent and overlay scrollbar geometry',
        'default geometry',
        'accessibility',
        'focus restoration',
        'direct dirty dismissal',
        'shared exit motion',
        'reduced motion',
        'fresh reopen',
        'advanced validation',
        'narrow window',
        'enlarged text',
        'save payload',
        'save failure',
        'help Escape',
      ],
      screenshots: output,
    }),
  );
} finally {
  await browser.close();
  await rm(launchDirectory, { recursive: true, force: true });
}
