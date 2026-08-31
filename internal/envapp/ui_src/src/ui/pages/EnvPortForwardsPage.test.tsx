// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CreateForwardDialog,
  EnvPortForwardsPage,
  ForwardMetadataDialog,
  ManagedServiceRow,
  isSupportedWebServiceTarget,
  resolveWebServiceOpenRoute,
  validateTemplateDraft,
} from './EnvPortForwardsPage';

const notificationMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

const envContextMocks = vi.hoisted(() => ({
  env_id: () => 'env_demo',
  goActivity: vi.fn(),
  env: Object.assign(
    () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }),
    { state: 'ready', loading: false, error: null },
  ),
}));

const localApiMocks = vi.hoisted(() => ({
  fetchLocalApi: vi.fn(),
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

const redevenRpcMocks = vi.hoisted(() => ({
  fs: { list: vi.fn(async () => ({ entries: [] })) },
}));

const sandboxWindowRegistryMocks = vi.hoisted(() => ({
  registerSandboxWindow: vi.fn(),
}));

const containerNavigationMocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
  useNotification: () => notificationMocks,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  AlertTriangle: (props: any) => <span class={props.class} data-testid="alert-triangle-icon" />,
  ExternalLink: (props: any) => <span class={props.class} data-testid="external-link-icon" />,
  Globe: (props: any) => <span class={props.class} data-testid="globe-icon" />,
  Plus: (props: any) => <span class={props.class} data-testid="plus-icon" />,
  RefreshIcon: (props: any) => <span class={props.class} data-testid="refresh-icon" />,
  Save: (props: any) => <span class={props.class} data-testid="save-icon" />,
  Search: (props: any) => <span class={props.class} data-testid="search-icon" />,
  Trash: (props: any) => <span class={props.class} data-testid="trash-icon" />,
  Play: (props: any) => <span class={props.class} data-testid="play-icon" />,
  Stop: (props: any) => <span class={props.class} data-testid="stop-icon" />,
  Refresh: (props: any) => <span class={props.class} data-testid="restart-icon" />,
  FileText: (props: any) => <span class={props.class} data-testid="file-text-icon" />,
  FolderOpen: (props: any) => <span class={props.class} data-testid="folder-open-icon" />,
  ShieldCheck: (props: any) => <span class={props.class} data-testid="shield-check-icon" />,
  Copy: (props: any) => <span class={props.class} data-testid="copy-icon" />,
  Pencil: (props: any) => <span class={props.class} data-testid="pencil-icon" />,
  CheckCircle: (props: any) => <span class={props.class} data-testid="check-circle-icon" />,
  ChevronDown: (props: any) => <span class={props.class} data-testid="chevron-down-icon" />,
  Cpu: (props: any) => <span class={props.class} data-testid="cpu-icon" />,
  Layers: (props: any) => <span class={props.class} data-testid="layers-icon" />,
  MoreHorizontal: (props: any) => <span class={props.class} data-testid="more-horizontal-icon" />,
  Package: (props: any) => <span class={props.class} data-testid="package-icon" />,
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
      type={props.type ?? 'button'}
      class={props.class}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      aria-busy={props['aria-busy']}
      title={props.title}
      data-testid={props['data-testid']}
    >
      {props.children}
    </button>
  ),
  Card: (props: any) => <div class={props.class} data-testid={props['data-testid'] ?? 'mock-card'} data-template-id={props['data-template-id']}>{props.children}</div>,
  CardContent: (props: any) => <div class={props.class}>{props.children}</div>,
  CardDescription: (props: any) => <div class={props.class} title={props.title}>{props.children}</div>,
  CardFooter: (props: any) => <div class={props.class}>{props.children}</div>,
  CardHeader: (props: any) => <div class={props.class}>{props.children}</div>,
  CardTitle: (props: any) => <div class={props.class}>{props.children}</div>,
  ConfirmDialog: (props: any) => (props.open ? <div>{props.children}</div> : null),
  Dialog: (props: any) => (props.open ? <div><h2>{props.title}</h2>{props.children}{props.footer}</div> : null),
  DirectoryPicker: (props: any) => <Show when={props.open}><div data-testid="managed-workspace-picker-mock"><h2>{props.title}</h2><button type="button" onClick={() => { props.onSelect('/Users/demo/Projects/Focused App'); props.onOpenChange(false); }}>Select focused folder</button></div></Show>,
  Dropdown: (props: any) => (
    <div>
      {props.trigger}
      {props.items?.map((item: any) => item.separator ? <hr /> : (
        <button type="button" title={item.label} disabled={item.disabled} onClick={() => props.onSelect?.(item.id)}>{item.label}</button>
      ))}
    </div>
  ),
  Input: (props: any) => <input id={props.id} value={props.value} onInput={props.onInput} onBlur={props.onBlur} class={props.class} placeholder={props.placeholder} aria-label={props['aria-label']} aria-invalid={props['aria-invalid']} aria-describedby={props['aria-describedby']} disabled={props.disabled} data-testid={props['data-testid']} data-template-field={props['data-template-field']} />,
  Textarea: (props: any) => <textarea id={props.id} value={props.value} onInput={props.onInput} class={props.class} disabled={props.disabled} placeholder={props.placeholder} aria-invalid={props['aria-invalid']} aria-describedby={props['aria-describedby']} data-template-field={props['data-template-field']} />,
  Checkbox: (props: any) => <label><input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange?.(event.currentTarget.checked)} />{props.label}</label>,
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
  fetchLocalApi: localApiMocks.fetchLocalApi,
  fetchLocalApiJSON: localApiMocks.fetchLocalApiJSON,
}));

vi.mock('../services/sandboxOrigins', () => ({
  trustedLauncherOriginFromSandboxLocation: () => 'https://forward.test',
}));

vi.mock('../services/sandboxWindowRegistry', () => ({
  registerSandboxWindow: sandboxWindowRegistryMocks.registerSandboxWindow,
}));

vi.mock('../services/containerResourceNavigation', () => ({
  requestContainerResourceNavigation: containerNavigationMocks.request,
}));

vi.mock('../primitives/Tooltip', () => ({
  Tooltip: (props: any) => <>{props.children}</>,
}));

vi.mock('../primitives/EnvAppModal', () => ({
  Dialog: (props: any) => <Show when={props.open}><div><h2>{props.title}</h2>{props.children}{props.footer}</div></Show>,
  ConfirmDialog: (props: any) => <Show when={props.open}><div><h2>{props.title}</h2>{props.children}<button type="button" disabled={props.loading} onClick={props.onConfirm}>{props.confirmText}</button></div></Show>,
}));

vi.mock('../primitives/EnvAppDrawer', () => ({
  EnvAppDrawer: (props: any) => <Show when={props.open}><div data-testid="env-app-drawer-mock"><h2>{props.title}</h2>{props.children}{props.footer}</div></Show>,
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({ session: () => ({}) }),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => redevenRpcMocks,
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
    expect(isSupportedWebServiceTarget('http://127.42.8.9:8080')).toBe(true);
    expect(isSupportedWebServiceTarget('http://[::1]:8080')).toBe(true);
    expect(isSupportedWebServiceTarget('3000/docs?tab=api')).toBe(true);
    expect(isSupportedWebServiceTarget('baidu.com')).toBe(false);
    expect(isSupportedWebServiceTarget('https://8.8.8.8')).toBe(false);
    expect(isSupportedWebServiceTarget('http://192.168.1.10:3000')).toBe(false);
    expect(isSupportedWebServiceTarget('http://127.example.com:3000')).toBe(false);
    expect(isSupportedWebServiceTarget('ftp://localhost:3000')).toBe(false);
  });

  it('uses the protected route for local targets without direct-access heuristics', () => {
    expect(resolveWebServiceOpenRoute({
      forwardID: 'forward-1',
      localRuntime,
      desktopContext: {
        local_environment_id: 'local',
        renderer_storage_scope_id: 'local',
        target_kind: 'local_environment',
        target_route: 'local_host',
      },
      browserLocation: new URL('http://localhost:23998/_redeven_proxy/env') as any,
    })).toEqual({
      kind: 'local_proxy',
      url: 'http://localhost:23998/pf/forward-1/',
      label: 'Local proxy',
    });

    expect(resolveWebServiceOpenRoute({
      forwardID: 'forward-1',
      appPath: '/docs?tab=api',
      localRuntime,
      desktopContext: {
        local_environment_id: 'local',
        renderer_storage_scope_id: 'local',
        target_kind: 'local_environment',
        target_route: 'local_host',
      },
      browserLocation: new URL('http://localhost:23998/_redeven_proxy/env') as any,
    })).toMatchObject({
      kind: 'local_proxy',
      url: 'http://localhost:23998/pf/forward-1/docs?tab=api',
    });
  });

  it('uses the Local UI proxy for URL and SSH contexts', () => {
    const browserLocation = new URL('http://localhost:24000/_redeven_proxy/env') as any;

    expect(resolveWebServiceOpenRoute({
      forwardID: 'forward-1',
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
      localRuntime,
      desktopContext: {
        local_environment_id: 'ssh:devbox',
        renderer_storage_scope_id: 'ssh:devbox',
        target_kind: 'ssh_environment',
        target_route: 'remote_desktop',
        document_transport: 'desktop_private_bridge_v2',
      },
      browserLocation,
    }).kind).toBe('local_proxy');
  });

  it('uses a root-mounted private origin for an isolated Desktop window', () => {
    expect(resolveWebServiceOpenRoute({
      forwardID: 'forward-1',
      appPath: '/docs?tab=api#intro',
      localRuntime,
      desktopContext: {
        local_environment_id: 'ssh:devbox',
        renderer_storage_scope_id: 'ssh:devbox',
        target_kind: 'ssh_environment',
        target_route: 'remote_desktop',
        document_transport: 'desktop_private_bridge_v2',
      },
      browserLocation: new URL('http://127.0.0.1:43123/_redeven_proxy/env') as any,
      desktopWindowAvailable: true,
    })).toEqual({
      kind: 'local_proxy',
      url: 'http://pf-forward-1.localhost:43123/docs?tab=api#intro',
      label: 'Local proxy',
    });
  });

  it('uses the secure tunnel when the page is not in Local UI mode', () => {
    expect(resolveWebServiceOpenRoute({
      forwardID: 'forward-1',
      localRuntime: null,
      browserLocation: new URL('https://env-demo.example.invalid/_redeven_proxy/env') as any,
    })).toEqual({
      kind: 'e2ee_tunnel',
      forward_id: 'forward-1',
      label: 'Secure tunnel',
    });
  });
});

