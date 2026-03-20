import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, session, shell, type MessageBoxOptions } from 'electron';

import { launchStartedFreshManagedRuntime, startManagedAgent, type ManagedAgent } from './agentProcess';
import { buildAppMenuTemplate } from './appMenu';
import { blockedActionFromURL, blockedPageDataURL, isBlockedActionURL } from './blockedPage';
import {
  activeDesktopTargetKey,
  clearPendingBootstrap,
  createSafeStorageSecretCodec,
  defaultDesktopPreferencesPaths,
  desktopPreferencesToDraft,
  loadDesktopPreferences,
  managedDesktopLaunchKey,
  saveDesktopPreferences,
  validateDesktopSettingsDraft,
  type DesktopPreferences,
} from './desktopPreferences';
import { buildDesktopAgentArgs, buildDesktopAgentEnvironment } from './desktopLaunch';
import { defaultDesktopStateStorePath, DesktopStateStore } from './desktopStateStore';
import { DesktopDiagnosticsRecorder } from './diagnostics';
import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import { isAllowedAppNavigation } from './navigation';
import { resolveBrowserPreloadPath, resolveBundledAgentPath, resolveSettingsPreloadPath } from './paths';
import { loadExternalLocalUIStartup } from './runtimeState';
import { settingsPageDataURL } from './settingsPage';
import type { StartupReport } from './startup';
import {
  applyRestoredWindowState,
  attachDesktopWindowStatePersistence,
  restoreBrowserWindowBounds,
} from './windowState';
import { resolveDesktopWindowSpec } from './windowSpec';
import { applyDesktopWindowTheme, buildDesktopWindowChromeOptions, defaultDesktopWindowThemeSnapshot } from './windowChrome';
import {
  CANCEL_DESKTOP_SETTINGS_CHANNEL,
  SAVE_DESKTOP_SETTINGS_CHANNEL,
  type DesktopSettingsDraft,
  type SaveDesktopSettingsResult,
} from '../shared/settingsIPC';
import {
  DESKTOP_STATE_GET_CHANNEL,
  DESKTOP_STATE_KEYS_CHANNEL,
  DESKTOP_STATE_REMOVE_CHANNEL,
  DESKTOP_STATE_SET_CHANNEL,
  normalizeDesktopStateKey,
  normalizeDesktopStateSetPayload,
} from '../shared/stateIPC';
import {
  REPORT_DESKTOP_WINDOW_THEME_CHANNEL,
  normalizeDesktopWindowThemeSnapshot,
} from '../shared/windowThemeIPC';
import {
  DESKTOP_ASK_FLOWER_HANDOFF_DELIVER_CHANNEL,
  DESKTOP_ASK_FLOWER_HANDOFF_REQUEST_CHANNEL,
  normalizeDesktopAskFlowerHandoffPayload,
  type DesktopAskFlowerHandoffPayload,
} from '../shared/askFlowerHandoffIPC';

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let managedAgent: ManagedAgent | null = null;
let externalTargetStartup: StartupReport | null = null;
let allowedBaseURL = '';
let quitPhase: 'idle' | 'requested' | 'shutting_down' = 'idle';
const childWindows = new Set<BrowserWindow>();
const namedChildWindows = new Map<string, BrowserWindow>();
let blockedLaunch: LaunchBlockedReport | null = null;
let desktopPreferencesCache: DesktopPreferences | null = null;
let desktopStateStoreCache: DesktopStateStore | null = null;
const desktopDiagnostics = new DesktopDiagnosticsRecorder();
const windowStateCleanup = new Map<BrowserWindow, () => void>();

const SETTINGS_WINDOW_STATE_KEY = 'settings';
const pendingMainWindowAskFlowerHandoffs: DesktopAskFlowerHandoffPayload[] = [];

const SETTINGS_WINDOW_SPEC = {
  width: 760,
  height: 820,
  minWidth: 720,
  minHeight: 720,
} as const;

function preferencesPaths() {
  return defaultDesktopPreferencesPaths(app.getPath('userData'));
}

function preferencesCodec() {
  return createSafeStorageSecretCodec(safeStorage);
}

function desktopStateStore(): DesktopStateStore {
  if (!desktopStateStoreCache) {
    desktopStateStoreCache = new DesktopStateStore(defaultDesktopStateStorePath(app.getPath('userData')));
  }
  return desktopStateStoreCache;
}

