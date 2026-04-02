import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn, FloeProvider, useCommand, useTheme } from '@floegence/floe-webapp-core';
import {
  Copy,
  Globe,
  Moon,
  Pencil,
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
  Tag,
} from '@floegence/floe-webapp-core/ui';

import type { DesktopSettingsSurfaceSnapshot } from '../shared/desktopSettingsSurface';
import type {
  DesktopEnvironmentEntry,
  DesktopLauncherActionRequest,
  DesktopLauncherSurface,
  DesktopWelcomeIssue,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import type { DesktopSettingsDraft, SaveDesktopSettingsResult } from '../shared/settingsIPC';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from './redevenSurfaceRoles';
import {
  buildDesktopWelcomeShellViewModel,
  capabilityUnavailableMessage,
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
  | 'open_this_device'
  | 'open_remote_device'
  | 'return_to_current_device'
  | 'save_settings'
  | 'save_environment'
  | 'delete_environment';

type SurfaceMode = 'root' | 'local';

type EnvironmentEditorState = Readonly<{
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
    case 'remote_device':
      return 'Remote Environment';
    case 'this_device':
      return 'This Device';
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
  showConnectEnvironment: (message?: string, focusRemoteInput?: boolean) => void;
  openSettingsSurface: () => void;
  openThisDevice: () => Promise<void>;
  openRemoteDevice: (targetURL: string) => Promise<void>;
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
        description: 'Show the Environment connection page',
        category: 'Desktop',
        keybind: 'mod+shift+o',
        icon: Globe,
        execute: () => props.showConnectEnvironment(),
      },
      {
        id: 'redeven.desktop.openThisDevice',
        title: 'Open This Device',
        description: 'Open the desktop-managed Environment on this machine',
        category: 'Desktop',
        keybind: 'mod+enter',
        icon: Globe,
        execute: () => {
          void props.openThisDevice();
        },
      },
      {
        id: 'redeven.desktop.openThisDeviceSettings',
        title: 'This Device Settings',
        description: 'Edit local startup, access, and bootstrap settings',
        category: 'Desktop',
        keybind: 'mod+,',
        icon: Settings,
        execute: () => props.openSettingsSurface(),
      },
      {
        id: 'redeven.desktop.focusEnvironmentURL',
        title: 'Connect Another Environment',
        description: 'Focus the Environment URL input',
        category: 'Desktop',
        icon: Search,
        execute: () => props.showConnectEnvironment('Enter an Environment URL or choose a recent Environment.', true),
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
          void props.openRemoteDevice(environment.local_ui_url);
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
  const [surfaceMode, setSurfaceMode] = createSignal<SurfaceMode>(props.snapshot.surface === 'this_device_settings' ? 'root' : 'local');
  const [localSurface, setLocalSurface] = createSignal<DesktopLauncherSurface>(props.snapshot.surface === 'this_device_settings' ? 'this_device_settings' : 'connect_environment');
  const [remoteURL, setRemoteURL] = createSignal(props.snapshot.suggested_remote_url);
  const [feedback, setFeedback] = createSignal('');
  const [connectError, setConnectError] = createSignal('');
  const [settingsError, setSettingsError] = createSignal('');
  const [busyAction, setBusyAction] = createSignal<BusyAction>('');
  const [draft, setDraft] = createSignal<DesktopSettingsDraft>(props.snapshot.settings_surface?.draft ?? EMPTY_SETTINGS_DRAFT);
  const [editorState, setEditorState] = createSignal<EnvironmentEditorState>(null);
  const [editorLabel, setEditorLabel] = createSignal('');
  const [editorURL, setEditorURL] = createSignal('');
  const [editorError, setEditorError] = createSignal('');
  const [deleteTarget, setDeleteTarget] = createSignal<DesktopEnvironmentEntry | null>(null);
  let issueRef: HTMLElement | undefined;
  let settingsErrorRef: HTMLElement | undefined;
  let remoteInputRef: HTMLInputElement | undefined;

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
  const isMainOwnedSettingsSurface = createMemo(() => surfaceMode() === 'root' && snapshot().surface === 'this_device_settings');
  const activityItems = createMemo<ActivityBarItem[]>(() => ([
    {
      id: 'connect_environment',
      icon: Globe,
      label: 'Connect Environment',
      onClick: () => showConnectEnvironment(),
    },
  ]));

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
    const error = settingsError();
    if (!error) {
      return;
    }
    queueMicrotask(() => settingsErrorRef?.focus());
  });

  async function refreshSnapshot(): Promise<void> {
    const nextSnapshot = await props.runtime.launcher.getSnapshot();
    setSnapshot(nextSnapshot);
    if (surfaceMode() === 'root' && nextSnapshot.surface !== 'this_device_settings') {
      setSurfaceMode('local');
      setLocalSurface(nextSnapshot.surface);
    }
  }

  function resetMessages(): void {
    setFeedback('');
    setConnectError('');
    setSettingsError('');
  }

  function showConnectEnvironment(message = '', focusRemoteInput = false): void {
    setSurfaceMode('local');
    setLocalSurface('connect_environment');
    setFeedback(trimString(message));
    setConnectError('');
    setSettingsError('');
    if (focusRemoteInput) {
      queueMicrotask(() => remoteInputRef?.focus());
    }
  }

  function openSettingsSurface(): void {
    setSurfaceMode('local');
    setLocalSurface('this_device_settings');
    setFeedback('');
    setConnectError('');
    setSettingsError('');
  }

  async function performNavigationAction(request: Extract<DesktopLauncherActionRequest, Readonly<{
    kind: 'open_this_device' | 'open_remote_device' | 'return_to_current_device';
  }>>): Promise<void> {
    resetMessages();
    setBusyAction(request.kind);
    try {
      await props.runtime.launcher.performAction(request);
    } catch (error) {
      const message = getErrorMessage(error);
      if (visibleSurface() === 'this_device_settings') {
        setSettingsError(message);
      } else {
        setConnectError(message);
      }
    } finally {
      setBusyAction('');
    }
  }

  async function openThisDevice(): Promise<void> {
    await performNavigationAction({ kind: 'open_this_device' });
  }

  async function openRemoteDevice(targetURL: string): Promise<void> {
    const normalizedTargetURL = trimString(targetURL);
    if (!normalizedTargetURL) {
      setConnectError('Environment URL is required.');
      return;
    }
    await performNavigationAction({
      kind: 'open_remote_device',
      external_local_ui_url: normalizedTargetURL,
    });
  }

  async function returnOrQuit(): Promise<void> {
    await performNavigationAction({ kind: 'return_to_current_device' });
  }

  function updateDraftField(name: keyof DesktopSettingsDraft, value: string): void {
    setDraft((current) => ({
      ...current,
      [name]: value,
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
      setFeedback('This Device settings saved.');
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

  function startEditingEnvironment(environment: DesktopEnvironmentEntry): void {
    setEditorState({
      environment_id: environment.id,
      label: environment.label,
      external_local_ui_url: environment.local_ui_url,
    });
    setEditorLabel(environment.label);
    setEditorURL(environment.local_ui_url);
    setEditorError('');
  }

  async function saveEnvironment(): Promise<void> {
    const state = editorState();
    if (!state) {
      return;
    }
    setEditorError('');
    setBusyAction('save_environment');
    try {
      await props.runtime.launcher.performAction({
        kind: 'upsert_saved_environment',
        environment_id: state.environment_id,
        label: trimString(editorLabel()),
        external_local_ui_url: trimString(editorURL()),
      });
      await refreshSnapshot();
      setEditorState(null);
      setEditorLabel('');
      setEditorURL('');
      setFeedback('Environment updated.');
    } catch (error) {
      setEditorError(getErrorMessage(error));
    } finally {
      setBusyAction('');
    }
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
      setFeedback('Environment removed.');
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
        openSettingsSurface={openSettingsSurface}
        openThisDevice={openThisDevice}
        openRemoteDevice={openRemoteDevice}
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
        <Show
          when={visibleSurface() === 'this_device_settings'}
          fallback={(
            <ConnectEnvironmentSurface
              snapshot={snapshot()}
              feedback={feedback()}
              error={connectError()}
              busyAction={busyAction()}
              remoteURL={remoteURL()}
              setRemoteURL={setRemoteURL}
              remoteInputRef={(value) => {
                remoteInputRef = value;
              }}
              issueRef={(value) => {
                issueRef = value;
              }}
              openThisDevice={openThisDevice}
              openSettingsSurface={openSettingsSurface}
              openRemoteDevice={openRemoteDevice}
              editEnvironment={startEditingEnvironment}
              deleteEnvironment={setDeleteTarget}
              copyDiagnostics={async () => {
                await copyToClipboard(snapshot().issue?.diagnostics_copy ?? '');
                setFeedback('Diagnostics copied to the clipboard.');
              }}
            />
          )}
        >
          <ThisDeviceSettingsSurface
            snapshot={settingsSurface()}
            draft={draft()}
            busyAction={busyAction()}
            settingsError={settingsError()}
            settingsErrorRef={(value) => {
              settingsErrorRef = value;
            }}
            updateDraftField={updateDraftField}
            saveSettings={saveSettings}
            cancelSettings={cancelSettings}
          />
        </Show>
      </Shell>

      <Dialog
        open={editorState() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditorState(null);
            setEditorError('');
          }
        }}
        title="Edit Environment"
        footer={(
          <div class="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              class={redevenSurfaceRoleClass('control')}
              disabled={busyAction() === 'save_environment'}
              onClick={() => {
                setEditorState(null);
                setEditorError('');
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="default"
              loading={busyAction() === 'save_environment'}
              onClick={() => {
                void saveEnvironment();
              }}
            >
              Save Environment
            </Button>
          </div>
        )}
      >
        <div class="space-y-4">
          <div class="space-y-1.5">
            <label for="environment-label" class="block text-xs font-medium text-foreground">Label</label>
            <Input
              id="environment-label"
              value={editorLabel()}
              onInput={(event) => setEditorLabel(event.currentTarget.value)}
              placeholder="My Environment"
              size="sm"
              class="w-full"
            />
          </div>
          <div class="space-y-1.5">
            <label for="environment-url" class="block text-xs font-medium text-foreground">Environment URL</label>
            <Input
              id="environment-url"
              value={editorURL()}
              onInput={(event) => setEditorURL(event.currentTarget.value)}
              placeholder="http://192.168.1.11:24000/"
              size="sm"
              class="w-full font-mono"
              spellcheck={false}
            />
          </div>
          <Show when={editorError()}>
            <div role="alert" class="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {editorError()}
            </div>
          </Show>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title="Delete Environment"
        confirmText="Delete Environment"
        variant="destructive"
        loading={busyAction() === 'delete_environment'}
        onConfirm={() => void deleteEnvironment()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            Remove <span class="font-semibold">{deleteTarget()?.label}</span> from saved Environments?
          </p>
          <p class="text-xs text-muted-foreground">This only removes the saved entry from Desktop. It does not stop the Environment.</p>
        </div>
      </ConfirmDialog>
    </>
  );
}

function ConnectEnvironmentSurface(props: Readonly<{
  snapshot: DesktopWelcomeSnapshot;
  feedback: string;
  error: string;
  busyAction: BusyAction;
  remoteURL: string;
  setRemoteURL: (value: string) => void;
  remoteInputRef: (value: HTMLInputElement) => void;
  issueRef: (value: HTMLElement) => void;
  openThisDevice: () => Promise<void>;
  openSettingsSurface: () => void;
  openRemoteDevice: (targetURL: string) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
  copyDiagnostics: () => Promise<void>;
}>) {
  return (
    <div class="h-full min-h-0 overflow-auto bg-background">
      <main id="redeven-desktop-main" class="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Card class={cn('overflow-hidden shadow-sm', redevenSurfaceRoleClass('panelStrong'))}>
          <CardHeader class={cn('gap-3 border-b px-4 py-4 sm:px-5', redevenDividerRoleClass('strong'))}>
            <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div class="min-w-0">
                <div class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Welcome</div>
                <CardTitle class="mt-1 text-xl tracking-tight sm:text-2xl">{buildDesktopWelcomeShellViewModel(props.snapshot).connect_heading}</CardTitle>
                <CardDescription class="mt-2 max-w-3xl text-sm leading-6">
                  Choose a saved Environment or enter a Local UI URL to open another Environment in this Desktop shell.
                </CardDescription>
              </div>
              <Show when={props.snapshot.current_session_target_kind}>
                <Tag variant="success" tone="soft" size="sm" class="cursor-default whitespace-nowrap">
                  Current session available
                </Tag>
              </Show>
            </div>
          </CardHeader>
          <CardContent class="space-y-3 px-4 py-4 sm:px-5">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
              <Input
                ref={props.remoteInputRef}
                value={props.remoteURL}
                onInput={(event) => props.setRemoteURL(event.currentTarget.value)}
                placeholder="http://192.168.1.11:24000/"
                size="sm"
                class="w-full font-mono"
                spellcheck={false}
              />
              <div class="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="default"
                  loading={props.busyAction === 'open_remote_device'}
                  onClick={() => {
                    void props.openRemoteDevice(props.remoteURL);
                  }}
                >
                  Connect
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  class={redevenSurfaceRoleClass('control')}
                  loading={props.busyAction === 'open_this_device'}
                  onClick={() => {
                    void props.openThisDevice();
                  }}
                >
                  Open This Device
                </Button>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{props.snapshot.current_session_description}</span>
            </div>
          </CardContent>
        </Card>

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

        <Show when={props.snapshot.issue}>
          {(issue) => (
            <div
              ref={props.issueRef}
              tabindex="-1"
              class="outline-none"
            >
              <Card class={cn('overflow-hidden border-destructive/25 shadow-sm', redevenSurfaceRoleClass('panel'))}>
                <CardHeader class="gap-2 pb-3">
                  <div class="text-[11px] font-semibold uppercase tracking-widest text-destructive">{issueKicker(issue())}</div>
                  <CardTitle class="text-lg">{issue().title}</CardTitle>
                  <CardDescription class="text-sm leading-6">{issue().message}</CardDescription>
                </CardHeader>
                <Show when={issue().diagnostics_copy}>
                  <CardContent class="space-y-3 pt-0">
                    <pre class="overflow-auto rounded-lg border border-border/70 bg-background px-3 py-3 text-xs leading-6 text-muted-foreground">
                      {issue().diagnostics_copy}
                    </pre>
                    <div class="flex flex-wrap gap-2">
                      <Show when={issue().scope === 'this_device'}>
                        <Button size="sm" variant="default" onClick={() => { void props.openThisDevice(); }}>
                          Open This Device
                        </Button>
                        <Button size="sm" variant="outline" class={redevenSurfaceRoleClass('control')} onClick={props.openSettingsSurface}>
                          This Device Settings
                        </Button>
                      </Show>
                      <Show when={issue().scope === 'remote_device' && issue().target_url}>
                        <Button size="sm" variant="default" onClick={() => { void props.openRemoteDevice(issue().target_url); }}>
                          Retry
                        </Button>
                      </Show>
                      <Button size="sm" variant="outline" class={redevenSurfaceRoleClass('control')} onClick={() => { void props.copyDiagnostics(); }}>
                        <Copy class="mr-1 h-3.5 w-3.5" />
                        Copy Diagnostics
                      </Button>
                    </div>
                  </CardContent>
                </Show>
              </Card>
            </div>
          )}
        </Show>

        <section class="space-y-3">
          <div class="flex items-center gap-3 px-1">
            <h2 class="whitespace-nowrap text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Recommended</h2>
            <div class="h-px flex-1 bg-border/60" />
          </div>
          <div class="grid gap-3">
            <For each={props.snapshot.environments}>
              {(environment) => (
                <EnvironmentCard
                  environment={environment}
                  busyAction={props.busyAction}
                  openThisDevice={props.openThisDevice}
                  openSettingsSurface={props.openSettingsSurface}
                  openRemoteDevice={props.openRemoteDevice}
                  editEnvironment={props.editEnvironment}
                  deleteEnvironment={props.deleteEnvironment}
                />
              )}
            </For>
          </div>
        </section>
      </main>
    </div>
  );
}

function EnvironmentCard(props: Readonly<{
  environment: DesktopEnvironmentEntry;
  busyAction: BusyAction;
  openThisDevice: () => Promise<void>;
  openSettingsSurface: () => void;
  openRemoteDevice: (targetURL: string) => Promise<void>;
  editEnvironment: (environment: DesktopEnvironmentEntry) => void;
  deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
}>) {
  const targetLabel = createMemo(() => (
    props.environment.kind === 'this_device'
      ? props.environment.local_ui_url || props.environment.secondary_text
      : props.environment.local_ui_url
  ));
  const isExternal = createMemo(() => props.environment.kind === 'external_local_ui');

  return (
    <Card
      class={cn(
        'overflow-hidden shadow-sm transition-colors',
        props.environment.is_current ? redevenSurfaceRoleClass('panelStrong') : redevenSurfaceRoleClass('panelInteractive'),
      )}
    >
      <CardHeader class="gap-3 pb-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <CardTitle class="text-sm truncate">{props.environment.label}</CardTitle>
              <Show when={props.environment.tag}>
                <Tag
                  variant={environmentTagVariant(props.environment.tag)}
                  tone="soft"
                  size="sm"
                  class="cursor-default whitespace-nowrap"
                >
                  {props.environment.tag}
                </Tag>
              </Show>
            </div>
            <CardDescription class="mt-1 break-all text-xs leading-5">{props.environment.secondary_text}</CardDescription>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="default"
              loading={props.environment.kind === 'this_device' && props.busyAction === 'open_this_device'}
              onClick={() => {
                if (props.environment.kind === 'this_device') {
                  void props.openThisDevice();
                  return;
                }
                void props.openRemoteDevice(props.environment.local_ui_url);
              }}
            >
              {props.environment.kind === 'this_device' ? 'Open This Device' : 'Open'}
            </Button>
            <Show when={props.environment.kind === 'this_device'}>
              <Button
                size="sm"
                variant="outline"
                class={redevenSurfaceRoleClass('control')}
                onClick={props.openSettingsSurface}
              >
                <Settings class="mr-1 h-3.5 w-3.5" />
                This Device Settings
              </Button>
            </Show>
            <Show when={isExternal() && props.environment.can_edit}>
              <Button
                size="sm"
                variant="ghost"
                class="text-muted-foreground"
                onClick={() => props.editEnvironment(props.environment)}
                aria-label={`Edit ${props.environment.label}`}
                title="Edit Environment"
              >
                <Pencil class="h-3.5 w-3.5" />
              </Button>
            </Show>
            <Show when={isExternal() && props.environment.can_delete}>
              <Button
                size="sm"
                variant="ghost"
                class="text-muted-foreground hover:text-destructive"
                onClick={() => props.deleteEnvironment(props.environment)}
                aria-label={`Delete ${props.environment.label}`}
                title="Delete Environment"
              >
                <Trash class="h-3.5 w-3.5" />
              </Button>
            </Show>
          </div>
        </div>
      </CardHeader>
      <CardContent class="pt-0">
        <div class="grid gap-y-1 text-[11px] sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
          <div class="text-muted-foreground">Target</div>
          <div class="min-w-0 truncate font-mono text-foreground" title={targetLabel()}>
            {targetLabel()}
          </div>
          <Show when={props.environment.last_used_at_ms > 0 && isExternal()}>
            <div class="text-muted-foreground">Last used</div>
            <div class="text-foreground">{formatTimestamp(props.environment.last_used_at_ms)}</div>
          </Show>
        </div>
      </CardContent>
    </Card>
  );
}

function ThisDeviceSettingsSurface(props: Readonly<{
  snapshot: DesktopSettingsSurfaceSnapshot;
  draft: DesktopSettingsDraft;
  busyAction: BusyAction;
  settingsError: string;
  settingsErrorRef: (value: HTMLElement) => void;
  updateDraftField: (name: keyof DesktopSettingsDraft, value: string) => void;
  saveSettings: () => Promise<void>;
  cancelSettings: () => void;
}>) {
  return (
    <div class="h-full min-h-0 overflow-auto bg-background">
      <main id="redeven-desktop-main" class="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Card class={cn('overflow-hidden shadow-sm', redevenSurfaceRoleClass('panelStrong'))}>
          <CardHeader class={cn('gap-3 border-b px-4 py-4 sm:px-5', redevenDividerRoleClass('strong'))}>
            <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div class="min-w-0">
                <div class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">This Device</div>
                <CardTitle class="mt-1 text-xl tracking-tight sm:text-2xl">{props.snapshot.window_title}</CardTitle>
                <CardDescription class="mt-2 max-w-3xl text-sm leading-6">{props.snapshot.lead}</CardDescription>
              </div>
              <div class="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  class={redevenSurfaceRoleClass('control')}
                  onClick={props.cancelSettings}
                >
                  Back
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
            </div>
          </CardHeader>
          <CardContent class="grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-3">
            <For each={props.snapshot.summary_items}>
              {(item) => (
                <Card class={cn('shadow-none', redevenSurfaceRoleClass('panel'))}>
                  <CardHeader class="gap-1 pb-2">
                    <div class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{item.label}</div>
                    <CardTitle class="text-sm">{item.value}</CardTitle>
                  </CardHeader>
                  <CardContent class="pt-0 text-xs leading-5 text-muted-foreground">
                    {item.body}
                  </CardContent>
                </Card>
              )}
            </For>
          </CardContent>
        </Card>

        <Card class={cn('overflow-hidden shadow-sm', redevenSurfaceRoleClass('panel'))}>
          <CardHeader class="gap-2 pb-3">
            <div class="text-[11px] font-semibold uppercase tracking-widest text-primary">{props.snapshot.alert.kicker}</div>
            <CardTitle class="text-lg">{props.snapshot.alert.title}</CardTitle>
            <CardDescription class="text-sm leading-6">{props.snapshot.alert.body}</CardDescription>
          </CardHeader>
        </Card>

        <Show when={props.settingsError}>
          <div
            ref={props.settingsErrorRef}
            tabindex="-1"
            id="settings-error"
            role="alert"
            class="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive outline-none"
          >
            {props.settingsError}
          </div>
        </Show>

        <For each={props.snapshot.sections}>
          {(section) => (
            <section class="space-y-3">
              <div class="flex items-center gap-3 px-1">
                <h2 class="whitespace-nowrap text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{section.title}</h2>
                <div class="h-px flex-1 bg-border/60" />
              </div>
              <div class="grid gap-3">
                <For each={section.cards}>
                  {(card) => (
                    <Card class={cn('overflow-hidden shadow-sm', redevenSurfaceRoleClass('panelStrong'))}>
                      <CardHeader class={cn('gap-2 border-b px-4 py-4 sm:px-5', redevenDividerRoleClass('strong'))}>
                        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div class="min-w-0">
                            <div class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{card.kicker}</div>
                            <div class="mt-1 flex flex-wrap items-center gap-2">
                              <CardTitle class="text-lg">{card.title}</CardTitle>
                              <Show when={card.badge}>
                                <Tag variant="neutral" tone="soft" size="sm" class="cursor-default">
                                  {card.badge}
                                </Tag>
                              </Show>
                            </div>
                            <div class="mt-2 text-sm leading-6 text-muted-foreground" innerHTML={card.descriptionHTML} />
                          </div>
                          <Show when={card.stateNote}>
                            {(stateNote) => (
                              <Tag variant="primary" tone="soft" size="sm" class="cursor-default whitespace-normal text-left">
                                {stateNote().text}
                              </Tag>
                            )}
                          </Show>
                        </div>
                      </CardHeader>
                      <CardContent class="grid gap-4 px-4 py-4 sm:px-5 md:grid-cols-2">
                        <For each={card.fields}>
                          {(field) => (
                            <label classList={{ hidden: field.hidden }} class="grid gap-1.5">
                              <span class="text-xs font-medium text-foreground">{field.label}</span>
                              <Input
                                id={field.id}
                                name={field.name}
                                value={props.draft[field.name]}
                                type={field.type ?? 'text'}
                                autocomplete={field.autocomplete}
                                inputMode={field.inputMode}
                                placeholder={field.placeholder}
                                spellcheck={false}
                                aria-describedby={field.describedBy?.join(' ') || undefined}
                                size="sm"
                                class="w-full"
                                onInput={(event) => props.updateDraftField(field.name, event.currentTarget.value)}
                              />
                              <Show when={field.helpHTML && field.helpId}>
                                <div id={field.helpId!} class="text-xs leading-5 text-muted-foreground" innerHTML={field.helpHTML!} />
                              </Show>
                            </label>
                          )}
                        </For>
                      </CardContent>
                    </Card>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </main>
    </div>
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
