import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import type { EnvContextValue } from '../pages/EnvContext';
import type { ManagedInstallSubmission, ManagedService, PortForward } from '../pages/EnvPortForwardsPage';
import { createManagedServiceOperationController, type ManagedOperation } from '../pages/managedServiceOperationController';
import { createEnvCachedResource } from './envResourceCache';
import { forwardSnapshot, managedServiceSnapshot } from './envResourceSnapshots';
import { fetchLocalApiJSON, LocalApiError } from './localApi';

/** One environment session owns accepted work; views own only their presentation. */
export function createManagedServiceSession(context: Pick<EnvContextValue, 'env_id' | 'resourceCacheAccess'>, messages: { streamFailedMessage: () => string }) {
  const managedResource = createEnvCachedResource(context, () => 'managed-web-services', managedServiceSnapshot);
  const forwardResource = createEnvCachedResource(context, () => 'web-service-forwards', forwardSnapshot);
  const [installSubmissions, setInstallSubmissions] = createSignal<readonly ManagedInstallSubmission[]>([]);
  const [operationReleases, setOperationReleases] = createSignal<Record<string, { current?: string; target: string }>>({});
  const controller = createManagedServiceOperationController({ ...messages, canObserve: managedResource.ready });
  const admissions = new Set<AbortController>();
  let epoch = 0;
  let disposed = false;
  const captureAuthority = () => {
    const current = epoch;
    const environment = context.env_id();
    const owner = context.resourceCacheAccess?.().owner;
    return () => !disposed && current === epoch && context.env_id() === environment && context.resourceCacheAccess?.().owner === owner;
  };
  const refresh = async () => {
    managedResource.invalidate();
    forwardResource.invalidate();
    if (!managedResource.ready()) return;
    await Promise.all([
      managedResource.refresh(async signal => (await fetchLocalApiJSON<{ services: ManagedService[] }>('/_redeven_proxy/api/managed-web-services', {method: 'GET', signal})).services),
      forwardResource.refresh(async signal => (await fetchLocalApiJSON<{ forwards: PortForward[] }>('/_redeven_proxy/api/forwards', {method: 'GET', signal})).forwards),
    ]);
  };
  const settlements = new Map<string, Promise<ManagedOperation>>();
  const track = (operation: ManagedOperation) => {
    const existing = settlements.get(operation.operation_id);
    if (existing) return existing;
    const current = captureAuthority();
    const promise = controller.track(operation).then(async terminal => {
      if (current()) {
        try { await refresh(); } catch { /* Cached resources retain the refresh error for their views. */ }
        if (current()) controller.clear(terminal.operation_id);
      }
      return terminal;
    }).finally(() => { if (settlements.get(operation.operation_id) === promise) settlements.delete(operation.operation_id); });
    settlements.set(operation.operation_id, promise);
    return promise;
  };
  const admit = async (submission: ManagedOperation, request: Record<string, unknown> & {request_id: string}): Promise<ManagedOperation> => {
    const current = captureAuthority();
    const accept = (operation: ManagedOperation) => {
      if (!current()) throw new DOMException('Environment retired', 'AbortError');
      if (operation.service_id !== submission.service_id || operation.action !== submission.action || !operation.operation_id || (operation.request_id && operation.request_id !== request.request_id)) throw new Error('Invalid service operation receipt');
      return operation;
    };
    try {
      return accept(await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(submission.service_id)}/operations`, {method: 'POST', body: JSON.stringify(request)}));
    } catch (error) {
      if (!current()) throw error;
      if (error instanceof LocalApiError && error.code !== 'HTTP_ERROR' && error.status >= 400 && error.status < 500 && error.status !== 408) throw error;
    }
    // No receipt is not a rejection. Keep the original submission busy while
    // reconciling its exact request ID; never submit the mutation again.
    const observer = new AbortController(); admissions.add(observer);
    try {
      let delay = 1000;
      while (current() && !observer.signal.aborted) {
        controller.update({...submission, observation_error: messages.streamFailedMessage()});
        if (managedResource.ready()) {
          try { return accept(await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-service-operations/by-request/${encodeURIComponent(request.request_id)}`, {method: 'GET', signal: observer.signal})); }
          catch (error) {
            if (!current()) throw error;
            if (error instanceof LocalApiError && [401, 403, 423].includes(error.status)) {
              // Lost observation authority is not proof that execution failed.
              context.resourceCacheAccess?.().revoke?.();
              throw new DOMException('Observation authority revoked', 'AbortError');
            }
          }
        }
        await new Promise<void>((resolve, reject) => {
          const abort = () => {window.clearTimeout(timer); reject(new DOMException('Environment retired', 'AbortError'));};
          const timer = window.setTimeout(() => {observer.signal.removeEventListener('abort', abort); resolve();}, delay);
          observer.signal.addEventListener('abort', abort, {once:true});
          if (observer.signal.aborted) abort();
        });
        delay = Math.min(delay * 2, 15000);
      }
      throw new DOMException('Environment retired', 'AbortError');
    } finally { admissions.delete(observer); }
  };
  createEffect(() => {
    const pending = installSubmissions().filter(item => item.phase === 'unknown');
    if (!managedResource.ready() || !pending.length) return;
    const current = captureAuthority(); let checking = false, stopped = false;
    const timer = window.setInterval(() => {
      if (checking || stopped || !current()) return;
      checking = true;
      void Promise.all(pending.map(async submission => {
        try {
          const result = await fetchLocalApiJSON<{receipt: {service: ManagedService; operation: ManagedOperation} | null}>(`/_redeven_proxy/api/managed-web-services/install-requests/${encodeURIComponent(submission.requestID)}`, {method: 'GET'});
          if (stopped || !current() || !result.receipt) return;
          const {service, operation} = result.receipt;
          if (service.service_id !== submission.serviceID || operation.service_id !== submission.serviceID || operation.action !== 'install' || (operation.request_id && operation.request_id !== submission.requestID)) return;
          setInstallSubmissions(items => items.map(item => item.requestID === submission.requestID ? {...item, phase: 'accepted', message: undefined} : item));
          void track(operation).catch(() => undefined);
          await refresh();
        } catch { /* Absence or transport failure never authorizes another install. */ }
      })).finally(() => {checking = false;});
    }, 2000);
    onCleanup(() => {stopped = true; window.clearInterval(timer);});
  });
  const sessionOwner = createMemo(() => context.resourceCacheAccess?.().owner);
  createEffect(on(() => [context.env_id(), sessionOwner()], () => {
    untrack(() => {
      // A transport reconnect retains its owner; authentication/environment changes retire it.
      ++epoch;
      for (const admission of admissions) admission.abort();
      admissions.clear();
      controller.dispose();
      settlements.clear();
      setInstallSubmissions([]);
      setOperationReleases({});
    });
  }));
  createEffect(() => {
    if (!managedResource.ready()) return;
    const services = managedResource.data();
    untrack(() => {
      if (!services) return;
      const ids = new Set(services.map(service => service.service_id));
      setInstallSubmissions(current => current.filter(item => !ids.has(item.serviceID)));
      for (const service of services) {
        if (!service.active_operation || controller.knows(service.active_operation.operation_id)) continue;
        void track(service.active_operation).catch(() => undefined);
      }
    });
  });
  onCleanup(() => { disposed = true; ++epoch; for (const admission of admissions) admission.abort(); admissions.clear(); controller.dispose(); settlements.clear(); });
  return { admit, operations: { ...controller, track }, managedResource, forwardResource, installSubmissions, setInstallSubmissions, operationReleases, setOperationReleases, captureAuthority, refresh };
}

export type ManagedServiceSession = ReturnType<typeof createManagedServiceSession>;
