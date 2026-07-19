import {
  PluginPlatformClient,
  PluginSurfaceSlot,
  createPluginSurfaceScope,
  createReDevPluginSurfaceTransport,
  type FetchLike,
  type PluginOpenSurfaceInSlotOptions,
  type PluginOpenSurfaceRequest,
  type PluginSurfaceHost,
} from '@floegence/redevplugin-ui';

import { prepareLocalApiRequestInit } from '../services/localApi';

export const redevPluginCSRFHeader = 'X-ReDevPlugin-CSRF';
export const redevPluginCSRFProof = 'redeven-env-v1';
export const redevPluginAPIPath = '/_redevplugin/api/plugins';

export type RedevenPluginPlatform = Readonly<{
  client: PluginPlatformClient;
  close: () => Promise<void>;
}>;

export function createRedevenPluginPlatform(options: Readonly<{
  onMutationOutcomeUnknown?: (pluginInstanceID?: string) => void;
}> = {}): RedevenPluginPlatform {
  const fetch = createAuthenticatedReDevPluginFetch();
  const surfaceScope = createPluginSurfaceScope();
  const surfaceTransport = createReDevPluginSurfaceTransport({ fetch });
  const client = new PluginPlatformClient({
    fetch,
    surfaceScope,
    surfaceTransport,
    onMutationOutcomeUnknown: options.onMutationOutcomeUnknown,
  });
  let closePromise: Promise<void> | undefined;
  return {
    client,
    close() {
      closePromise ??= client.revokeSurfaceScope().then(() => undefined);
      return closePromise;
    },
  };
}

export type PluginSurfacePlacementCoordinator = Readonly<{
  open: (
    slot: PluginSurfaceSlot,
    request: PluginOpenSurfaceRequest,
    options?: Omit<PluginOpenSurfaceInSlotOptions, 'signal'>,
  ) => Promise<PluginSurfaceHost>;
  setVisible: (slot: PluginSurfaceSlot, visible: boolean) => void;
  fail: (slot: PluginSurfaceSlot, error: Error) => Promise<void>;
  release: (slot: PluginSurfaceSlot) => Promise<void>;
  closeActive: () => Promise<void>;
  disposeActive: () => Promise<void>;
  dispose: () => Promise<void>;
}>;

type ActivePluginSurfaceSlot = {
  slot: PluginSurfaceSlot;
  opening: AbortController;
  host?: PluginSurfaceHost;
  publishedVisible?: boolean;
  status: 'opening' | 'ready' | 'failed' | 'retiring';
  failure?: Error;
};

