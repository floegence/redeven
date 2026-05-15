import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, powerMonitor, safeStorage, session, shell, type MessageBoxOptions } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { attachManagedRuntimeFromStateFile, startManagedRuntime } from './runtimeProcess';
import { buildAppMenuTemplate } from './appMenu';
import {
  buildDesktopLastWindowCloseConfirmationModel,
  buildDesktopQuitConfirmationModel,
  buildDesktopQuitImpact,
  shouldConfirmDesktopLastWindowClose,
  shouldConfirmDesktopQuit,
  type DesktopQuitImpact,
  type DesktopQuitSource,
} from './desktopQuitImpact';
import {
  showDesktopConfirmationDialog,
} from './desktopConfirmation';
import type { DesktopConfirmationDialogModel } from '../shared/desktopConfirmationContract';
import {
  createSafeStorageSecretCodec,
  deleteSavedControlPlane,
  deleteSavedEnvironment,
  deleteSavedRuntimeTarget,
  deleteSavedSSHEnvironment,
  defaultDesktopPreferencesPaths,
  findLocalEnvironmentByID,
  findProviderEnvironmentByID,
  loadDesktopPreferences,
  rememberLocalEnvironmentUse,
  rememberProviderEnvironmentUse,
  markSavedEnvironmentUsed,
  markSavedRuntimeTargetUsed,
  markSavedSSHEnvironmentUsed,
  saveDesktopPreferences,
  setLocalEnvironmentPinned,
  setProviderEnvironmentPinned,
  setSavedEnvironmentPinned,
  setSavedRuntimeTargetPinned,
  setSavedSSHEnvironmentPinned,
  updateLocalEnvironmentAccess,
  upsertSavedControlPlane,
  upsertSavedEnvironment,
  upsertSavedRuntimeTarget,
  upsertSavedSSHEnvironment,
  validateDesktopSettingsDraft,
  type DesktopPreferences,
  type DesktopSavedControlPlane,
} from './desktopPreferences';
import {
  buildLocalEnvironmentDesktopTarget,
  buildManagedLocalRuntimeDesktopTarget,
  desktopSessionKeyFromRuntimeTargetID,
  buildExternalLocalUIDesktopTarget,
  buildProviderEnvironmentDesktopTarget,
  buildSSHDesktopTarget,
  desktopSessionStateKeyFragment,
  externalLocalUIDesktopSessionKey,
  sshDesktopSessionKey,
  type DesktopSessionLifecycle,
  type DesktopSessionKey,
  type DesktopSessionSummary,
  type DesktopSessionTarget,
} from './desktopTarget';
import {
  buildDesktopRuntimeLaunchPlan,
} from './desktopLaunch';
import { parseLocalUIBind } from './localUIBind';
import {
  buildBlockedLaunchIssue,
  buildControlPlaneIssue,
  buildDesktopWelcomeSnapshot,
  desktopProviderRuntimeLinkTargetID,
  buildRemoteConnectionIssue,
  type BuildDesktopWelcomeSnapshotArgs,
} from './desktopWelcomeState';
import { hydrateWelcomeLocalEnvironmentRuntimeState } from './desktopWelcomeRuntimeState';
import { defaultDesktopStateStorePath, DesktopStateStore } from './desktopStateStore';
import { DesktopThemeState } from './desktopThemeState';
import { loadOrCreateDesktopRuntimeOwnerID } from './desktopRuntimeOwner';
import { readBundledDesktopRuntimeIdentity, type DesktopRuntimeIdentity } from './desktopRuntimeIdentity';
import { DesktopDiagnosticsRecorder } from './diagnostics';
import { LauncherOperationRegistry, launcherOperationProgress } from './launcherOperations';
import { buildLocalUIEnvAppEntryURL } from './localUIURL';
import { isAllowedAppNavigation } from './navigation';
import { resolveBundledRuntimePath, resolveSessionPreloadPath, resolveUtilityPreloadPath, resolveWelcomeRendererPath } from './paths';
import { loadExternalLocalUIStartup } from './runtimeState';
import {
  RuntimeControlError,
  connectProviderLink,
  disconnectProviderLink,
} from './runtimeControlClient';
import { desktopSessionRuntimeHandleFromManagedRuntime, type DesktopSessionRuntimeHandle } from './sessionRuntime';
import {
  DesktopSSHRuntimeCanceledError,
  DesktopSSHRuntimeMaintenanceRequiredError,
  startManagedSSHRuntime,
} from './sshRuntime';
import {
  containerListCommand,
  containerInspectCommand,
  parseContainerListOutput,
  parseContainerInspectJSON,
} from './containerRuntime';
import {
  createLocalRuntimeHostExecutor,
  createSSHRuntimeHostExecutor,
} from './runtimeHostAccess';
import {
  startRuntimePlacementBridgeSession,
  type RuntimePlacementBridgeSession,
} from './runtimePlacementBridgeSession';
import { startDesktopAIBroker, type ManagedDesktopAIBroker } from './desktopAIBroker';
import { PUBLIC_REDEVEN_RELEASE_BASE_URL } from './sshReleaseAssets';
import { installStdioBrokenPipeGuards } from './stdio';
import type { StartupReport } from './startup';
import {
  projectProviderEnvironmentToLocalRuntimeTarget,
  localEnvironmentStateKind,
  localEnvironmentAccess,
  localEnvironmentProviderID,
  localEnvironmentProviderOrigin,
  localEnvironmentPublicID,
  type DesktopLocalEnvironmentState,
} from '../shared/desktopLocalEnvironmentState';
import {
  createDesktopProviderEnvironmentRecord,
  desktopProviderEnvironmentID,
  type DesktopProviderEnvironmentRecord,
} from '../shared/desktopProviderEnvironment';
import {
  exchangeProviderDesktopConnectAuthorization,
  fetchProviderAccount,
  fetchProviderDiscovery,
  fetchProviderEnvironments,
  queryProviderEnvironmentRuntimeHealth,
  refreshProviderDesktopAccessToken,
  revokeProviderDesktopAuthorization,
  requestDesktopOpenSession,
} from './controlPlaneProviderClient';
import {
  buildControlPlaneAuthorizationBrowserURL,
  createPendingControlPlaneAuthorization,
  isPendingControlPlaneAuthorizationExpired,
  type PendingControlPlaneAuthorization,
} from './controlPlaneAuthorization';
import { DesktopProviderRequestError } from './controlPlaneProviderTransport';
import {
  applyRestoredWindowState,
  attachDesktopWindowStatePersistence,
  restoreBrowserWindowBounds,
} from './windowState';
import {
  closedWindowSnapshot,
  liveTrackedBrowserWindow,
  trackBrowserWindow,
  type DesktopClosedWindowSnapshot,
  type DesktopTrackedWindow,
} from './windowRecord';
import { resolveDesktopWindowSpec } from './windowSpec';
import {
  attachDesktopWindowChromeBroadcast,
  buildDesktopWindowChromeOptions,
  desktopWindowChromeSnapshotForWindow,
} from './windowChrome';
import {
  buildConsoleMessageDetail,
  buildPreloadErrorDetail,
  buildRenderProcessGoneDetail,
  buildWindowLifecycleContext,
  shouldCaptureElectronBootstrapConsoleMessage,
} from './windowLifecycleDiagnostics';
import { performDesktopShellWindowCommand } from './desktopShellWindowCommands';
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
import { DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL } from '../shared/windowChromeIPC';
import {
  DESKTOP_SHELL_OPEN_WINDOW_CHANNEL,
  normalizeDesktopShellOpenWindowRequest,
} from '../shared/desktopShellWindowIPC';
import {
  DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL,
  normalizeDesktopShellWindowCommandRequest,
  type DesktopShellWindowCommandResponse,
} from '../shared/desktopShellWindowCommandIPC';
import {
  DESKTOP_SHELL_RUNTIME_MAINTENANCE_CONTEXT_CHANNEL,
  DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL,
  normalizeDesktopShellRuntimeActionRequest,
  type DesktopShellRuntimeMaintenanceActionPlan,
  type DesktopShellRuntimeMaintenanceContext,
  type DesktopShellRuntimeMaintenanceMethod,
  type DesktopShellRuntimeActionResponse,
} from '../shared/desktopShellRuntimeIPC';
import {
  DESKTOP_DASHBOARD_URL,
  DESKTOP_SHELL_OPEN_DASHBOARD_CHANNEL,
  DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL,
  normalizeDesktopShellOpenExternalURLRequest,
  type DesktopShellOpenExternalURLResponse,
} from '../shared/desktopShellExternalURLIPC';
import {
  DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL,
  DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL,
  DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL,
  DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL,
  type DesktopLauncherActionProgress,
  type DesktopLauncherOperationSnapshot,
  normalizeDesktopLauncherActionRequest,
  type DesktopLauncherActionFailure,
  type DesktopLauncherActionFailureCode,
  type DesktopLauncherActionFailureScope,
  type DesktopLauncherActionRequest,
  type DesktopLauncherActionResult,
  type DesktopLauncherActionSuccess,
  type DesktopLauncherSurface,
  type DesktopWelcomeSnapshot,
  type DesktopWelcomeEntryReason,
  type DesktopWelcomeIssue,
} from '../shared/desktopLauncherIPC';
import { DESKTOP_LAUNCHER_GET_SSH_CONFIG_HOSTS_CHANNEL } from '../shared/desktopSSHConfig';
import {
  DESKTOP_LAUNCHER_LIST_RUNTIME_CONTAINERS_CHANNEL,
  normalizeDesktopRuntimeContainerListRequest,
  type DesktopRuntimeContainerListResponse,
} from '../shared/desktopContainerRuntime';
import {
  DESKTOP_SESSION_APP_READY_CHANNEL,
  DESKTOP_SESSION_CONTEXT_GET_CHANNEL,
  type DesktopSessionAppReadyPayload,
  type DesktopSessionContextSnapshot,
} from '../shared/desktopSessionContextIPC';
import {
  desktopControlPlaneKey,
  normalizeControlPlaneOrigin,
  type DesktopControlPlaneSummary,
  type DesktopProviderEnvironmentRuntimeHealth,
} from '../shared/controlPlaneProvider';
import {
  desktopSSHRuntimeAffectingSettingsMatch,
  defaultSavedSSHEnvironmentLabel,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import type {
  DesktopRuntimeHealth,
  DesktopRuntimeMaintenanceRequirement,
} from '../shared/desktopRuntimeHealth';
import {
  desktopRuntimeControlStatusAvailable,
  desktopRuntimeControlStatusMissing,
  desktopRuntimeControlStatusOwnerMismatch,
  type DesktopManagedRuntimePresence,
  type DesktopRuntimeControlStatus,
} from '../shared/desktopRuntimePresence';
import {
  desktopRuntimeTargetID,
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
  type DesktopRuntimeTargetID,
} from '../shared/desktopRuntimePlacement';
import {
  desktopProviderCatalogFreshness,
  desktopProviderRemoteRouteState,
  type DesktopControlPlaneSyncState,
  type DesktopProviderRemoteRouteState,
} from '../shared/providerEnvironmentState';
import {
  normalizeRuntimeServiceSnapshot,
  runtimeServiceProviderLinkBinding,
  runtimeServiceSupportsProviderLink,
  runtimeServiceOpenReadinessLabel,
  runtimeServiceIsOpenable,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';
import {
  buildDesktopLocalRuntimeOpenPlan,
  desktopRuntimeProviderBindingMatches,
} from '../shared/localRuntimeSupervisor';
import {
  desktopProviderRuntimeLinkTargetKindFromID,
  desktopProviderRuntimeLinkTargetRuntimeKey,
  type DesktopProviderRuntimeLinkTargetID,
} from '../shared/providerRuntimeLinkTarget';
import { desktopProviderEnvironmentOpenRoute } from '../shared/environmentManagementPrinciples';
import { loadDesktopSSHConfigHosts } from './sshConfigHosts';

type OpenDesktopWelcomeOptions = Readonly<{
  surface?: DesktopLauncherSurface;
  entryReason?: DesktopWelcomeEntryReason;
  issue?: DesktopWelcomeIssue | null;
  selectedEnvironmentID?: string;
  stealAppFocus?: boolean;
}>;

type DesktopWindowSurface = 'utility' | 'session';
type DesktopUtilityWindowKind = 'launcher';

type DesktopUtilityWindowState = Readonly<{
  surface: DesktopLauncherSurface;
  entryReason: DesktopWelcomeEntryReason;
  issue: DesktopWelcomeIssue | null;
  selectedEnvironmentID: string;
}>;

type DesktopSessionRecord = {
  session_key: DesktopSessionKey;
  target: DesktopSessionTarget;
  startup: StartupReport;
  entry_url: string;
  allowed_base_url: string;
  root_window: DesktopTrackedWindow;
  child_windows: Map<string, DesktopTrackedWindow>;
  diagnostics: DesktopDiagnosticsRecorder;
  runtime_handle: DesktopSessionRuntimeHandle | null;
  stop_runtime_on_close: boolean;
  steal_app_focus_on_ready: boolean;
  lifecycle: DesktopSessionLifecycle;
  initial_load_completion: Promise<void>;
  resolve_initial_load: (() => void) | null;
  reject_initial_load: ((error: Error) => void) | null;
  app_ready_state: DesktopSessionAppReadyPayload['state'] | '';
  initial_load_failure_message: string;
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

type LocalEnvironmentRuntimeRecord = Readonly<{
  environment_id: string;
  label: string;
  state_file: string;
  startup: StartupReport;
  runtime_handle: DesktopSessionRuntimeHandle;
}>;

type SSHEnvironmentRuntimeRecord = Readonly<{
  runtime_key: `ssh:${string}`;
  environment_id: string;
  label: string;
  details: DesktopSSHEnvironmentDetails;
  startup: StartupReport;
  local_forward_url: string;
  runtime_control_forward_url?: string;
  runtime_handle: DesktopSessionRuntimeHandle;
  disconnect: () => Promise<void>;
  stop: () => Promise<void>;
}>;

type RuntimePlacementBridgeRecord = Readonly<{
  runtime_key: string;
  environment_id: string;
  label: string;
  target_id: DesktopProviderRuntimeLinkTargetID;
  session: RuntimePlacementBridgeSession;
  startup: StartupReport;
  runtime_handle: DesktopSessionRuntimeHandle;
}>;

type SavedRuntimeTargetState = Readonly<{
  running: boolean;
  startup?: StartupReport;
  local_ui_url: string;
  runtime_service?: RuntimeServiceSnapshot;
  runtime_control_status: DesktopRuntimeControlStatus;
  lifecycle_control: DesktopManagedRuntimePresence['lifecycle_control'];
}>;

type PendingSSHRuntimeStart = Readonly<{
  runtime_key: `ssh:${string}`;
  environment_id: string;
  label: string;
  operation_key: string;
  task: Promise<SSHEnvironmentRuntimeRecord>;
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
  onDidFailLoad?: (details: Readonly<{
    win: BrowserWindow;
    errorCode: number;
    errorDescription: string;
    validatedURL: string;
    isMainFrame: boolean;
  }>) => void;
  onClosed?: (win: DesktopClosedWindowSnapshot) => void;
  presentOnReadyToShow?: boolean;
}>;

const utilityWindows = new Map<DesktopUtilityWindowKind, DesktopTrackedWindow>();
const utilityWindowState = new Map<DesktopUtilityWindowKind, DesktopUtilityWindowState>([
  ['launcher', { surface: 'connect_environment', entryReason: 'app_launch', issue: null, selectedEnvironmentID: '' }],
]);
const utilityWindowKindByWebContentsID = new Map<number, DesktopUtilityWindowKind>();
const UTILITY_WINDOW_KINDS = ['launcher'] as const;
const sessionsByKey = new Map<DesktopSessionKey, DesktopSessionRecord>();
const sessionKeyByWebContentsID = new Map<number, DesktopSessionKey>();
const sessionCloseTasks = new Map<DesktopSessionKey, Promise<void>>();
const confirmedFinalWindowCloseWebContentsIDs = new Set<number>();
const windowStateCleanup = new Map<BrowserWindow, () => void>();
let lastFocusedSessionKey: DesktopSessionKey | null = null;
let quitPhase: 'idle' | 'confirming' | 'requested' | 'shutting_down' = 'idle';
let desktopPreferencesCache: DesktopPreferences | null = null;
let desktopStateStoreCache: DesktopStateStore | null = null;
let desktopThemeStateCache: DesktopThemeState | null = null;
let desktopRuntimeOwnerIDTask: Promise<string> | null = null;
let bundledRuntimeIdentityCache: DesktopRuntimeIdentity | null | undefined;
const controlPlaneAccessStateByKey = new Map<string, DesktopControlPlaneAccessState>();
const controlPlaneSyncStateByKey = new Map<string, DesktopControlPlaneSyncRecord>();
const providerRuntimeHealthByControlPlaneKey = new Map<string, Map<string, DesktopProviderEnvironmentRuntimeHealth>>();
const pendingControlPlaneAuthorizationsByState = new Map<string, PendingControlPlaneAuthorization>();
const controlPlaneSyncTaskByKey = new Map<string, Promise<Readonly<{
  preferences: DesktopPreferences;
  controlPlane: DesktopSavedControlPlane;
}>>>();
let localEnvironmentRuntimeRecord: LocalEnvironmentRuntimeRecord | null = null;
const sshEnvironmentRuntimeByKey = new Map<`ssh:${string}`, SSHEnvironmentRuntimeRecord>();
const pendingSSHRuntimeStartByKey = new Map<`ssh:${string}`, PendingSSHRuntimeStart>();
const sshRuntimeMaintenanceByKey = new Map<`ssh:${string}`, DesktopRuntimeMaintenanceRequirement>();
const runtimePlacementBridgeByTargetID = new Map<DesktopRuntimeTargetID, RuntimePlacementBridgeRecord>();
const launcherOperationRemovalTimers = new Map<string, ReturnType<typeof setTimeout>>();
const launcherOperations = new LauncherOperationRegistry(handleLauncherOperationChange);
const desktopDevToolsEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.REDEVEN_DESKTOP_OPEN_DEVTOOLS ?? '').trim().toLowerCase(),
);
const DESKTOP_PROTOCOL_SCHEME = 'redeven';
const CONTROL_PLANE_ACCESS_TOKEN_EXPIRY_SKEW_MS = 15_000;
const CONTROL_PLANE_SYNC_POLL_INTERVAL_MS = 15_000;
const WELCOME_RUNTIME_POLL_INTERVAL_MS = 5_000;
const DESKTOP_RUNTIME_PROBE_TIMEOUT_MS = 1_500;
const DESKTOP_SESSION_INITIAL_LOAD_TIMEOUT_MS = 15_000;
const DESKTOP_STALE_WINDOW_MESSAGE = 'That window was already closed. Desktop refreshed the environment list.';
const DESKTOP_PROVIDER_RECONNECT_MESSAGE = 'Desktop needs fresh provider authorization before it can open or connect this provider Environment.';
const DESKTOP_GPU_TILE_MEMORY_BUDGET_MB = 2048;
const pendingDesktopDeepLinks: string[] = [];
let controlPlaneSyncPollTimer: NodeJS.Timeout | null = null;
let welcomeRuntimePollTimer: NodeJS.Timeout | null = null;
let desktopWelcomeSnapshotRevision = 0;

// Apply before Electron is ready so Chromium sizes compositor tile memory for desktop Workbench surfaces.
app.commandLine.appendSwitch('force-gpu-mem-available-mb', String(DESKTOP_GPU_TILE_MEMORY_BUDGET_MB));
installStdioBrokenPipeGuards();

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function bundledRuntimeExecutablePath(): string {
  return resolveBundledRuntimePath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
}

function bundledRuntimeIdentity(): DesktopRuntimeIdentity | null {
  if (bundledRuntimeIdentityCache !== undefined) {
    return bundledRuntimeIdentityCache;
  }
  try {
    bundledRuntimeIdentityCache = readBundledDesktopRuntimeIdentity(bundledRuntimeExecutablePath());
  } catch {
    bundledRuntimeIdentityCache = null;
  }
  return bundledRuntimeIdentityCache;
}

async function desktopRuntimeOwnerID(): Promise<string> {
  if (!desktopRuntimeOwnerIDTask) {
    desktopRuntimeOwnerIDTask = loadOrCreateDesktopRuntimeOwnerID(app.getPath('userData'));
  }
  return desktopRuntimeOwnerIDTask;
}

function localEnvironmentRuntimeStateFile(environment: DesktopLocalEnvironmentState): string {
  const stateDir = compact(environment.local_hosting.state_dir);
  return stateDir === '' ? '' : path.join(stateDir, 'runtime', 'local-ui.json');
}

function localRuntimeMatchesProvider(
  startup: StartupReport | null | undefined,
  environment: DesktopProviderEnvironmentRecord,
): boolean {
  return desktopRuntimeProviderBindingMatches(
    runtimeServiceProviderLinkBinding(startup?.runtime_service),
    {
      provider_origin: environment.provider_origin,
      provider_id: compact(environment.provider_id),
      env_public_id: compact(environment.env_public_id),
    },
  );
}

function providerRuntimeLinkKindForHostAccess(
  hostAccess: DesktopRuntimeHostAccess,
): 'local_environment' | 'ssh_environment' {
  return hostAccess.kind === 'ssh_host' ? 'ssh_environment' : 'local_environment';
}

function providerRuntimeLinkTargetIDForRuntimeTarget(
  hostAccess: DesktopRuntimeHostAccess,
  runtimeTargetID: DesktopRuntimeTargetID,
): DesktopProviderRuntimeLinkTargetID {
  return desktopProviderRuntimeLinkTargetID(
    providerRuntimeLinkKindForHostAccess(hostAccess),
    runtimeTargetID,
  );
}

function bridgeRecordFromSession(input: Readonly<{
  environmentID: string;
  label: string;
  session: RuntimePlacementBridgeSession;
}>): RuntimePlacementBridgeRecord {
  const runtimeKey = input.session.placement_target_id;
  return {
    runtime_key: runtimeKey,
    environment_id: compact(input.environmentID) || runtimeKey,
    label: compact(input.label) || 'Container Runtime',
    target_id: providerRuntimeLinkTargetIDForRuntimeTarget(input.session.host_access, runtimeKey),
    session: input.session,
    startup: input.session.startup,
    runtime_handle: input.session.runtime_handle,
  };
}

type ProviderRuntimeLinkTargetRecord = Readonly<
  | {
      kind: 'local_environment';
      id: DesktopProviderRuntimeLinkTargetID;
      label: string;
      record: LocalEnvironmentRuntimeRecord | RuntimePlacementBridgeRecord;
    }
  | {
      kind: 'ssh_environment';
      id: DesktopProviderRuntimeLinkTargetID;
      label: string;
      record: SSHEnvironmentRuntimeRecord | RuntimePlacementBridgeRecord;
    }
>;

async function resolveProviderRuntimeLinkTarget(
  preferences: DesktopPreferences,
  runtimeTargetID: DesktopProviderRuntimeLinkTargetID,
): Promise<ProviderRuntimeLinkTargetRecord | null> {
  // IMPORTANT: Provider-link operations must resolve the exact Local/SSH runtime
  // target selected by the user. Do not search for "any eligible" runtime here;
  // implicit selection would let provider-card flows affect device-managed work.
  const kind = desktopProviderRuntimeLinkTargetKindFromID(runtimeTargetID);
  const runtimeKey = desktopProviderRuntimeLinkTargetRuntimeKey(runtimeTargetID);
  if (kind === 'local_environment') {
    if (runtimeKey !== preferences.local_environment.id) {
      const bridgeRecord = runtimePlacementBridgeByTargetID.get(runtimeKey as DesktopRuntimeTargetID) ?? null;
      if (!bridgeRecord || bridgeRecord.target_id !== runtimeTargetID || bridgeRecord.session.host_access.kind !== 'local_host') {
        return null;
      }
      return {
        kind,
        id: runtimeTargetID,
        label: bridgeRecord.label,
        record: bridgeRecord,
      };
    }
    const record = currentLocalEnvironmentRuntimeRecord(preferences.local_environment)
      ?? await attachLocalEnvironmentRuntime(preferences.local_environment);
    return record
      ? {
          kind,
          id: runtimeTargetID,
          label: preferences.local_environment.label,
          record,
        }
      : null;
  }
  const bridgeRecord = runtimePlacementBridgeByTargetID.get(runtimeKey as DesktopRuntimeTargetID) ?? null;
  if (bridgeRecord && bridgeRecord.target_id === runtimeTargetID && bridgeRecord.session.host_access.kind === 'ssh_host') {
    return {
      kind,
      id: runtimeTargetID,
      label: bridgeRecord.label,
      record: bridgeRecord,
    };
  }
  const record = sshEnvironmentRuntimeByKey.get(runtimeKey as `ssh:${string}`) ?? null;
  return record
    ? {
        kind,
        id: runtimeTargetID,
        label: record.label,
        record,
      }
    : null;
}

function updateProviderRuntimeTargetStartup(
  target: ProviderRuntimeLinkTargetRecord,
  startupPatch: Partial<StartupReport>,
): void {
  if ('session' in target.record) {
    const record = target.record;
    const updatedRecord: RuntimePlacementBridgeRecord = {
      ...record,
      startup: {
        ...record.startup,
        ...startupPatch,
        runtime_control: startupPatch.runtime_control ?? record.startup.runtime_control,
      },
    };
    runtimePlacementBridgeByTargetID.set(record.session.placement_target_id, updatedRecord);
    return;
  }
  if (target.kind === 'local_environment') {
    updateLocalEnvironmentRuntimeRecordStartup(target.record, startupPatch);
    return;
  }
  const updatedRecord: SSHEnvironmentRuntimeRecord = {
    ...target.record,
    startup: {
      ...target.record.startup,
      ...startupPatch,
      runtime_control: startupPatch.runtime_control ?? target.record.startup.runtime_control,
    },
  };
  sshEnvironmentRuntimeByKey.set(target.record.runtime_key, updatedRecord);
}

function runtimeTargetProviderBindingFailure(
  environment: DesktopProviderEnvironmentRecord,
  runtimeLabel: string,
  startup: StartupReport | null | undefined,
): DesktopLauncherActionFailure {
  const current = runtimeServiceProviderLinkBinding(startup?.runtime_service);
  return launcherActionFailure(
    'environment_in_use',
    'environment',
    current.state === 'linked'
      ? `${runtimeLabel} is currently linked to another provider Environment. Disconnect it from its runtime card before connecting this provider.`
      : `${runtimeLabel} is not linked to this provider Environment.`,
    providerEnvironmentFailureContext(environment),
  );
}

type ProviderDesktopSessionMaterial = Readonly<{
  preferences: DesktopPreferences;
  controlPlane: DesktopSavedControlPlane;
  bootstrapTicket: string;
  remoteSessionURL: string;
  label: string;
}>;

function launcherActionFailureForMissingProviderEnvironment(
  environment: DesktopProviderEnvironmentRecord,
): DesktopLauncherActionFailure {
  return launcherActionFailure(
    'control_plane_missing',
    'control_plane',
    'This provider is no longer saved in Desktop. Reconnect the provider, then try this Environment again.',
    providerEnvironmentFailureContext(environment),
  );
}

async function resolveProviderDesktopSessionTarget(
  preferences: DesktopPreferences,
  environment: DesktopProviderEnvironmentRecord,
): Promise<Readonly<{
  preferences: DesktopPreferences;
  controlPlane: DesktopSavedControlPlane;
  environmentLabel: string;
}>> {
  const initialState = controlPlaneRouteSnapshot(
    preferences,
    environment.provider_origin,
    environment.provider_id,
    environment.env_public_id,
  );
  if (!initialState.controlPlane) {
    throw launcherActionFailureForMissingProviderEnvironment(environment);
  }
  let synchronized = {
    preferences,
    controlPlane: initialState.controlPlane,
  };
  if (initialState.summary?.catalog_freshness !== 'fresh') {
    synchronized = await syncSavedControlPlaneAccountWithState(
      environment.provider_origin,
      environment.provider_id,
      { force: true },
    );
  }
  const latestState = controlPlaneRouteSnapshot(
    synchronized.preferences,
    environment.provider_origin,
    environment.provider_id,
    environment.env_public_id,
  );
  if (!latestState.controlPlane) {
    throw launcherActionFailureForMissingProviderEnvironment(environment);
  }
  return {
    preferences: synchronized.preferences,
    controlPlane: latestState.controlPlane,
    environmentLabel: latestState.environment?.label ?? environment.label,
  };
}

async function requestProviderDesktopSessionMaterial(
  preferences: DesktopPreferences,
  environment: DesktopProviderEnvironmentRecord,
): Promise<ProviderDesktopSessionMaterial> {
  const target = await resolveProviderDesktopSessionTarget(preferences, environment);
  const authorized = await ensureControlPlaneAccessToken(target.preferences, target.controlPlane);
  const openSession = await requestDesktopOpenSession(
    authorized.controlPlane.provider,
    authorized.accessToken,
    environment.env_public_id,
  );
  return {
    preferences: authorized.preferences,
    controlPlane: authorized.controlPlane,
    bootstrapTicket: compact(openSession.bootstrap_ticket),
    remoteSessionURL: compact(openSession.remote_session_url),
    label: target.environmentLabel,
  };
}

async function prepareProviderRemoteOpenSession(
  preferences: DesktopPreferences,
  environment: DesktopProviderEnvironmentRecord,
): Promise<ProviderDesktopSessionMaterial> {
  // IMPORTANT: Provider Environment Open is remote-only provider tunnel access.
  // It must keep route-readiness checks separate from provider-link tickets so
  // connecting a runtime never depends on, or mutates, the provider Open route.
  const target = await resolveProviderDesktopSessionTarget(preferences, environment);
  const latestState = controlPlaneRouteSnapshot(
    target.preferences,
    environment.provider_origin,
    environment.provider_id,
    environment.env_public_id,
  );
  const routeFailure = launcherActionFailureForRemoteRouteState(latestState.remoteRouteState, {
    environmentID: environment.id,
    providerOrigin: environment.provider_origin,
    providerID: environment.provider_id,
    envPublicID: environment.env_public_id,
  });
  if (routeFailure) {
    throw routeFailure;
  }
  const authorized = await ensureControlPlaneAccessToken(target.preferences, target.controlPlane);
  const openSession = await requestDesktopOpenSession(
    authorized.controlPlane.provider,
    authorized.accessToken,
    environment.env_public_id,
  );
  return {
    preferences: authorized.preferences,
    controlPlane: authorized.controlPlane,
    bootstrapTicket: compact(openSession.bootstrap_ticket),
    remoteSessionURL: compact(openSession.remote_session_url),
    label: target.environmentLabel,
  };
}

function providerEnvironmentFailureContext(environment: DesktopProviderEnvironmentRecord): Readonly<{
  environmentID: string;
  providerOrigin: string;
  providerID: string;
  envPublicID: string;
  shouldRefreshSnapshot: true;
}> {
  return {
    environmentID: environment.id,
    providerOrigin: environment.provider_origin,
    providerID: environment.provider_id,
    envPublicID: environment.env_public_id,
    shouldRefreshSnapshot: true,
  };
}

function localEnvironmentForProviderBinding(
  preferences: DesktopPreferences,
  providerEnvironment: DesktopProviderEnvironmentRecord,
): DesktopLocalEnvironmentState {
  return projectProviderEnvironmentToLocalRuntimeTarget(
    providerEnvironment,
    preferences.local_environment,
  );
}

function persistLocalEnvironmentProviderBinding(
  preferences: DesktopPreferences,
  providerEnvironment: DesktopProviderEnvironmentRecord,
): DesktopPreferences {
  const projected = localEnvironmentForProviderBinding(preferences, providerEnvironment);
  return {
    ...preferences,
    local_environment: {
      ...projected,
      label: preferences.local_environment.label,
      pinned: preferences.local_environment.pinned,
      created_at_ms: preferences.local_environment.created_at_ms,
      updated_at_ms: projected.updated_at_ms,
      last_used_at_ms: Math.max(projected.last_used_at_ms, preferences.local_environment.last_used_at_ms),
    },
  };
}

function localEnvironmentRuntimeRecordFromHandle(
  environment: DesktopLocalEnvironmentState,
  startup: StartupReport,
  runtimeHandle: DesktopSessionRuntimeHandle,
): LocalEnvironmentRuntimeRecord {
  return {
    environment_id: environment.id,
    label: environment.label,
    state_file: localEnvironmentRuntimeStateFile(environment),
    startup,
    runtime_handle: runtimeHandle,
  };
}

function updateLocalEnvironmentRuntimeRecord(
  environment: DesktopLocalEnvironmentState,
  startup: StartupReport,
  runtimeHandle: DesktopSessionRuntimeHandle,
): LocalEnvironmentRuntimeRecord {
  const record = localEnvironmentRuntimeRecordFromHandle(environment, startup, runtimeHandle);
  localEnvironmentRuntimeRecord = record;
  return record;
}

function updateLocalEnvironmentRuntimeRecordStartup(
  record: LocalEnvironmentRuntimeRecord,
  startupPatch: Partial<StartupReport>,
): LocalEnvironmentRuntimeRecord {
  const updatedRecord: LocalEnvironmentRuntimeRecord = {
    ...record,
    startup: {
      ...record.startup,
      ...startupPatch,
      runtime_control: startupPatch.runtime_control ?? record.startup.runtime_control,
    },
  };
  localEnvironmentRuntimeRecord = updatedRecord;
  return updatedRecord;
}

function currentLocalEnvironmentRuntimeRecord(
  environment: DesktopLocalEnvironmentState,
): LocalEnvironmentRuntimeRecord | null {
  const record = localEnvironmentRuntimeRecord;
  if (!record || record.environment_id !== environment.id) {
    return null;
  }
  return record;
}

function clearLocalEnvironmentRuntimeRecord(environment: DesktopLocalEnvironmentState): void {
  if (localEnvironmentRuntimeRecord?.environment_id === environment.id) {
    localEnvironmentRuntimeRecord = null;
  }
}

function providerRuntimeHealthMap(
  providerOrigin: string,
  providerID: string,
): Map<string, DesktopProviderEnvironmentRuntimeHealth> {
  const key = desktopControlPlaneKey(providerOrigin, providerID);
  let record = providerRuntimeHealthByControlPlaneKey.get(key) ?? null;
  if (!record) {
    record = new Map<string, DesktopProviderEnvironmentRuntimeHealth>();
    providerRuntimeHealthByControlPlaneKey.set(key, record);
  }
  return record;
}

function upsertProviderRuntimeHealth(
  providerOrigin: string,
  providerID: string,
  environments: readonly DesktopProviderEnvironmentRuntimeHealth[],
): void {
  const runtimeHealth = providerRuntimeHealthMap(providerOrigin, providerID);
  for (const environment of environments) {
    runtimeHealth.set(environment.env_public_id, environment);
  }
}

function providerEnvironmentRuntimeHealthForControlPlane(
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): DesktopProviderEnvironmentRuntimeHealth | null {
  return providerRuntimeHealthMap(providerOrigin, providerID).get(envPublicID) ?? null;
}

async function runtimeControlStatusForStartup(startup: StartupReport | null | undefined): Promise<DesktopRuntimeControlStatus> {
  const runtimeControl = startup?.runtime_control;
  if (!runtimeControl) {
    return desktopRuntimeControlStatusMissing(
      'not_reported',
      'Restart this runtime from Desktop so runtime-control can be prepared.',
    );
  }
  const ownerID = await desktopRuntimeOwnerID();
  return runtimeControl.desktop_owner_id === ownerID
    ? desktopRuntimeControlStatusAvailable()
    : desktopRuntimeControlStatusOwnerMismatch('This runtime is owned by another Desktop instance.');
}

async function inspectSavedRuntimeTargetState(
  target: DesktopPreferences['saved_runtime_targets'][number],
): Promise<SavedRuntimeTargetState> {
  const bridgeRecord = runtimePlacementBridgeByTargetID.get(target.id) ?? null;
  if (bridgeRecord) {
    return {
      running: true,
      startup: bridgeRecord.startup,
      local_ui_url: bridgeRecord.startup.local_ui_url,
      runtime_service: bridgeRecord.startup.runtime_service,
      runtime_control_status: await runtimeControlStatusForStartup(bridgeRecord.startup),
      lifecycle_control: bridgeRecord.runtime_handle.lifecycle_owner === 'desktop' ? 'start_stop' : 'observe_only',
    };
  }
  if (target.placement.kind !== 'container_process') {
    return {
      running: false,
      local_ui_url: '',
      runtime_control_status: desktopRuntimeControlStatusMissing('not_started', 'Start this runtime before connecting it to a provider.'),
      lifecycle_control: 'start_stop',
    };
  }
  try {
    const executor = target.host_access.kind === 'ssh_host'
      ? createSSHRuntimeHostExecutor(target.host_access.ssh)
      : createLocalRuntimeHostExecutor();
    const inspected = parseContainerInspectJSON(
      target.placement.container_engine,
      (await executor.run(containerInspectCommand(
        target.placement.container_engine,
        target.placement.container_id,
      ), { signal: AbortSignal.timeout(DESKTOP_RUNTIME_PROBE_TIMEOUT_MS) })).stdout,
    );
    return {
      running: false,
      local_ui_url: '',
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'not_started',
        inspected.status === 'running'
          ? 'Start this runtime before connecting it to a provider.'
          : 'This container is not running. Start it outside Redeven, then refresh and start the runtime again.',
      ),
      lifecycle_control: inspected.status === 'running' ? 'start_stop' : 'observe_only',
    };
  } catch {
    return {
      running: false,
      local_ui_url: '',
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'not_started',
        'Refresh this runtime after the container is reachable and running.',
      ),
      lifecycle_control: 'observe_only',
    };
  }
}

