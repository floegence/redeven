import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, powerMonitor, safeStorage, session, shell, type MessageBoxOptions } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { startManagedRuntime } from './runtimeProcess';
import { buildAppMenuTemplate } from './appMenu';
import {
  createSafeStorageSecretCodec,
  deleteManagedEnvironment,
  deleteSavedControlPlane,
  deleteSavedEnvironment,
  deleteSavedSSHEnvironment,
  defaultDesktopPreferencesPaths,
  findManagedEnvironmentByID,
  loadDesktopPreferences,
  rememberManagedEnvironmentUse,
  rememberRecentExternalLocalUITarget,
  rememberRecentSSHEnvironmentTarget,
  saveDesktopPreferences,
  setManagedEnvironmentPinned,
  setSavedEnvironmentPinned,
  setSavedSSHEnvironmentPinned,
  updateManagedEnvironmentAccess,
  upsertManagedControlPlaneEnvironment,
  upsertManagedEnvironment,
  upsertSavedControlPlane,
  upsertSavedEnvironment,
  upsertSavedSSHEnvironment,
  validateDesktopSettingsDraft,
  type DesktopPreferences,
  type DesktopSavedControlPlane,
} from './desktopPreferences';
import {
  buildManagedEnvironmentDesktopTarget,
  buildExternalLocalUIDesktopTarget,
  buildSSHDesktopTarget,
  desktopSessionStateKeyFragment,
  externalLocalUIDesktopSessionKey,
  sshDesktopSessionKey,
  type DesktopSessionKey,
  type DesktopSessionSummary,
  type DesktopSessionTarget,
} from './desktopTarget';
import {
  buildDesktopRuntimeLaunchPlan,
  type DesktopRuntimeBootstrap,
} from './desktopLaunch';
import { parseLocalUIBind } from './localUIBind';
import {
  buildBlockedLaunchIssue,
  buildControlPlaneIssue,
  buildSSHConnectionIssue,
  buildDesktopWelcomeSnapshot,
  buildRemoteConnectionIssue,
  type BuildDesktopWelcomeSnapshotArgs,
} from './desktopWelcomeState';
import { defaultDesktopStateStorePath, DesktopStateStore } from './desktopStateStore';
import { DesktopThemeState } from './desktopThemeState';
import { DesktopDiagnosticsRecorder } from './diagnostics';
import { isAllowedAppNavigation } from './navigation';
import { resolveBrowserPreloadPath, resolveBundledRuntimePath, resolveWelcomeRendererPath } from './paths';
import { loadExternalLocalUIStartup } from './runtimeState';
import { desktopSessionRuntimeHandleFromManagedRuntime, type DesktopSessionRuntimeHandle } from './sessionRuntime';
import { startManagedSSHRuntime } from './sshRuntime';
import { PUBLIC_REDEVEN_RELEASE_BASE_URL } from './sshReleaseAssets';
import { installStdioBrokenPipeGuards } from './stdio';
import type { StartupReport } from './startup';
import { resolveManagedEnvironmentOpenTarget } from './managedEnvironmentOpen';
import {
  desktopManagedLocalEnvironmentID,
  managedEnvironmentDefaultOpenRoute,
  managedEnvironmentKind,
  managedEnvironmentLocalAccess,
  managedEnvironmentProviderID,
  managedEnvironmentProviderOrigin,
  managedEnvironmentPublicID,
  type DesktopManagedEnvironment,
} from '../shared/desktopManagedEnvironment';
import {
  exchangeProviderDesktopConnectHandoff,
  exchangeProviderDesktopOpenHandoff,
  fetchProviderAccount,
  fetchProviderDiscovery,
  fetchProviderEnvironments,
  refreshProviderDesktopAccessToken,
  revokeProviderDesktopAuthorization,
  requestDesktopOpenSession,
} from './controlPlaneProviderClient';
import { DesktopProviderRequestError } from './controlPlaneProviderTransport';
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
  type DesktopLauncherActionFailure,
  type DesktopLauncherActionFailureCode,
  type DesktopLauncherActionFailureScope,
  type DesktopLauncherActionRequest,
  type DesktopLauncherActionResult,
  type DesktopLauncherActionSuccess,
  type DesktopLauncherSurface,
  type DesktopWelcomeEntryReason,
  type DesktopWelcomeIssue,
} from '../shared/desktopLauncherIPC';
import { DESKTOP_SESSION_CONTEXT_GET_CHANNEL } from '../shared/desktopSessionContextIPC';
import {
  desktopControlPlaneKey,
  normalizeControlPlaneOrigin,
  type DesktopControlPlaneSummary,
} from '../shared/controlPlaneProvider';
import type { DesktopSSHEnvironmentDetails } from '../shared/desktopSSH';
import {
  desktopProviderCatalogFreshness,
  desktopProviderRemoteRouteState,
  type DesktopControlPlaneSyncState,
  type DesktopProviderRemoteRouteState,
} from '../shared/providerEnvironmentState';

type OpenDesktopWelcomeOptions = Readonly<{
  surface?: DesktopLauncherSurface;
  entryReason?: DesktopWelcomeEntryReason;
  issue?: DesktopWelcomeIssue | null;
  selectedManagedEnvironmentID?: string;
  stealAppFocus?: boolean;
}>;

type DesktopUtilityWindowKind = 'launcher';

type DesktopUtilityWindowState = Readonly<{
  surface: DesktopLauncherSurface;
  entryReason: DesktopWelcomeEntryReason;
  issue: DesktopWelcomeIssue | null;
  selectedManagedEnvironmentID: string;
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
  runtime_handle: DesktopSessionRuntimeHandle | null;
  closing: boolean;
};

type DesktopControlPlaneAccessState = Readonly<{
  access_token: string;
  access_expires_at_unix_ms: number;
  authorization_expires_at_unix_ms: number;
}>;

type DesktopControlPlaneSyncRecord = Readonly<{
  sync_state: DesktopControlPlaneSyncState;
  last_sync_attempt_at_ms: number;
  last_sync_error_code: string;
  last_sync_error_message: string;
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

type ManagedTargetLaunch = Exclude<Awaited<ReturnType<typeof startManagedRuntime>>, Readonly<{ kind: 'blocked' }>>;

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
  role: 'launcher' | 'session_root' | 'session_child';
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
  ['launcher', { surface: 'connect_environment', entryReason: 'app_launch', issue: null, selectedManagedEnvironmentID: '' }],
]);
const utilityWindowKindByWebContentsID = new Map<number, DesktopUtilityWindowKind>();
const UTILITY_WINDOW_KINDS = ['launcher'] as const;
const sessionsByKey = new Map<DesktopSessionKey, DesktopSessionRecord>();
const sessionKeyByWebContentsID = new Map<number, DesktopSessionKey>();
const sessionCloseTasks = new Map<DesktopSessionKey, Promise<void>>();
const windowStateCleanup = new Map<BrowserWindow, () => void>();
let lastFocusedSessionKey: DesktopSessionKey | null = null;
let quitPhase: 'idle' | 'requested' | 'shutting_down' = 'idle';
let desktopPreferencesCache: DesktopPreferences | null = null;
let desktopStateStoreCache: DesktopStateStore | null = null;
let desktopThemeStateCache: DesktopThemeState | null = null;
const controlPlaneAccessStateByKey = new Map<string, DesktopControlPlaneAccessState>();
const controlPlaneSyncStateByKey = new Map<string, DesktopControlPlaneSyncRecord>();
const pendingControlPlaneDisplayLabelByOrigin = new Map<string, string>();
const controlPlaneSyncTaskByKey = new Map<string, Promise<Readonly<{
  preferences: DesktopPreferences;
  controlPlane: DesktopSavedControlPlane;
}>>>();
const desktopDevToolsEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.REDEVEN_DESKTOP_OPEN_DEVTOOLS ?? '').trim().toLowerCase(),
);
const DESKTOP_PROTOCOL_SCHEME = 'redeven';
const CONTROL_PLANE_ACCESS_TOKEN_EXPIRY_SKEW_MS = 15_000;
const CONTROL_PLANE_SYNC_POLL_INTERVAL_MS = 15_000;
const pendingDesktopDeepLinks: string[] = [];
let controlPlaneSyncPollTimer: NodeJS.Timeout | null = null;

installStdioBrokenPipeGuards();

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function peekPendingControlPlaneDisplayLabel(providerOrigin: string): string {
  try {
    return String(pendingControlPlaneDisplayLabelByOrigin.get(normalizeControlPlaneOrigin(providerOrigin)) ?? '');
  } catch {
    return '';
  }
}

function rememberPendingControlPlaneDisplayLabel(providerOrigin: string, displayLabel?: string): void {
  try {
    const key = normalizeControlPlaneOrigin(providerOrigin);
    const cleanLabel = compact(displayLabel);
    if (cleanLabel === '') {
      pendingControlPlaneDisplayLabelByOrigin.delete(key);
      return;
    }
    pendingControlPlaneDisplayLabelByOrigin.set(key, cleanLabel);
  } catch {
    // Ignore invalid origins while the launcher is still validating input.
  }
}

function clearPendingControlPlaneDisplayLabel(providerOrigin: string): void {
  try {
    pendingControlPlaneDisplayLabelByOrigin.delete(normalizeControlPlaneOrigin(providerOrigin));
  } catch {
    // Ignore invalid origins during best-effort cleanup.
  }
}

function launcherActionSuccess(
  outcome: DesktopLauncherActionSuccess['outcome'],
  options: Readonly<{
    sessionKey?: string;
    utilityWindowKind?: DesktopLauncherActionSuccess['utility_window_kind'];
  }> = {},
): DesktopLauncherActionSuccess {
  return {
    ok: true,
    outcome,
    session_key: options.sessionKey,
    utility_window_kind: options.utilityWindowKind,
  };
}

function launcherActionFailure(
  code: DesktopLauncherActionFailureCode,
  scope: DesktopLauncherActionFailureScope,
  message: string,
  options: Readonly<{
    environmentID?: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
    shouldRefreshSnapshot?: boolean;
  }> = {},
): DesktopLauncherActionFailure {
  return {
    ok: false,
    code,
    scope,
    message: compact(message),
    environment_id: compact(options.environmentID) || undefined,
    provider_origin: compact(options.providerOrigin) || undefined,
    provider_id: compact(options.providerID) || undefined,
    env_public_id: compact(options.envPublicID) || undefined,
    should_refresh_snapshot: options.shouldRefreshSnapshot === true || undefined,
  };
}

function launcherActionFailureFromProviderAuthError(
  error: unknown,
  options: Readonly<{
    environmentID?: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
  }> = {},
): DesktopLauncherActionFailure | null {
  if (error instanceof DesktopProviderRequestError && (error.status === 401 || error.status === 403)) {
    return launcherActionFailure(
      'control_plane_auth_required',
      'control_plane',
      'Reconnect the Control Plane in your browser, then try again.',
      {
        environmentID: options.environmentID,
        providerOrigin: options.providerOrigin || error.providerOrigin,
        providerID: options.providerID,
        envPublicID: options.envPublicID,
      },
    );
  }
  return null;
}

