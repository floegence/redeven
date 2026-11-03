import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildWebServiceReservedPathDocumentURL, performWebServiceReservedPathIntent, webServiceAddressCopiedCSS } from '../../src/main/webServiceReservedPathDocument';
import { isMarkedWebServiceReservedPath } from '../../src/main/webServiceBrowserProxyFailure';
import { buildWebServiceBrowserDocumentURL } from '../../src/main/webServiceBrowserDocument';
import { desktopShellThemeCatalog, desktopSemanticPaletteForShellTheme, desktopWindowThemeSnapshotForShellTheme } from '../../src/main/desktopTheme';
import { createDesktopI18n, type RedevenLocale } from '../../src/shared/i18n';
import { DESKTOP_THEME_GET_SNAPSHOT_CHANNEL, desktopRendererThemeSnapshot } from '../../src/shared/desktopThemeIPC';
import { DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL } from '../../src/shared/windowChromeIPC';
import { resolveDesktopWindowChromeSnapshot } from '../../src/shared/windowChromePlatform';
import { DESKTOP_WEB_SERVICE_BROWSER_GET_STATE_CHANNEL } from '../../src/shared/desktopWebServiceBrowserIPC';
import { webServiceBrowserContentBounds } from '../../src/shared/webServiceBrowserLayout';
import type { DesktopThemeSnapshot } from '../../src/shared/desktopTheme';

