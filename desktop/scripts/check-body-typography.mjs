import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { chromium, _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const native = process.argv.includes('--electron');
const output = process.env.REDEVEN_BODY_TYPE_OUTPUT
  || fileURLToPath(new URL(`../dist/body-typography${native ? '-electron' : ''}/`, import.meta.url));
await mkdir(output, { recursive: true });
if (native) execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [], { stdio: 'inherit' });
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDiff: execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).trim(),
  floe: JSON.parse(await readFile(new URL('../node_modules/@floegence/floe-webapp-core/package.json', import.meta.url))).version,
  native, marker: randomUUID(), cases: [], errors: [], failures: [],
};
let server;
let browser;
let app;
let state;
try {
  server = await createSSHSettingsPreviewServer(0);
  await server.watcher.close();
  report.url = server.resolvedUrls.local[0];
  report.cache = server.config.cacheDir;
  let page;
  if (native) {
    state = await mkdtemp(path.join(tmpdir(), 'redeven-body-typography-'));
    const entry = path.join(state, 'main.cjs');
    await writeFile(entry, `const { app, BrowserWindow } = require('electron');
      app.whenReady().then(() => { const win = new BrowserWindow({ width: 1280, height: 900, useContentSize: true,
        webPreferences: { contextIsolation: true, sandbox: true } }); win.loadURL('about:blank'); });`);
    app = await _electron.launch({ executablePath: electron, cwd: state,
      args: [entry, `--user-data-dir=${state}/profile`, `--redeven-smoke-run=${report.marker}`],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    report.pid = app.process().pid;
    report.state = state;
    page = await app.firstWindow();
  } else {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    report.pid = process.pid;
  }
  const resize = async width => {
    if (app) await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    else await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(width => innerWidth === width, width);
  };
  const screenshot = async name => {
    const target = path.join(output, `${name}.png`);
    if (app) {
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(target, Buffer.from(png, 'base64'));
    } else await page.screenshot({ path: target, animations: 'disabled' });
  };
  const read = async (name, selector, expected = '12px') => {
    await page.locator(selector).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const measurement = await page.locator(selector).evaluateAll(nodes => ({
      root: getComputedStyle(document.documentElement).fontSize, zoom: visualViewport.scale,
      dpr: devicePixelRatio, fine: matchMedia('(pointer:fine)').matches, width: innerWidth,
      nodes: nodes.map(node => {
        const css = getComputedStyle(node);
        return { text: (node.textContent || node.value || node.placeholder || '').slice(0, 160),
          size: css.fontSize, line: css.lineHeight, font: css.fontFamily, height: node.getBoundingClientRect().height };
      }),
    }));
    assert.ok(measurement.nodes.length, name);
    report.cases.push({ name, ...measurement });
    for (const node of measurement.nodes) {
      if (node.size !== expected) report.failures.push({ name, expected, ...node });
    }
    await screenshot(name);
  };
  page.on('pageerror', error => report.errors.push(error.message));
  const { createDesktopI18n } = await server.ssrLoadModule(path.join(root, 'desktop/src/shared/i18n/index.ts'));
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(path.join(root, 'desktop/src/testSupport/mixedEnvironmentFixture.ts'));
  const t = createDesktopI18n('en-US').t;
  await page.addInitScript(snapshot => {
    window.settingsFixtureSnapshot = snapshot;
    const language = { preference: 'en-US', resolved_locale: 'en-US', source: 'explicit', system_candidates: [] };
    window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
  }, mixedEnvironmentFixture().snapshot);
  await page.goto(`${report.url}environment-settings.html`);
  await read('desktop-search-wide', '.redeven-center-search input');
  await resize(390);
  await read('desktop-search-narrow', '.redeven-center-search input');
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  await read('desktop-search-enlarged', '.redeven-center-search input', '15px');
  await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
  await resize(1280);

  const dialog = page.getByRole('dialog');
  const button = key => dialog.getByRole('button', { name: t(key), exact: true });
  const open = async suffix => {
    await page.goto(`${report.url}environment-endpoints.html?locale=en-US&preset=classic-light${suffix}`);
    await page.locator('[data-environment="Local Environment"] > button').click();
    await button('accessFlow.changeAccess').waitFor();
  };
  await open('');
  await button('accessFlow.changeAccess').click();
  await read('desktop-access-options', '.access-flow-options strong');
  await button('settings.sharedLocalNetworkLabel').click();
  await button('accessFlow.checkChanges').click();
  await read('desktop-access-password', '.access-flow-password input');
  await open('&secure=enabled');
  await button('accessFlow.changeAccess').click();
  await dialog.getByRole('radio', { name: 'HTTP', exact: true }).click();
  await button('accessFlow.verifyContinue').click();
  await read('desktop-access-plan', '.access-flow-plan li');

  const { buildBlockedPageHTML } = await server.ssrLoadModule(path.join(root, 'desktop/src/main/blockedPage.ts'));
  const { hostApplicationPreparationDocument } = await server.ssrLoadModule(path.join(root, 'desktop/src/shared/hostApplicationPreparation.ts'));
  const { buildWebServiceBrowserDocumentURL } = await server.ssrLoadModule(path.join(root, 'desktop/src/main/webServiceBrowserDocument.ts'));
  const { desktopSemanticPaletteForShellTheme, desktopWindowThemeSnapshotForShellTheme } = await server.ssrLoadModule(path.join(root, 'desktop/src/main/desktopTheme.ts'));
  const toolbarURL = buildWebServiceBrowserDocumentURL({
    locale: 'en-US', title: 'Web Service', addressLabel: 'Web Service address', addressPlaceholder: 'Enter an address or path',
    backLabel: 'Back', forwardLabel: 'Forward', reloadLabel: 'Reload', stopLabel: 'Stop loading', navigateLabel: 'Go to address',
    developerToolsLabel: 'Developer tools', openExternalLabel: 'Open in browser', secureRouteLabel: 'Protected route',
  }, { source: 'dark', resolvedTheme: 'dark', shellThemes: { version: 1, light: 'mist', dark: 'forest' }, activeShellTheme: 'forest',
    window: desktopWindowThemeSnapshotForShellTheme('forest'), semantic: desktopSemanticPaletteForShellTheme('forest') });
  for (const [name, html, selector] of [
    ['browser-toolbar', decodeURIComponent(toolbarURL.slice('data:text/html;charset=utf-8,'.length)), '.address-input'],
    ['blocked', buildBlockedPageHTML({ status: 'blocked', code: 'external_target_unreachable',
      message: 'Check the environment connection and retry.', diagnostics: { target_url: 'https://example.invalid' } }, 'darwin', 'en-US'),
    '#blocked-summary > p:not(.eyebrow), .meta, .actions a, summary'],
    ['preparation', hostApplicationPreparationDocument({ title: 'Application', icon: '', locale: 'en-US',
      heading: 'Preparing the application', detail: 'Checking the environment.' },
    { background: '#fff', foreground: '#111', muted: '#666', primary: '#373', border: '#ddd', colorScheme: 'light' }, null), '#heading, #detail'],
  ]) {
    await page.goto('about:blank');
    await page.setContent(html);
    await read(name, selector);
    if (await page.locator('main').count()) assert.equal(await page.locator('main').evaluate(node => getComputedStyle(node).backgroundImage), 'none');
    if (name === 'blocked') {
      // Published theme selectors must not override this document's resolved palette.
      for (const [selector, property, token] of [
        ['#blocked-summary > p:not(.eyebrow)', 'color', '--blocked-muted'],
        ['.button.primary', 'backgroundColor', '--blocked-accent'],
      ]) {
        const colors = await page.locator(selector).evaluate((node, { property, token }) => {
          const probe = document.createElement('span');
          probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(token);
          document.body.append(probe);
          const expected = getComputedStyle(probe).color;
          probe.remove();
          return { actual: getComputedStyle(node)[property], expected };
        }, { property, token });
        assert.equal(colors.actual, colors.expected, selector);
      }
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
    await read(`${name}-enlarged`, selector, '15px');
  }
  if (!native) {
    const touch = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true });
    await touch.addInitScript(snapshot => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: 'en-US', resolved_locale: 'en-US', source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, mixedEnvironmentFixture().snapshot);
    const touchPage = await touch.newPage();
    await touchPage.goto(`${report.url}environment-settings.html`);
    await touchPage.locator('.redeven-center-search input').waitFor();
    const metrics = await touchPage.locator('.redeven-center-search input').evaluate(node => ({
      size: getComputedStyle(node).fontSize, height: node.getBoundingClientRect().height,
    }));
    report.cases.push({ name: 'touch-search', ...metrics });
    assert.equal(metrics.size, '16px');
    assert.ok(metrics.height >= 44);
    await touch.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failures, [], 'Body and ordinary controls must use the published scale');
  report.status = 'passed';
  console.log(`Body typography: ${report.cases.length} scenarios passed (${native ? 'Electron' : 'Chromium'})`);
} finally {
  await writeFile(path.join(output, 'desktop-measurements.json'), JSON.stringify(report, null, 2));
  await app?.close();
  await browser?.close();
  await server?.close();
  if (state) await rm(state, { recursive: true, force: true });
}
