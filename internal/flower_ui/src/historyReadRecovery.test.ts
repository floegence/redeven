import { afterEach, describe, expect, it, vi } from 'vitest';
import { recoverHistoryRead } from './historyReadRecovery';
import { FlowerReadDeadlineError, withFlowerReadDeadline } from './requestDeadline';

afterEach(() => vi.useRealTimers());

describe('history read recovery', () => {
  it('adds no retry timer or repeated request to a successful read', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue('page');
    expect(await recoverHistoryRead(read, new AbortController().signal)).toBe('page');
    expect(read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares a single deadline across attempts and aborts the pending transport', async () => {
    vi.useFakeTimers();
    let pendingSignal: AbortSignal | undefined;
    const read = vi.fn(async (signal: AbortSignal) => {
      pendingSignal = signal;
      if (read.mock.calls.length === 1) {
        await new Promise(resolve => setTimeout(resolve, 14000));
        throw { code: 'history_source_changed' };
      }
      return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const result = withFlowerReadDeadline(signal => recoverHistoryRead(() => read(signal), signal), 'Read timed out').catch(error => error);
    await vi.advanceTimersByTimeAsync(14999);
    expect(read).toHaveBeenCalledTimes(2);
    expect(pendingSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeInstanceOf(FlowerReadDeadlineError);
    expect(pendingSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
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
