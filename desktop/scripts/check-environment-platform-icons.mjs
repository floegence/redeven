import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/environment-platform-icons-acceptance/', import.meta.url));
const retentionModuleURL = `/@fs/${fileURLToPath(new URL('../src/main/desktopRuntimePlatformFacts.ts', import.meta.url))}`;
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(new URL('../../assets/environment_platform_icons.json', import.meta.url), 'utf8'));
const assetData = Object.fromEntries(await Promise.all(manifest.assets.map(async asset => [asset.identity,
  `data:image/svg+xml;base64,${(await readFile(new URL(`../src/welcome/assets/environment-platform-icons/${asset.file}`, import.meta.url))).toString('base64')}`])));
const platforms = ['macos', 'linux', 'windows', undefined].map(platform => ({ platform, assetID: platform ?? 'unknown' }));
const distributions = manifest.assets.filter(asset => asset.identity.startsWith('linux_')).map(asset => ({
  platform: 'linux', distribution: asset.identity.slice(6), name: asset.label, assetID: asset.identity,
}));
const cases = [...platforms, ...distributions,
  { platform: 'linux', distribution: 'opensuse-tumbleweed', name: 'openSUSE', assetID: 'linux_opensuse' },
  { platform: 'linux', distribution: 'customlinux', name: 'Linux', assetID: 'linux' },
  { platform: 'macos', distribution: 'ubuntu', name: 'macOS', assetID: 'macos' }];
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
      const result = await page.evaluate(async ({ snapshot, runtimeID, dark, cases, assetData, retentionModuleURL }) => {
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
        for (const { platform, distribution, name, assetID } of cases) {
          window.settingsFixture.publish({ ...structuredClone(snapshot), environments: snapshot.environments.map(entry =>
            entry.id === runtimeID ? { ...entry, runtime_platform: platform, runtime_linux_distribution: distribution } : entry) });
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
          const expectedImage = new Image();
          expectedImage.src = assetData[assetID === 'macos' && dark ? 'macos_dark' : assetID];
          await expectedImage.decode();
          context.clearRect(0, 0, 64, 64);
          context.drawImage(expectedImage, 0, 0, 64, 64);
          const originalPixels = context.getImageData(0, 0, 64, 64).data;
          if (!pixels.every((value, index) => value === originalPixels[index])) throw new Error(`Wrong original asset or colors: ${platform ?? 'unknown'} / ${distribution ?? ''}`);
          if (name && !graphic.alt.includes(name)) throw new Error(`Distribution accessible name missing: ${name}`);
          const after = card.getBoundingClientRect();
          if (Math.abs(before.height - after.height) > .5 || Math.abs(before.width - after.width) > .5) throw new Error('OS refresh changed card dimensions');
          if (getComputedStyle(title).userSelect !== 'text' || getComputedStyle(title).textOverflow !== 'ellipsis') throw new Error('Title selection or truncation is missing');
          if (getComputedStyle(slot).flexShrink !== '0' || title.getBoundingClientRect().left <= slot.getBoundingClientRect().left) throw new Error('OS slot is not fixed to the left of the name');
          dimensions.push({ platform: platform ?? 'unknown', distribution, height: after.height, slotWidth: slot.getBoundingClientRect().width, alignmentOffset });
        }
        const { retainDesktopRuntimePlatformFacts } = await import(retentionModuleURL);
        let facts = {};
        const store = { runtimePlatformFacts: () => facts, setRuntimePlatformFacts: next => { facts = next; } };
        const source = snapshot.environments.find(entry => entry.id === runtimeID);
        const detected = { ...source, runtime_platform: 'linux', runtime_linux_distribution: 'ubuntu',
          runtime_health: { ...source.runtime_health, status: 'online' } };
        retainDesktopRuntimePlatformFacts([detected], store);
        const [offline] = retainDesktopRuntimePlatformFacts([{ ...detected, runtime_platform: undefined,
          runtime_linux_distribution: undefined, runtime_health: { ...detected.runtime_health, status: 'offline' },
          open_session_key: '', is_open: false, is_opening: false, window_state: 'closed' }], store);
        window.settingsFixture.publish({ ...snapshot, environments: snapshot.environments.map(entry => entry.id === runtimeID ? offline : entry) });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (slot.querySelector('img') !== originalGraphic || originalGraphic.dataset.runtimeLinuxDistribution !== 'ubuntu'
          || !originalGraphic.alt.includes('Ubuntu')) throw new Error('Disconnect discarded the remembered distribution or replaced its image');
        if (document.activeElement !== tab || tab.getAttribute('aria-selected') !== 'true') throw new Error('Disconnect changed access focus');
        if (Math.abs(card.getBoundingClientRect().height - before.height) > .5) throw new Error('Disconnect changed card height');
        return dimensions;
      }, { snapshot, runtimeID: runtime.id, dark, cases, assetData, retentionModuleURL });
      report.cases.push({ locale, width, dark, fontSize, platforms: result });
      if (locale === 'zh-CN' && width === 1280) {
        await page.evaluate(({ snapshot, runtimeID }) => window.settingsFixture.publish({ ...snapshot,
          environments: snapshot.environments.map((entry, index) => ({ ...entry, runtime_platform: index < 6 ? 'linux' : index === 6 ? 'windows' : 'macos',
            runtime_linux_distribution: ['ubuntu', 'debian', 'fedora', 'arch', 'alpine', undefined][index] })),
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
