import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentMaintenanceController } from './createAgentMaintenanceController';

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createAgentMaintenanceController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses the shared reconnect chain after a successful upgrade', async () => {
    const notify = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    };

    const [envId] = createSignal('env_upgrade');
    const [canAdmin] = createSignal(true);
    const [controlplaneStatus] = createSignal('online');
    const [protocolStatus, setProtocolStatus] = createSignal('connected');
    const [currentProcessStartedAtMs] = createSignal<number | null>(100);
    const [currentVersion] = createSignal('v1.0.0');

    const connect = vi.fn(async () => {
      setProtocolStatus('connected');
    });
    const upgrade = vi.fn(async (req?: { targetVersion?: string }) => {
      const targetVersion = req?.targetVersion;
      expect(targetVersion).toBe('v1.1.0');
      setProtocolStatus('disconnected');
      return { ok: true };
    });
    const getEnvironment = vi.fn()
      .mockResolvedValueOnce({ status: 'offline' })
      .mockResolvedValueOnce({ status: 'online' });
    const refetchCurrentVersion = vi.fn()
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.0.0', processStartedAtMs: 100 })
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.1.0', processStartedAtMs: 200 });
    const refetchEnvironment = vi.fn(async () => ({
      public_id: 'env_upgrade',
      name: 'Upgrade env',
      namespace_public_id: 'ns_upgrade',
      lifecycle_status: 'running',
      status: 'online',
    }));

    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        envId,
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
        connect,
        notify,
        rpc: {
          sys: {
            upgrade,
            restart: vi.fn(async () => ({ ok: true })),
          },
        },
        refetchCurrentVersion,
        refetchEnvironment,
        getEnvironment: getEnvironment as any,
      });
      return disposeRoot;
    });

    try {
      const promise = controller.startUpgrade('v1.1.0');
      await flushAsync();

      await vi.advanceTimersByTimeAsync(1_500);
      await flushAsync();
      await vi.advanceTimersByTimeAsync(1_500);
      await promise;

      expect(upgrade).toHaveBeenCalledTimes(1);
      expect(getEnvironment).toHaveBeenCalledTimes(2);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(refetchCurrentVersion).toHaveBeenCalledTimes(2);
      expect(refetchEnvironment).toHaveBeenCalledTimes(1);
      expect(controller.kind()).toBe(null);
      expect(controller.error()).toBe(null);
      expect(notify.success).toHaveBeenCalledWith('Updated', 'Agent updated to v1.1.0.');
    } finally {
      dispose();
    }
  });

  it('rejects invalid target versions before any maintenance request is sent', async () => {
    const notify = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    };

    const [envId] = createSignal('env_upgrade');
    const [canAdmin] = createSignal(true);
    const [controlplaneStatus] = createSignal('online');
    const [protocolStatus] = createSignal('connected');
    const [currentProcessStartedAtMs] = createSignal<number | null>(100);
    const [currentVersion] = createSignal('v1.0.0');
    const upgrade = vi.fn(async () => ({ ok: true }));

    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        envId,
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
        connect: async () => undefined,
        notify,
        rpc: {
          sys: {
            upgrade,
            restart: vi.fn(async () => ({ ok: true })),
          },
        },
        refetchCurrentVersion: async () => null,
      });
      return disposeRoot;
    });

    try {
      await controller.startUpgrade('main');

      expect(upgrade).not.toHaveBeenCalled();
      expect(controller.error()).toBe('Target version must be a valid release tag (for example: v1.2.3).');
      expect(notify.error).toHaveBeenCalledWith('Update failed', 'Target version must be a valid release tag (for example: v1.2.3).');
    } finally {
      dispose();
    }
  });

  it('completes restart when the process marker changes even if no disconnect is observed', async () => {
    const notify = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    };

    const [envId] = createSignal('env_restart');
    const [canAdmin] = createSignal(true);
    const [controlplaneStatus] = createSignal('online');
    const [protocolStatus] = createSignal('connected');
    const [currentProcessStartedAtMs] = createSignal<number | null>(100);
    const [currentVersion] = createSignal('v1.0.0');

    const connect = vi.fn(async () => undefined);
    const restart = vi.fn(async () => ({ ok: true }));
    const getEnvironment = vi.fn()
      .mockResolvedValueOnce({ status: 'online' })
      .mockResolvedValueOnce({ status: 'online' });
    const refetchCurrentVersion = vi.fn()
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.0.0', processStartedAtMs: 100 })
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.0.0', processStartedAtMs: 100 })
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.0.0', processStartedAtMs: 200 });

    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        envId,
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
        connect,
        notify,
        rpc: {
          sys: {
            upgrade: vi.fn(async () => ({ ok: true })),
            restart,
          },
        },
        refetchCurrentVersion,
        getEnvironment: getEnvironment as any,
      });
      return disposeRoot;
    });

    try {
      const promise = controller.startRestart();
      await flushAsync();

      await vi.advanceTimersByTimeAsync(1_500);
      await flushAsync();
      await vi.advanceTimersByTimeAsync(1_500);
      await promise;

      expect(restart).toHaveBeenCalledTimes(1);
      expect(connect).not.toHaveBeenCalled();
      expect(controller.kind()).toBe(null);
      expect(controller.error()).toBe(null);
      expect(notify.success).toHaveBeenCalledWith('Reconnected', 'Agent is back online.');
    } finally {
      dispose();
    }
  });
});
