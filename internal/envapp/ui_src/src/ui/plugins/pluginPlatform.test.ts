// @vitest-environment jsdom

import {
  PluginPlatformClient,
  PluginPlatformRequestError,
  type PluginSessionScopeRevokeResult,
  type PluginOpenSurfaceInSlotOptions,
  type PluginOpenSurfaceRequest,
  type PluginSurfaceHost,
  type PluginSurfaceSlot,
} from '@floegence/redevplugin-ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedReDevPluginFetch,
  createPluginSurfacePlacementCoordinator,
  createRedevenPluginPlatform,
  redevPluginAPIPath,
  redevPluginCSRFHeader,
  redevPluginCSRFProof,
} from './pluginPlatform';
import {
  clearPluginSessionCredential,
  writePluginSessionCredential,
} from '../services/pluginSessionCredential';

vi.mock('../services/localApi', () => ({
  prepareLocalApiRequestInit: vi.fn(async (init: RequestInit) => init),
}));

const request: PluginOpenSurfaceRequest = {
  plugin_instance_id: 'plugini_redeven_official_containers',
  surface_id: 'containers.dashboard',
  expected_management_revision: 7,
};

afterEach(() => {
  clearPluginSessionCredential();
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
  it('keeps independent slots alive until each placement retires', async () => {
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
      'open:containers.details',
    ]);
    await coordinator.release(firstSlot);
    expect(order).toEqual([
      'open:containers.dashboard',
      'open:containers.details',
      'first:close',
      'first:dispose',
    ]);
    expect(secondSlot.close).not.toHaveBeenCalled();
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
    expect(order).toEqual(['opening:close', 'opening:dispose']);
  });

  it('retires every registered slot exactly once during closeAll and coordinator disposal', async () => {
    const order: string[] = [];
    const firstSlot = createSlot(order, 'first');
    const secondSlot = createSlot(order, 'second');
    const client = createClient(async () => createHost('surface_active', order));
    const coordinator = createPluginSurfacePlacementCoordinator(client);

    coordinator.setVisible(firstSlot, true);
    coordinator.setVisible(secondSlot, true);
    await coordinator.open(firstSlot, request);
    await coordinator.open(secondSlot, { ...request, surface_id: 'containers.details' });
    await coordinator.closeAll();
    await coordinator.dispose();
    await coordinator.release(firstSlot);
    await coordinator.release(secondSlot);

    expect(order).toEqual([
      'lifecycle:visible',
      'lifecycle:visible',
      'lifecycle:hidden',
      'first:close',
      'lifecycle:hidden',
      'second:close',
      'first:dispose',
      'second:dispose',
    ]);
  });

  it.each(['closeAll', 'dispose'] as const)(
    'waits for every local retirement before %s reports a sibling failure',
    async (operation) => {
      const order: string[] = [];
      const fastFailure = new Error('first revoke failed');
      const firstSlot = createSlot(order, 'first');
      const secondSlot = createSlot(order, 'second');
      vi.mocked(firstSlot.close).mockRejectedValue(fastFailure);
      let releaseSlowRetirement: (() => void) | undefined;
      const slowRetirement = new Promise<void>((resolve) => {
        releaseSlowRetirement = resolve;
      });
      vi.mocked(secondSlot.close).mockImplementation(async () => {
        order.push('second:close');
        await slowRetirement;
        return undefined;
      });
      const coordinator = createPluginSurfacePlacementCoordinator(
        createClient(async () => createHost('surface', order)),
      );

      await coordinator.open(firstSlot, request);
      await coordinator.open(secondSlot, { ...request, surface_id: 'containers.details' });

      let completed = false;
      let observedFailure: unknown;
      const retirement = coordinator[operation]().then(
        () => { completed = true; },
        (error: unknown) => {
          completed = true;
          observedFailure = error;
        },
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(completed).toBe(false);
      expect(secondSlot.dispose).not.toHaveBeenCalled();

      releaseSlowRetirement?.();
      await retirement;

      expect(observedFailure).toBe(fastFailure);
      expect(firstSlot.dispose).not.toHaveBeenCalled();
      expect(secondSlot.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it('invalidates only the slots owned by the affected plugin instance', async () => {
    const order: string[] = [];
    const firstSlot = createSlot(order, 'first');
    const secondSlot = createSlot(order, 'second');
    const coordinator = createPluginSurfacePlacementCoordinator(createClient(async () => createHost('surface', order)));

    await coordinator.open(firstSlot, request);
    await coordinator.open(secondSlot, { ...request, plugin_instance_id: 'plugin_other' });
    await coordinator.invalidatePlugin(request.plugin_instance_id);

    expect(order).toEqual(['lifecycle:hidden', 'lifecycle:hidden', 'first:dispose']);
    expect(firstSlot.close).not.toHaveBeenCalled();
    expect(secondSlot.dispose).not.toHaveBeenCalled();

    coordinator.setVisible(secondSlot, true);
    await coordinator.release(secondSlot);
    expect(order).toEqual([
      'lifecycle:hidden',
      'lifecycle:hidden',
      'first:dispose',
      'lifecycle:visible',
      'lifecycle:hidden',
      'second:close',
      'second:dispose',
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

  it('completes exact retirement when only hidden lifecycle delivery fails', async () => {
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
    await expect(coordinator.release(slot)).resolves.toBeUndefined();
    await expect(coordinator.release(slot)).resolves.toBeUndefined();

    expect(order).toEqual([
      'lifecycle:visible',
      'hidden-error:close',
      'hidden-error:dispose',
    ]);
  });

  it('retries only local disposal after exact close has succeeded', async () => {
    const order: string[] = [];
    const slot = createSlot(order, 'dispose-error');
    const disposeFailure = new Error('local dispose failed');
    vi.mocked(slot.dispose)
      .mockRejectedValueOnce(disposeFailure)
      .mockResolvedValueOnce(undefined);
    const coordinator = createPluginSurfacePlacementCoordinator(
      createClient(async () => createHost('surface_dispose_error', order)),
    );

    await coordinator.open(slot, request);
    await expect(coordinator.release(slot)).rejects.toBe(disposeFailure);

    expect(slot.close).toHaveBeenCalledTimes(1);
    expect(slot.dispose).toHaveBeenCalledTimes(1);

    await expect(coordinator.release(slot)).resolves.toBeUndefined();

    expect(slot.close).toHaveBeenCalledTimes(1);
    expect(slot.dispose).toHaveBeenCalledTimes(2);
  });

  it('keeps an exact slot registered and retries close after revocation fails', async () => {
    const order: string[] = [];
    const slot = createSlot(order, 'retirement-error');
    const revokeFailure = new Error('server revoke failed');
    vi.mocked(slot.close)
      .mockRejectedValueOnce(revokeFailure)
      .mockResolvedValueOnce(undefined);
    const coordinator = createPluginSurfacePlacementCoordinator(createClient(async () => createHost('surface_error', order)));

    await coordinator.open(slot, request);
    await expect(coordinator.release(slot)).rejects.toBe(revokeFailure);

    expect(slot.close).toHaveBeenCalledTimes(1);
    expect(slot.dispose).not.toHaveBeenCalled();

    await expect(coordinator.release(slot)).resolves.toBeUndefined();

    expect(slot.close).toHaveBeenCalledTimes(2);
    expect(slot.dispose).toHaveBeenCalledTimes(1);
  });

  it('retries only the exact failed slot without affecting a retired sibling', async () => {
    const order: string[] = [];
    const failedSlot = createSlot(order, 'failed');
    const siblingSlot = createSlot(order, 'sibling');
    const revokeFailure = new Error('failed exact revoke');
    vi.mocked(failedSlot.close)
      .mockRejectedValueOnce(revokeFailure)
      .mockResolvedValueOnce(undefined);
    const coordinator = createPluginSurfacePlacementCoordinator(
      createClient(async () => createHost('surface', order)),
    );

    await coordinator.open(failedSlot, request);
    await coordinator.open(siblingSlot, { ...request, surface_id: 'containers.details' });

    await expect(coordinator.release(failedSlot)).rejects.toBe(revokeFailure);
    await expect(coordinator.release(siblingSlot)).resolves.toBeUndefined();
    await expect(coordinator.release(failedSlot)).resolves.toBeUndefined();

    expect(failedSlot.close).toHaveBeenCalledTimes(2);
    expect(failedSlot.dispose).toHaveBeenCalledTimes(1);
    expect(siblingSlot.close).toHaveBeenCalledTimes(1);
    expect(siblingSlot.dispose).toHaveBeenCalledTimes(1);
  });

  it('locally disposes a slot after the SDK-owned mutation lifecycle invalidates it', async () => {
    const order: string[] = [];
    const slot = createSlot(order, 'mutation');
    const coordinator = createPluginSurfacePlacementCoordinator(createClient(async () => createHost('surface_mutation', order)));

    await coordinator.open(slot, request);
    await coordinator.invalidatePlugin(request.plugin_instance_id);
    await coordinator.release(slot);

    expect(order).toEqual(['lifecycle:hidden', 'mutation:dispose']);
  });

  it('retries local disposal after SDK-owned mutation invalidation fails', async () => {
    const order: string[] = [];
    const slot = createSlot(order, 'mutation-retry');
    const disposeFailure = new Error('mutation dispose failed');
    vi.mocked(slot.dispose)
      .mockRejectedValueOnce(disposeFailure)
      .mockResolvedValueOnce(undefined);
    const coordinator = createPluginSurfacePlacementCoordinator(
      createClient(async () => createHost('surface_mutation_retry', order)),
    );

    await coordinator.open(slot, request);
    await expect(coordinator.invalidatePlugin(request.plugin_instance_id)).rejects.toBe(disposeFailure);
    await expect(coordinator.release(slot)).resolves.toBeUndefined();

    expect(slot.close).not.toHaveBeenCalled();
    expect(slot.dispose).toHaveBeenCalledTimes(2);
  });
});

describe('createAuthenticatedReDevPluginFetch', () => {
  it('admits only the canonical same-origin API and attaches the CSRF proof', async () => {
    writePluginSessionCredential('generation-secret');
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
    expect(headers.get('X-Redeven-Plugin-Session')).toBe('generation-secret');
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

describe('createRedevenPluginPlatform', () => {
  it('allows authoritative session teardown to retry after a confirmed not-committed failure', async () => {
    const failure = new PluginPlatformRequestError(
      'PLUGIN_INVALID_REQUEST',
      'session teardown was not committed',
      {},
      'not_committed',
    );
    const revoke = vi.spyOn(PluginPlatformClient.prototype, 'revokeSessionScope')
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({} as PluginSessionScopeRevokeResult);
    const platform = createRedevenPluginPlatform();

    await expect(platform.close()).rejects.toBe(failure);
    await expect(platform.close()).resolves.toBeUndefined();
    await expect(platform.close()).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
