import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, session, shell, type MessageBoxOptions } from 'electron';
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
import {
  buildExternalLocalUIDesktopTarget,
  buildManagedLocalDesktopTarget,
  desktopSessionStateKeyFragment,
  externalLocalUIDesktopSessionKey,
  managedLocalDesktopSessionKey,
  type DesktopSessionKey,
  type DesktopSessionSummary,
  type DesktopSessionTarget,
} from './desktopTarget';
import { buildDesktopAgentArgs, buildDesktopAgentEnvironment } from './desktopLaunch';
import { parseLocalUIBind } from './localUIBind';
import {
  buildBlockedLaunchIssue,
  buildDesktopWelcomeSnapshot,
  buildRemoteConnectionIssue,
  type BuildDesktopWelcomeSnapshotArgs,
} from './desktopWelcomeState';
import { defaultDesktopStateStorePath, DesktopStateStore } from './desktopStateStore';
import { DesktopThemeState } from './desktopThemeState';
import { DesktopDiagnosticsRecorder } from './diagnostics';
import { isAllowedAppNavigation } from './navigation';
import { resolveBrowserPreloadPath, resolveBundledAgentPath, resolveWelcomeRendererPath } from './paths';
import { loadExternalLocalUIStartup } from './runtimeState';
import { installStdioBrokenPipeGuards } from './stdio';
import type { StartupReport } from './startup';
import {
  applyRestoredWindowState,
  attachDesktopWindowStatePersistence,
  restoreBrowserWindowBounds,
} from './windowState';
import { resolveDesktopWindowSpec } from './windowSpec';
import { buildDesktopWindowChromeOptions } from './windowChrome';
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
  DESKTOP_THEME_GET_SNAPSHOT_CHANNEL,
  DESKTOP_THEME_SET_SOURCE_CHANNEL,
} from '../shared/desktopThemeIPC';
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
  DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL,
  normalizeDesktopShellRuntimeActionRequest,
  type DesktopShellRuntimeActionResponse,
} from '../shared/desktopShellRuntimeIPC';
import {
  DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL,
  normalizeDesktopShellOpenExternalURLRequest,
  type DesktopShellOpenExternalURLResponse,
} from '../shared/desktopShellExternalURLIPC';
import {
  DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL,
  DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL,
  DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL,
  normalizeDesktopLauncherActionRequest,
  type DesktopLauncherActionRequest,
  type DesktopLauncherActionResult,
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

type DesktopUtilityWindowKind = 'launcher' | 'local_environment_settings';

type DesktopUtilityWindowState = Readonly<{
  surface: DesktopLauncherSurface;
  entryReason: DesktopWelcomeEntryReason;
  issue: DesktopWelcomeIssue | null;
}>;

type DesktopSessionRecord = {
  session_key: DesktopSessionKey;
  target: DesktopSessionTarget;
  startup: StartupReport;
  allowed_base_url: string;
  root_window: BrowserWindow;
  child_windows: Map<string, BrowserWindow>;
  diagnostics: DesktopDiagnosticsRecorder;
  pending_handoffs: DesktopAskFlowerHandoffPayload[];
  managed_agent: ManagedAgent | null;
  closing: boolean;
};

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

type CreateBrowserWindowArgs = Readonly<{
  targetURL: string;
  stateKey: string;
  role: 'launcher' | 'settings' | 'session_root' | 'session_child';
  parent?: BrowserWindow;
  frameName?: string;
  diagnostics?: DesktopDiagnosticsRecorder | null;
  stealAppFocus?: boolean;
  onWindowOpen?: (url: string, parent: BrowserWindow, frameName: string) => void;
  onWillNavigate?: (url: string, event: Electron.Event) => void;
  onDidFinishLoad?: (win: BrowserWindow) => void;
  onClosed?: (win: BrowserWindow) => void;
}>;

const utilityWindows = new Map<DesktopUtilityWindowKind, BrowserWindow>();
const utilityWindowState = new Map<DesktopUtilityWindowKind, DesktopUtilityWindowState>([
  ['launcher', { surface: 'connect_environment', entryReason: 'app_launch', issue: null }],
  ['local_environment_settings', { surface: 'local_environment_settings', entryReason: 'app_launch', issue: null }],
]);
const utilityWindowKindByWebContentsID = new Map<number, DesktopUtilityWindowKind>();
const sessionsByKey = new Map<DesktopSessionKey, DesktopSessionRecord>();
const sessionKeyByWebContentsID = new Map<number, DesktopSessionKey>();
const sessionCloseTasks = new Map<DesktopSessionKey, Promise<void>>();
const windowStateCleanup = new Map<BrowserWindow, () => void>();
let lastFocusedSessionKey: DesktopSessionKey | null = null;
let quitPhase: 'idle' | 'requested' | 'shutting_down' = 'idle';
let desktopPreferencesCache: DesktopPreferences | null = null;
let desktopStateStoreCache: DesktopStateStore | null = null;
let desktopThemeStateCache: DesktopThemeState | null = null;
const desktopDevToolsEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.REDEVEN_DESKTOP_OPEN_DEVTOOLS ?? '').trim().toLowerCase(),
);

installStdioBrokenPipeGuards();

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

