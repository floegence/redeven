import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import { FloeProvider, useCommand, useTheme } from '@floegence/floe-webapp-core';
import {
  Activity,
  Bot,
  Code,
  Copy,
  Files,
  Globe,
  LayoutDashboard,
  Loader2,
  Moon,
  Search,
  Settings,
  Sparkles,
  Sun,
  Terminal,
  X,
} from '@floegence/floe-webapp-core/icons';
import { BottomBarItem, Shell, StatusIndicator, TopBarIconButton, type ActivityBarItem } from '@floegence/floe-webapp-core/layout';
import { CommandPalette } from '@floegence/floe-webapp-core/ui';

import type { DesktopSettingsSurfaceSnapshot } from '../shared/desktopSettingsSurface';
import type {
  DesktopLauncherActionRequest,
  DesktopLauncherSurface,
  DesktopWelcomeIssue,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import type { DesktopSettingsDraft, SaveDesktopSettingsResult } from '../shared/settingsIPC';
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
  launcher: Pick<DesktopLauncherBridge, 'performAction'>;
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

const WORKBENCH_ITEMS: ReadonlyArray<Readonly<{
  id: string;
  label: string;
  icon: Component<{ class?: string }>;
}>> = [
  { id: 'deck', label: 'Deck', icon: LayoutDashboard },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'monitor', label: 'Monitoring', icon: Activity },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'codespaces', label: 'Codespaces', icon: Code },
  { id: 'ports', label: 'Ports', icon: Globe },
  { id: 'flower', label: 'Flower', icon: Sparkles },
  { id: 'codex', label: 'Codex', icon: Bot },
];

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return trimString(error.message);
  }
  return trimString(error);
}

