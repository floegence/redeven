import { RuntimeGatewaySetupDialog } from './RuntimeGatewaySetupDialog';
import { GatewayCloudPanel } from './GatewayCloudPanel';
import { handleTessivenLink, type TessivenOpenRequest } from '../../../internal/tessiven_ui/src/navigation';
import { TessivenPage } from '../../../internal/tessiven_ui/src/TessivenPage';
import { TessivenIcon } from '../../../internal/tessiven_ui/src/TessivenIcon';
import { tessivenText } from '../../../internal/tessiven_ui/src/i18n';
import { createDesktopTessivenTransport } from './tessivenTransport';
import type { ContextActionEnvelope } from '../../../internal/flower_ui/src/contextActionWire';
import { EnvironmentAccessSettings } from './EnvironmentAccessSettings';
import { environmentAccessRouteLabel } from './environmentAccessPresentation';
import {
  StableText,
  Button,
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  CommandPalette,
  ConfirmDialog,
  createFloatingPresence,
  Dialog,
  Input,
  SegmentedControl,
  Tag,
} from '@floegence/floe-webapp-core/ui';
import { GatewayMark } from './GatewayMark';
import { GatewayEnvironmentList } from './GatewayEnvironmentList';
import { GatewayPermissionsEditor } from './GatewayPermissionsEditor';
import { GatewayMembersDialog } from './GatewayMembersDialog';
import type { GatewayPermissions } from '../shared/gatewayMembership';
import { EnvironmentAccessWorkflow } from './EnvironmentAccessWorkflow';
import type { SecurityRequest, SecurityResult } from '../shared/runtimeSecurity';
import { CloudAccountOverview } from './CloudAccountOverview';
import { EnvironmentCardsPanel, environmentActionUsesLifecycleOwner, type EnvironmentOwnerPresentation, type EnvironmentGuidanceActionResolution, type LifecycleProgressFocusRequest } from './EnvironmentCards';
import { ConsoleActionIconButton, EnvironmentStatusIndicator } from './environmentCardPrimitives';
import { EnvironmentConnectionRows } from './EnvironmentConnectionRows';
import { DesktopFlowerRuntimeBoundary } from './flower/DesktopFlowerRuntimeBoundary';
import { runtimeFlowerBlocker } from '../shared/runtimeFlowerAccess';
import { buildRuntimeConnectionRows, isShareableConnectionAddress, type DesktopShareableConnectionAddress, type AddressRecoveryTarget } from '../shared/desktopEnvironmentConnection';
import type { DesktopCertificateRequest, DesktopCertificateReport } from '../shared/desktopCertificate';
import { For, Index, Show, batch, createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, onMount, type JSX } from 'solid-js';
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
  Link,
  Lock,
  Highlighter,
  HelpIcon,
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
  X,
} from '@floegence/floe-webapp-core/icons';
import { BottomBarItem, TopBarIconButton } from '@floegence/floe-webapp-core/layout';

import { SSHEnvironmentSettingsForm } from './SSHEnvironmentSettingsForm';
import { EnvironmentSettingsDialog, EnvironmentSettingsPanel, EnvironmentSettingsReveal } from './EnvironmentSettingsDialog';
import { createEnvironmentSettingsController } from './environmentSettingsSession';
import { validateSSHEnvironmentSettings, type SSHConnectionDialogState } from './sshEnvironmentSettingsState';

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
  type DesktopGatewayConnectionKind,
  type DesktopGatewayDiagnosis,
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
  type DesktopLocalUIPasswordMode,
  type DesktopSettingsDraft,
} from '../shared/settingsIPC';
import {
  type RuntimeServiceSnapshot,
  type RuntimeServiceWorkload,
} from '../shared/runtimeService';
import { createAskFlowerWindowViewportInsets } from '../shared/askFlowerWindowViewport';
import {
  FlowerIcon,
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
} from '../shared/desktopAccessModel';
import {
  buildEnvironmentLibrarySummaryModel,
  buildEnvironmentCardModel,
  buildEnvironmentSettingsRuntimeModel,
  buildEnvironmentCardFactsModel,
  buildGatewaySourceRowModel,
  ICON_ENDPOINTS,
  environmentOpenFlow,
  environmentLibraryCount,
  filterGatewayEnvironmentEntries,
  filterEnvironmentLibraryDisplayGroups,
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
import { buildEnvironmentLibraryDisplayGroups, environmentCloudSections, type EnvironmentLibraryDisplayGroup } from './environmentLibraryProjection';
import {
  launcherActionFailurePresentation,
} from './launcherActionFeedback';
import {
  buildWelcomeOperationFailureDisplay,
  confirmationProgressForLauncherFailure,
} from './operationFailureDisplay';
import {
  DesktopAnchoredListbox,
  scrollDesktopListboxOptionIntoView,
} from './DesktopAnchoredListbox';
import { SSHDestinationCombobox } from './SSHDestinationCombobox';

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
  closeGatewaySourceOverlayState,
  closedGatewaySourceOverlayState,
  gatewaySourceIDsWithActiveOverlay,
  gatewaySourceOverlayOpenFor,
  openGatewaySourceOverlayState,
  reconcileGatewaySourceOverlayState,
} from './gatewaySourceOverlayState';
import {
  environmentActionForLauncherRetry,
  groupedVisibleOperationNextActions,
} from './operationNextActions';
import {
  advanceEnvironmentOpenFlowStage,
  completeEnvironmentGuidanceRefresh,
  failEnvironmentGuidanceIntent,
  guidanceSessionNotice,
  isEnvironmentGuidancePendingIntent,
  openEnvironmentGuidanceSession,
  startEnvironmentGuidanceIntent,
  type EnvironmentGuidanceSessionState,
} from './environmentGuidanceSession';
import {
  continueEnvironmentOpenAfterLifecycle,
  reconcileEnvironmentOpenBeforeLifecycle,
  runEnvironmentOpenPreflight,
} from './environmentOpenPreflight';
import {
  createEnvironmentLifecycleAttempt, type EnvironmentLifecycleAttempt, type EnvironmentSettingsRestartSource,
} from './environmentLifecycleDisclosure';
import {
  environmentProgressMeterPercent,
  environmentProgressElapsedSeconds,
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
  reconcileBusyStateWithActionProgressSnapshot,
  busyStateMatchesAction,
  busyStateMatchesEnvironment,
  busyStateMatchesGateway,
  IDLE_LAUNCHER_BUSY_STATE,
  selectedSnapshotRuntimeLifecycleProgressForEnvironment,
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
      openExternalURL?: (url: string) => Promise<{ ok: boolean; message?: string }>;
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
  opening_id: number;
  mode: 'create' | 'edit';
  gateway_id: string;
  display_name: string;
  display_name_touched: boolean;
  connection_kind: DesktopGatewayConnectionKind;
  gateway_url: string;
  pairing_code: string;
  permissions: GatewayPermissions;
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

type ConnectionDialogKind = 'external_local_ui' | 'ssh_environment' | 'local_container_runtime' | 'ssh_container_runtime';
type ConnectionDialogState = ExternalURLConnectionDialogState | SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null;
type SSHBackedConnectionDialogState = SSHConnectionDialogState | RuntimeContainerConnectionDialogState;
type ContainerBackedConnectionDialogState = RuntimeContainerConnectionDialogState;
type SSHPasswordConnectionDialogState = SSHBackedConnectionDialogState;
type SSHPasswordDraftState = SSHPasswordConnectionDialogState | GatewaySetupDialogState;

type ControlPlaneDialogState = Readonly<{
  provider_origin: string;
}> | null;

const LOGO_LIGHT_URL = new URL('../../../internal/envapp/ui_src/public/logo.svg', import.meta.url).href;
const LOGO_DARK_URL = new URL('../../../internal/envapp/ui_src/public/logo-dark.svg', import.meta.url).href;
type ControlPlaneProviderPresetOption = Readonly<{
  domain: string;
  provider_origin: string;
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


type GatewayActionRecovery = Readonly<{
  gateway_id: string;
  message: string;
  start_action?: Extract<DesktopLauncherActionRequest, { kind: 'start_gateway' }>;
}>;

type LauncherActionErrorTarget = 'connect' | 'settings' | 'dialog' | 'control_plane_dialog' | 'gateway_dialog';

const DESKTOP_FLOE_STORAGE_NAMESPACE = 'redeven-desktop-shell';
const DESKTOP_FLOE_THEME_STORAGE_KEY = 'theme';
const DESKTOP_FLOE_SHELL_THEME_STORAGE_KEY = `${DESKTOP_FLOE_THEME_STORAGE_KEY}-shell-preset`;
const ACTION_TOAST_TTL_MS = 4_000;
const GATEWAY_TERMINAL_PROGRESS_VISIBLE_MS = ACTION_TOAST_TTL_MS;

const FALLBACK_DESKTOP_LANGUAGE_SNAPSHOT: RedevenLanguageSnapshot = {
  preference: SYSTEM_LOCALE_PREFERENCE,
  resolved_locale: 'en-US',
  source: 'fallback',
  system_candidates: [],
};

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
    layout: { mobileQuery: 'not all' },
    theme: {
      storageKey: DESKTOP_FLOE_THEME_STORAGE_KEY,
      shellPresetStorageKey: DESKTOP_FLOE_SHELL_THEME_STORAGE_KEY,
      defaultTheme: themeBridge?.getSnapshot().source ?? 'system',
      shellPresets: builtInShellThemePresets,
      defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS,
      defaultSurfaceStyle: 'soft-neumorphic',
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
    Running: 'progress.running',
    'Not running': 'settings.notRunning',
    OPENING: 'environmentStatus.opening',
    READY: 'status.ready',
    'CATALOG AVAILABLE': 'gatewayAccess.catalogAvailable',
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
  return localizedEnvironmentStatusLabel(i18n, localizedStringByValue(i18n, label, {
    Installing: 'environmentCenter.gatewayStatusInstalling',
    Starting: 'environmentCenter.gatewayStatusStarting',
    Updating: 'environmentCenter.gatewayStatusUpdating',
    'Update available': 'environmentCenter.gatewayNeedsUpdate',
    'Reinstall required': 'environmentStatus.reinstallRequired',
    'Service ready': 'progress.gatewayServiceReady',
    Disabled: 'environmentCenter.gatewayDisabledStatus',
    Refreshing: 'environmentCenter.gatewayActionSyncing',
    'Not started': 'environmentStatus.stopped',
  }));
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
    'No Runtime members are currently registered with this Gateway.': 'environmentCenter.gatewaySummaryDetailNone',
  });
}

