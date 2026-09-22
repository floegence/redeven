import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DesktopResourceCache } from '../../src/main/desktopResourceCache';
import { DESKTOP_RESOURCE_CACHE_CHANNEL } from '../../src/shared/resourceCacheIPC';

async function run() {
  await app.whenReady();
  const storage = new DesktopResourceCache(path.join(app.getPath('userData'), 'resource-cache'));
  const window = new BrowserWindow({ show: false, webPreferences: {
    preload: process.env.REDEVEN_CACHE_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  ipcMain.handle(DESKTOP_RESOURCE_CACHE_CHANNEL, (event, request) => {
    assert.equal(event.sender, window.webContents);
    assert.equal(event.senderFrame, event.sender.mainFrame);
    return storage.handle('owned-test-environment', request);
  });
  await window.loadURL('data:text/html,<title>Resource cache acceptance</title>');
  if (process.env.REDEVEN_CACHE_PHASE === 'write') {
    await window.webContents.executeJavaScript(`window.redevenDesktopResourceCache.set('apps', JSON.stringify({ applications: [{ id: 'editor', name: 'Editor', icon: 'data:image/png;base64,fixture' }] }))`);
  } else {
    const restored = await window.webContents.executeJavaScript(`window.redevenDesktopResourceCache.get('apps')`);
    assert.equal(JSON.parse(restored).applications[0].name, 'Editor');
    assert.equal(JSON.parse(restored).applications[0].icon, 'data:image/png;base64,fixture');
    const entries = await window.webContents.executeJavaScript(`window.redevenDesktopResourceCache.list()`);
    assert.equal(entries.length, 1);
    console.log('PASS: asynchronous production preload and disk snapshots survive Electron restart.');
  }
  window.destroy();
  app.quit();
}
run().catch(error => { console.error(error); app.exit(1); });
