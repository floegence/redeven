import { afterEach, describe, expect, it, vi } from 'vitest';

const preparePagedTerminalHistory = vi.hoisted(() => vi.fn());

vi.mock('@floegence/floeterm-terminal-web/history', () => ({
  preparePagedTerminalHistory,
}));

import { createTerminalHistoryWarmup } from './terminalHistoryWarmup';

function seed(byteLength: number, pageCount = 1, complete = true) {
  return {
    chunks: [],
    requestedStartSequence: 0,
    firstRetainedSequence: 0,
    coveredThroughSequence: 10,
    snapshotEndSequence: 10,
    historyGeneration: 1,
    byteLength,
    pageCount,
    complete,
  } as const;
}

function completeEmptySeed() {
  return {
    chunks: [],
    requestedStartSequence: 0,
    firstRetainedSequence: 0,
    coveredThroughSequence: 0,
    snapshotEndSequence: 0,
    historyGeneration: 1,
    byteLength: 0,
    pageCount: 0,
    complete: true,
  } as const;
}

function page() {
  return {
    chunks: [],
    hasMore: false,
    coveredThroughSequence: 10,
    coveredBytes: 1,
    totalBytes: 1,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('terminal history warmup', () => {
  it('warms only active sessions in MRU order with one background task at a time', async () => {
    const order: string[] = [];
    preparePagedTerminalHistory.mockImplementation(async ({ fetchPage }: any) => {
      order.push('start');
      await fetchPage({ startSequence: 0, signal: new AbortController().signal });
      return seed(10);
    });
    const warmup = createTerminalHistoryWarmup({
      budgetBytes: 100,
      fetchPage: async (sessionId) => {
        order.push(sessionId);
        return page();
      },
      yieldControl: async () => undefined,
    });
    warmup.syncSessions([
      { id: 'dormant', isActive: false, lastActiveAtMs: 100 },
      { id: 'old', isActive: true, lastActiveAtMs: 10 },
      { id: 'new', isActive: true, lastActiveAtMs: 20 },
    ]);
    warmup.start();
    await vi.waitFor(() => expect(warmup.getSnapshot().cached).toBe(2));
    expect(order.filter((value) => value !== 'start')).toEqual(['new', 'old']);
    expect(warmup.get('dormant')).toBeNull();
  });

  it('keeps one hundred dormant sessions metadata-only without fetching history', async () => {
    const fetchPage = vi.fn(async () => page());
    preparePagedTerminalHistory.mockResolvedValue(seed(10));
    const warmup = createTerminalHistoryWarmup({ budgetBytes: 1024, fetchPage });

    warmup.syncSessions(Array.from({ length: 100 }, (_, index) => ({
      id: `dormant-${index + 1}`,
      isActive: false,
      lastActiveAtMs: 100 - index,
    })));
    warmup.start();
    await Promise.resolve();

    expect(preparePagedTerminalHistory).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(warmup.getSnapshot()).toEqual({ queued: 0, inFlight: 0, cached: 0, bytes: 0 });
  });

  it('promotes an in-flight background request without duplicating pagination', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let fetchCount = 0;
    preparePagedTerminalHistory.mockImplementation(async ({ fetchPage }: any) => {
      await fetchPage({ startSequence: 0, signal: new AbortController().signal });
      await gate;
      return seed(20);
    });
    const warmup = createTerminalHistoryWarmup({
      budgetBytes: 100,
      fetchPage: async () => {
        fetchCount += 1;
        return page();
      },
      yieldControl: async () => undefined,
    });
    warmup.syncSessions([{ id: 'session', isActive: true, lastActiveAtMs: 1 }]);
    warmup.start();
    const first = warmup.request('session', 'interactive');
    const second = warmup.request('session', 'interactive');
    expect(first).toBe(second);
    release();
    await expect(first).resolves.toMatchObject({ byteLength: 20 });
    expect(fetchCount).toBe(1);
  });

  it('keeps a newer seed and limits an older session to the remaining budget', async () => {
    preparePagedTerminalHistory.mockImplementation(async ({ fetchPage, maxBytes }: any) => {
      await fetchPage({ startSequence: 0, signal: new AbortController().signal });
      const byteLength = Math.min(maxBytes, 60);
      return seed(byteLength, 1, byteLength >= 60);
    });
    const events: string[] = [];
    const warmup = createTerminalHistoryWarmup({
      budgetBytes: 100,
      fetchPage: async () => page(),
      yieldControl: async () => undefined,
      onEvent: (event) => { if (event.event === 'skipped') events.push(event.reason ?? ''); },
    });
    warmup.syncSessions([
      { id: 'new', isActive: true, lastActiveAtMs: 20 },
      { id: 'old', isActive: true, lastActiveAtMs: 10 },
    ]);
    expect(await warmup.request('new', 'background')).not.toBeNull();
    expect(await warmup.request('old', 'background')).toMatchObject({ byteLength: 40 });
    expect(warmup.get('new')).not.toBeNull();
    expect(warmup.get('old')).toMatchObject({ byteLength: 40, complete: false });
    expect(events).not.toContain('budget');
  });

  it('cancels background work on hidden/inactive and invalidates late results', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    preparePagedTerminalHistory.mockImplementation(async ({ fetchPage }: any) => {
      await fetchPage({ startSequence: 0, signal: new AbortController().signal });
      await gate;
      return seed(20);
    });
    const warmup = createTerminalHistoryWarmup({ budgetBytes: 100, fetchPage: async () => page() });
    warmup.syncSessions([{ id: 'session', isActive: true, lastActiveAtMs: 1 }]);
    warmup.start();
    warmup.setPageHidden(true);
    release();
    await vi.waitFor(() => expect(warmup.getSnapshot().inFlight).toBe(0));
    expect(warmup.get('session')).toBeNull();
    warmup.syncSessions([{ id: 'session', isActive: true, lastActiveAtMs: 1 }]);
    warmup.start();
    warmup.invalidate('session', 'clear');
    expect(await warmup.request('session', 'interactive')).toBeNull();
  });

  it('requeues eligible sessions after the terminal becomes active and visible again', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    preparePagedTerminalHistory
      .mockImplementationOnce(async ({ fetchPage }: any) => {
        await fetchPage({ startSequence: 0, signal: new AbortController().signal });
        await firstGate;
        return seed(10);
      })
      .mockImplementationOnce(async ({ fetchPage }: any) => {
        await fetchPage({ startSequence: 0, signal: new AbortController().signal });
        return seed(10);
      });
    const fetchPage = vi.fn(async () => page());
    const warmup = createTerminalHistoryWarmup({ budgetBytes: 100, fetchPage });
    warmup.syncSessions([{ id: 'session', isActive: true, lastActiveAtMs: 1 }]);
    warmup.start();
    await vi.waitFor(() => expect(preparePagedTerminalHistory).toHaveBeenCalledTimes(1));

    warmup.setPageActive(false);
    releaseFirst();
    await vi.waitFor(() => expect(warmup.getSnapshot().inFlight).toBe(0));
    expect(warmup.get('session')).toBeNull();

    warmup.setPageHidden(true);
    warmup.setPageActive(true);
    expect(preparePagedTerminalHistory).toHaveBeenCalledTimes(1);
    warmup.setPageHidden(false);

    await vi.waitFor(() => expect(warmup.get('session')).not.toBeNull());
    expect(preparePagedTerminalHistory).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('keeps physical history RPCs serialized until an aborted request settles', async () => {
    preparePagedTerminalHistory.mockImplementation(async ({ fetchPage, signal }: any) => {
      const fetched = fetchPage({ startSequence: 0, signal });
      await Promise.race([
        fetched,
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
      ]);
      return seed(10);
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let physicalInFlight = 0;
    let maximumPhysicalInFlight = 0;
    const fetchPage = vi.fn(async () => {
      physicalInFlight += 1;
      maximumPhysicalInFlight = Math.max(maximumPhysicalInFlight, physicalInFlight);
      if (fetchPage.mock.calls.length === 1) await firstGate;
      physicalInFlight -= 1;
      return page();
    });
    const warmup = createTerminalHistoryWarmup({ budgetBytes: 100, fetchPage });
    warmup.syncSessions([{ id: 'session', isActive: true, lastActiveAtMs: 1 }]);
    warmup.start();
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));

    warmup.setPageActive(false);
    warmup.setPageActive(true);
    await Promise.resolve();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await expect(Promise.race([
      warmup.request('session', 'interactive'),
      new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 25)),
    ])).resolves.toBeNull();

    releaseFirst();
    await vi.waitFor(() => expect(warmup.getSnapshot().inFlight).toBe(0));
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(warmup.get('session')).toBeNull();
    expect(maximumPhysicalInFlight).toBe(1);
  });

  it('stops lower-priority history work after the budget rejects a newer candidate', async () => {
    preparePagedTerminalHistory.mockImplementation(async ({ fetchPage, maxBytes }: any) => {
      await fetchPage({ startSequence: 0, signal: new AbortController().signal });
      const byteLength = Math.min(maxBytes, 60);
      return seed(byteLength, 1, byteLength >= 60);
    });
    const fetchedSessions: string[] = [];
    const warmup = createTerminalHistoryWarmup({
      budgetBytes: 100,
      fetchPage: async (sessionId) => {
        fetchedSessions.push(sessionId);
        return page();
      },
      yieldControl: async () => undefined,
    });
    warmup.syncSessions([
      { id: 'newest', isActive: true, lastActiveAtMs: 30 },
      { id: 'older', isActive: true, lastActiveAtMs: 20 },
      { id: 'oldest', isActive: true, lastActiveAtMs: 10 },
    ]);
    warmup.start();

    await vi.waitFor(() => expect(warmup.getSnapshot().inFlight).toBe(0));
    expect(fetchedSessions).toEqual(['newest', 'older']);
    expect(warmup.get('newest')).not.toBeNull();
    expect(warmup.get('older')).toMatchObject({ byteLength: 40, complete: false });
    expect(warmup.get('oldest')).toBeNull();
  });

  it('reorders queued background work when a more recent session appears during warmup', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const fetchedSessions: string[] = [];
    preparePagedTerminalHistory.mockImplementation(async ({ fetchPage, maxBytes }: any) => {
      await fetchPage({ startSequence: 0, signal: new AbortController().signal });
      if (fetchedSessions.at(-1) === 'current') await firstGate;
      const byteLength = Math.min(maxBytes, 60);
      return seed(byteLength, 1, byteLength >= 60);
    });
    const warmup = createTerminalHistoryWarmup({
      budgetBytes: 100,
      fetchPage: async (sessionId) => {
        fetchedSessions.push(sessionId);
        return page();
      },
      yieldControl: async () => undefined,
    });
    warmup.syncSessions([
      { id: 'current', isActive: true, lastActiveAtMs: 30 },
      { id: 'older', isActive: true, lastActiveAtMs: 20 },
    ]);
    warmup.start();
    await vi.waitFor(() => expect(fetchedSessions).toEqual(['current']));

    warmup.syncSessions([
      { id: 'current', isActive: true, lastActiveAtMs: 30 },
      { id: 'older', isActive: true, lastActiveAtMs: 20 },
      { id: 'newest', isActive: true, lastActiveAtMs: 40 },
    ]);
    releaseFirst();

    await vi.waitFor(() => expect(warmup.getSnapshot().inFlight).toBe(0));
    expect(fetchedSessions).toEqual(['current', 'newest', 'older']);
    expect(warmup.get('current')).toBeNull();
    expect(warmup.get('newest')).not.toBeNull();
    expect(warmup.get('older')).toMatchObject({ byteLength: 40, complete: false });
  });

  it('fully removes a zero-budget task without issuing a history request', async () => {
    const fetchPage = vi.fn(async () => page());
    preparePagedTerminalHistory.mockResolvedValue(seed(10));
    const warmup = createTerminalHistoryWarmup({ budgetBytes: 0, fetchPage });
    warmup.syncSessions([{ id: 'session', isActive: true, lastActiveAtMs: 1 }]);
    warmup.start();
    await Promise.resolve();

    expect(fetchPage).not.toHaveBeenCalled();
    expect(preparePagedTerminalHistory).not.toHaveBeenCalled();
    expect(warmup.getSnapshot()).toEqual({ queued: 0, inFlight: 0, cached: 0, bytes: 0 });
  });

  it('does not cache a zero-byte incomplete seed that cannot reduce interactive recovery work', async () => {
    const events: string[] = [];
    preparePagedTerminalHistory.mockResolvedValue(seed(0, 1, false));
    const warmup = createTerminalHistoryWarmup({
      budgetBytes: 100,
      fetchPage: async () => page(),
      onEvent: (event) => {
        if (event.event === 'skipped') events.push(event.reason ?? '');
      },
    });
    warmup.syncSessions([{ id: 'session', isActive: true, lastActiveAtMs: 1 }]);

    await expect(warmup.request('session', 'background')).resolves.toBeNull();

    expect(warmup.get('session')).toBeNull();
    expect(warmup.getSnapshot()).toEqual({ queued: 0, inFlight: 0, cached: 0, bytes: 0 });
    expect(events).toContain('budget');
  });

  it('keeps a complete empty-history seed because it proves there is no recovery work', async () => {
    preparePagedTerminalHistory.mockResolvedValue(completeEmptySeed());
    const warmup = createTerminalHistoryWarmup({ budgetBytes: 100, fetchPage: async () => page() });
    warmup.syncSessions([{ id: 'session', isActive: true, lastActiveAtMs: 1 }]);

    await expect(warmup.request('session', 'background')).resolves.toMatchObject({
      byteLength: 0,
      complete: true,
    });

    expect(warmup.get('session')).toMatchObject({ byteLength: 0, complete: true });
    expect(warmup.getSnapshot()).toEqual({ queued: 0, inFlight: 0, cached: 1, bytes: 0 });
  });

  it('reports stable history contract failures without exposing arbitrary error text', async () => {
    const reasons: string[] = [];
    preparePagedTerminalHistory
      .mockRejectedValueOnce(Object.assign(new Error('sensitive history detail'), {
        code: 'history_contract_invalid',
      }))
      .mockRejectedValueOnce(Object.assign(new Error('sensitive history detail'), {
        code: 'invalid reason with spaces',
      }));
    const warmup = createTerminalHistoryWarmup({
      budgetBytes: 100,
      fetchPage: async () => page(),
      onEvent: (event) => {
        if (event.event === 'skipped') reasons.push(event.reason ?? '');
      },
    });
    warmup.syncSessions([
      { id: 'first', isActive: true, lastActiveAtMs: 2 },
      { id: 'second', isActive: true, lastActiveAtMs: 1 },
    ]);

    await expect(warmup.request('first', 'background')).resolves.toBeNull();
    await expect(warmup.request('second', 'background')).resolves.toBeNull();

    expect(reasons).toEqual(['history_contract_invalid', 'error']);
  });

  it('does not make an interactive session wait behind another background RPC', async () => {
    preparePagedTerminalHistory.mockImplementation(async ({ fetchPage, signal }: any) => {
      await fetchPage({ startSequence: 0, signal });
      return seed(10);
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const fetchPage = vi.fn(async (sessionId: string) => {
      if (sessionId === 'session-a') await firstGate;
      return page();
    });
    const warmup = createTerminalHistoryWarmup({ budgetBytes: 100, fetchPage });
    warmup.syncSessions([
      { id: 'session-a', isActive: true, lastActiveAtMs: 2 },
      { id: 'session-b', isActive: true, lastActiveAtMs: 1 },
    ]);
    warmup.start();
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledWith('session-a', expect.anything()));

    await expect(warmup.request('session-b', 'interactive')).resolves.toBeNull();
    expect(fetchPage).not.toHaveBeenCalledWith('session-b', expect.anything());

    releaseFirst();
    await vi.waitFor(() => expect(warmup.getSnapshot().inFlight).toBe(0));
  });

  it('does not wait behind another session after its seed is promoted to interactive', async () => {
    preparePagedTerminalHistory.mockImplementation(async ({ fetchPage, signal }: any) => {
      await fetchPage({ startSequence: 0, signal });
      return seed(10);
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const fetchPage = vi.fn(async (sessionId: string) => {
      if (sessionId === 'session-a') await firstGate;
      return page();
    });
    const warmup = createTerminalHistoryWarmup({ budgetBytes: 100, fetchPage });
    warmup.syncSessions([
      { id: 'session-a', isActive: true, lastActiveAtMs: 2 },
      { id: 'session-b', isActive: true, lastActiveAtMs: 1 },
    ]);
    warmup.start();
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledWith('session-a', expect.anything()));

    const promotedFirst = warmup.request('session-a', 'interactive');
    await expect(warmup.request('session-b', 'interactive')).resolves.toBeNull();
    expect(fetchPage).not.toHaveBeenCalledWith('session-b', expect.anything());

    releaseFirst();
    await expect(promotedFirst).resolves.not.toBeNull();
    await vi.waitFor(() => expect(warmup.getSnapshot().inFlight).toBe(0));
  });

  it('does not requeue a removed running session', async () => {
    preparePagedTerminalHistory.mockResolvedValue(seed(10));
    const fetchPage = vi.fn(async () => page());
    const warmup = createTerminalHistoryWarmup({ budgetBytes: 100, fetchPage });
    warmup.syncSessions([{ id: 'removed', isActive: true, lastActiveAtMs: 1 }]);
    warmup.syncSessions([]);
    warmup.start();
    await Promise.resolve();
    expect(preparePagedTerminalHistory).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
