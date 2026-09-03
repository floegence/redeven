import '../../index.css';

import { page } from 'vitest/browser';
import { ThemeProvider } from '@floegence/floe-webapp-core';
import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n';
import { requestContainerResourceNavigation } from '../services/containerResourceNavigation';

const browserHarness = vi.hoisted(() => ({
  notify: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
  listRuntimes: vi.fn(),
  listResources: vi.fn(),
  resourceDetails: vi.fn(),
  preflight: vi.fn(),
  createExecSession: vi.fn(),
  deleteExecSession: vi.fn(),
  execTerminalProps: new Map<string, any>(),
}));

vi.mock('@floegence/floe-webapp-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core')>(),
  useNotification: () => browserHarness.notify,
}));

vi.mock('../primitives/EnvAppDrawer', () => ({
  EnvAppDrawer: (props: { open: boolean }) => <Show when={props.open}><aside data-drawer /></Show>,
}));

vi.mock('../widgets/ContainerExecTerminal', () => ({
  ContainerExecTerminal: (props: any) => {
    browserHarness.execTerminalProps.set(props.sessionID, props);
    return <div class="container-exec-terminal-surface" data-container-exec-terminal data-session-id={props.sessionID} />;
  },
}));

vi.mock('./EnvContext', () => ({
  useEnvContext: () => ({
    env: () => ({ permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true } }),
    goActivity: vi.fn(),
  }),
}));

vi.mock('../services/uiStorage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/uiStorage')>(),
  readUIStorageJSON: (_key: string, fallback: unknown) => fallback,
  writeUIStorageJSON: vi.fn(),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({ fs: { list: vi.fn().mockResolvedValue({ entries: [] }) } }),
}));

vi.mock('../services/containerResourcesApi', () => ({
  listContainerRuntimes: browserHarness.listRuntimes,
  listContainerServices: vi.fn().mockResolvedValue([
    {
      service_id: 'container_service_docker', engine: 'docker', name: 'Docker Engine', implementation: 'docker_engine', state: 'running', version: '27.3.1',
      capabilities: { start: false, stop: true, restart: true },
      configuration: { mode: 'local', sources: ['engine', 'docker_cli'] },
    },
    {
      service_id: 'container_service_podman', engine: 'podman', name: 'Podman', implementation: 'unavailable', state: 'not_installed', guidance_code: 'install',
      capabilities: { start: false, stop: false, restart: false },
      configuration: { mode: 'unavailable' },
    },
  ]),
  getContainerServiceConfiguration: vi.fn().mockResolvedValue({
    service_id: 'container_service_docker',
    sources: [
      { source_id: 'engine', display_path: '~/.docker/daemon.json', status: 'ready', exists: true, format: 'json', sections: ['advanced'], apply_modes: ['save', 'save_and_restart'], content: '{}\n', base_revision: 'sha256:engine' },
      { source_id: 'docker_cli', display_path: '~/.docker/config.json', status: 'ready', exists: true, format: 'json', sections: ['general', 'proxy', 'credentials', 'advanced'], apply_modes: ['save'], base_revision: 'sha256:client', content: '{\n  "currentContext": "desktop-linux",\n  "credsStore": "desktop",\n  "proxies": {\n    "default": {}\n  }\n}\n', protected_registries: ['registry.example.test'], context_options: ['default', 'desktop-linux'] },
    ],
  }),
  listContainerResources: browserHarness.listResources,
  getContainerResourceDetails: browserHarness.resourceDetails,
  listContainerOperations: vi.fn().mockResolvedValue([]),
  listContainerOperationEvents: vi.fn().mockResolvedValue([]),
  subscribeContainerOperationEvents: vi.fn().mockResolvedValue(undefined),
  createComposeProjectDefinition: vi.fn(),
  getComposeProjectDefinition: vi.fn(),
  updateComposeProjectDefinition: vi.fn(),
  deleteComposeProjectDefinition: vi.fn(),
  getContainerImageHistory: vi.fn().mockResolvedValue([]),
  getRawContainerInspect: vi.fn().mockResolvedValue({}),
  listContainerResourceFiles: vi.fn().mockResolvedValue({ path: '/', entries: [], truncated: false }),
  readContainerResourceFile: vi.fn().mockResolvedValue(new Blob()),
  cancelContainerOperation: vi.fn(),
  createContainerOperation: vi.fn(),
  createContainerExecSession: browserHarness.createExecSession,
  deleteContainerExecSession: browserHarness.deleteExecSession,
  getContainerStats: vi.fn().mockResolvedValue({
    sampled_at_unix_ms: 1_725_000_000_000,
    container_id: 'e2c83fcda485',
    cpu_percent: 37.4,
    memory_bytes: 268_435_456,
    memory_limit: 1_073_741_824,
    network_rx_bytes: 12_582_912,
    network_tx_bytes: 4_194_304,
  }),
  preflightContainerOperation: browserHarness.preflight,
  subscribeContainerOperation: vi.fn(),
  subscribeContainerLogs: vi.fn().mockResolvedValue(undefined),
  subscribeContainerStats: vi.fn().mockImplementation(async (_identity: string, _engine: string, _endpoint: string, observe: (sample: unknown) => void) => {
    observe({
      sampled_at_unix_ms: 1_725_000_000_000,
      container_id: 'e2c83fcda485',
      cpu_percent: 31.4,
      memory_bytes: 260_000_000,
      memory_limit: 1_073_741_824,
      network_rx_bytes: 12_000_000,
      network_tx_bytes: 4_000_000,
    });
    observe({
      sampled_at_unix_ms: 1_725_000_001_000,
      container_id: 'e2c83fcda485',
      cpu_percent: 38.2,
      memory_bytes: 275_000_000,
      memory_limit: 1_073_741_824,
      network_rx_bytes: 13_000_000,
      network_tx_bytes: 4_400_000,
    });
  }),
  subscribeContainerStatsCollection: vi.fn().mockImplementation(async (_engine: string, _endpoint: string, observe: (sample: unknown) => void) => {
    observe({ sampled_at_unix_ms: Date.now(), samples: [{ container_id: 'e2c83fcda485', cpu_percent: 38.2, memory_bytes: 275_000_000 }] });
  }),
  tailContainerLogs: vi.fn().mockResolvedValue([]),
}));

