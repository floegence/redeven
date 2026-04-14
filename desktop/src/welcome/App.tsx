import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
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
  DesktopOpenEnvironmentWindow,
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
  buildControlPlaneEnvironmentFactsModel,
  buildControlPlaneEnvironmentActionModel,
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
  type EnvironmentCardEndpointModel,
  type EnvironmentCardFactModel,
  type EnvironmentCenterTab,
  libraryFilterLabel,
  type EnvironmentLibraryFilter,
  shellStatus,
} from './viewModel';
import {
  dedupeNoticeKeys,
  launcherActionFailurePresentation,
  noticeKeysForEnvironment,
  noticeKeysForProviderEnvironment,
  type EnvironmentActionNotice,
} from './launcherActionFeedback';
import {
  syncSSHConnectionDialogAdvancedState,
  type SSHConnectionDialogAdvancedState,
} from './sshConnectionDialogState';
import {
  compactPasswordStateTagLabel,
  compactSaveActionLabel,
  compactSettingsFieldLabel,
  describeNextStartAddress,
  describeRuntimeAddress,
  isRedundantSettingsFieldLabel,
  compactSettingsActionLabel,
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
import { controlPlaneDesktopSessionKey } from '../main/desktopTarget';
import { suggestControlPlaneDisplayLabel } from '../shared/controlPlaneProvider';
import {
  DESKTOP_ACTION_TOAST_LIMIT,
  queueDesktopActionToast,
  type DesktopActionToast,
  type DesktopActionToastTone,
} from './actionToastModel';

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
  | 'upsert_managed_local_environment'
  | 'save_settings'
  | 'save_environment'
  | 'delete_environment';

type LauncherActionUIOptions = Readonly<{
  noticeKeys?: readonly string[];
}>;

type LocalConnectionDialogState = Readonly<{
  mode: 'create' | 'edit';
  connection_kind: 'managed_local';
  environment_id: string;
  label: string;
  environment_name: string;
  local_ui_bind: string;
  local_ui_password: string;
  local_ui_password_mode: DesktopLocalUIPasswordMode;
  local_ui_password_configured: boolean;
  remote_access_enabled: boolean;
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  preferred_open_route: 'auto' | DesktopManagedEnvironmentRoute;
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

type ConnectionDialogState = LocalConnectionDialogState | ExternalURLConnectionDialogState | SSHConnectionDialogState | null;

type ControlPlaneDialogState = Readonly<{
  display_label: string;
  display_label_touched: boolean;
  provider_origin: string;
}> | null;

const LOGO_LIGHT_URL = new URL('../../../internal/envapp/ui_src/public/logo.svg', import.meta.url).href;
const LOGO_DARK_URL = new URL('../../../internal/envapp/ui_src/public/logo-dark.svg', import.meta.url).href;

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
const ENVIRONMENT_ACTION_NOTICE_TTL_MS = 8_000;
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

function defaultLocalControlPlaneSelection(controlPlanes: readonly DesktopControlPlaneSummary[]): Readonly<{
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
}> {
  const provider = controlPlanes[0] ?? null;
  const environment = provider?.environments[0] ?? null;
  return {
    provider_origin: provider?.provider.provider_origin ?? '',
    provider_id: provider?.provider.provider_id ?? '',
    env_public_id: environment?.env_public_id ?? '',
  };
}

function environmentsForControlPlane(
  controlPlanes: readonly DesktopControlPlaneSummary[],
  providerOrigin: string,
  providerID: string,
): readonly DesktopControlPlaneSummary['environments'][number][] {
  return controlPlanes.find((controlPlane) => (
    controlPlane.provider.provider_origin === providerOrigin
    && controlPlane.provider.provider_id === providerID
  ))?.environments ?? [];
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

function controlPlaneName(controlPlane: DesktopControlPlaneSummary): string {
  return trimString(controlPlane.display_label) || controlPlane.provider.display_name;
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

function createLocalConnectionDialogState(
  mode: 'create' | 'edit',
  overrides: Partial<LocalConnectionDialogState> = {},
): LocalConnectionDialogState {
  const passwordConfigured = overrides.local_ui_password_configured === true;
  return {
    mode,
    connection_kind: 'managed_local',
    environment_id: trimString(overrides.environment_id),
    label: trimString(overrides.label),
    environment_name: trimString(overrides.environment_name),
    local_ui_bind: trimString(overrides.local_ui_bind) || EMPTY_SETTINGS_DRAFT.local_ui_bind || 'localhost:23998',
    local_ui_password: trimString(overrides.local_ui_password),
    local_ui_password_mode: normalizeDesktopLocalUIPasswordMode(
      overrides.local_ui_password_mode,
      passwordConfigured ? 'keep' : 'replace',
    ),
    local_ui_password_configured: passwordConfigured,
    remote_access_enabled: overrides.remote_access_enabled === true,
    provider_origin: trimString(overrides.provider_origin),
    provider_id: trimString(overrides.provider_id),
    env_public_id: trimString(overrides.env_public_id),
    preferred_open_route: overrides.preferred_open_route === 'local_host' || overrides.preferred_open_route === 'remote_desktop'
      ? overrides.preferred_open_route
      : 'auto',
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

function issueKicker(issue: DesktopWelcomeIssue): string {
  switch (issue.scope) {
    case 'remote_environment':
      return 'Remote Environment';
    case 'managed_environment':
      return 'Environment';
    default:
      return 'Desktop startup';
  }
}

function busyActionForLauncherRequest(request: DesktopLauncherActionRequest): BusyAction {
  switch (request.kind) {
    case 'upsert_saved_environment':
    case 'upsert_saved_ssh_environment':
      return 'save_environment';
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
  openCreateConnectionDialog: (message?: string, preferredKind?: 'managed_local' | 'external_local_ui' | 'ssh_environment') => void;
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
  const [connectError, setConnectError] = createSignal('');
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
  const [libraryQuery, setLibraryQuery] = createSignal('');
  const [activeCenterTab, setActiveCenterTab] = createSignal<EnvironmentCenterTab>('environments');
  const [environmentActionNotices, setEnvironmentActionNotices] = createSignal<Readonly<Record<string, EnvironmentActionNotice>>>({});
  const actionToastTimers = new Map<number, number>();
  const environmentNoticeTimers = new Map<string, number>();
  let nextActionToastID = 0;
  let issueRef: HTMLElement | undefined;
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
  const libraryEntries = createMemo(() => filterEnvironmentLibrary(snapshot(), libraryFilter(), libraryQuery()));

  onCleanup(() => {
    for (const handle of actionToastTimers.values()) {
      window.clearTimeout(handle);
    }
    actionToastTimers.clear();
    for (const handle of environmentNoticeTimers.values()) {
      window.clearTimeout(handle);
    }
    environmentNoticeTimers.clear();
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
    let prevIssueTitle = '';
    createEffect(() => {
      if (visibleSurface() !== 'connect_environment' || !snapshot().issue) {
        prevIssueTitle = '';
        return;
      }
      const title = snapshot().issue!.title;
      if (title === prevIssueTitle) {
        return;
      }
      prevIssueTitle = title;
      queueMicrotask(() => issueRef?.focus());
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

  function clearEnvironmentActionNotices(keys: readonly string[] = []): void {
    const cleanKeys = dedupeNoticeKeys(keys);
    if (cleanKeys.length <= 0) {
      return;
    }
    for (const key of cleanKeys) {
      const handle = environmentNoticeTimers.get(key);
      if (handle !== undefined) {
        window.clearTimeout(handle);
        environmentNoticeTimers.delete(key);
      }
    }
    setEnvironmentActionNotices((current) => {
      const next = { ...current };
      let changed = false;
      for (const key of cleanKeys) {
        if (next[key]) {
          changed = true;
          delete next[key];
        }
      }
      return changed ? next : current;
    });
  }

  function setEnvironmentActionNotice(
    keys: readonly string[],
    notice: Readonly<{
      tone: EnvironmentActionNotice['tone'];
      message: string;
    }>,
  ): void {
    const cleanKeys = dedupeNoticeKeys(keys);
    if (cleanKeys.length <= 0 || trimString(notice.message) === '') {
      return;
    }
    const nextNotice: EnvironmentActionNotice = {
      tone: notice.tone,
      message: trimString(notice.message),
      updated_at_ms: Date.now(),
    };
    setEnvironmentActionNotices((current) => {
      const next = { ...current };
      for (const key of cleanKeys) {
        next[key] = nextNotice;
      }
      return next;
    });
    for (const key of cleanKeys) {
      const existingHandle = environmentNoticeTimers.get(key);
      if (existingHandle !== undefined) {
        window.clearTimeout(existingHandle);
      }
      const handle = window.setTimeout(() => {
        environmentNoticeTimers.delete(key);
        setEnvironmentActionNotices((current) => {
          if (!current[key]) {
            return current;
          }
          const next = { ...current };
          delete next[key];
          return next;
        });
      }, ENVIRONMENT_ACTION_NOTICE_TTL_MS);
      environmentNoticeTimers.set(key, handle);
    }
  }

  function environmentNoticeForKeys(keys: readonly string[]): EnvironmentActionNotice | null {
    for (const key of dedupeNoticeKeys(keys)) {
      const notice = environmentActionNotices()[key];
      if (notice) {
        return notice;
      }
    }
    return null;
  }

  async function handleLauncherActionFailure(
    failure: Extract<DesktopLauncherActionResult, Readonly<{ ok: false }>>,
    errorTarget: 'connect' | 'settings' | 'dialog' | 'control_plane_dialog',
    options: LauncherActionUIOptions = {},
  ): Promise<void> {
    const noticeKeys = dedupeNoticeKeys(options.noticeKeys ?? []);
    const presentation = launcherActionFailurePresentation(failure, noticeKeys);
    if (presentation.refresh_snapshot) {
      try {
        await refreshSnapshot();
      } catch (error) {
        setErrorMessage(errorTarget, getErrorMessage(error));
        return;
      }
    }
    if (presentation.notice_message !== '' && noticeKeys.length > 0) {
      setEnvironmentActionNotice(noticeKeys, {
        tone: presentation.notice_tone,
        message: presentation.notice_message,
      });
      return;
    }
    if (presentation.global_message !== '') {
      setErrorMessage(errorTarget, presentation.global_message);
    }
  }

  function resetMessages(): void {
    setConnectError('');
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
    setConnectError('');
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
    preferredKind: 'managed_local' | 'external_local_ui' | 'ssh_environment' = 'managed_local',
  ): void {
    if (snapshot().surface !== 'connect_environment') {
      showConnectEnvironment(message || 'Open the launcher to add a connection.');
      return;
    }
    setActiveCenterTab('environments');
    if (trimString(message) !== '') {
      showActionToast(message, 'info');
    }
    setConnectError('');
    setSettingsError('');
    setConnectionDialogError('');
    setControlPlaneDialogError('');
    setControlPlaneDialogState(null);
    setConnectionDialogState(
      preferredKind === 'managed_local'
        ? createLocalConnectionDialogState('create', {
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
      setConnectionDialogState(createLocalConnectionDialogState('edit', {
        environment_id: environment.id,
        label: environment.label,
        environment_name: environment.managed_environment_name ?? '',
        local_ui_bind: environment.managed_local_ui_bind ?? 'localhost:23998',
        local_ui_password_mode: environment.managed_local_ui_password_configured ? 'keep' : 'replace',
        local_ui_password_configured: environment.managed_local_ui_password_configured === true,
        remote_access_enabled: Boolean(environment.provider_origin && environment.provider_id && environment.env_public_id),
        provider_origin: environment.provider_origin ?? '',
        provider_id: environment.provider_id ?? '',
        env_public_id: environment.env_public_id ?? '',
        preferred_open_route: environment.managed_preferred_open_route === 'local_host' || environment.managed_preferred_open_route === 'remote_desktop'
          ? environment.managed_preferred_open_route
          : 'auto',
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
    setConnectError('');
    setSettingsError('');
    setConnectionDialogError('');
    setControlPlaneDialogError('');
    setControlPlaneDialogState(createControlPlaneDialogState());
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

  function switchConnectionDialogKind(kind: 'managed_local' | 'external_local_ui' | 'ssh_environment'): void {
    setConnectionDialogState((current) => {
      if (!current || current.mode !== 'create' || current.connection_kind === kind) {
        return current;
      }
      if (kind === 'managed_local') {
        return createLocalConnectionDialogState('create', {
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
    name: 'label' | 'environment_name' | 'local_ui_bind' | 'local_ui_password' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'remote_install_dir' | 'release_base_url' | 'provider_origin' | 'provider_id' | 'env_public_id',
    value: string,
  ): void {
    setConnectionDialogState((current) => {
      if (!current) {
        return current;
      }
      if (name === 'local_ui_password' && current.connection_kind === 'managed_local') {
        return {
          ...current,
          local_ui_password: value,
          local_ui_password_mode: passwordModeForInput(value, current.local_ui_password_configured),
        };
      }
      return {
        ...current,
        [name]: value,
      };
    });
  }

  function toggleLocalControlPlaneBinding(enabled: boolean): void {
    setConnectionDialogState((current) => {
      if (!current || current.connection_kind !== 'managed_local') {
        return current;
      }
      if (enabled) {
        const existingEnvironments = environmentsForControlPlane(
          snapshot().control_planes,
          current.provider_origin,
          current.provider_id,
        );
        if (current.provider_origin && current.provider_id && existingEnvironments.some((environment) => environment.env_public_id === current.env_public_id)) {
          return {
            ...current,
            remote_access_enabled: true,
          };
        }
        const fallback = defaultLocalControlPlaneSelection(snapshot().control_planes);
        return {
          ...current,
          remote_access_enabled: true,
          provider_origin: fallback.provider_origin,
          provider_id: fallback.provider_id,
          env_public_id: fallback.env_public_id,
        };
      }
      return {
        ...current,
        remote_access_enabled: false,
        provider_origin: '',
        provider_id: '',
        env_public_id: '',
        preferred_open_route: 'auto',
      };
    });
  }

  function selectLocalControlPlaneProvider(providerOrigin: string, providerID: string): void {
    setConnectionDialogState((current) => {
      if (!current || current.connection_kind !== 'managed_local') {
        return current;
      }
      const environments = environmentsForControlPlane(snapshot().control_planes, providerOrigin, providerID);
      return {
        ...current,
        provider_origin: providerOrigin,
        provider_id: providerID,
        env_public_id: environments.some((environment) => environment.env_public_id === current.env_public_id)
          ? current.env_public_id
          : (environments[0]?.env_public_id ?? ''),
      };
    });
  }

  function selectLocalControlPlaneEnvironment(envPublicID: string): void {
    setConnectionDialogState((current) => {
      if (!current || current.connection_kind !== 'managed_local') {
        return current;
      }
      return {
        ...current,
        env_public_id: envPublicID,
      };
    });
  }

  function selectManagedEnvironmentPreferredRoute(route: 'auto' | DesktopManagedEnvironmentRoute): void {
    setConnectionDialogState((current) => {
      if (!current || current.connection_kind !== 'managed_local') {
        return current;
      }
      return {
        ...current,
        preferred_open_route: route,
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
    setConnectError(message);
  }

  async function performLauncherAction(
    request: DesktopLauncherActionRequest,
    errorTarget: 'connect' | 'settings' | 'dialog' | 'control_plane_dialog' = 'connect',
    options: LauncherActionUIOptions = {},
  ): Promise<Extract<DesktopLauncherActionResult, Readonly<{ ok: true }>> | null> {
    resetMessages();
    clearEnvironmentActionNotices(options.noticeKeys ?? []);
    setBusyAction(busyActionForLauncherRequest(request));
    try {
      const result = await props.runtime.launcher.performAction(request);
      if (isDesktopLauncherActionFailure(result)) {
        await handleLauncherActionFailure(result, errorTarget, options);
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
    options: LauncherActionUIOptions = {},
  ): Promise<boolean> {
    const result = await performLauncherAction({
      kind: 'focus_environment_window',
      session_key: sessionKey,
    }, errorTarget, options);
    return result?.outcome === 'focused_environment_window';
  }

  async function openManagedEnvironment(
    environment: DesktopEnvironmentEntry,
    errorTarget: 'connect' | 'dialog' | 'settings' = 'connect',
    route: 'auto' | DesktopManagedEnvironmentRoute = 'auto',
  ): Promise<boolean> {
    const noticeKeys = noticeKeysForEnvironment(environment);
    if (environment.kind !== 'managed_environment') {
      return openEnvironment(environment, errorTarget === 'settings' ? 'connect' : errorTarget);
    }
    const preferredOpenSessionKey = route === 'remote_desktop'
      ? environment.open_remote_session_key
        : route === 'local_host'
          ? environment.open_local_session_key
          : environment.open_session_key;
    if (preferredOpenSessionKey) {
      return focusEnvironmentWindow(preferredOpenSessionKey, errorTarget, { noticeKeys });
    }
    const result = await performLauncherAction({
      kind: 'open_managed_environment',
      environment_id: environment.id,
      route,
    }, errorTarget, { noticeKeys });
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
    const noticeKeys = environment ? noticeKeysForEnvironment(environment) : [];
    if (environment?.is_open && environment.open_session_key) {
      return focusEnvironmentWindow(environment.open_session_key, errorTarget, { noticeKeys });
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
    }, errorTarget, { noticeKeys });
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
    const noticeKeys = environment ? noticeKeysForEnvironment(environment) : [];
    if (environment?.is_open && environment.open_session_key) {
      return focusEnvironmentWindow(environment.open_session_key, errorTarget, { noticeKeys });
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
    }, errorTarget, { noticeKeys });
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
          }, errorTarget === 'settings' ? 'connect' : errorTarget, {
            noticeKeys: noticeKeysForEnvironment(environment),
          });
        }
        return false;
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

  async function openControlPlaneEnvironment(
    controlPlane: DesktopControlPlaneSummary,
    envPublicID: string,
    managedEntry: DesktopEnvironmentEntry | null,
  ): Promise<boolean> {
    const noticeKeys = managedEntry
      ? noticeKeysForEnvironment(managedEntry)
      : noticeKeysForProviderEnvironment(
        controlPlane.provider.provider_origin,
        controlPlane.provider.provider_id,
        envPublicID,
      );
    if (managedEntry) {
      const opened = await openManagedEnvironment(managedEntry);
      if (opened) {
        showActionToast('Control Plane environment opened.');
      }
      return opened;
    }

    const sessionKey = controlPlaneDesktopSessionKey(controlPlane.provider.provider_origin, envPublicID);
    const openWindow = snapshot().open_windows.find((window) => window.session_key === sessionKey) ?? null;
    if (openWindow) {
      return focusEnvironmentWindow(openWindow.session_key, 'connect', { noticeKeys });
    }

    const result = await performLauncherAction({
      kind: 'open_control_plane_environment',
      provider_origin: controlPlane.provider.provider_origin,
      provider_id: controlPlane.provider.provider_id,
      env_public_id: envPublicID,
    }, 'connect', { noticeKeys });
    const opened = result?.outcome === 'opened_environment_window' || result?.outcome === 'focused_environment_window';
    if (opened) {
      showActionToast('Control Plane environment opened.');
    }
    return opened;
  }

  async function triggerControlPlaneEnvironmentAction(
    controlPlane: DesktopControlPlaneSummary,
    envPublicID: string,
    managedEntry: DesktopEnvironmentEntry | null,
    action: EnvironmentActionModel,
  ): Promise<boolean> {
    switch (action.intent) {
      case 'open':
      case 'focus':
        if (managedEntry && action.route === 'local_host') {
          return triggerManagedEnvironmentAction(managedEntry, action, 'connect');
        }
        return openControlPlaneEnvironment(controlPlane, envPublicID, managedEntry);
      case 'refresh_status':
      case 'check_status':
      case 'retry_sync':
        await refreshControlPlane(controlPlane);
        return false;
      case 'reconnect_provider':
        await reconnectControlPlane(controlPlane);
        return false;
      default:
        return false;
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

    setConnectError('');
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
    setConnectError('');
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
      setConnectError('Desktop-managed environments are already saved on this device.');
      return;
    }
    if (environment.kind === 'ssh_environment') {
      const details = environment.ssh_details;
      if (!details) {
        setConnectError('SSH connection details are missing.');
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

  async function saveConnectionFromDialog(): Promise<void> {
    const state = connectionDialogState();
    if (!state) {
      return;
    }
    if (
      state.connection_kind === 'managed_local'
      && state.remote_access_enabled
      && (
        trimString(state.provider_origin) === ''
        || trimString(state.provider_id) === ''
        || trimString(state.env_public_id) === ''
      )
    ) {
      setConnectionDialogError(
        snapshot().control_planes.length > 0
          ? 'Choose the Control Plane environment that should represent this local host.'
          : 'Authorize a Control Plane first, then choose the environment to bind.',
      );
      return;
    }
    const saved = state.connection_kind === 'managed_local'
      ? await performLauncherAction({
        kind: 'upsert_managed_local_environment',
        environment_id: state.environment_id || undefined,
        environment_name: state.environment_name,
        label: state.label,
        local_ui_bind: state.local_ui_bind,
        local_ui_password: state.local_ui_password,
        local_ui_password_mode: state.local_ui_password_mode,
        remote_access_enabled: state.remote_access_enabled,
        provider_origin: state.remote_access_enabled ? trimString(state.provider_origin) || undefined : undefined,
        provider_id: state.remote_access_enabled ? trimString(state.provider_id) || undefined : undefined,
        env_public_id: state.remote_access_enabled ? trimString(state.env_public_id) || undefined : undefined,
        preferred_open_route: state.remote_access_enabled ? state.preferred_open_route : 'auto',
      }, 'dialog')
      : state.connection_kind === 'ssh_environment'
      ? await upsertSavedSSHEnvironment({
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
      })
      : await upsertSavedEnvironment({
        environment_id: state.environment_id,
        label: state.label,
        external_local_ui_url: state.external_local_ui_url,
        errorTarget: 'dialog',
        successMessage: state.mode === 'edit'
          ? 'Connection updated.'
          : 'Connection saved to Environment Library.',
      });
    if (saved) {
      closeConnectionDialog();
    }
  }

  async function connectFromDialog(): Promise<void> {
    const state = connectionDialogState();
    if (!state) {
      return;
    }
    if (
      state.connection_kind === 'managed_local'
      && state.remote_access_enabled
      && (
        trimString(state.provider_origin) === ''
        || trimString(state.provider_id) === ''
        || trimString(state.env_public_id) === ''
      )
    ) {
      setConnectionDialogError(
        snapshot().control_planes.length > 0
          ? 'Choose the Control Plane environment that should represent this local host.'
          : 'Authorize a Control Plane first, then choose the environment to bind.',
      );
      return;
    }
    if (state.connection_kind === 'managed_local') {
      const saved = await performLauncherAction({
        kind: 'upsert_managed_local_environment',
        environment_id: state.environment_id || undefined,
        environment_name: state.environment_name,
        label: state.label,
        local_ui_bind: state.local_ui_bind,
        local_ui_password: state.local_ui_password,
        local_ui_password_mode: state.local_ui_password_mode,
        remote_access_enabled: state.remote_access_enabled,
        provider_origin: state.remote_access_enabled ? trimString(state.provider_origin) || undefined : undefined,
        provider_id: state.remote_access_enabled ? trimString(state.provider_id) || undefined : undefined,
        env_public_id: state.remote_access_enabled ? trimString(state.env_public_id) || undefined : undefined,
        preferred_open_route: state.remote_access_enabled ? state.preferred_open_route : 'auto',
      }, 'dialog');
      if (!saved) {
        return;
      }
      await refreshSnapshot();
      const managedEntry = snapshot().environments.find((environment) => (
        environment.kind === 'managed_environment'
        && (
          (trimString(state.environment_id) !== '' && environment.id === trimString(state.environment_id))
          || (
            state.remote_access_enabled
            && environment.provider_origin === trimString(state.provider_origin)
            && environment.provider_id === trimString(state.provider_id)
            && environment.env_public_id === trimString(state.env_public_id)
          )
          || environment.managed_environment_name === trimString(state.environment_name)
        )
      )) ?? null;
      if (!managedEntry) {
        setConnectionDialogError('Desktop saved the Local Environment, but could not reopen it yet.');
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
      }, 'connect', {
        noticeKeys: noticeKeysForEnvironment(environment),
      });
      if (result?.outcome === 'saved_environment') {
        showActionToast(successMessage);
      }
      return;
    }
    if (environment.kind === 'ssh_environment') {
      const details = environment.ssh_details;
      if (!details) {
        setConnectError('SSH connection details are missing.');
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
      }, 'connect', {
        noticeKeys: noticeKeysForEnvironment(environment),
      });
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
    }, 'connect', {
      noticeKeys: noticeKeysForEnvironment(environment),
    });
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
        kind: target.kind === 'ssh_environment' ? 'delete_saved_ssh_environment' : 'delete_saved_environment',
        environment_id: target.id,
      });
      await refreshSnapshot();
      setDeleteTarget(null);
      showActionToast('Connection removed from Environment Library.');
    } catch (error) {
      setConnectError(getErrorMessage(error));
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

  function environmentNoticeForEnvironment(environment: DesktopEnvironmentEntry): EnvironmentActionNotice | null {
    return environmentNoticeForKeys(noticeKeysForEnvironment(environment));
  }

  function environmentNoticeForControlPlaneEnvironment(
    controlPlane: DesktopControlPlaneSummary,
    envPublicID: string,
    managedEntry: DesktopEnvironmentEntry | null,
  ): EnvironmentActionNotice | null {
    return environmentNoticeForKeys(
      managedEntry
        ? noticeKeysForEnvironment(managedEntry)
        : noticeKeysForProviderEnvironment(
          controlPlane.provider.provider_origin,
          controlPlane.provider.provider_id,
          envPublicID,
        ),
    );
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
          settingsSurface={settingsSurface()}
          error={connectError()}
          busyAction={busyAction()}
          activeTab={activeCenterTab()}
          setActiveTab={setActiveCenterTab}
          libraryFilter={libraryFilter()}
          libraryQuery={libraryQuery()}
          libraryEntries={libraryEntries()}
          setLibraryFilter={setLibraryFilter}
          setLibraryQuery={setLibraryQuery}
          environmentNotice={environmentNoticeForEnvironment}
          controlPlaneEnvironmentNotice={environmentNoticeForControlPlaneEnvironment}
          issueRef={(value) => {
            issueRef = value;
          }}
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
          runControlPlaneEnvironmentAction={triggerControlPlaneEnvironmentAction}
          reconnectControlPlane={reconnectControlPlane}
          refreshControlPlane={refreshControlPlane}
          deleteControlPlane={setDeleteControlPlaneTarget}
          copyDiagnostics={async () => {
            await copyToClipboard(snapshot().issue?.diagnostics_copy ?? '');
            showActionToast('Diagnostics copied to the clipboard.');
          }}
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
        controlPlanes={snapshot().control_planes}
        error={connectionDialogError()}
        busyAction={busyAction()}
        onOpenChange={(open) => {
          if (!open) {
            closeConnectionDialog();
          }
        }}
        updateField={updateConnectionDialogField}
        switchKind={switchConnectionDialogKind}
        toggleLocalControlPlaneBinding={toggleLocalControlPlaneBinding}
        selectLocalControlPlaneProvider={selectLocalControlPlaneProvider}
        selectLocalControlPlaneEnvironment={selectLocalControlPlaneEnvironment}
        selectManagedEnvironmentPreferredRoute={selectManagedEnvironmentPreferredRoute}
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
        title="Delete Connection"
        confirmText="Delete Connection"
        variant="destructive"
        loading={busyAction() === 'delete_environment'}
        onConfirm={() => void deleteEnvironment()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            Remove <span class="font-semibold">{deleteTarget()?.label}</span> from the Environment Library?
          </p>
          <p class="text-xs text-muted-foreground">This only removes the saved Desktop entry. It does not stop the remote Environment.</p>
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
          <For each={props.toasts}>
            {(toast) => (
              <div class="redeven-desktop-toast" data-tone={toast.tone} role="status">
                <div class="redeven-desktop-toast__icon" aria-hidden="true">
                  {toast.tone === 'success'
                    ? <Check class="h-3.5 w-3.5" />
                    : <AlertCircle class="h-3.5 w-3.5" />}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="redeven-desktop-toast__title">
                    {toast.tone === 'success' ? 'Updated' : 'Notice'}
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
            )}
          </For>
        </div>
      </Show>
    </Portal>
  );
}

function ConnectEnvironmentSurface(props: Readonly<{
  snapshot: DesktopWelcomeSnapshot;
  settingsSurface: DesktopSettingsSurfaceSnapshot;
  error: string;
  busyAction: BusyAction;
  activeTab: EnvironmentCenterTab;
  setActiveTab: (value: EnvironmentCenterTab) => void;
  libraryFilter: EnvironmentLibraryFilter;
  libraryQuery: string;
  libraryEntries: readonly DesktopEnvironmentEntry[];
  setLibraryFilter: (value: EnvironmentLibraryFilter) => void;
  setLibraryQuery: (value: string) => void;
  environmentNotice: (environment: DesktopEnvironmentEntry) => EnvironmentActionNotice | null;
  controlPlaneEnvironmentNotice: (
    controlPlane: DesktopControlPlaneSummary,
    envPublicID: string,
    managedEntry: DesktopEnvironmentEntry | null,
  ) => EnvironmentActionNotice | null;
  issueRef: (value: HTMLElement) => void;
  openLocalEnvironment: () => Promise<void>;
  openSettingsSurface: (environmentID?: string) => void;
  openCreateConnectionDialog: (message?: string, preferredKind?: 'managed_local' | 'external_local_ui' | 'ssh_environment') => void;
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
  runControlPlaneEnvironmentAction: (
    controlPlane: DesktopControlPlaneSummary,
    envPublicID: string,
    managedEntry: DesktopEnvironmentEntry | null,
    action: EnvironmentActionModel,
  ) => Promise<boolean>;
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  deleteControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
  copyDiagnostics: () => Promise<void>;
}>) {
  const localEnvironmentIssue = createMemo(() => (
    props.snapshot.issue?.scope === 'managed_environment' ? props.snapshot.issue : null
  ));
  const remoteEnvironmentIssue = createMemo(() => (
    props.snapshot.issue?.scope === 'remote_environment' ? props.snapshot.issue : null
  ));
  const remoteEnvironmentCount = createMemo(() => environmentLibraryCount(props.snapshot, 'all'));
  const libraryFilterOptions = createMemo(() => (
    LIBRARY_FILTERS.map((filter) => ({
      value: filter,
      label: libraryFilterLabel(filter),
    }))
  ));
  const controlPlaneEnvironmentCount = createMemo(() => (
    props.controlPlanes.reduce((total, controlPlane) => total + controlPlane.environments.length, 0)
  ));

  return (
    <div class="redeven-welcome-surface h-full min-h-0 w-full min-w-0 overflow-auto bg-background">
      <main id="redeven-desktop-main" class="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <header class="mb-5 space-y-4">
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
                  <span>{remoteEnvironmentCount()} remote</span>
                  <span class="text-border">·</span>
                  <span>{props.snapshot.open_windows.length} live</span>
                </div>
              </Show>
            </div>
          </div>
        </header>

        <div class="space-y-3">
          <Show when={props.error}>
            <div role="alert" class="redeven-console-banner redeven-console-banner--error rounded-xl px-3.5 py-2.5 text-sm text-destructive">
              {props.error}
            </div>
          </Show>

          <Show when={localEnvironmentIssue()}>
            {(issue) => (
              <IssueCard
                issue={issue()}
                issueRef={props.issueRef}
                primaryAction={(
                  <Button
                    size="sm"
                    variant="default"
                    aria-label="Open Local Environment"
                    title="Open Local Environment"
                    onClick={() => { void props.openLocalEnvironment(); }}
                  >
                    Open
                  </Button>
                )}
                secondaryAction={(
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Open Local Environment Settings"
                    title="Open Local Environment Settings"
                    onClick={() => props.openSettingsSurface()}
                  >
                    {compactSettingsActionLabel()}
                  </Button>
                )}
                tertiaryAction={(
                  <Button size="sm" variant="outline" onClick={() => { void props.copyDiagnostics(); }}>
                    <Copy class="mr-1 h-3.5 w-3.5" />
                    Copy Diagnostics
                  </Button>
                )}
              />
            )}
          </Show>

          <Show when={remoteEnvironmentIssue()}>
            {(issue) => (
              <IssueCard
                issue={issue()}
                issueRef={props.issueRef}
                primaryAction={(
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      if (issue().ssh_details) {
                        void props.openSSHEnvironment(issue().ssh_details!, 'connect');
                        return;
                      }
                      void props.openRemoteEnvironment(issue().target_url);
                    }}
                  >
                    Retry
                  </Button>
                )}
                tertiaryAction={(
                  <Button size="sm" variant="outline" onClick={() => { void props.copyDiagnostics(); }}>
                    <Copy class="mr-1 h-3.5 w-3.5" />
                    Copy Diagnostics
                  </Button>
                )}
              />
            )}
          </Show>

          <Show
            when={props.activeTab === 'environments'}
            fallback={(
              <ControlPlanesPanel
                controlPlanes={props.controlPlanes}
                libraryEntries={props.libraryEntries}
                openWindows={props.snapshot.open_windows}
                busyAction={props.busyAction}
                environmentNotice={props.controlPlaneEnvironmentNotice}
                openCreateControlPlaneDialog={props.openCreateControlPlaneDialog}
                runControlPlaneEnvironmentAction={props.runControlPlaneEnvironmentAction}
                reconnectControlPlane={props.reconnectControlPlane}
                refreshControlPlane={props.refreshControlPlane}
                deleteControlPlane={props.deleteControlPlane}
              />
            )}
          >
            <EnvironmentCardsPanel
              entries={props.libraryEntries}
              showQuickAddCards={props.libraryFilter === 'all' && trimString(props.libraryQuery) === ''}
              busyAction={props.busyAction}
              environmentNotice={props.environmentNotice}
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
      </main>
    </div>
  );
}

function EnvironmentCardsPanel(props: Readonly<{
  entries: readonly DesktopEnvironmentEntry[];
  showQuickAddCards: boolean;
  busyAction: BusyAction;
  environmentNotice: (environment: DesktopEnvironmentEntry) => EnvironmentActionNotice | null;
  openCreateConnectionDialog: (message?: string, preferredKind?: 'managed_local' | 'external_local_ui' | 'ssh_environment') => void;
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
        <EnvironmentCardSection title="Pinned">
          <For each={groupedEntries().pinned_entries}>
            {(environment) => (
              <EnvironmentConnectionCard
                environment={environment}
                busyAction={props.busyAction}
                notice={props.environmentNotice(environment)}
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
        <EnvironmentCardSection title={groupedEntries().pinned_entries.length > 0 ? 'Environments' : undefined}>
          <For each={groupedEntries().regular_entries}>
            {(environment) => (
              <EnvironmentConnectionCard
                environment={environment}
                busyAction={props.busyAction}
                notice={props.environmentNotice(environment)}
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
        <div class="redeven-console-empty rounded-2xl px-4 py-3 text-sm text-muted-foreground">
          No environment cards match the current search or filter.
        </div>
      </Show>
    </div>
  );
}

function EnvironmentCardSection(props: Readonly<{
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
  label: string;
}>) {
  return <div class="redeven-console-card__icon">{props.label}</div>;
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

function EnvironmentInlineNotice(props: Readonly<{
  notice: EnvironmentActionNotice;
}>) {
  return (
    <div class="redeven-environment-inline-notice" data-tone={props.notice.tone}>
      <AlertCircle class="h-3.5 w-3.5 shrink-0" />
      <span>{props.notice.message}</span>
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
  const rows = createMemo(() => {
    const targetLength = Math.max(props.facts.length, props.minRows ?? 0);
    return Array.from({ length: targetLength }, (_, index) => props.facts[index] ?? null);
  });

  return (
    <div class="redeven-environment-card__facts">
      <For each={rows()}>
        {(fact) => (
          <div class="redeven-environment-card__fact-row" data-empty={fact === null}>
            <div class="redeven-environment-card__fact-label">{fact?.label ?? ''}</div>
            <div
              class="redeven-environment-card__fact-value"
              title={fact?.value ?? undefined}
            >
              {fact?.value ?? ''}
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function EnvironmentCardEndpointBlock(props: Readonly<{
  endpoints: readonly EnvironmentCardEndpointModel[];
  copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
}>) {
  return (
    <div class="redeven-environment-card__endpoints">
      <div class="redeven-environment-card__section-title">Endpoint</div>
      <div class="space-y-2">
        <For each={props.endpoints}>
          {(endpoint) => (
            <div class="redeven-environment-card__endpoint-row">
              <Input
                value={endpoint.value}
                size="sm"
                readOnly
                onFocus={(event) => event.currentTarget.select()}
                class={cn(
                  'redeven-environment-card__endpoint-input',
                  endpoint.monospace && 'font-mono text-[12px]',
                )}
              />
              <Button
                size="sm"
                variant="outline"
                aria-label={endpoint.copy_label}
                onClick={() => {
                  void props.copyEnvironmentValue(endpoint.value, endpoint.copy_label);
                }}
              >
                <Copy class="mr-1 h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
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
      <CardHeader class="px-4 pb-3 pt-4">
        <div class="flex items-start gap-3">
          <ConsoleIconTile label="+" />
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
      <CardFooter class="mt-auto border-t border-border/70 px-4 py-3">
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
  busyAction: BusyAction;
  notice: EnvironmentActionNotice | null;
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
      'redeven-environment-card h-full overflow-hidden border transition-all duration-200',
      props.environment.is_open
        ? 'redeven-environment-card--open'
        : 'border-border',
    )}>
      <CardHeader class="pb-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <CardTitle class="truncate text-sm font-semibold" title={props.environment.label}>
              {props.environment.label}
            </CardTitle>
            <div class="mt-1 text-xs text-muted-foreground">
              {formatRelativeTimestamp(props.environment.last_used_at_ms)}
            </div>
          </div>
          <div class="flex items-start gap-1.5">
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
            <ConsoleStatusBadge tone={card().status_tone}>
              {card().status_label}
            </ConsoleStatusBadge>
          </div>
        </div>
      </CardHeader>
      <CardContent class="flex flex-1 flex-col pb-3">
        <div class="redeven-environment-card__content">
          <EnvironmentCardFactsBlock facts={facts()} minRows={3} />
          <EnvironmentCardEndpointBlock
            endpoints={endpoints()}
            copyEnvironmentValue={props.copyEnvironmentValue}
          />
          <Show when={props.notice}>
            {(notice) => <EnvironmentInlineNotice notice={notice()} />}
          </Show>
        </div>
      </CardContent>
      <CardFooter class="mt-auto flex items-center gap-2 border-t border-border pt-3">
        <Show
          when={props.environment.kind === 'managed_environment' && managedActionModel()}
          fallback={(
            <Button
              size="sm"
              variant="default"
              class="flex-1"
              loading={isEnvironmentActionBusy()}
              onClick={() => {
                void props.openEnvironment(props.environment, 'connect');
              }}
            >
              {props.environment.open_action_label}
            </Button>
          )}
        >
          {(actionModel) => (
            <div class="flex flex-1 items-center gap-2">
              <Button
                size="sm"
                variant={actionModel().primary_action.variant}
                class="flex-1"
                loading={isEnvironmentActionBusy()}
                disabled={!actionModel().primary_action.enabled}
                onClick={() => {
                  void props.runManagedEnvironmentAction(props.environment, actionModel().primary_action, 'connect');
                }}
              >
                {actionModel().primary_action.label}
              </Button>
              <Show when={actionModel().secondary_action}>
                {(secondaryAction) => (
                  <Button
                    size="sm"
                    variant={secondaryAction().variant}
                    loading={isEnvironmentActionBusy()}
                    disabled={!secondaryAction().enabled}
                    onClick={() => {
                      void props.runManagedEnvironmentAction(props.environment, secondaryAction(), 'connect');
                    }}
                  >
                    {secondaryAction().label}
                  </Button>
                )}
              </Show>
            </div>
          )}
        </Show>
        <div class="flex items-center gap-0.5">
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
            <DesktopTooltip content="Edit" placement="top">
              <ConsoleActionIconButton
                title="Edit connection"
                aria-label={`Edit ${props.environment.label}`}
                onClick={() => props.editEnvironment(props.environment)}
              >
                <Pencil class="h-3.5 w-3.5" />
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
  openCreateConnectionDialog: (message?: string, preferredKind?: 'managed_local' | 'external_local_ui' | 'ssh_environment') => void;
}>) {
  return (
    <Card class="redeven-environment-card redeven-new-environment-card group h-full cursor-pointer overflow-hidden border border-dashed border-border/70 transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.02]"
      onClick={() => props.openCreateConnectionDialog()}
    >
      <div class="flex h-full flex-col items-center justify-center gap-3 px-4 py-8">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary">
          <Plus class="h-5 w-5" />
        </div>
        <div class="space-y-1 text-center">
          <div class="text-sm font-medium text-foreground">New Environment</div>
          <div class="text-xs text-muted-foreground">Create a Local Environment, add a Redeven URL, or connect over SSH</div>
        </div>
        <div class="flex gap-2">
          <ConsoleChipActionButton
            onClick={(event) => {
              event.stopPropagation();
              props.openCreateConnectionDialog('', 'managed_local');
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
  libraryEntries: readonly DesktopEnvironmentEntry[];
  openWindows: readonly DesktopOpenEnvironmentWindow[];
  busyAction: BusyAction;
  environmentNotice: (
    controlPlane: DesktopControlPlaneSummary,
    envPublicID: string,
    managedEntry: DesktopEnvironmentEntry | null,
  ) => EnvironmentActionNotice | null;
  openCreateControlPlaneDialog: (message?: string) => void;
  runControlPlaneEnvironmentAction: (
    controlPlane: DesktopControlPlaneSummary,
    envPublicID: string,
    managedEntry: DesktopEnvironmentEntry | null,
    action: EnvironmentActionModel,
  ) => Promise<boolean>;
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
                libraryEntries={props.libraryEntries}
                openWindows={props.openWindows}
                busyAction={props.busyAction}
                environmentNotice={props.environmentNotice}
                runControlPlaneEnvironmentAction={props.runControlPlaneEnvironmentAction}
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

function ControlPlaneEnvironmentCard(props: Readonly<{
  controlPlane: DesktopControlPlaneSummary;
  environment: DesktopControlPlaneSummary['environments'][number];
  managedEntry: DesktopEnvironmentEntry | null;
  openWindow: DesktopOpenEnvironmentWindow | null;
  busyAction: BusyAction;
  notice: EnvironmentActionNotice | null;
  runControlPlaneEnvironmentAction: (
    controlPlane: DesktopControlPlaneSummary,
    envPublicID: string,
    managedEntry: DesktopEnvironmentEntry | null,
    action: EnvironmentActionModel,
  ) => Promise<boolean>;
}>) {
  const actionModel = createMemo(() => buildControlPlaneEnvironmentActionModel(
    props.controlPlane,
    props.environment,
    props.managedEntry,
    props.openWindow,
  ));
  const facts = createMemo(() => buildControlPlaneEnvironmentFactsModel(
    props.controlPlane,
    props.managedEntry,
  ));
  const runtimeLabel = createMemo(() => desktopProviderEnvironmentRuntimeLabel(
    props.environment.status,
    props.environment.lifecycle_status,
  ));
  const heroValue = createMemo(() => (
    props.environment.namespace_name
    || props.environment.namespace_public_id
    || 'Unassigned namespace'
  ));

  return (
    <Card class={cn(
      'redeven-environment-card h-full overflow-hidden border transition-all duration-200',
      props.openWindow
        ? 'redeven-environment-card--open'
        : 'border-border',
    )}>
      <CardHeader class="pb-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <CardTitle class="truncate text-sm font-semibold">{props.environment.label}</CardTitle>
            <div class="mt-1 text-xs text-muted-foreground">{controlPlaneName(props.controlPlane)}</div>
          </div>
          <ConsoleStatusBadge tone={actionModel().status_tone}>
            {actionModel().status_label}
          </ConsoleStatusBadge>
        </div>
      </CardHeader>
      <CardContent class="flex flex-1 flex-col pb-3">
        <div class="redeven-environment-card__content">
          <EnvironmentCardFactsBlock facts={facts()} minRows={3} />
          <div class="rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5">
            <div class="redeven-environment-card__section-title">Namespace</div>
            <div class="mt-1.5 text-sm font-medium text-foreground">{heroValue()}</div>
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div class="text-muted-foreground">State</div>
            <div class="text-right font-medium">{runtimeLabel()}</div>
            <div class="text-muted-foreground">Last seen</div>
            <div class="text-right font-medium">{formatRelativeTimestamp(props.environment.last_seen_at_unix_ms)}</div>
          </div>
          <Show when={props.notice}>
            {(notice) => <EnvironmentInlineNotice notice={notice()} />}
          </Show>
        </div>
      </CardContent>
      <CardFooter class="mt-auto flex items-center gap-2 border-t border-border pt-2">
        <div class="flex flex-1 items-center gap-2">
          <Button
            size="sm"
            variant={actionModel().primary_action.variant}
            class="flex-1"
            loading={
              props.busyAction === 'open_control_plane_environment'
              || props.busyAction === 'focus_environment_window'
              || props.busyAction === 'refresh_control_plane'
              || props.busyAction === 'start_control_plane_connect'
            }
            disabled={!actionModel().primary_action.enabled}
            onClick={() => {
              void props.runControlPlaneEnvironmentAction(
                props.controlPlane,
                props.environment.env_public_id,
                props.managedEntry,
                actionModel().primary_action,
              );
            }}
          >
            {actionModel().primary_action.label}
          </Button>
          <Show when={actionModel().secondary_action}>
            {(secondaryAction) => (
              <Button
                size="sm"
                variant={secondaryAction().variant}
                loading={
                  props.busyAction === 'open_control_plane_environment'
                  || props.busyAction === 'focus_environment_window'
                  || props.busyAction === 'refresh_control_plane'
                  || props.busyAction === 'start_control_plane_connect'
                }
                disabled={!secondaryAction().enabled}
                onClick={() => {
                  void props.runControlPlaneEnvironmentAction(
                    props.controlPlane,
                    props.environment.env_public_id,
                    props.managedEntry,
                    secondaryAction(),
                  );
                }}
              >
                {secondaryAction().label}
              </Button>
            )}
          </Show>
        </div>
      </CardFooter>
    </Card>
  );
}

function ControlPlaneShelf(props: Readonly<{
  controlPlane: DesktopControlPlaneSummary;
  libraryEntries: readonly DesktopEnvironmentEntry[];
  openWindows: readonly DesktopOpenEnvironmentWindow[];
  busyAction: BusyAction;
  environmentNotice: (
    controlPlane: DesktopControlPlaneSummary,
    envPublicID: string,
    managedEntry: DesktopEnvironmentEntry | null,
  ) => EnvironmentActionNotice | null;
  runControlPlaneEnvironmentAction: (
    controlPlane: DesktopControlPlaneSummary,
    envPublicID: string,
    managedEntry: DesktopEnvironmentEntry | null,
    action: EnvironmentActionModel,
  ) => Promise<boolean>;
  reconnectControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (controlPlane: DesktopControlPlaneSummary) => Promise<void>;
  deleteControlPlane: (controlPlane: DesktopControlPlaneSummary) => void;
}>) {
  const statusModel = createMemo(() => buildControlPlaneStatusModel(props.controlPlane));

  return (
    <section class="space-y-2.5">
      <div class="redeven-provider-shelf rounded-[1.1rem] border border-border px-4 py-3 shadow-sm">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <ConsoleIconTile label="C" />
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <div class="truncate text-sm font-semibold tracking-tight text-foreground">{controlPlaneName(props.controlPlane)}</div>
                <ConsoleStatusBadge tone={statusModel().tone}>
                  {statusModel().label}
                </ConsoleStatusBadge>
                <ConsoleBadge>{props.controlPlane.provider.display_name}</ConsoleBadge>
                <ConsoleBadge>{props.controlPlane.environments.length} envs</ConsoleBadge>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{props.controlPlane.account.user_display_name}</span>
                <span class="font-mono text-[11px]">{props.controlPlane.provider.provider_origin}</span>
                <span>Synced {formatRelativeTimestamp(props.controlPlane.last_synced_at_ms)}</span>
              </div>
              <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                {statusModel().detail}
              </div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
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
      </div>

      <Show
        when={props.controlPlane.environments.length > 0}
        fallback={(
          <div class="redeven-console-empty rounded-2xl px-4 py-3 text-sm text-muted-foreground">
            No environments published from this provider yet.
          </div>
        )}
      >
        <div class="redeven-environment-grid">
          <For each={props.controlPlane.environments}>
            {(environment) => {
              const sessionKey = controlPlaneDesktopSessionKey(
                props.controlPlane.provider.provider_origin,
                environment.env_public_id,
              );
              const openWindow = props.openWindows.find((window) => window.session_key === sessionKey) ?? null;
              const managedEntry = props.libraryEntries.find((entry) => (
                entry.kind === 'managed_environment'
                && entry.provider_origin === props.controlPlane.provider.provider_origin
                && entry.provider_id === props.controlPlane.provider.provider_id
                && entry.env_public_id === environment.env_public_id
              )) ?? null;
              return (
                <ControlPlaneEnvironmentCard
                  controlPlane={props.controlPlane}
                environment={environment}
                managedEntry={managedEntry}
                openWindow={openWindow}
                busyAction={props.busyAction}
                notice={props.environmentNotice(props.controlPlane, environment.env_public_id, managedEntry)}
                runControlPlaneEnvironmentAction={props.runControlPlaneEnvironmentAction}
              />
            );
            }}
          </For>
        </div>
      </Show>
    </section>
  );
}

const LOCAL_ENVIRONMENT_SETTINGS_DIALOG_CLASS = cn(
  'flex max-w-none flex-col overflow-hidden rounded-md p-0',
  '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
  '[&>div:last-child]:min-h-0 [&>div:last-child]:flex-1 [&>div:last-child]:overflow-auto [&>div:last-child]:pt-2',
  'max-h-[calc(100dvh-1rem)] w-[min(52rem,96vw)]',
);

const LOCAL_ENVIRONMENT_SETTINGS_CARD_CLASS = 'redeven-tile rounded-lg border border-border px-4 py-4';

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

function IssueCard(props: Readonly<{
  issue: DesktopWelcomeIssue;
  issueRef: (value: HTMLElement) => void;
  primaryAction?: JSX.Element;
  secondaryAction?: JSX.Element;
  tertiaryAction?: JSX.Element;
}>) {
  return (
    <div ref={props.issueRef} tabIndex={-1} class="outline-none">
      <div class="redeven-console-issue rounded-[1.05rem] border border-destructive/20 px-4 py-3 shadow-sm">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="flex min-w-0 items-start gap-3">
            <div class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive">
              <AlertCircle class="h-4 w-4" />
            </div>
            <div class="min-w-0">
              <div class="text-[10px] font-semibold uppercase tracking-[0.24em] text-destructive">{issueKicker(props.issue)}</div>
              <div class="mt-1 text-sm font-semibold text-foreground">{props.issue.title}</div>
              <div class="mt-1 text-xs leading-5 text-muted-foreground">{props.issue.message}</div>
              <Show when={props.issue.diagnostics_copy}>
                <div class="mt-2 text-[11px] text-muted-foreground">Diagnostics are ready if you want to copy them.</div>
              </Show>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            {props.primaryAction}
            {props.secondaryAction}
            {props.tertiaryAction}
          </div>
        </div>
      </div>
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
        <div class="redeven-settings-statusbar overflow-hidden rounded-xl border border-border">
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
                          'redeven-visibility-card group relative flex cursor-pointer flex-col gap-2 rounded-xl border px-4 py-3.5 text-left transition-all duration-150',
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
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
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
            class="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive outline-none"
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
  controlPlanes: readonly DesktopControlPlaneSummary[];
  error: string;
  busyAction: BusyAction;
  onOpenChange: (open: boolean) => void;
  updateField: (
    name: 'label' | 'environment_name' | 'local_ui_bind' | 'local_ui_password' | 'external_local_ui_url' | 'ssh_destination' | 'ssh_port' | 'remote_install_dir' | 'release_base_url' | 'provider_origin' | 'provider_id' | 'env_public_id',
    value: string,
  ) => void;
  switchKind: (kind: 'managed_local' | 'external_local_ui' | 'ssh_environment') => void;
  toggleLocalControlPlaneBinding: (enabled: boolean) => void;
  selectLocalControlPlaneProvider: (providerOrigin: string, providerID: string) => void;
  selectLocalControlPlaneEnvironment: (envPublicID: string) => void;
  selectManagedEnvironmentPreferredRoute: (route: 'auto' | DesktopManagedEnvironmentRoute) => void;
  openCreateControlPlaneDialog: (message?: string) => void;
  switchBootstrapStrategy: (strategy: DesktopSSHBootstrapStrategy) => void;
  onConnect: () => Promise<void>;
  onSave: () => Promise<void>;
}>) {
  const isOpen = createMemo(() => props.state !== null);
  const isCreate = createMemo(() => props.state?.mode === 'create');
  const connectionKind = createMemo(() => props.state?.connection_kind ?? 'managed_local');
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
  const controlPlaneOptions = createMemo(() => props.controlPlanes.map((controlPlane) => ({
    provider_origin: controlPlane.provider.provider_origin,
    provider_id: controlPlane.provider.provider_id,
    label: controlPlaneName(controlPlane),
    count: controlPlane.environments.length,
  })));
  const selectedControlPlaneEnvironments = createMemo(() => (
    props.state?.connection_kind === 'managed_local'
      ? environmentsForControlPlane(props.controlPlanes, props.state.provider_origin, props.state.provider_id)
      : []
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

  createEffect(() => {
    setAdvancedState((current) => syncSSHConnectionDialogAdvancedState(
      current,
      props.state?.connection_kind === 'managed_local' ? null : props.state,
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
            onClick={() => {
              void props.onSave();
            }}
          >
            <Save class="mr-1 h-3.5 w-3.5" />
            {compactSaveActionLabel()}
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
      <div class="space-y-4">
        <Show when={isCreate()}>
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-foreground">Environment Type</label>
            <SegmentedControl
              value={connectionKind()}
              onChange={(value) => props.switchKind(value as 'managed_local' | 'external_local_ui' | 'ssh_environment')}
              options={[
                { value: 'managed_local', label: 'Local' },
                { value: 'external_local_ui', label: 'Redeven URL' },
                { value: 'ssh_environment', label: 'SSH' },
              ]}
              size="sm"
            />
          </div>
        </Show>

        <div class="space-y-1.5">
          <label for="environment-label" class="block text-xs font-medium text-foreground">Label</label>
          <Input
            id="environment-label"
            value={props.state?.label ?? ''}
            onInput={(event) => props.updateField('label', event.currentTarget.value)}
            placeholder="My Environment"
            size="sm"
            class="w-full"
          />
        </div>

        <Show when={connectionKind() === 'managed_local'}>
          <div class="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
            <div class="space-y-3">
              <div class="space-y-1.5">
                <label for="environment-name" class="block text-xs font-medium text-foreground">Environment Name</label>
                <Input
                  id="environment-name"
                  value={props.state?.connection_kind === 'managed_local' ? props.state.environment_name : ''}
                  onInput={(event) => props.updateField('environment_name', event.currentTarget.value)}
                  placeholder="dev-a"
                  size="sm"
                  class="w-full font-mono"
                  spellcheck={false}
                  autofocus={props.state?.mode === 'create'}
                />
                <div class="text-[11px] text-muted-foreground">
                  Desktop stores this environment under `local/&lt;name&gt;` inside the shared Redeven state root.
                </div>
              </div>
              <div class="space-y-1.5">
                <label for="environment-local-bind" class="block text-xs font-medium text-foreground">Local UI Bind</label>
                <Input
                  id="environment-local-bind"
                  value={props.state?.connection_kind === 'managed_local' ? props.state.local_ui_bind : ''}
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
                  value={props.state?.connection_kind === 'managed_local' ? props.state.local_ui_password : ''}
                  onInput={(event) => props.updateField('local_ui_password', event.currentTarget.value)}
                  placeholder={props.state?.connection_kind === 'managed_local' && props.state.local_ui_password_configured
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
              <div class="rounded-lg border border-border/70 bg-background/80 px-3 py-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="space-y-1">
                    <div class="text-xs font-medium text-foreground">Remote access through Control Plane</div>
                    <div class="text-[11px] leading-5 text-muted-foreground">
                      Bind this local host to one published provider environment so the same environment stays reachable from this device and through the Control Plane.
                    </div>
                  </div>
                  <Checkbox
                    checked={props.state?.connection_kind === 'managed_local' && props.state.remote_access_enabled}
                    onChange={props.toggleLocalControlPlaneBinding}
                    label=""
                    size="sm"
                  />
                </div>
                <Show when={props.state?.connection_kind === 'managed_local' && props.state.remote_access_enabled}>
                  <div class="mt-3 space-y-3">
                    <Show
                      when={controlPlaneOptions().length > 0}
                      fallback={(
                        <div class="rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-3">
                          <div class="text-[11px] leading-5 text-muted-foreground">
                            Authorize a Control Plane first, then return here to choose the published environment that should map to this local host.
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            class="mt-3"
                            onClick={() => {
                              props.onOpenChange(false);
                              props.openCreateControlPlaneDialog('Authorize a Control Plane, then bind this local environment to it.');
                            }}
                          >
                            Connect Provider
                          </Button>
                        </div>
                      )}
                    >
                      <div class="space-y-1.5">
                        <label for="environment-control-plane-provider" class="block text-xs font-medium text-foreground">Control Plane</label>
                        <select
                          id="environment-control-plane-provider"
                          class="redeven-native-select"
                          value={`${props.state?.connection_kind === 'managed_local' ? props.state.provider_origin : ''}|${props.state?.connection_kind === 'managed_local' ? props.state.provider_id : ''}`}
                          onChange={(event) => {
                            const [providerOrigin, providerID] = String(event.currentTarget.value ?? '').split('|');
                            props.selectLocalControlPlaneProvider(trimString(providerOrigin), trimString(providerID));
                          }}
                        >
                          <option value="">Choose a Control Plane</option>
                          <For each={controlPlaneOptions()}>
                            {(option) => (
                              <option value={`${option.provider_origin}|${option.provider_id}`}>
                                {option.label} ({option.count})
                              </option>
                            )}
                          </For>
                        </select>
                      </div>
                      <div class="space-y-1.5">
                        <label for="environment-control-plane-env" class="block text-xs font-medium text-foreground">Published Environment</label>
                        <select
                          id="environment-control-plane-env"
                          class="redeven-native-select"
                          value={props.state?.connection_kind === 'managed_local' ? props.state.env_public_id : ''}
                          onChange={(event) => props.selectLocalControlPlaneEnvironment(trimString(event.currentTarget.value))}
                          disabled={selectedControlPlaneEnvironments().length === 0}
                        >
                          <option value="">
                            {selectedControlPlaneEnvironments().length > 0 ? 'Choose an environment' : 'Choose a Control Plane first'}
                          </option>
                          <For each={selectedControlPlaneEnvironments()}>
                            {(environment) => (
                              <option value={environment.env_public_id}>
                                {environment.label} ({environment.env_public_id})
                              </option>
                            )}
                          </For>
                        </select>
                      </div>
                      <div class="space-y-1.5">
                        <label class="block text-xs font-medium text-foreground">Preferred Desktop Open Route</label>
                        <SegmentedControl
                          value={props.state?.connection_kind === 'managed_local' ? props.state.preferred_open_route : 'auto'}
                          onChange={(value) => props.selectManagedEnvironmentPreferredRoute(value as 'auto' | DesktopManagedEnvironmentRoute)}
                          options={[
                            { value: 'auto', label: 'Auto' },
                            { value: 'local_host', label: 'Prefer Local' },
                            { value: 'remote_desktop', label: 'Prefer Remote' },
                          ]}
                          size="sm"
                        />
                        <div class="text-[11px] text-muted-foreground">
                          Desktop still shows both routes when they are available. This only controls which route the primary open action prefers.
                        </div>
                      </div>
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
          <div class="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
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
              <div class="overflow-hidden rounded-lg border border-border/70 bg-background/80">
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
          <div role="alert" class="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
          <div role="alert" class="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