app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const output = process.env.REDEVEN_RESERVED_PATH_OUTPUT!;
  await mkdir(output, { recursive: true });
  const address = 'http://localhost:23999/_redeven_proxy/env/?tab=files#section';
  let theme: DesktopThemeSnapshot;
  let documentURL = '';
  let copied = '';
  let copyFeedback: Promise<string> | undefined;
  const cases: unknown[] = [];
  const window = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { preload: process.env.REDEVEN_RESERVED_PATH_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'reserved-path-qualification' } });
  window.contentView.addChildView(view);
  window.showInactive();
  const layout = () => { const [width, height] = window.getContentSize(); view.setBounds(webServiceBrowserContentBounds(width, height)); };
  window.on('resize', layout); layout();
  ipcMain.on(DESKTOP_THEME_GET_SNAPSHOT_CHANNEL, event => { event.returnValue = desktopRendererThemeSnapshot(theme); });
  ipcMain.on(DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL, event => { event.returnValue = resolveDesktopWindowChromeSnapshot(); });
  ipcMain.handle(DESKTOP_WEB_SERVICE_BROWSER_GET_STATE_CHANNEL, () => ({ address, open_external_available: false }));
  view.webContents.on('will-navigate', (event, url) => {
    if (performWebServiceReservedPathIntent(url, view.webContents.getURL(), documentURL, () => {
      // Capture the clipboard sink without changing the user's system clipboard.
      copied = address; copyFeedback = view.webContents.insertCSS(webServiceAddressCopiedCSS);
    })) event.preventDefault();
  });
  const server = createServer((request, response) => {
    if (request.url === '/') { response.writeHead(302, { Location: '/_redeven_proxy/env/' }); response.end(); return; }
    if (request.url === '/_redeven_proxy/env/') response.setHeader('X-Redeven-Proxy-Error', 'port-forward-reserved-path');
    response.writeHead(404, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><h1>Application 404</h1>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  let rejected = 0;
  view.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (!isMarkedWebServiceReservedPath(details)) { callback({}); return; }
    rejected++; callback({ cancel: true });
    setImmediate(() => { void view.webContents.loadURL(documentURL); });
  });
  const paint = async () => { await view.webContents.executeJavaScript('new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Paint timed out")), 4000); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); })); })'); };
  const click = async (id: string) => {
    const point = await view.webContents.executeJavaScript('(() => { const r = document.getElementById(' + JSON.stringify(id) + ').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
    view.webContents.debugger.attach('1.3');
    await view.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await view.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    view.webContents.debugger.detach();
    await paint();
  };
  const disclosure = async () => view.webContents.executeJavaScript('(() => { const details = document.querySelector("details"), main = document.querySelector("main"); return { open: details.open, summary: details.querySelector("summary").textContent, reasonVisible: details.querySelector("p").checkVisibility(), addressVisible: details.querySelector("code").checkVisibility(), copyVisible: document.getElementById("copy-address").checkVisibility(), editActionPresent: !!document.getElementById("edit-address"), visibleActions: [...document.querySelectorAll("a")].filter(a => a.checkVisibility()).length, overflow: main.scrollWidth > main.clientWidth }; })()');
  const toggleWithKeyboard = async () => {
    view.webContents.debugger.attach('1.3');
    await view.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await view.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await view.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    view.webContents.debugger.detach();
    await paint();
  };
  try {
    for (const [name, preset] of Object.entries(desktopShellThemeCatalog)) {
      theme = { source: preset.mode, resolvedTheme: preset.mode, shellThemes: { version: 1, light: 'classic-light', dark: 'classic-dark' }, activeShellTheme: name, window: desktopWindowThemeSnapshotForShellTheme(name), semantic: desktopSemanticPaletteForShellTheme(name) };
      for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'de-DE'] as RedevenLocale[]) {
        const i18n = createDesktopI18n(locale);
        await window.loadURL(buildWebServiceBrowserDocumentURL({ locale, title: 'Web Service', addressLabel: i18n.t('webServiceBrowser.addressLabel'), addressPlaceholder: i18n.t('webServiceBrowser.addressPlaceholder'), backLabel: i18n.t('webServiceBrowser.back'), forwardLabel: i18n.t('webServiceBrowser.forward'), reloadLabel: i18n.t('webServiceBrowser.reload'), stopLabel: i18n.t('webServiceBrowser.stop'), navigateLabel: i18n.t('webServiceBrowser.navigate'), developerToolsLabel: i18n.t('webServiceBrowser.developerTools'), openExternalLabel: i18n.t('webServiceBrowser.openInBrowser'), secureRouteLabel: i18n.t('webServiceBrowser.secureRoute') }, theme));
        for (const width of [1100, 390]) {
          window.setContentSize(width, 780); layout();
          documentURL = buildWebServiceReservedPathDocumentURL(locale, address, theme);
          await view.webContents.loadURL(documentURL); await paint();
          const state = await view.webContents.executeJavaScript('(() => { const main = document.querySelector("main"), h = document.querySelector("h1"); return { overflow: main.scrollWidth > main.clientWidth, title: h.textContent, top: h.getBoundingClientRect().top, scripts: document.scripts.length, actions: document.querySelectorAll("a").length, address: document.querySelector("code").textContent, retry: !!document.getElementById("retry"), bridges: Object.keys(window).filter(k => k.startsWith("redevenDesktop")) }; })()');
          assert.equal(state.overflow, false); assert.ok(state.top >= 0); assert.equal(state.title, i18n.t('webServiceBrowser.reservedPathTitle'));
          assert.equal(state.address, address); assert.equal(state.scripts, 0); assert.equal(state.actions, 1); assert.equal(state.retry, false); assert.deepEqual(state.bridges, []);
          const collapsed = await disclosure();
          assert.equal(collapsed.open, false); assert.equal(collapsed.reasonVisible, false); assert.equal(collapsed.addressVisible, false); assert.equal(collapsed.copyVisible, false); assert.equal(collapsed.editActionPresent, false); assert.equal(collapsed.visibleActions, 0);
          assert.equal(collapsed.summary, i18n.t('webServiceBrowser.viewDetails'));
          if (locale === 'zh-CN' && ['classic-light', 'classic-dark'].includes(name)) await writeFile(path.join(output, name + '-' + width + '.png'), (await view.webContents.capturePage()).toPNG());
          await click('view-details');
          const expanded = await disclosure();
          assert.equal(expanded.open, true); assert.equal(expanded.reasonVisible, true); assert.equal(expanded.addressVisible, true); assert.equal(expanded.copyVisible, true); assert.equal(expanded.editActionPresent, false); assert.equal(expanded.visibleActions, 1); assert.equal(expanded.overflow, false);
          if (cases.length === 0) {
            assert.equal(await view.webContents.executeJavaScript('document.activeElement.id'), 'view-details');
            await toggleWithKeyboard();
            assert.equal((await disclosure()).open, false, 'Enter collapses the focused disclosure');
            await toggleWithKeyboard();
            assert.equal((await disclosure()).open, true, 'Enter expands the focused disclosure');
          }
          if (locale === 'zh-CN' && ['classic-light', 'classic-dark'].includes(name)) await writeFile(path.join(output, name + '-' + width + '-expanded.png'), (await view.webContents.capturePage()).toPNG());
          cases.push({ name, locale, width, state, collapsed, expanded });
        }
      }
    }
    await click('copy-address');
    assert.equal(copied, address);
    await copyFeedback;
    assert.notEqual(await view.webContents.executeJavaScript('getComputedStyle(document.querySelector(".copied-label")).display'), 'none');
    await click('view-details');
    assert.equal((await disclosure()).copyVisible, false);
    await view.webContents.loadURL(origin + '/missing');
    assert.equal(await view.webContents.executeJavaScript('document.querySelector("h1").textContent'), 'Application 404'); assert.equal(rejected, 0);
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Reserved path explanation did not load')), 5000);
      const check = () => { if (view.webContents.getURL() === documentURL) { clearTimeout(timer); view.webContents.off('did-finish-load', check); resolve(); } };
      view.webContents.on('did-finish-load', check);
    });
    void ready.catch(() => {});
    await view.webContents.loadURL(origin + '/').catch((error: Error) => { if (!error.message.includes('ERR_ABORTED') && !error.message.includes('ERR_BLOCKED_BY_CLIENT')) throw error; });
    await ready; assert.equal(rejected, 1);
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ scenarioStatus: 'passed', electron: process.versions.electron, actions: true, disclosure: true, keyboard: true, ordinary404: true, redirect: true, cases }, null, 2));
    console.log('Reserved path: ' + cases.length + ' theme/locale/viewport cases, collapsed and expanded disclosure, keyboard, native actions, redirect and application 404 passed');
  } finally {
    view.webContents.close(); window.destroy(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
