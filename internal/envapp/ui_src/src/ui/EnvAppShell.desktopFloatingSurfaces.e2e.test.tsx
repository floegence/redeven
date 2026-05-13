// @vitest-environment jsdom

import { createContext, useContext } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const EnvContextMock = createContext({} as any);
const FilePreviewContextMock = createContext({} as any);
const FileBrowserSurfaceContextMock = createContext({} as any);

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
const getEnvironmentMock = vi.fn();
const mintLocalDirectConnectArtifactMock = vi.fn();
const connectArtifactEntryMock = vi.fn();

let debugConsoleEnabled = false;
let protocolStatus: 'connected' | 'disconnected' | 'connecting' | 'error' = 'disconnected';
let protocolClient: unknown = null;
let desktopViewMode: 'activity' | 'deck' | 'workbench' = 'activity';

const connectMock = vi.fn(async () => {
  protocolStatus = 'connected';
  protocolClient = { id: 'client-1' };
});

vi.mock('@floegence/floe-webapp-core', () => ({
  deferAfterPaint: (fn: () => void) => setTimeout(fn, 0),
  useCommand: () => ({ open: vi.fn(), registerAll: () => () => {}, getKeybindDisplay: (keybind: string) => keybind }),
  useDeck: () => ({
    activeLayout: () => ({ widgets: [] }),
    addWidget: vi.fn(() => 'widget-1'),
    updateWidgetState: vi.fn(),
    getWidgetState: () => ({}),
  }),
  useLayout: () => ({
    isMobile: () => false,
    sidebarActiveTab: () => 'deck',
    setSidebarActiveTab: vi.fn(),
    setSidebarCollapsed: vi.fn(),
  }),
  useNotification: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
  useTheme: () => ({
    resolvedTheme: () => 'dark',
    toggleTheme: vi.fn(),
    themePresets: () => [],
    themePreset: () => undefined,
    setThemePreset: vi.fn(),
  }),
  useWidgetRegistry: () => ({ registerAll: vi.fn() }),
}));

vi.mock('@floegence/floe-webapp-core/app', () => ({
  ActivityAppsMain: () => {
    const env = useContext(EnvContextMock);
    const filePreview = useContext(FilePreviewContextMock);
    return (
      <div>
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
      </div>
    );
  },
  FloeRegistryRuntime: (props: any) => <>{props.children}</>,
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  BottomBarItem: (props: any) => <div>{props.children}</div>,
  DisplayModePageShell: (props: any) => <div data-testid="display-mode-page-shell">{props.children}</div>,
  DisplayModeSwitcher: () => <div data-testid="display-mode-switcher" />,
  Panel: (props: any) => <div>{props.children}</div>,
  PanelContent: (props: any) => <div>{props.children}</div>,
  Shell: (props: any) => <div>{props.children}</div>,
  StatusIndicator: (props: any) => <div>{props.label ?? props.status}</div>,
  TopBarIconButton: (props: any) => <button type="button" onClick={props.onClick}>{props.children}</button>,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dropdown: (props: any) => <>{props.trigger}</>,
  SegmentedControl: () => <div />,
  Tooltip: (props: any) => <>{props.children}</>,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Activity: Icon,
    Code: Icon,
    Copy: Icon,
    Files: Icon,
    Globe: Icon,
    Grid3x3: Icon,
    LayoutDashboard: Icon,
    Moon: Icon,
    Refresh: Icon,
    Search: Icon,
    Settings: Icon,
    Sun: Icon,
    Terminal: Icon,
  };
});

