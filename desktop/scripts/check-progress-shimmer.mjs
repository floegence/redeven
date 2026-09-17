import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/progress-shimmer-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [], status: 'running' };
function sample() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const color = (value) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  };
  const mix = (a, b, t) => a.slice(0, 3).map((v, i) => v * (1 - t) + b[i] * t);
  const background = (el) => {
    if (!el) return [255, 255, 255];
    const rgba = color(getComputedStyle(el).backgroundColor);
    return mix(background(el.parentElement), rgba, rgba[3] / 255);
  };
  const linear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = (rgb) =>
    rgb
      .slice(0, 3)
      .map(linear)
      .reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const lab = (rgb) => {
    const [r, g, b] = rgb.slice(0, 3).map(linear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  return [
    ...document.querySelectorAll('[data-floe-progress-shimmer]'),
  ].map((el) => {
    const style = getComputedStyle(el);
    const surface = el.dataset.floeProgressShimmer === 'surface';
    const token = (name) => {
      const swatch = document.createElement('span');
      swatch.style.color = `var(${name})`;
      el.append(swatch);
      const result = color(getComputedStyle(swatch).color);
      swatch.remove();
      return result;
    };
    const base = token(surface ? '--floe-progress-surface-base' : '--floe-progress-text-base');
    const peak = token(surface ? '--floe-progress-surface-peak' : '--floe-progress-text-peak');
    const ink = color(style.color);
    const bg = background(el);
    const minimumContrast = Math.min(
      ...Array.from({ length: 33 }, (_, i) =>
        surface ? contrast(ink, mix(base, peak, i / 32)) : contrast(mix(base, peak, i / 32), bg)
      )
    );
    const a = lab(base),
      b = lab(peak);
    const animation = el
      .getAnimations({ subtree: true })
      .find((a) => a.animationName === 'floe-progress-shimmer');
    return {
      name: el.dataset.floeProgressShimmer,
      base,
      peak,
      luminanceGain: luminance(peak) - luminance(base),
      lightnessGain: b[0] - a[0],
      minimumContrast,
      deltaEOK: Math.hypot(...a.map((v, i) => v - b[i])),
      duration: animation?.effect.getTiming().duration,
      animation: !!animation,
      text: el.textContent,
    };
  });
}
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, recordVideo: { dir: output } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(new URL('progress-shimmer.html', server.resolvedUrls.local[0]).href);
  await page.waitForFunction(() => Boolean(window.progressFixture));
  const themes = await page.evaluate(() => window.progressFixture.themes.map(({ name, mode }) => ({ name, mode })));
  for (const material of ['standard', 'soft-neumorphic']) {
    await page.evaluate(value => window.progressFixture.theme.setSurfaceStyle(value), material);
    for (const theme of themes) {
      await page.evaluate(value => window.progressFixture.theme.selectShellTheme(value.mode, value.name), theme);
      const primary = page.locator('.redeven-split-action-primary button').first();
      await primary.hover();
      await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await Promise.all(document.getAnimations()
          .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
          .map(animation => animation.finished.catch(() => {})));
      });
      const result = await primary.evaluate(button => {
        const before = getComputedStyle(button, '::before');
        return { disabled: button.disabled, cursor: getComputedStyle(button).cursor, animation: before.animationName, pointerEvents: before.pointerEvents, background: before.backgroundImage, width: button.getBoundingClientRect().width };
      });
      assert.equal(result.disabled, false);
      assert.equal(result.cursor, 'pointer');
      assert.equal(result.animation, 'floe-progress-shimmer');
      assert.equal(result.pointerEvents, 'none');
      const text = page.locator('.flower-model-status-text');
      const paint = await text.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, clip: getComputedStyle(el).backgroundClip, animation: getComputedStyle(el).animationName }));
      assert.deepEqual(paint, { background: 'rgba(0, 0, 0, 0)', clip: 'text', animation: 'floe-progress-shimmer' });
      const measurements = await page.evaluate(sample);
      for (const value of measurements) {
        assert.ok(value.luminanceGain > 0 && value.lightnessGain > 0, `${theme.name}/${value.name}: shimmer must brighten its carrier`);
        assert.ok(value.minimumContrast >= 4.5, `${theme.name}/${value.name}: contrast ${value.minimumContrast}`);
        assert.ok(value.deltaEOK >= 0.08, `${theme.name}/${value.name}: color separation ${value.deltaEOK}`);
      }
      const frames = [];
      for (const time of [0, 1200]) {
        await page.evaluate(time => document.getAnimations().forEach(animation => {
          if (animation.animationName === 'floe-progress-shimmer') { animation.pause(); animation.currentTime = time; }
        }), time);
        frames.push(await primary.screenshot({ animations: 'allow' }));
      }
      assert.equal(frames[0].equals(frames[1]), false, `${theme.name}: actual button pixels move`);
      await page.evaluate(() => document.getAnimations().forEach(animation => animation.play()));
      report.cases.push({ material, ...theme, result, paint, measurements });
      if (['classic-light', 'classic-dark', 'github-light', 'nord'].includes(theme.name)) {
        await page.waitForTimeout(2450);
        if (theme.name === 'github-light') {
          await page.evaluate(() => document.getAnimations().forEach(animation => {
            if (animation.animationName === 'floe-progress-shimmer') { animation.pause(); animation.currentTime = 1200; }
          }));
          await page.locator('.redeven-environment-card').screenshot({ path: `${output}/${material}-blue-peak.png`, animations: 'allow' });
          await page.evaluate(() => document.getAnimations().forEach(animation => animation.play()));
        }
        await page.screenshot({ path: `${output}/${material}-${theme.name}.png` });
      }
    }
  }
  const primary = page.locator('.redeven-split-action-primary button').first();
  await primary.click();
  assert.equal(await primary.getAttribute('aria-expanded'), 'true');
  const cancel = page.getByRole('button', { name: /取消更新|停止更新|取消操作/ });
  await cancel.click();
  assert.equal(await page.evaluate(() => window.progressFixture.cancelCount()), 1);
  await primary.click();
  const toggle = page.locator('.redeven-split-action-toggle');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  for (const status of ['running', 'canceling', 'cleanup_running', 'failed', 'cleanup_failed', 'needs_confirmation', 'succeeded']) {
    await page.evaluate(status => window.progressFixture.setStatus(status), status);
    const expected = ['running', 'canceling', 'cleanup_running'].includes(status) ? 'surface' : null;
    assert.equal(await primary.getAttribute('data-floe-progress-shimmer'), expected, status);
  }
  await page.evaluate(() => { window.progressFixture.setStatus('running'); window.progressFixture.setSubmitting(true); });
  assert.equal(await primary.isDisabled(), true);
  assert.equal(await primary.getAttribute('data-floe-progress-shimmer'), 'surface');
  await page.evaluate(() => window.progressFixture.setSubmitting(false));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await primary.evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
  assert.equal(await page.locator('.flower-model-status-text').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'no-preference' });
  assert.equal(await page.locator('.flower-model-status-text').evaluate(el => getComputedStyle(el).webkitTextFillColor === 'rgba(0, 0, 0, 0)'), false);
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  await context.close();
  console.log(`Welcome progress passed ${report.cases.length} theme/material cases and operation controls.`);
} catch (error) {
  report.status = 'failed'; report.failure = String(error.stack || error); throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
