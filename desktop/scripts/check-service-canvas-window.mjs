import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const [bundleArgument, outputArgument] = process.argv.slice(2);
assert(bundleArgument && outputArgument, 'Required: <built Desktop bundle> <evidence directory>');
const bundle = path.resolve(bundleArgument), output = path.resolve(outputArgument);
const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
const state = await mkdtemp(path.join(tmpdir(), 'redeven-service-canvas-window-'));
const report = { commit: manifest.commit, bundle, state, marker: randomUUID(), scenarios: [], errors: [] };
await mkdir(output, { recursive: true });
let app;
const until = async (read, label) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
};
try {
  app = await _electron.launch({ executablePath: require('electron'), cwd: state,
    args: [path.join(root, 'desktop'), `--user-data-dir=${state}/profile`, `--redeven-canvas-window-run=${report.marker}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_STATE_ROOT: state,
      REDEVEN_DESKTOP_USER_DATA_ROOT: `${state}/profile`, REDEVEN_DESKTOP_CACHE_ROOT: `${state}/cache`, REDEVEN_DESKTOP_TEMP_ROOT: `${state}/temp`,
      REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1', REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0', REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
      REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle, REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version, REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit } });
  report.pid = app.process().pid;
  const welcome = await app.firstWindow();
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
  await until(() => canvas.evaluate(() => document.hasFocus()), 'existing canvas focused');
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
  assert.equal(canvasPages().length, 1);
  report.scenarios.push('exact-canvas-version-opens-in-owned-window');
  assert.deepEqual(await welcome.evaluate(() => window.redevenDesktopShell.openServiceCanvasWindow({})), { ok: false });
  assert.deepEqual(await page.evaluate(() => window.redevenDesktopShell.openServiceCanvasWindow({ url: 'https://other.example/' })), { ok: false });
  assert.deepEqual(await page.evaluate(() => window.redevenDesktopShell.openServiceCanvasWindow({ version: 4 })), { ok: false });
  assert.equal(canvasPages().length, 1);
  report.scenarios.push('unowned-and-invalid-routing-requests-rejected');
  await canvas.close();
  await dock.click();
  const reopened = await until(() => canvasPages()[0], 'closed canvas reopened');
  await reopened.locator('.tessiven-library-card').first().waitFor();
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
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await app.close();
  }
}
console.log(JSON.stringify(report));