function launcherActionFailureFromUnexpectedError(error: unknown): DesktopLauncherActionFailure {
  if (error instanceof DesktopProviderRequestError) {
    if (error.status === 401 || error.status === 403) {
      return launcherActionFailure(
        'control_plane_auth_required',
        'control_plane',
        'Reconnect the Control Plane in your browser, then try again.',
        {
          providerOrigin: error.providerOrigin,
        },
      );
    }
    if (error.code === 'provider_invalid_json' || error.code === 'provider_invalid_response') {
      return launcherActionFailure(
        'provider_invalid_response',
        'control_plane',
        error.message || 'The provider returned an invalid response.',
        {
          providerOrigin: error.providerOrigin,
        },
      );
    }
    return launcherActionFailure(
      'provider_unreachable',
      'control_plane',
      error.message || 'Desktop could not reach the Control Plane.',
      {
        providerOrigin: error.providerOrigin,
      },
    );
  }

  return launcherActionFailure(
    'action_invalid',
    'global',
    error instanceof Error ? error.message : String(error) || 'Desktop could not complete that action.',
  );
}

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
  const managedByID = new Map(
    preferences.managed_environments.map((environment) => [environment.id, environment]),
  );
  const savedLabelByURL = new Map(
    preferences.saved_environments.map((environment) => [environment.local_ui_url, environment.label]),
  );
  const savedSSHLabelByID = new Map(
    preferences.saved_ssh_environments.map((environment) => [environment.id, environment.label]),
  );
  for (const session of sessionsByKey.values()) {
    if (session.target.kind === 'managed_environment') {
      const managedEnvironment = managedByID.get(session.target.environment_id);
      if (!managedEnvironment) {
        continue;
      }
      session.target = buildManagedEnvironmentDesktopTarget(managedEnvironment);
      continue;
    }
    if (session.target.kind === 'external_local_ui') {
      const savedLabel = savedLabelByURL.get(session.startup.local_ui_url);
      if (!savedLabel || savedLabel === session.target.label) {
        continue;
      }
      session.target = {
        ...session.target,
        label: savedLabel,
      };
      continue;
    }
    if (session.target.kind !== 'ssh_environment') {
      continue;
    }
    const savedLabel = savedSSHLabelByID.get(session.target.environment_id);
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
    surface: 'connect_environment',
    entryReason: openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch',
    issue: null,
    selectedManagedEnvironmentID: '',
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
  for (const kind of UTILITY_WINDOW_KINDS) {
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

function utilityWindowStateKey(): string {
  return 'window:launcher';
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
  return [...sessionsByKey.values()]
    .filter((session) => !session.closing && !session.root_window.isDestroyed())
    .map((session) => ({
    session_key: session.session_key,
    target: session.target,
    entry_url: session.allowed_base_url,
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
    controlPlanes: currentControlPlaneSummaries(preferences),
    openSessions: openSessionSummaries(),
    surface: state.surface,
    entryReason: overrides.entryReason ?? state.entryReason,
    issue: overrides.issue ?? state.issue,
    selectedManagedEnvironmentID: state.selectedManagedEnvironmentID,
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
  for (const kind of UTILITY_WINDOW_KINDS) {
    void emitDesktopWelcomeSnapshot(kind);
  }
}

function setLauncherViewState(options: OpenDesktopWelcomeOptions = {}): DesktopUtilityWindowState {
  const current = currentUtilityWindowState('launcher');
  const nextState: DesktopUtilityWindowState = {
    surface: options.surface ?? 'connect_environment',
    entryReason: options.entryReason ?? (openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch'),
    issue: options.issue === undefined ? current.issue : options.issue,
    selectedManagedEnvironmentID: options.selectedManagedEnvironmentID ?? current.selectedManagedEnvironmentID,
  };
  setUtilityWindowState('launcher', nextState);
  return nextState;
}

function resetLauncherIssueState(): void {
  setLauncherViewState({
    surface: currentUtilityWindowState('launcher').surface,
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
    runtimeHandle?: DesktopSessionRuntimeHandle | null;
    attached?: boolean;
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
    runtime_handle: options.runtimeHandle ?? null,
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
    target.kind === 'managed_environment'
      ? options.attached === true
        ? 'runtime_attached'
        : 'runtime_started'
      : target.kind === 'ssh_environment'
        ? 'ssh_environment_connected'
        : 'external_target_connected',
    target.kind === 'managed_environment'
      ? options.attached === true
        ? target.managed_environment_kind === 'controlplane'
          ? 'desktop attached to an existing Control Plane environment runtime'
          : 'desktop attached to an existing Local Environment runtime'
        : target.managed_environment_kind === 'controlplane'
          ? 'desktop opened a desktop-managed Control Plane environment session'
          : 'desktop opened a desktop-managed Local Environment session'
      : target.kind === 'ssh_environment'
        ? 'desktop opened an SSH-bootstrapped environment session'
        : 'desktop connected to an external Redeven Local UI target',
    {
      target_url: startup.local_ui_url,
      attached: options.attached === true,
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

    const runtimeHandle = sessionRecord.runtime_handle;
    sessionRecord.runtime_handle = null;
    sessionRecord.diagnostics.clearRuntime();
    if (runtimeHandle) {
      await runtimeHandle.stop();
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
  setLauncherViewState(options);

  const existing = liveUtilityWindow(kind);
  if (existing) {
    await emitDesktopWelcomeSnapshot(kind);
    presentAppWindow(existing, { stealAppFocus: options.stealAppFocus });
    updateControlPlaneSyncPoller();
    if (kind === 'launcher') {
      void syncVisibleControlPlanesIfNeeded();
    }
    return launcherActionSuccess('focused_utility_window', {
      utilityWindowKind: kind,
    });
  }

  const win = createBrowserWindow({
    targetURL: desktopWelcomePageURL(),
    stateKey: utilityWindowStateKey(),
    role: 'launcher',
    stealAppFocus: options.stealAppFocus,
    onClosed: () => {
      utilityWindows.delete(kind);
      utilityWindowKindByWebContentsID.delete(win.webContents.id);
      updateControlPlaneSyncPoller();
    },
  });

  utilityWindows.set(kind, win);
  utilityWindowKindByWebContentsID.set(win.webContents.id, kind);
  if (kind === 'launcher') {
    win.on('focus', () => {
      void syncVisibleControlPlanesIfNeeded();
    });
  }
  updateControlPlaneSyncPoller();
  if (kind === 'launcher') {
    void syncVisibleControlPlanesIfNeeded();
  }
  return launcherActionSuccess('opened_utility_window', {
    utilityWindowKind: kind,
  });
}

async function openDesktopWelcomeWindow(options: OpenDesktopWelcomeOptions = {}): Promise<void> {
  await openUtilityWindow('launcher', options);
}

function controlPlaneIssueForError(
  error: unknown,
  fallbackMessage: string,
): DesktopWelcomeIssue {
  if (error instanceof DesktopProviderRequestError) {
    return buildControlPlaneIssue(
      error.code,
      String(error.message ?? '').trim() || fallbackMessage,
      {
        providerOrigin: error.providerOrigin,
        status: error.status,
      },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return buildControlPlaneIssue(
    'control_plane_request_failed',
    message || fallbackMessage,
  );
}

function preferredManagedEnvironmentID(preferences: DesktopPreferences): string {
  if (lastFocusedSessionKey) {
    const sessionRecord = liveSession(lastFocusedSessionKey);
    if (sessionRecord?.target.kind === 'managed_environment') {
      return sessionRecord.target.environment_id;
    }
  }
  return preferences.managed_environments.find((environment) => Boolean(environment.local_hosting))?.id
    ?? preferences.managed_environments[0]?.id
    ?? '';
}

async function openAdvancedSettingsWindow(): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await openDesktopWelcomeWindow({
    surface: 'managed_environment_settings',
    selectedManagedEnvironmentID: preferredManagedEnvironmentID(preferences),
    stealAppFocus: true,
  });
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
  environment: DesktopManagedEnvironment;
  localUIBind?: string;
  bootstrap?: DesktopRuntimeBootstrap | null;
}>;

async function prepareManagedTarget(
  options: PrepareManagedTargetOptions,
): Promise<PreparedManagedTargetResult> {
  const executablePath = resolveBundledRuntimePath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  const launchPlan = buildDesktopRuntimeLaunchPlan(options.environment, process.env, {
    localUIBind: options.localUIBind,
    bootstrap: options.bootstrap,
  });
  const launch = await startManagedRuntime({
    executablePath,
    runtimeArgs: launchPlan.args,
    env: launchPlan.env,
    runtimeStateFile: launchPlan.state_layout.runtimeStateFile,
    passwordStdin: launchPlan.password_stdin,
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

function resolveManagedRestartBindOverride(environment: DesktopManagedEnvironment, startup: StartupReport): string | null {
  try {
    const configuredBind = parseLocalUIBind(managedEnvironmentLocalAccess(environment).local_ui_bind);
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

function resolveSSHRuntimeReleaseTag(): string {
  const appVersion = String(process.env.REDEVEN_DESKTOP_VERSION ?? '').trim() || app.getVersion();
  const clean = String(appVersion ?? '').trim();
  if (clean === '') {
    throw new Error('Desktop could not resolve the bundled runtime release tag for SSH bootstrap.');
  }
  return clean.startsWith('v') ? clean : `v${clean}`;
}

async function rememberRecentExternalTarget(rawURL: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(rememberRecentExternalLocalUITarget(preferences, rawURL));
}

async function rememberRecentSSHTarget(
  input: DesktopSSHEnvironmentDetails & Readonly<{ label?: string; environmentID?: string }>,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(rememberRecentSSHEnvironmentTarget(preferences, {
    ssh_destination: input.ssh_destination,
    ssh_port: input.ssh_port,
    remote_install_dir: input.remote_install_dir,
    bootstrap_strategy: input.bootstrap_strategy,
    release_base_url: input.release_base_url,
    label: input.label,
    environment_id: input.environmentID,
  }));
}

function savedControlPlaneByIdentity(
  preferences: DesktopPreferences,
  providerOrigin: string,
  providerID: string,
): DesktopSavedControlPlane | null {
  const key = desktopControlPlaneKey(providerOrigin, providerID);
  return preferences.control_planes.find((controlPlane) => (
    desktopControlPlaneKey(controlPlane.provider.provider_origin, controlPlane.provider.provider_id) === key
  )) ?? null;
}

function controlPlaneRefreshToken(
  preferences: DesktopPreferences,
  providerOrigin: string,
  providerID: string,
): string {
  try {
    return String(preferences.control_plane_refresh_tokens[desktopControlPlaneKey(providerOrigin, providerID)] ?? '').trim();
  } catch {
    return '';
  }
}

function cachedControlPlaneAccessState(
  providerOrigin: string,
  providerID: string,
): DesktopControlPlaneAccessState | null {
  try {
    const key = desktopControlPlaneKey(providerOrigin, providerID);
    const cached = controlPlaneAccessStateByKey.get(key) ?? null;
    if (!cached) {
      return null;
    }
    if (cached.access_expires_at_unix_ms <= Date.now() + CONTROL_PLANE_ACCESS_TOKEN_EXPIRY_SKEW_MS) {
      controlPlaneAccessStateByKey.delete(key);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function rememberControlPlaneAccessState(
  providerOrigin: string,
  providerID: string,
  accessToken: string,
  accessExpiresAtUnixMS: number,
  authorizationExpiresAtUnixMS: number,
): void {
  const cleanAccessToken = String(accessToken ?? '').trim();
  if (cleanAccessToken === '' || !Number.isFinite(accessExpiresAtUnixMS) || accessExpiresAtUnixMS <= 0) {
    return;
  }
  controlPlaneAccessStateByKey.set(
    desktopControlPlaneKey(providerOrigin, providerID),
    {
      access_token: cleanAccessToken,
      access_expires_at_unix_ms: Math.floor(accessExpiresAtUnixMS),
      authorization_expires_at_unix_ms: Number.isFinite(authorizationExpiresAtUnixMS) && authorizationExpiresAtUnixMS > 0
        ? Math.floor(authorizationExpiresAtUnixMS)
        : 0,
    },
  );
}

function clearControlPlaneAccessState(providerOrigin: string, providerID: string): void {
  try {
    controlPlaneAccessStateByKey.delete(desktopControlPlaneKey(providerOrigin, providerID));
  } catch {
    // Ignore malformed identifiers during best-effort cleanup.
  }
}

function controlPlaneSyncRecordFromError(
  error: unknown,
  lastSyncAttemptAtMS: number,
): DesktopControlPlaneSyncRecord {
  if (error instanceof DesktopProviderRequestError) {
    if (error.status === 401 || error.status === 403) {
      return {
        sync_state: 'auth_required',
        last_sync_attempt_at_ms: lastSyncAttemptAtMS,
        last_sync_error_code: error.code,
        last_sync_error_message: error.message,
      };
    }
    if (
      error.code === 'provider_tls_untrusted'
      || error.code === 'provider_dns_failed'
      || error.code === 'provider_connection_failed'
      || error.code === 'provider_timeout'
      || error.code === 'provider_request_failed'
    ) {
      return {
        sync_state: 'provider_unreachable',
        last_sync_attempt_at_ms: lastSyncAttemptAtMS,
        last_sync_error_code: error.code,
        last_sync_error_message: error.message,
      };
    }
    if (error.code === 'provider_invalid_json' || error.code === 'provider_invalid_response') {
      return {
        sync_state: 'provider_invalid',
        last_sync_attempt_at_ms: lastSyncAttemptAtMS,
        last_sync_error_code: error.code,
        last_sync_error_message: error.message,
      };
    }
  }

  return {
    sync_state: 'sync_error',
    last_sync_attempt_at_ms: lastSyncAttemptAtMS,
    last_sync_error_code: 'control_plane_sync_failed',
    last_sync_error_message: error instanceof Error ? error.message : String(error),
  };
}

function defaultControlPlaneSyncRecord(controlPlane: DesktopSavedControlPlane): DesktopControlPlaneSyncRecord {
  if (
    controlPlane.account.authorization_expires_at_unix_ms > 0
    && controlPlane.account.authorization_expires_at_unix_ms <= Date.now()
  ) {
    return {
      sync_state: 'auth_required',
      last_sync_attempt_at_ms: controlPlane.last_synced_at_ms,
      last_sync_error_code: 'authorization_expired',
      last_sync_error_message: 'Reconnect this Control Plane in your browser to restore access.',
    };
  }
  return {
    sync_state: controlPlane.last_synced_at_ms > 0 ? 'ready' : 'idle',
    last_sync_attempt_at_ms: controlPlane.last_synced_at_ms,
    last_sync_error_code: '',
    last_sync_error_message: '',
  };
}

function currentControlPlaneSyncRecord(controlPlane: DesktopSavedControlPlane): DesktopControlPlaneSyncRecord {
  const key = desktopControlPlaneKey(controlPlane.provider.provider_origin, controlPlane.provider.provider_id);
  return controlPlaneSyncStateByKey.get(key) ?? defaultControlPlaneSyncRecord(controlPlane);
}

function setControlPlaneSyncRecord(
  providerOrigin: string,
  providerID: string,
  nextRecord: DesktopControlPlaneSyncRecord,
): void {
  const key = desktopControlPlaneKey(providerOrigin, providerID);
  const previous = controlPlaneSyncStateByKey.get(key);
  if (
    previous
    && previous.sync_state === nextRecord.sync_state
    && previous.last_sync_attempt_at_ms === nextRecord.last_sync_attempt_at_ms
    && previous.last_sync_error_code === nextRecord.last_sync_error_code
    && previous.last_sync_error_message === nextRecord.last_sync_error_message
  ) {
    return;
  }
  controlPlaneSyncStateByKey.set(key, nextRecord);
  broadcastDesktopWelcomeSnapshots();
}

function clearControlPlaneSyncRecord(providerOrigin: string, providerID: string): void {
  try {
    const key = desktopControlPlaneKey(providerOrigin, providerID);
    if (controlPlaneSyncStateByKey.delete(key)) {
      broadcastDesktopWelcomeSnapshots();
    }
  } catch {
    // Ignore malformed identifiers during best-effort cleanup.
  }
}

function controlPlaneSummary(controlPlane: DesktopSavedControlPlane): DesktopControlPlaneSummary {
  const syncRecord = currentControlPlaneSyncRecord(controlPlane);
  return {
    ...controlPlane,
    sync_state: syncRecord.sync_state,
    last_sync_attempt_at_ms: syncRecord.last_sync_attempt_at_ms,
    last_sync_error_code: syncRecord.last_sync_error_code,
    last_sync_error_message: syncRecord.last_sync_error_message,
    catalog_freshness: desktopProviderCatalogFreshness(controlPlane.last_synced_at_ms),
  };
}

function currentControlPlaneSummaries(preferences: DesktopPreferences): readonly DesktopControlPlaneSummary[] {
  return preferences.control_planes.map((controlPlane) => controlPlaneSummary(controlPlane));
}

function controlPlaneNeedsAutoSync(controlPlane: DesktopSavedControlPlane): boolean {
  const summary = controlPlaneSummary(controlPlane);
  if (summary.sync_state === 'syncing' || summary.sync_state === 'auth_required') {
    return false;
  }
  return summary.catalog_freshness !== 'fresh';
}

function updateControlPlaneSyncPoller(): void {
  const shouldPoll = Boolean(liveUtilityWindow('launcher'));
  if (!shouldPoll) {
    if (controlPlaneSyncPollTimer) {
      clearInterval(controlPlaneSyncPollTimer);
      controlPlaneSyncPollTimer = null;
    }
    return;
  }
  if (controlPlaneSyncPollTimer) {
    return;
  }
  controlPlaneSyncPollTimer = setInterval(() => {
    void syncVisibleControlPlanesIfNeeded();
  }, CONTROL_PLANE_SYNC_POLL_INTERVAL_MS);
}

async function syncVisibleControlPlanesIfNeeded(options: Readonly<{ force?: boolean }> = {}): Promise<void> {
  const launcher = liveUtilityWindow('launcher');
  if (!launcher || launcher.isDestroyed()) {
    updateControlPlaneSyncPoller();
    return;
  }
  const preferences = await loadDesktopPreferencesCached();
  const tasks = preferences.control_planes.flatMap((controlPlane) => {
    if (!options.force && !controlPlaneNeedsAutoSync(controlPlane)) {
      return [];
    }
    return [syncSavedControlPlaneAccountWithState(
      controlPlane.provider.provider_origin,
      controlPlane.provider.provider_id,
      { force: options.force === true },
    ).catch(() => {
      // Sync state is already updated for the launcher UI; best-effort background polling should not surface a second error here.
    })];
  });
  await Promise.all(tasks);
}

function providerDesktopConnectPageURL(providerOrigin: string): string {
  return new URL('/desktop/connect', normalizeControlPlaneOrigin(providerOrigin)).toString();
}

async function saveConnectedControlPlane(
  preferences: DesktopPreferences,
  providerOrigin: string,
  expectedProviderID: string | undefined,
  handoffTicket: string,
  displayLabel?: string,
): Promise<Readonly<{
  preferences: DesktopPreferences;
  controlPlane: DesktopSavedControlPlane;
}>> {
  const provider = await fetchProviderDiscovery(providerOrigin);
  const cleanExpectedProviderID = String(expectedProviderID ?? '').trim();
  if (cleanExpectedProviderID !== '' && provider.provider_id !== cleanExpectedProviderID) {
    throw new Error(`Provider ID mismatch: expected ${cleanExpectedProviderID}, got ${provider.provider_id}.`);
  }
  const exchange = await exchangeProviderDesktopConnectHandoff(provider, handoffTicket);
  rememberControlPlaneAccessState(
    provider.provider_origin,
    provider.provider_id,
    exchange.access_token,
    exchange.access_expires_at_unix_ms,
    exchange.authorization_expires_at_unix_ms,
  );
  const resolvedDisplayLabel = compact(displayLabel) || peekPendingControlPlaneDisplayLabel(provider.provider_origin);
  const nextPreferences = upsertSavedControlPlane(preferences, {
    provider,
    account: exchange.account,
    environments: exchange.environments,
    display_label: resolvedDisplayLabel || undefined,
    last_synced_at_ms: Date.now(),
    refresh_token: exchange.refresh_token,
  });
  const controlPlane = savedControlPlaneByIdentity(nextPreferences, provider.provider_origin, provider.provider_id);
  if (!controlPlane) {
    throw new Error('Desktop failed to save the Control Plane account.');
  }
  await persistDesktopPreferences(nextPreferences);
  clearPendingControlPlaneDisplayLabel(provider.provider_origin);
  setControlPlaneSyncRecord(provider.provider_origin, provider.provider_id, {
    sync_state: 'ready',
    last_sync_attempt_at_ms: controlPlane.last_synced_at_ms,
    last_sync_error_code: '',
    last_sync_error_message: '',
  });
  return {
    preferences: nextPreferences,
    controlPlane,
  };
}

async function syncSavedControlPlaneAccount(
  preferences: DesktopPreferences,
  providerOrigin: string,
  providerID: string,
): Promise<Readonly<{
  preferences: DesktopPreferences;
  controlPlane: DesktopSavedControlPlane;
}>> {
  const refreshToken = controlPlaneRefreshToken(preferences, providerOrigin, providerID);
  if (refreshToken === '') {
    throw new Error('Desktop authorization is missing. Reconnect this Control Plane in your browser.');
  }

  const provider = await fetchProviderDiscovery(providerOrigin);
  if (provider.provider_id !== providerID) {
    throw new Error(`Provider ID mismatch: expected ${providerID}, got ${provider.provider_id}.`);
  }

  const refreshed = await refreshProviderDesktopAccessToken(provider, refreshToken);
  rememberControlPlaneAccessState(
    provider.provider_origin,
    provider.provider_id,
    refreshed.access_token,
    refreshed.access_expires_at_unix_ms,
    refreshed.authorization_expires_at_unix_ms,
  );

  const [account, environments] = await Promise.all([
    fetchProviderAccount(provider, refreshed.access_token),
    fetchProviderEnvironments(provider, refreshed.access_token),
  ]);
  const nextPreferences = upsertSavedControlPlane(preferences, {
    provider,
    account,
    environments,
    last_synced_at_ms: Date.now(),
    refresh_token: refreshToken,
  });
  const controlPlane = savedControlPlaneByIdentity(nextPreferences, provider.provider_origin, provider.provider_id);
  if (!controlPlane) {
    throw new Error('Desktop failed to save the Control Plane account.');
  }
  await persistDesktopPreferences(nextPreferences);
  return {
    preferences: nextPreferences,
    controlPlane,
  };
}

async function syncSavedControlPlaneAccountWithState(
  providerOrigin: string,
  providerID: string,
  options: Readonly<{ force?: boolean }> = {},
): Promise<Readonly<{
  preferences: DesktopPreferences;
  controlPlane: DesktopSavedControlPlane;
}>> {
  const key = desktopControlPlaneKey(providerOrigin, providerID);
  const inFlight = controlPlaneSyncTaskByKey.get(key);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const preferences = await loadDesktopPreferencesCached();
    const controlPlane = savedControlPlaneByIdentity(preferences, providerOrigin, providerID);
    if (!controlPlane) {
      throw new Error('This Control Plane is no longer saved in Desktop.');
    }

    const summary = controlPlaneSummary(controlPlane);
    if (!options.force && summary.catalog_freshness === 'fresh' && summary.sync_state === 'ready') {
      return {
        preferences,
        controlPlane,
      };
    }

    const lastSyncAttemptAtMS = Date.now();
    setControlPlaneSyncRecord(providerOrigin, providerID, {
      sync_state: 'syncing',
      last_sync_attempt_at_ms: lastSyncAttemptAtMS,
      last_sync_error_code: '',
      last_sync_error_message: '',
    });

    try {
      const synced = await syncSavedControlPlaneAccount(preferences, providerOrigin, providerID);
      setControlPlaneSyncRecord(providerOrigin, providerID, {
        sync_state: 'ready',
        last_sync_attempt_at_ms: lastSyncAttemptAtMS,
        last_sync_error_code: '',
        last_sync_error_message: '',
      });
      return synced;
    } catch (error) {
      setControlPlaneSyncRecord(
        providerOrigin,
        providerID,
        controlPlaneSyncRecordFromError(error, lastSyncAttemptAtMS),
      );
      throw error;
    } finally {
      controlPlaneSyncTaskByKey.delete(key);
    }
  })();

  controlPlaneSyncTaskByKey.set(key, task);
  return task;
}

async function ensureControlPlaneAccessToken(
  preferences: DesktopPreferences,
  controlPlane: DesktopSavedControlPlane,
): Promise<Readonly<{
  accessToken: string;
  preferences: DesktopPreferences;
  controlPlane: DesktopSavedControlPlane;
}>> {
  const cached = cachedControlPlaneAccessState(
    controlPlane.provider.provider_origin,
    controlPlane.provider.provider_id,
  );
  if (cached) {
    return {
      accessToken: cached.access_token,
      preferences,
      controlPlane,
    };
  }

  const refreshToken = controlPlaneRefreshToken(
    preferences,
    controlPlane.provider.provider_origin,
    controlPlane.provider.provider_id,
  );
  if (refreshToken === '') {
    throw new Error('Desktop authorization is missing. Reconnect this Control Plane in your browser.');
  }

  const refreshed = await refreshProviderDesktopAccessToken(controlPlane.provider, refreshToken);
  rememberControlPlaneAccessState(
    controlPlane.provider.provider_origin,
    controlPlane.provider.provider_id,
    refreshed.access_token,
    refreshed.access_expires_at_unix_ms,
    refreshed.authorization_expires_at_unix_ms,
  );

  if (controlPlane.account.authorization_expires_at_unix_ms === refreshed.authorization_expires_at_unix_ms) {
    return {
      accessToken: refreshed.access_token,
      preferences,
      controlPlane,
    };
  }

  const nextPreferences = upsertSavedControlPlane(preferences, {
    provider: controlPlane.provider,
    account: {
      ...controlPlane.account,
      authorization_expires_at_unix_ms: refreshed.authorization_expires_at_unix_ms,
    },
    environments: controlPlane.environments,
    last_synced_at_ms: controlPlane.last_synced_at_ms,
    refresh_token: refreshToken,
  });
  await persistDesktopPreferences(nextPreferences);
  return {
    accessToken: refreshed.access_token,
    preferences: nextPreferences,
    controlPlane: savedControlPlaneByIdentity(
      nextPreferences,
      controlPlane.provider.provider_origin,
      controlPlane.provider.provider_id,
    ) ?? controlPlane,
  };
}

function controlPlaneEnvironmentLabel(
  controlPlane: DesktopSavedControlPlane | null,
  envPublicID: string,
  fallbackLabel = '',
): string {
  const cleanEnvPublicID = String(envPublicID ?? '').trim();
  const cleanFallback = String(fallbackLabel ?? '').trim();
  const environment = controlPlane?.environments.find((entry) => entry.env_public_id === cleanEnvPublicID) ?? null;
  return environment?.label || cleanFallback || cleanEnvPublicID;
}

function controlPlaneRouteSnapshot(
  preferences: DesktopPreferences,
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): Readonly<{
  controlPlane: DesktopSavedControlPlane | null;
  summary: DesktopControlPlaneSummary | null;
  environment: DesktopSavedControlPlane['environments'][number] | null;
  remoteRouteState: DesktopProviderRemoteRouteState;
}> {
  const controlPlane = savedControlPlaneByIdentity(preferences, providerOrigin, providerID);
  if (!controlPlane) {
    return {
      controlPlane: null,
      summary: null,
      environment: null,
      remoteRouteState: 'auth_required',
    };
  }
  const summary = controlPlaneSummary(controlPlane);
  const environment = controlPlane.environments.find((entry) => entry.env_public_id === envPublicID) ?? null;
  return {
    controlPlane,
    summary,
    environment,
    remoteRouteState: desktopProviderRemoteRouteState({
      syncState: summary.sync_state,
      environmentPresent: environment !== null,
      providerStatus: environment?.status,
      providerLifecycleStatus: environment?.lifecycle_status,
      lastSyncedAtMS: controlPlane.last_synced_at_ms,
    }),
  };
}

function launcherActionFailureForRemoteRouteState(
  remoteRouteState: DesktopProviderRemoteRouteState,
  options: Readonly<{
    environmentID?: string;
    providerOrigin: string;
    providerID: string;
    envPublicID: string;
  }>,
): DesktopLauncherActionFailure | null {
  switch (remoteRouteState) {
    case 'offline':
      return launcherActionFailure(
        'environment_offline',
        'environment',
        'This environment is currently offline in the provider.',
        {
          environmentID: options.environmentID,
          providerOrigin: options.providerOrigin,
          providerID: options.providerID,
          envPublicID: options.envPublicID,
        },
      );
    case 'stale':
    case 'unknown':
      return launcherActionFailure(
        remoteRouteState === 'stale' ? 'environment_status_stale' : 'provider_sync_required',
        'control_plane',
        remoteRouteState === 'stale'
          ? 'Remote status is stale. Refresh the provider before opening this environment.'
          : 'Desktop needs a fresh provider sync before opening this environment.',
        {
          environmentID: options.environmentID,
          providerOrigin: options.providerOrigin,
          providerID: options.providerID,
          envPublicID: options.envPublicID,
        },
      );
    case 'removed':
      return launcherActionFailure(
        'provider_environment_removed',
        'environment',
        'This environment is no longer published by the provider. Refresh the provider and try again.',
        {
          environmentID: options.environmentID,
          providerOrigin: options.providerOrigin,
          providerID: options.providerID,
          envPublicID: options.envPublicID,
          shouldRefreshSnapshot: true,
        },
      );
    case 'auth_required':
      return launcherActionFailure(
        'control_plane_auth_required',
        'control_plane',
        'Reconnect the Control Plane in your browser, then try again.',
        {
          environmentID: options.environmentID,
          providerOrigin: options.providerOrigin,
          providerID: options.providerID,
          envPublicID: options.envPublicID,
        },
      );
    case 'provider_unreachable':
      return launcherActionFailure(
        'provider_sync_required',
        'control_plane',
        'Desktop could not confirm the latest provider status. Retry sync, then open this environment again.',
        {
          environmentID: options.environmentID,
          providerOrigin: options.providerOrigin,
          providerID: options.providerID,
          envPublicID: options.envPublicID,
        },
      );
    case 'provider_invalid':
      return launcherActionFailure(
        'provider_invalid_response',
        'control_plane',
        'The provider returned an invalid response while Desktop refreshed status.',
        {
          environmentID: options.environmentID,
          providerOrigin: options.providerOrigin,
          providerID: options.providerID,
          envPublicID: options.envPublicID,
        },
      );
    default:
      return null;
  }
}

async function openManagedEnvironmentRecord(
  preferences: DesktopPreferences,
  environment: DesktopManagedEnvironment,
  options: Readonly<{
    bootstrap?: DesktopRuntimeBootstrap | null;
    stealAppFocus?: boolean;
  }> = {},
): Promise<DesktopLauncherActionResult> {
  const target = buildManagedEnvironmentDesktopTarget(environment, { route: 'local_host' });
  const sessionKey = target.session_key;
  const existingSession = liveSession(sessionKey);
  if (existingSession) {
    resetLauncherIssueState();
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: options.stealAppFocus !== false });
    if (findManagedEnvironmentByID(preferences, environment.id)) {
      await persistDesktopPreferences(rememberManagedEnvironmentUse(preferences, environment.id));
    }
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }

  const prepared = await prepareManagedTarget({
    environment,
    bootstrap: options.bootstrap,
  });
  if (!prepared.ok) {
    return openUtilityWindow('launcher', {
      entryReason: prepared.entryReason,
      issue: prepared.issue,
      selectedManagedEnvironmentID: environment.id,
      stealAppFocus: options.stealAppFocus !== false,
    });
  }

  await createSessionRecord(target, prepared.launch.managedRuntime.startup, {
    runtimeHandle: desktopSessionRuntimeHandleFromManagedRuntime(prepared.launch.managedRuntime, {
      persistedOwner: environment.local_hosting?.owner,
    }),
    attached: prepared.launch.managedRuntime.attached,
    stealAppFocus: options.stealAppFocus !== false,
  });
  resetLauncherIssueState();
  await persistDesktopPreferences(rememberManagedEnvironmentUse(preferences, environment.id));
  return launcherActionSuccess('opened_environment_window', {
    sessionKey: target.session_key,
  });
}

function remoteManagedSessionStartup(remoteSessionURL: string): StartupReport {
  return {
    local_ui_url: remoteSessionURL,
    local_ui_urls: [remoteSessionURL],
    effective_run_mode: 'remote_desktop',
    remote_enabled: true,
    desktop_managed: false,
  };
}

function controlPlaneBootstrap(
  providerOrigin: string,
  envPublicID: string,
  bootstrapTicket: string,
): DesktopRuntimeBootstrap {
  return {
    kind: 'bootstrap_ticket',
    controlplane_url: providerOrigin,
    env_id: envPublicID,
    bootstrap_ticket: bootstrapTicket,
  };
}

async function openManagedControlPlaneEnvironmentRecord(
  preferences: DesktopPreferences,
  environment: DesktopManagedEnvironment,
  providerOrigin: string,
  envPublicID: string,
  openSession: Readonly<{
    bootstrap_ticket?: string;
    remote_session_url?: string;
  }>,
  requestedRoute: 'auto' | 'local_host' | 'remote_desktop' = 'auto',
): Promise<DesktopLauncherActionResult> {
  const resolvedTarget = resolveManagedEnvironmentOpenTarget(environment, openSession, requestedRoute);
  if (resolvedTarget.route === 'remote_desktop') {
    return openManagedRemoteEnvironmentRecord(preferences, environment, resolvedTarget.remote_session_url, {
      stealAppFocus: true,
    });
  }
  return openManagedEnvironmentRecord(preferences, environment, {
    bootstrap: controlPlaneBootstrap(providerOrigin, envPublicID, resolvedTarget.bootstrap_ticket),
    stealAppFocus: true,
  });
}

async function openManagedRemoteEnvironmentRecord(
  preferences: DesktopPreferences,
  environment: DesktopManagedEnvironment,
  remoteSessionURL: string,
  options: Readonly<{ stealAppFocus?: boolean }> = {},
): Promise<DesktopLauncherActionResult> {
  const target = buildManagedEnvironmentDesktopTarget(environment, { route: 'remote_desktop' });
  const existingSession = liveSession(target.session_key);
  if (existingSession) {
    resetLauncherIssueState();
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: options.stealAppFocus !== false });
    await persistDesktopPreferences(rememberManagedEnvironmentUse(preferences, environment.id));
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }

  await createSessionRecord(
    target,
    remoteManagedSessionStartup(remoteSessionURL),
    { stealAppFocus: options.stealAppFocus !== false },
  );
  resetLauncherIssueState();
  await persistDesktopPreferences(rememberManagedEnvironmentUse(preferences, environment.id));
  return launcherActionSuccess('opened_environment_window', {
    sessionKey: target.session_key,
  });
}

async function openControlPlaneEnvironmentWithOpenSession(args: Readonly<{
  providerOrigin: string;
  providerID?: string;
  envPublicID: string;
  bootstrapTicket?: string;
  remoteSessionURL?: string;
  label?: string;
}>): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const providerOrigin = normalizeControlPlaneOrigin(args.providerOrigin);
  let providerID = String(args.providerID ?? '').trim();
  let controlPlane = providerID === ''
    ? preferences.control_planes.find((entry) => entry.provider.provider_origin === providerOrigin) ?? null
    : savedControlPlaneByIdentity(preferences, providerOrigin, providerID);
  if (providerID === '') {
    if (controlPlane) {
      providerID = controlPlane.provider.provider_id;
    } else {
      const provider = await fetchProviderDiscovery(providerOrigin);
      providerID = provider.provider_id;
      controlPlane = savedControlPlaneByIdentity(preferences, provider.provider_origin, provider.provider_id);
    }
  }
  if (providerID === '') {
    throw new Error('Desktop could not resolve the Control Plane provider ID.');
  }
  const nextPreferences = upsertManagedControlPlaneEnvironment(preferences, {
    provider_origin: providerOrigin,
    provider_id: providerID,
    env_public_id: args.envPublicID,
    label: controlPlaneEnvironmentLabel(controlPlane, args.envPublicID, args.label),
  });
  const environment = nextPreferences.managed_environments.find((entry) => (
    managedEnvironmentProviderOrigin(entry) === providerOrigin
    && managedEnvironmentPublicID(entry) === args.envPublicID
  )) ?? null;
  if (!environment) {
    throw new Error('Desktop could not register that Control Plane environment.');
  }
  return openManagedControlPlaneEnvironmentRecord(
    nextPreferences,
    environment,
    providerOrigin,
    args.envPublicID,
    {
      bootstrap_ticket: compact(args.bootstrapTicket) || undefined,
      remote_session_url: compact(args.remoteSessionURL) || undefined,
    },
  );
}

async function openManagedEnvironmentFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_managed_environment' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const environment = findManagedEnvironmentByID(preferences, request.environment_id);
  if (!environment) {
    return launcherActionFailure(
      'environment_missing',
      'environment',
      'This environment is no longer available.',
      {
        environmentID: request.environment_id,
        shouldRefreshSnapshot: true,
      },
    );
  }
  const requestedRoute = request.route === 'local_host' || request.route === 'remote_desktop'
    ? request.route
    : 'auto';
  if (managedEnvironmentKind(environment) === 'controlplane') {
    const providerOrigin = managedEnvironmentProviderOrigin(environment);
    const providerID = managedEnvironmentProviderID(environment);
    const envPublicID = managedEnvironmentPublicID(environment);
    const controlPlaneState = controlPlaneRouteSnapshot(
      preferences,
      providerOrigin,
      providerID,
      envPublicID,
    );
    if (!controlPlaneState.controlPlane) {
      return launcherActionFailure(
        'control_plane_missing',
        'control_plane',
        'Reconnect the Control Plane for this environment, then try again.',
        {
          environmentID: environment.id,
          providerOrigin,
          providerID,
          envPublicID,
          shouldRefreshSnapshot: true,
        },
      );
    }
    try {
      let synchronized = {
        preferences,
        controlPlane: controlPlaneState.controlPlane,
      };
      const targetRoute = requestedRoute === 'local_host' || requestedRoute === 'remote_desktop'
        ? requestedRoute
        : managedEnvironmentDefaultOpenRoute(environment);
      const requiresRemoteRoute = targetRoute === 'remote_desktop';
      if (requiresRemoteRoute && controlPlaneState.summary?.catalog_freshness !== 'fresh') {
        synchronized = await syncSavedControlPlaneAccountWithState(providerOrigin, providerID, { force: true });
      }
      const latestState = controlPlaneRouteSnapshot(
        synchronized.preferences,
        providerOrigin,
        providerID,
        envPublicID,
      );
      if (requiresRemoteRoute) {
        const routeFailure = launcherActionFailureForRemoteRouteState(latestState.remoteRouteState, {
          environmentID: environment.id,
          providerOrigin,
          providerID,
          envPublicID,
        });
        if (routeFailure) {
          return routeFailure;
        }
      }
      const authorized = await ensureControlPlaneAccessToken(synchronized.preferences, synchronized.controlPlane);
      const openSession = await requestDesktopOpenSession(
        authorized.controlPlane.provider,
        authorized.accessToken,
        envPublicID,
      );
      return openManagedControlPlaneEnvironmentRecord(
        authorized.preferences,
        environment,
        authorized.controlPlane.provider.provider_origin,
        envPublicID,
        openSession,
        requestedRoute,
      );
    } catch (error) {
      return launcherActionFailureFromProviderAuthError(error, {
        environmentID: environment.id,
        providerOrigin,
        providerID,
        envPublicID,
      }) ?? launcherActionFailureFromUnexpectedError(error);
    }
  }
  if (requestedRoute === 'remote_desktop') {
    return launcherActionFailure(
      'environment_route_unavailable',
      'environment',
      'Remote access is not available for this environment.',
      {
        environmentID: environment.id,
      },
    );
  }
  return openManagedEnvironmentRecord(preferences, environment, { stealAppFocus: true });
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
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: optimisticSession.session_key,
    });
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
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }

  await createSessionRecord(target, prepared.startup, { stealAppFocus: true });
  resetLauncherIssueState();
  await rememberRecentExternalTarget(prepared.startup.local_ui_url);
  return launcherActionSuccess('opened_environment_window', {
    sessionKey: target.session_key,
  });
}

async function openSSHEnvironmentFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_ssh_environment' }>>,
): Promise<DesktopLauncherActionResult> {
  const sshDetails: DesktopSSHEnvironmentDetails = {
    ssh_destination: request.ssh_destination,
    ssh_port: request.ssh_port,
    remote_install_dir: request.remote_install_dir,
    bootstrap_strategy: request.bootstrap_strategy,
    release_base_url: request.release_base_url,
  };
  const optimisticSessionKey = sshDesktopSessionKey(sshDetails);
  const optimisticSession = liveSession(optimisticSessionKey);
  if (optimisticSession) {
    if (optimisticSession.target.kind === 'ssh_environment' && request.label) {
      optimisticSession.target = {
        ...optimisticSession.target,
        label: String(request.label).trim() || optimisticSession.target.label,
      };
    }
    resetLauncherIssueState();
    await rememberRecentSSHTarget({
      ...sshDetails,
      label: request.label,
      environmentID: request.environment_id,
    });
    focusEnvironmentSession(optimisticSession.session_key, { stealAppFocus: true });
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: optimisticSession.session_key,
    });
  }

  let managedSSHRuntime;
  try {
    managedSSHRuntime = await startManagedSSHRuntime({
      target: sshDetails,
      runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
      tempRoot: app.getPath('temp'),
      assetCacheRoot: path.join(app.getPath('userData'), 'ssh-runtime-cache'),
      onLog: (stream, chunk) => {
        const text = String(chunk ?? '').trim();
        if (!text) {
          return;
        }
        console.log(`[redeven:${stream}] ${text}`);
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return openUtilityWindow('launcher', {
      entryReason: 'connect_failed',
      issue: buildSSHConnectionIssue(
        sshDetails,
        'ssh_target_unreachable',
        message || 'Desktop could not bootstrap that SSH Environment.',
      ),
      stealAppFocus: true,
    });
  }

  const target = buildSSHDesktopTarget(sshDetails, {
    environmentID: request.environment_id,
    label: request.label,
    forwardedLocalUIURL: managedSSHRuntime.local_forward_url,
  });
  const existingSession = liveSession(target.session_key);
  if (existingSession) {
    existingSession.target = target;
    resetLauncherIssueState();
    await rememberRecentSSHTarget({
      ...sshDetails,
      label: request.label,
      environmentID: request.environment_id,
    });
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: true });
    broadcastDesktopWelcomeSnapshots();
    await managedSSHRuntime.stop();
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }

  await createSessionRecord(target, managedSSHRuntime.startup, {
    runtimeHandle: managedSSHRuntime.runtime_handle,
    stealAppFocus: true,
  });
  resetLauncherIssueState();
  await rememberRecentSSHTarget({
    ...sshDetails,
    label: target.label,
    environmentID: target.environment_id,
  });
  return launcherActionSuccess('opened_environment_window', {
    sessionKey: target.session_key,
  });
}

async function startControlPlaneConnectFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'start_control_plane_connect' }>>,
): Promise<DesktopLauncherActionResult> {
  const provider = await fetchProviderDiscovery(request.provider_origin);
  rememberPendingControlPlaneDisplayLabel(provider.provider_origin, request.display_label);
  await openExternalURL(providerDesktopConnectPageURL(provider.provider_origin));
  resetLauncherIssueState();
  broadcastDesktopWelcomeSnapshots();
  return launcherActionSuccess('started_control_plane_connect', {
    utilityWindowKind: 'launcher',
  });
}

async function refreshControlPlaneFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'refresh_control_plane' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const controlPlane = savedControlPlaneByIdentity(preferences, request.provider_origin, request.provider_id);
  if (!controlPlane) {
    return launcherActionFailure(
      'control_plane_missing',
      'control_plane',
      'This Control Plane is no longer saved in Desktop.',
      {
        providerOrigin: request.provider_origin,
        providerID: request.provider_id,
        shouldRefreshSnapshot: true,
      },
    );
  }
  try {
    await syncSavedControlPlaneAccountWithState(
      controlPlane.provider.provider_origin,
      controlPlane.provider.provider_id,
      { force: true },
    );
    resetLauncherIssueState();
    return launcherActionSuccess('refreshed_control_plane', {
      utilityWindowKind: 'launcher',
    });
  } catch (error) {
    return launcherActionFailureFromProviderAuthError(error, {
      providerOrigin: controlPlane.provider.provider_origin,
      providerID: controlPlane.provider.provider_id,
    }) ?? launcherActionFailure(
      'provider_unreachable',
      'control_plane',
      controlPlaneIssueForError(error, 'Desktop failed to refresh this Control Plane.').message,
      {
        providerOrigin: controlPlane.provider.provider_origin,
        providerID: controlPlane.provider.provider_id,
      },
    );
  }
}

async function deleteControlPlaneFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'delete_control_plane' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const controlPlane = savedControlPlaneByIdentity(preferences, request.provider_origin, request.provider_id);
  if (!controlPlane) {
    return launcherActionFailure(
      'control_plane_missing',
      'control_plane',
      'This Control Plane is no longer saved in Desktop.',
      {
        providerOrigin: request.provider_origin,
        providerID: request.provider_id,
        shouldRefreshSnapshot: true,
      },
    );
  }
  const refreshToken = controlPlaneRefreshToken(preferences, request.provider_origin, request.provider_id);
  if (refreshToken !== '') {
    await revokeProviderDesktopAuthorization(controlPlane.provider, refreshToken);
  }
  clearControlPlaneAccessState(request.provider_origin, request.provider_id);
  clearControlPlaneSyncRecord(request.provider_origin, request.provider_id);
  await persistDesktopPreferences(deleteSavedControlPlane(preferences, request.provider_origin, request.provider_id));
  resetLauncherIssueState();
  return launcherActionSuccess('deleted_control_plane', {
    utilityWindowKind: 'launcher',
  });
}

async function openControlPlaneEnvironmentFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_control_plane_environment' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const initialState = controlPlaneRouteSnapshot(
    preferences,
    request.provider_origin,
    request.provider_id,
    request.env_public_id,
  );
  if (!initialState.controlPlane) {
    return launcherActionFailure(
      'control_plane_missing',
      'control_plane',
      'Reconnect the Control Plane for this environment, then try again.',
      {
        providerOrigin: request.provider_origin,
        providerID: request.provider_id,
        envPublicID: request.env_public_id,
        shouldRefreshSnapshot: true,
      },
    );
  }

  try {
    let synchronized = {
      preferences,
      controlPlane: initialState.controlPlane,
    };
    if (initialState.summary?.catalog_freshness !== 'fresh') {
      synchronized = await syncSavedControlPlaneAccountWithState(
        request.provider_origin,
        request.provider_id,
        { force: true },
      );
    }
    const latestState = controlPlaneRouteSnapshot(
      synchronized.preferences,
      request.provider_origin,
      request.provider_id,
      request.env_public_id,
    );
    const routeFailure = launcherActionFailureForRemoteRouteState(latestState.remoteRouteState, {
      providerOrigin: request.provider_origin,
      providerID: request.provider_id,
      envPublicID: request.env_public_id,
    });
    if (routeFailure) {
      return routeFailure;
    }
    const authorized = await ensureControlPlaneAccessToken(synchronized.preferences, synchronized.controlPlane);
    const openSession = await requestDesktopOpenSession(
      authorized.controlPlane.provider,
      authorized.accessToken,
      request.env_public_id,
    );
    return openControlPlaneEnvironmentWithOpenSession({
      providerOrigin: authorized.controlPlane.provider.provider_origin,
      providerID: authorized.controlPlane.provider.provider_id,
      envPublicID: request.env_public_id,
      bootstrapTicket: openSession.bootstrap_ticket,
      remoteSessionURL: openSession.remote_session_url,
      label: latestState.environment?.label,
    });
  } catch (error) {
    return launcherActionFailureFromProviderAuthError(error, {
      providerOrigin: request.provider_origin,
      providerID: request.provider_id,
      envPublicID: request.env_public_id,
    }) ?? launcherActionFailureFromUnexpectedError(error);
  }
}

