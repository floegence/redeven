import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { createBuiltFlowerPreview } from './flower-preview.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 180000 });
await session.run(async () => {
  const state = await session.directory(await mkdtemp(path.join(tmpdir(), 'redeven-model-picker-')));
  const output = path.join(root, 'desktop/dist/model-picker-acceptance');
  await mkdir(output, { recursive: true });
  const { url, mixedEnvironmentFixture, RUNTIME_SERVICE_COMPATIBILITY_EPOCH: epoch, RUNTIME_SERVICE_PROTOCOL_VERSION: protocol } = await createBuiltFlowerPreview(session, state);
  await writeFile(path.join(state, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => new BrowserWindow({ width: 1280, height: 900, useContentSize: true, webPreferences: { contextIsolation: true, sandbox: true } }).loadURL('about:blank'));`);
  const app = await session.launchElectron(_electron, { executablePath: electron, args: [path.join(state, 'main.cjs'), `--user-data-dir=${state}/profile`], cwd: state, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const snapshot = mixedEnvironmentFixture().snapshot;
  snapshot.environments = snapshot.environments.map(entry => ({ ...entry, runtime_service: {
    ...(entry.runtime_service ?? entry.local_environment_runtime_service), compatibility_epoch: epoch, protocol_version: protocol, compatibility: 'compatible',
    open_readiness: { state: 'openable' }, ai_readiness: { state: 'inspecting' },
  } }));
  await page.addInitScript(snapshot => {
    if (window.top !== window) return;
    window.navigationSnapshot = { ...snapshot, navigation_revision: 1 };
    const language = { preference: 'zh-CN', resolved_locale: 'zh-CN', source: 'explicit', system_candidates: [] };
    window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
  }, snapshot);
  await page.goto(new URL('flower-navigation.html?model-picker', url).href);
  await page.getByRole('button', { name: 'Flower', exact: true }).click();
  await page.evaluate(() => window.navigationFixture.releaseRuntime());
  await page.locator('.flower-composer textarea').waitFor();
  await page.locator('.flower-sidebar-actions .flower-new-chat-button').click();
  await page.waitForFunction(() => !document.querySelector('[data-flower-engaged]')?.getAttribute('data-flower-selected-thread-id'));
  const report = { carrier: 'built Desktop Flower in Electron', widths: [], errors };
  for (const width of [1280, 390]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await page.waitForFunction(width => window.innerWidth === width, width);
    const cycles = [];
    let trigger;
    for (const model of ['DeepSeek V4.1 Flash (1017)', 'Sol', 'DeepSeek V4.1 Flash (1017)', 'Sol']) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      trigger = page.locator('button.flower-model-reasoning-model-trigger').filter({ visible: true });
      if (await trigger.count() === 0) await page.locator('.flower-composer-more-button').click();
      await trigger.click();
      const menu = page.locator('.flower-model-menu:not([inert])');
      await menu.waitFor();
      await page.waitForFunction(() => document.querySelector('.flower-model-menu')?.dataset.floatingPresence === 'open');
      await menu.evaluate(async el => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(el.getAnimations().map(animation => animation.finished));
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await menu.evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, order: [...el.querySelectorAll('.flower-model-menu-name')].map(row => row.textContent) }));
      await page.screenshot({ path: path.join(output, `${width}-${cycles.length}.png`) });
      if (cycles.length) { assert.ok(Math.abs(geometry.left - cycles[0].left) <= 1, JSON.stringify({ width, geometry, previous: cycles[0] })); assert.deepEqual(geometry.order, cycles[0].order); }
      assert.ok(geometry.left >= 0 && geometry.right <= width);
      const frames = await menu.evaluate(async (el, model) => {
        const layer = el.closest('.flower-model-menu-layer');
        const initial = layer.getBoundingClientRect();
        const rows = () => [...el.querySelectorAll('.flower-model-menu-name')].map(row => row.textContent);
        const order = rows();
        const row = [...el.querySelectorAll('.flower-model-menu-item')].find(row => row.querySelector('.flower-model-menu-name')?.textContent === model);
        if (!row) throw new Error(JSON.stringify({ expected: model, rows: rows(), html: el.outerHTML }));
        row.click();
        const frames = [];
        const deadline = performance.now() + 1500;
        while (el.isConnected && performance.now() < deadline) {
          frames.push({ drift: layer.getBoundingClientRect().left - initial.left, verticalDrift: layer.getBoundingClientRect().top - initial.top, stableRows: JSON.stringify(rows()) === JSON.stringify(order) });
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return { frames, detached: !el.isConnected };
      }, model);
      assert.ok(frames.detached && frames.frames.every(frame => Math.abs(frame.drift) <= 1 && Math.abs(frame.verticalDrift) <= 1 && frame.stableRows));
      await page.waitForFunction(model => [...document.querySelectorAll('button.flower-model-reasoning-model-trigger')].some(button => button.textContent.includes(model) && !button.disabled), model);
      await page.waitForFunction(() => document.activeElement?.matches('button.flower-model-reasoning-model-trigger, .flower-composer-more-button'));
      cycles.push({ model, ...geometry, ...frames });
    }
    trigger = page.locator('button.flower-model-reasoning-model-trigger').filter({ visible: true });
    if (await trigger.count() === 0) await page.locator('.flower-composer-more-button').click();
    await trigger.click();
    await page.waitForFunction(() => document.querySelector('.flower-model-menu')?.dataset.floatingPresence === 'open');
    await page.locator('.flower-model-menu input').fill('Sol');
    assert.equal(await page.locator('.flower-model-menu-item').count(), 1);
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.activeElement?.matches('.flower-model-menu-item'));
    await page.keyboard.press('Escape');
    await page.locator('.flower-model-menu').waitFor({ state: 'detached' });
    report.widths.push({ width, cycles, keyboard: true });
    await page.screenshot({ path: path.join(output, `${width}.png`) });
  }
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.navigationFixture.dispose());
  await session.closeElectron(app);
  await session.writeEvidence(path.join(output, 'report.json'), JSON.stringify({ ...report, passed: true }, null, 2));
});
