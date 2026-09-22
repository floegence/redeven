import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DESKTOP_RESOURCE_CACHE_CHANNEL } from '../../src/shared/resourceCacheIPC';
import { DESKTOP_STATE_GET_CHANNEL, DESKTOP_STATE_SET_CHANNEL, DESKTOP_STATE_KEYS_CHANNEL, DESKTOP_STATE_REMOVE_CHANNEL } from '../../src/shared/stateIPC';
import { DESKTOP_SESSION_CONTEXT_GET_CHANNEL, DESKTOP_SESSION_TRANSPORT_RECOVERY_GET_CHANNEL } from '../../src/shared/desktopSessionContextIPC';

type Store = import('../../src/main/desktopStateStore').DesktopStateStore;
const owners = new Map<number, Store>();
const scope = 'startup-continuity';
const navigationKey = `redeven-envapp:desktop-activity-navigation:${scope}`;
async function run() {
  const { DesktopResourceCache } = require(process.env.REDEVEN_CONTINUITY_CACHE_MAIN!) as typeof import('../../src/main/desktopResourceCache');
  const { DesktopStateStore } = require(process.env.REDEVEN_CONTINUITY_STATE_MAIN!) as typeof import('../../src/main/desktopStateStore');
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const cache = new DesktopResourceCache(path.join(app.getPath('userData'), 'resource-cache'));
  let restoredReads = 0;
  let written = 0;
  ipcMain.handle(DESKTOP_RESOURCE_CACHE_CHANNEL, async (event, request) => {
    assert.ok(owners.has(event.sender.id)); assert.equal(event.senderFrame, event.sender.mainFrame);
    const value = await cache.handle(scope, request);
    if (request.action === 'get' && value) restoredReads += 1;
    if (request.action === 'set') written += 1;
    return value;
  });
  ipcMain.on(DESKTOP_STATE_GET_CHANNEL, (event, key) => { event.returnValue = owners.get(event.sender.id)!.getRendererItem(key); });
  ipcMain.on(DESKTOP_STATE_SET_CHANNEL, (event, payload) => { owners.get(event.sender.id)!.setRendererItem(payload.key, payload.value); event.returnValue = true; });
  ipcMain.on(DESKTOP_STATE_REMOVE_CHANNEL, (event, key) => { owners.get(event.sender.id)!.removeRendererItem(key); event.returnValue = true; });
  ipcMain.on(DESKTOP_STATE_KEYS_CHANNEL, event => { event.returnValue = owners.get(event.sender.id)!.rendererKeys(); });
  ipcMain.on(DESKTOP_SESSION_CONTEXT_GET_CHANNEL, event => { event.returnValue = { local_environment_id: 'owned-continuity-env', renderer_storage_scope_id: scope, target_kind: 'local_environment', target_route: 'local_host', session_source: 'local_runtime', env_public_id: 'env_local' }; });
  ipcMain.on(DESKTOP_SESSION_TRANSPORT_RECOVERY_GET_CHANNEL, event => { event.returnValue = null; });
  const fixtures = JSON.parse(process.env.REDEVEN_CONTINUITY_PAGES!) as Record<string, { row: string; skeleton: string; title: string } | null>;
  for (const [target, fixture] of Object.entries(fixtures)) {
    const state = new DesktopStateStore(path.join(app.getPath('userData'), `${target}-ui-state.json`));
    if (process.env.REDEVEN_CONTINUITY_PHASE === 'write') {
      state.setRendererItem(navigationKey, JSON.stringify({ version: 1, target: { kind: 'builtin', page: target }, recentBuiltins: [target, 'terminal'] }));
      state.setRendererItem('redeven_envapp_desktop_view_mode', 'activity');
    } else assert.equal(JSON.parse(state.getRendererItem(navigationKey)!).target.page, target);
    const window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { preload: process.env.REDEVEN_CONTINUITY_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    owners.set(window.webContents.id, state);
    console.log('Electron preparing', target);
    window.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer:', event.message); });
    window.showInactive();
    await window.loadURL('about:blank');
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
      const NativeWebTransport = globalThis.WebTransport;
      const bytes = Uint8Array.from(atob(${JSON.stringify(process.env.REDEVEN_CONTINUITY_CERTIFICATE)}), c => c.charCodeAt(0));
      globalThis.WebTransport = class extends NativeWebTransport { constructor(url, options = {}) { super(url, { ...options, serverCertificateHashes: [{ algorithm: 'sha-256', value: bytes }] }); } };
    ` });
    const beforeReads = restoredReads;
    const beforeWrites = written;
    console.log('Electron loading', target);
    await window.loadURL(process.env.REDEVEN_CONTINUITY_URL!);
    console.log('Electron loaded', target);
    const wait = async (expression: string) => window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now(); const poll = () => { if (${expression}) return resolve(true); if (Date.now() - started > 15000) return reject(new Error('Timed out: ' + ${JSON.stringify(expression)} + '\\n' + document.body.innerText)); setTimeout(poll, 25); }; poll();
    })`);
    await wait(`document.querySelector('[data-floe-keep-alive-view="${target}"]')?.getBoundingClientRect().width > 0`);
    if (fixture) {
      await wait(`[...document.querySelectorAll(${JSON.stringify(fixture.row)})].some(element => element.textContent.includes(${JSON.stringify(fixture.title)}))`);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(fixture.skeleton)}) === null`), true);
      if (target === 'applications') assert.ok(await window.webContents.executeJavaScript(`document.querySelector('button.host-app-tile img').src.startsWith('data:image/png;base64,')`));
      if (process.env.REDEVEN_CONTINUITY_PHASE === 'read') assert.ok(restoredReads > beforeReads, `${target}: expected asynchronous disk read`);
      await window.webContents.executeJavaScript(`window.dispatchEvent(new Event('pagehide'))`);
      if (process.env.REDEVEN_CONTINUITY_PHASE === 'write') {
        const started = Date.now();
        while (written <= beforeWrites && Date.now() - started < 3000) await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(written > beforeWrites, `${target}: expected asynchronous disk write`);
      }
    }
    assert.equal(JSON.parse(state.getRendererItem(navigationKey)!).target.page, target);
    console.log(`PASS Electron ${process.env.REDEVEN_CONTINUITY_PHASE}: ${target}`);
    owners.delete(window.webContents.id); window.destroy();
  }
  console.log(`PASS Electron completion: ${process.env.REDEVEN_CONTINUITY_PHASE}`);
  app.quit();
}
run().catch(error => { console.error(error); app.exit(1); });
