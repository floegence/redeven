import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Motion, Presence } from 'solid-motionone';
import { cn, FloeProvider, useCommand, useTheme } from '@floegence/floe-webapp-core';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Lock,
  Moon,
  Pin,
  Play,
  Plus,
  Refresh,
  Save,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Stop,
  Sun,
  Trash,
  X,
} from '@floegence/floe-webapp-core/icons';
import { BottomBarItem, TopBarIconButton } from '@floegence/floe-webapp-core/layout';
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  CommandPalette,
  ConfirmDialog,
  Dialog,
  FloatingWindow,
  Input,
  SegmentedControl,
  Tag,
} from '@floegence/floe-webapp-core/ui';

import {
  REDEVEN_LOCALE_META,
  REDEVEN_LOCALE_PREFERENCES,
  SYSTEM_LOCALE_PREFERENCE,
  createDesktopI18n,
  localePreferenceDisplayName,
  type DesktopI18n,
  type DesktopTranslationKey,
  type RedevenLanguageSnapshot,
  type RedevenLocalePreference,
} from '../shared/i18n';
import type {
  DesktopAccessMode,
  DesktopSettingsSurfaceSnapshot,
} from '../shared/desktopSettingsSurface';
import {
  desktopGatewayCanManageRuntime,
  type DesktopGatewayConnectionKind,
  type DesktopGatewaySource,
} from '../shared/desktopGateway';
import type {
  DesktopFlowerHostRouterDecision,
} from '../shared/flowerHostSettingsIPC';
import type {
  DesktopEnvironmentEntry,
  DesktopEnvironmentOpenAction,
  DesktopLauncherActionProgress,
  DesktopLauncherActionKind,
  DesktopGatewayStartPolicy,
  DesktopGatewayStartRequiredPayload,
  DesktopLauncherActionResult,
  DesktopLauncherActionRequest,
  DesktopLauncherCloseAction,
  DesktopLauncherOperationNextAction,
  DesktopLauncherSurface,
  DesktopLauncherRuntimeTarget,
  DesktopLocalEnvironmentStateRoute,
  DesktopWelcomeIssue,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import {
  isDesktopLauncherActionFailure,
  isDesktopLauncherActionSuccess,
  selectLatestDesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import type { DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import {
  desktopProviderEnvironmentRuntimeLabel,
  desktopProviderOnlineEnvironmentCount,
} from '../shared/providerEnvironmentState';
import {
  normalizeDesktopLocalUIPasswordMode,
  type DesktopLocalUIPasswordMode,
  type DesktopSettingsDraft,
} from '../shared/settingsIPC';
import {
  runtimeServiceIsOpenable,
  type RuntimeServiceSnapshot,
  type RuntimeServiceWorkload,
} from '../shared/runtimeService';
import { FlowerIcon, FlowerSoftAuraIcon, FlowerSurface } from '../../../internal/flower_ui/src';
import { desktopEntryKindOwnsRuntimeManagement } from '../shared/environmentManagementPrinciples';
import {
  openConnectionPhaseSequence,
  type DesktopOpenConnectionPhase,
} from '../shared/desktopOpenConnectionProgress';
import type {
  DesktopRuntimeLifecyclePhase,
  DesktopRuntimeLifecycleStepSnapshot,
} from '../shared/desktopRuntimeLifecycleProgress';
import {
  DEFAULT_DESKTOP_SSH_AUTH_MODE,
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT_LABEL,
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL,
  type DesktopSSHAuthMode,
  type DesktopSSHBootstrapStrategy,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import type {
  DesktopContainerEngine,
  DesktopRuntimeHostAccess,
} from '../shared/desktopRuntimePlacement';
import {
  buildDesktopProviderRuntimeLinkPlan,
  type DesktopProviderRuntimeLinkPlanState,
} from '../shared/providerRuntimeLinkPlanner';
import type {
  DesktopProviderEnvironmentCandidate,
  DesktopProviderRuntimeLinkTarget,
} from '../shared/providerRuntimeLinkTarget';
import type { DesktopSSHConfigHost } from '../shared/desktopSSHConfig';
import type {
  DesktopRuntimeContainerListRequest,
  DesktopRuntimeContainerListResponse,
  DesktopRuntimeContainerOption,
} from '../shared/desktopContainerRuntime';
import {
  formatDesktopOperationFailureForClipboard,
  type DesktopOperationFailurePresentation,
} from '../shared/desktopOperationFailure';
import {
  applyDesktopAccessAutoPortToDraft,
  applyDesktopAccessFixedPortToDraft,
  applyDesktopAccessModeToDraft,
  desktopPasswordStateTranslationKey,
  deriveDesktopAccessDraftModel,
} from '../shared/desktopAccessModel';
import {
  buildEnvironmentLibrarySummaryModel,
  buildEnvironmentLibraryLayoutModel,
  buildEnvironmentCardModel,
  buildEnvironmentCardFactsModel,
  buildGatewayRowModel,
  buildGatewaySourceRowModel,
  ICON_ENDPOINTS,
  buildControlPlaneStatusModel,
  buildProviderBackedEnvironmentActionModel,
  capabilityUnavailableMessage,
  environmentLibraryCount,
  environmentProviderFilterValue,
  filterGatewayEnvironmentEntries,
  filterEnvironmentLibrary,
  gatewayEnvironmentCount,
  gatewaySourceFilterOptions,
  gatewaySourceFilterValue,
  LOCAL_ENVIRONMENT_LIBRARY_FILTER,
  GATEWAY_ENVIRONMENT_LIBRARY_FILTER,
  PROVIDER_ENVIRONMENT_LIBRARY_FILTER,
  SSH_ENVIRONMENT_LIBRARY_FILTER,
  runtimeTargetEnvironmentLibraryFilterTargetID,
  runtimeTargetEnvironmentLibraryFilterValue,
  URL_ENVIRONMENT_LIBRARY_FILTER,
  type EnvironmentActionIntent,
  type EnvironmentActionModel,
  type EnvironmentActionMenuItemModel,
  type GatewaySourceActionModel,
  type EnvironmentGuidanceActionModel,
  type EnvironmentCardEndpointModel,
  type EnvironmentCardFactActionModel,
  type EnvironmentCardFactModel,
  type EnvironmentActionOverlayTone,
  type EnvironmentActionPresentation,
  type EnvironmentCenterTab,
  type EnvironmentPrimaryActionOverlayModel,
  shouldUseSpaciousEnvironmentGrid,
  type GatewaySourceRowModel,
} from './viewModel';
import {
  launcherActionFailurePresentation,
} from './launcherActionFeedback';
import {
  localizedOperationFailureDetail,
  localizedOperationFailureRecoveryHint,
  localizedOperationFailureSummary,
  localizedOperationFailureTitle,
} from './operationFailureI18n';
import {
  syncSSHConnectionDialogAdvancedState,
  type SSHConnectionDialogAdvancedState,
  type SSHConnectionDialogStateSnapshot,
} from './sshConnectionDialogState';
import { DesktopAnchoredListbox } from './DesktopAnchoredListbox';
import {
  createDesktopSettingsDraftSession,
  reconcileDesktopSettingsDraftSession,
  updateDesktopSettingsDraftSessionDraft,
} from './settingsDraftSession';
import {
  describeNextStartAddress,
  describeRuntimeAddress,
} from './welcomeCopy';
import {
  createDesktopThemeStorageAdapter,
  desktopStateStorageBridge,
  desktopThemeBridge,
  toggleDesktopTheme,
} from './desktopTheme';
import { desktopLanguageBridge } from './desktopLanguage';
import { DesktopTooltip } from './DesktopTooltip';
import { DesktopPopover } from './DesktopPopover';
import { DesktopLauncherShell } from './DesktopLauncherShell';
import { desktopControlPlaneKey, suggestControlPlaneDisplayLabel } from '../shared/controlPlaneProvider';
import {
  DESKTOP_ACTION_TOAST_LIMIT,
  queueDesktopActionToast,
  type DesktopActionToast,
  type DesktopActionToastAction,
  type DesktopActionToastTone,
} from './actionToastModel';
import { DesktopActionPopover } from './DesktopActionPopover';
import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';
import {
  closeEnvironmentLibraryOverlayState,
  closedEnvironmentLibraryOverlayState,
  environmentLibraryOverlayOpenFor,
  openEnvironmentLibraryOverlayState,
  reconcileEnvironmentLibraryOverlayState,
} from './environmentLibraryOverlayState';
import {
  environmentLibraryEntryRecord,
  splitPinnedEnvironmentEntryIDs,
} from './environmentLibraryProjection';
import {
  groupedVisibleOperationNextActions,
  operationNextActionsByKind,
} from './operationNextActions';
import {
  completeEnvironmentGuidanceRefresh,
  failEnvironmentGuidanceIntent,
  guidanceSessionKeepsPopoverOpen,
  guidanceSessionNotice,
  guidanceSessionShouldAutoDismiss,
  isEnvironmentGuidancePendingIntent,
  openEnvironmentGuidanceSession,
  reconcileEnvironmentGuidanceSession,
  startEnvironmentGuidanceIntent,
  type EnvironmentGuidanceSessionState,
} from './environmentGuidanceSession';
import {
  beginEnvironmentLifecycleDisclosure,
  closeEnvironmentLifecycleDisclosure,
  environmentActionStartsLifecycleDisclosure,
  environmentLifecycleDisclosureForEnvironment,
  environmentLifecycleDisclosureHasPendingRequest,
  reconcileEnvironmentLifecycleDisclosure,
  reopenEnvironmentLifecycleDisclosure,
  visibleEnvironmentLifecycleProgress,
  type EnvironmentLifecycleDisclosureIntent,
  type EnvironmentLifecycleDisclosureState,
} from './environmentLifecycleDisclosure';
import {
  type EnvironmentProgressPrimaryPresentation,
  environmentProgressPanelPrimaryAction,
  environmentProgressPrimaryPresentation,
  selectEnvironmentPanelProgress,
} from './environmentProgressPrimaryPresentation';
import {
  busyStateForLauncherRequest,
  busyStateWithActionProgress,
  busyStateBlocksEnvironmentAction,
  reconcileBusyStateWithActionProgressSnapshot,
  launcherProgressBlocksPrimaryAction,
  busyStateMatchesAction,
  busyStateMatchesControlPlane,
  busyStateMatchesEnvironment,
  busyStateMatchesGateway,
  IDLE_LAUNCHER_BUSY_STATE,
  selectedSnapshotOpenConnectionProgressForEnvironment,
  selectedSnapshotRuntimeLifecycleProgressForEnvironment,
  selectedSnapshotRuntimeLifecycleProgressForGateway,
  gatewaySourceMatchesRuntimeLifecycleProgress,
  type DesktopLauncherBusyState,
} from './launcherBusyState';
import { createRuntimeLifecycleStepAnimation } from './runtimeLifecycleStepAnimation';
import {
  createDesktopFlowerSurfaceAdapter,
  type DesktopSettingsBridge,
} from './flower/desktopFlowerSurfaceAdapter';
import { createDesktopFlowerSurfaceCopy } from './flower/desktopFlowerSurfaceCopy';

type DesktopLauncherBridge = Readonly<{
  getSnapshot: () => Promise<DesktopWelcomeSnapshot>;
  getSSHConfigHosts?: () => Promise<readonly DesktopSSHConfigHost[]>;
  listRuntimeContainers?: (request: DesktopRuntimeContainerListRequest) => Promise<DesktopRuntimeContainerListResponse>;
  performAction: (request: DesktopLauncherActionRequest) => Promise<DesktopLauncherActionResult>;
  subscribeActionProgress?: (listener: (progress: DesktopLauncherActionProgress) => void) => (() => void);
  subscribeSnapshot: (listener: (snapshot: DesktopWelcomeSnapshot) => void) => (() => void);
}>;

export type DesktopWelcomeRuntime = Readonly<{
  launcher: DesktopLauncherBridge;
  settings: DesktopSettingsBridge;
}>;

export type DesktopWelcomeShellProps = Readonly<{
  snapshot: DesktopWelcomeSnapshot;
  runtime: DesktopWelcomeRuntime;
}>;

declare global {
  interface Window {
    redevenDesktopLauncher?: DesktopLauncherBridge;
    redevenDesktopSettings?: DesktopSettingsBridge;
    redevenDesktopShell?: Readonly<{
      openConnectionCenter?: () => Promise<void>;
      openDashboard?: () => Promise<unknown>;
      openWindow?: (kind: unknown) => Promise<void>;
    }>;
  }
}

type ExternalURLConnectionDialogState = Readonly<{
  mode: 'create' | 'edit';
  connection_kind: 'external_local_ui';
  environment_id: string;
  label: string;
  external_local_ui_url: string;
  auto_runtime_probe_enabled: boolean;
}>;

type SSHConnectionDialogState = Readonly<{
  mode: 'create' | 'edit';
  connection_kind: 'ssh_environment';
  environment_id: string;
  label: string;
  ssh_destination: string;
  ssh_port: string;
  auth_mode: DesktopSSHAuthMode;
  ssh_password: string;
  ssh_password_mode: 'keep' | 'replace' | 'clear';
  ssh_password_configured: boolean;
  baseline_ssh_destination: string;
  baseline_ssh_port: string;
  baseline_auth_mode: DesktopSSHAuthMode;
  runtime_root: string;
  bootstrap_strategy: DesktopSSHBootstrapStrategy;
  release_base_url: string;
  connect_timeout_seconds: string;
  auto_runtime_probe_enabled: boolean;
}>;

type RuntimeContainerConnectionDialogState = Readonly<{
  mode: 'create' | 'edit';
  connection_kind: 'local_container_runtime' | 'ssh_container_runtime';
  environment_id: string;
  label: string;
  ssh_destination: string;
  ssh_port: string;
  auth_mode: DesktopSSHAuthMode;
  ssh_password: string;
  ssh_password_mode: 'keep' | 'replace' | 'clear';
  ssh_password_configured: boolean;
  baseline_ssh_destination: string;
  baseline_ssh_port: string;
  baseline_auth_mode: DesktopSSHAuthMode;
  connect_timeout_seconds: string;
  container_engine: DesktopContainerEngine;
  container_id: string;
  container_ref: string;
  container_label: string;
  runtime_root: string;
  auto_runtime_probe_enabled: boolean;
  auto_runtime_probe_configurable: boolean;
}>;

type GatewaySetupDialogState = Readonly<{
  mode: 'create' | 'edit';
  gateway_id: string;
  display_name: string;
  display_name_touched: boolean;
  connection_kind: DesktopGatewayConnectionKind;
  gateway_url: string;
  allow_loopback_http: boolean;
  ssh_destination: string;
  ssh_port: string;
  auth_mode: DesktopSSHAuthMode;
  ssh_password: string;
  ssh_password_mode: 'keep' | 'replace' | 'clear';
  ssh_password_configured: boolean;
  baseline_ssh_destination: string;
  baseline_ssh_port: string;
  baseline_auth_mode: DesktopSSHAuthMode;
  connect_timeout_seconds: string;
  bootstrap_strategy: DesktopSSHBootstrapStrategy;
  release_base_url: string;
  container_engine: DesktopContainerEngine;
  container_id: string;
  container_ref: string;
  container_label: string;
  runtime_root: string;
}>;

type ConnectionDialogKind = 'external_local_ui' | 'ssh_environment' | 'local_container_runtime' | 'ssh_container_runtime';
type ConnectionDialogState = ExternalURLConnectionDialogState | SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null;
type SSHPasswordConnectionDialogState = SSHConnectionDialogState | RuntimeContainerConnectionDialogState;
type SSHPasswordDraftState = SSHPasswordConnectionDialogState | GatewaySetupDialogState;

type ControlPlaneDialogState = Readonly<{
  display_label: string;
  display_label_touched: boolean;
  provider_origin: string;
}> | null;

type EnvironmentGuidanceActionResolution = Readonly<{
  close_panel: boolean;
  next_session: EnvironmentGuidanceSessionState;
}>;

const LOGO_LIGHT_URL = new URL('../../../internal/envapp/ui_src/public/logo.svg', import.meta.url).href;
const LOGO_DARK_URL = new URL('../../../internal/envapp/ui_src/public/logo-dark.svg', import.meta.url).href;

type EnvironmentFailureState = Readonly<{
  failure: DesktopOperationFailurePresentation;
}>;

type RuntimeLauncherActionKind =
  | 'start_environment_runtime'
  | 'restart_environment_runtime'
  | 'update_environment_runtime'
  | 'stop_environment_runtime'
  | 'refresh_environment_runtime';
type DesktopEnvironmentRuntimeActionRequest = Extract<
  DesktopLauncherActionRequest,
  Readonly<{ kind: RuntimeLauncherActionKind }>
>;

type ProviderRuntimeLinkConfirmationAction = 'connect' | 'disconnect';

type ProviderRuntimeLinkConfirmationState = Readonly<{
  environment: DesktopEnvironmentEntry;
  action: ProviderRuntimeLinkConfirmationAction;
}>;

type LauncherActionErrorTarget = 'connect' | 'settings' | 'dialog' | 'control_plane_dialog' | 'gateway_dialog';
type GatewayRuntimeActionKind = Extract<
  DesktopLauncherActionKind,
  'start_gateway_runtime' | 'stop_gateway_runtime' | 'restart_gateway_runtime' | 'update_gateway_runtime' | 'refresh_gateway_catalog'
>;
type GatewayRuntimeStartPolicy = Extract<DesktopGatewayStartPolicy, 'start_if_needed'>;

const DESKTOP_FLOE_STORAGE_NAMESPACE = 'redeven-desktop-shell';
const DESKTOP_FLOE_THEME_STORAGE_KEY = 'theme';
const ACTION_TOAST_TTL_MS = 4_000;
const GUIDANCE_SUCCESS_DISMISS_MS = 720;
const GUIDANCE_SESSION_CLEAR_MS = 220;

const FALLBACK_DESKTOP_LANGUAGE_SNAPSHOT: RedevenLanguageSnapshot = {
  preference: SYSTEM_LOCALE_PREFERENCE,
  resolved_locale: 'en-US',
  source: 'fallback',
  system_candidates: [],
};

function normalizePixelMeasurement(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function readMeasuredElementWidth(element: HTMLElement | undefined): number {
  if (!element) {
    return 0;
  }
  return normalizePixelMeasurement(
    element.getBoundingClientRect().width || element.clientWidth || element.offsetWidth,
  );
}

function readDocumentRootFontSizePx(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 16;
  }
  const value = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  if (!Number.isFinite(value) || value <= 0) {
    return 16;
  }
  return value;
}

function buildDesktopFloeConfig(i18n: DesktopI18n) {
  const themeBridge = desktopThemeBridge();
  const stateStorage = desktopStateStorageBridge();

  return {
    storage: {
      namespace: DESKTOP_FLOE_STORAGE_NAMESPACE,
      adapter: stateStorage
        ? createDesktopThemeStorageAdapter(
          stateStorage,
          DESKTOP_FLOE_STORAGE_NAMESPACE,
          DESKTOP_FLOE_THEME_STORAGE_KEY,
          themeBridge,
        )
        : undefined,
    },
    theme: {
      storageKey: DESKTOP_FLOE_THEME_STORAGE_KEY,
      defaultTheme: themeBridge?.getSnapshot().source ?? 'system',
    },
    commands: {
      ignoreWhenTyping: false,
    },
    accessibility: {
      mainContentId: 'redeven-desktop-main',
      skipLinkLabel: i18n.t('shell.accessibility.skipLinkLabel'),
      topBarLabel: i18n.t('shell.accessibility.topBarLabel'),
      primaryNavigationLabel: i18n.t('shell.accessibility.primaryNavigationLabel'),
      mobileNavigationLabel: i18n.t('shell.accessibility.mobileNavigationLabel'),
      sidebarLabel: i18n.t('shell.accessibility.sidebarLabel'),
      mainLabel: i18n.t('shell.accessibility.mainLabel'),
    },
    strings: {
      topBar: {
        searchPlaceholder: i18n.t('shell.commandSearchPlaceholder'),
      },
    },
  } as const;
}

const ENVIRONMENT_CENTER_TABS: readonly Readonly<{ value: EnvironmentCenterTab; labelKey: DesktopTranslationKey }>[] = [
  { value: 'environments', labelKey: 'environmentCenter.environmentsSection' },
  { value: 'control_planes', labelKey: 'desktop.provider' },
  { value: 'gateways', labelKey: 'environmentCenter.gatewaysSection' },
];

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function nextDesktopWelcomeSnapshot(
  current: DesktopWelcomeSnapshot,
  next: DesktopWelcomeSnapshot,
): DesktopWelcomeSnapshot {
  return selectLatestDesktopWelcomeSnapshot(current, next);
}

function defaultLocalUIPasswordMode(configured: boolean): DesktopLocalUIPasswordMode {
  return configured ? 'keep' : 'replace';
}

function passwordModeForInput(value: string, configured: boolean): DesktopLocalUIPasswordMode {
  return trimString(value) !== '' ? 'replace' : defaultLocalUIPasswordMode(configured);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return trimString(error.message);
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const directMessage = trimString(record.message)
      || trimString(record.error)
      || trimString(record.detail)
      || trimString(record.details);
    if (directMessage !== '') {
      return directMessage;
    }
    try {
      return trimString(JSON.stringify(record));
    } catch {
      return '';
    }
  }
  return trimString(error);
}

function localizedStringByValue(
  i18n: DesktopI18n,
  value: string | undefined,
  mapping: Readonly<Record<string, DesktopTranslationKey>>,
): string {
  const clean = trimString(value);
  const key = mapping[clean];
  return key ? i18n.t(key) : clean;
}

function localizedEnvironmentStatusLabel(i18n: DesktopI18n, label: string): string {
  return localizedStringByValue(i18n, label, {
    Open: 'environmentStatus.open',
    OPENING: 'environmentStatus.opening',
    READY: 'status.ready',
    CHECKING: 'environmentStatus.checking',
    'NOT CHECKED': 'environmentStatus.notChecked',
    'CHECK FAILED': 'environmentStatus.checkFailed',
    'RECONNECT REQUIRED': 'environmentStatus.reconnectRequired',
    'REMOTE OFFLINE': 'environmentStatus.remoteOffline',
    'SYNC FAILED': 'environmentStatus.syncFailed',
    'INVALID PROVIDER': 'environmentStatus.invalidProvider',
    REMOVED: 'environmentStatus.removed',
    'REFRESH NEEDED': 'environmentStatus.refreshNeeded',
    'RUNTIME OFFLINE': 'environmentStatus.runtimeOffline',
    'MANUAL AUTH REQUIRED': 'environmentStatus.manualAuthRequired',
    UNVERIFIED: 'environmentStatus.unverified',
    'SETUP REQUIRED': 'environmentStatus.setupRequired',
    'PAIRING REQUIRED': 'environmentStatus.pairingRequired',
    'TRUST CHANGED': 'environmentStatus.trustChanged',
    'RESOLVE GATEWAY': 'environmentStatus.resolveGateway',
    'GATEWAY OFFLINE': 'environmentStatus.gatewayOffline',
    STOPPED: 'environmentStatus.stopped',
    'RESTART REQUIRED': 'environmentStatus.restartRequired',
    'RUNTIME NEEDS UPDATE': 'environmentStatus.runtimeNeedsUpdate',
    'RUNTIME BLOCKED': 'environmentStatus.runtimeBlocked',
    'RUNTIME PREPARING': 'environmentStatus.runtimePreparing',
    'DESKTOP UPDATE REQUIRED': 'environmentStatus.desktopUpdateRequired',
    'Invalid response': 'environmentStatus.invalidResponse',
    'Status stale': 'environmentStatus.statusStale',
    Authorized: 'environmentStatus.authorized',
  });
}

function localizedEnvironmentActionLabel(i18n: DesktopI18n, label: string): string {
  return localizedStringByValue(i18n, label, {
    Open: 'environmentAction.open',
    Focus: 'environmentAction.focus',
    'Focus remote window': 'environmentAction.focusRemoteWindow',
    'Remote window opening...': 'environmentAction.remoteWindowOpening',
    'Remote window opening…': 'environmentAction.remoteWindowOpening',
    'Reconnect Provider': 'environmentAction.reconnectProvider',
    'Runtime actions': 'environmentAction.runtimeActions',
    'Refresh status': 'environmentAction.refreshStatus',
    'Refresh runtime status': 'environmentAction.refreshRuntimeStatus',
    'Refresh Runtime status': 'environmentAction.refreshRuntimeStatus',
    'Refresh provider status': 'environmentAction.refreshProviderStatus',
    'Refresh Gateway status': 'environmentAction.refreshRuntimeStatus',
    Resolve: 'environmentAction.continue',
    Pair: 'environmentAction.pairGateway',
    'Pair Gateway': 'environmentAction.pairGateway',
    'Set up': 'environmentStatus.setupRequired',
    Manage: 'environmentAction.manageInDesktop',
    'Start Gateway': 'environmentAction.startRuntime',
    'Starting...': 'progress.startingRuntime',
    'Starting…': 'progress.startingRuntime',
    'Stop': 'environmentAction.stopRuntime',
    'Restart': 'environmentAction.restartRuntime',
    'Update': 'environmentAction.updateRuntime',
    'Update Gateway': 'environmentAction.updateRuntime',
    'Resolve Gateway': 'environmentAction.continue',
    Refresh: 'environmentAction.refreshStatus',
    Start: 'environmentAction.startRuntime',
    'Start runtime': 'environmentAction.startRuntime',
    'Start Runtime': 'environmentAction.startRuntime',
    'Stop runtime': 'environmentAction.stopRuntime',
    'Stop Runtime': 'environmentAction.stopRuntime',
    'Restart runtime': 'environmentAction.restartRuntime',
    'Restart Runtime': 'environmentAction.restartRuntime',
    'Update runtime': 'environmentAction.updateRuntime',
    'Update Runtime': 'environmentAction.updateRuntime',
    'Update and restart...': 'environmentAction.updateAndRestart',
    'Update and restart…': 'environmentAction.updateAndRestart',
    'Restart runtime...': 'environmentAction.restartRuntimeEllipsis',
    'Restart runtime…': 'environmentAction.restartRuntimeEllipsis',
    'Connect to provider': 'environmentAction.connectToProvider',
    'Connect to provider...': 'environmentAction.connectToProviderEllipsis',
    'Connect to provider…': 'environmentAction.connectToProviderEllipsis',
    'Disconnect from provider': 'environmentAction.disconnectFromProvider',
    'Connecting to provider': 'environmentAction.connectingToProvider',
    'Disconnecting from provider': 'environmentAction.disconnectingFromProvider',
    'Provider link needs attention': 'environmentAction.providerLinkNeedsAttention',
    'Provider link unavailable': 'environmentAction.providerLinkUnavailable',
    Continue: 'environmentAction.continue',
    'Manage in Desktop': 'environmentAction.manageInDesktop',
    'Update Redeven Desktop': 'environmentAction.updateRedevenDesktop',
  });
}

function localizedEnvironmentAction(
  i18n: DesktopI18n,
  action: EnvironmentActionModel,
): EnvironmentActionModel {
  return {
    ...action,
    label: localizedEnvironmentActionLabel(i18n, action.label),
    ...(action.disabled_reason
      ? { disabled_reason: localizedRuntimeMessage(i18n, action.disabled_reason) }
      : {}),
  };
}

function localizedEnvironmentMenuItem(
  i18n: DesktopI18n,
  item: EnvironmentActionMenuItemModel,
): EnvironmentActionMenuItemModel {
  const action = localizedEnvironmentAction(i18n, item.action);
  return {
    ...item,
    label: localizedEnvironmentActionLabel(i18n, item.label),
    action,
  };
}

function localizedGuidanceAction(
  i18n: DesktopI18n,
  item: EnvironmentGuidanceActionModel,
): EnvironmentGuidanceActionModel {
  return {
    ...item,
    label: localizedEnvironmentActionLabel(i18n, item.label),
    action: localizedEnvironmentAction(i18n, item.action),
  };
}

function localizedRuntimeMessage(i18n: DesktopI18n, message: string): string {
  const clean = trimString(message);
  const localizedMaintenance = localizedRuntimeMaintenanceMessage(i18n, clean);
  if (localizedMaintenance) {
    return localizedMaintenance;
  }
  const runtimeVersionUpdate = clean.match(/^Update this [Rr]untime from (.+) to (.+) before continuing\.$/u);
  if (runtimeVersionUpdate) {
    return i18n.t('runtimeMessage.updateRuntimeVersionBeforeContinuing', {
      current: runtimeVersionUpdate[1] ?? '',
      target: runtimeVersionUpdate[2] ?? '',
    });
  }
  const desktopBundledRuntimeUpdate = clean.match(/^Update Redeven Desktop to bring the bundled [Rr]untime from (.+) to (.+)\.$/u);
  if (desktopBundledRuntimeUpdate) {
    return i18n.t('runtimeMessage.updateDesktopBundledRuntimeVersion', {
      current: desktopBundledRuntimeUpdate[1] ?? '',
      target: desktopBundledRuntimeUpdate[2] ?? '',
    });
  }
  return localizedStringByValue(i18n, clean, {
    'Runtime is not running.': 'runtimeMessage.runtimeIsNotRunning',
    'Runtime daemon is not running.': 'runtimeMessage.runtimeDaemonNotRunning',
    'Runtime lock metadata is present but no live runtime is reachable.': 'runtimeMessage.runtimeLockMetadataStale',
    'Runtime status could not be verified.': 'runtimeMessage.runtimeStatusCouldNotBeVerified',
    'Start this runtime before connecting it to a provider.': 'runtimeMessage.startRuntimeBeforeProvider',
    'Start this runtime before opening it.': 'runtimeMessage.startRuntimeBeforeOpening',
    'Restart this runtime from Desktop so runtime-control can be prepared.': 'runtimeMessage.restartRuntimeForRuntimeControl',
    'Runtime-control is not available for this runtime.': 'runtimeMessage.runtimeControlUnavailable',
    'This runtime is owned by another Desktop instance.': 'runtimeMessage.runtimeOwnedByAnotherDesktop',
    'This runtime is managed by another Desktop instance.': 'runtimeMessage.runtimeManagedByAnotherDesktop',
    'Open this runtime to prepare the Desktop bridge and provider connection.': 'runtimeMessage.openRuntimePrepareProviderConnection',
    'Update this runtime before continuing.': 'runtimeMessage.updateRuntimeBeforeContinuing',
    'Update this incompatible runtime before continuing.': 'runtimeMessage.updateIncompatibleRuntimeBeforeContinuing',
    'Update Redeven Desktop before continuing with this local runtime.': 'runtimeMessage.updateDesktopBeforeLocalRuntime',
    'Update the runtime before opening this environment.': 'runtimeMessage.updateRuntimeBeforeOpeningEnvironment',
    'Update Desktop before opening this environment.': 'runtimeMessage.updateDesktopBeforeOpeningEnvironment',
    'Update this runtime before opening it with this Desktop.': 'runtimeMessage.updateRuntimeBeforeOpeningWithDesktop',
    'Runtime maintenance is required before this environment can open.': 'runtimeMessage.runtimeMaintenanceRequiredBeforeOpen',
    'The Environment App shell is not available in this runtime build. Install the update, then restart the runtime when it is safe to interrupt active work.': 'runtimeMessage.envAppShellUnavailableRuntimeBuild',
    'Active work may be interrupted. Confirm before changing this runtime.': 'runtimeMessage.confirmActiveWorkBeforeChangingRuntime',
    'Refresh provider status before opening this environment.': 'runtimeMessage.refreshProviderStatusBeforeOpening',
    'This Local UI target is unavailable right now.': 'runtimeMessage.localUiTargetUnavailable',
    'Runtime is not ready to open yet.': 'runtimeMessage.runtimeNotReadyToOpenYet',
    'Runtime readiness is not available yet.': 'runtimeMessage.runtimeReadinessUnavailable',
    'Runtime is ready to open.': 'runtimeMessage.runtimeReadyToOpen',
    'Runtime cannot open this environment yet.': 'runtimeMessage.runtimeCannotOpenEnvironmentYet',
    'Runtime cannot open this Environment yet.': 'runtimeMessage.runtimeCannotOpenEnvironmentYet',
    'Runtime is preparing the environment app.': 'runtimeMessage.runtimePreparingEnvironmentApp',
    'Desktop will wait for the Environment App to finish preparing.': 'runtimeMessage.desktopWaitEnvironmentAppPreparing',
    'Desktop will try opening this runtime and report upgrade guidance if the runtime rejects the connection.': 'runtimeMessage.desktopTryOpenRuntimeReportUpgrade',
    'Provider link needs attention.': 'runtimeMessage.providerLinkNeedsAttentionDetail',
    'Provider link is unavailable for this runtime.': 'runtimeMessage.providerLinkUnavailableDetail',
    'Choose an available Provider Environment before connecting this runtime.': 'runtimeMessage.providerLinkConnectUnavailableDetail',
    'Runtime is offline or unavailable right now. Start it from its source, then refresh status.': 'runtimeMessage.runtimeOfflineRefresh',
    'Desktop needs fresh provider authorization before it can open or connect this provider Environment.': 'runtimeMessage.providerAuthRequired',
    'Remote open is not ready yet. Open stays separate from runtime start and provider link actions.': 'runtimeMessage.remoteOpenNotReady',
    'Desktop has not checked this runtime yet. Refresh status now, or start the runtime when you already know it is offline.': 'runtimeMessage.statusNotCheckedDetail',
    'Connect this runtime to a provider Environment first. Open stays separate and becomes available after the link is ready.': 'runtimeMessage.connectProviderFirst',
    'Open becomes available after Desktop updates the runtime package in this running container and the runtime reports ready.': 'runtimeMessage.updateContainerRuntimeReady',
    'Open becomes available after Desktop updates the runtime on this SSH host and it reports ready.': 'runtimeMessage.updateSshRuntimeReady',
    'Open becomes available after Desktop completes the runtime update and it reports ready.': 'runtimeMessage.updateRuntimeReady',
    'Open becomes available after Desktop restarts the runtime on this SSH host and it reports ready.': 'runtimeMessage.restartSshRuntimeReady',
    'Open becomes available after Desktop restarts the runtime and it reports ready.': 'runtimeMessage.restartRuntimeReady',
    'Open becomes available once the runtime package is ready in this running container.': 'runtimeMessage.containerPackageReady',
    'Open becomes available once the runtime is ready on this SSH host.': 'runtimeMessage.sshRuntimeReady',
    'Open becomes available once the runtime is ready on this device.': 'runtimeMessage.localRuntimeReady',
    'This Local Environment uses the runtime bundled with Redeven Desktop. Open becomes available after the Desktop update handoff refreshes the app and bundled local runtime.': 'runtimeMessage.desktopLocalRuntimeUpdateHandoffReady',
    'Desktop could not connect this runtime to the provider Environment.': 'runtimeMessage.providerLinkFailedDetail',
    'Desktop could not disconnect this runtime from its provider Environment.': 'runtimeMessage.providerUnlinkFailedDetail',
    'Desktop could not refresh the runtime status.': 'runtimeMessage.statusRefreshFailedDetail',
    'The runtime is still offline on this SSH host. Start it from the same host, then try again.': 'runtimeMessage.runtimeStillOfflineSshDetail',
    'The runtime is still offline on this device. Start it from its source, then try again.': 'runtimeMessage.runtimeStillOfflineLocalDetail',
    'The environment window is open and ready to focus.': 'runtimeMessage.environmentWindowReadyDetail',
    'Desktop is preparing the environment window.': 'runtimeMessage.environmentWindowPreparingDetail',
    'The runtime is ready on this SSH host. Open is available now.': 'runtimeMessage.runtimeReadySshOpenDetail',
    'The runtime is ready. Open is available now.': 'runtimeMessage.runtimeReadyOpenDetail',
    'Desktop is probing the latest runtime health for this environment.': 'runtimeMessage.checkingRuntimeStatusDetail',
    'Desktop is requesting a provider link ticket and connecting the selected runtime.': 'runtimeMessage.connectingRuntimeDetail',
    'Desktop is disconnecting the selected runtime from its provider.': 'runtimeMessage.disconnectingRuntimeDetail',
    'Refreshing the latest environment status from this provider.': 'runtimeMessage.providerRefreshingDetail',
    'Desktop authorization expired. Reconnect in your browser to refresh environments again.': 'runtimeMessage.providerAuthorizationExpiredDetail',
    'Desktop could not reach this provider.': 'runtimeMessage.providerReachFailedDetail',
    'This provider returned an invalid response.': 'runtimeMessage.providerInvalidResponseDetail',
    'Desktop could not refresh this provider.': 'runtimeMessage.providerRefreshFailedDetail',
    'The last provider sync is getting old. Refresh to confirm the latest environment status.': 'runtimeMessage.providerStatusStaleDetail',
    'Desktop has active provider authorization and a fresh environment catalog.': 'runtimeMessage.providerAuthorizedDetail',
  });
}

function localizedRuntimeMaintenanceSubject(i18n: DesktopI18n, subject: string): string {
  return localizedStringByValue(i18n, subject, {
    'SSH container runtime': 'runtimeMessage.sshContainerRuntime',
    'local container runtime': 'runtimeMessage.localContainerRuntime',
    'SSH runtime': 'runtimeMessage.sshRuntime',
    'local runtime': 'runtimeMessage.localRuntime',
    'SSH container Runtime': 'runtimeMessage.sshContainerRuntime',
    'local container Runtime': 'runtimeMessage.localContainerRuntime',
    'SSH Runtime': 'runtimeMessage.sshRuntime',
    'local Runtime': 'runtimeMessage.localRuntime',
    Runtime: 'runtimeMessage.runtime',
    runtime: 'runtimeMessage.runtime',
  });
}

function localizedRuntimeMaintenanceMessage(i18n: DesktopI18n, message: string): string {
  const runtimeWord = '[Rr]untime';
  const environmentWord = '[Ee]nvironment';
  const modelSource = message.match(new RegExp(`^This (.+) needs an update before Desktop can make your local model settings available here\\\\. Update and restart the ${runtimeWord} first; Open stays separate and becomes available after the ${runtimeWord} is ready\\\\.$`, 'u'));
  if (modelSource) {
    return i18n.t('runtimeMessage.modelSourceNeedsUpdateDetail', {
      subject: localizedRuntimeMaintenanceSubject(i18n, modelSource[1] ?? ''),
    });
  }
  const notRunning = message.match(new RegExp(`^This (.+) is not running\\\\. Start the ${runtimeWord} again; Open becomes available after the ${runtimeWord} reports ready\\\\.$`, 'u'));
  if (notRunning) {
    return i18n.t('runtimeMessage.runtimeNotRunningDetail', {
      subject: localizedRuntimeMaintenanceSubject(i18n, notRunning[1] ?? ''),
    });
  }
  const restartRequired = message.match(new RegExp(`^This (.+) needs a successful restart before it can open this ${environmentWord}\\\\. Restart the ${runtimeWord}, then open it again after it reports ready\\\\.$`, 'u'));
  if (restartRequired) {
    return i18n.t('runtimeMessage.runtimeRestartRequiredDetail', {
      subject: localizedRuntimeMaintenanceSubject(i18n, restartRequired[1] ?? ''),
    });
  }
  const updateRequired = message.match(new RegExp(`^This (.+) needs an update before it can open this ${environmentWord}\\\\. (Update and restart the ${runtimeWord} first|Update the ${runtimeWord} first); Open stays separate and becomes available after the ${runtimeWord} is ready\\\\.$`, 'u'));
  if (updateRequired) {
    const action = localizedStringByValue(i18n, updateRequired[2] ?? '', {
      'Update and restart the runtime first': 'runtimeMessage.updateAndRestartRuntimeFirst',
      'Update the runtime first': 'runtimeMessage.updateRuntimeFirst',
      'Update and restart the Runtime first': 'runtimeMessage.updateAndRestartRuntimeFirst',
      'Update the Runtime first': 'runtimeMessage.updateRuntimeFirst',
    });
    return i18n.t('runtimeMessage.runtimeUpdateRequiredDetail', {
      subject: localizedRuntimeMaintenanceSubject(i18n, updateRequired[1] ?? ''),
      action,
    });
  }
  return '';
}

function localizedToastMessage(i18n: DesktopI18n, message: string): string {
  return localizedRuntimeMessage(i18n, message);
}

function localizedOverlayTitle(i18n: DesktopI18n, title: string): string {
  return localizedStringByValue(i18n, title, {
    Ready: 'progress.ready',
    Working: 'progress.running',
    'Needs attention': 'progress.needsAttention',
    'Runtime offline': 'runtimeMessage.runtimeOfflineTitle',
    'Connect to provider to continue': 'runtimeMessage.connectProviderTitle',
    'Provider link failed': 'runtimeMessage.providerLinkFailedTitle',
    'Provider unlink failed': 'runtimeMessage.providerUnlinkFailedTitle',
    'Status refresh failed': 'runtimeMessage.statusRefreshFailedTitle',
    'Checking runtime status…': 'runtimeMessage.checkingRuntimeStatusTitle',
    'Connecting runtime…': 'runtimeMessage.connectingRuntimeTitle',
    'Disconnecting runtime…': 'runtimeMessage.disconnectingRuntimeTitle',
    'Update the runtime to continue': 'runtimeMessage.updateRuntimeTitle',
    'Update Redeven Desktop to continue': 'runtimeMessage.updateDesktopTitle',
    'Restart the runtime to continue': 'runtimeMessage.restartRuntimeTitle',
    'Start the runtime to continue': 'runtimeMessage.startRuntimeTitle',
    'Start the local runtime to continue': 'runtimeMessage.startLocalRuntimeTitle',
    'Desktop model source needs update': 'runtimeMessage.desktopModelSourceNeedsUpdate',
    'Runtime ready': 'progress.titleRuntimeReady',
    'Runtime restart required': 'runtimeMessage.runtimeRestartRequired',
    'Runtime update required': 'runtimeMessage.runtimeUpdateRequired',
    'Redeven Desktop update required': 'runtimeMessage.desktopUpdateRequired',
    'Runtime cannot open yet': 'runtimeMessage.runtimeCannotOpenYet',
    'Provider reports offline': 'runtimeMessage.providerReportsOffline',
    'Provider is unreachable': 'runtimeMessage.providerUnreachable',
    'Provider response is invalid': 'runtimeMessage.providerResponseInvalid',
    'Environment removed': 'runtimeMessage.environmentRemoved',
    'Provider status is stale': 'runtimeMessage.providerStatusStale',
    'Refresh provider status': 'environmentAction.refreshProviderStatus',
    'Refresh status to continue': 'runtimeMessage.refreshStatusTitle',
    'Runtime still needs attention': 'runtimeMessage.runtimeStillNeedsAttention',
  });
}

function localizedOverlayEyebrow(i18n: DesktopI18n, eyebrow: string): string {
  return localizedStringByValue(i18n, eyebrow, {
    Ready: 'progress.ready',
    Working: 'progress.running',
    'Needs attention': 'progress.needsAttention',
    'Runtime offline': 'runtimeMessage.runtimeOfflineTitle',
    'Runtime blocked': 'runtimeMessage.runtimeBlockedTitle',
    'Remote route unavailable': 'runtimeMessage.remoteRouteUnavailable',
    'Status not checked': 'runtimeMessage.statusNotChecked',
  });
}

function localizedEnvironmentOverlay(
  i18n: DesktopI18n,
  overlay: EnvironmentPrimaryActionOverlayModel,
): EnvironmentPrimaryActionOverlayModel {
  if (overlay.kind === 'tooltip') {
    return {
      ...overlay,
      message: localizedRuntimeMessage(i18n, overlay.message),
    };
  }
  return {
    ...overlay,
    eyebrow: localizedOverlayEyebrow(i18n, overlay.eyebrow),
    title: localizedOverlayTitle(i18n, overlay.title),
    detail: localizedRuntimeMessage(i18n, overlay.detail),
    actions: overlay.actions.map((item) => localizedGuidanceAction(i18n, item)),
  };
}

function localizedEnvironmentActionPresentation(
  i18n: DesktopI18n,
  presentation: Extract<EnvironmentActionPresentation, Readonly<{ kind: 'split_button' }>>,
): Extract<EnvironmentActionPresentation, Readonly<{ kind: 'split_button' }>> {
  return {
    ...presentation,
    primary_action: localizedEnvironmentAction(i18n, presentation.primary_action),
    primary_action_overlay: presentation.primary_action_overlay
      ? localizedEnvironmentOverlay(i18n, presentation.primary_action_overlay)
      : undefined,
    menu_button_label: localizedEnvironmentActionLabel(i18n, presentation.menu_button_label),
    menu_actions: presentation.menu_actions.map((item) => localizedEnvironmentMenuItem(i18n, item)),
  };
}

function localizedFactLabel(i18n: DesktopI18n, label: string): string {
  return localizedStringByValue(i18n, label, {
    'RUNS ON': 'environmentFacts.runsOn',
    CONTAINER: 'environmentFacts.container',
    VERSION: 'environmentFacts.version',
    PROVIDER: 'environmentFacts.provider',
    'LOCAL LINK': 'environmentFacts.localLink',
    'ENV ID': 'environmentFacts.environmentId',
    OWNER: 'environmentFacts.owner',
    Provider: 'environmentFacts.provider',
    Gateway: 'environmentCenter.gatewaysSection',
    'Runtime root': 'environmentFacts.runtimeRoot',
    Bootstrap: 'environmentFacts.bootstrap',
    Source: 'environmentFacts.source',
    URL: 'environmentFacts.url',
    Local: 'environmentCenter.localFilter',
    'Redeven URL': 'environmentCenter.redevenUrlFilter',
    'SSH Host': 'environmentCenter.sshHostFilter',
    LOCAL: 'environmentFacts.local',
    'SSH HOST': 'environmentFacts.sshHost',
    'FORWARDED URL': 'environmentFacts.forwardedUrl',
    DETAIL: 'environmentFacts.detail',
  });
}

function environmentFlowerContextSummary(i18n: DesktopI18n, environment: DesktopEnvironmentEntry): string {
  const card = buildEnvironmentCardModel(environment);
  const fields = [
    localizedFactLabel(i18n, card.kind_label),
    localizedEnvironmentStatusLabel(i18n, card.status_label),
    environment.control_plane_label,
  ].map(trimString).filter(Boolean);
  return fields.join(' · ');
}

function buildEnvironmentFlowerPrompt(
  i18n: DesktopI18n,
  environment: DesktopEnvironmentEntry,
  message: string,
): string {
  const summary = environmentFlowerContextSummary(i18n, environment);
  const lines = [
    `From Desktop Environment: ${environment.label}`,
    `Environment ID: ${environment.id}`,
  ];
  if (summary) {
    lines.push(`Context: ${summary}`);
  }
  lines.push('', trimString(message));
  return lines.join('\n');
}

function environmentFlowerPrimaryTargetID(environment: DesktopEnvironmentEntry): string {
  const providerOrigin = trimString(environment.provider_origin);
  const envPublicID = trimString(environment.env_public_id);
  if (environment.kind === 'provider_environment' && providerOrigin && envPublicID) {
    return `cp:${encodeURIComponent(providerOrigin)}:env:${encodeURIComponent(envPublicID)}`;
  }
  return envPublicID
    || trimString(environment.provider_runtime_link_target?.id)
    || trimString(environment.managed_runtime_target_id)
    || trimString(environment.managed_runtime_placement_target_id)
    || trimString(environment.id);
}

function buildEnvironmentFlowerContextEnvelope(environment: DesktopEnvironmentEntry): {
  id: string;
  provider: string;
  raw: Record<string, unknown>;
} {
  const targetID = environmentFlowerPrimaryTargetID(environment);
  const actionID = `desktop-env-${targetID}`;
  return {
    id: actionID,
    provider: 'desktop_welcome',
    raw: {
      schema_version: 2,
      action_id: actionID,
      provider: 'desktop_welcome',
      target: {
        target_id: targetID,
        target_kind: environment.kind === 'provider_environment' ? 'provider_environment' : 'desktop_environment',
        provider_origin: trimString(environment.provider_origin),
        provider_id: trimString(environment.provider_id),
        env_public_id: trimString(environment.env_public_id),
        locality: 'auto',
      },
      source: {
        surface: 'desktop_welcome_environment_card',
        surface_id: trimString(environment.id),
      },
      execution_context: {
        current_target_id: targetID,
        source_env_public_id: trimString(environment.env_public_id),
        host_hint: 'auto',
        session_source: 'desktop_welcome',
      },
      context: [
        {
          kind: 'text_snapshot',
          title: environment.label,
          detail: environmentFlowerContextSummary(createDesktopI18n('en-US'), environment),
          content: [
            `Environment: ${environment.label}`,
            `Environment ID: ${environment.id}`,
            trimString(environment.local_ui_url) ? `Local UI URL: ${trimString(environment.local_ui_url)}` : '',
            trimString(environment.env_public_id) ? `Env public ID: ${trimString(environment.env_public_id)}` : '',
          ].filter(Boolean).join('\n'),
        },
      ],
      presentation: {
        label: environment.label,
        priority: 100,
        status_label: 'Ready',
      },
    },
  };
}

type EnvironmentFlowerComposerState = Readonly<{
  environment: DesktopEnvironmentEntry;
  anchor?: { x: number; y: number };
}>;

function currentViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 1440, height: 900 };
  }
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function resolveEnvironmentFlowerWindowSizing(viewport: { width: number; height: number }): Readonly<{
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maxSize: { width: number; height: number };
  margin: number;
}> {
  const compact = viewport.width < 640;
  const margin = compact ? 8 : 12;
  const maxSize = {
    width: Math.max(300, viewport.width - margin * 2),
    height: Math.max(360, viewport.height - margin * 2),
  };
  const defaultSize = {
    width: Math.min(compact ? 360 : 480, maxSize.width),
    height: Math.min(compact ? 420 : 460, maxSize.height),
  };
  const minSize = {
    width: Math.min(compact ? 300 : 360, maxSize.width),
    height: Math.min(compact ? 340 : 380, maxSize.height),
  };
  return { defaultSize, minSize, maxSize, margin };
}

function resolveEnvironmentFlowerWindowPosition(
  anchor: EnvironmentFlowerComposerState['anchor'],
  sizing: ReturnType<typeof resolveEnvironmentFlowerWindowSizing>,
): { x: number; y: number } | undefined {
  if (!anchor || typeof window === 'undefined') {
    return undefined;
  }
  const offset = 10;
  const maxX = Math.max(sizing.margin, window.innerWidth - sizing.defaultSize.width - sizing.margin);
  const maxY = Math.max(sizing.margin, window.innerHeight - sizing.defaultSize.height - sizing.margin);
  return {
    x: clampNumber(anchor.x + offset, sizing.margin, maxX),
    y: clampNumber(anchor.y + offset, sizing.margin, maxY),
  };
}

function localizedFactValue(i18n: DesktopI18n, label: string, value: string): string {
  const connecting = value.match(/^Connecting through (.+)$/u);
  if (label === 'LOCAL LINK' && connecting) {
    return i18n.t('environmentFacts.connectingThrough', { label: connecting[1] ?? '' });
  }
  const disconnecting = value.match(/^Disconnecting from (.+)$/u);
  if (label === 'LOCAL LINK' && disconnecting) {
    return i18n.t('environmentFacts.disconnectingFrom', { label: disconnecting[1] ?? '' });
  }
  const needsAttention = value.match(/^(.+) needs attention$/u);
  if (label === 'LOCAL LINK' && needsAttention) {
    return i18n.t('environmentFacts.runtimeNeedsAttention', { label: needsAttention[1] ?? '' });
  }
  if (label === 'VERSION') {
    return localizedStringByValue(i18n, value, {
      UNKNOWN: 'environmentFacts.unknown',
      Unknown: 'environmentFacts.unknown',
    });
  }
  if (label === 'PROVIDER') {
    return localizedStringByValue(i18n, value, {
      None: 'environmentFacts.none',
    });
  }
  if (label === 'ENV ID') {
    return localizedStringByValue(i18n, value, {
      UNKNOWN: 'environmentFacts.unknown',
      Unknown: 'environmentFacts.unknown',
    });
  }
  if (label === 'LOCAL LINK') {
    return localizedStringByValue(i18n, value, {
      'No managed runtime linked': 'environmentFacts.noManagedRuntimeLinked',
    });
  }
  if (label === 'RUNS ON') {
    return localizedStringByValue(i18n, value, {
      'This device': 'environmentFacts.thisDevice',
      'Provider remote': 'environmentFacts.providerRemote',
      'LAN host': 'environmentFacts.lanHost',
      'Remote host': 'environmentFacts.remoteHost',
      'Unknown host': 'environmentFacts.unknownHost',
    });
  }
  if (label === 'Bootstrap') {
    return localizedStringByValue(i18n, value, {
      'Desktop upload': 'environmentFacts.desktopUpload',
      'Remote fallback': 'environmentFacts.remoteFallback',
      Automatic: 'environmentFacts.automatic',
    });
  }
  if (label === 'Source') {
    return localizedStringByValue(i18n, value, {
      'Local environment': 'environmentFacts.localEnvironment',
      'Provider environment': 'environmentFacts.providerEnvironment',
    });
  }
  if (value === '' && label !== 'CONTAINER') {
    return localizedStringByValue(i18n, value, {});
  }
  return value;
}

function localizedPlaceholderFactValue(i18n: DesktopI18n, value: string): string {
  return localizedStringByValue(i18n, value, {
    UNKNOWN: 'environmentFacts.unknown',
    Unknown: 'environmentFacts.unknown',
    Unavailable: 'environmentFacts.unavailable',
    None: 'environmentFacts.none',
    Saved: 'environmentFacts.saved',
  });
}

function localizedRuntimeStartedLabel(i18n: DesktopI18n, value: string): string {
  const started = value.match(/^Started (.+)$/u);
  if (started) {
    return i18n.t('environmentFacts.startedAt', {
      time: localizedRuntimeStartedRelativeTime(i18n, started[1] ?? ''),
    });
  }
  return localizedStringByValue(i18n, value, {
    'Start time unavailable': 'environmentFacts.startTimeUnavailable',
    'Not running': 'environmentFacts.notRunning',
    Unknown: 'environmentFacts.unknown',
  });
}

function localizedRuntimeStartedRelativeTime(i18n: DesktopI18n, value: string): string {
  if (value === 'Just now') {
    return i18n.formatRelativeTime(Date.now(), { numeric: 'auto', style: 'short' });
  }
  const compactMatch = value.match(/^(\d+)([mhd]) ago$/u);
  if (!compactMatch) {
    return value;
  }
  const count = Number(compactMatch[1]);
  if (!Number.isFinite(count) || count <= 0) {
    return value;
  }
  const unit = compactMatch[2] === 'd'
    ? 'day'
    : compactMatch[2] === 'h'
      ? 'hour'
      : 'minute';
  const unitMs = unit === 'day' ? 86_400_000 : unit === 'hour' ? 3_600_000 : 60_000;
  return i18n.formatRelativeTime(Date.now() - count * unitMs, {
    unit,
    numeric: 'always',
    style: 'short',
  });
}

function localizedActionToastAction(
  i18n: DesktopI18n,
  action: DesktopActionToastAction | undefined,
): DesktopActionToastAction | undefined {
  return action
    ? {
        ...action,
        label: localizedStringByValue(i18n, action.label, {
          Dismiss: 'environmentCenter.dismissToast',
          Retry: 'common.retry',
          Refresh: 'common.refresh',
        }),
      }
    : undefined;
}

function localizedFactActionLabel(i18n: DesktopI18n, label: string): string {
  const show = label.match(/^Show (.+)$/u);
  if (show) {
    return i18n.t('environmentFacts.showLabel', { label: show[1] ?? '' });
  }
  return localizedCopyLabel(i18n, label) || label;
}

function localizedFactActionAriaLabel(i18n: DesktopI18n, label: string): string {
  const showLinked = label.match(/^Show linked runtime (.+)$/u);
  if (showLinked) {
    return i18n.t('environmentFacts.showLinkedRuntime', { label: showLinked[1] ?? '' });
  }
  return localizedCopyLabel(i18n, label) || localizedFactActionLabel(i18n, label);
}

function localizedCopyLabel(i18n: DesktopI18n, label: string): string {
  return localizedStringByValue(i18n, label, {
    'Copy local endpoint': 'environmentFacts.copyLocalEndpoint',
    'Copy environment URL': 'environmentFacts.copyEnvironmentUrl',
    'Copy endpoint': 'environmentFacts.copyEndpoint',
    'Copy SSH host': 'environmentFacts.copySshHost',
    'Copy forwarded URL': 'environmentFacts.copyForwardedUrl',
  });
}

function copiedValueLabel(i18n: DesktopI18n, label: string): string {
  const keyByLocalized = new Map<string, string>([
    ['Copy local endpoint', i18n.t('environmentFacts.localEndpoint')],
    ['Copy environment URL', i18n.t('environmentFacts.environmentUrl')],
    ['Copy endpoint', i18n.t('environmentFacts.endpoint')],
    ['Copy SSH host', i18n.t('environmentFacts.sshHostLower')],
    ['Copy forwarded URL', i18n.t('environmentFacts.forwardedUrlLower')],
    [i18n.t('environmentFacts.copyLocalEndpoint'), i18n.t('environmentFacts.localEndpoint')],
    [i18n.t('environmentFacts.copyEnvironmentUrl'), i18n.t('environmentFacts.environmentUrl')],
    [i18n.t('environmentFacts.copyEndpoint'), i18n.t('environmentFacts.endpoint')],
    [i18n.t('environmentFacts.copySshHost'), i18n.t('environmentFacts.sshHostLower')],
    [i18n.t('environmentFacts.copyForwardedUrl'), i18n.t('environmentFacts.forwardedUrlLower')],
    [i18n.t('environmentFacts.localEndpoint'), i18n.t('environmentFacts.localEndpoint')],
    [i18n.t('environmentFacts.environmentUrl'), i18n.t('environmentFacts.environmentUrl')],
    [i18n.t('environmentFacts.endpoint'), i18n.t('environmentFacts.endpoint')],
    [i18n.t('environmentFacts.sshHostLower'), i18n.t('environmentFacts.sshHostLower')],
    [i18n.t('environmentFacts.forwardedUrlLower'), i18n.t('environmentFacts.forwardedUrlLower')],
  ]);
  return keyByLocalized.get(label) ?? label;
}

function localizedEnvironmentFact(
  i18n: DesktopI18n,
  fact: EnvironmentCardFactModel,
): EnvironmentCardFactModel {
  return {
    ...fact,
    label: localizedFactLabel(i18n, fact.label),
    value: fact.value_tone === 'placeholder'
      ? localizedPlaceholderFactValue(i18n, fact.value)
      : localizedFactValue(i18n, fact.label, fact.value),
    action: fact.action
      ? {
          ...fact.action,
          label: localizedFactActionLabel(i18n, fact.action.label),
          aria_label: localizedFactActionAriaLabel(i18n, fact.action.aria_label),
        }
      : undefined,
    endpoints: fact.endpoints?.map((endpoint) => ({
      ...endpoint,
      label: localizedFactLabel(i18n, endpoint.label),
      copy_label: localizedCopyLabel(i18n, endpoint.copy_label),
    })),
  };
}

function inlineFailurePresentation(
  i18n: DesktopI18n,
  message: string,
  tone: 'error' | 'warning',
): DesktopOperationFailurePresentation {
  return {
    code: 'operation_failed',
    severity: tone,
    title: tone === 'warning' ? i18n.t('toast.needsAttention') : i18n.t('toast.couldNotComplete'),
    summary: trimString(message) || i18n.t('toast.actionFailedFallback'),
  };
}

function localizedFailureForDisplay(
  i18n: DesktopI18n,
  failure: DesktopOperationFailurePresentation,
): DesktopOperationFailurePresentation {
  return {
    ...failure,
    title: localizedOperationFailureTitle(i18n, failure),
    summary: localizedOperationFailureSummary(i18n, failure),
    ...(failure.detail ? { detail: localizedOperationFailureDetail(i18n, failure) } : {}),
    ...(failure.recovery_hint ? { recovery_hint: localizedOperationFailureRecoveryHint(i18n, failure) } : {}),
  };
}

type SilentLauncherActionFailure = Readonly<{
  ok: false;
  message: string;
  failure?: DesktopOperationFailurePresentation;
}>;

function launcherFailureSummary(failure: SilentLauncherActionFailure): string {
  return trimString(failure.failure?.summary) || trimString(failure.message);
}

function localizedIssueTitle(i18n: DesktopI18n, issue: DesktopWelcomeIssue): string {
  return issue.title_key ? i18n.t(issue.title_key) : trimString(issue.title);
}

function localizedIssueMessage(i18n: DesktopI18n, issue: DesktopWelcomeIssue): string {
  return issue.message_key ? i18n.t(issue.message_key) : trimString(issue.message);
}

function formatIssueToastMessage(i18n: DesktopI18n, issue: DesktopWelcomeIssue): string {
  const message = localizedIssueMessage(i18n, issue);
  const title = localizedIssueTitle(i18n, issue);
  if (message === '') {
    return title;
  }
  return title !== '' && message !== title ? `${title}: ${message}` : message;
}

function runtimeContainerHostAccessFromDialogState(
  state: RuntimeContainerConnectionDialogState,
): DesktopRuntimeHostAccess | null {
  if (state.connection_kind === 'local_container_runtime') {
    return { kind: 'local_host' };
  }
  const sshDestination = trimString(state.ssh_destination);
  if (sshDestination === '') {
    return null;
  }
  const sshPortText = trimString(state.ssh_port);
  return {
    kind: 'ssh_host',
    ssh: {
      ssh_destination: sshDestination,
      ssh_port: sshPortText === '' ? null : Number.parseInt(sshPortText, 10),
      auth_mode: state.auth_mode,
      connect_timeout_seconds: trimString(state.connect_timeout_seconds) === ''
        ? DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS
        : Number(trimString(state.connect_timeout_seconds)),
    },
  };
}

function runtimeContainerOptionsRequestKey(state: ConnectionDialogState): string {
  if (state?.connection_kind !== 'local_container_runtime' && state?.connection_kind !== 'ssh_container_runtime') {
    return '';
  }
  const hostAccess = runtimeContainerHostAccessFromDialogState(state);
  if (!hostAccess) {
    return '';
  }
  return JSON.stringify({
    host_access: hostAccess,
    engine: state.container_engine,
  });
}

function issueToastTone(issue: DesktopWelcomeIssue): DesktopActionToastTone {
  if (issue.scope === 'startup' || issue.code === 'state_dir_locked') {
    return 'warning';
  }
  return 'error';
}

function controlPlaneName(controlPlane: DesktopControlPlaneSummary): string {
  return trimString(controlPlane.display_label) || controlPlane.provider.display_name;
}

function environmentRuntimeServiceSnapshot(
  environment: DesktopEnvironmentEntry | null | undefined,
): RuntimeServiceSnapshot | undefined {
  if (!environment) {
    return undefined;
  }
  if (environment.runtime_service) {
    return environment.runtime_service;
  }
  if (environment.kind === 'local_environment') {
    return environment.local_environment_runtime_service;
  }
  return undefined;
}

function controlPlaneFilterValue(controlPlane: DesktopControlPlaneSummary): string {
  return desktopControlPlaneKey(
    controlPlane.provider.provider_origin,
    controlPlane.provider.provider_id,
  );
}

function formatTimestamp(unixMS: number): string {
  if (!Number.isFinite(unixMS) || unixMS <= 0) {
    return '';
  }
  try {
    return new Date(unixMS).toLocaleString();
  } catch {
    return '';
  }
}

function formatLocalizedRelativeTimestamp(i18n: DesktopI18n, unixMS: number): string {
  if (!Number.isFinite(unixMS) || unixMS <= 0) {
    return i18n.t('common.never');
  }
  try {
    return i18n.formatRelativeTime(unixMS, { style: 'short' });
  } catch {
    return formatTimestamp(unixMS) || i18n.t('common.unknown');
  }
}

function createExternalURLConnectionDialogState(
  mode: 'create' | 'edit',
  overrides: Partial<ExternalURLConnectionDialogState> = {},
): ExternalURLConnectionDialogState {
  return {
    mode,
    connection_kind: 'external_local_ui',
    environment_id: trimString(overrides.environment_id),
    label: trimString(overrides.label),
    external_local_ui_url: trimString(overrides.external_local_ui_url),
    auto_runtime_probe_enabled: overrides.auto_runtime_probe_enabled === true,
  };
}

function createSSHConnectionDialogState(
  mode: 'create' | 'edit',
  overrides: Partial<SSHConnectionDialogState> = {},
): SSHConnectionDialogState {
  const sshDestination = trimString(overrides.ssh_destination);
  const sshPort = trimString(overrides.ssh_port);
  const authMode = (trimString(overrides.auth_mode) as DesktopSSHAuthMode) || DEFAULT_DESKTOP_SSH_AUTH_MODE;
  return {
    mode,
    connection_kind: 'ssh_environment',
    environment_id: trimString(overrides.environment_id),
    label: trimString(overrides.label),
    ssh_destination: sshDestination,
    ssh_port: sshPort,
    auth_mode: authMode,
    ssh_password: '',
    ssh_password_mode: overrides.ssh_password_configured ? 'keep' : 'replace',
    ssh_password_configured: overrides.ssh_password_configured === true,
    baseline_ssh_destination: sshDestination,
    baseline_ssh_port: sshPort,
    baseline_auth_mode: authMode,
    runtime_root: trimString(overrides.runtime_root),
    bootstrap_strategy: (trimString(overrides.bootstrap_strategy) as DesktopSSHBootstrapStrategy) || DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
    release_base_url: trimString(overrides.release_base_url),
    connect_timeout_seconds: trimString(overrides.connect_timeout_seconds),
    auto_runtime_probe_enabled: overrides.auto_runtime_probe_enabled === true,
  };
}

function createRuntimeContainerConnectionDialogState(
  mode: 'create' | 'edit',
  kind: RuntimeContainerConnectionDialogState['connection_kind'],
  overrides: Partial<RuntimeContainerConnectionDialogState> = {},
): RuntimeContainerConnectionDialogState {
  const sshDestination = trimString(overrides.ssh_destination);
  const sshPort = trimString(overrides.ssh_port);
  const authMode = (trimString(overrides.auth_mode) as DesktopSSHAuthMode) || DEFAULT_DESKTOP_SSH_AUTH_MODE;
  return {
    mode,
    connection_kind: kind,
    environment_id: trimString(overrides.environment_id),
    label: trimString(overrides.label),
    ssh_destination: sshDestination,
    ssh_port: sshPort,
    auth_mode: authMode,
    ssh_password: '',
    ssh_password_mode: overrides.ssh_password_configured ? 'keep' : 'replace',
    ssh_password_configured: overrides.ssh_password_configured === true,
    baseline_ssh_destination: sshDestination,
    baseline_ssh_port: sshPort,
    baseline_auth_mode: authMode,
    connect_timeout_seconds: trimString(overrides.connect_timeout_seconds),
    container_engine: overrides.container_engine ?? 'docker',
    container_id: trimString(overrides.container_id),
    container_ref: trimString(overrides.container_ref) || trimString(overrides.container_label) || trimString(overrides.container_id),
    container_label: trimString(overrides.container_label),
    runtime_root: trimString(overrides.runtime_root) === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT
      ? ''
      : trimString(overrides.runtime_root) || (kind === 'ssh_container_runtime' ? '' : '/root/.redeven'),
    auto_runtime_probe_enabled: kind === 'local_container_runtime'
      ? true
      : overrides.auto_runtime_probe_enabled === true,
    auto_runtime_probe_configurable: kind === 'local_container_runtime'
      ? false
      : overrides.auto_runtime_probe_configurable !== false,
  };
}

function normalizeGatewayDisplayNameSeed(value: string): string {
  return trimString(value)
    .replace(/^https?:\/\//iu, '')
    .replace(/[/?#].*$/u, '')
    .replace(/[^A-Za-z0-9_.@-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function suggestGatewayDisplayName(state: GatewaySetupDialogState | null): string | null {
  if (!state) {
    return null;
  }
  const seed = (() => {
    switch (state.connection_kind) {
      case 'url':
        return normalizeGatewayDisplayNameSeed(state.gateway_url);
      case 'ssh_host':
        return normalizeGatewayDisplayNameSeed(state.ssh_destination);
      case 'ssh_container':
        return normalizeGatewayDisplayNameSeed(
          state.container_label || state.container_ref || state.container_id || state.ssh_destination,
        );
    }
  })();
  return seed === '' ? null : `Gateway-${seed}`;
}

function createGatewaySetupDialogState(
  overrides: Partial<GatewaySetupDialogState> = {},
): GatewaySetupDialogState {
  const connectionKind = overrides.connection_kind ?? 'url';
  const displayName = trimString(overrides.display_name);
  const sshDestination = trimString(overrides.ssh_destination);
  const sshPort = trimString(overrides.ssh_port);
  const authMode = (trimString(overrides.auth_mode) as DesktopSSHAuthMode) || DEFAULT_DESKTOP_SSH_AUTH_MODE;
  const state: GatewaySetupDialogState = {
    mode: overrides.mode ?? 'create',
    gateway_id: trimString(overrides.gateway_id),
    display_name: displayName,
    display_name_touched: overrides.display_name_touched === true
      || ((overrides.mode ?? 'create') === 'edit' && displayName !== ''),
    connection_kind: connectionKind,
    gateway_url: trimString(overrides.gateway_url),
    allow_loopback_http: overrides.allow_loopback_http === true,
    ssh_destination: sshDestination,
    ssh_port: sshPort,
    auth_mode: authMode,
    ssh_password: '',
    ssh_password_mode: overrides.ssh_password_configured ? 'keep' : 'replace',
    ssh_password_configured: overrides.ssh_password_configured === true,
    baseline_ssh_destination: sshDestination,
    baseline_ssh_port: sshPort,
    baseline_auth_mode: authMode,
    connect_timeout_seconds: trimString(overrides.connect_timeout_seconds),
    bootstrap_strategy: (trimString(overrides.bootstrap_strategy) as DesktopSSHBootstrapStrategy) || DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
    release_base_url: trimString(overrides.release_base_url),
    container_engine: overrides.container_engine ?? 'docker',
    container_id: trimString(overrides.container_id),
    container_ref: trimString(overrides.container_ref) || trimString(overrides.container_label) || trimString(overrides.container_id),
    container_label: trimString(overrides.container_label),
    runtime_root: trimString(overrides.runtime_root) === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT
      ? ''
      : trimString(overrides.runtime_root),
  };
  if (state.display_name !== '' || state.display_name_touched) {
    return state;
  }
  return {
    ...state,
    display_name: suggestGatewayDisplayName(state) ?? '',
  };
}

function connectionDialogAutoRuntimeProbeConfigurable(state: ConnectionDialogState): boolean {
  if (!state) {
    return false;
  }
  if (state.connection_kind === 'local_container_runtime') {
    return false;
  }
  if (state.connection_kind === 'ssh_container_runtime') {
    return state.auto_runtime_probe_configurable !== false;
  }
  return true;
}

function isSSHPasswordConnectionDialogState(
  state: ConnectionDialogState,
): state is SSHPasswordConnectionDialogState {
  return state?.connection_kind === 'ssh_environment' || state?.connection_kind === 'ssh_container_runtime';
}

function isSSHPasswordDraftState(
  state: ConnectionDialogState | GatewaySetupDialogState,
): state is SSHPasswordDraftState {
  return !!state
    && (
      state.connection_kind === 'ssh_environment'
      || state.connection_kind === 'ssh_container_runtime'
      || state.connection_kind === 'ssh_host'
      || state.connection_kind === 'ssh_container'
    );
}

function sshPasswordIdentityMatchesBaseline(state: SSHPasswordDraftState): boolean {
  return trimString(state.ssh_destination) === trimString(state.baseline_ssh_destination)
    && trimString(state.ssh_port) === trimString(state.baseline_ssh_port)
    && state.auth_mode === state.baseline_auth_mode
    && state.auth_mode === 'password';
}

function reconcileSSHPasswordDraft<T extends SSHPasswordDraftState>(
  state: T,
  changedField: string,
): T {
  if (changedField === 'ssh_password') {
    return {
      ...state,
      ssh_password_mode: trimString(state.ssh_password) === '' ? state.ssh_password_mode : 'replace',
    };
  }
  if (changedField !== 'ssh_destination' && changedField !== 'ssh_port' && changedField !== 'auth_mode') {
    return state;
  }
  if (state.auth_mode !== 'password') {
    return {
      ...state,
      ssh_password: '',
      ssh_password_mode: 'clear',
    };
  }
  if (state.ssh_password_configured && sshPasswordIdentityMatchesBaseline(state)) {
    return {
      ...state,
      ssh_password: '',
      ssh_password_mode: 'keep',
    };
  }
  return {
    ...state,
    ssh_password: '',
    ssh_password_mode: state.ssh_password_configured ? 'clear' : 'replace',
  };
}

function suggestConnectionLabel(state: ConnectionDialogState): string | null {
  if (!state) return null;
  switch (state.connection_kind) {
    case 'ssh_environment': {
      const dest = trimString(state.ssh_destination);
      return dest === '' ? null : dest;
    }
    case 'local_container_runtime':
    case 'ssh_container_runtime': {
      const lbl = trimString(state.container_label);
      return lbl === '' ? null : lbl;
    }
    case 'external_local_ui':
      return null;
  }
}

function createControlPlaneDialogState(
  overrides: Partial<Exclude<ControlPlaneDialogState, null>> = {},
): Exclude<ControlPlaneDialogState, null> {
  const providerOrigin = trimString(overrides.provider_origin);
  const displayLabel = trimString(overrides.display_label);
  return {
    provider_origin: providerOrigin,
    display_label: displayLabel || suggestControlPlaneDisplayLabel(providerOrigin),
    display_label_touched: overrides.display_label_touched === true,
  };
}

function environmentKindTagVariant(kind: string): 'neutral' | 'primary' | 'success' {
  switch (kind) {
    case 'local_environment':
      return 'primary';
    case 'provider_environment':
      return 'neutral';
    case 'ssh_environment':
      return 'success';
    default:
      return 'neutral';
  }
}

function passwordStateTagVariant(
  tone: DesktopSettingsSurfaceSnapshot['password_state_tone'],
): 'neutral' | 'warning' | 'success' {
  switch (tone) {
    case 'warning':
      return 'warning';
    case 'success':
      return 'success';
    default:
      return 'neutral';
  }
}

function localizedCloseActionLabel(i18n: DesktopI18n, action: DesktopLauncherCloseAction): string {
  return action === 'quit' ? i18n.t('launcher.quit') : i18n.t('launcher.closeLauncher');
}

function localizedOpenActionLabel(i18n: DesktopI18n, action: DesktopEnvironmentOpenAction): string {
  switch (action) {
    case 'opening':
      return i18n.t('launcher.opening');
    case 'focus':
      return i18n.t('launcher.focus');
    default:
      return i18n.t('common.open');
  }
}

function localizedWindowsLabel(i18n: DesktopI18n, count: number): string {
  return i18n.t('launcher.windowsCount', { count });
}

function localizedVisibleLabel(i18n: DesktopI18n, count: number): string {
  return i18n.t('launcher.visibleCount', { count });
}

function languageSourceLabel(i18n: DesktopI18n, source: RedevenLanguageSnapshot['source']): string {
  switch (source) {
    case 'explicit':
      return i18n.t('settings.languageSourceExplicit');
    case 'system':
      return i18n.t('settings.languageSourceSystem');
    case 'fallback':
    default:
      return i18n.t('settings.languageSourceFallback');
  }
}

function settingsAddressCardTitle(i18n: DesktopI18n, accessMode: DesktopAccessMode): string {
  return accessMode === 'custom_exposure' ? i18n.t('settings.bindAddressTitle') : i18n.t('settings.portTitle');
}

function settingsAddressCardHelp(i18n: DesktopI18n, accessMode: DesktopAccessMode): string {
  if (accessMode === 'custom_exposure') {
    return i18n.t('settings.bindAddressHelp');
  }
  return accessMode === 'shared_local_network'
    ? i18n.t('settings.sharedPortHelp')
    : i18n.t('settings.localPortHelp');
}

function settingsProtectionCardTitle(i18n: DesktopI18n, accessMode: DesktopAccessMode): string {
  return accessMode === 'local_only' ? i18n.t('settings.protectionTitle') : i18n.t('settings.passwordTitle');
}

function settingsProtectionCardHelp(i18n: DesktopI18n, accessMode: DesktopAccessMode): string {
  if (accessMode === 'shared_local_network') {
    return i18n.t('settings.sharedPasswordHelp');
  }
  if (accessMode === 'custom_exposure') {
    return i18n.t('settings.customPasswordHelp');
  }
  return i18n.t('settings.localProtectionHelp');
}

function compactLocalizedPasswordStateTagLabel(
  i18n: DesktopI18n,
  stateID: DesktopSettingsSurfaceSnapshot['password_state_id'],
): string {
  return i18n.t(desktopPasswordStateTranslationKey(stateID));
}

function localizedAccessModeOption(
  i18n: DesktopI18n,
  option: DesktopSettingsSurfaceSnapshot['access_mode_options'][number],
) {
  switch (option.value) {
    case 'local_only':
      return {
        label: i18n.t(option.label_key),
        description: i18n.t(option.description_key),
      };
    case 'shared_local_network':
      return {
        label: i18n.t(option.label_key),
        description: i18n.t(option.description_key),
      };
    case 'custom_exposure':
      return {
        label: i18n.t(option.label_key),
        description: i18n.t(option.description_key),
      };
  }
}

function compactLocalizedSettingsFieldLabel(
  i18n: DesktopI18n,
  field: DesktopSettingsSurfaceSnapshot['host_fields'][number],
): string {
  return i18n.t(field.label_key);
}

function localizedSettingsFieldHelp(
  i18n: DesktopI18n,
  field: DesktopSettingsSurfaceSnapshot['host_fields'][number],
): string {
  return field.help_key ? i18n.t(field.help_key) : '';
}

function localizedSettingsFieldPlaceholder(
  i18n: DesktopI18n,
  field: DesktopSettingsSurfaceSnapshot['host_fields'][number],
): string | undefined {
  return field.placeholder_key ? i18n.t(field.placeholder_key) : undefined;
}

function describeLocalizedNextStartAddress(
  i18n: DesktopI18n,
  model: Pick<ReturnType<typeof deriveDesktopAccessDraftModel>, 'next_start_address_display' | 'next_start_address_kind'>,
) {
  switch (model.next_start_address_kind) {
    case 'auto_loopback':
      return {
        primary: i18n.t('settings.autoPort'),
        primary_monospace: false,
        hint: i18n.t('settings.onLocalhost'),
      };
    case 'lan_ip_port':
      return {
        primary: i18n.t('settings.portNumber', { port: model.next_start_address_display }),
        primary_monospace: false,
        hint: i18n.t('settings.onLanIp'),
      };
    case 'raw':
    default:
      return describeNextStartAddress(model.next_start_address_display);
  }
}

function describeLocalizedRuntimeAddress(i18n: DesktopI18n, value: string) {
  const display = describeRuntimeAddress(value);
  return display.primary === 'Not running'
    ? { ...display, primary: i18n.t('settings.notRunning') }
    : display;
}

async function copyToClipboard(text: string): Promise<void> {
  const value = trimString(text);
  if (!value) {
    return;
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function desktopLauncherBridge(): DesktopLauncherBridge | null {
  const candidate = window.redevenDesktopLauncher;
  if (
    !candidate
    || typeof candidate.getSnapshot !== 'function'
    || typeof candidate.performAction !== 'function'
    || typeof candidate.subscribeSnapshot !== 'function'
  ) {
    return null;
  }
  return candidate;
}

function desktopSettingsBridge(): DesktopSettingsBridge | null {
  const candidate = window.redevenDesktopSettings;
  if (
    !candidate
    || typeof candidate.save !== 'function'
    || typeof candidate.cancel !== 'function'
    || typeof candidate.loadFlowerHostSettings !== 'function'
    || typeof candidate.saveFlowerHostSettings !== 'function'
    || typeof candidate.listFlowerHostThreads !== 'function'
    || typeof candidate.loadFlowerHostThread !== 'function'
    || typeof candidate.resolveFlowerHostHandler !== 'function'
    || typeof candidate.sendFlowerHostChat !== 'function'
  ) {
    return null;
  }
  return candidate;
}

function DesktopLanguagePicker(props: Readonly<{
  openRequest: number;
  snapshot: RedevenLanguageSnapshot;
  i18n: DesktopI18n;
  onPreferenceChange: (preference: RedevenLocalePreference) => void;
}>) {
  const [open, setOpen] = createSignal(false);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  let buttonRef: HTMLButtonElement | undefined;
  let listboxRef: HTMLDivElement | undefined;

  const options = createMemo(() => (
    REDEVEN_LOCALE_PREFERENCES.map((preference) => ({
      preference,
      label: preference === SYSTEM_LOCALE_PREFERENCE
        ? props.i18n.t('language.systemDefault')
        : localePreferenceDisplayName(preference),
      secondary: preference === SYSTEM_LOCALE_PREFERENCE
        ? props.i18n.t('language.usingLanguage', { language: localePreferenceDisplayName(props.snapshot.resolved_locale) })
        : REDEVEN_LOCALE_META[preference].english_name,
    }))
  ));
  const selectedIndex = createMemo(() => Math.max(0, options().findIndex((item) => item.preference === props.snapshot.preference)));

  createEffect(on(
    () => props.openRequest,
    (next, previous) => {
      if (next === previous) {
        return;
      }
      setOpen(true);
      buttonRef?.focus();
    },
  ));

  createEffect(() => {
    if (open()) {
      setHighlightedIndex(selectedIndex());
    }
  });

  createEffect(() => {
    if (!open()) {
      return;
    }
    const containsTarget = (target: EventTarget | null): boolean => (
      target instanceof Node && (buttonRef?.contains(target) === true || listboxRef?.contains(target) === true)
    );
    const handlePointerDown = (event: MouseEvent) => {
      if (!containsTarget(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        buttonRef?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  const moveHighlight = (delta: number) => {
    const count = options().length;
    if (count <= 0) {
      return;
    }
    setHighlightedIndex((current) => (current + delta + count) % count);
  };
  const selectPreference = (preference: RedevenLocalePreference) => {
    props.onPreferenceChange(preference);
    setOpen(false);
    buttonRef?.focus();
  };

  return (
    <>
      <TopBarIconButton
        ref={(element) => {
          buttonRef = element;
        }}
        label={props.i18n.t('common.language')}
        tooltip={props.i18n.t('common.language')}
        aria-haspopup="listbox"
        aria-expanded={open() ? 'true' : 'false'}
        aria-controls="redeven-desktop-language-options"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
          } else if (event.key === 'Enter' && open()) {
            event.preventDefault();
            const option = options()[highlightedIndex()];
            if (option) {
              selectPreference(option.preference);
            }
          }
        }}
      >
        <Globe class="h-4 w-4" />
      </TopBarIconButton>

      <Show when={open()}>
        <DesktopAnchoredListbox
          id="redeven-desktop-language-options"
          anchorRef={buttonRef}
          class="min-w-72 p-1"
          width={288}
          maxHeight={360}
          role="listbox"
          open={open()}
          onOverlayRef={(element) => {
            listboxRef = element;
          }}
        >
          <div class="min-h-0 flex-1 overflow-auto">
            <For each={options()}>
              {(option, index) => {
                const selected = createMemo(() => props.snapshot.preference === option.preference);
                const highlighted = createMemo(() => highlightedIndex() === index());
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected() ? 'true' : 'false'}
                    class={cn(
                      'flex w-full cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-2 text-left transition-colors',
                      highlighted()
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground hover:bg-accent/70 hover:text-accent-foreground',
                    )}
                    title={`${option.label} - ${option.secondary}`}
                    onClick={() => selectPreference(option.preference)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectPreference(option.preference);
                      }
                    }}
                    onMouseEnter={() => setHighlightedIndex(index())}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectPreference(option.preference);
                    }}
                  >
                    <span class="min-w-0">
                      <span class="block whitespace-normal text-xs font-medium leading-snug">{option.label}</span>
                      <span class="block whitespace-normal text-[11px] leading-snug text-muted-foreground">{option.secondary}</span>
                    </span>
                    <Show when={selected()}>
                      <Check class="h-3.5 w-3.5 shrink-0" />
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>
        </DesktopAnchoredListbox>
      </Show>
    </>
  );
}

function DesktopCommandRegistrar(props: Readonly<{
  snapshot: () => DesktopWelcomeSnapshot;
  i18n: DesktopI18n;
  showConnectEnvironment: (message?: string) => void;
  openCreateConnectionDialog: (message?: string, preferredKind?: ConnectionDialogKind) => void;
  openSettingsSurface: (environmentID?: string) => void;
  openLocalEnvironment: () => Promise<void>;
  openEnvironment: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog',
  ) => Promise<boolean>;
  closeLauncherOrQuit: () => Promise<void>;
  openLanguageSettings: () => void;
}>): null {
  const cmd = useCommand();
  const theme = useTheme();
  const shellTheme = desktopThemeBridge();

  createEffect(() => {
    const snapshot = props.snapshot();
    const list = [
      {
        id: 'redeven.desktop.connectEnvironment',
        title: props.i18n.t('commandPalette.connectEnvironmentTitle'),
        description: props.i18n.t('commandPalette.connectEnvironmentDescription'),
        category: props.i18n.t('commandPalette.categories.desktop'),
        keybind: 'mod+shift+o',
        icon: Globe,
        execute: () => props.showConnectEnvironment(),
      },
      {
        id: 'redeven.desktop.openLocalEnvironment',
        title: props.i18n.t('commandPalette.openEnvironmentTitle'),
        description: props.i18n.t('commandPalette.openEnvironmentDescription'),
        category: props.i18n.t('commandPalette.categories.desktop'),
        keybind: 'mod+enter',
        icon: Globe,
        execute: () => {
          void props.openLocalEnvironment();
        },
      },
      {
        id: 'redeven.desktop.openLocalEnvironmentSettings',
        title: props.i18n.t('commandPalette.environmentSettingsTitle'),
        description: props.i18n.t('commandPalette.environmentSettingsDescription'),
        category: props.i18n.t('commandPalette.categories.desktop'),
        keybind: 'mod+,',
        icon: Settings,
        execute: () => props.openSettingsSurface(),
      },
      {
        id: 'redeven.desktop.focusEnvironmentURL',
        title: props.i18n.t('commandPalette.connectAnotherEnvironmentTitle'),
        description: props.i18n.t('commandPalette.connectAnotherEnvironmentDescription'),
        category: props.i18n.t('commandPalette.categories.desktop'),
        icon: Search,
        execute: () => props.openCreateConnectionDialog(props.i18n.t('commandPalette.connectAnotherEnvironmentPrompt')),
      },
      {
        id: 'redeven.desktop.closeLauncherOrQuit',
        title: localizedCloseActionLabel(props.i18n, snapshot.close_action),
        description: snapshot.close_action === 'quit'
          ? props.i18n.t('commandPalette.quitDesktopDescription')
          : props.i18n.t('commandPalette.closeLauncherDescription'),
        category: props.i18n.t('commandPalette.categories.desktop'),
        icon: Globe,
        execute: () => {
          void props.closeLauncherOrQuit();
        },
      },
      {
        id: 'redeven.desktop.changeLanguage',
        title: props.i18n.t('commandPalette.changeLanguageTitle'),
        description: props.i18n.t('commandPalette.changeLanguageDescription'),
        category: props.i18n.t('commandPalette.categories.general'),
        icon: Globe,
        execute: () => props.openLanguageSettings(),
      },
      {
        id: 'redeven.desktop.toggleTheme',
        title: props.i18n.t('commandPalette.toggleThemeTitle'),
        description: props.i18n.t('commandPalette.toggleThemeDescription'),
        category: props.i18n.t('commandPalette.categories.general'),
        icon: theme.resolvedTheme() === 'light' ? Moon : Sun,
        execute: () => toggleDesktopTheme(theme.resolvedTheme(), shellTheme, () => theme.toggleTheme()),
      },
      {
        id: 'redeven.desktop.openCommandPalette',
        title: props.i18n.t('commandPalette.openCommandPaletteTitle'),
        description: props.i18n.t('commandPalette.openCommandPaletteDescription'),
        category: props.i18n.t('commandPalette.categories.general'),
        keybind: 'mod+k',
        icon: Search,
        execute: () => cmd.open(),
      },
    ];

    for (const environment of snapshot.environments.slice(0, 5)) {
      list.push({
        id: `redeven.desktop.openEnvironment.${environment.id}`,
        title: `${localizedOpenActionLabel(props.i18n, environment.open_action)} ${environment.label}`,
        description: environment.secondary_text,
        category: props.i18n.t('commandPalette.categories.recentEnvironments'),
        icon: Globe,
        execute: () => {
          void props.openEnvironment(environment, 'connect');
        },
      });
    }

    if (snapshot.surface === 'connect_environment') {
      list.push({
        id: 'redeven.desktop.openDeck',
        title: props.i18n.t('commandPalette.openDeckTitle'),
        description: capabilityUnavailableMessage('Deck'),
        category: props.i18n.t('commandPalette.categories.unavailable'),
        icon: Search,
        execute: () => props.showConnectEnvironment(capabilityUnavailableMessage('Deck')),
      });
    }

    const unregister = cmd.registerAll(list as never);
    onCleanup(() => unregister());
  });

  return null;
}

function DesktopWelcomeShellInner(props: DesktopWelcomeShellProps) {
  const theme = useTheme();
  const shellTheme = desktopThemeBridge();
  const shellLanguage = desktopLanguageBridge();
  const [snapshot, setSnapshot] = createSignal(props.snapshot);
  const [languageSnapshot, setLanguageSnapshot] = createSignal<RedevenLanguageSnapshot>(
    shellLanguage?.getSnapshot() ?? FALLBACK_DESKTOP_LANGUAGE_SNAPSHOT,
  );
  const [languagePickerOpenRequest] = createSignal(0);
  const [languageSettingsOpen, setLanguageSettingsOpen] = createSignal(false);
  const [actionToasts, setActionToasts] = createSignal<readonly DesktopActionToast[]>([]);
  const [settingsError, setSettingsError] = createSignal('');
  const [connectionDialogError, setConnectionDialogError] = createSignal('');
  const [connectionDialogFieldErrors, setConnectionDialogFieldErrors] = createSignal<Partial<Record<string, string>>>({});
  const [controlPlaneDialogError, setControlPlaneDialogError] = createSignal('');
  const [busyState, setBusyState] = createSignal<DesktopLauncherBusyState>(IDLE_LAUNCHER_BUSY_STATE);
  const [settingsDraftSession, setSettingsDraftSession] = createSignal(createDesktopSettingsDraftSession(props.snapshot.settings_surface));
  const [connectionDialogState, setConnectionDialogState] = createSignal<ConnectionDialogState>(null);
  const [gatewaySetupDialogState, setGatewaySetupDialogState] = createSignal<GatewaySetupDialogState | null>(null);
  const [gatewaySetupDialogError, setGatewaySetupDialogError] = createSignal('');
  const [gatewaySetupDialogFieldErrors, setGatewaySetupDialogFieldErrors] = createSignal<Partial<Record<string, string>>>({});
  const [gatewayStartRequiredDialog, setGatewayStartRequiredDialog] = createSignal<DesktopGatewayStartRequiredPayload | null>(null);
  const [sshConfigHosts, setSSHConfigHosts] = createSignal<readonly DesktopSSHConfigHost[]>([]);
  const [sshConfigHostsLoaded, setSSHConfigHostsLoaded] = createSignal(false);
  const [runtimeContainerOptions, setRuntimeContainerOptions] = createSignal<readonly DesktopRuntimeContainerOption[]>([]);
  const [runtimeContainerOptionsLoading, setRuntimeContainerOptionsLoading] = createSignal(false);
  const [runtimeContainerOptionsError, setRuntimeContainerOptionsError] = createSignal('');
  const [runtimeContainerOptionsKey, setRuntimeContainerOptionsKey] = createSignal('');
  const [controlPlaneDialogState, setControlPlaneDialogState] = createSignal<ControlPlaneDialogState>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<DesktopEnvironmentEntry | null>(null);
  const [providerRuntimeLinkConfirmation, setProviderRuntimeLinkConfirmation] = createSignal<ProviderRuntimeLinkConfirmationState | null>(null);
  const [providerRuntimeLinkProviderEnvironmentID, setProviderRuntimeLinkProviderEnvironmentID] = createSignal('');
  const [deleteControlPlaneTarget, setDeleteControlPlaneTarget] = createSignal<DesktopControlPlaneSummary | null>(null);
  const [environmentFlowerComposer, setEnvironmentFlowerComposer] = createSignal<EnvironmentFlowerComposerState | null>(null);
  const [focusedFlowerThreadID, setFocusedFlowerThreadID] = createSignal('');
  const deleteTargetOperation = createMemo(() => {
    const target = deleteTarget();
    if (!target) {
      return null;
    }
    return snapshot().operations.find((operation) => (
      operation.environment_id === target.id
      || operation.subject_id === target.id
    )) ?? null;
  });
  const [librarySourceFilter, setLibrarySourceFilter] = createSignal('');
  const [libraryQuery, setLibraryQuery] = createSignal('');
  const [gatewaySourceFilter, setGatewaySourceFilter] = createSignal('');
  const [gatewayQuery, setGatewayQuery] = createSignal('');
  const [activeCenterTab, setActiveCenterTab] = createSignal<EnvironmentCenterTab>('environments');
  const [environmentFailures, setEnvironmentFailures] = createSignal<ReadonlyMap<string, EnvironmentFailureState>>(new Map());
  const actionToastTimers = new Map<number, number>();
  let nextActionToastID = 0;
  let settingsErrorRef: HTMLElement | undefined;
  let sshConfigHostsLoading = false;
  let runtimeContainerOptionsRequestID = 0;

  const visibleSurface = createMemo<DesktopLauncherSurface>(() => snapshot().surface);
  const i18n = createMemo(() => createDesktopI18n(languageSnapshot().resolved_locale));
  const headerLogoSrc = createMemo(() => theme.resolvedTheme() === 'light' ? LOGO_LIGHT_URL : LOGO_DARK_URL);
  const settingsSurface = createMemo<DesktopSettingsSurfaceSnapshot>(() => snapshot().settings_surface);
  const settingsBaselineSurface = createMemo<DesktopSettingsSurfaceSnapshot>(() => settingsDraftSession().baseline_surface);
  const draft = createMemo(() => settingsDraftSession().draft);
  const selectedSettingsEnvironmentEntry = createMemo(() => (
    snapshot().environments.find((environment) => environment.id === snapshot().settings_surface.environment_id)
      ?? snapshot().environments.find((environment) => environment.kind === 'local_environment')
      ?? snapshot().environments.find((environment) => environment.kind === 'provider_environment')
      ?? null
  ));
  const controlPlanes = createMemo(() => snapshot().control_planes);
  const libraryLocalEntryCount = createMemo(() => (
    environmentLibraryCount(snapshot(), '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const availableLibrarySourceFilters = createMemo(() => {
    const next = new Set<string>();
    if (libraryLocalEntryCount() > 0) {
      next.add(LOCAL_ENVIRONMENT_LIBRARY_FILTER);
    }
    if (environmentLibraryCount(snapshot(), '', PROVIDER_ENVIRONMENT_LIBRARY_FILTER) > 0) {
      next.add(PROVIDER_ENVIRONMENT_LIBRARY_FILTER);
    }
    if (environmentLibraryCount(snapshot(), '', GATEWAY_ENVIRONMENT_LIBRARY_FILTER) > 0) {
      next.add(GATEWAY_ENVIRONMENT_LIBRARY_FILTER);
    }
    if (environmentLibraryCount(snapshot(), '', URL_ENVIRONMENT_LIBRARY_FILTER) > 0) {
      next.add(URL_ENVIRONMENT_LIBRARY_FILTER);
    }
    if (environmentLibraryCount(snapshot(), '', SSH_ENVIRONMENT_LIBRARY_FILTER) > 0) {
      next.add(SSH_ENVIRONMENT_LIBRARY_FILTER);
    }
    for (const environment of snapshot().environments) {
      const runtimeTargetID = environment.provider_runtime_link_target?.id;
      if (runtimeTargetID) {
        next.add(runtimeTargetEnvironmentLibraryFilterValue(runtimeTargetID));
      }
    }
    for (const controlPlane of controlPlanes()) {
      next.add(controlPlaneFilterValue(controlPlane));
    }
    return next;
  });
  const libraryEntries = createMemo(() => (
    filterEnvironmentLibrary(
      snapshot(),
      libraryQuery(),
      librarySourceFilter(),
    )
  ));
  const gatewayEntries = createMemo(() => (
    filterGatewayEnvironmentEntries(
      snapshot(),
      gatewayQuery(),
      gatewaySourceFilter(),
    )
  ));
  const librarySummary = createMemo(() => (
    buildEnvironmentLibrarySummaryModel(snapshot(), libraryEntries())
  ));
  const providerRuntimeLinkActionLabel = createMemo(() => (
    providerRuntimeLinkConfirmation()?.action === 'disconnect'
      ? i18n().t('environmentCenter.disconnectFromProvider')
      : i18n().t('environmentCenter.connectToProvider')
  ));
  const providerRuntimeLinkDialogOpen = createMemo(() => providerRuntimeLinkConfirmation() !== null);
  const providerRuntimeLinkSnapshot = createMemo<RuntimeServiceSnapshot | undefined>(() => (
    environmentRuntimeServiceSnapshot(providerRuntimeLinkConfirmation()?.environment ?? null)
  ));
  const providerRuntimeLinkActiveWorkLabel = createMemo(() => (
    localizedRuntimeServiceWorkload(i18n(), providerRuntimeLinkSnapshot()?.active_workload)
  ));
  const providerRuntimeLinkCandidates = createMemo(() => (
    providerRuntimeLinkConfirmation()?.environment.provider_environment_candidates ?? []
  ));
  const providerRuntimeLinkBusy = createMemo(() => (
    providerRuntimeLinkConfirmation()?.action === 'disconnect'
      ? busyStateMatchesAction(busyState(), 'disconnect_provider_runtime')
      : busyStateMatchesAction(busyState(), 'connect_provider_runtime')
  ));
  const providerRuntimeLinkCandidatePlans = createMemo(() => {
    const target = providerRuntimeLinkConfirmation()?.environment.provider_runtime_link_target;
    if (!target) {
      return [] as readonly Readonly<{
        candidate: DesktopProviderEnvironmentCandidate;
        canConnect: boolean;
        message: string;
      }>[];
    }
    return providerRuntimeLinkCandidates().map((candidate) => {
      const plan = buildDesktopProviderRuntimeLinkPlan(target, candidate);
      return {
        candidate,
        canConnect: plan.can_connect,
        message: localizedProviderRuntimeLinkPlanMessage(i18n(), target, candidate, plan.state),
      };
    });
  });
  const providerRuntimeLinkSelectedPlan = createMemo(() => (
    providerRuntimeLinkCandidatePlans().find((item) => (
      item.candidate.provider_environment_id === providerRuntimeLinkProviderEnvironmentID()
    )) ?? null
  ));
  const providerRuntimeLinkConfirmDisabled = createMemo(() => (
    providerRuntimeLinkBusy()
    || (
      providerRuntimeLinkConfirmation()?.action === 'connect'
      && providerRuntimeLinkSelectedPlan()?.canConnect !== true
    )
  ));
  const activeActionProgress = createMemo(() => snapshot().action_progress);

  createEffect(() => {
    document.title = i18n().t('desktop.title');
  });

  createEffect(() => {
    const activeSourceFilter = gatewaySourceFilter();
    if (activeSourceFilter === '') {
      return;
    }
    const available = new Set(gatewaySourceFilterOptions(snapshot()).map((option) => option.value));
    if (!available.has(activeSourceFilter)) {
      setGatewaySourceFilter('');
    }
  });

  createEffect(() => {
    const activeSourceFilter = librarySourceFilter();
    if (activeSourceFilter === '') {
      return;
    }
    if (!availableLibrarySourceFilters().has(activeSourceFilter)) {
      setLibrarySourceFilter('');
    }
  });

  const runEnvironmentCardFactAction = (action: EnvironmentCardFactActionModel) => {
    switch (action.kind) {
      case 'filter_runtime_target':
        setActiveCenterTab('environments');
        setLibraryQuery('');
        setLibrarySourceFilter(runtimeTargetEnvironmentLibraryFilterValue(action.runtime_target_id));
        break;
    }
  };

  onCleanup(() => {
    for (const handle of actionToastTimers.values()) {
      window.clearTimeout(handle);
    }
    actionToastTimers.clear();
  });

  if (shellTheme) {
    const applyShellTheme = (next: Readonly<{ source: 'system' | 'light' | 'dark' }>) => {
      if (theme.theme() !== next.source) {
        theme.setTheme(next.source);
      }
    };
    applyShellTheme(shellTheme.getSnapshot());
    const unsubscribe = shellTheme.subscribe(applyShellTheme);
    onCleanup(unsubscribe);
  }

  if (shellLanguage) {
    const applyShellLanguage = (next: RedevenLanguageSnapshot) => {
      setLanguageSnapshot(next);
    };
    applyShellLanguage(shellLanguage.getSnapshot());
    const unsubscribe = shellLanguage.subscribe(applyShellLanguage);
    onCleanup(unsubscribe);
  }

  const unsubscribeSnapshot = props.runtime.launcher.subscribeSnapshot((nextSnapshot) => {
    setSnapshot((current) => {
      const next = nextDesktopWelcomeSnapshot(current, nextSnapshot);
      if (next !== current) {
        setBusyState((busy) => reconcileBusyStateWithActionProgressSnapshot(busy, next.action_progress));
      }
      setEnvironmentFailures((failures) => {
        if (failures.size === 0) {
          return failures;
        }
        const nextFailures = new Map(failures);
        for (const env of next.environments) {
          if (
            nextFailures.has(env.id)
            && env.runtime_health.status === 'online'
            && runtimeServiceIsOpenable(environmentRuntimeServiceSnapshot(env))
          ) {
            nextFailures.delete(env.id);
          }
        }
        return nextFailures.size !== failures.size ? nextFailures : failures;
      });
      return next;
    });
  });
  onCleanup(unsubscribeSnapshot);
  const unsubscribeActionProgress = props.runtime.launcher.subscribeActionProgress?.((progress) => {
    setBusyState((current) => busyStateWithActionProgress(current, progress));
  });
  if (unsubscribeActionProgress) {
    onCleanup(unsubscribeActionProgress);
  }

  createEffect(() => {
    setSettingsDraftSession((current) => reconcileDesktopSettingsDraftSession(
      current,
      snapshot().settings_surface,
      snapshot().surface === 'environment_settings',
    ));
  });

  {
    let previousIssueKey = '';
    createEffect(() => {
      if (visibleSurface() !== 'connect_environment' || !snapshot().issue) {
        previousIssueKey = '';
        return;
      }
      const issue = snapshot().issue!;
      const issueKey = `${issue.scope}:${issue.code}:${issue.message}`;
      if (issueKey === previousIssueKey) {
        return;
      }
      previousIssueKey = issueKey;
      showActionToast(formatIssueToastMessage(i18n(), issue), issueToastTone(issue));
    });
  }

  {
    let prevSettingsError = '';
    createEffect(() => {
      const error = settingsError();
      if (!error) {
        prevSettingsError = '';
        return;
      }
      if (error === prevSettingsError) {
        return;
      }
      prevSettingsError = error;
      queueMicrotask(() => settingsErrorRef?.focus());
    });
  }

  async function refreshSnapshot(): Promise<DesktopWelcomeSnapshot> {
    const nextSnapshot = await props.runtime.launcher.getSnapshot();
    let acceptedSnapshot = nextSnapshot;
    setSnapshot((current) => {
      acceptedSnapshot = nextDesktopWelcomeSnapshot(current, nextSnapshot);
      if (acceptedSnapshot !== current) {
        setBusyState((busy) => reconcileBusyStateWithActionProgressSnapshot(busy, acceptedSnapshot.action_progress));
      }
      return acceptedSnapshot;
    });
    return acceptedSnapshot;
  }

  async function refreshSSHConfigHosts(): Promise<void> {
    if (sshConfigHostsLoading || !props.runtime.launcher.getSSHConfigHosts) {
      return;
    }
    sshConfigHostsLoading = true;
    try {
      setSSHConfigHosts(await props.runtime.launcher.getSSHConfigHosts());
      setSSHConfigHostsLoaded(true);
    } catch {
      setSSHConfigHosts([]);
      setSSHConfigHostsLoaded(true);
    } finally {
      sshConfigHostsLoading = false;
    }
  }

  createEffect(() => {
    const kind = connectionDialogState()?.connection_kind;
    if ((kind === 'ssh_environment' || kind === 'ssh_container_runtime') && !sshConfigHostsLoaded()) {
      void refreshSSHConfigHosts();
    }
  });

  createEffect(() => {
    const kind = gatewaySetupDialogState()?.connection_kind;
    if ((kind === 'ssh_host' || kind === 'ssh_container') && !sshConfigHostsLoaded()) {
      void refreshSSHConfigHosts();
    }
  });

  async function refreshRuntimeContainerOptions(force = false): Promise<void> {
    const connectionState = connectionDialogState();
    const gatewayState = gatewaySetupDialogState();
    const state = connectionState?.connection_kind === 'local_container_runtime' || connectionState?.connection_kind === 'ssh_container_runtime'
      ? connectionState
      : gatewayState?.connection_kind === 'ssh_container'
        ? createRuntimeContainerConnectionDialogState(gatewayState.mode, 'ssh_container_runtime', {
            ssh_destination: gatewayState.ssh_destination,
            ssh_port: gatewayState.ssh_port,
            auth_mode: gatewayState.auth_mode,
            connect_timeout_seconds: gatewayState.connect_timeout_seconds,
            container_engine: gatewayState.container_engine,
            container_id: gatewayState.container_id,
            container_ref: gatewayState.container_ref,
            container_label: gatewayState.container_label,
            runtime_root: gatewayState.runtime_root,
          })
        : null;
    if (!state) {
      setRuntimeContainerOptions([]);
      setRuntimeContainerOptionsError('');
      setRuntimeContainerOptionsKey('');
      setRuntimeContainerOptionsLoading(false);
      runtimeContainerOptionsRequestID += 1;
      return;
    }
    const key = runtimeContainerOptionsRequestKey(state);
    if (key === '') {
      setRuntimeContainerOptions([]);
      setRuntimeContainerOptionsError('');
      setRuntimeContainerOptionsKey('');
      setRuntimeContainerOptionsLoading(false);
      runtimeContainerOptionsRequestID += 1;
      return;
    }
    if (!force && runtimeContainerOptionsKey() === key) {
      return;
    }
    const hostAccess = runtimeContainerHostAccessFromDialogState(state);
    if (!hostAccess) {
      return;
    }
    if (!props.runtime.launcher.listRuntimeContainers) {
      setRuntimeContainerOptions([]);
      setRuntimeContainerOptionsError(i18n().t('connectionDialog.containerListUnsupported'));
      setRuntimeContainerOptionsKey(key);
      return;
    }
    const requestID = runtimeContainerOptionsRequestID + 1;
    runtimeContainerOptionsRequestID = requestID;
    setRuntimeContainerOptionsLoading(true);
    setRuntimeContainerOptionsError('');
    try {
      const result = await props.runtime.launcher.listRuntimeContainers({
        host_access: hostAccess,
        engine: state.container_engine,
      });
      if (requestID !== runtimeContainerOptionsRequestID) {
        return;
      }
      setRuntimeContainerOptionsKey(key);
      if (result.ok) {
        setRuntimeContainerOptions(result.containers);
        setRuntimeContainerOptionsError('');
        const currentDialogState = connectionDialogState();
        const currentGatewayState = gatewaySetupDialogState();
        const selectedID = trimString(
          currentDialogState?.connection_kind === 'local_container_runtime' || currentDialogState?.connection_kind === 'ssh_container_runtime'
            ? currentDialogState.container_id
            : currentGatewayState?.connection_kind === 'ssh_container'
              ? currentGatewayState.container_id
              : '',
        );
        const selectedRef = trimString(
          currentDialogState?.connection_kind === 'local_container_runtime' || currentDialogState?.connection_kind === 'ssh_container_runtime'
            ? currentDialogState.container_ref || currentDialogState.container_label
            : currentGatewayState?.connection_kind === 'ssh_container'
              ? currentGatewayState.container_ref || currentGatewayState.container_label
              : '',
        );
        if (selectedID !== '' && !result.containers.some((container) => container.container_id === selectedID)) {
          const referenceMatches = selectedRef === ''
            ? []
            : result.containers.filter((container) => (
              container.container_ref === selectedRef
              || container.container_label === selectedRef
              || container.container_id === selectedRef
            ));
          if (referenceMatches.length === 1) {
            const [match] = referenceMatches;
            setConnectionDialogState((current) => {
              if (current?.connection_kind !== 'local_container_runtime' && current?.connection_kind !== 'ssh_container_runtime') {
                return current;
              }
              if (current.container_engine !== state.container_engine) {
                return current;
              }
              return {
                ...current,
                container_id: match.container_id,
                container_ref: match.container_ref,
                container_label: match.container_label,
              };
            });
            setGatewaySetupDialogState((current) => {
              if (current?.connection_kind !== 'ssh_container' || current.container_engine !== state.container_engine) {
                return current;
              }
              return {
                ...current,
                container_id: match.container_id,
                container_ref: match.container_ref,
                container_label: match.container_label,
              };
            });
          } else {
            setRuntimeContainerOptionsError(i18n().t('connectionDialog.selectedContainerGone'));
          }
        }
      } else {
        setRuntimeContainerOptions([]);
        setRuntimeContainerOptionsError(result.failure?.summary ?? result.message);
      }
    } catch (error) {
      if (requestID !== runtimeContainerOptionsRequestID) {
        return;
      }
      setRuntimeContainerOptions([]);
      setRuntimeContainerOptionsError(getErrorMessage(error) || i18n().t('connectionDialog.containerListFailed'));
      setRuntimeContainerOptionsKey(key);
    } finally {
      if (requestID === runtimeContainerOptionsRequestID) {
        setRuntimeContainerOptionsLoading(false);
      }
    }
  }

  createEffect(on(
    () => {
      const connectionState = connectionDialogState();
      if (connectionState?.connection_kind === 'local_container_runtime' || connectionState?.connection_kind === 'ssh_container_runtime') {
        return runtimeContainerOptionsRequestKey(connectionState);
      }
      const gatewayState = gatewaySetupDialogState();
      if (gatewayState?.connection_kind !== 'ssh_container') {
        return '';
      }
      return runtimeContainerOptionsRequestKey(createRuntimeContainerConnectionDialogState(gatewayState.mode, 'ssh_container_runtime', {
        ssh_destination: gatewayState.ssh_destination,
        ssh_port: gatewayState.ssh_port,
        auth_mode: gatewayState.auth_mode,
        connect_timeout_seconds: gatewayState.connect_timeout_seconds,
        container_engine: gatewayState.container_engine,
        container_id: gatewayState.container_id,
        container_ref: gatewayState.container_ref,
        container_label: gatewayState.container_label,
        runtime_root: gatewayState.runtime_root,
      }));
    },
    () => {
      void refreshRuntimeContainerOptions();
    },
  ));

  function dismissActionToast(toastID: number): void {
    const handle = actionToastTimers.get(toastID);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      actionToastTimers.delete(toastID);
    }
    setActionToasts((current) => current.filter((toast) => toast.id !== toastID));
  }

  function showActionToast(
    message: string,
    tone: DesktopActionToastTone = 'success',
    options: Readonly<{
      title?: string;
      action?: DesktopActionToastAction;
      autoDismiss?: boolean;
    }> = {},
  ): void {
    const queued = queueDesktopActionToast({
      current: actionToasts(),
      next: {
        id: ++nextActionToastID,
        tone,
        title: options.title,
        message: localizedToastMessage(i18n(), message),
        action: localizedActionToastAction(i18n(), options.action),
        auto_dismiss: options.autoDismiss === false ? false : undefined,
      },
      limit: DESKTOP_ACTION_TOAST_LIMIT,
    });
    if (!queued.active_toast) {
      return;
    }

    for (const removedToastID of queued.removed_toast_ids) {
      const handle = actionToastTimers.get(removedToastID);
      if (handle !== undefined) {
        window.clearTimeout(handle);
        actionToastTimers.delete(removedToastID);
      }
    }

    setActionToasts(queued.toasts);

    const activeToastID = queued.active_toast.id;
    const existingHandle = actionToastTimers.get(activeToastID);
    if (existingHandle !== undefined) {
      window.clearTimeout(existingHandle);
    }
    if (queued.active_toast.auto_dismiss !== false) {
      const handle = window.setTimeout(() => {
        dismissActionToast(activeToastID);
      }, ACTION_TOAST_TTL_MS);
      actionToastTimers.set(activeToastID, handle);
    }
  }

  function updateDesktopLanguagePreference(preference: RedevenLocalePreference): void {
    const nextSnapshot = shellLanguage?.setPreference(preference) ?? languageSnapshot();
    setLanguageSnapshot(nextSnapshot);
    const language = preference === SYSTEM_LOCALE_PREFERENCE
      ? i18n().t('language.systemDefault')
      : localePreferenceDisplayName(preference);
    showActionToast(i18n().t('language.updatedMessage', { language }), 'info');
  }

  async function runActionToastAction(
    action: DesktopActionToastAction,
    toastID: number,
  ): Promise<void> {
    switch (action.kind) {
      case 'reconnect_control_plane': {
        dismissActionToast(toastID);
        const displayLabel = snapshot().control_planes.find((controlPlane) => (
          controlPlane.provider.provider_origin === action.provider_origin
          && (
            !action.provider_id
            || controlPlane.provider.provider_id === action.provider_id
          )
        ))?.display_label;
        const result = await performLauncherAction({
          kind: 'start_control_plane_connect',
          provider_origin: action.provider_origin,
          display_label: displayLabel,
        });
        if (result?.outcome === 'started_control_plane_connect') {
          showActionToast(i18n().t('environmentCenter.continueBrowserReconnectProvider'), 'info');
        }
        break;
      }
      default:
        break;
    }
  }

  async function handleLauncherActionFailure(
    failure: Extract<DesktopLauncherActionResult, Readonly<{ ok: false }>>,
    errorTarget: LauncherActionErrorTarget,
    requestEnvID?: string,
  ): Promise<void> {
    if (failure.code === 'gateway_start_required' && failure.gateway_start_required_payload) {
      setGatewayStartRequiredDialog(failure.gateway_start_required_payload);
      if (failure.should_refresh_snapshot === true) {
        try {
          await refreshSnapshot();
        } catch (error) {
          setErrorMessage(errorTarget, getErrorMessage(error));
        }
      }
      return;
    }
    const presentation = launcherActionFailurePresentation(i18n(), failure);
    if (presentation.refresh_snapshot) {
      try {
        await refreshSnapshot();
      } catch (error) {
        setErrorMessage(errorTarget, getErrorMessage(error));
        return;
      }
    }
    if (presentation.message !== '') {
      if (presentation.delivery === 'inline') {
        setErrorMessage(errorTarget, presentation.message);
        return;
      }
      showActionToast(presentation.message, presentation.tone, {
        title: presentation.title,
        action: presentation.action,
        autoDismiss: presentation.auto_dismiss,
      });
      const environmentID = requestEnvID || failure.environment_id?.trim();
      if (environmentID && (presentation.tone === 'error' || presentation.tone === 'warning')) {
        const tone: 'error' | 'warning' = presentation.tone;
        setEnvironmentFailures((current) => {
          const next = new Map(current);
          next.set(environmentID, {
            failure: failure.failure ?? inlineFailurePresentation(i18n(), presentation.message, tone),
          });
          return next;
        });
      }
    }
  }

  async function performLauncherActionSilently(
    request: DesktopLauncherActionRequest,
  ): Promise<
    | Extract<DesktopLauncherActionResult, Readonly<{ ok: true }>>
    | SilentLauncherActionFailure
  > {
    setBusyState(busyStateForLauncherRequest(request));
    try {
      const result = await props.runtime.launcher.performAction(request);
      if (isDesktopLauncherActionFailure(result)) {
        const presentation = launcherActionFailurePresentation(i18n(), result);
        if (presentation.refresh_snapshot) {
          try {
            await refreshSnapshot();
          } catch (error) {
            return {
              ok: false,
              message: getErrorMessage(error),
            };
          }
        }
        return {
          ok: false,
          message: presentation.message || i18n().t('toast.actionFailedFallback'),
          ...(result.failure ? { failure: result.failure } : {}),
        };
      }
      if (isDesktopLauncherActionSuccess(result)) {
        return result;
      }
      return {
        ok: false,
        message: i18n().t('toast.unexpectedLauncherResult'),
      };
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error),
      };
    } finally {
      setBusyState(IDLE_LAUNCHER_BUSY_STATE);
    }
  }

  function resetMessages(): void {
    setSettingsError('');
    setConnectionDialogError('');
    setGatewaySetupDialogError('');
    setControlPlaneDialogError('');
  }

  function showConnectEnvironment(message = ''): void {
    setConnectionDialogState(null);
    setGatewaySetupDialogState(null);
    setControlPlaneDialogState(null);
    if (trimString(message) !== '') {
      showActionToast(message, 'info');
    }
    setSettingsError('');
    setConnectionDialogError('');
    setGatewaySetupDialogError('');
    setControlPlaneDialogError('');
    if (snapshot().surface === 'connect_environment') {
      return;
    }
    if (typeof window.redevenDesktopShell?.openConnectionCenter === 'function') {
      void window.redevenDesktopShell.openConnectionCenter();
      return;
    }
    if (typeof window.redevenDesktopShell?.openWindow === 'function') {
      void window.redevenDesktopShell.openWindow('connection_center');
    }
  }

  function openRedevenDashboard(): void {
    void window.redevenDesktopShell?.openDashboard?.();
  }

  function openSettingsSurface(environmentID = selectedSettingsEnvironmentEntry()?.id ?? ''): void {
    if (environmentID === '') {
      setSettingsError(i18n().t('settings.chooseEnvironmentFirst'));
      return;
    }
    resetMessages();
    setConnectionDialogState(null);
    setGatewaySetupDialogState(null);
    setControlPlaneDialogState(null);
    setBusyState({
      action: 'open_environment_settings',
      environment_id: environmentID,
      provider_origin: '',
      provider_id: '',
      gateway_id: '',
      request_started_at_unix_ms: Date.now(),
      progress: null,
    });
    void props.runtime.launcher.performAction({ kind: 'open_environment_settings', environment_id: environmentID })
      .catch((error) => {
        setSettingsError(getErrorMessage(error));
      })
      .finally(() => {
        setBusyState(IDLE_LAUNCHER_BUSY_STATE);
      });
  }

  function openLanguageSettings(): void {
    resetMessages();
    setConnectionDialogState(null);
    setGatewaySetupDialogState(null);
    setControlPlaneDialogState(null);
    setLanguageSettingsOpen(true);
  }

  function openCreateConnectionDialog(
    message = '',
    preferredKind: ConnectionDialogKind = 'external_local_ui',
  ): void {
    if (snapshot().surface !== 'connect_environment') {
      showConnectEnvironment(message || i18n().t('environmentCenter.addConnectionLauncherPrompt'));
      return;
    }
    setActiveCenterTab('environments');
    setLibrarySourceFilter('');
    if (trimString(message) !== '') {
      showActionToast(message, 'info');
    }
    setSettingsError('');
    setConnectionDialogError('');
    setConnectionDialogFieldErrors({});
    setGatewaySetupDialogState(null);
    setControlPlaneDialogError('');
    setControlPlaneDialogState(null);
    if (preferredKind === 'ssh_environment') {
      setConnectionDialogState(createSSHConnectionDialogState('create', {
        bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
      }));
      return;
    }
    if (preferredKind === 'local_container_runtime' || preferredKind === 'ssh_container_runtime') {
      setConnectionDialogState(createRuntimeContainerConnectionDialogState('create', preferredKind));
      return;
    }
    setConnectionDialogState(createExternalURLConnectionDialogState('create', {
      external_local_ui_url: trimString(snapshot().suggested_remote_url),
    }));
  }

  function openCreateGatewaySetup(gateway?: DesktopGatewaySource): void {
    if (snapshot().surface !== 'connect_environment') {
      showConnectEnvironment(i18n().t('environmentCenter.addGatewayLauncherPrompt'));
      return;
    }
    resetMessages();
    setActiveCenterTab('gateways');
    setConnectionDialogState(null);
    setControlPlaneDialogState(null);
    setGatewaySetupDialogFieldErrors({});
    setGatewaySetupDialogState(createGatewaySetupDialogState(gateway
      ? {
          mode: 'edit',
          gateway_id: gateway.gateway_id,
          display_name: gateway.display_name,
          connection_kind: gateway.connection_kind,
          gateway_url: gateway.gateway_url ?? '',
          allow_loopback_http: gateway.allow_loopback_http === true,
          ssh_destination: gateway.ssh_details?.ssh_destination ?? '',
          ssh_port: gateway.ssh_details?.ssh_port == null ? '' : String(gateway.ssh_details.ssh_port),
          auth_mode: gateway.ssh_details?.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE,
          ssh_password_configured: gateway.ssh_password_configured === true,
          connect_timeout_seconds: gateway.ssh_details?.connect_timeout_seconds == null
            ? ''
            : String(gateway.ssh_details.connect_timeout_seconds),
          bootstrap_strategy: gateway.ssh_details?.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
          release_base_url: gateway.ssh_details?.release_base_url ?? '',
          runtime_root: gateway.ssh_details?.runtime_root ?? '',
          container_engine: gateway.container_engine,
          container_id: gateway.container_id ?? '',
          container_ref: gateway.container_ref ?? '',
          container_label: gateway.container_label ?? '',
        }
      : {}));
    setLanguageSettingsOpen(false);
  }

  function startEditingEnvironment(environment: DesktopEnvironmentEntry): void {
    if (environment.managed_runtime_placement?.kind === 'container_process' && environment.managed_runtime_host_access) {
      const isSSHContainer = environment.managed_runtime_host_access.kind === 'ssh_host';
      setConnectionDialogState(createRuntimeContainerConnectionDialogState('edit', isSSHContainer ? 'ssh_container_runtime' : 'local_container_runtime', {
        environment_id: environment.id,
        label: environment.label,
        ssh_destination: isSSHContainer ? environment.managed_runtime_host_access.ssh.ssh_destination : '',
        ssh_port: isSSHContainer && environment.managed_runtime_host_access.ssh.ssh_port != null ? String(environment.managed_runtime_host_access.ssh.ssh_port) : '',
        auth_mode: isSSHContainer ? environment.managed_runtime_host_access.ssh.auth_mode : DEFAULT_DESKTOP_SSH_AUTH_MODE,
        ssh_password_configured: isSSHContainer && environment.ssh_password_configured === true,
        connect_timeout_seconds: isSSHContainer && environment.managed_runtime_host_access.ssh.connect_timeout_seconds != null
          ? String(environment.managed_runtime_host_access.ssh.connect_timeout_seconds)
          : '',
        container_engine: environment.managed_runtime_placement.container_engine,
        container_id: environment.managed_runtime_placement.container_id,
        container_ref: environment.managed_runtime_placement.container_ref,
        container_label: environment.managed_runtime_placement.container_label,
        runtime_root: environment.managed_runtime_placement.runtime_root,
        auto_runtime_probe_enabled: environment.auto_runtime_probe_enabled === true,
        auto_runtime_probe_configurable: environment.auto_runtime_probe_configurable !== false,
      }));
    } else if (environment.kind === 'local_environment') {
      openSettingsSurface(environment.id);
    } else if (environment.kind === 'provider_environment') {
      openSettingsSurface(environment.id);
    } else if (environment.kind === 'ssh_environment') {
      setConnectionDialogState(createSSHConnectionDialogState('edit', {
        environment_id: environment.id,
        label: environment.label,
        ssh_destination: environment.ssh_details?.ssh_destination ?? '',
        ssh_port: environment.ssh_details?.ssh_port == null ? '' : String(environment.ssh_details.ssh_port),
        auth_mode: environment.ssh_details?.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE,
        ssh_password_configured: environment.ssh_password_configured === true,
        runtime_root: environment.ssh_details?.runtime_root === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT
          ? ''
          : (environment.ssh_details?.runtime_root ?? ''),
        bootstrap_strategy: environment.ssh_details?.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
        release_base_url: environment.ssh_details?.release_base_url ?? '',
        connect_timeout_seconds: environment.ssh_details?.connect_timeout_seconds == null ? '' : String(environment.ssh_details.connect_timeout_seconds),
        auto_runtime_probe_enabled: environment.auto_runtime_probe_enabled === true,
      }));
    } else {
      setConnectionDialogState(createExternalURLConnectionDialogState('edit', {
        environment_id: environment.id,
        label: environment.label,
        external_local_ui_url: environment.local_ui_url,
        auto_runtime_probe_enabled: environment.auto_runtime_probe_enabled === true,
      }));
    }
    setConnectionDialogError('');
  }

  function closeConnectionDialog(): void {
    setConnectionDialogState(null);
    setConnectionDialogError('');
    setConnectionDialogFieldErrors({});
  }

  function closeGatewaySetupDialog(): void {
    setGatewaySetupDialogState(null);
    setGatewaySetupDialogError('');
    setGatewaySetupDialogFieldErrors({});
  }

  function openCreateControlPlaneDialog(message = ''): void {
    if (snapshot().surface !== 'connect_environment') {
      showConnectEnvironment(message || i18n().t('environmentCenter.addProviderLauncherPrompt'));
      return;
    }
    setActiveCenterTab('control_planes');
    setConnectionDialogState(null);
    setGatewaySetupDialogState(null);
    if (trimString(message) !== '') {
      showActionToast(message, 'info');
    }
    setSettingsError('');
    setConnectionDialogError('');
    setControlPlaneDialogError('');
    setControlPlaneDialogState(createControlPlaneDialogState());
  }

  function focusProviderEnvironments(controlPlane: DesktopControlPlaneSummary): void {
    setActiveCenterTab('environments');
    setLibraryQuery('');
    setLibrarySourceFilter(controlPlaneFilterValue(controlPlane));
  }

  function closeControlPlaneDialog(): void {
    setControlPlaneDialogState(null);
    setControlPlaneDialogError('');
  }

  function updateControlPlaneDialogField(name: 'display_label' | 'provider_origin', value: string): void {
    setControlPlaneDialogState((current) => {
      if (!current) {
        return current;
      }
      if (name === 'display_label') {
        return {
          ...current,
          display_label: value,
          display_label_touched: true,
        };
      }
      const nextProviderOrigin = value;
      return {
        ...current,
        provider_origin: nextProviderOrigin,
        display_label: current.display_label_touched
          ? current.display_label
          : suggestControlPlaneDisplayLabel(nextProviderOrigin),
      };
    });
  }

  function switchConnectionDialogKind(kind: ConnectionDialogKind): void {
    setConnectionDialogFieldErrors({});
    setConnectionDialogState((current) => {
      if (!current || current.mode !== 'create' || current.connection_kind === kind) {
        return current;
      }
      const oldSuggested = suggestConnectionLabel(current);
      const wasAutoFilled = oldSuggested !== null && trimString(current.label) === oldSuggested;
      const label = wasAutoFilled ? '' : current.label;
      if (kind === 'ssh_environment') {
        return createSSHConnectionDialogState('create', {
          label,
          bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
          auto_runtime_probe_enabled: current.auto_runtime_probe_enabled,
        });
      }
      if (kind === 'local_container_runtime' || kind === 'ssh_container_runtime') {
        return createRuntimeContainerConnectionDialogState('create', kind, {
          label,
          auto_runtime_probe_enabled: kind === 'local_container_runtime'
            ? true
            : current.auto_runtime_probe_enabled,
        });
      }
      return createExternalURLConnectionDialogState('create', {
        label,
        auto_runtime_probe_enabled: current.auto_runtime_probe_enabled,
        external_local_ui_url: current.connection_kind === 'external_local_ui'
          ? current.external_local_ui_url
          : trimString(snapshot().suggested_remote_url),
      });
    });
  }

  function updateConnectionDialogField(
    name: 'label' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'auth_mode' | 'ssh_password' | 'runtime_root' | 'release_base_url' | 'connect_timeout_seconds' | 'container_engine' | 'container_id' | 'container_ref' | 'container_label',
    value: string,
  ): void {
    setConnectionDialogState((current) => {
      if (!current) {
        return current;
      }
      let base: ConnectionDialogState = {
        ...current,
        [name]: value,
        ...(
          (name === 'ssh_destination' || name === 'ssh_port')
          && current.connection_kind === 'ssh_container_runtime'
            ? { container_id: '', container_ref: '', container_label: '' }
            : {}
        ),
      } as ConnectionDialogState;
      if (isSSHPasswordDraftState(base)) {
        base = reconcileSSHPasswordDraft(base, name) as ConnectionDialogState;
      }
      if (name === 'ssh_destination' || name === 'container_label') {
        const oldSuggested = suggestConnectionLabel(current);
        const newSuggested = suggestConnectionLabel(base as ConnectionDialogState);
        const wasAutoFilled = oldSuggested !== null && trimString(current.label) === oldSuggested;
        if (base && newSuggested !== null && (wasAutoFilled || !trimString(base.label))) {
          return { ...base, label: newSuggested } as ConnectionDialogState;
        }
      }
      return base as ConnectionDialogState;
    });
  }

  function updateGatewaySetupDialogField(name: keyof GatewaySetupDialogState, value: string | boolean): void {
    setGatewaySetupDialogState((current) => {
      if (!current) {
        return current;
      }
      const nextValue = typeof value === 'boolean' ? value : trimString(value);
      if (name === 'connection_kind') {
        const nextKind = nextValue as DesktopGatewayConnectionKind;
        return createGatewaySetupDialogState({
          ...current,
          display_name: current.display_name_touched ? current.display_name : '',
          connection_kind: nextKind,
          auth_mode: current.auth_mode,
          runtime_root: current.runtime_root === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT ? '' : current.runtime_root,
        });
      }
      if (name === 'container_engine') {
        return {
          ...current,
          container_engine: nextValue as DesktopContainerEngine,
          container_id: '',
          container_ref: '',
          container_label: '',
        };
      }
      let base: GatewaySetupDialogState = {
        ...current,
        ...(name === 'display_name' ? { display_name_touched: true } : {}),
        ...(
          (name === 'ssh_destination' || name === 'ssh_port')
          && current.connection_kind === 'ssh_container'
            ? { container_id: '', container_ref: '', container_label: '' }
            : {}
        ),
        [name]: nextValue,
      };
      if (isSSHPasswordDraftState(base)) {
        base = reconcileSSHPasswordDraft(base, name);
      }
      if (name === 'ssh_destination' || name === 'gateway_url' || name === 'container_label' || name === 'container_ref' || name === 'container_id') {
        const nextSuggested = suggestGatewayDisplayName(base);
        if (!base.display_name_touched && nextSuggested !== null) {
          return {
            ...base,
            display_name: nextSuggested,
          };
        }
      }
      return base;
    });
  }

  function switchSSHBootstrapStrategy(strategy: DesktopSSHBootstrapStrategy): void {
    setConnectionDialogState((current) => {
      if (
        !current
        || (
          current.connection_kind !== 'ssh_environment'
          && current.connection_kind !== 'ssh_container_runtime'
        )
      ) {
        return current;
      }
      return {
        ...current,
        bootstrap_strategy: strategy,
        ...(current.connection_kind === 'ssh_container_runtime' ? { container_id: '', container_ref: '', container_label: '' } : {}),
      };
    });
  }

  function toggleConnectionRuntimeAutoProbe(enabled: boolean): void {
    setConnectionDialogState((current) => {
      if (!current) {
        return current;
      }
      if (!connectionDialogAutoRuntimeProbeConfigurable(current)) {
        return current;
      }
      return {
        ...current,
        auto_runtime_probe_enabled: enabled,
      } as ConnectionDialogState;
    });
  }

  function removeSSHPasswordFromConnectionDialog(): void {
    setConnectionDialogState((current) => {
      if (!isSSHPasswordConnectionDialogState(current)) {
        return current;
      }
      return {
        ...current,
        ssh_password: '',
        ssh_password_mode: 'clear',
      };
    });
  }

  function removeSSHPasswordFromGatewaySetupDialog(): void {
    setGatewaySetupDialogState((current) => {
      if (!isSSHPasswordDraftState(current)) {
        return current;
      }
      return {
        ...current,
        ssh_password: '',
        ssh_password_mode: 'clear',
      };
    });
  }

  function setErrorMessage(target: LauncherActionErrorTarget, message: string): void {
    if (target === 'connect') {
      showActionToast(message, 'error');
      return;
    }
    if (target === 'settings') {
      setSettingsError(message);
      return;
    }
    if (target === 'control_plane_dialog') {
      setControlPlaneDialogError(message);
      return;
    }
    if (target === 'gateway_dialog') {
      setGatewaySetupDialogError(message);
      return;
    }
    if (target === 'dialog') {
      setConnectionDialogError(message);
      return;
    }
  }

  async function performLauncherAction(
    request: DesktopLauncherActionRequest,
    errorTarget: LauncherActionErrorTarget = 'connect',
  ): Promise<Extract<DesktopLauncherActionResult, Readonly<{ ok: true }>> | null> {
    resetMessages();
    setBusyState(busyStateForLauncherRequest(request));
    try {
      const result = await props.runtime.launcher.performAction(request);
      if (isDesktopLauncherActionFailure(result)) {
        const requestEnvID = (request as { environment_id?: string }).environment_id?.trim();
        await handleLauncherActionFailure(result, errorTarget, requestEnvID || undefined);
        return null;
      }
      if (isDesktopLauncherActionSuccess(result)) {
        return result;
      }
      setErrorMessage(errorTarget, i18n().t('toast.unexpectedLauncherResult'));
      return null;
    } catch (error) {
      setErrorMessage(errorTarget, getErrorMessage(error));
      return null;
    } finally {
      setBusyState(IDLE_LAUNCHER_BUSY_STATE);
    }
  }

  async function focusEnvironmentWindow(
    sessionKey: string,
    errorTarget: LauncherActionErrorTarget = 'connect',
  ): Promise<boolean> {
    const result = await performLauncherAction({
      kind: 'focus_environment_window',
      session_key: sessionKey,
    }, errorTarget);
    return result?.outcome === 'focused_environment_window';
  }

  async function cancelLauncherOperation(progress: DesktopLauncherActionProgress): Promise<void> {
    const operationKey = trimString(progress.operation_key);
    if (operationKey === '') {
      return;
    }
    const result = await performLauncherAction({
      kind: 'cancel_launcher_operation',
      operation_key: operationKey,
    });
    if (result?.outcome === 'canceled_launcher_operation') {
      showActionToast(progress.open_progress ? i18n().t('toast.openingStopping') : i18n().t('toast.runtimeStartupStopping'), 'info');
    }
  }

  async function dismissLauncherOperation(progress: DesktopLauncherActionProgress): Promise<void> {
    const operationKey = trimString(progress.operation_key);
    if (operationKey === '') {
      return;
    }
    await performLauncherAction({
      kind: 'dismiss_launcher_operation',
      operation_key: operationKey,
    });
  }

  async function copyLauncherOperationDiagnostics(progress: DesktopLauncherActionProgress): Promise<void> {
    const failure = progress.failure;
    if (!failure) {
      return;
    }
    await navigator.clipboard.writeText(formatDesktopOperationFailureForClipboard(failure));
    showActionToast(i18n().t('toast.logCopied'), 'info');
  }

  async function openLocalEnvironment(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    route: 'auto' | DesktopLocalEnvironmentStateRoute = 'auto',
  ): Promise<boolean> {
    if (environment.kind !== 'local_environment') {
      return openEnvironment(environment, errorTarget === 'settings' ? 'connect' : errorTarget);
    }
    const preferredOpenSessionKey = route === 'remote_desktop'
      ? environment.open_remote_session_key
      : route === 'local_host'
          ? environment.open_local_session_key
          : environment.open_session_key;
    if (preferredOpenSessionKey) {
      return focusEnvironmentWindow(preferredOpenSessionKey, errorTarget);
    }
    const result = await performLauncherAction({
      kind: 'open_local_environment',
      environment_id: environment.id,
      route,
      ...(environment.managed_runtime_target_id ? { runtime_target_id: environment.managed_runtime_target_id } : {}),
      ...(environment.managed_runtime_placement_target_id ? { placement_target_id: environment.managed_runtime_placement_target_id } : {}),
      ...(environment.managed_runtime_host_access ? { host_access: environment.managed_runtime_host_access } : {}),
      ...(environment.managed_runtime_placement ? { placement: environment.managed_runtime_placement } : {}),
    }, errorTarget);
    return result?.outcome === 'opened_environment_window' || result?.outcome === 'focused_environment_window';
  }

  async function openPrimaryLocalEnvironment(): Promise<void> {
    const entry = selectedSettingsEnvironmentEntry();
    if (!entry) {
      setErrorMessage(visibleSurface() === 'environment_settings' ? 'settings' : 'connect', i18n().t('environmentCenter.chooseEnvironmentOrProviderFirst'));
      return;
    }
    await openLocalEnvironment(entry, visibleSurface() === 'environment_settings' ? 'settings' : 'connect');
  }

  async function openRemoteEnvironment(
    targetURL: string,
    errorTarget: 'connect' | 'dialog' = 'connect',
    environment?: DesktopEnvironmentEntry,
  ): Promise<boolean> {
    if (environment?.is_open && environment.open_session_key) {
      return focusEnvironmentWindow(environment.open_session_key, errorTarget);
    }
    const normalizedTargetURL = trimString(targetURL);
    if (!normalizedTargetURL) {
      setErrorMessage(errorTarget, i18n().t('connectionDialog.validationEnvironmentUrlRequired'));
      return false;
    }

    const result = await performLauncherAction({
      kind: 'open_remote_environment',
      external_local_ui_url: normalizedTargetURL,
      environment_id: environment?.id,
      label: environment?.label,
    }, errorTarget);
    const opened = result?.outcome === 'opened_environment_window' || result?.outcome === 'focused_environment_window';
    if (opened && errorTarget === 'dialog') {
      closeConnectionDialog();
    }
    return opened;
  }

  async function openProviderEnvironment(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    _route: 'auto' | DesktopLocalEnvironmentStateRoute = 'auto',
  ): Promise<boolean> {
    if (environment.kind !== 'provider_environment') {
      return openEnvironment(environment, errorTarget === 'settings' ? 'connect' : errorTarget);
    }
    const openRemoteSessionKey = trimString(environment.open_remote_session_key);
    if (openRemoteSessionKey !== '') {
      return focusEnvironmentWindow(openRemoteSessionKey, errorTarget);
    }
    if (trimString(environment.open_session_key) !== '') {
      return focusEnvironmentWindow(trimString(environment.open_session_key), errorTarget);
    }
    const result = await performLauncherAction({
      kind: 'open_provider_environment',
      environment_id: environment.id,
      route: 'remote_desktop',
    }, errorTarget);
    return result?.outcome === 'opened_environment_window' || result?.outcome === 'focused_environment_window';
  }

  function runtimeUnavailableMessage(environment: DesktopEnvironmentEntry): string {
    return environment.runtime_operations.start.availability === 'available'
      ? i18n().t('environmentCenter.startRuntimeFirst')
      : i18n().t('environmentCenter.runtimeUnavailableNow');
  }

  function runtimeActionRequest(
    environment: DesktopEnvironmentEntry,
    kind: RuntimeLauncherActionKind,
    options: Readonly<{ forceRuntimeUpdate?: boolean }> = {},
  ): DesktopEnvironmentRuntimeActionRequest | null {
    function withKind(target: DesktopLauncherRuntimeTarget): DesktopEnvironmentRuntimeActionRequest {
      switch (kind) {
        case 'start_environment_runtime':
          return { kind, ...target };
        case 'restart_environment_runtime':
          return { kind, ...target };
        case 'update_environment_runtime':
          return { kind, ...target };
        case 'stop_environment_runtime':
          return { kind, ...target };
        case 'refresh_environment_runtime':
          return { kind, ...target };
      }
    }

    const runtimeTarget: DesktopLauncherRuntimeTarget = {
      ...(environment.managed_runtime_target_id ? { runtime_target_id: environment.managed_runtime_target_id } : {}),
      ...(environment.managed_runtime_placement_target_id ? { placement_target_id: environment.managed_runtime_placement_target_id } : {}),
      ...(environment.managed_runtime_host_access ? { host_access: environment.managed_runtime_host_access } : {}),
      ...(environment.managed_runtime_placement ? { placement: environment.managed_runtime_placement } : {}),
    };
    if (environment.kind === 'local_environment') {
      return withKind({
        ...runtimeTarget,
        environment_id: environment.id,
        label: environment.label,
        ...(options.forceRuntimeUpdate ? { force_runtime_update: true } : {}),
      });
    }
    if (environment.kind === 'provider_environment') {
      return withKind({
        ...runtimeTarget,
        environment_id: environment.id,
        label: environment.label,
        ...(options.forceRuntimeUpdate ? { force_runtime_update: true } : {}),
      });
    }
    if (environment.kind === 'external_local_ui') {
      return withKind({
        ...runtimeTarget,
        environment_id: environment.id,
        external_local_ui_url: environment.local_ui_url,
        label: environment.label,
        ...(options.forceRuntimeUpdate ? { force_runtime_update: true } : {}),
      });
    }
    if (!environment.ssh_details) {
      return null;
    }
    return withKind({
      ...runtimeTarget,
      environment_id: environment.id,
      label: environment.label,
      ssh_destination: environment.ssh_details.ssh_destination,
      ssh_port: environment.ssh_details.ssh_port,
      auth_mode: environment.ssh_details.auth_mode,
      runtime_root: environment.ssh_details.runtime_root,
      bootstrap_strategy: environment.ssh_details.bootstrap_strategy,
      release_base_url: environment.ssh_details.release_base_url,
      connect_timeout_seconds: environment.ssh_details.connect_timeout_seconds,
      ...(options.forceRuntimeUpdate ? { force_runtime_update: true } : {}),
    });
  }

  async function reconnectProviderForEnvironment(
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    const providerOrigin = trimString(action.provider_origin) || trimString(environment.provider_origin);
    if (providerOrigin === '') {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : errorTarget, i18n().t('environmentCenter.resolveProviderError'));
      return false;
    }
    const controlPlane = snapshot().control_planes.find((candidate) => (
      candidate.provider.provider_origin === providerOrigin
      && (
        trimString(action.provider_id) === ''
        || candidate.provider.provider_id === action.provider_id
      )
    ));
    const result = await performLauncherAction({
      kind: 'start_control_plane_connect',
      provider_origin: providerOrigin,
      display_label: controlPlane?.display_label ?? environment.control_plane_label,
    }, errorTarget);
    if (result?.outcome === 'started_control_plane_connect') {
      showActionToast(i18n().t('environmentCenter.continueBrowserReconnectProvider'), 'info');
      return true;
    }
    return false;
  }

  async function loadLatestEnvironmentEntry(environmentID: string): Promise<DesktopEnvironmentEntry | null> {
    const nextSnapshot = await refreshSnapshot();
    return nextSnapshot.environments.find((entry) => entry.id === environmentID) ?? null;
  }

  async function startEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    options: Readonly<{
      announceSuccess?: boolean;
    }> = {},
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'start_environment_runtime');
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const started = result?.outcome === 'started_environment_runtime';
    if (started && options.announceSuccess !== false) {
      showActionToast(i18n().t('environmentCenter.runtimeStartedToast', { label: environment.label }));
    }
    return started;
  }

  async function updateEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel | undefined,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    if (action?.runtime_operation_method === 'desktop_local_update_handoff') {
      const result = await performLauncherAction({
        kind: 'manage_desktop_update',
        environment_id: environment.id,
        label: environment.label,
      }, errorTarget);
      const opened = result?.outcome === 'opened_desktop_update_handoff';
      if (opened) {
        showActionToast(i18n().t('environmentCenter.desktopUpdateOpenedToast', { label: environment.label }), 'info');
      }
      return opened;
    }
    const request = runtimeActionRequest(environment, 'update_environment_runtime', {
      forceRuntimeUpdate: true,
    });
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const updated = result?.outcome === 'updated_environment_runtime';
    if (updated) {
      showActionToast(i18n().t('environmentCenter.runtimeUpdatedToast', { label: environment.label }));
    }
    return updated;
  }

  async function restartEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'restart_environment_runtime');
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const restarted = result?.outcome === 'restarted_environment_runtime';
    if (restarted) {
      showActionToast(i18n().t('environmentCenter.runtimeRestartedToast', { label: environment.label }));
    }
    return restarted;
  }

  async function stopEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'stop_environment_runtime');
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const stopped = result?.outcome === 'stopped_environment_runtime';
    const canceled = result?.outcome === 'canceled_launcher_operation';
    if (stopped) {
      showActionToast(i18n().t('environmentCenter.runtimeStoppedToast', { label: environment.label }));
    }
    if (canceled) {
      showActionToast(i18n().t('environmentCenter.startupCanceledToast', { label: environment.label }), 'info');
    }
    return stopped || canceled;
  }

  async function refreshEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    options: Readonly<{ announceSuccess?: boolean }> = {},
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'refresh_environment_runtime');
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const refreshed = result?.outcome === 'refreshed_environment_runtime';
    if (refreshed && options.announceSuccess !== false) {
      showActionToast(i18n().t('environmentCenter.runtimeStatusRefreshedToast', { label: environment.label }), 'info');
    }
    return refreshed;
  }

  function requestProviderRuntimeLinkConfirmation(
    environment: DesktopEnvironmentEntry,
    action: ProviderRuntimeLinkConfirmationAction,
  ): void {
    // IMPORTANT: Provider-link confirmation is intentionally reachable only from
    // Local/SSH runtime cards. Provider Environment cards must never grant or
    // revoke provider control over a runtime.
    if (!desktopEntryKindOwnsRuntimeManagement(environment.kind)) {
      return;
    }
    const target = environment.provider_runtime_link_target;
    if (!target) {
      setErrorMessage('connect', i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return;
    }
    if (action === 'connect' && (environment.provider_environment_candidates?.length ?? 0) === 0) {
      setErrorMessage('connect', i18n().t('environmentCenter.noProviderEnvironmentsToConnect'));
      return;
    }
    setProviderRuntimeLinkProviderEnvironmentID(action === 'disconnect'
      ? providerEnvironmentIDForRuntimeTarget(environment)
      : '');
    setProviderRuntimeLinkConfirmation({
      environment,
      action,
    });
  }

  function closeProviderRuntimeLinkConfirmation(): void {
    setProviderRuntimeLinkConfirmation(null);
    setProviderRuntimeLinkProviderEnvironmentID('');
  }

  function providerEnvironmentIDForRuntimeTarget(environment: DesktopEnvironmentEntry): string {
    const target = environment.provider_runtime_link_target;
    if (!target?.provider_origin || !target.provider_id || !target.env_public_id) {
      return '';
    }
    return snapshot().environments.find((entry) => (
      entry.kind === 'provider_environment'
      && entry.provider_origin === target.provider_origin
      && entry.provider_id === target.provider_id
      && entry.env_public_id === target.env_public_id
    ))?.id ?? '';
  }

  async function confirmProviderRuntimeLinkAction(): Promise<void> {
    const confirmation = providerRuntimeLinkConfirmation();
    if (!confirmation) {
      return;
    }
    const latestEnvironment = await loadLatestEnvironmentEntry(confirmation.environment.id) ?? confirmation.environment;
    const providerEnvironmentID = providerRuntimeLinkProviderEnvironmentID();
    if (confirmation.action === 'connect') {
      if (providerEnvironmentID === '') {
        setErrorMessage('connect', i18n().t('environmentCenter.chooseProviderEnvironmentFirst'));
        return;
      }
      const target = latestEnvironment.provider_runtime_link_target;
      const providerEnvironment = latestEnvironment.provider_environment_candidates?.find((candidate) => (
        candidate.provider_environment_id === providerEnvironmentID
      ));
      if (!target || !providerEnvironment) {
        setErrorMessage('connect', i18n().t('environmentCenter.resolveProviderEnvironmentError'));
        return;
      }
      const plan = buildDesktopProviderRuntimeLinkPlan(target, providerEnvironment);
      if (!plan.can_connect) {
        setErrorMessage('connect', localizedProviderRuntimeLinkPlanMessage(i18n(), target, providerEnvironment, plan.state));
        return;
      }
    }
    const ok = confirmation.action === 'disconnect'
      ? await disconnectProviderRuntime(latestEnvironment, providerEnvironmentID, 'connect')
      : await connectProviderRuntime(latestEnvironment, providerEnvironmentID, 'connect');
    if (ok) {
      closeProviderRuntimeLinkConfirmation();
    }
  }

  async function connectProviderRuntime(
    environment: DesktopEnvironmentEntry,
    providerEnvironmentID: string,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    const target = environment.provider_runtime_link_target;
    if (!target) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : errorTarget, i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction({
      kind: 'connect_provider_runtime',
      provider_environment_id: providerEnvironmentID,
      runtime_target_id: target.id,
    }, errorTarget);
    const connected = result?.outcome === 'connected_provider_runtime';
    if (connected) {
      showActionToast(i18n().t('environmentCenter.connectedToProviderToast', { label: environment.label }), 'success');
    }
    return connected;
  }

  async function disconnectProviderRuntime(
    environment: DesktopEnvironmentEntry,
    providerEnvironmentID: string,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    const target = environment.provider_runtime_link_target;
    if (!target) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : errorTarget, i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction({
      kind: 'disconnect_provider_runtime',
      ...(providerEnvironmentID !== '' ? { provider_environment_id: providerEnvironmentID } : {}),
      runtime_target_id: target.id,
    }, errorTarget);
    const disconnected = result?.outcome === 'disconnected_provider_runtime';
    if (disconnected) {
      showActionToast(i18n().t('environmentCenter.disconnectedFromProviderToast'), 'info');
    }
    return disconnected;
  }

  async function refreshAllEnvironmentRuntimes(): Promise<void> {
    const result = await performLauncherAction({
      kind: 'refresh_all_environment_runtimes',
    });
    if (result?.outcome === 'refreshed_all_environment_runtimes') {
      showActionToast(i18n().t('toast.runtimeStatusesRefreshed'), 'info');
    }
  }

  async function openSSHEnvironment(
    details: DesktopSSHEnvironmentDetails,
    errorTarget: 'connect' | 'dialog' = 'connect',
    environment?: DesktopEnvironmentEntry,
  ): Promise<boolean> {
    if (environment?.is_open && environment.open_session_key) {
      return focusEnvironmentWindow(environment.open_session_key, errorTarget);
    }

    const result = await performLauncherAction({
      kind: 'open_ssh_environment',
      environment_id: environment?.id,
      label: environment?.label,
      ...(environment?.managed_runtime_target_id ? { runtime_target_id: environment.managed_runtime_target_id } : {}),
      ...(environment?.managed_runtime_placement_target_id ? { placement_target_id: environment.managed_runtime_placement_target_id } : {}),
      ...(environment?.managed_runtime_host_access ? { host_access: environment.managed_runtime_host_access } : {}),
      ...(environment?.managed_runtime_placement ? { placement: environment.managed_runtime_placement } : {}),
      ssh_destination: details.ssh_destination,
      ssh_port: details.ssh_port,
      auth_mode: details.auth_mode,
      runtime_root: details.runtime_root,
      bootstrap_strategy: details.bootstrap_strategy,
      release_base_url: details.release_base_url,
      connect_timeout_seconds: details.connect_timeout_seconds,
    }, errorTarget);
    const opened = result?.outcome === 'opened_environment_window' || result?.outcome === 'focused_environment_window';
    if (opened && errorTarget === 'dialog') {
      closeConnectionDialog();
    }
    return opened;
  }

  async function openEnvironment(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' = 'connect',
    route: 'auto' | DesktopLocalEnvironmentStateRoute = 'auto',
  ): Promise<boolean> {
    const canCheckBeforeOpen = environment.runtime_health.freshness === 'unknown'
      && environment.kind !== 'provider_environment';
    if (
      environment.window_state === 'closed'
      && environment.runtime_health.status !== 'online'
      && !canCheckBeforeOpen
    ) {
      const message = runtimeUnavailableMessage(environment);
      setErrorMessage(errorTarget, message);
      setEnvironmentFailures((current) => {
        const next = new Map(current);
        next.set(environment.id, { failure: inlineFailurePresentation(i18n(), message, 'warning') });
        return next;
      });
      return false;
    }
    if (environment.kind === 'local_environment') {
      return openLocalEnvironment(environment, errorTarget, route);
    }
    if (environment.kind === 'provider_environment') {
      return openProviderEnvironment(environment, errorTarget, route);
    }
    if (environment.kind === 'gateway_environment') {
      return openGatewayEnvironment(environment, errorTarget);
    }
    if (environment.kind === 'ssh_environment') {
      const details = environment.ssh_details;
      if (!details) {
        setErrorMessage(errorTarget, i18n().t('environmentCenter.sshConnectionDetailsMissing'));
        return false;
      }
      return openSSHEnvironment(details, errorTarget, environment);
    }
    return openRemoteEnvironment(environment.local_ui_url, errorTarget, environment);
  }

  async function triggerLocalEnvironmentAction(
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    switch (action.intent) {
      case 'open':
      case 'focus':
        return openEnvironment(environment, errorTarget === 'settings' ? 'connect' : errorTarget, action.route ?? 'auto');
      case 'start_runtime':
        return startEnvironmentRuntime(environment, errorTarget);
      case 'stop_runtime':
        return stopEnvironmentRuntime(environment, errorTarget);
      case 'restart_runtime':
        return restartEnvironmentRuntime(environment, errorTarget);
      case 'update_runtime':
        return updateEnvironmentRuntime(environment, action, errorTarget);
      case 'refresh_runtime':
        return refreshEnvironmentRuntime(environment, errorTarget);
      case 'reconnect_provider':
        return reconnectProviderForEnvironment(environment, action, errorTarget);
      case 'connect_provider_runtime':
        requestProviderRuntimeLinkConfirmation(environment, 'connect');
        return true;
      case 'disconnect_provider_runtime':
        requestProviderRuntimeLinkConfirmation(environment, 'disconnect');
        return true;
      case 'resolve_gateway':
        if (environment.kind === 'gateway_environment') {
          const gateway = snapshot().gateway_sources.find((source) => source.gateway_id === (environment.gateway_id ?? ''));
          if (gateway) {
            openCreateGatewaySetup(gateway);
            return true;
          }
        }
        return false;
      case 'opening':
      default:
        return false;
    }
  }

  async function runEnvironmentGuidanceAction(
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
  ): Promise<EnvironmentGuidanceActionResolution> {
    if (
      action.intent === 'start_runtime'
      || action.intent === 'stop_runtime'
      || action.intent === 'restart_runtime'
      || action.intent === 'update_runtime'
    ) {
      await triggerLocalEnvironmentAction(environment, action, 'connect');
      return {
        close_panel: true,
        next_session: null,
      };
    }

    const currentSession = isEnvironmentGuidancePendingIntent(action.intent)
      ? startEnvironmentGuidanceIntent(null, environment.id, action.intent)
      : openEnvironmentGuidanceSession(environment.id);

    if (action.intent === 'refresh_runtime') {
      const request = runtimeActionRequest(environment, 'refresh_environment_runtime');
      if (!request) {
        return {
          close_panel: false,
          next_session: failEnvironmentGuidanceIntent(
            currentSession,
            'Desktop could not resolve that runtime target.',
          ),
        };
      }
      const result = await performLauncherActionSilently(request);
      if (!result.ok) {
        const message = launcherFailureSummary(result);
        return {
          close_panel: false,
          next_session: failEnvironmentGuidanceIntent(currentSession, message),
        };
      }

      const nextEnvironment = await loadLatestEnvironmentEntry(environment.id);
      if (!nextEnvironment) {
        showActionToast(i18n().t('toast.runtimeReadyFor', { label: environment.label }), 'success');
        return {
          close_panel: true,
          next_session: null,
        };
      }

      const nextSession = completeEnvironmentGuidanceRefresh(currentSession, nextEnvironment);
      if (!nextSession) {
        showActionToast(i18n().t('toast.runtimeReadyFor', { label: environment.label }), 'success');
        return {
          close_panel: true,
          next_session: null,
        };
      }
      return {
        close_panel: false,
        next_session: nextSession,
      };
    }

    if (action.intent === 'connect_provider_runtime') {
      requestProviderRuntimeLinkConfirmation(environment, 'connect');
      return {
        close_panel: true,
        next_session: null,
      };
    }

    if (action.intent === 'disconnect_provider_runtime') {
      requestProviderRuntimeLinkConfirmation(environment, 'disconnect');
      return {
        close_panel: true,
        next_session: null,
      };
    }

    const completed = await triggerLocalEnvironmentAction(environment, action, 'connect');
    return {
      close_panel: completed,
      next_session: completed
        ? null
        : failEnvironmentGuidanceIntent(
          currentSession,
          `Desktop could not complete "${action.label}".`,
        ),
    };
  }

  async function connectControlPlaneFromDialog(): Promise<void> {
    const state = controlPlaneDialogState();
    if (!state) {
      return;
    }
    const result = await performLauncherAction({
      kind: 'start_control_plane_connect',
      provider_origin: trimString(state.provider_origin),
      display_label: trimString(state.display_label),
    }, 'control_plane_dialog');
    if (result?.outcome === 'started_control_plane_connect') {
      closeControlPlaneDialog();
      showActionToast(i18n().t('environmentCenter.continueBrowserAuthorizeProvider'), 'info');
    }
  }

  async function reconnectControlPlane(controlPlane: DesktopControlPlaneSummary): Promise<void> {
    const result = await performLauncherAction({
      kind: 'start_control_plane_connect',
      provider_origin: controlPlane.provider.provider_origin,
      display_label: controlPlane.display_label,
    });
    if (result?.outcome === 'started_control_plane_connect') {
      showActionToast(i18n().t('environmentCenter.continueBrowserReconnectNamedProvider', { label: controlPlaneName(controlPlane) }), 'info');
    }
  }

  async function refreshControlPlane(controlPlane: DesktopControlPlaneSummary): Promise<void> {
    const result = await performLauncherAction({
      kind: 'refresh_control_plane',
      provider_origin: controlPlane.provider.provider_origin,
      provider_id: controlPlane.provider.provider_id,
    });
    if (result?.outcome === 'refreshed_control_plane') {
      showActionToast(i18n().t('toast.refreshedControlPlane', { label: controlPlaneName(controlPlane) }));
    }
  }

  async function closeLauncherOrQuit(): Promise<void> {
    await performLauncherAction({ kind: 'close_launcher_or_quit' });
  }

  function updateSettingsDraft(updater: (current: DesktopSettingsDraft) => DesktopSettingsDraft): void {
    setSettingsDraftSession((current) => updateDesktopSettingsDraftSessionDraft(current, updater));
  }

  function updateDraftField(name: keyof DesktopSettingsDraft, value: string): void {
    if (name === 'local_ui_password') {
      const storedPasswordConfigured = settingsBaselineSurface().local_ui_password_configured;
      updateSettingsDraft((current) => ({
        ...current,
        local_ui_password: value,
        local_ui_password_mode: passwordModeForInput(value, storedPasswordConfigured),
      }));
      return;
    }
    updateSettingsDraft((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function applyAccessMode(mode: DesktopAccessMode): void {
    updateSettingsDraft((current) => {
      const storedPasswordConfigured = settingsBaselineSurface().local_ui_password_configured;
      const nextDraft = applyDesktopAccessModeToDraft(current, mode);
      if (mode === 'local_only') {
        return {
          ...nextDraft,
          local_ui_password: '',
          local_ui_password_mode: 'clear',
        };
      }
      if (mode === 'shared_local_network') {
        return {
          ...nextDraft,
          local_ui_password_mode: normalizeDesktopLocalUIPasswordMode(
            current.local_ui_password_mode,
            defaultLocalUIPasswordMode(storedPasswordConfigured),
          ) === 'clear'
            ? defaultLocalUIPasswordMode(storedPasswordConfigured)
            : current.local_ui_password_mode,
        };
      }
      return nextDraft;
    });
  }

  function applyAccessFixedPort(portText: string): void {
    updateSettingsDraft((current) => applyDesktopAccessFixedPortToDraft(current, portText));
  }

  function toggleAutoPort(enabled: boolean): void {
    updateSettingsDraft((current) => applyDesktopAccessAutoPortToDraft(current, enabled));
  }

  function clearStoredLocalUIPassword(): void {
    updateSettingsDraft((current) => ({
      ...current,
      local_ui_password: '',
      local_ui_password_mode: 'clear',
    }));
  }

  async function saveSettings(): Promise<void> {
    setSettingsError('');
    setBusyState({
      action: 'save_settings',
      environment_id: '',
      provider_origin: '',
      provider_id: '',
      gateway_id: '',
      request_started_at_unix_ms: Date.now(),
      progress: null,
    });
    try {
      const result = await props.runtime.settings.save(draft());
      if (!result.ok) {
        setSettingsError(result.error);
        return;
      }
      const nextSnapshot = await refreshSnapshot();
      setSettingsDraftSession(createDesktopSettingsDraftSession(nextSnapshot.settings_surface));
      showActionToast(i18n().t('toast.settingsSaved'));
    } catch (error) {
      setSettingsError(getErrorMessage(error));
    } finally {
      setBusyState(IDLE_LAUNCHER_BUSY_STATE);
    }
  }

  function cancelSettings(): void {
    setSettingsError('');
    props.runtime.settings.cancel();
  }

  async function upsertSavedEnvironment(
    request: Readonly<{
      environment_id: string;
      label: string;
      external_local_ui_url: string;
      autoRuntimeProbeEnabled: boolean;
      errorTarget: 'connect' | 'dialog';
      successMessage: string;
    }>,
  ): Promise<boolean> {
    const normalizedTargetURL = trimString(request.external_local_ui_url);
    if (!normalizedTargetURL) {
      setErrorMessage(request.errorTarget, i18n().t('connectionDialog.validationEnvironmentUrlRequired'));
      return false;
    }

    setConnectionDialogError('');
    setBusyState({
      action: 'save_environment',
      environment_id: trimString(request.environment_id),
      provider_origin: '',
      provider_id: '',
      gateway_id: '',
      request_started_at_unix_ms: Date.now(),
      progress: null,
    });
    try {
      await props.runtime.launcher.performAction({
        kind: 'upsert_saved_environment',
        environment_id: trimString(request.environment_id),
        label: trimString(request.label),
        external_local_ui_url: normalizedTargetURL,
        auto_runtime_probe_enabled: request.autoRuntimeProbeEnabled,
      });
      await refreshSnapshot();
      showActionToast(request.successMessage);
      return true;
    } catch (error) {
      setErrorMessage(request.errorTarget, getErrorMessage(error));
      return false;
    } finally {
      setBusyState(IDLE_LAUNCHER_BUSY_STATE);
    }
  }

  async function upsertSavedSSHEnvironment(
    request: Readonly<{
      environment_id: string;
      label: string;
      details: DesktopSSHEnvironmentDetails;
      sshPassword: string;
      sshPasswordMode: 'keep' | 'replace' | 'clear';
      autoRuntimeProbeEnabled: boolean;
      errorTarget: 'connect' | 'dialog';
      successMessage: string;
    }>,
  ): Promise<boolean> {
    setConnectionDialogError('');
    setBusyState({
      action: 'save_environment',
      environment_id: trimString(request.environment_id),
      provider_origin: '',
      provider_id: '',
      gateway_id: '',
      request_started_at_unix_ms: Date.now(),
      progress: null,
    });
    try {
      await props.runtime.launcher.performAction({
        kind: 'upsert_saved_ssh_environment',
        environment_id: trimString(request.environment_id),
        label: trimString(request.label),
        ssh_destination: request.details.ssh_destination,
        ssh_port: request.details.ssh_port,
        auth_mode: request.details.auth_mode,
        runtime_root: request.details.runtime_root,
        bootstrap_strategy: request.details.bootstrap_strategy,
        release_base_url: request.details.release_base_url,
        connect_timeout_seconds: request.details.connect_timeout_seconds,
        ssh_password: request.sshPassword,
        ssh_password_mode: request.sshPasswordMode,
        auto_runtime_probe_enabled: request.autoRuntimeProbeEnabled,
      });
      await refreshSnapshot();
      showActionToast(request.successMessage);
      return true;
    } catch (error) {
      setErrorMessage(request.errorTarget, getErrorMessage(error));
      return false;
    } finally {
      setBusyState(IDLE_LAUNCHER_BUSY_STATE);
    }
  }

  async function upsertSavedRuntimeTarget(
    request: Readonly<{
      environment_id: string;
      label: string;
      state: RuntimeContainerConnectionDialogState;
      errorTarget: 'connect' | 'dialog';
      successMessage: string;
    }>,
  ): Promise<boolean> {
    setConnectionDialogError('');
    setBusyState({
      action: 'save_environment',
      environment_id: trimString(request.environment_id),
      provider_origin: '',
      provider_id: '',
      gateway_id: '',
      request_started_at_unix_ms: Date.now(),
      progress: null,
    });
    try {
      const isSSHContainer = request.state.connection_kind === 'ssh_container_runtime';
      await props.runtime.launcher.performAction({
        kind: 'upsert_saved_runtime_target',
        environment_id: trimString(request.environment_id) || undefined,
        label: trimString(request.label),
        host_access: isSSHContainer
          ? {
              kind: 'ssh_host',
              ssh: {
                ssh_destination: request.state.ssh_destination,
                ssh_port: trimString(request.state.ssh_port) === '' ? null : Number.parseInt(request.state.ssh_port, 10),
                auth_mode: request.state.auth_mode,
                connect_timeout_seconds: trimString(request.state.connect_timeout_seconds) === '' ? null : Number(trimString(request.state.connect_timeout_seconds)),
              },
            }
          : { kind: 'local_host' },
        placement: {
          kind: 'container_process',
          container_engine: request.state.container_engine,
          container_id: trimString(request.state.container_id),
          container_ref: trimString(request.state.container_ref) || trimString(request.state.container_label) || trimString(request.state.container_id),
          container_label: trimString(request.state.container_label) || trimString(request.state.container_id),
          runtime_root: trimString(request.state.runtime_root) || (
            isSSHContainer ? DEFAULT_DESKTOP_SSH_RUNTIME_ROOT : '/root/.redeven'
          ),
          bridge_strategy: 'exec_stream',
        },
        ssh_password: request.state.ssh_password,
        ssh_password_mode: request.state.ssh_password_mode,
        auto_runtime_probe_enabled: request.state.auto_runtime_probe_enabled,
      });
      await refreshSnapshot();
      showActionToast(request.successMessage);
      return true;
    } catch (error) {
      setErrorMessage(request.errorTarget, getErrorMessage(error));
      return false;
    } finally {
      setBusyState(IDLE_LAUNCHER_BUSY_STATE);
    }
  }

  function validateGatewaySetupDialogFields(state: GatewaySetupDialogState): Partial<Record<string, string>> {
    const errors: Partial<Record<string, string>> = {};
    if (!trimString(state.display_name) && !suggestGatewayDisplayName(state)) {
      errors.display_name = i18n().t('connectionDialog.validationGatewayNameRequired');
    }
    if (state.connection_kind === 'url' && !trimString(state.gateway_url)) {
      errors.gateway_url = i18n().t('connectionDialog.validationGatewayUrlRequired');
    }
    if ((state.connection_kind === 'ssh_host' || state.connection_kind === 'ssh_container') && !trimString(state.ssh_destination)) {
      errors.ssh_destination = i18n().t('connectionDialog.validationSshDestinationRequired');
    }
    if (
      (state.connection_kind === 'ssh_host' || state.connection_kind === 'ssh_container')
      && state.auth_mode === 'password'
      && state.ssh_password_mode !== 'keep'
      && !trimString(state.ssh_password)
    ) {
      errors.auth_mode = i18n().t('connectionDialog.validationSshPasswordRequired');
    }
    if (
      (state.connection_kind === 'ssh_host' || state.connection_kind === 'ssh_container')
      && trimString(state.ssh_port) !== ''
    ) {
      const port = Number.parseInt(state.ssh_port, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        errors.ssh_port = i18n().t('connectionDialog.validationPortRange');
      }
    }
    if (state.connection_kind === 'ssh_container' && !trimString(state.container_id)) {
      errors.container_id = i18n().t('connectionDialog.validationChooseContainer');
    }
    return errors;
  }

  async function saveGatewayFromDialog(): Promise<void> {
    const state = gatewaySetupDialogState();
    if (!state) {
      return;
    }
    const errors = validateGatewaySetupDialogFields(state);
    setGatewaySetupDialogFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setGatewaySetupDialogFieldErrors({});
    const displayName = trimString(state.display_name) || suggestGatewayDisplayName(state) || 'Gateway';
    const runtimeRoot = trimString(state.runtime_root) || DEFAULT_DESKTOP_SSH_RUNTIME_ROOT;
    const base = {
      kind: 'upsert_gateway',
      gateway_id: trimString(state.gateway_id) || undefined,
      display_name: displayName,
    } as const;
    const action: DesktopLauncherActionRequest = state.connection_kind === 'url'
      ? {
          ...base,
          connection_kind: 'url',
          gateway_url: trimString(state.gateway_url),
          allow_loopback_http: state.allow_loopback_http,
        }
      : state.connection_kind === 'ssh_host'
        ? {
            ...base,
            connection_kind: 'ssh_host',
            ssh_destination: trimString(state.ssh_destination),
            ssh_port: trimString(state.ssh_port) === '' ? null : Number.parseInt(trimString(state.ssh_port), 10),
            auth_mode: state.auth_mode,
            ssh_password: state.ssh_password,
            ssh_password_mode: state.ssh_password_mode,
            connect_timeout_seconds: trimString(state.connect_timeout_seconds) === '' ? null : Number(trimString(state.connect_timeout_seconds)),
            runtime_root: runtimeRoot,
            bootstrap_strategy: state.bootstrap_strategy,
            release_base_url: trimString(state.release_base_url),
          }
        : {
            ...base,
            connection_kind: 'ssh_container',
            ssh_destination: trimString(state.ssh_destination),
            ssh_port: trimString(state.ssh_port) === '' ? null : Number.parseInt(trimString(state.ssh_port), 10),
            auth_mode: state.auth_mode,
            ssh_password: state.ssh_password,
            ssh_password_mode: state.ssh_password_mode,
            connect_timeout_seconds: trimString(state.connect_timeout_seconds) === '' ? null : Number(trimString(state.connect_timeout_seconds)),
            container_engine: state.container_engine,
            container_id: trimString(state.container_id),
            container_ref: trimString(state.container_ref) || trimString(state.container_label) || trimString(state.container_id),
            container_label: trimString(state.container_label) || trimString(state.container_id),
            runtime_root: runtimeRoot,
          };
    const result = await performLauncherAction(action, 'gateway_dialog');
    if (result?.outcome === 'saved_gateway') {
      await refreshSnapshot();
      closeGatewaySetupDialog();
      showActionToast(i18n().t('toast.gatewaySaved'));
    }
  }

  async function pairGateway(gatewayID: string, startPolicy?: DesktopGatewayStartPolicy): Promise<void> {
    const cleanGatewayID = trimString(gatewayID);
    if (cleanGatewayID === '') {
      setErrorMessage('connect', i18n().t('environmentCenter.resolveGatewayError'));
      return;
    }
    const result = await performLauncherAction({
      kind: 'pair_gateway',
      gateway_id: cleanGatewayID,
      ...(startPolicy ? { start_policy: startPolicy } : {}),
    });
    if (result?.outcome === 'paired_gateway') {
      await refreshSnapshot();
      showActionToast(i18n().t('toast.gatewayPaired'));
    }
  }

  async function runGatewayRuntimeAction(
    gatewayID: string,
    kind: GatewayRuntimeActionKind,
    startPolicy?: GatewayRuntimeStartPolicy,
  ): Promise<void> {
    const cleanGatewayID = trimString(gatewayID);
    if (cleanGatewayID === '') {
      setErrorMessage('connect', i18n().t('environmentCenter.resolveGatewayError'));
      return;
    }
    const result = await performLauncherAction({
      kind,
      gateway_id: cleanGatewayID,
      ...(kind === 'refresh_gateway_catalog' && startPolicy ? { start_policy: startPolicy } : {}),
    } as DesktopLauncherActionRequest);
    if (!result) {
      return;
    }
    await refreshSnapshot();
    switch (result.outcome) {
      case 'started_gateway_runtime':
        showActionToast('Gateway started.');
        break;
      case 'stopped_gateway_runtime':
        showActionToast('Gateway stopped.', 'info');
        break;
      case 'restarted_gateway_runtime':
        showActionToast('Gateway restarted.');
        break;
      case 'updated_gateway_runtime':
        showActionToast('Gateway updated.');
        break;
      case 'refreshed_gateway_catalog':
        showActionToast('Gateway catalog refreshed.', 'info');
        break;
      default:
        break;
    }
  }

  function closeGatewayStartRequiredDialog(): void {
    setGatewayStartRequiredDialog(null);
  }

  async function confirmGatewayStartRequiredDialog(): Promise<void> {
    const payload = gatewayStartRequiredDialog();
    if (!payload) {
      return;
    }
    const result = await performLauncherAction(payload.retry_action);
    if (result?.outcome === 'paired_gateway') {
      showActionToast(i18n().t('toast.gatewayPaired'));
    } else if (result?.outcome === 'refreshed_gateway_catalog') {
      showActionToast('Gateway catalog refreshed.', 'info');
    }
    if (result) {
      closeGatewayStartRequiredDialog();
      await refreshSnapshot();
    }
  }

  async function openGatewayEnvironment(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' = 'connect',
  ): Promise<boolean> {
    if (environment.is_open && environment.open_session_key) {
      return focusEnvironmentWindow(environment.open_session_key, errorTarget);
    }
    const gatewayID = trimString(environment.gateway_id);
    const gatewayEnvID = trimString(environment.gateway_env_id);
    if (gatewayID === '' || gatewayEnvID === '') {
      setErrorMessage(errorTarget, i18n().t('environmentCenter.resolveGatewayError'));
      return false;
    }
    const result = await performLauncherAction({
      kind: 'open_gateway_environment',
      environment_id: environment.id,
      gateway_id: gatewayID,
      gateway_env_id: gatewayEnvID,
      label: environment.label,
    }, errorTarget);
    return result?.outcome === 'opened_environment_window' || result?.outcome === 'focused_environment_window';
  }

  function validateConnectionDialogFields(state: ConnectionDialogState): Partial<Record<string, string>> {
    const errors: Partial<Record<string, string>> = {};
    if (!trimString(state?.label ?? '')) {
      errors.label = i18n().t('connectionDialog.validationNameRequired');
    }
    if (state?.connection_kind === 'external_local_ui' && !trimString(state.external_local_ui_url)) {
      errors.external_local_ui_url = i18n().t('connectionDialog.validationEnvironmentUrlRequired');
    }
    if (state?.connection_kind === 'ssh_environment' && !trimString(state.ssh_destination)) {
      errors.ssh_destination = i18n().t('connectionDialog.validationSshDestinationRequired');
    }
    if (state?.connection_kind === 'ssh_container_runtime' && !trimString(state.ssh_destination)) {
      errors.ssh_destination = i18n().t('connectionDialog.validationSshDestinationRequired');
    }
    if (
      (state?.connection_kind === 'ssh_environment' || state?.connection_kind === 'ssh_container_runtime')
      && trimString(state.ssh_port) !== ''
    ) {
      const port = Number.parseInt(state.ssh_port, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        errors.ssh_port = i18n().t('connectionDialog.validationPortRange');
      }
    }
    if (
      (state?.connection_kind === 'local_container_runtime' || state?.connection_kind === 'ssh_container_runtime')
      && !trimString(state.container_id)
    ) {
      errors.container_id = i18n().t('connectionDialog.validationChooseContainer');
    }
    if (
      (state?.connection_kind === 'local_container_runtime' || state?.connection_kind === 'ssh_container_runtime')
      && trimString(state.container_id)
      && !runtimeContainerOptions().some((container) => container.container_id === trimString(state.container_id))
    ) {
      errors.container_id = i18n().t('connectionDialog.validationChooseContainerFromList');
    }
    if (
      state?.connection_kind === 'local_container_runtime'
      && !trimString(state.runtime_root)
    ) {
      errors.runtime_root = i18n().t('connectionDialog.validationRuntimeRootRequired');
    }
    return errors;
  }

  async function saveConnectionFromDialog(): Promise<void> {
    const state = connectionDialogState();
    if (!state) {
      return;
    }
    const errors = validateConnectionDialogFields(state);
    setConnectionDialogFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setConnectionDialogFieldErrors({});
    let saved = false;
    if (state.connection_kind === 'ssh_environment') {
      saved = await upsertSavedSSHEnvironment({
        environment_id: state.environment_id,
        label: state.label,
        details: {
          ssh_destination: state.ssh_destination,
          ssh_port: trimString(state.ssh_port) === '' ? null : Number.parseInt(state.ssh_port, 10),
          auth_mode: state.auth_mode,
          runtime_root: trimString(state.runtime_root) || DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
          bootstrap_strategy: state.bootstrap_strategy,
          release_base_url: trimString(state.release_base_url),
          connect_timeout_seconds: trimString(state.connect_timeout_seconds) === '' ? null : Number(trimString(state.connect_timeout_seconds)),
        },
        sshPassword: state.ssh_password,
        sshPasswordMode: state.ssh_password_mode,
        autoRuntimeProbeEnabled: state.auto_runtime_probe_enabled,
        errorTarget: 'dialog',
        successMessage: state.mode === 'edit'
          ? i18n().t('toast.connectionUpdated')
          : i18n().t('toast.connectionSaved'),
      });
    } else if (state.connection_kind === 'local_container_runtime' || state.connection_kind === 'ssh_container_runtime') {
      saved = await upsertSavedRuntimeTarget({
        environment_id: state.environment_id,
        label: state.label,
        state,
        errorTarget: 'dialog',
        successMessage: state.mode === 'edit'
          ? i18n().t('toast.runtimeTargetUpdated')
          : i18n().t('toast.runtimeTargetSaved'),
      });
    } else if (state.connection_kind === 'external_local_ui') {
      saved = await upsertSavedEnvironment({
        environment_id: state.environment_id,
        label: state.label,
        external_local_ui_url: state.external_local_ui_url,
        autoRuntimeProbeEnabled: state.auto_runtime_probe_enabled,
        errorTarget: 'dialog',
        successMessage: state.mode === 'edit'
          ? i18n().t('toast.connectionUpdated')
          : i18n().t('toast.connectionSaved'),
      });
    }
    if (saved) {
      closeConnectionDialog();
    }
  }

  async function toggleEnvironmentPinned(environment: DesktopEnvironmentEntry): Promise<void> {
    const nextPinned = !environment.pinned;
    const successMessage = nextPinned
      ? i18n().t('toast.pinned', { label: environment.label })
      : i18n().t('toast.unpinned', { label: environment.label });
    if (environment.kind === 'local_environment') {
      if (environment.managed_runtime_placement?.kind === 'container_process' && environment.managed_runtime_host_access) {
        const result = await performLauncherAction({
          kind: 'set_saved_runtime_target_pinned',
          environment_id: environment.id,
          label: environment.label,
          pinned: nextPinned,
          host_access: environment.managed_runtime_host_access,
          placement: environment.managed_runtime_placement,
        }, 'connect');
        if (result?.outcome === 'saved_environment') {
          showActionToast(successMessage);
        }
        return;
      }
      const result = await performLauncherAction({
        kind: 'set_local_environment_pinned',
        environment_id: environment.id,
        pinned: nextPinned,
      }, 'connect');
      if (result?.outcome === 'saved_environment') {
        showActionToast(successMessage);
      }
      return;
    }
    if (environment.kind === 'provider_environment') {
      const result = await performLauncherAction({
        kind: 'set_provider_environment_pinned',
        environment_id: environment.id,
        pinned: nextPinned,
      }, 'connect');
      if (result?.outcome === 'saved_environment') {
        showActionToast(successMessage);
      }
      return;
    }
    if (environment.kind === 'ssh_environment') {
      if (environment.managed_runtime_placement?.kind === 'container_process' && environment.managed_runtime_host_access) {
        const result = await performLauncherAction({
          kind: 'set_saved_runtime_target_pinned',
          environment_id: environment.id,
          label: environment.label,
          pinned: nextPinned,
          host_access: environment.managed_runtime_host_access,
          placement: environment.managed_runtime_placement,
        }, 'connect');
        if (result?.outcome === 'saved_environment') {
          showActionToast(successMessage);
        }
        return;
      }
      const details = environment.ssh_details;
      if (!details) {
        setErrorMessage('connect', i18n().t('environmentCenter.sshConnectionDetailsMissing'));
        return;
      }
      const result = await performLauncherAction({
        kind: 'set_saved_ssh_environment_pinned',
        environment_id: environment.id,
        label: environment.label,
        pinned: nextPinned,
        ssh_destination: details.ssh_destination,
        ssh_port: details.ssh_port,
        auth_mode: details.auth_mode,
        runtime_root: details.runtime_root,
        bootstrap_strategy: details.bootstrap_strategy,
        release_base_url: details.release_base_url,
        connect_timeout_seconds: details.connect_timeout_seconds,
      }, 'connect');
      if (result?.outcome === 'saved_environment') {
        showActionToast(successMessage);
      }
      return;
    }
    const result = await performLauncherAction({
      kind: 'set_saved_environment_pinned',
      environment_id: environment.id,
      label: environment.label,
      external_local_ui_url: environment.local_ui_url,
      pinned: nextPinned,
    }, 'connect');
    if (result?.outcome === 'saved_environment') {
      showActionToast(successMessage);
    }
  }

  async function copyEnvironmentValue(value: string, copyLabel: string): Promise<void> {
    await copyToClipboard(value);
    const messageLabel = copiedValueLabel(i18n(), trimString(copyLabel));
    showActionToast(messageLabel ? i18n().t('toast.valueCopied', { label: messageLabel }) : i18n().t('environmentCenter.copiedToClipboard'));
  }

  async function deleteEnvironment(): Promise<void> {
    const target = deleteTarget();
    if (!target) {
      return;
    }
    if (
      target.kind !== 'ssh_environment'
      && target.kind !== 'external_local_ui'
      && !(target.kind === 'local_environment' && target.managed_runtime_placement?.kind === 'container_process')
    ) {
      throw new Error('Unsupported delete target.');
    }
    const hadBackgroundOperation = deleteTargetOperation() !== null;
    setBusyState({
      action: 'delete_environment',
      environment_id: target.id,
      provider_origin: '',
      provider_id: '',
      gateway_id: '',
      request_started_at_unix_ms: Date.now(),
      progress: null,
    });
    try {
      await props.runtime.launcher.performAction({
        kind: target.managed_runtime_placement?.kind === 'container_process'
          ? 'delete_saved_runtime_target'
          : target.kind === 'ssh_environment'
            ? 'delete_saved_ssh_environment'
            : 'delete_saved_environment',
        environment_id: target.id,
      });
      await refreshSnapshot();
      setDeleteTarget(null);
      showActionToast(
        hadBackgroundOperation
          ? i18n().t('environmentCenter.connectionRemovedCleanup')
          : i18n().t('environmentCenter.connectionRemoved'),
        'info',
      );
    } catch (error) {
      setErrorMessage('connect', getErrorMessage(error));
    } finally {
      setBusyState(IDLE_LAUNCHER_BUSY_STATE);
    }
  }

  async function deleteControlPlane(): Promise<void> {
    const target = deleteControlPlaneTarget();
    if (!target) {
      return;
    }
    const result = await performLauncherAction({
      kind: 'delete_control_plane',
      provider_origin: target.provider.provider_origin,
      provider_id: target.provider.provider_id,
    });
    if (result?.outcome === 'deleted_control_plane') {
      setDeleteControlPlaneTarget(null);
      showActionToast(i18n().t('environmentCenter.providerRemoved'));
    }
  }

  async function openFlowerHostSurface(): Promise<void> {
    await performLauncherAction({
      kind: 'open_flower_host',
    });
  }

  async function resolveEnvironmentFlowerHandler(environment: DesktopEnvironmentEntry): Promise<DesktopFlowerHostRouterDecision> {
    const envelope = buildEnvironmentFlowerContextEnvelope(environment);
    const result = await props.runtime.settings.resolveFlowerHostHandler({
      thread_kind: 'task',
      context_envelope_id: envelope.id,
      client_surface: 'welcome_ask_flower',
      primary_target_id: environmentFlowerPrimaryTargetID(environment),
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.decision;
  }

  async function sendEnvironmentFlowerPrompt(
    environment: DesktopEnvironmentEntry,
    prompt: string,
    decision: DesktopFlowerHostRouterDecision,
  ): Promise<string> {
    const cleanPrompt = trimString(prompt);
    if (!cleanPrompt) {
      return '';
    }
    const envelope = buildEnvironmentFlowerContextEnvelope(environment);
    const result = await props.runtime.settings.sendFlowerHostChat({
      prompt: buildEnvironmentFlowerPrompt(i18n(), environment, cleanPrompt),
      reply_mode: 'background',
      decision_id: decision.decision_id,
      decision_revision: decision.decision_revision,
      selected_handler_id: decision.selected_handler?.handler_id,
      thread_kind: decision.decision_scope.thread_kind,
      primary_target_id: decision.decision_scope.primary_target_id,
      context_envelope: envelope,
      client_surface: decision.decision_scope.client_surface,
      context_action: envelope.raw,
    });
    if (!result.ok) {
      if ('fresh_decision' in result) {
        // Surface stale routing state through the existing composer validation path.
        throw Object.assign(new Error(result.error), { fresh_decision: result.fresh_decision });
      }
      throw new Error(result.error);
    }
    setFocusedFlowerThreadID(result.thread.thread_id);
    showActionToast(i18n().t('toast.flowerPromptQueued'), 'success');
    return result.thread.thread_id;
  }

  function openEnvironmentFlowerComposer(environment: DesktopEnvironmentEntry, anchor?: { x: number; y: number }): void {
    setEnvironmentFlowerComposer({ environment, anchor });
  }

  function closeEnvironmentFlowerComposer(): void {
    setEnvironmentFlowerComposer(null);
  }

  async function openEnvironmentCenterSurface(): Promise<void> {
    await performLauncherAction({
      kind: 'open_environment_center',
    });
  }

  const topBarLogoLabel = () => (
    snapshot().surface === 'flower_host'
      ? i18n().t('shell.backToEnvironments')
      : i18n().t('shell.openRedevenDashboard')
  );
  const activateTopBarLogo = () => {
    if (snapshot().surface === 'flower_host') {
      void openEnvironmentCenterSurface();
      return;
    }
    openRedevenDashboard();
  };

  return (
    <>
      <DesktopCommandRegistrar
        snapshot={snapshot}
        i18n={i18n()}
        showConnectEnvironment={showConnectEnvironment}
        openCreateConnectionDialog={openCreateConnectionDialog}
        openSettingsSurface={openSettingsSurface}
        openLocalEnvironment={openPrimaryLocalEnvironment}
        openEnvironment={openEnvironment}
        closeLauncherOrQuit={closeLauncherOrQuit}
        openLanguageSettings={openLanguageSettings}
      />
      <DesktopLauncherShell
        mainContentId="redeven-desktop-main"
        skipLinkLabel={i18n().t('shell.accessibility.skipLinkLabel')}
        topBarLabel={i18n().t('shell.accessibility.topBarLabel')}
        logo={(
          <TopBarIconButton label={topBarLogoLabel()} onClick={activateTopBarLogo}>
            <img
              src={headerLogoSrc()}
              alt="Redeven"
              class="h-6 w-6 object-contain"
              data-redeven-logo-theme={theme.resolvedTheme()}
            />
          </TopBarIconButton>
        )}
        trailingActions={(
          <div class="flex items-center gap-1">
            <Show when={snapshot().surface === 'flower_host'}>
              <button
                type="button"
                class="redeven-flower-back-button"
                aria-label={i18n().t('shell.backToEnvironments')}
                title={i18n().t('shell.backToEnvironments')}
                onClick={() => void openEnvironmentCenterSurface()}
              >
                <ArrowLeft class="h-3.5 w-3.5" />
                <span>{i18n().t('shell.backToEnvironments')}</span>
              </button>
            </Show>
            <Show when={snapshot().surface !== 'flower_host'}>
              <button
                type="button"
                class="redeven-flower-topbar-button"
                aria-label={i18n().t('flowerSurface.chat.entryLabel')}
                title={i18n().t('flowerSurface.chat.entryLabel')}
                onClick={() => void openFlowerHostSurface()}
              >
                <FlowerIcon class="h-5 w-5" />
              </button>
            </Show>
            <DesktopLanguagePicker
              openRequest={languagePickerOpenRequest()}
              snapshot={languageSnapshot()}
              i18n={i18n()}
              onPreferenceChange={updateDesktopLanguagePreference}
            />
            <TopBarIconButton
              label={theme.resolvedTheme() === 'light' ? i18n().t('shell.useDarkTheme') : i18n().t('shell.useLightTheme')}
              onClick={() => toggleDesktopTheme(theme.resolvedTheme(), shellTheme, () => theme.toggleTheme())}
            >
              {theme.resolvedTheme() === 'light' ? <Moon class="h-4 w-4" /> : <Sun class="h-4 w-4" />}
            </TopBarIconButton>
          </div>
        )}
        bottomBarLeading={(
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="redeven-bottom-bar-metric">
              <span class="redeven-bottom-bar-metric__label">{localizedVisibleLabel(i18n(), librarySummary().environment_count)}</span>
            </span>
            <span class="redeven-bottom-bar-metric__sep">·</span>
            <span class="redeven-bottom-bar-metric">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
              <span class="redeven-bottom-bar-metric__label">{localizedWindowsLabel(i18n(), librarySummary().window_count)}</span>
            </span>
            <span class="redeven-bottom-bar-metric__sep">·</span>
            <BottomBarMetric
              count={librarySummary().ready_count}
              label={i18n().t('launcher.ready')}
              tone="success"
            />
            <span class="redeven-bottom-bar-metric__sep">·</span>
            <BottomBarMetric
              count={librarySummary().running_count}
              label={i18n().t('launcher.running')}
              tone="primary"
            />
            <span class="redeven-bottom-bar-metric__sep">·</span>
            <BottomBarMetric
              count={librarySummary().attention_count}
              label={i18n().t('launcher.attention')}
              tone="warning"
            />
          </div>
        )}
        bottomBarTrailing={(
          <div class="flex items-center gap-2 font-sans">
            {/* Issue warning */}
            <Show when={snapshot().issue}>
              <span class="flex items-center gap-1 px-1.5 rounded-full text-[10px] font-medium bg-warning/10 text-warning shrink-0">
                <span class="w-2 h-2 rounded-full border-[1.5px] border-warning bg-warning/10 shrink-0" />
                <span class="truncate max-w-[200px]">{snapshot().issue!.title}</span>
              </span>
            </Show>
            {/* Close / Quit */}
            <BottomBarItem class="cursor-pointer" onClick={() => void closeLauncherOrQuit()}>
              <span class="text-[11px]">{localizedCloseActionLabel(i18n(), snapshot().close_action)}</span>
            </BottomBarItem>
          </div>
        )}
      >
        <Show
          when={snapshot().surface === 'flower_host'}
          fallback={(
            <ConnectEnvironmentSurface
              i18n={i18n()}
              snapshot={snapshot()}
              busyState={busyState()}
              actionProgress={activeActionProgress()}
              activeTab={activeCenterTab()}
              setActiveTab={setActiveCenterTab}
              librarySourceFilter={librarySourceFilter()}
              libraryQuery={libraryQuery()}
              libraryEntries={libraryEntries()}
              gatewaySourceFilter={gatewaySourceFilter()}
              gatewayQuery={gatewayQuery()}
              gatewayEntries={gatewayEntries()}
              setLibrarySourceFilter={setLibrarySourceFilter}
              setLibraryQuery={setLibraryQuery}
              setGatewaySourceFilter={setGatewaySourceFilter}
              setGatewayQuery={setGatewayQuery}
              runEnvironmentCardFactAction={runEnvironmentCardFactAction}
              openLocalEnvironment={openPrimaryLocalEnvironment}
              openSettingsSurface={openSettingsSurface}
              openCreateConnectionDialog={openCreateConnectionDialog}
              openCreateGatewaySetup={openCreateGatewaySetup}
              pairGateway={pairGateway}
              runGatewayRuntimeAction={runGatewayRuntimeAction}
              openCreateControlPlaneDialog={openCreateControlPlaneDialog}
              refreshAllEnvironmentRuntimes={refreshAllEnvironmentRuntimes}
              openRemoteEnvironment={openRemoteEnvironment}
              openSSHEnvironment={openSSHEnvironment}
              openEnvironment={openEnvironment}
              runLocalEnvironmentAction={triggerLocalEnvironmentAction}
              refreshEnvironmentRuntime={refreshEnvironmentRuntime}
              openEnvironmentFlowerComposer={openEnvironmentFlowerComposer}
              runEnvironmentGuidanceAction={runEnvironmentGuidanceAction}
              runDesktopUpdateHandoff={async (environmentID, label) => {
                const result = await performLauncherAction({
                  kind: 'manage_desktop_update',
                  environment_id: environmentID,
                  label,
                });
                if (result?.outcome === 'opened_desktop_update_handoff') {
                  showActionToast(i18n().t('environmentCenter.desktopUpdateOpenedToast', { label: label || i18n().t('environmentCenter.thisEnvironment') }), 'info');
                }
              }}
              toggleEnvironmentPinned={toggleEnvironmentPinned}
              copyEnvironmentValue={copyEnvironmentValue}
              editEnvironment={startEditingEnvironment}
              deleteEnvironment={setDeleteTarget}
              cancelOperation={(progress) => {
                void cancelLauncherOperation(progress);
              }}
              dismissOperation={(progress) => {
                void dismissLauncherOperation(progress);
              }}
              copyOperationDiagnostics={(progress) => {
                void copyLauncherOperationDiagnostics(progress);
              }}
              controlPlanes={controlPlanes()}
              gatewaySources={snapshot().gateway_sources}
              viewControlPlaneEnvironments={focusProviderEnvironments}
              reconnectControlPlane={reconnectControlPlane}
              refreshControlPlane={refreshControlPlane}
              deleteControlPlane={setDeleteControlPlaneTarget}
              environmentFailures={environmentFailures()}
              dismissEnvironmentFailure={(environmentID: string) => {
                setEnvironmentFailures((current) => {
                  const next = new Map(current);
                  next.delete(environmentID);
                  return next;
                });
              }}
            />
          )}
        >
          <FlowerSurface
            adapter={createDesktopFlowerSurfaceAdapter(props.runtime.settings, {
              hostDisplayName: i18n().t('flowerSurface.host.thisHost'),
              hostSubtitle: i18n().t('flowerSurface.host.subtitle'),
              threadSourceLabel: i18n().t('flowerSurface.host.thisHost'),
            })}
            copy={createDesktopFlowerSurfaceCopy(i18n())}
            focusThreadID={focusedFlowerThreadID()}
          />
        </Show>
      </DesktopLauncherShell>

      <EnvironmentFlowerComposerWindow
        i18n={i18n()}
        state={environmentFlowerComposer()}
        onClose={closeEnvironmentFlowerComposer}
        resolveFlowerHandler={resolveEnvironmentFlowerHandler}
        sendFlowerPrompt={sendEnvironmentFlowerPrompt}
        openFlowerHostSurface={async () => {
          closeEnvironmentFlowerComposer();
          await openFlowerHostSurface();
        }}
      />

      <DesktopActionToastViewport
        i18n={i18n()}
        toasts={actionToasts()}
        dismissToast={dismissActionToast}
        runToastAction={runActionToastAction}
      />

      <LocalEnvironmentSettingsDialog
        open={snapshot().surface === 'environment_settings'}
        snapshot={settingsSurface()}
        baselineSnapshot={settingsBaselineSurface()}
        draft={draft()}
        languageSnapshot={languageSnapshot()}
        i18n={i18n()}
        busyState={busyState()}
        settingsError={settingsError()}
        settingsErrorRef={(value) => {
          settingsErrorRef = value;
        }}
        updateDraftField={updateDraftField}
        applyAccessMode={applyAccessMode}
        applyAccessFixedPort={applyAccessFixedPort}
        toggleAutoPort={toggleAutoPort}
        saveSettings={saveSettings}
        cancelSettings={cancelSettings}
        clearStoredLocalUIPassword={clearStoredLocalUIPassword}
        updateLanguagePreference={updateDesktopLanguagePreference}
      />

      <DesktopInterfaceSettingsDialog
        open={languageSettingsOpen()}
        languageSnapshot={languageSnapshot()}
        i18n={i18n()}
        onOpenChange={setLanguageSettingsOpen}
        updateLanguagePreference={updateDesktopLanguagePreference}
      />

      <ConnectionDialog
        i18n={i18n()}
        state={connectionDialogState()}
        sshConfigHosts={sshConfigHosts()}
        containerOptions={runtimeContainerOptions()}
        containerOptionsLoading={runtimeContainerOptionsLoading()}
        containerOptionsError={runtimeContainerOptionsError()}
        error={connectionDialogError()}
        fieldErrors={connectionDialogFieldErrors()}
        busyState={busyState()}
        onOpenChange={(open) => {
          if (!open) {
            closeConnectionDialog();
          }
        }}
        updateField={updateConnectionDialogField}
        toggleAutoRuntimeProbe={toggleConnectionRuntimeAutoProbe}
        refreshContainerOptions={() => {
          void refreshRuntimeContainerOptions(true);
        }}
        switchKind={switchConnectionDialogKind}
        switchBootstrapStrategy={switchSSHBootstrapStrategy}
        removeSSHPassword={removeSSHPasswordFromConnectionDialog}
        clearFieldErrors={() => setConnectionDialogFieldErrors({})}
        onSave={saveConnectionFromDialog}
      />

      <GatewaySetupDialog
        i18n={i18n()}
        state={gatewaySetupDialogState()}
        sshConfigHosts={sshConfigHosts()}
        containerOptions={runtimeContainerOptions()}
        containerOptionsLoading={runtimeContainerOptionsLoading()}
        containerOptionsError={runtimeContainerOptionsError()}
        error={gatewaySetupDialogError()}
        fieldErrors={gatewaySetupDialogFieldErrors()}
        busyState={busyState()}
        onOpenChange={(open) => {
          if (!open) {
            closeGatewaySetupDialog();
          }
        }}
        updateField={updateGatewaySetupDialogField}
        refreshContainerOptions={() => {
          void refreshRuntimeContainerOptions(true);
        }}
        clearFieldErrors={() => setGatewaySetupDialogFieldErrors({})}
        removeSSHPassword={removeSSHPasswordFromGatewaySetupDialog}
        onSave={saveGatewayFromDialog}
      />

      <ControlPlaneDialog
        i18n={i18n()}
        state={controlPlaneDialogState()}
        error={controlPlaneDialogError()}
        busyState={busyState()}
        onOpenChange={(open) => {
          if (!open) {
            closeControlPlaneDialog();
          }
        }}
        updateField={updateControlPlaneDialogField}
        onConnect={connectControlPlaneFromDialog}
      />

      <ConfirmDialog
        open={deleteTarget() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title={i18n().t('confirm.deleteConnectionTitle')}
        confirmText={i18n().t('confirm.deleteConnectionConfirm')}
        variant="destructive"
        loading={busyStateMatchesAction(busyState(), 'delete_environment')}
        onConfirm={() => void deleteEnvironment()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            {i18n().t('confirm.deleteConnectionQuestion', { label: deleteTarget()?.label ?? '' })}
          </p>
          <p class="text-xs text-muted-foreground">
            <Show
              when={deleteTargetOperation()}
              fallback={<>{i18n().t('confirm.deleteConnectionDescription')}</>}
            >
              <>{i18n().t('confirm.deleteConnectionBusyDescription')}</>
            </Show>
          </p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteControlPlaneTarget() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteControlPlaneTarget(null);
          }
        }}
        title={i18n().t('confirm.removeProviderTitle')}
        confirmText={i18n().t('confirm.removeProviderConfirm')}
        variant="destructive"
        loading={busyStateMatchesAction(busyState(), 'delete_control_plane')}
        onConfirm={() => void deleteControlPlane()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            {i18n().t('confirm.removeProviderQuestion', { label: deleteControlPlaneTarget() ? controlPlaneName(deleteControlPlaneTarget()!) : '' })}
          </p>
          <p class="text-xs text-muted-foreground">{i18n().t('confirm.removeProviderDescription')}</p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={gatewayStartRequiredDialog() !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeGatewayStartRequiredDialog();
          }
        }}
        title={gatewayStartRequiredTitle(gatewayStartRequiredDialog())}
        confirmText={gatewayStartRequiredConfirmText(gatewayStartRequiredDialog())}
        loading={busyStateMatchesAction(busyState(), gatewayStartRequiredDialog()?.retry_action.kind ?? '')}
        onConfirm={() => void confirmGatewayStartRequiredDialog()}
      >
        <div class="space-y-3">
          <p class="text-sm">
            {gatewayStartRequiredMessage(gatewayStartRequiredDialog())}
          </p>
          <div class="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {gatewayStartRequiredNextStep(gatewayStartRequiredDialog())}
          </div>
          <Show when={gatewayStartRequiredDialog()?.runtime_state}>
            {(runtimeState) => (
              <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <div class="font-medium text-foreground">{gatewayRuntimeStateLabel(runtimeState().status)}</div>
                <Show when={runtimeState().message}>
                  {(message) => <div class="mt-1">{message()}</div>}
                </Show>
                <Show when={runtimeState().runtime_state_root}>
                  {(stateRoot) => <div class="mt-1 font-mono text-[11px]">{stateRoot()}</div>}
                </Show>
              </div>
            )}
          </Show>
        </div>
      </ConfirmDialog>

      <Dialog
        open={providerRuntimeLinkDialogOpen()}
        onOpenChange={(open) => {
          if (!open) {
            closeProviderRuntimeLinkConfirmation();
          }
        }}
        title={providerRuntimeLinkActionLabel()}
        footer={(
          <div class="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => closeProviderRuntimeLinkConfirmation()}
              disabled={providerRuntimeLinkBusy()}
            >
              {i18n().t('common.cancel')}
            </Button>
            <Button
              variant={providerRuntimeLinkConfirmation()?.action === 'disconnect' ? 'destructive' : 'primary'}
              onClick={() => void confirmProviderRuntimeLinkAction()}
              loading={providerRuntimeLinkBusy()}
              disabled={providerRuntimeLinkConfirmDisabled()}
            >
              {providerRuntimeLinkActionLabel()}
            </Button>
          </div>
        )}
      >
        <div class="space-y-2">
          <p class="text-sm">
            <Show
              when={providerRuntimeLinkConfirmation()?.action === 'disconnect'}
              fallback={(
                <>{i18n().t('environmentCenter.connectProviderQuestion', { label: providerRuntimeLinkConfirmation()?.environment.label ?? '' })}</>
              )}
            >
              {i18n().t('environmentCenter.disconnectProviderQuestion', { label: providerRuntimeLinkConfirmation()?.environment.label ?? '' })}
            </Show>
          </p>
          <Show when={providerRuntimeLinkConfirmation()?.action === 'connect'}>
            <div class="space-y-1">
              <p class="text-xs font-medium text-muted-foreground">{i18n().t('environmentCenter.providerEnvironment')}</p>
              <div class="space-y-1">
                <For each={providerRuntimeLinkCandidatePlans()}>
                  {(item) => (
                    <label
                      class={cn(
                        'flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm',
                        item.canConnect
                          ? 'cursor-pointer hover:bg-muted/60'
                          : 'cursor-not-allowed bg-muted/30 opacity-70',
                      )}
                    >
                      <span>
                        <span class="block font-medium">{item.candidate.label}</span>
                        <span class="block text-xs text-muted-foreground">{item.candidate.provider_label || item.candidate.provider_origin} · {item.candidate.env_public_id}</span>
                        <Show when={!item.canConnect}>
                          <span class="block text-xs text-muted-foreground">{item.message}</span>
                        </Show>
                      </span>
                      <input
                        type="radio"
                        name="provider-runtime-link-target"
                        disabled={!item.canConnect}
                        checked={providerRuntimeLinkProviderEnvironmentID() === item.candidate.provider_environment_id}
                        onChange={() => {
                          if (item.canConnect) {
                            setProviderRuntimeLinkProviderEnvironmentID(item.candidate.provider_environment_id);
                          }
                        }}
                      />
                    </label>
                  )}
                </For>
              </div>
            </div>
          </Show>
          <Show when={providerRuntimeLinkConfirmation()?.action === 'disconnect'}>
            <p class="text-xs text-muted-foreground">
              {i18n().t('desktop.provider')}: <span class="font-medium text-foreground">{providerRuntimeLinkConfirmation()?.environment.provider_runtime_link_target?.provider_origin || i18n().t('environmentCenter.unknownProvider')}</span>
            </p>
            <p class="text-xs text-muted-foreground">
              {i18n().t('environmentCenter.sourceEnvironment')}: <span class="font-mono text-foreground">{providerRuntimeLinkConfirmation()?.environment.provider_runtime_link_target?.env_public_id || 'unknown'}</span>
            </p>
          </Show>
          <Show
            when={providerRuntimeLinkConfirmation()?.action === 'disconnect'}
            fallback={(
              <p class="text-xs text-muted-foreground">
                {i18n().t('environmentCenter.connectProviderRuntimeNote')}
              </p>
            )}
          >
            <p class="text-xs text-muted-foreground">
              {i18n().t('environmentCenter.disconnectProviderRuntimeNote')}
            </p>
          </Show>
          <Show when={providerRuntimeLinkConfirmation()?.action === 'disconnect'}>
            <p class="text-xs text-muted-foreground">
              {i18n().t('environmentCenter.activeWork')}: <span class="font-medium text-foreground">{providerRuntimeLinkActiveWorkLabel()}</span>
            </p>
          </Show>
        </div>
      </Dialog>
    </>
  );
}

function DesktopActionToastViewport(props: Readonly<{
  i18n: DesktopI18n;
  toasts: readonly DesktopActionToast[];
  dismissToast: (toastID: number) => void;
  runToastAction: (action: DesktopActionToastAction, toastID: number) => void;
}>) {
  const toastTitle = (toast: DesktopActionToast): string => {
    if (toast.title) {
      return localizedOverlayTitle(props.i18n, toast.title);
    }
    switch (toast.tone) {
      case 'success':
        return props.i18n.t('toast.updated');
      case 'info':
        return props.i18n.t('toast.notice');
      case 'warning':
        return props.i18n.t('toast.needsAttention');
      default:
        return props.i18n.t('toast.couldNotComplete');
    }
  };
  return (
    <Portal>
      <Show when={props.toasts.length > 0}>
        <div class="redeven-desktop-toast-viewport" aria-live="polite" aria-atomic="true">
          <Presence>
            <For each={props.toasts}>
              {(toast) => {
                const [copied, setCopied] = createSignal(false);
                const toastCopyText = createMemo(() => {
                  return `${toastTitle(toast)}: ${toast.message}`;
                });
                let copyResetHandle: number | undefined;
                const handleCopy = () => {
                  void copyToClipboard(toastCopyText()).then(() => {
                    setCopied(true);
                    window.clearTimeout(copyResetHandle);
                    copyResetHandle = window.setTimeout(() => setCopied(false), 1800);
                  });
                };
                onCleanup(() => window.clearTimeout(copyResetHandle));
                return (
                <Motion.div
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={{ duration: 0.25 }}
                >
                  <div class="redeven-desktop-toast" data-tone={toast.tone} role={toast.tone === 'error' ? 'alert' : 'status'}>
                    <div class="redeven-desktop-toast__icon" aria-hidden="true">
                      {toast.tone === 'success'
                        ? <Check class="h-3.5 w-3.5" />
                        : <AlertCircle class="h-3.5 w-3.5" />}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="redeven-desktop-toast__title">
                        {toastTitle(toast)}
                      </div>
                      <div class="redeven-desktop-toast__message">{toast.message}</div>
                      <Show when={toast.action}>
                        {(action) => (
                          <button
                            type="button"
                            class="redeven-desktop-toast__action"
                            onClick={() => props.runToastAction(action(), toast.id)}
                          >
                            {action().label}
                          </button>
                        )}
                      </Show>
                    </div>
                    <button
                      type="button"
                      class="redeven-desktop-toast__copy"
                      aria-label={props.i18n.t('toast.copyMessage')}
                      title={props.i18n.t('toast.copyMessage')}
                      onClick={handleCopy}
                    >
                      <Show when={!copied()} fallback={<Check class="h-3 w-3" />}>
                        <Copy class="h-3 w-3" />
                      </Show>
                    </button>
                    <button
                      type="button"
                      class="redeven-desktop-toast__dismiss"
                      onClick={() => props.dismissToast(toast.id)}
                    >
                      {props.i18n.t('environmentCenter.dismissToast')}
                    </button>
                  </div>
                </Motion.div>
                );
              }}
            </For>
          </Presence>
        </div>
      </Show>
    </Portal>
  );
}

function ConnectEnvironmentSurface(props: Readonly<{
  i18n: DesktopI18n;
  snapshot: DesktopWelcomeSnapshot;
  busyState: DesktopLauncherBusyState;
  actionProgress: readonly DesktopLauncherActionProgress[];
  activeTab: EnvironmentCenterTab;
  setActiveTab: (value: EnvironmentCenterTab) => void;
  librarySourceFilter: string;
  libraryQuery: string;
  libraryEntries: readonly DesktopEnvironmentEntry[];
  gatewaySourceFilter: string;
  gatewayQuery: string;
  gatewayEntries: readonly DesktopEnvironmentEntry[];
  setLibrarySourceFilter: (value: string) => void;
  setLibraryQuery: (value: string) => void;
  setGatewaySourceFilter: (value: string) => void;
  setGatewayQuery: (value: string) => void;
  runEnvironmentCardFactAction: (action: EnvironmentCardFactActionModel) => void;
  openLocalEnvironment: () => Promise<void>;
  openSettingsSurface: (environmentID?: string) => void;
  openCreateConnectionDialog: (message?: string, preferredKind?: ConnectionDialogKind) => void;
  openCreateGatewaySetup: (gateway?: DesktopGatewaySource) => void;
  pairGateway: (gatewayID: string, startPolicy?: DesktopGatewayStartPolicy) => Promise<void>;
  runGatewayRuntimeAction: (
    gatewayID: string,
    kind: GatewayRuntimeActionKind,
    startPolicy?: GatewayRuntimeStartPolicy,
  ) => Promise<void>;
  openCreateControlPlaneDialog: (message?: string) => void;
  refreshAllEnvironmentRuntimes: () => Promise<void>;
  openRemoteEnvironment: (
    targetURL: string,
    errorTarget?: 'connect' | 'dialog',
    environment?: DesktopEnvironmentEntry,
  ) => Promise<boolean>;
  openSSHEnvironment: (
    details: DesktopSSHEnvironmentDetails,
    errorTarget?: 'connect' | 'dialog',
    environment?: DesktopEnvironmentEntry,
  ) => Promise<boolean>;
  openEnvironment: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog',
    route?: 'auto' | DesktopLocalEnvironmentStateRoute,
  ) => Promise<boolean>;
  runLocalEnvironmentAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  refreshEnvironmentRuntime: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  openEnvironmentFlowerComposer: (environment: DesktopEnvironmentEntry, anchor?: { x: number; y: number }) => void;
  runEnvironmentGuidanceAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
  ) => Promise<EnvironmentGuidanceActionResolution>;
  runDesktopUpdateHandoff: (environmentID: string, label?: string) => Promise<void>;
  toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  controlPlanes: readonly DesktopControlPlaneSummary[];
  gatewaySources: readonly DesktopGatewaySource[];
  viewControlPlaneEnvironments: (controlPlane: DesktopControlPlaneSummary) => void;
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  deleteControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
  environmentFailures: ReadonlyMap<string, EnvironmentFailureState>;
  dismissEnvironmentFailure: (environmentID: string) => void;
}>) {
  const visibleEnvironmentCount = createMemo(() => (
    environmentLibraryCount(
      props.snapshot,
      props.libraryQuery,
      props.librarySourceFilter,
    )
  ));
  const localSourceCount = createMemo(() => (
    environmentLibraryCount(props.snapshot, '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const providerSourceCount = createMemo(() => (
    environmentLibraryCount(props.snapshot, '', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const gatewaySourceCount = createMemo(() => (
    environmentLibraryCount(props.snapshot, '', GATEWAY_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const urlSourceCount = createMemo(() => (
    environmentLibraryCount(props.snapshot, '', URL_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const sshSourceCount = createMemo(() => (
    environmentLibraryCount(props.snapshot, '', SSH_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const sourceFilterOptions = createMemo(() => {
    const options: Array<Readonly<{ value: string; label: string; count: number }>> = [];
    if (localSourceCount() > 0) {
      options.push({
        value: LOCAL_ENVIRONMENT_LIBRARY_FILTER,
        label: props.i18n.t('environmentCenter.localFilter'),
        count: localSourceCount(),
      });
    }
    if (providerSourceCount() > 0) {
      options.push({
        value: PROVIDER_ENVIRONMENT_LIBRARY_FILTER,
        label: props.i18n.t('environmentCenter.providerFilter'),
        count: providerSourceCount(),
      });
    }
    if (gatewaySourceCount() > 0) {
      options.push({
        value: GATEWAY_ENVIRONMENT_LIBRARY_FILTER,
        label: props.i18n.t('environmentCenter.gatewayFilter'),
        count: gatewaySourceCount(),
      });
    }
    if (urlSourceCount() > 0) {
      options.push({
        value: URL_ENVIRONMENT_LIBRARY_FILTER,
        label: props.i18n.t('environmentCenter.redevenUrlFilter'),
        count: urlSourceCount(),
      });
    }
    if (sshSourceCount() > 0) {
      options.push({
        value: SSH_ENVIRONMENT_LIBRARY_FILTER,
        label: props.i18n.t('environmentCenter.sshHostFilter'),
        count: sshSourceCount(),
      });
    }
    return options;
  });
  const activeRuntimeTargetFilterLabel = createMemo(() => {
    const runtimeTargetID = runtimeTargetEnvironmentLibraryFilterTargetID(props.librarySourceFilter);
    if (!runtimeTargetID) {
      return '';
    }
    const environment = props.snapshot.environments.find((entry) => (
      entry.provider_runtime_link_target?.id === runtimeTargetID
    ));
    return environment
      ? props.i18n.t('environmentCenter.linkedRuntimeFilterWithLabel', { label: environment.label })
      : props.i18n.t('environmentCenter.linkedRuntimeFilter');
  });
  const activeNonCategoryFilterChipLabel = createMemo(() => {
    const runtimeLabel = activeRuntimeTargetFilterLabel();
    if (runtimeLabel) return runtimeLabel;
    const matchedControlPlane = props.controlPlanes.find(
      (cp) => controlPlaneFilterValue(cp) === props.librarySourceFilter,
    );
    return matchedControlPlane?.display_label ?? '';
  });
  const controlPlaneEnvironmentCount = createMemo(() => (
    props.controlPlanes.reduce((total, controlPlane) => total + controlPlane.environments.length, 0)
  ));
  const visibleGatewayEnvironmentCount = createMemo(() => (
    gatewayEnvironmentCount(props.snapshot, props.gatewayQuery, props.gatewaySourceFilter)
  ));
  const totalGatewayEnvironmentCount = createMemo(() => (
    gatewayEnvironmentCount(props.snapshot, '', '')
  ));
  const gatewayFilterOptions = createMemo(() => gatewaySourceFilterOptions(props.snapshot));
  const showQuickAddCards = createMemo(() => (
    trimString(props.libraryQuery) === ''
    && trimString(props.librarySourceFilter) === ''
  ));
  const layoutReferenceEnvironmentCount = createMemo(() => (
    environmentLibraryCount(
      props.snapshot,
      '',
      '',
    )
  ));
  const visibleEnvironmentCardCount = createMemo(() => (
    props.libraryEntries.length + (showQuickAddCards() ? 1 : 0)
  ));
  const layoutReferenceEnvironmentCardCount = createMemo(() => (
    layoutReferenceEnvironmentCount() + 1
  ));
  const useSpaciousEnvironmentLibraryLayout = createMemo(() => (
    props.activeTab === 'environments'
    && shouldUseSpaciousEnvironmentGrid(layoutReferenceEnvironmentCardCount())
  ));
  const useSpaciousControlPlaneLayout = createMemo(() => (
    props.activeTab === 'control_planes' && props.controlPlanes.length > 0
  ));
  const useSpaciousGatewayLayout = createMemo(() => (
    props.activeTab === 'gateways' && props.gatewaySources.length > 0
  ));
  const useSpaciousWelcomeShell = createMemo(() => (
    useSpaciousEnvironmentLibraryLayout() || useSpaciousControlPlaneLayout() || useSpaciousGatewayLayout()
  ));

  return (
    <div class="redeven-welcome-surface h-full min-h-0 w-full min-w-0 overflow-auto bg-background">
      <main id="redeven-desktop-main" class="w-full px-4 py-5 sm:px-6 lg:px-8">
        <div class={cn(
          'mx-auto w-full redeven-welcome-shell',
          useSpaciousWelcomeShell() && 'redeven-welcome-shell--spacious',
        )}
        >
          <header class="redeven-header-separator mb-5 space-y-4">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div class="space-y-1">
                <h1 class="text-lg font-semibold tracking-tight text-foreground">{props.i18n.t('environmentCenter.title')}</h1>
                <p class="text-xs text-muted-foreground">
                  {props.i18n.t('environmentCenter.description')}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <Show when={props.activeTab === 'environments' || props.activeTab === 'gateways'}>
                  <div class="relative w-full sm:w-[14.5rem]">
                    <Search class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Show
                      when={props.activeTab === 'gateways'}
                      fallback={(
                        <Input
                          value={props.libraryQuery}
                          onInput={(event) => props.setLibraryQuery(event.currentTarget.value)}
                          placeholder={props.i18n.t('environmentCenter.searchPlaceholder')}
                          size="sm"
                          class="w-full pl-9"
                        />
                      )}
                    >
                      <Input
                        value={props.gatewayQuery}
                        onInput={(event) => props.setGatewayQuery(event.currentTarget.value)}
                        placeholder={props.i18n.t('environmentCenter.gatewaySearchPlaceholder')}
                        size="sm"
                        class="w-full pl-9"
                      />
                    </Show>
                  </div>
                </Show>
                <Show when={props.activeTab === 'environments'}>
                  <DesktopTooltip content={props.i18n.t('environmentCenter.refreshRuntimeStatuses')} placement="top">
                    <span>
                      <Button
                        size="sm"
                        variant="outline"
                        class="px-2.5"
                        disabled={busyStateMatchesAction(props.busyState, 'refresh_all_environment_runtimes')}
                        onClick={() => {
                          void props.refreshAllEnvironmentRuntimes();
                        }}
                      >
                        <Refresh class="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </DesktopTooltip>
                </Show>
                <Show when={props.activeTab === 'environments'}>
                  <Button size="sm" variant="default" onClick={() => props.openCreateConnectionDialog()}>
                    <Plus class="mr-1 h-3.5 w-3.5" />
                    {props.i18n.t('environmentCenter.newEnvironmentShort')}
                  </Button>
                </Show>
                <Show when={props.activeTab === 'control_planes'}>
                  <Button size="sm" variant="default" onClick={() => props.openCreateControlPlaneDialog()}>
                    <Plus class="mr-1 h-3.5 w-3.5" />
                    {props.i18n.t('environmentCenter.connectProvider')}
                  </Button>
                </Show>
                <Show when={props.activeTab === 'gateways'}>
                  <Button size="sm" variant="default" onClick={() => props.openCreateGatewaySetup()}>
                    <Plus class="mr-1 h-3.5 w-3.5" />
                    {props.i18n.t('environmentCenter.addGateway')}
                  </Button>
                </Show>
              </div>
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex flex-wrap items-center gap-1.5">
                <For each={ENVIRONMENT_CENTER_TABS}>
                  {(tab) => (
                    <button
                      type="button"
                      class="redeven-console-tab"
                      data-active={props.activeTab === tab.value}
                      aria-pressed={props.activeTab === tab.value}
                      onClick={() => props.setActiveTab(tab.value)}
                  >
                      {props.i18n.t(tab.labelKey)}
                    </button>
                  )}
                </For>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Show when={props.activeTab === 'environments'}>
                  <>
                    <button
                      type="button"
                      class="redeven-provider-pill"
                      data-active={props.librarySourceFilter === ''}
                      aria-pressed={props.librarySourceFilter === ''}
                      onClick={() => props.setLibrarySourceFilter('')}
                    >
                      {props.i18n.t('environmentCenter.allFilter')} ({layoutReferenceEnvironmentCount()})
                    </button>
                    <For each={sourceFilterOptions()}>
                      {(option) => (
                        <button
                          type="button"
                          class="redeven-provider-pill"
                          data-active={props.librarySourceFilter === option.value}
                          aria-pressed={props.librarySourceFilter === option.value}
                          onClick={() => props.setLibrarySourceFilter(option.value)}
                        >
                          {option.label} ({option.count})
                        </button>
                      )}
                    </For>
                    <Show when={activeNonCategoryFilterChipLabel() !== ''}>
                      <button
                        type="button"
                        class="redeven-runtime-chip"
                        data-active="true"
                        aria-pressed="true"
                        onClick={() => props.setLibrarySourceFilter('')}
                      >
                        <X class="h-3 w-3" />
                        {activeNonCategoryFilterChipLabel()}
                      </button>
                    </Show>
                    <div class="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                      <span>{props.i18n.t('environmentCenter.shownCount', { count: visibleEnvironmentCount() })}</span>
                      <Show when={props.snapshot.open_windows.length > 0}>
                        <span class="text-border">·</span>
                        <span>{props.i18n.t('environmentCenter.liveCount', { count: props.snapshot.open_windows.length })}</span>
                      </Show>
                    </div>
                  </>
                </Show>
                <Show when={props.activeTab === 'control_planes'}>
                  <div class="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{props.i18n.t('environmentCenter.providersCount', { count: props.controlPlanes.length })}</span>
                    <span class="text-border">·</span>
                    <span>{props.i18n.t('environmentCenter.environmentsCount', { count: controlPlaneEnvironmentCount() })}</span>
                  </div>
                </Show>
                <Show when={props.activeTab === 'gateways'}>
                  <>
                    <button
                      type="button"
                      class="redeven-provider-pill"
                      data-active={props.gatewaySourceFilter === ''}
                      aria-pressed={props.gatewaySourceFilter === ''}
                      onClick={() => props.setGatewaySourceFilter('')}
                    >
                      {props.i18n.t('environmentCenter.allFilter')} ({totalGatewayEnvironmentCount()})
                    </button>
                    <For each={gatewayFilterOptions()}>
                      {(option) => (
                        <button
                          type="button"
                          class="redeven-provider-pill"
                          data-active={props.gatewaySourceFilter === option.value}
                          aria-pressed={props.gatewaySourceFilter === option.value}
                          onClick={() => props.setGatewaySourceFilter(option.value)}
                        >
                          {option.label} ({option.count})
                        </button>
                      )}
                    </For>
                    <div class="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                      <span>{props.i18n.t('environmentCenter.gatewaysCount', { count: props.gatewaySources.length })}</span>
                      <span class="text-border">·</span>
                      <span>{props.i18n.t('environmentCenter.shownCount', { count: visibleGatewayEnvironmentCount() })}</span>
                    </div>
                  </>
                </Show>
              </div>
            </div>
          </header>

          <div class="space-y-3">
            <Show when={props.activeTab === 'environments'}>
              <EnvironmentCardsPanel
                i18n={props.i18n}
                entries={props.libraryEntries}
                showQuickAddCards={showQuickAddCards()}
                visibleCardCount={visibleEnvironmentCardCount()}
                layoutReferenceCardCount={layoutReferenceEnvironmentCardCount()}
                busyState={props.busyState}
                actionProgress={props.actionProgress}
                openCreateConnectionDialog={props.openCreateConnectionDialog}
                openEnvironment={props.openEnvironment}
                runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                refreshEnvironmentRuntime={props.refreshEnvironmentRuntime}
                openEnvironmentFlowerComposer={props.openEnvironmentFlowerComposer}
                runEnvironmentGuidanceAction={props.runEnvironmentGuidanceAction}
                runDesktopUpdateHandoff={props.runDesktopUpdateHandoff}
                runEnvironmentCardFactAction={props.runEnvironmentCardFactAction}
                toggleEnvironmentPinned={props.toggleEnvironmentPinned}
                copyEnvironmentValue={props.copyEnvironmentValue}
                editEnvironment={props.editEnvironment}
                deleteEnvironment={props.deleteEnvironment}
                cancelOperation={props.cancelOperation}
                dismissOperation={props.dismissOperation}
                copyOperationDiagnostics={props.copyOperationDiagnostics}
                environmentFailures={props.environmentFailures}
                dismissEnvironmentFailure={props.dismissEnvironmentFailure}
              />
            </Show>
            <Show when={props.activeTab === 'control_planes'}>
              <ControlPlanesPanel
                i18n={props.i18n}
                controlPlanes={props.controlPlanes}
                busyState={props.busyState}
                openCreateControlPlaneDialog={props.openCreateControlPlaneDialog}
                environments={props.snapshot.environments}
                viewControlPlaneEnvironments={props.viewControlPlaneEnvironments}
                reconnectControlPlane={props.reconnectControlPlane}
                refreshControlPlane={props.refreshControlPlane}
                deleteControlPlane={props.deleteControlPlane}
              />
            </Show>
            <Show when={props.activeTab === 'gateways'}>
              <GatewaySourcesPanel
                i18n={props.i18n}
                gatewaySources={props.gatewaySources}
                gatewayEntries={props.gatewayEntries}
                busyState={props.busyState}
                actionProgress={props.actionProgress}
                gatewaySourceFilter={props.gatewaySourceFilter}
                gatewayQuery={props.gatewayQuery}
                openCreateGatewaySetup={props.openCreateGatewaySetup}
                pairGateway={props.pairGateway}
                runGatewayRuntimeAction={props.runGatewayRuntimeAction}
                runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                cancelOperation={props.cancelOperation}
                dismissOperation={props.dismissOperation}
                copyOperationDiagnostics={props.copyOperationDiagnostics}
              />
            </Show>
          </div>
        </div>
      </main>
    </div>
  );
}

function EnvironmentCardsPanel(props: Readonly<{
  i18n: DesktopI18n;
  entries: readonly DesktopEnvironmentEntry[];
  showQuickAddCards: boolean;
  visibleCardCount: number;
  layoutReferenceCardCount: number;
  busyState: DesktopLauncherBusyState;
  actionProgress: readonly DesktopLauncherActionProgress[];
  openCreateConnectionDialog: (message?: string, preferredKind?: ConnectionDialogKind) => void;
  openEnvironment: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog',
    route?: 'auto' | DesktopLocalEnvironmentStateRoute,
  ) => Promise<boolean>;
  runLocalEnvironmentAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  refreshEnvironmentRuntime: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  openEnvironmentFlowerComposer: (environment: DesktopEnvironmentEntry, anchor?: { x: number; y: number }) => void;
  runEnvironmentGuidanceAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
  ) => Promise<EnvironmentGuidanceActionResolution>;
  runDesktopUpdateHandoff: (environmentID: string, label?: string) => Promise<void>;
  runEnvironmentCardFactAction: (action: EnvironmentCardFactActionModel) => void;
  toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  environmentFailures: ReadonlyMap<string, EnvironmentFailureState>;
  dismissEnvironmentFailure: (environmentID: string) => void;
}>) {
  const [environmentLibraryElement, setEnvironmentLibraryElement] = createSignal<HTMLDivElement>();
  const [environmentLibraryWidthPx, setEnvironmentLibraryWidthPx] = createSignal(0);
  const [rootFontSizePx, setRootFontSizePx] = createSignal(16);
  const [activeEnvironmentOverlayState, setActiveEnvironmentOverlayState] = createSignal(closedEnvironmentLibraryOverlayState());
  const [guidanceSessionState, setGuidanceSessionState] = createSignal<EnvironmentGuidanceSessionState>(null);
  const [lifecycleDisclosureState, setLifecycleDisclosureState] = createSignal<EnvironmentLifecycleDisclosureState>(null);
  // Render cards by stable environment id so snapshot refreshes update data in place instead of remounting the card subtree.
  const projectedEntriesByID = createMemo(() => environmentLibraryEntryRecord(props.entries));
  const projectedEntryIDs = createMemo<readonly string[]>(() => props.entries.map((entry) => entry.id));
  const groupedEntryIDs = createMemo(() => splitPinnedEnvironmentEntryIDs(projectedEntryIDs(), projectedEntriesByID()));
  // Keep transient provider/search filters from collapsing the shared environment column system.
  const layoutModel = createMemo(() => buildEnvironmentLibraryLayoutModel({
    visible_card_count: props.visibleCardCount,
    layout_reference_count: props.layoutReferenceCardCount,
    container_width_px: environmentLibraryWidthPx(),
    root_font_size_px: rootFontSizePx(),
  }));
  const environmentGridStyle = createMemo<JSX.CSSProperties>(() => ({
    '--redeven-environment-grid-columns': String(layoutModel().column_count),
  }));

  createEffect(() => {
    setLifecycleDisclosureState((current) => (
      reconcileEnvironmentLifecycleDisclosure(current, props.entries, props.actionProgress)
    ));
  });

  createEffect(() => {
    setActiveEnvironmentOverlayState((current) => {
      const session = guidanceSessionState();
      const lifecycleDisclosure = lifecycleDisclosureState();
      if (current.kind === 'lifecycle_progress') {
        const environment = props.entries.find((entry) => entry.id === current.environment_id);
        const progressStillVisible = environment
          ? selectedSnapshotOpenConnectionProgressForEnvironment(environment, props.actionProgress) !== null
            || selectedSnapshotRuntimeLifecycleProgressForEnvironment(environment, props.actionProgress) !== null
          : false;
        const pendingDisclosureVisible = lifecycleDisclosure?.environment_id === current.environment_id
          && lifecycleDisclosure.visibility === 'open'
          && (
            lifecycleDisclosure.last_progress !== undefined
            || environmentLifecycleDisclosureHasPendingRequest(lifecycleDisclosure, props.busyState)
          );
        return (
          pendingDisclosureVisible
          || progressStillVisible
          ? current
          : closedEnvironmentLibraryOverlayState()
        );
      }
      if (
        current.kind === 'primary_action_guidance'
        && session?.environment_id === current.environment_id
        && guidanceSessionKeepsPopoverOpen(session)
      ) {
        return current;
      }
      return reconcileEnvironmentLibraryOverlayState(current, props.entries);
    });
    setGuidanceSessionState((current) => reconcileEnvironmentGuidanceSession(current, props.entries));
  });

  createEffect(() => {
    const session = guidanceSessionState();
    if (!guidanceSessionShouldAutoDismiss(session) || typeof window === 'undefined') {
      return;
    }
    let clearHandle: number | undefined;
    const handle = window.setTimeout(() => {
      setActiveEnvironmentOverlayState((current) => (
        session
          ? closeEnvironmentLibraryOverlayState(current, 'primary_action_guidance', session.environment_id)
          : current
      ));
      clearHandle = window.setTimeout(() => {
        setGuidanceSessionState((current) => (
          current?.environment_id === session?.environment_id ? null : current
        ));
      }, GUIDANCE_SESSION_CLEAR_MS);
    }, GUIDANCE_SUCCESS_DISMISS_MS);
    onCleanup(() => {
      window.clearTimeout(handle);
      if (clearHandle !== undefined) {
        window.clearTimeout(clearHandle);
      }
    });
  });

  const setRuntimeMenuOpen = (environmentID: string, open: boolean) => {
    if (open) {
      setLifecycleDisclosureState((current) => closeEnvironmentLifecycleDisclosure(current, environmentID));
    }
    setActiveEnvironmentOverlayState((current) => (
      open
        ? openEnvironmentLibraryOverlayState('runtime_menu', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'runtime_menu', environmentID)
    ));
  };

  const setPrimaryActionGuidanceOpen = (environmentID: string, open: boolean) => {
    if (open) {
      setLifecycleDisclosureState((current) => closeEnvironmentLifecycleDisclosure(current, environmentID));
    }
    setActiveEnvironmentOverlayState((current) => {
      const nextState = open
        ? openEnvironmentLibraryOverlayState('primary_action_guidance', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'primary_action_guidance', environmentID);
      setGuidanceSessionState((session) => {
        if (open) {
          return openEnvironmentGuidanceSession(environmentID);
        }
        return session?.environment_id === environmentID ? null : session;
      });
      return nextState;
    });
  };

  const setLifecycleProgressOpen = (environmentID: string, open: boolean) => {
    setActiveEnvironmentOverlayState((current) => (
      open
        ? openEnvironmentLibraryOverlayState('lifecycle_progress', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'lifecycle_progress', environmentID)
    ));
    setLifecycleDisclosureState((current) => (
      open
        ? reopenEnvironmentLifecycleDisclosure(current, environmentID)
        : closeEnvironmentLifecycleDisclosure(current, environmentID)
    ));
  };

  const beginLifecycleProgressDisclosure = (
    environmentID: string,
    intent: EnvironmentLifecycleDisclosureIntent,
  ) => {
    setGuidanceSessionState((current) => (
      current?.environment_id === environmentID ? null : current
    ));
    setLifecycleDisclosureState((current) => (
      beginEnvironmentLifecycleDisclosure(current, environmentID, intent)
    ));
    setActiveEnvironmentOverlayState(openEnvironmentLibraryOverlayState('lifecycle_progress', environmentID));
  };

  const projectedEnvironment = (environmentID: string): DesktopEnvironmentEntry => projectedEntriesByID()[environmentID]!;
  const guidanceSessionForEnvironment = (environmentID: string): EnvironmentGuidanceSessionState => (
    guidanceSessionState()?.environment_id === environmentID ? guidanceSessionState() : null
  );
  const lifecycleDisclosureForEnvironment = (environmentID: string): EnvironmentLifecycleDisclosureState => (
    environmentLifecycleDisclosureForEnvironment(lifecycleDisclosureState(), environmentID)
  );

  createEffect(() => {
    const element = environmentLibraryElement();
    if (!element) {
      return;
    }

    const updateLayoutMetrics = () => {
      setEnvironmentLibraryWidthPx(readMeasuredElementWidth(element));
      setRootFontSizePx(readDocumentRootFontSizePx());
    };

    updateLayoutMetrics();

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => updateLayoutMetrics());
    resizeObserver?.observe(element);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateLayoutMetrics);
    }

    onCleanup(() => {
      resizeObserver?.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', updateLayoutMetrics);
      }
    });
  });

  return (
    <div class="space-y-3">
      <Show
        when={props.entries.length > 0 || props.showQuickAddCards}
        fallback={(
          <Motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div class="redeven-console-empty flex flex-col items-center justify-center gap-3 rounded-lg px-6 py-8 text-center">
              <Search class="h-8 w-8 text-muted-foreground/50" />
              <div class="space-y-1">
                <div class="text-sm font-medium text-foreground">{props.i18n.t('environmentCenter.noMatchingEnvironmentsTitle')}</div>
                <div class="text-xs text-muted-foreground">
                  {props.i18n.t('environmentCenter.noMatchingEnvironmentsDescription')}
                </div>
              </div>
            </div>
          </Motion.div>
        )}
      >
        <div
          ref={setEnvironmentLibraryElement}
          class="redeven-environment-library space-y-3"
          data-density={layoutModel().density}
          style={environmentGridStyle()}
        >
          <Show when={groupedEntryIDs().pinned_entry_ids.length > 0}>
            <EnvironmentLibrarySection title={props.i18n.t('environmentCenter.pinnedSection')}>
              <For each={groupedEntryIDs().pinned_entry_ids}>
                {(environmentID) => (
                  <EnvironmentConnectionCard
                    i18n={props.i18n}
                    environment={projectedEnvironment(environmentID)}
                    busyState={props.busyState}
                    actionProgress={props.actionProgress}
                    runtimeMenuOpen={environmentLibraryOverlayOpenFor(activeEnvironmentOverlayState(), 'runtime_menu', environmentID)}
                    onRuntimeMenuOpenChange={(open) => setRuntimeMenuOpen(environmentID, open)}
                    primaryActionGuidanceOpen={environmentLibraryOverlayOpenFor(activeEnvironmentOverlayState(), 'primary_action_guidance', environmentID)}
                    onPrimaryActionGuidanceOpenChange={(open) => setPrimaryActionGuidanceOpen(environmentID, open)}
                    lifecycleProgressOpen={environmentLibraryOverlayOpenFor(activeEnvironmentOverlayState(), 'lifecycle_progress', environmentID)}
                    onLifecycleProgressOpenChange={(open) => setLifecycleProgressOpen(environmentID, open)}
                    lifecycleDisclosure={lifecycleDisclosureForEnvironment(environmentID)}
                    guidanceSession={guidanceSessionForEnvironment(environmentID)}
                    openEnvironment={props.openEnvironment}
                    runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                    refreshEnvironmentRuntime={props.refreshEnvironmentRuntime}
                    openEnvironmentFlowerComposer={props.openEnvironmentFlowerComposer}
                    runEnvironmentGuidanceAction={props.runEnvironmentGuidanceAction}
                    runDesktopUpdateHandoff={props.runDesktopUpdateHandoff}
                    runEnvironmentCardFactAction={props.runEnvironmentCardFactAction}
                    toggleEnvironmentPinned={props.toggleEnvironmentPinned}
                    copyEnvironmentValue={props.copyEnvironmentValue}
                    editEnvironment={props.editEnvironment}
                    deleteEnvironment={props.deleteEnvironment}
                    cancelOperation={props.cancelOperation}
                    dismissOperation={props.dismissOperation}
                    copyOperationDiagnostics={props.copyOperationDiagnostics}
                    setGuidanceSession={(nextSession) => setGuidanceSessionState(nextSession)}
                    beginLifecycleDisclosure={(intent) => beginLifecycleProgressDisclosure(environmentID, intent)}
                    environmentFailure={props.environmentFailures.get(environmentID) ?? null}
                    dismissEnvironmentFailure={() => props.dismissEnvironmentFailure(environmentID)}
                  />
                )}
              </For>
            </EnvironmentLibrarySection>
          </Show>
          <Show when={groupedEntryIDs().regular_entry_ids.length > 0 || props.showQuickAddCards}>
            <EnvironmentLibrarySection
              title={groupedEntryIDs().pinned_entry_ids.length > 0 ? props.i18n.t('environmentCenter.environmentsSection') : undefined}
            >
              <For each={groupedEntryIDs().regular_entry_ids}>
                {(environmentID) => (
                  <EnvironmentConnectionCard
                    i18n={props.i18n}
                    environment={projectedEnvironment(environmentID)}
                    busyState={props.busyState}
                    actionProgress={props.actionProgress}
                    runtimeMenuOpen={environmentLibraryOverlayOpenFor(activeEnvironmentOverlayState(), 'runtime_menu', environmentID)}
                    onRuntimeMenuOpenChange={(open) => setRuntimeMenuOpen(environmentID, open)}
                    primaryActionGuidanceOpen={environmentLibraryOverlayOpenFor(activeEnvironmentOverlayState(), 'primary_action_guidance', environmentID)}
                    onPrimaryActionGuidanceOpenChange={(open) => setPrimaryActionGuidanceOpen(environmentID, open)}
                    lifecycleProgressOpen={environmentLibraryOverlayOpenFor(activeEnvironmentOverlayState(), 'lifecycle_progress', environmentID)}
                    onLifecycleProgressOpenChange={(open) => setLifecycleProgressOpen(environmentID, open)}
                    lifecycleDisclosure={lifecycleDisclosureForEnvironment(environmentID)}
                    guidanceSession={guidanceSessionForEnvironment(environmentID)}
                    openEnvironment={props.openEnvironment}
                    runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                    refreshEnvironmentRuntime={props.refreshEnvironmentRuntime}
                    openEnvironmentFlowerComposer={props.openEnvironmentFlowerComposer}
                    runEnvironmentGuidanceAction={props.runEnvironmentGuidanceAction}
                    runDesktopUpdateHandoff={props.runDesktopUpdateHandoff}
                    runEnvironmentCardFactAction={props.runEnvironmentCardFactAction}
                    toggleEnvironmentPinned={props.toggleEnvironmentPinned}
                    copyEnvironmentValue={props.copyEnvironmentValue}
                    editEnvironment={props.editEnvironment}
                    deleteEnvironment={props.deleteEnvironment}
                    cancelOperation={props.cancelOperation}
                    dismissOperation={props.dismissOperation}
                    copyOperationDiagnostics={props.copyOperationDiagnostics}
                    setGuidanceSession={(nextSession) => setGuidanceSessionState(nextSession)}
                    beginLifecycleDisclosure={(intent) => beginLifecycleProgressDisclosure(environmentID, intent)}
                    environmentFailure={props.environmentFailures.get(environmentID) ?? null}
                    dismissEnvironmentFailure={() => props.dismissEnvironmentFailure(environmentID)}
                  />
                )}
              </For>
              <Show when={props.showQuickAddCards}>
                <NewEnvironmentPlaceholderCard
                  i18n={props.i18n}
                  openCreateConnectionDialog={props.openCreateConnectionDialog}
                />
              </Show>
            </EnvironmentLibrarySection>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function EnvironmentLibrarySection(props: Readonly<{
  title?: string;
  children: JSX.Element;
}>) {
  return (
    <section class="space-y-2.5">
      <Show when={props.title}>
        {(title) => (
          <div class="px-1">
            <h2 class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title()}</h2>
          </div>
        )}
      </Show>
      <div class="redeven-environment-grid">
        {props.children}
      </div>
    </section>
  );
}

function ConsoleIconTile(props: Readonly<{
  children: JSX.Element;
}>) {
  return <div class="redeven-console-card__icon">{props.children}</div>;
}

function ConsoleBadge(props: Readonly<{
  children: JSX.Element;
}>) {
  return <span class="redeven-console-badge">{props.children}</span>;
}

function ConsoleStatusBadge(props: Readonly<{
  tone: 'neutral' | 'primary' | 'success' | 'warning';
  children: JSX.Element;
}>) {
  return (
    <span class="redeven-console-status" data-tone={props.tone}>
      <span class="redeven-console-status__dot" aria-hidden="true" />
      {props.children}
    </span>
  );
}

function EnvironmentStatusIndicator(props: Readonly<{
  tone: 'neutral' | 'primary' | 'success' | 'warning';
  children: JSX.Element;
}>) {
  return (
    <span class="redeven-status-indicator" data-tone={props.tone}>
      <span class="redeven-status-indicator__dot" aria-hidden="true" />
      {props.children}
    </span>
  );
}

function EnvironmentFlowerComposerWindow(props: Readonly<{
  i18n: DesktopI18n;
  state: EnvironmentFlowerComposerState | null;
  onClose: () => void;
  resolveFlowerHandler: (environment: DesktopEnvironmentEntry) => Promise<DesktopFlowerHostRouterDecision>;
  sendFlowerPrompt: (environment: DesktopEnvironmentEntry, prompt: string, decision: DesktopFlowerHostRouterDecision) => Promise<string>;
  openFlowerHostSurface: () => Promise<void>;
}>) {
  const [prompt, setPrompt] = createSignal('');
  const [validationError, setValidationError] = createSignal('');
  const [handlerDecision, setHandlerDecision] = createSignal<DesktopFlowerHostRouterDecision | null>(null);
  const [handlerResolving, setHandlerResolving] = createSignal(false);
  const [handlerError, setHandlerError] = createSignal('');
  const [isComposing, setIsComposing] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [viewport, setViewport] = createSignal(currentViewportSize());
  const environment = createMemo(() => props.state?.environment ?? null);
  const contextSummary = createMemo(() => {
    const current = environment();
    return current ? environmentFlowerContextSummary(props.i18n, current) : '';
  });
  const sizing = createMemo(() => resolveEnvironmentFlowerWindowSizing(viewport()));
  const position = createMemo(() => resolveEnvironmentFlowerWindowPosition(props.state?.anchor, sizing()));
  const selectedHandler = createMemo(() => handlerDecision()?.selected_handler ?? null);
  const handlerReady = createMemo(() => {
    const decision = handlerDecision();
    return !!decision?.selected_handler && !decision.blocker && decision.route !== 'blocked';
  });
  const handlerNeedsSetup = createMemo(() => {
    const decision = handlerDecision();
    return decision?.reason_code === 'host_not_configured' || decision?.blocker?.code === 'host_not_configured';
  });
  const canSend = createMemo(() => trimString(prompt()) !== '' && !sending() && handlerReady());
  let textareaRef: HTMLTextAreaElement | undefined;
  let handlerRequestSeq = 0;

  const resolveCurrentHandler = (current = environment()) => {
    handlerRequestSeq += 1;
    const seq = handlerRequestSeq;
    setHandlerDecision(null);
    setHandlerError('');
    setValidationError('');
    if (!current) {
      setHandlerResolving(false);
      return;
    }
    setHandlerResolving(true);
    void props.resolveFlowerHandler(current)
      .then((decision) => {
        if (seq !== handlerRequestSeq) {
          return;
        }
        setHandlerDecision(decision);
        setHandlerError(decision.blocker?.message ?? '');
      })
      .catch((error) => {
        if (seq !== handlerRequestSeq) {
          return;
        }
        setHandlerError(getErrorMessage(error));
      })
      .finally(() => {
        if (seq === handlerRequestSeq) {
          setHandlerResolving(false);
        }
      });
  };

  createEffect(() => {
    if (!props.state) {
      setPrompt('');
      setValidationError('');
      setHandlerDecision(null);
      setHandlerError('');
      setHandlerResolving(false);
    }
  });

  createEffect(() => {
    const current = environment();
    resolveCurrentHandler(current);
  });

  createEffect(() => {
    if (!props.state || typeof document === 'undefined') {
      return;
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (sending()) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.redeven-environment-flower-window')) {
        return;
      }
      props.onClose();
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    onCleanup(() => document.removeEventListener('pointerdown', handleOutsidePointerDown, true));
  });

  createEffect(() => {
    if (!props.state) {
      return;
    }
    setValidationError('');
    requestAnimationFrame(() => textareaRef?.focus());
  });

  createEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const syncViewport = () => setViewport(currentViewportSize());
    window.addEventListener('resize', syncViewport);
    onCleanup(() => window.removeEventListener('resize', syncViewport));
  });

  const sendToFlower = async () => {
    const current = environment();
    if (!current) {
      return;
    }
    const message = trimString(prompt());
    if (!message) {
      setValidationError(props.i18n.t('environmentCenter.askFlowerCardNoMessage'));
      requestAnimationFrame(() => textareaRef?.focus());
      return;
    }
    const decision = handlerDecision();
    if (!decision?.selected_handler || decision.blocker || decision.route === 'blocked') {
      setValidationError(handlerError() || props.i18n.t('flowerSurface.chat.handlerUnavailable'));
      return;
    }
    setSending(true);
    try {
      await props.sendFlowerPrompt(current, message, decision);
      await props.openFlowerHostSurface();
      setPrompt('');
      props.onClose();
    } catch (error) {
      let displayError = getErrorMessage(error);
      if (typeof error === 'object' && error && 'fresh_decision' in error) {
        const freshDecision = (error as { fresh_decision?: DesktopFlowerHostRouterDecision }).fresh_decision ?? null;
        setHandlerDecision(freshDecision);
        displayError = freshDecision?.blocker?.message ?? displayError;
        setHandlerError(displayError);
      }
      setValidationError(displayError);
      requestAnimationFrame(() => textareaRef?.focus());
    } finally {
      setSending(false);
    }
  };

  const shouldSubmitOnEnterKeydown = (event: KeyboardEvent): boolean => {
    if (event.isComposing || isComposing()) {
      return false;
    }
    return event.key === 'Enter' && !event.shiftKey;
  };

  return (
    <Show when={environment()} keyed>
      {(current) => (
        <FloatingWindow
          open
          onOpenChange={(open) => {
            if (!open && !sending()) {
              props.onClose();
            }
          }}
          title={props.i18n.t('environmentCenter.askFlowerCardTitle')}
          defaultPosition={position()}
          defaultSize={sizing().defaultSize}
          minSize={sizing().minSize}
          maxSize={sizing().maxSize}
          zIndex={240}
          class="redeven-environment-flower-window ask-flower-composer-window border-border/65 shadow-[0_28px_72px_-42px_rgba(15,23,42,0.38)]"
        >
          <div class="redeven-environment-flower-window__body">
            <div class="redeven-environment-flower-window__scroll">
              <div class="redeven-environment-flower-window__message">
                <span class="redeven-environment-flower-window__avatar" aria-hidden="true">
                  <FlowerSoftAuraIcon
                    class="redeven-environment-flower-window__avatar-aura redeven-flower-icon-breathe"
                    iconClass="redeven-flower-icon-spin"
                    glowClass="redeven-environment-flower-window__avatar-glow"
                  />
                </span>
                <div class="redeven-environment-flower-window__bubble">
                  <div class="redeven-environment-flower-window__eyebrow">
                    {props.i18n.t('environmentCenter.askFlowerCardEyebrow')}
                  </div>
                  <div class="redeven-environment-flower-window__question">
                    {props.i18n.t('environmentCenter.askFlowerCardDescription')}
                  </div>
                  <div class="redeven-environment-flower-window__context">
                    <div class="redeven-environment-flower-window__context-accent" aria-hidden="true" />
                    <div class="redeven-environment-flower-window__context-copy">
                      <div class="redeven-environment-flower-window__context-label">{props.i18n.t('environmentCenter.askFlowerCardContextLabel')}</div>
                      <div class="redeven-environment-flower-window__context-name">{current.label}</div>
                      <Show when={contextSummary()}>
                        {(summary) => <div class="redeven-environment-flower-window__context-detail">{summary()}</div>}
                      </Show>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <Show
              when={!handlerNeedsSetup()}
              fallback={(
                <div class="redeven-environment-flower-window__dock">
                  <div class="redeven-environment-flower-window__setup">
                    <div class="redeven-environment-flower-window__setup-copy">
                      <div class="redeven-environment-flower-window__setup-title">{props.i18n.t('flowerSurface.chat.setupNeeded')}</div>
                      <div class="redeven-environment-flower-window__setup-description">{props.i18n.t('flowerSurface.chat.needsProviderNotice')}</div>
                    </div>
                    <button
                      type="button"
                      class="redeven-environment-flower-window__setup-button"
                      disabled={sending()}
                      onClick={() => void props.openFlowerHostSurface()}
                    >
                      <Settings class="h-3.5 w-3.5" />
                      <span>{props.i18n.t('flowerSurface.chat.openSettings')}</span>
                    </button>
                  </div>
                </div>
              )}
            >
              <div class="redeven-environment-flower-window__dock">
                <div class="redeven-environment-flower-window__composer flower-chat-input-floating chat-input-container">
                  <div class="redeven-environment-flower-window__composer-heading">
                    <span>{props.i18n.t('environmentCenter.askFlowerCardPromptLabel')}</span>
                    <span>{sending() ? props.i18n.t('environmentCenter.askFlowerCardSending') : props.i18n.t('environmentCenter.askFlowerCardReplyHint')}</span>
                  </div>
                  <div class="redeven-environment-flower-window__handler" data-unavailable={!handlerReady() && !handlerResolving() ? '' : undefined}>
                    <span class="redeven-environment-flower-window__handler-label">{props.i18n.t('flowerSurface.chat.handlerSelectionLabel')}</span>
                    <span class="redeven-environment-flower-window__handler-chip">
                      {handlerResolving()
                        ? props.i18n.t('flowerSurface.chat.handlerResolving')
                        : selectedHandler()?.display_name || props.i18n.t('flowerSurface.chat.handlerUnavailable')}
                    </span>
                  </div>
                  <div class="redeven-environment-flower-window__input-shell">
                    <textarea
                      ref={textareaRef}
                      class="redeven-environment-flower-window__textarea flower-chat-input-textarea"
                      value={prompt()}
                      placeholder={props.i18n.t('environmentCenter.askFlowerCardPlaceholder')}
                      disabled={sending()}
                      onInput={(event) => {
                        setPrompt(event.currentTarget.value);
                        if (validationError()) {
                          setValidationError('');
                        }
                      }}
                      onCompositionStart={() => setIsComposing(true)}
                      onCompositionEnd={(event) => {
                        setIsComposing(false);
                        setPrompt(event.currentTarget.value);
                        if (validationError()) {
                          setValidationError('');
                        }
                      }}
                      onKeyDown={(event) => {
                        if (shouldSubmitOnEnterKeydown(event)) {
                          event.preventDefault();
                          void sendToFlower();
                        }
                      }}
                    />
                    <Show when={validationError()}>
                      {(error) => <div class="redeven-environment-flower-window__error">{error()}</div>}
                    </Show>
                    <button
                      type="button"
                      class={cn('redeven-environment-flower-window__send chat-input-send-btn flower-chat-input-send-btn', canSend() && 'chat-input-send-btn-active')}
                      disabled={!canSend()}
                      aria-label={props.i18n.t('environmentCenter.askFlowerCardSend')}
                      title={props.i18n.t('environmentCenter.askFlowerCardSend')}
                      onClick={() => void sendToFlower()}
                    >
                      <Send class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </FloatingWindow>
      )}
    </Show>
  );
}

function BottomBarMetric(props: Readonly<{
  count: number;
  label: string;
  tone?: 'success' | 'primary' | 'warning';
  icon?: JSX.Element;
}>) {
  const hasTone = () => props.tone !== undefined && props.count > 0;
  const [popped, setPopped] = createSignal(false);
  createEffect(on(() => props.count, () => {
    if (props.count === 0) return;
    setPopped(true);
    const timer = setTimeout(() => setPopped(false), 180);
    onCleanup(() => clearTimeout(timer));
  }));
  return (
    <span
      class="redeven-bottom-bar-metric"
      data-tone={hasTone() ? props.tone : undefined}
      data-zero={props.count === 0 ? '' : undefined}
    >
      {props.icon ?? (
        <Show when={props.tone !== undefined}>
          <span class="redeven-bottom-bar-metric__dot" aria-hidden="true" />
        </Show>
      )}
      <span
        class="redeven-bottom-bar-metric__count"
        classList={{ 'redeven-bottom-bar-metric__count--pop': popped() }}
      >
        {props.count}
      </span>
      <span class="redeven-bottom-bar-metric__label">{props.label}</span>
    </span>
  );
}

function ConsoleActionIconButton(props: Readonly<{
  title: string;
  'aria-label': string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  children: JSX.Element;
}>) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props['aria-label']}
      aria-pressed={props.active}
      data-active={props.active === true}
      disabled={props.disabled}
      class={cn(
        'redeven-console-icon-button',
        props.danger && 'redeven-console-icon-button--danger',
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function ConsoleChipActionButton(props: Readonly<{
  onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  children: JSX.Element;
}>) {
  return (
    <button
      type="button"
      class="redeven-console-chip-button"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function cardFactIconMaskStyle(icon: string): JSX.CSSProperties {
  return { '--redeven-card-fact-icon-mask': `url("${icon}")` } as JSX.CSSProperties;
}

function EnvironmentCardFactsBlock(props: Readonly<{
  i18n: DesktopI18n;
  facts: readonly EnvironmentCardFactModel[];
  minRows?: number;
  onFactAction: (action: EnvironmentCardFactActionModel) => void;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
}>) {
  return (
    <div
      class="space-y-0 redeven-card-facts-block"
      style={props.minRows && props.minRows > 0
        ? { 'min-height': `calc(${props.minRows} * var(--redeven-card-fact-row-min-height))` }
        : undefined}
    >
      <For each={props.facts}>
        {(fact) => {
          const [copied, setCopied] = createSignal(false);
          let resetTimer: ReturnType<typeof setTimeout> | undefined;

          const handleCopy = () => {
            void props.copyEnvironmentValue(fact.value, fact.label);
            setCopied(true);
            clearTimeout(resetTimer);
            resetTimer = setTimeout(() => setCopied(false), 1500);
          };

          onCleanup(() => clearTimeout(resetTimer));

          return (
          <div class="redeven-card-fact-row">
            <div class="redeven-card-fact-label">
              <Show when={fact.label_icon}>
                {(icon) => (
                  <span
                    class="redeven-card-fact-label-icon"
                    style={cardFactIconMaskStyle(icon())}
                    aria-hidden="true"
                  />
                )}
              </Show>
              {fact.label}
            </div>
            <Show
              when={fact.action}
              fallback={(
                <div
                  class={cn(
                    'redeven-card-fact-value',
                    fact.value_tone === 'placeholder' && 'redeven-card-fact-value--placeholder',
                    fact.copy_value && 'redeven-card-fact-value--copyable',
                  )}
                  title={fact.value}
                  role={fact.copy_value ? 'button' : undefined}
                  tabIndex={fact.copy_value ? 0 : undefined}
                  aria-label={fact.copy_value ? props.i18n.t('environmentFacts.copyFact', { label: fact.label }) : undefined}
                  onClick={fact.copy_value ? handleCopy : undefined}
                  onKeyDown={fact.copy_value ? (e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleCopy();
                    }
                  } : undefined}
                >
                  <Show when={fact.leading_icon}>
                    {(icon) => (
                      <span
                        class="redeven-card-fact-leading-icon"
                        style={cardFactIconMaskStyle(icon())}
                        aria-hidden="true"
                      />
                    )}
                  </Show>
                  {fact.copy_value ? (
                    <span class="redeven-card-fact-value__text">{fact.value}</span>
                  ) : (
                    fact.value
                  )}
                  <Show when={fact.endpoints && fact.endpoints.length > 0}>
                    <EndpointsPopover
                      i18n={props.i18n}
                      endpoints={fact.endpoints!}
                      copyEnvironmentValue={props.copyEnvironmentValue}
                    />
                  </Show>
                  <Show when={fact.copy_value}>
                    <span
                      class={cn('redeven-card-fact-copy-icon', copied() && 'redeven-card-fact-copy-icon--active')}
                      aria-hidden="true"
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        handleCopy();
                      }}
                    >
                      {copied() ? <Check class="h-3 w-3" /> : <Copy class="h-3 w-3" />}
                    </span>
                  </Show>
                </div>
              )}
            >
              {(action) => (
                <button
                  type="button"
                  class="redeven-card-fact-value redeven-card-fact-value--action"
                  title={action().label}
                  aria-label={action().aria_label}
                  onClick={() => props.onFactAction(action())}
                >
                  <Show when={fact.leading_icon}>
                    {(icon) => (
                      <span
                        class="redeven-card-fact-leading-icon"
                        style={cardFactIconMaskStyle(icon())}
                        aria-hidden="true"
                      />
                    )}
                  </Show>
                  <span class="redeven-card-fact-value__text">{fact.value}</span>
                  <ChevronRight class="redeven-card-fact-value__icon h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </Show>
          </div>
          );
        }}
      </For>
    </div>
  );
}

function EndpointsPopover(props: Readonly<{
  i18n: DesktopI18n;
  endpoints: readonly EnvironmentCardEndpointModel[];
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
}>) {
  const [open, setOpen] = createSignal(false);
  let anchorRef: HTMLSpanElement | undefined;
  let popoverRef: HTMLDivElement | undefined;

  const handlePointerDown = (event: MouseEvent) => {
    if (popoverRef?.contains(event.target as Node) || anchorRef?.contains(event.target as Node)) {
      return;
    }
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
      anchorRef?.focus();
    }
  };

  createEffect(() => {
    if (open()) {
      document.addEventListener('mousedown', handlePointerDown);
      document.addEventListener('keydown', handleKeyDown);
      onCleanup(() => {
        document.removeEventListener('mousedown', handlePointerDown);
        document.removeEventListener('keydown', handleKeyDown);
      });
    }
  });

  return (
    <>
      <span
        ref={anchorRef}
        class="redeven-card-fact-endpoint-trigger"
        role="button"
        tabIndex={0}
        aria-label={props.i18n.t('environmentCenter.showEndpoints')}
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <img src={ICON_ENDPOINTS} class="redeven-endpoint-trigger-icon" aria-hidden="true" />
      </span>
      <Show when={open()}>
        <DesktopAnchoredOverlaySurface
          open={open()}
          anchorRef={anchorRef}
          placement="bottom"
          role="dialog"
          ariaModal={false}
          ariaLabel={props.i18n.t('environmentCenter.environmentEndpoints')}
          interactive
          class="z-[225] rounded-md border border-border/80 bg-popover text-popover-foreground shadow-[0_14px_40px_-22px_rgba(0,0,0,0.55),0_24px_50px_-28px_rgba(0,0,0,0.28)]"
          onOverlayRef={(element) => {
            popoverRef = element;
          }}
        >
          <div class="redeven-endpoints-popover">
            <div class="redeven-endpoints-popover-header">
              <span class="redeven-endpoints-popover-title">{props.i18n.t('environmentCenter.endpoints')}</span>
              <button
                type="button"
                class="redeven-endpoints-popover-close"
                aria-label={props.i18n.t('environmentCenter.closeEndpoints')}
                onClick={() => setOpen(false)}
              >
                <X class="h-3 w-3" />
              </button>
            </div>
            <div class="space-y-0.5">
              <For each={props.endpoints}>
                {(endpoint) => (
                  <EndpointCopyRow
                    endpoint={endpoint}
                    copyEnvironmentValue={props.copyEnvironmentValue}
                  />
                )}
              </For>
            </div>
          </div>
        </DesktopAnchoredOverlaySurface>
      </Show>
    </>
  );
}

function EndpointCopyRow(props: Readonly<{
  endpoint: EnvironmentCardEndpointModel;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
}>) {
  const [copied, setCopied] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const handleCopy = () => {
    void props.copyEnvironmentValue(props.endpoint.value, props.endpoint.copy_label);
    setCopied(true);
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => setCopied(false), 1500);
  };

  onCleanup(() => clearTimeout(resetTimer));

  return (
    <div
      class="redeven-card-endpoint-row"
      onClick={handleCopy}
      title={props.endpoint.copy_label}
    >
      <span class="redeven-card-endpoint-label">{props.endpoint.label}</span>
      <span class={cn(
        'redeven-card-endpoint-value',
        props.endpoint.monospace && 'font-mono text-[11.5px]',
      )}>
        {props.endpoint.value}
      </span>
      <span class={cn('redeven-card-endpoint-copy', copied() && 'redeven-card-endpoint-copy--active')} aria-hidden="true">
        {copied() ? <Check class="h-3 w-3" /> : <Copy class="h-3 w-3" />}
      </span>
    </div>
  );
}

function isEnvironmentActionBusy(
  action: EnvironmentActionModel,
  busyState: DesktopLauncherBusyState | undefined,
  environmentID: string,
  runtimeLifecycleProgress?: DesktopLauncherActionProgress | null,
): boolean {
  if (!busyState) {
    return false;
  }
  switch (action.intent) {
    case 'reconnect_provider':
      return busyState.provider_origin !== ''
        && busyState.provider_origin === action.provider_origin
        && busyState.action === 'start_control_plane_connect';
    case 'start_runtime':
      return busyStateBlocksEnvironmentAction(busyState, environmentID, ['start_environment_runtime'], runtimeLifecycleProgress);
    case 'restart_runtime':
      return busyStateBlocksEnvironmentAction(busyState, environmentID, ['restart_environment_runtime'], runtimeLifecycleProgress);
    case 'update_runtime':
      return busyStateBlocksEnvironmentAction(busyState, environmentID, ['update_environment_runtime', 'manage_desktop_update'], runtimeLifecycleProgress);
    case 'connect_provider_runtime':
      return busyStateMatchesEnvironment(busyState, environmentID, ['connect_provider_runtime']);
    case 'disconnect_provider_runtime':
      return busyStateMatchesEnvironment(busyState, environmentID, ['disconnect_provider_runtime']);
    case 'stop_runtime':
      return busyStateBlocksEnvironmentAction(busyState, environmentID, ['stop_environment_runtime'], runtimeLifecycleProgress);
    case 'refresh_runtime':
      return busyStateBlocksEnvironmentAction(busyState, environmentID, ['refresh_environment_runtime'], runtimeLifecycleProgress)
        || busyStateMatchesAction(busyState, 'refresh_all_environment_runtimes');
    default:
      return false;
  }
}

function blockedPrimaryActionTriggerLabel(i18n: DesktopI18n, label: string): string {
  return i18n.t('environmentAction.unavailableTrigger', { label });
}

function environmentProgressStatus(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  if (progress.deleted_subject) {
    return i18n.t('progress.connectionRemoved');
  }
  switch (progress.status) {
    case 'canceling':
    case 'cleanup_running':
      return i18n.t('progress.stopping');
    case 'cleanup_failed':
      return i18n.t('progress.cleanupNeedsAttention');
    case 'failed':
      return i18n.t('progress.failed');
    case 'canceled':
      return i18n.t('progress.canceled');
    case 'succeeded':
      return i18n.t('progress.ready');
    default:
      return i18n.t('progress.running');
  }
}

function localizedProgressLocation(i18n: DesktopI18n, location: string): string {
  switch (location) {
    case 'local_host':
      return i18n.t('progress.local');
    case 'local_container':
      return i18n.t('progress.localContainer');
    case 'ssh_host':
      return i18n.t('progress.sshHost');
    case 'ssh_container':
      return i18n.t('progress.sshContainer');
    case 'provider_remote':
      return i18n.t('progress.provider');
    default:
      return '';
  }
}

function environmentProgressLabel(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  const open = progress.open_progress;
  if (open) {
    const environmentLabel = trimString(open.environment_label) || trimString(progress.environment_label) || 'Environment';
    return `${environmentLabel} · ${localizedProgressLocation(i18n, open.location)}`;
  }
  const startup = progress.lifecycle_progress;
  if (!startup) {
    return i18n.t('progress.environmentProgress');
  }
  const targetLabel = trimString(startup.target_label) || trimString(progress.environment_label) || 'Runtime';
  return `${targetLabel} · ${localizedProgressLocation(i18n, startup.location)}`;
}

function environmentProgressStatusIconTone(progress: DesktopLauncherActionProgress): 'info' | 'success' | 'error' {
  if (progress.deleted_subject) {
    return 'error';
  }
  switch (progress.status) {
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'canceled':
    case 'cleanup_failed':
      return 'error';
    default:
      return 'info';
  }
}

function localizedOpenConnectionPhaseLabel(i18n: DesktopI18n, phase: DesktopOpenConnectionPhase): string {
  switch (phase) {
    case 'checking_runtime_record':
      return i18n.t('progress.checkingRuntime');
    case 'ensuring_runtime_ready':
      return i18n.t('progress.preparingRuntime');
    case 'opening_ssh_control':
      return i18n.t('progress.openingSshConnection');
    case 'opening_local_tunnel':
      return i18n.t('progress.openingLocalTunnel');
    case 'starting_container_bridge':
      return i18n.t('progress.openingContainerBridge');
    case 'opening_bridge_proxy':
      return i18n.t('progress.openingBridgeProxy');
    case 'connecting_runtime_control':
      return i18n.t('progress.connectingRuntimeControl');
    case 'connecting_desktop_model_source':
      return i18n.t('progress.connectingModelSource');
    case 'checking_env_app_readiness':
      return i18n.t('progress.checkingAppReadiness');
    case 'opening_window':
      return i18n.t('progress.openingWindow');
    case 'open_ready':
      return i18n.t('progress.openReady');
    case 'failed':
      return i18n.t('progress.failed');
    case 'canceled':
      return i18n.t('progress.canceled');
  }
}

function localizedRuntimeLifecyclePhaseLabel(i18n: DesktopI18n, phase: DesktopRuntimeLifecyclePhase): string {
  switch (phase) {
    case 'checking_existing_runtime':
      return i18n.t('progress.checkingExistingRuntime');
    case 'checking_host':
      return i18n.t('progress.checkingHost');
    case 'checking_container':
      return i18n.t('progress.checkingContainer');
    case 'detecting_platform':
      return i18n.t('progress.detectingPlatform');
    case 'checking_runtime_package':
      return i18n.t('progress.checkingRuntimePackage');
    case 'stopping_runtime_process':
      return i18n.t('progress.stoppingRuntimeProcess');
    case 'verifying_runtime_stopped':
      return i18n.t('progress.verifyingRuntimeStopped');
    case 'preparing_runtime_package':
      return i18n.t('progress.preparingRuntimePackage');
    case 'installing_runtime_package':
      return i18n.t('progress.installingRuntimePackage');
    case 'starting_runtime_process':
      return i18n.t('progress.startingRuntime');
    case 'checking_runtime_service':
      return i18n.t('progress.checkingRuntimeService');
    case 'runtime_ready':
      return i18n.t('progress.runtimeReady');
    case 'runtime_up_to_date':
      return i18n.t('progress.runtimeUpToDate');
    case 'runtime_already_stopped':
      return i18n.t('progress.runtimeAlreadyStopped');
    case 'runtime_stopped':
      return i18n.t('progress.runtimeStopped');
  }
}

function localizedRuntimeLifecycleStepLabel(
  i18n: DesktopI18n,
  step: DesktopRuntimeLifecycleStepSnapshot,
): string {
  return localizedRuntimeLifecyclePhaseLabel(i18n, step.id);
}

function localizedProgressTitle(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  const open = progress.open_progress;
  if (open) {
    switch (open.phase) {
      case 'checking_runtime_record':
        return i18n.t('progress.titleCheckingRuntimeStatus');
      case 'checking_env_app_readiness':
        return i18n.t('progress.titleCheckingAppReadiness');
      case 'opening_ssh_control':
        return i18n.t('progress.titleOpeningSshConnection');
      case 'starting_container_bridge':
      case 'opening_bridge_proxy':
        return i18n.t('progress.titleOpeningContainerBridge');
      case 'connecting_desktop_model_source':
        return i18n.t('progress.titleConnectingDesktopModelSource');
      case 'opening_window':
        return i18n.t('progress.titleOpeningEnvironment');
      case 'open_ready':
        return i18n.t('progress.titleEnvironmentOpen');
      case 'failed':
        return i18n.t('progress.openFailed');
      case 'canceled':
        return i18n.t('progress.canceled');
      case 'ensuring_runtime_ready':
      case 'opening_local_tunnel':
      case 'connecting_runtime_control':
        return localizedOpenConnectionPhaseLabel(i18n, open.phase);
    }
  }
  const lifecycle = progress.lifecycle_progress;
  if (lifecycle) {
    return localizedRuntimeLifecyclePhaseLabel(i18n, lifecycle.phase);
  }
  return localizedStringByValue(i18n, progress.title, {
    'Runtime ready': 'progress.titleRuntimeReady',
    'Startup canceled': 'progress.titleStartupCanceled',
    'Connection removed': 'progress.connectionRemoved',
  });
}

function localizedProgressDetail(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  const open = progress.open_progress;
  if (open) {
    switch (open.phase) {
      case 'checking_runtime_record':
        return i18n.t('progress.detailCheckingRuntimeStatus');
      case 'checking_env_app_readiness':
        return i18n.t('progress.detailCheckingAppReadiness');
      case 'opening_ssh_control':
        return i18n.t('progress.detailOpeningSshConnection');
      case 'starting_container_bridge':
      case 'opening_bridge_proxy':
        return i18n.t('progress.detailOpeningContainerBridge');
      case 'connecting_desktop_model_source':
        return i18n.t('progress.detailConnectingDesktopModelSource');
      case 'opening_window':
        return i18n.t('progress.detailOpeningEnvironment');
      case 'open_ready':
        return i18n.t('progress.detailEnvironmentOpen');
      case 'ensuring_runtime_ready':
      case 'opening_local_tunnel':
      case 'connecting_runtime_control':
      case 'failed':
      case 'canceled':
        break;
    }
  }
  const lifecycle = progress.lifecycle_progress;
  if (lifecycle?.phase === 'runtime_ready') {
    return i18n.t('progress.detailRuntimeReady');
  }
  return localizedStringByValue(i18n, progress.detail, {
    'The runtime daemon is running. Open will prepare the Desktop bridge.': 'progress.detailRuntimeReady',
    'Desktop stopped the container runtime startup and cleaned up local startup resources.': 'progress.detailStartupCanceled',
    'Desktop stopped the Runtime startup and cleaned up local startup resources.': 'progress.detailStartupCanceled',
  });
}

function localizedProgressInterruptLabel(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  return localizedStringByValue(i18n, progress.interrupt_label, {
    'Stop opening': 'progress.interruptStopOpening',
    'Stop startup': 'progress.interruptStopStartup',
  }) || i18n.t('progress.stopStartup');
}

function localizedProgressInterruptDetail(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  return localizedStringByValue(i18n, progress.interrupt_detail, {
    'Desktop is stopping this runtime startup.': 'progress.interruptStopStartupDetail',
    'Desktop is stopping this Runtime startup.': 'progress.interruptStopStartupDetail',
    'Desktop is stopping this open request before opening the local environment window.': 'progress.interruptStopOpeningDetail',
    'Desktop is stopping this open request and closing local SSH resources already created.': 'progress.interruptStopOpeningDetail',
    'Desktop is stopping this open request and closing local connection resources already created.': 'progress.interruptStopOpeningDetail',
    'Desktop is stopping this open request before opening the Redeven URL window.': 'progress.interruptStopOpeningDetail',
    'Desktop is stopping this provider open request before opening the environment window.': 'progress.interruptStopOpeningDetail',
  }) || i18n.t('progress.stopBackgroundTask');
}

function localizedProgressPlanningLabel(i18n: DesktopI18n, action: DesktopLauncherActionKind): string {
  switch (action) {
    case 'restart_environment_runtime':
      return i18n.t('progress.planningRestartPath');
    case 'update_environment_runtime':
      return i18n.t('progress.planningUpdatePath');
    case 'stop_environment_runtime':
      return i18n.t('progress.planningStopPath');
    default:
      return i18n.t('progress.planningStartupPath');
  }
}

function localizedFailureNoticeTitle(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  if (progress.open_progress) {
    return i18n.t('progress.openNeedsAttention');
  }
  switch (progress.action) {
    case 'restart_environment_runtime':
      return i18n.t('progress.restartNeedsAttention');
    case 'update_environment_runtime':
      return i18n.t('progress.updateNeedsAttention');
    case 'stop_environment_runtime':
      return i18n.t('progress.stopNeedsAttention');
    default:
      return i18n.t('progress.startupNeedsAttention');
  }
}

function localizedNextActionLabel(i18n: DesktopI18n, action: DesktopLauncherOperationNextAction): string {
  switch (action.kind) {
    case 'refresh_status':
      return i18n.t('environmentAction.refreshStatus');
    case 'update_runtime':
      return i18n.t('environmentAction.updateRuntime');
    case 'manage_desktop_update':
      return i18n.t('environmentAction.updateRedevenDesktop');
    case 'copy_diagnostics':
      return i18n.t('progress.copyLog');
    case 'dismiss':
      return i18n.t('progress.dismiss');
    case 'retry':
      return localizedEnvironmentActionLabel(i18n, action.label);
  }
}

function localizedProgressPanelPrimaryAction(
  i18n: DesktopI18n,
  progress: DesktopLauncherActionProgress,
  primaryAction: EnvironmentActionModel | undefined,
  input: Readonly<{ busy?: boolean }> = {},
) {
  const action = environmentProgressPanelPrimaryAction(progress, primaryAction, input);
  return action
    ? {
        ...action,
        action: localizedEnvironmentAction(i18n, action.action),
        label: localizedEnvironmentActionLabel(i18n, action.label),
      }
    : null;
}

function EnvironmentProgressPanel(props: Readonly<{
  i18n: DesktopI18n;
  progress: DesktopLauncherActionProgress;
  primaryAction?: EnvironmentActionModel;
  primaryActionBusy?: boolean;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  runNextAction?: (action: DesktopLauncherOperationNextAction, progress: DesktopLauncherActionProgress) => void;
  runPrimaryAction?: (action: EnvironmentActionModel) => void;
}>) {
  const startup = createMemo(() => props.progress.lifecycle_progress);
  const openConnection = createMemo(() => props.progress.open_progress);
  const currentRuntimeLifecycle = createMemo(() => props.progress.lifecycle_progress);
  const iconTone = createMemo(() => environmentProgressStatusIconTone(props.progress));
  const phaseStatus = createMemo(() => {
    const s = props.progress.status;
    if (s === 'succeeded' || s === 'failed' || s === 'canceled') {
      return s;
    }
    return 'running';
  });
  const runtimeSteps = createMemo(() => startup()?.steps ?? []);
  const stepEntering = createRuntimeLifecycleStepAnimation(
    runtimeSteps,
    () => startup()?.plan_revision ?? 0,
  );
  const stagePercent = createMemo(() => {
    const current = startup() ?? openConnection();
    if (!current || current.stage_count <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((current.stage_index / current.stage_count) * 100)));
  });
  const canCancel = createMemo(() => (
    props.progress.cancelable === true && props.progress.status === 'running'
  ));
  const canDismiss = createMemo(() => (
    props.progress.status === 'failed'
    || props.progress.status === 'cleanup_failed'
    || props.progress.status === 'canceled'
  ));
  const panelPrimaryAction = createMemo(() => localizedProgressPanelPrimaryAction(
    props.i18n,
    props.progress,
    props.primaryAction,
    { busy: props.primaryActionBusy },
  ));
  const nextActionsByKind = createMemo(() => operationNextActionsByKind(props.progress));
  const nextActionGroups = createMemo(() => groupedVisibleOperationNextActions(props.progress));
  const showFallbackCopyAction = createMemo(() => (
    props.progress.failure !== undefined && !nextActionsByKind().has('copy_diagnostics')
  ));
  const showFallbackDismissAction = createMemo(() => !nextActionsByKind().has('dismiss'));
  const showFallbackActions = createMemo(() => (
    canDismiss() && (showFallbackCopyAction() || showFallbackDismissAction())
  ));
  const phaseSequence = createMemo<readonly { phase: string; key: string; label: string; status?: string }[]>(() => {
    const current = startup();
    const open = openConnection();
    if (open) {
      return openConnectionPhaseSequence(open.location)
        .map((p, index) => ({ phase: p, key: `open:${index}:${p}`, label: localizedOpenConnectionPhaseLabel(props.i18n, p) }));
    }
    if (!current) {
      return [];
    }
    return current.steps.map((step) => ({
      phase: step.id,
      key: step.key,
      label: localizedRuntimeLifecycleStepLabel(props.i18n, step),
      status: step.status,
    }));
  });
  const failureNoticeTitle = createMemo(() => localizedFailureNoticeTitle(props.i18n, props.progress));
  const localizedFailure = createMemo(() => {
    const failure = props.progress.failure;
    return failure ? localizedFailureForDisplay(props.i18n, failure) : null;
  });
  const stepState = (index: number, currentPhase: string | undefined, opStatus: string): 'done' | 'active' | 'pending' | 'error' => {
    const step = phaseSequence()[index];
    switch (step?.status) {
      case 'failed':
        return 'error';
      case 'succeeded':
        return 'done';
      case 'running':
        return 'active';
      case 'pending':
        return 'pending';
    }
    if (!currentPhase) {
      return 'pending';
    }
    if (opStatus === 'succeeded') {
      const currentIdx = phaseSequence().findIndex((s) => s.phase === currentPhase);
      return currentIdx >= 0 && index <= currentIdx ? 'done' : 'pending';
    }
    if (opStatus === 'failed' || opStatus === 'canceled') {
      const currentIdx = phaseSequence().findIndex((s) => s.phase === currentPhase);
      if (index < currentIdx) return 'done';
      if (index === currentIdx) return 'error';
      return 'pending';
    }
    const currentIdx = phaseSequence().findIndex((s) => s.phase === currentPhase);
    if (index < currentIdx) return 'done';
    if (index === currentIdx) return 'active';
    return 'pending';
  };

  return (
    <div class="redeven-action-popover redeven-environment-progress" tabIndex={-1} aria-live="polite">
      <div class="redeven-action-popover__status-header">
        <span class="redeven-action-popover__status-icon" data-tone={iconTone()}>
          <Show when={iconTone() === 'success'} fallback={(
            <Show when={iconTone() === 'error'} fallback={<span class="redeven-action-popover__status-dot" />}>
              <X />
            </Show>
          )}>
            <Check />
          </Show>
        </span>
        <div class="redeven-action-popover__status-text">
          <div class="redeven-action-popover__eyebrow">{environmentProgressStatus(props.i18n, props.progress)}</div>
          <div class="redeven-action-popover__title">{localizedProgressTitle(props.i18n, props.progress)}</div>
          <div class="redeven-environment-progress__target">{environmentProgressLabel(props.i18n, props.progress)}</div>
        </div>
      </div>
      <div class="redeven-action-popover__detail">{localizedProgressDetail(props.i18n, props.progress)}</div>
      <Show when={startup() || openConnection()}>
        {(currentStartup) => (
          <>
            <div class="redeven-environment-progress__steps" aria-hidden="true">
              <Index each={phaseSequence()}>
                {(step, index) => {
                  const state = () => stepState(index, currentStartup().phase, phaseStatus());
                  const isLast = () => index === phaseSequence().length - 1;
                  return (
                    <div
                      class="redeven-environment-progress__step"
                      data-step-key={step().key}
                      data-plan-revision={startup()?.plan_revision ?? 0}
                      data-entering={startup() ? stepEntering(step().key) : false}
                    >
                      <div class="redeven-environment-progress__step-connector">
                        <span class="redeven-environment-progress__step-dot" data-state={state()} />
                        <Show when={!isLast()}>
                          <span class="redeven-environment-progress__step-line" data-state={state()} />
                        </Show>
                      </div>
                      <span
                        class="redeven-environment-progress__step-label"
                        data-state={state()}
                      >{step().label}</span>
                    </div>
                  );
                }}
              </Index>
            </div>
            <div
              class="redeven-environment-progress__meter"
              data-plan-state={startup()?.plan_state ?? 'executing'}
              aria-hidden="true"
            >
              <span style={{ width: `${stagePercent()}%` }} />
            </div>
            <div class="redeven-environment-progress__meta">
              <Show
                when={currentRuntimeLifecycle()?.plan_state !== 'planning'}
                fallback={<span>{localizedProgressPlanningLabel(props.i18n, props.progress.action)}</span>}
              >
                <span>{props.i18n.t('progress.stepOf', { current: currentStartup().stage_index, total: currentStartup().stage_count })}</span>
              </Show>
              <Show when={currentStartup().target_detail}>
                {(detail) => <span>{detail()}</span>}
              </Show>
            </div>
          </>
        )}
      </Show>
      <Show when={localizedFailure()}>
        {(failure) => (
          <div class="redeven-action-popover__notice" data-tone="error">
            <div class="redeven-action-popover__notice-title">{failureNoticeTitle()}</div>
            <div class="redeven-action-popover__notice-detail">{failure().summary}</div>
            <Show when={failure().detail}>
              {(detail) => <pre class="redeven-action-popover__notice-detail redeven-action-popover__notice-detail--pre">{detail()}</pre>}
            </Show>
          </div>
        )}
      </Show>
      <Show when={canCancel()}>
        <div class="redeven-action-popover__actions">
          <Button
            size="sm"
            variant="outline"
            class="w-full justify-center gap-1.5"
            title={localizedProgressInterruptDetail(props.i18n, props.progress)}
            onClick={() => props.cancelOperation(props.progress)}
          >
            <Stop class="h-3.5 w-3.5" />
            {localizedProgressInterruptLabel(props.i18n, props.progress)}
          </Button>
        </div>
      </Show>
      <Show when={panelPrimaryAction()}>
        {(action) => (
          <div class="redeven-action-popover__actions">
            <Button
              size="sm"
              variant="default"
              class="w-full justify-center gap-1.5"
              loading={action().loading}
              disabled={action().disabled}
              onClick={() => props.runPrimaryAction?.(action().action)}
            >
              <ExternalLink class="h-3.5 w-3.5" />
              {action().label}
            </Button>
          </div>
        )}
      </Show>
      <Show when={nextActionGroups().length > 0}>
        <div class="redeven-action-popover__action-stack">
          <For each={nextActionGroups()}>
            {(group) => (
              <div
                class="redeven-action-popover__actions"
                data-layout={group.kind}
              >
                <For each={group.actions}>
                  {(action) => (
                    <Button
                      size="sm"
                      variant="outline"
                      class="justify-center gap-1.5"
                      onClick={() => props.runNextAction?.(action, props.progress)}
                    >
                      <Show
                        when={action.kind === 'refresh_status'}
                        fallback={action.kind === 'update_runtime'
                          ? <Refresh class="h-3.5 w-3.5" />
                          : action.kind === 'manage_desktop_update'
                            ? <ExternalLink class="h-3.5 w-3.5" />
                          : action.kind === 'copy_diagnostics'
                            ? <Copy class="h-3.5 w-3.5" />
                            : null}
                      >
                        <Refresh class="h-3.5 w-3.5" />
                      </Show>
                      {localizedNextActionLabel(props.i18n, action)}
                    </Button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={showFallbackActions()}>
        <div class="redeven-action-popover__actions">
          <Show when={showFallbackCopyAction()}>
            <Button
              size="sm"
              variant="outline"
              class="flex-1 justify-center gap-1.5 whitespace-nowrap"
              onClick={() => props.copyOperationDiagnostics(props.progress)}
            >
              <Copy class="h-3.5 w-3.5" />
              {props.i18n.t('progress.copyLog')}
            </Button>
          </Show>
          <Show when={showFallbackDismissAction()}>
            <Button
              size="sm"
              variant="outline"
              class="flex-1 justify-center"
              onClick={() => props.dismissOperation(props.progress)}
            >
              {props.i18n.t('progress.dismiss')}
            </Button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function overlayStatusIconTone(tone: EnvironmentActionOverlayTone): 'warning' | 'neutral' {
  return tone;
}

function EnvironmentPrimaryActionPanel(props: Readonly<{
  i18n: DesktopI18n;
  overlay: Extract<EnvironmentPrimaryActionOverlayModel, Readonly<{ kind: 'popover' }>>;
  environmentID: string;
  busyState?: DesktopLauncherBusyState;
  runtimeLifecycleProgress?: DesktopLauncherActionProgress | null;
  session: EnvironmentGuidanceSessionState;
  onRunAction: (action: EnvironmentActionModel) => void;
}>) {
  const notice = createMemo(() => (
    props.overlay.actions.length > 0 ? guidanceSessionNotice(props.session) : null
  ));
  const localizedNotice = createMemo(() => {
    const current = notice();
    return current
      ? {
          ...current,
          title: localizedOverlayTitle(props.i18n, current.title),
          detail: localizedRuntimeMessage(props.i18n, current.detail),
        }
      : null;
  });
  const panelBusy = createMemo(() => props.session?.pending_intent !== null);
  const iconTone = createMemo(() => overlayStatusIconTone(props.overlay.tone));

  return (
    <div class="redeven-action-popover" tabIndex={-1}>
      <div class="redeven-action-popover__status-header">
        <span class="redeven-action-popover__status-icon" data-tone={iconTone()}>
          <Show when={props.overlay.tone === 'warning'} fallback={<AlertCircle />}>
            <AlertTriangle />
          </Show>
        </span>
        <div class="redeven-action-popover__status-text">
          <div class="redeven-action-popover__eyebrow">{props.overlay.eyebrow}</div>
          <div class="redeven-action-popover__title">{props.overlay.title}</div>
        </div>
      </div>
      <div class="redeven-action-popover__detail">{props.overlay.detail}</div>
      <Show when={localizedNotice()}>
        {(currentNotice) => (
          <div class="redeven-action-popover__notice" data-tone={currentNotice().tone}>
            <div class="redeven-action-popover__notice-title">{currentNotice().title}</div>
            <div class="redeven-action-popover__notice-detail">{currentNotice().detail}</div>
          </div>
        )}
      </Show>
      <Show when={props.overlay.actions.length > 0}>
        <div class="redeven-action-popover__actions">
          <For each={props.overlay.actions}>
            {(item) => {
              const loading = () => isEnvironmentActionBusy(
                item.action,
                props.busyState,
                props.environmentID,
                props.runtimeLifecycleProgress,
              );
              const isSecondary = item.emphasis === 'secondary';
              const secondaryIconOnly = () => isSecondary && props.overlay.actions.length > 1;
              const showsRefreshIcon = item.action.intent === 'refresh_runtime';
              return (
                <div class={secondaryIconOnly() ? 'relative' : 'relative flex-1'}>
                  <Button
                    size="sm"
                    variant={item.emphasis === 'primary' ? 'default' : 'outline'}
                    class={secondaryIconOnly() ? 'aspect-square p-0' : cn('w-full justify-center', showsRefreshIcon && 'gap-1.5')}
                    loading={loading()}
                    disabled={panelBusy() && !loading()}
                    onClick={() => props.onRunAction(item.action)}
                    title={secondaryIconOnly() ? item.label : undefined}
                    aria-label={secondaryIconOnly() ? item.label : undefined}
                  >
                    <Show
                      when={secondaryIconOnly()}
                      fallback={(
                        <>
                          <Show when={showsRefreshIcon}>
                            <Refresh class="h-3.5 w-3.5" />
                          </Show>
                          {item.label}
                        </>
                      )}
                    >
                      <Refresh class="h-3.5 w-3.5" />
                    </Show>
                  </Button>
                  <Presence>
                    <Show when={loading()}>
                      <Motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        class="redeven-loading-shimmer-overlay"
                      />
                    </Show>
                  </Presence>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

function firstEnabledMenuItem(root: HTMLElement | undefined): HTMLElement | null {
  return root?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])') ?? null;
}

function splitMenuIcon(intent: EnvironmentActionIntent): ((props?: { class?: string }) => JSX.Element) | null {
  switch (intent) {
    case 'stop_runtime':
      return Stop;
    case 'start_runtime':
      return Play;
    case 'restart_runtime':
      return Refresh;
    case 'update_runtime':
      return Refresh;
    case 'refresh_runtime':
      return Refresh;
    case 'connect_provider_runtime':
      return ShieldCheck;
    case 'disconnect_provider_runtime':
      return Shield;
    default:
      return null;
  }
}

function splitMenuItemToneData(intent: EnvironmentActionIntent): string {
  switch (intent) {
    case 'stop_runtime':
      return 'danger';
    case 'start_runtime':
    case 'connect_provider_runtime':
      return 'primary';
    case 'disconnect_provider_runtime':
      return 'accent';
    default:
      return '';
  }
}

function progressTriggerClassName(presentation: EnvironmentProgressPrimaryPresentation): string {
  return presentation.kind === 'progress_trigger'
    ? 'redeven-split-action-trigger--progress'
    : 'redeven-split-action-trigger--attention';
}

function localizedPrimaryProgressPresentation(
  i18n: DesktopI18n,
  presentation: EnvironmentProgressPrimaryPresentation | null,
): EnvironmentProgressPrimaryPresentation | null {
  if (!presentation) {
    return null;
  }
  const label = localizedStringByValue(i18n, presentation.label, {
    'Canceling...': 'progress.canceling',
    'Cleaning up...': 'progress.cleaningUp',
    'Opening...': 'progress.opening',
    'Stopping...': 'progress.stoppingEllipsis',
    'Restarting...': 'progress.restartingEllipsis',
    'Updating...': 'progress.updatingEllipsis',
    'Starting...': 'progress.startingEllipsis',
    'Cleanup failed': 'progress.cleanupFailed',
    'Open failed': 'progress.openFailed',
    'Start failed': 'progress.startFailed',
    'Restart failed': 'progress.restartFailed',
    'Update failed': 'progress.updateFailed',
    'Stop failed': 'progress.stopFailed',
    'Needs attention': 'progress.needsAttention',
  });
  return {
    ...presentation,
    label,
    ariaLabel: presentation.kind === 'progress_trigger'
      ? i18n.t('progress.showProgress', { label })
      : i18n.t('progress.showDetails', { label }),
  };
}

function EnvironmentSplitActionButton(props: Readonly<{
  i18n: DesktopI18n;
  presentation: Extract<EnvironmentActionPresentation, Readonly<{ kind: 'split_button' }>>;
  environmentID: string;
  environmentLabel: string;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  progressOpen: boolean;
  onProgressOpenChange: (open: boolean) => void;
  guidanceSession: EnvironmentGuidanceSessionState;
  busyState?: DesktopLauncherBusyState;
  loading?: boolean;
  runtimeLifecycleProgress?: DesktopLauncherActionProgress | null;
  openConnectionProgress?: DesktopLauncherActionProgress | null;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  refreshEnvironmentRuntime: () => void;
  runDesktopUpdateHandoff: (environmentID: string, label?: string) => Promise<void>;
  onRunAction: (action: EnvironmentActionModel) => void;
  onRunGuidanceAction: (action: EnvironmentActionModel) => void;
}>) {
  const hasMenuActions = createMemo(() => props.presentation.menu_actions.length > 0);
  const guidanceNotice = createMemo(() => guidanceSessionNotice(props.guidanceSession));
  const sessionPopoverOverlay = createMemo<Extract<EnvironmentPrimaryActionOverlayModel, Readonly<{ kind: 'popover' }>> | undefined>(() => {
    const notice = guidanceNotice();
    if (!notice) {
      return undefined;
    }
    return {
      kind: 'popover',
      tone: notice.tone === 'warning' ? 'warning' : 'neutral',
      eyebrow: notice.tone === 'success' ? props.i18n.t('progress.ready') : notice.tone === 'error' ? props.i18n.t('progress.needsAttention') : props.i18n.t('progress.running'),
      title: localizedOverlayTitle(props.i18n, notice.title),
      detail: localizedRuntimeMessage(props.i18n, notice.detail),
      actions: [],
    };
  });
  const primaryProgress = createMemo(() => props.openConnectionProgress ?? null);
  const runtimeMenuProgress = createMemo(() => props.runtimeLifecycleProgress ?? null);
  const panelProgress = createMemo(() => selectEnvironmentPanelProgress(primaryProgress(), runtimeMenuProgress()));
  const hasPanelProgress = createMemo(() => panelProgress() !== null);
  const progressPanelVisible = createMemo(() => props.progressOpen && hasPanelProgress());
  const primaryProgressPresentation = createMemo(() => localizedPrimaryProgressPresentation(
    props.i18n,
    environmentProgressPrimaryPresentation(panelProgress()),
  ));
  const primaryActionOverlay = createMemo(() => (
    primaryProgressPresentation() || progressPanelVisible()
      ? undefined
      : props.presentation.primary_action_overlay ?? sessionPopoverOverlay()
  ));
  const tooltipOverlay = createMemo<Extract<EnvironmentPrimaryActionOverlayModel, Readonly<{ kind: 'tooltip' }>> | undefined>(() => {
    const overlay = primaryActionOverlay();
    return overlay?.kind === 'tooltip' ? overlay : undefined;
  });
  const popoverOverlay = createMemo<Extract<EnvironmentPrimaryActionOverlayModel, Readonly<{ kind: 'popover' }>> | undefined>(() => {
    const overlay = primaryActionOverlay();
    return overlay?.kind === 'popover' ? overlay : undefined;
  });
  const primaryActionLoading = createMemo(() => (
    props.presentation.primary_action.enabled && props.loading
  ));
  const blockedPrimaryActionDisabled = createMemo(() => (
    popoverOverlay() !== undefined
    && popoverOverlay()!.actions.length > 0
    && !props.presentation.primary_action.enabled
  ));
  const primaryFallbackRunsAction = createMemo(() => (
    props.presentation.primary_action.enabled
    && (popoverOverlay() === undefined || popoverOverlay()?.actions.length === 0)
  ));
  const popoverOpen = createMemo(() => progressPanelVisible() || (props.guidanceOpen && popoverOverlay() !== undefined));
  const shimmerBlocked = createMemo(() => (
    primaryProgressPresentation() ? false : blockedPrimaryActionDisabled()
  ));
  const primaryButtonClass = createMemo(() => (
    cn('w-full justify-center', hasMenuActions() && 'rounded-r-none border-r-0')
  ));
  const renderPrimaryActionIcon = () => (
    props.presentation.primary_action.intent === 'reconnect_provider'
      ? <ShieldCheck class="mr-1 h-3.5 w-3.5" />
      : null
  );
  const renderEnvironmentProgressTriggerIcon = (icon: 'play' | 'stop') => {
    const ProgressIcon = icon === 'stop' ? Stop : Play;
    return <ProgressIcon class="redeven-split-action-trigger__icon h-3.5 w-3.5" />;
  };
  const renderEnvironmentProgressPresentationIcon = (presentation: EnvironmentProgressPrimaryPresentation) => (
    presentation.kind === 'progress_trigger'
      ? renderEnvironmentProgressTriggerIcon(presentation.icon)
      : <AlertTriangle class="redeven-split-action-trigger__icon h-3.5 w-3.5" />
  );
  let rootRef: HTMLDivElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  let menuFocusFrame = 0;

  const closeMenu = () => props.onMenuOpenChange(false);
  const clearMenuFocusFrame = () => {
    if (!menuFocusFrame) {
      return;
    }
    cancelAnimationFrame(menuFocusFrame);
    menuFocusFrame = 0;
  };
  const menuContainsTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) {
      return false;
    }
    return rootRef?.contains(target) === true || menuRef?.contains(target) === true;
  };

  createEffect(() => {
    if (!props.menuOpen) {
      clearMenuFocusFrame();
      return;
    }

    menuFocusFrame = requestAnimationFrame(() => {
      menuFocusFrame = 0;
      firstEnabledMenuItem(menuRef)?.focus();
    });

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuContainsTarget(event.target)) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      clearMenuFocusFrame();
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  onCleanup(() => {
    clearMenuFocusFrame();
    menuRef = undefined;
  });

  const renderPrimaryButton = () => (
    <Button
      size="sm"
      variant={props.presentation.primary_action.variant}
      class={primaryButtonClass()}
      style={{ 'min-width': 'var(--redeven-split-action-primary-min-width)' }}
      loading={primaryActionLoading()}
      disabled={!props.presentation.primary_action.enabled}
      onClick={() => {
        closeMenu();
        props.onProgressOpenChange(false);
        props.onRunAction(props.presentation.primary_action);
      }}
    >
      {renderPrimaryActionIcon()}
      {props.presentation.primary_action.label}
    </Button>
  );
  return (
    <div ref={rootRef} class="redeven-split-action flex-1">
      <div class="redeven-split-action-primary">
        <Show
          when={hasPanelProgress() || popoverOverlay()}
          fallback={(
            <Show when={tooltipOverlay()} fallback={renderPrimaryButton()}>
              <DesktopTooltip
                content={tooltipOverlay()!.message}
                placement="top"
                anchorClass="flex w-full"
              >
                {renderPrimaryButton()}
              </DesktopTooltip>
            </Show>
          )}
        >
          <DesktopActionPopover
            open={popoverOpen()}
            onOpenChange={(open) => {
              if (open) {
                closeMenu();
              }
              if (hasPanelProgress() && (open || progressPanelVisible())) {
                props.onProgressOpenChange(open);
                return;
              }
              props.onGuidanceOpenChange(open);
            }}
            content={(
              <div style={{ display: 'grid' }}>
                <div
                  class="redeven-popover-panel-collapse"
                  classList={{ 'redeven-popover-panel-collapse--open': !progressPanelVisible() }}
                >
                  <div>
                    <Show when={popoverOverlay()}>
                      {(overlay) => (
                        <EnvironmentPrimaryActionPanel
                          i18n={props.i18n}
                          overlay={overlay()}
                          environmentID={props.environmentID}
                          busyState={props.busyState}
                          runtimeLifecycleProgress={runtimeMenuProgress()}
                          session={props.guidanceSession}
                          onRunAction={(action) => {
                            closeMenu();
                            props.onRunGuidanceAction(action);
                          }}
                        />
                      )}
                    </Show>
                  </div>
                </div>
                <div
                  class="redeven-popover-panel-collapse"
                  classList={{ 'redeven-popover-panel-collapse--open': progressPanelVisible() }}
                >
                  <div>
                    <Show when={panelProgress()}>
                      {(p) => (
                        <EnvironmentProgressPanel
                          i18n={props.i18n}
                          progress={p()}
                          primaryAction={props.presentation.primary_action}
                          primaryActionBusy={props.loading === true}
                          cancelOperation={props.cancelOperation}
                          dismissOperation={(progress) => {
                            props.dismissOperation(progress);
                            props.onProgressOpenChange(false);
                          }}
                          copyOperationDiagnostics={props.copyOperationDiagnostics}
                          runNextAction={(action, progress) => {
                            switch (action.kind) {
                              case 'refresh_status':
                                props.refreshEnvironmentRuntime();
                                break;
                              case 'update_runtime': {
                                const updateAction = props.presentation.menu_actions.find((item) => item.action.intent === 'update_runtime')?.action;
                                if (updateAction) {
                                  props.onRunAction(updateAction);
                                }
                                break;
                              }
                              case 'manage_desktop_update': {
                                const desktopUpdateAction = props.presentation.menu_actions.find((item) => (
                                  item.action.intent === 'update_runtime'
                                  && item.action.runtime_operation_method === 'desktop_local_update_handoff'
                                ))?.action;
                                if (desktopUpdateAction) {
                                  props.onRunAction(desktopUpdateAction);
                                  break;
                                }
                                void props.runDesktopUpdateHandoff(props.environmentID, props.environmentLabel);
                                break;
                              }
                              case 'copy_diagnostics':
                                props.copyOperationDiagnostics(progress);
                                break;
                              case 'dismiss':
                                props.dismissOperation(progress);
                                props.onProgressOpenChange(false);
                                break;
                            }
                          }}
                          runPrimaryAction={(action) => {
                            props.onProgressOpenChange(false);
                            closeMenu();
                            props.onRunAction(action);
                          }}
                        />
                      )}
                    </Show>
                  </div>
                </div>
              </div>
            )}
            anchorClass="flex w-full"
            popoverAriaLabel={
              progressPanelVisible()
                ? (panelProgress() ? localizedProgressTitle(props.i18n, panelProgress()!) : props.i18n.t('progress.environmentProgress'))
                : (popoverOverlay()?.title ?? '')
            }
          >
            <Show
              when={primaryProgressPresentation()}
              fallback={(
                <Button
                  size="sm"
                  variant={props.presentation.primary_action.variant}
                  class={cn(
                    primaryButtonClass(),
                    blockedPrimaryActionDisabled() && 'redeven-split-action-trigger--blocked',
                  )}
                  style={{ 'min-width': 'var(--redeven-split-action-primary-min-width)' }}
                  disabled={props.loading && primaryFallbackRunsAction()}
                  aria-disabled={blockedPrimaryActionDisabled() ? true : undefined}
                  aria-haspopup={popoverOverlay() ? 'dialog' : undefined}
                  aria-expanded={popoverOverlay() ? props.guidanceOpen : undefined}
                  aria-label={blockedPrimaryActionDisabled() ? blockedPrimaryActionTriggerLabel(props.i18n, props.presentation.primary_action.label) : undefined}
                  onClick={() => {
                    closeMenu();
                    if (primaryFallbackRunsAction()) {
                      props.onGuidanceOpenChange(false);
                      props.onProgressOpenChange(false);
                      props.onRunAction(props.presentation.primary_action);
                      return;
                    }
                    props.onProgressOpenChange(false);
                    props.onGuidanceOpenChange(!props.guidanceOpen);
                  }}
                >
                  <Show
                    when={blockedPrimaryActionDisabled()}
                    fallback={props.presentation.primary_action.label}
                  >
                    <span class="redeven-split-action-trigger__content">
                      {props.presentation.primary_action.intent === 'reconnect_provider'
                        ? <ShieldCheck class="redeven-split-action-trigger__icon h-3.5 w-3.5" />
                        : <Lock class="redeven-split-action-trigger__icon h-3.5 w-3.5" />}
                      <span>{props.presentation.primary_action.label}</span>
                    </span>
                  </Show>
                </Button>
              )}
            >
              {(presentation) => {
                return (
                  <Button
                    size="sm"
                    variant={props.presentation.primary_action.variant}
                    class={cn(
                      primaryButtonClass(),
                      progressTriggerClassName(presentation()),
                    )}
                    style={{ 'min-width': 'var(--redeven-split-action-primary-min-width)' }}
                    aria-haspopup="dialog"
                    aria-expanded={props.progressOpen}
                    aria-label={presentation().ariaLabel}
                    onClick={() => {
                      closeMenu();
                      props.onProgressOpenChange(!props.progressOpen);
                    }}
                  >
                    <span class="redeven-split-action-trigger__content">
                      {renderEnvironmentProgressPresentationIcon(presentation())}
                      <span>{presentation().label}</span>
                    </span>
                  </Button>
                );
              }}
            </Show>
          </DesktopActionPopover>
        </Show>
        <Presence>
          <Show when={props.loading}>
            <Motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              class={shimmerBlocked() ? 'redeven-blocked-shimmer-overlay' : 'redeven-loading-shimmer-overlay'}
            />
          </Show>
        </Presence>
      </div>
      <Show when={hasMenuActions()}>
        <button
          type="button"
          class="redeven-split-action-toggle"
          aria-label={props.presentation.menu_button_label}
          aria-haspopup="menu"
          aria-expanded={props.menuOpen}
          disabled={props.loading && !primaryProgressPresentation()}
          onClick={() => props.onMenuOpenChange(!props.menuOpen)}
        >
          <ChevronDown class={cn('h-3.5 w-3.5 transition-transform duration-150', props.menuOpen && 'rotate-180')} />
        </button>
      </Show>
      <Show when={props.menuOpen && hasMenuActions()}>
        <DesktopAnchoredOverlaySurface
          open={props.menuOpen && hasMenuActions()}
          anchorRef={rootRef}
          placement="top"
          role="menu"
          ariaLabel={props.presentation.menu_button_label}
          interactive
          hideArrow
          class="redeven-split-menu z-[230] max-w-[min(16rem,calc(100vw-1rem))]"
          onOverlayRef={(element) => {
            menuRef = element;
          }}
        >
          <For each={props.presentation.menu_actions}>
            {(item: EnvironmentActionMenuItemModel) => {
              const icon = () => splitMenuIcon(item.action.intent);
              const tone = () => splitMenuItemToneData(item.action.intent);
              return (
                <button
                    type="button"
                    role="menuitem"
                    class="redeven-split-menu-item"
                    data-tone={tone() || undefined}
                    disabled={!item.action.enabled}
                    title={!item.action.enabled ? item.action.disabled_reason : undefined}
                    aria-describedby={!item.action.enabled && item.action.disabled_reason ? `${props.environmentID}-${item.id}-disabled-reason` : undefined}
                    onClick={() => {
                      closeMenu();
                      props.onRunAction(item.action);
                    }}
                  >
                    <Show when={icon()}>
                      {(Icon) => {
                        const MenuIcon = Icon();
                        return (
                          <span class="redeven-split-menu-item-icon">
                            <MenuIcon />
                          </span>
                        );
                      }}
                    </Show>
                    {item.label}
                    <Show when={!item.action.enabled && item.action.disabled_reason}>
                      <span id={`${props.environmentID}-${item.id}-disabled-reason`} class="sr-only">
                        {item.action.disabled_reason}
                      </span>
                    </Show>
                  </button>
              );
            }}
          </For>
        </DesktopAnchoredOverlaySurface>
      </Show>
    </div>
  );
}

function QuickCreateConnectionCard(props: Readonly<{
  title: string;
  badge: string;
  detail: string;
  actionLabel: string;
  onClick: () => void;
}>) {
  return (
    <Card class="redeven-environment-card redeven-console-card redeven-quick-add-card h-full overflow-hidden border shadow-sm">
      <CardHeader class="px-3.5 pb-2.5 pt-3.5">
        <div class="flex items-start gap-3">
          <ConsoleIconTile><Plus class="h-4 w-4" /></ConsoleIconTile>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <CardTitle class="truncate text-sm font-semibold">{props.title}</CardTitle>
                <div class="mt-1 text-xs leading-5 text-muted-foreground">{props.detail}</div>
              </div>
              <ConsoleBadge>{props.badge}</ConsoleBadge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardFooter class="mt-auto border-t border-border/70 px-3.5 py-2.5">
        <Button size="sm" variant="outline" class="w-full" onClick={props.onClick}>
          <Plus class="mr-1 h-3.5 w-3.5" />
          {props.actionLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}

function EnvironmentConnectionCard(props: Readonly<{
  i18n: DesktopI18n;
  environment: DesktopEnvironmentEntry;
  busyState: DesktopLauncherBusyState;
  actionProgress: readonly DesktopLauncherActionProgress[];
  runtimeMenuOpen: boolean;
  onRuntimeMenuOpenChange: (open: boolean) => void;
  primaryActionGuidanceOpen: boolean;
  onPrimaryActionGuidanceOpenChange: (open: boolean) => void;
  lifecycleProgressOpen: boolean;
  onLifecycleProgressOpenChange: (open: boolean) => void;
  lifecycleDisclosure: EnvironmentLifecycleDisclosureState;
  guidanceSession: EnvironmentGuidanceSessionState;
  setGuidanceSession: (state: EnvironmentGuidanceSessionState) => void;
  beginLifecycleDisclosure: (intent: EnvironmentLifecycleDisclosureIntent) => void;
  openEnvironment: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog',
    route?: 'auto' | DesktopLocalEnvironmentStateRoute,
  ) => Promise<boolean>;
  runLocalEnvironmentAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  refreshEnvironmentRuntime: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  openEnvironmentFlowerComposer: (environment: DesktopEnvironmentEntry, anchor?: { x: number; y: number }) => void;
  runEnvironmentGuidanceAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
  ) => Promise<EnvironmentGuidanceActionResolution>;
  runDesktopUpdateHandoff: (environmentID: string, label?: string) => Promise<void>;
  runEnvironmentCardFactAction: (action: EnvironmentCardFactActionModel) => void;
  toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  environmentFailure: EnvironmentFailureState | null;
  dismissEnvironmentFailure: () => void;
}>) {
  const card = createMemo(() => {
    const model = buildEnvironmentCardModel(props.environment);
    return {
      ...model,
      kind_label: localizedFactLabel(props.i18n, model.kind_label),
      status_label: localizedEnvironmentStatusLabel(props.i18n, model.status_label),
      runtime_started_label: localizedRuntimeStartedLabel(props.i18n, model.runtime_started_label),
    };
  });
  const facts = createMemo(() => buildEnvironmentCardFactsModel(props.environment).map((fact) => (
    localizedEnvironmentFact(props.i18n, fact)
  )));

  const environmentActionModel = createMemo(() => buildProviderBackedEnvironmentActionModel(props.environment));
  const environmentActionPresentation = createMemo(() => localizedEnvironmentActionPresentation(
    props.i18n,
    environmentActionModel().action_presentation,
  ));
  const runtimeLifecycleProgress = createMemo(() => (
    selectedSnapshotRuntimeLifecycleProgressForEnvironment(props.environment, props.actionProgress)
  ));
  const openConnectionProgress = createMemo(() => (
    selectedSnapshotOpenConnectionProgressForEnvironment(props.environment, props.actionProgress)
  ));
  const [rememberedOpenConnectionProgress, setRememberedOpenConnectionProgress] = createSignal<DesktopLauncherActionProgress | null>(null);
  const visibleOpenConnectionProgress = createMemo(() => (
    openConnectionProgress() ?? rememberedOpenConnectionProgress()
  ));
  createEffect(() => {
    const progress = openConnectionProgress();
    if (!progress?.open_progress) {
      if (!props.lifecycleProgressOpen) {
        setRememberedOpenConnectionProgress(null);
      }
      return;
    }
    if (progress.status === 'succeeded' || progress.status === 'canceled') {
      if (props.lifecycleProgressOpen) {
        setRememberedOpenConnectionProgress(progress);
      }
      return;
    }
    setRememberedOpenConnectionProgress(null);
  });
  createEffect(() => {
    if (!props.lifecycleProgressOpen) {
      setRememberedOpenConnectionProgress(null);
    }
  });
  const visibleRuntimeLifecycleProgress = createMemo(() => visibleEnvironmentLifecycleProgress({
    environment: props.environment,
    selectedProgress: runtimeLifecycleProgress(),
    disclosure: props.lifecycleDisclosure,
    busyState: props.busyState,
  }));
  const isCardOpen = createMemo(() => props.environment.window_state === 'open');
  const windowBusyActions = [
    'open_local_environment',
    'open_provider_environment',
    'open_remote_environment',
    'open_ssh_environment',
    'prepare_environment_open',
    'focus_environment_window',
  ] as const;
  const runtimeBusyActions = [
    'start_environment_runtime',
    'restart_environment_runtime',
    'update_environment_runtime',
    'manage_desktop_update',
    'stop_environment_runtime',
    'refresh_environment_runtime',
  ] as const;
  const isWindowActionBusy = createMemo(() => (
    busyStateBlocksEnvironmentAction(
      props.busyState,
      props.environment.id,
      windowBusyActions,
      openConnectionProgress(),
    )
    || launcherProgressBlocksPrimaryAction(openConnectionProgress())
  ));
  const isRuntimeActionBusy = createMemo(() => (
    busyStateBlocksEnvironmentAction(
      props.busyState,
      props.environment.id,
      runtimeBusyActions,
      runtimeLifecycleProgress(),
    )
    || busyStateMatchesAction(props.busyState, 'refresh_all_environment_runtimes')
    || launcherProgressBlocksPrimaryAction(runtimeLifecycleProgress())
  ));
  const isPinBusy = createMemo(() => (
    busyStateMatchesEnvironment(props.busyState, props.environment.id, [
      'set_local_environment_pinned',
      'set_provider_environment_pinned',
      'set_saved_environment_pinned',
      'set_saved_ssh_environment_pinned',
      'set_saved_runtime_target_pinned',
    ])
  ));
  const isContainerRuntimeTarget = createMemo(() => props.environment.managed_runtime_placement?.kind === 'container_process');
  const deleteTitle = createMemo(() => (
    isContainerRuntimeTarget()
      ? props.i18n.t('environmentCenter.deleteRuntimeTarget')
      : props.i18n.t('environmentCenter.deleteConnection')
  ));

  return (
    <Card class={cn(
      'redeven-environment-card h-full overflow-hidden',
      isCardOpen() && 'redeven-environment-card--open',
      props.environmentFailure && 'redeven-environment-card--failure',
      props.environmentFailure?.failure.severity === 'error' && 'redeven-environment-card--failure-error',
      props.environmentFailure?.failure.severity === 'warning' && 'redeven-environment-card--failure-warning',
    )}>
      <CardHeader class="px-4 pb-2.5 pt-4">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="mb-2 flex items-center gap-2">
              <Tag variant={environmentKindTagVariant(props.environment.kind)} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                {card().kind_label}
              </Tag>
              <EnvironmentStatusIndicator tone={card().status_tone}>
                {card().status_label}
              </EnvironmentStatusIndicator>
              <Show when={props.environmentFailure}>
                {(failure) => {
                  const [popoverOpen, setPopoverOpen] = createSignal(false);
                  const [copied, setCopied] = createSignal(false);
                  const presentation = createMemo(() => localizedFailureForDisplay(props.i18n, failure().failure));

                  const handleCopy = async () => {
                    await copyToClipboard(formatDesktopOperationFailureForClipboard(presentation()));
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  };

                  return (
                    <DesktopPopover
                      open={popoverOpen()}
                      onOpenChange={setPopoverOpen}
                      placement="bottom"
                      delay={300}
                      closeDelay={150}
                      content={
                        <div class="py-2.5 px-3">
                          <div class="flex items-center gap-1.5 mb-1.5">
                            <Show
                              when={presentation().severity === 'error'}
                              fallback={<AlertTriangle class="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                            >
                              <AlertCircle class="h-3.5 w-3.5 shrink-0 text-red-400" />
                            </Show>
                            <span class="text-xs font-semibold">
                              {presentation().title}
                            </span>
                            <button
                              type="button"
                              class="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                              aria-label={props.i18n.t('environmentCenter.copyErrorMessage')}
                              onClick={(e) => { e.stopPropagation(); void handleCopy(); }}
                            >
                              <Show when={copied()} fallback={<Copy class="h-3 w-3" />}>
                                <Check class="h-3 w-3" />
                              </Show>
                              <span>{copied() ? props.i18n.t('environmentCenter.copied') : props.i18n.t('common.copy')}</span>
                            </button>
                          </div>
                          <div class="space-y-1.5">
                            <p class="text-xs leading-relaxed text-foreground break-words">
                              {presentation().summary}
                            </p>
                            <Show when={presentation().detail}>
                              {(detail) => <p class="text-xs leading-relaxed text-muted-foreground break-words">{detail()}</p>}
                            </Show>
                            <Show when={presentation().recovery_hint}>
                              {(hint) => <p class="text-xs leading-relaxed text-muted-foreground break-words">{hint()}</p>}
                            </Show>
                            <Show when={(presentation().diagnostics ?? []).length > 0}>
                              <details class="redeven-environment-card__failure-details">
                                <summary>{props.i18n.t('settings.detailsTitle')}</summary>
                                <div class="mt-1.5 space-y-1.5">
                                  <For each={presentation().diagnostics ?? []}>
                                    {(diagnostic) => (
                                      <div>
                                        <div class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                          {diagnostic.label}
                                        </div>
                                        <pre class="redeven-environment-card__failure-diagnostic">{diagnostic.text}</pre>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </details>
                            </Show>
                          </div>
                        </div>
                      }
                    >
                      <span
                        class="redeven-environment-card__failure-badge"
                        data-tone={presentation().severity}
                        onClick={props.dismissEnvironmentFailure}
                        role="button"
                        tabIndex={0}
                        aria-label={props.i18n.t('environmentCenter.dismissStartupFailureAriaLabel', { summary: presentation().summary })}
                      >
                        <span class="redeven-environment-card__failure-badge-icon" aria-hidden="true">!</span>
                      </span>
                    </DesktopPopover>
                  );
                }}
              </Show>
            </div>
            <CardTitle class="truncate text-sm font-semibold leading-5 tracking-[0.01em]" title={props.environment.label}>
              {props.environment.label}
            </CardTitle>
            <div class="mt-1.5 flex flex-wrap items-center">
              <svg class="redeven-card-l-line" data-tone={card().status_tone} viewBox="0 0 12 20"><path d="M 1 0 L 1 10 L 11 10" /></svg><span class="redeven-card-runtime-chip">
                <span class="redeven-card-runtime-chip__dot" aria-hidden="true" />
                <span class="redeven-card-runtime-chip__text">{card().runtime_started_label}</span>
              </span>
              <Show when={props.environment.control_plane_label}>
                {(cpLabel) => (
                  <span class="redeven-card-runtime-domain ml-1.5">
                    <Globe class="h-3 w-3" />
                    {cpLabel()}
                  </span>
                )}
              </Show>
            </div>
          </div>
          <DesktopTooltip content={props.i18n.t('environmentCenter.refreshRuntimeStatus')} placement="top">
            <span>
              <ConsoleActionIconButton
                title={props.i18n.t('environmentCenter.refreshRuntimeStatus')}
                aria-label={props.i18n.t('environmentCenter.refreshRuntimeStatusForLabel', { label: props.environment.label })}
                disabled={isRuntimeActionBusy()}
                onClick={() => {
                  void props.refreshEnvironmentRuntime(props.environment, 'connect');
                }}
              >
                <Refresh class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </span>
          </DesktopTooltip>
          <DesktopTooltip content={props.i18n.t('environmentCenter.askFlowerForLabel', { label: props.environment.label })} placement="top">
            <button
              type="button"
              class="redeven-environment-card__flower-button"
              aria-label={props.i18n.t('environmentCenter.askFlowerForLabel', { label: props.environment.label })}
              title={props.i18n.t('environmentCenter.askFlowerForLabel', { label: props.environment.label })}
              onClick={(event) => {
                event.stopPropagation();
                props.openEnvironmentFlowerComposer(props.environment, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <FlowerSoftAuraIcon
                class="redeven-environment-card__flower-aura"
                iconClass="redeven-environment-card__flower-icon"
                glowClass="redeven-environment-card__flower-glow"
              />
            </button>
          </DesktopTooltip>
        </div>
      </CardHeader>
      <CardContent class="flex flex-1 flex-col px-4 pb-3">
        <EnvironmentCardFactsBlock
          i18n={props.i18n}
          facts={facts()}
          minRows={3}
          onFactAction={props.runEnvironmentCardFactAction}
          copyEnvironmentValue={props.copyEnvironmentValue}
        />
      </CardContent>
      <CardFooter class="mt-auto flex items-center gap-2 border-t border-border/60 px-4 pt-3 pb-2.5">
        <EnvironmentSplitActionButton
          i18n={props.i18n}
          presentation={environmentActionPresentation()}
          environmentID={props.environment.id}
          environmentLabel={props.environment.label}
          menuOpen={props.runtimeMenuOpen}
          onMenuOpenChange={props.onRuntimeMenuOpenChange}
          guidanceOpen={props.primaryActionGuidanceOpen}
          onGuidanceOpenChange={props.onPrimaryActionGuidanceOpenChange}
          progressOpen={props.lifecycleProgressOpen}
          onProgressOpenChange={props.onLifecycleProgressOpenChange}
          guidanceSession={props.guidanceSession}
          busyState={props.busyState}
          loading={isWindowActionBusy() || isRuntimeActionBusy()}
          runtimeLifecycleProgress={visibleRuntimeLifecycleProgress()}
          openConnectionProgress={visibleOpenConnectionProgress()}
          cancelOperation={props.cancelOperation}
          dismissOperation={props.dismissOperation}
          copyOperationDiagnostics={props.copyOperationDiagnostics}
          refreshEnvironmentRuntime={() => {
            void props.refreshEnvironmentRuntime(props.environment, 'connect');
          }}
          runDesktopUpdateHandoff={async (environmentID, label) => {
            await props.runDesktopUpdateHandoff(environmentID, label);
          }}
          onRunAction={(action) => {
            if (environmentActionStartsLifecycleDisclosure(action)) {
              props.beginLifecycleDisclosure(action.intent);
            } else if (isEnvironmentGuidancePendingIntent(action.intent)) {
              props.setGuidanceSession(startEnvironmentGuidanceIntent(
                props.guidanceSession,
                props.environment.id,
                action.intent,
              ));
              props.onPrimaryActionGuidanceOpenChange(true);
            }
            void props.runLocalEnvironmentAction(
              props.environment,
              action,
              'connect',
            );
          }}
          onRunGuidanceAction={(action) => {
            void (async () => {
              const startsLifecycleDisclosure = environmentActionStartsLifecycleDisclosure(action);
              if (startsLifecycleDisclosure) {
                props.beginLifecycleDisclosure(action.intent);
              } else if (isEnvironmentGuidancePendingIntent(action.intent)) {
                props.setGuidanceSession(startEnvironmentGuidanceIntent(
                  props.guidanceSession,
                  props.environment.id,
                  action.intent,
                ));
              }
              const resolution = await props.runEnvironmentGuidanceAction(props.environment, action);
              props.setGuidanceSession(startsLifecycleDisclosure ? null : resolution.next_session);
              if (resolution.close_panel) {
                props.onPrimaryActionGuidanceOpenChange(false);
              }
            })();
          }}
        />
        <div class="flex items-center gap-0.5">
          <DesktopTooltip
            content={props.environment.pinned ? props.i18n.t('environmentCenter.unpin') : props.i18n.t('environmentCenter.pin')}
            placement="top"
          >
            <ConsoleActionIconButton
              title={props.environment.pinned ? props.i18n.t('environmentCenter.unpinEnvironment') : props.i18n.t('environmentCenter.pinEnvironment')}
              aria-label={props.environment.pinned
                ? props.i18n.t('environmentCenter.unpinLabel', { label: props.environment.label })
                : props.i18n.t('environmentCenter.pinLabel', { label: props.environment.label })}
              active={props.environment.pinned}
              disabled={isPinBusy()}
              onClick={() => {
                void props.toggleEnvironmentPinned(props.environment);
              }}
            >
              <Pin class="h-3.5 w-3.5" />
            </ConsoleActionIconButton>
          </DesktopTooltip>
          <Show when={props.environment.can_edit}>
            <DesktopTooltip
              content={props.i18n.t('common.settings')}
              placement="top"
            >
              <ConsoleActionIconButton
                title={isContainerRuntimeTarget()
                  ? props.i18n.t('environmentCenter.runtimeTargetSettings')
                  : props.environment.kind === 'local_environment'
                    ? props.i18n.t('environmentCenter.environmentSettings')
                    : props.i18n.t('environmentCenter.connectionSettings')}
                aria-label={props.environment.kind === 'local_environment' && !isContainerRuntimeTarget()
                  ? props.i18n.t('environmentCenter.settingsForLabel', { label: props.environment.label })
                  : props.i18n.t('environmentCenter.connectionSettingsForLabel', { label: props.environment.label })}
                onClick={() => props.editEnvironment(props.environment)}
              >
                <Settings class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
          <Show when={props.environment.can_delete}>
            <DesktopTooltip content={props.i18n.t('common.delete')} placement="top">
              <ConsoleActionIconButton
                title={deleteTitle()}
                aria-label={props.i18n.t('environmentCenter.deleteLabel', { label: props.environment.label })}
                danger
                onClick={() => props.deleteEnvironment(props.environment)}
              >
                <Trash class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
        </div>
      </CardFooter>
    </Card>
  );
}

function NewEnvironmentPlaceholderCard(props: Readonly<{
  i18n: DesktopI18n;
  openCreateConnectionDialog: (message?: string, preferredKind?: ConnectionDialogKind) => void;
}>) {
  return (
    <Card class={cn(
      'redeven-environment-card redeven-new-environment-card group h-full cursor-pointer overflow-hidden',
      'border border-dashed border-border/70',
      'transition-[transform,border-color,box-shadow,background-color] duration-200',
      'hover:border-primary/30 hover:bg-gradient-to-br hover:from-primary/[0.03] hover:to-transparent',
    )}
      onClick={() => props.openCreateConnectionDialog()}
    >
      <div class="flex h-full flex-col items-center justify-center gap-4 px-4 py-10">
        <div class="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/20 text-muted-foreground transition-[border-color,background-color,color,transform] duration-200 group-hover:scale-110 group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary">
          <Plus class="h-6 w-6" />
        </div>
        <div class="space-y-1 text-center">
          <div class="text-sm font-semibold text-foreground">{props.i18n.t('environmentCenter.newEnvironmentTitle')}</div>
          <div class="text-xs text-muted-foreground">{props.i18n.t('environmentCenter.newEnvironmentDescription')}</div>
        </div>
        <div class="flex flex-wrap justify-center gap-2">
          <ConsoleChipActionButton
            onClick={(event) => {
              event.stopPropagation();
              props.openCreateConnectionDialog('', 'external_local_ui');
            }}
          >
            URL
          </ConsoleChipActionButton>
          <ConsoleChipActionButton
            onClick={(event) => {
              event.stopPropagation();
              props.openCreateConnectionDialog('', 'ssh_environment');
            }}
          >
            SSH
          </ConsoleChipActionButton>
          <ConsoleChipActionButton
            onClick={(event) => {
              event.stopPropagation();
              props.openCreateConnectionDialog('', 'local_container_runtime');
            }}
          >
            {props.i18n.t('connectionDialog.localContainer')}
          </ConsoleChipActionButton>
          <ConsoleChipActionButton
            onClick={(event) => {
              event.stopPropagation();
              props.openCreateConnectionDialog('', 'ssh_container_runtime');
            }}
          >
            {props.i18n.t('connectionDialog.sshContainer')}
          </ConsoleChipActionButton>
        </div>
      </div>
    </Card>
  );
}

function ControlPlanesPanel(props: Readonly<{
  i18n: DesktopI18n;
  controlPlanes: readonly DesktopControlPlaneSummary[];
  environments: readonly DesktopEnvironmentEntry[];
  busyState: DesktopLauncherBusyState;
  openCreateControlPlaneDialog: (message?: string) => void;
  viewControlPlaneEnvironments: (controlPlane: DesktopControlPlaneSummary) => void;
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  deleteControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
}>) {
  return (
    <div class="space-y-3">
      <Show
        when={props.controlPlanes.length > 0}
        fallback={(
          <div class="redeven-control-plane-grid">
            <div class="redeven-control-plane-card">
              <QuickCreateConnectionCard
                title={props.i18n.t('environmentCenter.addProviderTitle')}
                badge={props.i18n.t('environmentCenter.addProviderBadge')}
                detail={props.i18n.t('environmentCenter.addProviderDescription')}
                actionLabel={props.i18n.t('environmentCenter.connectProvider')}
                onClick={() => props.openCreateControlPlaneDialog()}
              />
            </div>
          </div>
        )}
      >
        <div class="redeven-control-plane-grid">
          <For each={props.controlPlanes}>
            {(controlPlane) => (
              <ControlPlaneShelf
                i18n={props.i18n}
                controlPlane={controlPlane}
                environments={props.environments}
                busyState={props.busyState}
                viewControlPlaneEnvironments={props.viewControlPlaneEnvironments}
                reconnectControlPlane={props.reconnectControlPlane}
                refreshControlPlane={props.refreshControlPlane}
                deleteControlPlane={props.deleteControlPlane}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function controlPlaneLocalEnvironmentStats(
  controlPlane: DesktopControlPlaneSummary,
  environments: readonly DesktopEnvironmentEntry[],
): Readonly<{
  online_count: number;
  local_host_count: number;
  open_count: number;
}> {
  const providerFilter = controlPlaneFilterValue(controlPlane);
  const matchedEntries = environments.filter((environment) => (
    environment.kind === 'provider_environment'
    && environmentProviderFilterValue(environment) === providerFilter
  ));
  return {
    online_count: desktopProviderOnlineEnvironmentCount(controlPlane.environments),
    local_host_count: 0,
    open_count: matchedEntries.filter((environment) => environment.is_open).length,
  };
}

function ControlPlaneMetricTooltipContent(props: Readonly<{
  title: string;
  description: string;
  status?: string;
}>) {
  const status = createMemo(() => trimString(props.status));

  return (
    <div class="max-w-[17rem] space-y-1.5">
      <div class="text-xs font-semibold leading-4 text-foreground">{props.title}</div>
      <div class="text-[11px] leading-5 text-muted-foreground">{props.description}</div>
      <Show when={status()}>
        <div class="rounded-md border border-border/70 bg-muted/35 px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">
          {status()}
        </div>
      </Show>
    </div>
  );
}

function controlPlanePublishedCountTooltipContent(
  i18n: DesktopI18n,
  controlPlane: DesktopControlPlaneSummary,
): JSX.Element {
  return (
    <ControlPlaneMetricTooltipContent
      title={i18n.t('environmentCenter.publishedTooltipTitle')}
      description={i18n.t('environmentCenter.publishedTooltipDescription')}
      status={controlPlane.environments.length === 0
        ? i18n.t('environmentCenter.publishedTooltipEmpty')
        : undefined}
    />
  );
}

function controlPlaneOnlineCountTooltipContent(
  i18n: DesktopI18n,
  controlPlane: DesktopControlPlaneSummary,
  onlineCount: number,
): JSX.Element {
  const status = (() => {
    if (controlPlane.sync_state === 'syncing') {
      return i18n.t('environmentCenter.onlineTooltipSyncing');
    }

    if (controlPlane.sync_state === 'ready' && controlPlane.catalog_freshness === 'fresh') {
      return onlineCount > 0
        ? i18n.t('environmentCenter.onlineTooltipFreshOnline')
        : i18n.t('environmentCenter.onlineTooltipFreshNone');
    }

    return onlineCount > 0
      ? i18n.t('environmentCenter.onlineTooltipStaleOnline')
      : i18n.t('environmentCenter.onlineTooltipStaleNone');
  })();

  return (
    <ControlPlaneMetricTooltipContent
      title={i18n.t('environmentCenter.onlineTooltipTitle')}
      description={i18n.t('environmentCenter.onlineTooltipDescription')}
      status={status}
    />
  );
}

function controlPlaneLocalHostCountTooltipContent(
  i18n: DesktopI18n,
  stats: Readonly<{
    local_host_count: number;
    open_count: number;
  }>,
  freshestEnvironment: DesktopControlPlaneSummary['environments'][number] | null,
): JSX.Element {
  const runtimeLabel = freshestEnvironment
    ? localizedProviderRuntimeLabel(i18n, desktopProviderEnvironmentRuntimeLabel(
      freshestEnvironment.status,
      freshestEnvironment.lifecycle_status,
    ))
    : '';
  const status = stats.open_count > 0
    ? i18n.t(stats.open_count === 1 ? 'environmentCenter.localWindowOpenOne' : 'environmentCenter.localWindowsOpen', {
        count: stats.open_count,
      })
    : runtimeLabel !== ''
      ? i18n.t('environmentCenter.mostRecentProviderState', { state: runtimeLabel })
      : i18n.t('environmentCenter.noProviderRuntimeState');

  return (
    <ControlPlaneMetricTooltipContent
      title={i18n.t('environmentCenter.localLinksTooltipTitle')}
      description={stats.local_host_count > 0
        ? i18n.t('environmentCenter.localLinksTooltipDescription')
        : i18n.t('environmentCenter.localLinksTooltipEmptyDescription')}
      status={status}
    />
  );
}

function localizedProviderRuntimeLabel(i18n: DesktopI18n, label: string): string {
  const parts = trimString(label).split('·').map((part) => trimString(part)).filter(Boolean);
  if (parts.length <= 0) {
    return i18n.t('common.unknown');
  }
  return parts.map((part) => localizedStringByValue(i18n, part, {
    online: 'providerRuntimeState.online',
    offline: 'providerRuntimeState.offline',
    unknown: 'providerRuntimeState.unknown',
    ready: 'providerRuntimeState.ready',
    active: 'providerRuntimeState.active',
    inactive: 'providerRuntimeState.inactive',
    stopped: 'providerRuntimeState.stopped',
    suspended: 'providerRuntimeState.suspended',
  })).join(' · ');
}

function localizedProviderRuntimeTargetLabel(
  i18n: DesktopI18n,
  target: DesktopProviderRuntimeLinkTarget,
): string {
  return target.kind === 'ssh_environment'
    ? i18n.t('providerRuntimeLink.sshRuntime')
    : i18n.t('providerRuntimeLink.localRuntime');
}

function localizedProviderRuntimeLinkPlanMessage(
  i18n: DesktopI18n,
  target: DesktopProviderRuntimeLinkTarget,
  providerEnvironment: DesktopProviderEnvironmentCandidate,
  state: DesktopProviderRuntimeLinkPlanState,
): string {
  const runtimeLabel = localizedProviderRuntimeTargetLabel(i18n, target);
  switch (state) {
    case 'target_ready':
      return i18n.t('providerRuntimeLink.targetReady', { runtime: runtimeLabel, environment: providerEnvironment.label });
    case 'target_not_running':
      return i18n.t('providerRuntimeLink.targetNotRunning', { runtime: runtimeLabel });
    case 'runtime_control_missing':
      return i18n.t('providerRuntimeLink.runtimeControlMissing', { runtime: runtimeLabel });
    case 'provider_link_unsupported':
      return i18n.t('providerRuntimeLink.providerLinkUnsupported', { runtime: runtimeLabel });
    case 'already_linked':
      return i18n.t('providerRuntimeLink.alreadyLinked', { runtime: runtimeLabel, environment: providerEnvironment.label });
    case 'provider_environment_occupied':
      return providerEnvironment.occupancy.state === 'occupied_by_known_runtime' && providerEnvironment.occupancy.runtime_label
        ? i18n.t('providerRuntimeLink.providerEnvironmentOccupiedKnown', {
            environment: providerEnvironment.label,
            runtime: providerEnvironment.occupancy.runtime_label,
          })
        : i18n.t('providerRuntimeLink.providerEnvironmentOccupiedUnknown', { environment: providerEnvironment.label });
    case 'linked_elsewhere':
      return i18n.t('providerRuntimeLink.linkedElsewhere', { runtime: runtimeLabel });
    case 'blocked_active_work':
      return i18n.t('providerRuntimeLink.blockedActiveWork', { runtime: runtimeLabel });
    case 'blocked_owner_mismatch':
      return i18n.t('providerRuntimeLink.blockedOwnerMismatch', { runtime: runtimeLabel });
    case 'blocked_runtime':
      return i18n.t('providerRuntimeLink.blockedRuntime', { runtime: runtimeLabel });
  }
}

function localizedRuntimeServiceWorkload(
  i18n: DesktopI18n,
  workload: RuntimeServiceWorkload | null | undefined,
): string {
  if (!workload) {
    return i18n.t('providerRuntimeLink.noActiveWork');
  }

  const parts = [
    workload.terminal_count > 0
      ? i18n.tn('plural.terminalCount', workload.terminal_count)
      : '',
    workload.session_count > 0
      ? i18n.tn('plural.sessionCount', workload.session_count)
      : '',
    workload.task_count > 0
      ? i18n.tn('plural.taskCount', workload.task_count)
      : '',
    workload.port_forward_count > 0
      ? i18n.tn('plural.portForwardCount', workload.port_forward_count)
      : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(i18n.t('providerRuntimeLink.workloadSeparator')) : i18n.t('providerRuntimeLink.noActiveWork');
}

function localizedControlPlaneStatusModel(
  i18n: DesktopI18n,
  model: ReturnType<typeof buildControlPlaneStatusModel>,
): ReturnType<typeof buildControlPlaneStatusModel> {
  return {
    ...model,
    label: localizedEnvironmentStatusLabel(i18n, model.label),
    detail: localizedRuntimeMessage(i18n, model.detail),
  };
}

function ControlPlaneMetricTile(props: Readonly<{
  i18n: DesktopI18n;
  label: string;
  value: number;
  help: JSX.Element;
}>) {
  return (
    <div class="redeven-provider-shelf__metric redeven-tile rounded-md border border-border/70 px-3 py-3">
      <div class="redeven-provider-shelf__metric-header">
        <div class="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {props.label}
        </div>
        <SettingsHelpBadge label={props.label} content={props.help} i18n={props.i18n} />
      </div>
      <div class="redeven-provider-shelf__metric-value">
        {props.value}
      </div>
    </div>
  );
}

function ControlPlaneShelf(props: Readonly<{
  i18n: DesktopI18n;
  controlPlane: DesktopControlPlaneSummary;
  environments: readonly DesktopEnvironmentEntry[];
  busyState: DesktopLauncherBusyState;
  viewControlPlaneEnvironments: (controlPlane: DesktopControlPlaneSummary) => void;
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  deleteControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
}>) {
  const statusModel = createMemo(() => localizedControlPlaneStatusModel(
    props.i18n,
    buildControlPlaneStatusModel(props.controlPlane),
  ));
  const stats = createMemo(() => controlPlaneLocalEnvironmentStats(
    props.controlPlane,
    props.environments,
  ));
  const freshestEnvironment = createMemo(() => {
    const environments = [...props.controlPlane.environments];
    environments.sort((left, right) => right.last_seen_at_unix_ms - left.last_seen_at_unix_ms);
    return environments[0] ?? null;
  });
  const isReconnectBusy = createMemo(() => busyStateMatchesControlPlane(
    props.busyState,
    props.controlPlane.provider.provider_origin,
    props.controlPlane.provider.provider_id,
    ['start_control_plane_connect'],
  ));
  const isRefreshBusy = createMemo(() => busyStateMatchesControlPlane(
    props.busyState,
    props.controlPlane.provider.provider_origin,
    props.controlPlane.provider.provider_id,
    ['refresh_control_plane'],
  ));

  return (
    <section class="redeven-control-plane-card space-y-2.5">
      <div class="redeven-provider-shelf rounded-lg border border-border bg-card">
        <div class="px-4 py-3">
          <div class="flex" style="flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:0.75rem">
            <div class="flex min-w-0 items-center gap-3">
              <ConsoleIconTile><Shield class="h-4 w-4" /></ConsoleIconTile>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="truncate text-sm font-semibold tracking-tight text-foreground">{controlPlaneName(props.controlPlane)}</div>
                  <ConsoleStatusBadge tone={statusModel().tone}>
                    {statusModel().label}
                  </ConsoleStatusBadge>
                  <ConsoleBadge>{props.controlPlane.provider.display_name}</ConsoleBadge>
                  <ConsoleBadge>{props.i18n.t('environmentCenter.providerEnvsBadge', { count: props.controlPlane.environments.length })}</ConsoleBadge>
                  <Show when={stats().local_host_count > 0}>
                    <ConsoleBadge>{props.i18n.t('environmentCenter.providerLocalLinksBadge', { count: stats().local_host_count })}</ConsoleBadge>
                  </Show>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{props.controlPlane.account.user_display_name}</span>
                  <span class="font-mono text-[11px]">{props.controlPlane.provider.provider_origin}</span>
                  <span>{props.i18n.t('environmentCenter.providerSynced', { time: formatLocalizedRelativeTimestamp(props.i18n, props.controlPlane.last_synced_at_ms) })}</span>
                </div>
              </div>
            </div>
          </div>
          <Show when={statusModel().detail}>
            <div class="redeven-status-detail mt-3">
              {statusModel().detail}
            </div>
          </Show>
          <div class="redeven-provider-shelf__metrics mt-3">
            <ControlPlaneMetricTile
              i18n={props.i18n}
              label={props.i18n.t('environmentCenter.providerPublishedLabel')}
              value={props.controlPlane.environments.length}
              help={controlPlanePublishedCountTooltipContent(props.i18n, props.controlPlane)}
            />
            <ControlPlaneMetricTile
              i18n={props.i18n}
              label={props.i18n.t('environmentCenter.providerOnlineLabel')}
              value={stats().online_count}
              help={controlPlaneOnlineCountTooltipContent(props.i18n, props.controlPlane, stats().online_count)}
            />
            <ControlPlaneMetricTile
              i18n={props.i18n}
              label={props.i18n.t('environmentCenter.providerLocalLinksLabel')}
              value={stats().local_host_count}
              help={controlPlaneLocalHostCountTooltipContent(props.i18n, stats(), freshestEnvironment())}
            />
          </div>
        </div>
        <div class="redeven-provider-shelf__actions">
          <Button
            size="sm"
            variant="default"
            onClick={() => props.viewControlPlaneEnvironments(props.controlPlane)}
          >
            {props.i18n.t('environmentCenter.viewEnvironments')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={isReconnectBusy()}
            onClick={() => {
              void props.reconnectControlPlane(props.controlPlane);
            }}
          >
            {props.i18n.t('environmentCenter.reconnect')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={isRefreshBusy()}
            disabled={props.controlPlane.sync_state === 'syncing'}
            onClick={() => {
              void props.refreshControlPlane(props.controlPlane);
            }}
          >
            {props.i18n.t('common.refresh')}
          </Button>
          <div class="flex-1" />
          <ConsoleActionIconButton
            title={props.i18n.t('environmentCenter.removeProvider')}
            danger
            onClick={() => props.deleteControlPlane(props.controlPlane)}
            aria-label={props.i18n.t('environmentCenter.removeProviderAriaLabel', { label: controlPlaneName(props.controlPlane) })}
          >
            <Trash class="h-4 w-4" />
          </ConsoleActionIconButton>
        </div>
      </div>
    </section>
  );
}

function GatewaySourcesPanel(props: Readonly<{
  i18n: DesktopI18n;
  gatewaySources: readonly DesktopGatewaySource[];
  gatewayEntries: readonly DesktopEnvironmentEntry[];
  busyState: DesktopLauncherBusyState;
  actionProgress: readonly DesktopLauncherActionProgress[];
  gatewaySourceFilter: string;
  gatewayQuery: string;
  openCreateGatewaySetup: (gateway?: DesktopGatewaySource) => void;
  pairGateway: (gatewayID: string, startPolicy?: DesktopGatewayStartPolicy) => Promise<void>;
  runGatewayRuntimeAction: (
    gatewayID: string,
    kind: GatewayRuntimeActionKind,
    startPolicy?: GatewayRuntimeStartPolicy,
  ) => Promise<void>;
  runLocalEnvironmentAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
}>) {
  const [activeGatewayPopoverID, setActiveGatewayPopoverID] = createSignal('');
  const entryGatewayIDs = createMemo(() => new Set(props.gatewayEntries.map((entry) => entry.gateway_id ?? '')));
  const gatewaySourcesByID = createMemo(() => {
    const record: Record<string, DesktopGatewaySource> = {};
    for (const gateway of props.gatewaySources) {
      record[gateway.gateway_id] = gateway;
    }
    return record;
  });
  const gatewayEntriesByGatewayID = createMemo(() => {
    const record: Record<string, DesktopEnvironmentEntry[]> = {};
    for (const entry of props.gatewayEntries) {
      const gatewayID = trimString(entry.gateway_id);
      if (gatewayID === '') {
        continue;
      }
      record[gatewayID] = [...(record[gatewayID] ?? []), entry];
    }
    return record;
  });
  const visibleGatewaySources = createMemo(() => {
    const gatewayIDs = entryGatewayIDs();
    const query = trimString(props.gatewayQuery);
    const hasQuery = query !== '';
    return props.gatewaySources.filter((gateway) => {
      if (props.gatewaySourceFilter !== '' && gatewaySourceFilterValue(gateway.gateway_id) !== props.gatewaySourceFilter) {
        return false;
      }
      return !hasQuery
        || gatewayIDs.has(gateway.gateway_id)
        || gatewaySourceMatchesQuery(gateway, query);
    });
  });
  const visibleGatewaySourceIDs = createMemo(() => visibleGatewaySources().map((gateway) => gateway.gateway_id));

  createEffect(() => {
    const activeGatewayID = activeGatewayPopoverID();
    if (activeGatewayID === '') {
      return;
    }
    if (!visibleGatewaySourceIDs().includes(activeGatewayID)) {
      setActiveGatewayPopoverID('');
    }
  });

  return (
    <Show
      when={props.gatewaySources.length > 0}
      fallback={(
        <div class="redeven-empty-panel rounded-lg border border-dashed border-border/70 bg-card/70 px-5 py-8 text-center">
          <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-md border border-border/70 bg-muted/20 text-muted-foreground">
            <ShieldCheck class="h-5 w-5" />
          </div>
          <div class="mt-4 text-sm font-semibold text-foreground">{props.i18n.t('environmentCenter.noGatewaysTitle')}</div>
          <div class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{props.i18n.t('environmentCenter.noGatewaysDescription')}</div>
          <Button
            size="sm"
            variant="default"
            class="mt-4"
            onClick={() => props.openCreateGatewaySetup()}
          >
            <Plus class="mr-1 h-3.5 w-3.5" />
            {props.i18n.t('environmentCenter.addGateway')}
          </Button>
        </div>
      )}
    >
      <Show
        when={visibleGatewaySources().length > 0}
        fallback={(
          <div class="redeven-empty-panel rounded-lg border border-dashed border-border/70 bg-card/70 px-5 py-8 text-center">
            <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-md border border-border/70 bg-muted/20 text-muted-foreground">
              <Search class="h-5 w-5" />
            </div>
            <div class="mt-4 text-sm font-semibold text-foreground">{props.i18n.t('environmentCenter.noMatchingGatewaysTitle')}</div>
            <div class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{props.i18n.t('environmentCenter.noMatchingGatewaysDescription')}</div>
          </div>
        )}
      >
        <div
          class="redeven-gateway-library"
        >
          <div class="redeven-gateway-grid">
            <For each={visibleGatewaySourceIDs()}>
              {(gatewayID) => {
                const gateway = () => gatewaySourcesByID()[gatewayID]!;
                return (
                <GatewaySourceCard
                  i18n={props.i18n}
                  gateway={gateway()}
                  gatewayEntries={gatewayEntriesByGatewayID()[gatewayID] ?? []}
                  busyState={props.busyState}
                  actionProgress={props.actionProgress}
                  actionPopoverOpen={activeGatewayPopoverID() === gatewayID}
                  onActionPopoverOpenChange={(open) => setActiveGatewayPopoverID(open ? gatewayID : '')}
                  openCreateGatewaySetup={props.openCreateGatewaySetup}
                  pairGateway={props.pairGateway}
                  runGatewayRuntimeAction={props.runGatewayRuntimeAction}
                  runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                  cancelOperation={props.cancelOperation}
                  dismissOperation={props.dismissOperation}
                  copyOperationDiagnostics={props.copyOperationDiagnostics}
                />
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  );
}

function gatewaySourceMatchesQuery(gateway: DesktopGatewaySource, query: string): boolean {
  const normalizedQuery = trimString(query).toLowerCase();
  if (normalizedQuery === '') {
    return true;
  }
  const searchable = [
    gateway.gateway_id,
    gateway.display_name,
    gateway.connection_kind,
    gateway.endpoint_label,
    gateway.status,
    gateway.status_message,
  ];
  return searchable.some((value) => trimString(value).toLowerCase().includes(normalizedQuery));
}

function GatewaySourceCard(props: Readonly<{
  i18n: DesktopI18n;
  gateway: DesktopGatewaySource;
  gatewayEntries: readonly DesktopEnvironmentEntry[];
  busyState: DesktopLauncherBusyState;
  actionProgress: readonly DesktopLauncherActionProgress[];
  actionPopoverOpen: boolean;
  onActionPopoverOpenChange: (open: boolean) => void;
  openCreateGatewaySetup: (gateway?: DesktopGatewaySource) => void;
  pairGateway: (gatewayID: string, startPolicy?: DesktopGatewayStartPolicy) => Promise<void>;
  runGatewayRuntimeAction: (
    gatewayID: string,
    kind: GatewayRuntimeActionKind,
    startPolicy?: GatewayRuntimeStartPolicy,
  ) => Promise<void>;
  runLocalEnvironmentAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
}>) {
  const row = createMemo(() => buildGatewaySourceRowModel(props.gateway));
  const primaryActionLabel = createMemo(() => localizedEnvironmentActionLabel(props.i18n, row().primary_action.label));
  const gatewayLifecycleProgress = createMemo(() => (
    selectedSnapshotRuntimeLifecycleProgressForGateway(props.gateway.gateway_id, props.actionProgress)
  ));
  const visibleGatewayLifecycleProgress = createMemo(() => (
    gatewayLifecycleProgress() ?? (
      gatewaySourceMatchesRuntimeLifecycleProgress(props.gateway.gateway_id, props.busyState.progress)
        ? props.busyState.progress
        : null
    )
  ));
  const primaryBusy = createMemo(() => gatewaySourceActionBusy(
    props.busyState,
    props.gateway.gateway_id,
    row().primary_action,
    visibleGatewayLifecycleProgress(),
  ));
  const progressPresentation = createMemo(() => localizedPrimaryProgressPresentation(
    props.i18n,
    environmentProgressPrimaryPresentation(visibleGatewayLifecycleProgress()),
  ));
  const hasProgressPanel = createMemo(() => visibleGatewayLifecycleProgress() !== null);
  const guidePanelVisible = createMemo(() => (
    props.actionPopoverOpen
    && !hasProgressPanel()
    && gatewaySourceActionGuidePanelVisible(props.gateway, row().primary_action)
  ));
  const progressPanelVisible = createMemo(() => props.actionPopoverOpen && hasProgressPanel());
  const actionPopoverOpen = createMemo(() => progressPanelVisible() || guidePanelVisible());
  const visibleGatewayEntries = createMemo(() => props.gatewayEntries.slice(0, 3));
  const hiddenGatewayEntryCount = createMemo(() => Math.max(0, props.gatewayEntries.length - visibleGatewayEntries().length));
  const secondaryActions = createMemo(() => row().secondary_actions.filter((action) => action.intent !== 'manage_gateway'));
  const hasManageableStartAction = createMemo(() => (
    row().primary_action.intent === 'start_gateway_runtime'
    || row().secondary_actions.some((action) => action.intent === 'start_gateway_runtime')
  ));
  const renderProgressPresentationIcon = (presentation: EnvironmentProgressPrimaryPresentation) => {
    if (presentation.kind === 'attention_trigger') {
      return <AlertTriangle class="redeven-split-action-trigger__icon h-3.5 w-3.5" />;
    }
    return presentation.icon === 'stop'
      ? <Stop class="redeven-split-action-trigger__icon h-3.5 w-3.5" />
      : <Play class="redeven-split-action-trigger__icon h-3.5 w-3.5" />;
  };
  const runAction = (action: GatewaySourceActionModel) => {
    if (gatewaySourceActionStartsWorkflow(action)) {
      props.onActionPopoverOpenChange(true);
    } else if (action.intent === 'setup_gateway' || action.intent === 'manage_gateway' || action.intent === 'resolve_gateway') {
      props.onActionPopoverOpenChange(false);
    }
    void runGatewaySourceAction(action, props.gateway, props.openCreateGatewaySetup, props.pairGateway, props.runGatewayRuntimeAction);
  };

  return (
    <Card class="redeven-environment-card redeven-gateway-card h-full overflow-hidden">
      <CardHeader class="px-4 pb-2.5 pt-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <Tag variant="neutral" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                {row().transport_label}
              </Tag>
              <EnvironmentStatusIndicator tone={row().status_tone}>
                {localizedEnvironmentStatusLabel(props.i18n, row().status_label)}
              </EnvironmentStatusIndicator>
              <ConsoleBadge>{props.i18n.t('environmentCenter.gatewayEnvsBadge', { count: row().environment_count })}</ConsoleBadge>
            </div>
            <CardTitle class="truncate text-sm font-semibold leading-5 tracking-[0.01em]" title={row().label}>
              {row().label}
            </CardTitle>
            <div class="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span class="redeven-gateway-card__management-chip">
                <span class="redeven-gateway-card__management-dot" aria-hidden="true" />
                {row().management_label}
              </span>
              <Show when={row().endpoint_label}>
                {(endpoint) => <span class="redeven-gateway-card__endpoint">{endpoint()}</span>}
              </Show>
            </div>
          </div>
          <ConsoleIconTile><ShieldCheck class="h-4 w-4" /></ConsoleIconTile>
        </div>
      </CardHeader>
      <CardContent class="flex flex-1 flex-col gap-3 px-4 pb-3">
        <div class="redeven-gateway-card__guidance" data-tone={row().guidance.tone}>
          <div class="flex items-start gap-2">
            <Show
              when={row().guidance.tone === 'success'}
              fallback={row().guidance.tone === 'warning'
                ? <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                : <ShieldCheck class="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            >
              <Check class="mt-0.5 h-3.5 w-3.5 shrink-0" />
            </Show>
            <div class="min-w-0">
              <div class="text-xs font-semibold text-foreground">{row().guidance.title}</div>
              <div class="mt-1 text-[11px] leading-5 text-muted-foreground">{row().guidance.detail}</div>
            </div>
          </div>
        </div>
        <Show
          when={props.gatewayEntries.length > 0}
          fallback={(
            <div class="redeven-gateway-card__empty-env">
              <div class="text-xs font-medium text-foreground">No environments discovered yet</div>
              <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                {hasManageableStartAction()
                  ? 'Start this Gateway, then pair or refresh to discover the environments it manages.'
                  : 'Pair or refresh this Gateway when its runtime is reachable to load the catalog.'}
              </div>
            </div>
          )}
        >
          <div class="redeven-gateway-card__env-list">
            <For each={visibleGatewayEntries()}>
              {(environment) => (
                <GatewayEnvironmentInlineRow
                  i18n={props.i18n}
                  environment={environment}
                  runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                />
              )}
            </For>
            <Show when={hiddenGatewayEntryCount() > 0}>
              <div class="redeven-gateway-card__more-envs">+{hiddenGatewayEntryCount()} more environments in this Gateway</div>
            </Show>
          </div>
        </Show>
      </CardContent>
      <CardFooter class="mt-auto flex flex-col gap-2 border-t border-border/60 px-4 pb-3 pt-3">
        <div class="flex w-full items-center gap-2">
          <DesktopActionPopover
            open={actionPopoverOpen()}
            onOpenChange={(open) => {
              if (open) {
                props.onActionPopoverOpenChange(true);
                return;
              }
              props.onActionPopoverOpenChange(false);
            }}
            content={(
              <Show
                when={visibleGatewayLifecycleProgress()}
                fallback={(
                <GatewaySourceActionGuidePanel
                  i18n={props.i18n}
                  gateway={props.gateway}
                  row={row()}
                  busyState={props.busyState}
                    runAction={runAction}
                  />
                )}
              >
                {(progress) => (
                  <EnvironmentProgressPanel
                    i18n={props.i18n}
                    progress={progress()}
                    cancelOperation={props.cancelOperation}
                    dismissOperation={(currentProgress) => {
                      props.dismissOperation(currentProgress);
                      props.onActionPopoverOpenChange(false);
                    }}
                    copyOperationDiagnostics={props.copyOperationDiagnostics}
                    runNextAction={(action, currentProgress) => {
                      switch (action.kind) {
                        case 'copy_diagnostics':
                          props.copyOperationDiagnostics(currentProgress);
                          break;
                        case 'dismiss':
                          props.dismissOperation(currentProgress);
                          props.onActionPopoverOpenChange(false);
                          break;
                        case 'refresh_status':
                          void props.runGatewayRuntimeAction(props.gateway.gateway_id, 'refresh_gateway_catalog');
                          props.onActionPopoverOpenChange(true);
                          break;
                        case 'update_runtime':
                          void props.runGatewayRuntimeAction(props.gateway.gateway_id, 'update_gateway_runtime');
                          props.onActionPopoverOpenChange(true);
                          break;
                        case 'manage_desktop_update':
                        case 'retry':
                          break;
                      }
                    }}
                  />
                )}
              </Show>
            )}
            anchorClass="flex min-w-0 flex-1"
            popoverAriaLabel={
              progressPanelVisible()
                ? (visibleGatewayLifecycleProgress() ? localizedProgressTitle(props.i18n, visibleGatewayLifecycleProgress()!) : 'Gateway progress')
                : row().guidance.title
            }
          >
            <Show
              when={progressPresentation()}
              fallback={(
                <Button
                  size="sm"
                  variant="default"
                  class="min-w-0 flex-1 justify-center"
                  loading={primaryBusy()}
                  disabled={!row().primary_action.enabled}
                  aria-haspopup={gatewaySourceActionGuidePanelVisible(props.gateway, row().primary_action) ? 'dialog' : undefined}
                  aria-expanded={gatewaySourceActionGuidePanelVisible(props.gateway, row().primary_action) ? props.actionPopoverOpen : undefined}
                  onClick={() => {
                    if (gatewaySourceActionGuidePanelVisible(props.gateway, row().primary_action)) {
                      props.onActionPopoverOpenChange(!props.actionPopoverOpen);
                      return;
                    }
                    runAction(row().primary_action);
                  }}
                >
                  <GatewaySourceActionIcon intent={row().primary_action.intent} />
                  {primaryActionLabel()}
                </Button>
              )}
            >
              {(presentation) => (
                <Button
                  size="sm"
                  variant="default"
                  class={cn(
                    'min-w-0 flex-1 justify-center',
                    progressTriggerClassName(presentation()),
                  )}
                  aria-haspopup="dialog"
                  aria-expanded={props.actionPopoverOpen}
                  aria-label={presentation().ariaLabel}
                  onClick={() => props.onActionPopoverOpenChange(!props.actionPopoverOpen)}
                >
                  <span class="redeven-split-action-trigger__content">
                    {renderProgressPresentationIcon(presentation())}
                    <span>{presentation().label}</span>
                  </span>
                </Button>
              )}
            </Show>
          </DesktopActionPopover>
          <DesktopTooltip content={props.i18n.t('common.settings')} placement="top">
            <span>
              <ConsoleActionIconButton
                title={props.i18n.t('common.settings')}
                aria-label={`Manage ${row().label}`}
                onClick={() => props.openCreateGatewaySetup(props.gateway)}
              >
                <Settings class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </span>
          </DesktopTooltip>
        </div>
        <Show when={secondaryActions().length > 0}>
          <div class="redeven-gateway-card__secondary-actions">
            <For each={secondaryActions()}>
              {(action) => (
                <Button
                  size="sm"
                  variant={action.variant}
                  class="redeven-gateway-card__secondary-action"
                  loading={gatewaySourceActionBusy(
                    props.busyState,
                    props.gateway.gateway_id,
                    action,
                    visibleGatewayLifecycleProgress(),
                  )}
                  disabled={!action.enabled}
                  onClick={() => {
                    runAction(action);
                  }}
                >
                  <GatewaySourceActionIcon intent={action.intent} />
                  {localizedEnvironmentActionLabel(props.i18n, action.label)}
                </Button>
              )}
            </For>
          </div>
        </Show>
      </CardFooter>
    </Card>
  );
}

function GatewayEnvironmentInlineRow(props: Readonly<{
  i18n: DesktopI18n;
  environment: DesktopEnvironmentEntry;
  runLocalEnvironmentAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
}>) {
  const model = createMemo(() => buildGatewaySourceEnvironmentRow(props.i18n, props.environment));
  return (
    <div class="redeven-gateway-env-row">
      <div class="min-w-0">
        <div class="truncate text-xs font-medium text-foreground">{model().environment_label}</div>
        <div class="truncate text-[11px] text-muted-foreground">{model().source_label}</div>
        <Show when={model().endpoint_label}>
          {(endpoint) => <div class="redeven-gateway-env-row__endpoint">{endpoint()}</div>}
        </Show>
      </div>
      <div class="redeven-gateway-env-row__aside">
        <EnvironmentStatusIndicator tone={model().status_tone}>
          {localizedEnvironmentStatusLabel(props.i18n, model().status_label)}
        </EnvironmentStatusIndicator>
        <Button
          size="sm"
          variant="outline"
          disabled={!model().primary_action.enabled}
          onClick={() => {
            void props.runLocalEnvironmentAction(props.environment, model().primary_action, 'connect');
          }}
        >
          <GatewayEnvironmentActionIcon intent={model().primary_action.intent} />
          {localizedEnvironmentActionLabel(props.i18n, model().primary_action.label)}
        </Button>
      </div>
    </div>
  );
}

function GatewayEnvironmentActionIcon(props: Readonly<{ intent: EnvironmentActionIntent }>) {
  switch (props.intent) {
    case 'open':
    case 'focus':
    case 'opening':
      return <ExternalLink class="mr-1 h-3.5 w-3.5" />;
    case 'start_runtime':
      return <Play class="mr-1 h-3.5 w-3.5" />;
    case 'restart_runtime':
    case 'refresh_runtime':
    case 'reconnect_provider':
      return <Refresh class="mr-1 h-3.5 w-3.5" />;
    case 'update_runtime':
      return <Save class="mr-1 h-3.5 w-3.5" />;
    case 'stop_runtime':
      return <Stop class="mr-1 h-3.5 w-3.5" />;
    case 'resolve_gateway':
      return <AlertTriangle class="mr-1 h-3.5 w-3.5" />;
    case 'connect_provider_runtime':
    case 'disconnect_provider_runtime':
    case 'unavailable':
      return <ShieldCheck class="mr-1 h-3.5 w-3.5" />;
  }
}

function gatewaySourceActionStartsWorkflow(action: GatewaySourceActionModel): boolean {
  switch (action.intent) {
    case 'pair_gateway':
    case 'start_gateway_runtime':
    case 'stop_gateway_runtime':
    case 'restart_gateway_runtime':
    case 'update_gateway_runtime':
    case 'refresh_gateway_catalog':
      return true;
    default:
      return false;
  }
}

function gatewaySourceActionGuidePanelVisible(
  gateway: DesktopGatewaySource,
  action: GatewaySourceActionModel,
): boolean {
  if (!desktopGatewayCanManageRuntime(gateway)) {
    return false;
  }
  const runtimeStatus = gateway.runtime_state?.status ?? 'unknown';
  return (
    (action.intent === 'pair_gateway' || action.intent === 'refresh_gateway_catalog')
    && runtimeStatus !== 'ready'
  );
}

function gatewaySourceActionShouldStartIfNeeded(
  gateway: DesktopGatewaySource,
  action: GatewaySourceActionModel,
): boolean {
  if (!desktopGatewayCanManageRuntime(gateway)) {
    return false;
  }
  if (action.intent !== 'pair_gateway' && action.intent !== 'refresh_gateway_catalog') {
    return false;
  }
  return (gateway.runtime_state?.status ?? 'unknown') !== 'ready';
}

function gatewaySourceActionGuideCopy(
  gateway: DesktopGatewaySource,
  row: GatewaySourceRowModel,
): Readonly<{
  title: string;
  detail: string;
  noticeTitle: string;
  noticeDetail: string;
}> {
  const runtimeStatus = gateway.runtime_state?.status ?? 'unknown';
  if (runtimeStatus === 'not_started') {
    return {
      title: row.primary_action.intent === 'pair_gateway' ? 'Start and pair Gateway' : 'Start before refreshing',
      detail: `${row.label} is configured, but its Gateway runtime is not running yet.`,
      noticeTitle: 'Desktop can manage this Gateway',
      noticeDetail: 'Start Gateway will connect to the configured SSH host or container, launch the Gateway runtime, then continue the action.',
    };
  }
  if (runtimeStatus === 'runtime_needs_update') {
    return {
      title: 'Update Gateway runtime first',
      detail: `${row.label} needs a runtime update before Desktop can continue safely.`,
      noticeTitle: 'Managed update available',
      noticeDetail: 'Update Gateway will refresh the runtime on the configured target, then you can pair or refresh again.',
    };
  }
  return {
    title: 'Gateway needs attention',
    detail: gateway.runtime_state?.message || row.guidance.detail,
    noticeTitle: 'Review the target before retrying',
    noticeDetail: 'Check the SSH host, container, or bridge settings. Start Gateway again after the target is reachable.',
  };
}

function GatewaySourceActionGuidePanel(props: Readonly<{
  i18n: DesktopI18n;
  gateway: DesktopGatewaySource;
  row: GatewaySourceRowModel;
  busyState: DesktopLauncherBusyState;
  runAction: (action: GatewaySourceActionModel) => void;
}>) {
  const copy = createMemo(() => gatewaySourceActionGuideCopy(props.gateway, props.row));
  const startAction = createMemo(() => (
    props.row.secondary_actions.find((action) => action.intent === 'start_gateway_runtime')
    ?? (
      props.gateway.runtime_state?.can_start !== false
        ? {
            intent: 'start_gateway_runtime',
            label: 'Start Gateway',
            variant: 'default',
            enabled: true,
          } satisfies GatewaySourceActionModel
        : null
    )
  ));
  const updateAction = createMemo(() => (
    props.row.secondary_actions.find((action) => action.intent === 'update_gateway_runtime')
    ?? (
      props.gateway.runtime_state?.status === 'runtime_needs_update' && props.gateway.runtime_state.can_update !== false
        ? {
            intent: 'update_gateway_runtime',
            label: 'Update Gateway',
            variant: 'default',
            enabled: true,
          } satisfies GatewaySourceActionModel
        : null
    )
  ));
  const primaryAction = createMemo(() => (
    props.gateway.runtime_state?.status === 'runtime_needs_update'
      ? updateAction()
      : startAction()
  ));
  const continueAction = createMemo(() => (
    props.row.primary_action.intent === 'pair_gateway' || props.row.primary_action.intent === 'refresh_gateway_catalog'
      ? props.row.primary_action
      : null
  ));
  const continueActionLabel = createMemo(() => {
    const action = continueAction();
    if (!action || !gatewaySourceActionShouldStartIfNeeded(props.gateway, action)) {
      return action?.label ?? '';
    }
    return action.intent === 'refresh_gateway_catalog'
      ? 'Start Gateway & Refresh'
      : 'Start Gateway & Pair';
  });
  return (
    <div class="redeven-action-popover" tabIndex={-1}>
      <div class="redeven-action-popover__status-header">
        <span class="redeven-action-popover__status-icon" data-tone="warning">
          <AlertTriangle />
        </span>
        <div class="redeven-action-popover__status-text">
          <div class="redeven-action-popover__eyebrow">{props.row.management_label}</div>
          <div class="redeven-action-popover__title">{copy().title}</div>
        </div>
      </div>
      <div class="redeven-action-popover__detail">{copy().detail}</div>
      <div class="redeven-action-popover__notice" data-tone="info">
        <div class="redeven-action-popover__notice-title">{copy().noticeTitle}</div>
        <div class="redeven-action-popover__notice-detail">{copy().noticeDetail}</div>
      </div>
      <div class="redeven-action-popover__actions">
        <Show when={primaryAction()}>
          {(action) => (
            <Button
              size="sm"
              variant="default"
              class="flex-1 justify-center gap-1.5"
              loading={gatewaySourceActionBusy(props.busyState, props.gateway.gateway_id, action())}
              disabled={!action().enabled}
              onClick={() => props.runAction(action())}
            >
              <GatewaySourceActionIcon intent={action().intent} />
              {localizedEnvironmentActionLabel(props.i18n, action().label)}
            </Button>
          )}
        </Show>
        <Show when={continueAction()}>
          {(action) => (
            <Button
              size="sm"
              variant="outline"
              class="flex-1 justify-center gap-1.5"
              loading={gatewaySourceActionBusy(props.busyState, props.gateway.gateway_id, action())}
              disabled={!action().enabled}
              onClick={() => props.runAction(action())}
            >
              <GatewaySourceActionIcon intent={action().intent} />
              {localizedEnvironmentActionLabel(props.i18n, continueActionLabel())}
            </Button>
          )}
        </Show>
      </div>
    </div>
  );
}

function runGatewaySourceAction(
  action: GatewaySourceActionModel,
  gateway: DesktopGatewaySource,
  openCreateGatewaySetup: (gateway?: DesktopGatewaySource) => void,
  pairGateway: (gatewayID: string, startPolicy?: DesktopGatewayStartPolicy) => Promise<void>,
  runGatewayRuntimeAction: (
    gatewayID: string,
    kind: GatewayRuntimeActionKind,
    startPolicy?: GatewayRuntimeStartPolicy,
  ) => Promise<void>,
): Promise<void> | void {
  if (!action.enabled) {
    return;
  }
  switch (action.intent) {
    case 'setup_gateway':
    case 'manage_gateway':
      openCreateGatewaySetup(gateway);
      return;
    case 'pair_gateway':
      return pairGateway(
        gateway.gateway_id,
        gatewaySourceActionShouldStartIfNeeded(gateway, action) ? 'start_if_needed' : undefined,
      );
    case 'resolve_gateway':
      openCreateGatewaySetup(gateway);
      return;
    case 'start_gateway_runtime':
      return runGatewayRuntimeAction(gateway.gateway_id, 'start_gateway_runtime');
    case 'stop_gateway_runtime':
      return runGatewayRuntimeAction(gateway.gateway_id, 'stop_gateway_runtime');
    case 'restart_gateway_runtime':
      return runGatewayRuntimeAction(gateway.gateway_id, 'restart_gateway_runtime');
    case 'update_gateway_runtime':
      return runGatewayRuntimeAction(gateway.gateway_id, 'update_gateway_runtime');
    case 'refresh_gateway_catalog':
      return runGatewayRuntimeAction(
        gateway.gateway_id,
        'refresh_gateway_catalog',
        gatewaySourceActionShouldStartIfNeeded(gateway, action) ? 'start_if_needed' : undefined,
      );
  }
}

function gatewaySourceLauncherActionKind(
  action: GatewaySourceActionModel,
): Extract<DesktopLauncherActionKind, 'pair_gateway' | 'start_gateway_runtime' | 'stop_gateway_runtime' | 'restart_gateway_runtime' | 'update_gateway_runtime' | 'refresh_gateway_catalog'> | null {
  switch (action.intent) {
    case 'pair_gateway':
      return 'pair_gateway';
    case 'start_gateway_runtime':
      return 'start_gateway_runtime';
    case 'stop_gateway_runtime':
      return 'stop_gateway_runtime';
    case 'restart_gateway_runtime':
      return 'restart_gateway_runtime';
    case 'update_gateway_runtime':
      return 'update_gateway_runtime';
    case 'refresh_gateway_catalog':
      return 'refresh_gateway_catalog';
    default:
      return null;
  }
}

function gatewaySourceActionBusy(
  busyState: DesktopLauncherBusyState,
  gatewayID: string,
  action: GatewaySourceActionModel,
  progress?: DesktopLauncherActionProgress | null,
): boolean {
  const actionKind = gatewaySourceLauncherActionKind(action);
  if (actionKind === null) {
    return false;
  }
  if (
    progress?.action === actionKind
    && progress.status !== 'failed'
    && progress.status !== 'cleanup_failed'
    && progress.status !== 'succeeded'
    && progress.status !== 'canceled'
  ) {
    return true;
  }
  return busyStateMatchesGateway(busyState, gatewayID, [actionKind]);
}

function gatewayStartRequiredTitle(payload: DesktopGatewayStartRequiredPayload | null): string {
  switch (payload?.reason) {
    case 'open_gateway_environment':
      return 'Start Gateway to Open';
    case 'refresh_gateway_catalog':
      return 'Start Gateway to Refresh';
    default:
      return 'Start Gateway to Pair';
  }
}

function gatewayStartRequiredConfirmText(payload: DesktopGatewayStartRequiredPayload | null): string {
  switch (payload?.reason) {
    case 'open_gateway_environment':
      return 'Start Gateway & Open';
    case 'refresh_gateway_catalog':
      return 'Start Gateway & Refresh';
    default:
      return 'Start Gateway & Pair';
  }
}

function gatewayStartRequiredMessage(payload: DesktopGatewayStartRequiredPayload | null): string {
  const label = payload?.gateway_label || 'This Gateway';
  switch (payload?.reason) {
    case 'open_gateway_environment':
      return `Desktop found ${label}, but its Gateway Runtime is not running yet. Start it now and Desktop will continue opening this Gateway Environment.`;
    case 'refresh_gateway_catalog':
      return `Desktop found ${label}, but its Gateway Runtime is not running yet. Start it now and Desktop will continue refreshing its Environment catalog.`;
    default:
      return `Desktop found ${label}, but its Gateway Runtime is not running yet. Start it now and Desktop will continue pairing and discovering environments.`;
  }
}

function gatewayStartRequiredNextStep(payload: DesktopGatewayStartRequiredPayload | null): string {
  switch (payload?.runtime_state?.status) {
    case 'ssh_unreachable':
      return 'Next step: review the SSH host settings or network path, then try pairing again.';
    case 'container_unavailable':
      return 'Next step: make sure the target container exists and is running, then try pairing again.';
    case 'bridge_unavailable':
      return 'Next step: repair the Gateway bridge on the target host, then retry this action.';
    case 'runtime_needs_update':
      return 'Next step: update the Gateway runtime before continuing.';
    default:
      return 'Next step: Desktop will start the Gateway runtime on the configured SSH host or container, then retry this action automatically.';
  }
}

function gatewayRuntimeStateLabel(status: string): string {
  switch (status) {
    case 'not_started':
      return 'Gateway Runtime is not started';
    case 'runtime_needs_update':
      return 'Gateway Runtime needs an update';
    case 'ssh_unreachable':
      return 'SSH host is unreachable';
    case 'container_unavailable':
      return 'Container is unavailable';
    case 'bridge_unavailable':
      return 'Gateway bridge is unavailable';
    case 'ready':
      return 'Gateway Runtime is ready';
    default:
      return 'Gateway Runtime needs attention';
  }
}

function GatewaySourceActionIcon(props: Readonly<{ intent: GatewaySourceActionModel['intent'] }>) {
  switch (props.intent) {
    case 'start_gateway_runtime':
      return <Play class="mr-1 h-3.5 w-3.5" />;
    case 'stop_gateway_runtime':
      return <Stop class="mr-1 h-3.5 w-3.5" />;
    case 'restart_gateway_runtime':
      return <Refresh class="mr-1 h-3.5 w-3.5" />;
    case 'update_gateway_runtime':
      return <Save class="mr-1 h-3.5 w-3.5" />;
    case 'refresh_gateway_catalog':
      return <Refresh class="mr-1 h-3.5 w-3.5" />;
    case 'manage_gateway':
    case 'setup_gateway':
      return <Settings class="mr-1 h-3.5 w-3.5" />;
    case 'pair_gateway':
      return <ShieldCheck class="mr-1 h-3.5 w-3.5" />;
    case 'resolve_gateway':
      return <AlertTriangle class="mr-1 h-3.5 w-3.5" />;
  }
}

function buildGatewaySourceEnvironmentRow(
  _i18n: DesktopI18n,
  environment: DesktopEnvironmentEntry,
) {
  return buildGatewaySourceEnvironmentRowModel(environment);
}

function buildGatewaySourceEnvironmentRowModel(environment: DesktopEnvironmentEntry) {
  return buildGatewayRowModel(environment);
}

const LOCAL_ENVIRONMENT_SETTINGS_DIALOG_CLASS = cn(
  'flex max-w-none flex-col overflow-hidden rounded-md p-0',
  '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
  '[&>div:last-child]:min-h-0 [&>div:last-child]:flex-1 [&>div:last-child]:overflow-auto [&>div:last-child]:pt-2',
  'max-h-[calc(100dvh-1rem)] w-[min(52rem,96vw)]',
);

const CONNECTION_DIALOG_CLASS = cn(
	  'flex max-w-none flex-col overflow-hidden rounded-md p-0',
	  '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
	  '[&>div:nth-child(2)]:min-h-0 [&>div:nth-child(2)]:flex-1 [&>div:nth-child(2)]:overflow-auto [&>div:nth-child(2)]:pt-2',
	  'max-h-[calc(100dvh-3rem)] w-[min(58rem,96vw)]',
	);

const LOCAL_ENVIRONMENT_SETTINGS_CARD_CLASS = 'redeven-tile rounded-md border border-border px-4 py-4 redeven-settings-detail-card';

function accessModeIcon(mode: DesktopAccessMode): (props?: { class?: string }) => JSX.Element {
  switch (mode) {
    case 'shared_local_network':
      return Globe;
    case 'custom_exposure':
      return Settings;
    default:
      return Lock;
  }
}

function SettingsHelpBadge(props: Readonly<{
  label: string;
  content?: string | JSX.Element;
  i18n: DesktopI18n;
}>) {
  const tooltip = createMemo<JSX.Element | undefined>(() => {
    if (typeof props.content === 'string') {
      const content = trimString(props.content);
      return content === '' ? undefined : <div class="max-w-xs">{content}</div>;
    }
    return props.content;
  });

  return (
    <Show when={tooltip()}>
      <DesktopTooltip content={tooltip()!} placement="top" delay={0}>
        <span
          data-redeven-settings-help=""
          role="img"
          aria-label={`${props.label}: ${props.i18n.t('common.moreInformation')}`}
          tabIndex={0}
          class="inline-flex h-[1.125rem] w-[1.125rem] shrink-0 cursor-help items-center justify-center rounded-full border border-border/70 bg-muted/35 text-[10px] font-semibold leading-none text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          ?
        </span>
      </DesktopTooltip>
    </Show>
  );
}

function SettingsCardHeading(props: Readonly<{
  title: string;
  help?: string;
  i18n: DesktopI18n;
  accessory?: JSX.Element;
}>) {
  return (
    <div class="flex w-full items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <div class="min-w-0 text-sm font-medium text-foreground">{props.title}</div>
        <SettingsHelpBadge label={props.title} content={props.help} i18n={props.i18n} />
      </div>
      {props.accessory}
    </div>
  );
}

function SettingsSectionHeader(props: Readonly<{
  label: string;
  hint?: string;
  accessory?: JSX.Element;
}>) {
  return (
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div class="flex items-baseline gap-2">
        <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {props.label}
        </h3>
        <Show when={props.hint}>
          <span class="text-[11px] text-muted-foreground/70">{props.hint}</span>
        </Show>
      </div>
      {props.accessory}
    </div>
  );
}

function DesktopLanguageSettingsPanel(props: Readonly<{
  languageSnapshot: RedevenLanguageSnapshot;
  i18n: DesktopI18n;
  updateLanguagePreference: (preference: RedevenLocalePreference) => void;
}>) {
  const languagePreferenceOptions = createMemo(() => (
    REDEVEN_LOCALE_PREFERENCES.map((preference) => ({
      value: preference,
      label: preference === SYSTEM_LOCALE_PREFERENCE
        ? props.i18n.t('language.systemDefault')
        : localePreferenceDisplayName(preference),
    }))
  ));

  return (
    <div class={LOCAL_ENVIRONMENT_SETTINGS_CARD_CLASS}>
      <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
        <div class="space-y-2">
          <SettingsCardHeading
            title={props.i18n.t('settings.languageTitle')}
            help={props.i18n.t('settings.languageDescription')}
            i18n={props.i18n}
          />
          <label class="block">
            <span class="sr-only">{props.i18n.t('settings.languageSelectLabel')}</span>
            <select
              class="mt-2 h-9 w-full cursor-pointer rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={props.languageSnapshot.preference}
              aria-label={props.i18n.t('settings.languageSelectLabel')}
              onChange={(event) => props.updateLanguagePreference(event.currentTarget.value as RedevenLocalePreference)}
            >
              <For each={languagePreferenceOptions()}>
                {(option) => (
                  <option value={option.value}>{option.label}</option>
                )}
              </For>
            </select>
          </label>
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            {props.i18n.t('language.appliesToDesktopAndEnvApp')}
          </p>
        </div>
        <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-2.5">
          <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {props.i18n.t('settings.languageSourceLabel')}
          </div>
          <div class="mt-1 text-sm font-medium text-foreground">
            {languageSourceLabel(props.i18n, props.languageSnapshot.source)}
          </div>
          <div class="mt-1 text-[11px] text-muted-foreground">
            {props.i18n.t('language.usingLanguage', { language: localePreferenceDisplayName(props.languageSnapshot.resolved_locale) })}
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopInterfaceSettingsDialog(props: Readonly<{
  open: boolean;
  languageSnapshot: RedevenLanguageSnapshot;
  i18n: DesktopI18n;
  onOpenChange: (open: boolean) => void;
  updateLanguagePreference: (preference: RedevenLocalePreference) => void;
}>) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.i18n.t('settings.interfaceTitle')}
      class={LOCAL_ENVIRONMENT_SETTINGS_DIALOG_CLASS}
      footer={(
        <div class="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {props.i18n.t('common.close')}
          </Button>
        </div>
      )}
    >
      <div class="space-y-3">
        <SettingsSectionHeader
          label={props.i18n.t('settings.interfaceTitle')}
          hint={props.i18n.t('settings.interfaceDescription')}
        />
        <DesktopLanguageSettingsPanel
          languageSnapshot={props.languageSnapshot}
          i18n={props.i18n}
          updateLanguagePreference={props.updateLanguagePreference}
        />
      </div>
    </Dialog>
  );
}

function LocalEnvironmentSettingsDialog(props: Readonly<{
  open: boolean;
  snapshot: DesktopSettingsSurfaceSnapshot;
  baselineSnapshot: DesktopSettingsSurfaceSnapshot;
  draft: DesktopSettingsDraft;
  languageSnapshot: RedevenLanguageSnapshot;
  i18n: DesktopI18n;
  busyState: DesktopLauncherBusyState;
  settingsError: string;
  settingsErrorRef: (value: HTMLElement) => void;
  updateDraftField: (name: keyof DesktopSettingsDraft, value: string) => void;
  applyAccessMode: (mode: DesktopAccessMode) => void;
  applyAccessFixedPort: (portText: string) => void;
  toggleAutoPort: (enabled: boolean) => void;
  saveSettings: () => Promise<void>;
  cancelSettings: () => void;
  clearStoredLocalUIPassword: () => void;
  updateLanguagePreference: (preference: RedevenLocalePreference) => void;
}>) {
  const [accessModeOverride, setAccessModeOverride] = createSignal<DesktopAccessMode | null>(null);
  const accessModelOptions = createMemo(() => ({
    current_runtime_url: props.snapshot.current_runtime_url,
    local_ui_password_configured: props.baselineSnapshot.local_ui_password_configured,
    runtime_password_required: props.baselineSnapshot.runtime_password_required,
    mode_override: accessModeOverride(),
  }));
  const accessModel = createMemo(() => deriveDesktopAccessDraftModel(props.draft, accessModelOptions()));
  const addressCardTitle = createMemo(() => settingsAddressCardTitle(props.i18n, accessModel().access_mode));
  const addressCardHelp = createMemo(() => settingsAddressCardHelp(props.i18n, accessModel().access_mode));
  const protectionCardTitle = createMemo(() => settingsProtectionCardTitle(props.i18n, accessModel().access_mode));
  const protectionCardHelp = createMemo(() => settingsProtectionCardHelp(props.i18n, accessModel().access_mode));
  const runtimeAddress = createMemo(() => describeLocalizedRuntimeAddress(props.i18n, accessModel().current_runtime_url));
  const nextStartAddress = createMemo(() => describeLocalizedNextStartAddress(props.i18n, accessModel()));
  const settingsEnvironmentLabel = createMemo(() => trimString(props.baselineSnapshot.environment_label) || props.i18n.t('desktop.environment'));
  const settingsWindowTitle = createMemo(() => props.i18n.t('settings.settingsWindowTitle', {
    label: settingsEnvironmentLabel(),
  }));
  const settingsSaveLabel = createMemo(() => props.i18n.t('settings.saveEnvironmentSettings', {
    label: settingsEnvironmentLabel(),
  }));
  const localUIPasswordCanClear = createMemo(() => (
    props.baselineSnapshot.local_ui_password_configured
    && props.draft.local_ui_password_mode !== 'clear'
    && !accessModel().password_required
  ));
  let previousBaselineKey = '';

  createEffect(() => {
    if (!props.open) {
      setAccessModeOverride(null);
    }
  });

  createEffect(() => {
    const baselineKey = [
      props.baselineSnapshot.mode,
      props.baselineSnapshot.environment_kind,
      props.baselineSnapshot.environment_id,
      props.baselineSnapshot.draft.local_ui_bind,
      props.baselineSnapshot.draft.local_ui_password_mode,
      props.baselineSnapshot.draft.auto_runtime_probe_enabled ? 'auto-probe' : 'manual-probe',
      props.baselineSnapshot.local_ui_password_configured ? 'password' : 'no-password',
    ].join(':');
    if (previousBaselineKey !== '' && previousBaselineKey !== baselineKey) {
      setAccessModeOverride(null);
    }
    previousBaselineKey = baselineKey;
  });

  // See ConnectionDialog: memoize the open boolean so that identity churn
  // upstream never re-triggers the overlay-mask focus trap mid-typing.
  const isOpen = createMemo(() => props.open);

  return (
    <Dialog
      open={isOpen()}
      onOpenChange={(open) => {
        if (!open) {
          props.cancelSettings();
        }
      }}
      title={settingsWindowTitle()}
      class={LOCAL_ENVIRONMENT_SETTINGS_DIALOG_CLASS}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={props.cancelSettings}>
            {props.i18n.t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={busyStateMatchesAction(props.busyState, 'save_settings')}
            aria-label={settingsSaveLabel()}
            title={settingsSaveLabel()}
            onClick={() => {
              void props.saveSettings();
            }}
          >
            {props.i18n.t('common.save')}
          </Button>
        </div>
      )}
    >
      <div class="space-y-6">
        <div class="redeven-settings-statusbar overflow-hidden rounded-md border border-border">
          <div class="grid divide-y divide-border sm:grid-cols-[1fr_auto_1fr] sm:divide-x sm:divide-y-0">
            <div class="flex items-start gap-3 px-4 py-3">
              <div class={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors',
                accessModel().current_runtime_url !== ''
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-border/60 bg-muted/30 text-muted-foreground',
              )}>
                <div class={cn(
                  'h-1.5 w-1.5 rounded-full',
                  accessModel().current_runtime_url !== '' ? 'bg-success' : 'bg-muted-foreground/50',
                )} />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{props.i18n.t('settings.runtimeLabel')}</div>
                <div class={cn(
                  'mt-0.5 truncate text-xs font-medium text-foreground',
                  runtimeAddress().primary_monospace && 'font-mono text-[12px]',
                )}>
                  {runtimeAddress().primary}
                </div>
              </div>
            </div>
            <div class="hidden items-center justify-center px-4 text-muted-foreground sm:flex">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </div>
            <div class="flex items-start gap-3 px-4 py-3">
              <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                {(() => {
                  const Icon = accessModeIcon(accessModel().access_mode);
                  return <Icon class="h-3.5 w-3.5" />;
                })()}
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{props.i18n.t('settings.nextStartLabel')}</div>
                <div class="mt-0.5 flex items-baseline gap-1.5">
                  <div class={cn(
                    'truncate text-xs font-medium text-foreground',
                    nextStartAddress().primary_monospace && 'font-mono text-[12px]',
                  )}>
                    {nextStartAddress().primary}
                  </div>
                  <Show when={nextStartAddress().hint}>
                    <div class="truncate text-[11px] text-muted-foreground">{nextStartAddress().hint}</div>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section class="space-y-3">
          <SettingsSectionHeader
            label={props.i18n.t('settings.interfaceTitle')}
            hint={props.i18n.t('settings.interfaceDescription')}
          />
          <DesktopLanguageSettingsPanel
            languageSnapshot={props.languageSnapshot}
            i18n={props.i18n}
            updateLanguagePreference={props.updateLanguagePreference}
          />
        </section>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{props.i18n.t('settings.accessSecurityTitle')}</div>
            <div class="mt-1 text-sm text-foreground">{props.i18n.t('settings.accessSecurityDescription')}</div>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <Tag variant={passwordStateTagVariant(accessModel().password_state_tone)} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
              {compactLocalizedPasswordStateTagLabel(props.i18n, accessModel().password_state_id)}
            </Tag>
          </div>
        </div>

        <div class="space-y-6">
            <section>
              <SettingsSectionHeader
                label={props.i18n.t('settings.visibilityTitle')}
                hint={props.i18n.t('settings.visibilityDescription')}
              />
              <div
                role="radiogroup"
                aria-label={props.i18n.t('settings.visibilityTitle')}
                class="mt-3 grid gap-3 sm:grid-cols-3"
              >
                <For each={props.baselineSnapshot.access_mode_options}>
                  {(option) => {
                    const selected = createMemo(() => accessModel().access_mode === option.value);
                    const localizedOption = createMemo(() => localizedAccessModeOption(props.i18n, option));
                    const Icon = accessModeIcon(option.value);
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected()}
                        class={cn(
                          'redeven-visibility-card group relative flex cursor-pointer flex-col gap-2 rounded-md border px-4 py-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150',
                          selected()
                            ? 'border-primary/60 bg-primary/10 shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_32%,transparent)_inset]'
                            : 'redeven-tile border-border hover:-translate-y-[1px] hover:border-primary/25 hover:bg-muted/15 hover:shadow-[0_6px_20px_-12px_color-mix(in_srgb,var(--foreground)_26%,transparent)]',
                        )}
                        onClick={() => {
                          if (option.value === 'custom_exposure') {
                            setAccessModeOverride('custom_exposure');
                            props.applyAccessMode(option.value);
                            return;
                          }
                          setAccessModeOverride(null);
                          props.applyAccessMode(option.value);
                        }}
                      >
                        <div class="flex items-start justify-between gap-3">
                          <div class={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors',
                            selected()
                              ? 'border-primary/40 bg-primary/15 text-primary'
                              : 'border-border/70 bg-muted/25 text-muted-foreground group-hover:border-primary/25 group-hover:text-foreground',
                          )}>
                            <Icon class="h-4 w-4" />
                          </div>
                          <div class={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                            selected()
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border/80 bg-background group-hover:border-primary/40',
                          )}>
                            <Show when={selected()}>
                              <Check class="h-2.5 w-2.5" />
                            </Show>
                          </div>
                        </div>
                        <div class="mt-1 text-sm font-semibold text-foreground">{localizedOption().label}</div>
                        <div class="text-[11px] leading-[1.55] text-muted-foreground">{localizedOption().description}</div>
                      </button>
                    );
                  }}
                </For>
              </div>
            </section>

            <section>
              <SettingsSectionHeader
                label={props.i18n.t('settings.detailsTitle')}
                hint={props.i18n.t('settings.detailsDescription', {
                  address: addressCardTitle().toLowerCase(),
                  protection: protectionCardTitle().toLowerCase(),
                })}
              />
              <div class="mt-3 grid gap-3 sm:grid-cols-2">
                <div class={LOCAL_ENVIRONMENT_SETTINGS_CARD_CLASS}>
                  <SettingsCardHeading title={addressCardTitle()} help={addressCardHelp()} i18n={props.i18n} />
                  <div class="mt-3 space-y-3">
                    <Show
                      when={accessModel().access_mode === 'custom_exposure'}
                      fallback={(
                        <>
                          <label class="block">
                            <span class="sr-only">{props.i18n.t('settings.portLabel')}</span>
                            <Input
                              value={accessModel().fixed_port_value}
                              inputMode="numeric"
                              disabled={accessModel().port_mode === 'auto'}
                              size="sm"
                              class="w-full"
                              aria-label={props.i18n.t('settings.portLabel')}
                              placeholder="23998"
                              onInput={(event) => props.applyAccessFixedPort(event.currentTarget.value)}
                            />
                          </label>
                          <Show when={accessModel().access_mode === 'local_only'}>
                            <div class="rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-2.5">
                              <Checkbox
                                checked={accessModel().port_mode === 'auto'}
                                onChange={props.toggleAutoPort}
                                label={props.i18n.t('settings.autoSelectPort')}
                                size="sm"
                              />
                            </div>
                          </Show>
                        </>
                      )}
                    >
                      <SettingsFieldInput
                        field={props.baselineSnapshot.host_fields[0]!}
                        value={props.draft.local_ui_bind}
                        updateDraftField={props.updateDraftField}
                        sectionTitle={addressCardTitle()}
                        i18n={props.i18n}
                      />
                    </Show>
                  </div>
                </div>

                <div class={LOCAL_ENVIRONMENT_SETTINGS_CARD_CLASS}>
                  <SettingsCardHeading title={protectionCardTitle()} help={protectionCardHelp()} i18n={props.i18n} />
                  <div class="mt-3">
                    <Show
                      when={accessModel().access_mode === 'local_only'}
                      fallback={(
                        <LocalUIPasswordField
                          snapshot={props.baselineSnapshot}
                          draft={props.draft}
                          passwordStateID={accessModel().password_state_id}
                          passwordStateTone={accessModel().password_state_tone}
                          localUIPasswordCanClear={localUIPasswordCanClear()}
                          updateDraftField={props.updateDraftField}
                          clearStoredLocalUIPassword={props.clearStoredLocalUIPassword}
                          sectionTitle={protectionCardTitle()}
                          i18n={props.i18n}
                        />
                      )}
                    >
                      <div class="flex items-start gap-2.5 rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-2.5">
                        <Shield class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div class="text-[11px] leading-[1.55] text-muted-foreground">
                          {props.i18n.t('settings.localOnlyProtectionNote')}
                        </div>
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
            </section>

        </div>

        <Show when={props.settingsError}>
          <div
            ref={props.settingsErrorRef}
            tabIndex={-1}
            id="settings-error"
            role="alert"
            class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive outline-none"
          >
            {props.settingsError}
          </div>
        </Show>
      </div>
    </Dialog>
  );
}

function sshConfigHostSearchText(host: DesktopSSHConfigHost): string {
  return [
    host.alias,
    host.host_name,
    host.user,
    host.port == null ? '' : String(host.port),
  ].join(' ').toLowerCase();
}

function sshConfigHostEndpointLabel(host: DesktopSSHConfigHost): string {
  const endpoint = host.host_name || host.alias;
  return host.user ? `${host.user}@${endpoint}` : endpoint;
}

function SSHDestinationCombobox(props: Readonly<{
  i18n: DesktopI18n;
  value: string;
  hosts: readonly DesktopSSHConfigHost[];
  autofocus: boolean;
  class?: string;
  onInput: (value: string) => void;
  onSelectHost: (host: DesktopSSHConfigHost) => void;
}>) {
  const [open, setOpen] = createSignal(false);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  let closeTimer: number | undefined;
  let rootRef: HTMLDivElement | undefined;
  let listboxRef: HTMLDivElement | undefined;

  const filteredHosts = createMemo(() => {
    const query = trimString(props.value).toLowerCase();
    const hosts = query === ''
      ? props.hosts
      : props.hosts.filter((host) => sshConfigHostSearchText(host).includes(query));
    return hosts.slice(0, 8);
  });

  createEffect(() => {
    const hostCount = filteredHosts().length;
    if (hostCount <= 0) {
      setHighlightedIndex(0);
      return;
    }
    if (highlightedIndex() >= hostCount) {
      setHighlightedIndex(hostCount - 1);
    }
  });

  onCleanup(() => {
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
    }
  });

  function containsTarget(target: EventTarget | null): boolean {
    return target instanceof Node && (rootRef?.contains(target) === true || listboxRef?.contains(target) === true);
  }

  function openMenu(): void {
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    setOpen(true);
  }

  function closeMenuSoon(): void {
    closeTimer = window.setTimeout(() => setOpen(false), 100);
  }

  function selectHost(host: DesktopSSHConfigHost): void {
    props.onSelectHost(host);
    setOpen(false);
  }

  function moveHighlight(delta: number): void {
    const hostCount = filteredHosts().length;
    if (hostCount <= 0) {
      return;
    }
    setHighlightedIndex((current) => (current + delta + hostCount) % hostCount);
  }

  return (
    <div
      ref={rootRef}
      class="relative"
      onFocusOut={(event) => {
        if (containsTarget(event.relatedTarget)) {
          return;
        }
        closeMenuSoon();
      }}
    >
      <Input
        id="environment-ssh-destination"
        value={props.value}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
          openMenu();
        }}
        onFocus={openMenu}
        onKeyDown={(event) => {
          if (!open() && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            setOpen(true);
          }
          if (!open() || filteredHosts().length <= 0) {
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveHighlight(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveHighlight(-1);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const host = filteredHosts()[highlightedIndex()];
            if (host) {
              selectHost(host);
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          }
        }}
        placeholder={props.i18n.t('connectionDialog.sshDestinationPlaceholder')}
        size="sm"
        class={cn('w-full', props.class)}
        spellcheck={false}
        autofocus={props.autofocus}
        role="combobox"
        aria-expanded={open() && filteredHosts().length > 0 ? 'true' : 'false'}
        aria-controls="environment-ssh-destination-options"
        aria-autocomplete="list"
      />
      <Show when={open() && filteredHosts().length > 0}>
        <DesktopAnchoredListbox
          id="environment-ssh-destination-options"
          anchorRef={rootRef}
          class="p-1"
          maxHeight={224}
          role="listbox"
          open={open() && filteredHosts().length > 0}
          onOverlayRef={(element) => {
            listboxRef = element;
          }}
        >
          <div
            class="min-h-0 flex-1 overflow-auto"
            onWheel={(event) => {
              const el = event.currentTarget as HTMLElement;
              event.stopPropagation();
              if (el.scrollHeight > el.clientHeight) {
                el.scrollTop += event.deltaY;
              }
            }}
          >
            <For each={filteredHosts()}>
              {(host, index) => (
                <button
                  type="button"
                  id={`environment-ssh-host-option-${index()}`}
                  class={cn(
                    'flex w-full cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-2 text-left transition-colors',
                    highlightedIndex() === index()
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-accent/70 hover:text-accent-foreground',
                  )}
                  role="option"
                  aria-selected={highlightedIndex() === index() ? 'true' : 'false'}
                  onMouseEnter={() => setHighlightedIndex(index())}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectHost(host);
                  }}
                >
                  <span class="min-w-0">
                    <span class="block truncate font-mono text-xs">{host.alias}</span>
                    <span class="block truncate text-[11px] text-muted-foreground">{sshConfigHostEndpointLabel(host)}</span>
                  </span>
                  <Show when={host.port !== null}>
                    <Tag variant="neutral" tone="soft" size="sm" class="shrink-0 cursor-default whitespace-nowrap">
                      {props.i18n.t('connectionDialog.sshPortTag', { port: host.port ?? '' })}
                    </Tag>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </DesktopAnchoredListbox>
      </Show>
    </div>
  );
}

function runtimeContainerSearchText(container: DesktopRuntimeContainerOption): string {
  return [
    container.container_label,
    container.container_ref,
    container.container_id,
    container.image,
    container.status_text,
  ].join(' ').toLowerCase();
}

function ContainerPicker(props: Readonly<{
  i18n: DesktopI18n;
  selectedContainerID: string;
  selectedContainerRef: string;
  selectedContainerLabel: string;
  containers: readonly DesktopRuntimeContainerOption[];
  loading: boolean;
  disabled: boolean;
  error: string;
  emptyMessage: string;
  fieldError: string | undefined;
  onSelect: (container: DesktopRuntimeContainerOption) => void;
  onRefresh: () => void;
}>) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  let closeTimer: number | undefined;
  let rootRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;
  let listboxRef: HTMLDivElement | undefined;

  const selectedLabel = createMemo(() => (
    trimString(props.selectedContainerLabel)
    || props.containers.find((container) => container.container_id === props.selectedContainerID)?.container_label
    || trimString(props.selectedContainerRef)
    || trimString(props.selectedContainerID)
  ));
  const filteredContainers = createMemo(() => {
    const cleanQuery = trimString(query()).toLowerCase();
    const source = props.containers;
    return cleanQuery === ''
      ? source
      : source.filter((container) => runtimeContainerSearchText(container).includes(cleanQuery));
  });

  createEffect(() => {
    const count = filteredContainers().length;
    if (count <= 0) {
      setHighlightedIndex(0);
      return;
    }
    if (highlightedIndex() >= count) {
      setHighlightedIndex(count - 1);
    }
  });

  createEffect(on(
    () => props.selectedContainerID,
    () => {
      setQuery('');
    },
  ));

  onCleanup(() => {
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
    }
  });

  function containsTarget(target: EventTarget | null): boolean {
    return target instanceof Node && (rootRef?.contains(target) === true || listboxRef?.contains(target) === true);
  }

  function openMenu(): void {
    if (props.disabled) {
      return;
    }
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    setOpen(true);
  }

  function closeMenuSoon(): void {
    closeTimer = window.setTimeout(() => setOpen(false), 100);
  }

  function selectContainer(container: DesktopRuntimeContainerOption): void {
    props.onSelect(container);
    setOpen(false);
  }

  function moveHighlight(delta: number): void {
    const count = filteredContainers().length;
    if (count <= 0) {
      return;
    }
    setHighlightedIndex((current) => (current + delta + count) % count);
  }

  return (
    <div
      ref={rootRef}
      class="space-y-1.5"
      onFocusOut={(event) => {
        if (containsTarget(event.relatedTarget)) {
          return;
        }
        closeMenuSoon();
      }}
    >
      <div class="flex items-center justify-between gap-2">
        <label for="environment-container-picker" class="block text-xs font-medium text-foreground">
          {props.i18n.t('connectionDialog.containerPickerLabel')} <span class="text-destructive">*</span>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 px-2 text-[11px]"
          loading={props.loading}
          disabled={props.disabled || props.loading}
          onClick={props.onRefresh}
        >
          <Refresh class="mr-1 h-3.5 w-3.5" />
          {props.i18n.t('connectionDialog.refreshContainers')}
        </Button>
      </div>
      <div class="relative">
        <button
          ref={buttonRef}
          id="environment-container-picker"
          type="button"
          class={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm transition-colors',
            props.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-ring',
            props.fieldError && 'border-destructive ring-1 ring-destructive/20',
          )}
          disabled={props.disabled}
          onClick={openMenu}
          onKeyDown={(event) => {
            if (props.disabled) {
              return;
            }
            if (!open() && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter')) {
              event.preventDefault();
              setOpen(true);
              return;
            }
            if (!open()) {
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveHighlight(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveHighlight(-1);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const container = filteredContainers()[highlightedIndex()];
              if (container) {
                selectContainer(container);
              }
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={open() ? 'true' : 'false'}
          aria-controls="environment-container-picker-options"
        >
          <span class={cn('min-w-0 truncate', selectedLabel() ? 'text-foreground' : 'text-muted-foreground')}>
            {selectedLabel() || (props.loading ? props.i18n.t('connectionDialog.loadingContainers') : props.i18n.t('connectionDialog.chooseRunningContainer'))}
          </span>
          <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
        <Show when={open() && !props.disabled}>
          <DesktopAnchoredListbox
            id="environment-container-picker-options"
            anchorRef={buttonRef}
            class="shadow-xl"
            maxHeight={320}
            role="listbox"
            open={open() && !props.disabled}
            onOverlayRef={(element) => {
              listboxRef = element;
            }}
          >
            <div class="border-b border-border/70 p-2">
              <Input
                value={query()}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  setHighlightedIndex(0);
                }}
                placeholder={props.i18n.t('connectionDialog.filterContainers')}
                size="sm"
                class="w-full"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveHighlight(1);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveHighlight(-1);
                  }
                }}
              />
            </div>
            <div
              class="min-h-0 flex-1 overflow-auto p-1"
              onWheel={(event) => {
                const el = event.currentTarget as HTMLElement;
                event.stopPropagation();
                if (el.scrollHeight > el.clientHeight) {
                  el.scrollTop += event.deltaY;
                }
              }}
            >
              <Show
                when={filteredContainers().length > 0}
                fallback={(
                  <div class="px-3 py-3 text-xs text-muted-foreground">
                    {props.emptyMessage}
                  </div>
                )}
              >
                <For each={filteredContainers()}>
                  {(container, index) => (
                    <button
                      type="button"
                      id={`environment-container-option-${index()}`}
                      class={cn(
                        'flex w-full cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-2 text-left transition-colors',
                        highlightedIndex() === index()
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground hover:bg-accent/70 hover:text-accent-foreground',
                      )}
                      role="option"
                      aria-selected={props.selectedContainerID === container.container_id ? 'true' : 'false'}
                      onMouseEnter={() => setHighlightedIndex(index())}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectContainer(container);
                      }}
                    >
                      <span class="min-w-0">
                        <span class="block truncate text-xs font-medium">{container.container_label}</span>
                        <span class="block truncate font-mono text-[11px] text-muted-foreground">{container.container_id}</span>
                        <Show when={container.image || container.status_text}>
                          <span class="mt-1 block truncate text-[11px] text-muted-foreground">
                            {[container.image, container.status_text].filter(Boolean).join(' · ')}
                          </span>
                        </Show>
                      </span>
                      <Show when={props.selectedContainerID === container.container_id}>
                        <Check class="h-3.5 w-3.5 shrink-0" />
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </DesktopAnchoredListbox>
        </Show>
      </div>
      <Show when={props.fieldError}>
        <div class="text-[11px] text-destructive">{props.fieldError}</div>
      </Show>
      <Show when={props.error}>
        <div class="rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-2 text-[11px] leading-5 text-destructive">
          {props.error}
        </div>
      </Show>
      <Show when={!props.error && props.containers.length === 0 && !props.loading}>
        <div class="text-[11px] leading-5 text-muted-foreground">{props.emptyMessage}</div>
      </Show>
    </div>
  );
}

function ConnectionDialog(props: Readonly<{
  i18n: DesktopI18n;
  state: ConnectionDialogState;
  sshConfigHosts: readonly DesktopSSHConfigHost[];
  containerOptions: readonly DesktopRuntimeContainerOption[];
  containerOptionsLoading: boolean;
  containerOptionsError: string;
  error: string;
  fieldErrors: Partial<Record<string, string>>;
  busyState: DesktopLauncherBusyState;
  onOpenChange: (open: boolean) => void;
  updateField: (
    name: 'label' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'auth_mode' | 'ssh_password' | 'runtime_root' | 'release_base_url' | 'connect_timeout_seconds' | 'container_engine' | 'container_id' | 'container_ref' | 'container_label',
    value: string,
  ) => void;
  toggleAutoRuntimeProbe: (enabled: boolean) => void;
  refreshContainerOptions: () => void;
  switchKind: (kind: ConnectionDialogKind) => void;
  switchBootstrapStrategy: (strategy: DesktopSSHBootstrapStrategy) => void;
  removeSSHPassword: () => void;
  clearFieldErrors: () => void;
  onSave: () => Promise<void>;
}>) {
  const isOpen = createMemo(() => props.state !== null);
  const isCreate = createMemo(() => props.state?.mode === 'create');
  const connectionKind = createMemo(() => props.state?.connection_kind ?? 'external_local_ui');
  const [advancedState, setAdvancedState] = createSignal<SSHConnectionDialogAdvancedState>({
    open: false,
    initialized_for_state_key: 'closed',
  });
  const isSSHBackedKind = createMemo(() => connectionKind() === 'ssh_environment' || connectionKind() === 'ssh_container_runtime');
  const isContainerKind = createMemo(() => connectionKind() === 'local_container_runtime' || connectionKind() === 'ssh_container_runtime');
  const showSSHAdvanced = createMemo(() => connectionKind() === 'ssh_environment' && advancedState().open);
  const sshBootstrapStrategy = createMemo(() => (
    props.state?.connection_kind === 'ssh_environment'
      ? props.state.bootstrap_strategy
      : DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY
  ));
  const sshReleaseBaseURLLabel = createMemo(() => (
    trimString(
      props.state?.connection_kind === 'ssh_environment'
        ? props.state.release_base_url
        : '',
    ) === ''
      ? DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL
      : props.i18n.t('connectionDialog.customMirror')
  ));
  const sshBootstrapSummaryLabel = createMemo(() => {
    switch (sshBootstrapStrategy()) {
      case 'desktop_upload':
        return sshReleaseBaseURLLabel();
      case 'remote_install':
        return props.i18n.t('connectionDialog.remoteFallback');
      default:
        return props.i18n.t('connectionDialog.automatic');
    }
  });
  const connectionKindDescription = createMemo<JSX.Element>(() => {
    switch (connectionKind()) {
      case 'external_local_ui':
        return (
          <>
            {props.i18n.t('connectionDialog.urlDescription')}
            {' '}
            <span class="font-medium text-foreground">{props.i18n.t('connectionDialog.notProviderUrl')}</span>
          </>
        );
      case 'ssh_environment':
        return props.i18n.t('connectionDialog.sshDescription');
      case 'local_container_runtime':
        return props.i18n.t('connectionDialog.localContainerDescription');
      case 'ssh_container_runtime':
        return props.i18n.t('connectionDialog.sshContainerDescription');
      default:
        return '';
    }
  });

  createEffect(() => {
    const state = props.state;
    setAdvancedState((current) => syncSSHConnectionDialogAdvancedState(current, (
      state?.connection_kind === 'ssh_environment' || state?.connection_kind === 'external_local_ui'
        ? state
        : null
    )));
  });

  return (
    <Dialog
      open={isOpen()}
      onOpenChange={props.onOpenChange}
      title={isCreate() ? props.i18n.t('connectionDialog.newEnvironmentTitle') : props.i18n.t('connectionDialog.editEnvironmentTitle')}
      class={CONNECTION_DIALOG_CLASS}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {props.i18n.t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={busyStateMatchesAction(props.busyState, 'save_environment')}
            onClick={() => {
              void props.onSave();
            }}
          >
            <Save class="mr-1 h-3.5 w-3.5" />
            {props.i18n.t('connectionDialog.save')}
          </Button>
        </div>
      )}
    >
      <div
        class="space-y-5"
        onWheel={(event) => {
          let el: HTMLElement | null = event.currentTarget as HTMLElement;
          while (el) {
            if (el.scrollHeight > el.clientHeight) {
              const style = getComputedStyle(el);
              if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                el.scrollTop += event.deltaY;
                return;
              }
            }
            el = el.parentElement;
          }
        }}
      >
        <Show when={isCreate()}>
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.environmentType')}</label>
            <SegmentedControl
              value={connectionKind()}
              onChange={(value) => props.switchKind(value as ConnectionDialogKind)}
              options={[
                { value: 'external_local_ui', label: props.i18n.t('connectionDialog.redevenUrl') },
                { value: 'ssh_environment', label: props.i18n.t('connectionDialog.sshHost') },
                { value: 'local_container_runtime', label: props.i18n.t('connectionDialog.localContainer') },
                { value: 'ssh_container_runtime', label: props.i18n.t('connectionDialog.sshContainer') },
              ]}
              size="sm"
            />
            <div class="rounded-md border border-dashed border-border/40 bg-muted/10 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              {connectionKindDescription()}
            </div>
          </div>
        </Show>

        <Show when={connectionKind() === 'external_local_ui'}>
          <div class="redeven-dialog-section">
            <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {props.i18n.t('connectionDialog.connectionUrl')}
            </div>
            <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-3 mt-2 transition-[border-color,background-color,box-shadow] duration-150 hover:border-primary/25 hover:shadow-[0_4px_16px_-12px_color-mix(in_srgb,var(--foreground)_20%,transparent)]">
              <div class="space-y-1.5">
                <label for="environment-url" class="block text-xs font-medium text-foreground">
                  {props.i18n.t('connectionDialog.environmentUrl')} <span class="text-destructive">*</span>
                </label>
                <Input
                  id="environment-url"
                  value={props.state?.connection_kind === 'external_local_ui' ? props.state.external_local_ui_url : ''}
                  onInput={(event) => {
                    props.updateField('external_local_ui_url', event.currentTarget.value);
                    props.clearFieldErrors();
                  }}
                  placeholder="http://192.168.1.11:24000/"
                  size="sm"
                  class={cn('w-full', props.fieldErrors.external_local_ui_url && 'border-destructive ring-1 ring-destructive/20')}
                  spellcheck={false}
                  autofocus={props.state?.mode === 'create'}
                />
                <Show when={props.fieldErrors.external_local_ui_url}>
                  <div class="text-[11px] text-destructive">{props.fieldErrors.external_local_ui_url}</div>
                </Show>
              </div>
            </div>
          </div>
        </Show>

        <Show when={isSSHBackedKind()}>
          <div class="redeven-dialog-section">
            <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {props.i18n.t('connectionDialog.sshHostSection')}
            </div>
            <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-3 mt-2 transition-[border-color,background-color,box-shadow] duration-150 hover:border-primary/25 hover:shadow-[0_4px_16px_-12px_color-mix(in_srgb,var(--foreground)_20%,transparent)]">
              <div class="rounded-md border border-dashed border-border/40 bg-muted/10 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                {connectionKind() === 'ssh_environment'
                  ? props.i18n.t('connectionDialog.sshEnvironmentNotice')
                  : props.i18n.t('connectionDialog.sshContainerNotice')}
              </div>
              <div class="mt-3 space-y-3">
                <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
                <div class="space-y-1.5">
                  <label for="environment-ssh-destination" class="block text-xs font-medium text-foreground">
                    {props.i18n.t('connectionDialog.sshDestination')} <span class="text-destructive">*</span>
                  </label>
                  <SSHDestinationCombobox
                    i18n={props.i18n}
                    value={isSSHBackedKind() ? (props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.ssh_destination ?? '' : ''}
                    hosts={props.sshConfigHosts}
                    autofocus={props.state?.mode === 'create'}
                    class={props.fieldErrors.ssh_destination && 'border-destructive ring-1 ring-destructive/20'}
                    onInput={(value) => {
                      props.updateField('ssh_destination', value);
                      props.clearFieldErrors();
                    }}
                    onSelectHost={(host) => {
                      props.updateField('ssh_destination', host.alias);
                      props.updateField('ssh_port', host.port == null ? '' : String(host.port));
                    }}
                  />
                  <Show when={props.fieldErrors.ssh_destination}>
                    <div class="text-[11px] text-destructive">{props.fieldErrors.ssh_destination}</div>
                  </Show>
                </div>
                <div class="space-y-1.5">
                  <label for="environment-ssh-port" class="block text-xs font-medium text-foreground">{props.i18n.t('settings.portLabel')}</label>
                  <Input
                    id="environment-ssh-port"
                    value={isSSHBackedKind() ? (props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.ssh_port ?? '' : ''}
                    onInput={(event) => {
                      const raw = event.currentTarget.value.replace(/\D/g, '');
                      props.updateField('ssh_port', raw);
                      props.clearFieldErrors();
                    }}
                    placeholder="22"
                    inputMode="numeric"
                    size="sm"
                    class={cn('w-full', props.fieldErrors.ssh_port && 'border-destructive ring-1 ring-destructive/20')}
                  />
                  <Show when={props.fieldErrors.ssh_port}>
                    <div class="text-[11px] text-destructive">{props.fieldErrors.ssh_port}</div>
                  </Show>
                </div>
              </div>
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.authentication')}</label>
                <SegmentedControl
                  value={isSSHBackedKind() ? (props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE : DEFAULT_DESKTOP_SSH_AUTH_MODE}
                  onChange={(value) => props.updateField('auth_mode', value)}
                  options={[
                    { value: 'key_agent', label: props.i18n.t('connectionDialog.keyAgent') },
                    { value: 'password', label: props.i18n.t('connectionDialog.passwordPrompt') },
                  ]}
                  size="sm"
                />
                <div class="text-[11px] leading-5 text-muted-foreground">
                  {props.i18n.t('connectionDialog.authenticationHelp')}
                </div>
              </div>
              <Show when={isSSHBackedKind() && ((props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE) === 'password'}>
                <div class="space-y-1.5">
                  <label for="environment-ssh-password" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.localSshPassword')}</label>
                  <Input
                    id="environment-ssh-password"
                    type="password"
                    autocomplete="new-password"
                    value={isSSHBackedKind() ? (props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.ssh_password ?? '' : ''}
                    onInput={(event) => props.updateField('ssh_password', event.currentTarget.value)}
                    placeholder={(props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.ssh_password_configured ? props.i18n.t('connectionDialog.replaceStoredPasswordPlaceholder') : props.i18n.t('connectionDialog.optionalSavedPasswordPlaceholder')}
                    size="sm"
                    class="w-full"
                  />
                  <div class="text-[11px] leading-5 text-muted-foreground">
                    {props.i18n.t('connectionDialog.localSshPasswordHelp')}
                  </div>
                  <Show when={(props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.ssh_password_configured && (props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.ssh_password_mode !== 'clear'}>
                    <Button size="sm" variant="outline" onClick={props.removeSSHPassword}>
                      {props.i18n.t('settings.removeStoredPassword')}
                    </Button>
                  </Show>
                  <Show when={(props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.ssh_password_mode === 'clear'}>
                    <div class="text-[11px] text-muted-foreground">{props.i18n.t('connectionDialog.storedSshPasswordWillBeRemoved')}</div>
                  </Show>
                </div>
              </Show>
              <Show when={connectionKind() === 'ssh_environment'}>
                <div class="overflow-hidden rounded-md border border-border/70 bg-background/80">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left"
                  onClick={() => setAdvancedState((current) => ({ ...current, open: !current.open }))}
                >
                  <div>
                    <div class="text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.advanced')}</div>
                    <div class="mt-1 text-[11px] text-muted-foreground">
                      {props.i18n.t('connectionDialog.advancedDescription')}
                    </div>
                  </div>
                  <Tag variant="neutral" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                    {showSSHAdvanced() ? props.i18n.t('connectionDialog.shown') : props.i18n.t('connectionDialog.hidden')}
                  </Tag>
                </button>
                <div class={cn(
                  'redeven-dialog-collapse',
                  showSSHAdvanced() && 'redeven-dialog-collapse--open',
                )}>
                  <div>
                    <div class="border-t border-border/70 px-3 py-3">
                    <div class="space-y-3">
                      <div class="space-y-1.5">
                        <label class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.bootstrapDelivery')}</label>
                        <SegmentedControl
                          value={sshBootstrapStrategy()}
                          onChange={(value) => props.switchBootstrapStrategy(value as DesktopSSHBootstrapStrategy)}
                          options={[
                            { value: 'auto', label: props.i18n.t('connectionDialog.automatic') },
                            { value: 'desktop_upload', label: props.i18n.t('connectionDialog.desktopUpload') },
                            { value: 'remote_install', label: props.i18n.t('connectionDialog.remoteFallback') },
                          ]}
                          size="sm"
                        />
                        <div class="text-[11px] text-muted-foreground">
                          {props.i18n.t('connectionDialog.bootstrapHelp')}{' '}
                          <span class="font-medium text-foreground">{props.i18n.t('connectionDialog.source', { source: sshBootstrapSummaryLabel() })}</span>
                        </div>
                      </div>
                      <div class="space-y-1.5">
                        <label for="environment-ssh-runtime-root" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.runtimeRoot')}</label>
                        <Input
                          id="environment-ssh-runtime-root"
                          value={props.state?.connection_kind === 'ssh_environment' ? props.state.runtime_root : ''}
                          onInput={(event) => props.updateField('runtime_root', event.currentTarget.value)}
                          placeholder="$HOME/.redeven"
                          size="sm"
                          class="w-full"
                          spellcheck={false}
                        />
                        <div class="text-[11px] text-muted-foreground">
                          {props.i18n.t('connectionDialog.runtimeRootHelp', { root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT_LABEL })}
                        </div>
                      </div>
                      <div class="space-y-1.5">
                        <label for="environment-ssh-release-base-url" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.releaseBaseUrl')}</label>
                        <Input
                          id="environment-ssh-release-base-url"
                          value={props.state?.connection_kind === 'ssh_environment' ? props.state.release_base_url : ''}
                          onInput={(event) => props.updateField('release_base_url', event.currentTarget.value)}
                          placeholder="https://github.com/floegence/redeven/releases"
                          size="sm"
                          class="w-full"
                          spellcheck={false}
                        />
                        <div class="text-[11px] text-muted-foreground">
                          {props.i18n.t('connectionDialog.releaseBaseUrlHelp', { url: DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL })}
                        </div>
                      </div>
                      <div class="space-y-1.5">
                        <label for="environment-ssh-connect-timeout" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.connectTimeout')}</label>
                        <Input
                          id="environment-ssh-connect-timeout"
                          value={isSSHBackedKind() ? (props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.connect_timeout_seconds ?? '' : ''}
                          onInput={(event) => props.updateField('connect_timeout_seconds', event.currentTarget.value)}
                          placeholder={String(DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS)}
                          size="sm"
                          class="w-28"
                          spellcheck={false}
                        />
                        <div class="text-[11px] text-muted-foreground">
                          {props.i18n.t('connectionDialog.connectTimeoutHelp', { seconds: DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS })}
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
              </div>
              </Show>
              </div>
            </div>
          </div>
        </Show>

        <Show when={isContainerKind()}>
          <div class="redeven-dialog-section">
            <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {props.i18n.t('connectionDialog.container')}
            </div>
            <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-3 mt-2 transition-[border-color,background-color,box-shadow] duration-150 hover:border-primary/25 hover:shadow-[0_4px_16px_-12px_color-mix(in_srgb,var(--foreground)_20%,transparent)]">
              <div class="space-y-3">
                <div class="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)] items-start">
                  <div class="space-y-1.5">
                    <div class="flex items-center h-7">
                      <label class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.engine')}</label>
                    </div>
                    <SegmentedControl
                    value={props.state?.connection_kind === 'local_container_runtime' || props.state?.connection_kind === 'ssh_container_runtime' ? props.state.container_engine : 'docker'}
                    onChange={(value) => {
                      props.updateField('container_engine', value);
                      props.updateField('container_id', '');
                      props.updateField('container_ref', '');
                      props.updateField('container_label', '');
                      props.clearFieldErrors();
                    }}
                    options={[
                      { value: 'docker', label: 'Docker' },
                      { value: 'podman', label: 'Podman' },
                    ]}
                    size="sm"
                  />
                </div>
                <ContainerPicker
                  i18n={props.i18n}
                  selectedContainerID={props.state?.connection_kind === 'local_container_runtime' || props.state?.connection_kind === 'ssh_container_runtime' ? props.state.container_id : ''}
                  selectedContainerRef={props.state?.connection_kind === 'local_container_runtime' || props.state?.connection_kind === 'ssh_container_runtime' ? props.state.container_ref : ''}
                  selectedContainerLabel={props.state?.connection_kind === 'local_container_runtime' || props.state?.connection_kind === 'ssh_container_runtime' ? props.state.container_label : ''}
                  containers={props.containerOptions}
                  loading={props.containerOptionsLoading}
                  disabled={connectionKind() === 'ssh_container_runtime' && trimString((props.state as RuntimeContainerConnectionDialogState | null)?.ssh_destination) === ''}
                  error={props.containerOptionsError}
                  emptyMessage={connectionKind() === 'ssh_container_runtime' && trimString((props.state as RuntimeContainerConnectionDialogState | null)?.ssh_destination) === ''
                    ? props.i18n.t('connectionDialog.chooseSshBeforeContainers')
                    : props.i18n.t('connectionDialog.noRunningContainers')}
                  fieldError={props.fieldErrors.container_id}
                  onRefresh={props.refreshContainerOptions}
                  onSelect={(container) => {
                    props.updateField('container_id', container.container_id);
                    props.updateField('container_ref', container.container_ref);
                    props.updateField('container_label', container.container_label);
                    props.clearFieldErrors();
                  }}
                />
              </div>
                <div class="space-y-1.5">
                  <label for="environment-container-runtime-root" class="block text-xs font-medium text-foreground">
                  {props.i18n.t('connectionDialog.runtimeRoot')}
                  <Show when={connectionKind() === 'local_container_runtime'}>
                    {' '}<span class="text-destructive">*</span>
                  </Show>
                </label>
                <Input
                  id="environment-container-runtime-root"
                  value={props.state?.connection_kind === 'local_container_runtime' || props.state?.connection_kind === 'ssh_container_runtime' ? props.state.runtime_root : ''}
                  onInput={(event) => {
                    props.updateField('runtime_root', event.currentTarget.value);
                    props.clearFieldErrors();
                  }}
                  placeholder={connectionKind() === 'ssh_container_runtime' ? DEFAULT_DESKTOP_SSH_RUNTIME_ROOT_LABEL : '/root/.redeven'}
                  size="sm"
                  class={cn('w-full', props.fieldErrors.runtime_root && 'border-destructive ring-1 ring-destructive/20')}
                  spellcheck={false}
                />
                <div class="text-[11px] text-muted-foreground">
                  {connectionKind() === 'ssh_container_runtime'
                    ? props.i18n.t('connectionDialog.runtimeRootHelp', { root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT_LABEL })
                    : props.i18n.t('connectionDialog.containerRuntimeRootHelp')}
                </div>
                <Show when={props.fieldErrors.runtime_root}>
                  <div class="text-[11px] text-destructive">{props.fieldErrors.runtime_root}</div>
                </Show>
              </div>
            </div>
          </div>
          </div>
        </Show>

        <Show when={connectionDialogAutoRuntimeProbeConfigurable(props.state)}>
          <div class="redeven-dialog-section">
            <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {props.i18n.t('connectionDialog.statusDetection')}
            </div>
            <div class="mt-2 rounded-md border border-border/70 bg-muted/20 px-3 py-3">
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <div class="text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.autoStatusDetection')}</div>
                  <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                    {props.i18n.t('connectionDialog.autoStatusDetectionHelp')}
                  </div>
                </div>
                <Checkbox
                  checked={props.state?.auto_runtime_probe_enabled === true}
                  onChange={props.toggleAutoRuntimeProbe}
                  label={props.i18n.t('connectionDialog.enabled')}
                  size="sm"
                />
              </div>
            </div>
          </div>
        </Show>

        <div class="space-y-1.5 rounded-md border border-dashed border-border/30 bg-background/40 px-3 py-3">
          <label for="environment-label" class="block text-xs font-medium text-foreground">
            {props.i18n.t('connectionDialog.name')} <span class="text-destructive">*</span>
          </label>
          <Input
            id="environment-label"
            value={props.state?.label ?? ''}
            onInput={(event) => {
              props.updateField('label', event.currentTarget.value);
              props.clearFieldErrors();
            }}
            placeholder={props.i18n.t('connectionDialog.namePlaceholder')}
            size="sm"
            class={cn('w-full', props.fieldErrors.label && 'border-destructive ring-1 ring-destructive/20')}
          />
          <Show when={props.fieldErrors.label}>
            <div class="text-[11px] text-destructive">{props.fieldErrors.label}</div>
          </Show>
        </div>

        <Show when={props.error}>
          <div role="alert" class="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {props.error}
          </div>
        </Show>
      </div>
    </Dialog>
  );
}

function GatewaySetupDialog(props: Readonly<{
  i18n: DesktopI18n;
  state: GatewaySetupDialogState | null;
  sshConfigHosts: readonly DesktopSSHConfigHost[];
  containerOptions: readonly DesktopRuntimeContainerOption[];
  containerOptionsLoading: boolean;
  containerOptionsError: string;
  error: string;
  fieldErrors: Partial<Record<string, string>>;
  busyState: DesktopLauncherBusyState;
  onOpenChange: (open: boolean) => void;
  updateField: (name: keyof GatewaySetupDialogState, value: string | boolean) => void;
  refreshContainerOptions: () => void;
  clearFieldErrors: () => void;
  removeSSHPassword: () => void;
  onSave: () => Promise<void>;
}>) {
  const isOpen = createMemo(() => props.state !== null);
  const connectionKind = createMemo(() => props.state?.connection_kind ?? 'url');
  const isSSHBacked = createMemo(() => connectionKind() === 'ssh_host' || connectionKind() === 'ssh_container');
  const isContainer = createMemo(() => connectionKind() === 'ssh_container');
  const [advancedState, setAdvancedState] = createSignal<SSHConnectionDialogAdvancedState>({
    open: false,
    initialized_for_state_key: 'closed',
  });
  const showSSHAdvanced = createMemo(() => isSSHBacked() && advancedState().open);
  const gatewayBootstrapStrategy = createMemo(() => (
    props.state?.connection_kind === 'ssh_host'
      ? props.state.bootstrap_strategy
      : DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY
  ));
  const gatewayReleaseBaseURLLabel = createMemo(() => (
    trimString(
      props.state?.connection_kind === 'ssh_host'
        ? props.state.release_base_url
        : '',
    ) === ''
      ? DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL
      : props.i18n.t('connectionDialog.customMirror')
  ));
  const gatewayBootstrapSummaryLabel = createMemo(() => {
    switch (gatewayBootstrapStrategy()) {
      case 'desktop_upload':
        return gatewayReleaseBaseURLLabel();
      case 'remote_install':
        return props.i18n.t('connectionDialog.remoteFallback');
      default:
        return props.i18n.t('connectionDialog.automatic');
    }
  });
  const gatewayAdvancedDescription = createMemo(() => (
    connectionKind() === 'ssh_host'
      ? props.i18n.t('connectionDialog.advancedDescription')
      : props.i18n.t('connectionDialog.gatewayContainerAdvancedDescription')
  ));

  createEffect(() => {
    const state = props.state;
    const snapshot: SSHConnectionDialogStateSnapshot = state?.connection_kind === 'ssh_host' || state?.connection_kind === 'ssh_container'
      ? {
          mode: state.mode,
          connection_kind: state.connection_kind,
          gateway_id: state.gateway_id,
          runtime_root: state.runtime_root,
          release_base_url: state.release_base_url,
          connect_timeout_seconds: state.connect_timeout_seconds,
        }
      : null;
    setAdvancedState((current) => syncSSHConnectionDialogAdvancedState(current, snapshot));
  });

  return (
    <Dialog
      open={isOpen()}
      onOpenChange={props.onOpenChange}
      title={props.i18n.t('connectionDialog.addGatewayTitle')}
      class={CONNECTION_DIALOG_CLASS}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {props.i18n.t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={busyStateMatchesAction(props.busyState, 'upsert_gateway')}
            onClick={() => {
              void props.onSave();
            }}
          >
            <Save class="mr-1 h-3.5 w-3.5" />
            {props.i18n.t('connectionDialog.saveGateway')}
          </Button>
        </div>
      )}
    >
      <div class="space-y-5">
        <div class="space-y-1.5">
          <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {props.i18n.t('connectionDialog.gatewayTransport')}
          </div>
          <SegmentedControl
            value={connectionKind()}
            onChange={(value) => {
              props.updateField('connection_kind', value);
              props.clearFieldErrors();
            }}
            options={[
              { value: 'url', label: props.i18n.t('connectionDialog.gatewayTransportUrl') },
              { value: 'ssh_host', label: props.i18n.t('connectionDialog.gatewayTransportSshHost') },
              { value: 'ssh_container', label: props.i18n.t('connectionDialog.gatewayTransportSshContainer') },
            ]}
            size="sm"
          />
          <div class="rounded-md border border-dashed border-border/40 bg-muted/10 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            {connectionKind() === 'url'
              ? props.i18n.t('connectionDialog.gatewayUrlHelp')
              : connectionKind() === 'ssh_host'
                ? props.i18n.t('connectionDialog.gatewaySshHostHelp')
                : props.i18n.t('connectionDialog.gatewaySshContainerHelp')}
          </div>
        </div>

        <Show when={connectionKind() === 'url'}>
          <div class="redeven-dialog-section">
            <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {props.i18n.t('connectionDialog.connectionUrl')}
            </div>
            <div class="mt-2 rounded-md border border-border/70 bg-muted/20 px-3 py-3 transition-[border-color,background-color,box-shadow] duration-150 hover:border-primary/25 hover:shadow-[0_4px_16px_-12px_color-mix(in_srgb,var(--foreground)_20%,transparent)]">
              <div class="space-y-1.5">
                <label for="gateway-url" class="block text-xs font-medium text-foreground">
                  {props.i18n.t('connectionDialog.gatewayUrl')} <span class="text-destructive">*</span>
                </label>
                <Input
                  id="gateway-url"
                  value={props.state?.gateway_url ?? ''}
                  onInput={(event) => {
                    props.updateField('gateway_url', event.currentTarget.value);
                    props.clearFieldErrors();
                  }}
                  placeholder={props.i18n.t('connectionDialog.gatewayUrlPlaceholder')}
                  size="sm"
                  class={cn('w-full', props.fieldErrors.gateway_url && 'border-destructive ring-1 ring-destructive/20')}
                  spellcheck={false}
                  autofocus
                />
                <Show when={props.fieldErrors.gateway_url}>
                  <div class="text-[11px] text-destructive">{props.fieldErrors.gateway_url}</div>
                </Show>
              </div>
            </div>
          </div>
        </Show>

        <Show when={isSSHBacked()}>
          <div class="redeven-dialog-section">
            <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {props.i18n.t('connectionDialog.sshHostSection')}
            </div>
            <div class="mt-2 rounded-md border border-border/70 bg-muted/20 px-3 py-3 transition-[border-color,background-color,box-shadow] duration-150 hover:border-primary/25 hover:shadow-[0_4px_16px_-12px_color-mix(in_srgb,var(--foreground)_20%,transparent)]">
              <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
                <div class="space-y-1.5">
                  <label for="gateway-ssh-destination" class="block text-xs font-medium text-foreground">
                    {props.i18n.t('connectionDialog.sshDestination')} <span class="text-destructive">*</span>
                  </label>
                  <SSHDestinationCombobox
                    i18n={props.i18n}
                    value={props.state?.ssh_destination ?? ''}
                    hosts={props.sshConfigHosts}
                    autofocus={connectionKind() !== 'url' && props.state?.mode === 'create'}
                    class={props.fieldErrors.ssh_destination && 'border-destructive ring-1 ring-destructive/20'}
                    onInput={(value) => {
                      props.updateField('ssh_destination', value);
                      props.clearFieldErrors();
                    }}
                    onSelectHost={(host) => {
                      props.updateField('ssh_destination', host.alias);
                      props.updateField('ssh_port', host.port == null ? '' : String(host.port));
                    }}
                  />
                  <Show when={props.fieldErrors.ssh_destination}>
                    <div class="text-[11px] text-destructive">{props.fieldErrors.ssh_destination}</div>
                  </Show>
                </div>
                <div class="space-y-1.5">
                  <label for="gateway-ssh-port" class="block text-xs font-medium text-foreground">{props.i18n.t('settings.portLabel')}</label>
                  <Input
                    id="gateway-ssh-port"
                    value={props.state?.ssh_port ?? ''}
                    onInput={(event) => {
                      props.updateField('ssh_port', event.currentTarget.value.replace(/\D/g, ''));
                      props.clearFieldErrors();
                    }}
                    placeholder="22"
                    inputMode="numeric"
                    size="sm"
                    class={cn('w-full', props.fieldErrors.ssh_port && 'border-destructive ring-1 ring-destructive/20')}
                  />
                </div>
              </div>
              <div class="mt-3 space-y-1.5">
                <div class="space-y-1.5">
                  <label class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.authentication')}</label>
                  <SegmentedControl
                    value={props.state?.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE}
                    onChange={(value) => props.updateField('auth_mode', value)}
                    options={[
                      { value: 'key_agent', label: props.i18n.t('connectionDialog.keyAgent') },
                      { value: 'password', label: props.i18n.t('connectionDialog.passwordPrompt') },
                    ]}
                    size="sm"
                  />
                  <div class="text-[11px] leading-5 text-muted-foreground">
                    {props.i18n.t('connectionDialog.authenticationHelp')}
                  </div>
                  <Show when={props.fieldErrors.auth_mode}>
                    <div class="text-[11px] text-destructive">{props.fieldErrors.auth_mode}</div>
                  </Show>
                </div>
              </div>
              <Show when={(props.state?.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE) === 'password'}>
                <div class="mt-3 space-y-1.5">
                  <label for="gateway-ssh-password" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.localSshPassword')}</label>
                  <Input
                    id="gateway-ssh-password"
                    type="password"
                    autocomplete="new-password"
                    value={props.state?.ssh_password ?? ''}
                    onInput={(event) => props.updateField('ssh_password', event.currentTarget.value)}
                    placeholder={props.state?.ssh_password_configured ? props.i18n.t('connectionDialog.replaceStoredPasswordPlaceholder') : props.i18n.t('connectionDialog.optionalSavedPasswordPlaceholder')}
                    size="sm"
                    class="w-full"
                  />
                  <div class="text-[11px] leading-5 text-muted-foreground">
                    {props.i18n.t('connectionDialog.localSshPasswordHelp')}
                  </div>
                  <Show when={props.state?.ssh_password_configured && props.state?.ssh_password_mode !== 'clear'}>
                    <Button size="sm" variant="outline" onClick={props.removeSSHPassword}>
                      {props.i18n.t('settings.removeStoredPassword')}
                    </Button>
                  </Show>
                  <Show when={props.state?.ssh_password_mode === 'clear'}>
                    <div class="text-[11px] text-muted-foreground">{props.i18n.t('connectionDialog.storedSshPasswordWillBeRemoved')}</div>
                  </Show>
                </div>
              </Show>
              <div class="mt-3 overflow-hidden rounded-md border border-border/70 bg-background/80">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left"
                  onClick={() => setAdvancedState((current) => ({ ...current, open: !current.open }))}
                >
                  <div>
                    <div class="text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.advanced')}</div>
                    <div class="mt-1 text-[11px] text-muted-foreground">
                      {gatewayAdvancedDescription()}
                    </div>
                  </div>
                  <Tag variant="neutral" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                    {showSSHAdvanced() ? props.i18n.t('connectionDialog.shown') : props.i18n.t('connectionDialog.hidden')}
                  </Tag>
                </button>
                <div class={cn(
                  'redeven-dialog-collapse',
                  showSSHAdvanced() && 'redeven-dialog-collapse--open',
                )}>
                  <div>
                    <div class="border-t border-border/70 px-3 py-3">
                      <div class="space-y-3">
                        <Show when={connectionKind() === 'ssh_host'}>
                          <div class="space-y-1.5">
                            <label class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.bootstrapDelivery')}</label>
                            <SegmentedControl
                              value={gatewayBootstrapStrategy()}
                              onChange={(value) => props.updateField('bootstrap_strategy', value)}
                              options={[
                                { value: 'auto', label: props.i18n.t('connectionDialog.automatic') },
                                { value: 'desktop_upload', label: props.i18n.t('connectionDialog.desktopUpload') },
                                { value: 'remote_install', label: props.i18n.t('connectionDialog.remoteFallback') },
                              ]}
                              size="sm"
                            />
                            <div class="text-[11px] text-muted-foreground">
                              {props.i18n.t('connectionDialog.bootstrapHelp')}{' '}
                              <span class="font-medium text-foreground">{props.i18n.t('connectionDialog.source', { source: gatewayBootstrapSummaryLabel() })}</span>
                            </div>
                          </div>
                        </Show>
                        <div class="space-y-1.5">
                          <label for="gateway-runtime-root" class="block text-xs font-medium text-foreground">
                            {props.i18n.t('connectionDialog.runtimeRoot')}
                          </label>
                          <Input
                            id="gateway-runtime-root"
                            value={props.state?.runtime_root ?? ''}
                            onInput={(event) => {
                              props.updateField('runtime_root', event.currentTarget.value);
                              props.clearFieldErrors();
                            }}
                            placeholder={DEFAULT_DESKTOP_SSH_RUNTIME_ROOT_LABEL}
                            size="sm"
                            class={cn('w-full', props.fieldErrors.runtime_root && 'border-destructive ring-1 ring-destructive/20')}
                            spellcheck={false}
                          />
                          <div class="text-[11px] text-muted-foreground">
                            {props.i18n.t('connectionDialog.gatewayRuntimeRootHelp', { root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT_LABEL })}
                          </div>
                          <Show when={props.fieldErrors.runtime_root}>
                            <div class="text-[11px] text-destructive">{props.fieldErrors.runtime_root}</div>
                          </Show>
                        </div>
                        <Show when={connectionKind() === 'ssh_host'}>
                          <div class="space-y-1.5">
                            <label for="gateway-release-base-url" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.releaseBaseUrl')}</label>
                            <Input
                              id="gateway-release-base-url"
                              value={props.state?.release_base_url ?? ''}
                              onInput={(event) => props.updateField('release_base_url', event.currentTarget.value)}
                              placeholder="https://github.com/floegence/redeven/releases"
                              size="sm"
                              class="w-full"
                              spellcheck={false}
                            />
                            <div class="text-[11px] text-muted-foreground">
                              {props.i18n.t('connectionDialog.releaseBaseUrlHelp', { url: DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL })}
                            </div>
                          </div>
                        </Show>
                        <div class="space-y-1.5">
                          <label for="gateway-ssh-connect-timeout" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.connectTimeout')}</label>
                          <Input
                            id="gateway-ssh-connect-timeout"
                            value={props.state?.connect_timeout_seconds ?? ''}
                            onInput={(event) => props.updateField('connect_timeout_seconds', event.currentTarget.value.replace(/[^\d.]/g, ''))}
                            placeholder={String(DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS)}
                            size="sm"
                            class="w-28"
                            spellcheck={false}
                          />
                          <div class="text-[11px] text-muted-foreground">
                            {props.i18n.t('connectionDialog.connectTimeoutHelp', { seconds: DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={isContainer()}>
          <div class="redeven-dialog-section">
            <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {props.i18n.t('connectionDialog.container')}
            </div>
            <div class="mt-2 rounded-md border border-border/70 bg-muted/20 px-3 py-3 transition-[border-color,background-color,box-shadow] duration-150 hover:border-primary/25 hover:shadow-[0_4px_16px_-12px_color-mix(in_srgb,var(--foreground)_20%,transparent)]">
              <div class="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <div class="space-y-1.5">
                  <div class="flex h-7 items-center">
                    <label class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.engine')}</label>
                  </div>
                  <SegmentedControl
                    value={props.state?.container_engine ?? 'docker'}
                    onChange={(value) => {
                      props.updateField('container_engine', value);
                      props.clearFieldErrors();
                    }}
                    options={[
                      { value: 'docker', label: 'Docker' },
                      { value: 'podman', label: 'Podman' },
                    ]}
                    size="sm"
                  />
                </div>
                <ContainerPicker
                  i18n={props.i18n}
                  selectedContainerID={props.state?.container_id ?? ''}
                  selectedContainerRef={props.state?.container_ref ?? ''}
                  selectedContainerLabel={props.state?.container_label ?? ''}
                  containers={props.containerOptions}
                  loading={props.containerOptionsLoading}
                  disabled={trimString(props.state?.ssh_destination) === ''}
                  error={props.containerOptionsError}
                  emptyMessage={trimString(props.state?.ssh_destination) === ''
                    ? props.i18n.t('connectionDialog.chooseSshBeforeContainers')
                    : props.i18n.t('connectionDialog.noRunningContainers')}
                  fieldError={props.fieldErrors.container_id}
                  onRefresh={props.refreshContainerOptions}
                  onSelect={(container) => {
                    props.updateField('container_id', container.container_id);
                    props.updateField('container_ref', container.container_ref);
                    props.updateField('container_label', container.container_label);
                    props.clearFieldErrors();
                  }}
                />
              </div>
            </div>
          </div>
        </Show>

        <div class="space-y-1.5 rounded-md border border-dashed border-border/30 bg-background/40 px-3 py-3">
          <label for="gateway-name" class="block text-xs font-medium text-foreground">
            {props.i18n.t('connectionDialog.gatewayName')} <span class="text-destructive">*</span>
          </label>
          <Input
            id="gateway-name"
            value={props.state?.display_name ?? ''}
            onInput={(event) => {
              props.updateField('display_name', event.currentTarget.value);
              props.clearFieldErrors();
            }}
            placeholder={props.i18n.t('connectionDialog.gatewayNamePlaceholder')}
            size="sm"
            class={cn('w-full', props.fieldErrors.display_name && 'border-destructive ring-1 ring-destructive/20')}
          />
          <Show when={props.fieldErrors.display_name}>
            <div class="text-[11px] text-destructive">{props.fieldErrors.display_name}</div>
          </Show>
        </div>

        <Show when={connectionKind() === 'url'}>
          <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-3">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.allowLoopbackHttp')}</div>
                <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {props.i18n.t('connectionDialog.allowLoopbackHttpHelp')}
                </div>
              </div>
              <Checkbox
                checked={props.state?.allow_loopback_http === true}
                onChange={(enabled) => props.updateField('allow_loopback_http', enabled)}
                label={props.i18n.t('connectionDialog.enabled')}
                size="sm"
              />
            </div>
          </div>
        </Show>

        <Show when={props.error}>
          <div role="alert" class="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {props.error}
          </div>
        </Show>
      </div>
    </Dialog>
  );
}

function ControlPlaneDialog(props: Readonly<{
  i18n: DesktopI18n;
  state: ControlPlaneDialogState;
  error: string;
  busyState: DesktopLauncherBusyState;
  onOpenChange: (open: boolean) => void;
  updateField: (name: 'display_label' | 'provider_origin', value: string) => void;
  onConnect: () => Promise<void>;
}>) {
  // See ConnectionDialog: memoize the open boolean so that identity churn in
  // `props.state` never re-triggers the overlay-mask focus trap mid-typing.
  const isOpen = createMemo(() => props.state !== null);
  return (
    <Dialog
      open={isOpen()}
      onOpenChange={props.onOpenChange}
      title={props.i18n.t('connectionDialog.addProviderTitle')}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {props.i18n.t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={busyStateMatchesAction(props.busyState, 'start_control_plane_connect')}
            onClick={() => {
              void props.onConnect();
            }}
          >
            {props.i18n.t('connectionDialog.continueInBrowser')}
          </Button>
        </div>
      )}
    >
      <div class="space-y-4">
        <div class="space-y-1.5">
          <label for="control-plane-label" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.providerName')}</label>
          <Input
            id="control-plane-label"
            value={props.state?.display_label ?? ''}
            onInput={(event) => props.updateField('display_label', event.currentTarget.value)}
            placeholder="region.example.invalid"
            size="sm"
            class="w-full"
            spellcheck={false}
          />
        </div>
        <div class="space-y-1.5">
          <label for="control-plane-origin" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.providerUrl')}</label>
          <Input
            id="control-plane-origin"
            value={props.state?.provider_origin ?? ''}
            onInput={(event) => props.updateField('provider_origin', event.currentTarget.value)}
            placeholder="https://region.example.invalid"
            size="sm"
            class="w-full"
            spellcheck={false}
            autofocus
          />
        </div>
        <div class="text-xs text-muted-foreground">
          {props.i18n.t('connectionDialog.providerAuthorizationHelp')}
        </div>
        <Show when={props.error}>
          <div role="alert" class="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {props.error}
          </div>
        </Show>
      </div>
    </Dialog>
  );
}

function LocalUIPasswordField(props: Readonly<{
  snapshot: DesktopSettingsSurfaceSnapshot;
  draft: DesktopSettingsDraft;
  i18n: DesktopI18n;
  passwordStateID: DesktopSettingsSurfaceSnapshot['password_state_id'];
  passwordStateTone: DesktopSettingsSurfaceSnapshot['password_state_tone'];
  localUIPasswordCanClear: boolean;
  updateDraftField: (name: keyof DesktopSettingsDraft, value: string) => void;
  clearStoredLocalUIPassword: () => void;
  sectionTitle?: string;
}>) {
  return (
    <div class="space-y-3">
      <div class="flex flex-wrap gap-1.5">
        <Tag
          variant={passwordStateTagVariant(props.passwordStateTone)}
          tone="soft"
          size="sm"
          class="cursor-default whitespace-nowrap"
        >
          {compactLocalizedPasswordStateTagLabel(props.i18n, props.passwordStateID)}
        </Tag>
        <Show when={trimString(props.draft.local_ui_password) !== ''}>
          <Tag variant="primary" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
            {props.i18n.t('settings.replacementQueued')}
          </Tag>
        </Show>
      </div>
      <SettingsFieldInput
        field={props.snapshot.host_fields[1]!}
        value={props.draft.local_ui_password}
        updateDraftField={props.updateDraftField}
        sectionTitle={props.sectionTitle}
        i18n={props.i18n}
      />
      <Show when={props.localUIPasswordCanClear}>
        <div class="flex justify-end">
          <button
            type="button"
            class="inline-flex cursor-pointer items-center justify-start rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={props.clearStoredLocalUIPassword}
          >
            {props.i18n.t('settings.removeStoredPassword')}
          </button>
        </div>
      </Show>
    </div>
  );
}

function SettingsFieldInput(props: Readonly<{
  field: DesktopSettingsSurfaceSnapshot['host_fields'][number];
  value: string;
  updateDraftField: (name: keyof DesktopSettingsDraft, value: string) => void;
  i18n: DesktopI18n;
  sectionTitle?: string;
}>) {
  const compactLabel = createMemo(() => compactLocalizedSettingsFieldLabel(props.i18n, props.field));
  const helpText = createMemo(() => localizedSettingsFieldHelp(props.i18n, props.field));
  const placeholderText = createMemo(() => localizedSettingsFieldPlaceholder(props.i18n, props.field));
  const showVisibleLabel = createMemo(() => compactLabel() !== trimString(props.sectionTitle));
  const describedBy = createMemo(() => {
    const values = (props.field.describedBy ?? []).filter((value) => {
      if (value === props.field.helpId) {
        return helpText() !== '';
      }
      return true;
    });
    return values.length > 0 ? values.join(' ') : undefined;
  });

  return (
    <label classList={{ hidden: props.field.hidden }} class="grid h-full gap-2.5">
      <Show
        when={showVisibleLabel()}
        fallback={<span class="sr-only">{compactLabel()}</span>}
      >
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-foreground">{compactLabel()}</span>
          <SettingsHelpBadge label={compactLabel()} content={helpText()} i18n={props.i18n} />
        </div>
      </Show>
      <Input
        id={props.field.id}
        name={props.field.name}
        value={props.value}
        type={props.field.type ?? 'text'}
        autocomplete={props.field.autocomplete}
        inputMode={props.field.inputMode}
        placeholder={placeholderText()}
        spellcheck={false}
        aria-describedby={describedBy()}
        aria-label={showVisibleLabel() ? undefined : compactLabel()}
        size="sm"
        class="w-full"
        onInput={(event) => props.updateDraftField(props.field.name, event.currentTarget.value)}
      />
      <Show when={helpText() !== '' && props.field.helpId}>
        <div id={props.field.helpId!} class="sr-only">{helpText()}</div>
      </Show>
    </label>
  );
}

export function DesktopWelcomeShell(props: DesktopWelcomeShellProps) {
  const shellLanguage = desktopLanguageBridge();
  const [languageSnapshot, setLanguageSnapshot] = createSignal<RedevenLanguageSnapshot>(
    shellLanguage?.getSnapshot() ?? FALLBACK_DESKTOP_LANGUAGE_SNAPSHOT,
  );
  createEffect(() => {
    if (!shellLanguage) return;
    const unsubscribe = shellLanguage.subscribe((next) => {
      setLanguageSnapshot(next);
    });
    onCleanup(unsubscribe);
  });
  const i18n = createMemo(() => createDesktopI18n(languageSnapshot().resolved_locale));
  const floeConfig = createMemo(() => buildDesktopFloeConfig(i18n()));
  createEffect(() => {
    document.title = i18n().t('desktop.title');
  });
  return (
    <FloeProvider config={floeConfig()}>
      <div data-redeven-desktop-locale={languageSnapshot().resolved_locale}>
        <DesktopWelcomeShellInner {...props} />
        <CommandPalette />
      </div>
    </FloeProvider>
  );
}

export async function loadDesktopWelcomeApp(): Promise<DesktopWelcomeShellProps | null> {
  const launcher = desktopLauncherBridge();
  const settings = desktopSettingsBridge();
  if (!launcher || !settings) {
    return null;
  }
  const snapshot = await launcher.getSnapshot();
  return {
    snapshot,
    runtime: {
      launcher,
      settings,
    },
  };
}
