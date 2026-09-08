import { For, Index, Show, createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Motion, Presence } from 'solid-motionone';
import qrcode from 'qrcode-generator';
import {
  BUILT_IN_SHELL_THEME_DEFAULTS,
  builtInShellThemePresets,
  cn,
  FloeProvider,
  useCommand,
  useTheme,
} from '@floegence/floe-webapp-core';
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
  Highlighter,
  Pin,
  Play,
  Plus,
  Refresh,
  Save,
  Search,
  Settings,
  MoreHorizontal,
  Shield,
  ShieldCheck,
  Stop,
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
  desktopGatewayConnectionKindLabel,
  desktopGatewayNeedsResolution,
  desktopGatewayProfileURLHasEmbeddedCredentials,
  type DesktopGatewayConnectionKind,
  type DesktopGatewayDiagnosis,
  type DesktopGatewayEnvironmentProfileAccessRoute,
  type DesktopGatewaySource,
} from '../shared/desktopGateway';
import type {
  DesktopEnvironmentEntry,
  DesktopEnvironmentOpenAction,
  DesktopLauncherActionProgress,
  DesktopLauncherActionFailureCode,
  DesktopLauncherActionSuccess,
  DesktopLauncherActionKind,
  DesktopGatewayResolveFocus,
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
  unsupportedDesktopUpdateSnapshot,
  type DesktopUpdateAction,
  type DesktopUpdateSnapshot,
} from '../shared/desktopUpdateIPC';
import {
  isDesktopLauncherActionFailure,
  isDesktopLauncherActionSuccess,
  selectLatestDesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import { launcherOperationInterruptionPresentation } from '../shared/launcherOperationInterruptionPresentation';
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
  type RuntimeServiceSnapshot,
  type RuntimeServiceWorkload,
} from '../shared/runtimeService';
import { endpointDisplayValue } from './endpointDisplay';
import {
  FlowerIcon,
  FlowerSoftAuraIcon,
  FlowerSurface,
  FlowerTurnLauncherWindow,
	createFlowerComposerDraftCoordinator,
  type FlowerTurnLauncherAnchor,
  type FlowerTurnLauncherIntent,
  type FlowerTurnLauncherSubmitInput,
  type FlowerThreadFocusRequest,
  type FlowerSurfaceWarmupState,
} from '../../../internal/flower_ui/src';
import { desktopEntryKindSupportsDirectRuntimeOperations } from '../shared/environmentManagementPrinciples';
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
  DesktopRuntimeTargetID,
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
  localizedOperationFailureSummary,
  localizedOperationFailureTitle,
} from './operationFailureI18n';
import {
  applyDesktopAccessAutoPortToDraft,
  applyDesktopAccessFixedPortToDraft,
  applyDesktopAccessModeToDraft,
  desktopPasswordStateTranslationKey,
  desktopSettingsDraftRequiresRuntimeRestart,
  deriveDesktopAccessDraftModel,
  validateDesktopAccessDraft,
} from '../shared/desktopAccessModel';
import {
  buildEnvironmentLibrarySummaryModel,
  buildEnvironmentLibraryLayoutModel,
  buildEnvironmentCardModel,
  buildEnvironmentSettingsRuntimeModel,
  buildEnvironmentCardFactsModel,
  buildGatewaySourceRowModel,
  ICON_ENDPOINTS,
  buildControlPlaneStatusModel,
  buildProviderBackedEnvironmentActionModel,
  environmentOpenFlow,
  environmentLibraryCount,
  environmentProviderFilterValue,
  filterGatewayEnvironmentEntries,
  filterEnvironmentLibrary,
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
  type EnvironmentCardTone,
  type EnvironmentActionPresentation,
  type EnvironmentCenterTab,
  type EnvironmentPrimaryActionOverlayModel,
} from './viewModel';
import {
  launcherActionFailurePresentation,
} from './launcherActionFeedback';
import {
  buildWelcomeOperationFailureDisplay,
  confirmationProgressForLauncherFailure,
} from './operationFailureDisplay';
import {
  syncSSHConnectionDialogAdvancedState,
  type SSHConnectionDialogAdvancedState,
} from './sshConnectionDialogState';
import {
  DesktopAnchoredListbox,
  scrollDesktopListboxOptionIntoView,
} from './DesktopAnchoredListbox';
import { SSHDestinationCombobox } from './SSHDestinationCombobox';
import {
  createDesktopSettingsDraftSession,
  reconcileDesktopSettingsDraftSession,
  updateDesktopSettingsDraftSessionDraft,
} from './settingsDraftSession';
import { describeNextStartAddress } from './welcomeCopy';
import {
  createDesktopThemeStorageAdapter,
  desktopStateStorageBridge,
  desktopThemeBridge,
} from './desktopTheme';
import { desktopLanguageBridge } from './desktopLanguage';
import { DesktopTooltip } from './DesktopTooltip';
import { DesktopLauncherShell } from './DesktopLauncherShell';
import {
  DesktopThemePicker,
  type DesktopThemePickerSnapshot,
} from './DesktopThemePicker';
import { rovingRadioIndexForKey } from './rovingRadioGroup';
import { RuntimeStatusOrb } from './RuntimeStatusOrb';
import { desktopControlPlaneKey } from '../shared/controlPlaneProvider';
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
  environmentEndpointOverlaySelectedValueFor,
  environmentLibraryOverlayOpenFor,
  openEnvironmentLibraryOverlayState,
  reconcileEnvironmentLibraryOverlayState,
  selectEnvironmentEndpointOverlayState,
} from './environmentLibraryOverlayState';
import {
  closeGatewaySourceOverlayState,
  closedGatewaySourceOverlayState,
  gatewaySourceIDsWithActiveOverlay,
  gatewaySourceOverlayOpenFor,
  openGatewaySourceOverlayState,
  reconcileGatewaySourceOverlayState,
} from './gatewaySourceOverlayState';
import {
  environmentLibraryEntryRecord,
  splitPinnedEnvironmentEntryIDs,
} from './environmentLibraryProjection';
import {
  environmentActionForLauncherRetry,
  groupedVisibleOperationNextActions,
} from './operationNextActions';
import {
  advanceEnvironmentOpenFlowStage,
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
  continueEnvironmentOpenAfterLifecycle,
  reconcileEnvironmentOpenBeforeLifecycle,
  runEnvironmentOpenPreflight,
} from './environmentOpenPreflight';
import {
  abandonEnvironmentLifecycleDisclosureAttempt,
  beginEnvironmentLifecycleDisclosure,
  bindEnvironmentLifecycleDisclosureOperation,
  closeEnvironmentLifecycleDisclosure,
  createEnvironmentLifecycleAttempt,
  environmentActionStartsLifecycleDisclosure,
  environmentLifecycleDisclosureHasPendingRequest,
  focusEnvironmentLifecycleDisclosure,
  reconcileEnvironmentLifecycleDisclosure,
  reopenEnvironmentLifecycleDisclosure,
  isEnvironmentLifecycleDisclosureIntent,
  type EnvironmentLifecycleDisclosureIntent,
  type EnvironmentLifecycleDisclosureState,
  type EnvironmentLifecycleAttempt,
} from './environmentLifecycleDisclosure';
import {
  environmentProgressMeterPercent,
  environmentProgressStageElapsedSeconds,
} from './environmentProgressMeter';
import {
  type EnvironmentProgressPrimaryPresentation,
  environmentProgressPanelPrimaryAction,
  environmentProgressPrimaryPresentation,
} from './environmentProgressPrimaryPresentation';
import {
  buildEnvironmentFlowerContextAction,
  environmentFlowerPrimaryTargetID,
} from './environmentFlowerContext';
import {
  busyStateForLauncherRequest,
  busyStateWithActionProgress,
  environmentOperationState,
  reconcileBusyStateWithActionProgressSnapshot,
  busyStateMatchesAction,
  busyStateMatchesControlPlane,
  busyStateMatchesEnvironment,
  busyStateMatchesGateway,
  IDLE_LAUNCHER_BUSY_STATE,
  selectedSnapshotRuntimeLifecycleProgressForEnvironment,
  progressForEnvironmentFocusRequest,
  selectedFlowerWarmupProgress,
  gatewaySourceMatchesRuntimeLifecycleProgress,
  type DesktopLauncherBusyState,
  type EnvironmentOperationState,
} from './launcherBusyState';
import {
  buildGatewayActionPresentation,
  type GatewayActionAffectedSession,
  type GatewayActionPanelModel,
} from './gatewayActionPresentation';
import { runGatewaySourceAction } from './gatewaySourceActionRunner';
import { createRuntimeLifecycleStepAnimation } from './runtimeLifecycleStepAnimation';
import { parseRuntimeMaintenanceMessage } from './runtimeMaintenanceMessage';
import {
  createLocalEnvironmentFlowerSurfaceAdapter,
  launchLocalEnvironmentFlowerTurn,
  type DesktopSettingsBridge,
} from './flower/localEnvironmentFlowerSurfaceAdapter';
import { createDesktopFlowerSurfaceCopy } from './flower/desktopFlowerSurfaceCopy';
import type {
  DesktopWSLActionResponse,
  DesktopWSLDiscoverySnapshot,
  DesktopWSLDistribution,
  DesktopWSLRegisterRequest,
  DesktopWSLSetDefaultRequest,
} from '../shared/desktopWSL';

type DesktopLauncherBridge = Readonly<{
  getSnapshot: () => Promise<DesktopWelcomeSnapshot>;
  getSSHConfigHosts?: () => Promise<readonly DesktopSSHConfigHost[]>;
  listRuntimeContainers?: (request: DesktopRuntimeContainerListRequest) => Promise<DesktopRuntimeContainerListResponse>;
  refreshWSL?: () => Promise<DesktopWSLDiscoverySnapshot>;
  registerWSL?: (request: DesktopWSLRegisterRequest) => Promise<DesktopWSLActionResponse>;
  setDefaultWSL?: (request: DesktopWSLSetDefaultRequest) => Promise<DesktopWSLActionResponse>;
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

type GatewayURLProfileConnectionDialogState = Readonly<{
  mode: 'create' | 'edit';
  connection_kind: 'gateway_url_profile';
  profile_route_kind: 'url';
  environment_id: string;
  gateway_id: string;
  label: string;
  target_url: string;
  origin_label: string;
  // Retained only to read and discard legacy profile drafts; URL is the sole
  // canonical route and these fields are never persisted or rendered.
  ssh_destination: string;
  ssh_port: string;
  auth_mode: DesktopSSHAuthMode;
  ssh_password: string;
  ssh_password_mode: 'keep' | 'replace' | 'clear';
  ssh_password_configured: boolean;
  baseline_ssh_destination: string;
  baseline_ssh_port: string;
  baseline_auth_mode: DesktopSSHAuthMode;
  container_engine: DesktopContainerEngine;
  container_id: string;
  container_ref: string;
  container_label: string;
  runtime_root: string;
}>;

type GatewaySetupDialogState = Readonly<{
  mode: 'create' | 'edit';
  gateway_id: string;
  display_name: string;
  display_name_touched: boolean;
  connection_kind: DesktopGatewayConnectionKind;
  gateway_url: string;
  pairing_code: string;
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
  focus_section?: 'url_endpoint' | 'ssh_host' | 'ssh_auth' | 'container' | 'identity_trust';
}>;

type ConnectionDialogKind = 'external_local_ui' | 'ssh_environment' | 'local_container_runtime' | 'ssh_container_runtime' | 'gateway_url_profile';
type ConnectionDialogState = ExternalURLConnectionDialogState | SSHConnectionDialogState | RuntimeContainerConnectionDialogState | GatewayURLProfileConnectionDialogState | null;
type SSHBackedConnectionDialogState = SSHConnectionDialogState | RuntimeContainerConnectionDialogState | GatewayURLProfileConnectionDialogState;
type ContainerBackedConnectionDialogState = RuntimeContainerConnectionDialogState | GatewayURLProfileConnectionDialogState;
type SSHPasswordConnectionDialogState = SSHBackedConnectionDialogState;
type SSHPasswordDraftState = SSHPasswordConnectionDialogState | GatewaySetupDialogState;

type ControlPlaneDialogState = Readonly<{
  provider_origin: string;
}> | null;

type EnvironmentGuidanceActionResolution = Readonly<{
  close_panel: boolean;
  next_session: EnvironmentGuidanceSessionState;
}>;

const LOGO_LIGHT_URL = new URL('../../../internal/envapp/ui_src/public/logo.svg', import.meta.url).href;
const LOGO_DARK_URL = new URL('../../../internal/envapp/ui_src/public/logo-dark.svg', import.meta.url).href;
type ControlPlaneProviderPresetOption = Readonly<{
  domain: string;
  provider_origin: string;
}>;

type LifecycleProgressFocusRequest = Readonly<{
  request_id: number;
  operation_key: string;
  started_at_unix_ms: number;
  subject_kind: 'environment' | 'gateway';
  subject_id: string;
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

const DESKTOP_FLOE_STORAGE_NAMESPACE = 'redeven-desktop-shell';
const DESKTOP_FLOE_THEME_STORAGE_KEY = 'theme';
const DESKTOP_FLOE_SHELL_THEME_STORAGE_KEY = `${DESKTOP_FLOE_THEME_STORAGE_KEY}-shell-preset`;
const ACTION_TOAST_TTL_MS = 4_000;
const GATEWAY_TERMINAL_PROGRESS_VISIBLE_MS = ACTION_TOAST_TTL_MS;
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
      shellPresetStorageKey: DESKTOP_FLOE_SHELL_THEME_STORAGE_KEY,
      defaultTheme: themeBridge?.getSnapshot().source ?? 'system',
      shellPresets: builtInShellThemePresets,
      defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS,
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

const ENVIRONMENT_CENTER_TABS: readonly Readonly<{
  value: EnvironmentCenterTab;
  labelKey: DesktopTranslationKey;
}>[] = [
  { value: 'environments', labelKey: 'environmentCenter.environmentsSection' },
  { value: 'control_planes', labelKey: 'desktop.provider' },
  { value: 'gateways', labelKey: 'environmentCenter.gatewaysSection' },
];

const ENVIRONMENT_CENTER_HEADER_COPY: Readonly<Record<EnvironmentCenterTab, Readonly<{
  titleKey: DesktopTranslationKey;
  descriptionKey: DesktopTranslationKey;
}>>> = {
  environments: {
    titleKey: 'environmentCenter.environmentsTitle',
    descriptionKey: 'environmentCenter.environmentsDescription',
  },
  control_planes: {
    titleKey: 'environmentCenter.providersTitle',
    descriptionKey: 'environmentCenter.providersDescription',
  },
  gateways: {
    titleKey: 'environmentCenter.gatewaysTitle',
    descriptionKey: 'environmentCenter.gatewaysDescription',
  },
};

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function launcherProgressIdentityKey(progress: DesktopLauncherActionProgress): string {
  const operationKey = trimString(progress.operation_key);
  if (operationKey !== '') {
    return `operation:${operationKey}`;
  }
  const gatewayID = trimString(progress.gateway_id || (progress.subject_kind === 'gateway' ? progress.subject_id : ''));
  if (gatewayID !== '') {
    return `gateway:${gatewayID}:${progress.action}`;
  }
  const environmentID = trimString(progress.environment_id || progress.subject_id);
  if (environmentID !== '') {
    return `environment:${environmentID}:${progress.action}`;
  }
  return `${progress.action}:${gatewayProgressStartedAt(progress)}:${gatewayProgressTimestamp(progress)}`;
}

function activeLauncherProgressIsRetainable(progress: DesktopLauncherActionProgress): boolean {
  return progress.status === 'running'
    || progress.status === 'canceling'
    || progress.status === 'cleanup_running'
    || progress.status === 'failed'
    || progress.status === 'cleanup_failed'
    || progress.status === 'needs_confirmation'
    || progress.status === 'succeeded'
    || progress.status === 'canceled';
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

function errorLikeMessage(error: unknown): string {
  if (error instanceof Error) {
    return trimString(error.message);
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const directMessage = trimString(record.message)
      || trimString(record.detail)
      || trimString(record.details)
      || errorLikeMessage(record.error);
    if (directMessage !== '') {
      return directMessage;
    }
  }
  return trimString(error);
}

function getErrorMessage(error: unknown): string {
  const message = errorLikeMessage(error);
  if (message !== '') {
    return message;
  }
  if (error && typeof error === 'object') {
    try {
      return trimString(JSON.stringify(error));
    } catch {
      return '';
    }
  }
  return '';
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

function reinstallDeletedDataTranslationKey(value: string): DesktopTranslationKey {
  switch (value) {
    case 'runtime_managed_packages':
      return 'confirm.reinstallTargetDeletedDataRuntime';
    case 'workspace_projects_application_data':
      return 'confirm.reinstallTargetDeletedDataWorkspace';
    case 'floret_redevplugin_data':
      return 'confirm.reinstallTargetDeletedDataFloretPlugin';
    case 'trust_identity_catalog_environment_config':
      return 'confirm.reinstallTargetDeletedDataIdentity';
    default:
      return 'confirm.reinstallTargetDescription';
  }
}

function localizedReinstallHost(i18n: DesktopI18n, value: string): string {
  return value === 'local_device' ? i18n.t('confirm.reinstallTargetLocalDevice') : value;
}

function reinstallTargetDescriptionKey(mode: string | undefined): DesktopTranslationKey {
  return mode === 'preserve_data'
    ? 'confirm.reinstallTargetPreserveDescription'
    : 'confirm.reinstallTargetDescription';
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
    'INVALID REDEVEN CLOUD': 'environmentStatus.invalidProvider',
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
    'REINSTALL REQUIRED': 'environmentStatus.reinstallRequired',
    'RUNTIME NEEDS UPDATE': 'environmentStatus.runtimeNeedsUpdate',
    'RUNTIME BLOCKED': 'environmentStatus.runtimeBlocked',
    'RUNTIME PREPARING': 'environmentStatus.runtimePreparing',
    'DESKTOP UPDATE REQUIRED': 'environmentStatus.desktopUpdateRequired',
    'Invalid response': 'environmentStatus.invalidResponse',
    'Status stale': 'environmentStatus.statusStale',
    Authorized: 'environmentStatus.authorized',
    Online: 'providerRuntimeState.online',
    Offline: 'providerRuntimeState.offline',
    'Needs setup': 'environmentStatus.setupRequired',
    Installing: 'progress.installingRuntimePackage',
    Starting: 'progress.startingRuntime',
    Updating: 'progress.updatingEllipsis',
    'Trust changed': 'environmentStatus.trustChanged',
    'Pairing required': 'environmentStatus.pairingRequired',
    'Needs attention': 'progress.needsAttention',
    Unknown: 'common.unknown',
    Disabled: 'environmentCenter.gatewayDisabledStatus',
    'Not started': 'environmentStatus.stopped',
    'Update available': 'environmentCenter.gatewayNeedsUpdate',
    'Reinstall required': 'environmentStatus.reinstallRequired',
    'Service ready': 'progress.gatewayServiceReady',
    Refreshing: 'environmentCenter.gatewayActionSyncing',
  });
}

function localizedGatewaySourceStatusLabel(i18n: DesktopI18n, label: string): string {
  return localizedStringByValue(i18n, label, {
    Installing: 'environmentCenter.gatewayStatusInstalling',
    Starting: 'environmentCenter.gatewayStatusStarting',
    Updating: 'environmentCenter.gatewayStatusUpdating',
    'Update available': 'environmentCenter.gatewayNeedsUpdate',
    'Reinstall required': 'environmentStatus.reinstallRequired',
    'Service ready': 'progress.gatewayServiceReady',
    Disabled: 'environmentCenter.gatewayDisabledStatus',
    Refreshing: 'environmentCenter.gatewayActionSyncing',
    'Not started': 'environmentStatus.stopped',
  }) || localizedEnvironmentStatusLabel(i18n, label);
}

function environmentActionTranslationKey(action: EnvironmentActionModel): DesktopTranslationKey | undefined {
  if (action.label_key) return action.label_key;
  switch (action.intent) {
    case 'open':
    case 'open_with_preflight': return 'environmentAction.open';
    case 'focus': return 'environmentAction.focus';
    case 'opening': return 'environmentAction.remoteWindowOpening';
    case 'initialize_and_open': return 'environmentAction.initializeAndOpen';
    case 'start_and_open': return 'environmentAction.startAndOpen';
    case 'request_open_access': return 'environmentAction.requestAccess';
    case 'resolve_gateway': return 'environmentStatus.resolveGateway';
    case 'connect_provider_runtime': return 'environmentAction.connectToProviderEllipsis';
    case 'disconnect_provider_runtime': return 'environmentAction.disconnectFromProvider';
    case 'start_runtime': return 'environmentAction.startRuntime';
    case 'stop_runtime': return 'environmentAction.stopRuntime';
    case 'restart_runtime': return 'environmentAction.restartRuntime';
    case 'update_runtime': return 'environmentAction.updateRuntime';
    case 'update_desktop': return 'environmentAction.updateRedevenDesktop';
    case 'refresh_runtime': return 'environmentAction.refreshRuntimeStatus';
    case 'reinstall_target': return action.reinstall_mode === 'preserve_data'
      ? 'environmentAction.reinstallRedevenKeepData'
      : 'environmentAction.reinstallRedevenWipeData';
    case 'pair_gateway': return 'environmentAction.pairGateway';
    case 'unavailable': return undefined;
  }
}

function localizedEnvironmentAction(
  i18n: DesktopI18n,
  action: EnvironmentActionModel,
): EnvironmentActionModel {
  const labelKey = environmentActionTranslationKey(action);
  return {
    ...action,
    label: labelKey ? i18n.t(labelKey) : action.label,
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
    label: item.label_key ? i18n.t(item.label_key) : action.label,
    action,
  };
}

function localizedGatewaySourceText(i18n: DesktopI18n, value: string): string {
  return localizedStringByValue(i18n, value, {
    'Managed by Desktop': 'environmentCenter.gatewayAccessOnlyByDesktop',
    'Access-only Gateway': 'environmentCenter.gatewayAccessOnlyByDesktop',
    'Gateway disabled on this Desktop': 'environmentCenter.gatewayGuidanceDisabledTitle',
    'This Desktop is not syncing this Gateway or showing its environments.': 'environmentCenter.gatewayGuidanceDisabledDetail',
    'This Desktop is not refreshing this Gateway or showing its environments. Enable it to refresh again.': 'environmentCenter.gatewayGuidanceDisabledDetail',
    'Finish Gateway setup': 'environmentCenter.gatewayGuidanceFinishSetupTitle',
    'Complete the Gateway connection settings before Desktop can pair, start, or refresh this Gateway.': 'environmentCenter.gatewayGuidanceFinishSetupDetail',
    'Syncing Gateway': 'environmentCenter.gatewayGuidanceSyncingTitle',
    'Refreshing Gateway': 'environmentCenter.gatewayGuidanceSyncingTitle',
    'Desktop is checking reachability, pairing if needed, and refreshing the environment catalog automatically.': 'environmentCenter.gatewayGuidanceSyncingDetail',
    'Gateway trust changed': 'environmentCenter.gatewayGuidanceTrustChangedTitle',
    'Pairing issue': 'environmentCenter.gatewayGuidancePairingFailedTitle',
    'Desktop could not verify this Gateway identity. Review the Gateway target, then sync this Gateway again.': 'environmentCenter.gatewayGuidancePairingFailedDetail',
    'Desktop could not verify this Gateway identity. Review the Gateway target, then refresh this Gateway again.': 'environmentCenter.gatewayGuidancePairingFailedDetail',
    'Gateway sync failed': 'environmentCenter.gatewayGuidanceSyncFailedTitle',
    'Gateway refresh failed': 'environmentCenter.gatewayGuidanceSyncFailedTitle',
    'Gateway issue': 'environmentCenter.gatewayIssueTitle',
    'Desktop could not keep this Gateway synced. Open the guidance panel to start, sync, or resolve the target.': 'environmentCenter.gatewayGuidanceSyncFailedDetail',
    'Desktop could not refresh this Gateway. Use Refresh to diagnose the target and show the next available service action.': 'environmentCenter.gatewayGuidanceSyncFailedDetail',
    'Preparing access-only Gateway': 'environmentCenter.gatewayGuidancePreparingAccessTitle',
    'Desktop is pairing with this Gateway automatically. This access-only Gateway is managed on its own host.': 'environmentCenter.gatewayGuidancePreparingAccessDetail',
    'Desktop can refresh the catalog and route Gateway Environments through this source, but it cannot start or stop this external Gateway service.': 'environmentCenter.gatewayGuidanceAccessOnlyDetail',
    'Resolve the Gateway target': 'environmentCenter.gatewayGuidanceResolveTargetTitle',
    'Desktop cannot reach the SSH host, container, or bridge that runs this Gateway. Check the target settings before pairing or opening environments.': 'environmentCenter.gatewayGuidanceResolveTargetDetail',
    'Gateway is starting': 'environmentCenter.gatewayGuidanceStartingTitle',
    'Desktop is preparing the Gateway service. Pairing and catalog refresh will be available when it reports ready.': 'environmentCenter.gatewayGuidanceStartingDetail',
    'Update before continuing': 'environmentCenter.gatewayGuidanceUpdateTitle',
    'Install the Gateway service update, then Desktop can pair and refresh the environments this Gateway exposes.': 'environmentCenter.gatewayGuidanceUpdateDetail',
    'Gateway reinstall required': 'environmentStatus.reinstallRequired',
    'Gateway pairing required': 'environmentStatus.pairingRequired',
    'This Standalone Gateway has incompatible state. Repair or reinstall it on its own host, then refresh it here.': 'environmentCenter.gatewayGuidanceReviewSettingsDetail',
    'Reinstall completed. The new Environment is ready.': 'confirm.reinstallCompleted',
    'Preparing Gateway': 'environmentCenter.gatewayGuidancePreparingTitle',
    'Gateway is stopped': 'environmentCenter.gatewayGuidanceStoppedTitle',
    'Desktop will start this managed Gateway automatically and then discover its environments.': 'environmentCenter.gatewayGuidancePreparingDetail',
    'Desktop can start this Gateway automatically when syncing or opening environments. You can also start it manually from the actions menu.': 'environmentCenter.gatewayGuidanceStoppedDetail',
    'Preparing Gateway trust': 'environmentCenter.gatewayGuidancePreparingTrustTitle',
    'Desktop is pairing this Gateway automatically so it can show the environments the Gateway manages.': 'environmentCenter.gatewayGuidancePreparingTrustDetail',
    'Gateway is ready': 'environmentCenter.gatewayGuidanceReadyTitle',
    'Desktop keeps this Gateway catalog synced. Open its environments from the Environments tab.': 'environmentCenter.gatewayGuidanceReadyDetail',
    'The Gateway service is ready. Use Refresh to pair if needed and refresh the environment catalog.': 'environmentCenter.gatewayGuidanceReadyDetail',
    'Review the Gateway settings, then refresh again when the target is reachable.': 'environmentCenter.gatewayGuidanceReviewSettingsDetail',
    'Gateway catalog available': 'environmentCenter.gatewayGuidanceCatalogAvailableTitle',
    'Refresh this Gateway to pick up catalog changes; its environments are listed separately in the Environments tab.': 'environmentCenter.gatewayGuidanceCatalogAvailableDetail',
    'No environments synced': 'environmentCenter.gatewaySummaryNone',
    '1 environment synced': 'environmentCenter.gatewaySummaryOne',
    'Sync paused on this Desktop. Gateway environments are hidden until you enable it again.': 'environmentCenter.gatewaySummaryDetailDisabled',
    'View and open these environments from the Environments tab filtered to this Gateway.': 'environmentCenter.gatewaySummaryDetailAvailable',
    'Desktop will add environments to the Environments tab when this Gateway catalog sync finishes.': 'environmentCenter.gatewaySummaryDetailSyncing',
    'Resolve this Gateway before its managed environments can appear in the Environments tab.': 'environmentCenter.gatewaySummaryDetailResolve',
    'Add a Gateway-backed Environment to make it available from every Desktop paired with this Gateway.': 'environmentCenter.gatewaySummaryDetailWritableEmpty',
    'No environments are currently exposed by this Gateway catalog.': 'environmentCenter.gatewaySummaryDetailNone',
  });
}

function localizedGatewaySourceCountText(i18n: DesktopI18n, value: string): string {
  const match = value.match(/^(\d+) environments synced$/u);
  if (!match) {
    return localizedGatewaySourceText(i18n, value);
  }
  return i18n.t('environmentCenter.gatewaySummaryMany', {
    count: match[1] ?? '0',
  });
}

function localizedGatewaySourceActionLabel(i18n: DesktopI18n, action: GatewaySourceActionModel): string {
  switch (action.intent) {
    case 'add_gateway_environment':
      return i18n.t('environmentCenter.gatewayAddEnvironmentShort');
    case 'open_gateway_environment':
      return i18n.t('environmentAction.open');
    case 'view_gateway_environments':
      return i18n.t('environmentCenter.viewEnvironments');
    case 'enable_gateway':
      return i18n.t('environmentCenter.gatewayActionEnable');
    case 'disable_gateway':
      return i18n.t('environmentCenter.gatewayActionDisable');
    case 'refresh_gateway':
      return i18n.t('common.refresh');
    case 'pair_gateway':
      return i18n.t('environmentCenter.gatewayPanelPairThisGatewayAria');
    case 'setup_gateway':
      return i18n.t('environmentStatus.setupRequired');
    case 'cancel_gateway_action':
      return i18n.t('common.cancel');
    default:
      return action.label;
  }
}

function localizedGatewayActionPanelText(i18n: DesktopI18n, value: string): string {
  const clean = trimString(value);
  const failedAction = clean.match(/^(.+) failed$/u);
  if (failedAction) {
    return i18n.t('environmentCenter.gatewayPanelActionFailedTitle', {
      action: failedAction[1] ?? '',
    });
  }
  const workingOn = clean.match(/^Desktop is working on (.+)\.$/u);
  if (workingOn) {
    return i18n.t('environmentCenter.gatewayPanelWorkingOnLabel', {
      label: workingOn[1] ?? '',
    });
  }
  const runAction = clean.match(/^Desktop will run (.+) for (.+)\.$/u);
  if (runAction) {
    return i18n.t('environmentCenter.gatewayPanelRunActionForLabel', {
      action: runAction[1] ?? '',
      label: runAction[2] ?? '',
    });
  }
  return localizedStringByValue(i18n, clean, {
    Running: 'progress.running',
    Gateway: 'environmentCenter.gatewaysSection',
    'Gateway status': 'environmentCenter.gatewayPanelStatusSection',
    'Gateway service': 'environmentCenter.gatewayPanelFactGatewayService',
    'Gateway trust': 'environmentCenter.gatewayPanelTrustSection',
    Manage: 'environmentCenter.gatewayActionManage',
    'Needs attention': 'progress.needsAttention',
    'Gateway issue': 'environmentCenter.gatewayIssueTitle',
    'Gateway check complete': 'progress.gatewayCheckComplete',
    'Access-only Gateway': 'environmentCenter.gatewayAccessOnlyByDesktop',
    'Gateway operation progress': 'environmentCenter.gatewayProgress',
    'Gateway action issue': 'environmentCenter.gatewayPanelActionIssue',
    'Gateway action': 'environmentCenter.gatewayPanelGenericAction',
    'Desktop could not complete this Gateway action.': 'environmentCenter.gatewayPanelActionFailedDetail',
    'Manage Gateway': 'environmentCenter.gatewayPanelManageTitle',
    'Review this Gateway configuration.': 'environmentCenter.gatewayPanelManageDetail',
    'Gateway pairing issue': 'environmentCenter.gatewayGuidancePairingFailedTitle',
    'Gateway catalog sync failed': 'environmentCenter.gatewayPanelCatalogSyncFailedTitle',
    'Gateway is unreachable': 'environmentCenter.gatewayPanelUnreachableTitle',
    'Gateway sync failed': 'environmentCenter.gatewayGuidanceSyncFailedTitle',
    'Run a check to identify whether this Gateway needs to start, update, or change configuration.': 'environmentCenter.gatewayPanelCheckFirstDetail',
    'Gateway is stopped': 'environmentCenter.gatewayGuidanceStoppedTitle',
    'Gateway update required': 'environmentCenter.gatewayPanelUpdateRequiredTitle',
    'Gateway reinstall required': 'environmentStatus.reinstallRequired',
    'Gateway pairing required': 'environmentStatus.pairingRequired',
    'This Standalone Gateway has incompatible state. Repair or reinstall it on its own host, then refresh it here.': 'environmentCenter.gatewayGuidanceReviewSettingsDetail',
    'Reinstall completed. The new Environment is ready.': 'confirm.reinstallCompleted',
    'Reinstall Redeven': 'environmentAction.reinstallRedeven',
    'Gateway protocol check failed': 'environmentCenter.gatewayPanelProtocolCheckFailedTitle',
    'Gateway target needs review': 'environmentCenter.gatewayPanelTargetReviewTitle',
    'Gateway trust check failed': 'environmentCenter.gatewayPanelTrustCheckFailedTitle',
    'Gateway catalog check failed': 'environmentCenter.gatewayPanelCatalogCheckFailedTitle',
    'External Gateway endpoint': 'environmentCenter.gatewayPanelExternalEndpointTitle',
    'Gateway sync is paused': 'environmentCenter.gatewayPanelSyncPausedTitle',
    'Gateway diagnostics': 'environmentCenter.gatewayPanelDiagnosticsTitle',
    'Desktop cannot manage this Gateway. Review the diagnostics and fix it on the Gateway host.': 'environmentCenter.gatewayPanelDiagnosticsOnlyDetail',
    'Desktop can reach the Gateway service, but catalog sync still failed.': 'environmentCenter.gatewayPanelCatalogStillFailedDetail',
    'Desktop can reach this Gateway. Run Refresh to refresh environments.': 'environmentCenter.gatewayPanelReadyThenSyncDetail',
    'Resolve Gateway': 'environmentCenter.gatewayPanelResolveTitle',
    'Review the Gateway target, then refresh again when the Gateway is reachable.': 'environmentCenter.gatewayPanelResolveDetail',
    'Desktop will check Gateway service reachability, pair when needed, and refresh the environment catalog.': 'environmentCenter.gatewayPanelSyncManagedDetail',
    'Desktop will check this external Gateway endpoint and refresh its environment catalog. Start the Gateway on its host if it is offline.': 'environmentCenter.gatewayPanelSyncAccessOnlyDetail',
    'Review Gateway identity': 'environmentCenter.gatewayPanelReviewIdentityTitle',
    'Desktop pairs URL Gateways automatically during Refresh. Gateway service is managed on the Gateway host.': 'environmentCenter.gatewayPanelAccessOnlyPairDetail',
    'Start Gateway to sync': 'environmentCenter.gatewayPanelStartToSyncTitle',
    'Desktop can start this Gateway service, then continue automatic pairing and catalog sync.': 'environmentCenter.gatewayPanelStartToSyncDetail',
    'Desktop can start this Gateway service. Use Refresh again after it is ready to refresh environments.': 'environmentCenter.gatewayPanelStartToSyncDetail',
    'Start Gateway before refreshing catalog': 'environmentCenter.gatewayPanelStartBeforeSyncAria',
    'Start Gateway service': 'environmentCenter.gatewayPanelStartServiceAria',
    'Update Gateway before pairing': 'environmentCenter.gatewayPanelUpdateBeforePairTitle',
    'Desktop needs to update this Gateway service before it can safely pair and trust the catalog.': 'environmentCenter.gatewayPanelUpdateBeforePairDetail',
    'Resolve Gateway before Refresh': 'environmentCenter.gatewayPanelResolveBeforeSyncTitle',
    'Desktop needs a reachable Gateway service before it can sync environments.': 'environmentCenter.gatewayPanelResolveBeforeSyncDetail',
    'Desktop needs a reachable Gateway service before it can refresh environments.': 'environmentCenter.gatewayPanelResolveBeforeSyncDetail',
    'Resolve Gateway before pairing': 'environmentCenter.gatewayPanelResolveBeforePairTitle',
    'Desktop needs a reachable Gateway service before it can pair.': 'environmentCenter.gatewayPanelResolveBeforePairDetail',
    'Desktop needs this Gateway service ready before refreshing the catalog.': 'environmentCenter.gatewayPanelServiceReadyBeforeCatalogDetail',
    'Resolve Gateway before refreshing catalog': 'environmentCenter.gatewayPanelResolveBeforeCatalogAria',
    'Gateway pairing challenge signature is invalid.': 'environmentCenter.gatewayPanelErrorPairSignatureInvalid',
    'SSH host is unreachable.': 'environmentCenter.gatewayPanelErrorSshHostUnreachable',
    'Gateway SSH host is unreachable.': 'environmentCenter.gatewayPanelErrorSshHostUnreachable',
    'Gateway bridge is unavailable.': 'environmentCenter.gatewayPanelErrorBridgeUnavailable',
    'Gateway bridge session is unavailable.': 'environmentCenter.gatewayPanelErrorBridgeUnavailable',
    'Gateway service is not running.': 'environmentCenter.gatewayPanelErrorServiceNotRunning',
    'Gateway request was rejected.': 'environmentCenter.gatewayPanelErrorRequestRejected',
  });
}

function localizedGatewayActionPanelDetail(
  i18n: DesktopI18n,
  model: GatewayActionPanelModel,
): string {
  switch (model.kind) {
    default:
      return localizedGatewayActionPanelText(i18n, model.detail);
  }
}

function localizedGatewayPanelFactLabel(i18n: DesktopI18n, label: string): string {
  return localizedStringByValue(i18n, label, {
    'Gateway service': 'environmentCenter.gatewayPanelFactGatewayService',
    'Gateway version': 'environmentCenter.gatewayPanelFactGatewayVersion',
    'Gateway trust': 'environmentCenter.gatewayPanelFactGatewayTrust',
    'Gateway catalog': 'environmentCenter.gatewayPanelFactGatewayCatalog',
    'Catalog sync': 'environmentCenter.gatewayPanelFactCatalogSync',
    'Catalog refresh': 'environmentCenter.gatewayPanelFactCatalogSync',
    Trust: 'environmentCenter.gatewayPanelFactTrust',
    Transport: 'environmentCenter.gatewayPanelFactTransport',
    Diagnosis: 'environmentCenter.gatewayPanelFactDiagnosis',
    Detail: 'environmentCenter.gatewayPanelFactDetail',
    'Error code': 'environmentCenter.gatewayPanelFactErrorCode',
    'Error message': 'environmentCenter.gatewayPanelFactErrorMessage',
    'Legacy Gateway service residue': 'environmentCenter.gatewayPanelFactLegacyRuntimeResidue',
    'Legacy Gateway process IDs': 'environmentCenter.gatewayPanelFactLegacyRuntimePids',
    'Legacy Gateway catalog': 'environmentCenter.gatewayPanelFactLegacyLocalCatalog',
    Endpoint: 'environmentFacts.endpoint',
    Host: 'environmentCenter.gatewayPanelFactHost',
    Container: 'environmentFacts.container',
  });
}

function localizedGatewayPanelFactValue(i18n: DesktopI18n, value: string): string {
  return localizedStringByValue(i18n, value, {
    'Access-only': 'environmentCenter.gatewayAccessOnlyByDesktop',
    'Not started': 'environmentStatus.stopped',
    Starting: 'environmentCenter.gatewayStatusStarting',
    Ready: 'status.ready',
    Syncing: 'environmentCenter.gatewayActionSyncing',
    Refreshing: 'environmentCenter.gatewayActionSyncing',
    Failed: 'progress.failed',
    Idle: 'status.idle',
    Verified: 'environmentCenter.gatewayPanelFactVerified',
    Reachable: 'environmentCenter.gatewayPanelFactReachable',
    Supported: 'environmentCenter.gatewayPanelFactSupported',
    'Not ready': 'environmentCenter.gatewayPanelFactNotReady',
    Skipped: 'environmentCenter.gatewayPanelProbeSkipped',
    'SSH unreachable': 'environmentCenter.gatewayPanelServiceSshUnreachable',
    'Container unavailable': 'environmentCenter.gatewayPanelServiceContainerUnavailable',
    'Update required': 'environmentCenter.gatewayNeedsUpdate',
    'Bridge unavailable': 'environmentCenter.gatewayPanelServiceBridgeUnavailable',
    'Needs attention': 'progress.needsAttention',
    Unknown: 'common.unknown',
    Paired: 'environmentCenter.gatewayPanelTrustPaired',
    'Review required': 'environmentCenter.gatewayPanelTrustReviewRequired',
    Revoked: 'environmentCenter.gatewayPanelTrustRevoked',
    'Not paired': 'environmentCenter.gatewayPanelTrustNotPaired',
    'URL transport': 'connectionDialog.gatewayTransportUrl',
    'SSH host': 'connectionDialog.gatewayTransportSshHost',
    'SSH container': 'connectionDialog.gatewayTransportSshContainer',
    'Gateway is stopped': 'environmentCenter.gatewayGuidanceStoppedTitle',
    'Gateway update required': 'environmentCenter.gatewayPanelUpdateRequiredTitle',
    'SSH host unreachable': 'environmentCenter.gatewayPanelServiceSshUnreachable',
    'Gateway SSH host unreachable': 'environmentCenter.gatewayPanelServiceSshUnreachable',
    'Gateway container unavailable': 'environmentCenter.gatewayPanelServiceContainerUnavailable',
    'Gateway bridge unavailable': 'environmentCenter.gatewayPanelServiceBridgeUnavailable',
    'Gateway status is unknown': 'common.unknown',
    'External Gateway endpoint': 'environmentCenter.gatewayPanelExternalEndpointTitle',
    'Gateway service is ready': 'progress.gatewayServiceReady',
    'Gateway trust check failed': 'environmentCenter.gatewayPanelTrustCheckFailedTitle',
    'Gateway is not paired': 'environmentCenter.gatewayPanelTrustCheckFailedTitle',
    'Gateway is not manageable from Desktop': 'environmentCenter.gatewayPanelExternalEndpointTitle',
    'Gateway protocol unsupported': 'environmentCenter.gatewayPanelProtocolCheckFailedTitle',
    'Gateway catalog check failed': 'environmentCenter.gatewayPanelCatalogCheckFailedTitle',
    'Gateway check failed': 'progress.gatewayCheckFailed',
    'Gateway is ready': 'environmentCenter.gatewayGuidanceReadyTitle',
    'Gateway sync is paused': 'environmentCenter.gatewayPanelSyncPausedTitle',
    'Desktop can start this Gateway service. Use Refresh again after it is ready to refresh environments.': 'environmentCenter.gatewayPanelStartToSyncDetail',
    'Desktop must update this Gateway service before pairing or refreshing catalog data.': 'environmentCenter.gatewayPanelUpdateBeforePairDetail',
    'Desktop cannot reach the SSH host that runs this Gateway.': 'toast.gatewayServiceUnreachable',
    'Desktop cannot reach the container that runs this Gateway.': 'toast.gatewayContainerUnavailable',
    'Desktop cannot open the Gateway bridge on the configured target.': 'toast.gatewayBridgeUnavailable',
    'Desktop can diagnose this Gateway endpoint, but service start and update must happen on its host.': 'toast.gatewayNotManageable',
    'Desktop can reach the Gateway service. Continue checking trust and catalog access.': 'progress.gatewayCheckServiceReadyDetail',
    'Desktop could not determine this Gateway service state.': 'common.unknown',
    'Desktop could not verify this Gateway identity.': 'environmentCenter.gatewayPanelTrustCheckFailedTitle',
    'Start or update this Gateway on its host, then check again.': 'toast.gatewayNotManageable',
    'Desktop could not diagnose this Gateway.': 'progress.gatewayCheckFailed',
    'Desktop needs to review this Gateway identity before it can trust and read its catalog.': 'environmentCenter.gatewayPanelTrustCheckFailedTitle',
    'Desktop can reach this Gateway, verify trust, and read the catalog.': 'progress.gatewayCheckReadyDetail',
    'This Desktop is not syncing this Gateway while it is disabled locally.': 'environmentCenter.gatewayGuidanceDisabledDetail',
    passed: 'environmentCenter.gatewayPanelProbePassed',
    warning: 'environmentCenter.gatewayPanelProbeWarning',
    failed: 'environmentCenter.gatewayPanelProbeFailed',
    skipped: 'environmentCenter.gatewayPanelProbeSkipped',
    unknown: 'common.unknown',
  });
}

function localizedGuidanceAction(
  i18n: DesktopI18n,
  item: EnvironmentGuidanceActionModel,
): EnvironmentGuidanceActionModel {
  const action = localizedEnvironmentAction(i18n, item.action);
  return {
    ...item,
    label: action.label,
    action,
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
    'Start this runtime before connecting it to Redeven Cloud.': 'runtimeMessage.startRuntimeBeforeProvider',
    'Start this runtime before opening it.': 'runtimeMessage.startRuntimeBeforeOpening',
    'Restart this runtime from Desktop so runtime-control can be prepared.': 'runtimeMessage.restartRuntimeForRuntimeControl',
    'Restart this runtime with the current Desktop Runtime before connecting it to Redeven Cloud.': 'runtimeMessage.restartRuntimeForRuntimeControl',
    'Runtime-control is not available for this runtime.': 'runtimeMessage.runtimeControlUnavailable',
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
    'Refresh Redeven Cloud status before opening this environment.': 'runtimeMessage.refreshProviderStatusBeforeOpening',
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
    'The Redeven Cloud link is already changing state for this Runtime.': 'runtimeMessage.providerLinkNeedsAttentionDetail',
    'Provider link is unavailable for this runtime.': 'runtimeMessage.providerLinkUnavailableDetail',
    'Choose an available Provider Environment before connecting this runtime.': 'runtimeMessage.providerLinkConnectUnavailableDetail',
    'The legacy control-plane link cannot be disconnected in its current state.': 'runtimeMessage.legacyControlPlaneDisconnectUnavailableDetail',
    'Runtime is offline or unavailable right now. Start it from its source, then refresh status.': 'runtimeMessage.runtimeOfflineRefresh',
    'Desktop needs fresh provider authorization before it can open or connect this provider Environment.': 'runtimeMessage.providerAuthRequired',
    'Desktop needs fresh Redeven Cloud authorization before it can open or connect this Redeven Cloud Environment.': 'runtimeMessage.providerAuthRequired',
    'Remote open is not ready yet. Open stays separate from runtime start and provider link actions.': 'runtimeMessage.remoteOpenNotReady',
    'Desktop has not checked this runtime yet. Refresh status now, or start the runtime when you already know it is offline.': 'runtimeMessage.statusNotCheckedDetail',
    'Connect this runtime to a provider Environment first. Open stays separate and becomes available after the link is ready.': 'runtimeMessage.connectProviderFirst',
    'Connect this runtime to a Redeven Cloud Environment first. Open stays separate and becomes available after the link is ready.': 'runtimeMessage.connectProviderFirst',
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
    'Redeven will check access, prepare this environment, start it, and open the workspace.': 'environmentOpenFlow.initializeDetail',
    'Redeven will start this environment and open the workspace when it is ready.': 'environmentOpenFlow.startDetail',
    'Redeven needs permission to reach this environment before it can open the workspace.': 'environmentOpenFlow.accessRequiredDetail',
    'Redeven is checking access before changing this environment.': 'environmentOpenFlow.checkingAccessDetail',
    'Redeven is preparing the environment so it can start safely.': 'environmentOpenFlow.preparingEnvironmentDetail',
    'Redeven is starting the environment.': 'environmentOpenFlow.startingEnvironmentDetail',
    'Redeven is opening the workspace now.': 'environmentOpenFlow.openingWorkspaceDetail',
    'Redeven is requesting access before opening the workspace.': 'environmentOpenFlow.requestingAccessDetail',
    'Redeven could not prepare this environment. Try again.': 'environmentOpenFlow.initializationFailedDetail',
    'Redeven could not start this environment. Try again.': 'environmentOpenFlow.startFailedDetail',
    'Redeven could not check this environment. Try again.': 'environmentOpenFlow.preflightFailedDetail',
    'The environment started, but Redeven could not open the workspace. Try again.': 'environmentOpenFlow.openFailedDetail',
    'Redeven could not request access to this environment. Try again.': 'environmentOpenFlow.accessRequestFailedDetail',
    'Access is not available for this environment yet. Check the connection and try again.': 'environmentOpenFlow.accessUnavailableDetail',
    'Refreshing the latest environment status from this provider.': 'runtimeMessage.providerRefreshingDetail',
    'Refreshing the latest environment status from Redeven Cloud.': 'runtimeMessage.providerRefreshingDetail',
    'Desktop authorization expired. Reconnect in your browser to refresh environments again.': 'runtimeMessage.providerAuthorizationExpiredDetail',
    'Desktop could not reach this provider.': 'runtimeMessage.providerReachFailedDetail',
    'Desktop could not reach Redeven Cloud.': 'runtimeMessage.providerReachFailedDetail',
    'This provider returned an invalid response.': 'runtimeMessage.providerInvalidResponseDetail',
    'Redeven Cloud returned an invalid response.': 'runtimeMessage.providerInvalidResponseDetail',
    'Desktop could not refresh this provider.': 'runtimeMessage.providerRefreshFailedDetail',
    'Desktop could not refresh Redeven Cloud.': 'runtimeMessage.providerRefreshFailedDetail',
    'Redeven Cloud currently reports this Environment as offline.': 'toast.environmentOffline',
    'Remote status is stale. Refresh Redeven Cloud to confirm the current state.': 'toast.environmentStatusStale',
    'This Environment is no longer published by Redeven Cloud.': 'runtimeMessage.environmentRemoved',
    'Reconnect Redeven Cloud in Desktop to restore access.': 'runtimeMessage.providerAuthRequired',
    'Reconnect Redeven Cloud in Desktop to restore remote access.': 'runtimeMessage.providerAuthRequired',
    'Desktop could not refresh Redeven Cloud from this device.': 'runtimeMessage.providerReachFailedDetail',
    'Redeven Cloud returned an invalid response while Desktop refreshed status.': 'runtimeMessage.providerInvalidResponseDetail',
    'The last provider sync is getting old. Refresh to confirm the latest environment status.': 'runtimeMessage.providerStatusStaleDetail',
    'The last Redeven Cloud sync is getting old. Refresh to confirm the latest environment status.': 'runtimeMessage.providerStatusStaleDetail',
    'Desktop has active provider authorization and a fresh environment catalog.': 'runtimeMessage.providerAuthorizedDetail',
    'Desktop has active Redeven Cloud authorization and a fresh environment catalog.': 'runtimeMessage.providerAuthorizedDetail',
  });
}

function localizedRuntimeMaintenanceSubject(i18n: DesktopI18n, subject: string): string {
  return localizedStringByValue(i18n, subject, {
    'SSH container runtime': 'runtimeMessage.sshContainerRuntime',
    'local container runtime': 'runtimeMessage.localContainerRuntime',
    'SSH runtime': 'runtimeMessage.sshRuntime',
    'local runtime': 'runtimeMessage.localRuntime',
    runtime: 'runtimeMessage.runtime',
  });
}

function localizedRuntimeMaintenanceMessage(i18n: DesktopI18n, message: string): string {
  const parsed = parseRuntimeMaintenanceMessage(message);
  if (!parsed) {
    return '';
  }
  switch (parsed.kind) {
    case 'model_source_update':
      return i18n.t('runtimeMessage.modelSourceNeedsUpdateDetail', {
        subject: localizedRuntimeMaintenanceSubject(i18n, parsed.subject),
      });
    case 'not_running':
      return i18n.t('runtimeMessage.runtimeNotRunningDetail', {
        subject: localizedRuntimeMaintenanceSubject(i18n, parsed.subject),
      });
    case 'restart_required':
      return i18n.t('runtimeMessage.runtimeRestartRequiredDetail', {
        subject: localizedRuntimeMaintenanceSubject(i18n, parsed.subject),
      });
    case 'update_required': {
      const action = localizedStringByValue(i18n, parsed.action, {
        'Update and restart the runtime first': 'runtimeMessage.updateAndRestartRuntimeFirst',
        'Update the runtime first': 'runtimeMessage.updateRuntimeFirst',
      });
      return i18n.t('runtimeMessage.runtimeUpdateRequiredDetail', {
        subject: localizedRuntimeMaintenanceSubject(i18n, parsed.subject),
        action,
      });
    }
  }
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
    'Connect to Redeven Cloud to continue': 'runtimeMessage.connectProviderTitle',
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
    'Initialize and open': 'environmentOpenFlow.initializeTitle',
    'Start and open': 'environmentOpenFlow.startTitle',
    'Request access': 'environmentOpenFlow.accessRequiredTitle',
    'Open failed': 'progress.openFailed',
    'Checking access': 'environmentOpenFlow.checkingAccessTitle',
    'Preparing environment': 'environmentOpenFlow.preparingEnvironmentTitle',
    'Starting environment': 'environmentOpenFlow.startingEnvironmentTitle',
    'Opening workspace': 'environmentOpenFlow.openingWorkspaceTitle',
    'Requesting access': 'environmentOpenFlow.requestingAccessTitle',
    'Initialization failed': 'environmentOpenFlow.initializationFailedTitle',
    'Start failed': 'environmentOpenFlow.startFailedTitle',
    'Access request failed': 'environmentOpenFlow.accessRequestFailedTitle',
    'Runtime restart required': 'runtimeMessage.runtimeRestartRequired',
    'Runtime update required': 'runtimeMessage.runtimeUpdateRequired',
    'Redeven Desktop update required': 'runtimeMessage.desktopUpdateRequired',
    'Runtime cannot open yet': 'runtimeMessage.runtimeCannotOpenYet',
    'Provider reports offline': 'runtimeMessage.providerReportsOffline',
    'Redeven Cloud reports offline': 'runtimeMessage.providerReportsOffline',
    'Provider is unreachable': 'runtimeMessage.providerUnreachable',
    'Redeven Cloud is unreachable': 'runtimeMessage.providerUnreachable',
    'Provider response is invalid': 'runtimeMessage.providerResponseInvalid',
    'Redeven Cloud response is invalid': 'runtimeMessage.providerResponseInvalid',
    'Environment removed': 'runtimeMessage.environmentRemoved',
    'Provider status is stale': 'runtimeMessage.providerStatusStale',
    'Redeven Cloud status is stale': 'runtimeMessage.providerStatusStale',
    'Refresh provider status': 'environmentAction.refreshProviderStatus',
    'Refresh Redeven Cloud status': 'environmentAction.refreshProviderStatus',
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
    'Environment setup': 'environmentOpenFlow.initializeEyebrow',
    'Environment ready to start': 'environmentOpenFlow.startEyebrow',
    'Access required': 'environmentOpenFlow.accessRequiredEyebrow',
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
    menu_button_label: i18n.t('environmentAction.runtimeActions'),
    menu_actions: presentation.menu_actions.map((item) => localizedEnvironmentMenuItem(i18n, item)),
  };
}

function localizedFactLabel(i18n: DesktopI18n, label: string): string {
  return localizedStringByValue(i18n, label, {
    'RUNS ON': 'environmentFacts.runsOn',
    CONTAINER: 'environmentFacts.container',
    VERSION: 'environmentFacts.version',
    'REDEVEN CLOUD': 'environmentFacts.provider',
    'CONTROL PLANE': 'environmentFacts.controlPlane',
    'LOCAL LINK': 'environmentFacts.localLink',
    'ENV ID': 'environmentFacts.environmentId',
    'Redeven Cloud': 'environmentFacts.provider',
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

function localizedFactValue(i18n: DesktopI18n, label: string, value: string): string {
  const connecting = value.match(/^Connecting through (.+)$/u);
  if (label === 'LOCAL LINK' && connecting) {
    return i18n.t('environmentFacts.connectingThrough', {
      label: connecting[1] ?? '',
    });
  }
  const disconnecting = value.match(/^Disconnecting from (.+)$/u);
  if (label === 'LOCAL LINK' && disconnecting) {
    return i18n.t('environmentFacts.disconnectingFrom', {
      label: disconnecting[1] ?? '',
    });
  }
  const needsAttention = value.match(/^(.+) needs attention$/u);
  if (label === 'LOCAL LINK' && needsAttention) {
    return i18n.t('environmentFacts.runtimeNeedsAttention', {
      label: needsAttention[1] ?? '',
    });
  }
  if (label === 'VERSION') {
    return localizedStringByValue(i18n, value, {
      UNKNOWN: 'environmentFacts.unknown',
      Unknown: 'environmentFacts.unknown',
    });
  }
  if (label === 'REDEVEN CLOUD' || label === 'CONTROL PLANE') {
    return localizedStringByValue(i18n, value, {
      None: 'environmentFacts.none',
      'Unsupported legacy control-plane link': 'environmentFacts.unsupportedLegacyControlPlaneLink',
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
      'Redeven Cloud remote': 'environmentFacts.providerRemote',
      'LAN host': 'environmentFacts.lanHost',
      'Remote host': 'environmentFacts.remoteHost',
      'Unknown host': 'environmentFacts.unknownHost',
    });
  }
  if (label === 'Bootstrap') {
    return localizedStringByValue(i18n, value, {
      'Desktop upload': 'environmentFacts.desktopUpload',
      'Remote download & install': 'environmentFacts.remoteDownloadInstall',
      Automatic: 'environmentFacts.automatic',
    });
  }
  if (label === 'Source') {
    return localizedStringByValue(i18n, value, {
      'Local environment': 'environmentFacts.localEnvironment',
      'Provider environment': 'environmentFacts.providerEnvironment',
      'Redeven Cloud environment': 'environmentFacts.providerEnvironment',
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
  const gatewayManaged = value.match(/^Gateway managed:(.+)$/u);
  if (gatewayManaged) {
    return i18n.t('environmentCenter.gatewayManagedThrough', {
      gateway: gatewayManaged[1]?.trim() || 'Gateway',
    });
  }
  const gatewayAvailable = value.match(/^Gateway available:(.+)$/u);
  if (gatewayAvailable) {
    return i18n.t('environmentCenter.gatewayAvailableThrough', {
      gateway: gatewayAvailable[1]?.trim() || 'Gateway',
    });
  }
  if (value === 'Gateway access-only') {
    return i18n.t('environmentCenter.gatewayAccessOnlyEnv');
  }
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
    return i18n.formatRelativeTime(Date.now(), {
      numeric: 'auto',
      style: 'short',
    });
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
    return i18n.t('environmentFacts.showLinkedRuntime', {
      label: showLinked[1] ?? '',
    });
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

function gatewayActionKindForRequest(
  request: DesktopLauncherActionRequest | undefined,
): Extract<DesktopLauncherActionKind, 'refresh_gateway'> {
  switch (request?.kind) {
    case 'refresh_gateway':
    case 'check_gateway':
    case 'sync_gateway':
    case 'pair_gateway':
    case 'refresh_gateway_status':
    case 'refresh_gateway_catalog':
      return 'refresh_gateway';
    default:
      return 'refresh_gateway';
  }
}

function retainedGatewayFailureProgress(
  i18n: DesktopI18n,
  failure: Extract<DesktopLauncherActionResult, Readonly<{ ok: false }>>,
  request: DesktopLauncherActionRequest | undefined,
  presentation: ReturnType<typeof launcherActionFailurePresentation>,
): DesktopLauncherActionProgress {
  const gatewayID = trimString(failure.gateway_id);
  const now = Date.now();
  const operationKey = `ui:gateway:${gatewayID}:${now}`;
  const action = gatewayActionKindForRequest(request);
  const severity = presentation.tone === 'warning' ? 'warning' : 'error';
  const nextActions: DesktopLauncherActionProgress['next_actions'] = [
    {
      kind: 'copy_diagnostics',
      operation_key: operationKey,
      label: i18n.t('progress.copyLog'),
    },
    {
      kind: 'dismiss',
      operation_key: operationKey,
      label: i18n.t('progress.dismiss'),
    },
  ];
  return {
    action,
    gateway_id: gatewayID,
    operation_key: operationKey,
    subject_kind: 'gateway',
    subject_id: gatewayID,
    started_at_unix_ms: now,
    updated_at_unix_ms: now,
    status: 'failed',
    phase: 'failed',
    title: presentation.title || i18n.t('progress.gatewayNeedsAttention'),
    detail: presentation.message || i18n.t('toast.gatewayActionFailed'),
    cancelable: false,
    failure: failure.failure ?? inlineFailurePresentation(i18n, presentation.message, severity),
    next_actions: nextActions,
  };
}

type SilentLauncherActionFailure = Readonly<{
  ok: false;
  code?: DesktopLauncherActionFailureCode;
  message: string;
  operation_key?: string;
  failure?: DesktopOperationFailurePresentation;
  raw_failure?: Extract<DesktopLauncherActionResult, Readonly<{ ok: false }>>;
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
  void controlPlane;
  return 'Redeven Cloud';
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

function createGatewayURLProfileConnectionDialogState(
  mode: 'create' | 'edit',
  overrides: Partial<GatewayURLProfileConnectionDialogState> = {},
): GatewayURLProfileConnectionDialogState {
  const sshDestination = trimString(overrides.ssh_destination);
  const sshPort = trimString(overrides.ssh_port);
  const authMode = (trimString(overrides.auth_mode) as DesktopSSHAuthMode) || DEFAULT_DESKTOP_SSH_AUTH_MODE;
  return {
    mode,
    connection_kind: 'gateway_url_profile',
    profile_route_kind: 'url',
    environment_id: trimString(overrides.environment_id),
    gateway_id: trimString(overrides.gateway_id),
    label: trimString(overrides.label),
    target_url: trimString(overrides.target_url),
    origin_label: trimString(overrides.origin_label),
    ssh_destination: sshDestination,
    ssh_port: sshPort,
    auth_mode: authMode,
    ssh_password: '',
    ssh_password_mode: 'replace',
    ssh_password_configured: false,
    baseline_ssh_destination: sshDestination,
    baseline_ssh_port: sshPort,
    baseline_auth_mode: authMode,
    container_engine: overrides.container_engine ?? 'docker',
    container_id: trimString(overrides.container_id),
    container_ref: trimString(overrides.container_ref) || trimString(overrides.container_label) || trimString(overrides.container_id),
    container_label: trimString(overrides.container_label),
    runtime_root: trimString(overrides.runtime_root),
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
  const seed = normalizeGatewayDisplayNameSeed(state.gateway_url);
  return seed === '' ? null : `Gateway-${seed}`;
}

function createGatewaySetupDialogState(
  overrides: Partial<GatewaySetupDialogState> = {},
): GatewaySetupDialogState {
  // Standalone Gateways are URL endpoints. SSH and container targets are
  // Managed Environments and must be registered through the Environment flow.
  const connectionKind: DesktopGatewayConnectionKind = overrides.connection_kind ?? 'url';
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
    pairing_code: trimString(overrides.pairing_code),
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
  if (state.connection_kind === 'gateway_url_profile') {
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

function connectionDialogAutoRuntimeProbeEnabled(state: ConnectionDialogState): boolean {
  return connectionDialogAutoRuntimeProbeConfigurable(state)
    && state !== null
    && state.connection_kind !== 'gateway_url_profile'
    && state.auto_runtime_probe_enabled === true;
}

function gatewayCanWriteEnvironmentProfiles(gateway: DesktopGatewaySource): boolean {
  return gateway.status === 'online'
    && gateway.trust_state === 'paired'
    && gateway.capabilities.includes('env_profile_write');
}

function isSSHPasswordConnectionDialogState(
  state: ConnectionDialogState,
): state is SSHPasswordConnectionDialogState {
  return state?.connection_kind === 'ssh_environment'
    || state?.connection_kind === 'ssh_container_runtime';
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
    case 'gateway_url_profile': {
      const seed = normalizeGatewayDisplayNameSeed(state.target_url);
      return seed === '' ? null : seed;
    }
  }
}

export function controlPlaneProviderPresetOptions(
  providerOrigins: readonly string[],
): readonly ControlPlaneProviderPresetOption[] {
  return providerOrigins.flatMap((providerOrigin) => {
    try {
      const url = new URL(providerOrigin);
      if (url.origin !== providerOrigin || url.protocol !== 'https:') {
        return [];
      }
      return [{ domain: url.hostname, provider_origin: url.origin }];
    } catch {
      return [];
    }
  });
}

function controlPlaneProviderPresetForOrigin(
  providerOrigin: string,
  options: readonly ControlPlaneProviderPresetOption[],
): ControlPlaneProviderPresetOption | null {
  const clean = trimString(providerOrigin);
  if (clean === '') {
    return null;
  }
  return options.find((option) => option.provider_origin === clean) ?? null;
}

function defaultControlPlaneProviderPreset(
  options: readonly ControlPlaneProviderPresetOption[],
): ControlPlaneProviderPresetOption | null {
  return options[0] ?? null;
}

function createControlPlaneDialogState(
  options: readonly ControlPlaneProviderPresetOption[],
  overrides: Partial<Exclude<ControlPlaneDialogState, null>> = {},
): Exclude<ControlPlaneDialogState, null> {
  const requestedProviderOrigin = trimString(overrides.provider_origin);
  const defaultPreset = defaultControlPlaneProviderPreset(options);
  return {
    provider_origin: controlPlaneProviderPresetForOrigin(requestedProviderOrigin, options)?.provider_origin
      ?? defaultPreset?.provider_origin
      ?? '',
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
        primary: i18n.t('settings.portNumber', {
          port: model.next_start_address_display,
        }),
        primary_monospace: false,
        hint: i18n.t('settings.onLanIp'),
      };
    case 'raw':
    default:
      return describeNextStartAddress(model.next_start_address_display);
  }
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
    || typeof candidate.requestRuntimeFlower !== 'function'
    || typeof candidate.prepareRuntimeFlowerAttachment !== 'function'
    || typeof candidate.writeRuntimeFlowerAttachmentChunk !== 'function'
    || typeof candidate.commitRuntimeFlowerAttachment !== 'function'
    || typeof candidate.cancelRuntimeFlowerAttachment !== 'function'
    || typeof candidate.subscribeRuntimeFlowerAttachmentProgress !== 'function'
  ) {
    return null;
  }
  return candidate;
}

function desktopUpdateBridge() {
  const candidate = window.redevenDesktopUpdate;
  if (
    !candidate
    || typeof candidate.getSnapshot !== 'function'
    || typeof candidate.perform !== 'function'
    || typeof candidate.subscribe !== 'function'
    || typeof candidate.subscribeOpenRequested !== 'function'
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
    { defer: true },
  ));

  createEffect(on(
    [open, () => props.snapshot.preference],
    ([isOpen]) => {
      if (isOpen) {
        setHighlightedIndex(selectedIndex());
      }
    },
  ));

  createEffect(() => {
    if (open()) {
      scrollDesktopListboxOptionIntoView(listboxRef, `redeven-desktop-language-option-${highlightedIndex()}`);
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
        aria-activedescendant={open() ? `redeven-desktop-language-option-${highlightedIndex()}` : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
          } else if ((event.key === 'Enter' || event.key === ' ') && open()) {
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
                    id={`redeven-desktop-language-option-${index()}`}
                    role="option"
                    tabIndex={-1}
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
  openThemePicker: () => void;
  checkForUpdates: () => void;
}>): null {
  const cmd = useCommand();

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
      ...(snapshot.platform_capabilities.native_local_environment
        ? [
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
          ]
        : []),
      {
        id: 'redeven.desktop.focusEnvironmentURL',
        title: props.i18n.t('commandPalette.connectAnotherEnvironmentTitle'),
        description: props.i18n.t('commandPalette.connectAnotherEnvironmentDescription'),
        category: props.i18n.t('commandPalette.categories.desktop'),
        icon: Search,
        execute: () => props.openCreateConnectionDialog(props.i18n.t('commandPalette.connectAnotherEnvironmentPrompt')),
      },
      {
        id: 'redeven.desktop.checkForUpdates',
        title: props.i18n.t('commandPalette.checkForUpdatesTitle'),
        description: props.i18n.t('commandPalette.checkForUpdatesDescription'),
        category: props.i18n.t('commandPalette.categories.desktop'),
        icon: Refresh,
        execute: () => props.checkForUpdates(),
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
        id: 'redeven.desktop.changeAppearance',
        title: props.i18n.t('commandPalette.toggleThemeTitle'),
        description: props.i18n.t('commandPalette.toggleThemeDescription'),
        category: props.i18n.t('commandPalette.categories.general'),
        icon: Highlighter,
        execute: () => props.openThemePicker(),
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

    const unregister = cmd.registerAll(list as never);
    onCleanup(() => unregister());
  });

  return null;
}

function DesktopWelcomeShellInner(props: DesktopWelcomeShellProps) {
  const theme = useTheme();
  const shellTheme = desktopThemeBridge();
  const shellLanguage = desktopLanguageBridge();
  const updateBridge = desktopUpdateBridge();
  const flowerDraftCoordinator = createFlowerComposerDraftCoordinator();
  onCleanup(() => flowerDraftCoordinator.dispose());
  const [snapshot, setSnapshot] = createSignal(props.snapshot);
  const controlPlaneProviderPresets = createMemo(() => (
    controlPlaneProviderPresetOptions(snapshot().redeven_cloud_origins)
  ));
  const [languageSnapshot, setLanguageSnapshot] = createSignal<RedevenLanguageSnapshot>(
    shellLanguage?.getSnapshot() ?? FALLBACK_DESKTOP_LANGUAGE_SNAPSHOT,
  );
  const [languagePickerOpenRequest, setLanguagePickerOpenRequest] = createSignal(0);
  const fallbackThemePickerSnapshot = (): DesktopThemePickerSnapshot => ({
    source: theme.theme(),
    resolvedTheme: theme.resolvedTheme(),
    shellThemes: {
      light: theme.shellPresetForMode('light')?.name ?? BUILT_IN_SHELL_THEME_DEFAULTS.light,
      dark: theme.shellPresetForMode('dark')?.name ?? BUILT_IN_SHELL_THEME_DEFAULTS.dark,
    },
  });
  const [themeSnapshot, setThemeSnapshot] = createSignal<DesktopThemePickerSnapshot>(
    shellTheme?.getSnapshot() ?? fallbackThemePickerSnapshot(),
  );
  const [themePickerOpenRequest, setThemePickerOpenRequest] = createSignal(0);
  const [desktopUpdateSnapshot, setDesktopUpdateSnapshot] = createSignal<DesktopUpdateSnapshot>(
    unsupportedDesktopUpdateSnapshot(),
  );
  const [desktopUpdateDialogOpen, setDesktopUpdateDialogOpen] = createSignal(false);
  const [actionToasts, setActionToasts] = createSignal<readonly DesktopActionToast[]>([]);
  const [liveActionProgress, setLiveActionProgress] = createSignal<readonly DesktopLauncherActionProgress[]>([]);
  const [retainedGatewayFailures, setRetainedGatewayFailures] = createSignal<readonly DesktopLauncherActionProgress[]>([]);
  const [settingsError, setSettingsError] = createSignal('');
  const [connectionDialogError, setConnectionDialogError] = createSignal('');
  const [connectionDialogFieldErrors, setConnectionDialogFieldErrors] = createSignal<Partial<Record<string, string>>>({});
  const [controlPlaneDialogError, setControlPlaneDialogError] = createSignal('');
  const [busyState, setBusyState] = createSignal<DesktopLauncherBusyState>(IDLE_LAUNCHER_BUSY_STATE);

  createEffect(() => {
    if (!updateBridge) {
      return;
    }
    let active = true;
    void updateBridge.getSnapshot().then((nextSnapshot) => {
      if (active) setDesktopUpdateSnapshot(nextSnapshot);
    });
    const unsubscribeSnapshot = updateBridge.subscribe(setDesktopUpdateSnapshot);
    const unsubscribeOpen = updateBridge.subscribeOpenRequested(() => setDesktopUpdateDialogOpen(true));
    onCleanup(() => {
      active = false;
      unsubscribeSnapshot();
      unsubscribeOpen();
    });
  });

  async function performDesktopUpdateAction(action: DesktopUpdateAction): Promise<void> {
    if (!updateBridge) {
      return;
    }
    const response = await updateBridge.perform(action);
    setDesktopUpdateSnapshot(response.snapshot);
  }

  function checkForDesktopUpdates(): void {
    const current = desktopUpdateSnapshot();
    if (current.platform !== 'macos_sparkle' || current.state === 'blocked') {
      setDesktopUpdateDialogOpen(true);
    }
    void performDesktopUpdateAction({ kind: 'check_for_updates' });
  }

  function openDesktopUpdates(): void {
    const current = desktopUpdateSnapshot();
    if (current.platform === 'macos_sparkle' && current.state !== 'blocked') {
      void performDesktopUpdateAction({ kind: 'open_update_ui' });
      return;
    }
    setDesktopUpdateDialogOpen(true);
  }
  const [settingsDraftSession, setSettingsDraftSession] = createSignal(createDesktopSettingsDraftSession(props.snapshot.settings_surface));
  const [connectionDialogState, setConnectionDialogState] = createSignal<ConnectionDialogState>(null);
  const [gatewaySetupDialogState, setGatewaySetupDialogState] = createSignal<GatewaySetupDialogState | null>(null);
  const [gatewaySetupDialogError, setGatewaySetupDialogError] = createSignal('');
  const [gatewaySetupDialogFieldErrors, setGatewaySetupDialogFieldErrors] = createSignal<Partial<Record<string, string>>>({});
  const [sshConfigHosts, setSSHConfigHosts] = createSignal<readonly DesktopSSHConfigHost[]>([]);
  const [sshConfigHostsLoading, setSSHConfigHostsLoading] = createSignal(false);
  const [sshConfigHostsLoadError, setSSHConfigHostsLoadError] = createSignal(false);
  const [runtimeContainerOptions, setRuntimeContainerOptions] = createSignal<readonly DesktopRuntimeContainerOption[]>([]);
  const [runtimeContainerOptionsLoading, setRuntimeContainerOptionsLoading] = createSignal(false);
  const [runtimeContainerOptionsError, setRuntimeContainerOptionsError] = createSignal('');
  const [runtimeContainerOptionsKey, setRuntimeContainerOptionsKey] = createSignal('');
  const [controlPlaneDialogState, setControlPlaneDialogState] = createSignal<ControlPlaneDialogState>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<DesktopEnvironmentEntry | null>(null);
  const [deleteGatewayTarget, setDeleteGatewayTarget] = createSignal<DesktopGatewaySource | null>(null);
  const [providerRuntimeLinkConfirmation, setProviderRuntimeLinkConfirmation] = createSignal<ProviderRuntimeLinkConfirmationState | null>(null);
  const [providerRuntimeLinkProviderEnvironmentID, setProviderRuntimeLinkProviderEnvironmentID] = createSignal('');
  const [deleteControlPlaneTarget, setDeleteControlPlaneTarget] = createSignal<DesktopControlPlaneSummary | null>(null);
  const [flowerTurnLauncherOpen, setFlowerTurnLauncherOpen] = createSignal(false);
  const [flowerTurnLauncherIntent, setFlowerTurnLauncherIntent] = createSignal<FlowerTurnLauncherIntent | null>(null);
  const [flowerTurnLauncherAnchor, setFlowerTurnLauncherAnchor] = createSignal<FlowerTurnLauncherAnchor | null>(null);
  const [flowerFocusThreadRequest, setFlowerFocusThreadRequest] = createSignal<FlowerThreadFocusRequest | null>(null);
  let flowerFocusThreadRequestSequence = 0;
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
  const [lifecycleProgressFocusRequest, setLifecycleProgressFocusRequest] = createSignal<LifecycleProgressFocusRequest | null>(null);
  const actionToastTimers = new Map<number, number>();
  const liveActionProgressTimers = new Map<string, number>();
  let nextActionToastID = 0;
  let lifecycleProgressFocusRequestSequence = 0;
  let settingsErrorRef: HTMLElement | undefined;
  let sshConfigHostsRequestID = 0;
  let runtimeContainerOptionsRequestID = 0;

  const visibleSurface = createMemo<DesktopLauncherSurface>(() => snapshot().surface);
  const i18n = createMemo(() => createDesktopI18n(languageSnapshot().resolved_locale));
  const sshConfigHostsLoadKey = createMemo(() => {
    const connectionState = connectionDialogState();
    if (
      connectionState?.connection_kind === 'ssh_environment'
      || connectionState?.connection_kind === 'ssh_container_runtime'

    ) {
      return `connection:${connectionState.mode}:${connectionState.connection_kind}:${connectionState.environment_id}`;
    }
    const gatewayState = gatewaySetupDialogState();
    if (gatewayState?.connection_kind === 'ssh_host' || gatewayState?.connection_kind === 'ssh_container') {
      return `gateway:${gatewayState.mode}:${gatewayState.connection_kind}:${gatewayState.gateway_id}`;
    }
    return '';
  });
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
  const settingsRuntimePresentation = createMemo(() => {
    const environment = selectedSettingsEnvironmentEntry();
    if (!environment) {
      return {
        running: false,
        statusLabel: i18n().t('settings.notRunning'),
        statusTone: 'neutral' as const,
      };
    }
    const runtime = buildEnvironmentSettingsRuntimeModel(environment);
    return {
      running: runtime.running,
      statusLabel: localizedEnvironmentStatusLabel(i18n(), runtime.status_label),
      statusTone: runtime.status_tone,
    };
  });
  const settingsRuntimeRestartAvailable = createMemo(() => {
    const environment = selectedSettingsEnvironmentEntry();
    return environment?.kind === 'local_environment'
      && environment.runtime_operations.restart.availability === 'available';
  });
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
      if (environment.kind === 'gateway_environment') {
        const gatewayFilterValue = gatewaySourceFilterValue(environment.gateway_id ?? '');
        if (gatewayFilterValue !== '') {
          next.add(gatewayFilterValue);
        }
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
      '',
      '',
    )
  ));
  const clearLiveActionProgressTimer = (key: string) => {
    const timer = liveActionProgressTimers.get(key);
    if (timer === undefined) {
      return;
    }
    window.clearTimeout(timer);
    liveActionProgressTimers.delete(key);
  };
  const removeLiveActionProgress = (key: string) => {
    clearLiveActionProgressTimer(key);
    setLiveActionProgress((current) => current.filter((progress) => launcherProgressIdentityKey(progress) !== key));
  };
  const rememberLiveActionProgress = (progress: DesktopLauncherActionProgress) => {
    if (!activeLauncherProgressIsRetainable(progress)) {
      return;
    }
    const key = launcherProgressIdentityKey(progress);
    if (key === '') {
      return;
    }
    setLiveActionProgress((current) => [
      ...current.filter((item) => launcherProgressIdentityKey(item) !== key),
      progress,
    ]);
    if (!launcherActionProgressIsTerminal(progress)) {
      clearLiveActionProgressTimer(key);
      return;
    }
    clearLiveActionProgressTimer(key);
    liveActionProgressTimers.set(key, window.setTimeout(() => {
      removeLiveActionProgress(key);
    }, 4_000));
  };
  const pruneLiveActionProgressWithSnapshot = (progressItems: readonly DesktopLauncherActionProgress[]) => {
    const snapshotKeys = new Set(progressItems.map((progress) => launcherProgressIdentityKey(progress)));
    setLiveActionProgress((current) => current.filter((progress) => {
      const key = launcherProgressIdentityKey(progress);
      if (snapshotKeys.has(key)) {
        clearLiveActionProgressTimer(key);
        return false;
      }
      return true;
    }));
  };
  const writableGatewayProfileSources = createMemo(() => (
    snapshot().gateway_sources.filter(gatewayCanWriteEnvironmentProfiles)
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
  const activeActionProgress = createMemo(() => [
    ...snapshot().action_progress,
    ...liveActionProgress().filter((live) => (
      !snapshot().action_progress.some((progress) => (
        launcherProgressIdentityKey(progress) === launcherProgressIdentityKey(live)
      ))
    )),
    ...retainedGatewayFailures().filter((retained) => (
      ![...snapshot().action_progress, ...liveActionProgress()].some((progress) => (
        launcherProgressIdentityKey(progress) === launcherProgressIdentityKey(retained)
      ))
    )),
  ]);
  const localEnvironmentEntry = createMemo(() => (
    snapshot().environments.find((environment) => environment.kind === 'local_environment')
      ?? null
  ));
  const flowerFilesystemScopeKey = createMemo(() => {
    const targetID = snapshot().default_flower_runtime_target_id;
    const environment = targetID
      ? snapshot().environments.find((entry) => entry.id === targetID || entry.managed_runtime_target_id === targetID)
      : localEnvironmentEntry();
    return JSON.stringify([targetID, environment?.id, environment?.runtime_started_at_unix_ms, environment?.runtime_health, environment?.open_session_key]);
  });
  const flowerRuntimeLifecycleProgress = createMemo(() => {
    const environment = localEnvironmentEntry();
    return environment
      ? selectedSnapshotRuntimeLifecycleProgressForEnvironment(environment, activeActionProgress())
      : null;
  });
  const flowerWarmupState = createMemo<FlowerSurfaceWarmupState | null>(() => {
    const progress = selectedFlowerWarmupProgress(flowerRuntimeLifecycleProgress());
    if (!progress) {
      return null;
    }
    return {
      active: true,
      title: i18n().t('flowerSurface.chat.warmupTitle'),
      detail: localizedProgressDetail(i18n(), progress) || i18n().t('flowerSurface.chat.warmupDetail'),
      phaseLabel: localizedProgressTitle(i18n(), progress) || i18n().t('flowerSurface.chat.loadingSettings'),
      modelLabel: i18n().t('flowerSurface.chat.warmupModelLabel'),
    };
  });

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
    for (const handle of liveActionProgressTimers.values()) {
      window.clearTimeout(handle);
    }
    liveActionProgressTimers.clear();
  });

  if (shellTheme) {
    const applyShellTheme = (next: ReturnType<typeof shellTheme.getSnapshot>) => {
      setThemeSnapshot(next);
      for (const mode of ['light', 'dark'] as const) {
        if (theme.shellPresetForMode(mode)?.name !== next.shellThemes[mode]) {
          theme.setShellPreset(next.shellThemes[mode]);
        }
      }
      if (theme.theme() !== next.source) {
        theme.setTheme(next.source);
      }
    };
    applyShellTheme(shellTheme.getSnapshot());
    const unsubscribe = shellTheme.subscribe(applyShellTheme);
    onCleanup(unsubscribe);
  } else {
    createEffect(() => {
      setThemeSnapshot(fallbackThemePickerSnapshot());
    });
  }

  const updateDesktopThemeSource = (source: DesktopThemePickerSnapshot['source']): DesktopThemePickerSnapshot => {
    if (shellTheme) {
      const next = shellTheme.setSource(source);
      setThemeSnapshot(next);
      return next;
    }
    theme.setTheme(source);
    const next = fallbackThemePickerSnapshot();
    setThemeSnapshot(next);
    return next;
  };

  const updateDesktopShellTheme = (
    mode: DesktopThemePickerSnapshot['resolvedTheme'],
    presetName: string,
  ): DesktopThemePickerSnapshot => {
    if (shellTheme) {
      const next = shellTheme.setShellTheme(mode, presetName);
      setThemeSnapshot(next);
      return next;
    }
    theme.setShellPreset(presetName);
    const next = fallbackThemePickerSnapshot();
    setThemeSnapshot(next);
    return next;
  };

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
        pruneLiveActionProgressWithSnapshot(next.action_progress);
      }
      setRetainedGatewayFailures((failures) => {
        if (failures.length === 0) {
          return failures;
        }
        const gatewayByID = new Map(next.gateway_sources.map((gateway) => [gateway.gateway_id, gateway]));
        const retained = failures.filter((failure) => {
          const gatewayID = trimString(failure.gateway_id || (failure.subject_kind === 'gateway' ? failure.subject_id : ''));
          const gateway = gatewayByID.get(gatewayID);
          return !gateway || desktopGatewayNeedsResolution(gateway.status) || gateway.sync_state === 'catalog_failed' || gateway.sync_state === 'pairing_failed';
        });
        return retained.length === failures.length ? failures : retained;
      });
      return next;
    });
  });
  onCleanup(unsubscribeSnapshot);
  const unsubscribeActionProgress = props.runtime.launcher.subscribeActionProgress?.((progress) => {
    rememberLiveActionProgress(progress);
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

  async function refreshWSLDiscovery(): Promise<DesktopWSLDiscoverySnapshot> {
    const refresh = props.runtime.launcher.refreshWSL;
    if (!refresh) {
      throw new Error(i18n().t('environmentCenter.wslUnavailable'));
    }
    const discovery = await refresh();
    await refreshSnapshot();
    return discovery;
  }

  async function registerWSLDistribution(request: DesktopWSLRegisterRequest): Promise<DesktopWSLActionResponse> {
    const register = props.runtime.launcher.registerWSL;
    if (!register) {
      return {
        ok: false,
        message: i18n().t('environmentCenter.wslUnavailable'),
      };
    }
    const response = await register(request);
    await refreshSnapshot();
    return response;
  }

  async function setDefaultWSLEnvironment(request: DesktopWSLSetDefaultRequest): Promise<DesktopWSLActionResponse> {
    const setDefault = props.runtime.launcher.setDefaultWSL;
    if (!setDefault) {
      return {
        ok: false,
        message: i18n().t('environmentCenter.wslUnavailable'),
      };
    }
    const response = await setDefault(request);
    await refreshSnapshot();
    return response;
  }

  async function refreshSSHConfigHosts(): Promise<void> {
    const requestID = ++sshConfigHostsRequestID;
    setSSHConfigHostsLoading(true);
    setSSHConfigHostsLoadError(false);
    const loadHosts = props.runtime.launcher.getSSHConfigHosts;
    if (!loadHosts) {
      if (requestID === sshConfigHostsRequestID) {
        setSSHConfigHostsLoadError(true);
        setSSHConfigHostsLoading(false);
      }
      return;
    }
    try {
      const hosts = await loadHosts();
      if (requestID !== sshConfigHostsRequestID) {
        return;
      }
      setSSHConfigHosts(hosts);
    } catch {
      if (requestID === sshConfigHostsRequestID) {
        setSSHConfigHostsLoadError(true);
      }
    } finally {
      if (requestID === sshConfigHostsRequestID) {
        setSSHConfigHostsLoading(false);
      }
    }
  }

  createEffect(on(sshConfigHostsLoadKey, (loadKey, previousLoadKey) => {
    if (loadKey !== '' && loadKey !== previousLoadKey) {
      void refreshSSHConfigHosts();
    }
  }));

  async function refreshRuntimeContainerOptions(force = false): Promise<void> {
    const connectionState = connectionDialogState();
    const state = connectionState?.connection_kind === 'local_container_runtime' || connectionState?.connection_kind === 'ssh_container_runtime'
      ? connectionState
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
        const selectedID = trimString(
          currentDialogState?.connection_kind === 'local_container_runtime' || currentDialogState?.connection_kind === 'ssh_container_runtime'
            ? currentDialogState.container_id
            : '',
        );
        const selectedRef = trimString(
          currentDialogState?.connection_kind === 'local_container_runtime' || currentDialogState?.connection_kind === 'ssh_container_runtime'
            ? currentDialogState.container_ref || currentDialogState.container_label
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
              if (
                current?.connection_kind !== 'local_container_runtime'
                && current?.connection_kind !== 'ssh_container_runtime'
              ) {
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
      return '';
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
    request?: DesktopLauncherActionRequest,
  ): Promise<void> {
    const presentation = launcherActionFailurePresentation(i18n(), failure);
    if (presentation.refresh_snapshot) {
      try {
        await refreshSnapshot();
      } catch (error) {
          setErrorMessage(errorTarget, getErrorMessage(error));
        return;
      }
    }
    const activeOperationKey = trimString(failure.operation_key);
    const confirmationProgress = confirmationProgressForLauncherFailure(failure, activeActionProgress());
    if (confirmationProgress) {
      const environmentID = trimString(
        requestEnvID
        || failure.environment_id
        || confirmationProgress.environment_id,
      );
      if (environmentID !== '') {
        setActiveCenterTab('environments');
        setLibrarySourceFilter('');
        setLibraryQuery('');
        lifecycleProgressFocusRequestSequence += 1;
        setLifecycleProgressFocusRequest({
          request_id: lifecycleProgressFocusRequestSequence,
          operation_key: activeOperationKey,
          started_at_unix_ms: confirmationProgress.started_at_unix_ms ?? 0,
          subject_kind: 'environment',
          subject_id: environmentID,
        });
      }
      return;
    }
    if (failure.code === 'runtime_lifecycle_in_progress' && activeOperationKey !== '') {
      const activeProgress = activeActionProgress().find((progress) => (
        trimString(progress.operation_key) === activeOperationKey
        && progress.lifecycle_progress !== undefined
        && (
          progress.status === 'running'
          || progress.status === 'canceling'
          || progress.status === 'cleanup_running'
        )
      ));
      if (!activeProgress) {
        return;
      }
      const gatewayID = trimString(
        failure.gateway_id
        || (activeProgress?.subject_kind === 'gateway' ? activeProgress.gateway_id || activeProgress.subject_id : ''),
      );
      if (failure.scope === 'gateway' && gatewayID !== '') {
        setActiveCenterTab('gateways');
        setGatewaySourceFilter('');
        setGatewayQuery('');
        lifecycleProgressFocusRequestSequence += 1;
        setLifecycleProgressFocusRequest({
          request_id: lifecycleProgressFocusRequestSequence,
          operation_key: activeOperationKey,
          started_at_unix_ms: activeProgress.started_at_unix_ms ?? 0,
          subject_kind: 'gateway',
          subject_id: gatewayID,
        });
        return;
      }
      const environmentID = trimString(
        requestEnvID
        || failure.environment_id
        || activeProgress?.environment_id
        || (activeProgress?.subject_kind === 'local_environment' ? activeProgress.subject_id : ''),
      );
      if (environmentID) {
        setActiveCenterTab('environments');
        setLibrarySourceFilter('');
        setLibraryQuery('');
        lifecycleProgressFocusRequestSequence += 1;
        setLifecycleProgressFocusRequest({
          request_id: lifecycleProgressFocusRequestSequence,
          operation_key: activeOperationKey,
          started_at_unix_ms: activeProgress.started_at_unix_ms ?? 0,
          subject_kind: 'environment',
          subject_id: environmentID,
        });
      }
      return;
    }
    if (failure.scope === 'gateway' && trimString(failure.gateway_id) !== '') {
      if (activeOperationKey !== '') {
        return;
      }
      const retained = retainedGatewayFailureProgress(i18n(), failure, request, presentation);
      setRetainedGatewayFailures((current) => [
        ...current.filter((progress) => trimString(progress.gateway_id) !== trimString(failure.gateway_id)),
        retained,
      ]);
      return;
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
    }
  }

  function clearOperationProgressFocus(operationKey: string): void {
    const cleanOperationKey = trimString(operationKey);
    if (cleanOperationKey === '') {
      return;
    }
    setLifecycleProgressFocusRequest((current) => (
      current?.operation_key === cleanOperationKey ? null : current
    ));
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
          code: result.code,
          message: presentation.message || i18n().t('toast.actionFailedFallback'),
          ...(result.operation_key ? { operation_key: result.operation_key } : {}),
          ...(result.failure ? { failure: result.failure } : {}),
          raw_failure: result,
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
    setLanguagePickerOpenRequest((current) => current + 1);
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
    if (preferredKind === 'gateway_url_profile') {
      setConnectionDialogState(createGatewayURLProfileConnectionDialogState('create', {
        gateway_id: writableGatewayProfileSources()[0]?.gateway_id ?? '',
      }));
      return;
    }
    setConnectionDialogState(createExternalURLConnectionDialogState('create', {
      external_local_ui_url: trimString(snapshot().suggested_remote_url),
    }));
  }

  function gatewaySetupFocusForGateway(
    gateway: DesktopGatewaySource,
    requestedFocus?: DesktopGatewayResolveFocus,
  ): GatewaySetupDialogState['focus_section'] {
    if (requestedFocus === 'url_endpoint' || requestedFocus === 'identity_trust') {
      return requestedFocus;
    }
    if (gateway.status === 'pairing_required' || gateway.trust_state === 'unpaired') {
      return 'identity_trust';
    }
    return undefined;
  }

  function openCreateGatewaySetup(gateway?: DesktopGatewaySource, focusSection?: DesktopGatewayResolveFocus): void {
    if (snapshot().surface !== 'connect_environment') {
      showConnectEnvironment(i18n().t('environmentCenter.addGatewayLauncherPrompt'));
      return;
    }
    resetMessages();
    if (gateway && gateway.connection_kind !== 'url') {
      showActionToast(i18n().t('connectionDialog.gatewayUrlHelp'), 'warning');
      return;
    }
    setActiveCenterTab('gateways');
    setConnectionDialogState(null);
    setControlPlaneDialogState(null);
    setGatewaySetupDialogFieldErrors({});
    setGatewaySetupDialogState(createGatewaySetupDialogState(gateway
      ? {
          mode: 'edit',
          gateway_id: gateway.gateway_id,
          display_name: gateway.display_name,
          connection_kind: 'url',
          gateway_url: gateway.gateway_url ?? '',
          allow_loopback_http: gateway.allow_loopback_http === true,
          focus_section: gatewaySetupFocusForGateway(gateway, focusSection),
        }
      : {}));
  }

  function startEditingEnvironment(environment: DesktopEnvironmentEntry): void {
    if (environment.kind === 'provider_environment') {
      openSettingsSurface(environment.id);
      return;
    }
    const registrationRef = environment.registration_ref;
    if (!registrationRef) {
      setErrorMessage('connect', i18n().t('environmentCenter.environmentRegistrationUnavailable'));
      return;
    }
    if (registrationRef.kind === 'local_environment') {
      openSettingsSurface(environment.id);
      return;
    }
    if (registrationRef.kind === 'runtime_target') {
      if (environment.managed_runtime_placement?.kind !== 'container_process' || !environment.managed_runtime_host_access) {
        setConnectionDialogState(createSSHConnectionDialogState('edit', {
          environment_id: registrationRef.id,
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
        setConnectionDialogError('');
        return;
      }
      const isSSHContainer = environment.managed_runtime_host_access.kind === 'ssh_host';
      setConnectionDialogState(createRuntimeContainerConnectionDialogState('edit', isSSHContainer ? 'ssh_container_runtime' : 'local_container_runtime', {
        environment_id: registrationRef.id,
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
    } else if (registrationRef.kind === 'gateway_environment') {
      const route = environment.gateway_environment_profile_access_route;
      if (!route || route.kind !== 'url') {
        setErrorMessage('connect', i18n().t('environmentCenter.gatewayEnvironmentProfileUnavailable'));
        return;
      }
      setConnectionDialogState(createGatewayURLProfileConnectionDialogState('edit', {
        environment_id: registrationRef.gateway_env_id,
        gateway_id: registrationRef.gateway_id,
        label: environment.label,
        profile_route_kind: route.kind,
        target_url: route.url ?? '',
        origin_label: route.origin_label ?? environment.gateway_environment_origin?.label ?? '',
      }));
    } else {
      setConnectionDialogState(createExternalURLConnectionDialogState('edit', {
        environment_id: registrationRef.id,
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
    setControlPlaneDialogState(createControlPlaneDialogState(controlPlaneProviderPresets()));
  }

  function focusProviderEnvironments(controlPlane: DesktopControlPlaneSummary): void {
    setActiveCenterTab('environments');
    setLibraryQuery('');
    setLibrarySourceFilter(controlPlaneFilterValue(controlPlane));
  }

  function focusGatewayEnvironments(gateway: DesktopGatewaySource): void {
    setActiveCenterTab('environments');
    setLibraryQuery('');
    const filterValue = gatewaySourceFilterValue(gateway.gateway_id);
    setLibrarySourceFilter(filterValue || GATEWAY_ENVIRONMENT_LIBRARY_FILTER);
  }

  function closeControlPlaneDialog(): void {
    setControlPlaneDialogState(null);
    setControlPlaneDialogError('');
  }

  function updateControlPlaneDialogField(
    name: 'provider_origin',
    value: string,
  ): void {
    void name;
    setControlPlaneDialogState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        provider_origin: controlPlaneProviderPresetForOrigin(value, controlPlaneProviderPresets())?.provider_origin
          ?? defaultControlPlaneProviderPreset(controlPlaneProviderPresets())?.provider_origin
          ?? '',
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
      const autoRuntimeProbeEnabled = connectionDialogAutoRuntimeProbeEnabled(current);
      if (kind === 'ssh_environment') {
        return createSSHConnectionDialogState('create', {
          label,
          bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
          auto_runtime_probe_enabled: autoRuntimeProbeEnabled,
        });
      }
      if (kind === 'local_container_runtime' || kind === 'ssh_container_runtime') {
        return createRuntimeContainerConnectionDialogState('create', kind, {
          label,
          auto_runtime_probe_enabled: kind === 'local_container_runtime'
            ? true
            : autoRuntimeProbeEnabled,
        });
      }
      if (kind === 'gateway_url_profile') {
        return createGatewayURLProfileConnectionDialogState('create', {
          label,
          target_url: current.connection_kind === 'external_local_ui' ? current.external_local_ui_url : '',
          gateway_id: writableGatewayProfileSources()[0]?.gateway_id ?? '',
        });
      }
      return createExternalURLConnectionDialogState('create', {
        label,
        auto_runtime_probe_enabled: autoRuntimeProbeEnabled,
        external_local_ui_url: current.connection_kind === 'external_local_ui'
          ? current.external_local_ui_url
          : current.connection_kind === 'gateway_url_profile'
            ? current.target_url
          : trimString(snapshot().suggested_remote_url),
      });
    });
  }

  function updateConnectionDialogField(
    name: 'label' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'auth_mode' | 'ssh_password' | 'runtime_root' | 'release_base_url' | 'connect_timeout_seconds' | 'container_engine' | 'container_id' | 'container_ref' | 'container_label' | 'gateway_id' | 'target_url' | 'origin_label' | 'profile_route_kind',
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
      if (name === 'ssh_destination' || name === 'container_label' || name === 'container_id' || name === 'target_url') {
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
      let base: GatewaySetupDialogState = {
        ...current,
        ...(name === 'display_name' ? { display_name_touched: true } : {}),
        [name]: nextValue,
      };
      if (name === 'gateway_url') {
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
    // Standalone Gateways are URL-only. This callback remains for the legacy
    // dialog shape while persisted non-URL records are migrated or rejected.
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
        await handleLauncherActionFailure(result, errorTarget, requestEnvID || undefined, request);
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
    clearOperationProgressFocus(operationKey);
    const result = await performLauncherAction({
      kind: 'cancel_launcher_operation',
      operation_key: operationKey,
    });
    if (result?.outcome === 'canceled_launcher_operation') {
      const presentation = launcherOperationInterruptionPresentation(progress.action);
      showActionToast(i18n().t(presentation.cancelingTitleKey), 'info');
    }
  }

  async function dismissLauncherOperation(progress: DesktopLauncherActionProgress): Promise<void> {
    const operationKey = trimString(progress.operation_key);
    if (operationKey === '') {
      return;
    }
    clearOperationProgressFocus(operationKey);
    if (operationKey.startsWith('ui:gateway:')) {
      setRetainedGatewayFailures((current) => current.filter((item) => trimString(item.operation_key) !== operationKey));
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

  function runtimeActionRequest(
    environment: DesktopEnvironmentEntry,
    kind: RuntimeLauncherActionKind,
    options: Readonly<{
      forceRuntimeUpdate?: boolean;
      attempt?: EnvironmentLifecycleAttempt;
    }> = {},
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
      ...(options.attempt ? {
        operation_key: options.attempt.operation_key,
        operation_started_at_unix_ms: options.attempt.started_at_unix_ms,
      } : {}),
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

  async function loadLatestEnvironmentEntry(environmentID: string): Promise<DesktopEnvironmentEntry | null> {
    const nextSnapshot = await refreshSnapshot();
    return nextSnapshot.environments.find((entry) => entry.id === environmentID) ?? null;
  }

  async function startEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    options: Readonly<{
      announceSuccess?: boolean;
      attempt?: EnvironmentLifecycleAttempt;
    }> = {},
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'start_environment_runtime', { attempt: options.attempt });
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const started = result?.outcome === 'started_environment_runtime';
    if (started && options.announceSuccess !== false) {
      showActionToast(
        i18n().t('environmentCenter.runtimeStartedToast', {
          label: environment.label,
        }),
      );
    }
    return started;
  }

  async function startEnvironmentRuntimeSilently(
    environment: DesktopEnvironmentEntry,
  ): Promise<Extract<DesktopLauncherActionResult, Readonly<{ ok: true }>> | SilentLauncherActionFailure> {
    let request: DesktopLauncherActionRequest | null = null;
    let expectedOutcome: DesktopLauncherActionSuccess['outcome'] = 'started_environment_runtime';
    request = runtimeActionRequest(environment, 'start_environment_runtime');
    if (!request) {
      return {
        ok: false,
        message: i18n().t('environmentCenter.resolveRuntimeTargetError'),
      };
    }
    const result = await performLauncherActionSilently(request);
    if (!result.ok || result.outcome === expectedOutcome) {
      return result;
    }
    return { ok: false, message: i18n().t('toast.unexpectedLauncherResult') };
  }

  async function updateEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    attempt?: EnvironmentLifecycleAttempt,
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'update_environment_runtime', {
      forceRuntimeUpdate: true,
      attempt,
    });
    if (!request) {
      setErrorMessage(
        errorTarget === 'settings' ? 'settings' : 'connect',
        i18n().t('environmentCenter.resolveRuntimeTargetError'),
      );
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const updated = result?.outcome === 'updated_environment_runtime';
    if (updated) {
      showActionToast(
        i18n().t('environmentCenter.runtimeUpdatedToast', {
          label: environment.label,
        }),
      );
    }
    return updated;
  }

  async function restartEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    attempt?: EnvironmentLifecycleAttempt,
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'restart_environment_runtime', { attempt });
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const restarted = result?.outcome === 'restarted_environment_runtime';
    if (restarted) {
      showActionToast(
        i18n().t('environmentCenter.runtimeRestartedToast', {
          label: environment.label,
        }),
      );
    }
    return restarted;
  }

  async function stopEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    attempt?: EnvironmentLifecycleAttempt,
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'stop_environment_runtime', { attempt });
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const stopped = result?.outcome === 'stopped_environment_runtime';
    const canceled = result?.outcome === 'canceled_launcher_operation';
    if (stopped) {
      showActionToast(
        i18n().t('environmentCenter.runtimeStoppedToast', {
          label: environment.label,
        }),
      );
    }
    if (canceled) {
      showActionToast(
        i18n().t('environmentCenter.startupCanceledToast', {
          label: environment.label,
        }),
        'info',
      );
    }
    return stopped || canceled;
  }

  async function refreshEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    options: Readonly<{
      announceSuccess?: boolean;
      attempt?: EnvironmentLifecycleAttempt;
    }> = {},
  ): Promise<boolean> {
    if (environment.kind === 'gateway_environment') {
      const gatewayID = trimString(environment.gateway_id);
      if (gatewayID === '') {
        setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', i18n().t('environmentCenter.resolveGatewayError'));
        return false;
      }
      const result = await performLauncherAction({
        kind: 'refresh_gateway',
        gateway_id: gatewayID,
      }, errorTarget);
      const refreshed = result?.outcome === 'refreshed_gateway';
      if (refreshed && options.announceSuccess !== false) {
        showActionToast(i18n().t('environmentCenter.runtimeStatusRefreshedToast', { label: environment.label }), 'info');
      }
      return refreshed;
    }
    const request = runtimeActionRequest(environment, 'refresh_environment_runtime', {
      attempt: options.attempt,
    });
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const refreshed = result?.outcome === 'refreshed_environment_runtime';
    if (refreshed && options.announceSuccess !== false) {
      showActionToast(
        i18n().t('environmentCenter.runtimeStatusRefreshedToast', {
          label: environment.label,
        }),
        'info',
      );
    }
    return refreshed;
  }

  async function refreshEnvironmentRuntimeSilently(
    environment: DesktopEnvironmentEntry,
  ): Promise<boolean> {
    if (environment.kind === 'gateway_environment') {
      const gatewayID = trimString(environment.gateway_id);
      if (gatewayID === '') {
        return false;
      }
      const result = await performLauncherActionSilently({
        kind: 'refresh_gateway',
        gateway_id: gatewayID,
      });
      return result.ok && result.outcome === 'refreshed_gateway';
    }
    const request = runtimeActionRequest(environment, 'refresh_environment_runtime');
    if (!request) {
      return false;
    }
    const result = await performLauncherActionSilently(request);
    return result.ok && result.outcome === 'refreshed_environment_runtime';
  }

  function requestProviderRuntimeLinkConfirmation(
    environment: DesktopEnvironmentEntry,
    action: ProviderRuntimeLinkConfirmationAction,
  ): void {
    // IMPORTANT: Provider-link confirmation is intentionally reachable only from
    // Local/SSH runtime cards. Provider Environment cards must never grant or
    // revoke provider control over a runtime.
    if (!desktopEntryKindSupportsDirectRuntimeOperations(environment.kind)) {
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
      showActionToast(
        i18n().t('environmentCenter.connectedToProviderToast', {
          label: environment.label,
        }),
        'success',
      );
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

  async function attemptEnvironmentOpenSilently(
    environment: DesktopEnvironmentEntry,
  ): Promise<Readonly<{
    opened: boolean;
    message: string;
    recovery?: 'update_runtime' | 'update_desktop' | 'refresh_runtime';
    operation_key?: string;
  }>> {
    let request: DesktopLauncherActionRequest | null = null;
    if (environment.kind === 'local_environment') {
      request = {
        kind: 'open_local_environment',
        environment_id: environment.id,
        route: 'auto',
        ...(environment.managed_runtime_target_id ? { runtime_target_id: environment.managed_runtime_target_id } : {}),
        ...(environment.managed_runtime_placement_target_id ? { placement_target_id: environment.managed_runtime_placement_target_id } : {}),
        ...(environment.managed_runtime_host_access ? { host_access: environment.managed_runtime_host_access } : {}),
        ...(environment.managed_runtime_placement ? { placement: environment.managed_runtime_placement } : {}),
      };
    } else if (environment.kind === 'ssh_environment' && environment.ssh_details) {
      request = {
        kind: 'open_ssh_environment',
        environment_id: environment.id,
        label: environment.label,
        ...(environment.managed_runtime_target_id ? { runtime_target_id: environment.managed_runtime_target_id } : {}),
        ...(environment.managed_runtime_placement_target_id ? { placement_target_id: environment.managed_runtime_placement_target_id } : {}),
        ...(environment.managed_runtime_host_access ? { host_access: environment.managed_runtime_host_access } : {}),
        ...(environment.managed_runtime_placement ? { placement: environment.managed_runtime_placement } : {}),
        ssh_destination: environment.ssh_details.ssh_destination,
        ssh_port: environment.ssh_details.ssh_port,
        auth_mode: environment.ssh_details.auth_mode,
        runtime_root: environment.ssh_details.runtime_root,
        bootstrap_strategy: environment.ssh_details.bootstrap_strategy,
        release_base_url: environment.ssh_details.release_base_url,
        connect_timeout_seconds: environment.ssh_details.connect_timeout_seconds,
      };
    }
    if (!request) {
      return {
        opened: false,
        message: i18n().t('environmentCenter.runtimeUnavailableNow'),
      };
    }
    const result = await performLauncherActionSilently(request);
    if (!result.ok) {
      if (result.raw_failure) {
        await handleLauncherActionFailure(
          result.raw_failure,
          'connect',
          environment.id,
          request,
        );
      }
      const recovery = result.failure?.code === 'runtime_update_required'
        ? 'update_runtime' as const
        : result.failure?.code === 'desktop_update_required'
          ? 'update_desktop' as const
          : result.code === 'runtime_not_ready' || result.code === 'runtime_not_started' || result.failure
            ? 'refresh_runtime' as const
            : undefined;
      return {
        opened: false,
        message: result.message,
        ...(recovery ? { recovery } : {}),
        ...(result.operation_key ? { operation_key: result.operation_key } : {}),
      };
    }
    return result.outcome === 'opened_environment_window' || result.outcome === 'focused_environment_window'
      ? { opened: true, message: '' }
      : { opened: false, message: i18n().t('toast.unexpectedLauncherResult') };
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
      && environment.kind !== 'provider_environment'
      && environment.kind !== 'external_local_ui'
    ) {
      // A fresh offline/unknown snapshot is not an instruction to stop. The
      // authoritative open attempt must re-check the target, then route to
      // Start and open, Initialize and open, or Update and open based on the
      // result. Returning a generic "runtime unavailable" here strands old
      // and partially running SSH/container targets without a recovery path.
      const resolution = await runEnvironmentGuidanceAction(environment, {
        intent: 'open_with_preflight',
        label: i18n().t('environmentAction.open'),
        enabled: true,
        variant: 'default',
      });
      return resolution.close_panel;
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

  function bindReinstallOperationResult(
    result: DesktopLauncherActionSuccess | null,
    bindOperation?: (operation: EnvironmentLifecycleAttempt) => void,
  ): void {
    if (
      (result?.outcome !== 'previewed_reinstall_target'
        && result?.outcome !== 'reinstall_target_in_progress')
      || !result.operation_key
      || !result.operation_started_at_unix_ms
    ) {
      return;
    }
    bindOperation?.({
      operation_key: result.operation_key,
      started_at_unix_ms: result.operation_started_at_unix_ms,
    });
  }

  async function triggerLocalEnvironmentAction(
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    attempt?: EnvironmentLifecycleAttempt,
    bindOperation?: (operation: EnvironmentLifecycleAttempt) => void,
  ): Promise<boolean> {
    switch (action.intent) {
      case 'open':
      case 'focus':
        return openEnvironment(
          environment,
          errorTarget === 'settings' ? 'connect' : errorTarget,
          action.route ?? 'auto',
        );
      case 'open_with_preflight':
      case 'initialize_and_open':
      case 'start_and_open':
      case 'request_open_access': {
        const resolution = await runEnvironmentGuidanceAction(environment, action);
        return resolution.close_panel;
      }
      case 'start_runtime':
        return startEnvironmentRuntime(environment, errorTarget, { attempt });
      case 'stop_runtime':
        return stopEnvironmentRuntime(environment, errorTarget, attempt);
      case 'restart_runtime':
        return restartEnvironmentRuntime(environment, errorTarget, attempt);
      case 'update_runtime':
        return updateEnvironmentRuntime(environment, errorTarget, attempt);
      case 'update_desktop': {
        const result = await performLauncherAction(
          {
            kind: 'manage_desktop_update',
            environment_id: environment.id,
            label: environment.label,
          },
          errorTarget,
        );
        if (result?.outcome !== 'opened_desktop_update_handoff') {
          return false;
        }
        showActionToast(
          i18n().t('environmentCenter.desktopUpdateOpenedToast', {
            label: environment.label,
          }),
          'info',
        );
        return true;
      }
      case 'refresh_runtime':
        return refreshEnvironmentRuntime(environment, errorTarget, { attempt });
      case 'reinstall_target':
        if (
          environment.kind !== 'local_environment' &&
          !(
            environment.kind === 'ssh_environment' &&
            environment.managed_runtime_host_access &&
            environment.managed_runtime_placement
          )
        ) {
          return false;
        }
        {
          if (action.operation_key && action.preflight_id) {
            const result = await performLauncherAction(
              {
                kind: 'reinstall_target',
                environment_id: environment.id,
                preflight_id: action.preflight_id,
                operation_key: action.operation_key,
                mode: action.reinstall_mode ?? 'wipe_data',
                impact_acknowledged: true,
              },
              errorTarget,
            );
            bindReinstallOperationResult(result, bindOperation);
            return result?.outcome === 'reinstalled_target' || result?.outcome === 'reinstall_target_in_progress';
          }
          const result = await performLauncherAction(
            {
              kind: 'preview_reinstall_target',
              environment_id: environment.id,
              mode: action.reinstall_mode ?? 'wipe_data',
            },
            errorTarget,
          );
          bindReinstallOperationResult(result, bindOperation);
          return result?.outcome === 'previewed_reinstall_target';
        }
      case 'connect_provider_runtime':
        requestProviderRuntimeLinkConfirmation(environment, 'connect');
        return true;
      case 'disconnect_provider_runtime':
        requestProviderRuntimeLinkConfirmation(environment, 'disconnect');
        return true;
      case 'resolve_gateway':
        if (environment.kind === 'gateway_environment') {
          const gateway = snapshot().gateway_sources.find(
            (source) => source.gateway_id === (environment.gateway_id ?? ''),
          );
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
    updateSession?: (state: EnvironmentGuidanceSessionState) => void,
    attempt?: EnvironmentLifecycleAttempt,
  ): Promise<EnvironmentGuidanceActionResolution> {
    const currentSession = isEnvironmentGuidancePendingIntent(action.intent)
      ? startEnvironmentGuidanceIntent(null, environment.id, action.intent)
      : openEnvironmentGuidanceSession(environment.id);
    const publishSession = (state: EnvironmentGuidanceSessionState): void => {
      updateSession?.(state);
    };
    const failOpenFlow = (
      state: EnvironmentGuidanceSessionState,
      detail: string,
      recovery?: 'update_runtime' | 'update_desktop' | 'refresh_runtime',
    ): EnvironmentGuidanceActionResolution => {
      const nextSession = failEnvironmentGuidanceIntent(state, detail, recovery);
      publishSession(nextSession);
      return { close_panel: false, next_session: nextSession };
    };
    if (
      (environment.kind === 'local_environment' || environment.kind === 'ssh_environment') &&
      (action.intent === 'open_with_preflight' ||
        action.intent === 'initialize_and_open' ||
        action.intent === 'start_and_open')
    ) {
      const checking = advanceEnvironmentOpenFlowStage(currentSession, 'checking_access');
      publishSession(checking);
      const attempted = await attemptEnvironmentOpenSilently(environment);
      if (attempted.opened) {
        return { close_panel: true, next_session: null };
      }
      if (attempted.operation_key) {
        publishSession(null);
        return { close_panel: true, next_session: null };
      }
      return failOpenFlow(
        checking,
        attempted.message || i18n().t('environmentOpenFlow.openFailedDetail'),
        attempted.recovery,
      );
    }
    const startAndOpenEnvironment = async (
      state: EnvironmentGuidanceSessionState,
    ): Promise<EnvironmentGuidanceActionResolution> => {
      const startFlowState =
        state?.pending_intent === 'initialize_and_open'
          ? startEnvironmentGuidanceIntent(state, environment.id, 'start_and_open')
          : state;
      const checking = advanceEnvironmentOpenFlowStage(startFlowState, 'checking_access');
      publishSession(checking);
      const reconciled = await reconcileEnvironmentOpenBeforeLifecycle({
        environment,
        loadLatestEnvironment: loadLatestEnvironmentEntry,
        refreshRuntime: refreshEnvironmentRuntimeSilently,
      });
      const latestBeforeStart = reconciled.environment;
      const refreshedFlow = reconciled.flow;
      if (refreshedFlow === 'direct') {
        const opening = advanceEnvironmentOpenFlowStage(checking, 'opening_workspace');
        publishSession(opening);
        const resolution = await continueEnvironmentOpenAfterLifecycle({
          environment: latestBeforeStart,
          loadLatestEnvironment: loadLatestEnvironmentEntry,
          attemptOpen: attemptEnvironmentOpenSilently,
        });
        if (resolution.kind === 'failed') {
          return failOpenFlow(
            opening,
            resolution.message || i18n().t('environmentOpenFlow.openFailedDetail'),
            resolution.recovery,
          );
        }
        return { close_panel: true, next_session: null };
      }
      if (refreshedFlow === 'request_access') {
        return failOpenFlow(checking, i18n().t('environmentOpenFlow.accessRequiredDetail'));
      }
      const starting = advanceEnvironmentOpenFlowStage(checking, 'starting_environment');
      publishSession(starting);
      const started = await startEnvironmentRuntimeSilently(latestBeforeStart);
      if (!started.ok) {
        return failOpenFlow(starting, started.message);
      }
      const opening = advanceEnvironmentOpenFlowStage(starting, 'opening_workspace');
      publishSession(opening);
      const resolution = await continueEnvironmentOpenAfterLifecycle({
        environment: latestBeforeStart,
        loadLatestEnvironment: loadLatestEnvironmentEntry,
        attemptOpen: attemptEnvironmentOpenSilently,
      });
      if (resolution.kind === 'failed') {
        return failOpenFlow(
          opening,
          resolution.message || i18n().t('environmentOpenFlow.openFailedDetail'),
          resolution.recovery,
        );
      }
      return { close_panel: true, next_session: null };
    };

    if (action.intent === 'open_with_preflight') {
      const resolution = await runEnvironmentOpenPreflight({
        environment,
        attemptOpen: attemptEnvironmentOpenSilently,
        loadLatestEnvironment: loadLatestEnvironmentEntry,
      });
      if (resolution.kind === 'opened') {
        return { close_panel: true, next_session: null };
      }
      if (resolution.kind === 'guidance') {
        const guidanceAction: EnvironmentActionModel = {
          intent:
            resolution.flow === 'initialize'
              ? 'initialize_and_open'
              : resolution.flow === 'start'
                ? 'start_and_open'
                : 'request_open_access',
          label:
            resolution.flow === 'initialize'
              ? i18n().t('environmentAction.initializeAndOpen')
              : resolution.flow === 'start'
                ? i18n().t('environmentAction.startAndOpen')
                : i18n().t('environmentAction.requestAccess'),
          enabled: true,
          variant: 'default',
        };
        return runEnvironmentGuidanceAction(resolution.environment, guidanceAction, updateSession);
      }
      return {
        close_panel: false,
        next_session: failEnvironmentGuidanceIntent(currentSession, resolution.message, resolution.recovery),
      };
    }

    if (action.intent === 'initialize_and_open') {
      const checking = advanceEnvironmentOpenFlowStage(currentSession, 'checking_access');
      publishSession(checking);
      let initializationEnvironment = environment;
      try {
        initializationEnvironment = (await loadLatestEnvironmentEntry(environment.id)) ?? environment;
      } catch (error) {
        return failOpenFlow(
          checking,
          getErrorMessage(error) || i18n().t('environmentOpenFlow.accessUnavailableDetail'),
        );
      }
      const refreshedFlow = environmentOpenFlow(initializationEnvironment);
      if (refreshedFlow === 'request_access') {
        const requestingAccess = startEnvironmentGuidanceIntent(null, environment.id, 'request_open_access');
        return failOpenFlow(requestingAccess, i18n().t('environmentOpenFlow.accessRequiredDetail'));
      }
      if (refreshedFlow === 'start') {
        return startAndOpenEnvironment(checking);
      }
      if (refreshedFlow === 'direct') {
        const opening = advanceEnvironmentOpenFlowStage(
          startEnvironmentGuidanceIntent(checking, environment.id, 'open_with_preflight'),
          'opening_workspace',
        );
        publishSession(opening);
        const resolution = await continueEnvironmentOpenAfterLifecycle({
          environment: initializationEnvironment,
          loadLatestEnvironment: loadLatestEnvironmentEntry,
          attemptOpen: attemptEnvironmentOpenSilently,
        });
        return resolution.kind === 'opened'
          ? { close_panel: true, next_session: null }
          : failOpenFlow(
              opening,
              resolution.message || i18n().t('environmentOpenFlow.openFailedDetail'),
              resolution.recovery,
            );
      }
      const requestingAccess = startEnvironmentGuidanceIntent(null, environment.id, 'request_open_access');
      return failOpenFlow(
        initializationEnvironment.kind === 'provider_environment' ? requestingAccess : checking,
        i18n().t('environmentOpenFlow.accessUnavailableDetail'),
      );
    }

    if (action.intent === 'start_and_open') {
      const checking = advanceEnvironmentOpenFlowStage(currentSession, 'checking_access');
      publishSession(checking);
      return startAndOpenEnvironment(checking);
    }

    if (action.intent === 'request_open_access') {
      if (environment.kind === 'provider_environment' && environment.provider_origin) {
        const result = await performLauncherAction(
          {
            kind: 'start_control_plane_connect',
            provider_origin: environment.provider_origin,
            display_label: environment.label,
          },
          'connect',
        );
        return {
          close_panel: result?.outcome === 'started_control_plane_connect',
          next_session:
            result?.outcome === 'started_control_plane_connect'
              ? null
              : failEnvironmentGuidanceIntent(
                  currentSession,
                  'Redeven could not request access to this environment. Try again.',
                ),
        };
      }
      if (environment.kind === 'gateway_environment') {
        const gateway = snapshot().gateway_sources.find(
          (source) => source.gateway_id === (environment.gateway_id ?? ''),
        );
        if (gateway) {
          openCreateGatewaySetup(gateway);
          return { close_panel: true, next_session: null };
        }
      }
      return failOpenFlow(
        currentSession,
        'Access is not available for this environment yet. Check the connection and try again.',
      );
    }

    if (
      action.intent === 'start_runtime' ||
      action.intent === 'stop_runtime' ||
      action.intent === 'restart_runtime' ||
      action.intent === 'update_runtime'
    ) {
      if (action.continue_open_after_completion) {
        return runEnvironmentGuidanceAction(
          environment,
          {
            intent: 'open_with_preflight',
            label: i18n().t('environmentAction.open'),
            enabled: true,
            variant: 'default',
          },
          updateSession,
        );
      }
      const completed = await triggerLocalEnvironmentAction(environment, action, 'connect', attempt);
      return {
        close_panel: completed,
        next_session: null,
      };
    }

    if (action.intent === 'refresh_runtime') {
      const request = runtimeActionRequest(environment, 'refresh_environment_runtime');
      if (!request) {
        return {
          close_panel: false,
          next_session: failEnvironmentGuidanceIntent(currentSession, 'Desktop could not resolve that runtime target.'),
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

    const completed = await triggerLocalEnvironmentAction(environment, action, 'connect', attempt);
    return {
      close_panel: completed,
      next_session: completed
        ? null
        : failEnvironmentGuidanceIntent(currentSession, `Desktop could not complete "${action.label}".`),
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
      display_label: 'Redeven Cloud',
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
      display_label: 'Redeven Cloud',
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
      showActionToast(
        i18n().t('toast.refreshedControlPlane', {
          label: controlPlaneName(controlPlane),
        }),
      );
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

  function applyAccessFixedPort(
    portText: string,
    accessMode: Exclude<DesktopAccessMode, 'custom_exposure'>,
  ): void {
    updateSettingsDraft((current) => applyDesktopAccessFixedPortToDraft(current, portText, accessMode));
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

	async function saveSettings(options: Readonly<{
		restartRuntime?: boolean;
  }> = {}): Promise<void> {
    setSettingsError('');
    const restartEnvironment = options.restartRuntime ? selectedSettingsEnvironmentEntry() : null;
    if (options.restartRuntime && restartEnvironment?.kind !== 'local_environment') {
      setSettingsError(i18n().t('environmentCenter.resolveRuntimeTargetError'));
      return;
    }
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
      showActionToast(i18n().t('toast.settingsSaved'));
      cancelSettings();
      if (restartEnvironment?.kind === 'local_environment') {
        await restartEnvironmentRuntime(restartEnvironment, 'connect');
      }
      try {
        const nextSnapshot = await refreshSnapshot();
        setSettingsDraftSession(createDesktopSettingsDraftSession(nextSnapshot.settings_surface));
      } catch (error) {
        showActionToast(getErrorMessage(error) || i18n().t('toast.actionFailedFallback'), 'error');
      }
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
      const result = await performLauncherAction({
        kind: 'upsert_environment_registration',
        registration: {
            registration_ref: {
              kind: 'saved_environment',
              id: trimString(request.environment_id),
            },
          label: trimString(request.label),
          external_local_ui_url: normalizedTargetURL,
          auto_runtime_probe_enabled: request.autoRuntimeProbeEnabled,
        },
      }, request.errorTarget);
      if (result?.outcome !== 'saved_environment') return false;
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

  async function upsertSSHRuntimeTarget(
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
      const result = await performLauncherAction({
        kind: 'upsert_environment_registration',
        registration: {
          registration_ref: { kind: 'runtime_target', id: trimString(request.environment_id) as DesktopRuntimeTargetID },
          label: trimString(request.label),
          host_access: {
          kind: 'ssh_host',
          ssh: {
            ssh_destination: request.details.ssh_destination,
            ssh_port: request.details.ssh_port,
            auth_mode: request.details.auth_mode,
            connect_timeout_seconds: request.details.connect_timeout_seconds,
          },
        },
          placement: {
          kind: 'host_process',
          runtime_root: request.details.runtime_root,
          bootstrap_strategy: request.details.bootstrap_strategy,
          release_base_url: request.details.release_base_url,
        },
          ssh_password: request.sshPassword,
          ssh_password_mode: request.sshPasswordMode,
          auto_runtime_probe_enabled: request.autoRuntimeProbeEnabled,
        },
      }, request.errorTarget);
      if (result?.outcome !== 'saved_environment') return false;
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
      const result = await performLauncherAction({
        kind: 'upsert_environment_registration',
        registration: {
          registration_ref: { kind: 'runtime_target', id: trimString(request.environment_id) as DesktopRuntimeTargetID },
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
        },
      }, request.errorTarget);
      if (result?.outcome !== 'saved_environment') return false;
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

  async function upsertGatewayEnvironmentProfile(
    request: Readonly<{
      gateway_id: string;
      gateway_env_id?: string;
      label: string;
      access_route: DesktopGatewayEnvironmentProfileAccessRoute;
      errorTarget: 'connect' | 'dialog';
      successMessage: string;
    }>,
  ): Promise<boolean> {
    const gatewayID = trimString(request.gateway_id);
    if (!gatewayID) {
      setErrorMessage(request.errorTarget, i18n().t('connectionDialog.validationGatewayRequired'));
      return false;
    }
    setConnectionDialogError('');
    const result = await performLauncherAction({
      kind: 'upsert_environment_registration',
      registration: {
        registration_ref: {
          kind: 'gateway_environment',
          gateway_id: gatewayID,
          gateway_env_id: trimString(request.gateway_env_id),
        },
        display_name: trimString(request.label),
        access_route: request.access_route,
      },
    }, request.errorTarget);
    if (result?.outcome !== 'saved_gateway_environment') {
      return false;
    }
    await refreshSnapshot();
    showActionToast(request.successMessage);
    return true;
  }

  function validateGatewaySetupDialogFields(state: GatewaySetupDialogState): Partial<Record<string, string>> {
    const errors: Partial<Record<string, string>> = {};
    if (state.connection_kind !== 'url') {
      errors.connection_kind = i18n().t('connectionDialog.gatewayUrlHelp');
      return errors;
    }
    if (!trimString(state.display_name) && !suggestGatewayDisplayName(state)) {
      errors.display_name = i18n().t('connectionDialog.validationGatewayNameRequired');
    }
    if (state.connection_kind === 'url' && !trimString(state.gateway_url)) {
      errors.gateway_url = i18n().t('connectionDialog.validationGatewayUrlRequired');
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
    const base = {
      kind: 'upsert_gateway',
      gateway_id: trimString(state.gateway_id) || undefined,
      display_name: displayName,
    } as const;
    const action: DesktopLauncherActionRequest = {
      ...base,
      connection_kind: 'url',
      gateway_url: trimString(state.gateway_url),
      pairing_code: trimString(state.pairing_code) || undefined,
      allow_loopback_http: state.allow_loopback_http,
    };
    const result = await performLauncherAction(action, 'gateway_dialog');
    if (result?.outcome === 'saved_gateway') {
      await refreshSnapshot();
      closeGatewaySetupDialog();
      showActionToast(i18n().t('toast.gatewaySaved'));
    }
  }

  async function runGatewayLauncherAction(request: DesktopLauncherActionRequest): Promise<void> {
    const result = await performLauncherAction(request);
    if (!result) {
      return;
    }
    await refreshSnapshot();
    switch (result.outcome) {
      case 'paired_gateway':
        showActionToast(i18n().t('toast.gatewayPaired'));
        break;
      case 'synced_gateway':
        showActionToast(i18n().t('toast.gatewaySynced'));
        break;
      case 'enabled_gateway':
        showActionToast(i18n().t('toast.gatewayEnabled'));
        break;
      case 'disabled_gateway':
        showActionToast(i18n().t('toast.gatewayDisabled'), 'info');
        break;
      case 'started_gateway':
        showActionToast(i18n().t('toast.gatewayStarted'));
        break;
      case 'stopped_gateway':
        showActionToast(i18n().t('toast.gatewayStopped'), 'info');
        break;
      case 'restarted_gateway':
        showActionToast(i18n().t('toast.gatewayRestarted'));
        break;
      case 'updated_gateway':
        showActionToast(i18n().t('toast.gatewayUpdated'));
        break;
      case 'refreshed_gateway':
        showActionToast(i18n().t('toast.gatewaySynced'));
        break;
      case 'refreshed_gateway_catalog':
        showActionToast(i18n().t('toast.gatewayCatalogRefreshed'), 'info');
        break;
      case 'refreshed_gateway_status':
        showActionToast(i18n().t('toast.gatewayStatusRefreshed'), 'info');
        break;
      default:
        break;
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
    if (state?.connection_kind === 'gateway_url_profile') {
      if (!trimString(state.gateway_id)) {
        errors.gateway_id = i18n().t('connectionDialog.validationGatewayRequired');
      }
      if (!trimString(state.target_url)) {
        errors.target_url = i18n().t('connectionDialog.validationGatewayTargetUrlRequired');
      } else if (desktopGatewayProfileURLHasEmbeddedCredentials(state.target_url)) {
        errors.target_url = i18n().t('connectionDialog.validationGatewayTargetUrlCredentialsUnsupported');
      }
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

  function gatewayEnvironmentProfileAccessRouteFromState(state: GatewayURLProfileConnectionDialogState): DesktopGatewayEnvironmentProfileAccessRoute {
    return {
      kind: 'url',
      url: trimString(state.target_url),
      ...(trimString(state.origin_label) ? { origin_label: trimString(state.origin_label) } : {}),
    };
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
      saved = await upsertSSHRuntimeTarget({
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
    } else if (state.connection_kind === 'gateway_url_profile') {
      saved = await upsertGatewayEnvironmentProfile({
        gateway_id: state.gateway_id,
        gateway_env_id: state.mode === 'edit' ? state.environment_id : '',
        label: state.label,
        access_route: gatewayEnvironmentProfileAccessRouteFromState(state),
        errorTarget: 'dialog',
        successMessage: i18n().t('toast.gatewayEnvironmentSaved'),
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
    if (!environment.registration_ref) {
      setErrorMessage('connect', i18n().t('environmentCenter.environmentRegistrationUnavailable'));
      return;
    }
    const result = await performLauncherAction({
      kind: 'set_environment_registration_pinned',
      registration_ref: environment.registration_ref,
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
    const hadBackgroundOperation = deleteTargetOperation() !== null;
    const registrationRef = target.registration_ref;
    const removedDefaultWSLEnvironment = target.kind === 'wsl_environment'
      && registrationRef?.kind === 'runtime_target'
      && snapshot().default_flower_runtime_target_id === target.id;
    setBusyState({
      action: 'delete_environment',
      environment_id: target.id,
      provider_origin: '',
      provider_id: '',
      gateway_id: registrationRef?.kind === 'gateway_environment' ? registrationRef.gateway_id : '',
      request_started_at_unix_ms: Date.now(),
      progress: null,
    });
    try {
      let deleteResult: Awaited<ReturnType<typeof props.runtime.launcher.performAction>> | null = null;
      if (!registrationRef || registrationRef.kind === 'local_environment') {
        throw new Error(i18n().t('environmentCenter.environmentRegistrationUnavailable'));
      }
      deleteResult = await props.runtime.launcher.performAction({
        kind: 'delete_environment_registration',
        registration_ref: registrationRef,
      });
      if (!deleteResult || !deleteResult.ok || (deleteResult.outcome !== 'deleted_environment' && deleteResult.outcome !== 'deleted_gateway_environment')) {
        throw new Error(deleteResult && !deleteResult.ok ? deleteResult.message : i18n().t('environmentCenter.environmentRegistrationUnavailable'));
      }
      await refreshSnapshot();
      setDeleteTarget(null);
      showActionToast(
        registrationRef.kind === 'gateway_environment'
          ? i18n().t('environmentCenter.gatewayEnvironmentRemoved')
          : removedDefaultWSLEnvironment
            ? i18n().t('environmentCenter.wslDefaultRemoved')
          : hadBackgroundOperation
            ? i18n().t('environmentCenter.environmentRemovedCleanup')
            : i18n().t('environmentCenter.environmentRemoved'),
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

  async function deleteGateway(): Promise<void> {
    const target = deleteGatewayTarget();
    if (!target) {
      return;
    }
    const result = await performLauncherAction({
      kind: 'delete_gateway',
      gateway_id: target.gateway_id,
    });
    if (result?.outcome === 'deleted_gateway') {
      setDeleteGatewayTarget(null);
      showActionToast(i18n().t('environmentCenter.gatewayRemoved'), 'info');
    }
  }

  async function openFlowerSurface(): Promise<void> {
    await performLauncherAction({
      kind: 'open_flower',
    });
  }

  function buildEnvironmentFlowerTurnLauncherIntent(environment: DesktopEnvironmentEntry): FlowerTurnLauncherIntent {
    const cleanLabel = trimString(environment.label) || i18n().t('environmentCenter.thisEnvironment');
    const contextSummary = environmentFlowerContextSummary(i18n(), environment);
    return {
      id: `welcome-flower-${trimString(environment.id) || 'environment'}-${Date.now()}`,
      source_surface: 'desktop_welcome_environment_card',
      suggested_working_dir: '',
      context_items: [{
        kind: 'environment',
        label: cleanLabel,
        detail: contextSummary,
        target_id: environmentFlowerPrimaryTargetID(environment),
      }],
      notes: [],
      context_action: buildEnvironmentFlowerContextAction(environment, contextSummary, cleanLabel),
    };
  }

  function openEnvironmentFlowerSurface(
    environment: DesktopEnvironmentEntry,
    anchor?: FlowerTurnLauncherAnchor,
  ): void {
    setFlowerTurnLauncherIntent(buildEnvironmentFlowerTurnLauncherIntent(environment));
    setFlowerTurnLauncherAnchor(anchor ?? null);
    setFlowerTurnLauncherOpen(true);
  }

  function closeFlowerTurnLauncher(): void {
    setFlowerTurnLauncherOpen(false);
    setFlowerTurnLauncherIntent(null);
    setFlowerTurnLauncherAnchor(null);
  }

  async function submitFlowerTurnLauncher(input: FlowerTurnLauncherSubmitInput): Promise<void> {
    const prompt = trimString(input.prompt);
    if (!prompt) {
      throw new Error(i18n().t('environmentCenter.askFlowerCardNoMessage'));
    }
    const receipt = await launchLocalEnvironmentFlowerTurn(props.runtime.settings, {
      client_request_id: input.client_request_id,
      prompt,
      context_action: input.intent.context_action,
      working_dir: input.intent.suggested_working_dir,
    });
    const threadID = trimString(receipt.thread_id);
    if (!threadID) {
      throw new Error('Missing thread id.');
    }
    flowerFocusThreadRequestSequence += 1;
    setFlowerFocusThreadRequest({
      request_id: `welcome-flower-focus-${flowerFocusThreadRequestSequence}`,
      thread_id: threadID,
    });
    closeFlowerTurnLauncher();
    await openFlowerSurface();
  }

  async function openEnvironmentCenterSurface(): Promise<void> {
    await performLauncherAction({
      kind: 'open_environment_center',
    });
  }

  const topBarLogoLabel = () => (
    snapshot().surface === 'flower'
      ? i18n().t('shell.backToEnvironments')
      : i18n().t('shell.openRedevenDashboard')
  );
  const deleteTargetIsGatewayEnvironment = createMemo(() => deleteTarget()?.kind === 'gateway_environment');
  const activateTopBarLogo = () => {
    if (snapshot().surface === 'flower') {
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
        openThemePicker={() => setThemePickerOpenRequest((current) => current + 1)}
        checkForUpdates={checkForDesktopUpdates}
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
            <Show when={snapshot().surface === 'flower'}>
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
            <Show when={snapshot().surface !== 'flower'}>
              <button
                type="button"
                class="redeven-flower-topbar-button"
                aria-label={i18n().t('flowerSurface.chat.entryLabel')}
                title={i18n().t('flowerSurface.chat.entryLabel')}
                onClick={() => void openFlowerSurface()}
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
            <DesktopThemePicker
              openRequest={themePickerOpenRequest()}
              snapshot={themeSnapshot()}
              i18n={i18n()}
              onSourceChange={updateDesktopThemeSource}
              onShellThemeChange={updateDesktopShellTheme}
            />
          </div>
        )}
        topBarCornerActions={(
          <button
            type="button"
            class="redeven-desktop-update-button"
            data-update-state={desktopUpdateSnapshot().state}
            aria-label={i18n().t('desktopUpdate.statusButton', {
              status: desktopUpdateStatusLabel(i18n(), desktopUpdateSnapshot()),
            })}
            title={i18n().t('desktopUpdate.statusButton', {
              status: desktopUpdateStatusLabel(i18n(), desktopUpdateSnapshot()),
            })}
            onClick={checkForDesktopUpdates}
          >
            <Refresh
              class={cn(
                'h-3.5 w-3.5 shrink-0',
                desktopUpdateSnapshot().state === 'checking' ? 'animate-spin' : '',
              )}
            />
            <span>{i18n().t('desktopUpdate.checkForUpdates')}</span>
            <Show when={desktopUpdateSnapshot().state === 'available' || desktopUpdateSnapshot().state === 'ready'}>
              <span class="redeven-desktop-update-button__indicator" aria-hidden="true" />
            </Show>
          </button>
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
              <span class="flex shrink-0 items-center gap-1 text-[10px] font-medium text-warning">
                <span class="h-2 w-2 shrink-0 border border-warning bg-warning/10" />
                <span class="truncate max-w-[200px]">{localizedIssueTitle(i18n(), snapshot().issue!)}</span>
              </span>
            </Show>
            <BottomBarItem class="cursor-pointer" onClick={openDesktopUpdates}>
              <span
                class={cn(
                  'text-[11px]',
                  desktopUpdateSnapshot().state === 'available' || desktopUpdateSnapshot().state === 'ready'
                    ? 'text-primary'
                    : desktopUpdateSnapshot().state === 'error'
                      ? 'text-destructive'
                      : '',
                )}
                aria-label={i18n().t('desktopUpdate.statusButton', {
                  status: desktopUpdateStatusLabel(i18n(), desktopUpdateSnapshot()),
                })}
              >
                {i18n().t('desktopUpdate.title')}
              </span>
            </BottomBarItem>
            {/* Close / Quit */}
            <BottomBarItem class="cursor-pointer" onClick={() => void closeLauncherOrQuit()}>
              <span class="text-[11px]">{localizedCloseActionLabel(i18n(), snapshot().close_action)}</span>
            </BottomBarItem>
          </div>
        )}
      >
        <Show
          when={snapshot().surface === 'flower'}
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
              lifecycleProgressFocusRequest={lifecycleProgressFocusRequest()}
              consumeLifecycleProgressFocusRequest={(requestID) => {
                setLifecycleProgressFocusRequest((current) => (
                  current?.request_id === requestID ? null : current
                ));
              }}
              setLibrarySourceFilter={setLibrarySourceFilter}
              setLibraryQuery={setLibraryQuery}
              setGatewaySourceFilter={setGatewaySourceFilter}
              setGatewayQuery={setGatewayQuery}
              runEnvironmentCardFactAction={runEnvironmentCardFactAction}
              openLocalEnvironment={openPrimaryLocalEnvironment}
              openSettingsSurface={openSettingsSurface}
              openCreateConnectionDialog={openCreateConnectionDialog}
              openCreateGatewaySetup={openCreateGatewaySetup}
              runGatewayLauncherAction={runGatewayLauncherAction}
              openCreateGatewayEnvironment={(gateway) => {
                setActiveCenterTab('environments');
                openCreateConnectionDialog('', 'gateway_url_profile');
                setConnectionDialogState((current) => {
                  if (current?.connection_kind !== 'gateway_url_profile') {
                    return current;
                  }
                  return {
                    ...current,
                    gateway_id: gateway.gateway_id,
                  };
                });
              }}
              openCreateControlPlaneDialog={openCreateControlPlaneDialog}
              refreshAllEnvironmentRuntimes={refreshAllEnvironmentRuntimes}
              refreshWSLDiscovery={refreshWSLDiscovery}
              registerWSLDistribution={registerWSLDistribution}
              setDefaultWSLEnvironment={setDefaultWSLEnvironment}
              openRemoteEnvironment={openRemoteEnvironment}
              openSSHEnvironment={openSSHEnvironment}
              openEnvironment={openEnvironment}
              runLocalEnvironmentAction={triggerLocalEnvironmentAction}
              refreshEnvironmentRuntime={refreshEnvironmentRuntime}
              openEnvironmentFlowerSurface={openEnvironmentFlowerSurface}
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
              viewGatewayEnvironments={focusGatewayEnvironments}
              reconnectControlPlane={reconnectControlPlane}
              refreshControlPlane={refreshControlPlane}
              deleteControlPlane={setDeleteControlPlaneTarget}
              deleteGateway={setDeleteGatewayTarget}
            />
          )}
        >
          <FlowerSurface
            draftCoordinator={flowerDraftCoordinator}
            filesystemScopeKey={flowerFilesystemScopeKey()}
            adapter={createLocalEnvironmentFlowerSurfaceAdapter(props.runtime.settings, {
              runtimeDisplayName: i18n().t('flowerSurface.runtime.localEnvironment'),
              runtimeSubtitle: i18n().t('flowerSurface.runtime.subtitle'),
              onSettingsChanged: refreshSnapshot,
            })}
            notify={(notice) => {
              showActionToast(notice.message, notice.tone, {
                ...(notice.title ? { title: notice.title } : {}),
              });
            }}
            copy={createDesktopFlowerSurfaceCopy(i18n())}
            warmup={flowerWarmupState()}
            settingsFocusRequest={snapshot().flower_settings_focus_revision}
            focusThreadRequest={flowerFocusThreadRequest()}
            sidebarLeadingAction={(
              <button
                type="button"
                class="flower-sidebar-leading-action"
                aria-label={i18n().t('shell.backToEnvironments')}
                title={i18n().t('shell.backToEnvironments')}
                onClick={() => void openEnvironmentCenterSurface()}
              >
                <ArrowLeft class="h-4 w-4" />
              </button>
            )}
            onFocusThreadRequestConsumed={(requestID) => {
              setFlowerFocusThreadRequest((current) => (
                current?.request_id === requestID ? null : current
              ));
            }}
          />
        </Show>
      </DesktopLauncherShell>

      <FlowerTurnLauncherWindow
        open={flowerTurnLauncherOpen()}
        intent={flowerTurnLauncherIntent()}
        anchor={flowerTurnLauncherAnchor()}
        copy={{
          window_title: i18n().t('environmentCenter.askFlowerCardTitle'),
          linked_context_label: i18n().t('environmentCenter.askFlowerCardContextLabel'),
          working_dir_label: i18n().t('flowerSurface.threadList.workingDirectoryLabel'),
          working_directory_unavailable: i18n().t('environmentCenter.askFlowerWorkingDirectoryUnavailable'),
          ready: i18n().t('flowerSurface.chat.ready'),
          close: i18n().t('flowerSurface.threadList.cancel'),
          sending: i18n().t('environmentCenter.askFlowerCardSending'),
          you_label: i18n().t('environmentCenter.askFlowerCardPromptLabel'),
          reply_to_flower_label: i18n().t('environmentCenter.askFlowerCardReplyHint'),
          send_turn: i18n().t('environmentCenter.askFlowerCardSend'),
          empty_message: i18n().t('environmentCenter.askFlowerCardNoMessage'),
          launch_failed_title: i18n().t('environmentCenter.askFlowerCardLaunchFailedTitle'),
          launch_unknown_title: i18n().t('environmentCenter.askFlowerCardAdmissionUnknownTitle'),
          prompt: {
            environment_question: i18n().t('environmentCenter.askFlowerLauncherQuestion'),
            environment_placeholder: i18n().t('environmentCenter.askFlowerLauncherPlaceholder'),
          },
        }}
        onClose={closeFlowerTurnLauncher}
        onSubmit={submitFlowerTurnLauncher}
      />

      <DesktopActionToastViewport
        i18n={i18n()}
        toasts={actionToasts()}
        dismissToast={dismissActionToast}
        runToastAction={runActionToastAction}
      />

      <DesktopUpdateDialog
        open={desktopUpdateDialogOpen()}
        snapshot={desktopUpdateSnapshot()}
        i18n={i18n()}
        onOpenChange={setDesktopUpdateDialogOpen}
        perform={performDesktopUpdateAction}
      />

      <LocalEnvironmentSettingsDialog
        open={snapshot().surface === 'environment_settings'}
        snapshot={settingsSurface()}
        baselineSnapshot={settingsBaselineSurface()}
        draft={draft()}
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
        runtimeRestartAvailable={settingsRuntimeRestartAvailable()}
        runtimeRunning={settingsRuntimePresentation().running}
        runtimeStatusLabel={settingsRuntimePresentation().statusLabel}
        runtimeStatusTone={settingsRuntimePresentation().statusTone}
        dark={theme.resolvedTheme() === 'dark'}
        cancelSettings={cancelSettings}
        clearStoredLocalUIPassword={clearStoredLocalUIPassword}
      />

      <ConnectionDialog
        i18n={i18n()}
        nativeContainerRuntime={snapshot().platform_capabilities.native_container_runtime}
        state={connectionDialogState()}
        sshConfigHosts={sshConfigHosts()}
        sshConfigHostsLoading={sshConfigHostsLoading()}
        sshConfigHostsLoadError={sshConfigHostsLoadError()}
        containerOptions={runtimeContainerOptions()}
        containerOptionsLoading={runtimeContainerOptionsLoading()}
        containerOptionsError={runtimeContainerOptionsError()}
        error={connectionDialogError()}
        fieldErrors={connectionDialogFieldErrors()}
        busyState={busyState()}
        gatewayProfileSources={writableGatewayProfileSources()}
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
        refreshSSHConfigHosts={() => {
          void refreshSSHConfigHosts();
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
        sshConfigHostsLoading={sshConfigHostsLoading()}
        sshConfigHostsLoadError={sshConfigHostsLoadError()}
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
        refreshSSHConfigHosts={() => {
          void refreshSSHConfigHosts();
        }}
        clearFieldErrors={() => setGatewaySetupDialogFieldErrors({})}
        removeSSHPassword={removeSSHPasswordFromGatewaySetupDialog}
        onSave={saveGatewayFromDialog}
      />

      <ControlPlaneDialog
        i18n={i18n()}
        logoSrc={headerLogoSrc()}
        providerOptions={controlPlaneProviderPresets()}
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
        title={deleteTargetIsGatewayEnvironment() ? i18n().t('confirm.deleteGatewayEnvironmentTitle') : i18n().t('confirm.removeEnvironmentTitle')}
        confirmText={deleteTargetIsGatewayEnvironment() ? i18n().t('confirm.deleteGatewayEnvironmentConfirm') : i18n().t('confirm.removeEnvironmentConfirm')}
        variant="destructive"
        loading={busyStateMatchesAction(busyState(), 'delete_environment')}
        onConfirm={() => void deleteEnvironment()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            {deleteTargetIsGatewayEnvironment()
              ? i18n().t('confirm.deleteGatewayEnvironmentQuestion', {
                  label: deleteTarget()?.label ?? '',
                  gateway: deleteTarget()?.gateway_label ?? i18n().t('environmentCenter.thisGateway'),
                })
              : i18n().t('confirm.removeEnvironmentQuestion', {
                  label: deleteTarget()?.label ?? '',
                })}
          </p>
          <p class="text-xs text-muted-foreground">
            <Show
              when={deleteTargetOperation()}
              fallback={<>{deleteTargetIsGatewayEnvironment() ? i18n().t('confirm.deleteGatewayEnvironmentDescription') : i18n().t('confirm.removeEnvironmentDescription')}</>}
            >
              <>{deleteTargetIsGatewayEnvironment() ? i18n().t('confirm.deleteGatewayEnvironmentBusyDescription') : i18n().t('confirm.removeEnvironmentBusyDescription')}</>
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
        open={deleteGatewayTarget() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGatewayTarget(null);
          }
        }}
        title={i18n().t('confirm.deleteGatewayTitle')}
        confirmText={i18n().t('confirm.deleteGatewayConfirm')}
        variant="destructive"
        loading={busyStateMatchesAction(busyState(), 'delete_gateway')}
        onConfirm={() => void deleteGateway()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            {i18n().t('confirm.deleteGatewayQuestion', {
              label: deleteGatewayTarget()?.display_name ?? '',
            })}
          </p>
          <p class="text-xs text-muted-foreground">
            {i18n().t('confirm.deleteGatewayDescription')}
          </p>
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

function wslVersionRepairCommand(distribution: DesktopWSLDistribution): string {
  const escapedName = distribution.distribution_name.replace(/'/gu, "''");
  return `wsl.exe --set-version '${escapedName}' 2`;
}

function WSLDiscoveryPanel(props: Readonly<{
  i18n: DesktopI18n;
  snapshot: DesktopWelcomeSnapshot;
  refresh: () => Promise<DesktopWSLDiscoverySnapshot>;
  register: (request: DesktopWSLRegisterRequest) => Promise<DesktopWSLActionResponse>;
  setDefault: (request: DesktopWSLSetDefaultRequest) => Promise<DesktopWSLActionResponse>;
}>) {
  const [busyKey, setBusyKey] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [messageTone, setMessageTone] = createSignal<'neutral' | 'error'>('neutral');
  const discovery = createMemo(() => props.snapshot.wsl_discovery);
  const missingRegisteredEnvironments = createMemo(() => {
    const snapshot = discovery();
    if (snapshot?.availability !== 'ready') return [];
    const discoveredNames = new Set(snapshot.distributions.map((distribution) => distribution.distribution_name));
    return props.snapshot.environments.filter((environment) => (
      environment.kind === 'wsl_environment'
      && environment.managed_runtime_host_access?.kind === 'wsl_host'
      && !discoveredNames.has(environment.managed_runtime_host_access.distribution_name)
    ));
  });
  const registeredEnvironment = (distributionName: string): DesktopEnvironmentEntry | undefined => (
    props.snapshot.environments.find((environment) => (
      environment.kind === 'wsl_environment'
      && environment.managed_runtime_host_access?.kind === 'wsl_host'
      && environment.managed_runtime_host_access.distribution_name === distributionName
    ))
  );
  const run = async (key: string, action: () => Promise<DesktopWSLActionResponse | DesktopWSLDiscoverySnapshot>) => {
    setBusyKey(key);
    setMessage('');
    try {
      const result = await action();
      if ('ok' in result) {
        setMessage(result.message_key
          ? props.i18n.t(result.message_key, result.message_params)
          : result.message);
        setMessageTone(result.ok ? 'neutral' : 'error');
      }
    } catch (error) {
      setMessage(getErrorMessage(error));
      setMessageTone('error');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <section class="rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-foreground">{props.i18n.t('environmentCenter.wslDiscoveredTitle')}</h2>
            <Tag variant="neutral" tone="soft" size="sm">WSL 2</Tag>
          </div>
          <p class="text-xs leading-5 text-muted-foreground">{props.i18n.t('environmentCenter.wslDiscoveredDescription')}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busyKey() !== ''}
          onClick={() => void run('refresh', async () => props.refresh())}
        >
          <Refresh class={cn('mr-1 h-3.5 w-3.5', busyKey() === 'refresh' && 'animate-spin')} />
          {props.i18n.t('environmentCenter.wslRefresh')}
        </Button>
      </div>

      <Show when={message() !== ''}>
        <div class={cn(
          'mt-3 rounded-md border px-3 py-2 text-xs leading-5',
          messageTone() === 'error'
            ? 'border-destructive/25 bg-destructive/10 text-destructive'
            : 'border-border/70 bg-muted/25 text-muted-foreground',
        )}>
          {message()}
        </div>
      </Show>

      <Show when={discovery()?.availability === 'wsl_missing'}>
        <div class="mt-3 rounded-md border border-warning/25 bg-warning/10 p-3">
          <div class="text-sm font-medium text-foreground">{props.i18n.t('environmentCenter.wslMissingTitle')}</div>
          <div class="mt-1 text-xs leading-5 text-muted-foreground">{props.i18n.t('environmentCenter.wslMissingDescription')}</div>
          <code class="mt-2 block rounded bg-background/80 px-2.5 py-2 text-xs text-foreground">wsl.exe --install</code>
        </div>
      </Show>
      <Show when={discovery()?.availability === 'no_distributions'}>
        <div class="mt-3 rounded-md border border-border/70 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
          {props.i18n.t('environmentCenter.wslNoDistributions')}
        </div>
      </Show>
      <Show when={discovery()?.availability === 'failed'}>
        <div class="mt-3 rounded-md border border-destructive/25 bg-destructive/10 p-3 text-xs leading-5 text-destructive">
          <div>{props.i18n.t('environmentCenter.wslDiscoveryFailed')}</div>
          <Show when={discovery()?.message}>
            {(detail) => <code class="mt-2 block whitespace-pre-wrap text-[11px]">{detail()}</code>}
          </Show>
        </div>
      </Show>

      <Show when={missingRegisteredEnvironments().length > 0}>
        <div class="mt-3 space-y-2">
          <For each={missingRegisteredEnvironments()}>
            {(environment) => (
              <div class="rounded-md border border-warning/25 bg-warning/10 p-3">
                <div class="text-sm font-medium text-foreground">{environment.label}</div>
                <div class="mt-1 text-xs leading-5 text-muted-foreground">
                  {props.i18n.t('environmentCenter.wslDistributionMissing', {
                    distribution: environment.managed_runtime_host_access?.kind === 'wsl_host'
                      ? environment.managed_runtime_host_access.distribution_name
                      : environment.label,
                  })}
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={(discovery()?.distributions.length ?? 0) > 0}>
        <div class="mt-3 grid gap-2 lg:grid-cols-2">
          <For each={discovery()?.distributions ?? []}>
            {(distribution) => {
              const registered = createMemo(() => registeredEnvironment(distribution.distribution_name));
              const targetID = createMemo(() => registered()?.id ?? '');
              const isDefault = createMemo(() => (
                targetID() !== '' && props.snapshot.default_flower_runtime_target_id === targetID()
              ));
              const actionKey = createMemo(() => `register:${distribution.distribution_name}`);
              const defaultKey = createMemo(() => `default:${distribution.distribution_name}`);
              return (
                <div class="rounded-md border border-border/70 bg-background/70 p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-semibold text-foreground">{distribution.distribution_name}</div>
                      <div class="mt-1 flex flex-wrap items-center gap-1.5">
                        <Tag variant={distribution.state === 'running' ? 'success' : 'neutral'} tone="soft" size="sm">
                          {distribution.state === 'running'
                            ? props.i18n.t('environmentCenter.wslRunning')
                            : props.i18n.t('environmentCenter.wslStopped')}
                        </Tag>
                        <Show when={registered()}>
                          <Tag variant="primary" tone="soft" size="sm">{props.i18n.t('environmentCenter.wslRegistered')}</Tag>
                        </Show>
                        <Show when={isDefault()}>
                          <Tag variant="success" tone="soft" size="sm">{props.i18n.t('environmentCenter.wslDefaultFlower')}</Tag>
                        </Show>
                      </div>
                    </div>
                    <Show
                      when={distribution.registration_status === 'eligible'}
                      fallback={<Tag variant="warning" tone="soft" size="sm">{distribution.wsl_version === 1 ? 'WSL 1' : '?'}</Tag>}
                    >
                      <Tag variant="neutral" tone="soft" size="sm">WSL 2</Tag>
                    </Show>
                  </div>

                  <Show when={distribution.registration_status !== 'eligible'}>
                    <div class="mt-3 text-xs leading-5 text-muted-foreground">
                      {distribution.registration_status === 'wsl1_unsupported'
                        ? props.i18n.t('environmentCenter.wsl1Unsupported')
                        : props.i18n.t('environmentCenter.wslVersionUnknown')}
                    </div>
                    <code class="mt-2 block overflow-x-auto rounded bg-muted/40 px-2.5 py-2 text-xs text-foreground">
                      {wslVersionRepairCommand(distribution)}
                    </code>
                  </Show>

                  <Show when={distribution.registration_status === 'eligible'}>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <Show
                        when={registered()}
                        fallback={(
                          <Button
                            size="sm"
                            variant="default"
                            disabled={busyKey() !== ''}
                            onClick={() => void run(actionKey(), () => props.register({
                              distribution_name: distribution.distribution_name,
                            }))}
                          >
                            {busyKey() === actionKey()
                              ? props.i18n.t('environmentCenter.wslRegistering')
                              : props.i18n.t('environmentCenter.wslRegister')}
                          </Button>
                        )}
                      >
                        <Show when={!isDefault()}>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyKey() !== ''}
                            onClick={() => void run(defaultKey(), () => props.setDefault({ runtime_target_id: targetID() }))}
                          >
                            {props.i18n.t('environmentCenter.wslSetDefaultFlower')}
                          </Button>
                        </Show>
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </section>
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
  lifecycleProgressFocusRequest: LifecycleProgressFocusRequest | null;
  consumeLifecycleProgressFocusRequest: (requestID: number) => void;
  setLibrarySourceFilter: (value: string) => void;
  setLibraryQuery: (value: string) => void;
  setGatewaySourceFilter: (value: string) => void;
  setGatewayQuery: (value: string) => void;
  runEnvironmentCardFactAction: (action: EnvironmentCardFactActionModel) => void;
  openLocalEnvironment: () => Promise<void>;
  openSettingsSurface: (environmentID?: string) => void;
  openCreateConnectionDialog: (message?: string, preferredKind?: ConnectionDialogKind) => void;
  openCreateGatewaySetup: (gateway?: DesktopGatewaySource, focusSection?: DesktopGatewayResolveFocus) => void;
  runGatewayLauncherAction: (request: DesktopLauncherActionRequest) => Promise<void>;
  openCreateGatewayEnvironment: (gateway: DesktopGatewaySource) => void;
  openCreateControlPlaneDialog: (message?: string) => void;
  refreshAllEnvironmentRuntimes: () => Promise<void>;
  refreshWSLDiscovery: () => Promise<DesktopWSLDiscoverySnapshot>;
  registerWSLDistribution: (request: DesktopWSLRegisterRequest) => Promise<DesktopWSLActionResponse>;
  setDefaultWSLEnvironment: (request: DesktopWSLSetDefaultRequest) => Promise<DesktopWSLActionResponse>;
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
    attempt?: EnvironmentLifecycleAttempt,
    bindOperation?: (operation: EnvironmentLifecycleAttempt) => void,
  ) => Promise<boolean>;
  refreshEnvironmentRuntime: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  openEnvironmentFlowerSurface: (environment: DesktopEnvironmentEntry, anchor?: FlowerTurnLauncherAnchor) => void;
  runEnvironmentGuidanceAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    updateSession?: (state: EnvironmentGuidanceSessionState) => void,
    attempt?: EnvironmentLifecycleAttempt,
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
  viewGatewayEnvironments: (gateway: DesktopGatewaySource) => void;
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  deleteControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
  deleteGateway: (gateway: DesktopGatewaySource) => void;
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
      ? props.i18n.t('environmentCenter.linkedRuntimeFilterWithLabel', {
          label: environment.label,
        })
      : props.i18n.t('environmentCenter.linkedRuntimeFilter');
  });
  const activeNonCategoryFilterChipLabel = createMemo(() => {
    const runtimeLabel = activeRuntimeTargetFilterLabel();
    if (runtimeLabel) return runtimeLabel;
    const matchedControlPlane = props.controlPlanes.find(
      (cp) => controlPlaneFilterValue(cp) === props.librarySourceFilter,
    );
    if (matchedControlPlane) return matchedControlPlane.display_label;
    const matchedGateway = gatewaySourceFilterOptions(props.snapshot).find(
      (option) => option.value === props.librarySourceFilter,
    );
    return matchedGateway ? `Gateway: ${matchedGateway.label}` : '';
  });
  const controlPlaneEnvironmentCount = createMemo(() => (
    props.controlPlanes.reduce((total, controlPlane) => total + controlPlane.environments.length, 0)
  ));
  const gatewayFilterOptions = createMemo(() => gatewaySourceFilterOptions(props.snapshot));
  const visibleGatewaySourceCount = createMemo(() => (
    props.gatewaySources.filter((gateway) => {
      if (props.gatewaySourceFilter !== '' && gatewaySourceFilterValue(gateway.gateway_id) !== props.gatewaySourceFilter) {
        return false;
      }
      return gatewaySourceMatchesQuery(gateway, props.gatewayQuery);
    }).length
  ));
  const totalGatewaySourceCount = createMemo(() => props.gatewaySources.length);
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
  const headerCopy = createMemo(() => ENVIRONMENT_CENTER_HEADER_COPY[props.activeTab]);

  return (
    <div class="redeven-welcome-surface h-full min-h-0 w-full min-w-0 overflow-auto bg-background">
      <main id="redeven-desktop-main" class="w-full px-4 py-5 sm:px-6 lg:px-8">
        <div class="mx-auto w-full redeven-welcome-shell">
          <header class="redeven-header-separator mb-5 space-y-4">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div class="space-y-1">
                <h1 class="text-lg font-semibold tracking-tight text-foreground">{props.i18n.t(headerCopy().titleKey)}</h1>
                <p class="text-xs text-muted-foreground">
                  {props.i18n.t(headerCopy().descriptionKey)}
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
                  <Button
                    size="sm"
                    variant="default"
                    title={props.i18n.t('environmentCenter.addGateway')}
                    aria-label={props.i18n.t('environmentCenter.addGateway')}
                    onClick={() => props.openCreateGatewaySetup()}
                  >
                    <Plus class="mr-1 h-3.5 w-3.5" />
                    {props.i18n.t('environmentCenter.addGatewayShort')}
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
                      {props.i18n.t('environmentCenter.allFilter')} ({totalGatewaySourceCount()})
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
                      <span>{props.i18n.t('environmentCenter.shownCount', { count: visibleGatewaySourceCount() })}</span>
                    </div>
                  </>
                </Show>
              </div>
            </div>
          </header>

          <div class="space-y-3">
            <Show when={props.activeTab === 'environments'}>
              <>
                <Show when={props.snapshot.platform_capabilities.wsl_environment}>
                  <WSLDiscoveryPanel
                    i18n={props.i18n}
                    snapshot={props.snapshot}
                    refresh={props.refreshWSLDiscovery}
                    register={props.registerWSLDistribution}
                    setDefault={props.setDefaultWSLEnvironment}
                  />
                </Show>
                <EnvironmentCardsPanel
                  i18n={props.i18n}
                entries={props.libraryEntries}
                showQuickAddCards={showQuickAddCards()}
                visibleCardCount={visibleEnvironmentCardCount()}
                layoutReferenceCardCount={layoutReferenceEnvironmentCardCount()}
                busyState={props.busyState}
                actionProgress={props.actionProgress}
                lifecycleProgressFocusRequest={props.lifecycleProgressFocusRequest}
                consumeLifecycleProgressFocusRequest={props.consumeLifecycleProgressFocusRequest}
                openCreateConnectionDialog={props.openCreateConnectionDialog}
                openEnvironment={props.openEnvironment}
                runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                refreshEnvironmentRuntime={props.refreshEnvironmentRuntime}
                openEnvironmentFlowerSurface={props.openEnvironmentFlowerSurface}
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
                />
              </>
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
                lifecycleProgressFocusRequest={props.lifecycleProgressFocusRequest}
                consumeLifecycleProgressFocusRequest={props.consumeLifecycleProgressFocusRequest}
                gatewaySourceFilter={props.gatewaySourceFilter}
                gatewayQuery={props.gatewayQuery}
                openCreateGatewaySetup={props.openCreateGatewaySetup}
                runGatewayLauncherAction={props.runGatewayLauncherAction}
                openCreateGatewayEnvironment={props.openCreateGatewayEnvironment}
                viewGatewayEnvironments={props.viewGatewayEnvironments}
                cancelOperation={props.cancelOperation}
                dismissOperation={props.dismissOperation}
                copyOperationDiagnostics={props.copyOperationDiagnostics}
                deleteGateway={props.deleteGateway}
              />
            </Show>
          </div>
        </div>
      </main>
    </div>
  );
}

function EnvironmentCardsPanel(
  props: Readonly<{
    i18n: DesktopI18n;
    entries: readonly DesktopEnvironmentEntry[];
    showQuickAddCards: boolean;
    visibleCardCount: number;
    layoutReferenceCardCount: number;
    busyState: DesktopLauncherBusyState;
    actionProgress: readonly DesktopLauncherActionProgress[];
    lifecycleProgressFocusRequest: LifecycleProgressFocusRequest | null;
    consumeLifecycleProgressFocusRequest: (requestID: number) => void;
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
      attempt?: EnvironmentLifecycleAttempt,
      bindOperation?: (operation: EnvironmentLifecycleAttempt) => void,
    ) => Promise<boolean>;
    refreshEnvironmentRuntime: (
      environment: DesktopEnvironmentEntry,
      errorTarget?: 'connect' | 'dialog' | 'settings',
    ) => Promise<boolean>;
    openEnvironmentFlowerSurface: (environment: DesktopEnvironmentEntry, anchor?: FlowerTurnLauncherAnchor) => void;
    runEnvironmentGuidanceAction: (
      environment: DesktopEnvironmentEntry,
      action: EnvironmentActionModel,
      updateSession?: (state: EnvironmentGuidanceSessionState) => void,
      attempt?: EnvironmentLifecycleAttempt,
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
  }>,
) {
  const [environmentLibraryElement, setEnvironmentLibraryElement] = createSignal<HTMLDivElement>();
  const [environmentLibraryWidthPx, setEnvironmentLibraryWidthPx] = createSignal(0);
  const [rootFontSizePx, setRootFontSizePx] = createSignal(16);
  const [activeEnvironmentOverlayState, setActiveEnvironmentOverlayState] = createSignal(
    closedEnvironmentLibraryOverlayState(),
  );
  const [guidanceSessionState, setGuidanceSessionState] = createSignal<EnvironmentGuidanceSessionState>(null);
  const [lifecycleDisclosureState, setLifecycleDisclosureState] =
    createSignal<EnvironmentLifecycleDisclosureState>(null);
  // Render cards by stable environment id so snapshot refreshes update data in place instead of remounting the card subtree.
  const projectedEntriesByID = createMemo(() => environmentLibraryEntryRecord(props.entries));
  const projectedEntryIDs = createMemo<readonly string[]>(() => props.entries.map((entry) => entry.id));
  const groupedEntryIDs = createMemo(() => splitPinnedEnvironmentEntryIDs(projectedEntryIDs(), projectedEntriesByID()));
  // Keep transient provider/search filters from collapsing the shared environment column system.
  const layoutModel = createMemo(() =>
    buildEnvironmentLibraryLayoutModel({
      visible_card_count: props.visibleCardCount,
      layout_reference_count: props.layoutReferenceCardCount,
      container_width_px: environmentLibraryWidthPx(),
      root_font_size_px: rootFontSizePx(),
    }),
  );
  const environmentGridStyle = createMemo<JSX.CSSProperties>(() => ({
    '--redeven-environment-grid-columns': String(layoutModel().column_count),
  }));

  createEffect(() => {
    setLifecycleDisclosureState((current) =>
      reconcileEnvironmentLifecycleDisclosure(current, props.entries, props.actionProgress),
    );
  });

  createEffect(() => {
    setActiveEnvironmentOverlayState((current) => {
      const session = guidanceSessionState();
      const lifecycleDisclosure = lifecycleDisclosureState();
      if (current.kind === 'lifecycle_progress') {
        const environment = props.entries.find((entry) => entry.id === current.environment_id);
        const operationState = environment
          ? environmentOperationState(environment, props.actionProgress, props.busyState)
          : null;
        const progressStillVisible = operationState?.panelProgress !== null || operationState?.isSubmitting === true;
        const pendingDisclosureVisible =
          lifecycleDisclosure?.environment_id === current.environment_id &&
          lifecycleDisclosure.visibility === 'open' &&
          environmentLifecycleDisclosureHasPendingRequest(lifecycleDisclosure, props.busyState);
        return pendingDisclosureVisible || progressStillVisible ? current : closedEnvironmentLibraryOverlayState();
      }
      if (
        current.kind === 'primary_action_guidance' &&
        session?.environment_id === current.environment_id &&
        guidanceSessionKeepsPopoverOpen(session)
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
      setActiveEnvironmentOverlayState((current) =>
        session
          ? closeEnvironmentLibraryOverlayState(current, 'primary_action_guidance', session.environment_id)
          : current,
      );
      clearHandle = window.setTimeout(() => {
        setGuidanceSessionState((current) => (current?.environment_id === session?.environment_id ? null : current));
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
    setActiveEnvironmentOverlayState((current) =>
      open
        ? openEnvironmentLibraryOverlayState('runtime_menu', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'runtime_menu', environmentID),
    );
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
    setActiveEnvironmentOverlayState((current) =>
      open
        ? openEnvironmentLibraryOverlayState('lifecycle_progress', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'lifecycle_progress', environmentID),
    );
    setLifecycleDisclosureState((current) =>
      open
        ? reopenEnvironmentLifecycleDisclosure(current, environmentID)
        : closeEnvironmentLifecycleDisclosure(current, environmentID),
    );
  };

  const abandonLifecycleProgressDisclosure = (environmentID: string, attempt: EnvironmentLifecycleAttempt) => {
    const current = lifecycleDisclosureState();
    const next = abandonEnvironmentLifecycleDisclosureAttempt(current, environmentID, attempt);
    if (next === current) {
      return;
    }
    setLifecycleDisclosureState(next);
    setActiveEnvironmentOverlayState((overlay) =>
      closeEnvironmentLibraryOverlayState(overlay, 'lifecycle_progress', environmentID),
    );
  };

  const bindLifecycleProgressDisclosure = (
    environmentID: string,
    attempt: EnvironmentLifecycleAttempt,
    operation: EnvironmentLifecycleAttempt,
  ) => {
    setLifecycleDisclosureState((current) =>
      bindEnvironmentLifecycleDisclosureOperation(current, environmentID, attempt, operation),
    );
  };

  let handledLifecycleProgressFocusRequestID = 0;
  createEffect(() => {
    const request = props.lifecycleProgressFocusRequest;
    if (
      !request ||
      request.subject_kind !== 'environment' ||
      request.request_id === handledLifecycleProgressFocusRequestID
    ) {
      return;
    }
    const environment = props.entries.find((entry) => entry.id === request.subject_id);
    if (!environment) {
      return;
    }
    const progress = progressForEnvironmentFocusRequest(environment, props.actionProgress, request);
    if (
      !progress ||
      trimString(progress.operation_key) !== request.operation_key ||
      (progress?.started_at_unix_ms ?? 0) !== request.started_at_unix_ms
    ) {
      return;
    }
    handledLifecycleProgressFocusRequestID = request.request_id;
    setLifecycleDisclosureState((current) => focusEnvironmentLifecycleDisclosure(current, environment.id, progress));
    setLifecycleProgressOpen(environment.id, true);
    props.consumeLifecycleProgressFocusRequest(request.request_id);
  });

  const beginLifecycleProgressDisclosure = (
    environmentID: string,
    intent: EnvironmentLifecycleDisclosureIntent,
    attempt: EnvironmentLifecycleAttempt,
  ) => {
    setGuidanceSessionState((current) => (current?.environment_id === environmentID ? null : current));
    setLifecycleDisclosureState((current) =>
      beginEnvironmentLifecycleDisclosure(current, environmentID, intent, attempt),
    );
    setActiveEnvironmentOverlayState(openEnvironmentLibraryOverlayState('lifecycle_progress', environmentID));
  };

  const setEndpointPopoverOpen = (environmentID: string, open: boolean) => {
    if (open) {
      setLifecycleDisclosureState((current) => closeEnvironmentLifecycleDisclosure(current, environmentID));
    }
    setActiveEnvironmentOverlayState((current) =>
      open
        ? openEnvironmentLibraryOverlayState('endpoints', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'endpoints', environmentID),
    );
  };

  const selectEndpointForQRCode = (environmentID: string, endpointValue: string) => {
    setActiveEnvironmentOverlayState(selectEnvironmentEndpointOverlayState(environmentID, endpointValue));
  };

  const projectedEnvironment = (environmentID: string): DesktopEnvironmentEntry =>
    projectedEntriesByID()[environmentID]!;
  const guidanceSessionForEnvironment = (environmentID: string): EnvironmentGuidanceSessionState =>
    guidanceSessionState()?.environment_id === environmentID ? guidanceSessionState() : null;
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

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updateLayoutMetrics());
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
        fallback={
          <Motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div class="redeven-console-empty flex flex-col items-center justify-center gap-3 rounded-lg px-6 py-8 text-center">
              <Search class="h-8 w-8 text-muted-foreground/50" />
              <div class="space-y-1">
                <div class="text-sm font-medium text-foreground">
                  {props.i18n.t('environmentCenter.noMatchingEnvironmentsTitle')}
                </div>
                <div class="text-xs text-muted-foreground">
                  {props.i18n.t('environmentCenter.noMatchingEnvironmentsDescription')}
                </div>
              </div>
            </div>
          </Motion.div>
        }
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
                    runtimeMenuOpen={environmentLibraryOverlayOpenFor(
                      activeEnvironmentOverlayState(),
                      'runtime_menu',
                      environmentID,
                    )}
                    onRuntimeMenuOpenChange={(open) => setRuntimeMenuOpen(environmentID, open)}
                    primaryActionGuidanceOpen={environmentLibraryOverlayOpenFor(
                      activeEnvironmentOverlayState(),
                      'primary_action_guidance',
                      environmentID,
                    )}
                    onPrimaryActionGuidanceOpenChange={(open) => setPrimaryActionGuidanceOpen(environmentID, open)}
                    lifecycleProgressOpen={environmentLibraryOverlayOpenFor(
                      activeEnvironmentOverlayState(),
                      'lifecycle_progress',
                      environmentID,
                    )}
                    onLifecycleProgressOpenChange={(open) => setLifecycleProgressOpen(environmentID, open)}
                    endpointPopoverOpen={environmentLibraryOverlayOpenFor(
                      activeEnvironmentOverlayState(),
                      'endpoints',
                      environmentID,
                    )}
                    onEndpointPopoverOpenChange={(open) => setEndpointPopoverOpen(environmentID, open)}
                    selectedEndpointValue={environmentEndpointOverlaySelectedValueFor(
                      activeEnvironmentOverlayState(),
                      environmentID,
                    )}
                    selectEndpointForQRCode={(endpointValue) => selectEndpointForQRCode(environmentID, endpointValue)}
                    guidanceSession={guidanceSessionForEnvironment(environmentID)}
                    openEnvironment={props.openEnvironment}
                    runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                    refreshEnvironmentRuntime={props.refreshEnvironmentRuntime}
                    openEnvironmentFlowerSurface={props.openEnvironmentFlowerSurface}
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
                    beginLifecycleDisclosure={(intent, attempt) =>
                      beginLifecycleProgressDisclosure(environmentID, intent, attempt)
                    }
                    abandonLifecycleDisclosure={(attempt) => abandonLifecycleProgressDisclosure(environmentID, attempt)}
                    bindLifecycleDisclosure={(attempt, operation) =>
                      bindLifecycleProgressDisclosure(environmentID, attempt, operation)
                    }
                  />
                )}
              </For>
            </EnvironmentLibrarySection>
          </Show>
          <Show when={groupedEntryIDs().regular_entry_ids.length > 0 || props.showQuickAddCards}>
            <EnvironmentLibrarySection
              title={
                groupedEntryIDs().pinned_entry_ids.length > 0
                  ? props.i18n.t('environmentCenter.environmentsSection')
                  : undefined
              }
            >
              <For each={groupedEntryIDs().regular_entry_ids}>
                {(environmentID) => (
                  <EnvironmentConnectionCard
                    i18n={props.i18n}
                    environment={projectedEnvironment(environmentID)}
                    busyState={props.busyState}
                    actionProgress={props.actionProgress}
                    runtimeMenuOpen={environmentLibraryOverlayOpenFor(
                      activeEnvironmentOverlayState(),
                      'runtime_menu',
                      environmentID,
                    )}
                    onRuntimeMenuOpenChange={(open) => setRuntimeMenuOpen(environmentID, open)}
                    primaryActionGuidanceOpen={environmentLibraryOverlayOpenFor(
                      activeEnvironmentOverlayState(),
                      'primary_action_guidance',
                      environmentID,
                    )}
                    onPrimaryActionGuidanceOpenChange={(open) => setPrimaryActionGuidanceOpen(environmentID, open)}
                    lifecycleProgressOpen={environmentLibraryOverlayOpenFor(
                      activeEnvironmentOverlayState(),
                      'lifecycle_progress',
                      environmentID,
                    )}
                    onLifecycleProgressOpenChange={(open) => setLifecycleProgressOpen(environmentID, open)}
                    endpointPopoverOpen={environmentLibraryOverlayOpenFor(
                      activeEnvironmentOverlayState(),
                      'endpoints',
                      environmentID,
                    )}
                    onEndpointPopoverOpenChange={(open) => setEndpointPopoverOpen(environmentID, open)}
                    selectedEndpointValue={environmentEndpointOverlaySelectedValueFor(
                      activeEnvironmentOverlayState(),
                      environmentID,
                    )}
                    selectEndpointForQRCode={(endpointValue) => selectEndpointForQRCode(environmentID, endpointValue)}
                    guidanceSession={guidanceSessionForEnvironment(environmentID)}
                    openEnvironment={props.openEnvironment}
                    runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                    refreshEnvironmentRuntime={props.refreshEnvironmentRuntime}
                    openEnvironmentFlowerSurface={props.openEnvironmentFlowerSurface}
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
                    beginLifecycleDisclosure={(intent, attempt) =>
                      beginLifecycleProgressDisclosure(environmentID, intent, attempt)
                    }
                    abandonLifecycleDisclosure={(attempt) => abandonLifecycleProgressDisclosure(environmentID, attempt)}
                    bindLifecycleDisclosure={(attempt, operation) =>
                      bindLifecycleProgressDisclosure(environmentID, attempt, operation)
                    }
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
  'aria-expanded'?: boolean;
  'aria-haspopup'?: JSX.AriaAttributes['aria-haspopup'];
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  children: JSX.Element;
}>) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props['aria-label']}
      aria-pressed={props.active}
      aria-expanded={props['aria-expanded']}
      aria-haspopup={props['aria-haspopup']}
      data-active={props.active === true}
      disabled={props.disabled || props.loading}
      aria-busy={props.loading === true ? 'true' : undefined}
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
  return {
    '--redeven-card-fact-icon-mask': `url("${icon}")`,
  } as JSX.CSSProperties;
}

function qrCodeSvgDataUrl(value: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const cellSize = 5;
  const margin = 2;
  return `data:image/svg+xml;utf8,${encodeURIComponent(qr.createSvgTag({ cellSize, margin, scalable: true }))}`;
}

function qrCodeDataUrl(value: string): string {
  return qrCodeSvgDataUrl(value);
}

function EnvironmentCardFactsBlock(props: Readonly<{
  i18n: DesktopI18n;
  facts: readonly EnvironmentCardFactModel[];
  minRows?: number;
  onFactAction: (action: EnvironmentCardFactActionModel) => void;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  endpointPopoverOpen: boolean;
  onEndpointPopoverOpenChange: (open: boolean) => void;
  selectedEndpointValue?: string;
  selectEndpointForQRCode: (endpointValue: string) => void;
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
                      open={props.endpointPopoverOpen}
                      onOpenChange={props.onEndpointPopoverOpenChange}
                      selectedEndpointValue={props.selectedEndpointValue}
                      selectEndpointForQRCode={props.selectEndpointForQRCode}
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedEndpointValue?: string;
  selectEndpointForQRCode: (endpointValue: string) => void;
}>) {
  let anchorRef: HTMLSpanElement | undefined;
  let popoverRef: HTMLDivElement | undefined;

  const selectedEndpoint = createMemo(() => (
    props.endpoints.find((endpoint) => endpoint.value === props.selectedEndpointValue) ?? null
  ));

  const handlePointerDown = (event: MouseEvent) => {
    if (popoverRef?.contains(event.target as Node) || anchorRef?.contains(event.target as Node)) {
      return;
    }
    props.onOpenChange(false);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      props.onOpenChange(false);
      anchorRef?.focus();
    }
  };

  createEffect(() => {
    if (props.open) {
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
        aria-expanded={props.open}
        onClick={(e) => {
          e.stopPropagation();
          props.onOpenChange(!props.open);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onOpenChange(true);
          }
        }}
      >
        <span
          class="redeven-endpoint-trigger-icon"
          style={cardFactIconMaskStyle(ICON_ENDPOINTS)}
          aria-hidden="true"
        />
      </span>
      <Show when={props.open}>
        <DesktopAnchoredOverlaySurface
          open={props.open}
          anchorRef={anchorRef}
          placement="bottom"
          role="dialog"
          ariaModal={false}
          ariaLabel={props.i18n.t('environmentCenter.environmentEndpoints')}
          interactive
          class="redeven-desktop-overlay-surface z-[225] rounded-md border border-border/80 bg-popover text-popover-foreground"
          onOverlayRef={(element) => {
            popoverRef = element;
          }}
        >
          <div
            class="redeven-endpoints-popover"
            classList={{
              'redeven-endpoints-popover--expanded': selectedEndpoint() !== null,
            }}
          >
            <div class="redeven-endpoints-popover-header">
              <span class="redeven-endpoints-popover-title">{props.i18n.t('environmentCenter.endpoints')}</span>
              <button
                type="button"
                class="redeven-endpoints-popover-close"
                aria-label={props.i18n.t('environmentCenter.closeEndpoints')}
                onClick={() => props.onOpenChange(false)}
              >
                <X class="h-3 w-3" />
              </button>
            </div>
            <div
              class="redeven-endpoints-popover-body"
              classList={{
                'redeven-endpoints-popover-body--expanded': selectedEndpoint() !== null,
              }}
            >
              <div class="redeven-endpoints-popover-list">
                <For each={props.endpoints}>
                  {(endpoint) => (
                    <EndpointCopyRow
                      endpoint={endpoint}
                      selected={endpoint.value === selectedEndpoint()?.value}
                      selectEndpointForQRCode={props.selectEndpointForQRCode}
                    />
                  )}
                </For>
              </div>
              <Show when={selectedEndpoint()}>
                {(endpoint) => (
                  <EndpointQRCodePanel
                    i18n={props.i18n}
                    endpoint={endpoint()}
                    copyEnvironmentValue={props.copyEnvironmentValue}
                  />
                )}
              </Show>
            </div>
          </div>
        </DesktopAnchoredOverlaySurface>
      </Show>
    </>
  );
}

function EndpointCopyRow(props: Readonly<{
  endpoint: EnvironmentCardEndpointModel;
  selected: boolean;
  selectEndpointForQRCode: (endpointValue: string) => void;
}>) {
  return (
    <button
      type="button"
      class="redeven-card-endpoint-row"
      data-selected={props.selected ? '' : undefined}
      onClick={() => props.selectEndpointForQRCode(props.endpoint.value)}
      title={props.endpoint.value}
      aria-pressed={props.selected}
    >
      <span class="redeven-card-endpoint-label">{props.endpoint.label}</span>
      <span class={cn(
        'redeven-card-endpoint-value',
        props.endpoint.monospace && 'font-mono text-[11.5px]',
      )}>
        {endpointDisplayValue(props.endpoint.value)}
      </span>
      <span class={cn('redeven-card-endpoint-copy', props.selected && 'redeven-card-endpoint-copy--active')} aria-hidden="true">
        {props.selected ? <Check class="h-3 w-3" /> : <ChevronRight class="h-3 w-3" />}
      </span>
    </button>
  );
}

function EndpointQRCodePanel(props: Readonly<{
  i18n: DesktopI18n;
  endpoint: EnvironmentCardEndpointModel;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
}>) {
  const [copied, setCopied] = createSignal(false);
  const qrSrc = createMemo(() => qrCodeDataUrl(props.endpoint.value));
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const handleCopy = () => {
    void props.copyEnvironmentValue(props.endpoint.value, props.endpoint.copy_label);
    setCopied(true);
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => setCopied(false), 1500);
  };

  onCleanup(() => clearTimeout(resetTimer));

  return (
    <div class="redeven-endpoint-qr-panel">
      <div class="redeven-endpoint-qr-card">
        <img
          class="redeven-endpoint-qr-image"
          src={qrSrc()}
          alt={props.endpoint.copy_label}
        />
      </div>
      <div class="redeven-endpoint-qr-meta">
        <span class="redeven-endpoint-qr-label">{props.endpoint.label}</span>
        <span class="redeven-endpoint-qr-value" title={props.endpoint.value}>{endpointDisplayValue(props.endpoint.value)}</span>
      </div>
      <button
        type="button"
        class="redeven-endpoint-qr-copy-button"
        aria-label={props.endpoint.copy_label}
        title={props.endpoint.copy_label}
        onClick={handleCopy}
      >
        <Show when={copied()} fallback={<Copy class="h-3 w-3" />}>
          <Check class="h-3 w-3" />
        </Show>
        <span class="redeven-endpoint-qr-copy-label">{copied() ? props.i18n.t('environmentCenter.copied') : props.i18n.t('common.copy')}</span>
      </button>
    </div>
  );
}

function isEnvironmentActionBusy(
  action: EnvironmentActionModel,
  operationState: EnvironmentOperationState,
  busyState: DesktopLauncherBusyState | undefined,
  environmentID: string,
): boolean {
  if (environmentActionUsesLifecycleOwner(action)) {
    return operationState.actionsDisabled;
  }
  if (!busyState) {
    return false;
  }
  switch (action.intent) {
    case 'request_open_access':
      return (
        busyState.provider_origin !== '' &&
        busyState.provider_origin === action.provider_origin &&
        busyState.action === 'start_control_plane_connect'
      );
    case 'pair_gateway':
      return busyStateMatchesGateway(busyState, action.gateway_id ?? '', ['refresh_gateway']);
    case 'update_desktop':
      return busyStateMatchesEnvironment(busyState, environmentID, ['manage_desktop_update']);
    case 'connect_provider_runtime':
      return busyStateMatchesEnvironment(busyState, environmentID, ['connect_provider_runtime']);
    case 'disconnect_provider_runtime':
      return busyStateMatchesEnvironment(busyState, environmentID, ['disconnect_provider_runtime']);
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
    case 'needs_confirmation':
      return i18n.t('progress.needsAttention');
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
    case 'wsl_host':
      return 'WSL 2';
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
  const open = progress.active_progress_surface === 'open' ? progress.open_progress : undefined;
  if (open) {
    const environmentLabel = trimString(open.environment_label) || trimString(progress.environment_label) || 'Environment';
    return `${environmentLabel} · ${localizedProgressLocation(i18n, open.location)}`;
  }
  const startup = progress.active_progress_surface === 'runtime_lifecycle' ? progress.lifecycle_progress : undefined;
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
    case 'needs_confirmation':
      return 'info';
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
    case 'discovering_runtime_instances':
      return i18n.t('progress.discoveringRuntimeInstances');
    case 'stopping_runtime_process':
      return i18n.t('progress.stoppingRuntimeProcess');
    case 'verifying_runtime_stopped':
      return i18n.t('progress.verifyingRuntimeStopped');
    case 'verifying_runtime_inventory':
      return i18n.t('progress.verifyingRuntimeInventory');
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

function localizedRuntimeTargetDetail(
  i18n: DesktopI18n,
  progress: Readonly<{ location: string; target_detail?: string }> | undefined,
): string {
  const detail = trimString(progress?.target_detail);
  if (detail === '') {
    return '';
  }
  return progress?.location === 'local_host'
    ? i18n.t('environmentFacts.thisDevice')
    : detail;
}

function localizedGatewayCheckStepLabel(i18n: DesktopI18n, stepID: string, fallback: string): string {
  const labelsByStepID: Readonly<Record<string, DesktopTranslationKey>> = {
    checking_gateway: 'progress.checkingGateway',
    checking_transport: 'progress.checkingGatewayTransport',
    checking_gateway_service: 'progress.checkingGatewayService',
    checking_gateway_version: 'progress.checkingGatewayVersion',
    checking_gateway_trust: 'progress.checkingGatewayTrust',
    checking_gateway_catalog: 'progress.checkingGatewayCatalog',
    gateway_checked: 'progress.gatewayChecked',
    gateway_refreshed: 'progress.gatewayChecked',
  };
  const cleanStepID = trimString(stepID);
  const stepIDKey = labelsByStepID[cleanStepID];
  if (stepIDKey) {
    return i18n.t(stepIDKey);
  }
  const cleanFallback = trimString(fallback);
  return cleanFallback || cleanStepID;
}

function localizedGatewayCheckStepDetail(i18n: DesktopI18n, detail: string | undefined): string | undefined {
  if (!detail) {
    return undefined;
  }
  return i18n.locale === 'en-US' ? detail : undefined;
}

function localizedProgressTitle(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  if (progress.title_key) {
    return i18n.t(progress.title_key);
  }
  if (progress.active_progress_surface === 'runtime_lifecycle' && progress.lifecycle_progress) {
    return localizedRuntimeLifecyclePhaseLabel(i18n, progress.lifecycle_progress.phase);
  }
  const open = progress.active_progress_surface === 'open' ? progress.open_progress : undefined;
  if (open) {
    if (progress.status === 'failed') {
      return i18n.t('progress.openFailed');
    }
    if (progress.status === 'canceled') {
      return i18n.t('progress.canceled');
    }
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
      case 'ensuring_runtime_ready':
      case 'connecting_runtime_control':
        return localizedOpenConnectionPhaseLabel(i18n, open.phase);
    }
  }
  const lifecycle = progress.active_progress_surface === 'runtime_lifecycle' ? progress.lifecycle_progress : undefined;
  if (lifecycle) {
    return localizedRuntimeLifecyclePhaseLabel(i18n, lifecycle.phase);
  }
  if (progress.failure) return localizedOperationFailureTitle(i18n, progress.failure);
  if (progress.status === 'canceled') return i18n.t('progress.canceled');
  if (progress.status === 'failed' || progress.status === 'cleanup_failed') {
    return i18n.t('progress.operationFailedTitle');
  }
  return localizedProgressPlanningLabel(i18n, progress.action);
}

function localizedProgressDetail(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  if (progress.detail_key) {
    return i18n.t(progress.detail_key);
  }
  if (progress.active_progress_surface === 'runtime_lifecycle' && progress.lifecycle_progress) {
    const lifecycle = progress.lifecycle_progress;
    if (lifecycle.phase === 'runtime_ready') {
      return i18n.t('progress.detailRuntimeReady');
    }
    return i18n.t('progress.checkingExistingRuntime');
  }
  const open = progress.active_progress_surface === 'open' ? progress.open_progress : undefined;
  if (open && progress.status !== 'failed' && progress.status !== 'canceled') {
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
      case 'connecting_runtime_control':
        break;
    }
  }
  const lifecycle = progress.lifecycle_progress;
  if (lifecycle?.phase === 'runtime_ready') {
    return i18n.t('progress.detailRuntimeReady');
  }
  if (lifecycle && progress.status !== 'failed' && progress.status !== 'cleanup_failed') {
    switch (lifecycle.phase) {
      case 'checking_existing_runtime':
        return i18n.t('progress.checkingExistingRuntime');
      case 'discovering_runtime_instances':
        return i18n.t('progress.discoveringRuntimeInstances');
      case 'stopping_runtime_process':
        return i18n.t('progress.stoppingRuntimeProcess');
      case 'verifying_runtime_inventory':
        return i18n.t('progress.verifyingRuntimeInventory');
      default:
        break;
    }
  }
  if (progress.failure) return localizedOperationFailureSummary(i18n, progress.failure);
  if (progress.status === 'canceled') return i18n.t('progress.detailStartupCanceled');
  if (progress.status === 'failed' || progress.status === 'cleanup_failed') {
    return i18n.t('progress.operationFailedSummary');
  }
  return '';
}

function localizedProgressInterruptLabel(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  return i18n.t(launcherOperationInterruptionPresentation(progress.action).labelKey);
}

function localizedProgressInterruptDetail(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  return i18n.t(launcherOperationInterruptionPresentation(progress.action).detailKey);
}

function localizedProgressPlanningLabel(i18n: DesktopI18n, action: DesktopLauncherActionKind): string {
  switch (action) {
    case 'refresh_gateway':
    case 'check_gateway':
    case 'sync_gateway':
    case 'pair_gateway':
    case 'refresh_gateway_catalog':
    case 'refresh_gateway_status':
      return i18n.t('progress.planningGatewayStartPath');
    case 'reinstall_target':
      return i18n.t('common.reinstall');
    case 'restart_environment_runtime':
      return i18n.t('progress.planningRestartPath');
    case 'update_environment_runtime':
      return i18n.t('progress.planningUpdatePath');
    case 'stop_environment_runtime':
      return i18n.t('progress.planningStopPath');
    case 'refresh_environment_runtime':
      return i18n.t('progress.verifyingRuntimeInventory');
    default:
      return i18n.t('progress.planningStartupPath');
  }
}

function localizedFailureNoticeTitle(i18n: DesktopI18n, progress: DesktopLauncherActionProgress): string {
  if (progress.open_progress) {
    return i18n.t('progress.openNeedsAttention');
  }
  switch (progress.action) {
    case 'refresh_gateway':
    case 'check_gateway':
    case 'pair_gateway':
    case 'refresh_gateway_catalog':
    case 'refresh_gateway_status':
      return i18n.t('progress.gatewayNeedsAttention');
    case 'reinstall_target':
      return i18n.t('toast.needsAttention');
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
  if ('label_key' in action && action.label_key) {
    return i18n.t(action.label_key);
  }
  switch (action.kind) {
    case 'refresh_status':
      return i18n.t('environmentAction.refreshStatus');
    case 'update_runtime':
      return i18n.t('environmentAction.updateRuntime');
    case 'manage_desktop_update':
      return i18n.t('environmentAction.updateRedevenDesktop');
    case 'refresh_gateway':
      return i18n.t('environmentAction.refreshStatus');
    case 'refresh_gateway_status':
    case 'refresh_gateway_catalog':
    case 'check_gateway':
      return i18n.t('environmentAction.refreshStatus');
    case 'reinstall_target':
      return i18n.t('common.reinstall');
    case 'resolve_gateway':
      return i18n.t('environmentStatus.resolveGateway');
    case 'open_gateway_environment':
      return i18n.t('environmentAction.open');
    case 'copy_diagnostics':
      return i18n.t('progress.copyLog');
    case 'dismiss':
      return i18n.t('progress.dismiss');
    case 'retry':
      return i18n.t('common.retry');
  }
  return action.label;
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
        label: localizedEnvironmentAction(i18n, action.action).label,
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
  const runtimeLifecycle = createMemo(() => (
    props.progress.active_progress_surface === 'runtime_lifecycle'
      ? props.progress.lifecycle_progress
      : undefined
  ));
  const openConnection = createMemo(() => (
    props.progress.active_progress_surface === 'open'
      ? props.progress.open_progress
      : undefined
  ));
  const stepProgress = createMemo(() => (
    props.progress.active_progress_surface === 'reinstall'
    || props.progress.active_progress_surface === 'gateway'
      ? props.progress.step_progress
      : undefined
  ));
  const runtimeTargetDetail = createMemo(() => localizedRuntimeTargetDetail(props.i18n, runtimeLifecycle()));
  const openTargetDetail = createMemo(() => localizedRuntimeTargetDetail(props.i18n, openConnection()));
  const iconTone = createMemo(() => environmentProgressStatusIconTone(props.progress));
  const phaseStatus = createMemo(() => {
    const s = props.progress.status;
    if (s === 'succeeded' || s === 'failed' || s === 'canceled') {
      return s;
    }
    if (s === 'needs_confirmation') {
      return 'canceled';
    }
    return 'running';
  });
  const runtimeSteps = createMemo(() => runtimeLifecycle()?.steps ?? []);
  const [clockNow, setClockNow] = createSignal(Date.now());
  const elapsedTimer = setInterval(() => setClockNow(Date.now()), 1_000);
  onCleanup(() => clearInterval(elapsedTimer));
  const activeStageElapsedSeconds = createMemo(() => (
    environmentProgressStageElapsedSeconds(props.progress, clockNow())
  ));
  const stepEntering = createRuntimeLifecycleStepAnimation(
    runtimeSteps,
    () => runtimeLifecycle()?.plan_revision ?? 0,
  );
  const stagePercent = createMemo(() => {
    return environmentProgressMeterPercent(props.progress);
  });
  const canCancel = createMemo(() => (
    props.progress.subject_kind !== 'gateway'
    && props.progress.cancelable === true
    && props.progress.status === 'running'
  ));
  const panelPrimaryAction = createMemo(() => localizedProgressPanelPrimaryAction(
    props.i18n,
    props.progress,
    props.primaryAction,
    { busy: props.primaryActionBusy },
  ));
  const nextActionGroups = createMemo(() => {
    const primaryIntent = panelPrimaryAction()?.action.intent;
    return groupedVisibleOperationNextActions(props.progress)
      .map((group) => ({
        ...group,
        actions: group.actions.filter((action) => (
          !(primaryIntent === 'update_runtime' && action.kind === 'update_runtime')
          && !(primaryIntent === 'refresh_runtime' && action.kind === 'refresh_status')
          && !(primaryIntent === 'reinstall_target'
            && action.kind === 'retry'
            && action.retry_action?.kind === 'preview_reinstall_target')
        )),
      }))
      .filter((group) => group.actions.length > 0);
  });
  const hasPanelActions = createMemo(() => (
    nextActionGroups().length > 0
    || canCancel()
    || panelPrimaryAction() !== null
  ));
  const phaseSequence = createMemo<readonly { phase: string; key: string; label: string; status?: string; detail?: string; tasks?: readonly import('../shared/desktopLauncherIPC').DesktopComponentTaskProgress[] }[]>(() => {
    const steps = stepProgress();
    if (steps) {
      return steps.steps.map((step, index) => ({
        phase: step.id,
        key: `step:${index}:${step.id}`,
        label: step.label_key ? props.i18n.t(step.label_key) : localizedGatewayCheckStepLabel(props.i18n, step.id, step.label),
        status: step.status,
        detail: step.detail_key ? props.i18n.t(step.detail_key) : localizedGatewayCheckStepDetail(props.i18n, step.detail),
        tasks: step.tasks,
      }));
    }
    const current = runtimeLifecycle();
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
      tasks: step.tasks,
    }));
  });
  const failureNoticeTitle = createMemo(() => localizedFailureNoticeTitle(props.i18n, props.progress));
  const failureDisplay = createMemo(() => (
    props.progress.status === 'failed' || props.progress.status === 'cleanup_failed'
      ? buildWelcomeOperationFailureDisplay({
          i18n: props.i18n,
          failure: props.progress.failure,
          progress_detail: props.progress.detail,
          fallback_title: failureNoticeTitle(),
        })
      : null
  ));
  const progressLeadDetail = createMemo(() => {
    if (failureDisplay() || (props.progress.status === 'needs_confirmation' && props.progress.reinstall_preview)) {
      return '';
    }
    return localizedProgressDetail(props.i18n, props.progress);
  });
  const hasStepTimeline = createMemo(() => Boolean(stepProgress() || runtimeLifecycle() || openConnection()));
  const renderFailureNotice = () => (
    <Show when={failureDisplay()}>
      {(failure) => (
        <div
          class="redeven-action-popover__notice"
          data-tone={failure().severity}
          data-placement={hasStepTimeline() ? 'after-steps' : 'inline'}
        >
          <div class="redeven-action-popover__notice-title">{failure().title}</div>
          <div class="redeven-action-popover__notice-detail">{failure().summary}</div>
          <Show when={failure().recovery_hint}>
            {(hint) => <div class="redeven-action-popover__failure-recovery">{hint()}</div>}
          </Show>
          <Show when={Boolean(
            failure().explanation
            || failure().technical_details.length > 0
            || failure().diagnostics.length > 0
          )}>
            <details class="redeven-action-popover__failure-details">
              <summary>
                <span>{props.i18n.t('progress.technicalErrorDetails')}</span>
                <ChevronRight aria-hidden="true" />
              </summary>
              <div class="redeven-action-popover__failure-details-viewport">
                <Show when={failure().explanation}>
                  {(explanation) => (
                    <div class="redeven-action-popover__failure-explanation">{explanation()}</div>
                  )}
                </Show>
                <For each={failure().technical_details}>
                  {(detail) => <pre class="redeven-action-popover__failure-technical-text">{detail}</pre>}
                </For>
                <For each={failure().diagnostics}>
                  {(diagnostic) => (
                    <div class="redeven-action-popover__failure-diagnostic">
                      <div>{diagnostic.label}</div>
                      <pre>{diagnostic.text}</pre>
                    </div>
                  )}
                </For>
              </div>
            </details>
          </Show>
        </div>
      )}
    </Show>
  );
  const renderNextActionGroups = () => (
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
  );
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
    <div
      class="redeven-action-popover redeven-environment-progress"
      data-redeven-action-popover-initial-focus=""
      tabIndex={-1}
      aria-live="polite"
    >
      <div class="redeven-environment-progress__body">
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
        <Show when={progressLeadDetail()}>
          {(detail) => <div class="redeven-action-popover__detail">{detail()}</div>}
        </Show>
        <Show when={props.progress.status === 'needs_confirmation' && props.progress.reinstall_preview}>
          {(preview) => (
            <div class="redeven-runtime-impact" data-tone="warning">
              <div class="redeven-runtime-impact__summary">{props.i18n.t(reinstallTargetDescriptionKey(preview().mode))}</div>
              <details class="redeven-runtime-impact__technical">
                <summary>{props.i18n.t('confirm.reinstallTargetDetails')}</summary>
                <div class="redeven-runtime-impact__detail space-y-1">
                  <div>{props.i18n.t('confirm.reinstallTargetHost', { host: localizedReinstallHost(props.i18n, preview().host_label) })}</div>
                  <Show when={preview().container_id}>
                    {(containerID) => <div>{props.i18n.t('confirm.reinstallTargetContainer', { container: containerID() })}</div>}
                  </Show>
                  <div class="font-mono break-all">{props.i18n.t('confirm.reinstallTargetRoot', { root: preview().target_root })}</div>
                  <div>{preview().target_exists_known
                    ? props.i18n.t('confirm.reinstallTargetProcessCount', { count: preview().processes.length })
                    : props.i18n.t('confirm.reinstallTargetProcessCountUnknown')}</div>
                  <div>{props.i18n.t('confirm.reinstallAffectedEnvironmentCount', { count: preview().affected_environment_ids.length })}</div>
                  <ul class="list-disc space-y-1 pl-4">
                    <For each={preview().deleted_data_keys}>
                      {(dataKey) => <li>{props.i18n.t(reinstallDeletedDataTranslationKey(dataKey))}</li>}
                    </For>
                  </ul>
                  <div class="font-medium text-destructive">{props.i18n.t('confirm.reinstallIrreversible')}</div>
                </div>
              </details>
            </div>
          )}
        </Show>
        <Show when={!hasStepTimeline()}>
          {renderFailureNotice()}
        </Show>
        <Show when={hasStepTimeline()}>
          <>
            <div
              class="redeven-environment-progress__steps"
              role="list"
              aria-label={props.i18n.t('progress.environmentProgress')}
            >
              <Index each={phaseSequence()}>
                {(step, index) => {
                  const state = () => stepState(
                    index,
                    stepProgress()?.active_step_id ?? runtimeLifecycle()?.phase ?? openConnection()?.phase,
                    phaseStatus(),
                  );
                  const isLast = () => index === phaseSequence().length - 1;
                  return (
                    <div
                      class="redeven-environment-progress__step"
                      role="listitem"
                      data-step-key={step().key}
                      data-plan-revision={runtimeLifecycle()?.plan_revision ?? 0}
                      data-entering={runtimeLifecycle() ? stepEntering(step().key) : false}
                    >
                      <div class="redeven-environment-progress__step-connector">
                        <span class="redeven-environment-progress__step-dot" data-state={state()} />
                        <Show when={!isLast()}>
                          <span class="redeven-environment-progress__step-line" data-state={state()} />
                        </Show>
                      </div>
                      <span class="min-w-0">
                        <span
                          class="redeven-environment-progress__step-label"
                          data-state={state()}
                          aria-current={state() === 'active' ? 'step' : undefined}
                        >{step().label}</span>
                        <Show when={step().detail}>
                          {(detail) => <span class="redeven-environment-progress__step-detail">{detail()}</span>}
                        </Show>
                        <Show when={step().tasks && step().tasks!.length > 0}>
                          <div class="redeven-environment-progress__component-tasks" role="list" aria-label={props.i18n.t('progress.componentTasks')}>
                            <For each={step().tasks ?? []}>
                              {(task) => (
                                <div class="redeven-environment-progress__component-task" role="listitem" data-status={task.status}>
                                  <span class="redeven-environment-progress__component-task-name">
                                    {props.i18n.t(task.id === 'gateway'
                                      ? 'progress.componentName.gateway'
                                      : 'progress.componentName.runtime')}
                                  </span>
                                  <span class="redeven-environment-progress__component-task-phase">{props.i18n.t(`progress.componentPhase.${task.phase}` as 'progress.componentPhase.preparing')}</span>
                                  <span class="redeven-environment-progress__component-task-strategy">{props.i18n.t(task.strategy === 'desktop_upload' ? 'common.desktopUpload' : 'common.remoteInstall')}</span>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </span>
                    </div>
                  );
                }}
              </Index>
            </div>
            <div
              class="redeven-environment-progress__meter"
              data-plan-state={runtimeLifecycle()?.plan_state ?? 'executing'}
              aria-hidden="true"
            >
              <span style={{ width: `${stagePercent()}%` }} />
            </div>
            <div class="redeven-environment-progress__meta">
              <Show when={stepProgress() || runtimeLifecycle()}>
                <span>
                  {props.i18n.t('progress.stepOf', {
                    current: Math.max(1, phaseSequence().findIndex((step) => step.phase === (
                      stepProgress()?.active_step_id ?? runtimeLifecycle()?.active_step_id
                    )) + 1),
                    total: phaseSequence().length,
                  })}
                </span>
              </Show>
              <Show when={!stepProgress() && runtimeLifecycle()?.plan_state === 'planning'}>
                <span>{localizedProgressPlanningLabel(props.i18n, props.progress.action)}</span>
              </Show>
              <Show when={!stepProgress() && runtimeTargetDetail()}>
                {(detail) => <span>{detail()}</span>}
              </Show>
              <Show when={!stepProgress() && !runtimeTargetDetail() && openTargetDetail()}>
                {(detail) => <span>{detail()}</span>}
              </Show>
              <Show when={activeStageElapsedSeconds() >= 5}>
                <span>
                  {props.i18n.t('progress.stageElapsed', {
                    seconds: activeStageElapsedSeconds(),
                  })}
                </span>
              </Show>
            </div>
            {renderFailureNotice()}
          </>
        </Show>
      </div>
      <Show when={hasPanelActions()}>
        <div class="redeven-action-popover__action-footer">
          {renderNextActionGroups()}
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
                  <Show
                    when={action().icon === 'alert_triangle'}
                    fallback={(
                      <Show
                        when={action().icon === 'refresh'}
                        fallback={<ExternalLink class="h-3.5 w-3.5" />}
                      >
                        <Refresh class="h-3.5 w-3.5" />
                      </Show>
                    )}
                  >
                    <AlertTriangle class="h-3.5 w-3.5" />
                  </Show>
                  {action().label}
                </Button>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function overlayStatusIconTone(tone: EnvironmentActionOverlayTone): 'warning' | 'neutral' {
  return tone;
}

function EnvironmentPrimaryActionPanel(
  props: Readonly<{
    i18n: DesktopI18n;
    overlay: Extract<EnvironmentPrimaryActionOverlayModel, Readonly<{ kind: 'popover' }>>;
    environmentID: string;
    busyState?: DesktopLauncherBusyState;
    operationState: EnvironmentOperationState;
    session: EnvironmentGuidanceSessionState;
    onRunAction: (action: EnvironmentActionModel) => void;
  }>,
) {
  const notice = createMemo(() => (props.overlay.actions.length > 0 ? guidanceSessionNotice(props.session) : null));
  const localizedNotice = createMemo(() => {
    const current = notice();
    if (!current) {
      return null;
    }
    const localized = {
      ...current,
      title: localizedOverlayTitle(props.i18n, current.title),
      detail: localizedRuntimeMessage(props.i18n, current.detail),
    };
    return localized.title === props.overlay.title && localized.detail === props.overlay.detail ? null : localized;
  });
  const panelBusy = createMemo(() => props.session?.pending_intent !== null);
  const iconTone = createMemo(() => overlayStatusIconTone(props.overlay.tone));
  const openFlowSteps = createMemo(() => {
    const intent = props.session?.pending_intent;
    if (intent !== 'open_with_preflight' && intent !== 'initialize_and_open' && intent !== 'start_and_open') {
      return [] as const;
    }
    const active = props.session?.open_flow_stage ?? 'checking_access';
    const steps = [
      {
        key: 'checking_access',
        label: props.i18n.t('environmentOpenFlow.checkAccess'),
      },
      ...(intent === 'open_with_preflight'
        ? []
        : [
            ...(intent === 'initialize_and_open'
              ? [
                  {
                    key: 'preparing_environment',
                    label: props.i18n.t('environmentOpenFlow.prepareEnvironment'),
                  },
                ]
              : []),
            {
              key: 'starting_environment',
              label: props.i18n.t('environmentOpenFlow.startEnvironment'),
            },
            {
              key: 'opening_workspace',
              label: props.i18n.t('environmentOpenFlow.openWorkspace'),
            },
          ]),
    ];
    const activeIndex = steps.findIndex((candidate) => candidate.key === active);
    return steps.map((step, index) => ({
      ...step,
      state: index < activeIndex ? 'done' : step.key === active ? 'active' : 'pending',
    }));
  });

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
      <Show when={openFlowSteps().length > 0}>
        <div
          class="redeven-environment-progress__steps mt-3"
          aria-label={props.i18n.t('environmentOpenFlow.progressLabel')}
        >
          <Index each={openFlowSteps()}>
            {(step, index) => {
              const state = () => step().state;
              const isLast = () => index === openFlowSteps().length - 1;
              return (
                <div class="redeven-environment-progress__step" data-state={state()}>
                  <div class="redeven-environment-progress__step-connector">
                    <span class="redeven-environment-progress__step-dot" data-state={state()} aria-hidden="true" />
                    <Show when={!isLast()}>
                      <span class="redeven-environment-progress__step-line" data-state={state()} aria-hidden="true" />
                    </Show>
                  </div>
                  <span class="min-w-0">
                    <span class="redeven-environment-progress__step-label" data-state={state()}>
                      {step().label}
                    </span>
                  </span>
                </div>
              );
            }}
          </Index>
        </div>
      </Show>
      <Show when={props.overlay.actions.length > 0}>
        <div class="redeven-action-popover__actions">
          <For each={props.overlay.actions}>
            {(item) => {
              const loading = () =>
                isEnvironmentActionBusy(item.action, props.operationState, props.busyState, props.environmentID);
              const isSecondary = item.emphasis === 'secondary';
              const secondaryIconOnly = () => isSecondary && props.overlay.actions.length > 1;
              const showsRefreshIcon = item.action.intent === 'refresh_runtime';
              return (
                <div class={secondaryIconOnly() ? 'relative' : 'relative flex-1'}>
                  <Button
                    size="sm"
                    variant={item.emphasis === 'primary' ? 'default' : 'outline'}
                    class={
                      secondaryIconOnly()
                        ? 'aspect-square p-0'
                        : cn('w-full justify-center', showsRefreshIcon && 'gap-1.5')
                    }
                    loading={loading()}
                    disabled={panelBusy() && !loading()}
                    onClick={() => props.onRunAction(item.action)}
                    title={secondaryIconOnly() ? item.label : undefined}
                    aria-label={secondaryIconOnly() ? item.label : undefined}
                  >
                    <Show
                      when={secondaryIconOnly()}
                      fallback={
                        <>
                          <Show when={showsRefreshIcon}>
                            <Refresh class="h-3.5 w-3.5" />
                          </Show>
                          {item.label}
                        </>
                      }
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
                        class="redeven-welcome-loading-shimmer-overlay"
                        data-shimmer-surface={welcomeLoadingShimmerSurface(
                          item.emphasis === 'primary' ? 'default' : 'outline',
                        )}
                        aria-hidden="true"
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
    case 'reinstall_target':
      return AlertTriangle;
    case 'pair_gateway':
      return ShieldCheck;
    case 'connect_provider_runtime':
      return ShieldCheck;
    case 'disconnect_provider_runtime':
      return Shield;
    default:
      return null;
  }
}

function welcomeLoadingShimmerSurface(
  variant: EnvironmentActionModel['variant'],
): 'primary' | 'surface' {
  return variant === 'outline' ? 'surface' : 'primary';
}

function splitMenuItemToneData(intent: EnvironmentActionIntent): string {
  switch (intent) {
    case 'stop_runtime':
    case 'reinstall_target':
      return 'danger';
    case 'start_runtime':
    case 'pair_gateway':
    case 'connect_provider_runtime':
      return 'primary';
    case 'disconnect_provider_runtime':
      return 'accent';
    default:
      return '';
  }
}

function gatewaySplitMenuItemToneData(intent: GatewaySourceActionModel['intent']): string {
  switch (intent) {
    case 'disable_gateway':
      return 'accent';
    case 'refresh_gateway':
      return 'primary';
    default:
      return '';
  }
}

function progressTriggerClassName(presentation: EnvironmentProgressPrimaryPresentation): string {
  return presentation.kind === 'progress_trigger'
    ? 'redeven-split-action-trigger--progress'
    : 'redeven-split-action-trigger--attention';
}

function environmentActionUsesLifecycleOwner(action: EnvironmentActionModel): boolean {
  return (
    isEnvironmentLifecycleDisclosureIntent(action.intent) ||
    action.intent === 'open' ||
    action.intent === 'open_with_preflight' ||
    action.intent === 'start_and_open'
  );
}

function localizedPrimaryProgressPresentation(
  i18n: DesktopI18n,
  presentation: EnvironmentProgressPrimaryPresentation | null,
): EnvironmentProgressPrimaryPresentation | null {
  if (!presentation) {
    return null;
  }
  const label = i18n.t(presentation.label_key);
  return {
    ...presentation,
    label,
    ariaLabel: presentation.kind === 'progress_trigger'
      ? i18n.t('progress.showProgress', { label })
      : i18n.t('progress.showDetails', { label }),
  };
}

function EnvironmentSplitActionButton(
  props: Readonly<{
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
    operationState: EnvironmentOperationState;
    cancelOperation: (progress: DesktopLauncherActionProgress) => void;
    dismissOperation: (progress: DesktopLauncherActionProgress) => void;
    copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
    refreshEnvironmentRuntime: () => void;
    runDesktopUpdateHandoff: (environmentID: string, label?: string) => Promise<void>;
    onRunAction: (action: EnvironmentActionModel) => void;
    onRunGuidanceAction: (action: EnvironmentActionModel) => void;
  }>,
) {
  const hasMenuActions = createMemo(() => props.presentation.menu_actions.length > 0);
  const guidanceNotice = createMemo(() => guidanceSessionNotice(props.guidanceSession));
  const sessionPopoverOverlay = createMemo<
    Extract<EnvironmentPrimaryActionOverlayModel, Readonly<{ kind: 'popover' }>> | undefined
  >(() => {
    const notice = guidanceNotice();
    if (!notice) {
      return undefined;
    }
    const recoveryAction = props.guidanceSession?.recovery_action;
    const retryIntent = props.guidanceSession?.retry_intent;
    const retryAction = recoveryAction
      ? {
          label:
            recoveryAction === 'update_runtime'
              ? props.i18n.t('environmentAction.updateRuntimeAndOpen')
              : recoveryAction === 'update_desktop'
                ? props.i18n.t('environmentAction.updateRedevenDesktop')
                : props.i18n.t('environmentAction.refreshStatus'),
          emphasis: 'primary' as const,
          action: {
            intent: recoveryAction,
            label:
              recoveryAction === 'update_runtime'
                ? props.i18n.t('environmentAction.updateRuntimeAndOpen')
                : recoveryAction === 'update_desktop'
                  ? props.i18n.t('environmentAction.updateRedevenDesktop')
                  : props.i18n.t('environmentAction.refreshStatus'),
            enabled: true,
            variant: 'default' as const,
            ...(recoveryAction === 'update_runtime' ? { continue_open_after_completion: true } : {}),
          },
        }
      : retryIntent
        ? {
            label:
              retryIntent === 'request_open_access'
                ? props.i18n.t('environmentAction.requestAccess')
                : retryIntent === 'start_and_open'
                  ? props.i18n.t('environmentAction.startAndOpen')
                  : retryIntent === 'open_with_preflight'
                    ? props.i18n.t('environmentAction.open')
                    : props.i18n.t('environmentAction.retryInitialization'),
            emphasis: 'primary' as const,
            action: {
              intent: retryIntent,
              label:
                retryIntent === 'request_open_access'
                  ? props.i18n.t('environmentAction.requestAccess')
                  : retryIntent === 'start_and_open'
                    ? props.i18n.t('environmentAction.startAndOpen')
                    : retryIntent === 'open_with_preflight'
                      ? props.i18n.t('environmentAction.open')
                      : props.i18n.t('environmentAction.retryInitialization'),
              enabled: true,
              variant: 'default' as const,
            },
          }
        : null;
    return {
      kind: 'popover',
      tone: notice.tone === 'warning' ? 'warning' : 'neutral',
      eyebrow:
        notice.tone === 'success'
          ? props.i18n.t('progress.ready')
          : notice.tone === 'error'
            ? props.i18n.t('progress.needsAttention')
            : props.i18n.t('progress.running'),
      title: localizedOverlayTitle(props.i18n, notice.title),
      detail: localizedRuntimeMessage(props.i18n, notice.detail),
      actions: retryAction ? [retryAction] : [],
    };
  });
  const panelProgress = createMemo(() => props.operationState.panelProgress);
  const hasPanelProgress = createMemo(() => panelProgress() !== null);
  const progressPanelVisible = createMemo(() => props.progressOpen && hasPanelProgress());
  const primaryProgressPresentation = createMemo(() =>
    localizedPrimaryProgressPresentation(props.i18n, environmentProgressPrimaryPresentation(panelProgress())),
  );
  const primaryActionOverlay = createMemo(() =>
    primaryProgressPresentation() || progressPanelVisible()
      ? undefined
      : (sessionPopoverOverlay() ?? props.presentation.primary_action_overlay),
  );
  const tooltipOverlay = createMemo<
    Extract<EnvironmentPrimaryActionOverlayModel, Readonly<{ kind: 'tooltip' }>> | undefined
  >(() => {
    const overlay = primaryActionOverlay();
    return overlay?.kind === 'tooltip' ? overlay : undefined;
  });
  const popoverOverlay = createMemo<
    Extract<EnvironmentPrimaryActionOverlayModel, Readonly<{ kind: 'popover' }>> | undefined
  >(() => {
    const overlay = primaryActionOverlay();
    return overlay?.kind === 'popover' ? overlay : undefined;
  });
  const primaryActionLoading = createMemo(
    () => props.presentation.primary_action.enabled && props.operationState.actionsDisabled,
  );
  const blockedPrimaryActionDisabled = createMemo(
    () =>
      popoverOverlay() !== undefined &&
      popoverOverlay()!.actions.length > 0 &&
      !props.presentation.primary_action.enabled,
  );
  const primaryFallbackRunsAction = createMemo(
    () =>
      props.presentation.primary_action.enabled &&
      (popoverOverlay() === undefined || popoverOverlay()?.actions.length === 0),
  );
  const popoverOpen = createMemo(
    () => progressPanelVisible() || (props.guidanceOpen && popoverOverlay() !== undefined),
  );
  const shimmerBlocked = createMemo(() => (primaryProgressPresentation() ? false : blockedPrimaryActionDisabled()));
  const primaryButtonClass = createMemo(() =>
    cn('w-full justify-center', hasMenuActions() && 'rounded-r-none border-r-0'),
  );
  const renderPrimaryActionIcon = () =>
    props.presentation.primary_action.intent === 'request_open_access' ? (
      <ShieldCheck class="mr-1 h-3.5 w-3.5" />
    ) : null;
  const renderEnvironmentProgressTriggerIcon = (icon: 'play' | 'stop') => {
    const ProgressIcon = icon === 'stop' ? Stop : Play;
    return <ProgressIcon class="redeven-split-action-trigger__icon h-3.5 w-3.5" />;
  };
  const renderEnvironmentProgressPresentationIcon = (presentation: EnvironmentProgressPrimaryPresentation) =>
    presentation.kind === 'progress_trigger' ? (
      renderEnvironmentProgressTriggerIcon(presentation.icon)
    ) : (
      <AlertTriangle class="redeven-split-action-trigger__icon h-3.5 w-3.5" />
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
          fallback={
            <Show when={tooltipOverlay()} fallback={renderPrimaryButton()}>
              <DesktopTooltip content={tooltipOverlay()!.message} placement="top" anchorClass="flex w-full">
                {renderPrimaryButton()}
              </DesktopTooltip>
            </Show>
          }
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
            content={
              <div style={{ display: 'grid' }}>
                <div
                  class="redeven-popover-panel-collapse"
                  classList={{
                    'redeven-popover-panel-collapse--open': !progressPanelVisible(),
                  }}
                >
                  <div>
                    <Show when={popoverOverlay()}>
                      {(overlay) => (
                        <EnvironmentPrimaryActionPanel
                          i18n={props.i18n}
                          overlay={overlay()}
                          environmentID={props.environmentID}
                          busyState={props.busyState}
                          operationState={props.operationState}
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
                  classList={{
                    'redeven-popover-panel-collapse--open': progressPanelVisible(),
                  }}
                >
                  <div>
                    <Show when={panelProgress()}>
                      {(p) => (
                        <EnvironmentProgressPanel
                          i18n={props.i18n}
                          progress={p()}
                          primaryAction={props.presentation.primary_action}
                          primaryActionBusy={props.operationState.actionsDisabled}
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
                                const updateAction = props.presentation.menu_actions.find(
                                  (item) => item.action.intent === 'update_runtime',
                                )?.action ?? {
                                  intent: 'update_runtime' as const,
                                  label: 'Update runtime',
                                  enabled: true,
                                  variant: 'default' as const,
                                };
                                if (updateAction) {
                                  props.onRunAction({
                                    ...updateAction,
                                    ...(p().open_progress ? { continue_open_after_completion: true } : {}),
                                  });
                                }
                                break;
                              }
                              case 'manage_desktop_update': {
                                void props.runDesktopUpdateHandoff(props.environmentID, props.environmentLabel);
                                break;
                              }
                              case 'reinstall_target': {
                                if (action.operation_key && action.preflight_id) {
                                  props.onRunAction({
                                    intent: 'reinstall_target',
                                    label: 'Reinstall Redeven',
                                    enabled: true,
                                    variant: 'outline',
                                    operation_key: action.operation_key,
                                    preflight_id: action.preflight_id,
                                    reinstall_mode: action.mode ?? p().reinstall_preview?.mode ?? 'wipe_data',
                                  });
                                }
                                break;
                              }
                              case 'retry': {
                                const retryAction = environmentActionForLauncherRetry(action.retry_action);
                                if (retryAction) {
                                  props.onRunAction(retryAction);
                                }
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
                            // Reinstall confirmation and execution are one timeline. Keep the
                            // existing panel open while the confirmed operation advances.
                            if (action.intent !== 'reinstall_target') {
                              props.onProgressOpenChange(false);
                            }
                            closeMenu();
                            props.onRunAction(action);
                          }}
                        />
                      )}
                    </Show>
                  </div>
                </div>
              </div>
            }
            anchorClass="flex w-full"
            allowMainAxisOverflow={false}
            placementLock="top-inline-shift"
            popoverAriaLabel={
              progressPanelVisible()
                ? panelProgress()
                  ? localizedProgressTitle(props.i18n, panelProgress()!)
                  : props.i18n.t('progress.environmentProgress')
                : (popoverOverlay()?.title ?? '')
            }
          >
            <Show
              when={primaryProgressPresentation()}
              fallback={
                <Button
                  size="sm"
                  variant={props.presentation.primary_action.variant}
                  class={cn(
                    primaryButtonClass(),
                    blockedPrimaryActionDisabled() && 'redeven-split-action-trigger--blocked',
                  )}
                  style={{
                    'min-width': 'var(--redeven-split-action-primary-min-width)',
                  }}
                  disabled={props.operationState.actionsDisabled && primaryFallbackRunsAction()}
                  aria-disabled={blockedPrimaryActionDisabled() ? true : undefined}
                  aria-haspopup={popoverOverlay() ? 'dialog' : undefined}
                  aria-expanded={popoverOverlay() ? props.guidanceOpen : undefined}
                  aria-label={
                    blockedPrimaryActionDisabled()
                      ? blockedPrimaryActionTriggerLabel(props.i18n, props.presentation.primary_action.label)
                      : undefined
                  }
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
                  <Show when={blockedPrimaryActionDisabled()} fallback={props.presentation.primary_action.label}>
                    <span class="redeven-split-action-trigger__content">
                      {props.presentation.primary_action.intent === 'request_open_access' ? (
                        <ShieldCheck class="redeven-split-action-trigger__icon h-3.5 w-3.5" />
                      ) : (
                        <Lock class="redeven-split-action-trigger__icon h-3.5 w-3.5" />
                      )}
                      <span>{props.presentation.primary_action.label}</span>
                    </span>
                  </Show>
                </Button>
              }
            >
              {(presentation) => {
                return (
                  <Button
                    size="sm"
                    variant={props.presentation.primary_action.variant}
                    class={cn(primaryButtonClass(), progressTriggerClassName(presentation()))}
                    style={{
                      'min-width': 'var(--redeven-split-action-primary-min-width)',
                    }}
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
          <Show when={props.operationState.actionsDisabled}>
            <Motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              class={shimmerBlocked() ? 'redeven-blocked-shimmer-overlay' : 'redeven-welcome-loading-shimmer-overlay'}
              data-shimmer-surface={
                shimmerBlocked() ? undefined : welcomeLoadingShimmerSurface(props.presentation.primary_action.variant)
              }
              aria-hidden="true"
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
              const disabledByOperation = () =>
                props.operationState.actionsDisabled && environmentActionUsesLifecycleOwner(item.action);
              const disabledReason = () => {
                if (!item.action.enabled) {
                  return item.action.disabled_reason;
                }
                if (!disabledByOperation()) {
                  return undefined;
                }
                const activeProgress = props.operationState.activeProgress;
                return activeProgress
                  ? props.i18n.t('environmentAction.blockedByActiveOperation', {
                      operation: localizedProgressTitle(props.i18n, activeProgress),
                      action: item.label,
                    })
                  : props.i18n.t('environmentAction.waitForOperationAcceptance', {
                      action: item.label,
                    });
              };
              const disabled = () => !item.action.enabled || disabledByOperation();
              return (
                <button
                  type="button"
                  role="menuitem"
                  class="redeven-split-menu-item"
                  data-tone={tone() || undefined}
                  disabled={disabled()}
                  title={disabledReason()}
                  aria-describedby={
                    disabled() && disabledReason() ? `${props.environmentID}-${item.id}-disabled-reason` : undefined
                  }
                  onClick={() => {
                    if (disabled()) {
                      return;
                    }
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
                  <Show when={disabled() && disabledReason()}>
                    <span id={`${props.environmentID}-${item.id}-disabled-reason`} class="sr-only">
                      {disabledReason()}
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

function EnvironmentConnectionCard(
  props: Readonly<{
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
    endpointPopoverOpen: boolean;
    onEndpointPopoverOpenChange: (open: boolean) => void;
    selectedEndpointValue?: string;
    selectEndpointForQRCode: (endpointValue: string) => void;
    guidanceSession: EnvironmentGuidanceSessionState;
    setGuidanceSession: (state: EnvironmentGuidanceSessionState) => void;
    beginLifecycleDisclosure: (
      intent: EnvironmentLifecycleDisclosureIntent,
      attempt: EnvironmentLifecycleAttempt,
    ) => void;
    abandonLifecycleDisclosure: (attempt: EnvironmentLifecycleAttempt) => void;
    bindLifecycleDisclosure: (attempt: EnvironmentLifecycleAttempt, operation: EnvironmentLifecycleAttempt) => void;
    openEnvironment: (
      environment: DesktopEnvironmentEntry,
      errorTarget?: 'connect' | 'dialog',
      route?: 'auto' | DesktopLocalEnvironmentStateRoute,
    ) => Promise<boolean>;
    runLocalEnvironmentAction: (
      environment: DesktopEnvironmentEntry,
      action: EnvironmentActionModel,
      errorTarget?: 'connect' | 'dialog' | 'settings',
      attempt?: EnvironmentLifecycleAttempt,
      bindOperation?: (operation: EnvironmentLifecycleAttempt) => void,
    ) => Promise<boolean>;
    refreshEnvironmentRuntime: (
      environment: DesktopEnvironmentEntry,
      errorTarget?: 'connect' | 'dialog' | 'settings',
    ) => Promise<boolean>;
    openEnvironmentFlowerSurface: (environment: DesktopEnvironmentEntry, anchor?: FlowerTurnLauncherAnchor) => void;
    runEnvironmentGuidanceAction: (
      environment: DesktopEnvironmentEntry,
      action: EnvironmentActionModel,
      updateSession?: (state: EnvironmentGuidanceSessionState) => void,
      attempt?: EnvironmentLifecycleAttempt,
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
  }>,
) {
  const card = createMemo(() => {
    const model = buildEnvironmentCardModel(props.environment);
    return {
      ...model,
      kind_label: localizedFactLabel(props.i18n, model.kind_label),
      status_label: localizedEnvironmentStatusLabel(props.i18n, model.status_label),
      runtime_started_label: localizedRuntimeStartedLabel(props.i18n, model.runtime_started_label),
    };
  });
  const facts = createMemo(() =>
    buildEnvironmentCardFactsModel(props.environment).map((fact) => localizedEnvironmentFact(props.i18n, fact)),
  );

  const environmentActionModel = createMemo(() => buildProviderBackedEnvironmentActionModel(props.environment));
  const environmentActionPresentation = createMemo(() =>
    localizedEnvironmentActionPresentation(props.i18n, environmentActionModel().action_presentation),
  );
  const operationState = createMemo(() =>
    environmentOperationState(props.environment, props.actionProgress, props.busyState),
  );
  const isCardOpen = createMemo(() => props.environment.window_state === 'open');
  const isPinBusy = createMemo(() =>
    busyStateMatchesEnvironment(props.busyState, props.environment.id, [
      'set_provider_environment_pinned',
      'set_environment_registration_pinned',
    ]),
  );
  const isContainerRuntimeTarget = createMemo(
    () => props.environment.managed_runtime_placement?.kind === 'container_process',
  );
  const deleteTitle = createMemo(() => props.i18n.t('environmentCenter.removeEnvironment'));
  const runOpenWithPreflight = async (action: EnvironmentActionModel): Promise<void> => {
    const nextSession = startEnvironmentGuidanceIntent(
      props.guidanceSession,
      props.environment.id,
      'open_with_preflight',
    );
    props.onPrimaryActionGuidanceOpenChange(true);
    props.setGuidanceSession(nextSession);
    const resolution = await props.runEnvironmentGuidanceAction(props.environment, action, props.setGuidanceSession);
    props.setGuidanceSession(resolution.next_session);
    if (resolution.close_panel) {
      props.onPrimaryActionGuidanceOpenChange(false);
    }
  };

  return (
    <Card
      class={cn('redeven-environment-card h-full overflow-hidden', isCardOpen() && 'redeven-environment-card--open')}
    >
      <CardHeader class="px-4 pb-2.5 pt-4">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="mb-2 flex items-center gap-2">
              <Tag
                variant={environmentKindTagVariant(props.environment.kind)}
                tone="soft"
                size="sm"
                class="cursor-default whitespace-nowrap"
              >
                {card().kind_label}
              </Tag>
              <EnvironmentStatusIndicator tone={card().status_tone}>{card().status_label}</EnvironmentStatusIndicator>
            </div>
            <CardTitle
              class="truncate text-sm font-semibold leading-5 tracking-[0.01em]"
              title={props.environment.label}
            >
              {props.environment.label}
            </CardTitle>
            <div class="mt-1.5 flex flex-wrap items-center">
              <svg class="redeven-card-l-line" data-tone={card().status_tone} viewBox="0 0 12 20">
                <path d="M 1 0 L 1 10 L 11 10" />
              </svg>
              <span class="redeven-card-runtime-chip">
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
                aria-label={props.i18n.t('environmentCenter.refreshRuntimeStatusForLabel', {
                  label: props.environment.label,
                })}
                disabled={operationState().actionsDisabled}
                onClick={() => {
                  void props.refreshEnvironmentRuntime(props.environment, 'connect');
                }}
              >
                <Refresh class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </span>
          </DesktopTooltip>
          <DesktopTooltip
            content={props.i18n.t('environmentCenter.askFlowerForLabel', {
              label: props.environment.label,
            })}
            placement="top"
          >
            <button
              type="button"
              class="redeven-environment-card__flower-button"
              aria-label={props.i18n.t('environmentCenter.askFlowerForLabel', {
                label: props.environment.label,
              })}
              title={props.i18n.t('environmentCenter.askFlowerForLabel', {
                label: props.environment.label,
              })}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                props.openEnvironmentFlowerSurface(props.environment, {
                  x: rect.right,
                  y: rect.bottom,
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
          endpointPopoverOpen={props.endpointPopoverOpen}
          onEndpointPopoverOpenChange={props.onEndpointPopoverOpenChange}
          selectedEndpointValue={props.selectedEndpointValue}
          selectEndpointForQRCode={props.selectEndpointForQRCode}
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
          operationState={operationState()}
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
            void (async () => {
              if (operationState().actionsDisabled && environmentActionUsesLifecycleOwner(action)) {
                if (operationState().activeProgress) {
                  props.onLifecycleProgressOpenChange(true);
                }
                return;
              }
              if (action.continue_open_after_completion) {
                await runOpenWithPreflight({
                  intent: 'open_with_preflight',
                  label: props.i18n.t('environmentAction.open'),
                  enabled: true,
                  variant: 'default',
                });
                return;
              }
              if (action.intent === 'update_desktop') {
                props.setGuidanceSession(null);
                props.onPrimaryActionGuidanceOpenChange(false);
              }
              if (action.intent === 'open_with_preflight') {
                await runOpenWithPreflight(action);
                return;
              }
              let lifecycleAttempt: EnvironmentLifecycleAttempt | undefined;
              if (environmentActionStartsLifecycleDisclosure(action)) {
                lifecycleAttempt = createEnvironmentLifecycleAttempt(props.environment.id, action.intent);
                props.beginLifecycleDisclosure(action.intent, lifecycleAttempt);
              } else if (isEnvironmentGuidancePendingIntent(action.intent)) {
                props.setGuidanceSession(
                  startEnvironmentGuidanceIntent(props.guidanceSession, props.environment.id, action.intent),
                );
                props.onPrimaryActionGuidanceOpenChange(true);
              }
              const completed = await props.runLocalEnvironmentAction(
                props.environment,
                action,
                'connect',
                lifecycleAttempt,
                lifecycleAttempt
                  ? (operation) => props.bindLifecycleDisclosure(lifecycleAttempt, operation)
                  : undefined,
              );
              if (!completed && lifecycleAttempt) {
                props.abandonLifecycleDisclosure(lifecycleAttempt);
              }
            })();
          }}
          onRunGuidanceAction={(action) => {
            void (async () => {
              let lifecycleAttempt: EnvironmentLifecycleAttempt | undefined;
              if (environmentActionStartsLifecycleDisclosure(action)) {
                lifecycleAttempt = createEnvironmentLifecycleAttempt(props.environment.id, action.intent);
                props.beginLifecycleDisclosure(action.intent, lifecycleAttempt);
              } else if (isEnvironmentGuidancePendingIntent(action.intent)) {
                props.setGuidanceSession(
                  startEnvironmentGuidanceIntent(props.guidanceSession, props.environment.id, action.intent),
                );
              }
              const resolution = await props.runEnvironmentGuidanceAction(
                props.environment,
                action,
                props.setGuidanceSession,
                lifecycleAttempt,
              );
              props.setGuidanceSession(lifecycleAttempt ? null : resolution.next_session);
              if (resolution.close_panel) {
                props.onPrimaryActionGuidanceOpenChange(false);
              }
            })();
          }}
        />
        <div class="flex items-center gap-0.5">
          <Show when={props.environment.kind !== 'gateway_environment'}>
            <DesktopTooltip
              content={
                props.environment.pinned
                  ? props.i18n.t('environmentCenter.unpin')
                  : props.i18n.t('environmentCenter.pin')
              }
              placement="top"
            >
              <ConsoleActionIconButton
                title={
                  props.environment.pinned
                    ? props.i18n.t('environmentCenter.unpinEnvironment')
                    : props.i18n.t('environmentCenter.pinEnvironment')
                }
                aria-label={
                  props.environment.pinned
                    ? props.i18n.t('environmentCenter.unpinLabel', {
                        label: props.environment.label,
                      })
                    : props.i18n.t('environmentCenter.pinLabel', {
                        label: props.environment.label,
                      })
                }
                active={props.environment.pinned}
                disabled={isPinBusy()}
                onClick={() => {
                  void props.toggleEnvironmentPinned(props.environment);
                }}
              >
                <Pin class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
          <Show when={props.environment.can_edit}>
            <DesktopTooltip content={props.i18n.t('common.settings')} placement="top">
              <ConsoleActionIconButton
                title={
                  isContainerRuntimeTarget()
                    ? props.i18n.t('environmentCenter.runtimeTargetSettings')
                    : props.environment.kind === 'local_environment'
                      ? props.i18n.t('environmentCenter.environmentSettings')
                      : props.i18n.t('environmentCenter.connectionSettings')
                }
                aria-label={
                  props.environment.kind === 'local_environment' && !isContainerRuntimeTarget()
                    ? props.i18n.t('environmentCenter.settingsForLabel', {
                        label: props.environment.label,
                      })
                    : props.i18n.t('environmentCenter.connectionSettingsForLabel', { label: props.environment.label })
                }
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
                aria-label={props.i18n.t('environmentCenter.removeLabel', {
                  label: props.environment.label,
                })}
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
          <ConsoleChipActionButton
            onClick={(event) => {
              event.stopPropagation();
              props.openCreateConnectionDialog('', 'gateway_url_profile');
            }}
          >
            {props.i18n.t('connectionDialog.throughGateway')}
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
        ? i18n.t('environmentCenter.mostRecentProviderState', {
            state: runtimeLabel,
          })
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
      return i18n.t('providerRuntimeLink.targetNotRunning', {
        runtime: runtimeLabel,
      });
    case 'runtime_control_missing':
      return i18n.t('providerRuntimeLink.runtimeControlMissing', {
        runtime: runtimeLabel,
      });
    case 'provider_link_unsupported':
      return i18n.t('providerRuntimeLink.providerLinkUnsupported', {
        runtime: runtimeLabel,
      });
    case 'already_linked':
      return i18n.t('providerRuntimeLink.alreadyLinked', { runtime: runtimeLabel, environment: providerEnvironment.label });
    case 'provider_environment_occupied':
      return providerEnvironment.occupancy.state === 'occupied_by_known_runtime' && providerEnvironment.occupancy.runtime_label
        ? i18n.t('providerRuntimeLink.providerEnvironmentOccupiedKnown', {
            environment: providerEnvironment.label,
            runtime: providerEnvironment.occupancy.runtime_label,
          })
        : i18n.t('providerRuntimeLink.providerEnvironmentOccupiedUnknown', {
            environment: providerEnvironment.label,
          });
    case 'linked_elsewhere':
      return i18n.t('providerRuntimeLink.linkedElsewhere', {
        runtime: runtimeLabel,
      });
    case 'blocked_active_work':
      return i18n.t('providerRuntimeLink.blockedActiveWork', {
        runtime: runtimeLabel,
      });
    case 'blocked_runtime':
      return i18n.t('providerRuntimeLink.blockedRuntime', {
        runtime: runtimeLabel,
      });
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
  lifecycleProgressFocusRequest: LifecycleProgressFocusRequest | null;
  consumeLifecycleProgressFocusRequest: (requestID: number) => void;
  gatewaySourceFilter: string;
  gatewayQuery: string;
  openCreateGatewaySetup: (gateway?: DesktopGatewaySource, focusSection?: DesktopGatewayResolveFocus) => void;
  runGatewayLauncherAction: (request: DesktopLauncherActionRequest) => Promise<void>;
  openCreateGatewayEnvironment: (gateway: DesktopGatewaySource) => void;
  viewGatewayEnvironments: (gateway: DesktopGatewaySource) => void;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  deleteGateway: (gateway: DesktopGatewaySource) => void;
}>) {
  const [activeGatewayOverlayState, setActiveGatewayOverlayState] = createSignal(closedGatewaySourceOverlayState());
  const [foregroundGatewayActions, setForegroundGatewayActions] = createSignal<Record<string, GatewayForegroundActionSnapshot | null>>({});
  const foregroundGatewayAction = (gatewayID: string): GatewayForegroundActionSnapshot | null => (
    foregroundGatewayActions()[gatewayID] ?? null
  );
  const setForegroundGatewayAction = (
    gatewayID: string,
    next: GatewayForegroundActionSnapshot | null | ((current: GatewayForegroundActionSnapshot | null) => GatewayForegroundActionSnapshot | null),
  ) => {
    setForegroundGatewayActions((current) => {
      const currentAction = current[gatewayID] ?? null;
      const nextAction = typeof next === 'function' ? next(currentAction) : next;
      if (nextAction === currentAction) {
        return current;
      }
      const updated = { ...current };
      if (nextAction) {
        updated[gatewayID] = nextAction;
      } else {
        delete updated[gatewayID];
      }
      return updated;
    });
  };
  const gatewaySourcesByID = createMemo(() => {
    const record: Record<string, DesktopGatewaySource> = {};
    for (const gateway of props.gatewaySources) {
      record[gateway.gateway_id] = gateway;
    }
    return record;
  });
  const gatewaySourceIDs = createMemo(() => props.gatewaySources.map((gateway) => gateway.gateway_id));
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
    const query = trimString(props.gatewayQuery);
    const hasQuery = query !== '';
    return props.gatewaySources.filter((gateway) => {
      if (props.gatewaySourceFilter !== '' && gatewaySourceFilterValue(gateway.gateway_id) !== props.gatewaySourceFilter) {
        return false;
      }
      return !hasQuery || gatewaySourceMatchesQuery(gateway, query);
    });
  });
  const visibleGatewaySourceIDs = createMemo(() => visibleGatewaySources().map((gateway) => gateway.gateway_id));
  const renderedGatewaySourceIDs = createMemo(() => gatewaySourceIDsWithActiveOverlay(
    visibleGatewaySourceIDs(),
    gatewaySourceIDs(),
    activeGatewayOverlayState(),
  ));
  createEffect(() => {
    setActiveGatewayOverlayState((current) => reconcileGatewaySourceOverlayState(current, props.gatewaySources));
  });
  const setGatewayActionPopoverOpen = (gatewayID: string, open: boolean) => {
    setActiveGatewayOverlayState((current) => (
      open
        ? openGatewaySourceOverlayState('action_popover', gatewayID)
        : closeGatewaySourceOverlayState(current, 'action_popover', gatewayID)
    ));
  };
  const setGatewayMoreActionsMenuOpen = (gatewayID: string, open: boolean) => {
    setActiveGatewayOverlayState((current) => (
      open
        ? openGatewaySourceOverlayState('more_actions_menu', gatewayID)
        : closeGatewaySourceOverlayState(current, 'more_actions_menu', gatewayID)
    ));
  };

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
        when={renderedGatewaySourceIDs().length > 0}
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
            <For each={renderedGatewaySourceIDs()}>
              {(gatewayID) => {
                const gateway = () => gatewaySourcesByID()[gatewayID]!;
                return (
                <GatewaySourceCard
                  i18n={props.i18n}
                  gateway={gateway()}
                  gatewayEntries={gatewayEntriesByGatewayID()[gatewayID] ?? []}
                  foregroundAction={foregroundGatewayAction(gatewayID)}
                  setForegroundAction={(next) => setForegroundGatewayAction(gatewayID, next)}
                  busyState={props.busyState}
                  actionProgress={props.actionProgress}
                  lifecycleProgressFocusRequest={props.lifecycleProgressFocusRequest}
                  consumeLifecycleProgressFocusRequest={props.consumeLifecycleProgressFocusRequest}
                  actionPopoverOpen={gatewaySourceOverlayOpenFor(activeGatewayOverlayState(), 'action_popover', gatewayID)}
                  onActionPopoverOpenChange={(open) => setGatewayActionPopoverOpen(gatewayID, open)}
                  moreActionsMenuOpen={gatewaySourceOverlayOpenFor(activeGatewayOverlayState(), 'more_actions_menu', gatewayID)}
                  onMoreActionsMenuOpenChange={(open) => setGatewayMoreActionsMenuOpen(gatewayID, open)}
                  openCreateGatewaySetup={props.openCreateGatewaySetup}
                  runGatewayLauncherAction={props.runGatewayLauncherAction}
                  openCreateGatewayEnvironment={props.openCreateGatewayEnvironment}
                  viewGatewayEnvironments={props.viewGatewayEnvironments}
                  cancelOperation={props.cancelOperation}
                  dismissOperation={props.dismissOperation}
                  copyOperationDiagnostics={props.copyOperationDiagnostics}
                  deleteGateway={props.deleteGateway}
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

type GatewayForegroundActionSnapshot = Readonly<{
  gateway_id: string;
  started_at_unix_ms: number;
  action: GatewaySourceActionModel;
  gateway: DesktopGatewaySource;
  panel_model: GatewayActionPanelModel;
  owns_progress: boolean;
  operation_key?: string;
  pending_progress?: DesktopLauncherActionProgress;
}>;

type GatewayDiagnosisResultSnapshot = Readonly<{
  gateway_id: string;
  checked_at_unix_ms: number;
  operation_key?: string;
  gateway: DesktopGatewaySource;
  panel_model: GatewayActionPanelModel;
}>;

const GATEWAY_REFRESH_STEP_DEFINITIONS: readonly Readonly<{
  id: string;
  label: string;
}>[] = [
  { id: 'checking_gateway_service', label: 'Checking Gateway service' },
  { id: 'checking_gateway_package', label: 'Checking Gateway package' },
  { id: 'fetching_pairing_challenge', label: 'Fetching pairing challenge' },
  { id: 'saving_trust_profile', label: 'Saving trust profile' },
  { id: 'refreshing_gateway_catalog', label: 'Refreshing Gateway catalog' },
  { id: 'gateway_refreshed', label: 'Gateway refreshed' },
];

function gatewayOperationKeyForAction(gateway: DesktopGatewaySource, action: GatewaySourceActionModel): string | undefined {
  switch (action.intent) {
    case 'refresh_gateway':
    case 'pair_gateway':
      return `${gateway.gateway_id}:refresh`;
    default:
      return undefined;
  }
}

function pendingGatewayRefreshProgress(
  gateway: DesktopGatewaySource,
  operationKey: string,
  startedAtUnixMS: number,
): DesktopLauncherActionProgress {
  return {
    action: 'refresh_gateway',
    operation_key: operationKey,
    subject_kind: 'gateway',
    subject_id: gateway.gateway_id,
    gateway_id: gateway.gateway_id,
    started_at_unix_ms: startedAtUnixMS,
    updated_at_unix_ms: startedAtUnixMS,
    status: 'running',
    phase: 'checking_gateway_service',
    title: 'Refresh Gateway',
    detail: `Desktop is checking ${gateway.display_name} and refreshing its environment catalog.`,
    step_progress: {
      active_step_id: 'checking_gateway_service',
      steps: GATEWAY_REFRESH_STEP_DEFINITIONS.map((step, index) => ({
        id: step.id,
        label: step.label,
        status: index === 0 ? 'running' : 'pending',
      })),
    },
    cancelable: false,
  };
}

function pendingGatewayForegroundProgress(
  gateway: DesktopGatewaySource,
  action: GatewaySourceActionModel,
  operationKey: string | undefined,
  startedAtUnixMS: number,
): DesktopLauncherActionProgress | null {
  if (!operationKey) {
    return null;
  }
  switch (action.intent) {
    case 'refresh_gateway':
    case 'pair_gateway':
      return pendingGatewayRefreshProgress(gateway, operationKey, startedAtUnixMS);
    default:
      return null;
  }
}

function gatewayProgressStartedAt(progress: DesktopLauncherActionProgress | null | undefined): number {
  const startedAt = Number(progress?.started_at_unix_ms);
  return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0;
}

function gatewayProgressTimestamp(progress: DesktopLauncherActionProgress): number {
  const updatedAt = Number(progress.updated_at_unix_ms);
  return Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : gatewayProgressStartedAt(progress);
}

function launcherActionProgressIsTerminal(progress: DesktopLauncherActionProgress | null | undefined): progress is DesktopLauncherActionProgress {
  return progress?.status === 'succeeded'
    || progress?.status === 'failed'
    || progress?.status === 'canceled'
    || progress?.status === 'needs_confirmation'
    || progress?.status === 'cleanup_failed';
}

function gatewayProgressIsActive(progress: DesktopLauncherActionProgress | null | undefined): progress is DesktopLauncherActionProgress {
  return progress?.status === 'running' || progress?.status === 'canceling' || progress?.status === 'cleanup_running';
}

function gatewayProgressNeedsAttention(progress: DesktopLauncherActionProgress | null | undefined): boolean {
  return progress?.status === 'failed' || progress?.status === 'cleanup_failed';
}

function selectForegroundGatewayProgress(
  progressItems: readonly DesktopLauncherActionProgress[],
): DesktopLauncherActionProgress | null {
  return [...progressItems]
    .sort((left, right) => {
      const startedDiff = gatewayProgressStartedAt(right) - gatewayProgressStartedAt(left);
      if (startedDiff !== 0) {
        return startedDiff;
      }
      return gatewayProgressTimestamp(right) - gatewayProgressTimestamp(left);
    })[0] ?? null;
}

function gatewayProgressMatchesSubject(gatewayID: string, progress: DesktopLauncherActionProgress): boolean {
  return progress.subject_kind === 'gateway'
    && (
      progress.gateway_id === gatewayID
      || progress.subject_id === gatewayID
    );
}

function gatewayProgressBelongsToForegroundAction(
  progress: DesktopLauncherActionProgress,
  foreground: GatewayForegroundActionSnapshot,
): boolean {
  const progressStartedAt = gatewayProgressStartedAt(progress);
  if (foreground.operation_key && progress.operation_key === foreground.operation_key) {
    return progressStartedAt > 0 && progressStartedAt >= foreground.started_at_unix_ms;
  }
  const actionKind = gatewaySourceLauncherActionKind(foreground.action);
  if (actionKind === null || progress.action !== actionKind) {
    return false;
  }
  if (gatewayProgressMatchesSubject(foreground.gateway_id, progress)) {
    return progressStartedAt > 0 && progressStartedAt >= foreground.started_at_unix_ms;
  }
  if (!foreground.owns_progress) {
    return false;
  }
  if (
    !gatewaySourceMatchesRuntimeLifecycleProgress(foreground.gateway_id, progress)
    && !(actionKind === 'open_gateway_environment' && gatewayProgressMatchesSubject(foreground.gateway_id, progress))
    && !(progress.step_progress !== undefined && gatewayProgressMatchesSubject(foreground.gateway_id, progress))
  ) {
    return false;
  }
  return progressStartedAt > 0 && progressStartedAt >= foreground.started_at_unix_ms;
}

function gatewayBusyStateBelongsToForegroundAction(
  busyState: DesktopLauncherBusyState,
  gatewayID: string,
  foreground: GatewayForegroundActionSnapshot,
): boolean {
  if (foreground.operation_key && busyState.progress?.operation_key === foreground.operation_key) {
    return busyState.request_started_at_unix_ms > 0 && busyState.request_started_at_unix_ms >= foreground.started_at_unix_ms;
  }
  const actionKind = gatewaySourceLauncherActionKind(foreground.action);
  if (!foreground.owns_progress || actionKind === null) {
    return false;
  }
  if (!busyStateMatchesGateway(busyState, gatewayID, [actionKind])) {
    return false;
  }
  return busyState.request_started_at_unix_ms > 0 && busyState.request_started_at_unix_ms >= foreground.started_at_unix_ms;
}

function gatewayActionShowsWorkflowProgress(action: GatewaySourceActionModel): boolean {
  switch (action.intent) {
    case 'open_gateway_environment':
    case 'refresh_gateway':
      return true;
    default:
      return false;
  }
}

function gatewayProgressCanRecoverForegroundAction(progress: DesktopLauncherActionProgress): boolean {
  switch (progress.action) {
    case 'refresh_gateway':
      return true;
    default:
      return false;
  }
}

function gatewayProgressMatchesAction(
  gateway: DesktopGatewaySource,
  action: GatewaySourceActionModel,
  progress: DesktopLauncherActionProgress,
): boolean {
  if (!gatewayProgressMatchesSubject(gateway.gateway_id, progress)) {
    return false;
  }
  const actionKind = gatewaySourceLauncherActionKind(action);
  if (actionKind && progress.action === actionKind) {
    return true;
  }
  return false;
}

function gatewayProgressCanCompleteForegroundAction(
  gateway: DesktopGatewaySource,
  progress: DesktopLauncherActionProgress,
  foreground: GatewayForegroundActionSnapshot,
): boolean {
  return gatewayProgressBelongsToForegroundAction(progress, foreground)
    || gatewayProgressMatchesAction(gateway, foreground.action, progress);
}

function gatewayForegroundDiagnosisBelongsToRefresh(
  gateway: DesktopGatewaySource,
  foreground: GatewayForegroundActionSnapshot | null,
): boolean {
  if (foreground?.action.intent !== 'refresh_gateway' && foreground?.action.intent !== 'pair_gateway') {
    return false;
  }
  const checkedAtUnixMS = Number(gateway.diagnosis?.checked_at_unix_ms);
  if (!Number.isFinite(checkedAtUnixMS) || checkedAtUnixMS <= 0) {
    return false;
  }
  return checkedAtUnixMS >= foreground.started_at_unix_ms;
}

function gatewayDiagnosisFromCheckProgress(
  gateway: DesktopGatewaySource,
  progress: DesktopLauncherActionProgress,
): DesktopGatewayDiagnosis {
  if (progress.gateway_diagnosis) {
    return progress.gateway_diagnosis;
  }
  if (gateway.diagnosis && gateway.diagnosis.checked_at_unix_ms >= gatewayProgressTimestamp(progress) - 1_000) {
    return gateway.diagnosis;
  }
  return {
    checked_at_unix_ms: gatewayProgressTimestamp(progress),
    classification: gateway.diagnosis?.classification ?? 'ready',
    manageable: false,
    summary: progress.title || 'Gateway diagnostics',
    detail: progress.detail || 'Desktop checked this Gateway.',
    service_state: gateway.service_state,
    trust_state: gateway.trust_state,
    catalog_state: gateway.sync_state,
    ...(gateway.diagnosis?.probe_results ? { probe_results: gateway.diagnosis.probe_results } : {}),
    ...(progress.failure ? {
      error_code: progress.failure.code,
      error_message: progress.failure.summary,
    } : {}),
  };
}

function gatewayWithCheckProgressDiagnosis(
  gateway: DesktopGatewaySource,
  progress: DesktopLauncherActionProgress,
): DesktopGatewaySource {
  return {
    ...gateway,
    diagnosis: gatewayDiagnosisFromCheckProgress(gateway, progress),
  };
}

function buildGatewayDiagnosisResultSnapshot(input: Readonly<{
  gateway: DesktopGatewaySource;
  progress?: DesktopLauncherActionProgress;
  clicked_action: GatewaySourceActionModel;
  affected_sessions: readonly GatewayActionAffectedSession[];
}>): GatewayDiagnosisResultSnapshot {
  const diagnosisGateway = input.progress
    ? gatewayWithCheckProgressDiagnosis(input.gateway, input.progress)
    : input.gateway;
  const panelModel = buildGatewayActionPresentation({
    gateway: diagnosisGateway,
    clicked_action: input.clicked_action,
    affected_sessions: input.affected_sessions,
    show_diagnosis_result: true,
  });
  return {
    gateway_id: input.gateway.gateway_id,
    checked_at_unix_ms: diagnosisGateway.diagnosis?.checked_at_unix_ms ?? (input.progress ? gatewayProgressTimestamp(input.progress) : Date.now()),
    ...(input.progress?.operation_key ? { operation_key: input.progress.operation_key } : {}),
    gateway: diagnosisGateway,
    panel_model: panelModel,
  };
}

function gatewaySourceActionForLauncherRequest(request: DesktopLauncherActionRequest): GatewaySourceActionModel | null {
  switch (request.kind) {
    case 'refresh_gateway':
    case 'check_gateway':
    case 'sync_gateway':
    case 'refresh_gateway_catalog':
    case 'refresh_gateway_status':
      return {
        intent: 'refresh_gateway',
        label: 'Refresh',
        enabled: true,
        variant: 'default',
      };
    case 'pair_gateway':
      return {
        intent: 'pair_gateway',
        label: 'Pair Gateway',
        enabled: true,
        variant: 'default',
      };
    case 'open_gateway_environment':
      return {
        intent: 'open_gateway_environment',
        label: request.label,
        enabled: true,
        variant: 'default',
      };
    default:
      return null;
  }
}

function gatewaySourceActionForLifecycleProgress(
  progress: DesktopLauncherActionProgress | null | undefined,
): GatewaySourceActionModel | null {
  return progress?.action === 'refresh_gateway'
    ? {
        intent: 'refresh_gateway',
        label: 'Refresh',
        enabled: true,
        variant: 'default',
      }
    : null;
}

function GatewaySourceCard(props: Readonly<{
  i18n: DesktopI18n;
  gateway: DesktopGatewaySource;
  gatewayEntries: readonly DesktopEnvironmentEntry[];
  foregroundAction: GatewayForegroundActionSnapshot | null;
  setForegroundAction: (
    next: GatewayForegroundActionSnapshot | null | ((current: GatewayForegroundActionSnapshot | null) => GatewayForegroundActionSnapshot | null),
  ) => void;
  busyState: DesktopLauncherBusyState;
  actionProgress: readonly DesktopLauncherActionProgress[];
  lifecycleProgressFocusRequest: LifecycleProgressFocusRequest | null;
  consumeLifecycleProgressFocusRequest: (requestID: number) => void;
  actionPopoverOpen: boolean;
  onActionPopoverOpenChange: (open: boolean) => void;
  moreActionsMenuOpen: boolean;
  onMoreActionsMenuOpenChange: (open: boolean) => void;
  openCreateGatewaySetup: (gateway?: DesktopGatewaySource, focusSection?: DesktopGatewayResolveFocus) => void;
  runGatewayLauncherAction: (request: DesktopLauncherActionRequest) => Promise<void>;
  openCreateGatewayEnvironment: (gateway: DesktopGatewaySource) => void;
  viewGatewayEnvironments: (gateway: DesktopGatewaySource) => void;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  deleteGateway: (gateway: DesktopGatewaySource) => void;
}>) {
  const row = createMemo(() => buildGatewaySourceRowModel(props.gateway));
  const foregroundAction = () => props.foregroundAction;
  const setForegroundAction = props.setForegroundAction;
  const [foregroundPendingProgress, setForegroundPendingProgress] = createSignal<DesktopLauncherActionProgress | null>(null);
  const [retainedDiagnosisResult, setRetainedDiagnosisResult] = createSignal<GatewayDiagnosisResultSnapshot | null>(null);
  let foregroundTerminalClearTimer: ReturnType<typeof setTimeout> | null = null;
  let foregroundTerminalClearKey: string | null = null;
  let actionPopoverExitTask: (() => void) | null = null;
  let actionPopoverStaleCloseFrame = 0;
  const clearForegroundPendingProgress = () => {
    setForegroundPendingProgress(null);
    setForegroundAction((current) => current?.pending_progress
      ? { ...current, pending_progress: undefined }
      : current);
  };
  const clearForegroundTerminalClearTimer = () => {
    if (!foregroundTerminalClearTimer) {
      foregroundTerminalClearKey = null;
      return;
    }
    clearTimeout(foregroundTerminalClearTimer);
    foregroundTerminalClearTimer = null;
    foregroundTerminalClearKey = null;
  };
  const clearActionPopoverStaleCloseFrame = () => {
    if (!actionPopoverStaleCloseFrame) {
      return;
    }
    cancelAnimationFrame(actionPopoverStaleCloseFrame);
    actionPopoverStaleCloseFrame = 0;
  };
  const setForegroundPendingProgressForRequest = (progress: DesktopLauncherActionProgress | null) => {
    setForegroundPendingProgress(progress);
  };
  const selectedGatewayWorkflowProgress = createMemo(() => {
    const foreground = foregroundAction();
    if (!foreground) {
      return null;
    }
    return selectForegroundGatewayProgress(
      props.actionProgress.filter((progress) => (
        gatewayProgressBelongsToForegroundAction(progress, foreground)
      )),
    );
  });
  const selectedGatewayForegroundRecoveryProgress = createMemo(() => {
    if (foregroundAction()) {
      return null;
    }
    if (!props.actionPopoverOpen) {
      return null;
    }
    return selectForegroundGatewayProgress(
      props.actionProgress.filter((progress) => (
        gatewayProgressCanRecoverForegroundAction(progress)
        && gatewayProgressMatchesSubject(props.gateway.gateway_id, progress)
      )),
    );
  });
  const busyGatewayProgress = createMemo(() => {
    const progress = props.busyState.progress;
    if (
      (
        gatewaySourceMatchesRuntimeLifecycleProgress(props.gateway.gateway_id, progress)
        || (progress?.action === 'open_gateway_environment' && gatewayProgressMatchesSubject(props.gateway.gateway_id, progress))
        || progress?.step_progress !== undefined
      ) && progress?.subject_kind === 'gateway'
      && (
        progress.subject_id === props.gateway.gateway_id
        || progress.gateway_id === props.gateway.gateway_id
      )
    ) {
      return progress;
    }
    return null;
  });
  const busyGatewayWorkflowProgress = createMemo(() => {
    const progress = busyGatewayProgress();
    const foreground = foregroundAction();
    if (!foreground || !progress) {
      return null;
    }
    return gatewayProgressBelongsToForegroundAction(progress, foreground)
      || gatewayBusyStateBelongsToForegroundAction(props.busyState, props.gateway.gateway_id, foreground)
      ? progress
      : null;
  });
  createEffect(() => {
    const foreground = foregroundAction();
    const pending = foreground?.pending_progress ?? foregroundPendingProgress();
    if (!foreground || !pending) {
      return;
    }
    const progress = selectedGatewayWorkflowProgress() ?? busyGatewayWorkflowProgress();
    if (progress) {
      clearForegroundPendingProgress();
    }
  });
  const foregroundDiagnosisBelongsToRefresh = createMemo(() => gatewayForegroundDiagnosisBelongsToRefresh(props.gateway, foregroundAction()));
  const affectedSessions = createMemo<readonly GatewayActionAffectedSession[]>(() => (
    props.gatewayEntries
      .filter((entry) => entry.is_open && trimString(entry.open_session_key) !== '')
      .slice(0, 5)
      .map((entry) => ({
        session_key: entry.open_session_key,
        label: entry.label,
      }))
  ));
  const selectedGatewayOperationProgress = createMemo(() => {
    const foreground = foregroundAction();
    if (foreground && !foreground.owns_progress) {
      return null;
    }
    const pending = foreground?.pending_progress ?? foregroundPendingProgress();
    const selected = foreground
      ? selectedGatewayWorkflowProgress() ?? busyGatewayWorkflowProgress()
      : (props.actionPopoverOpen ? selectedGatewayForegroundRecoveryProgress() : null);
    if (selected?.action === 'refresh_gateway' && selected.status === 'succeeded') {
      return selected;
    }
    if (pending && !selected) {
      return pending;
    }
    return selected;
  });
  const foregroundCanReleaseAfterPopoverClose = (): boolean => {
    const foreground = foregroundAction();
    if (!foreground) {
      return false;
    }
    if (!foreground.owns_progress) {
      return true;
    }
    return !foregroundWantsPopover();
  };
  const releaseClosedForegroundAction = () => {
    const exitTask = actionPopoverExitTask;
    actionPopoverExitTask = null;
    if (exitTask) {
      exitTask();
      return;
    }
    if (!props.actionPopoverOpen && foregroundCanReleaseAfterPopoverClose()) {
      setForegroundAction(null);
      clearForegroundPendingProgress();
    }
  };
  const selectedGatewayRefreshDiagnosisResult = createMemo<GatewayDiagnosisResultSnapshot | null>(() => {
    const progress = selectedGatewayOperationProgress();
    if (
      progress?.action !== 'refresh_gateway'
      || progress.status !== 'succeeded'
    ) {
      return null;
    }
    return buildGatewayDiagnosisResultSnapshot({
      gateway: props.gateway,
      progress,
      clicked_action: foregroundAction()?.action ?? gatewaySourceActionForLauncherRequest({
        kind: 'refresh_gateway',
        gateway_id: props.gateway.gateway_id,
      } as DesktopLauncherActionRequest) ?? row().primary_action,
      affected_sessions: affectedSessions(),
    });
  });
  const visibleGatewayDiagnosisResult = createMemo<GatewayDiagnosisResultSnapshot | null>(() => {
    const foreground = foregroundAction();
    const progressResult = selectedGatewayRefreshDiagnosisResult();
    if (progressResult) {
      return progressResult;
    }
    if (foreground?.action.intent === 'refresh_gateway' && foregroundDiagnosisBelongsToRefresh()) {
      const currentResult = retainedDiagnosisResult();
      if (currentResult && currentResult.checked_at_unix_ms === props.gateway.diagnosis?.checked_at_unix_ms) {
        return currentResult;
      }
      return buildGatewayDiagnosisResultSnapshot({
        gateway: props.gateway,
        clicked_action: foreground.action,
        affected_sessions: affectedSessions(),
      });
    }
    if (foreground !== null && foreground.action.intent !== 'refresh_gateway') {
      return null;
    }
    const currentResult = retainedDiagnosisResult();
    if (currentResult) {
      return currentResult;
    }
    if (props.gateway.diagnosis) {
      return buildGatewayDiagnosisResultSnapshot({
        gateway: props.gateway,
        clicked_action: gatewaySourceActionForLauncherRequest({
          kind: 'refresh_gateway',
          gateway_id: props.gateway.gateway_id,
        } as DesktopLauncherActionRequest) ?? row().primary_action,
        affected_sessions: affectedSessions(),
      });
    }
    return null;
  });
  const visibleGatewayProgress = createMemo(() => {
    const progress = selectedGatewayOperationProgress();
    return progress;
  });
  const activeGatewayLifecycleProgress = createMemo(() => selectForegroundGatewayProgress(
    props.actionProgress.filter((progress) => (
      gatewaySourceMatchesRuntimeLifecycleProgress(props.gateway.gateway_id, progress)
      && gatewayProgressIsActive(progress)
    )),
  ));
  const gatewayLifecycleBusyProgress = createMemo(() => (
    visibleGatewayProgress() ?? activeGatewayLifecycleProgress()
  ));
  const displayedPrimaryAction = createMemo(() => {
    const foreground = foregroundAction();
    const progress = visibleGatewayProgress();
    if (foreground && !foreground.owns_progress && props.actionPopoverOpen) {
      return foreground.action;
    }
    if (foreground && foreground.owns_progress && gatewayProgressIsActive(progress)) {
      return foreground.action;
    }
    return row().primary_action;
  });
  const primaryActionLabel = createMemo(() => localizedGatewaySourceActionLabel(props.i18n, displayedPrimaryAction()));
  const currentActionPresentation = createMemo(() => {
    const foreground = foregroundAction();
    const diagnosisResult = visibleGatewayDiagnosisResult();
    const showDiagnosisResult = diagnosisResult !== null || foregroundDiagnosisBelongsToRefresh();
    const presentationGateway = diagnosisResult?.gateway
      ?? (showDiagnosisResult
      ? props.gateway
      : foreground?.gateway ?? props.gateway);
    return buildGatewayActionPresentation({
      gateway: presentationGateway,
      clicked_action: foregroundAction()?.action ?? row().primary_action,
      active_progress: visibleGatewayProgress()?.status === 'running' || visibleGatewayProgress()?.status === 'canceling' || visibleGatewayProgress()?.status === 'cleanup_running'
        ? visibleGatewayProgress()
        : null,
      retained_failure: visibleGatewayProgress()?.status === 'failed' || visibleGatewayProgress()?.status === 'cleanup_failed'
        ? visibleGatewayProgress()
        : null,
      affected_sessions: affectedSessions(),
      show_diagnosis_result: showDiagnosisResult,
    });
  });
  const visiblePanelModel = createMemo(() => {
    const progress = visibleGatewayProgress();
    if (progress && !launcherActionProgressIsTerminal(progress)) {
      return currentActionPresentation();
    }
    if (progress && gatewayProgressNeedsAttention(progress)) {
      return currentActionPresentation();
    }
    const diagnosisResult = visibleGatewayDiagnosisResult();
    if (diagnosisResult) {
      return diagnosisResult.panel_model;
    }
    const foreground = foregroundAction();
    return foreground?.panel_model ?? currentActionPresentation();
  });
  const primaryActionPresentation = createMemo(() => buildGatewayActionPresentation({
    gateway: foregroundAction()?.gateway ?? props.gateway,
    clicked_action: displayedPrimaryAction(),
    affected_sessions: affectedSessions(),
  }));
  const primaryBusy = createMemo(() => gatewaySourceActionBusy(
    props.busyState,
    props.gateway.gateway_id,
    displayedPrimaryAction(),
    gatewayLifecycleBusyProgress(),
    foregroundAction(),
  ));
  const progressPresentation = createMemo(() => localizedPrimaryProgressPresentation(
    props.i18n,
    environmentProgressPrimaryPresentation(visibleGatewayProgress()),
  ));
  const hasProgressPanel = createMemo(() => visibleGatewayProgress() !== null);
  const foregroundWantsPopover = createMemo(() => (
    foregroundAction()?.owns_progress === true
      && (
        foregroundPendingProgress() !== null
        || gatewayProgressIsActive(visibleGatewayProgress())
      )
  ));
  const guidePanelHasState = createMemo(() => (
    foregroundAction() !== null
      || retainedDiagnosisResult() !== null
      || visibleGatewayDiagnosisResult() !== null
  ));
  const foregroundCanShowGuidePanel = createMemo(() => {
    const foreground = foregroundAction();
    if (!foreground?.owns_progress) {
      return true;
    }
    return foregroundPendingProgress() !== null
      || visibleGatewayDiagnosisResult() !== null
      || gatewayProgressNeedsAttention(visibleGatewayProgress());
  });
  const guidePanelVisible = createMemo(() => (
    (props.actionPopoverOpen || foregroundWantsPopover())
    && guidePanelHasState()
    && foregroundCanShowGuidePanel()
    && !hasProgressPanel()
    && visiblePanelModel().execution_mode !== 'direct'
  ));
  const progressPanelVisible = createMemo(() => (props.actionPopoverOpen || foregroundWantsPopover()) && hasProgressPanel());
  const actionPopoverOpen = createMemo(() => progressPanelVisible() || guidePanelVisible());
  createEffect(() => {
    clearActionPopoverStaleCloseFrame();
    if (!props.actionPopoverOpen || actionPopoverOpen()) {
      return;
    }
    actionPopoverStaleCloseFrame = requestAnimationFrame(() => {
      actionPopoverStaleCloseFrame = 0;
      if (props.actionPopoverOpen && !actionPopoverOpen()) {
        props.onActionPopoverOpenChange(false);
      }
    });
  });
  const menuActions = createMemo(() => row().secondary_actions);
  const progressIsRunning = (progress: DesktopLauncherActionProgress | null | undefined) => (
    progress?.status === 'running'
    || progress?.status === 'canceling'
    || progress?.status === 'cleanup_running'
  );
  const foregroundActionBusy = (action: GatewaySourceActionModel): boolean => {
    const foreground = foregroundAction();
    if (!foreground || !foreground.owns_progress || foreground.action.intent !== action.intent) {
      return false;
    }
    return gatewaySourceActionBusy(
      props.busyState,
      props.gateway.gateway_id,
      action,
      gatewayLifecycleBusyProgress(),
      foreground,
    );
  };
  const foregroundActionRunning = createMemo(() => {
    const foreground = foregroundAction();
    if (!foreground || !foreground.owns_progress) {
      return false;
    }
    return progressIsRunning(visibleGatewayProgress());
  });
  const primaryActionRunning = createMemo(() => (
    foregroundActionRunning()
  ));
  const menuActionRunning = (action: GatewaySourceActionModel) => foregroundActionBusy(action);
  const activeProgressForAction = (action: GatewaySourceActionModel): DesktopLauncherActionProgress | null => selectForegroundGatewayProgress(
    props.actionProgress.filter((progress) => (
      gatewayProgressIsActive(progress)
      && gatewayProgressMatchesAction(props.gateway, action, progress)
    )),
  );
  let moreActionsAnchorRef: HTMLSpanElement | undefined;
  let moreActionsOverlayRef: HTMLDivElement | undefined;
  let moreActionsFocusFrame = 0;
  const closeMoreActions = () => props.onMoreActionsMenuOpenChange(false);
  const clearMoreActionsFocusFrame = () => {
    if (!moreActionsFocusFrame) {
      return;
    }
    cancelAnimationFrame(moreActionsFocusFrame);
    moreActionsFocusFrame = 0;
  };
  const moreActionsContainsTarget = (target: EventTarget | null): boolean => (
    target instanceof Node
    && (moreActionsAnchorRef?.contains(target) === true || moreActionsOverlayRef?.contains(target) === true)
  );
  createEffect(() => {
    if (!props.moreActionsMenuOpen) {
      clearMoreActionsFocusFrame();
      return;
    }
    moreActionsFocusFrame = requestAnimationFrame(() => {
      moreActionsFocusFrame = 0;
      firstEnabledMenuItem(moreActionsOverlayRef)?.focus();
    });
    const handleMouseDown = (event: MouseEvent) => {
      if (!moreActionsContainsTarget(event.target)) {
        closeMoreActions();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMoreActions();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      clearMoreActionsFocusFrame();
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });
  onCleanup(() => {
    clearMoreActionsFocusFrame();
    moreActionsOverlayRef = undefined;
  });
  const renderProgressPresentationIcon = (presentation: EnvironmentProgressPrimaryPresentation) => {
    if (presentation.kind === 'attention_trigger') {
      return <AlertTriangle class="redeven-split-action-trigger__icon h-3.5 w-3.5" />;
    }
    return presentation.icon === 'stop'
      ? <Stop class="redeven-split-action-trigger__icon h-3.5 w-3.5" />
      : <Play class="redeven-split-action-trigger__icon h-3.5 w-3.5" />;
  };
  let previousGatewayID = props.gateway.gateway_id;
  createEffect(() => {
    const gatewayID = props.gateway.gateway_id;
    if (gatewayID === previousGatewayID) {
      return;
    }
    previousGatewayID = gatewayID;
      actionPopoverExitTask = null;
      setForegroundAction(null);
      setRetainedDiagnosisResult(null);
      clearForegroundPendingProgress();
  });
  onCleanup(() => {
    clearForegroundTerminalClearTimer();
    clearActionPopoverStaleCloseFrame();
  });
  createEffect(() => {
    const foreground = foregroundAction();
    const progressResult = selectedGatewayRefreshDiagnosisResult();
    if (progressResult) {
      const current = retainedDiagnosisResult();
      if (
        current?.checked_at_unix_ms === progressResult.checked_at_unix_ms
        && trimString(current.operation_key) === trimString(progressResult.operation_key)
      ) {
        return;
      }
      setRetainedDiagnosisResult(progressResult);
      if (foreground?.action.intent === 'refresh_gateway') {
        setForegroundAction({
          ...foreground,
          gateway: progressResult.gateway,
          panel_model: progressResult.panel_model,
        });
      }
      return;
    }
    const diagnosisResult = visibleGatewayDiagnosisResult();
    if (
      !diagnosisResult
      || (
        foreground !== null
        && foreground.action.intent !== 'refresh_gateway'
      )
    ) {
      return;
    }
    const current = retainedDiagnosisResult();
    if (
      current?.checked_at_unix_ms === diagnosisResult.checked_at_unix_ms
      && trimString(current.operation_key) === trimString(diagnosisResult.operation_key)
    ) {
      return;
    }
    setRetainedDiagnosisResult(diagnosisResult);
    if (foreground?.action.intent === 'refresh_gateway') {
      setForegroundAction({
        ...foreground,
        gateway: diagnosisResult.gateway,
        panel_model: diagnosisResult.panel_model,
      });
    }
  });
  createEffect(() => {
    const foreground = foregroundAction();
    const progress = selectedGatewayOperationProgress();
    if (
      !foreground?.owns_progress
      || gatewayProgressNeedsAttention(progress)
    ) {
      clearForegroundTerminalClearTimer();
      return;
    }
    if (!progress) {
      return;
    }
    if (
      !launcherActionProgressIsTerminal(progress)
      || !gatewayProgressCanCompleteForegroundAction(props.gateway, progress, foreground)
    ) {
      clearForegroundTerminalClearTimer();
      return;
    }
    const operationKey = progress.operation_key;
    const startedAtUnixMS = gatewayProgressStartedAt(progress);
    const foregroundStartedAtUnixMS = foreground.started_at_unix_ms;
    const terminalClearKey = [
      foreground.gateway_id,
      foregroundStartedAtUnixMS,
      foreground.action.intent,
      operationKey,
      startedAtUnixMS,
      progress.status,
    ].join(':');
    if (foregroundTerminalClearKey === terminalClearKey) {
      return;
    }
    clearForegroundTerminalClearTimer();
    foregroundTerminalClearKey = terminalClearKey;
    foregroundTerminalClearTimer = setTimeout(() => {
      foregroundTerminalClearTimer = null;
      foregroundTerminalClearKey = null;
      const currentForeground = foregroundAction();
      const currentProgress = selectedGatewayOperationProgress();
      if (
        currentForeground
        && currentForeground.started_at_unix_ms === foregroundStartedAtUnixMS
        && currentForeground.gateway_id === foreground.gateway_id
        && currentForeground.action.intent === foreground.action.intent
        && (
          !currentProgress
          || (
            trimString(currentProgress.operation_key) === trimString(operationKey)
            && gatewayProgressStartedAt(currentProgress) === startedAtUnixMS
            && launcherActionProgressIsTerminal(currentProgress)
            && !gatewayProgressNeedsAttention(currentProgress)
          )
        )
      ) {
        setForegroundAction(null);
        clearForegroundPendingProgress();
        props.onActionPopoverOpenChange(false);
      }
    }, GATEWAY_TERMINAL_PROGRESS_VISIBLE_MS);
  });

  const presentationCanStartProgress = (action: GatewaySourceActionModel): boolean => (
    action.enabled && gatewayActionShowsWorkflowProgress(action)
  );
  const rememberForegroundAction = (action: GatewaySourceActionModel, ownsProgress: boolean, startedAtUnixMS = Date.now()): GatewayActionPanelModel => {
    setRetainedDiagnosisResult(null);
    const panelModel = buildGatewayActionPresentation({
      gateway: props.gateway,
      clicked_action: action,
      affected_sessions: affectedSessions(),
    });
    const operationKey = gatewayOperationKeyForAction(props.gateway, action);
    setForegroundAction({
      gateway_id: props.gateway.gateway_id,
      started_at_unix_ms: startedAtUnixMS,
      action,
      gateway: props.gateway,
      panel_model: panelModel,
      owns_progress: ownsProgress,
      operation_key: operationKey,
    });
    return panelModel;
  };
  const rememberForegroundProgress = (
    action: GatewaySourceActionModel,
    progress: DesktopLauncherActionProgress,
  ): void => {
    setRetainedDiagnosisResult(null);
    const startedAtUnixMS = gatewayProgressStartedAt(progress) || Date.now();
    const panelModel = buildGatewayActionPresentation({
      gateway: props.gateway,
      clicked_action: action,
      affected_sessions: affectedSessions(),
    });
    setForegroundAction({
      gateway_id: props.gateway.gateway_id,
      started_at_unix_ms: startedAtUnixMS,
      action,
      gateway: props.gateway,
      panel_model: panelModel,
      owns_progress: true,
      operation_key: progress.operation_key ?? gatewayOperationKeyForAction(props.gateway, action),
    });
    clearForegroundPendingProgress();
  };
  let handledLifecycleProgressFocusRequestID = 0;
  createEffect(() => {
    const request = props.lifecycleProgressFocusRequest;
    if (
      !request
      || request.subject_kind !== 'gateway'
      || request.subject_id !== props.gateway.gateway_id
      || request.request_id === handledLifecycleProgressFocusRequestID
    ) {
      return;
    }
    const progress = selectForegroundGatewayProgress(props.actionProgress.filter((candidate) => (
      trimString(candidate.operation_key) === request.operation_key
      && (candidate.started_at_unix_ms ?? 0) === request.started_at_unix_ms
      && gatewayProgressMatchesSubject(props.gateway.gateway_id, candidate)
      && gatewayProgressIsActive(candidate)
    )));
    const action = gatewaySourceActionForLifecycleProgress(progress);
    if (!progress || !action) {
      return;
    }
    handledLifecycleProgressFocusRequestID = request.request_id;
    rememberForegroundProgress(action, progress);
    props.onActionPopoverOpenChange(true);
    props.consumeLifecycleProgressFocusRequest(request.request_id);
  });
  const rememberForegroundRequest = (
    action: GatewaySourceActionModel,
    request: DesktopLauncherActionRequest,
  ): GatewayActionPanelModel => {
    setRetainedDiagnosisResult(null);
    const startedAtUnixMS = Date.now();
    const ownsProgress = presentationCanStartProgress(action);
    const panelModel = buildGatewayActionPresentation({
      gateway: props.gateway,
      clicked_action: action,
      affected_sessions: affectedSessions(),
    });
    const operationKey = gatewayOperationKeyForAction(props.gateway, action);
    const pendingProgress = ownsProgress
      ? pendingGatewayForegroundProgress(props.gateway, action, operationKey, startedAtUnixMS)
      : null;
    setForegroundAction({
      gateway_id: props.gateway.gateway_id,
      started_at_unix_ms: startedAtUnixMS,
      action,
      gateway: props.gateway,
      panel_model: {
        ...panelModel,
        continuation_action: request,
      },
      owns_progress: ownsProgress,
      ...(operationKey ? { operation_key: operationKey } : {}),
      ...(pendingProgress ? { pending_progress: pendingProgress } : {}),
    });
    setForegroundPendingProgressForRequest(pendingProgress);
    return panelModel;
  };
  const launcherRequestForGatewayAction = (action: GatewaySourceActionModel): DesktopLauncherActionRequest | null => {
    switch (action.intent) {
      case 'refresh_gateway':
        return {
          kind: 'refresh_gateway',
          gateway_id: props.gateway.gateway_id,
        };
      case 'pair_gateway':
        return {
          kind: 'pair_gateway',
          gateway_id: props.gateway.gateway_id,
        };
      case 'enable_gateway':
        return {
          kind: 'set_gateway_enabled',
          gateway_id: props.gateway.gateway_id,
          enabled: true,
        };
      case 'disable_gateway':
        return {
          kind: 'set_gateway_enabled',
          gateway_id: props.gateway.gateway_id,
          enabled: false,
        };
      default:
        return null;
    }
  };
  const runGatewayActionAsForeground = (action: GatewaySourceActionModel): boolean => {
    const request = launcherRequestForGatewayAction(action);
    if (!request) {
      return false;
    }
    const activeProgress = activeProgressForAction(action);
    if (activeProgress) {
      rememberForegroundProgress(action, activeProgress);
      props.onActionPopoverOpenChange(true);
      return true;
    }
    rememberForegroundRequest(action, request);
    props.onActionPopoverOpenChange(true);
    window.setTimeout(() => {
      void props.runGatewayLauncherAction(request);
    }, 0);
    return true;
  };
  const runAction = (action: GatewaySourceActionModel) => {
    if (action.intent === 'view_gateway_environments') {
      props.onActionPopoverOpenChange(false);
      setForegroundAction(null);
      clearForegroundPendingProgress();
      props.viewGatewayEnvironments(props.gateway);
      return;
    }
    if (action.intent === 'add_gateway_environment') {
      props.onActionPopoverOpenChange(false);
      setForegroundAction(null);
      clearForegroundPendingProgress();
      props.openCreateGatewayEnvironment(props.gateway);
      return;
    }
    if (action.intent === 'setup_gateway') {
      props.onActionPopoverOpenChange(false);
      setForegroundAction(null);
      clearForegroundPendingProgress();
      props.openCreateGatewaySetup(props.gateway);
      return;
    }
    const presentation = buildGatewayActionPresentation({
      gateway: props.gateway,
      clicked_action: action,
      affected_sessions: affectedSessions(),
    });
    if (!action.enabled && presentation.execution_mode === 'direct') {
      setForegroundAction(null);
      clearForegroundPendingProgress();
      return;
    }
    const ownsProgress = presentationCanStartProgress(action);
    if (ownsProgress && presentation.execution_mode !== 'confirm') {
      if (runGatewayActionAsForeground(action)) {
        return;
      }
      rememberForegroundAction(action, true);
      props.onActionPopoverOpenChange(true);
      void runGatewaySourceAction(action, props.gateway, props.openCreateGatewaySetup, props.runGatewayLauncherAction);
      return;
    }
    if (presentation.execution_mode !== 'direct') {
      rememberForegroundAction(action, false);
      props.onActionPopoverOpenChange(true);
      return;
    }
    if (ownsProgress) {
      if (runGatewayActionAsForeground(action)) {
        return;
      }
      rememberForegroundAction(action, true);
    }
    props.onActionPopoverOpenChange(ownsProgress);
    void runGatewaySourceAction(action, props.gateway, props.openCreateGatewaySetup, props.runGatewayLauncherAction);
    if (!ownsProgress) {
      setForegroundAction(null);
      clearForegroundPendingProgress();
    }
  };
  const runMoreMenuActionAfterMenuClose = (action: GatewaySourceActionModel) => {
    window.setTimeout(() => {
      runAction(action);
    }, 0);
  };
  const runMoreMenuAction = (action: GatewaySourceActionModel) => {
    const presentation = buildGatewayActionPresentation({
      gateway: props.gateway,
      clicked_action: action,
      affected_sessions: affectedSessions(),
    });
    if (presentationCanStartProgress(action) && presentation.execution_mode !== 'confirm') {
      closeMoreActions();
      window.setTimeout(() => {
        if (!runGatewayActionAsForeground(action)) {
          runAction(action);
        }
      }, 0);
      return;
    }
    closeMoreActions();
    runMoreMenuActionAfterMenuClose(action);
  };
  const runPanelAction = (action: GatewaySourceActionModel) => {
    if (action.intent === 'view_gateway_environments') {
      props.onActionPopoverOpenChange(false);
      setForegroundAction(null);
      clearForegroundPendingProgress();
      props.viewGatewayEnvironments(props.gateway);
      return;
    }
    if (action.intent === 'add_gateway_environment') {
      props.onActionPopoverOpenChange(false);
      setForegroundAction(null);
      clearForegroundPendingProgress();
      props.openCreateGatewayEnvironment(props.gateway);
      return;
    }
    if (action.intent === 'setup_gateway') {
      props.onActionPopoverOpenChange(false);
      setForegroundAction(null);
      clearForegroundPendingProgress();
      props.openCreateGatewaySetup(props.gateway);
      return;
    }
    const presentation = buildGatewayActionPresentation({
      gateway: props.gateway,
      clicked_action: action,
      affected_sessions: affectedSessions(),
    });
    const ownsProgress = presentationCanStartProgress(action);
    if (!ownsProgress && presentation.execution_mode === 'direct') {
      void runGatewaySourceAction(action, props.gateway, props.openCreateGatewaySetup, props.runGatewayLauncherAction);
      return;
    }
    if (ownsProgress && runGatewayActionAsForeground(action)) {
      return;
    }
    rememberForegroundAction(action, ownsProgress);
    props.onActionPopoverOpenChange(true);
    void runGatewaySourceAction(action, props.gateway, props.openCreateGatewaySetup, props.runGatewayLauncherAction);
  };
  const runForegroundRequest = (request: DesktopLauncherActionRequest, action?: GatewaySourceActionModel) => {
    const foregroundActionModel = action ?? gatewaySourceActionForLauncherRequest(request);
    if (foregroundActionModel) {
      rememberForegroundRequest(foregroundActionModel, request);
    }
    props.onActionPopoverOpenChange(true);
    window.setTimeout(() => {
      void props.runGatewayLauncherAction(request);
    }, 0);
  };
  const runForegroundRequestFromProgress = (
    request: DesktopLauncherActionRequest,
    currentProgress: DesktopLauncherActionProgress,
  ) => {
    if (currentProgress.subject_kind === 'gateway' && launcherActionProgressIsTerminal(currentProgress)) {
      props.dismissOperation(currentProgress);
    }
    runForegroundRequest(request);
  };
  const closeActionPopover = () => {
    props.onActionPopoverOpenChange(false);
  };
  const closeActionPopoverAfterExit = (task: () => void) => {
    actionPopoverExitTask = task;
    closeActionPopover();
  };
  const openActionPopover = () => {
    if (visibleGatewayProgress() || retainedDiagnosisResult()) {
      props.onActionPopoverOpenChange(true);
      return;
    }
    const primaryAction = displayedPrimaryAction();
    if (actionStartsWorkflowImmediately(primaryAction)) {
      if (!foregroundActionRunning()) {
        void runGatewayActionAsForeground(primaryAction);
      }
      return;
    }
    if (!foregroundAction()) {
      if (!runGatewayActionAsForeground(primaryAction)) {
        rememberForegroundAction(primaryAction, false);
      }
    }
    props.onActionPopoverOpenChange(true);
  };
  const moreActionsLabel = createMemo(() => props.i18n.t('environmentCenter.moreActions'));
  const moreActionsForLabel = createMemo(() => props.i18n.t('environmentCenter.moreActionsForLabel', { label: row().label }));
  const localizedGatewayActionLabel = (action: GatewaySourceActionModel) => localizedGatewaySourceActionLabel(props.i18n, action);
  const primaryHasGuide = createMemo(() => primaryActionPresentation().execution_mode !== 'direct');
  const actionStartsWorkflowImmediately = (action: GatewaySourceActionModel): boolean => {
    if (!action.enabled || !presentationCanStartProgress(action)) {
      return false;
    }
    return buildGatewayActionPresentation({
      gateway: props.gateway,
      clicked_action: action,
      affected_sessions: affectedSessions(),
    }).execution_mode !== 'confirm';
  };
  const primaryBlocked = createMemo(() => !row().primary_action.enabled && primaryHasGuide());
  const menuItemDisabled = (action: GatewaySourceActionModel) => (
    !action.enabled || primaryActionRunning() || menuActionRunning(action)
  );
  const runPrimaryAction = () => {
    const currentProgress = visibleGatewayProgress();
    if (currentProgress && progressPresentation()) {
      props.onActionPopoverOpenChange(true);
      return;
    }
    const action = displayedPrimaryAction();
    if (actionStartsWorkflowImmediately(action)) {
      if (runGatewayActionAsForeground(action)) {
        return;
      }
    }
    if (foregroundActionRunning()) {
      props.onActionPopoverOpenChange(true);
      return;
    }
    runAction(action);
  };
  const runPrimaryPointerDown: JSX.EventHandlerUnion<HTMLSpanElement, PointerEvent> = (event) => {
    const currentProgress = visibleGatewayProgress();
    if (currentProgress && progressPresentation()) {
      return;
    }
    const action = displayedPrimaryAction();
    if (!actionStartsWorkflowImmediately(action)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void runGatewayActionAsForeground(action);
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
                {localizedGatewaySourceStatusLabel(props.i18n, row().status_label)}
              </EnvironmentStatusIndicator>
            </div>
            <CardTitle class="truncate text-sm font-semibold leading-5 tracking-[0.01em]" title={row().label}>
              {row().label}
            </CardTitle>
            <div class="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Show when={row().endpoint_label}>
                {(endpoint) => <span class="redeven-gateway-card__endpoint">{endpoint()}</span>}
              </Show>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent class="flex flex-1 flex-col gap-3 px-4 pb-3">
        <div class="redeven-gateway-card__catalog-summary" data-tone={row().guidance.tone}>
          <div class="min-w-0">
            <div class="redeven-gateway-card__summary-title">{localizedGatewaySourceCountText(props.i18n, row().environment_summary_label)}</div>
            <div class="redeven-gateway-card__summary-detail">{localizedGatewaySourceText(props.i18n, row().environment_summary_detail)}</div>
          </div>
        </div>
      </CardContent>
      <CardFooter class="redeven-gateway-card__footer mt-auto flex flex-col gap-2 border-t border-border/60 px-4 pb-3 pt-3">
        <div class="redeven-gateway-card__footer-row">
          <DesktopActionPopover
            open={actionPopoverOpen()}
            onOpenChange={(open) => {
              if (open) {
                openActionPopover();
                return;
              }
              closeActionPopover();
            }}
            onExitComplete={releaseClosedForegroundAction}
            content={(
              <Show
                when={visibleGatewayProgress()}
                fallback={(
                  <GatewayActionPanel
                    i18n={props.i18n}
                    gateway={props.gateway}
                    model={visiblePanelModel()}
                    runAction={runPanelAction}
                    runGatewayLauncherAction={runForegroundRequest}
                    foregroundActionBusy={foregroundActionBusy}
                    close={closeActionPopover}
                  />
                )}
              >
                {(progress) => (
                  <EnvironmentProgressPanel
                    i18n={props.i18n}
                    progress={progress()}
                    cancelOperation={props.cancelOperation}
                    dismissOperation={(currentProgress) => {
                      closeActionPopoverAfterExit(() => {
                        props.dismissOperation(currentProgress);
                        setForegroundAction(null);
                        setForegroundPendingProgress(null);
                      });
                    }}
                    copyOperationDiagnostics={props.copyOperationDiagnostics}
                    runNextAction={(action, currentProgress) => {
                      switch (action.kind) {
                        case 'copy_diagnostics':
                          props.copyOperationDiagnostics(currentProgress);
                          break;
                        case 'dismiss':
                          closeActionPopoverAfterExit(() => {
                            props.dismissOperation(currentProgress);
                            setForegroundAction(null);
                            setForegroundPendingProgress(null);
                          });
                          break;
                        case 'refresh_status':
                        case 'update_runtime':
                          break;
                        case 'retry':
                          if (action.retry_action) {
                            runForegroundRequestFromProgress(action.retry_action, currentProgress);
                          }
                          break;
                        case 'refresh_gateway':
                        case 'check_gateway':
                        case 'refresh_gateway_status':
                        case 'refresh_gateway_catalog':
                          break;
                        case 'resolve_gateway':
                        case 'manage_desktop_update':
                          break;
                        case 'open_gateway_environment':
                          runForegroundRequestFromProgress({
                            kind: 'open_gateway_environment',
                            environment_id: action.environment_id,
                            gateway_id: action.gateway_id,
                            gateway_env_id: action.gateway_env_id,
                            label: action.label,
                            ...(action.start_policy ? { start_policy: action.start_policy } : {}),
                          }, currentProgress);
                          break;
                      }
                    }}
                  />
                )}
              </Show>
            )}
            anchorClass="redeven-gateway-card__primary-anchor"
            onAnchorPointerDown={runPrimaryPointerDown}
            allowMainAxisOverflow={false}
            placementLock="top-inline-shift"
            popoverAriaLabel={
              progressPanelVisible()
                ? (visibleGatewayProgress() ? localizedProgressTitle(props.i18n, visibleGatewayProgress()!) : props.i18n.t('environmentCenter.gatewayProgress'))
                : localizedGatewaySourceText(props.i18n, row().guidance.title)
            }
            class="redeven-gateway-action-popover-surface"
          >
            <Show
              when={progressPresentation()}
              fallback={(
                <Button
                  size="sm"
                  variant="default"
                  class={cn(
                    'redeven-gateway-card__primary-button min-w-0 justify-center',
                    primaryBlocked() && 'redeven-split-action-trigger--blocked',
                  )}
                  loading={primaryBusy()}
                  disabled={!displayedPrimaryAction().enabled && !primaryBlocked()}
                  aria-disabled={primaryBlocked() ? true : undefined}
                  aria-haspopup={primaryHasGuide() ? 'dialog' : undefined}
                  aria-expanded={primaryHasGuide() ? props.actionPopoverOpen : undefined}
                  onClick={runPrimaryAction}
                >
                  <span class="redeven-split-action-trigger__content">
                    <GatewaySourceActionIcon intent={displayedPrimaryAction().intent} />
                    <span>{primaryActionLabel()}</span>
                  </span>
                </Button>
              )}
            >
              {(presentation) => (
                <Button
                  size="sm"
                  variant="default"
                  class={cn(
                    'redeven-gateway-card__primary-button min-w-0 justify-center',
                    progressTriggerClassName(presentation()),
                  )}
                  aria-haspopup="dialog"
                  aria-expanded={props.actionPopoverOpen}
                  aria-label={presentation().ariaLabel}
                  onClick={() => {
                    props.onActionPopoverOpenChange(true);
                  }}
                >
                  <span class="redeven-split-action-trigger__content">
                    {renderProgressPresentationIcon(presentation())}
                    <span>{presentation().label}</span>
                  </span>
                </Button>
              )}
            </Show>
          </DesktopActionPopover>
          <div class="redeven-gateway-card__footer-actions">
            <Show when={menuActions().length > 0}>
                <span ref={moreActionsAnchorRef} class="relative">
                  <DesktopTooltip content={moreActionsLabel()} placement="top">
                    <span>
                      <ConsoleActionIconButton
                        title={moreActionsLabel()}
                        aria-label={moreActionsForLabel()}
                        aria-haspopup="menu"
                        aria-expanded={props.moreActionsMenuOpen}
                        disabled={primaryActionRunning()}
                        onClick={() => props.onMoreActionsMenuOpenChange(!props.moreActionsMenuOpen)}
                      >
                        <MoreHorizontal class="h-3.5 w-3.5" />
                      </ConsoleActionIconButton>
                    </span>
                  </DesktopTooltip>
                  <Show when={props.moreActionsMenuOpen}>
                    <DesktopAnchoredOverlaySurface
                      open={props.moreActionsMenuOpen}
                      anchorRef={moreActionsAnchorRef}
                      placement="top"
                      role="menu"
                      ariaLabel={moreActionsForLabel()}
                      interactive
                      hideArrow
                      class="redeven-split-menu z-[230] max-w-[min(16rem,calc(100vw-1rem))]"
                      onOverlayRef={(element) => {
                        moreActionsOverlayRef = element;
                      }}
                    >
                      <For each={menuActions()}>
                        {(action) => (
                          <button
                            type="button"
                            role="menuitem"
                            class="redeven-split-menu-item"
                            data-tone={gatewaySplitMenuItemToneData(action.intent) || undefined}
                            disabled={menuItemDisabled(action)}
                            title={!action.enabled ? action.disabled_reason : undefined}
                            onClick={() => {
                              if (menuItemDisabled(action)) {
                                return;
                              }
                              runMoreMenuAction(action);
                            }}
                          >
                            <span class="redeven-split-menu-item-icon">
                              <GatewaySourceActionIcon intent={action.intent} class="h-3.5 w-3.5" />
                            </span>
                            {localizedGatewayActionLabel(action)}
                          </button>
                        )}
                      </For>
                    </DesktopAnchoredOverlaySurface>
                  </Show>
                </span>
            </Show>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}

function gatewayPanelIconTone(tone: GatewayActionPanelModel['tone']): 'neutral' | 'primary' | 'warning' | 'error' {
  return tone;
}

function GatewayActionPanel(props: Readonly<{
  i18n: DesktopI18n;
  gateway: DesktopGatewaySource;
  model: GatewayActionPanelModel;
  runAction: (action: GatewaySourceActionModel) => void;
  runGatewayLauncherAction: (request: DesktopLauncherActionRequest, action?: GatewaySourceActionModel) => void;
  foregroundActionBusy: (action: GatewaySourceActionModel) => boolean;
  close: () => void;
}>) {
  const runPanelPrimary = () => {
    const action = props.model.primary_action;
    if (props.model.continuation_action) {
      props.runGatewayLauncherAction(props.model.continuation_action, action);
      return;
    }
    if (action) {
      props.runAction(action);
    }
  };
  const tone = createMemo(() => gatewayPanelIconTone(props.model.tone));
  const panelAriaLabel = createMemo(() => localizedGatewayActionPanelText(props.i18n, props.model.aria_label));
  const panelTitle = createMemo(() => localizedGatewayActionPanelText(props.i18n, props.model.title));
  const panelDetail = createMemo(() => localizedGatewayActionPanelDetail(props.i18n, props.model));
  const localizedPanelActionLabel = (action: GatewaySourceActionModel) => localizedGatewaySourceActionLabel(props.i18n, action);
  const panelContext = createMemo(() => {
    const parts = [
      localizedGatewayPanelFactValue(props.i18n, desktopGatewayConnectionKindLabel(props.gateway.connection_kind)),
      trimString(props.gateway.endpoint_label),
    ].filter((part) => trimString(part) !== '');
    return parts.join(' · ');
  });
  const [diagnosticsOpen, setDiagnosticsOpen] = createSignal(false);
  return (
    <div class="redeven-action-popover redeven-gateway-action-panel" tabIndex={-1} aria-label={panelAriaLabel()}>
      <div class="redeven-gateway-action-panel__body">
        <div class="redeven-gateway-action-panel__hero">
          <span class="redeven-action-popover__status-icon" data-tone={tone()}>
            <Show when={props.model.tone === 'error'} fallback={props.model.tone === 'warning' ? <AlertTriangle /> : <ShieldCheck />}>
              <X />
            </Show>
          </span>
          <div class="redeven-action-popover__status-text">
            <div class="redeven-action-popover__title">{panelTitle()}</div>
            <div class="redeven-action-popover__detail">{panelDetail()}</div>
            <Show when={panelContext()}>
              {(context) => <div class="redeven-gateway-action-panel__context">{context()}</div>}
            </Show>
            <Show when={props.model.result_facts.length > 0}>
              <div class="redeven-gateway-action-panel__result-facts" aria-label={props.i18n.t('environmentCenter.gatewayPanelCheckResult')}>
                <For each={props.model.result_facts}>
                  {(fact) => (
                    <span class="redeven-gateway-action-panel__result-fact" data-tone={fact.tone ?? 'neutral'}>
                      <span class="redeven-gateway-action-panel__result-fact-label">{localizedGatewayPanelFactLabel(props.i18n, fact.label)}</span>
                      <span class="redeven-gateway-action-panel__result-fact-value">{localizedGatewayPanelFactValue(props.i18n, fact.value)}</span>
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>

        <button
          type="button"
          class="redeven-gateway-action-panel__diagnostics-toggle"
          aria-expanded={diagnosticsOpen()}
          onClick={() => setDiagnosticsOpen((open) => !open)}
        >
          <span class="redeven-gateway-action-panel__diagnostics-label">{props.i18n.t('environmentCenter.gatewayPanelDiagnostics')}</span>
          <ChevronDown class={cn('h-3.5 w-3.5 transition-transform duration-150', diagnosticsOpen() && 'rotate-180')} />
        </button>
        <Show when={diagnosticsOpen()}>
          <div class="redeven-gateway-action-panel__facts redeven-gateway-action-panel__facts--diagnostics">
            <For each={props.model.diagnostic_facts}>
            {(fact) => (
              <div class="redeven-gateway-action-panel__fact">
                <span class="redeven-gateway-action-panel__fact-label">{localizedGatewayPanelFactLabel(props.i18n, fact.label)}</span>
                <span class="redeven-gateway-action-panel__fact-value" data-tone={fact.tone ?? 'neutral'}>{localizedGatewayPanelFactValue(props.i18n, fact.value)}</span>
              </div>
            )}
            </For>
          </div>
        </Show>
        <Show when={props.model.affected_sessions.length > 0}>
          <div class="redeven-action-popover__notice" data-tone="warning">
            <div class="redeven-action-popover__notice-title">{props.i18n.t('environmentCenter.gatewayPanelAffectedSessions')}</div>
            <div class="redeven-gateway-action-panel__sessions">
              <For each={props.model.affected_sessions}>
                {(session) => <div class="redeven-gateway-action-panel__session">{session.label}</div>}
              </For>
              <Show when={props.model.overflow_session_count > 0}>
                <div class="redeven-gateway-action-panel__session">
                  {props.i18n.t('environmentCenter.gatewayPanelOverflowSessions', { count: props.model.overflow_session_count })}
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      <Show when={props.model.primary_action}>
        {(action) => (
          <div class="redeven-gateway-action-panel__footer" data-mode="primary">
            <div class="relative min-w-0">
              <Button
                size="sm"
                variant="default"
                class="redeven-gateway-action-panel__primary-action justify-center gap-1.5"
                loading={props.foregroundActionBusy(action())}
                disabled={!action().enabled}
                onClick={runPanelPrimary}
              >
                <GatewaySourceActionIcon intent={action().intent} />
                <span>{localizedPanelActionLabel(action())}</span>
              </Button>
              <Presence>
                <Show when={props.foregroundActionBusy(action())}>
                  <Motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    class="redeven-welcome-loading-shimmer-overlay"
                    data-shimmer-surface="primary"
                    aria-hidden="true"
                  />
                </Show>
              </Presence>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

function gatewaySourceLauncherActionKind(
  action: GatewaySourceActionModel,
): Extract<DesktopLauncherActionKind, 'open_gateway_environment' | 'refresh_gateway' | 'set_gateway_enabled'> | null {
  switch (action.intent) {
    case 'open_gateway_environment':
      return 'open_gateway_environment';
    case 'refresh_gateway':
      return 'refresh_gateway';
    case 'pair_gateway':
      return 'refresh_gateway';
    case 'enable_gateway':
    case 'disable_gateway':
      return 'set_gateway_enabled';
    default:
      return null;
  }
}

function gatewaySourceActionBusy(
  busyState: DesktopLauncherBusyState,
  gatewayID: string,
  action: GatewaySourceActionModel,
  progress?: DesktopLauncherActionProgress | null,
  foreground?: GatewayForegroundActionSnapshot | null,
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
  if (!foreground || !foreground.owns_progress || foreground.action.intent !== action.intent) {
    return false;
  }
  return gatewayBusyStateBelongsToForegroundAction(busyState, gatewayID, foreground);
}

function GatewaySourceActionIcon(
  props: Readonly<{
    intent: GatewaySourceActionModel['intent'];
    class?: string;
  }>,
) {
  const iconClass = () => props.class ?? 'mr-1 h-3.5 w-3.5';
  switch (props.intent) {
    case 'add_gateway_environment':
      return <Plus class={iconClass()} />;
    case 'view_gateway_environments':
      return <ChevronRight class={iconClass()} />;
    case 'enable_gateway':
      return <Check class={iconClass()} />;
    case 'disable_gateway':
      return <GatewayDisabledIcon class={iconClass()} />;
    case 'refresh_gateway':
      return <Refresh class={iconClass()} />;
    case 'setup_gateway':
      return <Settings class={iconClass()} />;
    case 'cancel_gateway_action':
      return <X class={iconClass()} />;
  }
}

function GatewayDisabledIcon(props: Readonly<{ class?: string }>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="m7.8 7.8 8.4 8.4" />
    </svg>
  );
}

const WELCOME_DIALOG_PANEL_CLASS = 'redeven-welcome-dialog-panel';

const LOCAL_ENVIRONMENT_SETTINGS_DIALOG_CLASS = cn(
  WELCOME_DIALOG_PANEL_CLASS,
  'redeven-welcome-dialog-panel--settings',
  'redeven-settings-dialog',
);

const CONNECTION_DIALOG_CLASS = cn(
  WELCOME_DIALOG_PANEL_CLASS,
  'redeven-welcome-dialog-panel--connection',
);

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

function SettingsSectionHeader(props: Readonly<{
  label: string;
  hint?: string;
  accessory?: JSX.Element;
}>) {
  return (
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div class="flex items-baseline gap-2">
        <h3 class="text-xs font-semibold text-foreground">
          {props.label}
        </h3>
        <Show when={props.hint}>
          <span class="text-[11px] text-muted-foreground">{props.hint}</span>
        </Show>
      </div>
      {props.accessory}
    </div>
  );
}

function SettingsFormRow(props: Readonly<{
  controlID: string;
  label: string;
  help?: string;
  required?: boolean;
  accessory?: JSX.Element;
  i18n: DesktopI18n;
  children: JSX.Element;
}>) {
  return (
    <div class="redeven-settings-form-row grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start sm:gap-x-4">
      <div class="flex min-h-8 flex-wrap items-center gap-1.5">
        <label for={props.controlID} class="text-xs font-medium text-foreground">
          {props.label}
          <Show when={props.required}>
            <span aria-hidden="true" class="ml-0.5 text-destructive">*</span>
          </Show>
        </label>
        <SettingsHelpBadge label={props.label} content={props.help} i18n={props.i18n} />
        {props.accessory}
      </div>
      <div class="min-w-0">{props.children}</div>
    </div>
  );
}

type DesktopSettingsApplyTiming = 'next_start' | 'restart_now';

function SettingsApplyTimingControl(props: Readonly<{
  value: DesktopSettingsApplyTiming;
  onChange: (value: DesktopSettingsApplyTiming) => void;
  i18n: DesktopI18n;
}>) {
  return (
    <div class="redeven-settings-apply-row redeven-boundary-panel grid gap-2 rounded-md border px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start sm:gap-x-4">
      <div class="flex min-h-8 items-center text-xs font-medium text-foreground">
        {props.i18n.t('settings.applyTimingTitle')}
      </div>
      <div class="min-w-0">
        <div class="w-full sm:max-w-[16rem]">
          <SegmentedControl
            value={props.value}
            onChange={(value) => props.onChange(value as DesktopSettingsApplyTiming)}
            options={[
              {
                value: 'next_start',
                label: props.i18n.t('settings.applyNextStart'),
              },
              {
                value: 'restart_now',
                label: props.i18n.t('settings.applyRestartNow'),
              },
            ]}
            size="sm"
          />
        </div>
        <div aria-live="polite" class="mt-1.5 grid min-w-0">
          <div
            aria-hidden={props.value === 'next_start' ? undefined : 'true'}
            class={cn(
              'col-start-1 row-start-1 flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground',
              props.value !== 'next_start' && 'invisible',
            )}
          >
            <Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            <span>{props.i18n.t('settings.applyNextStartHelp')}</span>
          </div>
          <div
            aria-hidden={props.value === 'restart_now' ? undefined : 'true'}
            class={cn(
              'col-start-1 row-start-1 flex items-start gap-1.5 text-[11px] leading-5 text-warning-foreground',
              props.value !== 'restart_now' && 'invisible',
            )}
          >
            <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>{props.i18n.t('settings.applyTimingHelp')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function desktopUpdateStatusLabel(i18n: DesktopI18n, snapshot: DesktopUpdateSnapshot): string {
  switch (snapshot.state) {
    case 'checking':
      return i18n.t('desktopUpdate.checking');
    case 'available':
      return i18n.t('desktopUpdate.available');
    case 'downloading':
      return i18n.t('desktopUpdate.downloading');
    case 'ready':
      return i18n.t('desktopUpdate.ready');
    case 'installing':
      return snapshot.message_key === 'desktopUpdate.preparingInstallation'
        ? i18n.t('desktopUpdate.preparingInstallation')
        : i18n.t('desktopUpdate.installing');
    case 'blocked':
      return snapshot.message_key === 'desktopUpdate.moveToApplications'
        ? i18n.t('desktopUpdate.moveToApplications')
        : i18n.t('desktopUpdate.unsupportedBuild');
    case 'error':
      return i18n.t('desktopUpdate.failed');
    case 'idle':
      return snapshot.message_key === 'desktopUpdate.upToDate'
        ? i18n.t('desktopUpdate.upToDate')
        : i18n.t('desktopUpdate.checkForUpdates');
  }
}

function DesktopUpdateDialog(props: Readonly<{
  open: boolean;
  snapshot: DesktopUpdateSnapshot;
  i18n: DesktopI18n;
  onOpenChange: (open: boolean) => void;
  perform: (action: DesktopUpdateAction) => Promise<void>;
}>) {
  const hasCapability = (capability: DesktopUpdateSnapshot['capabilities'][number]) => (
    props.snapshot.capabilities.includes(capability)
  );
  const working = () => (
    props.snapshot.state === 'checking'
    || props.snapshot.state === 'downloading'
    || props.snapshot.state === 'installing'
  );
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.i18n.t('desktopUpdate.title')}
      class="max-w-[34rem]"
      footer={(
        <div class="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void props.perform({ kind: 'open_release_page' })}
          >
            <ExternalLink class="mr-1.5 h-3.5 w-3.5" />
            {props.i18n.t('desktopUpdate.openReleasePage')}
          </Button>
          <div class="flex flex-wrap justify-end gap-2">
            <Show when={hasCapability('reveal_application')}>
              <Button size="sm" variant="outline" onClick={() => void props.perform({ kind: 'reveal_application' })}>
                {props.i18n.t('desktopUpdate.revealApplication')}
              </Button>
            </Show>
            <Show when={hasCapability('open_applications_folder')}>
              <Button size="sm" variant="outline" onClick={() => void props.perform({ kind: 'open_applications_folder' })}>
                {props.i18n.t('desktopUpdate.openApplicationsFolder')}
              </Button>
            </Show>
            <Show when={hasCapability('cancel_download')}>
              <Button size="sm" variant="outline" onClick={() => void props.perform({ kind: 'cancel_download' })}>
                {props.i18n.t('desktopUpdate.cancelDownload')}
              </Button>
            </Show>
            <Show when={hasCapability('download')}>
              <Button size="sm" onClick={() => void props.perform({ kind: 'download_update' })}>
                {props.i18n.t('desktopUpdate.download')}
              </Button>
            </Show>
            <Show when={hasCapability('install')}>
              <Button size="sm" onClick={() => void props.perform({ kind: 'install_update' })}>
                {props.i18n.t('desktopUpdate.installAndRestart')}
              </Button>
            </Show>
            <Show when={hasCapability('check') && !hasCapability('download') && !hasCapability('install')}>
              <Button size="sm" onClick={() => void props.perform({ kind: 'check_for_updates' })}>
                {props.snapshot.state === 'error'
                  ? props.i18n.t('desktopUpdate.retry')
                  : props.i18n.t('desktopUpdate.checkForUpdates')}
              </Button>
            </Show>
            <Button size="sm" variant="outline" disabled={props.snapshot.state === 'installing'} onClick={() => props.onOpenChange(false)}>
              {props.i18n.t('desktopUpdate.close')}
            </Button>
          </div>
        </div>
      )}
    >
      <div class="space-y-5">
        <div
          role="status"
          class={cn(
            'flex items-start gap-3 rounded-md border px-4 py-3',
            props.snapshot.state === 'error'
              ? 'border-destructive/25 bg-destructive/10'
              : props.snapshot.state === 'blocked'
                ? 'border-warning/30 bg-warning/10'
                : 'border-border bg-muted/20',
          )}
        >
          <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <Show when={working()} fallback={props.snapshot.state === 'error' || props.snapshot.state === 'blocked'
              ? <AlertTriangle class="h-4 w-4 text-warning" />
              : <Check class="h-4 w-4 text-success" />}>
              <Refresh class="h-4 w-4 animate-spin text-primary" />
            </Show>
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-foreground">
              {desktopUpdateStatusLabel(props.i18n, props.snapshot)}
            </div>
            <Show when={props.snapshot.state === 'blocked'}>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                {props.snapshot.message_key === 'desktopUpdate.moveToApplications'
                  ? props.i18n.t('desktopUpdate.moveToApplicationsDetail')
                  : props.i18n.t('desktopUpdate.unsupportedBuildDetail')}
              </p>
            </Show>
            <Show when={props.snapshot.error_detail}>
              <p class="mt-1 break-words text-xs leading-5 text-destructive">{props.snapshot.error_detail}</p>
            </Show>
          </div>
        </div>

        <dl class="grid grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.2fr)] gap-x-5 gap-y-2 text-xs">
          <dt class="text-muted-foreground">{props.i18n.t('desktopUpdate.currentVersion')}</dt>
          <dd class="font-mono text-foreground">{props.snapshot.current_version || '—'}</dd>
          <Show when={props.snapshot.available_version}>
            <dt class="text-muted-foreground">{props.i18n.t('desktopUpdate.availableVersion')}</dt>
            <dd class="font-mono text-foreground">{props.snapshot.available_version}</dd>
          </Show>
        </dl>

        <Show when={props.snapshot.state === 'downloading' && props.snapshot.download_percent !== undefined}>
          <div class="space-y-1.5">
            <div class="flex justify-between text-xs text-muted-foreground">
              <span>{props.i18n.t('desktopUpdate.downloading')}</span>
              <span>{Math.round(props.snapshot.download_percent ?? 0)}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(props.snapshot.download_percent ?? 0)}
              class="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div class="h-full bg-primary transition-[width]" style={{ width: `${props.snapshot.download_percent ?? 0}%` }} />
            </div>
          </div>
        </Show>

        <Show when={hasCapability('automatic_checks')}>
          <div class="rounded-md border border-border px-4 py-3">
            <Checkbox
              checked={props.snapshot.automatically_checks_for_updates}
              onChange={(enabled) => void props.perform({ kind: 'set_automatic_checks', enabled })}
              label={props.i18n.t('desktopUpdate.automaticChecks')}
              disabled={props.snapshot.state === 'installing'}
              size="sm"
            />
            <p class="mt-1.5 pl-6 text-[11px] leading-5 text-muted-foreground">
              {props.i18n.t('desktopUpdate.automaticChecksDescription')}
            </p>
          </div>
        </Show>

        <Show when={props.snapshot.platform === 'macos_sparkle' && props.snapshot.state !== 'blocked'}>
          <p class="text-xs leading-5 text-muted-foreground">{props.i18n.t('desktopUpdate.macManagedBySparkle')}</p>
        </Show>
      </div>
    </Dialog>
  );
}

function LocalEnvironmentSettingsDialog(props: Readonly<{
  open: boolean;
  snapshot: DesktopSettingsSurfaceSnapshot;
  baselineSnapshot: DesktopSettingsSurfaceSnapshot;
  draft: DesktopSettingsDraft;
  i18n: DesktopI18n;
  busyState: DesktopLauncherBusyState;
  settingsError: string;
  settingsErrorRef: (value: HTMLElement) => void;
  updateDraftField: (name: keyof DesktopSettingsDraft, value: string) => void;
  applyAccessMode: (mode: DesktopAccessMode) => void;
  applyAccessFixedPort: (
    portText: string,
    accessMode: Exclude<DesktopAccessMode, 'custom_exposure'>,
  ) => void;
  toggleAutoPort: (enabled: boolean) => void;
  saveSettings: (options?: Readonly<{
    restartRuntime?: boolean;
  }>) => Promise<void>;
  runtimeRestartAvailable: boolean;
  runtimeRunning: boolean;
  runtimeStatusLabel: string;
  runtimeStatusTone: EnvironmentCardTone;
  dark: boolean;
  cancelSettings: () => void;
  clearStoredLocalUIPassword: () => void;
}>) {
  const [accessModeOverride, setAccessModeOverride] = createSignal<DesktopAccessMode | null>(null);
  const [applyTiming, setApplyTiming] = createSignal<DesktopSettingsApplyTiming>('next_start');
  const accessModelOptions = createMemo(() => ({
    current_runtime_url: props.snapshot.current_runtime_url,
    local_ui_password_configured: props.baselineSnapshot.local_ui_password_configured,
    runtime_password_required: props.baselineSnapshot.runtime_password_required,
    mode_override: accessModeOverride(),
  }));
  const accessModel = createMemo(() => deriveDesktopAccessDraftModel(props.draft, accessModelOptions()));
  const nextStartAddress = createMemo(() => describeLocalizedNextStartAddress(props.i18n, accessModel()));
  const settingsEnvironmentLabel = createMemo(() => trimString(props.baselineSnapshot.environment_label) || props.i18n.t('desktop.environment'));
  const settingsWindowTitle = createMemo(() => props.i18n.t('settings.settingsWindowTitle'));
  const settingsWindowDescription = createMemo(() => props.i18n.t('settings.settingsWindowDescription', {
    label: settingsEnvironmentLabel(),
  }));
  const settingsSaveLabel = createMemo(() => props.i18n.t('settings.saveEnvironmentSettings', {
    label: settingsEnvironmentLabel(),
  }));
  const visibilityGroupID = createUniqueId();
  const localUIPasswordCanClear = createMemo(() => (
    props.baselineSnapshot.local_ui_password_configured
    && props.draft.local_ui_password_mode !== 'clear'
    && !accessModel().password_required
  ));
  let previousBaselineKey = '';
  let passwordRequirementWasMissing = false;
  let passwordInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (!props.open) {
      setAccessModeOverride(null);
      setApplyTiming('next_start');
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
      setApplyTiming('next_start');
    }
    previousBaselineKey = baselineKey;
  });

  // See ConnectionDialog: memoize the open boolean so that identity churn
  // upstream never re-triggers the overlay-mask focus trap mid-typing.
  const isOpen = createMemo(() => props.open);
  const hasPendingChanges = createMemo(() => (
    desktopSettingsDraftRequiresRuntimeRestart(props.baselineSnapshot.draft, props.draft)
  ));
  const accessValidation = createMemo(() => validateDesktopAccessDraft(props.draft, accessModelOptions()));
  const showApplyTimingChoice = createMemo(
    () => props.runtimeRestartAvailable && hasPendingChanges() && accessValidation().valid,
  );
  const restartAfterSave = createMemo(() => showApplyTimingChoice() && applyTiming() === 'restart_now');
  const selectedAccessModeLabel = createMemo(() => {
    const option = props.baselineSnapshot.access_mode_options.find((candidate) => candidate.value === accessModel().access_mode);
    return option ? localizedAccessModeOption(props.i18n, option).label : '';
  });
  const portInputValue = createMemo(() => (
    accessModel().port_mode === 'auto'
      ? accessModel().fixed_port_value
      : accessModel().bind_port_text
  ));
  createEffect(() => {
    const passwordRequirementMissing = props.open
      && accessModel().password_required
      && !accessModel().password_requirement_satisfied;
    if (passwordRequirementMissing && !passwordRequirementWasMissing) {
      queueMicrotask(() => passwordInputRef?.focus());
    }
    passwordRequirementWasMissing = passwordRequirementMissing;
  });

  function selectAccessMode(mode: DesktopAccessMode): void {
    setAccessModeOverride(mode);
    props.applyAccessMode(mode);
  }

  function focusAccessMode(mode: DesktopAccessMode): void {
    queueMicrotask(() => document.getElementById(`${visibilityGroupID}-${mode}`)?.focus());
  }

  return (
    <Dialog
      open={isOpen()}
      onOpenChange={(open) => {
        if (!open) {
          props.cancelSettings();
        }
      }}
      title={settingsWindowTitle()}
      description={settingsWindowDescription()}
      class={LOCAL_ENVIRONMENT_SETTINGS_DIALOG_CLASS}
      footer={(
        <div class="flex w-full justify-end gap-2">
          <Button size="sm" variant="outline" onClick={props.cancelSettings}>
            {props.i18n.t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={!hasPendingChanges() || !accessValidation().valid}
            loading={busyStateMatchesAction(props.busyState, 'save_settings')}
            aria-label={restartAfterSave()
              ? props.i18n.t('settings.saveAndRestartEnvironmentSettings', { label: settingsEnvironmentLabel() })
              : settingsSaveLabel()}
            title={!hasPendingChanges()
              ? props.i18n.t('settings.noChangesToSave')
              : restartAfterSave()
                ? props.i18n.t('settings.saveAndRestartEnvironmentSettings', { label: settingsEnvironmentLabel() })
                : settingsSaveLabel()}
            onClick={() => {
              void props.saveSettings({ restartRuntime: restartAfterSave() });
            }}
          >
            <Refresh
              aria-hidden="true"
              class={cn('mr-1.5 h-3.5 w-3.5', !restartAfterSave() && 'invisible')}
            />
            <span aria-hidden="true" class="grid">
              <span class={cn(
                'col-start-1 row-start-1',
                restartAfterSave() ? 'visible' : 'invisible',
              )}>
                {props.i18n.t('settings.saveAndRestart')}
              </span>
              <span class={cn(
                'col-start-1 row-start-1',
                restartAfterSave() ? 'invisible' : 'visible',
              )}>
                {props.i18n.t('settings.saveSettings')}
              </span>
            </span>
          </Button>
        </div>
      )}
    >
      <div class="space-y-5">
        <div
          aria-label={`${props.i18n.t('settings.runtimeLabel')} ${props.runtimeStatusLabel}; ${props.i18n.t('settings.nextStartLabel')} ${selectedAccessModeLabel()}`}
          class="redeven-settings-status-overview grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_2.25rem_minmax(0,1fr)] sm:items-stretch sm:gap-0"
          role="group"
        >
          <div
            class="redeven-settings-state-card redeven-settings-state-card--current redeven-boundary-panel flex min-w-0 items-center gap-3 rounded-md border px-3.5 py-3"
            data-status-tone={props.runtimeStatusTone}
          >
            <span class="redeven-settings-state-glyph redeven-surface-control relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-muted/20" aria-hidden="true">
              <RuntimeStatusOrb running={props.runtimeRunning} dark={props.dark} />
            </span>
            <span class="min-w-0">
              <span class="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {props.i18n.t('settings.runtimeLabel')}
              </span>
              <span class="redeven-settings-runtime-status mt-1 block truncate text-xs font-semibold text-foreground">
                {props.runtimeStatusLabel}
              </span>
            </span>
          </div>

          <div class="redeven-settings-state-connector relative flex min-h-5 items-center justify-center text-muted-foreground" aria-hidden="true">
            <span class="absolute h-full w-px bg-border sm:h-px sm:w-full" />
            <span class="redeven-surface-control relative flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-sm">
              <svg class="h-3 w-3 rotate-90 sm:rotate-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </span>
          </div>

          <div class="redeven-settings-state-card redeven-settings-state-card--next redeven-boundary-panel flex min-w-0 items-center gap-3 rounded-md border px-3.5 py-3">
            <span class="redeven-settings-state-glyph flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary" aria-hidden="true">
              {accessModeIcon(accessModel().access_mode)({ class: 'h-4 w-4' })}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {props.i18n.t('settings.nextStartLabel')}
              </span>
              <span class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span class="text-xs font-semibold text-foreground">{selectedAccessModeLabel()}</span>
                <span class={cn(
                  'redeven-settings-endpoint-badge min-w-0 rounded-sm bg-muted/60 px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground',
                  nextStartAddress().primary_monospace && 'font-mono',
                )}>
                  {nextStartAddress().primary}
                  <Show when={nextStartAddress().hint}>
                    <span> · {nextStartAddress().hint}</span>
                  </Show>
                </span>
              </span>
            </span>
          </div>
        </div>

        <section>
          <SettingsSectionHeader
            label={props.i18n.t('settings.visibilityTitle')}
            hint={props.i18n.t('settings.visibilityDescription')}
          />
          <div
            role="radiogroup"
            aria-label={props.i18n.t('settings.visibilityTitle')}
            class="mt-3 grid gap-2.5 sm:grid-cols-3"
          >
            <For each={props.baselineSnapshot.access_mode_options}>
              {(option, index) => {
                const selected = createMemo(() => accessModel().access_mode === option.value);
                const localizedOption = createMemo(() => localizedAccessModeOption(props.i18n, option));
                const Icon = accessModeIcon(option.value);
                return (
                  <button
                    type="button"
                    id={`${visibilityGroupID}-${option.value}`}
                    role="radio"
                    aria-checked={selected()}
                    tabIndex={selected() ? 0 : -1}
                    class={cn(
                      'redeven-visibility-card group relative flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-left transition-[border-color,background-color,box-shadow,transform] duration-150',
                      selected()
                        ? 'border-primary/60 bg-primary/10 shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_32%,transparent)_inset]'
                        : 'redeven-tile redeven-boundary-panel redeven-surface-panel--interactive hover:-translate-y-[1px] hover:bg-muted/15 hover:shadow-[0_6px_20px_-12px_color-mix(in_srgb,var(--foreground)_26%,transparent)]',
                    )}
                    onClick={() => selectAccessMode(option.value)}
                    onKeyDown={(event) => {
                      const options = props.baselineSnapshot.access_mode_options;
                      const nextIndex = rovingRadioIndexForKey(event.key, index(), options.length);
                      if (nextIndex === null) return;
                      event.preventDefault();
                      const nextOption = options[nextIndex];
                      if (!nextOption) return;
                      selectAccessMode(nextOption.value);
                      focusAccessMode(nextOption.value);
                    }}
                  >
                    <span class={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors',
                      selected()
                        ? 'border-primary/40 bg-primary/15 text-primary'
                        : 'redeven-surface-control bg-muted/25 text-muted-foreground group-hover:text-foreground',
                    )}>
                      <Icon class="h-3.5 w-3.5" />
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block text-xs font-semibold text-foreground">{localizedOption().label}</span>
                      <span class="mt-1 block text-[11px] leading-[1.45] text-muted-foreground">{localizedOption().description}</span>
                    </span>
                    <span class={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                      selected()
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'redeven-surface-control bg-background',
                    )}>
                      <Show when={selected()}><Check class="h-2.5 w-2.5" /></Show>
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </section>

        <section>
          <SettingsSectionHeader label={props.i18n.t('settings.detailsTitle')} />
          <div class="redeven-settings-form-panel redeven-boundary-panel mt-3 rounded-md border px-4 py-3.5">
            <div class="space-y-3.5">
              <Show
                when={accessModel().access_mode === 'custom_exposure'}
                fallback={(
                  <SettingsFormRow
                    controlID="local-ui-port"
                    label={props.i18n.t('settings.portLabel')}
                    help={accessModel().access_mode === 'shared_local_network'
                      ? props.i18n.t('settings.sharedPortHelp')
                      : props.i18n.t('settings.localPortHelp')}
                    i18n={props.i18n}
                  >
                    <div class="space-y-1.5">
                      <div class={cn(
                        'grid gap-2',
                        accessModel().access_mode === 'local_only' && 'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
                      )}>
                        <Input
                          id="local-ui-port"
                          value={portInputValue()}
                          inputMode="numeric"
                          disabled={accessModel().port_mode === 'auto'}
                          size="sm"
                          class={cn(
                            'w-full',
                            accessValidation().address_error_key && 'border-destructive focus:border-destructive focus:ring-destructive/20',
                          )}
                          aria-invalid={accessValidation().address_error_key ? 'true' : undefined}
                          aria-describedby={accessValidation().address_error_key ? 'local-ui-port-error' : undefined}
                          placeholder="23998"
                          onInput={(event) => props.applyAccessFixedPort(
                            event.currentTarget.value,
                            accessModel().access_mode === 'shared_local_network' ? 'shared_local_network' : 'local_only',
                          )}
                        />
                        <Show when={accessModel().access_mode === 'local_only'}>
                          <Checkbox
                            checked={accessModel().port_mode === 'auto'}
                            onChange={props.toggleAutoPort}
                            label={props.i18n.t('settings.autoSelectPort')}
                            size="sm"
                          />
                        </Show>
                      </div>
                      <Show when={accessValidation().address_error_key}>
                        <div id="local-ui-port-error" role="alert" class="flex items-start gap-1.5 text-[11px] leading-5 text-destructive">
                          <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{props.i18n.t(accessValidation().address_error_key!)}</span>
                        </div>
                      </Show>
                      <Show when={accessModel().access_mode === 'local_only'}>
                        <div class="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                          <Shield class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{props.i18n.t('settings.localOnlyProtectionNote')}</span>
                        </div>
                      </Show>
                    </div>
                  </SettingsFormRow>
                )}
              >
                <SettingsFieldInput
                  field={props.baselineSnapshot.host_fields[0]!}
                  value={props.draft.local_ui_bind}
                  updateDraftField={props.updateDraftField}
                  i18n={props.i18n}
                  invalid={Boolean(accessValidation().address_error_key)}
                  errorId="local-ui-bind-error"
                  errorMessage={accessValidation().address_error_key
                    ? props.i18n.t(accessValidation().address_error_key!)
                    : ''}
                />
              </Show>

              <Show when={accessModel().access_mode !== 'local_only'}>
                <LocalUIPasswordField
                  snapshot={props.baselineSnapshot}
                  draft={props.draft}
                  passwordStateID={accessModel().password_state_id}
                  passwordStateTone={accessModel().password_state_tone}
                  passwordRequired={accessModel().password_required}
                  passwordInvalid={Boolean(accessValidation().password_error_key)}
                  localUIPasswordCanClear={localUIPasswordCanClear()}
                  updateDraftField={props.updateDraftField}
                  clearStoredLocalUIPassword={props.clearStoredLocalUIPassword}
                  inputRef={(value) => { passwordInputRef = value; }}
                  supportingContent={(
                    <Show when={accessModel().network_exposure && !accessValidation().address_error_key}>
                      <div class="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                        <ShieldCheck class="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>{props.i18n.t('settings.networkTrustNote')}</span>
                      </div>
                    </Show>
                  )}
                  i18n={props.i18n}
                />
              </Show>
            </div>
          </div>
        </section>

        <Show when={showApplyTimingChoice()}>
          <SettingsApplyTimingControl value={applyTiming()} onChange={setApplyTiming} i18n={props.i18n} />
        </Show>

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
  const selectedIndex = createMemo(() => Math.max(0, filteredContainers().findIndex((container) => (
    container.container_id === props.selectedContainerID
  ))));

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
    [open, () => props.selectedContainerID, () => props.containers],
    ([isOpen]) => {
      if (isOpen) {
        setHighlightedIndex(selectedIndex());
      }
    },
  ));

  createEffect(() => {
    if (open() && filteredContainers().length > 0) {
      scrollDesktopListboxOptionIntoView(listboxRef, `environment-container-option-${highlightedIndex()}`);
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
            if (!open() && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              setOpen(true);
              if (event.key === 'ArrowDown') {
                moveHighlight(1);
              } else if (event.key === 'ArrowUp') {
                moveHighlight(-1);
              }
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
            } else if (event.key === 'Enter' || event.key === ' ') {
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
          aria-activedescendant={open() && filteredContainers().length > 0 ? `environment-container-option-${highlightedIndex()}` : undefined}
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
                      tabIndex={-1}
                      aria-selected={props.selectedContainerID === container.container_id ? 'true' : 'false'}
                      onClick={() => selectContainer(container)}
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

function selectedGatewayProfileSource(
  sources: readonly DesktopGatewaySource[],
  selectedGatewayID: string,
): DesktopGatewaySource | undefined {
  const cleanGatewayID = trimString(selectedGatewayID);
  return sources.find((gateway) => gateway.gateway_id === cleanGatewayID);
}

function gatewayProfileSourceSearchText(gateway: DesktopGatewaySource): string {
  const row = buildGatewaySourceRowModel(gateway);
  return [
    row.label,
    row.gateway_id,
    row.transport_label,
    row.status_label,
    row.endpoint_label,
    row.environment_summary_label,
    gateway.status_message,
    gateway.gateway_url,
    gateway.container_label,
    gateway.container_ref,
    gateway.ssh_details?.ssh_destination,
  ].map(trimString).join(' ').toLowerCase();
}

function gatewaySourceToneTagVariant(tone: EnvironmentCardTone): 'neutral' | 'primary' | 'success' | 'warning' {
  return tone;
}

function GatewayProfileSourcePicker(props: Readonly<{
  i18n: DesktopI18n;
  gateways: readonly DesktopGatewaySource[];
  selectedGatewayID: string;
  fieldError?: string;
  onSelect: (gatewayID: string) => void;
  clearFieldErrors: () => void;
}>) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const labelID = createUniqueId();
  const listboxID = createUniqueId();
  let rootRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;
  let listboxRef: HTMLDivElement | undefined;

  const selectedGateway = createMemo(() => selectedGatewayProfileSource(props.gateways, props.selectedGatewayID));
  const selectedRow = createMemo(() => {
    const gateway = selectedGateway();
    return gateway ? buildGatewaySourceRowModel(gateway) : null;
  });
  const selectedGatewayExists = createMemo(() => selectedGateway() !== undefined);
  const filteredGateways = createMemo(() => {
    const normalizedQuery = trimString(query()).toLowerCase();
    if (!normalizedQuery) {
      return props.gateways;
    }
    return props.gateways.filter((gateway) => gatewayProfileSourceSearchText(gateway).includes(normalizedQuery));
  });
  const selectedIndex = createMemo(() => Math.max(0, filteredGateways().findIndex((gateway) => gateway.gateway_id === selectedGateway()?.gateway_id)));

  createEffect(() => {
    const count = filteredGateways().length;
    if (count <= 0) {
      setHighlightedIndex(0);
      return;
    }
    if (highlightedIndex() >= count) {
      setHighlightedIndex(count - 1);
    }
  });

  createEffect(on(
    [open, () => props.selectedGatewayID, () => props.gateways],
    ([isOpen]) => {
      if (isOpen) {
        setHighlightedIndex(selectedIndex());
      } else {
        setQuery('');
      }
    },
  ));

  createEffect(() => {
    if (open()) {
      scrollDesktopListboxOptionIntoView(listboxRef, `${listboxID}-option-${highlightedIndex()}`);
    }
  });

  createEffect(() => {
    if (!open()) {
      return;
    }
    const containsTarget = (target: EventTarget | null): boolean => (
      target instanceof Node && (rootRef?.contains(target) === true || listboxRef?.contains(target) === true)
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
    const count = filteredGateways().length;
    if (count <= 0) {
      return;
    }
    setHighlightedIndex((current) => (current + delta + count) % count);
  };
  const selectGateway = (gateway: DesktopGatewaySource) => {
    props.onSelect(gateway.gateway_id);
    props.clearFieldErrors();
    setOpen(false);
    buttonRef?.focus();
  };

  return (
    <div ref={rootRef} class="space-y-1.5">
      <label id={labelID} for="gateway-environment-gateway" class="block text-xs font-medium text-foreground">
        {props.i18n.t('connectionDialog.gatewayEnvironmentGateway')} <span class="text-destructive">*</span>
      </label>
      <button
        ref={buttonRef}
        id="gateway-environment-gateway"
        type="button"
        class={cn(
          'group flex min-h-[4.25rem] w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-2.5 text-left outline-none transition-[border-color,background-color,box-shadow] hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20',
          props.fieldError && 'border-destructive ring-1 ring-destructive/20',
        )}
        aria-labelledby={labelID}
        aria-haspopup="listbox"
        aria-expanded={open() ? 'true' : 'false'}
        aria-controls={listboxID}
        aria-activedescendant={open() && filteredGateways().length > 0 ? `${listboxID}-option-${highlightedIndex()}` : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open() && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setOpen(true);
            if (event.key === 'ArrowDown') {
              moveHighlight(1);
            } else if (event.key === 'ArrowUp') {
              moveHighlight(-1);
            }
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
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const gateway = filteredGateways()[highlightedIndex()];
            if (gateway) {
              selectGateway(gateway);
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span class="flex min-w-0 items-start gap-3">
          <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:text-foreground">
            <ShieldCheck class="h-4 w-4" />
          </span>
          <span class="min-w-0">
            <Show
              when={selectedRow()}
              fallback={(
                <>
                  <span class="block truncate text-sm font-semibold text-foreground">{props.i18n.t('connectionDialog.gatewayEnvironmentGateway')}</span>
                  <span class="mt-0.5 block truncate text-[11px] text-muted-foreground">{props.i18n.t('connectionDialog.validationGatewayRequired')}</span>
                </>
              )}
            >
              {(row) => (
                <>
                  <span class="block truncate text-sm font-semibold text-foreground">{row().label}</span>
                  <span class="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {[row().transport_label, row().endpoint_label].filter(Boolean).join(' · ')}
                  </span>
                  <span class="mt-1 flex flex-wrap items-center gap-1.5">
                    <Tag variant={gatewaySourceToneTagVariant(row().status_tone)} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                      {localizedGatewaySourceStatusLabel(props.i18n, row().status_label)}
                    </Tag>
                    <Tag variant="neutral" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                      {localizedGatewaySourceCountText(props.i18n, row().environment_summary_label)}
                    </Tag>
                  </span>
                </>
              )}
            </Show>
          </span>
        </span>
        <ChevronDown class={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open() && 'rotate-180')} />
      </button>
      <Show when={open()}>
        <DesktopAnchoredListbox
          id={listboxID}
          anchorRef={buttonRef}
          class="shadow-xl"
          maxHeight={360}
          role="listbox"
          open={open()}
          onOverlayRef={(element) => {
            listboxRef = element;
          }}
        >
          <div class="border-b border-border/70 p-2">
            <Show when={selectedGatewayExists()} fallback={(
              <div class="mb-2 rounded-md border border-dashed border-border/50 bg-background/70 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                {props.i18n.t('connectionDialog.validationGatewayRequired')}
              </div>
            )}>
              <div class="mb-2 rounded-md border border-border/60 bg-muted/15 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                {selectedRow()?.label}
              </div>
            </Show>
            <Input
              value={query()}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setHighlightedIndex(0);
              }}
              placeholder={props.i18n.t('environmentCenter.gatewaySearchPlaceholder')}
              size="sm"
              class="w-full"
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveHighlight(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveHighlight(-1);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const gateway = filteredGateways()[highlightedIndex()];
                  if (gateway) {
                    selectGateway(gateway);
                  }
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
              when={filteredGateways().length > 0}
              fallback={(
                <div class="px-3 py-3 text-xs leading-5 text-muted-foreground">
                  {props.i18n.t('environmentCenter.noMatchingGatewaysDescription')}
                </div>
              )}
            >
              <For each={filteredGateways()}>
                {(gateway, index) => {
                  const row = createMemo(() => buildGatewaySourceRowModel(gateway));
                  const selected = createMemo(() => selectedGateway()?.gateway_id === gateway.gateway_id);
                  const highlighted = createMemo(() => highlightedIndex() === index());
                  return (
                    <button
                      type="button"
                      id={`${listboxID}-option-${index()}`}
                      class={cn(
                        'flex w-full cursor-pointer items-start justify-between gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors',
                        highlighted()
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground hover:bg-accent/70 hover:text-accent-foreground',
                      )}
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected() ? 'true' : 'false'}
                      onClick={() => selectGateway(gateway)}
                      onMouseEnter={() => setHighlightedIndex(index())}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectGateway(gateway);
                      }}
                    >
                      <span class="min-w-0">
                        <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span class="truncate text-sm font-semibold">{row().label}</span>
                          <Tag variant={gatewaySourceToneTagVariant(row().status_tone)} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                            {localizedGatewaySourceStatusLabel(props.i18n, row().status_label)}
                          </Tag>
                        </span>
                        <span class="mt-1 block truncate text-[11px] text-muted-foreground">
                          {[row().transport_label, row().endpoint_label].filter(Boolean).join(' · ')}
                        </span>
                        <span class="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{row().gateway_id}</span>
                        <span class="mt-1 block text-[11px] leading-5 text-muted-foreground">
                          {localizedGatewaySourceCountText(props.i18n, row().environment_summary_label)}
                        </span>
                      </span>
                      <Show when={selected()}>
                        <Check class="mt-1 h-3.5 w-3.5 shrink-0" />
                      </Show>
                    </button>
                  );
                }}
              </For>
            </Show>
          </div>
        </DesktopAnchoredListbox>
      </Show>
      <Show when={props.fieldError}>
        <div class="text-[11px] text-destructive">{props.fieldError}</div>
      </Show>
    </div>
  );
}
function ConnectionDialog(props: Readonly<{
  i18n: DesktopI18n;
  nativeContainerRuntime: boolean;
  state: ConnectionDialogState;
  sshConfigHosts: readonly DesktopSSHConfigHost[];
  sshConfigHostsLoading: boolean;
  sshConfigHostsLoadError: boolean;
  containerOptions: readonly DesktopRuntimeContainerOption[];
  containerOptionsLoading: boolean;
  containerOptionsError: string;
  error: string;
  fieldErrors: Partial<Record<string, string>>;
  busyState: DesktopLauncherBusyState;
  gatewayProfileSources: readonly DesktopGatewaySource[];
  onOpenChange: (open: boolean) => void;
  updateField: (
    name: 'label' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'auth_mode' | 'ssh_password' | 'runtime_root' | 'release_base_url' | 'connect_timeout_seconds' | 'container_engine' | 'container_id' | 'container_ref' | 'container_label' | 'gateway_id' | 'target_url' | 'origin_label' | 'profile_route_kind',
    value: string,
  ) => void;
  toggleAutoRuntimeProbe: (enabled: boolean) => void;
  refreshContainerOptions: () => void;
  refreshSSHConfigHosts: () => void;
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
        return props.i18n.t('connectionDialog.remoteDownloadInstall');
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
      case 'gateway_url_profile':
        return props.i18n.t('connectionDialog.gatewayEnvironmentDescription');
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
            loading={busyStateMatchesAction(props.busyState, 'save_environment') || busyStateMatchesAction(props.busyState, 'upsert_environment_registration')}
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
                {
                  value: 'external_local_ui',
                  label: props.i18n.t('connectionDialog.redevenUrl'),
                },
                {
                  value: 'ssh_environment',
                  label: props.i18n.t('connectionDialog.sshHost'),
                },
                ...(props.nativeContainerRuntime
                  ? [
                      {
                        value: 'local_container_runtime',
                        label: props.i18n.t('connectionDialog.localContainer'),
                      },
                    ]
                  : []),
                {
                  value: 'ssh_container_runtime',
                  label: props.i18n.t('connectionDialog.sshContainer'),
                },
                {
                  value: 'gateway_url_profile',
                  label: props.i18n.t('connectionDialog.throughGateway'),
                },
              ]}
              size="sm"
            />
            <div class="rounded-md border border-dashed border-border/40 bg-muted/10 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              {connectionKindDescription()}
            </div>
          </div>
        </Show>

        <Show when={connectionKind() === 'gateway_url_profile'}>
          <div class="redeven-dialog-section">
            <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {props.i18n.t('connectionDialog.throughGateway')}
            </div>
            <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-3 mt-2 transition-[border-color,background-color,box-shadow] duration-150 hover:border-primary/25 hover:shadow-[0_4px_16px_-12px_color-mix(in_srgb,var(--foreground)_20%,transparent)]">
              <Show
                when={props.gatewayProfileSources.length > 0}
                fallback={(
                  <div class="rounded-md border border-dashed border-border/50 bg-background/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                    {props.i18n.t('connectionDialog.noWritableGateways')}
                  </div>
                )}
              >
                <div class="space-y-3">
                  <GatewayProfileSourcePicker
                    i18n={props.i18n}
                    gateways={props.gatewayProfileSources}
                    selectedGatewayID={props.state?.connection_kind === 'gateway_url_profile' ? props.state.gateway_id : ''}
                    fieldError={props.fieldErrors.gateway_id}
                    onSelect={(gatewayID) => props.updateField('gateway_id', gatewayID)}
                    clearFieldErrors={props.clearFieldErrors}
                  />
                  <div class="space-y-1.5">
                    <label class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.gatewayEnvironmentRouteType')}</label>
                    <div class="flex h-8 items-center rounded-md border border-border/70 bg-background px-2.5 text-xs text-foreground">
                      {props.i18n.t('connectionDialog.gatewayEnvironmentRouteUrl')}
                    </div>
                    <div class="text-[11px] leading-5 text-muted-foreground">
                      {props.i18n.t('connectionDialog.gatewayEnvironmentRouteUrlHelp')}
                    </div>
                  </div>
                  <Show when={true}>
                  <div class="space-y-1.5">
                    <label for="gateway-environment-target-url" class="block text-xs font-medium text-foreground">
                      {props.i18n.t('connectionDialog.gatewayEnvironmentTargetUrl')} <span class="text-destructive">*</span>
                    </label>
                    <Input
                      id="gateway-environment-target-url"
                      value={props.state?.connection_kind === 'gateway_url_profile' ? props.state.target_url : ''}
                      onInput={(event) => {
                        props.updateField('target_url', event.currentTarget.value);
                        props.clearFieldErrors();
                      }}
                      placeholder="https://env.internal.example"
                      size="sm"
                      class={cn('w-full', props.fieldErrors.target_url && 'border-destructive ring-1 ring-destructive/20')}
                      spellcheck={false}
                      autofocus={props.state?.mode === 'create'}
                    />
                    <Show when={props.fieldErrors.target_url}>
                      <div class="text-[11px] text-destructive">{props.fieldErrors.target_url}</div>
                    </Show>
                  </div>
                  </Show>
                  <div class="space-y-1.5">
                    <label for="gateway-environment-origin-label" class="block text-xs font-medium text-foreground">
                      {props.i18n.t('connectionDialog.gatewayEnvironmentOriginLabel')}
                    </label>
                    <Input
                      id="gateway-environment-origin-label"
                      value={props.state?.connection_kind === 'gateway_url_profile' ? props.state.origin_label : ''}
                      onInput={(event) => props.updateField('origin_label', event.currentTarget.value)}
                      placeholder="internal network"
                      size="sm"
                      class="w-full"
                    />
                  </div>
                  <div class="rounded-md border border-dashed border-border/40 bg-background/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                    {props.i18n.t('connectionDialog.gatewayEnvironmentAccessOnlyNotice')}
                  </div>
                </div>
              </Show>
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
                    inputID="environment-ssh-destination"
                    value={isSSHBackedKind() ? (props.state as SSHBackedConnectionDialogState | null)?.ssh_destination ?? '' : ''}
                    hosts={props.sshConfigHosts}
                    loading={props.sshConfigHostsLoading}
                    loadError={props.sshConfigHostsLoadError}
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
                    onRetry={props.refreshSSHConfigHosts}
                  />
                  <Show when={props.fieldErrors.ssh_destination}>
                    <div class="text-[11px] text-destructive">{props.fieldErrors.ssh_destination}</div>
                  </Show>
                </div>
                <div class="space-y-1.5">
                  <label for="environment-ssh-port" class="block text-xs font-medium text-foreground">{props.i18n.t('settings.portLabel')}</label>
                  <Input
                    id="environment-ssh-port"
                    value={isSSHBackedKind() ? (props.state as SSHBackedConnectionDialogState | null)?.ssh_port ?? '' : ''}
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
                <Show
                  when={true}
                  fallback={(
                    <div class="flex h-8 items-center rounded-md border border-border/70 bg-background px-2.5 text-xs text-foreground">
                      {props.i18n.t('connectionDialog.keyAgent')}
                    </div>
                  )}
                >
                  <SegmentedControl
                    value={isSSHBackedKind() ? (props.state as SSHBackedConnectionDialogState | null)?.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE : DEFAULT_DESKTOP_SSH_AUTH_MODE}
                    onChange={(value) => props.updateField('auth_mode', value)}
                    options={[
                      { value: 'key_agent', label: props.i18n.t('connectionDialog.keyAgent') },
                      { value: 'password', label: props.i18n.t('connectionDialog.passwordPrompt') },
                    ]}
                    size="sm"
                  />
                </Show>
                <div class="text-[11px] leading-5 text-muted-foreground">
                  {props.i18n.t('connectionDialog.authenticationHelp')}
                </div>
              </div>
              <Show when={isSSHBackedKind() && ((props.state as SSHBackedConnectionDialogState | null)?.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE) === 'password'}>
                <div class="space-y-1.5">
                  <label for="environment-ssh-password" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.localSshPassword')}</label>
                  <Input
                    id="environment-ssh-password"
                    type="password"
                    autocomplete="new-password"
                    value={isSSHBackedKind() ? (props.state as SSHBackedConnectionDialogState | null)?.ssh_password ?? '' : ''}
                    onInput={(event) => props.updateField('ssh_password', event.currentTarget.value)}
                    placeholder={(props.state as SSHBackedConnectionDialogState | null)?.ssh_password_configured ? props.i18n.t('connectionDialog.replaceStoredPasswordPlaceholder') : props.i18n.t('connectionDialog.optionalSavedPasswordPlaceholder')}
                    size="sm"
                    class="w-full"
                  />
                  <div class="text-[11px] leading-5 text-muted-foreground">
                    {props.i18n.t('connectionDialog.localSshPasswordHelp')}
                  </div>
                  <Show when={(props.state as SSHBackedConnectionDialogState | null)?.ssh_password_configured && (props.state as SSHBackedConnectionDialogState | null)?.ssh_password_mode !== 'clear'}>
                    <Button size="sm" variant="outline" onClick={props.removeSSHPassword}>
                      {props.i18n.t('settings.removeStoredPassword')}
                    </Button>
                  </Show>
                  <Show when={(props.state as SSHBackedConnectionDialogState | null)?.ssh_password_mode === 'clear'}>
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
                      <Show when={connectionKind() === 'ssh_environment'}>
                        <div class="space-y-1.5">
                          <label class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.bootstrapDelivery')}</label>
                          <SegmentedControl
                            value={sshBootstrapStrategy()}
                            onChange={(value) => props.switchBootstrapStrategy(value as DesktopSSHBootstrapStrategy)}
                            options={[
                              { value: 'auto', label: props.i18n.t('connectionDialog.automatic') },
                              { value: 'desktop_upload', label: props.i18n.t('connectionDialog.desktopUpload') },
                              { value: 'remote_install', label: props.i18n.t('connectionDialog.remoteDownloadInstall') },
                            ]}
                            size="sm"
                          />
                          <div class="text-[11px] text-muted-foreground">
                            {props.i18n.t('connectionDialog.bootstrapHelp')}{' '}
                            <span class="font-medium text-foreground">{props.i18n.t('connectionDialog.source', { source: sshBootstrapSummaryLabel() })}</span>
                          </div>
                        </div>
                      </Show>
                      <div class="space-y-1.5">
                        <label for="environment-ssh-runtime-root" class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.runtimeRoot')}</label>
                        <Input
                          id="environment-ssh-runtime-root"
                          value={props.state?.connection_kind === 'ssh_environment' || props.state?.connection_kind === 'gateway_url_profile' ? props.state.runtime_root : ''}
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
                      <Show when={connectionKind() === 'ssh_environment'}>
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
                            value={isSSHBackedKind() && props.state?.connection_kind !== 'gateway_url_profile' ? (props.state as SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null)?.connect_timeout_seconds ?? '' : ''}
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
                      </Show>
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
                      value={props.state?.connection_kind === 'local_container_runtime' || props.state?.connection_kind === 'ssh_container_runtime' || props.state?.connection_kind === 'gateway_url_profile' ? props.state.container_engine : 'docker'}
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
                  selectedContainerID={props.state?.connection_kind === 'local_container_runtime' || props.state?.connection_kind === 'ssh_container_runtime' || props.state?.connection_kind === 'gateway_url_profile' ? props.state.container_id : ''}
                  selectedContainerRef={props.state?.connection_kind === 'local_container_runtime' || props.state?.connection_kind === 'ssh_container_runtime' || props.state?.connection_kind === 'gateway_url_profile' ? props.state.container_ref : ''}
                  selectedContainerLabel={props.state?.connection_kind === 'local_container_runtime' || props.state?.connection_kind === 'ssh_container_runtime' || props.state?.connection_kind === 'gateway_url_profile' ? props.state.container_label : ''}
                  containers={props.containerOptions}
                  loading={props.containerOptionsLoading}
                  disabled={connectionKind() === 'ssh_container_runtime' && trimString((props.state as ContainerBackedConnectionDialogState | null)?.ssh_destination) === ''}
                  error={props.containerOptionsError}
                  emptyMessage={connectionKind() === 'ssh_container_runtime' && trimString((props.state as ContainerBackedConnectionDialogState | null)?.ssh_destination) === ''
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
                  value={props.state?.connection_kind === 'local_container_runtime' || props.state?.connection_kind === 'ssh_container_runtime' || props.state?.connection_kind === 'gateway_url_profile' ? props.state.runtime_root : ''}
                  onInput={(event) => {
                    props.updateField('runtime_root', event.currentTarget.value);
                    props.clearFieldErrors();
                  }}
                  placeholder={connectionKind() === 'ssh_container_runtime' || connectionKind() === 'gateway_url_profile' ? DEFAULT_DESKTOP_SSH_RUNTIME_ROOT_LABEL : '/root/.redeven'}
                  size="sm"
                  class={cn('w-full', props.fieldErrors.runtime_root && 'border-destructive ring-1 ring-destructive/20')}
                  spellcheck={false}
                />
                <div class="text-[11px] text-muted-foreground">
                  {connectionKind() === 'ssh_container_runtime' || connectionKind() === 'gateway_url_profile'
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
                  checked={connectionDialogAutoRuntimeProbeEnabled(props.state)}
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
  sshConfigHostsLoading: boolean;
  sshConfigHostsLoadError: boolean;
  containerOptions: readonly DesktopRuntimeContainerOption[];
  containerOptionsLoading: boolean;
  containerOptionsError: string;
  error: string;
  fieldErrors: Partial<Record<string, string>>;
  busyState: DesktopLauncherBusyState;
  onOpenChange: (open: boolean) => void;
  updateField: (name: keyof GatewaySetupDialogState, value: string | boolean) => void;
  refreshContainerOptions: () => void;
  refreshSSHConfigHosts: () => void;
  clearFieldErrors: () => void;
  removeSSHPassword: () => void;
  onSave: () => Promise<void>;
}>) {
  const isOpen = createMemo(() => props.state !== null);
  const connectionKind = createMemo(() => props.state?.connection_kind ?? 'url');
  const isSSHBacked = createMemo(() => connectionKind() === 'ssh_host' || connectionKind() === 'ssh_container');
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
    trimString(props.state?.connection_kind === 'ssh_host' ? props.state.release_base_url : '') === ''
      ? DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL
      : props.i18n.t('connectionDialog.customMirror')
  ));
  const gatewayBootstrapSummaryLabel = createMemo(() => {
    switch (gatewayBootstrapStrategy()) {
      case 'desktop_upload': return gatewayReleaseBaseURLLabel();
      case 'remote_install': return props.i18n.t('connectionDialog.remoteDownloadInstall');
      default: return props.i18n.t('connectionDialog.automatic');
    }
  });
  const gatewayAdvancedDescription = createMemo(() => (
    connectionKind() === 'ssh_host'
      ? props.i18n.t('connectionDialog.advancedDescription')
      : props.i18n.t('connectionDialog.gatewayContainerAdvancedDescription')
  ));

  createEffect(() => {
    const section = props.state?.focus_section;
    if (!section) {
      return;
    }
    queueMicrotask(() => {
      switch (section) {
        case 'url_endpoint':
          document.getElementById('gateway-url')?.scrollIntoView({ block: 'center' });
          break;
        case 'identity_trust':
          document.getElementById('gateway-name')?.scrollIntoView({ block: 'center' });
          break;
      }
    });
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
          <div class="rounded-md border border-dashed border-border/40 bg-muted/10 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            {props.i18n.t('connectionDialog.gatewayUrlHelp')}
          </div>
        </div>

        <Show when={true}>
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
              <div class="mt-3 space-y-1.5">
                <label for="gateway-pairing-code" class="block text-xs font-medium text-foreground">
                  {props.i18n.t('connectionDialog.gatewayPairingCode')}
                </label>
                <Input
                  id="gateway-pairing-code"
                  value={props.state?.pairing_code ?? ''}
                  onInput={(event) => {
                    props.updateField('pairing_code', event.currentTarget.value);
                    props.clearFieldErrors();
                  }}
                  placeholder={props.i18n.t('connectionDialog.gatewayPairingCodePlaceholder')}
                  size="sm"
                  class="w-full"
                  spellcheck={false}
                />
                <div class="text-[11px] leading-5 text-muted-foreground">
                  {props.i18n.t('connectionDialog.gatewayPairingCodeHelp')}
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={false}>
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
                    inputID="gateway-ssh-destination"
                    value={props.state?.ssh_destination ?? ''}
                    hosts={props.sshConfigHosts}
                    loading={props.sshConfigHostsLoading}
                    loadError={props.sshConfigHostsLoadError}
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
                    onRetry={props.refreshSSHConfigHosts}
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
                        {
                          value: 'key_agent',
                          label: props.i18n.t('connectionDialog.keyAgent'),
                        },
                        {
                          value: 'password',
                          label: props.i18n.t('connectionDialog.passwordPrompt'),
                        },
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
                      onClick={() =>
                        setAdvancedState((current) => ({
                          ...current,
                          open: !current.open,
                        }))
                      }
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
                                { value: 'remote_install', label: props.i18n.t('connectionDialog.remoteDownloadInstall') },
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
                          <label for="gateway-data-root" class="block text-xs font-medium text-foreground">
                            {props.i18n.t('connectionDialog.gatewayDataRoot')}
                          </label>
                          <Input
                            id="gateway-data-root"
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

        <Show when={false}>
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

        <Show when={true}>
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

function officialProviderOptionForOrigin(
  providerOrigin: string,
  options: readonly ControlPlaneProviderPresetOption[],
): ControlPlaneProviderPresetOption | null {
  return controlPlaneProviderPresetForOrigin(providerOrigin, options) ?? defaultControlPlaneProviderPreset(options);
}

function OfficialProviderPicker(props: Readonly<{
  i18n: DesktopI18n;
  options: readonly ControlPlaneProviderPresetOption[];
  providerOrigin: string;
  onSelect: (providerOrigin: string) => void;
  autofocus?: boolean;
}>) {
  const canChooseTarget = props.options.length > 1;
  const [open, setOpen] = createSignal(false);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  let closeTimer: number | undefined;
  let rootRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;
  let listboxRef: HTMLDivElement | undefined;

  const selectedProvider = createMemo(() => officialProviderOptionForOrigin(props.providerOrigin, props.options));
  const selectedIndex = createMemo(() => Math.max(0, props.options.findIndex((option) => (
    option.provider_origin === selectedProvider()?.provider_origin
  ))));

  createEffect(on(
    [open, () => props.providerOrigin],
    ([isOpen]) => {
      if (isOpen) {
        setHighlightedIndex(selectedIndex());
      }
    },
  ));

  createEffect(() => {
    if (open()) {
      scrollDesktopListboxOptionIntoView(listboxRef, `control-plane-provider-option-${highlightedIndex()}`);
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
    if (!canChooseTarget) {
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

  function moveHighlight(delta: number): void {
    const count = props.options.length;
    if (count <= 0) {
      return;
    }
    setHighlightedIndex((current) => (current + delta + count) % count);
  }

  function selectProvider(option: ControlPlaneProviderPresetOption): void {
    props.onSelect(option.provider_origin);
    setOpen(false);
    buttonRef?.focus();
  }

  return (
    <Show when={canChooseTarget} fallback={(
      <div
        data-redeven-cloud-target="fixed"
        class="mt-1 inline-flex items-center gap-2 text-xs text-muted-foreground"
        aria-label={props.i18n.t('connectionDialog.providerPreset')}
      >
        <span aria-hidden="true" class="h-1.5 w-1.5 rounded-full bg-success" />
        <span class="font-mono text-[11px]">{selectedProvider()?.domain ?? ''}</span>
      </div>
    )}>
      <div
        ref={rootRef}
        class="w-full space-y-1.5 text-left"
        onFocusOut={(event) => {
          if (containsTarget(event.relatedTarget)) {
            return;
          }
          closeMenuSoon();
        }}
      >
        <label for="control-plane-provider-picker" class="block text-xs font-medium text-foreground">
          {props.i18n.t('connectionDialog.providerPreset')}
        </label>
        <button
          ref={buttonRef}
          id="control-plane-provider-picker"
          type="button"
          class="group flex min-h-16 w-full cursor-pointer items-center justify-between gap-3 rounded-lg bg-muted/40 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-haspopup="listbox"
          aria-expanded={open() ? 'true' : 'false'}
          aria-controls="control-plane-provider-options"
          aria-activedescendant={open() ? `control-plane-provider-option-${highlightedIndex()}` : undefined}
          autofocus={props.autofocus}
          data-floe-autofocus={props.autofocus ? 'true' : undefined}
          onClick={() => {
            if (open()) {
              setOpen(false);
              return;
            }
            openMenu();
          }}
          onKeyDown={(event) => {
            if (!open() && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              openMenu();
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
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              const option = props.options[highlightedIndex()];
              if (option) {
                selectProvider(option);
              }
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <span class="flex min-w-0 items-center gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck class="h-4 w-4" />
            </span>
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold tracking-normal text-foreground">{selectedProvider()?.domain ?? ''}</span>
              <span class="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{selectedProvider()?.provider_origin ?? ''}</span>
            </span>
          </span>
          <ChevronDown class={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open() && 'rotate-180')} />
        </button>
        <Show when={open()}>
          <DesktopAnchoredListbox
            id="control-plane-provider-options"
            anchorRef={buttonRef}
            class="p-1.5 shadow-2xl"
            maxHeight={220}
            role="listbox"
            open={open()}
            onOverlayRef={(element) => {
              listboxRef = element;
            }}
          >
            <div class="min-h-0 flex-1 overflow-auto">
              <For each={props.options}>
                {(option, index) => {
                  const selected = createMemo(() => selectedProvider()?.provider_origin === option.provider_origin);
                  const highlighted = createMemo(() => highlightedIndex() === index());
                  return (
                    <button
                      type="button"
                      id={`control-plane-provider-option-${index()}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected() ? 'true' : 'false'}
                      class={cn(
                        'flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-all',
                        highlighted()
                          ? 'bg-accent text-accent-foreground shadow-sm'
                          : 'text-foreground hover:bg-accent/70 hover:text-accent-foreground',
                      )}
                      onClick={() => selectProvider(option)}
                      onMouseEnter={() => setHighlightedIndex(index())}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectProvider(option);
                      }}
                    >
                      <span class="flex min-w-0 items-center gap-3">
                        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Globe class="h-4 w-4" />
                        </span>
                        <span class="min-w-0">
                          <span class="block truncate text-sm font-semibold">{option.domain}</span>
                          <span class="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{option.provider_origin}</span>
                        </span>
                      </span>
                      <Show when={selected()}>
                        <Check class="h-4 w-4 shrink-0" />
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </DesktopAnchoredListbox>
        </Show>
      </div>
    </Show>
  );
}

function ControlPlaneDialog(props: Readonly<{
  i18n: DesktopI18n;
  logoSrc: string;
  providerOptions: readonly ControlPlaneProviderPresetOption[];
  state: ControlPlaneDialogState;
  error: string;
  busyState: DesktopLauncherBusyState;
  onOpenChange: (open: boolean) => void;
  updateField: (name: 'provider_origin', value: string) => void;
  onConnect: () => Promise<void>;
}>) {
  // See ConnectionDialog: memoize the open boolean so that identity churn in
  // `props.state` never re-triggers the overlay-mask focus trap mid-typing.
  const isOpen = createMemo(() => props.state !== null);
  const canContinue = createMemo(() => trimString(props.state?.provider_origin) !== '');
  return (
    <Dialog
      open={isOpen()}
      onOpenChange={props.onOpenChange}
      title={props.i18n.t('connectionDialog.addProviderTitle')}
      class="w-[min(27rem,calc(100vw-2rem))]"
    >
      <div class="px-3 pb-1 pt-2 text-center">
        <div class="flex flex-col items-center">
          <div class="relative isolate flex h-20 w-20 items-center justify-center">
            <span aria-hidden="true" class="absolute inset-2 -z-10 rounded-full bg-primary/25 blur-2xl" />
            <img
              src={props.logoSrc}
              alt=""
              aria-hidden="true"
              class="relative h-20 w-20 select-none"
              draggable={false}
            />
          </div>
          <div class="mt-3 text-lg font-semibold tracking-[-0.01em] text-foreground">
            {props.i18n.t('desktop.provider')}
          </div>
          <OfficialProviderPicker
            i18n={props.i18n}
            options={props.providerOptions}
            providerOrigin={props.state?.provider_origin ?? props.providerOptions[0]?.provider_origin ?? ''}
            autofocus
            onSelect={(providerOrigin) => props.updateField('provider_origin', providerOrigin)}
          />
          <p class="mt-5 max-w-[22rem] text-xs leading-5 text-muted-foreground">
            {props.i18n.t('connectionDialog.providerAuthorizationHelp')}
          </p>
        </div>
        <Show when={props.error}>
          <div role="alert" class="mt-4 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-left text-xs text-destructive">
            {props.error}
          </div>
        </Show>
        <div class="mt-6 grid gap-1.5">
          <Button
            size="sm"
            variant="default"
            class="w-full justify-center"
            data-floe-autofocus={props.providerOptions.length <= 1 ? 'true' : undefined}
            disabled={!canContinue()}
            loading={busyStateMatchesAction(props.busyState, 'start_control_plane_connect')}
            onClick={() => {
              void props.onConnect();
            }}
          >
            {props.i18n.t('connectionDialog.continueInBrowser')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="w-full justify-center text-muted-foreground"
            onClick={() => props.onOpenChange(false)}
          >
            {props.i18n.t('common.cancel')}
          </Button>
        </div>
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
  passwordRequired: boolean;
  passwordInvalid: boolean;
  localUIPasswordCanClear: boolean;
  updateDraftField: (name: keyof DesktopSettingsDraft, value: string) => void;
  clearStoredLocalUIPassword: () => void;
  inputRef?: (value: HTMLInputElement) => void;
  supportingContent?: JSX.Element;
}>) {
  const statusTag = (
    <Tag
      variant={passwordStateTagVariant(props.passwordStateTone)}
      tone="soft"
      size="sm"
      class="cursor-default whitespace-nowrap"
    >
      {compactLocalizedPasswordStateTagLabel(props.i18n, props.passwordStateID)}
    </Tag>
  );
  return (
    <SettingsFieldInput
      field={props.snapshot.host_fields[1]!}
      value={props.draft.local_ui_password}
      updateDraftField={props.updateDraftField}
      i18n={props.i18n}
      required={props.passwordRequired}
      invalid={props.passwordInvalid}
      errorId="local-ui-password-required-error"
      errorMessage={props.passwordInvalid ? props.i18n.t('settings.sharedPasswordRequired') : ''}
      inputRef={props.inputRef}
      accessory={statusTag}
      supportingContent={props.supportingContent}
      trailing={props.localUIPasswordCanClear ? (
        <div class="flex justify-end">
          <button
            type="button"
            class="inline-flex cursor-pointer items-center justify-start rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={props.clearStoredLocalUIPassword}
          >
            {props.i18n.t('settings.removeStoredPassword')}
          </button>
        </div>
      ) : undefined}
    />
  );
}

function SettingsFieldInput(props: Readonly<{
  field: DesktopSettingsSurfaceSnapshot['host_fields'][number];
  value: string;
  updateDraftField: (name: keyof DesktopSettingsDraft, value: string) => void;
  i18n: DesktopI18n;
  required?: boolean;
  invalid?: boolean;
  errorId?: string;
  errorMessage?: string;
  inputRef?: (value: HTMLInputElement) => void;
  accessory?: JSX.Element;
  trailing?: JSX.Element;
  supportingContent?: JSX.Element;
}>) {
  const compactLabel = createMemo(() => compactLocalizedSettingsFieldLabel(props.i18n, props.field));
  const helpText = createMemo(() => localizedSettingsFieldHelp(props.i18n, props.field));
  const placeholderText = createMemo(() => localizedSettingsFieldPlaceholder(props.i18n, props.field));
  const describedBy = createMemo(() => {
    const values = (props.field.describedBy ?? []).filter((value) => {
      if (value === props.field.helpId) {
        return helpText() !== '';
      }
      return true;
    });
    if (props.errorId && trimString(props.errorMessage) !== '') {
      values.push(props.errorId);
    }
    return values.length > 0 ? values.join(' ') : undefined;
  });

  return (
    <Show when={!props.field.hidden}>
      <SettingsFormRow
        controlID={props.field.id}
        label={compactLabel()}
        help={helpText()}
        required={props.required}
        accessory={props.accessory}
        i18n={props.i18n}
      >
        <div class="space-y-2">
          <Input
            ref={props.inputRef}
            id={props.field.id}
            name={props.field.name}
            value={props.value}
            type={props.field.type ?? 'text'}
            autocomplete={props.field.autocomplete}
            inputMode={props.field.inputMode}
            placeholder={placeholderText()}
            spellcheck={false}
            aria-describedby={describedBy()}
            aria-invalid={props.invalid || undefined}
            required={props.required}
            size="sm"
            class={cn(
              'w-full',
              props.invalid && 'border-destructive focus:border-destructive focus:ring-destructive/20',
            )}
            onInput={(event) => props.updateDraftField(props.field.name, event.currentTarget.value)}
          />
          <Show when={props.errorId && trimString(props.errorMessage) !== ''}>
            <div id={props.errorId} role="alert" class="flex items-start gap-1.5 text-[11px] leading-5 text-destructive">
              <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{props.errorMessage}</span>
            </div>
          </Show>
          {props.trailing}
          {props.supportingContent}
          <Show when={helpText() !== '' && props.field.helpId}>
            <div id={props.field.helpId!} class="sr-only">{helpText()}</div>
          </Show>
        </div>
      </SettingsFormRow>
    </Show>
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
