// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EnvPortForwardsPage,
  isSupportedWebServiceTarget,
  resolveWebServiceOpenRoute,
} from './EnvPortForwardsPage';

const notificationMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

const envContextMocks = vi.hoisted(() => ({
  env: Object.assign(
    () => ({ permissions: { can_execute: true } }),
    { state: 'ready', loading: false, error: null },
  ),
}));

const gatewayMocks = vi.hoisted(() => ({
  fetchGatewayJSON: vi.fn(),
}));

const controlplaneMocks = vi.hoisted(() => ({
  getLocalRuntime: vi.fn(),
  getEnvPublicIDFromSession: vi.fn(),
  mintEnvEntryTicketForApp: vi.fn(),
}));

const desktopContextMocks = vi.hoisted(() => ({
  readDesktopSessionContextSnapshot: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
  useNotification: () => notificationMocks,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  ExternalLink: (props: any) => <span class={props.class} data-testid="external-link-icon" />,
  Globe: (props: any) => <span class={props.class} data-testid="globe-icon" />,
  Plus: (props: any) => <span class={props.class} data-testid="plus-icon" />,
  RefreshIcon: (props: any) => <span class={props.class} data-testid="refresh-icon" />,
  Trash: (props: any) => <span class={props.class} data-testid="trash-icon" />,
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
  Card: (props: any) => <div class={props.class} data-testid="port-forward-card">{props.children}</div>,
  CardContent: (props: any) => <div class={props.class}>{props.children}</div>,
  CardDescription: (props: any) => <div class={props.class} title={props.title}>{props.children}</div>,
  CardFooter: (props: any) => <div class={props.class}>{props.children}</div>,
  CardHeader: (props: any) => <div class={props.class}>{props.children}</div>,
  CardTitle: (props: any) => <div class={props.class}>{props.children}</div>,
  ConfirmDialog: (props: any) => (props.open ? <div>{props.children}</div> : null),
  Dialog: (props: any) => (props.open ? <div><h2>{props.title}</h2>{props.children}{props.footer}</div> : null),
  Input: (props: any) => <input value={props.value} onInput={props.onInput} onBlur={props.onBlur} class={props.class} placeholder={props.placeholder} />,
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
}));

vi.mock('../services/controlplaneApi', () => ({
  getLocalRuntime: controlplaneMocks.getLocalRuntime,
  getEnvPublicIDFromSession: controlplaneMocks.getEnvPublicIDFromSession,
  mintEnvEntryTicketForApp: controlplaneMocks.mintEnvEntryTicketForApp,
}));

vi.mock('../services/desktopSessionContext', () => ({
  readDesktopSessionContextSnapshot: desktopContextMocks.readDesktopSessionContextSnapshot,
}));

vi.mock('../services/floeproxyContract', () => ({
  FLOE_APP_PORT_FORWARD: 'com.floegence.redeven.port-forward',
}));

vi.mock('../services/gatewayApi', () => ({
  fetchGatewayJSON: gatewayMocks.fetchGatewayJSON,
}));

vi.mock('../services/sandboxOrigins', () => ({
  trustedLauncherOriginFromSandboxLocation: () => 'https://forward.test',
}));

vi.mock('../services/sandboxWindowRegistry', () => ({
  registerSandboxWindow: vi.fn(),
}));

vi.mock('../primitives/Tooltip', () => ({
  Tooltip: (props: any) => <>{props.children}</>,
}));

vi.mock('./EnvContext', () => ({
  useEnvContext: () => envContextMocks,
}));

async function flushPage(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 20; i += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushPage();
    }
  }
  throw lastError;
}

const localRuntime = {
  mode: 'local' as const,
  env_public_id: 'env_local',
};

