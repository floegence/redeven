import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Motion, Presence } from 'solid-motionone';
import { cn, FloeProvider, useCommand, useTheme } from '@floegence/floe-webapp-core';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  Globe,
  Lock,
  Moon,
  Pin,
  Play,
  Plus,
  Refresh,
  Save,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Stop,
  Sun,
  Terminal,
  Trash,
} from '@floegence/floe-webapp-core/icons';
import { BottomBarItem, StatusIndicator, TopBarIconButton } from '@floegence/floe-webapp-core/layout';
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

import type {
  DesktopAccessMode,
  DesktopSettingsSurfaceSnapshot,
} from '../shared/desktopSettingsSurface';
import type {
  DesktopEnvironmentEntry,
  DesktopLauncherActionProgress,
  DesktopLauncherActionResult,
  DesktopLauncherActionRequest,
  DesktopLauncherSurface,
  DesktopLocalEnvironmentStateRoute,
  DesktopWelcomeIssue,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import {
  isDesktopLauncherActionFailure,
  isDesktopLauncherActionSuccess,
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
  type SaveDesktopSettingsResult,
} from '../shared/settingsIPC';
import {
  formatRuntimeServiceWorkload,
  runtimeServiceHasActiveWork,
  runtimeServiceIsOpenable,
  runtimeServiceProviderLinkMatches,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';
import { desktopEntryKindOwnsRuntimeManagement } from '../shared/environmentManagementPrinciples';
import {
  DEFAULT_DESKTOP_SSH_AUTH_MODE,
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
  DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR_LABEL,
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL,
  type DesktopSSHAuthMode,
  type DesktopSSHBootstrapStrategy,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import type { DesktopSSHConfigHost } from '../shared/desktopSSHConfig';
import {
  applyDesktopAccessAutoPortToDraft,
  applyDesktopAccessFixedPortToDraft,
  applyDesktopAccessModeToDraft,
  deriveDesktopAccessDraftModel,
} from '../shared/desktopAccessModel';
import {
  buildEnvironmentLibraryLayoutModel,
  buildDesktopWelcomeShellViewModel,
  buildEnvironmentCardModel,
  buildEnvironmentCardEndpointsModel,
  buildEnvironmentCardFactsModel,
  buildControlPlaneStatusModel,
  buildProviderBackedEnvironmentActionModel,
  capabilityUnavailableMessage,
  environmentLibraryCount,
  environmentProviderFilterValue,
  filterEnvironmentLibrary,
  LOCAL_ENVIRONMENT_LIBRARY_FILTER,
  PROVIDER_ENVIRONMENT_LIBRARY_FILTER,
  SSH_ENVIRONMENT_LIBRARY_FILTER,
  URL_ENVIRONMENT_LIBRARY_FILTER,
  type EnvironmentActionIntent,
  type EnvironmentActionModel,
  type EnvironmentActionMenuItemModel,
  type EnvironmentCardEndpointModel,
  type EnvironmentCardFactModel,
  type EnvironmentActionPresentation,
  type EnvironmentCenterTab,
  type EnvironmentPrimaryActionOverlayModel,
  shouldUseSpaciousEnvironmentGrid,
  shellStatus,
} from './viewModel';
import {
  launcherActionFailurePresentation,
} from './launcherActionFeedback';
import {
  syncSSHConnectionDialogAdvancedState,
  type SSHConnectionDialogAdvancedState,
} from './sshConnectionDialogState';
import {
  createDesktopSettingsDraftSession,
  reconcileDesktopSettingsDraftSession,
  updateDesktopSettingsDraftSessionDraft,
} from './settingsDraftSession';
import {
  compactPasswordStateTagLabel,
  compactSaveActionLabel,
  compactSettingsFieldLabel,
  describeNextStartAddress,
  describeRuntimeAddress,
  isRedundantSettingsFieldLabel,
  plainTextFromHelpHTML,
} from './welcomeCopy';
import {
  createDesktopThemeStorageAdapter,
  desktopStateStorageBridge,
  desktopThemeBridge,
  toggleDesktopTheme,
} from './desktopTheme';
import { DesktopTooltip } from './DesktopTooltip';
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
  busyStateForLauncherRequest,
  busyStateWithActionProgress,
  activeProgressForEnvironment,
  busyStateMatchesAction,
  busyStateMatchesAnyAction,
  busyStateMatchesControlPlane,
  busyStateMatchesEnvironment,
  environmentMatchesActionProgress,
  IDLE_LAUNCHER_BUSY_STATE,
  type DesktopLauncherBusyState,
} from './launcherBusyState';

type DesktopLauncherBridge = Readonly<{
  getSnapshot: () => Promise<DesktopWelcomeSnapshot>;
  getSSHConfigHosts?: () => Promise<readonly DesktopSSHConfigHost[]>;
  performAction: (request: DesktopLauncherActionRequest) => Promise<DesktopLauncherActionResult>;
  subscribeActionProgress?: (listener: (progress: DesktopLauncherActionProgress) => void) => (() => void);
  subscribeSnapshot: (listener: (snapshot: DesktopWelcomeSnapshot) => void) => (() => void);
}>;

type DesktopSettingsBridge = Readonly<{
  save: (draft: DesktopSettingsDraft) => Promise<SaveDesktopSettingsResult>;
  cancel: () => void;
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
}>;

type SSHConnectionDialogState = Readonly<{
  mode: 'create' | 'edit';
  connection_kind: 'ssh_environment';
  environment_id: string;
  label: string;
  ssh_destination: string;
  ssh_port: string;
  auth_mode: DesktopSSHAuthMode;
  remote_install_dir: string;
  bootstrap_strategy: DesktopSSHBootstrapStrategy;
  release_base_url: string;
  connect_timeout_seconds: string;
}>;

type ConnectionDialogState = ExternalURLConnectionDialogState | SSHConnectionDialogState | null;

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
  message: string;
  tone: 'error' | 'warning';
}>;

type RuntimeMaintenanceConfirmationAction = 'stop' | 'restart' | 'update';

type RuntimeMaintenanceConfirmationState = Readonly<{
  environment: DesktopEnvironmentEntry;
  action: RuntimeMaintenanceConfirmationAction;
}>;

type ProviderRuntimeLinkConfirmationAction = 'connect' | 'disconnect';

type ProviderRuntimeLinkConfirmationState = Readonly<{
  environment: DesktopEnvironmentEntry;
  action: ProviderRuntimeLinkConfirmationAction;
  provider_environment_id?: string;
}>;

const DESKTOP_FLOE_STORAGE_NAMESPACE = 'redeven-desktop-shell';
const DESKTOP_FLOE_THEME_STORAGE_KEY = 'theme';
const DESKTOP_SKIP_LINK_LABEL = 'Skip to Redeven Desktop content';
const DESKTOP_TOP_BAR_LABEL = 'Redeven Desktop toolbar';
const DESKTOP_COMMAND_PLACEHOLDER = 'Search desktop commands...';
const ACTION_TOAST_TTL_MS = 4_000;
const GUIDANCE_SUCCESS_DISMISS_MS = 720;
const GUIDANCE_SESSION_CLEAR_MS = 220;

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

function buildDesktopFloeConfig() {
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
      skipLinkLabel: DESKTOP_SKIP_LINK_LABEL,
      topBarLabel: DESKTOP_TOP_BAR_LABEL,
      primaryNavigationLabel: 'Redeven Desktop navigation',
      mobileNavigationLabel: 'Redeven Desktop navigation',
      sidebarLabel: 'Redeven Desktop sidebar',
      mainLabel: 'Redeven Desktop content',
    },
    strings: {
      topBar: {
        searchPlaceholder: DESKTOP_COMMAND_PLACEHOLDER,
      },
    },
  } as const;
}

const ENVIRONMENT_CENTER_TABS: readonly Readonly<{ value: EnvironmentCenterTab; label: string }>[] = [
  { value: 'environments', label: 'Environments' },
  { value: 'control_planes', label: 'Providers' },
];

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function desktopWelcomeSnapshotRevision(snapshot: DesktopWelcomeSnapshot): number {
  const revision = Number(snapshot.snapshot_revision);
  return Number.isFinite(revision) && revision > 0 ? revision : 0;
}

function nextDesktopWelcomeSnapshot(
  current: DesktopWelcomeSnapshot,
  next: DesktopWelcomeSnapshot,
): DesktopWelcomeSnapshot {
  const currentRevision = desktopWelcomeSnapshotRevision(current);
  const nextRevision = desktopWelcomeSnapshotRevision(next);
  if (currentRevision > 0 && nextRevision > 0 && nextRevision < currentRevision) {
    return current;
  }
  return next;
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
  return trimString(error);
}

