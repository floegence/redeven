import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/environment-platform-icons-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { url: server.resolvedUrls.local[0], pid: process.pid, state: server.config.cacheDir, output, cases: [], errors: [] };
try {
  const { runtimeConnectionFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/runtimeConnectionFixture.ts', import.meta.url)));
  const fixture = runtimeConnectionFixture({ kind: 'ssh_environment' });
  const runtime = fixture.snapshot.environments.find(entry => entry.kind === 'ssh_environment');
  const snapshot = { ...fixture.snapshot, environments: fixture.snapshot.environments.map((entry, index) => ({
    ...entry, runtime_platform: ['macos', 'linux', 'windows', undefined][index % 4],
  })) };
  for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'de-DE', 'es-ES', 'fr-FR', 'ja-JP', 'ko-KR', 'pt-BR', 'ru-RU']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('environment-settings.html', report.url).href);
    await page.locator('[data-environment-group]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const [width, dark, fontSize] of [[1280, false, 16], [1280, true, 16], [390, false, 16], [390, true, 20]]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.waitForFunction(expected => document.documentElement.classList.contains('dark') === expected, dark);
      await page.evaluate(fontSize => { document.documentElement.style.fontSize = `${fontSize}px`; }, fontSize);
      const result = await page.evaluate(async ({ snapshot, runtimeID, dark }) => {
        const card = document.querySelector(`[data-environment-group="${CSS.escape(runtimeID)}"]`);
        const title = card.querySelector('.redeven-environment-title');
        const slot = title.previousElementSibling;
        const originalGraphic = slot.querySelector('img');
        const tab = card.querySelectorAll('[role="tab"]')[1];
        tab.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        tab.focus();
        const before = card.getBoundingClientRect();
        const dimensions = [];
        for (const platform of ['macos', 'linux', 'windows', undefined]) {
          window.settingsFixture.publish({ ...structuredClone(snapshot), environments: snapshot.environments.map(entry =>
            entry.id === runtimeID ? { ...entry, runtime_platform: platform } : entry) });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          if (document.querySelector(`[data-environment-group="${CSS.escape(runtimeID)}"]`) !== card
            || card.querySelector('.redeven-environment-title') !== title || title.previousElementSibling !== slot) throw new Error('OS refresh replaced card or title');
          if (document.activeElement !== tab || tab.getAttribute('aria-selected') !== 'true') throw new Error(`OS refresh changed access perspective or focus: ${JSON.stringify({ platform, selected: tab.getAttribute('aria-selected'), active: document.activeElement?.outerHTML, connected: tab.isConnected })}`);
          const graphic = slot.querySelector('img');
          if (!graphic || graphic !== originalGraphic) throw new Error('OS refresh replaced or removed the graphic');
          const cap = document.createElement('span');
          cap.style.cssText = 'display:inline-block;width:0;height:1cap;vertical-align:baseline';
          title.append(cap);
          const capRect = cap.getBoundingClientRect();
          cap.remove();
          const graphicRect = graphic.getBoundingClientRect();
          const alignmentOffset = Math.abs(graphicRect.top + graphicRect.height / 2 - capRect.top - capRect.height / 2);
          if (alignmentOffset > .3) throw new Error(`OS graphic is not aligned to the title cap height: ${alignmentOffset}px`);
          if (platform) {
            if (graphic.dataset.runtimePlatform !== platform || !graphic.alt) throw new Error('OS graphic or accessible label missing');
          } else {
            if (graphic.dataset.runtimePlatform !== 'unknown' || !graphic.alt) throw new Error('Unknown OS device graphic or accessible label missing');
          }
          const style = getComputedStyle(graphic);
          if (style.maskImage !== 'none' || style.filter !== 'none' || style.opacity !== '1') throw new Error('OS graphic overrides the original brand colors');
          await graphic.decode();
          const url = graphic.currentSrc;
          if (!url.startsWith('data:') && new URL(url).origin !== location.origin) throw new Error('OS asset has a remote network dependency');
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 64;
          const context = canvas.getContext('2d');
          context.drawImage(graphic, 0, 0, 64, 64);
          const pixels = context.getImageData(0, 0, 64, 64).data;
          const colors = [];
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 240) colors.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
          const brandColorPresent = colors.some(([r, g, b]) => platform === 'macos'
            ? dark ? r > 245 && g > 245 && b > 245 : r < 10 && g < 10 && b < 10
            : platform === 'linux' ? r > 190 && g > 100 && b < 80 : b > 150 && b > r + 50);
          if (!brandColorPresent) throw new Error(`Original brand color missing: ${platform ?? 'unknown'} / ${dark ? 'dark' : 'light'}`);
          const after = card.getBoundingClientRect();
          if (Math.abs(before.height - after.height) > .5 || Math.abs(before.width - after.width) > .5) throw new Error('OS refresh changed card dimensions');
          if (getComputedStyle(title).userSelect !== 'text' || getComputedStyle(title).textOverflow !== 'ellipsis') throw new Error('Title selection or truncation is missing');
          if (getComputedStyle(slot).flexShrink !== '0' || title.getBoundingClientRect().left <= slot.getBoundingClientRect().left) throw new Error('OS slot is not fixed to the left of the name');
          dimensions.push({ platform: platform ?? 'unknown', height: after.height, slotWidth: slot.getBoundingClientRect().width, alignmentOffset });
        }
        return dimensions;
      }, { snapshot, runtimeID: runtime.id, dark });
      report.cases.push({ locale, width, dark, fontSize, platforms: result });
      if (locale === 'zh-CN' && width === 1280) {
        await page.evaluate(({ snapshot, runtimeID }) => window.settingsFixture.publish({ ...snapshot,
          environments: snapshot.environments.map(entry => entry.id === runtimeID ? { ...entry, runtime_platform: 'linux' } : entry),
        }), { snapshot, runtimeID: runtime.id });
        await page.screenshot({ path: `${output}/zh-CN-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' });
      }
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); throw error; }
finally { await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); await server.close(); }
console.log(`Environment platform icons: ${report.cases.length} locale/layout/theme cases passed.`);
