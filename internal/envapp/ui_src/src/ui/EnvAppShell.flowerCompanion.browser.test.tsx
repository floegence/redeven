import '../index.css';
import './flower-feature.css';


import { Show, createContext, createEffect, createSignal, useContext } from 'solid-js';
import { Portal, render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { CommandProvider, FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';

const EnvContextMock = createContext({} as any);
const FilePreviewContextMock = createContext({} as any);
const FileBrowserSurfaceContextMock = createContext({} as any);
let floeRegistryComponents = (): any[] => [];

const filePreviewOpenPreviewMock = vi.fn(async () => undefined);
const filePreviewClosePreviewMock = vi.fn();
const filePreviewSaveCurrentMock = vi.fn(async () => undefined);
const debugConsoleShowMock = vi.fn(() => {
  debugConsoleEnabled = true;
});
const debugConsoleCloseMock = vi.fn(async () => {
  debugConsoleEnabled = false;
});
const windowOpenMock = vi.fn();
const getLocalRuntimeMock = vi.fn();
const getLocalAccessStatusMock = vi.fn();
const unlockLocalAccessMock = vi.fn();
const getEnvAppAccessStatusMock = vi.fn();
const getEnvironmentMock = vi.fn();
const mintLocalDirectConnectArtifactMock = vi.fn();
const connectArtifactEntryMock = vi.fn();
const flowerLaunchTurnMock = vi.fn(async () => ({
  thread_id: 'thread-launched',
  turn_id: 'turn-launched',
  run_id: 'run-launched',
  kind: 'start' as const,
}));

let debugConsoleEnabled = false;
let protocolStatus: 'connected' | 'disconnected' | 'connecting' | 'error' = 'disconnected';
let protocolClient: unknown = null;
let desktopViewMode: 'activity' | 'workbench' = 'activity';
let envAIPageMountSequence = 0;
let activityFlowerSubmitting = false;
let activityFlowerPresence: any;
let publishActivityFlowerPresence: (presence: any) => void = () => undefined;
const uiStorageItems = new Map<string, string>();

function runningActivityFlowerPresence() {
  return {
    priority_status: 'running',
    priority_count: 1,
    priority_thread_title: 'Refine the Flower companion with a deliberately long live task title',
    priority_thread_progress: 'The newest Flower response remains visible while all earlier words move out to the left edge',
    priority_thread_progress_kind: 'output',
    priority_thread_progress_identity: 'thread-live\u001frun-live\u001fassistant-live\u001fblock:0',
    priority_thread_id: 'thread-live',
    priority_run_id: 'run-live',
    priority_run_generation: 1,
    attention_count: 0,
    unread_failed_count: 0,
    running_count: 1,
    queued_count: 0,
    unread_canceled_count: 0,
    unread_completed_count: 0,
  };
}

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{
    reducedMotion?: null | 'reduce' | 'no-preference';
  }>) => Promise<void>;
}>;

function testFlowerTurnIntent(sourceSurface: string) {
  return {
    id: `intent-${sourceSurface}`,
    source_surface: sourceSurface,
    suggested_working_dir: '/workspace/app',
    context_items: [{
      kind: 'file_path',
      path: '/workspace/app',
      is_directory: true,
      root_label: 'Workspace',
    }],
    pending_attachments: [],
    notes: [],
    context_action: {
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      target: {
        target_id: 'current',
        locality: 'auto',
      },
      source: {
        surface: sourceSurface,
      },
      context: [],
      presentation: {
        label: 'Ask Flower',
        priority: 100,
      },
    },
  };
}

const connectMock = vi.fn(async () => {
  protocolStatus = 'connected';
  protocolClient = { id: 'client-1' };
});
vi.mock('@floegence/floe-webapp-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core')>(),
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  deferAfterPaint: (fn: () => void) => setTimeout(fn, 0),
  useCommand: () => ({ open: vi.fn(), registerAll: () => () => {}, getKeybindDisplay: (keybind: string) => keybind }),
  useNotification: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
  useTheme: () => ({
    theme: () => 'system',
    resolvedTheme: () => 'dark',
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
    themePresets: () => [],
    themePreset: () => undefined,
    setThemePreset: vi.fn(),
    shellPresets: () => [],
    shellPreset: () => undefined,
    shellPresetForMode: () => undefined,
    setShellPreset: vi.fn(),
    selectShellTheme: vi.fn(),
  }),
}));

vi.mock('@floegence/floe-webapp-core/app', () => ({
  ActivityAppsMain: (props: any) => {
    const env = useContext(EnvContextMock);
    const filePreview = useContext(FilePreviewContextMock);
    return (
      <div
        data-testid="activity-body-content"
        style={{ position: 'relative', height: '1200px', padding: '12px' }}
      >
        {props.activeId?.() === 'ai'
          ? (
              <div style={{ position: 'absolute', inset: '0', height: 'calc(100vh - 48px)' }}>
                {floeRegistryComponents().find((component: any) => component.id === 'ai')?.component?.()}
              </div>
            )
          : null}
        <button
          type="button"
          data-testid="activity-open-flower-launcher"
          onClick={() => env.openFlowerTurnLauncher(testFlowerTurnIntent('activity'))}
        >
          Ask Flower
        </button>
        <button
          type="button"
          data-testid="activity-switch-workbench"
          onClick={() => env.setViewMode('workbench', { surfaceId: 'terminal', focusSurface: false, requestWorkbenchOverview: false })}
        >
          Switch Workbench
        </button>
        <button
          type="button"
          data-testid="open-preview"
          onClick={() => void filePreview.openPreview({
            id: '/workspace/demo.txt',
            type: 'file',
            name: 'demo.txt',
            path: '/workspace/demo.txt',
            size: 12,
          })}
        >
          Open Preview
        </button>
        <button
          type="button"
          data-testid="open-debug-console"
          onClick={() => env.openDebugConsole()}
        >
          Open Debug Console
        </button>
        <button type="button" data-testid="outside-flower">Outside Flower</button>
        <div role="menu" data-testid="outside-menu">
          <button type="button">Unrelated menu action</button>
        </div>
        <div role="dialog" data-testid="outside-dialog">
          <button type="button">Unrelated dialog action</button>
        </div>
        <button
          type="button"
          data-testid="outside-flower-stop-propagation"
          onPointerDown={(event) => event.stopPropagation()}
        >
          Outside Flower with stopped propagation
        </button>
      </div>
    );
  },
  FloeRegistryRuntime: (props: any) => {
    floeRegistryComponents = () => props.components;
    return <>{props.children}</>;
  },
}));

vi.mock('@floegence/floe-webapp-core/layout', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core/layout')>(),
  DisplayModePageShell: (props: any) => <div data-testid="display-mode-page-shell">{props.children}</div>,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button
      type="button"
      class={props.class}
      data-testid={props['data-testid']}
      aria-label={props['aria-label']}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
  ConfirmDialog: (props: any) => (
    <Show when={props.open}>
      <section role="alertdialog" aria-label={props.title}>
        <h2>{props.title}</h2>
        {props.children}
        <button type="button" onClick={() => props.onOpenChange?.(false)}>Cancel</button>
        <button type="button" onClick={() => props.onConfirm?.()}>Confirm</button>
      </section>
    </Show>
  ),
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div role="dialog" aria-label={props.title}>
        {props.children}
        {props.footer}
      </div>
    </Show>
  ),
  Dropdown: (props: any) => <>{props.trigger}</>,
  SegmentedControl: () => <div />,
  Tooltip: (props: any) => <>{props.children}</>,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    AlertCircle: Icon,
    AlertTriangle: Icon,
    Activity: Icon,
    ArrowDown: Icon,
    ArrowRightLeft: Icon,
    ArrowUp: Icon,
    BugIcon: Icon,
    Check: Icon,
    CheckCircle: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    ChevronUp: Icon,
    Clock: Icon,
    Code: Icon,
    Copy: Icon,
    Cpu: Icon,
    Database: Icon,
    DockCpu: Icon,
    DockFolder: Icon,
    DockTerminal: Icon,
    Download: Icon,
    ExternalLink: Icon,
    Eye: Icon,
    EyeOff: Icon,
    FileCode: Icon,
    FileText: Icon,
    Files: Icon,
    Filter: Icon,
    Folder: Icon,
    FolderOpen: Icon,
    GitBranch: Icon,
    Globe: Icon,
    Grid3x3: Icon,
    Hash: Icon,
    Highlighter: Icon,
    History: Icon,
    Home: Icon,
    Image: Icon,
    Key: Icon,
    Layers: Icon,
    LayoutDashboard: Icon,
    Link: Icon,
    Loader2: Icon,
    Lock: Icon,
    Maximize: Icon,
    Menu: Icon,
    Minus: Icon,
    Moon: Icon,
    MoreHorizontal: Icon,
    Package: Icon,
    Pencil: Icon,
    Play: Icon,
    Plus: Icon,
    Refresh: Icon,
    RefreshIcon: Icon,
    Save: Icon,
    Search: Icon,
    Send: Icon,
    Settings: Icon,
    Shield: Icon,
    ShieldCheck: Icon,
    Sparkles: Icon,
    Stop: Icon,
    Sun: Icon,
    Terminal: Icon,
    Trash: Icon,
    User: Icon,
    WifiOffIcon: Icon,
    X: Icon,
    XCircle: Icon,
    Zap: Icon,
  };
});

