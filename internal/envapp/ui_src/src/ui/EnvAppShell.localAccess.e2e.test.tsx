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
const refreshLocalRuntimeMock = vi.fn();
const reloadCurrentPageMock = vi.fn();
const commandState = vi.hoisted(() => ({
  open: vi.fn(),
  commands: [] as Array<Record<string, unknown>>,
}));
const notesOverlayState = vi.hoisted(() => ({
  lastProps: null as null | {
    open: boolean;
    onClose: () => void;
  },
}));

const connectMock = vi.fn(async (_config: Record<string, unknown>) => {
  protocolStatus = 'connected';
  protocolClient = { id: 'client-1' };
  protocolError = null;
});
const reconnectMock = vi.fn(async () => {
  protocolStatus = 'connected';
  protocolClient = { id: 'client-2' };
  protocolError = null;
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
let protocolError: unknown = null;
let resumeCalls: string[] = [];
let layoutIsMobile = false;
let sidebarActiveTabValue = 'deck';
const setSidebarActiveTabMock = vi.fn((tab: string) => {
  sidebarActiveTabValue = tab;
});
const setSidebarCollapsedMock = vi.fn();

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  deferAfterPaint: (fn: () => void) => setTimeout(fn, 0),
  useCommand: () => ({
    open: commandState.open,
    getKeybindDisplay: (keybind: string) => (keybind === 'mod+.' ? '⌘.' : keybind),
    registerAll: (commands: Array<Record<string, unknown>>) => {
      commandState.commands = commands;
      return () => {
        if (commandState.commands === commands) {
          commandState.commands = [];
        }
      };
    },
  }),
  useLayout: () => ({
    isMobile: () => layoutIsMobile,
    sidebarActiveTab: () => sidebarActiveTabValue,
    setSidebarActiveTab: setSidebarActiveTabMock,
    setSidebarCollapsed: setSidebarCollapsedMock,
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
  ActivityAppsMain: () => <div>activity main</div>,
  FloeRegistryRuntime: (props: any) => <>{props.children}</>,
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  BottomBarItem: (props: any) => <button type="button" class={props.class} onClick={props.onClick}>{props.children}</button>,
  Panel: (props: any) => <div>{props.children}</div>,
  PanelContent: (props: any) => <div>{props.children}</div>,
  Shell: (props: any) => (
    <div>
      <div data-testid="shell-sidebar" class={props.slotClassNames?.sidebar} />
      {props.logo}
      {props.topBarActions}
      <div>
        {Array.isArray(props.activityItems)
          ? props.activityItems.map((item: any) => (
              <button type="button" data-activity-id={item.id} onClick={item.onClick}>
                {item.label}
              </button>
            ))
          : null}
      </div>
      <div>
        {Array.isArray(props.activityBottomItems)
          ? props.activityBottomItems.map((item: any) => (
              <button type="button" data-activity-id={item.id} onClick={item.onClick}>
                {item.label}
              </button>
            ))
          : null}
      </div>
      {props.bottomBarItems}
      {props.children}
    </div>
  ),
  StatusIndicator: (props: any) => <div>{props.label ?? props.status}</div>,
  TopBarIconButton: (props: any) => (
    <button
      type="button"
      class={props.class}
      onClick={props.onClick}
      aria-label={props.label}
      data-tooltip={props.tooltip === false ? undefined : String(props.tooltip ?? props.label)}
    >
      {props.children}
    </button>
  ),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dropdown: (props: any) => <>{props.trigger}</>,
  Tooltip: (props: any) => <>{props.children}</>,
}));

vi.mock('./TopBarBrandButton', () => ({
  TopBarBrandButton: (props: any) => (
    <button
      type="button"
      class={props.class}
      onClick={props.onClick}
      aria-label={props.label}
      data-tooltip={props.tooltip === false ? undefined : String(props.tooltip ?? props.label)}
    >
      {props.children}
    </button>
  ),
}));

vi.mock('./notes/NotesOverlay', () => ({
  NotesOverlay: (props: any) => {
    notesOverlayState.lastProps = props;
    return <div data-testid="notes-overlay" data-open={String(props.open)} />;
  },
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
    error: () => protocolError,
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
  refreshLocalRuntime: refreshLocalRuntimeMock,
  unlockLocalAccess: unlockLocalAccessMock,
}));

vi.mock('./accessResume', () => ({
  consumeAccessResumeTokenFromWindow: () => '',
}));

vi.mock('./icons/FlowerIcon', () => ({ FlowerIcon: () => <span /> }));
vi.mock('./icons/CodexIcon', () => ({ CodexIcon: () => <span />, CodexNavigationIcon: () => <span /> }));
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
vi.mock('./widgets/AskFlowerComposerWindow', () => ({ AskFlowerComposerWindow: () => <div /> }));
vi.mock('./widgets/DetachedSurfaceScene', () => ({ DetachedSurfaceScene: () => <div /> }));
vi.mock('./widgets/FileBrowserSurfaceHost', () => ({ FileBrowserSurfaceHost: () => <div /> }));
vi.mock('./widgets/FilePreviewHost', () => ({ FilePreviewHost: () => <div /> }));
vi.mock('./utils/askFlowerContextTemplate', () => ({ buildAskFlowerDraftMarkdown: () => '' }));
vi.mock('./utils/askFlowerPath', () => ({ resolveSuggestedWorkingDirAbsolute: () => '' }));
vi.mock('./utils/windowNavigation', () => ({ reloadCurrentPage: reloadCurrentPageMock }));
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

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(String(key)) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(String(key));
    },
    setItem: (key: string, value: string) => {
      store.set(String(key), String(value));
    },
  } as Storage;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  commandState.commands = [];
  notesOverlayState.lastProps = null;
  protocolStatus = 'disconnected';
  protocolClient = null;
  protocolError = null;
  resumeCalls = [];
  layoutIsMobile = false;
  sidebarActiveTabValue = 'deck';
  setSidebarActiveTabMock.mockClear();
  setSidebarCollapsedMock.mockClear();
  reloadCurrentPageMock.mockReset();
  accessStatusMock.mockReset();
  accessStatusMock.mockImplementation(async () => ({ passwordRequired: true, unlocked: resumeCalls.length > 0 }));
  accessResumeMock.mockReset();
  accessResumeMock.mockImplementation(async ({ token }: { token: string }) => {
    resumeCalls.push(token);
  });
  getLocalRuntimeMock.mockResolvedValue({ mode: 'local', env_public_id: 'env_local', direct_ws_url: 'ws://localhost/_redeven_direct/ws' });
  refreshLocalRuntimeMock.mockResolvedValue({ mode: 'local', env_public_id: 'env_local', direct_ws_url: 'ws://localhost/_redeven_direct/ws' });
  getLocalAccessStatusMock.mockResolvedValue({ password_required: true, unlocked: false });
  unlockLocalAccessMock.mockResolvedValue({ unlocked: true, resume_token: 'resume123' });
  getGatewayAccessStatusMock
    .mockResolvedValueOnce({ password_required: true, unlocked: false })
    .mockResolvedValueOnce({ password_required: true, unlocked: true });
  unlockGatewayAccessMock.mockResolvedValue({ unlocked: true, resume_token: 'resume123' });
  getEnvironmentMock.mockResolvedValue({
    public_id: 'env_local',
    name: 'Local runtime',
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

describe('EnvAppShell top bar affordances', () => {
  it('renders Runtime Settings as the bottom activity action label', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();
      expect(host.textContent).toContain('Runtime Settings');
    } finally {
      dispose();
    }
  }, 10000);

  it('renders Switch Environment in the bottom activity area when the desktop bridge is available', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const openConnectionCenterMock = vi.fn().mockResolvedValue(undefined);
    window.redevenDesktopShell = {
      openConnectionCenter: openConnectionCenterMock,
    };

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.textContent).toContain('Switch Environment');
      const switchEnvironmentButton = host.querySelector('[data-activity-id="switch-environment"]');
      expect(switchEnvironmentButton).toBeTruthy();

      (switchEnvironmentButton as HTMLButtonElement).click();
      await flushAsync();

      expect(openConnectionCenterMock).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
      delete window.redevenDesktopShell;
    }
  });

  it('uses the dark-mode svg variant for the original redeven logo mark', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const logoImage = host.querySelector('img[alt="Redeven"]');
      expect(logoImage).toBeTruthy();
      expect(logoImage?.getAttribute('data-redeven-logo-theme')).toBe('dark');
      expect(logoImage?.getAttribute('src')).toContain('logo-dark.svg');
    } finally {
      dispose();
    }
  });

  it('keeps desktop top bar tooltips enabled for the shared icon actions', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getGatewayAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const notesButton = host.querySelector('button[aria-label="Notes overlay"]');
      const commandPaletteButton = host.querySelector('button[aria-label="Command palette"]');
      const toggleThemeButton = host.querySelector('button[aria-label="Toggle theme"]');

      expect(notesButton).toBeTruthy();
      expect(notesButton?.getAttribute('data-tooltip')).toBe('Notes overlay (⌘.)');
      expect(commandPaletteButton).toBeTruthy();
      expect(commandPaletteButton?.getAttribute('data-tooltip')).toBe('Command palette');
      expect(toggleThemeButton).toBeTruthy();
      expect(toggleThemeButton?.getAttribute('data-tooltip')).toBe('Toggle theme');
    } finally {
      dispose();
    }
  });

  it('keeps the notes entry available on mobile while disabling top bar tooltips', async () => {
    layoutIsMobile = true;
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getGatewayAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const notesButton = host.querySelector('button[aria-label="Notes overlay"]') as HTMLButtonElement | null;
      const toggleThemeButton = host.querySelector('button[aria-label="Toggle theme"]');
      expect(notesButton).toBeTruthy();
      expect(notesButton?.getAttribute('data-tooltip')).toBeNull();
      expect(notesOverlayState.lastProps?.open).toBe(false);

      notesButton?.click();
      await flushAsync();
      expect(notesOverlayState.lastProps?.open).toBe(true);

      expect(toggleThemeButton).toBeTruthy();
      expect(toggleThemeButton?.getAttribute('data-tooltip')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('toggles the notes overlay from the top bar and shared close callback', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getGatewayAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const notesButton = host.querySelector('button[aria-label="Notes overlay"]') as HTMLButtonElement | null;
      expect(notesButton).toBeTruthy();
      expect(notesOverlayState.lastProps?.open).toBe(false);

      notesButton?.click();
      await flushAsync();
      expect(notesOverlayState.lastProps?.open).toBe(true);

      notesOverlayState.lastProps?.onClose();
      await flushAsync();
      expect(notesOverlayState.lastProps?.open).toBe(false);
    } finally {
      dispose();
    }
  });

  it('registers a typing-safe notes toggle command', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getGatewayAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const notesCommand = commandState.commands.find((command) => command.id === 'redeven.env.toggleNotesOverlay') as
        | undefined
        | {
            keybind?: string;
            allowWhileTyping?: boolean;
            execute: () => void;
          };

      expect(notesCommand).toBeTruthy();
      expect(notesCommand?.keybind).toBe('mod+.');
      expect(notesCommand?.allowWhileTyping).toBe(true);
      expect(notesOverlayState.lastProps?.open).toBe(false);

      notesCommand?.execute();
      await flushAsync();
      expect(notesOverlayState.lastProps?.open).toBe(true);

      notesCommand?.execute();
      await flushAsync();
      expect(notesOverlayState.lastProps?.open).toBe(false);
    } finally {
      dispose();
    }
  });

  it('suppresses the desktop sidebar width transition for one frame when opening Codex from a full-screen tab', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getGatewayAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const shellSidebar = host.querySelector('[data-testid="shell-sidebar"]');
      const codexButton = findButtonByText(host, 'Codex');

      expect(shellSidebar?.className).not.toContain('transition-none');
      expect(codexButton).toBeTruthy();

      codexButton?.click();

      expect(setSidebarActiveTabMock).toHaveBeenCalledWith('codex', { openSidebar: true });
      expect(shellSidebar?.className).toContain('transition-none');

      await flushAsync();

      expect(shellSidebar?.className).not.toContain('transition-none');
    } finally {
      dispose();
    }
  });
});

