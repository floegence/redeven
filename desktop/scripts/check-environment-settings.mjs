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
  pid: process.pid, url: server.resolvedUrls.local[0], output, cases: [], switches: [], errors: [], status: 'running' };
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
  async function settleMotion() {
    await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const panel = document.querySelector('.redeven-environment-settings-dialog');
      await Promise.all(panel.getAnimations({ subtree: true }).filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
  }
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
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-floe-dialog-panel]')).opacity === '1');
    await settleMotion();
    assert.equal(await dialog.locator('[data-floe-dialog-header] p').count(), 0);
    assert.equal(await dialog.evaluate(panel => {
      const description = document.getElementById(panel.getAttribute('aria-describedby'));
      return description?.parentElement === panel.querySelector('[data-floe-dialog-body]');
    }), true, 'environment identity stays in the body');
  }
  async function switchTab(name, { reducedMotion = false } = {}) {
    const frames = await page.evaluate(async name => {
      const dialog = document.querySelector('.redeven-environment-settings-dialog');
      const frames = [], start = performance.now();
      const sample = () => {
        const rect = dialog.getBoundingClientRect();
        const active = dialog.querySelector('.environment-settings-tab:not([aria-hidden="true"])');
        const body = active.querySelector('.environment-settings-scroll');
        const footer = active.querySelector('.environment-settings-actions').getBoundingClientRect();
        const indicator = dialog.querySelector('.environment-settings-indicator')?.getBoundingClientRect();
        frames.push({ elapsed: performance.now() - start, top: rect.top, height: rect.height,
          footerBottom: footer.bottom, bodyWidth: body.clientWidth, opacity: Number(getComputedStyle(body).opacity),
          indicatorX: indicator?.x, activePanels: dialog.querySelectorAll('[role="tabpanel"]:not([aria-hidden="true"])').length });
      };
      sample();
      [...dialog.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.trim() === name).click();
      await new Promise(resolve => {
        const next = () => { sample(); if (performance.now() - start >= 320) resolve(); else requestAnimationFrame(next); };
        requestAnimationFrame(next);
      });
      return frames;
    }, name);
    report.switches.push({ name, reducedMotion, frames });
    const before = frames[0], after = frames.at(-1);
    for (const frame of frames) {
      assert.ok(Math.abs(frame.top - before.top) < 0.5 && Math.abs(frame.height - before.height) < 0.5,
        `${name}: window jumped from top=${before.top}, height=${before.height} to top=${frame.top}, height=${frame.height}`);
      assert.ok(Math.abs(frame.footerBottom - before.footerBottom) < 0.5, `${name}: actions moved vertically`);
      assert.equal(frame.bodyWidth, before.bodyWidth, `${name}: content width changed`);
      assert.equal(frame.activePanels, 1, `${name}: only one panel can be interactive`);
    }
    assert.equal(after.opacity, 1, `${name}: content must settle`);
    assert.ok(Number.isFinite(after.indicatorX), `${name}: visible active indicator`);
    if (reducedMotion) {
      assert.ok(frames.slice(1).every(frame => frame.opacity === 1 && frame.indicatorX === after.indicatorX), 'reduced motion switches immediately');
    } else {
      assert.ok(frames.some(frame => frame.opacity > 0 && frame.opacity < 1), `${name}: content enters gently`);
      assert.ok(frames.some(frame => frame.indicatorX > Math.min(before.indicatorX, after.indicatorX) + 0.5
        && frame.indicatorX < Math.max(before.indicatorX, after.indicatorX) - 0.5), `${name}: indicator travels between tabs`);
    }
  }
  async function close() {
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await dialog.waitFor({ state: 'detached' });
  }
  await open('orange');
  assert.equal(await page.evaluate(() => window.settingsFixture.loads), 0);
  await capture('card-first-connection');
  await page.locator('#ssh-settings-label').fill('Unsaved orange');
  await switchTab('Access & security');
  await dialog.getByText('Current connection', { exact: true }).waitFor();
  await capture('card-first-access-success');
  await switchTab('Connection');
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'Unsaved orange');
  report.cases.push('first-open-success-retains-connection-draft');
  await close(); await open('orange'); await capture('card-second-connection');
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'orange');
  await switchTab('Access & security');
  await dialog.getByText('SSH connection refused: orange:22', { exact: true }).waitFor();
  await capture('card-second-access-failure');
  assert.equal(await dialog.count(), 1);
  await switchTab('Connection'); await page.locator('#ssh-settings-label').waitFor();
  report.cases.push('second-open-failure-same-window-and-tabs');
  await close(); await open('orange'); await switchTab('Access & security');
  await dialog.getByText('Loading access settings…', { exact: true }).waitFor();
  await capture('card-third-access-loading');
  await close(); await open('other');
  await page.evaluate(() => window.settingsFixture.resolveOld());
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'other');
  await switchTab('Access & security');
  await dialog.getByText('Current connection', { exact: true }).waitFor();
  await capture('card-other-after-late-response');
  report.cases.push('late-response-cannot-replace-other-environment');
  await page.setViewportSize({ width: 480, height: 640 });
  await settleMotion();
  await page.locator('#local-ui-port').fill('25000');
  const accessScroll = await page.locator('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-scroll').evaluate(body => {
    body.scrollTop = 140; return body.scrollTop;
  });
  assert.ok(accessScroll > 0, 'access section really scrolls');
  await switchTab('Connection');
  await page.locator('#ssh-settings-label').fill('Retained connection');
  await page.locator('.ssh-settings-disclosure').click();
  const connectionScroll = await page.locator('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-scroll').evaluate(body => {
    body.scrollTop = 160; return body.scrollTop;
  });
  assert.ok(connectionScroll > 0, 'expanded connection section really scrolls');
  await switchTab('Access & security');
  assert.equal(await page.locator('#local-ui-port').inputValue(), '25000');
  assert.equal(await page.locator('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-scroll').evaluate(body => body.scrollTop), accessScroll);
  await switchTab('Connection');
  assert.equal(await page.locator('#ssh-settings-label').inputValue(), 'Retained connection');
  assert.equal(await page.locator('.ssh-settings-disclosure').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-scroll').evaluate(body => body.scrollTop), connectionScroll);
  await capture('narrow-retained-connection');
  report.cases.push('narrow-switch-retains-drafts-expansion-and-independent-scroll');

  await tab('Connection').focus();
  for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home', 'ArrowRight']) await page.keyboard.press(key);
  await settleMotion();
  assert.equal(await tab('Access & security').getAttribute('aria-selected'), 'true');
  assert.equal(await tab('Access & security').evaluate(element => element === document.activeElement), true);
  assert.equal(await dialog.getByRole('tabpanel').count(), 1);
  assert.equal(await page.locator('#local-ui-port').inputValue(), '25000');
  assert.equal(await page.evaluate(() => window.settingsFixture.loads), 4, 'switching never reloads the access draft');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.environment-settings-tab[aria-hidden="true"]').evaluate(element => element.contains(document.activeElement)), false, 'hidden section stays outside keyboard navigation');
  report.cases.push('rapid-keyboard-switches-settle-on-final-selection');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await switchTab('Connection', { reducedMotion: true });
  await switchTab('Access & security', { reducedMotion: true });
  await capture('narrow-access-reduced-motion');
  report.cases.push('reduced-motion-has-stable-instant-switches');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const locale = new URLSearchParams(location.search).get('locale') || 'en-US';
    const language = { preference: locale, resolved_locale: locale, source: 'preference', system_candidates: [] };
    window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
  });
  for (const locale of ['en-US', 'zh-CN']) {
    await page.setViewportSize({ width: locale === 'zh-CN' ? 480 : 1280, height: locale === 'zh-CN' ? 640 : 900 });
    await page.goto(new URL(`environment-settings.html?deny-access=1&locale=${locale}`, report.url).href);
    await page.getByRole('button', { name: locale === 'zh-CN' ? 'orange 的设置' : 'Settings for orange', exact: true }).click();
    await page.locator('#ssh-settings-label').waitFor();
    await settleMotion();
    await switchTab(locale === 'zh-CN' ? '访问与安全' : 'Access & security');
    const alert = dialog.getByRole('alert');
    assert.ok((await alert.textContent()).includes(locale === 'zh-CN' ? '此环境未授权 Desktop 管理这些设置' : 'The environment did not authorize Desktop'));
    assert.equal((await alert.textContent()).includes('open this Environment from Desktop'), false);
    assert.equal(await dialog.evaluate(panel => panel.scrollWidth > panel.clientWidth), false);
    await capture(`authorization-${locale}`);
    await dialog.getByRole('button', { name: locale === 'zh-CN' ? '重试' : 'Retry', exact: true }).click();
    await page.locator('#local-ui-port').waitFor();
    assert.equal(await dialog.count(), 1);
    assert.equal(await page.evaluate(() => window.settingsFixture.loads), 2);
    report.cases.push(`authorization-guidance-and-retry-${locale}`);
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log(`Environment card settings passed: ${report.cases.length} browser scenarios. Evidence: ${output}`);
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