vi.mock('@floegence/floe-webapp-boot', () => ({
  createArtifactDirectReconnectConfig: (config: unknown) => config,
  createProxyRuntimeTunnelReconnectConfig: (config: unknown) => config,
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    status: () => protocolStatus,
    client: () => protocolClient,
    connect: connectMock,
    reconnect: vi.fn(async () => undefined),
    disconnect: vi.fn(() => {
      protocolStatus = 'disconnected';
      protocolClient = null;
    }),
    error: () => null,
  }),
}));

vi.mock('./protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    access: {
      status: vi.fn(async () => ({ passwordRequired: false, unlocked: true })),
      resume: vi.fn(async () => undefined),
    },
    sys: {
      ping: vi.fn(async () => undefined),
      restart: vi.fn(async () => ({ ok: true })),
    },
    ai: {
      subscribeThread: vi.fn(async () => undefined),
      sendUserTurn: vi.fn(async () => undefined),
    },
  }),
}));

vi.mock('./pages/EnvContext', () => ({
  EnvContext: EnvContextMock,
  useEnvContext: () => useContext(EnvContextMock),
}));

vi.mock('./widgets/FilePreviewContext', () => ({
  FilePreviewContext: FilePreviewContextMock,
  useFilePreviewContext: () => useContext(FilePreviewContextMock),
}));

vi.mock('./widgets/FileBrowserSurfaceContext', () => ({
  FileBrowserSurfaceContext: FileBrowserSurfaceContextMock,
  useFileBrowserSurfaceContext: () => useContext(FileBrowserSurfaceContextMock),
}));

vi.mock('./services/controlplaneApi', () => ({
  connectArtifactEntry: connectArtifactEntryMock,
  getEnvPublicIDFromSession: vi.fn(() => ''),
  getLocalAccessStatus: getLocalAccessStatusMock,
  getLocalRuntime: getLocalRuntimeMock,
  getEnvironment: getEnvironmentMock,
  mintEnvProxyEntryTicket: vi.fn(),
  mintLocalDirectConnectArtifact: mintLocalDirectConnectArtifactMock,
  mintEnvEntryTicketForApp: vi.fn(),
  refreshLocalRuntime: vi.fn(async () => null),
  unlockLocalAccess: unlockLocalAccessMock,
}));

vi.mock('./accessResume', () => ({
  consumeAccessResumeTokenFromWindow: () => '',
}));

vi.mock('./debugConsole/createDebugConsoleController', () => ({
  createDebugConsoleController: () => ({
    enabled: () => debugConsoleEnabled,
    show: debugConsoleShowMock,
    closeConsole: debugConsoleCloseMock,
  }),
}));

vi.mock('./widgets/createFilePreviewController', () => ({
  createFilePreviewController: () => ({
    openPreview: filePreviewOpenPreviewMock,
    closePreview: filePreviewClosePreviewMock,
    saveCurrent: filePreviewSaveCurrentMock,
  }),
}));

vi.mock('./widgets/createFileBrowserSurfaceController', () => ({
  createFileBrowserSurfaceController: () => ({
    openSurface: vi.fn(() => ({ requestId: 'req-1' })),
    closeSurface: vi.fn(),
    surface: () => null,
  }),
}));

vi.mock('./TopBarBrandButton', () => ({
  TopBarBrandButton: (props: any) => <button type="button" aria-label={props.label}>{props.children}</button>,
}));

