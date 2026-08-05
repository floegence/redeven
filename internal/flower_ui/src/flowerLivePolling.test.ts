import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFlowerLivePollLoop, FLOWER_LIVE_EMPTY_POLL_DELAYS_MS } from './flowerLivePolling';

afterEach(() => {
  vi.useRealTimers();
});

describe('createFlowerLivePollLoop', () => {
  it('backs off empty sequential polls instead of using a fixed high-frequency interval', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => ({ hadEvents: false, hasMore: false }));
    const loop = createFlowerLivePollLoop({ poll });

    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FLOWER_LIVE_EMPTY_POLL_DELAYS_MS[0] - 1);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(FLOWER_LIVE_EMPTY_POLL_DELAYS_MS[1]);
    expect(poll).toHaveBeenCalledTimes(3);
    loop.dispose();
  });

  it('immediately catches up after events and never overlaps requests', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (result: { hadEvents: boolean; hasMore: boolean }) => void;
    const first = new Promise<{ hadEvents: boolean; hasMore: boolean }>((resolve) => {
      resolveFirst = resolve;
    });
    const poll = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ hadEvents: false, hasMore: false });
    const loop = createFlowerLivePollLoop({ poll });

    await vi.advanceTimersByTimeAsync(5000);
    expect(poll).toHaveBeenCalledTimes(1);
    resolveFirst({ hadEvents: true, hasMore: true });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);
    loop.dispose();
  });

  it('stops scheduling after disposal', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => ({ hadEvents: false, hasMore: false }));
    const loop = createFlowerLivePollLoop({ poll });
    await vi.advanceTimersByTimeAsync(0);
    loop.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });
});
