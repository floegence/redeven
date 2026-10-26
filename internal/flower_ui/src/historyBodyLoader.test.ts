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
  it('admits a visible live body ahead of queued history without increasing concurrency', async () => {
    const loader = createHistoryBodyLoader(() => 'timeout');
    const controller = new AbortController();
    const finish: (() => void)[] = [];
    const order: string[] = [];
    const read = (id: string) => async () => {
      order.push(id);
      return new Promise<void>(resolve => finish.push(resolve));
    };
    loader.request('one', 'one', controller.signal, read('one'));
    loader.request('two', 'two', controller.signal, read('two'));
    loader.request('history', 'history', controller.signal, read('history'));
    loader.request('live', 'live', controller.signal, read('live'), 'interactive');
    await settle();
    expect(order).toEqual(['one', 'two']);
    finish.shift()!(); await settle();
    expect(order).toEqual(['one', 'two', 'live']);
    finish.shift()!(); await settle();
    expect(order).toEqual(['one', 'two', 'live', 'history']);
    controller.abort(); finish.splice(0).forEach(resolve => resolve()); await settle();
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
  it('automatically recovers transient failures and bounds retry exhaustion', async () => {
    vi.useFakeTimers();
    const loader = createHistoryBodyLoader(() => 'timeout');
    const controller = new AbortController();
    const read = vi.fn().mockRejectedValue(Object.assign(new Error('network unavailable'), { code: 'transport' }));
    loader.request('item', 'source', controller.signal, read);
    await settle(); expect(loader.state('item')).toBe('loading');
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(4);
    expect(loader.state('item')).toBe('failed');
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).toHaveBeenCalledTimes(4);
    read.mockResolvedValue(undefined);
    loader.resume(); await settle();
    expect(read).toHaveBeenCalledTimes(5);
    expect(loader.state('item')).toBeUndefined();
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not retry authorization or protocol failures after reconnect', async () => {
    vi.useFakeTimers();
    const loader = createHistoryBodyLoader(() => 'timeout');
    const controller = new AbortController();
    const denied = vi.fn().mockRejectedValue({ status: 403 });
    const malformed = vi.fn().mockRejectedValue(new TypeError('invalid decoder state'));
    loader.request('denied', 'source', controller.signal, denied);
    loader.request('malformed', 'source', controller.signal, malformed);
    await settle(); loader.resume();
    await vi.advanceTimersByTimeAsync(60000);
    expect(denied).toHaveBeenCalledOnce(); expect(malformed).toHaveBeenCalledOnce();
    controller.abort();
  });
  it('retries only an explicitly selected failed read without reviving canceled owners', async () => {
    const loader = createHistoryBodyLoader(() => 'timeout');
    const controller = new AbortController();
    const read = vi.fn().mockRejectedValue({ status: 400 });
    loader.request('a', 'source', controller.signal, read);
    loader.request('b', 'source', controller.signal, read);
    await settle();
    read.mockResolvedValue(undefined);
    loader.retry('a'); loader.retry('a'); await settle();
    expect(read).toHaveBeenCalledTimes(3);
    expect(loader.state('a')).toBeUndefined();
    expect(loader.state('b')).toBe('failed');
    controller.abort(); loader.retry('b'); await settle();
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('cancels pending retries without reviving a replacement disclosure', async () => {
    vi.useFakeTimers();
    const loader = createHistoryBodyLoader(() => 'timeout');
    const first = new AbortController(); const second = new AbortController();
    const oldRead = vi.fn().mockRejectedValue(Object.assign(new Error('network unavailable'), { code: 'transport' }));
    const newRead = vi.fn().mockResolvedValue(undefined);
    loader.request('item', 'old', first.signal, oldRead); await settle();
    first.abort(); loader.request('item', 'new', second.signal, newRead);
    await vi.advanceTimersByTimeAsync(10000);
    expect(oldRead).toHaveBeenCalledOnce(); expect(newRead).toHaveBeenCalledOnce();
    expect(loader.state('item')).toBeUndefined();
    second.abort(); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds stalled physical transports after the read deadline and releases UI ownership', async () => {
    vi.useFakeTimers();
    const loader = createHistoryBodyLoader(() => 'timeout');
    const controller = new AbortController();
    const completions: Array<() => void> = [];
    const read = vi.fn((_signal: AbortSignal) => new Promise<void>(resolve => completions.push(resolve)));
    loader.request('a', {}, controller.signal, read);
    loader.request('b', {}, controller.signal, read);
    loader.request('c', {}, controller.signal, read);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[0][0].aborted).toBe(true);
    expect(loader.state('a')).toBe('loading');
    completions.shift()!(); await settle();
    expect(read).toHaveBeenCalledTimes(3);
    controller.abort(); await settle();
    expect(loader.state('c')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    completions.splice(0).forEach(finish => finish()); await settle();
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
