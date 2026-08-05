import type { PluginReleaseInstallOperation } from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { createPluginInstallCoordinator } from './pluginInstallCoordinator';

const pluginID = 'com.example.official.toolbox';
const pluginInstanceID = 'plugini_example_official_toolbox';

function operation(
  overrides: Partial<PluginReleaseInstallOperation> = {},
): PluginReleaseInstallOperation {
  return {
    request_id: 'request-install-1',
    operation_id: 'release_install_1',
    plugin_instance_id: pluginInstanceID,
    request_sha256: 'a'.repeat(64),
    status: 'running',
    phase: 'download_package',
    progress: { kind: 'bytes', completed: 1, total: 2 },
    attempt: 1,
    retry_after_ms: 250,
    mutation_outcome: 'not_committed',
    created_at: '2026-08-05T08:00:00Z',
    updated_at: '2026-08-05T08:00:01Z',
    ...overrides,
  } as PluginReleaseInstallOperation;
}

function harness() {
  let nextRequest = 0;
  const lifecycle = {
    installOfficialRelease: vi.fn(),
    listReleaseInstallOperations: vi.fn(async () => [] as PluginReleaseInstallOperation[]),
    getReleaseInstallOperationByRequest: vi.fn(async () => operation()),
    watchReleaseInstallOperation: vi.fn(),
  };
  const refreshInventory = vi.fn(async () => undefined);
  const coordinator = createPluginInstallCoordinator({
    lifecycle,
    refreshInventory,
    createRequestID: () => `request-install-${++nextRequest}`,
    resolvePluginID: (instanceID) => instanceID === pluginInstanceID ? pluginID : undefined,
  });
  return { coordinator, lifecycle, refreshInventory };
}

