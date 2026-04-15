import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Motion, Presence } from 'solid-motionone';
import { cn, FloeProvider, useCommand, useTheme } from '@floegence/floe-webapp-core';
import {
  AlertCircle,
  Check,
  Copy,
  Globe,
  Lock,
  Moon,
  Pin,
  Pencil,
  Plus,
  Save,
  Search,
  Settings,
  Shield,
  Sun,
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
  Select,
  SegmentedControl,
  Tag,
} from '@floegence/floe-webapp-core/ui';

import type {
  DesktopAccessMode,
  DesktopSettingsSurfaceSnapshot,
} from '../shared/desktopSettingsSurface';
import type {
  DesktopEnvironmentEntry,
  DesktopLauncherActionResult,
  DesktopLauncherActionRequest,
  DesktopLauncherSurface,
  DesktopManagedEnvironmentRoute,
  DesktopWelcomeIssue,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import {
  isDesktopLauncherActionFailure,
  isDesktopLauncherActionSuccess,
} from '../shared/desktopLauncherIPC';
import type { DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import { desktopProviderEnvironmentRuntimeLabel } from '../shared/providerEnvironmentState';
import {
  normalizeDesktopLocalUIPasswordMode,
  type DesktopLocalUIPasswordMode,
  type DesktopSettingsDraft,
  type SaveDesktopSettingsResult,
} from '../shared/settingsIPC';
import {
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
  DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR_LABEL,
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL,
  type DesktopSSHBootstrapStrategy,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  applyDesktopAccessAutoPortToDraft,
  applyDesktopAccessFixedPortToDraft,
  applyDesktopAccessModeToDraft,
  deriveDesktopAccessDraftModel,
} from '../shared/desktopAccessModel';
import {
  buildDesktopWelcomeShellViewModel,
  buildEnvironmentCardModel,
  buildEnvironmentCardEndpointsModel,
  buildEnvironmentCardFactsModel,
  buildControlPlaneStatusModel,
  buildProviderBackedEnvironmentActionModel,
  capabilityUnavailableMessage,
  environmentLibraryCount,
  filterEnvironmentLibrary,
  splitPinnedEnvironmentEntries,
  type EnvironmentActionModel,
  type EnvironmentActionPresentation,
  type EnvironmentCardEndpointModel,
  type EnvironmentCardFactModel,
  type EnvironmentCenterTab,
  libraryFilterLabel,
  type EnvironmentLibraryFilter,
  type EnvironmentSplitMenuActionModel,
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
  describeManagedEnvironmentBindingResolution,
  resolveManagedEnvironmentBindingResolution,
  type ManagedEnvironmentBindingResolutionView,
} from './managedEnvironmentBindingResolution';
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
  type DesktopActionToastTone,
} from './actionToastModel';
import { normalizeDesktopLocalEnvironmentName } from '../shared/desktopManagedEnvironment';

type DesktopLauncherBridge = Readonly<{
  getSnapshot: () => Promise<DesktopWelcomeSnapshot>;
  performAction: (request: DesktopLauncherActionRequest) => Promise<DesktopLauncherActionResult>;
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
      openWindow?: (kind: unknown) => Promise<void>;
    }>;
  }
}

type BusyAction =
  | ''
  | 'open_managed_environment'
  | 'open_remote_environment'
  | 'open_ssh_environment'
  | 'start_control_plane_connect'
  | 'focus_environment_window'
  | 'open_managed_environment_settings'
  | 'open_control_plane_environment'
  | 'refresh_control_plane'
  | 'set_managed_environment_pinned'
  | 'set_saved_environment_pinned'
  | 'set_saved_ssh_environment_pinned'
  | 'delete_control_plane'
  | 'close_launcher_or_quit'
  | 'upsert_managed_environment'
  | 'save_settings'
  | 'save_environment'
  | 'delete_environment';

type ManagedEnvironmentConnectionDialogState = Readonly<{
  mode: 'create' | 'edit';
  connection_kind: 'managed_environment';
  environment_id: string;
  label: string;
  environment_name: string;
  local_ui_bind: string;
  local_ui_password: string;
  local_ui_password_mode: DesktopLocalUIPasswordMode;
  local_ui_password_configured: boolean;
  use_control_plane_binding: boolean;
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
}>;

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
  remote_install_dir: string;
  bootstrap_strategy: DesktopSSHBootstrapStrategy;
  release_base_url: string;
}>;

const LOCAL_UI_BIND_TOOLTIP_PATTERNS: ReadonlyArray<{
  title: string;
  patterns: readonly string[];
  description: string;
  hint?: string;
}> = [
  {
    title: 'Only this machine',
    patterns: ['localhost:<port>', '127.0.0.1:<port>'],
    description: 'Good for local-only access on this device.',
  },
  {
    title: 'One local-network address',
    patterns: ['<your-device-ip>:<port>'],
    description: 'Use your machine\'s LAN IP if another device on the same network should connect.',
    hint: 'For example, your device IP might look like 192.168.1.24 on a home or office network.',
  },
  {
    title: 'All IPv4 addresses',
    patterns: ['0.0.0.0:<port>'],
    description: 'Listens on every IPv4 interface on this machine.',
  },
] as const;

type ConnectionDialogState = ManagedEnvironmentConnectionDialogState | ExternalURLConnectionDialogState | SSHConnectionDialogState | null;

type ControlPlaneDialogState = Readonly<{
  display_label: string;
  display_label_touched: boolean;
  provider_origin: string;
}> | null;

const LOGO_LIGHT_URL = new URL('../../../internal/envapp/ui_src/public/logo.svg', import.meta.url).href;
const LOGO_DARK_URL = new URL('../../../internal/envapp/ui_src/public/logo-dark.svg', import.meta.url).href;
const SPACIOUS_ENVIRONMENT_GRID_CARD_THRESHOLD = 4;

function shouldUseSpaciousEnvironmentGrid(cardCount: number): boolean {
  return cardCount >= SPACIOUS_ENVIRONMENT_GRID_CARD_THRESHOLD;
}

const EMPTY_SETTINGS_DRAFT: DesktopSettingsDraft = {
  local_ui_bind: '',
  local_ui_password: '',
  local_ui_password_mode: 'replace',
};

const DESKTOP_FLOE_STORAGE_NAMESPACE = 'redeven-desktop-shell';
const DESKTOP_FLOE_THEME_STORAGE_KEY = 'theme';
const DESKTOP_SKIP_LINK_LABEL = 'Skip to Redeven Desktop content';
const DESKTOP_TOP_BAR_LABEL = 'Redeven Desktop toolbar';
const DESKTOP_COMMAND_PLACEHOLDER = 'Search desktop commands...';
const ACTION_TOAST_TTL_MS = 4_000;

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

const LIBRARY_FILTERS: readonly EnvironmentLibraryFilter[] = ['all', 'open', 'recent', 'saved'];
const ENVIRONMENT_CENTER_TABS: readonly Readonly<{ value: EnvironmentCenterTab; label: string }>[] = [
  { value: 'environments', label: 'Environments' },
  { value: 'control_planes', label: 'Control Planes' },
];

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function deriveManagedEnvironmentScopeNameFromName(value: string): string {
  const clean = trimString(value);
  return clean === '' ? '' : normalizeDesktopLocalEnvironmentName(clean);
}

function shouldAutoSyncManagedEnvironmentScopeName(state: ManagedEnvironmentConnectionDialogState): boolean {
  return state.use_control_plane_binding !== true
    && state.mode === 'create'
    && trimString(state.environment_id) === '';
}

