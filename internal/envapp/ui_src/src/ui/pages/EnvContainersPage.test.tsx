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
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => harness.notify,
}));

function icon(name: string) {
  return (props: { class?: string }) => <span data-icon={name} class={props.class} />;
}

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  AlertTriangle: icon('alert'),
  FileText: icon('file'),
  Layers: icon('layers'),
  Pause: icon('pause'),
  Play: icon('play'),
  Plus: icon('plus'),
  Refresh: icon('refresh'),
  Stop: icon('stop'),
  Trash: icon('trash'),
  X: icon('x'),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => <button type="button" class={props.class} disabled={props.disabled} aria-label={props['aria-label']} onClick={props.onClick}>{props.children}</button>,
  Input: (props: any) => <input class={props.class} value={props.value} onInput={props.onInput} />,
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
  cancelContainerOperation: vi.fn(),
  createContainerOperation: vi.fn(),
  getContainerStats: vi.fn(),
  preflightContainerOperation: vi.fn(),
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
    }]);
    harness.endpointStatus.mockReset().mockResolvedValue({
      endpoint_id: 'docker-primary', engine: 'docker', display_name: 'Primary Docker', available: true,
    });
    harness.listResources.mockReset().mockResolvedValue([{
      container_id: 'container-1',
      name: 'Managed API',
      state: 'running',
      management: { managed: true, owner: { kind: 'web_service', service_id: 'service-1', name: 'API' } },
    }]);
    harness.resourceDetails.mockReset().mockResolvedValue({ container_id: 'container-1', state: 'running' });
    harness.listOperations.mockReset().mockResolvedValue([]);
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
    expect(host.querySelector('.md\\:hidden button')).not.toBeNull();
    expect(host.querySelectorAll('.container-touch-target').length).toBeGreaterThan(3);
    expect(harness.listResources).toHaveBeenCalledWith('containers', 'docker', 'docker-primary');
    expect(harness.storageWrites.some((entry) => entry.key === 'containers:widget-1')).toBe(true);
  });

  it('keeps a Web Services-managed resource read-only and links to its owner', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    (host.querySelector('tbody tr') as HTMLElement).click();
    await settle();
    const openService = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'containers.managed.openService');
    expect(openService).toBeDefined();
    expect(host.textContent).not.toContain('containers.actions.remove');

    openService?.click();
    expect(harness.goActivity).toHaveBeenCalledWith('ports');
    expect(harness.storageWrites).toContainEqual({ key: 'webServices:focus', value: { version: 1, serviceID: 'service-1' } });
  });

  it('degrades mutation controls when the session lacks Write and Admin', async () => {
    Object.assign(harness.permissions, { can_write: false, can_admin: false, is_owner: false });
    harness.listResources.mockResolvedValue([{
      container_id: 'container-2', name: 'Worker', state: 'stopped', management: { managed: false },
    }]);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvContainersPage />, host);
    await settle();

    const create = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('containers.create.container'));
    expect(create?.disabled).toBe(true);
    (host.querySelector('tbody tr') as HTMLElement).click();
    await settle();
    const remove = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('containers.actions.remove'));
    expect(remove?.disabled).toBe(true);
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
