import { secureRandomUUID } from '@floegence/floe-webapp-core';
import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import type { EnvContextValue } from '../pages/EnvContext';
import { createEnvCachedResource, createEnvResourceCollection, isResourceAuthorizationError } from './envResourceCache';
import { containerInventorySnapshot, containerRuntimeSnapshot, containerServiceSnapshot } from './envResourceSnapshots';
import { ContainerOperationRejectedError, createContainerOperation, getContainerOperation, getContainerOperationByRequestID, listContainerOperations, subscribeContainerOperation, type ContainerOperation, type ContainerPreflight, type ContainerResourceView } from './containerResourcesApi';

type Admission = { requestID: string; preflight: ContainerPreflight; state: 'submitting' | 'uncertain' };

const terminal = (operation: ContainerOperation) => ['succeeded', 'failed', 'canceled', 'interrupted'].includes(operation.state);

/** Execution history and observation survive every container/settings view. */
export function createContainerOperationSession(context: Pick<EnvContextValue, 'env_id' | 'resourceCacheAccess'>) {
  const [operations, setOperations] = createSignal<ContainerOperation[]>([]);
  const [admissions, setAdmissions] = createSignal<Admission[]>([]);
  const [revision, setRevision] = createSignal(0);
  const resources = createEnvResourceCollection(context);
  const runtimes = createEnvCachedResource(context, () => 'container-runtimes', containerRuntimeSnapshot);
  const services = createEnvCachedResource(context, () => 'container-services', containerServiceSnapshot);
  const streams = new Map<string, { controller: AbortController; promise: Promise<ContainerOperation> }>();
  const listeners = new Set<(operation: ContainerOperation) => void>();
  let epoch = 0;
  let disposed = false;
  const captureAuthority = () => {
    const current = epoch, environment = context.env_id(), owner = context.resourceCacheAccess?.().owner;
    return () => !disposed && epoch === current && context.env_id() === environment && context.resourceCacheAccess?.().owner === owner;
  };
  const acceptAdmission = (requestID: string, operation: ContainerOperation) => {
    if (operation.request_id !== requestID || !operation.operation_id) throw new Error('Invalid container admission receipt');
    setAdmissions(items => items.filter(item => item.requestID !== requestID));
    void track(operation).catch(() => undefined);
    return operation;
  };
  const update = (operation: ContainerOperation, announce = true) => {
    const previous = operations().find(item => item.operation_id === operation.operation_id);
    if (previous && previous.updated_at_unix_ms > operation.updated_at_unix_ms) return previous;
    if (previous && terminal(previous) && !terminal(operation)) return previous;
    setOperations(items => {
      const next = [operation, ...items.filter(item => item.operation_id !== operation.operation_id)];
      let completed = 0;
      return next.filter(item => !terminal(item) || ++completed <= 100);
    });
    if (announce && terminal(operation) && (!previous || !terminal(previous))) {
      for (const runtime of runtimes.data() ?? []) {
        if (runtime.state !== 'ready') continue;
        for (const view of ['containers', 'images', 'volumes', 'compose-projects', 'pods'] as ContainerResourceView[]) {
          resources.resource(`container-inventory:${runtime.engine}\u0000${runtime.endpoint_id}\u0000${view}`, value => containerInventorySnapshot(view, value)).invalidate();
        }
      }
      runtimes.invalidate(); services.invalidate(); setRevision(value => value + 1);
    }
    if (announce && (!previous || !terminal(previous))) for (const listener of listeners) listener(operation);
    return operation;
  };
  const track = (operation: ContainerOperation): Promise<ContainerOperation> => {
    const existing = streams.get(operation.operation_id);
    if (existing) return existing.promise;
    const initial = update(operation);
    if (terminal(initial)) return Promise.resolve(initial);
    const current = captureAuthority();
    const controller = new AbortController();
    const observe = (next: ContainerOperation) => {
      if (!current() || controller.signal.aborted) throw new DOMException('Environment retired', 'AbortError');
      if (next.operation_id !== operation.operation_id || next.request_id !== operation.request_id) throw new Error('Invalid container operation snapshot');
      return update(next);
    };
    const promise = (async () => {
      let delay = 1000;
      while (current() && !controller.signal.aborted) {
        if (resources.ready()) {
          try {
            await subscribeContainerOperation(operation.operation_id, observe, controller.signal);
            const last = operations().find(item => item.operation_id === operation.operation_id)!;
            if (terminal(last)) return last;
          } catch (error) { if (!current() || isResourceAuthorizationError(error)) throw error; }
          try {
            if (!current()) throw new DOMException('Environment retired', 'AbortError');
            const next = observe(await getContainerOperation(operation.operation_id));
            if (terminal(next)) return next;
          } catch (error) { if (!current() || isResourceAuthorizationError(error) || (error instanceof Object && 'status' in error && error.status === 404)) throw error; }
        }
        await new Promise<void>((resolve, reject) => {
          const abort = () => { window.clearTimeout(timer); reject(new DOMException('Environment retired', 'AbortError')); };
          const timer = window.setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, delay);
          controller.signal.addEventListener('abort', abort, {once: true});
          if (controller.signal.aborted) abort();
        });
        delay = Math.min(delay * 2, 15000);
      }
      throw new DOMException('Environment retired', 'AbortError');
    })().finally(() => { if (streams.get(operation.operation_id)?.controller === controller) streams.delete(operation.operation_id); });
    streams.set(operation.operation_id, {controller, promise});
    return promise;
  };
  const refresh = async () => {
    if (!resources.ready()) return;
    const current = captureAuthority(); const next = await listContainerOperations();
    if (!current()) return;
    for (const operation of [...next].reverse()) {
      const previous = operations().find(item => item.operation_id === operation.operation_id);
      if (terminal(operation) && (!previous || terminal(previous))) update(operation, false);
      else { update(operation); void track(operation).catch(() => undefined); }
    }
  };
  const submit = async (preflight: ContainerPreflight, request: unknown, requestID = `envapp-${secureRandomUUID()}`) => {
    const sameTarget = (item: ContainerPreflight | ContainerOperation) => item.engine === preflight.engine && item.endpoint_id === preflight.endpoint_id && item.resource_kind === preflight.resource_kind && item.resource_identity === preflight.resource_identity;
    if (admissions().some(item => sameTarget(item.preflight)) || operations().some(item => !terminal(item) && sameTarget(item))) throw new Error('A container operation is already active');
    const current = captureAuthority();
    setAdmissions(items => [...items, {requestID, preflight, state: 'submitting'}]);
    try {
      const operation = await createContainerOperation(preflight, request, requestID);
      if (!current()) throw new DOMException('Environment retired', 'AbortError');
      return acceptAdmission(requestID, operation);
    } catch (error) {
      if (current()) setAdmissions(items => error instanceof ContainerOperationRejectedError
        ? items.filter(item => item.requestID !== requestID)
        : items.map(item => item.requestID === requestID ? {...item, state: 'uncertain'} : item));
      throw error;
    }
  };
  createEffect(() => {
    const pending = admissions().filter(item => item.state === 'uncertain');
    if (!resources.ready() || !pending.length) return;
    const current = captureAuthority(); let stopped = false, checking = false;
    const timer = window.setInterval(() => {
      if (checking || stopped || !current()) return;
      checking = true;
      void Promise.all(pending.map(async admission => {
        try {
          const operation = await getContainerOperationByRequestID(admission.requestID);
          if (!stopped && current() && operation) acceptAdmission(admission.requestID, operation);
        } catch (error) { if (current() && isResourceAuthorizationError(error)) context.resourceCacheAccess?.().revoke?.(); }
      })).finally(() => {checking = false;});
    }, 2000);
    onCleanup(() => {stopped = true; window.clearInterval(timer);});
  });
  const retire = () => { ++epoch; for (const stream of streams.values()) stream.controller.abort(); streams.clear(); setOperations([]); setAdmissions([]); };
  const owner = createMemo(() => context.resourceCacheAccess?.().owner);
  createEffect(on(() => [context.env_id(), owner()], () => untrack(retire)));
  onCleanup(() => { disposed = true; retire(); listeners.clear(); });
  return { operations, admissions, acceptAdmission, revision, refresh, submit, track, captureAuthority,
    subscribe: (listener: (operation: ContainerOperation) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
export type ContainerOperationSession = ReturnType<typeof createContainerOperationSession>;
