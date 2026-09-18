import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_ACCESS_OUTPUT || fileURLToPath(new URL('../dist/access-settings-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], output, cases: [], errors: [], status: 'running' };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  const dialog = page.getByRole('dialog');
  async function open(locale = 'en-US', preset = 'classic-light', target = 'Local Environment', suffix = '') {
    await page.goto(`${report.url}environment-endpoints.html?locale=${locale}&preset=${preset}${suffix}`);
    await page.locator(`[data-environment="${target}"] > button`).click();
    await page.locator('#local-ui-port').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-floe-dialog-panel]')).opacity === '1');
  }
  async function capture(name) { await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' }); }
  async function geometry() {
    return dialog.evaluate(panel => {
      const body = panel.querySelector('.environment-settings-scroll');
      const port = panel.querySelector('#local-ui-port').getBoundingClientRect();
      const password = panel.querySelector('#local-ui-password').getBoundingClientRect();
      const bounds = panel.getBoundingClientRect();
      return { width: bounds.width, right: bounds.right, left: bounds.left, bottom: bounds.bottom,
        overflow: body.scrollWidth > body.clientWidth || panel.scrollWidth > panel.clientWidth, scroll: body.scrollHeight - body.clientHeight,
        portWidth: port.width, passwordWidth: password.width, portRight: port.right, passwordRight: password.right };
    });
  }
  await open('zh-CN');
  await capture('local-zh-CN');
  const initial = await geometry();
  report.initial = initial;
  assert.ok(initial.portWidth <= 128, 'port is a compact numeric field, not a full-width text field');
  assert.ok(initial.passwordWidth <= 320, 'password has a comfortable reading width');
  assert.ok(Math.abs(initial.portRight - initial.passwordRight) < 1, 'controls share one trailing alignment');
  assert.ok(initial.scroll <= 1, 'default Local access settings fit at a standard desktop height');
  report.cases.push('local-control-proportions-and-alignment');

  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'];
  for (const preset of (process.argv.includes('--interactions-only') ? [] : builtInShellThemePresets)) {
    for (const locale of locales) {
      await open(locale, preset.name);
      const layout = await geometry();
      assert.equal(layout.overflow, false, `${preset.name}/${locale}: horizontal overflow`);
      assert.ok(layout.bottom <= 900 && layout.left >= 0 && layout.right <= 1280, `${preset.name}/${locale}: clipped dialog`);
      if (['classic-light', 'ocean'].includes(preset.name) && ['zh-CN', 'en-US'].includes(locale)) await capture(`local-${preset.name}-${locale}`);
    }
  }
  if (!process.argv.includes('--interactions-only')) report.cases.push(`${builtInShellThemePresets.length}-themes-by-${locales.length}-locales`);
  await open();
  const focusStyles = await page.locator('#local-ui-port').evaluate(async input => {
    input.blur();
    const read = () => {
      const style = getComputedStyle(input), bounds = input.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, padding: style.padding,
        border: style.borderWidth, background: style.backgroundColor, shadow: style.boxShadow, outline: style.outlineStyle, color: style.borderColor };
    };
    const before = read(); input.focus();
    await Promise.all(input.getAnimations().map(animation => animation.finished.catch(() => {})));
    return { before, after: read() };
  });
  for (const key of ['width', 'height', 'padding', 'border', 'background', 'shadow']) assert.equal(focusStyles.before[key], focusStyles.after[key], `focus changes ${key}`);
  assert.equal(focusStyles.after.outline, 'none');
  assert.notEqual(focusStyles.before.color, focusStyles.after.color);
  report.cases.push('published-input-focus-boundary');
  await page.locator('#local-ui-port').fill('25000');
  assert.ok((await dialog.innerText()).includes('http://localhost:23998/'), 'editing never changes the running address');
  await dialog.getByRole('button', { name: 'Save for next restart', exact: true }).click();
  assert.equal(await page.locator('#local-ui-port').inputValue(), '25000');
  assert.ok((await dialog.innerText()).includes('Changes not yet applied'));
  await capture('local-pending');
  await dialog.getByRole('button', { name: 'Save and restart', exact: true }).click();
  assert.equal(await dialog.getByText('Changes not yet applied', { exact: true }).count(), 0);
  await dialog.getByRole('radio', { name: 'HTTPS · Recommended', exact: true }).click();
  await dialog.getByText('Ready', { exact: true }).waitFor();
  await capture('local-https');
  const require = createRequire(new URL('../../internal/envapp/ui_src/package.json', import.meta.url));
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => (await window.axe.run('.redeven-environment-settings-dialog', {
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'],
  })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
  assert.deepEqual(violations, []);
  report.cases.push('save-timings-https-and-accessibility');

  await open('en-US', 'ocean', 'gzcom');
  assert.equal(await dialog.getByRole('button', { name: 'Copy Environment URL' }).count(), 0);
  await capture('remote-ocean');
  await open('en-US', 'classic-light', 'Local Environment', '&save-error=1');
  await page.locator('#local-ui-port').fill('25100');
  await dialog.getByRole('button', { name: 'Save for next restart', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await page.locator('#local-ui-port').inputValue(), '25100');
  await capture('local-save-error');
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  assert.equal(await page.locator('#local-ui-port').inputValue(), '23998');
  report.cases.push('remote-loopback-and-save-failure-draft');

  for (const locale of ['en-US', 'zh-CN', 'de-DE']) {
    await page.setViewportSize({ width: 390, height: 700 });
    await open(locale);
    assert.equal((await geometry()).overflow, false);
    await page.locator('summary').click();
    const footerBefore = await page.locator('.environment-settings-actions').boundingBox();
    const body = page.locator('.environment-settings-scroll');
    await body.hover();
    await page.mouse.wheel(0, 700);
    await page.waitForFunction(() => document.querySelector('.environment-settings-scroll').scrollTop > 0);
    assert.equal((await page.locator('.environment-settings-actions').boundingBox()).y, footerBefore.y, 'actions stay fixed while the body scrolls');
    await capture(`narrow-${locale}`);
    await page.addStyleTag({ content: '.redeven-environment-settings-dialog :is(input, button, label, p, span, summary) { font-size: 24px !important; }' });
    assert.equal((await geometry()).overflow, false, `${locale}: enlarged text overflows`);
    assert.equal(await page.locator('.environment-settings-actions').evaluate(footer => [...footer.querySelectorAll('button')].every(button => button.scrollHeight <= button.clientHeight + 1)), true, `${locale}: action text must fit inside its button`);
    await page.locator('.environment-settings-actions button').last().scrollIntoViewIfNeeded();
    await capture(`large-text-${locale}`);
  }
  report.cases.push('narrow-enlarged-text-and-real-scroll');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log(`Access settings passed: ${report.cases.length} scenarios. Evidence: ${output}`);
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
