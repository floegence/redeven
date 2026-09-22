import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';
import { createIndexedDBResourceCacheStorage, createResourceCache, type CachedResource, type ResourceCache, type ResourceCacheStorage, type ResourceSnapshot } from '@floegence/floe-webapp-core/resource-cache';
import type { EnvContextValue } from '../pages/EnvContext';
import { readDesktopHostBridge } from './desktopHostWindow';
import { fetchLocalApiJSON } from './localApi';
import { isSessionEventAuthorizationError } from './sessionHTTP';

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

export const isResourceAuthorizationError = isSessionEventAuthorizationError;

export type EnvResourceCacheAccess = Readonly<{
  phase: 'pending' | 'ready' | 'denied';
  generation: number;
  scope?: string;
}>;

/** Confirm identity and permissions independently, then expose one authenticated cache owner. */
export function createEnvResourceCacheAccess(options: {
  environment: Accessor<string>;
  readable: Accessor<boolean | undefined>;
  locked: Accessor<boolean>;
  connection: Accessor<unknown>;
}): Accessor<EnvResourceCacheAccess> {
  const [state, setState] = createSignal<EnvResourceCacheAccess>({ phase: 'pending', generation: 0 });
  let environment = '';
  let connectionIdentity: unknown;
  let controller: AbortController | undefined;
  let confirmedScope: string | undefined;
  let generation = 0;
  let blocked = false;
  const revoke = () => {
    controller?.abort();
    controller = undefined;
    connectionIdentity = undefined;
    if (confirmedScope) void shared?.clearScope(confirmedScope);
    confirmedScope = undefined;
  };
  createEffect(() => {
    const nextEnvironment = options.environment();
    const readable = options.readable();
    const locked = options.locked();
    const connection = options.connection();
    const denied = readable === false || locked;
    if (nextEnvironment !== environment || denied !== blocked) {
      revoke();
      environment = nextEnvironment;
      blocked = denied;
      setState({ phase: readable === false || locked ? 'denied' : 'pending', generation: ++generation });
    }
    if (!nextEnvironment || readable === false || locked || !connection || connection === connectionIdentity) return;
    controller?.abort();
    // Retire requests and in-memory results from the previous authenticated session.
    shared?.dispose();
    shared = undefined;
    connectionIdentity = connection;
    const request = new AbortController();
    controller = request;
    const owner = ++generation;
    setState({ phase: 'pending', generation: owner });
    void fetchLocalApiJSON<{ scope_id: string }>('/_redeven_proxy/api/ui-cache-scope', { method: 'GET', signal: request.signal })
      .then(result => {
        if (request.signal.aborted) return;
        if (!/^[a-f0-9]{64}$/u.test(result.scope_id)) throw new Error('Invalid resource cache scope');
        const previous = confirmedScope;
        if (previous && previous !== result.scope_id) void envResourceCache().clearScope(previous);
        confirmedScope = result.scope_id;
        setState({ phase: 'ready', generation: owner, scope: result.scope_id });
      }).catch(error => {
        if (request.signal.aborted) return;
        if (isResourceAuthorizationError(error)) {
          revoke();
          setState({ phase: 'denied', generation: owner });
        } else {
          console.warn('Resource snapshot scope could not be confirmed', error);
          setState({ phase: 'ready', generation: owner });
        }
      });
  });
  const flush = () => { void shared?.flush(); };
  window.addEventListener('pagehide', flush);
  onCleanup(() => { controller?.abort(); window.removeEventListener('pagehide', flush); flush(); });
  return createMemo<EnvResourceCacheAccess>(() => {
    const current = state();
    if (options.locked() || options.readable() === false) return { phase: 'denied', generation: current.generation };
    if (options.readable() === undefined) return { phase: 'pending', generation: current.generation };
    return current;
  });
}

/** Unavailable identity may use live data only after the scope request has settled. */
export function createEnvResourceCollection(ctx: Pick<EnvContextValue, 'resourceCacheAccess'>) {
  const access = (): EnvResourceCacheAccess => ctx.resourceCacheAccess?.() ?? { phase: 'ready' as const, generation: 0 };
  const transient = createMemo(() => {
    void access().generation;
    const cache = createResourceCache({ storage: volatileStorage });
    onCleanup(() => cache.dispose());
    return cache;
  });
  onCleanup(() => { void shared?.flush(); });
  return {
    access,
    ready: () => access().phase === 'ready',
    scope: () => access().scope,
    resource<T>(key: string, decode: (value: unknown) => T, persist: (value: T) => unknown = decode): CachedResource<T> {
      const current = access();
      const scope = current.phase === 'ready' ? current.scope : undefined;
      return (scope ? envResourceCache() : transient()).resource({ scope: scope || current.phase, key, version: 1, decode, persist });
    },
    revoke(scope = access().scope) {
      if (scope) void envResourceCache().clearScope(scope);
    },
  };
}

export function createEnvCachedResource<T>(ctx: Pick<EnvContextValue, 'resourceCacheAccess'>, key: Accessor<string>, decode: (value: unknown) => T) {
  const collection = createEnvResourceCollection(ctx);
  const resource = createMemo(() => collection.resource(key(), decode));
  const [revision, setRevision] = createSignal(0);
  createEffect(() => {
    const current = resource();
    const unsubscribe = current.subscribe(() => setRevision(value => value + 1));
    onCleanup(unsubscribe);
  });
  const snapshot = (): ResourceSnapshot<T> => { revision(); return resource().snapshot(); };
  return {
    snapshot,
    ready: collection.ready,
    restoring: () => collection.access().phase === 'pending' || (collection.ready() && snapshot().restoring),
    data: () => collection.ready() ? snapshot().data : undefined,
    identity: resource,
    hydrate: () => untrack(resource).hydrate(),
    refresh: async (fetcher: (signal: AbortSignal) => Promise<T>) => {
      if (!untrack(collection.ready)) throw new DOMException('Resource identity is pending', 'AbortError');
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
    set: (value: T) => { if (untrack(collection.ready)) untrack(resource).set(value); },
    invalidate: (clear = false) => untrack(resource).invalidate(clear),
  };
}