vi.mock('./workbench/EnvWorkbenchPage', () => ({
  EnvWorkbenchPage: () => {
    const env = useContext(EnvContextMock);
    const filePreview = useContext(FilePreviewContextMock);
    const fileBrowser = useContext(FileBrowserSurfaceContextMock);
    return (
      <div>
        <button
          type="button"
          data-testid="workbench-open-preview"
          onClick={() => void filePreview.openPreview({
            id: '/workspace/demo.txt',
            type: 'file',
            name: 'demo.txt',
            path: '/workspace/demo.txt',
            size: 12,
          })}
        >
          Open Workbench Preview
        </button>
        <button
          type="button"
          data-testid="workbench-open-browser"
          onClick={() => void fileBrowser.openBrowser({
            path: '/workspace/app',
            homePath: '/workspace',
            title: 'App',
          })}
        >
          Open Workbench Browser
        </button>
        <button
          type="button"
          data-testid="workbench-open-terminal"
          onClick={() => env.openTerminalInDirectory?.('/workspace/app', {
            preferredName: 'App',
            workbenchAnchor: { clientX: 240, clientY: 320 },
          })}
        >
          Open Workbench Terminal
        </button>
        <button
          type="button"
          data-testid="workbench-open-flower-launcher"
          onClick={() => env.openFlowerTurnLauncher(testFlowerTurnIntent('workbench'))}
        >
          Ask Flower
        </button>
        <div data-testid="workbench-preview-activation">
          {env.workbenchFilePreviewActivation?.()?.item?.path ?? ''}
        </div>
        <div data-testid="workbench-flower-activation">
          {[
            env.workbenchSurfaceActivation?.()?.surfaceId ?? '',
            env.workbenchSurfaceActivation?.()?.openStrategy ?? '',
            String(env.workbenchSurfaceActivation?.()?.focus ?? ''),
            String(env.workbenchSurfaceActivation?.()?.ensureVisible ?? ''),
            String(env.workbenchSurfaceActivation?.()?.centerViewport ?? ''),
            env.aiThreadFocusRequest?.()?.thread_id ?? '',
          ].join('|')}
        </div>
        <div data-testid="workbench-browser-activation">
          {[
            env.workbenchSurfaceActivation?.()?.fileBrowserPayload?.path ?? '',
            env.workbenchSurfaceActivation?.()?.fileBrowserPayload?.title ?? '',
            env.workbenchSurfaceActivation?.()?.openStrategy ?? '',
          ].join('|')}
        </div>
        <div data-testid="workbench-terminal-activation">
          {[
            env.workbenchSurfaceActivation?.()?.terminalPayload?.workingDir ?? '',
            env.workbenchSurfaceActivation?.()?.terminalPayload?.preferredName ?? '',
            env.workbenchSurfaceActivation?.()?.openStrategy ?? '',
            String(env.workbenchSurfaceActivation?.()?.centerViewport ?? ''),
            env.workbenchSurfaceActivation?.()?.workbenchAnchor?.clientX ?? '',
            env.workbenchSurfaceActivation?.()?.workbenchAnchor?.clientY ?? '',
          ].join('|')}
        </div>
      </div>
    );
  },
}));
vi.mock('./pages/EnvTerminalPage', () => ({ EnvTerminalPage: () => <div /> }));
vi.mock('./pages/EnvMonitorPage', () => ({ EnvMonitorPage: () => <div /> }));
vi.mock('./pages/EnvFileBrowserPage', () => ({ EnvFileBrowserPage: () => <div /> }));
vi.mock('./pages/EnvCodespacesPage', () => ({ EnvCodespacesPage: () => <div /> }));
vi.mock('./pages/EnvPortForwardsPage', () => ({ EnvPortForwardsPage: () => <div /> }));
vi.mock('./pages/EnvAIPage', () => ({
  EnvAIPage: (props: any) => {
    const mountID = `activity-flower-${++envAIPageMountSequence}`;
    const env = useContext(EnvContextMock);
    const [submitting, setSubmitting] = createSignal(false);
    const [composerText, setComposerText] = createSignal('');
    const [presence, setPresence] = createSignal(activityFlowerPresence);
    publishActivityFlowerPresence = setPresence;
    createEffect(() => {
      props.onPresenceChange?.(presence());
    });
    return (
      <div
        data-testid="env-ai-page"
        data-mount-id={mountID}
        data-presentation={props.presentation}
        data-companion-open={String(Boolean(props.companionOpen))}
        data-engaged={String(Boolean(props.engaged))}
        data-transcript-visible={String(Boolean(props.transcriptVisible))}
        data-focus-request-scope={props.focusRequestScope}
        data-flower-turn-submitting={String(submitting())}
      >
        <div data-testid="env-ai-focused-thread">{env.aiThreadFocusRequest?.()?.thread_id ?? ''}</div>
        <div data-testid="activity-flower-focused-thread">{props.focusThreadRequest?.thread_id ?? ''}</div>
        <div data-testid="activity-flower-focus-request">{props.focusThreadRequest?.request_id ?? ''}</div>
        <div data-testid="activity-flower-header-actions">{props.headerTrailingActions}</div>
        <Show when={!props.companionOpen}>
          <Show
            when={Boolean(String(props.companionSummary?.visualText ?? '').trim())}
            fallback={(
              <span
                data-testid="activity-flower-idle-status"
                class={`flower-companion-collapsed-status-${props.companionSummary?.priorityStatus ?? 'idle'}`}
                aria-hidden="true"
              />
            )}
          >
            <button
              type="button"
              classList={{
                'flower-companion-collapsed-summary': true,
                'flower-companion-collapsed-summary-completion': props.companionSummary?.ephemeralKind === 'completion',
              }}
              data-flower-companion-ephemeral-kind={props.companionSummary?.ephemeralKind}
              data-testid="activity-flower-presence-summary"
              title={props.companionSummary?.accessibleText}
              aria-label={props.companionSummary?.accessibleText}
              aria-controls={props.companionRegionID}
              aria-expanded="false"
              onClick={() => props.onCompanionOpenRequest?.()}
            >
              <span classList={{
                'flower-companion-collapsed-icon-running': Boolean(props.companionSummary?.running),
                'flower-companion-collapsed-icon-completion': props.companionSummary?.ephemeralKind === 'completion',
              }} />
              <span
                class="flower-companion-collapsed-summary-text"
                data-flower-companion-progress-kind={props.companionSummary?.progressKind}
              >
                <Show
                  when={props.companionSummary?.progressKind === 'output'}
                  fallback={props.companionSummary?.visualText}
                >
                  <span class="flower-companion-collapsed-tail-prefix" aria-hidden="true">&hellip;</span>
                  <span class="flower-companion-collapsed-tail-viewport" aria-hidden="true">
                    <span class="flower-companion-collapsed-tail-value">{props.companionSummary?.visualText}</span>
                  </span>
                </Show>
              </span>
            </button>
          </Show>
          <span
            data-testid="activity-flower-presence-announcement"
            role={(
              props.companionSummary?.ephemeralKind === 'completion'
              || props.companionSummary?.priorityStatus === 'running'
              || props.companionSummary?.priorityStatus === 'queued'
            ) && props.companionSummary?.progressKind !== 'tool' && props.companionSummary?.progressKind !== 'output'
              ? 'status'
              : undefined}
            aria-live={(
              props.companionSummary?.ephemeralKind === 'completion'
              || props.companionSummary?.priorityStatus === 'running'
              || props.companionSummary?.priorityStatus === 'queued'
            ) && props.companionSummary?.progressKind !== 'tool' && props.companionSummary?.progressKind !== 'output'
              ? 'polite'
              : undefined}
            aria-atomic={(
              props.companionSummary?.ephemeralKind === 'completion'
              || props.companionSummary?.priorityStatus === 'running'
              || props.companionSummary?.priorityStatus === 'queued'
            ) && props.companionSummary?.progressKind !== 'tool' && props.companionSummary?.progressKind !== 'output'
              ? 'true'
              : undefined}
          >
            {props.companionSummary?.accessibleText}
          </span>
        </Show>
        <textarea
          data-testid="activity-flower-composer"
          aria-label="Ask Flower"
          aria-controls={props.companionRegionID}
          value={composerText()}
          onFocus={() => props.onCompanionOpenRequest?.()}
          onInput={(event) => {
            setComposerText(event.currentTarget.value);
            if (!event.isComposing) props.onCompanionOpenRequest?.();
          }}
        />
        <button
          type="button"
          data-testid="activity-flower-submit"
          onPointerDown={() => {
            activityFlowerSubmitting = true;
            setSubmitting(true);
          }}
          onClick={() => queueMicrotask(() => {
            activityFlowerSubmitting = false;
            setSubmitting(false);
          })}
        >
          Submit work
        </button>
        <button type="button" data-testid="activity-flower-related-trigger">Related</button>
        <Portal mount={document.body}>
          <button
            type="button"
            class="flower-turn-launcher-related-surface"
            data-testid="activity-flower-related-surface"
            style={{ position: 'fixed', top: '80px', left: '8px', 'z-index': 90 }}
          >
            Related surface
          </button>
          <button
            type="button"
            class="flower-chat-context-preview-window"
            data-testid="activity-flower-context-preview"
          >
            Flower context preview
          </button>
          <button
            type="button"
            class="flower-provider-dialog"
            data-testid="activity-flower-provider-dialog"
          >
            Flower provider dialog
          </button>
        </Portal>
      </div>
    );
  },
}));
vi.mock('./codex/CodexPage', () => ({ CodexPage: () => <div /> }));
vi.mock('./codex/CodexProvider', () => ({ CodexProvider: (props: any) => <>{props.children}</> }));
vi.mock('./codex/CodexSidebar', () => ({ CodexSidebar: () => <div /> }));
vi.mock('./pages/EnvSettingsPage', () => ({ EnvSettingsPage: () => <div /> }));
vi.mock('./pages/aiPermissions', () => ({ hasRWXPermissions: () => true }));
vi.mock('./widgets/AuditLogDialog', () => ({ AuditLogDialog: () => <div /> }));
vi.mock('./widgets/FilePreviewHost', () => ({ FilePreviewHost: () => <div data-testid="file-preview-host" /> }));
vi.mock('./widgets/FileBrowserSurfaceHost', () => ({ FileBrowserSurfaceHost: () => <div data-testid="file-browser-host" /> }));
vi.mock('./debugConsole/DebugConsoleWindow', () => ({
  DebugConsoleWindow: () => <div data-testid="debug-console-window" />,
}));
vi.mock('./widgets/FlowerTurnLauncherWindow', () => ({
  FlowerTurnLauncherWindow: (props: any) => (
    <Show when={props.open && props.intent}>
      <div data-testid="flower-turn-launcher" data-placement={props.placement ?? 'window'}>
        <button
          type="button"
          data-testid="flower-turn-launcher-send"
          onClick={() => void props.onSubmit({ prompt: 'inspect from launcher', intent: props.intent })}
        >
          Send
        </button>
      </div>
    </Show>
  ),
}));
vi.mock('./flower/envLocalFlowerSurfaceAdapter', () => ({
  createEnvLocalFlowerSurfaceAdapter: () => ({ launchTurn: flowerLaunchTurnMock }),
}));
vi.mock('./notes/NotesOverlay', () => ({ NotesOverlay: () => <div /> }));
vi.mock('./maintenance/RuntimeUpdateContext', () => ({ RuntimeUpdateContext: createContext({}) }));
vi.mock('./maintenance/createAgentMaintenanceController', () => ({
  createAgentMaintenanceController: () => ({
    maintaining: () => false,
    stage: () => '',
    error: () => null,
    startRestart: vi.fn(async () => undefined),
  }),
}));
vi.mock('./maintenance/createRuntimeUpdatePromptCoordinator', () => ({
  createRuntimeUpdatePromptCoordinator: () => ({
    consumeNotice: () => null,
  }),
}));
vi.mock('./maintenance/createAgentVersionModel', () => ({
  createAgentVersionModel: () => ({
    currentProcessStartedAtMs: () => 0,
    runtimeService: () => undefined,
    currentVersion: () => 'v1.0.0',
    refetchCurrentVersion: vi.fn(async () => undefined),
  }),
}));
vi.mock('./utils/askFlowerPath', () => ({
  basenameFromAbsolutePath: (value: string) => {
    const normalized = String(value ?? '').trim().replace(/\/+$/, '');
    if (!normalized || normalized === '/') return 'File';
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'File';
  },
  normalizeAbsolutePath: (value: string) => {
    const raw = String(value ?? '').trim().replace(/\\+/g, '/');
    if (!raw.startsWith('/')) return '';
    if (raw === '/') return '/';
    return raw.replace(/\/+$/, '') || '/';
  },
  resolveSuggestedWorkingDirAbsolute: () => '',
}));
vi.mock('./utils/windowNavigation', () => ({ reloadCurrentPage: vi.fn() }));
vi.mock('./services/desktopShellCommandPalette', () => ({ buildDesktopShellCommandPaletteEntries: () => [] }));
vi.mock('./services/desktopShellBridge', () => ({
  desktopShellBridgeAvailable: () => false,
  getRuntimeMaintenanceContextFromDesktopShell: vi.fn(async () => null),
  notifyRuntimeMaintenanceStartedInDesktopShell: vi.fn(),
  openConnectionCenter: vi.fn(async () => false),
  openDashboardInDesktopShell: vi.fn(async () => false),
  performRuntimeMaintenanceActionInDesktopShell: vi.fn(async () => null),
  runtimeMaintenanceMethodUsesDesktop: () => false,
}));
vi.mock('./services/localApi', () => ({
  fetchLocalApiJSON: vi.fn(),
  getEnvAppAccessStatus: getEnvAppAccessStatusMock,
  prepareLocalApiRequestInit: vi.fn(async (init: RequestInit) => init),
  uploadLocalApiFile: vi.fn(),
  unlockEnvAppAccess: vi.fn(async () => ({ unlocked: true, resume_token: 'resume123' })),
}));
vi.mock('./services/accessUnlockError', () => ({
  AccessUnlockError: class AccessUnlockError extends Error {
    status = 0;
    code = '';
    retryAfterMs = 0;
  },
  formatAccessUnlockRetryAfter: () => '1m',
  getAccessUnlockRetryAfterMs: () => 0,
  isKnownAccessUnlockErrorCode: () => false,
}));
vi.mock('./services/localAccessAuth', () => ({
  clearLocalAccessResumeToken: vi.fn(),
  writeLocalAccessResumeToken: vi.fn(),
}));
vi.mock('./services/sandboxWindowRegistry', () => ({ getSandboxWindowInfo: () => null }));
vi.mock('./services/floeproxyContract', () => ({
  CODE_SPACE_ID_ENV_UI: 'env-ui',
  FLOE_APP_AGENT: 'agent',
  FLOE_APP_CODE: 'code',
  FLOE_APP_PORT_FORWARD: 'port-forward',
}));
vi.mock('./services/desktopTheme', () => ({
  desktopThemeBridge: () => ({ source: () => 'dark' }),
  toggleDesktopTheme: vi.fn(),
}));
vi.mock('./services/sandboxOrigins', () => ({ controlPlaneOriginFromSandboxLocation: () => 'https://console.example.com' }));
vi.mock('./services/uiStorage', () => ({
  readRendererScopedUIStorageJSON: vi.fn((_key: string, fallback: unknown) => fallback),
  readUIStorageJSON: vi.fn(() => null),
  readUIStorageItem: vi.fn((key: string) => (
    uiStorageItems.get(key)
    ?? (key === 'redeven_envapp_desktop_view_mode' ? desktopViewMode : null)
  )),
  writeRendererScopedUIStorageJSON: vi.fn(),
  writeRendererScopedUIStorageItem: vi.fn(),
  writeUIStorageItem: vi.fn((key: string, value: string) => {
    uiStorageItems.set(key, value);
  }),
}));
vi.mock('./envSidebarVisibilityMotion', () => ({
  resolveEnvSidebarVisibilityMotion: () => 'animated',
  shouldEnvTabOpenSidebar: () => false,
}));
async function settleFrames(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settleFrames(2);
}