describe('web service route helpers', () => {
  it('accepts the same target shapes as the backend normalizer', () => {
    expect(isSupportedWebServiceTarget('localhost:3000')).toBe(true);
    expect(isSupportedWebServiceTarget('http://localhost:3000')).toBe(true);
    expect(isSupportedWebServiceTarget('https://127.0.0.1')).toBe(true);
    expect(isSupportedWebServiceTarget('http://localhost:3000/path')).toBe(false);
    expect(isSupportedWebServiceTarget('ftp://localhost:3000')).toBe(false);
  });

  it('opens same-device local loopback targets directly', () => {
    expect(resolveWebServiceOpenRoute({
      forwardID: 'forward-1',
      targetURL: 'http://localhost:3000',
      localRuntime,
      desktopContext: {
        local_environment_id: 'local',
        renderer_storage_scope_id: 'local',
        target_kind: 'local_environment',
        target_route: 'local_host',
      },
      browserLocation: new URL('http://localhost:23998/_redeven_proxy/env') as any,
    })).toEqual({
      kind: 'browser_direct',
      url: 'http://localhost:3000',
      label: 'Direct',
    });
  });

  it('uses the Local UI proxy for URL and SSH contexts', () => {
    const browserLocation = new URL('http://localhost:24000/_redeven_proxy/env') as any;

    expect(resolveWebServiceOpenRoute({
      forwardID: 'forward-1',
      targetURL: 'http://localhost:3000',
      localRuntime,
      desktopContext: {
        local_environment_id: 'url:http://localhost:24000',
        renderer_storage_scope_id: 'url:http://localhost:24000',
        target_kind: 'external_local_ui',
      },
      browserLocation,
    })).toEqual({
      kind: 'local_proxy',
      url: 'http://localhost:24000/pf/forward-1/',
      label: 'Local proxy',
    });

    expect(resolveWebServiceOpenRoute({
      forwardID: 'forward-1',
      targetURL: 'http://localhost:3000',
      localRuntime,
      desktopContext: {
        local_environment_id: 'ssh:devbox',
        renderer_storage_scope_id: 'ssh:devbox',
        target_kind: 'ssh_environment',
      },
      browserLocation,
    }).kind).toBe('local_proxy');
  });

  it('uses the secure tunnel when the page is not in Local UI mode', () => {
    expect(resolveWebServiceOpenRoute({
      forwardID: 'forward-1',
      targetURL: 'http://localhost:3000',
      localRuntime: null,
      browserLocation: new URL('https://env-demo.example.invalid/_redeven_proxy/env') as any,
    })).toEqual({
      kind: 'e2ee_tunnel',
      forward_id: 'forward-1',
      label: 'Secure tunnel',
    });
  });
});

describe('EnvPortForwardsPage', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.restoreAllMocks();
    notificationMocks.success.mockReset();
    notificationMocks.error.mockReset();
    controlplaneMocks.getLocalRuntime.mockReset();
    controlplaneMocks.getLocalRuntime.mockResolvedValue(localRuntime);
    controlplaneMocks.getEnvPublicIDFromSession.mockReset();
    controlplaneMocks.getEnvPublicIDFromSession.mockReturnValue('env_demo');
    controlplaneMocks.mintEnvEntryTicketForApp.mockReset();
    controlplaneMocks.mintEnvEntryTicketForApp.mockResolvedValue('entry-ticket');
    desktopContextMocks.readDesktopSessionContextSnapshot.mockReset();
    desktopContextMocks.readDesktopSessionContextSnapshot.mockReturnValue({
      local_environment_id: 'local',
      renderer_storage_scope_id: 'local',
      target_kind: 'local_environment',
      target_route: 'local_host',
    });
    envContextMocks.env = Object.assign(
      () => ({ permissions: { can_execute: true } }),
      { state: 'ready', loading: false, error: null },
    );
    gatewayMocks.fetchGatewayJSON.mockReset();
    gatewayMocks.fetchGatewayJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/forwards') {
        return {
          forwards: [
            {
              forward_id: 'forward-1',
              target_url: 'http://localhost:3000',
              name: 'Demo Forward',
              description: 'Browser preview',
              health_path: '/healthz',
              insecure_skip_verify: false,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              health: {
                status: 'unknown',
                last_checked_at_unix_ms: 0,
                latency_ms: 0,
                last_error: '',
              },
            },
          ],
        };
      }
      if (url === '/_redeven_proxy/api/forwards/forward-1/touch') {
        return { forward_id: 'forward-1' };
      }
      throw new Error(`Unexpected gateway call: ${url}`);
    });

    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('uses semantic panel and card surface classes for neutral forward shells', async () => {
    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const panel = host.querySelector('[data-testid="web-services-panel"]') as HTMLDivElement | null;
    const card = host.querySelector('[data-testid="port-forward-card"]') as HTMLDivElement | null;

    expect(panel?.className).toContain('redeven-surface-panel--strong');
    expect(card?.className).toContain('redeven-surface-panel--interactive');
  });

  it('uses Web Services copy for the product surface', async () => {
    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    expect(host.textContent).toContain('Web Services');
    expect(host.textContent).toContain('Add Service');
    expect(host.textContent).not.toContain('Port Forwards');
  });

  it('opens a same-device local service directly after touching it', async () => {
    const assign = vi.fn();
    const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ location: { assign }, close } as unknown as Window);

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Open'));
    expect(openButton).toBeTruthy();
    openButton?.click();

    await waitForAssertion(() => {
      expect(gatewayMocks.fetchGatewayJSON).toHaveBeenCalledWith('/_redeven_proxy/api/forwards/forward-1/touch', { method: 'POST' });
      expect(assign).toHaveBeenCalledWith('http://localhost:3000');
    });
    expect(close).not.toHaveBeenCalled();
  });
});
