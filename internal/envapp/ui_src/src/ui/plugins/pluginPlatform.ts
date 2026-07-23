import {
  PluginPlatformClient,
  PluginSurfaceSlot,
  createPluginSurfaceScope,
  createReDevPluginSurfaceTransport,
  pluginMutationOutcome,
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
  let closed = false;
  return {
    client,
    close() {
      if (closed) return Promise.resolve();
      closePromise ??= client.revokeSessionScope().then(() => {
        closed = true;
      }).catch((error: unknown) => {
        if (pluginMutationOutcome(error) === 'not_committed') closePromise = undefined;
        throw error;
      });
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
  invalidatePlugin: (pluginInstanceID: string) => Promise<void>;
  closeAll: () => Promise<void>;
  dispose: () => Promise<void>;
}>;

type RegisteredPluginSurfaceSlot = {
  slot: PluginSurfaceSlot;
  pluginInstanceID: string;
  opening: AbortController;
  host?: PluginSurfaceHost;
  publishedVisible?: boolean;
  status: 'opening' | 'ready' | 'failed' | 'retiring';
  failure?: Error;
};

export function createPluginSurfacePlacementCoordinator(
  client: PluginPlatformClient,
): PluginSurfacePlacementCoordinator {
  const entries = new Map<PluginSurfaceSlot, RegisteredPluginSurfaceSlot>();
  let disposed = false;
  const cancelledSlots = new WeakSet<PluginSurfaceSlot>();
  const retirementBySlot = new WeakMap<PluginSurfaceSlot, Promise<void>>();
  const requestedVisibility = new WeakMap<PluginSurfaceSlot, boolean>();

  const awaitAll = async (operations: readonly Promise<void>[], failureMessage: string): Promise<void> => {
    const outcomes = await Promise.allSettled(operations);
    const failures = outcomes.flatMap((outcome) => outcome.status === 'rejected' ? [outcome.reason] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, failureMessage);
  };

  const publishVisibility = (entry: RegisteredPluginSurfaceSlot, visible: boolean) => {
    requestedVisibility.set(entry.slot, visible);
    if (entry.status !== 'ready' || !entry.host || entry.publishedVisible === visible) return;
    entry.host.sendLifecycle({ type: visible ? 'visible' : 'hidden' });
    entry.publishedVisible = visible;
  };

  const retire = (entry: RegisteredPluginSurfaceSlot): Promise<void> => {
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
    })().finally(() => {
      if (entries.get(entry.slot) === entry) entries.delete(entry.slot);
    });
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

  const invalidateEntries = async (matching: readonly RegisteredPluginSurfaceSlot[]): Promise<void> => {
    const retirements = matching.map(async (entry) => {
      entry.opening.abort('plugin surface invalidated by platform mutation');
      if (entries.get(entry.slot) === entry) entries.delete(entry.slot);
      await disposeInactiveSlot(entry.slot);
    });
    await awaitAll(retirements, 'Plugin surface invalidation failed');
  };

  return Object.freeze({
    async open(slot, request, options = {}) {
      if (disposed) {
        await disposeInactiveSlot(slot);
        throw new Error('Plugin surface placement coordinator is disposed');
      }
      if (cancelledSlots.has(slot)) {
        await disposeInactiveSlot(slot);
        throw new Error('Plugin surface slot was released before opening');
      }
      if (entries.has(slot)) throw new Error('Plugin surface slot is already registered');

      const entry: RegisteredPluginSurfaceSlot = {
        slot,
        pluginInstanceID: request.plugin_instance_id,
        opening: new AbortController(),
        status: 'opening',
      };
      entries.set(slot, entry);
      try {
        const host = await client.openSurfaceInSlot(slot, request, {
          ...options,
          signal: entry.opening.signal,
        });
        entry.host = host;
        if (entry.status === 'failed') {
          throw entry.failure ?? new Error('Plugin surface terminated while opening');
        }
        if (entry.status === 'retiring' || entries.get(slot) !== entry) {
          throw new Error('Plugin surface slot was released while opening');
        }
        entry.status = 'ready';
        publishVisibility(entry, requestedVisibility.get(slot) ?? false);
        return host;
      } catch (error) {
        if (entries.get(slot) === entry) entries.delete(slot);
        await disposeInactiveSlot(slot);
        throw error;
      }
    },
    setVisible(slot, visible) {
      requestedVisibility.set(slot, visible);
      const entry = entries.get(slot);
      if (entry) publishVisibility(entry, visible);
    },
    fail(slot, error) {
      const current = entries.get(slot);
      if (current && current.status !== 'retiring') {
        current.status = 'failed';
        current.failure = error;
        current.opening.abort('plugin surface terminated');
      }
      if (current) return retire(current);
      return disposeInactiveSlot(slot);
    },
    release(slot) {
      cancelledSlots.add(slot);
      const current = entries.get(slot);
      current?.opening.abort('plugin surface owner released');
      if (current) return retire(current);
      return disposeInactiveSlot(slot);
    },
    invalidatePlugin(pluginInstanceID) {
      return invalidateEntries([...entries.values()].filter((entry) => entry.pluginInstanceID === pluginInstanceID));
    },
    closeAll() {
      return awaitAll(
        [...entries.values()].map((entry) => retire(entry)),
        'Plugin surface closure failed',
      );
    },
    dispose() {
      disposed = true;
      return awaitAll(
        [...entries.values()].map((entry) => retire(entry)),
        'Plugin surface disposal failed',
      );
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
