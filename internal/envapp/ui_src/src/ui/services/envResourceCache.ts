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

type ResourceOwner = Readonly<{ cache: ResourceCache; scope: string; persistent: boolean }>;
export type EnvResourceCacheAccess = Readonly<{
  phase: 'pending' | 'ready' | 'revalidating' | 'denied';
  /** Fences requests; it is not the identity of the visible data. */
  generation: number;
  scope?: string;
  owner?: ResourceOwner;
  error?: unknown;
  retry?: () => void;
  revoke?: () => void;
}>;

/** The Shell owns confirmation; transport replacement never retires a confirmed presentation. */
export function createEnvResourceCacheAccess(options: {
  environment: Accessor<string>;
  readable: Accessor<boolean | undefined>;
  locked: Accessor<boolean>;
  connection: Accessor<unknown>;
  authentication?: Accessor<unknown>;
  retryPermissions?: () => void;
  permissionError?: Accessor<unknown>;
}): Accessor<EnvResourceCacheAccess> {
  const [state, setState] = createSignal<EnvResourceCacheAccess>({ phase: 'pending', generation: 0 });
  const [retryRevision, setRetryRevision] = createSignal(0);
  let environment = '';
  let authentication: unknown;
  let connectionIdentity: unknown;
  let controller: AbortController | undefined;
  let owner: ResourceOwner | undefined;
  let confirmedScope: string | undefined;
  let generation = 0;
  let blocked = false;
  let attemptedRetry = 0;
  let lookup: { phase: 'pending' | 'ready' | 'failed' | 'denied'; scope?: string; error?: unknown } = { phase: 'pending' };
  const cancel = () => {
    controller?.abort();
    controller = undefined;
    owner?.cache.cancelRefreshes(owner.scope);
  };
  const clearOwner = () => {
    if (owner) {
      owner.cache.cancelRefreshes(owner.scope);
      void owner.cache.clearScope(owner.scope);
    }
    owner = undefined;
    confirmedScope = undefined;
  };
  const retry = () => { options.retryPermissions?.(); setRetryRevision(value => value + 1); };
  const publish = (phase: EnvResourceCacheAccess['phase'], error?: unknown) => {
    const previous = untrack(state);
    if (previous.phase === phase && previous.generation === generation && previous.owner === owner && previous.error === error) return;
    if (phase === 'revalidating' && previous.phase === 'ready') {
      if (previous.generation === generation) ++generation;
      owner?.cache.cancelRefreshes(owner.scope);
    }
    setState({ phase, generation, owner, scope: owner?.persistent ? owner.scope : undefined, error, retry, revoke });
  };
  const revoke = () => {
    ++generation;
    cancel();
    clearOwner();
    lookup = { phase: 'denied' };
    publish('denied');
  };
  const commit = () => {
    if (lookup.phase === 'denied') { publish('denied'); return; }
    if (!connectionIdentity || options.readable() !== true || lookup.phase === 'pending') {
      publish(owner ? 'revalidating' : 'pending', options.permissionError?.());
      return;
    }
    if (lookup.phase === 'failed') {
      if (owner?.persistent) { publish('revalidating', lookup.error); return; }
      owner ??= { cache: createResourceCache({ storage: volatileStorage }), scope: 'live', persistent: false };
    } else {
      if (confirmedScope && confirmedScope !== lookup.scope) clearOwner();
      confirmedScope = lookup.scope;
      owner ??= { cache: envResourceCache(), scope: confirmedScope!, persistent: true };
    }
    publish('ready');
  };
  createEffect(() => {
    const nextEnvironment = options.environment();
    const nextAuthentication = options.authentication?.();
    const denied = options.readable() === false || options.locked();
    const connection = options.connection();
    const retryAttempt = retryRevision();
    options.permissionError?.();
    untrack(() => {
      if (nextEnvironment !== environment || nextAuthentication !== authentication || denied !== blocked) {
        cancel();
        clearOwner();
        environment = nextEnvironment;
        authentication = nextAuthentication;
        blocked = denied;
        connectionIdentity = undefined;
        lookup = { phase: denied ? 'denied' : 'pending' };
        ++generation;
      }
      if (denied || !nextEnvironment) { publish(denied ? 'denied' : 'pending'); return; }
      if (connection !== connectionIdentity || retryAttempt !== attemptedRetry) {
        cancel();
        connectionIdentity = connection;
        attemptedRetry = retryAttempt;
        lookup = { phase: 'pending' };
        const requestGeneration = ++generation;
        if (connection) {
          const request = new AbortController();
          controller = request;
          void fetchLocalApiJSON<{ scope_id: string }>('/_redeven_proxy/api/ui-cache-scope', { method: 'GET', signal: request.signal })
            .then(result => {
              if (request.signal.aborted || generation !== requestGeneration) return;
              if (!/^[a-f0-9]{64}$/u.test(result.scope_id)) throw new Error('Invalid resource cache scope');
              if (confirmedScope && confirmedScope !== result.scope_id) clearOwner();
              lookup = { phase: 'ready', scope: result.scope_id };
              commit();
            }).catch(error => {
              if (request.signal.aborted || generation !== requestGeneration) return;
              if (isResourceAuthorizationError(error)) { revoke(); return; }
              console.warn('Resource snapshot scope could not be confirmed', error);
              lookup = { phase: 'failed', error };
              commit();
            });
        }
      }
      commit();
    });
  });
  const flush = () => { void owner?.cache.flush(); };
  window.addEventListener('pagehide', flush);
  onCleanup(() => { cancel(); window.removeEventListener('pagehide', flush); flush(); });
  return state;
}