function desktopThemeState(): DesktopThemeState {
  if (!desktopThemeStateCache) {
    desktopThemeStateCache = new DesktopThemeState(desktopStateStore(), nativeTheme, process.platform);
  }
  desktopThemeStateCache.initialize();
  return desktopThemeStateCache;
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

function syncOpenSessionTargetsWithPreferences(preferences: DesktopPreferences): void {
  const savedLabelByURL = new Map(
    preferences.saved_environments.map((environment) => [environment.local_ui_url, environment.label]),
  );
  for (const session of sessionsByKey.values()) {
    if (session.target.kind !== 'external_local_ui') {
      continue;
    }
    const savedLabel = savedLabelByURL.get(session.startup.local_ui_url);
    if (!savedLabel || savedLabel === session.target.label) {
      continue;
    }
    session.target = {
      ...session.target,
      label: savedLabel,
    };
  }
}

async function persistDesktopPreferences(next: DesktopPreferences): Promise<void> {
  desktopPreferencesCache = next;
  syncOpenSessionTargetsWithPreferences(next);
  await saveDesktopPreferences(preferencesPaths(), next, preferencesCodec());
  broadcastDesktopWelcomeSnapshots();
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

async function openExternalURL(url: string): Promise<void> {
  if (!url || url === 'about:blank') {
    return;
  }
  await shell.openExternal(url);
}

function openExternal(url: string): void {
  void openExternalURL(url);
}

function currentUtilityWindowState(kind: DesktopUtilityWindowKind): DesktopUtilityWindowState {
  return utilityWindowState.get(kind) ?? {
    surface: kind === 'launcher' ? 'connect_environment' : 'local_environment_settings',
    entryReason: openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch',
    issue: null,
  };
}

function setUtilityWindowState(kind: DesktopUtilityWindowKind, next: DesktopUtilityWindowState): void {
  utilityWindowState.set(kind, next);
}

function currentParentWindow(): BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }
  for (const kind of ['launcher', 'local_environment_settings'] as const) {
    const utilityWindow = utilityWindows.get(kind);
    if (utilityWindow && !utilityWindow.isDestroyed()) {
      return utilityWindow;
    }
  }
  const focusedSession = lastFocusedSessionKey ? sessionsByKey.get(lastFocusedSessionKey) ?? null : null;
  if (focusedSession && !focusedSession.root_window.isDestroyed()) {
    return focusedSession.root_window;
  }
  const firstSession = sessionsByKey.values().next().value as DesktopSessionRecord | undefined;
  if (firstSession && !firstSession.root_window.isDestroyed()) {
    return firstSession.root_window;
  }
  return undefined;
}

async function requestQuit(): Promise<void> {
  if (quitPhase !== 'idle') {
    return;
  }

  const options: MessageBoxOptions = {
    type: 'question',
    buttons: ['Cancel', 'Quit'],
    defaultId: 1,
    cancelId: 0,
    title: 'Quit Redeven Desktop?',
    message: 'Quit Redeven Desktop?',
    detail: 'All open environment windows will close, and any desktop-managed Redeven process started by this app will stop.',
    normalizeAccessKeys: true,
  };
  const parentWindow = currentParentWindow();
  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response !== 1) {
    return;
  }

  quitPhase = 'requested';
  app.quit();
}

function desktopWelcomePageURL(): string {
  return pathToFileURL(resolveWelcomeRendererPath({ appPath: app.getAppPath() })).toString();
}

function utilityWindowStateKey(kind: DesktopUtilityWindowKind): string {
  return kind === 'launcher' ? 'window:launcher' : 'window:settings';
}

function sessionWindowStateKey(sessionKey: DesktopSessionKey): string {
  return `window:session:${desktopSessionStateKeyFragment(sessionKey)}`;
}

function childWindowIdentity(frameName: string, targetURL: string): string {
  const cleanFrameName = String(frameName ?? '').trim();
  if (cleanFrameName !== '') {
    return cleanFrameName;
  }
  try {
    const url = new URL(targetURL);
    const detachedSurface = String(url.searchParams.get('redeven_detached_surface') ?? '').trim();
    return detachedSurface !== ''
      ? `detached:${detachedSurface}:${url.pathname}`
      : `detached:${url.pathname}${url.search}`;
  } catch {
    return `detached:${targetURL}`;
  }
}

function sessionChildWindowStateKey(sessionKey: DesktopSessionKey, childKey: string): string {
  return `window:session:${desktopSessionStateKeyFragment(sessionKey)}:child:${encodeURIComponent(childKey)}`;
}

function openSessionSummaries(): readonly DesktopSessionSummary[] {
  return [...sessionsByKey.values()].map((session) => ({
    session_key: session.session_key,
    target: session.target,
    startup: session.startup,
  }));
}

async function buildCurrentDesktopWelcomeSnapshot(
  kind: DesktopUtilityWindowKind,
  overrides: Partial<Pick<BuildDesktopWelcomeSnapshotArgs, 'entryReason' | 'issue'>> = {},
) {
  const preferences = await loadDesktopPreferencesCached();
  const state = currentUtilityWindowState(kind);
  return buildDesktopWelcomeSnapshot({
    preferences,
    openSessions: openSessionSummaries(),
    surface: state.surface,
    entryReason: overrides.entryReason ?? state.entryReason,
    issue: overrides.issue ?? state.issue,
  });
}

function liveUtilityWindow(kind: DesktopUtilityWindowKind): BrowserWindow | null {
  const win = utilityWindows.get(kind) ?? null;
  if (!win || win.isDestroyed()) {
    utilityWindows.delete(kind);
    return null;
  }
  return win;
}

function liveSession(sessionKey: DesktopSessionKey): DesktopSessionRecord | null {
  const sessionRecord = sessionsByKey.get(sessionKey) ?? null;
  if (!sessionRecord || sessionRecord.root_window.isDestroyed()) {
    return null;
  }
  return sessionRecord;
}

