import type { PluginEvent, PluginExecution } from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { createPluginInstallCoordinator } from './pluginInstallCoordinator';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';

const pluginInstanceID = 'plugini_redeven_official_containers';
const installCommand = {
  type: 'install' as const,
  pluginID: 'com.redeven.official.containers',
  source: 'official_catalog' as const,
  pluginInstanceID,
  releaseRef: OFFICIAL_CONTAINERS_RELEASE_REF,
  releaseIdentityDigest: 'sha256:' + 'a'.repeat(64),
  manifestSHA256: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes.manifest_sha256,
  contractSetSHA256: 'sha256:' + 'b'.repeat(64),
  summarySHA256: 'sha256:' + 'c'.repeat(64),
};

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
    installOfficialRelease: vi.fn(async (_command, _requestID, _options, onUpdate) => {
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
    ...lifecycleOverrides,
  };
  const refreshInventory = vi.fn(async () => undefined);
  const completeApprovedInstall = typeof completeApprovedInstallOverride === 'function'
    ? completeApprovedInstallOverride as (pluginInstanceID: string, signal?: AbortSignal) => Promise<unknown>
    : vi.fn(async () => undefined);
  const coordinator = createPluginInstallCoordinator({
    lifecycle: lifecycle as never,
    refreshInventory,
    completeApprovedInstall,
    createRequestID: () => 'request-1',
    resolvePluginID: (candidate) => candidate === pluginInstanceID ? 'com.redeven.official.containers' : undefined,
  });
  return { coordinator, lifecycle, refreshInventory, completeApprovedInstall };
}

