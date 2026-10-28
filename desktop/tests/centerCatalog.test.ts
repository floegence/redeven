import { expect, it, vi } from 'vitest';
import { createCatalogLoader } from '../../internal/envcenter_web/src/catalogLoader';

it('loads sixteen sources within the request budget while a slow source remains pending', async () => {
  let live = 0; let peak = 0; let release!: () => void;
  const accepted: string[] = [];
  const loader = createCatalogLoader(async (id) => {
    peak = Math.max(peak, ++live);
    if (id === '0') await new Promise<void>(resolve => { release = resolve; });
    else await Promise.resolve();
    live--; return id;
  }, id => accepted.push(id), error => { throw error; });
  const loading = loader.load(Array.from({ length: 16 }, (_, i) => String(i)));
  await vi.waitFor(() => expect(accepted).toHaveLength(15));
  expect(peak).toBeLessThanOrEqual(4);
  release(); await loading;
  expect(new Set(accepted).size).toBe(16);
});

it('cancels obsolete refreshes and logout without publishing late results or queued work', async () => {
  const pending: { id: string; signal: AbortSignal; resolve: (value: string) => void }[] = [];
  const accepted = vi.fn(); const rejected = vi.fn();
  const loader = createCatalogLoader((id, signal) => new Promise<string>(resolve => { pending.push({ id, signal, resolve }); }), accepted, rejected);
  const first = loader.load(['a', 'b', 'c', 'd', 'queued']);
  const second = loader.load(['fresh']);
  expect(pending.slice(0, 4).every(item => item.signal.aborted)).toBe(true);
  pending.slice(0, 4).forEach(item => item.resolve(item.id));
  await first; expect(accepted).not.toHaveBeenCalled();
  loader.cancel(); pending[4].resolve('fresh'); await second;
  expect(accepted).not.toHaveBeenCalled(); expect(rejected).not.toHaveBeenCalled();
  expect(pending.map(item => item.id)).not.toContain('queued');
});
