import '../../index.css';

import { page } from 'vitest/browser';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n';

const browserHarness = vi.hoisted(() => ({
  notify: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
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
  listContainerEndpoints: vi.fn().mockResolvedValue([{
    endpoint_id: 'desktop-linux', engine: 'docker', display_name: 'Desktop Linux', default: true,
    remote: false, available: true, engine_version: '27.3.1', rootless: false,
    capabilities: { collection_stats: true, container_files: true, volume_files: false, exec: false },
  }]),
  getContainerEndpointStatus: vi.fn().mockResolvedValue({
    endpoint_id: 'desktop-linux', engine: 'docker', display_name: 'Desktop Linux', default: true,
    remote: false, available: true, engine_version: '27.3.1', rootless: false,
    capabilities: { collection_stats: true, container_files: true, volume_files: false, exec: false },
  }),
  listContainerResources: vi.fn().mockResolvedValue([
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
  ]),
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
    cpu_percent: 37.4,
    memory_bytes: 268_435_456,
    network_rx_bytes: 12_582_912,
    network_tx_bytes: 4_194_304,
  }),
  preflightContainerOperation: vi.fn(),
  subscribeContainerOperation: vi.fn(),
  subscribeContainerLogs: vi.fn().mockResolvedValue(undefined),
  subscribeContainerStats: vi.fn().mockImplementation(async (_identity: string, _engine: string, _endpoint: string, observe: (sample: unknown) => void) => {
    observe({ container_id: 'e2c83fcda485', cpu_percent: 38.2, memory_bytes: 275_000_000, network_rx_bytes: 13_000_000, network_tx_bytes: 4_400_000 });
  }),
  subscribeContainerStatsCollection: vi.fn().mockImplementation(async (_engine: string, _endpoint: string, observe: (sample: unknown) => void) => {
    observe({ sampled_at_unix_ms: Date.now(), samples: [{ container_id: 'e2c83fcda485', cpu_percent: 38.2, memory_bytes: 275_000_000 }] });
  }),
  tailContainerLogs: vi.fn(),
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
    const mounted = mount();
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    const table = root.querySelector<HTMLElement>('[data-container-resource-table]')!;
    const rows = Array.from(root.querySelectorAll<HTMLElement>('tbody tr'));
    expect(getComputedStyle(table).display).not.toBe('none');
    expect(root.querySelector('.container-distribution__track')).toBeNull();
    expect(root.querySelector('.container-inspector')).toBeNull();
    expect(root.querySelectorAll('thead th')).toHaveLength(5);
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).not.toContain('8bbf320351e557285fe1f143ee14a6d2334f24f5');
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);

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

    const statsTab = Array.from(detailPage.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Stats'))!;
    statsTab.click();
    await settle();
    expect(detailPage.querySelectorAll('.container-sparkline')).toHaveLength(2);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it.each([{ width: 390, height: 844 }, { width: 320, height: 568 }])('uses cards and a viewport-contained detail surface at $width x $height', async (viewport) => {
    await page.viewport(viewport.width, viewport.height);
    const mounted = mount();
    dispose = mounted.dispose;
    await settle();

    const root = mounted.host.querySelector<HTMLElement>('[data-container-page]')!;
    const cards = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-container-mobile-list] > button'));
    expect(cards).toHaveLength(4);
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
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });
});
