import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = resolve(process.env.REDEVEN_WORKFLOW_ACCEPTANCE_OUTPUT || fileURLToPath(new URL('../dist/welcome-workflow-motion-acceptance/', import.meta.url)));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['welcome-workflow-motion.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const sources = ['desktop/src/welcome/App.tsx', 'desktop/src/welcome/DesktopActionPopover.tsx', 'desktop/src/welcome/DesktopAnchoredOverlaySurface.tsx', 'desktop/src/welcome/index.css', 'desktop/package-lock.json'];
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sources: Object.fromEntries(await Promise.all(sources.map(async name => [name, createHash('sha256').update(await readFile(new URL(`../../${name}`, import.meta.url))).digest('hex')]))),
  publishedCore: JSON.parse(await readFile(new URL('../node_modules/@floegence/floe-webapp-core/package.json', import.meta.url))).version,
  url: server.resolvedUrls.local[0], output, cases: [], errors: [], failures: [] };
const check = (condition, label) => { if (!condition) report.failures.push(label); };
try {
  for (const width of [1367, 768, 430, 390]) for (const theme of ['porcelain-light', 'porcelain-dark']) for (const reducedMotion of ['no-preference', 'reduce']) {
    const label = `${width}:${theme}:${reducedMotion}`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
    const page = await context.newPage();
    await page.addInitScript(() => { window.workflowErrors = []; window.addEventListener('error', event => window.workflowErrors.push(event.message)); });
    page.on('pageerror', error => report.errors.push(`${label}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(`${label}: ${message.text()}`); });
    await page.goto(new URL('welcome-workflow-motion.html?locale=zh-CN', report.url).href);
    await page.locator('.redeven-split-action-primary button').waitFor();
    await page.evaluate(async theme => {
      document.documentElement.dataset.floeShellTheme = theme;
      document.documentElement.classList.toggle('dark', theme.endsWith('dark'));
      document.documentElement.classList.toggle('light', theme.endsWith('light'));
      await document.fonts.ready;
    }, theme);
    await page.waitForTimeout(300);
    const trigger = await page.evaluate(async () => {
      const button = document.querySelector('.redeven-split-action-primary button');
      button.focus();
      const before = { rect: button.getBoundingClientRect().toJSON(), bg: getComputedStyle(button).backgroundColor };
      button.click();
      const current = document.querySelector('.redeven-split-action-primary button');
      const sameNode = current === button;
      await new Promise(resolve => requestAnimationFrame(resolve));
      const transitions = current.getAnimations().filter(animation => ['background-color', 'color'].includes(animation.transitionProperty));
      const timing = transitions.map(animation => ({ property: animation.transitionProperty, duration: animation.effect.getTiming().duration }));
      transitions.forEach(animation => { animation.pause(); animation.currentTime = 0; });
      const start = getComputedStyle(current).backgroundColor;
      transitions.forEach(animation => { animation.currentTime = animation.effect.getTiming().duration / 2; });
      const middle = getComputedStyle(current).backgroundColor;
      transitions.forEach(animation => animation.finish());
      return { sameNode, before, timing, start, middle, end: getComputedStyle(current).backgroundColor, rect: current.getBoundingClientRect().toJSON() };
    });
    check(trigger.sameNode, `${label}: workflow keeps the same primary button`);
    check(trigger.before.rect.width === trigger.rect.width && trigger.before.rect.height === trigger.rect.height, `${label}: primary geometry stays stable`);
    if (reducedMotion === 'no-preference') {
      check(trigger.timing.some(item => item.property === 'background-color' && item.duration >= 200), `${label}: inverse fill eases over the shared slow duration`);
      check(trigger.start !== trigger.middle && trigger.middle !== trigger.end, `${label}: inverse fill has a visible intermediate color`);
    } else check(trigger.timing.every(item => item.duration <= 1), `${label}: reduced motion skips inverse transition`);
    await page.waitForTimeout(350);
    const surface = page.locator('.redeven-action-popover-surface');
    const material = await surface.evaluate(el => {
      const owners = [el, ...el.querySelectorAll('*')].filter(node => node.getAttribute('data-floe-surface') === 'floating');
      const css = getComputedStyle(el), frame = getComputedStyle(el.querySelector('.redeven-action-popover-frame'));
      return { owners: owners.length, radius: css.borderTopLeftRadius, background: css.backgroundColor, shadow: css.boxShadow, frameBackground: frame.backgroundColor, frameShadow: frame.boxShadow };
    });
    check(material.owners === 1 && parseFloat(material.radius) > 0, `${label}: one rounded material boundary`);
    check(material.frameShadow === 'none' && material.frameBackground === 'rgba(0, 0, 0, 0)', `${label}: content clip adds no duplicate surface`);
    const resize = async stage => page.evaluate(async stage => {
      const surface = document.querySelector('.redeven-action-popover-surface');
      const panel = surface.querySelector('.redeven-action-popover-frame');
      const anchor = document.querySelector('[data-redeven-action-popover-anchor]');
      const read = () => { const rect = panel.getBoundingClientRect(), a = anchor.getBoundingClientRect(); return { height: rect.height, top: rect.top, bottom: rect.bottom, gap: a.top - rect.bottom, scale: new DOMMatrixReadOnly(getComputedStyle(surface).transform).a }; };
      const frames = [read()];
      workflowFixture.advance(stage);
      for (let i = 0; i < 35; i++) { await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))); frames.push(read()); }
      return { stage, sameSurface: surface === document.querySelector('.redeven-action-popover-surface'), frames };
    }, stage);
    const growth = await resize('preparing');
    const shrink = await resize('checking');
    for (const result of [growth, shrink]) {
      const first = result.frames[0].height, last = result.frames.at(-1).height;
      const middle = result.frames.filter(frame => frame.height > Math.min(first, last) + 1 && frame.height < Math.max(first, last) - 1);
      check(result.sameSurface, `${label}:${result.stage}: retains the same popup`);
      check(Math.abs(first - last) > 40, `${label}:${result.stage}: exercises a real height change`);
      check(reducedMotion === 'reduce' ? middle.length === 0 : middle.length >= 4, `${label}:${result.stage}: interpolates height only with motion enabled`);
      check(result.frames.every(frame => Math.abs(frame.gap - 8) <= 2 && frame.top >= 7), `${label}:${result.stage}: retains the anchor gap and viewport bounds throughout resize`);
      check(result.frames.slice(1).every((frame, index, frames) => index === 0 || (last > first ? frame.height >= frames[index - 1].height - 1 : frame.height <= frames[index - 1].height + 1)), `${label}:${result.stage}: painted resize frames never jump backward`);
      check(result.frames.every(frame => frame.scale === 1), `${label}:${result.stage}: does not stretch text`);
    }
    const rapid = await page.evaluate(async () => {
      const panel = document.querySelector('.redeven-action-popover-frame');
      const frames = [];
      workflowFixture.advance('preparing');
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        frames.push(panel.getBoundingClientRect().height);
        if (i === 3) workflowFixture.advance('checking');
        if (i === 7) workflowFixture.advance('preparing');
      }
      return frames;
    });
    check(rapid.at(-1) === growth.frames.at(-1).height, `${label}: rapid updates settle at the current content height`);
    check(rapid.every(height => height >= shrink.frames.at(-1).height - 1 && height <= growth.frames.at(-1).height + 1), `${label}: rapid updates stay inside the content envelope`);
    await page.evaluate(() => workflowFixture.advance('preparing'));
    await page.waitForTimeout(400);
    const footer = page.locator('.redeven-action-popover__action-footer button').first();
    await footer.click();
    check(await page.evaluate(() => workflowFixture.cancels()) === 1, `${label}: cancel remains reachable at maximum height`);
    const identity = await page.evaluate(() => { window.savedWorkflowPanel = document.querySelector('.redeven-action-popover-surface'); workflowFixture.setOpen(false); const el = window.savedWorkflowPanel; const state = { inert: el.inert, hidden: el.getAttribute('aria-hidden') }; workflowFixture.setOpen(true); return { ...state, retained: window.savedWorkflowPanel === document.querySelector('.redeven-action-popover-surface') }; });
    check(identity.inert && identity.hidden === 'true' && identity.retained, `${label}: close revokes input and reopen retains the panel`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/${label.replaceAll(':', '-')}.png` });
    const closingResize = await page.evaluate(async () => {
      const el = document.querySelector('.redeven-action-popover-surface');
      workflowFixture.advance('checking');
      await new Promise(resolve => setTimeout(resolve, 70));
      const before = el.offsetHeight;
      workflowFixture.setOpen(false);
      const after = el.offsetHeight;
      return { before, after, inert: el.inert, connected: el.isConnected };
    });
    check((reducedMotion === 'reduce' || Math.abs(closingResize.before - closingResize.after) <= 1) && closingResize.inert, `${label}: closing mid-resize freezes the painted height`);
    await surface.waitFor({ state: 'detached' });
    await page.evaluate(() => workflowFixture.setOpen(true));
    await surface.waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    const reopenedHeight = await surface.evaluate(el => el.offsetHeight);
    check(Math.abs(reopenedHeight - shrink.frames.at(-1).height) <= 1, `${label}: reopening releases the retained exit height`);
    await page.keyboard.press('Escape');
    await surface.waitFor({ state: 'detached' });
    await page.evaluate(() => workflowFixture.advance('ready'));
    check(await page.locator('.redeven-split-action-primary button').isEnabled(), `${label}: ready action remains enabled`);
    report.errors.push(...await page.evaluate(() => window.workflowErrors));
    report.cases.push({ label, trigger, material, growth, shrink, rapid, identity, closingResize });
    await context.close();
  }
  assert.deepEqual(report.errors, [], 'browser errors');
  assert.deepEqual(report.failures, [], 'workflow motion acceptance');
  report.status = 'passed';
  console.log(`Welcome workflow motion passed: ${report.cases.length} cases, published Core ${report.publishedCore}.`);
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