function issueKicker(issue: DesktopWelcomeIssue): string {
  switch (issue.scope) {
    case 'remote_device':
      return 'Remote device';
    case 'this_device':
      return 'This device';
    default:
      return 'Desktop startup';
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

function DesktopCommandRegistrar(props: DesktopWelcomeShellProps & Readonly<{
  visibleSurface: () => DesktopLauncherSurface;
  showMachineChooser: (message?: string, focusRemoteInput?: boolean) => void;
  openThisDevice: () => Promise<void>;
  openAdvancedSettings: () => Promise<void>;
  openRemoteDevice: (targetURL: string) => Promise<void>;
}>): null {
  const cmd = useCommand();
  const theme = useTheme();

  createEffect(() => {
    const list = [
      {
        id: 'redeven.desktop.openThisDevice',
        title: 'Open This Device',
        description: 'Start or return to the local Redeven runtime',
        category: 'Launcher',
        keybind: 'mod+enter',
        icon: Terminal,
        execute: () => {
          void props.openThisDevice();
        },
      },
      {
        id: 'redeven.desktop.switchMachine',
        title: 'Switch Machine',
        description: 'Return to the machine chooser',
        category: 'Launcher',
        keybind: 'mod+shift+m',
        icon: Search,
        execute: () => props.showMachineChooser('Choose This Device, a recent machine, or paste a Redeven URL.'),
      },
      {
        id: 'redeven.desktop.openSettings',
        title: 'Open This Device Settings',
        description: 'Edit local startup and bootstrap options',
        category: 'Launcher',
        keybind: 'mod+,',
        icon: Settings,
        execute: () => {
          void props.openAdvancedSettings();
        },
      },
      {
        id: 'redeven.desktop.focusRemoteDeviceField',
        title: 'Connect Another Device',
        description: 'Focus the Redeven URL field in the chooser',
        category: 'Launcher',
        icon: Globe,
        execute: () => props.showMachineChooser('Paste a Redeven URL to open another machine.', true),
      },
      {
        id: 'redeven.desktop.returnOrQuit',
        title: props.snapshot.close_action_label,
        description: props.snapshot.close_action_label === 'Quit'
          ? 'Quit Redeven Desktop'
          : 'Return to the currently opened machine',
        category: 'General',
        icon: X,
        execute: () => {
          void props.runtime.launcher.performAction({ kind: 'return_to_current_device' });
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

    for (const recentDevice of props.snapshot.recent_devices.slice(0, 3)) {
      list.push({
        id: `redeven.desktop.openRecent.${recentDevice.local_ui_url}`,
        title: `Open ${recentDevice.local_ui_url}`,
        description: recentDevice.is_active_session ? 'Return to the current remote machine' : 'Open a recent Redeven machine',
        category: 'Recent Machines',
        icon: Globe,
        execute: () => {
          void props.openRemoteDevice(recentDevice.local_ui_url);
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
  const [surfaceOverride, setSurfaceOverride] = createSignal<DesktopLauncherSurface | null>(null);
  const [remoteURL, setRemoteURL] = createSignal(props.snapshot.suggested_remote_url);
  const [chooserMessage, setChooserMessage] = createSignal('');
  const [chooserError, setChooserError] = createSignal('');
  const [settingsError, setSettingsError] = createSignal('');
  const [busyAction, setBusyAction] = createSignal('');
  const [draft, setDraft] = createSignal<DesktopSettingsDraft>(props.snapshot.settings_surface?.draft ?? EMPTY_SETTINGS_DRAFT);
  let issueRef: HTMLElement | undefined;
  let chooserHeadingRef: HTMLHeadingElement | undefined;
  let settingsErrorRef: HTMLElement | undefined;
  let remoteInputRef: HTMLInputElement | undefined;

  const visibleSurface = createMemo<DesktopLauncherSurface>(() => surfaceOverride() ?? props.snapshot.surface);
  const status = createMemo(() => shellStatus(props.snapshot));
  const settingsSurface = createMemo<DesktopSettingsSurfaceSnapshot | null>(() => props.snapshot.settings_surface ?? null);
  const shellView = createMemo(() => buildDesktopWelcomeShellViewModel(props.snapshot, visibleSurface()));

  createEffect(() => {
    setRemoteURL(props.snapshot.suggested_remote_url);
    setDraft(props.snapshot.settings_surface?.draft ?? EMPTY_SETTINGS_DRAFT);
  });

  createEffect(() => {
    if (props.snapshot.surface === 'this_device_settings') {
      setSurfaceOverride(null);
    }
  });

  createEffect(() => {
    if (visibleSurface() !== 'machine_chooser' || !props.snapshot.issue) {
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

  const showMachineChooser = (message = '', focusRemoteInput = false): void => {
    setSurfaceOverride('machine_chooser');
    setChooserMessage(trimString(message));
    setChooserError('');
    setSettingsError('');
    if (focusRemoteInput) {
      queueMicrotask(() => remoteInputRef?.focus());
      return;
    }
    queueMicrotask(() => chooserHeadingRef?.focus());
  };

  const performAction = async (request: DesktopLauncherActionRequest): Promise<void> => {
    setChooserError('');
    setSettingsError('');
    setBusyAction(request.kind);
    try {
      await props.runtime.launcher.performAction(request);
    } catch (error) {
      const message = getErrorMessage(error);
      if (visibleSurface() === 'this_device_settings') {
        setSettingsError(message);
      } else {
        setChooserError(message);
      }
    } finally {
      setBusyAction('');
    }
  };

  const openThisDevice = async (): Promise<void> => {
    setChooserMessage('');
    await performAction({ kind: 'open_this_device' });
  };

  const openRemoteDevice = async (targetURL: string): Promise<void> => {
    setChooserMessage('');
    await performAction({
      kind: 'open_remote_device',
      external_local_ui_url: trimString(targetURL),
    });
  };

  const openAdvancedSettings = async (): Promise<void> => {
    setChooserMessage('');
    setSurfaceOverride(null);
    await performAction({ kind: 'open_advanced_settings' });
  };

  const openCapability = (label: string): void => {
    showMachineChooser(capabilityUnavailableMessage(label));
  };

  const saveSettings = async (): Promise<void> => {
    setSettingsError('');
    setBusyAction('save_settings');
    try {
      const result = await props.runtime.settings.save(draft());
      if (!result.ok) {
        setSettingsError(result.error);
      }
    } catch (error) {
      setSettingsError(getErrorMessage(error));
    } finally {
      setBusyAction('');
    }
  };

  const cancelSettings = (): void => {
    setSettingsError('');
    props.runtime.settings.cancel();
  };

  const workbenchActivityItems = (): ActivityBarItem[] => WORKBENCH_ITEMS.map((item) => ({
    id: item.id,
    icon: item.icon,
    label: item.label,
    onClick: () => openCapability(item.label),
  }));

  const utilityActivityItems = (): ActivityBarItem[] => ([
    {
      id: 'switch-machine',
      icon: Search,
      label: 'Switch Machine',
      onClick: () => showMachineChooser('Choose This Device, a recent machine, or paste a Redeven URL.'),
    },
    {
      id: 'settings',
      icon: Settings,
      label: 'Settings',
      onClick: () => {
        void openAdvancedSettings();
      },
    },
  ]);

  const updateDraftField = (name: keyof DesktopSettingsDraft, value: string): void => {
    setDraft((current) => ({
      ...current,
      [name]: value,
    }));
  };

  return (
    <>
      <DesktopCommandRegistrar
        snapshot={props.snapshot}
        runtime={props.runtime}
        visibleSurface={visibleSurface}
        showMachineChooser={showMachineChooser}
        openThisDevice={openThisDevice}
        openAdvancedSettings={openAdvancedSettings}
        openRemoteDevice={openRemoteDevice}
      />
      <Shell
        sidebarMode="hidden"
        activityItems={workbenchActivityItems()}
        activityBottomItems={utilityActivityItems()}
        activityBottomItemsMobileMode="topBar"
        logo={
          <div class="flex items-center gap-2">
            <div class="flex h-6 w-6 items-center justify-center rounded-md border border-border/70 bg-primary/10 text-[11px] font-semibold text-primary">
              R
            </div>
            <div class="hidden sm:flex flex-col leading-none">
              <span class="text-xs font-semibold text-foreground">Redeven Desktop</span>
              <span class="text-[10px] text-muted-foreground">{shellView().surface_title}</span>
            </div>
          </div>
        }
        topBarActions={
          <div class="flex items-center gap-1">
            <TopBarIconButton
              label={theme.resolvedTheme() === 'light' ? 'Use dark theme' : 'Use light theme'}
              onClick={() => theme.toggleTheme()}
            >
              {theme.resolvedTheme() === 'light' ? <Moon class="h-4 w-4" /> : <Sun class="h-4 w-4" />}
            </TopBarIconButton>
            <TopBarIconButton
              label={props.snapshot.close_action_label}
              onClick={() => {
                void props.runtime.launcher.performAction({ kind: 'return_to_current_device' });
              }}
            >
              <X class="h-4 w-4" />
            </TopBarIconButton>
          </div>
        }
        bottomBarItems={
          <>
            <div class="flex items-center gap-2">
              <StatusIndicator status={status().tone} label={status().label} />
              <BottomBarItem>{shellView().surface_title}</BottomBarItem>
            </div>
            <div class="flex items-center gap-2">
              <BottomBarItem>{props.snapshot.this_device_share_label}</BottomBarItem>
              <BottomBarItem>{props.snapshot.this_device_link_label}</BottomBarItem>
            </div>
          </>
        }
      >
        <Show
          when={visibleSurface() === 'this_device_settings'}
          fallback={
            <MachineChooserSurface
              snapshot={props.snapshot}
              chooserMessage={chooserMessage()}
              chooserError={chooserError()}
              busyAction={busyAction()}
              issueRef={(value) => {
                issueRef = value;
              }}
              chooserHeadingRef={(value) => {
                chooserHeadingRef = value;
              }}
              remoteInputRef={(value) => {
                remoteInputRef = value;
              }}
              remoteURL={remoteURL()}
              setRemoteURL={setRemoteURL}
              openThisDevice={openThisDevice}
              openAdvancedSettings={openAdvancedSettings}
              openRemoteDevice={openRemoteDevice}
              copyDiagnostics={async () => {
                await copyToClipboard(props.snapshot.issue?.diagnostics_copy ?? '');
                setChooserMessage('Diagnostics copied to the clipboard.');
              }}
            />
          }
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
    </>
  );
}

function MachineChooserSurface(props: Readonly<{
  snapshot: DesktopWelcomeSnapshot;
  chooserMessage: string;
  chooserError: string;
  busyAction: string;
  remoteURL: string;
  setRemoteURL: (value: string) => void;
  issueRef: (value: HTMLElement) => void;
  chooserHeadingRef: (value: HTMLHeadingElement) => void;
  remoteInputRef: (value: HTMLInputElement) => void;
  openThisDevice: () => Promise<void>;
  openAdvancedSettings: () => Promise<void>;
  openRemoteDevice: (targetURL: string) => Promise<void>;
  copyDiagnostics: () => Promise<void>;
}>) {
  return (
    <div class="min-h-full bg-background">
      <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <section class="rounded-xl border border-border bg-card/90 px-5 py-5 shadow-sm">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div class="max-w-3xl">
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Machine launcher</p>
              <h1
                ref={props.chooserHeadingRef}
                tabindex="-1"
                class="mt-2 text-3xl font-semibold tracking-tight text-foreground outline-none sm:text-4xl"
              >
                {buildDesktopWelcomeShellViewModel(props.snapshot).chooser_heading}
              </h1>
              <p class="mt-3 text-sm leading-7 text-muted-foreground">
                Start from the same desktop shell every time. Choose This Device, reopen a recent machine,
                or paste the Local UI URL of another Redeven host.
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={props.busyAction === 'open_this_device'}
                onClick={() => {
                  void props.openThisDevice();
                }}
                class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Show when={props.busyAction === 'open_this_device'}>
                  <Loader2 class="h-4 w-4 animate-spin" />
                </Show>
                Open This Device
              </button>
              <button
                type="button"
                onClick={() => {
                  void props.openAdvancedSettings();
                }}
                class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
              >
                This Device Settings
              </button>
            </div>
          </div>

          <div class="mt-5 grid gap-3 md:grid-cols-3">
            <SummaryCard
              label="Current session"
              title={props.snapshot.current_session_label}
              body={props.snapshot.current_session_description}
            />
            <SummaryCard
              label="This Device sharing"
              title={props.snapshot.this_device_share_label}
              body={props.snapshot.this_device_share_description}
            />
            <SummaryCard
              label="Remote control"
              title={props.snapshot.this_device_link_label}
              body={props.snapshot.this_device_link_description}
            />
          </div>
        </section>

        <Show when={props.chooserMessage}>
          <section class="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
            {props.chooserMessage}
          </section>
        </Show>

        <Show when={props.snapshot.issue}>
          {(issue) => (
            <section
              ref={props.issueRef}
              tabindex="-1"
              role="alert"
              class="rounded-xl border border-error/30 bg-error/5 px-5 py-4 outline-none"
            >
              <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-error">{issueKicker(issue())}</div>
              <h2 class="mt-2 text-xl font-semibold text-foreground">{issue().title}</h2>
              <p class="mt-2 text-sm leading-7 text-muted-foreground">{issue().message}</p>
              <Show when={issue().diagnostics_copy}>
                <pre class="mt-4 overflow-auto rounded-lg border border-border bg-background px-4 py-3 text-xs leading-6 text-muted-foreground">
                  {issue().diagnostics_copy}
                </pre>
              </Show>
              <div class="mt-4 flex flex-wrap gap-2">
                <Show when={issue().scope === 'this_device'}>
                  <button
                    type="button"
                    onClick={() => {
                      void props.openThisDevice();
                    }}
                    class="inline-flex cursor-pointer items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Try This Device Again
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void props.openAdvancedSettings();
                    }}
                    class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                  >
                    This Device Settings
                  </button>
                </Show>
                <Show when={issue().scope === 'remote_device' && issue().target_url}>
                  <button
                    type="button"
                    onClick={() => {
                      void props.openRemoteDevice(issue().target_url);
                    }}
                    class="inline-flex cursor-pointer items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Retry Device
                  </button>
                </Show>
                <Show when={issue().diagnostics_copy}>
                  <button
                    type="button"
                    onClick={() => {
                      void props.copyDiagnostics();
                    }}
                    class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                  >
                    <Copy class="h-4 w-4" />
                    Copy Diagnostics
                  </button>
                </Show>
              </div>
            </section>
          )}
        </Show>

        <Show when={props.chooserError}>
          <section role="alert" class="rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
            {props.chooserError}
          </section>
        </Show>

        <div class="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.9fr)]">
          <section class="flex min-w-0 flex-col gap-6">
            <article class="rounded-xl border border-border bg-card px-5 py-5 shadow-sm">
              <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div class="max-w-2xl">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">This Device</p>
                  <h2 class="mt-2 text-2xl font-semibold text-foreground">Open the runtime on this machine</h2>
                  <p class="mt-2 text-sm leading-7 text-muted-foreground">
                    Keep machine choice simple. Low-level bind, password, and bootstrap options live behind This Device Settings,
                    so the launcher stays focused on selecting where you want to work.
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={props.busyAction === 'open_this_device'}
                    onClick={() => {
                      void props.openThisDevice();
                    }}
                    class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Show when={props.busyAction === 'open_this_device'}>
                      <Loader2 class="h-4 w-4 animate-spin" />
                    </Show>
                    Open This Device
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void props.openAdvancedSettings();
                    }}
                    class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                  >
                    This Device Settings
                  </button>
                </div>
              </div>
              <Show when={props.snapshot.this_device_local_ui_url}>
                <div class="mt-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                  <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Desktop-managed Local UI</div>
                  <div class="mt-2 font-mono text-sm text-foreground">{props.snapshot.this_device_local_ui_url}</div>
                </div>
              </Show>
            </article>

            <article class="rounded-xl border border-border bg-card px-5 py-5 shadow-sm">
              <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recent machines</p>
              <h2 class="mt-2 text-2xl font-semibold text-foreground">Open another machine</h2>
              <p class="mt-2 text-sm leading-7 text-muted-foreground">
                Recent Redeven targets stay one click away, just like reopening a recent project from a workbench shell.
              </p>

              <div class="mt-5 grid gap-3">
                <Show
                  when={props.snapshot.recent_devices.length > 0}
                  fallback={
                    <div class="rounded-lg border border-dashed border-border bg-background px-4 py-4 text-sm text-muted-foreground">
                      No recent machines yet. Connect to another Redeven host once and it will appear here next time.
                    </div>
                  }
                >
                  <For each={props.snapshot.recent_devices}>
                    {(device) => (
                      <button
                        type="button"
                        onClick={() => {
                          void props.openRemoteDevice(device.local_ui_url);
                        }}
                        class="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border bg-background px-4 py-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                      >
                        <div class="min-w-0">
                          <div class="text-sm font-medium text-foreground">Recent machine</div>
                          <div class="mt-1 break-all font-mono text-sm text-muted-foreground">{device.local_ui_url}</div>
                        </div>
                        <Show when={device.is_active_session}>
                          <span class="inline-flex shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                            Current
                          </span>
                        </Show>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </article>
          </section>

          <aside class="rounded-xl border border-border bg-card px-5 py-5 shadow-sm">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Connect another device</p>
            <h2 class="mt-2 text-2xl font-semibold text-foreground">Paste a Redeven URL</h2>
            <p class="mt-2 text-sm leading-7 text-muted-foreground">
              Enter the base Local UI URL from another machine. Redeven Desktop will normalize it and open the device in this window.
            </p>

            <label for="remote-url" class="mt-5 block text-sm font-medium text-foreground">
              Redeven URL
            </label>
            <input
              id="remote-url"
              ref={props.remoteInputRef}
              value={props.remoteURL}
              onInput={(event) => props.setRemoteURL(event.currentTarget.value)}
              type="url"
              autocomplete="url"
              spellcheck={false}
              placeholder="http://192.168.1.11:24000/"
              class="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
            />

            <div class="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={props.busyAction === 'open_remote_device'}
                onClick={() => {
                  void props.openRemoteDevice(props.remoteURL);
                }}
                class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Show when={props.busyAction === 'open_remote_device'}>
                  <Loader2 class="h-4 w-4 animate-spin" />
                </Show>
                Open Device
              </button>
              <button
                type="button"
                onClick={() => {
                  void props.openAdvancedSettings();
                }}
                class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
              >
                Settings
              </button>
            </div>

            <div class="mt-8 rounded-xl border border-border bg-background px-4 py-4">
              <div class="text-sm font-medium text-foreground">Workbench-first startup</div>
              <p class="mt-2 text-sm leading-7 text-muted-foreground">
                The shell stays visible from launch, but machine selection remains the first task.
                Once a machine is chosen, the same workbench areas become the active environment surface.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ThisDeviceSettingsSurface(props: Readonly<{
  snapshot: DesktopSettingsSurfaceSnapshot | null;
  draft: DesktopSettingsDraft;
  busyAction: string;
  settingsError: string;
  settingsErrorRef: (value: HTMLElement) => void;
  updateDraftField: (name: keyof DesktopSettingsDraft, value: string) => void;
  saveSettings: () => Promise<void>;
  cancelSettings: () => void;
}>) {
  return (
    <div class="min-h-full bg-background">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <Show
          when={props.snapshot}
          fallback={
            <section class="rounded-xl border border-error/30 bg-error/5 px-5 py-4 text-sm text-error">
              Desktop could not load This Device settings.
            </section>
          }
        >
          {(snapshot) => (
            <>
              <section class="rounded-xl border border-border bg-card px-5 py-5 shadow-sm">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div class="max-w-3xl">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">This Device settings</p>
                    <h1 class="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                      {snapshot().window_title}
                    </h1>
                    <p class="mt-3 text-sm leading-7 text-muted-foreground">{snapshot().lead}</p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => props.cancelSettings()}
                      class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={props.busyAction === 'save_settings'}
                      onClick={() => {
                        void props.saveSettings();
                      }}
                      class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Show when={props.busyAction === 'save_settings'}>
                        <Loader2 class="h-4 w-4 animate-spin" />
                      </Show>
                      {snapshot().save_label}
                    </button>
                  </div>
                </div>

                <div class="mt-5 grid gap-3 md:grid-cols-3">
                  <For each={snapshot().summary_items}>
                    {(item) => (
                      <SummaryCard label={item.label} title={item.value} body={item.body} />
                    )}
                  </For>
                </div>
              </section>

              <section class="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
                <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{snapshot().alert.kicker}</div>
                <h2 class="mt-2 text-xl font-semibold text-foreground">{snapshot().alert.title}</h2>
                <p class="mt-2 text-sm leading-7 text-muted-foreground">{snapshot().alert.body}</p>
              </section>

              <Show when={props.settingsError}>
                <section
                  ref={props.settingsErrorRef}
                  tabindex="-1"
                  id="settings-error"
                  role="alert"
                  class="rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error outline-none"
                >
                  {props.settingsError}
                </section>
              </Show>

              <For each={snapshot().sections}>
                {(section) => (
                  <section class="rounded-xl border border-border bg-card px-5 py-5 shadow-sm">
                    <div class="flex items-center gap-3">
                      <h2 class="text-xl font-semibold text-foreground">{section.title}</h2>
                      <div class="h-px flex-1 bg-border" />
                    </div>
                    <div class="mt-5 grid gap-4">
                      <For each={section.cards}>
                        {(card) => (
                          <article class="rounded-xl border border-border bg-background px-4 py-4">
                            <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div class="max-w-3xl">
                                <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{card.kicker}</p>
                                <div class="mt-2 flex flex-wrap items-center gap-2">
                                  <h3 class="text-lg font-semibold text-foreground">{card.title}</h3>
                                  <Show when={card.badge}>
                                    <span class="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                                      {card.badge}
                                    </span>
                                  </Show>
                                </div>
                                <p class="mt-2 text-sm leading-7 text-muted-foreground" innerHTML={card.descriptionHTML} />
                              </div>
                              <Show when={card.stateNote}>
                                {(stateNote) => (
                                  <div class="rounded-lg border border-border bg-card px-3 py-2 text-xs leading-6 text-muted-foreground">
                                    {stateNote().text}
                                  </div>
                                )}
                              </Show>
                            </div>

                            <div class="mt-4 grid gap-4 md:grid-cols-2">
                              <For each={card.fields}>
                                {(field) => (
                                  <label classList={{ hidden: field.hidden }} class="grid gap-2">
                                    <span class="text-sm font-medium text-foreground">{field.label}</span>
                                    <input
                                      id={field.id}
                                      name={field.name}
                                      value={props.draft[field.name]}
                                      type={field.type ?? 'text'}
                                      autocomplete={field.autocomplete}
                                      inputMode={field.inputMode}
                                      placeholder={field.placeholder}
                                      spellcheck={false}
                                      aria-describedby={field.describedBy?.join(' ') || undefined}
                                      onInput={(event) => props.updateDraftField(field.name, event.currentTarget.value)}
                                      class="block w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
                                    />
                                    <Show when={field.helpHTML && field.helpId}>
                                      <div id={field.helpId!} class="text-xs leading-6 text-muted-foreground" innerHTML={field.helpHTML!} />
                                    </Show>
                                  </label>
                                )}
                              </For>
                            </div>
                          </article>
                        )}
                      </For>
                    </div>
                  </section>
                )}
              </For>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}

function SummaryCard(props: Readonly<{
  label: string;
  title: string;
  body: string;
}>) {
  return (
    <article class="rounded-lg border border-border bg-background px-4 py-4">
      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{props.label}</div>
      <div class="mt-2 text-lg font-semibold text-foreground">{props.title}</div>
      <p class="mt-2 text-sm leading-7 text-muted-foreground">{props.body}</p>
    </article>
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
