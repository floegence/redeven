import type { FlowerHistoryPage, FlowerHistoryPageRequest, FlowerRuntimeCurrentItem } from './contracts/flowerSurfaceContracts';

export type SequenceHistoryDemand = Readonly<{ key: string; first: string; last: string; before: boolean; after: boolean }>;
// One physical request per document, including transports that ignore abort.
// Reactive group replacement is coalesced before deciding whether to cancel.
export function createHistorySequenceCompletion(options: {
  scope(): string;
  leaf(): string | undefined;
  document?(): object | undefined;
  item(id: string): FlowerRuntimeCurrentItem | undefined;
  read(input: FlowerHistoryPageRequest, signal: AbortSignal): Promise<FlowerHistoryPage>;
  accept(page: FlowerHistoryPage, anchor: FlowerRuntimeCurrentItem, signal: AbortSignal): boolean | Promise<boolean>;
  state(loading: boolean, failed: boolean): void;
  yield(): Promise<void>;
}) {
  const demands = new Map<string, SequenceHistoryDemand>();
  const horizons = new Map<string, number>();
  let scope = '', scheduled = false, running = false, disposed = false, failed = false;
  let pending: { key: string; controller: AbortController } | undefined;
  const read = async (input: FlowerHistoryPageRequest, controller: AbortController) => {
    const timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      failed = true; options.state(false, true);
      controller.abort(new Error('History page read timed out.'));
    }, 15_000);
    try { return await options.read(input, controller.signal); }
    finally { clearTimeout(timer); }
  };
  let generation = 0, demandRevision = 0;
  const reset = () => {
    generation++; demands.clear(); horizons.clear(); pending?.controller.abort(); failed = false;
    options.state(false, false);
  };
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      for (const key of horizons.keys()) if (!demands.has(key)) horizons.delete(key);
      if (pending && !demands.has(pending.key)) { pending.controller.abort(); failed = false; options.state(false, false); }
      if (!demands.size) { failed = false; options.state(false, false); }
      if (!running && !failed) void run();
    });
  };
  const run = async () => {
    running = true;
    const epoch = generation, revision = demandRevision;
    try {
      while (!disposed && epoch === generation && demands.size) {
        const demand = [...demands.values()].find(value => value.before || value.after);
        if (!demand) break;
        const document = options.document?.();
        const direction = demand.before ? 'before' : 'after';
        const anchor = options.item(direction === 'before' ? demand.first : demand.last);
        if (!anchor || anchor.live) break;
        const controller = new AbortController();
        pending = { key: demand.key, controller };
        options.state(true, false);
        // Freeze the terminal item once. Continued streaming never extends the
        // finite expansion demand, and no cursor or lifecycle is persisted.
        if (direction === 'after' && !horizons.has(demand.key)) {
          const tail = await read({ anchor_id: '', direction: 'before', limit: 1, ancestor_leaf_id: options.leaf() }, controller);
          controller.signal.throwIfAborted();
          if (epoch !== generation || scope !== options.scope()) break;
          if (document !== options.document?.()) { await options.yield(); continue; }
          horizons.set(demand.key, tail.items.at(-1)?.ordinal ?? anchor.ordinal);
        }
        if (direction === 'after' && anchor.ordinal >= horizons.get(demand.key)!) {
          demands.set(demand.key, { ...demand, after: false });
          continue;
        }
        const limit = direction === 'after' ? Math.min(40, horizons.get(demand.key)! - anchor.ordinal) : 40;
        const page = await read({ anchor_id: anchor.id, direction, limit, ancestor_leaf_id: options.leaf() }, controller);
        controller.signal.throwIfAborted();
        if (epoch !== generation || scope !== options.scope() || !demands.has(demand.key)) break;
        if (document !== options.document?.()) { await options.yield(); continue; }
        const end = direction === 'before' ? page.items[0] : page.items.at(-1);
        if (!end && !(direction === 'before' ? page.has_before : page.has_after)) {
          demands.set(demand.key, { ...demand, [direction]: false });
          continue;
        }
        if (!end || (direction === 'before' ? end.ordinal >= anchor.ordinal : end.ordinal <= anchor.ordinal)) {
          throw new Error('History page did not advance.');
        }
        if (!await options.accept(page, anchor, controller.signal)) {
          if (options.item(anchor.id) !== anchor) { await options.yield(); continue; }
          break;
        }
        // Give grouping, placement and paint a turn before another page. They
        // supply the next exact demand; never recursively walk a stale range.
        await options.yield();
        const next = demands.get(demand.key);
        if (next && (direction === 'before' ? next.first === anchor.id : next.last === anchor.id)) {
          demands.set(demand.key, { ...next, [direction]: false });
        }
      }
    } catch (error) {
      if (epoch === generation && !pending?.controller.signal.aborted && (error as { name?: string })?.name !== 'AbortError') { failed = true; options.state(false, true); }
    } finally {
      const cancelled = pending?.controller.signal.aborted;
      pending = undefined; running = false;
      if (!failed) options.state(false, false);
      if (epoch !== generation || (cancelled || revision !== demandRevision) && demands.size && !failed) schedule();
    }
  };
  return {
    demand(value: SequenceHistoryDemand, expanded: boolean) {
      const nextScope = options.scope();
      if (scope !== nextScope) { reset(); scope = nextScope; }
      if (expanded) {
        const prior = demands.get(value.key);
        if (!prior || prior.first !== value.first || prior.last !== value.last || prior.before !== value.before || prior.after !== value.after) demandRevision++;
        demands.set(value.key, value);
      }
      else demands.delete(value.key);
      schedule();
    },
    reset,
    retry() { failed = false; options.state(false, false); schedule(); },
    dispose() { disposed = true; reset(); },
  };
}
