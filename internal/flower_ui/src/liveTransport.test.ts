// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLiveTransport } from './liveTransport';

function controlledConnections<T>() {
  const connections: {
    signal: AbortSignal;
    push: (value: T) => void;
    end: () => void;
    reject: (error: unknown) => void;
  }[] = [];
  const connect = vi.fn(({ signal }: Readonly<{ signal: AbortSignal }>) => {
    const values: IteratorResult<T>[] = [];
    let receive: ((value: IteratorResult<T>) => void) | undefined;
    let reject: ((error: unknown) => void) | undefined;
    const deliver = (value: IteratorResult<T>) => {
      if (receive) { receive(value); receive = undefined; reject = undefined; }
      else values.push(value);
    };
    // Ignore cancellation deliberately: stale adapters must never regain cache
    // ownership even when their pending read finishes after an abort.
    connections.push({ signal, push: value => deliver({ value, done: false }), end: () => deliver({ value: undefined, done: true }), reject: error => reject?.(error) });
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => values.length ? Promise.resolve(values.shift()!) : new Promise<IteratorResult<T>>((resolve, fail) => { receive = resolve; reject = fail; }),
        return: async () => ({ value: undefined, done: true as const }),
      }),
    };
  });
  return { connect, connections };
}

afterEach(() => vi.useRealTimers());

