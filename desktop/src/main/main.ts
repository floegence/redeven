import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, powerMonitor, safeStorage, session, shell, webContents as electronWebContents, WebContentsView, type Session, type WebContents } from 'electron';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import http, { type ClientRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { safeLogText } from './logSafety';
import {
  attachManagedRuntimeFromStatus,
  inspectLocalManagedRuntimeProcesses,
  startManagedRuntime,
  stopLocalManagedRuntimeProcesses,
  type ManagedRuntimeProgress,
} from './runtimeProcess';
import {
  ReinstallTargetCoordinator,
  ReinstallTargetCoordinatorError,
  reinstallTargetDescriptorFingerprint,
  type ReinstallTargetDescriptor,
} from './reinstallTargetCoordinator';
import {
  prepareAndStageBatch,
  type PreparedComponentBatch,
  type ManagedComponentTask,
} from './managedComponentBatchInstaller';
import {
  activateManagedComponentBatch,
  cleanupManagedComponentBatch,
  rollbackManagedComponentBatch,
  stageManagedComponent,
  startManagedComponentBatch,
} from './reinstallComponentStaging';
import {
  reinstallTargetStepProgress,
  type ReinstallTargetProgressPhase,
} from '../shared/desktopReinstallProgress';
import { openReinstallTargetProcessSession } from './reinstallTargetProcess';
import {
	beginRuntimeFlowerAttachmentWrite,
	endRuntimeFlowerAttachmentWrite,
	finishRuntimeFlowerAttachmentOperation,
  trackRuntimeFlowerAttachmentOperation,
} from './runtimeFlowerAttachmentOperationLifecycle';
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
import { buildDesktopUpdateHandoffMessageBoxOptions } from './desktopUpdateHandoff';
import { DesktopCodeWorkspacePackageJobStore } from './codeWorkspaceEnginePackageJobs';
import type { DesktopConfirmationDialogModel } from '../shared/desktopConfirmationContract';
import { createDesktopI18n } from '../shared/i18n/desktopI18n';
import type { DesktopTranslationKey } from '../shared/i18n/locales/en-US';
import {
  createSafeStorageSecretCodec,
  deleteSavedControlPlane,
  deleteSavedEnvironment,
  deleteSavedRuntimeTarget,
  defaultDesktopPreferencesPaths,
  findLocalEnvironmentByID,
  findProviderEnvironmentByID,
  loadDesktopPreferences,
  rememberLocalEnvironmentUse,
  rememberProviderEnvironmentUse,
  markSavedEnvironmentUsed,
  markSavedRuntimeTargetUsed,
  saveDesktopPreferences,
  setLocalEnvironmentPinned,
  setProviderEnvironmentPinned,
  setSavedEnvironmentPinned,
  setSavedRuntimeTargetPinned,
  updateLocalEnvironmentSettings,
  upsertSavedControlPlane,
  upsertSavedEnvironment,
  upsertSavedRuntimeTarget,
  validateDesktopSettingsDraft,
  type DesktopPreferences,
  type DesktopSavedEnvironment,
  type DesktopSavedControlPlane,
  type DesktopSavedRuntimeTarget,
} from './desktopPreferences';
import {
  buildLocalEnvironmentDesktopTarget,
  buildManagedLocalRuntimeDesktopTarget,
  desktopSessionKeyFromRuntimeTargetID,
  buildExternalLocalUIDesktopTarget,
  buildProviderEnvironmentDesktopTarget,
  buildSSHDesktopTarget,
  desktopSessionTargetsReferToSameEnvironment,
  desktopSessionStateKeyFragment,
  externalLocalUIDesktopSessionKey,
  sshDesktopSessionKey,
  type DesktopSessionLifecycle,
  type DesktopSessionKey,
  type DesktopSessionSummary,
  type DesktopSessionTarget,
} from './desktopTarget';
import { desktopSessionContextSnapshotFromTarget } from './desktopSessionContext';
import { buildDesktopRuntimeLaunchPlan, desktopAutoStartRuntimeEnabled } from './desktopLaunch';
import { loadDesktopBundle, type DesktopBundle } from './desktopBundle';
import {
  DesktopWelcomeRuntimeHealthStore,
  desktopWelcomeRuntimeHealthForEnvironment,
  type DesktopWelcomeRuntimeHealthProbeEvent,
  type DesktopWelcomeRuntimeHealthProbeResult,
  type DesktopWelcomeRuntimeHealthTarget,
} from './desktopWelcomeRuntimeHealth';
import {
  resolveConfiguredDesktopCacheRoot,
  resolveConfiguredDesktopTempRoot,
  resolveConfiguredDesktopUserDataRoot,
} from './statePaths';
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
import {
  GatewayStore,
  defaultGatewayStorePath,
  gatewayBindingAudience,
  gatewayRecordToSource,
  gatewayRecordToSourceWithCatalog,
  gatewayRecordToSourceWithError,
  gatewayRecordSSHPasswordRef,
  normalizeGatewayBaseURL,
  stableGatewayID,
  type GatewayRecord,
} from './gatewayStore';
import {
  buildPairingCompleteRequest,
  assertGatewayPairingChallenge,
  assertGatewayPairingCompleteResponse,
  completeGatewayPairing,
  createGatewayPairingMaterial,
  pairingChallengeRequest,
  pairingChallengeRequestWithCode,
  GatewayTrustError,
  type GatewaySecretStore,
} from './gatewayTrust';
import {
  GatewayClientError,
  GatewayURLClient,
  type GatewayRuntimeOperation,
  type GatewayRuntimeOperationConfirmationRequest,
} from './gatewayClient';
import {
  ProviderRuntimeLifecycleClient,
  type ProviderRuntimeLifecycleScope,
} from './providerRuntimeLifecycleClient';
import {
  GatewayLifecycleManager,
  GatewayNotManageableError,
  GatewayReinstallRequiredError,
  GatewayServiceStartRequiredError,
  GatewayServiceUnavailableError,
  gatewayServiceTargetDescriptor,
  type GatewayLifecycleProgressSink,
  type GatewayStartPolicy,
  type GatewayServiceLifecycleProgress,
  type GatewayServiceTargetDescriptor,
} from './gatewayLifecycleManager';
import {
  probeManagedGatewayServiceDeep,
  type GatewayServiceDeepProbe,
  type GatewayServiceHostOptions,
} from './gatewayServiceHost';
import { DesktopThemeState } from './desktopThemeState';
import {
  buildCodespaceLoadingDocumentURL,
  type CodespaceLoadingWindowCopy,
} from './codespaceLoadingDocument';
import { DesktopLanguageState } from './desktopLanguageState';
import { DesktopDiagnosticsRecorder } from './diagnostics';
import { DesktopDownloadWriter } from './desktopDownloadWriter';
import { DesktopWelcomeSnapshotOrder } from './desktopWelcomeSnapshotOrder';
import {
  DesktopOperationFailureError,
  desktopOperationFailurePresentation,
  isDesktopOperationFailureError,
  operationFailureFromUnknown,
} from './desktopOperationFailure';
import {
  RuntimeLifecycleStepFailureError,
  RuntimeLifecycleWorkflow,
  runtimeLifecyclePlanPatchPreservingObservedHistory,
  runtimeLifecycleStepIDFromError,
  type RuntimeLifecyclePlanPatch,
} from './runtimeLifecycleWorkflow';
import {
  initialRuntimeLifecyclePlan,
  runtimeLifecyclePlanAfterProcessInventory,
  runtimeLifecyclePlanIncludingStep,
} from './runtimeLifecycleExecutionPlan';
import {
  RuntimeLifecycleCoordinator,
  RuntimeLifecycleInProgressError,
  runtimeLifecycleFingerprint,
  runtimeLifecycleTargetKey,
  type RuntimeLifecycleIntent,
} from './runtimeLifecycleCoordinator';
import { LauncherOperationRegistry, launcherOperationProgress, type LauncherOperationAttemptIdentity } from './launcherOperations';
import {
	invalidateRuntimeFlowerAccessOnStatus,
	parseRuntimeFlowerJSON,
	readRuntimeFlowerHTTPResponse,
	requestRuntimeFlowerHTTP as runtimeFlowerRequestHTTP,
  openRuntimeFlowerHTTPStream,
  runtimeFlowerDeleteQuery,
	runtimeFlowerInvalidJSONError,
  type RuntimeFlowerHTTPResponse,
} from './runtimeFlowerHTTP';
import {
  materializeRuntimeFlowerAttachmentPreview,
  requestRuntimeFlowerAttachmentPreviewWithAccess,
} from './runtimeFlowerAttachmentPreview';
import {
  requireLocalUIBridgeURL,
  resolveDesktopSessionTransport,
  shouldFailDesktopSessionMainDocument,
  type DesktopSessionTransport,
} from './desktopSessionTransport';
import { isAllowedAppNavigation, isAllowedCodespaceWindowNavigation, isAllowedWebServiceWindowNavigation, resolveWebServiceBrowserAddress, webServiceBrowserDisplayURL } from './navigation';
import { resolveBundledRuntimePath, resolveSessionPreloadPath, resolveUtilityPreloadPath, resolveWebServiceBrowserPreloadPath, resolveWelcomeRendererPath } from './paths';
import { buildWebServiceBrowserDocumentURL } from './webServiceBrowserDocument';
import { isMarkedWebServiceUpstreamUnavailable } from './webServiceBrowserProxyFailure';
import { isWebServiceBrowserDevToolsShortcut } from './webServiceBrowserShortcuts';
import { buildWebServiceUnavailableDocumentURL } from './webServiceUnavailableDocument';
import {
  probeExternalLocalUIHealth,
  probeExternalLocalUIStartup,
} from './runtimeState';
import { desktopFailureForRuntimePlacementBridgeReadiness } from './runtimePlacementBridgeReadiness';
import {
  RuntimeControlError,
  connectProviderLink,
  disconnectProviderLink,
} from './runtimeControlClient';
import { desktopSessionRuntimeHandleFromManagedRuntime, type DesktopSessionRuntimeHandle } from './sessionRuntime';
import {
  parseManagedSSHRuntimeProbeResult,
  ensureManagedSSHRuntimeReady,
  openManagedSSHRuntimeProcessSession,
  probeManagedSSHRuntimeStatus,
  type DesktopSSHRuntimeProgress,
} from './sshRuntime';
import {
  containerListCommand,
  containerInspectCommand,
  containerStartCommand,
  containerRuntimeDaemonStatusCommand,
  containerRuntimeProbeCommand,
  containerRuntimeCommandFailureStatus,
  containerRuntimePlatformProbeCommand,
  parseContainerPlatformProbeOutput,
  parseContainerListOutput,
  parseContainerInspectJSON,
  prepareRuntimeContainerLifecycleTarget,
  resolveRuntimeContainerPlacement,
  type DesktopRuntimeContainerResolution,
  type DesktopRuntimeContainerResolver,
} from './containerRuntime';
import { parseLaunchReport } from './launchReport';
import {
  createLocalRuntimeHostExecutor,
  createSSHRuntimeHostExecutor,
} from './runtimeHostAccess';
import {
  DefaultDesktopSSHTransportManager,
  DesktopSSHRemoteCommandError,
  DesktopSSHTransportInterruptedError,
  DesktopSSHTransportUnavailableError,
} from './sshTransportManager';
import {
  startRuntimePlacementBridgeSession,
  type RuntimePlacementBridgeSession,
  type RuntimePlacementBridgeTermination,
} from './runtimePlacementBridgeSession';
import {
  RuntimePlacementBridgeRegistry,
  type RuntimePlacementBridgeAttachment,
  type RuntimePlacementBridgeRecord,
} from './runtimePlacementBridgeRegistry';
import { observeRuntimePlacementBridge } from './runtimePlacementBridgeObservation';
import {
  RuntimeProcessCommandError,
  desktopRuntimeProcessStopTargetCount,
  requireDesktopRuntimeProcessIdentity,
  type DesktopRuntimeProcessInventory,
  type DesktopRuntimeProcessStopResult,
} from './runtimeProcessInventory';
import { startDesktopModelSource, type ManagedDesktopModelSource } from './desktopModelSource';
import {
  prepareDesktopRuntimeMaintenanceHelperAsset,
  prepareDesktopRuntimeUploadAsset,
  pruneDesktopRuntimePackageCache,
  runtimePackageCacheRoot,
  runtimeReleaseFetchPolicy,
} from './runtimePackageCache';
import {
  codeWorkspaceEnginePackageCacheRoot,
  prepareCodeWorkspaceEnginePackage,
} from './codeWorkspaceEnginePackageCache';
import {
  PUBLIC_REDEVEN_RELEASE_BASE_URL,
  buildDesktopSSHReleaseAssetURL,
  desktopSSHReleasePackageName,
  ensureDesktopSSHVerifiedReleaseManifest,
  resolveDesktopSSHRemotePlatform,
  type DesktopSSHRemotePlatform,
} from './sshReleaseAssets';
import {
  ensureRuntimePlacementReady,
  openContainerRuntimeProcessSession,
  type RuntimePlacementProgress,
} from './runtimePlacementManager';
import {
  preflightPublishedRuntimeLifecycleArtifact,
  prepareCustomRuntimeLifecycleArtifact,
  preparePublishedRuntimeLifecycleArtifact,
  type PublishedRuntimeLifecyclePreflight,
} from './runtimeLifecycleArtifact';
import { advanceGatewayRuntimeOperation } from './runtimeLifecycleCompletion';
import { startRuntimeOperationLease, type RuntimeOperationLease } from './runtimeOperationLease';
import {
  waitForDesktopRuntimeLifecycleReadiness,
  type DesktopRuntimeLifecycleReadinessOperation,
} from './runtimeLifecycleReadiness';
import {
  projectAttachedRuntimeOperation,
  runtimeOperationRequiresConfirmation,
} from './runtimeLifecycleAttachment';
import {
  type ManagedRuntimeLifecycleOperation,
} from './environmentOpenCoordinator';
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
  desktopProviderEnvironmentID,
  type DesktopProviderEnvironmentRecord,
} from '../shared/desktopProviderEnvironment';
import {
  authorizeProviderRuntimeOperation,
  exchangeProviderDesktopConnectAuthorization,
  fetchProviderAccount,
  fetchProviderDiscovery,
  fetchProviderEnvironments,
  fetchProviderRuntimeManagementCapability,
  queryProviderEnvironmentRuntimeHealth,
  refreshProviderDesktopAccessToken,
  revokeProviderDesktopAuthorization,
  requestDesktopOpenSession,
  requestProviderRuntimeLinkAuthorization,
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
  CANCEL_RUNTIME_FLOWER_STREAM_CHANNEL,
  REQUEST_RUNTIME_FLOWER_CHANNEL,
  RUNTIME_FLOWER_STREAM_EVENT_CHANNEL,
  START_RUNTIME_FLOWER_STREAM_CHANNEL,
  normalizeRuntimeFlowerStreamID,
  normalizeRuntimeFlowerStreamRequest,
  type RuntimeFlowerError,
  type RuntimeFlowerRequest,
  type RuntimeFlowerRequestResult,
  type RuntimeFlowerStreamEvent,
  type RuntimeFlowerStreamStartResult,
} from '../shared/runtimeFlowerIPC';
import {
  CANCEL_RUNTIME_FLOWER_ATTACHMENT_CHANNEL,
  COMMIT_RUNTIME_FLOWER_ATTACHMENT_CHANNEL,
  PREPARE_RUNTIME_FLOWER_ATTACHMENT_CHANNEL,
  PREVIEW_RUNTIME_FLOWER_ATTACHMENT_CHANNEL,
  RUNTIME_FLOWER_ATTACHMENT_CHUNK_SIZE_BYTES,
  RUNTIME_FLOWER_ATTACHMENT_PROGRESS_CHANNEL,
  WRITE_RUNTIME_FLOWER_ATTACHMENT_CHUNK_CHANNEL,
  normalizeRuntimeFlowerAttachmentChunkRequest,
  normalizeRuntimeFlowerAttachmentOperationRequest,
  normalizeRuntimeFlowerAttachmentPrepareRequest,
  normalizeRuntimeFlowerAttachmentPreviewRequest,
  type RuntimeFlowerAttachmentCancelResponse,
  type RuntimeFlowerAttachmentChunkResponse,
  type RuntimeFlowerAttachmentCommitResponse,
  type RuntimeFlowerAttachmentPrepareRequest,
  type RuntimeFlowerAttachmentPrepareResponse,
  type RuntimeFlowerAttachmentProgress,
  type RuntimeFlowerAttachmentPreviewRequest,
  type RuntimeFlowerAttachmentPreviewResponse,
} from '../shared/runtimeFlowerAttachmentIPC';
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
  DESKTOP_THEME_SET_SHELL_THEME_CHANNEL,
  DESKTOP_THEME_SET_SOURCE_CHANNEL,
  desktopRendererThemeSnapshot,
} from '../shared/desktopThemeIPC';
import {
  DESKTOP_LANGUAGE_GET_SNAPSHOT_CHANNEL,
  DESKTOP_LANGUAGE_SET_PREFERENCE_CHANNEL,
} from '../shared/desktopLanguageIPC';
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
  DESKTOP_SHELL_RUNTIME_MAINTENANCE_STARTED_CHANNEL,
  DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL,
  normalizeDesktopShellRuntimeMaintenanceStartedNotification,
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
  DESKTOP_SHELL_OPEN_CODESPACE_WINDOW_CHANNEL,
  normalizeDesktopShellOpenCodespaceWindowRequest,
  type DesktopShellOpenCodespaceWindowRequest,
  type DesktopShellOpenCodespaceWindowResponse,
} from '../shared/desktopShellCodespaceWindowIPC';
import {
  DESKTOP_SHELL_OPEN_WEB_SERVICE_WINDOW_CHANNEL,
  normalizeDesktopShellOpenWebServiceWindowRequest,
  type DesktopShellOpenWebServiceWindowRequest,
  type DesktopShellOpenWebServiceWindowResponse,
} from '../shared/desktopShellWebServiceWindowIPC';
import {
  DESKTOP_WEB_SERVICE_BROWSER_ACTION_CHANNEL,
  DESKTOP_WEB_SERVICE_BROWSER_GET_STATE_CHANNEL,
  DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL,
  normalizeDesktopWebServiceBrowserAction,
  type DesktopWebServiceBrowserAction,
  type DesktopWebServiceBrowserActionResponse,
  type DesktopWebServiceBrowserState,
} from '../shared/desktopWebServiceBrowserIPC';
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
  DESKTOP_CODE_WORKSPACE_CANCEL_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_SIZE_BYTES,
  DESKTOP_CODE_WORKSPACE_PACKAGE_DISPOSE_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PACKAGE_PREPARE_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PROGRESS_CHANNEL,
  normalizeDesktopCodeWorkspaceCancelRequest,
  normalizeDesktopCodeWorkspacePackageChunkRequest,
  normalizeDesktopCodeWorkspacePackageDisposeRequest,
  normalizeDesktopCodeWorkspacePackagePrepareRequest,
  terminalDesktopCodeWorkspaceProgress,
  type DesktopCodeWorkspacePackageChunkResponse,
  type DesktopCodeWorkspacePackageDisposeResponse,
  type DesktopCodeWorkspacePackagePrepareResponse,
  type DesktopCodeWorkspaceProgress,
  type DesktopCodeWorkspaceProgressPhase,
  type DesktopCodeWorkspaceProgressSnapshot,
} from '../shared/desktopCodeWorkspaceIPC';
import {
  DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL,
  DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL,
  DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL,
  DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL,
  type DesktopLauncherActionProgress,
  type DesktopLauncherActionOutcome,
  type DesktopLauncherOperationSnapshot,
  type DesktopStepProgress,
  type DesktopStepProgressStepStatus,
  normalizeDesktopLauncherActionRequest,
  type DesktopLauncherActionFailure,
  type DesktopLauncherActionFailureCode,
  type DesktopLauncherActionFailureScope,
  type DesktopLauncherActionKind,
  type DesktopLauncherActionRequest,
  type DesktopLauncherActionResult,
  type DesktopLauncherActionSuccess,
  type DesktopEnvironmentRegistrationUpsert,
  type EnvironmentRegistrationRef,
  type DesktopLauncherOperationNextAction,
  type DesktopComponentTaskProgress,
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
  DESKTOP_SESSION_TRANSPORT_RECOVERY_GET_CHANNEL,
  DESKTOP_SESSION_TRANSPORT_RECOVERY_RETRY_CHANNEL,
  DESKTOP_SESSION_TRANSPORT_RECOVERY_UPDATED_CHANNEL,
  type DesktopSessionAppReadyPayload,
  type DesktopSessionContextSnapshot,
  type DesktopSessionTransportRecoverySnapshot,
} from '../shared/desktopSessionContextIPC';
import {
  desktopControlPlaneKey,
  normalizeControlPlaneOrigin,
  type DesktopControlPlaneProvider,
  type DesktopControlPlaneSummary,
  type DesktopProviderAccessPoint,
  type DesktopProviderEnvironment,
  type DesktopProviderEnvironmentRuntimeHealth,
  type DesktopProviderRuntimeManagementCapability,
} from '../shared/controlPlaneProvider';
import {
  desktopGatewayCanManageService,
  type DesktopGatewayDiagnosis,
  type DesktopGatewayDiagnosisProbeResult,
  type DesktopGatewayManagedProbe,
  type DesktopGatewayServiceState,
  type DesktopGatewaySource,
  type DesktopGatewaySyncState,
} from '../shared/desktopGateway';
import {
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  desktopSSHAuthority,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  buildDesktopRuntimeMaintenanceRequirement,
  classifyDesktopRuntimeBlockedLaunchReport,
  desktopRuntimeMaintenanceForRuntimeService,
  type DesktopRuntimeHealth,
  type DesktopRuntimeMaintenanceRequirement,
} from '../shared/desktopRuntimeHealth';
import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import {
  desktopRuntimeControlStatusAvailable,
  desktopRuntimeControlStatusMissing,
  type DesktopRuntimePresence,
  type DesktopRuntimeControlStatus,
} from '../shared/desktopRuntimePresence';
import { buildDesktopRuntimeOperationPlans } from '../shared/desktopRuntimeOperationPlanner';
import { desktopRuntimePackageStateFromRuntimeService } from '../shared/desktopRuntimePackageState';
import {
  desktopRuntimePlacementStateRoot,
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
  type DesktopRuntimeLifecycleOperation,
  type DesktopRuntimeLifecyclePhase,
  type DesktopRuntimeLifecycleProgress,
  type DesktopRuntimeLifecycleStepID,
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
  runtimeServiceWorkloadCounts,
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
  focusFlowerSettings?: boolean;
  stealAppFocus?: boolean;
}>;

type DesktopWindowSurface = 'utility' | 'session';
type DesktopUtilityWindowKind = 'launcher';

type DesktopUtilityWindowState = Readonly<{
  surface: DesktopLauncherSurface;
  entryReason: DesktopWelcomeEntryReason;
  issue: DesktopWelcomeIssue | null;
  selectedEnvironmentID: string;
  flowerSettingsFocusRevision: number;
}>;

type DesktopSessionRecord = {
  session_key: DesktopSessionKey;
  target: DesktopSessionTarget;
  startup: StartupReport;
  transport: DesktopSessionTransport;
  entry_url: string;
  display_url: string;
  allowed_base_url: string;
  root_window: DesktopTrackedWindow;
  child_windows: Map<string, DesktopTrackedWindow>;
  codespace_windows: Map<string, DesktopTrackedWindow>;
  web_service_windows: Map<string, DesktopTrackedWindow>;
  codespace_loading_documents: Map<string, CodespaceLoadingWindowCopy>;
  session_partition: string;
  diagnostics: DesktopDiagnosticsRecorder;
  runtime_handle: DesktopSessionRuntimeHandle | null;
  transport_recovery_session: RuntimePlacementBridgeSession | null;
  transport_recovery_snapshot: DesktopSessionTransportRecoverySnapshot | null;
  unsubscribe_transport_recovery: (() => void) | null;
  steal_app_focus_on_ready: boolean;
  lifecycle: DesktopSessionLifecycle;
  initial_load_completion: Promise<void>;
  resolve_initial_load: (() => void) | null;
  reject_initial_load: ((error: Error) => void) | null;
  app_ready_state: DesktopSessionAppReadyPayload['state'] | '';
  app_ready_timings?: DesktopSessionAppReadyPayload['timings'];
  env_app_ready: boolean;
  desktop_model_source_settled: boolean;
  open_started_at_unix_ms: number;
  window_created_at_unix_ms: number;
  document_loaded_at_unix_ms?: number;
  desktop_model_source_settled_at_unix_ms?: number;
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

type GatewaySyncRecord = Readonly<{
  gateway_id: string;
  sync_state: DesktopGatewaySyncState;
  background_sync_running: boolean;
  last_sync_attempt_at_ms: number;
  last_synced_at_ms: number;
  last_sync_error_code: string;
  last_sync_error_message: string;
  source?: DesktopGatewaySource;
}>;

type GatewaySyncOperationMode = 'auto' | 'sync' | 'refresh_catalog';

type GatewaySyncOperationPriority = 'background' | 'foreground';

type GatewaySyncTaskRecord = Readonly<{
  priority: GatewaySyncOperationPriority;
  token: symbol;
  controller: AbortController;
  task: Promise<DesktopGatewaySource>;
}>;

type GatewaySyncProgressObserver = Readonly<{
  signal?: AbortSignal;
  onGatewayServiceProgress?: GatewayLifecycleProgressSink;
  onStage?: (stage: GatewayWorkflowStepID) => void;
}>;

class GatewaySyncCanceledError extends Error {
  constructor(message = 'Gateway sync was canceled.') {
    super(message);
    this.name = 'AbortError';
  }
}

type LocalEnvironmentRuntimeRecord = Readonly<{
  environment_id: string;
  label: string;
  startup: StartupReport;
  runtime_handle: DesktopSessionRuntimeHandle;
}>;

type SSHRuntimeReadyRecord = Readonly<{
  runtime_key: `ssh:${string}`;
  environment_id: string;
  label: string;
  details: DesktopSSHEnvironmentDetails;
  startup: StartupReport;
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
  transport_observation?: 'recovering' | 'unavailable';
}>;

type RuntimePlacementInspectionState = Readonly<SavedRuntimeTargetState & {
  ready_record?: RuntimePlacementReadyRecord;
  runtime_target_available?: boolean;
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

type CreateBrowserWindowArgs = Readonly<{
  targetURL: string;
  stateKey: string;
  role: 'launcher' | 'session_root' | 'session_child' | 'codespace_child' | 'web_service_child';
  parent?: BrowserWindow;
  frameName?: string;
  sessionPartition?: string;
  diagnostics?: DesktopDiagnosticsRecorder | null;
  stealAppFocus?: boolean;
  chrome?: 'desktop' | 'native';
  preload?: 'desktop' | 'web_service_browser' | 'none';
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
  deferInitialLoad?: boolean;
}>;

const utilityWindows = new Map<DesktopUtilityWindowKind, DesktopTrackedWindow>();
const utilityWindowState = new Map<DesktopUtilityWindowKind, DesktopUtilityWindowState>([
  ['launcher', {
    surface: 'connect_environment',
    entryReason: 'app_launch',
    issue: null,
    selectedEnvironmentID: '',
    flowerSettingsFocusRevision: 0,
  }],
]);
const utilityWindowKindByWebContentsID = new Map<number, DesktopUtilityWindowKind>();
const UTILITY_WINDOW_KINDS = ['launcher'] as const;
const sessionsByKey = new Map<DesktopSessionKey, DesktopSessionRecord>();
const sessionKeyByWebContentsID = new Map<number, DesktopSessionKey>();
type DesktopWebServiceBrowserController = Readonly<{
  windowRecord: DesktopTrackedWindow;
  contentView: WebContentsView;
  navigate: (address: string) => DesktopWebServiceBrowserActionResponse;
  perform: (action: DesktopWebServiceBrowserAction) => Promise<DesktopWebServiceBrowserActionResponse>;
  refreshTheme: () => void;
  snapshot: () => DesktopWebServiceBrowserState;
}>;
const webServiceBrowserByToolbarWebContentsID = new Map<number, DesktopWebServiceBrowserController>();

function refreshWebServiceBrowserDocuments(): void {
  for (const controller of webServiceBrowserByToolbarWebContentsID.values()) {
    controller.refreshTheme();
  }
}
const sessionCloseTasks = new Map<DesktopSessionKey, Promise<void>>();
const desktopDiagnosticsHookSessions = new WeakSet<Session>();
const directDesktopSessionTasks = new Map<string, Promise<Session>>();
const confirmedFinalWindowCloseWebContentsIDs = new Set<number>();
const windowStateCleanup = new Map<BrowserWindow, () => void>();
const desktopDownloadWriter = new DesktopDownloadWriter(() => desktopLanguageState().getSnapshot().resolved_locale);
let lastFocusedSessionKey: DesktopSessionKey | null = null;
let quitPhase: 'idle' | 'confirming' | 'requested' | 'shutting_down' = 'idle';
let desktopPreferencesCache: DesktopPreferences | null = null;
let desktopPreferencesLoadPromise: Promise<DesktopPreferences> | null = null;
let desktopPreferencesMutationTail: Promise<void> = Promise.resolve();
let desktopStateStoreCache: DesktopStateStore | null = null;
let gatewayStoreCache: GatewayStore | null = null;
let gatewayLifecycleManagerCache: GatewayLifecycleManager | null = null;
let reinstallTargetCoordinatorCache: ReinstallTargetCoordinator | null = null;
let reinstallOperationsHydrationPromise: Promise<void> | null = null;
let desktopBundleCache: DesktopBundle | null = null;
let providerRuntimeLifecycleClientCache: ProviderRuntimeLifecycleClient | null = null;
let desktopThemeStateCache: DesktopThemeState | null = null;
let desktopLanguageStateCache: DesktopLanguageState | null = null;
const controlPlaneAccessStateByKey = new Map<string, DesktopControlPlaneAccessState>();
const controlPlaneSyncStateByKey = new Map<string, DesktopControlPlaneSyncRecord>();
const providerRuntimeHealthByControlPlaneKey = new Map<string, Map<string, DesktopProviderEnvironmentRuntimeHealth>>();
type PendingRuntimeOperationConfirmation = Readonly<{
  operation: GatewayRuntimeOperation;
  label: string;
  operation_id?: string;
  confirm: (request: GatewayRuntimeOperationConfirmationRequest) => Promise<GatewayRuntimeOperation>;
  renew?: (expiresAtUnixMS: number) => Promise<GatewayRuntimeOperation>;
  cancel: () => Promise<void>;
  after_success?: () => Promise<void>;
  continuation?: () => Promise<DesktopLauncherActionResult>;
  environment_id?: string;
  retry_action?: DesktopLauncherActionRequest;
  success_outcome?: DesktopLauncherActionSuccess['outcome'];
  lifecycle?: Readonly<{
    host_access: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    operation: DesktopRuntimeLifecycleOperation;
    target_id: string;
    target_label: string;
  }>;
}>;
const pendingRuntimeOperationConfirmations = new Map<string, PendingRuntimeOperationConfirmation>();
const pendingRuntimeOperationLeases = new Map<string, RuntimeOperationLease>();
type PendingRuntimeOperationReconciliation = Readonly<{
  operation: GatewayRuntimeOperation;
  label: string;
  reconcile: () => Promise<GatewayRuntimeOperation>;
  after_success?: () => Promise<void>;
}>;
const pendingRuntimeOperationReconciliations = new Map<string, PendingRuntimeOperationReconciliation>();
const attachedRuntimeOperationResumeTasks = new Map<string, Promise<void>>();
const locallyDrivenRuntimeOperationIDs = new Set<string>();
// Foreground launcher requests own an operation from prepare through
// confirmation. Catalog attachment refreshes must not overwrite their
// callbacks or user-facing outcome while that ownership is active.
const foregroundRuntimeOperationIDs = new Set<string>();
const gatewaySyncStateByID = new Map<string, GatewaySyncRecord>();
const gatewayDiagnosisByID = new Map<string, DesktopGatewayDiagnosis>();
const gatewaySyncTaskByID = new Map<string, GatewaySyncTaskRecord>();
const supersededGatewaySyncTaskTokens = new Set<symbol>();

function supersedeGatewaySyncTask(gatewayID: string): void {
  const taskRecord = gatewaySyncTaskByID.get(gatewayID);
  if (taskRecord) {
    supersededGatewaySyncTaskTokens.add(taskRecord.token);
    if (!taskRecord.controller.signal.aborted) {
      taskRecord.controller.abort(new DOMException('Gateway sync was superseded.', 'AbortError'));
    }
  }
  gatewaySyncTaskByID.delete(gatewayID);
}

function abortSignalAny(signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason ?? new DOMException('Operation canceled.', 'AbortError'));
    }
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener('abort', () => abort(signal), { once: true });
  }
  return controller.signal;
}

function isAbortLikeError(error: unknown): boolean {
  const candidate = error as { name?: unknown; code?: unknown } | null;
  return candidate?.name === 'AbortError' || candidate?.code === 'ABORT_ERR';
}
const pendingControlPlaneAuthorizationsByState = new Map<string, PendingControlPlaneAuthorization>();
const controlPlaneSyncTaskByKey = new Map<string, Promise<Readonly<{
  preferences: DesktopPreferences;
  controlPlane: DesktopSavedControlPlane;
}>>>();
let localEnvironmentRuntimeRecord: LocalEnvironmentRuntimeRecord | null = null;
const localRuntimeMaintenanceByEnvironmentID = new Map<string, DesktopRuntimeMaintenanceRequirement>();
const sshRuntimeReadyByKey = new Map<`ssh:${string}`, SSHRuntimeReadyRecord>();
const sshRuntimeMaintenanceByKey = new Map<`ssh:${string}`, DesktopRuntimeMaintenanceRequirement>();
const runtimePlacementMaintenanceByTargetID = new Map<DesktopRuntimeTargetID, DesktopRuntimeMaintenanceRequirement>();
const runtimePlacementBridgeRegistry = new RuntimePlacementBridgeRegistry(handleRuntimePlacementBridgeSettlement);
const runtimePlacementReadyByTargetID = new Map<DesktopRuntimeTargetID, RuntimePlacementReadyRecord>();
const pendingRuntimePlacementOpenByTargetID = new Map<DesktopRuntimeTargetID, Promise<DesktopLauncherActionResult | null>>();
const managedEnvironmentOpenRecoveryAttemptsByTargetID = new Map<DesktopRuntimeTargetID, number>();
// A bridge handshake can race a Runtime restart. Keep one bounded automatic
// recovery per Open request; a second failure must return an actionable result
// instead of creating an endless confirmation/restart loop across continuations.
const managedEnvironmentOpenBridgeRecoveryAttemptsByTargetID = new Map<DesktopRuntimeTargetID, number>();
const MAX_MANAGED_ENVIRONMENT_OPEN_BRIDGE_RECOVERY_ATTEMPTS = 1;
const MANAGED_ENVIRONMENT_OPEN_BRIDGE_START_RETRY_DELAYS_MS = [250, 500] as const;
const launcherOperationRemovalTimers = new Map<string, ReturnType<typeof setTimeout>>();
const launcherOperations = new LauncherOperationRegistry(handleLauncherOperationChange);
const runtimeLifecycleCoordinator = new RuntimeLifecycleCoordinator();
const desktopSSHTransportManager = new DefaultDesktopSSHTransportManager();
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
const GATEWAY_CATALOG_SYNC_POLL_INTERVAL_MS = 15_000;
const GATEWAY_CATALOG_STALE_AFTER_MS = 30_000;
const WELCOME_RUNTIME_POLL_INTERVAL_MS = 5_000;
const DESKTOP_RUNTIME_PROBE_TIMEOUT_MS = 1_500;
const DESKTOP_SESSION_INITIAL_LOAD_TIMEOUT_MS = 15_000;
const DESKTOP_STALE_WINDOW_MESSAGE = 'That window was already closed. Desktop refreshed the environment list.';
const DESKTOP_PROVIDER_RECONNECT_MESSAGE = 'Desktop needs fresh provider authorization before it can open or connect this provider Environment.';
const DESKTOP_GPU_TILE_MEMORY_BUDGET_MB = 2048;
const pendingDesktopDeepLinks: string[] = [];
let controlPlaneSyncPollTimer: NodeJS.Timeout | null = null;
let welcomeRuntimePollTimer: NodeJS.Timeout | null = null;
let gatewaySyncPollTimer: NodeJS.Timeout | null = null;

// Apply before Electron is ready so Chromium sizes compositor tile memory for desktop Workbench surfaces.
app.commandLine.appendSwitch('force-gpu-mem-available-mb', String(DESKTOP_GPU_TILE_MEMORY_BUDGET_MB));
installStdioBrokenPipeGuards();

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function runtimeFlowerRetryAfterMs(value: unknown): number | undefined {
  const retryAfterMs = Number(value);
  return Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? Math.floor(retryAfterMs) : undefined;
}

function runtimeFlowerError(code: string, message: string, status?: number, retryAfterMs?: number, data?: unknown): RuntimeFlowerError {
  return {
    code: compact(code) || 'runtime_flower_error',
    message: compact(message) || 'Flower request failed.',
    ...(Number.isInteger(status) ? { status } : {}),
    ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
    ...(data === undefined ? {} : { data }),
  };
}

function runtimeFlowerErrorFromUnknown(error: unknown): RuntimeFlowerError {
  const record = error as { code?: unknown; message?: unknown; status?: unknown; statusCode?: unknown; retryAfterMs?: unknown; data?: unknown };
  const status = Number(record?.status ?? record?.statusCode);
  return runtimeFlowerError(
    compact(record?.code) || 'runtime_flower_error',
    error instanceof Error ? error.message : compact(record?.message) || String(error),
    Number.isInteger(status) ? status : undefined,
    runtimeFlowerRetryAfterMs(record?.retryAfterMs),
    record?.data,
  );
}

class RuntimeFlowerTransportError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : compact(cause) || 'Flower runtime response was unavailable.', { cause });
    this.name = 'RuntimeFlowerTransportError';
  }
}

const LOCAL_UI_ACCESS_COOKIE_NAME = 'redeven_local_access';
const runtimeFlowerAccessCookies = new Map<string, string>();
const RUNTIME_FLOWER_ATTACHMENT_MAX_BYTES = 64 * 1024 * 1024;
const RUNTIME_FLOWER_STREAMS_PER_SENDER = 8;
const RUNTIME_FLOWER_STREAMS_GLOBAL = 64;

type RuntimeFlowerStreamOperation = {
  key: string;
  streamID: string;
  sender: WebContents;
  request?: ClientRequest;
  settled: boolean;
  senderDestroyedListener: () => void;
};

const runtimeFlowerStreamOperations = new Map<string, RuntimeFlowerStreamOperation>();

type RuntimeFlowerAttachmentOperation = {
  key: string;
  sender: WebContents;
  request: ClientRequest;
  response: Promise<RuntimeFlowerHTTPResponse>;
  expectedOffset: number;
  totalBytes: number;
	footer: Buffer;
	accessCacheKey: string;
	settled: boolean;
	writeInFlight?: boolean;
  senderDestroyedListener?: () => void;
};

const runtimeFlowerAttachmentOperations = new Map<string, RuntimeFlowerAttachmentOperation>();

function runtimeFlowerBaseURL(record: LocalEnvironmentRuntimeRecord): string {
  return requireLocalUIBridgeURL(record.startup);
}

function runtimeFlowerAccessCookieHeader(cookieValue: string): string {
  return `${LOCAL_UI_ACCESS_COOKIE_NAME}=${cookieValue}`;
}

function runtimeFlowerAccessCookieFromHeaders(headers: IncomingHttpHeaders): string {
  const setCookie = headers['set-cookie'];
  const values = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === 'string'
      ? [setCookie]
      : [];
  for (const value of values) {
    const match = value.match(new RegExp(`^${LOCAL_UI_ACCESS_COOKIE_NAME}=([^;,]+)`, 'iu'));
    if (match?.[1]) {
      return compact(match[1]);
    }
  }
  return '';
}

function bundledRuntimeExecutablePath(): string {
  return resolveBundledRuntimePath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    developmentBundleRoot: process.env.REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT,
  });
}

function resolveDesktopBundleVersion(): string {
  const clean = [
    process.env.REDEVEN_DESKTOP_BUNDLE_VERSION,
    process.env.REDEVEN_DESKTOP_VERSION,
    app.getVersion(),
  ].map((value) => compact(value)).find(Boolean) ?? '';
  if (clean === '') {
    throw new Error('Desktop bundle version is unavailable.');
  }
  return clean.startsWith('v') ? clean : `v${clean}`;
}

function desktopBundleTarget(): Readonly<{
  platform: 'darwin' | 'linux';
  architecture: 'amd64' | 'arm64';
}> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(`Desktop bundle platform ${process.platform} is unsupported.`);
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    throw new Error(`Desktop bundle architecture ${process.arch} is unsupported.`);
  }
  return {
    platform: process.platform,
    architecture: process.arch === 'x64' ? 'amd64' : 'arm64',
  };
}

async function loadDesktopBundleForStartup(): Promise<DesktopBundle> {
  if (desktopBundleCache) {
    return desktopBundleCache;
  }
  const target = desktopBundleTarget();
  desktopBundleCache = await loadDesktopBundle({
    root: path.dirname(bundledRuntimeExecutablePath()),
    expectedPlatform: target.platform,
    expectedArchitecture: target.architecture,
    expectedVersion: resolveDesktopBundleVersion(),
    expectedCommit: compact(process.env.REDEVEN_DESKTOP_BUNDLE_COMMIT) || undefined,
  });
  return desktopBundleCache;
}

function requireDesktopBundle(): DesktopBundle {
  if (!desktopBundleCache) {
    throw new Error('Desktop bundled environment services have not been validated.');
  }
  return desktopBundleCache;
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
): Promise<StartupReport> {
  const result = await probeExternalLocalUIHealth(requireLocalUIBridgeURL(startup), {
    timeoutMs: DESKTOP_RUNTIME_PROBE_TIMEOUT_MS,
  });
  if (!result.ok) {
    return startup;
  }
  const refreshed = result.value;
  return {
    ...startup,
    password_required: refreshed.password_required,
    exposure: refreshed.exposure ?? startup.exposure,
    started_at_unix_ms: refreshed.started_at_unix_ms ?? startup.started_at_unix_ms,
    runtime_service: refreshed.runtime_service ?? startup.runtime_service,
    runtime_control: startup.runtime_control,
  };
}

function localEnvironmentRuntimeRoot(environment: DesktopLocalEnvironmentState): string {
  return compact(environment.local_hosting.state_dir);
}

function localEnvironmentStateRoot(): string {
  return preferencesPaths().stateRoot;
}

function reinstallTargetRequiredMarkerPath(descriptor: ReinstallTargetDescriptor): string {
  return path.join(
    preferencesPaths().stateRoot,
    'maintenance',
    'reinstall-target-required',
    `${reinstallTargetDescriptorFingerprint(descriptor)}.json`,
  );
}

async function markReinstallTargetRequired(
  environmentID: string,
  input: Readonly<{ gatewayID: string; reason: string }>,
): Promise<void> {
  const descriptor = await resolveDirectReinstallTarget(environmentID);
  await writeReinstallTargetRequiredMarker(descriptor, input);
}

async function writeReinstallTargetRequiredMarker(
  descriptor: ReinstallTargetDescriptor,
  input: Readonly<{ gatewayID: string; reason: string }>,
): Promise<void> {
  const descriptors = directReinstallTargetDescriptors(await loadDesktopPreferencesCached())
    .filter((candidate) => descriptor.affected_environment_ids.includes(candidate.environment_id));
  const targets = descriptors.length > 0 ? descriptors : [descriptor];
  await Promise.all(targets.map(async (target) => {
    const markerPath = reinstallTargetRequiredMarkerPath(target);
    const markerDirectory = path.dirname(markerPath);
    const temporaryPath = `${markerPath}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(markerDirectory, { recursive: true });
    await fs.writeFile(temporaryPath, JSON.stringify({
      schema_version: 1,
      environment_id: target.environment_id,
      affected_environment_ids: descriptor.affected_environment_ids,
      target_fingerprint: reinstallTargetDescriptorFingerprint(target),
      gateway_id: input.gatewayID,
      reason: compact(input.reason) || 'incompatible_state',
      marked_at_unix_ms: Date.now(),
    }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, markerPath);
  }));
}

async function clearReinstallTargetRequired(descriptor: ReinstallTargetDescriptor): Promise<void> {
  const descriptors = directReinstallTargetDescriptors(await loadDesktopPreferencesCached())
    .filter((candidate) => descriptor.affected_environment_ids.includes(candidate.environment_id));
  const targets = descriptors.length > 0 ? descriptors : [descriptor];
  await Promise.all(targets.map((target) => fs.rm(reinstallTargetRequiredMarkerPath(target), { force: true })));
}

async function clearReinstallTargetRequiredForEnvironment(environmentID: string): Promise<void> {
  const descriptor = directReinstallTargetDescriptors(await loadDesktopPreferencesCached())
    .find((candidate) => candidate.environment_id === environmentID);
  if (descriptor) {
    await clearReinstallTargetRequired(descriptor);
  }
}

async function reinstallRequiredTargetFingerprints(
  descriptors: readonly ReinstallTargetDescriptor[],
): Promise<ReadonlySet<string>> {
  return new Set((await Promise.all(descriptors.map(async (descriptor) => (
    await fs.lstat(reinstallTargetRequiredMarkerPath(descriptor))
      .then(() => reinstallTargetDescriptorFingerprint(descriptor))
      .catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? '' : Promise.reject(error))
  )))).filter(Boolean));
}

async function pendingReinstallOperationForEnvironment(
  environmentID: string,
): Promise<DesktopLauncherOperationSnapshot | null> {
  await hydratePersistedReinstallOperations();
  const journal = (await reinstallTargetCoordinator().readPersistedJournals())
    .find((candidate) => (
      candidate.environment_id === environmentID
      || candidate.affected_environment_ids.includes(environmentID)
    ));
  return journal ? launcherOperations.get(journal.preview.operation_key) : null;
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
      access_point_origin: environment.access_point_origin,
    },
  );
}

function runtimeMatchesProvider(
  startup: StartupReport | null | undefined,
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
  accessPointOrigin: string,
): boolean {
  return desktopRuntimeProviderBindingMatches(
    runtimeServiceProviderLinkBinding(startup?.runtime_service),
    {
      provider_origin: providerOrigin,
      provider_id: providerID,
      env_public_id: envPublicID,
      access_point_origin: accessPointOrigin,
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

async function handleRuntimePlacementBridgeSettlement(
  record: RuntimePlacementBridgeRecord,
  attachment: RuntimePlacementBridgeAttachment,
  termination: RuntimePlacementBridgeTermination,
): Promise<void> {
  await record.desktop_model_source?.stop().catch(() => undefined);
  const sessionRecord = attachment.kind === 'session' ? liveSession(attachment.session_key) : null;
  if (termination.kind === 'failed' && sessionRecord?.transport_recovery_session === record.session) {
    sessionRecord.unsubscribe_transport_recovery?.();
    sessionRecord.unsubscribe_transport_recovery = null;
    sessionRecord.transport_recovery_session = null;
    sessionRecord.transport_recovery_snapshot = record.session.getRecoverySnapshot();
    sessionRecord.runtime_handle = null;
    sessionRecord.diagnostics.clearRuntime();
    sendSessionTransportRecoverySnapshot(sessionRecord);
    await sessionRecord.diagnostics.recordLifecycle(
      'runtime_transport_failed',
      'Runtime Placement Bridge recovery ended and Desktop retained the disconnected Env App shell.',
      {
        failure_code: termination.failure.code,
        recovery_generation: sessionRecord.transport_recovery_snapshot.generation,
        recovery_attempt_count: sessionRecord.transport_recovery_snapshot.attempt_count,
      },
    );
  } else if (sessionRecord && !sessionRecord.closing) {
    await finalizeSessionClosure(sessionRecord.session_key).catch(() => undefined);
  }
  broadcastDesktopWelcomeSnapshots();
}

function trackRuntimePlacementBridgeRecord(
  record: RuntimePlacementBridgeRecord,
  operationKey: string,
): RuntimePlacementBridgeRecord {
  return runtimePlacementBridgeRegistry.trackOpening(record, operationKey);
}

async function openRuntimePlacementBridgeForReadyRecord(
  readyRecord: RuntimePlacementReadyRecord,
  signal?: AbortSignal,
): Promise<RuntimePlacementBridgeRecord> {
  await clearRuntimePlacementBridgeRecord(readyRecord.runtime_key as DesktopRuntimeTargetID);
  const preferences = await loadDesktopPreferencesCached();
  const sshPassword = savedRuntimePlacementSSHPassword(
    preferences,
    readyRecord.host_access,
    readyRecord.placement,
    readyRecord.runtime_key as DesktopRuntimeTargetID,
    readyRecord.environment_id,
  );
  const session = await startRuntimePlacementBridgeSession({
    host_access: readyRecord.host_access,
    placement: readyRecord.placement,
    runtime_binary_path: readyRecord.runtime_binary_path,
    ssh_password: sshPassword,
    ssh_credential_scope: readyRecord.environment_id,
    ssh_transport_manager: desktopSSHTransportManager,
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
    ? await refreshStartupReportFromLocalUI(nextRecord.startup)
    : nextRecord.startup;
  const record = {
    ...nextRecord,
    startup,
    desktop_model_source: desktopModelSource,
  };
  return trackRuntimePlacementBridgeRecord(
    record,
    `${readyRecord.runtime_key}:bridge`,
  );
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
      record: RuntimePlacementBridgeRecord;
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
      const bridgeRecord = runtimePlacementBridgeRegistry.get(runtimeTargetKey);
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
  const bridgeRecord = runtimePlacementBridgeRegistry.get(runtimeKey as DesktopRuntimeTargetID);
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
  return null;
}

function updateProviderRuntimeTargetStartup(
  target: ProviderRuntimeLinkTargetRecord,
  startupPatch: Partial<StartupReport>,
): void {
  if ('session' in target.record) {
    const record = target.record;
    runtimePlacementBridgeRegistry.updateIfCurrent(
      record.session.placement_target_id,
      record.session,
      (current) => ({
        ...current,
        startup: {
          ...current.startup,
          ...startupPatch,
          runtime_control: startupPatch.runtime_control ?? current.startup.runtime_control,
        },
      }),
    );
    return;
  }
  if (target.kind === 'local_environment') {
    updateLocalEnvironmentRuntimeRecordStartup(target.record, startupPatch);
  }
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
  accessPointOrigin: string,
): boolean {
  return runtimeMatchesProvider(runtimeTarget.record.startup, providerOrigin, providerID, envPublicID, accessPointOrigin);
}

async function providerEnvironmentOccupyingRuntime(
  preferences: DesktopPreferences,
  environment: DesktopProviderEnvironmentRecord,
  selectedRuntimeTargetID: DesktopProviderRuntimeLinkTargetID,
): Promise<ProviderRuntimeLinkTargetRecord | null> {
  const providerOrigin = compact(environment.provider_origin);
  const providerID = compact(environment.provider_id);
  const envPublicID = compact(environment.env_public_id);
  const accessPointOrigin = compact(environment.access_point_origin);
  if (providerOrigin === '' || providerID === '' || envPublicID === '' || accessPointOrigin === '') {
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
  for (const targetID of runtimePlacementBridgeRegistry.keys()) {
    const observation = await observeRuntimePlacementBridgeRecord(targetID);
    if (observation.kind === 'absent') {
      continue;
    }
    const record = observation.record;
    records.push({
      kind: record.session.host_access.kind === 'ssh_host' ? 'ssh_environment' : 'local_environment',
      id: record.target_id,
      label: record.label,
      record,
    });
  }
  return records.find((record) => (
    record.id !== selectedRuntimeTargetID
    && runtimeTargetRecordMatchesProvider(record, providerOrigin, providerID, envPublicID, accessPointOrigin)
  )) ?? null;
}

type ProviderDesktopSessionMaterial = Readonly<{
  preferences: DesktopPreferences;
  controlPlane: DesktopSavedControlPlane;
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
  const accessPoint = providerAccessPointForEnvironment(authorized.controlPlane, environment);
  const openSession = await requestDesktopOpenSession(
    authorized.controlPlane.provider,
    accessPoint,
    authorized.accessToken,
    environment.env_public_id,
  );
  return {
    preferences: authorized.preferences,
    controlPlane: authorized.controlPlane,
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
  localRuntimeMaintenanceByEnvironmentID.delete(environment.id);
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
  localRuntimeMaintenanceByEnvironmentID.delete(environment.id);
}

async function verifyCurrentLocalEnvironmentRuntimeRecord(
  environment: DesktopLocalEnvironmentState,
): Promise<LocalEnvironmentRuntimeRecord | null> {
  const currentRecord = currentLocalEnvironmentRuntimeRecord(environment);
  if (!currentRecord) {
    return null;
  }
  try {
    const result = await probeExternalLocalUIHealth(requireLocalUIBridgeURL(currentRecord.startup), {
      timeoutMs: DESKTOP_RUNTIME_PROBE_TIMEOUT_MS,
    });
    if (result.ok) {
      const startup = result.value;
      return updateLocalEnvironmentRuntimeRecordStartup(currentRecord, {
        provider_origin: startup.provider_origin ?? currentRecord.startup.provider_origin,
        controlplane_base_url: startup.controlplane_base_url ?? currentRecord.startup.controlplane_base_url,
        controlplane_provider_id: startup.controlplane_provider_id ?? currentRecord.startup.controlplane_provider_id,
        env_public_id: startup.env_public_id ?? currentRecord.startup.env_public_id,
        local_ui_url: startup.local_ui_url,
        local_ui_urls: startup.local_ui_urls,
        password_required: startup.password_required,
        started_at_unix_ms: startup.started_at_unix_ms ?? currentRecord.startup.started_at_unix_ms,
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
  return desktopRuntimeControlStatusAvailable();
}

function runtimeHostExecutor(
  hostAccess: DesktopRuntimeHostAccess,
  credentialScope: string,
  sshPassword?: string,
) {
  return hostAccess.kind === 'ssh_host'
    ? createSSHRuntimeHostExecutor(desktopSSHTransportManager, hostAccess.ssh, {
        credentialScope,
        sshPassword,
      })
    : createLocalRuntimeHostExecutor();
}

function runtimeContainerResolver(
  hostAccess: DesktopRuntimeHostAccess,
  credentialScope: string,
  signal?: AbortSignal,
  sshPassword?: string,
): DesktopRuntimeContainerResolver & Readonly<{ release: () => Promise<void> }> {
  const executor = runtimeHostExecutor(hostAccess, credentialScope, sshPassword);
  const commandOptions = () => ({
    ...(signal ? { signal } : {}),
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
    release: () => executor.release(),
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
  kind: DesktopRuntimePresence['kind'];
  environmentID: string;
  label: string;
  runtimeKey: string;
  hostAccess: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  running: boolean;
  localUIURL: string;
  startedAtUnixMS?: number;
  openConnectionRequired?: boolean;
  runtimeService?: RuntimeServiceSnapshot;
  runtimeControlStatus: DesktopRuntimeControlStatus;
  maintenance?: DesktopRuntimeMaintenanceRequirement;
}>): DesktopRuntimePresence {
  const runtimeService = args.runtimeService ? normalizeRuntimeServiceSnapshot(args.runtimeService) : undefined;
  const maintenance = desktopRuntimeMaintenanceForRuntimeService(args.maintenance, runtimeService);
  const runtimePackageState = desktopRuntimePackageStateFromRuntimeService(runtimeService, maintenance);
  const openable = runtimeServiceIsOpenable(runtimeService);
  const openConnectionRequired = args.openConnectionRequired === true;
  const startedAtUnixMS = Number(args.startedAtUnixMS);
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
    ...(Number.isInteger(startedAtUnixMS) && startedAtUnixMS > 0 ? { started_at_unix_ms: startedAtUnixMS } : {}),
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

async function clearRuntimePlacementBridgeRecord(targetID: DesktopRuntimeTargetID): Promise<void> {
  await runtimePlacementBridgeRegistry.retire(targetID);
}

async function clearRuntimePlacementTargetRecords(targetID: DesktopRuntimeTargetID): Promise<void> {
  runtimePlacementReadyByTargetID.delete(targetID);
  runtimePlacementMaintenanceByTargetID.delete(targetID);
  await clearRuntimePlacementBridgeRecord(targetID);
}

async function observeRuntimePlacementBridgeRecord(
  targetID: DesktopRuntimeTargetID,
): ReturnType<typeof observeRuntimePlacementBridge> {
  return observeRuntimePlacementBridge(
    runtimePlacementBridgeRegistry,
    targetID,
    (record) => probeExternalLocalUIHealth(record.startup.local_ui_url, {
      timeoutMs: DESKTOP_RUNTIME_PROBE_TIMEOUT_MS,
    }),
  );
}

async function runtimePlacementInspectionFromBridge(
  target: Readonly<{
    targetID: DesktopRuntimeTargetID;
    placement: DesktopRuntimePlacement;
  }>,
): Promise<RuntimePlacementInspectionState | null> {
  const observation = await observeRuntimePlacementBridgeRecord(target.targetID);
  if (observation.kind === 'absent') {
    return null;
  }
  const bridgeRecord = observation.record;
  const runtimeService = bridgeRecord.startup.runtime_service;
  const bridgeReady = observation.kind === 'ready';
  return {
    running: true,
    startup: bridgeRecord.startup,
    local_ui_url: bridgeRecord.startup.local_ui_url,
    runtime_service: runtimeService,
    runtime_control_status: bridgeReady
      ? await runtimeControlStatusForStartup(bridgeRecord.startup)
      : desktopRuntimeControlStatusMissing('unverified', 'Could not verify runtime status'),
    maintenance: runtimePlacementMaintenanceForRuntimeService(target.targetID, runtimeService),
    placement: target.placement,
    binary_path: bridgeRecord.runtime_binary_path,
    runtime_target_available: bridgeReady,
    ...(bridgeReady ? {} : { transport_observation: observation.kind }),
  };
}

function clearSSHRuntimeReadyState(runtimeKey: `ssh:${string}`): void {
  sshRuntimeReadyByKey.delete(runtimeKey);
  sshRuntimeMaintenanceByKey.delete(runtimeKey);
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
  const bridgeState = await runtimePlacementInspectionFromBridge(target);
  if (bridgeState) {
    return bridgeState;
  }
  if (target.placement.kind === 'host_process' && target.hostAccess.kind === 'ssh_host') {
    const sshPassword = compact(target.sshPassword);
    if (target.hostAccess.ssh.auth_mode === 'password' && sshPassword === '') {
      return {
        running: false,
        local_ui_url: '',
        runtime_control_status: desktopRuntimeControlStatusMissing('auth_required', 'Status detection waits for manual SSH authentication.'),
        maintenance: runtimePlacementMaintenanceByTargetID.get(target.targetID),
        placement: target.placement,
        runtime_target_available: false,
      };
    }
    const details = sshDetailsFromRuntimePlacement(target.hostAccess, target.placement);
    const runtimeKey = sshDesktopSessionKey(details);
    const status = await probeManagedSSHRuntimeStatus({
      sshTransportManager: desktopSSHTransportManager,
      sshCredentialScope: target.environmentID,
      target: details,
      runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
      runtimeStateRoot: desktopRuntimePlacementStateRoot(target.placement),
      sshPassword: sshPassword || undefined,
      connectTimeoutSeconds: target.hostAccess.ssh.connect_timeout_seconds ?? undefined,
      signal: target.signal,
    });
    if (status.status === 'ready') {
      const runtimeService = status.startup.runtime_service;
      const maintenance = runtimePlacementMaintenanceForRuntimeService(target.targetID, runtimeService);
      if (runtimeServiceAllowsOpenAttempt(runtimeService)) {
        const readyRecord: RuntimePlacementReadyRecord = {
          runtime_key: target.targetID,
          environment_id: target.environmentID,
          label: target.label,
          target_id: providerRuntimeLinkTargetIDForRuntimeTarget(target.hostAccess, target.targetID),
          host_access: target.hostAccess,
          placement: target.placement,
          runtime_binary_path: details.runtime_root,
          startup: status.startup,
        };
        sshRuntimeReadyByKey.set(runtimeKey, {
          runtime_key: runtimeKey,
          environment_id: target.environmentID,
          label: target.label,
          details,
          startup: status.startup,
        });
        runtimePlacementReadyByTargetID.set(target.targetID, readyRecord);
        return {
          running: true,
          startup: status.startup,
          local_ui_url: '',
          open_connection_required: true,
          runtime_service: runtimeService,
          runtime_control_status: desktopRuntimeControlStatusMissing(
            'forward_unavailable',
            'Open this runtime to prepare the Desktop bridge and provider connection.',
          ),
          maintenance,
          placement: target.placement,
          binary_path: details.runtime_root,
          ready_record: readyRecord,
          runtime_target_available: true,
        };
      }
      const runtimeMaintenance = sshRuntimeMaintenanceFromStartup(
        status.startup,
        'This SSH runtime is running but cannot open with this Desktop yet.',
      );
      runtimePlacementMaintenanceByTargetID.set(target.targetID, runtimeMaintenance);
      runtimePlacementReadyByTargetID.delete(target.targetID);
      sshRuntimeReadyByKey.delete(runtimeKey);
      return {
        running: true,
        startup: status.startup,
        local_ui_url: '',
        open_connection_required: true,
        runtime_service: runtimeService,
        runtime_control_status: desktopRuntimeControlStatusMissing(
          'forward_unavailable',
          'Open this runtime to prepare the Desktop bridge and provider connection.',
        ),
        maintenance: runtimeMaintenance,
        placement: target.placement,
        binary_path: details.runtime_root,
        runtime_target_available: true,
      };
    }
    if (status.status === 'blocked') {
      const classification = classifyDesktopRuntimeBlockedLaunchReport(status.report, {
        target_runtime_version: resolveSSHRuntimeReleaseTag(),
      });
      clearSSHRuntimeReadyState(runtimeKey);
      runtimePlacementReadyByTargetID.delete(target.targetID);
      if (classification.kind === 'stopped' || classification.kind === 'unverified') {
        runtimePlacementMaintenanceByTargetID.delete(target.targetID);
        return {
          running: false,
          local_ui_url: '',
          runtime_control_status: desktopRuntimeControlStatusMissing(
            classification.kind === 'stopped' ? 'not_started' : 'unverified',
            classification.message,
          ),
          placement: target.placement,
          binary_path: details.runtime_root,
          runtime_target_available: true,
        };
      }
      const maintenance = classification.maintenance;
      runtimePlacementMaintenanceByTargetID.set(target.targetID, maintenance);
      return {
        running: classification.kind === 'restart_required',
        local_ui_url: '',
        runtime_control_status: desktopRuntimeControlStatusMissing('not_reported', maintenance.message),
        maintenance,
        placement: target.placement,
        binary_path: details.runtime_root,
        runtime_target_available: true,
      };
    }
    clearSSHRuntimeReadyState(runtimeKey);
    runtimePlacementReadyByTargetID.delete(target.targetID);
    runtimePlacementMaintenanceByTargetID.delete(target.targetID);
    return {
      running: false,
      local_ui_url: '',
      runtime_control_status: desktopRuntimeControlStatusMissing(
        status.status === 'failed' ? 'unverified' : 'not_started',
        status.message,
      ),
      placement: target.placement,
      binary_path: details.runtime_root,
      runtime_target_available: status.status !== 'failed',
    };
  }
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
    ...(target.signal ? { signal: target.signal } : {}),
  });
  const resolver = runtimeContainerResolver(
    target.hostAccess,
    target.environmentID,
    target.signal,
    sshPassword || undefined,
  );
  const resolution = await resolveRuntimeContainerPlacement(resolver, target.placement)
    .finally(() => resolver.release());
  if (resolution.status === 'running') {
    const executor = runtimeHostExecutor(target.hostAccess, target.environmentID, sshPassword || undefined);
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
          runtime_state_root: desktopRuntimePlacementStateRoot(resolution.placement),
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
          active_workload: runtimeServiceWorkloadCounts(undefined),
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
    } finally {
      await executor.release();
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
    operationKey?: string;
    sessionKey?: string;
    utilityWindowKind?: DesktopLauncherActionSuccess['utility_window_kind'];
    reinstallPreview?: DesktopLauncherActionSuccess['reinstall_preview'];
  }> = {},
): DesktopLauncherActionSuccess {
  return {
    ok: true,
    outcome,
    operation_key: compact(options.operationKey) || undefined,
    session_key: options.sessionKey,
    utility_window_kind: options.utilityWindowKind,
    reinstall_preview: options.reinstallPreview,
  };
}

function launcherActionFailure(
  code: DesktopLauncherActionFailureCode,
  scope: DesktopLauncherActionFailureScope,
  message: string,
  options: Readonly<{
    environmentID?: string;
    gatewayID?: string;
    gatewayLabel?: string;
    gatewayEnvironmentID?: string;
    operationKey?: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
    shouldRefreshSnapshot?: boolean;
    failure?: DesktopOperationFailurePresentation;
    retryAction?: DesktopLauncherActionRequest;
    continuationAction?: DesktopLauncherActionRequest;
    resolveFocus?: DesktopLauncherActionFailure['resolve_focus'];
    gatewayStartRequiredPayload?: DesktopLauncherActionFailure['gateway_start_required_payload'];
  }> = {},
): DesktopLauncherActionFailure {
  const failure = options.failure;
  return {
    ok: false,
    code,
    scope,
    message: compact(failure?.summary) || compact(message),
    environment_id: compact(options.environmentID) || undefined,
    gateway_id: compact(options.gatewayID) || undefined,
    gateway_label: compact(options.gatewayLabel) || undefined,
    gateway_environment_id: compact(options.gatewayEnvironmentID) || undefined,
    operation_key: compact(options.operationKey) || undefined,
    provider_origin: compact(options.providerOrigin) || undefined,
    provider_id: compact(options.providerID) || undefined,
    env_public_id: compact(options.envPublicID) || undefined,
    should_refresh_snapshot: options.shouldRefreshSnapshot === true || undefined,
    ...(failure ? { failure } : {}),
    ...(options.retryAction ? { retry_action: options.retryAction } : {}),
    ...(options.continuationAction ? { continuation_action: options.continuationAction } : {}),
    ...(options.resolveFocus ? { resolve_focus: options.resolveFocus } : {}),
    ...(options.gatewayStartRequiredPayload ? { gateway_start_required_payload: options.gatewayStartRequiredPayload } : {}),
  };
}

function launcherActionFailureFromRuntimeLifecycleError(
  error: unknown,
  options: Readonly<{
    scope: Extract<DesktopLauncherActionFailureScope, 'environment' | 'gateway'>;
    environmentID?: string;
    gatewayID?: string;
    gatewayLabel?: string;
  }>,
): DesktopLauncherActionFailure | null {
  if (!(error instanceof RuntimeLifecycleInProgressError)) {
    return null;
  }
  const activeAction = error.active_operation.intent;
  return launcherActionFailure(
    'runtime_lifecycle_in_progress',
    options.scope,
    `Another runtime lifecycle operation (${activeAction}) is already in progress.`,
    {
      environmentID: options.environmentID,
      gatewayID: options.gatewayID,
      gatewayLabel: options.gatewayLabel,
      operationKey: error.active_operation.operation_key,
      shouldRefreshSnapshot: true,
    },
  );
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
    titleKey?: DesktopOperationFailurePresentation['title_key'];
    summary: string;
    summaryKey?: DesktopOperationFailurePresentation['summary_key'];
    detail?: string;
    recoveryHint?: string;
    targetLabel?: string;
  }>,
): DesktopOperationFailurePresentation {
  return operationFailureFromUnknown(error, desktopOperationFailurePresentation({
    code: fallback.code,
    title: fallback.title,
    titleKey: fallback.titleKey,
    summary: fallback.summary,
    summaryKey: fallback.summaryKey,
    detail: fallback.detail,
    recoveryHint: fallback.recoveryHint,
    targetLabel: fallback.targetLabel,
  }));
}

function structuredDesktopFailureSource(error: unknown): unknown {
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();
  while (pending.length > 0) {
    const candidate = pending.shift();
    if (candidate === undefined || candidate === null || visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);
    if (isDesktopOperationFailureError(candidate)) {
      return candidate;
    }
    if (candidate instanceof AggregateError) {
      pending.unshift(...candidate.errors);
    }
    if (candidate instanceof Error && candidate.cause !== undefined) {
      pending.unshift(candidate.cause);
    }
  }
  return error;
}

function reinstallFailureForPhase(
  error: unknown,
  phase: ReinstallTargetProgressPhase,
  targetLabel: string,
): DesktopOperationFailurePresentation {
  const structured = isDesktopOperationFailureError(error) ? error.presentation : null;
  if (structured && structured.code !== 'runtime_host_command_failed' && structured.code !== 'operation_failed') {
    return {
      ...structured,
      target_label: structured.target_label || targetLabel,
    };
  }
  const mapped = (() => {
    switch (phase) {
      case 'direct_channel_open':
      case 'target_resolved':
        return {
          code: 'reinstall_direct_channel_failed' as const,
          title: 'Redeven direct connection failed',
          titleKey: 'progress.reinstallDirectChannelFailedTitle' as const,
          summary: `Desktop could not open the confirmed direct channel to "${targetLabel}".`,
          summaryKey: 'progress.reinstallDirectChannelFailedSummary' as const,
        };
      case 'package_batch_prepared_and_verified':
        return {
          code: 'reinstall_package_batch_failed' as const,
          title: 'Redeven package batch failed',
          titleKey: 'progress.reinstallPackageBatchFailedTitle' as const,
          summary: `Desktop could not prepare and verify the matching Gateway and Runtime packages for "${targetLabel}".`,
          summaryKey: 'progress.reinstallPackageBatchFailedSummary' as const,
        };
      case 'old_root_isolated_or_cleared':
      case 'fresh_suite_installed':
      case 'old_data_cleaned':
        return {
          code: 'reinstall_filesystem_failed' as const,
          title: 'Redeven target could not be replaced',
          titleKey: 'progress.reinstallFilesystemFailedTitle' as const,
          summary: `The operating system refused to replace the exact confirmed Redeven root on "${targetLabel}".`,
          summaryKey: 'progress.reinstallFilesystemFailedSummary' as const,
        };
      case 'gateway_started':
        return {
          code: 'reinstall_gateway_start_failed' as const,
          title: 'Fresh Gateway start failed',
          titleKey: 'progress.reinstallGatewayStartFailedTitle' as const,
          summary: `The freshly installed Gateway did not start on "${targetLabel}".`,
          summaryKey: 'progress.reinstallGatewayStartFailedSummary' as const,
        };
      case 'runtime_started':
      case 'runtime_verified':
      case 'catalog_and_local_ui_verified':
        return {
          code: 'reinstall_runtime_start_failed' as const,
          title: 'Fresh Runtime start failed',
          titleKey: 'progress.reinstallRuntimeStartFailedTitle' as const,
          summary: `The freshly installed Runtime did not become ready on "${targetLabel}".`,
          summaryKey: 'progress.reinstallRuntimeStartFailedSummary' as const,
        };
      default:
        return {
          code: 'operation_failed' as const,
          title: 'Redeven reinstall failed',
          titleKey: 'confirm.reinstallFailedTitle' as const,
          summary: error instanceof Error ? error.message : String(error),
        };
    }
  })();
  return desktopOperationFailurePresentation({
    ...mapped,
    targetLabel,
    ...(structured?.detail ? { detail: structured.detail } : {}),
    ...(structured?.recovery_hint ? { recoveryHint: structured.recovery_hint } : {}),
    ...(structured?.diagnostics ? { diagnostics: structured.diagnostics } : {}),
  });
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
  const conflict = launcherActionFailureFromRuntimeWorkloadChange(error, options);
  if (conflict) {
    return conflict;
  }
  const fallback = desktopOperationFailurePresentation({
    code: 'operation_failed',
    title: runtimeLifecycleFailureToastTitle(operation),
    summary: runtimeLifecycleFailureSummary(operation),
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

function runtimeStartFailureOperationForIntent(
  intent: RuntimeLifecycleIntent | undefined,
): DesktopRuntimeLifecycleOperation {
  switch (intent) {
    case 'start':
    case 'stop':
    case 'restart':
    case 'update':
      return intent;
    default:
      return 'restart';
  }
}

function launcherActionFailureFromRuntimeWorkloadChange(
  error: unknown,
  options: Readonly<{
    scope?: Extract<DesktopLauncherActionFailureScope, 'environment' | 'gateway'>;
    environmentID?: string;
    gatewayID?: string;
    gatewayLabel?: string;
    operationKey?: string;
    providerOrigin?: string;
    providerID?: string;
    envPublicID?: string;
  }> = {},
): DesktopLauncherActionFailure | null {
  if (!(error instanceof RuntimeProcessCommandError) || error.code !== 'runtime_inventory_changed') {
    return null;
  }
  const failure = desktopOperationFailurePresentation({
    code: 'confirmation_required',
    title: 'Runtime Confirmation Required',
    titleKey: 'progress.runtimeConfirmationRequiredTitle',
    summary: 'The Runtime workload changed before this operation could continue.',
    summaryKey: 'progress.runtimeConfirmationRequiredSummary',
    detail: error.message,
    detailKey: 'progress.runtimeConfirmationRequiredDetail',
    recoveryHint: 'Review the current Runtime workload, then confirm again to continue.',
    recoveryHintKey: 'progress.runtimeConfirmationRequiredRecoveryHint',
    diagnostics: [{
      channel: 'runtime_process_error',
      label: 'Runtime process error',
      text: `${error.code}: ${error.message}`,
    }],
  });
  return launcherActionFailure(
    'confirmation_required',
    options.scope ?? 'environment',
    failure.summary,
    {
      environmentID: options.environmentID,
      gatewayID: options.gatewayID,
      gatewayLabel: options.gatewayLabel,
      operationKey: options.operationKey,
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

function gatewayStore(): GatewayStore {
  if (!gatewayStoreCache) {
    gatewayStoreCache = new GatewayStore(defaultGatewayStorePath(preferencesPaths().stateRoot));
  }
  return gatewayStoreCache;
}

function gatewaySecretsFilePath(): string {
  return path.join(preferencesPaths().stateRoot, 'local-environment', 'gateway', 'gateway-secrets.json');
}

async function readGatewaySecretsFile(): Promise<Record<string, { encoding: string; data: string }>> {
  try {
    const raw = await fs.readFile(gatewaySecretsFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown; secrets?: unknown };
    const secrets = parsed.secrets && typeof parsed.secrets === 'object'
      ? parsed.secrets as Record<string, { encoding: string; data: string }>
      : {};
    return Object.fromEntries(Object.entries(secrets).filter(([key, value]) => (
      compact(key) !== ''
      && !!value
      && typeof value === 'object'
      && typeof value.encoding === 'string'
      && typeof value.data === 'string'
    )));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function writeGatewaySecretsFile(secrets: Record<string, { encoding: string; data: string }>): Promise<void> {
  const filePath = gatewaySecretsFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify({ version: 1, secrets }, null, 2)}\n`, { mode: 0o600 });
}

function gatewaySecretStore(): GatewaySecretStore {
  const codec = preferencesCodec();
  return {
    writeSecret: async (key, value) => {
      const cleanKey = compact(key);
      if (!cleanKey) {
        return;
      }
      const secrets = await readGatewaySecretsFile();
      secrets[cleanKey] = codec.encodeSecret(String(value ?? ''));
      await writeGatewaySecretsFile(secrets);
    },
    readSecret: async (key) => {
      const cleanKey = compact(key);
      if (!cleanKey) {
        return '';
      }
      const secret = (await readGatewaySecretsFile())[cleanKey];
      return secret ? codec.decodeSecret(secret) : '';
    },
    deleteSecret: async (key) => {
      const cleanKey = compact(key);
      if (!cleanKey) {
        return;
      }
      const secrets = await readGatewaySecretsFile();
      delete secrets[cleanKey];
      await writeGatewaySecretsFile(secrets);
    },
  };
}

function gatewayLifecycleManager(): GatewayLifecycleManager {
  if (!gatewayLifecycleManagerCache) {
    const bundle = requireDesktopBundle();
    gatewayLifecycleManagerCache = new GatewayLifecycleManager({
      secret_store: gatewaySecretStore(),
      runtime_release_tag: resolveSSHRuntimeReleaseTag(),
      release_base_url: PUBLIC_REDEVEN_RELEASE_BASE_URL,
      asset_cache_root: desktopRuntimePackageCacheRoot(),
      temp_root: app.getPath('temp'),
      source_runtime_root: process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT,
      precompiled_bundle: bundle,
      local_ui_bind: compact(process.env.REDEVEN_DESKTOP_LOCAL_UI_BIND),
      target_commit: bundle.commit,
      lifecycle_coordinator: runtimeLifecycleCoordinator,
      ssh_transport_manager: desktopSSHTransportManager,
    });
  }
  return gatewayLifecycleManagerCache;
}

function directReinstallTargetDescriptors(preferences: DesktopPreferences): readonly ReinstallTargetDescriptor[] {
  const descriptors: ReinstallTargetDescriptor[] = [
    {
      environment_id: preferences.local_environment.id,
      label: preferences.local_environment.label,
      host_access: { kind: 'local_host' },
      placement: localHostRuntimeLifecyclePlacement(preferences.local_environment),
      affected_environment_ids: [preferences.local_environment.id],
    },
    ...preferences.saved_runtime_targets.map((target): ReinstallTargetDescriptor => ({
      environment_id: target.id,
      label: target.label,
      host_access: target.host_access,
      placement: target.placement,
      ...(target.ssh_password_configured && target.ssh_password
        ? { ssh_password: target.ssh_password }
        : {}),
      affected_environment_ids: [target.id],
    })),
  ];
  return descriptors.map((descriptor) => {
    const fingerprint = reinstallTargetDescriptorFingerprint(descriptor);
    return {
      ...descriptor,
      affected_environment_ids: descriptors
        .filter((candidate) => reinstallTargetDescriptorFingerprint(candidate) === fingerprint)
        .map((candidate) => candidate.environment_id),
    };
  });
}

async function resolveDirectReinstallTarget(
  environmentID: string,
): Promise<ReinstallTargetDescriptor> {
  const cleanEnvironmentID = compact(environmentID);
  const descriptor = directReinstallTargetDescriptors(await loadDesktopPreferencesCached())
    .find((candidate) => candidate.environment_id === cleanEnvironmentID);
  if (!descriptor) {
    throw new ReinstallTargetCoordinatorError(
      'reinstall_unsupported',
      'This environment is externally managed or has no independent Desktop direct channel.',
    );
  }
  return descriptor;
}

async function reinstallTargetHelperPlatform(
  descriptor: ReinstallTargetDescriptor,
  executor: ReturnType<typeof runtimeHostExecutor>,
): Promise<DesktopSSHRemotePlatform> {
  if (descriptor.placement.kind === 'container_process') {
    return parseContainerPlatformProbeOutput((await executor.run(containerRuntimePlatformProbeCommand({
      engine: descriptor.placement.container_engine,
      container_id: descriptor.placement.container_id,
    }))).stdout);
  }
  const lines = (await executor.run(['sh', '-c', 'set -eu\nuname -s\nuname -m', 'redeven-reinstall-platform']))
    .stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('Desktop could not determine the reinstall target platform.');
  }
  return resolveDesktopSSHRemotePlatform(lines[0]!, lines[1]!);
}

async function reinstallTargetHelperArchive(
  descriptor: ReinstallTargetDescriptor,
  executor: ReturnType<typeof runtimeHostExecutor>,
  preparedPlatform?: DesktopSSHRemotePlatform,
): Promise<Buffer | undefined> {
  if (descriptor.host_access.kind === 'local_host' && descriptor.placement.kind === 'host_process') {
    return undefined;
  }
  const platform = preparedPlatform ?? (await reinstallTargetHelperPlatform(descriptor, executor));
  return prepareDesktopRuntimeMaintenanceHelperAsset({
    runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
    releaseBaseURL: PUBLIC_REDEVEN_RELEASE_BASE_URL,
    assetCacheRoot: desktopRuntimePackageCacheRoot(),
    sourceRuntimeRoot: compact(process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT) || undefined,
    platform,
    fetchPolicy: runtimeReleaseFetchPolicy(45_000),
  });
}

async function closeDesktopSessionsForReinstallTarget(
  descriptor: ReinstallTargetDescriptor,
): Promise<void> {
  const affected = new Set(descriptor.affected_environment_ids);
  for (const sessionRecord of [...sessionsByKey.values()]) {
    if (
      !sessionRecord.closing
      && (
        affected.has(sessionRecord.target.environment_id)
      )
    ) {
      await finalizeSessionClosure(sessionRecord.session_key, {
        reason: 'runtime_restart',
      });
    }
  }
  for (const candidate of directReinstallTargetDescriptors(await loadDesktopPreferencesCached())) {
    if (affected.has(candidate.environment_id)) {
      await clearRuntimePlacementBridgeRecord(desktopRuntimeTargetID(
        candidate.host_access,
        candidate.placement,
        candidate.environment_id,
      )).catch(() => undefined);
    }
  }
}

async function clearDesktopStateForReinstallTarget(
  descriptor: ReinstallTargetDescriptor,
): Promise<void> {
  const affected = new Set(descriptor.affected_environment_ids);
  for (const candidate of directReinstallTargetDescriptors(await loadDesktopPreferencesCached())) {
    if (affected.has(candidate.environment_id)) {
      await clearRuntimePlacementTargetRecords(desktopRuntimeTargetID(
        candidate.host_access,
        candidate.placement,
        candidate.environment_id,
      )).catch(() => undefined);
      if (candidate.host_access.kind === 'ssh_host' && candidate.placement.kind === 'host_process') {
        clearSSHRuntimeReadyState(sshDesktopSessionKey(sshDetailsFromRuntimePlacement(
          candidate.host_access,
          candidate.placement,
        )));
      }
    }
  }
  if (affected.has((await loadDesktopPreferencesCached()).local_environment.id)) {
    localEnvironmentRuntimeRecord = null;
    runtimeFlowerAccessCookies.clear();
  }
}

async function prepareFreshReinstallPackages(
  descriptor: ReinstallTargetDescriptor,
  targetRoot: string,
  operationID: string,
  executor: ReturnType<typeof runtimeHostExecutor>,
  platform: DesktopSSHRemotePlatform,
  onProgress?: (tasks: readonly DesktopComponentTaskProgress[]) => void,
): Promise<PreparedComponentBatch | null> {
    const strategy: ManagedComponentTask['strategy'] = descriptor.host_access.kind === 'ssh_host'
      && descriptor.placement.kind === 'host_process'
      && descriptor.placement.bootstrap_strategy === 'remote_install'
      ? 'remote_install'
      : 'desktop_upload';
    const releaseTag = resolveSSHRuntimeReleaseTag();
    const commit = requireDesktopBundle().commit;
    const releaseBaseURL = descriptor.placement.kind === 'host_process'
      ? descriptor.placement.release_base_url ?? PUBLIC_REDEVEN_RELEASE_BASE_URL
      : PUBLIC_REDEVEN_RELEASE_BASE_URL;
    const remoteManifestPromise = strategy === 'remote_install'
      ? ensureDesktopSSHVerifiedReleaseManifest({
          releaseTag,
          releaseBaseURL,
          cacheRoot: desktopRuntimePackageCacheRoot(),
          fetchPolicy: runtimeReleaseFetchPolicy(45_000),
        })
      : null;
    const tasks: readonly ManagedComponentTask[] = [
      {
        component: 'gateway',
        strategy,
        release_tag: releaseTag,
        commit,
        platform: platform.goos,
        architecture: platform.goarch,
      },
      {
        component: 'runtime',
        strategy,
        release_tag: releaseTag,
        commit,
        platform: platform.goos,
        architecture: platform.goarch,
      },
    ];
    const initial: Array<DesktopComponentTaskProgress & Readonly<{
      id: ManagedComponentTask['component'];
    }>> = tasks.map((task) => ({
      id: task.component,
      status: 'running' as const,
      phase: 'preparing' as const,
      strategy: task.strategy,
      detail_key: task.strategy === 'remote_install' ? 'common.remoteInstall' as const : 'common.desktopUpload' as const,
    }));
    const current = new Map<ManagedComponentTask['component'], DesktopComponentTaskProgress>(
      initial.map((task) => [task.id, task]),
    );
    onProgress?.(initial);
    return await prepareAndStageBatch(tasks, new AbortController().signal, (progress) => {
      current.set(progress.id, progress);
      onProgress?.(tasks.map((task) => current.get(task.component)!).filter(Boolean));
    }, {
      operation_id: operationID,
      run: async (task, signal, report) => {
        report({
          id: task.component,
          status: 'running',
          phase: 'preparing',
          strategy: task.strategy,
          detail_key: task.strategy === 'remote_install' ? 'common.remoteInstall' : 'common.desktopUpload',
        });
        if (task.strategy === 'remote_install') {
          const manifest = await remoteManifestPromise;
          const packageName = desktopSSHReleasePackageName(platform, task.component);
          const archiveSHA256 = manifest?.sha256_by_asset_name.get(packageName) ?? '';
          if (!manifest || !/^[a-f0-9]{64}$/u.test(archiveSHA256)) {
            throw new Error(`Verified release manifest does not include ${packageName}.`);
          }
          return stageManagedComponent({
            executor, placement: descriptor.placement, target_root: targetRoot, operation_id: operationID, task,
            archive_sha256: archiveSHA256,
            remote_url: buildDesktopSSHReleaseAssetURL(releaseBaseURL, task.release_tag, packageName),
            signal, on_progress: report,
          });
        }
        const asset = await prepareDesktopRuntimeUploadAsset({
          runtimeReleaseTag: task.release_tag,
          releaseBaseURL,
          assetCacheRoot: desktopRuntimePackageCacheRoot(),
          packageKind: task.component,
          sourceRuntimeRoot: compact(process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT) || undefined,
          platform,
          fetchPolicy: runtimeReleaseFetchPolicy(45_000, signal),
          signal,
        });
        return stageManagedComponent({
          executor,
          placement: descriptor.placement,
          target_root: targetRoot,
          operation_id: operationID,
          task,
          archive: asset.archiveData,
          archive_sha256: asset.cacheEntry?.sha256 ?? crypto.createHash('sha256').update(asset.archiveData).digest('hex'),
          archive_size_bytes: asset.archiveData.byteLength,
          signal,
          on_progress: report,
        });
      },
      discard: async () => {
        await cleanupManagedComponentBatch(executor, descriptor.placement, targetRoot, operationID).catch(() => undefined);
      },
    });
}

function directReinstallGatewayServiceOptions(
  descriptor: ReinstallTargetDescriptor,
  forceUpdate = false,
): GatewayServiceHostOptions {
  const target = descriptor.host_access.kind === 'ssh_host'
    ? sshDetailsFromRuntimePlacement(descriptor.host_access, descriptor.placement)
    : undefined;
  return {
    sshTransportManager: desktopSSHTransportManager,
    sshCredentialScope: descriptor.environment_id,
    ...(target ? { target } : {}),
    hostAccess: descriptor.host_access,
    placement: descriptor.placement,
    stateRoot: desktopRuntimePlacementStateRoot(descriptor.placement),
    releaseTag: resolveSSHRuntimeReleaseTag(),
    releaseBaseURL: descriptor.placement.kind === 'host_process'
      ? descriptor.placement.release_base_url ?? PUBLIC_REDEVEN_RELEASE_BASE_URL
      : PUBLIC_REDEVEN_RELEASE_BASE_URL,
    assetCacheRoot: desktopRuntimePackageCacheRoot(),
    sourceRuntimeRoot: compact(process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT) || undefined,
    precompiledBundle: requireDesktopBundle(),
    localUIBind: compact(process.env.REDEVEN_DESKTOP_LOCAL_UI_BIND) || undefined,
    targetCommit: requireDesktopBundle().commit,
    ...(descriptor.ssh_password ? { sshPassword: descriptor.ssh_password } : {}),
    tempRoot: app.getPath('temp'),
    forceUpdate,
  };
}

async function installFreshDirectReinstallTarget(
  descriptor: ReinstallTargetDescriptor,
  targetRoot: string,
  onProgress?: (phase: ReinstallTargetProgressPhase, detailKey?: string, tasks?: readonly DesktopComponentTaskProgress[]) => Promise<void>,
  mode: 'wipe_data' | 'preserve_data' = 'wipe_data',
  preparedBatch?: PreparedComponentBatch | null,
): Promise<void> {
  if (!preparedBatch) {
    throw new Error('Managed component batch is unavailable.');
  }
  const runtimeComponent = preparedBatch.suite_manifest.components
    .find((entry) => entry.component === 'runtime');
  if (!runtimeComponent) {
    throw new Error('Managed Runtime component is unavailable.');
  }
  const stateRoot = targetRoot;
  const placement: DesktopRuntimePlacement = {
    ...descriptor.placement,
    runtime_root: targetRoot,
    runtime_state_root: stateRoot,
  };
  const executor = runtimeHostExecutor(
    descriptor.host_access,
    descriptor.environment_id,
    descriptor.ssh_password,
  );
  try {
    await activateManagedComponentBatch(executor, placement, targetRoot, preparedBatch, mode);
    await onProgress?.('fresh_suite_installed');
    // The Gateway service owns Runtime startup. Mark the Gateway phase before
    // entering that command so a startup failure is reported at the real
    // boundary, then commit Runtime startup only after the command succeeds.
    await onProgress?.('gateway_started');
    await startManagedComponentBatch(
      executor,
      placement,
      targetRoot,
      stateRoot,
      preparedBatch.operation_id,
      preparedBatch.suite_manifest.release_tag,
      preparedBatch.suite_manifest.commit,
      runtimeComponent.executable_sha256,
    );
    await onProgress?.('runtime_started');
  } finally {
    await executor.release();
  }
}

async function finalizeFreshReinstallBatch(
  descriptor: ReinstallTargetDescriptor,
  targetRoot: string,
  operationID: string,
): Promise<void> {
  const executor = runtimeHostExecutor(descriptor.host_access, descriptor.environment_id, descriptor.ssh_password);
  try {
    await cleanupManagedComponentBatch(executor, descriptor.placement, targetRoot, operationID);
  } finally {
    await executor.release();
  }
}

async function rollbackFreshReinstallBatch(
  descriptor: ReinstallTargetDescriptor,
  targetRoot: string,
  operationID: string,
): Promise<void> {
  const executor = runtimeHostExecutor(descriptor.host_access, descriptor.environment_id, descriptor.ssh_password);
  try {
    await rollbackManagedComponentBatch(executor, descriptor.placement, targetRoot, operationID);
  } finally {
    await executor.release();
  }
}

async function verifyFreshDirectReinstallTarget(
  descriptor: ReinstallTargetDescriptor,
  targetRoot: string,
): Promise<void> {
  const placement: DesktopRuntimePlacement = {
    ...descriptor.placement,
    runtime_root: targetRoot,
    runtime_state_root: targetRoot,
  };
  const resolvedDescriptor: ReinstallTargetDescriptor = {
    ...descriptor,
    placement,
  };
  const service = await probeManagedGatewayServiceDeep(directReinstallGatewayServiceOptions(resolvedDescriptor));
  if (service.service_status !== 'running' || service.package_status !== 'ready') {
    throw new Error('Desktop could not verify the fresh Gateway identity.');
  }
  const registeredTargetID = desktopRuntimeTargetID(
    descriptor.host_access,
    descriptor.placement,
    descriptor.environment_id,
  );
  const runtimeBinaryPath = `${targetRoot.replace(/\/$/u, '')}/runtime/managed/bin/redeven`;
  const bridge = await startRuntimePlacementBridgeSession({
    host_access: descriptor.host_access,
    placement,
    runtime_binary_path: runtimeBinaryPath,
    ssh_password: descriptor.ssh_password,
    ssh_credential_scope: descriptor.environment_id,
    ssh_transport_manager: desktopSSHTransportManager,
    fallback_local_id: descriptor.environment_id,
  });
  try {
    if (!runtimeServiceIsOpenable(bridge.startup.runtime_service)) {
      throw new Error('Desktop could not verify the fresh Runtime identity.');
    }
    const affectedIDs = new Set(descriptor.affected_environment_ids);
    const registeredDescriptors = directReinstallTargetDescriptors(await loadDesktopPreferencesCached())
      .filter((candidate) => affectedIDs.has(candidate.environment_id));
    const targets = registeredDescriptors.length > 0 ? registeredDescriptors : [descriptor];
    for (const target of targets) {
      const targetID = desktopRuntimeTargetID(
        target.host_access,
        target.placement,
        target.environment_id,
      );
      runtimePlacementReadyByTargetID.set(targetID, {
        runtime_key: targetID,
        environment_id: target.environment_id,
        label: target.label,
        target_id: providerRuntimeLinkTargetIDForRuntimeTarget(target.host_access, targetID),
        host_access: target.host_access,
        placement: {
          ...target.placement,
          runtime_root: targetRoot,
          runtime_state_root: targetRoot,
        },
        runtime_binary_path: runtimeBinaryPath,
        startup: bridge.startup,
      });
    }
  } finally {
    await bridge.disconnect().catch(() => undefined);
  }
  if (!runtimePlacementReadyByTargetID.get(registeredTargetID)?.startup) {
    throw new Error('Desktop could not verify the fresh Runtime identity.');
  }
}

async function verifyReinstallTargetCatalogAndLocalUI(
  descriptor: ReinstallTargetDescriptor,
  targetRoot: string,
): Promise<void> {
  await verifyFreshDirectReinstallTarget(descriptor, targetRoot);
  const placement: DesktopRuntimePlacement = {
    ...descriptor.placement,
    runtime_root: targetRoot,
    runtime_state_root: targetRoot,
  };
  const targetID = desktopRuntimeTargetID(
    descriptor.host_access,
    descriptor.placement,
    descriptor.environment_id,
  );
  const ready = savedRuntimePlacementReadyRecord(
    targetID,
    descriptor.environment_id,
    descriptor.label,
    descriptor.host_access,
    descriptor.placement,
  );
  if (!ready?.startup) {
    throw new Error('Fresh Runtime readiness is unavailable after installation.');
  }
  const bridge = await startRuntimePlacementBridgeSession({
    host_access: descriptor.host_access,
    placement,
    runtime_binary_path: ready.runtime_binary_path,
    ssh_password: descriptor.ssh_password,
    ssh_credential_scope: descriptor.environment_id,
    ssh_transport_manager: desktopSSHTransportManager,
    fallback_local_id: descriptor.environment_id,
  });
  try {
    const localUI = await probeExternalLocalUIStartup(bridge.startup.local_ui_url, {
      timeoutMs: DESKTOP_RUNTIME_PROBE_TIMEOUT_MS,
    });
    if (!localUI.ok) {
      throw new Error('Desktop could not verify the fresh Local UI through the direct channel.');
    }
  } finally {
    await bridge.disconnect().catch(() => undefined);
  }
}

function reinstallTargetCoordinator(): ReinstallTargetCoordinator {
  if (!reinstallTargetCoordinatorCache) {
    reinstallTargetCoordinatorCache = new ReinstallTargetCoordinator({
      journal_root: path.join(preferencesPaths().stateRoot, 'maintenance', 'reinstall-target'),
      resolve_target: ({ environment_id }) => resolveDirectReinstallTarget(environment_id),
      resolve_candidates: async () => directReinstallTargetDescriptors(await loadDesktopPreferencesCached()),
      create_executor: (descriptor) => runtimeHostExecutor(
        descriptor.host_access,
        descriptor.environment_id,
        descriptor.ssh_password,
      ),
      prepare_platform: (descriptor, executor) => reinstallTargetHelperPlatform(descriptor, executor),
      prepare_process_session: async (descriptor, targetRoot, executor, platform) => openReinstallTargetProcessSession({
        executor,
        placement: descriptor.placement,
        target_root: targetRoot,
        helper_archive: await reinstallTargetHelperArchive(
          descriptor,
          executor,
          platform as DesktopSSHRemotePlatform,
        ),
        local_helper_executable: bundledRuntimeExecutablePath(),
      }),
      mark_in_progress: (descriptor, preflightID) => writeReinstallTargetRequiredMarker(descriptor, {
        gatewayID: '',
        reason: `reinstall_in_progress:${preflightID}`,
      }),
      close_sessions: closeDesktopSessionsForReinstallTarget,
      clear_desktop_state: clearDesktopStateForReinstallTarget,
      prepare_packages: prepareFreshReinstallPackages,
      install_fresh: installFreshDirectReinstallTarget,
      finalize_install: finalizeFreshReinstallBatch,
      rollback_install: rollbackFreshReinstallBatch,
      verify_fresh_identity: verifyFreshDirectReinstallTarget,
      verify_catalog_and_local_ui: verifyReinstallTargetCatalogAndLocalUI,
      clear_completed_marker: clearReinstallTargetRequired,
    });
  }
  return reinstallTargetCoordinatorCache;
}

function providerRuntimeLifecycleClient(): ProviderRuntimeLifecycleClient {
  if (!providerRuntimeLifecycleClientCache) {
    providerRuntimeLifecycleClientCache = new ProviderRuntimeLifecycleClient(gatewaySecretStore());
  }
  return providerRuntimeLifecycleClientCache;
}

function stripSensitiveURLPayload(rawURL: string): string {
  const cleanURL = compact(rawURL);
  if (!cleanURL) {
    return '';
  }
  try {
    const url = new URL(cleanURL);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function rendererSafeStartupReport(startup: StartupReport): StartupReport {
  const rendererStartup = { ...startup };
  delete rendererStartup.local_ui_bridge_url;
  const localUIURL = stripSensitiveURLPayload(startup.local_ui_url);
  const localUIURLs = startup.local_ui_urls
    .map((url) => stripSensitiveURLPayload(url))
    .filter((url) => url !== '');
  return {
    ...rendererStartup,
    local_ui_url: localUIURL,
    local_ui_urls: localUIURLs.length > 0 ? localUIURLs : localUIURL ? [localUIURL] : [],
  };
}

function rendererSafeSessionURL(session: DesktopSessionRecord): string {
  return stripSensitiveURLPayload(session.display_url) || stripSensitiveURLPayload(session.startup.local_ui_url);
}

function desktopStateStore(): DesktopStateStore {
  if (!desktopStateStoreCache) {
    desktopStateStoreCache = new DesktopStateStore(defaultDesktopStateStorePath(app.getPath('userData')));
  }
  return desktopStateStoreCache;
}

function desktopThemeState(): DesktopThemeState {
  if (!desktopThemeStateCache) {
    desktopThemeStateCache = new DesktopThemeState(
      desktopStateStore(),
      nativeTheme,
      process.platform,
      () => {
        refreshCodespaceLoadingDocuments();
        refreshWebServiceBrowserDocuments();
      },
    );
  }
  desktopThemeStateCache.initialize();
  return desktopThemeStateCache;
}

function desktopLanguageState(): DesktopLanguageState {
  if (!desktopLanguageStateCache) {
    desktopLanguageStateCache = new DesktopLanguageState(desktopStateStore(), app, {
      onSnapshotChanged: () => {
        installOrRefreshAppMenu();
        broadcastDesktopWelcomeSnapshots();
      },
    });
  }
  desktopLanguageStateCache.initialize();
  return desktopLanguageStateCache;
}

function appMenuActions() {
  return {
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
  } as const;
}

function installOrRefreshAppMenu(): void {
  if (!app.isReady()) {
    return;
  }
  const i18n = createDesktopI18n(desktopLanguageState().getSnapshot().resolved_locale);
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate(appMenuActions(), i18n)));
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
  if (!desktopPreferencesLoadPromise) {
    desktopPreferencesLoadPromise = (async () => {
      const paths = preferencesPaths();
      const loaded = await loadDesktopPreferences(paths, preferencesCodec());
      desktopPreferencesCache = loaded;
      return loaded;
    })().finally(() => {
      desktopPreferencesLoadPromise = null;
    });
  }
  return desktopPreferencesLoadPromise;
}

function syncOpenSessionTargetsWithPreferences(preferences: DesktopPreferences): void {
  const managedByID = new Map<string, DesktopLocalEnvironmentState>(
    [[preferences.local_environment.id, preferences.local_environment] as const],
  );
  const savedLabelByURL = new Map(
    preferences.saved_environments.map((environment) => [environment.local_ui_url, environment.label]),
  );
  const savedRuntimeTargetLabelByID = new Map<string, string>(
    preferences.saved_runtime_targets.map((target) => [target.id, target.label]),
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
    const savedLabel = savedRuntimeTargetLabelByID.get(session.target.environment_id);
    if (!savedLabel || savedLabel === session.target.label) {
      continue;
    }
    session.target = {
      ...session.target,
      label: savedLabel,
    };
  }
}

async function mutateDesktopPreferences(
  mutation: (current: DesktopPreferences) => DesktopPreferences,
): Promise<DesktopPreferences> {
  const task = desktopPreferencesMutationTail.then(async () => {
    const current = await loadDesktopPreferencesCached();
    const next = mutation(current);
    if (next === current) {
      return current;
    }
    await saveDesktopPreferences(preferencesPaths(), next, preferencesCodec());
    desktopPreferencesCache = next;
    syncOpenSessionTargetsWithPreferences(next);
    broadcastDesktopWelcomeSnapshots();
    return next;
  });
  desktopPreferencesMutationTail = task.then(() => undefined, () => undefined);
  return task;
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
    flowerSettingsFocusRevision: 0,
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
      + runtimePlacementBridgeRegistry.size,
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
        buildDesktopLastWindowCloseConfirmationModel(impact, desktopLanguageState().getSnapshot().resolved_locale),
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
        buildDesktopQuitConfirmationModel(impact, desktopLanguageState().getSnapshot().resolved_locale),
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

function sessionCodespaceWindowStateKey(sessionKey: DesktopSessionKey, codeSpaceID: string): string {
  return `window:session:${desktopSessionStateKeyFragment(sessionKey)}:codespace:${encodeURIComponent(codeSpaceID)}`;
}

function sessionWebServiceWindowStateKey(sessionKey: DesktopSessionKey, forwardID: string): string {
  return `window:session:${desktopSessionStateKeyFragment(sessionKey)}:web-service:${encodeURIComponent(forwardID)}`;
}

function sessionWebServicePartition(sessionKey: DesktopSessionKey, forwardID: string): string {
  // codeql[js/insufficient-password-hash]: this is a keyed partition namespace
  // pseudonym, never a password verifier; HMAC prevents exposing session ids.
  const digest = crypto.createHmac('sha256', 'redeven-web-service-partition-v1')
    .update(`${sessionKey}\u0000${forwardID}`)
    .digest('hex')
    .slice(0, 32);
  return `redeven-web-service-${digest}`;
}

function openSessionSummaries(): readonly DesktopSessionSummary[] {
  return [...sessionsByKey.values()]
    .filter((session) => !session.closing && Boolean(liveTrackedBrowserWindow(session.root_window)))
    .map((session) => ({
      session_key: session.session_key,
      target: session.target,
      lifecycle: session.lifecycle,
      entry_url: rendererSafeSessionURL(session),
      startup: rendererSafeStartupReport(session.startup),
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
): Promise<DesktopRuntimePresence> {
  const targetID = desktopProviderRuntimeLinkTargetID('local_environment', environment.id);
  const hostAccess: DesktopRuntimeHostAccess = { kind: 'local_host' };
  const placement = localHostRuntimeLifecyclePlacement(environment);
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
    startedAtUnixMS: record.startup.started_at_unix_ms,
    runtimeService: record.startup.runtime_service,
    runtimeControlStatus: await runtimeControlStatusForStartup(record.startup),
  });
}

function localEnvironmentMaintenanceProbeResult(
  environment: DesktopPreferences['local_environment'],
  maintenance: DesktopRuntimeMaintenanceRequirement,
): DesktopWelcomeRuntimeHealthProbeResult {
  const hostAccess: DesktopRuntimeHostAccess = { kind: 'local_host' };
  const placement = localHostRuntimeLifecyclePlacement(environment);
  return {
    health: {
      ...offlineRuntimeHealth('local_runtime_probe', 'unverified', maintenance.message),
      runtime_maintenance: maintenance,
    },
    presence: managedRuntimePresence({
      targetID: desktopProviderRuntimeLinkTargetID('local_environment', environment.id),
      placementTargetID: desktopRuntimeTargetID(hostAccess, placement, environment.id),
      kind: 'local_environment',
      environmentID: environment.id,
      label: environment.label,
      runtimeKey: environment.id,
      hostAccess,
      placement,
      running: true,
      localUIURL: '',
      runtimeControlStatus: desktopRuntimeControlStatusMissing('not_reported', maintenance.message),
      maintenance,
    }),
  };
}

async function probeLocalEnvironmentRuntimeHealth(
  preferences: DesktopPreferences,
  openSessions: readonly DesktopSessionSummary[],
): Promise<DesktopWelcomeRuntimeHealthProbeResult> {
  const localEnvironment = preferences.local_environment;
  const verifiedRecord = await verifyCurrentLocalEnvironmentRuntimeRecord(localEnvironment);
  if (verifiedRecord) {
    localRuntimeMaintenanceByEnvironmentID.delete(localEnvironment.id);
    return {
      health: onlineRuntimeHealth('local_runtime_probe', verifiedRecord.startup.local_ui_url, verifiedRecord.startup.runtime_service),
      presence: await localEnvironmentPresenceFromRecord(localEnvironment, verifiedRecord),
    };
  }

  const hydratedPreferences = await hydrateWelcomeLocalEnvironmentRuntimeState(preferences, openSessions, {
    executablePath: bundledRuntimeExecutablePath(),
    stateRoot: localEnvironmentStateRoot(),
  });
  const runtime = hydratedPreferences.local_environment.local_hosting.current_runtime;
  if (!runtime) {
    const inventory = await inspectLocalManagedRuntimeProcesses({
      executablePath: bundledRuntimeExecutablePath(),
      runtimeRoot: localEnvironmentRuntimeRoot(localEnvironment),
      stateRoot: localEnvironmentStateRoot(),
      env: process.env,
    });
    let maintenance: DesktopRuntimeMaintenanceRequirement | undefined;
    if (inventory.summary.blocked > 0) {
      localRuntimeMaintenanceByEnvironmentID.delete(localEnvironment.id);
      return {
        health: offlineRuntimeHealth(
          'local_runtime_probe',
          'unverified',
          'Desktop found a local Runtime process whose core identity cannot be safely verified.',
        ),
      };
    }
    if (inventory.summary.automatic > 0) {
      maintenance = buildDesktopRuntimeMaintenanceRequirement({
        kind: 'runtime_restart_required',
        required_for: 'open',
        recovery_action: 'restart_runtime',
        can_desktop_start: false,
        can_desktop_restart: true,
        has_active_work: true,
        active_work_label: 'The existing Runtime may contain active work',
        target_runtime_version: resolveSSHRuntimeReleaseTag(),
        message: 'Desktop found a verified local Runtime process without an attachable Runtime Service. Restart it before opening this Environment.',
      });
    }
    if (maintenance) {
      localRuntimeMaintenanceByEnvironmentID.set(localEnvironment.id, maintenance);
      return localEnvironmentMaintenanceProbeResult(localEnvironment, maintenance);
    }
    localRuntimeMaintenanceByEnvironmentID.delete(localEnvironment.id);
    return {
      health: offlineRuntimeHealth('local_runtime_probe', 'not_started', 'Start the local runtime before opening this environment.'),
    };
  }
  localRuntimeMaintenanceByEnvironmentID.delete(localEnvironment.id);
  return {
    health: {
      ...onlineRuntimeHealth('local_runtime_probe', runtime.local_ui_url, runtime.runtime_service),
      ...(runtime.started_at_unix_ms ? { started_at_unix_ms: runtime.started_at_unix_ms } : {}),
    },
  };
}

async function probeSavedExternalRuntimeHealth(
  environment: DesktopSavedEnvironment,
): Promise<DesktopWelcomeRuntimeHealthProbeResult> {
  try {
    const result = await probeExternalLocalUIStartup(environment.local_ui_url, {
      timeoutMs: DESKTOP_RUNTIME_PROBE_TIMEOUT_MS,
    });
    if (!result.ok) {
      return {
        health: offlineRuntimeHealth('external_local_ui_probe', 'unverified', 'Could not verify runtime health'),
      };
    }
    const startup = result.value;
    return {
      health: {
        ...onlineRuntimeHealth('external_local_ui_probe', startup.local_ui_url, startup.runtime_service),
        ...(startup.started_at_unix_ms ? { started_at_unix_ms: startup.started_at_unix_ms } : {}),
      },
    };
  } catch {
    return {
      health: offlineRuntimeHealth('external_local_ui_probe', 'unverified', 'Could not verify runtime health'),
    };
  }
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
  if (state.transport_observation) {
    return offlineRuntimeHealth(
      source,
      state.transport_observation === 'recovering' ? 'runtime_disconnected' : 'probe_failed',
      'Could not verify runtime status',
    );
  }
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
): DesktopRuntimePresence {
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
    startedAtUnixMS: state.startup?.started_at_unix_ms,
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

function welcomeRuntimeProbeCoordinatorKey(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
  credentialScope: string,
): string {
  return runtimeLifecycleFingerprint({
    physical_target: runtimeLifecycleTargetKey(hostAccess, placement),
    runtime_release_tag: resolveSSHRuntimeReleaseTag(),
    credential_scope: hostAccess.kind === 'ssh_host' && hostAccess.ssh.auth_mode === 'password'
      ? credentialScope
      : 'key-agent-or-local',
  });
}

function projectWelcomeRuntimeProbeResult(
  result: DesktopWelcomeRuntimeHealthProbeResult,
  identity: Readonly<{
    target_id: DesktopProviderRuntimeLinkTargetID;
    placement_target_id: DesktopRuntimeTargetID;
    environment_id: string;
    label: string;
    runtime_key?: string;
    host_access?: DesktopRuntimeHostAccess;
    placement?: DesktopRuntimePlacement;
  }>,
): DesktopWelcomeRuntimeHealthProbeResult {
  if (!result.presence) {
    return result;
  }
  return {
    ...result,
    presence: {
      ...result.presence,
      target_id: identity.target_id,
      placement_target_id: identity.placement_target_id,
      environment_id: identity.environment_id,
      label: identity.label,
      ...(identity.runtime_key ? { runtime_key: identity.runtime_key } : {}),
      ...(identity.host_access ? { host_access: identity.host_access } : {}),
      ...(identity.placement ? { placement: identity.placement } : {}),
    },
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
    ...preferences.saved_runtime_targets.map((target) => {
      const targetKind = providerRuntimeLinkKindForHostAccess(target.host_access);
      const presenceTargetID = desktopProviderRuntimeLinkTargetID(targetKind, target.id);
      return {
        key: `runtime-target:${target.id}`,
        probe_coordinator_key: welcomeRuntimeProbeCoordinatorKey(target.host_access, target.placement, target.id),
        environment_id: target.id,
        slot: 'runtime_target' as const,
        presence_target_id: presenceTargetID,
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
        project_shared_result: (result: DesktopWelcomeRuntimeHealthProbeResult) => projectWelcomeRuntimeProbeResult(result, {
          target_id: presenceTargetID,
          placement_target_id: target.id,
          environment_id: target.id,
          label: target.label,
          runtime_key: target.id,
          host_access: target.host_access,
          placement: target.placement,
        }),
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

  // A successful direct probe is newer than an old recovery marker. The
  // marker remains useful while the target is unhealthy, but it must not keep
  // a healthy Runtime in a reinstall-only state.
  const refreshedHealth = welcomeRuntimeHealthStore.snapshot();
  const descriptors = directReinstallTargetDescriptors(preferences);
  await Promise.all(descriptors.map(async (descriptor) => {
    const health = refreshedHealth.localRuntimeHealth[descriptor.environment_id]
      ?? refreshedHealth.savedRuntimeTargetHealth[descriptor.environment_id]
      ?? refreshedHealth.savedExternalRuntimeHealth[descriptor.environment_id];
    if (health?.status !== 'online') {
      return;
    }
    await clearReinstallTargetRequired(descriptor);
  }));
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

async function refreshWelcomeRuntimeHealthForEnvironment(
  environmentID: string,
  options: Readonly<{ force?: boolean }> = {},
): Promise<void> {
  const cleanEnvironmentID = compact(environmentID);
  await refreshWelcomeRuntimeHealth({
    force: options.force !== false,
    mode: 'manual',
    targetEnvironmentIDs: cleanEnvironmentID ? [cleanEnvironmentID] : [],
  });
}

function welcomeRuntimeHealthForEnvironment(environmentID: string): DesktopRuntimeHealth | undefined {
  return desktopWelcomeRuntimeHealthForEnvironment(
    welcomeRuntimeHealthStore.snapshot(),
    environmentID,
  );
}

async function _awaitEnvironmentRuntimeLifecycleReadiness(
  environmentID: string,
  operation: DesktopRuntimeLifecycleReadinessOperation,
): Promise<void> {
  const preferences = await loadDesktopPreferencesCached();
  const tracked = buildWelcomeRuntimeHealthTargets(preferences, openSessionSummaries())
    .some((target) => target.environment_id === environmentID && target.slot !== 'external_local_ui');
  if (!tracked) {
    return;
  }
  await waitForDesktopRuntimeLifecycleReadiness({
    operation,
    observe: async () => {
      await refreshWelcomeRuntimeHealthForEnvironment(environmentID, {
        force: true,
      });
      return welcomeRuntimeHealthForEnvironment(environmentID);
    },
  });
}

function launcherActionEnvironmentID(request: DesktopLauncherActionRequest): string {
  return 'environment_id' in request ? compact(request.environment_id) : '';
}

function launcherActionRefreshScope(request: DesktopLauncherActionRequest): Readonly<{
  force: boolean;
  mode: 'auto' | 'manual';
  targetEnvironmentIDs?: readonly string[];
}> | null {
  const targetEnvironmentID = launcherActionEnvironmentID(request);
  const targetScope = targetEnvironmentID ? [targetEnvironmentID] : undefined;
  const actionKind: DesktopLauncherActionKind = request.kind;
  switch (actionKind) {
    case 'open_local_environment':
    case 'open_remote_environment':
    case 'open_gateway_environment':
    case 'open_ssh_environment':
    case 'start_environment_runtime':
    case 'restart_environment_runtime':
    case 'update_environment_runtime':
    case 'connect_provider_runtime':
    case 'disconnect_provider_runtime':
    case 'stop_environment_runtime':
      return { force: true, mode: 'manual', targetEnvironmentIDs: targetScope };
    case 'setup_direct_runtime_management':
      return { force: true, mode: 'manual', targetEnvironmentIDs: targetScope };
    case 'save_local_environment_settings':
    case 'upsert_environment_registration':
    case 'delete_environment_registration':
    case 'upsert_gateway':
    case 'set_gateway_enabled':
    case 'refresh_gateway':
    case 'sync_gateway':
    case 'pair_gateway':
    case 'refresh_gateway_catalog':
    case 'refresh_gateway_status':
    case 'delete_gateway':
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

function launcherActionGatewayID(request: DesktopLauncherActionRequest): string {
  if (request.kind === 'upsert_environment_registration') {
    return request.registration.registration_ref.kind === 'gateway_environment'
      ? compact(request.registration.registration_ref.gateway_id)
      : '';
  }
  if (request.kind === 'delete_environment_registration') {
    return request.registration_ref.kind === 'gateway_environment'
      ? compact(request.registration_ref.gateway_id)
      : '';
  }
  return 'gateway_id' in request ? compact(request.gateway_id) : '';
}

function scheduleGatewaySyncAfterLauncherAction(
  request: DesktopLauncherActionRequest,
  result: DesktopLauncherActionResult,
): void {
  const actionKind: DesktopLauncherActionKind = request.kind;
  if (
    !result.ok
    && actionKind !== 'pair_gateway'
    && actionKind !== 'sync_gateway'
    && actionKind !== 'refresh_gateway_catalog'
    && actionKind !== 'refresh_gateway_status'
    && actionKind !== 'upsert_environment_registration'
    && actionKind !== 'delete_environment_registration'
  ) {
    return;
  }
  const gatewayID = launcherActionGatewayID(request);
  switch (actionKind) {
    case 'upsert_gateway':
      void syncVisibleGatewaysIfNeeded({ force: true });
      return;
    case 'set_gateway_enabled':
      if (gatewayID) {
        const requestEnabled = request.kind === 'set_gateway_enabled' ? request.enabled : true;
        if (!requestEnabled) {
          gatewaySyncStateByID.delete(gatewayID);
          gatewayDiagnosisByID.delete(gatewayID);
          supersedeGatewaySyncTask(gatewayID);
          broadcastDesktopWelcomeSnapshots();
          return;
        }
        broadcastDesktopWelcomeSnapshots();
      }
      return;
    case 'upsert_environment_registration':
    case 'delete_environment_registration':
      if (gatewayID) {
        void gatewayStore().get(gatewayID).then((record) => (
          record ? syncGatewayIfNeeded(record, { force: true }) : undefined
        )).catch(() => undefined);
      }
      return;
    case 'delete_gateway':
      if (gatewayID) {
        gatewaySyncStateByID.delete(gatewayID);
        gatewayDiagnosisByID.delete(gatewayID);
        supersedeGatewaySyncTask(gatewayID);
      }
      broadcastDesktopWelcomeSnapshots();
      return;
    default:
      return;
  }
}

async function hydratePersistedReinstallOperations(): Promise<void> {
  if (reinstallOperationsHydrationPromise) {
    return reinstallOperationsHydrationPromise;
  }
  reinstallOperationsHydrationPromise = (async () => {
    const journals = await reinstallTargetCoordinator().readPersistedJournals();
    for (const journal of journals) {
      const operationKey = compact(journal.preview.operation_key);
      if (!operationKey || launcherOperations.get(operationKey)) {
        continue;
      }
      let targetError: unknown;
      try {
        await reinstallTargetCoordinator().validatePersistedJournalTarget(journal);
      } catch (error) {
        targetError = error;
      }
      // Every incomplete journal is a resumable recovery checkpoint. A
      // Desktop restart must ask for confirmation again, but an old phase or
      // quarantine is never converted into a permanent manual-recovery block.
      const confirmationAvailable = !targetError;
      const phase = confirmationAvailable
        ? 'confirmation'
        : journal.phase;
      const presentation = reinstallTargetProgressPresentation(phase);
      const failure = confirmationAvailable
        ? undefined
        : desktopFailureFromError(
          targetError ?? new ReinstallTargetCoordinatorError(
            'manual_recovery_required',
            journal.phase === 'confirmation'
              ? 'The reinstall confirmation expired. Review the target again before continuing.'
              : 'The previous reinstall stopped before completion. The isolated old target was preserved for manual recovery.',
          ),
          {
            code: 'manual_recovery_required',
            title: journal.phase === 'confirmation' && !targetError
              ? 'Reinstall confirmation expired'
              : 'Redeven reinstall requires manual recovery',
            titleKey: journal.phase === 'confirmation' && !targetError
              ? 'confirm.reinstallTargetTitle'
              : 'confirm.reinstallFailedTitle',
            summary: targetError instanceof Error
              ? targetError.message
              : journal.phase === 'confirmation'
                ? 'The reinstall confirmation expired. Review the target again before continuing.'
                : 'The previous reinstall stopped before completion. The isolated old target was preserved for manual recovery.',
            summaryKey: journal.phase === 'confirmation' && !targetError
              ? 'confirm.reinstallTargetDescription'
              : 'confirm.reinstallManualRecovery',
            targetLabel: journal.preview.label,
          },
        );
      const retryAction = targetError ? {
        kind: 'retry' as const,
        operation_key: operationKey,
        label: 'Review target',
        label_key: 'common.retry' as const,
        retry_action: {
          kind: 'preview_reinstall_target' as const,
          environment_id: journal.environment_id,
          mode: journal.preview.mode,
        },
      } : {
        kind: 'retry' as const,
        operation_key: operationKey,
        label: 'Continue reinstall',
        label_key: 'common.retry' as const,
        retry_action: {
          kind: 'reinstall_target' as const,
          environment_id: journal.environment_id,
          preflight_id: journal.preflight_id,
          operation_key: operationKey,
          mode: journal.preview.mode,
          impact_acknowledged: true as const,
        },
      };
      const snapshot: DesktopLauncherOperationSnapshot = {
        operation_key: operationKey,
        action: 'reinstall_target',
        subject_kind: 'runtime_target',
        subject_id: journal.environment_id,
        subject_generation: launcherOperations.currentSubjectGeneration('runtime_target', journal.environment_id),
        environment_id: journal.environment_id,
        environment_label: journal.preview.label,
        started_at_unix_ms: Math.max(1, journal.updated_at_unix_ms - 1),
        updated_at_unix_ms: journal.updated_at_unix_ms,
        status: confirmationAvailable ? 'needs_confirmation' : 'failed',
        phase,
        title: presentation.title,
        title_key: presentation.title_key,
        detail: confirmationAvailable
          ? 'Review the deletion list and confirm before Redeven is reinstalled.'
          : failure?.summary ?? presentation.detail,
        detail_key: confirmationAvailable ? 'confirm.reinstallTargetDescription' : 'confirm.reinstallManualRecovery',
        active_progress_surface: 'reinstall',
        step_progress: reinstallTargetStepProgress(phase, confirmationAvailable ? 'running' : 'failed'),
        reinstall_preview: journal.preview,
        cancelable: false,
        deleted_subject: false,
        ...(failure ? { failure } : {}),
        next_actions: confirmationAvailable
          ? [{
              kind: 'reinstall_target' as const,
              environment_id: journal.environment_id,
              preflight_id: journal.preflight_id,
              operation_key: operationKey,
              mode: journal.preview.mode,
              label: 'Continue reinstall',
              label_key: 'common.retry' as const,
            }]
          : [
              { kind: 'copy_diagnostics' as const, operation_key: operationKey, label: 'Copy log', label_key: 'progress.copyLog' as const },
              retryAction,
            ],
      };
      launcherOperations.restore(snapshot);
    }
  })().catch((error) => {
    reinstallOperationsHydrationPromise = null;
    throw error;
  });
  return reinstallOperationsHydrationPromise;
}

async function buildCurrentDesktopWelcomeSnapshot(
  kind: DesktopUtilityWindowKind,
  overrides: Partial<Pick<BuildDesktopWelcomeSnapshotArgs, 'entryReason' | 'issue'>> = {},
) {
  await hydratePersistedReinstallOperations();
  const preferences = await loadDesktopPreferencesCached();
  const openSessions = openSessionSummaries();
  const reinstallDescriptors = directReinstallTargetDescriptors(preferences);
  const requiredFingerprints = await reinstallRequiredTargetFingerprints(reinstallDescriptors);
  const welcomeHealthTargets = buildWelcomeRuntimeHealthTargets(preferences, openSessions);
  welcomeRuntimeHealthStore.prime(welcomeHealthTargets, { pruneMissing: true });
  const healthSnapshot = welcomeRuntimeHealthStore.snapshot();
  const localMaintenance = localRuntimeMaintenanceByEnvironmentID.get(preferences.local_environment.id);
  const localMaintenanceResult = localMaintenance
    ? localEnvironmentMaintenanceProbeResult(preferences.local_environment, localMaintenance)
    : null;
  const localRuntimeHealth = {
    ...healthSnapshot.localRuntimeHealth,
    ...(localMaintenanceResult?.health
      ? { [preferences.local_environment.id]: localMaintenanceResult.health }
      : {}),
  };
  const managedRuntimePresenceByTargetID = {
    ...healthSnapshot.managedRuntimePresenceByTargetID,
    ...(localMaintenanceResult?.presence
      ? {
          [localMaintenanceResult.presence.target_id]: localMaintenanceResult.presence,
        }
      : {}),
  };
  const state = currentUtilityWindowState(kind);
  const gatewaySources = await loadGatewaySourcesForWelcome();
  const snapshot = buildDesktopWelcomeSnapshot({
    preferences,
    controlPlanes: currentControlPlaneSummaries(preferences),
    openSessions,
    localRuntimeHealth,
    savedExternalRuntimeHealth: healthSnapshot.savedExternalRuntimeHealth,
    savedRuntimeTargetHealth: healthSnapshot.savedRuntimeTargetHealth,
    managedRuntimePresenceByTargetID,
    gatewaySources,
    actionProgress: launcherOperations.progressItems(),
    operations: launcherOperations.operations(),
    surface: state.surface,
    entryReason: overrides.entryReason ?? state.entryReason,
    issue: overrides.issue ?? state.issue,
    selectedEnvironmentID: state.selectedEnvironmentID,
    flowerSettingsFocusRevision: state.flowerSettingsFocusRevision,
  });
  return {
    ...snapshot,
    environments: snapshot.environments.map((environment) => {
      const descriptor = reinstallDescriptors.find((candidate) => candidate.environment_id === environment.id);
      if (!descriptor) {
        return environment;
      }
      const needsReinstall = requiredFingerprints.has(reinstallTargetDescriptorFingerprint(descriptor));
      if (!needsReinstall) {
        return environment;
      }
      return {
        ...environment,
        reinstall_required: true,
      };
    }),
  };
}

async function loadGatewaySourcesForWelcome(): Promise<readonly DesktopGatewaySource[]> {
  await migrateLegacyDirectGatewayRecords();
  // Gateway Store contains standalone Gateways only. Managed Environment
  // targets are owned by Environment preferences and never projected here.
  const legacyIDs = new Set((await gatewayStore().listLegacyDirectEnvironmentRecords()).map((item) => item.record.gateway_id));
  const records = (await gatewayStore().list()).filter((record) => (
    !legacyIDs.has(record.gateway_id)
    && record.connection.kind === 'url'
  ));
  const recordIDs = new Set(records.map((record) => record.gateway_id));
  for (const gatewayID of gatewaySyncStateByID.keys()) {
    if (!recordIDs.has(gatewayID)) {
      gatewaySyncStateByID.delete(gatewayID);
      gatewayDiagnosisByID.delete(gatewayID);
      supersedeGatewaySyncTask(gatewayID);
    }
  }
  return Promise.all(records.map(async (record) => {
    const syncRecord = gatewaySyncStateByID.get(record.gateway_id);
    const diagnosis = gatewayDiagnosisByID.get(record.gateway_id);
    const source = syncRecord?.source
      ? mergeGatewaySourceRecord(syncRecord.source, record, syncRecord, undefined, diagnosis)
      : mergeGatewaySourceRecord(gatewayRecordToSource(record), record, syncRecord, undefined, diagnosis);
    return source;
  }));
}

type LegacyGatewayMigrationJournal = Readonly<{
  schema_version: 1;
  phase: 'prepared' | 'target_written' | 'gateway_removed';
  entries: readonly Readonly<{
    gateway_id: string;
    environment_id: string;
    target_id: string;
  }>[];
  updated_at_unix_ms: number;
}>;

async function migrateLegacyDirectGatewayRecords(): Promise<void> {
  const journalPath = path.join(preferencesPaths().stateRoot, 'maintenance', 'gateway-environment-migration.json');
  const writeJournal = async (journal: LegacyGatewayMigrationJournal): Promise<void> => {
    await fs.mkdir(path.dirname(journalPath), { recursive: true, mode: 0o700 });
    const temporary = `${journalPath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, {
      mode: 0o600,
    });
    await fs.rename(temporary, journalPath);
  };
  let existingJournal: LegacyGatewayMigrationJournal | null = null;
  try {
    existingJournal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as LegacyGatewayMigrationJournal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Gateway migration journal is invalid; refusing to guess the old record role.');
    }
  }
  if (existingJournal?.schema_version === 1 && existingJournal.phase === 'prepared') {
    throw new Error('Gateway migration is incomplete; refusing to delete or recreate records automatically.');
  }
  if (existingJournal?.schema_version === 1 && existingJournal.phase === 'target_written') {
    const recoveredPreferences = await loadDesktopPreferencesCached();
    const missingTargets = existingJournal.entries.filter((entry) => (
      !recoveredPreferences.saved_runtime_targets.some((target) => target.id === entry.target_id)
    ));
    if (missingTargets.length > 0) {
      throw new Error('Gateway migration journal has no matching Environment Target; the legacy Gateway records were kept for manual recovery.');
    }
    for (const entry of existingJournal.entries) {
      await gatewayStore().delete(entry.gateway_id);
    }
    await writeJournal({
      ...existingJournal,
      phase: 'gateway_removed',
      updated_at_unix_ms: Date.now(),
    });
    await fs.rm(journalPath, { force: true });
  } else if (existingJournal?.schema_version === 1 && existingJournal.phase === 'gateway_removed') {
    await fs.rm(journalPath, { force: true });
  }
  const legacyRecords = await gatewayStore().listLegacyDirectEnvironmentRecords();
  if (legacyRecords.length === 0) {
    return;
  }
  const entries: Array<{
    gateway_id: string;
    environment_id: string;
    target_id: string;
  }> = [];
  for (const item of legacyRecords) {
    if (item.record.connection.kind === 'url') {
      // A URL Gateway record cannot be safely interpreted as a direct target.
      // Keep it hidden and require explicit re-registration instead.
      continue;
    }
    let target: GatewayServiceTargetDescriptor;
    try {
      target = gatewayServiceTargetDescriptor(item.record);
    } catch {
      continue;
    }
    const targetID = desktopRuntimeTargetID(
      target.host_access,
      target.placement,
      item.runtime_environment_id,
    );
    entries.push({
      gateway_id: item.record.gateway_id,
      environment_id: item.runtime_environment_id,
      target_id: targetID,
    });
  }
  if (entries.length === 0) {
    return;
  }
  await writeJournal({
    schema_version: 1,
    phase: 'prepared',
    entries,
    updated_at_unix_ms: Date.now(),
  });
  const writtenPreferences = await mutateDesktopPreferences((current) => entries.reduce((preferences, entry) => {
    const legacy = legacyRecords.find((item) => item.record.gateway_id === entry.gateway_id);
    if (!legacy) {
      return preferences;
    }
    const target = gatewayServiceTargetDescriptor(legacy.record);
    return upsertSavedRuntimeTarget(preferences, {
      id: entry.target_id,
      label: legacy.record.display_name,
      host_access: target.host_access,
      placement: target.placement,
      auto_runtime_probe_enabled: true,
      last_used_at_ms: Date.now(),
    });
  }, current));
  if (entries.some((entry) => !writtenPreferences.saved_runtime_targets.some((target) => target.id === entry.target_id))) {
    throw new Error('Gateway migration did not persist every Environment Target; legacy Gateway records were kept.');
  }
  await writeJournal({
    schema_version: 1,
    phase: 'target_written',
    entries,
    updated_at_unix_ms: Date.now(),
  });
  for (const entry of entries) {
    await gatewayStore().delete(entry.gateway_id);
  }
  await writeJournal({
    schema_version: 1,
    phase: 'gateway_removed',
    entries,
    updated_at_unix_ms: Date.now(),
  });
  await fs.rm(journalPath, { force: true });
}

function defaultGatewaySyncRecord(record: GatewayRecord): GatewaySyncRecord {
  return {
    gateway_id: record.gateway_id,
    sync_state: 'idle',
    background_sync_running: false,
    last_sync_attempt_at_ms: record.last_catalog_sync_at_ms ?? 0,
    last_synced_at_ms: 0,
    last_sync_error_code: '',
    last_sync_error_message: '',
  };
}

function mergeGatewaySourceRecord(
  source: DesktopGatewaySource,
  record: GatewayRecord,
  syncRecord?: GatewaySyncRecord,
  serviceState?: DesktopGatewayServiceState,
  diagnosis?: DesktopGatewayDiagnosis,
): DesktopGatewaySource {
  const base = gatewayRecordToSource(record);
  const sync = syncRecord ?? defaultGatewaySyncRecord(record);
  return {
    ...base,
    ...source,
    display_name: base.display_name,
    connection_kind: base.connection_kind,
    management_capability: base.management_capability,
    endpoint_label: base.endpoint_label,
    gateway_url: base.gateway_url,
    allow_loopback_http: base.allow_loopback_http,
    local_enabled: base.local_enabled,
    ssh_details: base.ssh_details,
    ssh_password_configured: base.ssh_password_configured,
    container_engine: base.container_engine,
    container_id: base.container_id,
    container_ref: base.container_ref,
    container_label: base.container_label,
    trust_state: source.trust_state ?? base.trust_state,
    capabilities: source.capabilities ?? base.capabilities,
    service_state: serviceState ?? source.service_state ?? base.service_state,
    created_at_ms: base.created_at_ms,
    updated_at_ms: base.updated_at_ms,
    sync_state: sync.sync_state,
    background_sync_running: sync.background_sync_running,
    last_sync_attempt_at_ms: sync.last_sync_attempt_at_ms,
    last_synced_at_ms: sync.last_synced_at_ms,
    last_sync_error_code: sync.last_sync_error_code,
    last_sync_error_message: sync.last_sync_error_message,
    diagnosis: diagnosis ?? gatewayDiagnosisByID.get(record.gateway_id) ?? source.diagnosis,
  };
}

function setGatewaySyncRecord(record: GatewayRecord, nextRecord: GatewaySyncRecord): void {
  const previous = gatewaySyncStateByID.get(record.gateway_id);
  if (
    previous
    && previous.sync_state === nextRecord.sync_state
    && previous.background_sync_running === nextRecord.background_sync_running
    && previous.last_sync_attempt_at_ms === nextRecord.last_sync_attempt_at_ms
    && previous.last_synced_at_ms === nextRecord.last_synced_at_ms
    && previous.last_sync_error_code === nextRecord.last_sync_error_code
    && previous.last_sync_error_message === nextRecord.last_sync_error_message
    && previous.source === nextRecord.source
  ) {
    return;
  }
  gatewaySyncStateByID.set(record.gateway_id, nextRecord);
  broadcastDesktopWelcomeSnapshots();
}

function setGatewayDiagnosis(record: GatewayRecord, diagnosis: DesktopGatewayDiagnosis): void {
  const completedDiagnosis = completeGatewayDiagnosis(diagnosis);
  const previous = gatewayDiagnosisByID.get(record.gateway_id);
  if (
    previous
    && previous.checked_at_unix_ms === completedDiagnosis.checked_at_unix_ms
    && previous.classification === completedDiagnosis.classification
    && previous.summary === completedDiagnosis.summary
    && previous.detail === completedDiagnosis.detail
  ) {
    return;
  }
  gatewayDiagnosisByID.set(record.gateway_id, completedDiagnosis);
  broadcastDesktopWelcomeSnapshots();
}

function gatewaySyncErrorCode(error: unknown): string {
  if (error instanceof GatewayReinstallRequiredError) {
    return 'gateway_reinstall_required';
  }
  if (error instanceof GatewayTrustError || error instanceof GatewayClientError) {
    return error.code;
  }
  if (error instanceof GatewayServiceUnavailableError) {
    return error.code;
  }
  if (error instanceof GatewayServiceStartRequiredError) {
    return 'gateway_start_required';
  }
  if (error instanceof GatewayNotManageableError) {
    return 'gateway_not_manageable';
  }
  return 'gateway_sync_failed';
}

function gatewaySyncStateForError(error: unknown): DesktopGatewaySyncState {
  if (error instanceof GatewayTrustError) {
    return 'pairing_failed';
  }
  if (error instanceof GatewayClientError) {
    if (gatewayClientErrorIsPairingRejected(error)) {
      return 'pairing_failed';
    }
    return 'catalog_failed';
  }
  if (error instanceof GatewayServiceUnavailableError || error instanceof GatewayServiceStartRequiredError) {
    return 'gateway_unreachable';
  }
  return 'catalog_failed';
}

function gatewayClientErrorIsPairingRejected(error: GatewayClientError): boolean {
  const code = compact(error.code).toUpperCase();
  const message = compact(error.message).toLowerCase();
  return code === 'UNAUTHORIZED'
    || code === 'GATEWAY_UNAUTHORIZED'
    || code.startsWith('GATEWAY_PAIRING_')
    || message.includes('pair this gateway before')
    || message.includes('pair this gateway');
}

function gatewayClientErrorIsTrustMismatch(error: GatewayClientError): boolean {
  switch (compact(error.code)) {
    case 'GATEWAY_ID_MISMATCH':
    case 'GATEWAY_FINGERPRINT_REQUIRED':
    case 'GATEWAY_PUBLIC_KEY_MISMATCH':
    case 'GATEWAY_TRUST_CHANGED':
      return true;
    default:
      return false;
  }
}

function gatewayTrustErrorNeedsReinstall(error: GatewayTrustError): boolean {
  switch (compact(error.code)) {
    case 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED':
    case 'GATEWAY_TRUST_CHANGED':
    case 'GATEWAY_TRUST_ID_MISMATCH':
    case 'GATEWAY_PAIRING_ID_MISMATCH':
    case 'GATEWAY_PAIRING_COMPLETE_MISMATCH':
    case 'GATEWAY_FINGERPRINT_INVALID':
      return true;
    default:
      return false;
  }
}

function gatewaySyncRecordFromError(
  record: GatewayRecord,
  error: unknown,
  attemptAtMS: number,
  serviceState?: DesktopGatewayServiceState,
): GatewaySyncRecord {
  const code = gatewaySyncErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const previous = gatewaySyncStateByID.get(record.gateway_id) ?? defaultGatewaySyncRecord(record);
  const errorState = gatewaySyncStateForError(error);
  const errorSourceBase = gatewayRecordToSourceWithError(record, message, code);
  const invalidateCatalog = gatewayErrorInvalidatesCatalog(error, serviceState);
  const errorSource = errorState === 'pairing_failed'
    ? {
        ...errorSourceBase,
        status: code === 'GATEWAY_TRUST_CHANGED' ? 'trust_changed' as const : 'error' as const,
        trust_state: code === 'GATEWAY_TRUST_CHANGED' ? 'trust_changed' as const : errorSourceBase.trust_state,
        status_message: message || 'Desktop could not pair this Gateway automatically.',
      }
    : errorSourceBase;
  const source = mergeGatewaySourceRecord(
    {
      ...(previous.source ?? errorSource),
      ...errorSource,
      environments: invalidateCatalog ? [] : previous.source?.environments ?? errorSource.environments,
      capabilities: invalidateCatalog ? [] : previous.source?.capabilities ?? errorSource.capabilities,
    },
    record,
    previous,
    serviceState ?? previous.source?.service_state,
  );
  return {
    gateway_id: record.gateway_id,
    sync_state: errorState,
    background_sync_running: false,
    last_sync_attempt_at_ms: attemptAtMS,
    last_synced_at_ms: previous.last_synced_at_ms,
    last_sync_error_code: code,
    last_sync_error_message: message,
    source,
  };
}

function gatewayServiceStateInvalidatesCatalog(serviceState: DesktopGatewayServiceState | undefined): boolean {
  return serviceState?.status === 'service_needs_update' || serviceState?.status === 'needs_reinstall';
}

function gatewayErrorInvalidatesCatalog(error: unknown, serviceState?: DesktopGatewayServiceState): boolean {
  if (gatewayServiceStateInvalidatesCatalog(serviceState)) {
    return true;
  }
  if (error instanceof GatewayClientError) {
    return error.code === 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED'
      || error.code === 'GATEWAY_INVALID_RESPONSE'
      || error.code === 'GATEWAY_TRUST_CHANGED';
  }
  if (error instanceof GatewayTrustError) {
    return true;
  }
  return false;
}

function gatewayCatalogFresh(record: GatewayRecord, syncRecord?: GatewaySyncRecord): boolean {
  if (!syncRecord?.source) {
    return false;
  }
  const lastSyncedAtMS = syncRecord?.last_synced_at_ms ?? record.last_catalog_sync_at_ms ?? 0;
  return lastSyncedAtMS > 0 && Date.now() - lastSyncedAtMS < GATEWAY_CATALOG_STALE_AFTER_MS;
}

function gatewayNeedsAutoSync(record: GatewayRecord, syncRecord?: GatewaySyncRecord): boolean {
  if (!record.local_enabled || syncRecord?.background_sync_running === true) {
    return false;
  }
  const serviceStatus = syncRecord?.source?.service_state?.status;
  if (serviceStatus === 'not_started' || serviceStatus === 'service_needs_update' || serviceStatus === 'needs_reinstall') {
    return false;
  }
  return !gatewayCatalogFresh(record, syncRecord);
}

function gatewaySyncingServiceState(
  record: GatewayRecord,
  _mode: GatewaySyncOperationMode,
  previous?: DesktopGatewayServiceState,
): DesktopGatewayServiceState | undefined {
  if (record.connection.kind === 'url') {
    return {
      status: 'not_applicable',
      can_start: false,
      can_stop: false,
      can_restart: false,
      can_update: false,
      can_pair_after_start: false,
      message: 'Desktop is syncing this external Gateway catalog.',
      checked_at_unix_ms: Date.now(),
    };
  }
  if (previous) {
    return previous;
  }
  return {
    status: 'unknown',
    can_start: false,
    can_stop: false,
    can_restart: false,
    can_update: false,
    can_pair_after_start: true,
    message: 'Desktop is syncing this Gateway catalog.',
    checked_at_unix_ms: Date.now(),
  };
}

async function inspectGatewayServiceForSync(
  record: GatewayRecord,
  options: Readonly<{
    signal?: AbortSignal;
    onProgress?: GatewayLifecycleProgressSink;
  }> = {},
): Promise<DesktopGatewayServiceState | undefined> {
  if (record.connection.kind === 'url') {
    return {
      status: 'not_applicable',
      can_start: false,
      can_stop: false,
      can_restart: false,
      can_update: false,
      can_pair_after_start: false,
      message: 'Gateway is an external URL endpoint. Desktop can sync its catalog but cannot manage its service.',
      checked_at_unix_ms: Date.now(),
    };
  }
  options.onProgress?.({
    phase: record.connection.kind === 'ssh_container' ? 'checking_container' : 'checking_host',
    title: record.connection.kind === 'ssh_container' ? 'Checking Gateway container' : 'Checking Gateway host',
    detail: record.connection.kind === 'ssh_container'
      ? 'Desktop is checking the container that hosts this Gateway service.'
      : 'Desktop is checking the SSH host that runs this Gateway service.',
  });
  return gatewayLifecycleManager().inspectService(record, options.signal);
}

async function gatewayClientForSync(
  record: GatewayRecord,
  options: Readonly<{
    startPolicy: GatewayStartPolicy | undefined;
    signal?: AbortSignal;
    onProgress?: GatewayLifecycleProgressSink;
  }>,
): Promise<GatewayURLClient | Awaited<ReturnType<GatewayLifecycleManager['bridgeClient']>>> {
  if (record.connection.kind === 'url') {
    return new GatewayURLClient(gatewaySecretStore());
  }
  const session = await gatewayLifecycleManager().ensureGatewayReady(record, {
    startPolicy: options.startPolicy ?? 'require_ready',
    signal: options.signal,
    onProgress: options.onProgress,
  });
  return session.client;
}

function gatewaySyncStartPolicy(
  record: GatewayRecord,
  requested: GatewayStartPolicy | undefined,
): GatewayStartPolicy | undefined {
  if (record.connection.kind === 'url') {
    return undefined;
  }
  if (requested === 'start_if_needed') {
    return 'start_if_needed';
  }
  return 'require_ready';
}

async function pairGatewayWithClient(
  record: GatewayRecord,
  client: GatewayURLClient | Awaited<ReturnType<GatewayLifecycleManager['bridgeClient']>>,
  secretStore: GatewaySecretStore,
  options: Readonly<{
    signal?: AbortSignal;
    onStage?: (stage: Extract<GatewayWorkflowStepID, 'fetching_pairing_challenge' | 'saving_trust_profile'>) => void;
    pairingCode?: string;
    beforeStoreWrite?: () => Promise<GatewayRecord> | GatewayRecord;
  }> = {},
): Promise<GatewayRecord> {
  const material = createGatewayPairingMaterial(record);
  options.onStage?.('fetching_pairing_challenge');
  const challengeRequest = record.connection.kind === 'url'
    ? pairingChallengeRequestWithCode(material, options.pairingCode ?? '')
    : pairingChallengeRequest(material);
  const challenge = await client.pairingChallenge(record, challengeRequest, {
    signal: options.signal,
  });
  assertGatewayPairingChallenge({
    record,
    material,
    challenge,
    expected_pairing_code: record.connection.kind === 'url' ? options.pairingCode : undefined,
  });
  options.onStage?.('saving_trust_profile');
  const pairingOptions = record.connection.kind === 'url'
    ? {}
    : {
        profileWrite: true,
        runtimeGrants: ['manage_runtime', 'deploy_custom_runtime', 'manage_runtime_binding'] as const,
      };
  const completionRequest = buildPairingCompleteRequest(material, challenge, pairingOptions);
  const completion = await client.completePairing(record, completionRequest, {
    signal: options.signal,
  });
  assertGatewayPairingCompleteResponse(material, challenge, completion, {
    client_capability: completionRequest.client_capability,
    runtime_grants: completionRequest.runtime_grants,
  });
  const currentRecord = await options.beforeStoreWrite?.() ?? record;
  const trustProfile = await completeGatewayPairing({
    record: currentRecord,
    material,
    challenge,
    trust_accepted: true,
    secret_store: secretStore,
  });
  return gatewayStore().updateTrustProfile(currentRecord.gateway_id, trustProfile);
}

async function syncGatewayRecord(
  record: GatewayRecord,
  options: Readonly<{
    force?: boolean;
    allowPairing?: boolean;
    mode?: GatewaySyncOperationMode;
    priority?: GatewaySyncOperationPriority;
    startPolicy?: GatewayStartPolicy;
    progress?: GatewaySyncProgressObserver;
  }> = {},
): Promise<DesktopGatewaySource> {
  const priority = options.priority ?? (options.progress ? 'foreground' : 'background');
  const existingTaskRecord = gatewaySyncTaskByID.get(record.gateway_id);
  if (existingTaskRecord) {
    if (priority === 'background' || existingTaskRecord.priority === 'foreground') {
      return existingTaskRecord.task;
    }
    supersedeGatewaySyncTask(record.gateway_id);
  }
  const controller = new AbortController();
  const taskToken = Symbol(`gateway-sync:${record.gateway_id}`);
  const signal = abortSignalAny([controller.signal, options.progress?.signal]);
  const shouldCommitSyncUpdate = () => !supersededGatewaySyncTaskTokens.has(taskToken) && !controller.signal.aborted;
  const assertSyncActive = async (): Promise<GatewayRecord> => {
    if (!shouldCommitSyncUpdate() || signal?.aborted) {
      throw new GatewaySyncCanceledError();
    }
    const latestRecord = await gatewayStore().get(record.gateway_id);
    if (!latestRecord) {
      throw new GatewaySyncCanceledError('Gateway sync was canceled because the Gateway was removed.');
    }
    if (!latestRecord.local_enabled) {
      throw new GatewaySyncCanceledError('Gateway sync was canceled because this Gateway is disabled on this Desktop.');
    }
    return latestRecord;
  };
  const commitGatewaySyncRecord = (targetRecord: GatewayRecord, nextRecord: GatewaySyncRecord): void => {
    if (shouldCommitSyncUpdate()) {
      setGatewaySyncRecord(targetRecord, nextRecord);
    }
  };
  const task = (async () => {
    const attemptAtMS = Date.now();
    const mode = options.mode ?? 'auto';
    const previous = gatewaySyncStateByID.get(record.gateway_id) ?? defaultGatewaySyncRecord(record);
    if (!record.local_enabled) {
      return mergeGatewaySourceRecord(previous.source ?? gatewayRecordToSource(record), record, {
        ...previous,
        background_sync_running: false,
      });
    }
    if (!options.force && priority === 'background' && !gatewayNeedsAutoSync(record, previous)) {
      return mergeGatewaySourceRecord(previous.source ?? gatewayRecordToSource(record), record, previous);
    }
    commitGatewaySyncRecord(record, {
      ...previous,
      gateway_id: record.gateway_id,
      background_sync_running: priority === 'background',
      last_sync_attempt_at_ms: attemptAtMS,
      last_sync_error_code: '',
      last_sync_error_message: '',
      source: mergeGatewaySourceRecord(
        previous.source ?? gatewayRecordToSource(record),
        record,
        previous,
        gatewaySyncingServiceState(record, mode, previous.source?.service_state),
      ),
    });
    let serviceState: DesktopGatewayServiceState | undefined;
    try {
      const secretStore = gatewaySecretStore();
      let currentRecord = await assertSyncActive();
      const startPolicy = gatewaySyncStartPolicy(currentRecord, options.startPolicy);
      if (currentRecord.connection.kind !== 'url' && startPolicy !== 'start_if_needed') {
        serviceState = await inspectGatewayServiceForSync(currentRecord, {
          signal,
          onProgress: options.progress?.onGatewayServiceProgress,
        });
        currentRecord = await assertSyncActive();
      }
      const client = await gatewayClientForSync(currentRecord, {
        startPolicy,
        signal,
        onProgress: options.progress?.onGatewayServiceProgress,
      });
      currentRecord = await assertSyncActive();
      if (!currentRecord.trust_profile) {
        if (options.allowPairing !== true) {
          const source = gatewayRecordToSource(currentRecord);
          const diagnosis: DesktopGatewayDiagnosis = {
            checked_at_unix_ms: Date.now(),
            classification: 'pairing_required',
            manageable: false,
            summary: 'Gateway pairing required',
            detail: 'Pair this Gateway explicitly before Desktop can read its environment catalog.',
            service_state: source.service_state,
            trust_state: 'unpaired',
            catalog_state: 'pairing_failed',
          };
          gatewayDiagnosisByID.set(currentRecord.gateway_id, diagnosis);
          const syncRecord = gatewaySyncRecordFromError(
            currentRecord,
            new GatewayTrustError('GATEWAY_PAIRING_REQUIRED', diagnosis.detail),
            attemptAtMS,
            serviceState,
          );
          commitGatewaySyncRecord(currentRecord, {
            ...syncRecord,
            source,
            background_sync_running: false,
          });
          return source;
        }
        currentRecord = await pairGatewayWithClient(currentRecord, client, secretStore, {
          signal,
          onStage: options.progress?.onStage,
          beforeStoreWrite: assertSyncActive,
        });
        currentRecord = await assertSyncActive();
      }
      const refreshCatalog = async (targetRecord: GatewayRecord) => {
        options.progress?.onStage?.('refreshing_gateway_catalog');
        return gatewayLifecycleManager().refreshCatalog(targetRecord, {
          startPolicy: targetRecord.connection.kind === 'url' ? undefined : 'require_ready',
          signal,
        });
      };
      const catalog = await refreshCatalog(currentRecord);
      currentRecord = await assertSyncActive();
      const syncedAtMS = Date.now();
      const syncedRecord = await gatewayStore().markCatalogSynced(currentRecord.gateway_id, syncedAtMS).catch(() => currentRecord);
      await assertSyncActive();
      const catalogEnvironments = [...catalog.environments];
      const source = mergeGatewaySourceRecord(gatewayRecordToSourceWithCatalog(syncedRecord, {
        status: catalog.gateway.status,
        capabilities: catalog.gateway.capabilities,
        environments: catalogEnvironments,
      }), syncedRecord, {
        gateway_id: syncedRecord.gateway_id,
        sync_state: 'ready',
        background_sync_running: false,
        last_sync_attempt_at_ms: attemptAtMS,
        last_synced_at_ms: syncedAtMS,
        last_sync_error_code: '',
        last_sync_error_message: '',
      }, serviceState);
      commitGatewaySyncRecord(syncedRecord, {
        gateway_id: syncedRecord.gateway_id,
        sync_state: 'ready',
        background_sync_running: false,
        last_sync_attempt_at_ms: attemptAtMS,
        last_synced_at_ms: syncedAtMS,
        last_sync_error_code: '',
        last_sync_error_message: '',
        source,
      });
      gatewayDiagnosisByID.delete(syncedRecord.gateway_id);
      return source;
    } catch (error) {
      if (error instanceof GatewaySyncCanceledError || isAbortLikeError(error)) {
        const latestRecord = await gatewayStore().get(record.gateway_id).catch(() => null) ?? record;
        commitGatewaySyncRecord(latestRecord, {
          ...(gatewaySyncStateByID.get(record.gateway_id) ?? defaultGatewaySyncRecord(latestRecord)),
          gateway_id: latestRecord.gateway_id,
          background_sync_running: false,
        });
        throw error;
      }
      const latestRecord = await gatewayStore().get(record.gateway_id).catch(() => null) ?? record;
      const diagnosis = completeGatewayDiagnosis(gatewayDiagnosisForError(latestRecord, error, serviceState));
      gatewayDiagnosisByID.set(latestRecord.gateway_id, diagnosis);
      const syncRecord = gatewaySyncRecordFromError(latestRecord, error, attemptAtMS, serviceState);
      commitGatewaySyncRecord(latestRecord, syncRecord);
      throw error;
    }
  })().finally(() => {
    supersededGatewaySyncTaskTokens.delete(taskToken);
    if (gatewaySyncTaskByID.get(record.gateway_id)?.task === task) {
      gatewaySyncTaskByID.delete(record.gateway_id);
    }
  });
  gatewaySyncTaskByID.set(record.gateway_id, { priority, token: taskToken, controller, task });
  return task;
}

async function syncGatewayIfNeeded(record: GatewayRecord, options: Readonly<{ force?: boolean }> = {}): Promise<void> {
  const syncRecord = gatewaySyncStateByID.get(record.gateway_id);
  if (!options.force && !gatewayNeedsAutoSync(record, syncRecord)) {
    return;
  }
  await syncGatewayRecord(record, options);
}

async function syncVisibleGatewaysIfNeeded(options: Readonly<{ force?: boolean }> = {}): Promise<void> {
  const launcher = liveUtilityWindow('launcher');
  if (!launcher || launcher.isDestroyed()) {
    updateGatewaySyncPoller();
    return;
  }
  const records = (await gatewayStore().list()).filter((record) => record.connection.kind === 'url');
  await Promise.all(records.map(async (record) => {
    if (!record.local_enabled) {
      return;
    }
    await syncGatewayIfNeeded(record, options).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[redeven:gateway-sync] Gateway sync failed for ${safeLogText(record.gateway_id, 128)}: ${safeLogText(message, 512)}`);
    });
  }));
}

async function upsertGatewayFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'upsert_gateway' }>,
): Promise<GatewayRecord> {
  if (request.connection_kind === 'url') {
    const nextConnection: GatewayRecord['connection'] = {
      kind: 'url',
      base_url: normalizeGatewayBaseURL(request.gateway_url),
      allow_loopback_http: request.allow_loopback_http,
    };
    const gatewayID = compact(request.gateway_id) || stableGatewayID(gatewayBindingAudience(nextConnection));
    const existing = await gatewayStore().get(gatewayID);
    const record = await upsertGatewayConnectionRecord(gatewayID, request.display_name, nextConnection, existing);
    if (compact(request.pairing_code) !== '') {
      return pairGatewayWithClient(
        record,
        new GatewayURLClient(gatewaySecretStore()),
        gatewaySecretStore(),
        { pairingCode: request.pairing_code },
      );
    }
    return record;
  }

  throw new Error('Standalone Gateway setup requires an explicit URL endpoint. Register SSH or container targets as Managed Environments.');

}

async function upsertGatewayConnectionRecord(
  gatewayID: string,
  displayName: string,
  nextConnection: GatewayRecord['connection'],
  existing: GatewayRecord | null,
): Promise<GatewayRecord> {
  if (existing?.trust_profile && gatewayBindingAudience(existing.connection) !== gatewayBindingAudience(nextConnection)) {
    await gatewaySecretStore().deleteSecret(existing.trust_profile.paired_client_private_key_ref);
  }
  return gatewayStore().upsert({
    gateway_id: gatewayID,
    display_name: displayName,
    connection: nextConnection,
  });
}


function runtimeLifecycleOutcome(
  operation: 'start' | 'stop' | 'restart' | 'update_runtime',
): DesktopLauncherActionOutcome {
  switch (operation) {
    case 'start':
      return 'started_gateway_environment_runtime';
    case 'stop':
      return 'stopped_gateway_environment_runtime';
    case 'restart':
      return 'restarted_gateway_environment_runtime';
    case 'update_runtime':
      return 'updated_gateway_environment_runtime';
  }
}

function runtimeLifecycleTitle(operation: 'start' | 'stop' | 'restart' | 'update_runtime'): string {
  switch (operation) {
    case 'start':
      return 'Starting environment';
    case 'stop':
      return 'Stopping environment';
    case 'restart':
      return 'Restarting environment';
    case 'update_runtime':
      return 'Updating environment';
  }
}

function runtimeLifecycleTitleKey(operation: 'start' | 'stop' | 'restart' | 'update_runtime') {
	switch (operation) {
		case 'start':
			return 'progress.startingRuntime' as const;
		case 'stop':
			return 'progress.stoppingRuntimeProcess' as const;
		case 'restart':
			return 'progress.restartingRuntime' as const;
		case 'update_runtime':
			return 'progress.updatingRuntime' as const;
	}
}

function runtimeOperationConfirmationRequest(
  operation: GatewayRuntimeOperation,
): GatewayRuntimeOperationConfirmationRequest {
  const snapshot = operation.expected_snapshot;
  const riskSummaryDigest = crypto.createHash('sha256').update(JSON.stringify({
    operation: operation.kind,
    lifecycle_target_id: operation.lifecycle_target_id,
    snapshot_revision: snapshot.snapshot_revision,
    workload_identity_digest: snapshot.workload_identity_digest,
    workload: snapshot.workload,
  })).digest('hex');
  return {
    snapshot_revision: snapshot.snapshot_revision,
    process_inventory_digest: snapshot.process_inventory_digest,
    workload_identity_digest: snapshot.workload_identity_digest,
    risk_summary_digest: riskSummaryDigest,
  };
}

async function driveRuntimeOperation<T>(
  operationID: string,
  execute: () => Promise<T>,
): Promise<T> {
  const normalizedOperationID = compact(operationID);
  if (normalizedOperationID === '') {
    throw new Error('Runtime operation id is required before Desktop can drive it.');
  }
  if (locallyDrivenRuntimeOperationIDs.has(normalizedOperationID)) {
    throw new GatewayClientError(
      'GATEWAY_RUNTIME_OPERATION_IN_PROGRESS',
      'Desktop is already completing this Runtime operation.',
    );
  }
  locallyDrivenRuntimeOperationIDs.add(normalizedOperationID);
  try {
    return await execute();
  } finally {
    locallyDrivenRuntimeOperationIDs.delete(normalizedOperationID);
  }
}

async function completeRuntimeOperation(
  operation: GatewayRuntimeOperation,
  input: Readonly<{
    current_runtime_epoch: number;
    artifact_preflight?: PublishedRuntimeLifecyclePreflight;
    renew?: (expiresAtUnixMS: number) => Promise<GatewayRuntimeOperation>;
    upload: (metadata: import('./gatewayClient').GatewayRuntimeArtifactMetadata, artifact: Buffer) => Promise<GatewayRuntimeOperation>;
    commit: () => Promise<GatewayRuntimeOperation>;
    observe: () => Promise<GatewayRuntimeOperation>;
    signal?: AbortSignal;
    onProgress?: (operation: GatewayRuntimeOperation) => void;
  }>,
): Promise<GatewayRuntimeOperation> {
  const lease = startRuntimeOperationLease(operation, input.renew, input.onProgress);
  try {
    return driveRuntimeOperation(operation.operation_id, () => advanceGatewayRuntimeOperation(operation, {
    prepareArtifact: (current) => current.desired_runtime.artifact_policy === 'custom_build'
      ? prepareCustomRuntimeLifecycleArtifact({
          operation: current,
          runtimeReleaseTag: current.desired_runtime.version,
          releaseBaseURL: PUBLIC_REDEVEN_RELEASE_BASE_URL,
          assetCacheRoot: desktopRuntimePackageCacheRoot(),
          sourceRuntimeRoot: compact(process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT),
          ...(input.signal ? { signal: input.signal } : {}),
        })
      : preparePublishedRuntimeLifecycleArtifact({
          runtimeReleaseTag: current.desired_runtime.version,
          releaseBaseURL: PUBLIC_REDEVEN_RELEASE_BASE_URL,
          assetCacheRoot: desktopRuntimePackageCacheRoot(),
          platform: current.desired_runtime.platform,
          architecture: current.desired_runtime.architecture,
          currentRuntimeEpoch: input.current_runtime_epoch,
          ...(input.artifact_preflight ? { preflight: input.artifact_preflight } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        }),
    upload: input.upload,
    commit: input.commit,
    observe: input.observe,
    onProgress: input.onProgress,
    }));
  } finally {
    lease.stop();
  }
}

type AttachedRuntimeOperationAdapter = Readonly<{
  resume_key: string;
  confirm: (confirmation: GatewayRuntimeOperationConfirmationRequest) => Promise<GatewayRuntimeOperation>;
  renew?: (expiresAtUnixMS: number) => Promise<GatewayRuntimeOperation>;
  complete: (operation: GatewayRuntimeOperation) => Promise<GatewayRuntimeOperation>;
  cancel: () => Promise<void>;
  reconcile?: () => Promise<GatewayRuntimeOperation>;
  after_success?: () => Promise<void>;
}>;

type AttachedRuntimeOperationSurface = Readonly<{
  action: 'run_provider_environment_lifecycle';
  subject_kind: 'provider_environment';
  subject_id: string;
  environment_id: string;
  environment_label: string;
  provider_origin?: string;
  provider_id?: string;
  runtime_target_id?: string;
  host_access?: DesktopRuntimeHostAccess;
  placement?: DesktopRuntimePlacement;
}>;

function attachedRuntimeOperationKey(environmentID: string, operation: GatewayRuntimeOperation): string {
  return `${compact(environmentID)}:${operation.kind}`;
}

function attachedRuntimeOperationPhase(phase: string): boolean {
  return phase.startsWith('gateway_runtime_operation_') || phase === 'runtime_operation_confirmation_required';
}

function attachedRuntimeOperationLifecycleProgress(
  operationKey: string,
  operation: GatewayRuntimeOperation,
  surface: AttachedRuntimeOperationSurface,
  projection: ReturnType<typeof projectAttachedRuntimeOperation>,
): DesktopRuntimeLifecycleProgress | undefined {
  if (!surface.host_access || !surface.placement) {
    return undefined;
  }
  const lifecycleOperation = runtimeLifecycleOperationFromGatewayKind(operation.kind);
  if (!lifecycleOperation) {
    return undefined;
  }
  const location = desktopRuntimeLifecycleLocation(surface.host_access, surface.placement);
  const phase = runtimeLifecyclePhaseForGatewayOperation(operation, lifecycleOperation, location);
  const existingProgress = launcherOperations.get(operationKey)?.lifecycle_progress;
  const effectivePhase = operation.state === 'failed'
    || operation.state === 'cancelled'
    || operation.state === 'expired'
    ? existingProgress?.operation === lifecycleOperation
      ? existingProgress.active_step_id
      : phase
    : phase;
  const initialPlan = initialRuntimeLifecyclePlan({
    location,
    operation: lifecycleOperation,
  });
  const plan = runtimeLifecyclePlanIncludingStep({
    location,
    operation: lifecycleOperation,
    currentSteps: existingProgress?.operation === lifecycleOperation
      ? existingProgress.steps.map((step) => step.id)
      : initialPlan.steps.map((step) => step.id),
    step: effectivePhase,
  });
  const workflow = existingProgress?.operation === lifecycleOperation
    ? RuntimeLifecycleWorkflow.fromProgress(existingProgress)
    : runtimeLifecycleWorkflowFromInput(operationKey, {
        hostAccess: surface.host_access,
        placement: surface.placement,
        operation: lifecycleOperation,
        targetID: surface.runtime_target_id,
        targetLabel: surface.environment_label,
      });
  workflow.commitPlan({
    state: 'executing',
    steps: plan.steps.map((step) => step.id),
    omitted_steps: plan.omitted_steps,
  });
  if (operation.state === 'succeeded') {
    workflow.completeThrough(effectivePhase);
    return workflow.progress();
  }
  if (operation.state === 'failed' || operation.state === 'cancelled' || operation.state === 'expired') {
    const failure = attachedRuntimeOperationFailure(operation, surface) ?? desktopOperationFailurePresentation({
      code: 'operation_failed',
      title: 'Runtime Action Failed',
      summary: projection.detail,
      targetLabel: surface.environment_label,
    });
    workflow.failStep(new GatewayClientError(
      operation.failure?.code || 'GATEWAY_RUNTIME_OPERATION_INCOMPLETE',
      operation.failure?.message || projection.detail,
    ), failure, effectivePhase);
    return workflow.progress();
  }
  const currentPhase = workflow.progress().active_step_id;
  const currentIndex = workflow.currentStepIDs().indexOf(currentPhase);
  const nextIndex = workflow.currentStepIDs().indexOf(effectivePhase);
  const nextStatus = workflow.stepStates().find((step) => step.id === effectivePhase)?.status;
  if (currentPhase === effectivePhase && nextStatus === 'running') {
    workflow.observeStep(effectivePhase, projection.detail);
  } else if (nextStatus === 'pending' && nextIndex > currentIndex) {
    workflow.advanceToStep(effectivePhase, projection.detail);
  } else if (nextStatus === 'pending') {
    workflow.beginStep(effectivePhase, projection.detail);
  }
  return workflow.progress();
}

function attachedRuntimeOperationRetryAction(
  _operation: GatewayRuntimeOperation,
  _surface: AttachedRuntimeOperationSurface,
): DesktopLauncherActionRequest | undefined {
  return undefined;
}

function attachedRuntimeOperationFailure(
  operation: GatewayRuntimeOperation,
  surface: AttachedRuntimeOperationSurface,
): DesktopOperationFailurePresentation | undefined {
  if (operation.state !== 'failed' && operation.state !== 'cancelled' && operation.state !== 'expired') {
    return undefined;
  }
  return desktopFailureFromError(
    new GatewayClientError(
      operation.failure?.code || 'GATEWAY_RUNTIME_OPERATION_INCOMPLETE',
      operation.failure?.message || `Runtime operation stopped in ${operation.state}.`,
    ),
    {
      code: 'operation_failed',
      title: 'Runtime Action Failed',
      summary: operation.failure?.message || `Runtime operation stopped in ${operation.state}.`,
      targetLabel: surface.environment_label,
    },
  );
}

function attachedRuntimeOperationNextActions(
  operationKey: string,
  operation: GatewayRuntimeOperation,
  surface: AttachedRuntimeOperationSurface,
): readonly DesktopLauncherOperationNextAction[] {
  const retryAction = attachedRuntimeOperationRetryAction(operation, surface);
  return [
    ...(retryAction ? [{
      kind: 'retry' as const,
      operation_key: operationKey,
      label: 'Try again',
      retry_action: retryAction,
    }] : []),
    {
      kind: 'refresh_status' as const,
      environment_id: surface.environment_id,
      label: 'Refresh status',
    },
    {
      kind: 'copy_diagnostics' as const,
      operation_key: operationKey,
      label: 'Copy log',
    },
    {
      kind: 'dismiss' as const,
      operation_key: operationKey,
      label: 'Dismiss',
    },
  ];
}

function removeMissingRuntimeOperationAttachments(
  surface: AttachedRuntimeOperationSurface,
  activeOperations: readonly GatewayRuntimeOperation[],
): void {
  const activeKeys = new Set(activeOperations.map((operation) => attachedRuntimeOperationKey(surface.environment_id, operation)));
  for (const operationKind of ['start', 'stop', 'restart', 'update_runtime', 'reconcile'] as const) {
    const operationKey = `${surface.environment_id}:${operationKind}`;
    if (activeKeys.has(operationKey)) {
      continue;
    }
    const snapshot = launcherOperations.get(operationKey);
    if (!snapshot || !attachedRuntimeOperationPhase(snapshot.phase)) {
      continue;
    }
    pendingRuntimeOperationLeases.get(operationKey)?.stop();
    pendingRuntimeOperationLeases.delete(operationKey);
    pendingRuntimeOperationConfirmations.delete(operationKey);
    pendingRuntimeOperationReconciliations.delete(operationKey);
    removeLauncherOperation(operationKey);
  }
}

function finishAttachedRuntimeOperation(
  operationKey: string,
  operation: GatewayRuntimeOperation,
  surface: AttachedRuntimeOperationSurface,
  adapter: AttachedRuntimeOperationAdapter,
): void {
  const taskKey = `${adapter.resume_key}:${operation.operation_id}`;
  if (attachedRuntimeOperationResumeTasks.has(taskKey)) {
    return;
  }
  const task = (async () => {
    try {
      const response = await adapter.complete(operation);
      if (response.state === 'succeeded') {
        const presentation = projectAttachedRuntimeOperation(response);
        launcherOperations.finish(operationKey, 'succeeded', {
          phase: presentation.phase,
          title: presentation.title,
          title_key: presentation.title_key,
          detail: presentation.detail,
          detail_key: presentation.detail_key,
          lifecycle_progress: attachedRuntimeOperationLifecycleProgress(operationKey, response, surface, presentation),
          runtime_confirmation: undefined,
          next_actions: undefined,
        });
        scheduleLauncherOperationRemoval(operationKey);
        await adapter.after_success?.();
        return;
      }
      if (response.state === 'failed' || response.state === 'cancelled' || response.state === 'expired') {
        throw new GatewayClientError(
          response.failure?.code || 'GATEWAY_RUNTIME_OPERATION_INCOMPLETE',
          response.failure?.message || `Runtime operation stopped in ${response.state}.`,
        );
      }
      upsertRuntimeOperationAttachment(response, surface, adapter);
    } catch (error) {
      // An attached pre-commit operation must not be retried on every catalog
      // refresh after local artifact preparation fails. Canceling releases the
      // Gateway target lock and turns the next user attempt into one fresh,
      // observable operation.
      await adapter.cancel().catch(() => undefined);
      const failure = desktopFailureFromError(error, {
        code: 'operation_failed',
        title: 'Runtime Action Failed',
        summary: error instanceof Error ? error.message : String(error),
        targetLabel: surface.environment_label,
      });
      const failedOperation: GatewayRuntimeOperation = {
        ...operation,
        state: 'failed',
        failure: {
          code: failure.code,
          message: failure.summary,
        },
      };
      const failedProjection = projectAttachedRuntimeOperation(failedOperation);
      launcherOperations.finish(operationKey, 'failed', {
        phase: failedProjection.phase,
        title: failedProjection.title,
        title_key: failedProjection.title_key,
        detail: failedProjection.detail,
        detail_key: failedProjection.detail_key,
        lifecycle_progress: attachedRuntimeOperationLifecycleProgress(operationKey, failedOperation, surface, failedProjection),
        runtime_confirmation: undefined,
        next_actions: attachedRuntimeOperationNextActions(operationKey, operation, surface),
        failure,
      });
    }
  })().finally(() => {
    attachedRuntimeOperationResumeTasks.delete(taskKey);
    broadcastDesktopWelcomeSnapshots();
  });
  attachedRuntimeOperationResumeTasks.set(taskKey, task);
}

function upsertRuntimeOperationAttachment(
  operation: GatewayRuntimeOperation,
  surface: AttachedRuntimeOperationSurface,
  adapter: AttachedRuntimeOperationAdapter,
): void {
  if (operation.kind === 'reconcile') {
    return;
  }
  if (
    locallyDrivenRuntimeOperationIDs.has(operation.operation_id)
    || foregroundRuntimeOperationIDs.has(operation.operation_id)
  ) {
    return;
  }
  const operationKey = attachedRuntimeOperationKey(surface.environment_id, operation);
  const projection = projectAttachedRuntimeOperation(operation);
  const awaitingConfirmation = operation.state === 'awaiting_confirmation' || operation.state === 'confirmation_required';
  const autoConfirmOperation = projection.owned
    && awaitingConfirmation
    && (operation.kind === 'start' || !runtimeOperationRequiresConfirmation(operation));
  const lifecycleProgress = attachedRuntimeOperationLifecycleProgress(operationKey, operation, surface, projection);
  const failure = attachedRuntimeOperationFailure(operation, surface);
  const terminalFailure = failure !== undefined;
  const patch = {
    status: projection.needs_confirmation && !autoConfirmOperation
      ? 'needs_confirmation' as const
      : terminalFailure
        ? operation.state === 'cancelled' ? 'canceled' as const : 'failed' as const
        : 'running' as const,
    phase: projection.phase,
    title: projection.title,
    title_key: projection.title_key,
    detail: projection.detail,
    detail_key: projection.detail_key,
    lifecycle_progress: lifecycleProgress,
    runtime_confirmation: autoConfirmOperation ? undefined : projection.confirmation,
    cancelable: false,
    next_actions: terminalFailure ? attachedRuntimeOperationNextActions(operationKey, operation, surface) : undefined,
    failure,
  };
  if (launcherOperations.get(operationKey)) {
    launcherOperations.update(operationKey, patch);
  } else {
    launcherOperations.create({
      operation_key: operationKey,
      action: surface.action,
      subject_kind: surface.subject_kind,
      subject_id: surface.subject_id,
      environment_id: surface.environment_id,
      environment_label: surface.environment_label,
      provider_origin: surface.provider_origin,
      provider_id: surface.provider_id,
      active_progress_surface: 'runtime_lifecycle',
      ...patch,
    });
  }
  if (autoConfirmOperation) {
    pendingRuntimeOperationConfirmations.delete(operationKey);
    pendingRuntimeOperationReconciliations.delete(operationKey);
    finishAttachedRuntimeOperation(operationKey, operation, surface, {
      ...adapter,
      complete: async (current) => adapter.complete(await adapter.confirm(
        runtimeOperationConfirmationRequest(current),
      )),
    });
    return;
  }
  if (projection.needs_confirmation) {
    pendingRuntimeOperationReconciliations.delete(operationKey);
    awaitRuntimeOperationConfirmation(operationKey, {
      operation,
      label: surface.environment_label,
      confirm: async (confirmation) => adapter.complete(await adapter.confirm(confirmation)),
      cancel: adapter.cancel,
      after_success: adapter.after_success,
    });
    return;
  }
  const pending = pendingRuntimeOperationConfirmations.get(operationKey);
  if (pending?.operation.operation_id === operation.operation_id) {
    pendingRuntimeOperationConfirmations.delete(operationKey);
  }
  if (projection.manual_recovery_required && adapter.reconcile) {
    pendingRuntimeOperationReconciliations.set(operationKey, {
      operation,
      label: surface.environment_label,
      reconcile: adapter.reconcile,
      after_success: adapter.after_success,
    });
    launcherOperations.update(operationKey, {
      next_actions: [{
        kind: 'retry',
        operation_key: operationKey,
        label: 'Review and reconcile Runtime',
        label_key: 'progress.runtimeRecoveryReviewAction',
        retry_action: {
          kind: 'reconcile_runtime_operation',
          operation_key: operationKey,
        },
      }],
    });
  } else {
    pendingRuntimeOperationReconciliations.delete(operationKey);
  }
  if (projection.should_resume || operation.state === 'succeeded') {
    finishAttachedRuntimeOperation(operationKey, operation, surface, adapter);
  }
}

async function refreshProviderRuntimeOperationAttachments(
  provider: DesktopControlPlaneProvider,
  accessToken: string,
  accessPoint: DesktopProviderAccessPoint,
  environment: DesktopProviderEnvironmentRecord,
): Promise<void> {
  const management = await fetchProviderRuntimeManagementCapability(
    provider,
    accessPoint,
    accessToken,
    environment.env_public_id,
  );
  if (
    management?.support !== 'supported'
    || management.authorization.state !== 'allowed'
    || !management.authorization.grants.includes('manage_runtime')
    || management.readiness !== 'ready'
    || !management.target
    || !management.compatibility
  ) {
    return;
  }
  const scope: ProviderRuntimeLifecycleScope = {
    provider,
    access_point: accessPoint,
    access_token: accessToken,
    env_public_id: environment.env_public_id,
    lifecycle_target_id: management.target.lifecycle_target_id,
    target_generation: management.target.target_generation,
  };
  const client = providerRuntimeLifecycleClient();
  const response = await client.listRuntimeOperations(scope, {
    gateway_env_id: 'env_local',
    lifecycle_target_id: scope.lifecycle_target_id,
    target_generation: scope.target_generation,
  });
  const surface: AttachedRuntimeOperationSurface = {
    action: 'run_provider_environment_lifecycle',
    subject_kind: 'provider_environment',
    subject_id: environment.id,
    environment_id: environment.id,
    environment_label: environment.label,
    provider_origin: environment.provider_origin,
    provider_id: environment.provider_id,
  };
  for (const operation of response.operations) {
    upsertRuntimeOperationAttachment(operation, surface, {
      resume_key: `provider:${environment.provider_origin}:${environment.env_public_id}`,
      confirm: (confirmation) => client.confirmRuntimeOperation(scope, operation.operation_id, confirmation),
      renew: (expiresAtUnixMS) => client.renewRuntimeOperation(scope, operation.operation_id, expiresAtUnixMS),
      complete: (current) => completeRuntimeOperation(current, {
        current_runtime_epoch: management.compatibility!.compatibility_epoch,
        renew: (expiresAtUnixMS) => client.renewRuntimeOperation(scope, operation.operation_id, expiresAtUnixMS),
        upload: (metadata, artifact) => client.uploadRuntimeOperationArtifact(
          scope,
          operation.operation_id,
          metadata,
          artifact,
        ),
        commit: () => client.commitRuntimeOperation(scope, operation.operation_id),
        observe: () => client.getRuntimeOperation(scope, operation.operation_id),
      }),
      cancel: async () => {
        await client.cancelRuntimeOperation(scope, operation.operation_id);
      },
      ...(management.authorization.grants.includes('manage_runtime_binding') && management.operations.includes('reconcile') ? {
        reconcile: async () => {
          const authorizedClientKeyID = await client.clientKeyID(scope);
          const authorization = await authorizeProviderRuntimeOperation(
            scope.provider,
            scope.access_point,
            scope.access_token,
            scope.env_public_id,
            {
              action: 'reconcile',
              lifecycle_target_id: scope.lifecycle_target_id,
              target_generation: scope.target_generation,
              operation_id: operation.operation_id,
              operation: 'reconcile',
              authorized_client_key_id: authorizedClientKeyID,
            },
          );
          if (authorization.decision !== 'allowed' || !authorization.permit) {
            throw new GatewayClientError(
              authorization.reason_code || 'PROVIDER_RUNTIME_RECONCILE_DENIED',
              'The Provider denied Runtime recovery for the current binding administrator.',
            );
          }
          return client.reconcileRuntimeOperation(scope, operation.operation_id, {
            authorization_permit: authorization.permit,
          });
        },
      } : {}),
      after_success: async () => {
        await refreshProviderEnvironmentRuntimeHealth(
          environment.provider_origin,
          environment.provider_id,
          [environment.env_public_id],
        ).catch(() => undefined);
      },
    });
  }
  removeMissingRuntimeOperationAttachments(surface, response.operations);
}

function awaitRuntimeOperationConfirmation(
  operationKey: string,
  pending: PendingRuntimeOperationConfirmation,
): DesktopLauncherActionFailure {
  const existingLease = pendingRuntimeOperationLeases.get(operationKey);
  existingLease?.stop();
  pendingRuntimeOperationConfirmations.set(operationKey, pending);
  const lease = startRuntimeOperationLease(pending.operation, pending.renew, (renewed) => {
    const current = pendingRuntimeOperationConfirmations.get(operationKey);
    if (!current || current.operation.operation_id !== renewed.operation_id) {
      return;
    }
    const next = { ...current, operation: renewed };
    pendingRuntimeOperationConfirmations.set(operationKey, next);
    const presentation = projectAttachedRuntimeOperation(renewed);
    launcherOperations.update(operationKey, {
      phase: presentation.phase,
      title: presentation.title,
      title_key: presentation.title_key,
      detail: presentation.detail,
      detail_key: presentation.detail_key,
      runtime_confirmation: presentation.confirmation,
    });
    broadcastDesktopWelcomeSnapshots();
  });
  pendingRuntimeOperationLeases.set(operationKey, lease);
  const presentation = projectAttachedRuntimeOperation(pending.operation);
  launcherOperations.finish(operationKey, 'needs_confirmation', {
    phase: presentation.phase,
    title: presentation.title,
    title_key: presentation.title_key,
    detail: presentation.detail,
    detail_key: presentation.detail_key,
    runtime_confirmation: presentation.confirmation,
    next_actions: [
      {
        kind: 'confirm_runtime_operation',
        operation_key: operationKey,
        label: 'Confirm and continue',
      },
      {
        kind: 'cancel_runtime_operation',
        operation_key: operationKey,
        label: 'Cancel operation',
      },
    ],
  });
  broadcastDesktopWelcomeSnapshots();
  return launcherActionFailure(
    'confirmation_required',
    'environment',
    'Review the Runtime impact and confirm before this operation can continue.',
    { operationKey, shouldRefreshSnapshot: true },
  );
}

async function confirmRuntimeOperationFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'confirm_runtime_operation' }>,
): Promise<DesktopLauncherActionResult> {
  const pending = pendingRuntimeOperationConfirmations.get(request.operation_key);
  const launcherOperation = launcherOperations.get(request.operation_key);
  if (!pending || launcherOperation?.status !== 'needs_confirmation') {
    return launcherActionFailure(
      'operation_missing',
      'global',
      'That Runtime confirmation is no longer available. Refresh status before retrying.',
      { shouldRefreshSnapshot: true },
    );
  }
  pendingRuntimeOperationLeases.get(request.operation_key)?.stop();
  pendingRuntimeOperationLeases.delete(request.operation_key);
  pendingRuntimeOperationConfirmations.delete(request.operation_key);
  const continuingPresentation = projectAttachedRuntimeOperation({
    ...pending.operation,
    state: 'fencing',
  });
  launcherOperations.update(request.operation_key, {
    status: 'running',
    phase: 'confirming_runtime_operation',
    title: continuingPresentation.title,
    title_key: continuingPresentation.title_key,
    detail: continuingPresentation.detail,
    detail_key: continuingPresentation.detail_key,
    runtime_confirmation: undefined,
    next_actions: undefined,
    cancelable: false,
  });
  broadcastDesktopWelcomeSnapshots();
  let runtimeOperationSucceeded = false;
  try {
    const response = await pending.confirm(runtimeOperationConfirmationRequest(pending.operation));
    if (response.state !== 'succeeded') {
      throw new GatewayClientError(
        response.failure?.code || 'GATEWAY_RUNTIME_OPERATION_INCOMPLETE',
        response.failure?.message || `Runtime operation stopped in ${response.state}.`,
      );
    }
    const completedPresentation = projectAttachedRuntimeOperation(response);
    const completedLifecycleProgress = pending.lifecycle
      ? (() => {
          const current = launcherOperations.get(request.operation_key);
          const owner = runtimeLifecycleAttemptIdentity(current);
          if (!owner) {
            return undefined;
          }
          return completeRuntimeLifecycleWorkflowProgress(request.operation_key, owner, {
            hostAccess: pending.lifecycle.host_access,
            placement: pending.lifecycle.placement,
            operation: pending.lifecycle.operation,
            phase: runtimeLifecyclePhaseForGatewayOperation(
              response,
              pending.lifecycle.operation,
              desktopRuntimeLifecycleLocation(pending.lifecycle.host_access, pending.lifecycle.placement),
            ),
            targetID: pending.lifecycle.target_id,
            targetLabel: pending.lifecycle.target_label,
            detail: completedPresentation.detail,
          });
        })()
      : undefined;
    runtimeOperationSucceeded = true;
    await pending.after_success?.();
    if (pending.continuation) {
      return await pending.continuation();
    }
    launcherOperations.finish(request.operation_key, 'succeeded', {
      phase: completedPresentation.phase,
      title: completedPresentation.title,
      title_key: completedPresentation.title_key,
      detail: completedPresentation.detail,
      detail_key: completedPresentation.detail_key,
      ...(completedLifecycleProgress ? { lifecycle_progress: completedLifecycleProgress } : {}),
      runtime_confirmation: undefined,
      next_actions: undefined,
    });
    scheduleLauncherOperationRemoval(request.operation_key);
    return launcherActionSuccess(
      pending.success_outcome
      ?? runtimeLifecycleOutcome(pending.operation.kind as 'start' | 'stop' | 'restart' | 'update_runtime'),
    );
  } catch (error) {
    // Confirmation hands lifecycle ownership to Desktop. If preparation or
    // upload fails while the operation is still cancellable, release the
    // Gateway target lock so the user can retry immediately. Commit and
    // recovery states reject cancellation and retain their recovery contract.
    if (!runtimeOperationSucceeded) {
      await pending.cancel().catch(() => undefined);
    }
    const failure = desktopFailureFromError(error, {
      code: 'operation_failed',
      title: 'Runtime Action Failed',
      summary: error instanceof Error ? error.message : String(error),
      targetLabel: pending.label,
    });
    const failureLifecycleProgress = pending.lifecycle
      ? (() => {
          const current = launcherOperations.get(request.operation_key);
          const owner = runtimeLifecycleAttemptIdentity(current);
          if (!owner) {
            return undefined;
          }
          return runtimeLifecycleWorkflowFailure(request.operation_key, owner, {
            hostAccess: pending.lifecycle.host_access,
            placement: pending.lifecycle.placement,
            operation: pending.lifecycle.operation,
            targetID: pending.lifecycle.target_id,
            targetLabel: pending.lifecycle.target_label,
            error,
            fallback: failure,
          }).lifecycle_progress;
        })()
      : undefined;
    launcherOperations.finish(request.operation_key, 'failed', {
      phase: 'failed',
      title: 'Runtime action failed',
      detail: failure.summary,
      ...(failureLifecycleProgress ? { lifecycle_progress: failureLifecycleProgress } : {}),
      runtime_confirmation: undefined,
      next_actions: [
        ...(pending.retry_action ? [{
          kind: 'retry' as const,
          operation_key: request.operation_key,
          label: 'Try again',
          retry_action: pending.retry_action,
        }] : []),
        {
          kind: 'refresh_status' as const,
          environment_id: pending.environment_id,
          label: 'Refresh status',
        },
        {
          kind: 'copy_diagnostics' as const,
          operation_key: request.operation_key,
          label: 'Copy log',
        },
        {
          kind: 'dismiss' as const,
          operation_key: request.operation_key,
          label: 'Dismiss',
        },
      ],
      failure,
    });
    return launcherActionFailure(
      'gateway_service_unreachable',
      'environment',
      failure.summary,
      { shouldRefreshSnapshot: true, failure },
    );
  } finally {
    if (pending.operation_id) {
      foregroundRuntimeOperationIDs.delete(pending.operation_id);
    }
  }
}

async function reconcileRuntimeOperationFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'reconcile_runtime_operation' }>,
): Promise<DesktopLauncherActionResult> {
  const pending = pendingRuntimeOperationReconciliations.get(request.operation_key);
  const launcherOperation = launcherOperations.get(request.operation_key);
  if (!pending || !launcherOperation || launcherOperation.phase !== 'gateway_runtime_operation_manual_recovery_required') {
    return launcherActionFailure(
      'operation_missing',
      'global',
      'That Runtime recovery request is no longer available. Refresh status before retrying.',
      { shouldRefreshSnapshot: true },
    );
  }
  pendingRuntimeOperationReconciliations.delete(request.operation_key);
  launcherOperations.update(request.operation_key, {
    status: 'running',
    phase: 'gateway_runtime_operation_reconciling',
    title: 'Reviewing Runtime recovery',
    title_key: 'progress.runtimeRecoveryReviewingTitle',
    detail: 'The current Runtime management administrator is verifying the isolated target and recovery state.',
    detail_key: 'progress.runtimeRecoveryReviewingDetail',
    next_actions: undefined,
    cancelable: false,
  });
  broadcastDesktopWelcomeSnapshots();
  try {
    const response = await pending.reconcile();
    if (response.state === 'manual_recovery_required') {
      throw new GatewayClientError(
        response.failure?.code || 'GATEWAY_RUNTIME_RECOVERY_INCOMPLETE',
        response.failure?.message || 'Runtime recovery still requires administrator review.',
      );
    }
    launcherOperations.finish(request.operation_key, 'succeeded', {
      phase: 'gateway_runtime_operation_reconciled',
      title: 'Runtime recovery complete',
      title_key: 'progress.runtimeRecoveryCompleteTitle',
      detail: 'The Runtime supervisor cleared the isolated target after administrator verification.',
      detail_key: 'progress.runtimeRecoveryCompleteDetail',
      next_actions: undefined,
    });
    scheduleLauncherOperationRemoval(request.operation_key);
    await pending.after_success?.();
    return launcherActionSuccess('reconciled_runtime_operation');
  } catch (error) {
    const failure = desktopFailureFromError(error, {
      code: 'operation_failed',
      title: 'Runtime recovery failed',
      summary: error instanceof Error ? error.message : String(error),
      targetLabel: pending.label,
    });
    const retryAction: DesktopLauncherActionRequest = {
      kind: 'reconcile_runtime_operation',
      operation_key: request.operation_key,
    };
    pendingRuntimeOperationReconciliations.set(request.operation_key, pending);
		launcherOperations.finish(request.operation_key, 'failed', {
			phase: 'gateway_runtime_operation_manual_recovery_required',
			title: 'Runtime recovery required',
			title_key: 'progress.runtimeRecoveryRequiredTitle',
      detail: failure.summary,
      next_actions: [{
        kind: 'retry',
        operation_key: request.operation_key,
        label: 'Retry Runtime recovery',
        label_key: 'progress.runtimeRecoveryRetryAction',
        retry_action: retryAction,
      }],
      failure,
    });
    return launcherActionFailure(
      'gateway_service_unreachable',
      'environment',
      failure.summary,
      { shouldRefreshSnapshot: true, failure },
    );
  }
}

async function refreshGatewaySourceForAuthorizedAction(
  record: GatewayRecord,
  options: Readonly<{
    signal?: AbortSignal;
    onGatewayServiceProgress?: GatewayLifecycleProgressSink;
    onStage?: (stage: GatewayWorkflowStepID) => void;
    startPolicy?: GatewayStartPolicy;
  }> = {},
): Promise<DesktopGatewaySource> {
  return syncGatewayRecord(record, {
    force: true,
    mode: 'refresh_catalog',
    startPolicy: options.startPolicy,
    progress: {
      signal: options.signal,
      onGatewayServiceProgress: options.onGatewayServiceProgress,
      onStage: options.onStage,
    },
  });
}

function gatewayCapabilityFailure(
  record: GatewayRecord,
  message: string,
  options: Readonly<{
    gatewayEnvironmentID?: string;
    environmentID?: string;
  }> = {},
): DesktopLauncherActionFailure {
  return launcherActionFailure(
    'action_invalid',
    'gateway',
    message,
    {
      gatewayID: record.gateway_id,
      gatewayLabel: record.display_name,
      gatewayEnvironmentID: options.gatewayEnvironmentID,
      environmentID: options.environmentID,
      shouldRefreshSnapshot: true,
      failure: desktopOperationFailurePresentation({
        code: 'operation_failed',
        title: 'Gateway Capability Unavailable',
        summary: message,
        targetLabel: record.display_name,
      }),
    },
  );
}

async function requireGatewayProfileWriteCapability(
  record: GatewayRecord,
  options: Readonly<{ startPolicy?: GatewayStartPolicy }> = {},
): Promise<DesktopLauncherActionFailure | null> {
  const source = await refreshGatewaySourceForAuthorizedAction(record, {
    startPolicy: options.startPolicy,
  });
  if (source.status === 'online' && source.capabilities.includes('env_profile_write')) {
    return null;
  }
  return gatewayCapabilityFailure(
    record,
    'This Gateway does not currently allow Desktop to save environment profiles.',
  );
}

function validateGatewayProfileRouteForRecord(
  record: GatewayRecord,
  request: Extract<DesktopEnvironmentRegistrationUpsert, { registration_ref: { kind: 'gateway_environment' } }>,
): DesktopLauncherActionFailure | null {
  if (request.access_route.kind !== 'url') {
    return gatewayCapabilityFailure(
      record,
      'Gateway-backed Environment access must use an explicit URL endpoint.',
    );
  }
  return null;
}

async function gatewayEnvironmentProfileForAction(
  record: GatewayRecord,
  gatewayEnvID: string,
  options: Readonly<{ startPolicy?: GatewayStartPolicy }> = {},
): Promise<DesktopGatewaySource['environments'][number] | null> {
  const source = await syncGatewayRecord(record, {
    force: true,
    mode: 'refresh_catalog',
    startPolicy: options.startPolicy,
  }).catch(() => null);
  return source?.environments.find((item) => item.gateway_env_id === gatewayEnvID) ?? null;
}


function gatewayEnvironmentAccessEndpoint(
  record: GatewayRecord,
  environment: DesktopGatewaySource['environments'][number],
): string | null {
  // Gateway-backed environments are opened only through the immutable
  // endpoint advertised for access. The editable profile route is metadata,
  // not an implicit access path.
  const route = environment.access_endpoint;
  if (!route || route.kind !== 'url' || !compact(route.url)) {
    return null;
  }
  let endpoint: URL;
  try {
    endpoint = new URL(compact(route.url));
  } catch {
    return null;
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    return null;
  }
  if (endpoint.username || endpoint.password) {
    return null;
  }
  // A catalog endpoint must be the Environment service or Local UI. Never
  // recurse into the Gateway API or bridge, including when the URL happens to
  // share the Gateway origin.
  const pathName = endpoint.pathname.toLowerCase();
  if (pathName.includes('/gateway') || pathName.includes('/bridge') || pathName.includes('/open-session')) {
    return null;
  }
  if (record.connection.kind === 'url') {
    try {
      const gatewayURL = new URL(record.connection.base_url);
      if (gatewayURL.origin === endpoint.origin) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return endpoint.toString();
}

async function upsertGatewayEnvironmentProfileFromLauncher(
  request: Extract<DesktopEnvironmentRegistrationUpsert, { registration_ref: { kind: 'gateway_environment' } }>,
): Promise<DesktopLauncherActionResult> {
  const record = await gatewayStore().get(request.registration_ref.gateway_id);
  if (!record) {
    return launcherActionFailure(
      'environment_missing',
      'gateway',
      'This Gateway is no longer available.',
      {
        gatewayID: request.registration_ref.gateway_id,
        shouldRefreshSnapshot: true,
      },
    );
  }
  try {
    const routeFailure = validateGatewayProfileRouteForRecord(record, request);
    if (routeFailure) {
      return routeFailure;
    }
    const actionStartPolicy = record.connection.kind === 'url' ? undefined : 'start_if_needed';
    const capabilityFailure = await requireGatewayProfileWriteCapability(record, {
      startPolicy: actionStartPolicy,
    });
    if (capabilityFailure) {
      return capabilityFailure;
    }
    await gatewayLifecycleManager().upsertEnvironmentProfile(record, {
      gateway_env_id: request.registration_ref.gateway_env_id || undefined,
      display_name: request.display_name,
      access_route: {
        kind: 'url',
        ...(request.access_route.url ? { url: request.access_route.url } : {}),
        ...(request.access_route.origin_label ? { origin_label: request.access_route.origin_label } : {}),
      },
    }, {
      startPolicy: actionStartPolicy,
    });
    await syncGatewayRecord(record, {
      force: true,
      mode: 'refresh_catalog',
      startPolicy: actionStartPolicy,
    }).catch(() => undefined);
    return launcherActionSuccess('saved_gateway_environment');
  } catch (error) {
    return launcherActionFailure(
      gatewayServiceFailureCode(error),
      'gateway',
      error instanceof Error ? error.message : String(error),
      {
        gatewayID: record.gateway_id,
        gatewayLabel: record.display_name,
        shouldRefreshSnapshot: true,
        failure: desktopFailureFromError(error, {
          code: 'operation_failed',
          title: 'Save Gateway Environment Failed',
          summary: error instanceof Error ? error.message : String(error),
          targetLabel: record.display_name,
        }),
      },
    );
  }
}

async function deleteGatewayEnvironmentProfileFromLauncher(
  registrationRef: Extract<EnvironmentRegistrationRef, { kind: 'gateway_environment' }>,
): Promise<DesktopLauncherActionResult> {
  const record = await gatewayStore().get(registrationRef.gateway_id);
  if (!record) {
    return launcherActionFailure(
      'environment_missing',
      'gateway',
      'This Gateway is no longer available.',
      {
        gatewayID: registrationRef.gateway_id,
        shouldRefreshSnapshot: true,
      },
    );
  }
  try {
    const actionStartPolicy = record.connection.kind === 'url' ? undefined : 'start_if_needed';
    const capabilityFailure = await requireGatewayProfileWriteCapability(record, {
      startPolicy: actionStartPolicy,
    });
    if (capabilityFailure) {
      return capabilityFailure;
    }
    const environment = await gatewayEnvironmentProfileForAction(record, registrationRef.gateway_env_id, {
      startPolicy: actionStartPolicy,
    });
    if (!environment) {
      return launcherActionFailure(
        'environment_missing',
        'environment',
        'This Gateway environment was already removed.',
        {
          gatewayID: record.gateway_id,
          gatewayLabel: record.display_name,
          gatewayEnvironmentID: registrationRef.gateway_env_id,
          shouldRefreshSnapshot: true,
        },
      );
    }
    if (environment.profile?.managed !== true) {
      return gatewayCapabilityFailure(
        record,
        'This Gateway environment is not a Gateway-managed profile.',
        {
          gatewayEnvironmentID: registrationRef.gateway_env_id,
        },
      );
    }
    const response = await gatewayLifecycleManager().deleteEnvironmentProfile(record, {
      gateway_env_id: registrationRef.gateway_env_id,
    }, {
      startPolicy: actionStartPolicy,
    });
    if (!response.deleted) {
      await syncGatewayRecord(record, {
        force: true,
        mode: 'refresh_catalog',
        startPolicy: actionStartPolicy,
      }).catch(() => undefined);
      return launcherActionFailure(
        'environment_missing',
        'environment',
        'This Gateway environment was already removed.',
        {
          gatewayID: record.gateway_id,
          gatewayLabel: record.display_name,
          gatewayEnvironmentID: registrationRef.gateway_env_id,
          shouldRefreshSnapshot: true,
        },
      );
    }
    const sessionRecords = liveGatewayEnvironmentSessions(record.gateway_id, registrationRef.gateway_env_id);
    for (const sessionRecord of sessionRecords) {
      await finalizeSessionClosure(sessionRecord.session_key);
    }
    await syncGatewayRecord(record, {
      force: true,
      mode: 'refresh_catalog',
      startPolicy: actionStartPolicy,
    }).catch(() => undefined);
    return launcherActionSuccess('deleted_gateway_environment');
  } catch (error) {
    return launcherActionFailure(
      gatewayServiceFailureCode(error),
      'gateway',
      error instanceof Error ? error.message : String(error),
      {
        gatewayID: record.gateway_id,
        gatewayLabel: record.display_name,
        gatewayEnvironmentID: registrationRef.gateway_env_id,
        shouldRefreshSnapshot: true,
      },
    );
  }
}

async function resolveProviderRuntimeLifecycleScope(
  environment: DesktopProviderEnvironmentRecord,
): Promise<Readonly<{
  scope: ProviderRuntimeLifecycleScope;
  capability: DesktopProviderRuntimeManagementCapability & Readonly<{
    target: NonNullable<DesktopProviderRuntimeManagementCapability['target']>;
    compatibility: NonNullable<DesktopProviderRuntimeManagementCapability['compatibility']>;
  }>;
  preferences: DesktopPreferences;
}>> {
  const preferences = await loadDesktopPreferencesCached();
  const target = await resolveProviderDesktopSessionTarget(preferences, environment);
  const authorized = await ensureControlPlaneAccessToken(target.preferences, target.controlPlane);
  const accessPoint = providerAccessPointForEnvironment(authorized.controlPlane, environment);
  const capability = await fetchProviderRuntimeManagementCapability(
    authorized.controlPlane.provider,
    accessPoint,
    authorized.accessToken,
    environment.env_public_id,
  );
  if (capability.presentation_state !== 'allowed' || !capability.target || !capability.compatibility) {
    const reason = capability.presentation_state === 'denied'
      ? 'Access is required before changing this Provider Environment.'
      : capability.presentation_state === 'setup_required'
        ? 'Initialize this Provider Environment before using lifecycle actions.'
        : capability.presentation_state === 'temporarily_unavailable'
          ? 'Lifecycle actions are temporarily unavailable for this Provider Environment.'
          : capability.presentation_state === 'unsupported'
            ? 'This Provider Environment does not support lifecycle actions.'
            : 'Redeven could not verify lifecycle compatibility for this Provider Environment.';
    throw new GatewayClientError('PROVIDER_RUNTIME_NOT_READY', reason);
  }
  return {
    preferences: authorized.preferences,
    capability: {
      ...capability,
      target: capability.target,
      compatibility: capability.compatibility,
    },
    scope: {
      provider: authorized.controlPlane.provider,
      access_point: accessPoint,
      access_token: authorized.accessToken,
      env_public_id: environment.env_public_id,
      lifecycle_target_id: capability.target.lifecycle_target_id,
      target_generation: capability.target.target_generation,
    },
  };
}

async function setupDirectRuntimeManagementFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'setup_direct_runtime_management' }>>,
): Promise<DesktopLauncherActionResult> {
  // Managed Environment setup is a direct Desktop lifecycle operation. It
  // must never synthesize a Gateway record or pair with an internal service.
  return runEnvironmentRuntimeLifecycleFromLauncher({
    kind: 'start_environment_runtime',
    environment_id: request.environment_id,
    label: request.label,
    host_access: request.host_access,
    placement: request.placement,
  });
}

async function setupProviderRuntimeManagementWithDirectCardFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'setup_provider_runtime_management_with_direct_card' }>>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const environment = findProviderEnvironmentByID(preferences, request.environment_id);
  if (!environment) {
    return launcherActionFailure(
      'environment_missing',
      'environment',
      'This Provider Environment is no longer available. Refresh the Provider and try again.',
      { environmentID: request.environment_id, shouldRefreshSnapshot: true },
    );
  }
  try {
    const currentSnapshot = await buildCurrentDesktopWelcomeSnapshot('launcher');
    const directEnvironment = currentSnapshot.environments.find((candidate) => (
      candidate.id === request.direct_environment_id
      && candidate.kind !== 'provider_environment'
      && candidate.kind !== 'external_local_ui'
      && candidate.managed_runtime_host_access
      && candidate.managed_runtime_placement
    ));
    if (!directEnvironment?.managed_runtime_host_access || !directEnvironment.managed_runtime_placement) {
      throw new GatewayClientError(
        'PROVIDER_RUNTIME_DIRECT_TARGET_MISSING',
        'The selected direct connection is no longer available. Choose another connection and try again.',
      );
    }
    const expectedFingerprint = runtimeLifecycleFingerprint({
      host_access: directEnvironment.managed_runtime_host_access,
      placement: directEnvironment.managed_runtime_placement,
    });
    const requestedFingerprint = runtimeLifecycleFingerprint({
      host_access: request.host_access,
      placement: request.placement,
    });
    if (expectedFingerprint !== requestedFingerprint) {
      throw new GatewayClientError(
        'PROVIDER_RUNTIME_DIRECT_TARGET_CHANGED',
        'The selected direct connection target changed. Review the current host, container, and OS user before trying again.',
      );
    }
    const started = await runEnvironmentRuntimeLifecycleFromLauncher({
      kind: 'start_environment_runtime',
      environment_id: directEnvironment.id,
      label: directEnvironment.label,
      host_access: directEnvironment.managed_runtime_host_access,
      placement: directEnvironment.managed_runtime_placement,
    });
    if (!started.ok) {
      return started;
    }
    const runtimeTargetID = desktopRuntimeTargetID(
      directEnvironment.managed_runtime_host_access,
      directEnvironment.managed_runtime_placement,
      directEnvironment.id,
    );
    const linked = await connectProviderRuntimeFromLauncher({
      kind: 'connect_provider_runtime',
      provider_environment_id: environment.id,
      runtime_target_id: providerRuntimeLinkTargetIDForRuntimeTarget(
        directEnvironment.managed_runtime_host_access,
        runtimeTargetID,
      ),
    });
    if (!linked.ok) {
      return linked;
    }
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('initialized_environment');
  } catch (error) {
    const accessRequired = error instanceof GatewayClientError
      && error.code === 'PROVIDER_RUNTIME_ACCESS_REQUIRED';
    return launcherActionFailure(
      error instanceof DesktopProviderRequestError
        ? error.code as DesktopLauncherActionFailureCode
        : accessRequired
          ? 'control_plane_auth_required'
          : gatewayServiceFailureCode(error),
      'environment',
      error instanceof Error ? error.message : String(error),
      {
        environmentID: environment.id,
        providerOrigin: environment.provider_origin,
        providerID: environment.provider_id,
        envPublicID: environment.env_public_id,
        shouldRefreshSnapshot: true,
        failure: desktopFailureFromError(error, {
          code: 'operation_failed',
          title: 'Environment Initialization Failed',
          summary: error instanceof Error ? error.message : String(error),
          targetLabel: compact(request.direct_label) || request.direct_environment_id,
        }),
      },
    );
  }
}

async function runProviderEnvironmentLifecycleFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'run_provider_environment_lifecycle' }>,
): Promise<DesktopLauncherActionResult> {
  const preferences = await loadDesktopPreferencesCached();
  const environment = findProviderEnvironmentByID(preferences, request.environment_id);
  if (!environment) {
    return launcherActionFailure(
      'environment_missing',
      'environment',
      'This Provider Environment is no longer available. Refresh the Provider and try again.',
      { environmentID: request.environment_id, shouldRefreshSnapshot: true },
    );
  }
  const label = compact(request.label) || environment.label;
  const operationKey = compact(request.operation_key) || `${request.environment_id}:${request.operation}`;
	const operation = launcherOperations.create({
    operation_key: operationKey,
    action: 'run_provider_environment_lifecycle',
    subject_kind: 'provider_environment',
    subject_id: environment.id,
    environment_id: environment.id,
    environment_label: label,
    provider_origin: environment.provider_origin,
    provider_id: environment.provider_id,
    active_progress_surface: 'runtime_lifecycle',
    phase: 'checking_runtime_record',
    ...(request.operation === 'start'
      ? {
          title: 'Checking access',
          title_key: 'environmentOpenFlow.checkingAccessTitle' as const,
          detail: 'Redeven is checking access before changing this environment.',
          detail_key: 'environmentOpenFlow.checkingAccessDetail' as const,
        }
      : {
          title: runtimeLifecycleTitle(request.operation),
          title_key: runtimeLifecycleTitleKey(request.operation),
          detail: `Desktop is asking the Provider Runtime supervisor to ${request.operation} ${label}.`,
          detail_key: 'progress.runtimeSupervisorPreflightDetail' as const,
        }),
    cancelable: true,
    interrupt_label: 'Stop operation',
		interrupt_detail: 'Desktop is canceling this Provider Runtime lifecycle request.',
		interrupt_detail_key: 'progress.stopBackgroundTask',
    interrupt_kind: 'generic',
    started_at_unix_ms: request.operation_started_at_unix_ms,
  });
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
  try {
    const resolved = await resolveProviderRuntimeLifecycleScope(environment);
    if (!resolved.capability?.operations.includes(request.operation)) {
      throw new GatewayClientError(
        'PROVIDER_RUNTIME_OPERATION_UNSUPPORTED',
        'This Provider authorization does not allow the selected Runtime operation.',
      );
    }
    const client = providerRuntimeLifecycleClient();
    const operationID = `rop_${crypto.randomUUID()}`;
    const authorizedClientKeyID = await client.clientKeyID(resolved.scope);
    const desiredVersion = request.operation === 'update_runtime' ? resolveSSHRuntimeReleaseTag() : '';
    const compatibility = resolved.capability.compatibility;
    const artifactPreflight = request.operation === 'update_runtime'
      ? await preflightPublishedRuntimeLifecycleArtifact({
          runtimeReleaseTag: desiredVersion,
          releaseBaseURL: PUBLIC_REDEVEN_RELEASE_BASE_URL,
          assetCacheRoot: desktopRuntimePackageCacheRoot(),
          platform: compatibility.runtime_platform,
          architecture: compatibility.runtime_architecture,
          currentRuntimeEpoch: compatibility.compatibility_epoch,
          signal,
        })
      : undefined;
    const authorization = await authorizeProviderRuntimeOperation(
      resolved.scope.provider,
      resolved.scope.access_point,
      resolved.scope.access_token,
      resolved.scope.env_public_id,
      {
        action: 'prepare',
        lifecycle_target_id: resolved.scope.lifecycle_target_id,
        target_generation: resolved.scope.target_generation,
        operation_id: operationID,
        operation: request.operation,
        desired_runtime_version: desiredVersion,
        artifact_policy: 'published_release',
        authorized_client_key_id: authorizedClientKeyID,
      },
    );
    if (authorization.decision !== 'allowed' || !authorization.permit) {
      throw new GatewayClientError(
        authorization.reason_code || 'PROVIDER_RUNTIME_AUTHORIZATION_DENIED',
        'The Provider denied this Runtime operation before any artifact work started.',
      );
    }
    const prepared = await client.prepareRuntimeOperation(resolved.scope, {
      operation_id: operationID,
      authorized_client_key_id: authorizedClientKeyID,
      gateway_env_id: 'env_local',
      lifecycle_target_id: resolved.scope.lifecycle_target_id,
      target_generation: resolved.scope.target_generation,
      operation: request.operation,
      desired_runtime: {
        version: desiredVersion,
        platform: request.operation === 'update_runtime' ? compatibility.runtime_platform : '',
        architecture: request.operation === 'update_runtime' ? compatibility.runtime_architecture : '',
        artifact_policy: 'published_release',
      },
      idempotency_key: `provider-runtime-operation:${operationID}`,
      authorization_permit: authorization.permit,
    });
    let runtimeOperation = prepared.operation;
    if (prepared.confirmation_required) {
      if (request.operation === 'start') {
        runtimeOperation = await client.confirmRuntimeOperation(
          resolved.scope,
          operationID,
          runtimeOperationConfirmationRequest(runtimeOperation),
        );
      } else {
        return awaitRuntimeOperationConfirmation(operationKey, {
          operation: runtimeOperation,
          label,
          renew: (expiresAtUnixMS) => client.renewRuntimeOperation(resolved.scope, operationID, expiresAtUnixMS),
          confirm: async (confirmation) => {
            const confirmed = await client.confirmRuntimeOperation(resolved.scope, operationID, confirmation);
            return completeRuntimeOperation(confirmed, {
              current_runtime_epoch: compatibility.compatibility_epoch,
              artifact_preflight: artifactPreflight,
              renew: (expiresAtUnixMS) => client.renewRuntimeOperation(resolved.scope, operationID, expiresAtUnixMS),
              upload: (metadata, artifact) => client.uploadRuntimeOperationArtifact(
                resolved.scope,
                operationID,
                metadata,
                artifact,
              ),
              commit: () => client.commitRuntimeOperation(resolved.scope, operationID),
              observe: () => client.getRuntimeOperation(resolved.scope, operationID),
            });
          },
          cancel: async () => {
            await client.cancelRuntimeOperation(resolved.scope, operationID);
          },
          after_success: async () => {
            await refreshProviderEnvironmentRuntimeHealth(
              environment.provider_origin,
              environment.provider_id,
              [environment.env_public_id],
            ).catch(() => undefined);
          },
        });
      }
    }
    const response = await completeRuntimeOperation(runtimeOperation, {
      current_runtime_epoch: compatibility.compatibility_epoch,
      artifact_preflight: artifactPreflight,
      renew: (expiresAtUnixMS) => client.renewRuntimeOperation(resolved.scope, operationID, expiresAtUnixMS),
      upload: (metadata, artifact) => client.uploadRuntimeOperationArtifact(
        resolved.scope,
        operationID,
        metadata,
        artifact,
      ),
      commit: () => client.commitRuntimeOperation(resolved.scope, operationID),
      observe: () => client.getRuntimeOperation(resolved.scope, operationID),
      signal,
    });
    if (response.state !== 'succeeded') {
      throw new GatewayClientError(
        response.failure?.code || 'GATEWAY_RUNTIME_OPERATION_INCOMPLETE',
        response.failure?.message || `Provider Runtime operation stopped in ${response.state}.`,
      );
    }
    const completedPresentation = projectAttachedRuntimeOperation(response);
    launcherOperations.finish(operationKey, 'succeeded', {
      phase: completedPresentation.phase,
      title: completedPresentation.title,
      title_key: completedPresentation.title_key,
      detail: completedPresentation.detail,
      detail_key: completedPresentation.detail_key,
    });
    scheduleLauncherOperationRemoval(operationKey);
    return launcherActionSuccess(runtimeLifecycleOutcome(request.operation));
  } catch (error) {
    const failure = desktopFailureFromError(error, {
      code: 'operation_failed',
      title: 'Provider Runtime Action Failed',
      summary: error instanceof Error ? error.message : String(error),
      targetLabel: label,
    });
		launcherOperations.finish(operationKey, signal?.aborted ? 'canceled' : 'failed', {
      phase: signal?.aborted ? 'canceled' : 'failed',
			title: signal?.aborted ? 'Operation canceled' : 'Provider Runtime action failed',
			title_key: signal?.aborted ? 'progress.canceled' : 'progress.runtimeOperationStoppedTitle',
			detail: signal?.aborted ? 'Desktop canceled this Provider Runtime lifecycle request.' : failure.summary,
			...(signal?.aborted ? { detail_key: 'progress.runtimeOperationStoppedDetail' as const } : {}),
      failure,
    });
    scheduleLauncherOperationRemoval(operationKey);
    return launcherActionFailure(
      error instanceof GatewayClientError && error.code === 'PROVIDER_RUNTIME_NOT_READY'
        ? 'runtime_not_ready'
        : 'gateway_service_unreachable',
      'environment',
      failure.summary,
      {
        environmentID: environment.id,
        providerOrigin: environment.provider_origin,
        providerID: environment.provider_id,
        shouldRefreshSnapshot: true,
        failure,
      },
    );
  }
}

function gatewayServiceFailureCode(error: unknown): DesktopLauncherActionFailureCode {
  if (error instanceof GatewayServiceUnavailableError) {
    return error.code;
  }
  return 'gateway_service_unreachable';
}

function gatewayLauncherActionFailureCode(error: unknown): DesktopLauncherActionFailureCode {
  if (error instanceof GatewayServiceStartRequiredError) {
    return 'gateway_start_required';
  }
  if (error instanceof GatewayNotManageableError) {
    return 'gateway_not_manageable';
  }
  if (error instanceof GatewayClientError) {
    return 'gateway_catalog_failed';
  }
  return gatewayServiceFailureCode(error);
}

type GatewayWorkflowStepID =
  | 'checking_gateway_service'
  | 'checking_gateway_package'
  | 'fetching_pairing_challenge'
  | 'saving_trust_profile'
  | 'refreshing_gateway_catalog'
  | 'gateway_refreshed';

type GatewayWorkflowStepDefinition = Readonly<{
  id: GatewayWorkflowStepID;
  label: string;
  labelKey: DesktopTranslationKey;
  backendEvent: string;
}>;

const GATEWAY_REFRESH_WORKFLOW_STEPS: readonly GatewayWorkflowStepDefinition[] = [
  { id: 'checking_gateway_service', label: 'Checking Gateway service', labelKey: 'progress.checkingGatewayService', backendEvent: 'gateway.service.check' },
  { id: 'checking_gateway_package', label: 'Checking Gateway package', labelKey: 'progress.checkingGatewayVersion', backendEvent: 'gateway.package.check' },
  { id: 'fetching_pairing_challenge', label: 'Fetching pairing challenge', labelKey: 'progress.checkingGatewayTrust', backendEvent: 'gateway.pair.challenge' },
  { id: 'saving_trust_profile', label: 'Saving trust profile', labelKey: 'progress.checkingGatewayTrust', backendEvent: 'gateway.pair.trust' },
  { id: 'refreshing_gateway_catalog', label: 'Refreshing Gateway catalog', labelKey: 'progress.checkingGatewayCatalog', backendEvent: 'gateway.catalog.refresh' },
  { id: 'gateway_refreshed', label: 'Gateway refreshed', labelKey: 'progress.gatewayChecked', backendEvent: 'gateway.refresh.done' },
];

function gatewayStepProgress(
  steps: readonly GatewayWorkflowStepDefinition[],
  activeStepID: GatewayWorkflowStepID,
  status: DesktopStepProgressStepStatus = 'running',
): DesktopStepProgress {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.id === activeStepID));
  return {
    active_step_id: activeStepID,
    steps: steps.map((step, index) => ({
      id: step.id,
      backend_event: step.backendEvent,
      label: step.label,
      label_key: step.labelKey,
      status: index < activeIndex
        ? 'succeeded'
        : index === activeIndex
          ? status
          : 'pending',
    })),
  };
}

function completeGatewayStepProgress(
  steps: readonly GatewayWorkflowStepDefinition[],
  activeStepID: GatewayWorkflowStepID,
): DesktopStepProgress {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.id === activeStepID));
  return {
    active_step_id: activeStepID,
    steps: steps.map((step, index) => ({
      id: step.id,
      backend_event: step.backendEvent,
      label: step.label,
      status: index <= activeIndex ? 'succeeded' : 'pending',
    })),
  };
}

function failGatewayStepProgress(
  steps: readonly GatewayWorkflowStepDefinition[],
  activeStepID: GatewayWorkflowStepID,
  detail: string,
): DesktopStepProgress {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.id === activeStepID));
  return {
    active_step_id: activeStepID,
    steps: steps.map((step, index) => ({
      id: step.id,
      backend_event: step.backendEvent,
      label: step.label,
      status: index < activeIndex ? 'succeeded' : index === activeIndex ? 'failed' : 'pending',
      ...(index === activeIndex ? { detail } : {}),
    })),
  };
}

function gatewayDiagnosisNextActions(
  operationKey: string,
): readonly DesktopLauncherOperationNextAction[] {
  return [
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

function gatewayFailureTitleKeyForDiagnosis(
  diagnosis: DesktopGatewayDiagnosis,
): DesktopOperationFailurePresentation['title_key'] | undefined {
  switch (diagnosis.classification) {
    case 'not_started':
      return 'environmentCenter.gatewayGuidanceStoppedTitle';
    case 'needs_update':
      return 'environmentCenter.gatewayPanelUpdateRequiredTitle';
    case 'needs_reinstall':
      return 'environmentStatus.reinstallRequired';
    default:
      return undefined;
  }
}

function gatewayFailureDetailKeyForDiagnosis(
  diagnosis: DesktopGatewayDiagnosis,
): DesktopOperationFailurePresentation['detail_key'] | undefined {
  if (diagnosis.classification === 'not_started') {
    return 'environmentCenter.gatewayPanelStartToSyncDetail';
  }
  return undefined;
}

function gatewayFailureFromDiagnosis(diagnosis: DesktopGatewayDiagnosis): DesktopOperationFailurePresentation {
  return desktopOperationFailurePresentation({
    code: diagnosis.classification === 'needs_reinstall' ? 'manual_recovery_required' : 'operation_failed',
    title: compact(diagnosis.summary) || 'Gateway check failed',
    titleKey: gatewayFailureTitleKeyForDiagnosis(diagnosis),
    summary: compact(diagnosis.detail) || compact(diagnosis.summary) || 'Desktop could not diagnose this Gateway.',
    detail: compact(diagnosis.detail),
    detailKey: gatewayFailureDetailKeyForDiagnosis(diagnosis),
  });
}

function gatewayProbeResultsForDiagnosis(
  diagnosis: Pick<DesktopGatewayDiagnosis, 'classification' | 'service_state' | 'trust_state' | 'catalog_state'>,
): readonly DesktopGatewayDiagnosisProbeResult[] {
  const serviceStatus = diagnosis.service_state?.status;
  const serviceReadyForVersionCheck = serviceStatus === 'ready'
    || serviceStatus === 'not_applicable'
    || serviceStatus === 'service_needs_update'
    || serviceStatus === undefined;
  const serviceFailed = serviceStatus === 'not_started'
    || serviceStatus === 'ssh_unreachable'
    || serviceStatus === 'container_unavailable'
    || serviceStatus === 'bridge_unavailable'
    || serviceStatus === 'error';
  const reinstallRequired = serviceStatus === 'needs_reinstall' || diagnosis.classification === 'needs_reinstall';
  const serviceWarning = serviceStatus === 'service_needs_update' || reinstallRequired;
  const versionWarning = diagnosis.classification === 'needs_update' || reinstallRequired;
  const trustFailed = diagnosis.classification === 'trust_failed' || diagnosis.trust_state === 'trust_changed' || diagnosis.trust_state === 'revoked';
  const pairingFailed = diagnosis.classification === 'pairing_required' || diagnosis.classification === 'identity_changed';
  const catalogFailed = diagnosis.classification === 'catalog_failed'
    || diagnosis.classification === 'service_ready_catalog_failed'
    || diagnosis.catalog_state === 'catalog_failed';
  const catalogSkipped = diagnosis.catalog_state === 'idle' || diagnosis.catalog_state === 'pairing_failed';
  return [
    {
      id: 'gateway_service',
      label: 'Gateway service',
      status: serviceFailed ? 'failed' : serviceWarning ? 'warning' : serviceReadyForVersionCheck ? 'passed' : 'unknown',
      ...(diagnosis.service_state?.message ? { detail: diagnosis.service_state.message } : {}),
    },
    {
      id: 'gateway_version',
      label: 'Gateway version',
      status: versionWarning ? 'warning' : serviceFailed ? 'skipped' : 'passed',
    },
    {
      id: 'gateway_trust',
      label: 'Gateway trust',
      status: trustFailed || pairingFailed ? 'failed' : serviceFailed || versionWarning ? 'skipped' : 'passed',
    },
    {
      id: 'gateway_catalog',
      label: 'Gateway catalog',
      status: catalogFailed ? 'failed' : serviceFailed || versionWarning || trustFailed || pairingFailed || catalogSkipped ? 'skipped' : 'passed',
    },
  ];
}

function completeGatewayDiagnosis(diagnosis: DesktopGatewayDiagnosis): DesktopGatewayDiagnosis {
  return {
    ...diagnosis,
    probe_results: diagnosis.probe_results ?? gatewayProbeResultsForDiagnosis(diagnosis),
  };
}

function gatewayDiagnosisForServiceState(
  record: GatewayRecord,
  serviceState: DesktopGatewayServiceState | undefined,
): DesktopGatewayDiagnosis {
  const manageable = desktopGatewayCanManageService(gatewayRecordToSource(record));
  const status = serviceState?.status ?? (record.connection.kind === 'url' ? 'not_applicable' : 'unknown');
  const base = {
    checked_at_unix_ms: Date.now(),
    manageable,
    service_state: serviceState,
    trust_state: gatewayRecordToSource(record).trust_state,
  };
  switch (status) {
    case 'not_started':
      return {
        ...base,
        classification: 'not_started',
        summary: 'Gateway is stopped',
        detail: 'Desktop can start this Gateway service. Use Refresh again after it is ready.',
      };
    case 'service_needs_update':
      return {
        ...base,
        classification: 'needs_update',
        summary: 'Gateway update required',
        detail: 'Desktop must update this Gateway service before Refresh can pair and refresh catalog data.',
      };
    case 'needs_reinstall':
      return {
        ...base,
        classification: 'needs_reinstall',
        summary: 'Gateway requires host maintenance',
        detail: serviceState?.message || 'This Standalone Gateway has incompatible state. Repair or reinstall it on its own host, then refresh it here.',
      };
    case 'ssh_unreachable':
      return {
        ...base,
        classification: 'ssh_unreachable',
        summary: 'SSH host unreachable',
        detail: serviceState?.message || 'Desktop cannot reach the SSH host that runs this Gateway.',
      };
    case 'container_unavailable':
      return {
        ...base,
        classification: 'container_unavailable',
        summary: 'Gateway container unavailable',
        detail: serviceState?.message || 'Desktop cannot reach the container that runs this Gateway.',
      };
    case 'bridge_unavailable':
      return {
        ...base,
        classification: 'bridge_unavailable',
        summary: 'Gateway bridge unavailable',
        detail: serviceState?.message || 'Desktop cannot open the Gateway bridge on the configured target.',
      };
    case 'error':
      return {
        ...base,
        classification: 'bridge_unavailable',
        summary: 'Gateway service needs restart',
        detail: serviceState?.message || 'Desktop could not determine this Gateway service state.',
      };
    case 'not_applicable':
      return {
        ...base,
        classification: 'unmanageable',
        summary: 'External Gateway endpoint',
        detail: 'Desktop can diagnose this Gateway endpoint, but service start and update must happen on its host.',
      };
    case 'ready':
      return {
        ...base,
        classification: 'ready',
        summary: 'Gateway service is ready',
        detail: 'Desktop can reach the Gateway service. Continue checking trust and catalog access.',
      };
    default:
      return {
        ...base,
        classification: 'unknown',
        summary: 'Gateway status is unknown',
        detail: serviceState?.message || 'Desktop could not determine this Gateway service state.',
      };
  }
}

function managedProbeFact(
  label: string,
  value: unknown,
  tone?: DesktopGatewayManagedProbe['facts'][number]['tone'],
): DesktopGatewayManagedProbe['facts'][number] | null {
  const clean = typeof value === 'boolean'
    ? (value ? 'Yes' : 'No')
    : compact(value);
  if (!clean) {
    return null;
  }
  return {
    label,
    value: clean,
    ...(tone ? { tone } : {}),
  };
}

function desktopManagedProbeFromServiceProbe(probe: GatewayServiceDeepProbe | undefined): DesktopGatewayManagedProbe | undefined {
  if (!probe) {
    return undefined;
  }
  const facts = [
    managedProbeFact('Gateway binary', probe.binary_path),
    managedProbeFact('Gateway state root', probe.state_root),
    managedProbeFact('Package status', probe.package_status, probe.package_status === 'ready' ? 'success' : 'warning'),
    managedProbeFact('Gateway version', probe.version),
    managedProbeFact('Gateway target version', probe.target_version),
    managedProbeFact('Gateway commit', probe.commit),
    managedProbeFact('Gateway target commit', probe.target_commit),
    managedProbeFact('Gateway service', probe.service_status, probe.service_status === 'running' ? 'success' : 'warning'),
    managedProbeFact('Gateway service pid', probe.service_pid),
    managedProbeFact('Gateway listen', probe.service_listen),
  ].filter((fact): fact is DesktopGatewayManagedProbe['facts'][number] => fact !== null);
  return {
    binary_path: probe.binary_path,
    package_status: probe.package_status,
    version: probe.version,
    target_version: probe.target_version,
    commit: probe.commit,
    target_commit: probe.target_commit,
    service_pid: probe.service_pid,
    service_listen: probe.service_listen,
    state_root: probe.state_root,
    facts,
  };
}

function normalizeGatewayProbeVersion(value: string | undefined): string {
  const clean = compact(value);
  if (clean === '') {
    return '';
  }
  return clean.startsWith('v') ? clean : `v${clean}`;
}

function gatewayProbeVersionIsDev(version: string): boolean {
  return version === 'v0.0.0-dev';
}

function gatewayManagedProbeNeedsUpdate(probe: DesktopGatewayManagedProbe | undefined): boolean {
  if (!probe) {
    return false;
  }
  const packageStatus = compact(probe.package_status);
  if (packageStatus !== '' && packageStatus !== 'ready') {
    return true;
  }
  const version = normalizeGatewayProbeVersion(probe.version);
  const targetVersion = normalizeGatewayProbeVersion(probe.target_version);
  if (version !== '' && targetVersion !== '' && version !== targetVersion) {
    return true;
  }
  const commit = compact(probe.commit);
  const targetCommit = compact(probe.target_commit);
  return gatewayProbeVersionIsDev(version)
    && gatewayProbeVersionIsDev(targetVersion)
    && commit !== ''
    && targetCommit !== ''
    && commit !== targetCommit;
}

function gatewayDiagnosisForError(
  record: GatewayRecord,
  error: unknown,
  serviceState?: DesktopGatewayServiceState,
  managedProbe?: DesktopGatewayManagedProbe,
): DesktopGatewayDiagnosis {
  const source = gatewayRecordToSource(record);
  const manageable = desktopGatewayCanManageService(source);
  const code = gatewaySyncErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const base = {
    checked_at_unix_ms: Date.now(),
    manageable,
    service_state: serviceState,
    trust_state: source.trust_state,
    ...(managedProbe ? { managed_probe: managedProbe } : {}),
    error_code: code,
    error_message: message,
  };
  if ((error instanceof GatewayTrustError && gatewayTrustErrorNeedsReinstall(error)) || code === 'GATEWAY_TRUST_CHANGED') {
    return {
      ...base,
      classification: manageable ? 'needs_reinstall' : 'identity_changed',
      catalog_state: 'pairing_failed',
      summary: manageable ? 'Gateway requires host maintenance' : 'Gateway identity changed',
      detail: message || 'Desktop could not verify this Gateway identity.',
    };
  }
  if (error instanceof GatewayTrustError) {
    const pairingRequired = error.code === 'GATEWAY_PAIRING_REQUIRED'
      || error.code === 'GATEWAY_PAIRING_TRUST_REQUIRED'
      || error.code === 'GATEWAY_TRUST_REVOKED';
    return {
      ...base,
      classification: pairingRequired ? 'pairing_required' : 'trust_failed',
      catalog_state: 'pairing_failed',
      summary: pairingRequired ? 'Gateway pairing required' : 'Gateway trust verification failed',
      detail: message,
    };
  }
  if (error instanceof GatewayServiceStartRequiredError) {
    return gatewayDiagnosisForServiceState(record, error.service_state);
  }
  if (error instanceof GatewayReinstallRequiredError) {
    return gatewayDiagnosisForServiceState(record, error.service_state);
  }
  if (error instanceof GatewayNotManageableError) {
    return {
      ...base,
      classification: 'unmanageable',
      summary: 'Gateway is not manageable from Desktop',
      detail: message || 'Start or update this Gateway on its host, then check again.',
    };
  }
  if (error instanceof GatewayServiceUnavailableError) {
    if (error.code === 'gateway_container_unavailable') {
      return {
        ...base,
        classification: 'container_unavailable',
        summary: 'Gateway container unavailable',
        detail: message,
      };
    }
    if (error.code === 'gateway_bridge_unavailable') {
      return {
        ...base,
        classification: 'bridge_unavailable',
        summary: 'Gateway bridge unavailable',
        detail: message,
      };
    }
    return {
      ...base,
      classification: 'ssh_unreachable',
      summary: 'Gateway SSH host unreachable',
      detail: message,
    };
  }
  if (error instanceof GatewayClientError) {
    if (gatewayClientErrorIsPairingRejected(error)) {
      if (gatewayManagedProbeNeedsUpdate(managedProbe)) {
        return {
          ...base,
          classification: 'needs_update',
          catalog_state: 'pairing_failed',
          summary: 'Gateway update required',
          detail: 'Desktop can reach the Gateway service, but the service rejected the catalog request before pairing could be trusted. Update Gateway to align the managed service with this Desktop before refreshing again.',
        };
      }
      return {
        ...base,
        classification: 'pairing_required',
        catalog_state: 'pairing_failed',
        summary: 'Gateway pairing required',
        detail: message,
      };
    }
    if (gatewayClientErrorIsTrustMismatch(error)) {
      return {
        ...base,
        classification: manageable ? 'needs_reinstall' : 'identity_changed',
        catalog_state: 'pairing_failed',
        summary: manageable ? 'Gateway requires host maintenance' : 'Gateway identity changed',
        detail: message,
      };
    }
    if (
      error.code === 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED'
      || error.code === 'GATEWAY_INVALID_RESPONSE'
      || error.code === 'GATEWAY_RUNTIME_CAPABILITY_INVALID'
    ) {
      return {
        ...base,
        classification: manageable ? 'needs_reinstall' : 'catalog_failed',
        catalog_state: 'catalog_failed',
        summary: manageable ? 'Gateway requires host maintenance' : 'Gateway response is incompatible',
        detail: message,
      };
    }
    return {
      ...base,
      classification: manageable && serviceState?.status === 'ready' ? 'service_ready_catalog_failed' : 'catalog_failed',
      catalog_state: 'catalog_failed',
      summary: manageable && serviceState?.status === 'ready' ? 'Gateway service is ready but catalog failed' : 'Gateway catalog check failed',
      detail: manageable && serviceState?.status === 'ready'
        ? (message || 'Desktop can reach the Gateway service, but the signed catalog request failed.')
        : message,
    };
  }
  return {
    ...base,
    classification: 'unknown',
    catalog_state: gatewaySyncStateForError(error),
    summary: 'Gateway check failed',
    detail: message || 'Desktop could not diagnose this Gateway.',
  };
}

async function checkGatewayRecord(
  record: GatewayRecord,
  options: Readonly<{
    signal?: AbortSignal;
    onDetail?: (detail: string) => void;
    onGatewayServiceProgress?: GatewayLifecycleProgressSink;
  }> = {},
): Promise<DesktopGatewayDiagnosis> {
  if (!record.local_enabled) {
    return {
      checked_at_unix_ms: Date.now(),
      classification: 'disabled',
      manageable: desktopGatewayCanManageService(gatewayRecordToSource(record)),
      summary: 'Gateway sync is paused',
      detail: 'This Desktop is not syncing this Gateway while it is disabled locally.',
      trust_state: gatewayRecordToSource(record).trust_state,
      catalog_state: 'idle',
    };
  }

  let serviceState: DesktopGatewayServiceState | undefined;
  let managedProbe: DesktopGatewayManagedProbe | undefined;
  try {
    options.onDetail?.(`Desktop is checking how ${record.display_name} is reached.`);
    if (record.connection.kind !== 'url') {
      options.onDetail?.(`Desktop is checking the Gateway service for ${record.display_name}.`);
      serviceState = await inspectGatewayServiceForSync(record, {
        signal: options.signal,
        onProgress: options.onGatewayServiceProgress,
      });
      options.onDetail?.(`Desktop is checking ${record.display_name}'s protocol and version.`);
      managedProbe = desktopManagedProbeFromServiceProbe(
        await gatewayLifecycleManager().inspectManagedProbe(record, options.signal).catch(() => undefined),
      );
      const serviceDiagnosis = gatewayDiagnosisForServiceState(record, serviceState);
      if (serviceDiagnosis.classification !== 'ready') {
        return {
          ...serviceDiagnosis,
          ...(managedProbe ? { managed_probe: managedProbe } : {}),
        };
      }
    } else {
      serviceState = await inspectGatewayServiceForSync(record, {
        signal: options.signal,
      });
      options.onDetail?.(`Desktop is checking ${record.display_name}'s protocol and version.`);
    }
    if (!record.trust_profile) {
      return {
        checked_at_unix_ms: Date.now(),
        classification: 'pairing_required',
        manageable: desktopGatewayCanManageService(gatewayRecordToSource(record)),
        service_state: serviceState,
        ...(managedProbe ? { managed_probe: managedProbe } : {}),
        trust_state: 'unpaired',
        catalog_state: 'pairing_failed',
        summary: 'Gateway pairing required',
        detail: 'Desktop needs to pair with this Gateway before it can refresh the catalog.',
      };
    }

    options.onDetail?.(`Desktop is verifying ${record.display_name}'s trust state.`);
    options.onDetail?.(`Desktop is checking whether ${record.display_name} can return its catalog.`);
    await gatewayLifecycleManager().refreshCatalog(record, {
      startPolicy: record.connection.kind === 'url' ? undefined : 'require_ready',
      signal: options.signal,
    });
    return {
      checked_at_unix_ms: Date.now(),
      classification: 'ready',
      manageable: desktopGatewayCanManageService(gatewayRecordToSource(record)),
      service_state: serviceState,
      ...(managedProbe ? { managed_probe: managedProbe } : {}),
      trust_state: gatewayRecordToSource(record).trust_state,
      catalog_state: 'ready',
      summary: 'Gateway is ready',
      detail: 'Desktop can reach this Gateway, verify trust, and read the catalog.',
    };
  } catch (error) {
    return gatewayDiagnosisForError(record, error, serviceState, managedProbe);
  }
}


async function setGatewayEnabledFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'set_gateway_enabled' }>,
): Promise<DesktopLauncherActionResult> {
  const record = await gatewayStore().setLocalEnabled(request.gateway_id, request.enabled);
  if (!request.enabled) {
    gatewaySyncStateByID.delete(record.gateway_id);
    gatewayDiagnosisByID.delete(record.gateway_id);
    supersedeGatewaySyncTask(record.gateway_id);
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('disabled_gateway');
  }
  broadcastDesktopWelcomeSnapshots();
  return launcherActionSuccess('enabled_gateway');
}

async function refreshGatewayFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'refresh_gateway' }>,
  options: Readonly<{ allowPairing?: boolean }> = {},
): Promise<DesktopLauncherActionResult> {
  const record = await gatewayStore().get(request.gateway_id);
  if (!record) {
    return launcherActionFailure('environment_missing', 'dialog', 'Gateway was not found.', {
      gatewayID: request.gateway_id,
      shouldRefreshSnapshot: true,
    });
  }
  const operationKey = `${record.gateway_id}:refresh`;
  if (!record.local_enabled) {
    return launcherActionFailure('action_invalid', 'gateway', 'Enable this Gateway on this Desktop before refreshing it.', {
      gatewayID: record.gateway_id,
      gatewayLabel: record.display_name,
      continuationAction: {
        kind: 'set_gateway_enabled',
        gateway_id: record.gateway_id,
        enabled: true,
      },
      shouldRefreshSnapshot: true,
    });
  }
  const activeRefreshOperation = launcherOperations.get(operationKey);
  if (launcherOperationIsActive(activeRefreshOperation)) {
    rebroadcastLauncherOperationProgress(activeRefreshOperation);
    return launcherActionSuccess('gateway_sync_in_progress');
  }
  const operation = launcherOperations.create({
    operation_key: operationKey,
    action: 'refresh_gateway',
    subject_kind: 'gateway',
    subject_id: record.gateway_id,
    gateway_id: record.gateway_id,
    active_progress_surface: 'gateway',
    phase: 'checking_gateway_service',
    title: 'Refresh Gateway',
    detail: `Desktop is refreshing ${record.display_name}.`,
    step_progress: gatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, 'checking_gateway_service'),
    cancelable: false,
  });
  const operationAttemptOwner = {
    action: operation.action,
    started_at_unix_ms: operation.started_at_unix_ms,
  };
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;

  const refreshDetailStep = (detail: string): GatewayWorkflowStepID => {
    const lower = detail.toLowerCase();
    if (lower.includes('protocol') || lower.includes('version') || lower.includes('package')) {
      return 'checking_gateway_package';
    }
    if (lower.includes('catalog')) {
      return 'refreshing_gateway_catalog';
    }
    if (lower.includes('trust') || lower.includes('identity') || lower.includes('pair')) {
      return 'fetching_pairing_challenge';
    }
    return 'checking_gateway_service';
  };
  const updateRefreshDetail = (detail: string): void => {
    const step = refreshDetailStep(detail);
    launcherOperations.updateCurrentAttempt(operationKey, operationAttemptOwner, {
      phase: step,
      title: 'Refresh Gateway',
      detail,
      step_progress: gatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, step),
    });
  };

  const finishCanceled = () => {
    launcherOperations.finishCurrentAttempt(operationKey, operationAttemptOwner, 'canceled', {
      phase: 'checking_gateway_service',
      title: 'Refresh canceled',
      detail: 'Desktop canceled this Gateway refresh.',
      step_progress: gatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, 'checking_gateway_service', 'canceled'),
    });
    scheduleCurrentLauncherOperationRemoval(operationKey, operationAttemptOwner);
    return launcherActionFailure('action_invalid', 'gateway', 'Gateway refresh was canceled.', {
      gatewayID: record.gateway_id,
      gatewayLabel: record.display_name,
      operationKey,
      shouldRefreshSnapshot: true,
    });
  };

  try {
    await syncGatewayRecord(record, {
      force: true,
      allowPairing: options.allowPairing === true,
      mode: 'sync',
      priority: 'foreground',
      progress: {
        signal,
        onGatewayServiceProgress: (progress) => {
          launcherOperations.updateCurrentAttempt(operationKey, operationAttemptOwner, {
            phase: 'checking_gateway_service',
            title: 'Refresh Gateway',
            detail: progress.detail,
            step_progress: gatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, 'checking_gateway_service'),
          });
        },
        onStage: (stage) => {
          const detailByStage: Record<GatewayWorkflowStepID, string> = {
            checking_gateway_service: `Desktop is checking ${record.display_name}.`,
            checking_gateway_package: `Desktop is checking ${record.display_name}'s Gateway package.`,
            fetching_pairing_challenge: `Desktop is verifying ${record.display_name}'s identity challenge.`,
            saving_trust_profile: 'Desktop verified the Gateway identity and is saving the trust profile.',
            refreshing_gateway_catalog: 'Desktop is refreshing the Gateway environment catalog.',
            gateway_refreshed: `Desktop refreshed ${record.display_name}.`,
          };
          launcherOperations.updateCurrentAttempt(operationKey, operationAttemptOwner, {
            phase: stage,
            title: 'Refresh Gateway',
            detail: detailByStage[stage],
            step_progress: gatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, stage),
          });
        },
      },
    });
    launcherOperations.finishCurrentAttempt(operationKey, operationAttemptOwner, 'succeeded', {
      phase: 'gateway_refreshed',
      title: 'Gateway is ready',
      detail: 'Desktop refreshed this Gateway and can reach its catalog.',
      step_progress: completeGatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, 'gateway_refreshed'),
    });
    scheduleCurrentLauncherOperationRemoval(operationKey, operationAttemptOwner);
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('refreshed_gateway');
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      return finishCanceled();
    }
    const latestRecord = await gatewayStore().get(record.gateway_id).catch(() => null) ?? record;
    const diagnosis = await checkGatewayRecord(latestRecord, {
      signal,
      onGatewayServiceProgress: (progress) => {
        launcherOperations.updateCurrentAttempt(operationKey, operationAttemptOwner, {
          phase: 'checking_gateway_service',
          title: 'Refresh Gateway',
          detail: progress.detail,
          step_progress: gatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, 'checking_gateway_service'),
        });
      },
      onDetail: updateRefreshDetail,
    }).catch(() => gatewayDiagnosisForError(latestRecord, error));
    setGatewayDiagnosis(record, diagnosis);
    const failure = gatewayFailureFromDiagnosis(diagnosis);
    const currentOperation = launcherOperations.get(operationKey);
    const phase = launcherOperationMatchesAttempt(currentOperation, operationAttemptOwner)
      ? (currentOperation.phase as GatewayWorkflowStepID)
      : 'refreshing_gateway_catalog';
    launcherOperations.finishCurrentAttempt(operationKey, operationAttemptOwner, 'failed', {
      phase,
      title: 'Refresh failed',
      detail: diagnosis.detail,
      step_progress: failGatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, phase, diagnosis.detail),
      gateway_diagnosis: completeGatewayDiagnosis(diagnosis),
      failure,
      next_actions: gatewayDiagnosisNextActions(operationKey),
    });
    return launcherActionFailure(gatewayLauncherActionFailureCode(error), 'gateway', diagnosis.detail, {
      gatewayID: record.gateway_id,
      gatewayLabel: record.display_name,
      operationKey,
      failure,
      shouldRefreshSnapshot: true,
    });
  }
}

async function checkGatewayFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'check_gateway' }>,
): Promise<DesktopLauncherActionResult> {
  return refreshGatewayFromLauncher({
    kind: 'refresh_gateway',
    gateway_id: request.gateway_id,
  });
}

async function refreshGatewayCatalogFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'refresh_gateway_catalog' }>,
): Promise<DesktopLauncherActionResult> {
  return refreshGatewayFromLauncher({
    kind: 'refresh_gateway',
    gateway_id: request.gateway_id,
  });
}

async function refreshGatewayStatusFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'refresh_gateway_status' }>,
): Promise<DesktopLauncherActionResult> {
  return refreshGatewayFromLauncher({
    kind: 'refresh_gateway',
    gateway_id: request.gateway_id,
  });
}

async function pairGatewayFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'pair_gateway' | 'sync_gateway' }>,
): Promise<DesktopLauncherActionResult> {
  const record = await gatewayStore().get(request.gateway_id);
  if (!record) {
    return launcherActionFailure('environment_missing', 'gateway', 'Gateway was not found.', {
      gatewayID: request.gateway_id,
      shouldRefreshSnapshot: true,
    });
  }
  if (record.connection.kind !== 'url') {
    return launcherActionFailure(
      'action_invalid',
      'gateway',
      'Only a standalone URL Gateway can be paired from Desktop.',
      {
        gatewayID: record.gateway_id,
        gatewayLabel: record.display_name,
        shouldRefreshSnapshot: true,
      },
    );
  }
  return refreshGatewayFromLauncher({
    kind: 'refresh_gateway',
    gateway_id: request.gateway_id,
  }, { allowPairing: true });
}

function reinstallTargetFailureCode(error: unknown): DesktopLauncherActionFailureCode {
  if (error instanceof ReinstallTargetCoordinatorError) {
    switch (error.code) {
      case 'reinstall_unsupported':
        return 'reinstall_unsupported';
      case 'reinstall_retryable':
        return 'reinstall_failed';
      case 'preflight_expired':
        return 'reinstall_preflight_expired';
      case 'target_changed':
        return 'reinstall_target_changed';
      case 'manual_recovery_required':
        return 'reinstall_failed';
    }
  }
  return 'reinstall_failed';
}

async function previewReinstallTargetFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'preview_reinstall_target' }>,
): Promise<DesktopLauncherActionResult> {
  const operationKey = `reinstall-target:${crypto.randomUUID()}`;
  const operation = launcherOperations.create({
    operation_key: operationKey,
    action: 'reinstall_target',
    subject_kind: 'runtime_target',
    subject_id: request.environment_id,
    environment_id: request.environment_id,
    active_progress_surface: 'reinstall',
    phase: 'preflight',
    title: 'Reinstall Redeven',
    title_key: 'environmentAction.reinstallRedeven',
    detail: 'Review the deletion scope and confirm before Desktop connects to the target.',
    detail_key: 'confirm.reinstallTargetDescription',
    step_progress: reinstallTargetStepProgress('confirmation'),
    cancelable: false,
  });
  try {
    const preview = await reinstallTargetCoordinator().preview({
      environment_id: request.environment_id,
      operation_key: operation.operation_key,
      mode: request.mode ?? 'wipe_data',
    });
    const affectedEnvironmentIDs = new Set(preview.affected_environment_ids);
    for (const existing of launcherOperations.operations()) {
      if (
        existing.operation_key !== operation.operation_key
        && existing.action === 'reinstall_target'
        && existing.status === 'needs_confirmation'
        && existing.environment_id
        && affectedEnvironmentIDs.has(existing.environment_id)
      ) {
        launcherOperations.remove(existing.operation_key);
      }
    }
    launcherOperations.finish(operation.operation_key, 'needs_confirmation', {
      environment_label: preview.label,
      phase: 'confirmation',
      title: 'Reinstall Redeven',
      title_key: 'environmentAction.reinstallRedeven',
      detail: 'Review the deletion list and confirm before Redeven is reinstalled.',
      detail_key: 'confirm.reinstallTargetDescription',
      step_progress: reinstallTargetStepProgress('confirmation'),
      reinstall_preview: preview,
      next_actions: [{
        kind: 'reinstall_target',
        environment_id: preview.environment_id,
        preflight_id: preview.preflight_id,
        operation_key: preview.operation_key,
        label: preview.mode === 'preserve_data' ? 'Reinstall Redeven and keep data' : 'Erase data and reinstall Redeven',
        label_key: preview.mode === 'preserve_data' ? 'environmentAction.reinstallRedevenKeepData' : 'environmentAction.reinstallRedevenWipeData',
        mode: preview.mode,
      }],
    });
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('previewed_reinstall_target', {
      operationKey,
      reinstallPreview: preview,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = desktopFailureFromError(error, {
      code: 'operation_failed',
      title: 'Redeven Reinstall Preflight Failed',
      titleKey: 'confirm.reinstallFailedTitle',
      summary: message,
      targetLabel: request.environment_id,
    });
    launcherOperations.finish(operation.operation_key, 'failed', {
      phase: 'preflight',
      title: 'Redeven reinstall preflight failed',
      title_key: 'confirm.reinstallFailedTitle',
      detail: message,
      failure,
      step_progress: reinstallTargetStepProgress('confirmation', 'failed'),
      next_actions: [
        {
          kind: 'copy_diagnostics',
          operation_key: operationKey,
          label: 'Copy log',
          label_key: 'progress.copyLog',
        },
        {
          kind: 'dismiss',
          operation_key: operationKey,
          label: 'Dismiss',
          label_key: 'progress.dismiss',
        },
      ],
    });
    return launcherActionFailure(reinstallTargetFailureCode(error), 'environment', message, {
      environmentID: request.environment_id,
      operationKey,
      shouldRefreshSnapshot: true,
      failure,
    });
  }
}

function reinstallTargetProgressPresentation(
  phase: ReinstallTargetProgressPhase,
){
  const title = 'Reinstall Redeven';
  const title_key = 'environmentAction.reinstallRedeven' as const;
  switch (phase) {
    case 'confirmation':
      return { title, title_key, detail: 'Review the deletion list and confirm before Redeven is reinstalled.', detail_key: 'confirm.reinstallTargetDescription' as const };
    case 'direct_channel_open':
      return { title, title_key, detail: 'Desktop is opening the confirmed direct maintenance channel.', detail_key: 'progress.reinstallCheckingDetail' as const };
    case 'target_resolved':
      return { title, title_key, detail: 'Desktop confirmed the exact registered Redeven target.', detail_key: 'progress.reinstallTargetResolvedDetail' as const };
    case 'package_batch_prepared_and_verified':
      return { title, title_key, detail: 'Desktop is preparing and transferring the Gateway and Runtime packages together.', detail_key: 'progress.reinstallPackagesPreparingDetail' as const };
    case 'redeven_process_stop_attempted':
      return { title, title_key, detail: 'Desktop attempted to stop Redeven processes owned by this target.', detail_key: 'progress.reinstallStoppingProcessesDetail' as const };
    case 'old_root_isolated_or_cleared':
      return { title, title_key, detail: 'Desktop prepared the exact target root for the fresh installation.', detail_key: 'progress.quarantiningEnvironmentDetail' as const };
    case 'fresh_suite_installed':
      return { title, title_key, detail: 'Desktop is applying the verified Gateway and Runtime package batch.', detail_key: 'progress.reinstallPackagesApplyingDetail' as const };
    case 'gateway_started':
      return { title, title_key, detail: 'Desktop is starting the fresh Gateway and Runtime.', detail_key: 'progress.reinstallFreshStartedDetail' as const };
    case 'runtime_started':
      return { title, title_key, detail: 'Desktop started the fresh Runtime through the new Gateway supervisor.', detail_key: 'progress.reinstallFreshStartedDetail' as const };
    case 'runtime_verified':
      return { title, title_key, detail: 'Desktop verified the new Gateway and Runtime process identities.', detail_key: 'progress.verifyingFreshEnvironmentDetail' as const };
    case 'catalog_and_local_ui_verified':
      return { title, title_key, detail: 'Desktop verified the fresh Catalog and Local UI.', detail_key: 'progress.reinstallCatalogAndLocalUIVerifiedDetail' as const };
    case 'old_data_cleaned':
      return { title, title_key, detail: 'Desktop removed the isolated old Redeven root.', detail_key: 'progress.reinstallQuarantineCleanedDetail' as const };
    case 'completed':
      return { title, title_key, detail: 'Redeven reinstall completed.', detail_key: 'progress.reinstallCompletedDetail' as const };
    default:
      return { title, title_key, detail: 'Desktop is revalidating the confirmed host, container, and Redeven root.', detail_key: 'progress.reinstallCheckingDetail' as const };
  }
}

async function reinstallTargetFromLauncher(
  request: Extract<DesktopLauncherActionRequest, { kind: 'reinstall_target' }>,
): Promise<DesktopLauncherActionResult> {
  const operationKey = compact(request.operation_key) || `reinstall-target:${request.preflight_id}`;
  const existing = launcherOperations.get(operationKey);
  if (existing?.action === 'reinstall_target' && (
    existing.status === 'running'
    || existing.status === 'canceling'
    || existing.status === 'cleanup_running'
  )) {
    return launcherActionSuccess('reinstall_target_in_progress', { operationKey });
  }
  if (existing?.action === 'reinstall_target' && existing.status === 'succeeded') {
    return launcherActionSuccess('reinstalled_target', { operationKey });
  }
  if (!existing || existing.action !== 'reinstall_target' || existing.status !== 'needs_confirmation') {
    return launcherActionFailure('operation_missing', 'environment', 'The reinstall operation is no longer available.', {
      environmentID: request.environment_id,
      operationKey,
      shouldRefreshSnapshot: true,
    });
  }
  const operation = launcherOperations.update(operationKey, {
    status: 'running',
    phase: 'direct_channel_open',
    title: 'Reinstall Redeven',
    title_key: 'environmentAction.reinstallRedeven',
    detail: 'Desktop is connecting to the confirmed target and applying the selected package batch.',
    detail_key: 'progress.reinstallCheckingDetail',
    step_progress: reinstallTargetStepProgress('direct_channel_open'),
    cancelable: false,
    failure: undefined,
    next_actions: undefined,
  });
  if (!operation) {
    return launcherActionFailure('operation_missing', 'environment', 'The reinstall operation is no longer available.', {
      environmentID: request.environment_id,
      operationKey,
      shouldRefreshSnapshot: true,
    });
  }
  const owner = {
    action: operation.action,
    started_at_unix_ms: operation.started_at_unix_ms,
  };
  let activePhase: ReinstallTargetProgressPhase = 'direct_channel_open';
  try {
    const descriptor = await resolveDirectReinstallTarget(request.environment_id);
    const targetKey = runtimeLifecycleTargetKey(descriptor.host_access, descriptor.placement);
    const activeLifecycle = runtimeLifecycleCoordinator.active(targetKey);
    if (activeLifecycle && activeLifecycle.intent !== 'reinstall') {
      if (activeLifecycle.intent !== 'stop') {
        runtimeLifecycleCoordinator.cancel(
          targetKey,
          new DOMException('Redeven reinstall is taking ownership of this target.', 'AbortError'),
        );
      }
      await runtimeLifecycleCoordinator.waitForIdle(targetKey);
    }
    await runtimeLifecycleCoordinator.run({
      target_key: targetKey,
      intent: 'reinstall',
      fingerprint: runtimeLifecycleFingerprint({
        host_access: descriptor.host_access,
        placement: descriptor.placement,
        mode: request.mode,
        preflight_id: request.preflight_id,
      }),
      operation_key: operationKey,
      execute: () => reinstallTargetCoordinator().execute(
        request.preflight_id,
        operationKey,
        (phase, detailKey, tasks) => {
          activePhase = phase;
          const presentation = reinstallTargetProgressPresentation(phase);
          launcherOperations.updateCurrentAttempt(operationKey, owner, {
            phase,
            title: presentation.title,
            title_key: presentation.title_key,
            detail: presentation.detail,
            detail_key: (detailKey as Parameters<typeof reinstallTargetStepProgress>[2]) ?? presentation.detail_key,
            step_progress: reinstallTargetStepProgress(
              phase,
              'running',
              detailKey as Parameters<typeof reinstallTargetStepProgress>[2],
              tasks,
            ),
            cancelable: false,
          });
        },
      ),
    });
    launcherOperations.finishCurrentAttempt(operationKey, owner, 'succeeded', {
      phase: 'completed',
      title: 'Reinstall Redeven',
      title_key: 'environmentAction.reinstallRedeven',
      detail: 'Redeven reinstall completed.',
      detail_key: 'progress.reinstallCompletedDetail',
      step_progress: reinstallTargetStepProgress('completed', 'succeeded'),
    });
    scheduleCurrentLauncherOperationRemoval(operationKey, owner);
    broadcastDesktopWelcomeSnapshots();
    return launcherActionSuccess('reinstalled_target', { operationKey });
  } catch (error) {
    const normalizedError = error instanceof RuntimeLifecycleInProgressError
      ? new ReinstallTargetCoordinatorError('reinstall_retryable', error.message, { cause: error })
      : error;
    const message = normalizedError instanceof Error ? normalizedError.message : String(normalizedError);
    const retryablePreparation = normalizedError instanceof ReinstallTargetCoordinatorError
      && normalizedError.code === 'reinstall_retryable';
    const failureSource = structuredDesktopFailureSource(normalizedError);
    const failure = reinstallFailureForPhase(failureSource, activePhase, request.environment_id);
    const retryable = normalizedError instanceof ReinstallTargetCoordinatorError
      && (normalizedError.code === 'preflight_expired' || normalizedError.code === 'target_changed' || normalizedError.code === 'reinstall_retryable');
    const blocked = normalizedError instanceof ReinstallTargetCoordinatorError
      && normalizedError.code === 'reinstall_unsupported';
    const terminalStatus = retryable ? 'needs_confirmation' as const : 'failed' as const;
    const recommendedMode = normalizedError instanceof ReinstallTargetCoordinatorError
      ? normalizedError.recommended_mode
      : undefined;
    launcherOperations.finishCurrentAttempt(operationKey, owner, terminalStatus, {
      phase: retryable ? 'confirmation' : activePhase,
      title: retryable ? 'Review reinstall target' : blocked ? 'Reinstall blocked' : 'Redeven reinstall requires manual recovery',
      title_key: retryable ? 'confirm.reinstallTargetTitle' : 'confirm.reinstallFailedTitle',
      detail: retryable
        ? (retryablePreparation ? message : 'The target changed or the confirmation expired. Review the target again.')
        : message,
      detail_key: retryable ? 'confirm.reinstallTargetDescription' : blocked ? 'confirm.reinstallManualRecovery' : 'confirm.reinstallManualRecovery',
      step_progress: reinstallTargetStepProgress(retryable ? 'confirmation' : activePhase, 'failed'),
      failure,
      next_actions: [{
        ...(retryablePreparation && recommendedMode ? {
          kind: 'retry' as const,
          operation_key: operationKey,
          label: 'Erase data and reinstall Redeven',
          label_key: 'environmentAction.reinstallRedevenWipeData' as const,
          retry_action: {
            kind: 'preview_reinstall_target' as const,
            environment_id: request.environment_id,
            mode: recommendedMode,
          },
        } : retryablePreparation ? {
          kind: 'reinstall_target' as const,
          environment_id: request.environment_id,
          preflight_id: request.preflight_id,
          operation_key: operationKey,
          label: retryablePreparation ? 'Retry reinstall Redeven' : 'Reinstall Redeven',
          label_key: 'environmentAction.reinstallRedeven' as const,
          mode: request.mode,
        } : retryable ? {
          kind: 'retry' as const,
          operation_key: operationKey,
          label: 'Review target',
          label_key: 'common.retry' as const,
          retry_action: { kind: 'preview_reinstall_target', environment_id: request.environment_id, mode: request.mode },
        } : {
          kind: 'dismiss' as const,
          operation_key: operationKey,
          label: 'Dismiss',
          label_key: 'progress.dismiss' as const,
        }),
      }, {
        kind: 'copy_diagnostics',
        operation_key: operationKey,
        label: 'Copy log',
        label_key: 'progress.copyLog',
      }],
    });
    return launcherActionFailure(reinstallTargetFailureCode(normalizedError), 'environment', message, {
      environmentID: request.environment_id,
      operationKey,
      shouldRefreshSnapshot: true,
      failure,
    });
  }
}

async function deleteGatewayFromLauncher(gatewayID: string): Promise<GatewayRecord | null> {
  const existing = await gatewayStore().get(gatewayID);
  if (existing?.trust_profile) {
    await gatewaySecretStore().deleteSecret(existing.trust_profile.paired_client_private_key_ref);
  }
  const passwordRef = existing ? gatewayRecordSSHPasswordRef(existing) : '';
  if (passwordRef) {
    await gatewaySecretStore().deleteSecret(passwordRef);
  }
  if (existing) {
    await gatewayLifecycleManager().clear(existing);
  }
  return gatewayStore().delete(gatewayID);
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

function liveGatewayEnvironmentSessions(gatewayID: string, gatewayEnvID: string): readonly DesktopSessionRecord[] {
  const cleanGatewayID = compact(gatewayID);
  const cleanGatewayEnvID = compact(gatewayEnvID);
  if (cleanGatewayID === '' || cleanGatewayEnvID === '') {
    return [];
  }
  const matches: DesktopSessionRecord[] = [];
  for (const sessionRecord of sessionsByKey.values()) {
    if (
      sessionRecord.target.kind === 'gateway_environment'
      && sessionRecord.target.gateway_id === cleanGatewayID
      && sessionRecord.target.gateway_env_id === cleanGatewayEnvID
    ) {
      const live = liveSession(sessionRecord.session_key);
      if (live) {
        matches.push(live);
      }
    }
  }
  return matches;
}

type RuntimeLifecycleWindowOperation = 'start' | 'stop' | 'restart' | 'update';

type RuntimeLifecycleSessionScope = Readonly<
  | { kind: 'session_key'; session_key: DesktopSessionKey }
  | { kind: 'session_target'; target: DesktopSessionTarget }
  | { kind: 'gateway_environment'; gateway_id: string; gateway_env_id: string }
>;

const runtimeLifecycleGenerationByIdentity = new Map<string, number>();

function runtimeLifecycleIdentityKey(parts: readonly string[]): string {
  return JSON.stringify(parts.map((part) => compact(part)));
}

function runtimeLifecycleIdentityKeysForTarget(target: DesktopSessionTarget): readonly string[] {
  const keys = [runtimeLifecycleIdentityKey(['session', target.session_key])];
  switch (target.kind) {
    case 'local_environment':
      keys.push(runtimeLifecycleIdentityKey(['local_environment', target.environment_id]));
      if (target.provider_origin && target.provider_id && target.env_public_id) {
        keys.push(runtimeLifecycleIdentityKey([
          'provider_environment',
          target.provider_origin,
          target.provider_id,
          target.env_public_id,
        ]));
      }
      break;
    case 'external_local_ui':
      keys.push(runtimeLifecycleIdentityKey(['external_local_ui', target.environment_id]));
      break;
    case 'gateway_environment':
      keys.push(runtimeLifecycleIdentityKey(['gateway_environment', target.gateway_id, target.gateway_env_id]));
      break;
    case 'ssh_environment':
      break;
  }
  return keys;
}

function runtimeLifecycleIdentityKeysForScope(scope: RuntimeLifecycleSessionScope): readonly string[] {
  switch (scope.kind) {
    case 'session_key':
      return [runtimeLifecycleIdentityKey(['session', scope.session_key])];
    case 'session_target':
      return runtimeLifecycleIdentityKeysForTarget(scope.target);
    case 'gateway_environment':
      return [runtimeLifecycleIdentityKey(['gateway_environment', scope.gateway_id, scope.gateway_env_id])];
  }
}

function runtimeLifecycleGenerationSnapshot(identityKeys: readonly string[]): string {
  return [...new Set(identityKeys)]
    .sort()
    .map((identityKey) => `${identityKey}:${runtimeLifecycleGenerationByIdentity.get(identityKey) ?? 0}`)
    .join('|');
}

function runtimeLifecycleGenerationSnapshotForTarget(target: DesktopSessionTarget): string {
  return runtimeLifecycleGenerationSnapshot(runtimeLifecycleIdentityKeysForTarget(target));
}

function markRuntimeLifecycleAccepted(scope: RuntimeLifecycleSessionScope): void {
  for (const identityKey of new Set(runtimeLifecycleIdentityKeysForScope(scope))) {
    runtimeLifecycleGenerationByIdentity.set(
      identityKey,
      (runtimeLifecycleGenerationByIdentity.get(identityKey) ?? 0) + 1,
    );
  }
}

function runtimeLifecycleSessionMatchesScope(
  sessionRecord: DesktopSessionRecord,
  scope: RuntimeLifecycleSessionScope,
): boolean {
  switch (scope.kind) {
    case 'session_key':
      return sessionRecord.session_key === scope.session_key;
    case 'session_target':
      return desktopSessionTargetsReferToSameEnvironment(sessionRecord.target, scope.target);
    case 'gateway_environment':
      return sessionRecord.target.kind === 'gateway_environment'
        && sessionRecord.target.gateway_id === compact(scope.gateway_id)
        && sessionRecord.target.gateway_env_id === compact(scope.gateway_env_id);
  }
}

function runtimeLifecycleScopeMatchesLauncherOpen(
  snapshot: DesktopLauncherOperationSnapshot,
  scope: RuntimeLifecycleSessionScope,
): boolean {
  if (
    !snapshot.open_progress
    || (snapshot.status !== 'running' && snapshot.status !== 'canceling')
  ) {
    return false;
  }
  const targetID = compact(snapshot.open_progress.target_id);
  const environmentID = compact(snapshot.environment_id ?? snapshot.open_progress.environment_id);
  switch (scope.kind) {
    case 'session_key':
      return targetID === scope.session_key
        || compact(snapshot.subject_id) === scope.session_key
        || snapshot.operation_key.startsWith(`${scope.session_key}:open`);
    case 'gateway_environment': {
      const gatewayTargetID = `gateway:${encodeURIComponent(compact(scope.gateway_id))}:env:${encodeURIComponent(compact(scope.gateway_env_id))}`;
      return targetID === gatewayTargetID || targetID.startsWith(`${gatewayTargetID}:session:`);
    }
    case 'session_target':
      if (targetID === scope.target.session_key || compact(snapshot.subject_id) === scope.target.session_key) {
        return true;
      }
      switch (scope.target.kind) {
        case 'local_environment':
          return environmentID === compact(scope.target.environment_id) || (
            !!scope.target.provider_origin
            && !!scope.target.env_public_id
            && environmentID === desktopProviderEnvironmentID(
              scope.target.provider_origin,
              scope.target.env_public_id,
            )
          );
        case 'external_local_ui':
          return environmentID === compact(scope.target.environment_id);
        case 'ssh_environment':
          return targetID === scope.target.session_key;
        case 'gateway_environment': {
          const gatewayTargetID = `gateway:${encodeURIComponent(scope.target.gateway_id)}:env:${encodeURIComponent(scope.target.gateway_env_id)}`;
          return targetID === gatewayTargetID || targetID.startsWith(`${gatewayTargetID}:session:`);
        }
      }
  }
}

function cancelLauncherOpensForRuntimeLifecycle(
  scope: RuntimeLifecycleSessionScope,
  preservedOperationKey?: string,
): void {
  for (const snapshot of launcherOperations.operations()) {
    if (
      snapshot.operation_key !== preservedOperationKey
      && runtimeLifecycleScopeMatchesLauncherOpen(snapshot, scope)
    ) {
      launcherOperations.cancel(
        snapshot.operation_key,
        'Desktop is canceling this Environment Open because Runtime maintenance has started.',
      );
    }
  }
}

async function closeEnvironmentSessionsForRuntimeLifecycle(input: Readonly<{
  operation: RuntimeLifecycleWindowOperation;
  scope: RuntimeLifecycleSessionScope;
  preserved_open_operation_key?: string;
}>): Promise<void> {
  markRuntimeLifecycleAccepted(input.scope);
  cancelLauncherOpensForRuntimeLifecycle(input.scope, input.preserved_open_operation_key);
  const closeMatchingSessions = async (): Promise<void> => {
    const sessionKeys = [...sessionsByKey.values()]
      .filter((sessionRecord) => !sessionRecord.closing && runtimeLifecycleSessionMatchesScope(sessionRecord, input.scope))
      .map((sessionRecord) => sessionRecord.session_key);
    for (const sessionKey of sessionKeys) {
      await finalizeSessionClosure(sessionKey, {
        reason: `runtime_${input.operation}`,
      });
    }
  };
  await closeMatchingSessions();
  await Promise.resolve();
  await closeMatchingSessions();
}

async function handoffSessionToRuntimeLifecycle(input: Readonly<{
  operation: Exclude<RuntimeLifecycleWindowOperation, 'stop'>;
  sessionTarget: DesktopSessionTarget;
}>): Promise<void> {
  await openDesktopWelcomeWindow({
    entryReason: 'switch_environment',
    selectedEnvironmentID: input.sessionTarget.environment_id,
    stealAppFocus: true,
  });
  await closeEnvironmentSessionsForRuntimeLifecycle({
    operation: input.operation,
    scope: { kind: 'session_target', target: input.sessionTarget },
  });
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

function rebroadcastLauncherOperationProgress(snapshot: DesktopLauncherOperationSnapshot | null | undefined): void {
  if (!snapshot) {
    return;
  }
  handleLauncherOperationChange(snapshot);
}

function launcherOperationIsActive(snapshot: DesktopLauncherOperationSnapshot | null): boolean {
  return snapshot?.status === 'running'
    || snapshot?.status === 'canceling'
    || snapshot?.status === 'cleanup_running';
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
    || snapshot?.status === 'needs_confirmation'
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
    removeLauncherOperation(cleanOperationKey);
    void emitDesktopWelcomeSnapshot('launcher');
  }, delayMs);
  launcherOperationRemovalTimers.set(cleanOperationKey, timer);
}

function removeLauncherOperation(operationKey: string): void {
  const cleanOperationKey = compact(operationKey);
  if (cleanOperationKey === '') {
    return;
  }
  const existingTimer = launcherOperationRemovalTimers.get(cleanOperationKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
    launcherOperationRemovalTimers.delete(cleanOperationKey);
  }
  clearRuntimeLifecycleWorkflow(cleanOperationKey);
  launcherOperations.remove(cleanOperationKey);
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
    || snapshot.status === 'needs_confirmation'
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
      || current.status === 'needs_confirmation'
    ) {
      return;
    }
    removeLauncherOperation(cleanOperationKey);
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
    flowerSettingsFocusRevision: options.focusFlowerSettings
      ? current.flowerSettingsFocusRevision + 1
      : current.flowerSettingsFocusRevision,
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
  const preloadPath = args.preload === 'none'
    ? ''
    : args.preload === 'web_service_browser'
      ? resolveWebServiceBrowserPreloadPath({ appPath: app.getAppPath() })
      : surface === 'utility'
        ? resolveUtilityPreloadPath({ appPath: app.getAppPath() })
        : resolveSessionPreloadPath({ appPath: app.getAppPath() });
  const usesDesktopChrome = args.chrome !== 'native';
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
    ...(usesDesktopChrome
      ? buildDesktopWindowChromeOptions(process.platform, themeSnapshot.window)
      : { backgroundColor: themeSnapshot.window.backgroundColor }),
    parent: actualParent,
    webPreferences: {
      ...(preloadPath ? { preload: preloadPath } : {}),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      ...(compact(args.sessionPartition) ? { partition: compact(args.sessionPartition) } : {}),
    },
  });
  const trackedWindow = trackBrowserWindow(win);

  if (usesDesktopChrome) {
    desktopThemeState().registerWindow(win);
    desktopLanguageState().registerWindow(win, {
      titleForSnapshot: args.role === 'launcher'
        ? (snapshot) => createDesktopI18n(snapshot.resolved_locale).t('desktop.title')
        : false,
    });
  }
  const disposeWindowChromeBroadcast = usesDesktopChrome
    ? attachDesktopWindowChromeBroadcast(win, process.platform)
    : () => {};
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
      url: stripSensitiveURLPayload(win.webContents.getURL()),
    });
    args.onDidFinishLoad?.(win);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    recordWindowLifecycle(args.diagnostics, 'loading_failed', errorDescription || 'browser window failed to load', {
      role: args.role,
      url: stripSensitiveURLPayload(validatedURL),
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

  if (args.deferInitialLoad !== true) {
    void win.loadURL(args.targetURL);
  }
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
    sessionPartition: sessionRecord.session_partition,
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

function openOrReuseSessionCodespaceWindow(
  sessionKey: DesktopSessionKey,
  codeSpaceID: string,
  targetURL: string,
): BrowserWindow | null {
  const sessionRecord = sessionsByKey.get(sessionKey);
  if (!sessionRecord) {
    return null;
  }

  const existing = sessionRecord.codespace_windows.get(codeSpaceID);
  const existingWindow = liveTrackedBrowserWindow(existing);
  if (existing && existingWindow) {
    void existingWindow.loadURL(targetURL);
    presentAppWindow(existingWindow, { stealAppFocus: true });
    return existingWindow;
  }
  if (existing) {
    sessionRecord.codespace_windows.delete(codeSpaceID);
    sessionKeyByWebContentsID.delete(existing.webContentsID);
  }

  const codespaceWindow = createBrowserWindow({
    targetURL,
    stateKey: sessionCodespaceWindowStateKey(sessionKey, codeSpaceID),
    role: 'codespace_child',
    sessionPartition: sessionRecord.session_partition,
    diagnostics: sessionRecord.diagnostics,
    chrome: 'native',
    preload: 'none',
    stealAppFocus: true,
    onWindowOpen: (nextURL) => {
      if (isAllowedCodespaceWindowNavigation(nextURL, sessionRecord.allowed_base_url, codeSpaceID)) {
        openSessionCodespaceWindow(sessionKey, codeSpaceID, nextURL);
      } else {
        openExternal(nextURL);
      }
    },
    onWillNavigate: (nextURL, event) => {
      if (isAllowedCodespaceWindowNavigation(nextURL, sessionRecord.allowed_base_url, codeSpaceID)) {
        return;
      }
      event.preventDefault();
      openExternal(nextURL);
    },
    onClosed: (closedWindow) => {
      sessionRecord.codespace_windows.delete(codeSpaceID);
      sessionRecord.codespace_loading_documents.delete(codeSpaceID);
      sessionKeyByWebContentsID.delete(closedWindow.webContentsID);
    },
  });

  sessionRecord.codespace_windows.set(codeSpaceID, codespaceWindow);
  sessionKeyByWebContentsID.set(codespaceWindow.webContentsID, sessionKey);
  return codespaceWindow.browserWindow;
}

function openSessionCodespaceLoadingWindow(
  sessionKey: DesktopSessionKey,
  codeSpaceID: string,
  copy: CodespaceLoadingWindowCopy = {},
): BrowserWindow | null {
  const sessionRecord = sessionsByKey.get(sessionKey);
  if (!sessionRecord) {
    return null;
  }
  sessionRecord.codespace_loading_documents.set(codeSpaceID, copy);
  return openOrReuseSessionCodespaceWindow(
    sessionKey,
    codeSpaceID,
    buildCodespaceLoadingDocumentURL(codeSpaceID, desktopThemeState().getSnapshot(), copy),
  );
}

function openSessionCodespaceWindow(
  sessionKey: DesktopSessionKey,
  codeSpaceID: string,
  targetURL: string,
): BrowserWindow | null {
  sessionsByKey.get(sessionKey)?.codespace_loading_documents.delete(codeSpaceID);
  return openOrReuseSessionCodespaceWindow(sessionKey, codeSpaceID, targetURL);
}

function refreshCodespaceLoadingDocuments(): void {
  const themeSnapshot = desktopThemeState().getSnapshot();
  for (const sessionRecord of sessionsByKey.values()) {
    for (const [codeSpaceID, copy] of sessionRecord.codespace_loading_documents) {
      const browserWindow = liveTrackedBrowserWindow(sessionRecord.codespace_windows.get(codeSpaceID));
      if (!browserWindow) {
        sessionRecord.codespace_loading_documents.delete(codeSpaceID);
        continue;
      }
      void browserWindow.loadURL(buildCodespaceLoadingDocumentURL(codeSpaceID, themeSnapshot, copy));
    }
  }
}

function openCodespaceWindowFromShell(
  sessionRecord: DesktopSessionRecord | null,
  request: DesktopShellOpenCodespaceWindowRequest,
): DesktopShellOpenCodespaceWindowResponse {
  if (!sessionRecord || sessionRecord.closing) {
    return {
      ok: false,
      message: DESKTOP_STALE_WINDOW_MESSAGE,
    };
  }
  if (request.mode === 'loading') {
    const win = openSessionCodespaceLoadingWindow(sessionRecord.session_key, request.code_space_id, {
      ...(request.state ? { state: request.state } : {}),
      ...(request.title ? { title: request.title } : {}),
      ...(request.detail ? { detail: request.detail } : {}),
    });
    if (!win) {
      return {
        ok: false,
        message: DESKTOP_STALE_WINDOW_MESSAGE,
      };
    }
    return { ok: true };
  }

  if (!isAllowedCodespaceWindowNavigation(request.url, sessionRecord.allowed_base_url, request.code_space_id)) {
    return {
      ok: false,
      message: 'Desktop refused to open a codespace window outside this environment session.',
    };
  }

  const win = openSessionCodespaceWindow(sessionRecord.session_key, request.code_space_id, request.url);
  if (!win) {
    return {
      ok: false,
      message: DESKTOP_STALE_WINDOW_MESSAGE,
    };
  }

  return { ok: true };
}

async function prepareWebServiceWindowPartition(
  sessionRecord: DesktopSessionRecord,
  partition: string,
): Promise<void> {
  const webSession = session.fromPartition(partition);
  installDesktopDiagnosticsHooks(webSession);
  await webSession.setProxy({ mode: sessionRecord.transport.proxyPolicy });
}

function clearWebServiceWindowPartition(partition: string): void {
  const webSession = session.fromPartition(partition);
  void Promise.all([
    webSession.clearStorageData(),
    webSession.clearCache(),
  ]).catch(() => undefined);
}

const WEB_SERVICE_BROWSER_TOOLBAR_HEIGHT = 54;
const WEB_SERVICE_BROWSER_RETRY_FEEDBACK_MS = 600;

function webServiceBrowserDocumentURL(): string {
  const locale = desktopLanguageState().getSnapshot().resolved_locale;
  const i18n = createDesktopI18n(locale);
  return buildWebServiceBrowserDocumentURL({
    locale,
    title: i18n.t('webServiceBrowser.title'),
    addressLabel: i18n.t('webServiceBrowser.addressLabel'),
    addressPlaceholder: i18n.t('webServiceBrowser.addressPlaceholder'),
    backLabel: i18n.t('webServiceBrowser.back'),
    forwardLabel: i18n.t('webServiceBrowser.forward'),
    reloadLabel: i18n.t('webServiceBrowser.reload'),
    stopLabel: i18n.t('webServiceBrowser.stop'),
    navigateLabel: i18n.t('webServiceBrowser.navigate'),
    developerToolsLabel: i18n.t('webServiceBrowser.developerTools'),
    openExternalLabel: i18n.t('webServiceBrowser.openInBrowser'),
    secureRouteLabel: i18n.t('webServiceBrowser.secureRoute'),
  }, desktopThemeState().getSnapshot());
}

function webServiceUnavailableDocumentURL(targetAddress: string): string {
  const locale = desktopLanguageState().getSnapshot().resolved_locale;
  const i18n = createDesktopI18n(locale);
  return buildWebServiceUnavailableDocumentURL({
    locale,
    documentTitle: i18n.t('webServiceBrowser.unavailableDocumentTitle'),
    eyebrow: i18n.t('webServiceBrowser.unavailableEyebrow'),
    title: i18n.t('webServiceBrowser.unavailableTitle'),
    summary: i18n.t('webServiceBrowser.unavailableSummary'),
    targetLabel: i18n.t('webServiceBrowser.unavailableTargetLabel'),
    checksTitle: i18n.t('webServiceBrowser.unavailableChecksTitle'),
    serviceCheck: i18n.t('webServiceBrowser.unavailableServiceCheck'),
    portCheck: i18n.t('webServiceBrowser.unavailablePortCheck'),
    retryLabel: i18n.t('webServiceBrowser.retry'),
    retryingLabel: i18n.t('webServiceBrowser.retrying'),
  }, targetAddress, desktopThemeState().getSnapshot());
}

function createWebServiceBrowserController(
  sessionRecord: DesktopSessionRecord,
  request: DesktopShellOpenWebServiceWindowRequest,
  partition: string,
): DesktopWebServiceBrowserController {
  let errorMessage = '';
  let pendingExternalURL = '';
  let requestedURL = request.url;
  let unavailableRequestURL = '';
  let unavailablePageURL = '';
  let loadingUnavailablePage = false;
  const webSession = session.fromPartition(partition);
  const targetAddress = new URL(request.target_url).origin;
  const windowRecord = createBrowserWindow({
    targetURL: webServiceBrowserDocumentURL(),
    stateKey: sessionWebServiceWindowStateKey(sessionRecord.session_key, request.forward_id),
    role: 'web_service_child',
    diagnostics: sessionRecord.diagnostics,
    chrome: 'native',
    preload: 'web_service_browser',
    stealAppFocus: true,
    onClosed: (closedWindow) => {
      webServiceBrowserByToolbarWebContentsID.delete(closedWindow.webContentsID);
      sessionKeyByWebContentsID.delete(closedWindow.webContentsID);
      const current = sessionRecord.web_service_windows.get(request.forward_id);
      if (current?.webContentsID !== closedWindow.webContentsID) return;
      sessionRecord.web_service_windows.delete(request.forward_id);
      webSession.webRequest.onHeadersReceived(null);
      if (!contentView.webContents.isDestroyed()) contentView.webContents.close();
      clearWebServiceWindowPartition(partition);
    },
  });
  const win = windowRecord.browserWindow;
  const contentView = new WebContentsView({
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.contentView.addChildView(contentView);

  const layoutContent = (): void => {
    if (win.isDestroyed() || contentView.webContents.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    contentView.setBounds({
      x: 0,
      y: WEB_SERVICE_BROWSER_TOOLBAR_HEIGHT,
      width: Math.max(1, width),
      height: Math.max(1, height - WEB_SERVICE_BROWSER_TOOLBAR_HEIGHT),
    });
  };
  win.on('resize', layoutContent);
  layoutContent();

  const snapshot = (): DesktopWebServiceBrowserState => {
    const contents = contentView.webContents;
    const routeAddress = unavailableRequestURL || requestedURL;
    const address = webServiceBrowserDisplayURL(routeAddress, request.target_url, request.forward_id)
      ?? targetAddress + '/';
    const title = contents.isDestroyed() ? '' : contents.getTitle();
    return {
      address,
      title,
      loading: !contents.isDestroyed() && contents.isLoading(),
      can_go_back: !contents.isDestroyed() && contents.navigationHistory.canGoBack(),
      can_go_forward: !contents.isDestroyed() && contents.navigationHistory.canGoForward(),
      devtools_open: !contents.isDestroyed() && contents.isDevToolsOpened(),
      ...(errorMessage ? { error_message: errorMessage } : {}),
    };
  };
  const publishState = (): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL, snapshot());
  };
  const loadRequestedURL = (targetURL: string): void => {
    requestedURL = targetURL;
    unavailableRequestURL = '';
    unavailablePageURL = '';
    loadingUnavailablePage = false;
    errorMessage = '';
    pendingExternalURL = '';
    publishState();
    void contentView.webContents.loadURL(targetURL);
  };
  const navigate = (address: string): DesktopWebServiceBrowserActionResponse => {
    const currentURL = unavailableRequestURL || requestedURL || request.url;
    const targetURL = resolveWebServiceBrowserAddress(
      address,
      currentURL,
      request.target_url,
      sessionRecord.allowed_base_url,
      request.forward_id,
    );
    if (!targetURL) {
      return {
        ok: false,
        message: createDesktopI18n(desktopLanguageState().getSnapshot().resolved_locale)
          .t('webServiceBrowser.invalidAddress'),
      };
    }
    loadRequestedURL(targetURL);
    return { ok: true };
  };
  const toggleDevTools = (): void => {
    if (contentView.webContents.isDevToolsOpened()) {
      contentView.webContents.closeDevTools();
    } else {
      contentView.webContents.openDevTools({ mode: 'detach' });
    }
    publishState();
  };
  const refreshTheme = (): void => {
    if (win.isDestroyed()) return;
    void win.loadURL(webServiceBrowserDocumentURL());
    if (!unavailablePageURL || contentView.webContents.isDestroyed()) return;
    unavailablePageURL = webServiceUnavailableDocumentURL(targetAddress);
    loadingUnavailablePage = true;
    void contentView.webContents.loadURL(unavailablePageURL);
  };
  const perform = async (action: DesktopWebServiceBrowserAction): Promise<DesktopWebServiceBrowserActionResponse> => {
    if (contentView.webContents.isDestroyed()) {
      return { ok: false, message: DESKTOP_STALE_WINDOW_MESSAGE };
    }
    switch (action.action) {
      case 'navigate':
        return navigate(action.address);
      case 'back':
        if (contentView.webContents.navigationHistory.canGoBack()) {
          contentView.webContents.navigationHistory.goBack();
        }
        return { ok: true };
      case 'forward':
        if (contentView.webContents.navigationHistory.canGoForward()) {
          contentView.webContents.navigationHistory.goForward();
        }
        return { ok: true };
      case 'reload':
        if (unavailableRequestURL) loadRequestedURL(unavailableRequestURL);
        else contentView.webContents.reload();
        return { ok: true };
      case 'stop':
        contentView.webContents.stop();
        publishState();
        return { ok: true };
      case 'toggle_devtools':
        toggleDevTools();
        return { ok: true };
      case 'open_external': {
        const targetURL = pendingExternalURL || unavailableRequestURL || requestedURL || request.url;
        try {
          await openExternalURL(targetURL);
          pendingExternalURL = '';
          errorMessage = '';
          publishState();
          return { ok: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errorMessage = message;
          publishState();
          return { ok: false, message };
        }
      }
    }
  };

  const allowTargetNavigation = (targetURL: string): boolean => (
    isAllowedWebServiceWindowNavigation(targetURL, sessionRecord.allowed_base_url, request.forward_id)
  );
  const markRequestedNavigation = (targetURL: string): void => {
    requestedURL = targetURL;
    unavailableRequestURL = '';
    unavailablePageURL = '';
    loadingUnavailablePage = false;
  };
  const blockExternalNavigation = (targetURL: string): void => {
    try {
      const parsed = new URL(targetURL);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') pendingExternalURL = parsed.toString();
    } catch {
      // Invalid targets remain blocked and cannot replace the last reviewable URL.
    }
  };
  contentView.webContents.setWindowOpenHandler(({ url }) => {
    if (allowTargetNavigation(url)) {
      markRequestedNavigation(url);
      void contentView.webContents.loadURL(url);
    }
    else blockExternalNavigation(url);
    return { action: 'deny' };
  });
  contentView.webContents.on('will-navigate', (event, targetURL) => {
    if (targetURL === unavailablePageURL) return;
    if (allowTargetNavigation(targetURL)) {
      markRequestedNavigation(targetURL);
      return;
    }
    event.preventDefault();
    blockExternalNavigation(targetURL);
  });
  contentView.webContents.on('will-redirect', (event, targetURL) => {
    if (allowTargetNavigation(targetURL)) {
      markRequestedNavigation(targetURL);
      return;
    }
    event.preventDefault();
    blockExternalNavigation(targetURL);
  });
  contentView.webContents.on('did-start-loading', () => {
    pendingExternalURL = '';
    errorMessage = '';
    if (!loadingUnavailablePage) {
      unavailableRequestURL = '';
      unavailablePageURL = '';
    }
    publishState();
  });
  contentView.webContents.on('did-stop-loading', publishState);
  contentView.webContents.on('did-navigate', (_event, targetURL) => {
    if (targetURL === unavailablePageURL) loadingUnavailablePage = false;
    else requestedURL = targetURL;
    publishState();
  });
  contentView.webContents.on('did-navigate-in-page', (_event, targetURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (unavailablePageURL && targetURL === `${unavailablePageURL}#retry`) {
      const retryPageURL = unavailablePageURL;
      const retryRequestURL = unavailableRequestURL || requestedURL;
      setTimeout(() => {
        if (win.isDestroyed() || contentView.webContents.isDestroyed()) return;
        if (unavailablePageURL !== retryPageURL) return;
        if (contentView.webContents.getURL() !== `${retryPageURL}#retry`) return;
        loadRequestedURL(retryRequestURL);
      }, WEB_SERVICE_BROWSER_RETRY_FEEDBACK_MS);
      return;
    }
    requestedURL = targetURL;
    publishState();
  });
  contentView.webContents.on('page-title-updated', (_event, title) => {
    const cleanTitle = compact(title);
    const browserTitle = createDesktopI18n(desktopLanguageState().getSnapshot().resolved_locale)
      .t('webServiceBrowser.title');
    win.setTitle(cleanTitle ? `${cleanTitle} - ${browserTitle}` : browserTitle);
    publishState();
  });
  contentView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    errorMessage = compact(errorDescription)
      || createDesktopI18n(desktopLanguageState().getSnapshot().resolved_locale).t('webServiceBrowser.loadFailed');
    publishState();
  });
  contentView.webContents.on('devtools-opened', publishState);
  contentView.webContents.on('devtools-closed', publishState);

  const handleDevToolsShortcut = (event: Electron.Event, input: Electron.Input): void => {
    if (!isWebServiceBrowserDevToolsShortcut(input)) return;
    event.preventDefault();
    toggleDevTools();
  };
  win.webContents.on('before-input-event', handleDevToolsShortcut);
  contentView.webContents.on('before-input-event', handleDevToolsShortcut);

  webSession.webRequest.onHeadersReceived((details, callback) => {
    const isTargetDocument = details.webContentsId !== undefined
      && electronWebContents.fromId(details.webContentsId) === contentView.webContents;
    if (!isTargetDocument || !isMarkedWebServiceUpstreamUnavailable(details)) {
      callback({});
      return;
    }
    const failedRequestURL = requestedURL;
    callback({ cancel: true });
    setImmediate(() => {
      if (win.isDestroyed() || contentView.webContents.isDestroyed()) return;
      unavailableRequestURL = failedRequestURL;
      unavailablePageURL = webServiceUnavailableDocumentURL(targetAddress);
      loadingUnavailablePage = true;
      pendingExternalURL = '';
      errorMessage = '';
      publishState();
      void contentView.webContents.loadURL(unavailablePageURL);
    });
  });

  const controller: DesktopWebServiceBrowserController = {
    windowRecord,
    contentView,
    navigate,
    perform,
    refreshTheme,
    snapshot,
  };
  webServiceBrowserByToolbarWebContentsID.set(windowRecord.webContentsID, controller);
  void contentView.webContents.loadURL(request.url);
  return controller;
}

async function openWebServiceWindowFromShell(
  sessionRecord: DesktopSessionRecord | null,
  request: DesktopShellOpenWebServiceWindowRequest,
): Promise<DesktopShellOpenWebServiceWindowResponse> {
  if (!sessionRecord || sessionRecord.closing) {
    return { ok: false, message: DESKTOP_STALE_WINDOW_MESSAGE };
  }
  if (!isAllowedWebServiceWindowNavigation(request.url, sessionRecord.allowed_base_url, request.forward_id)) {
    return {
      ok: false,
      message: 'Desktop refused to open a Web Service window outside this environment session.',
    };
  }

  const existing = sessionRecord.web_service_windows.get(request.forward_id);
  const existingWindow = liveTrackedBrowserWindow(existing);
  if (existing && existingWindow) {
    webServiceBrowserByToolbarWebContentsID.get(existing.webContentsID)?.navigate(request.url);
    presentAppWindow(existingWindow, { stealAppFocus: true });
    return { ok: true };
  }
  if (existing) {
    sessionRecord.web_service_windows.delete(request.forward_id);
    sessionKeyByWebContentsID.delete(existing.webContentsID);
  }

  const partition = sessionWebServicePartition(sessionRecord.session_key, request.forward_id);
  try {
    await prepareWebServiceWindowPartition(sessionRecord, partition);
  } catch {
    return {
      ok: false,
      message: 'Desktop could not prepare the isolated Web Service network session.',
    };
  }
  if (sessionRecord.closing || sessionsByKey.get(sessionRecord.session_key) !== sessionRecord) {
    return { ok: false, message: DESKTOP_STALE_WINDOW_MESSAGE };
  }

  const preparedExisting = sessionRecord.web_service_windows.get(request.forward_id);
  const preparedExistingWindow = liveTrackedBrowserWindow(preparedExisting);
  if (preparedExisting && preparedExistingWindow) {
    webServiceBrowserByToolbarWebContentsID.get(preparedExisting.webContentsID)?.navigate(request.url);
    presentAppWindow(preparedExistingWindow, { stealAppFocus: true });
    return { ok: true };
  }
  if (preparedExisting) {
    sessionRecord.web_service_windows.delete(request.forward_id);
    sessionKeyByWebContentsID.delete(preparedExisting.webContentsID);
  }

  const controller = createWebServiceBrowserController(sessionRecord, request, partition);
  const { windowRecord } = controller;
  sessionRecord.web_service_windows.set(request.forward_id, windowRecord);
  sessionKeyByWebContentsID.set(windowRecord.webContentsID, sessionRecord.session_key);
  return { ok: true };
}

function sessionOpenFailureMessage(targetURL: string, errorDescription: string): string {
  const cleanDescription = compact(errorDescription);
  if (cleanDescription !== '') {
    return `Desktop could not finish opening ${targetURL}: ${cleanDescription}`;
  }
  return `Desktop could not finish opening ${targetURL}.`;
}

function localDesktopTransportFailure(
  targetLabel: string,
  technicalDetail: string,
  diagnostics: DesktopOperationFailurePresentation['diagnostics'] = [],
): DesktopOperationFailureError {
  const detail = compact(technicalDetail);
  return new DesktopOperationFailureError(desktopOperationFailurePresentation({
    code: 'environment_open_failed',
    title: 'Environment Open Failed',
    titleKey: 'progress.environmentOpenFailedTitle',
    summary: `Desktop could not open "${targetLabel}".`,
    summaryKey: 'progress.environmentOpenFailedSummary',
    detail: detail || 'Desktop protected local transport did not return a usable Environment App page.',
    detailKey: 'progress.environmentOpenLocalTransportDetail',
    recoveryHint: 'Restart the Runtime, then try again. VPN, Tailscale, and proxy software can remain enabled.',
    recoveryHintKey: 'progress.environmentOpenLocalTransportRecoveryHint',
    targetLabel,
    diagnostics,
  }));
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

function resolveSessionInitialLoadWhenReady(sessionRecord: DesktopSessionRecord): void {
  if (!sessionRecord.env_app_ready || !sessionRecord.desktop_model_source_settled) {
    return;
  }
  resolveSessionInitialLoadSuccess(sessionRecord, {
    stealAppFocus: sessionRecord.steal_app_focus_on_ready,
  });
}

function normalizeSessionReadyTiming(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 && numberValue <= 300_000
    ? Math.round(numberValue)
    : undefined;
}

function normalizeDesktopSessionAppReadyPayload(value: unknown): DesktopSessionAppReadyPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const state = String((value as Partial<DesktopSessionAppReadyPayload>).state ?? '').trim();
  if (state !== 'access_gate_interactive' && state !== 'runtime_connected') {
    return null;
  }
  const rawTimings = (value as Partial<DesktopSessionAppReadyPayload>).timings;
  const timings = rawTimings && typeof rawTimings === 'object'
    ? {
        bootstrap_ms: normalizeSessionReadyTiming(rawTimings.bootstrap_ms),
        access_ready_ms: normalizeSessionReadyTiming(rawTimings.access_ready_ms),
        protocol_connected_ms: normalizeSessionReadyTiming(rawTimings.protocol_connected_ms),
        shell_painted_ms: normalizeSessionReadyTiming(rawTimings.shell_painted_ms),
      }
    : {};
  const compactTimings = Object.fromEntries(Object.entries(timings).filter(([, timing]) => timing !== undefined));
  return {
    state,
    ...(Object.keys(compactTimings).length > 0 ? { timings: compactTimings } : {}),
  };
}

function desktopSessionContextSnapshot(sessionRecord: DesktopSessionRecord | null): DesktopSessionContextSnapshot | null {
  return desktopSessionContextSnapshotFromTarget(sessionRecord?.target ?? null, sessionRecord?.startup.exposure);
}

function sendSessionTransportRecoverySnapshot(sessionRecord: DesktopSessionRecord): void {
  const window = liveTrackedBrowserWindow(sessionRecord.root_window);
  if (!window || !sessionRecord.transport_recovery_snapshot) {
    return;
  }
  window.webContents.send(
    DESKTOP_SESSION_TRANSPORT_RECOVERY_UPDATED_CHANNEL,
    sessionRecord.transport_recovery_snapshot,
  );
}

function attachSessionTransportRecovery(
  sessionRecord: DesktopSessionRecord,
  bridgeSession: RuntimePlacementBridgeSession,
): void {
  sessionRecord.unsubscribe_transport_recovery?.();
  sessionRecord.transport_recovery_session = bridgeSession;
  sessionRecord.transport_recovery_snapshot = bridgeSession.getRecoverySnapshot();
  sessionRecord.unsubscribe_transport_recovery = bridgeSession.subscribeRecovery((snapshot) => {
    if (sessionRecord.transport_recovery_session !== bridgeSession || sessionRecord.closing) {
      return;
    }
    const current = sessionRecord.transport_recovery_snapshot;
    if (
      current
      && (
        snapshot.generation < current.generation
        || (snapshot.generation === current.generation && snapshot.revision <= current.revision)
      )
    ) {
      return;
    }
    sessionRecord.transport_recovery_snapshot = snapshot;
    sendSessionTransportRecoverySnapshot(sessionRecord);
  });
}

function sessionTransportRecoveryFailed(sessionRecord: DesktopSessionRecord): boolean {
  return sessionRecord.transport_recovery_snapshot?.phase === 'failed';
}

function markSessionAppReady(
  sessionRecord: DesktopSessionRecord,
  payload: DesktopSessionAppReadyPayload,
): void {
  if (sessionRecord.lifecycle !== 'opening') {
    return;
  }
  sessionRecord.app_ready_state = payload.state;
  sessionRecord.app_ready_timings = payload.timings;
  sessionRecord.env_app_ready = true;
  void sessionRecord.diagnostics.recordLifecycle(
    'session_app_ready',
    payload.state === 'runtime_connected'
      ? 'Env App runtime protocol connected.'
      : 'Env App access gate is interactive.',
    { state: payload.state, ...(payload.timings ?? {}) },
  );
  resolveSessionInitialLoadWhenReady(sessionRecord);
}

function markSessionDesktopModelSourceSettled(sessionRecord: DesktopSessionRecord): void {
  if (sessionRecord.lifecycle !== 'opening' || sessionRecord.desktop_model_source_settled) {
    return;
  }
  sessionRecord.desktop_model_source_settled = true;
  sessionRecord.desktop_model_source_settled_at_unix_ms = Date.now();
  void sessionRecord.diagnostics.recordLifecycle(
    'session_desktop_model_source_settled',
    'Desktop model source startup settled.',
  );
  resolveSessionInitialLoadWhenReady(sessionRecord);
}

async function failOpeningSession(
  sessionRecord: DesktopSessionRecord,
  failure: string | Error,
): Promise<void> {
  if (sessionRecord.lifecycle !== 'opening') {
    return;
  }
  const error = failure instanceof Error
    ? failure
    : new Error(compact(failure) || 'Desktop could not open that environment window.');
  console.warn('[redeven:desktop-session] session open failed', {
    session_key: sessionRecord.session_key,
    target: sessionRecord.target.label,
    error: compact(error.message),
  });
  sessionRecord.initial_load_failure_message = compact(error.message) || 'Desktop could not open that environment window.';
  const reject = sessionRecord.reject_initial_load;
  sessionRecord.resolve_initial_load = null;
  sessionRecord.reject_initial_load = null;
  reject?.(error);
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

function elapsedSince(startedAtUnixMS: number, completedAtUnixMS: number | undefined): number | undefined {
  return completedAtUnixMS === undefined ? undefined : Math.max(0, completedAtUnixMS - startedAtUnixMS);
}

function recordEnvironmentOpenTiming(
  sessionRecord: DesktopSessionRecord,
  operation: DesktopLauncherOperationSnapshot | null,
  detail: Readonly<{
    runtime_probe_duration_ms?: number;
    bridge_proxy_duration_ms?: number;
    desktop_model_source_duration_ms?: number;
  }> = {},
): void {
  const startedAt = sessionRecord.open_started_at_unix_ms;
  const rendererTimings = sessionRecord.app_ready_timings ?? {};
  void sessionRecord.diagnostics.recordLifecycle(
    'environment_open_timing',
    'Environment window became fully usable.',
    {
      total_duration_ms: Math.max(0, Date.now() - startedAt),
      ...(detail.runtime_probe_duration_ms !== undefined ? { runtime_probe_duration_ms: detail.runtime_probe_duration_ms } : {}),
      ...(detail.bridge_proxy_duration_ms !== undefined ? { bridge_proxy_duration_ms: detail.bridge_proxy_duration_ms } : {}),
      ...(detail.desktop_model_source_duration_ms !== undefined ? { desktop_model_source_duration_ms: detail.desktop_model_source_duration_ms } : {}),
      window_created_ms: elapsedSince(startedAt, sessionRecord.window_created_at_unix_ms),
      document_loaded_ms: elapsedSince(startedAt, sessionRecord.document_loaded_at_unix_ms),
      desktop_model_source_settled_ms: elapsedSince(startedAt, sessionRecord.desktop_model_source_settled_at_unix_ms),
      app_ready_state: sessionRecord.app_ready_state,
      ...rendererTimings,
      launcher_phases: operation?.open_timing?.completed_phases.map((phase) => ({
        phase: phase.phase,
        started_ms: Math.max(0, phase.started_at_unix_ms - startedAt),
        duration_ms: phase.duration_ms,
      })) ?? [],
    },
  );
}

function createSessionRootWindow(
  sessionKey: DesktopSessionKey,
  targetURL: string,
  diagnostics: DesktopDiagnosticsRecorder,
  options?: Readonly<{
    stealAppFocus?: boolean;
    sessionPartition?: string;
    presentOnReadyToShow?: boolean;
    deferInitialLoad?: boolean;
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
    sessionPartition: options?.sessionPartition,
    presentOnReadyToShow: options?.presentOnReadyToShow,
    deferInitialLoad: options?.deferInitialLoad,
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

async function prepareDesktopSessionTransport(transport: DesktopSessionTransport): Promise<void> {
  if (transport.proxyPolicy !== 'direct') {
    installDesktopDiagnosticsHooks(session.defaultSession);
    return;
  }
  let task = directDesktopSessionTasks.get(transport.partition);
  if (!task) {
    task = (async () => {
      const webSession = session.fromPartition(transport.partition);
      installDesktopDiagnosticsHooks(webSession);
      await webSession.setProxy({ mode: 'direct' });
      return webSession;
    })();
    directDesktopSessionTasks.set(transport.partition, task);
    void task.catch(() => {
      if (directDesktopSessionTasks.get(transport.partition) === task) {
        directDesktopSessionTasks.delete(transport.partition);
      }
    });
  }
  await task;
}

async function releaseDesktopSessionTransport(transport: DesktopSessionTransport): Promise<void> {
  if (transport.proxyPolicy !== 'direct') {
    return;
  }
  const task = directDesktopSessionTasks.get(transport.partition);
  directDesktopSessionTasks.delete(transport.partition);
  const webSession = await (task ?? Promise.resolve(session.fromPartition(transport.partition))).catch(() => null);
  if (webSession) {
    await webSession.clearStorageData().catch(() => undefined);
  }
}

async function createSessionRecord(
  target: DesktopSessionTarget,
  startup: StartupReport,
  options: Readonly<{
    runtimeHandle?: DesktopSessionRuntimeHandle | null;
    attached?: boolean;
    stealAppFocus?: boolean;
    desktopModelSourceSettled?: boolean;
    openStartedAtUnixMS?: number;
    runtimeLifecycleGenerationIdentityKeys?: readonly string[];
    runtimeLifecycleGenerationSnapshot?: string;
    transportRecovery?: RuntimePlacementBridgeSession | null;
  }> = {},
): Promise<DesktopSessionRecord> {
  const assertRuntimeLifecycleGenerationUnchanged = (): void => {
    const currentGeneration = runtimeLifecycleGenerationSnapshot(
      options.runtimeLifecycleGenerationIdentityKeys ?? runtimeLifecycleIdentityKeysForTarget(target),
    );
    if (
      options.runtimeLifecycleGenerationSnapshot !== undefined
      && currentGeneration !== options.runtimeLifecycleGenerationSnapshot
    ) {
      console.warn('[redeven:desktop-session] session open canceled by lifecycle generation', {
        session_key: target.session_key,
        target: target.label,
        expected_generation: options.runtimeLifecycleGenerationSnapshot,
        current_generation: currentGeneration,
      });
      throw new Error('Desktop canceled this Environment Open because Runtime maintenance started.');
    }
  };
  assertRuntimeLifecycleGenerationUnchanged();
  let transport: DesktopSessionTransport;
  try {
    transport = resolveDesktopSessionTransport(target, startup, {
      placementBridge: options.transportRecovery != null,
    });
  } catch (error) {
    if (target.kind === 'local_environment' && target.route === 'local_host') {
      const message = error instanceof Error ? error.message : String(error);
      throw localDesktopTransportFailure(target.label, message, [
        {
          channel: 'transport',
          label: 'Transport',
          text: 'native_local_bridge',
        },
        { channel: 'proxy_policy', label: 'Proxy policy', text: 'direct' },
        { channel: 'transport_contract', label: 'Transport contract', text: compact(message) || 'invalid trusted bridge state' },
      ]);
    }
    throw error;
  }
  await prepareDesktopSessionTransport(transport);
  assertRuntimeLifecycleGenerationUnchanged();
  const diagnostics = new DesktopDiagnosticsRecorder();
  await diagnostics.configureRuntime(startup, transport.allowedBaseURL, {
    stateDirOverride: desktopDiagnosticsStateDirForTarget(target, startup),
  });
  const entryURL = transport.entryURL;
  const safeEntryURL = stripSensitiveURLPayload(entryURL) || entryURL;
  const safeAllowedBaseURL = stripSensitiveURLPayload(transport.allowedBaseURL) || transport.allowedBaseURL;
  const safeDisplayURL = stripSensitiveURLPayload(transport.displayURL) || startup.local_ui_url;
  const sessionPartition = transport.partition;
  const initialLoad = createInitialLoadDeferred();
  let sessionRecord!: DesktopSessionRecord;
  assertRuntimeLifecycleGenerationUnchanged();
  const rootWindow = createSessionRootWindow(target.session_key, entryURL, diagnostics, {
    stealAppFocus: options.stealAppFocus,
    sessionPartition,
    // A password-protected external target must expose its unlock gate before
    // the renderer can report app readiness; keeping it hidden would deadlock
    // the open action while the user is waiting for the password form.
    presentOnReadyToShow: startup.password_required === true,
    deferInitialLoad: true,
    onDidFinishLoad: () => {
      sessionRecord.document_loaded_at_unix_ms = Date.now();
      void sessionRecord.diagnostics.recordLifecycle(
        'session_document_loaded',
        'Session document finished loading; waiting for Env App readiness.',
      );
    },
    onDidFailLoad: (details) => {
      if (!details.isMainFrame) {
        return;
      }
      console.warn('[redeven:desktop-session] session document failed to load', {
        session_key: target.session_key,
        target: target.label,
        error_code: details.errorCode,
        error: details.errorDescription,
        url: stripSensitiveURLPayload(details.validatedURL) || safeEntryURL,
      });
      if (transport.proxyPolicy === 'direct') {
        void failOpeningSession(
          sessionRecord,
          localDesktopTransportFailure(target.label, details.errorDescription, [
            {
              channel: 'transport',
              label: 'Transport',
              text: transport.kind,
            },
            {
              channel: 'proxy_policy',
              label: 'Proxy policy',
              text: transport.proxyPolicy,
            },
            { channel: 'chromium_error', label: 'Chromium error', text: `${details.errorCode}: ${details.errorDescription}` },
          ]),
        );
        return;
      }
      void failOpeningSession(
        sessionRecord,
        sessionOpenFailureMessage(stripSensitiveURLPayload(details.validatedURL) || safeEntryURL, details.errorDescription),
      );
    },
  });
  sessionRecord = {
    session_key: target.session_key,
    target,
    startup,
    transport,
    entry_url: entryURL,
    display_url: transport.displayURL,
    allowed_base_url: safeAllowedBaseURL,
    root_window: rootWindow,
    child_windows: new Map(),
    codespace_windows: new Map(),
    web_service_windows: new Map(),
    codespace_loading_documents: new Map(),
    session_partition: sessionPartition,
    diagnostics,
    runtime_handle: options.runtimeHandle ?? null,
    transport_recovery_session: null,
    transport_recovery_snapshot: options.transportRecovery?.getRecoverySnapshot() ?? null,
    unsubscribe_transport_recovery: null,
    steal_app_focus_on_ready: options.stealAppFocus === true,
    lifecycle: 'opening',
    initial_load_completion: initialLoad.promise,
    resolve_initial_load: initialLoad.resolve,
    reject_initial_load: initialLoad.reject,
    app_ready_state: '',
    env_app_ready: false,
    desktop_model_source_settled: options.desktopModelSourceSettled !== false,
    open_started_at_unix_ms: options.openStartedAtUnixMS ?? Date.now(),
    window_created_at_unix_ms: Date.now(),
    ...(options.desktopModelSourceSettled !== false ? { desktop_model_source_settled_at_unix_ms: Date.now() } : {}),
    initial_load_failure_message: '',
    closing: false,
  };

  sessionsByKey.set(target.session_key, sessionRecord);
  sessionKeyByWebContentsID.set(rootWindow.webContentsID, target.session_key);
  void rootWindow.browserWindow.loadURL(entryURL);
  if (options.transportRecovery) {
    attachSessionTransportRecovery(sessionRecord, options.transportRecovery);
  }
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
        : target.kind === 'gateway_environment'
          ? 'gateway_environment_connected'
        : 'external_target_connected',
    target.kind === 'local_environment'
      ? options.attached === true
        ? target.local_environment_kind === 'controlplane'
          ? 'desktop attached to an existing Provider environment runtime'
          : 'desktop attached to an existing Local Environment runtime'
        : target.local_environment_kind === 'controlplane'
          ? 'desktop opened a Provider environment session'
          : 'desktop opened a Local Environment session'
      : target.kind === 'ssh_environment'
        ? 'desktop opened an SSH-bootstrapped environment session'
        : target.kind === 'gateway_environment'
          ? 'desktop opened an environment session through a Gateway'
        : 'desktop connected to an external Redeven Local UI target',
    {
      target_url: safeDisplayURL,
      transport_kind: transport.kind,
      proxy_policy: transport.proxyPolicy,
      attached: options.attached === true,
      effective_run_mode: startup.effective_run_mode ?? '',
    },
  );
  broadcastDesktopWelcomeSnapshots();
  return sessionRecord;
}

async function finalizeSessionClosure(
  sessionKey: DesktopSessionKey,
  options: Readonly<{
    closeWindows?: boolean;
    reason?: 'runtime_start' | 'runtime_stop' | 'runtime_restart' | 'runtime_update';
  }> = {},
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
    sessionRecord.unsubscribe_transport_recovery?.();
    sessionRecord.unsubscribe_transport_recovery = null;
    sessionRecord.transport_recovery_session = null;
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

    for (const codespaceWindow of sessionRecord.codespace_windows.values()) {
      sessionKeyByWebContentsID.delete(codespaceWindow.webContentsID);
      const browserWindow = liveTrackedBrowserWindow(codespaceWindow);
      if (options.closeWindows !== false && browserWindow) {
        browserWindow.destroy();
      }
    }
    sessionRecord.codespace_windows.clear();
    sessionRecord.codespace_loading_documents.clear();

    for (const [forwardID, webServiceWindow] of sessionRecord.web_service_windows) {
      sessionKeyByWebContentsID.delete(webServiceWindow.webContentsID);
      const browserWindow = liveTrackedBrowserWindow(webServiceWindow);
      if (options.closeWindows !== false && browserWindow) browserWindow.destroy();
      clearWebServiceWindowPartition(sessionWebServicePartition(sessionKey, forwardID));
    }
    sessionRecord.web_service_windows.clear();

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
        reason: options.reason ?? 'window_closed',
      },
    );

    const bridgeRecord = runtimePlacementBridgeRegistry.values().find((record) => (
      desktopSessionKeyFromRuntimeTargetID(record.session.placement_target_id) === sessionKey
    )) ?? null;
    if (bridgeRecord) {
      await runtimePlacementBridgeRegistry.retire(bridgeRecord.session.placement_target_id).catch(() => undefined);
    }

    sessionRecord.runtime_handle = null;
    sessionRecord.diagnostics.clearRuntime();
    await releaseDesktopSessionTransport(sessionRecord.transport);
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
    updateGatewaySyncPoller();
    updateWelcomeRuntimePoller();
    if (kind === 'launcher') {
      void syncVisibleControlPlanesIfNeeded();
      void syncVisibleGatewaysIfNeeded();
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
      updateGatewaySyncPoller();
      updateWelcomeRuntimePoller();
    },
  });

  utilityWindows.set(kind, win);
  utilityWindowKindByWebContentsID.set(win.webContentsID, kind);
  if (kind === 'launcher') {
    win.browserWindow.on('focus', () => {
      void syncVisibleControlPlanesIfNeeded();
      void syncVisibleGatewaysIfNeeded();
    });
  }
  updateControlPlaneSyncPoller();
  updateGatewaySyncPoller();
  updateWelcomeRuntimePoller();
  if (kind === 'launcher') {
    void syncVisibleControlPlanesIfNeeded();
    void syncVisibleGatewaysIfNeeded();
    void pollWelcomeRuntimeState();
  }
  return launcherActionSuccess('opened_utility_window', {
    utilityWindowKind: kind,
  });
}

async function openDesktopWelcomeWindow(options: OpenDesktopWelcomeOptions = {}): Promise<void> {
  await openUtilityWindow('launcher', options);
}

async function autoStartLocalRuntimeOnDesktopLaunch(loadedPreferences?: DesktopPreferences): Promise<void> {
  if (!desktopAutoStartRuntimeEnabled()) {
    return;
  }
  try {
    const preferences = loadedPreferences ?? await loadDesktopPreferencesCached();
    const environment = preferences.local_environment;
    const placement = localHostRuntimeLifecyclePlacement(environment);
    const result = await runEnvironmentRuntimeLifecycleFromLauncher({
      kind: 'start_environment_runtime',
      environment_id: environment.id,
      label: environment.label,
      runtime_target_id: desktopRuntimeTargetID({ kind: 'local_host' }, placement, environment.id),
      host_access: { kind: 'local_host' },
      placement,
      operation_key: `${environment.id}:auto_start`,
    });
    const repaired = result.ok ? result : await runEnvironmentRuntimeLifecycleFromLauncher({
      kind: 'update_environment_runtime',
      environment_id: environment.id,
      label: environment.label,
      runtime_target_id: desktopRuntimeTargetID({ kind: 'local_host' }, placement, environment.id),
      host_access: { kind: 'local_host' },
      placement,
      force_runtime_update: true,
      operation_key: `${environment.id}:auto_repair`,
    });
    if (!repaired.ok) {
      throw new DesktopOperationFailureError(repaired.failure ?? desktopOperationFailurePresentation({
          code: 'local_runtime_launch_failed',
          title: 'Local Environment startup failed',
          summary: repaired.message,
          targetLabel: environment.label,
        }));
    }
    await refreshWelcomeRuntimeHealthForEnvironment(environment.id, { force: true });
    resetLauncherIssueState();
    broadcastDesktopWelcomeSnapshots();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const structuredFailure = isDesktopOperationFailureError(error) ? error.presentation : undefined;
    const diagnosticLines = (structuredFailure?.diagnostics ?? []).flatMap((diagnostic) => [
      `${diagnostic.channel}:`,
      diagnostic.text,
    ]);
    const reinstallRequired = structuredFailure?.code === 'reinstall_required';
    console.warn(`[redeven:desktop-startup] Local runtime auto-start failed: ${message}`);
    const preferences = await loadDesktopPreferencesCached().catch(() => null);
    if (reinstallRequired && preferences) {
      await markReinstallTargetRequired(preferences.local_environment.id, {
        gatewayID: '',
        reason: message,
      });
    }
    setLauncherViewState({
      surface: 'connect_environment',
      entryReason: reinstallRequired ? 'blocked' : 'app_launch',
      issue: {
        scope: reinstallRequired ? 'local_environment' : 'startup',
        code: reinstallRequired ? 'needs_reinstall' : structuredFailure?.code ?? 'local_environment_startup_failed',
        title: reinstallRequired
          ? 'Local Environment reinstall required'
          : 'Local Environment startup failed',
        title_key: reinstallRequired
          ? 'confirm.reinstallTargetTitle'
          : 'issue.startupFailedTitle',
        message: reinstallRequired
          ? 'This Local Environment has incompatible state. Reinstall is the only safe recovery.'
          : 'Redeven could not start this environment. Try again.',
        message_key: reinstallRequired
          ? 'confirm.reinstallRequiredDescription'
          : 'environmentOpenFlow.startFailedDetail',
        diagnostics_copy: [
          'status: blocked',
          `code: ${structuredFailure?.code ?? 'local_environment_startup_failed'}`,
          `message: ${message}`,
          ...diagnosticLines,
        ].join('\n'),
        target_url: '',
        environment_id: preferences?.local_environment.id,
      },
    });
    broadcastDesktopWelcomeSnapshots();
  }
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
    const result = await probeExternalLocalUIStartup(targetURL);
    if (!result.ok) {
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
    const startup = result.value;
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

type ManagedTargetLaunch = Exclude<Awaited<ReturnType<typeof startManagedRuntime>>, Readonly<{ kind: 'blocked' }>>;

type PreparedManagedTargetResult = Readonly<
  | { ok: true; launch: ManagedTargetLaunch }
  | { ok: false; issue: DesktopWelcomeIssue }
>;

async function prepareManagedEnvironmentRuntime(input: Readonly<{
  environment: DesktopLocalEnvironmentState;
  signal?: AbortSignal;
  local_ui_bind?: string;
  force_runtime_update?: boolean;
  runtime_process_intent?: 'start' | 'restart' | 'update';
  before_runtime_replacement?: () => Promise<void>;
  on_progress?: (progress: ManagedRuntimeProgress) => void;
}>): Promise<PreparedManagedTargetResult> {
  const launchPlan = buildDesktopRuntimeLaunchPlan(input.environment, process.env, {
    localUIBind: input.local_ui_bind,
    bootstrap: null,
  });
  const launch = await startManagedRuntime({
    executablePath: bundledRuntimeExecutablePath(),
    runtimeArgs: launchPlan.args,
    env: launchPlan.env,
    runtimeRoot: launchPlan.state_layout.stateDir,
    stateRoot: launchPlan.state_layout.stateRoot,
    forceRuntimeUpdate: input.force_runtime_update === true,
    runtimeProcessIntent: input.runtime_process_intent,
    beforeRuntimeReplacement: input.before_runtime_replacement,
    startupSecretsStdin: launchPlan.startup_secrets_stdin,
    signal: input.signal,
    tempRoot: app.getPath('temp'),
    onProgress: input.on_progress,
    onLog: (stream, chunk) => {
      const message = compact(chunk);
      if (message) {
        console.log(`[redeven:${stream}] ${message}`);
      }
    },
  });
  if (launch.kind === 'blocked') {
    return {
      ok: false,
      issue: {
        ...buildBlockedLaunchIssue(launch.blocked),
        environment_id: input.environment.id,
      },
    };
  }
  return { ok: true, launch };
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
    runtimeRoot: localEnvironmentRuntimeRoot(environment),
    stateRoot: localEnvironmentStateRoot(),
    runtimeAttachTimeoutMs: DESKTOP_RUNTIME_PROBE_TIMEOUT_MS,
    // Open joins an active lifecycle owner before reaching this path. Without
    // an owner, a live process that has no published status is stale recovery
    // input, not a second startup that Open should poll independently.
    runtimeStartupTimeoutMs: 0,
  });
  if (!attachedRuntime) {
    return null;
  }
  return updateLocalEnvironmentRuntimeRecord(
    environment,
    attachedRuntime.startup,
    desktopSessionRuntimeHandleFromManagedRuntime(attachedRuntime),
  );
}

type RuntimeFlowerRoute = Readonly<{
  path: string | RegExp;
  methods: readonly RuntimeFlowerRequest['method'][];
  allowsQuery?: (parsed: URL) => boolean;
}>;

const runtimeFlowerNoQuery = (parsed: URL): boolean => parsed.search === '';
const runtimeFlowerLimitQuery = (parsed: URL): boolean => parsed.search === '' || /^\?limit=\d{1,4}$/u.test(parsed.search);
const runtimeFlowerSubagentDetailQuery = (parsed: URL): boolean => parsed.search === ''
  || /^\?after_ordinal=\d+$/u.test(parsed.search)
  || /^\?limit=\d{1,4}$/u.test(parsed.search)
  || /^\?after_ordinal=\d+&limit=\d{1,4}$/u.test(parsed.search)
  || /^\?limit=\d{1,4}&after_ordinal=\d+$/u.test(parsed.search);
const runtimeFlowerTerminalReadQuery = (parsed: URL): boolean => {
	const values = parsed.searchParams.getAll('after_seq');
	return [...parsed.searchParams.keys()].every((key) => key === 'after_seq')
		&& values.length === 1
		&& /^\d{1,18}$/u.test(values[0] ?? '');
};
const runtimeFlowerAttachmentCapabilityQuery = (parsed: URL): boolean => {
  const values = parsed.searchParams.getAll('model_id');
  return [...parsed.searchParams.keys()].every((key) => key === 'model_id')
    && values.length === 1
    && values[0]!.trim().length > 0
    && values[0]!.length <= 512;
};
const RUNTIME_FLOWER_ROUTES: readonly RuntimeFlowerRoute[] = [
  { path: '/_redeven_proxy/api/settings', methods: ['GET'] },
  { path: '/_redeven_proxy/api/fs/path_context', methods: ['GET'] },
  { path: '/_redeven_proxy/api/fs/list', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/default_permission', methods: ['PUT'] },
  { path: '/_redeven_proxy/api/ai/provider_bundle', methods: ['PUT'] },
  { path: '/_redeven_proxy/api/ai/current_model', methods: ['PUT'] },
  { path: '/_redeven_proxy/api/ai/models', methods: ['GET'] },
  { path: '/_redeven_proxy/api/ai/turns', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/attachments/capabilities', methods: ['GET'], allowsQuery: runtimeFlowerAttachmentCapabilityQuery },
  { path: '/_redeven_proxy/api/ai/upload-staging-scopes', methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/upload-staging-scopes\/[^/]+$/u, methods: ['DELETE'] },
  { path: '/_redeven_proxy/api/ai/uploads', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/threads', methods: ['GET', 'POST'], allowsQuery: runtimeFlowerLimitQuery },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+$/u, methods: ['GET', 'PATCH'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+$/u, methods: ['DELETE'], allowsQuery: runtimeFlowerDeleteQuery },
  { path: '/_redeven_proxy/api/ai/flower/stream', methods: ['GET'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/subagents\/[^/]+\/detail$/u, methods: ['GET'], allowsQuery: runtimeFlowerSubagentDetailQuery },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/read$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/turns$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/fork$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/input_response$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/approvals$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/queue\/order$/u, methods: ['PATCH'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/queue\/[^/]+$/u, methods: ['DELETE'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/queue\/[^/]+\/promote$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/retry$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/retry_effect$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/cancel$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/runs\/[^/]+\/terminal\/[^/]+\/read$/u, methods: ['GET'], allowsQuery: runtimeFlowerTerminalReadQuery },
  { path: /^\/_redeven_proxy\/api\/ai\/uploads\/[^/]+$/u, methods: ['GET', 'DELETE'] },
  { path: /^\/_redeven_proxy\/api\/ai\/uploads\/[^/]+\/long_text$/u, methods: ['GET'] },
];

function runtimeFlowerRouteMatches(route: RuntimeFlowerRoute, parsed: URL): boolean {
  const pathMatches = typeof route.path === 'string' ? parsed.pathname === route.path : route.path.test(parsed.pathname);
  return pathMatches && (route.allowsQuery ?? runtimeFlowerNoQuery)(parsed);
}

function runtimeFlowerAllowedRoute(parsed: URL): RuntimeFlowerRoute | null {
  return RUNTIME_FLOWER_ROUTES.find((route) => runtimeFlowerRouteMatches(route, parsed)) ?? null;
}

function runtimeFlowerPath(rawPath: unknown): string {
  const raw = compact(rawPath);
  if (!raw.startsWith('/')) {
    throw new Error('Flower runtime request path must be absolute.');
  }
  const parsed = new URL(raw, 'http://runtime-flower.local');
  if (parsed.hash || !runtimeFlowerAllowedRoute(parsed)) {
    throw new Error('Flower runtime request path is not allowed.');
  }
  return `${parsed.pathname}${parsed.search}`;
}

function runtimeFlowerMethodAllowed(path: string, method: RuntimeFlowerRequest['method']): boolean {
  const parsed = new URL(path, 'http://runtime-flower.local');
  const route = runtimeFlowerAllowedRoute(parsed);
  return !!route && route.methods.includes(method);
}

function runtimeFlowerMethod(rawMethod: unknown): RuntimeFlowerRequest['method'] {
  const method = compact(rawMethod).toUpperCase();
  switch (method) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return method;
    default:
      throw new Error('Flower runtime request method is not allowed.');
  }
}

function assertRuntimeFlowerRecordOpenable(record: LocalEnvironmentRuntimeRecord): void {
  if (!runtimeServiceIsOpenable(record.startup.runtime_service)) {
    throw new Error(runtimeServiceOpenReadinessLabel(record.startup.runtime_service) || 'Local Environment is not ready to open Flower.');
  }
}

async function ensureRuntimeFlowerRecord(): Promise<LocalEnvironmentRuntimeRecord> {
  const preferences = await loadDesktopPreferencesCached();
  const environment = preferences.local_environment;
  const attached = await attachLocalEnvironmentRuntime(environment);
  if (attached) {
    const runtimePlan = buildDesktopLocalRuntimeOpenPlan(
      { kind: 'local_environment' },
      attached.startup,
    );
    if (runtimePlan.requires_restart) {
      throw new Error('Initialize this environment before restarting it.');
    }
    if (!runtimePlan.can_open) {
      throw new Error(runtimePlan.message || 'Local Runtime is not ready to open Flower.');
    }
    assertRuntimeFlowerRecordOpenable(attached);
    return attached;
  }
  throw new Error('The local environment is not running. Initialize it before starting it from Desktop.');
}

function runtimeFlowerEnvelopeError(parsed: unknown, status: number): RuntimeFlowerError | null {
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  if (!record || record.ok !== false) {
    return status >= 400 ? runtimeFlowerError('runtime_flower_http_error', `Flower request failed with HTTP ${status}.`, status) : null;
  }
  const rawError = record.error;
  if (rawError && typeof rawError === 'object') {
    const error = rawError as Record<string, unknown>;
    return runtimeFlowerError(
      compact(error.code) || 'runtime_flower_request_failed',
      compact(error.message) || compact(error.redacted_detail) || `Flower request failed with HTTP ${status}.`,
      status,
      runtimeFlowerRetryAfterMs(error.retry_after_ms),
      record.data,
    );
  }
  return runtimeFlowerError(
    compact(record.error_code) || 'runtime_flower_request_failed',
    compact(rawError) || `Flower request failed with HTTP ${status}.`,
    status,
    runtimeFlowerRetryAfterMs(record.retry_after_ms),
    record.data,
  );
}

async function unlockRuntimeFlowerAccess(
  record: LocalEnvironmentRuntimeRecord,
  environment: DesktopLocalEnvironmentState,
): Promise<string> {
  const baseURL = runtimeFlowerBaseURL(record);
  const access = localEnvironmentAccess(environment);
  if (!access.local_ui_password_configured || !compact(access.local_ui_password)) {
    throw new Error('Local Environment requires the configured Local UI password before Flower can open.');
  }
  const response = await runtimeFlowerRequestHTTP(new URL('/api/local/access/unlock', baseURL), {
    method: 'POST',
    path: '/api/local/access/unlock',
    body: { password: access.local_ui_password },
  });
  const parsed = parseRuntimeFlowerJSON(response.body);
  const error = runtimeFlowerEnvelopeError(parsed, response.status);
  if (error || response.status < 200 || response.status >= 300) {
    throw (error ?? runtimeFlowerError(
      'runtime_flower_unlock_failed',
      `Local Environment access unlock failed with HTTP ${response.status}.`,
      response.status,
    ));
  }
  const cookie = runtimeFlowerAccessCookieFromHeaders(response.headers);
  if (!cookie) {
    throw new Error('Local Environment did not return an access session for Flower.');
  }
  runtimeFlowerAccessCookies.set(baseURL, cookie);
  return cookie;
}

async function runtimeFlowerAccessHeaders(
  record: LocalEnvironmentRuntimeRecord,
  environment: DesktopLocalEnvironmentState,
): Promise<Record<string, string>> {
  if (record.startup.password_required !== true) {
    return {};
  }
  const baseURL = runtimeFlowerBaseURL(record);
  const cookie = runtimeFlowerAccessCookies.get(baseURL) || await unlockRuntimeFlowerAccess(record, environment);
  return {
    Cookie: runtimeFlowerAccessCookieHeader(cookie),
  };
}

async function requestRuntimeFlower(request: RuntimeFlowerRequest): Promise<RuntimeFlowerRequestResult> {
  const method = runtimeFlowerMethod(request.method);
  const path = runtimeFlowerPath(request.path);
  if (!runtimeFlowerMethodAllowed(path, method)) {
    throw new Error('Flower runtime request method is not allowed for this path.');
  }
  const preferences = await loadDesktopPreferencesCached();
  const record = await ensureRuntimeFlowerRecord();
  const url = new URL(path, runtimeFlowerBaseURL(record));
  const environment = preferences.local_environment;
  const stagingCapability = compact(request.staging_capability);
  const stagingScopeID = compact(request.staging_scope_id);
  const requestPathname = new URL(path, 'http://runtime-flower.local').pathname;
  const stagingReleaseMatch = /^\/_redeven_proxy\/api\/ai\/upload-staging-scopes\/([^/]+)$/u.exec(requestPathname);
  const isStagingRelease = method === 'DELETE' && stagingReleaseMatch !== null;
  const acceptsStagingAuthorization = isStagingRelease
    || (method === 'POST' && requestPathname === '/_redeven_proxy/api/ai/uploads')
    || (method === 'POST' && /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/turns$/u.test(requestPathname))
    || ((method === 'GET' || method === 'DELETE') && /^\/_redeven_proxy\/api\/ai\/uploads\/[^/]+(?:\/long_text)?$/u.test(requestPathname));
  if (stagingCapability && (stagingCapability.length > 1024 || /[\r\n\0]/u.test(stagingCapability))) {
    throw new Error('Flower attachment staging capability is invalid.');
  }
  if (stagingScopeID && (stagingScopeID.length > 200 || /[\r\n\0]/u.test(stagingScopeID))) {
    throw new Error('Flower attachment staging scope identity is invalid.');
  }
  if (Boolean(stagingScopeID) !== Boolean(stagingCapability)) {
    throw new Error('Flower attachment staging scope and capability must be supplied together.');
  }
  if (stagingCapability && !acceptsStagingAuthorization) {
    throw new Error('Flower attachment staging authorization is not allowed for this path.');
  }
  if (isStagingRelease && decodeURIComponent(stagingReleaseMatch[1]!) !== stagingScopeID) {
    throw new Error('Flower attachment staging scope does not match the release path.');
  }
  const withStagingCapability = (headers: Readonly<Record<string, string>>): Record<string, string> => ({
    ...headers,
    ...(stagingCapability ? {
      'Upload-Staging-Capability': stagingCapability,
      ...(!isStagingRelease ? { 'Upload-Staging-Scope-ID': stagingScopeID } : {}),
    } : {}),
  });
  let accessHeaders = withStagingCapability(await runtimeFlowerAccessHeaders(record, environment));
  let response: RuntimeFlowerHTTPResponse;
  try {
    response = await runtimeFlowerRequestHTTP(url, { ...request, method, path }, { headers: accessHeaders });
  } catch (error) {
    throw new RuntimeFlowerTransportError(error);
  }
  if (response.status === 423) {
    runtimeFlowerAccessCookies.delete(runtimeFlowerBaseURL(record));
    const cookie = await unlockRuntimeFlowerAccess(record, environment);
    accessHeaders = withStagingCapability({
      Cookie: runtimeFlowerAccessCookieHeader(cookie),
    });
    try {
      response = await runtimeFlowerRequestHTTP(url, { ...request, method, path }, { headers: accessHeaders });
    } catch (error) {
      throw new RuntimeFlowerTransportError(error);
    }
  }
  const parsed = parseRuntimeFlowerJSON(response.body);
  const error = runtimeFlowerEnvelopeError(parsed, response.status);
  if (error) {
    return { ok: false, error, failureKind: 'response' };
  }
  const invalidJSONError = runtimeFlowerInvalidJSONError(response, parsed);
  if (invalidJSONError) {
    return {
      ok: false,
      error: invalidJSONError,
      failureKind: 'response',
    };
  }
  const dataRecord = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  const responseCapabilityRaw = response.headers['upload-staging-capability'];
  const responseCapability = compact(Array.isArray(responseCapabilityRaw) ? responseCapabilityRaw[0] : responseCapabilityRaw);
  if (responseCapability && (responseCapability.length > 1024 || /[\r\n\0]/u.test(responseCapability))) {
    return {
      ok: false,
      error: runtimeFlowerError('runtime_flower_invalid_staging_capability', 'Flower returned an invalid attachment staging capability.', response.status),
      failureKind: 'response',
    };
  }
  return {
    ok: true,
    data: dataRecord && Object.prototype.hasOwnProperty.call(dataRecord, 'data') ? dataRecord.data : parsed,
    ...(responseCapability ? { stagingCapability: responseCapability } : {}),
  };
}

function runtimeFlowerStreamOperationKey(senderID: number, streamID: string): string {
  return `${senderID}:${streamID}`;
}

function emitRuntimeFlowerStreamEvent(operation: RuntimeFlowerStreamOperation, event: RuntimeFlowerStreamEvent): void {
  if (operation.settled || operation.sender.isDestroyed()) return;
  operation.sender.send(RUNTIME_FLOWER_STREAM_EVENT_CHANNEL, event);
}

function finishRuntimeFlowerStream(operation: RuntimeFlowerStreamOperation, destroyRequest = false): void {
  if (operation.settled) return;
  operation.settled = true;
  runtimeFlowerStreamOperations.delete(operation.key);
  operation.sender.removeListener('destroyed', operation.senderDestroyedListener);
  if (destroyRequest && operation.request && !operation.request.destroyed) operation.request.destroy();
}

function cancelRuntimeFlowerStream(sender: WebContents, rawStreamID: unknown): void {
  const streamID = normalizeRuntimeFlowerStreamID(rawStreamID);
  if (!streamID) return;
  const operation = runtimeFlowerStreamOperations.get(runtimeFlowerStreamOperationKey(sender.id, streamID));
  if (operation) finishRuntimeFlowerStream(operation, true);
}

function runtimeFlowerStreamCountForSender(senderID: number): number {
  let count = 0;
  for (const operation of runtimeFlowerStreamOperations.values()) {
    if (operation.sender.id === senderID) count += 1;
  }
  return count;
}

async function openRuntimeFlowerStreamResponse(
  operation: RuntimeFlowerStreamOperation,
  url: URL,
  headers: Readonly<Record<string, string>>,
): Promise<IncomingMessage> {
  const stream = openRuntimeFlowerHTTPStream(url, { headers });
  operation.request = stream.request;
  return stream.response;
}

async function startRuntimeFlowerStream(
  sender: WebContents,
  rawRequest: unknown,
): Promise<RuntimeFlowerStreamStartResult> {
  const request = normalizeRuntimeFlowerStreamRequest(rawRequest);
  if (!request) {
    return { ok: false, error: runtimeFlowerError('runtime_flower_invalid_stream', 'Desktop received an invalid Flower stream request.') };
  }
  let path: string;
  try {
    path = runtimeFlowerPath(request.path);
  } catch (error) {
    return { ok: false, error: runtimeFlowerErrorFromUnknown(error) };
  }
  if (!runtimeFlowerMethodAllowed(path, 'GET') || new URL(path, 'http://runtime-flower.local').pathname !== '/_redeven_proxy/api/ai/flower/stream') {
    return { ok: false, error: runtimeFlowerError('runtime_flower_invalid_stream', 'Flower stream path is not allowed.') };
  }
  const key = runtimeFlowerStreamOperationKey(sender.id, request.stream_id);
  if (runtimeFlowerStreamOperations.has(key)) {
    return { ok: false, error: runtimeFlowerError('runtime_flower_stream_conflict', 'A Flower stream with this id is already active.') };
  }
  if (runtimeFlowerStreamOperations.size >= RUNTIME_FLOWER_STREAMS_GLOBAL
    || runtimeFlowerStreamCountForSender(sender.id) >= RUNTIME_FLOWER_STREAMS_PER_SENDER) {
    return { ok: false, error: runtimeFlowerError('runtime_flower_stream_limit', 'Too many Flower streams are active.', 429, 10_000) };
  }

  const preferences = await loadDesktopPreferencesCached();
  const record = await ensureRuntimeFlowerRecord();
  const url = new URL(path, runtimeFlowerBaseURL(record));
  const environment = preferences.local_environment;
  const operation: RuntimeFlowerStreamOperation = {
    key,
    streamID: request.stream_id,
    sender,
    settled: false,
    senderDestroyedListener: () => undefined,
  };
  operation.senderDestroyedListener = () => finishRuntimeFlowerStream(operation, true);
  runtimeFlowerStreamOperations.set(key, operation);
  sender.once('destroyed', operation.senderDestroyedListener);

  try {
    let accessHeaders = await runtimeFlowerAccessHeaders(record, environment);
    let response = await openRuntimeFlowerStreamResponse(operation, url, accessHeaders);
    if (response.statusCode === 423) {
      response.resume();
      runtimeFlowerAccessCookies.delete(runtimeFlowerBaseURL(record));
      const cookie = await unlockRuntimeFlowerAccess(record, environment);
      accessHeaders = { Cookie: runtimeFlowerAccessCookieHeader(cookie) };
      response = await openRuntimeFlowerStreamResponse(operation, url, accessHeaders);
    }
    if (operation.settled) {
      response.destroy();
      return { ok: false, error: runtimeFlowerError('runtime_flower_stream_cancelled', 'Flower stream was cancelled.') };
    }
    response.on('data', (chunk: Buffer) => {
      try {
        emitRuntimeFlowerStreamEvent(operation, {
          stream_id: operation.streamID,
          kind: 'chunk',
          chunk: new Uint8Array(chunk),
        });
      } catch {
        finishRuntimeFlowerStream(operation, true);
      }
    });
    response.once('end', () => {
      emitRuntimeFlowerStreamEvent(operation, {
        stream_id: operation.streamID,
        kind: 'end',
      });
      finishRuntimeFlowerStream(operation);
    });
    const fail = (error: unknown) => {
      emitRuntimeFlowerStreamEvent(operation, {
        stream_id: operation.streamID,
        kind: 'error',
        message: error instanceof Error ? error.message : compact(error) || 'Flower stream failed.',
      });
      finishRuntimeFlowerStream(operation, true);
    };
    response.once('aborted', () => fail(new Error('Flower stream response was interrupted.')));
    response.once('error', fail);
    const contentType = response.headers['content-type'];
    const retryAfter = response.headers['retry-after'];
    return {
      ok: true,
      status: response.statusCode ?? 0,
      ...(contentType
        ? {
            content_type: Array.isArray(contentType) ? contentType[0] : contentType,
          }
        : {}),
      ...(retryAfter
        ? {
            retry_after: Array.isArray(retryAfter) ? retryAfter[0] : retryAfter,
          }
        : {}),
    };
  } catch (error) {
    finishRuntimeFlowerStream(operation, true);
    return { ok: false, error: runtimeFlowerErrorFromUnknown(error) };
  }
}

async function fetchRuntimeFlowerAttachmentPreview(request: RuntimeFlowerAttachmentPreviewRequest): Promise<RuntimeFlowerHTTPResponse> {
  const preferences = await loadDesktopPreferencesCached();
  const record = await ensureRuntimeFlowerRecord();
  const requestPath = runtimeFlowerPath(`/_redeven_proxy/api/ai/uploads/${encodeURIComponent(request.attachment_id)}`);
  const url = new URL(requestPath, runtimeFlowerBaseURL(record));
  const environment = preferences.local_environment;
  const stagingHeaders = {
    'Upload-Staging-Scope-ID': request.staging_scope_id,
    'Upload-Staging-Capability': request.staging_capability,
  };
  let accessHeaders: Record<string, string> = { ...await runtimeFlowerAccessHeaders(record, environment), ...stagingHeaders };
  return requestRuntimeFlowerAttachmentPreviewWithAccess({
    request: () => runtimeFlowerRequestHTTP(url, { method: 'GET', path: requestPath }, {
      headers: accessHeaders,
      accept: '*/*',
    }),
    invalidateAccess: () => {
      runtimeFlowerAccessCookies.delete(runtimeFlowerBaseURL(record));
    },
    refreshAccess: async () => {
      const cookie = await unlockRuntimeFlowerAccess(record, environment);
      accessHeaders = {
        Cookie: runtimeFlowerAccessCookieHeader(cookie),
        ...stagingHeaders,
      };
    },
  });
}

async function previewRuntimeFlowerAttachment(request: RuntimeFlowerAttachmentPreviewRequest): Promise<void> {
  const response = await fetchRuntimeFlowerAttachmentPreview(request);
  if (response.status < 200 || response.status >= 300) {
    const parsed = parseRuntimeFlowerJSON(response.body);
    const error = runtimeFlowerEnvelopeError(parsed, response.status);
    throw new Error(error?.message || `Flower attachment preview failed with HTTP ${response.status}.`);
  }
  await materializeRuntimeFlowerAttachmentPreview({
    bytes: response.bytes,
    contentType: response.headers['content-type'],
    tempRoot: app.getPath('temp'),
    fileSystem: {
      createDirectory: (prefix) => fs.mkdtemp(prefix),
      writeExclusive: (filePath, bytes) => fs.writeFile(filePath, bytes, { mode: 0o600, flag: 'wx' }),
      removeDirectory: (directoryPath) => fs.rm(directoryPath, { recursive: true, force: true }),
      openPath: (filePath) => shell.openPath(filePath),
      scheduleCleanup: (cleanup, delayMS) => {
        const timer = setTimeout(cleanup, delayMS);
        timer.unref();
      },
    },
  });
}

function runtimeFlowerAttachmentOperationKey(senderID: number, operationID: string): string {
  return `${senderID}:${operationID}`;
}

function runtimeFlowerMultipartFilename(displayName: string): string {
  return encodeURIComponent(displayName).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function writeRuntimeFlowerAttachmentBytes(request: ClientRequest, chunk: Buffer): Promise<void> {
  if (request.destroyed) throw new Error('Flower attachment upload is no longer active.');
  if (!request.write(chunk)) {
    await once(request, 'drain');
  }
}

function emitRuntimeFlowerAttachmentProgress(
  operation: RuntimeFlowerAttachmentOperation,
  state: RuntimeFlowerAttachmentProgress['state'],
): void {
  if (operation.sender.isDestroyed()) return;
  operation.sender.send(RUNTIME_FLOWER_ATTACHMENT_PROGRESS_CHANNEL, {
    operation_id: operation.key.slice(operation.key.indexOf(':') + 1),
    loaded_bytes: operation.expectedOffset,
    total_bytes: operation.totalBytes,
    state,
  } satisfies RuntimeFlowerAttachmentProgress);
}

async function prepareRuntimeFlowerAttachmentUpload(
  sender: WebContents,
  input: RuntimeFlowerAttachmentPrepareRequest,
): Promise<RuntimeFlowerAttachmentPrepareResponse> {
  if (input.size_bytes > RUNTIME_FLOWER_ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      message: 'Flower attachment exceeds the Desktop transfer limit.',
    };
  }
  const key = runtimeFlowerAttachmentOperationKey(sender.id, input.operation_id);
  if (runtimeFlowerAttachmentOperations.has(key)) {
    return {
      ok: false,
      message: 'A Flower attachment upload with this operation id is already active.',
    };
  }
	const preferences = await loadDesktopPreferencesCached();
	const record = await ensureRuntimeFlowerRecord();
	const accessCacheKey = runtimeFlowerBaseURL(record);
	const accessHeaders = await runtimeFlowerAccessHeaders(record, preferences.local_environment);
  const boundary = `redeven-${crypto.randomBytes(18).toString('hex')}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\n${input.source}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="attachment"; filename*=UTF-8''${runtimeFlowerMultipartFilename(input.display_name)}\r\n` +
      `Content-Type: ${input.media_type}\r\n\r\n`,
    'utf8',
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const contentLength = preamble.byteLength + input.size_bytes + footer.byteLength;
  const url = new URL('/_redeven_proxy/api/ai/uploads', runtimeFlowerBaseURL(record));
  const client = url.protocol === 'https:' ? https : http;
  let request!: ClientRequest;
  const response = new Promise<RuntimeFlowerHTTPResponse>((resolve, reject) => {
    request = client.request(url, {
      method: 'POST',
      timeout: 120_000,
      headers: {
        Accept: 'application/json',
        ...accessHeaders,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(contentLength),
        'Idempotency-Key': input.upload_request_id,
        'Upload-Staging-Scope-ID': input.staging_scope_id,
        'Upload-Staging-Capability': input.staging_capability,
        'Upload-Content-SHA256': input.content_sha256,
        'Upload-Content-Length': String(input.size_bytes),
        'Upload-Display-Name-SHA256': input.display_name_sha256,
      },
    }, (incoming) => {
      void readRuntimeFlowerHTTPResponse(incoming).then(resolve, reject);
    });
    request.once('timeout', () => request.destroy(new Error('Flower attachment upload timed out.')));
    request.once('error', reject);
  });
  void response.catch(() => undefined);
  const operation: RuntimeFlowerAttachmentOperation = {
    key,
    sender,
    request,
    response,
    expectedOffset: 0,
    totalBytes: input.size_bytes,
		footer,
		accessCacheKey,
		settled: false,
  };
  trackRuntimeFlowerAttachmentOperation(runtimeFlowerAttachmentOperations, operation, (active) => {
    active.request.destroy(new Error('Flower attachment renderer was closed.'));
  });
  try {
    await writeRuntimeFlowerAttachmentBytes(request, preamble);
  } catch (error) {
    request.destroy(error instanceof Error ? error : new Error(String(error)));
    finishRuntimeFlowerAttachmentOperation(runtimeFlowerAttachmentOperations, operation);
    throw error;
  }
  emitRuntimeFlowerAttachmentProgress(operation, 'uploading');
  return {
    ok: true,
    operation_id: input.operation_id,
    chunk_size_bytes: RUNTIME_FLOWER_ATTACHMENT_CHUNK_SIZE_BYTES,
  };
}

async function writeRuntimeFlowerAttachmentChunk(
  sender: WebContents,
  operationID: string,
  offsetBytes: number,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<RuntimeFlowerAttachmentChunkResponse> {
  const key = runtimeFlowerAttachmentOperationKey(sender.id, operationID);
	const operation = runtimeFlowerAttachmentOperations.get(key);
	if (!operation || operation.settled) return { ok: false, message: 'Flower attachment upload is not active.' };
	if (!beginRuntimeFlowerAttachmentWrite(operation)) return { ok: false, message: 'A Flower attachment upload chunk is already being written.' };
	try {
		if (offsetBytes !== operation.expectedOffset || bytes.byteLength <= 0 || operation.expectedOffset + bytes.byteLength > operation.totalBytes) {
			return { ok: false, message: 'Flower attachment upload chunk is out of sequence.' };
		}
		await writeRuntimeFlowerAttachmentBytes(operation.request, Buffer.from(bytes));
    operation.expectedOffset += bytes.byteLength;
    emitRuntimeFlowerAttachmentProgress(operation, 'uploading');
    return { ok: true, next_offset_bytes: operation.expectedOffset };
  } catch (error) {
    operation.request.destroy(error instanceof Error ? error : new Error(String(error)));
    emitRuntimeFlowerAttachmentProgress(operation, 'failed');
		finishRuntimeFlowerAttachmentOperation(runtimeFlowerAttachmentOperations, operation);
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
	} finally {
		endRuntimeFlowerAttachmentWrite(operation);
	}
}

async function commitRuntimeFlowerAttachmentUpload(
  sender: WebContents,
  operationID: string,
): Promise<RuntimeFlowerAttachmentCommitResponse> {
  const key = runtimeFlowerAttachmentOperationKey(sender.id, operationID);
  const operation = runtimeFlowerAttachmentOperations.get(key);
  if (!operation || operation.settled) {
    return { ok: false, failureKind: 'local', error: { message: 'Flower attachment upload is not active.' } };
  }
  if (!beginRuntimeFlowerAttachmentWrite(operation)) {
    return { ok: false, failureKind: 'local', error: { message: 'Another Flower attachment upload write is already in progress.' } };
  }
  if (operation.expectedOffset !== operation.totalBytes) {
    endRuntimeFlowerAttachmentWrite(operation);
    return { ok: false, failureKind: 'local', error: { message: 'Flower attachment upload is incomplete.' } };
  }
  try {
    await writeRuntimeFlowerAttachmentBytes(operation.request, operation.footer);
    operation.request.end();
		const response = await operation.response;
		invalidateRuntimeFlowerAccessOnStatus(runtimeFlowerAccessCookies, operation.accessCacheKey, response.status);
    const parsed = parseRuntimeFlowerJSON(response.body);
    const error = runtimeFlowerEnvelopeError(parsed, response.status);
    if (error) {
      emitRuntimeFlowerAttachmentProgress(operation, 'failed');
      return { ok: false, error, failureKind: 'response' };
    }
    const dataRecord = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    emitRuntimeFlowerAttachmentProgress(operation, 'completed');
    return {
      ok: true,
      data: dataRecord && Object.prototype.hasOwnProperty.call(dataRecord, 'data') ? dataRecord.data : parsed,
    };
  } catch (error) {
    emitRuntimeFlowerAttachmentProgress(operation, 'failed');
    return {
      ok: false,
      error: runtimeFlowerErrorFromUnknown(error),
      failureKind: 'transport_unknown',
    };
  } finally {
    if (!operation.request.destroyed) operation.request.destroy();
    endRuntimeFlowerAttachmentWrite(operation);
    finishRuntimeFlowerAttachmentOperation(runtimeFlowerAttachmentOperations, operation);
  }
}

function cancelRuntimeFlowerAttachmentUpload(sender: WebContents, operationID: string): RuntimeFlowerAttachmentCancelResponse {
  const key = runtimeFlowerAttachmentOperationKey(sender.id, operationID);
  const operation = runtimeFlowerAttachmentOperations.get(key);
  if (!operation || operation.settled) return { ok: true, cancelled: false };
  emitRuntimeFlowerAttachmentProgress(operation, 'cancelled');
  operation.request.destroy(new Error('Flower attachment upload was cancelled.'));
  finishRuntimeFlowerAttachmentOperation(runtimeFlowerAttachmentOperations, operation);
  return { ok: true, cancelled: true };
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

function runtimeLifecycleOperationFromGatewayKind(
  operation: GatewayRuntimeOperation['kind'],
): DesktopRuntimeLifecycleOperation | null {
  switch (operation) {
    case 'start':
    case 'stop':
    case 'restart':
      return operation;
    case 'update_runtime':
      return 'update';
    case 'reconcile':
      return null;
  }
}

function runtimeLifecycleInitialPhase(
  location: ReturnType<typeof desktopRuntimeLifecycleLocation>,
): DesktopRuntimeLifecycleStepID {
  switch (location) {
    case 'local_host':
      return 'checking_existing_runtime';
    case 'local_container':
      return 'checking_container';
    case 'ssh_host':
    case 'ssh_container':
      return 'checking_host';
  }
}

function runtimeLifecyclePhaseForGatewayOperation(
  operation: GatewayRuntimeOperation,
  lifecycleOperation: DesktopRuntimeLifecycleOperation,
  location: ReturnType<typeof desktopRuntimeLifecycleLocation>,
): DesktopRuntimeLifecycleStepID {
  switch (operation.state) {
    case 'preflighting':
    case 'awaiting_confirmation':
    case 'confirmation_required':
      return runtimeLifecycleInitialPhase(location);
    case 'awaiting_artifact':
      return 'preparing_runtime_package';
    case 'staging':
      return 'installing_runtime_package';
    case 'commit_ready':
    case 'fencing':
      return lifecycleOperation === 'stop' || lifecycleOperation === 'restart' || lifecycleOperation === 'update'
        ? 'stopping_runtime_process'
        : 'starting_runtime_process';
    case 'committing':
      return lifecycleOperation === 'stop'
        ? 'verifying_runtime_inventory'
        : 'starting_runtime_process';
    case 'recovering':
    case 'manual_recovery_required':
      return 'verifying_runtime_inventory';
    case 'succeeded':
      return lifecycleOperation === 'stop'
        ? 'runtime_stopped'
        : lifecycleOperation === 'update'
          ? 'runtime_up_to_date'
          : 'runtime_ready';
    case 'failed':
    case 'cancelled':
    case 'expired':
      return runtimeLifecycleInitialPhase(location);
  }
}

function _initializeRuntimeLifecycleOperation(
  operationKey: string,
  operation: DesktopLauncherOperationSnapshot,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    lifecycleOperation: DesktopRuntimeLifecycleOperation;
    targetID: string;
    targetLabel: string;
    detail: string;
  }>,
): LauncherOperationAttemptIdentity {
  const owner = {
    action: operation.action,
    started_at_unix_ms: operation.started_at_unix_ms,
  } satisfies LauncherOperationAttemptIdentity;
  const workflow = beginRuntimeLifecycleWorkflowAttempt(operationKey, {
    hostAccess: input.hostAccess,
    placement: input.placement,
    operation: input.lifecycleOperation,
    targetID: input.targetID,
    targetLabel: input.targetLabel,
  });
  workflow.commitPlan({
    state: 'executing',
    steps: workflow.currentStepIDs(),
  });
  const initialPhase = runtimeLifecycleInitialPhase(
    desktopRuntimeLifecycleLocation(input.hostAccess, input.placement),
  );
  workflow.beginStep(initialPhase, input.detail);
  const progress = workflow.progress();
  launcherOperations.updateCurrentAttempt(operationKey, owner, {
    phase: progress.active_step_id,
    detail: input.detail,
    active_progress_surface: 'runtime_lifecycle',
    lifecycle_progress: progress,
  });
  return owner;
}

function _publishGatewayRuntimeOperationProgress(
  operationKey: string,
  owner: LauncherOperationAttemptIdentity,
  input: Readonly<{
    hostAccess: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    lifecycleOperation: DesktopRuntimeLifecycleOperation;
    targetID: string;
    targetLabel: string;
  }>,
  operation: GatewayRuntimeOperation,
): void {
  const projection = projectAttachedRuntimeOperation(operation);
  const location = desktopRuntimeLifecycleLocation(input.hostAccess, input.placement);
  updateRuntimeLifecycleOperation(operationKey, owner, {
    hostAccess: input.hostAccess,
    placement: input.placement,
    operation: input.lifecycleOperation,
    phase: runtimeLifecyclePhaseForGatewayOperation(operation, input.lifecycleOperation, location),
    targetID: input.targetID,
    targetLabel: input.targetLabel,
    title: projection.title,
    titleKey: projection.title_key,
    detail: projection.detail,
    detailKey: projection.detail_key,
  });
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
  const reportedFailedStepID = runtimeLifecycleStepIDFromError(input.error);
  const activeStepID = workflow.progress().active_step_id;
  const activeStep = workflow.stepStates().find((step) => step.id === activeStepID);
  const failedStepID = activeStep?.tasks?.length
    ? activeStepID
    : reportedFailedStepID ?? activeStepID;
  if (activeStep?.tasks?.length && activeStep.status === 'running') {
    const failedTaskID = reportedFailedStepID === 'preparing_runtime_package'
      || reportedFailedStepID === 'installing_runtime_package'
      ? 'runtime'
      : 'maintenance_helper';
    workflow.updateStepTasks(activeStepID, activeStep.tasks.map((task) => ({
      ...task,
      status: task.id === failedTaskID ? 'failed' : task.status === 'running' ? 'canceled' : task.status,
    })), input.fallback.summary);
  }
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
  workflow.completeThrough(input.phase);
  return workflow.progress();
}

function _currentRuntimeLifecycleWorkflowProgress(
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
    titleKey?: DesktopLauncherOperationSnapshot['title_key'];
    detail: string;
    detailKey?: DesktopLauncherOperationSnapshot['detail_key'];
    status?: DesktopLauncherOperationSnapshot['status'];
    failedPhase?: DesktopRuntimeLifecyclePhase;
    planPatch?: RuntimeLifecyclePlanPatch;
    failure?: DesktopOperationFailurePresentation;
    cancelable?: boolean;
    tasks?: readonly DesktopComponentTaskProgress[];
  }>,
): void {
  const current = launcherOperations.get(operationKey);
  if (
    !current
    || current.action !== owner.action
    || current.started_at_unix_ms !== owner.started_at_unix_ms
    || (current.status !== 'running'
      && current.status !== 'canceling'
      && current.status !== 'cleanup_running')
  ) {
    return;
  }
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
    const planUpdate = input.planPatch
      ? workflow.commitPlan(runtimeLifecyclePlanPatchPreservingObservedHistory({
          currentSteps: workflow.stepStates(),
          patch: input.planPatch,
        }))
      : (() => {
          const currentStepStates = workflow.stepStates();
          const phaseAlreadyPlanned = currentStepStates.some((step) => step.id === input.phase);
          const phasePlan = runtimeLifecyclePlanIncludingStep({
            location,
            operation,
            currentSteps: phaseAlreadyPlanned
              ? workflow.currentStepIDs()
              : currentStepStates
                .filter((step) => step.status !== 'pending')
                .map((step) => step.id),
            step: input.phase,
          });
          return workflow.ensureStepPlanned(input.phase, {
            state: phasePlan.state,
            steps: phasePlan.steps.map((step) => step.id),
            omitted_steps: phasePlan.omitted_steps,
          });
        })();
    const currentStep = workflow.progress().active_step_id;
    const currentStatus = workflow.stepStates().find((step) => step.id === input.phase)?.status;
    const currentStepIndex = workflow.currentStepIDs().indexOf(currentStep);
    const nextStepIndex = workflow.currentStepIDs().indexOf(input.phase);
    let update: ReturnType<RuntimeLifecycleWorkflow['observeStep']> | ReturnType<RuntimeLifecycleWorkflow['beginStep']>;
    if (currentStep === input.phase && currentStatus === 'running') {
      update = workflow.observeStep(input.phase, input.detail);
    } else if (currentStatus === 'succeeded' || currentStatus === 'failed') {
      update = null;
    } else if (currentStepIndex >= 0 && nextStepIndex > currentStepIndex) {
      update = workflow.advanceToStep(input.phase, input.detail);
    } else {
      update = workflow.beginStep(input.phase, input.detail);
    }
    if (input.tasks && workflow.stepStates().find((step) => step.id === input.phase)?.status === 'running') {
      workflow.updateStepTasks(input.phase, input.tasks, input.detail);
    }
    if (!update && !planUpdate && !input.tasks) {
      return;
    }
  }
  const lifecycleProgress = workflow.progress();
  launcherOperations.updateCurrentAttempt(operationKey, owner, {
    ...(input.status ? { status: input.status } : {}),
    active_progress_surface: 'runtime_lifecycle',
    phase: lifecycleProgress.active_step_id,
    title: input.title,
    title_key: input.titleKey,
    detail: input.detail,
    detail_key: input.detailKey,
    lifecycle_progress: lifecycleProgress,
    ...(input.failure ? { failure: input.failure } : {}),
    ...(input.cancelable !== undefined ? { cancelable: input.cancelable } : {}),
  });
}

function _runtimeLifecyclePhaseFromGateway(
  phase: GatewayServiceLifecycleProgress['phase'],
): DesktopRuntimeLifecyclePhase {
  switch (phase) {
    case 'checking_host':
      return 'checking_host';
    case 'checking_container':
      return 'checking_container';
    case 'preparing_gateway_package':
      return 'preparing_gateway_package';
    case 'installing_gateway':
      return 'installing_gateway_package';
    case 'enrolling_gateway':
      return 'installing_gateway_package';
    case 'starting_gateway':
      return 'starting_gateway_service';
    case 'opening_bridge':
      return 'opening_gateway_bridge';
    case 'gateway_ready':
      return 'gateway_service_ready';
    case 'stopping_gateway':
      return 'stopping_gateway_service';
    case 'verifying_gateway_stopped':
      return 'verifying_gateway_stopped';
  }
}

function runtimeLifecyclePhaseFromManagedRuntime(
  phase: ManagedRuntimeProgress['phase'],
): DesktopRuntimeLifecyclePhase {
  switch (phase) {
    case 'checking_existing_runtime': return 'checking_existing_runtime';
    case 'discovering_runtime_instances': return 'discovering_runtime_instances';
    case 'stopping_runtime_process': return 'stopping_runtime_process';
    case 'verifying_runtime_stopped': return 'verifying_runtime_stopped';
    case 'verifying_runtime_inventory': return 'verifying_runtime_inventory';
    case 'starting_runtime': return 'starting_runtime_process';
    case 'waiting_for_readiness':
    case 'runtime_ready': return 'checking_runtime_service';
  }
}

function runtimeLifecyclePhaseFromPlacement(
  phase: RuntimePlacementProgress['phase'],
): DesktopRuntimeLifecyclePhase {
  switch (phase) {
    case 'checking_host': return 'checking_host';
    case 'checking_container': return 'checking_container';
    case 'detecting_platform': return 'detecting_platform';
    case 'checking_runtime': return 'checking_runtime_package';
    case 'preparing_maintenance_helper': return 'preparing_maintenance_helper';
    case 'maintenance_helper_ready': return 'preparing_maintenance_helper';
    case 'discovering_runtime_instances': return 'discovering_runtime_instances';
    case 'stopping_runtime_process': return 'stopping_runtime_process';
    case 'verifying_runtime_stopped': return 'verifying_runtime_stopped';
    case 'verifying_runtime_inventory': return 'verifying_runtime_inventory';
    case 'preparing_runtime_package': return 'preparing_runtime_package';
    case 'runtime_package_ready': return 'preparing_runtime_package';
    case 'installing_runtime': return 'installing_runtime_package';
    case 'starting_runtime_daemon': return 'starting_runtime_process';
    case 'waiting_runtime_daemon':
    case 'runtime_ready': return 'checking_runtime_service';
  }
}

function sshRuntimeLifecyclePhase(
  phase: DesktopSSHRuntimeProgress['phase'],
): DesktopRuntimeLifecyclePhase {
  switch (phase) {
    case 'ssh_connecting':
    case 'ssh_control_ready': return 'checking_host';
    case 'ssh_checking_runtime':
    case 'ssh_runtime_ready': return 'checking_runtime_package';
    case 'ssh_detecting_platform': return 'detecting_platform';
    case 'ssh_preparing_process_helper': return 'preparing_maintenance_helper';
    case 'ssh_process_helper_ready': return 'preparing_maintenance_helper';
    case 'ssh_preparing_upload': return 'preparing_runtime_package';
    case 'ssh_runtime_package_ready': return 'preparing_runtime_package';
    case 'ssh_remote_installing':
    case 'ssh_creating_upload_dir':
    case 'ssh_uploading_archive':
    case 'ssh_installing_upload':
    case 'ssh_activating_runtime_package': return 'installing_runtime_package';
    case 'ssh_discovering_runtime_instances': return 'discovering_runtime_instances';
    case 'ssh_stopping_runtime_process': return 'stopping_runtime_process';
    case 'ssh_verifying_runtime_stopped': return 'verifying_runtime_stopped';
    case 'ssh_verifying_runtime_inventory': return 'verifying_runtime_inventory';
    case 'ssh_starting_runtime': return 'starting_runtime_process';
    case 'ssh_waiting_report':
    case 'ssh_cleaning_startup_resources': return 'checking_runtime_service';
  }
}

type DirectRuntimeLifecycleProgressReporter = (
  phase: DesktopRuntimeLifecyclePhase,
  title: string,
  detail: string,
  planPatch?: RuntimeLifecyclePlanPatch,
  tasks?: readonly DesktopComponentTaskProgress[],
) => void;

function concurrentRuntimePreparationReporter<Progress extends Readonly<{
  phase: string;
  title: string;
  detail: string;
}>>(input: Readonly<{
  strategy: DesktopComponentTaskProgress['strategy'];
  mapPhase: (phase: Progress['phase']) => DesktopRuntimeLifecyclePhase;
  helperPhase: Progress['phase'];
  helperReadyPhase: Progress['phase'];
  runtimeReadyPhase: Progress['phase'];
  discoveringPhase: Progress['phase'];
  cleanupPhase?: Progress['phase'];
  runtimeTaskPhase: (phase: Progress['phase']) => DesktopComponentTaskProgress['phase'] | null;
  update: DirectRuntimeLifecycleProgressReporter;
}>): (progress: Progress) => void {
  const tasks = new Map<DesktopComponentTaskProgress['id'], DesktopComponentTaskProgress>();
  const publishTasks = (detail: string): void => {
    input.update(
      'preparing_maintenance_helper',
      'Preparing Runtime resources',
      detail,
      undefined,
      [...tasks.values()],
    );
  };
  return (progress) => {
    if (progress.phase === input.helperPhase) {
      tasks.set('maintenance_helper', {
        id: 'maintenance_helper',
        status: 'running',
        phase: 'preparing',
        strategy: 'desktop_upload',
      });
      publishTasks(progress.detail);
      return;
    }
    if (progress.phase === input.helperReadyPhase) {
      tasks.set('maintenance_helper', {
        id: 'maintenance_helper',
        status: 'succeeded',
        phase: 'ready',
        strategy: 'desktop_upload',
      });
      publishTasks(progress.detail);
      return;
    }
    const runtimePhase = input.runtimeTaskPhase(progress.phase);
    if (runtimePhase) {
      tasks.set('runtime', {
        id: 'runtime',
        status: 'running',
        phase: runtimePhase,
        strategy: input.strategy,
      });
      publishTasks(progress.detail);
      return;
    }
    if (progress.phase === input.runtimeReadyPhase) {
      tasks.set('runtime', {
        id: 'runtime',
        status: 'succeeded',
        phase: 'ready',
        strategy: input.strategy,
      });
      publishTasks(progress.detail);
      return;
    }
    if (progress.phase === input.discoveringPhase && tasks.size > 0) {
      for (const [id, task] of tasks) {
        tasks.set(id, {
          ...task,
          status: 'succeeded',
          phase: 'ready',
        });
      }
      publishTasks('The maintenance helper and Runtime package are ready.');
    }
    if (
      progress.phase === input.cleanupPhase
      && [...tasks.values()].some((task) => task.status === 'running')
    ) {
      publishTasks(progress.detail);
      return;
    }
    input.update(input.mapPhase(progress.phase), progress.title, progress.detail);
  };
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
    active_progress_surface: 'open',
    ...(input.status ? { status: input.status } : {}),
    phase: input.phase,
    title: input.title,
    detail: input.detail,
    open_progress: buildOpenConnectionProgress(input),
    ...(input.failure ? { failure: input.failure } : {}),
    ...(input.cancelable !== undefined ? { cancelable: input.cancelable } : {}),
  });
}

type DirectRuntimeStopProgressInput = Readonly<{
  operationKey: string;
  owner: LauncherOperationAttemptIdentity;
  hostAccess: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  targetID: string;
  targetLabel: string;
  updateProgress: (
    phase: DesktopRuntimeLifecyclePhase,
    title: string,
    detail: string,
    planPatch?: RuntimeLifecyclePlanPatch,
  ) => void;
}>;

type DirectRuntimeStopInput = DirectRuntimeStopProgressInput & Readonly<{
  inspect: () => Promise<DesktopRuntimeProcessInventory>;
  stop: (inventory: DesktopRuntimeProcessInventory) => Promise<DesktopRuntimeProcessStopResult>;
}>;

function directRuntimeAlreadyStoppedPlan(input: DirectRuntimeStopProgressInput): RuntimeLifecyclePlanPatch {
  const workflow = runtimeLifecycleWorkflowForOperation(input.operationKey, input.owner, {
    hostAccess: input.hostAccess,
    placement: input.placement,
    operation: 'stop',
    targetID: input.targetID,
    targetLabel: input.targetLabel,
  });
  const plan = runtimeLifecyclePlanAfterProcessInventory({
    location: desktopRuntimeLifecycleLocation(input.hostAccess, input.placement),
    operation: 'stop',
    currentSteps: workflow.stepStates(),
    hasProcesses: false,
  });
  return {
    state: plan.state,
    steps: plan.steps.map((step) => step.id),
    omitted_steps: plan.omitted_steps,
  };
}

function markDirectRuntimeAlreadyStopped(
  input: DirectRuntimeStopProgressInput,
  detail: string,
): void {
  input.updateProgress(
    'runtime_already_stopped',
    'Runtime already stopped',
    detail,
    directRuntimeAlreadyStoppedPlan(input),
  );
}

async function executeDirectRuntimeStop(input: DirectRuntimeStopInput): Promise<void> {
  input.updateProgress(
    'discovering_runtime_instances',
    'Discovering Runtime processes',
    'Desktop is verifying the registered Runtime process identities.',
  );
  const inventory = await input.inspect();
  requireDesktopRuntimeProcessIdentity(inventory);
  if (inventory.instances.length === 0) {
    markDirectRuntimeAlreadyStopped(input, 'Desktop found no Redeven Runtime process for this target.');
    return;
  }

  input.updateProgress(
    'stopping_runtime_process',
    'Stopping Runtime processes',
    `Desktop is stopping ${desktopRuntimeProcessStopTargetCount(inventory)} verified Runtime process(es).`,
  );
  const stopped = await input.stop(inventory);
  input.updateProgress(
    'verifying_runtime_stopped',
    'Verifying Runtime stopped',
    'Desktop is confirming that no matching Redeven Runtime process remains.',
  );
  if (stopped.after.instances.length > 0) {
    throw new Error('Desktop could not verify an empty Redeven Runtime process inventory.');
  }
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

function openConnectionFailureNextActions(
  operationKey: string,
  environmentID: string,
  options: Readonly<{
    includeUpdateRuntime?: boolean;
    includeDesktopUpdate?: boolean;
    desktopUpdateAvailable?: boolean;
    retryAction?: DesktopLauncherActionRequest;
  }> = {},
): readonly DesktopLauncherOperationNextAction[] {
  return [
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
    ...(options.retryAction ? [{
      kind: 'retry' as const,
      operation_key: operationKey,
      label: 'Try again',
      retry_action: options.retryAction,
    }] : []),
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
  return {
    includeUpdateRuntime: runtimeServiceNeedsRuntimeUpdate(input.runtimeService),
    includeDesktopUpdate: runtimeServiceNeedsDesktopUpdate(input.runtimeService),
  };
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

const desktopCodeWorkspaceEnginePackageJobTTLMS = 30 * 60 * 1000;
const desktopCodeWorkspaceEnginePackageArchiveLimitBytes = 2 * 1024 * 1024 * 1024;

type DesktopCodeWorkspacePreparationOperation = Readonly<{
  operationID: string;
  webContentsID: number;
  controller: AbortController;
}>;

const desktopCodeWorkspacePreparationOperations = new Map<string, DesktopCodeWorkspacePreparationOperation>();

function beginDesktopCodeWorkspacePreparationOperation(operationID: string, webContentsID: number): DesktopCodeWorkspacePreparationOperation | null {
  if (desktopCodeWorkspacePreparationOperations.has(operationID)) {
    return null;
  }
  const operation = {
    operationID,
    webContentsID,
    controller: new AbortController(),
  };
  desktopCodeWorkspacePreparationOperations.set(operationID, operation);
  return operation;
}

function finishDesktopCodeWorkspacePreparationOperation(operation: DesktopCodeWorkspacePreparationOperation): void {
  if (desktopCodeWorkspacePreparationOperations.get(operation.operationID) === operation) {
    desktopCodeWorkspacePreparationOperations.delete(operation.operationID);
  }
}

const desktopCodeWorkspaceEnginePackageJobs = new DesktopCodeWorkspacePackageJobStore({
  ttlMS: desktopCodeWorkspaceEnginePackageJobTTLMS,
  finishOperation: (operation) => finishDesktopCodeWorkspacePreparationOperation(operation as DesktopCodeWorkspacePreparationOperation),
});

function emitDesktopCodeWorkspaceProgress(
  sender: WebContents,
  operationID: string,
  progress: Omit<DesktopCodeWorkspaceProgress, 'operation_id' | 'updated_at_unix_ms'>,
): void {
  if (sender.isDestroyed()) return;
  sender.send(DESKTOP_CODE_WORKSPACE_PROGRESS_CHANNEL, {
    operation_id: operationID,
    ...progress,
    updated_at_unix_ms: Date.now(),
  } satisfies DesktopCodeWorkspaceProgress);
}

async function pruneDesktopRuntimePackageCacheForCurrentRelease(): Promise<void> {
  await pruneDesktopRuntimePackageCache({
    cacheRoot: desktopRuntimePackageCacheRoot(),
    activeReleaseTag: resolveSSHRuntimeReleaseTag(),
  });
}

async function markSavedExternalTargetUsed(environmentID: string, rawURL: string): Promise<void> {
  await mutateDesktopPreferences((current) => markSavedEnvironmentUsed(current, {
    environment_id: environmentID,
    local_ui_url: rawURL,
  }));
}

function savedRuntimePlacementSSHPassword(
  preferences: DesktopPreferences,
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
  targetID: DesktopRuntimeTargetID,
  environmentID: string,
  requestPassword = '',
): string {
  if (hostAccess.kind !== 'ssh_host') {
    return '';
  }
  const savedTarget = preferences.saved_runtime_targets.find((target) => (
    target.id === targetID || target.id === compact(environmentID)
  )) ?? null;
  return savedTarget?.ssh_password_configured === true
    ? savedTarget.ssh_password ?? ''
    : compact(requestPassword);
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
    active_workload: runtimeServiceWorkloadCounts(runtimeService),
    current_runtime_version: runtimeService?.runtime_version,
    target_runtime_version: resolveSSHRuntimeReleaseTag(),
    message,
  });
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

function providerAccessPointForEnvironment(
  controlPlane: DesktopSavedControlPlane,
  environment: DesktopProviderEnvironmentRecord,
): DesktopSavedControlPlane['provider']['access_points'][number] {
  const accessPoint = controlPlane.provider.access_points.find((candidate) => (
    candidate.access_point_id === environment.access_point_id
    && candidate.region === environment.region
    && candidate.access_point_origin === environment.access_point_origin
  )) ?? null;
  if (!accessPoint) {
    throw new Error('This provider no longer lists the environment access point. Sync the provider and try again.');
  }
  return accessPoint;
}

function findProviderEnvironmentForAccessPointRoute(
  preferences: DesktopPreferences,
  controlPlane: DesktopSavedControlPlane,
  envPublicID: string,
  accessPointOrigin: string,
): DesktopProviderEnvironmentRecord | null {
  const normalizedAccessPointOrigin = normalizeControlPlaneOrigin(accessPointOrigin);
  const cleanEnvPublicID = compact(envPublicID);
  return preferences.provider_environments.find((environment) => (
    environment.provider_origin === controlPlane.provider.provider_origin
    && environment.provider_id === controlPlane.provider.provider_id
    && environment.env_public_id === cleanEnvPublicID
    && environment.access_point_origin === normalizedAccessPointOrigin
  )) ?? null;
}

type ProviderAccessPointEnvironmentSync = Readonly<{
  environments: readonly DesktopProviderEnvironment[];
  syncedAccessPoints: readonly DesktopProviderAccessPoint[];
  failures: readonly Readonly<{
    accessPoint: DesktopProviderAccessPoint;
    error: unknown;
  }>[];
}>;

async function fetchProviderEnvironmentsFromAccessPoints(
  provider: DesktopSavedControlPlane['provider'],
  accessToken: string,
): Promise<ProviderAccessPointEnvironmentSync> {
  const results = await Promise.all(provider.access_points.map(async (accessPoint) => {
    try {
      return {
        status: 'fulfilled' as const,
        accessPoint,
        environments: await fetchProviderEnvironments(provider, accessPoint, accessToken),
      };
    } catch (error) {
      return {
        status: 'rejected' as const,
        accessPoint,
        error,
      };
    }
  }));
  const environments: DesktopProviderEnvironment[] = [];
  const syncedAccessPoints: DesktopProviderAccessPoint[] = [];
  const failures: ProviderAccessPointEnvironmentSync['failures'][number][] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      syncedAccessPoints.push(result.accessPoint);
      environments.push(...result.environments);
      continue;
    }
    failures.push({ accessPoint: result.accessPoint, error: result.error });
  }
  if (syncedAccessPoints.length === 0) {
    const firstFailure = failures[0];
    if (firstFailure?.error instanceof Error) {
      throw firstFailure.error;
    }
    throw new Error('Desktop could not sync any provider access point.');
  }
  for (const failure of failures) {
    const message = failure.error instanceof Error ? failure.error.message : String(failure.error);
    console.warn(`[redeven:provider-sync] Access point ${failure.accessPoint.access_point_origin} did not sync: ${message}`);
  }
  return {
    environments,
    syncedAccessPoints,
    failures,
  };
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

function providerEnvironmentRecordAsSummary(
  environment: DesktopProviderEnvironmentRecord,
): DesktopProviderEnvironment {
  const catalog = environment.remote_catalog_entry;
  return {
    provider_id: environment.provider_id,
    provider_origin: environment.provider_origin,
    env_public_id: environment.env_public_id,
    region: environment.region,
    access_point_id: environment.access_point_id,
    access_point_origin: environment.access_point_origin,
    label: environment.label,
    environment_url: catalog?.environment_url || undefined,
    description: catalog?.description ?? '',
    namespace_public_id: catalog?.namespace_public_id ?? '',
    namespace_name: catalog?.namespace_name ?? '',
    status: catalog?.status ?? '',
    lifecycle_status: catalog?.lifecycle_status ?? '',
    last_seen_at_unix_ms: catalog?.last_seen_at_unix_ms ?? 0,
    runtime_health: providerEnvironmentRuntimeHealthForControlPlane(
      environment.provider_origin,
      environment.provider_id,
      environment.env_public_id,
    ) ?? undefined,
  };
}

function controlPlaneSummary(
  controlPlane: DesktopSavedControlPlane,
  providerEnvironments: readonly DesktopProviderEnvironmentRecord[] = [],
): DesktopControlPlaneSummary {
  const syncRecord = currentControlPlaneSyncRecord(controlPlane);
  const environments = providerEnvironments
    .filter((environment) => (
      environment.provider_origin === controlPlane.provider.provider_origin
      && environment.provider_id === controlPlane.provider.provider_id
    ))
    .map((environment) => providerEnvironmentRecordAsSummary(environment));
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
  return preferences.control_planes.map((controlPlane) => controlPlaneSummary(controlPlane, preferences.provider_environments));
}

function controlPlaneNeedsAutoSync(
  controlPlane: DesktopSavedControlPlane,
  providerEnvironments: readonly DesktopProviderEnvironmentRecord[] = [],
): boolean {
  const summary = controlPlaneSummary(controlPlane, providerEnvironments);
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

function updateGatewaySyncPoller(): void {
  const shouldPoll = Boolean(liveUtilityWindow('launcher'));
  if (!shouldPoll) {
    if (gatewaySyncPollTimer) {
      clearInterval(gatewaySyncPollTimer);
      gatewaySyncPollTimer = null;
    }
    return;
  }
  if (gatewaySyncPollTimer) {
    return;
  }
  gatewaySyncPollTimer = setInterval(() => {
    void syncVisibleGatewaysIfNeeded();
  }, GATEWAY_CATALOG_SYNC_POLL_INTERVAL_MS);
}

async function syncVisibleControlPlanesIfNeeded(options: Readonly<{ force?: boolean }> = {}): Promise<void> {
  const launcher = liveUtilityWindow('launcher');
  if (!launcher || launcher.isDestroyed()) {
    updateControlPlaneSyncPoller();
    return;
  }
  const preferences = await loadDesktopPreferencesCached();
  const tasks = preferences.control_planes.flatMap((controlPlane) => {
    if (!options.force && !controlPlaneNeedsAutoSync(controlPlane, preferences.provider_environments)) {
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
  const environmentsByAccessPoint = new Map<string, DesktopProviderEnvironmentRecord[]>();
  for (const environment of authorized.preferences.provider_environments) {
    if (
      environment.provider_origin !== authorized.controlPlane.provider.provider_origin
      || environment.provider_id !== authorized.controlPlane.provider.provider_id
      || !cleanEnvPublicIDs.includes(environment.env_public_id)
    ) {
      continue;
    }
    const key = `${environment.access_point_id}\n${environment.access_point_origin}`;
    environmentsByAccessPoint.set(key, [
      ...(environmentsByAccessPoint.get(key) ?? []),
      environment,
    ]);
  }
  const runtimeHealthByAccessPoint = await Promise.all([...environmentsByAccessPoint.values()].map(async (environments) => {
    const firstEnvironment = environments[0];
    if (!firstEnvironment) {
      return [];
    }
    const accessPoint = providerAccessPointForEnvironment(authorized.controlPlane, firstEnvironment);
    return queryProviderEnvironmentRuntimeHealth(
      authorized.controlPlane.provider,
      accessPoint,
      authorized.accessToken,
        {
          env_public_ids: environments.map((environment) => environment.env_public_id),
        },
    );
  }));
  upsertProviderRuntimeHealth(providerOrigin, providerID, runtimeHealthByAccessPoint.flat());
  await Promise.all([...environmentsByAccessPoint.values()].flat().map(async (environment) => {
    await refreshProviderRuntimeOperationAttachments(
      authorized.controlPlane.provider,
      authorized.accessToken,
      providerAccessPointForEnvironment(authorized.controlPlane, environment),
      environment,
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[redeven:provider-runtime-operation] Attach refresh failed for ${safeLogText(environment.env_public_id, 128)}: ${safeLogText(message, 512)}`);
    });
  }));
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
    const environments = preferences.provider_environments.filter((environment) => (
      environment.provider_origin === controlPlane.provider.provider_origin
      && environment.provider_id === controlPlane.provider.provider_id
    ));
    await refreshProviderEnvironmentRuntimeHealth(
      controlPlane.provider.provider_origin,
      controlPlane.provider.provider_id,
      environments.map((environment) => environment.env_public_id),
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
  requestedAccessPointOrigin?: string;
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
    requestedAccessPointOrigin: args.requestedAccessPointOrigin,
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
  const authorizedProvider = {
    ...provider,
    access_points: exchange.access_points,
  };
  rememberControlPlaneAccessState(
    authorizedProvider.provider_origin,
    authorizedProvider.provider_id,
    exchange.access_token,
    exchange.access_expires_at_unix_ms,
    exchange.authorization_expires_at_unix_ms,
  );
  const environmentSync = await fetchProviderEnvironmentsFromAccessPoints(authorizedProvider, exchange.access_token);
  const nextPreferences = await mutateDesktopPreferences((current) => upsertSavedControlPlane(current, {
    provider: authorizedProvider,
    account: exchange.account,
    environments: environmentSync.environments,
    synced_access_points: environmentSync.syncedAccessPoints,
    display_label: compact(displayLabel) || undefined,
    last_synced_at_ms: Date.now(),
    refresh_token: exchange.refresh_token,
  }));
  const controlPlane = savedControlPlaneByIdentity(nextPreferences, authorizedProvider.provider_origin, authorizedProvider.provider_id);
  if (!controlPlane) {
    throw new Error('Desktop failed to save the provider account.');
  }
  upsertProviderRuntimeHealth(
    authorizedProvider.provider_origin,
    authorizedProvider.provider_id,
    environmentSync.environments.flatMap((environment) => environment.runtime_health ? [environment.runtime_health] : []),
  );
  setControlPlaneSyncRecord(authorizedProvider.provider_origin, authorizedProvider.provider_id, {
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

  const [account, environmentSync] = await Promise.all([
    fetchProviderAccount(provider, refreshed.access_token),
    fetchProviderEnvironmentsFromAccessPoints(provider, refreshed.access_token),
  ]);
  assertCurrentSubject();
  const nextPreferences = await mutateDesktopPreferences((current) => upsertSavedControlPlane(current, {
    provider,
    account,
    environments: environmentSync.environments,
    synced_access_points: environmentSync.syncedAccessPoints,
    last_synced_at_ms: Date.now(),
    refresh_token: refreshToken,
  }));
  const controlPlane = savedControlPlaneByIdentity(nextPreferences, provider.provider_origin, provider.provider_id);
  if (!controlPlane) {
    throw new Error('Desktop failed to save the provider account.');
  }
  upsertProviderRuntimeHealth(
    provider.provider_origin,
    provider.provider_id,
    environmentSync.environments.flatMap((environment) => environment.runtime_health ? [environment.runtime_health] : []),
  );
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

    const summary = controlPlaneSummary(controlPlane, preferences.provider_environments);
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

  const nextPreferences = await mutateDesktopPreferences((current) => upsertSavedControlPlane(current, {
    provider: controlPlane.provider,
    account: {
      ...controlPlane.account,
      authorization_expires_at_unix_ms: refreshed.authorization_expires_at_unix_ms,
    },
    last_synced_at_ms: controlPlane.last_synced_at_ms,
    refresh_token: refreshToken,
  }));
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

function controlPlaneRouteSnapshot(
  preferences: DesktopPreferences,
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): Readonly<{
  controlPlane: DesktopSavedControlPlane | null;
  summary: DesktopControlPlaneSummary | null;
  environment: DesktopProviderEnvironment | null;
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
  const summary = controlPlaneSummary(controlPlane, preferences.provider_environments);
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
  const failureCode = needsDesktopUpdate
    ? 'desktop_update_required' as const
    : needsUpdate
      ? 'runtime_update_required' as const
      : 'environment_open_failed' as const;
  const failure = desktopOperationFailurePresentation({
    code: failureCode,
    title: 'Open Failed',
    summary,
    targetLabel: options.targetLabel,
    ...(needsDesktopUpdate
      ? {
          summaryKey: 'runtimeMessage.updateDesktopBeforeOpeningEnvironment' as const,
          recoveryHintKey: 'runtimeMessage.updateDesktopBeforeOpeningEnvironment' as const,
        }
      : needsUpdate
        ? {
            summaryKey: 'runtimeMessage.updateRuntimeBeforeOpeningEnvironment' as const,
            recoveryHintKey: 'runtimeMessage.updateRuntimeFirst' as const,
          }
        : {}),
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
  const requiresUpdate = maintenance?.recovery_action === 'update_runtime'
    || maintenance?.kind === 'runtime_update_required';
  const requiresRestart = maintenance?.recovery_action === 'restart_runtime';
  const requiresStart = maintenance?.recovery_action === 'start_runtime'
    || health?.offline_reason_code === 'not_started'
    || health?.offline_reason_code === 'container_not_running';
  const message = compact(maintenance?.message) || compact(health?.offline_reason)
    || 'Desktop could not verify this runtime before opening it.';
  const failure = requiresUpdate
    ? desktopOperationFailurePresentation({
        code: 'runtime_update_required',
        title: 'Runtime Update Required',
        summary: message,
        summaryKey: 'runtimeMessage.updateRuntimeBeforeOpeningEnvironment',
        recoveryHint: 'Update the Runtime, verify it is ready, then open again.',
        recoveryHintKey: 'runtimeMessage.updateRuntimeFirst',
        targetLabel: options.targetLabel,
        ...(maintenance?.message ? { detail: maintenance.message } : {}),
      })
    : requiresRestart
      ? desktopOperationFailurePresentation({
          code: 'environment_open_failed',
          title: 'Runtime Restart Required',
          summary: message,
          recoveryHint: 'Restart the Runtime, verify it is ready, then open again.',
          targetLabel: options.targetLabel,
        })
      : requiresStart
        ? desktopOperationFailurePresentation({
            code: 'environment_open_failed',
            title: 'Runtime Start Required',
            summary: message,
            recoveryHint: 'Start the Runtime, verify it is ready, then open again.',
            targetLabel: options.targetLabel,
          })
        : desktopOperationFailurePresentation({
            code: 'environment_open_failed',
            title: 'Open Failed',
            summary: message,
            targetLabel: options.targetLabel,
            ...(maintenance?.message ? { detail: maintenance.message } : {}),
          });
  const code: DesktopLauncherActionFailureCode = requiresUpdate || requiresRestart || maintenance
    || health?.offline_reason_code === 'unverified'
    || health?.offline_reason_code === 'probe_failed'
    ? 'runtime_not_ready'
    : requiresStart
      ? 'runtime_not_started'
      : 'runtime_not_ready';
  return launcherActionFailure(
    code,
    'environment',
    message,
    {
      environmentID: options.environmentID,
      shouldRefreshSnapshot: true,
      ...(failure ? { failure } : {}),
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
  const placement = localHostRuntimeLifecyclePlacement(environment);
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
    ...(signal?.aborted ? {} : { next_actions: openConnectionFailureNextActions(operationKey, target.environmentID, {
      ...runtimeOpenFailureRecoveryActions({
        failure: result.failure,
        launcherFailure: result,
      }),
      desktopUpdateAvailable: desktopUpdateHandoffAvailable(preferences, target.environmentID),
      retryAction: {
        kind: 'open_local_environment',
        environment_id: target.environmentID,
        route: 'local_host',
        runtime_target_id: target.targetID,
        host_access: target.hostAccess,
        placement: target.placement,
      },
    }) }),
    ...(signal?.aborted || !result.failure ? {} : { failure: result.failure }),
  });
  scheduleLauncherOperationRemoval(operationKey);
  return {
    ...result,
    operation_key: operationKey,
  };
}

async function openLocalEnvironmentRecord(
  preferences: DesktopPreferences,
  environment: DesktopLocalEnvironmentState,
  options: Readonly<{
    stealAppFocus?: boolean;
  }> = {},
): Promise<DesktopLauncherActionResult> {
  const pendingReinstall = await pendingReinstallOperationForEnvironment(environment.id);
  if (pendingReinstall) {
    return launcherActionSuccess('reinstall_target_in_progress', {
      operationKey: pendingReinstall.operation_key,
    });
  }
  const target = buildLocalEnvironmentDesktopTarget(environment, {
    route: 'local_host',
  });
  const sessionKey = target.session_key;
  const existingSession = liveSession(sessionKey);
  if (existingSession) {
    if (existingSession.lifecycle === 'opening') {
      return launcherActionFailureForOpeningSession(existingSession, {
        environmentID: environment.id,
      });
    }
    resetLauncherIssueState();
    focusEnvironmentSession(existingSession.session_key, {
      stealAppFocus: options.stealAppFocus !== false,
    });
    if (findLocalEnvironmentByID(preferences, environment.id)) {
      await mutateDesktopPreferences((current) => rememberLocalEnvironmentUse(current, environment.id, 'local_host'));
    }
    return launcherActionSuccess('focused_environment_window', {
      sessionKey: existingSession.session_key,
    });
  }

  const lifecycleTargetKey = localHostRuntimeLifecycleTargetKey(environment);
  try {
    return await runtimeLifecycleCoordinator.runWhenReady({
      target_key: lifecycleTargetKey,
      fingerprint: runtimeLifecycleFingerprint({
        operation: 'open',
        target: lifecycleTargetKey,
      }),
      operation_key: `${sessionKey}:open`,
      execute: ({ joined_ready_mutation }) => openLocalEnvironmentRecordWithLifecycleOwner(
        preferences,
        environment,
        target,
        joined_ready_mutation,
        options,
      ),
    });
  } catch (error) {
    const activeIntent = runtimeLifecycleCoordinator.active(lifecycleTargetKey)?.intent;
    return launcherActionFailureFromRuntimeLifecycleError(error, {
      scope: 'environment',
      environmentID: environment.id,
    }) ?? launcherActionFailureFromRuntimeStartError(error, {
        environmentID: environment.id,
        operation: runtimeStartFailureOperationForIntent(activeIntent),
      });
  }
}

async function openLocalEnvironmentRecordWithLifecycleOwner(
  preferences: DesktopPreferences,
  environment: DesktopLocalEnvironmentState,
  target: DesktopSessionTarget,
  joinedLifecycleMutation: boolean,
  options: Readonly<{ stealAppFocus?: boolean }>,
): Promise<DesktopLauncherActionResult> {
  const openTarget = localHostOpenTarget(environment);
  const operationKey = `${openTarget.targetID}:open`;
  const previousOpenOperation = launcherOperations.get(operationKey);
  if (!previousOpenOperation || (
    previousOpenOperation.status !== 'running'
    && previousOpenOperation.status !== 'needs_confirmation'
  )) {
    managedEnvironmentOpenRecoveryAttemptsByTargetID.delete(openTarget.targetID);
  }
  const checkingOpenPresentation = {
    status: 'running' as const,
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
    failure: undefined,
    next_actions: undefined,
    runtime_confirmation: undefined,
  } as const;
  const operation = previousOpenOperation?.status === 'running'
    ? launcherOperations.update(operationKey, checkingOpenPresentation)!
    : launcherOperations.create({
        operation_key: operationKey,
        action: 'open_local_environment',
        subject_kind: 'local_environment',
        subject_id: environment.id,
        environment_id: environment.id,
        environment_label: environment.label,
        active_progress_surface: 'open',
        ...checkingOpenPresentation,
      });
  const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
  const failureContext = localEnvironmentFailureContext(environment);
  let runtimeRecord: LocalEnvironmentRuntimeRecord | null = null;
  let coordinatedRuntimeRecord = joinedLifecycleMutation ? currentLocalEnvironmentRuntimeRecord(environment) : null;
  let sessionRecord: DesktopSessionRecord | null = null;

  try {
    for (;;) {
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
      if (coordinatedRuntimeRecord) {
        runtimeRecord = coordinatedRuntimeRecord;
        coordinatedRuntimeRecord = null;
      } else {
        await refreshWelcomeRuntimeHealthForEnvironment(environment.id);
        runtimeRecord = await attachLocalEnvironmentRuntime(environment);
      }
      let preflightFailure = !runtimeRecord
        ? launcherActionFailureForRuntimeHealthPreflight(
          localRuntimeHealthForOpenPreflight(environment.id),
          {
            environmentID: environment.id,
            targetLabel: environment.label,
          },
        )
        : null;
      let requiredOperation: ManagedRuntimeLifecycleOperation | undefined;
      if (runtimeRecord) {
        const runtimePlan = buildDesktopLocalRuntimeOpenPlan(
          { kind: 'local_environment' },
          runtimeRecord.startup,
        );
        if (runtimePlan.requires_restart || !runtimePlan.can_open) {
          preflightFailure = launcherActionFailureForRuntimeOpenPreflightMessage(
            'runtime_not_ready',
            runtimePlan.message,
            {
              ...failureContext,
              targetLabel: environment.label,
            },
          );
          requiredOperation = runtimeServiceNeedsRuntimeUpdate(runtimeRecord.startup.runtime_service)
            ? 'update_runtime'
            : 'restart';
        } else if (!runtimeServiceIsOpenable(runtimeRecord.startup.runtime_service)) {
          preflightFailure = launcherActionFailureForRuntimeNotOpenable(runtimeRecord.startup, {
            ...failureContext,
            targetLabel: environment.label,
          });
          requiredOperation = runtimeServiceNeedsRuntimeUpdate(runtimeRecord.startup.runtime_service)
            ? 'update_runtime'
            : 'restart';
        }
      }
      if (!preflightFailure) {
        break;
      }

      const recoveryAttempts = managedEnvironmentOpenRecoveryAttemptsByTargetID.get(openTarget.targetID) ?? 0;
      if (recoveryAttempts >= 2) {
        managedEnvironmentOpenRecoveryAttemptsByTargetID.delete(openTarget.targetID);
        return finishLocalHostOpenFailure(operationKey, openTarget, signal, preflightFailure, preferences);
      }
      managedEnvironmentOpenRecoveryAttemptsByTargetID.set(openTarget.targetID, recoveryAttempts + 1);
      updateOpenConnectionOperation(operationKey, {
        hostAccess: openTarget.hostAccess,
        placement: openTarget.placement,
        phase: 'ensuring_runtime_ready',
        environmentID: openTarget.environmentID,
        environmentLabel: openTarget.environmentLabel,
        targetID: openTarget.targetID,
        targetLabel: openTarget.targetLabel,
        title: requiredOperation === 'update_runtime'
          ? 'Updating Runtime'
          : requiredOperation === 'restart'
            ? 'Restarting Runtime'
            : 'Preparing Runtime',
        detail: 'Desktop is completing the Runtime recovery required before opening this environment.',
      });
      const retryOpenRequest: Extract<DesktopLauncherActionRequest, { kind: 'open_local_environment' }> = {
        kind: 'open_local_environment',
        environment_id: environment.id,
        route: 'local_host',
        runtime_target_id: openTarget.targetID,
        host_access: openTarget.hostAccess,
        placement: openTarget.placement,
      };
      const lifecycleResult = await runEnvironmentRuntimeLifecycleFromLauncher({
        kind: requiredOperation === 'update_runtime'
          ? 'update_environment_runtime'
          : requiredOperation === 'restart'
            ? 'restart_environment_runtime'
            : 'start_environment_runtime',
        environment_id: environment.id,
        label: environment.label,
        runtime_target_id: openTarget.targetID,
        host_access: openTarget.hostAccess,
        placement: openTarget.placement,
      }, {
        openRecovery: {
          operationKey,
          ...(requiredOperation ? { requiredOperation } : {}),
          confirmationContinuation: () => openLocalEnvironmentFromLauncher(retryOpenRequest),
        },
      });
      if (!lifecycleResult.ok) {
        if (lifecycleResult.code === 'confirmation_required') {
          return lifecycleResult;
        }
        managedEnvironmentOpenRecoveryAttemptsByTargetID.delete(openTarget.targetID);
        return finishLocalHostOpenFailure(operationKey, openTarget, signal, lifecycleResult, preferences);
      }
      coordinatedRuntimeRecord = currentLocalEnvironmentRuntimeRecord(environment);
    }
    if (!runtimeRecord) {
      throw new Error('Runtime readiness completed without an attachable local Runtime record.');
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
  managedEnvironmentOpenRecoveryAttemptsByTargetID.delete(openTarget.targetID);
  await mutateDesktopPreferences((current) => rememberLocalEnvironmentUse(current, environment.id, 'local_host'));
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
    runtime_service: {
      protocol_version: 'redeven-runtime-v2',
      compatibility_epoch: 9,
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

async function openGatewayEnvironmentFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_gateway_environment' }>>,
): Promise<DesktopLauncherActionResult> {
  const record = await gatewayStore().get(request.gateway_id);
  if (!record) {
    return launcherActionFailure(
      'environment_missing',
      'environment',
      'This Gateway is no longer available.',
      {
        environmentID: request.environment_id,
        shouldRefreshSnapshot: true,
      },
    );
  }
  // Gateway-backed Environments are access-only. The Standalone Gateway is
  // used to read the catalog, then Desktop opens the explicit Environment URL
  // directly; it never asks the target machine's internal Gateway for a
  // session or creates an implicit Gateway-to-Gateway hop.
  const source = await refreshGatewaySourceForAuthorizedAction(record, {
    startPolicy: record.connection.kind === 'url' ? undefined : 'require_ready',
  });
  const environment = source.environments.find((candidate) => candidate.gateway_env_id === request.gateway_env_id);
  const endpoint = environment ? gatewayEnvironmentAccessEndpoint(record, environment) : null;
  if (!endpoint) {
    return launcherActionFailure(
      'action_invalid',
      'environment',
      'This Gateway-backed Environment has no supported URL access endpoint.',
      {
        environmentID: request.environment_id,
        gatewayID: record.gateway_id,
        gatewayLabel: record.display_name,
        shouldRefreshSnapshot: true,
      },
    );
  }
  return openRemoteEnvironmentFromLauncher({
    kind: 'open_remote_environment',
    environment_id: request.environment_id,
    label: request.label,
    external_local_ui_url: endpoint,
  });

}

async function openProviderRemoteEnvironmentRecord(
  preferences: DesktopPreferences,
  environment: DesktopProviderEnvironmentRecord,
  args: Readonly<{
    remoteSessionURL: string;
    stealAppFocus?: boolean;
  }>,
): Promise<DesktopLauncherActionResult> {
  const target = buildProviderEnvironmentDesktopTarget(environment, {
    route: 'remote_desktop',
  });
  const runtimeLifecycleGeneration = runtimeLifecycleGenerationSnapshotForTarget(target);
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
    focusEnvironmentSession(existingSession.session_key, {
      stealAppFocus: args.stealAppFocus !== false,
    });
    await mutateDesktopPreferences((current) => rememberProviderEnvironmentUse(current, environment.id));
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
    active_progress_surface: 'open',
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
      {
        stealAppFocus: args.stealAppFocus !== false,
        runtimeLifecycleGenerationSnapshot: runtimeLifecycleGeneration,
      },
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
  await mutateDesktopPreferences((current) => rememberProviderEnvironmentUse(current, environment.id));
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
  );
  if (!providerEnvironment || providerEnvironment.provider_id !== providerID) {
    throw new Error('Desktop could not find this provider environment. Sync the provider and try again.');
  }
  return openProviderRemoteEnvironmentRecord(preferences, providerEnvironment, {
    remoteSessionURL,
    stealAppFocus: true,
  });
}

async function openLocalEnvironmentFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'open_local_environment' }>>,
): Promise<DesktopLauncherActionResult> {
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
  const bridgeOpenResult = await openRuntimePlacementBridgeFromLauncher(request);
  if (bridgeOpenResult) {
    return bridgeOpenResult;
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
  return openLocalEnvironmentRecord(preferences, environment, {
    stealAppFocus: true,
  });
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
    focusEnvironmentSession(optimisticSession.session_key, {
      stealAppFocus: true,
    });
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
    active_progress_surface: 'open',
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
    focusEnvironmentSession(existingSession.session_key, {
      stealAppFocus: true,
    });
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
    const sessionRecord = await createSessionRecord(target, prepared.startup, {
      stealAppFocus: true,
    });
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
  if (!bridgeOpenResult) {
    throw new Error('SSH environments require a Runtime Placement Bridge target.');
  }
  return bridgeOpenResult;
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
  if (request.placement) {
    return request.placement;
  }
  const sshDetails = 'ssh_destination' in request
    ? sshDetailsFromRuntimeTargetRequest(request as DesktopLauncherRuntimeTargetRequest)
    : null;
  return sshDetails
    ? {
        kind: 'host_process',
        runtime_root: sshDetails.runtime_root,
        bootstrap_strategy: sshDetails.bootstrap_strategy,
        release_base_url: sshDetails.release_base_url,
      }
    : { kind: 'host_process', runtime_root: '' };
}

function authoritativeRuntimeTargetFromRequest(
  preferences: DesktopPreferences,
  environmentID: string,
  request: DesktopLauncherAnyRuntimeTargetRequest,
): Readonly<{
  hostAccess: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
}> {
  const localEnvironment = findLocalEnvironmentByID(preferences, environmentID);
  if (localEnvironment) {
    return {
      hostAccess: { kind: 'local_host' },
      placement: localHostRuntimeLifecyclePlacement(localEnvironment),
    };
  }
  return {
    hostAccess: runtimeHostAccessFromRequest(request),
    placement: runtimePlacementFromRequest(request),
  };
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


function localHostRuntimeLifecyclePlacement(
  environment: DesktopLocalEnvironmentState,
): Extract<DesktopRuntimePlacement, Readonly<{ kind: 'host_process' }>> {
  return {
    kind: 'host_process',
    runtime_root: localEnvironmentRuntimeRoot(environment),
    runtime_state_root: localEnvironmentStateRoot(),
  };
}

function localHostRuntimeLifecycleTargetKey(environment: DesktopLocalEnvironmentState): string {
  return runtimeLifecycleTargetKey({ kind: 'local_host' }, localHostRuntimeLifecyclePlacement(environment));
}


function runtimePlacementBridgeRecordForRequest(
  request: DesktopLauncherAnyRuntimeTargetRequest,
): RuntimePlacementBridgeRecord | null {
  return runtimePlacementBridgeRegistry.get(runtimeTargetIDFromRequest(request));
}

function savedRuntimePlacementReadyRecord(
  targetID: DesktopRuntimeTargetID,
  environmentID: string,
  label: string,
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
): RuntimePlacementReadyRecord | null {
  const placementReady = runtimePlacementReadyByTargetID.get(targetID) ?? null;
  if (placementReady || hostAccess.kind !== 'ssh_host' || placement.kind !== 'host_process') {
    return placementReady;
  }
  const sshReady = sshRuntimeReadyByKey.get(
    sshDesktopSessionKey(sshDetailsFromRuntimePlacement(hostAccess, placement)),
  ) ?? null;
  if (!sshReady) {
    return null;
  }
  const readyRecord: RuntimePlacementReadyRecord = {
    runtime_key: targetID,
    environment_id: environmentID,
    label,
    target_id: providerRuntimeLinkTargetIDForRuntimeTarget(hostAccess, targetID),
    host_access: hostAccess,
    // The bridge and Runtime daemon both accept the installation root. The
    // startup report's state_dir points at the nested local-environment state
    // directory, which is not a valid bridge --state-root.
    placement,
    runtime_binary_path: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
    startup: sshReady.startup,
  };
  runtimePlacementReadyByTargetID.set(targetID, readyRecord);
  return readyRecord;
}

function runtimeBridgeStartCanRecover(error: unknown): boolean {
  return error instanceof DesktopSSHRemoteCommandError
    || error instanceof DesktopSSHTransportInterruptedError
    || error instanceof DesktopSSHTransportUnavailableError;
}


async function assertRuntimeTargetContainerRunning(
  hostAccess: DesktopRuntimeHostAccess,
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
  credentialScope: string,
  sshPassword?: string,
): Promise<Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>> {
  const resolver = runtimeContainerResolver(hostAccess, credentialScope, undefined, sshPassword);
  const resolution = await resolveRuntimeContainerPlacement(resolver, placement)
    .finally(() => resolver.release());
  if (resolution.status === 'running') {
    return resolution.placement;
  }
  throw new Error(resolution.message);
}

async function prepareRuntimeContainerForLifecycle(
  hostAccess: DesktopRuntimeHostAccess,
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
  credentialScope: string,
  options: Readonly<{
    startIfNeeded: boolean;
    sshPassword?: string;
    signal?: AbortSignal;
    onProgress?: (phase: Extract<DesktopRuntimeLifecyclePhase, 'checking_container' | 'starting_runtime_process'>, detail: string) => void;
  }>,
): Promise<Awaited<ReturnType<typeof prepareRuntimeContainerLifecycleTarget>>> {
  const executor = runtimeHostExecutor(hostAccess, credentialScope, options.sshPassword);
  const commandOptions = () => ({
    ...(options.signal ? { signal: options.signal } : {}),
  });
  try {
    options.onProgress?.('checking_container', 'Desktop is checking the selected container before changing the Runtime.');
    return await prepareRuntimeContainerLifecycleTarget({
      inspect: async (engine, reference) => parseContainerInspectJSON(
        engine,
        (await executor.run(containerInspectCommand(engine, reference), commandOptions())).stdout,
      ),
      start: async (engine, reference) => {
        options.onProgress?.('starting_runtime_process', 'Desktop is starting the selected container before changing the Runtime.');
        await executor.run(containerStartCommand(engine, reference), commandOptions());
      },
    }, placement, options);
  } finally {
    await executor.release();
  }
}


async function openRuntimePlacementBridgeFromLauncher(
  request: DesktopLauncherOpenRuntimeTargetRequest,
): Promise<DesktopLauncherActionResult | null> {
  const pendingReinstall = await pendingReinstallOperationForEnvironment(
    runtimeTargetEnvironmentIDFromRequest(request),
  );
  if (pendingReinstall) {
    return launcherActionSuccess('reinstall_target_in_progress', {
      operationKey: pendingReinstall.operation_key,
    });
  }
  const lifecycleHostAccess = runtimeHostAccessFromRequest(request);
  const lifecyclePlacement = runtimePlacementFromRequest(request);
  if (lifecyclePlacement.kind !== 'container_process' && lifecycleHostAccess.kind !== 'ssh_host') {
    return null;
  }
  const targetID = runtimeTargetIDFromRequest(request);
  const lifecycleTargetKey = runtimeLifecycleTargetKey(lifecycleHostAccess, lifecyclePlacement);
  const pendingOpen = pendingRuntimePlacementOpenByTargetID.get(targetID) ?? null;
  if (pendingOpen) {
    return pendingOpen;
  }
  const previousOpenOperation = launcherOperations.get(`${targetID}:open`);
  if (!previousOpenOperation || (
    previousOpenOperation.status !== 'running'
    && previousOpenOperation.status !== 'needs_confirmation'
  )) {
    managedEnvironmentOpenRecoveryAttemptsByTargetID.delete(targetID);
    managedEnvironmentOpenBridgeRecoveryAttemptsByTargetID.delete(targetID);
  }
  const openTaskRef: { task?: Promise<DesktopLauncherActionResult | null> } = {};
  const runOpenTask = async (
    joinedLifecycleMutation: boolean,
  ): Promise<DesktopLauncherActionResult | null> => {
    const openStartedAtUnixMS = Date.now();
    let runtimeProbeDurationMS: number | undefined;
    let bridgeProxyDurationMS: number | undefined;
    let desktopModelSourceDurationMS: number | undefined;
    const hostAccess = lifecycleHostAccess;
    let placement = lifecyclePlacement;
    const environmentID = runtimeTargetEnvironmentIDFromRequest(request);
    const label = runtimeTargetLabelFromRequest(request);
    const sessionKey = desktopSessionKeyFromRuntimeTargetID(targetID);
    const existingSession = liveSession(sessionKey);
    if (existingSession) {
      if (sessionTransportRecoveryFailed(existingSession)) {
        await finalizeSessionClosure(existingSession.session_key);
      } else {
        if (existingSession.lifecycle === 'opening') {
          return launcherActionFailureForOpeningSession(existingSession, {
            environmentID,
          });
        }
        focusEnvironmentSession(existingSession.session_key, {
          stealAppFocus: true,
        });
        return launcherActionSuccess('focused_environment_window', {
          sessionKey: existingSession.session_key,
        });
      }
    }
    const runtimeProbeStartedAtUnixMS = Date.now();
    if (!joinedLifecycleMutation) {
      await refreshWelcomeRuntimeHealthForEnvironment(environmentID);
    }
    runtimeProbeDurationMS = Date.now() - runtimeProbeStartedAtUnixMS;
    const existingBridge = runtimePlacementBridgeRegistry.get(targetID);
    let readyRecord = savedRuntimePlacementReadyRecord(
      targetID,
      environmentID,
      label,
      hostAccess,
      placement,
    );
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
    const operationKey = `${targetID}:open`;
    const checkingOpenPresentation = {
      status: 'running' as const,
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
      failure: undefined,
      next_actions: undefined,
      runtime_confirmation: undefined,
    } as const;
    const continuingOperation = launcherOperations.get(operationKey);
    const operation = continuingOperation?.status === 'running'
      ? launcherOperations.update(operationKey, checkingOpenPresentation)!
      : launcherOperations.create({
          operation_key: operationKey,
          action: 'open_local_environment',
          subject_kind: 'runtime_target',
          subject_id: targetID,
          environment_id: environmentID,
          environment_label: label,
          active_progress_surface: 'open',
          ...checkingOpenPresentation,
        });
    const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;
    const preferences = await loadDesktopPreferencesCached();
    const desktopModelSourceState: {
      current: ManagedDesktopModelSource | null;
    } = { current: null };
    let desktopModelSourceTask: Promise<void> | null = null;
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
            const recoveryAttempts = managedEnvironmentOpenRecoveryAttemptsByTargetID.get(targetID) ?? 0;
            if (recoveryAttempts >= 2) {
              const failure = desktopOperationFailurePresentation({
                code: 'ssh_runtime_status_unavailable',
                title: 'Runtime Recovery Incomplete',
                summary: 'Desktop completed Runtime recovery but still could not verify the Env App connection.',
                recoveryHint: 'Refresh the Runtime status, then retry Open. If the Runtime remains unavailable, update it again from this Environment card.',
                targetLabel: label,
              });
              const result = launcherActionFailure(
                'runtime_not_ready',
                'environment',
                failure.summary,
                { environmentID, shouldRefreshSnapshot: true, failure },
              );
              launcherOperations.finish(operationKey, 'failed', {
                phase: 'failed',
                title: 'Runtime recovery incomplete',
                detail: failure.summary,
                next_actions: openConnectionFailureNextActions(operationKey, environmentID, {
                  includeUpdateRuntime: true,
                  desktopUpdateAvailable: desktopUpdateHandoffAvailable(preferences, environmentID),
                  retryAction: request,
                }),
                failure,
              });
              managedEnvironmentOpenRecoveryAttemptsByTargetID.delete(targetID);
              managedEnvironmentOpenBridgeRecoveryAttemptsByTargetID.delete(targetID);
              return {
                ...result,
                operation_key: operationKey,
              };
            }
            managedEnvironmentOpenRecoveryAttemptsByTargetID.set(targetID, recoveryAttempts + 1);
            updateOpenConnectionOperation(operationKey, {
              hostAccess,
              placement,
              phase: 'ensuring_runtime_ready',
              environmentID,
              environmentLabel: label,
              targetID,
              targetLabel: label,
              title: 'Preparing Runtime',
              detail: 'Desktop is selecting and completing the safe Runtime recovery needed before opening this environment.',
            });
            const recoveryRequest = {
              ...request,
              kind: 'start_environment_runtime' as const,
              environment_id: environmentID,
              label,
            };
            const lifecycleResult = await runEnvironmentRuntimeLifecycleFromLauncher(recoveryRequest, {
              openRecovery: {
                operationKey,
                confirmationContinuation: async () => {
                  const continued = await openRuntimePlacementBridgeFromLauncher(request);
                  return continued ?? launcherActionFailure(
                    'runtime_not_ready',
                    'environment',
                    'Desktop could not continue opening this Runtime target after confirmation.',
                    { environmentID, shouldRefreshSnapshot: true },
                  );
                },
              },
            });
            if (!lifecycleResult.ok) {
              if (lifecycleResult.code === 'confirmation_required') {
                return lifecycleResult;
              }
              const failure = lifecycleResult.failure ?? desktopOperationFailurePresentation({
                code: 'operation_failed',
                title: 'Runtime Recovery Failed',
                summary: lifecycleResult.message,
                recoveryHint: 'Retry the Runtime recovery, or refresh status if the target changed outside Desktop.',
                targetLabel: label,
              });
              launcherOperations.finish(operationKey, signal?.aborted ? 'canceled' : 'failed', {
                phase: signal?.aborted ? 'canceled' : 'failed',
                title: signal?.aborted ? 'Open canceled' : 'Runtime recovery failed',
                detail: signal?.aborted ? 'Desktop canceled this Open request.' : failure.summary,
                ...(signal?.aborted ? {} : {
                  next_actions: openConnectionFailureNextActions(operationKey, environmentID, {
                    includeUpdateRuntime: true,
                    desktopUpdateAvailable: desktopUpdateHandoffAvailable(preferences, environmentID),
                    retryAction: request,
                  }),
                  failure,
                }),
              });
              managedEnvironmentOpenRecoveryAttemptsByTargetID.delete(targetID);
              managedEnvironmentOpenBridgeRecoveryAttemptsByTargetID.delete(targetID);
              return {
                ...lifecycleResult,
                operation_key: operationKey,
              };
            }
            // This Open request intentionally advanced the lifecycle
            await refreshWelcomeRuntimeHealthForEnvironment(environmentID);
            readyRecord = savedRuntimePlacementReadyRecord(
              targetID,
              environmentID,
              label,
              hostAccess,
              placement,
            );
            if (!readyRecord) {
              throw new GatewayClientError(
                'RUNTIME_RECOVERY_NOT_READY',
                'Runtime recovery completed, but Desktop could not verify the Runtime connection. Refresh status and retry Open.',
              );
            }
          }
        }
        let runtimeBinaryPath = readyRecord!.runtime_binary_path;
        placement = readyRecord!.placement;
        const sshPassword = savedRuntimePlacementSSHPassword(
          preferences,
          hostAccess,
          placement,
          targetID,
          environmentID,
          request.ssh_password,
        );
        updateOpenConnectionOperation(operationKey, {
          hostAccess,
          placement,
          phase: 'opening_bridge_proxy',
          environmentID,
          environmentLabel: label,
          targetID,
          targetLabel: label,
          title: 'Opening bridge proxy',
          detail: 'Desktop is opening the loopback Desktop bridge for this runtime.',
        });
        const bridgeProxyStartedAtUnixMS = Date.now();
        let bridgeRecoveryAttempt = 0;
        let bridgeStartupRetryAttempt = 0;
        for (;;) {
          try {
            bridgeSession = await startRuntimePlacementBridgeSession({
              host_access: hostAccess,
              placement,
              runtime_binary_path: runtimeBinaryPath,
              ssh_password: sshPassword,
              ssh_credential_scope: targetID,
              ssh_transport_manager: desktopSSHTransportManager,
              fallback_local_id: environmentID,
              signal,
            });
            break;
          } catch (error) {
            const bridgeCanRetryDuringStartup = hostAccess.kind === 'ssh_host'
              && runtimeBridgeStartCanRecover(error)
              && bridgeStartupRetryAttempt < MANAGED_ENVIRONMENT_OPEN_BRIDGE_START_RETRY_DELAYS_MS.length;
            if (bridgeCanRetryDuringStartup) {
              const delayMS = MANAGED_ENVIRONMENT_OPEN_BRIDGE_START_RETRY_DELAYS_MS[bridgeStartupRetryAttempt];
              bridgeStartupRetryAttempt += 1;
              updateOpenConnectionOperation(operationKey, {
                hostAccess,
                placement,
                phase: 'opening_bridge_proxy',
                environmentID,
                environmentLabel: label,
                targetID,
                targetLabel: label,
                title: 'Waiting for Runtime',
                detail: 'The Runtime is still starting. Desktop will retry the connection before restarting it.',
              });
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                  signal?.removeEventListener('abort', onAbort);
                  resolve();
                }, delayMS);
                const onAbort = () => {
                  clearTimeout(timer);
                  signal?.removeEventListener('abort', onAbort);
                  reject(signal?.reason ?? new DOMException('Open canceled.', 'AbortError'));
                };
                signal?.addEventListener('abort', onAbort, { once: true });
              });
              continue;
            }
            const bridgeRecoveryAttempts = managedEnvironmentOpenBridgeRecoveryAttemptsByTargetID.get(targetID) ?? 0;
            if (
              hostAccess.kind !== 'ssh_host'
              || !runtimeBridgeStartCanRecover(error)
              || bridgeRecoveryAttempt >= 1
              || bridgeRecoveryAttempts >= MAX_MANAGED_ENVIRONMENT_OPEN_BRIDGE_RECOVERY_ATTEMPTS
            ) {
              if (
                hostAccess.kind === 'ssh_host'
                && runtimeBridgeStartCanRecover(error)
                && bridgeRecoveryAttempts >= MAX_MANAGED_ENVIRONMENT_OPEN_BRIDGE_RECOVERY_ATTEMPTS
              ) {
                throw new DesktopOperationFailureError(desktopOperationFailurePresentation({
                  code: 'ssh_runtime_launch_failed',
                  title: 'Runtime connection failed',
                  summary: 'The SSH Runtime was restarted, but Desktop still could not connect to it.',
                  recoveryHint: 'Refresh status and retry Open. If it continues, update the Runtime from this environment card.',
                  targetLabel: label,
                  diagnostics: error instanceof DesktopSSHRemoteCommandError
                    ? [{
                        channel: 'ssh_runtime_bridge',
                        label: 'SSH Runtime bridge',
                        text: [
                          `exit_code=${error.commandResult.exit_code ?? 'unknown'}`,
                          error.commandResult.signal ? `signal=${error.commandResult.signal}` : '',
                          error.commandResult.stderr,
                          error.commandResult.stdout,
                        ].filter((value) => compact(value) !== '').join('\n'),
                      }]
                    : [{
                        channel: 'ssh_runtime_bridge',
                        label: 'SSH Runtime bridge',
                        text: error instanceof Error ? error.message : String(error),
                      }],
                }));
              }
              throw error;
            }
            bridgeRecoveryAttempt += 1;
            managedEnvironmentOpenBridgeRecoveryAttemptsByTargetID.set(
              targetID,
              bridgeRecoveryAttempts + 1,
            );
            updateOpenConnectionOperation(operationKey, {
              hostAccess,
              placement,
              phase: 'ensuring_runtime_ready',
              environmentID,
              environmentLabel: label,
              targetID,
              targetLabel: label,
              title: 'Restarting Runtime',
              detail: 'The SSH Runtime stopped while Desktop was connecting. Desktop is restarting it and will retry Open.',
            });
            const recoveryResult = await runEnvironmentRuntimeLifecycleFromLauncher({
              ...request,
              kind: 'restart_environment_runtime' as const,
              environment_id: environmentID,
              label,
            }, {
              openRecovery: {
                operationKey,
                requiredOperation: 'restart',
                confirmationContinuation: async () => {
                  const continued = await openRuntimePlacementBridgeFromLauncher(request);
                  return continued ?? launcherActionFailure(
                    'runtime_not_ready',
                    'environment',
                    'Desktop could not continue opening this Runtime target after confirmation.',
                    { environmentID, shouldRefreshSnapshot: true },
                  );
                },
              },
            });
            if (!recoveryResult.ok) {
              if (recoveryResult.code === 'confirmation_required') {
                return recoveryResult;
              }
              throw new DesktopOperationFailureError(recoveryResult.failure ?? desktopOperationFailurePresentation({
                code: 'ssh_runtime_launch_failed',
                title: 'Runtime Restart Failed',
                summary: recoveryResult.message,
                recoveryHint: 'Refresh the Runtime status, then retry Open.',
                targetLabel: label,
              }));
            }
            await refreshWelcomeRuntimeHealthForEnvironment(environmentID);
            readyRecord = savedRuntimePlacementReadyRecord(
              targetID,
              environmentID,
              label,
              hostAccess,
              placement,
            );
            if (!readyRecord) {
              throw new DesktopOperationFailureError(desktopOperationFailurePresentation({
                code: 'ssh_runtime_status_unavailable',
                title: 'Runtime Recovery Incomplete',
                summary: 'Runtime restarted, but Desktop could not verify the SSH Runtime connection.',
                recoveryHint: 'Refresh the Runtime status, then retry Open.',
                targetLabel: label,
              }));
            }
            placement = readyRecord.placement;
            runtimeBinaryPath = readyRecord.runtime_binary_path;
          }
        }
        bridgeProxyDurationMS = Date.now() - bridgeProxyStartedAtUnixMS;
        let readiness: Awaited<ReturnType<typeof probeExternalLocalUIStartup>>;
        for (;;) {
          updateOpenConnectionOperation(operationKey, {
            hostAccess,
            placement,
            phase: 'checking_env_app_readiness',
            environmentID,
            environmentLabel: label,
            targetID,
            targetLabel: label,
            title: 'Checking app readiness',
            detail: 'Desktop is validating Runtime health, Env App HTML, static assets, and protocol readiness through the bridge.',
          });
          readiness = await probeExternalLocalUIStartup(bridgeSession.startup.local_ui_url, {
            timeoutMs: DESKTOP_RUNTIME_PROBE_TIMEOUT_MS,
            signal,
          });
          if (readiness.ok) {
            break;
          }

          const readinessFailure = desktopFailureForRuntimePlacementBridgeReadiness(
            readiness.failure,
            bridgeSession.startup,
            label,
          );
          const recoveryAttempts = managedEnvironmentOpenRecoveryAttemptsByTargetID.get(targetID) ?? 0;
          if (recoveryAttempts >= 2 || readinessFailure.code === 'desktop_update_required') {
            throw new DesktopOperationFailureError(readinessFailure);
          }
          managedEnvironmentOpenRecoveryAttemptsByTargetID.set(targetID, recoveryAttempts + 1);
          const requiredOperation: ManagedRuntimeLifecycleOperation = readinessFailure.code === 'runtime_update_required'
            ? 'update_runtime'
            : 'restart';
          await bridgeSession.disconnect().catch(() => undefined);
          bridgeSession = null;
          updateOpenConnectionOperation(operationKey, {
            hostAccess,
            placement,
            phase: 'ensuring_runtime_ready',
            environmentID,
            environmentLabel: label,
            targetID,
            targetLabel: label,
            title: requiredOperation === 'update_runtime' ? 'Updating Runtime' : 'Restarting Runtime',
            detail: requiredOperation === 'update_runtime'
              ? 'Desktop is repairing or updating the Runtime before retrying Open.'
              : 'Desktop is restarting the Runtime before retrying Open.',
          });
          const lifecycleResult = await runEnvironmentRuntimeLifecycleFromLauncher({
            ...request,
            kind: requiredOperation === 'update_runtime'
              ? 'update_environment_runtime' as const
              : 'restart_environment_runtime' as const,
            environment_id: environmentID,
            label,
          }, {
            openRecovery: {
              operationKey,
              requiredOperation,
              confirmationContinuation: async () => {
                const continued = await openRuntimePlacementBridgeFromLauncher(request);
                return continued ?? launcherActionFailure(
                  'runtime_not_ready',
                  'environment',
                  'Desktop could not continue opening this Runtime target after confirmation.',
                  { environmentID, shouldRefreshSnapshot: true },
                );
              },
            },
          });
          if (!lifecycleResult.ok) {
            if (lifecycleResult.code === 'confirmation_required') {
              return lifecycleResult;
            }
            throw new DesktopOperationFailureError(lifecycleResult.failure ?? readinessFailure);
          }
          await refreshWelcomeRuntimeHealthForEnvironment(environmentID);
          readyRecord = savedRuntimePlacementReadyRecord(
            targetID,
            environmentID,
            label,
            hostAccess,
            placement,
          );
          if (!readyRecord) {
            throw new DesktopOperationFailureError(desktopOperationFailurePresentation({
              code: 'ssh_runtime_status_unavailable',
              title: 'Runtime Recovery Incomplete',
              summary: 'Runtime recovery completed, but Desktop could not verify the Runtime connection.',
              recoveryHint: 'Try the operation again, or refresh status and update the Runtime.',
              targetLabel: label,
            }));
          }
          placement = readyRecord.placement;
          runtimeBinaryPath = readyRecord.runtime_binary_path;
          const nextBridgeStartedAtUnixMS = Date.now();
          bridgeSession = await startRuntimePlacementBridgeSession({
            host_access: hostAccess,
            placement,
            runtime_binary_path: runtimeBinaryPath,
            ssh_password: sshPassword,
            ssh_credential_scope: targetID,
            ssh_transport_manager: desktopSSHTransportManager,
            fallback_local_id: environmentID,
            signal,
          });
          bridgeProxyDurationMS = (bridgeProxyDurationMS ?? 0) + (Date.now() - nextBridgeStartedAtUnixMS);
        }
        const nextRecord = {
          ...bridgeRecordFromSession({
            environmentID,
            label,
            session: bridgeSession,
            runtimeBinaryPath,
          }),
          startup: {
            ...bridgeSession.startup,
            ...readiness.value,
            local_ui_url: bridgeSession.startup.local_ui_url,
            local_ui_urls: bridgeSession.startup.local_ui_urls,
            runtime_control: bridgeSession.startup.runtime_control,
          },
        };
        record = {
          ...nextRecord,
          desktop_model_source: null,
        };
        record = trackRuntimePlacementBridgeRecord(record, operationKey);
      }
      if (!runtimeServiceIsOpenable(record.startup.runtime_service)) {
        throw launcherActionFailureForRuntimeNotOpenable(record.startup, {
          environmentID: record.environment_id,
          targetLabel: record.label,
        });
      }
      if (!record.desktop_model_source) {
        updateOpenConnectionOperation(operationKey, {
          hostAccess: record.session.host_access,
          placement: record.session.placement,
          phase: 'connecting_desktop_model_source',
          environmentID: record.environment_id,
          environmentLabel: record.label,
          targetID,
          targetLabel: record.label,
          title: 'Connecting Desktop model source',
          detail: 'Desktop is preparing local model access while the Env App window loads.',
        });
        const modelSourceRecord = record;
        desktopModelSourceTask = (async () => {
          const desktopModelSourceStartedAtUnixMS = Date.now();
          desktopModelSourceState.current = await startDesktopModelSourceForStartup({
            label: modelSourceRecord.label,
            startup: modelSourceRecord.startup,
            signal,
          });
          const updatedRecord = runtimePlacementBridgeRegistry.updateIfCurrent(
            modelSourceRecord.session.placement_target_id,
            modelSourceRecord.session,
            (current) => ({
              ...current,
              desktop_model_source: desktopModelSourceState.current,
            }),
          );
          if (!updatedRecord) {
            await desktopModelSourceState.current?.stop().catch(() => undefined);
            return;
          }
          record = updatedRecord;
          desktopModelSourceDurationMS = Date.now() - desktopModelSourceStartedAtUnixMS;
        })();
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
        desktopModelSourceSettled: desktopModelSourceTask === null,
        openStartedAtUnixMS,
        transportRecovery: record.session,
      });
      if (!runtimePlacementBridgeRegistry.attachSession(targetID, record.session, sessionRecord.session_key)) {
        throw new Error('Runtime Placement Bridge ended before Desktop attached the Env App session.');
      }
      if (desktopModelSourceTask) {
        await desktopModelSourceTask;
        sessionRecord.startup = record.startup;
        markSessionDesktopModelSourceSettled(sessionRecord);
      }
      console.info('[redeven:desktop-session] waiting for session readiness', {
        session_key: sessionRecord.session_key,
        target: sessionRecord.target.label,
        transport: sessionRecord.transport.kind,
      });
      await waitForSessionInitialLoad(sessionRecord);
      console.info('[redeven:desktop-session] session ready', {
        session_key: sessionRecord.session_key,
        target: sessionRecord.target.label,
        app_ready_state: sessionRecord.app_ready_state,
      });
    } catch (error) {
      console.warn('[redeven:desktop-session] environment open failed', {
        session_key: sessionRecord?.session_key ?? sessionKey,
        target: label,
        error: error instanceof Error ? compact(error.message) : compact(error),
      });
      await desktopModelSourceState.current?.stop().catch(() => undefined);
      if (bridgeSession) {
        const tracked = runtimePlacementBridgeRegistry.get(bridgeSession.placement_target_id);
        if (tracked?.session === bridgeSession) {
          await runtimePlacementBridgeRegistry.retire(bridgeSession.placement_target_id).catch(() => undefined);
        } else {
          await bridgeSession.disconnect().catch(() => undefined);
        }
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
        ...(signal?.aborted ? {} : { next_actions: openConnectionFailureNextActions(operationKey, environmentID, {
          ...runtimeOpenFailureRecoveryActions({ error, failure }),
          desktopUpdateAvailable: desktopUpdateHandoffAvailable(preferences, environmentID),
          retryAction: request,
        }) }),
        ...(signal?.aborted ? {} : { failure }),
      });
      scheduleLauncherOperationRemoval(operationKey);
      return {
        ...launcherActionFailureFromSessionOpenError(error, {
        environmentID,
        }),
        operation_key: operationKey,
      };
    }
    resetLauncherIssueState();
    managedEnvironmentOpenRecoveryAttemptsByTargetID.delete(targetID);
    managedEnvironmentOpenBridgeRecoveryAttemptsByTargetID.delete(targetID);
    await mutateDesktopPreferences((current) => markSavedRuntimeTargetUsed(current, {
      environment_id: record!.session.placement_target_id,
      host_access: record!.session.host_access,
      placement: record!.session.placement,
    }));
    const completedOperation = launcherOperations.finish(operationKey, 'succeeded', {
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
    recordEnvironmentOpenTiming(sessionRecord!, completedOperation, {
      runtime_probe_duration_ms: runtimeProbeDurationMS,
      bridge_proxy_duration_ms: bridgeProxyDurationMS,
      desktop_model_source_duration_ms: desktopModelSourceDurationMS,
    });
    scheduleLauncherOperationRemoval(operationKey);
    return launcherActionSuccess('opened_environment_window', {
      sessionKey: sessionRecord!.session_key,
    });
  };
  const openTask = runtimeLifecycleCoordinator.runWhenReady({
    target_key: lifecycleTargetKey,
    fingerprint: runtimeLifecycleFingerprint({
      operation: 'open',
      target_id: targetID,
      host_access: lifecycleHostAccess,
      placement: lifecyclePlacement,
    }),
    operation_key: `${targetID}:open`,
    execute: ({ joined_ready_mutation }) => runOpenTask(joined_ready_mutation),
  })
    .catch((error): DesktopLauncherActionResult | null => {
      const activeIntent = runtimeLifecycleCoordinator.active(lifecycleTargetKey)?.intent;
      return launcherActionFailureFromRuntimeLifecycleError(error, {
        scope: 'environment',
        environmentID: runtimeTargetEnvironmentIDFromRequest(request),
      }) ?? launcherActionFailureFromRuntimeStartError(error, {
        environmentID: runtimeTargetEnvironmentIDFromRequest(request),
        operation: runtimeStartFailureOperationForIntent(activeIntent),
      });
    })
    .finally(() => {
      if (openTaskRef.task && pendingRuntimePlacementOpenByTargetID.get(targetID) === openTaskRef.task) {
        pendingRuntimePlacementOpenByTargetID.delete(targetID);
      }
    });
  openTaskRef.task = openTask;
  pendingRuntimePlacementOpenByTargetID.set(targetID, openTask);
  return openTask;
}

type EnvironmentRuntimeLifecycleExecutionOptions = Readonly<{
  openRecovery?: Readonly<{
    operationKey: string;
    confirmationContinuation: () => Promise<DesktopLauncherActionResult>;
    requiredOperation?: ManagedRuntimeLifecycleOperation;
  }>;
}>;

function clearSupersededRuntimeLifecycleFailures(targetID: string, currentOperationKey: string): void {
  for (const snapshot of launcherOperations.operations()) {
    if (
      snapshot.operation_key !== currentOperationKey
      && snapshot.subject_kind === 'runtime_target'
      && snapshot.subject_id === targetID
      && snapshot.active_progress_surface === 'runtime_lifecycle'
      && (
        snapshot.status === 'failed'
        || snapshot.status === 'cleanup_failed'
        || snapshot.status === 'canceled'
      )
    ) {
      removeLauncherOperation(snapshot.operation_key);
    }
  }
}

async function executeDirectManagedEnvironmentLifecycle(input: Readonly<{
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'start_environment_runtime' | 'restart_environment_runtime' | 'update_environment_runtime' | 'stop_environment_runtime' }>>;
  environment_id: string;
  label: string;
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  operation: 'start' | 'stop' | 'restart' | 'update';
  operation_key: string;
  operation_owner: 'runtime_lifecycle' | 'open';
}>): Promise<DesktopLauncherActionResult> {
  const targetKey = runtimeLifecycleTargetKey(input.host_access, input.placement);
  const targetID = desktopRuntimeTargetID(input.host_access, input.placement, input.environment_id);
  const signal = launcherOperations.operationSignal(input.operation_key) ?? undefined;
  const execute = async (lifecycleSignal: AbortSignal): Promise<DesktopLauncherActionResult> => {
    const existingOperation = launcherOperations.get(input.operation_key);
    if (!existingOperation) {
      throw new Error('Runtime lifecycle operation was not created before execution.');
    }
    const operation = existingOperation;
    const owner = {
      action: operation.action,
      started_at_unix_ms: operation.started_at_unix_ms,
    };
    _initializeRuntimeLifecycleOperation(input.operation_key, operation, {
      hostAccess: input.host_access,
      placement: input.placement,
      lifecycleOperation: input.operation,
      targetID,
      targetLabel: input.label,
      detail: 'Desktop is checking the registered direct Runtime target.',
    });
    const updateProgress = (
      phase: DesktopRuntimeLifecyclePhase,
      title: string,
      detail: string,
      planPatch?: RuntimeLifecyclePlanPatch,
      tasks?: readonly DesktopComponentTaskProgress[],
    ): void => {
      updateRuntimeLifecycleOperation(input.operation_key, owner, {
        hostAccess: input.host_access,
        placement: input.placement,
        operation: input.operation,
        phase,
        targetID,
        targetLabel: input.label,
        title,
        detail,
        planPatch,
        tasks,
      });
    };
    const reportContainerProgress = concurrentRuntimePreparationReporter<RuntimePlacementProgress>({
      strategy: 'desktop_upload',
      mapPhase: runtimeLifecyclePhaseFromPlacement,
      helperPhase: 'preparing_maintenance_helper',
      helperReadyPhase: 'maintenance_helper_ready',
      runtimeReadyPhase: 'runtime_package_ready',
      discoveringPhase: 'discovering_runtime_instances',
      runtimeTaskPhase: (phase) => phase === 'preparing_runtime_package' ? 'preparing' : null,
      update: updateProgress,
    });
    const reportSSHProgress = concurrentRuntimePreparationReporter<DesktopSSHRuntimeProgress>({
      strategy: input.host_access.kind === 'ssh_host'
        && sshDetailsFromRuntimePlacement(input.host_access, input.placement).bootstrap_strategy === 'remote_install'
        ? 'remote_install'
        : 'desktop_upload',
      mapPhase: sshRuntimeLifecyclePhase,
      helperPhase: 'ssh_preparing_process_helper',
      helperReadyPhase: 'ssh_process_helper_ready',
      runtimeReadyPhase: 'ssh_runtime_package_ready',
      discoveringPhase: 'ssh_discovering_runtime_instances',
      cleanupPhase: 'ssh_cleaning_startup_resources',
      runtimeTaskPhase: (phase) => {
        switch (phase) {
          case 'ssh_preparing_upload': return 'preparing';
          case 'ssh_remote_installing':
          case 'ssh_creating_upload_dir':
          case 'ssh_uploading_archive':
          case 'ssh_installing_upload': return 'transferring';
          default: return null;
        }
      },
      update: updateProgress,
    });
    const preferences = await loadDesktopPreferencesCached();
    const closeOwnedSessions = async (): Promise<void> => {
      if (input.operation === 'start') {
        return;
      }
      await closeEnvironmentSessionsForRuntimeLifecycle({
        operation: input.operation,
        scope: {
          kind: 'session_key',
          session_key: input.host_access.kind === 'local_host' && input.placement.kind === 'host_process'
            ? buildManagedLocalRuntimeDesktopTarget(input.environment_id, input.label).session_key
            : desktopSessionKeyFromRuntimeTargetID(targetID),
        },
        ...(input.operation_owner === 'open'
          ? { preserved_open_operation_key: input.operation_key }
          : {}),
      });
      await clearRuntimePlacementTargetRecords(targetID).catch(() => undefined);
    };

    try {
      if (input.host_access.kind === 'local_host' && input.placement.kind === 'host_process') {
        const environment = findLocalEnvironmentByID(preferences, input.environment_id);
        if (!environment) {
          throw new Error('The registered Local Environment is no longer available.');
        }
        if (input.operation === 'stop') {
          await closeOwnedSessions();
          await executeDirectRuntimeStop({
            operationKey: input.operation_key,
            owner,
            hostAccess: input.host_access,
            placement: input.placement,
            targetID,
            targetLabel: input.label,
            updateProgress,
            inspect: () => inspectLocalManagedRuntimeProcesses({
              executablePath: bundledRuntimeExecutablePath(),
              runtimeRoot: input.placement.runtime_root,
              stateRoot: desktopRuntimePlacementStateRoot(input.placement),
              env: process.env,
            }),
            stop: (inventory) => stopLocalManagedRuntimeProcesses({
              executablePath: bundledRuntimeExecutablePath(),
              runtimeRoot: input.placement.runtime_root,
              stateRoot: desktopRuntimePlacementStateRoot(input.placement),
              env: process.env,
              inventory,
              timeoutMs: 5_000,
            }),
          });
          clearLocalEnvironmentRuntimeRecord(environment);
        } else {
          const prepared = await prepareManagedEnvironmentRuntime({
            environment,
            signal: lifecycleSignal,
            local_ui_bind: compact(process.env.REDEVEN_DESKTOP_LOCAL_UI_BIND),
            force_runtime_update: input.operation === 'update',
            runtime_process_intent: input.operation,
            before_runtime_replacement: closeOwnedSessions,
            on_progress: (progress) => updateProgress(
              runtimeLifecyclePhaseFromManagedRuntime(progress.phase),
              progress.title,
              progress.detail,
            ),
          });
          if (!prepared.ok) {
            throw new Error(prepared.issue.message);
          }
          updateLocalEnvironmentRuntimeRecord(
            environment,
            prepared.launch.managedRuntime.startup,
            desktopSessionRuntimeHandleFromManagedRuntime(prepared.launch.managedRuntime),
          );
        }
      } else if (input.placement.kind === 'container_process') {
        const preparedContainer = await prepareRuntimeContainerForLifecycle(
          input.host_access,
          input.placement,
          input.environment_id,
          {
            startIfNeeded: input.operation !== 'stop',
            sshPassword: savedRuntimePlacementSSHPassword(
              preferences,
              input.host_access,
              input.placement,
              targetID,
              input.environment_id,
            ),
            signal: lifecycleSignal,
            onProgress: (phase, detail) => updateProgress(phase, 'Checking container', detail),
          },
        );
        if (input.operation === 'stop' && !preparedContainer.running) {
          await closeOwnedSessions();
          updateProgress(
            'discovering_runtime_instances',
            'Discovering Runtime processes',
            'The target container is stopped; Desktop is recording the empty Runtime inventory.',
          );
          markDirectRuntimeAlreadyStopped({
            operationKey: input.operation_key,
            owner,
            hostAccess: input.host_access,
            placement: input.placement,
            targetID,
            targetLabel: input.label,
            updateProgress,
          }, 'The target container is already stopped; no Redeven Runtime process remains.');
          await clearRuntimePlacementTargetRecords(targetID).catch(() => undefined);
        } else if (input.operation === 'stop') {
          await closeOwnedSessions();
          const executor = runtimeHostExecutor(
            input.host_access,
            input.environment_id,
            savedRuntimePlacementSSHPassword(preferences, input.host_access, input.placement, targetID, input.environment_id) || undefined,
          );
          try {
            const processArgs = {
              executor,
              placement: preparedContainer.placement as Extract<DesktopRuntimePlacement, { kind: 'container_process' }>,
              runtime_binary_path: 'redeven',
              runtime_release_tag: resolveSSHRuntimeReleaseTag(),
              release_base_url: PUBLIC_REDEVEN_RELEASE_BASE_URL,
              source_runtime_root: process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT,
              asset_cache_root: desktopRuntimePackageCacheRoot(),
              signal: lifecycleSignal,
              on_progress: reportContainerProgress,
            };
            const processSession = await openContainerRuntimeProcessSession({
              ...processArgs,
              prefer_managed_helper: true,
            });
            try {
              await executeDirectRuntimeStop({
                operationKey: input.operation_key,
                owner,
                hostAccess: input.host_access,
                placement: preparedContainer.placement,
                targetID,
                targetLabel: input.label,
                updateProgress,
                inspect: processSession.inspect,
                stop: processSession.stop,
              });
            } finally {
              await processSession.close();
            }
            runtimePlacementReadyByTargetID.delete(targetID);
          } finally {
            await executor.release();
          }
        } else {
          const ready = await ensureRuntimePlacementReady({
            host_access: input.host_access,
            placement: preparedContainer.placement,
            ssh_password: savedRuntimePlacementSSHPassword(preferences, input.host_access, input.placement, targetID, input.environment_id),
            ssh_credential_scope: input.environment_id,
            ssh_transport_manager: desktopSSHTransportManager,
            runtime_release_tag: resolveSSHRuntimeReleaseTag(),
            release_base_url: PUBLIC_REDEVEN_RELEASE_BASE_URL,
            source_runtime_root: compact(process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT) || undefined,
            asset_cache_root: desktopRuntimePackageCacheRoot(),
            force_runtime_update: input.operation === 'update',
            runtime_process_intent: input.operation,
            signal: lifecycleSignal,
            before_runtime_replacement: closeOwnedSessions,
            on_progress: reportContainerProgress,
          });
          runtimePlacementReadyByTargetID.set(targetID, {
            runtime_key: targetID,
            environment_id: input.environment_id,
            label: input.label,
            target_id: providerRuntimeLinkTargetIDForRuntimeTarget(input.host_access, targetID),
            host_access: input.host_access,
            placement: ready.placement,
            runtime_binary_path: ready.runtime_binary_path,
            startup: ready.startup,
          });
        }
      } else {
        if (input.host_access.kind !== 'ssh_host') {
          throw new Error('The registered Runtime target has an unsupported host access mode.');
        }
        const sshDetails = sshDetailsFromRuntimePlacement(input.host_access, input.placement);
        const runtimeKey = sshDesktopSessionKey(sshDetails);
        const sshPassword = savedRuntimePlacementSSHPassword(
          preferences,
          input.host_access,
          input.placement,
          targetID,
          input.environment_id,
        );
        if (input.operation === 'stop') {
          await closeOwnedSessions();
          const inventoryArgs = {
            sshTransportManager: desktopSSHTransportManager,
            sshCredentialScope: input.environment_id,
            target: sshDetails,
            runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
            sshPassword,
            sourceRuntimeRoot: process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT,
            assetCacheRoot: desktopRuntimePackageCacheRoot(),
            tempRoot: app.getPath('temp'),
            signal: lifecycleSignal,
            onProgress: reportSSHProgress,
          };
          const processSession = await openManagedSSHRuntimeProcessSession({
            ...inventoryArgs,
            preferManagedHelper: true,
          });
          try {
            await executeDirectRuntimeStop({
              operationKey: input.operation_key,
              owner,
              hostAccess: input.host_access,
              placement: input.placement,
              targetID,
              targetLabel: input.label,
              updateProgress,
              inspect: processSession.inspect,
              stop: processSession.stop,
            });
          } finally {
            await processSession.close();
          }
          clearSSHRuntimeReadyState(runtimeKey);
        } else {
          const ready = await ensureManagedSSHRuntimeReady({
            sshTransportManager: desktopSSHTransportManager,
            sshCredentialScope: input.environment_id,
            target: sshDetails,
            runtimeReleaseTag: resolveSSHRuntimeReleaseTag(),
            runtimeStateRoot: desktopRuntimePlacementStateRoot(input.placement),
            sshPassword,
            sourceRuntimeRoot: compact(process.env.REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT) || undefined,
            assetCacheRoot: desktopRuntimePackageCacheRoot(),
            forceRuntimeUpdate: input.operation === 'update',
            runtimeProcessIntent: input.operation,
            signal: lifecycleSignal,
            beforeRuntimeReplacement: closeOwnedSessions,
            onProgress: reportSSHProgress,
          });
          sshRuntimeReadyByKey.set(runtimeKey, {
            runtime_key: runtimeKey,
            environment_id: input.environment_id,
            label: input.label,
            details: sshDetails,
            startup: ready.startup,
          });
        }
      }
      await refreshWelcomeRuntimeHealthForEnvironment(input.environment_id, { force: true }).catch(() => undefined);
      const phase = input.operation === 'stop' ? 'runtime_stopped' : input.operation === 'update' ? 'runtime_updated' : input.operation === 'restart' ? 'runtime_restarted' : 'runtime_started';
      const completedLifecycleProgress = completeRuntimeLifecycleWorkflowProgress(input.operation_key, owner, {
        hostAccess: input.host_access,
        placement: input.placement,
        operation: input.operation,
        phase: input.operation === 'stop'
          ? 'runtime_stopped'
          : input.operation === 'update'
            ? 'runtime_up_to_date'
            : 'runtime_ready',
        targetID,
        targetLabel: input.label,
        detail: 'Desktop verified the direct Runtime target.',
      });
      const completedPresentation = {
        phase,
        title: input.operation === 'stop' ? 'Runtime stopped' : 'Runtime ready',
        detail: `Desktop ${input.operation === 'stop' ? 'stopped' : input.operation === 'update' ? 'updated' : input.operation === 'restart' ? 'restarted' : 'started'} the Runtime through the direct target channel.`,
        active_progress_surface: 'runtime_lifecycle',
        lifecycle_progress: completedLifecycleProgress,
      } as const;
      if (input.operation_owner === 'runtime_lifecycle') {
        launcherOperations.finishCurrentAttempt(input.operation_key, owner, 'succeeded', completedPresentation);
        scheduleCurrentLauncherOperationRemoval(input.operation_key, owner);
      } else {
        launcherOperations.updateCurrentAttempt(input.operation_key, owner, {
          ...completedPresentation,
          status: 'running',
        });
      }
      clearSupersededRuntimeLifecycleFailures(targetID, input.operation_key);
      await clearReinstallTargetRequiredForEnvironment(input.environment_id).catch(() => undefined);
      resetLauncherIssueState();
      broadcastDesktopWelcomeSnapshots();
      return launcherActionSuccess(input.operation === 'stop'
        ? 'stopped_environment_runtime'
        : input.operation === 'update'
          ? 'updated_environment_runtime'
          : input.operation === 'restart'
            ? 'restarted_environment_runtime'
            : 'started_environment_runtime');
    } catch (error) {
      const failure = desktopFailureFromError(error, {
        code: 'operation_failed',
        title: 'Environment Runtime Action Failed',
        summary: error instanceof Error ? error.message : String(error),
        targetLabel: input.label,
      });
      const failurePresentation = {
        phase: lifecycleSignal.aborted ? 'canceled' : 'failed',
        title: lifecycleSignal.aborted ? 'Runtime action canceled' : failure.title,
        detail: lifecycleSignal.aborted ? 'Desktop canceled this Runtime operation.' : failure.summary,
        active_progress_surface: 'runtime_lifecycle',
        ...(lifecycleSignal.aborted ? {} : {
          lifecycle_progress: runtimeLifecycleWorkflowFailure(input.operation_key, owner, {
            hostAccess: input.host_access,
            placement: input.placement,
            operation: input.operation,
            targetID,
            targetLabel: input.label,
            error,
            fallback: failure,
          }).lifecycle_progress,
        }),
        ...(lifecycleSignal.aborted ? {} : { failure }),
      } as const;
      if (input.operation_owner === 'runtime_lifecycle') {
        launcherOperations.finishCurrentAttempt(
          input.operation_key,
          owner,
          lifecycleSignal.aborted ? 'canceled' : 'failed',
          failurePresentation,
        );
      } else {
        launcherOperations.updateCurrentAttempt(input.operation_key, owner, {
          ...failurePresentation,
          status: lifecycleSignal.aborted ? 'canceling' : 'running',
        });
      }
      return launcherActionFailure('runtime_start_failed', 'environment', failure.summary, {
        environmentID: input.environment_id,
        operationKey: input.operation_key,
        failure,
        shouldRefreshSnapshot: true,
      });
    }
  };
  if (input.operation_owner === 'open') {
    return execute(signal ?? new AbortController().signal);
  }
  return runtimeLifecycleCoordinator.run({
    target_key: targetKey,
    intent: input.operation,
    fingerprint: runtimeLifecycleFingerprint({
      host_access: input.host_access,
      placement: input.placement,
      operation: input.operation,
    }),
    operation_key: input.operation_key,
    signal,
    execute,
  });
}

async function runEnvironmentRuntimeLifecycleFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'start_environment_runtime' | 'restart_environment_runtime' | 'update_environment_runtime' | 'stop_environment_runtime' }>>,
  options: EnvironmentRuntimeLifecycleExecutionOptions = {},
): Promise<DesktopLauncherActionResult> {
  const environmentID = runtimeTargetEnvironmentIDFromRequest(request);
  const label = runtimeTargetLabelFromRequest(request);
  if ('external_local_ui_url' in request && compact(request.external_local_ui_url) !== '') {
    return launcherActionFailure(
      'action_invalid',
      'environment',
      'URL connections open directly and do not support lifecycle actions.',
      { environmentID },
    );
  }
  const pendingReinstall = await pendingReinstallOperationForEnvironment(environmentID);
  if (pendingReinstall) {
    return launcherActionSuccess('reinstall_target_in_progress', {
      operationKey: pendingReinstall.operation_key,
    });
  }
  const preferences = await loadDesktopPreferencesCached();
  const { hostAccess, placement } = authoritativeRuntimeTargetFromRequest(
    preferences,
    environmentID,
    request,
  );
  const requestedOperation: ManagedRuntimeLifecycleOperation = request.kind === 'start_environment_runtime'
    ? 'start'
    : request.kind === 'stop_environment_runtime'
      ? 'stop'
      : request.kind === 'restart_environment_runtime'
      ? 'restart'
      : 'update_runtime';
  const coordinatorIntent = requestedOperation === 'update_runtime' ? 'update' : requestedOperation;
  const coordinatorTargetKey = runtimeLifecycleTargetKey(hostAccess, placement);
  const coordinatorFingerprint = runtimeLifecycleFingerprint({
    host_access: hostAccess,
    placement,
    operation: coordinatorIntent,
  });
  const activeLifecycle = options.openRecovery ? null : runtimeLifecycleCoordinator.active(coordinatorTargetKey);
  const matchingActiveOperation = activeLifecycle
    && activeLifecycle.intent === coordinatorIntent
    && activeLifecycle.fingerprint === coordinatorFingerprint
    && launcherOperations.get(activeLifecycle.operation_key)
      ? activeLifecycle
      : null;
  const failureOperationKey = matchingActiveOperation?.operation_key
    ?? options.openRecovery?.operationKey
    ?? (compact(request.operation_key) || `${environmentID}:${requestedOperation}`);
  const targetID = desktopRuntimeTargetID(hostAccess, placement, environmentID);
  const existingOperation = launcherOperations.get(failureOperationKey);
  const reusableOperation = existingOperation
    && (matchingActiveOperation || options.openRecovery || existingOperation.subject_id === targetID)
    && (existingOperation.status === 'running'
      || existingOperation.status === 'canceling'
      || existingOperation.status === 'cleanup_running')
    ? existingOperation
    : null;
  if (
    existingOperation
    && !reusableOperation
    && !options.openRecovery
    && (existingOperation.status === 'running'
      || existingOperation.status === 'canceling'
      || existingOperation.status === 'cleanup_running')
    && existingOperation.subject_id !== targetID
  ) {
    return launcherActionFailure(
      'runtime_lifecycle_in_progress',
      'environment',
      'Another Runtime operation is already running for a different registered target.',
      { environmentID, operationKey: failureOperationKey },
    );
  }
  if (!reusableOperation) {
    launcherOperations.create({
      operation_key: failureOperationKey,
      action: request.kind,
      subject_kind: 'runtime_target',
      subject_id: targetID,
      environment_id: environmentID,
      environment_label: label,
      phase: hostAccess.kind === 'ssh_host' ? 'checking_host' : 'checking_existing_runtime',
      title: requestedOperation === 'stop' ? 'Stopping Runtime' : requestedOperation === 'update_runtime' ? 'Updating Runtime' : requestedOperation === 'restart' ? 'Restarting Runtime' : 'Starting Runtime',
      title_key: runtimeLifecycleTitleKey(requestedOperation === 'update_runtime' ? 'update_runtime' : requestedOperation),
      detail: 'Desktop is checking the registered direct Runtime target.',
      active_progress_surface: 'runtime_lifecycle',
      cancelable: requestedOperation !== 'stop',
      interrupt_label: 'Stop operation',
      interrupt_detail: 'Desktop is canceling this Runtime operation.',
      interrupt_kind: 'generic',
      started_at_unix_ms: request.operation_started_at_unix_ms,
    });
  }
  return executeDirectManagedEnvironmentLifecycle({
    request,
    environment_id: environmentID,
    label,
    host_access: hostAccess,
    placement,
    operation: coordinatorIntent,
    operation_key: failureOperationKey,
    operation_owner: options.openRecovery ? 'open' : 'runtime_lifecycle',
  });
}

async function startEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'start_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  return runEnvironmentRuntimeLifecycleFromLauncher(request);
}

async function updateEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'update_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
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
  await showDesktopUpdateHandoffDialog();
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
  try {
    const target = await resolveProviderDesktopSessionTarget(preferences, environment);
    const authorized = await ensureControlPlaneAccessToken(target.preferences, target.controlPlane);
    const accessPoint = providerAccessPointForEnvironment(authorized.controlPlane, environment);
    const runtimeLink = await requestProviderRuntimeLinkAuthorization(
      authorized.controlPlane.provider,
      accessPoint,
      authorized.accessToken,
      environment.env_public_id,
    );
    const linked = await connectProviderLink(runtimeControl, {
      provider_origin: authorized.controlPlane.provider.provider_origin,
      provider_id: authorized.controlPlane.provider.provider_id,
      env_public_id: environment.env_public_id,
      access_point_origin: environment.access_point_origin,
      runtime_link_ticket: runtimeLink.runtime_link_ticket,
      expected_current_binding: currentBinding.state === 'linked'
        ? {
            provider_origin: currentBinding.provider_origin,
            provider_id: currentBinding.provider_id,
            env_public_id: currentBinding.env_public_id,
            access_point_origin: currentBinding.access_point_origin,
            binding_generation: currentBinding.binding_generation,
          }
        : undefined,
    });
    updateProviderRuntimeTargetStartup(runtimeTarget, {
      provider_origin: linked.binding.provider_origin,
      controlplane_base_url: linked.binding.access_point_origin,
      controlplane_provider_id: linked.binding.provider_id,
      env_public_id: linked.binding.env_public_id,
      effective_run_mode: linked.runtime_service.effective_run_mode,
      remote_enabled: linked.runtime_service.remote_enabled,
      runtime_service: linked.runtime_service,
    });
    await mutateDesktopPreferences((current) => runtimeTarget.kind === 'local_environment'
      ? persistLocalEnvironmentProviderBinding(rememberProviderEnvironmentUse(current, environment.id), environment)
      : rememberProviderEnvironmentUse(current, environment.id));
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
        access_point_origin: candidate.access_point_origin,
      })
        ? candidate
        : null;
    }
    return preferences.provider_environments.find((candidate) => desktopRuntimeProviderBindingMatches(currentBinding, {
      provider_origin: candidate.provider_origin,
      provider_id: candidate.provider_id,
      env_public_id: candidate.env_public_id,
      access_point_origin: candidate.access_point_origin,
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
      provider_origin: '',
      controlplane_base_url: '',
      controlplane_provider_id: '',
      env_public_id: '',
      effective_run_mode: unlinked.runtime_service.effective_run_mode,
      remote_enabled: unlinked.runtime_service.remote_enabled,
      runtime_service: unlinked.runtime_service,
    });
    if (runtimeTarget.kind === 'local_environment') {
      await mutateDesktopPreferences((current) => ({
        ...current,
        local_environment: {
          ...current.local_environment,
          current_provider_binding: undefined,
        },
      }));
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
  const reason = operation.interrupt_detail || 'Desktop is stopping this background task.';
  launcherOperations.cancel(request.operation_key, reason);
  runtimeLifecycleCoordinator.cancelByOperationKey(
    request.operation_key,
    new DOMException(reason, 'AbortError'),
  );
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
    && operation.status !== 'needs_confirmation'
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
  const pendingConfirmation = pendingRuntimeOperationConfirmations.get(request.operation_key);
  pendingRuntimeOperationLeases.get(request.operation_key)?.stop();
  pendingRuntimeOperationLeases.delete(request.operation_key);
  if (pendingConfirmation) {
    pendingRuntimeOperationConfirmations.delete(request.operation_key);
    await pendingConfirmation.cancel().catch(() => undefined);
  }
  removeLauncherOperation(request.operation_key);
  broadcastDesktopWelcomeSnapshots();
  return launcherActionSuccess('dismissed_launcher_operation');
}

async function stopEnvironmentRuntimeFromLauncher(
  request: Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'stop_environment_runtime' }>>,
): Promise<DesktopLauncherActionResult> {
  return runEnvironmentRuntimeLifecycleFromLauncher(request);
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

  const { hostAccess, placement } = authoritativeRuntimeTargetFromRequest(
    preferences,
    environmentID,
    request,
  );
  const targetKey = runtimeLifecycleTargetKey(hostAccess, placement);
  const targetID = desktopRuntimeTargetID(hostAccess, placement, environmentID);
  const label = runtimeTargetLabelFromRequest(request);
  const operationKey = compact(request.operation_key) || `${environmentID}:refresh`;
  const initialPhase = runtimeLifecycleInitialPhase(
    desktopRuntimeLifecycleLocation(hostAccess, placement),
  );
  let operation = launcherOperations.get(operationKey);
  if (!operation) {
    operation = launcherOperations.create({
      operation_key: operationKey,
      action: 'refresh_environment_runtime',
      subject_kind: 'runtime_target',
      subject_id: targetID,
      environment_id: environmentID,
      environment_label: label,
      phase: initialPhase,
      title: 'Refreshing Runtime status',
      title_key: 'environmentAction.refreshRuntimeStatus',
      detail: 'Desktop is checking the registered direct Runtime target.',
      detail_key: hostAccess.kind === 'ssh_host'
        ? 'progress.checkingHost'
        : placement.kind === 'container_process'
          ? 'progress.checkingContainer'
          : 'progress.checkingExistingRuntime',
      active_progress_surface: 'runtime_lifecycle',
      cancelable: false,
      started_at_unix_ms: request.operation_started_at_unix_ms,
    });
  }
  const owner = _initializeRuntimeLifecycleOperation(operationKey, operation, {
    hostAccess,
    placement,
    lifecycleOperation: 'refresh',
    targetID,
    targetLabel: label,
    detail: 'Desktop is checking the registered direct Runtime target.',
  });
  broadcastDesktopWelcomeSnapshots();
  try {
    return await runtimeLifecycleCoordinator.run({
      target_key: targetKey,
      intent: 'refresh',
      fingerprint: runtimeLifecycleFingerprint({
        host_access: hostAccess,
        placement,
        operation: 'refresh',
      }),
      operation_key: operationKey,
      execute: async () => {
        const localEnvironment = findLocalEnvironmentByID(preferences, environmentID);
        updateRuntimeLifecycleOperation(operationKey, owner, {
          hostAccess,
          placement,
          operation: 'refresh',
          phase: 'verifying_runtime_inventory',
          targetID,
          targetLabel: label,
          title: 'Refreshing Runtime status',
          titleKey: 'environmentAction.refreshRuntimeStatus',
          detail: 'Desktop is reading the current Runtime health through the direct target channel.',
          detailKey: 'progress.verifyingRuntimeInventory',
        });
        broadcastDesktopWelcomeSnapshots();
        await refreshWelcomeRuntimeHealthForEnvironment(environmentID);

        if (placement.kind === 'container_process') {
          const targetID = runtimeTargetIDFromRequest(request);
          const runtimeRecord = runtimePlacementBridgeRecordForRequest(request);
          const readyRecord = runtimePlacementReadyByTargetID.get(targetID) ?? null;
          const runtimeService = runtimeRecord?.startup.runtime_service ?? readyRecord?.startup?.runtime_service;
          if (runtimeService) {
            await syncLinkedProviderRuntimeHealthFromService(runtimeService).catch(() => undefined);
          }
        } else {
          const sshDetails = sshDetailsFromRuntimeTargetRequest(request);
          if (sshDetails) {
            const runtimeKey = sshDesktopSessionKey(sshDetails);
            const sshHostAccess: DesktopRuntimeHostAccess = {
              kind: 'ssh_host',
              ssh: sshDetails,
            };
            const hostPlacement: DesktopRuntimePlacement = {
              kind: 'host_process',
              runtime_root: sshDetails.runtime_root,
            };
            const bridgeObservation = await observeRuntimePlacementBridgeRecord(
              desktopRuntimeTargetID(sshHostAccess, hostPlacement),
            );
            const runtimeRecord = bridgeObservation.kind === 'absent' ? null : bridgeObservation.record;
            const readyRecord = sshRuntimeReadyByKey.get(runtimeKey) ?? null;
            const runtimeService = runtimeRecord?.startup.runtime_service ?? readyRecord?.startup.runtime_service;
            if (runtimeService) {
              await syncLinkedProviderRuntimeHealthFromService(runtimeService).catch(() => undefined);
            }
          } else if (localEnvironment?.local_hosting) {
            const runtimeRecord = await verifyCurrentLocalEnvironmentRuntimeRecord(localEnvironment)
              ?? await attachLocalEnvironmentRuntime(localEnvironment);
            if (runtimeRecord?.startup.runtime_service) {
              await syncLinkedProviderRuntimeHealthFromService(runtimeRecord.startup.runtime_service).catch(() => undefined);
            }
          }
        }
        const lifecycleProgress = completeRuntimeLifecycleWorkflowProgress(operationKey, owner, {
          hostAccess,
          placement,
          operation: 'refresh',
          phase: 'verifying_runtime_inventory',
          targetID,
          targetLabel: label,
          detail: 'Desktop refreshed the current Runtime health through the direct target channel.',
        });
        launcherOperations.finishCurrentAttempt(operationKey, owner, 'succeeded', {
          phase: 'runtime_status_refreshed',
          title: 'Runtime status refreshed',
          title_key: 'environmentAction.refreshRuntimeStatus',
          detail: 'Desktop refreshed the current Runtime health through the direct target channel.',
          detail_key: 'progress.verifyingRuntimeInventory',
          active_progress_surface: 'runtime_lifecycle',
          lifecycle_progress: lifecycleProgress,
        });
        scheduleCurrentLauncherOperationRemoval(operationKey, owner);
        clearSupersededRuntimeLifecycleFailures(targetID, operationKey);
        resetLauncherIssueState();
        broadcastDesktopWelcomeSnapshots();
        return launcherActionSuccess('refreshed_environment_runtime', {
          operationKey,
        });
      },
    });
  } catch (error) {
    const failure = desktopFailureFromError(error, {
      code: 'operation_failed',
      title: 'Runtime status refresh failed',
      summary: error instanceof Error ? error.message : String(error),
      targetLabel: label,
    });
    const lifecycleFailure = runtimeLifecycleWorkflowFailure(operationKey, owner, {
      hostAccess,
      placement,
      operation: 'refresh',
      targetID,
      targetLabel: label,
      error,
      fallback: failure,
    });
    launcherOperations.finishCurrentAttempt(operationKey, owner, 'failed', {
      phase: 'failed',
      title: failure.title,
      detail: failure.summary,
      active_progress_surface: 'runtime_lifecycle',
      lifecycle_progress: lifecycleFailure.lifecycle_progress,
      failure,
    });
    broadcastDesktopWelcomeSnapshots();
    return launcherActionFailureFromRuntimeLifecycleError(error, {
      scope: 'environment',
      environmentID,
    }) ?? launcherActionFailure(
      'runtime_start_failed',
      'environment',
      failure.summary,
      { environmentID, operationKey, failure },
    );
  }
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
  await mutateDesktopPreferences((current) => deleteSavedControlPlane(current, request.provider_origin, request.provider_id));
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

function runtimeMaintenanceContextFromSession(
  sessionRecord: DesktopSessionRecord | null,
): DesktopShellRuntimeMaintenanceContext {
  const missingMessage = 'Runtime maintenance is not available from this Desktop session.';
  if (!sessionRecord) {
    return {
      available: false,
      authority: 'manual',
      runtime_kind: 'unknown',
      management: {
        support: 'unknown',
        authorization: 'unknown',
        readiness: 'unknown',
        presentation_state: 'unknown',
        reason_code: 'desktop_session_missing',
      },
      upgrade_policy: 'manual',
      restart: unavailableRuntimeMaintenanceAction('restart', missingMessage, 'desktop_session_missing'),
      upgrade: unavailableRuntimeMaintenanceAction('upgrade', missingMessage, 'desktop_session_missing'),
    };
  }

  const runtimeHandle = sessionRecord.runtime_handle;
  const runtimeService = sessionRecord.startup.runtime_service;
  const activeWorkload = runtimeService?.active_workload;
  const base = {
    current_version: runtimeService?.runtime_version,
    active_workload: activeWorkload,
  };

  const directTarget = sessionRecord.target.kind === 'ssh_environment'
    || (sessionRecord.target.kind === 'local_environment' && sessionRecord.target.route === 'local_host');
  const unsupported = sessionRecord.target.kind === 'external_local_ui';
  const message = unsupported
    ? 'URL connections open directly and do not support lifecycle actions.'
    : directTarget
      ? 'Initialize this environment before using lifecycle actions.'
      : 'Lifecycle actions are not available for this session.';
  const reasonCode = unsupported
    ? 'runtime_management_unsupported'
    : directTarget
      ? 'runtime_gateway_setup_required'
      : 'runtime_management_unknown';
  return {
    ...base,
    available: false,
    authority: 'manual',
    runtime_kind: runtimeHandle?.runtime_kind ?? (sessionRecord.target.kind === 'external_local_ui' ? 'external' : 'unknown'),
    management: {
      support: unsupported ? 'unsupported' : directTarget ? 'supported' : 'unknown',
      authorization: directTarget ? 'allowed' : 'unknown',
      readiness: directTarget ? 'setup_required' : 'unknown',
      presentation_state: unsupported ? 'unsupported' : directTarget ? 'setup_required' : 'unknown',
      reason_code: reasonCode,
    },
    upgrade_policy: 'manual',
    restart: unavailableRuntimeMaintenanceAction('restart', message, reasonCode),
    upgrade: unavailableRuntimeMaintenanceAction('upgrade', message, reasonCode),
  };
}

function desktopShellRuntimeActionUnavailable(
  messageOrFailure: string | DesktopOperationFailurePresentation,
  options: Readonly<{
    code?: DesktopShellRuntimeActionResponse['code'];
    operationKey?: string;
  }> = {},
): DesktopShellRuntimeActionResponse {
  const failure = typeof messageOrFailure === 'string' ? null : messageOrFailure;
  const message = failure?.summary ?? compact(messageOrFailure);
  return {
    ok: false,
    started: false,
    ...(options.code ? { code: options.code } : {}),
    ...(compact(options.operationKey) ? { operation_key: compact(options.operationKey) } : {}),
    message,
    ...(failure ? { failure } : {}),
  };
}

async function showDesktopUpdateHandoffDialog(): Promise<void> {
  const dialogOptions = buildDesktopUpdateHandoffMessageBoxOptions(
    createDesktopI18n(desktopLanguageState().getSnapshot().resolved_locale),
  );
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
      message: 'Desktop could not prepare this environment for an update.',
    };
  }

  await showDesktopUpdateHandoffDialog();
  return {
    ok: true,
    started: false,
    message: 'Desktop opened the update handoff.',
  };
}

type DesktopCodeWorkspacePreparationContext = Readonly<{
  signal: AbortSignal;
  onProgress: (progress: DesktopCodeWorkspaceProgressSnapshot) => void;
}>;

async function prepareCodeWorkspaceEnginePackageJob(
  platform: DesktopCodeWorkspaceEnginePackagePlatform,
  context: DesktopCodeWorkspacePreparationContext,
  operation: DesktopCodeWorkspacePreparationOperation,
): Promise<DesktopCodeWorkspacePackagePrepareResponse> {
  let currentPhase: DesktopCodeWorkspaceProgressPhase = 'lookup';
  let lastProgress: DesktopCodeWorkspaceProgressSnapshot | undefined;
  const reportProgress = (progress: DesktopCodeWorkspaceProgressSnapshot): void => {
    currentPhase = progress.phase;
    lastProgress = progress;
    context.onProgress(progress);
  };
  try {
    desktopCodeWorkspaceEnginePackageJobs.prune();
    const preparedPackage = await prepareCodeWorkspaceEnginePackage({
      cacheRoot: desktopCodeWorkspaceEnginePackageCacheRoot(),
      platform,
      fetchPolicy: {
        timeout_ms: 60_000,
        download_idle_timeout_ms: 90_000,
        signal: context.signal,
        onProgress: reportProgress,
      },
    });
    const stat = await fs.stat(preparedPackage.archive_path);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error('Workspace engine package is empty.');
    }
    if (stat.size > desktopCodeWorkspaceEnginePackageArchiveLimitBytes) {
      throw new Error(`Workspace engine package is too large (${stat.size} bytes).`);
    }
    const jobID = `cwepkg_${crypto.randomBytes(18).toString('base64url')}`;
    desktopCodeWorkspaceEnginePackageJobs.add({
      jobID,
      archivePath: preparedPackage.archive_path,
      archiveSizeBytes: stat.size,
      chunkSizeBytes: DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_SIZE_BYTES,
      createdAtMs: Date.now(),
      operation,
    });
    return {
      ok: true,
      job: {
        job_id: jobID,
        manifest: preparedPackage.manifest,
        archive_size_bytes: stat.size,
        chunk_size_bytes: DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_SIZE_BYTES,
        from_cache: preparedPackage.from_cache,
      },
    };
  } catch (error) {
    context.onProgress(terminalDesktopCodeWorkspaceProgress(
      lastProgress,
      currentPhase,
      context.signal.aborted ? 'cancelled' : 'failed',
    ));
    return {
      ok: false,
      error_code: currentPhase === 'lookup' ? 'desktop_release_lookup' : 'desktop_package_cache',
      message: error instanceof Error ? error.message : 'Desktop could not prepare the workspace package.',
    };
  }
}

function disposeCodeWorkspaceEnginePackageJob(jobID: string): DesktopCodeWorkspacePackageDisposeResponse {
  desktopCodeWorkspaceEnginePackageJobs.dispose(jobID);
  return { ok: true };
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
    case 'gateway_supervisor':
    case 'host_device_handoff':
    case 'manual':
    default:
      return desktopShellRuntimeActionUnavailable(plan.message);
  }
}

async function handleRuntimeMaintenanceStartedFromShell(
  webContentsID: number,
  operation: Exclude<RuntimeLifecycleWindowOperation, 'stop'>,
): Promise<void> {
  const sessionRecord = sessionRecordForWebContentsID(webContentsID);
  if (!sessionRecord) {
    return;
  }
  const sessionTarget = sessionRecord.target;
  await handoffSessionToRuntimeLifecycle({
    operation,
    sessionTarget,
  });
}

async function upsertSavedEnvironmentFromWelcome(
  environmentID: string,
  label: string,
  externalLocalUIURL: string,
  autoRuntimeProbeEnabled: boolean,
): Promise<void> {
  await mutateDesktopPreferences((current) => {
    const existing = current.saved_environments.find((environment) => environment.id === environmentID);
    return upsertSavedEnvironment(current, {
      environment_id: environmentID,
      label,
      local_ui_url: externalLocalUIURL,
      auto_runtime_probe_enabled: autoRuntimeProbeEnabled,
      last_used_at_ms: existing?.last_used_at_ms ?? Date.now(),
    });
  });
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
  const next = await mutateDesktopPreferences((current) => updateLocalEnvironmentSettings(current, {
    environmentID: current.local_environment.id,
    access,
  }));
  return next.local_environment;
}

async function setLocalEnvironmentPinnedFromWelcome(
  environmentID: string,
  pinned: boolean,
): Promise<void> {
  await mutateDesktopPreferences((current) => setLocalEnvironmentPinned(current, environmentID, pinned));
}

async function setProviderEnvironmentPinnedFromWelcome(
  environmentID: string,
  pinned: boolean,
): Promise<void> {
  await mutateDesktopPreferences((current) => setProviderEnvironmentPinned(current, environmentID, pinned));
}

async function setEnvironmentRegistrationPinnedFromWelcome(
  registrationRef: EnvironmentRegistrationRef,
  pinned: boolean,
): Promise<void> {
  if (registrationRef.kind === 'local_environment') {
    await setLocalEnvironmentPinnedFromWelcome(registrationRef.id, pinned);
    return;
  }
  if (registrationRef.kind === 'saved_environment') {
    await mutateDesktopPreferences((current) => {
      const existing = current.saved_environments.find((environment) => environment.id === registrationRef.id);
      if (!existing) throw new Error('The saved Environment registration no longer exists.');
      return setSavedEnvironmentPinned(current, {
        environment_id: existing.id,
        label: existing.label,
        local_ui_url: existing.local_ui_url,
        pinned,
        last_used_at_ms: existing.last_used_at_ms,
      });
    });
    return;
  }
  if (registrationRef.kind === 'gateway_environment') {
    throw new Error('Gateway-backed Environment registrations cannot be pinned by Desktop.');
  }
  await mutateDesktopPreferences((current) => {
    const existing = current.saved_runtime_targets.find((target) => target.id === registrationRef.id);
    if (!existing) throw new Error('The saved Runtime target registration no longer exists.');
    return setSavedRuntimeTargetPinned(current, {
      environment_id: existing.id,
      label: existing.label,
      pinned,
      host_access: existing.host_access,
      placement: existing.placement,
      last_used_at_ms: existing.last_used_at_ms,
    });
  });
}

async function upsertSavedRuntimeTargetFromWelcome(
  request: Extract<DesktopEnvironmentRegistrationUpsert, { registration_ref: { kind: 'runtime_target' } }>,
): Promise<void> {
  let placement = request.placement;
  if (request.placement.kind === 'container_process') {
    placement = await assertRuntimeTargetContainerRunning(
      request.host_access,
      request.placement,
      compact(request.registration_ref.id) || desktopRuntimeTargetID(request.host_access, request.placement),
      request.ssh_password_mode === 'replace' ? compact(request.ssh_password) : undefined,
    );
  }
  await mutateDesktopPreferences((current) => {
    const existing = current.saved_runtime_targets.find((target) => target.id === request.registration_ref.id);
    return upsertSavedRuntimeTarget(current, {
      id: request.registration_ref.id || undefined,
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
      created_at_ms: existing?.created_at_ms,
      last_used_at_ms: existing?.last_used_at_ms ?? Date.now(),
    });
  });
}

async function deleteSavedEnvironmentFromWelcome(environmentID: string): Promise<void> {
  await mutateDesktopPreferences((current) => {
    if (!current.saved_environments.some((environment) => environment.id === compact(environmentID))) {
      throw new Error('The saved Environment connection no longer exists.');
    }
    return deleteSavedEnvironment(current, environmentID);
  });
}

async function deleteSavedRuntimeTargetFromWelcome(environmentID: string): Promise<void> {
  const runtimeTargetID = compact(environmentID) as DesktopRuntimeTargetID;
  const deletion: { target: DesktopSavedRuntimeTarget | null } = {
    target: null,
  };
  await mutateDesktopPreferences((current) => {
    deletion.target = current.saved_runtime_targets.find((target) => target.id === runtimeTargetID) ?? null;
    if (!deletion.target) {
      throw new Error('The saved Runtime target no longer exists.');
    }
    return deleteSavedRuntimeTarget(current, runtimeTargetID);
  });
  const existingTarget = deletion.target;
  if (!existingTarget) {
    throw new Error('The saved Runtime target no longer exists.');
  }
  const targetKey = runtimeLifecycleTargetKey(existingTarget.host_access, existingTarget.placement);
  const active = targetKey ? runtimeLifecycleCoordinator.active(targetKey) : null;
  const activeOperation = active ? launcherOperations.get(active.operation_key) : null;
  if (active && (!activeOperation || activeOperation.cancelable === true)) {
    const reason = 'Runtime target removed. Desktop is canceling the runtime startup task in the background.';
    launcherOperations.cancel(active.operation_key, reason);
    runtimeLifecycleCoordinator.cancel(active.target_key, new DOMException(reason, 'AbortError'));
  }
  launcherOperations.markSubjectDeleted('runtime_target', runtimeTargetID);
  void (async () => {
    if (active) {
      await runtimeLifecycleCoordinator.waitForIdle(targetKey).catch(() => undefined);
    }
    const liveRuntimeSession = liveSession(desktopSessionKeyFromRuntimeTargetID(runtimeTargetID));
    if (liveRuntimeSession) {
      await finalizeSessionClosure(liveRuntimeSession.session_key).catch(() => undefined);
    }
    await clearRuntimePlacementTargetRecords(runtimeTargetID).catch(() => undefined);
  })();
}

async function upsertEnvironmentRegistrationFromWelcome(
  registration: DesktopEnvironmentRegistrationUpsert,
): Promise<DesktopLauncherActionResult> {
  switch (registration.registration_ref.kind) {
  case 'saved_environment': {
    const saved = registration as Extract<DesktopEnvironmentRegistrationUpsert, { registration_ref: { kind: 'saved_environment' } }>;
    await upsertSavedEnvironmentFromWelcome(
      saved.registration_ref.id,
      saved.label,
      saved.external_local_ui_url,
      saved.auto_runtime_probe_enabled,
    );
    return launcherActionSuccess('saved_environment');
  }
  case 'runtime_target': {
    const runtimeTarget = registration as Extract<DesktopEnvironmentRegistrationUpsert, { registration_ref: { kind: 'runtime_target' } }>;
    await upsertSavedRuntimeTargetFromWelcome(runtimeTarget);
    return launcherActionSuccess('saved_environment');
  }
  case 'gateway_environment': {
    const gatewayEnvironment = registration as Extract<DesktopEnvironmentRegistrationUpsert, { registration_ref: { kind: 'gateway_environment' } }>;
    return upsertGatewayEnvironmentProfileFromLauncher(gatewayEnvironment);
  }
  }
}

async function deleteEnvironmentRegistrationFromWelcome(
  registrationRef: EnvironmentRegistrationRef,
): Promise<DesktopLauncherActionResult> {
  if (registrationRef.kind === 'saved_environment') {
    await deleteSavedEnvironmentFromWelcome(registrationRef.id);
    return launcherActionSuccess('deleted_environment');
  }
  if (registrationRef.kind === 'runtime_target') {
    await deleteSavedRuntimeTargetFromWelcome(registrationRef.id);
    return launcherActionSuccess('deleted_environment');
  }
  if (registrationRef.kind === 'gateway_environment') {
    return deleteGatewayEnvironmentProfileFromLauncher(registrationRef);
  }
  return launcherActionFailure(
    'action_invalid',
    'environment',
    'The built-in Local Environment registration cannot be removed.',
  );
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
      ? createSSHRuntimeHostExecutor(desktopSSHTransportManager, normalized.host_access.ssh, {
          credentialScope: `runtime-container-list:${desktopSSHAuthority(normalized.host_access.ssh)}`,
        })
      : createLocalRuntimeHostExecutor();
    const result = await executor.run(containerListCommand(normalized.engine))
      .finally(() => executor.release());
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
    const permissionDenied = containerRuntimeCommandFailureStatus(error) === 'no_permission';
    const failure = desktopFailureFromError(error, {
      code: 'runtime_host_command_failed',
      title: 'Container List Failed',
      summary: `Desktop could not list running ${normalized.engine} containers${hostLabel}.`,
      recoveryHint: permissionDenied
        ? `Grant the SSH user permission to access ${normalized.engine} (for example, the Docker socket), or use an SSH account with container-engine access, then refresh and try again.`
        : normalized.host_access.kind === 'ssh_host'
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
    case 'set_provider_environment_pinned':
      await setProviderEnvironmentPinnedFromWelcome(request.environment_id, request.pinned);
      return launcherActionSuccess('saved_environment');
    case 'set_environment_registration_pinned':
      await setEnvironmentRegistrationPinnedFromWelcome(request.registration_ref, request.pinned);
      return launcherActionSuccess('saved_environment');
    case 'open_environment_settings':
      return openUtilityWindow('launcher', {
        surface: 'environment_settings',
        selectedEnvironmentID: request.environment_id,
        stealAppFocus: true,
      });
    case 'open_flower':
      return openUtilityWindow('launcher', {
        surface: 'flower',
        issue: null,
        stealAppFocus: true,
      }).then((result) => (
        result.ok ? launcherActionSuccess('opened_flower', { utilityWindowKind: 'launcher' }) : result
      ));
    case 'open_environment_center':
      return openUtilityWindow('launcher', {
        surface: 'connect_environment',
        issue: null,
        stealAppFocus: true,
      }).then((result) => (
        result.ok ? launcherActionSuccess('opened_environment_center', { utilityWindowKind: 'launcher' }) : result
      ));
    case 'focus_environment_window':
      return focusEnvironmentWindow(request.session_key);
    case 'open_provider_environment':
      return openProviderEnvironmentFromLauncher(request);
    case 'open_gateway_environment':
      return openGatewayEnvironmentFromLauncher(request);
    case 'refresh_control_plane':
      return refreshControlPlaneFromLauncher(request);
    case 'delete_control_plane':
      return deleteControlPlaneFromLauncher(request);
    case 'upsert_gateway':
      try {
        await upsertGatewayFromLauncher(request);
        return launcherActionSuccess('saved_gateway');
      } catch (error) {
        return launcherActionFailure(
          'action_invalid',
          'dialog',
          error instanceof Error ? error.message : String(error),
          { shouldRefreshSnapshot: true },
        );
      }
    case 'pair_gateway':
    case 'sync_gateway':
      return pairGatewayFromLauncher(request);
    case 'refresh_gateway':
      return refreshGatewayFromLauncher(request);
    case 'check_gateway':
      return checkGatewayFromLauncher(request);
    case 'set_gateway_enabled':
      return setGatewayEnabledFromLauncher(request);
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
      return launcherActionFailure(
        'action_invalid',
        'gateway',
        'Standalone Gateways expose access and catalog operations only. Manage the Gateway service on its own host.',
        { gatewayID: request.gateway_id, shouldRefreshSnapshot: true },
      );
    case 'preview_reinstall_target':
      return previewReinstallTargetFromLauncher(request);
    case 'reinstall_target':
      return reinstallTargetFromLauncher(request);
    case 'refresh_gateway_catalog':
      return refreshGatewayCatalogFromLauncher(request);
    case 'refresh_gateway_status':
      return refreshGatewayStatusFromLauncher(request);
    case 'delete_gateway':
      await deleteGatewayFromLauncher(request.gateway_id);
      return launcherActionSuccess('deleted_gateway');
    case 'upsert_environment_registration':
      try {
        return await upsertEnvironmentRegistrationFromWelcome(request.registration);
      } catch (error) {
        return launcherActionFailure(
          'action_invalid',
          'dialog',
          error instanceof Error ? error.message : String(error),
        );
      }
    case 'delete_environment_registration':
      return deleteEnvironmentRegistrationFromWelcome(request.registration_ref);
    case 'run_provider_environment_lifecycle':
      return runProviderEnvironmentLifecycleFromLauncher(request);
    case 'setup_provider_runtime_management_with_direct_card':
      return setupProviderRuntimeManagementWithDirectCardFromLauncher(request);
    case 'setup_direct_runtime_management':
      return setupDirectRuntimeManagementFromLauncher(request);
    case 'confirm_runtime_operation':
      return confirmRuntimeOperationFromLauncher(request);
    case 'reconcile_runtime_operation':
      return reconcileRuntimeOperationFromLauncher(request);
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

function installDesktopDiagnosticsHooks(webSession: Session): void {
  if (desktopDiagnosticsHookSessions.has(webSession)) {
    return;
  }
  desktopDiagnosticsHookSessions.add(webSession);
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
    if (shouldFailDesktopSessionMainDocument({
      lifecycle: sessionRecord.lifecycle,
      resourceType: details.resourceType,
      statusCode: details.statusCode,
      webContentsID: (details as { webContentsId?: number }).webContentsId ?? -1,
      rootWebContentsID: sessionRecord.root_window.webContentsID,
    })) {
      const transport = sessionRecord.transport;
      const diagnostics: NonNullable<DesktopOperationFailurePresentation['diagnostics']> = [
        { channel: 'transport', label: 'Transport', text: transport.kind },
        {
          channel: 'proxy_policy',
          label: 'Proxy policy',
          text: transport.proxyPolicy,
        },
        { channel: 'http_status', label: 'HTTP status', text: String(details.statusCode) },
      ];
      void failOpeningSession(
        sessionRecord,
        transport.proxyPolicy === 'direct'
          ? localDesktopTransportFailure(
              sessionRecord.target.label,
              `The protected local transport returned HTTP ${details.statusCode}.`,
              diagnostics,
            )
          : new DesktopOperationFailureError(desktopOperationFailurePresentation({
              code: 'environment_open_failed',
              title: 'Environment Open Failed',
              titleKey: 'progress.environmentOpenFailedTitle',
              summary: `Desktop could not open "${sessionRecord.target.label}".`,
              summaryKey: 'progress.environmentOpenFailedSummary',
              targetLabel: sessionRecord.target.label,
              diagnostics,
            })),
      );
    }
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
  await openDesktopWelcomeWindow({
    entryReason: 'app_launch',
    stealAppFocus: options?.stealAppFocus,
  });
}

async function shutdownDesktopWindowsAndSessions(): Promise<void> {
  for (const operation of runtimeLifecycleCoordinator.operations()) {
    const launcherOperation = launcherOperations.get(operation.operation_key);
    if (!launcherOperation || launcherOperation.cancelable === true) {
      const reason = 'Redeven Desktop is quitting and canceling this runtime lifecycle operation.';
      launcherOperations.cancel(operation.operation_key, reason);
      runtimeLifecycleCoordinator.cancel(operation.target_key, new DOMException(reason, 'AbortError'));
    }
  }
  await runtimeLifecycleCoordinator.waitForAll();
  const sessionClosePromises = [...sessionsByKey.keys()].map((sessionKey) => finalizeSessionClosure(sessionKey));
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
  await runtimePlacementBridgeRegistry.retireAll().catch(() => undefined);
  await desktopSSHTransportManager.dispose();
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
      access_point_origin: string;
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
      const accessPointOrigin = String(parsed.searchParams.get('access_point_origin') ?? '').trim();
      const envPublicID = String(parsed.searchParams.get('env_public_id') ?? '').trim();
      const label = String(parsed.searchParams.get('label') ?? '').trim();
      if (providerOrigin === '' || accessPointOrigin === '' || envPublicID === '') {
        return null;
      }
      return {
        kind: 'open_provider_environment',
        provider_origin: providerOrigin,
        provider_id: String(parsed.searchParams.get('provider_id') ?? '').trim() || undefined,
        env_public_id: envPublicID,
        access_point_origin: accessPointOrigin,
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
  let preferences = await loadDesktopPreferencesCached();
  let controlPlane = request.provider_id
    ? savedControlPlaneByIdentity(preferences, request.provider_origin, request.provider_id)
    : savedControlPlaneByOrigin(preferences, request.provider_origin);
  if (!controlPlane) {
    await startControlPlaneAuthorization({
      providerOrigin: request.provider_origin,
      expectedProviderID: request.provider_id,
      requestedEnvPublicID: request.env_public_id,
      requestedAccessPointOrigin: request.access_point_origin,
      label: request.label,
    });
    resetLauncherIssueState();
    broadcastDesktopWelcomeSnapshots();
    return;
  }

  try {
    let environment = findProviderEnvironmentForAccessPointRoute(
      preferences,
      controlPlane,
      request.env_public_id,
      request.access_point_origin,
    );
    if (!environment) {
      const synced = await syncSavedControlPlaneAccountWithState(
        controlPlane.provider.provider_origin,
        controlPlane.provider.provider_id,
        { force: true },
      );
      preferences = synced.preferences;
      controlPlane = synced.controlPlane;
      environment = findProviderEnvironmentForAccessPointRoute(
        preferences,
        controlPlane,
        request.env_public_id,
        request.access_point_origin,
      );
    }
    if (!environment) {
      throw new Error('Desktop could not find this provider environment in the selected access point.');
    }
    const authorized = await ensureControlPlaneAccessToken(preferences, controlPlane);
    const accessPoint = providerAccessPointForEnvironment(authorized.controlPlane, environment);
    const openSession = await requestDesktopOpenSession(
      authorized.controlPlane.provider,
      accessPoint,
      authorized.accessToken,
      request.env_public_id,
    );
    const result = await openProviderEnvironmentWithOpenSession({
      providerOrigin: authorized.controlPlane.provider.provider_origin,
      providerID: authorized.controlPlane.provider.provider_id,
      envPublicID: request.env_public_id,
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
      requestedAccessPointOrigin: request.access_point_origin,
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

  if (!pendingAuthorization.requested_env_public_id || !pendingAuthorization.requested_access_point_origin) {
    await openDesktopWelcomeWindow({
      entryReason: openSessionSummaries().length > 0 ? 'switch_environment' : 'app_launch',
      stealAppFocus: true,
    });
    return;
  }

  const authorized = await ensureControlPlaneAccessToken(connected.preferences, connected.controlPlane);
  const environment = findProviderEnvironmentForAccessPointRoute(
    authorized.preferences,
    authorized.controlPlane,
    pendingAuthorization.requested_env_public_id,
    pendingAuthorization.requested_access_point_origin,
  );
  if (!environment) {
    throw new Error('Desktop could not find this provider environment in the selected access point.');
  }
  const accessPoint = providerAccessPointForEnvironment(authorized.controlPlane, environment);
  const openSession = await requestDesktopOpenSession(
    authorized.controlPlane.provider,
    accessPoint,
    authorized.accessToken,
    pendingAuthorization.requested_env_public_id,
  );
  const result = await openProviderEnvironmentWithOpenSession({
    providerOrigin: authorized.controlPlane.provider.provider_origin,
    providerID: authorized.controlPlane.provider.provider_id,
    envPublicID: pendingAuthorization.requested_env_public_id,
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

const configuredDesktopTempRoot = resolveConfiguredDesktopTempRoot();
if (configuredDesktopTempRoot) {
  mkdirSync(configuredDesktopTempRoot, { recursive: true, mode: 0o700 });
  app.setPath('temp', configuredDesktopTempRoot);
}
const configuredDesktopUserDataRoot = resolveConfiguredDesktopUserDataRoot();
if (configuredDesktopUserDataRoot) {
  mkdirSync(configuredDesktopUserDataRoot, { recursive: true, mode: 0o700 });
  app.setPath('userData', configuredDesktopUserDataRoot);
  app.setPath('sessionData', path.join(configuredDesktopUserDataRoot, 'session-data'));
}
const configuredDesktopCacheRoot = resolveConfiguredDesktopCacheRoot();
if (configuredDesktopCacheRoot) {
  mkdirSync(configuredDesktopCacheRoot, { recursive: true, mode: 0o700 });
  app.setPath('cache', configuredDesktopCacheRoot);
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
  ipcMain.on(DESKTOP_SESSION_TRANSPORT_RECOVERY_GET_CHANNEL, (event) => {
    const sessionRecord = sessionRecordForWebContentsID(event.sender.id);
    event.returnValue = sessionRecord?.transport_recovery_snapshot ?? null;
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
  ipcMain.handle(DESKTOP_SESSION_TRANSPORT_RECOVERY_RETRY_CHANNEL, (event) => {
    const sessionRecord = sessionRecordForWebContentsID(event.sender.id);
    return sessionRecord?.transport_recovery_session?.requestRecoveryNow() ?? false;
  });
  ipcMain.on(DESKTOP_THEME_GET_SNAPSHOT_CHANNEL, (event) => {
    event.returnValue = desktopRendererThemeSnapshot(desktopThemeState().getSnapshot());
  });
  ipcMain.on(DESKTOP_THEME_SET_SOURCE_CHANNEL, (event, source) => {
    event.returnValue = desktopRendererThemeSnapshot(desktopThemeState().setSource(source));
  });
  ipcMain.on(DESKTOP_THEME_SET_SHELL_THEME_CHANNEL, (event, mode, presetName) => {
    event.returnValue = desktopRendererThemeSnapshot(
      desktopThemeState().setShellTheme(mode, presetName),
    );
  });
  ipcMain.on(DESKTOP_LANGUAGE_GET_SNAPSHOT_CHANNEL, (event) => {
    event.returnValue = desktopLanguageState().getSnapshot();
  });
  ipcMain.on(DESKTOP_LANGUAGE_SET_PREFERENCE_CHANNEL, (event, preference) => {
    event.returnValue = desktopLanguageState().setPreference(preference);
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
      await mutateDesktopPreferences((current) => updateLocalEnvironmentSettings(current, {
        environmentID: current.local_environment.id,
        access: validated,
      }));
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle(REQUEST_RUNTIME_FLOWER_CHANNEL, async (_event, request: RuntimeFlowerRequest): Promise<RuntimeFlowerRequestResult> => {
    try {
      return await requestRuntimeFlower(request);
    } catch (error) {
      return {
        ok: false,
        error: runtimeFlowerErrorFromUnknown(error),
        failureKind: error instanceof RuntimeFlowerTransportError ? 'transport_unknown' : 'local',
      };
    }
  });
  ipcMain.handle(START_RUNTIME_FLOWER_STREAM_CHANNEL, async (event, request): Promise<RuntimeFlowerStreamStartResult> => (
    startRuntimeFlowerStream(event.sender, request)
  ));
  ipcMain.on(CANCEL_RUNTIME_FLOWER_STREAM_CHANNEL, (event, streamID) => {
    cancelRuntimeFlowerStream(event.sender, streamID);
  });
  ipcMain.handle(PREPARE_RUNTIME_FLOWER_ATTACHMENT_CHANNEL, async (event, request): Promise<RuntimeFlowerAttachmentPrepareResponse> => {
    const normalized = normalizeRuntimeFlowerAttachmentPrepareRequest(request);
      if (!normalized)
        return {
          ok: false,
          message: 'Desktop received an invalid Flower attachment upload request.',
        };
    try {
      return await prepareRuntimeFlowerAttachmentUpload(event.sender, normalized);
    } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
    }
  });
  ipcMain.handle(WRITE_RUNTIME_FLOWER_ATTACHMENT_CHUNK_CHANNEL, async (event, request): Promise<RuntimeFlowerAttachmentChunkResponse> => {
    const normalized = normalizeRuntimeFlowerAttachmentChunkRequest(request);
      if (!normalized)
        return {
          ok: false,
          message: 'Desktop received an invalid Flower attachment upload chunk.',
        };
    return writeRuntimeFlowerAttachmentChunk(
      event.sender,
      normalized.operation_id,
      normalized.offset_bytes,
      normalized.chunk,
    );
  });
  ipcMain.handle(COMMIT_RUNTIME_FLOWER_ATTACHMENT_CHANNEL, async (event, request): Promise<RuntimeFlowerAttachmentCommitResponse> => {
    const normalized = normalizeRuntimeFlowerAttachmentOperationRequest(request);
    if (!normalized) {
      return { ok: false, failureKind: 'local', error: { message: 'Desktop received an invalid Flower attachment upload commit.' } };
    }
    return commitRuntimeFlowerAttachmentUpload(event.sender, normalized.operation_id);
  });
  ipcMain.handle(CANCEL_RUNTIME_FLOWER_ATTACHMENT_CHANNEL, (event, request): RuntimeFlowerAttachmentCancelResponse => {
    const normalized = normalizeRuntimeFlowerAttachmentOperationRequest(request);
    if (!normalized) return { ok: false, cancelled: false, message: 'Desktop received an invalid Flower attachment cancellation.' };
    return cancelRuntimeFlowerAttachmentUpload(event.sender, normalized.operation_id);
  });
  ipcMain.handle(PREVIEW_RUNTIME_FLOWER_ATTACHMENT_CHANNEL, async (_event, request): Promise<RuntimeFlowerAttachmentPreviewResponse> => {
    const normalized = normalizeRuntimeFlowerAttachmentPreviewRequest(request);
    if (!normalized) return { ok: false, message: 'Desktop received an invalid Flower attachment preview request.' };
    try {
      await previewRuntimeFlowerAttachment(normalized);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
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
      scheduleGatewaySyncAfterLauncherAction(normalized, result);
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

    if (normalized.kind === 'flower_settings') {
      await openUtilityWindow('launcher', {
        surface: 'flower',
        issue: null,
        focusFlowerSettings: true,
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
  ipcMain.handle(DESKTOP_SHELL_OPEN_CODESPACE_WINDOW_CHANNEL, async (event, request): Promise<DesktopShellOpenCodespaceWindowResponse> => {
    const normalized = normalizeDesktopShellOpenCodespaceWindowRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Invalid codespace window request.',
      };
    }

    return openCodespaceWindowFromShell(sessionRecordForWebContentsID(event.sender.id), normalized);
  });
  ipcMain.handle(DESKTOP_SHELL_OPEN_WEB_SERVICE_WINDOW_CHANNEL, async (event, request): Promise<DesktopShellOpenWebServiceWindowResponse> => {
    const normalized = normalizeDesktopShellOpenWebServiceWindowRequest(request);
    if (!normalized) {
      return { ok: false, message: 'Invalid Web Service window request.' };
    }
    return openWebServiceWindowFromShell(sessionRecordForWebContentsID(event.sender.id), normalized);
  });
  ipcMain.handle(DESKTOP_WEB_SERVICE_BROWSER_GET_STATE_CHANNEL, (event): DesktopWebServiceBrowserState => {
    return webServiceBrowserByToolbarWebContentsID.get(event.sender.id)?.snapshot() ?? {
      address: '',
      title: '',
      loading: false,
      can_go_back: false,
      can_go_forward: false,
      devtools_open: false,
      error_message: DESKTOP_STALE_WINDOW_MESSAGE,
    };
  });
  ipcMain.handle(DESKTOP_WEB_SERVICE_BROWSER_ACTION_CHANNEL, async (event, request): Promise<DesktopWebServiceBrowserActionResponse> => {
    const action = normalizeDesktopWebServiceBrowserAction(request);
    if (!action) return { ok: false, message: 'Invalid Web Service browser action.' };
    const controller = webServiceBrowserByToolbarWebContentsID.get(event.sender.id);
    if (!controller) return { ok: false, message: DESKTOP_STALE_WINDOW_MESSAGE };
    return await controller.perform(action);
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
  ipcMain.on(DESKTOP_SHELL_RUNTIME_MAINTENANCE_STARTED_CHANNEL, (event, notification) => {
    const normalized = normalizeDesktopShellRuntimeMaintenanceStartedNotification(notification);
    if (!normalized) {
      return;
    }
    void handleRuntimeMaintenanceStartedFromShell(event.sender.id, normalized.kind).catch((error) => {
      console.warn('Redeven Desktop failed to close an Environment session after Runtime maintenance started.', error);
    });
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
  ipcMain.handle(DESKTOP_CODE_WORKSPACE_PACKAGE_PREPARE_CHANNEL, async (event, request): Promise<DesktopCodeWorkspacePackagePrepareResponse> => {
    const normalized = normalizeDesktopCodeWorkspacePackagePrepareRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Desktop received an invalid workspace package request.',
      };
    }
    const operationID = normalized.operation_id;
    const operation = beginDesktopCodeWorkspacePreparationOperation(operationID, event.sender.id);
    if (!operation) {
      return {
        ok: false,
        message: 'A Browser Editor package preparation with this operation id is already running.',
      };
    }
    const response = await prepareCodeWorkspaceEnginePackageJob(normalized.platform, {
        signal: operation.controller.signal,
        onProgress: (progress) => emitDesktopCodeWorkspaceProgress(event.sender, operationID, progress),
      }, operation);
    if (!response.ok || !response.job) {
      finishDesktopCodeWorkspacePreparationOperation(operation);
    }
    return response;
  });
  ipcMain.handle(DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_CHANNEL, async (_event, request): Promise<DesktopCodeWorkspacePackageChunkResponse> => {
    const normalized = normalizeDesktopCodeWorkspacePackageChunkRequest(request);
    if (!normalized) {
      return {
        ok: false,
        message: 'Desktop received an invalid workspace package chunk request.',
      };
    }
    return desktopCodeWorkspaceEnginePackageJobs.read(normalized.job_id, normalized.offset_bytes, normalized.length_bytes);
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
  ipcMain.handle(DESKTOP_CODE_WORKSPACE_CANCEL_CHANNEL, async (event, request) => {
    const normalized = normalizeDesktopCodeWorkspaceCancelRequest(request);
    if (!normalized) {
      return {
        ok: false,
        cancelled: false,
        message: 'Desktop received an invalid workspace preparation cancellation request.',
      };
    }
    const operation = desktopCodeWorkspacePreparationOperations.get(normalized.operation_id);
    if (!operation || operation.webContentsID !== event.sender.id) {
      return { ok: true, cancelled: false };
    }
    operation.controller.abort();
    desktopCodeWorkspaceEnginePackageJobs.removeForOperation(operation);
    finishDesktopCodeWorkspacePreparationOperation(operation);
    return { ok: true, cancelled: true };
  });
  ipcMain.on(CANCEL_DESKTOP_SETTINGS_CHANNEL, () => {
    setLauncherViewState({
      surface: 'connect_environment',
    });
    void emitDesktopWelcomeSnapshot('launcher');
  });

  app.whenReady().then(async () => {
    installDesktopDiagnosticsHooks(session.defaultSession);
    registerDesktopProtocolClient();
    void pruneDesktopRuntimePackageCacheForCurrentRelease().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[redeven:runtime-package-cache] Cache cleanup failed: ${message}`);
    });
    installOrRefreshAppMenu();

    try {
      try {
        await loadDesktopBundleForStartup();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[redeven:desktop-startup] Desktop bundle validation failed: ${message}`);
        setLauncherViewState({
          surface: 'connect_environment',
          entryReason: 'app_launch',
          issue: {
            scope: 'startup',
            code: 'desktop_bundle_invalid',
            title: 'Local Environment startup failed',
            title_key: 'issue.startupFailedTitle',
            message: 'Redeven could not prepare this environment. Repair or reinstall the application, then restart Desktop.',
            message_key: 'environmentOpenFlow.initializationFailedDetail',
            diagnostics_copy: `status: blocked\ncode: desktop_bundle_invalid\nmessage: ${message}`,
            target_url: '',
          },
        });
        await openDesktopWelcomeWindow({ entryReason: 'app_launch' });
        return;
      }
      const startupPreferences = await loadDesktopPreferencesCached();
      await hydratePersistedReinstallOperations();
      const localRuntimeAutoStart = autoStartLocalRuntimeOnDesktopLaunch(startupPreferences);
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
        await localRuntimeAutoStart;
        return;
      }
      await openDesktopWelcomeWindow({ entryReason: 'app_launch' });
      await localRuntimeAutoStart;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to start', message || 'Unknown startup error.');
      requestImmediateQuit();
    }
  });

  app.on('activate', () => {
    desktopLanguageState().refreshSystemLocale();
    void syncVisibleControlPlanesIfNeeded().catch(() => {
      // Best-effort refresh when the app becomes active again.
    });
    void syncVisibleGatewaysIfNeeded().catch(() => {
      // Best-effort refresh when the app becomes active again.
    });
    void restoreBestAvailableWindow().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Redeven Desktop failed to restore a window', message || 'Unknown restore error.');
      requestImmediateQuit();
    });
  });

  powerMonitor.on('resume', () => {
    desktopLanguageState().refreshSystemLocale();
    void syncVisibleControlPlanesIfNeeded({ force: true }).catch(() => {
      // Best-effort refresh after sleep/wake.
    });
    void syncVisibleGatewaysIfNeeded({ force: true }).catch(() => {
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
    updateGatewaySyncPoller();
    updateWelcomeRuntimePoller();
    if (process.platform !== 'darwin' && quitPhase === 'idle') {
      requestImmediateQuit();
    }
  });
}
