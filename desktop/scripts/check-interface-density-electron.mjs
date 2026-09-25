import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

execFileSync('../scripts/check_desktop_electron_test_runtime.sh', [], { stdio: 'inherit' });
const output = path.resolve('dist/interface-density-acceptance');
await mkdir(output, { recursive: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDiff: execFileSync('git', ['diff', '--stat'], { encoding: 'utf8' }).trim(),
  floe: JSON.parse(await readFile('node_modules/@floegence/floe-webapp-core/package.json', 'utf8')).version,
  marker: randomUUID(), cases: [], errors: [] };
const state = await mkdtemp(path.join(tmpdir(), 'redeven-density-electron-'));
let server;
let app;
try {
  report.state = state;
  server = await createSSHSettingsPreviewServer(0);
  await server.watcher.close();
  report.port = new URL(server.resolvedUrls.local[0]).port;
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(path.resolve('src/testSupport/mixedEnvironmentFixture.ts'));
  const { RUNTIME_SERVICE_COMPATIBILITY_EPOCH: epoch, RUNTIME_SERVICE_PROTOCOL_VERSION: protocol } = await server.ssrLoadModule(path.resolve('src/shared/runtimeService.ts'));
  const snapshot = mixedEnvironmentFixture().snapshot;
  snapshot.environments = snapshot.environments.map(entry => {
    const service = entry.runtime_service ?? entry.local_environment_runtime_service;
    return { ...entry, runtime_service: service ? { ...service, compatibility_epoch: epoch, protocol_version: protocol,
      compatibility: 'compatible', compatibility_message: undefined, open_readiness: { state: 'openable' }, ai_readiness: { state: 'inspecting' } } : undefined };
  });
  const entry = path.join(state, 'main.cjs');
  await writeFile(entry, `const {app, BrowserWindow} = require('electron');
    app.whenReady().then(() => { const win = new BrowserWindow({width:1440,height:1000,useContentSize:true,show:true,webPreferences:{contextIsolation:true,sandbox:true}}); win.loadURL('about:blank'); });`);
  // Playwright owns the isolated process group and closes only this launch.
  app = await _electron.launch({ executablePath: electron, cwd: state, args: [entry, `--user-data-dir=${state}/profile`, `--redeven-smoke-run=${report.marker}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  report.pid = app.process().pid;
  await writeFile(path.join(output, 'runtime.json'), JSON.stringify(report, null, 2));
  report.electron = await app.evaluate(() => process.versions.electron);
  const page = await app.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(snapshot => {
    window.navigationSnapshot = { ...snapshot, navigation_revision: 1 };
    const language = { preference: 'zh-CN', resolved_locale: 'zh-CN', source: 'explicit', system_candidates: [] };
    window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
  }, snapshot);
  await page.goto(new URL('flower-navigation.html', server.resolvedUrls.local[0]).href);
  await page.locator('.redeven-flower-topbar-button').click();
  await page.evaluate(() => window.navigationFixture.releaseRuntime());
  await page.locator('[data-thread-id="navigation-thread"] .flower-thread-card-select-button').click();
  await page.locator('.flower-message-bubble-assistant p').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => { window.densityComposer = document.querySelector('.flower-composer textarea'); });
  for (const mode of ['light', 'dark']) {
    for (const material of ['flat', 'soft-neumorphic']) {
      for (const zoom of [1, 1.25, 2]) {
        await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), zoom);
        await page.evaluate(({ mode, material }) => {
          document.documentElement.classList.toggle('dark', mode === 'dark');
          document.documentElement.classList.toggle('light', mode === 'light');
          document.documentElement.dataset.floeShellTheme = `porcelain-${mode}`;
          document.documentElement.dataset.floeSurfaceStyle = material;
        }, { mode, material });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const metrics = await page.evaluate(() => {
          const paragraph = document.querySelector('.flower-message-bubble-assistant p');
          const composer = document.querySelector('.flower-composer');
          const controls = [...composer.querySelectorAll('button')].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
          const bounds = composer.getBoundingClientRect();
          const css = getComputedStyle(paragraph);
          return { root: getComputedStyle(document.documentElement).fontSize, font: css.fontFamily, size: css.fontSize, line: css.lineHeight,
            weight: css.fontWeight, dpr: devicePixelRatio, visualScale: visualViewport.scale, width: innerWidth, height: innerHeight,
            header: document.querySelector('.flower-chat-header').getBoundingClientRect().height, composer: bounds.height,
            retained: window.densityComposer === composer.querySelector('textarea'),
            overflow: document.documentElement.scrollWidth > innerWidth,
            controlsContained: controls.every(node => { const box = node.getBoundingClientRect(); return box.right <= innerWidth + 1 && box.left >= -1 && box.bottom <= innerHeight + 1; }) };
        });
        const actualZoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
        report.cases.push({ mode, material, zoom: actualZoom, ...metrics });
        await page.screenshot({ path: path.join(output, `flower-${mode}-${material}-${zoom}.png`) });
        assert.equal(actualZoom, zoom);
        assert.equal(metrics.root, '16px');
        assert.equal(metrics.size, '13px'); assert.equal(metrics.line, '20px'); assert.equal(metrics.weight, '400');
        assert.ok(metrics.font.includes('Inter Variable'));
        assert.equal(metrics.retained, true); assert.equal(metrics.overflow, false); assert.equal(metrics.controlsContained, true);
        if (zoom === 1) { assert.equal(metrics.header, 40); assert.equal(metrics.composer, 84); }
      }
    }
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await page.locator('.redeven-flower-back-button').click();
  await page.screenshot({ path: path.join(output, 'welcome.png') });
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log('Electron interface density passed:', JSON.stringify(report));
} catch (error) {
  report.status = 'failed'; report.error = String(error); throw error;
} finally {
  try {
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  } finally {
    try { await app?.close(); }
    finally {
      try { await server?.close(); }
      finally { await rm(state, { recursive: true, force: true }); }
    }
  }
}
