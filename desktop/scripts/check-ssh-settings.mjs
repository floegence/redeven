import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
const require = createRequire(new URL('../../internal/envapp/ui_src/package.json', import.meta.url));
const axePath = require.resolve('axe-core/axe.min.js');
const base = process.env.REDEVEN_SSH_PREVIEW_URL || 'http://127.0.0.1:43817';
const output =
  process.env.REDEVEN_SSH_PREVIEW_OUTPUT || fileURLToPath(new URL('../dist/ssh-settings-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
async function open(locale = 'en-US', theme = 'dark', suffix = '') {
  await page.goto(`${base}/ssh-settings.html?locale=${locale}&theme=${theme}${suffix}`);
  await page.locator('#fixture-open').click();
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
  for (const theme of ['dark', 'light']) {
    for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU']) {
      await open(locale, theme);
      const bounds = await geometry();
      assert.equal(bounds.width, 640);
      assert.equal(bounds.horizontalOverflow, false, `${theme}/${locale}: horizontal overflow`);
      assert.ok(bounds.footerBottom < 800, `${theme}/${locale}: actions clipped`);
      assert.equal(bounds.scroll, 0, `${theme}/${locale}: default view scrolls`);
      if (locale === 'zh-CN' || locale === 'en-US')
        await page.screenshot({ path: `${output}/${theme}-${locale}.png`, animations: 'disabled' });
    }
  }
  await open();
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
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      themes: 2,
      locales: 10,
      scenarios: [
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
}