async function focusEnvironmentWindow(sessionKey: string): Promise<DesktopLauncherActionResult> {
  const cleanSessionKey = String(sessionKey ?? '').trim() as DesktopSessionKey;
  if (!focusEnvironmentSession(cleanSessionKey, { stealAppFocus: true })) {
    return launcherActionFailure(
      'session_stale',
      'environment',
      'That window was already closed. Desktop refreshed the environment list.',
      {
        shouldRefreshSnapshot: true,
      },
    );
  }
  resetLauncherIssueState();
  broadcastDesktopWelcomeSnapshots();
  return launcherActionSuccess('focused_environment_window', {
    sessionKey: cleanSessionKey,
  });
}

async function restartManagedRuntimeFromShell(webContentsID: number): Promise<DesktopShellRuntimeActionResponse> {
  const sessionRecord = sessionRecordForWebContentsID(webContentsID);
  if (!sessionRecord || sessionRecord.target.kind !== 'managed_environment' || !sessionRecord.runtime_handle || sessionRecord.runtime_handle.runtime_kind !== 'managed_environment') {
    return {
      ok: false,
      started: false,
      message: 'Managed runtime is not active.',
    };
  }
  if (sessionRecord.runtime_handle.lifecycle_owner !== 'desktop') {
    return {
      ok: false,
      started: false,
      message: 'This runtime is attached from another Redeven host process. Restart it from that host process instead.',
    };
  }
  const previousRuntimeHandle = sessionRecord.runtime_handle;
  const preferences = await loadDesktopPreferencesCached();
  const environment = findManagedEnvironmentByID(preferences, sessionRecord.target.environment_id);
  if (!environment) {
    return {
      ok: false,
      started: false,
      message: 'Desktop could not resolve the current environment settings.',
    };
  }
  const localUIBind = resolveManagedRestartBindOverride(environment, sessionRecord.startup) ?? undefined;
  let bootstrap: DesktopRuntimeBootstrap | null = null;
  if (managedEnvironmentKind(environment) === 'controlplane') {
    const controlPlane = savedControlPlaneByIdentity(
      preferences,
      managedEnvironmentProviderOrigin(environment),
      managedEnvironmentProviderID(environment),
    );
    if (!controlPlane) {
      return {
        ok: false,
        started: false,
        message: 'Reconnect the Control Plane before restarting this environment.',
      };
    }
    const authorized = await ensureControlPlaneAccessToken(preferences, controlPlane);
    const openSession = await requestDesktopOpenSession(
      authorized.controlPlane.provider,
      authorized.accessToken,
      managedEnvironmentPublicID(environment),
    );
    if (!openSession.bootstrap_ticket) {
      return {
        ok: false,
        started: false,
        message: 'Desktop could not obtain a local host bootstrap ticket for this environment.',
      };
    }
    bootstrap = {
      ...controlPlaneBootstrap(
        authorized.controlPlane.provider.provider_origin,
        managedEnvironmentPublicID(environment),
        openSession.bootstrap_ticket,
      ),
    };
  }

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
      'desktop requested a managed runtime restart',
      {
        attached: true,
        local_ui_bind_override: localUIBind ?? '',
      },
    );
    await previousRuntimeHandle.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      started: false,
      message: message || 'Failed to stop the managed runtime.',
    };
  }

  sessionRecord.runtime_handle = null;

  const prepared = await prepareManagedTarget({
    environment,
    localUIBind,
    bootstrap,
  });
  if (!prepared.ok) {
    await finalizeSessionClosure(sessionRecord.session_key);
    await openUtilityWindow('launcher', {
      entryReason: prepared.entryReason,
      issue: prepared.issue,
      selectedManagedEnvironmentID: environment.id,
      stealAppFocus: true,
    });
    return {
      ok: false,
      started: false,
      message: prepared.issue.message,
    };
  }

  sessionRecord.runtime_handle = desktopSessionRuntimeHandleFromManagedRuntime(prepared.launch.managedRuntime, {
    persistedOwner: environment.local_hosting?.owner,
  });
  sessionRecord.startup = prepared.launch.managedRuntime.startup;
  sessionRecord.allowed_base_url = prepared.launch.managedRuntime.startup.local_ui_url;
  sessionRecord.target = buildManagedEnvironmentDesktopTarget(environment, { route: 'local_host' });
  await sessionRecord.diagnostics.configureRuntime(sessionRecord.startup, sessionRecord.allowed_base_url);
  await sessionRecord.diagnostics.recordLifecycle(
    prepared.launch.managedRuntime.attached ? 'runtime_attached' : 'runtime_started',
    prepared.launch.managedRuntime.attached ? 'desktop attached to an existing runtime' : 'desktop restarted a managed runtime',
    {
      attached: prepared.launch.managedRuntime.attached,
      spawned: prepared.launch.spawned,
      effective_run_mode: prepared.launch.managedRuntime.startup.effective_run_mode ?? '',
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

async function manageDesktopUpdateFromShell(webContentsID: number): Promise<DesktopShellRuntimeActionResponse> {
  const sessionRecord = sessionRecordForWebContentsID(webContentsID);
  if (!sessionRecord || sessionRecord.target.kind !== 'managed_environment') {
    return {
      ok: false,
      started: false,
      message: 'Desktop could not resolve the current environment.',
    };
  }
  if (sessionRecord.target.route === 'remote_desktop' || !sessionRecord.runtime_handle) {
    return {
      ok: false,
      started: false,
      message: 'This environment is hosted on another device. Run updates on the host device instead.',
    };
  }
  if (
    sessionRecord.runtime_handle.runtime_kind !== 'managed_environment'
    || sessionRecord.runtime_handle.lifecycle_owner !== 'desktop'
  ) {
    return {
      ok: false,
      started: false,
      message: 'This environment is managed by another Redeven host process on this device. Run updates from that host process instead.',
    };
  }

  const environmentKindLabel = sessionRecord.target.managed_environment_kind === 'controlplane'
    ? 'Control Plane environment'
    : 'Local environment';
  const detail = sessionRecord.target.managed_environment_kind === 'controlplane'
    ? 'Desktop will keep this environment in the same control-plane scope and may need a newer desktop release before redeploying the managed runtime.'
    : 'Desktop will keep this environment in the same local scope and may need a newer desktop release before restarting the managed runtime.';
  const dialogOptions: MessageBoxOptions = {
    type: 'info',
    buttons: ['Open release page', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Manage Desktop Update',
    message: `${sessionRecord.target.label} is managed by Redeven Desktop.`,
    detail: `${detail}\n\nAffected runtime: ${environmentKindLabel} on this device.\n\nDesktop and remote access will continue to resolve to the same environment after the update.`,
  };
  const parentWindow = currentParentWindow();
  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);
  if (result.response === 0) {
    await openExternalURL(PUBLIC_REDEVEN_RELEASE_BASE_URL);
  }
  return {
    ok: true,
    started: false,
    message: 'Desktop opened the update handoff.',
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

function selectedProviderEnvironmentFromWelcome(
  preferences: DesktopPreferences,
  selection: Readonly<{
    provider_origin?: string;
    provider_id?: string;
    env_public_id?: string;
  }>,
): Readonly<{
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
}> | null {
  const providerOrigin = String(selection.provider_origin ?? '').trim();
  const providerID = String(selection.provider_id ?? '').trim();
  const envPublicID = String(selection.env_public_id ?? '').trim();
  if (providerOrigin === '' && providerID === '' && envPublicID === '') {
    return null;
  }
  const controlPlane = savedControlPlaneByIdentity(preferences, providerOrigin, providerID);
  if (!controlPlane) {
    throw new Error('Connect this Control Plane in Desktop before saving the environment.');
  }
  const providerEnvironment = controlPlane.environments.find((environment) => environment.env_public_id === envPublicID) ?? null;
  if (!providerEnvironment) {
    throw new Error('Desktop could not find the selected Control Plane environment in the current catalog.');
  }
  return {
    provider_origin: controlPlane.provider.provider_origin,
    provider_id: controlPlane.provider.provider_id,
    env_public_id: providerEnvironment.env_public_id,
  };
}

async function upsertManagedEnvironmentFromWelcome(
  request: Readonly<{
    environment_id?: string;
    environment_name?: string;
    provider_origin?: string;
    provider_id?: string;
    env_public_id?: string;
  }>,
  draft: DesktopSettingsDraft,
  options: Readonly<{
    label: string;
  }>,
): Promise<DesktopManagedEnvironment> {
  const preferences = await loadDesktopPreferencesCached();
  const existing = request.environment_id ? findManagedEnvironmentByID(preferences, request.environment_id) : null;
  const existingAccess = existing ? managedEnvironmentLocalAccess(existing) : null;
  const providerSelection = selectedProviderEnvironmentFromWelcome(preferences, request);
  const access = validateDesktopSettingsDraft(draft, {
    currentLocalUIPassword: existingAccess?.local_ui_password ?? '',
    currentLocalUIPasswordConfigured: existingAccess?.local_ui_password_configured === true,
  });
  const next = upsertManagedEnvironment(preferences, {
    environment_id: request.environment_id,
    name: request.environment_name,
    label: options.label,
    access,
    provider_origin: providerSelection?.provider_origin,
    provider_id: providerSelection?.provider_id,
    env_public_id: providerSelection?.env_public_id,
    last_used_at_ms: existing?.last_used_at_ms ?? 0,
  });
  await persistDesktopPreferences(next);
  const resolvedEnvironment = providerSelection
    ? next.managed_environments.find((environment) => (
      managedEnvironmentProviderOrigin(environment) === providerSelection.provider_origin
      && managedEnvironmentProviderID(environment) === providerSelection.provider_id
      && managedEnvironmentPublicID(environment) === providerSelection.env_public_id
    )) ?? null
    : (
      (request.environment_id ? findManagedEnvironmentByID(next, request.environment_id) : null)
      ?? findManagedEnvironmentByID(next, desktopManagedLocalEnvironmentID(request.environment_name ?? ''))
    );
  if (!resolvedEnvironment) {
    throw new Error('Desktop could not save that managed environment.');
  }
  return resolvedEnvironment;
}

async function upsertSavedSSHEnvironmentFromWelcome(
  environmentID: string,
  label: string,
  details: DesktopSSHEnvironmentDetails,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const existing = preferences.saved_ssh_environments.find((environment) => environment.id === environmentID);
  const next = upsertSavedSSHEnvironment(preferences, {
    environment_id: environmentID,
    label,
    ssh_destination: details.ssh_destination,
    ssh_port: details.ssh_port,
    remote_install_dir: details.remote_install_dir,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
    source: 'saved',
    last_used_at_ms: existing?.last_used_at_ms ?? Date.now(),
  });
  await persistDesktopPreferences(next);
}

async function setManagedEnvironmentPinnedFromWelcome(
  environmentID: string,
  pinned: boolean,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(setManagedEnvironmentPinned(preferences, environmentID, pinned));
}

async function setSavedEnvironmentPinnedFromWelcome(
  environmentID: string,
  label: string,
  externalLocalUIURL: string,
  pinned: boolean,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const existing = preferences.saved_environments.find((environment) => environment.id === environmentID);
  await persistDesktopPreferences(setSavedEnvironmentPinned(preferences, {
    environment_id: environmentID,
    label,
    local_ui_url: externalLocalUIURL,
    pinned,
    last_used_at_ms: existing?.last_used_at_ms ?? Date.now(),
  }));
}

async function setSavedSSHEnvironmentPinnedFromWelcome(
  environmentID: string,
  label: string,
  details: DesktopSSHEnvironmentDetails,
  pinned: boolean,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const existing = preferences.saved_ssh_environments.find((environment) => environment.id === environmentID);
  await persistDesktopPreferences(setSavedSSHEnvironmentPinned(preferences, {
    environment_id: environmentID,
    label,
    pinned,
    last_used_at_ms: existing?.last_used_at_ms ?? Date.now(),
    ssh_destination: details.ssh_destination,
    ssh_port: details.ssh_port,
    remote_install_dir: details.remote_install_dir,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
  }));
}

async function deleteSavedEnvironmentFromWelcome(environmentID: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(deleteSavedEnvironment(preferences, environmentID));
}

async function deleteSavedSSHEnvironmentFromWelcome(environmentID: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(deleteSavedSSHEnvironment(preferences, environmentID));
}

async function deleteManagedEnvironmentStateDir(stateDir: string): Promise<void> {
  const cleanStateDir = String(stateDir ?? '').trim();
  if (cleanStateDir === '') {
    return;
  }

  const resolvedStateDir = path.resolve(cleanStateDir);
  const scopesRoot = path.join(preferencesPaths().stateRoot, 'scopes');
  const relativePath = path.relative(scopesRoot, resolvedStateDir);
  if (
    relativePath === ''
    || relativePath.startsWith('..')
    || path.isAbsolute(relativePath)
  ) {
    return;
  }
  await fs.rm(resolvedStateDir, { recursive: true, force: true });
}

async function deleteManagedEnvironmentFromWelcome(environmentID: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const result = deleteManagedEnvironment(preferences, environmentID);
  if (!result.deleted_environment) {
    return;
  }
  await persistDesktopPreferences(result.preferences);
  await deleteManagedEnvironmentStateDir(result.deleted_state_dir);
}

function hasLiveManagedEnvironmentSession(environmentID: string): boolean {
  const cleanEnvironmentID = String(environmentID ?? '').trim();
  if (cleanEnvironmentID === '') {
    return false;
  }
  for (const sessionRecord of sessionsByKey.values()) {
    if (
      !sessionRecord.closing
      && sessionRecord.target.kind === 'managed_environment'
      && sessionRecord.target.environment_id === cleanEnvironmentID
    ) {
      return true;
    }
  }
  return false;
}

async function performDesktopLauncherAction(request: DesktopLauncherActionRequest): Promise<DesktopLauncherActionResult> {
  switch (request.kind) {
    case 'open_managed_environment':
      return openManagedEnvironmentFromLauncher(request);
    case 'open_remote_environment':
      return openRemoteEnvironmentFromLauncher(request);
    case 'open_ssh_environment':
      return openSSHEnvironmentFromLauncher(request);
    case 'start_control_plane_connect':
      return startControlPlaneConnectFromLauncher(request);
    case 'set_managed_environment_pinned':
      await setManagedEnvironmentPinnedFromWelcome(request.environment_id, request.pinned);
      return launcherActionSuccess('saved_environment');
    case 'set_saved_environment_pinned':
      await setSavedEnvironmentPinnedFromWelcome(
        request.environment_id,
        request.label,
        request.external_local_ui_url,
        request.pinned,
      );
      return launcherActionSuccess('saved_environment');
    case 'set_saved_ssh_environment_pinned':
      await setSavedSSHEnvironmentPinnedFromWelcome(
        request.environment_id,
        request.label,
        {
          ssh_destination: request.ssh_destination,
          ssh_port: request.ssh_port,
          remote_install_dir: request.remote_install_dir,
          bootstrap_strategy: request.bootstrap_strategy,
          release_base_url: request.release_base_url,
        },
        request.pinned,
      );
      return launcherActionSuccess('saved_environment');
    case 'open_managed_environment_settings':
      return openUtilityWindow('launcher', {
        surface: 'managed_environment_settings',
        selectedManagedEnvironmentID: request.environment_id,
        stealAppFocus: true,
      });
    case 'focus_environment_window':
      return focusEnvironmentWindow(request.session_key);
    case 'open_control_plane_environment':
      return openControlPlaneEnvironmentFromLauncher(request);
    case 'refresh_control_plane':
      return refreshControlPlaneFromLauncher(request);
    case 'delete_control_plane':
      return deleteControlPlaneFromLauncher(request);
    case 'upsert_managed_environment':
      await upsertManagedEnvironmentFromWelcome({
        environment_id: request.environment_id,
        environment_name: request.environment_name,
        provider_origin: request.provider_origin,
        provider_id: request.provider_id,
        env_public_id: request.env_public_id,
      }, {
        local_ui_bind: request.local_ui_bind,
        local_ui_password: request.local_ui_password,
        local_ui_password_mode: request.local_ui_password_mode,
      }, {
        label: request.label,
      });
      return launcherActionSuccess('saved_environment');
    case 'upsert_saved_environment':
      await upsertSavedEnvironmentFromWelcome(request.environment_id, request.label, request.external_local_ui_url);
      return launcherActionSuccess('saved_environment');
    case 'upsert_saved_ssh_environment':
      await upsertSavedSSHEnvironmentFromWelcome(request.environment_id, request.label, {
        ssh_destination: request.ssh_destination,
        ssh_port: request.ssh_port,
        remote_install_dir: request.remote_install_dir,
        bootstrap_strategy: request.bootstrap_strategy,
        release_base_url: request.release_base_url,
      });
      return launcherActionSuccess('saved_environment');
    case 'delete_managed_environment':
      if (hasLiveManagedEnvironmentSession(request.environment_id)) {
        return launcherActionFailure(
          'environment_in_use',
          'environment',
          'Close the environment window before deleting it from this device.',
          {
            environmentID: request.environment_id,
          },
        );
      }
      await deleteManagedEnvironmentFromWelcome(request.environment_id);
      return launcherActionSuccess('deleted_environment');
    case 'delete_saved_environment':
      await deleteSavedEnvironmentFromWelcome(request.environment_id);
      return launcherActionSuccess('deleted_environment');
    case 'delete_saved_ssh_environment':
      await deleteSavedSSHEnvironmentFromWelcome(request.environment_id);
      return launcherActionSuccess('deleted_environment');
    case 'close_launcher_or_quit':
      if (openSessionSummaries().length <= 0) {
        await requestQuit();
        return launcherActionSuccess('quit_app');
      }
      await closeUtilityWindow('launcher');
      return launcherActionSuccess('closed_launcher', {
        utilityWindowKind: 'launcher',
      });
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
  for (const kind of UTILITY_WINDOW_KINDS) {
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

type DesktopDeepLinkRequest =
  | Readonly<{
      kind: 'connect_control_plane';
      provider_origin: string;
      handoff_ticket: string;
    }>
  | Readonly<{
      kind: 'open_control_plane_environment';
      provider_origin: string;
      provider_id?: string;
      env_public_id: string;
      handoff_ticket: string;
      label?: string;
    }>;

function detectDesktopDeepLink(argv: readonly string[]): string | null {
  return argv.find((value) => String(value ?? '').trim().toLowerCase().startsWith(`${DESKTOP_PROTOCOL_SCHEME}://`)) ?? null;
}

function parseDesktopDeepLink(rawURL: string): DesktopDeepLinkRequest | null {
  try {
    const parsed = new URL(String(rawURL ?? '').trim());
    if (parsed.protocol !== `${DESKTOP_PROTOCOL_SCHEME}:`) {
      return null;
    }

    if (parsed.hostname === 'control-plane' && parsed.pathname === '/connect') {
      const providerOrigin = String(parsed.searchParams.get('provider_origin') ?? '').trim();
      const handoffTicket = String(parsed.searchParams.get('handoff_ticket') ?? '').trim();
      if (providerOrigin === '' || handoffTicket === '') {
        return null;
      }
      return {
        kind: 'connect_control_plane',
        provider_origin: providerOrigin,
        handoff_ticket: handoffTicket,
      };
    }

    if (parsed.hostname === 'control-plane' && parsed.pathname === '/open') {
      const providerOrigin = String(parsed.searchParams.get('provider_origin') ?? '').trim();
      const envPublicID = String(parsed.searchParams.get('env_public_id') ?? '').trim();
      const handoffTicket = String(parsed.searchParams.get('handoff_ticket') ?? '').trim();
      const label = String(parsed.searchParams.get('label') ?? '').trim();
      if (providerOrigin === '' || envPublicID === '' || handoffTicket === '') {
        return null;
      }
      return {
        kind: 'open_control_plane_environment',
        provider_origin: providerOrigin,
        provider_id: String(parsed.searchParams.get('provider_id') ?? '').trim() || undefined,
        env_public_id: envPublicID,
        handoff_ticket: handoffTicket,
        label: label || undefined,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function connectControlPlaneFromDeepLink(
  request: Extract<DesktopDeepLinkRequest, Readonly<{ kind: 'connect_control_plane' }>>,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await saveConnectedControlPlane(
    preferences,
    request.provider_origin,
    undefined,
    request.handoff_ticket,
    undefined,
  );
  resetLauncherIssueState();
}

async function openControlPlaneEnvironmentFromDeepLink(
  request: Extract<DesktopDeepLinkRequest, Readonly<{ kind: 'open_control_plane_environment' }>>,
): Promise<DesktopLauncherActionResult> {
  const openSession = await exchangeProviderDesktopOpenHandoff(
    request.provider_origin,
    request.handoff_ticket,
  );
  return openControlPlaneEnvironmentWithOpenSession({
    providerOrigin: request.provider_origin,
    providerID: request.provider_id,
    envPublicID: request.env_public_id,
    bootstrapTicket: openSession.bootstrap_ticket,
    remoteSessionURL: openSession.remote_session_url,
    label: request.label,
  });
}

async function handleDesktopDeepLink(rawURL: string): Promise<void> {
  const request = parseDesktopDeepLink(rawURL);
  if (!request) {
    await openDesktopWelcomeWindow({
      entryReason: 'connect_failed',
      issue: buildControlPlaneIssue('control_plane_invalid', 'Desktop received an invalid Control Plane deep link.'),
      stealAppFocus: true,
    });
    return;
  }

  try {
    if (request.kind === 'connect_control_plane') {
      await connectControlPlaneFromDeepLink(request);
      await openDesktopWelcomeWindow({
        entryReason: openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch',
        stealAppFocus: true,
      });
      return;
    }

    await openControlPlaneEnvironmentFromDeepLink(request);
  } catch (error) {
    await openDesktopWelcomeWindow({
      entryReason: 'connect_failed',
      issue: controlPlaneIssueForError(
        error,
        'Desktop failed to process the Control Plane deep link.',
      ),
      stealAppFocus: true,
    });
  }
}

function queueDesktopDeepLink(rawURL: string): void {
  const clean = String(rawURL ?? '').trim();
  if (clean === '') {
    return;
  }
  pendingDesktopDeepLinks.push(clean);
  if (!app.isReady()) {
    return;
  }
  const nextURL = pendingDesktopDeepLinks.shift();
  if (nextURL) {
    void handleDesktopDeepLink(nextURL);
  }
}

function registerDesktopProtocolClient(): void {
  try {
    if (process.defaultApp) {
      app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL_SCHEME, process.execPath, [app.getAppPath()]);
      return;
    }
    app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL_SCHEME);
  } catch {
    // Best-effort only. Installed app metadata remains the source of truth.
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const initialDesktopDeepLink = detectDesktopDeepLink(process.argv);
  if (initialDesktopDeepLink) {
    pendingDesktopDeepLinks.push(initialDesktopDeepLink);
  }

  app.on('second-instance', (_event, argv) => {
    const deepLink = detectDesktopDeepLink(argv);
    if (deepLink) {
      queueDesktopDeepLink(deepLink);
      return;
    }
    void restoreBestAvailableWindow({ stealAppFocus: true });
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    queueDesktopDeepLink(url);
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
  ipcMain.on(DESKTOP_SESSION_CONTEXT_GET_CHANNEL, (event) => {
    const sessionRecord = sessionRecordForWebContentsID(event.sender.id);
    if (!sessionRecord || sessionRecord.target.kind !== 'managed_environment') {
      event.returnValue = null;
      return;
    }
    event.returnValue = {
      managed_environment_id: sessionRecord.target.environment_id,
      environment_storage_scope_id: sessionRecord.target.environment_id,
    };
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
      const selectedManagedEnvironmentID = currentUtilityWindowState('launcher').selectedManagedEnvironmentID || preferredManagedEnvironmentID(previous);
      const environment = findManagedEnvironmentByID(previous, selectedManagedEnvironmentID);
      if (!environment) {
        throw new Error('Desktop could not resolve the selected environment.');
      }
      const access = managedEnvironmentLocalAccess(environment);
      const validated = validateDesktopSettingsDraft(draft, {
        currentLocalUIPassword: access.local_ui_password,
        currentLocalUIPasswordConfigured: access.local_ui_password_configured,
      });
      const next = updateManagedEnvironmentAccess(previous, environment.id, validated);
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
      return launcherActionFailure(
        'action_invalid',
        'global',
        'Desktop could not understand that action.',
      );
    }
    try {
      return await performDesktopLauncherAction(normalized);
    } catch (error) {
      return launcherActionFailureFromUnexpectedError(error);
    }
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
  ipcMain.handle(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL, async (event, request): Promise<DesktopShellRuntimeActionResponse> => {
    const normalized = normalizeDesktopShellRuntimeActionRequest(request);
    if (!normalized) {
      return {
        ok: false,
        started: false,
        message: 'Invalid desktop runtime action.',
      };
    }

    if (normalized.action === 'restart_managed_runtime') {
      return restartManagedRuntimeFromShell(event.sender.id);
    }
    if (normalized.action === 'manage_desktop_update') {
      return manageDesktopUpdateFromShell(event.sender.id);
    }

    return {
      ok: false,
      started: false,
      message: 'Unsupported desktop runtime action.',
    };
  });
  ipcMain.on(CANCEL_DESKTOP_SETTINGS_CHANNEL, () => {
    setLauncherViewState({
      surface: 'connect_environment',
    });
    void emitDesktopWelcomeSnapshot('launcher');
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
    registerDesktopProtocolClient();
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
      if (pendingDesktopDeepLinks.length > 0) {
        while (pendingDesktopDeepLinks.length > 0) {
          const nextDeepLink = pendingDesktopDeepLinks.shift();
          if (!nextDeepLink) {
            continue;
          }
          await handleDesktopDeepLink(nextDeepLink);
        }
        if (openSessionSummaries().length <= 0 && !liveUtilityWindow('launcher')) {
          await openDesktopWelcomeWindow({ entryReason: 'app_launch' });
        }
        return;
      }
      await openDesktopWelcomeWindow({ entryReason: 'app_launch' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to start', message || 'Unknown startup error.');
      app.quit();
    }
  });

  app.on('activate', () => {
    void syncVisibleControlPlanesIfNeeded().catch(() => {
      // Best-effort refresh when the app becomes active again.
    });
    void restoreBestAvailableWindow().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to restore a window', message || 'Unknown restore error.');
      app.quit();
    });
  });

  powerMonitor.on('resume', () => {
    void syncVisibleControlPlanesIfNeeded({ force: true }).catch(() => {
      // Best-effort refresh after sleep/wake.
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
    updateControlPlaneSyncPoller();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