function formatIssueToastMessage(issue: DesktopWelcomeIssue): string {
  const message = trimString(issue.message);
  const title = trimString(issue.title);
  if (message === '') {
    return title;
  }
  return title !== '' && message !== title ? `${title}: ${message}` : message;
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

function formatRelativeTimestamp(unixMS: number): string {
  if (!Number.isFinite(unixMS) || unixMS <= 0) {
    return 'Never';
  }
  try {
    const diff = Math.max(0, Date.now() - unixMS);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  } catch {
    return formatTimestamp(unixMS) || 'Unknown';
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
  };
}

function createSSHConnectionDialogState(
  mode: 'create' | 'edit',
  overrides: Partial<SSHConnectionDialogState> = {},
): SSHConnectionDialogState {
  return {
    mode,
    connection_kind: 'ssh_environment',
    environment_id: trimString(overrides.environment_id),
    label: trimString(overrides.label),
    ssh_destination: trimString(overrides.ssh_destination),
    ssh_port: trimString(overrides.ssh_port),
    auth_mode: (trimString(overrides.auth_mode) as DesktopSSHAuthMode) || DEFAULT_DESKTOP_SSH_AUTH_MODE,
    remote_install_dir: trimString(overrides.remote_install_dir),
    bootstrap_strategy: (trimString(overrides.bootstrap_strategy) as DesktopSSHBootstrapStrategy) || DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
    release_base_url: trimString(overrides.release_base_url),
    connect_timeout_seconds: trimString(overrides.connect_timeout_seconds),
  };
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
  if (!candidate || typeof candidate.save !== 'function' || typeof candidate.cancel !== 'function') {
    return null;
  }
  return candidate;
}

function DesktopCommandRegistrar(props: Readonly<{
  snapshot: () => DesktopWelcomeSnapshot;
  showConnectEnvironment: (message?: string) => void;
  openCreateConnectionDialog: (message?: string, preferredKind?: 'external_local_ui' | 'ssh_environment') => void;
  openSettingsSurface: (environmentID?: string) => void;
  openLocalEnvironment: () => Promise<void>;
  openEnvironment: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog',
  ) => Promise<boolean>;
  closeLauncherOrQuit: () => Promise<void>;
}>): null {
  const cmd = useCommand();
  const theme = useTheme();
  const shellTheme = desktopThemeBridge();

  createEffect(() => {
    const snapshot = props.snapshot();
    const list = [
      {
        id: 'redeven.desktop.connectEnvironment',
        title: 'Connect Environment',
        description: 'Show the desktop connection center',
        category: 'Desktop',
        keybind: 'mod+shift+o',
        icon: Globe,
        execute: () => props.showConnectEnvironment(),
      },
      {
        id: 'redeven.desktop.openLocalEnvironment',
        title: 'Open Environment',
        description: 'Open the selected Local Environment window',
        category: 'Desktop',
        keybind: 'mod+enter',
        icon: Globe,
        execute: () => {
          void props.openLocalEnvironment();
        },
      },
      {
        id: 'redeven.desktop.openLocalEnvironmentSettings',
        title: 'Environment Settings',
        description: 'Edit startup, access, and exposure settings for the Local Environment',
        category: 'Desktop',
        keybind: 'mod+,',
        icon: Settings,
        execute: () => props.openSettingsSurface(),
      },
      {
        id: 'redeven.desktop.focusEnvironmentURL',
        title: 'Connect Another Environment',
        description: 'Open the New Environment dialog for a Redeven URL or SSH host',
        category: 'Desktop',
        icon: Search,
        execute: () => props.openCreateConnectionDialog('Enter a Redeven URL or add an SSH host.'),
      },
      {
        id: 'redeven.desktop.closeLauncherOrQuit',
        title: snapshot.close_action_label,
        description: snapshot.close_action_label === 'Quit'
          ? 'Quit Redeven Desktop'
          : 'Close the launcher window',
        category: 'Desktop',
        icon: Globe,
        execute: () => {
          void props.closeLauncherOrQuit();
        },
      },
      {
        id: 'redeven.desktop.toggleTheme',
        title: 'Toggle Theme',
        description: 'Switch between light and dark theme',
        category: 'General',
        icon: theme.resolvedTheme() === 'light' ? Moon : Sun,
        execute: () => toggleDesktopTheme(theme.resolvedTheme(), shellTheme, () => theme.toggleTheme()),
      },
      {
        id: 'redeven.desktop.openCommandPalette',
        title: 'Open Command Palette',
        description: 'Open the command palette',
        category: 'General',
        keybind: 'mod+k',
        icon: Search,
        execute: () => cmd.open(),
      },
    ];

    for (const environment of snapshot.environments.slice(0, 5)) {
      list.push({
        id: `redeven.desktop.openEnvironment.${environment.id}`,
        title: `${environment.open_action_label} ${environment.label}`,
        description: environment.secondary_text,
        category: 'Recent Environments',
        icon: Globe,
        execute: () => {
          void props.openEnvironment(environment, 'connect');
        },
      });
    }

    if (snapshot.surface === 'connect_environment') {
      list.push({
        id: 'redeven.desktop.openDeck',
        title: 'Open Deck',
        description: capabilityUnavailableMessage('Deck'),
        category: 'Unavailable',
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
  const [snapshot, setSnapshot] = createSignal(props.snapshot);
  const [actionToasts, setActionToasts] = createSignal<readonly DesktopActionToast[]>([]);
  const [settingsError, setSettingsError] = createSignal('');
  const [connectionDialogError, setConnectionDialogError] = createSignal('');
  const [connectionDialogFieldErrors, setConnectionDialogFieldErrors] = createSignal<Partial<Record<string, string>>>({});
  const [controlPlaneDialogError, setControlPlaneDialogError] = createSignal('');
  const [busyState, setBusyState] = createSignal<DesktopLauncherBusyState>(IDLE_LAUNCHER_BUSY_STATE);
  const [settingsDraftSession, setSettingsDraftSession] = createSignal(createDesktopSettingsDraftSession(props.snapshot.settings_surface));
  const [connectionDialogState, setConnectionDialogState] = createSignal<ConnectionDialogState>(null);
  const [sshConfigHosts, setSSHConfigHosts] = createSignal<readonly DesktopSSHConfigHost[]>([]);
  const [sshConfigHostsLoaded, setSSHConfigHostsLoaded] = createSignal(false);
  const [controlPlaneDialogState, setControlPlaneDialogState] = createSignal<ControlPlaneDialogState>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<DesktopEnvironmentEntry | null>(null);
  const [runtimeMaintenanceConfirmation, setRuntimeMaintenanceConfirmation] = createSignal<RuntimeMaintenanceConfirmationState | null>(null);
  const [providerRuntimeLinkConfirmation, setProviderRuntimeLinkConfirmation] = createSignal<ProviderRuntimeLinkConfirmationState | null>(null);
  const [deleteControlPlaneTarget, setDeleteControlPlaneTarget] = createSignal<DesktopControlPlaneSummary | null>(null);
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
  const [activeCenterTab, setActiveCenterTab] = createSignal<EnvironmentCenterTab>('environments');
  const [environmentFailures, setEnvironmentFailures] = createSignal<ReadonlyMap<string, EnvironmentFailureState>>(new Map());
  const actionToastTimers = new Map<number, number>();
  let nextActionToastID = 0;
  let settingsErrorRef: HTMLElement | undefined;
  let sshConfigHostsLoading = false;

  const visibleSurface = createMemo<DesktopLauncherSurface>(() => snapshot().surface);
  const status = createMemo(() => shellStatus(snapshot()));
  const shellView = createMemo(() => buildDesktopWelcomeShellViewModel(snapshot(), visibleSurface()));
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
    if (environmentLibraryCount(snapshot(), '', URL_ENVIRONMENT_LIBRARY_FILTER) > 0) {
      next.add(URL_ENVIRONMENT_LIBRARY_FILTER);
    }
    if (environmentLibraryCount(snapshot(), '', SSH_ENVIRONMENT_LIBRARY_FILTER) > 0) {
      next.add(SSH_ENVIRONMENT_LIBRARY_FILTER);
    }
    for (const controlPlane of controlPlanes()) {
      next.add(controlPlaneFilterValue(controlPlane));
    }
    return next;
  });
  const openWindowsSubtitle = createMemo(() => {
    const openWindows = snapshot().open_windows;
    if (openWindows.length <= 0) {
      return 'No environment windows open';
    }
    if (openWindows.length === 1) {
      return `${openWindows[0]!.label} · ${openWindows[0]!.local_ui_url}`;
    }
    return `${openWindows.length} environment windows open`;
  });
  const libraryEntries = createMemo(() => (
    filterEnvironmentLibrary(
      snapshot(),
      libraryQuery(),
      librarySourceFilter(),
    )
  ));
  const stopRuntimeSnapshot = createMemo<RuntimeServiceSnapshot | undefined>(() => (
    environmentRuntimeServiceSnapshot(runtimeMaintenanceConfirmation()?.environment ?? null)
  ));
  const stopRuntimeActiveWorkLabel = createMemo(() => (
    runtimeMaintenanceConfirmation()?.environment.runtime_maintenance?.active_work_label
    || formatRuntimeServiceWorkload(stopRuntimeSnapshot())
  ));
  const stopRuntimeHasActiveWork = createMemo(() => (
    runtimeMaintenanceConfirmation()?.environment.runtime_maintenance?.has_active_work
    ?? runtimeServiceHasActiveWork(stopRuntimeSnapshot())
  ));
  const providerRuntimeLinkActionLabel = createMemo(() => (
    providerRuntimeLinkConfirmation()?.action === 'disconnect' ? 'Disconnect from provider' : 'Connect to provider'
  ));
  const providerRuntimeLinkSnapshot = createMemo<RuntimeServiceSnapshot | undefined>(() => (
    environmentRuntimeServiceSnapshot(providerRuntimeLinkConfirmation()?.environment ?? null)
  ));
  const providerRuntimeLinkActiveWorkLabel = createMemo(() => (
    formatRuntimeServiceWorkload(providerRuntimeLinkSnapshot())
  ));
  const providerRuntimeLinkMatches = createMemo(() => {
    const confirmation = providerRuntimeLinkConfirmation();
    if (!confirmation) {
      return false;
    }
    return providerRuntimeLinkMatchesEnvironment(confirmation.environment);
  });
  const providerRuntimeLinkCandidates = createMemo(() => (
    providerRuntimeLinkConfirmation()?.environment.provider_environment_candidates ?? []
  ));
  const activeActionProgress = createMemo(() => snapshot().action_progress);
  const sshRuntimeProgressItems = createMemo(() => (
    activeActionProgress()
      .filter((progress) => (
        progress.action === 'start_environment_runtime'
        && (
          trimString(progress.phase).startsWith('ssh_')
          || trimString(progress.operation_key).startsWith('ssh:')
        )
      ))
      .sort((left, right) => (left.started_at_unix_ms ?? 0) - (right.started_at_unix_ms ?? 0))
  ));

  createEffect(() => {
    const activeSourceFilter = librarySourceFilter();
    if (activeSourceFilter === '') {
      return;
    }
    if (!availableLibrarySourceFilters().has(activeSourceFilter)) {
      setLibrarySourceFilter('');
    }
  });

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

  const unsubscribeSnapshot = props.runtime.launcher.subscribeSnapshot((nextSnapshot) => {
    setSnapshot((current) => {
      const next = nextDesktopWelcomeSnapshot(current, nextSnapshot);
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
      showActionToast(formatIssueToastMessage(issue), issueToastTone(issue));
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
    if (connectionDialogState()?.connection_kind === 'ssh_environment' && !sshConfigHostsLoaded()) {
      void refreshSSHConfigHosts();
    }
  });

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
        message,
        action: options.action,
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
          showActionToast('Continue in your browser to reconnect this provider.', 'info');
        }
        break;
      }
      default:
        break;
    }
  }

  async function handleLauncherActionFailure(
    failure: Extract<DesktopLauncherActionResult, Readonly<{ ok: false }>>,
    errorTarget: 'connect' | 'settings' | 'dialog' | 'control_plane_dialog',
    requestEnvID?: string,
  ): Promise<void> {
    const presentation = launcherActionFailurePresentation(failure);
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
          next.set(environmentID, { message: presentation.message, tone });
          return next;
        });
      }
    }
  }

  async function performLauncherActionSilently(
    request: DesktopLauncherActionRequest,
  ): Promise<
    | Extract<DesktopLauncherActionResult, Readonly<{ ok: true }>>
    | Readonly<{ ok: false; message: string }>
  > {
    setBusyState(busyStateForLauncherRequest(request));
    try {
      const result = await props.runtime.launcher.performAction(request);
      if (isDesktopLauncherActionFailure(result)) {
        const presentation = launcherActionFailurePresentation(result);
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
          message: presentation.message || 'Desktop could not complete that action.',
        };
      }
      if (isDesktopLauncherActionSuccess(result)) {
        return result;
      }
      return {
        ok: false,
        message: 'Desktop returned an unexpected launcher result.',
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
    setControlPlaneDialogError('');
  }

  function showConnectEnvironment(message = ''): void {
    setConnectionDialogState(null);
    setControlPlaneDialogState(null);
    if (trimString(message) !== '') {
      showActionToast(message, 'info');
    }
    setSettingsError('');
    setConnectionDialogError('');
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
      setSettingsError('Choose an environment first.');
      return;
    }
    resetMessages();
    setConnectionDialogState(null);
    setControlPlaneDialogState(null);
    setBusyState({
      action: 'open_environment_settings',
      environment_id: environmentID,
      provider_origin: '',
      provider_id: '',
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

  function openCreateConnectionDialog(
    message = '',
    preferredKind: 'external_local_ui' | 'ssh_environment' = 'external_local_ui',
  ): void {
    if (snapshot().surface !== 'connect_environment') {
      showConnectEnvironment(message || 'Open the launcher to add a connection.');
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
    setControlPlaneDialogError('');
    setControlPlaneDialogState(null);
    setConnectionDialogState(
      preferredKind === 'ssh_environment'
        ? createSSHConnectionDialogState('create', {
          bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
        })
        : createExternalURLConnectionDialogState('create', {
          external_local_ui_url: trimString(snapshot().suggested_remote_url),
        }),
    );
  }

  function startEditingEnvironment(environment: DesktopEnvironmentEntry): void {
    if (environment.kind === 'local_environment') {
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
        remote_install_dir: environment.ssh_details?.remote_install_dir === DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR
          ? ''
          : (environment.ssh_details?.remote_install_dir ?? ''),
        bootstrap_strategy: environment.ssh_details?.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
        release_base_url: environment.ssh_details?.release_base_url ?? '',
        connect_timeout_seconds: environment.ssh_details?.connect_timeout_seconds == null ? '' : String(environment.ssh_details.connect_timeout_seconds),
      }));
    } else {
      setConnectionDialogState(createExternalURLConnectionDialogState('edit', {
        environment_id: environment.id,
        label: environment.label,
        external_local_ui_url: environment.local_ui_url,
      }));
    }
    setConnectionDialogError('');
  }

  function closeConnectionDialog(): void {
    setConnectionDialogState(null);
    setConnectionDialogError('');
    setConnectionDialogFieldErrors({});
  }

  function openCreateControlPlaneDialog(message = ''): void {
    if (snapshot().surface !== 'connect_environment') {
      showConnectEnvironment(message || 'Open the launcher to add a Provider.');
      return;
    }
    setActiveCenterTab('control_planes');
    setConnectionDialogState(null);
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

  function switchConnectionDialogKind(kind: 'external_local_ui' | 'ssh_environment'): void {
    setConnectionDialogFieldErrors({});
    setConnectionDialogState((current) => {
      if (!current || current.mode !== 'create' || current.connection_kind === kind) {
        return current;
      }
      if (kind === 'ssh_environment') {
        return createSSHConnectionDialogState('create', {
          label: current.label,
          bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
        });
      }
      return createExternalURLConnectionDialogState('create', {
        label: current.label,
        external_local_ui_url: current.connection_kind === 'external_local_ui'
          ? current.external_local_ui_url
          : trimString(snapshot().suggested_remote_url),
      });
    });
  }

  function updateConnectionDialogField(
    name: 'label' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'auth_mode' | 'remote_install_dir' | 'release_base_url' | 'connect_timeout_seconds',
    value: string,
  ): void {
    setConnectionDialogState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        [name]: value,
      };
    });
  }

  function switchSSHBootstrapStrategy(strategy: DesktopSSHBootstrapStrategy): void {
    setConnectionDialogState((current) => {
      if (!current || current.connection_kind !== 'ssh_environment') {
        return current;
      }
      return {
        ...current,
        bootstrap_strategy: strategy,
      };
    });
  }

  function setErrorMessage(target: 'connect' | 'settings' | 'dialog' | 'control_plane_dialog', message: string): void {
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
    if (target === 'dialog') {
      setConnectionDialogError(message);
      return;
    }
  }

  async function performLauncherAction(
    request: DesktopLauncherActionRequest,
    errorTarget: 'connect' | 'settings' | 'dialog' | 'control_plane_dialog' = 'connect',
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
      setErrorMessage(errorTarget, 'Desktop returned an unexpected launcher result.');
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
    errorTarget: 'connect' | 'settings' | 'dialog' | 'control_plane_dialog' = 'connect',
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
      showActionToast('SSH runtime startup is stopping.', 'info');
    }
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
    }, errorTarget);
    return result?.outcome === 'opened_environment_window' || result?.outcome === 'focused_environment_window';
  }

  async function openPrimaryLocalEnvironment(): Promise<void> {
    const entry = selectedSettingsEnvironmentEntry();
    if (!entry) {
      setErrorMessage(visibleSurface() === 'environment_settings' ? 'settings' : 'connect', 'Create a Local Environment or connect a Provider first.');
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
      setErrorMessage(errorTarget, 'Environment URL is required.');
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
    return environment.runtime_control_capability === 'start_stop'
      ? 'Start the runtime first to continue.'
      : 'This runtime is offline or unavailable right now.';
  }

  function runtimeActionRequest(
    environment: DesktopEnvironmentEntry,
    kind: 'start_environment_runtime' | 'stop_environment_runtime' | 'refresh_environment_runtime',
    options: Readonly<{ forceRuntimeUpdate?: boolean }> = {},
  ): DesktopLauncherActionRequest | null {
    if (environment.kind === 'local_environment') {
      return {
        kind,
        environment_id: environment.id,
        label: environment.label,
        ...(options.forceRuntimeUpdate ? { force_runtime_update: true } : {}),
      };
    }
    if (environment.kind === 'provider_environment') {
      return {
        kind,
        environment_id: environment.id,
        label: environment.label,
        ...(options.forceRuntimeUpdate ? { force_runtime_update: true } : {}),
      };
    }
    if (environment.kind === 'external_local_ui') {
      return {
        kind,
        environment_id: environment.id,
        external_local_ui_url: environment.local_ui_url,
        label: environment.label,
        ...(options.forceRuntimeUpdate ? { force_runtime_update: true } : {}),
      };
    }
    if (!environment.ssh_details) {
      return null;
    }
    return {
      kind,
      environment_id: environment.id,
      label: environment.label,
      ssh_destination: environment.ssh_details.ssh_destination,
      ssh_port: environment.ssh_details.ssh_port,
      auth_mode: environment.ssh_details.auth_mode,
      remote_install_dir: environment.ssh_details.remote_install_dir,
      bootstrap_strategy: environment.ssh_details.bootstrap_strategy,
      release_base_url: environment.ssh_details.release_base_url,
      connect_timeout_seconds: environment.ssh_details.connect_timeout_seconds,
      ...(options.forceRuntimeUpdate ? { force_runtime_update: true } : {}),
    };
  }

  async function reconnectProviderForEnvironment(
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    const providerOrigin = trimString(action.provider_origin) || trimString(environment.provider_origin);
    if (providerOrigin === '') {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : errorTarget, 'Desktop could not resolve this provider.');
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
      showActionToast('Continue in your browser to reconnect this provider.', 'info');
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
    options: Readonly<{ announceSuccess?: boolean; forceRuntimeUpdate?: boolean }> = {},
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'start_environment_runtime', {
      forceRuntimeUpdate: options.forceRuntimeUpdate,
    });
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', 'Desktop could not resolve that runtime target.');
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const started = result?.outcome === 'started_environment_runtime';
    if (started && options.announceSuccess !== false) {
      showActionToast(`Runtime started for ${environment.label}.`);
    }
    return started;
  }

  async function stopEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'stop_environment_runtime');
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', 'Desktop could not resolve that runtime target.');
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const stopped = result?.outcome === 'stopped_environment_runtime';
    const canceled = result?.outcome === 'canceled_launcher_operation';
    if (stopped) {
      showActionToast(`Runtime stopped for ${environment.label}.`);
    }
    if (canceled) {
      showActionToast(`Startup canceled for ${environment.label}.`, 'info');
    }
    return stopped || canceled;
  }

  function requestRuntimeMaintenanceConfirmation(
    environment: DesktopEnvironmentEntry,
    action: RuntimeMaintenanceConfirmationAction,
  ): void {
    setRuntimeMaintenanceConfirmation({
      environment,
      action,
    });
  }

  async function confirmRuntimeMaintenance(): Promise<void> {
    const confirmation = runtimeMaintenanceConfirmation();
    if (!confirmation) {
      return;
    }
    const target = confirmation.environment;
    if (confirmation.action === 'update') {
      setRuntimeMaintenanceConfirmation(null);
      const latestTarget = await loadLatestEnvironmentEntry(target.id) ?? target;
      await startEnvironmentRuntime(latestTarget, 'connect', { forceRuntimeUpdate: true });
      return;
    }
    const stopped = await stopEnvironmentRuntime(target, 'connect');
    if (!stopped) {
      return;
    }
    setRuntimeMaintenanceConfirmation(null);
    if (confirmation.action === 'restart') {
      const latestTarget = await loadLatestEnvironmentEntry(target.id) ?? target;
      await startEnvironmentRuntime(latestTarget, 'connect');
    }
  }

  async function refreshEnvironmentRuntime(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    options: Readonly<{ announceSuccess?: boolean }> = {},
  ): Promise<boolean> {
    const request = runtimeActionRequest(environment, 'refresh_environment_runtime');
    if (!request) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', 'Desktop could not resolve that runtime target.');
      return false;
    }
    const result = await performLauncherAction(request, errorTarget);
    const refreshed = result?.outcome === 'refreshed_environment_runtime';
    if (refreshed && options.announceSuccess !== false) {
      showActionToast(`Runtime status refreshed for ${environment.label}.`, 'info');
    }
    return refreshed;
  }

  function providerRuntimeLinkMatchesEnvironment(environment: DesktopEnvironmentEntry): boolean {
    const target = environment.provider_runtime_link_target;
    if (!target || !target.provider_origin || !target.provider_id || !target.env_public_id) {
      return false;
    }
    const confirmation = providerRuntimeLinkConfirmation();
    const providerEnvironment = confirmation?.provider_environment_id
      ? snapshot().environments.find((entry) => entry.id === confirmation.provider_environment_id)
      : null;
    return runtimeServiceProviderLinkMatches(target.runtime_service, {
      provider_origin: providerEnvironment?.provider_origin ?? target.provider_origin,
      provider_id: providerEnvironment?.provider_id ?? target.provider_id,
      env_public_id: providerEnvironment?.env_public_id ?? target.env_public_id,
    });
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
      setErrorMessage('connect', 'Desktop could not resolve that runtime target.');
      return;
    }
    if (action === 'connect' && (environment.provider_environment_candidates?.length ?? 0) === 0) {
      setErrorMessage('connect', 'No provider environments are available to connect.');
      return;
    }
    setProviderRuntimeLinkConfirmation({
      environment,
      action,
      provider_environment_id: action === 'disconnect'
        ? providerEnvironmentIDForRuntimeTarget(environment)
        : undefined,
    });
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
    const providerEnvironmentID = confirmation.provider_environment_id ?? '';
    if (providerEnvironmentID === '') {
      setErrorMessage('connect', 'Choose a provider environment first.');
      return;
    }
    const ok = confirmation.action === 'disconnect'
      ? await disconnectProviderRuntime(latestEnvironment, providerEnvironmentID, 'connect')
      : await connectProviderRuntime(latestEnvironment, providerEnvironmentID, 'connect');
    if (ok) {
      setProviderRuntimeLinkConfirmation(null);
    }
  }

  async function connectProviderRuntime(
    environment: DesktopEnvironmentEntry,
    providerEnvironmentID: string,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    const target = environment.provider_runtime_link_target;
    if (!target) {
      setErrorMessage(errorTarget === 'settings' ? 'settings' : errorTarget, 'Desktop could not resolve that runtime target.');
      return false;
    }
    const result = await performLauncherAction({
      kind: 'connect_provider_runtime',
      provider_environment_id: providerEnvironmentID,
      runtime_target_id: target.id,
    }, errorTarget);
    const connected = result?.outcome === 'connected_provider_runtime';
    if (connected) {
      showActionToast(`${environment.label} connected to provider.`, 'success');
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
      setErrorMessage(errorTarget === 'settings' ? 'settings' : errorTarget, 'Desktop could not resolve that runtime target.');
      return false;
    }
    const result = await performLauncherAction({
      kind: 'disconnect_provider_runtime',
      provider_environment_id: providerEnvironmentID,
      runtime_target_id: target.id,
    }, errorTarget);
    const disconnected = result?.outcome === 'disconnected_provider_runtime';
    if (disconnected) {
      showActionToast(`${environment.label} disconnected from provider.`, 'info');
    }
    return disconnected;
  }

  async function refreshAllEnvironmentRuntimes(): Promise<void> {
    const result = await performLauncherAction({
      kind: 'refresh_all_environment_runtimes',
    });
    if (result?.outcome === 'refreshed_all_environment_runtimes') {
      showActionToast('Runtime statuses refreshed.', 'info');
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
      ssh_destination: details.ssh_destination,
      ssh_port: details.ssh_port,
      auth_mode: details.auth_mode,
      remote_install_dir: details.remote_install_dir,
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
    if (
      environment.window_state === 'closed'
      && environment.runtime_health.status !== 'online'
    ) {
      const message = runtimeUnavailableMessage(environment);
      setErrorMessage(errorTarget, message);
      setEnvironmentFailures((current) => {
        const next = new Map(current);
        next.set(environment.id, { message, tone: 'warning' });
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
    if (environment.kind === 'ssh_environment') {
      const details = environment.ssh_details;
      if (!details) {
        setErrorMessage(errorTarget, 'SSH connection details are missing.');
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
        requestRuntimeMaintenanceConfirmation(environment, 'stop');
        return true;
      case 'restart_runtime':
        requestRuntimeMaintenanceConfirmation(environment, 'restart');
        return true;
      case 'update_runtime':
        requestRuntimeMaintenanceConfirmation(environment, 'update');
        return true;
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
      case 'opening':
      default:
        return false;
    }
  }

  async function runEnvironmentGuidanceAction(
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
  ): Promise<EnvironmentGuidanceActionResolution> {
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
        return {
          close_panel: false,
          next_session: failEnvironmentGuidanceIntent(currentSession, result.message),
        };
      }

      const nextEnvironment = await loadLatestEnvironmentEntry(environment.id);
      if (!nextEnvironment) {
        showActionToast(`Runtime is ready for ${environment.label}.`, 'success');
        return {
          close_panel: true,
          next_session: null,
        };
      }

      const nextSession = completeEnvironmentGuidanceRefresh(currentSession, nextEnvironment);
      if (!nextSession) {
        showActionToast(`Runtime is ready for ${environment.label}.`, 'success');
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

    if (action.intent === 'stop_runtime') {
      requestRuntimeMaintenanceConfirmation(environment, 'stop');
      return {
        close_panel: true,
        next_session: null,
      };
    }

    if (action.intent === 'restart_runtime') {
      requestRuntimeMaintenanceConfirmation(environment, 'restart');
      return {
        close_panel: true,
        next_session: null,
      };
    }

    if (action.intent === 'update_runtime') {
      requestRuntimeMaintenanceConfirmation(environment, 'update');
      return {
        close_panel: true,
        next_session: null,
      };
    }

    if (action.intent === 'start_runtime') {
      const request = runtimeActionRequest(environment, 'start_environment_runtime');
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
        setEnvironmentFailures((current) => {
          const next = new Map(current);
          next.set(environment.id, { message: result.message, tone: 'error' });
          return next;
        });
        return {
          close_panel: false,
          next_session: failEnvironmentGuidanceIntent(currentSession, result.message),
        };
      }

      const nextEnvironment = await loadLatestEnvironmentEntry(environment.id);
      const reconciledSession = nextEnvironment
        ? reconcileEnvironmentGuidanceSession(currentSession, [nextEnvironment])
        : null;
      if (reconciledSession?.feedback?.tone === 'success') {
        return {
          close_panel: false,
          next_session: reconciledSession,
        };
      }
      if (!nextEnvironment || !reconciledSession) {
        showActionToast(`Runtime started for ${environment.label}.`);
        return {
          close_panel: true,
          next_session: null,
        };
      }
      return {
        close_panel: false,
        next_session: {
          ...currentSession,
          pending_intent: null,
          feedback: {
            tone: 'info',
            title: 'Runtime start requested',
            detail: 'Desktop started the local runtime and is waiting for the next status update.',
          },
        },
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
      showActionToast('Continue in your browser to finish authorizing this provider.', 'info');
    }
  }

  async function reconnectControlPlane(controlPlane: DesktopControlPlaneSummary): Promise<void> {
    const result = await performLauncherAction({
      kind: 'start_control_plane_connect',
      provider_origin: controlPlane.provider.provider_origin,
      display_label: controlPlane.display_label,
    });
    if (result?.outcome === 'started_control_plane_connect') {
      showActionToast(`Continue in your browser to reconnect ${controlPlaneName(controlPlane)}.`, 'info');
    }
  }

  async function refreshControlPlane(controlPlane: DesktopControlPlaneSummary): Promise<void> {
    const result = await performLauncherAction({
      kind: 'refresh_control_plane',
      provider_origin: controlPlane.provider.provider_origin,
      provider_id: controlPlane.provider.provider_id,
    });
    if (result?.outcome === 'refreshed_control_plane') {
      showActionToast(`Refreshed ${controlPlaneName(controlPlane)}.`);
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
      showActionToast('Environment settings saved.');
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
      errorTarget: 'connect' | 'dialog';
      successMessage: string;
    }>,
  ): Promise<boolean> {
    const normalizedTargetURL = trimString(request.external_local_ui_url);
    if (!normalizedTargetURL) {
      setErrorMessage(request.errorTarget, 'Environment URL is required.');
      return false;
    }

    setConnectionDialogError('');
    setBusyState({
      action: 'save_environment',
      environment_id: trimString(request.environment_id),
      provider_origin: '',
      provider_id: '',
      progress: null,
    });
    try {
      await props.runtime.launcher.performAction({
        kind: 'upsert_saved_environment',
        environment_id: trimString(request.environment_id),
        label: trimString(request.label),
        external_local_ui_url: normalizedTargetURL,
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
        remote_install_dir: request.details.remote_install_dir,
        bootstrap_strategy: request.details.bootstrap_strategy,
        release_base_url: request.details.release_base_url,
        connect_timeout_seconds: request.details.connect_timeout_seconds,
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

  function validateConnectionDialogFields(state: ConnectionDialogState): Partial<Record<string, string>> {
    const errors: Partial<Record<string, string>> = {};
    if (!trimString(state?.label ?? '')) {
      errors.label = 'Name is required.';
    }
    if (state?.connection_kind === 'external_local_ui' && !trimString(state.external_local_ui_url)) {
      errors.external_local_ui_url = 'Environment URL is required.';
    }
    if (state?.connection_kind === 'ssh_environment' && !trimString(state.ssh_destination)) {
      errors.ssh_destination = 'SSH Destination is required.';
    }
    if (state?.connection_kind === 'ssh_environment' && trimString(state.ssh_port) !== '') {
      const port = Number.parseInt(state.ssh_port, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        errors.ssh_port = 'Port must be 1–65535.';
      }
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
          remote_install_dir: trimString(state.remote_install_dir) || DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
          bootstrap_strategy: state.bootstrap_strategy,
          release_base_url: trimString(state.release_base_url),
          connect_timeout_seconds: trimString(state.connect_timeout_seconds) === '' ? null : Number(trimString(state.connect_timeout_seconds)),
        },
        errorTarget: 'dialog',
        successMessage: state.mode === 'edit'
          ? 'Connection updated.'
          : 'Connection saved to Environment Library.',
      });
    } else {
      saved = await upsertSavedEnvironment({
        environment_id: state.environment_id,
        label: state.label,
        external_local_ui_url: state.external_local_ui_url,
        errorTarget: 'dialog',
        successMessage: state.mode === 'edit'
          ? 'Connection updated.'
          : 'Connection saved to Environment Library.',
      });
    }
    if (saved) {
      closeConnectionDialog();
    }
  }

  async function saveAndConnectURLFromDialog(): Promise<void> {
    const state = connectionDialogState();
    if (!state || state.connection_kind !== 'external_local_ui') {
      return;
    }
    const errors = validateConnectionDialogFields(state);
    setConnectionDialogFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setConnectionDialogFieldErrors({});
    const saved = await upsertSavedEnvironment({
      environment_id: state.environment_id,
      label: state.label,
      external_local_ui_url: state.external_local_ui_url,
      errorTarget: 'dialog',
      successMessage: state.mode === 'edit'
        ? 'Connection updated.'
        : 'Connection saved to Environment Library.',
    });
    if (saved) {
      await openRemoteEnvironment(state.external_local_ui_url, 'dialog');
    }
  }

  async function toggleEnvironmentPinned(environment: DesktopEnvironmentEntry): Promise<void> {
    const nextPinned = !environment.pinned;
    const successMessage = nextPinned
      ? `${environment.label} pinned.`
      : `${environment.label} unpinned.`;
    if (environment.kind === 'local_environment') {
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
      const details = environment.ssh_details;
      if (!details) {
        setErrorMessage('connect', 'SSH connection details are missing.');
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
        remote_install_dir: details.remote_install_dir,
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
    const messageLabel = trimString(copyLabel).replace(/^Copy\s+/u, '');
    showActionToast(messageLabel ? `${messageLabel} copied.` : 'Copied to clipboard.');
  }

  async function deleteEnvironment(): Promise<void> {
    const target = deleteTarget();
    if (!target) {
      return;
    }
    if (target.kind !== 'ssh_environment' && target.kind !== 'external_local_ui') {
      throw new Error('Unsupported delete target.');
    }
    const hadBackgroundOperation = deleteTargetOperation() !== null;
    setBusyState({
      action: 'delete_environment',
      environment_id: target.id,
      provider_origin: '',
      provider_id: '',
      progress: null,
    });
    try {
      await props.runtime.launcher.performAction({
        kind: target.kind === 'ssh_environment' ? 'delete_saved_ssh_environment' : 'delete_saved_environment',
        environment_id: target.id,
      });
      await refreshSnapshot();
      setDeleteTarget(null);
      showActionToast(
        hadBackgroundOperation
          ? 'Connection removed. Startup cleanup is running in the background.'
          : 'Connection removed from Environment Library.',
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
      showActionToast('Provider removed from Desktop.');
    }
  }

  return (
    <>
      <DesktopCommandRegistrar
        snapshot={snapshot}
        showConnectEnvironment={showConnectEnvironment}
        openCreateConnectionDialog={openCreateConnectionDialog}
        openSettingsSurface={openSettingsSurface}
        openLocalEnvironment={openPrimaryLocalEnvironment}
        openEnvironment={openEnvironment}
        closeLauncherOrQuit={closeLauncherOrQuit}
      />
      <DesktopLauncherShell
        mainContentId="redeven-desktop-main"
        skipLinkLabel={DESKTOP_SKIP_LINK_LABEL}
        topBarLabel={DESKTOP_TOP_BAR_LABEL}
        logo={(
          <TopBarIconButton label="Open Redeven Dashboard" onClick={() => openRedevenDashboard()}>
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
            <TopBarIconButton
              label={theme.resolvedTheme() === 'light' ? 'Use dark theme' : 'Use light theme'}
              onClick={() => toggleDesktopTheme(theme.resolvedTheme(), shellTheme, () => theme.toggleTheme())}
            >
              {theme.resolvedTheme() === 'light' ? <Moon class="h-4 w-4" /> : <Sun class="h-4 w-4" />}
            </TopBarIconButton>
          </div>
        )}
        bottomBarLeading={(
          <>
            <BottomBarItem class="min-w-0">
              <span class="truncate">{shellView().surface_title}</span>
            </BottomBarItem>
            <BottomBarItem class="min-w-0">
              <span class="truncate">{openWindowsSubtitle()}</span>
            </BottomBarItem>
          </>
        )}
        bottomBarTrailing={(
          <>
            <StatusIndicator status={status().tone} label={status().label} />
            <Show when={snapshot().surface === 'connect_environment'}>
              <BottomBarItem class="cursor-pointer" onClick={() => void closeLauncherOrQuit()}>
                {snapshot().close_action_label}
              </BottomBarItem>
            </Show>
          </>
        )}
      >
        <ConnectEnvironmentSurface
          snapshot={snapshot()}
          busyState={busyState()}
          actionProgress={activeActionProgress()}
          activeTab={activeCenterTab()}
          setActiveTab={setActiveCenterTab}
          librarySourceFilter={librarySourceFilter()}
          libraryQuery={libraryQuery()}
          libraryEntries={libraryEntries()}
          setLibrarySourceFilter={setLibrarySourceFilter}
          setLibraryQuery={setLibraryQuery}
          openLocalEnvironment={openPrimaryLocalEnvironment}
          openSettingsSurface={openSettingsSurface}
          openCreateConnectionDialog={openCreateConnectionDialog}
          openCreateControlPlaneDialog={openCreateControlPlaneDialog}
          refreshAllEnvironmentRuntimes={refreshAllEnvironmentRuntimes}
          openRemoteEnvironment={openRemoteEnvironment}
          openSSHEnvironment={openSSHEnvironment}
          openEnvironment={openEnvironment}
          runLocalEnvironmentAction={triggerLocalEnvironmentAction}
          refreshEnvironmentRuntime={refreshEnvironmentRuntime}
          runEnvironmentGuidanceAction={runEnvironmentGuidanceAction}
          toggleEnvironmentPinned={toggleEnvironmentPinned}
          copyEnvironmentValue={copyEnvironmentValue}
          editEnvironment={startEditingEnvironment}
          deleteEnvironment={setDeleteTarget}
          controlPlanes={controlPlanes()}
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
      </DesktopLauncherShell>

      <DesktopActionToastViewport
        toasts={actionToasts()}
        dismissToast={dismissActionToast}
        runToastAction={runActionToastAction}
      />
      <SSHRuntimeActivityOverlay
        snapshot={snapshot()}
        progressItems={sshRuntimeProgressItems()}
        cancelOperation={cancelLauncherOperation}
      />

      <LocalEnvironmentSettingsDialog
        open={snapshot().surface === 'environment_settings'}
        snapshot={settingsSurface()}
        baselineSnapshot={settingsBaselineSurface()}
        draft={draft()}
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
      />

      <ConnectionDialog
        state={connectionDialogState()}
        sshConfigHosts={sshConfigHosts()}
        error={connectionDialogError()}
        fieldErrors={connectionDialogFieldErrors()}
        busyState={busyState()}
        onOpenChange={(open) => {
          if (!open) {
            closeConnectionDialog();
          }
        }}
        updateField={updateConnectionDialogField}
        switchKind={switchConnectionDialogKind}
        switchBootstrapStrategy={switchSSHBootstrapStrategy}
        clearFieldErrors={() => setConnectionDialogFieldErrors({})}
        onConnect={saveAndConnectURLFromDialog}
        onSave={saveConnectionFromDialog}
      />

      <ControlPlaneDialog
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
        title="Delete Connection"
        confirmText="Delete Connection"
        variant="destructive"
        loading={busyStateMatchesAction(busyState(), 'delete_environment')}
        onConfirm={() => void deleteEnvironment()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            Remove <span class="font-semibold">{deleteTarget()?.label}</span> from the Environment Library?
          </p>
          <p class="text-xs text-muted-foreground">
            <Show
              when={deleteTargetOperation()}
              fallback={<>This only removes the saved Desktop entry. It does not stop the remote Environment.</>}
            >
              <>The connection is involved in a background task. Desktop will remove it now, then cancel or clean up that task in the background.</>
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
        title="Remove Provider"
        confirmText="Remove Provider"
        variant="destructive"
        loading={busyStateMatchesAction(busyState(), 'delete_control_plane')}
        onConfirm={() => void deleteControlPlane()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            Remove <span class="font-semibold">{deleteControlPlaneTarget() ? controlPlaneName(deleteControlPlaneTarget()!) : ''}</span> from Desktop?
          </p>
          <p class="text-xs text-muted-foreground">Desktop will revoke the saved authorization, then remove the local account snapshot and cached environment list.</p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={runtimeMaintenanceConfirmation() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRuntimeMaintenanceConfirmation(null);
          }
        }}
        title={runtimeMaintenanceConfirmation()?.action === 'update'
          ? 'Update SSH Runtime'
          : runtimeMaintenanceConfirmation()?.action === 'restart'
            ? 'Restart Runtime'
            : 'Stop Runtime'}
        confirmText={runtimeMaintenanceConfirmation()?.action === 'update'
          ? 'Update and Restart'
          : runtimeMaintenanceConfirmation()?.action === 'restart'
            ? 'Stop and Restart'
            : 'Stop Runtime'}
        variant="destructive"
        loading={busyStateMatchesAction(busyState(), 'stop_environment_runtime')}
        onConfirm={() => void confirmRuntimeMaintenance()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            <Show
              when={runtimeMaintenanceConfirmation()?.action !== 'stop'}
              fallback={(
                <>Stop the runtime for <span class="font-semibold">{runtimeMaintenanceConfirmation()?.environment.label}</span>?</>
              )}
            >
              <Show
                when={runtimeMaintenanceConfirmation()?.action === 'update'}
                fallback={(
                  <>Stop and restart the runtime for <span class="font-semibold">{runtimeMaintenanceConfirmation()?.environment.label}</span>?</>
                )}
              >
                Update and restart the SSH runtime for <span class="font-semibold">{runtimeMaintenanceConfirmation()?.environment.label}</span>?
              </Show>
            </Show>
          </p>
          <p class="text-xs text-muted-foreground">
            This interrupts the background runtime service for this environment. Open terminals, sessions, tasks, and port forwards may be disconnected.
          </p>
          <Show when={runtimeMaintenanceConfirmation()?.action === 'restart'}>
            <p class="text-xs text-muted-foreground">
              Desktop will start the managed runtime again after the current process stops. Open remains separate and becomes available after the runtime is ready.
            </p>
          </Show>
          <Show when={runtimeMaintenanceConfirmation()?.action === 'update'}>
            <p class="text-xs text-muted-foreground">
              Desktop will install the bundled Redeven runtime and start it again on this SSH host. Open remains separate after the update.
            </p>
          </Show>
          <p class="text-xs text-muted-foreground">
            Active work: <span class={cn('font-medium', stopRuntimeHasActiveWork() ? 'text-foreground' : 'text-muted-foreground')}>{stopRuntimeActiveWorkLabel()}</span>
          </p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={providerRuntimeLinkConfirmation() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setProviderRuntimeLinkConfirmation(null);
          }
        }}
        title={providerRuntimeLinkActionLabel()}
        confirmText={providerRuntimeLinkActionLabel()}
        variant={providerRuntimeLinkConfirmation()?.action === 'disconnect' ? 'destructive' : 'default'}
        loading={providerRuntimeLinkConfirmation()?.action === 'disconnect'
          ? busyStateMatchesAction(busyState(), 'disconnect_provider_runtime')
          : busyStateMatchesAction(busyState(), 'connect_provider_runtime')}
        onConfirm={() => void confirmProviderRuntimeLinkAction()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            <Show
              when={providerRuntimeLinkConfirmation()?.action === 'disconnect'}
              fallback={(
                <>Connect <span class="font-semibold">{providerRuntimeLinkConfirmation()?.environment.label}</span> to a provider?</>
              )}
            >
              Disconnect <span class="font-semibold">{providerRuntimeLinkConfirmation()?.environment.label}</span> from its provider?
            </Show>
          </p>
          <Show when={providerRuntimeLinkConfirmation()?.action === 'connect'}>
            <div class="space-y-1">
              <p class="text-xs font-medium text-muted-foreground">Provider Environment</p>
              <div class="space-y-1">
                <For each={providerRuntimeLinkCandidates()}>
                  {(candidate) => (
                    <label class="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/60">
                      <span>
                        <span class="block font-medium">{candidate.label}</span>
                        <span class="block text-xs text-muted-foreground">{candidate.provider_label || candidate.provider_origin} · {candidate.env_public_id}</span>
                      </span>
                      <input
                        type="radio"
                        name="provider-runtime-link-target"
                        checked={providerRuntimeLinkConfirmation()?.provider_environment_id === candidate.provider_environment_id}
                        onChange={() => setProviderRuntimeLinkConfirmation((current) => current ? {
                          ...current,
                          provider_environment_id: candidate.provider_environment_id,
                        } : current)}
                      />
                    </label>
                  )}
                </For>
              </div>
            </div>
          </Show>
          <Show when={providerRuntimeLinkConfirmation()?.action === 'disconnect'}>
            <p class="text-xs text-muted-foreground">
              Provider: <span class="font-medium text-foreground">{providerRuntimeLinkConfirmation()?.environment.provider_runtime_link_target?.provider_origin || 'Unknown provider'}</span>
            </p>
            <p class="text-xs text-muted-foreground">
              Source environment: <span class="font-mono text-foreground">{providerRuntimeLinkConfirmation()?.environment.provider_runtime_link_target?.env_public_id || 'unknown'}</span>
            </p>
          </Show>
          <Show
            when={providerRuntimeLinkConfirmation()?.action === 'disconnect'}
            fallback={(
              <p class="text-xs text-muted-foreground">
                After the link is established, the selected provider can request sessions through this running runtime. Existing local work keeps running.
              </p>
            )}
          >
            <p class="text-xs text-muted-foreground">
              Existing local-only work keeps running. Provider-originated sessions, tasks, or grants may stop receiving remote control updates after disconnect.
            </p>
          </Show>
          <Show when={providerRuntimeLinkConfirmation()?.action === 'connect' && providerRuntimeLinkMatches()}>
            <p class="text-xs text-muted-foreground">
              This runtime already reports a matching provider link. Confirming will ensure the provider control connection is enabled without restarting the runtime.
            </p>
          </Show>
          <Show when={providerRuntimeLinkConfirmation()?.action === 'disconnect'}>
            <p class="text-xs text-muted-foreground">
              Active work: <span class="font-medium text-foreground">{providerRuntimeLinkActiveWorkLabel()}</span>
            </p>
          </Show>
        </div>
      </ConfirmDialog>
    </>
  );
}

function DesktopActionToastViewport(props: Readonly<{
  toasts: readonly DesktopActionToast[];
  dismissToast: (toastID: number) => void;
  runToastAction: (action: DesktopActionToastAction, toastID: number) => void;
}>) {
  return (
    <Portal>
      <Show when={props.toasts.length > 0}>
        <div class="redeven-desktop-toast-viewport" aria-live="polite" aria-atomic="true">
          <Presence>
            <For each={props.toasts}>
              {(toast) => {
                const [copied, setCopied] = createSignal(false);
                const toastCopyText = createMemo(() => {
                  const title = toast.title ?? (toast.tone === 'success'
                    ? 'Updated'
                    : toast.tone === 'info'
                      ? 'Notice'
                      : toast.tone === 'warning'
                        ? 'Needs Attention'
                        : 'Could Not Complete');
                  return `${title}: ${toast.message}`;
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
                        {toast.title ?? (toast.tone === 'success'
                          ? 'Updated'
                          : toast.tone === 'info'
                            ? 'Notice'
                            : toast.tone === 'warning'
                              ? 'Needs Attention'
                              : 'Could Not Complete')}
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
                      aria-label="Copy message"
                      title="Copy message"
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
                      Dismiss
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
  snapshot: DesktopWelcomeSnapshot;
  busyState: DesktopLauncherBusyState;
  actionProgress: readonly DesktopLauncherActionProgress[];
  activeTab: EnvironmentCenterTab;
  setActiveTab: (value: EnvironmentCenterTab) => void;
  librarySourceFilter: string;
  libraryQuery: string;
  libraryEntries: readonly DesktopEnvironmentEntry[];
  setLibrarySourceFilter: (value: string) => void;
  setLibraryQuery: (value: string) => void;
  openLocalEnvironment: () => Promise<void>;
  openSettingsSurface: (environmentID?: string) => void;
  openCreateConnectionDialog: (message?: string, preferredKind?: 'external_local_ui' | 'ssh_environment') => void;
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
  runEnvironmentGuidanceAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
  ) => Promise<EnvironmentGuidanceActionResolution>;
  toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  controlPlanes: readonly DesktopControlPlaneSummary[];
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
        label: 'Local',
        count: localSourceCount(),
      });
    }
    if (providerSourceCount() > 0) {
      options.push({
        value: PROVIDER_ENVIRONMENT_LIBRARY_FILTER,
        label: 'Provider',
        count: providerSourceCount(),
      });
    }
    if (urlSourceCount() > 0) {
      options.push({
        value: URL_ENVIRONMENT_LIBRARY_FILTER,
        label: 'Redeven URL',
        count: urlSourceCount(),
      });
    }
    if (sshSourceCount() > 0) {
      options.push({
        value: SSH_ENVIRONMENT_LIBRARY_FILTER,
        label: 'SSH Host',
        count: sshSourceCount(),
      });
    }
    return options;
  });
  const activeSourceFilterLabel = createMemo(() => (
    sourceFilterOptions().find((option) => option.value === props.librarySourceFilter)?.label
    ?? props.controlPlanes.find((controlPlane) => controlPlaneFilterValue(controlPlane) === props.librarySourceFilter)?.display_label
    ?? ''
  ));
  const controlPlaneEnvironmentCount = createMemo(() => (
    props.controlPlanes.reduce((total, controlPlane) => total + controlPlane.environments.length, 0)
  ));
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
  const useSpaciousWelcomeShell = createMemo(() => (
    useSpaciousEnvironmentLibraryLayout() || useSpaciousControlPlaneLayout()
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
                <h1 class="text-lg font-semibold tracking-tight text-foreground">Environments</h1>
                <p class="text-xs text-muted-foreground">
                  Manage local and remote environments. Connect providers, open workspaces, and rebind this Local Environment profile when needed.
                </p>
              </div>
              <div class="flex items-center gap-2">
                <Show when={props.activeTab === 'environments'}>
                  <div class="relative w-full sm:w-[14.5rem]">
                    <Search class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={props.libraryQuery}
                      onInput={(event) => props.setLibraryQuery(event.currentTarget.value)}
                      placeholder="Search environments..."
                      size="sm"
                      class="w-full pl-9"
                    />
                  </div>
                </Show>
                <Show when={props.activeTab === 'environments'}>
                  <DesktopTooltip content="Refresh runtime statuses" placement="top">
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
                <Show
                  when={props.activeTab === 'environments'}
                  fallback={(
                    <Button size="sm" variant="default" onClick={() => props.openCreateControlPlaneDialog()}>
                      <Plus class="mr-1 h-3.5 w-3.5" />
                      Connect Provider
                    </Button>
                  )}
                >
                  <Button size="sm" variant="default" onClick={() => props.openCreateConnectionDialog()}>
                    <Plus class="mr-1 h-3.5 w-3.5" />
                    New
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
                      {tab.label}
                    </button>
                  )}
                </For>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Show
                  when={props.activeTab === 'environments'}
                  fallback={(
                    <div class="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{props.controlPlanes.length} providers</span>
                      <span class="text-border">·</span>
                      <span>{controlPlaneEnvironmentCount()} environments</span>
                    </div>
                  )}
                >
                  <Show when={sourceFilterOptions().length > 0}>
                    <Show
                      when={sourceFilterOptions().length < 5}
                      fallback={(
                        <select
                          class="redeven-native-select min-w-[12rem]"
                          value={props.librarySourceFilter}
                          onChange={(event) => props.setLibrarySourceFilter(trimString(event.currentTarget.value))}
                        >
                          <option value="">All Sources</option>
                          <For each={sourceFilterOptions()}>
                            {(option) => (
                              <option value={option.value}>
                                {option.label} ({option.count})
                              </option>
                            )}
                          </For>
                        </select>
                      )}
                    >
                      <button
                        type="button"
                        class="redeven-provider-pill"
                        data-active={props.librarySourceFilter === ''}
                        aria-pressed={props.librarySourceFilter === ''}
                        onClick={() => props.setLibrarySourceFilter('')}
                      >
                        All
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
                            {option.label}
                          </button>
                        )}
                      </For>
                    </Show>
                  </Show>
                  <div class="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                    <span>{visibleEnvironmentCount()} shown</span>
                    <span class="text-border">·</span>
                    <Show when={activeSourceFilterLabel() !== ''}>
                      <span>{activeSourceFilterLabel()}</span>
                      <span class="text-border">·</span>
                    </Show>
                    <span>{props.snapshot.open_windows.length} live</span>
                  </div>
                </Show>
              </div>
            </div>
          </header>

          <div class="space-y-3">
            <Show
              when={props.activeTab === 'environments'}
              fallback={(
                <ControlPlanesPanel
                  controlPlanes={props.controlPlanes}
                  busyState={props.busyState}
                  openCreateControlPlaneDialog={props.openCreateControlPlaneDialog}
                  environments={props.snapshot.environments}
                  viewControlPlaneEnvironments={props.viewControlPlaneEnvironments}
                  reconnectControlPlane={props.reconnectControlPlane}
                  refreshControlPlane={props.refreshControlPlane}
                  deleteControlPlane={props.deleteControlPlane}
                />
              )}
            >
              <EnvironmentCardsPanel
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
                runEnvironmentGuidanceAction={props.runEnvironmentGuidanceAction}
                toggleEnvironmentPinned={props.toggleEnvironmentPinned}
                copyEnvironmentValue={props.copyEnvironmentValue}
                editEnvironment={props.editEnvironment}
                deleteEnvironment={props.deleteEnvironment}
                environmentFailures={props.environmentFailures}
                dismissEnvironmentFailure={props.dismissEnvironmentFailure}
              />
            </Show>
          </div>
        </div>
      </main>
    </div>
  );
}

function EnvironmentCardsPanel(props: Readonly<{
  entries: readonly DesktopEnvironmentEntry[];
  showQuickAddCards: boolean;
  visibleCardCount: number;
  layoutReferenceCardCount: number;
  busyState: DesktopLauncherBusyState;
  actionProgress: readonly DesktopLauncherActionProgress[];
  openCreateConnectionDialog: (message?: string, preferredKind?: 'external_local_ui' | 'ssh_environment') => void;
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
  runEnvironmentGuidanceAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
  ) => Promise<EnvironmentGuidanceActionResolution>;
  toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  environmentFailures: ReadonlyMap<string, EnvironmentFailureState>;
  dismissEnvironmentFailure: (environmentID: string) => void;
}>) {
  const [environmentLibraryElement, setEnvironmentLibraryElement] = createSignal<HTMLDivElement>();
  const [environmentLibraryWidthPx, setEnvironmentLibraryWidthPx] = createSignal(0);
  const [rootFontSizePx, setRootFontSizePx] = createSignal(16);
  const [activeEnvironmentOverlayState, setActiveEnvironmentOverlayState] = createSignal(closedEnvironmentLibraryOverlayState());
  const [guidanceSessionState, setGuidanceSessionState] = createSignal<EnvironmentGuidanceSessionState>(null);
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
    setActiveEnvironmentOverlayState((current) => {
      const session = guidanceSessionState();
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
    setActiveEnvironmentOverlayState((current) => (
      open
        ? openEnvironmentLibraryOverlayState('runtime_menu', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'runtime_menu', environmentID)
    ));
  };

  const setPrimaryActionGuidanceOpen = (environmentID: string, open: boolean) => {
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

  const projectedEnvironment = (environmentID: string): DesktopEnvironmentEntry => projectedEntriesByID()[environmentID]!;
  const guidanceSessionForEnvironment = (environmentID: string): EnvironmentGuidanceSessionState => (
    guidanceSessionState()?.environment_id === environmentID ? guidanceSessionState() : null
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
                <div class="text-sm font-medium text-foreground">No matching environments</div>
                <div class="text-xs text-muted-foreground">
                  No environment cards match the current search or filter.
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
            <EnvironmentLibrarySection title="Pinned">
              <For each={groupedEntryIDs().pinned_entry_ids}>
                {(environmentID) => (
                  <EnvironmentConnectionCard
                    environment={projectedEnvironment(environmentID)}
                    busyState={props.busyState}
                    actionProgress={props.actionProgress}
                    runtimeMenuOpen={environmentLibraryOverlayOpenFor(activeEnvironmentOverlayState(), 'runtime_menu', environmentID)}
                    onRuntimeMenuOpenChange={(open) => setRuntimeMenuOpen(environmentID, open)}
                    primaryActionGuidanceOpen={environmentLibraryOverlayOpenFor(activeEnvironmentOverlayState(), 'primary_action_guidance', environmentID)}
                    onPrimaryActionGuidanceOpenChange={(open) => setPrimaryActionGuidanceOpen(environmentID, open)}
                    guidanceSession={guidanceSessionForEnvironment(environmentID)}
                    openEnvironment={props.openEnvironment}
                    runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                    refreshEnvironmentRuntime={props.refreshEnvironmentRuntime}
                    runEnvironmentGuidanceAction={props.runEnvironmentGuidanceAction}
                    toggleEnvironmentPinned={props.toggleEnvironmentPinned}
                    copyEnvironmentValue={props.copyEnvironmentValue}
                    editEnvironment={props.editEnvironment}
                    deleteEnvironment={props.deleteEnvironment}
                    setGuidanceSession={(nextSession) => setGuidanceSessionState(nextSession)}
                    environmentFailure={props.environmentFailures.get(environmentID) ?? null}
                    dismissEnvironmentFailure={() => props.dismissEnvironmentFailure(environmentID)}
                  />
                )}
              </For>
            </EnvironmentLibrarySection>
          </Show>
          <Show when={groupedEntryIDs().regular_entry_ids.length > 0 || props.showQuickAddCards}>
            <EnvironmentLibrarySection
              title={groupedEntryIDs().pinned_entry_ids.length > 0 ? 'Environments' : undefined}
            >
              <For each={groupedEntryIDs().regular_entry_ids}>
                {(environmentID) => (
                  <EnvironmentConnectionCard
                    environment={projectedEnvironment(environmentID)}
                    busyState={props.busyState}
                    actionProgress={props.actionProgress}
                    runtimeMenuOpen={environmentLibraryOverlayOpenFor(activeEnvironmentOverlayState(), 'runtime_menu', environmentID)}
                    onRuntimeMenuOpenChange={(open) => setRuntimeMenuOpen(environmentID, open)}
                    primaryActionGuidanceOpen={environmentLibraryOverlayOpenFor(activeEnvironmentOverlayState(), 'primary_action_guidance', environmentID)}
                    onPrimaryActionGuidanceOpenChange={(open) => setPrimaryActionGuidanceOpen(environmentID, open)}
                    guidanceSession={guidanceSessionForEnvironment(environmentID)}
                    openEnvironment={props.openEnvironment}
                    runLocalEnvironmentAction={props.runLocalEnvironmentAction}
                    refreshEnvironmentRuntime={props.refreshEnvironmentRuntime}
                    runEnvironmentGuidanceAction={props.runEnvironmentGuidanceAction}
                    toggleEnvironmentPinned={props.toggleEnvironmentPinned}
                    copyEnvironmentValue={props.copyEnvironmentValue}
                    editEnvironment={props.editEnvironment}
                    deleteEnvironment={props.deleteEnvironment}
                    setGuidanceSession={(nextSession) => setGuidanceSessionState(nextSession)}
                    environmentFailure={props.environmentFailures.get(environmentID) ?? null}
                    dismissEnvironmentFailure={() => props.dismissEnvironmentFailure(environmentID)}
                  />
                )}
              </For>
              <Show when={props.showQuickAddCards}>
                <NewEnvironmentPlaceholderCard
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

function EnvironmentCardFactsBlock(props: Readonly<{
  facts: readonly EnvironmentCardFactModel[];
  minRows?: number;
}>) {
  return (
    <div
      class="space-y-0 redeven-card-facts-block"
      style={props.minRows && props.minRows > 0
        ? { 'min-height': `calc(${props.minRows} * var(--redeven-card-fact-row-min-height))` }
        : undefined}
    >
      <For each={props.facts}>
        {(fact) => (
          <div class="redeven-card-fact-row">
            <div class="redeven-card-fact-label">{fact.label}</div>
            <div
              class={cn(
                'redeven-card-fact-value',
                fact.value_tone === 'placeholder' && 'redeven-card-fact-value--placeholder',
              )}
              title={fact.value}
            >
              {fact.value}
            </div>
          </div>
        )}
      </For>
    </div>
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

function EnvironmentCardEndpointBlock(props: Readonly<{
  endpoints: readonly EnvironmentCardEndpointModel[];
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
}>) {
  return (
    <div class="redeven-endpoints-section">
      <div class="redeven-endpoints-title">Endpoints</div>
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
  );
}

function isEnvironmentActionBusy(
  action: EnvironmentActionModel,
  busyState: DesktopLauncherBusyState | undefined,
  environmentID: string,
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
      return busyStateMatchesEnvironment(busyState, environmentID, ['start_environment_runtime']);
    case 'connect_provider_runtime':
      return busyStateMatchesEnvironment(busyState, environmentID, ['connect_provider_runtime']);
    case 'disconnect_provider_runtime':
      return busyStateMatchesEnvironment(busyState, environmentID, ['disconnect_provider_runtime']);
    case 'stop_runtime':
      return busyStateMatchesEnvironment(busyState, environmentID, ['stop_environment_runtime']);
    case 'refresh_runtime':
      return busyStateMatchesEnvironment(busyState, environmentID, ['refresh_environment_runtime'])
        || busyStateMatchesAction(busyState, 'refresh_all_environment_runtimes');
    default:
      return false;
  }
}

function sshRuntimeActivityLabel(
  progress: DesktopLauncherActionProgress,
  environments: readonly DesktopEnvironmentEntry[],
): string {
  const explicitLabel = trimString(progress.environment_label);
  if (explicitLabel !== '') {
    return explicitLabel;
  }
  const progressEnvironmentID = trimString(progress.environment_id);
  const environment = environments.find((entry) => (
    (progressEnvironmentID !== '' && entry.id === progressEnvironmentID)
    || environmentMatchesActionProgress(entry.id, progress)
  ));
  return environment?.label ?? progressEnvironmentID ?? 'SSH Environment';
}

function SSHRuntimeActivityOverlay(props: Readonly<{
  snapshot: DesktopWelcomeSnapshot;
  progressItems: readonly DesktopLauncherActionProgress[];
  cancelOperation: (progress: DesktopLauncherActionProgress) => void;
}>) {
  return (
    <Portal>
      <Show when={props.progressItems.length > 0}>
        <section class="redeven-ssh-runtime-activity" aria-live="polite" aria-label="SSH runtime activity">
          <div class="redeven-ssh-runtime-activity__header">
            <div class="redeven-ssh-runtime-activity__title">
              <Terminal class="h-3.5 w-3.5" />
              <span>Starting SSH Runtime</span>
            </div>
            <span class="redeven-ssh-runtime-activity__count">
              {props.progressItems.length === 1 ? '1 active task' : `${props.progressItems.length} active tasks`}
            </span>
          </div>
          <div class="redeven-ssh-runtime-activity__list">
            <For each={props.progressItems}>
              {(progress) => (
                <div class="redeven-ssh-runtime-activity__item">
                  <div class="redeven-ssh-runtime-activity__item-header">
                    <span class="redeven-ssh-runtime-activity__label">
                      {sshRuntimeActivityLabel(progress, props.snapshot.environments)}
                    </span>
                    <span class="redeven-ssh-runtime-activity__phase">
                      {progress.title}
                    </span>
                  </div>
                  <div class="redeven-ssh-runtime-activity__detail">
                    {progress.detail}
                  </div>
                  <div class="mt-2 flex items-center justify-between gap-2">
                    <span class="text-[11px] font-medium text-muted-foreground">
                      {progress.deleted_subject
                        ? 'Connection removed'
                        : progress.status === 'canceling'
                          ? 'Stopping'
                          : progress.status === 'cleanup_failed'
                            ? 'Cleanup needs attention'
                            : progress.status === 'canceled'
                              ? 'Canceled'
                              : 'Running'}
                    </span>
                    <Show when={progress.cancelable === true && progress.status === 'running'}>
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-7 gap-1.5 px-2 text-[11px]"
                        title={progress.interrupt_detail || 'Stop this background task.'}
                        onClick={() => props.cancelOperation(progress)}
                      >
                        <Stop class="h-3 w-3" />
                        {progress.interrupt_label || 'Stop'}
                      </Button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>
    </Portal>
  );
}

function blockedPrimaryActionTriggerLabel(label: string): string {
  return `${label} is unavailable. Show recovery options.`;
}

function EnvironmentPrimaryActionPanel(props: Readonly<{
  overlay: Extract<EnvironmentPrimaryActionOverlayModel, Readonly<{ kind: 'popover' }>>;
  environmentID: string;
  busyState?: DesktopLauncherBusyState;
  session: EnvironmentGuidanceSessionState;
  onRunAction: (action: EnvironmentActionModel) => void;
}>) {
  const notice = createMemo(() => (
    props.overlay.actions.length > 0 ? guidanceSessionNotice(props.session) : null
  ));
  const panelBusy = createMemo(() => props.session?.pending_intent !== null);

  return (
    <div class="redeven-action-popover" tabIndex={-1}>
      <div class="redeven-action-popover__title">{props.overlay.title}</div>
      <div class="redeven-action-popover__detail">{props.overlay.detail}</div>
      <Show when={notice()}>
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
              const loading = () => isEnvironmentActionBusy(item.action, props.busyState, props.environmentID);
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

function splitMenuItemTone(intent: EnvironmentActionIntent): string {
  switch (intent) {
    case 'stop_runtime':
      return 'light-dark(#dc2626, #f87171)';
    case 'start_runtime':
    case 'connect_provider_runtime':
      return 'light-dark(#2563eb, #60a5fa)';
    case 'disconnect_provider_runtime':
      return 'light-dark(#7c3aed, #a78bfa)';
    default:
      return '';
  }
}

function EnvironmentSplitActionButton(props: Readonly<{
  presentation: Extract<EnvironmentActionPresentation, Readonly<{ kind: 'split_button' }>>;
  environmentID: string;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  guidanceSession: EnvironmentGuidanceSessionState;
  busyState?: DesktopLauncherBusyState;
  loading?: boolean;
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
      eyebrow: notice.tone === 'success' ? 'Ready' : notice.tone === 'error' ? 'Needs attention' : 'Working',
      title: notice.title,
      detail: notice.detail,
      actions: [],
    };
  });
  const primaryActionOverlay = createMemo(() => props.presentation.primary_action_overlay ?? sessionPopoverOverlay());
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
  const primaryButtonClass = createMemo(() => (
    cn('w-full justify-center', hasMenuActions() && 'rounded-r-none border-r-0')
  ));
  const renderPrimaryActionIcon = () => (
    props.presentation.primary_action.intent === 'reconnect_provider'
      ? <ShieldCheck class="mr-1 h-3.5 w-3.5" />
      : null
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
        <Show when={primaryActionOverlay()} fallback={renderPrimaryButton()}>
          <Show
            when={popoverOverlay()}
            fallback={(
              <DesktopTooltip
                content={tooltipOverlay()!.message}
                placement="top"
                anchorClass="flex w-full"
              >
                {renderPrimaryButton()}
              </DesktopTooltip>
            )}
          >
            {(overlay) => (
              <DesktopActionPopover
                open={props.guidanceOpen}
                onOpenChange={(open) => {
                  if (open) {
                    closeMenu();
                  }
                  props.onGuidanceOpenChange(open);
                }}
                content={(
                  <EnvironmentPrimaryActionPanel
                    overlay={overlay()}
                    environmentID={props.environmentID}
                    busyState={props.busyState}
                    session={props.guidanceSession}
                    onRunAction={(action) => {
                      closeMenu();
                      props.onRunGuidanceAction(action);
                    }}
                  />
                )}
                placement="top"
                anchorClass="flex w-full"
                popoverAriaLabel={overlay().title}
              >
                <Button
                  size="sm"
                  variant={props.presentation.primary_action.variant}
                  class={cn(
                    primaryButtonClass(),
                    blockedPrimaryActionDisabled() && 'redeven-split-action-trigger--blocked',
                  )}
                  style={{ 'min-width': 'var(--redeven-split-action-primary-min-width)' }}
                  disabled={props.loading}
                  aria-disabled={blockedPrimaryActionDisabled() ? true : undefined}
                  aria-haspopup="dialog"
                  aria-expanded={props.guidanceOpen}
                  aria-label={blockedPrimaryActionTriggerLabel(props.presentation.primary_action.label)}
                  onClick={() => {
                    closeMenu();
                    if (props.presentation.primary_action.enabled && popoverOverlay()?.actions.length === 0) {
                      props.onGuidanceOpenChange(false);
                      props.onRunAction(props.presentation.primary_action);
                      return;
                    }
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
              </DesktopActionPopover>
            )}
          </Show>
        </Show>
        <Presence>
          <Show when={props.loading}>
            <Motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              class={blockedPrimaryActionDisabled() ? 'redeven-blocked-shimmer-overlay' : 'redeven-loading-shimmer-overlay'}
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
          disabled={props.loading}
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
          class="redeven-split-menu z-[230] max-w-[min(16rem,calc(100vw-1rem))]"
          onOverlayRef={(element) => {
            menuRef = element;
          }}
        >
          <For each={props.presentation.menu_actions}>
            {(item: EnvironmentActionMenuItemModel) => {
              const icon = () => splitMenuIcon(item.action.intent);
              const toneColor = () => splitMenuItemTone(item.action.intent);
              return (
                <button
                    type="button"
                    role="menuitem"
                    class="redeven-split-menu-item"
                    style={toneColor() ? { color: toneColor() } : undefined}
                    disabled={!item.action.enabled}
                    onClick={() => {
                      closeMenu();
                      props.onRunAction(item.action);
                    }}
                  >
                    <Show when={icon()}>
                      {(Icon) => {
                        const MenuIcon = Icon();
                        return (
                          <span class="redeven-split-menu-item-icon opacity-70">
                            <MenuIcon />
                          </span>
                        );
                      }}
                    </Show>
                    {item.label}
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
  environment: DesktopEnvironmentEntry;
  busyState: DesktopLauncherBusyState;
  actionProgress: readonly DesktopLauncherActionProgress[];
  runtimeMenuOpen: boolean;
  onRuntimeMenuOpenChange: (open: boolean) => void;
  primaryActionGuidanceOpen: boolean;
  onPrimaryActionGuidanceOpenChange: (open: boolean) => void;
  guidanceSession: EnvironmentGuidanceSessionState;
  setGuidanceSession: (state: EnvironmentGuidanceSessionState) => void;
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
  runEnvironmentGuidanceAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
  ) => Promise<EnvironmentGuidanceActionResolution>;
  toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  environmentFailure: EnvironmentFailureState | null;
  dismissEnvironmentFailure: () => void;
}>) {
  const card = createMemo(() => buildEnvironmentCardModel(props.environment));
  const facts = createMemo(() => buildEnvironmentCardFactsModel(props.environment));
  const endpoints = createMemo(() => buildEnvironmentCardEndpointsModel(props.environment));
  const environmentActionModel = createMemo(() => buildProviderBackedEnvironmentActionModel(props.environment));
  const environmentActionPresentation = createMemo(() => environmentActionModel().action_presentation);
  const isCardOpen = createMemo(() => props.environment.window_state === 'open');
  const isWindowActionBusy = createMemo(() => (
    busyStateMatchesEnvironment(props.busyState, props.environment.id, [
      'open_local_environment',
      'open_provider_environment',
      'open_remote_environment',
      'open_ssh_environment',
      'focus_environment_window',
    ])
  ));
  const isRuntimeActionBusy = createMemo(() => (
    busyStateMatchesEnvironment(props.busyState, props.environment.id, [
      'start_environment_runtime',
      'stop_environment_runtime',
      'refresh_environment_runtime',
    ])
    || busyStateMatchesAction(props.busyState, 'refresh_all_environment_runtimes')
    || activeProgressForEnvironment(props.environment.id, props.busyState, props.actionProgress)?.action === 'start_environment_runtime'
  ));
  const isPinBusy = createMemo(() => (
    busyStateMatchesEnvironment(props.busyState, props.environment.id, [
      'set_local_environment_pinned',
      'set_provider_environment_pinned',
      'set_saved_environment_pinned',
      'set_saved_ssh_environment_pinned',
    ])
  ));

  return (
    <Card class={cn(
      'redeven-environment-card h-full overflow-hidden border',
      'transition-[transform,border-color,box-shadow] duration-200',
      isCardOpen()
        ? 'redeven-environment-card--open'
        : 'border-border',
      props.environmentFailure && 'redeven-environment-card--failure',
      props.environmentFailure?.tone === 'error' && 'redeven-environment-card--failure-error',
      props.environmentFailure?.tone === 'warning' && 'redeven-environment-card--failure-warning',
    )}>
      <CardHeader class="px-3.5 pb-2 pt-3.5">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="mb-1.5 flex items-center gap-1.5">
              <Tag variant={environmentKindTagVariant(props.environment.kind)} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                {card().kind_label}
              </Tag>
              <EnvironmentStatusIndicator tone={card().status_tone}>
                {card().status_label}
              </EnvironmentStatusIndicator>
              <Show when={props.environmentFailure}>
                {(failure) => (
                  <span
                    class="redeven-environment-card__failure-badge"
                    data-tone={failure().tone}
                    onClick={props.dismissEnvironmentFailure}
                    role="button"
                    tabIndex={0}
                    aria-label={`Dismiss startup failure: ${failure().message}`}
                  >
                    <span class="redeven-environment-card__failure-badge-icon" aria-hidden="true">!</span>
                    <span class="redeven-environment-card__failure-tooltip">
                      {failure().message}
                    </span>
                  </span>
                )}
              </Show>
            </div>
            <CardTitle class="truncate text-sm font-semibold" title={props.environment.label}>
              {props.environment.label}
            </CardTitle>
            <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatRelativeTimestamp(props.environment.last_used_at_ms)}</span>
              <Show when={props.environment.control_plane_label}>
                {(cpLabel) => (
                  <>
                    <span class="text-border">·</span>
                    <span>{cpLabel()}</span>
                  </>
                )}
              </Show>
            </div>
          </div>
          <DesktopTooltip content="Refresh runtime status" placement="top">
            <span>
              <ConsoleActionIconButton
                title="Refresh runtime status"
                aria-label={`Refresh runtime status for ${props.environment.label}`}
                disabled={isRuntimeActionBusy()}
                onClick={() => {
                  void props.refreshEnvironmentRuntime(props.environment, 'connect');
                }}
              >
                <Refresh class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </span>
          </DesktopTooltip>
        </div>
      </CardHeader>
      <CardContent class="flex flex-1 flex-col px-3.5 pb-2.5">
        <EnvironmentCardFactsBlock facts={facts()} minRows={4} />
        <Show when={endpoints().length > 0}>
          <div class="mt-auto">
            <EnvironmentCardEndpointBlock
              endpoints={endpoints()}
              copyEnvironmentValue={props.copyEnvironmentValue}
            />
          </div>
        </Show>
      </CardContent>
      <CardFooter class="mt-auto flex items-center gap-2 border-t border-border px-3.5 py-2.5">
        <EnvironmentSplitActionButton
          presentation={environmentActionPresentation()}
          environmentID={props.environment.id}
          menuOpen={props.runtimeMenuOpen}
          onMenuOpenChange={props.onRuntimeMenuOpenChange}
          guidanceOpen={props.primaryActionGuidanceOpen}
          onGuidanceOpenChange={props.onPrimaryActionGuidanceOpenChange}
          guidanceSession={props.guidanceSession}
          busyState={props.busyState}
          loading={isWindowActionBusy() || isRuntimeActionBusy()}
          onRunAction={(action) => {
            void props.runLocalEnvironmentAction(
              props.environment,
              action,
              'connect',
            );
          }}
          onRunGuidanceAction={(action) => {
            void (async () => {
              if (isEnvironmentGuidancePendingIntent(action.intent)) {
                props.setGuidanceSession(startEnvironmentGuidanceIntent(
                  props.guidanceSession,
                  props.environment.id,
                  action.intent,
                ));
              }
              const resolution = await props.runEnvironmentGuidanceAction(props.environment, action);
              props.setGuidanceSession(resolution.next_session);
              if (resolution.close_panel) {
                props.onPrimaryActionGuidanceOpenChange(false);
              }
            })();
          }}
        />
        <div class="flex items-center gap-0.5">
          <DesktopTooltip
            content={props.environment.pinned ? 'Unpin' : 'Pin'}
            placement="top"
          >
            <ConsoleActionIconButton
              title={props.environment.pinned ? 'Unpin environment' : 'Pin environment'}
              aria-label={props.environment.pinned ? `Unpin ${props.environment.label}` : `Pin ${props.environment.label}`}
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
              content="Settings"
              placement="top"
            >
              <ConsoleActionIconButton
                title={props.environment.kind === 'local_environment' ? 'Environment settings' : 'Connection settings'}
                aria-label={props.environment.kind === 'local_environment'
                  ? `Settings for ${props.environment.label}`
                  : `Connection settings for ${props.environment.label}`}
                onClick={() => props.editEnvironment(props.environment)}
              >
                <Settings class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
          <Show when={props.environment.can_delete}>
            <DesktopTooltip content="Delete" placement="top">
              <ConsoleActionIconButton
                title="Delete connection"
                aria-label={`Delete ${props.environment.label}`}
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
  openCreateConnectionDialog: (message?: string, preferredKind?: 'external_local_ui' | 'ssh_environment') => void;
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
          <div class="text-sm font-semibold text-foreground">New Environment</div>
          <div class="text-xs text-muted-foreground">Open a Redeven URL or connect over SSH</div>
        </div>
        <div class="flex gap-2">
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
        </div>
      </div>
    </Card>
  );
}

function ControlPlanesPanel(props: Readonly<{
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
                title="Add Provider"
                badge="Provider"
                detail="Authorize a compatible provider."
                actionLabel="Connect Provider"
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
  controlPlane: DesktopControlPlaneSummary,
): JSX.Element {
  return (
    <ControlPlaneMetricTooltipContent
      title="Every environment this provider account has published to Desktop."
      description="Published includes everything listed in Desktop for this account, whether it is online, offline, or waiting for the next provider refresh."
      status={controlPlane.environments.length === 0
        ? 'Nothing from this provider is in the Desktop catalog yet.'
        : undefined}
    />
  );
}

function controlPlaneOnlineCountTooltipContent(
  controlPlane: DesktopControlPlaneSummary,
  onlineCount: number,
): JSX.Element {
  const status = (() => {
    if (controlPlane.sync_state === 'syncing') {
      return 'A refresh is running now, so this number may change again in a moment.';
    }

    if (controlPlane.sync_state === 'ready' && controlPlane.catalog_freshness === 'fresh') {
      return onlineCount > 0
        ? 'This number matches the latest provider sync.'
        : 'The latest provider sync says none are online right now.';
    }

    return onlineCount > 0
      ? 'This number comes from the last completed sync and may already be outdated.'
      : 'The last completed sync did not report any online environments.';
  })();

  return (
    <ControlPlaneMetricTooltipContent
      title="Only published environments that are reachable right now."
      description="Online Now counts environments from Published that currently report an online runtime signal."
      status={status}
    />
  );
}

function controlPlaneLocalHostCountTooltipContent(
  stats: Readonly<{
    local_host_count: number;
    open_count: number;
  }>,
  freshestEnvironment: DesktopControlPlaneSummary['environments'][number] | null,
): JSX.Element {
  const runtimeLabel = freshestEnvironment
    ? desktopProviderEnvironmentRuntimeLabel(
      freshestEnvironment.status,
      freshestEnvironment.lifecycle_status,
    )
    : '';
  const status = stats.open_count > 0
    ? `${stats.open_count === 1 ? '1 local window is' : `${stats.open_count} local windows are`} already open right now.`
    : runtimeLabel !== ''
      ? `Most recent provider state received: ${runtimeLabel}.`
      : 'No published environment from this provider has reported a runtime state yet.';

  return (
    <ControlPlaneMetricTooltipContent
      title="Published environments that can link to this Local Environment."
      description={stats.local_host_count > 0
        ? 'Local Links counts provider environments that can bind to this Local Environment profile for local use.'
        : 'This provider has not exposed any published environments that can link to this Local Environment profile yet.'}
      status={status}
    />
  );
}

function ControlPlaneMetricTile(props: Readonly<{
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
        <SettingsHelpBadge label={props.label} content={props.help} />
      </div>
      <div class="redeven-provider-shelf__metric-value">
        {props.value}
      </div>
    </div>
  );
}

function ControlPlaneShelf(props: Readonly<{
  controlPlane: DesktopControlPlaneSummary;
  environments: readonly DesktopEnvironmentEntry[];
  busyState: DesktopLauncherBusyState;
  viewControlPlaneEnvironments: (controlPlane: DesktopControlPlaneSummary) => void;
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  deleteControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
}>) {
  const statusModel = createMemo(() => buildControlPlaneStatusModel(props.controlPlane));
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
                  <ConsoleBadge>{props.controlPlane.environments.length} envs</ConsoleBadge>
                  <Show when={stats().local_host_count > 0}>
                    <ConsoleBadge>{stats().local_host_count} local links</ConsoleBadge>
                  </Show>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{props.controlPlane.account.user_display_name}</span>
                  <span class="font-mono text-[11px]">{props.controlPlane.provider.provider_origin}</span>
                  <span>Synced {formatRelativeTimestamp(props.controlPlane.last_synced_at_ms)}</span>
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
              label="Published"
              value={props.controlPlane.environments.length}
              help={controlPlanePublishedCountTooltipContent(props.controlPlane)}
            />
            <ControlPlaneMetricTile
              label="Online Now"
              value={stats().online_count}
              help={controlPlaneOnlineCountTooltipContent(props.controlPlane, stats().online_count)}
            />
            <ControlPlaneMetricTile
              label="Local Links"
              value={stats().local_host_count}
              help={controlPlaneLocalHostCountTooltipContent(stats(), freshestEnvironment())}
            />
          </div>
        </div>
        <div class="redeven-provider-shelf__actions">
          <Button
            size="sm"
            variant="default"
            onClick={() => props.viewControlPlaneEnvironments(props.controlPlane)}
          >
            View Environments
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={isReconnectBusy()}
            onClick={() => {
              void props.reconnectControlPlane(props.controlPlane);
            }}
          >
            Reconnect
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
            Refresh
          </Button>
          <div class="flex-1" />
          <ConsoleActionIconButton
            title="Remove Provider"
            danger
            onClick={() => props.deleteControlPlane(props.controlPlane)}
            aria-label={`Remove ${controlPlaneName(props.controlPlane)}`}
          >
            <Trash class="h-4 w-4" />
          </ConsoleActionIconButton>
        </div>
      </div>
    </section>
  );
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

const LOCAL_ENVIRONMENT_SETTINGS_CARD_CLASS = 'redeven-tile rounded-md border border-border px-4 py-4';

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

function settingsAddressCardTitle(accessMode: DesktopAccessMode): string {
  return accessMode === 'custom_exposure' ? 'Bind address' : 'Port';
}

function settingsAddressCardHelp(accessMode: DesktopAccessMode): string {
  if (accessMode === 'custom_exposure') {
    return 'Edit the bind host and port directly for the next desktop-managed start. Non-loopback binds require a password.';
  }
  return accessMode === 'shared_local_network'
    ? 'Choose the fixed port other devices on your local network will use to open this Environment.'
    : 'Choose the localhost port for the next desktop-managed start.';
}

function settingsProtectionCardTitle(accessMode: DesktopAccessMode): string {
  return accessMode === 'local_only' ? 'Protection' : 'Password';
}

function settingsProtectionCardHelp(accessMode: DesktopAccessMode): string {
  if (accessMode === 'shared_local_network') {
    return 'Shared local network access requires a password before other devices can open this Environment.';
  }
  if (accessMode === 'custom_exposure') {
    return 'Review the password used with your custom bind rules before the next desktop-managed start.';
  }
  return 'Local-only mode binds to loopback and never exposes the runtime beyond this device.';
}

function SettingsHelpBadge(props: Readonly<{
  label: string;
  content?: string | JSX.Element;
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
          aria-label={`${props.label}: more information`}
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
  accessory?: JSX.Element;
}>) {
  return (
    <div class="flex w-full items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <div class="min-w-0 text-sm font-medium text-foreground">{props.title}</div>
        <SettingsHelpBadge label={props.title} content={props.help} />
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

function LocalEnvironmentSettingsDialog(props: Readonly<{
  open: boolean;
  snapshot: DesktopSettingsSurfaceSnapshot;
  baselineSnapshot: DesktopSettingsSurfaceSnapshot;
  draft: DesktopSettingsDraft;
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
}>) {
  const [accessModeOverride, setAccessModeOverride] = createSignal<DesktopAccessMode | null>(null);
  const accessModelOptions = createMemo(() => ({
    current_runtime_url: props.snapshot.current_runtime_url,
    local_ui_password_configured: props.baselineSnapshot.local_ui_password_configured,
    runtime_password_required: props.baselineSnapshot.runtime_password_required,
    mode_override: accessModeOverride(),
  }));
  const accessModel = createMemo(() => deriveDesktopAccessDraftModel(props.draft, accessModelOptions()));
  const addressCardTitle = createMemo(() => settingsAddressCardTitle(accessModel().access_mode));
  const addressCardHelp = createMemo(() => settingsAddressCardHelp(accessModel().access_mode));
  const protectionCardTitle = createMemo(() => settingsProtectionCardTitle(accessModel().access_mode));
  const protectionCardHelp = createMemo(() => settingsProtectionCardHelp(accessModel().access_mode));
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
      title={props.baselineSnapshot.window_title}
      class={LOCAL_ENVIRONMENT_SETTINGS_DIALOG_CLASS}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={props.cancelSettings}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={busyStateMatchesAction(props.busyState, 'save_settings')}
            aria-label={props.baselineSnapshot.save_label}
            title={props.baselineSnapshot.save_label}
            onClick={() => {
              void props.saveSettings();
            }}
          >
            {compactSaveActionLabel()}
          </Button>
        </div>
      )}
    >
      <div class="space-y-6">
        {/* Runtime status strip */}
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
                <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Runtime</div>
                <div class={cn(
                  'mt-0.5 truncate text-xs font-medium text-foreground',
                  describeRuntimeAddress(accessModel().current_runtime_url).primary_monospace && 'font-mono text-[12px]',
                )}>
                  {describeRuntimeAddress(accessModel().current_runtime_url).primary}
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
                <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Next start</div>
                <div class="mt-0.5 flex items-baseline gap-1.5">
                  <div class={cn(
                    'truncate text-xs font-medium text-foreground',
                    describeNextStartAddress(accessModel().next_start_address_display).primary_monospace && 'font-mono text-[12px]',
                  )}>
                    {describeNextStartAddress(accessModel().next_start_address_display).primary}
                  </div>
                  <Show when={describeNextStartAddress(accessModel().next_start_address_display).hint}>
                    <div class="truncate text-[11px] text-muted-foreground">{describeNextStartAddress(accessModel().next_start_address_display).hint}</div>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section header */}
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Access &amp; Security</div>
            <div class="mt-1 text-sm text-foreground">This Redeven profile keeps one Local Environment runtime for the current binding.</div>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <Tag variant={passwordStateTagVariant(accessModel().password_state_tone)} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
              {compactPasswordStateTagLabel(accessModel().password_state_label)}
            </Tag>
          </div>
        </div>

        <div class="space-y-6">
            {/* Visibility presets — radio-group style */}
            <section>
              <SettingsSectionHeader
                label="Visibility"
                hint="Choose how the Local Environment is exposed on the next desktop-managed start"
              />
              <div
                role="radiogroup"
                aria-label="Visibility presets"
                class="mt-3 grid gap-3 sm:grid-cols-3"
              >
                <For each={props.baselineSnapshot.access_mode_options}>
                  {(option) => {
                    const selected = createMemo(() => accessModel().access_mode === option.value);
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
                        <div class="mt-1 text-sm font-semibold text-foreground">{option.label}</div>
                        <div class="text-[11px] leading-[1.55] text-muted-foreground">{option.description}</div>
                      </button>
                    );
                  }}
                </For>
              </div>
            </section>

            {/* Port & Protection side by side */}
            <section>
              <SettingsSectionHeader
                label="Details"
                hint={`Fine-tune the ${addressCardTitle().toLowerCase()} and ${accessModel().access_mode === 'local_only' ? 'protection' : 'password'} for this preset`}
              />
              <div class="mt-3 grid gap-3 sm:grid-cols-2">
                <div class={LOCAL_ENVIRONMENT_SETTINGS_CARD_CLASS}>
                  <SettingsCardHeading title={addressCardTitle()} help={addressCardHelp()} />
                  <div class="mt-3 space-y-3">
                    <Show
                      when={accessModel().access_mode === 'custom_exposure'}
                      fallback={(
                        <>
                          <label class="block">
                            <span class="sr-only">Port</span>
                            <Input
                              value={accessModel().fixed_port_value}
                              inputMode="numeric"
                              disabled={accessModel().port_mode === 'auto'}
                              size="sm"
                              class="w-full"
                              aria-label="Port"
                              placeholder="23998"
                              onInput={(event) => props.applyAccessFixedPort(event.currentTarget.value)}
                            />
                          </label>
                          <Show when={accessModel().access_mode === 'local_only'}>
                            <div class="rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-2.5">
                              <Checkbox
                                checked={accessModel().port_mode === 'auto'}
                                onChange={props.toggleAutoPort}
                                label="Auto-select a free port each start"
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
                      />
                    </Show>
                  </div>
                </div>

                <div class={LOCAL_ENVIRONMENT_SETTINGS_CARD_CLASS}>
                  <SettingsCardHeading title={protectionCardTitle()} help={protectionCardHelp()} />
                  <div class="mt-3">
                    <Show
                      when={accessModel().access_mode === 'local_only'}
                      fallback={(
                        <LocalUIPasswordField
                          snapshot={props.baselineSnapshot}
                          draft={props.draft}
                          passwordStateLabel={accessModel().password_state_label}
                          passwordStateTone={accessModel().password_state_tone}
                          localUIPasswordCanClear={localUIPasswordCanClear()}
                          updateDraftField={props.updateDraftField}
                          clearStoredLocalUIPassword={props.clearStoredLocalUIPassword}
                          sectionTitle={protectionCardTitle()}
                        />
                      )}
                    >
                      <div class="flex items-start gap-2.5 rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-2.5">
                        <Shield class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div class="text-[11px] leading-[1.55] text-muted-foreground">
                          Loopback bind keeps the runtime on this device only. No password is required.
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
    <div class="relative">
      <Input
        id="environment-ssh-destination"
        value={props.value}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
          openMenu();
        }}
        onFocus={openMenu}
        onBlur={closeMenuSoon}
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
        placeholder="user@host or ssh-config-alias"
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
        <div
          id="environment-ssh-destination-options"
          class="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover p-1 shadow-xl"
          role="listbox"
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
                    Port {host.port}
                  </Tag>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function ConnectionDialog(props: Readonly<{
  state: ConnectionDialogState;
  sshConfigHosts: readonly DesktopSSHConfigHost[];
  error: string;
  fieldErrors: Partial<Record<string, string>>;
  busyState: DesktopLauncherBusyState;
  onOpenChange: (open: boolean) => void;
  updateField: (
    name: 'label' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'auth_mode' | 'remote_install_dir' | 'release_base_url' | 'connect_timeout_seconds',
    value: string,
  ) => void;
  switchKind: (kind: 'external_local_ui' | 'ssh_environment') => void;
  switchBootstrapStrategy: (strategy: DesktopSSHBootstrapStrategy) => void;
  clearFieldErrors: () => void;
  onConnect: () => Promise<void>;
  onSave: () => Promise<void>;
}>) {
  const isOpen = createMemo(() => props.state !== null);
  const isCreate = createMemo(() => props.state?.mode === 'create');
  const connectionKind = createMemo(() => props.state?.connection_kind ?? 'external_local_ui');
  const [advancedState, setAdvancedState] = createSignal<SSHConnectionDialogAdvancedState>({
    open: false,
    initialized_for_state_key: 'closed',
  });
  const showSSHAdvanced = createMemo(() => connectionKind() === 'ssh_environment' && advancedState().open);
  const sshBootstrapStrategy = createMemo(() => (
    props.state?.connection_kind === 'ssh_environment'
      ? props.state.bootstrap_strategy
      : DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY
  ));
  const sshReleaseBaseURLLabel = createMemo(() => (
    trimString(props.state?.connection_kind === 'ssh_environment' ? props.state.release_base_url : '') === ''
      ? DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL
      : 'Custom mirror'
  ));
  const sshBootstrapSummaryLabel = createMemo(() => {
    switch (sshBootstrapStrategy()) {
      case 'desktop_upload':
        return sshReleaseBaseURLLabel();
      case 'remote_install':
        return 'Remote installer';
      default:
        return 'Auto';
    }
  });
  const showCreateConnectAction = createMemo(() => isCreate() && connectionKind() !== 'ssh_environment');
  const connectionKindDescription = createMemo<JSX.Element>(() => {
    switch (connectionKind()) {
      case 'external_local_ui':
        return (
          <>
            Connect straight to a Redeven runtime that already exposes its own Environment URL, such as a runtime on this device or a host on your local network.
            {' '}
            <span class="font-medium text-foreground">This is not the Provider URL.</span>
          </>
        );
      case 'ssh_environment':
        return 'Deploy a Desktop-owned Local Environment profile to a host you can reach over SSH. Desktop reuses shared release artifacts on that host and keeps one runtime state set there.';
      default:
        return '';
    }
  });

  createEffect(() => {
    setAdvancedState((current) => syncSSHConnectionDialogAdvancedState(
      current,
      props.state,
    ));
  });

  return (
    <Dialog
      open={isOpen()}
      onOpenChange={props.onOpenChange}
      title={isCreate() ? 'New Environment' : 'Edit Environment'}
      class={CONNECTION_DIALOG_CLASS}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={isCreate() ? 'outline' : 'default'}
            loading={busyStateMatchesAction(props.busyState, 'save_environment')}
            onClick={() => {
              void props.onSave();
            }}
          >
            <Save class="mr-1 h-3.5 w-3.5" />
            {compactSaveActionLabel()}
          </Button>
          <Show when={showCreateConnectAction()}>
            <Button
              size="sm"
              variant="default"
              loading={busyStateMatchesAnyAction(props.busyState, [
                'open_remote_environment',
                'open_ssh_environment',
              ])}
              onClick={() => {
                void props.onConnect();
              }}
            >
              Connect
            </Button>
          </Show>
        </div>
      )}
    >
      <div
        class="space-y-4"
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
            <label class="block text-xs font-medium text-foreground">Environment Type</label>
              <SegmentedControl
                value={connectionKind()}
                onChange={(value) => props.switchKind(value as 'external_local_ui' | 'ssh_environment')}
                options={[
                  { value: 'external_local_ui', label: 'Redeven URL' },
                { value: 'ssh_environment', label: 'SSH Host' },
              ]}
              size="sm"
            />
            <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              {connectionKindDescription()}
            </div>
          </div>
        </Show>

        <div class="space-y-1.5">
          <label for="environment-label" class="block text-xs font-medium text-foreground">
            Name <span class="text-destructive">*</span>
          </label>
          <Input
            id="environment-label"
            value={props.state?.label ?? ''}
            onInput={(event) => {
              props.updateField('label', event.currentTarget.value);
              props.clearFieldErrors();
            }}
            placeholder="My Environment"
            size="sm"
            class={cn('w-full', props.fieldErrors.label && 'border-destructive ring-1 ring-destructive/20')}
          />
          <Show when={props.fieldErrors.label}>
            <div class="text-[11px] text-destructive">{props.fieldErrors.label}</div>
          </Show>
        </div>

        <Show when={connectionKind() === 'external_local_ui'}>
          <div class="space-y-1.5">
            <label for="environment-url" class="block text-xs font-medium text-foreground">
              Environment URL <span class="text-destructive">*</span>
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
        </Show>

        <Show when={connectionKind() === 'ssh_environment'}>
          <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-3">
            <div class="text-xs leading-5 text-muted-foreground">
              Desktop reuses only the exact Desktop-managed Redeven release on that host, installs it on demand when needed, and stores runtime state in that host's single runtime profile.
            </div>
            <div class="mt-3 space-y-3">
              <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
                <div class="space-y-1.5">
                  <label for="environment-ssh-destination" class="block text-xs font-medium text-foreground">
                    SSH Destination <span class="text-destructive">*</span>
                  </label>
                  <SSHDestinationCombobox
                    value={props.state?.connection_kind === 'ssh_environment' ? props.state.ssh_destination : ''}
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
                  <label for="environment-ssh-port" class="block text-xs font-medium text-foreground">Port</label>
                  <Input
                    id="environment-ssh-port"
                    value={props.state?.connection_kind === 'ssh_environment' ? props.state.ssh_port : ''}
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
                <label class="block text-xs font-medium text-foreground">Authentication</label>
                <SegmentedControl
                  value={props.state?.connection_kind === 'ssh_environment' ? props.state.auth_mode : DEFAULT_DESKTOP_SSH_AUTH_MODE}
                  onChange={(value) => props.updateField('auth_mode', value)}
                  options={[
                    { value: 'key_agent', label: 'Key / agent' },
                    { value: 'password', label: 'Password prompt' },
                  ]}
                  size="sm"
                />
                <div class="text-[11px] leading-5 text-muted-foreground">
                  Key / agent uses your existing SSH configuration. Password prompt asks only when starting the runtime and does not store the SSH password.
                </div>
              </div>
              <div class="overflow-hidden rounded-md border border-border/70 bg-background/80">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left"
                  onClick={() => setAdvancedState((current) => ({ ...current, open: !current.open }))}
                >
                  <div>
                    <div class="text-xs font-medium text-foreground">Advanced</div>
                    <div class="mt-1 text-[11px] text-muted-foreground">
                      Bootstrap delivery, remote install path, and release mirror for this SSH host.
                    </div>
                  </div>
                  <Tag variant="neutral" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                    {showSSHAdvanced() ? 'Shown' : 'Hidden'}
                  </Tag>
                </button>
                <Show when={showSSHAdvanced()}>
                  <div class="border-t border-border/70 px-3 py-3">
                    <div class="space-y-3">
                      <div class="space-y-1.5">
                        <label class="block text-xs font-medium text-foreground">Bootstrap Delivery</label>
                        <SegmentedControl
                          value={sshBootstrapStrategy()}
                          onChange={(value) => props.switchBootstrapStrategy(value as DesktopSSHBootstrapStrategy)}
                          options={[
                            { value: 'auto', label: 'Automatic' },
                            { value: 'desktop_upload', label: 'Desktop Upload' },
                            { value: 'remote_install', label: 'Remote Install' },
                          ]}
                          size="sm"
                        />
                        <div class="text-[11px] text-muted-foreground">
                          How Desktop places the runtime on this SSH host.{' '}
                          <span class="font-medium text-foreground">Source: {sshBootstrapSummaryLabel()}</span>
                        </div>
                      </div>
                      <div class="space-y-1.5">
                        <label for="environment-ssh-install-dir" class="block text-xs font-medium text-foreground">Remote Install Directory</label>
                        <Input
                          id="environment-ssh-install-dir"
                          value={props.state?.connection_kind === 'ssh_environment' ? props.state.remote_install_dir : ''}
                          onInput={(event) => props.updateField('remote_install_dir', event.currentTarget.value)}
                          placeholder="/opt/redeven-desktop/runtime"
                          size="sm"
                          class="w-full"
                          spellcheck={false}
                        />
                        <div class="text-[11px] text-muted-foreground">
                          Leave blank to use the default remote user cache: {DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR_LABEL}.
                        </div>
                      </div>
                      <div class="space-y-1.5">
                        <label for="environment-ssh-release-base-url" class="block text-xs font-medium text-foreground">Release Base URL</label>
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
                          Leave blank to use {DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL}. Set an internal release mirror when this desktop cannot use GitHub directly.
                        </div>
                      </div>
                      <div class="space-y-1.5">
                        <label for="environment-ssh-connect-timeout" class="block text-xs font-medium text-foreground">Connect Timeout (seconds)</label>
                        <Input
                          id="environment-ssh-connect-timeout"
                          value={props.state?.connection_kind === 'ssh_environment' ? props.state.connect_timeout_seconds : ''}
                          onInput={(event) => props.updateField('connect_timeout_seconds', event.currentTarget.value)}
                          placeholder={String(DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS)}
                          size="sm"
                          class="w-28"
                          spellcheck={false}
                        />
                        <div class="text-[11px] text-muted-foreground">
                          SSH connection timeout in seconds. Defaults to {DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS}s.
                        </div>
                      </div>
                    </div>
                  </div>
                </Show>
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
    </Dialog>
  );
}

function ControlPlaneDialog(props: Readonly<{
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
      title="Add Provider"
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={busyStateMatchesAction(props.busyState, 'start_control_plane_connect')}
            onClick={() => {
              void props.onConnect();
            }}
          >
            Continue in Browser
          </Button>
        </div>
      )}
    >
      <div class="space-y-4">
        <div class="space-y-1.5">
          <label for="control-plane-label" class="block text-xs font-medium text-foreground">Name</label>
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
          <label for="control-plane-origin" class="block text-xs font-medium text-foreground">Provider URL</label>
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
          Desktop will open your browser, use your current control plane session to authorize this provider, and store only a revocable desktop authorization locally.
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
  passwordStateLabel: string;
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
          {compactPasswordStateTagLabel(props.passwordStateLabel)}
        </Tag>
        <Show when={trimString(props.draft.local_ui_password) !== ''}>
          <Tag variant="primary" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
            Replacement queued
          </Tag>
        </Show>
      </div>
      <SettingsFieldInput
        field={props.snapshot.host_fields[1]!}
        value={props.draft.local_ui_password}
        updateDraftField={props.updateDraftField}
        sectionTitle={props.sectionTitle}
      />
      <Show when={props.localUIPasswordCanClear}>
        <div class="flex justify-end">
          <button
            type="button"
            class="inline-flex cursor-pointer items-center justify-start rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={props.clearStoredLocalUIPassword}
          >
            Remove stored password
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
  sectionTitle?: string;
}>) {
  const compactLabel = createMemo(() => compactSettingsFieldLabel(props.field.label));
  const helpText = createMemo(() => plainTextFromHelpHTML(props.field.helpHTML ?? ''));
  const showVisibleLabel = createMemo(() => !isRedundantSettingsFieldLabel(props.field.label, props.sectionTitle));
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
          <SettingsHelpBadge label={props.field.label} content={helpText()} />
        </div>
      </Show>
      <Input
        id={props.field.id}
        name={props.field.name}
        value={props.value}
        type={props.field.type ?? 'text'}
        autocomplete={props.field.autocomplete}
        inputMode={props.field.inputMode}
        placeholder={props.field.placeholder}
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
  return (
    <FloeProvider config={buildDesktopFloeConfig()}>
      <>
        <DesktopWelcomeShellInner {...props} />
        <CommandPalette />
      </>
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
