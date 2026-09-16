import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_WELCOME_CARD_OUTPUT
  || fileURLToPath(new URL('../dist/welcome-card-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
const browser = await chromium.launch({ headless: true });
const report = { cases: [], systemCases: [], errors: [], status: 'running' };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 700 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(new URL('welcome-cards.html', server.resolvedUrls.local[0]).href);
  await page.locator('[data-card-state="idle"]').waitFor();
  for (const preset of builtInShellThemePresets) {
    for (const material of ['standard', 'soft-neumorphic']) {
      await page.evaluate(({ preset, material }) => {
        const root = document.documentElement;
        root.classList.toggle('dark', preset.mode === 'dark');
        root.classList.toggle('light', preset.mode === 'light');
        root.dataset.floeShellTheme = preset.name;
        root.dataset.floeSurfaceStyle = material;
      }, { preset, material });
      await page.waitForTimeout(200);
      const cards = await page.evaluate(() => {
        const rgb = value => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data];
        };
        const contrast = (a, b) => {
          const luminance = rgba => rgba.slice(0, 3).reduce((sum, value, i) => {
            const c = value / 255;
            return sum + [0.2126, 0.7152, 0.0722][i] * (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
          }, 0);
          const x = luminance(a), y = luminance(b);
          return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
        };
        const page = rgb(getComputedStyle(document.body).backgroundColor);
        return [...document.querySelectorAll('[data-card-state]')].map(card => {
          const style = getComputedStyle(card), border = rgb(style.borderTopColor), background = rgb(style.backgroundColor);
          return { state: card.dataset.cardState, border, background, width: style.borderTopWidth,
            outerContrast: contrast(border, page), innerContrast: contrast(border, background),
            textContrast: contrast(rgb(style.color), background), shadow: style.boxShadow, filter: style.backdropFilter };
        });
      });
      report.cases.push({ preset: preset.name, material, cards });
      for (const card of cards) {
        const label = `${preset.name}/${material}/${card.state}`;
        assert.equal(card.width, '1px', `${label}: one stable outer boundary`);
        assert.equal(card.border[3], 255, `${label}: an opaque boundary survives the material cascade`);
        assert.ok(card.textContrast >= 4.5, `${label}: readable content`);
        const minimum = preset.mode === 'light' ? 1.25 : 1.1;
        assert.ok(card.outerContrast >= minimum, `${label}: outer contour ${card.outerContrast}`);
        assert.ok(card.innerContrast >= minimum, `${label}: inner contour ${card.innerContrast}`);
        if (preset.name !== 'hc-light') {
          assert.ok(card.outerContrast < 2, `${label}: quiet grouping rather than an input-strength frame`);
          assert.equal(card.shadow.includes('inset'), false, `${label}: no second highlighted contour`);
        }
        assert.equal(card.filter, 'none', `${label}: no backdrop blur`);
      }
      if (['classic-light', 'porcelain-light', 'classic-dark', 'porcelain-dark'].includes(preset.name)) {
        await page.screenshot({ path: `${output}/${preset.name}-${material}.png` });
      }
    }
  }
  for (const theme of ['classic-light', 'classic-dark', 'porcelain-light', 'porcelain-dark']) {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.evaluate(theme => {
      const root = document.documentElement;
      root.classList.toggle('dark', theme.endsWith('dark'));
      root.classList.toggle('light', theme.endsWith('light'));
      root.dataset.floeShellTheme = theme;
    }, theme);
    const cards = await page.locator('[data-card-state]').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element);
      return { border: style.borderTopColor, width: style.borderTopWidth, background: style.backgroundColor,
        animations: element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length };
    }));
    for (const card of cards) {
      assert.equal(card.width, '1px', `${theme}: forced-color boundary retains geometry`);
      assert.notEqual(card.border, card.background, `${theme}: system boundary stays visible`);
      assert.equal(card.animations, 0, `${theme}: reduced motion has no running card animation`);
    }
    report.systemCases.push({ theme, cards });
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log(`Welcome card boundaries passed: ${report.cases.length} theme/material cases.`);
} catch (error) {
  report.status = 'failed'; report.failure = String(error.stack || error); throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