function registerWindowStatePersistence(win: BrowserWindow, key: string): void {
  const dispose = attachDesktopWindowStatePersistence(win, desktopStateStore(), key);
  windowStateCleanup.set(win, dispose);
}

function cleanupWindowStatePersistence(win: BrowserWindow): void {
  const dispose = windowStateCleanup.get(win);
  if (!dispose) {
    return;
  }
  windowStateCleanup.delete(win);
  dispose();
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

function buildExternalTargetBlockedReport(
  code: 'external_target_unreachable' | 'external_target_invalid',
  targetURL: string,
  message: string,
): LaunchBlockedReport {
  return {
    status: 'blocked',
    code,
    message,
    diagnostics: {
      target_url: targetURL,
    },
  };
}

function presentAppWindow(win: BrowserWindow, options?: Readonly<{ stealAppFocus?: boolean }>): void {
  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }
  if (process.platform === 'darwin' && options?.stealAppFocus) {
    app.focus({ steal: true });
  } else {
    app.focus();
  }
  try {
    win.moveTop();
  } catch {
    // Best-effort only: some platforms/window managers may ignore stacking hints.
  }
  win.focus();
}

function focusMainWindow(options?: Readonly<{ stealAppFocus?: boolean }>): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  presentAppWindow(mainWindow, options);
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
  await desktopDiagnostics.recordLifecycle('quit_requested', 'user requested to quit Redeven Desktop');
  app.quit();
}

