import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifyReconnectFailure,
  createAgentReconnectController,
  type AgentReconnectController,
} from './createAgentReconnectController';

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
      kind: 'agent_offline',
    });
    expect(classifyReconnectFailure({ code: 'AGENT_UNAVAILABLE', message: 'Failed to deliver grant_server' })).toMatchObject({
      kind: 'agent_unavailable',
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

describe('createAgentReconnectController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps waiting while the environment looks offline and reconnects once it looks online', async () => {
    vi.useFakeTimers();

    const getEnvironment = vi.fn()
      .mockResolvedValueOnce({ status: 'offline' })
      .mockResolvedValueOnce({ status: 'online' });
    const reconnect = vi.fn(async () => undefined);

    let controller!: AgentReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentReconnectController({
        enabled: () => true,
        envId: () => 'env-demo',
        getEnvironment,
        reconnect,
      });
      return disposeRoot;
    });

    controller.activateWaiting({ kind: 'agent_offline', message: 'Agent is offline.' });
    expect(controller.phase()).toBe('waiting_for_agent');

    await vi.advanceTimersByTimeAsync(2_000);
    await flushAsync();

    expect(getEnvironment).toHaveBeenCalledTimes(1);
    expect(controller.controlplaneStatus()).toBe('offline');
    expect(controller.phase()).toBe('waiting_for_agent');
    expect(reconnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    await flushAsync();

    expect(getEnvironment).toHaveBeenCalledTimes(2);
    expect(controller.controlplaneStatus()).toBe('online');
    expect(controller.phase()).toBe('reconnecting');
    expect(reconnect).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('lets manual retry bypass the offline wait delay', async () => {
    vi.useFakeTimers();

    const getEnvironment = vi.fn().mockResolvedValue({ status: 'offline' });
    const reconnect = vi.fn(async () => undefined);

    let controller!: AgentReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentReconnectController({
        enabled: () => true,
        envId: () => 'env-demo',
        getEnvironment,
        reconnect,
      });
      return disposeRoot;
    });

    controller.activateWaiting({ kind: 'agent_offline', message: 'Agent is offline.' });
    controller.requestReconnectNow();
    await flushAsync();

    expect(getEnvironment).toHaveBeenCalledTimes(1);
    expect(controller.phase()).toBe('reconnecting');
    expect(reconnect).toHaveBeenCalledTimes(1);

    dispose();
  });
});
