import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync, backup } from 'node:sqlite';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const welcomeURL = pathToFileURL(path.join(root, 'desktop/dist/welcome/index.html')).href;
const require = createRequire(new URL('../package.json', import.meta.url));
const [bundleArgument, outputArgument, libraryArgument, canvasArgument] = process.argv.slice(2);
assert(bundleArgument && outputArgument, 'Required: <built Desktop bundle> <evidence directory> [<read-only canvas library> <canvas ID>]');
execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
const bundle = path.resolve(bundleArgument), output = path.resolve(outputArgument);
const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
const state = await mkdtemp(path.join(tmpdir(), 'redeven-service-canvas-window-'));
const report = { commit: manifest.commit, bundle, state, marker: randomUUID(), scenarios: [], local_routes: [], errors: [] };
report.source_commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.ok(report.source_commit.startsWith(manifest.commit), 'The runtime bundle must match the renderer source commit');
report.floe = {
  desktop: JSON.parse(await readFile(path.join(root, 'desktop/node_modules/@floegence/floe-webapp-core/package.json'), 'utf8')).version,
  env: JSON.parse(await readFile(path.join(root, 'internal/envapp/ui_src/node_modules/@floegence/floe-webapp-core/package.json'), 'utf8')).version,
};
await mkdir(output, { recursive: true });
if (libraryArgument) {
  const source = new DatabaseSync(path.resolve(libraryArgument), { readOnly: true });
  const destination = path.join(state, 'local-environment/apps/tessiven/canvases.sqlite');
  try {
    assert.equal(source.prepare('PRAGMA user_version').get().user_version, 2);
    await mkdir(path.dirname(destination), { recursive: true });
    await backup(source, destination);
  } finally { source.close(); }
  const copy = new DatabaseSync(destination);
  try {
    // Only the task-owned canvas snapshot is copied, not the user's AI history.
    copy.prepare("UPDATE canvases SET flower_thread_id = ''").run();
  } finally { copy.close(); }
  report.canvas_library = path.resolve(libraryArgument);
}
let app, welcome;
const until = async (read, label) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
};
async function setTheme(page, mode, preset) {
  await welcome.evaluate(async ({ mode, preset }) => {
    await window.redevenDesktopTheme.setShellTheme(mode, preset);
    await window.redevenDesktopTheme.setSource(mode);
  }, { mode, preset });
  await page.waitForFunction(({ mode, preset }) =>
    document.documentElement.classList.contains('dark') === (mode === 'dark')
    && document.documentElement.dataset.floeShellTheme === preset
    && !document.documentElement.dataset.redevenThemeSwitching, { mode, preset });
}
const routingThemes = [['light', 'porcelain-light'], ['dark', 'porcelain-dark'], ['light', 'hc-light']];
async function verifyCanvasNavigation(page, name) {
  const count = await page.locator('.tessiven-node').count();
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await until(async () => await page.locator('.tessiven-node').count() === 0, 'native bulk collapse');
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await until(async () => await page.locator('.tessiven-node').count() === count, 'native bulk expand');
  const scope = page.getByRole('combobox', { name: 'Node services', exact: true });
  for (const value of ['group', 'all']) {
    await scope.selectOption(value);
    await until(async () => await page.getByRole('status', { name: 'Arranging canvas', exact: true }).count() === 0, 'native service scope');
    assert.equal(await scope.inputValue(), value);
  }
  const overview = page.getByRole('region', { name: 'Canvas overview', exact: true });
  assert.equal(await overview.locator('path').count(), 3);
  const transform = () => page.locator('.floe-infinite-canvas__viewport').evaluate(node => node.style.transform);
  const before = await transform();
  const box = await overview.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8, { steps: 8 });
  await page.mouse.up();
  await until(async () => await transform() !== before, 'native overview drag');
  await overview.focus();
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => globalThis.getSelection()?.toString() ?? ''), '');
  report.scenarios.push(`${name}-bulk-groups-service-scope-overview-drag`);
}
async function verifyLocalRoute(page, name, selector = '.tessiven-node .tessiven-local-relation', zoom = false) {
  const replies = page.locator('.tessiven-flower-output');
  if (await replies.count()) await replies.getByRole('button', { name: 'Hide replies', exact: true }).click();
  const call = page.locator(selector).first();
  const preview = page.locator('.tessiven-service-link-preview');
  assert.equal(await preview.count(), 0, 'Local links stay hidden until hover');
  await call.hover();
  if (zoom) {
    const percentage = await page.locator('.tessiven-canvas-tools > span').innerText();
    await page.mouse.wheel(0, -700);
    await until(async () => await page.locator('.tessiven-canvas-tools > span').innerText() !== percentage, 'canvas wheel zoom');
    await call.hover();
  }
  await preview.waitFor();
  const geometry = await preview.evaluate(svg => {
    const line = svg.querySelector('path[data-relation-id]');
    const source = svg.parentElement.querySelector('[data-relation-endpoint="source"]');
    const target = svg.parentElement.querySelector('[data-relation-endpoint="target"]');
    const start = line.getPointAtLength(0), end = line.getPointAtLength(line.getTotalLength());
    const left = line.getBBox().x;
    const point = new DOMPoint(left, start.y).matrixTransform(svg.getScreenCTM());
    return { start: [start.x, start.y], end: [end.x, end.y], left,
      source: [source.offsetLeft, source.offsetTop + source.offsetHeight / 2],
      target: [target.offsetLeft, target.offsetTop + target.offsetHeight / 2],
      rowLeft: source.offsetLeft, rowWidth: source.offsetWidth, inventoryWidth: source.parentElement.clientWidth,
      outsideNode: point.x < source.closest('.tessiven-node').getBoundingClientRect().left,
      overflow: getComputedStyle(source.closest('.tessiven-node')).overflow };
  });
  assert.deepEqual(geometry.start, geometry.source);
  assert.deepEqual(geometry.end, geometry.target);
  assert.ok(geometry.left <= -20 && geometry.outsideNode, 'Local route extends beyond the host border');
  assert.equal(geometry.rowLeft, 0);
  assert.equal(geometry.rowWidth, geometry.inventoryWidth, 'Service inventory retains its complete width');
  assert.equal(geometry.overflow, 'visible');
  report.local_routes.push({ name, ...geometry });
  for (const [mode, preset] of routingThemes) {
    await setTheme(page, mode, preset);
    await call.hover();
    await preview.waitFor();
    await page.screenshot({ path: path.join(output, `${name}-local-link-${preset}.png`), animations: 'disabled' });
  }
  await page.mouse.move(12, 12);
  await until(async () => await preview.count() === 0, 'local link hides after leaving');
  assert.equal(await page.locator('.tessiven-error, .tessiven-notice[role="status"]').count(), 0);
  report.scenarios.push(`${name}-local-route-outside-full-width-host`);
}

