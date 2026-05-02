// @vitest-environment jsdom

import { createContext, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getLocalRuntimeMock = vi.fn();
const getLocalAccessStatusMock = vi.fn();
const unlockLocalAccessMock = vi.fn();
const getEnvironmentMock = vi.fn();
const getAgentLatestVersionMock = vi.fn();
const getGatewayAccessStatusMock = vi.fn();
const unlockGatewayAccessMock = vi.fn();
const mintLocalDirectConnectArtifactMock = vi.fn();
const mintEnvProxyEntryTicketMock = vi.fn();
const mintEnvEntryTicketForAppMock = vi.fn();
const connectArtifactEntryMock = vi.fn();
const getEnvPublicIDFromSessionMock = vi.fn(() => 'env_remote');
const notificationMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));

let protocolStatus: 'connected' | 'disconnected' | 'connecting' | 'error' = 'disconnected';
let protocolClient: unknown = null;
const [protocolRevision, setProtocolRevision] = createSignal(0);

const connectMock = vi.fn(async () => {
  protocolStatus = 'connected';
  protocolClient = { id: 'client-1' };
  setProtocolRevision((revision) => revision + 1);
});
const reconnectMock = vi.fn(async () => {
  protocolStatus = 'connected';
  protocolClient = { id: 'client-2' };
  setProtocolRevision((revision) => revision + 1);
});
const disconnectMock = vi.fn(() => {
  protocolStatus = 'disconnected';
  protocolClient = null;
  setProtocolRevision((revision) => revision + 1);
});
const accessStatusMock = vi.fn(async () => ({ passwordRequired: false, unlocked: true }));
const accessResumeMock = vi.fn(async () => undefined);

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  deferAfterPaint: (fn: () => void) => setTimeout(fn, 0),
  useCommand: () => ({ open: vi.fn(), registerAll: () => () => {}, getKeybindDisplay: (keybind: string) => keybind }),
  useLayout: () => ({
    isMobile: () => false,
    sidebarActiveTab: () => 'deck',
    setSidebarActiveTab: vi.fn(),
    setSidebarCollapsed: vi.fn(),
  }),
  useNotification: () => notificationMocks,
  useTheme: () => ({
    resolvedTheme: () => 'dark',
    toggleTheme: vi.fn(),
    themePresets: () => [],
    themePreset: () => undefined,
    setThemePreset: vi.fn(),
  }),
  useDeck: () => ({
    activeLayout: () => ({ widgets: [] }),
    addWidget: vi.fn(() => 'widget-1'),
    updateWidgetState: vi.fn(),
    getWidgetState: () => ({}),
  }),
  useWidgetRegistry: () => ({ registerAll: vi.fn() }),
}));