function managedEnvironmentScopePreview(state: ManagedEnvironmentConnectionDialogState | null | undefined): string {
  if (!state || state.use_control_plane_binding === true) {
    return '';
  }
  const scopeName = trimString(state.environment_name) || deriveManagedEnvironmentScopeNameFromName(state.label);
  return scopeName === '' ? '' : `local/${scopeName}`;
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

function controlPlaneFilterValue(controlPlane: DesktopControlPlaneSummary): string {
  return desktopControlPlaneKey(
    controlPlane.provider.provider_origin,
    controlPlane.provider.provider_id,
  );
}

function environmentProviderFilterValue(environment: DesktopEnvironmentEntry): string {
  const providerOrigin = trimString(environment.provider_origin);
  const providerID = trimString(environment.provider_id);
  if (providerOrigin === '' || providerID === '') {
    return '';
  }
  return desktopControlPlaneKey(providerOrigin, providerID);
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

function createManagedEnvironmentConnectionDialogState(
  mode: 'create' | 'edit',
  overrides: Partial<ManagedEnvironmentConnectionDialogState> = {},
): ManagedEnvironmentConnectionDialogState {
  const passwordConfigured = overrides.local_ui_password_configured === true;
  const label = trimString(overrides.label);
  const useControlPlaneBinding = overrides.use_control_plane_binding === true
    || trimString(overrides.provider_origin) !== ''
    || trimString(overrides.provider_id) !== ''
    || trimString(overrides.env_public_id) !== '';
  const environmentName = trimString(overrides.environment_name);
  return {
    mode,
    connection_kind: 'managed_environment',
    environment_id: trimString(overrides.environment_id),
    label,
    environment_name: environmentName !== ''
      ? environmentName
      : (!useControlPlaneBinding && mode === 'create' ? deriveManagedEnvironmentScopeNameFromName(label) : ''),
    local_ui_bind: trimString(overrides.local_ui_bind) || EMPTY_SETTINGS_DRAFT.local_ui_bind || 'localhost:23998',
    local_ui_password: trimString(overrides.local_ui_password),
    local_ui_password_mode: normalizeDesktopLocalUIPasswordMode(
      overrides.local_ui_password_mode,
      passwordConfigured ? 'keep' : 'replace',
    ),
    local_ui_password_configured: passwordConfigured,
    use_control_plane_binding: useControlPlaneBinding,
    provider_origin: trimString(overrides.provider_origin),
    provider_id: trimString(overrides.provider_id),
    env_public_id: trimString(overrides.env_public_id),
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
    remote_install_dir: trimString(overrides.remote_install_dir),
    bootstrap_strategy: (trimString(overrides.bootstrap_strategy) as DesktopSSHBootstrapStrategy) || DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
    release_base_url: trimString(overrides.release_base_url),
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

function environmentKindLabel(kind: string): string {
  switch (kind) {
    case 'managed_environment':
      return 'Local';
    case 'external_local_ui':
      return 'URL';
    case 'ssh_environment':
      return 'SSH';
    default:
      return 'Environment';
  }
}

function environmentKindTagVariant(kind: string): 'neutral' | 'primary' | 'success' {
  switch (kind) {
    case 'managed_environment':
      return 'primary';
    case 'ssh_environment':
      return 'success';
    default:
      return 'neutral';
  }
}

function busyActionForLauncherRequest(request: DesktopLauncherActionRequest): BusyAction {
  switch (request.kind) {
    case 'upsert_managed_environment':
    case 'upsert_saved_environment':
    case 'upsert_saved_ssh_environment':
      return 'save_environment';
    case 'delete_managed_environment':
    case 'delete_saved_environment':
    case 'delete_saved_ssh_environment':
      return 'delete_environment';
    default:
      return request.kind;
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
  openCreateConnectionDialog: (message?: string, preferredKind?: 'managed_environment' | 'external_local_ui' | 'ssh_environment') => void;
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
        description: 'Open the selected desktop-managed environment on this machine',
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
        description: 'Edit startup, access, and exposure settings for the selected desktop-managed environment',
        category: 'Desktop',
        keybind: 'mod+,',
        icon: Settings,
        execute: () => props.openSettingsSurface(),
      },
      {
        id: 'redeven.desktop.focusEnvironmentURL',
        title: 'Connect Another Environment',
        description: 'Open the New Environment dialog for a local environment, Redeven URL, or SSH target',
        category: 'Desktop',
        icon: Search,
        execute: () => props.openCreateConnectionDialog('Create a Local Environment, enter a Redeven URL, or add an SSH target.'),
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
  const [controlPlaneDialogError, setControlPlaneDialogError] = createSignal('');
  const [busyAction, setBusyAction] = createSignal<BusyAction>('');
  const [draft, setDraft] = createSignal<DesktopSettingsDraft>(props.snapshot.settings_surface?.draft ?? EMPTY_SETTINGS_DRAFT);
  const [connectionDialogState, setConnectionDialogState] = createSignal<ConnectionDialogState>(null);
  const [controlPlaneDialogState, setControlPlaneDialogState] = createSignal<ControlPlaneDialogState>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<DesktopEnvironmentEntry | null>(null);
  const [deleteControlPlaneTarget, setDeleteControlPlaneTarget] = createSignal<DesktopControlPlaneSummary | null>(null);
  const [libraryFilter, setLibraryFilter] = createSignal<EnvironmentLibraryFilter>('all');
  const [libraryProviderFilter, setLibraryProviderFilter] = createSignal('');
  const [libraryQuery, setLibraryQuery] = createSignal('');
  const [activeCenterTab, setActiveCenterTab] = createSignal<EnvironmentCenterTab>('environments');
  const actionToastTimers = new Map<number, number>();
  let nextActionToastID = 0;
  let settingsErrorRef: HTMLElement | undefined;

  const visibleSurface = createMemo<DesktopLauncherSurface>(() => snapshot().surface);
  const status = createMemo(() => shellStatus(snapshot()));
  const shellView = createMemo(() => buildDesktopWelcomeShellViewModel(snapshot(), visibleSurface()));
  const headerLogoSrc = createMemo(() => theme.resolvedTheme() === 'light' ? LOGO_LIGHT_URL : LOGO_DARK_URL);
  const settingsSurface = createMemo<DesktopSettingsSurfaceSnapshot>(() => snapshot().settings_surface);
  const selectedManagedEnvironmentEntry = createMemo(() => (
    snapshot().environments.find((environment) => (
      environment.kind === 'managed_environment'
      && environment.id === snapshot().settings_surface.environment_id
    )) ?? snapshot().environments.find((environment) => environment.kind === 'managed_environment') ?? null
  ));
  const controlPlanes = createMemo(() => snapshot().control_planes);
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
      libraryFilter(),
      libraryQuery(),
      libraryProviderFilter(),
    )
  ));
  const managedBindingResolution = createMemo(() => {
    const state = connectionDialogState();
    if (!state || state.connection_kind !== 'managed_environment') {
      return null;
    }
    return describeManagedEnvironmentBindingResolution(
      resolveManagedEnvironmentBindingResolution(state, snapshot().environments),
      {
        isCreate: state.mode === 'create',
      },
    );
  });

  createEffect(() => {
    const activeProviderFilter = libraryProviderFilter();
    if (activeProviderFilter === '') {
      return;
    }
    if (!controlPlanes().some((controlPlane) => controlPlaneFilterValue(controlPlane) === activeProviderFilter)) {
      setLibraryProviderFilter('');
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
    setSnapshot(nextSnapshot);
  });
  onCleanup(unsubscribeSnapshot);

  createEffect(() => {
    setDraft(snapshot().settings_surface?.draft ?? EMPTY_SETTINGS_DRAFT);
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

  async function refreshSnapshot(): Promise<void> {
    const nextSnapshot = await props.runtime.launcher.getSnapshot();
    setSnapshot(nextSnapshot);
  }

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
  ): void {
    const queued = queueDesktopActionToast({
      current: actionToasts(),
      next: {
        id: ++nextActionToastID,
        tone,
        message,
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
    const handle = window.setTimeout(() => {
      dismissActionToast(activeToastID);
    }, ACTION_TOAST_TTL_MS);
    actionToastTimers.set(activeToastID, handle);
  }

  async function handleLauncherActionFailure(
    failure: Extract<DesktopLauncherActionResult, Readonly<{ ok: false }>>,
    errorTarget: 'connect' | 'settings' | 'dialog' | 'control_plane_dialog',
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
      showActionToast(presentation.message, presentation.tone);
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

  function openSettingsSurface(environmentID = selectedManagedEnvironmentEntry()?.id ?? ''): void {
    if (environmentID === '') {
      setSettingsError('Choose an environment first.');
      return;
    }
    resetMessages();
    setConnectionDialogState(null);
    setControlPlaneDialogState(null);
    setBusyAction('open_managed_environment_settings');
    void props.runtime.launcher.performAction({ kind: 'open_managed_environment_settings', environment_id: environmentID })
      .catch((error) => {
        setSettingsError(getErrorMessage(error));
      })
      .finally(() => {
        setBusyAction('');
      });
  }

  function openCreateConnectionDialog(
    message = '',
    preferredKind: 'managed_environment' | 'external_local_ui' | 'ssh_environment' = 'managed_environment',
  ): void {
    if (snapshot().surface !== 'connect_environment') {
      showConnectEnvironment(message || 'Open the launcher to add a connection.');
      return;
    }
    setActiveCenterTab('environments');
    setLibraryProviderFilter('');
    if (trimString(message) !== '') {
      showActionToast(message, 'info');
    }
    setSettingsError('');
    setConnectionDialogError('');
    setControlPlaneDialogError('');
    setControlPlaneDialogState(null);
    setConnectionDialogState(
      preferredKind === 'managed_environment'
        ? createManagedEnvironmentConnectionDialogState('create', {
          local_ui_bind: 'localhost:23998',
          local_ui_password_mode: 'replace',
        })
        : preferredKind === 'ssh_environment'
        ? createSSHConnectionDialogState('create', {
          bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
        })
        : createExternalURLConnectionDialogState('create', {
          external_local_ui_url: trimString(snapshot().suggested_remote_url),
        }),
    );
  }

  function startEditingEnvironment(environment: DesktopEnvironmentEntry): void {
    if (environment.kind === 'managed_environment' && environment.managed_has_local_hosting) {
      setConnectionDialogState(createManagedEnvironmentConnectionDialogState('edit', {
        environment_id: environment.id,
        label: environment.label,
        environment_name: environment.managed_environment_name ?? '',
        local_ui_bind: environment.managed_local_ui_bind ?? 'localhost:23998',
        local_ui_password_mode: environment.managed_local_ui_password_configured ? 'keep' : 'replace',
        local_ui_password_configured: environment.managed_local_ui_password_configured === true,
        use_control_plane_binding: trimString(environment.provider_origin) !== '',
        provider_origin: environment.provider_origin ?? '',
        provider_id: environment.provider_id ?? '',
        env_public_id: environment.env_public_id ?? '',
      }));
    } else if (environment.kind === 'managed_environment') {
      openSettingsSurface(environment.id);
    } else if (environment.kind === 'ssh_environment') {
      setConnectionDialogState(createSSHConnectionDialogState('edit', {
        environment_id: environment.id,
        label: environment.label,
        ssh_destination: environment.ssh_details?.ssh_destination ?? '',
        ssh_port: environment.ssh_details?.ssh_port == null ? '' : String(environment.ssh_details.ssh_port),
        remote_install_dir: environment.ssh_details?.remote_install_dir === DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR
          ? ''
          : (environment.ssh_details?.remote_install_dir ?? ''),
        bootstrap_strategy: environment.ssh_details?.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
        release_base_url: environment.ssh_details?.release_base_url ?? '',
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
  }

  function openCreateControlPlaneDialog(message = ''): void {
    if (snapshot().surface !== 'connect_environment') {
      showConnectEnvironment(message || 'Open the launcher to add a Control Plane.');
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
    setLibraryFilter('all');
    setLibraryQuery('');
    setLibraryProviderFilter(controlPlaneFilterValue(controlPlane));
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

  function toggleManagedEnvironmentControlPlaneBinding(enabled: boolean): void {
    setConnectionDialogState((current) => {
      if (!current || current.connection_kind !== 'managed_environment') {
        return current;
      }
      if (!enabled) {
        return {
          ...current,
          use_control_plane_binding: false,
          environment_name: trimString(current.environment_name) || deriveManagedEnvironmentScopeNameFromName(current.label),
          provider_origin: '',
          provider_id: '',
          env_public_id: '',
        };
      }
      const firstControlPlane = snapshot().control_planes[0] ?? null;
      if (!firstControlPlane) {
        return current;
      }
      const currentMatchesFirstControlPlane = (
        current.provider_origin === firstControlPlane.provider.provider_origin
        && current.provider_id === firstControlPlane.provider.provider_id
      );
      return {
        ...current,
        use_control_plane_binding: true,
        provider_origin: firstControlPlane.provider.provider_origin,
        provider_id: firstControlPlane.provider.provider_id,
        env_public_id: currentMatchesFirstControlPlane ? current.env_public_id : '',
      };
    });
  }

  function selectManagedEnvironmentControlPlane(controlPlaneKey: string): void {
    setConnectionDialogState((current) => {
      if (!current || current.connection_kind !== 'managed_environment') {
        return current;
      }
      const controlPlane = snapshot().control_planes.find((entry) => controlPlaneFilterValue(entry) === controlPlaneKey) ?? null;
      if (!controlPlane) {
        return {
          ...current,
          use_control_plane_binding: current.use_control_plane_binding,
          provider_origin: '',
          provider_id: '',
          env_public_id: '',
        };
      }
      const currentEnvironmentStillAvailable = (
        current.provider_origin === controlPlane.provider.provider_origin
        && current.provider_id === controlPlane.provider.provider_id
        && controlPlane.environments.some((environment) => environment.env_public_id === current.env_public_id)
      );
      return {
        ...current,
        provider_origin: controlPlane.provider.provider_origin,
        provider_id: controlPlane.provider.provider_id,
        env_public_id: currentEnvironmentStillAvailable ? current.env_public_id : '',
      };
    });
  }

  function selectManagedEnvironmentProviderEnvironment(envPublicID: string): void {
    setConnectionDialogState((current) => {
      if (!current || current.connection_kind !== 'managed_environment') {
        return current;
      }
      return {
        ...current,
        env_public_id: trimString(envPublicID),
      };
    });
  }

  function switchConnectionDialogKind(kind: 'managed_environment' | 'external_local_ui' | 'ssh_environment'): void {
    setConnectionDialogState((current) => {
      if (!current || current.mode !== 'create' || current.connection_kind === kind) {
        return current;
      }
      if (kind === 'managed_environment') {
        return createManagedEnvironmentConnectionDialogState('create', {
          label: current.label,
          local_ui_bind: 'localhost:23998',
        });
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
    name: 'label' | 'environment_name' | 'local_ui_bind' | 'local_ui_password' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'remote_install_dir' | 'release_base_url',
    value: string,
  ): void {
    setConnectionDialogState((current) => {
      if (!current) {
        return current;
      }
      if (name === 'local_ui_password' && current.connection_kind === 'managed_environment') {
        return {
          ...current,
          local_ui_password: value,
          local_ui_password_mode: passwordModeForInput(value, current.local_ui_password_configured),
        };
      }
      if (name === 'label' && current.connection_kind === 'managed_environment') {
        return {
          ...current,
          label: value,
          environment_name: shouldAutoSyncManagedEnvironmentScopeName(current)
            ? deriveManagedEnvironmentScopeNameFromName(value)
            : current.environment_name,
        };
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
    setBusyAction(busyActionForLauncherRequest(request));
    try {
      const result = await props.runtime.launcher.performAction(request);
      if (isDesktopLauncherActionFailure(result)) {
        await handleLauncherActionFailure(result, errorTarget);
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
      setBusyAction('');
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

  async function openManagedEnvironment(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    route: 'auto' | DesktopManagedEnvironmentRoute = 'auto',
  ): Promise<boolean> {
    if (environment.kind !== 'managed_environment') {
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
      kind: 'open_managed_environment',
      environment_id: environment.id,
      route,
    }, errorTarget);
    return result?.outcome === 'opened_environment_window' || result?.outcome === 'focused_environment_window';
  }

  async function openPrimaryManagedEnvironment(): Promise<void> {
    const entry = selectedManagedEnvironmentEntry();
    if (!entry) {
      setErrorMessage(visibleSurface() === 'managed_environment_settings' ? 'settings' : 'connect', 'Create a Local Environment or authorize a Control Plane first.');
      return;
    }
    await openManagedEnvironment(entry, visibleSurface() === 'managed_environment_settings' ? 'settings' : 'connect');
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
      remote_install_dir: details.remote_install_dir,
      bootstrap_strategy: details.bootstrap_strategy,
      release_base_url: details.release_base_url,
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
    route: 'auto' | DesktopManagedEnvironmentRoute = 'auto',
  ): Promise<boolean> {
    if (environment.kind === 'managed_environment') {
      return openManagedEnvironment(environment, errorTarget, route);
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

  async function triggerManagedEnvironmentAction(
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
  ): Promise<boolean> {
    switch (action.intent) {
      case 'open':
      case 'focus':
        return openManagedEnvironment(environment, errorTarget, action.route ?? 'auto');
      case 'refresh_status':
      case 'check_status':
      case 'retry_sync': {
        const controlPlane = snapshot().control_planes.find((entry) => (
          entry.provider.provider_origin === environment.provider_origin
          && entry.provider.provider_id === environment.provider_id
        )) ?? null;
        if (!controlPlane) {
          setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', 'Reconnect this Control Plane first.');
          return false;
        }
        await refreshControlPlane(controlPlane);
        return false;
      }
      case 'reconnect_provider':
        if (!environment.provider_origin) {
          setErrorMessage(errorTarget === 'settings' ? 'settings' : 'connect', 'Reconnect this Control Plane first.');
          return false;
        }
        {
          const controlPlane = snapshot().control_planes.find((entry) => (
            entry.provider.provider_origin === environment.provider_origin
            && entry.provider.provider_id === environment.provider_id
          )) ?? null;
          if (controlPlane) {
            await reconnectControlPlane(controlPlane);
            return false;
          }
          await performLauncherAction({
            kind: 'start_control_plane_connect',
            provider_origin: environment.provider_origin,
          }, errorTarget === 'settings' ? 'connect' : errorTarget);
        }
        return false;
      case 'opening':
      default:
        return false;
    }
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
      showActionToast('Continue in your browser to finish authorizing this Control Plane.', 'info');
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

  function updateDraftField(name: keyof DesktopSettingsDraft, value: string): void {
    if (name === 'local_ui_password') {
      const storedPasswordConfigured = snapshot().settings_surface.local_ui_password_configured;
      setDraft((current) => ({
        ...current,
        local_ui_password: value,
        local_ui_password_mode: passwordModeForInput(value, storedPasswordConfigured),
      }));
      return;
    }
    setDraft((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function applyAccessMode(mode: DesktopAccessMode): void {
    setDraft((current) => {
      const storedPasswordConfigured = snapshot().settings_surface.local_ui_password_configured;
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
    setDraft((current) => applyDesktopAccessFixedPortToDraft(current, portText));
  }

  function toggleAutoPort(enabled: boolean): void {
    setDraft((current) => applyDesktopAccessAutoPortToDraft(current, enabled));
  }

  function clearStoredLocalUIPassword(): void {
    setDraft((current) => ({
      ...current,
      local_ui_password: '',
      local_ui_password_mode: 'clear',
    }));
  }

  async function saveSettings(): Promise<void> {
    setSettingsError('');
    setBusyAction('save_settings');
    try {
      const result = await props.runtime.settings.save(draft());
      if (!result.ok) {
        setSettingsError(result.error);
        return;
      }
      await refreshSnapshot();
      showActionToast('Environment settings saved.');
    } catch (error) {
      setSettingsError(getErrorMessage(error));
    } finally {
      setBusyAction('');
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
    setBusyAction('save_environment');
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
      setBusyAction('');
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
    setBusyAction('save_environment');
    try {
      await props.runtime.launcher.performAction({
        kind: 'upsert_saved_ssh_environment',
        environment_id: trimString(request.environment_id),
        label: trimString(request.label),
        ssh_destination: request.details.ssh_destination,
        ssh_port: request.details.ssh_port,
        remote_install_dir: request.details.remote_install_dir,
        bootstrap_strategy: request.details.bootstrap_strategy,
        release_base_url: request.details.release_base_url,
      });
      await refreshSnapshot();
      showActionToast(request.successMessage);
      return true;
    } catch (error) {
      setErrorMessage(request.errorTarget, getErrorMessage(error));
      return false;
    } finally {
      setBusyAction('');
    }
  }

  async function saveEnvironmentFromLibrary(environment: DesktopEnvironmentEntry): Promise<void> {
    if (environment.kind === 'managed_environment') {
      setErrorMessage('connect', 'Desktop-managed environments are already saved on this device.');
      return;
    }
    if (environment.kind === 'ssh_environment') {
      const details = environment.ssh_details;
      if (!details) {
        setErrorMessage('connect', 'SSH connection details are missing.');
        return;
      }
      await upsertSavedSSHEnvironment({
        environment_id: environment.id,
        label: environment.label,
        details,
        errorTarget: 'connect',
        successMessage: environment.category === 'saved'
          ? 'Connection updated.'
          : 'Connection saved to Environment Library.',
      });
      return;
    }

    await upsertSavedEnvironment({
      environment_id: environment.id,
      label: environment.label,
      external_local_ui_url: environment.local_ui_url,
      errorTarget: 'connect',
      successMessage: environment.category === 'saved'
        ? 'Connection updated.'
        : 'Connection saved to Environment Library.',
    });
  }

  function buildManagedEnvironmentActionRequest(
    state: ManagedEnvironmentConnectionDialogState,
    errorTarget: 'connect' | 'dialog',
  ): Extract<DesktopLauncherActionRequest, Readonly<{ kind: 'upsert_managed_environment' }>> | null {
    const wantsControlPlaneBinding = state.use_control_plane_binding === true;
    const displayName = trimString(state.label);
    const localEnvironmentName = wantsControlPlaneBinding
      ? ''
      : (
        trimString(state.environment_name)
        || (shouldAutoSyncManagedEnvironmentScopeName(state)
          ? deriveManagedEnvironmentScopeNameFromName(displayName)
          : '')
      );
    if (displayName === '') {
      setErrorMessage(errorTarget, 'Name is required.');
      return null;
    }
    if (wantsControlPlaneBinding) {
      if (trimString(state.provider_origin) === '' || trimString(state.provider_id) === '') {
        setErrorMessage(errorTarget, 'Connect a Control Plane first or turn off remote access for this environment.');
        return null;
      }
      if (trimString(state.env_public_id) === '') {
        setErrorMessage(errorTarget, 'Choose a Control Plane environment.');
        return null;
      }
    } else if (localEnvironmentName === '' && !(state.mode === 'edit' && trimString(state.environment_id) !== '')) {
      setErrorMessage(errorTarget, 'Name is required.');
      return null;
    }

    return {
      kind: 'upsert_managed_environment',
      environment_id: state.environment_id || undefined,
      mode: wantsControlPlaneBinding ? 'local_with_control_plane' : 'local_only',
      environment_name: wantsControlPlaneBinding ? undefined : (localEnvironmentName || undefined),
      label: displayName,
      local_ui_bind: state.local_ui_bind,
      local_ui_password: state.local_ui_password,
      local_ui_password_mode: state.local_ui_password_mode,
      provider_origin: wantsControlPlaneBinding ? state.provider_origin : undefined,
      provider_id: wantsControlPlaneBinding ? state.provider_id : undefined,
      env_public_id: wantsControlPlaneBinding ? state.env_public_id : undefined,
    };
  }

  async function saveConnectionFromDialog(): Promise<void> {
    const state = connectionDialogState();
    if (!state) {
      return;
    }
    let saved = false;
    if (state.connection_kind === 'managed_environment') {
      const bindingResolution = managedBindingResolution();
      if (state.use_control_plane_binding === true && bindingResolution?.save_disabled) {
        setConnectionDialogError(bindingResolution.description);
        return;
      }
      const managedRequest = buildManagedEnvironmentActionRequest(state, 'dialog');
      if (!managedRequest) {
        return;
      }
      saved = (await performLauncherAction(managedRequest, 'dialog')) !== null;
    } else if (state.connection_kind === 'ssh_environment') {
      saved = await upsertSavedSSHEnvironment({
        environment_id: state.environment_id,
        label: state.label,
        details: {
          ssh_destination: state.ssh_destination,
          ssh_port: trimString(state.ssh_port) === '' ? null : Number.parseInt(state.ssh_port, 10),
          remote_install_dir: trimString(state.remote_install_dir) || DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
          bootstrap_strategy: state.bootstrap_strategy,
          release_base_url: trimString(state.release_base_url),
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

  async function connectFromDialog(): Promise<void> {
    const state = connectionDialogState();
    if (!state) {
      return;
    }
    if (state.connection_kind === 'managed_environment') {
      const bindingResolution = managedBindingResolution();
      if (state.use_control_plane_binding === true && bindingResolution?.connect_disabled) {
        setConnectionDialogError(bindingResolution.description);
        return;
      }
      const request = buildManagedEnvironmentActionRequest(state, 'dialog');
      if (!request) {
        return;
      }
      const saved = await performLauncherAction(request, 'dialog');
      if (!saved) {
        return;
      }
      await refreshSnapshot();
      const managedEntry = snapshot().environments.find((environment) => (
        environment.kind === 'managed_environment'
        && (
          (
            state.use_control_plane_binding === true
            && environment.provider_origin === trimString(state.provider_origin)
            && environment.provider_id === trimString(state.provider_id)
            && environment.env_public_id === trimString(state.env_public_id)
          )
          || (
            state.use_control_plane_binding !== true
            && (
              (trimString(state.environment_id) !== '' && environment.id === trimString(state.environment_id))
              || environment.managed_environment_name === trimString(request.environment_name)
            )
          )
        )
      )) ?? null;
      if (!managedEntry) {
        setConnectionDialogError('Desktop saved the managed environment, but could not reopen it yet.');
        return;
      }
      const opened = await openManagedEnvironment(managedEntry, 'dialog');
      if (opened) {
        closeConnectionDialog();
      }
      return;
    }
    if (state.connection_kind === 'ssh_environment') {
      await openSSHEnvironment({
        ssh_destination: state.ssh_destination,
        ssh_port: trimString(state.ssh_port) === '' ? null : Number.parseInt(state.ssh_port, 10),
        remote_install_dir: trimString(state.remote_install_dir) || DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
        bootstrap_strategy: state.bootstrap_strategy,
        release_base_url: trimString(state.release_base_url),
      }, 'dialog');
      return;
    }
    await openRemoteEnvironment(state.external_local_ui_url, 'dialog');
  }

  async function toggleEnvironmentPinned(environment: DesktopEnvironmentEntry): Promise<void> {
    const nextPinned = !environment.pinned;
    const successMessage = nextPinned
      ? `${environment.label} pinned.`
      : `${environment.label} unpinned.`;
    if (environment.kind === 'managed_environment') {
      const result = await performLauncherAction({
        kind: 'set_managed_environment_pinned',
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
        remote_install_dir: details.remote_install_dir,
        bootstrap_strategy: details.bootstrap_strategy,
        release_base_url: details.release_base_url,
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
    setBusyAction('delete_environment');
    try {
      await props.runtime.launcher.performAction({
        kind: target.kind === 'managed_environment'
          ? 'delete_managed_environment'
          : target.kind === 'ssh_environment'
            ? 'delete_saved_ssh_environment'
            : 'delete_saved_environment',
        environment_id: target.id,
      });
      await refreshSnapshot();
      setDeleteTarget(null);
      showActionToast(
        target.kind === 'managed_environment'
          ? 'Environment removed from this device.'
          : 'Connection removed from Environment Library.',
      );
    } catch (error) {
      setErrorMessage('connect', getErrorMessage(error));
    } finally {
      setBusyAction('');
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
      showActionToast('Control Plane removed from Desktop.');
    }
  }

  return (
    <>
      <DesktopCommandRegistrar
        snapshot={snapshot}
        showConnectEnvironment={showConnectEnvironment}
        openCreateConnectionDialog={openCreateConnectionDialog}
        openSettingsSurface={openSettingsSurface}
        openLocalEnvironment={openPrimaryManagedEnvironment}
        openEnvironment={openEnvironment}
        closeLauncherOrQuit={closeLauncherOrQuit}
      />
      <DesktopLauncherShell
        mainContentId="redeven-desktop-main"
        skipLinkLabel={DESKTOP_SKIP_LINK_LABEL}
        topBarLabel={DESKTOP_TOP_BAR_LABEL}
        logo={(
          <TopBarIconButton label="Connect Environment" onClick={() => showConnectEnvironment()}>
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
          busyAction={busyAction()}
          activeTab={activeCenterTab()}
          setActiveTab={setActiveCenterTab}
          libraryFilter={libraryFilter()}
          libraryProviderFilter={libraryProviderFilter()}
          libraryQuery={libraryQuery()}
          libraryEntries={libraryEntries()}
          setLibraryFilter={setLibraryFilter}
          setLibraryProviderFilter={setLibraryProviderFilter}
          setLibraryQuery={setLibraryQuery}
          openLocalEnvironment={openPrimaryManagedEnvironment}
          openSettingsSurface={openSettingsSurface}
          openCreateConnectionDialog={openCreateConnectionDialog}
          openCreateControlPlaneDialog={openCreateControlPlaneDialog}
          openRemoteEnvironment={openRemoteEnvironment}
          openSSHEnvironment={openSSHEnvironment}
          openEnvironment={openEnvironment}
          runManagedEnvironmentAction={triggerManagedEnvironmentAction}
          toggleEnvironmentPinned={toggleEnvironmentPinned}
          copyEnvironmentValue={copyEnvironmentValue}
          saveEnvironmentFromLibrary={saveEnvironmentFromLibrary}
          editEnvironment={startEditingEnvironment}
          deleteEnvironment={setDeleteTarget}
          controlPlanes={controlPlanes()}
          viewControlPlaneEnvironments={focusProviderEnvironments}
          reconnectControlPlane={reconnectControlPlane}
          refreshControlPlane={refreshControlPlane}
          deleteControlPlane={setDeleteControlPlaneTarget}
        />
      </DesktopLauncherShell>

      <DesktopActionToastViewport
        toasts={actionToasts()}
        dismissToast={dismissActionToast}
      />

      <LocalEnvironmentSettingsDialog
        open={snapshot().surface === 'managed_environment_settings'}
        snapshot={settingsSurface()}
        draft={draft()}
        busyAction={busyAction()}
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
        error={connectionDialogError()}
        busyAction={busyAction()}
        controlPlanes={snapshot().control_planes}
        bindingResolution={managedBindingResolution()}
        onOpenChange={(open) => {
          if (!open) {
            closeConnectionDialog();
          }
        }}
        updateField={updateConnectionDialogField}
        switchKind={switchConnectionDialogKind}
        toggleManagedEnvironmentControlPlaneBinding={toggleManagedEnvironmentControlPlaneBinding}
        selectManagedEnvironmentControlPlane={selectManagedEnvironmentControlPlane}
        selectManagedEnvironmentProviderEnvironment={selectManagedEnvironmentProviderEnvironment}
        openCreateControlPlaneDialog={openCreateControlPlaneDialog}
        switchBootstrapStrategy={switchSSHBootstrapStrategy}
        onConnect={connectFromDialog}
        onSave={saveConnectionFromDialog}
      />

      <ControlPlaneDialog
        state={controlPlaneDialogState()}
        error={controlPlaneDialogError()}
        busyAction={busyAction()}
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
        title={deleteTarget()?.kind === 'managed_environment' ? 'Delete Environment' : 'Delete Connection'}
        confirmText={deleteTarget()?.kind === 'managed_environment' ? 'Delete Environment' : 'Delete Connection'}
        variant="destructive"
        loading={busyAction() === 'delete_environment'}
        onConfirm={() => void deleteEnvironment()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            <Show
              when={deleteTarget()?.kind === 'managed_environment'}
              fallback={(
                <>
                  Remove <span class="font-semibold">{deleteTarget()?.label}</span> from the Environment Library?
                </>
              )}
            >
              Delete <span class="font-semibold">{deleteTarget()?.label}</span> from this device?
            </Show>
          </p>
          <p class="text-xs text-muted-foreground">
            <Show
              when={deleteTarget()?.kind === 'managed_environment'}
              fallback={'This only removes the saved Desktop entry. It does not stop the remote Environment.'}
            >
              Desktop will remove the local managed state for this device. If this environment is bound to a Control Plane, the remote environment will remain available there.
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
        title="Delete Control Plane"
        confirmText="Delete Control Plane"
        variant="destructive"
        loading={busyAction() === 'delete_control_plane'}
        onConfirm={() => void deleteControlPlane()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            Remove <span class="font-semibold">{deleteControlPlaneTarget() ? controlPlaneName(deleteControlPlaneTarget()!) : ''}</span> from Desktop?
          </p>
          <p class="text-xs text-muted-foreground">Desktop will revoke the saved authorization, then remove the local account snapshot and cached environment list.</p>
        </div>
      </ConfirmDialog>
    </>
  );
}

function DesktopActionToastViewport(props: Readonly<{
  toasts: readonly DesktopActionToast[];
  dismissToast: (toastID: number) => void;
}>) {
  return (
    <Portal>
      <Show when={props.toasts.length > 0}>
        <div class="redeven-desktop-toast-viewport" aria-live="polite" aria-atomic="true">
          <Presence>
            <For each={props.toasts}>
              {(toast) => (
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
                        {toast.tone === 'success'
                          ? 'Updated'
                          : toast.tone === 'info'
                            ? 'Notice'
                            : toast.tone === 'warning'
                              ? 'Attention'
                              : 'Could Not Complete'}
                      </div>
                      <div class="redeven-desktop-toast__message">{toast.message}</div>
                    </div>
                    <button
                      type="button"
                      class="redeven-desktop-toast__dismiss"
                      onClick={() => props.dismissToast(toast.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                </Motion.div>
              )}
            </For>
          </Presence>
        </div>
      </Show>
    </Portal>
  );
}

function ConnectEnvironmentSurface(props: Readonly<{
  snapshot: DesktopWelcomeSnapshot;
  busyAction: BusyAction;
  activeTab: EnvironmentCenterTab;
  setActiveTab: (value: EnvironmentCenterTab) => void;
  libraryFilter: EnvironmentLibraryFilter;
  libraryProviderFilter: string;
  libraryQuery: string;
  libraryEntries: readonly DesktopEnvironmentEntry[];
  setLibraryFilter: (value: EnvironmentLibraryFilter) => void;
  setLibraryProviderFilter: (value: string) => void;
  setLibraryQuery: (value: string) => void;
  openLocalEnvironment: () => Promise<void>;
  openSettingsSurface: (environmentID?: string) => void;
  openCreateConnectionDialog: (message?: string, preferredKind?: 'managed_environment' | 'external_local_ui' | 'ssh_environment') => void;
  openCreateControlPlaneDialog: (message?: string) => void;
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
    route?: 'auto' | DesktopManagedEnvironmentRoute,
  ) => Promise<boolean>;
  runManagedEnvironmentAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  saveEnvironmentFromLibrary: (environment: DesktopEnvironmentEntry) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  controlPlanes: readonly DesktopControlPlaneSummary[];
  viewControlPlaneEnvironments: (controlPlane: DesktopControlPlaneSummary) => void;
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  deleteControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
}>) {
  const visibleEnvironmentCount = createMemo(() => (
    environmentLibraryCount(
      props.snapshot,
      props.libraryFilter,
      props.libraryQuery,
      props.libraryProviderFilter,
    )
  ));
  const libraryFilterOptions = createMemo(() => (
    LIBRARY_FILTERS.map((filter) => ({
      value: filter,
      label: libraryFilterLabel(filter),
    }))
  ));
  const providerFilterOptions = createMemo(() => props.controlPlanes.map((controlPlane) => ({
    value: controlPlaneFilterValue(controlPlane),
    label: controlPlaneName(controlPlane),
    count: controlPlane.environments.length,
  })));
  const activeProviderFilterLabel = createMemo(() => (
    providerFilterOptions().find((option) => option.value === props.libraryProviderFilter)?.label ?? ''
  ));
  const controlPlaneEnvironmentCount = createMemo(() => (
    props.controlPlanes.reduce((total, controlPlane) => total + controlPlane.environments.length, 0)
  ));
  const showQuickAddCards = createMemo(() => (
    props.libraryFilter === 'all'
    && trimString(props.libraryQuery) === ''
    && trimString(props.libraryProviderFilter) === ''
  ));
  const groupedLibraryEntries = createMemo(() => splitPinnedEnvironmentEntries(props.libraryEntries));
  const useSpaciousEnvironmentLibraryLayout = createMemo(() => (
    props.activeTab === 'environments' && (
      shouldUseSpaciousEnvironmentGrid(groupedLibraryEntries().pinned_entries.length)
      || shouldUseSpaciousEnvironmentGrid(
        groupedLibraryEntries().regular_entries.length + (showQuickAddCards() ? 1 : 0),
      )
    )
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
                  Manage local and remote environments. Connect, configure, and switch between workspaces.
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
                  <Show when={providerFilterOptions().length > 0}>
                    <Show
                      when={providerFilterOptions().length < 5}
                      fallback={(
                        <select
                          class="redeven-native-select min-w-[12rem]"
                          value={props.libraryProviderFilter}
                          onChange={(event) => props.setLibraryProviderFilter(trimString(event.currentTarget.value))}
                        >
                          <option value="">All Providers</option>
                          <For each={providerFilterOptions()}>
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
                        data-active={props.libraryProviderFilter === ''}
                        aria-pressed={props.libraryProviderFilter === ''}
                        onClick={() => props.setLibraryProviderFilter('')}
                      >
                        All
                      </button>
                      <For each={providerFilterOptions()}>
                        {(option) => (
                          <button
                            type="button"
                            class="redeven-provider-pill"
                            data-active={props.libraryProviderFilter === option.value}
                            aria-pressed={props.libraryProviderFilter === option.value}
                            onClick={() => props.setLibraryProviderFilter(option.value)}
                          >
                            {option.label}
                          </button>
                        )}
                      </For>
                    </Show>
                  </Show>
                  <For each={libraryFilterOptions()}>
                    {(option) => (
                      <button
                        type="button"
                        class="redeven-console-filter"
                        data-active={props.libraryFilter === option.value}
                        aria-pressed={props.libraryFilter === option.value}
                        onClick={() => props.setLibraryFilter(option.value as EnvironmentLibraryFilter)}
                      >
                        {option.label}
                      </button>
                    )}
                  </For>
                  <div class="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                    <span>{visibleEnvironmentCount()} shown</span>
                    <span class="text-border">·</span>
                    <Show when={activeProviderFilterLabel() !== ''}>
                      <span>{activeProviderFilterLabel()}</span>
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
                  busyAction={props.busyAction}
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
                busyAction={props.busyAction}
                openCreateConnectionDialog={props.openCreateConnectionDialog}
                openEnvironment={props.openEnvironment}
                runManagedEnvironmentAction={props.runManagedEnvironmentAction}
                toggleEnvironmentPinned={props.toggleEnvironmentPinned}
                copyEnvironmentValue={props.copyEnvironmentValue}
                saveEnvironment={props.saveEnvironmentFromLibrary}
                editEnvironment={props.editEnvironment}
                deleteEnvironment={props.deleteEnvironment}
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
  busyAction: BusyAction;
  openCreateConnectionDialog: (message?: string, preferredKind?: 'managed_environment' | 'external_local_ui' | 'ssh_environment') => void;
  openEnvironment: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog',
    route?: 'auto' | DesktopManagedEnvironmentRoute,
  ) => Promise<boolean>;
  runManagedEnvironmentAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  saveEnvironment: (environment: DesktopEnvironmentEntry) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
}>) {
  const groupedEntries = createMemo(() => splitPinnedEnvironmentEntries(props.entries));

  return (
    <div class="space-y-3">
      <Show when={groupedEntries().pinned_entries.length > 0}>
        <EnvironmentCardSection
          title="Pinned"
          spacious={shouldUseSpaciousEnvironmentGrid(groupedEntries().pinned_entries.length)}
        >
          <For each={groupedEntries().pinned_entries}>
            {(environment) => (
              <EnvironmentConnectionCard
                environment={environment}
                busyAction={props.busyAction}
                openEnvironment={props.openEnvironment}
                runManagedEnvironmentAction={props.runManagedEnvironmentAction}
                toggleEnvironmentPinned={props.toggleEnvironmentPinned}
                copyEnvironmentValue={props.copyEnvironmentValue}
                saveEnvironment={props.saveEnvironment}
                editEnvironment={props.editEnvironment}
                deleteEnvironment={props.deleteEnvironment}
              />
            )}
          </For>
        </EnvironmentCardSection>
      </Show>

      <Show when={groupedEntries().regular_entries.length > 0 || props.showQuickAddCards}>
        <EnvironmentCardSection
          title={groupedEntries().pinned_entries.length > 0 ? 'Environments' : undefined}
          spacious={shouldUseSpaciousEnvironmentGrid(
            groupedEntries().regular_entries.length + (props.showQuickAddCards ? 1 : 0),
          )}
        >
          <For each={groupedEntries().regular_entries}>
            {(environment) => (
              <EnvironmentConnectionCard
                environment={environment}
                busyAction={props.busyAction}
                openEnvironment={props.openEnvironment}
                runManagedEnvironmentAction={props.runManagedEnvironmentAction}
                toggleEnvironmentPinned={props.toggleEnvironmentPinned}
                copyEnvironmentValue={props.copyEnvironmentValue}
                saveEnvironment={props.saveEnvironment}
                editEnvironment={props.editEnvironment}
                deleteEnvironment={props.deleteEnvironment}
              />
            )}
          </For>

          <Show when={props.showQuickAddCards}>
            <NewEnvironmentPlaceholderCard
              openCreateConnectionDialog={props.openCreateConnectionDialog}
            />
          </Show>
        </EnvironmentCardSection>
      </Show>

      <Show when={props.entries.length === 0 && !props.showQuickAddCards}>
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
      </Show>
    </div>
  );
}

function EnvironmentCardSection(props: Readonly<{
  title?: string;
  spacious?: boolean;
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
      <div class={cn('redeven-environment-grid', props.spacious && 'redeven-environment-grid--spacious')}>
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

function ManagedEnvironmentBindingResolutionPanel(props: Readonly<{
  resolution: ManagedEnvironmentBindingResolutionView;
}>) {
  return (
    <div
      class="rounded-md border px-3 py-3"
      classList={{
        'border-border/70 bg-background/80': props.resolution.tone === 'neutral',
        'border-primary/20 bg-primary/[0.06]': props.resolution.tone === 'primary',
        'border-emerald-500/20 bg-emerald-500/[0.08]': props.resolution.tone === 'success',
        'border-amber-500/20 bg-amber-500/[0.08]': props.resolution.tone === 'warning',
      }}
    >
      <div class="flex items-start gap-3">
        <div
          class="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-current"
          classList={{
            'border-border/70 bg-muted/30 text-muted-foreground': props.resolution.tone === 'neutral',
            'border-primary/20 bg-primary/10 text-primary': props.resolution.tone === 'primary',
            'border-emerald-500/20 bg-emerald-500/10 text-emerald-700': props.resolution.tone === 'success',
            'border-amber-500/20 bg-amber-500/10 text-amber-700': props.resolution.tone === 'warning',
          }}
        >
          <AlertCircle class="h-4 w-4" />
        </div>
        <div class="min-w-0 flex-1 space-y-1">
          <div class="text-xs font-medium text-foreground">{props.resolution.title}</div>
          <div class="text-[11px] leading-5 text-muted-foreground">{props.resolution.description}</div>
          <Show when={trimString(props.resolution.detail) !== ''}>
            <div class="text-[11px] leading-5 text-muted-foreground/90">{props.resolution.detail}</div>
          </Show>
        </div>
      </div>
    </div>
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
    <div class="space-y-0">
      <For each={props.facts}>
        {(fact) => (
          <div class="redeven-card-fact-row">
            <div class="redeven-card-fact-label">{fact.label}</div>
            <div
              class="redeven-card-fact-value"
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

function SplitActionChevronIcon(props: Readonly<{ open: boolean }>) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      class={cn('h-3.5 w-3.5 transition-transform duration-150', props.open && 'rotate-180')}
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.5"
    >
      <path d="M4.5 6.5 8 10l3.5-3.5" />
    </svg>
  );
}

function SplitActionMenuSection(props: Readonly<{
  heading: string;
  actions: readonly EnvironmentSplitMenuActionModel[];
  assignItemRef: (index: number, element: HTMLButtonElement) => void;
  onSelect: (action: EnvironmentActionModel) => void;
  onNavigate: (direction: 1 | -1) => void;
  onClose: () => void;
}>) {
  return (
    <Show when={props.actions.length > 0}>
      <div class="redeven-split-menu-section">
        <div class="redeven-split-menu-section__heading">{props.heading}</div>
        <div class="redeven-split-menu-section__items">
          <For each={props.actions}>
            {(item, index) => (
              <button
                ref={(element) => {
                  props.assignItemRef(index(), element);
                }}
                type="button"
                role="menuitem"
                class={cn(
                  'redeven-split-menu-item',
                  item.disabled && 'redeven-split-menu-item--disabled',
                )}
                disabled={item.disabled}
                aria-disabled={item.disabled ? 'true' : undefined}
                onClick={() => {
                  if (item.disabled) {
                    return;
                  }
                  props.onSelect(item.action);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    props.onNavigate(1);
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    props.onNavigate(-1);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    props.onClose();
                  }
                }}
              >
                <span class="min-w-0 flex-1">
                  <span class="redeven-split-menu-item__label">{item.label}</span>
                  <span class="redeven-split-menu-item__detail">{item.detail}</span>
                </span>
                <Show when={item.is_default}>
                  <span class="redeven-split-menu-item__check" aria-hidden="true">
                    <Check class="h-3.5 w-3.5" />
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

function ManagedEnvironmentSplitActionButton(props: Readonly<{
  environmentLabel: string;
  busy: boolean;
  presentation: Extract<EnvironmentActionPresentation, Readonly<{ kind: 'split_button' }>>;
  onAction: (action: EnvironmentActionModel) => void;
}>) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [menuPlacement, setMenuPlacement] = createSignal<'bottom-end' | 'top-end'>('bottom-end');
  const [menuFrame, setMenuFrame] = createSignal<Readonly<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  }> | null>(null);
  let anchorRef: HTMLDivElement | undefined;
  let toggleRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  const menuItemRefs: Array<HTMLButtonElement | undefined> = [];
  const menuActions = createMemo(() => props.presentation.menu_actions);
  const localActions = createMemo(() => menuActions().filter((action) => action.section === 'local'));
  const remoteActions = createMemo(() => menuActions().filter((action) => action.section === 'remote'));

  function enabledMenuIndices(): number[] {
    return menuActions().flatMap((action, index) => (action.disabled ? [] : [index]));
  }

  function focusMenuItem(index: number): void {
    queueMicrotask(() => {
      menuItemRefs[index]?.focus();
    });
  }

  function focusBoundaryMenuItem(target: 'first' | 'last'): void {
    const indices = enabledMenuIndices();
    if (indices.length === 0) {
      return;
    }
    focusMenuItem(target === 'last' ? indices[indices.length - 1]! : indices[0]!);
  }

  function moveMenuFocus(direction: 1 | -1): void {
    const indices = enabledMenuIndices();
    if (indices.length === 0) {
      return;
    }
    const activeIndex = menuItemRefs.findIndex((element) => element === document.activeElement);
    const currentPosition = indices.findIndex((index) => index === activeIndex);
    const nextPosition = currentPosition === -1
      ? (direction === 1 ? 0 : indices.length - 1)
      : (currentPosition + direction + indices.length) % indices.length;
    const nextIndex = indices[nextPosition];
    if (nextIndex !== undefined) {
      focusMenuItem(nextIndex);
    }
  }

  function updateMenuLayout(): void {
    if (!anchorRef || typeof window === 'undefined') {
      return;
    }
    const rect = anchorRef.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const estimatedHeight = Math.max(156, menuActions().length * 62 + 48);
    const menuWidth = Math.max(296, Math.ceil(rect.width));
    const margin = 8;
    const left = Math.min(
      Math.max(margin, rect.right - menuWidth),
      Math.max(margin, viewportWidth - menuWidth - margin),
    );
    const openUp = viewportHeight - rect.bottom < estimatedHeight + margin && rect.top > estimatedHeight + margin;
    setMenuPlacement(openUp ? 'top-end' : 'bottom-end');
    setMenuFrame(openUp
      ? {
        left,
        width: menuWidth,
        bottom: Math.max(margin, viewportHeight - rect.top + 8),
      }
      : {
        left,
        width: menuWidth,
        top: Math.min(viewportHeight - margin, rect.bottom + 8),
      });
  }

  function closeMenu(options: Readonly<{ focusToggle?: boolean }> = {}): void {
    setMenuOpen(false);
    if (options.focusToggle) {
      queueMicrotask(() => {
        toggleRef?.focus();
      });
    }
  }

  function openMenu(focusTarget: 'first' | 'last' | 'none' = 'first'): void {
    updateMenuLayout();
    setMenuOpen(true);
    if (focusTarget === 'first' || focusTarget === 'last') {
      focusBoundaryMenuItem(focusTarget);
    }
  }

  createEffect(() => {
    if (!menuOpen()) {
      return;
    }
    updateMenuLayout();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (anchorRef?.contains(target) || menuRef?.contains(target)) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu({ focusToggle: true });
      }
    };
    const handleLayout = () => {
      updateMenuLayout();
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleLayout);
    window.addEventListener('scroll', handleLayout, true);
    onCleanup(() => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleLayout);
      window.removeEventListener('scroll', handleLayout, true);
    });
  });

  return (
    <div ref={anchorRef} class="redeven-split-action" data-redeven-split-action="">
      <Button
        size="sm"
        variant={props.presentation.default_action.variant}
        class="min-w-0 flex-1 rounded-r-none"
        loading={props.busy}
        disabled={!props.presentation.default_action.enabled}
        onClick={() => {
          closeMenu();
          props.onAction(props.presentation.default_action);
        }}
      >
        {props.presentation.default_action.label}
      </Button>
      <Button
        ref={toggleRef}
        size="sm"
        variant={props.presentation.default_action.variant}
        class="redeven-split-action__toggle rounded-l-none px-0"
        disabled={props.busy}
        aria-haspopup="menu"
        aria-expanded={menuOpen() ? 'true' : 'false'}
        aria-label={`${props.presentation.menu_button_label} for ${props.environmentLabel}`}
        title={props.presentation.menu_button_label}
        onClick={() => {
          if (menuOpen()) {
            closeMenu();
            return;
          }
          openMenu('first');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openMenu('first');
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu('last');
            return;
          }
          if (event.key === 'Escape' && menuOpen()) {
            event.preventDefault();
            closeMenu({ focusToggle: true });
          }
        }}
      >
        <SplitActionChevronIcon open={menuOpen()} />
      </Button>
      <Show when={menuOpen() && menuFrame()}>
        {(frame) => (
          <Portal>
            <div
              ref={menuRef}
              role="menu"
              aria-label={`${props.presentation.menu_button_label} for ${props.environmentLabel}`}
              data-redeven-split-action-menu=""
              class={cn(
                'redeven-split-menu fixed z-[210]',
                menuPlacement() === 'top-end' ? 'redeven-split-menu--top' : 'redeven-split-menu--bottom',
              )}
              style={{
                left: `${frame().left}px`,
                'min-width': `${frame().width}px`,
                top: frame().top !== undefined ? `${frame().top}px` : undefined,
                bottom: frame().bottom !== undefined ? `${frame().bottom}px` : undefined,
              }}
              onKeyDown={(event) => {
                if (event.key === 'Home') {
                  event.preventDefault();
                  focusBoundaryMenuItem('first');
                  return;
                }
                if (event.key === 'End') {
                  event.preventDefault();
                  focusBoundaryMenuItem('last');
                }
              }}
            >
              <SplitActionMenuSection
                heading="Local route"
                actions={localActions()}
                assignItemRef={(index, element) => {
                  const localIndex = index;
                  menuItemRefs[localIndex] = element;
                }}
                onSelect={(action) => {
                  closeMenu();
                  props.onAction(action);
                }}
                onNavigate={moveMenuFocus}
                onClose={() => {
                  closeMenu({ focusToggle: true });
                }}
              />
              <SplitActionMenuSection
                heading="Remote route"
                actions={remoteActions()}
                assignItemRef={(index, element) => {
                  const remoteOffset = localActions().length;
                  menuItemRefs[remoteOffset + index] = element;
                }}
                onSelect={(action) => {
                  closeMenu();
                  props.onAction(action);
                }}
                onNavigate={moveMenuFocus}
                onClose={() => {
                  closeMenu({ focusToggle: true });
                }}
              />
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}

function EnvironmentConnectionCard(props: Readonly<{
  environment: DesktopEnvironmentEntry;
  busyAction: BusyAction;
  openEnvironment: (
    environment: DesktopEnvironmentEntry,
    errorTarget?: 'connect' | 'dialog',
    route?: 'auto' | DesktopManagedEnvironmentRoute,
  ) => Promise<boolean>;
  runManagedEnvironmentAction: (
    environment: DesktopEnvironmentEntry,
    action: EnvironmentActionModel,
    errorTarget?: 'connect' | 'dialog' | 'settings',
  ) => Promise<boolean>;
  toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
  saveEnvironment: (environment: DesktopEnvironmentEntry) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
}>) {
  const card = createMemo(() => buildEnvironmentCardModel(props.environment));
  const facts = createMemo(() => buildEnvironmentCardFactsModel(props.environment));
  const endpoints = createMemo(() => buildEnvironmentCardEndpointsModel(props.environment));
  const managedActionModel = createMemo(() => (
    props.environment.kind === 'managed_environment'
      ? buildProviderBackedEnvironmentActionModel(props.environment)
      : null
  ));
  const managedActionPresentation = createMemo(() => managedActionModel()?.action_presentation ?? null);
  const singleButtonManagedAction = createMemo(() => {
    const presentation = managedActionPresentation();
    return presentation?.kind === 'single_button' ? presentation.action : null;
  });
  const isEnvironmentActionBusy = createMemo(() => (
    props.busyAction === 'open_managed_environment'
    || props.busyAction === 'open_remote_environment'
    || props.busyAction === 'open_ssh_environment'
    || props.busyAction === 'focus_environment_window'
    || props.busyAction === 'refresh_control_plane'
    || props.busyAction === 'start_control_plane_connect'
  ));
  const isPinBusy = createMemo(() => (
    props.busyAction === 'set_managed_environment_pinned'
    || props.busyAction === 'set_saved_environment_pinned'
    || props.busyAction === 'set_saved_ssh_environment_pinned'
  ));

  return (
    <Card class={cn(
      'redeven-environment-card h-full overflow-hidden border',
      'transition-[transform,border-color,box-shadow] duration-200',
      props.environment.is_open
        ? 'redeven-environment-card--open'
        : 'border-border',
    )}>
      <CardHeader class="px-3.5 pb-2 pt-3.5">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="mb-1.5 flex items-center gap-1.5">
              <Tag variant={environmentKindTagVariant(props.environment.kind)} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                {environmentKindLabel(props.environment.kind)}
              </Tag>
              <EnvironmentStatusIndicator tone={card().status_tone}>
                {card().status_label}
              </EnvironmentStatusIndicator>
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
        </div>
      </CardHeader>
      <CardContent class="flex flex-1 flex-col gap-2.5 px-3.5 pb-2.5">
        <EnvironmentCardFactsBlock facts={facts()} />
        <EnvironmentCardEndpointBlock
          endpoints={endpoints()}
          copyEnvironmentValue={props.copyEnvironmentValue}
        />
      </CardContent>
      <CardFooter class="mt-auto flex items-center gap-2 border-t border-border px-3.5 py-2.5">
        <Show
          when={props.environment.kind === 'managed_environment' && managedActionModel()}
          fallback={(
            <Button
              size="sm"
              variant="default"
              class="flex-1"
              loading={isEnvironmentActionBusy()}
              disabled={props.environment.is_opening}
              onClick={() => {
                void props.openEnvironment(props.environment, 'connect');
              }}
            >
              {props.environment.open_action_label}
            </Button>
          )}
        >
          <Show
            when={managedActionPresentation()?.kind === 'split_button' && managedActionPresentation()}
            fallback={(
              <Button
                size="sm"
                variant={singleButtonManagedAction()?.variant ?? 'default'}
                class="flex-1"
                loading={isEnvironmentActionBusy()}
                disabled={!singleButtonManagedAction()?.enabled}
                onClick={() => {
                  if (!singleButtonManagedAction()) {
                    return;
                  }
                  void props.runManagedEnvironmentAction(
                    props.environment,
                    singleButtonManagedAction()!,
                    'connect',
                  );
                }}
              >
                {singleButtonManagedAction()?.label ?? 'Open'}
              </Button>
            )}
          >
            {(presentation) => (
              <ManagedEnvironmentSplitActionButton
                environmentLabel={props.environment.label}
                busy={isEnvironmentActionBusy()}
                presentation={presentation() as Extract<EnvironmentActionPresentation, Readonly<{ kind: 'split_button' }>>}
                onAction={(action) => {
                  void props.runManagedEnvironmentAction(props.environment, action, 'connect');
                }}
              />
            )}
          </Show>
        </Show>
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
          <Show when={props.environment.can_save}>
            <DesktopTooltip content="Save" placement="top">
              <ConsoleActionIconButton
                title="Save connection"
                aria-label={`Save ${props.environment.label}`}
                onClick={() => {
                  void props.saveEnvironment(props.environment);
                }}
              >
                <Save class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
          <Show when={props.environment.can_edit}>
            <DesktopTooltip
              content={props.environment.kind === 'managed_environment' ? 'Settings' : 'Edit'}
              placement="top"
            >
              <ConsoleActionIconButton
                title={props.environment.kind === 'managed_environment' ? 'Environment settings' : 'Edit connection'}
                aria-label={props.environment.kind === 'managed_environment' ? `Settings for ${props.environment.label}` : `Edit ${props.environment.label}`}
                onClick={() => props.editEnvironment(props.environment)}
              >
                {props.environment.kind === 'managed_environment'
                  ? <Settings class="h-3.5 w-3.5" />
                  : <Pencil class="h-3.5 w-3.5" />}
              </ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
          <Show when={props.environment.can_delete}>
            <DesktopTooltip content="Delete" placement="top">
              <ConsoleActionIconButton
                title={props.environment.kind === 'managed_environment' ? 'Delete environment' : 'Delete connection'}
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
  openCreateConnectionDialog: (message?: string, preferredKind?: 'managed_environment' | 'external_local_ui' | 'ssh_environment') => void;
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
          <div class="text-xs text-muted-foreground">Create a Local Environment, add a Redeven URL, or connect over SSH</div>
        </div>
        <div class="flex gap-2">
          <ConsoleChipActionButton
            onClick={(event) => {
              event.stopPropagation();
              props.openCreateConnectionDialog('', 'managed_environment');
            }}
          >
            Local
          </ConsoleChipActionButton>
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
  busyAction: BusyAction;
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
          <div class="redeven-environment-grid">
            <QuickCreateConnectionCard
              title="Add Control Plane"
              badge="Provider"
              detail="Authorize a compatible provider."
              actionLabel="Connect Provider"
              onClick={() => props.openCreateControlPlaneDialog()}
            />
          </div>
        )}
      >
        <div class="space-y-3">
          <For each={props.controlPlanes}>
            {(controlPlane) => (
              <ControlPlaneShelf
                controlPlane={controlPlane}
                environments={props.environments}
                busyAction={props.busyAction}
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

function controlPlaneManagedEnvironmentStats(
  controlPlane: DesktopControlPlaneSummary,
  environments: readonly DesktopEnvironmentEntry[],
): Readonly<{
  catalog_count: number;
  local_host_count: number;
  open_count: number;
}> {
  const providerFilter = controlPlaneFilterValue(controlPlane);
  const matchedEntries = environments.filter((environment) => (
    environment.kind === 'managed_environment'
    && environmentProviderFilterValue(environment) === providerFilter
  ));
  return {
    catalog_count: matchedEntries.length,
    local_host_count: matchedEntries.filter((environment) => environment.managed_has_local_hosting === true).length,
    open_count: matchedEntries.filter((environment) => environment.is_open).length,
  };
}

function ControlPlaneShelf(props: Readonly<{
  controlPlane: DesktopControlPlaneSummary;
  environments: readonly DesktopEnvironmentEntry[];
  busyAction: BusyAction;
  viewControlPlaneEnvironments: (controlPlane: DesktopControlPlaneSummary) => void;
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  deleteControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
}>) {
  const statusModel = createMemo(() => buildControlPlaneStatusModel(props.controlPlane));
  const stats = createMemo(() => controlPlaneManagedEnvironmentStats(
    props.controlPlane,
    props.environments,
  ));
  const freshestEnvironment = createMemo(() => {
    const environments = [...props.controlPlane.environments];
    environments.sort((left, right) => right.last_seen_at_unix_ms - left.last_seen_at_unix_ms);
    return environments[0] ?? null;
  });

  return (
    <section class="space-y-2.5">
      <div class="redeven-provider-shelf rounded-[0.625rem] border border-border bg-card">
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
                    <ConsoleBadge>{stats().local_host_count} local hosts</ConsoleBadge>
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
            <div class="redeven-tile rounded-md border border-border/70 px-3 py-3">
              <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Published
              </div>
              <div class="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {props.controlPlane.environments.length}
              </div>
              <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                Environments currently visible from this provider account.
              </div>
            </div>
            <div class="redeven-tile rounded-md border border-border/70 px-3 py-3">
              <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Unified Catalog
              </div>
              <div class="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {stats().catalog_count}
              </div>
              <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                Provider-backed entries already materialized into the Environment list.
              </div>
            </div>
            <div class="redeven-tile rounded-md border border-border/70 px-3 py-3">
              <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Local Hosts
              </div>
              <div class="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {stats().local_host_count}
              </div>
              <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                {stats().open_count > 0
                  ? `${stats().open_count} environment windows currently open from this provider.`
                  : freshestEnvironment()
                    ? `Latest provider signal: ${desktopProviderEnvironmentRuntimeLabel(
                      freshestEnvironment()!.status,
                      freshestEnvironment()!.lifecycle_status,
                    )}.`
                    : 'No published environments yet. Connect later to refresh the catalog.'}
              </div>
            </div>
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
            loading={props.busyAction === 'start_control_plane_connect'}
            onClick={() => {
              void props.reconnectControlPlane(props.controlPlane);
            }}
          >
            Reconnect
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={props.busyAction === 'refresh_control_plane'}
            disabled={props.controlPlane.sync_state === 'syncing'}
            onClick={() => {
              void props.refreshControlPlane(props.controlPlane);
            }}
          >
            Refresh
          </Button>
          <div class="flex-1" />
          <ConsoleActionIconButton
            title="Delete Control Plane"
            danger
            onClick={() => props.deleteControlPlane(props.controlPlane)}
            aria-label={`Delete ${controlPlaneName(props.controlPlane)}`}
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
  return 'Local-only mode binds to loopback and never exposes the runtime beyond this machine.';
}

function SettingsHelpBadge(props: Readonly<{
  label: string;
  content?: string;
}>) {
  const tooltip = createMemo(() => trimString(props.content));

  return (
    <Show when={tooltip()}>
      <DesktopTooltip content={<div class="max-w-xs">{tooltip()}</div>} placement="top" delay={0}>
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
  draft: DesktopSettingsDraft;
  busyAction: BusyAction;
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
    local_ui_password_configured: props.snapshot.local_ui_password_configured,
    runtime_password_required: props.snapshot.runtime_password_required,
    mode_override: accessModeOverride(),
  }));
  const accessModel = createMemo(() => deriveDesktopAccessDraftModel(props.draft, accessModelOptions()));
  const addressCardTitle = createMemo(() => settingsAddressCardTitle(accessModel().access_mode));
  const addressCardHelp = createMemo(() => settingsAddressCardHelp(accessModel().access_mode));
  const protectionCardTitle = createMemo(() => settingsProtectionCardTitle(accessModel().access_mode));
  const protectionCardHelp = createMemo(() => settingsProtectionCardHelp(accessModel().access_mode));

  createEffect(() => {
    if (!props.open) {
      setAccessModeOverride(null);
    }
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
      title={props.snapshot.window_title}
      class={LOCAL_ENVIRONMENT_SETTINGS_DIALOG_CLASS}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={props.cancelSettings}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={props.busyAction === 'save_settings'}
            aria-label={props.snapshot.save_label}
            title={props.snapshot.save_label}
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
                    describeNextStartAddress(props.snapshot.next_start_address_display).primary_monospace && 'font-mono text-[12px]',
                  )}>
                    {describeNextStartAddress(props.snapshot.next_start_address_display).primary}
                  </div>
                  <Show when={describeNextStartAddress(props.snapshot.next_start_address_display).hint}>
                    <div class="truncate text-[11px] text-muted-foreground">{describeNextStartAddress(props.snapshot.next_start_address_display).hint}</div>
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
            <div class="mt-1 text-sm text-foreground">This environment keeps its own local scope on this machine.</div>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <Tag variant={passwordStateTagVariant(props.snapshot.password_state_tone)} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
              {compactPasswordStateTagLabel(props.snapshot.password_state_label)}
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
                <For each={props.snapshot.access_mode_options}>
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
                              class="w-full font-mono"
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
                        field={props.snapshot.host_fields[0]!}
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
                          snapshot={props.snapshot}
                          draft={props.draft}
                          updateDraftField={props.updateDraftField}
                          clearStoredLocalUIPassword={props.clearStoredLocalUIPassword}
                          sectionTitle={protectionCardTitle()}
                        />
                      )}
                    >
                      <div class="flex items-start gap-2.5 rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-2.5">
                        <Shield class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div class="text-[11px] leading-[1.55] text-muted-foreground">
                          Loopback bind keeps the runtime on this machine only. No password is required.
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

function ConnectionDialog(props: Readonly<{
  state: ConnectionDialogState;
  error: string;
  busyAction: BusyAction;
  controlPlanes: readonly DesktopControlPlaneSummary[];
  bindingResolution: ManagedEnvironmentBindingResolutionView | null;
  onOpenChange: (open: boolean) => void;
  updateField: (
    name: 'label' | 'environment_name' | 'local_ui_bind' | 'local_ui_password' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'remote_install_dir' | 'release_base_url',
    value: string,
  ) => void;
  switchKind: (kind: 'managed_environment' | 'external_local_ui' | 'ssh_environment') => void;
  toggleManagedEnvironmentControlPlaneBinding: (enabled: boolean) => void;
  selectManagedEnvironmentControlPlane: (controlPlaneKey: string) => void;
  selectManagedEnvironmentProviderEnvironment: (envPublicID: string) => void;
  openCreateControlPlaneDialog: (message?: string) => void;
  switchBootstrapStrategy: (strategy: DesktopSSHBootstrapStrategy) => void;
  onConnect: () => Promise<void>;
  onSave: () => Promise<void>;
}>) {
  const isOpen = createMemo(() => props.state !== null);
  const isCreate = createMemo(() => props.state?.mode === 'create');
  const connectionKind = createMemo(() => props.state?.connection_kind ?? 'managed_environment');
  const managedEnvironmentState = createMemo(() => (
    props.state?.connection_kind === 'managed_environment' ? props.state : null
  ));
  const useControlPlaneBinding = createMemo(() => managedEnvironmentState()?.use_control_plane_binding === true);
  const bindingResolution = createMemo(() => (
    connectionKind() === 'managed_environment' && useControlPlaneBinding()
      ? props.bindingResolution
      : null
  ));
  const selectedControlPlaneKey = createMemo(() => {
    const state = managedEnvironmentState();
    if (!state || trimString(state.provider_origin) === '' || trimString(state.provider_id) === '') {
      return '';
    }
    return desktopControlPlaneKey(state.provider_origin, state.provider_id);
  });
  const selectedControlPlane = createMemo(() => (
    props.controlPlanes.find((entry) => controlPlaneFilterValue(entry) === selectedControlPlaneKey()) ?? null
  ));
  const providerEnvironmentOptions = createMemo(() => selectedControlPlane()?.environments ?? []);
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
  const connectionKindDescription = createMemo<JSX.Element>(() => {
    switch (connectionKind()) {
      case 'external_local_ui':
        return (
          <>
            Connect straight to a Redeven runtime that already exposes its own Environment URL, such as a runtime on this machine or a host on your local network.
            {' '}
            <span class="font-medium text-foreground">This is not the Control Plane URL.</span>
          </>
        );
      case 'ssh_environment':
        return 'Connect to another machine over SSH. Desktop can install the matching Redeven release on demand and tunnel its Local UI back to this desktop.';
      case 'managed_environment':
      default:
        return 'Run a Desktop-managed Redeven environment on this device. You can keep it local-only or bind it to one saved Control Plane environment for unified local and remote access.';
    }
  });
  const saveActionLabel = createMemo(() => bindingResolution()?.save_label ?? compactSaveActionLabel());
  const connectActionLabel = createMemo(() => bindingResolution()?.connect_label ?? 'Connect');
  const saveDisabled = createMemo(() => bindingResolution()?.save_disabled === true);
  const connectDisabled = createMemo(() => bindingResolution()?.connect_disabled === true);

  createEffect(() => {
    setAdvancedState((current) => syncSSHConnectionDialogAdvancedState(
      current,
      props.state?.connection_kind === 'managed_environment' ? null : props.state,
    ));
  });

  return (
    <Dialog
      open={isOpen()}
      onOpenChange={props.onOpenChange}
      title={isCreate() ? 'New Environment' : 'Edit Environment'}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={isCreate() ? 'outline' : 'default'}
            loading={props.busyAction === 'save_environment'}
            disabled={saveDisabled()}
            onClick={() => {
              void props.onSave();
            }}
          >
            <Save class="mr-1 h-3.5 w-3.5" />
            {saveActionLabel()}
          </Button>
          <Show when={isCreate()}>
            <Button
              size="sm"
              variant="default"
              loading={
                props.busyAction === 'open_managed_environment'
                || props.busyAction === 'open_remote_environment'
                || props.busyAction === 'open_ssh_environment'
              }
              disabled={connectDisabled()}
              onClick={() => {
                void props.onConnect();
              }}
            >
              {connectActionLabel()}
            </Button>
          </Show>
        </div>
      )}
    >
      <div class="space-y-4">
        <Show when={isCreate()}>
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-foreground">Environment Type</label>
            <SegmentedControl
              value={connectionKind()}
              onChange={(value) => props.switchKind(value as 'managed_environment' | 'external_local_ui' | 'ssh_environment')}
              options={[
                { value: 'managed_environment', label: 'Managed' },
                { value: 'external_local_ui', label: 'Redeven URL' },
                { value: 'ssh_environment', label: 'SSH' },
              ]}
              size="sm"
            />
            <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              {connectionKindDescription()}
            </div>
          </div>
        </Show>

        <div class="space-y-1.5">
          <label for="environment-label" class="block text-xs font-medium text-foreground">Name</label>
          <Input
            id="environment-label"
            value={props.state?.label ?? ''}
            onInput={(event) => props.updateField('label', event.currentTarget.value)}
            placeholder="My Environment"
            size="sm"
            class="w-full"
            autofocus={connectionKind() === 'managed_environment' && props.state?.mode === 'create'}
          />
        </div>

        <Show when={connectionKind() === 'managed_environment'}>
          <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-3">
            <div class="space-y-3">
              <Show when={!useControlPlaneBinding()}>
                <div class="rounded-md border border-border/70 bg-background/80 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                  <Show
                    when={managedEnvironmentState()?.mode === 'edit'}
                    fallback={(
                      <>
                        Desktop will store local state under an automatic
                        {' '}
                        <span class="font-mono text-foreground">local/&lt;name&gt;</span>
                        {' '}
                        scope derived from Name.
                        <Show when={managedEnvironmentScopePreview(managedEnvironmentState()) !== ''}>
                          <span>
                            {' '}
                            Next scope:
                            {' '}
                            <span class="font-mono text-foreground">{managedEnvironmentScopePreview(managedEnvironmentState())}</span>
                            .
                          </span>
                        </Show>
                      </>
                    )}
                  >
                    Renaming this environment only changes how it appears in Desktop.
                    <Show when={managedEnvironmentScopePreview(managedEnvironmentState()) !== ''}>
                      <span>
                        {' '}
                        Local state stays under
                        {' '}
                        <span class="font-mono text-foreground">{managedEnvironmentScopePreview(managedEnvironmentState())}</span>
                        .
                      </span>
                    </Show>
                  </Show>
                </div>
              </Show>
              <div class="space-y-1.5">
                <div class="flex items-center gap-1.5">
                  <label for="environment-local-bind" class="block text-xs font-medium text-foreground">Local UI Bind</label>
                  <DesktopTooltip
                    placement="top"
                    class="max-w-[min(32rem,calc(100vw-1rem))] overflow-hidden p-0"
                    content={(
                      <div>
                        <div class="border-b border-border/60 bg-muted/30 px-3 py-2.5">
                          <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Format
                          </div>
                          <div class="mt-1 text-sm font-semibold text-popover-foreground">
                            Choose where the Local UI listens
                          </div>
                          <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                            Enter a bind address in
                            {' '}
                            <span class="font-mono text-popover-foreground">host:port</span>
                            {' '}
                            format. These examples show patterns, not fixed values.
                          </div>
                        </div>
                        <div class="grid gap-2 px-3 py-3">
                          <For each={LOCAL_UI_BIND_TOOLTIP_PATTERNS}>
                            {(item) => (
                              <div class="rounded-md border border-border/60 bg-background/80 px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                                <div class="text-[11px] font-medium text-popover-foreground">{item.title}</div>
                                <div class="mt-1 flex flex-wrap gap-1.5">
                                  <For each={item.patterns}>
                                    {(pattern) => (
                                      <span class="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-popover-foreground">
                                        {pattern}
                                      </span>
                                    )}
                                  </For>
                                </div>
                                <div class="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                                  {item.description}
                                </div>
                                <Show when={item.hint}>
                                  <div class="mt-1 text-[10px] leading-5 text-muted-foreground/90">
                                    {item.hint}
                                  </div>
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                        <div class="border-t border-border/60 bg-background/60 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                          Replace
                          {' '}
                          <span class="font-mono text-popover-foreground">&lt;your-device-ip&gt;</span>
                          {' '}
                          and
                          {' '}
                          <span class="font-mono text-popover-foreground">&lt;port&gt;</span>
                          {' '}
                          with values for your machine. Only
                          {' '}
                          <span class="font-mono text-popover-foreground">localhost</span>
                          {' '}
                          or IP literals are supported here. Use a password if other devices can reach this address.
                        </div>
                      </div>
                    )}
                  >
                    <button
                      type="button"
                      aria-label="Local UI Bind examples"
                      class="inline-flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full border border-border/70 bg-muted/45 text-[10px] font-semibold leading-none text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition hover:border-foreground/20 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    >
                      ?
                    </button>
                  </DesktopTooltip>
                </div>
                <Input
                  id="environment-local-bind"
                  value={managedEnvironmentState()?.local_ui_bind ?? ''}
                  onInput={(event) => props.updateField('local_ui_bind', event.currentTarget.value)}
                  placeholder="localhost:23998"
                  size="sm"
                  class="w-full font-mono"
                  spellcheck={false}
                />
              </div>
              <div class="space-y-1.5">
                <label for="environment-local-password" class="block text-xs font-medium text-foreground">Local UI Password</label>
                <Input
                  id="environment-local-password"
                  value={managedEnvironmentState()?.local_ui_password ?? ''}
                  onInput={(event) => props.updateField('local_ui_password', event.currentTarget.value)}
                  placeholder={managedEnvironmentState()?.local_ui_password_configured
                    ? 'Leave blank to keep the stored password'
                    : 'Optional on loopback binds'}
                  type="password"
                  autocomplete="new-password"
                  size="sm"
                  class="w-full"
                />
                <div class="text-[11px] text-muted-foreground">
                  Use a password for non-loopback binds. Leave this blank to keep the stored password when editing.
                </div>
              </div>
              <div class="rounded-md border border-border/70 bg-background/80 px-3 py-3">
                <div class="flex items-start gap-3">
                  <Checkbox
                    checked={useControlPlaneBinding()}
                    onChange={(value) => props.toggleManagedEnvironmentControlPlaneBinding(value === true)}
                  />
                  <div class="min-w-0 flex-1 space-y-1">
                    <div class="text-xs font-medium text-foreground">Connect To A Control Plane Environment</div>
                    <div class="text-[11px] leading-5 text-muted-foreground">
                      Keep one Desktop-managed entry for local hosting on this device and remote access through a saved Control Plane.
                    </div>
                  </div>
                </div>

                <Show when={useControlPlaneBinding()}>
                  <div class="mt-3 space-y-3">
                    <Show
                      when={props.controlPlanes.length > 0}
                      fallback={(
                        <div class="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-3 text-[11px] leading-5 text-muted-foreground">
                          <div>No Control Plane is connected in Desktop yet.</div>
                          <Button
                            size="sm"
                            variant="outline"
                            class="mt-3"
                            onClick={() => props.openCreateControlPlaneDialog('Connect a Control Plane, then finish creating this environment.')}
                          >
                            Connect Control Plane
                          </Button>
                        </div>
                      )}
                    >
                      <div class="space-y-1.5">
                        <label for="managed-control-plane" class="block text-xs font-medium text-foreground">Control Plane</label>
                        <Select
                          value={selectedControlPlaneKey()}
                          onChange={(value) => props.selectManagedEnvironmentControlPlane(String(value ?? ''))}
                          options={props.controlPlanes.map((controlPlane) => ({
                            value: controlPlaneFilterValue(controlPlane),
                            label: controlPlaneName(controlPlane),
                          }))}
                          class="w-full"
                        />
                      </div>
                      <div class="space-y-1.5">
                        <label for="managed-control-plane-environment" class="block text-xs font-medium text-foreground">Control Plane Environment</label>
                        <Select
                          value={managedEnvironmentState()?.env_public_id ?? ''}
                          onChange={(value) => props.selectManagedEnvironmentProviderEnvironment(String(value ?? ''))}
                          options={providerEnvironmentOptions().map((environment) => ({
                            value: environment.env_public_id,
                            label: `${environment.label} (${desktopProviderEnvironmentRuntimeLabel(environment.status, environment.lifecycle_status)})`,
                          }))}
                          class="w-full"
                        />
                        <Show when={selectedControlPlane() && providerEnvironmentOptions().length <= 0}>
                          <div class="text-[11px] text-muted-foreground">
                            Desktop does not have any environments in the current catalog for this Control Plane. Refresh or reconnect it first.
                          </div>
                        </Show>
                      </div>
                      <div class="text-[11px] text-muted-foreground">
                        Desktop stores local state under the selected Control Plane environment scope on this device.
                      </div>
                      <Show when={bindingResolution()}>
                        {(resolution) => (
                          <ManagedEnvironmentBindingResolutionPanel resolution={resolution()} />
                        )}
                      </Show>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </Show>

        <Show when={connectionKind() === 'external_local_ui'}>
          <div class="space-y-1.5">
            <label for="environment-url" class="block text-xs font-medium text-foreground">Environment URL</label>
            <Input
              id="environment-url"
              value={props.state?.connection_kind === 'external_local_ui' ? props.state.external_local_ui_url : ''}
              onInput={(event) => props.updateField('external_local_ui_url', event.currentTarget.value)}
              placeholder="http://192.168.1.11:24000/"
              size="sm"
              class="w-full font-mono"
              spellcheck={false}
              autofocus={props.state?.mode === 'create'}
            />
          </div>
        </Show>

        <Show when={connectionKind() === 'ssh_environment'}>
          <div class="rounded-md border border-border/70 bg-muted/20 px-3 py-3">
            <div class="text-xs leading-5 text-muted-foreground">
              Desktop reuses only the exact Desktop-managed Redeven release, installs it on demand when needed, and tunnels its Local UI over SSH.
            </div>
            <div class="mt-3 space-y-3">
              <div class="space-y-1.5">
                <label for="environment-ssh-destination" class="block text-xs font-medium text-foreground">SSH Destination</label>
                <Input
                  id="environment-ssh-destination"
                  value={props.state?.connection_kind === 'ssh_environment' ? props.state.ssh_destination : ''}
                  onInput={(event) => props.updateField('ssh_destination', event.currentTarget.value)}
                  placeholder="user@host or ssh-config-alias"
                  size="sm"
                  class="w-full font-mono"
                  spellcheck={false}
                  autofocus={props.state?.mode === 'create'}
                />
              </div>
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
              </div>
              <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <div class="space-y-1.5">
                  <label for="environment-ssh-port" class="block text-xs font-medium text-foreground">Port</label>
                  <Input
                    id="environment-ssh-port"
                    value={props.state?.connection_kind === 'ssh_environment' ? props.state.ssh_port : ''}
                    onInput={(event) => props.updateField('ssh_port', event.currentTarget.value)}
                    placeholder="22"
                    inputMode="numeric"
                    size="sm"
                    class="w-full font-mono"
                  />
                </div>
                <div class="space-y-1.5">
                  <label class="block text-xs font-medium text-foreground">Source</label>
                  <Tag variant="neutral" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                    {sshBootstrapSummaryLabel()}
                  </Tag>
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
                      Keep the default remote cache or pin a custom absolute install directory.
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
                        <label for="environment-ssh-install-dir" class="block text-xs font-medium text-foreground">Remote Install Directory</label>
                        <Input
                          id="environment-ssh-install-dir"
                          value={props.state?.connection_kind === 'ssh_environment' ? props.state.remote_install_dir : ''}
                          onInput={(event) => props.updateField('remote_install_dir', event.currentTarget.value)}
                          placeholder="/opt/redeven-desktop/runtime"
                          size="sm"
                          class="w-full font-mono"
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
                          class="w-full font-mono"
                          spellcheck={false}
                        />
                        <div class="text-[11px] text-muted-foreground">
                          Leave blank to use {DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL_LABEL}. Set an internal release mirror when this desktop cannot use GitHub directly.
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
  busyAction: BusyAction;
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
      title="Add Control Plane"
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={props.busyAction === 'start_control_plane_connect'}
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
          <label for="control-plane-origin" class="block text-xs font-medium text-foreground">Control Plane URL</label>
          <Input
            id="control-plane-origin"
            value={props.state?.provider_origin ?? ''}
            onInput={(event) => props.updateField('provider_origin', event.currentTarget.value)}
            placeholder="https://region.example.invalid"
            size="sm"
            class="w-full font-mono"
            spellcheck={false}
            autofocus
          />
        </div>
        <div class="text-xs text-muted-foreground">
          Desktop will open your browser, use your current Portal session to authorize this Control Plane, and store only a revocable desktop authorization locally.
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
  updateDraftField: (name: keyof DesktopSettingsDraft, value: string) => void;
  clearStoredLocalUIPassword: () => void;
  sectionTitle?: string;
}>) {
  return (
    <div class="space-y-3">
      <div class="flex flex-wrap gap-1.5">
        <Tag
          variant={passwordStateTagVariant(props.snapshot.password_state_tone)}
          tone="soft"
          size="sm"
          class="cursor-default whitespace-nowrap"
        >
          {compactPasswordStateTagLabel(props.snapshot.password_state_label)}
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
      <Show when={props.snapshot.local_ui_password_can_clear}>
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