async function currentManagedRuntimePresenceByTargetID(
  preferences: DesktopPreferences,
  savedSSHRuntimeHealth: Readonly<Record<string, DesktopRuntimeHealth>>,
): Promise<Readonly<Record<string, DesktopManagedRuntimePresence>>> {
  const out: Record<string, DesktopManagedRuntimePresence> = {};
  const localRecord = currentLocalEnvironmentRuntimeRecord(preferences.local_environment);
  if (localRecord) {
    const targetID = desktopProviderRuntimeLinkTargetID('local_environment', preferences.local_environment.id);
    out[targetID] = {
      target_id: targetID,
      placement_target_id: desktopRuntimeTargetID(
        { kind: 'local_host' },
        { kind: 'host_process', install_dir: localRecord.state_file ? path.dirname(localRecord.state_file) : '' },
        preferences.local_environment.id,
      ),
      kind: 'local_environment',
      environment_id: preferences.local_environment.id,
      label: preferences.local_environment.label,
      runtime_key: preferences.local_environment.id,
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', install_dir: localRecord.state_file ? path.dirname(localRecord.state_file) : '' },
      running: true,
      local_ui_url: localRecord.startup.local_ui_url,
      openable: runtimeServiceIsOpenable(localRecord.startup.runtime_service),
      lifecycle_control: localRecord.runtime_handle.lifecycle_owner === 'desktop' ? 'start_stop' : 'observe_only',
      runtime_service: localRecord.startup.runtime_service
        ? normalizeRuntimeServiceSnapshot(localRecord.startup.runtime_service)
        : undefined,
      runtime_control_status: await runtimeControlStatusForStartup(localRecord.startup),
      checked_at_unix_ms: Date.now(),
    };
  }

  for (const environment of preferences.saved_ssh_environments) {
    const runtimeKey = sshDesktopSessionKey(environment);
    const runtimeRecord = sshEnvironmentRuntimeByKey.get(runtimeKey) ?? null;
    if (!runtimeRecord) {
      continue;
    }
    const runtimeService = runtimeRecord.startup.runtime_service
      ?? savedSSHRuntimeHealth[environment.id]?.runtime_service;
    const maintenance = sshRuntimeMaintenanceByKey.get(runtimeKey)
      ?? savedSSHRuntimeHealth[environment.id]?.runtime_maintenance;
    const targetID = desktopProviderRuntimeLinkTargetID('ssh_environment', runtimeKey);
    out[targetID] = {
      target_id: targetID,
      placement_target_id: desktopRuntimeTargetID(
        { kind: 'ssh_host', ssh: environment },
        { kind: 'host_process', install_dir: environment.remote_install_dir },
      ),
      kind: 'ssh_environment',
      environment_id: environment.id,
      label: environment.label,
      runtime_key: runtimeKey,
      host_access: { kind: 'ssh_host', ssh: environment },
      placement: { kind: 'host_process', install_dir: environment.remote_install_dir },
      running: true,
      local_ui_url: runtimeRecord.local_forward_url || runtimeRecord.startup.local_ui_url,
      openable: runtimeServiceIsOpenable(runtimeService),
      lifecycle_control: runtimeRecord.runtime_handle.lifecycle_owner === 'desktop' ? 'start_stop' : 'observe_only',
      runtime_service: runtimeService ? normalizeRuntimeServiceSnapshot(runtimeService) : undefined,
      runtime_control_status: await runtimeControlStatusForStartup(runtimeRecord.startup),
      ...(maintenance ? { maintenance } : {}),
      checked_at_unix_ms: Date.now(),
    };
  }

  for (const target of preferences.saved_runtime_targets) {
    const targetKind = providerRuntimeLinkKindForHostAccess(target.host_access);
    const targetID = providerRuntimeLinkTargetIDForRuntimeTarget(target.host_access, target.id);
    const targetState = await inspectSavedRuntimeTargetState(target);
    out[targetID] = {
      target_id: targetID,
      placement_target_id: target.id,
      kind: targetKind,
      environment_id: target.id,
      label: target.label,
      runtime_key: target.id,
      host_access: target.host_access,
      placement: target.placement,
      running: targetState.running,
      local_ui_url: targetState.local_ui_url,
      openable: runtimeServiceIsOpenable(targetState.runtime_service),
      lifecycle_control: targetState.lifecycle_control,
      runtime_service: targetState.runtime_service
        ? normalizeRuntimeServiceSnapshot(targetState.runtime_service)
        : undefined,
      runtime_control_status: targetState.runtime_control_status,
      checked_at_unix_ms: Date.now(),
    };
  }

  return out;
}

function createInitialLoadDeferred(): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}> {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = (error: Error) => innerReject(error);
  });
  return {
    promise,
    resolve,
    reject,
  };
}

function clearExpiredPendingControlPlaneAuthorizations(now = Date.now()): void {
  for (const [state, pendingAuthorization] of pendingControlPlaneAuthorizationsByState) {
    if (!isPendingControlPlaneAuthorizationExpired(pendingAuthorization, now)) {
      continue;
    }
    pendingControlPlaneAuthorizationsByState.delete(state);
  }
}

function rememberPendingControlPlaneAuthorization(pendingAuthorization: PendingControlPlaneAuthorization): void {
  clearExpiredPendingControlPlaneAuthorizations(pendingAuthorization.created_at_unix_ms);
  for (const [state, existing] of pendingControlPlaneAuthorizationsByState) {
    if (existing.provider_origin === pendingAuthorization.provider_origin) {
      pendingControlPlaneAuthorizationsByState.delete(state);
    }
  }
  pendingControlPlaneAuthorizationsByState.set(pendingAuthorization.state, pendingAuthorization);
}

function consumePendingControlPlaneAuthorization(state: string): PendingControlPlaneAuthorization | null {
  const cleanState = compact(state);
  if (cleanState === '') {
    return null;
  }
  clearExpiredPendingControlPlaneAuthorizations();
  const pendingAuthorization = pendingControlPlaneAuthorizationsByState.get(cleanState) ?? null;
  if (!pendingAuthorization) {
    return null;
  }
  pendingControlPlaneAuthorizationsByState.delete(cleanState);
  if (isPendingControlPlaneAuthorizationExpired(pendingAuthorization)) {
    return null;
  }
  return pendingAuthorization;
}

