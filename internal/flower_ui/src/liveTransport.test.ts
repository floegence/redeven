// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createLiveTransport } from './liveTransport';

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
