import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { createRequire } from 'node:module';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_ENDPOINT_OUTPUT || fileURLToPath(new URL('../dist/environment-endpoint-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const portProbe = net.createServer();
await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve); });
const port = portProbe.address().port;
await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));
const server = await createSSHSettingsPreviewServer(port);
// Acceptance measures one fixed source revision; development HMR must not replace an open panel.
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], output, errors: [], cases: [], status: 'running',
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  async function stableScreenshot(path) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-floe-dialog-panel], .redeven-endpoints-popover')]
      .every(element => getComputedStyle(element).opacity === '1'));
    await page.screenshot({ path, animations: 'disabled' });
  }
  await page.goto(new URL('environment-endpoints.html', report.url).href);
  for (const name of ['Local Environment', 'gzcom', 'gzlight', 'Network']) {
    const card = page.locator(`[data-environment="${name}"]`);
    const trigger = card.getByLabel('显示端点');
    await trigger.click();
    const popup = page.locator('.redeven-endpoints-popover');
    await popup.waitFor();
    assert.ok((await popup.innerText()).includes(name));
    const network = name === 'Network';
    assert.equal(await popup.getByLabel('分享连接').count(), network ? 1 : 0);
    assert.equal(await popup.getByLabel('复制环境 URL').count(), network || name === 'Local Environment' ? 1 : 0);
    assert.equal(await popup.getByLabel('在浏览器中打开').count(), network || name === 'Local Environment' ? 1 : 0);
    if (network || name === 'Local Environment') {
      await popup.getByLabel('在浏览器中打开').click();
      assert.equal(await page.locator('[data-copy-result]').innerText(), network ? 'https://192.0.2.20:23998/' : 'http://localhost:23998/');
    }
    if (name === 'gzcom' || name === 'gzlight') {
      assert.ok((await popup.innerText()).includes(`仅在 ${name}:22 上可用。`));
      await popup.getByRole('button', { name: /复制 SSH/ }).click();
      assert.equal(await page.locator('[data-copy-result]').innerText(), `${name}:22`);
    }
    if (network) {
      await popup.getByLabel('分享连接').click();
      await popup.locator('.redeven-endpoint-qr-image').waitFor();
      await popup.getByLabel('复制环境 URL').first().click();
      assert.equal(await page.locator('[data-copy-result]').innerText(), 'https://192.0.2.20:23998/');
    }
    await stableScreenshot(`${output}/${name.replaceAll(' ', '-')}.png`);
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
    report.cases.push(`popover:${name}`);
  }
  for (const name of ['gzcom', 'Network']) {
    await page.locator(`[data-environment="${name}"]`).getByRole('button', { name: '环境设置' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('分享连接').count(), name === 'Network' ? 1 : 0);
    assert.equal(await dialog.getByRole('button', { name: '在浏览器中打开' }).count(), name === 'Network' ? 1 : 0);
    await stableScreenshot(`${output}/settings-${name}.png`);
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
    report.cases.push(`settings:${name}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-environment="gzlight"]').getByLabel('显示端点').click();
  await page.waitForFunction(() => {
    const bounds = document.querySelector('.redeven-endpoints-popover')?.getBoundingClientRect();
    return bounds && bounds.x >= 0 && bounds.right <= window.innerWidth;
  }, undefined, { timeout: 3000 });
  await stableScreenshot(`${output}/narrow.png`);
  await page.keyboard.press('Escape');
  await page.locator('[data-environment="Network"]').getByRole('button', { name: '环境设置' }).click();
  const settingsConnection = page.locator('.redeven-settings-connections');
  const addressRow = settingsConnection.locator('[data-endpoint-kind="address"]').last();
  await addressRow.waitFor();
  const narrowAddress = await addressRow.boundingBox();
  assert.ok(narrowAddress.x >= 0 && narrowAddress.x + narrowAddress.width <= 390);
  await stableScreenshot(`${output}/narrow-settings.png`);
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.goto(new URL('environment-endpoints.html?theme=dark', report.url).href);
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.locator('[data-environment="gzlight"]').getByLabel('显示端点').click();
  await stableScreenshot(`${output}/dark.png`);
  report.cases.push('narrow', 'narrow-settings', 'dark');

  // Measure visible frames, not only final styles, to protect enter/exit and disclosure motion.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(new URL('environment-endpoints.html', report.url).href);
  await page.evaluate(() => document.fonts.ready);
  async function frames(selector, duration = 280) {
    return page.evaluate(async ({ selector, duration }) => {
      const result = [], started = performance.now();
      document.querySelector(selector).click();
      await new Promise(resolve => {
        const tick = () => {
          const panel = document.querySelector('.redeven-endpoints-popover');
          const bounds = panel?.getBoundingClientRect();
          result.push(panel ? { opacity: Number(getComputedStyle(panel).opacity), width: bounds.width, height: bounds.height,
            x: bounds.x, inert: panel.inert, state: panel.dataset.state } : null);
          if (performance.now() - started < duration) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
      return result;
    }, { selector, duration });
  }
  const opening = await frames('[data-environment="Network"] [aria-haspopup="dialog"]');
  assert.ok(opening.some(frame => frame && frame.opacity > 0 && frame.opacity < 1), 'opening interpolates opacity');
  assert.ok(opening.every(frame => !frame || Math.abs(frame.width - 400) < 1), 'opening preserves measured width');
  assert.equal(await page.locator('.redeven-endpoints-surface').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'only one material layer');
  const expanded = await frames('.redeven-endpoints-popover [aria-label="分享连接"]');
  const expandedHeights = expanded.filter(Boolean).map(frame => frame.height);
  assert.ok(new Set(expandedHeights.map(height => Math.round(height))).size > 2, 'sharing expands through intermediate heights');
  assert.ok(expanded.every(frame => frame && Math.abs(frame.width - 400) < 1), 'sharing never changes panel width');
  const collapsed = await frames('.redeven-endpoints-popover [aria-label="分享连接"]');
  assert.ok(new Set(collapsed.filter(Boolean).map(frame => Math.round(frame.height))).size > 2, 'sharing collapses through intermediate heights');
  assert.equal(await page.locator('.redeven-endpoint-qr-image').count(), 0);
  await frames('.redeven-endpoints-popover [aria-label="分享连接"]');
  const closing = await frames('.redeven-endpoints-popover-close');
  assert.ok(closing.some(frame => frame && frame.inert && frame.opacity > 0 && frame.opacity < 1), 'exit remains visible and inert');
  const closingHeights = closing.filter(Boolean).map(frame => frame.height);
  assert.ok(Math.max(...closingHeights) - Math.min(...closingHeights) < 1, 'closing preserves expanded QR geometry');
  assert.equal(closing.at(-1), null);
  assert.equal(await page.locator('[data-environment="Network"] [aria-haspopup="dialog"]').evaluate(el => el === document.activeElement), true);
  report.motion = { opening, expanded, collapsed, closing };
  report.cases.push('enter-exit-motion', 'share-disclosure-motion', 'single-material-layer');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedOpen = await frames('[data-environment="Network"] [aria-haspopup="dialog"]', 80);
  assert.ok(reducedOpen.every(frame => !frame || frame.opacity === 0 || frame.opacity === 1), 'reduced motion avoids interpolation');
  const reducedClose = await frames('.redeven-endpoints-popover-close', 80);
  assert.equal(reducedClose.at(-1), null);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  report.cases.push('reduced-motion');

  // Translated labels and long addresses must remain usable at narrow widths.
  const require = createRequire(new URL('../../internal/envapp/ui_src/package.json', import.meta.url));
  for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(new URL(`environment-endpoints.html?theme=${mode}&multiple&label=production-long-environment-name`, report.url).href);
    await page.locator('[data-environment="Network"] [aria-haspopup="dialog"]').click();
    await page.locator('.redeven-endpoints-popover [aria-expanded="false"]').first().click();
    await stableScreenshot(`${output}/multiple-${mode}.png`);
    const geometry = await page.locator('.redeven-endpoints-popover').evaluate(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, overflow: el.scrollWidth - el.clientWidth };
    });
    assert.ok(geometry.left >= 0 && geometry.right <= 390 && geometry.top >= 0 && geometry.bottom <= 844, 'long content stays in viewport');
    assert.equal(geometry.overflow, 0);
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const accessibility = await page.evaluate(async () => window.axe.run('.redeven-endpoints-surface'));
    assert.deepEqual(accessibility.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
    report.cases.push(`long-addresses-and-accessibility:${mode}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const preset of builtInShellThemePresets) {
    await page.goto(new URL(`environment-endpoints.html?preset=${preset.name}`, report.url).href);
    await page.locator('[data-environment="gzcom"] [aria-haspopup="dialog"]').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.redeven-endpoints-popover')).opacity === '1');
    assert.equal(await page.locator('.redeven-endpoints-popover').evaluate(el => el.scrollWidth > el.clientWidth), false);
  }
  for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU']) {
    await page.goto(new URL(`environment-endpoints.html?locale=${locale}`, report.url).href);
    await page.locator('[data-environment="Network"] [aria-haspopup="dialog"]').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.redeven-endpoints-popover')).opacity === '1');
    assert.equal(await page.locator('.redeven-endpoints-popover').evaluate(el => el.scrollWidth > el.clientWidth), false);
  }
  report.themes = builtInShellThemePresets.length;
  report.locales = 10;

  const { buildDesktopWelcomeSnapshot } = await server.ssrLoadModule(fileURLToPath(new URL('../src/main/desktopWelcomeState.ts', import.meta.url)));
  const { testDesktopPreferences } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/desktopTestHelpers.ts', import.meta.url)));
  const { desktopRuntimeTargetID } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/desktopRuntimePlacement.ts', import.meta.url)));
  const targets = ['gzcom', 'gzlight'].map(label => {
    const host_access = { kind: 'ssh_host', ssh: { ssh_destination: label, ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 } };
    const placement = { kind: 'host_process', runtime_root: '/srv/redeven', bootstrap_strategy: 'auto', release_base_url: '' };
    return { schema_version: 2, id: desktopRuntimeTargetID(host_access, placement), label, host_access, placement,
      pinned: false, auto_runtime_probe_enabled: true, ssh_password: '', ssh_password_configured: false, created_at_ms: 1, updated_at_ms: 1, last_used_at_ms: 1 };
  });
  const initial = buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences({ saved_runtime_targets: targets }) });
  const snapshot = { ...initial, environments: initial.environments.map(entry => ({ ...entry,
    local_ui_url: 'http://localhost:23998/', local_ui_urls: ['http://localhost:23998/'],
    runtime_health: { ...entry.runtime_health, status: 'online', freshness: 'fresh' },
  })) };
  const cardContext = await browser.newContext({ viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'], recordVideo: { dir: output, size: { width: 1440, height: 900 } } });
  const cardPage = await cardContext.newPage();
  cardPage.on('pageerror', error => report.errors.push(error.message));
  await cardPage.addInitScript(value => {
    window.settingsFixtureSnapshot = value;
    const language = { preference: 'zh-CN', resolved_locale: 'zh-CN', source: 'explicit', system_candidates: [] };
    window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
  }, snapshot);
  await cardPage.goto(new URL('environment-settings.html', report.url).href);
  const card = name => cardPage.locator('.redeven-environment-card').filter({ has: cardPage.getByRole('heading', { name, exact: true }) });
  await card('gzcom').waitFor();
  await cardPage.evaluate(() => document.fonts.ready);
  for (let attempt = 0; attempt < 2; attempt++) {
    await card('gzcom').getByLabel('显示端点').click();
    await cardPage.waitForFunction(() => getComputedStyle(document.querySelector('.redeven-endpoints-popover')).opacity === '1');
    await cardPage.getByRole('button', { name: /复制 SSH/ }).click();
    assert.equal(await cardPage.evaluate(() => navigator.clipboard.readText()), 'gzcom:22');
    if (attempt === 0) {
      await cardPage.screenshot({ path: `${output}/environment-cards.png`, animations: 'disabled' });
      await cardPage.locator('.redeven-endpoints-popover').screenshot({ path: `${output}/detail.png`, animations: 'disabled' });
    }
    // Hold each state briefly so the retained video demonstrates the actual transition.
    await cardPage.waitForTimeout(700);
    await cardPage.keyboard.press('Escape');
    await cardPage.locator('.redeven-endpoints-popover').waitFor({ state: 'detached' });
    await cardPage.waitForTimeout(350);
  }
  await card('gzcom').getByLabel('显示端点').click();
  await card('gzlight').getByLabel('显示端点').click();
  assert.equal(await cardPage.getByRole('dialog').count(), 1, 'only the selected Environment remains interactive');
  assert.ok((await cardPage.getByRole('dialog').innerText()).includes('gzlight'));
  await cardPage.keyboard.press('Escape');
  await cardPage.waitForFunction(() => !document.querySelector('.redeven-endpoints-popover'));
  const video = cardPage.video();
  await cardContext.close();
  await video.saveAs(`${output}/interaction.webm`);
  await video.delete();
  report.cases.push('actual-cards-clipboard-and-reopen', 'actual-cards-mutual-exclusion');

  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log(`Environment connections passed: ${report.cases.length} browser cases. Evidence: ${output}`);
} catch (error) {
  report.status = 'failed'; report.failure = String(error.stack || error); throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
