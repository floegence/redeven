import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, shell, type MessageBoxOptions } from 'electron';

import { launchStartedFreshManagedRuntime, startManagedAgent, type ManagedAgent } from './agentProcess';
import { buildAppMenuTemplate } from './appMenu';
import { blockedActionFromURL, blockedPageDataURL, isBlockedActionURL } from './blockedPage';
import {
  clearPendingBootstrap,
  createSafeStorageSecretCodec,
  defaultDesktopPreferencesPaths,
  desktopPreferencesToDraft,
  loadDesktopPreferences,
  saveDesktopPreferences,
  validateDesktopSettingsDraft,
  type DesktopPreferences,
} from './desktopPreferences';
import { buildDesktopAgentArgs, buildDesktopAgentEnvironment } from './desktopLaunch';
import { desktopTheme } from './desktopTheme';
import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import { isAllowedAppNavigation } from './navigation';
import { resolveBundledAgentPath, resolveSettingsPreloadPath } from './paths';
import { settingsPageDataURL } from './settingsPage';
import {
  CANCEL_DESKTOP_SETTINGS_CHANNEL,
  SAVE_DESKTOP_SETTINGS_CHANNEL,
  type DesktopSettingsDraft,
  type SaveDesktopSettingsResult,
} from '../shared/settingsIPC';

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let managedAgent: ManagedAgent | null = null;
let allowedBaseURL = '';
let quitPhase: 'idle' | 'requested' | 'shutting_down' = 'idle';
const childWindows = new Set<BrowserWindow>();
let blockedLaunch: LaunchBlockedReport | null = null;
let desktopPreferencesCache: DesktopPreferences | null = null;

function preferencesPaths() {
  return defaultDesktopPreferencesPaths(app.getPath('userData'));
}

function preferencesCodec() {
  return createSafeStorageSecretCodec(safeStorage);
}

async function loadDesktopPreferencesCached(): Promise<DesktopPreferences> {
  if (desktopPreferencesCache) {
    return desktopPreferencesCache;
  }
  desktopPreferencesCache = await loadDesktopPreferences(preferencesPaths(), preferencesCodec());
  return desktopPreferencesCache;
}

async function persistDesktopPreferences(next: DesktopPreferences): Promise<void> {
  desktopPreferencesCache = next;
  await saveDesktopPreferences(preferencesPaths(), next, preferencesCodec());
}

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

async function requestQuit(): Promise<void> {
  if (quitPhase !== 'idle') {
    return;
  }

  const parentWindow = settingsWindow ?? mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined;
  const options: MessageBoxOptions = {
    type: 'question',
    buttons: ['Cancel', 'Quit'],
    defaultId: 1,
    cancelId: 0,
    title: 'Quit Redeven Desktop?',
    message: 'Quit Redeven Desktop?',
    detail: 'The desktop window will close, and any desktop-managed Redeven process started by this app will stop.',
    normalizeAccessKeys: true,
  };
  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response !== 1) {
    return;
  }

  quitPhase = 'requested';
  app.quit();
}

async function openSettingsWindow(draft?: DesktopSettingsDraft, errorMessage = ''): Promise<void> {
  const currentDraft = draft ?? desktopPreferencesToDraft(await loadDesktopPreferencesCached());

  if (!settingsWindow) {
    settingsWindow = new BrowserWindow({
      width: 760,
      height: 820,
      minWidth: 720,
      minHeight: 720,
      show: false,
      title: 'Redeven Desktop Settings',
      parent: mainWindow ?? undefined,
      modal: false,
      backgroundColor: desktopTheme.windowBackground,
      webPreferences: {
        preload: resolveSettingsPreloadPath({ appPath: app.getAppPath() }),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    });
    settingsWindow.on('closed', () => {
      settingsWindow = null;
    });
    settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
    settingsWindow.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith('data:')) {
        return;
      }
      event.preventDefault();
      openExternal(url);
    });
  }

  await settingsWindow.loadURL(settingsPageDataURL(currentDraft, errorMessage));
  if (!settingsWindow.isVisible()) {
    settingsWindow.show();
  }
  settingsWindow.focus();
}

