import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_RESTART_OUTPUT || fileURLToPath(new URL('../dist/settings-restart-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pid: process.pid,
  url: server.resolvedUrls.local[0], cases: [], errors: [], status: 'running' };
try {
  const { buildDesktopWelcomeSnapshot } = await server.ssrLoadModule(fileURLToPath(new URL('../src/main/desktopWelcomeState.ts', import.meta.url)));
  const { testDesktopPreferences } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/desktopTestHelpers.ts', import.meta.url)));
  const { desktopRuntimeTargetID } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/desktopRuntimePlacement.ts', import.meta.url)));
  const { createDesktopI18n } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/index.ts', import.meta.url)));
  const connections = [
    ['SSH Fixture', { kind: 'ssh_host', ssh: { ssh_destination: 'fixture-host', ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 } }, { kind: 'host_process', runtime_root: '/srv/redeven', bootstrap_strategy: 'auto', release_base_url: '' }],
    ['Container Fixture', { kind: 'local_host' }, { kind: 'container_process', container_engine: 'docker', container_id: 'fixture-container', container_ref: 'fixture-container', runtime_root: '/root/.redeven', bridge_strategy: 'exec_stream' }],
    ['WSL Fixture', { kind: 'wsl_host', distribution_name: 'Ubuntu', linux_user: 'dev' }, { kind: 'host_process', runtime_root: '/home/dev/.redeven' }],
  ];
  const targets = connections.map(([label, host_access, placement]) => ({ schema_version: 2,
    id: desktopRuntimeTargetID(host_access, placement), label, host_access, placement, pinned: false,
    auto_runtime_probe_enabled: true, ssh_password: '', ssh_password_configured: false, created_at_ms: 1, updated_at_ms: 1, last_used_at_ms: 1,
  }));
  const base = buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences({ saved_runtime_targets: targets }) });
  const snapshot = { ...base, environments: base.environments.map(entry => ({ ...entry, can_edit: true,
    runtime_operations: { ...entry.runtime_operations, restart: { ...entry.runtime_operations.restart, availability: 'available' } },
  })) };
  const configurations = [
    ...snapshot.environments.map(entry => ({ label: entry.label, locale: 'en-US', width: 1280, theme: 'light', reducedMotion: 'no-preference' })),
    { label: 'SSH Fixture', locale: 'zh-CN', width: 480, theme: 'light', reducedMotion: 'reduce' },
    { label: 'SSH Fixture', locale: 'de-DE', width: 640, theme: 'dark', reducedMotion: 'no-preference' },
  ];
  for (const config of configurations) {
    const page = await browser.newPage({ viewport: { width: config.width, height: 900 }, reducedMotion: config.reducedMotion, colorScheme: config.theme });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.text().includes('computations created outside')) report.errors.push(message.text()); });
    await page.addInitScript(({ snapshot, config }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: config.locale, resolved_locale: config.locale, source: 'preference', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
      const theme = { source: config.theme, resolvedTheme: config.theme, shellThemes: { light: 'classic-light', dark: 'ocean' } };
      window.redevenDesktopTheme = { getSnapshot: () => theme, subscribe: () => () => {}, setSource: async () => theme, setShellTheme: async () => theme };
    }, { snapshot, config });
    await page.goto(new URL('environment-settings.html?restart-handoff=1', report.url).href);
    const t = createDesktopI18n(config.locale).t;
    await page.getByRole('button', { name: t('environmentCenter.settingsForLabel', { label: config.label }), exact: true }).click();
    const dialog = page.locator('.redeven-environment-settings-dialog');
    if (await dialog.getByRole('tab', { name: t('settings.accessTab'), exact: true }).count()) {
      await dialog.getByRole('tab', { name: t('settings.accessTab'), exact: true }).click();
    }
    await page.locator('#local-ui-port').fill('25000');
    await page.evaluate(() => {
      window.restartFrames = [];
      const record = () => {
        const settings = document.querySelector('.redeven-environment-settings-dialog');
        const progress = document.querySelector('.redeven-environment-progress');
        window.restartFrames.push({ settings: !!settings, progress: !!progress, focus: document.activeElement?.className });
        if (!progress) requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    });
    await dialog.getByRole('button', { name: t('settings.saveAndRestart'), exact: true }).click();
    const panel = page.locator('.redeven-environment-progress');
    await dialog.waitFor({ state: 'detached' }); await panel.waitFor();
    await page.waitForFunction(() => document.activeElement === document.querySelector('.redeven-environment-progress'));
    assert.ok((await panel.textContent()).includes(t('settings.submittingRestart')));
    const frames = await page.evaluate(() => window.restartFrames);
    assert.equal(frames.some(frame => frame.settings && frame.progress), false, 'settings exit completes before progress becomes interactive');
    await page.evaluate(() => window.settingsFixture.progress('running'));
    await panel.locator('[role="list"]').first().waitFor();
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= config.width + 1, 'progress fits the viewport');
    assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth), false, 'long copy fits');
    await page.screenshot({ animations: 'disabled', path: `${output}/${config.locale}-${config.label.split(' ')[0]}-${config.theme}-running.png` });
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.settingsFixture.requests.filter(r => r.kind === 'cancel_launcher_operation').length), 0);
    await page.evaluate(() => window.settingsFixture.progress('running'));
    assert.equal(await panel.count(), 0, 'later progress does not reopen a dismissed panel');
    await page.locator(`[data-owner-id="${snapshot.environments.find(entry => entry.label === config.label).id}"] .redeven-split-action-primary button`).click(); await panel.waitFor();
    await page.evaluate(() => window.settingsFixture.progress('failed'));
    await panel.getByText(t('settings.restartNotApplied'), { exact: true }).waitFor();
    await panel.getByRole('button', { name: t('settings.retryRestart'), exact: true }).click();
    await panel.getByText(t('settings.submittingRestart'), { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.settingsFixture.saves), 1, 'retry never saves again');
    await page.evaluate(() => window.settingsFixture.progress('succeeded'));
    await panel.getByText(t('settings.restartApplied'), { exact: true }).waitFor();
    await page.screenshot({ animations: 'disabled', path: `${output}/${config.locale}-${config.label.split(' ')[0]}-${config.theme}-complete.png` });
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' });
    await page.locator(`[data-owner-id="${snapshot.environments.find(entry => entry.label === config.label).id}"] .redeven-split-action-primary button`).click();
    await panel.getByText(t('settings.restartApplied'), { exact: true }).waitFor();
    await panel.getByRole('button', { name: t('settings.returnToSettings'), exact: true }).click(); await dialog.waitFor();
    await page.locator('#local-ui-port').waitFor();
    assert.equal(await page.locator('#local-ui-port').inputValue(), '25000');
    report.cases.push({ ...config, frames }); await page.close();
  }
  assert.deepEqual(report.errors, []); report.status = 'passed';
  console.log(`Settings restart passed: ${report.cases.length} browser scenarios. Evidence: ${output}`);
} catch (error) {
  report.status = 'failed'; report.failure = String(error); throw error;
} finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); await server.close();
}
