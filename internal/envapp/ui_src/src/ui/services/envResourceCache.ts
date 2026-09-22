import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';
import { createIndexedDBResourceCacheStorage, createResourceCache, type CachedResource, type ResourceCache, type ResourceCacheStorage, type ResourceSnapshot } from '@floegence/floe-webapp-core/resource-cache';
import type { EnvContextValue } from '../pages/EnvContext';
import { readDesktopHostBridge } from './desktopHostWindow';
import { fetchLocalApiJSON, LocalApiError } from './localApi';

const volatileStorage: ResourceCacheStorage = { get: async () => null, set: async () => {}, remove: async () => {}, list: async () => [] };
let shared: ResourceCache | undefined;

export function envResourceCache(): ResourceCache {
  if (!shared) {
    const desktop = readDesktopHostBridge('redevenDesktopResourceCache', (value): value is ResourceCacheStorage => {
      const candidate = value as Partial<ResourceCacheStorage> | null;
      return !!candidate && ['get', 'set', 'remove', 'list'].every(key => typeof candidate[key as keyof ResourceCacheStorage] === 'function');
    });
    shared = createResourceCache({ storage: desktop ?? createIndexedDBResourceCacheStorage('redeven-resource-cache'), maxBytes: 32 * 1024 * 1024 });
  }
  return shared;
}

export function isResourceAuthorizationError(error: unknown): boolean {
  return error instanceof LocalApiError && [401, 403, 423].includes(error.status);
}

/** The Shell confirms identity once; transient disconnects retain the confirmed scope. */
export function createEnvResourceCacheScope(options: {
  environment: Accessor<string>;
  readable: Accessor<boolean>;
  locked: Accessor<boolean>;
  connection: Accessor<unknown>;
}): Accessor<string | undefined> {
  const [scope, setScope] = createSignal<string>();
  let environment = '';
  let confirmedScope: string | undefined;
  let connectionIdentity: unknown;
  const revoke = () => {
    const previous = confirmedScope;
    confirmedScope = undefined;
    setScope(undefined);
    if (previous) void envResourceCache().clearScope(previous);
  };
  createEffect(() => {
    const nextEnvironment = options.environment();
    const readable = options.readable();
    const locked = options.locked();
    const connection = options.connection();
    if (nextEnvironment !== environment || !readable || locked) revoke();
    environment = nextEnvironment;
    if (!nextEnvironment || !readable || locked || !connection) return;
    // A new authenticated session may belong to another user on the same host.
    if (connection !== connectionIdentity) setScope(undefined);
    connectionIdentity = connection;
    const controller = new AbortController();
    void fetchLocalApiJSON<{ scope_id: string }>('/_redeven_proxy/api/ui-cache-scope', { method: 'GET', signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        if (!/^[a-f0-9]{64}$/u.test(result.scope_id)) throw new Error('Invalid resource cache scope');
        const previous = confirmedScope;
        if (previous && previous !== result.scope_id) void envResourceCache().clearScope(previous);
        confirmedScope = result.scope_id;
        setScope(result.scope_id);
      }).catch(error => {
        if (controller.signal.aborted) return;
        if (isResourceAuthorizationError(error)) revoke();
        else console.warn('Resource snapshot scope could not be confirmed', error);
      });
    onCleanup(() => controller.abort());
  });
  const flush = () => { void shared?.flush(); };
  window.addEventListener('pagehide', flush);
  onCleanup(() => { window.removeEventListener('pagehide', flush); flush(); });
  return scope;
}

/** Thin product binding. Unconfirmed identities can fetch live data but cannot read disk. */
export function createEnvResourceCollection(ctx: Pick<EnvContextValue, 'resourceCacheScope'>) {
  const transient = createResourceCache({ storage: volatileStorage });
  createEffect(() => {
    if (ctx.resourceCacheScope?.()) void transient.clearScope('unconfirmed');
  });
  onCleanup(() => { transient.dispose(); void shared?.flush(); });
  return {
    scope: () => ctx.resourceCacheScope?.(),
    resource<T>(key: string, decode: (value: unknown) => T, persist: (value: T) => unknown = decode): CachedResource<T> {
      const scope = ctx.resourceCacheScope?.();
      return (scope ? envResourceCache() : transient).resource({ scope: scope || 'unconfirmed', key, version: 1, decode, persist });
    },
    revoke(scope = ctx.resourceCacheScope?.()) {
      if (scope) void envResourceCache().clearScope(scope);
    },
  };
}

export function createEnvCachedResource<T>(ctx: Pick<EnvContextValue, 'resourceCacheScope'>, key: Accessor<string>, decode: (value: unknown) => T) {
  const collection = createEnvResourceCollection(ctx);
  const resource = createMemo(() => collection.resource(key(), decode));
  const [snapshot, setSnapshot] = createSignal<ResourceSnapshot<T>>(resource().snapshot());
  createEffect(() => {
    const current = resource();
    setSnapshot(current.snapshot());
    const unsubscribe = current.subscribe(() => setSnapshot(current.snapshot()));
    onCleanup(unsubscribe);
  });
  return {
    snapshot,
    data: () => snapshot().data,
    identity: resource,
    hydrate: () => untrack(resource).hydrate(),
    refresh: async (fetcher: (signal: AbortSignal) => Promise<T>) => {
      const current = untrack(resource);
      const scope = untrack(collection.scope);
      try { return await current.refresh(fetcher); }
      catch (error) {
        if (isResourceAuthorizationError(error)) {
          current.invalidate(true);
          if (scope) collection.revoke(scope);
        }
        throw error;
      }
    },
    set: (value: T) => untrack(resource).set(value),
    invalidate: (clear = false) => untrack(resource).invalidate(clear),
  };
}
