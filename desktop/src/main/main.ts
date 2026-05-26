import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, powerMonitor, safeStorage, session, shell, type MessageBoxOptions } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { attachManagedRuntimeFromStatus, loadManagedRuntimeStartupFromStatus, startManagedRuntime, type ManagedRuntimeProgress } from './runtimeProcess';
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
  updateLocalEnvironmentSettings,
  upsertSavedControlPlane,
  upsertSavedEnvironment,
  upsertSavedRuntimeTarget,
  upsertSavedSSHEnvironment,
  validateDesktopSettingsDraft,
  type DesktopPreferences,
  type DesktopSavedEnvironment,
  type DesktopSavedControlPlane,
  type DesktopSavedRuntimeTarget,
  type DesktopSavedSSHEnvironment,
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
import {
  DesktopWelcomeRuntimeHealthStore,
  type DesktopWelcomeRuntimeHealthProbeEvent,
  type DesktopWelcomeRuntimeHealthProbeResult,
  type DesktopWelcomeRuntimeHealthTarget,
} from './desktopWelcomeRuntimeHealth';
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
import { DesktopDiagnosticsRecorder } from './diagnostics';
import { DesktopDownloadWriter } from './desktopDownloadWriter';
import { DesktopWelcomeSnapshotOrder } from './desktopWelcomeSnapshotOrder';
import {
  DesktopOperationFailureError,
  desktopOperationFailurePresentation,
  operationFailureFromUnknown,
} from './desktopOperationFailure';
import {
  RuntimeLifecycleStepFailureError,
  RuntimeLifecycleWorkflow,
  runtimeLifecyclePlanPatchPreservingObservedHistory,
  runtimeLifecycleStepIDFromError,
} from './runtimeLifecycleWorkflow';
import {
  initialRuntimeLifecyclePlan,
  runtimeLifecyclePlanAfterDecision,
  runtimeLifecyclePlanIncludingStep,
  type RuntimeLifecycleDecision,
} from './runtimeLifecycleExecutionPlan';
import { LauncherOperationRegistry, launcherOperationProgress, type LauncherOperationAttemptIdentity } from './launcherOperations';
import { buildLocalUIEnvAppEntryURL } from './localUIURL';
import { isAllowedAppNavigation } from './navigation';
import { resolveBundledRuntimePath, resolveSessionPreloadPath, resolveUtilityPreloadPath, resolveWelcomeRendererPath } from './paths';
import { loadExternalLocalUIStartup } from './runtimeState';
import {
  RuntimeControlError,
  getCodeWorkspaceEngineStatus,
  connectProviderLink,
  disconnectProviderLink,
} from './runtimeControlClient';
import { desktopSessionRuntimeHandleFromManagedRuntime, type DesktopSessionRuntimeHandle } from './sessionRuntime';
import {
  DesktopSSHRuntimeCanceledError,
  DesktopSSHRuntimeMaintenanceRequiredError,
  ensureManagedSSHRuntimeReady,
  openManagedSSHRuntimeConnection,
  probeManagedSSHRuntimeStatus,
  parseManagedSSHRuntimeProbeResult,
  stopManagedSSHRuntimeProcess,
  type DesktopSSHRuntimeProgress,
} from './sshRuntime';
import {
  containerListCommand,
  containerInspectCommand,
  containerRuntimeDaemonStatusCommand,
  containerRuntimeDaemonStopCommand,
  containerRuntimeProbeCommand,
  parseContainerListOutput,
  parseContainerInspectJSON,
  resolveRuntimeContainerPlacement,
  type DesktopRuntimeContainerResolution,
  type DesktopRuntimeContainerResolver,
} from './containerRuntime';
import { parseLaunchReport, type LaunchReport } from './launchReport';
import {
  createLocalRuntimeHostExecutor,
  createSSHRuntimeHostExecutor,
} from './runtimeHostAccess';
import {
  startRuntimePlacementBridgeSession,
  type RuntimePlacementBridgeSession,
} from './runtimePlacementBridgeSession';
import {
  ensureRuntimePlacementReady,
  RuntimePlacementMaintenanceRequiredError,
  type RuntimePlacementProgress,
} from './runtimePlacementManager';
import { startDesktopModelSource, type ManagedDesktopModelSource } from './desktopModelSource';
import {
  legacyRuntimePackageCacheRoots,
  pruneDesktopRuntimePackageCache,
  runtimePackageCacheRoot,
} from './runtimePackageCache';
import {
  codeWorkspaceEnginePackageCacheRoot,
  prepareCodeWorkspaceEnginePackage,
  type CodeWorkspaceEnginePackageCacheEntry,
} from './codeWorkspaceEnginePackageCache';
import {
  DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_ARCHIVE_LIMIT,
  DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_CHUNK_SIZE,
  uploadCodeWorkspaceEngineViaRuntimeControl,
} from './codeWorkspaceEngineTransfer';
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
  DESKTOP_DOWNLOAD_ABORT_CHANNEL,
  DESKTOP_DOWNLOAD_COMPLETE_CHANNEL,
  DESKTOP_DOWNLOAD_OPEN_CHANNEL,
  DESKTOP_DOWNLOAD_PREPARE_CHANNEL,
  DESKTOP_DOWNLOAD_REVEAL_CHANNEL,
  DESKTOP_DOWNLOAD_WRITE_CHANNEL,
  normalizeDesktopDownloadAbortRequest,
  normalizeDesktopDownloadActionRequest,
  normalizeDesktopDownloadCompleteRequest,
  normalizeDesktopDownloadPrepareRequest,
  normalizeDesktopDownloadWriteRequest,
} from '../shared/desktopDownloadIPC';
import {
  DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PACKAGE_DISPOSE_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PACKAGE_PREPARE_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PREPARE_CHANNEL,
  normalizeDesktopCodeWorkspacePackageChunkRequest,
  normalizeDesktopCodeWorkspacePackageDisposeRequest,
  normalizeDesktopCodeWorkspacePackagePrepareRequest,
  normalizeDesktopCodeWorkspacePrepareRequest,
  type DesktopCodeWorkspacePackageChunkResponse,
  type DesktopCodeWorkspacePackageDisposeResponse,
  type DesktopCodeWorkspacePackagePrepareResponse,
  type DesktopCodeWorkspacePrepareResponse,
} from '../shared/desktopCodeWorkspaceIPC';
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
  type DesktopLauncherActionKind,
  type DesktopLauncherActionRequest,
  type DesktopLauncherActionResult,
  type DesktopLauncherActionSuccess,
  type DesktopLauncherOperationNextAction,
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
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  desktopSSHAuthority,
  desktopSSHEnvironmentID,
  desktopSSHRuntimeAffectingSettingsMatch,
  defaultSavedSSHEnvironmentLabel,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  buildDesktopRuntimeMaintenanceRequirement,
  classifyDesktopRuntimeBlockedLaunchReport,
  desktopRuntimeMaintenanceForRuntimeService,
  desktopRuntimeMaintenanceIsStaleLock,
  desktopRuntimeMaintenanceRequiresRestart,
  desktopRuntimeMaintenanceRequiresUpdate,
  type DesktopRuntimeHealth,
  type DesktopRuntimeMaintenanceRequirement,
} from '../shared/desktopRuntimeHealth';
import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import {
  desktopRuntimeControlStatusAvailable,
  desktopRuntimeControlStatusMissing,
  desktopRuntimeControlStatusOwnerMismatch,
  type DesktopManagedRuntimePresence,
  type DesktopRuntimeControlStatus,
} from '../shared/desktopRuntimePresence';
import { buildDesktopRuntimeOperationPlans } from '../shared/desktopRuntimeOperationPlanner';
import { desktopRuntimePackageStateFromRuntimeService } from '../shared/desktopRuntimePackageState';
import {
  desktopRuntimeTargetID,
  desktopRuntimeTargetAutoStatusDetectionEnabled,
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
  type DesktopRuntimeTargetID,
} from '../shared/desktopRuntimePlacement';
import {
  desktopOpenConnectionLocation,
  openConnectionProgress,
  type DesktopOpenConnectionLocation,
  type DesktopOpenConnectionPhase,
  type DesktopOpenConnectionProgress,
} from '../shared/desktopOpenConnectionProgress';
import {
  desktopRuntimeLifecycleLocation,
  runtimeLifecycleProgress,
  type DesktopRuntimeLifecycleLocation,
  type DesktopRuntimeLifecycleOperation,
  type DesktopRuntimeLifecyclePhase,
  type DesktopRuntimeLifecycleProgress,
} from '../shared/desktopRuntimeLifecycleProgress';
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
  runtimeServiceAllowsOpenAttempt,
  runtimeServiceNeedsDesktopUpdate,
  runtimeServiceNeedsRuntimeUpdate,
  runtimeServiceHasActiveWork,
  formatRuntimeServiceWorkload,
  type RuntimeServiceProviderLinkBinding,
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
  state_root: string;
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
  desktop_model_source?: ManagedDesktopModelSource | null;
  runtime_handle: DesktopSessionRuntimeHandle;
  disconnect: () => Promise<void>;
  stop: () => Promise<void>;
}>;

type SSHRuntimeReadyRecord = Readonly<{
  runtime_key: `ssh:${string}`;
  environment_id: string;
  label: string;
  details: DesktopSSHEnvironmentDetails;
  startup: StartupReport;
  runtime_handle: DesktopSessionRuntimeHandle;
  disconnect: () => Promise<void>;
  stop: () => Promise<void>;
}>;

type RuntimePlacementBridgeRecord = Readonly<{
  runtime_key: string;
  environment_id: string;
  label: string;
  target_id: DesktopProviderRuntimeLinkTargetID;
  runtime_binary_path: string;
  session: RuntimePlacementBridgeSession;
  startup: StartupReport;
  desktop_model_source?: ManagedDesktopModelSource | null;
  runtime_handle: DesktopSessionRuntimeHandle;
}>;

type RuntimePlacementReadyRecord = Readonly<{
  runtime_key: string;
  environment_id: string;
  label: string;
  target_id: DesktopProviderRuntimeLinkTargetID;
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  runtime_binary_path: string;
  startup?: StartupReport;
}>;

type SavedRuntimeTargetState = Readonly<{
  running: boolean;
  startup?: StartupReport;
  local_ui_url: string;
  open_connection_required?: boolean;
  runtime_service?: RuntimeServiceSnapshot;
  runtime_control_status: DesktopRuntimeControlStatus;
  maintenance?: DesktopRuntimeMaintenanceRequirement;
  placement?: DesktopRuntimePlacement;
  binary_path?: string;
}>;

type RuntimePlacementInspectionState = Readonly<SavedRuntimeTargetState & {
  ready_record?: RuntimePlacementReadyRecord;
  runtime_target_available?: boolean;
}>;

type PendingSSHRuntimeStart = Readonly<{
  runtime_key: `ssh:${string}`;
  environment_id: string;
  label: string;
  operation_key: string;
  task: Promise<SSHRuntimeReadyRecord>;
}>;

