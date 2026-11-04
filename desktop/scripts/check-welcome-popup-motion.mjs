import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = resolve(process.env.REDEVEN_POPUP_ACCEPTANCE_OUTPUT || fileURLToPath(new URL('../dist/welcome-popup-motion-acceptance/', import.meta.url)));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['welcome-popup-motion.html', 'environment-settings.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const sources = [
  ...['DesktopAnchoredOverlaySurface.tsx', 'DesktopAnchoredListbox.tsx', 'DesktopActionPopover.tsx', 'DesktopPopover.tsx', 'DesktopTooltip.tsx', 'DesktopThemePicker.tsx', 'SSHDestinationCombobox.tsx', 'EnvironmentCards.tsx', 'RuntimeCloudConnections.tsx', 'RuntimeGatewayConnectionsDialog.tsx', 'SSHEnvironmentSettingsForm.tsx', 'App.tsx', 'index.css'].map(name => `desktop/src/welcome/${name}`),
  ...['FlowerContextMenu.tsx', 'FlowerSurface.tsx', 'threads/FlowerThreadList.tsx', 'styles/flower.css'].map(name => `internal/flower_ui/src/${name}`),
  'desktop/package-lock.json',
];
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sources: Object.fromEntries(await Promise.all(sources.map(async name => [name, createHash('sha256').update(await readFile(new URL(`../../${name}`, import.meta.url))).digest('hex')]))),
  publishedCore: JSON.parse(await readFile(new URL('../node_modules/@floegence/floe-webapp-core/package.json', import.meta.url))).version,
  url: server.resolvedUrls.local[0], output, cases: [], errors: [] };