function clearPendingControlPlaneAuthorizations(providerOrigin: string): void {
  const cleanProviderOrigin = normalizeControlPlaneOrigin(providerOrigin);
  for (const [state, pendingAuthorization] of pendingControlPlaneAuthorizationsByState) {
    if (pendingAuthorization.provider_origin === cleanProviderOrigin) {
      pendingControlPlaneAuthorizationsByState.delete(state);
    }
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
      DESKTOP_PROVIDER_RECONNECT_MESSAGE,
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
        DESKTOP_PROVIDER_RECONNECT_MESSAGE,
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
      error.message || 'Desktop could not reach the provider.',
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

function firstDisplayLine(value: unknown): string {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
}

function friendlyRuntimeStartErrorMessage(error: unknown): string {
  if (error instanceof DesktopSSHRuntimeCanceledError) {
    return 'SSH runtime startup was canceled.';
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = firstDisplayLine(rawMessage);
  if (/ENOENT: no such file or directory, mkdir '\/root'/u.test(message)) {
    return 'The SSH host resolved its runtime directory to /root, but that directory is not available. Desktop will avoid inherited SSH X11 setup and use a writable default runtime directory on the next start; if this persists, set Remote install dir to a writable path such as /tmp/redeven-desktop-runtime.';
  }
  return message;
}

function launcherActionFailureFromRuntimeStartError(
  error: unknown,
  options: Readonly<{
    environmentID?: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
  }> = {},
): DesktopLauncherActionFailure {
  const message = friendlyRuntimeStartErrorMessage(error);
  return launcherActionFailure(
    'runtime_start_failed',
    'environment',
    message || 'Start Runtime did not complete.',
    {
      environmentID: options.environmentID,
      providerOrigin: options.providerOrigin,
      providerID: options.providerID,
      envPublicID: options.envPublicID,
      shouldRefreshSnapshot: true,
    },
  );
}

function launcherActionFailureFromProviderLinkError(
  error: unknown,
  options: Readonly<{
    environmentID?: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
  }> = {},
): DesktopLauncherActionFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RuntimeControlError) {
    return launcherActionFailure(
      error.code === 'RUNTIME_CONTROL_INVALID_RESPONSE'
        || error.code === 'PROVIDER_LINK_INVALID_RESPONSE'
        ? 'provider_invalid_response'
        : 'provider_link_failed',
      'environment',
      message || 'Desktop could not connect the Local Runtime to the provider.',
      {
        environmentID: options.environmentID,
        providerOrigin: options.providerOrigin,
        providerID: options.providerID,
        envPublicID: options.envPublicID,
        shouldRefreshSnapshot: true,
      },
    );
  }
  return launcherActionFailure(
    'provider_link_failed',
    'environment',
    message || 'Desktop could not connect the Local Runtime to the provider.',
    {
      environmentID: options.environmentID,
      providerOrigin: options.providerOrigin,
      providerID: options.providerID,
      envPublicID: options.envPublicID,
      shouldRefreshSnapshot: true,
    },
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
  const managedByID = new Map<string, DesktopLocalEnvironmentState>(
    [[preferences.local_environment.id, preferences.local_environment] as const],
  );
  const savedLabelByURL = new Map(
    preferences.saved_environments.map((environment) => [environment.local_ui_url, environment.label]),
  );
  const savedSSHLabelByID = new Map(
    preferences.saved_ssh_environments.map((environment) => [environment.id, environment.label]),
  );
  for (const session of sessionsByKey.values()) {
    if (session.target.kind === 'local_environment') {
      const localEnvironment = managedByID.get(session.target.environment_id);
      if (!localEnvironment) {
        continue;
      }
      session.target = buildLocalEnvironmentDesktopTarget(localEnvironment);
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
    selectedEnvironmentID: '',
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
    const utilityWindow = liveUtilityWindow(kind);
    if (utilityWindow) {
      return utilityWindow;
    }
  }
  const focusedSession = lastFocusedSessionKey ? sessionsByKey.get(lastFocusedSessionKey) ?? null : null;
  const focusedSessionWindow = focusedSession ? liveTrackedBrowserWindow(focusedSession.root_window) : null;
  if (focusedSessionWindow) {
    return focusedSessionWindow;
  }
  const firstSession = sessionsByKey.values().next().value as DesktopSessionRecord | undefined;
  const firstSessionWindow = firstSession ? liveTrackedBrowserWindow(firstSession.root_window) : null;
  if (firstSessionWindow) {
    return firstSessionWindow;
  }
  return undefined;
}

function currentAppWindowCount(): number {
  return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()).length;
}

function resolveManagedRuntimeQuitLabel(
  runtimeRecord: LocalEnvironmentRuntimeRecord,
  preferences: DesktopPreferences | null,
): string {
  const environment = preferences ? findLocalEnvironmentByID(preferences, runtimeRecord.environment_id) : null;
  return compact(environment?.label) || compact(runtimeRecord.label) || 'Untitled Environment';
}

async function buildCurrentDesktopQuitImpact(): Promise<DesktopQuitImpact> {
  let preferences: DesktopPreferences | null = null;
  try {
    preferences = await loadDesktopPreferencesCached();
  } catch {
    preferences = null;
  }

  return buildDesktopQuitImpact({
    environment_window_count: openSessionSummaries().length,
    pending_operation_count: launcherOperations.operations().filter((operation) => (
      operation.status === 'running' || operation.status === 'canceling' || operation.status === 'cleanup_running'
    )).length,
    local_environment_runtime: localEnvironmentRuntimeRecord
      ? {
          id: localEnvironmentRuntimeRecord.environment_id,
          label: resolveManagedRuntimeQuitLabel(localEnvironmentRuntimeRecord, preferences),
          lifecycle_owner: localEnvironmentRuntimeRecord.runtime_handle.lifecycle_owner,
        }
      : null,
    ssh_runtimes: [...sshEnvironmentRuntimeByKey.values()].map((runtimeRecord) => ({
      id: runtimeRecord.runtime_key,
      label: runtimeRecord.label,
      lifecycle_owner: runtimeRecord.runtime_handle.lifecycle_owner,
    })),
  });
}

function requestImmediateQuit(): void {
  if (quitPhase === 'requested' || quitPhase === 'shutting_down') {
    app.quit();
    return;
  }
  quitPhase = 'requested';
  app.quit();
}

async function confirmDesktopImpact(
  model: DesktopConfirmationDialogModel,
  parentWindow: BrowserWindow | null | undefined,
): Promise<boolean> {
  const liveParentWindow = parentWindow && !parentWindow.isDestroyed()
    ? parentWindow
    : currentParentWindow();
  const result = await showDesktopConfirmationDialog({
    model,
    parentWindow: liveParentWindow,
    platform: process.platform,
  });
  return result === 'confirm';
}

async function requestFinalWindowClose(
  windowRecord: DesktopTrackedWindow,
): Promise<void> {
  const win = liveTrackedBrowserWindow(windowRecord);
  if (!win) {
    return;
  }

  const impact = await buildCurrentDesktopQuitImpact();
  if (shouldConfirmDesktopLastWindowClose(impact)) {
    try {
      const confirmed = await confirmDesktopImpact(
        buildDesktopLastWindowCloseConfirmationModel(impact),
        win,
      );
      if (!confirmed) {
        return;
      }
    } catch {
      return;
    }
  }

  const liveWindow = liveTrackedBrowserWindow(windowRecord);
  if (!liveWindow) {
    return;
  }
  confirmedFinalWindowCloseWebContentsIDs.add(windowRecord.webContentsID);
  liveWindow.close();
}

async function requestQuit(
  source: DesktopQuitSource = 'explicit',
  parentWindow: BrowserWindow | null | undefined = currentParentWindow(),
): Promise<void> {
  if (quitPhase !== 'idle') {
    return;
  }

  const impact = await buildCurrentDesktopQuitImpact();
  if (shouldConfirmDesktopQuit(impact, source)) {
    quitPhase = 'confirming';
    try {
      const confirmed = await confirmDesktopImpact(
        buildDesktopQuitConfirmationModel(impact),
        parentWindow,
      );
      if (!confirmed) {
        quitPhase = 'idle';
        return;
      }
    } catch {
      quitPhase = 'idle';
      return;
    }
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
    return `child:${url.pathname}${url.search}`;
  } catch {
    return `child:${targetURL}`;
  }
}

function sessionChildWindowStateKey(sessionKey: DesktopSessionKey, childKey: string): string {
  return `window:session:${desktopSessionStateKeyFragment(sessionKey)}:child:${encodeURIComponent(childKey)}`;
}

function openSessionSummaries(): readonly DesktopSessionSummary[] {
  return [...sessionsByKey.values()]
    .filter((session) => !session.closing && Boolean(liveTrackedBrowserWindow(session.root_window)))
    .map((session) => ({
      session_key: session.session_key,
      target: session.target,
      lifecycle: session.lifecycle,
      entry_url: session.entry_url,
      startup: session.startup,
      runtime_lifecycle_owner: session.runtime_handle?.lifecycle_owner,
      runtime_launch_mode: session.runtime_handle?.launch_mode,
    }));
}

function onlineRuntimeHealth(
  source: DesktopRuntimeHealth['source'],
  localUIURL: string,
  runtimeService?: RuntimeServiceSnapshot,
  runtimeMaintenance?: DesktopRuntimeMaintenanceRequirement,
): DesktopRuntimeHealth {
  return {
    status: 'online',
    checked_at_unix_ms: Date.now(),
    source,
    local_ui_url: localUIURL,
    ...(runtimeService ? { runtime_service: normalizeRuntimeServiceSnapshot(runtimeService) } : {}),
    ...(runtimeMaintenance ? { runtime_maintenance: runtimeMaintenance } : {}),
  };
}

function desktopSessionEntryURL(target: DesktopSessionTarget, startup: StartupReport): string {
  if (target.kind === 'local_environment' && target.route === 'remote_desktop') {
    return startup.local_ui_url;
  }
  return buildLocalUIEnvAppEntryURL(startup.local_ui_url);
}

function offlineRuntimeHealth(
  source: DesktopRuntimeHealth['source'],
  offlineReasonCode: NonNullable<DesktopRuntimeHealth['offline_reason_code']>,
  offlineReason: string,
): DesktopRuntimeHealth {
  return {
    status: 'offline',
    checked_at_unix_ms: Date.now(),
    source,
    offline_reason_code: offlineReasonCode,
    offline_reason: offlineReason,
  };
}

async function collectSavedExternalRuntimeHealth(
  preferences: DesktopPreferences,
): Promise<Readonly<Record<string, DesktopRuntimeHealth>>> {
  const entries = await Promise.all(preferences.saved_environments.map(async (environment) => {
    try {
      const startup = await loadExternalLocalUIStartup(environment.local_ui_url, DESKTOP_RUNTIME_PROBE_TIMEOUT_MS);
      if (!startup) {
        return [
          environment.id,
          offlineRuntimeHealth(
            'external_local_ui_probe',
            'external_unreachable',
            'The runtime offline / unavailable',
          ),
        ] as const;
      }
      return [environment.id, onlineRuntimeHealth('external_local_ui_probe', startup.local_ui_url, startup.runtime_service)] as const;
    } catch {
      return [
        environment.id,
        offlineRuntimeHealth(
          'external_local_ui_probe',
          'external_unreachable',
          'The runtime offline / unavailable',
        ),
      ] as const;
    }
  }));
  return Object.fromEntries(entries);
}

async function collectSavedSSHRuntimeHealth(
  preferences: DesktopPreferences,
): Promise<Readonly<Record<string, DesktopRuntimeHealth>>> {
  const entries = await Promise.all(preferences.saved_ssh_environments.map(async (environment) => {
    const runtimeKey = sshDesktopSessionKey(environment);
    const maintenance = sshRuntimeMaintenanceByKey.get(runtimeKey);
    const runtimeRecord = sshEnvironmentRuntimeByKey.get(runtimeKey) ?? null;
    if (!runtimeRecord) {
      if (maintenance) {
        return [
          environment.id,
          {
            status: 'online',
            checked_at_unix_ms: Date.now(),
            source: 'ssh_runtime_probe',
            runtime_maintenance: maintenance,
          },
        ] as const;
      }
      return [
        environment.id,
        offlineRuntimeHealth('ssh_runtime_probe', 'not_started', 'Serve the runtime first'),
      ] as const;
    }
    try {
      const startup = await loadExternalLocalUIStartup(runtimeRecord.local_forward_url, DESKTOP_RUNTIME_PROBE_TIMEOUT_MS);
      if (!startup) {
        await runtimeRecord.disconnect().catch(() => undefined);
        sshEnvironmentRuntimeByKey.delete(runtimeKey);
        return [
          environment.id,
          offlineRuntimeHealth('ssh_runtime_probe', 'probe_failed', 'Serve the runtime first'),
        ] as const;
      }
      sshEnvironmentRuntimeByKey.set(runtimeKey, {
        ...runtimeRecord,
        startup: {
          ...runtimeRecord.startup,
          local_ui_url: startup.local_ui_url,
          local_ui_urls: startup.local_ui_urls,
          runtime_control: runtimeRecord.startup.runtime_control,
          password_required: startup.password_required,
          runtime_service: startup.runtime_service ?? runtimeRecord.startup.runtime_service,
        },
        local_forward_url: runtimeRecord.local_forward_url,
      });
      const nextRuntimeService = startup.runtime_service ?? runtimeRecord.startup.runtime_service;
      const runtimeMaintenance = maintenance && !runtimeServiceIsOpenable(nextRuntimeService)
        ? maintenance
        : undefined;
      if (!runtimeMaintenance) {
        sshRuntimeMaintenanceByKey.delete(runtimeKey);
      }
      return [environment.id, onlineRuntimeHealth('ssh_runtime_probe', startup.local_ui_url, nextRuntimeService, runtimeMaintenance)] as const;
    } catch {
      await runtimeRecord.disconnect().catch(() => undefined);
      sshEnvironmentRuntimeByKey.delete(runtimeKey);
      if (maintenance) {
        return [
          environment.id,
          {
            status: 'online',
            checked_at_unix_ms: Date.now(),
            source: 'ssh_runtime_probe',
            runtime_maintenance: maintenance,
          },
        ] as const;
      }
      return [
        environment.id,
        offlineRuntimeHealth('ssh_runtime_probe', 'probe_failed', 'Serve the runtime first'),
      ] as const;
    }
  }));
  return Object.fromEntries(entries);
}

async function buildCurrentDesktopWelcomeSnapshot(
  kind: DesktopUtilityWindowKind,
  overrides: Partial<Pick<BuildDesktopWelcomeSnapshotArgs, 'entryReason' | 'issue'>> = {},
) {
  const preferences = await loadDesktopPreferencesCached();
  const openSessions = openSessionSummaries();
  const welcomePreferences = await hydrateWelcomeLocalEnvironmentRuntimeState(preferences, openSessions, {
    desktopOwnerID: await desktopRuntimeOwnerID(),
    expectedRuntimeIdentity: bundledRuntimeIdentity(),
  });
  const [savedExternalRuntimeHealth, savedSSHRuntimeHealth] = await Promise.all([
    collectSavedExternalRuntimeHealth(welcomePreferences),
    collectSavedSSHRuntimeHealth(welcomePreferences),
  ]);
  const managedRuntimePresenceByTargetID = await currentManagedRuntimePresenceByTargetID(
    welcomePreferences,
    savedSSHRuntimeHealth,
  );
  const state = currentUtilityWindowState(kind);
  return buildDesktopWelcomeSnapshot({
    preferences: welcomePreferences,
    controlPlanes: currentControlPlaneSummaries(preferences),
    openSessions,
    savedExternalRuntimeHealth,
    savedSSHRuntimeHealth,
    managedRuntimePresenceByTargetID,
    actionProgress: launcherOperations.progressItems(),
    operations: launcherOperations.operations(),
    surface: state.surface,
    entryReason: overrides.entryReason ?? state.entryReason,
    issue: overrides.issue ?? state.issue,
    selectedEnvironmentID: state.selectedEnvironmentID,
  });
}

function stampDesktopWelcomeSnapshot(snapshot: DesktopWelcomeSnapshot): DesktopWelcomeSnapshot {
  desktopWelcomeSnapshotRevision += 1;
  return {
    ...snapshot,
    snapshot_revision: desktopWelcomeSnapshotRevision,
  };
}

function liveUtilityWindow(kind: DesktopUtilityWindowKind): BrowserWindow | null {
  const windowRecord = utilityWindows.get(kind) ?? null;
  const win = liveTrackedBrowserWindow(windowRecord);
  if (!windowRecord || !win) {
    if (windowRecord) {
      utilityWindowKindByWebContentsID.delete(windowRecord.webContentsID);
    }
    utilityWindows.delete(kind);
    return null;
  }
  return win;
}

function liveSession(sessionKey: DesktopSessionKey): DesktopSessionRecord | null {
  const sessionRecord = sessionsByKey.get(sessionKey) ?? null;
  if (!sessionRecord || !liveTrackedBrowserWindow(sessionRecord.root_window) || sessionRecord.lifecycle === 'closing') {
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
  if (!sessionRecord || sessionRecord.lifecycle !== 'open') {
    return false;
  }
  const rootWindow = liveTrackedBrowserWindow(sessionRecord.root_window);
  if (!rootWindow) {
    return false;
  }
  lastFocusedSessionKey = sessionKey;
  presentAppWindow(rootWindow, options);
  return true;
}

async function emitDesktopWelcomeSnapshot(kind: DesktopUtilityWindowKind): Promise<void> {
  const win = liveUtilityWindow(kind);
  if (!win || win.webContents.isDestroyed()) {
    return;
  }
  const snapshot = stampDesktopWelcomeSnapshot(await buildCurrentDesktopWelcomeSnapshot(kind));
  win.webContents.send(DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL, snapshot);
}

function broadcastDesktopWelcomeSnapshots(): void {
  for (const kind of UTILITY_WINDOW_KINDS) {
    void emitDesktopWelcomeSnapshot(kind);
  }
}

function handleLauncherOperationChange(snapshot: DesktopLauncherOperationSnapshot): void {
  const persistedProgress: DesktopLauncherActionProgress = launcherOperationProgress(snapshot);
  const launcher = liveUtilityWindow('launcher');
  if (launcher && !launcher.webContents.isDestroyed()) {
    launcher.webContents.send(DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL, persistedProgress);
  }
  void emitDesktopWelcomeSnapshot('launcher');
}

function scheduleLauncherOperationRemoval(operationKey: string, delayMs = 4_000): void {
  const cleanOperationKey = compact(operationKey);
  if (cleanOperationKey === '') {
    return;
  }
  const existingTimer = launcherOperationRemovalTimers.get(cleanOperationKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    launcherOperationRemovalTimers.delete(cleanOperationKey);
    launcherOperations.remove(cleanOperationKey);
    void emitDesktopWelcomeSnapshot('launcher');
  }, delayMs);
  launcherOperationRemovalTimers.set(cleanOperationKey, timer);
}

function setLauncherViewState(options: OpenDesktopWelcomeOptions = {}): DesktopUtilityWindowState {
  const current = currentUtilityWindowState('launcher');
  const nextState: DesktopUtilityWindowState = {
    surface: options.surface ?? 'connect_environment',
    entryReason: options.entryReason ?? (openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch'),
    issue: options.issue === undefined ? current.issue : options.issue,
    selectedEnvironmentID: options.selectedEnvironmentID ?? current.selectedEnvironmentID,
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

function windowSurfaceForRole(role: CreateBrowserWindowArgs['role']): DesktopWindowSurface {
  return role === 'launcher' ? 'utility' : 'session';
}

function createBrowserWindow(args: CreateBrowserWindowArgs): DesktopTrackedWindow {
  const spec = resolveDesktopWindowSpec(args.targetURL, Boolean(args.parent));
  const attachToParent = Boolean(args.parent) && spec.attachToParent !== false;
  const actualParent = attachToParent ? args.parent : undefined;
  const surface = windowSurfaceForRole(args.role);
  const preloadPath = surface === 'utility'
    ? resolveUtilityPreloadPath({ appPath: app.getAppPath() })
    : resolveSessionPreloadPath({ appPath: app.getAppPath() });
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
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  const trackedWindow = trackBrowserWindow(win);

  desktopThemeState().registerWindow(win);
  const disposeWindowChromeBroadcast = attachDesktopWindowChromeBroadcast(win, process.platform);
  applyRestoredWindowState(win, restoredState);
  registerWindowStatePersistence(win, args.stateKey);
  recordWindowLifecycle(args.diagnostics, 'window_created', 'browser window created', {
    role: args.role,
    surface,
  });
  const windowLifecycleContext = (): Record<string, unknown> => buildWindowLifecycleContext({
    role: args.role,
    surface,
    stateKey: args.stateKey,
    targetURL: args.targetURL,
    preloadPath,
    webContents: win.webContents,
  });

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
    args.onDidFailLoad?.({
      win,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });
  win.webContents.on('console-message', (event) => {
    if (!shouldCaptureElectronBootstrapConsoleMessage(event)) {
      return;
    }
    recordWindowLifecycle(
      args.diagnostics,
      'electron_bootstrap_console',
      'browser window emitted Electron bootstrap console diagnostics',
      buildConsoleMessageDetail(windowLifecycleContext(), event),
    );
  });
  win.webContents.on('preload-error', (_event, failingPreloadPath, error) => {
    recordWindowLifecycle(
      args.diagnostics,
      'preload_error',
      error?.message || 'browser window preload failed',
      buildPreloadErrorDetail(windowLifecycleContext(), failingPreloadPath, error),
    );
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    recordWindowLifecycle(
      args.diagnostics,
      'render_process_gone',
      'browser window renderer process exited unexpectedly',
      buildRenderProcessGoneDetail(windowLifecycleContext(), details),
    );
  });

  if (desktopDevToolsEnabled && !args.parent) {
    win.webContents.on('did-finish-load', () => {
      if (!win.webContents.isDestroyed() && !win.webContents.isDevToolsOpened()) {
        win.webContents.openDevTools({ mode: 'detach', activate: false });
      }
    });
  }

  win.once('ready-to-show', () => {
    if (args.presentOnReadyToShow !== false) {
      presentAppWindow(win, { stealAppFocus: args.stealAppFocus });
    }
    recordWindowLifecycle(args.diagnostics, 'ready_to_show', 'browser window is ready to show', { role: args.role });
  });
  win.on('close', (event) => {
    if (confirmedFinalWindowCloseWebContentsIDs.delete(trackedWindow.webContentsID)) {
      return;
    }
    if (quitPhase !== 'idle') {
      return;
    }
    if (currentAppWindowCount() > 1) {
      return;
    }
    if (process.platform === 'darwin') {
      event.preventDefault();
      void requestFinalWindowClose(trackedWindow);
      return;
    }
    event.preventDefault();
    void requestQuit('last_window_close', win);
  });
  win.on('closed', () => {
    const closedWindow = closedWindowSnapshot(trackedWindow);
    confirmedFinalWindowCloseWebContentsIDs.delete(closedWindow.webContentsID);
    disposeWindowChromeBroadcast();
    cleanupWindowStatePersistence(win);
    recordWindowLifecycle(args.diagnostics, 'window_closed', 'browser window closed', { role: args.role });
    args.onClosed?.(closedWindow);
  });

  void win.loadURL(args.targetURL);
  return trackedWindow;
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
  const existingWindow = liveTrackedBrowserWindow(existing);
  if (existing && existingWindow) {
    void existingWindow.loadURL(targetURL);
    presentAppWindow(existingWindow);
    return existingWindow;
  }
  if (existing) {
    sessionRecord.child_windows.delete(childKey);
    sessionKeyByWebContentsID.delete(existing.webContentsID);
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
    onClosed: (closedWindow) => {
      sessionRecord.child_windows.delete(childKey);
      sessionKeyByWebContentsID.delete(closedWindow.webContentsID);
    },
  });

  sessionRecord.child_windows.set(childKey, childWindow);
  sessionKeyByWebContentsID.set(childWindow.webContentsID, sessionKey);
  return childWindow.browserWindow;
}

function sessionOpenFailureMessage(targetURL: string, errorDescription: string): string {
  const cleanDescription = compact(errorDescription);
  if (cleanDescription !== '') {
    return `Desktop could not finish opening ${targetURL}: ${cleanDescription}`;
  }
  return `Desktop could not finish opening ${targetURL}.`;
}

function resolveSessionInitialLoadSuccess(
  sessionRecord: DesktopSessionRecord,
  options: Readonly<{ stealAppFocus?: boolean }> = {},
): void {
  if (sessionRecord.lifecycle !== 'opening') {
    return;
  }
  sessionRecord.lifecycle = 'open';
  const resolve = sessionRecord.resolve_initial_load;
  sessionRecord.resolve_initial_load = null;
  sessionRecord.reject_initial_load = null;
  sessionRecord.initial_load_failure_message = '';
  resolve?.();
  const rootWindow = liveTrackedBrowserWindow(sessionRecord.root_window);
  if (rootWindow) {
    presentAppWindow(rootWindow, { stealAppFocus: options.stealAppFocus });
  }
  broadcastDesktopWelcomeSnapshots();
}

function normalizeDesktopSessionAppReadyPayload(value: unknown): DesktopSessionAppReadyPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const state = String((value as Partial<DesktopSessionAppReadyPayload>).state ?? '').trim();
  if (state !== 'access_gate_interactive' && state !== 'runtime_connected') {
    return null;
  }
  return { state };
}

function desktopSessionContextSnapshot(sessionRecord: DesktopSessionRecord | null): DesktopSessionContextSnapshot | null {
  if (!sessionRecord) {
    return null;
  }

  const target = sessionRecord.target;
  if (target.kind === 'local_environment') {
    return {
      local_environment_id: target.environment_id,
      renderer_storage_scope_id: target.route === 'local_host'
        ? 'local'
        : target.environment_id,
      target_kind: target.kind,
      target_route: target.route,
      ...(target.provider_origin ? { provider_origin: target.provider_origin } : {}),
      ...(target.provider_id ? { provider_id: target.provider_id } : {}),
      ...(target.env_public_id ? { env_public_id: target.env_public_id } : {}),
    };
  }

  return {
    local_environment_id: target.environment_id,
    renderer_storage_scope_id: target.environment_id,
    target_kind: target.kind,
  };
}

function markSessionAppReady(
  sessionRecord: DesktopSessionRecord,
  payload: DesktopSessionAppReadyPayload,
): void {
  if (sessionRecord.lifecycle !== 'opening') {
    return;
  }
  sessionRecord.app_ready_state = payload.state;
  void sessionRecord.diagnostics.recordLifecycle(
    'session_app_ready',
    payload.state === 'runtime_connected'
      ? 'Env App runtime protocol connected.'
      : 'Env App access gate is interactive.',
    { state: payload.state },
  );
  resolveSessionInitialLoadSuccess(sessionRecord, {
    stealAppFocus: sessionRecord.steal_app_focus_on_ready,
  });
}

async function failOpeningSession(
  sessionRecord: DesktopSessionRecord,
  message: string,
): Promise<void> {
  if (sessionRecord.lifecycle !== 'opening') {
    return;
  }
  sessionRecord.initial_load_failure_message = compact(message) || 'Desktop could not open that environment window.';
  const reject = sessionRecord.reject_initial_load;
  sessionRecord.resolve_initial_load = null;
  sessionRecord.reject_initial_load = null;
  reject?.(new Error(sessionRecord.initial_load_failure_message));
  await finalizeSessionClosure(sessionRecord.session_key);
}

async function waitForSessionInitialLoad(
  sessionRecord: DesktopSessionRecord,
): Promise<void> {
  const timeoutMessage = `Desktop timed out while opening ${sessionRecord.target.label}.`;
  const timeoutHandle = setTimeout(() => {
    void failOpeningSession(sessionRecord, timeoutMessage);
  }, DESKTOP_SESSION_INITIAL_LOAD_TIMEOUT_MS);
  try {
    await sessionRecord.initial_load_completion;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function createSessionRootWindow(
  sessionKey: DesktopSessionKey,
  targetURL: string,
  diagnostics: DesktopDiagnosticsRecorder,
  options?: Readonly<{
    stealAppFocus?: boolean;
    presentOnReadyToShow?: boolean;
    onDidFinishLoad?: (win: BrowserWindow) => void;
    onDidFailLoad?: (details: Readonly<{
      win: BrowserWindow;
      errorCode: number;
      errorDescription: string;
      validatedURL: string;
      isMainFrame: boolean;
    }>) => void;
  }>,
): DesktopTrackedWindow {
  return createBrowserWindow({
    targetURL,
    stateKey: sessionWindowStateKey(sessionKey),
    role: 'session_root',
    diagnostics,
    stealAppFocus: options?.stealAppFocus,
    presentOnReadyToShow: options?.presentOnReadyToShow,
    onDidFinishLoad: options?.onDidFinishLoad,
    onDidFailLoad: options?.onDidFailLoad,
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

function desktopDiagnosticsStateDirForTarget(target: DesktopSessionTarget, startup: StartupReport): string {
  if (target.kind === 'local_environment') {
    return compact(startup.state_dir);
  }
  return path.join(app.getPath('userData'), 'session-diagnostics', desktopSessionStateKeyFragment(target.session_key));
}

async function createSessionRecord(
  target: DesktopSessionTarget,
  startup: StartupReport,
  options: Readonly<{
    runtimeHandle?: DesktopSessionRuntimeHandle | null;
    stopRuntimeOnClose?: boolean;
    attached?: boolean;
    stealAppFocus?: boolean;
  }> = {},
): Promise<DesktopSessionRecord> {
  const diagnostics = new DesktopDiagnosticsRecorder();
  await diagnostics.configureRuntime(startup, startup.local_ui_url, {
    stateDirOverride: desktopDiagnosticsStateDirForTarget(target, startup),
  });
  const entryURL = desktopSessionEntryURL(target, startup);
  const initialLoad = createInitialLoadDeferred();
  let sessionRecord!: DesktopSessionRecord;
  const rootWindow = createSessionRootWindow(target.session_key, entryURL, diagnostics, {
    stealAppFocus: options.stealAppFocus,
    presentOnReadyToShow: false,
    onDidFinishLoad: () => {
      void sessionRecord.diagnostics.recordLifecycle(
        'session_document_loaded',
        'Session document finished loading; waiting for Env App readiness.',
      );
    },
    onDidFailLoad: (details) => {
      if (!details.isMainFrame) {
        return;
      }
      void failOpeningSession(
        sessionRecord,
        sessionOpenFailureMessage(details.validatedURL || entryURL, details.errorDescription),
      );
    },
  });
  sessionRecord = {
    session_key: target.session_key,
    target,
    startup,
    entry_url: entryURL,
    allowed_base_url: startup.local_ui_url,
    root_window: rootWindow,
    child_windows: new Map(),
    diagnostics,
    runtime_handle: options.runtimeHandle ?? null,
    stop_runtime_on_close: options.stopRuntimeOnClose === true,
    steal_app_focus_on_ready: options.stealAppFocus === true,
    lifecycle: 'opening',
    initial_load_completion: initialLoad.promise,
    resolve_initial_load: initialLoad.resolve,
    reject_initial_load: initialLoad.reject,
    app_ready_state: '',
    initial_load_failure_message: '',
    closing: false,
  };

  sessionsByKey.set(target.session_key, sessionRecord);
  sessionKeyByWebContentsID.set(rootWindow.webContentsID, target.session_key);
  rootWindow.browserWindow.on('focus', () => {
    lastFocusedSessionKey = target.session_key;
  });
  rootWindow.browserWindow.on('closed', () => {
    sessionKeyByWebContentsID.delete(rootWindow.webContentsID);
    void finalizeSessionClosure(target.session_key);
  });

  recordWindowLifecycle(
    diagnostics,
    target.kind === 'local_environment'
      ? options.attached === true
        ? 'runtime_attached'
        : 'runtime_started'
      : target.kind === 'ssh_environment'
        ? 'ssh_environment_connected'
        : 'external_target_connected',
    target.kind === 'local_environment'
      ? options.attached === true
        ? target.local_environment_kind === 'controlplane'
          ? 'desktop attached to an existing Provider environment runtime'
          : 'desktop attached to an existing Local Environment runtime'
        : target.local_environment_kind === 'controlplane'
          ? 'desktop opened a Desktop-owned Provider environment session'
          : 'desktop opened a Desktop-owned Local Environment session'
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
    const wasOpening = sessionRecord.lifecycle === 'opening';
    sessionRecord.closing = true;
    sessionRecord.lifecycle = 'closing';
    if (wasOpening && (sessionRecord.resolve_initial_load || sessionRecord.reject_initial_load)) {
      const message = sessionRecord.initial_load_failure_message
        || `Desktop closed ${sessionRecord.target.label} before it finished opening.`;
      sessionRecord.initial_load_failure_message = message;
      const reject = sessionRecord.reject_initial_load;
      sessionRecord.resolve_initial_load = null;
      sessionRecord.reject_initial_load = null;
      reject?.(new Error(message));
    }
    sessionsByKey.delete(sessionKey);
    if (lastFocusedSessionKey === sessionKey) {
      lastFocusedSessionKey = null;
    }

    sessionKeyByWebContentsID.delete(sessionRecord.root_window.webContentsID);
    for (const childWindow of sessionRecord.child_windows.values()) {
      sessionKeyByWebContentsID.delete(childWindow.webContentsID);
      const browserWindow = liveTrackedBrowserWindow(childWindow);
      if (options.closeWindows !== false && browserWindow) {
        browserWindow.destroy();
      }
    }
    sessionRecord.child_windows.clear();

    const rootWindow = liveTrackedBrowserWindow(sessionRecord.root_window);
    if (options.closeWindows !== false && rootWindow) {
      rootWindow.destroy();
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
    if (runtimeHandle && sessionRecord.stop_runtime_on_close) {
      await runtimeHandle.stop();
    }
  })().finally(() => {
    sessionCloseTasks.delete(sessionKey);
  });

  sessionCloseTasks.set(sessionKey, task);
  await task;
}

async function closeUtilityWindow(kind: DesktopUtilityWindowKind): Promise<void> {
  const windowRecord = utilityWindows.get(kind) ?? null;
  const win = liveTrackedBrowserWindow(windowRecord);
  if (!windowRecord || !win) {
    if (windowRecord) {
      utilityWindowKindByWebContentsID.delete(windowRecord.webContentsID);
    }
    utilityWindows.delete(kind);
    return;
  }
  utilityWindows.delete(kind);
  utilityWindowKindByWebContentsID.delete(windowRecord.webContentsID);
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
    updateWelcomeRuntimePoller();
    if (kind === 'launcher') {
      void syncVisibleControlPlanesIfNeeded();
      void pollWelcomeRuntimeState();
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
    onClosed: (closedWindow) => {
      utilityWindows.delete(kind);
      utilityWindowKindByWebContentsID.delete(closedWindow.webContentsID);
      updateControlPlaneSyncPoller();
      updateWelcomeRuntimePoller();
    },
  });

  utilityWindows.set(kind, win);
  utilityWindowKindByWebContentsID.set(win.webContentsID, kind);
  if (kind === 'launcher') {
    win.browserWindow.on('focus', () => {
      void syncVisibleControlPlanesIfNeeded();
    });
  }
  updateControlPlaneSyncPoller();
  updateWelcomeRuntimePoller();
  if (kind === 'launcher') {
    void syncVisibleControlPlanesIfNeeded();
    void pollWelcomeRuntimeState();
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

function preferredEnvironmentID(preferences: DesktopPreferences): string {
  if (lastFocusedSessionKey) {
    const sessionRecord = liveSession(lastFocusedSessionKey);
    const target = sessionRecord?.target;
    if (target?.kind === 'local_environment') {
      if (target.provider_origin && target.env_public_id) {
        const providerEnvironment = preferences.provider_environments.find((environment) => (
          environment.provider_origin === target.provider_origin
          && environment.provider_id === target.provider_id
          && environment.env_public_id === target.env_public_id
        )) ?? null;
        if (providerEnvironment) {
          return providerEnvironment.id;
        }
      }
      if (findLocalEnvironmentByID(preferences, target.environment_id)) {
        return target.environment_id;
      }
    }
  }
  return preferences.local_environment.id || (preferences.provider_environments[0]?.id ?? '');
}

async function openAdvancedSettingsWindow(): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await openDesktopWelcomeWindow({
    surface: 'environment_settings',
    selectedEnvironmentID: preferredEnvironmentID(preferences),
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
          'Desktop could not reach that Redeven Environment. Make sure the target host is exposing Redeven Local UI and that its port is reachable from this device.',
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
  environment: DesktopLocalEnvironmentState;
  localUIBind?: string;
}>;

async function prepareManagedTarget(
  options: PrepareManagedTargetOptions,
): Promise<PreparedManagedTargetResult> {
  const executablePath = bundledRuntimeExecutablePath();
  const desktopOwnerID = await desktopRuntimeOwnerID();
  const launchPlan = buildDesktopRuntimeLaunchPlan(options.environment, process.env, {
    localUIBind: options.localUIBind,
    bootstrap: null,
    desktopOwnerID,
  });
  const launch = await startManagedRuntime({
    executablePath,
    runtimeArgs: launchPlan.args,
    env: launchPlan.env,
    desktopOwnerID,
    expectedRuntimeIdentity: bundledRuntimeIdentity(),
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

async function attachLocalEnvironmentRuntime(
  environment: DesktopLocalEnvironmentState,
): Promise<LocalEnvironmentRuntimeRecord | null> {
  const existingRecord = currentLocalEnvironmentRuntimeRecord(environment);
  if (existingRecord) {
    try {
      const startup = await loadExternalLocalUIStartup(existingRecord.startup.local_ui_url, DESKTOP_RUNTIME_PROBE_TIMEOUT_MS);
      if (startup) {
        const updatedRecord = {
          ...existingRecord,
          startup: {
            ...existingRecord.startup,
            controlplane_base_url: startup.controlplane_base_url ?? existingRecord.startup.controlplane_base_url,
            controlplane_provider_id: startup.controlplane_provider_id ?? existingRecord.startup.controlplane_provider_id,
            env_public_id: startup.env_public_id ?? existingRecord.startup.env_public_id,
            runtime_control: existingRecord.startup.runtime_control,
            local_ui_url: startup.local_ui_url,
            local_ui_urls: startup.local_ui_urls,
            password_required: startup.password_required,
            desktop_managed: startup.desktop_managed ?? existingRecord.startup.desktop_managed,
            desktop_owner_id: startup.desktop_owner_id ?? existingRecord.startup.desktop_owner_id,
            effective_run_mode: startup.effective_run_mode ?? existingRecord.startup.effective_run_mode,
            remote_enabled: startup.remote_enabled ?? existingRecord.startup.remote_enabled,
            runtime_service: startup.runtime_service ?? existingRecord.startup.runtime_service,
          },
        };
        localEnvironmentRuntimeRecord = updatedRecord;
        return updatedRecord;
      }
    } catch {
      // Fall back to state-file attach below.
    }
    clearLocalEnvironmentRuntimeRecord(environment);
  }

  const attachedRuntime = await attachManagedRuntimeFromStateFile({
    runtimeStateFile: localEnvironmentRuntimeStateFile(environment),
    runtimeAttachTimeoutMs: DESKTOP_RUNTIME_PROBE_TIMEOUT_MS,
  });
  if (!attachedRuntime) {
    return null;
  }
  return updateLocalEnvironmentRuntimeRecord(
    environment,
    attachedRuntime.startup,
    desktopSessionRuntimeHandleFromManagedRuntime(attachedRuntime, {
      persistedOwner: environment.local_hosting?.owner,
      desktopOwnerID: await desktopRuntimeOwnerID(),
    }),
  );
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

function resolveManagedRestartBindOverride(environment: DesktopLocalEnvironmentState, startup: StartupReport): string | null {
  try {
    const configuredBind = parseLocalUIBind(localEnvironmentAccess(environment).local_ui_bind);
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
  const versionCandidates = [
    process.env.REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG,
    process.env.REDEVEN_DESKTOP_BUNDLE_VERSION,
    process.env.REDEVEN_DESKTOP_VERSION,
    app.getVersion(),
  ];
  const clean = versionCandidates
    .map((value) => String(value ?? '').trim())
    .find((value) => value !== '') ?? '';
  if (clean === '') {
    throw new Error('Desktop could not resolve the SSH runtime release tag. Set REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG for dev SSH bootstrap, or use a packaged Desktop build with a release version.');
  }
  return clean.startsWith('v') ? clean : `v${clean}`;
}

async function markSavedExternalTargetUsed(environmentID: string, rawURL: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(markSavedEnvironmentUsed(preferences, {
    environment_id: environmentID,
    local_ui_url: rawURL,
  }));
}

async function markSavedSSHTargetUsed(
  input: DesktopSSHEnvironmentDetails & Readonly<{ environmentID?: string }>,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(markSavedSSHEnvironmentUsed(preferences, {
    ssh_destination: input.ssh_destination,
    ssh_port: input.ssh_port,
    auth_mode: input.auth_mode,
    remote_install_dir: input.remote_install_dir,
    bootstrap_strategy: input.bootstrap_strategy,
    release_base_url: input.release_base_url,
    connect_timeout_seconds: input.connect_timeout_seconds,
    environment_id: input.environmentID,
  }));
}

async function startSSHEnvironmentRuntimeRecord(
  sshDetails: DesktopSSHEnvironmentDetails,
  options: Readonly<{
    environmentID?: string;
    label?: string;
    forceRuntimeUpdate?: boolean;
    allowActiveWorkReplacement?: boolean;
  }> = {},
): Promise<SSHEnvironmentRuntimeRecord> {
  const runtimeKey = sshDesktopSessionKey(sshDetails);
  const environmentID = compact(options.environmentID) || runtimeKey;
  const label = compact(options.label) || defaultSavedSSHEnvironmentLabel(sshDetails);
  const existingRecord = sshEnvironmentRuntimeByKey.get(runtimeKey) ?? null;
  if (existingRecord) {
    const canReuseExisting = options.forceRuntimeUpdate !== true
      && options.allowActiveWorkReplacement !== true
      && desktopSSHRuntimeAffectingSettingsMatch(existingRecord.details, sshDetails);
    if (canReuseExisting) {
      try {
        const startup = await loadExternalLocalUIStartup(existingRecord.local_forward_url, DESKTOP_RUNTIME_PROBE_TIMEOUT_MS);
        if (startup) {
          const updatedRecord = {
            ...existingRecord,
            details: sshDetails,
            startup: {
              ...existingRecord.startup,
              local_ui_url: startup.local_ui_url,
              local_ui_urls: startup.local_ui_urls,
              runtime_control: existingRecord.startup.runtime_control,
              password_required: startup.password_required,
              runtime_service: startup.runtime_service ?? existingRecord.startup.runtime_service,
            },
            local_forward_url: existingRecord.local_forward_url,
          };
          sshEnvironmentRuntimeByKey.set(runtimeKey, updatedRecord);
          if (runtimeServiceIsOpenable(updatedRecord.startup.runtime_service)) {
            sshRuntimeMaintenanceByKey.delete(runtimeKey);
          }
          return updatedRecord;
        }
      } catch {
        // Restart below if the cached runtime is no longer reachable.
      }
    }
    await existingRecord.disconnect().catch(() => undefined);
    sshEnvironmentRuntimeByKey.delete(runtimeKey);
  }

  const pendingStart = pendingSSHRuntimeStartByKey.get(runtimeKey) ?? null;
  if (pendingStart) {
    return pendingStart.task;
  }

  const operation = launcherOperations.create({
    operation_key: runtimeKey,
    action: 'start_environment_runtime',
    subject_kind: 'ssh_environment',
    subject_id: runtimeKey,
    environment_id: environmentID,
    environment_label: label,
    phase: 'ssh_preparing_start',
    title: 'Preparing SSH runtime',
    detail: 'Desktop is preparing the secure SSH session and local tunnel.',
    cancelable: true,
    interrupt_label: 'Stop startup',
    interrupt_detail: 'Stops this SSH runtime startup and closes the local resources already created.',
    interrupt_kind: 'stop_opening',
  });
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;

  const task = (async () => {
    let operationSettled = false;
    let desktopAIBroker: ManagedDesktopAIBroker | null = null;
    try {
      try {
        const executablePath = resolveBundledRuntimePath({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
        });
        desktopAIBroker = await startDesktopAIBroker({
          executablePath,
          stateRoot: preferencesPaths().stateRoot,
          runtimeKey,
          tempRoot: app.getPath('temp'),
          signal,
          onLog: (stream, chunk) => {
            const text = String(chunk ?? '').trim();
            if (text) console.log(`[redeven:ai-broker:${stream}] ${text}`);
          },
        });
      } catch (brokerError) {
        if (brokerError instanceof DOMException && brokerError.name === 'AbortError') {
          throw new DesktopSSHRuntimeCanceledError();
        }
        const message = brokerError instanceof Error ? brokerError.message : String(brokerError);
        console.warn(`[redeven:ai-broker] Desktop AI Broker unavailable for ${runtimeKey}: ${message}`);
        desktopAIBroker = null;
      }
      if (desktopAIBroker && desktopAIBroker.modelCount <= 0) {
        const missing = desktopAIBroker.missingKeyProviderIDs.length > 0
          ? ` Missing provider keys: ${desktopAIBroker.missingKeyProviderIDs.join(', ')}.`
          : '';
        console.warn(`[redeven:ai-broker] Desktop AI Broker has no usable models for ${runtimeKey}.${missing}`);
        await desktopAIBroker.stop().catch(() => undefined);
        desktopAIBroker = null;
      }
      const managedSSHRuntime = await startManagedSSHRuntime({
        target: sshDetails,
        runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
        desktopOwnerID: await desktopRuntimeOwnerID(),
        sourceRuntimeRoot: process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT,
        forceRuntimeUpdate: options.forceRuntimeUpdate,
        allowActiveWorkReplacement: options.allowActiveWorkReplacement,
        connectTimeoutSeconds: typeof sshDetails.connect_timeout_seconds === 'number'
          ? sshDetails.connect_timeout_seconds
          : undefined,
        tempRoot: app.getPath('temp'),
        assetCacheRoot: path.join(app.getPath('userData'), 'ssh-runtime-cache'),
        aiBroker: desktopAIBroker
          ? {
              local_url: desktopAIBroker.url,
              token: desktopAIBroker.token,
              session_id: desktopAIBroker.sessionID,
              ssh_runtime_key: runtimeKey,
              expires_at_unix_ms: desktopAIBroker.expiresAtUnixMs,
            }
          : null,
        signal,
        onLog: (stream, chunk) => {
          const text = String(chunk ?? '').trim();
          if (!text) {
            return;
          }
          console.log(`[redeven:${stream}] ${text}`);
        },
        onProgress: (progress) => {
          launcherOperations.update(runtimeKey, {
            phase: progress.phase,
            title: progress.title,
            detail: progress.detail,
          });
        },
      });
      if (launcherOperations.isStale(runtimeKey)) {
        launcherOperations.update(runtimeKey, {
          status: 'cleanup_running',
          phase: 'cleanup_deleted_connection',
          title: 'Connection removed',
          detail: 'Desktop is stopping the SSH runtime that finished after this connection was removed.',
          cancelable: false,
        });
        try {
          await managedSSHRuntime.stop();
          await desktopAIBroker?.stop();
          launcherOperations.finish(runtimeKey, 'canceled', {
            phase: 'deleted_connection_cleaned',
            title: 'Startup canceled',
            detail: 'Desktop removed the connection and cleaned up the SSH startup task.',
            deleted_subject: true,
          });
          scheduleLauncherOperationRemoval(runtimeKey);
          operationSettled = true;
        } catch (cleanupError) {
          launcherOperations.finish(runtimeKey, 'cleanup_failed', {
            phase: 'cleanup_failed',
            title: 'Connection removed; cleanup needs attention',
            detail: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            deleted_subject: true,
            error_message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
          operationSettled = true;
        }
        throw new DesktopSSHRuntimeCanceledError('SSH runtime startup was canceled because the connection was removed.');
      }
      const runtimeRecord: SSHEnvironmentRuntimeRecord = {
        runtime_key: runtimeKey,
        environment_id: environmentID,
        label,
        details: sshDetails,
        startup: managedSSHRuntime.startup,
        local_forward_url: managedSSHRuntime.local_forward_url,
        runtime_control_forward_url: managedSSHRuntime.runtime_control_forward_url,
        runtime_handle: managedSSHRuntime.runtime_handle,
        disconnect: async () => {
          await managedSSHRuntime.disconnect();
          await desktopAIBroker?.stop();
        },
        stop: async () => {
          await managedSSHRuntime.stop();
          await desktopAIBroker?.stop();
        },
      };
      sshEnvironmentRuntimeByKey.set(runtimeKey, runtimeRecord);
      sshRuntimeMaintenanceByKey.delete(runtimeKey);
      launcherOperations.finish(runtimeKey, 'succeeded', {
        phase: 'ssh_runtime_started',
        title: 'SSH runtime ready',
        detail: 'Desktop started the SSH runtime and opened a local tunnel.',
      });
      scheduleLauncherOperationRemoval(runtimeKey);
      operationSettled = true;
      return runtimeRecord;
    } catch (error) {
      if (!operationSettled) {
        if (error instanceof DesktopSSHRuntimeCanceledError || signal?.aborted) {
          launcherOperations.update(runtimeKey, {
            status: 'cleanup_running',
            phase: 'ssh_cleaning_startup_resources',
            title: 'Cleaning SSH startup resources',
            detail: 'Desktop is closing local startup resources for this SSH runtime.',
            cancelable: false,
          });
          await desktopAIBroker?.stop();
          desktopAIBroker = null;
          launcherOperations.finish(runtimeKey, 'canceled', {
            phase: 'canceled',
            title: 'Startup canceled',
            detail: 'Desktop stopped the SSH runtime startup and cleaned up local startup resources.',
            deleted_subject: launcherOperations.get(runtimeKey)?.deleted_subject === true,
          });
        } else {
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof DesktopSSHRuntimeMaintenanceRequiredError) {
            sshRuntimeMaintenanceByKey.set(runtimeKey, error.maintenance);
          }
          launcherOperations.finish(runtimeKey, 'failed', {
            phase: 'failed',
            title: error instanceof DesktopSSHRuntimeMaintenanceRequiredError
              ? 'SSH runtime needs attention'
              : 'SSH runtime start failed',
            detail: firstDisplayLine(message) || (
              error instanceof DesktopSSHRuntimeMaintenanceRequiredError
                ? 'Update or restart the SSH runtime from the Welcome page.'
                : 'Desktop could not start the SSH runtime.'
            ),
            error_message: message,
          });
        }
        scheduleLauncherOperationRemoval(runtimeKey);
      }
      await desktopAIBroker?.stop();
      throw error;
    } finally {
      pendingSSHRuntimeStartByKey.delete(runtimeKey);
    }
  })();
  pendingSSHRuntimeStartByKey.set(runtimeKey, {
    runtime_key: runtimeKey,
    environment_id: environmentID,
    label,
    operation_key: runtimeKey,
    task,
  });
  return task;
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

function savedControlPlaneByOrigin(
  preferences: DesktopPreferences,
  providerOrigin: string,
): DesktopSavedControlPlane | null {
  try {
    const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
    return preferences.control_planes.find((controlPlane) => (
      controlPlane.provider.provider_origin === normalizedOrigin
    )) ?? null;
  } catch {
    return null;
  }
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
      last_sync_error_message: 'Reconnect this provider in your browser to restore access.',
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

function clearControlPlaneTransientState(providerOrigin: string, providerID: string): void {
  clearControlPlaneAccessState(providerOrigin, providerID);
  clearControlPlaneSyncRecord(providerOrigin, providerID);
  clearPendingControlPlaneAuthorizations(providerOrigin);
  try {
    const key = desktopControlPlaneKey(providerOrigin, providerID);
    controlPlaneSyncTaskByKey.delete(key);
    providerRuntimeHealthByControlPlaneKey.delete(key);
  } catch {
    // Ignore malformed identifiers during best-effort cleanup.
  }
}

function controlPlaneSummary(controlPlane: DesktopSavedControlPlane): DesktopControlPlaneSummary {
  const syncRecord = currentControlPlaneSyncRecord(controlPlane);
  const environments = controlPlane.environments.map((environment) => ({
    ...environment,
    runtime_health: providerEnvironmentRuntimeHealthForControlPlane(
      controlPlane.provider.provider_origin,
      controlPlane.provider.provider_id,
      environment.env_public_id,
    ) ?? environment.runtime_health,
  }));
  return {
    ...controlPlane,
    environments,
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

async function refreshProviderEnvironmentRuntimeHealth(
  providerOrigin: string,
  providerID: string,
  envPublicIDs: readonly string[],
): Promise<void> {
  const cleanEnvPublicIDs = envPublicIDs.map((value) => compact(value)).filter((value) => value !== '');
  if (cleanEnvPublicIDs.length === 0) {
    return;
  }
  const preferences = await loadDesktopPreferencesCached();
  const controlPlane = savedControlPlaneByIdentity(preferences, providerOrigin, providerID);
  if (!controlPlane) {
    throw new Error('This provider is no longer saved in Desktop.');
  }
  const authorized = await ensureControlPlaneAccessToken(preferences, controlPlane);
  const runtimeHealth = await queryProviderEnvironmentRuntimeHealth(
    authorized.controlPlane.provider,
    authorized.accessToken,
    { env_public_ids: cleanEnvPublicIDs },
  );
  upsertProviderRuntimeHealth(providerOrigin, providerID, runtimeHealth);
}

async function refreshAllProviderEnvironmentRuntimeHealth(): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await Promise.all(preferences.control_planes.map(async (controlPlane) => {
    await refreshProviderEnvironmentRuntimeHealth(
      controlPlane.provider.provider_origin,
      controlPlane.provider.provider_id,
      controlPlane.environments.map((environment) => environment.env_public_id),
    );
  }));
}

let welcomeRuntimePollTask: Promise<void> | null = null;

async function pollWelcomeRuntimeState(): Promise<void> {
  if (welcomeRuntimePollTask) {
    return welcomeRuntimePollTask;
  }
  welcomeRuntimePollTask = (async () => {
    const launcher = liveUtilityWindow('launcher');
    if (!launcher || launcher.isDestroyed()) {
      updateWelcomeRuntimePoller();
      return;
    }
    await refreshAllProviderEnvironmentRuntimeHealth().catch(() => {
      // Best-effort runtime health refresh should not interrupt launcher updates.
    });
    await emitDesktopWelcomeSnapshot('launcher');
  })().finally(() => {
    welcomeRuntimePollTask = null;
  });
  return welcomeRuntimePollTask;
}

function updateWelcomeRuntimePoller(): void {
  const shouldPoll = Boolean(liveUtilityWindow('launcher'));
  if (!shouldPoll) {
    if (welcomeRuntimePollTimer) {
      clearInterval(welcomeRuntimePollTimer);
      welcomeRuntimePollTimer = null;
    }
    return;
  }
  if (welcomeRuntimePollTimer) {
    return;
  }
  welcomeRuntimePollTimer = setInterval(() => {
    void pollWelcomeRuntimeState();
  }, WELCOME_RUNTIME_POLL_INTERVAL_MS);
}

function controlPlaneAuthorizationNeedsReconnect(error: unknown): boolean {
  if (error instanceof DesktopProviderRequestError && (error.status === 401 || error.status === 403)) {
    return true;
  }
  return error instanceof Error
    && (
      error.message === DESKTOP_PROVIDER_RECONNECT_MESSAGE
      || error.message === 'Desktop authorization is missing. Reconnect this provider in your browser.'
    );
}

async function startControlPlaneAuthorization(args: Readonly<{
  providerOrigin: string;
  expectedProviderID?: string;
  requestedEnvPublicID?: string;
  label?: string;
  displayLabel?: string;
}>): Promise<PendingControlPlaneAuthorization> {
  const provider = await fetchProviderDiscovery(args.providerOrigin);
  const expectedProviderID = compact(args.expectedProviderID);
  if (expectedProviderID !== '' && provider.provider_id !== expectedProviderID) {
    throw new Error(`Provider ID mismatch: expected ${expectedProviderID}, got ${provider.provider_id}.`);
  }
  const pendingAuthorization = createPendingControlPlaneAuthorization({
    providerOrigin: provider.provider_origin,
    providerID: provider.provider_id,
    requestedEnvPublicID: args.requestedEnvPublicID,
    label: args.label,
    displayLabel: args.displayLabel,
  });
  rememberPendingControlPlaneAuthorization(pendingAuthorization);
  await openExternalURL(buildControlPlaneAuthorizationBrowserURL(provider.provider_origin, pendingAuthorization));
  return pendingAuthorization;
}

async function saveAuthorizedControlPlane(
  preferences: DesktopPreferences,
  providerOrigin: string,
  expectedProviderID: string | undefined,
  authorizationCode: string,
  codeVerifier: string,
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
  const exchange = await exchangeProviderDesktopConnectAuthorization(provider, {
    authorization_code: authorizationCode,
    code_verifier: codeVerifier,
  });
  rememberControlPlaneAccessState(
    provider.provider_origin,
    provider.provider_id,
    exchange.access_token,
    exchange.access_expires_at_unix_ms,
    exchange.authorization_expires_at_unix_ms,
  );
  const nextPreferences = upsertSavedControlPlane(preferences, {
    provider,
    account: exchange.account,
    environments: exchange.environments,
    display_label: compact(displayLabel) || undefined,
    last_synced_at_ms: Date.now(),
    refresh_token: exchange.refresh_token,
  });
  const controlPlane = savedControlPlaneByIdentity(nextPreferences, provider.provider_origin, provider.provider_id);
  if (!controlPlane) {
    throw new Error('Desktop failed to save the provider account.');
  }
  upsertProviderRuntimeHealth(
    provider.provider_origin,
    provider.provider_id,
    exchange.environments.flatMap((environment) => environment.runtime_health ? [environment.runtime_health] : []),
  );
  await persistDesktopPreferences(nextPreferences);
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
  const subjectID = desktopControlPlaneKey(providerOrigin, providerID);
  const subjectGeneration = launcherOperations.currentSubjectGeneration('control_plane', subjectID);
  const assertCurrentSubject = () => {
    if (launcherOperations.currentSubjectGeneration('control_plane', subjectID) !== subjectGeneration) {
      throw new Error('This provider was removed while Desktop was syncing it.');
    }
  };
  const refreshToken = controlPlaneRefreshToken(preferences, providerOrigin, providerID);
  if (refreshToken === '') {
    throw new Error('Desktop authorization is missing. Reconnect this provider in your browser.');
  }

  const provider = await fetchProviderDiscovery(providerOrigin);
  assertCurrentSubject();
  if (provider.provider_id !== providerID) {
    throw new Error(`Provider ID mismatch: expected ${providerID}, got ${provider.provider_id}.`);
  }

  const refreshed = await refreshProviderDesktopAccessToken(provider, refreshToken);
  assertCurrentSubject();
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
  assertCurrentSubject();
  const nextPreferences = upsertSavedControlPlane(preferences, {
    provider,
    account,
    environments,
    last_synced_at_ms: Date.now(),
    refresh_token: refreshToken,
  });
  const controlPlane = savedControlPlaneByIdentity(nextPreferences, provider.provider_origin, provider.provider_id);
  if (!controlPlane) {
    throw new Error('Desktop failed to save the provider account.');
  }
  upsertProviderRuntimeHealth(
    provider.provider_origin,
    provider.provider_id,
    environments.flatMap((environment) => environment.runtime_health ? [environment.runtime_health] : []),
  );
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
  const subjectGeneration = launcherOperations.currentSubjectGeneration('control_plane', key);
  const inFlight = controlPlaneSyncTaskByKey.get(key);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const preferences = await loadDesktopPreferencesCached();
    const controlPlane = savedControlPlaneByIdentity(preferences, providerOrigin, providerID);
    if (!controlPlane) {
      throw new Error('This provider is no longer saved in Desktop.');
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
      if (launcherOperations.currentSubjectGeneration('control_plane', key) === subjectGeneration) {
        setControlPlaneSyncRecord(
          providerOrigin,
          providerID,
          controlPlaneSyncRecordFromError(error, lastSyncAttemptAtMS),
        );
      }
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
    throw new Error('Desktop authorization is missing. Reconnect this provider in your browser.');
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
  const environment = summary.environments.find((entry) => entry.env_public_id === envPublicID) ?? null;
  return {
    controlPlane,
    summary,
    environment,
    remoteRouteState: desktopProviderRemoteRouteState({
      syncState: summary.sync_state,
      environmentPresent: environment !== null,
      providerRuntimeStatus: environment?.runtime_health?.runtime_status,
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
        DESKTOP_PROVIDER_RECONNECT_MESSAGE,
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

function launcherActionFailureForOpeningSession(
  sessionRecord: DesktopSessionRecord,
  options: Readonly<{
    environmentID?: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
  }> = {},
): DesktopLauncherActionFailure {
  return launcherActionFailure(
    'environment_opening',
    'environment',
    `Desktop is still opening ${sessionRecord.target.label}. Wait a moment, then try again.`,
    {
      environmentID: options.environmentID ?? sessionRecord.target.environment_id,
      providerOrigin: options.providerOrigin,
      providerID: options.providerID,
      envPublicID: options.envPublicID,
    },
  );
}

function launcherActionFailureForRuntimeNotOpenable(
  startup: StartupReport,
  options: Readonly<{
    environmentID?: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
  }> = {},
): DesktopLauncherActionFailure {
  return launcherActionFailure(
    'runtime_not_ready',
    'environment',
    runtimeServiceOpenReadinessLabel(startup.runtime_service),
    {
      ...options,
      shouldRefreshSnapshot: true,
    },
  );
}

function launcherActionFailureFromSessionOpenError(
  error: unknown,
  options: Readonly<{
    environmentID?: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
  }> = {},
): DesktopLauncherActionFailure {
  return launcherActionFailure(
    'action_invalid',
    'environment',
    error instanceof Error ? error.message : String(error) || 'Desktop could not open that environment.',
    options,
  );
}

async function openLocalEnvironmentRecord(
  preferences: DesktopPreferences,
  environment: DesktopLocalEnvironmentState,
  options: Readonly<{
    stealAppFocus?: boolean;
  }> = {},
): Promise<DesktopLauncherActionResult> {
  const target = buildLocalEnvironmentDesktopTarget(environment, { route: 'local_host' });
  const sessionKey = target.session_key;
  const existingSession = liveSession(sessionKey);
  if (existingSession) {
    if (existingSession.lifecycle === 'opening') {
      return launcherActionFailureForOpeningSession(existingSession, {
        environmentID: environment.id,
      });
    }
    resetLauncherIssueState();
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: options.stealAppFocus !== false });
    if (findLocalEnvironmentByID(preferences, environment.id)) {
      await persistDesktopPreferences(rememberLocalEnvironmentUse(preferences, environment.id, 'local_host'));
    }
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }

  let runtimeRecord = await attachLocalEnvironmentRuntime(environment);
  const ownerID = await desktopRuntimeOwnerID();
  const expectedRuntimeIdentity = bundledRuntimeIdentity();
  if (!runtimeRecord) {
    const prepared = await prepareManagedTarget({
      environment,
    });
    if (!prepared.ok) {
      return launcherActionFailure(
        'action_invalid',
        'environment',
        prepared.issue.message,
        {
          environmentID: environment.id,
          providerOrigin: localEnvironmentProviderOrigin(environment),
          providerID: localEnvironmentProviderID(environment),
          envPublicID: localEnvironmentPublicID(environment),
        },
      );
    }
    runtimeRecord = updateLocalEnvironmentRuntimeRecord(
      environment,
      prepared.launch.managedRuntime.startup,
      desktopSessionRuntimeHandleFromManagedRuntime(prepared.launch.managedRuntime, {
        persistedOwner: environment.local_hosting?.owner,
        desktopOwnerID: ownerID,
      }),
    );
  }
  const runtimePlan = buildDesktopLocalRuntimeOpenPlan(
    { kind: 'local_environment' },
    runtimeRecord.startup,
    {
      desktopOwnerID: ownerID,
      expectedRuntimeIdentity,
    },
  );
  if (runtimePlan.requires_restart && runtimePlan.can_open) {
    clearLocalEnvironmentRuntimeRecord(environment);
    const prepared = await prepareManagedTarget({ environment });
    if (!prepared.ok) {
      return launcherActionFailure(
        'action_invalid',
        'environment',
        prepared.issue.message,
        {
          environmentID: environment.id,
          providerOrigin: localEnvironmentProviderOrigin(environment),
          providerID: localEnvironmentProviderID(environment),
          envPublicID: localEnvironmentPublicID(environment),
        },
      );
    }
    runtimeRecord = updateLocalEnvironmentRuntimeRecord(
      environment,
      prepared.launch.managedRuntime.startup,
      desktopSessionRuntimeHandleFromManagedRuntime(prepared.launch.managedRuntime, {
        persistedOwner: environment.local_hosting?.owner,
        desktopOwnerID: ownerID,
      }),
    );
  } else if (!runtimePlan.can_open) {
    return launcherActionFailure(
      'runtime_not_ready',
      'environment',
      runtimePlan.message,
      {
        environmentID: environment.id,
        providerOrigin: localEnvironmentProviderOrigin(environment),
        providerID: localEnvironmentProviderID(environment),
        envPublicID: localEnvironmentPublicID(environment),
        shouldRefreshSnapshot: true,
      },
    );
  }
  if (!runtimeServiceIsOpenable(runtimeRecord.startup.runtime_service)) {
    return launcherActionFailureForRuntimeNotOpenable(runtimeRecord.startup, {
      environmentID: environment.id,
      providerOrigin: localEnvironmentProviderOrigin(environment),
      providerID: localEnvironmentProviderID(environment),
      envPublicID: localEnvironmentPublicID(environment),
    });
  }

  let sessionRecord: DesktopSessionRecord | null = null;
  try {
    sessionRecord = await createSessionRecord(target, runtimeRecord.startup, {
      runtimeHandle: runtimeRecord.runtime_handle,
      stopRuntimeOnClose: false,
      attached: runtimeRecord.runtime_handle.launch_mode === 'attached',
      stealAppFocus: options.stealAppFocus !== false,
    });
    await waitForSessionInitialLoad(sessionRecord);
  } catch (error) {
    return launcherActionFailureFromSessionOpenError(error, {
      environmentID: environment.id,
      providerOrigin: localEnvironmentProviderOrigin(environment),
      providerID: localEnvironmentProviderID(environment),
      envPublicID: localEnvironmentPublicID(environment),
    });
  }
  resetLauncherIssueState();
  await persistDesktopPreferences(rememberLocalEnvironmentUse(preferences, environment.id, 'local_host'));
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
    runtime_service: {
      protocol_version: 'redeven-runtime-v1',
      service_owner: 'external',
      desktop_managed: false,
      effective_run_mode: 'remote_desktop',
      remote_enabled: true,
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {
        terminal_count: 0,
        session_count: 0,
        task_count: 0,
        port_forward_count: 0,
      },
    },
  };
}

async function openProviderRemoteEnvironmentRecord(
  preferences: DesktopPreferences,
  environment: DesktopProviderEnvironmentRecord,
  args: Readonly<{
    remoteSessionURL: string;
    stealAppFocus?: boolean;
  }>,
): Promise<DesktopLauncherActionResult> {
  const target = buildProviderEnvironmentDesktopTarget(environment, { route: 'remote_desktop' });
  const existingSession = liveSession(target.session_key);
  if (existingSession) {
    if (existingSession.lifecycle === 'opening') {
      return launcherActionFailureForOpeningSession(existingSession, {
        environmentID: environment.id,
        providerOrigin: environment.provider_origin,
        providerID: environment.provider_id,
        envPublicID: environment.env_public_id,
      });
    }
    resetLauncherIssueState();
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: args.stealAppFocus !== false });
    await persistDesktopPreferences(rememberProviderEnvironmentUse(preferences, environment.id));
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }

  try {
    const sessionRecord = await createSessionRecord(
      target,
      remoteManagedSessionStartup(args.remoteSessionURL),
      { stealAppFocus: args.stealAppFocus !== false },
    );
    await waitForSessionInitialLoad(sessionRecord);
  } catch (error) {
    return launcherActionFailureFromSessionOpenError(error, {
      environmentID: environment.id,
      providerOrigin: environment.provider_origin,
      providerID: environment.provider_id,
      envPublicID: environment.env_public_id,
    });
  }
  resetLauncherIssueState();
  await persistDesktopPreferences(rememberProviderEnvironmentUse(preferences, environment.id));
  return launcherActionSuccess('opened_environment_window', {
    sessionKey: target.session_key,
  });
}

async function openProviderEnvironmentWithOpenSession(args: Readonly<{
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
    throw new Error('Desktop could not resolve the provider ID.');
  }
  const remoteSessionURL = compact(args.remoteSessionURL);
  if (remoteSessionURL === '') {
    throw new Error('Desktop could not obtain a remote session URL for that provider environment.');
  }
  const providerEnvironment = findProviderEnvironmentByID(
    preferences,
    desktopProviderEnvironmentID(providerOrigin, args.envPublicID),
  ) ?? createDesktopProviderEnvironmentRecord(providerOrigin, args.envPublicID, {
    providerID,
    label: controlPlaneEnvironmentLabel(controlPlane, args.envPublicID, args.label),
    remoteDesktopSupported: true,
    remoteWebSupported: true,
  });
  return openProviderRemoteEnvironmentRecord(preferences, providerEnvironment, {
    remoteSessionURL,
    stealAppFocus: true,
  });
}

async function openLocalEnvironmentFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_local_environment' }>>,
): Promise<DesktopLauncherActionResult> {
  const bridgeOpenResult = await openRuntimePlacementBridgeFromLauncher(request);
  if (bridgeOpenResult) {
    return bridgeOpenResult;
  }
  const preferences = await loadDesktopPreferencesCached();
  const environment = findLocalEnvironmentByID(preferences, request.environment_id);
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
  if (localEnvironmentStateKind(environment) === 'controlplane') {
    if (requestedRoute === 'remote_desktop') {
      return launcherActionFailure(
        'environment_route_unavailable',
        'environment',
        'Open the separate provider environment card for remote access. This Local Environment card only opens the local runtime.',
        {
          environmentID: environment.id,
          providerOrigin: localEnvironmentProviderOrigin(environment),
          providerID: localEnvironmentProviderID(environment),
          envPublicID: localEnvironmentPublicID(environment),
        },
      );
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
  return openLocalEnvironmentRecord(preferences, environment, { stealAppFocus: true });
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
    if (optimisticSession.lifecycle === 'opening') {
      return launcherActionFailureForOpeningSession(optimisticSession, {
        environmentID: request.environment_id,
      });
    }
    if (optimisticSession.target.kind === 'external_local_ui' && request.label) {
      optimisticSession.target = {
        ...optimisticSession.target,
        label: String(request.label).trim() || optimisticSession.target.label,
      };
    }
    resetLauncherIssueState();
    await markSavedExternalTargetUsed(optimisticSession.target.environment_id, optimisticSession.startup.local_ui_url);
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
  if (!runtimeServiceIsOpenable(prepared.startup.runtime_service)) {
    return launcherActionFailureForRuntimeNotOpenable(prepared.startup, {
      environmentID: request.environment_id,
    });
  }

  const target = buildExternalLocalUIDesktopTarget(prepared.startup.local_ui_url, {
    environmentID: request.environment_id,
    label: request.label,
  });
  const existingSession = liveSession(target.session_key);
  if (existingSession) {
    if (existingSession.lifecycle === 'opening') {
      return launcherActionFailureForOpeningSession(existingSession, {
        environmentID: request.environment_id,
      });
    }
    existingSession.target = target;
    resetLauncherIssueState();
    await markSavedExternalTargetUsed(existingSession.target.environment_id, existingSession.startup.local_ui_url);
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: true });
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }

  try {
    const sessionRecord = await createSessionRecord(target, prepared.startup, { stealAppFocus: true });
    await waitForSessionInitialLoad(sessionRecord);
  } catch (error) {
    return launcherActionFailureFromSessionOpenError(error, {
      environmentID: request.environment_id,
    });
  }
  resetLauncherIssueState();
  await markSavedExternalTargetUsed(target.environment_id, prepared.startup.local_ui_url);
  return launcherActionSuccess('opened_environment_window', {
    sessionKey: target.session_key,
  });
}

async function openSSHEnvironmentFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_ssh_environment' }>>,
): Promise<DesktopLauncherActionResult> {
  const bridgeOpenResult = await openRuntimePlacementBridgeFromLauncher(request);
  if (bridgeOpenResult) {
    return bridgeOpenResult;
  }
  const sshDetails = normalizeDesktopSSHEnvironmentDetails({
    ssh_destination: request.ssh_destination,
    ssh_port: request.ssh_port,
    auth_mode: request.auth_mode,
    remote_install_dir: request.remote_install_dir,
    bootstrap_strategy: request.bootstrap_strategy,
    release_base_url: request.release_base_url,
    connect_timeout_seconds: request.connect_timeout_seconds,
  });
  const optimisticSessionKey = sshDesktopSessionKey(sshDetails);
  const optimisticSession = liveSession(optimisticSessionKey);
  if (optimisticSession) {
    if (optimisticSession.lifecycle === 'opening') {
      return launcherActionFailureForOpeningSession(optimisticSession, {
        environmentID: request.environment_id,
      });
    }
    if (optimisticSession.target.kind === 'ssh_environment' && request.label) {
      optimisticSession.target = {
        ...optimisticSession.target,
        label: String(request.label).trim() || optimisticSession.target.label,
      };
    }
    resetLauncherIssueState();
    await markSavedSSHTargetUsed({
      ...sshDetails,
      environmentID: request.environment_id,
    });
    focusEnvironmentSession(optimisticSession.session_key, { stealAppFocus: true });
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: optimisticSession.session_key,
    });
  }

  const runtimeRecord = sshEnvironmentRuntimeByKey.get(optimisticSessionKey) ?? null;
  if (!runtimeRecord) {
    return launcherActionFailure(
      'runtime_not_started',
      'environment',
      'Start the SSH runtime first, then open this environment.',
      {
        environmentID: request.environment_id,
      },
    );
  }
  if (!runtimeServiceIsOpenable(runtimeRecord.startup.runtime_service)) {
    return launcherActionFailureForRuntimeNotOpenable(runtimeRecord.startup, {
      environmentID: request.environment_id,
    });
  }

  const target = buildSSHDesktopTarget(sshDetails, {
    environmentID: request.environment_id,
    label: request.label,
    forwardedLocalUIURL: runtimeRecord.local_forward_url,
  });
  const existingSession = liveSession(target.session_key);
  if (existingSession) {
    if (existingSession.lifecycle === 'opening') {
      return launcherActionFailureForOpeningSession(existingSession, {
        environmentID: request.environment_id,
      });
    }
    existingSession.target = target;
    resetLauncherIssueState();
    await markSavedSSHTargetUsed({
      ...sshDetails,
      environmentID: request.environment_id,
    });
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: true });
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }

  let sessionRecord: DesktopSessionRecord | null = null;
  try {
    sessionRecord = await createSessionRecord(target, runtimeRecord.startup, {
      runtimeHandle: runtimeRecord.runtime_handle,
      stopRuntimeOnClose: false,
      stealAppFocus: true,
    });
    await waitForSessionInitialLoad(sessionRecord);
  } catch (error) {
    return launcherActionFailureFromSessionOpenError(error, {
      environmentID: request.environment_id,
    });
  }
  resetLauncherIssueState();
  await markSavedSSHTargetUsed({
    ...sshDetails,
    environmentID: target.environment_id,
  });
  return launcherActionSuccess('opened_environment_window', {
    sessionKey: target.session_key,
  });
}

function thrownLauncherActionFailure(error: unknown): DesktopLauncherActionFailure | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = error as Partial<DesktopLauncherActionFailure>;
  if (candidate.ok === false && typeof candidate.message === 'string' && typeof candidate.code === 'string') {
    return candidate as DesktopLauncherActionFailure;
  }
  return null;
}

type DesktopLauncherRuntimeTargetRequest = Extract<
  DesktopLauncherActionRequest,
  Readonly<{ kind: 'start_environment_runtime' | 'stop_environment_runtime' | 'refresh_environment_runtime' }>
>;

function sshDetailsFromRuntimeTargetRequest(
  request: DesktopLauncherRuntimeTargetRequest,
): DesktopSSHEnvironmentDetails | null {
  if (request.host_access?.kind === 'ssh_host') {
    return request.host_access.ssh;
  }
  if (request.host_access?.kind === 'local_host') {
    return null;
  }
  if (!request.ssh_destination) {
    return null;
  }
  return normalizeDesktopSSHEnvironmentDetails({
    ssh_destination: request.ssh_destination,
    ssh_port: request.ssh_port,
    auth_mode: request.auth_mode,
    remote_install_dir: request.remote_install_dir,
    bootstrap_strategy: request.bootstrap_strategy,
    release_base_url: request.release_base_url,
    connect_timeout_seconds: request.connect_timeout_seconds,
  });
}

function runtimeHostAccessFromRequest(
  request: DesktopLauncherRuntimeTargetRequest | Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_local_environment' | 'open_ssh_environment' }>>,
): DesktopRuntimeHostAccess {
  if (request.host_access) {
    return request.host_access;
  }
  const sshDetails = 'ssh_destination' in request ? sshDetailsFromRuntimeTargetRequest(request as DesktopLauncherRuntimeTargetRequest) : null;
  return sshDetails ? { kind: 'ssh_host', ssh: sshDetails } : { kind: 'local_host' };
}

function runtimePlacementFromRequest(
  request: DesktopLauncherRuntimeTargetRequest | Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_local_environment' | 'open_ssh_environment' }>>,
): DesktopRuntimePlacement {
  return request.placement ?? { kind: 'host_process', install_dir: '' };
}

function runtimeTargetIDFromRequest(
  request: DesktopLauncherRuntimeTargetRequest | Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_local_environment' | 'open_ssh_environment' }>>,
): DesktopRuntimeTargetID {
  if (request.placement_target_id) {
    return request.placement_target_id;
  }
  if (request.runtime_target_id) {
    return request.runtime_target_id;
  }
  return desktopRuntimeTargetID(
    runtimeHostAccessFromRequest(request),
    runtimePlacementFromRequest(request),
    compact(request.environment_id) || 'local',
  );
}

function runtimeTargetLabelFromRequest(
  request: DesktopLauncherRuntimeTargetRequest | Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_local_environment' | 'open_ssh_environment' }>>,
): string {
  return compact(request.label) || compact(request.environment_id) || 'Runtime';
}

function runtimeTargetEnvironmentIDFromRequest(
  request: DesktopLauncherRuntimeTargetRequest | Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_local_environment' | 'open_ssh_environment' }>>,
): string {
  return compact(request.environment_id) || runtimeTargetIDFromRequest(request);
}

function runtimePlacementBridgeRecordForRequest(
  request: DesktopLauncherRuntimeTargetRequest | Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_local_environment' | 'open_ssh_environment' }>>,
): RuntimePlacementBridgeRecord | null {
  const placement = runtimePlacementFromRequest(request);
  if (placement.kind !== 'container_process') {
    return null;
  }
  return runtimePlacementBridgeByTargetID.get(runtimeTargetIDFromRequest(request)) ?? null;
}

async function inspectRuntimeTargetContainer(
  hostAccess: DesktopRuntimeHostAccess,
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
) {
  const executor = hostAccess.kind === 'ssh_host'
    ? createSSHRuntimeHostExecutor(hostAccess.ssh)
    : createLocalRuntimeHostExecutor();
  const result = await executor.run(containerInspectCommand(
    placement.container_engine,
    placement.container_id,
  ));
  return parseContainerInspectJSON(placement.container_engine, result.stdout);
}

function containerUnavailableMessage(
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
  status: string,
): string {
  const label = placement.container_label || placement.container_id;
  if (status === 'missing') {
    return `Container ${label} was not found. Choose a running container, then try again.`;
  }
  if (status === 'no_permission') {
    return `Desktop does not have permission to inspect ${label}. Check ${placement.container_engine} access, then try again.`;
  }
  return `Container ${label} is not running. Start it outside Redeven, then refresh and try again.`;
}

async function assertRuntimeTargetContainerRunning(
  hostAccess: DesktopRuntimeHostAccess,
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
): Promise<void> {
  const inspected = await inspectRuntimeTargetContainer(hostAccess, placement);
  if (inspected.status === 'running') {
    return;
  }
  throw new Error(containerUnavailableMessage(placement, inspected.status));
}

async function startRuntimePlacementBridgeRecordFromLauncher(
  request: DesktopLauncherRuntimeTargetRequest,
): Promise<RuntimePlacementBridgeRecord> {
  const hostAccess = runtimeHostAccessFromRequest(request);
  const placement = runtimePlacementFromRequest(request);
  if (placement.kind !== 'container_process') {
    throw new Error('Runtime Placement Bridge requires a container runtime target.');
  }
  await assertRuntimeTargetContainerRunning(hostAccess, placement);
  const existing = runtimePlacementBridgeByTargetID.get(runtimeTargetIDFromRequest(request)) ?? null;
  if (existing) {
    return existing;
  }
  const session = await startRuntimePlacementBridgeSession({
    host_access: hostAccess,
    placement,
    runtime_binary_path: bundledRuntimeExecutablePath(),
    desktop_owner_id: await desktopRuntimeOwnerID(),
    fallback_local_id: runtimeTargetEnvironmentIDFromRequest(request),
  });
  const record = bridgeRecordFromSession({
    environmentID: runtimeTargetEnvironmentIDFromRequest(request),
    label: runtimeTargetLabelFromRequest(request),
    session,
  });
  runtimePlacementBridgeByTargetID.set(session.placement_target_id, record);
  return record;
}

async function openRuntimePlacementBridgeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_local_environment' | 'open_ssh_environment' }>>,
): Promise<DesktopLauncherActionResult | null> {
  const placement = runtimePlacementFromRequest(request);
  if (placement.kind !== 'container_process') {
    return null;
  }
  const record = runtimePlacementBridgeRecordForRequest(request);
  if (!record) {
    return launcherActionFailure(
      'runtime_not_started',
      'environment',
      'Start this runtime first, then open it.',
      {
        environmentID: runtimeTargetEnvironmentIDFromRequest(request),
        shouldRefreshSnapshot: true,
      },
    );
  }
  if (!runtimeServiceIsOpenable(record.startup.runtime_service)) {
    return launcherActionFailureForRuntimeNotOpenable(record.startup, {
      environmentID: record.environment_id,
    });
  }
  const target = record.session.host_access.kind === 'ssh_host'
    ? buildSSHDesktopTarget(record.session.host_access.ssh, {
        environmentID: record.environment_id,
        label: record.label,
        forwardedLocalUIURL: record.startup.local_ui_url,
        sessionKeyOverride: desktopSessionKeyFromRuntimeTargetID(record.session.placement_target_id) as `ssh:${string}`,
      })
    : buildManagedLocalRuntimeDesktopTarget(record.environment_id, record.label);
  const existingSession = liveSession(target.session_key);
  if (existingSession) {
    if (existingSession.lifecycle === 'opening') {
      return launcherActionFailureForOpeningSession(existingSession, {
        environmentID: record.environment_id,
      });
    }
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: true });
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }
  try {
    const sessionRecord = await createSessionRecord(target, record.startup, {
      runtimeHandle: record.runtime_handle,
      stopRuntimeOnClose: false,
      stealAppFocus: true,
    });
    await waitForSessionInitialLoad(sessionRecord);
  } catch (error) {
    return launcherActionFailureFromSessionOpenError(error, {
      environmentID: record.environment_id,
    });
  }
  resetLauncherIssueState();
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(markSavedRuntimeTargetUsed(preferences, {
    environment_id: record.session.placement_target_id,
    host_access: record.session.host_access,
    placement: record.session.placement,
  }));
  return launcherActionSuccess('opened_environment_window', {
    sessionKey: target.session_key,
  });
}

async function startEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'start_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const placement = runtimePlacementFromRequest(request);
  if (placement.kind === 'container_process') {
    try {
      const runtimeRecord = await startRuntimePlacementBridgeRecordFromLauncher(request);
      resetLauncherIssueState();
      await persistDesktopPreferences(markSavedRuntimeTargetUsed(preferences, {
        environment_id: runtimeRecord.session.placement_target_id,
        host_access: runtimeRecord.session.host_access,
        placement: runtimeRecord.session.placement,
      }));
      broadcastDesktopWelcomeSnapshots();
      return launcherActionSuccess('started_environment_runtime');
    } catch (error) {
      return launcherActionFailureFromRuntimeStartError(error, {
        environmentID: runtimeTargetEnvironmentIDFromRequest(request),
      });
    }
  }

  const normalizedSSHTarget = sshDetailsFromRuntimeTargetRequest(request);
  if (normalizedSSHTarget) {
    try {
      const runtimeRecord = await startSSHEnvironmentRuntimeRecord(normalizedSSHTarget, {
        environmentID: request.environment_id,
        label: request.label,
        forceRuntimeUpdate: request.force_runtime_update === true,
        allowActiveWorkReplacement: request.allow_active_work_replacement === true,
      });
      resetLauncherIssueState();
      await markSavedSSHTargetUsed({
        ...runtimeRecord.details,
        environmentID: runtimeRecord.environment_id,
      });
      broadcastDesktopWelcomeSnapshots();
      return launcherActionSuccess('started_environment_runtime');
    } catch (error) {
      return launcherActionFailureFromRuntimeStartError(error, {
        environmentID: request.environment_id,
      });
    }
  }

  const environmentID = compact(request.environment_id);
  const environment = findLocalEnvironmentByID(preferences, environmentID);
  if (!environment || !environment.local_hosting) {
    const providerEnvironment = findProviderEnvironmentByID(preferences, environmentID);
    if (!providerEnvironment) {
      return launcherActionFailure(
        'environment_missing',
        'environment',
        'This environment is no longer available.',
        {
          environmentID,
          shouldRefreshSnapshot: true,
        },
      );
    }

    return launcherActionFailure(
      'action_invalid',
      'environment',
      'Start Runtime is available from Local and SSH runtime cards. Connect this provider Environment after the selected runtime is running.',
      providerEnvironmentFailureContext(providerEnvironment),
    );
  }

  try {
    const prepared = await prepareManagedTarget({
      environment,
    });
    if (!prepared.ok) {
      return launcherActionFailure(
        'action_invalid',
        'environment',
        prepared.issue.message,
        {
          environmentID: environment.id,
        },
      );
    }
    updateLocalEnvironmentRuntimeRecord(
      environment,
      prepared.launch.managedRuntime.startup,
      desktopSessionRuntimeHandleFromManagedRuntime(prepared.launch.managedRuntime, {
        persistedOwner: environment.local_hosting?.owner,
        desktopOwnerID: await desktopRuntimeOwnerID(),
      }),
    );
    resetLauncherIssueState();
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('started_environment_runtime');
  } catch (error) {
    return thrownLauncherActionFailure(error)
      ?? launcherActionFailureFromProviderAuthError(error, {
        environmentID: environment.id,
        providerOrigin: localEnvironmentProviderOrigin(environment),
        providerID: localEnvironmentProviderID(environment),
        envPublicID: localEnvironmentPublicID(environment),
      })
      ?? launcherActionFailureFromRuntimeStartError(error, {
        environmentID: environment.id,
        providerOrigin: localEnvironmentProviderOrigin(environment),
        providerID: localEnvironmentProviderID(environment),
        envPublicID: localEnvironmentPublicID(environment),
      });
  }
}

async function connectProviderRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'connect_provider_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const environment = findProviderEnvironmentByID(preferences, request.provider_environment_id);
  if (!environment) {
    return launcherActionFailure(
      'environment_missing',
      'environment',
      'This provider environment is no longer available.',
      {
        environmentID: request.provider_environment_id,
        shouldRefreshSnapshot: true,
      },
    );
  }

  const runtimeTarget = await resolveProviderRuntimeLinkTarget(preferences, request.runtime_target_id);
  if (!runtimeTarget) {
    return launcherActionFailure(
      'runtime_not_started',
      'environment',
      'Start this runtime from its Local or SSH card before connecting it to a provider.',
      providerEnvironmentFailureContext(environment),
    );
  }
  const runtimeRecord = runtimeTarget.record;
  if (!runtimeRecord) {
    return launcherActionFailure(
      'runtime_not_started',
      'environment',
      'Start this runtime first, then connect it to this provider Environment.',
      providerEnvironmentFailureContext(environment),
    );
  }
  const currentBinding = runtimeServiceProviderLinkBinding(runtimeRecord.startup.runtime_service);
  if (currentBinding.state === 'linked' && !localRuntimeMatchesProvider(runtimeRecord.startup, environment)) {
    return runtimeTargetProviderBindingFailure(environment, runtimeTarget.label, runtimeRecord.startup);
  }
  if (!runtimeServiceSupportsProviderLink(runtimeRecord.startup.runtime_service)) {
    return launcherActionFailure(
      'provider_link_failed',
      'environment',
      `${runtimeTarget.label} does not support provider linking. Restart it from its runtime card with the current Desktop runtime, then connect again.`,
      providerEnvironmentFailureContext(environment),
    );
  }
  const runtimeControl = runtimeRecord.startup.runtime_control;
  if (!runtimeControl) {
    return launcherActionFailure(
      'provider_link_failed',
      'environment',
      `${runtimeTarget.label} does not expose Desktop runtime-control. Restart it from its runtime card, then connect again.`,
      providerEnvironmentFailureContext(environment),
    );
  }
  if (runtimeControl.desktop_owner_id !== await desktopRuntimeOwnerID()) {
    return launcherActionFailure(
      'provider_link_failed',
      'environment',
      `${runtimeTarget.label} is owned by another Desktop instance.`,
      providerEnvironmentFailureContext(environment),
    );
  }

  try {
    const providerSession = await requestProviderDesktopSessionMaterial(preferences, environment);
    if (!providerSession.bootstrapTicket) {
      return launcherActionFailure(
        'provider_invalid_response',
        'control_plane',
        'Desktop could not obtain a provider link ticket for this environment.',
        providerEnvironmentFailureContext(environment),
      );
    }
    const linked = await connectProviderLink(runtimeControl, {
      provider_origin: providerSession.controlPlane.provider.provider_origin,
      provider_id: providerSession.controlPlane.provider.provider_id,
      env_public_id: environment.env_public_id,
      bootstrap_ticket: providerSession.bootstrapTicket,
      expected_current_binding: currentBinding.state === 'linked'
        ? {
            provider_origin: currentBinding.provider_origin,
            provider_id: currentBinding.provider_id,
            env_public_id: currentBinding.env_public_id,
            binding_generation: currentBinding.binding_generation,
          }
        : undefined,
    });
    updateProviderRuntimeTargetStartup(runtimeTarget, {
      controlplane_base_url: linked.binding.provider_origin,
      controlplane_provider_id: linked.binding.provider_id,
      env_public_id: linked.binding.env_public_id,
      effective_run_mode: linked.runtime_service.effective_run_mode,
      remote_enabled: linked.runtime_service.remote_enabled,
      runtime_service: linked.runtime_service,
    });
    await persistDesktopPreferences(runtimeTarget.kind === 'local_environment'
      ? persistLocalEnvironmentProviderBinding(rememberProviderEnvironmentUse(providerSession.preferences, environment.id), environment)
      : rememberProviderEnvironmentUse(providerSession.preferences, environment.id));
    resetLauncherIssueState();
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('connected_provider_runtime');
  } catch (error) {
    return thrownLauncherActionFailure(error)
      ?? launcherActionFailureFromProviderAuthError(error, providerEnvironmentFailureContext(environment))
      ?? launcherActionFailureFromProviderLinkError(error, providerEnvironmentFailureContext(environment));
  }
}

async function disconnectProviderRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'disconnect_provider_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const environment = findProviderEnvironmentByID(preferences, request.provider_environment_id);
  if (!environment) {
    return launcherActionFailure(
      'environment_missing',
      'environment',
      'This provider environment is no longer available.',
      {
        environmentID: request.provider_environment_id,
        shouldRefreshSnapshot: true,
      },
    );
  }
  const runtimeTarget = await resolveProviderRuntimeLinkTarget(preferences, request.runtime_target_id);
  const runtimeRecord = runtimeTarget?.record ?? null;
  if (!runtimeRecord?.startup.runtime_control) {
    return launcherActionFailure(
      'runtime_not_started',
      'environment',
      'The selected runtime is not currently running.',
      providerEnvironmentFailureContext(environment),
    );
  }
  if (!localRuntimeMatchesProvider(runtimeRecord.startup, environment)) {
    return runtimeTargetProviderBindingFailure(environment, runtimeTarget?.label ?? 'Selected runtime', runtimeRecord.startup);
  }
  try {
    const unlinked = await disconnectProviderLink(runtimeRecord.startup.runtime_control);
    updateProviderRuntimeTargetStartup(runtimeTarget!, {
      controlplane_base_url: '',
      controlplane_provider_id: '',
      env_public_id: '',
      effective_run_mode: unlinked.runtime_service.effective_run_mode,
      remote_enabled: unlinked.runtime_service.remote_enabled,
      runtime_service: unlinked.runtime_service,
    });
    if (runtimeTarget?.kind === 'local_environment') {
      await persistDesktopPreferences({
        ...preferences,
        local_environment: {
          ...preferences.local_environment,
          current_provider_binding: undefined,
        },
      });
    }
    resetLauncherIssueState();
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('disconnected_provider_runtime');
  } catch (error) {
    return thrownLauncherActionFailure(error)
      ?? launcherActionFailureFromProviderLinkError(error, providerEnvironmentFailureContext(environment));
  }
}

async function cancelLauncherOperationFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'cancel_launcher_operation' }>>,
): Promise<DesktopLauncherActionResult> {
  const operation = launcherOperations.get(request.operation_key);
  if (!operation) {
    return launcherActionFailure(
      'operation_missing',
      'global',
      'That background task is no longer active.',
      {
        shouldRefreshSnapshot: true,
      },
    );
  }
  if (!operation.cancelable) {
    return launcherActionFailure(
      'operation_not_cancelable',
      'global',
      'That background task cannot be canceled at this stage.',
      {
        shouldRefreshSnapshot: true,
      },
    );
  }
  launcherOperations.cancel(request.operation_key, operation.interrupt_detail || 'Desktop is stopping this background task.');
  broadcastDesktopWelcomeSnapshots();
  return launcherActionSuccess('canceled_launcher_operation');
}

async function stopEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'stop_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  const placement = runtimePlacementFromRequest(request);
  if (placement.kind === 'container_process') {
    const runtimeRecord = runtimePlacementBridgeRecordForRequest(request);
    if (!runtimeRecord) {
      return launcherActionFailure(
        'action_invalid',
        'environment',
        'The runtime is not currently running.',
        {
          environmentID: runtimeTargetEnvironmentIDFromRequest(request),
        },
      );
    }
    const liveRuntimeSession = liveSession(desktopSessionKeyFromRuntimeTargetID(runtimeRecord.session.placement_target_id));
    if (liveRuntimeSession) {
      await finalizeSessionClosure(liveRuntimeSession.session_key);
    }
    await runtimeRecord.session.stop();
    runtimePlacementBridgeByTargetID.delete(runtimeRecord.session.placement_target_id);
    resetLauncherIssueState();
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('stopped_environment_runtime');
  }

  if (request.external_local_ui_url) {
    return launcherActionFailure(
      'action_invalid',
      'environment',
      'This runtime is managed externally and cannot be stopped from Desktop.',
      {
        environmentID: request.environment_id,
      },
    );
  }

  const sshDetails = sshDetailsFromRuntimeTargetRequest(request);
  if (sshDetails) {
    const runtimeKey = sshDesktopSessionKey(sshDetails);
    const pendingStart = pendingSSHRuntimeStartByKey.get(runtimeKey) ?? null;
    if (pendingStart) {
      launcherOperations.cancel(pendingStart.operation_key, 'Desktop is canceling the SSH startup task.');
      broadcastDesktopWelcomeSnapshots();
      return launcherActionSuccess('canceled_launcher_operation');
    }
    const runtimeRecord = sshEnvironmentRuntimeByKey.get(runtimeKey) ?? null;
    if (!runtimeRecord) {
      return launcherActionFailure(
        'action_invalid',
        'environment',
        'The runtime is not currently running.',
        {
          environmentID: request.environment_id,
        },
      );
    }
    const liveSessionRecord = liveSession(runtimeKey);
    if (liveSessionRecord) {
      await finalizeSessionClosure(liveSessionRecord.session_key);
    }
    await runtimeRecord.stop();
    sshEnvironmentRuntimeByKey.delete(runtimeKey);
    sshRuntimeMaintenanceByKey.delete(runtimeKey);
    resetLauncherIssueState();
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('stopped_environment_runtime');
  }

  const preferences = await loadDesktopPreferencesCached();
  const environmentID = compact(request.environment_id);
  const environment = findLocalEnvironmentByID(preferences, environmentID);
  if (!environment || !environment.local_hosting) {
    const providerEnvironment = findProviderEnvironmentByID(preferences, environmentID);
    if (!providerEnvironment) {
      return launcherActionFailure(
        'environment_missing',
        'environment',
        'This environment is no longer available.',
        {
          environmentID,
          shouldRefreshSnapshot: true,
        },
      );
    }
    return launcherActionFailure(
      'action_invalid',
      'environment',
      'Provider Environment cards do not manage runtime lifecycle. Use the Local or SSH runtime card to stop a managed runtime.',
      providerEnvironmentFailureContext(providerEnvironment),
    );
  }

  const runtimeRecord = currentLocalEnvironmentRuntimeRecord(environment) ?? await attachLocalEnvironmentRuntime(environment);
  if (!runtimeRecord) {
    return launcherActionFailure(
      'action_invalid',
      'environment',
      'The runtime is not currently running.',
      {
        environmentID: environment.id,
      },
    );
  }

  const liveLocalSession = [...sessionsByKey.values()].find((sessionRecord) => (
    !sessionRecord.closing
    && sessionRecord.target.kind === 'local_environment'
    && sessionRecord.target.environment_id === environment.id
    && sessionRecord.target.route === 'local_host'
  )) ?? null;
  if (liveLocalSession) {
    await finalizeSessionClosure(liveLocalSession.session_key);
  }
  await runtimeRecord.runtime_handle.stop();
  clearLocalEnvironmentRuntimeRecord(environment);
  resetLauncherIssueState();
  broadcastDesktopWelcomeSnapshots();
  return launcherActionSuccess('stopped_environment_runtime');
}

async function refreshEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'refresh_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  const placement = runtimePlacementFromRequest(request);
  if (placement.kind === 'container_process') {
    const runtimeRecord = runtimePlacementBridgeRecordForRequest(request);
    if (runtimeRecord) {
      try {
        const startup = await loadExternalLocalUIStartup(runtimeRecord.startup.local_ui_url, DESKTOP_RUNTIME_PROBE_TIMEOUT_MS);
        if (startup) {
          runtimePlacementBridgeByTargetID.set(runtimeRecord.session.placement_target_id, {
            ...runtimeRecord,
            startup: {
              ...runtimeRecord.startup,
              local_ui_url: startup.local_ui_url,
              local_ui_urls: startup.local_ui_urls,
              runtime_control: runtimeRecord.startup.runtime_control,
              password_required: startup.password_required,
              runtime_service: startup.runtime_service ?? runtimeRecord.startup.runtime_service,
            },
          });
        }
      } catch {
        await runtimeRecord.session.disconnect().catch(() => undefined);
        runtimePlacementBridgeByTargetID.delete(runtimeRecord.session.placement_target_id);
      }
    } else {
      await inspectRuntimeTargetContainer(runtimeHostAccessFromRequest(request), placement).catch(() => undefined);
    }
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('refreshed_environment_runtime');
  }

  const preferences = await loadDesktopPreferencesCached();
  const providerEnvironment = request.environment_id
    ? findProviderEnvironmentByID(preferences, request.environment_id)
    : null;
  if (providerEnvironment) {
    try {
      await refreshProviderEnvironmentRuntimeHealth(
        providerEnvironment.provider_origin,
        providerEnvironment.provider_id,
        [providerEnvironment.env_public_id],
      );
    } catch (error) {
      return launcherActionFailureFromProviderAuthError(error, {
        environmentID: providerEnvironment.id,
        providerOrigin: providerEnvironment.provider_origin,
        providerID: providerEnvironment.provider_id,
        envPublicID: providerEnvironment.env_public_id,
      }) ?? launcherActionFailureFromUnexpectedError(error);
    }
  }
  broadcastDesktopWelcomeSnapshots();
  return launcherActionSuccess('refreshed_environment_runtime');
}

async function refreshAllEnvironmentRuntimesFromLauncher(): Promise<DesktopLauncherActionResult> {
  try {
    await refreshAllProviderEnvironmentRuntimeHealth();
  } catch (error) {
    const providerError = error instanceof DesktopProviderRequestError
      ? launcherActionFailureFromProviderAuthError(error)
      : null;
    if (providerError) {
      return providerError;
    }
    return launcherActionFailureFromUnexpectedError(error);
  }
  broadcastDesktopWelcomeSnapshots();
  return launcherActionSuccess('refreshed_all_environment_runtimes');
}

async function startControlPlaneConnectFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'start_control_plane_connect' }>>,
): Promise<DesktopLauncherActionResult> {
  await startControlPlaneAuthorization({
    providerOrigin: request.provider_origin,
    displayLabel: request.display_label,
  });
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
      'This provider is no longer saved in Desktop.',
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
      controlPlaneIssueForError(error, 'Desktop failed to refresh this provider.').message,
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
      'This provider is no longer saved in Desktop.',
      {
        providerOrigin: request.provider_origin,
        providerID: request.provider_id,
        shouldRefreshSnapshot: true,
      },
    );
  }
  const subjectID = desktopControlPlaneKey(request.provider_origin, request.provider_id);
  launcherOperations.markSubjectDeleted(
    'control_plane',
    subjectID,
  );
  const refreshToken = controlPlaneRefreshToken(preferences, request.provider_origin, request.provider_id);
  const providerSessionKeys = [...sessionsByKey.values()]
    .filter((sessionRecord) => (
      !sessionRecord.closing
      && sessionRecord.target.kind === 'local_environment'
      && sessionRecord.target.provider_origin === request.provider_origin
      && sessionRecord.target.provider_id === request.provider_id
    ))
    .map((sessionRecord) => sessionRecord.session_key);
  await persistDesktopPreferences(deleteSavedControlPlane(preferences, request.provider_origin, request.provider_id));
  clearControlPlaneTransientState(request.provider_origin, request.provider_id);
  void cleanupDeletedControlPlane(controlPlane, refreshToken, providerSessionKeys);
  resetLauncherIssueState();
  return launcherActionSuccess('deleted_control_plane', {
    utilityWindowKind: 'launcher',
  });
}