function focusUtilityWindow(kind: DesktopUtilityWindowKind, options?: Readonly<{ stealAppFocus?: boolean }>): boolean {
  const win = liveUtilityWindow(kind);
  if (!win) {
    return false;
  }
  presentAppWindow(win, options);
  return true;
}

function focusEnvironmentSession(sessionKey: DesktopSessionKey, options?: Readonly<{ stealAppFocus?: boolean }>): boolean {
  const sessionRecord = liveSession(sessionKey);
  if (!sessionRecord) {
    return false;
  }
  lastFocusedSessionKey = sessionKey;
  presentAppWindow(sessionRecord.root_window, options);
  return true;
}

async function emitDesktopWelcomeSnapshot(kind: DesktopUtilityWindowKind): Promise<void> {
  const win = liveUtilityWindow(kind);
  if (!win || win.webContents.isDestroyed()) {
    return;
  }
  const snapshot = await buildCurrentDesktopWelcomeSnapshot(kind);
  win.webContents.send(DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL, snapshot);
}

function broadcastDesktopWelcomeSnapshots(): void {
  for (const kind of ['launcher', 'local_environment_settings'] as const) {
    void emitDesktopWelcomeSnapshot(kind);
  }
}

function setLauncherViewState(options: OpenDesktopWelcomeOptions = {}): DesktopUtilityWindowState {
  const nextState: DesktopUtilityWindowState = {
    surface: 'connect_environment',
    entryReason: options.entryReason ?? (openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch'),
    issue: options.issue ?? null,
  };
  setUtilityWindowState('launcher', nextState);
  return nextState;
}

function setSettingsViewState(options: OpenDesktopWelcomeOptions = {}): DesktopUtilityWindowState {
  const nextState: DesktopUtilityWindowState = {
    surface: 'local_environment_settings',
    entryReason: options.entryReason ?? (openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch'),
    issue: null,
  };
  setUtilityWindowState('local_environment_settings', nextState);
  return nextState;
}

function resetLauncherIssueState(): void {
  setLauncherViewState({
    entryReason: openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch',
    issue: null,
  });
}

function recordWindowLifecycle(
  diagnostics: DesktopDiagnosticsRecorder | null | undefined,
  kind: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  if (!diagnostics) {
    return;
  }
  void diagnostics.recordLifecycle(kind, message, detail);
}

function createBrowserWindow(args: CreateBrowserWindowArgs): BrowserWindow {
  const spec = resolveDesktopWindowSpec(args.targetURL, Boolean(args.parent));
  const attachToParent = Boolean(args.parent) && spec.attachToParent !== false;
  const actualParent = attachToParent ? args.parent : undefined;
  const browserPreloadPath = resolveBrowserPreloadPath({ appPath: app.getAppPath() });
  const themeSnapshot = desktopThemeState().getSnapshot();
  const restoredState = desktopStateStore().getWindowState(args.stateKey);
  const restoredBounds = restoreBrowserWindowBounds(spec, desktopStateStore(), args.stateKey);
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
    ...buildDesktopWindowChromeOptions(process.platform, themeSnapshot.window),
    parent: actualParent,
    webPreferences: {
      preload: browserPreloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  desktopThemeState().registerWindow(win);
  applyRestoredWindowState(win, restoredState);
  registerWindowStatePersistence(win, args.stateKey);
  recordWindowLifecycle(args.diagnostics, 'window_created', 'browser window created', { role: args.role });

  if (args.onWindowOpen) {
    win.webContents.setWindowOpenHandler(({ url, frameName }) => {
      args.onWindowOpen?.(url, win, frameName);
      return { action: 'deny' };
    });
  }
  if (args.onWillNavigate) {
    win.webContents.on('will-navigate', (event, url) => {
      args.onWillNavigate?.(url, event);
    });
  }

  win.webContents.on('did-start-loading', () => {
    recordWindowLifecycle(args.diagnostics, 'loading_started', 'browser window started loading', { role: args.role });
  });
  win.webContents.on('did-finish-load', () => {
    recordWindowLifecycle(args.diagnostics, 'loading_finished', 'browser window finished loading', {
      role: args.role,
      url: win.webContents.getURL(),
    });
    args.onDidFinishLoad?.(win);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    recordWindowLifecycle(args.diagnostics, 'loading_failed', errorDescription || 'browser window failed to load', {
      role: args.role,
      url: validatedURL,
      error_code: errorCode,
      main_frame: isMainFrame,
    });
  });

  if (desktopDevToolsEnabled && !args.parent) {
    win.webContents.on('did-finish-load', () => {
      if (!win.webContents.isDestroyed() && !win.webContents.isDevToolsOpened()) {
        win.webContents.openDevTools({ mode: 'detach', activate: false });
      }
    });
  }

  win.once('ready-to-show', () => {
    presentAppWindow(win, { stealAppFocus: args.stealAppFocus });
    recordWindowLifecycle(args.diagnostics, 'ready_to_show', 'browser window is ready to show', { role: args.role });
  });
  win.on('closed', () => {
    cleanupWindowStatePersistence(win);
    recordWindowLifecycle(args.diagnostics, 'window_closed', 'browser window closed', { role: args.role });
    args.onClosed?.(win);
  });

  void win.loadURL(args.targetURL);
  return win;
}

function isAllowedSessionNavigation(sessionKey: DesktopSessionKey, targetURL: string): boolean {
  const sessionRecord = sessionsByKey.get(sessionKey);
  if (!sessionRecord) {
    return false;
  }
  return isAllowedAppNavigation(targetURL, sessionRecord.allowed_base_url);
}

function openSessionChildWindow(
  sessionKey: DesktopSessionKey,
  targetURL: string,
  parent: BrowserWindow,
  frameName = '',
): BrowserWindow | null {
  const sessionRecord = sessionsByKey.get(sessionKey);
  if (!sessionRecord) {
    return null;
  }

  const childKey = childWindowIdentity(frameName, targetURL);
  const existing = sessionRecord.child_windows.get(childKey);
  if (existing && !existing.isDestroyed()) {
    void existing.loadURL(targetURL);
    presentAppWindow(existing);
    return existing;
  }

  const childWindow = createBrowserWindow({
    targetURL,
    parent,
    frameName,
    stateKey: sessionChildWindowStateKey(sessionKey, childKey),
    role: 'session_child',
    diagnostics: sessionRecord.diagnostics,
    onWindowOpen: (nextURL, nextParent, nextFrameName) => {
      if (isAllowedSessionNavigation(sessionKey, nextURL)) {
        openSessionChildWindow(sessionKey, nextURL, nextParent, nextFrameName);
      } else {
        openExternal(nextURL);
      }
    },
    onWillNavigate: (nextURL, event) => {
      if (isAllowedSessionNavigation(sessionKey, nextURL)) {
        return;
      }
      event.preventDefault();
      openExternal(nextURL);
    },
    onClosed: () => {
      sessionRecord.child_windows.delete(childKey);
      sessionKeyByWebContentsID.delete(childWindow.webContents.id);
    },
  });

  sessionRecord.child_windows.set(childKey, childWindow);
  sessionKeyByWebContentsID.set(childWindow.webContents.id, sessionKey);
  return childWindow;
}

function flushPendingSessionAskFlowerHandoffs(sessionKey: DesktopSessionKey): void {
  const sessionRecord = sessionsByKey.get(sessionKey);
  if (!sessionRecord || sessionRecord.root_window.isDestroyed()) {
    return;
  }
  if (sessionRecord.root_window.webContents.isLoadingMainFrame() || sessionRecord.pending_handoffs.length <= 0) {
    return;
  }

  const queue = sessionRecord.pending_handoffs.splice(0, sessionRecord.pending_handoffs.length);
  for (const payload of queue) {
    sessionRecord.root_window.webContents.send(DESKTOP_ASK_FLOWER_HANDOFF_DELIVER_CHANNEL, payload);
  }
}

function queueSessionAskFlowerHandoff(sessionKey: DesktopSessionKey, payload: DesktopAskFlowerHandoffPayload): void {
  const sessionRecord = sessionsByKey.get(sessionKey);
  if (!sessionRecord) {
    return;
  }
  sessionRecord.pending_handoffs.push(payload);
  flushPendingSessionAskFlowerHandoffs(sessionKey);
}

async function handoffAskFlowerToOwningSession(senderWebContentsID: number, payload: DesktopAskFlowerHandoffPayload): Promise<void> {
  const sessionKey = sessionKeyByWebContentsID.get(senderWebContentsID);
  if (!sessionKey) {
    return;
  }
  queueSessionAskFlowerHandoff(sessionKey, payload);
  focusEnvironmentSession(sessionKey, { stealAppFocus: true });
}

function createSessionRootWindow(
  sessionKey: DesktopSessionKey,
  targetURL: string,
  diagnostics: DesktopDiagnosticsRecorder,
  options?: Readonly<{ stealAppFocus?: boolean }>,
): BrowserWindow {
  return createBrowserWindow({
    targetURL,
    stateKey: sessionWindowStateKey(sessionKey),
    role: 'session_root',
    diagnostics,
    stealAppFocus: options?.stealAppFocus,
    onWindowOpen: (nextURL, parent, frameName) => {
      if (isAllowedSessionNavigation(sessionKey, nextURL)) {
        openSessionChildWindow(sessionKey, nextURL, parent, frameName);
      } else {
        openExternal(nextURL);
      }
    },
    onWillNavigate: (nextURL, event) => {
      if (isAllowedSessionNavigation(sessionKey, nextURL)) {
        return;
      }
      event.preventDefault();
      openExternal(nextURL);
    },
  });
}

async function createSessionRecord(
  target: DesktopSessionTarget,
  startup: StartupReport,
  options: Readonly<{
    managedAgent?: ManagedAgent | null;
    stealAppFocus?: boolean;
  }> = {},
): Promise<DesktopSessionRecord> {
  const diagnostics = new DesktopDiagnosticsRecorder();
  await diagnostics.configureRuntime(startup, startup.local_ui_url);

  const rootWindow = createSessionRootWindow(target.session_key, startup.local_ui_url, diagnostics, {
    stealAppFocus: options.stealAppFocus,
  });
  const sessionRecord: DesktopSessionRecord = {
    session_key: target.session_key,
    target,
    startup,
    allowed_base_url: startup.local_ui_url,
    root_window: rootWindow,
    child_windows: new Map(),
    diagnostics,
    pending_handoffs: [],
    managed_agent: options.managedAgent ?? null,
    closing: false,
  };

  sessionsByKey.set(target.session_key, sessionRecord);
  sessionKeyByWebContentsID.set(rootWindow.webContents.id, target.session_key);
  rootWindow.on('focus', () => {
    lastFocusedSessionKey = target.session_key;
  });
  rootWindow.on('closed', () => {
    sessionKeyByWebContentsID.delete(rootWindow.webContents.id);
    void finalizeSessionClosure(target.session_key);
  });
  rootWindow.webContents.on('did-finish-load', () => {
    flushPendingSessionAskFlowerHandoffs(target.session_key);
  });

  recordWindowLifecycle(
    diagnostics,
    target.kind === 'managed_local' ? 'agent_started' : 'external_target_connected',
    target.kind === 'managed_local'
      ? 'desktop opened a managed Local Environment session'
      : 'desktop connected to an external Redeven Local UI target',
    {
      target_url: startup.local_ui_url,
      attached: options.managedAgent?.attached === true,
      effective_run_mode: startup.effective_run_mode ?? '',
    },
  );
  broadcastDesktopWelcomeSnapshots();
  return sessionRecord;
}

async function finalizeSessionClosure(
  sessionKey: DesktopSessionKey,
  options: Readonly<{ closeWindows?: boolean }> = {},
): Promise<void> {
  const existingTask = sessionCloseTasks.get(sessionKey);
  if (existingTask) {
    return existingTask;
  }

  const sessionRecord = sessionsByKey.get(sessionKey);
  if (!sessionRecord) {
    return;
  }

  const task = (async () => {
    sessionRecord.closing = true;
    sessionsByKey.delete(sessionKey);
    if (lastFocusedSessionKey === sessionKey) {
      lastFocusedSessionKey = null;
    }

    sessionKeyByWebContentsID.delete(sessionRecord.root_window.webContents.id);
    for (const childWindow of sessionRecord.child_windows.values()) {
      sessionKeyByWebContentsID.delete(childWindow.webContents.id);
      if (options.closeWindows !== false && !childWindow.isDestroyed()) {
        childWindow.destroy();
      }
    }
    sessionRecord.child_windows.clear();

    if (options.closeWindows !== false && !sessionRecord.root_window.isDestroyed()) {
      sessionRecord.root_window.destroy();
    }

    broadcastDesktopWelcomeSnapshots();
    recordWindowLifecycle(
      sessionRecord.diagnostics,
      'session_closed',
      'desktop closed an environment session',
      {
        session_key: sessionRecord.session_key,
        target_kind: sessionRecord.target.kind,
      },
    );

    const managedAgent = sessionRecord.managed_agent;
    sessionRecord.managed_agent = null;
    sessionRecord.diagnostics.clearRuntime();
    if (managedAgent) {
      await managedAgent.stop();
    }
  })().finally(() => {
    sessionCloseTasks.delete(sessionKey);
  });

  sessionCloseTasks.set(sessionKey, task);
  await task;
}

async function closeUtilityWindow(kind: DesktopUtilityWindowKind): Promise<void> {
  const win = liveUtilityWindow(kind);
  if (!win) {
    return;
  }
  utilityWindows.delete(kind);
  utilityWindowKindByWebContentsID.delete(win.webContents.id);
  if (!win.isDestroyed()) {
    win.close();
  }
}

async function openUtilityWindow(
  kind: DesktopUtilityWindowKind,
  options: OpenDesktopWelcomeOptions = {},
): Promise<DesktopLauncherActionResult> {
  if (kind === 'launcher') {
    setLauncherViewState(options);
  } else {
    setSettingsViewState(options);
  }

  const existing = liveUtilityWindow(kind);
  if (existing) {
    await emitDesktopWelcomeSnapshot(kind);
    presentAppWindow(existing, { stealAppFocus: options.stealAppFocus });
    return {
      outcome: 'focused_utility_window',
      utility_window_kind: kind,
    };
  }

  const win = createBrowserWindow({
    targetURL: desktopWelcomePageURL(),
    stateKey: utilityWindowStateKey(kind),
    role: kind === 'launcher' ? 'launcher' : 'settings',
    stealAppFocus: options.stealAppFocus,
    onClosed: () => {
      utilityWindows.delete(kind);
      utilityWindowKindByWebContentsID.delete(win.webContents.id);
    },
  });

  utilityWindows.set(kind, win);
  utilityWindowKindByWebContentsID.set(win.webContents.id, kind);
  return {
    outcome: 'opened_utility_window',
    utility_window_kind: kind,
  };
}

async function openDesktopWelcomeWindow(options: OpenDesktopWelcomeOptions = {}): Promise<void> {
  if (options.surface === 'local_environment_settings') {
    await openUtilityWindow('local_environment_settings', options);
    return;
  }
  await openUtilityWindow('launcher', options);
}

async function openAdvancedSettingsWindow(): Promise<void> {
  await openUtilityWindow('local_environment_settings', { stealAppFocus: true });
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

type PrepareManagedTargetOptions = Readonly<{
  localUIBind?: string;
}>;

async function prepareManagedTarget(
  preferences: DesktopPreferences,
  options?: PrepareManagedTargetOptions,
): Promise<PreparedManagedTargetResult> {
  const executablePath = resolveBundledAgentPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  const launch = await startManagedAgent({
    executablePath,
    agentArgs: buildDesktopAgentArgs(preferences, { localUIBind: options?.localUIBind }),
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

function formatBindHostPort(host: string, port: number): string {
  const cleanHost = String(host ?? '').trim();
  if (!cleanHost || !Number.isInteger(port) || port <= 0) {
    throw new Error('invalid bind host/port');
  }
  if (cleanHost.includes(':') && !cleanHost.startsWith('[')) {
    return `[${cleanHost}]:${port}`;
  }
  return `${cleanHost}:${port}`;
}

function resolveManagedRestartBindOverride(preferences: DesktopPreferences, startup: StartupReport): string | null {
  try {
    const configuredBind = parseLocalUIBind(preferences.local_ui_bind);
    if (configuredBind.port !== 0) {
      return null;
    }

    const currentURL = new URL(startup.local_ui_url);
    const hostname = String(currentURL.hostname ?? '').trim();
    const port = Number.parseInt(String(currentURL.port ?? '').trim(), 10);
    if (!hostname || !Number.isInteger(port) || port <= 0) {
      return null;
    }
    return formatBindHostPort(hostname, port);
  } catch {
    return null;
  }
}

async function rememberRecentExternalTarget(rawURL: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(rememberRecentExternalLocalUITarget(preferences, rawURL));
}

async function openLocalEnvironmentFromLauncher(): Promise<DesktopLauncherActionResult> {
  const existingSession = liveSession(managedLocalDesktopSessionKey());
  if (existingSession) {
    resetLauncherIssueState();
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: true });
    broadcastDesktopWelcomeSnapshots();
    return {
      outcome: 'focused_environment_window',
      session_key: existingSession.session_key,
    };
  }

  const preferences = await loadDesktopPreferencesCached();
  const prepared = await prepareManagedTarget(preferences);
  if (!prepared.ok) {
    return openUtilityWindow('launcher', {
      entryReason: prepared.entryReason,
      issue: prepared.issue,
      stealAppFocus: true,
    });
  }

  if (launchStartedFreshManagedRuntime(prepared.launch) && preferences.pending_bootstrap) {
    await persistDesktopPreferences(clearPendingBootstrap(preferences));
  }

  const target = buildManagedLocalDesktopTarget();
  await createSessionRecord(target, prepared.launch.managedAgent.startup, {
    managedAgent: prepared.launch.managedAgent,
    stealAppFocus: true,
  });
  resetLauncherIssueState();
  broadcastDesktopWelcomeSnapshots();
  return {
    outcome: 'opened_environment_window',
    session_key: target.session_key,
  };
}

async function openRemoteEnvironmentFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_remote_environment' }>>,
): Promise<DesktopLauncherActionResult> {
  const normalizedTargetURL = String(request.external_local_ui_url ?? '').trim();
  if (!normalizedTargetURL) {
    throw new Error('Environment URL is required to open another Environment.');
  }

  const optimisticSessionKey = externalLocalUIDesktopSessionKey(normalizedTargetURL);
  const optimisticSession = liveSession(optimisticSessionKey);
  if (optimisticSession) {
    if (optimisticSession.target.kind === 'external_local_ui' && request.label) {
      optimisticSession.target = {
        ...optimisticSession.target,
        label: String(request.label).trim() || optimisticSession.target.label,
      };
    }
    resetLauncherIssueState();
    await rememberRecentExternalTarget(optimisticSession.startup.local_ui_url);
    focusEnvironmentSession(optimisticSession.session_key, { stealAppFocus: true });
    return {
      outcome: 'focused_environment_window',
      session_key: optimisticSession.session_key,
    };
  }

  const prepared = await prepareExternalTarget(normalizedTargetURL);
  if (!prepared.ok) {
    return openUtilityWindow('launcher', {
      entryReason: prepared.entryReason,
      issue: prepared.issue,
      stealAppFocus: true,
    });
  }

  const target = buildExternalLocalUIDesktopTarget(prepared.startup.local_ui_url, {
    environmentID: request.environment_id,
    label: request.label,
  });
  const existingSession = liveSession(target.session_key);
  if (existingSession) {
    existingSession.target = target;
    resetLauncherIssueState();
    await rememberRecentExternalTarget(existingSession.startup.local_ui_url);
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: true });
    broadcastDesktopWelcomeSnapshots();
    return {
      outcome: 'focused_environment_window',
      session_key: existingSession.session_key,
    };
  }

  await createSessionRecord(target, prepared.startup, { stealAppFocus: true });
  resetLauncherIssueState();
  await rememberRecentExternalTarget(prepared.startup.local_ui_url);
  return {
    outcome: 'opened_environment_window',
    session_key: target.session_key,
  };
}

async function focusEnvironmentWindow(sessionKey: string): Promise<DesktopLauncherActionResult> {
  const cleanSessionKey = String(sessionKey ?? '').trim() as DesktopSessionKey;
  if (!focusEnvironmentSession(cleanSessionKey, { stealAppFocus: true })) {
    throw new Error('That environment window is no longer open.');
  }
  resetLauncherIssueState();
  broadcastDesktopWelcomeSnapshots();
  return {
    outcome: 'focused_environment_window',
    session_key: cleanSessionKey,
  };
}

async function restartManagedRuntimeFromShell(): Promise<DesktopShellRuntimeActionResponse> {
  const sessionRecord = liveSession(managedLocalDesktopSessionKey());
  if (!sessionRecord || !sessionRecord.managed_agent) {
    return {
      ok: false,
      started: false,
      message: 'Managed runtime is not active.',
    };
  }

  const previousManagedAgent = sessionRecord.managed_agent;
  const preferences = await loadDesktopPreferencesCached();
  const localUIBind = resolveManagedRestartBindOverride(preferences, previousManagedAgent.startup) ?? undefined;

  for (const childWindow of sessionRecord.child_windows.values()) {
    sessionKeyByWebContentsID.delete(childWindow.webContents.id);
    if (!childWindow.isDestroyed()) {
      childWindow.close();
    }
  }
  sessionRecord.child_windows.clear();

  try {
    await sessionRecord.diagnostics.recordLifecycle(
      'target_restarting',
      'desktop requested a managed agent restart',
      {
        attached: previousManagedAgent.attached,
        local_ui_bind_override: localUIBind ?? '',
      },
    );
    await previousManagedAgent.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      started: false,
      message: message || 'Failed to stop the managed runtime.',
    };
  }

  sessionRecord.managed_agent = null;

  const prepared = await prepareManagedTarget(preferences, { localUIBind });
  if (!prepared.ok) {
    await finalizeSessionClosure(sessionRecord.session_key);
    await openUtilityWindow('launcher', {
      entryReason: prepared.entryReason,
      issue: prepared.issue,
      stealAppFocus: true,
    });
    return {
      ok: false,
      started: false,
      message: prepared.issue.message,
    };
  }

  if (launchStartedFreshManagedRuntime(prepared.launch) && preferences.pending_bootstrap) {
    await persistDesktopPreferences(clearPendingBootstrap(preferences));
  }

  sessionRecord.managed_agent = prepared.launch.managedAgent;
  sessionRecord.startup = prepared.launch.managedAgent.startup;
  sessionRecord.allowed_base_url = prepared.launch.managedAgent.startup.local_ui_url;
  sessionRecord.target = buildManagedLocalDesktopTarget();
  await sessionRecord.diagnostics.configureRuntime(sessionRecord.startup, sessionRecord.allowed_base_url);
  await sessionRecord.diagnostics.recordLifecycle(
    prepared.launch.managedAgent.attached ? 'agent_attached' : 'agent_started',
    prepared.launch.managedAgent.attached ? 'desktop attached to an existing agent runtime' : 'desktop restarted a managed agent runtime',
    {
      attached: prepared.launch.managedAgent.attached,
      spawned: prepared.launch.spawned,
      effective_run_mode: prepared.launch.managedAgent.startup.effective_run_mode ?? '',
    },
  );
  await sessionRecord.root_window.loadURL(sessionRecord.allowed_base_url);
  focusEnvironmentSession(sessionRecord.session_key, { stealAppFocus: true });
  broadcastDesktopWelcomeSnapshots();

  return {
    ok: true,
    started: true,
    message: 'Desktop restarted the managed runtime.',
  };
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
    source: 'saved',
    last_used_at_ms: existing?.last_used_at_ms ?? Date.now(),
  });
  await persistDesktopPreferences(next);
}

