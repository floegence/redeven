// @vitest-environment jsdom

import { render } from 'solid-js/web';
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
  listEndpoints: vi.fn(),
  listResources: vi.fn(),
  endpointStatus: vi.fn(),
  resourceDetails: vi.fn(),
  listOperations: vi.fn(),
  imageHistory: vi.fn(),
  rawInspect: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  subscribeLogs: vi.fn(),
  getStats: vi.fn(),
  subscribeStats: vi.fn(),
  subscribeCollectionStats: vi.fn(),
  preflight: vi.fn(),
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
  Cpu: icon('cpu'),
  Database: icon('database'),
  ExternalLink: icon('external-link'),
  FileText: icon('file'),
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
  Settings: icon('settings'),
  Stop: icon('stop'),
  Trash: icon('trash'),
  X: icon('x'),
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
  Dropdown: (props: any) => <div class="test-dropdown">{props.trigger}<div data-test-dropdown-menu>{props.items.map((item: any) => <button type="button" disabled={item.disabled} onClick={() => props.onSelect(item.id)}>{item.label}</button>)}</div></div>,
  Input: (props: any) => <input class={props.class} value={props.value} placeholder={props.placeholder} aria-label={props['aria-label']} onInput={props.onInput} />,
  MonitoringChart: (props: any) => <div
    class={props.class}
    data-monitoring-chart
    data-series={props.series.map((series: { name: string }) => series.name).join(',')}
    data-series-colors={props.series.map((series: { color: string }) => series.color).join(',')}
    data-point-count={props.series[0]?.data?.length ?? 0}
    data-y-max={props.yMax}
  />,
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
}));

vi.mock('../primitives/EnvAppModal', () => ({
  Dialog: (props: any) => props.open ? <section data-dialog>{props.title}{props.children}{props.footer}</section> : null,
}));

vi.mock('../primitives/EnvAppDrawer', () => ({
  EnvAppDrawer: (props: any) => props.open ? <aside data-drawer>{props.title}{props.children}</aside> : null,
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
  readUIStorageJSON: (_key: string, fallback: unknown) => fallback,
  writeUIStorageJSON: (key: string, value: unknown) => harness.storageWrites.push({ key, value }),
}));

