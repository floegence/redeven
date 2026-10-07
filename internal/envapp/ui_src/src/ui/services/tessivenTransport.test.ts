import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTessivenTransport } from '../../../../../tessiven_ui/src/transport';

describe('createTessivenTransport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnects after a transient stream end before presenting a disconnect', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const events = vi.fn((_path: string, signal: AbortSignal) => {
      attempt += 1;
      if (attempt === 1) {
        return (async function* () {
          yield { event: 'changed', data: '{}' };
        })();
      }
      return (async function* () {
        yield { event: 'changed', data: '{}' };
        await new Promise<void>(resolve => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      })();
    });
    const changed = vi.fn();
    const streamError = vi.fn();
    const stop = createTessivenTransport(vi.fn(), events).subscribe(changed, streamError);

    await vi.advanceTimersByTimeAsync(0);
    expect(events).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(events).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(streamError).not.toHaveBeenCalled();

    stop();
  });
});
