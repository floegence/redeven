import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { installReDevPluginRuntimeFixture } from '../../internal/envapp/ui_src/scripts/redevpluginRuntimeFixture.mjs';
import { chromium, _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 300000 });
await session.run(async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const require = createRequire(path.join(root, 'desktop/package.json'));
  const [bundleArgument, outputArgument] = process.argv.slice(2);
  assert.ok(bundleArgument && outputArgument, 'Required: <built Desktop bundle> <evidence directory>');
  const bundle = path.resolve(bundleArgument), output = path.resolve(outputArgument);
  const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
  const state = await session.directory(await mkdtemp(path.join(os.homedir(), '.redeven-file-popout-')));
  const report = { status: 'running', commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), state, bundle, scenarios: [], errors: [] };
  assert.ok(report.commit.startsWith(manifest.commit), 'Acceptance bundle must match the source commit');
  await mkdir(output, { recursive: true });
  const files = path.join(state, 'files'); await mkdir(files);
  const htmlFile = path.join(files, '报告 # 100%.html');
  const markdownFile = path.join(files, 'notes.md');
  await writeFile(htmlFile, '<!doctype html><meta charset="UTF-8"><style>body{font:20px system-ui;margin:32px}main{height:2200px}</style><main><h1>Independent preview</h1><input aria-label="Retained input" value="initial"><p>Searchable preview content</p></main>');
  await writeFile(markdownFile, '# Independent document\n\nSaved original content.\n');
  const until = async (read, label) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) { const result = await read(); if (result) return result; await delay(100); }
    throw new Error('Timed out: ' + label);
  };
  const observe = page => { page.setDefaultTimeout(20000); page.on('pageerror', error => report.errors.push(error.message)); };
  const openFile = async (page, file) => {
    const inputButton = page.getByTitle('Go to path', { exact: true }).filter({ visible: true }).last();
    await inputButton.click();
    const input = page.getByRole('textbox', { name: 'Go to path', exact: true });
    await input.fill(path.dirname(file)); await input.press('Enter'); await input.waitFor({ state: 'hidden' });
    await page.getByRole('textbox', { name: 'Filter files', exact: true }).filter({ visible: true }).last().fill(path.basename(file));
    await page.getByText(path.basename(file), { exact: true }).filter({ visible: true }).last()
      .locator('xpath=ancestor::*[@data-file-browser-item-path][1]').dblclick({ position: { x: 12, y: 12 } });
  };
  const more = page => page.getByRole('button', { name: 'More file actions', exact: true }).filter({ visible: true }).last();
  const popout = async (page, desktop) => {
    await more(page).click();
    await page.getByRole('menuitem', { name: desktop ? 'Open in separate window' : 'Open in new tab', exact: true }).click();
  };
  const frameFor = async page => until(() => page.frames().find(frame => frame.url().startsWith('blob:') || frame.url() === 'about:srcdoc'), 'sandbox frame');
  const verifyStandalone = async (page, file) => {
    observe(page);
    await page.locator('[data-file-preview-standalone]').waitFor();
    await page.getByRole('heading', { name: path.basename(file), exact: true }).waitFor();
    assert.equal(await page.locator('[data-workbench-dock-action], [data-floe-shell-slot], .file-preview-floating-window').count(), 0);
    await until(async () => (await page.title()) === path.basename(file), 'document title');
    await more(page).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Edit file', exact: true }).count(), 0, 'Separate previews are read-only');
    assert.equal(await page.getByRole('menuitem', { name: /Open in (new tab|separate window)/ }).count(), 0);
    await page.keyboard.press('Escape');
  };
  let app, browser;
  try {
    execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
    await session.target(path.join(bundle, 'redeven'), state);
    app = await session.launchElectron(_electron, {
      executablePath: require('electron'), cwd: state,
      args: [path.join(root, 'desktop'), '--user-data-dir=' + path.join(state, 'profile')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_STATE_ROOT: state,
        REDEVEN_DESKTOP_USER_DATA_ROOT: path.join(state, 'profile'), REDEVEN_DESKTOP_CACHE_ROOT: path.join(state, 'cache'), REDEVEN_DESKTOP_TEMP_ROOT: path.join(state, 'temp'),
        REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1', REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0', REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
        REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle, REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version, REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit },
    });
    const welcome = await app.firstWindow(); observe(welcome);
    await welcome.waitForFunction(() => Boolean(window.redevenDesktopLanguage));
    await welcome.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
    await until(async () => (await welcome.evaluate(() => window.redevenDesktopSettings.requestRuntimeFlower({ method: 'GET', path: '/_redeven_proxy/api/ai/threads' }))).ok, 'Runtime startup');
    await welcome.getByRole('button', { name: /^(Open|Show) window$/ }).first().click({ timeout: 60000 });
    const parent = await until(() => app.context().pages().find(page => page.url().includes('/_redeven_proxy/env/')), 'Env App'); observe(parent);
    await parent.getByRole('tab', { name: 'Activity', exact: true }).click();
    await parent.getByRole('button', { name: 'File Browser', exact: true }).filter({ visible: true }).last().click();
    await openFile(parent, htmlFile);
    await (await frameFor(parent)).getByRole('heading', { name: 'Independent preview' }).waitFor();
    const children = () => app.context().pages().filter(page => new URL(page.url()).searchParams.get('window') === 'file-preview');
    await popout(parent, true);
    const child = await until(() => children()[0], 'native preview'); await verifyStandalone(child, htmlFile);
    const frame = await frameFor(child); await frame.getByRole('heading', { name: 'Independent preview' }).waitFor();
    assert.equal(await frame.evaluate(() => typeof window.redevenDesktopShell), 'undefined', 'Untrusted HTML has no native bridge');
    await frame.getByRole('textbox', { name: 'Retained input' }).fill('retained across focus');
    await frame.evaluate(() => scrollTo(0, 400));
    const native = await app.evaluate(({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url);
      return { id: win.id, parent: win.getParentWindow()?.id ?? null, resizable: win.isResizable(), contents: win.webContents.id };
    }, child.url());
    assert.equal(native.parent, null); assert.equal(native.resizable, true);
    await parent.bringToFront(); await popout(parent, true);
    await until(async () => await child.evaluate(() => document.hasFocus()), 'existing preview focus');
    assert.equal(children().length, 1); assert.equal(await frame.getByRole('textbox', { name: 'Retained input' }).inputValue(), 'retained across focus');
    assert.equal(await frame.evaluate(() => scrollY), 400);
    await child.reload(); await verifyStandalone(child, htmlFile); await (await frameFor(child)).getByRole('heading', { name: 'Independent preview' }).waitFor();
    for (const mode of ['light', 'dark']) {
      await welcome.evaluate(mode => window.redevenDesktopTheme.setSource(mode), mode);
      await child.waitForFunction(mode => document.documentElement.classList.contains('dark') === (mode === 'dark'), mode);
      await child.screenshot({ path: path.join(output, 'native-' + mode + '.png') });
    }
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).setContentSize(520, 420), native.id);
    await child.screenshot({ path: path.join(output, 'native-narrow.png') });
    assert.equal(await child.locator('[data-file-preview-standalone]').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.deepEqual(await welcome.evaluate(path => window.redevenDesktopShell.openFilePreviewWindow({ path }), htmlFile), { ok: false });
    assert.deepEqual(await parent.evaluate(path => window.redevenDesktopShell.openFilePreviewWindow({ path, url: 'https://example.com' }), htmlFile), { ok: false });
    assert.deepEqual(await parent.evaluate(() => window.redevenDesktopShell.openFilePreviewWindow({ path: '../secret' })), { ok: false });
    await child.close(); assert.equal(parent.isClosed(), false); await parent.bringToFront(); await popout(parent, true);
    const reopened = await until(() => children()[0], 'reopened preview'); await verifyStandalone(reopened, htmlFile); await reopened.close();
    await parent.bringToFront();
    await parent.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).last().click();
    await openFile(parent, markdownFile); await more(parent).click(); await parent.getByRole('menuitem', { name: 'Edit file', exact: true }).click();
    await parent.locator('.monaco-editor textarea').first().focus(); await parent.keyboard.press('ControlOrMeta+End'); await parent.keyboard.type(' Unsaved acceptance draft.');
    await popout(parent, true); await parent.getByText('Save your changes before opening a separate preview.', { exact: true }).waitFor();
    assert.equal(children().length, 0); assert.equal(await readFile(markdownFile, 'utf8'), '# Independent document\n\nSaved original content.\n');
    report.scenarios.push('native-menu-opens-real-independent-window', 'native-same-file-focus-retains-iframe-and-scroll', 'native-reload-authentication', 'native-theme-sync-and-narrow-layout', 'native-unowned-invalid-requests-rejected', 'native-close-reopen-preserves-parent', 'unsaved-draft-preserved');
    await session.closeElectron(app); app = null;

    const browserRoot = path.join(state, 'browser'); await mkdir(browserRoot);
    await copyFile(path.join(bundle, 'redeven'), path.join(browserRoot, 'redeven'));
    await installReDevPluginRuntimeFixture(browserRoot);
    const startupFile = path.join(browserRoot, 'startup.json');
    await session.target(path.join(browserRoot, 'redeven'), browserRoot);
    const runtime = await session.spawn(path.join(browserRoot, 'redeven'), ['run', '--mode', 'desktop', '--state-root', path.join(browserRoot, 'state'), '--local-ui-bind', '127.0.0.1:0', '--local-ui-protocol', 'http', '--presentation', 'machine', '--startup-report-file', startupFile], { cwd: browserRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GOWORK: 'off' } }, { kind: 'service' });
    let runtimeOutput = ''; runtime.stdout.on('data', chunk => { runtimeOutput += chunk; }); runtime.stderr.on('data', chunk => { runtimeOutput += chunk; });
    const startup = await until(async () => {
      if (runtime.exitCode !== null) throw new Error(runtimeOutput);
      try { const value = JSON.parse(await readFile(startupFile, 'utf8')); return value.status === 'ready' ? value : null; } catch { return null; }
    }, 'browser Runtime');
    browser = await session.launchBrowser(chromium, { channel: 'chromium', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await context.newPage(); observe(page); await page.goto(startup.local_ui_url);
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.getByRole('button', { name: 'File Browser', exact: true }).filter({ visible: true }).last().click();
    await openFile(page, htmlFile); await (await frameFor(page)).getByRole('heading', { name: 'Independent preview' }).waitFor();
    const opened = context.waitForEvent('page'); await popout(page, false); const tab = await opened;
    await verifyStandalone(tab, htmlFile); await (await frameFor(tab)).getByRole('heading', { name: 'Independent preview' }).waitFor();
    assert.equal(await tab.evaluate(() => window.opener === null), true);
    assert.equal(new URL(tab.url()).searchParams.get('path'), htmlFile); assert.equal(page.isClosed(), false);
    await tab.reload(); await verifyStandalone(tab, htmlFile); await (await frameFor(tab)).getByRole('heading', { name: 'Independent preview' }).waitFor();
    await tab.screenshot({ path: path.join(output, 'browser-tab.png') });
    await tab.setViewportSize({ width: 390, height: 740 }); await tab.screenshot({ path: path.join(output, 'browser-narrow.png') });
    await tab.close();
    // Error and recovery use the same real controller and filesystem transport.
    const missing = path.join(files, 'missing.md'), failureURL = new URL(page.url());
    failureURL.search = ''; failureURL.searchParams.set('window', 'file-preview'); failureURL.searchParams.set('path', missing);
    const errorTab = await context.newPage(); observe(errorTab); await errorTab.goto(failureURL.href);
    await errorTab.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    await writeFile(missing, '# Recovered preview'); await errorTab.getByRole('button', { name: 'Retry', exact: true }).click();
    await errorTab.getByRole('heading', { name: 'Recovered preview', exact: true }).waitFor(); await errorTab.close();
    report.scenarios.push('browser-menu-opens-new-tab', 'browser-exact-special-character-path', 'browser-isolated-opener-and-reload', 'browser-narrow-layout', 'real-missing-file-retry');
    assert.deepEqual(report.errors, []); report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.stack ?? String(error);
    const pages = app?.context().pages() ?? browser?.contexts()[0]?.pages() ?? [];
    for (const [index, page] of pages.entries()) await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
    throw error;
  } finally { await session.writeEvidence(path.join(output, 'report.json'), report); }
});
