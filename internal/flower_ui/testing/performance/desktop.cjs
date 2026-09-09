const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.FLOWER_PERF_PROFILE);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await window.loadURL(process.env.FLOWER_PERF_URL);
});
app.on('window-all-closed', () => app.quit());
