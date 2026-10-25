import { afterEach, describe, expect, it, vi } from 'vitest';
import { recoverHistoryRead } from './historyReadRecovery';

afterEach(() => vi.useRealTimers());

describe('history read recovery', () => {
  it('recovers finite transient failures without a manual loading action', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValueOnce({ status: 503 }).mockRejectedValueOnce({ code: 'transport' }).mockResolvedValue('page');
    const result = recoverHistoryRead(read, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(800);
    expect(await result).toBe('page');
    expect(read).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds retries and preserves the final failure', async () => {
    vi.useFakeTimers();
    const error = { status: 429 };
    const read = vi.fn().mockRejectedValue(error);
    const result = recoverHistoryRead(read, new AbortController().signal).catch(value => value);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe(error);
    expect(read).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ status: 403 }, { status: 404 }, new TypeError('invalid source')])('does not retry authority or protocol errors', async error => {
    const read = vi.fn().mockRejectedValue(error);
    await expect(recoverHistoryRead(read, new AbortController().signal)).rejects.toBe(error);
    expect(read).toHaveBeenCalledOnce();
  });

  it('cancels retry ownership and rejects late successful responses', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const read = vi.fn().mockRejectedValue({ code: 'transport' });
    const result = recoverHistoryRead(read, controller.signal).catch(value => value);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toBe(controller.signal.reason);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const late = new AbortController();
    const value = recoverHistoryRead(async () => { late.abort(); return 'obsolete'; }, late.signal);
    await expect(value).rejects.toBe(late.signal.reason);
  });
});
