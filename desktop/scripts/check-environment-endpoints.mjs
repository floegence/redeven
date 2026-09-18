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
  async function settleDisclosure() {
    await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
  }
  async function assertActionAlignment(surface) {
    const offsets = await surface.locator('.redeven-card-endpoint-row').evaluateAll(rows => rows.flatMap(row => {
      const actions = row.querySelectorAll('.redeven-endpoint-action');
      return actions.length ? [Math.abs(row.getBoundingClientRect().right - actions[actions.length - 1].getBoundingClientRect().right)] : [];
    }));
    assert.ok(offsets.every(offset => offset < 1), 'available actions stay on the same trailing edge');
  }
  async function stableScreenshot(path) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-floe-dialog-panel], .redeven-endpoints-popover')]
      .every(element => getComputedStyle(element).opacity === '1'));
    await page.screenshot({ path, animations: 'disabled' });
  }
  await page.goto(new URL('environment-endpoints.html', report.url).href);
  for (const name of ['Local Environment', 'gzcom', 'gzlight', 'Network']) {
    const card = page.locator(`[data-environment="${name}"]`);
    const trigger = card.getByLabel('查看连接方式');
    await trigger.click();
    const popup = page.locator('.redeven-endpoints-popover');
    await popup.waitFor();
    await assertActionAlignment(popup);
    const readingAlignment = await popup.locator('.redeven-card-endpoint-row').evaluateAll(rows => rows.map(row => {
      const label = row.querySelector('.redeven-card-endpoint-label');
      const value = row.querySelector('.redeven-endpoint-scope-title, .redeven-card-endpoint-value');
      return Math.abs(label.getBoundingClientRect().left - value.getBoundingClientRect().left);
    }));
    assert.ok(readingAlignment.every(offset => offset < 1), 'connection labels and values share one reading edge');
    assert.ok((await popup.innerText()).includes(name));
    const network = name === 'Network';
    assert.equal(await popup.getByLabel('分享连接').count(), network ? 1 : 0);
    assert.equal(await popup.getByLabel('复制环境 URL').count(), network || name === 'Local Environment' ? 1 : 0);
    assert.equal(await popup.getByLabel('在浏览器中打开').count(), network || name === 'Local Environment' ? 1 : 0);
    if (network || name === 'Local Environment') {
      assert.ok((await popup.innerText()).includes(network ? '网络访问地址' : '此设备的浏览器地址'));
      await popup.getByLabel('在浏览器中打开').click();
      assert.equal(await page.locator('[data-copy-result]').innerText(), network ? 'https://192.0.2.20:23998/' : 'http://localhost:23998/');
    }
    if (name === 'gzcom' || name === 'gzlight') {
      assert.ok((await popup.innerText()).includes(`仅限 ${name} 内部`));
      assert.equal(await popup.locator('.redeven-endpoint-listener .redeven-card-endpoint-value').isVisible(), false);
      assert.ok((await popup.innerText()).includes('通过 Desktop 的“打开 Env App”进入此环境。'));
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
    if (name === 'gzcom') {
      await popup.locator('.redeven-endpoint-listener summary').click();
      await settleDisclosure();
      assert.equal(await popup.locator('.redeven-endpoint-listener .redeven-card-endpoint-value').innerText(), 'http://localhost:23998/');
      assert.ok((await popup.innerText()).includes('不同主机可以使用相同端口'));
      assert.equal(await popup.locator('.redeven-endpoint-listener button').count(), 0);
      await stableScreenshot(`${output}/gzcom-listener-details.png`);
    }
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
    report.cases.push(`popover:${name}`);
  }
  for (const name of ['Local Environment', 'gzcom', 'Network']) {
    await page.locator(`[data-environment="${name}"]`).getByRole('button', { name: '环境设置' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await assertActionAlignment(dialog);
    assert.equal(await dialog.getByLabel('分享连接').count(), name === 'Network' ? 1 : 0);
    assert.equal(await dialog.getByRole('button', { name: '在浏览器中打开' }).count(), name !== 'gzcom' ? 1 : 0);
    if (name === 'gzcom') {
      assert.equal(await dialog.locator('.redeven-endpoint-listener .redeven-card-endpoint-value').isVisible(), false);
      assert.ok((await dialog.innerText()).includes('仅限 gzcom 内部'));
    }
    const settingsFonts = await dialog.locator('.redeven-card-endpoint-value').evaluateAll(elements => elements.map(el => getComputedStyle(el).fontFamily));
    assert.ok(settingsFonts.every(font => font.includes('Inter') && !font.includes('Iosevka')), 'settings and connection details share product typography');
    await stableScreenshot(`${output}/settings-${name}.png`);
    if (name === 'gzcom') {
      const panel = page.locator('[data-floe-dialog-panel]');
      const before = await panel.boundingBox();
      const summary = dialog.locator('.redeven-endpoint-listener summary');
      await summary.focus(); await page.keyboard.press('Enter');
      await page.waitForTimeout(220);
      const after = await panel.boundingBox();
      assert.ok(Math.abs(before.height - after.height) < 1 && Math.abs(before.y - after.y) < 1, 'listener details expand inside the fixed settings viewport');
      assert.equal(await summary.evaluate(el => el === document.activeElement), true);
      assert.equal(await dialog.locator('.redeven-endpoint-listener .redeven-card-endpoint-value').isVisible(), true);
      await stableScreenshot(`${output}/settings-listener-details.png`);
      await dialog.locator('#local-ui-port').fill('25000');
      await dialog.getByText('网络可达设备', { exact: true }).click();
      assert.equal(await dialog.locator('.redeven-endpoint-listener .redeven-card-endpoint-value').innerText(), 'http://localhost:23998/');
      assert.equal(await dialog.locator('.redeven-endpoint-listener').evaluate(el => el.open), true);
      assert.equal(await dialog.getByRole('button', { name: '在浏览器中打开' }).count(), 0);
      report.cases.push('settings-listener-disclosure-and-draft-isolation');
    }

    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
    report.cases.push(`settings:${name}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-environment="gzlight"]').getByLabel('查看连接方式').click();
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
  await page.locator('[data-environment="gzlight"]').getByLabel('查看连接方式').click();
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
  assert.ok(opening.every(frame => !frame || Math.abs(frame.width - 352) < 1), 'opening preserves measured width');
  assert.equal(await page.locator('.redeven-endpoints-surface').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'only one material layer');
  const expanded = await frames('.redeven-endpoints-popover [aria-label="分享连接"]');
  const expandedHeights = expanded.filter(Boolean).map(frame => frame.height);
  assert.ok(new Set(expandedHeights.map(height => Math.round(height))).size > 2, 'sharing expands through intermediate heights');
  assert.ok(expanded.every(frame => frame && Math.abs(frame.width - 352) < 1), 'sharing never changes panel width');
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
    await page.keyboard.press('Escape'); await page.locator('.redeven-endpoints-popover').waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-environment="gzcom"] [aria-haspopup="dialog"]').click();
    await page.locator('.redeven-endpoint-listener summary').click();
    await settleDisclosure();
    assert.equal(await page.locator('.redeven-endpoints-popover').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.keyboard.press('Escape'); await page.locator('.redeven-endpoints-popover').waitFor({ state: 'detached' });
    await page.locator('[data-environment="gzcom"] > button').click();
    await page.locator('.redeven-endpoint-listener summary').click();
    await settleDisclosure();
    assert.equal(await page.locator('.environment-settings-scroll').evaluate(el => el.scrollWidth > el.clientWidth), false);
  }
  for (const placement of ['wsl', 'local-container', 'ssh-container']) {
    await page.goto(new URL(`environment-endpoints.html?placement=${placement}`, report.url).href);
    await page.locator('[data-environment="gzcom"] [aria-haspopup="dialog"]').click();
    const popup = page.locator('.redeven-endpoints-popover');
    const expected = placement === 'wsl' ? '仅限 WSL 分发 Ubuntu-24.04 内部' : '仅限容器 dev-box 内部';
    assert.ok((await popup.innerText()).includes(expected));
    assert.equal(await popup.locator('[aria-label="在浏览器中打开"]').count(), 0);
    assert.equal(await popup.locator('.redeven-endpoint-listener .redeven-card-endpoint-value').isVisible(), false);
    await popup.locator('.redeven-endpoint-listener summary').click();
    await settleDisclosure();
    assert.equal(await popup.locator('.redeven-endpoint-listener .redeven-card-endpoint-value').innerText(), 'http://localhost:23998/');
    await page.keyboard.press('Escape'); await popup.waitFor({ state: 'detached' });
    await page.locator('[data-environment="gzcom"]').getByRole('button', { name: '环境设置' }).click();
    const overview = page.locator('.environment-access-overview');
    assert.ok((await overview.innerText()).includes(expected));
    assert.equal(await overview.locator('.redeven-endpoint-listener .redeven-card-endpoint-value').isVisible(), false);
    assert.equal(await overview.locator('[aria-label="在浏览器中打开"]').count(), 0);
    report.cases.push(`scoped-listener:${placement}`);
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
    await card('gzcom').getByLabel('查看连接方式').click();
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
  await card('gzcom').getByLabel('查看连接方式').click();
  await card('gzlight').getByLabel('查看连接方式').click();
  assert.equal(await cardPage.getByRole('dialog').count(), 1, 'only the selected Environment remains interactive');
  assert.ok((await cardPage.getByRole('dialog').innerText()).includes('gzlight'));
  await cardPage.keyboard.press('Escape');
  await cardPage.waitForFunction(() => !document.querySelector('.redeven-endpoints-popover'));
  // Exercise the real snapshot subscription, not only a directly mounted popover.
  await card('gzcom').getByLabel('查看连接方式').click();
  await cardPage.waitForFunction(() => getComputedStyle(document.querySelector('.redeven-endpoints-popover')).opacity === '1');
  const compact = await cardPage.locator('.redeven-endpoints-popover').evaluate(panel => ({
    height: panel.getBoundingClientRect().height,
    fonts: [...panel.querySelectorAll('.redeven-card-endpoint-value')].map(el => getComputedStyle(el).fontFamily),
  }));
  assert.ok(compact.height < 285, 'connection guidance and internal listener stay compact');
  assert.ok(compact.fonts.every(font => font.includes('Inter') && !font.includes('Iosevka')), 'host and URL use product text typography');
  await cardPage.getByRole('button', { name: /复制 SSH/ }).click();
  await cardPage.locator('[data-endpoint-id="host"] [data-copied="true"]').waitFor();
  await cardPage.locator('.redeven-endpoint-listener summary').click();
  const refreshEvidence = await cardPage.evaluate(async initial => {
    const panel = document.querySelector('.redeven-endpoints-popover');
    const trigger = document.querySelector('[aria-haspopup="dialog"][aria-expanded="true"]');
    const listener = panel.querySelector('.redeven-endpoint-listener');
    const host = panel.querySelector('[data-endpoint-id="host"]');
    const copy = host.querySelector('button');
    const value = host.querySelector('.redeven-card-endpoint-value');
    copy.focus();
    const selection = getSelection();
    const range = document.createRange(); range.selectNodeContents(value);
    selection.removeAllRanges(); selection.addRange(range);
    const samples = [];
    const started = performance.now();
    for (let tick = 0; tick < 18; tick++) {
      const next = structuredClone(initial);
      for (const environment of next.environments) environment.runtime_health.checked_at_unix_ms = tick + 1;
      window.settingsFixture.publish(next);
      await new Promise(resolve => requestAnimationFrame(resolve));
      samples.push({ samePanel: document.querySelector('.redeven-endpoints-popover') === panel,
        sameTrigger: document.querySelector('[aria-haspopup="dialog"][aria-expanded="true"]') === trigger,
        sameListener: panel.querySelector('.redeven-endpoint-listener') === listener && listener.open,
        sameRow: panel.querySelector('[data-endpoint-id="host"]') === host,
        focused: document.activeElement === copy, selected: selection.toString(), copied: copy.dataset.copied,
        opacity: Number(getComputedStyle(panel).opacity), state: panel.dataset.state, elapsed: performance.now() - started });
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    return samples;
  }, snapshot);
  for (const sample of refreshEvidence) {
    const { copied, elapsed, ...continuity } = sample;
    assert.deepEqual(continuity, { samePanel: true, sameTrigger: true, sameRow: true, sameListener: true, focused: true,
      selected: 'gzcom:22', opacity: 1, state: 'open' });
    if (elapsed < 1000) assert.equal(copied, 'true', 'refresh preserves feedback until its normal timeout');
  }
  report.refreshFrames = refreshEvidence;
  await cardPage.keyboard.press('Escape');
  await cardPage.locator('.redeven-endpoints-popover').waitFor({ state: 'detached' });

  // Exercise sharing and scroll continuity with overflowing, newly allocated address lists.
  const networkSnapshot = structuredClone(snapshot);
  const target = networkSnapshot.environments.find(entry => entry.label === 'gzcom');
  target.local_ui_urls = Array.from({ length: 12 }, (_, index) => `https://192.0.2.${index + 10}:23998/`);
  target.local_ui_url = target.local_ui_urls[0];
  await cardPage.evaluate(value => window.settingsFixture.publish(value), networkSnapshot);
  await card('gzcom').getByLabel('查看连接方式').click();
  await cardPage.getByRole('button', { name: '分享连接', exact: true }).first().click();
  await cardPage.locator('.redeven-endpoint-qr-image').waitFor();
  await cardPage.waitForTimeout(250);
  const sharingEvidence = await cardPage.evaluate(async initial => {
    const panel = document.querySelector('.redeven-endpoints-popover');
    const viewport = panel.querySelector('.redeven-endpoints-popover-body');
    const qr = panel.querySelector('img');
    const action = panel.querySelector('[aria-expanded="true"]');
    action.focus({ preventScroll: true }); viewport.scrollTop = 120;
    const top = viewport.scrollTop;
    const samples = [];
    for (let tick = 0; tick < 8; tick++) {
      const next = structuredClone(initial);
      const target = next.environments.find(entry => entry.label.startsWith('gzcom'));
      target.local_ui_urls.reverse(); target.label = `gzcom · ${tick}`;
      window.settingsFixture.publish(next);
      await new Promise(resolve => setTimeout(resolve, 40));
      samples.push({ samePanel: document.querySelector('.redeven-endpoints-popover') === panel,
        sameQR: panel.querySelector('img') === qr, focused: document.activeElement === action,
        scroll: viewport.scrollTop, titleUpdated: panel.querySelector('.redeven-endpoints-popover-title').textContent === target.label });
    }
    return { top, samples };
  }, networkSnapshot);
  assert.ok(sharingEvidence.top > 0, 'the test scrolls a real constrained viewport');
  for (const sample of sharingEvidence.samples) assert.deepEqual(sample, {
    samePanel: true, sameQR: true, focused: true, scroll: sharingEvidence.top, titleUpdated: true,
  });
  // New authoritative scope invalidates sharing without closing the panel.
  await cardPage.evaluate(value => window.settingsFixture.publish(value), snapshot);
  await cardPage.locator('.redeven-endpoint-qr-image').waitFor({ state: 'detached' });
  assert.equal(await cardPage.getByRole('dialog').count(), 1);
  assert.equal(await cardPage.getByRole('button', { name: '分享连接', exact: true }).count(), 0);
  await cardPage.keyboard.press('Escape');
  await cardPage.locator('.redeven-endpoints-popover').waitFor({ state: 'detached' });
  report.cases.push('actual-cards-refresh-focus-selection-copy', 'actual-cards-refresh-share-scroll-and-invalidation', 'compact-layout-and-typography');
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
