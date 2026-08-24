import { describe, expect, it, vi } from 'vitest';

import { createPluginSessionReadinessCoordinator } from './pluginSessionReadinessCoordinator';
import type { PluginSessionCredentialBinding } from './pluginSessionCredential';

function deferred(): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}> {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const binding = (generation: number, channelID: string): PluginSessionCredentialBinding => ({
  generation,
  channelID,
});

describe('plugin session readiness coordinator', () => {
  it('activates the exact credential only after readiness completes', async () => {
    const ready = deferred();
    const candidate = { client: {}, binding: binding(1, 'channel-1') };
    let current = candidate;
    const activate = vi.fn(() => true);
    const onReady = vi.fn();
    const coordinator = createPluginSessionReadinessCoordinator({
      waitForReady: () => ready.promise,
      isCurrent: (value) => value === current,
      activate,
      onReady,
      onFailure: vi.fn(),
    });

    coordinator.observe(candidate);
    await Promise.resolve();
    expect(activate).not.toHaveBeenCalled();

    ready.resolve();
    await ready.promise;
    await Promise.resolve();
    expect(activate).toHaveBeenCalledWith(candidate.binding);
    expect(onReady).toHaveBeenCalledWith(candidate);
    current = candidate;
  });

  it('aborts a superseded wait and ignores its late response', async () => {
    const firstReady = deferred();
    const secondReady = deferred();
    const first = { client: {}, binding: binding(1, 'channel-1') };
    const second = { client: {}, binding: binding(2, 'channel-2') };
    let current = first;
    const signals: AbortSignal[] = [];
    const activate = vi.fn(() => true);
    const coordinator = createPluginSessionReadinessCoordinator({
      waitForReady: (value, signal) => {
        signals.push(signal);
        return value.generation === 1 ? firstReady.promise : secondReady.promise;
      },
      isCurrent: (value) => value === current,
      activate,
      onReady: vi.fn(),
      onFailure: vi.fn(),
    });

    coordinator.observe(first);
    current = second;
    coordinator.observe(second);
    expect(signals[0]?.aborted).toBe(true);

    firstReady.resolve();
    await firstReady.promise;
    await Promise.resolve();
    expect(activate).not.toHaveBeenCalled();

    secondReady.resolve();
    await secondReady.promise;
    await Promise.resolve();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(second.binding);
  });

  it('reports only the current readiness failure', async () => {
    const ready = deferred();
    const candidate = { client: {}, binding: binding(1, 'channel-1') };
    const failure = new Error('session closed');
    const onFailure = vi.fn();
    const coordinator = createPluginSessionReadinessCoordinator({
      waitForReady: () => ready.promise,
      isCurrent: (value) => value === candidate,
      activate: vi.fn(() => true),
      onReady: vi.fn(),
      onFailure,
    });

    coordinator.observe(candidate);
    ready.reject(failure);
    await expect(ready.promise).rejects.toBe(failure);
    await Promise.resolve();
    expect(onFailure).toHaveBeenCalledWith(failure, candidate);
  });
});
