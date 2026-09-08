import '../../index.css';

import { commands, page, userEvent } from 'vitest/browser';
import { ThemeProvider, useTheme } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n';
import { requestContainerResourceNavigation } from '../services/containerResourceNavigation';

const browserHarness = vi.hoisted(() => ({
  notify: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
  listRuntimes: vi.fn(),
  listResources: vi.fn(),
  resourceDetails: vi.fn(),
  imageBuildHistory: vi.fn(),
  volumeDiskUsage: vi.fn(),
  listOperations: vi.fn(),
  preflight: vi.fn(),
  createExecSession: vi.fn(),
  deleteExecSession: vi.fn(),
  execTerminalProps: new Map<string, any>(),
}));

vi.mock('@floegence/floe-webapp-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core')>(),
  useNotification: () => browserHarness.notify,
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

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({ session: () => null }),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    fs: {
      getPathContext: async () => ({
        agentHomePathAbs: '/home/demo',
        homePathAbs: '/home/demo',
        defaultRootId: 'home',
        roots: [
          { id: 'home', label: 'Home', pathAbs: '/home/demo', kind: 'home', permissions: { read: true, write: true } },
          { id: 'computer', label: 'Computer', pathAbs: '/', kind: 'computer', permissions: { read: true, write: false } },
        ],
      }),
      list: vi.fn().mockResolvedValue({ entries: [] }),
    },
  }),
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
  listContainerOperations: browserHarness.listOperations,
  listContainerOperationEvents: vi.fn().mockResolvedValue([]),
  subscribeContainerOperationEvents: vi.fn().mockResolvedValue(undefined),
  createComposeProjectDefinition: vi.fn(),
  getComposeProjectDefinition: vi.fn(),
  updateComposeProjectDefinition: vi.fn(),
  deleteComposeProjectDefinition: vi.fn(),
  getContainerImageBuildHistory: browserHarness.imageBuildHistory,
  getVolumeDiskUsage: browserHarness.volumeDiskUsage,
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

const mediaCommands = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void>;
};

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