async function deleteSavedEnvironmentFromWelcome(environmentID: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(deleteSavedEnvironment(preferences, environmentID));
}

async function performDesktopLauncherAction(request: DesktopLauncherActionRequest): Promise<DesktopLauncherActionResult> {
  switch (request.kind) {
    case 'open_local_environment':
      return openLocalEnvironmentFromLauncher();
    case 'open_remote_environment':
      return openRemoteEnvironmentFromLauncher(request);
    case 'open_local_environment_settings':
      return openUtilityWindow('local_environment_settings', { stealAppFocus: true });
    case 'focus_environment_window':
      return focusEnvironmentWindow(request.session_key);
    case 'upsert_saved_environment':
      await upsertSavedEnvironmentFromWelcome(request.environment_id, request.label, request.external_local_ui_url);
      return {
        outcome: 'saved_environment',
      };
    case 'delete_saved_environment':
      await deleteSavedEnvironmentFromWelcome(request.environment_id);
      return {
        outcome: 'deleted_environment',
      };
    case 'close_launcher_or_quit':
      if (sessionsByKey.size <= 0) {
        await requestQuit();
        return {
          outcome: 'quit_app',
        };
      }
      await closeUtilityWindow('launcher');
      return {
        outcome: 'closed_launcher',
        utility_window_kind: 'launcher',
      };
    default: {
      const exhaustive: never = request;
      throw new Error(`Unsupported desktop launcher action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function senderUtilityWindowKind(webContentsID: number): DesktopUtilityWindowKind {
  return utilityWindowKindByWebContentsID.get(webContentsID) ?? 'launcher';
}

function sessionRecordForWebContentsID(webContentsID: number): DesktopSessionRecord | null {
  const sessionKey = sessionKeyByWebContentsID.get(webContentsID);
  if (!sessionKey) {
    return null;
  }
  return sessionsByKey.get(sessionKey) ?? null;
}

function installDesktopDiagnosticsHooks(): void {
  const webSession = session.defaultSession;
  webSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const sessionRecord = sessionRecordForWebContentsID((details as { webContentsId?: number }).webContentsId ?? -1);
    const requestHeaders = sessionRecord?.diagnostics.startRequest({
      requestID: details.id,
      method: details.method,
      url: details.url,
      requestHeaders: details.requestHeaders as Record<string, string | string[]>,
    });
    callback(requestHeaders ? { requestHeaders } : {});
  });
  webSession.webRequest.onCompleted((details) => {
    const sessionRecord = sessionRecordForWebContentsID((details as { webContentsId?: number }).webContentsId ?? -1);
    if (!sessionRecord) {
      return;
    }
    void sessionRecord.diagnostics.completeRequest({
      requestID: details.id,
      url: details.url,
      statusCode: details.statusCode,
      responseHeaders: details.responseHeaders as Record<string, string | string[]> | undefined,
      fromCache: details.fromCache,
    });
  });
  webSession.webRequest.onErrorOccurred((details) => {
    const sessionRecord = sessionRecordForWebContentsID((details as { webContentsId?: number }).webContentsId ?? -1);
    if (!sessionRecord) {
      return;
    }
    void sessionRecord.diagnostics.failRequest({
      requestID: details.id,
      url: details.url,
      error: details.error,
    });
  });
}

async function restoreBestAvailableWindow(options?: Readonly<{ stealAppFocus?: boolean }>): Promise<void> {
  if (focusUtilityWindow('launcher', options)) {
    return;
  }
  if (focusUtilityWindow('local_environment_settings', options)) {
    return;
  }
  if (lastFocusedSessionKey && focusEnvironmentSession(lastFocusedSessionKey, options)) {
    return;
  }
  const firstSession = sessionsByKey.values().next().value as DesktopSessionRecord | undefined;
  if (firstSession && focusEnvironmentSession(firstSession.session_key, options)) {
    return;
  }
  await openDesktopWelcomeWindow({ entryReason: 'app_launch', stealAppFocus: options?.stealAppFocus });
}

async function shutdownDesktopWindowsAndSessions(): Promise<void> {
  const sessionClosePromises = [...sessionsByKey.keys()].map((sessionKey) => finalizeSessionClosure(sessionKey));
  for (const kind of ['launcher', 'local_environment_settings'] as const) {
    const win = liveUtilityWindow(kind);
    if (!win) {
      continue;
    }
    utilityWindows.delete(kind);
    utilityWindowKindByWebContentsID.delete(win.webContents.id);
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
  await Promise.allSettled(sessionClosePromises);
  await Promise.allSettled([...sessionCloseTasks.values()]);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void restoreBestAvailableWindow({ stealAppFocus: true });
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
  ipcMain.on(DESKTOP_THEME_GET_SNAPSHOT_CHANNEL, (event) => {
    event.returnValue = desktopThemeState().getSnapshot();
  });
  ipcMain.on(DESKTOP_THEME_SET_SOURCE_CHANNEL, (event, source) => {
    event.returnValue = desktopThemeState().setSource(source);
  });

  ipcMain.handle(SAVE_DESKTOP_SETTINGS_CHANNEL, async (_event, draft: DesktopSettingsDraft): Promise<SaveDesktopSettingsResult> => {
    try {
      const previous = await loadDesktopPreferencesCached();
      const validated = validateDesktopSettingsDraft(draft, {
        currentLocalUIPassword: previous.local_ui_password,
        currentLocalUIPasswordConfigured: previous.local_ui_password_configured,
      });
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
  ipcMain.handle(DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL, async (event) => (
    buildCurrentDesktopWelcomeSnapshot(senderUtilityWindowKind(event.sender.id))
  ));
  ipcMain.handle(DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL, async (_event, request): Promise<DesktopLauncherActionResult> => {
    const normalized = normalizeDesktopLauncherActionRequest(request);
    if (!normalized) {
      throw new Error('Invalid desktop launcher action.');
    }
    return performDesktopLauncherAction(normalized);
  });
  ipcMain.handle(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, async (_event, request) => {
    const normalized = normalizeDesktopShellOpenWindowRequest(request);
    if (!normalized) {
      return;
    }

    if (normalized.kind === 'connection_center') {
      await openDesktopWelcomeWindow({
        entryReason: openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch',
        stealAppFocus: true,
      });
      return;
    }

    await openAdvancedSettingsWindow();
  });
  ipcMain.handle(DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL, async (_event, request): Promise<DesktopShellOpenExternalURLResponse> => {
    const normalized = normalizeDesktopShellOpenExternalURLRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Invalid external URL.',
      };
    }

    try {
      await openExternalURL(normalized.url);
      return {
        ok: true,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL, async (_event, request): Promise<DesktopShellRuntimeActionResponse> => {
    const normalized = normalizeDesktopShellRuntimeActionRequest(request);
    if (!normalized) {
      return {
        ok: false,
        started: false,
        message: 'Invalid desktop runtime action.',
      };
    }

    if (normalized.action === 'restart_managed_runtime') {
      return restartManagedRuntimeFromShell();
    }

    return {
      ok: false,
      started: false,
      message: 'Unsupported desktop runtime action.',
    };
  });
  ipcMain.on(CANCEL_DESKTOP_SETTINGS_CHANNEL, () => {
    void closeUtilityWindow('local_environment_settings');
  });
  ipcMain.on(DESKTOP_ASK_FLOWER_HANDOFF_REQUEST_CHANNEL, (event, payload) => {
    const normalized = normalizeDesktopAskFlowerHandoffPayload(payload);
    if (!normalized) {
      return;
    }
    void handoffAskFlowerToOwningSession(event.sender.id, normalized);
  });

  app.whenReady().then(async () => {
    installDesktopDiagnosticsHooks();
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate({
      openConnectionCenter: () => {
        void openDesktopWelcomeWindow({
          entryReason: openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch',
          stealAppFocus: true,
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          dialog.showErrorBox('Redeven Desktop failed to open the launcher', message || 'Unknown launcher error.');
        });
      },
      openAdvancedSettings: () => {
        void openAdvancedSettingsWindow().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          dialog.showErrorBox('Redeven Desktop failed to open Local Environment Settings', message || 'Unknown settings error.');
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
    void restoreBestAvailableWindow().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to restore a window', message || 'Unknown restore error.');
      app.quit();
    });
  });

  app.on('before-quit', (event) => {
    if (quitPhase === 'shutting_down') {
      return;
    }
    quitPhase = 'shutting_down';
    event.preventDefault();
    void shutdownDesktopWindowsAndSessions().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