function localizedGatewaySourceActionLabel(i18n: DesktopI18n, action: GatewaySourceActionModel): string {
  switch (action.intent) {
    case 'manage_gateway_members':
      return i18n.t('environmentCenter.gatewayAddEnvironmentShort');
    case 'open_gateway_environment':
      return i18n.t('environmentAction.open');
    case 'view_gateway_environments':
      return i18n.t('environmentCenter.viewEnvironments');
    case 'enable_gateway':
      return i18n.t('environmentCenter.gatewayActionEnable');
    case 'disable_gateway':
      return i18n.t('environmentCenter.gatewayActionDisable');
    case 'start_gateway': return i18n.t('environmentCenter.gatewayActionStart');
    case 'stop_gateway': return i18n.t('environmentCenter.gatewayActionStop');
    case 'restart_gateway': return i18n.t('environmentCenter.gatewayActionRestart');
    case 'update_gateway': return i18n.t('environmentCenter.gatewayActionUpdate');
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
    'Start Gateway': 'environmentCenter.gatewayActionStart',
    'Stop Gateway': 'environmentCenter.gatewayActionStop',
    'Restart Gateway': 'environmentCenter.gatewayActionRestart',
    'Update Gateway': 'environmentCenter.gatewayActionUpdate',
    'Pair Gateway': 'environmentCenter.gatewayPanelPairThisGatewayAria',
    'Desktop will stop the Gateway service on the configured target.': 'environmentCenter.gatewayPanelStopDetail',
    'Desktop will restart the Gateway service on the configured target.': 'environmentCenter.gatewayPanelRestartDetail',
    'Desktop will update the Gateway service on the configured target.': 'environmentCenter.gatewayPanelUpdateDetail',
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
    case 'service_confirmation': {
      const count = model.affected_sessions.length + model.overflow_session_count;
      return localizedGatewayActionPanelText(i18n, model.detail) + (count ? ' ' + i18n.t(count === 1
        ? 'environmentCenter.gatewayPanelConfirmSessionsOne' : 'environmentCenter.gatewayPanelConfirmSessionsMany', { count }) : '');
    }
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
    'HTTPS certificate verification failed. Check HTTPS configuration before restarting; the current Runtime has been kept running.': 'settings.certificateRestartBlocked',
    'Restart this runtime from Desktop so runtime-control can be prepared.': 'runtimeMessage.restartRuntimeForRuntimeControl',
    'Restart this runtime with the current Desktop Runtime before connecting it to Redeven Cloud.': 'runtimeMessage.restartRuntimeForRuntimeControl',
    'Runtime-control is not available for this runtime.': 'runtimeMessage.runtimeControlUnavailable',
    'Open this runtime to prepare the Desktop bridge and provider connection.': 'runtimeMessage.openRuntimePrepareProviderConnection',
    'Update Redeven Desktop before using Flower with this Runtime.': 'flowerRuntime.desktopDetail',
    'Update this Runtime before using Desktop Flower. Your draft is kept.': 'flowerRuntime.runtimeDetail',
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
  if (label === 'REMOTE') return i18n.t('environmentCenter.cloudRemoteAddress');
  return localizedStringByValue(i18n, label, {
    'RUNS ON': 'environmentFacts.runsOn',
    CONTAINER: 'environmentFacts.container',
    VERSION: 'environmentFacts.version',
    'REDEVEN CLOUD': 'environmentFacts.provider',
    'CONTROL PLANE': 'environmentFacts.controlPlane',
    'ENV ID': 'environmentFacts.environmentId',
    'Redeven Cloud': 'environmentFacts.provider',
    Gateway: 'environmentCenter.gatewaysSection',
    'Runtime root': 'environmentFacts.runtimeRoot',
    Bootstrap: 'environmentFacts.bootstrap',
    Source: 'environmentFacts.source',
    SOURCE: 'environmentFacts.source',
    URL: 'environmentFacts.url',
    Local: 'environmentCenter.localFilter',
    'Redeven URL': 'environmentCenter.redevenUrlFilter',
    'SSH Host': 'environmentCenter.sshHostFilter',
    LOCAL: 'environmentFacts.local',
    'SSH HOST': 'environmentFacts.sshHost',
    DETAIL: 'environmentFacts.detail',
    STATUS: 'environmentFacts.status',
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
  if (label === 'STATUS') {
    return localizedStringByValue(i18n, value, {
      'Not running': 'environmentFacts.notRunning',
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
  return label;
}

function localizedEnvironmentFact(
  i18n: DesktopI18n,
  fact: EnvironmentCardFactModel,
): EnvironmentCardFactModel {
  const value = fact.value_key ? i18n.t(fact.value_key) : fact.value_tone === 'placeholder'
    ? localizedPlaceholderFactValue(i18n, fact.value)
    : localizedFactValue(i18n, fact.label, fact.value);
  return {
    ...fact,
    label: fact.label_key ? i18n.t(fact.label_key) : localizedFactLabel(i18n, fact.label),
    value: fact.checked_at_unix_ms ? `${value} · ${i18n.formatDateTime(fact.checked_at_unix_ms)}` : value,
    action: fact.action
      ? {
          ...fact.action,
          label: localizedFactActionLabel(i18n, fact.action.label),
          aria_label: localizedFactActionLabel(i18n, fact.action.aria_label),
        }
        : undefined,
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

function gatewaySetupFailureDetail(failure: SilentLauncherActionFailure): string {
  const presentation = failure.raw_failure?.failure;
  return [presentation?.detail || failure.raw_failure?.message,
    ...(presentation?.diagnostics ?? []).map(diagnostic => diagnostic.text)].filter(Boolean).join('\n\n');
}

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
  state: RuntimeContainerConnectionDialogState | GatewaySetupDialogState,
): DesktopRuntimeHostAccess | null {
  if (state.connection_kind === 'local_container_runtime' || state.connection_kind === 'local_container') {
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

function runtimeContainerOptionsRequestKey(state: ConnectionDialogState | GatewaySetupDialogState): string {
  if (state?.connection_kind !== 'local_container_runtime' && state?.connection_kind !== 'ssh_container_runtime'
    && state?.connection_kind !== 'local_container' && state?.connection_kind !== 'ssh_container') {
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
  const seed = normalizeGatewayDisplayNameSeed(state.connection_kind === 'url' ? state.gateway_url
    : state.connection_kind.includes('container') ? state.container_label || state.container_ref
      : state.connection_kind === 'local_host' ? 'local' : state.ssh_destination);
  return seed === '' ? null : `Gateway-${seed}`;
}

let gatewaySetupOpeningSequence = 0;

function createGatewaySetupDialogState(
  overrides: Partial<GatewaySetupDialogState> = {},
): GatewaySetupDialogState {
  const connectionKind: DesktopGatewayConnectionKind = overrides.connection_kind ?? 'url';
  const displayName = trimString(overrides.display_name);
  const sshDestination = trimString(overrides.ssh_destination);
  const sshPort = trimString(overrides.ssh_port);
  const authMode = (trimString(overrides.auth_mode) as DesktopSSHAuthMode) || DEFAULT_DESKTOP_SSH_AUTH_MODE;
  const state: GatewaySetupDialogState = {
    opening_id: ++gatewaySetupOpeningSequence,
    mode: overrides.mode ?? 'create',
    focus_section: overrides.focus_section,
    gateway_id: trimString(overrides.gateway_id),
    display_name: displayName,
    display_name_touched: overrides.display_name_touched === true
      || ((overrides.mode ?? 'create') === 'edit' && displayName !== ''),
    connection_kind: connectionKind,
    gateway_url: trimString(overrides.gateway_url),
    pairing_code: trimString(overrides.pairing_code),
    permissions: overrides.permissions ?? { access: true, manage_members: false, configure_cloud: false },
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

function connectionDialogAutoRuntimeProbeEnabled(state: ConnectionDialogState): boolean {
  return connectionDialogAutoRuntimeProbeConfigurable(state)
    && state !== null
    && state.auto_runtime_probe_enabled === true;
}

function gatewayCanManageMembers(gateway: DesktopGatewaySource): boolean {
  return gateway.status === 'online'
    && gateway.trust_state === 'paired'
    && gateway.permissions?.manage_members === true;
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
    || typeof candidate.load !== 'function'
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
                      <span class="block truncate text-xs font-medium leading-snug">{option.label}</span>
                      <span class="block truncate text-[11px] leading-snug text-muted-foreground">{option.secondary}</span>
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
  const settingsController = createEnvironmentSettingsController<ConnectionDialogState>({
    load: (environment_id, dialog_token) => props.runtime.settings.load({ environment_id, dialog_token }),
    save: request => props.runtime.settings.save(request),
    closed: token => props.runtime.settings.cancel(token),
    lateError: error => showActionToast(settingsAccessErrorMessage(error), 'error'),
  });
  const settingsSession = settingsController.session;
  const [settingsPresent, setSettingsPresent] = createSignal(false);
  const settingsPresentation = createMemo<ReturnType<typeof settingsSession>>(previous => settingsSession() ?? previous, null);
  const [newConnectionState, setNewConnectionState] = createSignal<ConnectionDialogState>(null);
  const [memberGatewayID, setMemberGatewayID] = createSignal('');
  const connectionDialogState = () => settingsSession()?.connection ?? newConnectionState();
  function setConnectionDialogState(value: ConnectionDialogState | ((current: ConnectionDialogState) => ConnectionDialogState)) {
    if (settingsSession()?.saving) return connectionDialogState();
    const next = typeof value === 'function' ? value(connectionDialogState()) : value;
    if (settingsSession()) settingsController.update({ connection: next });
    else setNewConnectionState(next);
    return next;
  }
  const [gatewaySetupDialogState, setGatewaySetupDialogState] = createSignal<GatewaySetupDialogState | null>(null);
  const [gatewaySetupRecovery, setGatewaySetupRecovery] = createSignal<GatewayActionRecovery | null>(null);
  const [gatewaySetupTechnicalDetail, setGatewaySetupTechnicalDetail] = createSignal('');
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
  const [deleteReplacement, setDeleteReplacement] = createSignal('');
  createEffect(on(deleteTarget, () => setDeleteReplacement('')));
  const deleteReplacementRoutes = () => deleteTarget()?.access_routes?.filter(route => route.environment_id !== deleteTarget()?.id) ?? [];
  const deleteNeedsReplacement = () => !!deleteTarget()?.access_routes?.some(route => route.environment_id === deleteTarget()?.id
    && route.id === deleteTarget()?.default_access_route_id) && deleteReplacementRoutes().length > 0;
  let deletedGatewayFocus: HTMLElement | undefined;
  const [deleteGatewayTarget, setDeleteGatewayTarget] = createSignal<DesktopGatewaySource | null>(null);
  const [providerRuntimeLinkConfirmation, setProviderRuntimeLinkConfirmation] = createSignal<ProviderRuntimeLinkConfirmationState | null>(null);
  const [providerRuntimeLinkProviderEnvironmentID, setProviderRuntimeLinkProviderEnvironmentID] = createSignal('');
  const [signOutControlPlaneTarget, setSignOutControlPlaneTarget] = createSignal<DesktopControlPlaneSummary | null>(null);
  createEffect(() => {
    const target = signOutControlPlaneTarget();
    if (target && !snapshot().control_planes.some(source => (
      source.provider.provider_origin === target.provider.provider_origin
      && source.provider.provider_id === target.provider.provider_id
    ))) setSignOutControlPlaneTarget(null);
  });
  const [flowerTurnLauncherOpen, setFlowerTurnLauncherOpen] = createSignal(false);
  const flowerTurnLauncherViewportInsets = createAskFlowerWindowViewportInsets({
    open: flowerTurnLauncherOpen,
    chrome: window.redevenDesktopWindowChrome,
  });
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
  const [cloudQuery, setCloudQuery] = createSignal('');
  const [focusedCloudSource, setFocusedCloudSource] = createSignal('', { equals: false });
  const [gatewaySourceFilter, setGatewaySourceFilter] = createSignal('');
  const [gatewayQuery, setGatewayQuery] = createSignal('');
  const [joinGatewayAfterCreate, setJoinGatewayAfterCreate] = createSignal(false);
  const [gatewaySetupEnvironmentID, setGatewaySetupEnvironmentID] = createSignal('');
  const [activeCenterTab, setActiveCenterTab] = createSignal<EnvironmentCenterTab>('environments');
  const [lifecycleProgressFocusRequest, setLifecycleProgressFocusRequest] = createSignal<LifecycleProgressFocusRequest | null>(null);
  const actionToastTimers = new Map<number, number>();
  const liveActionProgressTimers = new Map<string, number>();
  let nextActionToastID = 0;
  let lifecycleProgressFocusRequestSequence = 0;
  let settingsErrorRef: HTMLElement | undefined;
  let sshConfigHostsRequestID = 0;
  let runtimeContainerOptionsRequestID = 0;

  // The renderer owns in-window navigation. Host snapshots carry explicit open
  // requests separately from environment/progress refreshes.
  const [activeSurface, setActiveSurface] = createSignal(props.snapshot.surface);
  const flowerVisible = () => activeSurface() === 'flower';
  const [tessivenOpenRequest, setTessivenOpenRequest] = createSignal<TessivenOpenRequest | null>(null);
  onMount(() => {
    const click = (event: MouseEvent) => { handleTessivenLink(event, request => { setTessivenOpenRequest(request); navigateWelcomeSurface('tessiven'); }); };
    document.addEventListener('click', click);
    onCleanup(() => document.removeEventListener('click', click));
  });
  const tessivenVisible = () => activeSurface() === 'tessiven';
  const environmentsVisible = () => !flowerVisible() && !tessivenVisible();
  const tessivenVisited = createMemo((visited: boolean) => visited || tessivenVisible(), false);
  const tessivenTransport = createDesktopTessivenTransport(props.runtime.settings);
  const tessivenCopy = createMemo(() => tessivenText(languageSnapshot().resolved_locale));
  const flowerVisited = createMemo((visited: boolean) => visited || flowerVisible(), false);
  const environmentsVisited = createMemo((visited: boolean) => visited || environmentsVisible(), false);
  const visibleSurface = createMemo<DesktopLauncherSurface>(() => settingsSession() ? 'environment_settings' : activeSurface());
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
  const settingsBaselineSurface = () => settingsPresentation()!.access!.baseline_surface;
  const draft = () => settingsPresentation()!.access!.draft;
  const selectedSettingsEnvironmentEntry = createMemo(() => {
    const selected = settingsPresentation()?.environment;
    return selected ? snapshot().environments.find(environment => environment.id === selected.id) ?? selected : null;
  });
  createEffect(() => {
    const entries = snapshot().environments;
    const session = settingsSession();
    // A connection save can replace its registration ID before the reply rebinds the dialog.
    if (session && !session.saving && !entries.some(entry => entry.id === session.environment.id)) settingsController.close();
    const contextAction = flowerTurnLauncherIntent()?.context_action as ContextActionEnvelope | undefined;
    const contextOwner = contextAction?.source.surface === 'desktop_welcome_environment_card' ? contextAction.source.surface_id : undefined;
    if (contextOwner && !entries.some(entry => entry.id === contextOwner)) closeFlowerTurnLauncher();
  });
  const settingsSurface = (): DesktopSettingsSurfaceSnapshot => {
    const saved = settingsBaselineSurface();
    const environment = selectedSettingsEnvironmentEntry()!;
    return { ...saved, runtime_health: environment.runtime_health, runtime_started_at_unix_ms: environment.runtime_started_at_unix_ms,
      current_runtime_url: environment.local_ui_url ?? '', current_runtime_urls: environment.local_ui_urls ?? [],
      current_runtime_running: environment.runtime_health.status === 'online',
      runtime_configuration_pending: environment.runtime_health.status === 'online' && saved.runtime_configuration_pending === true
        && saved.runtime_started_at_unix_ms === environment.runtime_started_at_unix_ms,
    };
  };
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
    return environment?.runtime_operations.restart.availability === 'available';
  });
  const allLibraryGroups = createMemo(() => buildEnvironmentLibraryDisplayGroups(snapshot().environments));
  const controlPlanes = createMemo(() => snapshot().control_planes);
  const libraryLocalEntryCount = createMemo(() => (
    environmentLibraryCount(allLibraryGroups(), '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const availableLibrarySourceFilters = createMemo(() => {
    const next = new Set<string>();
    if (libraryLocalEntryCount() > 0) {
      next.add(LOCAL_ENVIRONMENT_LIBRARY_FILTER);
    }
    if (environmentLibraryCount(allLibraryGroups(), '', PROVIDER_ENVIRONMENT_LIBRARY_FILTER) > 0) {
      next.add(PROVIDER_ENVIRONMENT_LIBRARY_FILTER);
    }
    if (environmentLibraryCount(allLibraryGroups(), '', GATEWAY_ENVIRONMENT_LIBRARY_FILTER) > 0) {
      next.add(GATEWAY_ENVIRONMENT_LIBRARY_FILTER);
    }
    if (environmentLibraryCount(allLibraryGroups(), '', URL_ENVIRONMENT_LIBRARY_FILTER) > 0) {
      next.add(URL_ENVIRONMENT_LIBRARY_FILTER);
    }
    if (environmentLibraryCount(allLibraryGroups(), '', SSH_ENVIRONMENT_LIBRARY_FILTER) > 0) {
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
  const libraryGroups = createMemo<readonly EnvironmentLibraryDisplayGroup[]>(() => (
    filterEnvironmentLibraryDisplayGroups(
      allLibraryGroups(),
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
  const librarySummary = createMemo(() => (
    buildEnvironmentLibrarySummaryModel(snapshot(), activeCenterTab() === 'control_planes'
      ? environmentCloudSections(allLibraryGroups(), controlPlanes(), cloudQuery()).flatMap(section => section.visible_groups)
      : libraryGroups())
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
  const flowerRuntimeEnvironment = createMemo(() => {
    const targetID = snapshot().default_flower_runtime_target_id;
    const environment = targetID
      ? snapshot().environments.find((entry) => entry.id === targetID || entry.managed_runtime_target_id === targetID)
      : localEnvironmentEntry();
    return environment;
  });
  const flowerFilesystemScopeKey = createMemo(() => {
    const environment = flowerRuntimeEnvironment();
    return JSON.stringify([environment?.id, environment?.runtime_started_at_unix_ms, environment?.open_session_key]);
  });
  const flowerSurfaceCopy = createMemo(() => createDesktopFlowerSurfaceCopy(i18n()));
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
      case 'focus_cloud_source':
        setCloudQuery('');
        setFocusedCloudSource(action.source_id);
        setActiveCenterTab('control_planes');
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
    const applyShellTheme = (next: ReturnType<typeof shellTheme.getSnapshot>) => batch(() => {
      setThemeSnapshot(next);
      for (const mode of ['light', 'dark'] as const) {
        if (theme.shellPresetForMode(mode)?.name !== next.shellThemes[mode]) {
          theme.setShellPreset(next.shellThemes[mode]);
        }
      }
      if (theme.theme() !== next.source) {
        theme.setTheme(next.source);
      }
    });
    applyShellTheme(shellTheme.getSnapshot());
    const unsubscribe = shellTheme.subscribe(applyShellTheme);
    onCleanup(unsubscribe);
  } else {
    createEffect(() => {
      setThemeSnapshot(fallbackThemePickerSnapshot());
    });
  }

  const updateDesktopThemeSource = async (source: DesktopThemePickerSnapshot['source']): Promise<DesktopThemePickerSnapshot> => {
    if (shellTheme) {
      const next = await shellTheme.setSource(source);
      setThemeSnapshot(next);
      return next;
    }
    theme.setTheme(source);
    const next = fallbackThemePickerSnapshot();
    setThemeSnapshot(next);
    return next;
  };

  const updateDesktopShellTheme = async (
    mode: DesktopThemePickerSnapshot['resolvedTheme'],
    presetName: string,
  ): Promise<DesktopThemePickerSnapshot> => {
    if (shellTheme) {
      const next = await shellTheme.setShellTheme(mode, presetName);
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

  createEffect(on(() => snapshot().navigation_revision ?? 0, (revision, previous) => {
    if (previous !== undefined && revision <= previous) return;
    navigateWelcomeSurface(snapshot().surface);
    if (snapshot().surface === 'environment_settings' && snapshot().settings_environment_id) {
      openSettingsSurface(snapshot().settings_environment_id);
    }
  }));
  createEffect(() => {
    const opening = settingsSession();
    if (opening && !opening.saving && !snapshot().environments.some(entry => entry.id === opening.environment.id)) {
      cancelSettings();
      showActionToast(i18n().t('environmentCenter.environmentRegistrationUnavailable'), 'error');
    }
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
    const gatewayState = gatewaySetupDialogState();
    const state = connectionState?.connection_kind === 'local_container_runtime' || connectionState?.connection_kind === 'ssh_container_runtime'
      ? connectionState
      : gatewayState?.connection_kind === 'local_container' || gatewayState?.connection_kind === 'ssh_container' ? gatewayState : null;
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
      return runtimeContainerOptionsRequestKey(gatewaySetupDialogState());
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
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    const presentation = launcherActionFailurePresentation(i18n(), failure);
    if (presentation.refresh_snapshot) {
      try {
        await refreshSnapshot();
      } catch (error) {
        if (isCurrent()) setErrorMessage(errorTarget, getErrorMessage(error));
        else showActionToast(getErrorMessage(error), 'error');
        return;
      }
    }
    if (!isCurrent()) { showActionToast(presentation.message || failure.message, 'error'); return; }
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
    const actionState = busyStateForLauncherRequest(request);
    setBusyState(actionState);
    try {
      const result = await props.runtime.launcher.performAction(request);
      if (isDesktopLauncherActionFailure(result)) {
        const presentation = launcherActionFailurePresentation(i18n(), result);
        if (presentation.refresh_snapshot) {
          try {
            await refreshSnapshot();
          } catch (error) {
            showActionToast(getErrorMessage(error), 'error');
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
      setBusyState(current => current.request_started_at_unix_ms === actionState.request_started_at_unix_ms && current.action === actionState.action
        ? IDLE_LAUNCHER_BUSY_STATE : current);
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
    openEnvironmentCenterSurface();
  }

  function openRedevenDashboard(): void {
    void window.redevenDesktopShell?.openDashboard?.();
  }

  function openSettingsSurface(environmentID = snapshot().environments.find(entry => entry.registration_ref?.kind === 'local_environment')?.id ?? ''): void {
    const environment = snapshot().environments.find(entry => entry.id === environmentID);
    if (!environment || (!environment.can_edit && (environment.access_routes?.length ?? 0) < 2 && !environment.default_access_route_missing)) {
      showActionToast(i18n().t('environmentCenter.environmentRegistrationUnavailable'), 'error');
      return;
    }
    setLifecycleProgressFocusRequest(current => current?.canReveal ? null : current);
    resetMessages();
    setConnectionDialogFieldErrors({});
    setNewConnectionState(null);
    setGatewaySetupDialogState(null);
    setControlPlaneDialogState(null);
    settingsController.open(environment, createEnvironmentConnectionDraft(environment));
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
    if (activeSurface() !== 'connect_environment') {
      showConnectEnvironment(message || i18n().t('environmentCenter.addConnectionLauncherPrompt'));
      return;
    }
    settingsController.close();
    setJoinGatewayAfterCreate(false);

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
    if (activeSurface() !== 'connect_environment') {
      showConnectEnvironment(i18n().t('environmentCenter.addGatewayLauncherPrompt'));
      return;
    }
    resetMessages();
    setGatewaySetupRecovery(null);
    setGatewaySetupTechnicalDetail('');
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
          ssh_destination: gateway.ssh_details?.ssh_destination,
          ssh_port: gateway.ssh_details?.ssh_port ? String(gateway.ssh_details.ssh_port) : '',
          auth_mode: gateway.ssh_details?.auth_mode,
          connect_timeout_seconds: gateway.ssh_details?.connect_timeout_seconds ? String(gateway.ssh_details.connect_timeout_seconds) : '',
          bootstrap_strategy: gateway.ssh_details?.bootstrap_strategy,
          release_base_url: gateway.ssh_details?.release_base_url,
          ssh_password_configured: gateway.ssh_password_configured,
          runtime_root: gateway.runtime_root,
          container_engine: gateway.container_engine,
          container_id: gateway.container_id,
          container_ref: gateway.container_ref,
          container_label: gateway.container_label,
          gateway_url: gateway.gateway_url ?? '',
          permissions: gateway.permissions,
          allow_loopback_http: gateway.allow_loopback_http === true,
          focus_section: gatewaySetupFocusForGateway(gateway, focusSection),
        }
      : {}));
  }

  function startEditingEnvironment(environment: DesktopEnvironmentEntry, recovery?: AddressRecoveryTarget): void {
    openSettingsSurface(environment.id);
    if (recovery) {
      settingsController.update({ focus_access: recovery });
      settingsController.selectTab('access');
    }
  }

  function createEnvironmentConnectionDraft(environment: DesktopEnvironmentEntry): ConnectionDialogState {
    const registrationRef = environment.registration_ref;
    if (!environment.can_edit) return null;
    if (!registrationRef || registrationRef.kind === 'local_environment') return null;
    if (registrationRef.kind === 'runtime_target') {
      if (environment.managed_runtime_host_access?.kind === 'wsl_host') return null;
      if (environment.managed_runtime_placement?.kind !== 'container_process' || !environment.managed_runtime_host_access) {
        return createSSHConnectionDialogState('edit', {
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
        });
      }
      const isSSHContainer = environment.managed_runtime_host_access.kind === 'ssh_host';
      return createRuntimeContainerConnectionDialogState('edit', isSSHContainer ? 'ssh_container_runtime' : 'local_container_runtime', {
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
      });
    } else if (registrationRef.kind === 'gateway_environment') {
      return null;
    } else {
      return createExternalURLConnectionDialogState('edit', {
        environment_id: registrationRef.id,
        label: environment.label,
        external_local_ui_url: environment.local_ui_url,
        auto_runtime_probe_enabled: environment.auto_runtime_probe_enabled === true,
      });
    }
  }

  function closeConnectionDialog(): void {
    setConnectionDialogState(null);
    setConnectionDialogError('');
    setConnectionDialogFieldErrors({});
  }

  function closeGatewaySetupDialog(): void {
    setGatewaySetupDialogState(null);
    setGatewaySetupRecovery(null);
    setGatewaySetupTechnicalDetail('');
    setGatewaySetupDialogError('');
    setGatewaySetupDialogFieldErrors({});
  }

  function openCreateControlPlaneDialog(message = ''): void {
    if (activeSurface() !== 'connect_environment') {
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

  function openGatewayMembers(gateway: DesktopGatewaySource): void {
    setMemberGatewayID(gateway.gateway_id);
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
      return createExternalURLConnectionDialogState('create', {
        label,
        auto_runtime_probe_enabled: autoRuntimeProbeEnabled,
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
    if (connectionDialogState()?.mode === 'edit' && connectionDialogState()?.connection_kind === 'ssh_environment') {
      setConnectionDialogFieldErrors((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
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
      if (!(current.mode === 'edit' && current.connection_kind === 'ssh_environment')
        && (name === 'ssh_destination' || name === 'container_label' || name === 'container_id')) {
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

  function updateGatewaySetupDialogField(name: keyof GatewaySetupDialogState, value: string | boolean | GatewayPermissions): void {
    setGatewaySetupDialogState((current) => {
      if (!current) {
        return current;
      }
      const nextValue = typeof value !== 'string' || name === 'ssh_password' ? value : trimString(value);
      let base: GatewaySetupDialogState = {
        ...current,
        ...(name === 'display_name' ? { display_name_touched: true } : {}),
        [name]: nextValue,
      };
      if (isSSHPasswordDraftState(base)) base = reconcileSSHPasswordDraft(base, name);
      if (['connection_kind', 'ssh_destination', 'ssh_port', 'container_engine'].includes(name)) {
        base = { ...base, container_id: '', container_ref: '', container_label: '' };
      }
      if (['gateway_url', 'connection_kind', 'ssh_destination', 'container_label', 'container_ref'].includes(name)) {
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
    setGatewaySetupDialogState(current => current ? { ...current, ssh_password: '', ssh_password_mode: 'clear' } : current);
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
    const openingDraft = connectionDialogState();
    const opening = settingsSession();
    const resultIsCurrent = () => opening ? settingsController.current(opening) : connectionDialogState() === openingDraft;
    const resultErrorTarget = () => (errorTarget === 'dialog' || errorTarget === 'settings') && !resultIsCurrent() ? 'connect' : errorTarget;
    resetMessages();
    const actionState = busyStateForLauncherRequest(request);
    setBusyState(actionState);
    try {
      const result = await props.runtime.launcher.performAction(request);
      if (isDesktopLauncherActionFailure(result)) {
        if ((errorTarget === 'dialog' || errorTarget === 'settings') && !resultIsCurrent()) {
          showActionToast(result.message, 'error');
          return null;
        }
        const requestEnvID = (request as { environment_id?: string }).environment_id?.trim();
        await handleLauncherActionFailure(result, resultErrorTarget(), requestEnvID || undefined, request,
          () => (errorTarget !== 'dialog' && errorTarget !== 'settings') || resultIsCurrent());
        return null;
      }
      if (isDesktopLauncherActionSuccess(result)) {
        return result;
      }
      setErrorMessage(resultErrorTarget(), i18n().t('toast.unexpectedLauncherResult'));
      return null;
    } catch (error) {
      if ((errorTarget === 'dialog' || errorTarget === 'settings') && !resultIsCurrent()) showActionToast(getErrorMessage(error), 'error');
      else setErrorMessage(resultErrorTarget(), getErrorMessage(error));
      return null;
    } finally {
      setBusyState(current => current.request_started_at_unix_ms === actionState.request_started_at_unix_ms && current.action === actionState.action
        ? IDLE_LAUNCHER_BUSY_STATE : current);
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
    if (environment.kind === 'local_environment' || environment.kind === 'wsl_environment') {
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
    setProviderRuntimeLinkProviderEnvironmentID(action === 'disconnect' || target.provider_link_state === 'linked'
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
        i18n().t('providerRecovery.requested', {
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
      && environment.kind !== 'gateway_environment'
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
    if (action.access_route_id && (action.intent === 'open' || action.intent === 'focus')) {
      const route = environment.access_routes?.find(candidate => candidate.id === action.access_route_id);
      const owner = route && snapshot().environments.find(candidate => candidate.id === route.environment_id);
      if (!owner || !route) return false;
      if (owner.kind === 'gateway_environment') return openGatewayEnvironment(owner, errorTarget === 'settings' ? 'connect' : errorTarget,
        environment.id);
      return triggerLocalEnvironmentAction(owner, { ...action, access_route_id: undefined }, errorTarget, attempt, bindOperation);
    }
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
    settingsController.updateDraft(updater);
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
    updateSettingsDraft((current) => applyDesktopAccessModeToDraft(current, mode));
  }

  function applyAccessFixedPort(
    portText: string,
    accessMode?: Exclude<DesktopAccessMode, 'custom_exposure'>,
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

  async function restartFromSettings(environmentID: string, returnTo: 'access' | 'two_factor', foreground: boolean): Promise<void> {
    const environment = snapshot().environments.find(entry => entry.id === environmentID);
    if (!environment) {
      showActionToast(i18n().t('environmentCenter.environmentRegistrationUnavailable'), 'error');
      return;
    }
    const attempt = createEnvironmentLifecycleAttempt(environment.id, 'restart_runtime');
    const request = runtimeActionRequest(environment, 'restart_environment_runtime', { attempt });
    if (!request) {
      showActionToast(i18n().t('environmentCenter.resolveRuntimeTargetError'), 'error');
      return;
    }
    const [submissionError, setSubmissionError] = createSignal('');
    let visible = false;
    const following = () => visible && activeCenterTab() === 'environments' && !settingsSession();
    const source: EnvironmentSettingsRestartSource = {
      returnTo, submissionError,
      visibilityChanged: value => { visible = value; },
      returnToSettings: () => {
        openSettingsSurface(environment.id);
        settingsController.update({ focus_two_factor: returnTo === 'two_factor' });
        settingsController.selectTab('access');
      },
      retry: () => { void restartFromSettings(environment.id, returnTo, true); },
    };
    let focusRequestID = 0;
    if (foreground) {
      setActiveCenterTab('environments');
      if (!libraryGroups().some(group => group.member_ids.includes(environment.id))) {
        setLibraryQuery('');
        setLibrarySourceFilter('');
      }
      focusRequestID = ++lifecycleProgressFocusRequestSequence;
      setLifecycleProgressFocusRequest({ request_id: focusRequestID, ...attempt,
        subject_kind: 'environment', subject_id: environment.id, intent: 'restart_runtime', settingsRestart: source,
        canReveal: () => activeCenterTab() === 'environments' && !settingsPresent() && !settingsSession(),
      });
    }
    const result = await performLauncherActionSilently(request);
    const willReveal = () => lifecycleProgressFocusRequest()?.request_id === focusRequestID
      && activeCenterTab() === 'environments' && !settingsSession();
    if (!result.ok && result.code === 'runtime_lifecycle_in_progress' && result.operation_key) {
      // Admission identifies the existing owner. A rejected restart never inherits its outcome.
      setSubmissionError(i18n().t('settings.restartNotApplied'));
      if (following() || willReveal()) {
        const operation = activeActionProgress().find(progress => progress.operation_key === result.operation_key);
        setLifecycleProgressFocusRequest({ request_id: ++lifecycleProgressFocusRequestSequence,
          operation_key: result.operation_key, started_at_unix_ms: operation?.started_at_unix_ms,
          subject_kind: 'environment', subject_id: environment.id,
          canReveal: () => activeCenterTab() === 'environments' && !settingsPresent() && !settingsSession(),
        });
      }
      showActionToast(i18n().t('settings.restartDeferred', { label: environment.label }), 'info');
      return;
    }
    if (!result.ok) setSubmissionError(result.message);
    else if (result.outcome !== 'restarted_environment_runtime') setSubmissionError(i18n().t('toast.unexpectedLauncherResult'));
    await refreshSnapshot().catch(error => {
      if (!following() && !willReveal()) showActionToast(getErrorMessage(error), 'error');
    });
    if (!following() && !willReveal()) {
      showActionToast(submissionError()
        ? `${i18n().t('settings.restartFailedNamed', { label: environment.label })}\n\n${submissionError()}`
        : i18n().t('environmentCenter.runtimeRestartedToast', { label: environment.label }), submissionError() ? 'error' : 'success');
    }
  }

  async function saveSettings(options: Readonly<{ restartRuntime?: boolean; continueTwoFactor?: boolean }> = {}): Promise<void> {
    const opening = settingsSession();
    if (!opening?.access || opening.saving) return;
    const environment = selectedSettingsEnvironmentEntry()!;
    if (options.restartRuntime && (environment.runtime_operations.restart.availability !== 'available' || connectionSettingsDirty())) return;
    setSettingsError('');
    if (!await settingsController.saveAccess(options.restartRuntime ? 'restart' : 'save')) return;
    if (options.restartRuntime) {
      const foreground = settingsController.current(opening);
      if (foreground) cancelSettings();
      await restartFromSettings(environment.id, options.continueTwoFactor ? 'two_factor' : 'access', foreground);
    } else {
      showActionToast(i18n().t('toast.settingsSaved'));
      void refreshSnapshot();
    }
  }

  function cancelSettings(): void {
    settingsController.close();

    setSettingsError('');
    setConnectionDialogError('');
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
  ): Promise<string | false> {
    const normalizedTargetURL = trimString(request.external_local_ui_url);
    if (!normalizedTargetURL) {
      setErrorMessage(request.errorTarget, i18n().t('connectionDialog.validationEnvironmentUrlRequired'));
      return false;
    }

    setConnectionDialogError('');
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
      if (!result.environment_id) throw new Error(i18n().t('toast.unexpectedLauncherResult'));
      return result.environment_id;
    } catch (error) {
      showActionToast(getErrorMessage(error), 'error');
      return false;
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
  ): Promise<string | false> {
    setConnectionDialogError('');
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
      if (!result.environment_id) throw new Error(i18n().t('toast.unexpectedLauncherResult'));
      return result.environment_id;
    } catch (error) {
      showActionToast(getErrorMessage(error), 'error');
      return false;
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
  ): Promise<string | false> {
    setConnectionDialogError('');
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
      if (!result.environment_id) throw new Error(i18n().t('toast.unexpectedLauncherResult'));
      return result.environment_id;
    } catch (error) {
      showActionToast(getErrorMessage(error), 'error');
      return false;
    }
  }

  function gatewayActionRecovery(gatewayID: string, failure: SilentLauncherActionFailure): GatewayActionRecovery {
    const continuation = failure.raw_failure?.continuation_action;
    return { gateway_id: gatewayID, message: failure.message,
      ...(continuation?.kind === 'start_gateway' && continuation.gateway_id === gatewayID ? { start_action: continuation } : {}) };
  }

  function gatewaySetupPermissionsToAuthorize(state: GatewaySetupDialogState): GatewayPermissions | undefined {
    const previous = snapshot().gateway_sources.find(source => source.gateway_id === state.gateway_id)?.permissions
      ?? { access: true, manage_members: false, configure_cloud: false };
    const changed = (['access', 'manage_members', 'configure_cloud'] as const)
      .some(key => state.permissions[key] !== previous[key]);
    return changed || trimString(state.pairing_code) ? state.permissions : undefined;
  }

  function validateGatewaySetupDialogFields(state: GatewaySetupDialogState): Partial<Record<string, string>> {
    const errors: Partial<Record<string, string>> = {};
    if (state.connection_kind === 'ssh_host' || state.connection_kind === 'ssh_container') {
      if (!trimString(state.ssh_destination)) errors.ssh_destination = i18n().t('connectionDialog.validationSshDestinationRequired');
      const port = Number(state.ssh_port);
      if (state.ssh_port && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        errors.ssh_port = i18n().t('connectionDialog.validationPortRange');
      }
    }
    if (state.connection_kind.includes('container') && !trimString(state.container_id)) {
      errors.container_id = i18n().t('connectionDialog.validationChooseContainer');
    }
    if (!trimString(state.display_name) && !suggestGatewayDisplayName(state)) {
      errors.display_name = i18n().t('connectionDialog.validationGatewayNameRequired');
    }
    if (state.connection_kind === 'url' && !trimString(state.gateway_url)) {
      errors.gateway_url = i18n().t('connectionDialog.validationGatewayUrlRequired');
    }
    if (state.connection_kind === 'url' && gatewaySetupPermissionsToAuthorize(state) && !trimString(state.pairing_code)) {
      errors.pairing_code = i18n().t('connectionDialog.gatewayPairingCodeHelp');
    }
    return errors;
  }

  async function saveGatewayFromDialog(): Promise<void> {
    const state = gatewaySetupDialogState();
    if (!state || busyState().action !== IDLE_LAUNCHER_BUSY_STATE.action) {
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
    const action: DesktopLauncherActionRequest = state.connection_kind === 'url' ? {
      ...base, connection_kind: 'url', gateway_url: trimString(state.gateway_url),
      pairing_code: trimString(state.pairing_code) || undefined, permissions: gatewaySetupPermissionsToAuthorize(state),
      allow_loopback_http: state.allow_loopback_http,
    } : {
      ...base, connection_kind: state.connection_kind, permissions: gatewaySetupPermissionsToAuthorize(state),
      host_access: state.connection_kind.startsWith('ssh_') ? {
        kind: 'ssh_host', ssh: {
          ssh_destination: state.ssh_destination, ssh_port: state.ssh_port ? Number(state.ssh_port) : null,
          auth_mode: state.auth_mode, connect_timeout_seconds: Number(state.connect_timeout_seconds) || DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
        },
      } : { kind: 'local_host' },
      placement: state.connection_kind.includes('container') ? {
        kind: 'container_process', runtime_root: state.runtime_root || DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        container_engine: state.container_engine, container_id: state.container_id,
        container_ref: state.container_ref, container_label: state.container_label, bridge_strategy: 'exec_stream',
      } : {
        kind: 'host_process', runtime_root: state.runtime_root || DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        bootstrap_strategy: state.bootstrap_strategy, release_base_url: trimString(state.release_base_url),
      },
      ssh_password: state.ssh_password, ssh_password_mode: state.ssh_password_mode,
    };
    setGatewaySetupRecovery(null);
    setGatewaySetupDialogError('');
    setGatewaySetupTechnicalDetail('');
    const current = () => gatewaySetupDialogState()?.opening_id === state.opening_id;
    const result = await performLauncherActionSilently(action);
    if (!current()) return;
    if (!result.ok) {
      setGatewaySetupDialogError(result.message);
      setGatewaySetupTechnicalDetail(gatewaySetupFailureDetail(result));
      const gatewayID = result.raw_failure?.gateway_id;
      if (gatewayID) {
        setGatewaySetupRecovery(gatewayActionRecovery(gatewayID, result));
        setGatewaySetupDialogState(draft => draft ? { ...draft, gateway_id: gatewayID, mode: 'edit' } : draft);
      }
      return;
    }
    if (result.outcome === 'saved_gateway') {
      closeGatewaySetupDialog();
      showActionToast(i18n().t('toast.gatewaySaved'));
      await refreshSnapshot().catch(error => showActionToast(getErrorMessage(error), 'error'));
    } else {
      setGatewaySetupDialogError(i18n().t('toast.unexpectedLauncherResult'));
    }
  }

  async function startGatewayForSetup(): Promise<void> {
    const recovery = gatewaySetupRecovery();
    const opening = gatewaySetupDialogState()?.opening_id;
    if (!recovery?.start_action || busyState().action !== IDLE_LAUNCHER_BUSY_STATE.action) return;
    const result = await performLauncherActionSilently(recovery.start_action);
    if (gatewaySetupDialogState()?.opening_id !== opening || gatewaySetupRecovery() !== recovery) return;
    setGatewaySetupDialogError('');
    setGatewaySetupTechnicalDetail(result.ok ? '' : gatewaySetupFailureDetail(result));
    setGatewaySetupRecovery(result.ok && result.outcome === 'started_gateway'
      ? { gateway_id: recovery.gateway_id, message: i18n().t('gatewayAccess.serviceReady') }
      : { ...recovery, message: result.ok ? i18n().t('toast.unexpectedLauncherResult') : result.message });
    await refreshSnapshot().catch(error => showActionToast(getErrorMessage(error), 'error'));
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
    presentationEnvironmentID?: string,
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
      environment_id: presentationEnvironmentID ?? environment.access_group_id ?? environment.id,
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

  function connectionSettingsDirty(): boolean {
    const session = settingsSession();
    return !!session && (session.metadata_label !== session.environment.label
      || JSON.stringify(session.connection) !== JSON.stringify(session.connection_baseline));
  }
  function connectionSaveBlocked(): boolean {
    const session = settingsSession();
    if (!session?.access?.dirty || !session.connection || !session.connection_baseline) return false;
    const fields = ['ssh_destination', 'ssh_port', 'runtime_root', 'container_engine', 'container_id'] as const;
    return fields.some(key => Reflect.get(session.connection!, key) !== Reflect.get(session.connection_baseline!, key));
  }
  function settingsAccessErrorMessage(error = settingsPresentation()?.access_error): string {
    if (error?.code === 'SECURITY_POLICY_ACTIVE') return i18n().t('security.accessPolicyActive');
    if (error?.status_code === 401 || error?.status_code === 403) return i18n().t('settings.accessAuthorizationFailed');
    if (error?.code === 'SETTINGS_RUNTIME_PREPARING') return i18n().t('environmentStatus.runtimePreparing');
    if (error?.code === 'SETTINGS_RUNTIME_INCOMPATIBLE') return i18n().t('environmentStatus.runtimeNeedsUpdate');
    if (error?.code === 'SETTINGS_WSL_STOPPED') return i18n().t('settings.wslStopped');
    return error?.failure ? localizedOperationFailureSummary(i18n(), error.failure) : error?.error ?? '';
  }
  function settingsAccessDiagnostic(): string {
    const error = settingsPresentation()?.access_error;
    return error?.failure ? formatDesktopOperationFailureForClipboard(error.failure)
      : [error?.code, error?.error].filter(Boolean).join(': ');
  }
  function wslSettingsFacts(): { distribution: string; user: string; root: string } {
    const environment = settingsPresentation()?.environment;
    const host = environment?.managed_runtime_host_access;
    return { distribution: host?.kind === 'wsl_host' ? host.distribution_name : '',
      user: host?.kind === 'wsl_host' ? host.linux_user : '',
      root: environment?.managed_runtime_placement?.runtime_root ?? '' };
  }
  async function saveWSLSettingsLabel(): Promise<void> {
    const opening = settingsSession();
    const environment = opening?.environment;
    if (!opening || opening.saving || environment?.registration_ref?.kind !== 'runtime_target'
      || !environment.managed_runtime_host_access || !environment.managed_runtime_placement) return;
    settingsController.update({ saving: 'connection' });
    const result = await performLauncherAction({ kind: 'upsert_environment_registration', registration: {
      registration_ref: environment.registration_ref, label: opening.metadata_label.trim(),
      host_access: environment.managed_runtime_host_access, placement: environment.managed_runtime_placement,
      auto_runtime_probe_enabled: true,
    } }, 'dialog');
    if (!settingsController.current(opening)) return;
    settingsController.update({ saving: null });
    if (result?.ok) {
      await refreshSnapshot();
      if (settingsController.current(opening)) settingsController.savedConnection(
        snapshot().environments.find(entry => entry.id === environment.id) ?? environment, null);
    }
  }

  async function saveDefaultAccessRoute(environmentID: string, routeID: string): Promise<boolean> {
    const result = await performLauncherAction({ kind: 'set_environment_access_route', environment_id: environmentID, route_id: routeID }, 'dialog');
    if (!result) return false;
    await refreshSnapshot();
    const environment = snapshot().environments.find(entry => entry.id === environmentID);
    if (environment && settingsSession()?.environment.id === environmentID) settingsController.update({ environment });
    return true;
  }
  const accessSettings = () => <Show when={settingsPresentation()?.environment}>{environment => (
    <EnvironmentAccessSettings environment={snapshot().environments.find(entry => entry.id === environment().id) ?? environment()} i18n={i18n()} save={saveDefaultAccessRoute} />
  )}</Show>;

  async function saveConnectionFromDialog(): Promise<void> {
    const state = connectionDialogState();
    if (!state) {
      return;
    }
    const errors = state.connection_kind === 'ssh_environment'
      ? validateSSHEnvironmentSettings(state, i18n())
      : validateConnectionDialogFields(state);
    setConnectionDialogFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setConnectionDialogFieldErrors({});
    const opening = settingsSession();
    if (opening?.saving || connectionSaveBlocked()) return;
    if (opening) settingsController.update({ saving: 'connection' });
    let saved: string | false = false;
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
    }
    if (opening && settingsController.current(opening)) {
      if (saved) {
        const environment = snapshot().environments.find(entry => entry.id === saved);
        if (environment) settingsController.savedConnection(environment, createEnvironmentConnectionDraft(environment));
        else cancelSettings();
      } else settingsController.update({ saving: null });
    } else if (!opening && saved && connectionDialogState() === state) {
      if (joinGatewayAfterCreate() && state.connection_kind !== 'external_local_ui') setGatewaySetupEnvironmentID(saved);
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

  async function openConnectionInBrowser(url: string): Promise<void> {
    try {
      const result = await window.redevenDesktopShell?.openExternalURL?.(url);
      if (!result?.ok) showActionToast(result?.message || i18n().t('toast.actionFailedFallback'), 'error');
    } catch (error) { showActionToast(getErrorMessage(error), 'error'); }
  }

  async function copyEnvironmentValue(value: string, copyLabel: string): Promise<void> {
    await copyToClipboard(value);
    const messageLabel = trimString(copyLabel);
    showActionToast(messageLabel ? i18n().t('toast.valueCopied', { label: messageLabel }) : i18n().t('environmentCenter.copiedToClipboard'));
  }

  async function deleteEnvironment(): Promise<void> {
    const target = deleteTarget();
    if (!target || (target.registration_ref?.kind === 'gateway_environment' && busyState().action !== IDLE_LAUNCHER_BUSY_STATE.action)) {
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
      if (registrationRef.kind === 'gateway_environment') return;
      deleteResult = await props.runtime.launcher.performAction({ kind: 'delete_environment_registration', registration_ref: registrationRef, ...(deleteNeedsReplacement() ? { replacement_route_id: deleteReplacement() } : {}) });
      if (!deleteResult || !deleteResult.ok || deleteResult.outcome !== 'deleted_environment') {
        throw new Error(deleteResult && !deleteResult.ok ? deleteResult.message : i18n().t('environmentCenter.environmentRegistrationUnavailable'));
      }
      await refreshSnapshot();
      // A deleted row cannot receive the dialog's normal focus return.
      setDeleteTarget(null);

      showActionToast(
        removedDefaultWSLEnvironment
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

  async function signOutControlPlane(): Promise<void> {
    const target = signOutControlPlaneTarget();
    if (!target) {
      return;
    }
    const result = await performLauncherAction({
      kind: 'sign_out_control_plane',
      provider_origin: target.provider.provider_origin,
      provider_id: target.provider.provider_id,
    });
    if (result?.outcome === 'signed_out_control_plane') {
      setSignOutControlPlaneTarget(null);
      showActionToast(i18n().t('environmentCenter.cloudSignedOut'));
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

  function navigateWelcomeSurface(surface: DesktopLauncherSurface): void {
    const focused = document.activeElement;
    setActiveSurface(surface);
    if (focused instanceof HTMLElement && (!focused.isConnected || focused.closest('[inert]'))) {
      document.querySelector<HTMLButtonElement>(surface === 'flower'
        ? '.redeven-flower-back-button' : '.redeven-flower-topbar-button')?.focus({ preventScroll: true });
    }
  }

  async function recoverFlowerRuntime(code: 'runtime_update_required' | 'desktop_update_required'): Promise<void> {
    const environment = flowerRuntimeEnvironment();
    if (!environment) return;
    await triggerLocalEnvironmentAction(environment, { intent: code === 'desktop_update_required' ? 'update_desktop' : 'update_runtime', label: '', enabled: true, variant: 'default' });
    await refreshSnapshot();
  }

  function openFlowerSurface(): void {
    navigateWelcomeSurface('flower');
  }

  function buildEnvironmentFlowerTurnLauncherIntent(environment: DesktopEnvironmentEntry): EnvironmentFlowerTurnLauncherIntent {
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
    const blocker = runtimeFlowerBlocker(environmentRuntimeServiceSnapshot(flowerRuntimeEnvironment()));
    if (blocker && blocker.code !== 'runtime_not_ready') {
      void openFlowerSurface();
      return;
    }
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
    closeFlowerTurnLauncher();
    openFlowerConversation(threadID);
  }

  function openFlowerConversation(threadID: string): void {
    flowerFocusThreadRequestSequence += 1;
    setFlowerFocusThreadRequest({
      request_id: `welcome-flower-focus-${flowerFocusThreadRequestSequence}`,
      thread_id: threadID,
    });
    openFlowerSurface();
  }

  function openEnvironmentCenterSurface(): void {
    navigateWelcomeSurface('connect_environment');
  }

  const topBarLogoLabel = () => (
    !environmentsVisible()
      ? i18n().t('shell.backToEnvironments')
      : i18n().t('shell.openRedevenDashboard')
  );
  const activateTopBarLogo = () => {
    if (!environmentsVisible()) {
      void openEnvironmentCenterSurface();
      return;
    }
    openRedevenDashboard();
  };

  const connectionFormProps: ConnectionDialogProps = {
    get joinGateway() { return joinGatewayAfterCreate(); }, setJoinGateway: setJoinGatewayAfterCreate,
    get i18n() { return i18n(); },
    get nativeContainerRuntime() { return snapshot().platform_capabilities.native_container_runtime; },
    get state() { return connectionDialogState(); },
    get sshConfigHosts() { return sshConfigHosts(); }, get sshConfigHostsLoading() { return sshConfigHostsLoading(); },
    get sshConfigHostsLoadError() { return sshConfigHostsLoadError(); },
    get containerOptions() { return runtimeContainerOptions(); }, get containerOptionsLoading() { return runtimeContainerOptionsLoading(); },
    get containerOptionsError() { return runtimeContainerOptionsError(); },
    get error() { return connectionDialogError(); }, get fieldErrors() { return connectionDialogFieldErrors(); },
    get busyState() { return busyState(); },
    onOpenChange(open) { if (!open) { if (settingsSession()) cancelSettings(); else closeConnectionDialog(); } },
    updateField: updateConnectionDialogField, toggleAutoRuntimeProbe: toggleConnectionRuntimeAutoProbe,
    refreshContainerOptions() { void refreshRuntimeContainerOptions(true); }, refreshSSHConfigHosts() { void refreshSSHConfigHosts(); },
    switchKind: switchConnectionDialogKind, switchBootstrapStrategy: switchSSHBootstrapStrategy,
    removeSSHPassword: removeSSHPasswordFromConnectionDialog, clearFieldErrors() { setConnectionDialogFieldErrors({}); },
    onSave: saveConnectionFromDialog,

  };

  return (
    <>
      <RuntimeGatewaySetupDialog environment={snapshot().environments.find(environment => environment.id === gatewaySetupEnvironmentID())}
        gateways={snapshot().gateway_sources} i18n={i18n()} close={() => {
          const id = gatewaySetupEnvironmentID(); setGatewaySetupEnvironmentID('');
          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-owner-id="${CSS.escape(id)}"]`)?.focus());
        }}
        start={async environment => { const started = await startEnvironmentRuntime(environment, 'dialog'); await refreshSnapshot(); return started; }} />
      <GatewayMembersDialog gateway={snapshot().gateway_sources.find(gateway => gateway.gateway_id === memberGatewayID())}
        i18n={i18n()} targets={snapshot().environments.flatMap(entry => entry.provider_runtime_link_target ? [entry.provider_runtime_link_target] : [])} onClose={() => setMemberGatewayID('')} refresh={refreshSnapshot}
        focusOwner={gatewayID => document.querySelector<HTMLElement>(`[data-gateway-id="${CSS.escape(gatewayID)}"] [aria-haspopup="menu"]`)?.focus()} />
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
            <Show when={!environmentsVisible()}>
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
            <Show when={!flowerVisible()}>
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
            <Show when={!tessivenVisible()}><button type="button" class="redeven-flower-topbar-button" aria-label="Tessiven" title="Tessiven" onClick={() => navigateWelcomeSurface('tessiven')}><TessivenIcon kind="tessiven"/></button></Show>
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
            <span class="redeven-desktop-update-button__indicator" aria-hidden="true" style={{ visibility: desktopUpdateSnapshot().state === 'available' || desktopUpdateSnapshot().state === 'ready' ? 'visible' : 'hidden' }} />
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
        <Show when={environmentsVisited()}>
          <div class="h-full min-h-0" style={{ display: environmentsVisible() ? undefined : 'none' }}
            data-desktop-page="environments" aria-hidden={!environmentsVisible() ? 'true' : undefined} inert={!environmentsVisible()}>
            <ConnectEnvironmentSurface
              i18n={i18n()}
              visible={environmentsVisible()}
              snapshot={snapshot()}
              busyState={busyState()}
              actionProgress={activeActionProgress()}
              activeTab={activeCenterTab()}
              setActiveTab={setActiveCenterTab}
              librarySourceFilter={librarySourceFilter()}
              libraryQuery={libraryQuery()}
              libraryGroups={libraryGroups()}
              allLibraryGroups={allLibraryGroups()}
              cloudQuery={cloudQuery()} setCloudQuery={setCloudQuery}
              focusedCloudSource={focusedCloudSource()}
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
              openGatewayMembers={openGatewayMembers}
              openCreateControlPlaneDialog={openCreateControlPlaneDialog}
              refreshAllEnvironmentRuntimes={refreshAllEnvironmentRuntimes}
              refreshWSLDiscovery={refreshWSLDiscovery}
              registerWSLDistribution={registerWSLDistribution}
              setDefaultWSLEnvironment={setDefaultWSLEnvironment}
              openRemoteEnvironment={openRemoteEnvironment}
              openSSHEnvironment={openSSHEnvironment}
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
              openInBrowser={openConnectionInBrowser}
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
              reconnectControlPlane={reconnectControlPlane}
              refreshControlPlane={refreshControlPlane}
              signOutControlPlane={setSignOutControlPlaneTarget}
              deleteGateway={setDeleteGatewayTarget}
            />
          </div>
        </Show>
        <Show when={tessivenVisited()}><div class="h-full min-h-0" style={{ display: tessivenVisible() ? undefined : 'none' }} data-desktop-page="tessiven" aria-hidden={!tessivenVisible() ? 'true' : undefined} inert={!tessivenVisible()}>
          <TessivenPage locale={languageSnapshot().resolved_locale} openRequest={tessivenOpenRequest()} transport={tessivenTransport} t={(key, values) => tessivenCopy()(key, values)} visible={tessivenVisible()} canWrite
            renderFlower={surface => {
              const adapter = createLocalEnvironmentFlowerSurfaceAdapter(props.runtime.settings, {
                get runtimeDisplayName() { return i18n().t('flowerSurface.runtime.localEnvironment'); },
                get runtimeSubtitle() { return i18n().t('flowerSurface.runtime.subtitle'); },
                onSettingsChanged: refreshSnapshot,
              });
              return <DesktopFlowerRuntimeBoundary embedded
                snapshot={environmentRuntimeServiceSnapshot(flowerRuntimeEnvironment())} i18n={i18n()}
                onBack={() => void openEnvironmentCenterSurface()}
                onRecover={recoverFlowerRuntime}>
                <FlowerSurface adapter={adapter} draftCoordinator={flowerDraftCoordinator} presentation="companion"
                engaged={surface.engaged} transcriptVisible={surface.transcriptVisible}
                embeddedConversation={surface.embeddedConversation} copy={flowerSurfaceCopy()}
                filesystemScopeKey={flowerFilesystemScopeKey()}
                notify={notice => showActionToast(notice.message, notice.tone, notice.title ? { title: notice.title } : {})} />
              </DesktopFlowerRuntimeBoundary>;
            }}
            onOpenFlower={openFlowerConversation}
            onOpenService={async () => { throw new Error(tessivenCopy()('openUnavailable')); }}/>
        </div></Show>
        <Show when={flowerVisited()}>
          <div class="h-full min-h-0" style={{ display: flowerVisible() ? undefined : 'none' }}
            data-desktop-page="flower" aria-hidden={!flowerVisible() ? 'true' : undefined} inert={!flowerVisible()}>
            <Show keyed when={flowerRuntimeEnvironment()?.id || 'default'}>
              {(environmentID) => {
                const adapter = createLocalEnvironmentFlowerSurfaceAdapter(props.runtime.settings, {
                  runtimeEnvironmentID: environmentID === 'default' ? undefined : environmentID,
                  get runtimeDisplayName() { return i18n().t('flowerSurface.runtime.localEnvironment'); },
                  get runtimeSubtitle() { return i18n().t('flowerSurface.runtime.subtitle'); },
                  onSettingsChanged: refreshSnapshot,
                });
                return (
                  <DesktopFlowerRuntimeBoundary
                    snapshot={environmentRuntimeServiceSnapshot(flowerRuntimeEnvironment())}
                    i18n={i18n()}
                    onBack={() => void openEnvironmentCenterSurface()}
                    onRecover={recoverFlowerRuntime}
                  >
                    <FlowerSurface
                      engaged={flowerVisible()}
                      transcriptVisible={flowerVisible()}
                      draftCoordinator={flowerDraftCoordinator}
                      filesystemScopeKey={flowerFilesystemScopeKey()}
                      adapter={adapter}
                      notify={(notice) => {
                        showActionToast(notice.message, notice.tone, {
                          ...(notice.title ? { title: notice.title } : {}),
                        });
                      }}
                      copy={flowerSurfaceCopy()}
                      warmup={flowerWarmupState()}
                      settingsFocusRequest={snapshot().flower_settings_focus_revision}
                      focusThreadRequest={flowerVisible() ? flowerFocusThreadRequest() : null}
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
                  </DesktopFlowerRuntimeBoundary>
                );
              }}
            </Show>
          </div>
        </Show>
      </DesktopLauncherShell>

      <FlowerTurnLauncherWindow
        open={flowerTurnLauncherOpen()}
        intent={flowerTurnLauncherIntent()}
        anchor={flowerTurnLauncherAnchor()}
        viewportInsets={flowerTurnLauncherViewportInsets()}
        copy={{
          window_title: i18n().t('environmentCenter.askFlowerCardTitle'),
          linked_context_label: i18n().t('environmentCenter.askFlowerCardContextLabel'),
          remove_reference: (path) => i18n().t('flowerSurface.chat.composerReferenceRemove', { path }),
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

      <EnvironmentSettingsDialog open={Boolean(settingsSession())} environment={settingsSession()?.environment ?? null}
        tab={settingsPresentation()?.tab ?? 'connection'} i18n={i18n()} onClose={cancelSettings}
        onPresenceChange={setSettingsPresent}
        onTabChange={settingsController.selectTab}
        connection={(
          <Show when={settingsPresentation()?.token} keyed>{(_token) => (
            <Show when={settingsPresentation()?.connection} fallback={(
              <EnvironmentSettingsPanel footer={<>
                <Button variant="ghost" onClick={cancelSettings}>{i18n().t('common.close')}</Button>
                <Show when={connectionSettingsDirty()}><Button variant="ghost" disabled={Boolean(settingsSession()?.saving)} onClick={settingsController.resetConnection}>{i18n().t('settings.discardConnectionChanges')}</Button></Show>
                <Show when={settingsPresentation()?.environment.managed_runtime_host_access?.kind === 'wsl_host'}>
                  <Button disabled={!settingsSession() || Boolean(settingsSession()?.saving) || !settingsSession()?.metadata_label.trim()
                    || settingsSession()?.metadata_label === settingsSession()?.environment.label} onClick={() => void saveWSLSettingsLabel()}>
                    {i18n().t('sshSettings.saveChanges')}
                  </Button>
                </Show>
              </>}>
                {accessSettings()}
                <Show when={connectionDialogError()}><p role="alert" class="text-xs text-destructive">{connectionDialogError()}</p></Show>
                <Show when={settingsPresentation()?.environment.kind === 'gateway_environment'}>
                  <p class="text-[length:var(--floe-type-body)] text-muted-foreground">{i18n().t('gatewayMembers.permissionBoundary')}</p>
                </Show>
                <Show when={settingsPresentation()?.environment.registration_ref?.kind !== 'local_environment' && settingsPresentation()?.environment.kind !== 'gateway_environment'}>
                <Show when={settingsPresentation()?.environment.managed_runtime_host_access?.kind === 'wsl_host'} fallback={(
                  <div class="space-y-4">
                    <p class="text-[length:var(--floe-type-body)] text-muted-foreground">{i18n().t('settings.cloudManaged')}</p>
                    <p class="select-text break-all font-mono text-xs">{settingsPresentation()?.environment.provider_origin}</p>
                    <Button onClick={() => { const url = settingsPresentation()?.environment.provider_origin; if (url) void openConnectionInBrowser(url); }}>
                      {i18n().t('settings.manageCloud')}
                    </Button>
                  </div>
                )}>
                  <div class="environment-connection-form">
                    <div class="environment-connection-field environment-connection-group">
                    <label class="block text-[length:var(--floe-type-control)] leading-[var(--floe-line-control)]" for="wsl-settings-name">{i18n().t('connectionDialog.name')}</label>
                    <Input id="wsl-settings-name" disabled={Boolean(settingsSession()?.saving)} value={settingsPresentation()?.metadata_label ?? ''}
                      onInput={event => settingsController.update({ metadata_label: event.currentTarget.value })} />
                    </div>
                    <dl class="environment-connection-group environment-connection-facts">
                      <div><dt>{i18n().t('environmentConnection.wsl')}</dt><dd>{wslSettingsFacts().distribution}</dd></div>
                      <div><dt>{i18n().t('settings.linuxUser')}</dt><dd>{wslSettingsFacts().user}</dd></div>
                      <div><dt>{i18n().t('connectionDialog.runtimeRoot')}</dt><dd><code>{wslSettingsFacts().root}</code></dd></div>
                    </dl>
                    <Show when={connectionDialogError()}><p role="alert" class="text-xs text-destructive">{connectionDialogError()}</p></Show>

                  </div>
                </Show>
                </Show>
              </EnvironmentSettingsPanel>
            )}>
              <div class="environment-settings-panel" inert={!settingsSession()}>
                <Show when={connectionSettingsDirty()}><div class="px-5 pt-3"><Button size="sm" variant="ghost" disabled={Boolean(settingsSession()?.saving)} onClick={() => { settingsController.resetConnection(); setConnectionDialogFieldErrors({}); setConnectionDialogError(''); }}>{i18n().t('settings.discardConnectionChanges')}</Button></div></Show>
                <Show when={connectionSaveBlocked()}><p role="status" class="px-5 pt-3 text-xs text-warning">{i18n().t('settings.resolveAccessDraft')}</p></Show>
                <Show when={settingsPresentation()?.connection?.connection_kind === 'ssh_environment'} fallback={
                  <ConnectionDialogForm {...connectionFormProps} beforeFields={accessSettings()} state={settingsPresentation()?.connection ?? null}
                    saveBlocked={connectionSaveBlocked() || !connectionSettingsDirty() || Boolean(settingsSession()?.saving)} />
                }>
                  <SSHEnvironmentSettingsForm beforeFields={accessSettings()} open={Boolean(settingsSession())} i18n={i18n()}
                    state={settingsPresentation()!.connection as SSHConnectionDialogState}
                    baseline={settingsPresentation()!.connection_baseline as SSHConnectionDialogState}
                    sshConfigHosts={sshConfigHosts()} sshConfigHostsLoading={sshConfigHostsLoading()}
                    sshConfigHostsLoadError={sshConfigHostsLoadError()} fieldErrors={connectionDialogFieldErrors()}
                    error={connectionDialogError()} saving={Boolean(settingsSession()?.saving)} saveBlocked={connectionSaveBlocked()}
                    updateField={updateConnectionDialogField} toggleAutoRuntimeProbe={toggleConnectionRuntimeAutoProbe}
                    switchBootstrapStrategy={switchSSHBootstrapStrategy} removeSSHPassword={removeSSHPasswordFromConnectionDialog}
                    refreshSSHConfigHosts={() => { void refreshSSHConfigHosts(); }} onClose={cancelSettings} onSave={saveConnectionFromDialog} />
                </Show>
              </div>
            </Show>
          )}</Show>
        )}
        access={(
          <Show when={settingsPresentation()?.token} keyed>{(dialogToken) => {
            const environmentID = settingsPresentation()!.environment.id;
            return <Show when={Boolean(settingsPresentation()?.access)} fallback={(
              <EnvironmentSettingsPanel footer={<Button variant="ghost" onClick={cancelSettings}>{i18n().t('common.close')}</Button>}>
                <div class="space-y-4" role={settingsPresentation()?.access_state === 'error' ? 'alert' : 'status'}>
                  <p class="text-[length:var(--floe-type-body)]">{i18n().t(settingsPresentation()?.access_state === 'loading' ? 'settings.loadingAccess' : 'settings.loadAccessFailed')}</p>
                  <Show when={settingsPresentation()?.access_error}>
                    <p class="select-text break-words text-xs text-muted-foreground">{settingsAccessErrorMessage()}</p>
                    <div class="flex gap-2">
                      <Button onClick={() => void settingsController.loadAccess()}>{i18n().t('common.retry')}</Button>
                      <Button variant="ghost" onClick={() => void copyEnvironmentValue(settingsAccessDiagnostic(), i18n().t('settings.loadAccessFailed'))}>{i18n().t('common.copy')}</Button>
                      <Show when={settingsPresentation()?.access_error?.code === 'SETTINGS_WSL_STOPPED'}>
                        <Button onClick={async () => { const opening = settingsSession(); if (!opening) return; await startEnvironmentRuntime(opening.environment, 'settings'); if (settingsController.current(opening)) await settingsController.loadAccess(); }}>{i18n().t('settings.startEnvironment')}</Button>
                      </Show>
                    </div>
                  </Show>
                </div>
              </EnvironmentSettingsPanel>
            )}>
      <EnvironmentAccessSettingsForm
        security={window.redevenDesktopSettings?.security ? async request => {
          const opening = settingsSession();
          const result = await window.redevenDesktopSettings!.security!({ ...request, environment_id: environmentID, dialog_token: dialogToken });
          if (opening && settingsController.current(opening) && request.action === 'commit') await settingsController.loadAccess();
          return result;
        } : undefined}
        open={Boolean(settingsSession())}
        snapshot={settingsSurface()}
        baselineSnapshot={settingsBaselineSurface()}
        draft={draft()}
        i18n={i18n()}
        busyState={settingsPresentation()?.saving === 'access' ? { ...IDLE_LAUNCHER_BUSY_STATE, action: 'save_settings' } : IDLE_LAUNCHER_BUSY_STATE}
        settingsError={settingsError() || settingsAccessErrorMessage()}
        settingsErrorRef={(value) => {
          settingsErrorRef = value;
        }}
        updateDraftField={updateDraftField}
        applyAccessMode={applyAccessMode}
        applyAccessFixedPort={applyAccessFixedPort}
        toggleAutoPort={toggleAutoPort}
        saveSettings={saveSettings}
        saveIntent={settingsPresentation()?.access_save_intent}
        connectionDirty={connectionSettingsDirty()}
        showConnectionSettings={() => settingsController.selectTab('connection')}
        focusTwoFactor={settingsPresentation()?.focus_two_factor}
        focusAccess={settingsPresentation()?.focus_access}
        certificate={props.runtime.settings.certificate ? async request => {
          const opening = settingsSession();
          const result = await props.runtime.settings.certificate!(request);
          if (opening && settingsController.current(opening) && request.operation !== 'status') await settingsController.loadAccess();
          return result;
        } : undefined}
        resetAccess={settingsController.resetAccess}
        desktopOpenLabel={i18n().t(selectedSettingsEnvironmentEntry()?.window_state === 'open' ? 'environmentAction.focus' : 'environmentAction.open')}
        openInDesktop={() => {
          const environment = selectedSettingsEnvironmentEntry();
          if (environment) void openEnvironment(environment);
        }}
        openInBrowser={async (url) => {
          try {
            const result = await window.redevenDesktopShell?.openExternalURL?.(url);
            if (!result?.ok) setSettingsError(result?.message || i18n().t('toast.actionFailedFallback'));
          } catch (error) { setSettingsError(getErrorMessage(error)); }
        }}
        copyEnvironmentValue={copyEnvironmentValue}
        runtimeRestartAvailable={settingsRuntimeRestartAvailable()}
        runtimeRunning={settingsRuntimePresentation().running}
        runtimeStatusLabel={settingsRuntimePresentation().statusLabel}
        runtimeStatusTone={settingsRuntimePresentation().statusTone}
        dark={theme.resolvedTheme() === 'dark'}
        cancelSettings={cancelSettings}
        clearStoredLocalUIPassword={clearStoredLocalUIPassword}
      />

            </Show>
          }}</Show>
        )} />
      <ConnectionDialog {...connectionFormProps} state={newConnectionState()} />

      <GatewaySetupDialog
        nativeHostSupported={snapshot().platform_capabilities.native_host_runtime}
        i18n={i18n()}
        state={gatewaySetupDialogState()}
        sshConfigHosts={sshConfigHosts()}
        sshConfigHostsLoading={sshConfigHostsLoading()}
        sshConfigHostsLoadError={sshConfigHostsLoadError()}
        containerOptions={runtimeContainerOptions()}
        containerOptionsLoading={runtimeContainerOptionsLoading()}
        containerOptionsError={runtimeContainerOptionsError()}
        error={gatewaySetupDialogError()}
        technicalDetail={gatewaySetupTechnicalDetail()}
        recovery={gatewaySetupRecovery()}
        onStart={() => { void startGatewayForSetup(); }}
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

      <Dialog
        open={deleteTarget() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);

          }
        }}
        title={i18n().t('confirm.removeEnvironmentTitle')}
        closeLabel={i18n().t('common.close')}
        onPresenceChange={present => {
          if (present || !deletedGatewayFocus) return;
          const target = deletedGatewayFocus;
          deletedGatewayFocus = undefined;
          queueMicrotask(() => {
            if (target.isConnected && (!document.activeElement || document.activeElement === document.body)) {
              target.focus({ preventScroll: true });
            }
          });
        }}
        footer={<>
          <Button variant="ghost" disabled={busyStateMatchesAction(busyState(), 'delete_environment')}
            onClick={() => { setDeleteTarget(null); }}>{i18n().t('common.cancel')}</Button>
          <Button variant="destructive" loading={busyStateMatchesAction(busyState(), 'delete_environment')}
            disabled={deleteNeedsReplacement() && !deleteReplacementRoutes().some(route => route.id === deleteReplacement())}
            onClick={() => void deleteEnvironment()}>
            {i18n().t('confirm.removeEnvironmentConfirm')}
          </Button>
        </>}
      >
        <div class="space-y-2">
          <Show when={deleteNeedsReplacement()}>
            <fieldset class="redeven-access-settings" disabled={busyStateMatchesAction(busyState(), 'delete_environment')}>
              <legend>{i18n().t('gatewayAccess.chooseReplacement')}</legend>
              <p>{i18n().t('gatewayAccess.removeDefaultHint')}</p>
              <div class="redeven-access-settings__routes">
                <For each={deleteReplacementRoutes()}>{route => (
                  <label class="redeven-access-choice" data-selected={deleteReplacement() === route.id}>
                    <input type="radio" name="environment-access-replacement" value={route.id} checked={deleteReplacement() === route.id}
                      onChange={() => setDeleteReplacement(route.id)} />
                    <span><strong>{environmentAccessRouteLabel(route, i18n())}</strong></span>
                  </label>
                )}</For>
              </div>
            </fieldset>
          </Show>
          <p class="text-[length:var(--floe-type-body)]">
            {i18n().t('confirm.removeEnvironmentQuestion', {
                  label: deleteTarget()?.label ?? '',
                })}
          </p>
          <p class="text-xs text-muted-foreground">
            <Show
              when={deleteTargetOperation()}
              fallback={<>{i18n().t('confirm.removeEnvironmentDescription')}</>}
            >
              <>{i18n().t('confirm.removeEnvironmentBusyDescription')}</>
            </Show>
          </p>

        </div>
      </Dialog>

      <ConfirmDialog
        open={signOutControlPlaneTarget() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSignOutControlPlaneTarget(null);
          }
        }}
        title={i18n().t('confirm.cloudSignOutTitle')}
        confirmText={i18n().t('environmentCenter.cloudSignOut')}
        cancelText={i18n().t('common.cancel')}
        variant="default"
        loading={busyStateMatchesAction(busyState(), 'sign_out_control_plane')}
        onConfirm={() => void signOutControlPlane()}
      >
        <div class="space-y-2">
          <p class="text-[length:var(--floe-type-body)]">
            {i18n().t('confirm.cloudSignOutQuestion', { label: signOutControlPlaneTarget()?.account.user_display_name || signOutControlPlaneTarget()?.display_label || 'Redeven Cloud' })}
          </p>
          <p class="text-xs text-muted-foreground">{i18n().t('confirm.cloudSignOutDescription')}</p>
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
          <p class="text-[length:var(--floe-type-body)]">
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
          <p class="text-[length:var(--floe-type-body)]">
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
                        'flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[length:var(--floe-type-body)]',
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
                  <div data-floe-surface="floating" class="redeven-desktop-toast" data-tone={toast.tone} role={toast.tone === 'error' ? 'alert' : 'status'}>
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
            <h2 class="text-[length:var(--floe-type-body)] font-semibold text-foreground">{props.i18n.t('environmentCenter.wslDiscoveredTitle')}</h2>
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
          <div class="text-[length:var(--floe-type-body)] font-medium text-foreground">{props.i18n.t('environmentCenter.wslMissingTitle')}</div>
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
                <div class="text-[length:var(--floe-type-body)] font-medium text-foreground">{environment.label}</div>
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
                      <div class="truncate text-[length:var(--floe-type-body)] font-semibold text-foreground">{distribution.distribution_name}</div>
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
                            <StableText reserve={[props.i18n.t('environmentCenter.wslRegistering'), props.i18n.t('environmentCenter.wslRegister')]}>{busyKey() === actionKey()
                              ? props.i18n.t('environmentCenter.wslRegistering')
                              : props.i18n.t('environmentCenter.wslRegister')}</StableText>
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

type EnvironmentFlowerTurnLauncherIntent = FlowerTurnLauncherIntent & { context_action: ReturnType<typeof buildEnvironmentFlowerContextAction> };

type EnvironmentGridProps = { groups: readonly EnvironmentLibraryDisplayGroup[]; scope: string; cloud?: boolean; quickAdd?: boolean };

function ConnectEnvironmentSurface(props: Readonly<{
  i18n: DesktopI18n;
  visible: boolean;
  snapshot: DesktopWelcomeSnapshot;
  busyState: DesktopLauncherBusyState;
  actionProgress: readonly DesktopLauncherActionProgress[];
  activeTab: EnvironmentCenterTab;
  setActiveTab: (value: EnvironmentCenterTab) => void;
  librarySourceFilter: string;
  libraryQuery: string;
  libraryGroups: readonly EnvironmentLibraryDisplayGroup[];
  allLibraryGroups: readonly EnvironmentLibraryDisplayGroup[];
  cloudQuery: string;
  setCloudQuery: (value: string) => void;
  focusedCloudSource: string;
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
  openGatewayMembers: (gateway: DesktopGatewaySource) => void;
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
  openInBrowser: (url: string) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry, recovery?: AddressRecoveryTarget) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  controlPlanes: readonly DesktopControlPlaneSummary[];
  gatewaySources: readonly DesktopGatewaySource[];
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  signOutControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
  deleteGateway: (gateway: DesktopGatewaySource) => void;
}>) {
  let tabContent!: HTMLDivElement;
  const tabEntrances = new Set<Animation>();
  let tabEntranceRevision = 0;
  const cancelTabEntrance = () => {
    tabEntranceRevision += 1;
    for (const animation of tabEntrances) animation.cancel();
    tabEntrances.clear();
  };
  const selectTab = (tab: EnvironmentCenterTab) => {
    if (tab === props.activeTab) return;
    cancelTabEntrance();
    props.setActiveTab(tab);
    const revision = tabEntranceRevision;
    // Wait for Solid's event batch to render the destination, before its first paint.
    // Explicit selection owns motion; refreshes and retained-page returns never replay it.
    queueMicrotask(() => {
      if (revision !== tabEntranceRevision || tab !== props.activeTab || !props.visible
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const targets = [...tabContent.querySelectorAll<HTMLElement>(
        '.redeven-environment-card, .redeven-cloud-source-header, .redeven-empty-panel, .redeven-console-empty',
      )].filter(element => !element.closest('[hidden]'));
      targets.forEach((element, index) => {
        const animation = element.animate(
          [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 350, delay: Math.min(index * 30, 150), easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
        );
        tabEntrances.add(animation);
        animation.onfinish = () => {
          animation.cancel();
          tabEntrances.delete(animation);
        };
      });
    });
  };
  createEffect(() => {
    if (!props.visible) cancelTabEntrance();
  });
  onCleanup(cancelTabEntrance);

  const visibleEnvironmentCount = createMemo(() => (
    environmentLibraryCount(
      props.allLibraryGroups,
      props.libraryQuery,
      props.librarySourceFilter,
    )
  ));
  const localSourceCount = createMemo(() => (
    environmentLibraryCount(props.allLibraryGroups, '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const providerSourceCount = createMemo(() => (
    environmentLibraryCount(props.allLibraryGroups, '', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const gatewaySourceCount = createMemo(() => (
    environmentLibraryCount(props.allLibraryGroups, '', GATEWAY_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const urlSourceCount = createMemo(() => (
    environmentLibraryCount(props.allLibraryGroups, '', URL_ENVIRONMENT_LIBRARY_FILTER)
  ));
  const sshSourceCount = createMemo(() => (
    environmentLibraryCount(props.allLibraryGroups, '', SSH_ENVIRONMENT_LIBRARY_FILTER)
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
      props.allLibraryGroups,
      '',
      '',
    )
  ));
  const layoutReferenceEnvironmentCardCount = createMemo(() => (
    layoutReferenceEnvironmentCount() + 1
  ));
  const headerCopy = createMemo(() => ENVIRONMENT_CENTER_HEADER_COPY[props.activeTab]);
  const ownerPresentation: EnvironmentOwnerPresentation = {
    card: entry => {
      const model = buildEnvironmentCardModel(entry);
      return { ...model, kind_label: localizedFactLabel(props.i18n, model.kind_label),
        status_label: localizedEnvironmentStatusLabel(props.i18n, model.status_label),
        runtime_started_label: localizedRuntimeStartedLabel(props.i18n, model.runtime_started_label) };
    },
    facts: entry => buildEnvironmentCardFactsModel(entry).map(fact => localizedEnvironmentFact(props.i18n, fact)),
    actions: model => localizedEnvironmentActionPresentation(props.i18n, model),
  };
  const EnvironmentGrid = (gridProps: EnvironmentGridProps) => (
    <EnvironmentCardsPanel
      gateways={props.gatewaySources}
      i18n={props.i18n}
      groups={gridProps.groups}
      allGroups={props.allLibraryGroups}
      viewScope={gridProps.scope}
      defaultCloud={gridProps.cloud}
      controlPlanes={props.controlPlanes}
      reconnectControlPlane={props.reconnectControlPlane}
      presentation={ownerPresentation}
      Facts={EnvironmentCardFactsBlock}
      Actions={EnvironmentSplitActionButton}
      newCard={<NewEnvironmentPlaceholderCard i18n={props.i18n} openCreateConnectionDialog={props.openCreateConnectionDialog} />}
      showQuickAddCards={gridProps.quickAdd ?? false}
      visibleCardCount={gridProps.groups.length + (gridProps.quickAdd ? 1 : 0)}
      layoutReferenceCardCount={layoutReferenceEnvironmentCardCount()}
      busyState={props.busyState}
      actionProgress={props.actionProgress}
      lifecycleProgressFocusRequest={props.lifecycleProgressFocusRequest}
      consumeLifecycleProgressFocusRequest={props.consumeLifecycleProgressFocusRequest}
      runLocalEnvironmentAction={props.runLocalEnvironmentAction}
      refreshEnvironmentRuntime={props.refreshEnvironmentRuntime}
      openEnvironmentFlowerSurface={props.openEnvironmentFlowerSurface}
      runEnvironmentGuidanceAction={props.runEnvironmentGuidanceAction}
      runDesktopUpdateHandoff={props.runDesktopUpdateHandoff}
      runEnvironmentCardFactAction={props.runEnvironmentCardFactAction}
      toggleEnvironmentPinned={props.toggleEnvironmentPinned}
      openInBrowser={props.openInBrowser} copyEnvironmentValue={props.copyEnvironmentValue}
      editEnvironment={props.editEnvironment}
      deleteEnvironment={props.deleteEnvironment}
      cancelOperation={props.cancelOperation}
      dismissOperation={props.dismissOperation}
      copyOperationDiagnostics={props.copyOperationDiagnostics}
    />
  );

  return (
    <div class="redeven-welcome-surface h-full min-h-0 w-full min-w-0 overflow-auto bg-background">
      <main id="redeven-desktop-main" class="w-full px-4 py-5 sm:px-6 lg:px-8">
        <div class="mx-auto w-full redeven-welcome-shell">
          <header class="redeven-header-separator mb-5 space-y-4">
            <div class="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div class="min-w-0 space-y-1">
                <h1 class="text-base font-medium tracking-normal text-foreground">{props.i18n.t(headerCopy().titleKey)}</h1>
                <p class="text-xs text-muted-foreground">
                  {props.i18n.t(headerCopy().descriptionKey)}
                </p>
              </div>
              <div class="redeven-center-actions flex min-w-0 items-center gap-2">
                <div class="redeven-center-search">
                  <Show
                    when={props.activeTab === 'gateways'}
                    fallback={(
                      <Input
                        value={props.activeTab === 'control_planes' ? props.cloudQuery : props.libraryQuery}
                        onInput={(event) => (props.activeTab === 'control_planes' ? props.setCloudQuery : props.setLibraryQuery)(event.currentTarget.value)}
                        placeholder={props.i18n.t(props.activeTab === 'control_planes' ? 'environmentCenter.cloudSearchPlaceholder' : 'environmentCenter.searchPlaceholder')}
                        aria-label={props.i18n.t(props.activeTab === 'control_planes' ? 'environmentCenter.cloudSearchPlaceholder' : 'environmentCenter.searchPlaceholder')}
                        leftIcon={<Search class="h-4 w-4" aria-hidden="true" />}
                        size="sm"
                      />
                    )}
                  >
                    <Input
                      value={props.gatewayQuery}
                      onInput={(event) => props.setGatewayQuery(event.currentTarget.value)}
                      placeholder={props.i18n.t('environmentCenter.gatewaySearchPlaceholder')}
                      aria-label={props.i18n.t('environmentCenter.gatewaySearchPlaceholder')}
                      leftIcon={<Search class="h-4 w-4" aria-hidden="true" />}
                      size="sm"
                    />
                  </Show>
                </div>
                <div class="redeven-center-action-group flex min-w-0 max-w-full items-center gap-2">
                  <Show when={props.activeTab === 'environments'}>
                    <DesktopTooltip content={props.i18n.t('environmentCenter.refreshRuntimeStatuses')} placement="top">
                      <Button
                        size="sm"
                        variant="outline"
                        class="px-2.5"
                        aria-label={props.i18n.t('environmentCenter.refreshRuntimeStatuses')}
                        disabled={busyStateMatchesAction(props.busyState, 'refresh_all_environment_runtimes')}
                        onClick={() => {
                          void props.refreshAllEnvironmentRuntimes();
                        }}
                      >
                        <Refresh class="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </DesktopTooltip>
                  </Show>
                  <Show when={props.activeTab === 'environments'}>
                    <DesktopTooltip content={props.i18n.t('environmentCenter.newEnvironmentTitle')} placement="top">
                      <Button size="sm" variant="default" aria-label={props.i18n.t('environmentCenter.newEnvironmentTitle')}
                        onClick={() => props.openCreateConnectionDialog()}>
                        <Plus class="h-3.5 w-3.5" aria-hidden="true" />
                        <span class="redeven-center-action-label">{props.i18n.t('environmentCenter.newEnvironmentShort')}</span>
                      </Button>
                    </DesktopTooltip>
                  </Show>
                  <Show when={props.activeTab === 'control_planes'}>
                    <DesktopTooltip content={props.i18n.t('environmentCenter.connectProvider')} placement="top">
                      <Button size="sm" variant="default" aria-label={props.i18n.t('environmentCenter.connectProvider')}
                        onClick={() => props.openCreateControlPlaneDialog()}>
                        <Link class="h-3.5 w-3.5" aria-hidden="true" />
                        <span class="redeven-center-action-label">{props.i18n.t('environmentCenter.connectCloudShort')}</span>
                      </Button>
                    </DesktopTooltip>
                  </Show>
                  <Show when={props.activeTab === 'gateways'}>
                    <DesktopTooltip content={props.i18n.t('environmentCenter.addGateway')} placement="top">
                      <Button size="sm" variant="default" aria-label={props.i18n.t('environmentCenter.addGateway')}
                        onClick={() => props.openCreateGatewaySetup()}>
                        <Plus class="h-3.5 w-3.5" aria-hidden="true" />
                        <span class="redeven-center-action-label">{props.i18n.t('environmentCenter.addGatewayShort')}</span>
                      </Button>
                    </DesktopTooltip>
                  </Show>
                </div>
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
                      onClick={() => selectTab(tab.value)}
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
                    <Show when={totalGatewaySourceCount() > 1 || props.gatewaySourceFilter !== ''}>
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
                    </Show>
                    <div class="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                      <span>{props.i18n.t('environmentCenter.gatewaysCount', { count: props.gatewaySources.length })}</span>
                      <Show when={visibleGatewaySourceCount() !== totalGatewaySourceCount()}>
                        <span class="text-border">·</span>
                        <span>{props.i18n.t('environmentCenter.shownCount', { count: visibleGatewaySourceCount() })}</span>
                      </Show>
                    </div>
                  </>
                </Show>
              </div>
            </div>
          </header>

          <div ref={tabContent} class="redeven-center-content space-y-3">
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
                <EnvironmentGrid groups={props.libraryGroups} scope={props.librarySourceFilter}
                  cloud={props.librarySourceFilter === PROVIDER_ENVIRONMENT_LIBRARY_FILTER || props.controlPlanes.some(source => controlPlaneFilterValue(source) === props.librarySourceFilter)}
                  quickAdd={showQuickAddCards()} />
              </>
            </Show>
            <Show when={props.activeTab === 'control_planes'}>
              <ControlPlanesPanel
                i18n={props.i18n}
                controlPlanes={props.controlPlanes}
                busyState={props.busyState}
                openCreateControlPlaneDialog={props.openCreateControlPlaneDialog}
                groups={props.allLibraryGroups}
                query={props.cloudQuery}
                focusedSource={props.focusedCloudSource}
                Grid={EnvironmentGrid}
                reconnectControlPlane={props.reconnectControlPlane}
                refreshControlPlane={props.refreshControlPlane}
                signOutControlPlane={props.signOutControlPlane}
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
                openGatewayMembers={props.openGatewayMembers}
                editEnvironment={props.editEnvironment}
                deleteEnvironment={props.deleteEnvironment}
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


function ConsoleChipActionButton(props: Readonly<{
  onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  title?: string;
  children: JSX.Element;
}>) {
  return (
    <button
      type="button"
      class="redeven-console-chip-button"
      title={props.title}
      onClick={props.onClick}
    >
      <span class="redeven-control-label">{props.children}</span>
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

export function EnvironmentCardFactsBlock(props: Readonly<{
  i18n: DesktopI18n;
  facts: readonly EnvironmentCardFactModel[];
  environmentID: string;
  environmentLabel: string;
  minRows?: number;
  onFactAction: (action: EnvironmentCardFactActionModel) => void;
  openInBrowser: (url: string) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  endpointPopoverOpen: boolean;
  onEndpointPopoverOpenChange: (open: boolean) => void;
  selectedEndpointID?: string;
  selectEndpointForQRCode: (endpointID: string) => void;
  configureAddress?: (target: AddressRecoveryTarget) => void;
}>) {
  // Fact identity survives both snapshot replacement and localization. Values stay live.
  const factsByID = createMemo(() => new Map(props.facts.map(fact => [fact.id, fact])));
  const factIDs = createMemo(() => props.facts.map(fact => fact.id));
  return (
    <div
      class="space-y-0 redeven-card-facts-block"
      style={props.minRows && props.minRows > 0
        ? { 'min-height': `calc(${props.minRows} * var(--redeven-card-fact-row-min-height))` }
        : undefined}
    >
      <For each={factIDs()}>
        {(id) => {
          const fact = () => factsByID().get(id)!;
          const [copiedValue, setCopiedValue] = createSignal<string | null>(null);
          const copied = () => copiedValue() === fact().value;
          let resetTimer: ReturnType<typeof setTimeout> | undefined;

          const handleCopy = () => {
            void props.copyEnvironmentValue(fact().value, fact().label);
            setCopiedValue(fact().value);
            clearTimeout(resetTimer);
            resetTimer = setTimeout(() => setCopiedValue(null), 1500);
          };

          onCleanup(() => clearTimeout(resetTimer));

          return (
          <div class="redeven-card-fact-row">
            <div class="redeven-card-fact-label" title={fact().label}>
              <Show when={fact().label_icon}>
                {(icon) => (
                  <span
                    class="redeven-card-fact-label-icon"
                    style={cardFactIconMaskStyle(icon())}
                    aria-hidden="true"
                  />
                )}
              </Show>
              <span class="redeven-control-label">{fact().label}</span>
            </div>
            {/* The render callback keeps this subtree owned by visibility, not snapshot reads. */}
            <Show when={!fact().action}>
              {(_visible) => (
                <div
                  class={cn(
                    'redeven-card-fact-value',
                    fact().value_tone === 'placeholder' && 'redeven-card-fact-value--placeholder',
                    fact().copy_value && 'redeven-card-fact-value--copyable',
                  )}
                  title={fact().value}
                  role={fact().copy_value ? 'button' : undefined}
                  tabIndex={fact().copy_value ? 0 : undefined}
                  aria-label={fact().copy_value ? props.i18n.t('environmentFacts.copyFact', { label: fact().label }) : undefined}
                  onClick={() => { if (fact().copy_value) handleCopy(); }}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (fact().copy_value && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      handleCopy();
                    }
                  }}
                >
                  <Show when={fact().leading_icon}>
                    {(icon) => (
                      <span
                        class="redeven-card-fact-leading-icon"
                        style={cardFactIconMaskStyle(icon())}
                        aria-hidden="true"
                      />
                    )}
                  </Show>
                  <span class="redeven-card-fact-value__text">{fact().value}</span>
                  <Show when={fact().endpoints && fact().endpoints!.length > 0}>
                    <EndpointsPopover
                      environmentID={props.environmentID}
                      i18n={props.i18n}
                      endpoints={fact().endpoints!}
                      configureAddress={props.configureAddress}
                      environmentLabel={props.environmentLabel}
                      openInBrowser={props.openInBrowser} copyEnvironmentValue={props.copyEnvironmentValue}
                      open={props.endpointPopoverOpen}
                      onOpenChange={props.onEndpointPopoverOpenChange}
                      selectedEndpointID={props.selectedEndpointID}
                      selectEndpointForQRCode={props.selectEndpointForQRCode}
                    />
                  </Show>
                  <Show when={fact().copy_value}>
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
            </Show>
            <Show when={fact().action}>
              {(action) => (
                <button
                  type="button"
                  class="redeven-card-fact-value redeven-card-fact-value--action"
                  title={action().label}
                  aria-label={action().aria_label}
                  onClick={() => props.onFactAction(action())}
                >
                  <Show when={fact().leading_icon}>
                    {(icon) => (
                      <span
                        class="redeven-card-fact-leading-icon"
                        style={cardFactIconMaskStyle(icon())}
                        aria-hidden="true"
                      />
                    )}
                  </Show>
                  <span class="redeven-card-fact-value__text">{fact().value}</span>
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

export function EndpointsPopover(props: Readonly<{
  i18n: DesktopI18n;
  endpoints: readonly EnvironmentCardEndpointModel[];
  environmentID: string;
  environmentLabel: string;
  openInBrowser: (url: string) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedEndpointID?: string;
  selectEndpointForQRCode: (endpointID: string) => void;
  configureAddress?: (target: AddressRecoveryTarget) => void;
}>) {
  let anchorRef: HTMLButtonElement | undefined;
  let popoverRef: HTMLDivElement | undefined;

  const presence = createFloatingPresence({ open: () => props.open, exitDurationMs: 140 });
  const popoverID = createUniqueId();
  const close = () => {
    props.onOpenChange(false);
    anchorRef?.focus({ preventScroll: true });
  };

  const presentedSelection = createMemo<string>((previous) => props.open
    ? props.selectedEndpointID ?? ''
    : presence.mounted() ? previous : '', '');
  const selectedEndpoint = createMemo(() => props.endpoints.filter(isShareableConnectionAddress)
    .find((endpoint) => endpoint.id === presentedSelection()) ?? null);

  const sharePresence = createFloatingPresence({ open: () => Boolean(selectedEndpoint()), exitDurationMs: 180 });
  const [lastSharedID, setLastSharedID] = createSignal('');
  createEffect(() => {
    const endpoint = selectedEndpoint();
    if (endpoint) setLastSharedID(endpoint.id);
  });
  // Retain only a still-shareable current address while its disclosure closes.
  const presentedShare = createMemo(() => sharePresence.mounted()
    ? props.endpoints.filter(isShareableConnectionAddress).find(row => row.id === lastSharedID())
    : undefined);

  const handlePointerDown = (event: MouseEvent) => {
    if (popoverRef?.contains(event.target as Node) || anchorRef?.contains(event.target as Node)) {
      return;
    }
    props.onOpenChange(false);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  createEffect(() => {
    if (props.open) {
      queueMicrotask(() => {
        if (props.open) popoverRef?.querySelector('button')?.focus({ preventScroll: true });
      });
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
      <button
        type="button"
        ref={anchorRef}
        class="redeven-card-fact-endpoint-trigger"
        aria-label={props.i18n.t('environmentCenter.showEndpoints')}
        aria-haspopup="dialog"
        aria-expanded={props.open}
        aria-controls={presence.mounted() ? popoverID : undefined}
        onClick={(e) => {
          e.stopPropagation();
          props.onOpenChange(!props.open);
        }}
      >
        <span
          class="redeven-endpoint-trigger-icon"
          style={cardFactIconMaskStyle(ICON_ENDPOINTS)}
          aria-hidden="true"
        />
      </button>
      <Show when={presence.mounted()}>
        <DesktopAnchoredOverlaySurface
          open={presence.mounted()}
          anchorRef={anchorRef}
          placement="bottom"
          role={props.open ? 'dialog' : undefined}
          ariaModal={false}
          ariaLabel={props.i18n.t('environmentCenter.environmentEndpoints')}
          interactive={props.open}
          class={cn('redeven-endpoints-surface z-[225] text-popover-foreground', presence.exiting() && 'redeven-endpoints-surface--closing')}
          onOverlayRef={(element) => {
            popoverRef = element;
          }}
        >
          <div
            id={popoverID}
            class="redeven-endpoints-popover"
            data-state={presence.state()}
            inert={presence.exiting()}
            aria-hidden={presence.exiting()}
          >
            <div class="redeven-endpoints-popover-header">
              <span class="redeven-endpoints-popover-mark" aria-hidden="true">
                <span class="redeven-endpoint-trigger-icon" style={cardFactIconMaskStyle(ICON_ENDPOINTS)} />
              </span>
              <div class="redeven-endpoints-popover-heading">
                <span class="redeven-endpoints-popover-eyebrow">{props.i18n.t('environmentCenter.environmentEndpoints')}</span>
                <span class="redeven-endpoints-popover-title">{props.environmentLabel}</span>
              </div>
              <button
                type="button"
                class="redeven-endpoints-popover-close"
                aria-label={props.i18n.t('environmentCenter.closeEndpoints')}
                onClick={close}
              >
                <X class="h-3 w-3" />
              </button>
            </div>
            <div class="redeven-endpoints-popover-body">
              <div class="redeven-endpoints-popover-list">
                <EnvironmentConnectionRows environmentID={props.environmentID} rows={props.endpoints} i18n={props.i18n}
                  selectedID={presentedSelection()} selectForShare={props.selectEndpointForQRCode}
                  configureAddress={props.configureAddress ? target => { close(); props.configureAddress?.(target); } : undefined}
                  openInBrowser={props.openInBrowser} copyEnvironmentValue={props.copyEnvironmentValue} />
              </div>
              <div class="redeven-endpoints-share" data-expanded={Boolean(selectedEndpoint())}
                inert={!selectedEndpoint()} aria-hidden={!selectedEndpoint()}>
                <div class="redeven-endpoints-share-content">
                  <Show when={presentedShare()}>
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
            </div>
          </div>
        </DesktopAnchoredOverlaySurface>
      </Show>
    </>
  );
}

function EndpointQRCodePanel(props: Readonly<{
  i18n: DesktopI18n;
  endpoint: DesktopShareableConnectionAddress;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
}>) {
  const [copiedValue, setCopiedValue] = createSignal<string | null>(null);
  const copied = () => copiedValue() === props.endpoint.value;
  const qrSrc = createMemo(() => qrCodeDataUrl(props.endpoint.value));
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const handleCopy = () => {
    void props.copyEnvironmentValue(props.endpoint.value, props.i18n.t('environmentFacts.environmentUrl'));
    setCopiedValue(props.endpoint.value);
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => setCopiedValue(null), 1500);
  };

  onCleanup(() => clearTimeout(resetTimer));

  return (
    <div class="redeven-endpoint-qr-panel">
      <div class="redeven-endpoint-qr-card">
        <img
          class="redeven-endpoint-qr-image"
          src={qrSrc()}
          alt={props.i18n.t('environmentFacts.copyEnvironmentUrl')}
        />
      </div>
      <div class="redeven-endpoint-qr-meta">
        <span class="redeven-endpoint-qr-label">{props.i18n.t(props.endpoint.label_key)}</span>
        <span class="redeven-endpoint-qr-value" title={props.endpoint.value}>{props.endpoint.value}</span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        class="redeven-copy-action redeven-endpoint-qr-copy-button"
        data-copied={copied() || undefined}
        aria-label={props.i18n.t('environmentFacts.copyEnvironmentUrl')}
        title={copied() ? props.i18n.t('environmentCenter.copied') : props.i18n.t('environmentFacts.copyEnvironmentUrl')}
        onClick={handleCopy}
      >
        <Show when={copied()} fallback={<Copy class="h-3 w-3" />}>
          <Check class="h-3 w-3" />
        </Show>
        <span class="redeven-endpoint-qr-copy-label"><StableText reserve={[props.i18n.t('environmentCenter.copied'), props.i18n.t('common.copy')]}>{copied() ? props.i18n.t('environmentCenter.copied') : props.i18n.t('common.copy')}</StableText></span>
      </Button>
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
  if (progress.subject_kind === 'gateway') return trimString(progress.environment_label) || i18n.t('environmentCenter.gatewayProgress');
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
  settingsRestart?: EnvironmentSettingsRestartSource;
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
  const observedGatewayServiceSteps = createMemo(() => props.progress.subject_kind === 'gateway'
    && ['start_gateway', 'stop_gateway', 'restart_gateway', 'update_gateway'].includes(props.progress.action));
  const operationElapsedSeconds = createMemo(() => environmentProgressElapsedSeconds(props.progress, clockNow()));
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
    (props.settingsRestart && phaseStatus() !== 'running')
    || nextActionGroups().length > 0
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
                    variant={action.kind === 'copy_diagnostics' ? 'ghost' : 'outline'}
                    class={action.kind === 'copy_diagnostics' ? 'redeven-copy-action' : 'justify-center gap-1.5'}
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
        <Show when={props.settingsRestart}>
          <p class="redeven-action-popover__detail" data-settings-restart-result>
            {props.i18n.t(phaseStatus() === 'succeeded' ? 'settings.restartApplied'
              : phaseStatus() === 'running' ? 'settings.restartSaved' : 'settings.restartNotApplied')}
          </p>
        </Show>
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
              data-plan-state={observedGatewayServiceSteps()
                ? (phaseStatus() === 'running' ? 'planning' : 'executing')
                : runtimeLifecycle()?.plan_state ?? 'executing'}
              role={observedGatewayServiceSteps() ? 'progressbar' : undefined}
              aria-label={observedGatewayServiceSteps() ? localizedProgressTitle(props.i18n, props.progress) : undefined}
              aria-valuenow={observedGatewayServiceSteps() && phaseStatus() === 'succeeded' ? 100 : undefined}
              aria-hidden={!observedGatewayServiceSteps()}
            >
              <span style={{ width: `${observedGatewayServiceSteps() ? (phaseStatus() === 'running' || phaseStatus() === 'succeeded' ? 100 : 0) : stagePercent()}%` }} />
            </div>
            <div class="redeven-environment-progress__meta">
              <Show when={observedGatewayServiceSteps() && operationElapsedSeconds() !== null}>
                <span class="redeven-environment-progress__elapsed">{props.i18n.t('progress.operationElapsed', { seconds: operationElapsedSeconds()! })}</span>
              </Show>
              <Show when={!observedGatewayServiceSteps() && (stepProgress() || runtimeLifecycle())}>
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
          <Show when={props.settingsRestart && phaseStatus() !== 'running'}>
            <div class="redeven-action-popover__actions">
              <Show when={(phaseStatus() === 'failed' || phaseStatus() === 'canceled') && !props.progress.next_actions?.some(action => action.kind === 'retry')}>
                <Button size="sm" variant="outline" onClick={() => props.settingsRestart?.retry()}>{props.i18n.t('settings.retryRestart')}</Button>
              </Show>
              <Button size="sm" variant="outline" onClick={() => props.settingsRestart?.returnToSettings()}>
                {props.i18n.t(phaseStatus() === 'succeeded' && props.settingsRestart?.returnTo === 'two_factor'
                  ? 'settings.continueTwoFactor' : 'settings.returnToSettings')}
              </Button>
            </div>
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

export function EnvironmentSplitActionButton(
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
    settingsRestart?: EnvironmentSettingsRestartSource;
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
    gatewayAction?: Readonly<{
      label: string;
      disabled?: boolean;
      onRun: () => void;
    }>;
  }>,
) {
  const hasMenuActions = createMemo(() => props.presentation.menu_actions.length > 0 || !!props.gatewayAction);
  const menuGroups = createMemo(() => {
    const actions = props.presentation.menu_actions;
    if (!props.gatewayAction) return [{ actions, gatewayAction: undefined }];
    const cloudIndex = actions.findIndex(item => item.action.intent === 'connect_provider_runtime'
      || item.action.intent === 'disconnect_provider_runtime');
    const accessIndex = cloudIndex < 0 ? actions.length : cloudIndex;
    return [
      { actions: actions.slice(0, accessIndex), gatewayAction: undefined },
      { actions: actions.slice(accessIndex), gatewayAction: props.gatewayAction },
    ].filter(group => group.actions.length > 0 || group.gatewayAction);
  });
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
  const settingsPending = createMemo(() => Boolean(props.settingsRestart) && panelProgress() === null);
  const settingsProgressLabel = createMemo(() => props.i18n.t(
    panelProgress()?.status === 'succeeded' ? 'progress.ready'
      : panelProgress()?.status === 'canceled' ? 'progress.canceled'
      : props.settingsRestart?.submissionError() ? 'progress.restartFailed' : 'progress.restartingEllipsis',
  ));
  const hasPanelProgress = createMemo(() => panelProgress() !== null || settingsPending());
  const progressPanelVisible = createMemo(() => props.progressOpen && hasPanelProgress());
  createEffect(() => {
    const source = props.settingsRestart;
    source?.visibilityChanged(progressPanelVisible());
    onCleanup(() => source?.visibilityChanged(false));
  });
  const returnToSettings = () => { const source = props.settingsRestart; props.onProgressOpenChange(false); source?.returnToSettings(); };
  const settingsRestartPanelSource = createMemo(() => {
    const source = props.settingsRestart;
    return source ? { ...source, returnToSettings } : undefined;
  });
  const primaryProgressPresentation = createMemo(() =>
    localizedPrimaryProgressPresentation(props.i18n, environmentProgressPrimaryPresentation(panelProgress())),
  );
  const primaryActionOverlay = createMemo(() =>
    primaryProgressPresentation() || progressPanelVisible() || props.settingsRestart
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
  const primaryButtonClass = createMemo(() =>
    cn('w-full justify-center', hasMenuActions() && 'rounded-r-none border-r-0'),
  );
  const renderPrimaryActionIcon = () =>
    props.presentation.primary_action.intent === 'request_open_access' ? (
      <ShieldCheck class="mr-1 h-3.5 w-3.5" />
    ) : null;
  const renderEnvironmentProgressTriggerIcon = (icon: 'play' | 'stop' | 'refresh') => {
    const ProgressIcon = icon === 'stop' ? Stop : icon === 'refresh' ? Refresh : Play;
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
      data-floe-progress-shimmer={primaryActionLoading() ? 'surface' : undefined}
      title={props.presentation.primary_action.label}
      disabled={!props.presentation.primary_action.enabled}
      onClick={() => {
        closeMenu();
        props.onProgressOpenChange(false);
        props.onRunAction(props.presentation.primary_action);
      }}
    >
      {renderPrimaryActionIcon()}
      <span class="redeven-control-label">{props.presentation.primary_action.label}</span>
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
                    <Show when={settingsPending()}>
                      <div class="redeven-action-popover redeven-environment-progress" data-redeven-action-popover-initial-focus="" tabIndex={-1} aria-live="polite">
                        <div class="redeven-environment-progress__body">
                          <div class="redeven-action-popover__title">{props.i18n.t(props.settingsRestart?.submissionError() ? 'progress.restartFailed' : 'settings.submittingRestart')}</div>
                          <div class="redeven-environment-progress__target">{props.environmentLabel}</div>
                          <p class="redeven-action-popover__detail">{props.i18n.t(props.settingsRestart?.submissionError() ? 'settings.restartNotApplied' : 'toast.settingsSaved')}</p>
                          <Show when={props.settingsRestart?.submissionError()}>{error => <p class="redeven-action-popover__notice-detail" role="alert">{error()}</p>}</Show>
                        </div>
                        <Show when={props.settingsRestart?.submissionError()}>
                          <div class="redeven-action-popover__action-footer redeven-action-popover__actions">
                            <Button size="sm" onClick={() => props.settingsRestart?.retry()}>{props.i18n.t('settings.retryRestart')}</Button>
                            <Button size="sm" variant="outline" onClick={returnToSettings}>{props.i18n.t('settings.returnToSettings')}</Button>
                          </div>
                        </Show>
                      </div>
                    </Show>
                    <Show when={panelProgress()}>
                      {(p) => (
                        <EnvironmentProgressPanel
                          i18n={props.i18n}
                          progress={p()}
                          settingsRestart={settingsRestartPanelSource()}
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
                                  label: 'Update',
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
                                    label: 'Reinstall',
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
                                if (props.settingsRestart) { props.settingsRestart.retry(); break; }
                                const retryAction = environmentActionForLauncherRetry(action.retry_action);
                                if (retryAction) {
                                  props.onRunAction(retryAction);
                                }
                                break;
                              }
                              case 'copy_diagnostics':
                                props.copyOperationDiagnostics(progress);
                                break;
                              case 'open_gateway_environment':
                                props.onRunAction({ intent: 'open', label: action.label, label_key: action.label_key,
                                  enabled: true, variant: 'default' });
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
                  disabled={!props.settingsRestart && props.operationState.actionsDisabled && primaryFallbackRunsAction()}
                  aria-disabled={blockedPrimaryActionDisabled() ? true : undefined}
                  aria-haspopup={hasPanelProgress() || popoverOverlay() ? 'dialog' : undefined}
                  aria-expanded={props.settingsRestart ? props.progressOpen : popoverOverlay() ? props.guidanceOpen : undefined}
                  title={props.settingsRestart ? settingsProgressLabel() : props.presentation.primary_action.label}
                  aria-label={
                    blockedPrimaryActionDisabled()
                      ? blockedPrimaryActionTriggerLabel(props.i18n, props.presentation.primary_action.label)
                      : undefined
                  }
                  onClick={() => {
                    closeMenu();
                    if (props.settingsRestart) { props.onProgressOpenChange(!props.progressOpen); return; }
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
                  <Show when={blockedPrimaryActionDisabled()} fallback={<span class="redeven-control-label">{props.settingsRestart ? settingsProgressLabel() : props.presentation.primary_action.label}</span>}>
                    <span class="redeven-split-action-trigger__content">
                      {props.presentation.primary_action.intent === 'request_open_access' ? (
                        <ShieldCheck class="redeven-split-action-trigger__icon h-3.5 w-3.5" />
                      ) : (
                        <Lock class="redeven-split-action-trigger__icon h-3.5 w-3.5" />
                      )}
                      <span class="redeven-control-label">{props.presentation.primary_action.label}</span>
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
                    data-floe-progress-shimmer={presentation().kind === 'progress_trigger' ? 'surface' : undefined}
                    style={{
                      'min-width': 'var(--redeven-split-action-primary-min-width)',
                    }}
                    aria-haspopup="dialog"
                    aria-expanded={props.progressOpen}
                    aria-label={presentation().ariaLabel}
                    title={presentation().label}
                    onClick={() => {
                      closeMenu();
                      props.onProgressOpenChange(!props.progressOpen);
                    }}
                  >
                    <span class="redeven-split-action-trigger__content">
                      {renderEnvironmentProgressPresentationIcon(presentation())}
                      <span class="redeven-control-label">{presentation().label}</span>
                    </span>
                  </Button>
                );
              }}
            </Show>
          </DesktopActionPopover>
        </Show>
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
          class="redeven-split-menu z-[230]"
          onOverlayRef={(element) => {
            menuRef = element;
          }}
        >
          <For each={menuGroups()}>
            {(group, index) => <>
                <Show when={index() > 0}>
                  <div class="my-1 border-t border-border/60" role="separator" />
                </Show>
                <Show when={group.gatewayAction}>
                  {(action) => (
                    <button
                      type="button"
                      role="menuitem"
                      class="redeven-split-menu-item"
                      data-tone="primary"
                      disabled={action().disabled}
                      onClick={() => {
                        if (action().disabled) return;
                        closeMenu();
                        action().onRun();
                      }}
                    >
                      <span class="redeven-split-menu-item-icon"><Link /></span>
                      <span class="redeven-control-label">{action().label}</span>
                    </button>
                  )}
                </Show>
                <For each={group.actions}>
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
                        title={disabledReason() ?? item.label}
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
                        <span class="redeven-control-label">{item.label}</span>
                        <Show when={disabled() && disabledReason()}>
                          <span id={`${props.environmentID}-${item.id}-disabled-reason`} class="sr-only">
                            {disabledReason()}
                          </span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
            </>}
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
                <CardTitle class="truncate text-[length:var(--floe-type-control)] font-medium">{props.title}</CardTitle>
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
      <div class="redeven-new-environment-body flex h-full flex-col items-center justify-center gap-4 px-4 py-10">
        <div class="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/20 text-muted-foreground transition-[border-color,background-color,color,transform] duration-200 group-hover:scale-110 group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary">
          <Plus class="h-6 w-6" />
        </div>
        <div class="redeven-new-environment-copy space-y-1 text-center">
          <div class="redeven-control-label text-[length:var(--floe-type-body)] font-semibold text-foreground" title={props.i18n.t('environmentCenter.newEnvironmentTitle')}>{props.i18n.t('environmentCenter.newEnvironmentTitle')}</div>
          <div class="redeven-new-environment-description text-xs text-muted-foreground" title={props.i18n.t('environmentCenter.newEnvironmentDescription')}>{props.i18n.t('environmentCenter.newEnvironmentDescription')}</div>
        </div>
        <div class="redeven-new-environment-options">
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
            title={props.i18n.t('connectionDialog.localContainer')}
            onClick={(event) => {
              event.stopPropagation();
              props.openCreateConnectionDialog('', 'local_container_runtime');
            }}
          >
            {props.i18n.t('connectionDialog.localContainer')}
          </ConsoleChipActionButton>
          <ConsoleChipActionButton
            title={props.i18n.t('connectionDialog.sshContainer')}
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
  groups: readonly EnvironmentLibraryDisplayGroup[];
  query: string;
  focusedSource: string;
  Grid: (props: EnvironmentGridProps) => JSX.Element;
  busyState: DesktopLauncherBusyState;
  openCreateControlPlaneDialog: (message?: string) => void;
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  signOutControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
}>) {
  const sections = createMemo(() => environmentCloudSections(props.groups, props.controlPlanes));
  const sectionIDs = createMemo(() => sections().map(section => section.id));
  const visible = createMemo(() => environmentCloudSections(props.groups, props.controlPlanes, props.query));
  const byID = createMemo(() => new Map(sections().map(section => [section.id, section])));
  const visibleByID = createMemo(() => new Map(visible().map(section => [section.id, section])));
  createEffect(() => {
    const id = props.focusedSource;
    if (id) document.getElementById(`cloud-source:${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  return (
    <div class="space-y-6">
      <Show when={props.controlPlanes.length === 0}>
        <QuickCreateConnectionCard
          title={props.i18n.t('environmentCenter.addProviderTitle')}
          badge={props.i18n.t('environmentCenter.addProviderBadge')}
          detail={props.i18n.t('environmentCenter.addProviderDescription')}
          actionLabel={props.i18n.t('environmentCenter.connectProvider')}
          onClick={() => props.openCreateControlPlaneDialog()}
        />
      </Show>
      <Show when={props.controlPlanes.length > 0 && visible().length === 0}>
        <div class="redeven-console-empty rounded-lg px-6 py-8 text-center text-[length:var(--floe-type-body)] text-muted-foreground">
          {props.i18n.t('environmentCenter.noCloudSearchResults')}
        </div>
      </Show>
      <For each={sectionIDs()}>{id => {
        const section = () => byID().get(id)!;
        const current = () => visibleByID().get(id) ?? { ...section(), visible_groups: [] };
        return <section id={`cloud-source:${id}`} data-cloud-source={id} hidden={!visibleByID().has(id)} class="space-y-3 scroll-mt-4">
          <CloudAccountOverview i18n={props.i18n} section={section()} lastSyncedLabel={formatLocalizedRelativeTimestamp(props.i18n, section().source.last_synced_at_ms)} busyState={props.busyState}
            reconnectControlPlane={props.reconnectControlPlane} refreshControlPlane={props.refreshControlPlane}
            signOutControlPlane={props.signOutControlPlane} />
          <Show when={section().groups.length === 0} fallback={<props.Grid groups={current().visible_groups} scope={id} cloud />}>
            <div class="rounded-lg border border-dashed border-border px-5 py-6 text-center text-xs text-muted-foreground">
              {props.i18n.t(section().source.sync_state === 'ready' ? 'environmentCenter.cloudSourceEmpty' : 'environmentCenter.cloudSourceUnavailable')}
            </div>
          </Show>
        </section>;
      }}</For>
    </div>
  );
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
    case 'renewal_required':
      return i18n.t('providerRecovery.required');
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
  openGatewayMembers: (gateway: DesktopGatewaySource) => void;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
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
          <div class="mt-4 text-[length:var(--floe-type-body)] font-semibold text-foreground">{props.i18n.t('environmentCenter.noGatewaysTitle')}</div>
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
            <div class="mt-4 text-[length:var(--floe-type-body)] font-semibold text-foreground">{props.i18n.t('environmentCenter.noMatchingGatewaysTitle')}</div>
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
                  openGatewayMembers={props.openGatewayMembers}
                  editEnvironment={props.editEnvironment}
                  deleteEnvironment={props.deleteEnvironment}
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
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
      return `${gateway.gateway_id}:${action.intent}`;
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
    title_key: 'progress.checkingGateway',
    environment_label: gateway.display_name,
    active_progress_surface: 'gateway',
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
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
    case 'refresh_gateway':
      return true;
    default:
      return false;
  }
}

function gatewayProgressCanRecoverForegroundAction(progress: DesktopLauncherActionProgress): boolean {
  switch (progress.action) {
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
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
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
      return { intent: request.kind, label: request.kind, enabled: true, variant: 'default' };
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
  if (!progress) return null;
  switch (progress.action) {
    case 'refresh_gateway': case 'start_gateway': case 'stop_gateway': case 'restart_gateway': case 'update_gateway':
      return { intent: progress.action, label: progress.title, enabled: true, variant: 'default' };
    default: return null;
  }
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
  openGatewayMembers: (gateway: DesktopGatewaySource) => void;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
  dismissOperation: (progress: DesktopLauncherActionProgress) => void;
  copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  deleteGateway: (gateway: DesktopGatewaySource) => void;
}>) {
  const gatewayHeadingID = createUniqueId();
  const row = createMemo(() => buildGatewaySourceRowModel(props.gateway));
  const foregroundAction = () => props.foregroundAction;
  const setForegroundAction = props.setForegroundAction;
  const [foregroundPendingProgress, setForegroundPendingProgress] = createSignal<DesktopLauncherActionProgress | null>(null);
  const [retainedDiagnosisResult, setRetainedDiagnosisResult] = createSignal<GatewayDiagnosisResultSnapshot | null>(null);
  let foregroundTerminalClearTimer: ReturnType<typeof setTimeout> | null = null;
  let foregroundTerminalClearKey: string | null = null;
  let actionPopoverExitTask: (() => void) | null = null;
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
    props.actionPopoverOpen
    && guidePanelHasState()
    && foregroundCanShowGuidePanel()
    && !hasProgressPanel()
    && visiblePanelModel().execution_mode !== 'direct'
  ));
  const progressPanelVisible = createMemo(() => props.actionPopoverOpen && hasProgressPanel());
  const actionPopoverOpen = createMemo(() => progressPanelVisible() || guidePanelVisible());
  const [environmentsOpen, setEnvironmentsOpen] = createSignal(false);
  const environmentListID = createUniqueId();
  const [directoryHelpOpen, setDirectoryHelpOpen] = createSignal(false);
  const directoryHelpID = createUniqueId();
  const directoryHelpPresence = createFloatingPresence({ open: directoryHelpOpen, exitDurationMs: 160 });
  const PrimaryActionIcon = (iconProps: { class?: string }) => <GatewaySourceActionIcon intent={displayedPrimaryAction().intent} class={iconProps.class} />;
  const catalogReady = createMemo(() => props.gateway.sync_state === 'ready' || (props.gateway.last_synced_at_ms ?? 0) > 0);
  const catalogFailed = createMemo(() => ['gateway_unreachable', 'pairing_failed', 'catalog_failed'].includes(props.gateway.sync_state ?? ''));
  const canManageMembers = createMemo(() => gatewayCanManageMembers(props.gateway) && props.gateway.local_enabled !== false);
  const canAuthorizeManagement = createMemo(() => props.gateway.status === 'online' && props.gateway.trust_state === 'paired'
    && props.gateway.permissions?.manage_members !== true && props.gateway.local_enabled !== false);
  const transportLabel = createMemo(() => props.i18n.t({
    url: 'connectionDialog.gatewayTransportUrl', local_host: 'gatewayAccess.localService',
    local_container: 'connectionDialog.localContainer', ssh_host: 'connectionDialog.gatewayTransportSshHost',
    ssh_container: 'connectionDialog.gatewayTransportSshContainer',
  }[props.gateway.connection_kind] as DesktopTranslationKey));
  const trustLabel = createMemo(() => props.i18n.t({
    paired: 'environmentCenter.gatewayPanelTrustPaired', unpaired: 'environmentCenter.gatewayPanelTrustNotPaired',
    trust_changed: 'environmentCenter.gatewayPanelTrustReviewRequired', revoked: 'environmentCenter.gatewayPanelTrustRevoked',
  }[props.gateway.trust_state ?? 'unpaired'] as DesktopTranslationKey));
  const moreActionsPresence = createFloatingPresence({ open: () => props.moreActionsMenuOpen, exitDurationMs: 160 });
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
    foregroundActionRunning() || primaryBusy()
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
      if (!moreActionsOverlayRef?.contains(document.activeElement)) firstEnabledMenuItem(moreActionsOverlayRef)?.focus();
    });
    const handleMouseDown = (event: MouseEvent) => {
      if (!moreActionsContainsTarget(event.target)) {
        closeMoreActions();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMoreActions();
        moreActionsAnchorRef?.querySelector('button')?.focus();
      } else if (moreActionsContainsTarget(event.target)) {
        if (event.key === 'Tab') {
          moreActionsAnchorRef?.querySelector('button')?.focus();
          closeMoreActions();
          return;
        }
        const items = Array.from(moreActionsOverlayRef?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
        if (!items.length) return;
        const current = items.findIndex(item => item === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowDown' ? (current + 1) % items.length
            : event.key === 'ArrowUp' ? (current + items.length - 1) % items.length : -1;
        if (next >= 0) {
          event.preventDefault();
          items[next].focus();
        }
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
    const ProgressIcon = presentation.icon === 'stop' ? Stop : presentation.icon === 'refresh' ? Refresh : Play;
    return <ProgressIcon class="redeven-split-action-trigger__icon h-3.5 w-3.5" />;
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
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
        return { kind: action.intent, gateway_id: props.gateway.gateway_id };
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
      setEnvironmentsOpen(true);
      return;
    }
    if (action.intent === 'manage_gateway_members') {
      props.onActionPopoverOpenChange(false);
      setForegroundAction(null);
      clearForegroundPendingProgress();
      setEnvironmentsOpen(true);
      props.openGatewayMembers(props.gateway);
      return;
    }
    if (action.intent === 'setup_gateway' || (action.intent === 'pair_gateway' && props.gateway.connection_kind === 'url')) {
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
      setEnvironmentsOpen(true);
      return;
    }
    if (action.intent === 'manage_gateway_members') {
      props.onActionPopoverOpenChange(false);
      setForegroundAction(null);
      clearForegroundPendingProgress();
      setEnvironmentsOpen(true);
      props.openGatewayMembers(props.gateway);
      return;
    }
    if (action.intent === 'setup_gateway' || (action.intent === 'pair_gateway' && props.gateway.connection_kind === 'url')) {
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

  return (
    <section class="redeven-gateway-card" data-gateway-id={props.gateway.gateway_id} aria-labelledby={gatewayHeadingID}>
      <div class="redeven-gateway-card__main">
        <div class="redeven-gateway-card__identity">
          <span class="redeven-gateway-card__mark" aria-hidden="true"><GatewayMark /></span>
          <div class="redeven-gateway-card__identity-text">
            <h2 id={gatewayHeadingID} class="redeven-gateway-card__name" title={row().label}>{row().label}</h2>
            <div class="redeven-gateway-card__connection">
              <span>{transportLabel()}</span>
              <Show when={props.gateway.connection_kind !== 'local_host' && row().endpoint_label}>
                <span class="redeven-gateway-card__endpoint" title={row().endpoint_label}>{row().endpoint_label}</span>
              </Show>
            </div>
          </div>
        </div>
        <div class="redeven-gateway-card__directory">
          <div class="redeven-gateway-card__directory-row">
            <button type="button" class="redeven-gateway-card__directory-link"
              aria-label={props.i18n.t('environmentCenter.viewEnvironments')}
              aria-expanded={environmentsOpen() && row().environment_count > 0} aria-controls={environmentsOpen() && row().environment_count > 0 ? environmentListID : undefined}
              disabled={row().environment_count === 0}
              onClick={() => setEnvironmentsOpen(value => !value)}>
              <span class="redeven-gateway-card__count-label">{props.i18n.t('gatewayAccess.directory')}</span>
              <span class="redeven-gateway-card__count-value">
                <span class="redeven-gateway-card__count">{catalogReady() || row().environment_count > 0 ? props.i18n.tn('plural.environmentCount', row().environment_count) : '—'}</span>
                <Show when={row().environment_count > 0}><ChevronRight class="redeven-gateway-card__disclosure h-3 w-3" /></Show>
              </span>
            </button>
            <button type="button" class="redeven-gateway-card__help"
              aria-label={props.i18n.t('gatewayAccess.directoryHelpLabel')}
              aria-expanded={directoryHelpOpen()} aria-controls={directoryHelpPresence.mounted() ? directoryHelpID : undefined}
              onClick={() => setDirectoryHelpOpen(value => !value)}><HelpIcon class="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <div class="redeven-gateway-card__actions">
          <Show when={props.gateway.connection_kind !== 'url'}><GatewayCloudPanel gatewayID={props.gateway.gateway_id} gatewayName={row().label} i18n={props.i18n} disabled={primaryActionRunning()} /></Show>
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
            allowMainAxisOverflow={false}
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
                  variant={displayedPrimaryAction().intent === 'refresh_gateway' ? 'ghost' : 'default'}
                  class={cn(
                    'redeven-gateway-card__primary-button min-w-0 justify-center',
                    primaryBlocked() && 'redeven-split-action-trigger--blocked',
                  )}
                  icon={PrimaryActionIcon}
                  loading={primaryBusy()}
                  data-floe-progress-shimmer={primaryBusy() ? 'surface' : undefined}
                  disabled={!displayedPrimaryAction().enabled && !primaryBlocked()}
                  aria-disabled={primaryBlocked() ? true : undefined}
                  aria-haspopup={primaryHasGuide() ? 'dialog' : undefined}
                  aria-expanded={primaryHasGuide() ? props.actionPopoverOpen : undefined}
                  onClick={runPrimaryAction}
                >
                  <span>{primaryActionLabel()}</span>
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
                  data-floe-progress-shimmer={presentation().kind === 'progress_trigger' ? 'surface' : undefined}
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
          <div class="redeven-gateway-card__menu">
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
              <Show when={moreActionsPresence.mounted()}>
                <DesktopAnchoredOverlaySurface
                  open={moreActionsPresence.mounted()}
                  positionFrozen={moreActionsPresence.exiting()}
                  anchorRef={moreActionsAnchorRef}
                  placement="top"
                  role="menu"
                  ariaLabel={moreActionsForLabel()}
                  interactive={props.moreActionsMenuOpen}
                  hideArrow
                  class={cn('redeven-split-menu redeven-gateway-menu z-[230] max-w-[min(20rem,calc(100vw-1rem))]', moreActionsPresence.exiting() && 'redeven-gateway-menu--closing')}
                  onOverlayRef={(element) => {
                    moreActionsOverlayRef = element;
                  }}
                >
                  <div role="none" inert={moreActionsPresence.exiting()} aria-hidden={moreActionsPresence.exiting()}>
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
                    <Show when={menuActions().length > 0}><div class="my-1 border-t border-border/60" role="separator" /></Show>
                    <Show when={canManageMembers()}>
                      <button type="button" role="menuitem" class="redeven-split-menu-item" onClick={() => {
                        closeMoreActions();
                        props.openGatewayMembers(props.gateway);
                      }}>
                        <Plus class="h-3.5 w-3.5" />
                        {props.i18n.t('gatewayMembers.invite')}
                      </button>
                    </Show>
                    <button type="button" role="menuitem" class="redeven-split-menu-item" onClick={() => {
                      closeMoreActions(); props.openCreateGatewaySetup(props.gateway, canAuthorizeManagement() ? 'identity_trust' : undefined);
                    }}><Settings class="h-3.5 w-3.5" />{props.i18n.t('environmentCenter.gatewayActionOpenSettings')}</button>
                    <button type="button" role="menuitem" class="redeven-split-menu-item" data-tone="danger" onClick={() => {
                      closeMoreActions(); props.deleteGateway(props.gateway);
                    }}><X class="h-3.5 w-3.5" />{props.i18n.t('environmentCenter.gatewayActionDelete')}</button>
                  </div>
                </DesktopAnchoredOverlaySurface>
              </Show>
            </span>
          </div>
        </div>
      </div>
      <div class="redeven-gateway-card__statusbar">
        <div class="redeven-gateway-card__status-row">
          <EnvironmentStatusIndicator tone={row().status_tone}>
            {localizedGatewaySourceStatusLabel(props.i18n, row().status_label)}
          </EnvironmentStatusIndicator>
          <span class="redeven-gateway-card__trust">{trustLabel()}</span>
        </div>
        <Show when={row().environment_count === 0 || catalogFailed()}>
          <p class="redeven-gateway-card__empty">{props.i18n.t(catalogFailed() ? (row().environment_count > 0 ? 'gatewayAccess.environmentListStale' : 'gatewayAccess.unavailable')
            : !catalogReady() ? 'gatewayAccess.directoryPending' : 'gatewayAccess.directoryEmpty')}</p>
        </Show>
      </div>
      <Show when={directoryHelpPresence.mounted()}>
        <div id={directoryHelpID} class="redeven-gateway-card__explanation" data-state={directoryHelpPresence.state()}
          inert={directoryHelpPresence.exiting()} aria-hidden={directoryHelpPresence.exiting()}>
          <p>{props.i18n.t('gatewayAccess.directoryIntro')}</p>
          <p>{props.i18n.t('gatewayAccess.directoryAccessHint')}</p>
        </div>
      </Show>
      <EnvironmentSettingsReveal open={environmentsOpen() && row().environment_count > 0}>
        <div id={environmentListID} class="redeven-gateway-card__environments">
          <GatewayEnvironmentList i18n={props.i18n} environments={props.gatewayEntries} progress={props.actionProgress} revealProgress={() => props.onActionPopoverOpenChange(true)}
            disabled={primaryActionRunning() || props.gateway.local_enabled === false}
            open={environment => runForegroundRequest({ kind: 'open_gateway_environment',
              environment_id: environment.access_group_id ?? environment.id, gateway_id: props.gateway.gateway_id,
              gateway_env_id: environment.gateway_env_id ?? '', label: environment.label })} />
        </div>
      </EnvironmentSettingsReveal>
    </section>
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
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

function gatewaySourceLauncherActionKind(
  action: GatewaySourceActionModel,
): Extract<DesktopLauncherActionKind, 'open_gateway_environment' | 'refresh_gateway' | 'set_gateway_enabled' | 'start_gateway' | 'stop_gateway' | 'restart_gateway' | 'update_gateway'> | null {
  switch (action.intent) {
    case 'open_gateway_environment':
      return 'open_gateway_environment';
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
      return action.intent;
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
    case 'manage_gateway_members':
      return <Plus class={iconClass()} />;
    case 'view_gateway_environments':
      return <ChevronRight class={iconClass()} />;
    case 'enable_gateway':
      return <Check class={iconClass()} />;
    case 'disable_gateway':
      return <GatewayDisabledIcon class={iconClass()} />;
    case 'start_gateway': return <Play class={iconClass()} />;
    case 'stop_gateway': return <Stop class={iconClass()} />;
    case 'restart_gateway':
    case 'update_gateway':
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


const CONNECTION_DIALOG_CLASS = cn(
  WELCOME_DIALOG_PANEL_CLASS,
  'redeven-welcome-dialog-panel--connection',
);

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
            <div class="text-[length:var(--floe-type-body)] font-semibold text-foreground">
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

export function EnvironmentAccessSettingsForm(props: Readonly<{
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
  applyAccessFixedPort: (port: string) => void;
  toggleAutoPort: (enabled: boolean) => void;
  saveSettings: (options?: Readonly<{ restartRuntime?: boolean; continueTwoFactor?: boolean }>) => Promise<void>;
  saveIntent?: 'save' | 'restart';
  connectionDirty?: boolean;
  showConnectionSettings?: () => void;
  focusTwoFactor?: boolean;
  focusAccess?: AddressRecoveryTarget;
  runtimeRestartAvailable: boolean;
  runtimeRunning: boolean;
  runtimeStatusLabel: string;
  runtimeStatusTone: EnvironmentCardTone;
  dark: boolean;
  certificate?: (request: DesktopCertificateRequest) => Promise<DesktopCertificateReport>;
  security?: (request: SecurityRequest) => Promise<SecurityResult>;
  resetAccess?: () => void;
  desktopOpenLabel: string;
  openInDesktop: () => void;
  openInBrowser: (url: string) => Promise<void>;
  copyEnvironmentValue: (value: string, label: string) => Promise<void>;
  cancelSettings: () => void;
  clearStoredLocalUIPassword: () => void;
}>) {

  const [sharedAddress, setSharedAddress] = createSignal<{ environment_id: string; id: string } | null>(null);
  const connectionRows = createMemo(() => buildRuntimeConnectionRows({
    context: props.snapshot.runtime_connection, urls: props.snapshot.current_runtime_urls, health: props.snapshot.runtime_health,
  }));
  const selectedShareAddress = createMemo(() => sharedAddress()?.environment_id === props.snapshot.environment_id
    ? connectionRows().filter(isShareableConnectionAddress).find(row => row.id === sharedAddress()?.id) : undefined);
  createEffect(() => { if (!props.open || (sharedAddress() && !selectedShareAddress())) setSharedAddress(null); });
  const saving = () => busyStateMatchesAction(props.busyState, 'save_settings');
  return <EnvironmentAccessWorkflow {...props} connection={configureAddress => (
        <section aria-label={props.i18n.t('settings.currentConnection')} class="environment-access-overview">
          <div class="environment-access-overview-header">
            <div class="environment-access-overview-heading">
              <h3>{props.i18n.t('settings.currentConnection')}</h3>
              <span class="environment-access-status" role="status" data-status-tone={props.runtimeStatusTone}>
                <span class="relative flex h-5 w-5 items-center justify-center" aria-hidden="true">
                  <RuntimeStatusOrb running={props.runtimeRunning} dark={props.dark} />
                </span>
                {props.runtimeStatusLabel}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={props.openInDesktop} disabled={saving()}>
              {props.desktopOpenLabel}<ChevronRight class="ml-1 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
          <div class="redeven-settings-connections redeven-settings-connections--summary">
            <EnvironmentConnectionRows environmentID={props.snapshot.environment_id} rows={connectionRows()} i18n={props.i18n}
              presentation="settings-summary" configureAddress={configureAddress}
              selectedID={selectedShareAddress()?.id}
              selectForShare={(id) => setSharedAddress(id ? { environment_id: props.snapshot.environment_id, id } : null)}
              openInBrowser={props.openInBrowser} copyEnvironmentValue={props.copyEnvironmentValue} />
          </div>
          <Show when={selectedShareAddress()}>{(address) => (
            <EndpointQRCodePanel i18n={props.i18n} endpoint={address()} copyEnvironmentValue={props.copyEnvironmentValue} />
          )}</Show>
        </section>
  )} />;
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
      class="environment-container-picker space-y-1.5"
      onFocusOut={(event) => {
        if (containsTarget(event.relatedTarget)) {
          return;
        }
        closeMenuSoon();
      }}
    >
      <div class="environment-container-picker-heading flex items-center justify-between gap-2">
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
          icon={Refresh}
        >
          {props.i18n.t('connectionDialog.refreshContainers')}
        </Button>
      </div>
      <div class="environment-container-picker-control relative">
        <button
          ref={buttonRef}
          id="environment-container-picker"
          data-floe-input-surface
          aria-invalid={Boolean(props.fieldError) || undefined}
          type="button"
          class={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-[length:var(--floe-type-control)] leading-[var(--floe-line-control)] transition-colors',
            props.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-ring',
            props.fieldError && 'border-destructive',
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

type ConnectionDialogProps = Readonly<{
  joinGateway?: boolean; setJoinGateway?: (value: boolean) => void;
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
  onOpenChange: (open: boolean) => void;
  updateField: (
    name: 'label' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'auth_mode' | 'ssh_password' | 'runtime_root' | 'release_base_url' | 'connect_timeout_seconds' | 'container_engine' | 'container_id' | 'container_ref' | 'container_label',
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
  saveBlocked?: boolean;
}>;

function ConnectionDialog(props: ConnectionDialogProps) {
  const isOpen = createMemo(() => props.state !== null);
  const connectionKind = createMemo(() => props.state?.connection_kind ?? 'external_local_ui');
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

  const kindPicker = () => (
        <Show when={props.state?.mode === 'create'}>
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
              ]}
              size="sm"
            />
            <div class="rounded-md border border-dashed border-border/40 bg-muted/10 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              {connectionKindDescription()}
            </div>
            <Show when={connectionKind() !== 'external_local_ui'}>
              <fieldset class="space-y-2 rounded-md border border-border p-3 text-sm">
                <legend class="px-1 text-xs font-medium">{props.i18n.t('gatewayJoin.title')}</legend>
                <label class="flex cursor-pointer items-center gap-2"><input class="cursor-pointer" type="radio" name="new-runtime-gateway" checked={!props.joinGateway} onChange={() => props.setJoinGateway?.(false)} />{props.i18n.t('gatewayJoin.notNow')}</label>
                <label class="flex cursor-pointer items-center gap-2"><input class="cursor-pointer" type="radio" name="new-runtime-gateway" checked={props.joinGateway === true} onChange={() => props.setJoinGateway?.(true)} />{props.i18n.t('gatewayJoin.joinGateway')}</label>
                <Show when={props.joinGateway}><p class="text-xs text-muted-foreground">{props.i18n.t('gatewayJoin.setupHelp')}</p></Show>
              </fieldset>
            </Show>
          </div>
        </Show>

  );
  return <Dialog open={isOpen()} onOpenChange={props.onOpenChange}
    title={props.i18n.t('connectionDialog.newEnvironmentTitle')}
    class={CONNECTION_DIALOG_CLASS}
    contentClass="environment-settings-content" closeLabel={props.i18n.t('common.close')} escapeKeyPhase="bubble">
    <Show when={props.state?.connection_kind === 'ssh_environment'} fallback={<ConnectionDialogForm {...props} beforeFields={kindPicker()} />}>
      <SSHEnvironmentSettingsForm open={isOpen()} i18n={props.i18n}
        state={props.state as SSHConnectionDialogState} baseline={props.state as SSHConnectionDialogState}
        beforeFields={kindPicker()} sshConfigHosts={props.sshConfigHosts} sshConfigHostsLoading={props.sshConfigHostsLoading}
        sshConfigHostsLoadError={props.sshConfigHostsLoadError} refreshSSHConfigHosts={props.refreshSSHConfigHosts}
        fieldErrors={props.fieldErrors} error={props.error} saving={busyStateMatchesAction(props.busyState, 'upsert_environment_registration')}
        updateField={props.updateField} toggleAutoRuntimeProbe={props.toggleAutoRuntimeProbe}
        switchBootstrapStrategy={props.switchBootstrapStrategy} removeSSHPassword={props.removeSSHPassword}
        onClose={() => props.onOpenChange(false)} onSave={props.onSave} />
    </Show>
  </Dialog>;
}

function ConnectionDialogForm(props: ConnectionDialogProps & { beforeFields?: JSX.Element }) {
  const connectionKind = createMemo(() => props.state?.connection_kind ?? 'external_local_ui');
  const isSSHBackedKind = createMemo(() => connectionKind() === 'ssh_container_runtime');
  const isContainerKind = createMemo(() => connectionKind() === 'local_container_runtime' || connectionKind() === 'ssh_container_runtime');
  return (
    <EnvironmentSettingsPanel
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {props.i18n.t('common.cancel')}
          </Button>

          <Button
            size="sm"
            variant="default"
            disabled={props.saveBlocked}
            loading={busyStateMatchesAction(props.busyState, 'save_environment') || busyStateMatchesAction(props.busyState, 'upsert_environment_registration')}
            onClick={() => {
              void props.onSave();
            }}
            icon={Save}
          >
            {props.i18n.t('connectionDialog.save')}
          </Button>
        </div>
      )}
    >
      <div class="environment-connection-form" inert={busyStateMatchesAction(props.busyState, 'save_environment') || busyStateMatchesAction(props.busyState, 'upsert_environment_registration')}>
        {props.beforeFields}

        <div class="environment-connection-field environment-connection-group">
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
            aria-invalid={Boolean(props.fieldErrors.label) || undefined}
            class={cn('w-full', props.fieldErrors.label && 'border-destructive')}
          />
          <Show when={props.fieldErrors.label}>
            <div class="text-[11px] text-destructive">{props.fieldErrors.label}</div>
          </Show>
        </div>


        <Show when={connectionKind() === 'external_local_ui'}>
          <div class="redeven-dialog-section">
            <div class="environment-connection-section-title">
              {props.i18n.t('connectionDialog.connectionUrl')}
            </div>
            <div class="environment-connection-group">
              <div class="environment-connection-field">
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
                  aria-invalid={Boolean(props.fieldErrors.external_local_ui_url) || undefined}
                  class={cn('w-full', props.fieldErrors.external_local_ui_url && 'border-destructive')}
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
            <div class="environment-connection-section-title">
              {props.i18n.t('connectionDialog.sshHostSection')}
            </div>
            <div class="environment-connection-group">
              <div class="rounded-md border border-dashed border-border/40 bg-muted/10 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                {props.i18n.t('connectionDialog.sshContainerNotice')}
              </div>
              <div class="mt-3 space-y-3">
                <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
                <div class="environment-connection-field">
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
                <div class="environment-connection-field">
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
                    aria-invalid={Boolean(props.fieldErrors.ssh_port) || undefined}
                    class={cn('w-full', props.fieldErrors.ssh_port && 'border-destructive')}
                  />
                  <Show when={props.fieldErrors.ssh_port}>
                    <div class="text-[11px] text-destructive">{props.fieldErrors.ssh_port}</div>
                  </Show>
                </div>
              </div>
              <div class="environment-connection-field">
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
                <div class="environment-connection-field">
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
              </div>
            </div>
          </div>
        </Show>

        <Show when={isContainerKind()}>
          <div class="redeven-dialog-section">
            <div class="environment-connection-section-title">
              {props.i18n.t('connectionDialog.container')}
            </div>
            <div class="environment-connection-group">
              <div class="space-y-3">
                <div class="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)] items-start">
                  <div class="environment-connection-field">
                    <label class="block text-xs font-medium text-foreground">{props.i18n.t('connectionDialog.engine')}</label>
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
                <div class="environment-connection-field">
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
                  aria-invalid={Boolean(props.fieldErrors.runtime_root) || undefined}
                  class={cn('w-full', props.fieldErrors.runtime_root && 'border-destructive')}
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
            <div class="environment-connection-section-title">
              {props.i18n.t('connectionDialog.statusDetection')}
            </div>
            <div class="environment-connection-group">
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



        <Show when={props.error}>
          <div role="alert" class="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {props.error}
          </div>
        </Show>
      </div>
    </EnvironmentSettingsPanel>
  );
}

function GatewayActionRecoveryNotice(props: Readonly<{
  i18n: DesktopI18n; recovery: GatewayActionRecovery; busy: boolean; onStart: () => void;
}>) {
  return <div role="status" class="space-y-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
    <p>{props.recovery.message}</p>
    <Show when={props.recovery.start_action}>
      <Button size="sm" variant="outline" disabled={props.busy} loading={props.busy} onClick={props.onStart}>
        {props.i18n.t('environmentCenter.gatewayActionStart')}
      </Button>
    </Show>
  </div>;
}

function GatewaySetupDialog(props: Readonly<{
  nativeHostSupported: boolean;
  i18n: DesktopI18n;
  state: GatewaySetupDialogState | null;
  sshConfigHosts: readonly DesktopSSHConfigHost[];
  sshConfigHostsLoading: boolean;
  sshConfigHostsLoadError: boolean;
  containerOptions: readonly DesktopRuntimeContainerOption[];
  containerOptionsLoading: boolean;
  containerOptionsError: string;
  error: string;
  technicalDetail: string;
  recovery: GatewayActionRecovery | null;
  onStart: () => void;
  fieldErrors: Partial<Record<string, string>>;
  busyState: DesktopLauncherBusyState;
  onOpenChange: (open: boolean) => void;
  updateField: (name: keyof GatewaySetupDialogState, value: string | boolean | GatewayPermissions) => void;
  refreshContainerOptions: () => void;
  refreshSSHConfigHosts: () => void;
  clearFieldErrors: () => void;
  removeSSHPassword: () => void;
  onSave: () => Promise<void>;
}>) {
  const isOpen = createMemo(() => props.state !== null);
  const connectionKind = createMemo(() => props.state?.connection_kind ?? 'url');
  const isSSHBacked = createMemo(() => connectionKind() === 'ssh_host' || connectionKind() === 'ssh_container');
  const [advancedState, setAdvancedState] = createSignal<{ open: boolean; initialized_for_state_key: string }>({
    open: false,
    initialized_for_state_key: 'closed',
  });
  const showSSHAdvanced = createMemo(() => isSSHBacked() && advancedState().open);
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
      title={props.i18n.t(props.state?.mode === 'edit' ? 'environmentCenter.gatewayActionEditSettings' : 'connectionDialog.addGatewayTitle')}
      class={cn(CONNECTION_DIALOG_CLASS, 'redeven-gateway-dialog')}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {props.i18n.t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={busyStateMatchesAction(props.busyState, 'upsert_gateway')}
            disabled={props.busyState.action !== IDLE_LAUNCHER_BUSY_STATE.action}
            onClick={() => {
              void props.onSave();
            }}
            icon={Save}
          >
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
          <div class="flex flex-wrap gap-2" role="group" aria-label={props.i18n.t('connectionDialog.gatewayTransport')}>
            <For each={[
              { kind: 'url', key: 'connectionDialog.gatewayTransportUrl' },
              ...(props.nativeHostSupported ? [{ kind: 'local_host', key: 'gatewayAccess.localService' }] : []),
              { kind: 'ssh_host', key: 'connectionDialog.gatewayTransportSshHost' },
              { kind: 'local_container', key: 'connectionDialog.localContainer' },
              { kind: 'ssh_container', key: 'connectionDialog.gatewayTransportSshContainer' },
            ] as readonly { kind: DesktopGatewayConnectionKind; key: DesktopTranslationKey }[]}>
              {option => <Button size="sm" variant={connectionKind() === option.kind ? 'default' : 'outline'}
                aria-pressed={connectionKind() === option.kind} disabled={props.state?.mode === 'edit'}
                onClick={() => props.updateField('connection_kind', option.kind)}>{props.i18n.t(option.key)}</Button>}
            </For>
          </div>
          <div class="rounded-md border border-dashed border-border/40 bg-muted/10 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            {props.i18n.t(connectionKind() === 'url' ? 'connectionDialog.gatewayUrlHelp' : 'gatewayAccess.managedServiceHelp')}
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
                  aria-invalid={Boolean(props.fieldErrors.gateway_url) || undefined}
                  class={cn('w-full', props.fieldErrors.gateway_url && 'border-destructive')}
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
                  aria-invalid={Boolean(props.fieldErrors.pairing_code) || undefined}
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
                <div class={cn('text-[11px] leading-5', props.fieldErrors.pairing_code ? 'text-destructive' : 'text-muted-foreground')}>
                  {props.i18n.t('connectionDialog.gatewayPairingCodeHelp')}
                </div>
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
                    inputID="gateway-ssh-destination"
                    value={props.state?.ssh_destination ?? ''}
                    hosts={props.sshConfigHosts}
                    loading={props.sshConfigHostsLoading}
                    loadError={props.sshConfigHostsLoadError}
                    autofocus={connectionKind() !== 'url' && props.state?.mode === 'create'}
                    class={props.fieldErrors.ssh_destination && 'border-destructive'}
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
                    aria-invalid={Boolean(props.fieldErrors.ssh_port) || undefined}
                    class={cn('w-full', props.fieldErrors.ssh_port && 'border-destructive')}
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
                      {props.i18n.t('connectionDialog.gatewayDataRoot')} · {props.i18n.t('connectionDialog.connectTimeout')}
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
                            aria-invalid={Boolean(props.fieldErrors.runtime_root) || undefined}
                            class={cn('w-full', props.fieldErrors.runtime_root && 'border-destructive')}
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

        <Show when={connectionKind() === 'local_container' || connectionKind() === 'ssh_container'}>
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
                  disabled={connectionKind() === 'ssh_container' && trimString(props.state?.ssh_destination) === ''}
                  error={props.containerOptionsError}
                  emptyMessage={connectionKind() === 'ssh_container' && trimString(props.state?.ssh_destination) === ''
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

        <Show when={connectionKind() === 'local_host' || connectionKind() === 'local_container'}>
          <div class="space-y-1.5">
            <label for="gateway-data-root" class="block text-xs font-medium">{props.i18n.t('connectionDialog.gatewayDataRoot')}</label>
            <Input id="gateway-data-root" value={props.state?.runtime_root ?? ''} size="sm"
              placeholder={DEFAULT_DESKTOP_SSH_RUNTIME_ROOT_LABEL} spellcheck={false}
              onInput={event => props.updateField('runtime_root', event.currentTarget.value)} />
            <p class="text-[11px] text-muted-foreground">{props.i18n.t('connectionDialog.gatewayRuntimeRootHelp', { root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT_LABEL })}</p>
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
            aria-invalid={Boolean(props.fieldErrors.display_name) || undefined}
            class={cn('w-full', props.fieldErrors.display_name && 'border-destructive')}
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

        <GatewayPermissionsEditor i18n={props.i18n} value={props.state?.permissions ?? { access: true, manage_members: false, configure_cloud: false }}
          disabled={props.busyState.action !== IDLE_LAUNCHER_BUSY_STATE.action}
          onChange={permissions => props.updateField('permissions', permissions)} />
        <Show when={props.recovery}>
          {recovery => <GatewayActionRecoveryNotice i18n={props.i18n} recovery={recovery()}
            busy={props.busyState.action !== IDLE_LAUNCHER_BUSY_STATE.action} onStart={props.onStart} />}
        </Show>
        <Show when={props.error && !props.recovery}>
          <div role="alert" class="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {props.error}
          </div>
        </Show>
        <Show when={props.technicalDetail && props.technicalDetail !== props.error}>
          <details class="text-xs">
            <summary class="cursor-pointer">{props.i18n.t('progress.technicalErrorDetails')}</summary>
            <pre class="mt-2 whitespace-pre-wrap break-words">{props.technicalDetail}</pre>
          </details>
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
          data-floe-input-surface
          type="button"
          class="group flex min-h-16 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-transparent bg-muted/40 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/70"
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
              <span class="block truncate text-[length:var(--floe-type-body)] font-semibold tracking-normal text-foreground">{selectedProvider()?.domain ?? ''}</span>
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
                          <span class="block truncate text-[length:var(--floe-type-body)] font-semibold">{option.domain}</span>
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
