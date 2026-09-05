// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  permissions: {
    can_read: true,
    can_write: true,
    can_execute: true,
    can_admin: true,
    is_owner: true,
  },
  setEnvironment: (_value: unknown) => undefined as void,
  goActivity: vi.fn(),
  notify: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
  storageWrites: [] as Array<{ key: string; value: unknown }>,
  storageValues: new Map<string, unknown>(),
  listRuntimes: vi.fn(),
  listServices: vi.fn(),
  getServiceConfiguration: vi.fn(),
  listResources: vi.fn(),
  resourceDetails: vi.fn(),
  listOperations: vi.fn(),
  listOperationEvents: vi.fn(),
  subscribeOperationEvents: vi.fn(),
  createComposeDefinition: vi.fn(),
  updateComposeDefinition: vi.fn(),
  getComposeDefinition: vi.fn(),
  deleteComposeDefinition: vi.fn(),
  imageBuildHistory: vi.fn(),
  rawInspect: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  subscribeLogs: vi.fn(),
  getStats: vi.fn(),
  subscribeStats: vi.fn(),
  subscribeCollectionStats: vi.fn(),
  preflight: vi.fn(),
  createOperation: vi.fn(),
  fsList: vi.fn(),
  createExecSession: vi.fn(),
  deleteExecSession: vi.fn(),
  execTerminalProps: new Map<string, any>(),
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => harness.notify,
}));

function icon(name: string) {
  return (props: { class?: string }) => <span data-icon={name} class={props.class} />;
}

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Activity: icon('activity'),
  AlertTriangle: icon('alert'),
  ArrowDown: icon('arrow-down'),
  ArrowUp: icon('arrow-up'),
  Check: icon('check'),
  StopFilled: icon('stop-filled'),
  Cpu: icon('cpu'),
  Database: icon('database'),
  ExternalLink: icon('external-link'),
  Eye: icon('eye'),
  EyeOff: icon('eye-off'),
  FileText: icon('file'),
  Filter: icon('filter'),
  Info: icon('info'),
  Layers: icon('layers'),
  Lock: icon('lock'),
  Maximize: icon('maximize'),
  MoreVertical: icon('more-vertical'),
  Package: icon('package'),
  Pause: icon('pause'),
  Play: icon('play'),
  Plus: icon('plus'),
  Refresh: icon('refresh'),
  Settings: icon('settings'),
  Search: icon('search'),
  Trash: icon('trash'),
  X: icon('x'),
  XCircle: icon('x-circle'),
  ArrowLeft: icon('arrow-left'),
  ChevronRight: icon('chevron-right'),
  Copy: icon('copy'),
  Download: icon('download'),
  Folder: icon('folder'),
  Terminal: icon('terminal'),
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  Panel: (props: any) => <section class={props.class} data-container-monitor-panel={props['data-container-monitor-panel']} data-container-cpu-panel={props['data-container-cpu-panel']} data-container-memory-panel={props['data-container-memory-panel']} data-container-network-panel={props['data-container-network-panel']}>{props.children}</section>,
  PanelContent: (props: any) => <div class={props.class}>{props.children}</div>,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => <button type="button" class={props.class} data-variant={props.variant} disabled={props.disabled} aria-label={props['aria-label']} onClick={props.onClick}>{props.children}</button>,
  Dropdown: (props: any) => <div class="test-dropdown">{props.trigger}<div data-test-dropdown-menu>{props.items.map((item: any) => <button type="button" data-tone={item.tone} disabled={item.disabled} onClick={() => props.onSelect(item.id)}>{item.icon?.()}{item.label}</button>)}</div></div>,
  DirectoryPicker: (props: any) => <Show when={props.open}><section data-directory-picker>{props.title}<button type="button" data-directory-picker-confirm onClick={() => { props.onSelect?.('/workspace/data'); props.onOpenChange?.(false); }}>confirm folder</button></section></Show>,
  FileOpenPicker: (props: any) => <Show when={props.open}><section data-file-open-picker>{props.title}<button type="button" data-picker-confirm onClick={() => {
    props.onSelect?.(props.selectionMode === 'multiple'
      ? ['/workspace/my-app/compose.yaml', '/workspace/my-app/compose.override.yaml']
      : ['/workspace/my-app/.env']);
    props.onOpenChange?.(false);
  }}>confirm files</button></section></Show>,
  Input: (props: any) => <input class={props.class} value={props.value} placeholder={props.placeholder} aria-label={props['aria-label']} aria-invalid={props['aria-invalid']} disabled={props.disabled} onInput={props.onInput} onKeyDown={props.onKeyDown} />,
  MonitoringChart: (props: any) => <div
    class={props.class}
    data-monitoring-chart
    data-series={props.series.map((series: { name: string }) => series.name).join(',')}
    data-series-colors={props.series.map((series: { color: string }) => series.color).join(',')}
    data-point-count={props.series[0]?.data?.length ?? 0}
    data-y-max={props.yMax}
  />,
  Select: (props: any) => <select class={props.class} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)}>{props.options.map((option: any) => <option value={option.value}>{option.label}</option>)}</select>,
  Tabs: (props: any) => <div class={props.class} role="tablist" aria-label={props.ariaLabel}>
    {props.items.map((item: any) => <button
      type="button"
      role="tab"
      class={props.slotClassNames?.tab}
      aria-selected={props.activeId === item.id}
      aria-disabled={item.disabled || undefined}
      disabled={item.disabled}
      onClick={() => !item.disabled && props.onChange?.(item.id)}
      onKeyDown={(event: KeyboardEvent) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        const enabled = props.items.filter((candidate: any) => !candidate.disabled);
        const current = enabled.findIndex((candidate: any) => candidate.id === item.id);
        if (current < 0 || enabled.length === 0) return;
        const next = event.key === 'Home' ? enabled[0]
          : event.key === 'End' ? enabled.at(-1)
            : enabled[(current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
        props.onChange?.(next.id);
      }}
    >{item.icon}{item.label}</button>)}
  </div>,
  Tag: (props: any) => <span>{props.children}</span>,
  Textarea: (props: any) => <textarea rows={props.rows} value={props.value} placeholder={props.placeholder} disabled={props.disabled} onInput={props.onInput} />,
}));

vi.mock('../widgets/ContainerExecTerminal', () => ({
  ContainerExecTerminal: (props: any) => {
    harness.execTerminalProps.set(props.sessionID, props);
    return <div data-container-exec-terminal data-session-id={props.sessionID} />;
  },
}));

vi.mock('../widgets/TextFilePreviewPane', () => ({
  TextFilePreviewPane: (props: any) => <textarea data-service-config-editor value={props.draftText} onInput={(event) => props.onDraftChange?.(event.currentTarget.value)} />,
}));

vi.mock('../primitives/EnvAppModal', () => ({
  Dialog: (props: any) => <Show when={props.open}><section data-dialog class={props.class}>{props.title}{props.children}{props.footer}</section></Show>,
}));

vi.mock('../primitives/EnvAppDrawer', () => ({
  EnvAppDrawer: (props: any) => <Show when={props.open}><aside data-drawer>{props.title}{props.children}</aside></Show>,
}));

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => values?.name ? `${key}:${values.name}` : key,
    formatDateTime: (value: number) => `date:${value}`,
    formatRelativeTime: (value: number) => `relative:${value}`,
    formatNumber: (value: number) => String(value),
  }),
}));

vi.mock('./EnvContext', async () => {
  const { createSignal } = await import('solid-js');
  const [environment, setEnvironment] = createSignal<unknown>({ permissions: harness.permissions });
  harness.setEnvironment = setEnvironment;
  return {
    useEnvContext: () => ({
      env: environment,
      goActivity: harness.goActivity,
    }),
  };
});

vi.mock('../services/uiStorage', () => ({
  readUIStorageJSON: (key: string, fallback: unknown) => harness.storageValues.get(key) ?? fallback,
  removeUIStorageItem: (key: string) => harness.storageValues.delete(key),
  writeUIStorageJSON: (key: string, value: unknown) => {
    harness.storageValues.set(key, value);
    harness.storageWrites.push({ key, value });
  },
}));

vi.mock('../services/containerResourcesApi', () => ({
  listContainerRuntimes: harness.listRuntimes,
  listContainerServices: harness.listServices,
  getContainerServiceConfiguration: harness.getServiceConfiguration,
  listContainerResources: harness.listResources,
  getContainerResourceDetails: harness.resourceDetails,
  listContainerOperations: harness.listOperations,
  listContainerOperationEvents: harness.listOperationEvents,
  subscribeContainerOperationEvents: harness.subscribeOperationEvents,
  createComposeProjectDefinition: harness.createComposeDefinition,
  updateComposeProjectDefinition: harness.updateComposeDefinition,
  getComposeProjectDefinition: harness.getComposeDefinition,
  deleteComposeProjectDefinition: harness.deleteComposeDefinition,
  getContainerImageBuildHistory: harness.imageBuildHistory,
  getRawContainerInspect: harness.rawInspect,
  listContainerResourceFiles: harness.listFiles,
  readContainerResourceFile: harness.readFile,
  subscribeContainerLogs: harness.subscribeLogs,
  subscribeContainerStats: harness.subscribeStats,
  subscribeContainerStatsCollection: harness.subscribeCollectionStats,
  cancelContainerOperation: vi.fn(),
  createContainerOperation: harness.createOperation,
  getContainerStats: harness.getStats,
  preflightContainerOperation: harness.preflight,
  createContainerExecSession: harness.createExecSession,
  deleteContainerExecSession: harness.deleteExecSession,
  subscribeContainerOperation: vi.fn(),
  tailContainerLogs: vi.fn(),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({ fs: { list: harness.fsList } }),
}));

