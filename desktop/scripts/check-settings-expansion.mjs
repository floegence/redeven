import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_EXPANSION_OUTPUT || fileURLToPath(new URL('../dist/settings-expansion-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], output, cases: [], transitions: [], errors: [], status: 'running' };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  const dialog = page.getByRole('dialog');
  async function open(locale = 'en-US', preset = 'classic-light', ssh = false) {
    await page.goto(`${report.url}${ssh ? 'ssh-settings' : 'environment-endpoints'}.html?locale=${locale}&preset=${preset}`);
    await page.locator(ssh ? '#fixture-open' : '[data-environment="Local Environment"] > button').click();
    await dialog.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-floe-dialog-panel]')).opacity === '1');
    await page.evaluate(async () => {
      await Promise.all(document.querySelector('[role="dialog"]').getAnimations({ subtree: true })
        .filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
  }
  async function transition(name, trigger, content, { reduced = false, animated = true, rapid = false } = {}) {
    await page.locator(trigger).scrollIntoViewIfNeeded();
    await page.locator(trigger).focus();
    const frames = await page.evaluate(async ({ trigger, content, rapid }) => {
      const panel = document.querySelector('[role="dialog"]');
      const body = panel.querySelector('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-scroll');
      const footer = panel.querySelector('.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-actions');
      const frames = [], start = performance.now();
      function sample() {
        const bounds = panel.getBoundingClientRect(), actions = footer.getBoundingClientRect();
        const section = panel.querySelector(content);
        const height = section instanceof HTMLDetailsElement
          ? section.getBoundingClientRect().height - section.querySelector('summary').getBoundingClientRect().height
          : section?.getBoundingClientRect().height ?? 0;
        frames.push({ time: performance.now() - start, top: bounds.top, height: bounds.height,
          footer: actions.bottom, footerTop: actions.top, width: body.clientWidth, contentHeight: height,
          scrollTop: body.scrollTop, overflow: body.scrollWidth > body.clientWidth });
      }
      sample();
      document.querySelector(trigger).click();
      const closing = panel.querySelector(content);
      if ((closing instanceof HTMLDetailsElement && !closing.open) || closing?.getAttribute('aria-hidden') === 'true') {
        const control = closing.querySelector('input, select, button');
        control?.focus();
        if (control && document.activeElement === control) throw new Error('Closing content remains focusable');
      }
      let reversed = false, reopened = false;
      await new Promise(resolve => {
        const tick = () => {
          const elapsed = performance.now() - start;
          if (rapid && elapsed > 50 && !reversed) { document.querySelector(trigger).click(); reversed = true; }
          if (rapid && elapsed > 100 && !reopened) { document.querySelector(trigger).click(); reopened = true; }
          sample();
          if (elapsed >= 420) resolve(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return frames;
    }, { trigger, content, rapid });
    report.transitions.push({ name, reduced, frames });
    const first = frames[0], last = frames.at(-1);
    for (const frame of frames) {
      assert.ok(Math.abs(frame.top - first.top) < .5 && Math.abs(frame.height - first.height) < .5,
        `${name}: dialog moved/resized (${first.top}/${first.height} -> ${frame.top}/${frame.height})`);
      assert.ok(Math.abs(frame.footer - first.footer) < .5 && Math.abs(frame.footerTop - first.footerTop) < .5, `${name}: actions moved`);
      assert.equal(frame.width, first.width, `${name}: scrollbar changed content width`);
      assert.equal(frame.overflow, false, `${name}: horizontal overflow`);
    }
    if (animated && !reduced) assert.ok(frames.some(frame => frame.contentHeight > Math.min(first.contentHeight, last.contentHeight) + 1
      && frame.contentHeight < Math.max(first.contentHeight, last.contentHeight) - 1), `${name}: disclosure has intermediate heights`);
    if (reduced) assert.ok(frames.slice(1).every(frame => Math.abs(frame.contentHeight - last.contentHeight) < 1), `${name}: reduced motion settles immediately`);
    report.cases.push(name);
  }
  for (const [locale, preset, width, height] of [['en-US', 'classic-light', 1280, 900], ['zh-CN', 'ocean', 390, 700]]) {
    await page.setViewportSize({ width, height });
    await open(locale, preset);
    await dialog.getByRole('button', { name: locale === 'zh-CN' ? '修改访问方式' : 'Change access', exact: true }).click();
    const advanced = '.environment-access-advanced';
    await transition(`${locale}-network-open`, `${advanced} summary`, advanced);
    await page.locator('#local-ui-bind').fill('localhost:25000');
    await transition(`${locale}-network-close`, `${advanced} summary`, advanced);
    assert.equal(await page.locator('#local-ui-bind').isVisible(), false);
    await transition(`${locale}-network-rapid`, `${advanced} summary`, advanced, { rapid: true });
    assert.equal(await page.locator('#local-ui-bind').inputValue(), 'localhost:25000');
    await page.screenshot({ path: `${output}/${locale}-expanded.png`, animations: 'disabled' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await transition(`${locale}-network-reduced-close`, `${advanced} summary`, advanced, { reduced: true });
    await transition(`${locale}-network-reduced-open`, `${advanced} summary`, advanced, { reduced: true });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await open();
  await dialog.getByRole('button', { name: 'Manage certificate', exact: true }).click();
  await dialog.getByText('Ready', { exact: true }).waitFor();
  const certificate = 'section[aria-label="HTTPS setup"]';
  await transition('certificate-details-open', `${certificate} summary`, `${certificate} details`);
  await transition('certificate-details-close', `${certificate} summary`, `${certificate} details`);
  await transition('certificate-management-open', `${certificate} button[aria-controls]`, `${certificate} [data-settings-reveal]`);
  await transition('certificate-management-close', `${certificate} button[aria-controls]`, `${certificate} [data-settings-reveal]`);
  await transition('certificate-management-rapid', `${certificate} button[aria-controls]`, `${certificate} [data-settings-reveal]`, { rapid: true });
  await dialog.getByRole('button', { name: 'Import certificate…', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 1, 'nested Escape leaves settings open');
  assert.equal(await page.locator(`${certificate} button[aria-controls]`).getAttribute('aria-expanded'), 'false');
  await dialog.getByRole('button', { name: 'Back to overview', exact: true }).click();
  await dialog.getByRole('button', { name: 'Manage certificate', exact: true }).click();
  await dialog.getByText('Ready', { exact: true }).waitFor();
  assert.equal(await page.locator(`${certificate} button[aria-controls]`).getAttribute('aria-expanded'), 'false');
  report.cases.push('certificate-keyboard-and-task-return');

  await open('en-US', 'classic-light', true);
  await transition('ssh-advanced-open', '.ssh-settings-disclosure', '[data-settings-reveal]');
  await page.locator('#ssh-settings-runtime_root').fill('/srv/retained');
  await transition('ssh-advanced-close', '.ssh-settings-disclosure', '[data-settings-reveal]');
  assert.equal(await page.locator('#ssh-settings-runtime_root').isVisible(), false);
  await transition('ssh-advanced-rapid', '.ssh-settings-disclosure', '[data-settings-reveal]', { rapid: true });
  assert.equal(await page.locator('#ssh-settings-runtime_root').inputValue(), '/srv/retained');
  await page.locator('#ssh-settings-runtime_root').fill('relative/path');
  await transition('ssh-before-validation-close', '.ssh-settings-disclosure', '[data-settings-reveal]');
  await transition('ssh-validation-reveal', '.environment-settings-tab:not([aria-hidden="true"]) .environment-settings-actions button:last-child', '[data-settings-reveal]');
  report.validation = await page.locator('#ssh-settings-runtime_root').evaluate(input => {
    const bounds = input.closest('.ssh-settings-field').getBoundingClientRect(), viewport = input.closest('.environment-settings-scroll').getBoundingClientRect();
    return { focused: document.activeElement === input, top: bounds.top, bottom: bounds.bottom,
      viewportTop: viewport.top, viewportBottom: viewport.bottom };
  });
  await page.screenshot({ path: `${output}/ssh-validation-reveal.png` });
  assert.ok(report.validation.focused && report.validation.top >= report.validation.viewportTop
    && report.validation.bottom <= report.validation.viewportBottom,
    `validation reveals the focused field and its error message: ${JSON.stringify(report.validation)}`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await transition('ssh-advanced-reduced-close', '.ssh-settings-disclosure', '[data-settings-reveal]', { reduced: true });
  await transition('ssh-advanced-reduced-open', '.ssh-settings-disclosure', '[data-settings-reveal]', { reduced: true });
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log(`Settings expansion passed: ${report.cases.length} scenarios. Evidence: ${output}`);
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