describe('plugin install coordinator', () => {
  it('projects authoritative progress and admits one installation submission at a time', async () => {
    const { coordinator, lifecycle } = harness();
    let finish!: (value: PluginReleaseInstallOperation) => void;
    lifecycle.installOfficialRelease.mockImplementation(async (
      _command,
      requestID,
      _options,
      onUpdate,
    ) => {
      onUpdate(operation({ request_id: requestID }));
      return new Promise<PluginReleaseInstallOperation>((resolve) => { finish = resolve; });
    });

    const first = coordinator.start(pluginID, pluginInstanceID);
    const duplicate = coordinator.start(pluginID, pluginInstanceID);
    await Promise.resolve();

    expect(lifecycle.installOfficialRelease).toHaveBeenCalledTimes(1);
    expect(coordinator.projections()).toEqual([
      expect.objectContaining({
        pluginInstanceID,
        requestID: 'request-install-1',
        observation: 'watching',
        operation: expect.objectContaining({
          phase: 'download_package',
          progress: { kind: 'bytes', completed: 1, total: 2 },
        }),
      }),
    ]);

    finish(operation({
      request_id: 'request-install-1',
      status: 'failed',
      phase: 'failed',
      progress: { kind: 'indeterminate' },
      failure: { code: 'PLUGIN_RELEASE_NETWORK', retryable: true },
    }));
    await expect(first).resolves.toBeUndefined();
    await expect(duplicate).resolves.toBeUndefined();
  });

  it('reattaches an active operation listed after the Plugin Center reopens', async () => {
    const { coordinator, lifecycle, refreshInventory } = harness();
    lifecycle.listReleaseInstallOperations.mockResolvedValueOnce([operation()]);
    lifecycle.watchReleaseInstallOperation.mockImplementation(async (_operationID, _options, onUpdate) => {
      const completed = operation({
        status: 'succeeded',
        phase: 'complete',
        progress: { kind: 'items', completed: 1, total: 1 },
        mutation_outcome: 'committed',
      });
      onUpdate(completed);
      return completed;
    });

    await coordinator.resume();

    expect(lifecycle.watchReleaseInstallOperation).toHaveBeenCalledWith(
      'release_install_1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.any(Function),
    );
    expect(refreshInventory).toHaveBeenCalledOnce();
    expect(coordinator.projections()).toEqual([]);
  });

  it('restores a recent terminal failure after the Env App reopens', async () => {
    const { coordinator, lifecycle } = harness();
    const terminalAt = new Date(Date.now() - 60_000).toISOString();
    lifecycle.listReleaseInstallOperations.mockResolvedValueOnce([operation({
      status: 'failed',
      phase: 'failed',
      progress: { kind: 'indeterminate' },
      failure: { code: 'PLUGIN_RELEASE_REF_VERIFICATION_FAILED', retryable: false },
      updated_at: terminalAt,
      terminal_at: terminalAt,
    })]);

    await coordinator.resume();

    expect(lifecycle.watchReleaseInstallOperation).not.toHaveBeenCalled();
    expect(coordinator.projections()).toEqual([
      expect.objectContaining({
        pluginID,
        pluginInstanceID,
        observation: 'watching',
        operation: expect.objectContaining({
          status: 'failed',
          failure: { code: 'PLUGIN_RELEASE_REF_VERIFICATION_FAILED', retryable: false },
        }),
      }),
    ]);
  });

  it('does not restore stale or superseded terminal failures', async () => {
    const { coordinator, lifecycle } = harness();
    const staleTerminalAt = new Date(Date.now() - (25 * 60 * 60 * 1_000)).toISOString();
    const recentTerminalAt = new Date(Date.now() - 60_000).toISOString();
    lifecycle.listReleaseInstallOperations.mockResolvedValueOnce([
      operation({
        operation_id: 'release_install_stale',
        status: 'failed',
        phase: 'failed',
        progress: { kind: 'indeterminate' },
        failure: { code: 'PLUGIN_RELEASE_NETWORK', retryable: true },
        updated_at: staleTerminalAt,
        terminal_at: staleTerminalAt,
      }),
      operation({
        operation_id: 'release_install_recent_failure',
        created_at: '2026-08-05T08:01:00Z',
        status: 'failed',
        phase: 'failed',
        progress: { kind: 'indeterminate' },
        failure: { code: 'PLUGIN_RELEASE_TIMEOUT', retryable: true },
        updated_at: recentTerminalAt,
        terminal_at: recentTerminalAt,
      }),
      operation({
        operation_id: 'release_install_later_success',
        created_at: '2026-08-05T08:02:00Z',
        status: 'succeeded',
        phase: 'complete',
        progress: { kind: 'items', completed: 1, total: 1 },
        mutation_outcome: 'committed',
        updated_at: recentTerminalAt,
        terminal_at: recentTerminalAt,
      }),
    ]);

    await coordinator.resume();

    expect(lifecycle.getReleaseInstallOperationByRequest).not.toHaveBeenCalled();
    expect(lifecycle.watchReleaseInstallOperation).not.toHaveBeenCalled();
    expect(coordinator.projections()).toEqual([]);
  });

  it('orders RFC3339Nano operation timestamps by time rather than text', async () => {
    const { coordinator, lifecycle } = harness();
    const terminalAt = new Date(Date.now() - 60_000).toISOString();
    lifecycle.listReleaseInstallOperations.mockResolvedValueOnce([
      operation({
        operation_id: 'release_install_exact_second',
        created_at: '2026-08-05T08:01:00Z',
        status: 'succeeded',
        phase: 'complete',
        progress: { kind: 'items', completed: 1, total: 1 },
        mutation_outcome: 'committed',
        updated_at: '2026-08-05T08:01:00Z',
        terminal_at: '2026-08-05T08:01:00Z',
      }),
      operation({
        operation_id: 'release_install_fractional_second',
        created_at: '2026-08-05T08:01:00.500Z',
        status: 'failed',
        phase: 'failed',
        progress: { kind: 'indeterminate' },
        failure: { code: 'PLUGIN_RELEASE_NETWORK', retryable: true },
        updated_at: terminalAt,
        terminal_at: terminalAt,
      }),
    ]);

    await coordinator.resume();

    expect(coordinator.projections()[0]?.operation?.operation_id).toBe(
      'release_install_fractional_second',
    );
  });

  it('reattaches the same request after a transport interruption without creating a new install', async () => {
    const { coordinator, lifecycle } = harness();
    lifecycle.installOfficialRelease.mockRejectedValueOnce(new TypeError('connection lost'));
    lifecycle.getReleaseInstallOperationByRequest.mockResolvedValueOnce(operation());
    lifecycle.watchReleaseInstallOperation.mockResolvedValueOnce(operation({
      status: 'failed',
      phase: 'failed',
      progress: { kind: 'indeterminate' },
      failure: { code: 'PLUGIN_INSTALL_INTERRUPTED', retryable: true },
    }));

    await coordinator.start(pluginID, pluginInstanceID);

    expect(lifecycle.installOfficialRelease).toHaveBeenCalledTimes(1);
    expect(lifecycle.getReleaseInstallOperationByRequest).toHaveBeenCalledWith(
      'request-install-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(coordinator.projections()[0]).toMatchObject({
      requestID: 'request-install-1',
      operation: {
        status: 'failed',
        failure: { code: 'PLUGIN_INSTALL_INTERRUPTED', retryable: true },
      },
    });
  });

  it('reports inventory refresh failure separately from a committed installation', async () => {
    const { coordinator, lifecycle, refreshInventory } = harness();
    const completed = operation({
      status: 'succeeded',
      phase: 'complete',
      progress: { kind: 'items', completed: 1, total: 1 },
      mutation_outcome: 'committed',
    });
    lifecycle.installOfficialRelease.mockResolvedValueOnce(completed);
    refreshInventory.mockRejectedValueOnce(new Error('inventory unavailable'));

    await coordinator.start(pluginID, pluginInstanceID);

    expect(coordinator.projections()[0]).toMatchObject({
      observation: 'refresh_failed',
      operation: { status: 'succeeded', mutation_outcome: 'committed' },
    });
    await coordinator.retry(pluginInstanceID);
    expect(refreshInventory).toHaveBeenCalledTimes(2);
    expect(lifecycle.installOfficialRelease).toHaveBeenCalledTimes(1);
    expect(coordinator.projections()).toEqual([]);
  });

  it('uses a new request only after a retryable terminal failure', async () => {
    const { coordinator, lifecycle } = harness();
    lifecycle.installOfficialRelease
      .mockResolvedValueOnce(operation({
        status: 'failed',
        phase: 'failed',
        progress: { kind: 'indeterminate' },
        failure: { code: 'PLUGIN_RELEASE_NETWORK', retryable: true },
      }))
      .mockResolvedValueOnce(operation({
        request_id: 'request-install-2',
        operation_id: 'release_install_2',
        status: 'failed',
        phase: 'failed',
        progress: { kind: 'indeterminate' },
        failure: { code: 'PLUGIN_RELEASE_TIMEOUT', retryable: true },
      }));

    await coordinator.start(pluginID, pluginInstanceID);
    await coordinator.retry(pluginInstanceID);

    expect(lifecycle.installOfficialRelease).toHaveBeenNthCalledWith(
      1,
      { type: 'install', pluginID, source: 'official_catalog' },
      'request-install-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.any(Function),
    );
    expect(lifecycle.installOfficialRelease).toHaveBeenNthCalledWith(
      2,
      { type: 'install', pluginID, source: 'official_catalog' },
      'request-install-2',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.any(Function),
    );
  });
});