import { EnvContainersPage } from './EnvContainersPage';
import { LocalApiError } from '../services/localApi';
import { requestContainerResourceNavigation } from '../services/containerResourceNavigation';

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('native Containers page', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    Object.assign(harness.permissions, {
      can_read: true,
      can_write: true,
      can_execute: true,
      can_admin: true,
      is_owner: true,
    });
    harness.setEnvironment({ permissions: harness.permissions });
    harness.goActivity.mockReset();
    harness.notify.info.mockReset();
    harness.notify.error.mockReset();
    harness.notify.success.mockReset();
    harness.storageWrites.length = 0;
    harness.storageValues.clear();
    harness.listRuntimes.mockReset().mockResolvedValue([{
      endpoint_id: 'docker-primary',
      engine: 'docker',
      state: 'ready',
      capabilities: { collection_stats: true, volume_files: false, exec: false },
    }, { engine: 'podman', state: 'not_installed' }]);
    harness.listServices.mockReset().mockResolvedValue([
      {
        service_id: 'container_service_docker', engine: 'docker', name: 'Docker Engine', implementation: 'docker_engine', state: 'stopped',
        capabilities: { start: true, stop: true, restart: true },
        configuration: { mode: 'local', sources: ['engine', 'docker_cli'] },
      },
      {
        service_id: 'container_service_podman', engine: 'podman', name: 'Local Podman', implementation: 'podman_local', state: 'running',
        capabilities: { start: false, stop: false, restart: false },
        configuration: { mode: 'local', sources: ['engine'] },
        guidance_code: 'podman_daemonless', rootless: true,
      },
    ]);
    harness.getServiceConfiguration.mockReset().mockResolvedValue({
      service_id: 'container_service_docker',
      sources: [
        { source_id: 'engine', display_path: '~/.docker/daemon.json', status: 'ready', exists: true, format: 'json', sections: ['advanced'], apply_modes: ['save', 'save_and_restart'], content: '{}\n', base_revision: 'sha256:engine' },
        { source_id: 'docker_cli', display_path: '~/.docker/config.json', status: 'ready', exists: true, format: 'json', sections: ['general', 'proxy', 'credentials', 'advanced'], apply_modes: ['save'], base_revision: 'sha256:client', content: '{\n  "currentContext": "desktop-linux",\n  "credsStore": "desktop",\n  "proxies": {\n    "default": {\n      "httpProxy": "http://proxy.example.test"\n    }\n  }\n}\n', protected_registries: ['registry.example.test'], context_options: ['default', 'desktop-linux'] },
      ],
    });
    harness.listResources.mockReset().mockResolvedValue([{
      container_id: 'container-1',
      name: 'Managed API',
      state: 'running',
      management: { managed: true, owner: { kind: 'web_service', service_id: 'service-1', name: 'API' } },
    }]);
    harness.resourceDetails.mockReset().mockResolvedValue({ container_id: 'container-1', state: 'running' });
    harness.listOperations.mockReset().mockResolvedValue([]);
    harness.listOperationEvents.mockReset().mockResolvedValue([]);
    harness.subscribeOperationEvents.mockReset().mockResolvedValue(undefined);
    harness.createComposeDefinition.mockReset().mockResolvedValue({ project_id: 'compose_saved_1' });
    harness.updateComposeDefinition.mockReset().mockResolvedValue({ project_id: 'compose_saved_1' });
    harness.getComposeDefinition.mockReset().mockResolvedValue({
      project_id: 'compose_saved_1', engine: 'docker', endpoint_id: 'docker-primary', name: 'saved-api',
      config_paths: ['/workspace/compose.yaml'], profiles: [], created_at_unix_ms: 1, updated_at_unix_ms: 1,
    });
    harness.deleteComposeDefinition.mockReset().mockResolvedValue(undefined);
    harness.imageBuildHistory.mockReset().mockResolvedValue([]);
    harness.rawInspect.mockReset().mockResolvedValue({});
    harness.listFiles.mockReset().mockResolvedValue({ path: '/', entries: [], truncated: false });
    harness.readFile.mockReset().mockResolvedValue(new Blob());
    harness.subscribeLogs.mockReset().mockResolvedValue(undefined);
    harness.getStats.mockReset().mockResolvedValue({
      sampled_at_unix_ms: 1_700_000_000_000,
      container_id: 'container-1',
      cpu_percent: 4.2,
      memory_bytes: 268_435_456,
      memory_limit: 1_073_741_824,
      network_rx_bytes: 1_000,
      network_tx_bytes: 500,
    });
    harness.subscribeStats.mockReset().mockResolvedValue(undefined);
    harness.subscribeCollectionStats.mockReset().mockResolvedValue(undefined);
    harness.preflight.mockReset().mockResolvedValue({
      method: 'containers.start', request_hash: 'request', plan_hash: 'plan',
      plan: { method: 'containers.start', target: {}, plan_digest: 'plan', risk_level: 'low', risk_flags: [], requires_admin: false },
      management: { managed: false },
    });
    harness.createOperation.mockReset().mockResolvedValue({ operation_id: 'operation-1', state: 'queued' });
    harness.createExecSession.mockReset().mockResolvedValue({ session_id: 'exec-session-1' });
    harness.deleteExecSession.mockReset().mockResolvedValue(undefined);
    harness.execTerminalProps.clear();
    harness.fsList.mockReset().mockResolvedValue({ entries: [] });
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.textContent = '';
  });

  it('renders desktop table and mobile cards from one endpoint-scoped inventory', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage stateScope="widget-1" variant="workbench" />, host);
    await settle();

    expect(host.querySelector('[data-container-page]')?.getAttribute('data-variant')).toBe('workbench');
    expect(host.querySelector('table')).not.toBeNull();
    expect(host.querySelector('[data-container-endpoint-bar]')).toBeNull();
    expect(host.querySelectorAll('.container-resource-tabs [role="tab"]')).toHaveLength(4);
    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent).toContain('containers.views.containers');
    expect(host.querySelector('[data-container-mobile-list] button')).not.toBeNull();
    expect(host.querySelectorAll('.container-touch-target')).toHaveLength(0);
    expect(harness.listResources).toHaveBeenCalledWith('containers', 'docker', 'docker-primary', expect.anything());
    expect(harness.storageWrites.some((entry) => entry.key === 'containers:widget-1')).toBe(true);
  });

  it('opens one service-management surface and loads configuration on demand', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    const servicesAction = host.querySelector<HTMLButtonElement>('[aria-label="containers.services.title"]');
    expect(servicesAction?.querySelector('[data-icon="settings"]')).not.toBeNull();
    servicesAction?.click();
    await settle();

    expect(harness.listServices).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-container-services-page]')).not.toBeNull();
    expect(host.querySelector('.container-resource-tabs')).toBeNull();
    expect(host.querySelectorAll('.container-service-card')).toHaveLength(2);
    expect(host.querySelector('.container-service-card button')?.textContent).toContain('containers.actions.start');
    expect(host.querySelector<HTMLImageElement>('.container-service-card img')?.src).toContain('/_redeven_proxy/env/container-service-icons/docker-default.svg');

    const configure = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-service-card button'))
      .find((button) => button.textContent?.includes('containers.services.configure'));
    configure?.click();
    await settle();

    expect(harness.getServiceConfiguration).toHaveBeenCalledWith('container_service_docker');
    expect(host.querySelector('[data-dialog]')?.textContent).toContain('containers.services.engineConfiguration');
    expect(host.querySelector('[data-dialog]')?.textContent).toContain('~/.docker/daemon.json');
  });

  it('keeps service cards stable while refreshing and uses matching geometry for the initial skeleton', async () => {
    const services = [{
      service_id: 'container_service_docker', engine: 'docker', name: 'Docker Engine', implementation: 'docker_engine', state: 'running',
      capabilities: { start: false, stop: true, restart: true },
      configuration: { mode: 'local', sources: ['engine', 'docker_cli'] },
    }];
    const initialLoad = deferred<typeof services>();
    harness.listServices.mockImplementationOnce(() => initialLoad.promise);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    host.querySelector<HTMLButtonElement>('[aria-label="containers.services.title"]')?.click();
    await settle();
    const servicePage = host.querySelector<HTMLElement>('[data-container-services-page]')!;
    expect(servicePage.getAttribute('aria-busy')).toBe('true');
    expect(servicePage.querySelectorAll('.container-service-card--loading')).toHaveLength(2);
    expect(servicePage.querySelector('.container-service-card--loading .container-service-card__mark')).not.toBeNull();
    expect(servicePage.querySelector('.container-service-card--loading .container-service-card__actions')).not.toBeNull();

    initialLoad.resolve(services);
    await settle();
    expect(servicePage.querySelectorAll('.container-service-card:not(.container-service-card--loading)')).toHaveLength(1);

    const refreshLoad = deferred<typeof services>();
    harness.listServices.mockImplementationOnce(() => refreshLoad.promise);
    host.querySelector<HTMLButtonElement>('[aria-label="containers.actions.refresh"]')?.click();
    await settle();
    expect(servicePage.getAttribute('aria-busy')).toBe('true');
    expect(servicePage.querySelectorAll('.container-service-card:not(.container-service-card--loading)')).toHaveLength(1);
    expect(servicePage.querySelector('.container-service-card--loading')).toBeNull();

    refreshLoad.resolve(services);
    await settle();
    expect(servicePage.getAttribute('aria-busy')).toBe('false');
  });

  it('edits one complete Docker CLI document without exposing registry credentials', async () => {
    harness.listServices.mockResolvedValue([{
      service_id: 'container_service_desktop', engine: 'docker', name: 'Docker Desktop', implementation: 'docker_desktop', state: 'running',
      capabilities: { start: true, stop: true, restart: true },
      configuration: { mode: 'local', sources: ['engine', 'docker_cli'] },
    }]);
    harness.getServiceConfiguration.mockResolvedValue({
      service_id: 'container_service_desktop',
      sources: [
        { source_id: 'engine', display_path: '~/.docker/daemon.json', status: 'missing', exists: false, format: 'json', sections: ['advanced'], apply_modes: ['save', 'save_and_restart'], content: '{}\n', base_revision: 'sha256:missing' },
        { source_id: 'docker_cli', display_path: '~/.docker/config.json', status: 'ready', exists: true, format: 'json', sections: ['general', 'proxy', 'credentials', 'advanced'], apply_modes: ['save'], base_revision: 'sha256:client', content: '{\n  "currentContext": "desktop-linux",\n  "credsStore": "desktop",\n  "proxies": {\n    "default": {\n      "httpProxy": "http://proxy.example.test"\n    }\n  },\n  "plugins": {\n    "debug": {\n      "hooks": "exec"\n    }\n  }\n}\n', protected_registries: ['registry.example.test'], context_options: ['default', 'desktop-linux'] },
      ],
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    host.querySelector<HTMLButtonElement>('[aria-label="containers.services.title"]')?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-service-card button'))
      .find((button) => button.textContent?.includes('containers.services.configure'))
      ?.click();
    await settle();

    expect(harness.getServiceConfiguration).toHaveBeenCalledWith('container_service_desktop');
    expect(host.querySelector('[data-dialog]')?.textContent).toContain('~/.docker/daemon.json');
    const dockerCLITab = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dialog] [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.services.dockerCLI'));
    dockerCLITab?.click();
    await settle();
    expect(host.querySelector('[data-dialog]')?.textContent).toContain('containers.services.dockerCLIScope');
    expect(host.querySelector('[data-dialog]')?.textContent).not.toContain('containers.services.openSettings');
    expect(host.querySelectorAll('[data-dialog] .container-service-cli-setting-card')).toHaveLength(2);
    const outputFormats = host.querySelector<HTMLDetailsElement>('[data-dialog] .container-service-cli-disclosure');
    expect(outputFormats?.open).toBe(false);
    expect(outputFormats?.textContent).toContain('docker ps');
    expect(outputFormats?.textContent).toContain('psFormat');
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dialog] [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.services.proxies'))
      ?.click();
    await settle();
    const httpProxy = host.querySelectorAll<HTMLInputElement>('[data-dialog] .container-service-cli-profile input')[1] ?? null;
    expect(httpProxy).not.toBeNull();
    httpProxy!.value = 'http://updated-proxy.example.test:3128';
    httpProxy!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const save = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dialog] button'))
      .find((button) => button.textContent?.includes('containers.services.save'));
    expect(save?.disabled).toBe(false);
    save?.click();
    await settle();
    const confirmation = host.querySelector<HTMLInputElement>('[data-dialog] input');
    expect(confirmation).not.toBeNull();
    confirmation!.value = 'Docker Desktop';
    confirmation!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dialog] button'))
      .find((button) => button.textContent?.includes('containers.actions.review'))
      ?.click();
    await settle();
    expect(harness.preflight).toHaveBeenCalledWith('container.services.configuration.update', expect.objectContaining({
      source_id: 'docker_cli',
      base_revision: 'sha256:client',
      mode: 'document',
      apply_mode: 'save',
      content: expect.stringContaining('http://updated-proxy.example.test:3128'),
    }));
    const submitted = harness.preflight.mock.calls.at(-1)?.[1] as { content?: string };
    expect(submitted.content).toContain('"plugins"');
    expect(submitted.content).not.toContain('"auths"');
  });

  it('explains why a running remote service cannot be configured locally', async () => {
    harness.listServices.mockResolvedValue([{
      service_id: 'container_service_remote', engine: 'docker', name: 'Remote Docker', implementation: 'remote', state: 'running', remote: true,
      capabilities: { start: false, stop: false, restart: false },
      configuration: { mode: 'unavailable' },
      guidance_code: 'remote_host',
    }]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    host.querySelector<HTMLButtonElement>('[aria-label="containers.services.title"]')?.click();
    await settle();

    expect(host.querySelector('.container-service-card__guidance')?.textContent).toContain('containers.services.guidance.remote_host');
    const configure = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-service-card button'))
      .find((button) => button.textContent?.includes('containers.services.configure'));
    expect(configure?.disabled).toBe(true);
    expect(harness.getServiceConfiguration).not.toHaveBeenCalled();
  });

  it('keeps prune in the danger menu and lets the server resolve the exact image set', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images' ? [
      { id: 'sha256:shared', reference: 'example/app:latest', size_bytes: 4096, referenced_containers: 0 },
      { id: 'sha256:shared', reference: 'example/app:stable', size_bytes: 4096, referenced_containers: 0 },
    ] : []));
    harness.preflight.mockResolvedValue({
      method: 'images.prune', request_hash: 'canonical-request', plan_hash: 'canonical-plan',
      plan: {
        method: 'images.prune', target: {
          resource_count: 1,
          reclaimable_bytes: 4096,
          resource_identities: ['sha256:shared'],
          resources: [{
            identity: 'sha256:shared', name: 'example/app:latest', references: ['example/app:latest', 'example/app:stable'], size_bytes: 4096,
          }],
        }, plan_digest: 'canonical-plan',
        risk_level: 'high', risk_flags: [], requires_admin: true,
      },
      management: { managed: false },
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.images'))?.click();
    await settle();

    const pruneAction = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-test-dropdown-menu] button'))
      .find((button) => button.textContent?.includes('containers.actions.prune'));
    expect(pruneAction?.getAttribute('data-tone')).toBe('danger');
    expect(pruneAction?.querySelector('[data-icon="trash"]')).not.toBeNull();
    expect(pruneAction?.closest('.container-toolbar-actions')).not.toBeNull();
    pruneAction?.click();
    await settle();

    expect(harness.preflight).toHaveBeenCalledWith('images.prune', {
      engine: 'docker', endpoint_id: 'docker-primary',
    });
    expect(harness.preflight.mock.calls[0]?.[1]).not.toHaveProperty('resource_identities');
    const dialog = host.querySelector<HTMLElement>('[data-dialog]')!;
    expect(dialog.classList.contains('container-prune-review-dialog')).toBe(true);
    expect(dialog.textContent).toContain('containers.prune.resources1');
    expect(dialog.textContent).toContain('containers.prune.reclaimable4.0 KB');
    expect(dialog.textContent).toContain('example/app:latest');
    expect(dialog.textContent).toContain('example/app:stable');
    expect(dialog.textContent).toContain('shared');
    expect(dialog.textContent).not.toContain('images.prune');
    expect(dialog.textContent).not.toContain('canonical-request');
    expect(dialog.querySelector('[data-prune-resource-id="sha256:shared"]')).not.toBeNull();
    expect(Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('containers.prune.confirm'))?.dataset.variant).toBe('destructive');
  });

  it('blocks cleanup when the reviewed resource list is incomplete', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images' ? [
      { id: 'sha256:one', reference: 'example/app:one', referenced_containers: 0 },
      { id: 'sha256:two', reference: 'example/app:two', referenced_containers: 0 },
    ] : []));
    harness.preflight.mockResolvedValue({
      method: 'images.prune', request_hash: 'request', plan_hash: 'plan',
      plan: {
        method: 'images.prune', target: {
          resource_count: 2,
          resource_identities: ['sha256:one', 'sha256:two'],
          resources: [{ identity: 'sha256:one', name: 'example/app:one', references: ['example/app:one'] }],
        }, plan_digest: 'plan', risk_level: 'high', risk_flags: [], requires_admin: true,
      },
      management: { managed: false },
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.images'))?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-test-dropdown-menu] button'))
      .find((button) => button.textContent?.includes('containers.actions.prune'))?.click();
    await settle();

    const dialog = host.querySelector<HTMLElement>('[data-dialog]')!;
    expect(dialog.textContent).toContain('containers.prune.listUnavailable');
    expect(dialog.querySelector('[data-prune-review-list]')).toBeNull();
    expect(Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('containers.prune.confirm'))?.disabled).toBe(true);
  });

  it('lists the exact volume name and driver in the cleanup review', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'volumes' ? [
      { name: 'build-cache', driver: 'local', referenced_containers: 0 },
    ] : []));
    harness.preflight.mockResolvedValue({
      method: 'volumes.prune', request_hash: 'request', plan_hash: 'plan',
      plan: {
        method: 'volumes.prune', target: {
          resource_count: 1,
          resource_identities: ['build-cache'],
          resources: [{ identity: 'build-cache', name: 'build-cache', driver: 'local' }],
        }, plan_digest: 'plan', risk_level: 'high', risk_flags: [], requires_admin: true,
      },
      management: { managed: false },
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.volumes'))?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-test-dropdown-menu] button'))
      .find((button) => button.textContent?.includes('containers.actions.prune'))?.click();
    await settle();

    const row = host.querySelector<HTMLElement>('[data-prune-resource-id="build-cache"]')!;
    expect(row.textContent).toContain('build-cache');
    expect(row.textContent).toContain('local');
    expect(row.querySelector('[data-icon="database"]')).not.toBeNull();
  });

  it('explains an empty prune result and refreshes the authoritative inventory', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images' ? [
      { id: 'sha256:used', reference: 'example/app:latest', referenced_containers: 1 },
    ] : []));
    harness.preflight.mockRejectedValue(new LocalApiError({
      message: 'There are no unused resources to clean up.', status: 409, code: 'NOTHING_TO_PRUNE',
    }));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.images'))?.click();
    await settle();
    const callsBeforePrune = harness.listResources.mock.calls.length;
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-test-dropdown-menu] button'))
      .find((button) => button.textContent?.includes('containers.actions.prune'))?.click();
    await settle();

    expect(harness.notify.info).toHaveBeenCalledWith('containers.prune.nothingTitle', 'containers.prune.nothingMessage');
    expect(harness.notify.error).not.toHaveBeenCalledWith('containers.notifications.preflightFailedTitle', expect.anything());
    expect(harness.listResources.mock.calls.length).toBeGreaterThan(callsBeforePrune);
  });

  it('explains incomplete reference state and refreshes before another cleanup attempt', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'volumes' ? [
      { name: 'cache', driver: 'local', referenced_containers: 0 },
    ] : []));
    harness.preflight.mockRejectedValue(new LocalApiError({
      message: 'Resource usage could not be confirmed. Refresh and try again.', status: 409, code: 'REFERENCE_STATE_INCOMPLETE',
    }));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.volumes'))?.click();
    await settle();
    const callsBeforePrune = harness.listResources.mock.calls.length;
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-test-dropdown-menu] button'))
      .find((button) => button.textContent?.includes('containers.actions.prune'))?.click();
    await settle();

    expect(harness.notify.error).toHaveBeenCalledWith(
      'containers.prune.referenceIncompleteTitle',
      'containers.prune.referenceIncompleteMessage',
    );
    expect(harness.listResources.mock.calls.length).toBeGreaterThan(callsBeforePrune);
  });

  it('allows choosing a resource view while environment permissions are loading', async () => {
    harness.setEnvironment(undefined);
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images'
      ? [{ id: 'image-1', reference: 'example/app:latest', referenced_containers: 0 }]
      : []));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(harness.listRuntimes).not.toHaveBeenCalled();
    expect(host.querySelector('[data-container-list-loading]')).not.toBeNull();
    expect(host.querySelector('[data-container-resource-skeleton-table]')).not.toBeNull();
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'));
    expect(tabs.every((tab) => !tab.disabled)).toBe(true);

    tabs.find((tab) => tab.textContent?.includes('containers.views.images'))?.click();
    await settle();
    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.views.images');

    harness.setEnvironment({ permissions: harness.permissions });
    await settle();
    expect(host.querySelector('[data-container-endpoint-bar]')).toBeNull();
    expect(host.querySelector('[data-container-resource-table]')).not.toBeNull();
    expect(harness.listResources).toHaveBeenCalledWith('images', 'docker', 'docker-primary', expect.anything());
    expect(host.textContent).toContain('example/app:latest');
  });

  it('keeps resource tabs interactive during loading and ignores stale view responses', async () => {
    const delayedImages = deferred<any[]>();
    harness.listResources.mockImplementation((nextView: string) => {
      if (nextView === 'images') return delayedImages.promise;
      if (nextView === 'volumes') return Promise.resolve([{ name: 'build-cache', driver: 'local', referenced_containers: 0 }]);
      return Promise.resolve([{ container_id: 'container-1', name: 'Managed API', state: 'running', management: { managed: false } }]);
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    const imagesTab = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((tab) => tab.textContent?.includes('containers.views.images'))!;
    imagesTab.click();
    await Promise.resolve();

    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.views.images');
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).every((tab) => !tab.disabled)).toBe(true);
    expect(host.querySelector('[data-container-list-loading]')).not.toBeNull();

    const volumesTab = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((tab) => tab.textContent?.includes('containers.views.volumes'))!;
    volumesTab.click();
    await settle();

    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.views.volumes');
    expect(host.textContent).toContain('build-cache');

    delayedImages.resolve([{ id: 'stale-image', reference: 'stale:latest', referenced_containers: 0 }]);
    await settle();

    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.views.volumes');
    expect(host.textContent).not.toContain('stale:latest');
  });

  it('applies live resource navigation to an already mounted Activity page', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage stateScope="activity" variant="activity" />, host);
    await settle();

    requestContainerResourceNavigation({
      engine: 'docker',
      endpointID: 'docker-primary',
      view: 'containers',
      identity: 'container-1',
    });
    await settle();

    expect(harness.storageWrites).toContainEqual({
      key: 'containers:navigation-request',
      value: {
        version: 1,
        engine: 'docker',
        endpointID: 'docker-primary',
        view: 'containers',
        selectedIdentity: 'container-1',
      },
    });
    expect(harness.storageWrites.some((entry) => entry.key === 'containers:activity' && (entry.value as { version?: number }).version === 2)).toBe(true);
    expect(harness.resourceDetails).toHaveBeenCalledWith('containers', 'container-1', 'docker', 'docker-primary', expect.any(AbortSignal));
  });

  it('shows the target detail skeleton immediately while live navigation resolves', async () => {
    const delayedImages = deferred<any[]>();
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage stateScope="activity" variant="activity" />, host);
    await settle();
    harness.listResources.mockImplementation((nextView: string) => nextView === 'images'
      ? delayedImages.promise
      : Promise.resolve([{
          container_id: 'container-1', name: 'Managed API', state: 'running', management: { managed: false },
        }]));

    requestContainerResourceNavigation({
      engine: 'docker',
      endpointID: 'docker-primary',
      view: 'images',
      identity: 'sha256:image-1',
    });
    await Promise.resolve();

    expect(host.querySelector('[data-container-detail-loading]')).not.toBeNull();
    expect(host.querySelector('[data-container-list-loading]')).toBeNull();
    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.views.images');

    delayedImages.resolve([{
      id: 'sha256:image-1', reference: 'example/api:latest', referenced_containers: 1,
    }]);
    await settle();

    expect(host.querySelector('[data-container-detail-loading]')).toBeNull();
    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('example/api:latest');
    expect(harness.listResources.mock.calls.filter(([nextView]) => nextView === 'images')).toHaveLength(1);
  });

  it.each([
    ['image ID', 'sha256:config-image'],
    ['image reference', 'ghcr.io/example/webtop:stable'],
    ['image tag', 'ghcr.io/example/webtop:current'],
    ['manifest digest', 'sha256:manifest-image'],
    ['digest-pinned reference', 'ghcr.io/example/webtop@sha256:manifest-image'],
  ])('opens an image detail from a pending navigation by %s', async (_label, identity) => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images' ? [{
      id: 'sha256:config-image',
      reference: 'ghcr.io/example/webtop:stable',
      digest: 'sha256:manifest-image',
      tags: ['ghcr.io/example/webtop:current'],
      size_bytes: 1024,
      referenced_containers: 1,
    }] : [{
      container_id: 'container-1', name: 'Managed API', state: 'running', management: { managed: false },
    }]));
    harness.resourceDetails.mockResolvedValue({ id: 'sha256:config-image' });
    requestContainerResourceNavigation({
      engine: 'docker',
      endpointID: 'docker-primary',
      view: 'images',
      identity,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => <EnvContainersPage stateScope="activity" variant="activity" />, host);
    await settle();

    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent).toContain('containers.views.images');
    expect(harness.resourceDetails).toHaveBeenCalledWith('images', 'sha256:config-image', 'docker', 'docker-primary', expect.any(AbortSignal));
    expect(host.querySelector('[data-container-detail-page]')).not.toBeNull();
  });

  it('opens an image detail from live navigation without replacing the canonical image identity', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images' ? [{
      id: 'sha256:config-image',
      reference: 'ghcr.io/example/webtop:stable',
      digest: 'sha256:manifest-image',
      tags: ['ghcr.io/example/webtop:current'],
      referenced_containers: 1,
    }] : [{
      container_id: 'container-1', name: 'Managed API', state: 'running', management: { managed: false },
    }]));
    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => <EnvContainersPage stateScope="activity" variant="activity" />, host);
    await settle();

    requestContainerResourceNavigation({
      engine: 'docker',
      endpointID: 'docker-primary',
      view: 'images',
      identity: 'ghcr.io/example/webtop@sha256:manifest-image',
    });
    await settle();

    expect(harness.resourceDetails).toHaveBeenCalledWith('images', 'sha256:config-image', 'docker', 'docker-primary', expect.any(AbortSignal));
    expect(host.querySelector('[data-container-detail-page]')).not.toBeNull();
  });

  it('reports an explicit navigation target that is absent without matching a similar digest', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images' ? [{
      id: 'sha256:config-image',
      reference: 'ghcr.io/example/webtop:stable',
      digest: 'sha256:manifest-image-other',
      tags: ['ghcr.io/example/webtop:current'],
      referenced_containers: 1,
    }] : [{
      container_id: 'container-1', name: 'Managed API', state: 'running', management: { managed: false },
    }]));
    requestContainerResourceNavigation({
      engine: 'docker',
      endpointID: 'docker-primary',
      view: 'images',
      identity: 'ghcr.io/example/webtop@sha256:manifest-image',
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => <EnvContainersPage stateScope="activity" variant="activity" />, host);
    await settle();

    expect(harness.resourceDetails).not.toHaveBeenCalled();
    expect(host.querySelector('[data-container-detail-page]')).toBeNull();
    expect(harness.notify.info).toHaveBeenCalledTimes(1);
    expect(harness.notify.info).toHaveBeenCalledWith(
      'containers.notifications.inventoryChangedTitle',
      'containers.notifications.inventoryChangedMessage',
    );
  });

  it('makes a large inventory scannable without repeating identifiers or ownership text', async () => {
    harness.listResources.mockResolvedValue([
      {
        container_id: 'container-1',
        name: 'Managed API',
        image: { reference: 'ghcr.io/redeven/api:latest' },
        state: 'running',
        health: 'healthy',
        group_name: 'redeven-stack',
        created_at_unix_ms: 1_700_000_000_000,
        management: { managed: true, owner: { kind: 'web_service', service_id: 'service-1', name: 'API' } },
      },
      {
        container_id: 'container-2',
        name: 'Build worker',
        image: { reference: 'debian:stable' },
        state: 'exited',
        management: { managed: false },
      },
    ]);
    harness.resourceDetails.mockResolvedValue({
      container_id: 'container-2',
      name: 'Build worker',
      image: { reference: 'debian:stable' },
      state: 'exited',
      runtime: { network_mode: 'bridge', restart_policy: 'no', privileged: false, read_only_root: true },
      ports: [{ protocol: 'tcp', host_ip: '127.0.0.1', host_port: 8080, port: 80 }],
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(host.querySelector('[data-container-summary]')?.textContent).toContain('containers.filters.active');
    expect(host.querySelector('.container-list-heading')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.container-filter-switch button[aria-pressed="true"]')?.textContent).toContain('containers.filters.active');
    expect(host.querySelector('.container-distribution__track')).toBeNull();
    expect(host.querySelector('thead')?.textContent).toContain('containers.columns.image');
    expect(host.querySelectorAll('thead th')).toHaveLength(5);
    expect(host.textContent).toContain('containers.states.running');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(host.querySelector('tbody tr')?.textContent).not.toContain('container-1');
    expect(host.querySelector('.container-managed-label')?.textContent).toBe('');
    const managedFilter = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-filter-switch button'))
      .find((button) => button.textContent?.includes('containers.filters.managed'));
    expect(managedFilter?.querySelector('[data-icon="lock"]')).not.toBeNull();
    expect(managedFilter?.textContent).toContain('1');
    managedFilter?.click();
    await settle();
    expect(managedFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('tbody')?.textContent).toContain('Managed API');

    const allFilter = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-filter-switch button'))
      .find((button) => button.textContent?.includes('containers.filters.all'));
    allFilter?.click();
    await settle();

    const search = host.querySelector<HTMLInputElement>('input[aria-label="containers.search.label"]');
    expect(search).not.toBeNull();
    search!.value = 'worker';
    search!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await settle();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(host.querySelector('tbody')?.textContent).toContain('Build worker');

    search!.value = '';
    search!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const inactiveFilter = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-filter-switch button'))
      .find((button) => button.textContent?.includes('containers.filters.inactive'));
    inactiveFilter?.click();
    await settle();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(host.querySelector('tbody')?.textContent).toContain('Build worker');

    (host.querySelector('tbody tr') as HTMLElement).click();
    await settle();
    expect(host.querySelector('[data-container-detail-page]')).not.toBeNull();
    expect(host.querySelector('.container-inspector')).toBeNull();
    await vi.waitFor(() => expect(host.querySelector('[data-container-detail-grid]')?.textContent).toContain('containers.inspector.networkMode'));
  });

  it('keeps a Web Services-managed resource read-only and links to its owner', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    (host.querySelector('tbody tr') as HTMLElement).click();
    await settle();
    const openService = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-detail-actions button'))
      .find((button) => button.textContent?.includes('API'));
    expect(openService).not.toBeNull();
    expect(host.textContent).not.toContain('containers.actions.remove');

    openService?.click();
    expect(harness.goActivity).toHaveBeenCalledWith('ports');
    expect(harness.storageWrites).toContainEqual({ key: 'webServices:focus', value: { version: 1, serviceID: 'service-1' } });
  });

  it('restores the inventory scroll position after leaving a dedicated detail page', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    const inventory = host.querySelector<HTMLElement>('.container-inventory-scroll');
    expect(inventory).not.toBeNull();
    inventory!.scrollTop = 240;
    (host.querySelector('tbody tr') as HTMLElement).click();
    await settle();

    host.querySelector<HTMLButtonElement>('button[aria-label="containers.detail.back"]')?.click();
    await settle();
    expect(host.querySelector<HTMLElement>('.container-inventory-scroll')?.scrollTop).toBe(240);
  });

  it('uses floe monitoring charts with truthful utilization scales and network rates', async () => {
    harness.subscribeStats.mockImplementation(async (_identity, _engine, _endpoint, observe) => {
      observe({
        sampled_at_unix_ms: 1_700_000_000_000,
        container_id: 'container-1',
        cpu_percent: 96.1,
        memory_bytes: 300_000_000,
        memory_limit: 1_073_741_824,
        network_rx_bytes: 1_024,
        network_tx_bytes: 500,
      });
      observe({
        sampled_at_unix_ms: 1_700_000_001_000,
        container_id: 'container-1',
        cpu_percent: 104.8,
        memory_bytes: 322_122_547,
        memory_limit: 1_073_741_824,
        network_rx_bytes: 3_048,
        network_tx_bytes: 1_524,
      });
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    (host.querySelector('tbody tr') as HTMLElement).click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent?.includes('containers.detailTabs.stats'))
      ?.click();
    await settle();

    const charts = Array.from(host.querySelectorAll<HTMLElement>('[data-monitoring-chart]'));
    expect(charts).toHaveLength(3);
    expect(charts.map((chart) => chart.dataset.seriesColors)).toEqual([
      'var(--redeven-runtime-monitor-cpu-line)',
      'var(--redeven-runtime-monitor-memory-line)',
      'var(--redeven-runtime-monitor-download-line),var(--redeven-runtime-monitor-upload-line)',
    ]);
    expect(charts[0].dataset.yMax).toBe('200');
    expect(charts[1].dataset.yMax).toBe('50');
    expect(charts.every((chart) => Number(chart.dataset.pointCount) >= 1)).toBe(true);
    expect(host.querySelector('[data-container-network-panel]')?.textContent).toContain('KB/s');
    expect(host.querySelector('.container-sparkline')).toBeNull();
  });

  it('does not expose container file browsing when the product cannot render it reliably', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    (host.querySelector('tbody tr') as HTMLElement).click();
    await settle();

    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).map((tab) => tab.textContent);
    expect(tabs).not.toContain('containers.detailTabs.files');
    expect(harness.listFiles).not.toHaveBeenCalled();
  });

  it('renders inspect filesystem layers separately from build history', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images' ? [{
      id: 'sha256:image-layered',
      reference: 'ghcr.io/floegence/flowersec-runtime',
      tags: [],
      size_bytes: 20_880_000,
      referenced_containers: 0,
    }] : [{
      container_id: 'container-1', name: 'Managed API', state: 'running', management: { managed: false },
    }]));
    harness.resourceDetails.mockResolvedValue({
      id: 'sha256:image-layered',
      reference: 'ghcr.io/floegence/flowersec-runtime',
      layers: [{ digest: 'sha256:root-layer' }, { digest: 'sha256:top-layer' }],
    });
    harness.imageBuildHistory.mockResolvedValue([
      { step: 0, operation: 'run', summary: 'bazel build @bookworm//base-files/amd64', filesystem_effect: 'filesystem', size_bytes: 10_400_000, created_at_unix_ms: 1_700_000_000_000 },
      { step: 1, operation: 'env', filesystem_effect: 'metadata_only', size_bytes: 0, created_at_unix_ms: 0 },
    ]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.images'))
      ?.click();
    await settle();
    (host.querySelector('tbody tr') as HTMLElement).click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent?.includes('containers.detailTabs.layers'))
      ?.click();
    await settle();

    expect(harness.imageBuildHistory).toHaveBeenCalledWith('sha256:image-layered', 'docker', 'docker-primary');
    expect(host.textContent).toContain('bazel');
    expect(host.textContent).not.toContain('containers.detail.buildOperations.run');

    harness.imageBuildHistory.mockClear();
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent?.includes('containers.detail.filesystemLayers'))
      ?.click();
    await settle();
    expect(host.querySelectorAll('.container-layer-row')).toHaveLength(3);
    expect(harness.imageBuildHistory).not.toHaveBeenCalled();

    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent?.includes('containers.detail.buildSteps'))
      ?.click();
    await settle();
    expect(harness.imageBuildHistory).toHaveBeenCalledWith('sha256:image-layered', 'docker', 'docker-primary');
    expect(host.textContent).toContain('containers.detail.buildEffects.metadata_only');
    expect(host.textContent).not.toContain('containers.detail.noIntermediateImage');
    expect(host.textContent).not.toContain('sha256:history-layer');
  });

  it.each([
    ['stopped', 'containers.runtimeStates.stopped'],
    ['permission', 'containers.runtimeStates.permission'],
  ])('renders a calm engine detection state for %s', async (state, label) => {
    harness.listRuntimes.mockResolvedValue([{ engine: 'docker', state }, { engine: 'podman', state: 'not_installed' }]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(host.querySelector('[data-container-engine-state]')?.textContent).toContain(label);
    expect(host.querySelector('[data-container-resource-table]')).toBeNull();
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'));
    expect(tabs).toHaveLength(3);
    expect(tabs.every((tab) => tab.disabled && tab.getAttribute('aria-disabled') === 'true')).toBe(true);
  });

  it('discards a delayed image response after a newer navigation target becomes ready', async () => {
    const delayedImages = deferred<any[]>();
    harness.listResources.mockImplementation((nextView: string) => {
      if (nextView === 'images') return delayedImages.promise;
      return Promise.resolve([{
        container_id: 'container-current',
        name: 'Current API',
        state: 'running',
        management: { managed: false },
      }]);
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage stateScope="activity" />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((tab) => tab.textContent?.includes('containers.views.images'))
      ?.click();
    await Promise.resolve();

    expect(host.textContent).not.toContain('Current API');
    expect(host.querySelector('[data-container-resource-table]')).toBeNull();
    expect(host.querySelector('[data-container-list-loading]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).every((tab) => !tab.disabled)).toBe(true);

    requestContainerResourceNavigation({
      engine: 'docker',
      endpointID: 'docker-primary',
      view: 'containers',
      identity: 'container-current',
    });
    await settle();
    delayedImages.resolve([{
      id: 'stale-image',
      reference: 'stale:latest',
      referenced_containers: 0,
    }]);
    await settle();

    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent).toContain('containers.views.containers');
    expect(host.textContent).toContain('Current API');
    expect(host.textContent).not.toContain('stale:latest');
  });

  it('restores a visited resource view immediately while refreshing it in the background', async () => {
    const refreshedContainers = deferred<any[]>();
    let containerRequests = 0;
    harness.listResources.mockImplementation((nextView: string) => {
      if (nextView === 'images') {
        return Promise.resolve([{ id: 'image-1', reference: 'nginx:latest', referenced_containers: 0 }]);
      }
      containerRequests += 1;
      if (containerRequests === 1) {
        return Promise.resolve([{ container_id: 'container-1', name: 'Cached API', state: 'running', management: { managed: false } }]);
      }
      return refreshedContainers.promise;
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((tab) => tab.textContent?.includes('containers.views.images'))
      ?.click();
    await settle();
    expect(host.textContent).toContain('nginx:latest');

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((tab) => tab.textContent?.includes('containers.views.containers'))
      ?.click();
    await Promise.resolve();

    expect(host.textContent).toContain('Cached API');
    expect(host.querySelector('[data-container-list-loading]')).toBeNull();
    expect(host.querySelector('[data-container-resource-table]')).not.toBeNull();
    expect(host.querySelector('main')?.getAttribute('aria-busy')).toBe('true');

    refreshedContainers.resolve([{ container_id: 'container-2', name: 'Fresh API', state: 'running', management: { managed: false } }]);
    await settle();
    expect(host.textContent).toContain('Fresh API');
    expect(host.textContent).not.toContain('Cached API');
    expect(host.querySelector('main')?.getAttribute('aria-busy')).toBe('false');
  });

  it('keeps the resolved inventory mounted while an explicit refresh revalidates the same endpoint', async () => {
    const refreshedRuntimes = deferred<any[]>();
    let runtimeRequests = 0;
    harness.listRuntimes.mockImplementation(() => {
      runtimeRequests += 1;
      if (runtimeRequests === 1) {
        return Promise.resolve([{
          endpoint_id: 'docker-primary', engine: 'docker', state: 'ready', capabilities: { collection_stats: true, volume_files: false, exec: false },
        }, { engine: 'podman', state: 'not_installed' }]);
      }
      return refreshedRuntimes.promise;
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();
    expect(host.textContent).toContain('Managed API');

    host.querySelector<HTMLButtonElement>('[aria-label="containers.actions.refresh"]')?.click();
    await Promise.resolve();

    expect(host.textContent).toContain('Managed API');
    expect(host.querySelector('[data-container-resource-table]')).not.toBeNull();
    expect(host.querySelector('[data-container-list-loading]')).toBeNull();
    expect(host.querySelector('main')?.getAttribute('aria-busy')).toBe('true');

    refreshedRuntimes.resolve([{
      endpoint_id: 'docker-primary', engine: 'docker', state: 'ready', capabilities: { collection_stats: true, volume_files: false, exec: false },
    }, { engine: 'podman', state: 'not_installed' }]);
    await settle();
    expect(host.querySelector('main')?.getAttribute('aria-busy')).toBe('false');
  });

  it('aggregates active Docker and Podman resources without exposing endpoint controls', async () => {
    harness.listRuntimes.mockResolvedValue([
      {
        endpoint_id: 'docker-primary', engine: 'docker', state: 'ready', capabilities: { collection_stats: true, volume_files: false, exec: false },
      },
      {
        endpoint_id: 'podman-primary', engine: 'podman', state: 'ready', capabilities: { collection_stats: true, volume_files: true, exec: false },
      },
    ]);
    harness.listResources.mockImplementation((_view: string, nextEngine: string, _nextEndpointID: string) => Promise.resolve([{
      container_id: `container-${nextEngine}`,
      name: 'Shared name',
      state: 'running',
      management: { managed: false },
    }]));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(host.querySelector('[data-container-endpoint-bar]')).toBeNull();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(Array.from(host.querySelectorAll('.container-runtime-badge')).map((item) => item.textContent)).toEqual(['containers.runtimeNames.docker', 'containers.runtimeNames.podman']);
    expect(harness.listResources).toHaveBeenCalledWith('containers', 'docker', 'docker-primary', expect.anything());
    expect(harness.listResources).toHaveBeenCalledWith('containers', 'podman', 'podman-primary', expect.anything());
    expect(host.querySelectorAll('.container-resource-tabs [role="tab"]')).toHaveLength(5);
  });

  it('routes a row operation to the runtime that owns the resource', async () => {
    harness.listRuntimes.mockResolvedValue([
      { endpoint_id: 'docker-primary', engine: 'docker', state: 'ready', capabilities: { collection_stats: true, volume_files: false, exec: false } },
      { endpoint_id: 'podman-primary', engine: 'podman', state: 'ready', capabilities: { collection_stats: true, volume_files: true, exec: false } },
    ]);
    harness.listResources.mockImplementation((_view: string, engine: string) => Promise.resolve([{
      container_id: `${engine}-container`, name: `${engine} service`, state: 'running', management: { managed: false },
    }]));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    const podmanRow = Array.from(host.querySelectorAll<HTMLTableRowElement>('tbody tr')).find((row) => row.textContent?.includes('podman service'));
    podmanRow?.querySelector<HTMLButtonElement>('button[aria-label="containers.actions.stop"]')?.click();
    await settle();

    expect(harness.preflight).toHaveBeenCalledWith('containers.stop', expect.objectContaining({
      engine: 'podman', endpoint_id: 'podman-primary', container_id: 'podman-container',
    }));
  });

  it('chooses a runtime only inside a multi-target pull dialog', async () => {
    harness.listRuntimes.mockResolvedValue([
      { endpoint_id: 'docker-primary', engine: 'docker', state: 'ready', capabilities: { collection_stats: true, volume_files: false, exec: false } },
      { endpoint_id: 'podman-primary', engine: 'podman', state: 'ready', capabilities: { collection_stats: true, volume_files: true, exec: false } },
    ]);
    harness.listResources.mockResolvedValue([]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).find((tab) => tab.textContent?.includes('containers.views.images'))?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('containers.create.image'))?.click();
    await settle();

    const dialog = host.querySelector<HTMLElement>('[data-dialog]')!;
    const target = dialog.querySelector<HTMLSelectElement>('select')!;
    expect(target.options).toHaveLength(2);
    expect(target.value).toBe('docker\u0000docker-primary');
    target.value = 'podman\u0000podman-primary';
    target.dispatchEvent(new Event('change', { bubbles: true }));
    const image = dialog.querySelector<HTMLInputElement>('input')!;
    image.value = 'docker.io/library/alpine:latest';
    image.dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('containers.actions.review'))?.click();
    await settle();

    expect(harness.preflight).toHaveBeenCalledWith('images.pull', expect.objectContaining({
      engine: 'podman', endpoint_id: 'podman-primary', image_ref: 'docker.io/library/alpine:latest',
    }));
  });

  it('keeps usable resources visible and explains a partial runtime failure', async () => {
    harness.listServices.mockResolvedValue([
      {
        service_id: 'container_service_docker', engine: 'docker', name: 'Docker Engine', implementation: 'docker_engine', state: 'running',
        capabilities: { start: false, stop: true, restart: true },
        configuration: { mode: 'unavailable' },
      },
      {
        service_id: 'container_service_podman', engine: 'podman', name: 'Podman', implementation: 'unavailable', state: 'not_installed',
        capabilities: { start: false, stop: false, restart: false },
        configuration: { mode: 'unavailable' },
        guidance_code: 'install',
      },
    ]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(host.textContent).toContain('Managed API');
    const warning = host.querySelector<HTMLButtonElement>('[aria-label="containers.services.title"]');
    expect(warning).not.toBeNull();
    warning?.click();
    await settle();
    expect(host.querySelector('[data-container-services-page]')?.textContent).toContain('containers.services.states.not_installed');
  });

  it('ignores retired v1 page state instead of restoring an endpoint selection', async () => {
    harness.storageValues.set('containers:activity', {
      version: 1, engine: 'podman', endpointID: 'retired', view: 'pods', selectedIdentity: 'retired-pod',
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage stateScope="activity" />, host);
    await settle();

    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent).toContain('containers.views.containers');
    expect(harness.storageWrites).toContainEqual({
      key: 'containers:activity', value: { version: 2, view: 'containers', selectedResourceKey: '' },
    });
  });

  it('retries engine detection and reaches one coherent ready state', async () => {
    harness.listRuntimes.mockResolvedValueOnce([{ engine: 'docker', state: 'stopped' }, { engine: 'podman', state: 'not_installed' }]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(host.querySelector('[data-container-engine-state="unavailable"]')).not.toBeNull();
    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('containers.engineState.retry'))
      ?.click();
    await settle();

    expect(host.querySelector('[data-container-engine-state]')).toBeNull();
    expect(host.querySelector('[data-container-endpoint-bar]')).toBeNull();
    expect(host.querySelector('[data-container-resource-table]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).every((tab) => !tab.disabled)).toBe(true);
  });

  it('uses resource-specific columns for images, volumes, Compose projects, and pods', async () => {
    harness.listRuntimes.mockResolvedValue([
      { endpoint_id: 'docker-primary', engine: 'docker', state: 'ready', capabilities: { collection_stats: true, volume_files: false, exec: false } },
      { endpoint_id: 'podman-primary', engine: 'podman', state: 'ready', capabilities: { collection_stats: true, volume_files: true, exec: false } },
    ]);
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve({
      containers: [{ container_id: 'container-1', name: 'API', state: 'running', management: { managed: false } }],
      images: [{ id: 'image-1', reference: 'nginx:latest', tags: ['nginx:latest'], size_bytes: 1024, referenced_containers: 1 }],
      volumes: [{ name: 'data', driver: 'local', scope: 'local', referenced_containers: 1, management: { managed: false } }],
      'compose-projects': [{ project_id: 'project-1', name: 'Stack', status: 'running', service_count: 2, container_count: 2, running_count: 2, management: { managed: false } }],
      pods: [{ pod_id: 'pod-1', name: 'Application', status: 'running', container_count: 3, running_count: 2, created_at_unix_ms: 1_700_000_000_000 }],
    }[nextView] ?? []));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    const openView = async (label: string) => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).find((button) => button.textContent?.includes(label))?.click();
      await settle();
    };
    await openView('containers.views.images');
    expect(host.querySelector('thead')?.textContent).toContain('containers.columns.size');
    expect(host.querySelector('thead')?.textContent).toContain('containers.columns.created');
    await openView('containers.views.volumes');
    expect(host.querySelector('thead')?.textContent).toContain('containers.columns.driver');
    expect(host.querySelector('thead')?.textContent).toContain('containers.columns.created');
    await openView('containers.views.compose-projects');
    expect(host.querySelector('thead')?.textContent).toContain('containers.columns.running');
    expect(host.querySelector('thead')?.textContent).toContain('containers.columns.status');

    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((button) => button.textContent === 'podman')?.click();
    await settle();
    await openView('containers.views.pods');
    expect(host.querySelector('thead')?.textContent).toContain('containers.columns.status');
    expect(host.querySelector('tbody')?.textContent).toContain('Application');
  });

  it('degrades mutation controls when the session lacks Write and Admin', async () => {
    Object.assign(harness.permissions, { can_write: false, can_execute: false, can_admin: false, is_owner: false });
    harness.listResources.mockResolvedValue([{
      container_id: 'container-2', name: 'Worker', state: 'stopped', management: { managed: false },
    }]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'containers.filters.all')?.click();
    await settle();

    const create = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('containers.create.container'));
    expect(create?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="containers.actions.start"]')?.disabled).toBe(true);
    (host.querySelector('tbody tr') as HTMLElement).click();
    await settle();
    const remove = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('containers.actions.remove'));
    expect(remove?.disabled).toBe(true);
  });

  it('runs a row lifecycle action without navigating away from the inventory', async () => {
    harness.listResources.mockResolvedValue([{ container_id: 'container-2', name: 'Worker', state: 'stopped', management: { managed: false } }]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'containers.filters.all')?.click();
    await settle();

    host.querySelector<HTMLButtonElement>('button[aria-label="containers.actions.start"]')?.click();
    await settle();

    expect(host.querySelector('[data-container-detail-page]')).toBeNull();
    expect(harness.preflight).toHaveBeenCalledWith('containers.start', expect.objectContaining({ container_id: 'container-2' }));
  });

  it('serializes exact arguments and localhost-only port defaults from the run form', async () => {
    harness.listResources.mockResolvedValue([]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('containers.create.container'))?.click();
    await settle();
    const form = host.querySelector<HTMLElement>('.container-run-form')!;
    const dialog = form.closest<HTMLElement>('[data-dialog]')!;
    const setInput = (selector: string, value: string) => {
      const input = dialog.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    };
    const basics = form.querySelectorAll<HTMLInputElement>('.container-run-section:first-of-type input');
    basics[0].value = 'alpine:3.22';
    basics[0].dispatchEvent(new InputEvent('input', { bubbles: true }));
    basics[1].value = 'worker';
    basics[1].dispatchEvent(new InputEvent('input', { bubbles: true }));
    basics[2].value = '/usr/bin/env';
    basics[2].dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('containers.run.addArgument'))?.click();
    setInput('input[placeholder="--config"]', 'sh');
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('containers.run.addPort'))?.click();
    setInput('.container-run-port-row input', '8080');
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('containers.run.addVariable'))?.click();
    const environment = dialog.querySelectorAll<HTMLInputElement>('.container-run-key-value input');
    environment[0].value = 'APP_ENV';
    environment[0].dispatchEvent(new InputEvent('input', { bubbles: true }));
    const environmentValue = dialog.querySelectorAll<HTMLInputElement>('.container-run-key-value input')[1];
    environmentValue.value = 'production';
    environmentValue.dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('containers.actions.review'))?.click();
    await settle();

    expect(harness.preflight).toHaveBeenCalledWith('containers.create', expect.objectContaining({
      engine: 'docker', endpoint_id: 'docker-primary', image: 'alpine:3.22', name: 'worker',
      entrypoint: '/usr/bin/env', command: ['sh'], env: ['APP_ENV=production'],
      restart_policy: 'no', network_mode: 'bridge',
      ports: [{ container_port: 8080, host_ip: '127.0.0.1', protocol: 'tcp' }],
    }));
  });

  it('offers image ports without publishing them until selected', async () => {
    harness.listResources.mockImplementation(async (view: string) => view === 'images'
      ? [{ id: 'image-1', reference: 'nginx:latest', referenced_containers: 0 }]
      : []);
    harness.resourceDetails.mockResolvedValue({ id: 'image-1', exposed_ports: ['80/tcp', '53/udp'] });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.images'))?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('button[aria-label="containers.actions.run"]')?.click();
    await settle();

    const suggestion = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-run-port-suggestions button'))
      .find((button) => button.textContent?.includes('80/tcp'));
    expect(suggestion).not.toBeNull();
    expect(host.querySelector('.container-run-port-row')).toBeNull();
    suggestion?.click();
    const inputs = host.querySelectorAll<HTMLInputElement>('.container-run-port-row input');
    expect(inputs[0]?.value).toBe('80');
    expect(inputs[1]?.value).toBe('');
    expect(inputs[2]?.value).toBe('127.0.0.1');
  });

  it('opens an exact-argv Exec session only for a running unmanaged container', async () => {
    harness.listRuntimes.mockResolvedValue([{
      endpoint_id: 'docker-primary', engine: 'docker', state: 'ready',
      capabilities: { collection_stats: true, volume_files: false, exec: true },
    }]);
    harness.listResources.mockResolvedValue([{
      container_id: 'container-2', name: 'Worker', state: 'running', management: { managed: false },
    }]);
    harness.resourceDetails.mockResolvedValue({ container_id: 'container-2', name: 'Worker', state: 'running', management: { managed: false } });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    host.querySelector<HTMLButtonElement>('button[aria-label="containers.exec.open"]')?.click();
    await settle();
    expect(harness.createExecSession).toHaveBeenCalledWith('container-2', 'docker', 'docker-primary', ['/bin/sh']);
    expect(host.querySelector('[data-container-exec-terminal]')?.getAttribute('data-session-id')).toBe('exec-session-1');
    expect(host.querySelector('.container-detail-tabs [role="tab"][aria-selected="true"]')?.textContent).toContain('containers.detailTabs.exec');

    host.querySelector<HTMLButtonElement>('button[aria-label="containers.detail.back"]')?.click();
    await settle();
    expect(harness.deleteExecSession).toHaveBeenCalledWith('exec-session-1');
  });

  it('retries a replacement Exec session with the last command that became interactive', async () => {
    harness.listRuntimes.mockResolvedValue([{
      endpoint_id: 'docker-primary', engine: 'docker', state: 'ready',
      capabilities: { collection_stats: true, volume_files: false, exec: true },
    }]);
    harness.listResources.mockResolvedValue([{
      container_id: 'container-2', name: 'Worker', state: 'running', management: { managed: false },
    }]);
    harness.resourceDetails.mockResolvedValue({ container_id: 'container-2', name: 'Worker', state: 'running', management: { managed: false } });
    harness.createExecSession
      .mockResolvedValueOnce({ session_id: 'exec-session-sh' })
      .mockResolvedValueOnce({ session_id: 'exec-session-bash' })
      .mockResolvedValueOnce({ session_id: 'exec-session-retry' });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    host.querySelector<HTMLButtonElement>('button[aria-label="containers.exec.open"]')?.click();
    await settle();
    harness.execTerminalProps.get('exec-session-sh')?.onSessionReady?.('exec-session-sh');

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-exec-programs button'))
      .find((button) => button.textContent === 'bash')?.click();
    await settle();
    harness.execTerminalProps.get('exec-session-bash')?.onSessionGone?.('exec-session-bash');
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-exec-error button'))
      .find((button) => button.textContent?.includes('containers.actions.retry'))?.click();
    await settle();

    expect(harness.createExecSession).toHaveBeenLastCalledWith(
      'container-2', 'docker', 'docker-primary', ['/bin/sh'],
    );
    expect(host.querySelector('[data-container-exec-terminal]')?.getAttribute('data-session-id')).toBe('exec-session-retry');
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.container-exec-programs button'))
      .find((button) => button.textContent === 'sh')?.dataset.variant).toBe('default');

    harness.execTerminalProps.get('exec-session-bash')?.onSessionGone?.('exec-session-bash');
    await settle();
    expect(host.querySelector('[data-container-exec-terminal]')?.getAttribute('data-session-id')).toBe('exec-session-retry');
  });

  it('retries the same Exec command after that command became interactive', async () => {
    harness.listRuntimes.mockResolvedValue([{
      endpoint_id: 'docker-primary', engine: 'docker', state: 'ready',
      capabilities: { collection_stats: true, volume_files: false, exec: true },
    }]);
    harness.listResources.mockResolvedValue([{
      container_id: 'container-2', name: 'Worker', state: 'running', management: { managed: false },
    }]);
    harness.resourceDetails.mockResolvedValue({ container_id: 'container-2', name: 'Worker', state: 'running', management: { managed: false } });
    harness.createExecSession
      .mockResolvedValueOnce({ session_id: 'exec-session-sh' })
      .mockResolvedValueOnce({ session_id: 'exec-session-bash' })
      .mockResolvedValueOnce({ session_id: 'exec-session-retry' });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    host.querySelector<HTMLButtonElement>('button[aria-label="containers.exec.open"]')?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-exec-programs button'))
      .find((button) => button.textContent === 'bash')?.click();
    await settle();
    harness.execTerminalProps.get('exec-session-bash')?.onSessionReady?.('exec-session-bash');
    harness.execTerminalProps.get('exec-session-bash')?.onSessionGone?.('exec-session-bash');
    await settle();

    host.querySelector<HTMLButtonElement>('.container-exec-error button')?.click();
    await settle();
    expect(harness.createExecSession).toHaveBeenLastCalledWith(
      'container-2', 'docker', 'docker-primary', ['/bin/bash'],
    );
  });

  it('retries the requested Exec command when session creation fails', async () => {
    harness.listRuntimes.mockResolvedValue([{
      endpoint_id: 'docker-primary', engine: 'docker', state: 'ready',
      capabilities: { collection_stats: true, volume_files: false, exec: true },
    }]);
    harness.listResources.mockResolvedValue([{
      container_id: 'container-2', name: 'Worker', state: 'running', management: { managed: false },
    }]);
    harness.resourceDetails.mockResolvedValue({ container_id: 'container-2', name: 'Worker', state: 'running', management: { managed: false } });
    harness.createExecSession
      .mockResolvedValueOnce({ session_id: 'exec-session-sh' })
      .mockRejectedValueOnce(new Error('exec transport unavailable'))
      .mockResolvedValueOnce({ session_id: 'exec-session-retry' });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    host.querySelector<HTMLButtonElement>('button[aria-label="containers.exec.open"]')?.click();
    await settle();
    harness.execTerminalProps.get('exec-session-sh')?.onSessionReady?.('exec-session-sh');
    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-exec-programs button'))
      .find((button) => button.textContent === 'bash')?.click();
    await settle();

    expect(host.querySelector('.container-exec-error')?.textContent).toContain('exec transport unavailable');
    host.querySelector<HTMLButtonElement>('.container-exec-error button')?.click();
    await settle();
    expect(harness.createExecSession).toHaveBeenLastCalledWith(
      'container-2', 'docker', 'docker-primary', ['/bin/bash'],
    );
    expect(host.querySelector('[data-container-exec-terminal]')?.getAttribute('data-session-id')).toBe('exec-session-retry');
  });

  it('clears stale inventory and presents refresh failure recovery', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();
    harness.listResources.mockRejectedValueOnce(new Error('engine temporarily unavailable'));

    const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="containers.actions.refresh"]');
    refresh?.click();
    await settle();

    expect(host.querySelector('[data-container-engine-state="unavailable"]')?.textContent).toContain('containers.runtimeStates.error');
    expect(host.textContent).not.toContain('Managed API');
    expect(host.querySelector('[data-container-resource-table]')).toBeNull();
  });

  it('shows real operation phases and errors in the Operations drawer', async () => {
    harness.listOperations.mockResolvedValue([{
      operation_id: 'container_operation_pull', request_id: 'request-pull', request_hash: 'request', plan_hash: 'plan',
      method: 'images.pull', engine: 'docker', endpoint_id: 'docker-primary', resource_kind: 'image',
      resource_identity: 'golang:1.26', state: 'running', cancel_requested: false,
      created_at_unix_ms: 1, started_at_unix_ms: 2, updated_at_unix_ms: 3,
    }]);
    harness.listOperationEvents.mockResolvedValue([{
      sequence: 3, operation_id: 'container_operation_pull', type: 'progress', state: 'running',
      payload: { phase: 'pulling', completed_layers: 2, total_layers: 5 }, created_at_unix_ms: 3,
    }]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();
    await settle();

    host.querySelector<HTMLButtonElement>('button[aria-label="containers.operations.title"]')?.click();
    await settle();
    await settle();

    expect(host.innerHTML).toContain('golang:1.26');
    const detail = host.querySelector('.container-operation-detail');
    expect(detail?.textContent).toContain('containers.operations.phases.pulling');
    expect(detail?.textContent).toContain('2 / 5 containers.operations.layers');
    expect(detail?.textContent).toContain('containers.operations.progressTitle');
    expect(harness.subscribeOperationEvents).toHaveBeenCalledWith(
      'container_operation_pull', expect.any(Function), expect.any(AbortSignal), 3,
    );
  });

  it('saves an absolute Compose file as a reusable project', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'compose-projects' ? [] : [{
      container_id: 'container-1', name: 'API', state: 'running', management: { managed: false },
    }]));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.compose-projects'))?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('containers.compose.add'))?.click();
    await settle();

    const dialog = host.querySelector('[data-dialog]')!;
    const inputs = dialog.querySelectorAll<HTMLInputElement>('input');
    inputs[0].value = 'Saved API';
    inputs[0].dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(inputs[0].getAttribute('aria-invalid')).toBe('true');
    inputs[0].value = 'Saved-API';
    inputs[0].dispatchEvent(new InputEvent('input', { bubbles: true }));
    inputs[1].value = '/workspace/compose.yaml';
    inputs[1].dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('containers.compose.addPath'))?.click();
    inputs[3].value = 'dev,observability,';
    inputs[3].dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('containers.compose.save'))?.click();
    await settle();

    expect(harness.createComposeDefinition).toHaveBeenCalledWith({
      engine: 'docker', endpoint_id: 'docker-primary', name: 'saved-api',
      config_paths: ['/workspace/compose.yaml'], profiles: ['dev', 'observability'],
    });
  });

  it('keeps picker order, suggests a project name, and saves an environment file', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'compose-projects' ? [] : []));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.compose-projects'))?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('containers.compose.add'))?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dialog] button'))
      .find((button) => button.textContent?.includes('containers.compose.chooseFiles'))?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-file-open-picker] [data-picker-confirm]')?.click();
    await settle();

    const dialog = host.querySelector<HTMLElement>('[data-dialog]')!;
    expect(dialog.querySelector<HTMLInputElement>('input')?.value).toBe('my-app');
    expect(dialog.textContent).toContain('/workspace/my-app/compose.yaml');
    expect(dialog.textContent).toContain('/workspace/my-app/compose.override.yaml');

    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'containers.compose.chooseFile')?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-file-open-picker] [data-picker-confirm]')?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dialog] button'))
      .find((button) => button.textContent?.includes('containers.compose.save'))?.click();
    await settle();

    expect(harness.createComposeDefinition).toHaveBeenCalledWith({
      engine: 'docker', endpoint_id: 'docker-primary', name: 'my-app',
      config_paths: ['/workspace/my-app/compose.yaml', '/workspace/my-app/compose.override.yaml'],
      env_file_path: '/workspace/my-app/.env', profiles: [],
    });
  });

  it('keeps manual Compose paths usable when the file picker is unavailable', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'compose-projects' ? [] : []));
    harness.fsList.mockRejectedValueOnce(new Error('filesystem unavailable'));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.compose-projects'))?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('containers.compose.add'))?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dialog] button'))
      .find((button) => button.textContent?.includes('containers.compose.chooseFiles'))?.click();
    await settle();

    expect(host.querySelector('[data-file-open-picker]')).toBeNull();
    expect(harness.notify.error).toHaveBeenCalledWith(
      'containers.notifications.filePickerFailedTitle',
      'filesystem unavailable',
    );

    const dialog = host.querySelector<HTMLElement>('[data-dialog]')!;
    const inputs = dialog.querySelectorAll<HTMLInputElement>('input');
    inputs[0].value = 'Manual-API';
    inputs[0].dispatchEvent(new InputEvent('input', { bubbles: true }));
    inputs[1].value = '/workspace/manual/compose.yaml';
    inputs[1].dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('containers.compose.addPath'))?.click();
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('containers.compose.save'))?.click();
    await settle();

    expect(harness.createComposeDefinition).toHaveBeenCalledWith({
      engine: 'docker', endpoint_id: 'docker-primary', name: 'manual-api',
      config_paths: ['/workspace/manual/compose.yaml'], profiles: [],
    });
  });

  it('opens the exact same-runtime image from a container and restores the container detail', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images'
      ? [{ id: 'sha256:abcdef', reference: 'example/api:latest', tags: ['example/api:latest'] }]
      : [{ container_id: 'container-1', name: 'API', state: 'running', image_id: 'sha256:abcdef', image: { reference: 'example/api:latest' }, management: { managed: false } }]));
    harness.resourceDetails.mockImplementation((nextView: string) => Promise.resolve(nextView === 'containers'
      ? { container_id: 'container-1', state: 'running', image: { reference: 'example/api:latest' } }
      : { id: 'sha256:abcdef', reference: 'example/api:latest' }));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    host.querySelector<HTMLButtonElement>('.container-secondary-cell .container-resource-link')?.click();
    await settle();
    expect(harness.listResources).toHaveBeenCalledWith('images', 'docker', 'docker-primary', expect.anything());
    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('example/api:latest');

    host.querySelector<HTMLButtonElement>('[data-container-detail-page] button[aria-label="containers.detail.back"]')?.click();
    await settle();
    expect(host.querySelector('[data-container-detail-page]')).toBeNull();
    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.views.containers');
  });

  it('keeps a newly selected container open when the return refresh finishes', async () => {
    const refreshedContainers = deferred<any[]>();
    const containers = [
      { container_id: 'container-1', name: 'API', state: 'running', image_id: 'sha256:abcdef', image: { reference: 'example/api:latest' }, management: { managed: false } },
      { container_id: 'container-2', name: 'Worker', state: 'running', image_id: 'sha256:fedcba', image: { reference: 'example/worker:latest' }, management: { managed: false } },
    ];
    let containerRequests = 0;
    harness.listResources.mockImplementation((nextView: string) => {
      if (nextView === 'images') {
        return Promise.resolve([{ id: 'sha256:abcdef', reference: 'example/api:latest', tags: ['example/api:latest'] }]);
      }
      containerRequests += 1;
      return containerRequests === 1 ? Promise.resolve(containers) : refreshedContainers.promise;
    });
    harness.resourceDetails.mockImplementation((nextView: string, identity: string) => Promise.resolve(nextView === 'images'
      ? { id: 'sha256:abcdef', reference: 'example/api:latest' }
      : { container_id: identity, name: identity === 'container-2' ? 'Worker' : 'API', state: 'running' }));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    host.querySelector<HTMLButtonElement>('.container-secondary-cell .container-resource-link')?.click();
    await settle();
    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('example/api:latest');

    host.querySelector<HTMLButtonElement>('[data-container-detail-page] button[aria-label="containers.detail.back"]')?.click();
    await Promise.resolve();
    expect(host.querySelector('[data-container-detail-page]')).toBeNull();

    host.querySelectorAll<HTMLTableRowElement>('tbody tr')[1]?.click();
    await settle();
    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('Worker');

    refreshedContainers.resolve(containers);
    await settle();

    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('Worker');
    expect(harness.listResources.mock.calls.filter(([nextView]) => nextView === 'containers')).toHaveLength(2);
  });

  it('distinguishes Compose detail loading, failure, retry, and an empty result', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'compose-projects'
      ? [{ project_id: 'project-1', name: 'Stack', status: 'running', container_count: 1, running_count: 1, management: { managed: false } }]
      : []));
    const pending = deferred<unknown>();
    harness.resourceDetails.mockReturnValueOnce(pending.promise).mockResolvedValue({ project: { project_id: 'project-1', containers: [] } });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.compose-projects'))?.click();
    await settle();
    host.querySelector<HTMLTableRowElement>('tbody tr')?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-detail-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.detailTabs.containers'))?.click();
    await settle();
    expect(host.querySelector('[data-container-detail-loading]')).not.toBeNull();
    expect(host.textContent).not.toContain('containers.detail.emptyReferences');
    pending.reject(new Error('private engine failure'));
    await settle();
    expect(host.querySelector('[data-container-detail-error]')).not.toBeNull();
    expect(host.textContent).not.toContain('containers.detail.emptyReferences');
    expect(host.textContent).not.toContain('private engine failure');
    host.querySelector<HTMLButtonElement>('[data-container-detail-error] button')?.click();
    await settle();
    expect(host.querySelector('[data-container-detail-error]')).toBeNull();
    expect(host.textContent).toContain('containers.detail.emptyReferences');
    expect(harness.resourceDetails).toHaveBeenCalledTimes(2);
  });

  it('cancels an old detail request and ignores its late response after switching resources', async () => {
    const pending = deferred<unknown>();
    harness.listResources.mockResolvedValue([
      { container_id: 'container-1', name: 'API', state: 'running', management: { managed: false } },
      { container_id: 'container-2', name: 'Worker', state: 'running', management: { managed: false } },
    ]);
    harness.resourceDetails.mockImplementation((_view: string, identity: string) => identity === 'container-1'
      ? pending.promise
      : Promise.resolve({ container_id: identity, runtime: { network_mode: 'worker-network' } }));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();
    host.querySelector<HTMLTableRowElement>('tbody tr')?.click();
    await settle();
    const oldSignal = harness.resourceDetails.mock.calls[0][4] as AbortSignal;
    host.querySelector<HTMLButtonElement>('button[aria-label="containers.detail.back"]')?.click();
    await settle();
    host.querySelectorAll<HTMLTableRowElement>('tbody tr')[1]?.click();
    await settle();
    expect(oldSignal.aborted).toBe(true);
    expect(host.textContent).toContain('worker-network');
    pending.resolve({ container_id: 'container-1', runtime: { network_mode: 'stale-network' } });
    await settle();
    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('Worker');
    expect(host.textContent).toContain('worker-network');
    expect(host.textContent).not.toContain('stale-network');
  });

  it('opens a Compose member as a container detail and restores the Compose detail on back', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'compose-projects'
      ? [{ project_id: 'project-1', name: 'Stack', status: 'running', container_count: 1, running_count: 1, management: { managed: false } }]
      : [{ container_id: 'container-full-1', name: 'API', state: 'running', management: { managed: false } }]));
    harness.resourceDetails.mockImplementation((nextView: string) => Promise.resolve(nextView === 'compose-projects'
      ? {
        project: {
          project_id: 'project-1', name: 'Stack', status: 'running',
          containers: [{ container_id: 'container-full-1', name: 'API', state: 'running' }],
        },
        management: { managed: false },
      }
      : { container_id: 'container-full-1', name: 'API', state: 'running' }));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.compose-projects'))?.click();
    await settle();
    host.querySelector<HTMLTableRowElement>('tbody tr')?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-detail-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.detailTabs.containers'))?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('.container-reference-row')?.click();
    await settle();

    expect(harness.resourceDetails).toHaveBeenCalledWith('containers', 'container-full-1', 'docker', 'docker-primary', expect.any(AbortSignal));
    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('API');
    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.views.containers');

    host.querySelector<HTMLButtonElement>('[data-container-detail-page] button[aria-label="containers.detail.back"]')?.click();
    await settle();
    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('Stack');
    expect(host.querySelector('.container-detail-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.detailTabs.containers');
  });

  it('opens a volume user as a container detail and restores the volume detail on back', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'volumes'
      ? [{ name: 'api-data', driver: 'local', referenced_containers: 1 }]
      : [{ container_id: 'container-full-1', name: 'API', state: 'running', management: { managed: false } }]));
    harness.resourceDetails.mockImplementation((nextView: string) => Promise.resolve(nextView === 'volumes'
      ? { name: 'api-data', driver: 'local', used_by: [{ container_id: 'container-full-1', name: 'API', state: 'running' }] }
      : { container_id: 'container-full-1', name: 'API', state: 'running' }));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.volumes'))?.click();
    await settle();
    host.querySelector<HTMLTableRowElement>('tbody tr')?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-detail-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.detailTabs.used-by'))?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('.container-reference-row')?.click();
    await settle();

    expect(harness.resourceDetails).toHaveBeenCalledWith('containers', 'container-full-1', 'docker', 'docker-primary', expect.any(AbortSignal));
    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('API');

    host.querySelector<HTMLButtonElement>('[data-container-detail-page] button[aria-label="containers.detail.back"]')?.click();
    await settle();
    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('api-data');
    expect(host.querySelector('.container-detail-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.detailTabs.used-by');
  });

  it('replaces a related resource detail with a target skeleton before loading inventory', async () => {
    const delayedContainers = deferred<any[]>();
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'volumes'
      ? [{ name: 'api-data', driver: 'local', referenced_containers: 1 }]
      : [{ container_id: 'container-1', name: 'Managed API', state: 'running', management: { managed: false } }]));
    harness.resourceDetails.mockImplementation((nextView: string) => Promise.resolve(nextView === 'volumes'
      ? { name: 'api-data', driver: 'local', used_by: [{ container_id: 'container-full-1', name: 'API', state: 'running' }] }
      : { container_id: 'container-full-1', name: 'API', state: 'running' }));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.volumes'))?.click();
    await settle();
    host.querySelector<HTMLTableRowElement>('tbody tr')?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-detail-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.detailTabs.used-by'))?.click();
    await settle();
    harness.listResources.mockImplementation((nextView: string) => nextView === 'containers'
      ? delayedContainers.promise
      : Promise.resolve([{ name: 'api-data', driver: 'local', referenced_containers: 1 }]));
    host.querySelector<HTMLButtonElement>('.container-reference-row')?.click();
    await Promise.resolve();

    expect(host.querySelector('[data-container-detail-loading]')).not.toBeNull();
    expect(host.querySelector('[data-container-detail-page] h2')).toBeNull();
    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.views.containers');

    delayedContainers.resolve([{
      container_id: 'container-full-1', name: 'API', state: 'running', management: { managed: false },
    }]);
    await settle();

    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('API');
    expect(harness.listResources.mock.calls.filter(([nextView]) => nextView === 'containers')).toHaveLength(2);
  });

  it('keeps the source detail visible when a related container no longer exists', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'volumes'
      ? [{ name: 'api-data', driver: 'local', referenced_containers: 1 }]
      : []));
    harness.resourceDetails.mockResolvedValue({
      name: 'api-data', driver: 'local',
      used_by: [{ container_id: 'container-removed', name: 'Removed API', state: 'stopped' }],
    });
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.views.volumes'))?.click();
    await settle();
    host.querySelector<HTMLTableRowElement>('tbody tr')?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-detail-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.detailTabs.used-by'))?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('.container-reference-row')?.click();
    await settle();

    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('api-data');
    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent)
      .toContain('containers.views.volumes');
    expect(harness.notify.info).toHaveBeenCalledWith(
      'containers.notifications.relatedMissingTitle',
      'containers.notifications.relatedMissingMessage',
    );
  });

  it('opens named volumes from Mounts while leaving bind mounts non-interactive', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'volumes'
      ? [{ name: 'api-data', driver: 'local', referenced_containers: 1 }]
      : [{ container_id: 'container-1', name: 'API', state: 'running', management: { managed: false } }]));
    harness.resourceDetails.mockImplementation((nextView: string) => Promise.resolve(nextView === 'containers'
      ? {
        container_id: 'container-1', state: 'running', runtime: { mounts: [
          { type: 'volume', source: 'api-data', source_kind: 'named_volume', target: '/data', read_only: true },
          { type: 'bind', source_kind: 'host_path', target: '/app', read_only: false },
        ] },
      }
      : { name: 'api-data', driver: 'local', referenced_containers: 1 }));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    host.querySelector<HTMLTableRowElement>('tbody tr')?.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.container-detail-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('containers.detailTabs.mounts'))?.click();
    await settle();
    expect(host.querySelectorAll('.container-mount-row--link')).toHaveLength(1);
    expect(host.querySelector('.container-mount-row:not(.container-mount-row--link)')?.textContent).toContain('/app');
    host.querySelector<HTMLButtonElement>('.container-mount-row--link')?.click();
    await settle();

    expect(harness.listResources).toHaveBeenCalledWith('volumes', 'docker', 'docker-primary', expect.anything());
    expect(host.querySelector('[data-container-detail-page] h2')?.textContent).toBe('api-data');
  });

  it('uses filter and lifecycle-specific icons from the shared action map', async () => {
    harness.listResources.mockResolvedValue([{
      container_id: 'container-1', name: 'API', state: 'running', management: { managed: false },
    }]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(host.querySelector('[data-icon="filter"]')).not.toBeNull();
    expect(host.querySelector('.container-resource-toolbar [data-icon="settings"]')).toBeNull();
    expect(host.querySelector('[aria-label="containers.services.title"] [data-icon="settings"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="containers.actions.stop"] [data-icon="stop-filled"]')).not.toBeNull();
    const menuIcons = Array.from(host.querySelectorAll('[data-test-dropdown-menu] [data-icon]'))
      .map((item) => item.getAttribute('data-icon'));
    expect(menuIcons).toEqual(expect.arrayContaining(['refresh', 'pause', 'x-circle', 'trash']));
  });
});
