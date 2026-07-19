// @vitest-environment jsdom

import type {
  PluginOpenSurfaceInSlotOptions,
  PluginOpenSurfaceRequest,
  PluginPlatformClient,
  PluginSurfaceHost,
  PluginSurfaceSlot,
} from '@floegence/redevplugin-ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedReDevPluginFetch,
  createPluginSurfacePlacementCoordinator,
  redevPluginAPIPath,
  redevPluginCSRFHeader,
  redevPluginCSRFProof,
} from './pluginPlatform';

vi.mock('../services/localApi', () => ({
  prepareLocalApiRequestInit: vi.fn(async (init: RequestInit) => init),
}));

const request: PluginOpenSurfaceRequest = {
  plugin_instance_id: 'plugini_redeven_official_containers',
  surface_id: 'containers.dashboard',
  expected_management_revision: 7,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createHost(id: string, order?: string[]): PluginSurfaceHost {
  return {
    element: document.createElement('iframe'),
    surfaceInstanceId: id,
    sendLifecycle: vi.fn((event) => order?.push(`lifecycle:${event.type}`)),
    close: vi.fn(async () => ({
      quiesce: { outcome: 'acknowledged' as const, durationMs: 1 },
      revokeDurationMs: 1,
      totalDurationMs: 2,
    })),
    dispose: vi.fn(async () => undefined),
  };
}

function createSlot(order: string[], id: string): PluginSurfaceSlot {
  return {
    element: document.createElement('div'),
    close: vi.fn(async () => {
      order.push(`${id}:close`);
      return undefined;
    }),
    dispose: vi.fn(async () => {
      order.push(`${id}:dispose`);
    }),
  } as unknown as PluginSurfaceSlot;
}

function createClient(
  open: (
    slot: PluginSurfaceSlot,
    surfaceRequest: PluginOpenSurfaceRequest,
    options?: PluginOpenSurfaceInSlotOptions,
  ) => Promise<PluginSurfaceHost>,
): PluginPlatformClient {
  return { openSurfaceInSlot: vi.fn(open) } as unknown as PluginPlatformClient;
}

describe('createPluginSurfacePlacementCoordinator', () => {
  it('closes and disposes the previous slot before opening a fresh surface instance', async () => {
    const order: string[] = [];
    const firstSlot = createSlot(order, 'first');
    const secondSlot = createSlot(order, 'second');
    const client = createClient(async (_slot, surfaceRequest) => {
      order.push(`open:${surfaceRequest.surface_id}`);
      return createHost(`surface_${order.length}`);
    });
    const coordinator = createPluginSurfacePlacementCoordinator(client);

    await coordinator.open(firstSlot, request);
    await coordinator.open(secondSlot, { ...request, surface_id: 'containers.details' });

    expect(order).toEqual([
      'open:containers.dashboard',
      'first:close',
      'first:dispose',
      'open:containers.details',
    ]);
    expect(vi.mocked(client.openSurfaceInSlot).mock.results).toHaveLength(2);
  });

  it('aborts an opening lease immediately when its placement is released', async () => {
    const order: string[] = [];
    const slot = createSlot(order, 'opening');
    let observedSignal: AbortSignal | undefined;
    const client = createClient((_slot, _surfaceRequest, options) => {
      observedSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const coordinator = createPluginSurfacePlacementCoordinator(client);

    const opening = coordinator.open(slot, request);
    await Promise.resolve();
    const released = coordinator.release(slot);

    expect(observedSignal?.aborted).toBe(true);
    await expect(opening).rejects.toThrow('aborted');
    await released;
    expect(order).toEqual(['opening:dispose']);
  });

  it('retires the active slot exactly once during close and coordinator disposal', async () => {
    const order: string[] = [];
    const slot = createSlot(order, 'active');
    const client = createClient(async () => createHost('surface_active', order));
    const coordinator = createPluginSurfacePlacementCoordinator(client);

    coordinator.setVisible(slot, true);
    await coordinator.open(slot, request);
    await coordinator.closeActive();
    await coordinator.dispose();
    await coordinator.release(slot);

    expect(order).toEqual([
      'lifecycle:visible',
      'lifecycle:hidden',
      'active:close',
      'active:dispose',
    ]);
  });

  it('retires a terminal SDK surface without publishing lifecycle to its disposed host', async () => {
    const order: string[] = [];
    const slot = createSlot(order, 'failed');
    const host = createHost('surface_failed', order);
    vi.mocked(host.sendLifecycle).mockImplementation((event) => {
      if (event.type === 'hidden') throw new Error('disposed host received hidden');
      order.push(`lifecycle:${event.type}`);
    });
    const client = createClient(async () => host);
    const coordinator = createPluginSurfacePlacementCoordinator(client);

    coordinator.setVisible(slot, true);
    await coordinator.open(slot, request);
    const failed = coordinator.fail(slot, new Error('surface terminated'));
    coordinator.setVisible(slot, false);
    await failed;
    await coordinator.release(slot);

    expect(order).toEqual([
      'lifecycle:visible',
      'failed:close',
      'failed:dispose',
    ]);
  });

  it('always closes and disposes a ready slot when hidden lifecycle delivery fails', async () => {
    const order: string[] = [];
    const slot = createSlot(order, 'hidden-error');
    const host = createHost('surface_hidden_error', order);
    vi.mocked(host.sendLifecycle).mockImplementation((event) => {
      if (event.type === 'hidden') throw new Error('hidden delivery failed');
      order.push(`lifecycle:${event.type}`);
    });
    const coordinator = createPluginSurfacePlacementCoordinator(createClient(async () => host));

    coordinator.setVisible(slot, true);
    await coordinator.open(slot, request);
    await expect(coordinator.closeActive()).rejects.toThrow('hidden delivery failed');

    expect(order).toEqual([
      'lifecycle:visible',
      'hidden-error:close',
      'hidden-error:dispose',
    ]);
  });

  it('replays the same retirement failure instead of reporting a later release as successful', async () => {
    const order: string[] = [];
    const slot = createSlot(order, 'retirement-error');
    vi.mocked(slot.close).mockRejectedValue(new Error('server revoke failed'));
    const coordinator = createPluginSurfacePlacementCoordinator(createClient(async () => createHost('surface_error', order)));

    await coordinator.open(slot, request);
    await expect(coordinator.closeActive()).rejects.toThrow('server revoke failed');
    await expect(coordinator.release(slot)).rejects.toThrow('server revoke failed');

    expect(slot.close).toHaveBeenCalledTimes(1);
    expect(slot.dispose).toHaveBeenCalledTimes(1);
  });

  it('locally disposes a slot after the SDK-owned mutation lifecycle invalidates it', async () => {
    const order: string[] = [];
    const slot = createSlot(order, 'mutation');
    const coordinator = createPluginSurfacePlacementCoordinator(createClient(async () => createHost('surface_mutation', order)));

    await coordinator.open(slot, request);
    await coordinator.disposeActive();
    await coordinator.release(slot);

    expect(order).toEqual(['lifecycle:hidden', 'mutation:dispose']);
  });
});

describe('createAuthenticatedReDevPluginFetch', () => {
  it('admits only the canonical same-origin API and attaches the CSRF proof', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const platformFetch = createAuthenticatedReDevPluginFetch();

    await platformFetch(`${redevPluginAPIPath}/catalog`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get(redevPluginCSRFHeader)).toBe(redevPluginCSRFProof);
    expect(init.cache).toBeUndefined();
  });

  it('rejects external origins and non-platform same-origin routes before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const platformFetch = createAuthenticatedReDevPluginFetch();

    await expect(platformFetch('https://example.invalid/_redevplugin/api/plugins/catalog', { method: 'GET', headers: {} }))
      .rejects.toThrow('canonical same-origin platform API');
    await expect(platformFetch('/api/plugins/catalog', { method: 'GET', headers: {} }))
      .rejects.toThrow('canonical same-origin platform API');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
