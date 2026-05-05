// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvCodespacesPage } from './EnvCodespacesPage';
import { buildAskFlowerComposerCopy } from '../utils/askFlowerComposerCopy';

const notificationMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

const envContextMocks = vi.hoisted(() => ({
  env: Object.assign(
    () => ({ permissions: { can_execute: true } }),
    { state: 'ready', loading: false, error: null },
  ),
  openAskFlowerComposer: vi.fn(),
  openTerminalInDirectory: vi.fn(),
}));

const protocolMocks = vi.hoisted(() => ({
  client: vi.fn(),
}));

const rpcMocks = vi.hoisted(() => ({
  fs: {
    getPathContext: vi.fn(),
    list: vi.fn(),
  },
}));

const gatewayMocks = vi.hoisted(() => ({
  fetchGatewayJSON: vi.fn(),
}));

const controlplaneMocks = vi.hoisted(() => ({
  getEnvPublicIDFromSession: vi.fn(),
  getLocalRuntime: vi.fn(),
  mintEnvEntryTicketForApp: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
  useNotification: () => notificationMocks,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Sparkles: (props: any) => <span class={props.class} data-testid="sparkles-icon" />,
  Terminal: (props: any) => <span class={props.class} data-testid="terminal-icon" />,
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  Panel: (props: any) => <div class={props.class} data-testid={props['data-testid']}>{props.children}</div>,
  PanelContent: (props: any) => <div class={props.class}>{props.children}</div>,
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (props.visible ? <div>{props.message}</div> : null),
  SnakeLoader: () => <div data-testid="snake-loader" />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" class={props.class} onClick={props.onClick} disabled={props.disabled} aria-label={props['aria-label']} title={props.title}>
      {props.children}
    </button>
  ),
  Card: (props: any) => (
    <div class={props.class} onContextMenu={props.onContextMenu} data-testid="codespace-card">
      {props.children}
    </div>
  ),
  CardContent: (props: any) => <div class={props.class}>{props.children}</div>,
  CardDescription: (props: any) => <div class={props.class} title={props.title}>{props.children}</div>,
  CardFooter: (props: any) => <div class={props.class}>{props.children}</div>,
  CardHeader: (props: any) => <div class={props.class}>{props.children}</div>,
  CardTitle: (props: any) => <div class={props.class}>{props.children}</div>,
  Dialog: (props: any) => <Show when={props.open}><div>{props.children}{props.footer}</div></Show>,
  DirectoryInput: (props: any) => <input value={props.value} onInput={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).value)} />,
  HighlightBlock: (props: any) => (
    <div
      class={['highlight-block', props.class].filter(Boolean).join(' ')}
      data-testid={props['data-testid']}
      data-highlight-variant={props.variant}
    >
      <div>{props.title}</div>
      {props.children}
    </div>
  ),
  Input: (props: any) => <input value={props.value} onInput={props.onInput} />,
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
  Tooltip: (props: any) => <>{props.children}</>,
  SurfaceFloatingLayer: (props: any) => {
    const { children, layerRef, position, class: className, style, ...rest } = props;
    return (
      <div
        ref={layerRef}
        class={className}
        style={{
          ...(style ?? {}),
          left: `${position?.x ?? 0}px`,
          top: `${position?.y ?? 0}px`,
        }}
        data-floe-local-interaction-surface="true"
        {...rest}
      >
        {children}
      </div>
    );
  },
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    client: protocolMocks.client,
  }),
}));

vi.mock('./EnvContext', () => ({
  useEnvContext: () => ({
    env: envContextMocks.env,
    openAskFlowerComposer: envContextMocks.openAskFlowerComposer,
    openTerminalInDirectory: envContextMocks.openTerminalInDirectory,
  }),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => rpcMocks,
}));

vi.mock('../services/controlplaneApi', () => ({
  getEnvPublicIDFromSession: controlplaneMocks.getEnvPublicIDFromSession,
  getLocalRuntime: controlplaneMocks.getLocalRuntime,
  mintEnvEntryTicketForApp: controlplaneMocks.mintEnvEntryTicketForApp,
}));