describe('web service metadata and template validation', () => {
  it('requires a clear service name and submits edited metadata', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const submit = vi.fn();
    const dispose = render(() => (
      <ForwardMetadataDialog
        open
        mode="edit"
        editorKey="pf-one"
        initialName="Original service"
        initialDescription="Original description"
        loading={false}
        onOpenChange={() => undefined}
        onSubmit={submit}
      />
    ), host);
    try {
      const name = host.querySelector<HTMLInputElement>('#web-service-metadata-name')!;
      expect(name.value).toBe('Original service');
      name.value = '';
      name.dispatchEvent(new InputEvent('input', { bubbles: true }));
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Save changes')?.click();
      await flushPage();
      expect(submit).not.toHaveBeenCalled();
      expect(name.getAttribute('aria-invalid')).toBe('true');

      name.value = 'Team dashboard';
      name.dispatchEvent(new InputEvent('input', { bubbles: true }));
      const description = host.querySelector<HTMLTextAreaElement>('#web-service-metadata-description')!;
      description.value = 'Internal status and release dashboard';
      description.dispatchEvent(new InputEvent('input', { bubbles: true }));
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Save changes')?.click();
      expect(submit).toHaveBeenCalledWith('Team dashboard', 'Internal status and release dashboard', 'unified_proxy');
    } finally {
      dispose();
      host.remove();
    }
  });

  it('persists an explicit Desktop local access choice', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const submit = vi.fn();
    const dispose = render(() => (
      <ForwardMetadataDialog
        open
        mode="edit"
        editorKey="pf-local"
        initialName="DeepSeek Harness"
        initialDescription=""
        initialAccessMode="unified_proxy"
        targetURL="http://127.0.0.1:3080"
        loading={false}
        onOpenChange={() => undefined}
        onSubmit={submit}
      />
    ), host);
    try {
      host.querySelector<HTMLButtonElement>('[data-access-mode="desktop_loopback"]')?.click();
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Save changes')?.click();
      expect(submit).toHaveBeenCalledWith('DeepSeek Harness', '', 'desktop_loopback');
    } finally {
      dispose();
      host.remove();
    }
  });

  it('does not offer Desktop local compatibility for HTTPS services', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <ForwardMetadataDialog
        open
        mode="edit"
        editorKey="pf-https"
        initialName="Secure preview"
        initialDescription=""
        initialAccessMode="unified_proxy"
        targetURL="https://localhost:8443"
        loading={false}
        onOpenChange={() => undefined}
        onSubmit={() => undefined}
      />
    ), host);
    try {
      const loopback = host.querySelector<HTMLButtonElement>('[data-access-mode="desktop_loopback"]');
      expect(loopback?.disabled).toBe(true);
      expect(loopback?.textContent).toContain('only for HTTP services');
    } finally {
      dispose();
      host.remove();
    }
  });

  it('validates each deployment with one authoritative draft validator', () => {
    const base = {
      name: 'Dashboard', description: '', version: '1.0.0', scheme: 'http' as const,
      path: '/', healthPath: '/healthz', containerPort: '3000', installScript: '',
      startScript: '', stopScript: '', uninstallScript: '', image: '', entrypoint: '',
      command: '', environment: '', mainService: '', composeYAML: '',
    };
    expect(validateTemplateDraft({ ...base, kind: 'host' })).toMatchObject({ startScript: 'required' });
    expect(validateTemplateDraft({ ...base, kind: 'container', image: 'invalid image', containerPort: '70000' })).toMatchObject({ image: 'imageInvalid', containerPort: 'portInvalid' });
    expect(validateTemplateDraft({ ...base, kind: 'compose', mainService: 'bad service!', composeYAML: '' })).toMatchObject({ mainService: 'serviceNameInvalid', composeYAML: 'required' });
    expect(validateTemplateDraft({ ...base, kind: 'container', image: 'ghcr.io/acme/dashboard:1.0.0' })).toEqual({});
  });

  it('routes the container and image actions to their exact resource identities', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const openResource = vi.fn();
    const dispose = render(() => (
      <ManagedServiceRow
        service={{
          service_id: 'mws-one', template_id: 'linuxserver-webtop-ubuntu-kde', service_family_id: 'webtop-ubuntu',
          name: 'LinuxServer Webtop · Ubuntu (KDE Plasma)', template_source: 'builtin', brand_icon: 'ubuntu', deployment: 'container',
          workspace_path: '/workspace', version: '1', desired_state: 'running', observed_state: 'running', forward_id: 'pf-one', runtime_port: 3000,
          container_resources: [
            { kind: 'container', engine: 'docker', view: 'containers', identity: 'container-id' },
            { kind: 'image', engine: 'docker', view: 'images', identity: 'lscr.io/linuxserver/webtop@sha256:abc' },
          ],
          update_available: false,
        }}
        busy={false}
        canOpen
        canManage
        onOpen={() => undefined}
        onOpenResource={openResource}
        onAction={() => undefined}
        onUpdate={() => undefined}
        onLogs={() => undefined}
        onUninstall={() => undefined}
      />
    ), host);
    try {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Containers')?.click();
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Images')?.click();
      expect(openResource).toHaveBeenNthCalledWith(1, expect.objectContaining({ view: 'containers', identity: 'container-id' }));
      expect(openResource).toHaveBeenNthCalledWith(2, expect.objectContaining({ view: 'images', identity: 'lscr.io/linuxserver/webtop@sha256:abc' }));
    } finally {
      dispose();
      host.remove();
    }
  });

  it('keeps failed managed services on one row with one concise retry action', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const retry = vi.fn();
    const dispose = render(() => (
      <ManagedServiceRow
        service={{
          service_id: 'mws-failed', template_id: 'deepseek-harness-container', service_family_id: 'deepseek-harness',
          name: 'DeepSeek Harness', template_source: 'builtin', brand_icon: 'deepseek-harness', deployment: 'container',
          workspace_path: '/workspace', version: '0.1.1-rc.2', desired_state: 'running', observed_state: 'error',
          forward_id: 'pf-failed', runtime_port: 3000, last_error_code: 'IMAGE_PULL_FAILED', update_available: false,
        }}
        busy={false}
        canOpen
        canManage
        onOpen={() => undefined}
        onOpenResource={() => undefined}
        onAction={retry}
        onUpdate={() => undefined}
        onLogs={() => undefined}
        onUninstall={() => undefined}
      />
    ), host);
    try {
      const row = host.querySelector<HTMLElement>('[data-testid="managed-service-row"]')!;
      const retryButton = Array.from(row.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.trim() === 'Retry');

      expect(retryButton).toBeTruthy();
      expect(retryButton?.className).toContain('whitespace-nowrap');
      expect(retryButton?.querySelector('[data-testid="restart-icon"]')).toBeNull();
      expect(row.textContent).not.toContain('Failed');

      retryButton?.click();
      expect(retry).toHaveBeenCalledWith('retry_install');
    } finally {
      dispose();
      host.remove();
    }
  });

  it('replaces stale service status with contextual operation details', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const cancel = vi.fn();
    const dispose = render(() => (
      <ManagedServiceRow
        service={{
          service_id: 'mws-retry', template_id: 'deepseek-harness-container', service_family_id: 'deepseek-harness',
          name: 'DeepSeek Harness', template_source: 'builtin', brand_icon: 'deepseek-harness', deployment: 'docker',
          workspace_path: '/workspace', version: '0.1.1-rc.2', desired_state: 'running', observed_state: 'error',
          forward_id: 'pf-retry', runtime_port: 3000, update_available: false,
          operation_artifact_reference: 'ghcr.io/runzhliu/deepseek-harness:0.1.1-rc.2@sha256:reviewed',
        }}
        operation={{ operation_id: 'mop-retry', service_id: 'mws-retry', action: 'retry_install', state: 'running', stage: 'pulling', progress_current: 2, progress_total: 7 }}
        busy={false}
        canOpen
        canManage
        onOpen={() => undefined}
        onOpenResource={() => undefined}
        onAction={() => undefined}
        onCancelOperation={cancel}
        onUpdate={() => undefined}
        onLogs={() => undefined}
        onUninstall={() => undefined}
      />
    ), host);
    try {
      const row = host.querySelector<HTMLElement>('[data-testid="managed-service-row"]')!;
      const progress = row.querySelector<HTMLButtonElement>('[data-testid="managed-service-operation-trigger"]')!;
      const attached = row.querySelector<HTMLElement>('[data-testid="managed-operation-progress"]')!;
      expect(progress.textContent).toContain('Pulling image');
      expect(progress.textContent).toContain('2/7');
      expect(attached.textContent).toContain('Retry');
      expect(attached.textContent).toContain('Pulling image');
      expect(attached.textContent).not.toContain('DeepSeek Harness');
      expect(attached.querySelector('[data-testid="managed-operation-artifact"]')?.textContent).toContain('ghcr.io/runzhliu/deepseek-harness');
      expect(row.textContent).not.toContain('Error');
      expect(Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Retry')?.disabled).toBe(true);

      progress.click();
      const details = row.querySelector<HTMLElement>('[data-testid="managed-service-operation-details"]')!;
      expect(details.textContent).toContain('mop-retry');
      expect(details.textContent).toContain('Retry');
      expect(details.querySelector('[data-testid="managed-operation-artifact"]')?.textContent).toContain('ghcr.io/runzhliu/deepseek-harness');
      expect(details.querySelectorAll('[data-managed-operation-step]')).toHaveLength(7);
      expect(details.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2');
      Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Cancel operation')?.click();
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      dispose();
      host.remove();
    }
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
    containerNavigationMocks.request.mockReset();
    envContextMocks.goActivity.mockReset();
    envContextMocks.env = Object.assign(
      () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }),
      { state: 'ready', loading: false, error: null },
    );
    localApiMocks.fetchLocalApiJSON.mockReset();
    localApiMocks.fetchLocalApi.mockReset();
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

    const currentCard = host.querySelector('[data-testid="port-forward-row"]');
    const searchInput = host.querySelector('input[placeholder^="Search services"]') as HTMLInputElement | null;
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

    expect(host.querySelector('[data-testid="port-forward-row"]')).toBe(currentCard);
    expect(host.querySelector('input[placeholder^="Search services"]')).toBe(searchInput);
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

    const openButton = host.querySelector<HTMLButtonElement>('[data-testid="port-forward-row"] button');
    openButton?.click();
    await flushMicrotasks();

    expect(host.querySelector('.redeven-loading-curtain')).not.toBeNull();
    expect(host.textContent).toContain('Resolving route');

    runtimeRequest.resolve(localRuntime);
    await waitForAssertion(() => {
      expect(assign).toHaveBeenCalledWith('https://localhost/pf/forward-1/');
    });
  });

  it('uses one neutral collection surface instead of nested service panels', async () => {
    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const header = host.querySelector('[data-testid="web-services-panel"]') as HTMLDivElement | null;
    const list = host.querySelector('[data-testid="unified-web-services-list"]') as HTMLDivElement | null;
    const row = host.querySelector('[data-testid="port-forward-row"]') as HTMLDivElement | null;

    expect(header?.className).toContain('border-b');
    expect(list?.className).toContain('redeven-surface-panel');
    expect(row?.className).not.toContain('redeven-surface-panel');
  });

  it('keeps the primary Add Service action at the far right', async () => {
    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const templates = host.querySelector<HTMLButtonElement>('[data-testid="service-templates-button"]');
    const actions = templates?.parentElement?.querySelectorAll<HTMLButtonElement>(':scope > button');
    expect(templates).toBeTruthy();
    expect(actions?.item((actions?.length ?? 1) - 1)?.textContent).toContain('Add Service');
  });

  it('keeps the address launcher on the full content axis and lets its input shell fill the row', async () => {
    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const form = host.querySelector<HTMLElement>('[data-testid="web-service-address-form"]');
    const inputShell = host.querySelector<HTMLElement>('[data-testid="web-service-address-input-shell"]');

    expect(form?.className).toContain('w-full');
    expect(form?.className).not.toContain('max-w-3xl');
    expect(inputShell?.className).toContain('flex-1');
  });

  it('shows a managed DeepSeek Harness card without duplicating its protected forward', async () => {
    envContextMocks.env = Object.assign(
      () => ({ name: 'Build host', permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true } }),
      { state: 'ready', loading: false, error: null },
    );
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [{ service_id: 'mws-1', template_id: 'deepseek-harness-host', service_family_id: 'deepseek-harness', name: 'DeepSeek Harness · Host', deployment: 'native', workspace_path: '/workspace', version: '0.1.1-rc.2', desired_state: 'running', observed_state: 'running', forward_id: 'managed-forward', runtime_port: 3080 }] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [{ forward_id: 'managed-forward', target_url: 'http://127.0.0.1:3080', name: 'DeepSeek Harness', description: 'Managed by Redeven', health: { status: 'healthy', last_checked_at_unix_ms: 1, latency_ms: 2, last_error: '' }, created_at_unix_ms: 1, updated_at_unix_ms: 1, last_opened_at_unix_ms: 0 }] };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    expect(host.querySelectorAll('[data-testid="managed-service-row"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-testid="port-forward-row"]')).toHaveLength(0);
    expect(host.textContent).toContain('DeepSeek Harness');
    expect(host.textContent).toContain('Running');
  });

  it('hands a managed image destination to the single Containers navigation channel', async () => {
    const imageIdentity = 'lscr.io/linuxserver/webtop@sha256:abcdef';
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [{
        service_id: 'mws-webtop', template_id: 'linuxserver-webtop-ubuntu-kde', service_family_id: 'linuxserver-webtop-ubuntu-kde',
        name: 'LinuxServer Webtop · Ubuntu (KDE Plasma)', deployment: 'container', workspace_path: '/workspace', version: '654ea8e3-ls177',
        desired_state: 'running', observed_state: 'running', forward_id: 'managed-forward', runtime_port: 3000,
        container_resources: [{ kind: 'image', engine: 'docker', view: 'images', identity: imageIdentity }],
      }] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [{ forward_id: 'managed-forward', target_url: 'http://127.0.0.1:3000' }] };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await waitForAssertion(() => expect(host.querySelector('[data-testid="managed-service-row"]')).toBeTruthy());
    const imageAction = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="managed-service-row"] button'))
      .find((button) => button.textContent?.trim() === 'Images');
    imageAction?.click();

    expect(containerNavigationMocks.request).toHaveBeenCalledWith({
      engine: 'docker', endpointID: undefined, view: 'images', identity: imageIdentity,
    });
    expect(envContextMocks.goActivity).toHaveBeenCalledWith('containers');
  });

  it('opens a managed service through a route-safe browser session', async () => {
    const service = {
      service_id: 'mws-legacy',
      template_id: 'linuxserver-webtop-ubuntu-kde',
      service_family_id: 'linuxserver-webtop-ubuntu-kde',
      name: 'LinuxServer Webtop · Ubuntu (KDE Plasma)',
      description: 'Managed desktop',
      template_source: 'builtin',
      deployment: 'container',
      workspace_path: '/Users/demo/Redeven/workspaces/managed-services/linuxserver-webtop-ubuntu-kde',
      version: '654ea8e3-ls177',
      desired_state: 'running',
      observed_state: 'running',
      forward_id: 'pf_legacy_managed_service',
      runtime_port: 54945,
      update_available: false,
    };
    const assign = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ location: { assign }, close: vi.fn() } as unknown as Window);
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [service] };
      if (url === '/_redeven_proxy/api/forwards') {
        return { forwards: [{ forward_id: service.forward_id, target_url: 'http://127.0.0.1:54945', name: service.name, description: 'Managed by Redeven' }] };
      }
      if (url === '/_redeven_proxy/api/forward-sessions' && init?.method === 'POST') {
        return {
          forward: { forward_id: 'pf-route-safe-alias', target_url: 'http://127.0.0.1:54945' },
          app_path: '/',
          ephemeral: true,
        };
      }
      if (url === '/_redeven_proxy/api/forwards/pf-route-safe-alias/touch') return { forward_id: 'pf-route-safe-alias' };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await waitForAssertion(() => expect(host.querySelector('[data-testid="managed-service-row"]')).toBeTruthy());
    const openButton = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="managed-service-row"] button'))
      .find((button) => button.textContent?.trim() === 'Open');
    openButton?.click();

    await waitForAssertion(() => {
      expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/forward-sessions', {
        method: 'POST',
        body: JSON.stringify({ target: 'http://127.0.0.1:54945' }),
      });
      expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/forwards/pf-route-safe-alias/touch', { method: 'POST' });
      expect(assign).toHaveBeenCalledWith('https://localhost/pf/pf-route-safe-alias/');
    });
  });

  it('keeps service discovery and managed actions in one compact visual frame', async () => {
    envContextMocks.env = Object.assign(
      () => ({ permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true } }),
      { state: 'ready', loading: false, error: null },
    );
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [{ service_id: 'mws-1', template_id: 'linuxserver-webtop-ubuntu-kde', service_family_id: 'linuxserver-webtop-ubuntu-kde', name: 'LinuxServer Webtop · Ubuntu (KDE Plasma)', description: 'Managed desktop', template_source: 'builtin', brand_icon: 'ubuntu', deployment: 'container', workspace_path: '/Users/demo/Redeven/workspaces/managed-services/linuxserver-webtop-ubuntu-kde', version: '654ea8e3-ls177', desired_state: 'running', observed_state: 'running', forward_id: 'pf-managed', runtime_port: 54945, update_available: false }] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [{ forward_id: 'pf-managed', target_url: 'http://127.0.0.1:54945', name: 'Webtop', description: 'Managed by Redeven' }] };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await waitForAssertion(() => expect(host.querySelector('[data-testid="managed-service-row"]')).toBeTruthy());

    const collection = host.querySelector<HTMLElement>('[data-testid="web-services-collection"]');
    const search = host.querySelector<HTMLElement>('[data-testid="web-services-search"]');
    const toolbarActions = host.querySelector<HTMLElement>('[data-testid="web-services-toolbar-actions"]');
    const refresh = host.querySelector<HTMLElement>('[data-testid="web-services-refresh"]');
    const list = host.querySelector<HTMLElement>('[data-testid="unified-web-services-list"]');
    const row = host.querySelector<HTMLElement>('[data-testid="managed-service-row"]');
    const workspace = host.querySelector<HTMLElement>('[data-testid="managed-service-workspace"]');
    const actions = host.querySelector<HTMLElement>('[data-testid="managed-service-actions"]');

    expect(collection?.parentElement?.className).toContain('max-w-5xl');
    expect(collection?.contains(search ?? null)).toBe(true);
    expect(collection?.contains(list ?? null)).toBe(true);
    expect(search?.className).toContain('sm:w-64');
    expect(toolbarActions?.className).toContain('sm:ml-auto');
    expect(toolbarActions?.contains(refresh ?? null)).toBe(true);
    expect(host.querySelector('[data-testid="web-services-panel"]')?.contains(refresh ?? null)).toBe(false);
    expect(list?.className).toContain('divide-y');
    expect(list?.className).not.toContain('grid');
    expect(row?.className).not.toContain('bg-[var(--redeven-status-success-soft)]');
    expect(workspace?.className).toContain('truncate');
    expect(actions?.className).toContain('grid-cols-[4.75rem_4.75rem_2rem]');
    expect(actions?.querySelector('[data-testid="managed-service-more"]')).toBeTruthy();
    expect(row?.querySelector('[data-template-brand="ubuntu"]')).toBeTruthy();
  });

  it('shows managed service status and read actions without lifecycle permission', async () => {
    envContextMocks.env = Object.assign(
      () => ({ permissions: { can_read: true, can_write: false, can_execute: false } }),
      { state: 'ready', loading: false, error: null },
    );
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [{ service_id: 'mws-readonly', template_id: 'deepseek-harness-host', service_family_id: 'deepseek-harness', name: 'DeepSeek Harness · Host', deployment: 'native', workspace_path: '/workspace', version: '0.1.1-rc.2', desired_state: 'running', observed_state: 'running', forward_id: 'managed-forward', runtime_port: 3080 }] };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await waitForAssertion(() => expect(host.querySelector('[data-testid="managed-service-row"]')).toBeTruthy());

    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="managed-service-row"] button'));
    expect(buttons.find((button) => button.textContent?.trim() === 'Open')?.disabled).toBe(true);
    expect(buttons.find((button) => button.textContent?.trim() === 'Stop')?.disabled).toBe(true);
    expect(buttons.find((button) => button.title === 'View logs')?.disabled).toBe(false);
    expect(buttons.find((button) => button.title === 'Uninstall')?.disabled).toBe(true);
  });

  it('disables Docker deployment when the runtime reports it unavailable', async () => {
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [{ template_id: 'deepseek-harness-host', service_family_id: 'deepseek-harness', name: 'DeepSeek Harness · Host', description: 'Host deployment', brand_icon: 'deepseek-harness', localization_key: 'deepSeekHarnessHost', source: 'builtin', deployment: 'native', revision: 1, duplicateable: true, editable: false, available: true, version: '0.1.1-rc.2', developer_preview: true, deployments: [{ deployment: 'native', available: true }], workspace_roots: [{ id: 'home', label: 'Home', path: '/workspace' }] }, { template_id: 'deepseek-harness-container', service_family_id: 'deepseek-harness', name: 'DeepSeek Harness · Container', description: 'Container deployment', brand_icon: 'deepseek-harness', localization_key: 'deepSeekHarnessContainer', source: 'builtin', deployment: 'docker', revision: 1, duplicateable: true, editable: false, available: false, reason_code: 'DOCKER_UNAVAILABLE', version: '0.1.1-rc.2', developer_preview: true, deployments: [{ deployment: 'docker', available: false, reason_code: 'DOCKER_UNAVAILABLE' }], workspace_roots: [{ id: 'home', label: 'Home', path: '/workspace' }] }] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();
    host.querySelector<HTMLButtonElement>('[data-testid="service-templates-button"]')?.click();
    await flushPage();
    const containerTab = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim().startsWith('Container templates'));
    containerTab?.click();
    await flushPage();
    const containerCard = document.querySelector('[data-template-id="deepseek-harness-container"]');
    const containerDetails = document.querySelector('[data-testid="service-template-details"][data-template-id="deepseek-harness-container"]');
    expect(containerCard).toBeTruthy();
    expect(containerDetails?.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.disabled).toBe(true);
    expect(containerDetails?.textContent).toContain('Docker is unavailable');
    expect(containerCard?.textContent).toContain('Run the reviewed community DeepSeek Harness image in Docker.');
    expect(containerCard?.className).not.toContain('opacity');
  });

  it('presents the catalog as grouped service identities without a catalog footer', async () => {
    const template = { template_id: 'deepseek-harness-host', service_family_id: 'deepseek-harness', name: 'DeepSeek Harness · Host', description: 'Host deployment', brand_icon: 'deepseek-harness', localization_key: 'deepSeekHarnessHost', source: 'builtin', deployment: 'native', revision: 1, duplicateable: true, editable: false, available: true, version: '0.1.1-rc.2', developer_preview: true, deployments: [{ deployment: 'native', available: true }], workspace_roots: [{ id: 'home', label: 'Home', path: '/workspace' }] };
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [template] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();
    host.querySelector<HTMLButtonElement>('[data-testid="service-templates-button"]')?.click();
    await flushPage();

    const drawer = host.querySelector<HTMLElement>('[data-testid="env-app-drawer-mock"]')!;
    expect(drawer.querySelectorAll('[data-testid="service-template-group"]')).toHaveLength(1);
    expect(drawer.textContent).toContain('Redeven built-in');
    expect(drawer.textContent).toContain('Run DeepSeek Harness directly in the current Environment.');
    expect(drawer.querySelector('[data-testid="deepseek-harness-logo"]')).toBeTruthy();
    expect(drawer.textContent).toContain('Ready to deploy');
    expect(Array.from(drawer.querySelectorAll<HTMLButtonElement>('button')).some((button) => button.textContent?.trim() === 'Cancel')).toBe(false);

    const newHostTemplate = Array.from(drawer.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'New host template');
    newHostTemplate?.click();
    await flushPage();
    expect(drawer.querySelector('h2')?.textContent).toBe('New service template');
    expect(drawer.textContent).toContain('Install script');
    expect(drawer.textContent).toContain('Save template');
    expect(drawer.querySelector<HTMLInputElement>('[data-template-field="name"]')?.placeholder).toBe('Team dashboard');
    expect(drawer.querySelector<HTMLTextAreaElement>('[data-template-field="startScript"]')?.placeholder).toContain('REDEVEN_SERVICE_PORT');
    expect(drawer.querySelector('label[for="template-editor-name"]')?.textContent).toContain('*');
    expect(drawer.querySelector('label[for="template-editor-start-script"]')?.textContent).toContain('*');

    const startScript = drawer.querySelector<HTMLTextAreaElement>('[data-template-field="startScript"]')!;
    startScript.value = '';
    startScript.dispatchEvent(new InputEvent('input', { bubbles: true }));

    Array.from(drawer.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Save template')?.click();
    await flushPage();
    expect(drawer.querySelector('[data-template-field="name"]')?.getAttribute('aria-invalid')).toBe('true');
    expect(drawer.querySelector('[data-template-field="startScript"]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('uses a space-free recommended workspace and preserves a custom path with spaces', async () => {
    const template = {
      template_id: 'deepseek-harness-host', service_family_id: 'deepseek-harness', name: 'DeepSeek Harness · Host', description: 'Host deployment',
      source: 'builtin', deployment: 'native', revision: 1, duplicateable: true, editable: false, available: true, version: '0.1.1-rc.2', developer_preview: true,
      deployments: [{ deployment: 'native', available: true }],
      default_workspace_path: '/Users/demo/Redeven/workspaces/managed-services/deepseek-harness',
      workspace_roots: [{ id: 'home', label: 'Home', path: '/Users/demo' }],
    };
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [template] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();
    host.querySelector<HTMLButtonElement>('[data-testid="service-templates-button"]')?.click();
    await flushPage();
    host.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.click();
    await flushPage();

    const workspace = host.querySelector<HTMLElement>('[data-testid="managed-workspace-path"]');
    expect(workspace?.dataset.path).toBe(template.default_workspace_path);
    expect(workspace?.dataset.path).not.toBe(template.workspace_roots[0]?.path);

    host.querySelector<HTMLButtonElement>('[data-testid="managed-workspace-picker-trigger"]')?.click();
    await flushPage();
    expect(host.querySelector('[data-testid="managed-workspace-picker-mock"]')).toBeTruthy();
    host.querySelector<HTMLButtonElement>('[data-testid="managed-workspace-picker-mock"] button')?.click();
    await flushPage();
    expect(workspace?.dataset.path).toBe('/Users/demo/Projects/Focused App');
    expect(host.textContent).toContain('The service can read and modify the selected folder.');

    const restore = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('Restore recommended workspace'));
    restore?.click();
    await flushPage();
    expect(workspace?.dataset.path).toBe(template.default_workspace_path);
  });

  it('presents both Webtop templates and requires the declared risk acknowledgement before install', async () => {
    const notice = {
      id: 'interactive-desktop-root-and-network',
      revision: 1,
      severity: 'warning',
      title_key: 'webServices.managed.notices.interactiveDesktopRoot.title',
      description_key: 'webServices.managed.notices.interactiveDesktopRoot.description',
      acknowledgement_required: true,
    };
    const templates = [
      {
        template_id: 'linuxserver-webtop-ubuntu-kde', service_family_id: 'linuxserver-webtop-ubuntu-kde', name: 'Unlocalized Ubuntu desktop', description: 'Unlocalized Ubuntu description',
        brand_icon: 'ubuntu', localization_key: 'linuxserverWebtopUbuntuKDE', source: 'builtin', deployment: 'container', revision: 1, duplicateable: false, editable: false, available: true,
        version: '654ea8e3-ls177', developer_preview: false, notices: [notice], deployments: [{ deployment: 'container', available: true }],
        default_workspace_path: '/Users/demo/Redeven/workspaces/managed-services/linuxserver-webtop-ubuntu-kde', workspace_roots: [{ id: 'home', label: 'Home', path: '/Users/demo' }],
      },
      {
        template_id: 'linuxserver-webtop-debian-xfce', service_family_id: 'linuxserver-webtop-debian-xfce', name: 'Unlocalized Debian desktop', description: 'Unlocalized Debian description',
        brand_icon: 'debian', localization_key: 'linuxserverWebtopDebianXFCE', source: 'builtin', deployment: 'container', revision: 1, duplicateable: false, editable: false, available: true,
        version: '7c4ebdc9-ls209', developer_preview: false, notices: [notice], deployments: [{ deployment: 'container', available: true }],
        default_workspace_path: '/Users/demo/Redeven/workspaces/managed-services/linuxserver-webtop-debian-xfce', workspace_roots: [{ id: 'home', label: 'Home', path: '/Users/demo' }],
      },
    ];
    let createBody: Record<string, any> | null = null;
    let installed = false;
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates };
      if (url === '/_redeven_proxy/api/managed-web-services' && init?.method === 'GET') return { services: installed ? [{ service_id: 'mws-webtop', service_family_id: templates[0].service_family_id, forward_id: 'managed-webtop' }] : [] };
      if (url === '/_redeven_proxy/api/managed-web-services' && init?.method === 'POST') {
        createBody = JSON.parse(String(init.body));
        installed = true;
        return {
          service: { service_id: 'mws-webtop', template_id: templates[0].template_id, service_family_id: templates[0].service_family_id, deployment: 'container', workspace_path: templates[0].default_workspace_path, version: templates[0].version, desired_state: 'running', observed_state: 'installing', forward_id: 'managed-webtop', runtime_port: 32100 },
          operation: { operation_id: 'mop-webtop-install', service_id: 'mws-webtop', state: 'pending', stage: 'environment_check', progress_current: 0, progress_total: 7 },
        };
      }
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(`event: snapshot\ndata: ${JSON.stringify({ operation_id: 'mop-webtop-install', service_id: 'mws-webtop', state: 'succeeded', stage: 'completed', progress_current: 7, progress_total: 7 })}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    vi.spyOn(window, 'open').mockReturnValue(null);

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();
    host.querySelector<HTMLButtonElement>('[data-testid="service-templates-button"]')?.click();
    await flushPage();
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Container templates'))?.click();
    await flushPage();

    expect(host.querySelector('[data-brand-icon="ubuntu"], [data-template-brand="ubuntu"]')).toBeTruthy();
    expect(host.querySelector('[data-brand-icon="debian"], [data-template-brand="debian"]')).toBeTruthy();
    expect(host.querySelector('[data-template-id="linuxserver-webtop-ubuntu-kde"]')?.textContent).toContain('LinuxServer Webtop · Ubuntu (KDE Plasma)');
    expect(host.querySelector('[data-template-id="linuxserver-webtop-debian-xfce"]')?.textContent).toContain('LinuxServer Webtop · Debian XFCE');
    host.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.click();
    await flushPage();

    expect(host.textContent).toContain('Container root access and outbound network');
    const install = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Install and start');
    expect(install?.disabled).toBe(true);
    host.querySelector<HTMLInputElement>('[data-testid="managed-template-notices"] input[type="checkbox"]')?.click();
    await flushPage();
    expect(install?.disabled).toBe(false);
    install?.click();

    await waitForAssertion(() => expect(createBody).toMatchObject({
      template_id: 'linuxserver-webtop-ubuntu-kde',
      workspace_path: templates[0].default_workspace_path,
      accepted_notice_revisions: { 'interactive-desktop-root-and-network': 1 },
    }));
  });

  it('hands an accepted install to its service row and lets the drawer close without cancelling', async () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const template = {
      template_id: 'custom-background-install', service_family_id: 'custom-background-install', name: 'Background dashboard', description: 'Dashboard service',
      source: 'custom', deployment: 'container', revision: 1, duplicateable: true, editable: true, available: true,
      version: '1.0.0', developer_preview: false, notices: [], deployments: [{ deployment: 'container', available: true }],
      default_workspace_path: '/Users/demo/Redeven/workspaces/managed-services/background-dashboard', workspace_roots: [{ id: 'home', label: 'Home', path: '/Users/demo' }],
      spec: { schema_version: 1, kind: 'container', endpoint: { scheme: 'http', path: '/', health_path: '/', startup_timeout_sec: 45 }, container: { image: 'ghcr.io/example/dashboard@sha256:reviewed' } },
    };
    const operation = {
      operation_id: 'mop-background-install', service_id: 'mws-background-install', action: 'install' as const,
      state: 'running', stage: 'pulling', progress_current: 2, progress_total: 7,
    };
    const service = {
      service_id: operation.service_id, template_id: template.template_id, service_family_id: template.service_family_id,
      template_source: 'custom', name: template.name, description: template.description, deployment: 'container',
      workspace_path: template.default_workspace_path, version: template.version, desired_state: 'running', observed_state: 'installing',
      forward_id: 'managed-background-install', runtime_port: 32101, access_mode: 'unified_proxy',
      operation_artifact_reference: template.spec.container.image, active_operation: operation,
    };
    let installed = false;
    let finished = false;
    let streamSignal: AbortSignal | undefined;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const createRequest = deferred<{ service: typeof service; operation: typeof operation }>();
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [template] };
      if (url === '/_redeven_proxy/api/managed-web-services' && init?.method === 'GET') {
        return { services: installed ? [{ ...service, observed_state: finished ? 'running' : service.observed_state, active_operation: finished ? undefined : operation }] : [] };
      }
      if (url === '/_redeven_proxy/api/managed-web-services' && init?.method === 'POST') return createRequest.promise;
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url.includes('/cancel') && init?.method === 'POST') throw new Error('Closing the drawer must not cancel deployment');
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockImplementation(async (_url: string, init?: RequestInit) => {
      streamSignal = init?.signal ?? undefined;
      return new Response(new ReadableStream({
        start(controller) {
          streamController = controller;
          controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(operation)}\n\n`));
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    const dispose = render(() => <EnvPortForwardsPage />, host);
    try {
      await flushPage();
      host.querySelector<HTMLButtonElement>('[data-testid="service-templates-button"]')?.click();
      await flushPage();
      Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Container templates'))?.click();
      await flushPage();
      host.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.click();
      await flushPage();

      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim().startsWith('Install'))?.click();

      await waitForAssertion(() => expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/managed-web-services', expect.objectContaining({ method: 'POST' })));
      const closeDrawer = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Close');
      expect(closeDrawer?.disabled).toBe(false);
      closeDrawer?.click();
      await flushMicrotasks();
      expect(host.querySelector('[data-testid="service-template-drawer"]')).toBeNull();

      installed = true;
      createRequest.resolve({ service, operation: { ...operation, state: 'pending', stage: 'environment_check', progress_current: 0 } });

      await waitForAssertion(() => expect(host.querySelector('[data-managed-service-id="mws-background-install"]')).toBeTruthy());
      const serviceRow = host.querySelector<HTMLElement>('[data-managed-service-id="mws-background-install"]')!;
      expect(serviceRow.querySelector('[data-testid="managed-service-operation-trigger"]')?.textContent).toContain('2/7');
      expect(serviceRow.querySelectorAll('[data-testid="managed-operation-progress"]')).toHaveLength(1);
      expect(streamSignal?.aborted).toBe(false);
      expect(localApiMocks.fetchLocalApiJSON.mock.calls.some(([url]) => String(url).includes('/cancel'))).toBe(false);

      finished = true;
      streamController?.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify({ ...operation, state: 'succeeded', stage: 'completed', progress_current: 7 })}\n\n`));
      streamController?.close();
      await waitForAssertion(() => {
        const updatedRow = host.querySelector<HTMLElement>('[data-managed-service-id="mws-background-install"]')!;
        expect(updatedRow.querySelector('[data-testid="managed-service-operation-trigger"]')).toBeNull();
        expect(updatedRow.textContent).toContain('Running');
      });
      expect(openWindow).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('uses the same managed operation chain for Webtop updates and sends the notice revision', async () => {
    const updateNotice = {
      id: 'interactive-desktop-root-and-network', revision: 2, severity: 'warning',
      title_key: 'webServices.managed.notices.interactiveDesktopRoot.title', description_key: 'webServices.managed.notices.interactiveDesktopRoot.description', acknowledgement_required: true,
    };
    const service = {
      service_id: 'mws-webtop', template_id: 'linuxserver-webtop-ubuntu-kde', service_family_id: 'linuxserver-webtop-ubuntu-kde',
      name: 'Unlocalized Webtop', description: 'Unlocalized description', localization_key: 'linuxserverWebtopUbuntuKDE', brand_icon: 'ubuntu', deployment: 'container',
      workspace_path: '/Users/demo/Redeven/workspaces/managed-services/linuxserver-webtop-ubuntu-kde', version: '654ea8e3-ls176', target_version: '654ea8e3-ls177', target_revision: 2,
      update_available: true, update_notices: [updateNotice], desired_state: 'running', observed_state: 'running', forward_id: 'managed-webtop', runtime_port: 32100,
    };
    let operationBody: Record<string, any> | null = null;
    let updated = false;
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [{ ...service, update_available: !updated, version: updated ? service.target_version : service.version }] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/managed-web-services/mws-webtop/operations' && init?.method === 'POST') {
        operationBody = JSON.parse(String(init.body));
        updated = true;
        return { operation_id: 'mop-webtop-update', service_id: 'mws-webtop', state: 'pending', stage: 'update_preparing', progress_current: 0, progress_total: 7 };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(`event: snapshot\ndata: ${JSON.stringify({ operation_id: 'mop-webtop-update', service_id: 'mws-webtop', state: 'succeeded', stage: 'completed', progress_current: 7, progress_total: 7 })}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    render(() => <EnvPortForwardsPage />, host);
    await waitForAssertion(() => expect(host.textContent).toContain('Update available'));
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="managed-service-row"] button')).find((button) => button.textContent?.trim() === 'Update')?.click();
    await flushPage();

    expect(host.querySelector('[data-testid="managed-service-update-dialog"]')?.textContent).toContain('Update from 654ea8e3-ls176 to 654ea8e3-ls177');
    const update = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Update' && button.disabled);
    expect(update).toBeTruthy();
    host.querySelector<HTMLInputElement>('[data-testid="managed-service-update-dialog"] input[type="checkbox"]')?.click();
    await flushPage();
    expect(update?.disabled).toBe(false);
    update?.click();

    await waitForAssertion(() => expect(operationBody).toMatchObject({
      action: 'update',
      accepted_notice_revisions: { 'interactive-desktop-root-and-network': 2 },
    }));
    await waitForAssertion(() => expect(notificationMocks.success).toHaveBeenCalledWith('Managed service updated', expect.any(String)));
  });

  it('searches the catalog using localized built-in identity copy', async () => {
    const templates = [
      { template_id: 'deepseek-harness-host', service_family_id: 'deepseek-harness', name: 'Unlocalized host name', description: 'Unlocalized host description', brand_icon: 'deepseek-harness', localization_key: 'deepSeekHarnessHost', source: 'builtin', deployment: 'native', revision: 1, duplicateable: true, editable: false, available: true, version: '0.1.1-rc.2', developer_preview: true, deployments: [{ deployment: 'native', available: true }], workspace_roots: [] },
      { template_id: 'custom-host', service_family_id: 'custom-host', name: 'Workspace dashboard', description: 'Internal status view', source: 'custom', deployment: 'host', revision: 1, duplicateable: true, editable: true, available: true, version: '1', developer_preview: false, deployments: [{ deployment: 'host', available: true }], workspace_roots: [] },
    ];
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();
    host.querySelector<HTMLButtonElement>('[data-testid="service-templates-button"]')?.click();
    await flushPage();
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search templates"]')!;
    search.value = 'directly';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flushPage();

    expect(host.querySelector('[data-template-id="deepseek-harness-host"]')).toBeTruthy();
    expect(host.querySelector('[data-template-id="custom-host"]')).toBeNull();
  });

  it('duplicates a built-in service template as an independent custom template', async () => {
    const source = { template_id: 'deepseek-harness-host', service_family_id: 'deepseek-harness', name: 'DeepSeek Harness · Host', description: 'Host deployment', brand_icon: 'deepseek-harness', localization_key: 'deepSeekHarnessHost', source: 'builtin', deployment: 'native', revision: 1, duplicateable: true, editable: false, available: true, version: '0.1.1-rc.2', developer_preview: true, deployments: [{ deployment: 'native', available: true }], workspace_roots: [{ id: 'home', label: 'Home', path: '/workspace' }] };
    let duplicateBody: Record<string, unknown> | null = null;
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [source] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/managed-web-service-templates/deepseek-harness-host/duplicate' && init?.method === 'POST') {
        duplicateBody = JSON.parse(String(init.body));
        return { ...source, template_id: 'tmpl-copy', service_family_id: 'family-copy', source: 'custom', editable: true, name: duplicateBody?.name };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();
    host.querySelector<HTMLButtonElement>('[data-testid="service-templates-button"]')?.click();
    await flushPage();
    document.querySelector<HTMLButtonElement>('button[title="Duplicate"]')?.click();
    await flushPage();
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Duplicate' && !button.title);
    confirm?.click();

    await waitForAssertion(() => expect(duplicateBody).toMatchObject({ name: 'DeepSeek Harness copy' }));
    expect(String((duplicateBody as Record<string, unknown> | null)?.request_id)).toMatch(/^envapp-/u);
  });

  it('preserves a duplicated host runtime bundle when saving template edits', async () => {
    const source = {
      template_id: 'tmpl-host-copy', service_family_id: 'family-copy', name: 'DeepSeek Harness host copy', description: 'Host deployment',
      source: 'custom', deployment: 'host', revision: 1, duplicateable: true, editable: true, available: true, version: '0.1.1-rc.2', developer_preview: false,
      deployments: [{ deployment: 'host', available: true }], workspace_roots: [{ id: 'home', label: 'Home', path: '/workspace' }],
      spec: { schema_version: 1, kind: 'host', endpoint: { scheme: 'http', path: '/', health_path: '/', startup_timeout_sec: 45 }, host: { start_script: 'exec "$REDEVEN_INSTALL_EXECUTABLE" web', runtime_bundle: 'deepseek-harness-0.1.1-rc.2-node-24.19.0' } },
    };
    let updateBody: Record<string, any> | null = null;
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [source] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/managed-web-service-templates/tmpl-host-copy' && init?.method === 'PUT') {
        updateBody = JSON.parse(String(init.body));
        return source;
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();
    host.querySelector<HTMLButtonElement>('[data-testid="service-templates-button"]')?.click();
    await flushPage();
    document.querySelector<HTMLButtonElement>('button[title="Edit template"]')?.click();
    await flushPage();
    const save = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Save template');
    save?.click();

    await waitForAssertion(() => expect(updateBody?.spec?.host?.runtime_bundle).toBe('deepseek-harness-0.1.1-rc.2-node-24.19.0'));
  });

  it('restores an active managed operation and exposes cancellation after a page reload', async () => {
    const activeOperation = { operation_id: 'mop-active', service_id: 'mws-1', action: 'retry_install' as const, state: 'running', stage: 'pulling', progress_current: 2, progress_total: 7 };
    const service = { service_id: 'mws-1', template_id: 'deepseek-harness', deployment: 'docker', workspace_path: '/workspace', version: '0.1.1-rc.2', desired_state: 'running', observed_state: 'installing', forward_id: 'managed-forward', runtime_port: 3080, operation_artifact_reference: 'ghcr.io/runzhliu/deepseek-harness:0.1.1-rc.2@sha256:reviewed', active_operation: activeOperation };
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [service] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/managed-web-service-operations/mop-active/cancel' && init?.method === 'POST') return { ...activeOperation, state: 'cancelling' };
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(activeOperation)}\n\n`));
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    const dispose = render(() => <EnvPortForwardsPage />, host);
    try {
      await waitForAssertion(() => expect(host.textContent).toContain('Pulling image'));
      const trigger = host.querySelector<HTMLButtonElement>('[data-testid="managed-service-operation-trigger"]')!;
      expect(trigger).toBeTruthy();
      expect(host.textContent).not.toContain('Error');
      trigger.click();
      expect(host.querySelector('[data-testid="managed-operation-artifact"]')?.textContent).toContain('ghcr.io/runzhliu/deepseek-harness');
      const cancel = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Cancel operation');
      expect(cancel).toBeTruthy();
      cancel?.click();
      await waitForAssertion(() => expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/managed-web-service-operations/mop-active/cancel', { method: 'POST' }));
    } finally {
      dispose();
    }
  });

  it('tracks every resumed service operation without a global list footer', async () => {
    const operationOne = { operation_id: 'mop-one', service_id: 'mws-one', action: 'retry_install' as const, state: 'running', stage: 'pulling', progress_current: 2, progress_total: 7 };
    const operationTwo = { operation_id: 'mop-two', service_id: 'mws-two', action: 'start' as const, state: 'running', stage: 'starting', progress_current: 4, progress_total: 7 };
    const services = [
      { service_id: 'mws-one', template_id: 'deepseek-harness-container', service_family_id: 'deepseek-harness', name: 'DeepSeek Harness', deployment: 'docker', workspace_path: '/one', version: '1', desired_state: 'running', observed_state: 'error', forward_id: 'pf-one', runtime_port: 3001, operation_artifact_reference: 'ghcr.io/runzhliu/deepseek-harness:0.1.1-rc.2@sha256:one', active_operation: operationOne },
      { service_id: 'mws-two', template_id: 'linuxserver-webtop-debian-xfce', service_family_id: 'webtop-two', name: 'Debian desktop', deployment: 'container', workspace_path: '/two', version: '1', desired_state: 'running', observed_state: 'stopped', forward_id: 'pf-two', runtime_port: 3002, operation_artifact_reference: 'lscr.io/linuxserver/webtop@sha256:two', active_operation: operationTwo },
      { service_id: 'mws-idle', template_id: 'custom-idle', service_family_id: 'idle', name: 'Idle service', deployment: 'container', workspace_path: '/idle', version: '1', desired_state: 'stopped', observed_state: 'stopped', forward_id: 'pf-idle', runtime_port: 3003 },
    ];
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockImplementation(async (url: string) => {
      const operation = url.includes('mop-one') ? operationOne : url.includes('mop-two') ? operationTwo : null;
      if (!operation) throw new Error(`Unexpected event stream: ${url}`);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(operation)}\n\n`));
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    const dispose = render(() => <EnvPortForwardsPage />, host);
    try {
      await waitForAssertion(() => expect(host.querySelectorAll('[data-testid="managed-service-operation-trigger"]')).toHaveLength(2));
      const rows = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="managed-service-row"]'));
      const firstRow = rows.find((row) => row.dataset.managedServiceId === 'mws-one')!;
      firstRow.querySelector<HTMLButtonElement>('[data-testid="managed-service-operation-trigger"]')?.click();
      expect(firstRow.querySelector('[data-testid="managed-operation-artifact"]')?.textContent).toContain('deepseek-harness');
      expect(rows.find((row) => row.dataset.managedServiceId === 'mws-idle')?.querySelector('[data-testid="managed-service-operation-trigger"]')).toBeNull();
      expect(localApiMocks.fetchLocalApi).toHaveBeenCalledWith(expect.stringContaining('mop-one/events'), expect.objectContaining({ method: 'GET' }));
      expect(localApiMocks.fetchLocalApi).toHaveBeenCalledWith(expect.stringContaining('mop-two/events'), expect.objectContaining({ method: 'GET' }));
      expect(host.querySelector('[data-testid="unified-web-services-list"]')?.parentElement?.querySelector(':scope > [data-testid="managed-operation-progress"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('keeps simultaneous service actions on independent event streams', async () => {
    const baseServices = [
      { service_id: 'mws-first', template_id: 'custom-first', service_family_id: 'first', name: 'First service', deployment: 'container', workspace_path: '/first', version: '1', desired_state: 'stopped', observed_state: 'stopped', forward_id: 'pf-first', runtime_port: 3001, update_available: false },
      { service_id: 'mws-second', template_id: 'custom-second', service_family_id: 'second', name: 'Second service', deployment: 'container', workspace_path: '/second', version: '1', desired_state: 'stopped', observed_state: 'stopped', forward_id: 'pf-second', runtime_port: 3002, update_available: false },
    ];
    const runningFirst = { operation_id: 'mop-first', service_id: 'mws-first', action: 'start' as const, state: 'running', stage: 'starting', progress_current: 4, progress_total: 7 };
    const runningSecond = { ...runningFirst, operation_id: 'mop-second', service_id: 'mws-second' };
    const operations = new Map<string, typeof runningFirst>();
    const streamControllers = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    const streamSignals = new Map<string, AbortSignal>();
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') {
        return {
          services: baseServices.map((service) => {
            const active = operations.get(service.service_id);
            return active ? { ...service, active_operation: active, operation_artifact_reference: `ghcr.io/example/${service.service_id}@sha256:exact` } : service;
          }),
        };
      }
      if (url.endsWith('/mws-first/operations') && init?.method === 'POST') {
        operations.set(runningFirst.service_id, runningFirst);
        return runningFirst;
      }
      if (url.endsWith('/mws-second/operations') && init?.method === 'POST') {
        operations.set(runningSecond.service_id, runningSecond);
        return runningSecond;
      }
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockImplementation(async (url: string, init?: RequestInit) => {
      const operation = url.includes('mop-first') ? runningFirst : url.includes('mop-second') ? runningSecond : null;
      if (!operation) throw new Error(`Unexpected event stream: ${url}`);
      if (init?.signal) streamSignals.set(operation.operation_id, init.signal);
      return new Response(new ReadableStream({
        start(controller) {
          streamControllers.set(operation.operation_id, controller);
          controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(operation)}\n\n`));
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    const dispose = render(() => <EnvPortForwardsPage />, host);
    try {
      await waitForAssertion(() => expect(host.querySelectorAll('[data-testid="managed-service-row"]')).toHaveLength(2));
      for (const serviceID of ['mws-first', 'mws-second']) {
        Array.from(host.querySelectorAll<HTMLButtonElement>(`[data-managed-service-id="${serviceID}"] button`))
          .find((button) => button.textContent?.trim() === 'Start')?.click();
      }
      await waitForAssertion(() => expect(host.querySelectorAll('[data-testid="managed-service-operation-trigger"]')).toHaveLength(2));
      expect(streamSignals.get('mop-first')?.aborted).toBe(false);
      expect(streamSignals.get('mop-second')?.aborted).toBe(false);

      operations.clear();
      for (const operation of [runningFirst, runningSecond]) {
        const controller = streamControllers.get(operation.operation_id)!;
        controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify({ ...operation, state: 'succeeded', stage: 'completed', progress_current: 7 })}\n\n`));
        controller.close();
      }
      await waitForAssertion(() => expect(host.querySelectorAll('[data-testid="managed-service-operation-trigger"]')).toHaveLength(0));
    } finally {
      dispose();
    }
  });

  it('shows retry submission in the owning row before the operation request returns', async () => {
    const service = { service_id: 'mws-retry', template_id: 'deepseek-harness-container', service_family_id: 'deepseek-harness', name: 'DeepSeek Harness', template_source: 'builtin', deployment: 'docker', workspace_path: '/workspace', version: '0.1.1-rc.2', desired_state: 'stopped', observed_state: 'error', forward_id: 'pf-retry', runtime_port: 3080, update_available: false };
    const operationRequest = deferred<any>();
    const running = { operation_id: 'mop-retry', service_id: service.service_id, action: 'retry_install' as const, state: 'running', stage: 'pulling', progress_current: 2, progress_total: 7 };
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [service] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/managed-web-services/mws-retry/operations' && init?.method === 'POST') return operationRequest.promise;
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(running)}\n\n`));
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    const dispose = render(() => <EnvPortForwardsPage />, host);
    try {
      await waitForAssertion(() => expect(host.querySelector('[data-managed-service-id="mws-retry"]')).toBeTruthy());
      Array.from(host.querySelectorAll<HTMLButtonElement>('[data-managed-service-id="mws-retry"] button')).find((button) => button.textContent?.trim() === 'Retry')?.click();
      await flushMicrotasks();

      const submitting = host.querySelector<HTMLButtonElement>('[data-testid="managed-service-operation-trigger"]')!;
      expect(submitting.textContent).toContain('Starting operation');
      expect(submitting.textContent).toContain('0/7');
      expect(host.querySelector('[data-managed-service-id="mws-retry"]')?.textContent).not.toContain('Error');

      operationRequest.resolve(running);
      await waitForAssertion(() => expect(host.querySelector('[data-testid="managed-service-operation-trigger"]')?.textContent).toContain('Pulling image'));
    } finally {
      dispose();
    }
  });

  it('opens the managed settings owner and runs reconfigure through the shared operation stream', async () => {
    const service = {
      service_id: 'mws-settings', template_id: 'custom-container', service_family_id: 'custom-container', template_source: 'custom',
      name: 'Team dashboard', description: 'Managed dashboard', deployment: 'container', workspace_path: '/workspace', version: '1',
      desired_state: 'stopped', observed_state: 'stopped', forward_id: 'pf-settings', runtime_port: 3000, update_available: false,
    };
    const settings = {
      service_id: service.service_id, name: service.name, description: service.description, access_mode: 'unified_proxy',
      deployment: 'container', template_source: 'custom', observed_state: 'stopped', configuration_revision: 3,
      configuration_sha256: 'configuration-sha', parameters: {},
      runtime: { container: { entrypoint: '', command: [], environment: [], labels: {}, restart_policy: 'no', network_mode: 'bridge', ports: [], mounts: [], cpus: 0, memory_bytes: 0, pids_limit: 512, shm_size_bytes: 0, cap_add: [], cap_drop: ['ALL'], devices: [], privileged: false, read_only_root: true, security_opts: ['no-new-privileges:true'], user: '' } },
    };
    const running = { operation_id: 'mop-reconfigure', service_id: service.service_id, action: 'reconfigure' as const, state: 'running', stage: 'rebuilding_runtime', progress_current: 3, progress_total: 5 };
    let preflightBody: Record<string, any> | null = null;
    let operationBody: Record<string, any> | null = null;
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [service] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/managed-web-services/mws-settings/settings' && init?.method === 'GET') return settings;
      if (url === '/_redeven_proxy/api/managed-web-services/mws-settings/reconfigure/preflight' && init?.method === 'POST') {
        preflightBody = JSON.parse(String(init.body));
        return { configuration_revision: 3, plan_digest: 'exact-plan', changed_sections: ['runtime'], risks: [], requires_rebuild: true };
      }
      if (url === '/_redeven_proxy/api/managed-web-services/mws-settings/operations' && init?.method === 'POST') {
        operationBody = JSON.parse(String(init.body));
        return running;
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(`event: snapshot\ndata: ${JSON.stringify({ ...running, state: 'succeeded', stage: 'completed', progress_current: 5 })}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    render(() => <EnvPortForwardsPage />, host);
    await waitForAssertion(() => expect(host.querySelector('[data-managed-service-id="mws-settings"]')).toBeTruthy());
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-managed-service-id="mws-settings"] button')).find((button) => button.textContent?.trim() === 'Settings')?.click();
    await waitForAssertion(() => expect(host.querySelector('[data-testid="managed-service-settings"]')).toBeTruthy());
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Parameters')?.click();
    const entrypoint = host.querySelector<HTMLInputElement>('input[placeholder="/usr/local/bin/start"]')!;
    entrypoint.value = '/usr/local/bin/dashboard';
    entrypoint.dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Review changes')?.click();
    await waitForAssertion(() => expect(preflightBody).toMatchObject({ configuration_revision: 3, runtime: { container: { entrypoint: '/usr/local/bin/dashboard' } } }));
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Apply configuration')?.click();
    await waitForAssertion(() => expect(operationBody).toMatchObject({ action: 'reconfigure', reconfigure: { plan_digest: 'exact-plan', draft: { configuration_revision: 3 } } }));
    expect(localApiMocks.fetchLocalApi).toHaveBeenCalledWith(expect.stringContaining('mop-reconfigure/events'), expect.objectContaining({ method: 'GET' }));
  });

  it('reports retry failures with the retry action title', async () => {
    const service = { service_id: 'mws-retry', template_id: 'deepseek-harness-container', service_family_id: 'deepseek-harness', name: 'DeepSeek Harness', template_source: 'builtin', deployment: 'docker', workspace_path: '/workspace', version: '0.1.1-rc.2', desired_state: 'stopped', observed_state: 'error', forward_id: 'pf-retry', runtime_port: 3080, update_available: false };
    const running = { operation_id: 'mop-retry', service_id: service.service_id, action: 'retry_install' as const, state: 'running', stage: 'pulling', progress_current: 2, progress_total: 7 };
    const failed = { ...running, state: 'failed', stage: 'failed', error_code: 'IMAGE_REGISTRY_UNAVAILABLE', error_message: 'The container image registry is unavailable.' };
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: [service] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/managed-web-services/mws-retry/operations' && init?.method === 'POST') return running;
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(`event: snapshot\ndata: ${JSON.stringify(failed)}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    render(() => <EnvPortForwardsPage />, host);
    await waitForAssertion(() => expect(host.querySelector('[data-managed-service-id="mws-retry"]')).toBeTruthy());
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-managed-service-id="mws-retry"] button')).find((button) => button.textContent?.trim() === 'Retry')?.click();

    await waitForAssertion(() => expect(notificationMocks.error).toHaveBeenCalledWith('Service retry failed', 'The image registry is unavailable. Check the network connection, then retry.'));
    expect(notificationMocks.error).not.toHaveBeenCalledWith('Failed to open service', expect.anything());
  });

  it('uninstalls a managed service while retaining its data by default', async () => {
    const service = { service_id: 'mws-1', template_id: 'deepseek-harness', deployment: 'native', workspace_path: '/workspace', version: '0.1.1-rc.2', desired_state: 'running', observed_state: 'running', forward_id: 'managed-forward', runtime_port: 3080 };
    let removed = false;
    let operationBody: Record<string, unknown> | null = null;
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: removed ? [] : [service] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/managed-web-services/mws-1/operations' && init?.method === 'POST') {
        operationBody = JSON.parse(String(init.body));
        removed = true;
        return { operation_id: 'mop-uninstall', service_id: 'mws-1', state: 'pending', stage: 'stopping', progress_current: 0, progress_total: 7 };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(`event: snapshot\ndata: ${JSON.stringify({ operation_id: 'mop-uninstall', service_id: 'mws-1', state: 'succeeded', stage: 'completed', progress_current: 7, progress_total: 7 })}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    render(() => <EnvPortForwardsPage />, host);
    await waitForAssertion(() => expect(host.querySelector<HTMLButtonElement>('button[title="Uninstall"]')).toBeTruthy());
    host.querySelector<HTMLButtonElement>('button[title="Uninstall"]')?.click();
    await flushPage();
    const uninstallDialog = Array.from(host.querySelectorAll<HTMLHeadingElement>('h2'))
      .find((heading) => heading.textContent?.trim() === 'Uninstall managed service')?.parentElement;
    const uninstall = Array.from(uninstallDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Uninstall');
    uninstall?.click();

    await waitForAssertion(() => expect(operationBody).toMatchObject({ action: 'uninstall', delete_data: false }));
    await waitForAssertion(() => expect(notificationMocks.success).toHaveBeenCalledWith('Managed service uninstalled', expect.any(String)));
  });

  it('requires the second destructive confirmation before deleting managed data', async () => {
    envContextMocks.env = Object.assign(
      () => ({ permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true } }),
      { state: 'ready', loading: false, error: null },
    );
    const service = { service_id: 'mws-1', template_id: 'deepseek-harness', deployment: 'native', workspace_path: '/workspace', version: '0.1.1-rc.2', desired_state: 'running', observed_state: 'running', forward_id: 'managed-forward', runtime_port: 3080 };
    let operationBody: Record<string, unknown> | null = null;
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/managed-web-services/catalog') return { templates: [] };
      if (url === '/_redeven_proxy/api/managed-web-services') return { services: operationBody ? [] : [service] };
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/managed-web-services/mws-1/operations' && init?.method === 'POST') {
        operationBody = JSON.parse(String(init.body));
        return { operation_id: 'mop-delete', service_id: 'mws-1', state: 'pending', stage: 'stopping', progress_current: 0, progress_total: 7 };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });
    localApiMocks.fetchLocalApi.mockResolvedValue(new Response(`event: snapshot\ndata: ${JSON.stringify({ operation_id: 'mop-delete', service_id: 'mws-1', state: 'succeeded', stage: 'completed', progress_current: 7, progress_total: 7 })}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    render(() => <EnvPortForwardsPage />, host);
    await waitForAssertion(() => expect(host.querySelector<HTMLButtonElement>('button[title="Uninstall"]')).toBeTruthy());
    host.querySelector<HTMLButtonElement>('button[title="Uninstall"]')?.click();
    await flushPage();
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.disabled).toBe(false);
    checkbox?.click();
    const uninstallDialog = Array.from(host.querySelectorAll<HTMLHeadingElement>('h2'))
      .find((heading) => heading.textContent?.trim() === 'Uninstall managed service')?.parentElement;
    Array.from(uninstallDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Uninstall')?.click();
    await flushPage();
    expect(operationBody).toBeNull();
    expect(host.textContent).toContain('This permanently deletes');
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Delete data')?.click();

    await waitForAssertion(() => expect(operationBody).toMatchObject({ action: 'uninstall', delete_data: true }));
  });

  it('uses Web Services copy for the product surface', async () => {
    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    expect(host.textContent).toContain('Web Services');
    expect(host.textContent).toContain('Add Service');
    expect(host.textContent).not.toContain('Port Forwards');
  });

  it('explains an unsupported saved service target without a destructive error state', async () => {
    render(() => (
      <CreateForwardDialog
        open
        loading={false}
        onOpenChange={() => undefined}
        onCreate={() => undefined}
      />
    ), host);
    await flushPage();

    const input = host.querySelector<HTMLInputElement>('[data-testid="web-service-dialog-target"]');
    const guidance = host.querySelector<HTMLElement>('[data-testid="web-service-dialog-target-guidance"]');
    expect(input).toBeTruthy();
    expect(guidance?.textContent).toContain('loopback address');

    if (input) {
      input.value = 'baidu.com';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    await flushMicrotasks();

    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.className).toContain('border-warning/45');
    expect(input?.className).not.toContain('border-destructive');
    expect(guidance?.getAttribute('role')).toBe('alert');
    expect(guidance?.className).toContain('border-warning/25');
    expect(guidance?.className).not.toContain('text-destructive');
    expect(guidance?.textContent).toContain('Available only inside this Environment');
    expect(guidance?.textContent).toContain('Public websites and LAN addresses');
    expect(guidance?.textContent).toContain('127.0.0.1');
    const dialogAddButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Add Service');
    expect(dialogAddButton?.disabled).toBe(true);
    expect(localApiMocks.fetchLocalApiJSON).not.toHaveBeenCalledWith(
      '/_redeven_proxy/api/forwards',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('opens a local service through the protected proxy after touching it', async () => {
    const assign = vi.fn();
    const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ location: { assign }, close } as unknown as Window);

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const openButton = host.querySelector<HTMLButtonElement>('[data-testid="port-forward-row"] button');
    expect(openButton).toBeTruthy();
    openButton?.click();

    await waitForAssertion(() => {
      expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/forwards/forward-1/touch', { method: 'POST' });
      expect(assign).toHaveBeenCalledWith('https://localhost/pf/forward-1/');
    });
    expect(close).not.toHaveBeenCalled();
  });

  it('opens a deep-link address as a temporary session without adding a saved service', async () => {
    const assign = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ location: { assign }, close: vi.fn() } as unknown as Window);
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/forward-sessions') {
        return {
          forward: { forward_id: 'temporary-1', target_url: 'http://localhost:3000' },
          app_path: '/docs?tab=api',
          ephemeral: true,
        };
      }
      if (url === '/_redeven_proxy/api/forwards/temporary-1/touch') return { forward_id: 'temporary-1' };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();
    const addressInput = host.querySelector('[data-testid="web-service-address-input"]') as HTMLInputElement | null;
    expect(addressInput).toBeTruthy();
    if (addressInput) {
      addressInput.value = '3000/docs?tab=api';
      addressInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    host.querySelector<HTMLFormElement>('[data-testid="web-service-address-form"]')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await waitForAssertion(() => {
      expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/forward-sessions', {
        method: 'POST',
        body: JSON.stringify({ target: '3000/docs?tab=api' }),
      });
      expect(assign).toHaveBeenCalledWith('https://localhost/pf/temporary-1/docs?tab=api');
      expect(addressInput?.value).toBe('http://localhost:3000/docs?tab=api');
      expect(host.textContent).toContain('Temporary');
      expect(host.textContent).toContain('Save service');
    });
  });

  it('explains the address scope inline and rejects unsupported input without opening a window', async () => {
    const openWindow = vi.spyOn(window, 'open');
    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const input = host.querySelector<HTMLInputElement>('[data-testid="web-service-address-input"]');
    const guidance = host.querySelector<HTMLElement>('[data-testid="web-service-address-guidance"]');
    expect(guidance?.textContent).toContain('Local services only');
    expect(guidance?.textContent).toContain('loopback address');

    if (input) {
      input.value = 'baidu.com';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    host.querySelector<HTMLFormElement>('[data-testid="web-service-address-form"]')?.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true }),
    );
    await flushMicrotasks();

    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(guidance?.getAttribute('role')).toBe('alert');
    expect(guidance?.className).toContain('border-warning/25');
    expect(guidance?.className).not.toContain('text-destructive');
    expect(guidance?.textContent).toContain('Available only inside this Environment');
    expect(guidance?.textContent).toContain('127.0.0.1');
    expect(openWindow).not.toHaveBeenCalled();
    expect(localApiMocks.fetchLocalApiJSON).not.toHaveBeenCalledWith(
      '/_redeven_proxy/api/forward-sessions',
      expect.anything(),
    );
    expect(notificationMocks.error).not.toHaveBeenCalled();
  });

  it('asks for a service name when saving a temporary session', async () => {
    vi.spyOn(window, 'open').mockReturnValue({ location: { assign: vi.fn() }, close: vi.fn() } as unknown as Window);
    let saveBody: Record<string, unknown> | null = null;
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/forward-sessions') return {
        forward: { forward_id: 'temporary-save', target_url: 'http://localhost:3000', name: '', description: '' },
        app_path: '/',
        ephemeral: true,
      };
      if (url === '/_redeven_proxy/api/forwards/temporary-save/touch') return { forward_id: 'temporary-save' };
      if (url === '/_redeven_proxy/api/forward-sessions/temporary-save/save' && init?.method === 'POST') {
        saveBody = JSON.parse(String(init.body));
        return { forward_id: 'temporary-save', target_url: 'http://localhost:3000', name: saveBody?.name, description: saveBody?.description };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();
    const addressInput = host.querySelector<HTMLInputElement>('[data-testid="web-service-address-input"]')!;
    addressInput.value = '3000';
    addressInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    host.querySelector<HTMLFormElement>('[data-testid="web-service-address-form"]')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await waitForAssertion(() => expect(host.textContent).toContain('Save service'));
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Save service')?.click();
    await flushPage();

    expect(host.textContent).toContain('Save Web Service');
    const name = host.querySelector<HTMLInputElement>('#web-service-metadata-name')!;
    expect(name.value).toBe('localhost:3000');
    name.value = 'Local documentation';
    name.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const dialog = Array.from(host.querySelectorAll('h2')).find((heading) => heading.textContent === 'Save Web Service')?.parentElement;
    Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((button) => button.textContent?.trim() === 'Save service')?.click();

    await waitForAssertion(() => expect(saveBody).toEqual({ name: 'Local documentation', description: '', access_mode: 'unified_proxy' }));
  });

  it('updates the name of an already saved service', async () => {
    let updateBody: Record<string, unknown> | null = null;
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/forwards' && (!init?.method || init.method === 'GET')) return {
        forwards: [{
          forward_id: 'forward-1', target_url: 'http://localhost:3000', name: 'Demo Forward', description: 'Browser preview', health_path: '/', insecure_skip_verify: false,
          created_at_unix_ms: 1, updated_at_unix_ms: 1, last_opened_at_unix_ms: 1, health: { status: 'unknown', last_checked_at_unix_ms: 0, latency_ms: 0, last_error: '' },
        }],
      };
      if (url === '/_redeven_proxy/api/forwards/forward-1' && init?.method === 'PATCH') {
        updateBody = JSON.parse(String(init.body));
        return { forward_id: 'forward-1', target_url: 'http://localhost:3000', ...updateBody };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvPortForwardsPage />, host);
    await waitForAssertion(() => expect(host.querySelector('[data-testid="port-forward-row"]')).toBeTruthy());
    host.querySelector<HTMLButtonElement>('button[aria-label="Edit service details"]')?.click();
    await flushPage();
    const name = host.querySelector<HTMLInputElement>('#web-service-metadata-name')!;
    name.value = 'Renamed dashboard';
    name.dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Save changes')?.click();

    await waitForAssertion(() => expect(updateBody).toEqual({ name: 'Renamed dashboard', description: 'Browser preview', access_mode: 'unified_proxy' }));
  });

  it('keeps one blocking transaction while a temporary session is created and opened', async () => {
    const sessionRequest = deferred<any>();
    const runtimeRequest = deferred<typeof localRuntime>();
    const assign = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ location: { assign }, close: vi.fn() } as unknown as Window);
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/forwards') return { forwards: [] };
      if (url === '/_redeven_proxy/api/forward-sessions') return sessionRequest.promise;
      if (url === '/_redeven_proxy/api/forwards/temporary-1/touch') return { forward_id: 'temporary-1' };
      throw new Error(`Unexpected local API call: ${url}`);
    });
    controlplaneMocks.getLocalRuntime.mockReturnValue(runtimeRequest.promise);

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();
    const addressInput = host.querySelector('[data-testid="web-service-address-input"]') as HTMLInputElement | null;
    if (addressInput) {
      addressInput.value = '3000';
      addressInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    host.querySelector<HTMLFormElement>('[data-testid="web-service-address-form"]')?.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true }),
    );
    await flushMicrotasks();

    expect(host.querySelector('.redeven-loading-curtain')).not.toBeNull();
    expect(host.textContent).toContain('Preparing a temporary Web Service session');
    expect(addressInput?.disabled).toBe(true);

    sessionRequest.resolve({
      forward: { forward_id: 'temporary-1', target_url: 'http://localhost:3000' },
      app_path: '/',
      ephemeral: true,
    });
    await flushMicrotasks();
    expect(host.querySelector('.redeven-loading-curtain')).not.toBeNull();
    expect(host.textContent).toContain('Resolving route');
    expect(addressInput?.disabled).toBe(true);

    runtimeRequest.resolve(localRuntime);
    await waitForAssertion(() => {
      expect(assign).toHaveBeenCalledWith('https://localhost/pf/temporary-1/');
      expect(host.querySelector('.redeven-loading-curtain')).toBeNull();
      expect(addressInput?.disabled).toBe(false);
    });
  });

  it('opens secure tunnel services with the canonical portforward app id', async () => {
    controlplaneMocks.getLocalRuntime.mockResolvedValue(null);
    const assign = vi.fn();
    const close = vi.fn();
    const popup = { location: { assign }, close } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);

    render(() => <EnvPortForwardsPage />, host);
    await flushPage();

    const openButton = host.querySelector<HTMLButtonElement>('[data-testid="port-forward-row"] button');
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
