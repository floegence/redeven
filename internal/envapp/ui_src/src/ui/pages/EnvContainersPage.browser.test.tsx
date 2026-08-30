import '../../index.css';

import { page } from 'vitest/browser';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n';

const browserHarness = vi.hoisted(() => ({
  notify: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
  listResources: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core')>(),
  useNotification: () => browserHarness.notify,
}));

vi.mock('../primitives/EnvAppModal', () => ({
  Dialog: (props: { open: boolean }) => props.open ? <section role="dialog" /> : null,
}));

vi.mock('../primitives/EnvAppDrawer', () => ({
  EnvAppDrawer: (props: { open: boolean }) => props.open ? <aside data-drawer /> : null,
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

vi.mock('../services/containerResourcesApi', () => ({
  listContainerRuntimes: vi.fn().mockResolvedValue([{
    endpoint_id: 'desktop-linux', engine: 'docker', state: 'ready', engine_version: '27.3.1', rootless: false,
    capabilities: { collection_stats: true, volume_files: false, exec: false },
  }, { engine: 'podman', state: 'not_installed' }]),
  listContainerResources: browserHarness.listResources,
  getContainerResourceDetails: vi.fn().mockImplementation((_view: string, identity: string) => Promise.resolve({
    container_id: identity,
    name: identity.includes('8bbf') ? 'redeven-api' : 'postgres-development',
    image: { reference: identity.includes('8bbf') ? 'ghcr.io/floegence/redeven-api:edge' : 'postgres:17-alpine' },
    state: 'running', health: 'healthy', group_name: 'redeven-dev', created_at_unix_ms: 1_725_000_000_000,
    runtime: { network_mode: 'redeven-dev', restart_policy: 'unless-stopped', user: '1000:1000', privileged: false, read_only_root: true },
    ports: [{ protocol: 'tcp', host_ip: '127.0.0.1', host_port: 4318, port: 4318 }],
  })),
  listContainerOperations: vi.fn().mockResolvedValue([]),
  getContainerImageHistory: vi.fn().mockResolvedValue([]),
  getRawContainerInspect: vi.fn().mockResolvedValue({}),
  listContainerResourceFiles: vi.fn().mockResolvedValue({ path: '/', entries: [], truncated: false }),
  readContainerResourceFile: vi.fn().mockResolvedValue(new Blob()),
  cancelContainerOperation: vi.fn(),
  createContainerOperation: vi.fn(),
  getContainerStats: vi.fn().mockResolvedValue({
    sampled_at_unix_ms: 1_725_000_000_000,
    container_id: 'e2c83fcda485',
    cpu_percent: 37.4,
    memory_bytes: 268_435_456,
    memory_limit: 1_073_741_824,
    network_rx_bytes: 12_582_912,
    network_tx_bytes: 4_194_304,
  }),
  preflightContainerOperation: vi.fn(),
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

function mount(variant: 'activity' | 'workbench' = 'activity') {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.inset = '0';
  document.body.append(host);
  const dispose = render(() => <I18nProvider><EnvContainersPage variant={variant} /></I18nProvider>, host);
  return { host, dispose };
}

describe('native Containers responsive product surface', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    document.documentElement.classList.add('dark');
    window.localStorage.clear();
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
    expect(rows[0].textContent).not.toContain('8bbf320351e557285fe1f143ee14a6d2334f24f5');
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);

    const overflow = root.querySelector<HTMLButtonElement>('.container-row-menu button');
    expect(overflow).not.toBeNull();
    overflow!.click();
    await settle();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    root.querySelector<HTMLElement>('.container-resource-toolbar')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    root.querySelector<HTMLElement>('.container-resource-toolbar')!.click();
    await settle();
    expect(document.querySelector('[role="menu"]')?.getAttribute('aria-hidden')).toBe('true');

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
