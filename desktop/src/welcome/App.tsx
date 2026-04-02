import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { cn, FloeProvider, useCommand, useTheme } from '@floegence/floe-webapp-core';
import {
  AlertCircle,
  Clock,
  Copy,
  Globe,
  Moon,
  Pencil,
  Plus,
  Save,
  Search,
  Settings,
  Sun,
  Trash,
} from '@floegence/floe-webapp-core/icons';
import { BottomBarItem, Shell, StatusIndicator, TopBarIconButton, type ActivityBarItem } from '@floegence/floe-webapp-core/layout';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CommandPalette,
  ConfirmDialog,
  Dialog,
  Input,
  SegmentedControl,
  Tag,
} from '@floegence/floe-webapp-core/ui';

import type {
  DesktopAccessMode,
  DesktopSettingsSummaryItem,
  DesktopSettingsSurfaceSnapshot,
} from '../shared/desktopSettingsSurface';
import type {
  DesktopEnvironmentEntry,
  DesktopLauncherActionRequest,
  DesktopLauncherSurface,
  DesktopWelcomeIssue,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import type { DesktopSettingsDraft, SaveDesktopSettingsResult } from '../shared/settingsIPC';
import {
  buildDesktopWelcomeShellViewModel,
  capabilityUnavailableMessage,
  environmentLibraryCount,
  filterEnvironmentLibrary,
  libraryFilterLabel,
  type EnvironmentLibraryFilter,
  shellStatus,
} from './viewModel';

type DesktopLauncherBridge = Readonly<{
  getSnapshot: () => Promise<DesktopWelcomeSnapshot>;
  performAction: (request: DesktopLauncherActionRequest) => Promise<void>;
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
  }
}

type BusyAction =
  | ''
  | 'open_local_environment'
  | 'open_remote_environment'
  | 'return_to_current_environment'
  | 'save_settings'
  | 'save_environment'
  | 'delete_environment';

type SurfaceMode = 'root' | 'local';

type ConnectionDialogState = Readonly<{
  mode: 'create' | 'edit';
  environment_id: string;
  label: string;
  external_local_ui_url: string;
}> | null;

const LOGO_LIGHT_URL = new URL('../../../internal/envapp/ui_src/public/logo.svg', import.meta.url).href;
const LOGO_DARK_URL = new URL('../../../internal/envapp/ui_src/public/logo-dark.svg', import.meta.url).href;

const EMPTY_SETTINGS_DRAFT: DesktopSettingsDraft = {
  local_ui_bind: '',
  local_ui_password: '',
  controlplane_url: '',
  env_id: '',
  env_token: '',
};

const DESKTOP_FLOE_CONFIG = {
  storage: {
    namespace: 'redeven-desktop-shell',
  },
  commands: {
    ignoreWhenTyping: false,
  },
  accessibility: {
    mainContentId: 'redeven-desktop-main',
    skipLinkLabel: 'Skip to Redeven Desktop content',
    topBarLabel: 'Redeven Desktop toolbar',
    primaryNavigationLabel: 'Redeven Desktop navigation',
    mobileNavigationLabel: 'Redeven Desktop navigation',
    sidebarLabel: 'Redeven Desktop sidebar',
    mainLabel: 'Redeven Desktop content',
  },
  strings: {
    topBar: {
      searchPlaceholder: 'Search desktop commands...',
    },
  },
} as const;

const LIBRARY_FILTERS: readonly EnvironmentLibraryFilter[] = ['all', 'current', 'recent', 'saved'];

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return trimString(error.message);
  }
  return trimString(error);
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

function issueKicker(issue: DesktopWelcomeIssue): string {
  switch (issue.scope) {
    case 'remote_environment':
      return 'Remote Environment';
    case 'local_environment':
      return 'Local Environment';
    default:
      return 'Desktop startup';
  }
}

