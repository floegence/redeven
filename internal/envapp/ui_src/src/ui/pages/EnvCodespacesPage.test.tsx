// @vitest-environment jsdom

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
  Panel: (props: any) => <div class={props.class}>{props.children}</div>,
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
  Dialog: (props: any) => (props.open ? <div>{props.children}{props.footer}</div> : null),
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

describe('EnvCodespacesPage', () => {
  let host: HTMLDivElement;

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
    gatewayMocks.fetchGatewayJSON.mockReset();
    gatewayMocks.fetchGatewayJSON.mockImplementation(async (url: string) => {
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

    const menuButtons = Array.from(host.querySelectorAll('button')).filter((button) => (
      button.textContent?.includes('Open in Terminal') || button.textContent?.includes('Ask Flower')
    ));
    expect(menuButtons.map((button) => button.textContent?.trim())).toEqual(['Open in Terminal', 'Ask Flower']);

    const askFlowerButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Ask Flower'));
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
});
