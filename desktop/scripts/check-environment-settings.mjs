import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_SETTINGS_OUTPUT || fileURLToPath(new URL('../dist/environment-settings-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], output, cases: [], errors: [], status: 'running' };
try {
  const { buildDesktopWelcomeSnapshot } = await server.ssrLoadModule(fileURLToPath(new URL('../src/main/desktopWelcomeState.ts', import.meta.url)));
  const { testDesktopPreferences } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/desktopTestHelpers.ts', import.meta.url)));
  const { desktopRuntimeTargetID } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/desktopRuntimePlacement.ts', import.meta.url)));
  const targets = ['orange', 'other'].map(label => {
    const host_access = { kind: 'ssh_host', ssh: { ssh_destination: label, ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 } };
    const placement = { kind: 'host_process', runtime_root: '/srv/redeven', bootstrap_strategy: 'auto', release_base_url: '' };
    return { schema_version: 2, id: desktopRuntimeTargetID(host_access, placement), label, host_access, placement,
      pinned: false, auto_runtime_probe_enabled: true, ssh_password: '', ssh_password_configured: false, created_at_ms: 1, updated_at_ms: 1, last_used_at_ms: 1 };
  });
  const snapshot = buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences({ saved_runtime_targets: targets }) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(value => { window.settingsFixtureSnapshot = value; }, snapshot);
  await page.goto(new URL('environment-settings.html', report.url).href);
  const dialog = page.getByRole('dialog');
  const tab = name => page.getByRole('tab', { name, exact: true });
  async function capture(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-floe-dialog-panel]')).opacity === '1');
    await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
  }
  async function open(label) {
    await page.getByRole('button', { name: `Settings for ${label}`, exact: true }).click();
    await dialog.waitFor();
    assert.equal(await dialog.count(), 1);
    await page.locator('#ssh-settings-label').waitFor();
  }
  async function close() {
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await dialog.waitFor({ state: 'detached' });
  }
  await open('orange');
  assert.equal(await page.evaluate(() => window.settingsFixture.loads), 0);
  await capture('card-first-connection');
  await page.locator('#ssh-settings-label').fill('Unsaved orange');
  await tab('Access & security').click();
  await dialog.getByText('Current connection', { exact: true }).waitFor();
  await capture('card-first-access-success');
  await tab('Connection').click();
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'Unsaved orange');
  report.cases.push('first-open-success-retains-connection-draft');
  await close(); await open('orange'); await capture('card-second-connection');
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'orange');
  await tab('Access & security').click();
  await dialog.getByText('SSH connection refused: orange:22', { exact: true }).waitFor();
  await capture('card-second-access-failure');
  assert.equal(await dialog.count(), 1);
  await tab('Connection').click(); await page.locator('#ssh-settings-label').waitFor();
  report.cases.push('second-open-failure-same-window-and-tabs');
  await close(); await open('orange'); await tab('Access & security').click();
  await dialog.getByText('Loading access settings…', { exact: true }).waitFor();
  await capture('card-third-access-loading');
  await close(); await open('other');
  await page.evaluate(() => window.settingsFixture.resolveOld());
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'other');
  await tab('Access & security').click();
  await dialog.getByText('Current connection', { exact: true }).waitFor();
  await capture('card-other-after-late-response');
  report.cases.push('late-response-cannot-replace-other-environment');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log(`Environment card settings passed: ${report.cases.length} browser scenarios. Evidence: ${output}`);
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
