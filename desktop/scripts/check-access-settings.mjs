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
  const { createDesktopI18n } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/index.ts', import.meta.url)));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  const dialog = page.getByRole('dialog');
  let t = createDesktopI18n('en-US').t;
  const button = key => dialog.getByRole('button', { name: t(key), exact: true });
  const body = () => dialog.locator('.environment-settings-scroll:visible');
  const footer = () => dialog.locator('.environment-settings-actions:visible');
  async function open(locale = 'en-US', preset = 'classic-light', target = 'Local Environment', suffix = '') {
    t = createDesktopI18n(locale).t;
    await page.goto(`${report.url}environment-endpoints.html?locale=${locale}&preset=${preset}${suffix}`);
    await page.locator(`[data-environment="${target}"] > button`).click();
    await button('accessFlow.changeAccess').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-floe-dialog-panel]')).opacity === '1');
  }
  const capture = name => page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
  async function layout(name) {
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1 && bounds.y + bounds.height <= page.viewportSize().height + 1, `${name}: clipped dialog`);
    assert.equal(await dialog.evaluate(panel => panel.scrollWidth > panel.clientWidth), false, `${name}: dialog overflow`);
    assert.equal(await body().evaluate(el => el.scrollWidth > el.clientWidth), false, `${name}: content overflow`);
    assert.equal(await dialog.evaluate(panel => panel.scrollHeight > panel.clientHeight), false, `${name}: only the body scrolls`);
    const wrappedLabels = await dialog.evaluate(panel => {
      const failures = [];
      for (const button of panel.querySelectorAll('button')) {
        if (!button.checkVisibility()) continue;
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim() || !node.parentElement.checkVisibility({ visibilityProperty: true }) || node.parentElement.closest('[aria-hidden="true"]')) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          if (new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => rect.top)).size > 1) failures.push(node.textContent);
        }
      }
      return failures;
    });
    assert.deepEqual(wrappedLabels, [], `${name}: button labels must stay on one line`);
    const before = await footer().boundingBox();
    await body().evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal((await footer().boundingBox()).y, before.y, `${name}: footer moves while reading`);
    await body().evaluate(el => { el.scrollTop = 0; });
  }
  async function editAccess() {
    await button('accessFlow.changeAccess').click();
    await dialog.locator('.environment-access-advanced summary').click();
  }
  async function assertA11y() {
    const require = createRequire(new URL('../../internal/envapp/ui_src/package.json', import.meta.url));
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => (await window.axe.run('.redeven-environment-settings-dialog', {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'],
    })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    assert.deepEqual(violations, []);
  }
  await open('zh-CN'); await layout('overview'); await capture('overview-zh-CN');
  assert.equal(await page.locator('#local-ui-port').count(), 0, 'opening shows tasks, not unrelated fields');
  await editAccess(); await layout('access'); await capture('access-zh-CN');
  assert.ok((await page.locator('#local-ui-port').boundingBox()).width <= 128, 'port remains compact');
  report.cases.push('task-overview-and-fixed-footer');

  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'];
  const presets = process.argv.includes('--interactions-only') ? builtInShellThemePresets.filter(p => ['classic-light', 'ocean'].includes(p.name)) : builtInShellThemePresets;
  for (const preset of presets) for (const locale of locales) {
    await open(locale, preset.name); await layout(`${preset.name}/${locale}/overview`);
    await button('accessFlow.changeAccess').click(); await layout(`${preset.name}/${locale}/access`);
    if (['zh-CN', 'en-US'].includes(locale) && ['classic-light', 'ocean'].includes(preset.name)) await capture(`access-${preset.name}-${locale}`);
  }
  report.cases.push(`${presets.length}-themes-by-${locales.length}-locales`);
  await open(); await editAccess();
  await page.locator('#local-ui-port').click();
  const focus = await page.locator('#local-ui-port').evaluate(async input => {
    input.blur();
    const read = () => { const s = getComputedStyle(input), b = input.getBoundingClientRect(); return { width: b.width, height: b.height, padding: s.padding, border: s.borderWidth, background: s.backgroundColor, shadow: s.boxShadow, outline: s.outlineStyle, color: s.borderColor }; };
    await Promise.all(input.getAnimations().map(a => a.finished.catch(() => {})));
    const before = read(); input.focus(); await Promise.all(input.getAnimations().map(a => a.finished.catch(() => {}))); return { before, after: read(), focused: document.activeElement === input };
  });
  for (const key of ['width', 'height', 'padding', 'border', 'background', 'shadow']) assert.equal(focus.before[key], focus.after[key]);
  assert.equal(focus.focused, true);
  assert.equal(focus.after.outline, 'none'); assert.notEqual(focus.before.color, focus.after.color);
  await page.locator('#local-ui-port').fill('99999'); await button('accessFlow.checkChanges').click();
  assert.equal(await page.locator('#local-ui-port').evaluate(el => el === document.activeElement), true);
  await page.locator('#local-ui-port').fill('25000'); await button('accessFlow.checkChanges').click();
  await button('settings.saveForNextRestart').click(); await button('accessFlow.changeAccess').waitFor();
  await dialog.locator('.redeven-address-group--summary > summary').click();
  await dialog.getByText('http://localhost:23998/', { exact: true }).waitFor();
  assert.ok((await dialog.innerText()).includes('http://localhost:23998/'), 'saved draft does not replace the current connection');
  await dialog.getByText(t('settings.pendingChanges'), { exact: true }).waitFor();
  await capture('saved-for-later'); await button('accessFlow.checkChanges').click(); await button('settings.saveAndRestart').click();
  assert.equal(await page.evaluate(() => window.accessFixture.draft.local_ui_bind), 'localhost:25000');
  report.cases.push('input-focus-validation-and-save-timings');

  await open(); await button('accessFlow.changeAccess').click(); await button('settings.sharedLocalNetworkLabel').click(); await button('accessFlow.checkChanges').click();
  await page.locator('#local-ui-password').fill('test-only-password'); await page.locator('#access-password-confirm').fill('mismatch'); await button('security.continue').click();
  await footer().getByRole('alert').waitFor(); assert.equal(await page.locator('#access-password-confirm').evaluate(el => el === document.activeElement), true);
  await page.locator('#access-password-confirm').fill('test-only-password'); await button('security.continue').click();
  assert.ok(!(await dialog.locator('.access-flow-review').innerText()).includes('test-only-password'));
  await capture('network-review'); await assertA11y(); await button('settings.saveForNextRestart').click();
  assert.equal(await page.evaluate(() => window.accessFixture.draft.local_ui_password), '');
  report.cases.push('network-password-confirmation-and-secret-free-review');

  await open('en-US', 'classic-light', 'Local Environment', '&secure=enabled');
  await button('accessFlow.changeAccess').click(); await dialog.getByRole('radio', { name: 'HTTP', exact: true }).click(); await button('accessFlow.verifyContinue').click();
  await capture('protected-change-plan'); await button('accessFlow.verifyContinue').click();
  assert.equal(await dialog.count(), 1, 'owner verification is part of the same dialog');
  await dialog.getByLabel(t('security.password'), { exact: true }).fill('wrong'); await dialog.getByLabel(t('security.code'), { exact: true }).fill('123456'); await button('security.continue').click();
  await footer().getByRole('alert').waitFor(); await capture('verification-error-near-action');
  await dialog.getByLabel(t('security.password'), { exact: true }).fill('test-only-owner'); await button('security.continue').click();
  await button('security.disable').click(); await dialog.locator('.access-flow-review').waitFor();
  assert.equal(await page.evaluate(() => window.accessFixture.security.enabled), false);
  assert.equal(await page.evaluate(() => window.accessFixture.requests.filter(r => r.action === 'commit').length), 1);
  await button('common.cancel').click(); await dialog.getByText(t('accessFlow.securityDisabled'), { exact: true }).waitFor();
  report.cases.push('protected-http-explicit-identity-commit-and-cancel');

  for (const preset of ['classic-light', 'ocean']) for (const locale of locales) {
    await open(locale, preset, 'Local Environment', '&secure=enabled');
    await button('accessFlow.manageProtection').click(); await button('security.manage').click(); await button('security.disable').click();
    await layout(`${preset}/${locale}/authenticator-code`);
    const code = dialog.getByLabel(t('security.code'), { exact: true });
    const password = dialog.getByLabel(t('security.password'), { exact: true });
    assert.ok((await code.locator('..').locator('..').boundingBox()).width < (await password.boundingBox()).width);
    assert.equal(await code.getAttribute('autocomplete'), 'one-time-code');
    assert.equal(await code.getAttribute('inputmode'), 'numeric');
    await password.fill('test-only-owner'); await code.fill('12345');
    assert.equal(await button('security.continue').isEnabled(), false);
    await code.press('Enter');
    assert.equal(await page.evaluate(() => window.accessFixture.requests.filter(r => r.action === 'disable').length), 0);
    await code.fill('012 345'); assert.equal(await code.inputValue(), '012345');
    await code.press('End'); await code.press('ArrowLeft'); await code.press('Backspace');
    assert.equal(await code.inputValue(), '01235');
    await code.press('4'); assert.equal(await code.inputValue(), '012345');
    for (let step = 0; step < 6; step++) await code.press('ArrowLeft');
    await code.press('Shift+ArrowRight'); await code.press('9');
    assert.equal(await code.inputValue(), '912345');
    await code.fill('012345'); await code.press('End');
    const codeFocus = await code.evaluate(async input => {
      const surface = input.closest('[data-floe-input-surface]');
      const read = () => { const s = getComputedStyle(surface), b = surface.getBoundingClientRect(); return { width: b.width, height: b.height, border: s.borderWidth, background: s.background, shadow: s.boxShadow, color: s.borderColor }; };
      input.blur(); await Promise.all(input.getAnimations().map(a => a.finished.catch(() => {}))); const before = read();
      input.focus(); await Promise.all(input.getAnimations().map(a => a.finished.catch(() => {})));
      return { before, after: read(), inputScroll: input.scrollLeft, surfaceScroll: surface.scrollLeft, outline: getComputedStyle(input).outlineStyle };
    });
    for (const key of ['width', 'height', 'border', 'background', 'shadow']) assert.equal(codeFocus.before[key], codeFocus.after[key]);
    assert.notEqual(codeFocus.before.color, codeFocus.after.color);
    assert.equal(codeFocus.outline, 'none'); assert.equal(codeFocus.inputScroll, 0); assert.equal(codeFocus.surfaceScroll, 0);
    if (locale === 'zh-CN') { await capture(`six-digit-code-${preset}`); await assertA11y(); }
    await button('security.useRecovery').click();
    const recovery = dialog.getByLabel(t('security.recoveryCode'), { exact: true });
    assert.equal(await recovery.inputValue(), '');
    assert.equal(await recovery.getAttribute('inputmode'), 'text');
    await recovery.fill('recovery-abcd-1234');
    await button('security.useAuthenticator').click(); assert.equal(await code.inputValue(), '');
    assert.equal(await code.evaluate(input => input === document.activeElement), true);
  }
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const ownerCode = dialog.getByLabel(t('security.code'), { exact: true });
  await page.evaluate(() => navigator.clipboard.writeText('123 456'));
  await ownerCode.press('ControlOrMeta+V'); assert.equal(await ownerCode.inputValue(), '123456');
  await ownerCode.fill('000000'); await button('security.continue').click(); await footer().getByRole('alert').waitFor();
  assert.equal(await ownerCode.getAttribute('aria-invalid'), 'true');
  await ownerCode.fill('123456'); await button('security.continue').click();
  await dialog.getByText(t('security.disableHelp'), { exact: true }).waitFor();
  await button('security.disable').click();
  assert.equal(await page.evaluate(() => window.accessFixture.security.enabled), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await open('zh-CN', 'ocean', 'Local Environment', '&secure=enabled');
  await button('accessFlow.manageProtection').click(); await button('security.manage').click(); await button('security.disable').click();
  await dialog.getByLabel(t('security.code'), { exact: true }).fill('012345'); await layout('six-digit-code-narrow'); await capture('six-digit-code-narrow');
  await page.addStyleTag({ content: 'html { font-size: 24px !important; }' });
  await layout('six-digit-code-enlarged'); await capture('six-digit-code-enlarged');
  await page.setViewportSize({ width: 1280, height: 900 });
  report.cases.push('six-digit-code-editing-paste-recovery-focus-and-20-localized-layouts');

  await open('en-US', 'ocean', 'Local Environment', '&secure=ready');
  await button('accessFlow.manageProtection').click(); await button('security.setup').click();
  await capture('authenticator-ocean');
  await dialog.locator('#two-factor-verify input').fill('123456'); await button('security.continue').click();
  await dialog.getByText(t('security.recoveryTitle'), { exact: true }).waitFor();
  assert.equal(await button('security.enable').isEnabled(), false);
  await capture('recovery-codes-ocean'); await dialog.getByText(t('security.saved'), { exact: true }).click();
  assert.equal(await dialog.getByRole('checkbox', { name: t('security.saved'), exact: true }).isChecked(), true); await button('security.enable').click();
  assert.equal(await page.evaluate(() => window.accessFixture.security.enabled), true);
  report.cases.push('inline-enrollment-and-explicit-recovery-confirmation');

  await open('en-US', 'classic-light', 'Local Environment', '&missing-certificate=1');
  await button('accessFlow.manageProtection').click(); await button('security.configureHTTPS').click();
  const blocked = dialog.locator('[data-redeven-tooltip-anchor]').filter({ has: page.getByRole('button', { name: t('settings.saveAndRestart'), exact: true }) });
  await blocked.focus(); await page.getByRole('tooltip').waitFor();
  await button('settings.generateCertificate').click();
  assert.equal(await page.evaluate(() => window.accessFixture.requests.filter(r => r.operation === 'install').length), 0, 'creation never installs trust');
  await button('settings.trustCertificate').click(); await dialog.getByText(t('settings.certificateTrusted'), { exact: true }).waitFor();
  await button('accessFlow.exportCertificate').click(); await dialog.getByText(t('accessFlow.certificateExported'), { exact: true }).waitFor();
  await capture('https-prepared'); await assertA11y();
  report.cases.push('https-prerequisite-tooltip-create-trust-export');

  await open('en-US', 'classic-light', 'Local Environment', '&missing-certificate=1&certificate-error=1');
  await button('accessFlow.manageProtection').click(); await button('security.configureHTTPS').click(); await button('settings.generateCertificate').click();
  await dialog.getByRole('alert').waitFor(); assert.equal(await button('settings.saveAndRestart').isEnabled(), false);
  await capture('certificate-failure'); report.cases.push('certificate-failure-blocks-restart');
  await open('en-US', 'classic-light', 'Local Environment', '&save-error=1'); await editAccess(); await page.locator('#local-ui-port').fill('25100'); await button('accessFlow.checkChanges').click();
  const reviewGeometry = () => dialog.locator('.access-flow-review, .environment-settings-actions:visible, .environment-access-actions:visible > button').evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height };
  }));
  const beforeSaveError = await reviewGeometry();
  await button('settings.saveForNextRestart').click();
  await footer().getByRole('alert').waitFor();
  assert.deepEqual(await reviewGeometry(), beforeSaveError, 'save errors retain review and action geometry'); assert.equal(await page.evaluate(() => window.accessFixture.draft.local_ui_bind), 'localhost:25100');
  await capture('save-error-near-action'); await button('common.cancel').click(); await button('settings.discardChanges').click();
  assert.equal(await page.evaluate(() => window.accessFixture.draft.local_ui_bind), 'localhost:23998');
  report.cases.push('save-failure-retains-draft-and-local-error');

  for (const locale of ['en-US', 'zh-CN', 'de-DE', 'fr-FR', 'ru-RU']) {
    await page.setViewportSize({ width: 390, height: 700 }); await open(locale, locale === 'de-DE' ? 'ocean' : 'classic-light');
    await layout(`narrow-${locale}-overview`); await capture(`narrow-${locale}-overview`); await editAccess(); await layout(`narrow-${locale}-access`);
    const before = await footer().boundingBox(); await body().hover(); await page.mouse.wheel(0, 700);
    await page.waitForFunction(() => [...document.querySelectorAll('.environment-settings-scroll')].some(el => el.scrollTop > 0));
    assert.equal((await footer().boundingBox()).y, before.y); await capture(`narrow-${locale}-access`);
    await page.addStyleTag({ content: '.redeven-environment-settings-dialog :is(input, button, label, p, span, summary) { font-size: 24px !important; }' });
    await layout(`large-text-${locale}`);
    assert.equal(await footer().evaluate(el => [...el.querySelectorAll('button')].every(b => b.scrollHeight <= b.clientHeight + 1)), true);
    await capture(`large-text-${locale}`);
  }
  report.cases.push('narrow-dark-localized-large-text-and-real-scroll');
  for (const locale of locales) {
    await page.setViewportSize({ width: 320, height: 800 });
    await open(locale, 'classic-light', 'Local Environment', '&missing-certificate=1');
    await button('accessFlow.manageProtection').click(); await button('security.configureHTTPS').click();
    await layout(`single-line-${locale}-certificate-create`);
    await button('settings.generateCertificate').click();
    await button('settings.certificateManage').waitFor();
    await layout(`single-line-${locale}-certificate-ready`);
    await button('settings.certificateManage').click();
    await layout(`single-line-${locale}-certificate-manage`);
    await open(locale, 'ocean', 'Local Environment', '&secure=ready');
    await button('accessFlow.manageProtection').click(); await button('security.setup').click();
    await dialog.locator('#two-factor-verify input').fill('123456'); await button('security.continue').click();
    await dialog.getByText(t('security.recoveryTitle'), { exact: true }).waitFor();
    await layout(`single-line-${locale}-recovery-actions`);
  }
  report.cases.push('single-line-certificate-and-recovery-actions-in-10-locales-at-320px');

  assert.deepEqual(report.errors, []); report.status = 'passed';
  console.log(`Access settings passed: ${report.cases.length} scenarios. Evidence: ${output}`);
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
