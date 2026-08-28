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

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => <button type="button" class={props.class} disabled={props.disabled} aria-label={props['aria-label']} onClick={props.onClick}>{props.children}</button>,
  Input: (props: any) => <input class={props.class} value={props.value} placeholder={props.placeholder} aria-label={props['aria-label']} onInput={props.onInput} />,
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

vi.mock('./EnvContext', () => ({
  useEnvContext: () => ({
    env: () => ({ permissions: harness.permissions }),
    goActivity: harness.goActivity,
  }),
}));

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
  getContainerStats: vi.fn(),
  preflightContainerOperation: harness.preflight,
  subscribeContainerOperation: vi.fn(),
  tailContainerLogs: vi.fn(),
}));

import { EnvContainersPage } from './EnvContainersPage';

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
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
    harness.goActivity.mockReset();
    harness.storageWrites.length = 0;
    harness.listEndpoints.mockReset().mockResolvedValue([{
      endpoint_id: 'docker-primary',
      engine: 'docker',
      display_name: 'Primary Docker',
      default: true,
      remote: false,
      available: true,
      capabilities: { collection_stats: true, container_files: true, volume_files: false, exec: false },
    }]);
    harness.endpointStatus.mockReset().mockResolvedValue({
      endpoint_id: 'docker-primary', engine: 'docker', display_name: 'Primary Docker', available: true,
      capabilities: { collection_stats: true, container_files: true, volume_files: false, exec: false },
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
    expect(host.querySelector('[data-container-mobile-list] button')).not.toBeNull();
    expect(host.querySelectorAll('.container-touch-target').length).toBeGreaterThan(3);
    expect(harness.listResources).toHaveBeenCalledWith('containers', 'docker', 'docker-primary');
    expect(harness.storageWrites.some((entry) => entry.key === 'containers:widget-1')).toBe(true);
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
    expect(host.querySelector('.container-distribution__track')).toBeNull();
    expect(host.querySelector('thead')?.textContent).toContain('containers.columns.image');
    expect(host.querySelectorAll('thead th')).toHaveLength(5);
    expect(host.textContent).toContain('containers.states.running');
    expect(host.querySelector('tbody tr')?.textContent).not.toContain('container-1');
    expect(host.querySelector('.container-managed-label')?.textContent).toBe('');

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
    expect(host.querySelector('[data-container-detail-grid]')?.textContent).toContain('containers.inspector.networkMode');
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
      Array.from(host.querySelectorAll<HTMLButtonElement>('nav button')).find((button) => button.textContent?.includes(label))?.click();
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

    host.querySelector<HTMLButtonElement>('button[aria-label="containers.actions.start"]')?.click();
    await settle();

    expect(host.querySelector('[data-container-detail-page]')).toBeNull();
    expect(harness.preflight).toHaveBeenCalledWith('containers.start', expect.objectContaining({ container_id: 'container-2' }));
  });

  it('keeps stale inventory visible and presents refresh failure recovery', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();
    harness.listResources.mockRejectedValueOnce(new Error('engine temporarily unavailable'));

    const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="containers.actions.refresh"]');
    refresh?.click();
    await settle();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('engine temporarily unavailable');
    expect(host.textContent).toContain('Managed API');
  });
});
