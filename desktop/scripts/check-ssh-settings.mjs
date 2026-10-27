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
      const panel = document.querySelector('.redeven-environment-settings-dialog');
      if (panel) {
        const body = panel.querySelector('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-scroll');
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
    // The fixed-height body may scroll; opening must not change its scroll range.
    assert.equal(frame.overflow, frames.at(-1).overflow, `${action}: transient overflow at ${frame.elapsed.toFixed(1)}ms`);
    assert.equal(frame.width, frames[0].width, `${action}: body width changed`);
  }
  if (action === 'open') {
    assert.ok(frames.at(-1).elapsed >= 400);
    assert.ok(['connection', 'ssh-settings-label'].includes(frames.at(-1).focus) || frames.at(-1).focus.includes('tab'), 'focus stays in the settings dialog');
  }
}
async function assertFieldFocus() {
  const { values, expected } = await page.evaluate(() => {
    // Resolve Floe's published tokens rather than hard-coding their px values:
    // the field corner and control height are Floe's, not this dialog's.
    const panel = document.querySelector('.redeven-environment-settings-dialog');
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;top:0;left:0;border-radius:var(--floe-radius-field);height:var(--environment-settings-control-height)';
    panel.appendChild(probe);
    const probeStyle = getComputedStyle(probe);
    const expected = { radius: probeStyle.borderRadius, height: probe.offsetHeight };
    probe.remove();
    const snapshot = (el) => { const s = getComputedStyle(el); return { width: el.offsetWidth, height: el.offsetHeight, border: s.borderWidth, padding: s.padding, shadow: s.boxShadow, outline: s.outlineStyle, color: s.borderColor, radius: s.borderRadius }; };
    return { expected, values: [...document.querySelectorAll('.ssh-settings-form input:not([type="checkbox"]),.ssh-settings-form select')].map(el => {
      el.style.transition = 'none'; el.blur(); const before = snapshot(el); el.focus(); return { id: el.id, before, after: snapshot(el) };
    }) };
  });
  for (const field of values) {
    assert.equal(field.before.radius, expected.radius, `${field.id}: settings corner scale`);
    assert.equal(field.before.height, expected.height, `${field.id}: settings control height`);
    for (const key of ['width','height','border','padding','shadow']) assert.equal(field.after[key], field.before[key], `${field.id}: focus changes ${key}`);
    assert.equal(field.after.outline, 'none', `${field.id}: focus outline`);
    assert.notEqual(field.after.color, field.before.color, `${field.id}: invisible focus border`);
  }
}
async function open(locale = 'en-US', theme = 'dark', suffix = '') {
  await page.goto(`${base}/ssh-settings.html?locale=${locale}&theme=${theme}${suffix}`);
  await page.evaluate(() => document.fonts.ready);
  await motion();
  await page.locator('.redeven-environment-settings-dialog').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.redeven-environment-settings-dialog')).opacity === '1',
  );
}
async function geometry() {
  return page.locator('.redeven-environment-settings-dialog').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const body = el.querySelector('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-scroll');
    const footer = el.querySelector('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-actions').getBoundingClientRect();
    return {
      width: rect.width,
      bottom: rect.bottom,
      right: rect.right,
      horizontalOverflow: el.scrollWidth > el.clientWidth,
      panelScroll: el.scrollHeight - el.clientHeight,
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
      assert.equal(bounds.width, 800);
      assert.equal(bounds.horizontalOverflow, false, `${theme}/${locale}: horizontal overflow`);
      assert.ok(bounds.footerBottom < 800, `${theme}/${locale}: actions clipped`);
      assert.equal(bounds.panelScroll, 0, `${theme}/${locale}: only the body scrolls`);
      await assertFieldFocus();
      if (['classic-light','ocean'].includes(preset.name) && (locale === 'zh-CN' || locale === 'en-US'))
        await page.screenshot({ path: `${output}/${theme}-${locale}.png`, animations: 'disabled' });
    }
  }
  console.log(process.argv.includes('--interactions-only') ? 'Running focused SSH interactions.' : 'SSH theme/locale and frame checks passed.');
  await open();
  const destinationSpace = await page.locator('#ssh-settings-ssh_destination').evaluate(input => {
    const indicator = input.closest('.ssh-settings-field-control').querySelector('[data-floe-status-indicator]');
    return { textRight: input.getBoundingClientRect().right - parseFloat(getComputedStyle(input).paddingRight), indicatorLeft: indicator.getBoundingClientRect().left };
  });
  assert.ok(destinationSpace.textRight <= destinationSpace.indicatorLeft, 'SSH destination text must not overlap its feedback control');
  await motion('close');
  await motion('open');
  const typography = await page.locator('.redeven-environment-settings-dialog').evaluate((el) => {
    // Compare against Floe's ladder as resolved in this theme, so a shift in the
    // published scale is a change here only if the dialog stops following it.
    const token = (name, extra = '') => {
      const probe = document.createElement('div');
      probe.style.cssText = `position:absolute;visibility:hidden;top:0;left:0;font-size:var(${name});${extra}`;
      el.appendChild(probe);
      const value = getComputedStyle(probe).fontSize;
      probe.remove();
      return value;
    };
    const radiusProbe = document.createElement('div');
    radiusProbe.style.cssText = 'position:absolute;visibility:hidden;top:0;left:0;border-radius:var(--floe-radius-panel)';
    el.appendChild(radiusProbe);
    const panelRadius = parseFloat(getComputedStyle(radiusProbe).borderRadius);
    radiusProbe.remove();
    return {
      title: getComputedStyle(el.querySelector('h2')).fontSize,
      field: getComputedStyle(el.querySelector('input')).fontSize,
      label: getComputedStyle(el.querySelector('.ssh-settings-field-label > label')).fontSize,
      body: getComputedStyle(el).fontSize,
      radius: parseFloat(getComputedStyle(el).borderRadius),
      expected: { heading: token('--floe-type-heading'), control: token('--floe-type-control'), body: token('--floe-type-body'), radius: panelRadius },
    };
  });
  assert.equal(typography.title, typography.expected.heading, 'dialog title uses the heading step');
  assert.equal(typography.field, typography.expected.control, 'fields use the control step');
  assert.equal(typography.label, typography.expected.control, 'field labels use the control step');
  assert.equal(typography.body, typography.expected.body, 'dialog body uses the body step');
  assert.equal(typography.radius, typography.expected.radius, 'settings dialog uses the panel corner');
  const fields = await page.locator('.ssh-settings-field').evaluateAll(rows => rows.map(row => { const label = row.querySelector('.ssh-settings-field-label').getBoundingClientRect(), control = row.querySelector('.ssh-settings-field-control').getBoundingClientRect(); return { label: label.right, control: control.left, right: control.right }; }));
  assert.ok(fields.every(row => row.control - row.label >= 27), 'labels and controls occupy separate columns');
  assert.ok(fields.every(row => Math.abs(row.right - fields[0].right) < 1), 'all controls share the same right edge');
  await page.addScriptTag({ path: axePath });
  const accessibility = await page.evaluate(async () => {
    const result = await window.axe.run('.redeven-environment-settings-dialog', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] });
    return result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    }));
  });
  assert.deepEqual(accessibility, [], 'default editor accessibility');
  await page.keyboard.press('Escape');
  await page.locator('.redeven-environment-settings-dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.id === 'fixture-open');
  for (const action of ['backdrop', 'Close', 'Cancel', 'Escape']) {
    await page.locator('#fixture-open').click();
    await page.locator('#ssh-settings-label').fill('Discarded draft');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.redeven-environment-settings-dialog')).opacity === '1');
    const exit = await page.evaluate(async (action) => {
      const panel = document.querySelector('.redeven-environment-settings-dialog');
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
    await page.locator('.redeven-environment-settings-dialog').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.id === 'fixture-open');
    assert.equal(await page.locator('#fixture-saved').textContent(), '');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#fixture-open').click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.redeven-environment-settings-dialog').waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#fixture-open').click();
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'gzcom');
  await page.locator('#ssh-settings-label').fill('Production');
  await page.getByRole('tab', { name: 'Access & security', exact: true }).click();
  await page.locator('#fixture-access-draft').fill('25000');
  await page.getByRole('tab', { name: 'Connection', exact: true }).click();
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'Production');
  await page.getByRole('tab', { name: 'Access & security', exact: true }).click();
  assert.equal(await page.locator('#fixture-access-draft').inputValue(), '25000');
  await page.getByRole('tab', { name: 'Connection', exact: true }).click();
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
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  let bounds = await geometry();
  assert.equal(bounds.horizontalOverflow, false);
  assert.ok(bounds.scroll > 0);
  assert.ok(bounds.footerBottom <= 640);
  await page.screenshot({ path: `${output}/narrow-advanced.png`, animations: 'disabled' });
  // Simulate enlarged text without changing the viewport or shrinking the dialog.
  await page.addStyleTag({
    content:
      '.redeven-environment-settings-dialog { font-size: 28px; } .redeven-environment-settings-dialog input, .redeven-environment-settings-dialog select, .redeven-environment-settings-dialog button, .redeven-environment-settings-dialog label, .redeven-environment-settings-dialog p, .redeven-environment-settings-dialog span { font-size: 24px !important; }',
  });
  bounds = await geometry();
  assert.equal(bounds.horizontalOverflow, false);
  assert.ok(bounds.footerBottom <= 640);
  await page.screenshot({ path: `${output}/enlarged-text.png`, animations: 'disabled' });
  await page.locator('#ssh-settings-connect_timeout_seconds').focus();
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => document.querySelector('#fixture-saved').textContent.length > 0);
  assert.equal(await page.getByRole('dialog').count(), 1, 'saving retains the settings window');
  const saved = JSON.parse(await page.locator('#fixture-saved').textContent());
  assert.equal(saved.label, 'Production');
  assert.equal(saved.bootstrap_strategy, 'remote_install');
  assert.equal(saved.ssh_password_mode, 'clear');
  assert.equal(saved.runtime_root, '/srv/redeven');
  assert.equal(saved.connect_timeout_seconds, '30');
  await page.setViewportSize({ width: 1280, height: 800 });
  await open('en-US', 'dark', '&fail-save=1');
  await page.locator('#ssh-settings-label').fill('Unsaved');
  const feedbackGeometry = () => page.locator('.redeven-environment-settings-dialog').evaluate(dialog =>
    [...dialog.querySelectorAll('input, .environment-access-actions')].map(element => {
      const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height };
    }));
  const beforeFeedback = await feedbackGeometry();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: /Environment settings:.*could not save/ }).waitFor();
  assert.deepEqual(await feedbackGeometry(), beforeFeedback, 'save errors preserve field and footer geometry');
  await page.locator('.redeven-environment-settings-dialog').getByRole('button', { name: /Environment settings:/ }).click();
  await page.locator('[data-floe-status-details]').getByText(/could not save/).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'Unsaved');
  await page.getByRole('button', { name: 'About this connection', exact: true }).click();
  await page.locator('.ssh-settings-help-popover').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.ssh-settings-help-popover').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.redeven-environment-settings-dialog').count(), 1);
  await open('en-US', 'dark', '&fail-ssh-config=1');
  const configFeedback = page.getByRole('button', { name: /^Desktop could not read the SSH configuration\./ });
  const beforeConfigRetry = await feedbackGeometry();
  await configFeedback.click();
  await page.locator('[data-floe-status-details]').getByText('Desktop could not read the SSH configuration.', { exact: true }).waitFor();
  await page.locator('[data-floe-status-details]').getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === 'ssh-settings-ssh_destination');
  assert.equal(await configFeedback.count(), 0, 'successful retry clears only the config feedback');
  assert.deepEqual(await feedbackGeometry(), beforeConfigRetry, 'config feedback recovery preserves input geometry');
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
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const scrolling = await page.locator('.redeven-environment-settings-dialog').evaluate(panel => {
      const body = panel.querySelector('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-scroll');
      const header = panel.firstElementChild.getBoundingClientRect();
      const footer = panel.querySelector('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-actions').getBoundingClientRect();
      body.scrollTop = 0;
      body.scrollTop = body.scrollHeight;
      return {
        overflow: body.scrollHeight - body.clientHeight,
        scrollTop: body.scrollTop,
        gutter: body.offsetWidth - body.clientWidth,
        panelScroll: panel.scrollTop,
        headerStable: header.top === panel.firstElementChild.getBoundingClientRect().top,
        footerStable: footer.bottom === panel.querySelector('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-actions').getBoundingClientRect().bottom,
        actionsVisible: footer.bottom <= innerHeight,
        footerBottom: footer.bottom,
        viewportHeight: innerHeight,
      };
    });
    assert.ok(scrolling.overflow > 0 && scrolling.scrollTop > 0, `${mode}: real body scrolling`);
    assert.equal(scrolling.panelScroll, 0, `${mode}: only the body scrolls`);
    assert.ok(scrolling.headerStable && scrolling.footerStable && scrolling.actionsVisible, JSON.stringify(scrolling));
    if (mode === 'Always') assert.ok(scrolling.gutter > 0, 'native persistent scrollbar reserves space');
    if (mode === 'WhenScrolling') assert.equal(scrolling.gutter, 0, 'native overlay scrollbar reserves no space');
    console.log(`SSH scrollbar mode ${mode} passed (gutter ${scrolling.gutter}px).`);
  }
  await page.close();
  page = await browser.newPage({ viewport: { width: 390, height: 800 }, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/ssh-settings.html?locale=en-US&theme=classic-light`);
  await page.locator('#fixture-open').click();
  await page.locator('.ssh-settings-form input').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  // The touch targets are physical, so they must be measured at rest: the
  // entry motion scales the panel (0.965 at its first frame), which shrinks a
  // 44px control to ~42.5px and would read as a hit-target regression.
  await page.waitForFunction(() => {
    const panel = document.querySelector('.redeven-environment-settings-dialog');
    if (!panel) return false;
    const { transform, opacity } = getComputedStyle(panel);
    return (transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)') && opacity === '1';
  });
  const touchFields = await page.locator('.ssh-settings-form input:not([type="checkbox"]), .ssh-settings-form select').evaluateAll(fields => fields.map(field => ({
    size: getComputedStyle(field).fontSize,
    height: field.getBoundingClientRect().height,
  })));
  assert.ok(touchFields.length > 0);
  for (const field of touchFields) {
    assert.equal(field.size, '16px');
    assert.ok(field.height >= 44);
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
