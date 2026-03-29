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
  Input: (props: any) => <input value={props.value} onInput={props.onInput} />,
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
  Tooltip: (props: any) => <>{props.children}</>,
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
  getEnvPublicIDFromSession: vi.fn(),
  getLocalRuntime: vi.fn(),
  mintEnvEntryTicketForApp: vi.fn(),
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
    runtimeStatusResponse = {
      supported_version: '4.108.2',
      detection_state: 'ready',
      install_state: 'idle',
      managed: true,
      source: 'managed',
      binary_path: '/Users/test/.redeven/apps/code/runtime/managed/bin/code-server',
      installed_version: '4.108.2',
      managed_prefix: '/Users/test/.redeven/apps/code/runtime/managed',
      installer_script_url: 'https://raw.githubusercontent.com/coder/code-server/v4.108.2/install.sh',
      updated_at_unix_ms: 1,
      log_tail: [],
    };
    gatewayMocks.fetchGatewayJSON.mockReset();
    gatewayMocks.fetchGatewayJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/code-runtime/install') {
        runtimeStatusResponse = {
          ...runtimeStatusResponse,
          install_state: 'running',
          install_stage: 'installing',
          log_tail: ['Installing v4.108.2 of the arm64 release from GitHub.'],
        };
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/code-runtime/cancel') {
        runtimeStatusResponse = {
          ...runtimeStatusResponse,
          install_state: 'cancelled',
          install_stage: '',
        };
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
    runtimeStatusResponse = {
      ...runtimeStatusResponse,
      detection_state: 'missing',
      install_state: 'idle',
      managed: false,
      source: 'none',
      binary_path: '',
      installed_version: '',
    };

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const banner = host.querySelector('[data-testid="code-runtime-banner"]') as HTMLDivElement | null;
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('code-server runtime');
    expect(banner?.textContent).toContain('Install code-server');
    expect(banner?.textContent).toContain('Supported version 4.108.2');
  });

  it('opens the explicit install dialog instead of starting a codespace when runtime is missing', async () => {
    runtimeStatusResponse = {
      ...runtimeStatusResponse,
      detection_state: 'missing',
      install_state: 'idle',
      managed: false,
      source: 'none',
      binary_path: '',
      installed_version: '',
    };

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
    expect(host.textContent).toContain('Install code-server');
    expect(host.textContent).toContain('Pending action: Start codespace after install');

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
    expect(envContextMocks.openTerminalInDirectory).toHaveBeenCalledWith('/workspace/demo', { preferredName: 'Demo Space' });
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