type MountedShell = Readonly<{
  host: HTMLElement;
  dispose: () => void;
  panel: HTMLElement;
  input: HTMLTextAreaElement;
  companion: HTMLElement;
  product: HTMLElement;
  textarea: HTMLTextAreaElement;
  body: HTMLElement;
  bottomBar: HTMLElement;
}>;

type MountedMobileShell = Readonly<{
  host: HTMLElement;
  dispose: () => void;
  panel: HTMLElement;
  input: HTMLTextAreaElement;
  companion: HTMLElement;
  product: HTMLElement;
  textarea: HTMLTextAreaElement;
  body: HTMLElement;
  mobileTabBar: HTMLElement;
  mobileRail: HTMLElement;
}>;

const disposers: Array<() => void> = [];

async function mountShell(): Promise<MountedShell> {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const { EnvAppShell } = await import('./EnvAppShell');
  const dispose = render(() => (
    <FloeConfigProvider config={{ layout: { mobileQuery: '(max-width: 0px)' } }}>
      <LayoutProvider>
        <CommandProvider>
          <EnvAppShell />
        </CommandProvider>
      </LayoutProvider>
    </FloeConfigProvider>
  ), host);
  disposers.push(dispose);
  await flushAsync();
  await flushAsync();

  const companion = document.querySelector('#redeven-activity-flower-companion');
  const product = document.querySelector('#redeven-activity-flower-product');
  const textarea = document.querySelector('[data-testid="activity-flower-composer"]');
  const body = document.querySelector('[data-floe-shell-slot="main"]');
  const bottomBar = document.querySelector('[data-floe-shell-slot="bottom-bar"]');
  if (!(companion instanceof HTMLElement)) throw new Error('Activity Flower companion did not mount.');
  if (!(product instanceof HTMLElement)) throw new Error('Activity Flower product root did not mount.');
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Activity Flower composer did not mount.');
  if (!(body instanceof HTMLElement)) throw new Error('Activity body did not mount.');
  if (!(bottomBar instanceof HTMLElement)) throw new Error('Activity bottom bar did not mount.');

  return {
    host,
    dispose,
    panel: companion,
    input: textarea,
    companion,
    product,
    textarea,
    body,
    bottomBar,
  };
}

async function mountProductionMobileShell(): Promise<MountedMobileShell> {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const { EnvAppShell } = await import('./EnvAppShell');
  const dispose = render(() => (
    <FloeConfigProvider>
      <LayoutProvider>
        <CommandProvider>
          <EnvAppShell />
        </CommandProvider>
      </LayoutProvider>
    </FloeConfigProvider>
  ), host);
  disposers.push(dispose);
  await flushAsync();
  await flushAsync();

  const companion = document.querySelector('#redeven-activity-flower-companion');
  const product = document.querySelector('#redeven-activity-flower-product');
  const textarea = document.querySelector('[data-testid="activity-flower-composer"]');
  const body = document.querySelector('[data-floe-shell-slot="main"]');
  const mobileTabBar = document.querySelector('[data-floe-shell-slot="mobile-tab-bar"]');
  const mobileRail = document.querySelector('[data-activity-flower-mobile-companion]');
  if (!(companion instanceof HTMLElement)) throw new Error('Activity Flower companion did not mount.');
  if (!(product instanceof HTMLElement)) throw new Error('Activity Flower product root did not mount.');
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Activity Flower composer did not mount.');
  if (!(body instanceof HTMLElement)) throw new Error('Activity body did not mount.');
  if (!(mobileTabBar instanceof HTMLElement)) throw new Error('Production MobileTabBar did not mount.');
  if (!(mobileRail instanceof HTMLElement)) throw new Error('Activity Flower mobile anchor rail did not mount.');

  return {
    host,
    dispose,
    panel: companion,
    input: textarea,
    companion,
    product,
    textarea,
    body,
    mobileTabBar,
    mobileRail,
  };
}

function setInputValue(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('HTMLTextAreaElement value setter is unavailable.');
  setter.call(input, value);
}

function elementRect(element: Element): DOMRect {
  return element.getBoundingClientRect();
}