type PendingRuntimePlacementStart = Readonly<{
  target_id: DesktopRuntimeTargetID;
  environment_id: string;
  label: string;
  operation_key: string;
  task: Promise<RuntimePlacementReadyRecord>;
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
const desktopDownloadWriter = new DesktopDownloadWriter();
let lastFocusedSessionKey: DesktopSessionKey | null = null;
let quitPhase: 'idle' | 'confirming' | 'requested' | 'shutting_down' = 'idle';
let desktopPreferencesCache: DesktopPreferences | null = null;
let desktopStateStoreCache: DesktopStateStore | null = null;
let desktopThemeStateCache: DesktopThemeState | null = null;
let desktopRuntimeOwnerIDTask: Promise<string> | null = null;
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
const sshRuntimeReadyByKey = new Map<`ssh:${string}`, SSHRuntimeReadyRecord>();
const pendingSSHRuntimeStartByKey = new Map<`ssh:${string}`, PendingSSHRuntimeStart>();
const sshRuntimeMaintenanceByKey = new Map<`ssh:${string}`, DesktopRuntimeMaintenanceRequirement>();
const runtimePlacementMaintenanceByTargetID = new Map<DesktopRuntimeTargetID, DesktopRuntimeMaintenanceRequirement>();
const runtimePlacementBridgeByTargetID = new Map<DesktopRuntimeTargetID, RuntimePlacementBridgeRecord>();
const runtimePlacementReadyByTargetID = new Map<DesktopRuntimeTargetID, RuntimePlacementReadyRecord>();
const pendingRuntimePlacementStartByTargetID = new Map<DesktopRuntimeTargetID, PendingRuntimePlacementStart>();
const launcherOperationRemovalTimers = new Map<string, ReturnType<typeof setTimeout>>();
const launcherOperations = new LauncherOperationRegistry(handleLauncherOperationChange);
const desktopWelcomeSnapshotOrder = new DesktopWelcomeSnapshotOrder();
const welcomeRuntimeHealthStore = new DesktopWelcomeRuntimeHealthStore(
  () => broadcastDesktopWelcomeSnapshots(),
  recordWelcomeRuntimeProbeEvent,
);
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

async function desktopRuntimeOwnerID(): Promise<string> {
  if (!desktopRuntimeOwnerIDTask) {
    desktopRuntimeOwnerIDTask = loadOrCreateDesktopRuntimeOwnerID(app.getPath('userData'));
  }
  return desktopRuntimeOwnerIDTask;
}

async function startDesktopModelSourceForStartup(args: Readonly<{
  label: string;
  startup: StartupReport;
  signal?: AbortSignal;
}>): Promise<ManagedDesktopModelSource | null> {
  const runtimeControl = args.startup.runtime_control;
  if (!runtimeControl) {
    return null;
  }
  try {
    const modelSource = await startDesktopModelSource({
      executablePath: bundledRuntimeExecutablePath(),
      stateRoot: preferencesPaths().stateRoot,
      runtimeControl,
      tempRoot: app.getPath('temp'),
      signal: args.signal,
      onLog: (stream, chunk) => {
        const text = compact(chunk);
        if (text) console.log(`[redeven:model-source:${stream}] ${text}`);
      },
    });
    if (modelSource.modelCount <= 0) {
      const missing = modelSource.missingKeyProviderIDs.length > 0
        ? ` Missing provider keys: ${modelSource.missingKeyProviderIDs.join(', ')}.`
        : '';
      console.warn(`[redeven:model-source] Connected to ${args.label}, but no usable Desktop models are available.${missing}`);
    }
    return modelSource;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[redeven:model-source] Desktop model source unavailable for ${args.label}: ${message}`);
    return null;
  }
}

async function refreshStartupReportFromLocalUI(
  startup: StartupReport,
  localUIURL: string,
): Promise<StartupReport> {
  const refreshed = await loadExternalLocalUIStartup(localUIURL, DESKTOP_RUNTIME_PROBE_TIMEOUT_MS).catch(() => null);
  if (!refreshed) {
    return startup;
  }
  return {
    ...startup,
    local_ui_url: refreshed.local_ui_url,
    local_ui_urls: refreshed.local_ui_urls,
    password_required: refreshed.password_required,
    desktop_managed: refreshed.desktop_managed ?? startup.desktop_managed,
    desktop_owner_id: refreshed.desktop_owner_id ?? startup.desktop_owner_id,
    runtime_service: refreshed.runtime_service ?? startup.runtime_service,
    runtime_control: startup.runtime_control,
  };
}

function localEnvironmentStateRoot(environment: DesktopLocalEnvironmentState): string {
  const stateDir = compact(environment.local_hosting.state_dir);
  return stateDir === '' ? '' : path.dirname(stateDir);
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

function runtimeMatchesProvider(
  startup: StartupReport | null | undefined,
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): boolean {
  return desktopRuntimeProviderBindingMatches(
    runtimeServiceProviderLinkBinding(startup?.runtime_service),
    {
      provider_origin: providerOrigin,
      provider_id: providerID,
      env_public_id: envPublicID,
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
  runtimeBinaryPath: string;
}>): RuntimePlacementBridgeRecord {
  const runtimeKey = input.session.placement_target_id;
  return {
    runtime_key: runtimeKey,
    environment_id: compact(input.environmentID) || runtimeKey,
    label: compact(input.label) || 'Container Runtime',
    target_id: providerRuntimeLinkTargetIDForRuntimeTarget(input.session.host_access, runtimeKey),
    runtime_binary_path: compact(input.runtimeBinaryPath) || 'redeven',
    session: input.session,
    startup: input.session.startup,
    runtime_handle: input.session.runtime_handle,
  };
}

async function openRuntimePlacementBridgeForReadyRecord(
  readyRecord: RuntimePlacementReadyRecord,
  signal?: AbortSignal,
): Promise<RuntimePlacementBridgeRecord> {
  await clearRuntimePlacementBridgeRecord(readyRecord.runtime_key as DesktopRuntimeTargetID);
  const session = await startRuntimePlacementBridgeSession({
    host_access: readyRecord.host_access,
    placement: readyRecord.placement,
    runtime_binary_path: readyRecord.runtime_binary_path,
    desktop_owner_id: await desktopRuntimeOwnerID(),
    fallback_local_id: readyRecord.environment_id,
    signal,
  });
  const nextRecord = bridgeRecordFromSession({
    environmentID: readyRecord.environment_id,
    label: readyRecord.label,
    session,
    runtimeBinaryPath: readyRecord.runtime_binary_path,
  });
  const desktopModelSource = await startDesktopModelSourceForStartup({
    label: nextRecord.label,
    startup: nextRecord.startup,
    signal,
  });
  const startup = desktopModelSource
    ? await refreshStartupReportFromLocalUI(nextRecord.startup, nextRecord.startup.local_ui_url)
    : nextRecord.startup;
  const record = {
    ...nextRecord,
    startup,
    desktop_model_source: desktopModelSource,
  };
  runtimePlacementBridgeByTargetID.set(session.placement_target_id, record);
  return record;
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
      const runtimeTargetKey = runtimeKey as DesktopRuntimeTargetID;
      await refreshWelcomeRuntimeHealthForEnvironment(runtimeKey);
      const bridgeRecord = runtimePlacementBridgeByTargetID.get(runtimeTargetKey) ?? null;
      const readyRecord = runtimePlacementReadyByTargetID.get(runtimeTargetKey) ?? null;
      const resolvedBridgeRecord = bridgeRecord ?? (readyRecord?.host_access.kind === 'local_host'
        ? await openRuntimePlacementBridgeForReadyRecord(readyRecord)
        : null);
      if (!resolvedBridgeRecord || resolvedBridgeRecord.target_id !== runtimeTargetID || resolvedBridgeRecord.session.host_access.kind !== 'local_host') {
        return null;
      }
      return {
        kind,
        id: runtimeTargetID,
        label: resolvedBridgeRecord.label,
        record: resolvedBridgeRecord,
      };
    }
    const record = await verifyCurrentLocalEnvironmentRuntimeRecord(preferences.local_environment)
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
  await refreshWelcomeRuntimeHealthForEnvironment(runtimeKey);
  const bridgeRecord = runtimePlacementBridgeByTargetID.get(runtimeKey as DesktopRuntimeTargetID) ?? null;
  const readyRecord = runtimePlacementReadyByTargetID.get(runtimeKey as DesktopRuntimeTargetID) ?? null;
  const resolvedBridgeRecord = bridgeRecord ?? (readyRecord?.host_access.kind === 'ssh_host'
    ? await openRuntimePlacementBridgeForReadyRecord(readyRecord)
    : null);
  if (resolvedBridgeRecord && resolvedBridgeRecord.target_id === runtimeTargetID && resolvedBridgeRecord.session.host_access.kind === 'ssh_host') {
    return {
      kind,
      id: runtimeTargetID,
      label: resolvedBridgeRecord.label,
      record: resolvedBridgeRecord,
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

function providerEnvironmentOccupiedFailure(
  environment: DesktopProviderEnvironmentRecord,
  runtimeLabel: string,
): DesktopLauncherActionFailure {
  return launcherActionFailure(
    'environment_in_use',
    'environment',
    `${environment.label || environment.env_public_id} already has an online runtime${runtimeLabel ? ` through ${runtimeLabel}` : ' through the provider'}. Disconnect it before connecting another runtime.`,
    {
      ...providerEnvironmentFailureContext(environment),
      shouldRefreshSnapshot: true,
    },
  );
}

function runtimeTargetRecordMatchesProvider(
  runtimeTarget: ProviderRuntimeLinkTargetRecord,
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): boolean {
  return runtimeMatchesProvider(runtimeTarget.record.startup, providerOrigin, providerID, envPublicID);
}

async function providerEnvironmentOccupyingRuntime(
  preferences: DesktopPreferences,
  environment: DesktopProviderEnvironmentRecord,
  selectedRuntimeTargetID: DesktopProviderRuntimeLinkTargetID,
): Promise<ProviderRuntimeLinkTargetRecord | null> {
  const providerOrigin = compact(environment.provider_origin);
  const providerID = compact(environment.provider_id);
  const envPublicID = compact(environment.env_public_id);
  if (providerOrigin === '' || providerID === '' || envPublicID === '') {
    return null;
  }
  const records: ProviderRuntimeLinkTargetRecord[] = [];
  const localRuntimeRecord = await verifyCurrentLocalEnvironmentRuntimeRecord(preferences.local_environment);
  if (localRuntimeRecord) {
    records.push({
      kind: 'local_environment',
      id: desktopProviderRuntimeLinkTargetID('local_environment', localRuntimeRecord.environment_id),
      label: localRuntimeRecord.label,
      record: localRuntimeRecord,
    });
  }
  for (const runtimeKey of [...sshEnvironmentRuntimeByKey.keys()]) {
    const record = await verifySSHEnvironmentRuntimeRecord(runtimeKey);
    if (!record) {
      continue;
    }
    records.push({
      kind: 'ssh_environment',
      id: desktopProviderRuntimeLinkTargetID('ssh_environment', record.runtime_key),
      label: record.label,
      record,
    });
  }
  for (const targetID of [...runtimePlacementBridgeByTargetID.keys()]) {
    const record = await verifyRuntimePlacementBridgeRecord(targetID);
    if (!record) {
      continue;
    }
    records.push({
      kind: record.session.host_access.kind === 'ssh_host' ? 'ssh_environment' : 'local_environment',
      id: record.target_id,
      label: record.label,
      record,
    });
  }
  return records.find((record) => (
    record.id !== selectedRuntimeTargetID
    && runtimeTargetRecordMatchesProvider(record, providerOrigin, providerID, envPublicID)
  )) ?? null;
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

function providerBindingFailureContext(
  binding: RuntimeServiceProviderLinkBinding | null | undefined,
  environmentID = '',
): Readonly<{
  environmentID?: string;
  providerOrigin?: string;
  providerID?: string;
  envPublicID?: string;
  shouldRefreshSnapshot: true;
}> {
  return {
    environmentID: compact(environmentID) || undefined,
    providerOrigin: compact(binding?.provider_origin) || undefined,
    providerID: compact(binding?.provider_id) || undefined,
    envPublicID: compact(binding?.env_public_id) || undefined,
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
    state_root: localEnvironmentStateRoot(environment),
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

async function verifyCurrentLocalEnvironmentRuntimeRecord(
  environment: DesktopLocalEnvironmentState,
): Promise<LocalEnvironmentRuntimeRecord | null> {
  const currentRecord = currentLocalEnvironmentRuntimeRecord(environment);
  if (!currentRecord) {
    return null;
  }
  try {
    const startup = await loadExternalLocalUIStartup(currentRecord.startup.local_ui_url, DESKTOP_RUNTIME_PROBE_TIMEOUT_MS);
    if (startup) {
      return updateLocalEnvironmentRuntimeRecordStartup(currentRecord, {
        controlplane_base_url: startup.controlplane_base_url ?? currentRecord.startup.controlplane_base_url,
        controlplane_provider_id: startup.controlplane_provider_id ?? currentRecord.startup.controlplane_provider_id,
        env_public_id: startup.env_public_id ?? currentRecord.startup.env_public_id,
        local_ui_url: startup.local_ui_url,
        local_ui_urls: startup.local_ui_urls,
        password_required: startup.password_required,
        desktop_managed: startup.desktop_managed ?? currentRecord.startup.desktop_managed,
        desktop_owner_id: startup.desktop_owner_id ?? currentRecord.startup.desktop_owner_id,
        effective_run_mode: startup.effective_run_mode ?? currentRecord.startup.effective_run_mode,
        remote_enabled: startup.remote_enabled ?? currentRecord.startup.remote_enabled,
        runtime_service: startup.runtime_service ?? currentRecord.startup.runtime_service,
      });
    }
  } catch {
    // The in-memory record is only current while its Local UI remains reachable.
  }
  clearLocalEnvironmentRuntimeRecord(environment);
  return null;
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

function runtimeHostExecutor(hostAccess: DesktopRuntimeHostAccess, sshPassword?: string) {
  return hostAccess.kind === 'ssh_host'
    ? createSSHRuntimeHostExecutor(hostAccess.ssh, { sshPassword })
    : createLocalRuntimeHostExecutor();
}

function runtimeContainerResolver(
  hostAccess: DesktopRuntimeHostAccess,
  signal?: AbortSignal,
  sshPassword?: string,
): DesktopRuntimeContainerResolver {
  const executor = runtimeHostExecutor(hostAccess, sshPassword);
  const commandOptions = () => ({
    signal: signal ?? AbortSignal.timeout(DESKTOP_RUNTIME_PROBE_TIMEOUT_MS),
  });
  return {
    inspect: async (engine, containerRef) => parseContainerInspectJSON(
      engine,
      (await executor.run(containerInspectCommand(engine, containerRef), commandOptions())).stdout,
    ),
    listRunning: async (engine) => parseContainerListOutput(
      engine,
      (await executor.run(containerListCommand(engine), commandOptions())).stdout,
    ),
  };
}

function runtimeControlReasonCodeForContainerResolution(
  status: Exclude<DesktopRuntimeContainerResolution['status'], 'running'>,
): Extract<DesktopRuntimeControlStatus, Readonly<{ state: 'missing' }>>['reason_code'] {
  switch (status) {
    case 'command_not_found':
    case 'engine_unavailable':
    case 'no_permission':
      return 'container_engine_unavailable';
    default:
      return 'container_not_running';
  }
}

function managedRuntimePresence(args: Readonly<{
  targetID: DesktopProviderRuntimeLinkTargetID;
  placementTargetID: DesktopRuntimeTargetID;
  kind: DesktopManagedRuntimePresence['kind'];
  environmentID: string;
  label: string;
  runtimeKey: string;
  hostAccess: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  running: boolean;
  localUIURL: string;
  openConnectionRequired?: boolean;
  runtimeService?: RuntimeServiceSnapshot;
  runtimeControlStatus: DesktopRuntimeControlStatus;
  maintenance?: DesktopRuntimeMaintenanceRequirement;
}>): DesktopManagedRuntimePresence {
  const runtimeService = args.runtimeService ? normalizeRuntimeServiceSnapshot(args.runtimeService) : undefined;
  const maintenance = desktopRuntimeMaintenanceForRuntimeService(args.maintenance, runtimeService);
  const runtimePackageState = desktopRuntimePackageStateFromRuntimeService(runtimeService, maintenance);
  const openable = runtimeServiceIsOpenable(runtimeService);
  const openConnectionRequired = args.openConnectionRequired === true;
  return {
    target_id: args.targetID,
    placement_target_id: args.placementTargetID,
    kind: args.kind,
    environment_id: args.environmentID,
    label: args.label,
    runtime_key: args.runtimeKey,
    host_access: args.hostAccess,
    placement: args.placement,
    running: args.running,
    local_ui_url: args.localUIURL,
    openable,
    ...(openConnectionRequired ? { open_connection_required: true } : {}),
    ...(runtimePackageState ? { runtime_package_state: runtimePackageState } : {}),
    ...(runtimeService ? { runtime_service: runtimeService } : {}),
    runtime_control_status: args.runtimeControlStatus,
    operations: buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: args.hostAccess,
      placement: args.placement,
      running: args.running,
      openable,
      open_connection_required: openConnectionRequired,
      package_state: runtimePackageState,
      runtime_service: runtimeService,
      runtime_control_status: args.runtimeControlStatus,
      maintenance,
    }),
    ...(maintenance ? { maintenance } : {}),
    checked_at_unix_ms: Date.now(),
  };
}

function runtimePlacementMaintenanceForRuntimeService(
  targetID: DesktopRuntimeTargetID,
  runtimeService: RuntimeServiceSnapshot | null | undefined,
): DesktopRuntimeMaintenanceRequirement | undefined {
  const maintenance = desktopRuntimeMaintenanceForRuntimeService(
    runtimePlacementMaintenanceByTargetID.get(targetID),
    runtimeService,
  );
  if (!maintenance) {
    runtimePlacementMaintenanceByTargetID.delete(targetID);
  }
  return maintenance;
}

function sshRuntimeMaintenanceForRuntimeService(
  runtimeKey: `ssh:${string}`,
  runtimeService: RuntimeServiceSnapshot | null | undefined,
): DesktopRuntimeMaintenanceRequirement | undefined {
  const maintenance = desktopRuntimeMaintenanceForRuntimeService(
    sshRuntimeMaintenanceByKey.get(runtimeKey),
    runtimeService,
  );
  if (!maintenance) {
    sshRuntimeMaintenanceByKey.delete(runtimeKey);
  }
  return maintenance;
}

async function clearRuntimePlacementBridgeRecord(targetID: DesktopRuntimeTargetID): Promise<void> {
  const bridgeRecord = runtimePlacementBridgeByTargetID.get(targetID) ?? null;
  runtimePlacementBridgeByTargetID.delete(targetID);
  await bridgeRecord?.desktop_model_source?.stop().catch(() => undefined);
  await bridgeRecord?.session.disconnect().catch(() => undefined);
}

async function clearRuntimePlacementTargetRecords(targetID: DesktopRuntimeTargetID): Promise<void> {
  await clearRuntimePlacementBridgeRecord(targetID);
  runtimePlacementReadyByTargetID.delete(targetID);
  runtimePlacementMaintenanceByTargetID.delete(targetID);
}

async function verifyRuntimePlacementBridgeRecord(
  targetID: DesktopRuntimeTargetID,
): Promise<RuntimePlacementBridgeRecord | null> {
  const bridgeRecord = runtimePlacementBridgeByTargetID.get(targetID) ?? null;
  if (!bridgeRecord) {
    return null;
  }
  try {
    const startup = await loadExternalLocalUIStartup(bridgeRecord.startup.local_ui_url, DESKTOP_RUNTIME_PROBE_TIMEOUT_MS);
    if (startup) {
      const updatedRecord: RuntimePlacementBridgeRecord = {
        ...bridgeRecord,
        startup: {
          ...bridgeRecord.startup,
          local_ui_url: startup.local_ui_url,
          local_ui_urls: startup.local_ui_urls,
          runtime_control: bridgeRecord.startup.runtime_control,
          password_required: startup.password_required,
          runtime_service: startup.runtime_service ?? bridgeRecord.startup.runtime_service,
        },
      };
      runtimePlacementBridgeByTargetID.set(targetID, updatedRecord);
      return updatedRecord;
    }
  } catch {
    // The bridge cache is only reusable while its loopback Local UI is alive.
  }
  await clearRuntimePlacementBridgeRecord(targetID);
  return null;
}

function clearSSHRuntimeReadyState(runtimeKey: `ssh:${string}`): void {
  sshRuntimeReadyByKey.delete(runtimeKey);
  sshRuntimeMaintenanceByKey.delete(runtimeKey);
}

async function verifySSHEnvironmentRuntimeRecord(
  runtimeKey: `ssh:${string}`,
): Promise<SSHEnvironmentRuntimeRecord | null> {
  const runtimeRecord = sshEnvironmentRuntimeByKey.get(runtimeKey) ?? null;
  if (!runtimeRecord) {
    return null;
  }
  try {
    const startup = await loadExternalLocalUIStartup(runtimeRecord.local_forward_url, DESKTOP_RUNTIME_PROBE_TIMEOUT_MS);
    if (startup) {
      const updatedRecord: SSHEnvironmentRuntimeRecord = {
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
      };
      sshEnvironmentRuntimeByKey.set(runtimeKey, updatedRecord);
      return updatedRecord;
    }
  } catch {
    // The forwarded Local UI is the active SSH runtime record's liveness check.
  }
  await runtimeRecord.disconnect().catch(() => undefined);
  sshEnvironmentRuntimeByKey.delete(runtimeKey);
  clearSSHRuntimeReadyState(runtimeKey);
  return null;
}

async function inspectSavedRuntimeTargetState(
  target: DesktopPreferences['saved_runtime_targets'][number],
): Promise<SavedRuntimeTargetState> {
  const inspection = await inspectRuntimePlacementTargetState({
    targetID: target.id,
    environmentID: target.id,
    label: target.label,
    hostAccess: target.host_access,
    placement: target.placement,
    sshPassword: target.host_access.kind === 'ssh_host' && target.ssh_password_configured
      ? target.ssh_password ?? ''
      : undefined,
  });
  return inspection;
}

async function inspectRuntimePlacementTargetState(
  target: Readonly<{
    targetID: DesktopRuntimeTargetID;
    environmentID: string;
    label: string;
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    sshPassword?: string;
    signal?: AbortSignal;
  }>,
): Promise<RuntimePlacementInspectionState> {
  if (target.placement.kind !== 'container_process') {
    return {
      running: false,
      local_ui_url: '',
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'not_started',
        'Start this runtime before connecting it to a provider.',
      ),
      maintenance: runtimePlacementMaintenanceByTargetID.get(target.targetID),
      placement: target.placement,
      runtime_target_available: false,
    };
  }
  const sshPassword = compact(target.sshPassword);
  if (target.hostAccess.kind === 'ssh_host' && target.hostAccess.ssh.auth_mode === 'password' && sshPassword === '') {
    return {
      running: false,
      local_ui_url: '',
      runtime_control_status: desktopRuntimeControlStatusMissing('auth_required', 'Auto detection waits for manual authentication.'),
      maintenance: runtimePlacementMaintenanceByTargetID.get(target.targetID),
      placement: target.placement,
      runtime_target_available: false,
    };
  }
  const commandOptions = () => ({
    signal: target.signal ?? AbortSignal.timeout(DESKTOP_RUNTIME_PROBE_TIMEOUT_MS),
  });
  const resolution = await resolveRuntimeContainerPlacement(
    runtimeContainerResolver(target.hostAccess, target.signal, sshPassword || undefined),
    target.placement,
  );
  if (resolution.status === 'running') {
    const bridgeRecord = await verifyRuntimePlacementBridgeRecord(target.targetID);
    if (bridgeRecord) {
      const runtimeService = bridgeRecord.startup.runtime_service;
      return {
        running: true,
        startup: bridgeRecord.startup,
        local_ui_url: bridgeRecord.startup.local_ui_url,
        runtime_service: runtimeService,
        runtime_control_status: await runtimeControlStatusForStartup(bridgeRecord.startup),
        maintenance: runtimePlacementMaintenanceForRuntimeService(target.targetID, runtimeService),
        placement: resolution.placement,
        binary_path: bridgeRecord.runtime_binary_path,
        runtime_target_available: true,
      };
    }
    const executor = runtimeHostExecutor(target.hostAccess, sshPassword || undefined);
    try {
      const probeResult = await executor.run(containerRuntimeProbeCommand({
        engine: resolution.placement.container_engine,
        container_id: resolution.placement.container_id,
        runtime_root: resolution.placement.runtime_root,
        runtime_release_tag: resolveSSHRuntimeReleaseTag(),
      }), commandOptions());
      const probe = parseManagedSSHRuntimeProbeResult(probeResult.stdout);
      if (probe.status === 'ready') {
        const statusResult = await executor.run(containerRuntimeDaemonStatusCommand({
          engine: resolution.placement.container_engine,
          container_id: resolution.placement.container_id,
          runtime_root: resolution.placement.runtime_root,
          runtime_binary_path: probe.binary_path,
        }), commandOptions());
        const report = parseLaunchReport(statusResult.stdout);
        if (report.status === 'blocked') {
          const classification = classifyDesktopRuntimeBlockedLaunchReport(report, {
            target_runtime_version: resolveSSHRuntimeReleaseTag(),
          });
          if (classification.kind === 'stopped') {
            await clearRuntimePlacementTargetRecords(target.targetID);
            return {
              running: false,
              local_ui_url: '',
              runtime_control_status: desktopRuntimeControlStatusMissing(
                'not_started',
                classification.reason === 'stale_lock'
                  ? 'Runtime lock metadata is present but no live runtime is reachable.'
                  : 'Start this runtime before connecting it to a provider.',
              ),
              placement: resolution.placement,
              binary_path: probe.binary_path,
              runtime_target_available: true,
            };
          }
          if (classification.kind === 'unverified') {
            await clearRuntimePlacementTargetRecords(target.targetID);
            return {
              running: false,
              local_ui_url: '',
              runtime_control_status: desktopRuntimeControlStatusMissing(
                'unverified',
                classification.message,
              ),
              placement: resolution.placement,
              binary_path: probe.binary_path,
              runtime_target_available: true,
            };
          }
          const maintenance = classification.maintenance;
          runtimePlacementMaintenanceByTargetID.set(target.targetID, maintenance);
          runtimePlacementReadyByTargetID.delete(target.targetID);
          return {
            running: classification.kind === 'restart_required',
            local_ui_url: '',
            runtime_control_status: desktopRuntimeControlStatusMissing(
              'not_reported',
              maintenance.message,
            ),
            maintenance,
            placement: resolution.placement,
            binary_path: probe.binary_path,
            runtime_target_available: true,
          };
        }
        const maintenance = runtimePlacementMaintenanceForRuntimeService(target.targetID, report.startup.runtime_service);
        if (runtimeServiceAllowsOpenAttempt(report.startup.runtime_service)) {
          const readyRecord: RuntimePlacementReadyRecord = {
            runtime_key: target.targetID,
            environment_id: target.environmentID,
            label: target.label,
            target_id: providerRuntimeLinkTargetIDForRuntimeTarget(target.hostAccess, target.targetID),
            host_access: target.hostAccess,
            placement: resolution.placement,
            runtime_binary_path: probe.binary_path,
            startup: report.startup,
          };
          runtimePlacementReadyByTargetID.set(target.targetID, readyRecord);
          if (maintenance) {
            runtimePlacementMaintenanceByTargetID.set(target.targetID, maintenance);
          } else {
            runtimePlacementMaintenanceByTargetID.delete(target.targetID);
          }
          return {
            running: true,
            startup: report.startup,
            local_ui_url: '',
            open_connection_required: true,
            runtime_service: report.startup.runtime_service,
            runtime_control_status: desktopRuntimeControlStatusMissing(
              'forward_unavailable',
              'Open this runtime to prepare the Desktop bridge and provider connection.',
            ),
            maintenance,
            placement: resolution.placement,
            binary_path: probe.binary_path,
            ready_record: readyRecord,
            runtime_target_available: true,
          };
        }
        const runtimeMaintenance = sshRuntimeMaintenanceFromStartup(
          report.startup,
          'This container runtime is running but cannot open with this Desktop yet.',
        );
        runtimePlacementMaintenanceByTargetID.set(target.targetID, runtimeMaintenance);
        runtimePlacementReadyByTargetID.delete(target.targetID);
        return {
          running: true,
          startup: report.startup,
          local_ui_url: '',
          open_connection_required: true,
          runtime_service: report.startup.runtime_service,
          runtime_control_status: desktopRuntimeControlStatusMissing(
            'forward_unavailable',
            'Open this runtime to prepare the Desktop bridge and provider connection.',
          ),
          maintenance: runtimeMaintenance,
          placement: resolution.placement,
          binary_path: probe.binary_path,
          runtime_target_available: true,
        };
      }
      if (probe.status !== 'missing_binary') {
        const maintenance = buildDesktopRuntimeMaintenanceRequirement({
          kind: 'runtime_update_required',
          required_for: 'open',
          recovery_action: 'update_runtime',
          can_desktop_start: false,
          can_desktop_restart: false,
          has_active_work: true,
          active_work_label: 'Existing runtime work may be active',
          current_runtime_version: probe.reported_release_tag ?? undefined,
          target_runtime_version: probe.target_release_tag ?? resolveSSHRuntimeReleaseTag(),
          message: 'Update this container runtime before opening it with this Desktop.',
        });
        runtimePlacementMaintenanceByTargetID.set(target.targetID, maintenance);
        runtimePlacementReadyByTargetID.delete(target.targetID);
        return {
          running: false,
          local_ui_url: '',
          runtime_control_status: desktopRuntimeControlStatusMissing('not_reported', maintenance.message),
          maintenance,
          placement: resolution.placement,
          binary_path: probe.binary_path,
          runtime_target_available: true,
        };
      }
    } catch (error) {
      runtimePlacementReadyByTargetID.delete(target.targetID);
      // Read-only detection should never start or replace a container runtime.
      return {
        running: false,
        local_ui_url: '',
        runtime_control_status: desktopRuntimeControlStatusMissing(
          'unverified',
          `Could not verify runtime status: ${error instanceof Error ? error.message : String(error)}`,
        ),
        maintenance: runtimePlacementMaintenanceByTargetID.get(target.targetID),
        placement: resolution.placement,
        runtime_target_available: true,
      };
    }
    runtimePlacementReadyByTargetID.delete(target.targetID);
    return {
      running: false,
      local_ui_url: '',
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'not_started',
        'Start this runtime before connecting it to a provider.',
      ),
      maintenance: runtimePlacementMaintenanceByTargetID.get(target.targetID),
      placement: resolution.placement,
      runtime_target_available: true,
    };
  }
  await clearRuntimePlacementTargetRecords(target.targetID);
  return {
    running: false,
    local_ui_url: '',
    runtime_control_status: desktopRuntimeControlStatusMissing(
      runtimeControlReasonCodeForContainerResolution(resolution.status),
      resolution.message,
    ),
    maintenance: runtimePlacementMaintenanceByTargetID.get(target.targetID),
    placement: target.placement,
    runtime_target_available: false,
  };
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
    failure?: DesktopOperationFailurePresentation;
  }> = {},
): DesktopLauncherActionFailure {
  const failure = options.failure;
  return {
    ok: false,
    code,
    scope,
    message: compact(failure?.summary) || compact(message),
    environment_id: compact(options.environmentID) || undefined,
    provider_origin: compact(options.providerOrigin) || undefined,
    provider_id: compact(options.providerID) || undefined,
    env_public_id: compact(options.envPublicID) || undefined,
    should_refresh_snapshot: options.shouldRefreshSnapshot === true || undefined,
    ...(failure ? { failure } : {}),
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

function desktopFailureFromError(
  error: unknown,
  fallback: Readonly<{
    code?: DesktopOperationFailurePresentation['code'];
    title: string;
    summary: string;
    detail?: string;
    recoveryHint?: string;
    targetLabel?: string;
  }>,
): DesktopOperationFailurePresentation {
  return operationFailureFromUnknown(error, desktopOperationFailurePresentation({
    code: fallback.code,
    title: fallback.title,
    summary: fallback.summary,
    detail: fallback.detail,
    recoveryHint: fallback.recoveryHint,
    targetLabel: fallback.targetLabel,
  }));
}

function launcherActionFailureFromRuntimeStartError(
  error: unknown,
  options: Readonly<{
    environmentID?: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
    operation?: DesktopRuntimeLifecycleOperation;
  }> = {},
): DesktopLauncherActionFailure {
  const operation = options.operation ?? 'start';
  const fallback = desktopOperationFailurePresentation({
    code: 'operation_failed',
    title: runtimeLifecycleFailureToastTitle(operation),
    summary: error instanceof DesktopSSHRuntimeCanceledError
      ? 'SSH runtime startup was canceled.'
      : runtimeLifecycleFailureSummary(operation),
  });
  const failure = operationFailureFromUnknown(error, fallback);
  return launcherActionFailure(
    'runtime_start_failed',
    'environment',
    failure.summary,
    {
      environmentID: options.environmentID,
      providerOrigin: options.providerOrigin,
      providerID: options.providerID,
      envPublicID: options.envPublicID,
      shouldRefreshSnapshot: true,
      failure,
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

async function buildCurrentDesktopQuitImpact(): Promise<DesktopQuitImpact> {
  return buildDesktopQuitImpact({
    environment_window_count: openSessionSummaries().length,
    pending_operation_count: launcherOperations.operations().filter((operation) => (
      operation.status === 'running' || operation.status === 'canceling' || operation.status === 'cleanup_running'
    )).length,
    running_runtime_count: (localEnvironmentRuntimeRecord ? 1 : 0)
      + sshEnvironmentRuntimeByKey.size
      + runtimePlacementBridgeByTargetID.size,
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
  const normalizedRuntimeService = runtimeService ? normalizeRuntimeServiceSnapshot(runtimeService) : undefined;
  const effectiveMaintenance = desktopRuntimeMaintenanceForRuntimeService(runtimeMaintenance, normalizedRuntimeService);
  return {
    status: 'online',
    checked_at_unix_ms: Date.now(),
    source,
    local_ui_url: localUIURL,
    ...(normalizedRuntimeService ? { runtime_service: normalizedRuntimeService } : {}),
    ...(effectiveMaintenance ? { runtime_maintenance: effectiveMaintenance } : {}),
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

function runtimeHealthWithFreshness(
  health: DesktopRuntimeHealth,
  freshness: NonNullable<DesktopRuntimeHealth['freshness']>,
): DesktopRuntimeHealth {
  return {
    ...health,
    freshness,
  };
}

function checkingRuntimeHealth(
  source: DesktopRuntimeHealth['source'],
  offlineReasonCode: NonNullable<DesktopRuntimeHealth['offline_reason_code']>,
  offlineReason: string,
): DesktopRuntimeHealth {
  return runtimeHealthWithFreshness(
    offlineRuntimeHealth(source, offlineReasonCode, offlineReason),
    'checking',
  );
}

function recordWelcomeRuntimeProbeEvent(event: DesktopWelcomeRuntimeHealthProbeEvent): void {
  if (event.outcome !== 'failed') {
    return;
  }
  console.warn(
    `[redeven:welcome-runtime] Probe failed for ${event.target_kind} ${event.target_id} after ${event.duration_ms}ms: ${event.message ?? 'unknown error'}`,
  );
}

async function localEnvironmentPresenceFromRecord(
  environment: DesktopPreferences['local_environment'],
  record: LocalEnvironmentRuntimeRecord,
): Promise<DesktopManagedRuntimePresence> {
  const targetID = desktopProviderRuntimeLinkTargetID('local_environment', environment.id);
  const hostAccess: DesktopRuntimeHostAccess = { kind: 'local_host' };
  const placement: DesktopRuntimePlacement = { kind: 'host_process', runtime_root: record.state_root };
  return managedRuntimePresence({
    targetID,
    placementTargetID: desktopRuntimeTargetID(hostAccess, placement, environment.id),
    kind: 'local_environment',
    environmentID: environment.id,
    label: environment.label,
    runtimeKey: environment.id,
    hostAccess,
    placement,
    running: true,
    localUIURL: record.startup.local_ui_url,
    runtimeService: record.startup.runtime_service,
    runtimeControlStatus: await runtimeControlStatusForStartup(record.startup),
  });
}

async function probeLocalEnvironmentRuntimeHealth(
  preferences: DesktopPreferences,
  openSessions: readonly DesktopSessionSummary[],
): Promise<DesktopWelcomeRuntimeHealthProbeResult> {
  const localEnvironment = preferences.local_environment;
  const verifiedRecord = await verifyCurrentLocalEnvironmentRuntimeRecord(localEnvironment);
  if (verifiedRecord) {
    return {
      health: onlineRuntimeHealth('local_runtime_probe', verifiedRecord.startup.local_ui_url, verifiedRecord.startup.runtime_service),
      presence: await localEnvironmentPresenceFromRecord(localEnvironment, verifiedRecord),
    };
  }

  const hydratedPreferences = await hydrateWelcomeLocalEnvironmentRuntimeState(preferences, openSessions, {
    desktopOwnerID: await desktopRuntimeOwnerID(),
    executablePath: bundledRuntimeExecutablePath(),
  });
  const runtime = hydratedPreferences.local_environment.local_hosting.current_runtime;
  if (!runtime) {
    return {
      health: offlineRuntimeHealth('local_runtime_probe', 'not_started', 'Start the local runtime before opening this environment.'),
    };
  }
  return {
    health: onlineRuntimeHealth('local_runtime_probe', runtime.local_ui_url, runtime.runtime_service),
  };
}

async function probeSavedExternalRuntimeHealth(
  environment: DesktopSavedEnvironment,
): Promise<DesktopWelcomeRuntimeHealthProbeResult> {
  try {
    const startup = await loadExternalLocalUIStartup(environment.local_ui_url, DESKTOP_RUNTIME_PROBE_TIMEOUT_MS);
    if (!startup) {
      return {
        health: offlineRuntimeHealth('external_local_ui_probe', 'unverified', 'Could not verify runtime health'),
      };
    }
    return {
      health: onlineRuntimeHealth('external_local_ui_probe', startup.local_ui_url, startup.runtime_service),
    };
  } catch {
    return {
      health: offlineRuntimeHealth('external_local_ui_probe', 'unverified', 'Could not verify runtime health'),
    };
  }
}

async function savedSSHRuntimePresence(
  environment: DesktopSavedSSHEnvironment,
  runtimeRecord: SSHEnvironmentRuntimeRecord | SSHRuntimeReadyRecord,
  health: DesktopRuntimeHealth,
): Promise<DesktopManagedRuntimePresence> {
  const runtimeKey = sshDesktopSessionKey(environment);
  const runtimeLocalUIURL = String('local_forward_url' in runtimeRecord
    ? runtimeRecord.local_forward_url
    : runtimeRecord.startup.local_ui_url);
  const runtimeService = runtimeRecord.startup.runtime_service ?? health.runtime_service;
  const maintenance = sshRuntimeMaintenanceByKey.get(runtimeKey) ?? health.runtime_maintenance;
  const targetID = desktopProviderRuntimeLinkTargetID('ssh_environment', runtimeKey);
  const hostAccess: DesktopRuntimeHostAccess = { kind: 'ssh_host', ssh: environment };
  const placement: DesktopRuntimePlacement = { kind: 'host_process', runtime_root: environment.runtime_root };
  return managedRuntimePresence({
    targetID,
    placementTargetID: desktopRuntimeTargetID(hostAccess, placement),
    kind: 'ssh_environment',
    environmentID: environment.id,
    label: environment.label,
    runtimeKey,
    hostAccess,
    placement,
    running: true,
    localUIURL: runtimeLocalUIURL,
    runtimeService,
    runtimeControlStatus: await runtimeControlStatusForStartup(runtimeRecord.startup),
    maintenance,
  });
}

async function probeSavedSSHRuntimeHealth(
  environment: DesktopSavedSSHEnvironment,
): Promise<DesktopWelcomeRuntimeHealthProbeResult> {
  const runtimeKey = sshDesktopSessionKey(environment);
  const runtimeRecord = await verifySSHEnvironmentRuntimeRecord(runtimeKey);
  if (!runtimeRecord) {
    if (environment.auth_mode === 'password' && !environment.ssh_password_configured) {
      clearSSHRuntimeReadyState(runtimeKey);
      return {
        health: offlineRuntimeHealth('ssh_runtime_probe', 'auth_required', 'Auto detection waits for manual authentication'),
      };
    }
    const probe = await probeManagedSSHRuntimeStatus({
      target: environment,
      runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
      sshPassword: environment.ssh_password_configured ? environment.ssh_password : undefined,
      tempRoot: app.getPath('temp'),
      connectTimeoutSeconds: environment.connect_timeout_seconds ?? undefined,
    });
    if (probe.status === 'ready') {
      const runtimeMaintenance = sshRuntimeMaintenanceForRuntimeService(runtimeKey, probe.startup.runtime_service);
      const attachedHandle: DesktopSessionRuntimeHandle = {
        runtime_kind: 'ssh',
        lifecycle_owner: 'external',
        launch_mode: 'attached',
        stop: async () => undefined,
      };
      const readyRuntimeRecord: SSHRuntimeReadyRecord = {
        runtime_key: runtimeKey,
        environment_id: environment.id,
        label: environment.label,
        details: environment,
        startup: probe.startup,
        runtime_handle: attachedHandle,
        disconnect: async () => undefined,
        stop: async () => undefined,
      };
      sshRuntimeReadyByKey.set(runtimeKey, readyRuntimeRecord);
      const health = onlineRuntimeHealth(
        'ssh_runtime_probe',
        probe.startup.local_ui_url,
        probe.startup.runtime_service,
        runtimeMaintenance,
      );
      return {
        health,
        presence: await savedSSHRuntimePresence(environment, readyRuntimeRecord, health),
      };
    }
    if (probe.status === 'blocked') {
      const classification = classifyDesktopRuntimeBlockedLaunchReport(probe.report, {
        target_runtime_version: resolveSSHRuntimeReleaseTag(),
      });
      if (classification.kind === 'stopped') {
        clearSSHRuntimeReadyState(runtimeKey);
        return {
          health: offlineRuntimeHealth(
            'ssh_runtime_probe',
            'not_started',
            classification.reason === 'stale_lock'
              ? 'Runtime lock metadata is present but no live runtime is reachable.'
              : probe.report.message || 'Runtime is not running on this SSH host.',
          ),
        };
      }
      if (classification.kind === 'unverified') {
        clearSSHRuntimeReadyState(runtimeKey);
        return {
          health: offlineRuntimeHealth('ssh_runtime_probe', 'unverified', classification.message),
        };
      }
      const runtimeMaintenance = classification.maintenance;
      sshRuntimeMaintenanceByKey.set(runtimeKey, runtimeMaintenance);
      sshRuntimeReadyByKey.delete(runtimeKey);
      return {
        health: onlineRuntimeHealth('ssh_runtime_probe', '', undefined, runtimeMaintenance),
      };
    }
    if (probe.status === 'failed') {
      clearSSHRuntimeReadyState(runtimeKey);
      return {
        health: offlineRuntimeHealth('ssh_runtime_probe', 'unverified', probe.message || 'Could not verify runtime status'),
      };
    }
    clearSSHRuntimeReadyState(runtimeKey);
    return {
      health: offlineRuntimeHealth('ssh_runtime_probe', 'not_started', probe.message || 'Runtime is not running on this SSH host.'),
    };
  }
  const nextRuntimeService = runtimeRecord.startup.runtime_service;
  const runtimeMaintenance = sshRuntimeMaintenanceForRuntimeService(runtimeKey, nextRuntimeService);
  const health = onlineRuntimeHealth('ssh_runtime_probe', runtimeRecord.startup.local_ui_url, nextRuntimeService, runtimeMaintenance);
  return {
    health,
    presence: await savedSSHRuntimePresence(environment, runtimeRecord, health),
  };
}

function runtimeTargetProbeSource(target: DesktopSavedRuntimeTarget): DesktopRuntimeHealth['source'] {
  return target.host_access.kind === 'ssh_host' ? 'ssh_runtime_probe' : 'local_runtime_probe';
}

function runtimeTargetOfflineReasonCode(
  state: SavedRuntimeTargetState,
): NonNullable<DesktopRuntimeHealth['offline_reason_code']> {
  if (state.runtime_control_status.state !== 'missing') {
    return 'unverified';
  }
  switch (state.runtime_control_status.reason_code) {
    case 'not_started':
    case 'auth_required':
    case 'unverified':
    case 'container_not_running':
      return state.runtime_control_status.reason_code;
    default:
      return 'unverified';
  }
}

function runtimeTargetHealthFromState(
  target: DesktopSavedRuntimeTarget,
  state: SavedRuntimeTargetState,
): DesktopRuntimeHealth {
  const source = runtimeTargetProbeSource(target);
  if (state.running || state.maintenance) {
    return onlineRuntimeHealth(
      source,
      state.local_ui_url,
      state.runtime_service,
      state.maintenance,
    );
  }
  return offlineRuntimeHealth(
    source,
    runtimeTargetOfflineReasonCode(state),
    state.runtime_control_status.state === 'missing'
      ? state.runtime_control_status.message
      : 'Could not verify runtime status',
  );
}

function runtimeTargetPresenceFromState(
  target: DesktopSavedRuntimeTarget,
  state: SavedRuntimeTargetState,
): DesktopManagedRuntimePresence {
  const targetKind = providerRuntimeLinkKindForHostAccess(target.host_access);
  const targetID = providerRuntimeLinkTargetIDForRuntimeTarget(target.host_access, target.id);
  const placement = state.placement ?? target.placement;
  return managedRuntimePresence({
    targetID,
    placementTargetID: target.id,
    kind: targetKind,
    environmentID: target.id,
    label: target.label,
    runtimeKey: target.id,
    hostAccess: target.host_access,
    placement,
    running: state.running,
    localUIURL: state.local_ui_url,
    openConnectionRequired: state.open_connection_required === true,
    runtimeService: state.runtime_service,
    runtimeControlStatus: state.runtime_control_status,
    maintenance: state.maintenance,
  });
}

async function probeSavedRuntimeTargetHealth(
  target: DesktopSavedRuntimeTarget,
): Promise<DesktopWelcomeRuntimeHealthProbeResult> {
  const state = await inspectSavedRuntimeTargetState(target);
  if (!state.running) {
    return {
      health: runtimeTargetHealthFromState(target, state),
    };
  }
  return {
    health: runtimeTargetHealthFromState(target, state),
    presence: runtimeTargetPresenceFromState(target, state),
  };
}

function buildWelcomeRuntimeHealthTargets(
  preferences: DesktopPreferences,
  openSessions: readonly DesktopSessionSummary[],
): readonly DesktopWelcomeRuntimeHealthTarget[] {
  return [
    {
      key: `local:${preferences.local_environment.id}`,
      environment_id: preferences.local_environment.id,
      slot: 'local_environment' as const,
      presence_target_id: desktopProviderRuntimeLinkTargetID('local_environment', preferences.local_environment.id),
      auto_refresh_enabled: true,
      checking_health: checkingRuntimeHealth('local_runtime_probe', 'not_started', 'Checking Local Runtime status.'),
      probe: () => probeLocalEnvironmentRuntimeHealth(preferences, openSessions),
    },
    ...preferences.saved_environments.map((environment) => ({
      key: `external:${environment.id}`,
      environment_id: environment.id,
      slot: 'external_local_ui' as const,
      auto_refresh_enabled: environment.auto_runtime_probe_enabled,
      checking_health: checkingRuntimeHealth('external_local_ui_probe', 'unverified', 'Checking saved Environment status.'),
      probe: () => probeSavedExternalRuntimeHealth(environment),
    })),
    ...preferences.saved_ssh_environments.map((environment) => ({
      key: `ssh:${environment.id}`,
      environment_id: environment.id,
      slot: 'ssh_environment' as const,
      presence_target_id: desktopProviderRuntimeLinkTargetID('ssh_environment', desktopSSHEnvironmentID(environment)),
      auto_refresh_enabled: environment.auto_runtime_probe_enabled,
      checking_health: checkingRuntimeHealth('ssh_runtime_probe', 'not_started', 'Checking SSH Runtime status.'),
      probe: () => probeSavedSSHRuntimeHealth(environment),
    })),
    ...preferences.saved_runtime_targets.map((target) => {
      const targetKind = providerRuntimeLinkKindForHostAccess(target.host_access);
      return {
        key: `runtime-target:${target.id}`,
        environment_id: target.id,
        slot: 'runtime_target' as const,
        presence_target_id: desktopProviderRuntimeLinkTargetID(targetKind, target.id),
        auto_refresh_enabled: desktopRuntimeTargetAutoStatusDetectionEnabled(
          target.host_access,
          target.placement,
          target.auto_runtime_probe_enabled,
        ),
        checking_health: checkingRuntimeHealth(
          runtimeTargetProbeSource(target),
          'not_started',
          'Checking Runtime status.',
        ),
        probe: () => probeSavedRuntimeTargetHealth(target),
      };
    }),
  ];
}

async function refreshWelcomeRuntimeHealth(options: Readonly<{
  force?: boolean;
  mode?: 'auto' | 'manual';
  targetEnvironmentIDs?: readonly string[];
}> = {}): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const openSessions = openSessionSummaries();
  const mode = options.mode ?? 'auto';
  const targetEnvironmentIDs = new Set((options.targetEnvironmentIDs ?? [])
    .map((value) => compact(value))
    .filter((value) => value !== ''));
  const targets = buildWelcomeRuntimeHealthTargets(preferences, openSessions)
    .filter((target) => targetEnvironmentIDs.size === 0 || targetEnvironmentIDs.has(target.environment_id))
    .filter((target) => mode === 'manual' || target.auto_refresh_enabled);
  await welcomeRuntimeHealthStore.refresh(targets, {
    force: options.force === true,
    pruneMissing: mode === 'manual' && targetEnvironmentIDs.size === 0,
  });
}

function scheduleWelcomeRuntimeHealthRefresh(options: Readonly<{
  force?: boolean;
  mode?: 'auto' | 'manual';
  targetEnvironmentIDs?: readonly string[];
}> = {}): void {
  void refreshWelcomeRuntimeHealth(options).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[redeven:welcome-runtime] Runtime health refresh failed: ${message}`);
  });
}

async function refreshWelcomeRuntimeHealthForEnvironment(environmentID: string): Promise<void> {
  const cleanEnvironmentID = compact(environmentID);
  await refreshWelcomeRuntimeHealth({
    force: true,
    mode: 'manual',
    targetEnvironmentIDs: cleanEnvironmentID ? [cleanEnvironmentID] : [],
  });
}

function savedRuntimeTargetHealthForOpenPreflight(
  environmentID: string,
  targetID: DesktopRuntimeTargetID,
): DesktopRuntimeHealth | undefined {
  const snapshot = welcomeRuntimeHealthStore.snapshot();
  return snapshot.savedRuntimeTargetHealth[environmentID]
    ?? snapshot.savedRuntimeTargetHealth[targetID];
}

function savedSSHRuntimeHealthForOpenPreflight(
  environmentID: string,
  runtimeKey: `ssh:${string}`,
): DesktopRuntimeHealth | undefined {
  const snapshot = welcomeRuntimeHealthStore.snapshot();
  return snapshot.savedSSHRuntimeHealth[environmentID]
    ?? snapshot.savedSSHRuntimeHealth[runtimeKey];
}

function launcherActionEnvironmentID(request: DesktopLauncherActionRequest): string {
  return 'environment_id' in request ? compact(request.environment_id) : '';
}

function launcherActionRefreshScope(
  request: DesktopLauncherActionRequest,
): Readonly<{ force: boolean; mode: 'auto' | 'manual'; targetEnvironmentIDs?: readonly string[] }> | null {
  const targetEnvironmentID = launcherActionEnvironmentID(request);
  const targetScope = targetEnvironmentID ? [targetEnvironmentID] : undefined;
  const actionKind: DesktopLauncherActionKind = request.kind;
  switch (actionKind) {
    case 'open_local_environment':
    case 'open_remote_environment':
    case 'open_ssh_environment':
    case 'start_environment_runtime':
    case 'restart_environment_runtime':
    case 'update_environment_runtime':
    case 'connect_provider_runtime':
    case 'disconnect_provider_runtime':
    case 'stop_environment_runtime':
      return { force: true, mode: 'manual', targetEnvironmentIDs: targetScope };
    case 'save_local_environment_settings':
    case 'upsert_saved_environment':
    case 'upsert_saved_ssh_environment':
    case 'upsert_saved_runtime_target':
    case 'delete_saved_environment':
    case 'delete_saved_ssh_environment':
    case 'delete_saved_runtime_target':
      return { force: true, mode: 'auto', targetEnvironmentIDs: targetScope };
    default:
      return null;
  }
}

function scheduleWelcomeRuntimeHealthRefreshAfterLauncherAction(
  request: DesktopLauncherActionRequest,
  result: DesktopLauncherActionResult,
): void {
  if (!result.ok) {
    return;
  }
  const scope = launcherActionRefreshScope(request);
  if (!scope) {
    return;
  }
  scheduleWelcomeRuntimeHealthRefresh(scope);
}

async function buildCurrentDesktopWelcomeSnapshot(
  kind: DesktopUtilityWindowKind,
  overrides: Partial<Pick<BuildDesktopWelcomeSnapshotArgs, 'entryReason' | 'issue'>> = {},
) {
  const preferences = await loadDesktopPreferencesCached();
  const openSessions = openSessionSummaries();
  welcomeRuntimeHealthStore.prime(
    buildWelcomeRuntimeHealthTargets(preferences, openSessions),
    { pruneMissing: true },
  );
  const healthSnapshot = welcomeRuntimeHealthStore.snapshot();
  const state = currentUtilityWindowState(kind);
  return buildDesktopWelcomeSnapshot({
    preferences,
    controlPlanes: currentControlPlaneSummaries(preferences),
    openSessions,
    localRuntimeHealth: healthSnapshot.localRuntimeHealth,
    savedExternalRuntimeHealth: healthSnapshot.savedExternalRuntimeHealth,
    savedSSHRuntimeHealth: healthSnapshot.savedSSHRuntimeHealth,
    savedRuntimeTargetHealth: healthSnapshot.savedRuntimeTargetHealth,
    managedRuntimePresenceByTargetID: healthSnapshot.managedRuntimePresenceByTargetID,
    actionProgress: launcherOperations.progressItems(),
    operations: launcherOperations.operations(),
    surface: state.surface,
    entryReason: overrides.entryReason ?? state.entryReason,
    issue: overrides.issue ?? state.issue,
    selectedEnvironmentID: state.selectedEnvironmentID,
  });
}