function environmentTagVariant(tag: DesktopEnvironmentEntry['tag']): 'neutral' | 'primary' | 'success' {
  switch (tag) {
    case 'Current':
      return 'success';
    case 'Recent':
      return 'primary';
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

function summaryItemToneClasses(tone: DesktopSettingsSummaryItem['tone']): string {
  switch (tone) {
    case 'primary':
      return 'border-primary/20 bg-primary/5';
    case 'warning':
      return 'border-amber-500/25 bg-amber-500/10';
    case 'success':
      return 'border-emerald-500/25 bg-emerald-500/10';
    default:
      return 'border-border/70 bg-background';
  }
}

function environmentSourceLabel(environment: DesktopEnvironmentEntry): string {
  switch (environment.category) {
    case 'current_unsaved':
      return 'Current unsaved';
    case 'recent_auto':
      return 'Recent';
    case 'saved':
      return 'Saved';
    default:
      return 'Local Environment';
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
  if (!candidate || typeof candidate.getSnapshot !== 'function' || typeof candidate.performAction !== 'function') {
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
  visibleSurface: () => DesktopLauncherSurface;
  showConnectEnvironment: (message?: string) => void;
  openCreateConnectionDialog: (message?: string) => void;
  openSettingsSurface: () => void;
  openLocalEnvironment: () => Promise<void>;
  openRemoteEnvironment: (targetURL: string) => Promise<boolean>;
  returnOrQuit: () => Promise<void>;
}>): null {
  const cmd = useCommand();
  const theme = useTheme();

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
        title: 'Open Local Environment',
        description: 'Open the desktop-managed Environment on this machine',
        category: 'Desktop',
        keybind: 'mod+enter',
        icon: Globe,
        execute: () => {
          void props.openLocalEnvironment();
        },
      },
      {
        id: 'redeven.desktop.openLocalEnvironmentSettings',
        title: 'Local Environment Settings',
        description: 'Edit local startup, access, and bootstrap settings',
        category: 'Desktop',
        keybind: 'mod+,',
        icon: Settings,
        execute: () => props.openSettingsSurface(),
      },
      {
        id: 'redeven.desktop.focusEnvironmentURL',
        title: 'Connect Another Environment',
        description: 'Open the Add Connection dialog',
        category: 'Desktop',
        icon: Search,
        execute: () => props.openCreateConnectionDialog('Enter an Environment URL or choose a saved connection.'),
      },
      {
        id: 'redeven.desktop.returnOrQuit',
        title: snapshot.close_action_label,
        description: snapshot.close_action_label === 'Quit'
          ? 'Quit Redeven Desktop'
          : 'Return to the current Environment',
        category: 'Desktop',
        icon: Globe,
        execute: () => {
          void props.returnOrQuit();
        },
      },
      {
        id: 'redeven.desktop.toggleTheme',
        title: 'Toggle Theme',
        description: 'Switch between light and dark theme',
        category: 'General',
        icon: theme.resolvedTheme() === 'light' ? Moon : Sun,
        execute: () => theme.toggleTheme(),
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

    for (const environment of snapshot.environments.filter((entry) => entry.kind === 'external_local_ui').slice(0, 5)) {
      list.push({
        id: `redeven.desktop.openEnvironment.${environment.id}`,
        title: `Open ${environment.label}`,
        description: environment.local_ui_url,
        category: 'Recent Environments',
        icon: Globe,
        execute: () => {
          void props.openRemoteEnvironment(environment.local_ui_url);
        },
      });
    }

    if (props.visibleSurface() === 'connect_environment') {
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
  const cmd = useCommand();
  const theme = useTheme();
  const [snapshot, setSnapshot] = createSignal(props.snapshot);
  const [surfaceMode, setSurfaceMode] = createSignal<SurfaceMode>(props.snapshot.surface === 'local_environment_settings' ? 'root' : 'local');
  const [localSurface, setLocalSurface] = createSignal<DesktopLauncherSurface>(props.snapshot.surface === 'local_environment_settings' ? 'local_environment_settings' : 'connect_environment');
  const [feedback, setFeedback] = createSignal('');
  const [connectError, setConnectError] = createSignal('');
  const [settingsError, setSettingsError] = createSignal('');
  const [connectionDialogError, setConnectionDialogError] = createSignal('');
  const [busyAction, setBusyAction] = createSignal<BusyAction>('');
  const [draft, setDraft] = createSignal<DesktopSettingsDraft>(props.snapshot.settings_surface?.draft ?? EMPTY_SETTINGS_DRAFT);
  const [connectionDialogState, setConnectionDialogState] = createSignal<ConnectionDialogState>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<DesktopEnvironmentEntry | null>(null);
  const [libraryFilter, setLibraryFilter] = createSignal<EnvironmentLibraryFilter>('all');
  const [libraryQuery, setLibraryQuery] = createSignal('');
  let issueRef: HTMLElement | undefined;
  let settingsErrorRef: HTMLElement | undefined;

  const visibleSurface = createMemo<DesktopLauncherSurface>(() => (
    surfaceMode() === 'root' ? snapshot().surface : localSurface()
  ));
  const status = createMemo(() => shellStatus(snapshot()));
  const shellView = createMemo(() => buildDesktopWelcomeShellViewModel(snapshot(), visibleSurface()));
  const headerLogoSrc = createMemo(() => theme.resolvedTheme() === 'light' ? LOGO_LIGHT_URL : LOGO_DARK_URL);
  const settingsSurface = createMemo<DesktopSettingsSurfaceSnapshot>(() => snapshot().settings_surface);
  const currentSessionSubtitle = createMemo(() => (
    trimString(snapshot().current_session_local_ui_url) || snapshot().current_session_description
  ));
  const isMainOwnedSettingsSurface = createMemo(() => surfaceMode() === 'root' && snapshot().surface === 'local_environment_settings');
  const activityItems = createMemo<ActivityBarItem[]>(() => ([
    {
      id: 'connect_environment',
      icon: Globe,
      label: 'Connect Environment',
      onClick: () => showConnectEnvironment(),
    },
  ]));
  const libraryEntries = createMemo(() => filterEnvironmentLibrary(snapshot(), libraryFilter(), libraryQuery()));

  createEffect(() => {
    setDraft(snapshot().settings_surface?.draft ?? EMPTY_SETTINGS_DRAFT);
  });

  createEffect(() => {
    if (visibleSurface() !== 'connect_environment' || !snapshot().issue) {
      return;
    }
    queueMicrotask(() => issueRef?.focus());
  });

  createEffect(() => {
    if (!settingsError()) {
      return;
    }
    queueMicrotask(() => settingsErrorRef?.focus());
  });

  async function refreshSnapshot(): Promise<void> {
    const nextSnapshot = await props.runtime.launcher.getSnapshot();
    setSnapshot(nextSnapshot);
    if (surfaceMode() === 'root' && nextSnapshot.surface !== 'local_environment_settings') {
      setSurfaceMode('local');
      setLocalSurface(nextSnapshot.surface);
    }
  }

  function resetMessages(): void {
    setFeedback('');
    setConnectError('');
    setSettingsError('');
    setConnectionDialogError('');
  }

  function showConnectEnvironment(message = ''): void {
    setSurfaceMode('local');
    setLocalSurface('connect_environment');
    setConnectionDialogState(null);
    setFeedback(trimString(message));
    setConnectError('');
    setSettingsError('');
    setConnectionDialogError('');
  }

  function openSettingsSurface(): void {
    setSurfaceMode('local');
    setLocalSurface('local_environment_settings');
    setConnectionDialogState(null);
    setFeedback('');
    setConnectError('');
    setSettingsError('');
    setConnectionDialogError('');
  }

  function openCreateConnectionDialog(message = ''): void {
    showConnectEnvironment(message);
    setConnectionDialogState({
      mode: 'create',
      environment_id: '',
      label: '',
      external_local_ui_url: trimString(snapshot().suggested_remote_url),
    });
  }

  function startEditingEnvironment(environment: DesktopEnvironmentEntry): void {
    setConnectionDialogState({
      mode: 'edit',
      environment_id: environment.id,
      label: environment.label,
      external_local_ui_url: environment.local_ui_url,
    });
    setConnectionDialogError('');
  }

  function closeConnectionDialog(): void {
    setConnectionDialogState(null);
    setConnectionDialogError('');
  }

  function updateConnectionDialogField(name: 'label' | 'external_local_ui_url', value: string): void {
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

  function setErrorMessage(target: 'connect' | 'settings' | 'dialog', message: string): void {
    if (target === 'settings') {
      setSettingsError(message);
      return;
    }
    if (target === 'dialog') {
      setConnectionDialogError(message);
      return;
    }
    setConnectError(message);
  }

  async function performNavigationAction(request: Extract<DesktopLauncherActionRequest, Readonly<{
    kind: 'open_local_environment' | 'open_remote_environment' | 'return_to_current_environment';
  }>>, errorTarget: 'connect' | 'settings' | 'dialog' = 'connect'): Promise<boolean> {
    resetMessages();
    setBusyAction(request.kind);
    try {
      await props.runtime.launcher.performAction(request);
      return true;
    } catch (error) {
      setErrorMessage(errorTarget, getErrorMessage(error));
      return false;
    } finally {
      setBusyAction('');
    }
  }

  async function openLocalEnvironment(): Promise<void> {
    await performNavigationAction({ kind: 'open_local_environment' }, visibleSurface() === 'local_environment_settings' ? 'settings' : 'connect');
  }

  async function openRemoteEnvironment(
    targetURL: string,
    errorTarget: 'connect' | 'dialog' = 'connect',
  ): Promise<boolean> {
    const normalizedTargetURL = trimString(targetURL);
    if (!normalizedTargetURL) {
      setErrorMessage(errorTarget, 'Environment URL is required.');
      return false;
    }
    const opened = await performNavigationAction({
      kind: 'open_remote_environment',
      external_local_ui_url: normalizedTargetURL,
    }, errorTarget);
    if (opened && errorTarget === 'dialog') {
      closeConnectionDialog();
    }
    return opened;
  }

  async function returnOrQuit(): Promise<void> {
    await performNavigationAction({ kind: 'return_to_current_environment' });
  }

  function updateDraftField(name: keyof DesktopSettingsDraft, value: string): void {
    setDraft((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function applyAccessMode(mode: DesktopAccessMode): void {
    setDraft((current) => {
      if (mode === 'local_only') {
        return {
          ...current,
          local_ui_bind: '127.0.0.1:0',
          local_ui_password: '',
        };
      }
      if (mode === 'shared_local_network') {
        return {
          ...current,
          local_ui_bind: '0.0.0.0:24000',
        };
      }
      return current;
    });
  }

  function clearBootstrapDraft(): void {
    setDraft((current) => ({
      ...current,
      controlplane_url: '',
      env_id: '',
      env_token: '',
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
      if (isMainOwnedSettingsSurface()) {
        props.runtime.settings.cancel();
        return;
      }
      await refreshSnapshot();
      setSurfaceMode('local');
      setLocalSurface('connect_environment');
      setFeedback('Local Environment settings saved.');
    } catch (error) {
      setSettingsError(getErrorMessage(error));
    } finally {
      setBusyAction('');
    }
  }

  function cancelSettings(): void {
    setSettingsError('');
    if (isMainOwnedSettingsSurface()) {
      props.runtime.settings.cancel();
      return;
    }
    setSurfaceMode('local');
    setLocalSurface('connect_environment');
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
      setFeedback(request.successMessage);
      return true;
    } catch (error) {
      setErrorMessage(request.errorTarget, getErrorMessage(error));
      return false;
    } finally {
      setBusyAction('');
    }
  }

  async function saveEnvironmentFromLibrary(environment: DesktopEnvironmentEntry): Promise<void> {
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
      closeConnectionDialog();
    }
  }

  async function connectFromDialog(): Promise<void> {
    const state = connectionDialogState();
    if (!state) {
      return;
    }
    await openRemoteEnvironment(state.external_local_ui_url, 'dialog');
  }

  async function deleteEnvironment(): Promise<void> {
    const target = deleteTarget();
    if (!target) {
      return;
    }
    setBusyAction('delete_environment');
    try {
      await props.runtime.launcher.performAction({
        kind: 'delete_saved_environment',
        environment_id: target.id,
      });
      await refreshSnapshot();
      setDeleteTarget(null);
      setFeedback('Connection removed from Environment Library.');
    } catch (error) {
      setConnectError(getErrorMessage(error));
    } finally {
      setBusyAction('');
    }
  }

  return (
    <>
      <DesktopCommandRegistrar
        snapshot={snapshot}
        visibleSurface={visibleSurface}
        showConnectEnvironment={showConnectEnvironment}
        openCreateConnectionDialog={openCreateConnectionDialog}
        openSettingsSurface={openSettingsSurface}
        openLocalEnvironment={openLocalEnvironment}
        openRemoteEnvironment={openRemoteEnvironment}
        returnOrQuit={returnOrQuit}
      />
      <Shell
        sidebarMode="hidden"
        activityItems={activityItems()}
        activityBottomItems={[]}
        activityBottomItemsMobileMode="topBar"
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
        topBarActions={(
          <div class="flex items-center gap-1">
            <TopBarIconButton label="Command palette" onClick={() => cmd.open()}>
              <Search class="h-4 w-4" />
            </TopBarIconButton>
            <TopBarIconButton
              label={theme.resolvedTheme() === 'light' ? 'Use dark theme' : 'Use light theme'}
              onClick={() => theme.toggleTheme()}
            >
              {theme.resolvedTheme() === 'light' ? <Moon class="h-4 w-4" /> : <Sun class="h-4 w-4" />}
            </TopBarIconButton>
          </div>
        )}
        bottomBarItems={(
          <>
            <div class="flex min-w-0 items-center gap-2">
              <BottomBarItem class="min-w-0">
                <span class="truncate">{shellView().surface_title}</span>
              </BottomBarItem>
              <BottomBarItem class="min-w-0">
                <span class="truncate">{currentSessionSubtitle()}</span>
              </BottomBarItem>
            </div>
            <div class="flex items-center gap-2">
              <StatusIndicator status={status().tone} label={status().label} />
              <BottomBarItem class="cursor-pointer" onClick={() => void returnOrQuit()}>
                {snapshot().close_action_label}
              </BottomBarItem>
            </div>
          </>
        )}
      >
        <ConnectEnvironmentSurface
          snapshot={snapshot()}
          settingsSurface={settingsSurface()}
          feedback={feedback()}
          error={connectError()}
          busyAction={busyAction()}
          libraryFilter={libraryFilter()}
          libraryQuery={libraryQuery()}
          libraryEntries={libraryEntries()}
          setLibraryFilter={setLibraryFilter}
          setLibraryQuery={setLibraryQuery}
          issueRef={(value) => {
            issueRef = value;
          }}
          openLocalEnvironment={openLocalEnvironment}
          openSettingsSurface={openSettingsSurface}
          openCreateConnectionDialog={openCreateConnectionDialog}
          openRemoteEnvironment={openRemoteEnvironment}
          saveEnvironmentFromLibrary={saveEnvironmentFromLibrary}
          editEnvironment={startEditingEnvironment}
          deleteEnvironment={setDeleteTarget}
          returnOrQuit={returnOrQuit}
          copyDiagnostics={async () => {
            await copyToClipboard(snapshot().issue?.diagnostics_copy ?? '');
            setFeedback('Diagnostics copied to the clipboard.');
          }}
        />
      </Shell>

      <LocalEnvironmentSettingsDialog
        open={visibleSurface() === 'local_environment_settings'}
        snapshot={settingsSurface()}
        draft={draft()}
        busyAction={busyAction()}
        settingsError={settingsError()}
        settingsErrorRef={(value) => {
          settingsErrorRef = value;
        }}
        updateDraftField={updateDraftField}
        applyAccessMode={applyAccessMode}
        clearBootstrapDraft={clearBootstrapDraft}
        saveSettings={saveSettings}
        cancelSettings={cancelSettings}
      />

      <ConnectionDialog
        state={connectionDialogState()}
        error={connectionDialogError()}
        busyAction={busyAction()}
        onOpenChange={(open) => {
          if (!open) {
            closeConnectionDialog();
          }
        }}
        updateField={updateConnectionDialogField}
        onConnect={connectFromDialog}
        onSave={saveConnectionFromDialog}
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
    </>
  );
}

function ConnectEnvironmentSurface(props: Readonly<{
  snapshot: DesktopWelcomeSnapshot;
  settingsSurface: DesktopSettingsSurfaceSnapshot;
  feedback: string;
  error: string;
  busyAction: BusyAction;
  libraryFilter: EnvironmentLibraryFilter;
  libraryQuery: string;
  libraryEntries: readonly DesktopEnvironmentEntry[];
  setLibraryFilter: (value: EnvironmentLibraryFilter) => void;
  setLibraryQuery: (value: string) => void;
  issueRef: (value: HTMLElement) => void;
  openLocalEnvironment: () => Promise<void>;
  openSettingsSurface: () => void;
  openCreateConnectionDialog: (message?: string) => void;
  openRemoteEnvironment: (targetURL: string) => Promise<boolean>;
  saveEnvironmentFromLibrary: (environment: DesktopEnvironmentEntry) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  returnOrQuit: () => Promise<void>;
  copyDiagnostics: () => Promise<void>;
}>) {
  const localEnvironmentIssue = createMemo(() => (
    props.snapshot.issue?.scope === 'local_environment' ? props.snapshot.issue : null
  ));
  const remoteEnvironmentIssue = createMemo(() => (
    props.snapshot.issue?.scope === 'remote_environment' ? props.snapshot.issue : null
  ));
  const libraryFilterOptions = createMemo(() => (
    LIBRARY_FILTERS.map((filter) => ({
      value: filter,
      label: `${libraryFilterLabel(filter)} (${environmentLibraryCount(props.snapshot, filter)})`,
    }))
  ));

  return (
    <div class="h-full min-h-0 overflow-auto bg-background">
      <main id="redeven-desktop-main" class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <CurrentSessionStrip snapshot={props.snapshot} returnOrQuit={props.returnOrQuit} />

        <Show when={props.feedback}>
          <div class="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
            {props.feedback}
          </div>
        </Show>

        <Show when={props.error}>
          <div role="alert" class="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {props.error}
          </div>
        </Show>

        <div class="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.85fr)]">
          <div class="space-y-4">
            <LocalEnvironmentLauncherCard
              snapshot={props.snapshot}
              settingsSurface={props.settingsSurface}
              busyAction={props.busyAction}
              openLocalEnvironment={props.openLocalEnvironment}
              openSettingsSurface={props.openSettingsSurface}
            />

            <Show when={localEnvironmentIssue()}>
              {(issue) => (
                <IssueCard
                  issue={issue()}
                  issueRef={props.issueRef}
                  primaryAction={(
                    <Button size="sm" variant="default" onClick={() => { void props.openLocalEnvironment(); }}>
                      Open Local Environment
                    </Button>
                  )}
                  secondaryAction={(
                    <Button size="sm" variant="outline" onClick={props.openSettingsSurface}>
                      Local Environment Settings
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
          </div>

          <EnvironmentLibraryPanel
            snapshot={props.snapshot}
            filter={props.libraryFilter}
            query={props.libraryQuery}
            entries={props.libraryEntries}
            filterOptions={libraryFilterOptions()}
            busyAction={props.busyAction}
            setFilter={props.setLibraryFilter}
            setQuery={props.setLibraryQuery}
            openCreateConnectionDialog={props.openCreateConnectionDialog}
            openRemoteEnvironment={props.openRemoteEnvironment}
            saveEnvironment={props.saveEnvironmentFromLibrary}
            editEnvironment={props.editEnvironment}
            deleteEnvironment={props.deleteEnvironment}
          />
        </div>
      </main>
    </div>
  );
}

function CurrentSessionStrip(props: Readonly<{
  snapshot: DesktopWelcomeSnapshot;
  returnOrQuit: () => Promise<void>;
}>) {
  return (
    <Card class="overflow-hidden border-border/80 bg-card/75 shadow-sm">
      <CardContent class="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div class="min-w-0">
          <div class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Current Session</div>
          <div class="mt-1 text-sm font-medium text-foreground">{props.snapshot.current_session_label}</div>
          <div class="mt-1 truncate text-xs text-muted-foreground">{props.snapshot.current_session_description}</div>
        </div>
        <div class="flex items-center gap-2">
          <Show when={props.snapshot.current_session_target_kind}>
            <Tag variant="success" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
              Session available
            </Tag>
          </Show>
          <Button size="sm" variant="outline" onClick={() => { void props.returnOrQuit(); }}>
            {props.snapshot.close_action_label}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LocalEnvironmentLauncherCard(props: Readonly<{
  snapshot: DesktopWelcomeSnapshot;
  settingsSurface: DesktopSettingsSurfaceSnapshot;
  busyAction: BusyAction;
  openLocalEnvironment: () => Promise<void>;
  openSettingsSurface: () => void;
}>) {
  const isCurrent = createMemo(() => props.snapshot.current_session_target_kind === 'managed_local');

  return (
    <Card class="overflow-hidden shadow-sm">
      <CardHeader class="gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0">
            <div class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Local environment</div>
            <CardTitle class="mt-1 text-xl tracking-tight">Local Environment</CardTitle>
            <CardDescription class="mt-1 text-sm">Desktop-managed environment on this machine.</CardDescription>
          </div>
          <div class="flex flex-wrap gap-2">
            <Tag variant={isCurrent() ? 'success' : 'neutral'} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
              {isCurrent() ? 'Current' : 'Ready'}
            </Tag>
            <Tag
              variant={passwordStateTagVariant(props.settingsSurface.password_state_tone)}
              tone="soft"
              size="sm"
              class="cursor-default whitespace-nowrap"
            >
              {props.settingsSurface.password_state_label}
            </Tag>
            <Tag
              variant={props.settingsSurface.bootstrap_pending ? 'primary' : 'neutral'}
              tone="soft"
              size="sm"
              class="cursor-default whitespace-nowrap"
            >
              {props.settingsSurface.bootstrap_status_label}
            </Tag>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-4 px-4 py-4 sm:px-5">
        <div class="grid gap-3 sm:grid-cols-2">
          <For each={props.settingsSurface.summary_items}>
            {(item) => <SummaryItemTile item={item} />}
          </For>
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="default"
            loading={props.busyAction === 'open_local_environment'}
            onClick={() => {
              void props.openLocalEnvironment();
            }}
          >
            {isCurrent() ? 'Return to Local Environment' : 'Open Local Environment'}
          </Button>
          <Button size="sm" variant="outline" onClick={props.openSettingsSurface}>
            <Settings class="mr-1 h-3.5 w-3.5" />
            Local Environment Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryItemTile(props: Readonly<{
  item: DesktopSettingsSummaryItem;
}>) {
  return (
    <div class={cn('rounded-lg border px-3 py-3', summaryItemToneClasses(props.item.tone))}>
      <div class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{props.item.label}</div>
      <div class={cn(
        'mt-1 text-sm font-medium text-foreground',
        props.item.id === 'bind_address' && 'break-all font-mono text-xs',
      )}>
        {props.item.value}
      </div>
      <Show when={props.item.detail}>
        <div class="mt-1 text-xs leading-5 text-muted-foreground">{props.item.detail}</div>
      </Show>
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
      <Card class="overflow-hidden border-destructive/25 shadow-sm">
        <CardHeader class="gap-2 border-b border-destructive/20 bg-destructive/5">
          <div class="flex items-center gap-2 text-destructive">
            <AlertCircle class="h-4 w-4" />
            <div class="text-[11px] font-semibold uppercase tracking-widest">{issueKicker(props.issue)}</div>
          </div>
          <CardTitle class="text-base">{props.issue.title}</CardTitle>
          <CardDescription class="text-sm">{props.issue.message}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3 px-4 py-4">
          <Show when={props.issue.diagnostics_copy}>
            <div class="text-xs text-muted-foreground">Diagnostics are available if you need to copy them.</div>
          </Show>
          <div class="flex flex-wrap gap-2">
            {props.primaryAction}
            {props.secondaryAction}
            {props.tertiaryAction}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EnvironmentLibraryPanel(props: Readonly<{
  snapshot: DesktopWelcomeSnapshot;
  filter: EnvironmentLibraryFilter;
  query: string;
  entries: readonly DesktopEnvironmentEntry[];
  filterOptions: readonly Readonly<{ value: string; label: string }>[];
  busyAction: BusyAction;
  setFilter: (value: EnvironmentLibraryFilter) => void;
  setQuery: (value: string) => void;
  openCreateConnectionDialog: (message?: string) => void;
  openRemoteEnvironment: (targetURL: string) => Promise<boolean>;
  saveEnvironment: (environment: DesktopEnvironmentEntry) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
}>) {
  return (
    <Card class="overflow-hidden shadow-sm">
      <CardHeader class="gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div class="min-w-0">
            <div class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Remote environments</div>
            <CardTitle class="mt-1 text-lg">Environment Library</CardTitle>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Tag variant="neutral" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
              {environmentLibraryCount(props.snapshot, 'all')} connections
            </Tag>
            <Button size="sm" variant="default" onClick={() => props.openCreateConnectionDialog()}>
              <Plus class="mr-1 h-3.5 w-3.5" />
              Add Connection
            </Button>
          </div>
        </div>
        <div class="grid gap-3 pt-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <Input
            value={props.query}
            onInput={(event) => props.setQuery(event.currentTarget.value)}
            placeholder="Search label or Environment URL"
            size="sm"
            class="w-full"
          />
          <div class="overflow-x-auto">
            <SegmentedControl
              value={props.filter}
              onChange={(value) => props.setFilter(value as EnvironmentLibraryFilter)}
              options={props.filterOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              size="sm"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent class="px-0 py-0">
        <Show
          when={props.entries.length > 0}
          fallback={(
            <div class="px-4 py-10 text-center sm:px-5">
              <div class="text-sm font-medium text-foreground">No connections match this view.</div>
              <div class="mt-1 text-xs leading-5 text-muted-foreground">Try another filter or add a connection.</div>
            </div>
          )}
        >
          <div class="overflow-x-auto">
            <table class="min-w-full border-collapse text-sm">
              <thead class="bg-muted/30 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th class="px-4 py-3 sm:px-5">Connection</th>
                  <th class="px-4 py-3">Environment URL</th>
                  <th class="px-4 py-3">Source</th>
                  <th class="px-4 py-3">Last used</th>
                  <th class="px-4 py-3 text-right sm:px-5">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border/70">
                <For each={props.entries}>
                  {(environment) => (
                    <EnvironmentLibraryRow
                      environment={environment}
                      busyAction={props.busyAction}
                      openRemoteEnvironment={props.openRemoteEnvironment}
                      saveEnvironment={props.saveEnvironment}
                      editEnvironment={props.editEnvironment}
                      deleteEnvironment={props.deleteEnvironment}
                    />
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </CardContent>
    </Card>
  );
}

function EnvironmentLibraryRow(props: Readonly<{
  environment: DesktopEnvironmentEntry;
  busyAction: BusyAction;
  openRemoteEnvironment: (targetURL: string) => Promise<boolean>;
  saveEnvironment: (environment: DesktopEnvironmentEntry) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
}>) {
  const openLabel = createMemo(() => props.environment.is_current ? 'Return' : 'Open');
  return (
    <tr class="align-top">
      <td class="px-4 py-3 sm:px-5">
        <div class="flex flex-wrap items-center gap-2">
          <div class="max-w-[240px] truncate font-medium text-foreground">{props.environment.label}</div>
          <Show when={props.environment.tag}>
            <Tag variant={environmentTagVariant(props.environment.tag)} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
              {props.environment.tag}
            </Tag>
          </Show>
        </div>
      </td>
      <td class="px-4 py-3">
        <div class="max-w-[320px] break-all font-mono text-xs text-muted-foreground">{props.environment.local_ui_url}</div>
      </td>
      <td class="px-4 py-3 text-xs text-muted-foreground">
        {environmentSourceLabel(props.environment)}
      </td>
      <td class="px-4 py-3">
        <Show
          when={props.environment.last_used_at_ms > 0}
          fallback={<span class="text-xs text-muted-foreground">Never</span>}
        >
          <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock class="h-3.5 w-3.5" />
            {formatTimestamp(props.environment.last_used_at_ms)}
          </span>
        </Show>
      </td>
      <td class="px-4 py-3 sm:px-5">
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="default"
            loading={props.busyAction === 'open_remote_environment'}
            onClick={() => {
              void props.openRemoteEnvironment(props.environment.local_ui_url);
            }}
          >
            {openLabel()}
          </Button>
          <Show when={props.environment.can_save}>
            <Button
              size="sm"
              variant="outline"
              loading={props.busyAction === 'save_environment'}
              onClick={() => {
                void props.saveEnvironment(props.environment);
              }}
            >
              <Save class="mr-1 h-3.5 w-3.5" />
              Save
            </Button>
          </Show>
          <Show when={props.environment.can_edit}>
            <Button
              size="sm"
              variant="ghost"
              class="text-muted-foreground"
              onClick={() => props.editEnvironment(props.environment)}
              aria-label={`Edit ${props.environment.label}`}
              title="Edit connection"
            >
              <Pencil class="h-3.5 w-3.5" />
            </Button>
          </Show>
          <Show when={props.environment.can_delete}>
            <Button
              size="sm"
              variant="ghost"
              class="text-muted-foreground hover:text-destructive"
              onClick={() => props.deleteEnvironment(props.environment)}
              aria-label={`Delete ${props.environment.label}`}
              title="Delete connection"
            >
              <Trash class="h-3.5 w-3.5" />
            </Button>
          </Show>
        </div>
      </td>
    </tr>
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
  clearBootstrapDraft: () => void;
  saveSettings: () => Promise<void>;
  cancelSettings: () => void;
}>) {
  const [advancedOpen, setAdvancedOpen] = createSignal(props.snapshot.bootstrap_pending);
  const selectedOption = createMemo(() => props.snapshot.access_mode_options.find((option) => option.value === props.snapshot.access_mode) ?? null);
  const nextStartSummary = createMemo(() => props.snapshot.summary_items.find((item) => item.id === 'next_start') ?? null);

  createEffect(() => {
    setAdvancedOpen(props.snapshot.bootstrap_pending);
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.cancelSettings();
        }
      }}
      title={props.snapshot.window_title}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={props.cancelSettings}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={props.busyAction === 'save_settings'}
            onClick={() => {
              void props.saveSettings();
            }}
          >
            {props.snapshot.save_label}
          </Button>
        </div>
      )}
    >
      <div class="space-y-5">
        <div class="grid gap-3 sm:grid-cols-2">
          <For each={props.snapshot.summary_items}>
            {(item) => <SummaryItemTile item={item} />}
          </For>
        </div>

        <div class="space-y-3">
          <div>
            <div class="text-sm font-medium text-foreground">Access mode</div>
            <div class="mt-1 text-xs leading-5 text-muted-foreground">
              {selectedOption()?.description}
            </div>
          </div>
          <SegmentedControl
            value={props.snapshot.access_mode}
            onChange={(value) => props.applyAccessMode(value as DesktopAccessMode)}
            options={props.snapshot.access_mode_options.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            size="sm"
          />
        </div>

        <Show when={props.snapshot.access_mode === 'custom_exposure'}>
          <div class="grid gap-4 md:grid-cols-2">
            <SettingsFieldInput
              field={props.snapshot.host_fields[0]!}
              value={props.draft.local_ui_bind}
              updateDraftField={props.updateDraftField}
            />
            <SettingsFieldInput
              field={props.snapshot.host_fields[1]!}
              value={props.draft.local_ui_password}
              updateDraftField={props.updateDraftField}
            />
          </div>
        </Show>

        <Show when={props.snapshot.access_mode === 'shared_local_network'}>
          <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div class="rounded-lg border border-border/70 bg-background px-3 py-3">
              <div class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Preset bind</div>
              <div class="mt-1 break-all font-mono text-xs text-foreground">0.0.0.0:24000</div>
              <div class="mt-1 text-xs leading-5 text-muted-foreground">Password required before the next open.</div>
            </div>
            <SettingsFieldInput
              field={props.snapshot.host_fields[1]!}
              value={props.draft.local_ui_password}
              updateDraftField={props.updateDraftField}
            />
          </div>
        </Show>

        <div class="overflow-hidden rounded-lg border border-border/70">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center justify-between gap-3 bg-muted/20 px-3 py-3 text-left"
            onClick={() => setAdvancedOpen(!advancedOpen())}
          >
            <div class="min-w-0">
              <div class="text-sm font-medium text-foreground">Advanced</div>
              <div class="mt-1 text-xs leading-5 text-muted-foreground">
                One-shot registration for the next desktop-managed start.
              </div>
            </div>
            <Tag
              variant={props.snapshot.bootstrap_pending ? 'primary' : 'neutral'}
              tone="soft"
              size="sm"
              class="cursor-default whitespace-nowrap"
            >
              {nextStartSummary()?.value ?? props.snapshot.bootstrap_status_label}
            </Tag>
          </button>

          <Show when={advancedOpen()}>
            <div class="space-y-4 border-t border-border/70 px-3 py-3">
              <div class="grid gap-4 md:grid-cols-2">
                <For each={props.snapshot.bootstrap_fields}>
                  {(field) => (
                    <SettingsFieldInput
                      field={field}
                      value={props.draft[field.name]}
                      updateDraftField={props.updateDraftField}
                    />
                  )}
                </For>
              </div>
              <Show when={props.snapshot.bootstrap_pending}>
                <div class="flex justify-end">
                  <Button size="sm" variant="outline" onClick={props.clearBootstrapDraft}>
                    Clear queued request
                  </Button>
                </div>
              </Show>
            </div>
          </Show>
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
  error: string;
  busyAction: BusyAction;
  onOpenChange: (open: boolean) => void;
  updateField: (name: 'label' | 'external_local_ui_url', value: string) => void;
  onConnect: () => Promise<void>;
  onSave: () => Promise<void>;
}>) {
  const isCreate = createMemo(() => props.state?.mode === 'create');

  return (
    <Dialog
      open={props.state !== null}
      onOpenChange={props.onOpenChange}
      title={isCreate() ? 'Add Connection' : 'Edit Connection'}
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
            Save Connection
          </Button>
          <Show when={isCreate()}>
            <Button
              size="sm"
              variant="default"
              loading={props.busyAction === 'open_remote_environment'}
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
        <div class="space-y-1.5">
          <label for="environment-url" class="block text-xs font-medium text-foreground">Environment URL</label>
          <Input
            id="environment-url"
            value={props.state?.external_local_ui_url ?? ''}
            onInput={(event) => props.updateField('external_local_ui_url', event.currentTarget.value)}
            placeholder="http://192.168.1.11:24000/"
            size="sm"
            class="w-full font-mono"
            spellcheck={false}
            autofocus={props.state?.mode === 'create'}
          />
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

function SettingsFieldInput(props: Readonly<{
  field: DesktopSettingsSurfaceSnapshot['host_fields'][number];
  value: string;
  updateDraftField: (name: keyof DesktopSettingsDraft, value: string) => void;
}>) {
  return (
    <label classList={{ hidden: props.field.hidden }} class="grid gap-1.5">
      <span class="text-xs font-medium text-foreground">{props.field.label}</span>
      <Input
        id={props.field.id}
        name={props.field.name}
        value={props.value}
        type={props.field.type ?? 'text'}
        autocomplete={props.field.autocomplete}
        inputMode={props.field.inputMode}
        placeholder={props.field.placeholder}
        spellcheck={false}
        aria-describedby={props.field.describedBy?.join(' ') || undefined}
        size="sm"
        class="w-full"
        onInput={(event) => props.updateDraftField(props.field.name, event.currentTarget.value)}
      />
      <Show when={props.field.helpHTML && props.field.helpId}>
        <div id={props.field.helpId!} class="text-xs leading-5 text-muted-foreground" innerHTML={props.field.helpHTML!} />
      </Show>
    </label>
  );
}

export function DesktopWelcomeShell(props: DesktopWelcomeShellProps) {
  return (
    <FloeProvider config={DESKTOP_FLOE_CONFIG}>
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