afterEach(async () => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  await page.viewport(1280, 800);
});

beforeEach(() => {
  vi.clearAllMocks();
  debugConsoleEnabled = false;
  protocolStatus = 'disconnected';
  protocolClient = null;
  desktopViewMode = 'activity';
  envAIPageMountSequence = 0;
  floeRegistryComponents = () => [];
  activityFlowerSubmitting = false;
  publishActivityFlowerPresence = () => undefined;
  activityFlowerPresence = runningActivityFlowerPresence();
  uiStorageItems.clear();
  flowerLaunchTurnMock.mockReset();
  flowerLaunchTurnMock.mockResolvedValue({
    thread_id: 'thread-launched',
    turn_id: 'turn-launched',
    run_id: 'run-launched',
    kind: 'start',
  });
  window.open = windowOpenMock as typeof window.open;
  getLocalRuntimeMock.mockResolvedValue({
    mode: 'local',
    env_public_id: 'env_local',
    desktop_managed: true,
    direct_ws_url: 'ws://localhost/_redeven_direct/ws',
  });
  getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
  unlockLocalAccessMock.mockResolvedValue({ unlocked: true, resume_token: 'resume123' });
  getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
  getEnvironmentMock.mockResolvedValue({
    public_id: 'env_local',
    name: 'Local runtime',
    namespace_public_id: 'ns_local',
    status: 'online',
    lifecycle_status: 'running',
    permissions: {
      can_read: true,
      can_write: true,
      can_execute: true,
      can_admin: true,
      is_owner: true,
    },
  });
  mintLocalDirectConnectArtifactMock.mockResolvedValue({
    transport: 'direct',
    direct_info: {
      ws_url: 'ws://localhost/_redeven_direct/ws',
      channel_id: 'ch_local',
      e2ee_psk_b64u: 'secret',
      channel_init_expire_at_unix_s: 1,
      default_suite: 1,
    },
  });
  connectArtifactEntryMock.mockResolvedValue(null);
});

