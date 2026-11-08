import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { MarketTemplate } from '@floegence/redeven-service-templates';
import { fetchLocalApiJSON } from '../services/localApi';

export type MarketItem = MarketTemplate & {
  classification: 'official' | 'community';
  status: 'available' | 'unavailable';
};
type Catalog = { items: MarketItem[]; stale: boolean; generation: number; checked_at: number };

// Catalog refresh only replaces passive evidence. Selection and reviewed source
// candidates belong to the caller and cannot be changed by a network response.
export function createServiceTemplateMarket(
  active: Accessor<boolean>,
  identity: Accessor<unknown>,
  canRefresh: Accessor<boolean>,
) {
  const [items, setItems] = createSignal<MarketItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [stale, setStale] = createSignal(false);
  const [error, setError] = createSignal(false);
  let owner: unknown;
  let initialized = false;
  let controller: AbortController | undefined;
  let generation = 0;
  const load = async (refresh: boolean) => {
    controller?.abort();
    const request = ++generation;
    const abort = new AbortController();
    controller = abort;
    setLoading(true);
    setError(false);
    try {
      const result = await fetchLocalApiJSON<Catalog>(
        '/_redeven_proxy/api/managed-web-service-templates/market-catalog',
        { method: refresh ? 'POST' : 'GET', signal: abort.signal },
      );
      if (request !== generation || abort.signal.aborted) return;
      if (!Array.isArray(result.items)) throw new Error('Invalid template catalog');
      setItems(result.items);
      setStale(result.stale);
    } catch {
      if (request === generation && !abort.signal.aborted) {
        setError(true);
        setStale(true);
      }
    } finally {
      if (request === generation) {
        setLoading(false);
        controller = undefined;
      }
    }
  };
  createEffect(() => {
    const current = identity();
    if (current !== owner) {
      owner = current;
      initialized = false;
      generation++;
      controller?.abort();
      setItems([]);
      setLoading(false);
      setError(false);
      setStale(false);
    }
    if (active() && !initialized) {
      initialized = true;
      const currentGeneration = generation;
      void load(false).then(() => {
        if (current === owner && currentGeneration + 1 === generation && canRefresh()) void load(true);
      });
    }
  });
  onCleanup(() => {
    generation++;
    controller?.abort();
  });
  return { items, loading, stale, error, refresh: () => canRefresh() ? load(true) : Promise.resolve() };
}
