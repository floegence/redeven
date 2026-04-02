import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell, type MessageBoxOptions } from 'electron';
import { pathToFileURL } from 'node:url';

import { launchStartedFreshManagedRuntime, startManagedAgent, type ManagedAgent } from './agentProcess';
import { buildAppMenuTemplate } from './appMenu';
import {
  clearPendingBootstrap,
  createSafeStorageSecretCodec,
  deleteSavedEnvironment,
  defaultDesktopPreferencesPaths,
  loadDesktopPreferences,
  rememberRecentExternalLocalUITarget,
  saveDesktopPreferences,
  upsertSavedEnvironment,
  validateDesktopSettingsDraft,
  type DesktopPreferences,
} from './desktopPreferences';
import type { DesktopSessionTarget } from './desktopTarget';
import { buildDesktopAgentArgs, buildDesktopAgentEnvironment } from './desktopLaunch';
import {
  buildBlockedLaunchIssue,
  buildDesktopWelcomeSnapshot,
  buildRemoteConnectionIssue,
  type BuildDesktopWelcomeSnapshotArgs,
} from './desktopWelcomeState';
import { defaultDesktopStateStorePath, DesktopStateStore } from './desktopStateStore';
import { DesktopDiagnosticsRecorder } from './diagnostics';
import { isAllowedAppNavigation } from './navigation';
import { resolveBrowserPreloadPath, resolveBundledAgentPath, resolveWelcomeRendererPath } from './paths';
import { loadExternalLocalUIStartup } from './runtimeState';
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
import {
  DESKTOP_SHELL_OPEN_WINDOW_CHANNEL,
  normalizeDesktopShellOpenWindowRequest,
} from '../shared/desktopShellWindowIPC';
import {
  DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL,
  DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL,
  normalizeDesktopLauncherActionRequest,
  type DesktopLauncherActionRequest,
  type DesktopLauncherSurface,
  type DesktopWelcomeEntryReason,
  type DesktopWelcomeIssue,
} from '../shared/desktopLauncherIPC';

type OpenDesktopWelcomeOptions = Readonly<{
  surface?: DesktopLauncherSurface;
  entryReason?: DesktopWelcomeEntryReason;
  issue?: DesktopWelcomeIssue | null;
  stealAppFocus?: boolean;
}>;

type PreparedExternalTargetResult = Readonly<
  | {
      ok: true;
      startup: StartupReport;
    }
  | {
      ok: false;
      entryReason: DesktopWelcomeEntryReason;
      issue: DesktopWelcomeIssue;
    }
>;

type ManagedTargetLaunch = Exclude<Awaited<ReturnType<typeof startManagedAgent>>, Readonly<{ kind: 'blocked' }>>;

type PreparedManagedTargetResult = Readonly<
  | {
      ok: true;
      launch: ManagedTargetLaunch;
    }
  | {
      ok: false;
      entryReason: DesktopWelcomeEntryReason;
      issue: DesktopWelcomeIssue;
    }
>;

let mainWindow: BrowserWindow | null = null;
let managedAgent: ManagedAgent | null = null;
let externalTargetStartup: StartupReport | null = null;
let currentSessionTarget: DesktopSessionTarget | null = null;
let allowedBaseURL = '';
let quitPhase: 'idle' | 'requested' | 'shutting_down' = 'idle';
const childWindows = new Set<BrowserWindow>();
const namedChildWindows = new Map<string, BrowserWindow>();
let desktopPreferencesCache: DesktopPreferences | null = null;
let desktopStateStoreCache: DesktopStateStore | null = null;
const desktopDiagnostics = new DesktopDiagnosticsRecorder();
const windowStateCleanup = new Map<BrowserWindow, () => void>();
const pendingMainWindowAskFlowerHandoffs: DesktopAskFlowerHandoffPayload[] = [];
let desktopWelcomeViewState: Readonly<{
  surface: DesktopLauncherSurface;
  entryReason: DesktopWelcomeEntryReason;
  issue: DesktopWelcomeIssue | null;
}> = {
  surface: 'connect_environment',
  entryReason: 'app_launch',
  issue: null,
};
let settingsReturnSurface: 'welcome' | 'current_target' = 'welcome';

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
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  presentAppWindow(mainWindow, options);
}

function openExternal(url: string): void {
  if (!url || url === 'about:blank') {
    return;
  }
  void shell.openExternal(url);
}

