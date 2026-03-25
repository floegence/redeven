// @vitest-environment jsdom

import { createContext } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setSidebarActiveTabMock = vi.hoisted(() => vi.fn());
const notificationErrorMock = vi.hoisted(() => vi.fn());
const notificationSuccessMock = vi.hoisted(() => vi.fn());
const notificationInfoMock = vi.hoisted(() => vi.fn());
const desktopAskFlowerBridgeState = vi.hoisted(() => ({
  listener: null as ((payload: { source: 'file_preview'; path: string; selectionText: string }) => void) | null,
}));

const getLocalRuntimeMock = vi.fn();
const getLocalAccessStatusMock = vi.fn();
const unlockLocalAccessMock = vi.fn();
const getEnvironmentMock = vi.fn();
const mintLocalDirectConnectInfoMock = vi.fn();
const channelInitEntryMock = vi.fn();
const getEnvPublicIDFromSessionMock = vi.fn(() => '');
const refreshLocalRuntimeMock = vi.fn();

let protocolStatus: 'connected' | 'disconnected' | 'connecting' | 'error' = 'disconnected';
let protocolClient: unknown = null;

const connectMock = vi.fn(async () => {
  protocolStatus = 'connected';
  protocolClient = { id: 'client-1' };
});
const reconnectMock = vi.fn(async () => {
  protocolStatus = 'connected';
  protocolClient = { id: 'client-2' };
});
const disconnectMock = vi.fn(() => {
  protocolStatus = 'disconnected';
  protocolClient = null;
});
const accessStatusMock = vi.fn(async () => ({ passwordRequired: false, unlocked: true }));
const accessResumeMock = vi.fn(async () => undefined);

vi.mock('@floegence/floe-webapp-core', () => ({
  useCommand: () => ({ open: vi.fn(), registerAll: () => () => {} }),
  useLayout: () => ({
    isMobile: () => false,
    sidebarActiveTab: () => 'deck',
    setSidebarActiveTab: setSidebarActiveTabMock,
    setSidebarCollapsed: vi.fn(),
  }),
  useNotification: () => ({
    error: notificationErrorMock,
    success: notificationSuccessMock,
    info: notificationInfoMock,
  }),
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
  ActivityAppsMain: () => <div>activity main</div>,
  FloeRegistryRuntime: (props: any) => <>{props.children}</>,
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  BottomBarItem: (props: any) => <div>{props.children}</div>,
  Panel: (props: any) => <div>{props.children}</div>,
  PanelContent: (props: any) => <div>{props.children}</div>,
  Shell: (props: any) => <div>{props.children}</div>,
  StatusIndicator: (props: any) => <div>{props.label ?? props.status}</div>,
  TopBarIconButton: (props: any) => <button type="button" onClick={props.onClick}>{props.children}</button>,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dropdown: (props: any) => <>{props.trigger}</>,
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

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    status: () => protocolStatus,
    client: () => protocolClient,
    connect: connectMock,
    reconnect: reconnectMock,
    disconnect: disconnectMock,
    error: () => null,
  }),
}));

vi.mock('./protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    access: {
      status: accessStatusMock,
      resume: accessResumeMock,
    },
    sys: {
      ping: vi.fn(async () => undefined),
    },
    ai: {
      subscribeThread: vi.fn(async () => undefined),
      sendUserTurn: vi.fn(async () => undefined),
    },
  }),
}));

vi.mock('./services/controlplaneApi', () => ({
  channelInitEntry: channelInitEntryMock,
  getEnvPublicIDFromSession: getEnvPublicIDFromSessionMock,
  getLocalAccessStatus: getLocalAccessStatusMock,
  getLocalRuntime: getLocalRuntimeMock,
  getEnvironment: getEnvironmentMock,
  mintEnvProxyEntryTicket: vi.fn(),
  mintLocalDirectConnectInfo: mintLocalDirectConnectInfoMock,
  mintEnvEntryTicketForApp: vi.fn(),
  refreshLocalRuntime: refreshLocalRuntimeMock,
  unlockLocalAccess: unlockLocalAccessMock,
}));

vi.mock('./accessResume', () => ({
  consumeAccessResumeTokenFromWindow: () => '',
}));

