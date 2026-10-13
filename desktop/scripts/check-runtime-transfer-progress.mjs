import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/runtime-transfer-progress/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['progress-shimmer.html']);
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 960 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.config.server.port}/progress-shimmer.html`);
  await page.waitForFunction(() => window.progressFixture);
  await page.locator('main').evaluate(element => { element.style.paddingTop = '600px'; });
  await page.evaluate(() => window.progressFixture.setTransferTask({ id: 'runtime', status: 'running', phase: 'transferring', strategy: 'desktop_upload', transfer_kind: 'upload', completed_bytes: 12582912, total_bytes: 50331648 }));
  await page.locator('.redeven-split-action-trigger--progress').click();
  const meter = page.locator('.redeven-environment-progress__transfer-meter');
  await meter.waitFor({ state: 'visible' });
  assert.equal(await meter.getAttribute('aria-valuenow'), '25');
  assert.match(await page.locator('.redeven-environment-progress__component-tasks').innerText(), /12 MiB \/ 48 MiB/);
  await page.locator('.redeven-environment-progress').screenshot({ path: `${output}/upload.png` });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.progressFixture.theme.setTheme(theme), theme);
    await page.evaluate(() => window.progressFixture.setTransferTask({ id: 'runtime', status: 'running', phase: 'transferring', strategy: 'remote_install', transfer_kind: 'download', transfer_percent: 62.5 }));
    await page.waitForFunction(() => document.querySelector('.redeven-environment-progress__transfer-meter')?.getAttribute('aria-valuenow') === '62.5');
    const geometry = await page.locator('.redeven-environment-progress__component-tasks').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    assert.ok(geometry.scroll <= geometry.width, `${theme}: task row overflow`);
    await page.locator('.redeven-environment-progress').screenshot({ path: `${output}/download-${theme}.png` });
  }
  await page.evaluate(() => window.progressFixture.setTransferTask({ id: 'runtime', status: 'running', phase: 'transferring', strategy: 'remote_install', transfer_kind: 'download' }));
  await page.waitForFunction(() => document.querySelector('.redeven-environment-progress__transfer-meter')?.getAttribute('data-indeterminate') === 'true');
  assert.equal(await meter.getAttribute('aria-valuenow'), null);
  await page.evaluate(() => window.progressFixture.setStatus('canceling'));
  await page.waitForFunction(() => document.querySelector('.redeven-environment-progress__component-transfer')?.getAttribute('data-active') === 'false');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, `${JSON.stringify({ status: 'passed', cases: ['upload bytes', 'download percentage', 'light and dark', 'task row overflow', 'unknown length', 'canceling'], errors }, null, 2)}\n`);
  console.log(`Runtime transfer browser checks passed: ${output}`);
} finally { await browser.close(); await server.close(); }
