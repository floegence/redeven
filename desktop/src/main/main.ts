import { app, BrowserWindow, dialog, shell } from 'electron';

import { startManagedAgent, type ManagedAgent } from './agentProcess';
import { isAllowedAppNavigation } from './navigation';
import { resolveBundledAgentPath } from './paths';

let mainWindow: BrowserWindow | null = null;
let managedAgent: ManagedAgent | null = null;
let allowedBaseURL = '';
let quitting = false;
const childWindows = new Set<BrowserWindow>();

function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

function openExternal(url: string): void {
  if (!url || url === 'about:blank') return;
  void shell.openExternal(url);
}

function createBrowserWindow(targetURL: string, parent?: BrowserWindow): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: '#f6f1e8',
    parent,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const { webContents } = win;
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAppNavigation(url, allowedBaseURL)) {
      createBrowserWindow(url, win);
    } else {
      openExternal(url);
    }
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url, allowedBaseURL)) {
      return;
    }
    event.preventDefault();
    openExternal(url);
  });

  win.once('ready-to-show', () => {
    win.show();
  });
  if (parent) {
    childWindows.add(win);
    win.on('closed', () => {
      childWindows.delete(win);
    });
  }
  void win.loadURL(targetURL);
  return win;
}

async function ensureAgentStarted(): Promise<string> {
  if (managedAgent) {
    return managedAgent.startup.local_ui_url;
  }

  const executablePath = resolveBundledAgentPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  managedAgent = await startManagedAgent({
    executablePath,
    tempRoot: app.getPath('temp'),
    onLog: (stream, chunk) => {
      const text = String(chunk ?? '').trim();
      if (!text) return;
      console.log(`[redeven:${stream}] ${text}`);
    },
  });
  allowedBaseURL = managedAgent.startup.local_ui_url;
  return allowedBaseURL;
}

async function showMainWindow(): Promise<void> {
  const targetURL = await ensureAgentStarted();
  if (mainWindow) {
    await mainWindow.loadURL(targetURL);
    focusMainWindow();
    return;
  }

  mainWindow = createBrowserWindow(targetURL);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function shutdownAgent(): Promise<void> {
  for (const win of childWindows) {
    if (!win.isDestroyed()) {
      win.close();
    }
  }
  childWindows.clear();
  const runningAgent = managedAgent;
  managedAgent = null;
  if (runningAgent) {
    await runningAgent.stop();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    try {
      await showMainWindow();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to start', message || 'Unknown startup error.');
      app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow) {
      focusMainWindow();
      return;
    }
    void showMainWindow().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to restore', message || 'Unknown restore error.');
      app.quit();
    });
  });

  app.on('before-quit', (event) => {
    if (quitting) {
      return;
    }
    quitting = true;
    event.preventDefault();
    void shutdownAgent().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
