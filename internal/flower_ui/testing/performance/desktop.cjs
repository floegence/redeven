const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.FLOWER_PERF_PROFILE);
app.whenReady().then(async () => {
  const isolatedInput = process.argv.includes('--redeven-smoke-run=long-thread-gate');
  const window = new BrowserWindow({ width: 1280, height: 900, show: !isolatedInput,
    ...(isolatedInput ? { focusable: false } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (isolatedInput) {
    // Keep the real visible compositor and CDP input path without taking the
    // user's native keyboard focus. Install isolation before showing the window.
    window.setIgnoreMouseEvents(true);
    window.webContents.on('before-input-event', event => event.preventDefault());
    window.showInactive();
  }
  await window.loadURL(process.env.FLOWER_PERF_URL);
});
app.on('window-all-closed', () => app.quit());