async function cleanupDeletedControlPlane(
  controlPlane: DesktopSavedControlPlane,
  refreshToken: string,
  providerSessionKeys: readonly DesktopSessionKey[],
): Promise<void> {
  if (refreshToken !== '') {
    try {
      await revokeProviderDesktopAuthorization(controlPlane.provider, refreshToken);
    } catch (error) {
      console.warn('Redeven Desktop failed to revoke a deleted provider authorization.', error);
    }
  }
  for (const sessionKey of providerSessionKeys) {
    try {
      await finalizeSessionClosure(sessionKey);
    } catch (error) {
      console.warn('Redeven Desktop failed to close a deleted provider session.', error);
    }
  }
}

async function openProviderEnvironmentFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_provider_environment' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const environment = findProviderEnvironmentByID(preferences, request.environment_id);
  if (!environment) {
    return launcherActionFailure(
      'environment_missing',
      'environment',
      'This provider environment is no longer available.',
      {
        environmentID: request.environment_id,
        shouldRefreshSnapshot: true,
      },
    );
  }
  const requestedRoute = request.route === 'local_host' || request.route === 'remote_desktop'
    ? request.route
    : 'auto';
  if (requestedRoute === 'local_host') {
    return launcherActionFailure(
      'environment_route_unavailable',
      'environment',
      'Provider Environment cards open through the provider tunnel. Use the Local or SSH runtime card to open a managed runtime directly.',
      providerEnvironmentFailureContext(environment),
    );
  }
  if (requestedRoute !== 'auto' && requestedRoute !== desktopProviderEnvironmentOpenRoute()) {
    return launcherActionFailure(
      'environment_route_unavailable',
      'environment',
      'Provider Environment cards open through the provider tunnel. Use the Local or SSH runtime card to open a managed runtime directly.',
      providerEnvironmentFailureContext(environment),
    );
  }

  try {
    const openSession = await prepareProviderRemoteOpenSession(preferences, environment);
    return openProviderEnvironmentWithOpenSession({
      providerOrigin: openSession.controlPlane.provider.provider_origin,
      providerID: openSession.controlPlane.provider.provider_id,
      envPublicID: environment.env_public_id,
      bootstrapTicket: openSession.bootstrapTicket,
      remoteSessionURL: openSession.remoteSessionURL,
      label: openSession.label,
    });
  } catch (error) {
    const failure = thrownLauncherActionFailure(error);
    if (failure) {
      return failure;
    }
    return launcherActionFailureFromProviderAuthError(error, {
      environmentID: environment.id,
      providerOrigin: environment.provider_origin,
      providerID: environment.provider_id,
      envPublicID: environment.env_public_id,
    }) ?? launcherActionFailureFromUnexpectedError(error);
  }
}

