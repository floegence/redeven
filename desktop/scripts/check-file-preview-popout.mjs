import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { installReDevPluginRuntimeFixture } from '../../internal/envapp/ui_src/scripts/redevpluginRuntimeFixture.mjs';
import { chromium, _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import http from 'node:http';
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
  const report = { status: 'running', commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), state, bundle, scenarios: [], errors: [], flower: [] };
  assert.ok(report.commit.startsWith(manifest.commit), 'Acceptance bundle must match the source commit');
  await mkdir(output, { recursive: true });
  const files = path.join(state, 'files'); await mkdir(files);
  const htmlFile = path.join(files, '报告 # 100%.html');
  const markdownFile = path.join(files, 'notes.md');
  await writeFile(htmlFile, '<!doctype html><meta charset="UTF-8"><style>body{font:20px system-ui;margin:32px}main{height:2200px}</style><main><h1>Independent preview</h1><input aria-label="Retained input" value="initial"><p>Searchable preview content</p><a href="notes.md">Read notes</a></main>');
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
  const frameFor = async page => until(async () => {
    for (const frame of page.frames()) if (frame !== page.mainFrame() && await frame.getByRole('heading', { name: 'Independent preview', exact: true }).count()) return frame;
    return null;
  }, 'sandbox frame');
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
  const providerRequests = [], providerFailures = [];
  const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  let sequence = 0;
  const provider = http.createServer(async (request, response) => {
    try {
      if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'gpt-5-mini' }] })); return; }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks));
      const marker = strings(input.input).join('\n').match(/POPOUT_FLOWER_(NATIVE|BROWSER)/)?.[0];
      if (input.tools?.length) {
        assert.ok(marker, 'User question reaches the configured provider');
        assert.ok(strings(input.input).some(text => text.includes(htmlFile) || text.includes(JSON.stringify(htmlFile).slice(1, -1))), 'Exact file reference reaches the provider');
        providerRequests.push({ marker, path: htmlFile, exactReference: true });
      }
      const id = 'popout-' + ++sequence, text = marker ? marker + '_COMPLETE' : 'Preview acceptance';
      response.setHeader('Content-Type', 'text/event-stream');
      const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
      const item = { type: 'message', id: 'message-' + id, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
      event({ type: 'response.created', response: { id, model: 'gpt-5-mini', created_at: Math.floor(Date.now() / 1000) } });
      event({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      event({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text });
      event({ type: 'response.output_item.done', output_index: 0, item });
      event({ type: 'response.completed', response: { id, model: 'gpt-5-mini', status: 'completed', output: [item], usage: { input_tokens: 200, output_tokens: 30 } } });
      response.end('data: [DONE]\n\n');
    } catch (error) { providerFailures.push(String(error)); if (!response.headersSent) response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  await session.port(provider.address().port);
  await session.defer('Preview Flower provider', async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); });
  const configureFlower = async api => {
    await api('/_redeven_proxy/api/ai/provider_bundle', 'PUT', { model_profile: { current_model_id: 'fixture/gpt-5-mini', providers: [{ id: 'fixture', name: 'Preview qualification', type: 'openai', base_url: `http://127.0.0.1:${provider.address().port}/v1`, models: [{ model_name: 'gpt-5-mini', input_modalities: ['text'], context_window: 128000, max_output_tokens: 8192 }] }] }, provider_api_key_patches: [{ provider_id: 'fixture', api_key: 'qualification-only' }], web_search_provider_key_patches: [] });
    await api('/_redeven_proxy/api/ai/default_permission', 'PUT', { permission_type: 'readonly' });
  };
  const submitFlower = async (page, marker) => {
    const card = page.locator('[data-floe-prompt-card]'); await card.waitFor();
    assert.ok((await card.innerText()).includes(path.basename(htmlFile)), 'Visible file context accompanies the question');
    await card.locator('textarea').fill(marker + ': inspect the referenced file.');
    await card.locator('.floe-prompt-card-submit').click();
    await page.getByText(marker + '_COMPLETE', { exact: true }).filter({ visible: true }).waitFor({ timeout: 60000 });
    await card.waitFor({ state: 'hidden' });
    assert.deepEqual(providerFailures, []); assert.ok(providerRequests.some(request => request.marker === marker));
    report.flower.push({ marker, visibleReply: true, exactFileReference: true });
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
    const nativeAPI = async (route, method = 'GET', body) => { const result = await welcome.evaluate(request => window.redevenDesktopSettings.requestRuntimeFlower(request), { path: route, method, body }); assert.equal(result.ok, true, JSON.stringify(result)); return result.data; };
    await configureFlower(nativeAPI);
    await welcome.getByRole('button', { name: /^(Open|Show) window$/ }).first().click({ timeout: 60000 });
    const parent = await until(() => app.context().pages().find(page => page.url().includes('/_redeven_proxy/env/')), 'Env App'); observe(parent);
    await parent.getByRole('tab', { name: 'Activity', exact: true }).click();
    await parent.getByRole('button', { name: 'File Browser', exact: true }).filter({ visible: true }).last().click();
    await openFile(parent, htmlFile);
    await (await frameFor(parent)).getByRole('heading', { name: 'Independent preview' }).waitFor();
    const children = () => app.context().pages().filter(page => new URL(page.url()).searchParams.get('window') === 'file-preview');
    console.log('Desktop floating HTML preview is ready');
    await popout(parent, true);
    const child = await until(() => children()[0], 'native preview'); await verifyStandalone(child, htmlFile);
    console.log('Native standalone page is ready');
    await child.getByRole('button', { name: 'Ask Flower', exact: true }).click();
    await submitFlower(parent, 'POPOUT_FLOWER_NATIVE');
    await child.bringToFront();
    await child.keyboard.press('ControlOrMeta+Shift+J');
    await parent.locator('[data-floe-prompt-card]').waitFor();
    assert.ok((await parent.locator('[data-floe-prompt-card]').innerText()).includes(path.basename(htmlFile)));
    await parent.keyboard.press('Escape'); await parent.locator('[data-floe-prompt-card]').waitFor({ state: 'hidden' });
    await child.bringToFront();
    await more(child).click(); await child.getByRole('menuitem', { name: 'Copy path', exact: true }).click();
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), htmlFile);
    assert.equal(await child.evaluate(path => window.redevenDesktopShell.askFilePreviewFlower({ path }), markdownFile).then(result => result.ok), false);

    const frame = await frameFor(child); await frame.getByRole('heading', { name: 'Independent preview' }).waitFor();
    assert.equal(await frame.evaluate(() => typeof window.redevenDesktopShell), 'undefined', 'Untrusted HTML has no native bridge');
    await more(child).click(); await child.getByRole('menuitem', { name: 'Find in file', exact: true }).click();
    await child.getByRole('searchbox').fill('Searchable preview');
    await child.getByRole('status').filter({ hasText: '1 of 1' }).waitFor(); await child.getByRole('searchbox').press('Escape');
    const destination = path.join(state, 'native-download.html');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await more(child).click(); await child.getByRole('menuitem', { name: 'Download file', exact: true }).click();
    await until(async () => { try { return (await readFile(destination, 'utf8')) === (await readFile(htmlFile, 'utf8')); } catch { return false; } }, 'native downloaded bytes');
    await child.getByRole('button', { name: 'Downloads', exact: true }).click();
    await child.getByText('Completed', { exact: true }).waitFor(); await child.keyboard.press('Escape');
    await frame.getByRole('link', { name: 'Read notes', exact: true }).click();
    const linked = await until(() => children().find(page => new URL(page.url()).searchParams.get('path') === markdownFile), 'linked native preview');
    await verifyStandalone(linked, markdownFile); await linked.getByRole('heading', { name: 'Independent document', exact: true }).waitFor(); await linked.close(); await child.bringToFront();

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
    await parent.locator('.monaco-editor .view-lines').click(); await parent.keyboard.press('ControlOrMeta+End'); await parent.keyboard.insertText(' Unsaved acceptance draft.');
    await parent.locator('.monaco-editor .view-lines').getByText('Unsaved acceptance draft.', { exact: false }).waitFor();
    await popout(parent, true); await parent.getByText('Save your changes before opening a separate preview.', { exact: true }).waitFor();
    assert.equal(children().length, 0); assert.equal(await readFile(markdownFile, 'utf8'), '# Independent document\n\nSaved original content.\n');
    await more(parent).click(); await parent.getByRole('menuitem', { name: 'Save file', exact: true }).click();
    await until(async () => (await readFile(markdownFile, 'utf8')).includes('Unsaved acceptance draft.'), 'saved draft');
    await popout(parent, true); const saved = await until(() => children()[0], 'saved document preview');
    await verifyStandalone(saved, markdownFile); await saved.getByText('Unsaved acceptance draft.', { exact: false }).waitFor(); await saved.close();
    report.scenarios.push('native-search-download-and-file-link', 'saved-markdown-opens-with-current-bytes', 'native-menu-opens-real-independent-window', 'native-same-file-focus-retains-iframe-and-scroll', 'native-reload-authentication', 'native-theme-sync-and-narrow-layout', 'native-unowned-invalid-requests-rejected', 'native-close-reopen-preserves-parent', 'unsaved-draft-preserved');
    console.log('Native scenarios complete');
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
    const browserAPI = async (route, method = 'GET', body) => {
      const response = await fetch(new URL(route, startup.local_ui_url), { method, headers: { 'Content-Type': 'application/json', Origin: new URL(startup.local_ui_url).origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json(); assert.ok(response.ok && result.ok !== false, JSON.stringify(result)); return result.data ?? result;
    };
    await configureFlower(browserAPI);
    browser = await session.launchBrowser(chromium, { channel: 'chromium', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    // Exercise the existing browser-download sink where File System Access is unavailable.
    await context.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
    const page = await context.newPage(); observe(page); await page.goto(startup.local_ui_url);
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.getByRole('button', { name: 'File Browser', exact: true }).filter({ visible: true }).last().click();
    await openFile(page, htmlFile); await (await frameFor(page)).getByRole('heading', { name: 'Independent preview' }).waitFor();
    const opened = context.waitForEvent('page'); await popout(page, false); const tab = await opened;
    await verifyStandalone(tab, htmlFile); await (await frameFor(tab)).getByRole('heading', { name: 'Independent preview' }).waitFor();
    assert.equal(await tab.evaluate(() => window.opener === null), true);
    assert.equal(new URL(tab.url()).searchParams.get('path'), htmlFile); assert.equal(page.isClosed(), false);
    console.log('Browser tab is ready');
    const flowerOpened = context.waitForEvent('page'); await tab.getByRole('button', { name: 'Ask Flower', exact: true }).click();
    const flower = await flowerOpened; observe(flower); await submitFlower(flower, 'POPOUT_FLOWER_BROWSER');
    assert.equal(new URL(flower.url()).searchParams.has('window'), false);
    assert.equal(new URL(flower.url()).searchParams.has('ask_file'), false);
    assert.equal(await flower.evaluate(() => window.opener), null); assert.equal(tab.isClosed(), false); await flower.close();
    await tab.getByRole('heading', { name: path.basename(htmlFile), exact: true }).click({ button: 'right' });
    const contextFlowerOpened = context.waitForEvent('page');
    await tab.getByRole('menuitem', { name: 'Ask Flower', exact: true }).click();
    const contextFlower = await contextFlowerOpened; observe(contextFlower);
    await contextFlower.locator('[data-floe-prompt-card]').waitFor();
    assert.ok((await contextFlower.locator('[data-floe-prompt-card]').innerText()).includes(path.basename(htmlFile))); await contextFlower.close();

    await tab.reload(); await verifyStandalone(tab, htmlFile); await (await frameFor(tab)).getByRole('heading', { name: 'Independent preview' }).waitFor();
    await tab.screenshot({ path: path.join(output, 'browser-tab.png') });
    const downloadEvent = tab.waitForEvent('download'); await more(tab).click(); await tab.getByRole('menuitem', { name: 'Download file', exact: true }).click();
    const download = await downloadEvent; assert.equal(download.suggestedFilename(), path.basename(htmlFile));
    assert.equal(await readFile(await download.path(), 'utf8'), await readFile(htmlFile, 'utf8'));
    await (await frameFor(tab)).getByRole('link', { name: 'Read notes', exact: true }).click();
    await tab.waitForURL(url => url.searchParams.get('path') === markdownFile); await verifyStandalone(tab, markdownFile);
    await tab.getByRole('heading', { name: 'Independent document', exact: true }).waitFor();
    await tab.goBack(); await verifyStandalone(tab, htmlFile); await (await frameFor(tab)).getByRole('heading', { name: 'Independent preview' }).waitFor();

    await tab.setViewportSize({ width: 390, height: 740 }); await tab.screenshot({ path: path.join(output, 'browser-narrow.png') });
    await tab.close();
    // Error and recovery use the same real controller and filesystem transport.
    const missing = path.join(files, 'missing.md'), failureURL = new URL(page.url());
    failureURL.search = ''; failureURL.searchParams.set('window', 'file-preview'); failureURL.searchParams.set('path', missing);
    const errorTab = await context.newPage(); observe(errorTab); await errorTab.goto(failureURL.href);
    await errorTab.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    await writeFile(missing, '# Recovered preview'); await errorTab.getByRole('button', { name: 'Retry', exact: true }).click();
    await errorTab.getByRole('heading', { name: 'Recovered preview', exact: true }).waitFor(); await errorTab.close();
    report.scenarios.push('browser-download-and-file-link-history', 'browser-menu-opens-new-tab', 'browser-exact-special-character-path', 'browser-isolated-opener-and-reload', 'browser-narrow-layout', 'real-missing-file-retry');
    report.scenarios.push('native-flower-file-context-submit-visible-reply', 'native-flower-shortcut-and-copy-path', 'browser-flower-submit-visible-reply', 'browser-flower-context-menu');
    assert.deepEqual(providerFailures, []); assert.deepEqual(report.errors, []); report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.stack ?? String(error);
    const pages = app?.context().pages() ?? browser?.contexts()[0]?.pages() ?? [];
    for (const [index, page] of pages.entries()) await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
    throw error;
  } finally { await session.writeEvidence(path.join(output, 'report.json'), report); }
});
