import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuiltFlowerPreview } from './flower-preview.mjs';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 180000 });
const activeTail = process.argv.includes('--active-tail');
await session.run(async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = path.join(root, activeTail ? 'desktop/dist/flower-startup-active-tail-acceptance' : 'desktop/dist/flower-startup-acceptance');
  await mkdir(output, { recursive: true });
  const state = await mkdtemp(path.join(tmpdir(), 'redeven-flower-startup-'));
  await session.directory(state);
  const { url, mixedEnvironmentFixture, RUNTIME_SERVICE_COMPATIBILITY_EPOCH: epoch, RUNTIME_SERVICE_PROTOCOL_VERSION: protocol } = await createBuiltFlowerPreview(session, state);
  const entry = path.join(state, 'main.cjs');
  await writeFile(entry, "const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => { const win = new BrowserWindow({ width: 1280, height: 900, webPreferences: { contextIsolation: true, sandbox: true } }); win.loadURL('about:blank'); });");
  const application = await session.launchElectron(_electron, {
    executablePath: electron, args: [entry, `--user-data-dir=${state}/profile`], cwd: state,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  const pid = application.process().pid;
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const snapshot = mixedEnvironmentFixture().snapshot;
  snapshot.environments = snapshot.environments.map(entry => ({ ...entry, runtime_service: {
    ...(entry.runtime_service ?? entry.local_environment_runtime_service),
    compatibility_epoch: epoch, protocol_version: protocol, compatibility: 'compatible',
    open_readiness: { state: 'openable' }, ai_readiness: { state: 'inspecting' },
  } }));
  await page.addInitScript(snapshot => {
    if (window.top !== window) return;
    window.navigationSnapshot = { ...snapshot, navigation_revision: 1 };
    const language = { preference: 'zh-CN', resolved_locale: 'zh-CN', source: 'explicit', system_candidates: [] };
    window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
  }, snapshot);
  await page.goto(new URL('flower-navigation.html?progressive&delayed-first-page&settled-history' + (activeTail ? '&active-tail' : ''), url).href);
  await page.getByRole('button', { name: 'Flower', exact: true }).click();
  await page.locator('[data-flower-runtime-availability=preparing]').waitFor();
  await page.evaluate(() => window.navigationFixture.releaseRuntime());
  await page.locator('#redeven-flower-surface .flower-warmup[aria-busy=true]').waitFor();
  assert.equal(await page.locator('.flower-chat-shell').count(), 0);
  assert.equal(await page.locator('.flower-workspace-sync').count(), 0);
  assert.equal(await page.locator('.flower-composer textarea').count(), 0);
  await page.screenshot({ path: path.join(output, 'initial-loading.png') });
  await page.evaluate(() => window.navigationFixture.releaseFirstPage());
  await page.locator('[data-thread-id=navigation-thread] button').first().click();
  await page.locator('[data-flower-selected-thread-id=navigation-thread][data-flower-selected-thread-loading=false]').waitFor();
  const composer = page.locator('.flower-composer-content textarea').first();
  await composer.fill('Preserve this draft while older conversations load');
  assert.equal(await page.locator('[data-thread-id=older-thread]').count(), 0);
  await page.evaluate(() => window.navigationFixture.releaseBaseline());
  await page.locator('[data-thread-id=older-thread] button').first().waitFor();
  assert.equal(await composer.inputValue(), 'Preserve this draft while older conversations load');
  assert.equal(await page.locator('[data-flower-engaged]').getAttribute('data-flower-selected-thread-id'), 'navigation-thread');
  assert.equal(await page.locator('[data-flower-sync-state=failed]').count(), 0);
  const counters = await page.evaluate(() => ({ requests: window.navigationFixture.requests, streams: window.navigationFixture.streams, prematureRequests: window.navigationFixture.prematureRequests }));
  assert.equal(counters.streams, 1);
  assert.equal(counters.prematureRequests, 0);
  assert.equal(counters.requests.filter(request => request === 'GET ai/threads').length, 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'complete.png') });
  // Sample rendering opportunities in the built native renderer. Cached
  // navigation must never expose intrinsic placeholder geometry as content.
  assert.ok(await page.locator('[data-flower-turn-settled=true]').count() > 0);
  if (activeTail) assert.ok(await page.locator('.flower-turn-row:not([data-flower-turn-settled])').count() > 0);
  const warmSwitches = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('.flower-sidebar-actions .flower-new-chat-button').click();
    await page.waitForFunction(() => !document.querySelector('[data-flower-engaged]')?.getAttribute('data-flower-selected-thread-id'));
    const result = await page.evaluate(async () => {
      const started = performance.now();
      document.querySelector('[data-thread-id=navigation-thread] button').click();
      const frames = [];
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const surface = document.querySelector('[data-flower-engaged]');
        if (surface?.getAttribute('data-flower-selected-thread-id') !== 'navigation-thread') continue;
        const viewport = surface.querySelector('.flower-chat-transcript');
        const tail = viewport.querySelector('.flower-turn-row:last-child').getBoundingClientRect();
        frames.push({ time: performance.now() - started, preparing: viewport.dataset.flowerTailPreparing === 'true', tailTop: tail.top, tailBottom: tail.bottom,
          top: viewport.scrollTop, height: viewport.scrollHeight,
          distance: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop });
      }
      return frames;
    });
    assert.ok(result.length > 0);
    const exposed = result.filter(frame => !frame.preparing);
    assert.ok(exposed.length > 0);
    assert.ok(exposed.every(frame => frame.top > 1000 && Math.abs(frame.distance) <= 1), JSON.stringify(result));
    assert.ok(exposed.every(frame => Math.abs(frame.tailTop - exposed.at(-1).tailTop) <= 1
      && Math.abs(frame.tailBottom - exposed.at(-1).tailBottom) <= 1), JSON.stringify(result));
    warmSwitches.push(result);
  }
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.navigationFixture.dispose());
  assert.ok(await page.evaluate(() => window.navigationFixture.cancellations > 0));
  await session.closeElectron(application);
  await session.writeEvidence(path.join(output, 'report.json'), JSON.stringify({
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    status: 'passed', pid, initialLoading: true, partialSelection: true, draftPreserved: true, warmSwitches, ...counters, errors,
  }, null, 2));
});