describe('EnvAppShell local access gate', () => {
  it('shows a neutral checking gate while local access is still resolving', async () => {
    const accessDeferred = deferred<{ password_required: boolean; unlocked: boolean } | null>();
    getLocalAccessStatusMock.mockReturnValueOnce(accessDeferred.promise);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      expect(host.textContent).toContain('Preparing secure access');
      expect(host.textContent).toContain('Checking secure access...');
      expect(host.textContent).not.toContain('Unlock local runtime');
      expect(host.querySelector('input[type="password"]')).toBeFalsy();
      expect(connectMock).not.toHaveBeenCalled();

      accessDeferred.resolve({ password_required: true, unlocked: false });
      await flushAsync();
      await flushAsync();

      expect(host.textContent).toContain('Unlock local runtime');
      expect(host.querySelector('input[type="password"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('waits for password unlock before connecting the local runtime', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      expect(host.textContent).toContain('Unlock local runtime');
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
          maxAttempts: 3,
          initialDelayMs: 500,
          maxDelayMs: 3_000,
        },
      });
      expect(localConnectConfig).not.toHaveProperty('directInfo');
      expect(mintLocalDirectConnectInfoMock).not.toHaveBeenCalled();
      expect(accessResumeMock).not.toHaveBeenCalled();
      expect(resumeCalls).toEqual([]);
      expect(host.textContent).not.toContain('Unlock local runtime');
      expect(host.textContent).toContain('activity main');
      expect(host.textContent).not.toContain('Preparing secure session');
    } finally {
      dispose();
    }
  });

  it('labels the password field, links helper/error text, and restores focus after unlock failures', async () => {
    unlockLocalAccessMock.mockRejectedValueOnce(new Error('Wrong password.'));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const label = host.querySelector('label[for="redeven-access-password"]');
      const input = host.querySelector('#redeven-access-password') as HTMLInputElement | null;
      const help = host.querySelector('#redeven-access-password-help');
      const notice = host.querySelector('#redeven-access-notice');

      expect(label?.textContent).toContain('Access password');
      expect(input).toBeTruthy();
      expect(input?.getAttribute('aria-describedby')).toContain('redeven-access-password-help');
      expect(help?.textContent).toContain('Use the full Local UI password');
      expect(notice?.textContent).toContain('Password verification stays inside the runtime-managed session');

      input!.value = 'bad-secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      const error = host.querySelector('#redeven-access-error');
      expect(error?.getAttribute('role')).toBe('alert');
      expect(error?.textContent).toContain('Wrong password.');
      expect(input?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input);
    } finally {
      dispose();
    }
  });

  it('reuses an existing unlocked local session without prompting for password', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: true, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.textContent).not.toContain('Unlock local runtime');
      expect(host.querySelector('input[type="password"]')).toBeFalsy();
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(unlockLocalAccessMock).not.toHaveBeenCalled();
      expect(accessResumeMock).not.toHaveBeenCalled();
      expect(host.textContent).toContain('activity main');
    } finally {
      dispose();
    }
  });

  it('switches local direct reconnect into runtime waiting and reconnects after the runtime comes back', async () => {
    vi.useFakeTimers();
    getLocalAccessStatusMock.mockReset();
    getLocalAccessStatusMock
      .mockResolvedValueOnce({ password_required: true, unlocked: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ password_required: true, unlocked: true });
    connectMock.mockImplementationOnce(async () => {
      protocolStatus = 'error';
      protocolClient = null;
      protocolError = { code: 'AGENT_OFFLINE', status: 503, message: 'No agent connected' };
    });
    reconnectMock.mockImplementationOnce(async () => {
      protocolStatus = 'connected';
      protocolClient = { id: 'client-local-recovered' };
      protocolError = null;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.textContent).toContain('Waiting for runtime');

      await vi.advanceTimersByTimeAsync(12_000);
      await flushAsync();

      expect(getLocalAccessStatusMock.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(reconnectMock).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain('activity main');
    } finally {
      dispose();
    }
  });

  it('returns to the local password prompt after restart invalidates the local access session', async () => {
    vi.useFakeTimers();
    getLocalAccessStatusMock.mockReset();
    getLocalAccessStatusMock
      .mockResolvedValueOnce({ password_required: true, unlocked: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ password_required: true, unlocked: false });
    connectMock.mockImplementationOnce(async () => {
      protocolStatus = 'error';
      protocolClient = null;
      protocolError = { code: 'AGENT_OFFLINE', status: 503, message: 'No agent connected' };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.textContent).toContain('Waiting for runtime');

      await vi.advanceTimersByTimeAsync(12_000);
      await flushAsync();

      expect(host.textContent).toContain('Unlock local runtime');
      expect(host.textContent).toContain('Access password expired. Enter it again to continue.');
      expect(host.querySelector('input[type="password"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('restores the persisted Codex tab after refresh once permissions are ready', async () => {
    const storage = createStorageMock();
    storage.setItem('redeven_envapp_active_tab', 'codex');
    vi.stubGlobal('localStorage', storage);
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();
      await flushAsync();
      await flushAsync();
      await flushAsync();

      expect(setSidebarActiveTabMock).toHaveBeenCalledWith('deck', { openSidebar: false });
      expect(setSidebarActiveTabMock).toHaveBeenCalledWith('codex', { openSidebar: true });
      expect(sidebarActiveTabValue).toBe('codex');
      expect(storage.getItem('redeven_envapp_active_tab')).toBe('codex');
    } finally {
      dispose();
    }
  });
});


describe('EnvAppShell remote access gate', () => {
  it('shows a neutral checking gate while remote access is still resolving', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

    const accessDeferred = deferred<{ password_required: boolean; unlocked: boolean }>();
    getGatewayAccessStatusMock.mockReset();
    getGatewayAccessStatusMock.mockReturnValueOnce(accessDeferred.promise);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      expect(host.textContent).toContain('Preparing secure access');
      expect(host.textContent).toContain('Checking secure access...');
      expect(host.textContent).not.toContain('Unlock runtime');
      expect(host.querySelector('input[type="password"]')).toBeFalsy();
      expect(connectMock).not.toHaveBeenCalled();

      accessDeferred.resolve({ password_required: true, unlocked: false });
      await flushAsync();
      await flushAsync();

      expect(host.textContent).toContain('Unlock runtime');
      expect(host.querySelector('input[type="password"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('keeps the app blocked until access resume finishes', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

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
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

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
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

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
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');
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
      expect(host.textContent).toContain('Unlock runtime');
      expect(host.textContent).toContain('Access password expired. Enter it again to continue.');
      expect(host.querySelector('input[type="password"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('waits for password unlock before connecting the remote runtime', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      expect(host.textContent).toContain('Unlock runtime');
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
          maxAttempts: 3,
          initialDelayMs: 500,
          maxDelayMs: 3_000,
        },
      });
      expect(accessResumeMock).toHaveBeenCalledWith({ token: 'resume123' });
      expect(host.textContent).toContain('activity main');
      expect(host.textContent).not.toContain('Unlock runtime');
    } finally {
      dispose();
    }
  });

  it('switches to waiting-for-agent mode after remote reconnect exhausts fast retries and probes again later', async () => {
    vi.useFakeTimers();
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');
    accessStatusMock.mockResolvedValue({ passwordRequired: false, unlocked: true });
    getGatewayAccessStatusMock.mockReset();
    getGatewayAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    connectMock.mockImplementationOnce(async () => {
      protocolStatus = 'error';
      protocolClient = null;
      protocolError = { code: 'AGENT_OFFLINE', status: 503, message: 'No agent connected' };
    });
    getEnvironmentMock
      .mockResolvedValueOnce({
        public_id: 'env_demo',
        name: 'Remote runtime',
        namespace_public_id: 'ns_remote',
        status: 'offline',
        lifecycle_status: 'running',
        permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true },
      })
      .mockResolvedValueOnce({
        public_id: 'env_demo',
        name: 'Remote runtime',
        namespace_public_id: 'ns_remote',
        status: 'online',
        lifecycle_status: 'running',
        permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true },
      });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.textContent).toContain('Waiting for runtime');
      expect(findButtonByText(host, 'Retry now')).toBeTruthy();

      await vi.advanceTimersByTimeAsync(2_000);
      await flushAsync();

      expect(getEnvironmentMock).toHaveBeenCalled();
      expect(reconnectMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(3_000);
      await flushAsync();

      expect(reconnectMock).toHaveBeenCalledTimes(1);
      expect(protocolStatus).toBe('connected');
    } finally {
      dispose();
    }
  });
});
