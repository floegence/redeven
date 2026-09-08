import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertIsolatedSmokeConfiguration } from './smoke_desktop_plugins.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const hostSelector = '[data-redeven-plugin-workbench-surface] [data-plugin-surface-host]';
const ids = ['com.redeven.official.mind-map', 'com.redeven.official.weather'];

async function eventually(read, label, timeout = 40_000) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function changeDesktopWindowState(config, origin, state) {
  const targets = await (await fetch(`http://127.0.0.1:${config.inspectorPort}/json/list`)).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const expression = `(async () => {
      const realpath = process.getBuiltinModule('fs').realpathSync;
      if (realpath(process.env.REDEVEN_STATE_ROOT) !== realpath(${JSON.stringify(config.stateRoot)})) throw new Error('Desktop profile ownership mismatch');
      const electron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
      const windows = electron.BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().startsWith(${JSON.stringify(origin + '/')}));
      if (windows.length !== 1) throw new Error('Expected one task-owned Env App window');
      const window = windows[0];
      ${state === 'minimized'
        ? "if (!window.isMinimized()) await new Promise(resolve => { window.once('minimize', resolve); window.minimize(); });"
        : "if (window.isMinimized()) await new Promise(resolve => { window.once('restore', resolve); window.restore(); }); window.focus();"}
      return { pid: process.pid, window_id: window.id, minimized: window.isMinimized() };
    })()`;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Desktop inspector timed out')), 5000);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timeout);
        if (message.error || message.result?.exceptionDetails) reject(new Error('Desktop window state action failed'));
        else resolve(message.result.result.value);
      });
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  } finally {
    socket.close();
  }
}