try {
  for (const width of [1367, 390]) for (const theme of ['porcelain-light', 'porcelain-dark']) for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(new URL('welcome-popup-motion.html', report.url).href);
    await page.locator('#outside').waitFor();
    await page.evaluate(async theme => {
      document.documentElement.dataset.floeShellTheme = theme;
      document.documentElement.classList.toggle('dark', theme.endsWith('dark'));
      document.documentElement.classList.toggle('light', theme.endsWith('light'));
      await document.fonts.ready;
    }, theme);
    for (const kind of ['action', 'surface', 'hover', 'tooltip', 'listbox', 'endpoints', 'theme', 'ssh', 'dropdown', 'select', 'flower-context']) {
      await page.mouse.move(10, 10);
      await page.locator('#outside').focus();
      await page.evaluate(({ kind, width }) => { popupFixture.setOpen(false); popupFixture.setKind(kind); popupFixture.setPlacement({ left: width < 640 ? 50 : 450, top: 480 }); }, { kind, width });
      const label = `${width}:${theme}:${reducedMotion}:${kind}`;
      if (kind === 'tooltip' || kind === 'hover') await page.locator('#anchor').hover();
      else if (kind === 'ssh') await page.locator('input').click();
      else if (kind === 'dropdown') await page.locator('[data-floe-dropdown-trigger]').click();
      else if (kind === 'flower-context') await page.locator('[data-flower-thread-card]').click({ button: 'right' });
      else if (kind === 'select') await page.getByRole('combobox').click();
      else if (['action', 'surface', 'listbox'].includes(kind)) await page.locator('#anchor').click();
      else await page.locator('main > div button').first().click();
      const selector = { action: '.redeven-action-popover-surface', surface: '[role=dialog]', hover: '[role=dialog]', tooltip: '[role=tooltip]', listbox: '[data-redeven-anchored-listbox]', endpoints: '.redeven-endpoints-surface', theme: '.redeven-theme-picker', ssh: '[data-redeven-anchored-listbox]', dropdown: '[role=menu]', select: '.floe-floating-menu', 'flower-context': '.flower-thread-context-menu' }[kind];
      const surface = page.locator(selector).first();
      try { await surface.waitFor({ state: 'visible', timeout: 5000 }); } catch (error) { await writeFile(`${output}/failure.html`, await page.content()); await page.screenshot({ path: `${output}/failure.png` }); throw error; }
      const opening = await surface.evaluate(async (el, reducedMotion) => {
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        for (let i = 0; i < 8 && !el.getAnimations().length; i++) await frame();
        const positioner = el.closest('[data-redeven-overlay-positioner]');
        const rect = () => positioner?.getBoundingClientRect().toJSON();
        const sample = () => { const css = getComputedStyle(el); const matrix = new DOMMatrixReadOnly(css.transform); return { opacity: +css.opacity, x: matrix.m41, y: matrix.m42, scale: matrix.m11, width: el.offsetWidth, height: el.offsetHeight, position: rect(), origin: css.transformOrigin, animationName: css.animationName }; };
        const animations = el.getAnimations().filter(a => ['opacity', 'transform'].includes(a.transitionProperty));
        const timing = animations.map(a => ({ property: a.transitionProperty, duration: a.effect.getTiming().duration }));
        animations.forEach(a => { a.pause(); a.currentTime = 0; });
        const start = sample();
        animations.forEach(a => { a.currentTime = Math.min(100, a.effect.getTiming().duration / 2); });
        const middle = sample();
        animations.forEach(a => { a.finish(); });
        await frame(); await frame();
        return { start, middle, end: sample(), timing, state: el.dataset.floatingPresence, reducedMotion };
      }, reducedMotion);
      assert.equal(opening.end.opacity, 1, `${label}: opens completely`);
      assert.equal(opening.end.animationName, 'none', `${label}: one upstream transition recipe`);
      assert.equal(opening.end.scale, 1, `${label}: settled content remains sharp`);
      if (reducedMotion === 'no-preference') {
        assert.ok(opening.timing.some(t => t.property === 'opacity'), `${label}: opacity entrance runs`);
        assert.ok(opening.start.opacity < opening.middle.opacity && opening.middle.opacity < 1, `${label}: visible fade progression`);
        if (kind !== 'tooltip') assert.ok(opening.start.scale < 1, `${label}: shared subtle scale`);
        if (opening.start.position) {
          for (const key of ['x', 'y', 'width', 'height']) assert.equal(opening.start.position[key], opening.middle.position[key], `${label}: positioning ignores animated transforms (${key})`);
        }
      } else assert.ok(opening.timing.every(t => t.duration <= 1), `${label}: reduced motion is immediate`);
      assert.ok(opening.end.width <= width - 16 + 1, `${label}: panel fits viewport`);
      if (kind === 'action') {
        const draft = surface.locator('input'); await draft.fill('retained draft');
        await page.evaluate(() => { window.savedPopup = document.querySelector('.redeven-action-popover-surface'); popupFixture.setOpen(false); });
        const exit = await surface.evaluate(el => ({ inert: el.inert, hidden: el.getAttribute('aria-hidden'), state: el.dataset.floatingPresence }));
        assert.deepEqual(exit, { inert: true, hidden: 'true', state: 'exiting' }, `${label}: exits disable input immediately`);
        // Reopen in the same task even for reduced motion, before its exit deadline.
        await page.evaluate(() => popupFixture.setOpen(true));
        if (reducedMotion === 'no-preference') {
          assert.equal(await surface.evaluate(el => el === window.savedPopup), true, `${label}: reverses on the same DOM`);
          assert.equal(await draft.inputValue(), 'retained draft', `${label}: retains draft on reversal`);
        }
        await page.waitForTimeout(280);
      }
      if (['action', 'surface', 'hover', 'listbox', 'endpoints'].includes(kind)) await page.evaluate(() => popupFixture.setOpen(false));
      else if (kind === 'tooltip') { await page.locator('#outside').hover(); await page.locator('#outside').focus(); }
      else if (kind === 'ssh') { await page.locator('input').press('Escape'); }
      else await page.keyboard.press('Escape');
      if (reducedMotion === 'no-preference') {
        const exiting = await surface.evaluate(el => ({ connected: el.isConnected, state: el.dataset.floatingPresence, opacity: +getComputedStyle(el).opacity }));
        assert.equal(exiting.state, 'exiting', `${label}: retained exit state`);
      }
      await surface.waitFor({ state: 'detached' });
      report.cases.push({ label, opening });
    }
    // All resolved directions, including a viewport collision flip, keep the anchor gap stable.
    for (const side of ['top', 'bottom', 'left', 'right']) {
      await page.evaluate(({ side, width }) => { popupFixture.setKind('surface'); popupFixture.setSide(side); popupFixture.setPlacement({ left: width < 640 ? 50 : 600, top: 480 }); popupFixture.setOpen(true); }, { side, width });
      await page.waitForTimeout(reducedMotion === 'reduce' ? 25 : 300);
      const result = await page.locator('[data-floating-side]').evaluate(el => {
        const pos = el.parentElement.getBoundingClientRect(), anchor = document.getElementById('anchor').getBoundingClientRect(), side = el.dataset.floatingSide;
        const distance = side === 'top' ? anchor.top - pos.bottom : side === 'bottom' ? pos.top - anchor.bottom : side === 'left' ? anchor.left - pos.right : pos.left - anchor.right;
        return { side, distance, top: pos.top, left: pos.left, right: pos.right, bottom: pos.bottom };
      });
      assert.ok(Math.abs(result.distance - 8) <= 1, `resolved ${side}: anchor gap ${JSON.stringify(result)}`);
      assert.ok(result.left >= 7 && result.right <= width - 7 && result.top >= 7 && result.bottom <= 893, 'resolved popup remains inside viewport');
      if (width === 1367) assert.equal(result.side, side);
      if (width === 390 && side === 'left') assert.notEqual(result.side, 'left', 'collision resolves before choosing motion direction');
      report.cases.push({ label: `${width}:${theme}:${reducedMotion}:side-${side}`, result });
      if (side === 'top' && reducedMotion === 'no-preference') await page.screenshot({ path: `${output}/${width}-${theme}.png` });
      await page.evaluate(() => popupFixture.setOpen(false));
      await page.locator('[data-floating-side]').waitFor({ state: 'detached' });
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log(`Welcome popup motion passed: ${report.cases.length} cases, published Core ${report.publishedCore}.`);
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
