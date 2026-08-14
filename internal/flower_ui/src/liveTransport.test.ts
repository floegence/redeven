// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createLiveTransport } from './liveTransport';

describe('LiveTransport', () => {
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
