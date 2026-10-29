import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/welcome-form-alignment-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['ssh-settings.html', 'environment-endpoints.html', 'environment-settings.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [], url: server.resolvedUrls.local[0], status: 'running' };
try {
  const load = path => server.ssrLoadModule(fileURLToPath(new URL(path, import.meta.url)));
  const { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } = await load('../src/shared/i18n/index.ts');
  const { mixedEnvironmentFixture } = await load('../src/testSupport/mixedEnvironmentFixture.ts');
  const observe = page => page.on('pageerror', error => report.errors.push(error.message));
  const settle = page => page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const fieldGeometry = input => input.evaluate(element => {
    const root = element.parentElement.parentElement;
    const field = element.getBoundingClientRect();
    const bounds = root.getBoundingClientRect();
    const indicator = root.querySelector('[data-floe-status-indicator]').getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: field.x, y: field.y, width: field.width, height: field.height,
      rightGap: bounds.right - field.right, leftGap: field.left - bounds.left,
      padding: parseFloat(style.paddingRight), indicatorWidth: indicator.width,
      indicatorRight: indicator.right, right: field.right };
  });
  function aligned(geometry, name) {
    assert.ok(Math.abs(geometry.rightGap) <= 1 && Math.abs(geometry.leftGap) <= 1, `${name}: SSH input must fill its field: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.indicatorRight <= geometry.right && geometry.padding >= geometry.indicatorWidth + 2, `${name}: feedback fits inside the text inset`);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  observe(page);
  for (const locale of REDEVEN_SUPPORTED_LOCALES) for (const theme of ['light', 'dark']) {
    await page.goto(`${report.url}environment-endpoints.html?locale=${locale}&theme=${theme}`);
    await page.locator('[data-environment="Local Environment"] > button').click();
    await page.getByRole('button', { name: createDesktopI18n(locale).t('accessFlow.changeAccess'), exact: true }).click();
    for (const width of [1280, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page);
      const steps = await page.locator('.access-flow-steps').evaluate(ol => {
        const rect = ol.getBoundingClientRect();
        const vertical = getComputedStyle(ol).flexDirection === 'column';
        return { vertical, overflow: ol.scrollWidth > ol.clientWidth + 1, steps: [...ol.children].map(li => {
          const range = document.createRange(); range.selectNodeContents(li.lastChild);
          const label = range.getBoundingClientRect();
          const box = li.getBoundingClientRect();
          const connector = getComputedStyle(li, '::after');
          return { left: box.left, right: box.right, labelRight: label.right,
            connector: parseFloat(connector.width) || 0, connectorVisible: connector.content !== 'none' && connector.display !== 'none',
            gap: parseFloat(getComputedStyle(li).gap), margin: parseFloat(connector.marginInlineStart) || 0,
            clipped: box.left < rect.left - 1 || box.right > rect.right + 1 };
        }) };
      });
      const name = `steps-${locale}-${theme}-${width}`;
      assert.equal(steps.overflow, false, `${name}: stepper overflow`);
      assert.equal(steps.steps.some(step => step.clipped), false, `${name}: clipped step`);
      if (steps.vertical) {
        assert.equal(steps.steps.some(step => step.connectorVisible), false, `${name}: vertical steps omit horizontal connectors`);
        assert.ok(steps.steps.every(step => Math.abs(step.left - steps.steps[0].left) <= 1), `${name}: number badges align`);
      } else {
        for (const step of steps.steps.slice(0, -1)) {
          assert.ok(step.connectorVisible && step.connector >= 8, `${name}: connector follows each non-final step`);
          assert.ok(Math.abs(step.right - step.labelRight - step.connector - step.gap - step.margin) <= 1, `${name}: no unexplained space after the label`);
        }
        assert.ok(Math.abs(steps.steps[0].connector - steps.steps[1].connector) <= 1, `${name}: connectors share the available space evenly`);
      }
      report.cases.push(name);
      if (locale === 'zh-CN' && [1280, 390].includes(width)) await page.screenshot({ path: `${output}/${name}.png` });
    }
  }
  await page.close();
  for (const hasTouch of [false, true]) {
    const context = await browser.newContext({ viewport: { width: hasTouch ? 390 : 1280, height: 900 }, hasTouch, reducedMotion: 'reduce' });
    const page = await context.newPage(); observe(page);
    for (const theme of ['light', 'dark']) {
      const name = `ssh-edit-${hasTouch ? 'touch' : 'mouse'}-${theme}`;
      await page.goto(`${report.url}ssh-settings.html?locale=en-US&theme=${theme}`);
      await page.locator('#fixture-open').click(); await settle(page);
      const input = page.locator('#ssh-settings-ssh_destination');
      const baseline = await fieldGeometry(input); aligned(baseline, name);
      const label = await page.locator('#ssh-settings-label').boundingBox();
      assert.ok(Math.abs(baseline.right - label.x - label.width) <= 1, `${name}: name and SSH destination share their right edge`);
      await input.fill('gzc');
      const node = await input.elementHandle();
      for (const loading of [true, false]) {
        await page.evaluate(value => window.sshSettingsFixture.setHostsLoading(value), loading); await settle(page);
        assert.deepEqual(await fieldGeometry(input), baseline, `${name}: loading preserves field geometry`);
        assert.equal(await input.evaluate((element, previous) => element === previous && document.activeElement === element, node), true, `${name}: loading retains the focused draft`);
      }
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      assert.equal(await input.inputValue(), 'gzcom', `${name}: keyboard selection survives feedback changes`);
      await page.evaluate(() => window.sshSettingsFixture.setHostsError(true)); await settle(page);
      assert.deepEqual(await fieldGeometry(input), baseline, `${name}: error preserves field geometry`);
      const feedback = page.getByRole('button', { name: /^Desktop could not read the SSH configuration\./ });
      await feedback.click();
      await page.locator('[data-floe-status-details]').getByRole('button', { name: 'Retry', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.id === 'ssh-settings-ssh_destination');
      assert.deepEqual(await fieldGeometry(input), baseline, `${name}: retry preserves field geometry`);
      await page.keyboard.press('Escape');
      const box = await input.boundingBox();
      await page.locator('#ssh-settings-label').focus();
      await input.click({ position: { x: box.width - 10, y: box.height / 2 } });
      assert.equal(await input.evaluate(element => document.activeElement === element), true, `${name}: empty feedback slot accepts input clicks`);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `${output}/${name}.png` });
      report.cases.push(name);
    }
    await context.close();
  }
  for (const locale of ['en-US', 'zh-CN', 'de-DE']) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390, reducedMotion: 'reduce' });
    const page = await context.newPage(); observe(page);
    const i18n = createDesktopI18n(locale);
    await page.addInitScript(({ snapshot, locale }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot: mixedEnvironmentFixture().snapshot, locale });
    await page.goto(`${report.url}environment-settings.html`);
    await page.getByRole('button', { name: i18n.t('environmentCenter.newEnvironmentTitle'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    for (const kind of ['sshHost', 'sshContainer']) {
      await dialog.getByRole('radio', { name: i18n.t(`connectionDialog.${kind}`), exact: true }).click();
      const input = page.locator(kind === 'sshHost' ? '#ssh-settings-ssh_destination' : '#environment-ssh-destination');
      await input.waitFor(); await settle(page);
      const name = `create-${kind}-${locale}-${width}`;
      aligned(await fieldGeometry(input), name);
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `${name}: dialog overflow`);
      if (locale === 'zh-CN') await page.screenshot({ path: `${output}/${name}.png` });
      report.cases.push(name);
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.message;
  throw error;
} finally {
  await browser.close(); await server.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output, errors: report.errors }));
}