async function focusEnvironmentWindow(sessionKey: string): Promise<DesktopLauncherActionResult> {
  const cleanSessionKey = String(sessionKey ?? '').trim() as DesktopSessionKey;
  const sessionRecord = liveSession(cleanSessionKey);
  if (sessionRecord?.lifecycle === 'opening') {
    return launcherActionFailureForOpeningSession(sessionRecord, {
      environmentID: sessionRecord.target.environment_id,
    });
  }
  if (!focusEnvironmentSession(cleanSessionKey, { stealAppFocus: true })) {
    return launcherActionFailure(
      'session_stale',
      'environment',
      DESKTOP_STALE_WINDOW_MESSAGE,
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

function runtimeMaintenanceActionPlan(args: Readonly<{
  availability: DesktopShellRuntimeMaintenanceActionPlan['availability'];
  method: DesktopShellRuntimeMaintenanceMethod;
  label: string;
  confirmLabel: string;
  title: string;
  message: string;
  detail?: string;
  unavailableReasonCode?: string;
  requiresTargetVersion?: boolean;
}>): DesktopShellRuntimeMaintenanceActionPlan {
  return {
    availability: args.availability,
    method: args.method,
    label: args.label,
    confirm_label: args.confirmLabel,
    title: args.title,
    message: args.message,
    detail: args.detail,
    unavailable_reason_code: args.unavailableReasonCode,
    requires_target_version: args.requiresTargetVersion,
  };
}

function unavailableRuntimeMaintenanceAction(
  kind: 'restart' | 'upgrade',
  message: string,
  reasonCode: string,
  availability: DesktopShellRuntimeMaintenanceActionPlan['availability'] = 'unavailable',
): DesktopShellRuntimeMaintenanceActionPlan {
  return runtimeMaintenanceActionPlan({
    availability,
    method: availability === 'external' ? 'host_device_handoff' : 'manual',
    label: kind === 'restart' ? 'Restart runtime' : 'Update Redeven',
    confirmLabel: kind === 'restart' ? 'Restart' : 'Update',
    title: kind === 'restart' ? 'Restart Runtime Service?' : 'Update Runtime Service?',
    message,
    unavailableReasonCode: reasonCode,
    requiresTargetVersion: kind === 'upgrade',
  });
}

function runtimeRPCMaintenanceAction(kind: 'restart' | 'upgrade'): DesktopShellRuntimeMaintenanceActionPlan {
  return runtimeMaintenanceActionPlan({
    availability: 'available',
    method: kind === 'restart' ? 'runtime_rpc_restart' : 'runtime_rpc_upgrade',
    label: kind === 'restart' ? 'Restart runtime' : 'Update Redeven',
    confirmLabel: kind === 'restart' ? 'Restart' : 'Update',
    title: kind === 'restart' ? 'Restart Runtime Service?' : 'Update Runtime Service?',
    message: kind === 'restart'
      ? 'The Runtime Service will restart itself through its secure runtime RPC.'
      : 'The Runtime Service will install the requested release through its secure runtime RPC.',
    requiresTargetVersion: kind === 'upgrade',
  });
}

function runtimeServiceOwnerForSession(sessionRecord: DesktopSessionRecord): DesktopShellRuntimeMaintenanceContext['service_owner'] {
  const owner = sessionRecord.startup.runtime_service?.service_owner;
  if (owner === 'desktop' || owner === 'external') {
    return owner;
  }
  return sessionRecord.startup.desktop_managed === true ? 'desktop' : 'unknown';
}

function runtimeMaintenanceContextFromSession(
  sessionRecord: DesktopSessionRecord | null,
): DesktopShellRuntimeMaintenanceContext {
  const missingMessage = 'Runtime maintenance is not available from this Desktop session.';
  if (!sessionRecord) {
    return {
      available: false,
      authority: 'manual',
      runtime_kind: 'unknown',
      lifecycle_owner: 'unknown',
      service_owner: 'unknown',
      desktop_managed: false,
      upgrade_policy: 'manual',
      restart: unavailableRuntimeMaintenanceAction('restart', missingMessage, 'desktop_session_missing'),
      upgrade: unavailableRuntimeMaintenanceAction('upgrade', missingMessage, 'desktop_session_missing'),
    };
  }

  const runtimeHandle = sessionRecord.runtime_handle;
  const runtimeService = sessionRecord.startup.runtime_service;
  const desktopManaged = sessionRecord.startup.desktop_managed === true || runtimeService?.desktop_managed === true;
  const activeWorkload = runtimeService?.active_workload;
  const base = {
    current_version: runtimeService?.runtime_version,
    active_workload: activeWorkload,
  };

  if (sessionRecord.target.kind === 'ssh_environment' && runtimeHandle?.runtime_kind === 'ssh') {
    return {
      ...base,
      available: true,
      authority: 'desktop_ssh',
      runtime_kind: 'ssh',
      lifecycle_owner: runtimeHandle.lifecycle_owner,
      service_owner: runtimeServiceOwnerForSession(sessionRecord),
      desktop_managed: desktopManaged,
      upgrade_policy: 'desktop_release',
      restart: runtimeMaintenanceActionPlan({
        availability: 'available',
        method: 'desktop_ssh_restart',
        label: 'Restart SSH runtime',
        confirmLabel: 'Restart',
        title: 'Restart SSH Runtime?',
        message: 'Redeven Desktop will restart the SSH-hosted Runtime Service and reopen this session through a new local tunnel.',
        detail: 'Active work on the remote host may be interrupted while the runtime stops and starts again.',
        requiresTargetVersion: false,
      }),
      upgrade: runtimeMaintenanceActionPlan({
        availability: 'available',
        method: 'desktop_ssh_force_update',
        label: 'Update SSH runtime',
        confirmLabel: 'Update',
        title: 'Update SSH Runtime?',
        message: 'Redeven Desktop will reinstall the SSH-hosted Runtime Service from the Desktop-managed release and reopen this session.',
        detail: 'The existing SSH bootstrap path, release asset cache, and remote install strategy are reused for this update.',
        requiresTargetVersion: false,
      }),
    };
  }

  if (
    sessionRecord.target.kind === 'local_environment'
    && sessionRecord.target.route === 'local_host'
    && runtimeHandle?.runtime_kind === 'local_environment'
    && runtimeHandle.lifecycle_owner === 'desktop'
  ) {
    return {
      ...base,
      available: true,
      authority: 'desktop_local',
      runtime_kind: 'local_environment',
      lifecycle_owner: 'desktop',
      service_owner: runtimeServiceOwnerForSession(sessionRecord),
      desktop_managed: desktopManaged,
      upgrade_policy: 'desktop_release',
      restart: runtimeMaintenanceActionPlan({
        availability: 'available',
        method: 'desktop_local_restart',
        label: 'Restart runtime',
        confirmLabel: 'Restart',
        title: 'Restart Runtime Service?',
        message: 'Redeven Desktop will restart this local Runtime Service and reopen the current session.',
        detail: 'Active work may be interrupted while the persistent service restarts.',
        requiresTargetVersion: false,
      }),
      upgrade: runtimeMaintenanceActionPlan({
        availability: 'available',
        method: 'desktop_local_update_handoff',
        label: 'Manage in Desktop',
        confirmLabel: 'Continue',
        title: 'Update Redeven Desktop?',
        message: 'This Runtime Service is bundled with Redeven Desktop. Desktop will explain whether a newer app release is required.',
        detail: 'Desktop keeps this Environment bound to the same Local Environment profile after the update handoff.',
        requiresTargetVersion: false,
      }),
    };
  }

  if (sessionRecord.target.kind === 'local_environment' && sessionRecord.target.route === 'remote_desktop') {
    const message = 'This Environment is hosted on another device. Run restart or update from the host device.';
    return {
      ...base,
      available: false,
      authority: 'host_device',
      runtime_kind: runtimeHandle?.runtime_kind ?? 'unknown',
      lifecycle_owner: runtimeHandle?.lifecycle_owner ?? 'unknown',
      service_owner: runtimeServiceOwnerForSession(sessionRecord),
      desktop_managed: desktopManaged,
      upgrade_policy: 'manual',
      restart: unavailableRuntimeMaintenanceAction('restart', message, 'host_device_required', 'external'),
      upgrade: unavailableRuntimeMaintenanceAction('upgrade', message, 'host_device_required', 'external'),
    };
  }

  if (!desktopManaged) {
    return {
      ...base,
      available: true,
      authority: 'runtime_rpc',
      runtime_kind: runtimeHandle?.runtime_kind ?? (sessionRecord.target.kind === 'external_local_ui' ? 'external' : 'unknown'),
      lifecycle_owner: runtimeHandle?.lifecycle_owner ?? 'unknown',
      service_owner: runtimeServiceOwnerForSession(sessionRecord),
      desktop_managed: false,
      upgrade_policy: 'self_upgrade',
      restart: runtimeRPCMaintenanceAction('restart'),
      upgrade: runtimeRPCMaintenanceAction('upgrade'),
    };
  }

  const message = 'This Runtime Service is managed by another Redeven host process. Run maintenance from that host process.';
  return {
    ...base,
    available: false,
    authority: 'host_device',
    runtime_kind: runtimeHandle?.runtime_kind ?? (sessionRecord.target.kind === 'external_local_ui' ? 'external' : 'unknown'),
    lifecycle_owner: runtimeHandle?.lifecycle_owner ?? 'unknown',
    service_owner: runtimeServiceOwnerForSession(sessionRecord),
    desktop_managed: desktopManaged,
    upgrade_policy: 'manual',
    restart: unavailableRuntimeMaintenanceAction('restart', message, 'managed_elsewhere', 'external'),
    upgrade: unavailableRuntimeMaintenanceAction('upgrade', message, 'managed_elsewhere', 'external'),
  };
}

function desktopShellRuntimeActionUnavailable(message: string): DesktopShellRuntimeActionResponse {
  return {
    ok: false,
    started: false,
    message,
  };
}

async function restartManagedRuntimeFromShell(webContentsID: number): Promise<DesktopShellRuntimeActionResponse> {
  const sessionRecord = sessionRecordForWebContentsID(webContentsID);
  if (!sessionRecord || sessionRecord.target.kind !== 'local_environment' || !sessionRecord.runtime_handle || sessionRecord.runtime_handle.runtime_kind !== 'local_environment') {
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
  const sessionTarget = sessionRecord.target;
  const previousRuntimeHandle = sessionRecord.runtime_handle;
  const preferences = await loadDesktopPreferencesCached();
  const providerEnvironment = (
    sessionTarget.provider_origin
    && sessionTarget.provider_id
    && sessionTarget.env_public_id
  )
    ? preferences.provider_environments.find((entry) => (
      entry.provider_origin === sessionTarget.provider_origin
      && entry.provider_id === sessionTarget.provider_id
      && entry.env_public_id === sessionTarget.env_public_id
    )) ?? null
    : null;
  const environment = providerEnvironment
    ? localEnvironmentForProviderBinding(preferences, providerEnvironment)
    : findLocalEnvironmentByID(preferences, sessionTarget.environment_id);
  if (!environment) {
    return {
      ok: false,
      started: false,
      message: 'Desktop could not resolve the current environment settings.',
    };
  }
  const localUIBind = resolveManagedRestartBindOverride(environment, sessionRecord.startup) ?? undefined;

  for (const childWindow of sessionRecord.child_windows.values()) {
    sessionKeyByWebContentsID.delete(childWindow.webContentsID);
    const browserWindow = liveTrackedBrowserWindow(childWindow);
    if (browserWindow) {
      browserWindow.close();
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
  });
  if (!prepared.ok) {
    await finalizeSessionClosure(sessionRecord.session_key);
    await openUtilityWindow('launcher', {
      entryReason: prepared.entryReason,
      issue: prepared.issue,
      selectedEnvironmentID: environment.id,
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
    desktopOwnerID: await desktopRuntimeOwnerID(),
  });
  sessionRecord.startup = prepared.launch.managedRuntime.startup;
  updateLocalEnvironmentRuntimeRecord(environment, sessionRecord.startup, sessionRecord.runtime_handle);
  sessionRecord.allowed_base_url = prepared.launch.managedRuntime.startup.local_ui_url;
  sessionRecord.target = buildLocalEnvironmentDesktopTarget(environment, { route: 'local_host' });
  sessionRecord.entry_url = desktopSessionEntryURL(sessionRecord.target, sessionRecord.startup);
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
  const rootWindow = liveTrackedBrowserWindow(sessionRecord.root_window);
  if (!rootWindow) {
    return {
      ok: false,
      started: false,
      message: DESKTOP_STALE_WINDOW_MESSAGE,
    };
  }
  await rootWindow.loadURL(sessionRecord.entry_url);
  focusEnvironmentSession(sessionRecord.session_key, { stealAppFocus: true });
  broadcastDesktopWelcomeSnapshots();

  return {
    ok: true,
    started: true,
    message: 'Desktop restarted the managed runtime.',
  };
}

async function restartSSHRuntimeFromShell(
  sessionRecord: DesktopSessionRecord,
  options: Readonly<{ forceRuntimeUpdate?: boolean }> = {},
): Promise<DesktopShellRuntimeActionResponse> {
  if (sessionRecord.target.kind !== 'ssh_environment' || sessionRecord.runtime_handle?.runtime_kind !== 'ssh') {
    return desktopShellRuntimeActionUnavailable('SSH runtime maintenance is not active for this session.');
  }

  const previousRuntimeHandle = sessionRecord.runtime_handle;
  const previousTarget = sessionRecord.target;
  const sshDetails = normalizeDesktopSSHEnvironmentDetails({
    ssh_destination: previousTarget.ssh_destination,
    ssh_port: previousTarget.ssh_port,
    auth_mode: previousTarget.auth_mode,
    remote_install_dir: previousTarget.remote_install_dir,
    bootstrap_strategy: previousTarget.bootstrap_strategy,
    release_base_url: previousTarget.release_base_url,
    connect_timeout_seconds: previousTarget.connect_timeout_seconds,
  });
  const runtimeKey = sshDesktopSessionKey(sshDetails);
  const existingRuntimeRecord = sshEnvironmentRuntimeByKey.get(runtimeKey) ?? null;

  for (const childWindow of sessionRecord.child_windows.values()) {
    sessionKeyByWebContentsID.delete(childWindow.webContentsID);
    const browserWindow = liveTrackedBrowserWindow(childWindow);
    if (browserWindow) {
      browserWindow.close();
    }
  }
  sessionRecord.child_windows.clear();

  try {
    await sessionRecord.diagnostics.recordLifecycle(
      options.forceRuntimeUpdate === true ? 'target_updating' : 'target_restarting',
      options.forceRuntimeUpdate === true
        ? 'desktop requested an SSH runtime update'
        : 'desktop requested an SSH runtime restart',
      {
        ssh_runtime_key: runtimeKey,
      },
    );
    sshEnvironmentRuntimeByKey.delete(runtimeKey);
    sshRuntimeMaintenanceByKey.delete(runtimeKey);
    if (existingRuntimeRecord) {
      await existingRuntimeRecord.stop();
    } else {
      await previousRuntimeHandle.stop();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return desktopShellRuntimeActionUnavailable(message || 'Failed to stop the SSH runtime.');
  }

  sessionRecord.runtime_handle = null;
  sessionRecord.diagnostics.clearRuntime();

  let runtimeRecord: SSHEnvironmentRuntimeRecord;
  try {
    runtimeRecord = await startSSHEnvironmentRuntimeRecord(sshDetails, {
      environmentID: previousTarget.environment_id,
      label: previousTarget.label,
      forceRuntimeUpdate: options.forceRuntimeUpdate === true,
      allowActiveWorkReplacement: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return desktopShellRuntimeActionUnavailable(firstDisplayLine(message) || 'Desktop could not start the SSH runtime.');
  }

  sessionRecord.runtime_handle = runtimeRecord.runtime_handle;
  sessionRecord.startup = runtimeRecord.startup;
  sessionRecord.allowed_base_url = runtimeRecord.local_forward_url;
  const nextTarget = buildSSHDesktopTarget(runtimeRecord.details, {
    environmentID: runtimeRecord.environment_id,
    label: runtimeRecord.label,
    forwardedLocalUIURL: runtimeRecord.local_forward_url,
  });
  if (nextTarget.session_key !== sessionRecord.session_key) {
    return desktopShellRuntimeActionUnavailable('SSH runtime restart changed the session identity; close and reopen this Environment.');
  }
  sessionRecord.target = nextTarget;
  sessionRecord.entry_url = desktopSessionEntryURL(sessionRecord.target, sessionRecord.startup);
  await sessionRecord.diagnostics.configureRuntime(sessionRecord.startup, sessionRecord.allowed_base_url);
  await sessionRecord.diagnostics.recordLifecycle(
    options.forceRuntimeUpdate === true ? 'runtime_updated' : 'runtime_started',
    options.forceRuntimeUpdate === true
      ? 'desktop updated and reopened an SSH runtime'
      : 'desktop restarted an SSH runtime',
    {
      ssh_runtime_key: runtimeKey,
      runtime_launch_mode: runtimeRecord.runtime_handle.launch_mode,
      effective_run_mode: runtimeRecord.startup.effective_run_mode ?? '',
    },
  );

  const rootWindow = liveTrackedBrowserWindow(sessionRecord.root_window);
  if (!rootWindow) {
    return desktopShellRuntimeActionUnavailable(DESKTOP_STALE_WINDOW_MESSAGE);
  }
  await rootWindow.loadURL(sessionRecord.entry_url);
  focusEnvironmentSession(sessionRecord.session_key, { stealAppFocus: true });
  broadcastDesktopWelcomeSnapshots();

  return {
    ok: true,
    started: true,
    message: options.forceRuntimeUpdate === true
      ? 'Desktop updated the SSH runtime.'
      : 'Desktop restarted the SSH runtime.',
  };
}

async function manageDesktopUpdateFromShell(webContentsID: number): Promise<DesktopShellRuntimeActionResponse> {
  const sessionRecord = sessionRecordForWebContentsID(webContentsID);
  if (!sessionRecord || sessionRecord.target.kind !== 'local_environment') {
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
    sessionRecord.runtime_handle.runtime_kind !== 'local_environment'
    || sessionRecord.runtime_handle.lifecycle_owner !== 'desktop'
  ) {
    return {
      ok: false,
      started: false,
      message: 'This environment is managed by another Redeven host process on this device. Run updates from that host process instead.',
    };
  }

  const environmentKindLabel = sessionRecord.target.local_environment_kind === 'controlplane'
    ? 'Provider environment'
    : 'Local environment';
  const detail = sessionRecord.target.local_environment_kind === 'controlplane'
    ? 'Desktop will keep this environment in the same provider-backed Local Environment profile and may need a newer desktop release before redeploying the managed runtime.'
    : 'Desktop will keep this environment on the same Local Environment profile and may need a newer desktop release before restarting the managed runtime.';
  const dialogOptions: MessageBoxOptions = {
    type: 'info',
    buttons: ['Open release page', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Manage Desktop Update',
    message: `${sessionRecord.target.label} is managed by Redeven Desktop.`,
    detail: `${detail}\n\nAffected runtime: ${environmentKindLabel} for this profile.\n\nDesktop and remote access will continue to resolve to the same environment after the update.`,
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

async function performRuntimeMaintenanceFromShell(
  webContentsID: number,
  action: 'restart' | 'upgrade',
): Promise<DesktopShellRuntimeActionResponse> {
  const sessionRecord = sessionRecordForWebContentsID(webContentsID);
  const context = runtimeMaintenanceContextFromSession(sessionRecord);
  const plan = action === 'restart' ? context.restart : context.upgrade;
  if (!sessionRecord || plan.availability !== 'available') {
    return desktopShellRuntimeActionUnavailable(plan.message);
  }

  switch (plan.method) {
    case 'desktop_local_restart':
      return restartManagedRuntimeFromShell(webContentsID);
    case 'desktop_local_update_handoff':
      return manageDesktopUpdateFromShell(webContentsID);
    case 'desktop_ssh_restart':
      return restartSSHRuntimeFromShell(sessionRecord, { forceRuntimeUpdate: false });
    case 'desktop_ssh_force_update':
      return restartSSHRuntimeFromShell(sessionRecord, { forceRuntimeUpdate: true });
    case 'runtime_rpc_restart':
    case 'runtime_rpc_upgrade':
      return desktopShellRuntimeActionUnavailable('Use the Runtime Service secure RPC for this maintenance action.');
    case 'host_device_handoff':
    case 'manual':
    default:
      return desktopShellRuntimeActionUnavailable(plan.message);
  }
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

async function saveLocalEnvironmentSettingsFromWelcome(
  draft: DesktopSettingsDraft,
): Promise<DesktopLocalEnvironmentState> {
  const preferences = await loadDesktopPreferencesCached();
  const existing = preferences.local_environment;
  const existingAccess = localEnvironmentAccess(existing);
  const access = validateDesktopSettingsDraft(draft, {
    currentLocalUIPassword: existingAccess?.local_ui_password ?? '',
    currentLocalUIPasswordConfigured: existingAccess?.local_ui_password_configured === true,
  });
  const next = updateLocalEnvironmentAccess(preferences, existing.id, access);
  const resolvedEnvironment = next.local_environment;
  await persistDesktopPreferences(next);
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
    auth_mode: details.auth_mode,
    remote_install_dir: details.remote_install_dir,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
    connect_timeout_seconds: details.connect_timeout_seconds,
    last_used_at_ms: existing?.last_used_at_ms ?? Date.now(),
  });
  await persistDesktopPreferences(next);
}

async function setLocalEnvironmentPinnedFromWelcome(
  environmentID: string,
  pinned: boolean,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(setLocalEnvironmentPinned(preferences, environmentID, pinned));
}

async function setProviderEnvironmentPinnedFromWelcome(
  environmentID: string,
  pinned: boolean,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(setProviderEnvironmentPinned(preferences, environmentID, pinned));
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
    auth_mode: details.auth_mode,
    remote_install_dir: details.remote_install_dir,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
    connect_timeout_seconds: details.connect_timeout_seconds,
  }));
}

async function setSavedRuntimeTargetPinnedFromWelcome(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'set_saved_runtime_target_pinned' }>>,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const existing = preferences.saved_runtime_targets.find((target) => target.id === request.environment_id);
  await persistDesktopPreferences(setSavedRuntimeTargetPinned(preferences, {
    environment_id: request.environment_id,
    label: request.label,
    pinned: request.pinned,
    host_access: request.host_access,
    placement: request.placement,
    last_used_at_ms: existing?.last_used_at_ms ?? Date.now(),
  }));
}

async function upsertSavedRuntimeTargetFromWelcome(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'upsert_saved_runtime_target' }>>,
): Promise<void> {
  if (request.placement.kind === 'container_process') {
    await assertRuntimeTargetContainerRunning(request.host_access, request.placement);
  }
  const preferences = await loadDesktopPreferencesCached();
  const next = upsertSavedRuntimeTarget(preferences, {
    id: request.environment_id,
    label: request.label,
    host_access: request.host_access,
    placement: request.placement,
    last_used_at_ms: Date.now(),
  });
  await persistDesktopPreferences(next);
}

async function deleteSavedEnvironmentFromWelcome(environmentID: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(deleteSavedEnvironment(preferences, environmentID));
}

async function deleteSavedSSHEnvironmentFromWelcome(environmentID: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const existing = preferences.saved_ssh_environments.find((environment) => environment.id === environmentID) ?? null;
  const runtimeKey = existing ? sshDesktopSessionKey(existing) : null;
  if (runtimeKey !== null) {
    launcherOperations.markSubjectDeleted('ssh_environment', runtimeKey, {
      status: 'canceling',
      phase: 'canceling_deleted_connection',
      title: 'Connection removed',
      detail: 'Desktop is canceling any startup task that still belongs to this deleted connection.',
      cancelable: false,
      deleted_subject: true,
    });
  }
  await persistDesktopPreferences(deleteSavedSSHEnvironment(preferences, environmentID));
  if (runtimeKey) {
    sshRuntimeMaintenanceByKey.delete(runtimeKey);
    const pendingStart = pendingSSHRuntimeStartByKey.get(runtimeKey) ?? null;
    if (pendingStart) {
      launcherOperations.cancel(pendingStart.operation_key, 'Connection removed. Desktop is canceling the SSH startup task in the background.');
    }
  }
}

async function deleteSavedRuntimeTargetFromWelcome(environmentID: string): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  await persistDesktopPreferences(deleteSavedRuntimeTarget(preferences, environmentID));
  const runtimeTargetID = compact(environmentID) as DesktopRuntimeTargetID;
  const runtimeRecord = runtimePlacementBridgeByTargetID.get(runtimeTargetID) ?? null;
  if (runtimeRecord) {
    const liveRuntimeSession = liveSession(desktopSessionKeyFromRuntimeTargetID(runtimeTargetID));
    if (liveRuntimeSession) {
      await finalizeSessionClosure(liveRuntimeSession.session_key);
    }
    await runtimeRecord.session.disconnect().catch(() => undefined);
    runtimePlacementBridgeByTargetID.delete(runtimeTargetID);
  }
}

async function listRuntimeContainersFromLauncher(
  request: unknown,
): Promise<DesktopRuntimeContainerListResponse> {
  const normalized = normalizeDesktopRuntimeContainerListRequest(request);
  if (!normalized) {
    return {
      ok: false,
      message: 'Choose a valid host and container engine first.',
    };
  }
  try {
    const executor = normalized.host_access.kind === 'ssh_host'
      ? createSSHRuntimeHostExecutor(normalized.host_access.ssh)
      : createLocalRuntimeHostExecutor();
    const result = await executor.run(containerListCommand(normalized.engine), {
      signal: AbortSignal.timeout(DESKTOP_RUNTIME_PROBE_TIMEOUT_MS),
    });
    return {
      ok: true,
      containers: parseContainerListOutput(normalized.engine, result.stdout),
    };
  } catch (error) {
    const hostLabel = normalized.host_access.kind === 'ssh_host'
      ? ` on ${normalized.host_access.ssh.ssh_destination}`
      : '';
    const message = firstDisplayLine(error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      message: message || `Desktop could not list running ${normalized.engine} containers${hostLabel}.`,
    };
  }
}

async function performDesktopLauncherAction(request: DesktopLauncherActionRequest): Promise<DesktopLauncherActionResult> {
  switch (request.kind) {
    case 'open_local_environment':
      return openLocalEnvironmentFromLauncher(request);
    case 'open_remote_environment':
      return openRemoteEnvironmentFromLauncher(request);
    case 'open_ssh_environment':
      return openSSHEnvironmentFromLauncher(request);
    case 'start_environment_runtime':
      return startEnvironmentRuntimeFromLauncher(request);
    case 'connect_provider_runtime':
      return connectProviderRuntimeFromLauncher(request);
    case 'disconnect_provider_runtime':
      return disconnectProviderRuntimeFromLauncher(request);
    case 'cancel_launcher_operation':
      return cancelLauncherOperationFromLauncher(request);
    case 'stop_environment_runtime':
      return stopEnvironmentRuntimeFromLauncher(request);
    case 'refresh_environment_runtime':
      return refreshEnvironmentRuntimeFromLauncher(request);
    case 'refresh_all_environment_runtimes':
      return refreshAllEnvironmentRuntimesFromLauncher();
    case 'start_control_plane_connect':
      return startControlPlaneConnectFromLauncher(request);
    case 'set_local_environment_pinned':
      await setLocalEnvironmentPinnedFromWelcome(request.environment_id, request.pinned);
      return launcherActionSuccess('saved_environment');
    case 'set_provider_environment_pinned':
      await setProviderEnvironmentPinnedFromWelcome(request.environment_id, request.pinned);
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
          auth_mode: request.auth_mode,
          remote_install_dir: request.remote_install_dir,
          bootstrap_strategy: request.bootstrap_strategy,
          release_base_url: request.release_base_url,
          connect_timeout_seconds: request.connect_timeout_seconds,
        },
        request.pinned,
      );
      return launcherActionSuccess('saved_environment');
    case 'set_saved_runtime_target_pinned':
      await setSavedRuntimeTargetPinnedFromWelcome(request);
      return launcherActionSuccess('saved_environment');
    case 'open_environment_settings':
      return openUtilityWindow('launcher', {
        surface: 'environment_settings',
        selectedEnvironmentID: request.environment_id,
        stealAppFocus: true,
      });
    case 'focus_environment_window':
      return focusEnvironmentWindow(request.session_key);
    case 'open_provider_environment':
      return openProviderEnvironmentFromLauncher(request);
    case 'refresh_control_plane':
      return refreshControlPlaneFromLauncher(request);
    case 'delete_control_plane':
      return deleteControlPlaneFromLauncher(request);
    case 'save_local_environment_settings':
      try {
        await saveLocalEnvironmentSettingsFromWelcome({
          local_ui_bind: request.local_ui_bind,
          local_ui_password: request.local_ui_password,
          local_ui_password_mode: request.local_ui_password_mode,
        });
        return launcherActionSuccess('saved_environment');
      } catch (error) {
        return launcherActionFailure(
          'action_invalid',
          'dialog',
          error instanceof Error ? error.message : String(error),
        );
      }
    case 'upsert_saved_environment':
      await upsertSavedEnvironmentFromWelcome(request.environment_id, request.label, request.external_local_ui_url);
      return launcherActionSuccess('saved_environment');
    case 'upsert_saved_ssh_environment':
      await upsertSavedSSHEnvironmentFromWelcome(request.environment_id, request.label, {
        ssh_destination: request.ssh_destination,
        ssh_port: request.ssh_port,
        auth_mode: request.auth_mode,
        remote_install_dir: request.remote_install_dir,
        bootstrap_strategy: request.bootstrap_strategy,
        release_base_url: request.release_base_url,
        connect_timeout_seconds: request.connect_timeout_seconds,
      });
      return launcherActionSuccess('saved_environment');
    case 'upsert_saved_runtime_target':
      try {
        await upsertSavedRuntimeTargetFromWelcome(request);
        return launcherActionSuccess('saved_environment');
      } catch (error) {
        return launcherActionFailure(
          'action_invalid',
          'dialog',
          error instanceof Error ? error.message : String(error),
        );
      }
    case 'delete_saved_environment':
      await deleteSavedEnvironmentFromWelcome(request.environment_id);
      return launcherActionSuccess('deleted_environment');
    case 'delete_saved_ssh_environment':
      await deleteSavedSSHEnvironmentFromWelcome(request.environment_id);
      return launcherActionSuccess('deleted_environment');
    case 'delete_saved_runtime_target':
      await deleteSavedRuntimeTargetFromWelcome(request.environment_id);
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
  for (const pendingStart of pendingSSHRuntimeStartByKey.values()) {
    launcherOperations.cancel(pendingStart.operation_key, 'Redeven Desktop is quitting and canceling this SSH startup task.');
  }
  const pendingSSHStartPromises = [...pendingSSHRuntimeStartByKey.values()].map((pendingStart) => (
    pendingStart.task.catch(() => undefined)
  ));
  const sessionClosePromises = [...sessionsByKey.keys()].map((sessionKey) => finalizeSessionClosure(sessionKey));
  const sshDisconnectPromises = [...sshEnvironmentRuntimeByKey.values()].map((runtimeRecord) => runtimeRecord.disconnect());
  sshEnvironmentRuntimeByKey.clear();
  sshRuntimeMaintenanceByKey.clear();
  for (const kind of UTILITY_WINDOW_KINDS) {
    const windowRecord = utilityWindows.get(kind) ?? null;
    const win = liveTrackedBrowserWindow(windowRecord);
    if (!windowRecord || !win) {
      if (windowRecord) {
        utilityWindowKindByWebContentsID.delete(windowRecord.webContentsID);
      }
      utilityWindows.delete(kind);
      continue;
    }
    utilityWindows.delete(kind);
    utilityWindowKindByWebContentsID.delete(windowRecord.webContentsID);
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
  await Promise.allSettled(sessionClosePromises);
  await Promise.allSettled([...sessionCloseTasks.values()]);
  await Promise.allSettled(sshDisconnectPromises);
  await Promise.race([
    Promise.allSettled(pendingSSHStartPromises),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

type DesktopDeepLinkRequest =
  | Readonly<{
      kind: 'connect_control_plane';
      provider_origin: string;
      provider_id?: string;
    }>
  | Readonly<{
      kind: 'open_provider_environment';
      provider_origin: string;
      provider_id?: string;
      env_public_id: string;
      label?: string;
    }>
  | Readonly<{
      kind: 'authorized_control_plane';
      provider_origin: string;
      state: string;
      authorization_code: string;
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
      if (providerOrigin === '') {
        return null;
      }
      return {
        kind: 'connect_control_plane',
        provider_origin: providerOrigin,
        provider_id: String(parsed.searchParams.get('provider_id') ?? '').trim() || undefined,
      };
    }

    if (parsed.hostname === 'control-plane' && parsed.pathname === '/open') {
      const providerOrigin = String(parsed.searchParams.get('provider_origin') ?? '').trim();
      const envPublicID = String(parsed.searchParams.get('env_public_id') ?? '').trim();
      const label = String(parsed.searchParams.get('label') ?? '').trim();
      if (providerOrigin === '' || envPublicID === '') {
        return null;
      }
      return {
        kind: 'open_provider_environment',
        provider_origin: providerOrigin,
        provider_id: String(parsed.searchParams.get('provider_id') ?? '').trim() || undefined,
        env_public_id: envPublicID,
        label: label || undefined,
      };
    }

    if (parsed.hostname === 'control-plane' && parsed.pathname === '/authorized') {
      const providerOrigin = String(parsed.searchParams.get('provider_origin') ?? '').trim();
      const state = String(parsed.searchParams.get('state') ?? '').trim();
      const authorizationCode = String(parsed.searchParams.get('authorization_code') ?? '').trim();
      if (providerOrigin === '' || state === '' || authorizationCode === '') {
        return null;
      }
      return {
        kind: 'authorized_control_plane',
        provider_origin: providerOrigin,
        state,
        authorization_code: authorizationCode,
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
  await startControlPlaneAuthorization({
    providerOrigin: request.provider_origin,
    expectedProviderID: request.provider_id,
  });
  resetLauncherIssueState();
  broadcastDesktopWelcomeSnapshots();
}

async function openProviderEnvironmentFromDeepLink(
  request: Extract<DesktopDeepLinkRequest, Readonly<{ kind: 'open_provider_environment' }>>,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const controlPlane = request.provider_id
    ? savedControlPlaneByIdentity(preferences, request.provider_origin, request.provider_id)
    : savedControlPlaneByOrigin(preferences, request.provider_origin);
  if (!controlPlane) {
    await startControlPlaneAuthorization({
      providerOrigin: request.provider_origin,
      expectedProviderID: request.provider_id,
      requestedEnvPublicID: request.env_public_id,
      label: request.label,
    });
    resetLauncherIssueState();
    broadcastDesktopWelcomeSnapshots();
    return;
  }

  try {
    const authorized = await ensureControlPlaneAccessToken(preferences, controlPlane);
    const openSession = await requestDesktopOpenSession(
      authorized.controlPlane.provider,
      authorized.accessToken,
      request.env_public_id,
    );
    const result = await openProviderEnvironmentWithOpenSession({
      providerOrigin: authorized.controlPlane.provider.provider_origin,
      providerID: authorized.controlPlane.provider.provider_id,
      envPublicID: request.env_public_id,
      bootstrapTicket: openSession.bootstrap_ticket,
      remoteSessionURL: openSession.remote_session_url,
      label: request.label,
    });
    if (!result.ok) {
      throw new Error(result.message);
    }
    resetLauncherIssueState();
  } catch (error) {
    if (!controlPlaneAuthorizationNeedsReconnect(error)) {
      throw error;
    }
    await startControlPlaneAuthorization({
      providerOrigin: controlPlane.provider.provider_origin,
      expectedProviderID: controlPlane.provider.provider_id,
      requestedEnvPublicID: request.env_public_id,
      label: request.label,
      displayLabel: controlPlane.display_label,
    });
    resetLauncherIssueState();
    broadcastDesktopWelcomeSnapshots();
  }
}

async function completeControlPlaneAuthorizationFromDeepLink(
  request: Extract<DesktopDeepLinkRequest, Readonly<{ kind: 'authorized_control_plane' }>>,
): Promise<void> {
  const pendingAuthorization = consumePendingControlPlaneAuthorization(request.state);
  if (!pendingAuthorization) {
    throw new Error('Desktop failed to match the provider authorization state.');
  }
  if (normalizeControlPlaneOrigin(request.provider_origin) !== pendingAuthorization.provider_origin) {
    throw new Error('Desktop failed to match the provider authorization target.');
  }

  const preferences = await loadDesktopPreferencesCached();
  const connected = await saveAuthorizedControlPlane(
    preferences,
    pendingAuthorization.provider_origin,
    pendingAuthorization.provider_id,
    request.authorization_code,
    pendingAuthorization.code_verifier,
    pendingAuthorization.display_label,
  );
  resetLauncherIssueState();

  if (!pendingAuthorization.requested_env_public_id) {
    await openDesktopWelcomeWindow({
      entryReason: openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch',
      stealAppFocus: true,
    });
    return;
  }

  const authorized = await ensureControlPlaneAccessToken(connected.preferences, connected.controlPlane);
  const openSession = await requestDesktopOpenSession(
    authorized.controlPlane.provider,
    authorized.accessToken,
    pendingAuthorization.requested_env_public_id,
  );
  const result = await openProviderEnvironmentWithOpenSession({
    providerOrigin: authorized.controlPlane.provider.provider_origin,
    providerID: authorized.controlPlane.provider.provider_id,
    envPublicID: pendingAuthorization.requested_env_public_id,
    bootstrapTicket: openSession.bootstrap_ticket,
    remoteSessionURL: openSession.remote_session_url,
    label: pendingAuthorization.label,
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
}

async function handleDesktopDeepLink(rawURL: string): Promise<void> {
  const request = parseDesktopDeepLink(rawURL);
  if (!request) {
    await openDesktopWelcomeWindow({
      entryReason: 'connect_failed',
      issue: buildControlPlaneIssue('control_plane_invalid', 'Desktop received an invalid provider link.'),
      stealAppFocus: true,
    });
    return;
  }

  try {
    if (request.kind === 'connect_control_plane') {
      await connectControlPlaneFromDeepLink(request);
      return;
    }

    if (request.kind === 'authorized_control_plane') {
      await completeControlPlaneAuthorizationFromDeepLink(request);
      return;
    }

    await openProviderEnvironmentFromDeepLink(request);
  } catch (error) {
    await openDesktopWelcomeWindow({
      entryReason: 'connect_failed',
      issue: controlPlaneIssueForError(
        error,
        'Desktop failed to process the provider link.',
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
  requestImmediateQuit();
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
    event.returnValue = desktopSessionContextSnapshot(sessionRecord);
  });
  ipcMain.on(DESKTOP_SESSION_APP_READY_CHANNEL, (event, payload) => {
    const readyPayload = normalizeDesktopSessionAppReadyPayload(payload);
    if (!readyPayload) {
      return;
    }
    const sessionRecord = sessionRecordForWebContentsID(event.sender.id);
    if (!sessionRecord) {
      return;
    }
    markSessionAppReady(sessionRecord, readyPayload);
  });
  ipcMain.on(DESKTOP_THEME_GET_SNAPSHOT_CHANNEL, (event) => {
    event.returnValue = desktopThemeState().getSnapshot();
  });
  ipcMain.on(DESKTOP_THEME_SET_SOURCE_CHANNEL, (event, source) => {
    event.returnValue = desktopThemeState().setSource(source);
  });
  ipcMain.on(DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    event.returnValue = desktopWindowChromeSnapshotForWindow(win, process.platform);
  });

  ipcMain.handle(SAVE_DESKTOP_SETTINGS_CHANNEL, async (_event, draft: DesktopSettingsDraft): Promise<SaveDesktopSettingsResult> => {
    try {
      const previous = await loadDesktopPreferencesCached();
      const selectedEnvironmentID = currentUtilityWindowState('launcher').selectedEnvironmentID || preferredEnvironmentID(previous);
      const selectedLocalEnvironment = findLocalEnvironmentByID(previous, selectedEnvironmentID);
      const selectedProviderEnvironment = selectedLocalEnvironment
        ? null
        : findProviderEnvironmentByID(previous, selectedEnvironmentID);
      if (!selectedLocalEnvironment && !selectedProviderEnvironment) {
        throw new Error('Desktop could not resolve the selected environment.');
      }
      const settingsEnvironment = previous.local_environment;
      const access = localEnvironmentAccess(settingsEnvironment);
      const validated = validateDesktopSettingsDraft(draft, {
        currentLocalUIPassword: access.local_ui_password,
        currentLocalUIPasswordConfigured: access.local_ui_password_configured,
      });
      const next = updateLocalEnvironmentAccess(previous, settingsEnvironment.id, validated);
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
    stampDesktopWelcomeSnapshot(await buildCurrentDesktopWelcomeSnapshot(senderUtilityWindowKind(event.sender.id)))
  ));
  ipcMain.handle(DESKTOP_LAUNCHER_GET_SSH_CONFIG_HOSTS_CHANNEL, async () => (
    loadDesktopSSHConfigHosts()
  ));
  ipcMain.handle(DESKTOP_LAUNCHER_LIST_RUNTIME_CONTAINERS_CHANNEL, async (_event, request): Promise<DesktopRuntimeContainerListResponse> => (
    listRuntimeContainersFromLauncher(request)
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
  ipcMain.handle(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, async (event, request): Promise<DesktopShellWindowCommandResponse> => {
    const normalized = normalizeDesktopShellWindowCommandRequest(request);
    if (!normalized) {
      return {
        ok: false,
        performed: false,
        state: null,
        message: 'Invalid desktop window command.',
      };
    }

    return performDesktopShellWindowCommand(BrowserWindow.fromWebContents(event.sender), normalized.command);
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
  ipcMain.handle(DESKTOP_SHELL_OPEN_DASHBOARD_CHANNEL, async (): Promise<DesktopShellOpenExternalURLResponse> => {
    try {
      await openExternalURL(DESKTOP_DASHBOARD_URL);
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
  ipcMain.handle(DESKTOP_SHELL_RUNTIME_MAINTENANCE_CONTEXT_CHANNEL, async (event): Promise<DesktopShellRuntimeMaintenanceContext> => {
    const sessionRecord = sessionRecordForWebContentsID(event.sender.id);
    return runtimeMaintenanceContextFromSession(sessionRecord);
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
    if (normalized.action === 'restart_runtime') {
      return performRuntimeMaintenanceFromShell(event.sender.id, 'restart');
    }
    if (normalized.action === 'upgrade_runtime') {
      return performRuntimeMaintenanceFromShell(event.sender.id, 'upgrade');
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
      requestImmediateQuit();
    }
  });

  app.on('activate', () => {
    void syncVisibleControlPlanesIfNeeded().catch(() => {
      // Best-effort refresh when the app becomes active again.
    });
    void restoreBestAvailableWindow().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to restore a window', message || 'Unknown restore error.');
      requestImmediateQuit();
    });
  });

  powerMonitor.on('resume', () => {
    void syncVisibleControlPlanesIfNeeded({ force: true }).catch(() => {
      // Best-effort refresh after sleep/wake.
    });
  });

  app.on('before-quit', (event) => {
    if (quitPhase === 'confirming') {
      event.preventDefault();
      return;
    }
    if (quitPhase === 'shutting_down') {
      return;
    }
    if (quitPhase === 'idle') {
      event.preventDefault();
      void requestQuit('system');
      return;
    }
    quitPhase = 'shutting_down';
    event.preventDefault();
    void shutdownDesktopWindowsAndSessions().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    updateControlPlaneSyncPoller();
    updateWelcomeRuntimePoller();
    if (process.platform !== 'darwin' && quitPhase === 'idle') {
      requestImmediateQuit();
    }
  });
}
