import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';
const output = fileURLToPath(
  new URL('../dist/two-factor-acceptance/', import.meta.url),
);
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [1024, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto(`${server.resolvedUrls.local[0]}two-factor.html`);
    await page.getByRole('button', { name: 'Set up', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await page
      .getByRole('textbox', { name: 'Authenticator code', exact: true })
      .fill('012 345');
    assert.equal(
      await page.evaluate(() =>
        window.securityRequests.some((r) => r.action === 'verify'),
      ),
      false,
    );
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: `${output}/scan-${width}.png`,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .getByText('I’ve saved my recovery codes', { exact: true })
      .waitFor();
    assert.equal(await dialog.locator('code').count(), 8);
    assert.equal(
      await page
        .getByRole('button', { name: 'Enable two-factor', exact: true })
        .isEnabled(),
      false,
    );
    const geometry = await dialog.evaluate((e) => ({
      overflow: e.scrollWidth > e.clientWidth,
      left: e.getBoundingClientRect().left,
      right: e.getBoundingClientRect().right,
    }));
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.left >= 0 && geometry.right <= width);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: `${output}/recovery-${width}.png`,
      animations: 'disabled',
    });
    await page
      .getByText('I’ve saved my recovery codes', { exact: true })
      .click();
    assert.equal(await page.getByRole('checkbox').isChecked(), true);
    await page
      .getByRole('button', { name: 'Enable two-factor', exact: true })
      .click();
    await page.getByRole('button', { name: 'Manage', exact: true }).waitFor();
    assert.equal(await page.locator('code').count(), 0);
  }
  await page.goto(
    `${server.resolvedUrls.local[0]}two-factor.html?new-password=1`,
  );
  await page.getByRole('button', { name: 'Set up', exact: true }).click();
  await page
    .getByLabel('New environment password', { exact: true })
    .fill('test-environment-password');
  await page.getByLabel('Confirm password', { exact: true }).fill('different');
  assert.equal(
    await page
      .getByRole('button', { name: 'Continue', exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByLabel('Confirm password', { exact: true })
    .fill('test-environment-password');
  assert.equal(
    await page
      .getByRole('button', { name: 'Continue', exact: true })
      .isEnabled(),
    true,
  );
  for (const locale of [
    'en-US',
    'zh-CN',
    'zh-TW',
    'ja-JP',
    'ko-KR',
    'fr-FR',
    'de-DE',
    'es-ES',
    'pt-BR',
    'ru-RU',
  ]) {
    for (const theme of ['light', 'dark']) {
      await page.goto(
        `${server.resolvedUrls.local[0]}two-factor.html?locale=${locale}&theme=${theme}`,
      );
      await page.waitForFunction(
        (dark) => document.documentElement.classList.contains('dark') === dark,
        theme === 'dark',
      );
      await page.locator('.environment-access-control button').click();
      const panel = page.getByRole('dialog');
      await panel.locator('img').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `${output}/scan-${locale}-${theme}.png`,
        animations: 'disabled',
      });
      await panel.locator('input').fill('012345');
      await panel.locator('form button').click();
      await panel.locator('code').first().waitFor();
      const overflow = await panel.evaluate(
        (e) => e.scrollWidth > e.clientWidth,
      );
      assert.equal(overflow, false, `${locale}/${theme}: horizontal overflow`);
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `${output}/recovery-${locale}-${theme}.png`,
        animations: 'disabled',
      });
    }
  }
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1100, height: 820 });
    await page.goto(
      `${server.resolvedUrls.local[0]}two-factor.html?full=1&theme=${theme}`,
    );
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains('dark') === dark,
      theme === 'dark',
    );
    await page.locator('.two-factor-setting button').click();
    const panel = page.locator('.two-factor-dialog');
    await panel.locator('img').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: `${output}/settings-scan-${theme}.png`,
      animations: 'disabled',
    });
    await panel.locator('summary').click();
    await panel
      .getByRole('button', { name: 'Copy setup key', exact: true })
      .click();
    await panel.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    await panel.locator('input').fill('012345');
    await panel.locator('form button').click();
    await panel.locator('code').first().waitFor();
    await panel
      .getByRole('button', { name: 'Copy codes', exact: true })
      .click();
    await panel.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: `${output}/settings-recovery-${theme}.png`,
      animations: 'disabled',
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'Two-factor settings: QR, explicit code verification, recovery acknowledgement, new password confirmation, and 320px layout passed',
  );
} finally {
  await browser.close();
  await server.close();
}