export function createPluginSurfacePlacementCoordinator(
  client: PluginPlatformClient,
): PluginSurfacePlacementCoordinator {
  let active: ActivePluginSurfaceSlot | undefined;
  let tail = Promise.resolve();
  let disposed = false;
  const cancelledSlots = new WeakSet<PluginSurfaceSlot>();
  const retirementBySlot = new WeakMap<PluginSurfaceSlot, Promise<void>>();
  const requestedVisibility = new WeakMap<PluginSurfaceSlot, boolean>();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  const publishVisibility = (entry: ActivePluginSurfaceSlot, visible: boolean) => {
    requestedVisibility.set(entry.slot, visible);
    if (entry.status !== 'ready' || !entry.host || entry.publishedVisible === visible) return;
    entry.host.sendLifecycle({ type: visible ? 'visible' : 'hidden' });
    entry.publishedVisible = visible;
  };

  const retire = (entry: ActivePluginSurfaceSlot): Promise<void> => {
    const existing = retirementBySlot.get(entry.slot);
    if (existing) return existing;
    const retirement = (async () => {
      const failures: unknown[] = [];
      if (entry.status === 'ready') {
        try {
          publishVisibility(entry, false);
        } catch (error) {
          failures.push(error);
        }
      }
      entry.status = 'retiring';
      entry.opening.abort('plugin surface slot retired');
      try {
        await entry.slot.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await entry.slot.dispose();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Plugin surface slot retirement failed');
      }
    })();
    retirementBySlot.set(entry.slot, retirement);
    return retirement;
  };

  const disposeInactiveSlot = (slot: PluginSurfaceSlot): Promise<void> => {
    const existing = retirementBySlot.get(slot);
    if (existing) return existing;
    const retirement = Promise.resolve().then(() => slot.dispose());
    retirementBySlot.set(slot, retirement);
    return retirement;
  };

  const closeActive = (): Promise<void> => {
    active?.opening.abort('plugin surface placement closed');
    return enqueue(async () => {
      const current = active;
      active = undefined;
      if (current) await retire(current);
    });
  };

  const disposeActive = (): Promise<void> => {
    active?.opening.abort('plugin surface invalidated by platform mutation');
    return enqueue(async () => {
      const current = active;
      active = undefined;
      if (current) await disposeInactiveSlot(current.slot);
    });
  };

  return Object.freeze({
    open(slot, request, options = {}) {
      return enqueue(async () => {
        if (disposed) {
          await disposeInactiveSlot(slot);
          throw new Error('Plugin surface placement coordinator is disposed');
        }
        if (cancelledSlots.has(slot)) {
          await disposeInactiveSlot(slot);
          throw new Error('Plugin surface slot was released before opening');
        }
        const previous = active;
        active = undefined;
        if (previous) await retire(previous);

        const entry: ActivePluginSurfaceSlot = {
          slot,
          opening: new AbortController(),
          status: 'opening',
        };
        active = entry;
        try {
          const host = await client.openSurfaceInSlot(slot, request, {
            ...options,
            signal: entry.opening.signal,
          });
          entry.host = host;
          if (entry.status === 'failed') {
            throw entry.failure ?? new Error('Plugin surface terminated while opening');
          }
          entry.status = 'ready';
          publishVisibility(entry, requestedVisibility.get(slot) ?? false);
          return host;
        } catch (error) {
          if (active === entry) active = undefined;
          await disposeInactiveSlot(slot);
          throw error;
        }
      });
    },
    setVisible(slot, visible) {
      requestedVisibility.set(slot, visible);
      if (active?.slot === slot) publishVisibility(active, visible);
    },
    fail(slot, error) {
      const current = active?.slot === slot ? active : undefined;
      if (current && current.status !== 'retiring') {
        current.status = 'failed';
        current.failure = error;
        current.opening.abort('plugin surface terminated');
      }
      return enqueue(async () => {
        if (active === current) active = undefined;
        if (current) {
          await retire(current);
          return;
        }
        await disposeInactiveSlot(slot);
      });
    },
    release(slot) {
      cancelledSlots.add(slot);
      if (active?.slot === slot) {
        active.opening.abort('plugin surface owner released');
      }
      return enqueue(async () => {
        if (active?.slot === slot) {
          const current = active;
          active = undefined;
          await retire(current);
          return;
        }
        await disposeInactiveSlot(slot);
      });
    },
    closeActive,
    disposeActive,
    dispose() {
      disposed = true;
      return closeActive();
    },
  });
}

export function createAuthenticatedReDevPluginFetch(): FetchLike {
  return async (input, init) => {
    const url = new URL(input, window.location.origin);
    if (url.origin !== window.location.origin || (
      url.pathname !== redevPluginAPIPath && !url.pathname.startsWith(`${redevPluginAPIPath}/`)
    )) {
      throw new TypeError('ReDevPlugin requests must use the canonical same-origin platform API');
    }
    const headers = new Headers(init.headers);
    headers.set(redevPluginCSRFHeader, redevPluginCSRFProof);
    return fetch(input, await prepareLocalApiRequestInit({
      method: init.method,
      headers,
      body: init.body,
      credentials: init.credentials,
      signal: init.signal,
      keepalive: init.keepalive,
    }));
  };
}