export async function verifyWorkbenchPluginOpening(page, reportRoot, config) {
  const report = { scenarios: [], plugins: [] };
  const host = (id) => page.locator(`${hostSelector}[data-plugin-id="${id}"]`);
  const switchMode = async (name) => {
    const tab = page.getByRole('tab', { name, exact: true }).filter({ visible: true });
    await tab.evaluate((node) => node.click());
    await eventually(() => page.getByRole('tab', { name, exact: true, selected: true }).count(), `${name} selection`);
  };
  const ready = async (id) => {
    await eventually(async () => {
      const surface = host(id);
      assert.equal(await surface.locator('[data-plugin-surface-error]').count(), 0, `${id} failed to open`);
      return surface.getAttribute('data-surface-instance-id').catch(() => null);
    }, `${id} first commit`);
    return (await host(id).locator('iframe').elementHandle()).contentFrame();
  };
  const launch = async (id, label) => {
    await page.locator('[data-workbench-dock-action="plugins"]').click();
    const tile = page.locator('[data-plugin-panel-tile]').filter({ hasText: label }).first();
    await tile.click();
    await host(id).waitFor({ state: 'attached', timeout: 30_000 });
  };
  const clickPlugin = async (id, frame, selector) => {
    const iframe = host(id).locator('iframe');
    await eventually(() => iframe.evaluate((node) => !node.closest('[inert]')
      && node.closest('[data-redeven-workbench-layout-interacting]')?.getAttribute('data-redeven-workbench-layout-interacting') !== 'true'), 'interactive plugin placement');
    let previous;
    await eventually(async () => {
      const box = await iframe.boundingBox();
      const current = JSON.stringify(box);
      const stable = current === previous && await iframe.evaluate((node) => !node.closest('[inert]'));
      previous = current;
      return stable;
    }, 'settled canvas transform');
    const box = await iframe.boundingBox();
    const size = await iframe.evaluate((node) => ({ width: node.clientWidth, height: node.clientHeight }));
    const target = await frame.locator(selector).evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    // Chromium's child-frame locator coordinates omit the ancestor canvas scale.
    // Map the real pointer through the iframe's rendered bounds for this test.
    await page.mouse.click(box.x + target.x * box.width / size.width, box.y + target.y * box.height / size.height);
  };
  const snapshot = () => page.locator(hostSelector).evaluateAll((surfaces) => surfaces.map((surface) => {
    const widget = surface.closest('[data-floe-workbench-widget-id]');
    return {
      plugin: surface.getAttribute('data-plugin-id'),
      surface: surface.getAttribute('data-surface-instance-id'),
      widget: widget?.getAttribute('data-floe-workbench-widget-id'),
      iframes: surface.querySelectorAll('iframe').length,
    };
  }).sort((a, b) => a.plugin.localeCompare(b.plugin)));
  const assertRetained = async (before, name) => {
    assert.deepEqual(await snapshot(), before, `${name} replaced a healthy surface or its container`);
    assert.equal(await page.locator(`${hostSelector} [data-plugin-surface-error]`).count(), 0);
    report.scenarios.push(name);
    console.log(`[opening] ${name}`);
  };

  await switchMode('Activity');
  for (const existing of await page.locator('[data-redeven-plugin-activity-window="true"]').all()) {
    if (await existing.locator('[data-plugin-id="com.redeven.official.weather"], [data-plugin-id="com.redeven.official.mind-map"]').count() === 0) continue;
    await existing.getByRole('button', { name: 'Close', exact: true }).click();
    await existing.waitFor({ state: 'detached' });
  }
  await switchMode('Workbench');
  for (const id of ids) {
    const existing = host(id);
    if (await existing.count() === 0) continue;
    await existing.locator('xpath=ancestor::*[@data-floe-workbench-widget-id]').first()
      .locator('.workbench-widget__traffic-dot--close').evaluate((node) => node.click());
    await existing.waitFor({ state: 'detached' });
  }
  // The delay allows the real KeepAlive mode switch to occur during opening.
  const preparePattern = '**/_redevplugin/api/plugins/surfaces/*/prepare';
  let preparations = 0;
  await page.route(preparePattern, async (route) => {
    preparations += 1;
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await launch(ids[0], 'Mind Map');
  await switchMode('Activity');
  const mindmap = await ready(ids[0]);
  assert.equal(await host(ids[0]).isVisible(), false);
  assert.equal(preparations, 1, 'hidden-start scenario must include a real preparation');
  await page.unroute(preparePattern);
  report.scenarios.push('opening_in_hidden_keepalive');
  console.log('[opening] opening_in_hidden_keepalive');
  await switchMode('Workbench');

  const offscreenStyle = await page.addStyleTag({ content: `${hostSelector} { position: fixed !important; left: -50000px !important; top: 0 !important; width: 1120px !important; height: 760px !important; }` });
  await launch(ids[1], 'Weather');
  const weather = await ready(ids[1]);
  await offscreenStyle.evaluate((node) => node.remove());
  report.scenarios.push('opening_fully_offscreen');
  console.log('[opening] opening_fully_offscreen');
  await mindmap.locator('[data-redevplugin-action="new-document"]').waitFor({ state: 'attached' });
  await weather.locator('input[name="query"]').waitFor({ state: 'attached' });
  const before = await snapshot();
  assert.equal(before.length, 2);
  assert(before.every((item) => item.iframes === 1 && item.surface && item.widget));

  for (let cycle = 0; cycle < 4; cycle += 1) {
    await switchMode('Activity');
    await switchMode('Workbench');
  }
  await assertRetained(before, 'repeated_mode_switches');

  // Use product widget controls so canvas transformations remain host-owned.
  for (const id of ids) {
    const widget = host(id).locator('xpath=ancestor::*[@data-floe-workbench-widget-id]').first();
    await widget.locator('.workbench-widget__traffic-dot--max, .workbench-widget__window-control--max').first().evaluate((node) => node.click());
    await widget.locator('.workbench-widget__traffic-dot--min, .workbench-widget__window-control--min').first().evaluate((node) => node.click());
  }
  await assertRetained(before, 'widget_fit_and_overview');

  const canvas = page.locator('.floe-infinite-canvas').first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox);
  for (const scale of [0.35, 1]) {
    const current = await canvas.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node.firstElementChild).transform).a);
    await canvas.dispatchEvent('wheel', {
      bubbles: true, cancelable: true, ctrlKey: true, deltaMode: 0,
      deltaY: Math.log(current / scale) / 0.0014,
      clientX: canvasBox.x + 15, clientY: canvasBox.y + 15,
    });
    await eventually(async () => (await page.locator('.workbench-hud__scale').textContent()).trim() === `${Math.round(scale * 100)}%`, `${scale * 100}% canvas zoom`);
    await assertRetained(before, `zoom_${scale * 100}_percent`);
  }
  await page.mouse.move(canvasBox.x + 15, canvasBox.y + 15);
  await page.mouse.wheel(20_000, 20_000);
  await page.mouse.wheel(-20_000, -20_000);
  await assertRetained(before, 'pan_out_of_viewport_and_back');

  // Hidden ancestry must preserve the actual iframe and its render allocation.
  const hiddenStyle = await page.addStyleTag({ content: `${hostSelector} { display: none !important; }` });
  await assertRetained(before, 'filter_equivalent_hidden_ancestor');
  await hiddenStyle.evaluate((node) => node.remove());
  const mindmapCanvas = mindmap.locator('canvas').first();
  await eventually(async () => mindmapCanvas.evaluate((node) => node.width > 0 && node.height > 0), 'restored canvas allocation');
  report.plugins.push({ id: ids[0], canvas: await mindmapCanvas.evaluate((node) => ({ width: node.width, height: node.height })) });

  // Fit each real plugin before interacting inside its opaque iframe.
  const fit = async (id) => {
    await host(id).locator('xpath=ancestor::*[@data-floe-workbench-widget-id]').first()
      .locator('.workbench-widget__traffic-dot--max, .workbench-widget__window-control--max').first().evaluate((node) => node.click());
  };
  await fit(ids[0]);
  const previousDocuments = await mindmap.locator('[data-redevplugin-action="select-document"]').count();
  await clickPlugin(ids[0], mindmap, '[data-redevplugin-action="new-document"]');
  await mindmap.locator('[data-redevplugin-action="submit-modal"] input[name="value"]').fill('Opening regression');
  await clickPlugin(ids[0], mindmap, '[data-redevplugin-action="submit-modal"] button[type="submit"]');
  await eventually(async () => await mindmap.locator('[data-redevplugin-action="select-document"]').count() > previousDocuments, 'Mind Map interaction');
  await fit(ids[1]);
  const search = weather.locator('input[name="query"]');
  await search.fill('A');
  await clickPlugin(ids[1], weather, '[data-redevplugin-action="search-location"] button[type="submit"]');
  await clickPlugin(ids[1], weather, '[data-redevplugin-action="clear-search"]');
  await eventually(async () => await search.inputValue() === '', 'Weather clear action');
  report.plugins.push({ id: ids[1], search_and_clear_interactive: true });
  await assertRetained(before, 'real_plugin_interaction_after_restoration');
  await page.screenshot({ path: path.join(reportRoot, 'workbench-opening.png') });

  try {
    report.desktop = await changeDesktopWindowState(config, new URL(page.url()).origin, 'minimized');
    assert.equal(report.desktop.minimized, true);
    report.desktop.document_hidden = await page.evaluate(() => document.hidden);
    await assertRetained(before, 'desktop_minimized');
  } finally {
    const restoredWindow = await changeDesktopWindowState(config, new URL(page.url()).origin, 'normal');
    assert.equal(restoredWindow.minimized, false);
  }
  await eventually(() => page.evaluate(() => !document.hidden), 'native Desktop restoration');
  await assertRetained(before, 'desktop_restored');

  // A second container uses an independent slot. Lose its exact close response
  // after the Host commits it, then recover through the normal Retry control.
  await switchMode('Activity');
  const network = await page.context().newCDPSession(page);
  const pausedPreparations = [];
  let disposedOnHost = false;
  let closeObservationError;
  network.on('Fetch.requestPaused', (event) => {
    if (event.request.url.endsWith('/prepare')) {
      pausedPreparations.push(event.requestId);
      return;
    }
    if (event.responseStatusCode === 200) disposedOnHost = true;
    else closeObservationError = new Error(`Exact close returned ${event.responseStatusCode}`);
    void network.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' }).catch((error) => { closeObservationError = error; });
  });
  // Response-stage interception preserves the Desktop's native request
  // authentication and loses only the real Host's completed response.
  await network.send('Fetch.enable', { patterns: [
    { urlPattern: '*/_redevplugin/api/plugins/surfaces/*/prepare', requestStage: 'Request' },
    { urlPattern: '*/_redevplugin/api/plugins/surfaces/*/dispose', requestStage: 'Response' },
  ] });
  const activity = page.locator('[data-redeven-plugin-activity-window="true"] [data-plugin-surface-host][data-plugin-id="com.redeven.official.weather"]');
  try {
    await page.locator('[aria-controls="redeven-plugin-switcher"]').filter({ visible: true }).first().click();
    await page.locator('[data-plugin-panel-tile]').filter({ hasText: 'Weather' }).first().click();
    await activity.locator('[data-plugin-surface-error]').waitFor({ timeout: 40_000 });
    const diagnostic = JSON.parse(await activity.locator('[data-plugin-surface-diagnostics]').textContent());
    assert.equal(diagnostic.error_code, 'PLUGIN_BRIDGE_TIMEOUT');
    assert.equal(diagnostic.opening.stage, 'preparing');
    assert.deepEqual(diagnostic.opening.pendingMilestones, ['prepare']);
    assert(diagnostic.opening.elapsedMs >= 29_000);
    await eventually(() => disposedOnHost, 'committed close with lost response');
    assert.equal(closeObservationError, undefined);
    assert.equal(await activity.locator('iframe').count(), 0);
    await assertRetained(before, 'failed_independent_slot_does_not_affect_siblings');
    report.timeout = diagnostic;
  } finally {
    for (const requestId of pausedPreparations) await network.send('Fetch.continueRequest', { requestId }).catch(() => {});
    await network.send('Fetch.disable');
    await network.detach();
  }
  await activity.locator('[data-plugin-surface-open-retry]').click();
  await eventually(() => activity.getAttribute('data-surface-instance-id'), 'retry after exact close reconciliation');
  assert.equal(await activity.locator('iframe').count(), 1);
  await activity.locator('xpath=ancestor::*[@data-redeven-plugin-activity-window="true"]').first()
    .getByRole('button', { name: 'Close', exact: true }).click();
  await activity.waitFor({ state: 'detached' });
  await assertRetained(before, 'retry_reconciles_lost_close_response');

  // Reload exercises persisted geometry with fresh authority and iframe slots.
  await switchMode('Activity');
  await page.reload();
  await page.getByRole('tab', { name: 'Workbench', exact: true }).waitFor({ timeout: 60_000 });
  await switchMode('Workbench');
  await switchMode('Activity');
  await Promise.all(ids.map(ready));
  const restored = await snapshot();
  assert.deepEqual(restored.map(({ plugin, widget }) => ({ plugin, widget })), before.map(({ plugin, widget }) => ({ plugin, widget })));
  assert(restored.every((item) => item.iframes === 1 && item.surface !== before.find((old) => old.plugin === item.plugin).surface));
  await switchMode('Workbench');
  report.scenarios.push('saved_layout_reload_with_fresh_slots');
  return report;
}

async function main() {
  const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  assertIsolatedSmokeConfiguration(config);
  await fs.mkdir(config.reportRoot, { recursive: true });
  const { chromium } = require(path.join(root, 'internal/envapp/ui_src/node_modules/playwright'));
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${config.cdpPort}`);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().startsWith('http') && !candidate.url().includes('devtools'));
  assert(page, 'Isolated Desktop needs an open Env App with released Weather and Mind Map installed');
  try {
    const report = await verifyWorkbenchPluginOpening(page, config.reportRoot, config);
    await fs.writeFile(path.join(config.reportRoot, 'opening.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } catch (error) {
    await page.screenshot({ path: path.join(config.reportRoot, 'opening-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
