import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { DesktopStateStore, defaultDesktopStateStorePath } from '../../../../desktop/src/main/desktopStateStore';
import { DESKTOP_STATE_GET_CHANNEL, DESKTOP_STATE_KEYS_CHANNEL, DESKTOP_STATE_REMOVE_CHANNEL, DESKTOP_STATE_SET_CHANNEL, normalizeDesktopStateKey, normalizeDesktopStateSetPayload } from '../../../../desktop/src/shared/stateIPC';

app.setPath('userData', process.env.FLOWER_PREFERENCE_PROFILE!);
const state = new DesktopStateStore(defaultDesktopStateStorePath(app.getPath('userData')));
ipcMain.on(DESKTOP_STATE_GET_CHANNEL, (event, key) => { event.returnValue = state.getRendererItem(normalizeDesktopStateKey(key)); });
ipcMain.on(DESKTOP_STATE_SET_CHANNEL, (event, payload) => { const value = normalizeDesktopStateSetPayload(payload); if (value) state.setRendererItem(value.key, value.value); event.returnValue = null; });
ipcMain.on(DESKTOP_STATE_REMOVE_CHANNEL, (event, key) => { state.removeRendererItem(normalizeDesktopStateKey(key)); event.returnValue = null; });
ipcMain.on(DESKTOP_STATE_KEYS_CHANNEL, event => { event.returnValue = state.rendererKeys(); });
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 800, height: 700, webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), partition: 'redeven-direct:ephemeral', sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  await window.loadURL(process.env.FLOWER_PREFERENCE_URL!);
});
app.on('window-all-closed', () => app.quit());