import { EnvContainersPage } from './EnvContainersPage';

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function mount(variant: 'activity' | 'workbench' = 'activity') {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.inset = '0';
  document.body.append(host);
  const dispose = render(() => <ThemeProvider><I18nProvider><EnvContainersPage variant={variant} /></I18nProvider></ThemeProvider>, host);
  return { host, dispose };
}

describe('native Containers responsive product surface', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    document.documentElement.classList.add('dark');
    window.localStorage.clear();
    window.localStorage.setItem('redeven_ui_language_preference', 'en-US');
    browserHarness.listRuntimes.mockReset().mockResolvedValue([{
      endpoint_id: 'desktop-linux', engine: 'docker', state: 'ready', engine_version: '27.3.1', rootless: false,
      capabilities: { collection_stats: true, volume_files: false, exec: false },
    }, { engine: 'podman', state: 'not_installed' }]);
    browserHarness.createExecSession.mockReset().mockResolvedValue({ session_id: 'exec-session-1' });
    browserHarness.deleteExecSession.mockReset().mockResolvedValue(undefined);
    browserHarness.execTerminalProps.clear();
    browserHarness.listResources.mockReset().mockResolvedValue([
      {
        container_id: '8bbf320351e557285fe1f143ee14a6d2334f24f5', name: 'redeven-api',
        image: { reference: 'ghcr.io/floegence/redeven-api:edge' }, state: 'running', health: 'healthy',
        group_name: 'redeven-dev', created_at_unix_ms: 1_725_000_000_000,
        management: { managed: true, owner: { kind: 'web_service', service_id: 'service-api', name: 'Redeven API' } },
      },
      {
        container_id: 'e2c83fcda4850de717be32128754ce4764efb434', name: 'postgres-development',
        image: { reference: 'postgres:17-alpine' }, state: 'running', health: 'healthy',
        group_name: 'development', created_at_unix_ms: 1_724_000_000_000, management: { managed: false },
      },
      {
        container_id: 'd8ce8083e6116de35aff5ca35abce727d1c87c9b', name: 'worker-build-cache',
        image: { reference: 'debian:stable-slim' }, state: 'exited',
        created_at_unix_ms: 1_723_000_000_000, management: { managed: false },
      },
      {
        container_id: '8a90b48175ec71187b114e2d8f47ac9a78cf4fd9', name: 'metrics-collector',
        image: { reference: 'otel/opentelemetry-collector:latest' }, state: 'paused',
        group_name: 'observability', created_at_unix_ms: 1_722_000_000_000, management: { managed: false },
      },
    ]);
    browserHarness.resourceDetails.mockReset().mockImplementation((_view: string, identity: string) => Promise.resolve({
      container_id: identity,
      name: identity.includes('8bbf') ? 'redeven-api' : 'postgres-development',
      image: { reference: identity.includes('8bbf') ? 'ghcr.io/floegence/redeven-api:edge' : 'postgres:17-alpine' },
      state: 'running', health: 'healthy', group_name: 'redeven-dev', created_at_unix_ms: 1_725_000_000_000,
      runtime: { network_mode: 'redeven-dev', restart_policy: 'unless-stopped', user: '1000:1000', privileged: false, read_only_root: true },
      ports: [{ protocol: 'tcp', host_ip: '127.0.0.1', host_port: 4318, port: 4318 }],
    }));
    browserHarness.preflight.mockReset().mockResolvedValue({
      method: 'images.prune', request_hash: 'request', plan_hash: 'plan',
      plan: {
        method: 'images.prune',
        target: {
          resource_count: 1,
          reclaimable_bytes: 1024,
          resource_identities: ['sha256:unused'],
          resources: [{ identity: 'sha256:unused', name: 'example/app:latest', references: ['example/app:latest'], size_bytes: 1024 }],
        },
        plan_digest: 'plan', risk_level: 'high', risk_flags: [], requires_admin: true,
      },
      management: { managed: false },
    });
  });

  afterEach(async () => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
    document.documentElement.classList.remove('dark');
    await page.viewport(1280, 720);
  });

  it('uses a flat sortable inventory and a dedicated detail page on desktop', async () => {
    await page.viewport(1440, 900);
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    expect(root.dataset.variant).toBe('workbench');
    expect(root.querySelector('[data-container-endpoint-bar]')).toBeNull();
    expect(root.textContent).not.toContain('Desktop Linux');
    const resourceTabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'));
    expect(resourceTabs).toHaveLength(4);
    expect(resourceTabs[0].getAttribute('aria-selected')).toBe('true');
    expect(resourceTabs.every((tab) => tab.querySelector('[data-lucide]') || tab.querySelector('svg'))).toBe(true);
    const table = root.querySelector<HTMLElement>('[data-container-resource-table]')!;
    const rows = Array.from(root.querySelectorAll<HTMLElement>('tbody tr'));
    expect(getComputedStyle(table).display).not.toBe('none');
    expect(root.querySelector('.container-distribution__track')).toBeNull();
    expect(root.querySelector('.container-inspector')).toBeNull();
    expect(root.querySelector('.container-list-heading')).toBeNull();
    expect(root.querySelectorAll('thead th')).toHaveLength(5);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.hasAttribute('data-container-resource-row'))).toBe(true);
    expect(rows[0].textContent).not.toContain('8bbf320351e557285fe1f143ee14a6d2334f24f5');
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);

    const hoveredCell = rows[0].querySelector<HTMLTableCellElement>('td')!;
    const idleCellBackground = getComputedStyle(hoveredCell).backgroundColor;
    const idleCellBoxShadow = getComputedStyle(hoveredCell).boxShadow;
    await page.elementLocator(rows[0]).hover();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 160));
    expect(getComputedStyle(hoveredCell).backgroundColor).not.toBe(idleCellBackground);
    expect(getComputedStyle(hoveredCell).boxShadow).not.toBe(idleCellBoxShadow);
    expect(getComputedStyle(hoveredCell).boxShadow).toContain('inset');

    const overflow = root.querySelector<HTMLButtonElement>('.container-row-menu button');
    expect(overflow).not.toBeNull();
    overflow!.click();
    await settle();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    root.querySelector<HTMLElement>('.container-resource-toolbar')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    root.querySelector<HTMLElement>('.container-resource-toolbar')!.click();
    await settle();
    expect(Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'))
      .some((menu) => menu.getAttribute('aria-hidden') !== 'true')).toBe(false);

    const columnSettings = root.querySelector<HTMLElement>(
      '.container-column-picker [data-floe-dropdown-trigger]',
    )!;
    columnSettings.click();
    await settle();
    const columnMenu = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'))
      .find((menu) => menu.getAttribute('aria-hidden') !== 'true');
    expect(columnMenu).not.toBeNull();
    root.querySelector<HTMLElement>('.container-search-control')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(columnMenu?.isConnected && columnMenu.getAttribute('aria-hidden') !== 'true').toBe(false);

    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    rows[0].click();
    await settle();

    const detailPage = root.querySelector<HTMLElement>('[data-container-detail-page]')!;
    expect(detailPage).not.toBeNull();
    expect(root.querySelector('.container-inspector')).toBeNull();
    expect(detailPage.querySelector('.container-detail-identity')?.textContent).not.toContain('e2c83fcda4850de717be32128754ce4764efb434');
    expect(detailPage.querySelector('[data-container-detail-grid]')?.textContent).toContain('Network mode');
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);

    const overviewTab = Array.from(detailPage.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Overview'))!;
    overviewTab.focus();
    overviewTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(Array.from(detailPage.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Logs'))?.getAttribute('aria-selected')).toBe('true');

    const statsTab = Array.from(detailPage.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Stats'))!;
    statsTab.click();
    await settle();
    expect(detailPage.querySelectorAll('[data-container-monitor-panel]')).toHaveLength(3);
    expect(detailPage.querySelectorAll('.container-monitor-chart .chart-svg')).toHaveLength(3);
    expect(detailPage.querySelector('.container-sparkline')).toBeNull();
    expect(detailPage.querySelector('[data-container-network-panel]')?.textContent).toContain('/s');
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it('keeps a container detail open when a return refresh finishes', async () => {
    await page.viewport(1440, 900);
    const refreshedContainers = deferred<any[]>();
    const containers = [
      {
        container_id: 'container-1', name: 'API', state: 'running', image_id: 'sha256:abcdef',
        image: { reference: 'example/api:latest' }, management: { managed: false },
      },
      {
        container_id: 'container-2', name: 'Worker', state: 'running', image_id: 'sha256:fedcba',
        image: { reference: 'example/worker:latest' }, management: { managed: false },
      },
    ];
    let containerRequests = 0;
    browserHarness.listResources.mockImplementation((view: string) => {
      if (view === 'images') {
        return Promise.resolve([{ id: 'sha256:abcdef', reference: 'example/api:latest', tags: ['example/api:latest'] }]);
      }
      containerRequests += 1;
      return containerRequests === 1 ? Promise.resolve(containers) : refreshedContainers.promise;
    });
    browserHarness.resourceDetails.mockImplementation((view: string, identity: string) => Promise.resolve(view === 'images'
      ? { id: 'sha256:abcdef', reference: 'example/api:latest' }
      : { container_id: identity, name: identity === 'container-2' ? 'Worker' : 'API', state: 'running' }));
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    root.querySelector<HTMLButtonElement>('.container-secondary-cell .container-resource-link')?.click();
    await settle();
    expect(root.querySelector('[data-container-detail-page] h2')?.textContent).toBe('example/api:latest');

    root.querySelector<HTMLButtonElement>('[data-container-detail-page] button[aria-label="Back"]')?.click();
    await settle();
    root.querySelectorAll<HTMLTableRowElement>('tbody tr')[1]?.click();
    await settle();
    expect(root.querySelector('[data-container-detail-page] h2')?.textContent).toBe('Worker');

    refreshedContainers.resolve(containers);
    await settle();
    expect(root.querySelector('[data-container-detail-page] h2')?.textContent).toBe('Worker');
  });

  it('opens a volume user directly as a container detail and restores the source detail', async () => {
    await page.viewport(1440, 900);
    browserHarness.listResources.mockImplementation((view: string) => Promise.resolve(view === 'volumes'
      ? [{ name: 'api-data', driver: 'local', referenced_containers: 1 }]
      : [{ container_id: 'container-full-1', name: 'API', state: 'running', management: { managed: false } }]));
    browserHarness.resourceDetails.mockImplementation((view: string) => Promise.resolve(view === 'volumes'
      ? { name: 'api-data', driver: 'local', used_by: [{ container_id: 'container-full-1', name: 'API', state: 'running' }] }
      : { container_id: 'container-full-1', name: 'API', state: 'running' }));
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    Array.from(root.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('Volumes'))?.click();
    await settle();
    root.querySelector<HTMLTableRowElement>('tbody tr')?.click();
    await settle();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.container-detail-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('Used by'))?.click();
    await settle();
    root.querySelector<HTMLButtonElement>('.container-reference-row')?.click();
    await settle();

    expect(root.querySelector('[data-container-detail-page] h2')?.textContent).toBe('API');
    expect(root.querySelector('[data-container-resource-table]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-container-detail-page] button[aria-label="Back"]')?.click();
    await settle();
    expect(root.querySelector('[data-container-detail-page] h2')?.textContent).toBe('api-data');
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>('.container-detail-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('Used by'))?.getAttribute('aria-selected')).toBe('true');
  });

  it('shows a responsive target skeleton before an external resource navigation resolves', async () => {
    await page.viewport(390, 844);
    const mounted = mount('activity');
    dispose = mounted.dispose;
    await settle();

    let resolveImages: ((items: readonly unknown[]) => void) | undefined;
    browserHarness.listResources.mockImplementation((view: string) => view === 'images'
      ? new Promise((resolve) => { resolveImages = resolve; })
      : Promise.resolve([]));
    requestContainerResourceNavigation({
      engine: 'docker',
      endpointID: 'desktop-linux',
      view: 'images',
      identity: 'sha256:image-1',
    });
    await Promise.resolve();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    const skeleton = root.querySelector<HTMLElement>('[data-container-detail-loading]')!;
    expect(skeleton).not.toBeNull();
    expect(root.querySelector('[data-container-list-loading]')).toBeNull();
    expect(root.querySelector('.container-resource-tabs [role="tab"][aria-selected="true"]')?.textContent).toContain('Images');
    expect(skeleton.querySelector('.container-detail-header')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(110);
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);

    resolveImages?.([{ id: 'sha256:image-1', reference: 'example/api:latest', referenced_containers: 0 }]);
    await settle();
    expect(root.querySelector('[data-container-detail-loading]')).toBeNull();
    expect(root.querySelector('[data-container-detail-page] h2')?.textContent).toBe('example/api:latest');
  });

  it('places cleanup in a dismissible danger menu and shows the exact reviewed resources', async () => {
    await page.viewport(1440, 900);
    browserHarness.listResources.mockImplementation((nextView: string) => Promise.resolve(nextView === 'images' ? [{
      id: 'sha256:unused', reference: 'example/app:latest', size_bytes: 1024, referenced_containers: 0,
    }] : []));
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    const visiblePruneItem = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'))
      .reverse()
      .find((menu) => menu.getAttribute('aria-hidden') !== 'true')
      ?.querySelector<HTMLElement>('[role="menuitem"][data-tone="danger"]') ?? null;
    Array.from(root.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('Images'))?.click();
    await settle();

    const more = root.querySelector<HTMLButtonElement>('[data-floe-dropdown-trigger][aria-label="More actions"]')!;
    expect(more).not.toBeNull();
    more.click();
    await settle();
    let pruneItem = visiblePruneItem();
    expect(pruneItem?.textContent).toContain('Prune unused');
    expect(pruneItem?.querySelector('svg')).not.toBeNull();
    expect(pruneItem?.classList.contains('text-destructive')).toBe(true);

    root.querySelector<HTMLElement>('.container-search-control')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(pruneItem?.isConnected && pruneItem.closest('[role="menu"]')?.getAttribute('aria-hidden') !== 'true').toBe(false);

    more.click();
    await settle();
    pruneItem = visiblePruneItem();
    pruneItem?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(pruneItem?.isConnected && pruneItem.closest('[role="menu"]')?.getAttribute('aria-hidden') !== 'true').toBe(false);

    await new Promise((resolve) => window.setTimeout(resolve, 160));
    more.click();
    await settle();
    pruneItem = visiblePruneItem();
    expect(pruneItem).not.toBeNull();
    expect((pruneItem as HTMLButtonElement | null)?.disabled).toBe(false);
    pruneItem?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    await settle();
    expect(browserHarness.preflight).toHaveBeenCalledWith('images.prune', {
      engine: 'docker',
      endpoint_id: 'desktop-linux',
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-floe-dialog-panel].container-prune-review-dialog')).not.toBeNull();
    });
    const dialog = document.querySelector<HTMLElement>('[data-floe-dialog-panel].container-prune-review-dialog');
    if (!dialog) throw new Error('cleanup review dialog did not open');
    expect(dialog.querySelector('[data-prune-review-list]')?.textContent).toContain('example/app:latest');
    expect(dialog.querySelector('[data-prune-resource-id="sha256:unused"]')).not.toBeNull();
    expect(dialog.textContent).not.toContain('images.prune');
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it('fills the detail body with Exec and reconnects from the inline retry action', async () => {
    await page.viewport(1440, 900);
    browserHarness.listRuntimes.mockResolvedValue([{
      endpoint_id: 'desktop-linux', engine: 'docker', state: 'ready', engine_version: '27.3.1', rootless: false,
      capabilities: { collection_stats: true, volume_files: false, exec: true },
    }, { engine: 'podman', state: 'not_installed' }]);
    browserHarness.createExecSession
      .mockResolvedValueOnce({ session_id: 'exec-session-sh' })
      .mockResolvedValueOnce({ session_id: 'exec-session-bash' })
      .mockResolvedValueOnce({ session_id: 'exec-session-retry' });
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    const row = Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr'))
      .find((candidate) => candidate.textContent?.includes('postgres-development'))!;
    row.querySelector<HTMLButtonElement>('button[aria-label="Exec"]')?.click();
    await settle();

    const detailBody = root.querySelector<HTMLElement>('.container-detail-body')!;
    const terminal = root.querySelector<HTMLElement>('[data-container-exec-terminal]')!;
    expect(detailBody.getBoundingClientRect().bottom - terminal.getBoundingClientRect().bottom).toBeLessThanOrEqual(40);
    browserHarness.execTerminalProps.get('exec-session-sh')?.onSessionReady?.('exec-session-sh');

    Array.from(root.querySelectorAll<HTMLButtonElement>('.container-exec-programs button'))
      .find((button) => button.textContent === 'bash')?.click();
    await settle();
    browserHarness.execTerminalProps.get('exec-session-bash')?.onSessionGone?.('exec-session-bash');
    await settle();
    root.querySelector<HTMLButtonElement>('.container-exec-error button')?.click();
    await settle();

    expect(browserHarness.createExecSession).toHaveBeenLastCalledWith(
      'e2c83fcda4850de717be32128754ce4764efb434',
      'docker',
      'desktop-linux',
      ['/bin/sh'],
    );
    expect(root.querySelector('[data-container-exec-terminal]')?.getAttribute('data-session-id')).toBe('exec-session-retry');
    browserHarness.execTerminalProps.get('exec-session-bash')?.onSessionGone?.('exec-session-bash');
    await settle();
    expect(root.querySelector('[data-container-exec-terminal]')?.getAttribute('data-session-id')).toBe('exec-session-retry');
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it.each([
    { width: 390, height: 844, variant: 'workbench' as const },
    { width: 320, height: 568, variant: 'activity' as const },
  ])('uses cards and a viewport-contained $variant detail surface at $width x $height', async (viewport) => {
    await page.viewport(viewport.width, viewport.height);
    const mounted = mount(viewport.variant);
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    expect(root.dataset.variant).toBe(viewport.variant);
    const resourceTabs = root.querySelector<HTMLElement>('.container-resource-tabs__scroller')!;
    expect(getComputedStyle(resourceTabs).overflowX).toBe('auto');
    if (viewport.width === 320) expect(resourceTabs.scrollWidth).toBeGreaterThan(resourceTabs.clientWidth);
    const cards = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-container-mobile-list] > button'));
    expect(cards).toHaveLength(3);
    expect(getComputedStyle(root.querySelector<HTMLElement>('.container-resource-table-shell')!).display).toBe('none');
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    cards[0].click();
    await settle();

    const detailPage = root.querySelector<HTMLElement>('[data-container-detail-page]')!;
    const rect = detailPage.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(viewport.width);
    expect(rect.bottom).toBeLessThanOrEqual(viewport.height);
    const visibleButtons = Array.from(detailPage.querySelectorAll<HTMLButtonElement>('button')).filter((button) => button.getClientRects().length > 0);
    expect(visibleButtons.every((button) => button.getBoundingClientRect().height >= 44)).toBe(true);
    const statsTab = Array.from(detailPage.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Stats'))!;
    statsTab.click();
    await settle();
    expect(detailPage.querySelectorAll('[data-container-monitor-panel]')).toHaveLength(3);
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it('keeps service management readable and touchable on a narrow workbench', async () => {
    await page.viewport(390, 844);
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    root.querySelector<HTMLButtonElement>('[aria-label="Container services"]')?.click();
    await settle();

    const servicePage = root.querySelector<HTMLElement>('[data-container-services-page]')!;
    expect(servicePage).not.toBeNull();
    expect(root.querySelector('.container-resource-tabs')).toBeNull();
    expect(servicePage.querySelectorAll('.container-service-card')).toHaveLength(2);
    expect(getComputedStyle(servicePage.querySelector<HTMLElement>('.container-services-grid')!).gridTemplateColumns.split(' ')).toHaveLength(1);
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    const visibleButtons = Array.from(servicePage.querySelectorAll<HTMLButtonElement>('button')).filter((button) => button.getClientRects().length > 0);
    expect(visibleButtons.every((button) => button.getBoundingClientRect().height >= 44)).toBe(true);
    Array.from(servicePage.querySelectorAll<HTMLButtonElement>('.container-service-card button')).find((button) => button.textContent?.includes('Configure'))?.click();
    await settle();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const dialogRect = dialog.getBoundingClientRect();
    expect(dialogRect.left).toBeGreaterThanOrEqual(0);
    expect(dialogRect.right).toBeLessThanOrEqual(390);
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Docker CLI'))?.click();
    await settle();
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Proxies'))?.click();
    await settle();
    expect(dialog.querySelector<HTMLInputElement>('input[placeholder="http://proxy.example.com:3128"]')).not.toBeNull();
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it('shows official service branding and complete local Docker CLI configuration', async () => {
    await page.viewport(1440, 900);
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    root.querySelector<HTMLButtonElement>('[aria-label="Container services"]')?.click();
    await settle();

    const servicePage = root.querySelector<HTMLElement>('[data-container-services-page]')!;
    const cards = Array.from(servicePage.querySelectorAll<HTMLElement>('.container-service-card'));
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector<HTMLImageElement>('.container-service-brand__color')?.getAttribute('src')).toBe('/_redeven_proxy/env/container-service-icons/docker-default.svg');
    expect(cards[1].querySelector<HTMLImageElement>('.container-service-brand__color')?.getAttribute('src')).toBe('/_redeven_proxy/env/container-service-icons/podman-default.svg');
    expect(getComputedStyle(servicePage.querySelector<HTMLElement>('.container-services-grid')!).gridTemplateColumns.split(' ')).toHaveLength(2);
    const firstActions = cards[0].querySelector<HTMLElement>('.container-service-card__actions')!;
    const secondActions = cards[1].querySelector<HTMLElement>('.container-service-card__actions')!;
    expect(Math.abs(cards[0].getBoundingClientRect().height - cards[1].getBoundingClientRect().height)).toBeLessThanOrEqual(1);
    expect(Math.abs(firstActions.getBoundingClientRect().bottom - secondActions.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
    expect(cards[0].getBoundingClientRect().bottom - firstActions.getBoundingClientRect().bottom).toBeLessThanOrEqual(18);
    expect(cards[1].getBoundingClientRect().bottom - secondActions.getBoundingClientRect().bottom).toBeLessThanOrEqual(18);

    Array.from(cards[0].querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('Configure'))?.click();
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(dialog.querySelector('.container-service-config-editor')).not.toBeNull();
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Docker CLI'))?.click();
    await settle();
    expect(dialog.querySelectorAll('.container-service-cli-setting-card')).toHaveLength(2);
    const outputFormats = dialog.querySelector<HTMLDetailsElement>('.container-service-cli-disclosure')!;
    expect(outputFormats.open).toBe(false);
    outputFormats.querySelector<HTMLElement>('summary')?.click();
    await settle();
    expect(outputFormats.open).toBe(true);
    expect(outputFormats.textContent).toContain('docker ps');
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Proxies'))?.click();
    await settle();
    expect(dialog.querySelector<HTMLInputElement>('input[placeholder="http://proxy.example.com:3128"]')).not.toBeNull();
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
  });

  it.each([
    { width: 1440, height: 900, mode: 'table' },
    { width: 390, height: 844, mode: 'cards' },
  ])('keeps the $mode loading geometry aligned with loaded inventory at $width px', async ({ width, height, mode }) => {
    await page.viewport(width, height);
    let resolveInventory: ((items: readonly unknown[]) => void) | undefined;
    browserHarness.listResources.mockReturnValue(new Promise((resolve) => { resolveInventory = resolve; }));
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    const loadingPage = root.querySelector<HTMLElement>('[data-container-list-loading]')!;
    const loadingToolbar = loadingPage.querySelector<HTMLElement>('.container-resource-toolbar')!;
    expect(loadingPage).not.toBeNull();
    expect(loadingToolbar).not.toBeNull();
    if (mode === 'table') {
      expect(getComputedStyle(loadingPage.querySelector<HTMLElement>('[data-container-resource-skeleton-table]')!).display).not.toBe('none');
      expect(loadingPage.querySelectorAll('[data-container-skeleton-row]')).toHaveLength(5);
    } else {
      expect(getComputedStyle(loadingPage.querySelector<HTMLElement>('[data-container-mobile-skeleton]')!).display).toBe('grid');
      expect(loadingPage.querySelectorAll('[data-container-mobile-skeleton] > .container-mobile-card')).toHaveLength(5);
    }
    const loadingToolbarRect = loadingToolbar.getBoundingClientRect();
    const loadingContentTop = loadingPage.querySelector<HTMLElement>('.container-inventory-scroll')!.getBoundingClientRect().top;
    const loadingItemHeight = mode === 'table'
      ? loadingPage.querySelector<HTMLElement>('[data-container-skeleton-row]')!.getBoundingClientRect().height
      : loadingPage.querySelector<HTMLElement>('[data-container-mobile-skeleton] > .container-mobile-card')!.getBoundingClientRect().height;

    resolveInventory?.([
      {
        container_id: 'e2c83fcda4850de717be32128754ce4764efb434', name: 'postgres-development',
        image: { reference: 'postgres:17-alpine' }, state: 'running', health: 'healthy',
        group_name: 'development', created_at_unix_ms: 1_724_000_000_000, management: { managed: false },
      },
    ]);
    await settle();

    const loadedToolbar = root.querySelector<HTMLElement>('.container-resource-toolbar')!;
    const loadedToolbarRect = loadedToolbar.getBoundingClientRect();
    const loadedContentTop = root.querySelector<HTMLElement>('.container-inventory-scroll')!.getBoundingClientRect().top;
    expect(Math.abs(loadingToolbarRect.height - loadedToolbarRect.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(loadingContentTop - loadedContentTop)).toBeLessThanOrEqual(1);
    if (mode === 'table') {
      const loadedRowHeight = root.querySelector<HTMLElement>('[data-container-resource-row-index]')!.getBoundingClientRect().height;
      expect(Math.abs(loadingItemHeight - loadedRowHeight)).toBeLessThanOrEqual(1);
    } else {
      const loadedCardHeight = root.querySelector<HTMLElement>('[data-container-mobile-list] > .container-mobile-card')!.getBoundingClientRect().height;
      expect(Math.abs(loadingItemHeight - loadedCardHeight)).toBeLessThanOrEqual(1);
    }
  });
});