async function requestQuit(): Promise<void> {
  if (quitPhase !== 'idle') {
    return;
  }

  const parentWindow = mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined;
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

async function loadURLInMainWindow(
  targetURL: string,
  _route: 'welcome' | 'target',
  options?: Readonly<{ stealAppFocus?: boolean }>,
): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(targetURL);
    focusMainWindow(options);
    return;
  }

  mainWindow = createMainBrowserWindow(targetURL);
  if (options?.stealAppFocus) {
    mainWindow.once('ready-to-show', () => {
      if (mainWindow) {
        focusMainWindow({ stealAppFocus: true });
      }
    });
  }
}

function desktopWelcomePageURL(): string {
  return pathToFileURL(resolveWelcomeRendererPath({ appPath: app.getAppPath() })).toString();
}

async function buildCurrentDesktopWelcomeSnapshot(
  overrides: Partial<Pick<BuildDesktopWelcomeSnapshotArgs, 'entryReason' | 'issue'>> = {},
) {
  const preferences = await loadDesktopPreferencesCached();
  return buildDesktopWelcomeSnapshot({
    preferences,
    managedStartup: managedAgent?.startup ?? null,
    externalStartup: externalTargetStartup,
    activeSessionTarget: currentSessionTarget,
    surface: desktopWelcomeViewState.surface,
    entryReason: overrides.entryReason ?? desktopWelcomeViewState.entryReason,
    issue: overrides.issue ?? desktopWelcomeViewState.issue,
  });
}

async function openDesktopWelcomeWindow(options: OpenDesktopWelcomeOptions = {}): Promise<void> {
  desktopWelcomeViewState = {
    surface: options.surface ?? 'connect_environment',
    entryReason: options.entryReason ?? (currentSessionTarget ? 'switch_device' : 'app_launch'),
    issue: options.issue ?? null,
  };
  await loadURLInMainWindow(
    desktopWelcomePageURL(),
    'welcome',
    { stealAppFocus: options.stealAppFocus },
  );
}

async function openAdvancedSettingsWindow(returnSurface: 'welcome' | 'current_target' = 'current_target'): Promise<void> {
  settingsReturnSurface = returnSurface;
  await openDesktopWelcomeWindow({
    surface: 'this_device_settings',
    entryReason: desktopWelcomeViewState.entryReason,
    stealAppFocus: true,
  });
}

async function returnMainWindowToCurrentTarget(options?: Readonly<{ stealAppFocus?: boolean }>): Promise<void> {
  if (!currentSessionTarget || !allowedBaseURL) {
    await openDesktopWelcomeWindow({
      entryReason: 'app_launch',
      stealAppFocus: options?.stealAppFocus,
    });
    return;
  }
  await loadURLInMainWindow(allowedBaseURL, 'target', options);
}

async function prepareExternalTarget(targetURL: string): Promise<PreparedExternalTargetResult> {
  try {
    const startup = await loadExternalLocalUIStartup(targetURL);
    if (!startup) {
      return {
        ok: false,
        entryReason: 'connect_failed',
        issue: buildRemoteConnectionIssue(
          targetURL,
          'external_target_unreachable',
          'Desktop could not reach that Redeven Environment. Make sure the target host is exposing Redeven Local UI and that its port is reachable from this machine.',
        ),
      };
    }
    return {
      ok: true,
      startup,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      entryReason: 'connect_failed',
      issue: buildRemoteConnectionIssue(
        targetURL,
        'external_target_invalid',
        message || 'Desktop target is invalid.',
      ),
    };
  }
}

async function activateExternalTarget(startup: StartupReport, preferences: DesktopPreferences): Promise<void> {
  managedAgent = null;
  externalTargetStartup = startup;
  currentSessionTarget = {
    kind: 'external_local_ui',
    external_local_ui_url: startup.local_ui_url,
  };
  allowedBaseURL = startup.local_ui_url;

  const nextPreferences = rememberRecentExternalLocalUITarget(preferences, startup.local_ui_url);
  await persistDesktopPreferences(nextPreferences);

  await desktopDiagnostics.configureRuntime(startup, allowedBaseURL);
  await desktopDiagnostics.recordLifecycle(
    'external_target_connected',
    'desktop connected to an external Redeven Local UI target',
    {
      target_url: startup.local_ui_url,
    },
  );
}

