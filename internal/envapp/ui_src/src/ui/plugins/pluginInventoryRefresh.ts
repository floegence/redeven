import type { PluginInventoryProjection } from './pluginTypes';

/** Batch same-turn reads, but queue fresh reads behind any already started read. */
export function createPluginInventoryRefresh(options: {
  owner: () => object | false;
  refresh: () => Promise<PluginInventoryProjection | undefined>;
}): () => Promise<PluginInventoryProjection | undefined> {
  type Result = PluginInventoryProjection | undefined;
  type Lane = { owner: object; tail: Promise<Result>; queued?: Promise<Result> };
  let lane: Lane | undefined;
  return () => {
    const owner = options.owner();
    if (!owner) return Promise.resolve(undefined);
    if (lane?.owner !== owner) lane = { owner, tail: Promise.resolve(undefined) };
    const current = lane;
    if (current.queued) return current.queued;
    const run = async () => {
      current.queued = undefined;
      if (options.owner() !== owner) return undefined;
      const projection = await options.refresh();
      return options.owner() === owner ? projection : undefined;
    };
    // Reads requested after a mutation cannot reuse a pre-mutation snapshot.
    // Only callers waiting for the next read share its result.
    current.queued = current.tail.then(run, run);
    current.tail = current.queued;
    return current.queued;
  };
}