describe('EnvAppShell Activity Flower browser integration', () => {
  it.each([
    { width: 390, height: 844 },
    { width: 639, height: 800 },
    { width: 767, height: 800 },
  ])('keeps Ask Flower handoff visible above the production MobileTabBar at $width x $height', async ({ width, height }) => {
    await page.viewport(width, height);
    const fixture = await mountProductionMobileShell();
    const bodyBefore = {
      clientHeight: fixture.body.clientHeight,
      scrollHeight: fixture.body.scrollHeight,
    };
    const railRect = elementRect(fixture.mobileRail);
    const tabBarRect = elementRect(fixture.mobileTabBar);
    expect(getComputedStyle(fixture.mobileRail).position).toBe('fixed');
    expect(railRect.width).toBeGreaterThanOrEqual(1);
    expect(railRect.width).toBeLessThan(width);
    expect(railRect.height).toBe(44);
    expect(railRect.left).toBeGreaterThanOrEqual(12);
    expect(railRect.right).toBeLessThanOrEqual(width - 12);
    expect(railRect.bottom).toBeLessThanOrEqual(tabBarRect.top - 7);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

    const activeSurface = document.querySelector('[data-floe-shell-slot="mobile-tab-bar"] [role="tab"][aria-selected="true"]');
    const activeSurfaceLabel = activeSurface?.getAttribute('aria-label');
    const askFlower = document.querySelector('[data-testid="activity-open-flower-launcher"]');
    if (!(askFlower instanceof HTMLButtonElement)) throw new Error('Activity Ask Flower trigger did not render.');
    await userEvent.click(askFlower);
    await flushAsync();
    const launcher = document.querySelector('[data-testid="flower-turn-launcher"]');
    const send = document.querySelector('[data-testid="flower-turn-launcher-send"]');
    if (!(launcher instanceof HTMLElement) || !(send instanceof HTMLButtonElement)) {
      throw new Error('Activity Ask Flower launcher did not render.');
    }
    expect(launcher.dataset.placement).toBe('window');

    await userEvent.click(send);
    await flushAsync();
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 180));

    const panelRect = elementRect(fixture.panel);
    expect(document.querySelector('[data-testid="flower-turn-launcher"]')).toBeNull();
    expect(fixture.product.dataset.presentation).toBe('expanded');
    expect(fixture.product.getAttribute('aria-hidden')).toBeNull();
    expect(panelRect.width).toBeGreaterThan(0);
    expect(panelRect.width).toBeLessThan(width);
    expect(panelRect.bottom).toBeCloseTo(elementRect(fixture.mobileRail).bottom, 0);
    expect(fixture.companion.dataset.companionPhase).toBe('expanding');
    expect(fixture.companion.dataset.companionVisibility).toBe('visible');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fixture.companion.dataset.companionPhase).toBe('expanded');
    expect(document.querySelector('[data-testid="activity-flower-focused-thread"]')?.textContent).toBe('thread-launched');
    expect(document.querySelector('[data-floe-shell-slot="mobile-tab-bar"] [role="tab"][aria-selected="true"]')?.getAttribute('aria-label'))
      .toBe(activeSurfaceLabel);
    expect(fixture.body.clientHeight).toBe(bodyBefore.clientHeight);
    expect(fixture.body.scrollHeight).toBe(bodyBefore.scrollHeight);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

    const outside = document.querySelector('[data-testid="outside-flower"]');
    if (!(outside instanceof HTMLButtonElement)) throw new Error('Outside Flower target did not render.');
    await userEvent.click(outside);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('collapsed');
    expect(fixture.product.getAttribute('aria-hidden')).toBeNull();
    expect(fixture.companion.dataset.companionPhase).toBe('collapsing');
    await new Promise((resolve) => setTimeout(resolve, 190));
    expect(fixture.companion.dataset.companionPhase).toBe('collapsed');
    expect(elementRect(fixture.mobileRail).width).toBeGreaterThan(0);
    expect(document.querySelector('.flower-companion-collapsed-icon-running')).not.toBeNull();
    expect(document.querySelector('.flower-companion-collapsed-summary')).not.toBeNull();
  });

  it('keeps the production mobile rail and companion inside the visual viewport above the soft keyboard', async () => {
    await page.viewport(390, 844);
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const visualViewport = new EventTarget() as EventTarget & {
      width: number;
      height: number;
      offsetLeft: number;
      offsetTop: number;
      scale: number;
    };
    Object.assign(visualViewport, {
      width: 390,
      height: 520,
      offsetLeft: 0,
      offsetTop: 40,
      scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    });

    try {
      const fixture = await mountProductionMobileShell();
      const overlayHost = document.querySelector('[data-activity-flower-overlay-host]');
      if (!(overlayHost instanceof HTMLElement)) throw new Error('Flower overlay host did not render.');
      overlayHost.style.setProperty('--floe-bottom-bar-companion-safe-area-top', '11px');
      overlayHost.style.setProperty('--floe-bottom-bar-companion-safe-area-right', '9px');
      overlayHost.style.setProperty('--floe-bottom-bar-companion-safe-area-bottom', '13px');
      overlayHost.style.setProperty('--floe-bottom-bar-companion-safe-area-left', '7px');

      visualViewport.dispatchEvent(new Event('resize'));
      await flushAsync();
      await userEvent.click(fixture.input);
      await flushAsync();
      await new Promise((resolve) => setTimeout(resolve, 180));

      const railRect = elementRect(fixture.mobileRail);
      const panelRect = elementRect(fixture.panel);
      const safeViewportTop = visualViewport.offsetTop + 11;
      const safeViewportBottom = visualViewport.offsetTop + visualViewport.height - 13;
      expect(railRect.left).toBeGreaterThanOrEqual(12);
      expect(railRect.right).toBeLessThanOrEqual(visualViewport.width - 12);
      expect(railRect.bottom).toBeLessThanOrEqual(safeViewportBottom + 6);
      expect(panelRect.left).toBeGreaterThanOrEqual(12);
      expect(panelRect.top).toBeGreaterThanOrEqual(safeViewportTop + 2);
      expect(panelRect.right).toBeLessThanOrEqual(visualViewport.width - 12);
      expect(Math.abs(panelRect.bottom - railRect.bottom)).toBeLessThanOrEqual(6);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, 'visualViewport', originalDescriptor);
      } else {
        Reflect.deleteProperty(window, 'visualViewport');
      }
    }
  });

  it('reanchors the same Flower surface when crossing the production 767/768 mobile boundary', async () => {
    await page.viewport(767, 800);
    const fixture = await mountProductionMobileShell();
    const flowerSurface = document.querySelector('[data-testid="env-ai-page"]');
    if (!(flowerSurface instanceof HTMLElement)) throw new Error('Activity EnvAIPage did not mount.');
    const mountID = flowerSurface.dataset.mountId;

    await userEvent.click(fixture.input);
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(fixture.product.dataset.presentation).toBe('expanded');
    expect(elementRect(fixture.panel).bottom).toBeCloseTo(elementRect(fixture.mobileRail).bottom, 0);

    await page.viewport(769, 800);
    await flushAsync();
    await flushAsync();
    const desktopBottomBar = document.querySelector('[data-floe-shell-slot="bottom-bar"]');
    const desktopInput = document.querySelector('[data-testid="activity-flower-composer"]');
    if (!(desktopBottomBar instanceof HTMLElement) || !(desktopInput instanceof HTMLTextAreaElement)) {
      throw new Error('Desktop Flower bottom bar did not mount after crossing the breakpoint.');
    }
    expect(document.querySelector('[data-floe-shell-slot="mobile-tab-bar"]')).toBeNull();
    expect(document.querySelector('[data-activity-flower-mobile-companion]')).toBeNull();
    expect(document.querySelector('[data-testid="env-ai-page"]')).toBe(flowerSurface);
    expect(flowerSurface.dataset.mountId).toBe(mountID);
    expect(fixture.product.dataset.presentation).toBe('expanded');
    expect(document.querySelector('[data-testid="activity-flower-composer"]')).toBe(fixture.textarea);
    expect(elementRect(fixture.panel).right).toBeLessThanOrEqual(769 - 12);

    await page.viewport(767, 800);
    await flushAsync();
    await flushAsync();
    const restoredInput = document.querySelector('[data-activity-flower-mobile-companion] [data-testid="activity-flower-composer"]');
    const retainedInput = restoredInput ?? document.querySelector('[data-testid="activity-flower-composer"]');
    if (!(retainedInput instanceof HTMLTextAreaElement)) throw new Error('Flower composer was lost across the breakpoint.');
    expect(document.querySelector('[data-testid="env-ai-page"]')).toBe(flowerSurface);
    expect(flowerSurface.dataset.mountId).toBe(mountID);
    expect(document.querySelectorAll('[data-testid="activity-flower-composer"]')).toHaveLength(1);
    expect(retainedInput).toBe(fixture.textarea);
    expect(fixture.companion.isConnected).toBe(true);
  });

  it.each([
    { width: 639, height: 800 },
    { width: 640, height: 800 },
    { width: 767, height: 800 },
    { width: 768, height: 800 },
    { width: 390, height: 844 },
  ])('keeps the centered bottom grid and fixed overlay collision-free at $width x $height', async ({ width, height }) => {
    await page.viewport(width, height);
    const fixture = await mountShell();
    const grid = document.querySelector('.flower-activity-bottom-grid');
    const start = document.querySelector('.flower-activity-bottom-side-start');
    const quickEntry = document.querySelector('.flower-activity-companion-anchor');
    const end = document.querySelector('.flower-activity-bottom-side-end');
    if (!(grid instanceof HTMLElement) || !(start instanceof HTMLElement)
      || !(quickEntry instanceof HTMLElement) || !(end instanceof HTMLElement)) {
      throw new Error('Activity Flower bottom grid did not render.');
    }

    const bodyBefore = {
      clientHeight: fixture.body.clientHeight,
      scrollHeight: fixture.body.scrollHeight,
    };
    const bottomRect = elementRect(fixture.bottomBar);
    const quickRect = elementRect(quickEntry);
    const startRect = elementRect(start);
    const endRect = elementRect(end);

    expect(Math.abs(
      (quickRect.left + quickRect.width / 2) - (bottomRect.left + bottomRect.width / 2),
    )).toBeLessThan(1);
    expect(startRect.right).toBeLessThanOrEqual(quickRect.left + 0.5);
    expect(quickRect.right).toBeLessThanOrEqual(endRect.left + 0.5);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

    await userEvent.click(fixture.input);
    await flushAsync();

    const panelRect = elementRect(fixture.panel);
    expect(fixture.product.dataset.presentation).toBe('expanded');
    expect(getComputedStyle(fixture.panel).position).toBe('fixed');
    expect(panelRect.width).toBeGreaterThan(0);
    expect(panelRect.width).toBeLessThan(width);
    expect(panelRect.height).toBeGreaterThan(0);
    expect(panelRect.height).toBeLessThanOrEqual(544);
    expect(panelRect.left).toBeGreaterThanOrEqual(12);
    expect(panelRect.right).toBeLessThanOrEqual(width - 12);
    expect(panelRect.width).toBeCloseTo(quickRect.width, 0);
    expect(panelRect.width).toBeLessThanOrEqual(544);
    expect(fixture.body.clientHeight).toBe(bodyBefore.clientHeight);
    expect(fixture.body.scrollHeight).toBe(bodyBefore.scrollHeight);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  });

  it('keeps one EnvAIPage DOM node through collapsed, expanded, and Activity Bar full-page placement', async () => {
    await page.viewport(1280, 800);
    const fixture = await mountShell();
    const flowerSurface = document.querySelector('[data-testid="env-ai-page"]');
    if (!(flowerSurface instanceof HTMLElement)) throw new Error('Activity EnvAIPage did not mount.');
    const mountID = flowerSurface.dataset.mountId;

    expect(fixture.product.dataset.presentation).toBe('collapsed');
    expect(fixture.product.getAttribute('aria-hidden')).toBeNull();
    expect(fixture.companion.dataset.companionPhase).toBe('collapsed');
    expect(flowerSurface.dataset.presentation).toBe('companion');
    expect(flowerSurface.dataset.engaged).toBe('false');
    expect(document.querySelectorAll('[data-testid="env-ai-page"]')).toHaveLength(1);

    await userEvent.click(fixture.input);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('expanded');
    expect(document.querySelector('[data-testid="env-ai-page"]')).toBe(flowerSurface);
    expect(flowerSurface.dataset.mountId).toBe(mountID);
    expect(flowerSurface.dataset.engaged).toBe('true');

    const close = document.querySelector('[data-testid="activity-flower-header-actions"] button');
    if (!(close instanceof HTMLButtonElement)) throw new Error('Flower companion close control did not render.');
    await userEvent.click(close);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('collapsed');
    expect(document.querySelector('[data-testid="env-ai-page"]')).toBe(flowerSurface);

    const activityBarFlower = document.querySelector('[data-floe-shell-slot="activity-bar"] button[aria-label="Flower"]');
    if (!(activityBarFlower instanceof HTMLButtonElement)) throw new Error('Activity Bar Flower entry did not render.');
    await userEvent.click(activityBarFlower);
    await flushAsync();

    const fullPageHost = document.querySelector('[data-activity-flower-full-page-host]');
    if (!(fullPageHost instanceof HTMLElement)) throw new Error('Flower full-page host did not render.');
    const panelRect = elementRect(fixture.product);
    const hostRect = elementRect(fullPageHost);
    expect(activityBarFlower.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.product.dataset.presentation).toBe('full_page');
    expect(fixture.product.getAttribute('aria-hidden')).toBeNull();
    expect(document.querySelector('[data-testid="env-ai-page"]')).toBe(flowerSurface);
    expect(flowerSurface.dataset.mountId).toBe(mountID);
    expect(flowerSurface.dataset.presentation).toBe('full');
    expect(fullPageHost.contains(fixture.product)).toBe(true);
    expect(panelRect.left).toBeCloseTo(hostRect.left, 0);
    expect(panelRect.top).toBeCloseTo(hostRect.top, 0);
    expect(panelRect.width).toBeCloseTo(hostRect.width, 0);
    expect(panelRect.height).toBeCloseTo(hostRect.height, 0);
    expect(envAIPageMountSequence).toBe(1);

    const activityBarTerminal = document.querySelector('[data-floe-shell-slot="activity-bar"] button[aria-label="Terminal"]');
    if (!(activityBarTerminal instanceof HTMLButtonElement)) throw new Error('Activity Bar terminal entry did not render.');
    await userEvent.click(activityBarTerminal);
    await flushAsync();

    expect(fullPageHost.isConnected).toBe(false);
    expect(fullPageHost.contains(fixture.product)).toBe(false);
    expect(fixture.product.isConnected).toBe(true);
    expect(fixture.product.dataset.presentation).toBe('collapsed');
    expect(fixture.product.getAttribute('aria-hidden')).toBeNull();
    expect(document.querySelector('[data-testid="env-ai-page"]')).toBe(flowerSurface);

    await userEvent.click(activityBarFlower);
    await flushAsync();

    const replacementFullPageHost = document.querySelector('[data-activity-flower-full-page-host]');
    if (!(replacementFullPageHost instanceof HTMLElement)) throw new Error('Replacement Flower full-page host did not render.');
    expect(replacementFullPageHost).not.toBe(fullPageHost);
    expect(replacementFullPageHost.contains(fixture.product)).toBe(true);
    expect(fixture.product.getAttribute('aria-hidden')).toBeNull();
    expect(document.querySelector('[data-testid="env-ai-page"]')).toBe(flowerSurface);
    expect(envAIPageMountSequence).toBe(1);
  });

  it('moves focus out before hiding on outside pointer while preserving related layers and in-panel gestures', async () => {
    await page.viewport(1280, 800);
    const fixture = await mountShell();
    await userEvent.click(fixture.input);
    await flushAsync();

    const submit = document.querySelector('[data-testid="activity-flower-submit"]');
    const related = document.querySelector('[data-testid="activity-flower-related-surface"]');
    const contextPreview = document.querySelector('[data-testid="activity-flower-context-preview"]');
    const providerDialog = document.querySelector('[data-testid="activity-flower-provider-dialog"]');
    const outside = document.querySelector('[data-testid="outside-flower"]');
    const outsideMenuAction = document.querySelector('[data-testid="outside-menu"] button');
    const outsideDialogAction = document.querySelector('[data-testid="outside-dialog"] button');
    const stoppedOutside = document.querySelector('[data-testid="outside-flower-stop-propagation"]');
    if (!(submit instanceof HTMLButtonElement) || !(related instanceof HTMLButtonElement)
      || !(contextPreview instanceof HTMLButtonElement)
      || !(providerDialog instanceof HTMLButtonElement)
      || !(outside instanceof HTMLButtonElement) || !(outsideMenuAction instanceof HTMLButtonElement)
      || !(outsideDialogAction instanceof HTMLButtonElement) || !(stoppedOutside instanceof HTMLButtonElement)) {
      throw new Error('Flower pointer test controls did not render.');
    }

    await userEvent.click(related);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('expanded');

    await userEvent.click(contextPreview);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('expanded');

    await userEvent.click(providerDialog);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('expanded');

    submit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(activityFlowerSubmitting).toBe(true);
    expect(fixture.product.dataset.presentation).toBe('expanded');
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(fixture.product.dataset.presentation).toBe('collapsed');
    submit.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    submit.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('collapsed');

    await userEvent.click(fixture.input);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('expanded');

    await userEvent.click(outsideMenuAction);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('collapsed');

    await userEvent.click(fixture.input);
    await flushAsync();
    await userEvent.click(outsideDialogAction);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('collapsed');

    await userEvent.click(fixture.input);
    await flushAsync();
    await userEvent.click(stoppedOutside);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('collapsed');

    await userEvent.click(fixture.input);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('expanded');

    submit.focus();
    expect(fixture.product.contains(document.activeElement)).toBe(true);
    let ariaHiddenWhenFocusLeft: string | null | undefined;
    submit.addEventListener('blur', () => {
      ariaHiddenWhenFocusLeft = fixture.product.getAttribute('aria-hidden');
    }, { once: true });

    await userEvent.click(outside);
    await flushAsync();

    expect(ariaHiddenWhenFocusLeft).not.toBe('true');
    expect(fixture.product.dataset.presentation).toBe('collapsed');
    expect(fixture.product.getAttribute('aria-hidden')).toBeNull();
    expect(fixture.product.contains(document.activeElement)).toBe(false);
    expect(document.querySelector('[data-testid="env-ai-page"]')).not.toBeNull();
  });

  it('keeps IME composition in the same Flower textarea and opens after commit', async () => {
    await page.viewport(390, 844);
    const fixture = await mountShell();
    fixture.input.focus();

    fixture.input.dispatchEvent(new CompositionEvent('compositionstart', {
      bubbles: true,
      composed: true,
      data: '',
    }));
    setInputValue(fixture.input, '花');
    fixture.input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: '花',
      inputType: 'insertCompositionText',
      isComposing: true,
    }));
    expect(fixture.product.dataset.presentation).toBe('expanded');
    expect(document.querySelector('[data-testid="activity-flower-composer"]')).toBe(fixture.textarea);

    fixture.input.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      composed: true,
      data: '花',
    }));
    fixture.input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: '花',
      inputType: 'insertText',
      isComposing: false,
    }));
    await flushAsync();

    expect(document.querySelector('[data-testid="activity-flower-composer"]')).toBe(fixture.textarea);
    expect(fixture.input.value).toBe('花');
    expect(fixture.product.dataset.presentation).toBe('expanded');
  });

  it('uses visualViewport keyboard offsets and overlay safe-area variables for the fixed frame', async () => {
    await page.viewport(390, 844);
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const visualViewport = new EventTarget() as EventTarget & {
      width: number;
      height: number;
      offsetLeft: number;
      offsetTop: number;
      scale: number;
    };
    Object.assign(visualViewport, {
      width: 390,
      height: 520,
      offsetLeft: 0,
      offsetTop: 40,
      scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    });

    try {
      const fixture = await mountShell();
      const overlayHost = document.querySelector('[data-activity-flower-overlay-host]');
      if (!(overlayHost instanceof HTMLElement)) throw new Error('Flower overlay host did not render.');
      overlayHost.style.setProperty('--floe-bottom-bar-companion-safe-area-top', '11px');
      overlayHost.style.setProperty('--floe-bottom-bar-companion-safe-area-right', '9px');
      overlayHost.style.setProperty('--floe-bottom-bar-companion-safe-area-bottom', '13px');
      overlayHost.style.setProperty('--floe-bottom-bar-companion-safe-area-left', '7px');

      await userEvent.click(fixture.input);
      visualViewport.dispatchEvent(new Event('resize'));
      await flushAsync();

      const panelRect = elementRect(fixture.panel);
      const safeViewportLeft = visualViewport.offsetLeft + 7;
      const safeViewportTop = visualViewport.offsetTop + 11;
      const safeViewportRight = visualViewport.offsetLeft + visualViewport.width - 9;
      const safeViewportBottom = visualViewport.offsetTop + visualViewport.height - 13;
      expect(panelRect.left).toBeGreaterThanOrEqual(safeViewportLeft + 12);
      expect(panelRect.top).toBeGreaterThanOrEqual(safeViewportTop + 12);
      expect(panelRect.right).toBeLessThanOrEqual(safeViewportRight - 12);
      expect(panelRect.bottom).toBeLessThanOrEqual(safeViewportBottom + 2);
      expect(panelRect.width).toBeLessThanOrEqual(350);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, 'visualViewport', originalDescriptor);
      } else {
        Reflect.deleteProperty(window, 'visualViewport');
      }
    }
  });

  it('keeps a visible running status while reduced motion disables the playful rotation', async () => {
    await page.viewport(390, 844);
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    activityFlowerPresence = {
      ...runningActivityFlowerPresence(),
      unread_failed_count: 1,
    };
    await mountProductionMobileShell();

    const icon = document.querySelector('.flower-companion-collapsed-icon-running');
    const status = document.querySelector('.flower-companion-collapsed-summary');
    const summary = document.querySelector('[data-testid="activity-flower-presence-summary"]');
    const summaryText = summary?.querySelector('.flower-companion-collapsed-summary-text');
    const tailViewport = summary?.querySelector('.flower-companion-collapsed-tail-viewport');
    const tailValue = summary?.querySelector('.flower-companion-collapsed-tail-value');
    if (!(icon instanceof HTMLElement) || !(status instanceof HTMLElement) || !(summary instanceof HTMLElement) || !(summaryText instanceof HTMLElement) || !(tailViewport instanceof HTMLElement) || !(tailValue instanceof HTMLElement)) {
      throw new Error('Running Flower status did not render.');
    }
    expect(summary.textContent).toContain('The newest Flower response remains visible');
    expect(summary.textContent).not.toContain('Refine the Flower companion');
    expect(summary.textContent?.startsWith('…')).toBe(true);
    expect(getComputedStyle(summaryText).whiteSpace).toBe('nowrap');
    expect(getComputedStyle(summaryText).textOverflow).toBe('clip');
    expect(getComputedStyle(summaryText).overflow).toBe('hidden');
    expect(tailValue.scrollWidth).toBeGreaterThan(tailViewport.clientWidth);
    expect(getComputedStyle(tailValue).position).toBe('static');
    expect(getComputedStyle(tailValue).width).not.toBe('auto');
    expect(getComputedStyle(icon).animationName).toContain('flower-companion-running-turn');
    expect(elementRect(status).width).toBeGreaterThan(0);
    expect(getComputedStyle(status).opacity).not.toBe('0');
    const announcement = document.querySelector('[data-testid="activity-flower-presence-announcement"]');
    if (!(announcement instanceof HTMLElement)) throw new Error('Flower presence announcement did not render.');
    expect(announcement.textContent).toContain('The newest Flower response remains visible');
    expect(announcement.textContent).not.toContain('Refine the Flower companion');
    expect(announcement.hasAttribute('aria-live')).toBe(false);
    expect(announcement.hasAttribute('aria-atomic')).toBe(false);

    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
    await settleFrames(2);
    expect(getComputedStyle(icon).animationName).toBe('none');
    expect(elementRect(status).width).toBeGreaterThan(0);
  });

  it.each([
    { priorityStatus: 'attention', countKey: 'attention_count' },
    { priorityStatus: 'failed', countKey: 'unread_failed_count' },
    { priorityStatus: 'canceled', countKey: 'unread_canceled_count' },
    { priorityStatus: 'completed', countKey: 'unread_completed_count' },
  ])('keeps $priorityStatus-only history out of the collapsed Bottom Bar', async ({ priorityStatus, countKey }) => {
    await page.viewport(390, 844);
    activityFlowerPresence = {
      priority_status: priorityStatus,
      priority_count: 1,
      priority_thread_title: 'Historical Flower work',
      attention_count: 0,
      unread_failed_count: 0,
      running_count: 0,
      queued_count: 0,
      unread_canceled_count: 0,
      unread_completed_count: 0,
      [countKey]: 1,
    };
    await mountProductionMobileShell();
    await flushAsync();

    expect(document.querySelector('[data-testid="activity-flower-presence-summary"]')).toBeNull();
    expect(document.querySelector('[data-testid="activity-flower-composer"]')).not.toBeNull();
    const idleStatus = document.querySelector('[data-testid="activity-flower-idle-status"]');
    expect(idleStatus?.classList.contains('flower-companion-collapsed-status-idle')).toBe(true);
    expect(idleStatus?.className).not.toContain(priorityStatus);
    const announcement = document.querySelector('[data-testid="activity-flower-presence-announcement"]');
    expect(announcement?.textContent).toBe('Ready to ask Flower');
    expect(announcement?.hasAttribute('role')).toBe(false);
    expect(announcement?.hasAttribute('aria-live')).toBe(false);
    expect(announcement?.hasAttribute('aria-atomic')).toBe(false);
    expect(document.body.textContent).not.toContain('One task needs review');
    expect(document.body.textContent).not.toContain('One task needs your attention');
    expect(document.querySelector('[title*="Needs review"], [aria-label*="Needs review"]')).toBeNull();
  });

  it('acknowledges a just-completed run once, then restores the ordinary composer', async () => {
    await page.viewport(390, 844);
    await mountProductionMobileShell();
    publishActivityFlowerPresence({
      priority_status: 'attention',
      priority_count: 1,
      priority_thread_title: 'Historical attention',
      attention_count: 1,
      unread_failed_count: 1,
      running_count: 0,
      queued_count: 0,
      unread_canceled_count: 0,
      unread_completed_count: 1,
      terminal_transition: {
        thread_id: 'thread-live',
        run_id: 'run-live',
        run_generation: 1,
        outcome: 'completed',
      },
    });
    await flushAsync();

    const completed = document.querySelector('[data-flower-companion-ephemeral-kind="completion"]');
    const announcement = document.querySelector('[data-testid="activity-flower-presence-announcement"]');
    if (!(completed instanceof HTMLButtonElement) || !(announcement instanceof HTMLElement)) {
      throw new Error('Flower completion acknowledgement did not render.');
    }
    expect(completed.textContent).toContain('Completed');
    expect(completed.textContent).toContain('Refine the Flower companion');
    expect(completed.querySelector('.flower-companion-collapsed-icon-running')).toBeNull();
    expect(completed.querySelector('.flower-companion-collapsed-icon-completion')).not.toBeNull();
    expect(getComputedStyle(completed).animationName).toContain('flower-companion-completion-wash');
    expect(announcement.getAttribute('role')).toBe('status');
    expect(announcement.getAttribute('aria-live')).toBe('polite');
    expect(announcement.getAttribute('aria-atomic')).toBe('true');

    await new Promise((resolve) => window.setTimeout(resolve, 3_900));
    await flushAsync();
    expect(document.querySelector('[data-flower-companion-ephemeral-kind="completion"]')).toBeNull();
    expect(document.querySelector('[data-testid="activity-flower-composer"]')).not.toBeNull();
    expect(announcement.hasAttribute('aria-live')).toBe(false);
  });

  it('does not re-arm completion from late presence while expanded or on the full Flower page', async () => {
    await page.viewport(1280, 800);
    const fixture = await mountShell();
    const completedPresence = (threadID: string, runID: string, generation: number) => ({
      priority_status: 'idle',
      priority_count: 0,
      attention_count: 0,
      unread_failed_count: 0,
      running_count: 0,
      queued_count: 0,
      unread_canceled_count: 0,
      unread_completed_count: 1,
      terminal_transition: {
        thread_id: threadID,
        run_id: runID,
        run_generation: generation,
        outcome: 'completed',
      },
    });
    const runningPresence = (threadID: string, runID: string, generation: number) => ({
      ...runningActivityFlowerPresence(),
      priority_thread_id: threadID,
      priority_run_id: runID,
      priority_run_generation: generation,
    });

    publishActivityFlowerPresence(completedPresence('thread-live', 'run-live', 1));
    await flushAsync();
    const completion = document.querySelector('[data-flower-companion-ephemeral-kind="completion"]');
    if (!(completion instanceof HTMLButtonElement)) throw new Error('Initial completion did not render.');
    await userEvent.click(completion);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('expanded');

    publishActivityFlowerPresence(runningPresence('thread-expanded', 'run-expanded', 2));
    publishActivityFlowerPresence(completedPresence('thread-expanded', 'run-expanded', 2));
    const close = document.querySelector('[data-testid="activity-flower-header-actions"] button');
    if (!(close instanceof HTMLButtonElement)) throw new Error('Flower companion close control did not render.');
    await userEvent.click(close);
    await flushAsync();
    expect(document.querySelector('[data-flower-companion-ephemeral-kind="completion"]')).toBeNull();

    const activityBarFlower = document.querySelector('[data-floe-shell-slot="activity-bar"] button[aria-label="Flower"]');
    if (!(activityBarFlower instanceof HTMLButtonElement)) throw new Error('Activity Bar Flower entry did not render.');
    await userEvent.click(activityBarFlower);
    await flushAsync();
    publishActivityFlowerPresence(runningPresence('thread-full', 'run-full', 3));
    publishActivityFlowerPresence(completedPresence('thread-full', 'run-full', 3));
    const activityBarTerminal = document.querySelector('[data-floe-shell-slot="activity-bar"] button[aria-label="Terminal"]');
    if (!(activityBarTerminal instanceof HTMLButtonElement)) throw new Error('Activity Bar terminal entry did not render.');
    await userEvent.click(activityBarTerminal);
    await flushAsync();
    expect(fixture.product.dataset.presentation).toBe('collapsed');
    expect(document.querySelector('[data-flower-companion-ephemeral-kind="completion"]')).toBeNull();
  });

});