async function prepareManagedTarget(preferences: DesktopPreferences): Promise<PreparedManagedTargetResult> {
  const executablePath = resolveBundledAgentPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  const launch = await startManagedAgent({
    executablePath,
    agentArgs: buildDesktopAgentArgs(preferences),
    env: buildDesktopAgentEnvironment(preferences),
    passwordStdin: preferences.local_ui_password,
    tempRoot: app.getPath('temp'),
    onLog: (stream, chunk) => {
      const text = String(chunk ?? '').trim();
      if (!text) {
        return;
      }
      console.log(`[redeven:${stream}] ${text}`);
    },
  });
  if (launch.kind === 'blocked') {
    return {
      ok: false,
      entryReason: 'blocked',
      issue: buildBlockedLaunchIssue(launch.blocked),
    };
  }
  return {
    ok: true,
    launch,
  };
}

async function activateManagedTarget(launch: ManagedTargetLaunch, preferences: DesktopPreferences): Promise<void> {
  if (launchStartedFreshManagedRuntime(launch) && preferences.pending_bootstrap) {
    await persistDesktopPreferences(clearPendingBootstrap(preferences));
  }

  managedAgent = launch.managedAgent;
  externalTargetStartup = null;
  currentSessionTarget = {
    kind: 'managed_local',
  };
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
}

async function openThisDeviceFromWelcome(): Promise<void> {
  if (currentSessionTarget?.kind === 'managed_local' && allowedBaseURL) {
    await returnMainWindowToCurrentTarget({ stealAppFocus: true });
    return;
  }

  const preferences = await loadDesktopPreferencesCached();
  const prepared = await prepareManagedTarget(preferences);
  if (!prepared.ok) {
    await openDesktopWelcomeWindow({
      entryReason: prepared.entryReason,
      issue: prepared.issue,
      stealAppFocus: true,
    });
    return;
  }
  if (currentSessionTarget?.kind === 'external_local_ui') {
    await disconnectCurrentTarget();
  }
  await activateManagedTarget(prepared.launch, preferences);
  await loadURLInMainWindow(prepared.launch.managedAgent.startup.local_ui_url, 'target');
}

async function openRemoteDeviceFromWelcome(targetURL: string): Promise<void> {
  const normalizedTargetURL = String(targetURL ?? '').trim();
  if (!normalizedTargetURL) {
    throw new Error('Environment URL is required to open another Environment.');
  }
  if (
    currentSessionTarget?.kind === 'external_local_ui'
    && currentSessionTarget.external_local_ui_url === normalizedTargetURL
    && allowedBaseURL
  ) {
    await returnMainWindowToCurrentTarget({ stealAppFocus: true });
    return;
  }

  const preferences = await loadDesktopPreferencesCached();
  const prepared = await prepareExternalTarget(normalizedTargetURL);
  if (!prepared.ok) {
    await openDesktopWelcomeWindow({
      entryReason: prepared.entryReason,
      issue: prepared.issue,
      stealAppFocus: true,
    });
    return;
  }
  if (currentSessionTarget) {
    await disconnectCurrentTarget();
  }
  await activateExternalTarget(prepared.startup, preferences);
  await loadURLInMainWindow(prepared.startup.local_ui_url, 'target');
}

async function closeSettingsSurface(): Promise<void> {
  if (settingsReturnSurface === 'current_target' && currentSessionTarget) {
    await returnMainWindowToCurrentTarget({ stealAppFocus: true });
    return;
  }
  await openDesktopWelcomeWindow({
    entryReason: currentSessionTarget ? 'switch_device' : 'app_launch',
    stealAppFocus: true,
  });
}

async function upsertSavedEnvironmentFromWelcome(
  environmentID: string,
  label: string,
  externalLocalUIURL: string,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const existing = preferences.saved_environments.find((environment) => environment.id === environmentID);
  const next = upsertSavedEnvironment(preferences, {
    environment_id: environmentID,
    label,
    local_ui_url: externalLocalUIURL,
    last_used_at_ms: existing?.last_used_at_ms ?? Date.now(),
  });
  await persistDesktopPreferences(next);
}

async function deleteSavedEnvironmentFromWelcome(environmentID: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const next = deleteSavedEnvironment(preferences, environmentID);
  await persistDesktopPreferences(next);
}