vi.mock('../services/containerResourcesApi', () => ({
  listContainerEndpoints: harness.listEndpoints,
  getContainerEndpointStatus: harness.endpointStatus,
  listContainerResources: harness.listResources,
  getContainerResourceDetails: harness.resourceDetails,
  listContainerOperations: harness.listOperations,
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
    harness.storageWrites.length = 0;
    harness.listEndpoints.mockReset().mockResolvedValue([{
      endpoint_id: 'docker-primary',
      engine: 'docker',
      display_name: 'Primary Docker',
      default: true,
      remote: false,
      available: true,
      capabilities: { collection_stats: true, volume_files: false, exec: false },
    }]);
    harness.endpointStatus.mockReset().mockResolvedValue({
      endpoint_id: 'docker-primary', engine: 'docker', display_name: 'Primary Docker', available: true,
      capabilities: { collection_stats: true, volume_files: false, exec: false },
    });
    harness.listResources.mockReset().mockResolvedValue([{
      container_id: 'container-1',
      name: 'Managed API',
      state: 'running',
      management: { managed: true, owner: { kind: 'web_service', service_id: 'service-1', name: 'API' } },
    }]);
    harness.resourceDetails.mockReset().mockResolvedValue({ container_id: 'container-1', state: 'running' });
    harness.listOperations.mockReset().mockResolvedValue([]);
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
    expect(host.querySelector<HTMLSelectElement>('[data-container-endpoint-bar] select')?.value).toBe('docker-primary');
    expect(host.querySelectorAll('.container-resource-tabs [role="tab"]')).toHaveLength(4);
    expect(host.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent).toContain('containers.views.containers');
    expect(host.querySelector('[data-container-mobile-list] button')).not.toBeNull();
    expect(host.querySelectorAll('.container-touch-target').length).toBeGreaterThanOrEqual(3);
    expect(harness.listResources).toHaveBeenCalledWith('containers', 'docker', 'docker-primary', expect.anything());
    expect(harness.storageWrites.some((entry) => entry.key === 'containers:widget-1')).toBe(true);
  });

  it('keeps one disabled loading surface until environment permissions are available', async () => {
    harness.setEnvironment(undefined);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(harness.listEndpoints).not.toHaveBeenCalled();
    expect(host.querySelector('[data-container-list-loading]')).not.toBeNull();
    expect(host.querySelector('[data-container-resource-skeleton-table]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).every((tab) => tab.disabled)).toBe(true);

    harness.setEnvironment({ permissions: harness.permissions });
    await settle();
    expect(host.querySelector('[data-container-endpoint-bar] select')).not.toBeNull();
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
      key: 'containers:activity',
      value: {
        version: 1,
        engine: 'docker',
        endpointID: 'docker-primary',
        view: 'containers',
        selectedIdentity: 'container-1',
      },
    });
    expect(harness.resourceDetails).toHaveBeenCalledWith('containers', 'container-1', 'docker', 'docker-primary');
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
    ['ENGINE_UNAVAILABLE', 'containers.engineState.unavailableTitle'],
    ['ENGINE_PERMISSION_DENIED', 'containers.engineState.permissionTitle'],
  ])('renders a calm engine detection state for %s', async (code, title) => {
    harness.listEndpoints.mockRejectedValue(Object.assign(new Error('engine failure'), { code }));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    expect(host.querySelector('[data-container-engine-state]')?.textContent).toContain(title);
    expect(host.querySelector('[data-container-resource-table]')).toBeNull();
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'));
    expect(tabs).toHaveLength(4);
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
      identity: '',
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
    const refreshedEndpoints = deferred<any[]>();
    let endpointRequests = 0;
    harness.listEndpoints.mockImplementation(() => {
      endpointRequests += 1;
      if (endpointRequests === 1) {
        return Promise.resolve([{
          endpoint_id: 'docker-primary', engine: 'docker', display_name: 'Primary Docker', default: true,
          remote: false, available: true, capabilities: { collection_stats: true, volume_files: false, exec: false },
        }]);
      }
      return refreshedEndpoints.promise;
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

    refreshedEndpoints.resolve([{
      endpoint_id: 'docker-primary', engine: 'docker', display_name: 'Primary Docker', default: true,
      remote: false, available: true, capabilities: { collection_stats: true, volume_files: false, exec: false },
    }]);
    await settle();
    expect(host.querySelector('main')?.getAttribute('aria-busy')).toBe('false');
  });

  it('loads an endpoint change through the same ready-state boundary', async () => {
    harness.listEndpoints.mockResolvedValue([
      {
        endpoint_id: 'docker-primary', engine: 'docker', display_name: 'Primary Docker', default: true,
        remote: false, available: true, capabilities: { collection_stats: true, volume_files: false, exec: false },
      },
      {
        endpoint_id: 'docker-secondary', engine: 'docker', display_name: 'Secondary Docker', default: false,
        remote: true, available: true, capabilities: { collection_stats: true, volume_files: false, exec: false },
      },
    ]);
    harness.endpointStatus.mockImplementation((_engine: string, nextEndpointID: string) => Promise.resolve({
      endpoint_id: nextEndpointID,
      engine: 'docker',
      display_name: nextEndpointID === 'docker-secondary' ? 'Secondary Docker' : 'Primary Docker',
      default: nextEndpointID === 'docker-primary',
      remote: nextEndpointID === 'docker-secondary',
      available: true,
      capabilities: { collection_stats: true, volume_files: false, exec: false },
    }));
    harness.listResources.mockImplementation((_view: string, _engine: string, nextEndpointID: string) => Promise.resolve([{
      container_id: `container-${nextEndpointID}`,
      name: nextEndpointID === 'docker-secondary' ? 'Secondary API' : 'Primary API',
      state: 'running',
      management: { managed: false },
    }]));
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    const select = host.querySelector<HTMLSelectElement>('[data-container-endpoint-bar] select')!;
    select.value = 'docker-secondary';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(host.querySelector('[data-container-resource-table]')).toBeNull();
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).every((tab) => tab.disabled)).toBe(true);
    await settle();

    expect(host.querySelector<HTMLSelectElement>('[data-container-endpoint-bar] select')?.value).toBe('docker-secondary');
    expect(host.textContent).toContain('Secondary API');
    expect(host.textContent).not.toContain('Primary API');
  });

  it('retries engine detection and reaches one coherent ready state', async () => {
    harness.listEndpoints.mockRejectedValueOnce(Object.assign(new Error('missing engine'), { code: 'ENGINE_UNAVAILABLE' }));
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
    expect(host.querySelector('[data-container-endpoint-bar] select')).not.toBeNull();
    expect(host.querySelector('[data-container-resource-table]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).every((tab) => !tab.disabled)).toBe(true);
  });

  it('uses resource-specific columns for images, volumes, Compose projects, and pods', async () => {
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

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('engine temporarily unavailable');
    expect(host.textContent).not.toContain('Managed API');
    expect(host.querySelector('[data-container-resource-table]')).toBeNull();
  });
});