function reserveDesktopWelcomeSnapshotGeneration(): number {
  return desktopWelcomeSnapshotOrder.reserveGeneration();
}

function stampDesktopWelcomeSnapshot(
  snapshot: DesktopWelcomeSnapshot,
  snapshotGeneration = reserveDesktopWelcomeSnapshotGeneration(),
): DesktopWelcomeSnapshot {
  return desktopWelcomeSnapshotOrder.stamp(snapshot, snapshotGeneration);
}

function shouldEmitDesktopWelcomeSnapshotGeneration(snapshotGeneration: number): boolean {
  return desktopWelcomeSnapshotOrder.shouldEmitGeneration(snapshotGeneration);
}

async function buildStampedDesktopWelcomeSnapshot(kind: DesktopUtilityWindowKind): Promise<DesktopWelcomeSnapshot> {
  const snapshotGeneration = reserveDesktopWelcomeSnapshotGeneration();
  return stampDesktopWelcomeSnapshot(
    await buildCurrentDesktopWelcomeSnapshot(kind),
    snapshotGeneration,
  );
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
  const snapshotGeneration = reserveDesktopWelcomeSnapshotGeneration();
  const snapshot = await buildCurrentDesktopWelcomeSnapshot(kind);
  if (!shouldEmitDesktopWelcomeSnapshotGeneration(snapshotGeneration)) {
    return;
  }
  win.webContents.send(
    DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL,
    stampDesktopWelcomeSnapshot(snapshot, snapshotGeneration),
  );
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
  const snapshot = launcherOperations.get(cleanOperationKey);
  if (
    snapshot?.status === 'failed'
    || snapshot?.status === 'cleanup_failed'
  ) {
    return;
  }
  const existingTimer = launcherOperationRemovalTimers.get(cleanOperationKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const startedAtUnixMs = snapshot?.started_at_unix_ms;
  const timer = setTimeout(() => {
    launcherOperationRemovalTimers.delete(cleanOperationKey);
    const current = launcherOperations.get(cleanOperationKey);
    if (startedAtUnixMs !== undefined && current?.started_at_unix_ms !== startedAtUnixMs) {
      return;
    }
    launcherOperations.remove(cleanOperationKey);
    void emitDesktopWelcomeSnapshot('launcher');
  }, delayMs);
  launcherOperationRemovalTimers.set(cleanOperationKey, timer);
}

function launcherOperationMatchesAttempt(
  snapshot: DesktopLauncherOperationSnapshot | null,
  owner: LauncherOperationAttemptIdentity,
): snapshot is DesktopLauncherOperationSnapshot {
  return !!snapshot
    && snapshot.action === owner.action
    && snapshot.started_at_unix_ms === owner.started_at_unix_ms;
}

function scheduleCurrentLauncherOperationRemoval(
  operationKey: string,
  owner: LauncherOperationAttemptIdentity,
  delayMs = 4_000,
): void {
  const snapshot = launcherOperations.get(operationKey);
  if (!launcherOperationMatchesAttempt(snapshot, owner)) {
    return;
  }
  if (
    snapshot.status === 'failed'
    || snapshot.status === 'cleanup_failed'
  ) {
    return;
  }
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
    const current = launcherOperations.get(cleanOperationKey);
    if (!launcherOperationMatchesAttempt(current, owner)) {
      return;
    }
    if (
      current.status === 'failed'
      || current.status === 'cleanup_failed'
    ) {
      return;
    }
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

    sessionRecord.runtime_handle = null;
    sessionRecord.diagnostics.clearRuntime();
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
  forceRuntimeUpdate?: boolean;
  onProgress?: (progress: ManagedRuntimeProgress) => void;
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
    stateRoot: launchPlan.state_layout.stateRoot,
    desktopOwnerID,
    forceRuntimeUpdate: options.forceRuntimeUpdate === true,
    passwordStdin: launchPlan.password_stdin,
    tempRoot: app.getPath('temp'),
    onProgress: options.onProgress,
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
  const verifiedRecord = await verifyCurrentLocalEnvironmentRuntimeRecord(environment);
  if (verifiedRecord) {
    return verifiedRecord;
  }

  const attachedRuntime = await attachManagedRuntimeFromStatus({
    executablePath: bundledRuntimeExecutablePath(),
    stateRoot: localEnvironmentStateRoot(environment),
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

async function assertLocalEnvironmentRuntimeStopped(
  environment: DesktopLocalEnvironmentState,
): Promise<void> {
  const startup = await loadManagedRuntimeStartupFromStatus({
    executablePath: bundledRuntimeExecutablePath(),
    stateRoot: localEnvironmentStateRoot(environment),
    env: process.env,
    timeoutMs: DESKTOP_RUNTIME_PROBE_TIMEOUT_MS,
  });
  if (startup) {
    throw new Error('Desktop could not stop the local runtime because it still reports a ready process.');
  }
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

function runtimeTargetDetail(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
): string {
  if (placement.kind === 'container_process') {
    const containerLabel = placement.container_label || placement.container_ref || placement.container_id;
    if (hostAccess.kind === 'ssh_host') {
      return `${desktopSSHAuthority(hostAccess.ssh)} · ${containerLabel}`;
    }
    return containerLabel;
  }
  if (hostAccess.kind === 'ssh_host') {
    return desktopSSHAuthority(hostAccess.ssh);
  }
  return 'This device';
}

function buildRuntimeLifecycleProgress(input: Readonly<{
  hostAccess: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  operation?: DesktopRuntimeLifecycleOperation;
  phase: DesktopRuntimeLifecyclePhase;
  failedPhase?: DesktopRuntimeLifecyclePhase;
  detail?: string;
  targetID: string;
  targetLabel: string;
}>): DesktopRuntimeLifecycleProgress {
  const location = desktopRuntimeLifecycleLocation(input.hostAccess, input.placement);
  const operation = input.operation ?? 'start';
  const plan = initialRuntimeLifecyclePlan({
    location,
    operation,
  });
  return runtimeLifecycleProgress({
    location,
    operation,
    planState: plan.state,
    phase: input.phase,
    failedPhase: input.failedPhase,
    detail: input.detail,
    stepStates: plan.steps.map((step) => step.id === input.phase
      ? {
          ...step,
          status: input.failedPhase === input.phase ? 'failed' : 'running',
          ...(input.detail ? { detail: input.detail } : {}),
        }
      : step),
    targetID: input.targetID,
    targetLabel: input.targetLabel,
    targetDetail: runtimeTargetDetail(input.hostAccess, input.placement),
  });
}

type RuntimeLifecycleWorkflowAttempt = LauncherOperationAttemptIdentity & Readonly<{
  workflow: RuntimeLifecycleWorkflow;
}>;

const RUNTIME_LIFECYCLE_WORKFLOW_OWNER_STATUSES: readonly DesktopLauncherOperationSnapshot['status'][] = [
  'running',
  'canceling',
  'cleanup_running',
];

const runtimeLifecycleWorkflowAttemptsByKey = new Map<string, RuntimeLifecycleWorkflowAttempt>();

function launcherOperationCanOwnRuntimeLifecycleWorkflow(
  snapshot: DesktopLauncherOperationSnapshot | null,
): snapshot is DesktopLauncherOperationSnapshot {
  return !!snapshot && RUNTIME_LIFECYCLE_WORKFLOW_OWNER_STATUSES.includes(snapshot.status);
}

function runtimeLifecycleAttemptIdentity(
  snapshot: DesktopLauncherOperationSnapshot | null,
): LauncherOperationAttemptIdentity | null {
  if (!launcherOperationCanOwnRuntimeLifecycleWorkflow(snapshot)) {
    return null;
  }
  return {
    action: snapshot.action,
    started_at_unix_ms: snapshot.started_at_unix_ms,
  };
}

function runtimeLifecycleAttemptMatchesSnapshot(
  attempt: RuntimeLifecycleWorkflowAttempt,
  snapshot: DesktopLauncherOperationSnapshot | null,
  operation: DesktopRuntimeLifecycleOperation,
): boolean {
  if (attempt.workflow.progress().operation !== operation) {
    return false;
  }
  const identity = runtimeLifecycleAttemptIdentity(snapshot);
  return !!identity
    && attempt.action === identity.action
    && attempt.started_at_unix_ms === identity.started_at_unix_ms;
}

function runtimeLifecycleAttemptMatchesIdentity(
  attempt: RuntimeLifecycleWorkflowAttempt,
  identity: LauncherOperationAttemptIdentity,
): boolean {
  return attempt.action === identity.action
    && attempt.started_at_unix_ms === identity.started_at_unix_ms;
}

function runtimeLifecycleWorkflowFromInput(
  operationKey: string,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    operation: DesktopRuntimeLifecycleOperation;
    targetID?: string;
    targetLabel: string;
  }>,
): RuntimeLifecycleWorkflow {
  const key = compact(operationKey);
  return new RuntimeLifecycleWorkflow({
    location: desktopRuntimeLifecycleLocation(input.hostAccess, input.placement),
    operation: input.operation,
    target_id: compact(input.targetID) || key,
    target_label: input.targetLabel,
    target_detail: runtimeTargetDetail(input.hostAccess, input.placement),
  });
}

function beginRuntimeLifecycleWorkflowAttempt(
  operationKey: string,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    operation: DesktopRuntimeLifecycleOperation;
    targetID?: string;
    targetLabel: string;
  }>,
): RuntimeLifecycleWorkflow {
  const key = compact(operationKey);
  const snapshot = launcherOperations.get(key);
  const identity = runtimeLifecycleAttemptIdentity(snapshot);
  if (!identity) {
    throw new Error(`Runtime lifecycle operation "${key}" is not active.`);
  }
  const currentProgress = snapshot?.lifecycle_progress;
  const workflow = currentProgress?.operation === input.operation
    ? RuntimeLifecycleWorkflow.fromProgress(currentProgress)
    : runtimeLifecycleWorkflowFromInput(key, input);
  runtimeLifecycleWorkflowAttemptsByKey.set(key, {
    ...identity,
    workflow,
  });
  return workflow;
}

function runtimeLifecycleWorkflowForOperation(
  operationKey: string,
  owner: LauncherOperationAttemptIdentity,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    operation: DesktopRuntimeLifecycleOperation;
    targetID?: string;
    targetLabel: string;
  }>,
): RuntimeLifecycleWorkflow {
  const key = compact(operationKey);
  const snapshot = launcherOperations.get(key);
  const existing = runtimeLifecycleWorkflowAttemptsByKey.get(key);
  if (
    existing
    && runtimeLifecycleAttemptMatchesIdentity(existing, owner)
    && runtimeLifecycleAttemptMatchesSnapshot(existing, snapshot, input.operation)
  ) {
    return existing.workflow;
  }
  if (existing && !runtimeLifecycleAttemptMatchesIdentity(existing, owner)) {
    return runtimeLifecycleWorkflowFromInput(key, input);
  }
  if (existing) {
    runtimeLifecycleWorkflowAttemptsByKey.delete(key);
  }
  const currentProgress = snapshot?.lifecycle_progress;
  const identity = runtimeLifecycleAttemptIdentity(snapshot);
  if (
    currentProgress
    && currentProgress.operation === input.operation
    && identity
    && identity.action === owner.action
    && identity.started_at_unix_ms === owner.started_at_unix_ms
  ) {
    const hydrated = RuntimeLifecycleWorkflow.fromProgress(currentProgress);
    runtimeLifecycleWorkflowAttemptsByKey.set(key, {
      ...identity,
      workflow: hydrated,
    });
    return hydrated;
  }
  const workflow = runtimeLifecycleWorkflowFromInput(key, input);
  if (
    identity
    && identity.action === owner.action
    && identity.started_at_unix_ms === owner.started_at_unix_ms
  ) {
    runtimeLifecycleWorkflowAttemptsByKey.set(key, {
      ...identity,
      workflow,
    });
  }
  return workflow;
}

type RuntimeLifecycleWorkflowFailureResult = Readonly<{
  step_failure: RuntimeLifecycleStepFailureError;
  lifecycle_progress: DesktopRuntimeLifecycleProgress;
}>;

function runtimeLifecycleWorkflowFailure(
  operationKey: string,
  owner: LauncherOperationAttemptIdentity,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    operation: DesktopRuntimeLifecycleOperation;
    targetID?: string;
    targetLabel: string;
    error: unknown;
    fallback: DesktopOperationFailurePresentation;
  }>,
): RuntimeLifecycleWorkflowFailureResult {
  const workflow = runtimeLifecycleWorkflowForOperation(operationKey, owner, input);
  const location = desktopRuntimeLifecycleLocation(input.hostAccess, input.placement);
  const failedStepID = runtimeLifecycleStepIDFromError(input.error) ?? workflow.progress().active_step_id;
  const failurePlan = runtimeLifecyclePlanIncludingStep({
    location,
    operation: input.operation,
    currentSteps: workflow.currentStepIDs(),
    step: failedStepID,
  });
  workflow.ensureStepPlanned(failedStepID, {
    state: failurePlan.state,
    steps: failurePlan.steps.map((step) => step.id),
    omitted_steps: failurePlan.omitted_steps,
  });
  const stepFailure = workflow.failStep(input.error, input.fallback, failedStepID);
  return {
    step_failure: stepFailure,
    lifecycle_progress: workflow.progress(),
  };
}

function commitRuntimeLifecycleDecision(
  operationKey: string,
  owner: LauncherOperationAttemptIdentity,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    operation: DesktopRuntimeLifecycleOperation;
    targetID?: string;
    targetLabel: string;
    decision: RuntimeLifecycleDecision;
  }>,
): RuntimeLifecycleWorkflow {
  const workflow = runtimeLifecycleWorkflowForOperation(operationKey, owner, input);
  const location = desktopRuntimeLifecycleLocation(input.hostAccess, input.placement);
  const plan = runtimeLifecyclePlanAfterDecision({
    location,
    operation: input.operation,
    decision: input.decision,
  });
  const patch = runtimeLifecyclePlanPatchPreservingObservedHistory({
    currentSteps: workflow.stepStates(),
    patch: {
      state: plan.state,
      steps: plan.steps.map((step) => step.id),
      omitted_steps: plan.omitted_steps ?? [],
    },
  });
  workflow.commitPlan({
    state: patch.state,
    steps: patch.steps,
    omitted_steps: patch.omitted_steps,
  });
  return workflow;
}

function completeRuntimeLifecycleWorkflowProgress(
  operationKey: string,
  owner: LauncherOperationAttemptIdentity,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    operation: DesktopRuntimeLifecycleOperation;
    phase: DesktopRuntimeLifecyclePhase;
    targetID?: string;
    targetLabel: string;
    detail?: string;
  }>,
): DesktopRuntimeLifecycleProgress {
  const location = desktopRuntimeLifecycleLocation(input.hostAccess, input.placement);
  const workflow = runtimeLifecycleWorkflowForOperation(operationKey, owner, input);
  const completionPlan = runtimeLifecyclePlanIncludingStep({
    location,
    operation: input.operation,
    currentSteps: workflow.currentStepIDs(),
    step: input.phase,
  });
  workflow.ensureStepPlanned(input.phase, {
    state: completionPlan.state,
    steps: completionPlan.steps.map((step) => step.id),
    omitted_steps: completionPlan.omitted_steps,
  });
  const status = workflow.stepStates().find((step) => step.id === input.phase)?.status;
  if (status === 'succeeded') {
    return workflow.progress();
  }
  if (status === 'pending') {
    workflow.beginStep(input.phase, input.detail);
  } else if (status === 'running') {
    workflow.observeStep(input.phase, input.detail);
  }
  workflow.completeStep(input.phase);
  return workflow.progress();
}

function currentRuntimeLifecycleWorkflowProgress(
  operationKey: string,
  owner: LauncherOperationAttemptIdentity,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    operation: DesktopRuntimeLifecycleOperation;
    targetID?: string;
    targetLabel: string;
  }>,
): DesktopRuntimeLifecycleProgress {
  return runtimeLifecycleWorkflowForOperation(operationKey, owner, input).progress();
}

function clearRuntimeLifecycleWorkflow(
  operationKey: string,
  owner?: LauncherOperationAttemptIdentity,
): void {
  const key = compact(operationKey);
  const current = runtimeLifecycleWorkflowAttemptsByKey.get(key);
  if (owner && current && !runtimeLifecycleAttemptMatchesIdentity(current, owner)) {
    return;
  }
  runtimeLifecycleWorkflowAttemptsByKey.delete(key);
}

function optionalRuntimeLifecycleAttemptProgress(
  operationKey: string,
  owner: LauncherOperationAttemptIdentity,
): DesktopRuntimeLifecycleProgress | undefined {
  const attempt = runtimeLifecycleWorkflowAttemptsByKey.get(compact(operationKey));
  if (!attempt || !runtimeLifecycleAttemptMatchesIdentity(attempt, owner)) {
    return undefined;
  }
  return attempt.workflow.progress();
}

function updateRuntimeLifecycleOperation(
  operationKey: string,
  owner: LauncherOperationAttemptIdentity,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    operation?: DesktopRuntimeLifecycleOperation;
    phase: DesktopRuntimeLifecyclePhase;
    targetID?: string;
    targetLabel: string;
    title: string;
    detail: string;
    status?: DesktopLauncherOperationSnapshot['status'];
    failedPhase?: DesktopRuntimeLifecyclePhase;
    failure?: DesktopOperationFailurePresentation;
    cancelable?: boolean;
  }>,
): void {
  const current = launcherOperations.get(operationKey);
  const operation = input.operation ?? current?.lifecycle_progress?.operation ?? 'start';
  const location = desktopRuntimeLifecycleLocation(input.hostAccess, input.placement);
  const workflow = runtimeLifecycleWorkflowForOperation(operationKey, owner, {
    hostAccess: input.hostAccess,
    placement: input.placement,
    operation,
    targetID: input.targetID,
    targetLabel: input.targetLabel,
  });
  if (input.failedPhase) {
    const failurePlan = runtimeLifecyclePlanIncludingStep({
      location,
      operation,
      currentSteps: workflow.currentStepIDs(),
      step: input.failedPhase,
    });
    workflow.ensureStepPlanned(input.failedPhase, {
      state: failurePlan.state,
      steps: failurePlan.steps.map((step) => step.id),
      omitted_steps: failurePlan.omitted_steps,
    });
    workflow.failStep(input.failure ?? new Error(input.detail), input.failure ?? desktopOperationFailurePresentation({
      code: 'operation_failed',
      title: input.title,
      summary: input.detail,
      targetLabel: input.targetLabel,
    }), input.failedPhase);
  } else {
    const phasePlan = runtimeLifecyclePlanIncludingStep({
      location,
      operation,
      currentSteps: workflow.currentStepIDs(),
      step: input.phase,
    });
    const planUpdate = workflow.ensureStepPlanned(input.phase, {
      state: phasePlan.state,
      steps: phasePlan.steps.map((step) => step.id),
      omitted_steps: phasePlan.omitted_steps,
    });
    const currentStep = workflow.progress().active_step_id;
    const currentStatus = workflow.stepStates().find((step) => step.id === input.phase)?.status;
    let update: ReturnType<RuntimeLifecycleWorkflow['observeStep']> | ReturnType<RuntimeLifecycleWorkflow['beginStep']>;
    if (currentStep === input.phase && currentStatus === 'running') {
      update = workflow.observeStep(input.phase, input.detail);
    } else if (currentStatus === 'succeeded' || currentStatus === 'failed') {
      update = null;
    } else {
      update = workflow.beginStep(input.phase, input.detail);
    }
    if (!update && !planUpdate) {
      return;
    }
  }
  const lifecycleProgress = workflow.progress();
  launcherOperations.updateCurrentAttempt(operationKey, owner, {
    ...(input.status ? { status: input.status } : {}),
    phase: lifecycleProgress.active_step_id,
    title: input.title,
    detail: input.detail,
    lifecycle_progress: lifecycleProgress,
    ...(input.failure ? { failure: input.failure } : {}),
    ...(input.cancelable !== undefined ? { cancelable: input.cancelable } : {}),
  });
}

function runtimeLifecyclePhaseFromManagedRuntime(
  phase: ManagedRuntimeProgress['phase'],
): DesktopRuntimeLifecyclePhase {
  switch (phase) {
    case 'checking_existing_runtime':
      return 'checking_existing_runtime';
    case 'starting_runtime':
      return 'starting_runtime_process';
    case 'waiting_for_readiness':
      return 'checking_runtime_service';
    case 'runtime_ready':
      return 'checking_runtime_service';
  }
}

function runtimeLifecyclePhaseFromPlacement(
  phase: RuntimePlacementProgress['phase'],
): DesktopRuntimeLifecyclePhase {
  switch (phase) {
    case 'checking_host':
      return 'checking_host';
    case 'checking_container':
      return 'checking_container';
    case 'detecting_platform':
      return 'detecting_platform';
    case 'checking_runtime':
      return 'checking_runtime_package';
    case 'preparing_runtime_package':
      return 'preparing_runtime_package';
    case 'installing_runtime':
      return 'installing_runtime_package';
    case 'starting_runtime_daemon':
      return 'starting_runtime_process';
    case 'waiting_runtime_daemon':
      return 'checking_runtime_service';
    case 'runtime_ready':
      return 'checking_runtime_service';
  }
}

function buildOpenConnectionProgress(input: Readonly<{
  hostAccess: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  phase: DesktopOpenConnectionPhase;
  environmentID: string;
  environmentLabel: string;
  targetID?: string;
  targetLabel?: string;
  targetDetail?: string;
  location?: DesktopOpenConnectionLocation;
}>): DesktopOpenConnectionProgress {
  return openConnectionProgress({
    location: input.location ?? desktopOpenConnectionLocation(input.hostAccess, input.placement),
    phase: input.phase,
    environmentID: input.environmentID,
    environmentLabel: input.environmentLabel,
    targetID: input.targetID,
    targetLabel: input.targetLabel,
    targetDetail: input.targetDetail ?? runtimeTargetDetail(input.hostAccess, input.placement),
  });
}

function updateOpenConnectionOperation(
  operationKey: string,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    phase: DesktopOpenConnectionPhase;
    environmentID: string;
    environmentLabel: string;
    targetID?: string;
    targetLabel?: string;
    title: string;
    detail: string;
    status?: DesktopLauncherOperationSnapshot['status'];
    failure?: DesktopOperationFailurePresentation;
    cancelable?: boolean;
  }>,
): void {
  launcherOperations.update(operationKey, {
    ...(input.status ? { status: input.status } : {}),
    phase: input.phase,
    title: input.title,
    detail: input.detail,
    open_progress: buildOpenConnectionProgress(input),
    ...(input.failure ? { failure: input.failure } : {}),
    ...(input.cancelable !== undefined ? { cancelable: input.cancelable } : {}),
  });
}

function sshRuntimeLifecyclePhase(
  phase: DesktopSSHRuntimeProgress['phase'],
): DesktopRuntimeLifecyclePhase {
  switch (phase) {
    case 'ssh_connecting':
    case 'ssh_control_ready':
      return 'checking_host';
    case 'ssh_checking_runtime':
    case 'ssh_runtime_ready':
      return 'checking_runtime_package';
    case 'ssh_detecting_platform':
      return 'detecting_platform';
    case 'ssh_preparing_upload':
      return 'preparing_runtime_package';
    case 'ssh_remote_installing':
    case 'ssh_creating_upload_dir':
    case 'ssh_uploading_archive':
    case 'ssh_installing_upload':
      return 'installing_runtime_package';
    case 'ssh_starting_runtime':
      return 'starting_runtime_process';
    case 'ssh_waiting_report':
      return 'checking_runtime_service';
    case 'ssh_opening_tunnel':
    case 'ssh_connecting_model_source':
    case 'ssh_verifying_tunnel':
      return 'checking_runtime_service';
    case 'ssh_cleaning_startup_resources':
      return 'checking_runtime_service';
  }
}

function runtimeLifecycleTitleForFailure(
  location: DesktopRuntimeLifecycleLocation,
  maintenanceRequired: boolean,
  operation: DesktopRuntimeLifecycleOperation = 'start',
): string {
  if (maintenanceRequired) {
    return location === 'ssh_host' ? 'SSH runtime needs attention' : 'Runtime needs attention';
  }
  if (operation === 'stop') {
    return location === 'ssh_host' ? 'SSH runtime stop failed' : 'Runtime stop failed';
  }
  if (operation === 'restart') {
    return location === 'ssh_host' ? 'SSH runtime restart failed' : 'Runtime restart failed';
  }
  if (operation === 'update') {
    return location === 'ssh_host' ? 'SSH runtime update failed' : 'Runtime update failed';
  }
  return location === 'ssh_host' ? 'SSH runtime start failed' : 'Runtime start failed';
}

function runtimeLifecycleFailureToastTitle(
  operation: DesktopRuntimeLifecycleOperation = 'start',
): string {
  switch (operation) {
    case 'stop':
      return 'Runtime Stop Failed';
    case 'restart':
      return 'Runtime Restart Failed';
    case 'update':
      return 'Runtime Update Failed';
    default:
      return 'Runtime Start Failed';
  }
}

function runtimeLifecycleFailurePresentationTitle(
  location: DesktopRuntimeLifecycleLocation,
  maintenanceRequired: boolean,
  operation: DesktopRuntimeLifecycleOperation = 'start',
): string {
  if (maintenanceRequired) {
    return location === 'ssh_host' ? 'SSH Runtime Needs Attention' : 'Runtime Needs Attention';
  }
  const target = location === 'ssh_host'
    ? 'SSH Runtime'
    : location === 'local_container' || location === 'ssh_container'
      ? 'Container Runtime'
      : 'Runtime';
  switch (operation) {
    case 'stop':
      return `${target} Stop Failed`;
    case 'restart':
      return `${target} Restart Failed`;
    case 'update':
      return `${target} Update Failed`;
    default:
      return `${target} Start Failed`;
  }
}

function runtimeLifecycleFailureSummary(
  operation: DesktopRuntimeLifecycleOperation = 'start',
): string {
  switch (operation) {
    case 'stop':
      return 'Stop Runtime did not complete.';
    case 'restart':
      return 'Restart Runtime did not complete.';
    case 'update':
      return 'Update Runtime did not complete.';
    default:
      return 'Start Runtime did not complete.';
  }
}

function runtimeLifecycleFailureNextActions(
  operationKey: string,
  environmentID: string,
): readonly DesktopLauncherOperationNextAction[] {
  return [
    {
      kind: 'refresh_status',
      environment_id: compact(environmentID) || undefined,
      label: 'Refresh status',
    },
    {
      kind: 'copy_diagnostics',
      operation_key: operationKey,
      label: 'Copy log',
    },
    {
      kind: 'dismiss',
      operation_key: operationKey,
      label: 'Dismiss',
    },
  ];
}

function openConnectionFailureNextActions(
  operationKey: string,
  environmentID: string,
  options: Readonly<{
    includeUpdateRuntime?: boolean;
    includeDesktopUpdate?: boolean;
    desktopUpdateAvailable?: boolean;
  }> = {},
): readonly DesktopLauncherOperationNextAction[] {
  return [
    {
      kind: 'refresh_status',
      environment_id: compact(environmentID) || undefined,
      label: 'Refresh status',
    },
    ...(options.includeUpdateRuntime && compact(environmentID) !== '' ? [{
      kind: 'update_runtime' as const,
      environment_id: compact(environmentID),
      label: 'Update runtime',
    }] : []),
    ...(options.includeDesktopUpdate && options.desktopUpdateAvailable === true && compact(environmentID) !== '' ? [{
      kind: 'manage_desktop_update' as const,
      environment_id: compact(environmentID),
      label: 'Update Redeven Desktop',
    }] : []),
    {
      kind: 'copy_diagnostics',
      operation_key: operationKey,
      label: 'Copy log',
    },
    {
      kind: 'dismiss',
      operation_key: operationKey,
      label: 'Dismiss',
    },
  ];
}

function desktopUpdateHandoffAvailable(
  preferences: DesktopPreferences,
  environmentID: string,
): boolean {
  return Boolean(findLocalEnvironmentByID(preferences, environmentID));
}

function runtimeOpenFailureRecoveryActions(input: Readonly<{
  error?: unknown;
  failure?: DesktopOperationFailurePresentation;
  launcherFailure?: DesktopLauncherActionFailure | null;
  maintenance?: DesktopRuntimeMaintenanceRequirement | null;
  runtimeService?: RuntimeServiceSnapshot | null;
}>): Readonly<{
  includeUpdateRuntime: boolean;
  includeDesktopUpdate: boolean;
}> {
  const failureCode = input.failure?.code ?? input.launcherFailure?.failure?.code;
  if (failureCode === 'desktop_update_required') {
    return { includeUpdateRuntime: false, includeDesktopUpdate: true };
  }
  if (failureCode === 'runtime_update_required') {
    return { includeUpdateRuntime: true, includeDesktopUpdate: false };
  }
  if (input.maintenance?.recovery_action === 'update_runtime') {
    return { includeUpdateRuntime: true, includeDesktopUpdate: false };
  }
  const maintenance = input.error instanceof DesktopSSHRuntimeMaintenanceRequiredError
    ? input.error.maintenance
    : input.error instanceof RuntimePlacementMaintenanceRequiredError
      ? input.error.maintenance
      : null;
  if (maintenance?.recovery_action === 'update_runtime') {
    return { includeUpdateRuntime: true, includeDesktopUpdate: false };
  }
  return {
    includeUpdateRuntime: runtimeServiceNeedsRuntimeUpdate(input.runtimeService),
    includeDesktopUpdate: runtimeServiceNeedsDesktopUpdate(input.runtimeService),
  };
}

function assertRuntimeStopVerifiedFromLaunchReport(report: LaunchReport): void {
  if (report.status !== 'blocked') {
    throw new Error('Desktop could not stop the runtime because it still reports a ready daemon.');
  }
  const classification = classifyDesktopRuntimeBlockedLaunchReport(report, {
    target_runtime_version: resolveSSHRuntimeReleaseTag(),
  });
  if (classification.kind === 'stopped') {
    return;
  }
  if (classification.kind === 'unverified') {
    throw new Error(classification.message);
  }
  throw new Error(classification.maintenance.message);
}

async function assertContainerRuntimeStopped(input: Readonly<{
  executor: ReturnType<typeof runtimeHostExecutor>;
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>;
  runtimeBinaryPath: string;
  signal?: AbortSignal;
}>): Promise<void> {
  const statusResult = await input.executor.run(containerRuntimeDaemonStatusCommand({
    engine: input.placement.container_engine,
    container_id: input.placement.container_id,
    runtime_root: input.placement.runtime_root,
    runtime_binary_path: input.runtimeBinaryPath,
  }), { signal: input.signal });
  assertRuntimeStopVerifiedFromLaunchReport(parseLaunchReport(statusResult.stdout));
}