vi.mock('@floegence/floe-webapp-boot', () => ({
  createArtifactDirectReconnectConfig: (config: unknown) => config,
  createArtifactSourceFromFactory: (factory: unknown) => factory,
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
  unlockLocalAccess: vi.fn(async () => ({ unlocked: true, resume_token: 'resume123' })),
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

vi.mock('./pages/EnvDeckPage', () => ({
  EnvDeckPage: () => {
    const filePreview = useContext(FilePreviewContextMock);
    return (
      <button
        type="button"
        data-testid="deck-open-preview"
        onClick={() => void filePreview.openPreview({
          id: '/workspace/deck.txt',
          type: 'file',
          name: 'deck.txt',
          path: '/workspace/deck.txt',
          size: 8,
        })}
      >
        Open Deck Preview
      </button>
    );
  },
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
        <div data-testid="workbench-preview-activation">
          {env.workbenchFilePreviewActivation?.()?.item?.path ?? ''}
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
vi.mock('./pages/EnvAIPage', () => ({ EnvAIPage: () => <div /> }));
vi.mock('./codex/CodexPage', () => ({ CodexPage: () => <div /> }));
vi.mock('./codex/CodexProvider', () => ({ CodexProvider: (props: any) => <>{props.children}</> }));
vi.mock('./codex/CodexSidebar', () => ({ CodexSidebar: () => <div /> }));
vi.mock('./pages/AIChatSidebar', () => ({ AIChatSidebar: () => <div /> }));
vi.mock('./pages/EnvSettingsPage', () => ({ EnvSettingsPage: () => <div /> }));
vi.mock('./pages/aiPermissions', () => ({ hasRWXPermissions: () => true }));
vi.mock('./deck/redevenDeckWidgets', () => ({ redevenDeckWidgets: [] }));
vi.mock('./widgets/AuditLogDialog', () => ({ AuditLogDialog: () => <div /> }));
vi.mock('./widgets/FilePreviewHost', () => ({ FilePreviewHost: () => <div data-testid="file-preview-host" /> }));
vi.mock('./widgets/FileBrowserSurfaceHost', () => ({ FileBrowserSurfaceHost: () => <div data-testid="file-browser-host" /> }));
vi.mock('./debugConsole/DebugConsoleWindow', () => ({
  DebugConsoleWindow: () => <div data-testid="debug-console-window" />,
}));
vi.mock('./widgets/AskFlowerComposerWindow', () => ({ AskFlowerComposerWindow: () => <div /> }));
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
vi.mock('./utils/askFlowerContextTemplate', () => ({ buildAskFlowerDraftMarkdown: () => '' }));
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
  openConnectionCenter: vi.fn(async () => false),
  performRuntimeMaintenanceActionInDesktopShell: vi.fn(async () => null),
  runtimeMaintenanceMethodUsesDesktop: () => false,
}));
vi.mock('./services/gatewayApi', () => ({
  fetchGatewayJSON: vi.fn(),
  getGatewayAccessStatus: vi.fn(async () => ({ password_required: false, unlocked: true })),
  uploadGatewayFile: vi.fn(),
  unlockGatewayAccess: vi.fn(async () => ({ unlocked: true, resume_token: 'resume123' })),
}));
vi.mock('./services/accessUnlockError', () => ({
  formatAccessUnlockRetryAfter: () => '1m',
  getAccessUnlockRetryAfterMs: () => 0,
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
  readUIStorageJSON: vi.fn(() => null),
  readUIStorageItem: vi.fn((key: string) => (key === 'redeven_envapp_desktop_view_mode' ? desktopViewMode : null)),
  writeRendererScopedUIStorageItem: vi.fn(),
  writeUIStorageItem: vi.fn(),
}));
vi.mock('./envSidebarVisibilityMotion', () => ({
  resolveEnvSidebarVisibilityMotion: () => 'animated',
  shouldEnvTabOpenSidebar: () => false,
}));
vi.mock('./pages/AIChatContext', () => ({
  AIChatContext: createContext({}),
  createAIChatContextValue: () => ({}),
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  debugConsoleEnabled = false;
  protocolStatus = 'disconnected';
  protocolClient = null;
  desktopViewMode = 'activity';
  window.open = windowOpenMock as typeof window.open;
  getLocalRuntimeMock.mockResolvedValue({
    mode: 'local',
    env_public_id: 'env_local',
    desktop_managed: true,
    direct_ws_url: 'ws://localhost/_redeven_direct/ws',
  });
  getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
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

describe('EnvAppShell desktop floating surfaces', () => {
  it('opens file preview through the in-app floating host without spawning a system window', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.querySelector('[data-testid="file-preview-host"]')).not.toBeNull();

      (host.querySelector('[data-testid="open-preview"]') as HTMLButtonElement).click();
      await flushAsync();

      expect(filePreviewOpenPreviewMock).toHaveBeenCalledTimes(1);
      expect(filePreviewOpenPreviewMock).toHaveBeenCalledWith(expect.objectContaining({
        type: 'file',
        path: '/workspace/demo.txt',
      }));
      expect(windowOpenMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('keeps the floating file preview host available in deck mode', async () => {
    desktopViewMode = 'deck';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.querySelector('[data-testid="file-preview-host"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="display-mode-page-shell"]')).not.toBeNull();

      filePreviewOpenPreviewMock.mockClear();
      (host.querySelector('[data-testid="deck-open-preview"]') as HTMLButtonElement).click();
      await flushAsync();

      expect(filePreviewOpenPreviewMock).toHaveBeenCalledWith(expect.objectContaining({
        type: 'file',
        path: '/workspace/deck.txt',
      }));
      expect(windowOpenMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('opens debug console through the in-app floating controller without spawning a system window', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.querySelector('[data-testid="debug-console-window"]')).not.toBeNull();

      (host.querySelector('[data-testid="open-debug-console"]') as HTMLButtonElement).click();
      await flushAsync();

      expect(debugConsoleShowMock).toHaveBeenCalledTimes(1);
      expect(windowOpenMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('routes file preview requests into workbench activation instead of the floating preview controller when workbench mode is active', async () => {
    desktopViewMode = 'workbench';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      (host.querySelector('[data-testid="workbench-open-preview"]') as HTMLButtonElement).click();
      await flushAsync();

      expect(filePreviewOpenPreviewMock).not.toHaveBeenCalled();
      expect(host.querySelector('[data-testid="workbench-preview-activation"]')?.textContent).toBe('/workspace/demo.txt');
      expect(windowOpenMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('routes workbench file-browser FAB requests into a new Files widget', async () => {
    desktopViewMode = 'workbench';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      (host.querySelector('[data-testid="workbench-open-browser"]') as HTMLButtonElement).click();
      await flushAsync();

      expect(host.querySelector('[data-testid="workbench-browser-activation"]')?.textContent).toBe('/workspace/app|App|create_new');
      expect(windowOpenMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('routes workbench terminal handoffs into an anchored new Terminal widget', async () => {
    desktopViewMode = 'workbench';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      (host.querySelector('[data-testid="workbench-open-terminal"]') as HTMLButtonElement).click();
      await flushAsync();

      expect(host.querySelector('[data-testid="workbench-terminal-activation"]')?.textContent).toBe('/workspace/app|App|create_new|false|240|320');
      expect(windowOpenMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});