async function performDesktopLauncherAction(request: DesktopLauncherActionRequest): Promise<void> {
  switch (request.kind) {
    case 'open_this_device':
      await openThisDeviceFromWelcome();
      return;
    case 'open_remote_device':
      await openRemoteDeviceFromWelcome(request.external_local_ui_url);
      return;
    case 'upsert_saved_environment':
      await upsertSavedEnvironmentFromWelcome(request.environment_id, request.label, request.external_local_ui_url);
      return;
    case 'delete_saved_environment':
      await deleteSavedEnvironmentFromWelcome(request.environment_id);
      return;
    case 'return_to_current_device':
      if (currentSessionTarget) {
        await returnMainWindowToCurrentTarget({ stealAppFocus: true });
        return;
      }
      await requestQuit();
      return;
    default: {
      const exhaustive: never = request;
      throw new Error(`Unsupported desktop launcher action: ${JSON.stringify(exhaustive)}`);
    }
  }
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
    if (isAllowedAppNavigation(url, allowedBaseURL)) {
      createBrowserWindow(url, win, nextFrameName);
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

  void desktopDiagnostics.recordLifecycle('window_created', 'browser window created', { role: windowRole });
  webContents.on('did-start-loading', () => {
    void desktopDiagnostics.recordLifecycle('loading_started', 'browser window started loading', { role: windowRole });
  });
  webContents.on('did-finish-load', () => {
    void desktopDiagnostics.recordLifecycle('loading_finished', 'browser window finished loading', {
      role: windowRole,
      url: webContents.getURL(),
    });
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

async function ensureMainWindowCreated(): Promise<BrowserWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  if (currentSessionTarget && allowedBaseURL) {
    mainWindow = createMainBrowserWindow(allowedBaseURL);
    return mainWindow;
  }
  await openDesktopWelcomeWindow({ entryReason: 'app_launch' });
  if (!mainWindow) {
    throw new Error('main window was not created');
  }
  return mainWindow;
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
  currentSessionTarget = null;
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      focusMainWindow({ stealAppFocus: true });
      return;
    }
    if (currentSessionTarget && allowedBaseURL) {
      void returnMainWindowToCurrentTarget({ stealAppFocus: true });
      return;
    }
    void openDesktopWelcomeWindow({ entryReason: 'app_launch', stealAppFocus: true });
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
      const previous = await loadDesktopPreferencesCached();
      const validated = validateDesktopSettingsDraft(draft);
      const next: DesktopPreferences = {
        ...validated,
        saved_environments: previous.saved_environments,
        recent_external_local_ui_urls: previous.recent_external_local_ui_urls,
      };
      await persistDesktopPreferences(next);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle(DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL, async () => buildCurrentDesktopWelcomeSnapshot());
  ipcMain.handle(DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL, async (_event, request) => {
    const normalized = normalizeDesktopLauncherActionRequest(request);
    if (!normalized) {
      throw new Error('Invalid desktop launcher action.');
    }
    await performDesktopLauncherAction(normalized);
  });
  ipcMain.handle(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, async (_event, request) => {
    const normalized = normalizeDesktopShellOpenWindowRequest(request);
    if (!normalized) {
      return;
    }

    if (normalized.kind === 'connection_center') {
      await openDesktopWelcomeWindow({
        entryReason: currentSessionTarget ? 'switch_device' : 'app_launch',
        stealAppFocus: true,
      });
      return;
    }

    await openAdvancedSettingsWindow('current_target');
  });
  ipcMain.on(CANCEL_DESKTOP_SETTINGS_CHANNEL, () => {
    void closeSettingsSurface();
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
      openConnectionCenter: () => {
        void openDesktopWelcomeWindow({
          entryReason: currentSessionTarget ? 'switch_device' : 'app_launch',
          stealAppFocus: true,
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          dialog.showErrorBox('Redeven Desktop failed to open the launcher', message || 'Unknown launcher error.');
        });
      },
      openAdvancedSettings: () => {
        void openAdvancedSettingsWindow('current_target').catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          dialog.showErrorBox('Redeven Desktop failed to open advanced options', message || 'Unknown advanced-options error.');
        });
      },
      requestQuit: () => {
        void requestQuit();
      },
    })));

    try {
      await openDesktopWelcomeWindow({ entryReason: 'app_launch' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to start', message || 'Unknown startup error.');
      app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      focusMainWindow();
      return;
    }
    if (currentSessionTarget && allowedBaseURL) {
      void returnMainWindowToCurrentTarget().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        dialog.showErrorBox('Redeven Desktop failed to restore the current Environment', message || 'Unknown restore error.');
        app.quit();
      });
      return;
    }
    void openDesktopWelcomeWindow({ entryReason: 'app_launch' }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to restore the launcher', message || 'Unknown restore error.');
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