async function assertSSHRuntimeStopped(input: Readonly<{
  target: DesktopSSHEnvironmentDetails;
  runtimeReleaseTag: string;
  sshPassword?: string;
  connectTimeoutSeconds?: number;
  tempRoot: string;
  signal?: AbortSignal;
}>): Promise<void> {
  const statusProbe = await probeManagedSSHRuntimeStatus({
    target: input.target,
    runtimeReleaseTag: input.runtimeReleaseTag,
    sshPassword: input.sshPassword,
    connectTimeoutSeconds: input.connectTimeoutSeconds,
    tempRoot: input.tempRoot,
    signal: input.signal,
  });
  if (statusProbe.status === 'ready') {
    throw new Error('Desktop could not stop the SSH runtime because it still reports a ready daemon.');
  }
  if (statusProbe.status === 'failed') {
    throw new DesktopOperationFailureError(statusProbe.failure);
  }
  if (statusProbe.status === 'blocked') {
    assertRuntimeStopVerifiedFromLaunchReport(statusProbe.report);
  }
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

function desktopRuntimePackageCacheRoot(): string {
  return runtimePackageCacheRoot(app.getPath('userData'));
}

function desktopCodeWorkspaceEnginePackageCacheRoot(): string {
  return codeWorkspaceEnginePackageCacheRoot(app.getPath('userData'));
}

type DesktopCodeWorkspaceEnginePackagePlatform = Parameters<typeof prepareCodeWorkspaceEnginePackage>[0]['platform'];

type DesktopCodeWorkspaceEnginePackageJobRecord = Readonly<{
  jobID: string;
  archivePath: string;
  manifest: unknown;
  archiveSizeBytes: number;
  chunkSizeBytes: number;
  fromCache: boolean;
  createdAtMs: number;
}>;

const desktopCodeWorkspaceEnginePackageJobs = new Map<string, DesktopCodeWorkspaceEnginePackageJobRecord>();
const desktopCodeWorkspaceEnginePackageJobTTLMS = 30 * 60 * 1000;

function pruneDesktopCodeWorkspaceEnginePackageJobs(): void {
  const expiresBefore = Date.now() - desktopCodeWorkspaceEnginePackageJobTTLMS;
  for (const [jobID, job] of desktopCodeWorkspaceEnginePackageJobs.entries()) {
    if (job.createdAtMs < expiresBefore) {
      desktopCodeWorkspaceEnginePackageJobs.delete(jobID);
    }
  }
}

async function pruneDesktopRuntimePackageCacheForCurrentRelease(): Promise<void> {
  await pruneDesktopRuntimePackageCache({
    cacheRoot: desktopRuntimePackageCacheRoot(),
    activeReleaseTag: resolveSSHRuntimeReleaseTag(),
    legacyCacheRoots: legacyRuntimePackageCacheRoots(app.getPath('userData')),
  });
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
    runtime_root: input.runtime_root,
    bootstrap_strategy: input.bootstrap_strategy,
    release_base_url: input.release_base_url,
    connect_timeout_seconds: input.connect_timeout_seconds,
    environment_id: input.environmentID,
  }));
}

function savedSSHPasswordForDetails(
  preferences: DesktopPreferences,
  details: DesktopSSHEnvironmentDetails,
  environmentID?: string,
): string {
  if (details.auth_mode !== 'password') {
    return '';
  }
  const runtimeKey = desktopSSHEnvironmentID(details);
  const cleanEnvironmentID = compact(environmentID);
  const existing = preferences.saved_ssh_environments.find((environment) => (
    (cleanEnvironmentID !== '' && environment.id === cleanEnvironmentID)
    || environment.id === runtimeKey
  )) ?? null;
  return existing?.ssh_password_configured === true ? existing.ssh_password ?? '' : '';
}

function sshRuntimeMaintenanceFromStartup(
  startup: StartupReport,
  fallbackMessage: string,
): DesktopRuntimeMaintenanceRequirement {
  const runtimeService = startup.runtime_service;
  const needsUpdate = runtimeServiceNeedsRuntimeUpdate(runtimeService)
    || runtimeService?.open_readiness?.reason_code === 'runtime_update_required';
  const message = compact(runtimeService?.open_readiness?.message)
    || compact(runtimeService?.compatibility_message)
    || fallbackMessage;
  return buildDesktopRuntimeMaintenanceRequirement({
    kind: needsUpdate ? 'runtime_update_required' : 'runtime_restart_required',
    required_for: 'open',
    recovery_action: needsUpdate ? 'update_runtime' : 'restart_runtime',
    can_desktop_start: false,
    can_desktop_restart: Number.isInteger(startup.pid) && Number(startup.pid) > 0,
    has_active_work: runtimeServiceHasActiveWork(runtimeService),
    active_work_label: formatRuntimeServiceWorkload(runtimeService),
    current_runtime_version: runtimeService?.runtime_version,
    target_runtime_version: resolveSSHRuntimeReleaseTag(),
    message,
  });
}

