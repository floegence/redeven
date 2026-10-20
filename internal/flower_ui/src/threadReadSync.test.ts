import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThreadReadSync } from './threadReadSync';
import type { FlowerThreadReadStatus } from './contracts/flowerSurfaceContracts';

const status = (activity: number, seen: number): FlowerThreadReadStatus => ({
  is_unread: activity > seen, snapshot: { activity_revision: activity }, read_state: { last_seen_activity_revision: seen },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(send = vi.fn(async (_id: string, revision: number) => status(revision, revision))) {
  vi.useFakeTimers();
  const apply = vi.fn();
  const sync = createThreadReadSync({ send, apply, changed: vi.fn(), random: () => 0.5 });
  return { sync, send, apply };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('thread read synchronization', () => {
  it('retries in the background with bounded backoff and retains presented evidence', async () => {
    const send = vi.fn(async (_id: string, _revision: number): Promise<FlowerThreadReadStatus> => { throw new Error('offline transport'); });
    const { sync } = setup(send);
    sync.present('a', 7, 6);
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of [500, 1000, 2000, 5000, 10000, 30000, 30000]) {
      const count = send.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(send).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(count + 1);
      expect(sync.presentedRevision('a')).toBe(7);
    }
    send.mockImplementation(async (_id, revision) => status(revision, revision));
    await vi.advanceTimersByTimeAsync(30000);
    const count = send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(count);
    sync.dispose();
  });

  it('coalesces only presented revisions and accepts confirmation after switching away', async () => {
    const first = deferred<FlowerThreadReadStatus>();
    const send = vi.fn(async (_id: string, revision: number) => revision === 7 ? first.promise : status(revision, revision));
    const { sync, apply } = setup(send);
    sync.present('a', 7, 6);
    await vi.advanceTimersByTimeAsync(0);
    sync.present('a', 8, 6); sync.present('a', 9, 6);
    sync.present('b', 4, 4);
    first.resolve(status(12, 7));
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls).toEqual([['a', 7], ['a', 9]]);
    expect(apply).toHaveBeenCalledWith('a', status(12, 7));
    expect(sync.presentedRevision('a')).toBe(9);
    sync.dispose();
  });

  it('keeps backoff through unrelated successful detail reads and older acknowledgements', async () => {
    const send = vi.fn(async (_id: string, _revision: number) => status(12, 6));
    const { sync } = setup(send);
    sync.present('a', 7, 6);
    await vi.advanceTimersByTimeAsync(0);
    sync.setAvailable(true, true);
    await vi.advanceTimersByTimeAsync(499);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send.mock.calls).toHaveLength(2);
    expect(sync.presentedRevision('a')).toBe(7);
    sync.dispose();
  });

  it('coalesces presentation while applying confirmation through the cache callback', async () => {
    vi.useFakeTimers();
    const first = deferred<FlowerThreadReadStatus>();
    const send = vi.fn(async (_id: string, revision: number) => revision === 7 ? first.promise : status(12, revision));
    const sync = createThreadReadSync({ send, apply: (id, value) => sync.confirm(id, value), changed: vi.fn() });
    sync.present('a', 7, 0);
    await vi.advanceTimersByTimeAsync(0);
    sync.present('a', 9, 0);
    first.resolve(status(12, 7));
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls).toEqual([['a', 7], ['a', 9]]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(2);
    sync.dispose();
  });

  it.each([0, 1])('bounds jitter and the capped retry delay with random=%s', async random => {
    vi.useFakeTimers();
    const send = vi.fn(async () => { throw new Error('transient'); });
    const sync = createThreadReadSync({ send, apply: vi.fn(), changed: vi.fn(), random: () => random });
    sync.present('a', 7, 0);
    await vi.advanceTimersByTimeAsync(0);
    for (const base of [500, 1000, 2000, 5000, 10000, 30000, 30000]) {
      const delay = Math.min(30000, base * (0.8 + random * 0.4));
      const count = send.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(send).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(count + 1);
    }
    sync.dispose();
  });

  it('pauses before dispatch when the browser goes offline in the same task', async () => {
    const { sync, send } = setup();
    sync.present('a', 7, 0);
    sync.setAvailable(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).not.toHaveBeenCalled();
    sync.setAvailable(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledExactlyOnceWith('a', 7);
    sync.dispose();
  });

  it('retires work when the thread has been deleted remotely', async () => {
    const send = vi.fn(async () => { throw Object.assign(new Error('missing'), { status: 404 }); });
    const { sync } = setup(send);
    sync.present('a', 7, 0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sync.presentedRevision('a')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not dispatch queued work after immediate disposal', async () => {
    const { sync, send } = setup();
    sync.present('a', 7, 0);
    sync.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('times out hung requests after fifteen seconds and monotonically applies late success', async () => {
    const first = deferred<FlowerThreadReadStatus>();
    const second = deferred<FlowerThreadReadStatus>();
    const send = vi.fn<(id: string, revision: number) => Promise<FlowerThreadReadStatus>>()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { sync, apply } = setup(send);
    sync.present('a', 7, 0);
    await vi.advanceTimersByTimeAsync(15000);
    expect(send).toHaveBeenCalledTimes(1);
    sync.present('a', 9, 0);
    await vi.advanceTimersByTimeAsync(500);
    expect(send.mock.calls).toEqual([['a', 7], ['a', 9]]);
    first.resolve(status(12, 7));
    await vi.advanceTimersByTimeAsync(0);
    second.resolve(status(12, 9));
    await vi.advanceTimersByTimeAsync(0);
    expect(apply.mock.calls).toEqual([['a', status(12, 7)], ['a', status(12, 9)]]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(2);
    sync.dispose();
  });

  it('settles a lost HTTP reply from a committed private confirmation without replay', async () => {
    const { sync, send } = setup(vi.fn(() => new Promise<FlowerThreadReadStatus>(() => undefined)));
    sync.present('a', 7, 0);
    await vi.advanceTimersByTimeAsync(0);
    sync.confirm('a', status(9, 7));
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sync.presentedRevision('a')).toBe(7);
    sync.dispose();
  });

  it.each([401, 403, 423])('pauses access failures (%s) until existing access recovery succeeds', async code => {
    const send = vi.fn(async (_id: string, _revision: number): Promise<FlowerThreadReadStatus> => { throw Object.assign(new Error('access'), { status: code }); });
    const { sync } = setup(send);
    sync.present('a', 7, 0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(1);
    sync.present('a', 9, 0);
    sync.setAvailable(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(1);
    send.mockImplementation(async (_id, revision) => status(revision, revision));
    sync.setAvailable(true, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls).toEqual([['a', 7], ['a', 9]]);
    sync.dispose();
  });

  it('pauses offline timers and resumes the highest presented revision on reconnect', async () => {
    const { sync, send } = setup();
    sync.setAvailable(false); sync.present('a', 7, 0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).not.toHaveBeenCalled();
    sync.present('a', 9, 0); sync.setAvailable(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls).toEqual([['a', 9]]);
    sync.dispose();
  });

  it.each(['retire', 'reset', 'dispose'] as const)('ignores late callbacks after %s and clears all timers', async action => {
    const request = deferred<FlowerThreadReadStatus>();
    const { sync, send, apply } = setup(vi.fn(() => request.promise));
    sync.present('a', 7, 0);
    await vi.advanceTimersByTimeAsync(0);
    if (action === 'retire') sync.retire('a'); else sync[action]();
    request.resolve(status(9, 7));
    await vi.advanceTimersByTimeAsync(60000);
    expect(apply).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
