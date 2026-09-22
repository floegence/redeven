import { app, BrowserWindow, ipcMain } from 'electron';
import { BrowserProjectionWindows } from '../../../../desktop/src/main/browserProjectionWindows';
import { BROWSER_PROJECTION_PREPARE_CHANNEL } from '../../../../desktop/src/shared/browserProjectionIPC';

const configuration = JSON.parse(process.env.REDEVEN_BROWSER_ELECTRON_FIXTURE!);
app.commandLine.appendSwitch('ignore-certificate-errors-spki-list', configuration.spki);
app.setPath('userData', configuration.state);
app.on('window-all-closed', () => app.quit());
void app.whenReady().then(() => {
  const root = new BrowserWindow({ width: 1200, height: 950,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: configuration.preload } });
  const windows = new BrowserProjectionWindows(options => new BrowserWindow(options));
  ipcMain.handle(BROWSER_PROJECTION_PREPARE_CHANNEL, (event, request) => {
    if (event.sender !== root.webContents || event.senderFrame !== root.webContents.mainFrame) return false;
    return windows.prepare(root, request?.url);
  });
  root.webContents.setWindowOpenHandler(details => windows.consume(root, details) ?? { action: 'deny' });
  void root.loadURL(configuration.url);
});
