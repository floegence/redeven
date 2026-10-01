import { app, BrowserWindow } from 'electron';
import { attachHostApplicationWindow } from '../../src/main/hostApplicationWindow';
import { buildDesktopWindowChromeOptions } from '../../src/main/windowChrome';

// The renderer uses production assets and preload against a synthetic desktop.
// Input is recorded by the harness; no host program receives injected events.
async function run(): Promise<void> {
  await app.whenReady();
  const url = process.env.REDEVEN_DESKTOP_FIXTURE_URL!;
  const win = new BrowserWindow({ width: 1000, height: 720, show: true,
    ...buildDesktopWindowChromeOptions(),
    webPreferences: { preload: process.env.REDEVEN_DESKTOP_FIXTURE_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  let files = 0;
  attachHostApplicationWindow(win, win.webContents, url, undefined, () => {
    void win.webContents.executeJavaScript(`document.documentElement.dataset.fixtureFiles = '${++files}'`);
  });
  // The browser harness navigates after installing its event observers.
  await win.loadURL('about:blank');
  app.focus({ steal: true });
  win.focus();
  app.on('window-all-closed', () => app.quit());
}

run().catch(error => { console.error(error); app.exit(1); });
