// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistoryBodyLoader } from './historyBodyLoader';

afterEach(() => vi.useRealTimers());
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

describe('history body request ownership', () => {
  it('coalesces growth during slow reads and yields chunks to other visible items', async () => {
    const loader = createHistoryBodyLoader(() => 'timeout');
    const controller = new AbortController();
    let finish!: (more: boolean) => void;
    const order: string[] = [];
    let count = 0;
    const read = vi.fn(async () => {
      order.push('growing');
      if (++count === 1) return new Promise<boolean>(resolve => { finish = resolve; });
      return false;
    });
    loader.request('growing', 'source', controller.signal, read);
    loader.request('second', 'other', controller.signal, () => new Promise<void>(() => undefined));
    loader.request('third', 'third', controller.signal, async () => { order.push('third'); });
    for (let i = 0; i < 2000; i++) loader.request('growing', 'source', controller.signal, read);
    await settle();
    expect(read).toHaveBeenCalledOnce();
    finish(true); await settle(); await settle(); await settle();
    expect(order).toEqual(['growing', 'third', 'growing']);
    expect(loader.state('growing')).toBeUndefined();
    await settle(); expect(read).toHaveBeenCalledTimes(2);
    controller.abort();
  });
  it('limits concurrent body reads, deduplicates identities and drops queued invisible work', async () => {
    const loader = createHistoryBodyLoader(() => 'timeout');
    const controllers = Array.from({ length: 20 }, () => new AbortController());
    const identities = controllers.map(() => ({}));
    const finish: (() => void)[] = [];
    const read = vi.fn(() => new Promise<void>(resolve => finish.push(resolve)));
    controllers.forEach((controller, index) => loader.request(String(index), identities[index], controller.signal, read));
    loader.request('0', identities[0], controllers[0].signal, read);
    await settle(); expect(read).toHaveBeenCalledTimes(2);
    for (const controller of controllers.slice(2)) controller.abort();
    finish.forEach(resolve => resolve()); await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(loader.state('0')).toBeUndefined();
  });
  it('keeps failures local and retries only when explicitly requested', async () => {
    const loader = createHistoryBodyLoader(() => 'timeout');
    const controller = new AbortController(); const identity = {};
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    loader.request('item', identity, controller.signal, read);
    await settle(); expect(loader.state('item')).toBe('failed');
    loader.request('item', identity, controller.signal, read);
    await settle(); expect(read).toHaveBeenCalledOnce();
    loader.request('item', identity, controller.signal, read, true);
    await settle(); expect(read).toHaveBeenCalledTimes(2);
    expect(loader.state('item')).toBeUndefined();
    controller.abort();
  });
  it('releases stalled transports at the read deadline and rejects superseded ownership', async () => {
    vi.useFakeTimers();
    const loader = createHistoryBodyLoader(() => 'timeout');
    const controller = new AbortController();
    const read = vi.fn((_signal: AbortSignal) => new Promise<void>(() => undefined));
    loader.request('a', {}, controller.signal, read);
    loader.request('b', {}, controller.signal, read);
    loader.request('c', {}, controller.signal, read);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls[0][0].aborted).toBe(true);
    expect(loader.state('a')).toBe('failed');
    controller.abort(); await settle();
    expect(loader.state('c')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never clears replacement state when an obsolete transport finishes late', async () => {
    const loader = createHistoryBodyLoader(() => 'timeout');
    const first = new AbortController(); const second = new AbortController();
    let complete!: () => void;
    loader.request('same', {}, first.signal, () => new Promise<void>(resolve => { complete = resolve; }));
    await settle(); first.abort();
    loader.request('same', {}, second.signal, async () => { throw new Error('new failure'); });
    await settle(); complete(); await settle();
    expect(loader.state('same')).toBe('failed');
    second.abort();
  });
});