async function verifyObservedCanvas(page, saved, name) {
  await page.getByRole('button', { name: 'Canvases', exact: true }).click();
  await page.getByRole('button', { name: saved.title, exact: true }).click();
  await page.locator('.tessiven-node').first().waitFor();
  const replies = page.locator('.tessiven-flower-output');
  if (await replies.count()) await replies.getByRole('button', { name: 'Hide replies', exact: true }).click();
  // The reported reference fixture contains these four independent fan-in calls.
  const edges = ['svc-kubelet/g-control-plane', 'svc-kube-proxy/g-control-plane',
    'svc-cni/g-control-plane', 'g-addons/g-control-plane'];
  const control = page.locator('[data-graph-object="g-control-plane"] .tessiven-group-toggle');
  const worker = page.locator('[data-graph-object="g-worker"] .tessiven-group-toggle');
  assert.equal(await control.count(), 1, 'The observed canvas exposes its control group');
  assert.equal(await worker.count(), 1, 'The observed canvas exposes its worker group');
  {
    for (const button of [control, worker]) if (await button.getAttribute('aria-expanded') === 'true') await button.click();
    await page.waitForFunction(() =>
      parseFloat(document.querySelector('[data-graph-object="g-control-plane"]').style.height) < 500
      && parseFloat(document.querySelector('[data-graph-object="g-worker"]').style.height) < 300);
    // Leave the group control's focus/hover isolation before inspecting all routes.
    await page.locator('.floe-graph').click({ position: { x: 12, y: 120 } });
    await until(async () => await page.locator('[data-graph-object="svc-cni/g-control-plane"] .floe-graph__edge').count(), 'collapsed fan-in routes');
    const paths = await Promise.all(edges.map(id => page.locator(`[data-graph-object="${id}"] .floe-graph__edge`).getAttribute('d')));
    const sections = paths.map(d => [...d.matchAll(/[ML]([^, ]+),([^ ]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) })));
    for (let i = 0; i < sections.length; i++) for (let j = i + 1; j < sections.length; j++)
      for (let a = 1; a < sections[i].length; a++) for (let b = 1; b < sections[j].length; b++) {
        const start = sections[i][a - 1], end = sections[i][a], other = sections[j][b - 1], otherEnd = sections[j][b];
        const vertical = start.x === end.x;
        if (vertical === (other.x === otherEnd.x)) continue;
        const x = vertical ? start.x : other.x, y = vertical ? other.y : start.y;
        assert.ok(!(x > Math.min(start.x, end.x, other.x, otherEnd.x)
          && x < Math.max(start.x, end.x, other.x, otherEnd.x)
          && y > Math.min(start.y, end.y, other.y, otherEnd.y)
          && y < Math.max(start.y, end.y, other.y, otherEnd.y)), 'Independent group fan-in routes do not cross');
      }
    report.scenarios.push(`${name}-observed-fan-in-without-crossings`);
    report[`${name}_fan_in`] = paths;
    const group = page.locator('[data-graph-object="g-control-plane"]');
    const box = await group.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2);
    const percentage = await page.locator('.tessiven-canvas-tools > span').innerText();
    await page.mouse.wheel(0, -700);
    await until(async () => await page.locator('.tessiven-canvas-tools > span').innerText() !== percentage, 'fan-in close view');
    for (const [mode, preset] of routingThemes) {
      await setTheme(page, mode, preset);
      const zoomed = await group.boundingBox();
      await page.mouse.move(zoomed.x + zoomed.width / 2, zoomed.y + zoomed.height - 2);
      await page.screenshot({ path: path.join(output, `${name}-fan-in-${preset}.png`), animations: 'disabled' });
    }
  }
  for (const [mode, preset] of routingThemes) {
    await setTheme(page, mode, preset);
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    await page.screenshot({ path: path.join(output, `${name}-observed-${preset}.png`), animations: 'disabled' });
  }
  const call = '.tessiven-node[data-node-id="n-worker-1"][data-group-id="g-addons"] .tessiven-local-relation';
  assert.ok(await page.locator(call).count(), 'The observed shared host exposes its local calls');
  await verifyLocalRoute(page, `${name}-observed`, call, true);
  const bounds = await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL() === url).getContentBounds(), page.url());
  await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL() === url).setContentSize(900, 420), page.url());
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  report[`${name}_short_viewport`] = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.screenshot({ path: path.join(output, `${name}-observed-short.png`), animations: 'disabled' });
  await verifyLocalRoute(page, `${name}-observed-short`, call, true);
  await app.evaluate(({ BrowserWindow }, { url, bounds }) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL() === url).setContentBounds(bounds), { url: page.url(), bounds });
  assert.equal(await page.locator('.tessiven-error, .tessiven-notice[role="status"]').count(), 0);
}
try {
  app = await _electron.launch({ executablePath: require('electron'), cwd: state,
    args: [path.join(root, 'desktop'), `--user-data-dir=${state}/profile`, `--redeven-canvas-window-run=${report.marker}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_STATE_ROOT: state,
      REDEVEN_DESKTOP_USER_DATA_ROOT: `${state}/profile`, REDEVEN_DESKTOP_CACHE_ROOT: `${state}/cache`, REDEVEN_DESKTOP_TEMP_ROOT: `${state}/temp`,
      REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1', REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0', REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
      REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle, REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version, REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit } });
  report.pid = app.process().pid;
  if (process.platform !== 'win32') {
    report.process_group = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(report.pid)], { encoding: 'utf8' }).trim());
    assert.equal(report.process_group, report.pid, 'Electron acceptance owns a dedicated process group');
  }
  await app.firstWindow();
  welcome = await until(() => app.context().pages().find(page =>
    page.url() === welcomeURL), 'task-owned Welcome renderer');
  welcome.on('pageerror', error => report.errors.push(error.message));
  assert.equal(welcome.url(), welcomeURL, 'Verify the task-owned built Welcome renderer');
  await welcome.waitForFunction(() => Boolean(window.redevenDesktopLanguage));
  await welcome.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
  await welcome.getByRole('button', { name: /^(Open|Show) Env App$/ }).first().click({ timeout: 60000 });
  const page = await until(() => app.context().pages().find(page => page.url().includes('/_redeven_proxy/env/')), 'owned Env App');
  report.url = page.url();
  page.on('pageerror', error => report.errors.push(error.message));
  const dock = page.locator('[data-workbench-dock-action="tessiven"]');
  await dock.waitFor();
  const canvasPages = () => app.context().pages().filter(page => new URL(page.url()).searchParams.get('window') === 'service-canvas');
  const blocked = page.getByText('Popup was blocked. Please allow popups and try again.', { exact: true });
  await dock.click();
  const canvas = await until(() => canvasPages()[0], 'standalone canvas');
  canvas.on('pageerror', error => report.errors.push(error.message));
  await canvas.locator('.tessiven-library-card').first().waitFor();
  assert.equal(await canvas.locator('[data-floe-shell-slot], [data-workbench-dock-action]').count(), 0);
  assert.equal(await canvas.locator('.tessiven-error, .tessiven-notice[role="status"]').count(), 0);
  assert.equal(await blocked.count(), 0, 'Opening a native window must not report browser popup blocking');
  report.scenarios.push('native-open-without-popup-warning');
  for (const mode of ['light', 'dark']) {
    await welcome.evaluate(mode => window.redevenDesktopTheme.setSource(mode), mode);
    await canvas.waitForFunction(mode => document.documentElement.classList.contains('dark') === (mode === 'dark')
      && !document.documentElement.dataset.redevenThemeSwitching, mode);
    await page.screenshot({ path: path.join(output, `dock-${mode}.png`), animations: 'disabled' });
    await canvas.screenshot({ path: path.join(output, `canvas-${mode}.png`), animations: 'disabled' });
  }
  await dock.click();
  await canvas.waitForFunction(() => document.hasFocus());
  await canvas.locator('.tessiven-library-card').first().waitFor();
  assert.equal(canvasPages().length, 1, 'Repeated Dock activation reuses its session window');
  assert.equal(await blocked.count(), 0);
  report.scenarios.push('repeated-open-reuses-window');
  const library = await welcome.evaluate(() => window.redevenDesktopSettings.requestRuntimeFlower({ method: 'GET', path: '/_redeven_proxy/api/tessiven/canvases' }));
  assert.equal(library.ok, true);
  const saved = library.data.canvases.find(canvas => canvas.title === 'Commerce / Example');
  assert.ok(saved);
  assert.deepEqual(await page.evaluate(request => window.redevenDesktopShell.openServiceCanvasWindow(request),
    { canvas_id: saved.id, version: saved.latest_version }), { ok: true });
  await canvas.waitForURL(url => url.searchParams.get('canvas') === saved.id && url.searchParams.get('version') === String(saved.latest_version));
  await canvas.locator('.tessiven-node').first().waitFor();
  assert.equal(await canvas.locator('.tessiven-error, .tessiven-notice[role="status"]').count(), 0);
  assert.equal(canvasPages().length, 1);
  await verifyCanvasNavigation(canvas, 'standalone');
  for (const mode of ['light', 'dark']) {
    await welcome.evaluate(mode => window.redevenDesktopTheme.setSource(mode), mode);
    await canvas.waitForFunction(mode => document.documentElement.classList.contains('dark') === (mode === 'dark')
      && !document.documentElement.dataset.redevenThemeSwitching, mode);
    await canvas.screenshot({ path: path.join(output, `saved-canvas-${mode}.png`), animations: 'disabled' });
  }
  report.scenarios.push('exact-canvas-version-opens-in-owned-window');
  await verifyLocalRoute(canvas, 'standalone');
  await welcome.bringToFront();
  await welcome.getByRole('button', { name: 'Tessiven', exact: true }).click();
  await welcome.getByRole('button', { name: saved.title, exact: true }).click();
  await welcome.locator('.tessiven-node').first().waitFor();
  await verifyCanvasNavigation(welcome, 'desktop-welcome');
  await verifyLocalRoute(welcome, 'desktop-welcome');
  if (canvasArgument) {
    const observed = library.data.canvases.find(canvas => canvas.id === canvasArgument);
    assert.ok(observed, 'The read-only snapshot contains the requested reference canvas');
    await verifyObservedCanvas(welcome, observed, 'desktop-welcome');
    await verifyObservedCanvas(canvas, observed, 'standalone');
  }
  assert.deepEqual(await welcome.evaluate(() => window.redevenDesktopShell.openServiceCanvasWindow({})), { ok: false });
  assert.deepEqual(await page.evaluate(() => window.redevenDesktopShell.openServiceCanvasWindow({ url: 'https://other.example/' })), { ok: false });
  assert.deepEqual(await page.evaluate(() => window.redevenDesktopShell.openServiceCanvasWindow({ version: 4 })), { ok: false });
  assert.equal(canvasPages().length, 1);
  report.scenarios.push('unowned-and-invalid-routing-requests-rejected');
  await canvas.close();
  await dock.click();
  const reopened = await until(() => canvasPages()[0], 'closed canvas reopened');
  await reopened.locator('.tessiven-library-card').first().waitFor();
  assert.equal(await reopened.locator('.tessiven-error, .tessiven-notice[role="status"]').count(), 0);
  assert.equal(await blocked.count(), 0);
  report.scenarios.push('closed-window-reopens-without-warning');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack;
  if (app) for (const [index, page] of app.context().pages().entries()) await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (app) {
    const executable = path.join(bundle, process.platform === 'win32' ? 'redeven.exe' : 'redeven');
    const inventory = JSON.parse(execFileSync(executable,
      ['desktop-target-process-inventory', '--target-root', state], { encoding: 'utf8' }));
    report.runtime_inventory = inventory;
    report.teardown = JSON.parse(execFileSync(executable,
      ['desktop-target-process-stop', '--target-root', state,
        '--expected-inventory-digest', inventory.inventory_digest], { encoding: 'utf8' }));
    assert.deepEqual(report.teardown.after.instances, [], 'No task-owned runtime remains after acceptance');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await app.close();
  }
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report));
