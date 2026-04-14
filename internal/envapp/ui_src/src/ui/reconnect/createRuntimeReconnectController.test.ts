import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifyReconnectFailure,
  createRuntimeReconnectController,
  type RuntimeReconnectController,
} from './createRuntimeReconnectController';

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0);
  }
}

describe('classifyReconnectFailure', () => {
  it('classifies explicit offline and unavailable control-plane errors', () => {
    expect(classifyReconnectFailure({ code: 'AGENT_OFFLINE', message: 'No agent connected' })).toMatchObject({
      kind: 'runtime_offline',
    });
    expect(classifyReconnectFailure({ code: 'AGENT_UNAVAILABLE', message: 'Failed to deliver grant_server' })).toMatchObject({
      kind: 'runtime_unavailable',
    });
  });

  it('keeps auth and missing-context failures out of the automatic waiting loop', () => {
    expect(classifyReconnectFailure({ status: 401, message: 'invalid resume token' })).toMatchObject({
      kind: 'fatal',
    });
    expect(classifyReconnectFailure(new Error('Missing env context. Please reopen from the Redeven Portal.'))).toMatchObject({
      kind: 'fatal',
    });
  });
});

describe('createRuntimeReconnectController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps waiting while the environment looks offline and reconnects once it looks online', async () => {
    vi.useFakeTimers();

    const probeAvailability = vi.fn()
      .mockResolvedValueOnce({ status: 'offline', access: 'unknown' })
      .mockResolvedValueOnce({ status: 'online', access: 'ready' });
    const reconnect = vi.fn(async () => undefined);

    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        probeAvailability,
        reconnect,
      });
      return disposeRoot;
    });

    controller.activateWaiting({ kind: 'runtime_offline', message: 'The runtime is offline.' });
    expect(controller.phase()).toBe('waiting_for_runtime');

    await vi.advanceTimersByTimeAsync(2_000);
    await flushAsync();

    expect(probeAvailability).toHaveBeenCalledTimes(1);
    expect(controller.availabilityStatus()).toBe('offline');
    expect(controller.phase()).toBe('waiting_for_runtime');
    expect(reconnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    await flushAsync();

    expect(probeAvailability).toHaveBeenCalledTimes(2);
    expect(controller.availabilityStatus()).toBe('online');
    expect(controller.phase()).toBe('reconnecting');
    expect(reconnect).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('lets manual retry bypass the offline wait delay', async () => {
    vi.useFakeTimers();

    const probeAvailability = vi.fn().mockResolvedValue({ status: 'offline', access: 'unknown' });
    const reconnect = vi.fn(async () => undefined);

    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        probeAvailability,
        reconnect,
      });
      return disposeRoot;
    });

    controller.activateWaiting({ kind: 'runtime_offline', message: 'The runtime is offline.' });
    controller.requestReconnectNow();
    await flushAsync();

    expect(probeAvailability).toHaveBeenCalledTimes(1);
    expect(controller.phase()).toBe('reconnecting');
    expect(reconnect).toHaveBeenCalledTimes(1);

    dispose();
  });
});
