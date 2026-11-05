import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopTestSession } from './desktop_test_session.mjs';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 180000 });
await session.run(async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const requireDesktop = createRequire(path.join(root, 'desktop/package.json'));
  const requireUI = createRequire(path.join(root, 'internal/envapp/ui_src/package.json'));
  const { build, preview } = requireDesktop('vite');
  const { build: bundle } = requireDesktop('esbuild');
  const { _electron } = requireUI('playwright');
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
  const temporary = await mkdtemp(path.join(tmpdir(), 'flower-context-actions-'));
  await session.directory(temporary);
  const output = process.argv.find(value => value.startsWith('--output='))?.slice(9) || path.join(temporary, 'evidence');
  await mkdir(output, { recursive: true });
  const dist = path.join(temporary, 'renderer');
  await build({ configFile: path.join(root, 'desktop/vite.welcome.config.mjs'), logLevel: 'error',
    build: { outDir: dist, emptyOutDir: true, cssCodeSplit: false, rollupOptions: { input: path.join(root, 'internal/flower_ui/testing/contextActions.tsx'), output: { entryFileNames: 'context.js' } } } });
  const css = (await readdir(path.join(dist, 'assets'))).filter(name => name.endsWith('.css'));
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8">' + css.map(name => '<link rel="stylesheet" href="/assets/' + name + '">').join('') + '</head><body><div id="root"></div><script type="module" src="/context.js"></script></body></html>');
  const server = await preview({ configFile: false, build: { outDir: dist }, preview: { host: '127.0.0.1', port: 0 } });
  await session.defer('context menu fixture server', () => new Promise((resolve, reject) => { server.httpServer.closeAllConnections(); server.httpServer.close(error => error ? reject(error) : resolve()); }));
  await session.port(server.httpServer.address().port);
  const entry = path.join(temporary, 'main.cjs');
  await bundle({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { app, BrowserWindow, Menu, clipboard, ClipboardItem } from 'electron';
    import { attachDesktopEditContextMenu } from './desktop/src/main/editContextMenu';
    app.setPath('userData', process.env.FLOWER_CONTEXT_PROFILE);
    let saved;
    let restored = false;
    const restore = async () => { if (saved && !restored) { await clipboard.write(saved); restored = true; } };
    app.on('before-quit', event => { if (saved && !restored) { event.preventDefault(); void restore().then(() => app.quit()); } });
    app.on('window-all-closed', () => app.quit());
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      win.setIgnoreMouseEvents(true);
      win.showInactive();
      const nativePopup = Menu.prototype.popup;
      const evidence = { menu: null, items: [], openings: 0, nativeShown: false, win, restore, backup: async () => { saved = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))))); } };
      globalThis.contextAcceptance = evidence;
      Menu.prototype.popup = function(options) {
        evidence.menu = this; evidence.openings++;
        evidence.items = this.items.map(item => ({ role: item.role, label: item.label, enabled: item.enabled, type: item.type }));
        if (!evidence.nativeShown) { evidence.nativeShown = true; nativePopup.call(this, options); }
      };
      attachDesktopEditContextMenu(win, () => 'zh-CN');
      await win.loadURL(process.env.FLOWER_CONTEXT_URL);
    }).catch(error => { console.error(error); app.quit(); });` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: entry });
  const electronEnv = { ...process.env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  const app = await session.launchElectron(_electron, { executablePath: requireDesktop('electron'), args: [entry], cwd: root,
    env: { ...electronEnv, FLOWER_CONTEXT_PROFILE: path.join(temporary, 'profile'), FLOWER_CONTEXT_URL: server.resolvedUrls.local[0] } });
  app.process().stderr.on('data', value => process.stderr.write(value));
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const composer = page.locator('.flower-composer textarea');
  await composer.waitFor();
  await app.evaluate(() => globalThis.contextAcceptance.backup());
  await composer.fill('Flower native clipboard');
  await composer.evaluate(element => { element.focus(); element.setSelectionRange(0, 6); });
  await composer.click({ button: 'right', position: { x: 18, y: 12 } });
  const readMenu = () => app.evaluate(() => { const state = globalThis.contextAcceptance; return { items: state.items, openings: state.openings, nativeShown: state.nativeShown }; });
  const first = await readMenu();
  assert.equal(first.nativeShown, true);
  assert.deepEqual(first.items.filter(item => item.role).map(item => item.label), ['撤销', '重做', '剪切', '复制', '粘贴', '全选']);
  await app.evaluate(() => { const state = globalThis.contextAcceptance; state.menu.closePopup(state.win); });
  const invoke = async role => app.evaluate((_electron, role) => {
    const state = globalThis.contextAcceptance;
    const item = state.menu.items.find(item => item.role?.toLowerCase() === role.toLowerCase());
    if (!item?.enabled) throw new Error('Unavailable native action: ' + role);
    // macOS menu roles execute in AppKit, not MenuItem.click. Exercise their
    // Chromium command against the exact owner after validating native items.
    if (process.platform === 'darwin') state.win.webContents[role]();
    else item.click({}, state.win, state.win.webContents);
  }, role);
  await invoke('copy');
  await page.waitForTimeout(100);
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'Flower');
  await app.evaluate(({ clipboard }) => clipboard.writeText('Native paste'));
  await page.evaluate(() => { window.contextPasteCount = 0; document.querySelector('.flower-composer textarea').addEventListener('paste', () => window.contextPasteCount++); });
  await invoke('paste');
  await page.waitForFunction(() => document.querySelector('.flower-composer textarea').value === 'Native paste native clipboard');
  assert.equal(await page.evaluate(() => window.contextPasteCount), 1, 'Native menu paste reaches the existing composer paste handler');
  await composer.click({ button: 'right' });
  await invoke('undo');
  await page.waitForFunction(() => document.querySelector('.flower-composer textarea').value === 'Flower native clipboard');
  await composer.click({ button: 'right' });
  await invoke('selectAll');
  assert.equal(await composer.evaluate(element => element.selectionEnd - element.selectionStart), 'Flower native clipboard'.length);
  await composer.click({ button: 'right' });
  await invoke('cut');
  await page.waitForFunction(() => document.querySelector('.flower-composer textarea').value === '');
  await composer.click({ button: 'right' });
  assert.equal((await readMenu()).items.find(item => item.role === 'copy').enabled, false);
  await page.locator('[data-flower-thread-card]').first().click();
  const beforeContent = (await readMenu()).openings;
  const bubble = page.locator('.flower-message-bubble-user').first();
  await bubble.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy message', exact: true }).click();
  const readClipboardUntil = async expected => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const text = await app.evaluate(({ clipboard }) => clipboard.readText());
      if (typeof expected === 'string' ? text === expected : expected.test(text)) return text;
      await page.waitForTimeout(50);
    }
    assert.fail('Clipboard did not reach expected content: ' + await app.evaluate(({ clipboard }) => clipboard.readText()));
  };
  await readClipboardUntil(/Review the workspace/);
  assert.equal((await readMenu()).openings, beforeContent, 'Renderer context menus suppress the native fallback');
  await bubble.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  const selected = await page.evaluate(() => window.getSelection().toString());
  await bubble.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await readClipboardUntil(selected);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'context-actions.png') });
  await session.writeEvidence(path.join(output, 'acceptance.json'), { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceDiff: execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).trim(), nativeMenu: first, copy: true, paste: true, pasteEvent: true, undo: true, selectAll: true, cut: true, disabledCopy: true, messageCopy: true, selectedCopy: true, noDuplicateNativeMenu: true, errors });
  await app.evaluate(() => globalThis.contextAcceptance.restore());
  await session.closeElectron(app);
  console.log(JSON.stringify({ output, status: 'passed' }));
});
