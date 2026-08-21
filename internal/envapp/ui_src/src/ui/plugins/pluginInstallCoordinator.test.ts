import { PluginPlatformRequestError, PluginTransportError, type PluginEvent, type PluginExecution, type PluginReleasePackageInspection } from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { createPluginInstallCoordinator } from './pluginInstallCoordinator';

const pluginInstanceID = 'plugini_redeven_official_containers';

function inspection(id = 'release_inspection_1'): PluginReleasePackageInspection {
  return {
    inspection_id: id,
    expires_at: '2099-08-21T00:05:00Z',
    plugin_instance_id: pluginInstanceID,
  } as PluginReleasePackageInspection;
}

function execution(overrides: Partial<PluginExecution> = {}): PluginExecution {
  return {
    execution_id: 'release_install_1',
    plugin_instance_id: pluginInstanceID,
    kind: 'operation',
    status: 'completed',
    cursor: 1,
    cancelable: false,
    created_at: '2026-08-14T00:00:00Z',
    updated_at: '2026-08-14T00:00:01Z',
    terminal_at: '2026-08-14T00:00:01Z',
    ...overrides,
  };
}

function event(sequence = 1): PluginEvent {
  return {
    execution_id: 'release_install_1',
    sequence,
    kind: 'progress',
    payload: { phase: 'download_package', progress: { kind: 'bytes', completed: 5, total: 10 } },
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const {
    completeApprovedInstall: completeApprovedInstallOverride,
    ...lifecycleOverrides
  } = overrides;
  const lifecycle = {
    installOfficialRelease: vi.fn(async (_command, _inspection, _requestID, _options, onUpdate) => {
      const value = execution();
      onUpdate?.(value, [event()]);
      return value;
    }),
    listReleaseInstallExecutions: vi.fn(async () => [] as PluginExecution[]),
    getReleaseInstallExecution: vi.fn(async () => execution()),
    listReleaseInstallExecutionEvents: vi.fn(async () => ({
      execution_id: 'release_install_1', events: [event()], cursor: 1,
    })),
    deleteIncompatibleRetainedData: vi.fn(async () => undefined),
    inspectOfficialRelease: vi.fn(async () => inspection('release_inspection_fresh')),
    ...lifecycleOverrides,
  };
  const refreshInventory = vi.fn(async () => undefined);
  const refreshMarket = vi.fn(async () => undefined);
  let requestSequence = 0;
  const createRequestID = vi.fn(() => `request-${++requestSequence}`);
  const completeApprovedInstall = typeof completeApprovedInstallOverride === 'function'
    ? completeApprovedInstallOverride as (pluginInstanceID: string, signal?: AbortSignal) => Promise<'ready' | 'superseded'>
    : vi.fn(async () => 'ready' as const);
  const installFence = { managementRevision: 11, generation: 1 };
  const captureInstallRetirementFence = vi.fn(() => installFence);
  const onInstallReady = vi.fn();
  const coordinator = createPluginInstallCoordinator({
    lifecycle: lifecycle as never,
    refreshInventory,
    refreshMarket,
    completeApprovedInstall,
    captureInstallRetirementFence,
    onInstallReady,
    createRequestID,
    resolvePluginID: (candidate) => candidate === pluginInstanceID ? 'com.redeven.official.containers' : undefined,
  });
  return {
    coordinator,
    lifecycle,
    refreshInventory,
    refreshMarket,
    completeApprovedInstall,
    captureInstallRetirementFence,
    installFence,
    onInstallReady,
    createRequestID,
  };
}

describe('plugin install execution coordinator', () => {
  it('submits one Host execution and removes presentation after authoritative inventory refresh', async () => {
    const { coordinator, lifecycle, refreshInventory, completeApprovedInstall, installFence, onInstallReady } = harness();

    await coordinator.start('com.redeven.official.containers', pluginInstanceID, inspection());

    expect(lifecycle.installOfficialRelease).toHaveBeenCalledOnce();
    expect(refreshInventory).toHaveBeenCalledOnce();
    expect(completeApprovedInstall).toHaveBeenCalledWith(pluginInstanceID, expect.any(AbortSignal));
    expect(onInstallReady).toHaveBeenCalledWith(pluginInstanceID, installFence);
    expect(coordinator.projections()).toEqual([]);
  });

  it('does not replay successful post-install setup when the completed execution is listed again', async () => {
    const completed = execution();
    const { coordinator, completeApprovedInstall, onInstallReady } = harness({
      listReleaseInstallExecutions: vi.fn(async () => [completed]),
    });

    await coordinator.start('com.redeven.official.containers', pluginInstanceID, inspection());
    await coordinator.resume();

    expect(completeApprovedInstall).toHaveBeenCalledOnce();
    expect(onInstallReady).toHaveBeenCalledOnce();
    expect(coordinator.projections()).toEqual([]);
  });

  it('does not clear an install fence when later lifecycle intent supersedes setup', async () => {
    const completeApprovedInstall = vi.fn(async () => 'superseded' as const);
    const { coordinator, onInstallReady } = harness({ completeApprovedInstall });

    await coordinator.start('com.redeven.official.containers', pluginInstanceID, inspection());

    expect(completeApprovedInstall).toHaveBeenCalledOnce();
    expect(onInstallReady).not.toHaveBeenCalled();
    expect(coordinator.projections()).toEqual([]);
  });

  it('keeps the unified failed execution as the retry authority', async () => {
    const failed = execution({ status: 'failed', failure_code: 'PLUGIN_RELEASE_NETWORK' });
    const { coordinator } = harness({
      installOfficialRelease: vi.fn(async (_command, _inspection, _requestID, _options, onUpdate) => {
        onUpdate?.(failed, []);
        return failed;
      }),
    });

    await coordinator.start('com.redeven.official.containers', pluginInstanceID, inspection());

    expect(coordinator.projections()).toEqual([
      expect.objectContaining({
        pluginInstanceID,
        observation: 'failed',
        execution: failed,
        events: [],
      }),
    ]);
  });

  it.each(['unknown', 'not_committed'] as const)(
    'replays the same request and inspection after a %s submission transport failure',
    async (mutationOutcome) => {
      const installOfficialRelease = vi.fn()
        .mockRejectedValueOnce(new PluginTransportError(
          'release install response was not available',
          new Error('connection reset'),
          mutationOutcome,
        ))
        .mockResolvedValueOnce(execution());
      const { coordinator, createRequestID } = harness({ installOfficialRelease });
      const reviewed = inspection('release_inspection_reviewed');

      await coordinator.start('com.redeven.official.containers', pluginInstanceID, reviewed);
      expect(coordinator.projections()[0]).toMatchObject({
        observation: 'failed',
        startFailure: { code: 'PLUGIN_RELEASE_NETWORK', retryable: true },
        submission: { requestID: 'request-1', retrySameRequest: true },
      });

      await coordinator.retry(pluginInstanceID);

      expect(createRequestID).toHaveBeenCalledOnce();
      expect(installOfficialRelease).toHaveBeenCalledTimes(2);
      expect(installOfficialRelease.mock.calls[0]?.[1]).toBe(reviewed);
      expect(installOfficialRelease.mock.calls[1]?.[1]).toBe(reviewed);
      expect(installOfficialRelease.mock.calls[0]?.[2]).toBe('request-1');
      expect(installOfficialRelease.mock.calls[1]?.[2]).toBe('request-1');
      expect(coordinator.projections()).toEqual([]);
    },
  );

  it('acquires fresh evidence after same-request recovery reports that the old evidence expired', async () => {
    const installOfficialRelease = vi.fn()
      .mockRejectedValueOnce(new PluginTransportError(
        'release install response was not available',
        new Error('connection reset'),
        'unknown',
      ))
      .mockRejectedValueOnce(new PluginPlatformRequestError(
        'PLUGIN_RELEASE_INSPECTION_EXPIRED',
        'inspection expired',
      ))
      .mockResolvedValueOnce(execution());
    const { coordinator, lifecycle, createRequestID } = harness({ installOfficialRelease });

    await coordinator.start(
      'com.redeven.official.containers',
      pluginInstanceID,
      inspection('release_inspection_old'),
    );
    await coordinator.retry(pluginInstanceID);
    expect(coordinator.projections()[0]).toMatchObject({
      startFailure: { code: 'PLUGIN_RELEASE_INSPECTION_EXPIRED', retryable: true },
      submission: { requestID: 'request-1', retrySameRequest: false },
    });

    await coordinator.retry(pluginInstanceID);

    expect(lifecycle.inspectOfficialRelease).toHaveBeenCalledOnce();
    expect(createRequestID).toHaveBeenCalledTimes(2);
    expect(installOfficialRelease.mock.calls[2]?.[1]).toMatchObject({
      inspection_id: 'release_inspection_fresh',
    });
    expect(installOfficialRelease.mock.calls[2]?.[2]).toBe('request-2');
  });

  it('preserves a stable platform error even when the rejected mutation is explicitly not committed', async () => {
    const installOfficialRelease = vi.fn().mockRejectedValueOnce(new PluginPlatformRequestError(
      'PLUGIN_ACTION_DENIED',
      'installation is denied',
      {},
      'not_committed',
    ));
    const { coordinator } = harness({ installOfficialRelease });

    await coordinator.start(
      'com.redeven.official.containers',
      pluginInstanceID,
      inspection('release_inspection_denied'),
    );

    expect(coordinator.projections()[0]).toMatchObject({
      observation: 'failed',
      startFailure: { code: 'PLUGIN_ACTION_DENIED', retryable: false },
      submission: { retrySameRequest: false },
    });
  });

  it('deletes confirmed incompatible retained data before starting a new install execution', async () => {
    const failed = execution({ status: 'failed', failure_code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE' });
    const installOfficialRelease = vi.fn()
      .mockImplementationOnce(async (_command, _inspection, _requestID, _options, onUpdate) => {
        onUpdate?.(failed, []);
        return failed;
      })
      .mockResolvedValueOnce(execution());
    const { coordinator, lifecycle } = harness({ installOfficialRelease });

    await coordinator.start('com.redeven.official.containers', pluginInstanceID, inspection());
    await coordinator.discardRetainedDataAndRetry(pluginInstanceID);

    expect(lifecycle.deleteIncompatibleRetainedData).toHaveBeenCalledWith(pluginInstanceID);
    expect(lifecycle.inspectOfficialRelease).toHaveBeenCalledWith(
      'com.redeven.official.containers',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(installOfficialRelease).toHaveBeenCalledTimes(2);
    expect(installOfficialRelease.mock.calls[1]?.[1]).toMatchObject({
      inspection_id: 'release_inspection_fresh',
    });
    expect(coordinator.projections()).toEqual([]);
  });

  it('refreshes the market and obtains fresh evidence when the reviewed release became stale', async () => {
    const stale = execution({ status: 'failed', failure_code: 'PLUGIN_RELEASE_INSPECTION_STALE' });
    const installOfficialRelease = vi.fn()
      .mockImplementationOnce(async (_command, _inspection, _requestID, _options, onUpdate) => {
        onUpdate?.(stale, []);
        return stale;
      })
      .mockResolvedValueOnce(execution());
    const { coordinator, lifecycle, refreshMarket } = harness({ installOfficialRelease });

    await coordinator.start('com.redeven.official.containers', pluginInstanceID, inspection('release_inspection_old'));
    await coordinator.retry(pluginInstanceID);

    expect(refreshMarket).toHaveBeenCalledOnce();
    expect(lifecycle.inspectOfficialRelease).toHaveBeenCalledOnce();
    expect(installOfficialRelease.mock.calls[1]?.[1]).toMatchObject({
      inspection_id: 'release_inspection_fresh',
    });
  });

  it('obtains fresh evidence without refreshing the market when inspection evidence expires', async () => {
    const expired = execution({ status: 'failed', failure_code: 'PLUGIN_RELEASE_INSPECTION_EXPIRED' });
    const installOfficialRelease = vi.fn()
      .mockImplementationOnce(async (_command, _inspection, _requestID, _options, onUpdate) => {
        onUpdate?.(expired, []);
        return expired;
      })
      .mockResolvedValueOnce(execution());
    const { coordinator, lifecycle, refreshMarket } = harness({ installOfficialRelease });

    await coordinator.start('com.redeven.official.containers', pluginInstanceID, inspection('release_inspection_expired'));
    await coordinator.retry(pluginInstanceID);

    expect(refreshMarket).not.toHaveBeenCalled();
    expect(lifecycle.inspectOfficialRelease).toHaveBeenCalledOnce();
    expect(installOfficialRelease.mock.calls[1]?.[1]).toMatchObject({
      inspection_id: 'release_inspection_fresh',
    });
  });

  it('retains public Execution events when inventory refresh needs retry', async () => {
    const refreshInventory = vi.fn(async () => { throw new Error('offline'); });
    const lifecycle = {
      installOfficialRelease: vi.fn(async (_command: unknown, _inspection: unknown, _requestID: string, _options: unknown, onUpdate?: (value: PluginExecution, events: PluginEvent[]) => void) => {
        const value = execution();
        onUpdate?.(value, [event()]);
        return value;
      }),
      listReleaseInstallExecutions: vi.fn(async () => [] as PluginExecution[]),
      getReleaseInstallExecution: vi.fn(async () => execution()),
      listReleaseInstallExecutionEvents: vi.fn(async () => ({ execution_id: 'release_install_1', events: [], cursor: 1 })),
      inspectOfficialRelease: vi.fn(async () => inspection('release_inspection_fresh')),
    };
    const coordinator = createPluginInstallCoordinator({
      lifecycle: lifecycle as never,
      refreshInventory,
      refreshMarket: vi.fn(async () => undefined),
      completeApprovedInstall: vi.fn(async () => 'ready' as const),
      captureInstallRetirementFence: vi.fn(() => undefined),
      onInstallReady: vi.fn(),
      createRequestID: () => 'request-1',
      resolvePluginID: () => 'com.redeven.official.containers',
    });

    await coordinator.start('com.redeven.official.containers', pluginInstanceID, inspection());

    expect(coordinator.projections()[0]).toMatchObject({
      observation: 'refresh_failed',
      execution: { execution_id: 'release_install_1', status: 'completed' },
      events: [{ sequence: 1, kind: 'progress' }],
    });
  });

  it('keeps a committed install retryable when approved permission setup fails', async () => {
    const completeApprovedInstall = vi.fn()
      .mockRejectedValueOnce(new Error('grant failed'))
      .mockResolvedValueOnce('ready' as const);
    const { coordinator, onInstallReady } = harness({ completeApprovedInstall });

    await coordinator.start('com.redeven.official.containers', pluginInstanceID, inspection());

    expect(coordinator.projections()[0]).toMatchObject({
      pluginInstanceID,
      observation: 'activation_failed',
      execution: { status: 'completed' },
    });
    expect(onInstallReady).not.toHaveBeenCalled();
    await coordinator.retry(pluginInstanceID);
    expect(completeApprovedInstall).toHaveBeenCalledTimes(2);
    expect(onInstallReady).toHaveBeenCalledOnce();
    expect(coordinator.projections()).toEqual([]);
  });

  it('retries the complete approved setup after an inventory refresh failure', async () => {
    const { coordinator, refreshInventory, completeApprovedInstall } = harness();
    refreshInventory.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);

    await coordinator.start('com.redeven.official.containers', pluginInstanceID, inspection());
    await coordinator.retry(pluginInstanceID);

    expect(refreshInventory).toHaveBeenCalledTimes(2);
    expect(completeApprovedInstall).toHaveBeenCalledOnce();
    expect(coordinator.projections()).toEqual([]);
  });

  it('finishes a completed install after the UI restarts', async () => {
    const completed = execution();
    const { coordinator, refreshInventory, completeApprovedInstall, onInstallReady } = harness({
      listReleaseInstallExecutions: vi.fn(async () => [completed]),
    });

    await coordinator.resume();

    expect(refreshInventory).toHaveBeenCalledOnce();
    expect(completeApprovedInstall).toHaveBeenCalledWith(pluginInstanceID, undefined);
    expect(onInstallReady).not.toHaveBeenCalled();
    expect(coordinator.projections()).toEqual([]);
  });
});
