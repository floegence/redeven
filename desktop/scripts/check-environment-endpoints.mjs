import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_ENDPOINT_OUTPUT || fileURLToPath(new URL('../dist/environment-endpoint-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const portProbe = net.createServer();
await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve); });
const port = portProbe.address().port;
await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));
const server = await createSSHSettingsPreviewServer(port);
const browser = await chromium.launch({ headless: true });
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], output, errors: [], cases: [], status: 'running',
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(new URL('environment-endpoints.html', report.url).href);
  for (const name of ['Local Environment', 'gzcom', 'gzlight', 'Network']) {
    const card = page.locator(`[data-environment="${name}"]`);
    const trigger = card.getByLabel('显示端点');
    await trigger.click();
    const popup = page.locator('.redeven-endpoints-popover');
    await popup.waitFor();
    assert.ok((await popup.innerText()).includes(name));
    const network = name === 'Network';
    assert.equal(await popup.getByLabel('分享连接').count(), network ? 1 : 0);
    assert.equal(await popup.getByLabel('复制环境 URL').count(), network || name === 'Local Environment' ? 1 : 0);
    assert.equal(await popup.getByLabel('在浏览器中打开').count(), network || name === 'Local Environment' ? 1 : 0);
    if (network || name === 'Local Environment') {
      await popup.getByLabel('在浏览器中打开').click();
      assert.equal(await page.locator('[data-copy-result]').innerText(), network ? 'https://192.0.2.20:23998/' : 'http://localhost:23998/');
    }
    if (name === 'gzcom' || name === 'gzlight') {
      assert.ok((await popup.innerText()).includes(`仅在 ${name}:22 上可用。`));
      await popup.getByRole('button', { name: /复制 SSH/ }).click();
      assert.equal(await page.locator('[data-copy-result]').innerText(), `${name}:22`);
    }
    if (network) {
      await popup.getByLabel('分享连接').click();
      await popup.locator('.redeven-endpoint-qr-image').waitFor();
      await popup.getByLabel('复制环境 URL').first().click();
      assert.equal(await page.locator('[data-copy-result]').innerText(), 'https://192.0.2.20:23998/');
    }
    await page.screenshot({ path: `${output}/${name.replaceAll(' ', '-')}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await popup.count(), 0);
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
    report.cases.push(`popover:${name}`);
  }
  for (const name of ['gzcom', 'Network']) {
    await page.locator(`[data-environment="${name}"]`).getByRole('button', { name: '环境设置' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('分享连接').count(), name === 'Network' ? 1 : 0);
    assert.equal(await dialog.getByRole('button', { name: '在浏览器中打开' }).count(), name === 'Network' ? 1 : 0);
    await page.screenshot({ path: `${output}/settings-${name}.png` });
    await dialog.getByRole('button', { name: '取消' }).click();
    report.cases.push(`settings:${name}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-environment="gzlight"]').getByLabel('显示端点').click();
  await page.waitForFunction(() => {
    const bounds = document.querySelector('.redeven-endpoints-popover')?.getBoundingClientRect();
    return bounds && bounds.x >= 0 && bounds.right <= window.innerWidth;
  }, undefined, { timeout: 3000 });
  await page.screenshot({ path: `${output}/narrow.png` });
  await page.keyboard.press('Escape');
  await page.locator('[data-environment="Network"]').getByRole('button', { name: '环境设置' }).click();
  const settingsConnection = page.locator('.redeven-settings-connections');
  const addressRow = settingsConnection.locator('[data-endpoint-kind="address"]').last();
  await addressRow.waitFor();
  const narrowAddress = await addressRow.boundingBox();
  assert.ok(narrowAddress.x >= 0 && narrowAddress.x + narrowAddress.width <= 390);
  await page.screenshot({ path: `${output}/narrow-settings.png` });
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
  await page.goto(new URL('environment-endpoints.html?theme=dark', report.url).href);
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.locator('[data-environment="gzlight"]').getByLabel('显示端点').click();
  await page.screenshot({ path: `${output}/dark.png` });
  report.cases.push('narrow', 'narrow-settings', 'dark');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log(`Environment connections passed: ${report.cases.length} browser cases. Evidence: ${output}`);
} catch (error) {
  report.status = 'failed'; report.failure = String(error.stack || error); throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