vi.mock('../services/floeproxyContract', () => ({
  FLOE_APP_CODE: 'com.floegence.redeven.code',
}));

vi.mock('../services/gatewayApi', () => ({
  fetchGatewayJSON: gatewayMocks.fetchGatewayJSON,
}));

vi.mock('../services/localAccessAuth', () => ({
  appendLocalAccessResumeQuery: (value: string) => value,
}));

vi.mock('../services/sandboxOrigins', () => ({
  trustedLauncherOriginFromSandboxLocation: () => 'https://codespace.test',
}));

vi.mock('../services/sandboxWindowRegistry', () => ({
  registerSandboxWindow: vi.fn(),
}));

vi.mock('../utils/directoryPickerTree', () => ({
  replacePickerChildren: vi.fn((prev: any) => prev),
  sortPickerFolderItems: vi.fn((items: any) => items),
  toPickerFolderItem: vi.fn(),
  toPickerTreeAbsolutePath: vi.fn(),
}));

async function flushPage(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForHostText(host: HTMLElement, text: string, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (host.textContent?.includes(text)) return;
    await flushPage();
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

function makeRuntimeStatus(overrides: any = {}): any {
  const sharedRoot = '/Users/test/.redeven/shared/code-server/darwin-arm64';
  const managedPrefix = '/Users/test/.redeven/local-environment/apps/code/runtime/managed';
  return {
    active_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
      version: '4.109.1',
      ...(overrides.active_runtime ?? {}),
    },
    managed_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
      version: '4.109.1',
      ...(overrides.managed_runtime ?? {}),
    },
    managed_prefix: overrides.managed_prefix ?? managedPrefix,
    shared_runtime_root: overrides.shared_runtime_root ?? sharedRoot,
    managed_runtime_version: overrides.managed_runtime_version ?? '4.109.1',
    managed_runtime_source: overrides.managed_runtime_source ?? 'managed',
    installed_versions: overrides.installed_versions ?? [
      {
        version: '4.109.1',
        binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
        selected_by_local_environment: true,
        removable: false,
        detection_state: 'ready',
      },
    ],
    installer_script_url: overrides.installer_script_url ?? 'https://code-server.dev/install.sh',
    operation: {
      state: 'idle',
      log_tail: [],
      ...(overrides.operation ?? {}),
    },
    updated_at_unix_ms: 1,
    ...overrides,
  };
}

