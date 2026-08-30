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
  listResources: vi.fn(),
  resourceDetails: vi.fn(),
  listOperations: vi.fn(),
  listOperationEvents: vi.fn(),
  subscribeOperationEvents: vi.fn(),
  createComposeDefinition: vi.fn(),
  updateComposeDefinition: vi.fn(),
  getComposeDefinition: vi.fn(),
  deleteComposeDefinition: vi.fn(),
  imageHistory: vi.fn(),
  rawInspect: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  subscribeLogs: vi.fn(),
  getStats: vi.fn(),
  subscribeStats: vi.fn(),
  subscribeCollectionStats: vi.fn(),
  preflight: vi.fn(),
  fsList: vi.fn(),
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
  CircleStop: icon('circle-stop'),
  Cpu: icon('cpu'),
  Database: icon('database'),
  ExternalLink: icon('external-link'),
  FileText: icon('file'),
  Filter: icon('filter'),
  Info: icon('info'),
  Layers: icon('layers'),
  Maximize: icon('maximize'),
  MoreVertical: icon('more-vertical'),
  Package: icon('package'),
  Pause: icon('pause'),
  Play: icon('play'),
  Plus: icon('plus'),
  Refresh: icon('refresh'),
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
  Button: (props: any) => <button type="button" class={props.class} disabled={props.disabled} aria-label={props['aria-label']} onClick={props.onClick}>{props.children}</button>,
  Dropdown: (props: any) => <div class="test-dropdown">{props.trigger}<div data-test-dropdown-menu>{props.items.map((item: any) => <button type="button" disabled={item.disabled} onClick={() => props.onSelect(item.id)}>{item.icon}{item.label}</button>)}</div></div>,
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

vi.mock('../primitives/EnvAppModal', () => ({
  Dialog: (props: any) => <Show when={props.open}><section data-dialog>{props.title}{props.children}{props.footer}</section></Show>,
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
  listContainerResources: harness.listResources,
  getContainerResourceDetails: harness.resourceDetails,
  listContainerOperations: harness.listOperations,
  listContainerOperationEvents: harness.listOperationEvents,
  subscribeContainerOperationEvents: harness.subscribeOperationEvents,
  createComposeProjectDefinition: harness.createComposeDefinition,
  updateComposeProjectDefinition: harness.updateComposeDefinition,
  getComposeProjectDefinition: harness.getComposeDefinition,
  deleteComposeProjectDefinition: harness.deleteComposeDefinition,
  getContainerImageHistory: harness.imageHistory,
  getRawContainerInspect: harness.rawInspect,
  listContainerResourceFiles: harness.listFiles,
  readContainerResourceFile: harness.readFile,
  subscribeContainerLogs: harness.subscribeLogs,
  subscribeContainerStats: harness.subscribeStats,
  subscribeContainerStatsCollection: harness.subscribeCollectionStats,
  cancelContainerOperation: vi.fn(),
  createContainerOperation: vi.fn(),
  getContainerStats: harness.getStats,
  preflightContainerOperation: harness.preflight,
  subscribeContainerOperation: vi.fn(),
  tailContainerLogs: vi.fn(),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({ fs: { list: harness.fsList } }),
}));

import { EnvContainersPage } from './EnvContainersPage';
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
    harness.imageHistory.mockReset().mockResolvedValue([]);
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

  it('keeps one disabled loading surface until environment permissions are available', async () => {
    harness.setEnvironment(undefined);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(harness.listRuntimes).not.toHaveBeenCalled();
    expect(host.querySelector('[data-container-list-loading]')).not.toBeNull();
    expect(host.querySelector('[data-container-resource-skeleton-table]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).every((tab) => tab.disabled)).toBe(true);

    harness.setEnvironment({ permissions: harness.permissions });
    await settle();
    expect(host.querySelector('[data-container-endpoint-bar]')).toBeNull();
    expect(host.querySelector('[data-container-resource-table]')).not.toBeNull();
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
    expect(harness.resourceDetails).toHaveBeenCalledWith('containers', 'container-1', 'docker', 'docker-primary');
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
    expect(harness.resourceDetails).toHaveBeenCalledWith('images', 'sha256:config-image', 'docker', 'docker-primary');
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

    expect(harness.resourceDetails).toHaveBeenCalledWith('images', 'sha256:config-image', 'docker', 'docker-primary');
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

  it('uses the stable image ID to load sanitized layer history for dangling images', async () => {
    harness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images' ? [{
      id: 'sha256:image-layered',
      reference: 'ghcr.io/floegence/flowersec-runtime',
      tags: [],
      size_bytes: 20_880_000,
      referenced_containers: 0,
    }] : [{
      container_id: 'container-1', name: 'Managed API', state: 'running', management: { managed: false },
    }]));
    harness.resourceDetails.mockResolvedValue({ id: 'sha256:image-layered', reference: 'ghcr.io/floegence/flowersec-runtime' });
    harness.imageHistory.mockResolvedValue([
      { id: 'sha256:top-layer', size_bytes: 10_400_000, created_at_unix_ms: 1_700_000_000_000 },
      { size_bytes: 582_000, created_at_unix_ms: 0 },
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

    expect(harness.imageHistory).toHaveBeenCalledWith('sha256:image-layered', 'docker', 'docker-primary');
    expect(host.querySelectorAll('.container-layer-row')).toHaveLength(2);
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
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).every((tab) => tab.disabled)).toBe(true);

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
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(host.textContent).toContain('Managed API');
    const warning = host.querySelector<HTMLButtonElement>('[aria-label="containers.runtimeStatus.title"]');
    expect(warning).not.toBeNull();
    warning?.click();
    expect(host.querySelector('[data-dialog]')?.textContent).toContain('containers.runtimeStates.not_installed');
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
      payload: { phase: 'pulling', completed: 2, total: 5, unit: 'layers' }, created_at_unix_ms: 3,
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
    expect(host.querySelector('[data-icon="settings"]')).toBeNull();
    expect(host.querySelector('button[aria-label="containers.actions.stop"] [data-icon="circle-stop"]')).not.toBeNull();
    const menuIcons = Array.from(host.querySelectorAll('[data-test-dropdown-menu] [data-icon]'))
      .map((item) => item.getAttribute('data-icon'));
    expect(menuIcons).toEqual(expect.arrayContaining(['refresh', 'pause', 'x-circle', 'trash']));
  });
});