describe('LiveTransport', () => {
  it('invalidates outstanding reads immediately on disconnect before reconnecting', async () => {
    vi.useFakeTimers();
    const transport = createLiveTransport<{ kind: string }>();
    let connectedEpoch = 0, disconnectedEpoch = 0;
    const stop = transport.start({
      connect: async function* () { yield { kind: 'ready' }; },
      onCurrent: () => { connectedEpoch = transport.connectionEpoch(); },
      onBoundary: () => { disconnectedEpoch = transport.connectionEpoch(); },
      onTerminalError: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(disconnectedEpoch).toBeGreaterThan(connectedEpoch);
    stop(); vi.useRealTimers();
  });
  it('reports a current-view contract failure once without reconnecting', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(async function* () {
      yield { kind: 'ready' };
    });
    const terminalErrors: unknown[] = [];
    const transport = createLiveTransport<{ kind: string }>();
    const stop = transport.start({
      connect,
      onCurrent: () => {
        throw new Error('invalid current view');
      },
      onTerminalError: (error) => terminalErrors.push(error),
    });

    await vi.runAllTimersAsync();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(terminalErrors).toHaveLength(1);
    expect(String(terminalErrors[0])).toContain('invalid current view');
    stop();
    vi.useRealTimers();
  });
});

describe('LiveTransport recovery ownership', () => {
  it('restarts through the same owner, aborts superseded connections, and rejects late frames and failures', async () => {
    vi.useFakeTimers();
    const fixture = controlledConnections<{ kind: string }>();
    const onCurrent = vi.fn(); const onBoundary = vi.fn(); const onTerminalError = vi.fn();
    const transport = createLiveTransport<{ kind: string }>();
    const stop = transport.start({ ...fixture, onCurrent, onBoundary, onTerminalError, isReady: value => value.kind === 'ready' });
    const firstEpoch = transport.connectionEpoch();
    transport.restart(); transport.restart();
    const latestEpoch = transport.connectionEpoch();
    expect(fixture.connections.map(connection => connection.signal.aborted)).toEqual([true, true, false]);
    expect(latestEpoch).toBeGreaterThan(firstEpoch);
    fixture.connections[0]!.push({ kind: 'stale' });
    fixture.connections[1]!.reject(new Error('stale failure'));
    fixture.connections[2]!.push({ kind: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(onCurrent).toHaveBeenCalledExactlyOnceWith({ kind: 'ready' }, latestEpoch);
    expect(onTerminalError).not.toHaveBeenCalled();
    expect(transport.state()).toEqual({ status: 'ready', connectionEpoch: latestEpoch });
    expect(onBoundary).toHaveBeenCalledTimes(2);
    transport.fail(new Error('stale asynchronous application'), firstEpoch);
    expect(transport.state().status).toBe('ready');
    stop();
    expect(fixture.connections[2]!.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases a stalled handshake after 15 seconds and keeps the failure until a manually restarted ready', async () => {
    vi.useFakeTimers();
    const fixture = controlledConnections<{ kind: string }>();
    const onTerminalError = vi.fn(); const onState = vi.fn();
    const transport = createLiveTransport<{ kind: string }>();
    const stop = transport.start({ ...fixture, onCurrent: vi.fn(), onTerminalError, onState, isReady: value => value.kind === 'ready' });
    fixture.connections[0]!.push({ kind: 'summary.batch' });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(transport.state().status).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.state()).toMatchObject({ status: 'failed', error: { code: 'flower_live_handshake_timeout' } });
    expect(fixture.connections[0]!.signal.aborted).toBe(true);
    expect(onTerminalError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.connect).toHaveBeenCalledOnce();
    const failure = transport.state().error;
    transport.restart();
    expect(transport.state()).toMatchObject({ status: 'connecting', error: failure });
    fixture.connections[1]!.push({ kind: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.state()).toEqual({ status: 'ready', connectionEpoch: transport.connectionEpoch() });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onTerminalError).toHaveBeenCalledOnce();
    expect(transport.state().status).toBe('ready');
    expect(onState.mock.calls.map(([value]) => value.status)).toEqual(['connecting', 'failed', 'connecting', 'ready']);
    stop();
  });

  it('routes asynchronous application failure through one terminal boundary and cancels all observation', async () => {
    vi.useFakeTimers();
    const fixture = controlledConnections<{ kind: string }>();
    const onTerminalError = vi.fn(); const onBoundary = vi.fn();
    const transport = createLiveTransport<{ kind: string }>();
    const stop = transport.start({ ...fixture, onCurrent: vi.fn(), onTerminalError, onBoundary, isReady: value => value.kind === 'ready' });
    fixture.connections[0]!.push({ kind: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    const failedEpoch = transport.connectionEpoch();
    const error = new Error('deferred presentation failed');
    transport.fail(error, failedEpoch); transport.fail(error, failedEpoch);
    fixture.connections[0]!.push({ kind: 'late' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onTerminalError).toHaveBeenCalledExactlyOnceWith(error);
    expect(onBoundary).toHaveBeenCalledOnce();
    expect(fixture.connect).toHaveBeenCalledOnce();
    expect(transport.state()).toMatchObject({ status: 'failed', error });
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it.each(['eof', 'transport', 'rate_limit'])('keeps the existing %s retry policy and cancels a pending retry on manual restart', async (kind) => {
    vi.useFakeTimers();
    const fixture = controlledConnections<{ kind: string }>();
    const onTerminalError = vi.fn();
    const transport = createLiveTransport<{ kind: string }>();
    const stop = transport.start({ ...fixture, onCurrent: vi.fn(), onTerminalError, isReady: value => value.kind === 'ready' });
    if (kind === 'eof') fixture.connections[0]!.end();
    else fixture.connections[0]!.reject(Object.assign(new Error('disconnected'), kind === 'transport'
      ? { code: 'transport' } : { code: 'rate_limit', status: 429, retryAfter: '2' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.state().status).toBe('reconnecting');
    expect(onTerminalError).not.toHaveBeenCalled();
    if (kind === 'rate_limit') {
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fixture.connect).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
    } else await vi.advanceTimersByTimeAsync(300);
    expect(fixture.connect).toHaveBeenCalledTimes(2);
    fixture.connections[1]!.end();
    await vi.advanceTimersByTimeAsync(0);
    transport.restart();
    expect(fixture.connect).toHaveBeenCalledTimes(3);
    fixture.connections[2]!.push({ kind: 'ready' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.connect).toHaveBeenCalledTimes(3);
    expect(transport.state().status).toBe('ready');
    stop();
  });

  it('keeps old cleanup handles from stopping a replacement owner', async () => {
    vi.useFakeTimers();
    const fixture = controlledConnections<{ kind: string }>();
    const transport = createLiveTransport<{ kind: string }>();
    const input = { ...fixture, onCurrent: vi.fn(), onTerminalError: vi.fn(), isReady: (value: { kind: string }) => value.kind === 'ready' };
    const stopFirst = transport.start(input);
    const stopSecond = transport.start(input);
    const epoch = transport.connectionEpoch();
    stopFirst();
    expect(transport.connectionEpoch()).toBe(epoch);
    expect(fixture.connections[1]!.signal.aborted).toBe(false);
    stopSecond();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.connect).toHaveBeenCalledTimes(2);
    expect(transport.state().status).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains a terminal failure through visibility cleanup and clears it only after a new ready', async () => {
    vi.useFakeTimers();
    const fixture = controlledConnections<{ kind: string }>();
    const transport = createLiveTransport<{ kind: string }>();
    const onTerminalError = vi.fn();
    const input = { ...fixture, onCurrent: vi.fn(), onTerminalError, isReady: (value: { kind: string }) => value.kind === 'ready' };
    const stopFirst = transport.start(input);
    const error = Object.assign(new Error('authorization required'), { status: 403, code: 'unexpected_status' });
    fixture.connections[0]!.reject(error);
    await vi.advanceTimersByTimeAsync(0);
    stopFirst();
    expect(transport.state()).toMatchObject({ status: 'failed', error });
    const stopSecond = transport.start(input);
    expect(transport.state()).toMatchObject({ status: 'connecting', error });
    fixture.connections[1]!.push({ kind: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.state()).toEqual({ status: 'ready', connectionEpoch: transport.connectionEpoch() });
    expect(onTerminalError).toHaveBeenCalledExactlyOnceWith(error);
    stopSecond();
  });

  it('fences a retry callback already dispatched before manual restart', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(window, 'setTimeout');
    const fixture = controlledConnections<{ kind: string }>();
    const transport = createLiveTransport<{ kind: string }>();
    const stop = transport.start({ ...fixture, onCurrent: vi.fn(), onTerminalError: vi.fn() });
    fixture.connections[0]!.end();
    await vi.advanceTimersByTimeAsync(0);
    const staleRetry = timeout.mock.calls.at(-1)![0] as () => void;
    transport.restart();
    const epoch = transport.connectionEpoch();
    staleRetry();
    expect(fixture.connect).toHaveBeenCalledTimes(2);
    expect(transport.connectionEpoch()).toBe(epoch);
    expect(fixture.connections[1]!.signal.aborted).toBe(false);
    stop(); timeout.mockRestore();
  });
});

it.each([401, 403, 423])('terminates observation after authorization status %s without retry', async (status) => {
  vi.useFakeTimers();
  const failure = Object.assign(new Error('not authorized'), { code: 'unexpected_status', status });
  const connect = vi.fn(() => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw failure; } }) }));
  const onTerminalError = vi.fn();
  const stop = createLiveTransport().start({ connect, onCurrent: vi.fn(), onTerminalError });
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledOnce();
    expect(onTerminalError).toHaveBeenCalledExactlyOnceWith(failure);
  } finally { stop(); vi.useRealTimers(); }
});
