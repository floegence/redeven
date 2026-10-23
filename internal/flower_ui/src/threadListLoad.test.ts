import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFlowerThreadList } from './threadListLoad';
import type { FlowerSurfaceAdapter } from './contracts/flowerSurfaceContracts';

describe('progressive thread list deadline', () => {
  afterEach(() => vi.useRealTimers());
  it('keeps delivered pages usable and gives each progressing page its own deadline', async () => {
    vi.useFakeTimers();
    let page!: NonNullable<Parameters<FlowerSurfaceAdapter['listThreads']>[0]>;
    let finish!: (threads: []) => void;
    const onPage = vi.fn();
    const request = loadFlowerThreadList({ listThreads: options => {
      page = options!;
      return new Promise(resolve => { finish = resolve; });
    } }, onPage);
    await vi.advanceTimersByTimeAsync(9000);
    page.onPage?.([]);
    await vi.advanceTimersByTimeAsync(9000);
    expect(page.signal?.aborted).toBe(false);
    expect(onPage).toHaveBeenCalledOnce();
    finish([]);
    await expect(request).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts a stalled transport and ignores late pages', async () => {
    vi.useFakeTimers();
    let page!: NonNullable<Parameters<FlowerSurfaceAdapter['listThreads']>[0]>;
    const onPage = vi.fn();
    const request = loadFlowerThreadList({ listThreads: options => { page = options!; return new Promise(() => {}); } }, onPage);
    const result = expect(request).rejects.toMatchObject({ code: 'flower_thread_list_timeout' });
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(page.signal?.aborted).toBe(true);
    expect(() => page.onPage?.([])).toThrow();
    expect(onPage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels even when the transport ignores the caller signal', async () => {
    const controller = new AbortController();
    let transportSignal: AbortSignal | undefined;
    const request = loadFlowerThreadList({ listThreads: options => { transportSignal = options?.signal; return new Promise(() => {}); } }, undefined, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(transportSignal?.aborted).toBe(true);
  });
});