describe('plugin install execution coordinator', () => {
  it('submits one Host execution and removes presentation after authoritative inventory refresh', async () => {
    const { coordinator, lifecycle, refreshInventory, completeApprovedInstall } = harness();

    await coordinator.start(installCommand);

    expect(lifecycle.installOfficialRelease).toHaveBeenCalledOnce();
    expect(refreshInventory).toHaveBeenCalledOnce();
    expect(completeApprovedInstall).toHaveBeenCalledWith(pluginInstanceID, expect.any(AbortSignal));
    expect(coordinator.projections()).toEqual([]);
  });

  it('keeps the unified failed execution as the retry authority', async () => {
    const failed = execution({ status: 'failed', failure_code: 'PLUGIN_RELEASE_NETWORK' });
    const { coordinator } = harness({
      installOfficialRelease: vi.fn(async (_command, _requestID, _options, onUpdate) => {
        onUpdate?.(failed, []);
        return failed;
      }),
    });

    await coordinator.start(installCommand);

    expect(coordinator.projections()).toEqual([
      expect.objectContaining({
        pluginInstanceID,
        observation: 'failed',
        execution: failed,
        events: [],
      }),
    ]);
  });

  it('deletes confirmed incompatible retained data before starting a new install execution', async () => {
    const failed = execution({ status: 'failed', failure_code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE' });
    const installOfficialRelease = vi.fn()
      .mockImplementationOnce(async (_command, _requestID, _options, onUpdate) => {
        onUpdate?.(failed, []);
        return failed;
      })
      .mockResolvedValueOnce(execution());
    const { coordinator, lifecycle } = harness({ installOfficialRelease });

    await coordinator.start(installCommand);
    await coordinator.discardRetainedDataAndRetry(pluginInstanceID);

    expect(lifecycle.deleteIncompatibleRetainedData).toHaveBeenCalledWith(pluginInstanceID);
    expect(installOfficialRelease).toHaveBeenCalledTimes(2);
    expect(coordinator.projections()).toEqual([]);
  });

  it('retains public Execution events when inventory refresh needs retry', async () => {
    const refreshInventory = vi.fn(async () => { throw new Error('offline'); });
    const lifecycle = {
      installOfficialRelease: vi.fn(async (_command: unknown, _requestID: string, _options: unknown, onUpdate?: (value: PluginExecution, events: PluginEvent[]) => void) => {
        const value = execution();
        onUpdate?.(value, [event()]);
        return value;
      }),
      listReleaseInstallExecutions: vi.fn(async () => [] as PluginExecution[]),
      getReleaseInstallExecution: vi.fn(async () => execution()),
      listReleaseInstallExecutionEvents: vi.fn(async () => ({ execution_id: 'release_install_1', events: [], cursor: 1 })),
    };
    const coordinator = createPluginInstallCoordinator({
      lifecycle: lifecycle as never,
      refreshInventory,
      completeApprovedInstall: vi.fn(async () => undefined),
      createRequestID: () => 'request-1',
      resolvePluginID: () => 'com.redeven.official.containers',
    });

    await coordinator.start(installCommand);

    expect(coordinator.projections()[0]).toMatchObject({
      observation: 'refresh_failed',
      execution: { execution_id: 'release_install_1', status: 'completed' },
      events: [{ sequence: 1, kind: 'progress' }],
    });
  });

  it('keeps a committed install retryable when approved permission setup fails', async () => {
    const completeApprovedInstall = vi.fn()
      .mockRejectedValueOnce(new Error('grant failed'))
      .mockResolvedValueOnce(undefined);
    const { coordinator } = harness({ completeApprovedInstall });

    await coordinator.start(installCommand);

    expect(coordinator.projections()[0]).toMatchObject({
      pluginInstanceID,
      observation: 'activation_failed',
      execution: { status: 'completed' },
    });
    await coordinator.retry(pluginInstanceID);
    expect(completeApprovedInstall).toHaveBeenCalledTimes(2);
    expect(coordinator.projections()).toEqual([]);
  });

  it('forgets the completed install projection when the plugin is uninstalled', async () => {
    const completeApprovedInstall = vi.fn().mockRejectedValue(new Error('grant failed'));
    const { coordinator } = harness({ completeApprovedInstall });

    await coordinator.start(installCommand);
    expect(coordinator.projections()).toHaveLength(1);

    coordinator.forget(pluginInstanceID);

    expect(coordinator.projections()).toEqual([]);
  });

  it('retries the complete approved setup after an inventory refresh failure', async () => {
    const { coordinator, refreshInventory, completeApprovedInstall } = harness();
    refreshInventory.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);

    await coordinator.start(installCommand);
    await coordinator.retry(pluginInstanceID);

    expect(refreshInventory).toHaveBeenCalledTimes(2);
    expect(completeApprovedInstall).toHaveBeenCalledOnce();
    expect(coordinator.projections()).toEqual([]);
  });

  it('finishes a completed install after the UI restarts', async () => {
    const completed = execution();
    const { coordinator, refreshInventory, completeApprovedInstall } = harness({
      listReleaseInstallExecutions: vi.fn(async () => [completed]),
    });

    await coordinator.resume();

    expect(refreshInventory).toHaveBeenCalledOnce();
    expect(completeApprovedInstall).toHaveBeenCalledWith(pluginInstanceID, undefined);
    expect(coordinator.projections()).toEqual([]);
  });

  it('does not resurrect a completed execution after the installed instance was removed', async () => {
    const completed = execution();
    const { coordinator, refreshInventory, completeApprovedInstall } = harness({
      listReleaseInstallExecutions: vi.fn(async () => [completed]),
    });
    const guarded = createPluginInstallCoordinator({
      lifecycle: {
        listReleaseInstallExecutions: vi.fn(async () => [completed]),
        installOfficialRelease: vi.fn(),
        getReleaseInstallExecution: vi.fn(),
        listReleaseInstallExecutionEvents: vi.fn(),
        deleteIncompatibleRetainedData: vi.fn(),
      } as never,
      refreshInventory,
      completeApprovedInstall,
      createRequestID: () => 'request-1',
      resolvePluginID: () => 'com.redeven.official.containers',
      isPluginInstalled: () => false,
    });

    await guarded.resume();

    expect(refreshInventory).not.toHaveBeenCalled();
    expect(completeApprovedInstall).not.toHaveBeenCalled();
    expect(guarded.projections()).toEqual([]);
  });

  it('ignores a durable execution after uninstall until a new install starts', async () => {
    const completed = execution();
    const lifecycle = {
      installOfficialRelease: vi.fn(async () => completed),
      listReleaseInstallExecutions: vi.fn(async () => [completed]),
      getReleaseInstallExecution: vi.fn(async () => completed),
      listReleaseInstallExecutionEvents: vi.fn(async () => ({ execution_id: completed.execution_id, events: [], cursor: completed.cursor })),
      deleteIncompatibleRetainedData: vi.fn(async () => undefined),
    };
    const coordinator = createPluginInstallCoordinator({
      lifecycle: lifecycle as never,
      refreshInventory: vi.fn(async () => undefined),
      completeApprovedInstall: vi.fn(async () => undefined),
      createRequestID: () => 'request-1',
      resolvePluginID: () => 'com.redeven.official.containers',
    });

    coordinator.forget(pluginInstanceID);
    await coordinator.resume();

    expect(coordinator.projections()).toEqual([]);
  });
});
