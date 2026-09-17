import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from 'solid-js';

import { fetchLocalApiJSON } from '../services/localApi';
import type { ManagedUpdatePlan } from './EnvPortForwardsPage';

type UpdateSelection = Readonly<{ serviceID: string; candidateID: string; identity: string }>;

// Preparation is read-only. It never submits an operation or owns operation progress.
export function createManagedServiceUpdatePreparation(selection: Accessor<UpdateSelection | null>) {
  const [plan, setPlan] = createSignal<ManagedUpdatePlan | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);
  const key = createMemo(() => JSON.stringify(selection()));
  let generation = 0;
  let controller: AbortController | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();

  const cancel = () => {
    generation += 1;
    controller?.abort();
    controller = undefined;
    clearTimeout(expiry);
  };
  const refresh = () => {
    cancel();
    const target = selection();
    const requestGeneration = generation;
    setPlan(null);
    setError(null);
    setLoading(Boolean(target));
    if (!target) return;
    // Coalesce rapid choices and serialize plan creation for a service session.
    queue = queue.then(async () => {
      if (requestGeneration !== generation) return;
      const request = new AbortController();
      controller = request;
      try {
        const result = await fetchLocalApiJSON<ManagedUpdatePlan>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(target.serviceID)}/update-plans`, {
          method: 'POST', signal: request.signal,
          body: JSON.stringify({ target_candidate_id: target.candidateID }),
        });
        if (requestGeneration !== generation || request.signal.aborted) return;
        if (result.schema_version !== 4 || result.expires_at_unix_ms <= Date.now()) throw new Error('Invalid update preparation');
        setPlan(result);
        expiry = setTimeout(refresh, result.expires_at_unix_ms - Date.now());
      } catch (failure) {
        if (requestGeneration === generation && !request.signal.aborted) setError(failure);
      } finally {
        if (requestGeneration === generation) { controller = undefined; setLoading(false); }
      }
    });
  };
  createEffect(on(key, refresh));
  onCleanup(cancel);
  return { plan, loading, error, refresh };
}
