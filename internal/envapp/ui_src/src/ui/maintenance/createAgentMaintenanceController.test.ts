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

    const upgrade = vi.fn(async (req?: { targetVersion?: string }) => {
      const targetVersion = req?.targetVersion;
      expect(targetVersion).toBe('v1.1.0');
      setProtocolStatus('disconnected');
      return { ok: true };
    });
    const getEnvironment = vi.fn()
      .mockResolvedValueOnce({ status: 'offline' })
      .mockImplementationOnce(async () => {
        setProtocolStatus('connected');
        return { status: 'online' };
      });
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
    const onMaintenanceStarted = vi.fn();

    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        environmentDetailRequest: () => ({ source: 'controlplane', envId: envId() }),
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
        notify,
        rpc: {
          sys: {
            upgrade,
            restart: vi.fn(async () => ({ ok: true })),
          },
        },
        refetchCurrentVersion,
        refetchEnvironment,
        onMaintenanceStarted,
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
      expect(refetchCurrentVersion).toHaveBeenCalledTimes(2);
      expect(refetchEnvironment).toHaveBeenCalledTimes(1);
      expect(onMaintenanceStarted).toHaveBeenCalledOnce();
      expect(onMaintenanceStarted).toHaveBeenCalledWith('upgrade');
      expect(controller.kind()).toBe(null);
      expect(controller.error()).toBe(null);
      expect(notify.success).toHaveBeenCalledWith('Updated', 'Redeven updated to v1.1.0.');
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
    const onMaintenanceStarted = vi.fn();

    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        environmentDetailRequest: () => ({ source: 'controlplane', envId: envId() }),
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
        notify,
        rpc: {
          sys: {
            upgrade,
            restart: vi.fn(async () => ({ ok: true })),
          },
        },
        refetchCurrentVersion: async () => null,
        onMaintenanceStarted,
      });
      return disposeRoot;
    });

    try {
      await controller.startUpgrade('main');

      expect(upgrade).not.toHaveBeenCalled();
      expect(onMaintenanceStarted).not.toHaveBeenCalled();
      expect(controller.error()).toBe('Target version must be a valid release tag (for example: v1.2.3).');
      expect(notify.error).toHaveBeenCalledWith('Update failed', 'Target version must be a valid release tag (for example: v1.2.3).');
    } finally {
      dispose();
    }
  });

  it('notifies once when the maintenance request disconnects before returning', async () => {
    const notify = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    };
    const [protocolStatus, setProtocolStatus] = createSignal('connected');
    const onMaintenanceStarted = vi.fn();
    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        environmentDetailRequest: () => ({ source: 'controlplane', envId: 'env_disconnect' }),
        canAdmin: () => true,
        controlplaneStatus: () => 'online',
        protocolStatus,
        currentProcessStartedAtMs: () => 100,
        currentVersion: () => 'v1.0.0',
        notify,
        rpc: {
          sys: {
            upgrade: vi.fn(async () => ({ ok: true })),
            restart: vi.fn(async () => ({ ok: true })),
          },
        },
        startUpgradeRequest: async () => {
          setProtocolStatus('disconnected');
          throw new Error('connection closed');
        },
        onMaintenanceStarted,
        refetchCurrentVersion: async () => ({
          serverTimeMs: Date.now(),
          version: 'v1.0.0',
          processStartedAtMs: 100,
        }),
        getEnvironment: vi.fn().mockResolvedValue({ status: 'offline' }) as any,
      });
      return disposeRoot;
    });

    const promise = controller.startUpgrade('v1.1.0');
    try {
      await flushAsync();
      expect(onMaintenanceStarted).toHaveBeenCalledOnce();
      expect(onMaintenanceStarted).toHaveBeenCalledWith('upgrade');
      expect(notify.info).toHaveBeenCalledWith('Update started', 'Waiting for runtime restart...');
    } finally {
      dispose();
      await vi.advanceTimersByTimeAsync(1_500);
      await promise;
    }
  });

  it('allows a desktop-managed update request without a runtime release tag without pretending the version changed', async () => {
    const notify = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    };

    const [envId] = createSignal('env_desktop_ssh');
    const [canAdmin] = createSignal(true);
    const [controlplaneStatus] = createSignal('online');
    const [protocolStatus, setProtocolStatus] = createSignal('connected');
    const [currentProcessStartedAtMs] = createSignal<number | null>(100);
    const [currentVersion] = createSignal('v1.0.0');
    const [upgradeRequiresTargetVersion] = createSignal(false);
    const oldFailureCompletedAtMs = Date.now() - 60_000;

    const startUpgradeRequest = vi.fn(async (targetVersion: string) => {
      expect(targetVersion).toBe('');
      setProtocolStatus('disconnected');
      return { ok: true };
    });
    const getEnvironment = vi.fn()
      .mockResolvedValueOnce({ status: 'offline' })
      .mockImplementationOnce(async () => {
        setProtocolStatus('connected');
        return { status: 'online' };
      });
    const refetchCurrentVersion = vi.fn()
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.0.0', processStartedAtMs: 100 })
      .mockResolvedValueOnce({
        serverTimeMs: Date.now(),
        version: 'v1.0.0',
        processStartedAtMs: 200,
        maintenance: {
          kind: 'upgrade' as const,
          state: 'failed' as const,
          targetVersion: 'v9.9.9',
          observedVersion: 'v1.0.0',
          message: 'Old update failed.',
          completedAtMs: oldFailureCompletedAtMs,
        },
      });

    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        environmentDetailRequest: () => ({ source: 'controlplane', envId: envId() }),
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
        notify,
        rpc: {
          sys: {
            upgrade: vi.fn(async () => ({ ok: true })),
            restart: vi.fn(async () => ({ ok: true })),
          },
        },
        startUpgradeRequest,
        upgradeRequiresTargetVersion,
        refetchCurrentVersion,
        getEnvironment: getEnvironment as any,
      });
      return disposeRoot;
    });

    try {
      const promise = controller.startUpgrade('');
      await flushAsync();

      await vi.advanceTimersByTimeAsync(1_500);
      await flushAsync();
      await vi.advanceTimersByTimeAsync(1_500);
      await promise;

      expect(startUpgradeRequest).toHaveBeenCalledTimes(1);
      expect(controller.error()).toBe(null);
      expect(notify.success).toHaveBeenCalledWith('Desktop operation completed', 'Redeven Desktop finished the runtime update request.');
      expect(notify.error).not.toHaveBeenCalledWith('Update failed', 'Old update failed.');
      expect(notify.success).not.toHaveBeenCalledWith('Updated', expect.any(String));
      expect(notify.success).not.toHaveBeenCalledWith('Reconnected', 'The runtime is back online.');
    } finally {
      dispose();
    }
  });

  it('does not complete an upgrade when the runtime restarts with the previous version', async () => {
    const notify = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    };

    const [envId] = createSignal('env_upgrade_unchanged');
    const [canAdmin] = createSignal(true);
    const [controlplaneStatus] = createSignal('online');
    const [protocolStatus, setProtocolStatus] = createSignal('connected');
    const [currentProcessStartedAtMs] = createSignal<number | null>(100);
    const [currentVersion] = createSignal('v1.0.0');

    const upgrade = vi.fn(async () => {
      setProtocolStatus('disconnected');
      return { ok: true };
    });
    const getEnvironment = vi.fn()
      .mockResolvedValueOnce({ status: 'offline' })
      .mockImplementation(async () => {
        setProtocolStatus('connected');
        return { status: 'online' };
      });
    const refetchCurrentVersion = vi.fn()
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.0.0', processStartedAtMs: 100 })
      .mockResolvedValue({
        serverTimeMs: Date.now(),
        version: 'v1.0.0',
        processStartedAtMs: 200,
        runtimeService: { runtimeVersion: 'v1.0.0' },
      });

    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        environmentDetailRequest: () => ({ source: 'controlplane', envId: envId() }),
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
        notify,
        rpc: {
          sys: {
            upgrade,
            restart: vi.fn(async () => ({ ok: true })),
          },
        },
        refetchCurrentVersion,
        getEnvironment: getEnvironment as any,
      });
      return disposeRoot;
    });

    const promise = controller.startUpgrade('v1.1.0');
    try {
      await flushAsync();
      await flushAsync();

      expect(controller.kind()).toBe('upgrade');
      expect(controller.error()).toBe(null);
      expect(notify.success).not.toHaveBeenCalledWith('Updated', expect.any(String));
      expect(notify.success).not.toHaveBeenCalledWith('Reconnected', 'The runtime is back online.');
    } finally {
      dispose();
      await vi.advanceTimersByTimeAsync(1_500);
      await promise;
    }
  });

  it('requires the requested target version before declaring upgrade complete', async () => {
    const notify = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    };

    const [envId] = createSignal('env_upgrade_wrong_version');
    const [canAdmin] = createSignal(true);
    const [controlplaneStatus] = createSignal('online');
    const [protocolStatus] = createSignal('connected');
    const [currentProcessStartedAtMs] = createSignal<number | null>(100);
    const [currentVersion] = createSignal('v1.0.0');

    const refetchCurrentVersion = vi.fn()
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.0.0', processStartedAtMs: 100 })
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.0.1', processStartedAtMs: 200, runtimeService: { runtimeVersion: 'v1.0.1' } })
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.1.0', processStartedAtMs: 200, runtimeService: { runtimeVersion: 'v1.1.0' } });

    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        environmentDetailRequest: () => ({ source: 'controlplane', envId: envId() }),
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
        notify,
        rpc: {
          sys: {
            upgrade: vi.fn(async () => ({ ok: true })),
            restart: vi.fn(async () => ({ ok: true })),
          },
        },
        refetchCurrentVersion,
        getEnvironment: vi.fn().mockResolvedValue({ status: 'online' }) as any,
      });
      return disposeRoot;
    });

    try {
      const promise = controller.startUpgrade('v1.1.0');
      await flushAsync();
      await flushAsync();

      expect(controller.kind()).toBe('upgrade');
      expect(notify.success).not.toHaveBeenCalledWith('Updated', expect.any(String));

      await vi.advanceTimersByTimeAsync(1_500);
      await promise;

      expect(controller.kind()).toBe(null);
      expect(notify.success).toHaveBeenCalledWith('Updated', 'Redeven updated to v1.1.0.');
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
        environmentDetailRequest: () => ({ source: 'controlplane', envId: envId() }),
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
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
      expect(controller.kind()).toBe(null);
      expect(controller.error()).toBe(null);
      expect(notify.success).toHaveBeenCalledWith('Reconnected', 'The runtime is back online.');
    } finally {
      dispose();
    }
  });

  it('surfaces upgrade failure immediately when ping reports a failed maintenance snapshot', async () => {
    const notify = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    };

    const [envId] = createSignal('env_upgrade_failure');
    const [canAdmin] = createSignal(true);
    const [controlplaneStatus] = createSignal('online');
    const [protocolStatus] = createSignal('connected');
    const [currentProcessStartedAtMs] = createSignal<number | null>(100);
    const [currentVersion] = createSignal('v1.0.0');

    const upgrade = vi.fn(async () => ({ ok: true }));
    const getEnvironment = vi.fn().mockResolvedValue({ status: 'online' });
    const refetchCurrentVersion = vi.fn()
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.0.0', processStartedAtMs: 100 })
      .mockResolvedValueOnce({
        serverTimeMs: Date.now(),
        version: 'v1.0.0',
        processStartedAtMs: 100,
        maintenance: {
          kind: 'upgrade' as const,
          state: 'failed' as const,
          targetVersion: 'v1.1.0',
          message: 'Install failed: curl: (6) Could not resolve host.',
          completedAtMs: Date.now() + 1,
        },
      });

    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        environmentDetailRequest: () => ({ source: 'controlplane', envId: envId() }),
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
        notify,
        rpc: {
          sys: {
            upgrade,
            restart: vi.fn(async () => ({ ok: true })),
          },
        },
        refetchCurrentVersion,
        getEnvironment: getEnvironment as any,
      });
      return disposeRoot;
    });

    try {
      const promise = controller.startUpgrade('v1.1.0');
      await flushAsync();
      await vi.advanceTimersByTimeAsync(1_500);
      await promise;

      expect(upgrade).toHaveBeenCalledTimes(1);
      expect(controller.kind()).toBe(null);
      expect(controller.error()).toBe('Install failed: curl: (6) Could not resolve host.');
      expect(notify.error).toHaveBeenCalledWith('Update failed', 'Install failed: curl: (6) Could not resolve host.');
    } finally {
      dispose();
    }
  });

  it('surfaces failed maintenance even after process marker changes', async () => {
    const notify = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    };

    const [envId] = createSignal('env_upgrade_marker_failed');
    const [canAdmin] = createSignal(true);
    const [controlplaneStatus] = createSignal('online');
    const [protocolStatus] = createSignal('connected');
    const [currentProcessStartedAtMs] = createSignal<number | null>(100);
    const [currentVersion] = createSignal('v1.0.0');

    const refetchCurrentVersion = vi.fn()
      .mockResolvedValueOnce({ serverTimeMs: Date.now(), version: 'v1.0.0', processStartedAtMs: 100 })
      .mockResolvedValueOnce({
        serverTimeMs: Date.now(),
        version: 'v1.0.0',
        processStartedAtMs: 200,
        maintenance: {
          kind: 'upgrade' as const,
          state: 'failed' as const,
          targetVersion: 'v1.1.0',
          observedVersion: 'v1.0.0',
          message: 'Update did not take effect: Redeven is running v1.0.0 instead of v1.1.0.',
          completedAtMs: Date.now() + 1,
        },
      });

    let controller!: ReturnType<typeof createAgentMaintenanceController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createAgentMaintenanceController({
        environmentDetailRequest: () => ({ source: 'controlplane', envId: envId() }),
        canAdmin,
        controlplaneStatus,
        protocolStatus,
        currentProcessStartedAtMs,
        currentVersion,
        notify,
        rpc: {
          sys: {
            upgrade: vi.fn(async () => ({ ok: true })),
            restart: vi.fn(async () => ({ ok: true })),
          },
        },
        refetchCurrentVersion,
        getEnvironment: vi.fn().mockResolvedValue({ status: 'online' }) as any,
      });
      return disposeRoot;
    });

    try {
      const promise = controller.startUpgrade('v1.1.0');
      await flushAsync();
      await vi.advanceTimersByTimeAsync(1_500);
      await promise;

      expect(controller.kind()).toBe(null);
      expect(controller.error()).toBe('Update did not take effect: Redeven is running v1.0.0 instead of v1.1.0.');
      expect(notify.error).toHaveBeenCalledWith('Update failed', 'Update did not take effect: Redeven is running v1.0.0 instead of v1.1.0.');
      expect(notify.success).not.toHaveBeenCalledWith('Updated', expect.any(String));
    } finally {
      dispose();
    }
  });
});
