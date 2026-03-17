// @vitest-environment jsdom

import { createContext } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getLocalRuntimeMock = vi.fn();
const getLocalAccessStatusMock = vi.fn();
const unlockLocalAccessMock = vi.fn();
const getEnvironmentMock = vi.fn();
const getGatewayAccessStatusMock = vi.fn();
const unlockGatewayAccessMock = vi.fn();
const mintLocalDirectConnectInfoMock = vi.fn();
const mintEnvProxyEntryTicketMock = vi.fn();
const mintEnvEntryTicketForAppMock = vi.fn();
const channelInitEntryMock = vi.fn();
const getEnvPublicIDFromSessionMock = vi.fn(() => '');
const reloadCurrentPageMock = vi.fn();

const connectMock = vi.fn(async (_config: Record<string, unknown>) => {
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
const accessStatusMock = vi.fn(async () => ({ passwordRequired: true, unlocked: resumeCalls.length > 0 }));
const accessResumeMock = vi.fn(async ({ token }: { token: string }) => {
  resumeCalls.push(token);
});

let protocolStatus: 'connected' | 'disconnected' | 'connecting' | 'error' = 'disconnected';
let protocolClient: unknown = null;
let resumeCalls: string[] = [];

vi.mock('@floegence/floe-webapp-core', () => ({
  useCommand: () => ({ open: vi.fn(), registerAll: () => () => {} }),
  useLayout: () => ({
    isMobile: () => false,
    sidebarActiveTab: () => 'deck',
    setSidebarActiveTab: vi.fn(),
    setSidebarCollapsed: vi.fn(),
  }),
  useNotification: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
  useTheme: () => ({ resolvedTheme: () => 'dark', toggleTheme: vi.fn() }),
  useWidgetRegistry: () => ({ registerAll: vi.fn() }),
}));

vi.mock('@floegence/floe-webapp-core/app', () => ({
  ActivityAppsMain: () => <div>activity main</div>,
  FloeRegistryRuntime: (props: any) => <>{props.children}</>,
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  BottomBarItem: (props: any) => <button type="button" class={props.class} onClick={props.onClick}>{props.children}</button>,
  Panel: (props: any) => <div>{props.children}</div>,
  PanelContent: (props: any) => <div>{props.children}</div>,
  Shell: (props: any) => <div>{props.topBarActions}{props.bottomBarItems}{props.children}</div>,
  StatusIndicator: (props: any) => <div>{props.label ?? props.status}</div>,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
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
  mintEnvProxyEntryTicket: mintEnvProxyEntryTicketMock,
  mintLocalDirectConnectInfo: mintLocalDirectConnectInfoMock,
  mintEnvEntryTicketForApp: mintEnvEntryTicketForAppMock,
  unlockLocalAccess: unlockLocalAccessMock,
}));

vi.mock('./accessResume', () => ({
  consumeAccessResumeTokenFromWindow: () => '',
}));

vi.mock('./icons/FlowerIcon', () => ({ FlowerIcon: () => <span /> }));
vi.mock('./pages/EnvDeckPage', () => ({ EnvDeckPage: () => <div /> }));
vi.mock('./pages/EnvTerminalPage', () => ({ EnvTerminalPage: () => <div /> }));
vi.mock('./pages/EnvMonitorPage', () => ({ EnvMonitorPage: () => <div /> }));
vi.mock('./pages/EnvFileBrowserPage', () => ({ EnvFileBrowserPage: () => <div /> }));
vi.mock('./pages/EnvCodespacesPage', () => ({ EnvCodespacesPage: () => <div /> }));
vi.mock('./pages/EnvPortForwardsPage', () => ({ EnvPortForwardsPage: () => <div /> }));
vi.mock('./pages/EnvAIPage', () => ({ EnvAIPage: () => <div /> }));
vi.mock('./pages/AIChatSidebar', () => ({ AIChatSidebar: () => <div /> }));
vi.mock('./pages/EnvSettingsPage', () => ({ EnvSettingsPage: () => <div /> }));
vi.mock('./pages/aiPermissions', () => ({ hasRWXPermissions: () => true }));
vi.mock('./deck/redevenDeckWidgets', () => ({ redevenDeckWidgets: [] }));
vi.mock('./widgets/AuditLogDialog', () => ({ AuditLogDialog: () => <div /> }));
vi.mock('./widgets/AgentUpdateFloatingPrompt', () => ({ AgentUpdateFloatingPrompt: () => <div /> }));
vi.mock('./widgets/AskFlowerComposerWindow', () => ({ AskFlowerComposerWindow: () => <div /> }));
vi.mock('./widgets/FilePreviewHost', () => ({ FilePreviewHost: () => <div /> }));
vi.mock('./utils/askFlowerContextTemplate', () => ({ buildAskFlowerDraftMarkdown: () => '' }));
vi.mock('./utils/askFlowerPath', () => ({ resolveSuggestedWorkingDirAbsolute: () => '' }));
vi.mock('./utils/windowNavigation', () => ({ reloadCurrentPage: reloadCurrentPageMock }));
vi.mock('./services/gatewayApi', () => ({
  fetchGatewayJSON: vi.fn(),
  gatewayRequestCredentials: () => 'same-origin',
  getGatewayAccessStatus: getGatewayAccessStatusMock,
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
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
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

function findButtonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((node) => node.textContent?.trim().includes(text)) as HTMLButtonElement | undefined;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  protocolStatus = 'disconnected';
  protocolClient = null;
  resumeCalls = [];
  reloadCurrentPageMock.mockReset();
  accessStatusMock.mockReset();
  accessStatusMock.mockImplementation(async () => ({ passwordRequired: true, unlocked: resumeCalls.length > 0 }));
  accessResumeMock.mockReset();
  accessResumeMock.mockImplementation(async ({ token }: { token: string }) => {
    resumeCalls.push(token);
  });
  getLocalRuntimeMock.mockResolvedValue({ mode: 'local', env_public_id: 'env_local', direct_ws_url: 'ws://localhost/_redeven_direct/ws' });
  getLocalAccessStatusMock.mockResolvedValue({ password_required: true, unlocked: false });
  unlockLocalAccessMock.mockResolvedValue({ unlocked: true, resume_token: 'resume123' });
  getGatewayAccessStatusMock
    .mockResolvedValueOnce({ password_required: true, unlocked: false })
    .mockResolvedValueOnce({ password_required: true, unlocked: true });
  unlockGatewayAccessMock.mockResolvedValue({ unlocked: true, resume_token: 'resume123' });
  getEnvironmentMock.mockResolvedValue({
    public_id: 'env_local',
    name: 'Local agent',
    namespace_public_id: 'ns_local',
    status: 'online',
    lifecycle_status: 'running',
    permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true },
  });
  mintLocalDirectConnectInfoMock.mockResolvedValue({
    ws_url: 'ws://localhost/_redeven_direct/ws',
    channel_id: 'ch_local',
    e2ee_psk_b64u: 'secret',
    channel_init_expire_at_unix_s: 1,
    default_suite: 1,
  });
  channelInitEntryMock.mockReturnValue({ endpointId: 'env_local' });
});

describe('EnvAppShell local access gate', () => {

  it('keeps the app blocked until access resume finishes', async () => {
    const resumeDeferred = deferred<void>();
    accessResumeMock.mockImplementationOnce(async ({ token }: { token: string }) => {
      resumeCalls.push(token);
      await resumeDeferred.promise;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      expect(accessResumeMock).toHaveBeenCalledWith({ token: 'resume123' });
      expect(host.textContent).toContain('Preparing secure session');
      expect(host.textContent).not.toContain('activity main');

      resumeDeferred.resolve();
      await flushAsync();
      await flushAsync();

      expect(host.textContent).toContain('activity main');
      expect(host.textContent).not.toContain('Preparing secure session');
    } finally {
      dispose();
    }
  });

  it('exposes retry and reload actions after the secure-session resume times out', async () => {
    vi.useFakeTimers();
    accessResumeMock.mockImplementationOnce(async ({ token }: { token: string }) => {
      resumeCalls.push(token);
      await new Promise<void>(() => {});
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(host.textContent).toContain('Preparing secure session');
      expect(findButtonByText(host, 'Preparing secure session...')).toBeTruthy();
      expect(findButtonByText(host, 'Reload page')).toBeTruthy();

      await vi.advanceTimersByTimeAsync(15_000);
      await flushAsync();

      expect(host.textContent).toContain('Timed out while preparing the secure session');
      expect(findButtonByText(host, 'Retry connection')?.disabled).toBe(false);
      expect(findButtonByText(host, 'Reload page')).toBeTruthy();
      expect(Array.from(host.querySelectorAll('button')).filter((node) => node.textContent?.includes('Retry connection')).length).toBeGreaterThanOrEqual(2);

      findButtonByText(host, 'Reload page')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(reloadCurrentPageMock).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('retries with a fresh connection after a timed-out secure-session resume', async () => {
    vi.useFakeTimers();
    let statusCalls = 0;
    accessStatusMock.mockImplementation(async () => {
      statusCalls += 1;
      return { passwordRequired: true, unlocked: false };
    });
    accessResumeMock
      .mockImplementationOnce(async ({ token }: { token: string }) => {
        resumeCalls.push(token);
        await new Promise<void>(() => {});
      })
      .mockImplementationOnce(async ({ token }: { token: string }) => {
        resumeCalls.push(token);
      });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(15_000);
      await flushAsync();

      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(findButtonByText(host, 'Retry connection')?.disabled).toBe(false);

      const retryButtons = Array.from(host.querySelectorAll('button')).filter((node) => node.textContent?.includes('Retry connection')) as HTMLButtonElement[];
      expect(retryButtons.length).toBeGreaterThanOrEqual(2);
      retryButtons[retryButtons.length - 1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(disconnectMock).toHaveBeenCalled();
      expect(connectMock).toHaveBeenCalledTimes(2);
      expect(accessResumeMock).toHaveBeenCalledTimes(2);
      expect(resumeCalls).toEqual(['resume123', 'resume123']);
      expect(statusCalls).toBeGreaterThanOrEqual(2);
      expect(host.textContent).toContain('activity main');
      expect(host.textContent).not.toContain('Secure session needs attention');
    } finally {
      dispose();
    }
  });

  it('returns to the password prompt when the resume token is rejected', async () => {
    accessResumeMock.mockRejectedValueOnce(Object.assign(new Error('invalid resume token'), { code: 401 }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      expect(accessResumeMock).toHaveBeenCalledWith({ token: 'resume123' });
      expect(host.textContent).toContain('Unlock local agent');
      expect(host.textContent).toContain('Access password expired. Enter it again to continue.');
      expect(host.querySelector('input[type="password"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('waits for password unlock before connecting the local agent', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      expect(host.textContent).toContain('Unlock local agent');
      expect(connectMock).not.toHaveBeenCalled();
      expect(mintLocalDirectConnectInfoMock).not.toHaveBeenCalled();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      expect(unlockLocalAccessMock).toHaveBeenCalledWith('secret');
      expect(getLocalAccessStatusMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledTimes(1);
      const localConnectConfig = connectMock.mock.calls[0]?.[0];
      expect(localConnectConfig).toMatchObject({
        mode: 'direct',
        observer: expect.any(Object),
        connect: { keepaliveIntervalMs: 15_000 },
        getDirectInfo: expect.any(Function),
        autoReconnect: {
          enabled: true,
          maxAttempts: 1_000_000,
          initialDelayMs: 500,
          maxDelayMs: 30_000,
        },
      });
      expect(localConnectConfig).not.toHaveProperty('directInfo');
      expect(mintLocalDirectConnectInfoMock).not.toHaveBeenCalled();
      expect(accessResumeMock).toHaveBeenCalledWith({ token: 'resume123' });
      expect(resumeCalls).toEqual(['resume123']);
      expect(host.textContent).not.toContain('Unlock local agent');
      expect(host.textContent).toContain('activity main');
    } finally {
      dispose();
    }
  });
});


describe('EnvAppShell remote access gate', () => {
  it('waits for password unlock before connecting the remote agent', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      expect(host.textContent).toContain('Unlock agent');
      expect(connectMock).not.toHaveBeenCalled();
      expect(getEnvironmentMock).not.toHaveBeenCalled();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      expect(unlockGatewayAccessMock).toHaveBeenCalledWith('secret');
      expect(getGatewayAccessStatusMock).toHaveBeenCalledTimes(2);
      expect(connectMock).toHaveBeenCalledTimes(1);
      const remoteConnectConfig = connectMock.mock.calls[0]?.[0];
      expect(remoteConnectConfig).toMatchObject({
        mode: 'tunnel',
        observer: expect.any(Object),
        getGrant: expect.any(Function),
        autoReconnect: {
          enabled: true,
          maxAttempts: 1_000_000,
          initialDelayMs: 500,
          maxDelayMs: 30_000,
        },
      });
      expect(accessResumeMock).toHaveBeenCalledWith({ token: 'resume123' });
      expect(host.textContent).toContain('activity main');
      expect(host.textContent).not.toContain('Unlock agent');
    } finally {
      dispose();
    }
  });
});