async function openSettingsWindow(draft?: DesktopSettingsDraft, errorMessage = ''): Promise<void> {
  const currentDraft = draft ?? desktopPreferencesToDraft(await loadDesktopPreferencesCached());

  if (!settingsWindow) {
    const restoredState = desktopStateStore().getWindowState(SETTINGS_WINDOW_STATE_KEY);
    const restoredBounds = restoreBrowserWindowBounds(SETTINGS_WINDOW_SPEC, desktopStateStore(), SETTINGS_WINDOW_STATE_KEY);
    const restoredPosition = restoredBounds.x === undefined || restoredBounds.y === undefined
      ? {}
      : { x: restoredBounds.x, y: restoredBounds.y };

    settingsWindow = new BrowserWindow({
      ...restoredPosition,
      width: restoredBounds.width,
      height: restoredBounds.height,
      minWidth: SETTINGS_WINDOW_SPEC.minWidth,
      minHeight: SETTINGS_WINDOW_SPEC.minHeight,
      show: false,
      title: 'Redeven Desktop Settings',
      parent: mainWindow ?? undefined,
      modal: false,
      ...buildDesktopWindowChromeOptions(process.platform, defaultDesktopWindowThemeSnapshot()),
      webPreferences: {
        preload: resolveSettingsPreloadPath({ appPath: app.getAppPath() }),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    });
    applyRestoredWindowState(settingsWindow, restoredState);
    registerWindowStatePersistence(settingsWindow, SETTINGS_WINDOW_STATE_KEY);
    settingsWindow.on('closed', () => {
      cleanupWindowStatePersistence(settingsWindow!);
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

  await settingsWindow.loadURL(settingsPageDataURL(currentDraft, errorMessage, process.platform));
  if (!settingsWindow.isVisible()) {
    settingsWindow.show();
  }
  settingsWindow.focus();
}

function buildConnectToRedevenDraft(preferences: DesktopPreferences): DesktopSettingsDraft {
  return {
    ...desktopPreferencesToDraft(preferences),
    target_kind: 'external_local_ui',
  };
}

async function openConnectToRedevenWindow(): Promise<void> {
  await openSettingsWindow(buildConnectToRedevenDraft(await loadDesktopPreferencesCached()));
}

async function applySavedPreferences(previous: DesktopPreferences, next: DesktopPreferences): Promise<void> {
  blockedLaunch = null;
  const targetChanged = activeDesktopTargetKey(previous) !== activeDesktopTargetKey(next);
  if (targetChanged) {
    await disconnectCurrentTarget();
    await showMainWindow();
    return;
  }
  if (next.target.kind === 'external_local_ui') {
    return;
  }
  const managedLaunchChanged = managedDesktopLaunchKey(previous) !== managedDesktopLaunchKey(next);
  if (!managedLaunchChanged) {
    return;
  }
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

  await disconnectCurrentTarget();
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
    const openSettings = blockedLaunch?.code === 'external_target_unreachable' || blockedLaunch?.code === 'external_target_invalid'
      ? openConnectToRedevenWindow
      : openSettingsWindow;
    void openSettings().catch((error) => {
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

function focusAuxiliaryWindow(win: BrowserWindow): void {
  presentAppWindow(win);
}

function flushPendingMainWindowAskFlowerHandoffs(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.webContents.isLoadingMainFrame() || pendingMainWindowAskFlowerHandoffs.length <= 0) {
    return;
  }

  const queue = pendingMainWindowAskFlowerHandoffs.splice(0, pendingMainWindowAskFlowerHandoffs.length);
  for (const payload of queue) {
    mainWindow.webContents.send(DESKTOP_ASK_FLOWER_HANDOFF_DELIVER_CHANNEL, payload);
  }
}

function queueMainWindowAskFlowerHandoff(payload: DesktopAskFlowerHandoffPayload): void {
  pendingMainWindowAskFlowerHandoffs.push(payload);
  flushPendingMainWindowAskFlowerHandoffs();
}

function createBrowserWindow(targetURL: string, parent?: BrowserWindow, frameName = '', explicitWindowStateKey = ''): BrowserWindow {
  const spec = resolveDesktopWindowSpec(targetURL, Boolean(parent));
  const attachToParent = Boolean(parent) && spec.attachToParent !== false;
  const actualParent = attachToParent ? parent : undefined;
  // Every desktop browser window needs the shared preload because it hosts
  // renderer persistence bridges in addition to any platform-specific chrome integration.
  const browserPreloadPath = resolveBrowserPreloadPath({ appPath: app.getAppPath() });
  const trimmedFrameName = String(frameName ?? '').trim();
  const windowStateKey = String(explicitWindowStateKey ?? '').trim()
    || (trimmedFrameName ? `window:${trimmedFrameName}` : parent ? 'window:child' : 'window:main');
  if (trimmedFrameName) {
    const existing = namedChildWindows.get(trimmedFrameName);
    if (existing && !existing.isDestroyed()) {
      if (spec.title) {
        existing.setTitle(spec.title);
      }
      void existing.loadURL(targetURL);
      focusAuxiliaryWindow(existing);
      return existing;
    }
  }

  const windowRole = parent ? (attachToParent ? 'child' : 'detached') : 'main';
  const restoredState = desktopStateStore().getWindowState(windowStateKey);
  const restoredBounds = restoreBrowserWindowBounds(spec, desktopStateStore(), windowStateKey);
  const restoredPosition = restoredBounds.x === undefined || restoredBounds.y === undefined
    ? {}
    : { x: restoredBounds.x, y: restoredBounds.y };
  const win = new BrowserWindow({
    ...restoredPosition,
    width: restoredBounds.width,
    height: restoredBounds.height,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    show: false,
    title: spec.title,
    ...buildDesktopWindowChromeOptions(process.platform, defaultDesktopWindowThemeSnapshot()),
    parent: actualParent,
    webPreferences: {
      preload: browserPreloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  applyRestoredWindowState(win, restoredState);
  registerWindowStatePersistence(win, windowStateKey);

  const { webContents } = win;
  webContents.setWindowOpenHandler(({ url, frameName: nextFrameName }) => {
    if (handleBlockedAction(url)) {
      return { action: 'deny' };
    }
    if (isAllowedAppNavigation(url, allowedBaseURL)) {
      createBrowserWindow(url, win, nextFrameName);
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

  void desktopDiagnostics.recordLifecycle('window_created', 'browser window created', { role: windowRole });
  webContents.on('did-start-loading', () => {
    void desktopDiagnostics.recordLifecycle('loading_started', 'browser window started loading', { role: windowRole });
  });
  webContents.on('did-finish-load', () => {
    void desktopDiagnostics.recordLifecycle('loading_finished', 'browser window finished loading', { role: windowRole, url: webContents.getURL() });
  });
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    void desktopDiagnostics.recordLifecycle('loading_failed', errorDescription || 'browser window failed to load', {
      role: windowRole,
      url: validatedURL,
      error_code: errorCode,
      main_frame: isMainFrame,
    });
  });

  win.once('ready-to-show', () => {
    win.show();
    void desktopDiagnostics.recordLifecycle('ready_to_show', 'browser window is ready to show', { role: windowRole });
  });
  win.on('closed', () => {
    void desktopDiagnostics.recordLifecycle('window_closed', 'browser window closed', { role: windowRole });
    cleanupWindowStatePersistence(win);
    childWindows.delete(win);
    if (trimmedFrameName && namedChildWindows.get(trimmedFrameName) === win) {
      namedChildWindows.delete(trimmedFrameName);
    }
  });
  if (parent || trimmedFrameName) {
    childWindows.add(win);
  }
  if (trimmedFrameName) {
    namedChildWindows.set(trimmedFrameName, win);
  }
  void win.loadURL(targetURL);
  return win;
}

function createMainBrowserWindow(targetURL: string): BrowserWindow {
  const win = createBrowserWindow(targetURL, undefined, '', 'window:main');
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
  win.webContents.on('did-finish-load', () => {
    if (mainWindow !== win) {
      return;
    }
    flushPendingMainWindowAskFlowerHandoffs();
  });
  win.once('ready-to-show', () => {
    if (mainWindow !== win || pendingMainWindowAskFlowerHandoffs.length <= 0) {
      return;
    }
    focusMainWindow({ stealAppFocus: true });
  });
  return win;
}

async function ensureDesktopTargetReady(): Promise<string> {
  const preferences = await loadDesktopPreferencesCached();
  if (preferences.target.kind === 'external_local_ui') {
    if (externalTargetStartup?.local_ui_url === preferences.target.external_local_ui_url) {
      blockedLaunch = null;
      allowedBaseURL = externalTargetStartup.local_ui_url;
      return externalTargetStartup.local_ui_url;
    }

    try {
      const startup = await loadExternalLocalUIStartup(preferences.target.external_local_ui_url);
      if (!startup) {
        blockedLaunch = buildExternalTargetBlockedReport(
          'external_target_unreachable',
          preferences.target.external_local_ui_url,
          'Desktop could not reach the configured Redeven URL. Make sure the target machine is exposing Redeven Local UI and that its port is reachable from this machine.',
        );
        managedAgent = null;
        externalTargetStartup = null;
        allowedBaseURL = '';
        desktopDiagnostics.clearRuntime();
        return blockedPageDataURL(blockedLaunch, process.platform);
      }

      blockedLaunch = null;
      managedAgent = null;
      externalTargetStartup = startup;
      allowedBaseURL = startup.local_ui_url;
      await desktopDiagnostics.configureRuntime(startup, allowedBaseURL);
      await desktopDiagnostics.recordLifecycle(
        'external_target_connected',
        'desktop connected to an external Redeven Local UI target',
        {
          target_url: startup.local_ui_url,
        },
      );
      return allowedBaseURL;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      blockedLaunch = buildExternalTargetBlockedReport(
        'external_target_invalid',
        preferences.target.external_local_ui_url,
        message || 'Desktop target is invalid.',
      );
      managedAgent = null;
      externalTargetStartup = null;
      allowedBaseURL = '';
      desktopDiagnostics.clearRuntime();
      return blockedPageDataURL(blockedLaunch, process.platform);
    }
  }

  externalTargetStartup = null;
  if (managedAgent) {
    blockedLaunch = null;
    return managedAgent.startup.local_ui_url;
  }

  const executablePath = resolveBundledAgentPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
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
    desktopDiagnostics.clearRuntime();
    return blockedPageDataURL(launch.blocked, process.platform);
  }

  if (launchStartedFreshManagedRuntime(launch) && preferences.pending_bootstrap) {
    await persistDesktopPreferences(clearPendingBootstrap(preferences));
  }

  blockedLaunch = null;
  managedAgent = launch.managedAgent;
  allowedBaseURL = managedAgent.startup.local_ui_url;
  await desktopDiagnostics.configureRuntime(managedAgent.startup, allowedBaseURL);
  await desktopDiagnostics.recordLifecycle(
    managedAgent.attached ? 'agent_attached' : 'agent_started',
    managedAgent.attached ? 'desktop attached to an existing agent runtime' : 'desktop started a managed agent runtime',
    {
      attached: managedAgent.attached,
      spawned: launch.spawned,
      effective_run_mode: managedAgent.startup.effective_run_mode ?? '',
    },
  );
  return allowedBaseURL;
}

async function ensureMainWindowCreated(): Promise<BrowserWindow> {
  const targetURL = await ensureDesktopTargetReady();
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainBrowserWindow(targetURL);
  }
  return mainWindow;
}

async function showMainWindow(): Promise<void> {
  const targetURL = await ensureDesktopTargetReady();
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(targetURL);
    focusMainWindow();
    return;
  }

  mainWindow = createMainBrowserWindow(targetURL);
}

async function handoffAskFlowerToMainWindow(payload: DesktopAskFlowerHandoffPayload): Promise<void> {
  await ensureMainWindowCreated();
  queueMainWindowAskFlowerHandoff(payload);
  focusMainWindow({ stealAppFocus: true });
}

async function disconnectCurrentTarget(): Promise<void> {
  await desktopDiagnostics.recordLifecycle('target_disconnecting', 'desktop is disconnecting from the current Redeven target');
  for (const win of childWindows) {
    if (!win.isDestroyed()) {
      win.close();
    }
  }
  childWindows.clear();
  const runningAgent = managedAgent;
  managedAgent = null;
  externalTargetStartup = null;
  allowedBaseURL = '';
  if (runningAgent) {
    await runningAgent.stop();
  }
  desktopDiagnostics.clearRuntime();
}

function installDesktopDiagnosticsHooks(): void {
  const webSession = session.defaultSession;
  webSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = desktopDiagnostics.startRequest({
      requestID: details.id,
      method: details.method,
      url: details.url,
      requestHeaders: details.requestHeaders as Record<string, string | string[]>,
    });
    callback(requestHeaders ? { requestHeaders } : {});
  });
  webSession.webRequest.onCompleted((details) => {
    void desktopDiagnostics.completeRequest({
      requestID: details.id,
      url: details.url,
      statusCode: details.statusCode,
      responseHeaders: details.responseHeaders as Record<string, string | string[]> | undefined,
      fromCache: details.fromCache,
    });
  });
  webSession.webRequest.onErrorOccurred((details) => {
    void desktopDiagnostics.failRequest({
      requestID: details.id,
      url: details.url,
      error: details.error,
    });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusMainWindow();
  });

  ipcMain.on(DESKTOP_STATE_GET_CHANNEL, (event, key) => {
    const cleanKey = normalizeDesktopStateKey(key);
    event.returnValue = cleanKey ? desktopStateStore().getRendererItem(cleanKey) : null;
  });
  ipcMain.on(DESKTOP_STATE_SET_CHANNEL, (event, payload) => {
    const normalized = normalizeDesktopStateSetPayload(payload);
    if (normalized) {
      desktopStateStore().setRendererItem(normalized.key, normalized.value);
    }
    event.returnValue = null;
  });
  ipcMain.on(DESKTOP_STATE_REMOVE_CHANNEL, (event, key) => {
    const cleanKey = normalizeDesktopStateKey(key);
    if (cleanKey) {
      desktopStateStore().removeRendererItem(cleanKey);
    }
    event.returnValue = null;
  });
  ipcMain.on(DESKTOP_STATE_KEYS_CHANNEL, (event) => {
    event.returnValue = desktopStateStore().rendererKeys();
  });

  ipcMain.handle(SAVE_DESKTOP_SETTINGS_CHANNEL, async (_event, draft: DesktopSettingsDraft): Promise<SaveDesktopSettingsResult> => {
    try {
      const next = validateDesktopSettingsDraft(draft);
      const previous = await loadDesktopPreferencesCached();
      await persistDesktopPreferences(next);
      await applySavedPreferences(previous, next);
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
  ipcMain.on(REPORT_DESKTOP_WINDOW_THEME_CHANNEL, (event, snapshot) => {
    const normalized = normalizeDesktopWindowThemeSnapshot(snapshot);
    if (!normalized) {
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) {
      return;
    }
    applyDesktopWindowTheme(win, normalized, process.platform);
  });
  ipcMain.on(DESKTOP_ASK_FLOWER_HANDOFF_REQUEST_CHANNEL, (_event, payload) => {
    const normalized = normalizeDesktopAskFlowerHandoffPayload(payload);
    if (!normalized) {
      return;
    }
    void handoffAskFlowerToMainWindow(normalized);
  });

  app.whenReady().then(async () => {
    installDesktopDiagnosticsHooks();
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate({
      connectToRedeven: () => {
        void openConnectToRedevenWindow().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          dialog.showErrorBox('Redeven Desktop failed to open target settings', message || 'Unknown target settings error.');
        });
      },
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
    void disconnectCurrentTarget().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