describe('EnvCodespacesPage', () => {
  let host: HTMLDivElement;
  let runtimeStatusResponse: any;

  beforeEach(() => {
    notificationMocks.success.mockReset();
    notificationMocks.error.mockReset();
    envContextMocks.env = Object.assign(
      () => ({ permissions: { can_execute: true } }),
      { state: 'ready', loading: false, error: null },
    );
    envContextMocks.openAskFlowerComposer.mockReset();
    envContextMocks.openTerminalInDirectory.mockReset();
    protocolMocks.client.mockReset();
    protocolMocks.client.mockReturnValue(null);
    rpcMocks.fs.getPathContext.mockReset();
    rpcMocks.fs.list.mockReset();
    controlplaneMocks.getEnvPublicIDFromSession.mockReset();
    controlplaneMocks.getEnvPublicIDFromSession.mockReturnValue('env_local');
    controlplaneMocks.getLocalRuntime.mockReset();
    controlplaneMocks.getLocalRuntime.mockResolvedValue(null);
    controlplaneMocks.mintEnvEntryTicketForApp.mockReset();
    controlplaneMocks.mintEnvEntryTicketForApp.mockResolvedValue('entry-ticket-123');
    runtimeStatusResponse = makeRuntimeStatus();
    gatewayMocks.fetchGatewayJSON.mockReset();
    gatewayMocks.fetchGatewayJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/code-runtime/install') {
        runtimeStatusResponse = makeRuntimeStatus({
          ...runtimeStatusResponse,
          operation: {
            action: 'install',
            state: 'running',
            stage: 'installing',
            log_tail: ['Installing the latest stable release from GitHub.'],
          },
        });
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/code-runtime/cancel') {
        runtimeStatusResponse = makeRuntimeStatus({
          ...runtimeStatusResponse,
          operation: {
            action: 'install',
            state: 'cancelled',
            stage: '',
            log_tail: runtimeStatusResponse.operation?.log_tail ?? [],
          },
        });
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return {
          spaces: [
            {
              code_space_id: 'space-1',
              name: 'Demo Space',
              description: 'Workspace demo',
              workspace_path: '/workspace/demo',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: true,
              pid: 4242,
            },
          ],
        };
      }
      if (url === '/_redeven_proxy/api/spaces/space-1/start') {
        return {
          code_space_id: 'space-1',
          name: 'Demo Space',
          description: 'Workspace demo',
          workspace_path: '/workspace/demo',
          code_port: 13337,
          created_at_unix_ms: 1,
          updated_at_unix_ms: 1,
          last_opened_at_unix_ms: 1,
          running: true,
          pid: 4242,
        };
      }
      throw new Error(`Unexpected gateway call: ${url}`);
    });

    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    delete window.redevenDesktopShell;
    host.remove();
    document.body.innerHTML = '';
  });

  it('opens Ask Flower from a codespace card context menu with directory context copy', async () => {
    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;
    expect(card).toBeTruthy();

    card?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPage();

    const menu = host.querySelector('[role="menu"]') as HTMLDivElement | null;
    expect(menu).toBeTruthy();

    const menuButtons = Array.from(menu?.querySelectorAll('button') ?? []);
    expect(menuButtons.map((button) => button.textContent?.trim())).toEqual(['Ask Flower', 'Open in Terminal']);

    const askFlowerButton = menuButtons.find((button) => button.textContent?.includes('Ask Flower'));
    expect(askFlowerButton).toBeTruthy();

    askFlowerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPage();

    expect(envContextMocks.openAskFlowerComposer).toHaveBeenCalledTimes(1);
    const [intent, anchor] = envContextMocks.openAskFlowerComposer.mock.calls[0];
    expect(anchor).toEqual({ x: 40, y: 56 });
    expect(intent).toMatchObject({
      source: 'file_browser',
      mode: 'append',
      suggestedWorkingDirAbs: '/workspace/demo',
      contextItems: [
        {
          kind: 'file_path',
          path: '/workspace/demo',
          isDirectory: true,
        },
      ],
      pendingAttachments: [],
      notes: [],
    });
    expect(buildAskFlowerComposerCopy(intent).question).toBe('What would you like to explore inside it?');
  });

  it('shows install guidance when the code-server runtime is missing', async () => {
    runtimeStatusResponse = makeRuntimeStatus({
      active_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'none',
        binary_path: '',
      },
      managed_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'managed',
        binary_path: '',
      },
      installed_versions: [],
      managed_runtime_version: '',
      managed_runtime_source: 'none',
      operation: { state: 'idle', log_tail: [] },
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const banner = host.querySelector('[data-testid="code-runtime-banner"]') as HTMLDivElement | null;
    expect(banner).toBeTruthy();
    expect(banner?.dataset.bannerMode).toBe('inline');
    expect(banner?.querySelector('.highlight-block')).toBeTruthy();
    expect(banner?.querySelector('.highlight-block')?.getAttribute('data-highlight-variant')).toBe('warning');
    expect(banner?.textContent).toContain('code-server runtime');
    expect(banner?.textContent).toContain('Install and use for this Local Environment');
    expect(banner?.textContent).toContain('latest stable code-server');
  });

  it('shows a floating runtime toast while the initial runtime check is still running', async () => {
    let resolveRuntimeStatus!: (value: any) => void;

    gatewayMocks.fetchGatewayJSON.mockImplementation((url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return new Promise((resolve) => {
          resolveRuntimeStatus = resolve as (value: any) => void;
        });
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return Promise.resolve({
          spaces: [
            {
              code_space_id: 'space-1',
              name: 'Demo Space',
              description: 'Workspace demo',
              workspace_path: '/workspace/demo',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: true,
              pid: 4242,
            },
          ],
        });
      }
      throw new Error(`Unexpected gateway call: ${url}`);
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const banner = host.querySelector('[data-testid="code-runtime-banner"]') as HTMLDivElement | null;
    expect(banner).toBeTruthy();
    expect(banner?.dataset.bannerMode).toBe('floating');
    expect(banner?.className).toContain('fixed');
    expect(banner?.textContent).toContain('Checking runtime');

    resolveRuntimeStatus(makeRuntimeStatus());
    await flushPage();

    expect(host.querySelector('[data-testid="code-runtime-banner"]')).toBeNull();
  });

  it('opens the explicit install dialog instead of starting a codespace when runtime is missing', async () => {
    runtimeStatusResponse = makeRuntimeStatus({
      active_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'none',
        binary_path: '',
      },
      managed_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'managed',
        binary_path: '',
      },
      installed_versions: [],
      managed_runtime_version: '',
      managed_runtime_source: 'none',
      operation: { state: 'idle', log_tail: [] },
    });

    gatewayMocks.fetchGatewayJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return {
          spaces: [
            {
              code_space_id: 'space-1',
              name: 'Demo Space',
              description: 'Workspace demo',
              workspace_path: '/workspace/demo',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: false,
              pid: 0,
            },
          ],
        };
      }
      throw new Error(`Unexpected gateway call: ${url}`);
    });

    const windowOpenSpy = vi.spyOn(window, 'open');
    windowOpenSpy.mockImplementation(() => null);

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const startButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Start');
    expect(startButton).toBeTruthy();

    startButton?.click();
    await waitForHostText(host, 'Demo Space');
    expect(gatewayMocks.fetchGatewayJSON.mock.calls.filter(([url]) => url === '/_redeven_proxy/api/code-runtime/status').length).toBeGreaterThanOrEqual(2);
    await waitForHostText(host, 'Pending action: Start codespace after install');

    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(gatewayMocks.fetchGatewayJSON).not.toHaveBeenCalledWith('/_redeven_proxy/api/spaces/space-1/start', expect.anything());
    expect(host.textContent).toContain('Install and use for this Local Environment');
    expect(host.textContent).toContain('Pending action: Start codespace after install');

    windowOpenSpy.mockRestore();
  });

  it('opens a local-runtime codespace in the system browser when the desktop shell bridge is available', async () => {
    controlplaneMocks.getLocalRuntime.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
    });
    const openExternalURLBridge = vi.fn().mockResolvedValue({ ok: true });
    window.redevenDesktopShell = {
      openConnectionCenter: vi.fn().mockResolvedValue(undefined),
      openExternalURL: openExternalURLBridge,
    };

    const windowOpenSpy = vi.spyOn(window, 'open');
    windowOpenSpy.mockImplementation(() => null);

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Open');
    expect(openButton).toBeTruthy();

    openButton?.click();
    await flushPage();

    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(openExternalURLBridge).toHaveBeenCalledTimes(1);
    expect(openExternalURLBridge.mock.calls[0]?.[0]).toContain('/cs/space-1/?folder=%2Fworkspace%2Fdemo');
    expect(controlplaneMocks.mintEnvEntryTicketForApp).not.toHaveBeenCalled();

    windowOpenSpy.mockRestore();
  });

  it('opens a trusted-launcher codespace in the system browser when the desktop shell bridge is available', async () => {
    const openExternalURLBridge = vi.fn().mockResolvedValue({ ok: true });
    window.redevenDesktopShell = {
      openConnectionCenter: vi.fn().mockResolvedValue(undefined),
      openExternalURL: openExternalURLBridge,
    };

    const windowOpenSpy = vi.spyOn(window, 'open');
    windowOpenSpy.mockImplementation(() => null);

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Open');
    expect(openButton).toBeTruthy();

    openButton?.click();
    await flushPage();

    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(controlplaneMocks.mintEnvEntryTicketForApp).toHaveBeenCalledWith({
      envId: 'env_local',
      floeApp: 'com.floegence.redeven.code',
      codeSpaceId: 'space-1',
    });
    expect(openExternalURLBridge).toHaveBeenCalledTimes(1);
    const targetURL = String(openExternalURLBridge.mock.calls[0]?.[0] ?? '');
    expect(targetURL).toContain('https://codespace.test/_redeven_boot/?env=env_local#redeven=');

    windowOpenSpy.mockRestore();
  });

  it('falls back to the browser popup path when the desktop shell bridge is unavailable', async () => {
    controlplaneMocks.getLocalRuntime.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
    });

    const assign = vi.fn();
    const close = vi.fn();
    const popupWindow = {
      location: { assign },
      close,
    } as unknown as Window;
    const windowOpenSpy = vi.spyOn(window, 'open');
    windowOpenSpy.mockImplementation(() => popupWindow);

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Open');
    expect(openButton).toBeTruthy();

    openButton?.click();
    await flushPage();

    expect(windowOpenSpy).toHaveBeenCalledWith('about:blank', 'redeven_codespace_space-1');
    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0]?.[0] ?? '')).toContain('/cs/space-1/?folder=%2Fworkspace%2Fdemo');
    expect(close).not.toHaveBeenCalled();

    windowOpenSpy.mockRestore();
  });

  it('opens Terminal from a codespace card context menu with the absolute directory and preferred name', async () => {
    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;
    expect(card).toBeTruthy();

    card?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Open in Terminal'));
    expect(openButton).toBeTruthy();

    openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPage();

    expect(envContextMocks.openTerminalInDirectory).toHaveBeenCalledTimes(1);
    expect(envContextMocks.openTerminalInDirectory).toHaveBeenCalledWith('/workspace/demo', {
      preferredName: 'Demo Space',
      workbenchAnchor: { clientX: 40, clientY: 56 },
    });
  });

  it('keeps the codespace context menu inside the local surface host', async () => {
    render(() => (
      <div data-floe-dialog-surface-host="true">
        <EnvCodespacesPage />
      </div>
    ), host);
    await flushPage();

    const surfaceHost = host.querySelector('[data-floe-dialog-surface-host="true"]') as HTMLDivElement | null;
    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;
    expect(surfaceHost).toBeTruthy();
    expect(card).toBeTruthy();

    card?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPage();

    const menu = surfaceHost?.querySelector('[role="menu"]') as HTMLDivElement | null;
    const askFlowerButton = Array.from(menu?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Ask Flower')
    ) as HTMLButtonElement | undefined;
    expect(menu).toBeTruthy();
    expect(menu?.getAttribute('data-floe-local-interaction-surface')).toBe('true');
    expect(askFlowerButton).toBeTruthy();
  });

  it('hides Open in Terminal when execute permission is unavailable', async () => {
    envContextMocks.env = Object.assign(
      () => ({ permissions: { can_execute: false } }),
      { state: 'ready', loading: false, error: null },
    );

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;
    expect(card).toBeTruthy();

    card?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPage();

    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.includes('Open in Terminal'))).toBe(false);
    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.includes('Ask Flower'))).toBe(true);
  });

  it('closes the codespace context menu on Escape', async () => {
    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;
    expect(card).toBeTruthy();

    card?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPage();
    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.includes('Ask Flower'))).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPage();

    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.includes('Ask Flower'))).toBe(false);
  });

  it('uses semantic panel and card surface classes for the neutral codespace shell', async () => {
    gatewayMocks.fetchGatewayJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return {
          spaces: [
            {
              code_space_id: 'space-2',
              name: 'Stopped Space',
              description: 'Stopped workspace',
              workspace_path: '/workspace/stopped',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: false,
              pid: 0,
            },
          ],
        };
      }
      throw new Error(`Unexpected gateway call: ${url}`);
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const panel = host.querySelector('[data-testid="codespaces-panel"]') as HTMLDivElement | null;
    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;

    expect(panel?.className).toContain('redeven-surface-panel--strong');
    expect(card?.className).toContain('redeven-surface-panel--interactive');
    expect(card?.className).toContain('opacity-75');
  });
});