vi.mock('./icons/FlowerIcon', () => ({ FlowerIcon: () => <span /> }));
vi.mock('./icons/CodexIcon', () => ({ CodexIcon: () => <span /> }));
vi.mock('./pages/EnvDeckPage', () => ({ EnvDeckPage: () => <div /> }));
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
vi.mock('./widgets/AgentUpdateFloatingPrompt', () => ({ AgentUpdateFloatingPrompt: () => <div /> }));
vi.mock('./widgets/DetachedSurfaceScene', () => ({ DetachedSurfaceScene: () => <div /> }));
vi.mock('./widgets/FileBrowserSurfaceHost', () => ({ FileBrowserSurfaceHost: () => <div /> }));
vi.mock('./widgets/FilePreviewHost', () => ({ FilePreviewHost: () => <div /> }));
vi.mock('./widgets/AskFlowerComposerWindow', () => ({
  AskFlowerComposerWindow: (props: any) => (
    <div
      data-testid="ask-flower-composer"
      data-open={String(Boolean(props.open))}
      data-source={String(props.intent?.source ?? '')}
      data-path={String(props.intent?.contextItems?.[0]?.path ?? '')}
      data-selection={String(props.intent?.contextItems?.[0]?.selection ?? '')}
    />
  ),
}));
vi.mock('./maintenance/AgentUpdateContext', () => ({ AgentUpdateContext: createContext({}) }));
vi.mock('./maintenance/createAgentMaintenanceController', () => ({
  createAgentMaintenanceController: () => ({}),
}));
vi.mock('./maintenance/createAgentUpdatePromptCoordinator', () => ({
  createAgentUpdatePromptCoordinator: () => ({
    visible: () => false,
    mode: () => 'recommended',
    currentVersion: () => '',
    targetVersion: () => '',
    latestMessage: () => '',
    stage: () => '',
    error: () => null,
    dismiss: vi.fn(),
    startRecommendedUpgrade: vi.fn(),
    retry: vi.fn(),
    skipCurrentVersion: vi.fn(),
  }),
}));
vi.mock('./maintenance/createAgentVersionModel', () => ({
  createAgentVersionModel: () => ({}),
}));
vi.mock('./utils/askFlowerContextTemplate', () => ({ buildAskFlowerDraftMarkdown: () => '' }));
vi.mock('./utils/askFlowerPath', () => ({
  resolveSuggestedWorkingDirAbsolute: () => '',
  normalizeAbsolutePath: (value: string) => {
    const raw = String(value ?? '').trim();
    if (!raw.startsWith('/')) return '';
    if (raw === '/') return '/';
    return raw.replace(/\/+$/, '') || '/';
  },
  dirnameAbsolute: (value: string) => {
    const raw = String(value ?? '').trim();
    if (!raw.startsWith('/')) return '';
    const normalized = raw === '/' ? '/' : raw.replace(/\/+$/, '') || '/';
    if (normalized === '/') return '/';
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash <= 0) return '/';
    return normalized.slice(0, lastSlash) || '/';
  },
}));
vi.mock('./utils/windowNavigation', () => ({ reloadCurrentPage: vi.fn() }));
vi.mock('./services/desktopAskFlowerBridge', () => ({
  subscribeDesktopAskFlowerMainWindowHandoff: (listener: (payload: { source: 'file_preview'; path: string; selectionText: string }) => void) => {
    desktopAskFlowerBridgeState.listener = listener;
    return () => {
      if (desktopAskFlowerBridgeState.listener === listener) {
        desktopAskFlowerBridgeState.listener = null;
      }
    };
  },
}));
vi.mock('./services/gatewayApi', () => ({
  fetchGatewayJSON: vi.fn(),
  getGatewayAccessStatus: vi.fn(),
  uploadGatewayFile: vi.fn(),
  unlockGatewayAccess: vi.fn(),
}));
vi.mock('./services/sandboxWindowRegistry', () => ({ getSandboxWindowInfo: () => null }));
vi.mock('./pages/EnvContext', () => ({ EnvContext: createContext({}) }));
vi.mock('./pages/AIChatContext', () => ({
  AIChatContext: createContext({}),
  createAIChatContextValue: () => ({}),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushUntil(predicate: () => boolean, maxTurns = 10): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    await flushAsync();
    if (predicate()) return;
  }
}

function composer(root: ParentNode): HTMLElement | null {
  return root.querySelector('[data-testid="ask-flower-composer"]');
}

afterEach(() => {
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  desktopAskFlowerBridgeState.listener = null;
  protocolStatus = 'disconnected';
  protocolClient = null;

  getLocalRuntimeMock.mockResolvedValue({
    mode: 'local',
    env_public_id: 'env_local',
    direct_ws_url: 'ws://localhost/_redeven_direct/ws',
  });
  refreshLocalRuntimeMock.mockResolvedValue({
    mode: 'local',
    env_public_id: 'env_local',
    direct_ws_url: 'ws://localhost/_redeven_direct/ws',
  });
  getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
  unlockLocalAccessMock.mockResolvedValue({ unlocked: true, resume_token: 'resume123' });
  mintLocalDirectConnectInfoMock.mockResolvedValue({
    ws_url: 'ws://localhost/_redeven_direct/ws',
    channel_id: 'ch_local',
    e2ee_psk_b64u: 'secret',
    channel_init_expire_at_unix_s: 1,
    default_suite: 1,
  });
});

describe('EnvAppShell desktop Ask Flower handoff', () => {
  it('opens the floating composer after a deferred desktop handoff without jumping to the AI tab', async () => {
    const envDeferred = deferred<any>();
    getEnvironmentMock.mockReturnValue(envDeferred.promise);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushUntil(() => desktopAskFlowerBridgeState.listener !== null);
      expect(desktopAskFlowerBridgeState.listener).toBeTypeOf('function');

      setSidebarActiveTabMock.mockClear();
      desktopAskFlowerBridgeState.listener?.({
        source: 'file_preview',
        path: '/workspace/demo.txt',
        selectionText: 'selected line',
      });
      await flushAsync();

      expect(composer(host)?.getAttribute('data-open')).toBe('false');

      envDeferred.resolve({
        public_id: 'env_local',
        name: 'Local agent',
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

      await flushUntil(() => composer(host)?.getAttribute('data-open') === 'true');

      expect(composer(host)?.getAttribute('data-open')).toBe('true');
      expect(composer(host)?.getAttribute('data-source')).toBe('file_preview');
      expect(composer(host)?.getAttribute('data-path')).toBe('/workspace/demo.txt');
      expect(composer(host)?.getAttribute('data-selection')).toBe('selected line');
      expect(setSidebarActiveTabMock.mock.calls.some(([tab]) => tab === 'ai')).toBe(false);
    } finally {
      dispose();
    }
  });
});