vi.mock('@floegence/floe-webapp-core/app', () => ({
  ActivityAppsMain: () => <div>activity main</div>,
  FloeRegistryRuntime: (props: any) => <>{props.children}</>,
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  BottomBarItem: (props: any) => <div>{props.children}</div>,
  DisplayModePageShell: (props: any) => (
    <div data-testid="display-mode-page-shell">
      {props.logo}
      {props.title ? <div>{props.title}</div> : null}
      {props.actions}
      {props.children}
    </div>
  ),
  DisplayModeSwitcher: (props: any) => (
    <div data-testid="display-mode-switcher">
      {['activity', 'deck', 'workbench'].map((mode) => (
        <button type="button" onClick={() => props.onChange?.(mode)}>
          {mode === 'activity' ? 'Activity' : mode === 'deck' ? 'Deck' : 'Workbench'}
        </button>
      ))}
    </div>
  ),
  Panel: (props: any) => <div>{props.children}</div>,
  PanelContent: (props: any) => <div>{props.children}</div>,
  sanitizeDisplayMode: (value: unknown, fallback = 'activity') => (
    value === 'activity' || value === 'deck' || value === 'workbench' ? value : fallback
  ),
  Shell: (props: any) => <div>{props.children}</div>,
  StatusIndicator: (props: any) => <div>{props.label ?? props.status}</div>,
  TopBarIconButton: (props: any) => <button type="button" onClick={props.onClick}>{props.children}</button>,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dropdown: (props: any) => <>{props.trigger}</>,
  SegmentedControl: (props: any) => (
    <div>
      {props.options?.map((option: any) => (
        <button type="button" onClick={() => props.onChange?.(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  Tooltip: (props: any) => <>{props.children}</>,
}));

vi.mock('./TopBarBrandButton', () => ({
  TopBarBrandButton: (props: any) => (
    <button type="button" class={props.class} onClick={props.onClick} aria-label={props.label}>
      {props.children}
    </button>
  ),
}));

vi.mock('./notes/NotesOverlay', () => ({
  NotesOverlay: () => <div data-testid="notes-overlay" />,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Activity: Icon,
    ArrowRightLeft: Icon,
    Code: Icon,
    Copy: Icon,
    Files: Icon,
    Globe: Icon,
    Grid3x3: Icon,
    LayoutDashboard: Icon,
    MoreVertical: Icon,
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
    status: () => {
      protocolRevision();
      return protocolStatus;
    },
    client: () => {
      protocolRevision();
      return protocolClient;
    },
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
      ping: vi.fn(async () => ({ serverTimeMs: Date.now(), version: 'v1.0.0' })),
      upgrade: vi.fn(async () => ({ ok: true })),
      restart: vi.fn(async () => ({ ok: true })),
    },
    ai: {
      subscribeThread: vi.fn(async () => undefined),
      sendUserTurn: vi.fn(async () => undefined),
    },
  }),
}));

vi.mock('./services/controlplaneApi', () => ({
  connectArtifactEntry: connectArtifactEntryMock,
  getAgentLatestVersion: getAgentLatestVersionMock,
  getEnvPublicIDFromSession: getEnvPublicIDFromSessionMock,
  getLocalAccessStatus: getLocalAccessStatusMock,
  getLocalRuntime: getLocalRuntimeMock,
  getEnvironment: getEnvironmentMock,
  mintEnvProxyEntryTicket: mintEnvProxyEntryTicketMock,
  mintLocalDirectConnectArtifact: mintLocalDirectConnectArtifactMock,
  mintEnvEntryTicketForApp: mintEnvEntryTicketForAppMock,
  unlockLocalAccess: unlockLocalAccessMock,
}));

vi.mock('./accessResume', () => ({
  consumeAccessResumeTokenFromWindow: () => '',
}));

vi.mock('./icons/FlowerIcon', () => ({ FlowerIcon: () => <span /> }));
vi.mock('./icons/CodexIcon', () => ({ CodexIcon: () => <span />, CodexNavigationIcon: () => <span /> }));
vi.mock('./pages/EnvDeckPage', () => ({ EnvDeckPage: () => <div data-testid="deck-page" /> }));
vi.mock('./workbench/EnvWorkbenchPage', () => ({ EnvWorkbenchPage: () => <div data-testid="workbench-page" /> }));
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
vi.mock('./widgets/AskFlowerComposerWindow', () => ({ AskFlowerComposerWindow: () => <div /> }));
vi.mock('./widgets/FileBrowserSurfaceHost', () => ({ FileBrowserSurfaceHost: () => <div /> }));
vi.mock('./widgets/FilePreviewHost', () => ({ FilePreviewHost: () => <div /> }));
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
vi.mock('./services/gatewayApi', () => ({
  fetchGatewayJSON: vi.fn(),
  gatewayRequestCredentials: () => 'same-origin',
  getGatewayAccessStatus: getGatewayAccessStatusMock,
  uploadGatewayFile: vi.fn(),
  unlockGatewayAccess: unlockGatewayAccessMock,
}));
vi.mock('./services/sandboxWindowRegistry', () => ({ getSandboxWindowInfo: () => null }));
vi.mock('./pages/EnvContext', () => ({ EnvContext: createContext({}) }));
vi.mock('./pages/AIChatContext', () => ({
  AIChatContext: createContext({}),
  createAIChatContextValue: () => ({}),
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushUntil(predicate: () => boolean, maxTurns: number = 8): Promise<void> {
  for (let index = 0; index < maxTurns; index += 1) {
    await flushAsync();
    if (predicate()) return;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  protocolStatus = 'disconnected';
  protocolClient = null;

  getLocalRuntimeMock.mockResolvedValue(null);
  getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
  unlockLocalAccessMock.mockResolvedValue({ unlocked: true, resume_token: 'resume123' });
  getGatewayAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
  unlockGatewayAccessMock.mockResolvedValue({ unlocked: true, resume_token: 'resume123' });
  getEnvironmentMock.mockResolvedValue({
    public_id: 'env_remote',
    name: 'Remote env',
    namespace_public_id: 'ns_remote',
    status: 'online',
    lifecycle_status: 'running',
    permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true },
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
  connectArtifactEntryMock.mockReturnValue({
    transport: 'tunnel',
    tunnel_grant: { channel_id: 'ch_remote' },
  });
});

describe('EnvAppShell update prompt orchestration', () => {
  it('keeps the shell interactive while latest-version polling runs asynchronously', async () => {
    const latestDeferred = deferred<any>();
    getAgentLatestVersionMock.mockReturnValue(latestDeferred.promise);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushUntil(() => Boolean(host.querySelector('[data-testid="deck-page"]')));

      expect(host.querySelector('[data-testid="deck-page"]')).toBeTruthy();
      expect(connectMock).toHaveBeenCalled();

      latestDeferred.resolve({
        latest_version: 'v1.1.0',
        recommended_version: 'v1.1.0',
        upgrade_policy: 'self_upgrade',
        cache_ttl_ms: 300_000,
      });
      await flushAsync();
    } finally {
      dispose();
    }
  });

  it('announces optional runtime updates through toast notifications', async () => {
    getAgentLatestVersionMock.mockResolvedValue({
      latest_version: 'v1.1.0',
      recommended_version: 'v1.1.0',
      upgrade_policy: 'self_upgrade',
      cache_ttl_ms: 300_000,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushUntil(() => notificationMocks.info.mock.calls.length > 0);

      expect(notificationMocks.info).toHaveBeenCalledWith(
        'Runtime update ready',
        'Runtime Service v1.1.0 is ready. Open Runtime Status when your work is idle.',
      );
      expect(host.textContent).not.toContain('Update available');
    } finally {
      dispose();
    }
  });

  it('does not query the latest version before the access gate is cleared', async () => {
    getGatewayAccessStatusMock.mockResolvedValueOnce({ password_required: true, unlocked: false });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.querySelector('input[type="password"]')).toBeTruthy();
      expect(getAgentLatestVersionMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});