async function startSSHEnvironmentRuntimeRecord(
  sshDetails: DesktopSSHEnvironmentDetails,
  options: Readonly<{
    environmentID?: string;
    label?: string;
    forceRuntimeUpdate?: boolean;
    allowActiveWorkReplacement?: boolean;
    action?: Extract<DesktopLauncherActionRequest['kind'], 'start_environment_runtime' | 'restart_environment_runtime' | 'update_environment_runtime'>;
  }> = {},
): Promise<SSHRuntimeReadyRecord> {
  const runtimeKey = sshDesktopSessionKey(sshDetails);
  const environmentID = compact(options.environmentID) || runtimeKey;
  const label = compact(options.label) || defaultSavedSSHEnvironmentLabel(sshDetails);
  const action = options.action ?? 'start_environment_runtime';
  const lifecycleOperation = runtimeLifecycleOperationFromAction(action);
  const activeWorkReplacementAllowed = options.allowActiveWorkReplacement === true
    || action === 'restart_environment_runtime'
    || action === 'update_environment_runtime'
    || options.forceRuntimeUpdate === true;
  const existingRecord = sshRuntimeReadyByKey.get(runtimeKey) ?? null;
  if (existingRecord) {
    const canKeepExistingRecord = options.forceRuntimeUpdate !== true
      && !activeWorkReplacementAllowed
      && action === 'start_environment_runtime'
      && desktopSSHRuntimeAffectingSettingsMatch(existingRecord.details, sshDetails);
    if (canKeepExistingRecord) {
      sshRuntimeMaintenanceByKey.delete(runtimeKey);
    } else {
      const openRecord = sshEnvironmentRuntimeByKey.get(runtimeKey) ?? null;
      await openRecord?.disconnect().catch(() => undefined);
      sshEnvironmentRuntimeByKey.delete(runtimeKey);
      await existingRecord.stop().catch(() => undefined);
      sshRuntimeReadyByKey.delete(runtimeKey);
    }
  }

  const pendingStart = pendingSSHRuntimeStartByKey.get(runtimeKey) ?? null;
  if (pendingStart) {
    return pendingStart.task;
  }

  const operation = launcherOperations.create({
    operation_key: runtimeKey,
    action,
    subject_kind: 'ssh_environment',
    subject_id: runtimeKey,
    environment_id: environmentID,
    environment_label: label,
    phase: 'ssh_preparing_start',
    title: runtimeLifecycleStartTitle(action),
    detail: 'Desktop is checking the SSH host and runtime service.',
    lifecycle_progress: buildRuntimeLifecycleProgress({
      hostAccess: { kind: 'ssh_host', ssh: sshDetails },
      placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
      operation: lifecycleOperation,
      phase: 'checking_host',
      targetID: runtimeKey,
      targetLabel: label,
    }),
    cancelable: true,
    interrupt_label: 'Stop startup',
    interrupt_detail: 'Desktop is stopping this runtime startup.',
    interrupt_kind: 'generic',
  });
  beginRuntimeLifecycleWorkflowAttempt(runtimeKey, {
    hostAccess: { kind: 'ssh_host', ssh: sshDetails },
    placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
    operation: lifecycleOperation,
    targetID: runtimeKey,
    targetLabel: label,
  });
  const lifecycleAttemptOwner = {
    action: operation.action,
    started_at_unix_ms: operation.started_at_unix_ms,
  };
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;

  const task = (async () => {
    let operationSettled = false;
    try {
      const preferences = await loadDesktopPreferencesCached();
      const sshPassword = savedSSHPasswordForDetails(preferences, sshDetails, environmentID);
      const statusProbe = await probeManagedSSHRuntimeStatus({
        target: sshDetails,
        runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
        sshPassword,
        tempRoot: app.getPath('temp'),
        connectTimeoutSeconds: typeof sshDetails.connect_timeout_seconds === 'number'
          ? sshDetails.connect_timeout_seconds
          : undefined,
        signal,
      });
      const workflowAfterProbe = runtimeLifecycleWorkflowForOperation(runtimeKey, lifecycleAttemptOwner, {
        hostAccess: { kind: 'ssh_host', ssh: sshDetails },
        placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
        operation: lifecycleOperation,
        targetID: runtimeKey,
        targetLabel: label,
      });
      workflowAfterProbe.completeThrough('checking_runtime_package');
      if (statusProbe.status === 'ready') {
        if (!runtimeServiceIsOpenable(statusProbe.startup.runtime_service) && !runtimeServiceAllowsOpenAttempt(statusProbe.startup.runtime_service)) {
          const maintenance = sshRuntimeMaintenanceFromStartup(
            statusProbe.startup,
            'This SSH runtime is running but cannot open with this Desktop yet.',
          );
          sshRuntimeMaintenanceByKey.set(runtimeKey, maintenance);
          if (
            action !== 'update_environment_runtime'
            || options.forceRuntimeUpdate !== true
            || !desktopRuntimeMaintenanceRequiresUpdate(maintenance)
          ) {
            throw new DesktopSSHRuntimeMaintenanceRequiredError(maintenance.message, maintenance);
          }
        }
        const replacingReadySSHRuntime = action === 'restart_environment_runtime'
          || action === 'update_environment_runtime'
          || options.forceRuntimeUpdate === true;
        if (replacingReadySSHRuntime) {
          commitRuntimeLifecycleDecision(runtimeKey, lifecycleAttemptOwner, {
            hostAccess: { kind: 'ssh_host', ssh: sshDetails },
            placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
            operation: lifecycleOperation,
            targetID: runtimeKey,
            targetLabel: label,
            decision: lifecycleOperation === 'update' ? 'runtime_update_required_running' : 'runtime_running',
          });
          const pid = statusProbe.startup.pid ?? 0;
          if (!Number.isInteger(pid) || pid <= 0) {
            throw new Error('Desktop cannot replace this SSH runtime because it did not report a process id.');
          }
          updateRuntimeLifecycleOperation(runtimeKey, lifecycleAttemptOwner, {
            hostAccess: { kind: 'ssh_host', ssh: sshDetails },
            placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
            operation: lifecycleOperation,
            phase: 'stopping_runtime_process',
            targetID: runtimeKey,
            targetLabel: label,
            title: 'Stopping SSH runtime',
            detail: 'Desktop is stopping the current SSH runtime before continuing.',
          });
          await stopManagedSSHRuntimeProcess({
            target: sshDetails,
            pid,
            sshPassword,
            tempRoot: app.getPath('temp'),
            connectTimeoutSeconds: typeof sshDetails.connect_timeout_seconds === 'number'
              ? sshDetails.connect_timeout_seconds
              : undefined,
            signal,
            onLog: (stream, chunk) => {
              const text = String(chunk ?? '').trim();
              if (text) {
                console.log(`[redeven:${stream}] ${text}`);
              }
            },
          });
          updateRuntimeLifecycleOperation(runtimeKey, lifecycleAttemptOwner, {
            hostAccess: { kind: 'ssh_host', ssh: sshDetails },
            placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
            operation: lifecycleOperation,
            phase: 'verifying_runtime_stopped',
            targetID: runtimeKey,
            targetLabel: label,
            title: 'Verifying runtime stopped',
            detail: 'Desktop is confirming that the previous SSH runtime is no longer running.',
          });
          await assertSSHRuntimeStopped({
            target: sshDetails,
            runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
            sshPassword,
            tempRoot: app.getPath('temp'),
            connectTimeoutSeconds: typeof sshDetails.connect_timeout_seconds === 'number'
              ? sshDetails.connect_timeout_seconds
              : undefined,
            signal,
          });
          sshRuntimeReadyByKey.delete(runtimeKey);
          sshRuntimeMaintenanceByKey.delete(runtimeKey);
        } else {
          const readyWorkflow = commitRuntimeLifecycleDecision(runtimeKey, lifecycleAttemptOwner, {
            hostAccess: { kind: 'ssh_host', ssh: sshDetails },
            placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
            operation: lifecycleOperation,
            targetID: runtimeKey,
            targetLabel: label,
            decision: lifecycleOperation === 'update' ? 'runtime_already_current' : 'existing_runtime_openable',
          });
          readyWorkflow.beginStep('checking_runtime_service', 'Desktop is verifying the existing SSH runtime service.');
          readyWorkflow.completeStep('checking_runtime_service');
          const attachedHandle: DesktopSessionRuntimeHandle = {
            runtime_kind: 'ssh',
            lifecycle_owner: 'external',
            launch_mode: 'attached',
            stop: async () => undefined,
          };
          const readyRecord: SSHRuntimeReadyRecord = {
            runtime_key: runtimeKey,
            environment_id: environmentID,
            label,
            details: sshDetails,
            startup: statusProbe.startup,
            runtime_handle: attachedHandle,
            disconnect: async () => undefined,
            stop: async () => undefined,
          };
          sshRuntimeReadyByKey.set(runtimeKey, readyRecord);
          sshRuntimeMaintenanceByKey.delete(runtimeKey);
          launcherOperations.finishCurrentAttempt(runtimeKey, lifecycleAttemptOwner, 'succeeded', {
            phase: 'runtime_ready',
            title: lifecycleOperation === 'update' ? 'Runtime up to date' : 'Runtime already running',
            detail: lifecycleOperation === 'update'
              ? 'Desktop verified that this SSH runtime already matches the current Desktop runtime package.'
              : 'Desktop found an openable SSH runtime and did not start a new process.',
            lifecycle_progress: completeRuntimeLifecycleWorkflowProgress(runtimeKey, lifecycleAttemptOwner, {
              hostAccess: { kind: 'ssh_host', ssh: sshDetails },
              placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
              operation: lifecycleOperation,
              phase: lifecycleOperation === 'update' ? 'runtime_up_to_date' : 'runtime_ready',
              targetID: runtimeKey,
              targetLabel: label,
              detail: lifecycleOperation === 'update'
                ? 'Desktop verified that this SSH runtime already matches the current Desktop runtime package.'
                : 'Desktop found an openable SSH runtime and did not start a new process.',
            }),
          });
          scheduleCurrentLauncherOperationRemoval(runtimeKey, lifecycleAttemptOwner);
          clearRuntimeLifecycleWorkflow(runtimeKey, lifecycleAttemptOwner);
          operationSettled = true;
          return readyRecord;
        }
      }
      if (statusProbe.status === 'blocked') {
        const classification = classifyDesktopRuntimeBlockedLaunchReport(statusProbe.report, {
          target_runtime_version: resolveSSHRuntimeReleaseTag(),
        });
        if (classification.kind === 'stopped') {
          sshRuntimeMaintenanceByKey.delete(runtimeKey);
        } else if (classification.kind === 'unverified') {
          throw new Error(classification.message);
        } else {
          const maintenance = classification.maintenance;
          sshRuntimeMaintenanceByKey.set(runtimeKey, maintenance);
          if (
            classification.kind === 'update_required'
            && options.forceRuntimeUpdate === true
          ) {
            commitRuntimeLifecycleDecision(runtimeKey, lifecycleAttemptOwner, {
              hostAccess: { kind: 'ssh_host', ssh: sshDetails },
              placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
              operation: lifecycleOperation,
              targetID: runtimeKey,
              targetLabel: label,
              decision: 'runtime_update_required_running',
            });
            // Continue into the Desktop-owned package replacement path below.
          } else if (!maintenance.can_desktop_restart) {
            throw new DesktopSSHRuntimeMaintenanceRequiredError(maintenance.message, maintenance);
          }
          if (classification.kind === 'restart_required') {
            commitRuntimeLifecycleDecision(runtimeKey, lifecycleAttemptOwner, {
              hostAccess: { kind: 'ssh_host', ssh: sshDetails },
              placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
              operation: lifecycleOperation,
              targetID: runtimeKey,
              targetLabel: label,
              decision: 'maintenance_restart_required',
            });
            const pid = maintenance.lock_pid ?? 0;
            updateRuntimeLifecycleOperation(runtimeKey, lifecycleAttemptOwner, {
              hostAccess: { kind: 'ssh_host', ssh: sshDetails },
              placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
              operation: lifecycleOperation,
              phase: 'stopping_runtime_process',
              targetID: runtimeKey,
              targetLabel: label,
              title: 'Restarting blocked SSH runtime',
              detail: 'Desktop is stopping the live runtime process that no longer exposes its management socket.',
            });
            await stopManagedSSHRuntimeProcess({
              target: sshDetails,
              pid,
              sshPassword,
              tempRoot: app.getPath('temp'),
              connectTimeoutSeconds: typeof sshDetails.connect_timeout_seconds === 'number'
                ? sshDetails.connect_timeout_seconds
                : undefined,
              signal,
              onLog: (stream, chunk) => {
                const text = String(chunk ?? '').trim();
                if (text) {
                  console.log(`[redeven:${stream}] ${text}`);
                }
              },
            });
            updateRuntimeLifecycleOperation(runtimeKey, lifecycleAttemptOwner, {
              hostAccess: { kind: 'ssh_host', ssh: sshDetails },
              placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
              operation: lifecycleOperation,
              phase: 'verifying_runtime_stopped',
              targetID: runtimeKey,
              targetLabel: label,
              title: 'Verifying runtime stopped',
              detail: 'Desktop is confirming that the blocked SSH runtime is no longer running.',
            });
            await assertSSHRuntimeStopped({
              target: sshDetails,
              runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
              sshPassword,
              tempRoot: app.getPath('temp'),
              connectTimeoutSeconds: typeof sshDetails.connect_timeout_seconds === 'number'
                ? sshDetails.connect_timeout_seconds
                : undefined,
              signal,
            });
          }
        }
      }
      if (statusProbe.status === 'failed') {
        throw new DesktopOperationFailureError(statusProbe.failure);
      }
      if (statusProbe.status === 'not_running') {
        commitRuntimeLifecycleDecision(runtimeKey, lifecycleAttemptOwner, {
          hostAccess: { kind: 'ssh_host', ssh: sshDetails },
          placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
          operation: lifecycleOperation,
          targetID: runtimeKey,
          targetLabel: label,
          decision: lifecycleOperation === 'update' ? 'runtime_update_required_stopped' : 'runtime_missing',
        });
      }
      const managedSSHRuntime = await ensureManagedSSHRuntimeReady({
        target: sshDetails,
        runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
        desktopOwnerID: await desktopRuntimeOwnerID(),
        sshPassword,
        sourceRuntimeRoot: process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT,
        forceRuntimeUpdate: options.forceRuntimeUpdate,
        allowActiveWorkReplacement: activeWorkReplacementAllowed,
        connectTimeoutSeconds: typeof sshDetails.connect_timeout_seconds === 'number'
          ? sshDetails.connect_timeout_seconds
          : undefined,
        tempRoot: app.getPath('temp'),
        assetCacheRoot: desktopRuntimePackageCacheRoot(),
        signal,
        onLog: (stream, chunk) => {
          const text = String(chunk ?? '').trim();
          if (!text) {
            return;
          }
          console.log(`[redeven:${stream}] ${text}`);
        },
        onProgress: (progress) => {
          updateRuntimeLifecycleOperation(runtimeKey, lifecycleAttemptOwner, {
            hostAccess: { kind: 'ssh_host', ssh: sshDetails },
            placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
            operation: lifecycleOperation,
            phase: sshRuntimeLifecyclePhase(progress.phase),
            targetID: runtimeKey,
            targetLabel: label,
            title: progress.title,
            detail: progress.detail,
          });
        },
      });
      if (launcherOperations.isStale(runtimeKey)) {
        const canceledProgress = currentRuntimeLifecycleWorkflowProgress(runtimeKey, lifecycleAttemptOwner, {
          hostAccess: { kind: 'ssh_host', ssh: sshDetails },
          placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
          operation: lifecycleOperation,
          targetID: runtimeKey,
          targetLabel: label,
        });
        launcherOperations.updateCurrentAttempt(runtimeKey, lifecycleAttemptOwner, {
          status: 'cleanup_running',
          phase: 'cleanup_deleted_connection',
          title: 'Connection removed',
          detail: 'Desktop is stopping the SSH runtime that finished after this connection was removed.',
          lifecycle_progress: canceledProgress,
          cancelable: false,
        });
        try {
          await managedSSHRuntime.stop();
          launcherOperations.finishCurrentAttempt(runtimeKey, lifecycleAttemptOwner, 'canceled', {
            phase: 'deleted_connection_cleaned',
            title: 'Startup canceled',
            detail: 'Desktop removed the connection and cleaned up the SSH startup task.',
            lifecycle_progress: canceledProgress,
            deleted_subject: true,
          });
          scheduleCurrentLauncherOperationRemoval(runtimeKey, lifecycleAttemptOwner);
          operationSettled = true;
        } catch (cleanupError) {
          const failure = desktopFailureFromError(cleanupError, {
            code: 'operation_failed',
            title: 'SSH Startup Cleanup Failed',
            summary: 'Desktop could not clean up this removed SSH startup task.',
            targetLabel: desktopSSHAuthority(sshDetails),
          });
          const workflowFailure = runtimeLifecycleWorkflowFailure(runtimeKey, lifecycleAttemptOwner, {
            hostAccess: { kind: 'ssh_host', ssh: sshDetails },
            placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
            operation: lifecycleOperation,
            targetID: runtimeKey,
            targetLabel: label,
            error: cleanupError,
            fallback: failure,
          });
          launcherOperations.finishCurrentAttempt(runtimeKey, lifecycleAttemptOwner, 'cleanup_failed', {
            phase: 'cleanup_failed',
            title: 'Connection removed; cleanup needs attention',
            detail: failure.summary,
            lifecycle_progress: optionalRuntimeLifecycleAttemptProgress(runtimeKey, lifecycleAttemptOwner)
              ?? canceledProgress,
            deleted_subject: true,
            failure: workflowFailure.step_failure.presentation,
          });
          operationSettled = true;
        }
        throw new DesktopSSHRuntimeCanceledError('SSH runtime startup was canceled because the connection was removed.');
      }
      const runtimeRecord: SSHRuntimeReadyRecord = {
        runtime_key: runtimeKey,
        environment_id: environmentID,
        label,
        details: sshDetails,
        startup: managedSSHRuntime.startup,
        runtime_handle: managedSSHRuntime.runtime_handle,
        disconnect: managedSSHRuntime.disconnect,
        stop: managedSSHRuntime.stop,
      };
      sshRuntimeReadyByKey.set(runtimeKey, runtimeRecord);
      sshRuntimeMaintenanceByKey.delete(runtimeKey);
      launcherOperations.finishCurrentAttempt(runtimeKey, lifecycleAttemptOwner, 'succeeded', {
        phase: 'ssh_runtime_started',
        title: 'SSH runtime ready',
        detail: 'The SSH runtime service is ready. Open will prepare the Desktop connection.',
        lifecycle_progress: completeRuntimeLifecycleWorkflowProgress(runtimeKey, lifecycleAttemptOwner, {
          hostAccess: { kind: 'ssh_host', ssh: sshDetails },
          placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
          operation: lifecycleOperation,
          phase: 'runtime_ready',
          targetID: runtimeKey,
          targetLabel: label,
          detail: 'The SSH runtime service is ready. Open will prepare the Desktop connection.',
        }),
      });
      scheduleCurrentLauncherOperationRemoval(runtimeKey, lifecycleAttemptOwner);
      operationSettled = true;
      return runtimeRecord;
    } catch (error) {
      if (!operationSettled) {
        if (error instanceof DesktopSSHRuntimeCanceledError || signal?.aborted) {
          const canceledProgress = currentRuntimeLifecycleWorkflowProgress(runtimeKey, lifecycleAttemptOwner, {
            hostAccess: { kind: 'ssh_host', ssh: sshDetails },
            placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
            operation: lifecycleOperation,
            targetID: runtimeKey,
            targetLabel: label,
          });
          launcherOperations.updateCurrentAttempt(runtimeKey, lifecycleAttemptOwner, {
            status: 'cleanup_running',
            phase: 'ssh_cleaning_startup_resources',
            title: 'Cleaning SSH startup resources',
            detail: 'Desktop is closing local startup resources for this SSH runtime.',
            lifecycle_progress: canceledProgress,
            cancelable: false,
          });
          launcherOperations.finishCurrentAttempt(runtimeKey, lifecycleAttemptOwner, 'canceled', {
            phase: canceledProgress.active_step_id,
            title: 'Startup canceled',
            detail: 'Desktop stopped the SSH runtime startup and cleaned up local startup resources.',
            lifecycle_progress: canceledProgress,
            deleted_subject: launcherOperations.get(runtimeKey)?.deleted_subject === true,
          });
          operationSettled = true;
        } else {
          if (error instanceof DesktopSSHRuntimeMaintenanceRequiredError) {
            sshRuntimeMaintenanceByKey.set(runtimeKey, error.maintenance);
          }
          const fallbackFailure = desktopFailureFromError(error, {
            code: 'ssh_runtime_launch_failed',
            title: error instanceof DesktopSSHRuntimeMaintenanceRequiredError
              ? runtimeLifecycleFailurePresentationTitle('ssh_host', true, lifecycleOperation)
              : runtimeLifecycleFailurePresentationTitle('ssh_host', false, lifecycleOperation),
            summary: error instanceof DesktopSSHRuntimeMaintenanceRequiredError
              ? 'Update or restart the SSH runtime from the Welcome page.'
              : runtimeLifecycleFailureSummary(lifecycleOperation),
            targetLabel: desktopSSHAuthority(sshDetails),
          });
          const workflowFailure = runtimeLifecycleWorkflowFailure(runtimeKey, lifecycleAttemptOwner, {
            hostAccess: { kind: 'ssh_host', ssh: sshDetails },
            placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
            operation: lifecycleOperation,
            targetID: runtimeKey,
            targetLabel: label,
            error,
            fallback: fallbackFailure,
          });
          const failure = workflowFailure.step_failure.presentation;
          const failurePhase = workflowFailure.step_failure.failed_step_id;
          launcherOperations.finishCurrentAttempt(runtimeKey, lifecycleAttemptOwner, 'failed', {
            phase: failurePhase,
            title: runtimeLifecycleTitleForFailure(
              'ssh_host',
              error instanceof DesktopSSHRuntimeMaintenanceRequiredError,
              lifecycleOperation,
            ),
            detail: failure.summary,
            lifecycle_progress: workflowFailure.lifecycle_progress,
            failure,
          });
          operationSettled = true;
        }
      }
      if (!operationSettled) {
        scheduleCurrentLauncherOperationRemoval(runtimeKey, lifecycleAttemptOwner);
      }
      throw error;
    } finally {
      pendingSSHRuntimeStartByKey.delete(runtimeKey);
      if (operationSettled) {
        clearRuntimeLifecycleWorkflow(runtimeKey, lifecycleAttemptOwner);
      }
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

async function syncLinkedProviderRuntimeHealthFromService(
  runtimeService: RuntimeServiceSnapshot | null | undefined,
): Promise<void> {
  const binding = runtimeServiceProviderLinkBinding(runtimeService);
  if (binding.state !== 'linked') {
    return;
  }
  const providerOrigin = compact(binding.provider_origin);
  const providerID = compact(binding.provider_id);
  const envPublicID = compact(binding.env_public_id);
  if (providerOrigin === '' || providerID === '' || envPublicID === '') {
    return;
  }
  try {
    await refreshProviderEnvironmentRuntimeHealth(providerOrigin, providerID, [envPublicID]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[redeven:provider-link] Provider runtime health sync failed for ${envPublicID}: ${message}`);
  }
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
    await Promise.all([
      refreshWelcomeRuntimeHealth().catch(() => {
        // Best-effort runtime health refresh should not interrupt launcher updates.
      }),
      refreshAllProviderEnvironmentRuntimeHealth().then(() => {
        broadcastDesktopWelcomeSnapshots();
      }).catch(() => {
        // Best-effort runtime health refresh should not interrupt launcher updates.
      }),
    ]);
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
    targetLabel?: string;
  }> = {},
): DesktopLauncherActionFailure {
  const summary = runtimeServiceOpenReadinessLabel(startup.runtime_service);
  const needsUpdate = runtimeServiceNeedsRuntimeUpdate(startup.runtime_service);
  const needsDesktopUpdate = runtimeServiceNeedsDesktopUpdate(startup.runtime_service);
  const failure = desktopOperationFailurePresentation({
    code: needsDesktopUpdate ? 'desktop_update_required' : needsUpdate ? 'runtime_update_required' : 'environment_open_failed',
    title: 'Open Failed',
    summary,
    targetLabel: options.targetLabel,
    detail: needsDesktopUpdate
      ? [
          `Installed runtime: ${startup.runtime_service?.runtime_version ?? 'unknown'}`,
          `Required Desktop: ${startup.runtime_service?.minimum_desktop_version ?? 'current Desktop'}`,
        ].join('\n')
      : needsUpdate
      ? [
          `Installed runtime: ${startup.runtime_service?.runtime_version ?? 'unknown'}`,
          `Required runtime: ${startup.runtime_service?.minimum_runtime_version ?? 'current Desktop runtime'}`,
        ].join('\n')
      : undefined,
    recoveryHint: needsDesktopUpdate
      ? 'Update Redeven Desktop, then try opening this environment again.'
      : needsUpdate
      ? 'Update runtime, then try opening this environment again.'
      : 'Start or restart the runtime, then try again.',
  });
  return launcherActionFailure(
    'runtime_not_ready',
    'environment',
    failure.summary,
    {
      ...options,
      shouldRefreshSnapshot: true,
      failure,
    },
  );
}

function launcherActionFailureForRuntimeHealthPreflight(
  health: DesktopRuntimeHealth | undefined,
  options: Readonly<{
    environmentID: string;
    targetLabel: string;
    maintenance?: DesktopRuntimeMaintenanceRequirement | null;
  }>,
): DesktopLauncherActionFailure {
  const maintenance = options.maintenance ?? health?.runtime_maintenance;
  const message = compact(maintenance?.message) || compact(health?.offline_reason)
    || 'Desktop could not verify this runtime before opening it.';
  const failure = desktopOperationFailurePresentation({
    code: 'environment_open_failed',
    title: 'Open Failed',
    summary: message,
    targetLabel: options.targetLabel,
    ...(maintenance?.message ? { detail: maintenance.message } : {}),
    ...(maintenance?.recovery_action === 'start_runtime' ? { recoveryHint: 'Start the runtime, then try again.' } : {}),
  });
  const code: DesktopLauncherActionFailureCode = (
    maintenance
    || health?.offline_reason_code === 'unverified'
    || health?.offline_reason_code === 'probe_failed'
  )
    ? 'runtime_not_ready'
    : 'runtime_not_started';
  return launcherActionFailure(
    code,
    'environment',
    failure.summary,
    {
      environmentID: options.environmentID,
      shouldRefreshSnapshot: true,
      failure,
    },
  );
}

function launcherActionFailureForRuntimeOpenPreflightMessage(
  code: DesktopLauncherActionFailureCode,
  message: string,
  options: Readonly<{
    environmentID: string;
    targetLabel: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
  }>,
): DesktopLauncherActionFailure {
  const summary = compact(message) || 'Desktop could not verify this runtime before opening it.';
  const failure = desktopOperationFailurePresentation({
    code: 'environment_open_failed',
    title: 'Open Failed',
    summary,
    targetLabel: options.targetLabel,
  });
  return launcherActionFailure(
    code,
    'environment',
    failure.summary,
    {
      environmentID: options.environmentID,
      providerOrigin: options.providerOrigin,
      providerID: options.providerID,
      envPublicID: options.envPublicID,
      shouldRefreshSnapshot: true,
      failure,
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
  const failure = desktopFailureFromError(error, {
    code: 'environment_open_failed',
    title: 'Open Failed',
    summary: 'Desktop could not open that environment.',
  });
  return launcherActionFailure(
    'action_invalid',
    'environment',
    failure.summary,
    {
      ...options,
      failure,
    },
  );
}

type LocalHostOpenTarget = Readonly<{
  environmentID: string;
  environmentLabel: string;
  hostAccess: Extract<DesktopRuntimeHostAccess, Readonly<{ kind: 'local_host' }>>;
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'host_process' }>>;
  targetID: DesktopRuntimeTargetID;
  targetLabel: string;
}>;

function localHostOpenTarget(environment: DesktopLocalEnvironmentState): LocalHostOpenTarget {
  const hostAccess: Extract<DesktopRuntimeHostAccess, Readonly<{ kind: 'local_host' }>> = { kind: 'local_host' };
  const placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'host_process' }>> = {
    kind: 'host_process',
    runtime_root: environment.local_hosting.state_dir,
  };
  return {
    environmentID: environment.id,
    environmentLabel: environment.label,
    hostAccess,
    placement,
    targetID: desktopRuntimeTargetID(hostAccess, placement, environment.id),
    targetLabel: environment.label,
  };
}

function localRuntimeHealthForOpenPreflight(environmentID: string): DesktopRuntimeHealth | undefined {
  return welcomeRuntimeHealthStore.snapshot().localRuntimeHealth[environmentID];
}

function localEnvironmentFailureContext(environment: DesktopLocalEnvironmentState): Readonly<{
  environmentID: string;
  providerOrigin?: string;
  providerID?: string;
  envPublicID?: string;
}> {
  return {
    environmentID: environment.id,
    providerOrigin: localEnvironmentProviderOrigin(environment),
    providerID: localEnvironmentProviderID(environment),
    envPublicID: localEnvironmentPublicID(environment),
  };
}

function finishLocalHostOpenFailure(
  operationKey: string,
  target: LocalHostOpenTarget,
  signal: AbortSignal | undefined,
  result: DesktopLauncherActionFailure,
  preferences: DesktopPreferences,
): DesktopLauncherActionFailure {
  launcherOperations.finish(operationKey, signal?.aborted ? 'canceled' : 'failed', {
    phase: signal?.aborted ? 'canceled' : 'failed',
    title: signal?.aborted ? 'Open canceled' : 'Open failed',
    detail: signal?.aborted ? 'Desktop canceled this open request.' : result.message,
    open_progress: buildOpenConnectionProgress({
      hostAccess: target.hostAccess,
      placement: target.placement,
      phase: signal?.aborted ? 'canceled' : 'failed',
      environmentID: target.environmentID,
      environmentLabel: target.environmentLabel,
      targetID: target.targetID,
      targetLabel: target.targetLabel,
    }),
    ...(signal?.aborted ? {} : { next_actions: openConnectionFailureNextActions(operationKey, target.environmentID, {
      ...runtimeOpenFailureRecoveryActions({
        failure: result.failure,
        launcherFailure: result,
      }),
      desktopUpdateAvailable: desktopUpdateHandoffAvailable(preferences, target.environmentID),
    }) }),
    ...(signal?.aborted || !result.failure ? {} : { failure: result.failure }),
  });
  scheduleLauncherOperationRemoval(operationKey);
  return result;
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

  const openTarget = localHostOpenTarget(environment);
  const operationKey = `${openTarget.targetID}:open`;
  const operation = launcherOperations.create({
    operation_key: operationKey,
    action: 'open_local_environment',
    subject_kind: 'local_environment',
    subject_id: environment.id,
    environment_id: environment.id,
    environment_label: environment.label,
    phase: 'checking_runtime_record',
    title: 'Checking runtime status',
    detail: 'Desktop is checking the runtime status before opening this environment.',
    open_progress: buildOpenConnectionProgress({
      hostAccess: openTarget.hostAccess,
      placement: openTarget.placement,
      phase: 'checking_runtime_record',
      environmentID: openTarget.environmentID,
      environmentLabel: openTarget.environmentLabel,
      targetID: openTarget.targetID,
      targetLabel: openTarget.targetLabel,
    }),
    cancelable: true,
    interrupt_label: 'Stop opening',
    interrupt_detail: 'Desktop is stopping this open request before opening the local environment window.',
    interrupt_kind: 'stop_opening',
  });
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
  const failureContext = localEnvironmentFailureContext(environment);
  let runtimeRecord: LocalEnvironmentRuntimeRecord | null = null;
  let sessionRecord: DesktopSessionRecord | null = null;

  try {
    runtimeRecord = await attachLocalEnvironmentRuntime(environment);
    if (!runtimeRecord) {
      updateOpenConnectionOperation(operationKey, {
        hostAccess: openTarget.hostAccess,
        placement: openTarget.placement,
        phase: 'checking_runtime_record',
        environmentID: openTarget.environmentID,
        environmentLabel: openTarget.environmentLabel,
        targetID: openTarget.targetID,
        targetLabel: openTarget.targetLabel,
        title: 'Checking runtime status',
        detail: 'Desktop is checking the runtime status before opening this environment.',
      });
      await refreshWelcomeRuntimeHealthForEnvironment(environment.id);
      runtimeRecord = await attachLocalEnvironmentRuntime(environment);
      if (!runtimeRecord) {
        const result = launcherActionFailureForRuntimeHealthPreflight(
          localRuntimeHealthForOpenPreflight(environment.id),
          {
            environmentID: environment.id,
            targetLabel: environment.label,
          },
        );
        return finishLocalHostOpenFailure(operationKey, openTarget, signal, result, preferences);
      }
    }

    const ownerID = await desktopRuntimeOwnerID();
    const runtimePlan = buildDesktopLocalRuntimeOpenPlan(
      { kind: 'local_environment' },
      runtimeRecord.startup,
      {
        desktopOwnerID: ownerID,
      },
    );
    if (runtimePlan.requires_restart || !runtimePlan.can_open) {
      const result = launcherActionFailureForRuntimeOpenPreflightMessage(
        'runtime_not_ready',
        runtimePlan.message,
        {
          ...failureContext,
          targetLabel: environment.label,
        },
      );
      return finishLocalHostOpenFailure(operationKey, openTarget, signal, result, preferences);
    }

    updateOpenConnectionOperation(operationKey, {
      hostAccess: openTarget.hostAccess,
      placement: openTarget.placement,
      phase: 'checking_env_app_readiness',
      environmentID: openTarget.environmentID,
      environmentLabel: openTarget.environmentLabel,
      targetID: openTarget.targetID,
      targetLabel: openTarget.targetLabel,
      title: 'Checking app readiness',
      detail: 'Desktop is checking whether the local Env App is ready to open.',
    });
    if (!runtimeServiceIsOpenable(runtimeRecord.startup.runtime_service)) {
      const result = launcherActionFailureForRuntimeNotOpenable(runtimeRecord.startup, {
        ...failureContext,
        targetLabel: environment.label,
      });
      return finishLocalHostOpenFailure(operationKey, openTarget, signal, result, preferences);
    }

    updateOpenConnectionOperation(operationKey, {
      hostAccess: openTarget.hostAccess,
      placement: openTarget.placement,
      phase: 'opening_window',
      environmentID: openTarget.environmentID,
      environmentLabel: openTarget.environmentLabel,
      targetID: openTarget.targetID,
      targetLabel: openTarget.targetLabel,
      title: 'Opening environment',
      detail: 'Desktop is opening the local Env App window.',
    });
    sessionRecord = await createSessionRecord(target, runtimeRecord.startup, {
      runtimeHandle: runtimeRecord.runtime_handle,
      attached: runtimeRecord.runtime_handle.launch_mode === 'attached',
      stealAppFocus: options.stealAppFocus !== false,
    });
    await waitForSessionInitialLoad(sessionRecord);
  } catch (error) {
    const result = launcherActionFailureFromSessionOpenError(error, failureContext);
    return finishLocalHostOpenFailure(operationKey, openTarget, signal, result, preferences);
  }
  resetLauncherIssueState();
  await persistDesktopPreferences(rememberLocalEnvironmentUse(preferences, environment.id, 'local_host'));
  launcherOperations.finish(operationKey, 'succeeded', {
    phase: 'open_ready',
    title: 'Environment open',
    detail: 'Desktop opened this environment.',
    open_progress: buildOpenConnectionProgress({
      hostAccess: openTarget.hostAccess,
      placement: openTarget.placement,
      phase: 'open_ready',
      environmentID: openTarget.environmentID,
      environmentLabel: openTarget.environmentLabel,
      targetID: openTarget.targetID,
      targetLabel: openTarget.targetLabel,
    }),
  });
  scheduleLauncherOperationRemoval(operationKey);
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

  const operationKey = `${target.session_key}:open`;
  const operation = launcherOperations.create({
    operation_key: operationKey,
    action: 'open_provider_environment',
    subject_kind: 'provider_environment',
    subject_id: environment.id,
    environment_id: environment.id,
    environment_label: environment.label,
    provider_origin: environment.provider_origin,
    provider_id: environment.provider_id,
    phase: 'checking_runtime_record',
    title: 'Checking provider route',
    detail: 'Desktop is checking the provider route before opening this environment.',
    open_progress: buildOpenConnectionProgress({
      hostAccess: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '' },
      phase: 'checking_runtime_record',
      environmentID: environment.id,
      environmentLabel: environment.label,
      targetID: target.session_key,
      targetLabel: environment.label,
      targetDetail: 'Provider route',
      location: 'provider_remote',
    }),
    cancelable: true,
    interrupt_label: 'Stop opening',
    interrupt_detail: 'Desktop is stopping this provider open request before opening the environment window.',
    interrupt_kind: 'stop_opening',
  });
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;

  try {
    launcherOperations.update(operationKey, {
      phase: 'opening_window',
      title: 'Opening environment',
      detail: 'Desktop is opening the provider environment window.',
      open_progress: buildOpenConnectionProgress({
        hostAccess: { kind: 'local_host' },
        placement: { kind: 'host_process', runtime_root: '' },
        phase: 'opening_window',
        environmentID: environment.id,
        environmentLabel: environment.label,
        targetID: target.session_key,
        targetLabel: environment.label,
        targetDetail: 'Provider route',
        location: 'provider_remote',
      }),
    });
    const sessionRecord = await createSessionRecord(
      target,
      remoteManagedSessionStartup(args.remoteSessionURL),
      { stealAppFocus: args.stealAppFocus !== false },
    );
    await waitForSessionInitialLoad(sessionRecord);
  } catch (error) {
    const failure = desktopFailureFromError(error, {
      code: 'environment_open_failed',
      title: 'Open Failed',
      summary: 'Desktop could not open this provider environment.',
      targetLabel: environment.label,
    });
    launcherOperations.finish(operationKey, signal?.aborted ? 'canceled' : 'failed', {
      phase: signal?.aborted ? 'canceled' : 'failed',
      title: signal?.aborted ? 'Open canceled' : 'Open failed',
      detail: signal?.aborted ? 'Desktop canceled this open request.' : failure.summary,
      open_progress: buildOpenConnectionProgress({
        hostAccess: { kind: 'local_host' },
        placement: { kind: 'host_process', runtime_root: '' },
        phase: signal?.aborted ? 'canceled' : 'failed',
        environmentID: environment.id,
        environmentLabel: environment.label,
        targetID: target.session_key,
        targetLabel: environment.label,
        targetDetail: 'Provider route',
        location: 'provider_remote',
      }),
      ...(signal?.aborted ? {} : { next_actions: openConnectionFailureNextActions(operationKey, environment.id, {
        ...runtimeOpenFailureRecoveryActions({ failure }),
        desktopUpdateAvailable: desktopUpdateHandoffAvailable(preferences, environment.id),
      }) }),
      ...(signal?.aborted ? {} : { failure }),
    });
    scheduleLauncherOperationRemoval(operationKey);
    return launcherActionFailure(
      'action_invalid',
      'environment',
      failure.summary,
      {
        environmentID: environment.id,
        providerOrigin: environment.provider_origin,
        providerID: environment.provider_id,
        envPublicID: environment.env_public_id,
        shouldRefreshSnapshot: true,
        failure,
      },
    );
  }
  resetLauncherIssueState();
  await persistDesktopPreferences(rememberProviderEnvironmentUse(preferences, environment.id));
  launcherOperations.finish(operationKey, 'succeeded', {
    phase: 'open_ready',
    title: 'Environment open',
    detail: 'Desktop opened this provider environment.',
    open_progress: buildOpenConnectionProgress({
      hostAccess: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '' },
      phase: 'open_ready',
      environmentID: environment.id,
      environmentLabel: environment.label,
      targetID: target.session_key,
      targetLabel: environment.label,
      targetDetail: 'Provider route',
      location: 'provider_remote',
    }),
  });
  scheduleLauncherOperationRemoval(operationKey);
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

  const operationKey = `${optimisticSessionKey}:open`;
  const operation = launcherOperations.create({
    operation_key: operationKey,
    action: 'open_remote_environment',
    subject_kind: 'external_local_ui',
    subject_id: optimisticSessionKey,
    environment_id: request.environment_id ?? optimisticSessionKey,
    environment_label: request.label ?? normalizedTargetURL,
    phase: 'checking_runtime_record',
    title: 'Checking local UI target',
    detail: 'Desktop is checking the target before opening this Redeven URL.',
    open_progress: buildOpenConnectionProgress({
      hostAccess: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '' },
      phase: 'checking_runtime_record',
      environmentID: request.environment_id ?? optimisticSessionKey,
      environmentLabel: request.label ?? normalizedTargetURL,
      targetID: optimisticSessionKey,
      targetLabel: request.label ?? normalizedTargetURL,
      targetDetail: normalizedTargetURL,
      location: 'external_local_ui',
    }),
    cancelable: true,
    interrupt_label: 'Stop opening',
    interrupt_detail: 'Desktop is stopping this open request before opening the Redeven URL window.',
    interrupt_kind: 'stop_opening',
  });
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
  const preferences = await loadDesktopPreferencesCached();
  const failureEnvironmentID = request.environment_id ?? optimisticSessionKey;
  const finishRemoteOpenFailure = (result: DesktopLauncherActionFailure): DesktopLauncherActionFailure => {
    const canceled = signal?.aborted === true;
    launcherOperations.finish(operationKey, canceled ? 'canceled' : 'failed', {
      phase: canceled ? 'canceled' : 'failed',
      title: canceled ? 'Open canceled' : 'Open failed',
      detail: canceled ? 'Desktop canceled this open request.' : result.message,
      open_progress: buildOpenConnectionProgress({
        hostAccess: { kind: 'local_host' },
        placement: { kind: 'host_process', runtime_root: '' },
        phase: canceled ? 'canceled' : 'failed',
        environmentID: failureEnvironmentID,
        environmentLabel: request.label ?? normalizedTargetURL,
        targetID: optimisticSessionKey,
        targetLabel: request.label ?? normalizedTargetURL,
        targetDetail: normalizedTargetURL,
        location: 'external_local_ui',
      }),
      ...(canceled ? {} : { next_actions: openConnectionFailureNextActions(operationKey, failureEnvironmentID, {
        ...runtimeOpenFailureRecoveryActions({
          failure: result.failure,
          launcherFailure: result,
        }),
        desktopUpdateAvailable: desktopUpdateHandoffAvailable(preferences, failureEnvironmentID),
      }) }),
      ...(canceled || !result.failure ? {} : { failure: result.failure }),
    });
    scheduleLauncherOperationRemoval(operationKey);
    return result;
  };

  const prepared = await prepareExternalTarget(normalizedTargetURL);
  if (!prepared.ok) {
    finishRemoteOpenFailure(launcherActionFailure(
      'environment_route_unavailable',
      'environment',
      prepared.issue.message,
      {
        environmentID: failureEnvironmentID,
        shouldRefreshSnapshot: true,
        failure: desktopFailureFromError(prepared.issue.message, {
          code: 'environment_open_failed',
          title: 'Open Failed',
          summary: prepared.issue.message,
          targetLabel: request.label ?? normalizedTargetURL,
        }),
      },
    ));
    if (signal?.aborted) {
      return launcherActionSuccess('canceled_launcher_operation');
    }
    return openUtilityWindow('launcher', {
      entryReason: prepared.entryReason,
      issue: prepared.issue,
      stealAppFocus: true,
    });
  }
  if (!runtimeServiceIsOpenable(prepared.startup.runtime_service)) {
    const result = launcherActionFailureForRuntimeNotOpenable(prepared.startup, {
      environmentID: request.environment_id,
      targetLabel: request.label,
    });
    return finishRemoteOpenFailure(result);
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
    launcherOperations.finish(operationKey, 'succeeded', {
      phase: 'open_ready',
      title: 'Environment open',
      detail: 'Desktop opened this Redeven URL window.',
      open_progress: buildOpenConnectionProgress({
        hostAccess: { kind: 'local_host' },
        placement: { kind: 'host_process', runtime_root: '' },
        phase: 'open_ready',
        environmentID: request.environment_id ?? optimisticSessionKey,
        environmentLabel: request.label ?? normalizedTargetURL,
        targetID: optimisticSessionKey,
        targetLabel: request.label ?? normalizedTargetURL,
        targetDetail: normalizedTargetURL,
        location: 'external_local_ui',
      }),
    });
    scheduleLauncherOperationRemoval(operationKey);
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }

  try {
    launcherOperations.update(operationKey, {
      phase: 'opening_window',
      title: 'Opening environment',
      detail: 'Desktop is opening the Redeven URL window.',
      open_progress: buildOpenConnectionProgress({
        hostAccess: { kind: 'local_host' },
        placement: { kind: 'host_process', runtime_root: '' },
        phase: 'opening_window',
        environmentID: request.environment_id ?? optimisticSessionKey,
        environmentLabel: request.label ?? normalizedTargetURL,
        targetID: optimisticSessionKey,
        targetLabel: request.label ?? normalizedTargetURL,
        targetDetail: normalizedTargetURL,
        location: 'external_local_ui',
      }),
    });
    const sessionRecord = await createSessionRecord(target, prepared.startup, { stealAppFocus: true });
    await waitForSessionInitialLoad(sessionRecord);
  } catch (error) {
    const result = launcherActionFailureFromSessionOpenError(error, {
      environmentID: request.environment_id,
    });
    return finishRemoteOpenFailure(result);
  }
  resetLauncherIssueState();
  await markSavedExternalTargetUsed(target.environment_id, prepared.startup.local_ui_url);
  launcherOperations.finish(operationKey, 'succeeded', {
    phase: 'open_ready',
    title: 'Environment open',
    detail: 'Desktop opened this Redeven URL window.',
    open_progress: buildOpenConnectionProgress({
      hostAccess: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '' },
      phase: 'open_ready',
      environmentID: request.environment_id ?? optimisticSessionKey,
      environmentLabel: request.label ?? normalizedTargetURL,
      targetID: optimisticSessionKey,
      targetLabel: request.label ?? normalizedTargetURL,
      targetDetail: normalizedTargetURL,
      location: 'external_local_ui',
    }),
  });
  scheduleLauncherOperationRemoval(operationKey);
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
    runtime_root: request.runtime_root,
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

  let readyRecord: SSHRuntimeReadyRecord | null = null;
  let existingRuntimeRecord = await verifySSHEnvironmentRuntimeRecord(optimisticSessionKey);

  const target = buildSSHDesktopTarget(sshDetails, {
    environmentID: request.environment_id,
    label: request.label,
    forwardedLocalUIURL: existingRuntimeRecord?.local_forward_url ?? 'http://127.0.0.1/',
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
  const operationKey = `${optimisticSessionKey}:open`;
  const operation = launcherOperations.create({
    operation_key: operationKey,
    action: 'open_ssh_environment',
    subject_kind: 'ssh_environment',
    subject_id: optimisticSessionKey,
    environment_id: request.environment_id,
    environment_label: request.label,
    phase: 'checking_runtime_record',
    title: 'Checking runtime status',
    detail: 'Desktop is checking the runtime status before opening this environment.',
    open_progress: buildOpenConnectionProgress({
      hostAccess: { kind: 'ssh_host', ssh: sshDetails },
      placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
      phase: 'checking_runtime_record',
      environmentID: request.environment_id ?? optimisticSessionKey,
      environmentLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
      targetID: optimisticSessionKey,
      targetLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
    }),
    cancelable: true,
    interrupt_label: 'Stop opening',
    interrupt_detail: 'Desktop is stopping this open request and closing local SSH resources already created.',
    interrupt_kind: 'stop_opening',
  });
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
  let runtimeRecord = existingRuntimeRecord;
  let desktopModelSource: ManagedDesktopModelSource | null = null;
  let preferences: DesktopPreferences | null = null;
  try {
    preferences = await loadDesktopPreferencesCached();
    const sshPassword = savedSSHPasswordForDetails(preferences, sshDetails, request.environment_id);
    if (!runtimeRecord) {
      await refreshWelcomeRuntimeHealthForEnvironment(request.environment_id ?? optimisticSessionKey);
      readyRecord = sshRuntimeReadyByKey.get(optimisticSessionKey) ?? null;
      if (!readyRecord) {
        const health = savedSSHRuntimeHealthForOpenPreflight(request.environment_id ?? optimisticSessionKey, optimisticSessionKey);
        const maintenance = sshRuntimeMaintenanceByKey.get(optimisticSessionKey) ?? health?.runtime_maintenance;
        const result = launcherActionFailureForRuntimeHealthPreflight(health, {
          environmentID: request.environment_id ?? optimisticSessionKey,
          targetLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
          maintenance,
        });
        launcherOperations.finish(operationKey, signal?.aborted ? 'canceled' : 'failed', {
          phase: signal?.aborted ? 'canceled' : 'failed',
          title: signal?.aborted ? 'Open canceled' : 'Open failed',
          detail: signal?.aborted ? 'Desktop canceled this open request.' : result.message,
          open_progress: buildOpenConnectionProgress({
            hostAccess: { kind: 'ssh_host', ssh: sshDetails },
            placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
            phase: signal?.aborted ? 'canceled' : 'failed',
            environmentID: request.environment_id ?? optimisticSessionKey,
            environmentLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
            targetID: optimisticSessionKey,
            targetLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
          }),
          ...(signal?.aborted ? {} : { next_actions: openConnectionFailureNextActions(operationKey, request.environment_id ?? optimisticSessionKey, {
            ...runtimeOpenFailureRecoveryActions({
              failure: result.failure,
              launcherFailure: result,
              maintenance,
            }),
            desktopUpdateAvailable: desktopUpdateHandoffAvailable(preferences, request.environment_id ?? optimisticSessionKey),
          }) }),
          ...(signal?.aborted || !result.failure ? {} : { failure: result.failure }),
        });
        scheduleLauncherOperationRemoval(operationKey);
        return result;
      }
      updateOpenConnectionOperation(operationKey, {
        hostAccess: { kind: 'ssh_host', ssh: sshDetails },
        placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
        phase: 'opening_ssh_control',
        environmentID: request.environment_id ?? optimisticSessionKey,
        environmentLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
        targetID: optimisticSessionKey,
        targetLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
        title: 'Opening SSH connection',
        detail: 'Desktop is establishing the local SSH connection for this open request.',
      });
      const managedSSHRuntime = await openManagedSSHRuntimeConnection({
        target: sshDetails,
        ready: readyRecord!,
        sshPassword,
        connectTimeoutSeconds: typeof sshDetails.connect_timeout_seconds === 'number'
          ? sshDetails.connect_timeout_seconds
          : undefined,
        tempRoot: app.getPath('temp'),
        signal,
        onLog: (stream, chunk) => {
          const text = String(chunk ?? '').trim();
          if (text) {
            console.log(`[redeven:${stream}] ${text}`);
          }
        },
        onProgress: (progress) => {
          const openPhase: DesktopOpenConnectionPhase = progress.phase === 'ssh_opening_tunnel'
            ? 'opening_local_tunnel'
            : progress.phase === 'ssh_verifying_tunnel'
              ? 'checking_env_app_readiness'
              : progress.phase === 'ssh_connecting_model_source'
                ? 'connecting_desktop_model_source'
                : 'ensuring_runtime_ready';
          updateOpenConnectionOperation(operationKey, {
            hostAccess: { kind: 'ssh_host', ssh: sshDetails },
            placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
            phase: openPhase,
            environmentID: request.environment_id ?? optimisticSessionKey,
            environmentLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
            targetID: optimisticSessionKey,
            targetLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
            title: progress.title,
            detail: progress.detail,
          });
        },
      });
      updateOpenConnectionOperation(operationKey, {
        hostAccess: { kind: 'ssh_host', ssh: sshDetails },
        placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
        phase: 'connecting_desktop_model_source',
        environmentID: request.environment_id ?? optimisticSessionKey,
        environmentLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
        targetID: optimisticSessionKey,
        targetLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
        title: 'Connecting Desktop model source',
        detail: 'Desktop is preparing local model access for this SSH runtime.',
      });
      desktopModelSource = await startDesktopModelSourceForStartup({
        label: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
        startup: managedSSHRuntime.startup,
        signal,
      });
      const managedStartup = desktopModelSource
        ? await refreshStartupReportFromLocalUI(managedSSHRuntime.startup, managedSSHRuntime.local_forward_url)
        : managedSSHRuntime.startup;
      runtimeRecord = {
        runtime_key: optimisticSessionKey,
        environment_id: request.environment_id ?? optimisticSessionKey,
        label: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
        details: sshDetails,
        startup: managedStartup,
        local_forward_url: managedSSHRuntime.local_forward_url,
        runtime_control_forward_url: managedSSHRuntime.runtime_control_forward_url,
        desktop_model_source: desktopModelSource,
        runtime_handle: managedSSHRuntime.runtime_handle,
        disconnect: async () => {
          await managedSSHRuntime.disconnect();
          await desktopModelSource?.stop();
        },
        stop: async () => {
          await managedSSHRuntime.stop();
          await desktopModelSource?.stop();
        },
      };
      sshEnvironmentRuntimeByKey.set(optimisticSessionKey, runtimeRecord);
    }
    if (!runtimeServiceIsOpenable(runtimeRecord.startup.runtime_service)) {
      throw launcherActionFailureForRuntimeNotOpenable(runtimeRecord.startup, {
        environmentID: request.environment_id,
        targetLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
      });
    }
    const openTarget = buildSSHDesktopTarget(sshDetails, {
      environmentID: request.environment_id,
      label: request.label,
      forwardedLocalUIURL: runtimeRecord.local_forward_url,
    });
    updateOpenConnectionOperation(operationKey, {
      hostAccess: { kind: 'ssh_host', ssh: sshDetails },
      placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
      phase: 'opening_window',
      environmentID: openTarget.environment_id,
      environmentLabel: openTarget.label,
      targetID: optimisticSessionKey,
      targetLabel: openTarget.label,
      title: 'Opening environment',
      detail: 'Desktop is opening the Env App window.',
    });
    sessionRecord = await createSessionRecord(openTarget, runtimeRecord.startup, {
      runtimeHandle: runtimeRecord.runtime_handle,
      stealAppFocus: true,
    });
    await waitForSessionInitialLoad(sessionRecord);
  } catch (error) {
    await desktopModelSource?.stop().catch(() => undefined);
    if (!existingRuntimeRecord) {
      await runtimeRecord?.disconnect().catch(() => undefined);
      sshEnvironmentRuntimeByKey.delete(optimisticSessionKey);
    }
    const failure = desktopFailureFromError(error, {
      code: 'environment_open_failed',
      title: 'Open Failed',
      summary: 'Desktop could not open this SSH environment.',
      targetLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
    });
    launcherOperations.finish(operationKey, signal?.aborted ? 'canceled' : 'failed', {
      phase: signal?.aborted ? 'canceled' : 'failed',
      title: signal?.aborted ? 'Open canceled' : 'Open failed',
      detail: signal?.aborted ? 'Desktop canceled this open request.' : failure.summary,
      open_progress: buildOpenConnectionProgress({
        hostAccess: { kind: 'ssh_host', ssh: sshDetails },
        placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
        phase: signal?.aborted ? 'canceled' : 'failed',
        environmentID: request.environment_id ?? optimisticSessionKey,
        environmentLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
        targetID: optimisticSessionKey,
        targetLabel: request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails),
      }),
      ...(signal?.aborted ? {} : { next_actions: openConnectionFailureNextActions(operationKey, request.environment_id ?? optimisticSessionKey, {
        ...runtimeOpenFailureRecoveryActions({ error, failure }),
        desktopUpdateAvailable: preferences ? desktopUpdateHandoffAvailable(preferences, request.environment_id ?? optimisticSessionKey) : false,
      }) }),
      ...(signal?.aborted ? {} : { failure }),
    });
    scheduleLauncherOperationRemoval(operationKey);
    return launcherActionFailureFromSessionOpenError(error, {
      environmentID: request.environment_id,
    });
  }
  resetLauncherIssueState();
  await markSavedSSHTargetUsed({
    ...sshDetails,
    environmentID: sessionRecord.target.environment_id,
  });
  launcherOperations.finish(operationKey, 'succeeded', {
    phase: 'open_ready',
    title: 'Environment open',
    detail: 'Desktop opened this SSH environment.',
    open_progress: buildOpenConnectionProgress({
      hostAccess: { kind: 'ssh_host', ssh: sshDetails },
      placement: { kind: 'host_process', runtime_root: sshDetails.runtime_root },
      phase: 'open_ready',
      environmentID: sessionRecord.target.environment_id,
      environmentLabel: sessionRecord.target.label,
      targetID: optimisticSessionKey,
      targetLabel: sessionRecord.target.label,
    }),
  });
  scheduleLauncherOperationRemoval(operationKey);
  return launcherActionSuccess('opened_environment_window', {
    sessionKey: sessionRecord.session_key,
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
  Readonly<{ kind: 'start_environment_runtime' | 'restart_environment_runtime' | 'update_environment_runtime' | 'stop_environment_runtime' | 'refresh_environment_runtime' }>
>;

type DesktopLauncherOpenRuntimeTargetRequest = Extract<
  DesktopLauncherActionRequest,
  Readonly<{ kind: 'open_local_environment' | 'open_ssh_environment' }>
>;

type DesktopLauncherAnyRuntimeTargetRequest = DesktopLauncherRuntimeTargetRequest | DesktopLauncherOpenRuntimeTargetRequest;

function sshDetailsFromRuntimeTargetRequest(
  request: DesktopLauncherRuntimeTargetRequest,
): DesktopSSHEnvironmentDetails | null {
  if (request.host_access?.kind === 'ssh_host') {
    if (request.placement?.kind === 'container_process') {
      return null;
    }
    return normalizeDesktopSSHEnvironmentDetails({
      ...request.host_access.ssh,
      runtime_root: request.placement?.kind === 'host_process' ? request.placement.runtime_root : request.runtime_root,
      bootstrap_strategy: request.placement?.kind === 'host_process' ? request.placement.bootstrap_strategy : request.bootstrap_strategy,
      release_base_url: request.placement?.kind === 'host_process' ? request.placement.release_base_url : request.release_base_url,
    });
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
    runtime_root: request.runtime_root,
    bootstrap_strategy: request.bootstrap_strategy,
    release_base_url: request.release_base_url,
    connect_timeout_seconds: request.connect_timeout_seconds,
  });
}

function sshDetailsFromRuntimePlacement(
  hostAccess: Extract<DesktopRuntimeHostAccess, Readonly<{ kind: 'ssh_host' }>>,
  placement: DesktopRuntimePlacement,
): DesktopSSHEnvironmentDetails {
  return normalizeDesktopSSHEnvironmentDetails({
    ...hostAccess.ssh,
    runtime_root: placement.runtime_root || DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
    bootstrap_strategy: placement.kind === 'host_process'
      ? placement.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY
      : DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
    release_base_url: placement.kind === 'host_process'
      ? placement.release_base_url ?? DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL
      : DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  });
}

function runtimeHostAccessFromRequest(
  request: DesktopLauncherAnyRuntimeTargetRequest,
): DesktopRuntimeHostAccess {
  if (request.host_access) {
    return request.host_access;
  }
  const sshDetails = 'ssh_destination' in request ? sshDetailsFromRuntimeTargetRequest(request as DesktopLauncherRuntimeTargetRequest) : null;
  return sshDetails ? { kind: 'ssh_host', ssh: sshDetails } : { kind: 'local_host' };
}

function runtimePlacementFromRequest(
  request: DesktopLauncherAnyRuntimeTargetRequest,
): DesktopRuntimePlacement {
  return request.placement ?? { kind: 'host_process', runtime_root: '' };
}

function runtimeTargetIDFromRequest(
  request: DesktopLauncherAnyRuntimeTargetRequest,
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
  request: DesktopLauncherAnyRuntimeTargetRequest,
): string {
  return compact(request.label) || compact(request.environment_id) || 'Runtime';
}

function runtimeTargetEnvironmentIDFromRequest(
  request: DesktopLauncherAnyRuntimeTargetRequest,
): string {
  return compact(request.environment_id) || runtimeTargetIDFromRequest(request);
}

function runtimeLifecycleOperationFromAction(
  action: DesktopLauncherActionRequest['kind'],
): DesktopRuntimeLifecycleOperation {
  switch (action) {
    case 'restart_environment_runtime':
      return 'restart';
    case 'update_environment_runtime':
      return 'update';
    case 'stop_environment_runtime':
      return 'stop';
    default:
      return 'start';
  }
}

function runtimeLifecycleStartTitle(action: DesktopLauncherRuntimeTargetRequest['kind']): string {
  switch (action) {
    case 'restart_environment_runtime':
      return 'Restarting runtime';
    case 'update_environment_runtime':
      return 'Updating runtime';
    default:
      return 'Starting runtime';
  }
}

function runtimeLifecycleSuccessOutcome(
  action: DesktopLauncherRuntimeTargetRequest['kind'],
): Extract<DesktopLauncherActionSuccess['outcome'], 'started_environment_runtime' | 'restarted_environment_runtime' | 'updated_environment_runtime'> {
  switch (action) {
    case 'restart_environment_runtime':
      return 'restarted_environment_runtime';
    case 'update_environment_runtime':
      return 'updated_environment_runtime';
    default:
      return 'started_environment_runtime';
  }
}

function runtimePlacementBridgeRecordForRequest(
  request: DesktopLauncherAnyRuntimeTargetRequest,
): RuntimePlacementBridgeRecord | null {
  const placement = runtimePlacementFromRequest(request);
  if (placement.kind !== 'container_process') {
    return null;
  }
  return runtimePlacementBridgeByTargetID.get(runtimeTargetIDFromRequest(request)) ?? null;
}

async function assertRuntimeTargetContainerRunning(
  hostAccess: DesktopRuntimeHostAccess,
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
): Promise<Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>> {
  const resolution = await resolveRuntimeContainerPlacement(runtimeContainerResolver(hostAccess), placement);
  if (resolution.status === 'running') {
    return resolution.placement;
  }
  throw new Error(resolution.message);
}

async function ensureRuntimePlacementReadyRecordFromLauncher(
  request: DesktopLauncherRuntimeTargetRequest,
): Promise<RuntimePlacementReadyRecord> {
  const hostAccess = runtimeHostAccessFromRequest(request);
  let placement = runtimePlacementFromRequest(request);
  if (placement.kind !== 'container_process') {
    throw new Error('Runtime Placement Bridge requires a container runtime target.');
  }
  const targetID = runtimeTargetIDFromRequest(request);
  const lifecycleOperation = runtimeLifecycleOperationFromAction(request.kind);
  const replacementRequested = request.kind === 'restart_environment_runtime'
    || request.kind === 'update_environment_runtime'
    || request.force_runtime_update === true;
  const pendingStart = pendingRuntimePlacementStartByTargetID.get(targetID) ?? null;
  if (pendingStart) {
    return pendingStart.task;
  }

  const environmentID = runtimeTargetEnvironmentIDFromRequest(request);
  const label = runtimeTargetLabelFromRequest(request);
  const initialProgress = buildRuntimeLifecycleProgress({
    hostAccess,
    placement,
    operation: lifecycleOperation,
    phase: hostAccess.kind === 'ssh_host' ? 'checking_host' : 'checking_container',
    targetID,
    targetLabel: label,
  });
  const operation = launcherOperations.create({
    operation_key: targetID,
    action: request.kind,
    subject_kind: 'runtime_target',
    subject_id: targetID,
    environment_id: environmentID,
    environment_label: label,
    phase: initialProgress.phase,
    title: hostAccess.kind === 'ssh_host'
      ? `${runtimeLifecycleStartTitle(request.kind)} in SSH container`
      : `${runtimeLifecycleStartTitle(request.kind)} in container`,
    detail: hostAccess.kind === 'ssh_host'
      ? 'Desktop is checking the SSH host and selected running container.'
      : 'Desktop is checking the selected running container.',
    lifecycle_progress: initialProgress,
    cancelable: true,
    interrupt_label: 'Stop startup',
    interrupt_detail: 'Desktop is stopping this runtime startup.',
    interrupt_kind: 'generic',
  });
  beginRuntimeLifecycleWorkflowAttempt(targetID, {
    hostAccess,
    placement,
    operation: lifecycleOperation,
    targetID,
    targetLabel: label,
  });
  const lifecycleAttemptOwner = {
    action: operation.action,
    started_at_unix_ms: operation.started_at_unix_ms,
  };
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
  const preferences = await loadDesktopPreferencesCached();

  const task = (async () => {
    let operationSettled = false;
    try {
      const savedTarget = preferences.saved_runtime_targets.find((target) => target.id === targetID) ?? null;
      const sshPassword = savedTarget?.ssh_password_configured === true
        ? savedTarget.ssh_password ?? ''
        : compact(request.ssh_password);
      const inspection = await inspectRuntimePlacementTargetState({
        targetID,
        environmentID,
        label,
        hostAccess,
        placement,
        sshPassword,
        signal,
      });
      if (inspection.placement?.kind === 'container_process') {
        placement = inspection.placement;
      }
      let inspectionMaintenance = runtimePlacementMaintenanceByTargetID.get(targetID) ?? inspection.maintenance;
      if (inspectionMaintenance && desktopRuntimeMaintenanceRequiresRestart(inspectionMaintenance)) {
        commitRuntimeLifecycleDecision(targetID, lifecycleAttemptOwner, {
          hostAccess,
          placement,
          operation: lifecycleOperation,
          targetID,
          targetLabel: label,
          decision: 'maintenance_restart_required',
        });
        updateRuntimeLifecycleOperation(targetID, lifecycleAttemptOwner, {
          hostAccess,
          placement,
          operation: lifecycleOperation,
          phase: 'stopping_runtime_process',
          targetID,
          targetLabel: label,
          title: 'Stopping runtime process',
          detail: 'Desktop is stopping the live runtime process before continuing.',
        });
        const executor = runtimeHostExecutor(hostAccess, sshPassword || undefined);
        const runtimeBinaryPath = inspection.binary_path ?? 'redeven';
        await executor.run(containerRuntimeDaemonStopCommand({
          engine: placement.container_engine,
          container_id: placement.container_id,
          runtime_root: placement.runtime_root,
          runtime_binary_path: runtimeBinaryPath,
        }), { signal });
        updateRuntimeLifecycleOperation(targetID, lifecycleAttemptOwner, {
          hostAccess,
          placement,
          operation: lifecycleOperation,
          phase: 'verifying_runtime_stopped',
          targetID,
          targetLabel: label,
          title: 'Verifying runtime stopped',
          detail: 'Desktop is confirming that the live runtime is no longer running.',
        });
        await assertContainerRuntimeStopped({
          executor,
          placement,
          runtimeBinaryPath,
          signal,
        });
        runtimePlacementMaintenanceByTargetID.delete(targetID);
        inspectionMaintenance = undefined;
      }
      if (inspection.ready_record && replacementRequested) {
        commitRuntimeLifecycleDecision(targetID, lifecycleAttemptOwner, {
          hostAccess,
          placement,
          operation: lifecycleOperation,
          targetID,
          targetLabel: label,
          decision: lifecycleOperation === 'update' ? 'runtime_update_required_running' : 'runtime_running',
        });
        updateRuntimeLifecycleOperation(targetID, lifecycleAttemptOwner, {
          hostAccess,
          placement,
          operation: lifecycleOperation,
          phase: 'stopping_runtime_process',
          targetID,
          targetLabel: label,
          title: 'Stopping runtime process',
          detail: 'Desktop is stopping the current runtime before continuing.',
        });
        const liveRuntimeSession = liveSession(desktopSessionKeyFromRuntimeTargetID(targetID));
        if (liveRuntimeSession) {
          await finalizeSessionClosure(liveRuntimeSession.session_key);
        }
        const bridgeRecord = runtimePlacementBridgeByTargetID.get(targetID) ?? null;
        await bridgeRecord?.desktop_model_source?.stop().catch(() => undefined);
        await bridgeRecord?.session.disconnect().catch(() => undefined);
        const executor = runtimeHostExecutor(hostAccess, sshPassword || undefined);
        const runtimeBinaryPath = inspection.ready_record.runtime_binary_path ?? inspection.binary_path ?? 'redeven';
        await executor.run(containerRuntimeDaemonStopCommand({
          engine: placement.container_engine,
          container_id: placement.container_id,
          runtime_root: placement.runtime_root,
          runtime_binary_path: runtimeBinaryPath,
        }), { signal });
        updateRuntimeLifecycleOperation(targetID, lifecycleAttemptOwner, {
          hostAccess,
          placement,
          operation: lifecycleOperation,
          phase: 'verifying_runtime_stopped',
          targetID,
          targetLabel: label,
          title: 'Verifying runtime stopped',
          detail: 'Desktop is confirming that the current runtime is no longer running.',
        });
        await assertContainerRuntimeStopped({
          executor,
          placement,
          runtimeBinaryPath,
          signal,
        });
        runtimePlacementBridgeByTargetID.delete(targetID);
        runtimePlacementReadyByTargetID.delete(targetID);
        runtimePlacementMaintenanceByTargetID.delete(targetID);
        inspectionMaintenance = undefined;
      } else if (inspection.ready_record) {
        const readyWorkflow = commitRuntimeLifecycleDecision(targetID, lifecycleAttemptOwner, {
          hostAccess,
          placement,
          operation: lifecycleOperation,
          targetID,
          targetLabel: label,
          decision: lifecycleOperation === 'update' ? 'runtime_already_current' : 'existing_runtime_openable',
        });
        readyWorkflow.completeThrough('checking_runtime_service');
        launcherOperations.finishCurrentAttempt(targetID, lifecycleAttemptOwner, 'succeeded', {
          phase: 'runtime_ready',
          title: lifecycleOperation === 'update' ? 'Runtime up to date' : 'Runtime already running',
          detail: lifecycleOperation === 'update'
            ? 'Desktop verified that this container runtime already matches the current Desktop runtime package.'
            : 'Desktop found an openable runtime in the container and did not start a new process.',
          lifecycle_progress: completeRuntimeLifecycleWorkflowProgress(targetID, lifecycleAttemptOwner, {
            hostAccess,
            placement,
            operation: lifecycleOperation,
            phase: lifecycleOperation === 'update' ? 'runtime_up_to_date' : 'runtime_ready',
            targetID,
            targetLabel: label,
            detail: lifecycleOperation === 'update'
              ? 'Desktop verified that this container runtime already matches the current Desktop runtime package.'
              : 'Desktop found an openable runtime in the container and did not start a new process.',
          }),
        });
        scheduleCurrentLauncherOperationRemoval(targetID, lifecycleAttemptOwner);
        clearRuntimeLifecycleWorkflow(targetID, lifecycleAttemptOwner);
        operationSettled = true;
        return inspection.ready_record;
      }
      if (
        inspectionMaintenance
        && !desktopRuntimeMaintenanceIsStaleLock(inspectionMaintenance)
        && !(request.kind === 'update_environment_runtime' && desktopRuntimeMaintenanceRequiresUpdate(inspectionMaintenance))
      ) {
        throw new RuntimePlacementMaintenanceRequiredError(inspectionMaintenance.message, inspectionMaintenance);
      }
      const runtimeControlStatus = inspection.runtime_control_status;
      if (inspection.runtime_target_available !== true || (
        runtimeControlStatus.state === 'missing'
        && runtimeControlStatus.reason_code === 'unverified'
      )) {
        throw new Error(runtimeControlStatus.state === 'missing'
          ? runtimeControlStatus.message
          : 'Desktop could not verify the selected container runtime before starting.');
      }
      if (!runtimePlacementReadyByTargetID.has(targetID)) {
        commitRuntimeLifecycleDecision(targetID, lifecycleAttemptOwner, {
          hostAccess,
          placement,
          operation: lifecycleOperation,
          targetID,
          targetLabel: label,
          decision: lifecycleOperation === 'update' ? 'runtime_update_required_stopped' : 'runtime_missing',
        });
      }
      let readyPlacement: Awaited<ReturnType<typeof ensureRuntimePlacementReady>>;
      try {
        readyPlacement = await ensureRuntimePlacementReady({
          host_access: hostAccess,
          placement,
          ssh_password: sshPassword,
          runtime_release_tag: resolveSSHRuntimeReleaseTag(),
          release_base_url: PUBLIC_REDEVEN_RELEASE_BASE_URL,
          source_runtime_root: process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT,
          asset_cache_root: desktopRuntimePackageCacheRoot(),
          force_runtime_update: request.force_runtime_update === true,
          timeout_ms: 45_000,
          desktop_owner_id: await desktopRuntimeOwnerID(),
          signal,
          on_progress: (progress: RuntimePlacementProgress) => {
            updateRuntimeLifecycleOperation(targetID, lifecycleAttemptOwner, {
              hostAccess,
              placement,
              operation: lifecycleOperation,
              phase: runtimeLifecyclePhaseFromPlacement(progress.phase),
              targetID,
              targetLabel: label,
              title: progress.title,
              detail: progress.detail,
            });
          },
        });
        runtimePlacementMaintenanceByTargetID.delete(targetID);
      } catch (error) {
        if (error instanceof RuntimePlacementMaintenanceRequiredError) {
          runtimePlacementMaintenanceByTargetID.set(targetID, error.maintenance);
        }
        throw error;
      }
      const readyRecord: RuntimePlacementReadyRecord = {
        runtime_key: targetID,
        environment_id: environmentID,
        label,
        target_id: providerRuntimeLinkTargetIDForRuntimeTarget(hostAccess, targetID),
        host_access: hostAccess,
        placement,
        runtime_binary_path: readyPlacement.runtime_binary_path,
        startup: readyPlacement.startup,
      };
      runtimePlacementReadyByTargetID.set(targetID, readyRecord);
      runtimePlacementMaintenanceByTargetID.delete(targetID);
      launcherOperations.finishCurrentAttempt(targetID, lifecycleAttemptOwner, 'succeeded', {
        phase: 'runtime_ready',
        title: 'Runtime ready',
        detail: 'The runtime daemon is running. Open will prepare the Desktop bridge.',
        lifecycle_progress: completeRuntimeLifecycleWorkflowProgress(targetID, lifecycleAttemptOwner, {
          hostAccess,
          placement,
          operation: lifecycleOperation,
          phase: 'runtime_ready',
          targetID,
          targetLabel: label,
          detail: 'The runtime daemon is running. Open will prepare the Desktop bridge.',
        }),
      });
      scheduleCurrentLauncherOperationRemoval(targetID, lifecycleAttemptOwner);
      operationSettled = true;
      return readyRecord;
    } catch (error) {
      if (!operationSettled) {
        if (signal?.aborted) {
          const currentDeleted = launcherOperations.get(targetID)?.deleted_subject === true;
          const canceledProgress = currentRuntimeLifecycleWorkflowProgress(targetID, lifecycleAttemptOwner, {
            hostAccess,
            placement,
            operation: lifecycleOperation,
            targetID,
            targetLabel: label,
          });
          launcherOperations.finishCurrentAttempt(targetID, lifecycleAttemptOwner, 'canceled', {
            phase: canceledProgress.active_step_id,
            title: 'Startup canceled',
            detail: 'Desktop stopped the container runtime startup and cleaned up local startup resources.',
            lifecycle_progress: canceledProgress,
            deleted_subject: currentDeleted,
          });
          operationSettled = true;
        } else {
          const launcherFailure = thrownLauncherActionFailure(error);
          const location = desktopRuntimeLifecycleLocation(hostAccess, placement);
          const fallbackFailure = launcherFailure?.failure ?? desktopOperationFailurePresentation({
            code: 'container_runtime_launch_failed',
            title: runtimeLifecycleFailurePresentationTitle(location, false, lifecycleOperation),
            summary: launcherFailure?.message || runtimeLifecycleFailureSummary(lifecycleOperation),
            targetLabel: label,
          });
          const workflowFailure = runtimeLifecycleWorkflowFailure(targetID, lifecycleAttemptOwner, {
            hostAccess,
            placement,
            operation: lifecycleOperation,
            targetID,
            targetLabel: label,
            error,
            fallback: fallbackFailure,
          });
          const failure = workflowFailure.step_failure.presentation;
          const failurePhase = workflowFailure.step_failure.failed_step_id;
          launcherOperations.finishCurrentAttempt(targetID, lifecycleAttemptOwner, 'failed', {
            phase: failurePhase,
            title: runtimeLifecycleTitleForFailure(
              location,
              error instanceof RuntimePlacementMaintenanceRequiredError || launcherFailure?.code === 'runtime_not_ready',
              lifecycleOperation,
            ),
            detail: failure.summary,
            lifecycle_progress: workflowFailure.lifecycle_progress,
            failure,
          });
          operationSettled = true;
        }
      }
      if (!operationSettled) {
        scheduleCurrentLauncherOperationRemoval(targetID, lifecycleAttemptOwner);
      }
      throw error;
    } finally {
      pendingRuntimePlacementStartByTargetID.delete(targetID);
      if (operationSettled) {
        clearRuntimeLifecycleWorkflow(targetID, lifecycleAttemptOwner);
      }
    }
  })();
  pendingRuntimePlacementStartByTargetID.set(targetID, {
    target_id: targetID,
    environment_id: environmentID,
    label,
    operation_key: targetID,
    task,
  });
  return task;
}

async function openRuntimePlacementBridgeFromLauncher(
  request: DesktopLauncherOpenRuntimeTargetRequest,
): Promise<DesktopLauncherActionResult | null> {
  const hostAccess = runtimeHostAccessFromRequest(request);
  let placement = runtimePlacementFromRequest(request);
  if (placement.kind !== 'container_process') {
    return null;
  }
  const targetID = runtimeTargetIDFromRequest(request);
  const environmentID = runtimeTargetEnvironmentIDFromRequest(request);
  const label = runtimeTargetLabelFromRequest(request);
  await refreshWelcomeRuntimeHealthForEnvironment(environmentID);
  const existingBridge = runtimePlacementBridgeByTargetID.get(targetID) ?? null;
  let readyRecord = runtimePlacementReadyByTargetID.get(targetID) ?? null;
  const target = (readyRecord?.host_access ?? existingBridge?.session.host_access ?? hostAccess).kind === 'ssh_host'
    ? buildSSHDesktopTarget(sshDetailsFromRuntimePlacement(
        (readyRecord?.host_access ?? existingBridge?.session.host_access ?? hostAccess) as Extract<DesktopRuntimeHostAccess, Readonly<{ kind: 'ssh_host' }>>,
        readyRecord?.placement ?? existingBridge?.session.placement ?? placement,
      ), {
        environmentID,
        label,
        forwardedLocalUIURL: existingBridge?.startup.local_ui_url ?? readyRecord?.startup?.local_ui_url ?? 'http://127.0.0.1/',
        sessionKeyOverride: desktopSessionKeyFromRuntimeTargetID(targetID) as `ssh:${string}`,
      })
    : buildManagedLocalRuntimeDesktopTarget(environmentID, label);
  const existingSession = liveSession(target.session_key);
  if (existingSession) {
    if (existingSession.lifecycle === 'opening') {
      return launcherActionFailureForOpeningSession(existingSession, {
        environmentID,
      });
    }
    focusEnvironmentSession(existingSession.session_key, { stealAppFocus: true });
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }
  const operationKey = `${targetID}:open`;
  const operation = launcherOperations.create({
    operation_key: operationKey,
    action: 'open_local_environment',
    subject_kind: 'runtime_target',
    subject_id: targetID,
    environment_id: environmentID,
    environment_label: label,
    phase: 'checking_runtime_record',
    title: 'Checking runtime status',
    detail: 'Desktop is checking the runtime status before opening this environment.',
    open_progress: buildOpenConnectionProgress({
      hostAccess,
      placement,
      phase: 'checking_runtime_record',
      environmentID,
      environmentLabel: label,
      targetID,
      targetLabel: label,
    }),
    cancelable: true,
    interrupt_label: 'Stop opening',
    interrupt_detail: 'Desktop is stopping this open request and closing local connection resources already created.',
    interrupt_kind: 'stop_opening',
  });
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
  const preferences = await loadDesktopPreferencesCached();
  let desktopModelSource: ManagedDesktopModelSource | null = null;
  let bridgeSession: RuntimePlacementBridgeSession | null = null;
  let sessionRecord: DesktopSessionRecord | null = null;
  let record = existingBridge;
  try {
    if (!record) {
      if (!readyRecord) {
        updateOpenConnectionOperation(operationKey, {
          hostAccess,
          placement,
          phase: 'checking_runtime_record',
          environmentID,
          environmentLabel: label,
          targetID,
          targetLabel: label,
          title: 'Checking runtime status',
          detail: 'Desktop is checking the runtime status before opening this environment.',
        });
        if (!readyRecord) {
          const health = savedRuntimeTargetHealthForOpenPreflight(environmentID, targetID);
          const maintenance = runtimePlacementMaintenanceByTargetID.get(targetID) ?? health?.runtime_maintenance;
          const result = launcherActionFailureForRuntimeHealthPreflight(health, {
            environmentID,
            targetLabel: label,
            maintenance,
          });
          launcherOperations.finish(operationKey, signal?.aborted ? 'canceled' : 'failed', {
            phase: signal?.aborted ? 'canceled' : 'failed',
            title: signal?.aborted ? 'Open canceled' : 'Open failed',
            detail: signal?.aborted ? 'Desktop canceled this open request.' : result.message,
            open_progress: buildOpenConnectionProgress({
              hostAccess,
              placement,
              phase: signal?.aborted ? 'canceled' : 'failed',
              environmentID,
              environmentLabel: label,
              targetID,
              targetLabel: label,
            }),
            ...(signal?.aborted ? {} : { next_actions: openConnectionFailureNextActions(operationKey, environmentID, {
              ...runtimeOpenFailureRecoveryActions({
                failure: result.failure,
                launcherFailure: result,
                maintenance,
              }),
              desktopUpdateAvailable: desktopUpdateHandoffAvailable(preferences, environmentID),
            }) }),
            ...(signal?.aborted || !result.failure ? {} : { failure: result.failure }),
          });
          scheduleLauncherOperationRemoval(operationKey);
          return result;
        }
      }
      const runtimeBinaryPath = readyRecord!.runtime_binary_path;
      placement = readyRecord!.placement;
      const savedTarget = preferences.saved_runtime_targets.find((target) => target.id === targetID) ?? null;
      const sshPassword = savedTarget?.ssh_password_configured === true ? savedTarget.ssh_password ?? '' : compact(request.ssh_password);
      updateOpenConnectionOperation(operationKey, {
        hostAccess,
        placement,
        phase: 'starting_container_bridge',
        environmentID,
        environmentLabel: label,
        targetID,
        targetLabel: label,
        title: 'Opening container bridge',
        detail: 'Desktop is opening the secure bridge into this running container.',
      });
      bridgeSession = await startRuntimePlacementBridgeSession({
        host_access: hostAccess,
        placement,
        runtime_binary_path: runtimeBinaryPath,
        desktop_owner_id: await desktopRuntimeOwnerID(),
        ssh_password: sshPassword,
        fallback_local_id: environmentID,
        signal,
      });
      updateOpenConnectionOperation(operationKey, {
        hostAccess,
        placement,
        phase: 'connecting_desktop_model_source',
        environmentID,
        environmentLabel: label,
        targetID,
        targetLabel: label,
        title: 'Connecting Desktop model source',
        detail: 'Desktop is preparing local model access for this container runtime.',
      });
      const nextRecord = bridgeRecordFromSession({
        environmentID,
        label,
        session: bridgeSession,
        runtimeBinaryPath,
      });
      desktopModelSource = await startDesktopModelSourceForStartup({
        label: nextRecord.label,
        startup: nextRecord.startup,
        signal,
      });
      const startup = desktopModelSource
        ? await refreshStartupReportFromLocalUI(nextRecord.startup, nextRecord.startup.local_ui_url)
        : nextRecord.startup;
      record = {
        ...nextRecord,
        startup,
        desktop_model_source: desktopModelSource,
      };
      runtimePlacementBridgeByTargetID.set(bridgeSession.placement_target_id, record);
    }
    if (!runtimeServiceIsOpenable(record.startup.runtime_service)) {
      throw launcherActionFailureForRuntimeNotOpenable(record.startup, {
        environmentID: record.environment_id,
        targetLabel: record.label,
      });
    }
    updateOpenConnectionOperation(operationKey, {
      hostAccess: record.session.host_access,
      placement: record.session.placement,
      phase: 'opening_window',
      environmentID: record.environment_id,
      environmentLabel: record.label,
      targetID,
      targetLabel: record.label,
      title: 'Opening environment',
      detail: 'Desktop is opening the Env App window.',
    });
    const openTarget = record.session.host_access.kind === 'ssh_host'
      ? buildSSHDesktopTarget(sshDetailsFromRuntimePlacement(
          record.session.host_access,
          record.session.placement,
        ), {
          environmentID: record.environment_id,
          label: record.label,
          forwardedLocalUIURL: record.startup.local_ui_url,
          sessionKeyOverride: desktopSessionKeyFromRuntimeTargetID(targetID) as `ssh:${string}`,
        })
      : target;
    sessionRecord = await createSessionRecord(openTarget, record.startup, {
      runtimeHandle: record.runtime_handle,
      stealAppFocus: true,
    });
    await waitForSessionInitialLoad(sessionRecord);
  } catch (error) {
    await desktopModelSource?.stop().catch(() => undefined);
    await bridgeSession?.disconnect().catch(() => undefined);
    if (bridgeSession) {
      runtimePlacementBridgeByTargetID.delete(bridgeSession.placement_target_id);
    }
    const failure = desktopFailureFromError(error, {
      code: 'environment_open_failed',
      title: 'Open Failed',
      summary: 'Desktop could not open this environment.',
      targetLabel: label,
    });
    launcherOperations.finish(operationKey, signal?.aborted ? 'canceled' : 'failed', {
      phase: signal?.aborted ? 'canceled' : 'failed',
      title: signal?.aborted ? 'Open canceled' : 'Open failed',
      detail: signal?.aborted ? 'Desktop canceled this open request.' : failure.summary,
      open_progress: buildOpenConnectionProgress({
        hostAccess,
        placement,
        phase: signal?.aborted ? 'canceled' : 'failed',
        environmentID,
        environmentLabel: label,
        targetID,
        targetLabel: label,
      }),
      ...(signal?.aborted ? {} : { next_actions: openConnectionFailureNextActions(operationKey, environmentID, {
        ...runtimeOpenFailureRecoveryActions({ error, failure }),
        desktopUpdateAvailable: desktopUpdateHandoffAvailable(preferences, environmentID),
      }) }),
      ...(signal?.aborted ? {} : { failure }),
    });
    scheduleLauncherOperationRemoval(operationKey);
    return launcherActionFailureFromSessionOpenError(error, {
      environmentID,
    });
  }
  resetLauncherIssueState();
  await persistDesktopPreferences(markSavedRuntimeTargetUsed(preferences, {
    environment_id: record!.session.placement_target_id,
    host_access: record!.session.host_access,
    placement: record!.session.placement,
  }));
  launcherOperations.finish(operationKey, 'succeeded', {
    phase: 'open_ready',
    title: 'Environment open',
    detail: 'Desktop opened this environment.',
    open_progress: buildOpenConnectionProgress({
      hostAccess: record!.session.host_access,
      placement: record!.session.placement,
      phase: 'open_ready',
      environmentID: record!.environment_id,
      environmentLabel: record!.label,
      targetID,
      targetLabel: record!.label,
    }),
  });
  scheduleLauncherOperationRemoval(operationKey);
  return launcherActionSuccess('opened_environment_window', {
    sessionKey: sessionRecord!.session_key,
  });
}

async function runEnvironmentRuntimeLifecycleFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'start_environment_runtime' | 'restart_environment_runtime' | 'update_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const lifecycleOperation = runtimeLifecycleOperationFromAction(request.kind);
  const requestedPlacement = runtimePlacementFromRequest(request);
  if (requestedPlacement.kind === 'container_process') {
    try {
      const runtimeRecord = await ensureRuntimePlacementReadyRecordFromLauncher(request);
      resetLauncherIssueState();
      await persistDesktopPreferences(markSavedRuntimeTargetUsed(preferences, {
        environment_id: runtimeRecord.runtime_key,
        host_access: runtimeRecord.host_access,
        placement: runtimeRecord.placement,
      }));
      broadcastDesktopWelcomeSnapshots();
      return launcherActionSuccess(runtimeLifecycleSuccessOutcome(request.kind));
    } catch (error) {
      return thrownLauncherActionFailure(error)
        ?? launcherActionFailureFromRuntimeStartError(error, {
          environmentID: runtimeTargetEnvironmentIDFromRequest(request),
          operation: lifecycleOperation,
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
        action: request.kind,
      });
      resetLauncherIssueState();
      await markSavedSSHTargetUsed({
        ...runtimeRecord.details,
        environmentID: runtimeRecord.environment_id,
      });
      void syncLinkedProviderRuntimeHealthFromService(runtimeRecord.startup.runtime_service)
        .finally(() => broadcastDesktopWelcomeSnapshots())
        .catch(() => undefined);
      broadcastDesktopWelcomeSnapshots();
      return launcherActionSuccess(runtimeLifecycleSuccessOutcome(request.kind));
    } catch (error) {
      return launcherActionFailureFromRuntimeStartError(error, {
        environmentID: request.environment_id,
        operation: lifecycleOperation,
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

  const hostAccess: DesktopRuntimeHostAccess = { kind: 'local_host' };
  const localHostPlacement: DesktopRuntimePlacement = { kind: 'host_process', runtime_root: environment.local_hosting.state_dir };
  const operationKey = runtimeTargetIDFromRequest({
    ...request,
    environment_id: environment.id,
    host_access: hostAccess,
    placement: localHostPlacement,
  });
  const operation = launcherOperations.create({
    operation_key: operationKey,
    action: request.kind,
    subject_kind: 'local_environment',
    subject_id: environment.id,
    environment_id: environment.id,
    environment_label: environment.label,
    phase: 'checking_existing_runtime',
    title: 'Checking existing runtime',
    detail: 'Desktop is checking whether a compatible local runtime is already running.',
    lifecycle_progress: buildRuntimeLifecycleProgress({
      hostAccess,
      placement: localHostPlacement,
      operation: lifecycleOperation,
      phase: 'checking_existing_runtime',
      targetID: operationKey,
      targetLabel: environment.label,
    }),
    cancelable: false,
  });
  beginRuntimeLifecycleWorkflowAttempt(operationKey, {
    hostAccess,
    placement: localHostPlacement,
    operation: lifecycleOperation,
    targetID: operationKey,
    targetLabel: environment.label,
  });
  const lifecycleAttemptOwner = {
    action: operation.action,
    started_at_unix_ms: operation.started_at_unix_ms,
  };
  try {
    if (request.kind === 'restart_environment_runtime' || request.kind === 'update_environment_runtime') {
      const runtimeRecord = await verifyCurrentLocalEnvironmentRuntimeRecord(environment) ?? await attachLocalEnvironmentRuntime(environment);
      if (runtimeRecord) {
        commitRuntimeLifecycleDecision(operationKey, lifecycleAttemptOwner, {
          hostAccess,
          placement: localHostPlacement,
          operation: lifecycleOperation,
          targetID: operationKey,
          targetLabel: environment.label,
          decision: lifecycleOperation === 'update' ? 'runtime_update_required_running' : 'runtime_running',
        });
        updateRuntimeLifecycleOperation(operationKey, lifecycleAttemptOwner, {
          hostAccess,
          placement: localHostPlacement,
          operation: lifecycleOperation,
          phase: 'stopping_runtime_process',
          targetID: operationKey,
          targetLabel: environment.label,
          title: 'Stopping runtime process',
          detail: request.kind === 'update_environment_runtime'
            ? 'Desktop is stopping the current local runtime before updating it.'
            : 'Desktop is stopping the current local runtime before restarting it.',
        });
        await runtimeRecord.runtime_handle.stop();
        updateRuntimeLifecycleOperation(operationKey, lifecycleAttemptOwner, {
          hostAccess,
          placement: localHostPlacement,
          operation: lifecycleOperation,
          phase: 'verifying_runtime_stopped',
          targetID: operationKey,
          targetLabel: environment.label,
          title: 'Verifying runtime stopped',
          detail: 'Desktop is confirming that the previous local runtime is no longer running.',
        });
        await assertLocalEnvironmentRuntimeStopped(environment);
        clearLocalEnvironmentRuntimeRecord(environment);
      } else {
        commitRuntimeLifecycleDecision(operationKey, lifecycleAttemptOwner, {
          hostAccess,
          placement: localHostPlacement,
          operation: lifecycleOperation,
          targetID: operationKey,
          targetLabel: environment.label,
          decision: lifecycleOperation === 'update' ? 'runtime_update_required_stopped' : 'runtime_stopped',
        });
      }
    }
    const prepared = await prepareManagedTarget({
      environment,
      forceRuntimeUpdate: request.force_runtime_update === true,
      onProgress: (progress: ManagedRuntimeProgress) => {
        updateRuntimeLifecycleOperation(operationKey, lifecycleAttemptOwner, {
          hostAccess,
          placement: localHostPlacement,
          operation: lifecycleOperation,
          phase: runtimeLifecyclePhaseFromManagedRuntime(progress.phase),
          targetLabel: environment.label,
          title: progress.title,
          detail: progress.detail,
        });
      },
    });
    if (!prepared.ok) {
      const failure = desktopOperationFailurePresentation({
        code: 'local_runtime_launch_failed',
        title: 'Runtime Start Blocked',
        summary: prepared.issue.message,
        targetLabel: environment.label,
      });
      const workflowFailure = runtimeLifecycleWorkflowFailure(operationKey, lifecycleAttemptOwner, {
        hostAccess,
        placement: localHostPlacement,
        operation: lifecycleOperation,
        targetID: operationKey,
        targetLabel: environment.label,
        error: new DesktopOperationFailureError(failure),
        fallback: failure,
      });
      const failurePhase = workflowFailure.step_failure.failed_step_id;
      launcherOperations.finishCurrentAttempt(operationKey, lifecycleAttemptOwner, 'failed', {
        phase: failurePhase,
        title: 'Runtime start blocked',
        detail: failure.summary,
        lifecycle_progress: workflowFailure.lifecycle_progress,
        failure,
      });
      scheduleCurrentLauncherOperationRemoval(operation.operation_key, lifecycleAttemptOwner);
      clearRuntimeLifecycleWorkflow(operationKey, lifecycleAttemptOwner);
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
    void syncLinkedProviderRuntimeHealthFromService(prepared.launch.managedRuntime.startup.runtime_service)
      .finally(() => broadcastDesktopWelcomeSnapshots())
      .catch(() => undefined);
    broadcastDesktopWelcomeSnapshots();
    launcherOperations.finishCurrentAttempt(operationKey, lifecycleAttemptOwner, 'succeeded', {
      phase: request.kind === 'restart_environment_runtime' ? 'runtime_restarted' : request.kind === 'update_environment_runtime' ? 'runtime_updated' : 'runtime_started',
      title: 'Runtime ready',
      detail: request.kind === 'restart_environment_runtime'
        ? 'Desktop restarted the local runtime.'
        : request.kind === 'update_environment_runtime'
          ? 'Desktop updated the local runtime.'
          : 'Desktop started the local runtime.',
      lifecycle_progress: completeRuntimeLifecycleWorkflowProgress(operationKey, lifecycleAttemptOwner, {
        hostAccess,
        placement: localHostPlacement,
        operation: lifecycleOperation,
        phase: 'runtime_ready',
        targetID: operationKey,
        targetLabel: environment.label,
        detail: 'Desktop confirmed that the local Runtime Service is ready.',
      }),
    });
    scheduleCurrentLauncherOperationRemoval(operation.operation_key, lifecycleAttemptOwner);
    clearRuntimeLifecycleWorkflow(operationKey, lifecycleAttemptOwner);
    return launcherActionSuccess(runtimeLifecycleSuccessOutcome(request.kind));
  } catch (error) {
    const failureTitle = runtimeLifecycleTitleForFailure('local_host', false, lifecycleOperation);
    const fallbackFailure = desktopFailureFromError(error, {
      code: 'local_runtime_launch_failed',
      title: failureTitle,
      summary: lifecycleOperation === 'update'
        ? 'Desktop could not update the local runtime.'
        : lifecycleOperation === 'restart'
          ? 'Desktop could not restart the local runtime.'
        : 'Desktop could not start the local runtime.',
      targetLabel: environment.label,
    });
    const workflowFailure = runtimeLifecycleWorkflowFailure(operationKey, lifecycleAttemptOwner, {
      hostAccess,
      placement: localHostPlacement,
      operation: lifecycleOperation,
      targetID: operationKey,
      targetLabel: environment.label,
      error,
      fallback: fallbackFailure,
    });
    const failure = workflowFailure.step_failure.presentation;
    const failurePhase = workflowFailure.step_failure.failed_step_id;
    launcherOperations.finishCurrentAttempt(operationKey, lifecycleAttemptOwner, 'failed', {
      phase: failurePhase,
      title: failureTitle,
      detail: failure.summary,
      lifecycle_progress: workflowFailure.lifecycle_progress,
      failure,
    });
    scheduleCurrentLauncherOperationRemoval(operation.operation_key, lifecycleAttemptOwner);
    clearRuntimeLifecycleWorkflow(operationKey, lifecycleAttemptOwner);
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
        operation: lifecycleOperation,
      });
  }
}

async function startEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'start_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  return runEnvironmentRuntimeLifecycleFromLauncher(request);
}

async function updateEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'update_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  const requestedPlacement = runtimePlacementFromRequest(request);
  if (requestedPlacement.kind !== 'container_process' && !sshDetailsFromRuntimeTargetRequest(request)) {
    return launcherActionFailure(
      'action_invalid',
      'environment',
      'Local Host runtime updates are managed through the Redeven Desktop update handoff.',
      {
        environmentID: runtimeTargetEnvironmentIDFromRequest(request),
      },
    );
  }
  return runEnvironmentRuntimeLifecycleFromLauncher({
    ...request,
    kind: 'update_environment_runtime',
    force_runtime_update: true,
  });
}

async function restartEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'restart_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  return runEnvironmentRuntimeLifecycleFromLauncher({
    ...request,
    kind: 'restart_environment_runtime',
    force_runtime_update: false,
  });
}

async function manageDesktopUpdateFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'manage_desktop_update' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const environment = findLocalEnvironmentByID(preferences, request.environment_id);
  if (!environment) {
    if (findProviderEnvironmentByID(preferences, request.environment_id)) {
      return launcherActionFailure(
        'action_invalid',
        'environment',
        'Provider Environment cards do not manage Desktop-bundled runtime updates. Use the Local runtime card on the host device.',
        {
          environmentID: request.environment_id,
        },
      );
    }
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
  await showDesktopUpdateHandoffDialog({
    label: compact(request.label) || environment.label,
    environmentKindLabel: localEnvironmentStateKind(environment) === 'controlplane'
      ? 'Provider environment'
      : 'Local environment',
    detail: localEnvironmentStateKind(environment) === 'controlplane'
      ? 'Desktop will keep this environment in the same provider-backed Local Environment profile and may need a newer desktop release before redeploying the managed runtime.'
      : 'Desktop will keep this environment on the same Local Environment profile and may need a newer desktop release before restarting the managed runtime.',
  });
  return launcherActionSuccess('opened_desktop_update_handoff');
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

  let runtimeTarget: ProviderRuntimeLinkTargetRecord | null;
  try {
    runtimeTarget = await resolveProviderRuntimeLinkTarget(preferences, request.runtime_target_id);
  } catch (error) {
    return launcherActionFailureFromSessionOpenError(error, providerEnvironmentFailureContext(environment));
  }
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
  const occupyingRuntime = await providerEnvironmentOccupyingRuntime(preferences, environment, runtimeTarget.id);
  if (occupyingRuntime) {
    return providerEnvironmentOccupiedFailure(environment, occupyingRuntime.label);
  }
  const providerRoute = controlPlaneRouteSnapshot(
    preferences,
    environment.provider_origin,
    environment.provider_id,
    environment.env_public_id,
  );
  if (
    providerRoute.environment?.runtime_health?.runtime_status === 'online'
    && !localRuntimeMatchesProvider(runtimeRecord.startup, environment)
  ) {
    return providerEnvironmentOccupiedFailure(environment, '');
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
    await syncLinkedProviderRuntimeHealthFromService(linked.runtime_service);
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
  const runtimeTarget = await resolveProviderRuntimeLinkTarget(preferences, request.runtime_target_id);
  const runtimeRecord = runtimeTarget?.record ?? null;
  const currentBinding = runtimeServiceProviderLinkBinding(runtimeRecord?.startup.runtime_service);
  const providerEnvironmentID = compact(request.provider_environment_id);
  const environment = (() => {
    if (providerEnvironmentID !== '') {
      const candidate = findProviderEnvironmentByID(preferences, providerEnvironmentID);
      return candidate && desktopRuntimeProviderBindingMatches(currentBinding, {
        provider_origin: candidate.provider_origin,
        provider_id: candidate.provider_id,
        env_public_id: candidate.env_public_id,
      })
        ? candidate
        : null;
    }
    return preferences.provider_environments.find((candidate) => desktopRuntimeProviderBindingMatches(currentBinding, {
      provider_origin: candidate.provider_origin,
      provider_id: candidate.provider_id,
      env_public_id: candidate.env_public_id,
    })) ?? null;
  })();
  if (!runtimeTarget || !runtimeRecord?.startup.runtime_control) {
    return launcherActionFailure(
      'runtime_not_started',
      'environment',
      'The selected runtime is not currently running.',
      environment
        ? providerEnvironmentFailureContext(environment)
        : providerBindingFailureContext(currentBinding, providerEnvironmentID),
    );
  }
  if (currentBinding.state !== 'linked') {
    return launcherActionFailure(
      'provider_link_failed',
      'environment',
      `${runtimeTarget.label} is not linked to a provider Environment.`,
      environment
        ? providerEnvironmentFailureContext(environment)
        : providerBindingFailureContext(currentBinding, providerEnvironmentID),
    );
  }
  try {
    const unlinked = await disconnectProviderLink(runtimeRecord.startup.runtime_control);
    updateProviderRuntimeTargetStartup(runtimeTarget, {
      controlplane_base_url: '',
      controlplane_provider_id: '',
      env_public_id: '',
      effective_run_mode: unlinked.runtime_service.effective_run_mode,
      remote_enabled: unlinked.runtime_service.remote_enabled,
      runtime_service: unlinked.runtime_service,
    });
    if (runtimeTarget.kind === 'local_environment') {
      await persistDesktopPreferences({
        ...preferences,
        local_environment: {
          ...preferences.local_environment,
          current_provider_binding: undefined,
        },
      });
    }
    if (environment) {
      await refreshProviderEnvironmentRuntimeHealth(
        environment.provider_origin,
        environment.provider_id,
        [environment.env_public_id],
      ).catch(() => {
        // Best-effort provider health refresh should not turn a completed runtime disconnect into a failed action.
      });
    }
    resetLauncherIssueState();
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('disconnected_provider_runtime');
  } catch (error) {
    return thrownLauncherActionFailure(error)
      ?? launcherActionFailureFromProviderLinkError(error, environment
        ? providerEnvironmentFailureContext(environment)
        : providerBindingFailureContext(currentBinding, providerEnvironmentID));
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

async function dismissLauncherOperationFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'dismiss_launcher_operation' }>>,
): Promise<DesktopLauncherActionResult> {
  const operation = launcherOperations.get(request.operation_key);
  if (!operation) {
    return launcherActionSuccess('dismissed_launcher_operation');
  }
  if (
    operation.status !== 'failed'
    && operation.status !== 'cleanup_failed'
    && operation.status !== 'canceled'
    && operation.status !== 'succeeded'
  ) {
    return launcherActionFailure(
      'operation_not_cancelable',
      'global',
      'That background task cannot be dismissed at this stage.',
      {
        shouldRefreshSnapshot: true,
      },
    );
  }
  const existingTimer = launcherOperationRemovalTimers.get(request.operation_key);
  if (existingTimer) {
    clearTimeout(existingTimer);
    launcherOperationRemovalTimers.delete(request.operation_key);
  }
  launcherOperations.remove(request.operation_key);
  broadcastDesktopWelcomeSnapshots();
  return launcherActionSuccess('dismissed_launcher_operation');
}

async function stopEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'stop_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  const placement = runtimePlacementFromRequest(request);
  const lifecycleOperation: DesktopRuntimeLifecycleOperation = 'stop';
  if (placement.kind === 'container_process') {
    const targetID = runtimeTargetIDFromRequest(request);
    const pendingStart = pendingRuntimePlacementStartByTargetID.get(targetID) ?? null;
    if (pendingStart) {
      launcherOperations.cancel(pendingStart.operation_key, 'Desktop is canceling the container runtime startup task.');
      broadcastDesktopWelcomeSnapshots();
      return launcherActionSuccess('canceled_launcher_operation');
    }
    await refreshWelcomeRuntimeHealthForEnvironment(runtimeTargetEnvironmentIDFromRequest(request));
    const runtimeRecord = runtimePlacementBridgeRecordForRequest(request);
    const readyRecord = runtimePlacementReadyByTargetID.get(targetID) ?? null;
    if (!runtimeRecord && !readyRecord) {
      return launcherActionFailure(
        'action_invalid',
        'environment',
        'The runtime is not currently running.',
        {
          environmentID: runtimeTargetEnvironmentIDFromRequest(request),
        },
      );
    }
    const hostAccess = runtimeRecord?.session.host_access ?? readyRecord!.host_access;
    const runtimePlacement = (runtimeRecord?.session.placement ?? readyRecord!.placement) as Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>;
    const environmentID = runtimeTargetEnvironmentIDFromRequest(request);
    const label = runtimeRecord?.label ?? readyRecord?.label ?? runtimeTargetLabelFromRequest(request);
    const initialPhase: DesktopRuntimeLifecyclePhase = hostAccess.kind === 'ssh_host' ? 'checking_host' : 'checking_container';
    const operation = launcherOperations.create({
      operation_key: targetID,
      action: 'stop_environment_runtime',
      subject_kind: 'runtime_target',
      subject_id: targetID,
      environment_id: environmentID,
      environment_label: label,
      phase: initialPhase,
      title: hostAccess.kind === 'ssh_host' ? 'Checking SSH container runtime' : 'Checking container runtime',
      detail: hostAccess.kind === 'ssh_host'
        ? 'Desktop is checking the SSH host and selected running container before stopping the runtime.'
        : 'Desktop is checking the selected running container before stopping the runtime.',
      lifecycle_progress: buildRuntimeLifecycleProgress({
        hostAccess,
        placement: runtimePlacement,
        operation: lifecycleOperation,
        phase: initialPhase,
        targetID,
        targetLabel: label,
      }),
      cancelable: true,
      interrupt_label: 'Cancel stop',
      interrupt_detail: 'Desktop is canceling this runtime stop request before it completes.',
      interrupt_kind: 'generic',
    });
    beginRuntimeLifecycleWorkflowAttempt(targetID, {
      hostAccess,
      placement: runtimePlacement,
      operation: lifecycleOperation,
      targetID,
      targetLabel: label,
    });
    const lifecycleAttemptOwner = {
      action: operation.action,
      started_at_unix_ms: operation.started_at_unix_ms,
    };
    const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
    const failureTitle = runtimeLifecycleTitleForFailure(
      desktopRuntimeLifecycleLocation(hostAccess, runtimePlacement),
      false,
      lifecycleOperation,
    );
    try {
      updateRuntimeLifecycleOperation(targetID, lifecycleAttemptOwner, {
        hostAccess,
        placement: runtimePlacement,
        operation: lifecycleOperation,
        phase: 'stopping_runtime_process',
        targetID,
        targetLabel: label,
        title: 'Stopping runtime process',
        detail: 'Desktop is stopping the runtime daemon inside this container.',
      });
      const liveRuntimeSession = liveSession(desktopSessionKeyFromRuntimeTargetID(targetID));
      if (liveRuntimeSession) {
        await finalizeSessionClosure(liveRuntimeSession.session_key);
      }
      await runtimeRecord?.desktop_model_source?.stop().catch(() => undefined);
      await runtimeRecord?.session.disconnect().catch(() => undefined);
      const binaryPath = readyRecord?.runtime_binary_path ?? runtimeRecord?.runtime_binary_path ?? 'redeven';
      const preferences = await loadDesktopPreferencesCached();
      const savedTarget = preferences.saved_runtime_targets.find((target) => target.id === targetID) ?? null;
      const sshPassword = savedTarget?.ssh_password_configured === true
        ? savedTarget.ssh_password ?? ''
        : compact(request.ssh_password);
      const executor = runtimeHostExecutor(hostAccess, sshPassword || undefined);
      await executor.run(containerRuntimeDaemonStopCommand({
        engine: runtimePlacement.container_engine,
        container_id: runtimePlacement.container_id,
        runtime_root: runtimePlacement.runtime_root,
        runtime_binary_path: binaryPath,
      }), { signal });
      updateRuntimeLifecycleOperation(targetID, lifecycleAttemptOwner, {
        hostAccess,
        placement: runtimePlacement,
        operation: lifecycleOperation,
        phase: 'verifying_runtime_stopped',
        targetID,
        targetLabel: label,
        title: 'Verifying runtime stopped',
        detail: 'Desktop is confirming that the container runtime daemon is no longer running.',
      });
      await assertContainerRuntimeStopped({
        executor,
        placement: runtimePlacement,
        runtimeBinaryPath: binaryPath,
        signal,
      });
      runtimePlacementBridgeByTargetID.delete(targetID);
      runtimePlacementReadyByTargetID.delete(targetID);
      runtimePlacementMaintenanceByTargetID.delete(targetID);
      resetLauncherIssueState();
      launcherOperations.finishCurrentAttempt(targetID, lifecycleAttemptOwner, 'succeeded', {
        phase: 'runtime_stopped',
        title: 'Runtime stopped',
        detail: 'Desktop stopped the container runtime.',
        lifecycle_progress: completeRuntimeLifecycleWorkflowProgress(targetID, lifecycleAttemptOwner, {
          hostAccess,
          placement: runtimePlacement,
          operation: lifecycleOperation,
          phase: 'runtime_stopped',
          targetID,
          targetLabel: label,
          detail: 'Desktop stopped the container runtime.',
        }),
      });
      scheduleCurrentLauncherOperationRemoval(operation.operation_key, lifecycleAttemptOwner);
      clearRuntimeLifecycleWorkflow(targetID, lifecycleAttemptOwner);
      broadcastDesktopWelcomeSnapshots();
      return launcherActionSuccess('stopped_environment_runtime');
    } catch (error) {
      const canceled = signal?.aborted === true;
      const fallbackFailure = desktopFailureFromError(error, {
        code: 'container_runtime_stop_failed',
        title: failureTitle,
        summary: 'Desktop could not stop this container runtime.',
        targetLabel: label,
      });
      const workflowFailure = canceled ? null : runtimeLifecycleWorkflowFailure(targetID, lifecycleAttemptOwner, {
        hostAccess,
        placement: runtimePlacement,
        operation: lifecycleOperation,
        targetID,
        targetLabel: label,
        error,
        fallback: fallbackFailure,
      });
      const canceledProgress = canceled
        ? currentRuntimeLifecycleWorkflowProgress(targetID, lifecycleAttemptOwner, {
            hostAccess,
            placement: runtimePlacement,
            operation: lifecycleOperation,
            targetID,
            targetLabel: label,
          })
        : null;
      const terminalPhase = canceled
        ? canceledProgress!.active_step_id
        : workflowFailure!.step_failure.failed_step_id;
      const failure = workflowFailure?.step_failure.presentation ?? fallbackFailure;
      launcherOperations.finishCurrentAttempt(targetID, lifecycleAttemptOwner, canceled ? 'canceled' : 'failed', {
        phase: terminalPhase,
        title: canceled ? 'Runtime stop canceled' : failureTitle,
        detail: canceled ? 'Desktop canceled this runtime stop request.' : failure.summary,
        lifecycle_progress: canceled
          ? canceledProgress!
          : workflowFailure!.lifecycle_progress,
        ...(canceled ? {} : {
          failure,
          next_actions: runtimeLifecycleFailureNextActions(targetID, environmentID),
        }),
      });
      scheduleCurrentLauncherOperationRemoval(operation.operation_key, lifecycleAttemptOwner);
      clearRuntimeLifecycleWorkflow(targetID, lifecycleAttemptOwner);
      broadcastDesktopWelcomeSnapshots();
      if (canceled) {
        return launcherActionSuccess('canceled_launcher_operation');
      }
      return launcherActionFailure(
        'runtime_start_failed',
        'environment',
        failure.summary,
        {
          environmentID,
          failure,
          shouldRefreshSnapshot: true,
        },
      );
    }
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
    const runtimeRecord = await verifySSHEnvironmentRuntimeRecord(runtimeKey);
    if (!runtimeRecord) {
      await refreshWelcomeRuntimeHealthForEnvironment(request.environment_id ?? runtimeKey);
    }
    const readyRecord = sshRuntimeReadyByKey.get(runtimeKey) ?? null;
    if (!runtimeRecord && !readyRecord) {
      return launcherActionFailure(
        'action_invalid',
        'environment',
        'The runtime is not currently running.',
        {
          environmentID: request.environment_id,
        },
      );
    }
    const label = runtimeRecord?.label ?? readyRecord?.label ?? request.label ?? defaultSavedSSHEnvironmentLabel(sshDetails);
    const hostAccess: DesktopRuntimeHostAccess = { kind: 'ssh_host', ssh: sshDetails };
    const hostPlacement: DesktopRuntimePlacement = { kind: 'host_process', runtime_root: sshDetails.runtime_root };
    const operation = launcherOperations.create({
      operation_key: runtimeKey,
      action: 'stop_environment_runtime',
      subject_kind: 'ssh_environment',
      subject_id: runtimeKey,
      environment_id: request.environment_id ?? runtimeKey,
      environment_label: label,
      phase: 'checking_host',
      title: 'Checking SSH runtime',
      detail: 'Desktop is checking the SSH host before stopping the runtime.',
      lifecycle_progress: buildRuntimeLifecycleProgress({
        hostAccess,
        placement: hostPlacement,
        operation: lifecycleOperation,
        phase: 'checking_host',
        targetID: runtimeKey,
        targetLabel: label,
      }),
      cancelable: true,
      interrupt_label: 'Cancel stop',
      interrupt_detail: 'Desktop is canceling this SSH runtime stop request before it completes.',
      interrupt_kind: 'generic',
    });
    beginRuntimeLifecycleWorkflowAttempt(runtimeKey, {
      hostAccess,
      placement: hostPlacement,
      operation: lifecycleOperation,
      targetID: runtimeKey,
      targetLabel: label,
    });
    const lifecycleAttemptOwner = {
      action: operation.action,
      started_at_unix_ms: operation.started_at_unix_ms,
    };
    const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
    try {
      const preferences = await loadDesktopPreferencesCached();
      const sshPassword = savedSSHPasswordForDetails(preferences, sshDetails, request.environment_id) || compact(request.ssh_password);
      updateRuntimeLifecycleOperation(runtimeKey, lifecycleAttemptOwner, {
        hostAccess,
        placement: hostPlacement,
        operation: lifecycleOperation,
        phase: 'stopping_runtime_process',
        targetID: runtimeKey,
        targetLabel: label,
        title: 'Stopping runtime process',
        detail: 'Desktop is stopping the runtime daemon on this SSH host.',
      });
      const liveSessionRecord = liveSession(runtimeKey);
      if (liveSessionRecord) {
        await finalizeSessionClosure(liveSessionRecord.session_key);
      }
      if (runtimeRecord) {
        await runtimeRecord.stop();
      } else {
        const pid = Number(readyRecord?.startup.pid ?? Number.NaN);
        if (!Number.isInteger(pid) || pid <= 0) {
          throw new Error('Desktop could not resolve the SSH runtime process id to stop.');
        }
        await stopManagedSSHRuntimeProcess({
          target: sshDetails,
          pid,
          sshPassword,
          connectTimeoutSeconds: typeof sshDetails.connect_timeout_seconds === 'number'
            ? sshDetails.connect_timeout_seconds
            : undefined,
          tempRoot: app.getPath('temp'),
          signal,
        });
      }
      updateRuntimeLifecycleOperation(runtimeKey, lifecycleAttemptOwner, {
        hostAccess,
        placement: hostPlacement,
        operation: lifecycleOperation,
        phase: 'verifying_runtime_stopped',
        targetID: runtimeKey,
        targetLabel: label,
        title: 'Verifying runtime stopped',
        detail: 'Desktop is confirming that the SSH runtime daemon is no longer running.',
      });
      const statusProbe = await probeManagedSSHRuntimeStatus({
        target: sshDetails,
        runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
        sshPassword,
        connectTimeoutSeconds: typeof sshDetails.connect_timeout_seconds === 'number'
          ? sshDetails.connect_timeout_seconds
          : undefined,
        tempRoot: app.getPath('temp'),
        signal,
      });
      if (statusProbe.status === 'ready') {
        throw new Error('Desktop could not stop the SSH runtime because it still reports a ready daemon.');
      }
      if (statusProbe.status === 'failed') {
        throw new DesktopOperationFailureError(statusProbe.failure);
      }
      if (statusProbe.status === 'blocked') {
        assertRuntimeStopVerifiedFromLaunchReport(statusProbe.report);
      }
      sshEnvironmentRuntimeByKey.delete(runtimeKey);
      sshRuntimeReadyByKey.delete(runtimeKey);
      sshRuntimeMaintenanceByKey.delete(runtimeKey);
      resetLauncherIssueState();
      launcherOperations.finishCurrentAttempt(runtimeKey, lifecycleAttemptOwner, 'succeeded', {
        phase: 'runtime_stopped',
        title: 'Runtime stopped',
        detail: 'Desktop stopped the SSH runtime.',
        lifecycle_progress: completeRuntimeLifecycleWorkflowProgress(runtimeKey, lifecycleAttemptOwner, {
          hostAccess,
          placement: hostPlacement,
          operation: lifecycleOperation,
          phase: 'runtime_stopped',
          targetID: runtimeKey,
          targetLabel: label,
          detail: 'Desktop stopped the SSH runtime.',
        }),
      });
      scheduleCurrentLauncherOperationRemoval(operation.operation_key, lifecycleAttemptOwner);
      clearRuntimeLifecycleWorkflow(runtimeKey, lifecycleAttemptOwner);
      broadcastDesktopWelcomeSnapshots();
      return launcherActionSuccess('stopped_environment_runtime');
    } catch (error) {
      const canceled = signal?.aborted === true;
      const failureTitle = runtimeLifecycleTitleForFailure('ssh_host', false, lifecycleOperation);
      const fallbackFailure = desktopFailureFromError(error, {
        code: 'ssh_runtime_stop_failed',
        title: failureTitle,
        summary: 'Desktop could not stop this SSH runtime.',
        targetLabel: label,
      });
      const workflowFailure = canceled ? null : runtimeLifecycleWorkflowFailure(runtimeKey, lifecycleAttemptOwner, {
        hostAccess,
        placement: hostPlacement,
        operation: lifecycleOperation,
        targetID: runtimeKey,
        targetLabel: label,
        error,
        fallback: fallbackFailure,
      });
      const canceledProgress = canceled
        ? currentRuntimeLifecycleWorkflowProgress(runtimeKey, lifecycleAttemptOwner, {
            hostAccess,
            placement: hostPlacement,
            operation: lifecycleOperation,
            targetID: runtimeKey,
            targetLabel: label,
          })
        : null;
      const terminalPhase = canceled ? canceledProgress!.active_step_id : workflowFailure!.step_failure.failed_step_id;
      const failure = workflowFailure?.step_failure.presentation ?? fallbackFailure;
      launcherOperations.finishCurrentAttempt(runtimeKey, lifecycleAttemptOwner, canceled ? 'canceled' : 'failed', {
        phase: terminalPhase,
        title: canceled ? 'Runtime stop canceled' : failureTitle,
        detail: canceled ? 'Desktop canceled this SSH runtime stop request.' : failure.summary,
        lifecycle_progress: canceled
          ? canceledProgress!
          : workflowFailure!.lifecycle_progress,
        ...(canceled ? {} : {
          failure,
          next_actions: runtimeLifecycleFailureNextActions(runtimeKey, request.environment_id ?? runtimeKey),
        }),
      });
      scheduleCurrentLauncherOperationRemoval(operation.operation_key, lifecycleAttemptOwner);
      clearRuntimeLifecycleWorkflow(runtimeKey, lifecycleAttemptOwner);
      broadcastDesktopWelcomeSnapshots();
      if (canceled) {
        return launcherActionSuccess('canceled_launcher_operation');
      }
      return launcherActionFailure(
        'runtime_start_failed',
        'environment',
        failure.summary,
        {
          environmentID: request.environment_id,
          failure,
          shouldRefreshSnapshot: true,
        },
      );
    }
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

  const hostAccess: DesktopRuntimeHostAccess = { kind: 'local_host' };
  const localHostPlacement: DesktopRuntimePlacement = { kind: 'host_process', runtime_root: environment.local_hosting.state_dir };
  const operationKey = runtimeTargetIDFromRequest({
    ...request,
    environment_id: environment.id,
    host_access: hostAccess,
    placement: localHostPlacement,
  });
  const operation = launcherOperations.create({
    operation_key: operationKey,
    action: 'stop_environment_runtime',
    subject_kind: 'local_environment',
    subject_id: environment.id,
    environment_id: environment.id,
    environment_label: environment.label,
    phase: 'checking_existing_runtime',
    title: 'Checking existing runtime',
    detail: 'Desktop is checking the local runtime before stopping it.',
    lifecycle_progress: buildRuntimeLifecycleProgress({
      hostAccess,
      placement: localHostPlacement,
      operation: lifecycleOperation,
      phase: 'checking_existing_runtime',
      targetID: operationKey,
      targetLabel: environment.label,
    }),
    cancelable: true,
    interrupt_label: 'Cancel stop',
    interrupt_detail: 'Desktop is canceling this local runtime stop request before it completes.',
    interrupt_kind: 'generic',
  });
  beginRuntimeLifecycleWorkflowAttempt(operationKey, {
    hostAccess,
    placement: localHostPlacement,
    operation: lifecycleOperation,
    targetID: operationKey,
    targetLabel: environment.label,
  });
  const lifecycleAttemptOwner = {
    action: operation.action,
    started_at_unix_ms: operation.started_at_unix_ms,
  };
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
  try {
    const runtimeRecord = await verifyCurrentLocalEnvironmentRuntimeRecord(environment) ?? await attachLocalEnvironmentRuntime(environment);
    if (!runtimeRecord) {
      const readyWorkflow = commitRuntimeLifecycleDecision(operationKey, lifecycleAttemptOwner, {
        hostAccess,
        placement: localHostPlacement,
        operation: lifecycleOperation,
        targetID: operationKey,
        targetLabel: environment.label,
        decision: 'runtime_already_stopped',
      });
      readyWorkflow.completeThrough('checking_existing_runtime');
      resetLauncherIssueState();
      launcherOperations.finishCurrentAttempt(operationKey, lifecycleAttemptOwner, 'succeeded', {
        phase: 'runtime_already_stopped',
        title: 'Runtime already stopped',
        detail: 'Desktop confirmed that this local runtime is already stopped.',
        lifecycle_progress: completeRuntimeLifecycleWorkflowProgress(operationKey, lifecycleAttemptOwner, {
          hostAccess,
          placement: localHostPlacement,
          operation: lifecycleOperation,
          phase: 'runtime_already_stopped',
          targetID: operationKey,
          targetLabel: environment.label,
          detail: 'Desktop confirmed that this local runtime is already stopped.',
        }),
      });
      scheduleCurrentLauncherOperationRemoval(operation.operation_key, lifecycleAttemptOwner);
      clearRuntimeLifecycleWorkflow(operationKey, lifecycleAttemptOwner);
      broadcastDesktopWelcomeSnapshots();
      return launcherActionSuccess('stopped_environment_runtime');
    }
    updateRuntimeLifecycleOperation(operationKey, lifecycleAttemptOwner, {
      hostAccess,
      placement: localHostPlacement,
      operation: lifecycleOperation,
      phase: 'stopping_runtime_process',
      targetID: operationKey,
      targetLabel: environment.label,
      title: 'Stopping runtime process',
      detail: 'Desktop is stopping the local runtime process.',
    });
    const liveLocalSession = [...sessionsByKey.values()].find((sessionRecord) => (
      !sessionRecord.closing
      && sessionRecord.target.kind === 'local_environment'
      && sessionRecord.target.environment_id === environment.id
      && sessionRecord.target.route === 'local_host'
    )) ?? null;
    if (liveLocalSession) {
      await finalizeSessionClosure(liveLocalSession.session_key);
    }
    if (signal?.aborted === true) {
      throw new DesktopSSHRuntimeCanceledError('Local runtime stop was canceled.');
    }
    await runtimeRecord.runtime_handle.stop();
    updateRuntimeLifecycleOperation(operationKey, lifecycleAttemptOwner, {
      hostAccess,
      placement: localHostPlacement,
      operation: lifecycleOperation,
      phase: 'verifying_runtime_stopped',
      targetID: operationKey,
      targetLabel: environment.label,
      title: 'Verifying runtime stopped',
      detail: 'Desktop is confirming that the local runtime process is no longer running.',
    });
    await assertLocalEnvironmentRuntimeStopped(environment);
    clearLocalEnvironmentRuntimeRecord(environment);
    resetLauncherIssueState();
    launcherOperations.finishCurrentAttempt(operationKey, lifecycleAttemptOwner, 'succeeded', {
      phase: 'runtime_stopped',
      title: 'Runtime stopped',
      detail: 'Desktop stopped the local runtime.',
      lifecycle_progress: completeRuntimeLifecycleWorkflowProgress(operationKey, lifecycleAttemptOwner, {
        hostAccess,
        placement: localHostPlacement,
        operation: lifecycleOperation,
        phase: 'runtime_stopped',
        targetID: operationKey,
        targetLabel: environment.label,
        detail: 'Desktop stopped the local runtime.',
      }),
    });
    scheduleCurrentLauncherOperationRemoval(operation.operation_key, lifecycleAttemptOwner);
    clearRuntimeLifecycleWorkflow(operationKey, lifecycleAttemptOwner);
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('stopped_environment_runtime');
  } catch (error) {
    const canceled = signal?.aborted === true || error instanceof DesktopSSHRuntimeCanceledError;
    const failureTitle = runtimeLifecycleTitleForFailure('local_host', false, lifecycleOperation);
    const fallbackFailure = desktopFailureFromError(error, {
      code: 'local_runtime_stop_failed',
      title: failureTitle,
      summary: 'Desktop could not stop this local runtime.',
      targetLabel: environment.label,
    });
    const workflowFailure = canceled ? null : runtimeLifecycleWorkflowFailure(operationKey, lifecycleAttemptOwner, {
      hostAccess,
      placement: localHostPlacement,
      operation: lifecycleOperation,
      targetID: operationKey,
      targetLabel: environment.label,
      error,
      fallback: fallbackFailure,
    });
    const canceledProgress = canceled
      ? currentRuntimeLifecycleWorkflowProgress(operationKey, lifecycleAttemptOwner, {
          hostAccess,
          placement: localHostPlacement,
          operation: lifecycleOperation,
          targetID: operationKey,
          targetLabel: environment.label,
        })
      : null;
    const terminalPhase = canceled ? canceledProgress!.active_step_id : workflowFailure!.step_failure.failed_step_id;
    const failure = workflowFailure?.step_failure.presentation ?? fallbackFailure;
    launcherOperations.finishCurrentAttempt(operationKey, lifecycleAttemptOwner, canceled ? 'canceled' : 'failed', {
      phase: terminalPhase,
      title: canceled ? 'Runtime stop canceled' : failureTitle,
      detail: canceled ? 'Desktop canceled this local runtime stop request.' : failure.summary,
      lifecycle_progress: canceled
        ? canceledProgress!
        : workflowFailure!.lifecycle_progress,
      ...(canceled ? {} : {
        failure,
        next_actions: runtimeLifecycleFailureNextActions(operationKey, environment.id),
      }),
    });
    scheduleCurrentLauncherOperationRemoval(operation.operation_key, lifecycleAttemptOwner);
    clearRuntimeLifecycleWorkflow(operationKey, lifecycleAttemptOwner);
    broadcastDesktopWelcomeSnapshots();
    if (canceled) {
      return launcherActionSuccess('canceled_launcher_operation');
    }
    return launcherActionFailure(
      'runtime_start_failed',
      'environment',
      failure.summary,
      {
        environmentID: environment.id,
        providerOrigin: localEnvironmentProviderOrigin(environment),
        providerID: localEnvironmentProviderID(environment),
        envPublicID: localEnvironmentPublicID(environment),
        failure,
        shouldRefreshSnapshot: true,
      },
    );
  }
}

async function refreshEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'refresh_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const environmentID = compact(request.environment_id);
  const providerEnvironment = environmentID
    ? findProviderEnvironmentByID(preferences, environmentID)
    : null;
  if (providerEnvironment) {
    await syncSavedControlPlaneAccountWithState(
      providerEnvironment.provider_origin,
      providerEnvironment.provider_id,
      { force: true },
    );
    await refreshProviderEnvironmentRuntimeHealth(
      providerEnvironment.provider_origin,
      providerEnvironment.provider_id,
      [providerEnvironment.env_public_id],
    );
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('refreshed_environment_runtime');
  }

  await refreshWelcomeRuntimeHealthForEnvironment(environmentID);

  const placement = runtimePlacementFromRequest(request);
  if (placement.kind === 'container_process') {
    const targetID = runtimeTargetIDFromRequest(request);
    const runtimeRecord = runtimePlacementBridgeRecordForRequest(request);
    const readyRecord = runtimePlacementReadyByTargetID.get(targetID) ?? null;
    const runtimeService = runtimeRecord?.startup.runtime_service ?? readyRecord?.startup?.runtime_service;
    if (runtimeService) {
      await syncLinkedProviderRuntimeHealthFromService(runtimeService).catch(() => undefined);
    }
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('refreshed_environment_runtime');
  }

  const sshDetails = sshDetailsFromRuntimeTargetRequest(request);
  if (sshDetails) {
    const runtimeKey = sshDesktopSessionKey(sshDetails);
    const runtimeRecord = await verifySSHEnvironmentRuntimeRecord(runtimeKey);
    const readyRecord = sshRuntimeReadyByKey.get(runtimeKey) ?? null;
    const runtimeService = runtimeRecord?.startup.runtime_service ?? readyRecord?.startup.runtime_service;
    if (runtimeService) {
      await syncLinkedProviderRuntimeHealthFromService(runtimeService).catch(() => undefined);
    }
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('refreshed_environment_runtime');
  }

  const localEnvironment = findLocalEnvironmentByID(preferences, environmentID);
  if (localEnvironment?.local_hosting) {
    const runtimeRecord = await verifyCurrentLocalEnvironmentRuntimeRecord(localEnvironment)
      ?? await attachLocalEnvironmentRuntime(localEnvironment);
    if (runtimeRecord?.startup.runtime_service) {
      await syncLinkedProviderRuntimeHealthFromService(runtimeRecord.startup.runtime_service).catch(() => undefined);
    }
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('refreshed_environment_runtime');
  }
  broadcastDesktopWelcomeSnapshots();
  return launcherActionSuccess('refreshed_environment_runtime');
}

async function refreshAllEnvironmentRuntimesFromLauncher(): Promise<DesktopLauncherActionResult> {
  await refreshWelcomeRuntimeHealth({ force: true, mode: 'manual' });
  await refreshAllProviderEnvironmentRuntimeHealth().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[redeven:provider-runtime] Provider runtime refresh failed: ${message}`);
  });
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
    title: kind === 'restart' ? 'Restart Runtime Service' : 'Update Runtime Service',
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
    title: kind === 'restart' ? 'Restart Runtime Service' : 'Update Runtime Service',
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
        title: 'Restart SSH Runtime',
        message: 'Redeven Desktop will restart the SSH-hosted Runtime Service and reopen this session through a new local tunnel.',
        detail: 'Active work on the remote host may be interrupted while the runtime stops and starts again.',
        requiresTargetVersion: false,
      }),
      upgrade: runtimeMaintenanceActionPlan({
        availability: 'available',
        method: 'desktop_ssh_force_update',
        label: 'Update SSH runtime',
        title: 'Update SSH Runtime',
        message: 'Redeven Desktop will reinstall the SSH-hosted Runtime Service from the Desktop-managed release and reopen this session.',
        detail: 'The existing SSH bootstrap path, runtime package cache, and remote install fallback policy are reused for this update.',
        requiresTargetVersion: false,
      }),
    };
  }

  if (
    sessionRecord.target.kind === 'local_environment'
    && sessionRecord.target.route === 'local_host'
    && runtimeHandle?.runtime_kind === 'local_environment'
  ) {
    return {
      ...base,
      available: true,
      authority: 'desktop_local',
      runtime_kind: 'local_environment',
      lifecycle_owner: runtimeHandle.lifecycle_owner,
      service_owner: runtimeServiceOwnerForSession(sessionRecord),
      desktop_managed: desktopManaged,
      upgrade_policy: 'desktop_release',
      restart: runtimeMaintenanceActionPlan({
        availability: 'available',
        method: 'desktop_local_restart',
        label: 'Restart runtime',
        title: 'Restart Runtime Service',
        message: 'Redeven Desktop will restart this local Runtime Service and reopen the current session.',
        detail: 'Active work may be interrupted while the persistent service restarts.',
        requiresTargetVersion: false,
      }),
      upgrade: runtimeMaintenanceActionPlan({
        availability: 'available',
        method: 'desktop_local_update_handoff',
        label: 'Manage in Desktop',
        title: 'Update Redeven Desktop',
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

function desktopShellRuntimeActionUnavailable(messageOrFailure: string | DesktopOperationFailurePresentation): DesktopShellRuntimeActionResponse {
  const failure = typeof messageOrFailure === 'string' ? null : messageOrFailure;
  const message = failure?.summary ?? compact(messageOrFailure);
  return {
    ok: false,
    started: false,
    message,
    ...(failure ? { failure } : {}),
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
    runtime_root: previousTarget.runtime_root,
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
    const failure = desktopFailureFromError(error, {
      code: 'ssh_runtime_stop_failed',
      title: 'SSH Runtime Stop Failed',
      summary: 'Desktop could not stop the SSH runtime.',
      targetLabel: desktopSSHAuthority(sshDetails),
    });
    return desktopShellRuntimeActionUnavailable(failure);
  }

  sessionRecord.runtime_handle = null;
  sessionRecord.diagnostics.clearRuntime();

  const lifecycleOperation: DesktopRuntimeLifecycleOperation = options.forceRuntimeUpdate === true ? 'update' : 'restart';
  try {
    await startSSHEnvironmentRuntimeRecord(sshDetails, {
      environmentID: previousTarget.environment_id,
      label: previousTarget.label,
      forceRuntimeUpdate: options.forceRuntimeUpdate === true,
      allowActiveWorkReplacement: true,
    });
  } catch (error) {
    const failure = desktopFailureFromError(error, {
      code: 'ssh_runtime_launch_failed',
      title: runtimeLifecycleFailurePresentationTitle('ssh_host', false, lifecycleOperation),
      summary: runtimeLifecycleFailureSummary(lifecycleOperation),
      targetLabel: desktopSSHAuthority(sshDetails),
    });
    return desktopShellRuntimeActionUnavailable(failure);
  }

  let openRecord: SSHEnvironmentRuntimeRecord | null = null;
  try {
    await openSSHEnvironmentFromLauncher({
      kind: 'open_ssh_environment',
      environment_id: previousTarget.environment_id,
      label: previousTarget.label,
      ssh_destination: sshDetails.ssh_destination,
      ssh_port: sshDetails.ssh_port,
      auth_mode: sshDetails.auth_mode,
      runtime_root: sshDetails.runtime_root,
      bootstrap_strategy: sshDetails.bootstrap_strategy,
      release_base_url: sshDetails.release_base_url,
      connect_timeout_seconds: sshDetails.connect_timeout_seconds,
    });
    openRecord = sshEnvironmentRuntimeByKey.get(runtimeKey) ?? null;
  } catch (error) {
    const failure = desktopFailureFromError(error, {
      code: 'environment_open_failed',
      title: 'SSH Runtime Open Failed',
      summary: 'Desktop could not reopen the SSH runtime connection.',
      targetLabel: desktopSSHAuthority(sshDetails),
    });
    return desktopShellRuntimeActionUnavailable(failure);
  }
  if (!openRecord) {
    return desktopShellRuntimeActionUnavailable('Desktop restarted the SSH runtime, but could not prepare the SSH connection.');
  }

  sessionRecord.runtime_handle = openRecord.runtime_handle;
  sessionRecord.startup = openRecord.startup;
  sessionRecord.allowed_base_url = openRecord.local_forward_url;
  const nextTarget = buildSSHDesktopTarget(openRecord.details, {
    environmentID: openRecord.environment_id,
    label: openRecord.label,
    forwardedLocalUIURL: openRecord.local_forward_url,
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
      runtime_launch_mode: openRecord.runtime_handle.launch_mode,
      effective_run_mode: openRecord.startup.effective_run_mode ?? '',
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

async function showDesktopUpdateHandoffDialog(args: Readonly<{
  label: string;
  environmentKindLabel: string;
  detail: string;
}>): Promise<void> {
  const dialogOptions: MessageBoxOptions = {
    type: 'info',
    buttons: ['Open release page', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Manage Desktop Update',
    message: `${args.label} is managed by Redeven Desktop.`,
    detail: `${args.detail}\n\nAffected runtime: ${args.environmentKindLabel} for this profile.\n\nDesktop and remote access will continue to resolve to the same environment after the update.`,
  };
  const parentWindow = currentParentWindow();
  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);
  if (result.response === 0) {
    await openExternalURL(PUBLIC_REDEVEN_RELEASE_BASE_URL);
  }
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
  if (sessionRecord.runtime_handle.runtime_kind !== 'local_environment') {
    return {
      ok: false,
      started: false,
      message: 'Desktop could not resolve a local runtime management channel for this environment.',
    };
  }

  const environmentKindLabel = sessionRecord.target.local_environment_kind === 'controlplane'
    ? 'Provider environment'
    : 'Local environment';
  const detail = sessionRecord.target.local_environment_kind === 'controlplane'
    ? 'Desktop will keep this environment in the same provider-backed Local Environment profile and may need a newer desktop release before redeploying the managed runtime.'
    : 'Desktop will keep this environment on the same Local Environment profile and may need a newer desktop release before restarting the managed runtime.';
  await showDesktopUpdateHandoffDialog({
    label: sessionRecord.target.label,
    environmentKindLabel,
    detail,
  });
  return {
    ok: true,
    started: false,
    message: 'Desktop opened the update handoff.',
  };
}

function codeWorkspaceEnginePlatformFromStatus(status: unknown): DesktopCodeWorkspaceEnginePackagePlatform {
  const record = status && typeof status === 'object' ? status as Record<string, unknown> : {};
  const platform = record.platform && typeof record.platform === 'object' ? record.platform as Record<string, unknown> : {};
  const osName = String(platform.os ?? '').trim();
  const arch = String(platform.arch ?? '').trim();
  const libc = String(platform.libc ?? '').trim();
  const platformID = String(platform.platform_id ?? '').trim();
  if (osName !== 'linux' && osName !== 'darwin') {
    throw new Error('This Environment is not supported by the managed workspace engine.');
  }
  if (arch !== 'amd64' && arch !== 'arm64') {
    throw new Error('This Environment architecture is not supported by the managed workspace engine.');
  }
  if (osName === 'linux' && libc !== '' && libc !== 'glibc' && libc !== 'unknown') {
    throw new Error('This Linux Environment is not supported by the managed workspace engine.');
  }
  return {
    os: osName,
    arch,
    ...(osName === 'linux' ? { libc: libc === 'unknown' ? 'unknown' : 'glibc' } : {}),
    platform_id: platformID || (osName === 'linux' ? `${osName}-${arch}-${libc || 'glibc'}` : `${osName}-${arch}`),
  };
}

function codeWorkspaceEngineReady(status: unknown): boolean {
  const record = status && typeof status === 'object' ? status as Record<string, unknown> : {};
  const active = record.active_runtime && typeof record.active_runtime === 'object'
    ? record.active_runtime as Record<string, unknown>
    : {};
  return String(active.detection_state ?? '').trim() === 'ready';
}

async function prepareCodeWorkspaceEnginePackageJob(
  platform: DesktopCodeWorkspaceEnginePackagePlatform,
): Promise<DesktopCodeWorkspacePackagePrepareResponse> {
  try {
    pruneDesktopCodeWorkspaceEnginePackageJobs();
    const preparedPackage = await prepareCodeWorkspaceEnginePackage({
      cacheRoot: desktopCodeWorkspaceEnginePackageCacheRoot(),
      platform,
      fetchPolicy: {
        timeout_ms: 60_000,
      },
    });
    const stat = await fs.stat(preparedPackage.archive_path);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error('Workspace engine package is empty.');
    }
    if (stat.size > DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_ARCHIVE_LIMIT) {
      throw new Error(`Workspace engine package is too large (${stat.size} bytes).`);
    }
    const jobID = `cwepkg_${crypto.randomBytes(18).toString('base64url')}`;
    desktopCodeWorkspaceEnginePackageJobs.set(jobID, {
      jobID,
      archivePath: preparedPackage.archive_path,
      manifest: preparedPackage.manifest,
      archiveSizeBytes: stat.size,
      chunkSizeBytes: DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_CHUNK_SIZE,
      fromCache: preparedPackage.from_cache,
      createdAtMs: Date.now(),
    });
    return {
      ok: true,
      job: {
        job_id: jobID,
        manifest: preparedPackage.manifest,
        archive_size_bytes: stat.size,
        chunk_size_bytes: DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_CHUNK_SIZE,
        from_cache: preparedPackage.from_cache,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Desktop could not prepare the workspace package.',
    };
  }
}

async function readCodeWorkspaceEnginePackageJobChunk(
  jobID: string,
  offsetBytes: number,
  lengthBytes: number,
): Promise<DesktopCodeWorkspacePackageChunkResponse> {
  pruneDesktopCodeWorkspaceEnginePackageJobs();
  const job = desktopCodeWorkspaceEnginePackageJobs.get(jobID);
  if (!job) {
    return {
      ok: false,
      message: 'Workspace package is no longer available.',
    };
  }
  const offset = Math.max(0, Math.floor(offsetBytes));
  const length = Math.max(1, Math.min(Math.floor(lengthBytes), job.chunkSizeBytes));
  if (offset > job.archiveSizeBytes) {
    return {
      ok: false,
      message: 'Workspace package chunk offset is out of range.',
    };
  }
  const bytesToRead = Math.min(length, job.archiveSizeBytes - offset);
  if (bytesToRead <= 0) {
    return {
      ok: true,
      chunk: new Uint8Array(),
      offset_bytes: offset,
      length_bytes: 0,
      done: true,
    };
  }
  const handle = await fs.open(job.archivePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset);
    return {
      ok: true,
      chunk: new Uint8Array(buffer.subarray(0, bytesRead)),
      offset_bytes: offset,
      length_bytes: bytesRead,
      done: offset + bytesRead >= job.archiveSizeBytes,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Desktop could not read the workspace package.',
    };
  } finally {
    await handle.close();
  }
}

function disposeCodeWorkspaceEnginePackageJob(jobID: string): DesktopCodeWorkspacePackageDisposeResponse {
  desktopCodeWorkspaceEnginePackageJobs.delete(jobID);
  return { ok: true };
}

async function prepareCodeWorkspaceEngineFromDesktop(webContentsID: number): Promise<DesktopCodeWorkspacePrepareResponse> {
  const sessionRecord = sessionRecordForWebContentsID(webContentsID);
  if (!sessionRecord) {
    return {
      ok: false,
      prepared: false,
      message: 'Desktop could not resolve this Environment session.',
    };
  }
  const endpoint = sessionRecord.startup.runtime_control;
  if (!endpoint) {
    return {
      ok: false,
      prepared: false,
      message: 'Restart this Environment from Desktop, then try opening the workspace again.',
    };
  }
  if (endpoint.desktop_owner_id !== await desktopRuntimeOwnerID()) {
    return {
      ok: false,
      prepared: false,
      message: 'This Environment is managed by another Desktop instance.',
    };
  }

  try {
    const currentStatus = await getCodeWorkspaceEngineStatus(endpoint);
    if (codeWorkspaceEngineReady(currentStatus)) {
      return {
        ok: true,
        prepared: true,
        status: currentStatus,
      };
    }
    const platform = codeWorkspaceEnginePlatformFromStatus(currentStatus);
    const preparedPackage: CodeWorkspaceEnginePackageCacheEntry = await prepareCodeWorkspaceEnginePackage({
      cacheRoot: desktopCodeWorkspaceEnginePackageCacheRoot(),
      platform,
      fetchPolicy: {
        timeout_ms: 60_000,
      },
    });
    const status = await uploadCodeWorkspaceEngineViaRuntimeControl({
      endpoint,
      manifest: preparedPackage.manifest,
      archivePath: preparedPackage.archive_path,
      maxArchiveBytes: DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_ARCHIVE_LIMIT,
    });
    return {
      ok: true,
      prepared: true,
      status,
      message: preparedPackage.from_cache ? 'Workspace engine was ready from Desktop cache.' : 'Workspace engine prepared.',
    };
  } catch (error) {
    const failure = desktopFailureFromError(error, {
      code: 'workspace_engine_prepare_failed',
      title: 'Workspace Preparation Failed',
      summary: 'Desktop could not prepare the workspace engine.',
      targetLabel: sessionRecord.target.label,
    });
    return {
      ok: false,
      prepared: false,
      message: failure.summary,
      status: {
        failure,
      },
    };
  }
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
  autoRuntimeProbeEnabled: boolean,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const existing = preferences.saved_environments.find((environment) => environment.id === environmentID);
  const next = upsertSavedEnvironment(preferences, {
    environment_id: environmentID,
    label,
    local_ui_url: externalLocalUIURL,
    auto_runtime_probe_enabled: autoRuntimeProbeEnabled,
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
  const next = updateLocalEnvironmentSettings(preferences, {
    environmentID: existing.id,
    access,
  });
  const resolvedEnvironment = next.local_environment;
  await persistDesktopPreferences(next);
  return resolvedEnvironment;
}

async function upsertSavedSSHEnvironmentFromWelcome(
  environmentID: string,
  label: string,
  details: DesktopSSHEnvironmentDetails,
  passwordInput: Readonly<{
    ssh_password?: string;
    ssh_password_mode?: 'keep' | 'replace' | 'clear';
    auto_runtime_probe_enabled?: boolean;
  }>,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const existing = preferences.saved_ssh_environments.find((environment) => environment.id === environmentID);
  const passwordMode = passwordInput.ssh_password_mode;
  const sshPasswordConfigured = details.auth_mode === 'password'
    ? passwordMode === 'clear'
      ? false
      : passwordMode === 'replace'
        ? compact(passwordInput.ssh_password) !== ''
        : undefined
    : false;
  const next = upsertSavedSSHEnvironment(preferences, {
    environment_id: environmentID,
    label,
    ssh_destination: details.ssh_destination,
    ssh_port: details.ssh_port,
    auth_mode: details.auth_mode,
    runtime_root: details.runtime_root,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
    connect_timeout_seconds: details.connect_timeout_seconds,
    ssh_password: passwordMode === 'replace' ? compact(passwordInput.ssh_password) : '',
    ...(sshPasswordConfigured === undefined ? {} : { ssh_password_configured: sshPasswordConfigured }),
    auto_runtime_probe_enabled: passwordInput.auto_runtime_probe_enabled === true,
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
    runtime_root: details.runtime_root,
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
  let placement = request.placement;
  if (request.placement.kind === 'container_process') {
    placement = await assertRuntimeTargetContainerRunning(request.host_access, request.placement);
  }
  const preferences = await loadDesktopPreferencesCached();
  const next = upsertSavedRuntimeTarget(preferences, {
    id: request.environment_id,
    label: request.label,
    host_access: request.host_access,
    placement,
    ssh_password: request.ssh_password_mode === 'replace' ? compact(request.ssh_password) : '',
    ...(request.ssh_password_mode === 'clear'
      ? { ssh_password_configured: false }
      : request.ssh_password_mode === 'replace'
        ? { ssh_password_configured: compact(request.ssh_password) !== '' }
        : {}),
    auto_runtime_probe_enabled: request.auto_runtime_probe_enabled,
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
  const runtimeTargetID = compact(environmentID) as DesktopRuntimeTargetID;
  launcherOperations.markSubjectDeleted('runtime_target', runtimeTargetID, {
    status: 'canceling',
    phase: 'canceling_deleted_connection',
    title: 'Runtime target removed',
    detail: 'Desktop is canceling any startup task that still belongs to this deleted runtime target.',
    cancelable: false,
    deleted_subject: true,
  });
  const pendingStart = pendingRuntimePlacementStartByTargetID.get(runtimeTargetID) ?? null;
  if (pendingStart) {
    launcherOperations.cancel(pendingStart.operation_key, 'Runtime target removed. Desktop is canceling the runtime startup task in the background.');
  }
  await persistDesktopPreferences(deleteSavedRuntimeTarget(preferences, environmentID));
  const runtimeRecord = await verifyRuntimePlacementBridgeRecord(runtimeTargetID);
  if (runtimeRecord) {
    const liveRuntimeSession = liveSession(desktopSessionKeyFromRuntimeTargetID(runtimeTargetID));
    if (liveRuntimeSession) {
      await finalizeSessionClosure(liveRuntimeSession.session_key);
    }
  }
  await clearRuntimePlacementTargetRecords(runtimeTargetID);
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
    const targetLabel = normalized.host_access.kind === 'ssh_host'
      ? desktopSSHAuthority(normalized.host_access.ssh)
      : 'Local Host';
    const failure = desktopFailureFromError(error, {
      code: 'runtime_host_command_failed',
      title: 'Container List Failed',
      summary: `Desktop could not list running ${normalized.engine} containers${hostLabel}.`,
      recoveryHint: normalized.host_access.kind === 'ssh_host'
        ? 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.'
        : 'Check that the container engine is installed and running on this device.',
      targetLabel,
    });
    return {
      ok: false,
      message: failure.summary,
      failure,
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
    case 'prepare_environment_open':
      return launcherActionFailure(
        'action_invalid',
        'environment',
        'Open connection preparation is started by the Open action.',
        {
          environmentID: request.environment_id,
        },
      );
    case 'start_environment_runtime':
      return startEnvironmentRuntimeFromLauncher(request);
    case 'restart_environment_runtime':
      return restartEnvironmentRuntimeFromLauncher(request);
    case 'update_environment_runtime':
      return updateEnvironmentRuntimeFromLauncher(request);
    case 'manage_desktop_update':
      return manageDesktopUpdateFromLauncher(request);
    case 'connect_provider_runtime':
      return connectProviderRuntimeFromLauncher(request);
    case 'disconnect_provider_runtime':
      return disconnectProviderRuntimeFromLauncher(request);
    case 'cancel_launcher_operation':
      return cancelLauncherOperationFromLauncher(request);
    case 'dismiss_launcher_operation':
      return dismissLauncherOperationFromLauncher(request);
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
          runtime_root: request.runtime_root,
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
          auto_runtime_probe_enabled: request.auto_runtime_probe_enabled,
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
      await upsertSavedEnvironmentFromWelcome(
        request.environment_id,
        request.label,
        request.external_local_ui_url,
        request.auto_runtime_probe_enabled,
      );
      return launcherActionSuccess('saved_environment');
    case 'upsert_saved_ssh_environment':
      await upsertSavedSSHEnvironmentFromWelcome(request.environment_id, request.label, {
        ssh_destination: request.ssh_destination,
        ssh_port: request.ssh_port,
        auth_mode: request.auth_mode,
        runtime_root: request.runtime_root,
        bootstrap_strategy: request.bootstrap_strategy,
        release_base_url: request.release_base_url,
        connect_timeout_seconds: request.connect_timeout_seconds,
      }, {
        ssh_password: request.ssh_password,
        ssh_password_mode: request.ssh_password_mode,
        auto_runtime_probe_enabled: request.auto_runtime_probe_enabled,
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
    launcherOperations.cancel(pendingStart.operation_key, 'Redeven Desktop is quitting and canceling this runtime startup task.');
  }
  for (const pendingStart of pendingRuntimePlacementStartByTargetID.values()) {
    launcherOperations.cancel(pendingStart.operation_key, 'Redeven Desktop is quitting and canceling this runtime startup task.');
  }
  const pendingSSHStartPromises = [...pendingSSHRuntimeStartByKey.values()].map((pendingStart) => (
    pendingStart.task.catch(() => undefined)
  ));
  const pendingPlacementStartPromises = [...pendingRuntimePlacementStartByTargetID.values()].map((pendingStart) => (
    pendingStart.task.catch(() => undefined)
  ));
  const sessionClosePromises = [...sessionsByKey.keys()].map((sessionKey) => finalizeSessionClosure(sessionKey));
  const sshDisconnectPromises = [...sshEnvironmentRuntimeByKey.values()].map((runtimeRecord) => runtimeRecord.disconnect());
  const runtimePlacementDisconnectPromises = [...runtimePlacementBridgeByTargetID.values()].map(async (runtimeRecord) => {
    await runtimeRecord.desktop_model_source?.stop().catch(() => undefined);
    await runtimeRecord.session.disconnect().catch(() => undefined);
  });
  sshEnvironmentRuntimeByKey.clear();
  runtimePlacementBridgeByTargetID.clear();
  sshRuntimeMaintenanceByKey.clear();
  runtimePlacementMaintenanceByTargetID.clear();
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
  await Promise.allSettled(runtimePlacementDisconnectPromises);
  await Promise.race([
    Promise.allSettled([
      ...pendingSSHStartPromises,
      ...pendingPlacementStartPromises,
    ]),
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

  ipcMain.handle(DESKTOP_DOWNLOAD_PREPARE_CHANNEL, async (event, request) => {
    const normalized = normalizeDesktopDownloadPrepareRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Invalid desktop download request.',
      };
    }
    return desktopDownloadWriter.prepare(BrowserWindow.fromWebContents(event.sender), normalized);
  });
  ipcMain.handle(DESKTOP_DOWNLOAD_WRITE_CHANNEL, async (_event, request) => {
    const normalized = normalizeDesktopDownloadWriteRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Invalid desktop download chunk.',
      };
    }
    return desktopDownloadWriter.write(normalized);
  });
  ipcMain.handle(DESKTOP_DOWNLOAD_COMPLETE_CHANNEL, async (_event, request) => {
    const normalized = normalizeDesktopDownloadCompleteRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Invalid desktop download completion request.',
      };
    }
    return desktopDownloadWriter.complete(normalized.token);
  });
  ipcMain.handle(DESKTOP_DOWNLOAD_ABORT_CHANNEL, async (_event, request) => {
    const normalized = normalizeDesktopDownloadAbortRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Invalid desktop download abort request.',
      };
    }
    return desktopDownloadWriter.abort(normalized);
  });
  ipcMain.handle(DESKTOP_DOWNLOAD_REVEAL_CHANNEL, async (_event, request) => {
    const normalized = normalizeDesktopDownloadActionRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Invalid desktop download reveal request.',
      };
    }
    return desktopDownloadWriter.reveal(normalized.token);
  });
  ipcMain.handle(DESKTOP_DOWNLOAD_OPEN_CHANNEL, async (_event, request) => {
    const normalized = normalizeDesktopDownloadActionRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Invalid desktop download open request.',
      };
    }
    return desktopDownloadWriter.open(normalized.token);
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
      const next = updateLocalEnvironmentSettings(previous, {
        environmentID: settingsEnvironment.id,
        access: validated,
      });
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
    buildStampedDesktopWelcomeSnapshot(senderUtilityWindowKind(event.sender.id))
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
      const result = await performDesktopLauncherAction(normalized);
      scheduleWelcomeRuntimeHealthRefreshAfterLauncherAction(normalized, result);
      return result;
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
  ipcMain.handle(DESKTOP_CODE_WORKSPACE_PREPARE_CHANNEL, async (event, request): Promise<DesktopCodeWorkspacePrepareResponse> => {
    const normalized = normalizeDesktopCodeWorkspacePrepareRequest(request);
    void normalized;
    return prepareCodeWorkspaceEngineFromDesktop(event.sender.id);
  });
  ipcMain.handle(DESKTOP_CODE_WORKSPACE_PACKAGE_PREPARE_CHANNEL, async (_event, request): Promise<DesktopCodeWorkspacePackagePrepareResponse> => {
    const normalized = normalizeDesktopCodeWorkspacePackagePrepareRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Desktop received an invalid workspace package request.',
      };
    }
    return prepareCodeWorkspaceEnginePackageJob(normalized.platform);
  });
  ipcMain.handle(DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_CHANNEL, async (_event, request): Promise<DesktopCodeWorkspacePackageChunkResponse> => {
    const normalized = normalizeDesktopCodeWorkspacePackageChunkRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Desktop received an invalid workspace package chunk request.',
      };
    }
    return readCodeWorkspaceEnginePackageJobChunk(normalized.job_id, normalized.offset_bytes, normalized.length_bytes);
  });
  ipcMain.handle(DESKTOP_CODE_WORKSPACE_PACKAGE_DISPOSE_CHANNEL, async (_event, request): Promise<DesktopCodeWorkspacePackageDisposeResponse> => {
    const normalized = normalizeDesktopCodeWorkspacePackageDisposeRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Desktop received an invalid workspace package cleanup request.',
      };
    }
    return disposeCodeWorkspaceEnginePackageJob(normalized.job_id);
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
    void pruneDesktopRuntimePackageCacheForCurrentRelease().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[redeven:runtime-package-cache] Cache cleanup failed: ${message}`);
    });
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
    scheduleWelcomeRuntimeHealthRefresh({ force: true });
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