function mount(variant: 'activity' | 'workbench' = 'activity', appearance: 'light' | 'dark' = 'light') {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.inset = '0';
  document.body.append(host);
  function Surface() {
    useTheme().setTheme(appearance);
    return <I18nProvider><EnvContainersPage variant={variant} /></I18nProvider>;
  }
  const dispose = render(() => <ThemeProvider><Surface /></ThemeProvider>, host);
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
    browserHarness.volumeDiskUsage.mockReset().mockResolvedValue({ sampled_at_unix_ms: 1, volumes: [] });
    browserHarness.listOperations.mockReset().mockResolvedValue([]);
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
    browserHarness.imageBuildHistory.mockReset().mockResolvedValue([]);
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

  it('keeps operation hover feedback inside the portaled drawer', async () => {
    await page.viewport(1440, 900);
    browserHarness.listOperations.mockResolvedValue(['golang:1.26', 'postgres:17-alpine'].map((identity, index) => ({
      operation_id: `operation-${index}`, request_id: `request-${index}`, request_hash: 'request', plan_hash: 'plan',
      method: 'images.pull', engine: 'docker', resource_kind: 'image', resource_identity: identity,
      state: index === 0 ? 'running' : 'succeeded', cancel_requested: false,
      created_at_unix_ms: 1, started_at_unix_ms: 2, updated_at_unix_ms: 3,
    })));
    const mounted = mount();
    dispose = mounted.dispose;
    await settle();
    mounted.host.querySelector<HTMLButtonElement>('button[aria-label="Operations"]')!.click();
    await settle();
    const workspace = document.querySelector<HTMLElement>('[data-container-operations]')!;
    expect(workspace.closest('[data-container-page]')).toBeNull();
    const card = workspace.querySelector<HTMLElement>('.container-operation-card[aria-selected="false"]')!;
    const idleBackground = getComputedStyle(card).backgroundColor;
    await page.elementLocator(card).hover();
    await expect.poll(() => getComputedStyle(card).backgroundColor).not.toBe(idleBackground);
    expect(getComputedStyle(card).transitionDuration).toBe('0.12s');
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
    expect(getComputedStyle(card).transitionDuration).toBe('0s');
  });

  it.each([
    { width: 1440, height: 900, variant: 'activity' as const, name: 'desktop' },
    { width: 640, height: 720, variant: 'workbench' as const, name: 'workbench' },
    { width: 390, height: 844, variant: 'activity' as const, name: 'mobile' },
  ])('shows Compose detail errors and retry without false empty content on $name', async ({ width, height, variant }) => {
    await page.viewport(width, height);
    browserHarness.listResources.mockImplementation((view: string) => Promise.resolve(view === 'compose-projects'
      ? [{ project_id: 'project-1', name: 'dev_deps', status: 'running', service_count: 3, container_count: 3, running_count: 3, management: { managed: false } }]
      : []));
    browserHarness.resourceDetails.mockRejectedValueOnce(new Error('private CLI output')).mockResolvedValue({
      project: { project_id: 'project-1', name: 'dev_deps', status: 'running', service_count: 3, container_count: 3, running_count: 3,
        containers: ['keycloak-dev-gateway', 'keycloak-dev', 'keycloak-mysql-dev'].map((name, i) => ({ container_id: `full-id-${i}`, name, state: 'running' })),
      },
    });
    const mounted = mount(variant);
    dispose = mounted.dispose;
    await settle();
    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    Array.from(root.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('Compose'))!.click();
    await settle();
    const resource = Array.from(root.querySelectorAll<HTMLElement>('[data-container-resource-row], .container-mobile-card'))
      .find((element) => element.getBoundingClientRect().width > 0)!;
    resource.click();
    await settle();
    const error = root.querySelector<HTMLElement>('[data-container-detail-error]')!;
    expect(error).not.toBeNull();
    expect(root.textContent).not.toContain('No referenced containers');
    expect(root.textContent).not.toContain('private CLI output');
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    expect(error.scrollWidth).toBeLessThanOrEqual(error.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
    error.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.container-detail-tabs [role="tab"]'))
      .find((button) => button.textContent === 'Containers')!.click();
    await settle();
    expect(root.querySelectorAll('.container-reference-row')).toHaveLength(3);
    expect(root.querySelector('[data-container-detail-error]')).toBeNull();
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it.each([
    { width: 1440, height: 900, variant: 'activity' as const },
    { width: 900, height: 720, variant: 'workbench' as const },
    { width: 390, height: 844, variant: 'activity' as const },
    { width: 320, height: 720, variant: 'workbench' as const },
  ])('shows volume disk usage and readable reference status at $width in $variant', async ({ width, height, variant }) => {
    await page.viewport(width, height);
    const volumes = [
      { name: 'redeven-db-data-dev', referenced_containers: 2, references_complete: true, driver: 'local' },
      { name: '5b8cea84ca4ca979d636da025ad0cb43bbf599e4eee2ad0c8f6be43601cfef80', referenced_containers: 0, references_complete: true, driver: 'local' },
      { name: 'remote-cache', referenced_containers: 0, references_complete: false, driver: 'local' },
    ];
    browserHarness.listResources.mockImplementation((view: string) => Promise.resolve(view === 'volumes' ? volumes : []));
    browserHarness.resourceDetails.mockResolvedValue({ ...volumes[0], used_by: [{ container_id: 'stopped-container', name: 'Stopped API', state: 'exited' }] });
    browserHarness.volumeDiskUsage.mockResolvedValue({ volumes: [{ name: volumes[0].name, size_bytes: 1250000000 }, { name: volumes[1].name, size_bytes: 0 }] });
    const mounted = mount(variant);
    dispose = mounted.dispose;
    await settle();
    await page.getByRole('tab', { name: 'Volumes', exact: true }).click();
    await settle();
    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    const desktop = width >= 640;
    const surface = root.querySelector<HTMLElement>(desktop ? '.container-resource-table-shell' : '.container-mobile-list')!;
    expect(surface.textContent).toContain('In use');
    expect(surface.textContent).toContain('Unused');
    expect(surface.textContent).toContain('Unknown');
    expect(surface.textContent).toContain('1.2 GB');
    expect(surface.textContent).toContain('0 B');
    expect(surface.textContent).toContain('Unavailable');
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    for (const usage of surface.querySelectorAll<HTMLElement>('.container-volume-usage')) {
      expect(usage.scrollWidth).toBeLessThanOrEqual(usage.clientWidth + 1);
      if (!desktop) expect(usage.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    }
    if (!desktop) for (const row of surface.querySelectorAll<HTMLElement>('.container-mobile-card')) expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
    if (desktop) {
      const usage = Array.from(surface.querySelectorAll<HTMLButtonElement>('.container-volume-usage-link')).find((button) => button.textContent?.includes('In use'))!;
      usage.focus();
      await userEvent.keyboard('{Enter}');
      await settle();
      expect(root.querySelector('.container-reference-list')?.textContent).toContain('Stopped API');
    } else {
      const row = Array.from(surface.querySelectorAll<HTMLButtonElement>('.container-mobile-card')).find((button) => button.textContent?.includes('redeven-db-data-dev'))!;
      await userEvent.click(row);
      await settle();
      expect(root.querySelector('.container-detail-body')?.textContent).toContain('1.2 GB');
      expect(root.querySelector('.container-detail-body')?.textContent).toContain('In use');
    }
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

  it.each(['light', 'dark'] as const)('prioritizes resource identity within a narrow %s desktop surface', async (appearance) => {
    await page.viewport(760, 900);
    browserHarness.listRuntimes.mockResolvedValue([
      { endpoint_id: 'docker', engine: 'docker', state: 'ready', capabilities: {} },
      { endpoint_id: 'podman', engine: 'podman', state: 'ready', capabilities: {} },
    ]);
    browserHarness.listResources.mockImplementation((view: string) => Promise.resolve({
      containers: [{ container_id: 'api-1', name: 'development-application-api', state: 'running', image: { reference: 'registry.example.test/development/application:latest' } }],
      images: [{ id: 'image-1', reference: 'registry.example.test/development/application:latest', size_bytes: 2048, referenced_containers: 1 }],
      volumes: [{ name: 'development-application-database-persistent-storage', driver: 'local', references_complete: true, referenced_containers: 1 }],
      'compose-projects': [{ project_id: 'project-1', name: 'development-application', status: 'running', container_count: 3, running_count: 2 }],
      pods: [{ pod_id: 'pod-1', name: 'development-application', status: 'running', container_count: 3, running_count: 2 }],
    }[view] ?? []));
    const mounted = mount('workbench', appearance);
    dispose = mounted.dispose;
    await settle();
    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    expect(document.documentElement.classList.contains('dark')).toBe(appearance === 'dark');
    for (const label of ['Containers', 'Images', 'Volumes', 'Compose Projects', 'Pods']) {
      Array.from(root.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
        .find((tab) => tab.textContent === label)!.click();
      await settle();
      const table = root.querySelector<HTMLTableElement>('[data-container-resource-table]')!;
      expect(table.querySelector('th')?.textContent, label).toBe('Name');
      expect(table.querySelector('tbody td .container-name-cell'), label).not.toBeNull();
      const viewport = root.querySelector<HTMLElement>('.container-inventory-scroll')!;
      expect(viewport.scrollWidth, label).toBeLessThanOrEqual(viewport.clientWidth + 1);
      const name = table.querySelector<HTMLElement>('.container-name-cell')!;
      expect(name.getBoundingClientRect().width, label).toBeGreaterThan(180);
      expect(table.querySelectorAll('tbody tr').length, label).toBeGreaterThan(0);
    }
  });

  it('keeps reduced-motion detail navigation immediate', async () => {
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
    try {
      await page.viewport(1024, 800);
      const mounted = mount();
      dispose = mounted.dispose;
      await settle();
      const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
      root.querySelector<HTMLElement>('[data-container-resource-row]')!.click();
      await settle();
      const detail = root.querySelector<HTMLElement>('[data-container-detail-page]')!;
      const identity = detail.querySelector<HTMLElement>('.container-detail-identity')!;
      expect(getComputedStyle(identity).animationName).toBe('none');
      expect(getComputedStyle(identity).transform).toBe('none');
      expect(detail.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running')).toHaveLength(0);
      expect(detail.querySelectorAll('[role="tab"]')).not.toHaveLength(0);
    } finally {
      await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    }
  });

  it('animates the shared tab indicator without delaying navigation in a scaled Workbench', async () => {
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    await page.viewport(1200, 800);
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    mounted.host.style.transform = 'scale(0.8)';
    mounted.host.style.transformOrigin = 'top left';
    await settle();
    const tabs = mounted.host.querySelector<HTMLElement>('.container-resource-tabs')!;
    const indicator = tabs.querySelector<HTMLElement>('.container-tab-indicator')!;
    const start = indicator.getBoundingClientRect().left;
    const imageTab = Array.from(tabs.querySelectorAll<HTMLElement>('[role="tab"]'))
      .find((tab) => tab.textContent === 'Images')!;
    const pending = deferred<readonly unknown[]>();
    browserHarness.listResources.mockReturnValue(pending.promise);
    imageTab.click();
    await settle();
    expect(imageTab.getAttribute('aria-selected')).toBe('true');
    expect(mounted.host.querySelector('[data-container-list-loading]')).not.toBeNull();
    const animations = indicator.getAnimations();
    expect(animations.some((animation) => animation.playState === 'running')).toBe(true);
    await Promise.all(animations.map((animation) => animation.finished));
    const destination = indicator.getBoundingClientRect();
    const activeTab = tabs.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
    expect(activeTab.textContent).toBe('Images');
    expect(destination.left).toBeGreaterThan(start);
    expect(Math.abs(destination.left - activeTab.getBoundingClientRect().left)).toBeLessThan(1);
    expect(Math.abs(destination.width - activeTab.getBoundingClientRect().width)).toBeLessThan(1);
    pending.resolve([]);
    await settle();
  });

  it('keeps resource tabs interactive while an uncached view is loading', async () => {
    const delayedImages = deferred<readonly unknown[]>();
    browserHarness.listResources.mockImplementation((view: string) => {
      if (view === 'images') return delayedImages.promise;
      if (view === 'volumes') return Promise.resolve([{ name: 'build-cache', driver: 'local', referenced_containers: 0 }]);
      return Promise.resolve([]);
    });
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    const resourceTab = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((tab) => tab.textContent?.includes(label))!;

    resourceTab('Images').click();
    await settle();

    expect(resourceTab('Images').getAttribute('aria-selected')).toBe('true');
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]')).every((tab) => !tab.disabled)).toBe(true);
    expect(root.querySelector('[data-container-list-loading]')).not.toBeNull();

    resourceTab('Volumes').click();
    await settle();

    expect(resourceTab('Volumes').getAttribute('aria-selected')).toBe('true');
    expect(root.textContent).toContain('build-cache');

    delayedImages.resolve([{ id: 'stale-image', reference: 'stale:latest', referenced_containers: 0 }]);
    await settle();

    expect(resourceTab('Volumes').getAttribute('aria-selected')).toBe('true');
    expect(root.textContent).not.toContain('stale:latest');
  });

  it('keeps build details readable and technical layer IDs secondary', async () => {
    await page.viewport(1440, 900);
    browserHarness.listResources.mockImplementation((view: string) => Promise.resolve(view === 'images' ? [{
      id: 'sha256:image-layered', reference: 'node:24.20.0-bookworm-slim', size_bytes: 80_595_921, referenced_containers: 0,
    }] : []));
    browserHarness.resourceDetails.mockResolvedValue({
      id: 'sha256:image-layered', reference: 'node:24.20.0-bookworm-slim',
      layers: [
        { digest: 'sha256:13a56b6535801be2adde694dabaf1c2df1d862a390661907dac821c42cd565cc' },
        { digest: 'sha256:ff00d448ccb0cd940fed13f51fe9b4fa9b9985b4c0d8234504db84fb695a24b6' },
      ],
    });
    const longCommand = 'apt-get update && apt-get install -y ca-certificates curl wget gnupg dirmngr --no-install-recommends';
    browserHarness.imageBuildHistory.mockResolvedValue([
      { step: 0, operation: 'run', summary: longCommand, filesystem_effect: 'filesystem', size_bytes: 152_000_000, created_at_unix_ms: 1_787_853_587_000 },
      { step: 1, operation: 'copy', summary: 'COPY docker-entrypoint.sh /usr/local/bin/', filesystem_effect: 'filesystem', size_bytes: 20_500, created_at_unix_ms: 1_787_853_599_000 },
    ]);
    const mounted = mount('activity');
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    Array.from(root.querySelectorAll<HTMLButtonElement>('.container-resource-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('Images'))?.click();
    await settle();
    root.querySelector<HTMLTableRowElement>('tbody tr')?.click();
    await settle();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.container-detail-tabs [role="tab"]'))
      .find((button) => button.textContent?.includes('Layers'))?.click();
    await settle();

    const details = root.querySelector<HTMLDetailsElement>('.container-layer-identities')!;
    expect(root.querySelector('.container-layer-change code')?.getAttribute('title')).toBe(longCommand);
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toContain('2 filesystem layers');
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);

    details.querySelector<HTMLElement>('summary')?.click();
    await settle();
    expect(details.open).toBe(true);
    expect(details.textContent).toContain('Base');
    expect(details.textContent).toContain('Top');
    expect(details.textContent).toContain('13a56b653580…');
    expect(details.querySelector('.container-layer-digest')?.getAttribute('title')).toContain('sha256:13a56b6535801be2');
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);

    await page.viewport(390, 844);
    await settle();
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
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
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const visibleButtons = Array.from(servicePage.querySelectorAll<HTMLButtonElement>('button')).filter((button) => button.getClientRects().length > 0);
    for (let attempt = 0; attempt < 3 && !visibleButtons.every((button) => button.getBoundingClientRect().height >= 44); attempt += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
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

  it('adapts service cards to the Workbench width inside a wide application window', async () => {
    await page.viewport(1440, 900);
    const mounted = mount('workbench');
    dispose = mounted.dispose;
    mounted.host.style.width = '560px';
    mounted.host.style.right = 'auto';
    await settle();
    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    root.querySelector<HTMLButtonElement>('[aria-label="Container services"]')!.click();
    await settle();
    const grid = root.querySelector<HTMLElement>('.container-services-grid')!;
    expect(getComputedStyle(grid).gridTemplateColumns.split(' ')).toHaveLength(1);
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    const servicePage = root.querySelector<HTMLElement>('[data-container-services-page]')!;
    expect(servicePage.scrollWidth).toBeLessThanOrEqual(servicePage.clientWidth + 1);
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
