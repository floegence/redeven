import { describe, expect, it, vi } from 'vitest';
import { createPluginInventoryRefresh } from './pluginInventoryRefresh';
import type { PluginInventoryProjection } from './pluginTypes';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const inventory: PluginInventoryProjection = { items: [] };

describe('authoritative plugin inventory refresh', () => {
  it('shares the result of same-turn requests instead of returning an absent resource refetch', async () => {
    const owner = {};
    const read = vi.fn(async () => inventory);
    const refresh = createPluginInventoryRefresh({ owner: () => owner, refresh: read });
    const results = await Promise.all([refresh(), refresh(), refresh(), refresh()]);
    expect(results).toEqual([inventory, inventory, inventory, inventory]);
    expect(read).toHaveBeenCalledOnce();
  });

  it('queues a fresh read after an in-flight read without canceling either caller', async () => {
    const owner = {};
    const beforeMutation = deferred<PluginInventoryProjection>();
    const afterMutation: PluginInventoryProjection = { items: [], marketUnavailable: true };
    const read = vi.fn().mockReturnValueOnce(beforeMutation.promise).mockResolvedValue(afterMutation);
    const refresh = createPluginInventoryRefresh({ owner: () => owner, refresh: read });
    const first = refresh();
    await Promise.resolve();
    const second = refresh();
    const third = refresh();
    expect(read).toHaveBeenCalledOnce();
    beforeMutation.resolve(inventory);
    expect(await first).toBe(inventory);
    expect(await second).toBe(afterMutation);
    expect(await third).toBe(afterMutation);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not block a replacement owner on the previous owner or publish its response', async () => {
    let owner: object | false = {};
    const old = deferred<PluginInventoryProjection>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(inventory);
    const refresh = createPluginInventoryRefresh({ owner: () => owner, refresh: read });
    const stale = refresh();
    await Promise.resolve();
    const queued = refresh();
    owner = {};
    expect(await refresh()).toBe(inventory);
    old.resolve(inventory);
    expect(await stale).toBeUndefined();
    expect(await queued).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(2);
    owner = false;
    expect(await refresh()).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('allows a fresh read after a rejected request', async () => {
    const owner = {};
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(inventory);
    const refresh = createPluginInventoryRefresh({ owner: () => owner, refresh: read });
    await expect(refresh()).rejects.toThrow('offline');
    expect(await refresh()).toBe(inventory);
  });
});