async function applySavedPreferences(): Promise<void> {
  blockedLaunch = null;
  if (!managedAgent) {
    await showMainWindow();
    return;
  }

  if (managedAgent.attached) {
    const options: MessageBoxOptions = {
      type: 'info',
      buttons: ['OK'],
      defaultId: 0,
      title: 'Settings saved',
      message: 'Settings saved for the next desktop-managed start.',
      detail: 'Redeven Desktop is currently attached to an already-running agent, so the new startup settings will apply after that agent stops and Desktop starts a fresh desktop-managed runtime.',
      normalizeAccessKeys: true,
    };
    if (mainWindow) {
      await dialog.showMessageBox(mainWindow, options);
    } else {
      await dialog.showMessageBox(options);
    }
    return;
  }

  await shutdownAgent();
  await showMainWindow();
}

function handleBlockedAction(url: string): boolean {
  const action = blockedActionFromURL(url);
  if (!action) {
    return false;
  }
  if (action === 'retry') {
    blockedLaunch = null;
    void showMainWindow().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to retry', message || 'Unknown retry error.');
      app.quit();
    });
    return true;
  }
  if (action === 'copy-diagnostics') {
    if (blockedLaunch) {
      clipboard.writeText(formatBlockedLaunchDiagnostics(blockedLaunch));
    }
    return true;
  }
  if (action === 'settings') {
    void openSettingsWindow().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to open settings', message || 'Unknown settings error.');
    });
    return true;
  }
  if (action === 'quit') {
    void requestQuit();
    return true;
  }
  return false;
}

function createBrowserWindow(targetURL: string, parent?: BrowserWindow): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: desktopTheme.windowBackground,
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
    if (handleBlockedAction(url)) {
      return { action: 'deny' };
    }
    if (isAllowedAppNavigation(url, allowedBaseURL)) {
      createBrowserWindow(url, win);
    } else {
      openExternal(url);
    }
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (isBlockedActionURL(url)) {
      event.preventDefault();
      handleBlockedAction(url);
      return;
    }
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
    blockedLaunch = null;
    return managedAgent.startup.local_ui_url;
  }

  const executablePath = resolveBundledAgentPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  const preferences = await loadDesktopPreferencesCached();
  const launch = await startManagedAgent({
    executablePath,
    agentArgs: buildDesktopAgentArgs(preferences),
    env: buildDesktopAgentEnvironment(preferences),
    tempRoot: app.getPath('temp'),
    onLog: (stream, chunk) => {
      const text = String(chunk ?? '').trim();
      if (!text) return;
      console.log(`[redeven:${stream}] ${text}`);
    },
  });
  if (launch.kind === 'blocked') {
    managedAgent = null;
    blockedLaunch = launch.blocked;
    allowedBaseURL = '';
    return blockedPageDataURL(launch.blocked);
  }

  if (launchStartedFreshManagedRuntime(launch) && preferences.pending_bootstrap) {
    await persistDesktopPreferences(clearPendingBootstrap(preferences));
  }

  blockedLaunch = null;
  managedAgent = launch.managedAgent;
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
  allowedBaseURL = '';
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

  ipcMain.handle(SAVE_DESKTOP_SETTINGS_CHANNEL, async (_event, draft: DesktopSettingsDraft): Promise<SaveDesktopSettingsResult> => {
    try {
      const next = validateDesktopSettingsDraft(draft);
      await persistDesktopPreferences(next);
      await applySavedPreferences();
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.close();
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.on(CANCEL_DESKTOP_SETTINGS_CHANNEL, () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate({
      openSettings: () => {
        void openSettingsWindow().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          dialog.showErrorBox('Redeven Desktop failed to open settings', message || 'Unknown settings error.');
        });
      },
      requestQuit: () => {
        void requestQuit();
      },
    })));

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
    if (quitPhase === 'shutting_down') {
      return;
    }
    quitPhase = 'shutting_down';
    event.preventDefault();
    void shutdownAgent().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