/** Standalone views use an isolated live-only owner; Shell views share its confirmed owner. */
export function createEnvResourceCollection(ctx: Pick<EnvContextValue, 'resourceCacheAccess'>) {
  const access = (): EnvResourceCacheAccess => ctx.resourceCacheAccess?.() ?? { phase: 'ready' as const, generation: 0 };
  const transient = createResourceCache({ storage: volatileStorage });
  onCleanup(() => { transient.dispose(); void shared?.flush(); });
  const visible = () => access().phase === 'ready' || access().phase === 'revalidating';
  return {
    access,
    visible,
    ready: () => access().phase === 'ready',
    retry: () => access().retry?.(),
    resource<T>(key: string, decode: (value: unknown) => T, persist: (value: T) => unknown = decode): CachedResource<T> {
      const current = access();
      const owner = visible() ? current.owner : undefined;
      const scope = visible() ? current.scope : undefined;
      return (owner?.cache ?? (scope ? envResourceCache() : transient)).resource({ scope: owner?.scope ?? (scope || `unconfirmed:${current.generation}`), key, version: 1, decode, persist });
    },
    revoke(scope = access().scope) {
      const current = access();
      if (current.revoke && scope === current.scope) current.revoke();
      else if (scope) { envResourceCache().cancelRefreshes(scope); void envResourceCache().clearScope(scope); }
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
  const snapshot = (): ResourceSnapshot<T> => {
    revision();
    const value = resource().snapshot();
    return collection.access().error ? { ...value, error: collection.access().error } : value;
  };
  const captureAuthority = () => {
    const current = untrack(resource);
    const generation = untrack(collection.access).generation;
    return () => collection.ready() && collection.access().generation === generation && resource() === current;
  };
  return {
    captureAuthority,
    snapshot,
    ready: collection.ready,
    retry: collection.retry,
    restoring: () => collection.access().phase === 'pending' || (collection.visible() && snapshot().restoring),
    data: () => collection.visible() ? snapshot().data : undefined,
    identity: resource,
    hydrate: () => untrack(resource).hydrate(),
    refresh: async (fetcher: (signal: AbortSignal) => Promise<T>) => {
      if (!untrack(collection.ready)) throw new DOMException('Resource identity is pending', 'AbortError');
      const current = untrack(resource);
      const access = untrack(collection.access);
      const isCurrent = captureAuthority();
      try {
        const value = await current.refresh(fetcher);
        if (!isCurrent()) throw new DOMException('Resource request was superseded', 'AbortError');
        return value;
      } catch (error) {
        if (isCurrent() && isResourceAuthorizationError(error)) { current.invalidate(true); collection.revoke(access.scope); }
        throw error;
      }
    },
    set: (value: T) => { if (untrack(collection.ready)) untrack(resource).set(value); },
    invalidate: (clear = false) => untrack(resource).invalidate(clear),
  };
}
