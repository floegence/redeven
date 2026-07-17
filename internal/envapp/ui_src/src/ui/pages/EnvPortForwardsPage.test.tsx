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

const localApiMocks = vi.hoisted(() => ({
  fetchLocalApiJSON: vi.fn(),
}));

const controlplaneMocks = vi.hoisted(() => ({
  getLocalRuntime: vi.fn(),
  getEnvPublicIDFromSession: vi.fn(),
  mintEnvEntryTicketForApp: vi.fn(),
}));

const desktopContextMocks = vi.hoisted(() => ({
  readDesktopSessionContextSnapshot: vi.fn(),
}));

const sandboxWindowRegistryMocks = vi.hoisted(() => ({
  registerSandboxWindow: vi.fn(),
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
  SkeletonCard: (props: any) => <div class={props.class} data-testid="skeleton-card" />,
  SnakeLoader: () => <div data-testid="snake-loader" />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => (
    <button
      type="button"
      class={props.class}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      aria-busy={props['aria-busy']}
      title={props.title}
    >
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
  FLOE_APP_PORT_FORWARD: 'com.floegence.redeven.portforward',
}));

vi.mock('../services/localApi', () => ({
  fetchLocalApiJSON: localApiMocks.fetchLocalApiJSON,
}));

vi.mock('../services/sandboxOrigins', () => ({
  trustedLauncherOriginFromSandboxLocation: () => 'https://forward.test',
}));

vi.mock('../services/sandboxWindowRegistry', () => ({
  registerSandboxWindow: sandboxWindowRegistryMocks.registerSandboxWindow,
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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

function decodeBase64UrlJSON<T>(raw: string): T {
  const padded = raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (raw.length % 4)) % 4);
  return JSON.parse(atob(padded)) as T;
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
        target_route: 'remote_desktop',
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
        target_route: 'remote_desktop',
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
    sandboxWindowRegistryMocks.registerSandboxWindow.mockReset();
    envContextMocks.env = Object.assign(
      () => ({ permissions: { can_execute: true } }),
      { state: 'ready', loading: false, error: null },
    );
    localApiMocks.fetchLocalApiJSON.mockReset();
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
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
      throw new Error(`Unexpected local API call: ${url}`);
    });

    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('delays the quiet card skeleton for the initial web services request', async () => {
    vi.useFakeTimers();
    const forwardsRequest = deferred<{ forwards: any[] }>();
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/forwards') return forwardsRequest.promise;
      throw new Error(`Unexpected local API call: ${url}`);
    });
    const dispose = render(() => <EnvPortForwardsPage />, host);

    try {
      await flushMicrotasks();
      const listRegion = host.querySelector('[data-testid="web-services-list-region"]');
      expect(listRegion?.querySelector('.redeven-loading-curtain')).toBeNull();
      expect(host.querySelector('[data-testid="web-services-initial-loading"]')).toBeNull();

      await vi.advanceTimersByTimeAsync(149);
      expect(host.querySelector('[data-testid="web-services-initial-loading"]')).toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      expect(host.querySelector('[data-testid="web-services-initial-loading"]')).not.toBeNull();
      expect(host.querySelectorAll('[data-testid="skeleton-card"]')).toHaveLength(3);

      forwardsRequest.resolve({ forwards: [] });
      await flushMicrotasks();
      expect(host.querySelector('[data-testid="web-services-initial-loading"]')).toBeNull();
      expect(host.textContent).toContain('No web services yet');
    } finally {
      dispose();
      vi.useRealTimers();
    }
  });

  it('keeps cards and search state mounted while refreshing web services', async () => {
    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const currentCard = host.querySelector('[data-testid="port-forward-card"]');
    const searchInput = host.querySelector('input') as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();
    if (searchInput) {
      searchInput.value = 'Demo';
      searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Demo' }));
    }
    const forwardsRequest = deferred<{ forwards: any[] }>();
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/forwards') return forwardsRequest.promise;
      throw new Error(`Unexpected local API call: ${url}`);
    });

    const refreshButton = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement | null;
    expect(refreshButton).toBeTruthy();
    refreshButton?.click();
    await flushMicrotasks();

    expect(host.querySelector('[data-testid="port-forward-card"]')).toBe(currentCard);
    expect(host.querySelector('input')).toBe(searchInput);
    expect(searchInput?.value).toBe('Demo');
    expect(host.querySelector('[data-testid="web-services-list-region"]')?.getAttribute('aria-busy')).toBe('true');
    expect(refreshButton?.getAttribute('aria-busy')).toBe('true');
    expect(refreshButton?.querySelector('[data-testid="refresh-icon"]')?.className).toContain('animate-spin');
    expect(host.querySelector('[data-testid="web-services-initial-loading"]')).toBeNull();
    expect(host.querySelector('[data-testid="web-services-list-region"] .redeven-loading-curtain')).toBeNull();

    forwardsRequest.resolve({
      forwards: [
        {
          forward_id: 'forward-2',
          target_url: 'http://localhost:4000',
          name: 'Demo Forward Updated',
          description: 'Updated browser preview',
          health_path: '/healthz',
          insecure_skip_verify: false,
          created_at_unix_ms: 2,
          updated_at_unix_ms: 2,
          last_opened_at_unix_ms: 2,
          health: {
            status: 'healthy',
            last_checked_at_unix_ms: 2,
            latency_ms: 8,
            last_error: '',
          },
        },
      ],
    });
    await flushPage();

    expect(host.textContent).toContain('Demo Forward Updated');
    expect(searchInput?.value).toBe('Demo');
    expect(host.querySelector('[data-testid="web-services-list-region"]')?.getAttribute('aria-busy')).toBeNull();
    expect(refreshButton?.getAttribute('aria-busy')).toBeNull();
    expect(refreshButton?.querySelector('[data-testid="refresh-icon"]')?.className).not.toContain('animate-spin');
  });

  it('keeps the empty state mounted while refreshing web services', async () => {
    localApiMocks.fetchLocalApiJSON.mockResolvedValue({ forwards: [] });
    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const emptyTitle = Array.from(host.querySelectorAll('h3')).find((element) => element.textContent === 'No web services yet');
    expect(emptyTitle).toBeTruthy();
    const forwardsRequest = deferred<{ forwards: any[] }>();
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/forwards') return forwardsRequest.promise;
      throw new Error(`Unexpected local API call: ${url}`);
    });

    const refreshButton = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement | null;
    refreshButton?.click();
    await flushMicrotasks();

    expect(emptyTitle ? host.contains(emptyTitle) : false).toBe(true);
    expect(host.querySelector('[data-testid="web-services-initial-loading"]')).toBeNull();

    forwardsRequest.resolve({ forwards: [] });
    await flushPage();
    expect(host.textContent).toContain('No web services yet');
  });

  it('keeps the blocking curtain for opening a web service', async () => {
    const runtimeRequest = deferred<typeof localRuntime>();
    controlplaneMocks.getLocalRuntime.mockReturnValue(runtimeRequest.promise);
    const assign = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ location: { assign }, close: vi.fn() } as unknown as Window);
    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Open'));
    openButton?.click();
    await flushMicrotasks();

    expect(host.querySelector('.redeven-loading-curtain')).not.toBeNull();
    expect(host.textContent).toContain('Resolving route');

    runtimeRequest.resolve(localRuntime);
    await waitForAssertion(() => {
      expect(assign).toHaveBeenCalledWith('http://localhost:3000');
    });
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
      expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/forwards/forward-1/touch', { method: 'POST' });
      expect(assign).toHaveBeenCalledWith('http://localhost:3000');
    });
    expect(close).not.toHaveBeenCalled();
  });

  it('opens secure tunnel services with the canonical portforward app id', async () => {
    controlplaneMocks.getLocalRuntime.mockResolvedValue(null);
    const assign = vi.fn();
    const close = vi.fn();
    const popup = { location: { assign }, close } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Open'));
    expect(openButton).toBeTruthy();
    openButton?.click();

    await waitForAssertion(() => {
      expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/forwards/forward-1/touch', { method: 'POST' });
      expect(sandboxWindowRegistryMocks.registerSandboxWindow).toHaveBeenCalledWith(popup, {
        origin: 'https://forward.test',
        floe_app: 'com.floegence.redeven.portforward',
        code_space_id: 'forward-1',
        app_path: '/',
      });
      expect(controlplaneMocks.mintEnvEntryTicketForApp).toHaveBeenCalledWith({
        envId: 'env_demo',
        floeApp: 'com.floegence.redeven.portforward',
        codeSpaceId: 'forward-1',
      });
      expect(assign).toHaveBeenCalledTimes(1);
    });

    const openedURL = String(assign.mock.calls[0]?.[0] ?? '');
    const encoded = openedURL.split('#redeven=')[1] ?? '';
    expect(openedURL).toBe('https://forward.test/_redeven_boot/?env=env_demo#redeven=' + encoded);
    expect(decodeBase64UrlJSON<Record<string, unknown>>(encoded)).toMatchObject({
      v: 2,
      env_public_id: 'env_demo',
      floe_app: 'com.floegence.redeven.portforward',
      code_space_id: 'forward-1',
      app_path: '/',
      entry_ticket: 'entry-ticket',
    });
    expect(close).not.toHaveBeenCalled();
  });
});
