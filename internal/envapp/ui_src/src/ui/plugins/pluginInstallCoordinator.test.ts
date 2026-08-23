import type { PluginEvent, PluginExecution } from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { createPluginInstallCoordinator } from './pluginInstallCoordinator';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';

const pluginInstanceID = 'plugini_redeven_official_containers';
const pluginID = 'com.redeven.official.containers';
const installCommand = {
  type: 'install' as const,
  pluginID,
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
    status: 'running',
    cursor: 0,
    cancelable: false,
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:01Z',
    ...overrides,
  };
}

function terminalEvent(input: Readonly<{
  executionID?: string;
  requestID?: string;
  status?: 'completed' | 'failed';
  code?: string;
  retryable?: boolean;
}> = {}): PluginEvent {
  const executionID = input.executionID ?? 'release_install_1';
  const status = input.status ?? 'completed';
  return {
    execution_id: executionID,
    sequence: 1,
    kind: 'terminal',
    payload: {
      install_progress: {
        task_id: executionID,
        request_id: input.requestID ?? 'request-1',
        stage: status === 'completed' ? 'enable' : 'download',
        status,
        ...(status === 'failed' ? {
          failure_code: input.code ?? 'PLUGIN_INTERNAL_FAILURE',
          failure_stage: 'download',
          retryable: input.retryable ?? true,
        } : {}),
      },
    },
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const requestIDs = ['request-1', 'request-2', 'request-3'];
  const installOfficialRelease = vi.fn(async (_command, requestID: string) => execution({
    execution_id: requestID === 'request-1' ? 'release_install_1' : 'release_install_2',
  }));
  const listReleaseInstallExecutionEvents = vi.fn(async (executionID: string) => ({
    execution_id: executionID,
    events: [terminalEvent({ executionID })],
    cursor: 1,
  }));
  const getReleaseInstallExecution = vi.fn(async (executionID: string) => execution({
    execution_id: executionID,
    status: 'completed',
    cursor: 1,
    terminal_at: '2026-08-23T00:00:02Z',
  }));
  const lifecycle = {
    installOfficialRelease,
    listReleaseInstallExecutions: vi.fn(async () => [] as PluginExecution[]),
    getReleaseInstallExecution,
    listReleaseInstallExecutionEvents,
    getIncompatibleRetainedDataRevision: vi.fn(async () => 4),
    deleteIncompatibleRetainedData: vi.fn(async () => undefined),
    ...overrides,
  };
  const refreshInventory = vi.fn(async () => ({ items: [] }));
  const completeApprovedInstall = vi.fn(async () => undefined);
  const createRequestID = vi.fn(() => requestIDs.shift() ?? 'request-extra');
  const coordinator = createPluginInstallCoordinator({
    lifecycle: lifecycle as never,
    refreshInventory,
    completeApprovedInstall,
    createRequestID,
    resolvePluginID: (candidate) => candidate === pluginInstanceID ? pluginID : undefined,
  });
  return {
    coordinator,
    lifecycle,
    installOfficialRelease,
    listReleaseInstallExecutionEvents,
    getReleaseInstallExecution,
    refreshInventory,
    completeApprovedInstall,
    createRequestID,
  };
}

describe('plugin install execution coordinator', () => {
  it('submits once and owns the only observation loop through completion', async () => {
    const h = harness();

    await h.coordinator.start(installCommand);
    await flushUntil(() => h.completeApprovedInstall.mock.calls.length === 1);

    expect(h.installOfficialRelease).toHaveBeenCalledOnce();
    expect(h.listReleaseInstallExecutionEvents).toHaveBeenCalledOnce();
    expect(h.getReleaseInstallExecution).toHaveBeenCalledOnce();
    expect(h.refreshInventory).toHaveBeenCalledOnce();
    expect(h.completeApprovedInstall).toHaveBeenCalledWith(pluginInstanceID, { items: [] }, expect.any(AbortSignal));
    expect(h.coordinator.projections()).toEqual([]);
  });

  it('does not start a competing watcher when start and resume overlap', async () => {
    let releaseEvents: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releaseEvents = resolve; });
    const h = harness({
      listReleaseInstallExecutions: vi.fn(async () => [execution()]),
      listReleaseInstallExecutionEvents: vi.fn(async () => {
        await gate;
        return { execution_id: 'release_install_1', events: [terminalEvent()], cursor: 1 };
      }),
    });

    await h.coordinator.start(installCommand);
    await h.coordinator.resume();
    releaseEvents?.();
    await flushUntil(() => h.completeApprovedInstall.mock.calls.length === 1);

    expect(h.lifecycle.listReleaseInstallExecutionEvents).toHaveBeenCalledOnce();
  });

  it('replays an uncertain submission with the same request id', async () => {
    const installOfficialRelease = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(execution());
    const h = harness({ installOfficialRelease });

    await h.coordinator.start(installCommand);
    expect(h.coordinator.projections()[0]?.failure?.recovery).toBe('replay_submission');
    await h.coordinator.retry(pluginInstanceID);

    expect(installOfficialRelease).toHaveBeenNthCalledWith(1, installCommand, 'request-1', expect.any(Object));
    expect(installOfficialRelease).toHaveBeenNthCalledWith(2, installCommand, 'request-1', expect.any(Object));
    expect(h.createRequestID).toHaveBeenCalledOnce();
  });

  it('reattaches a fresh observer when a same-request replay returns the same execution', async () => {
    let releaseFirstObserver: (() => void) | undefined;
    const firstObserverGate = new Promise<void>((resolve) => { releaseFirstObserver = resolve; });
    const listReleaseInstallExecutionEvents = vi.fn(async () => {
      if (listReleaseInstallExecutionEvents.mock.calls.length === 1) {
        await firstObserverGate;
        throw new DOMException('superseded', 'AbortError');
      }
      return {
        execution_id: 'release_install_1',
        events: [terminalEvent()],
        cursor: 1,
      };
    });
    const installOfficialRelease = vi.fn()
      .mockResolvedValueOnce(execution())
      .mockResolvedValueOnce(execution());
    const h = harness({ installOfficialRelease, listReleaseInstallExecutionEvents });

    await h.coordinator.start(installCommand);
    await flushUntil(() => listReleaseInstallExecutionEvents.mock.calls.length === 1);

    const first = h.coordinator.projections()[0]!;
    // Model a lost committed submission response while its old observer is
    // still unwinding, then replay the exact request identity.
    Object.assign(first, {
      observation: 'failed',
      failure: {
        source: 'submission',
        code: 'PLUGIN_INTERNAL_FAILURE',
        retryable: true,
        recovery: 'replay_submission',
      },
    });
    await h.coordinator.retry(pluginInstanceID);
    releaseFirstObserver?.();
    await flushUntil(() => h.completeApprovedInstall.mock.calls.length === 1);

    expect(installOfficialRelease.mock.calls.map((call: unknown[]) => call[1])).toEqual(['request-1', 'request-1']);
    expect(listReleaseInstallExecutionEvents).toHaveBeenCalledTimes(2);
  });

  it('uses platform retryable facts and creates a new request id for a new attempt', async () => {
    let attempt = 0;
    const h = harness({
      installOfficialRelease: vi.fn(async (_command: unknown, _requestID: string) => {
        attempt += 1;
        return execution({ execution_id: `release_install_${attempt}`, cursor: 0 });
      }),
      listReleaseInstallExecutionEvents: vi.fn(async (executionID: string) => ({
        execution_id: executionID,
        events: [attempt === 1
          ? terminalEvent({ executionID, requestID: 'request-1', status: 'failed', code: 'PLUGIN_INTERNAL_FAILURE', retryable: true })
          : terminalEvent({ executionID, requestID: 'request-2' })],
        cursor: 1,
      })),
      getReleaseInstallExecution: vi.fn(async (executionID: string) => execution({
        execution_id: executionID,
        status: attempt === 1 ? 'failed' : 'completed',
        failure_code: attempt === 1 ? 'PLUGIN_INTERNAL_FAILURE' : undefined,
        cursor: 1,
        terminal_at: '2026-08-23T00:00:02Z',
      })),
    });

    await h.coordinator.start(installCommand);
    await flushUntil(() => h.coordinator.projections()[0]?.failure?.recovery === 'retry_install');
    await h.coordinator.retry(pluginInstanceID);
    await flushUntil(() => h.completeApprovedInstall.mock.calls.length === 1);

    expect(h.lifecycle.installOfficialRelease.mock.calls.map((call: unknown[]) => call[1])).toEqual(['request-1', 'request-2']);
  });

  it('offers review rather than guessing retryability for a recovered execution without its command', async () => {
    const failed = execution({
      status: 'failed',
      cursor: 1,
      failure_code: 'PLUGIN_RELEASE_NETWORK',
      terminal_at: new Date().toISOString(),
    });
    const h = harness({
      listReleaseInstallExecutions: vi.fn(async () => [failed]),
      listReleaseInstallExecutionEvents: vi.fn(async () => ({
        execution_id: failed.execution_id,
        events: [terminalEvent({ status: 'failed', code: 'PLUGIN_RELEASE_NETWORK', retryable: true })],
        cursor: 1,
      })),
      getReleaseInstallExecution: vi.fn(async () => failed),
    });

    await h.coordinator.resume();
    await flushUntil(() => h.coordinator.projections()[0]?.observation === 'failed');

    expect(h.coordinator.projections()[0]?.failure).toMatchObject({
      code: 'PLUGIN_RELEASE_NETWORK',
      retryable: true,
      recovery: 'review_again',
    });
  });

  it('does not use a mismatched request event to authorize retry', async () => {
    const h = harness({
      listReleaseInstallExecutionEvents: vi.fn(async () => ({
        execution_id: 'release_install_1',
        events: [terminalEvent({
          requestID: 'different-request',
          status: 'failed',
          code: 'PLUGIN_RELEASE_NETWORK',
          retryable: true,
        })],
        cursor: 1,
      })),
      getReleaseInstallExecution: vi.fn(async () => execution({
        status: 'failed',
        failure_code: 'PLUGIN_RELEASE_NETWORK',
        cursor: 1,
        terminal_at: '2026-08-23T00:00:02Z',
      })),
    });

    await h.coordinator.start(installCommand);
    await flushUntil(() => h.coordinator.projections()[0]?.observation === 'failed');

    expect(h.coordinator.projections()[0]?.failure).toMatchObject({
      code: 'PLUGIN_INTERNAL_FAILURE',
      retryable: false,
      recovery: 'review_again',
    });
  });

  it('deletes retained data and starts a new exact reviewed attempt', async () => {
    let attempt = 0;
    const h = harness({
      installOfficialRelease: vi.fn(async () => execution({ execution_id: `release_install_${attempt += 1}` })),
      listReleaseInstallExecutionEvents: vi.fn(async (executionID: string) => ({
        execution_id: executionID,
        events: [attempt === 1
          ? terminalEvent({ executionID, status: 'failed', code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE', retryable: false })
          : terminalEvent({ executionID, requestID: 'request-2' })],
        cursor: 1,
      })),
      getReleaseInstallExecution: vi.fn(async (executionID: string) => execution({
        execution_id: executionID,
        status: attempt === 1 ? 'failed' : 'completed',
        failure_code: attempt === 1 ? 'PLUGIN_RETAINED_DATA_INCOMPATIBLE' : undefined,
        cursor: 1,
        terminal_at: '2026-08-23T00:00:02Z',
      })),
    });

    await h.coordinator.start(installCommand);
    await flushUntil(() => h.coordinator.projections()[0]?.failure?.recovery === 'erase_retained_data');
    await h.coordinator.discardRetainedDataAndRetry(pluginInstanceID);

    expect(h.lifecycle.getIncompatibleRetainedDataRevision).toHaveBeenCalledWith(pluginInstanceID, expect.any(Object));
    expect(h.lifecycle.deleteIncompatibleRetainedData).toHaveBeenCalledWith(pluginInstanceID, 4, expect.any(Object));
    expect(h.lifecycle.installOfficialRelease.mock.calls.map((call: unknown[]) => call[1])).toEqual(['request-1', 'request-2']);
  });

  it('reconciles a lost retained-data delete response with the same confirmed revision', async () => {
    let attempt = 0;
    const deleteIncompatibleRetainedData = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(undefined);
    const h = harness({
      deleteIncompatibleRetainedData,
      installOfficialRelease: vi.fn(async () => execution({ execution_id: `release_install_${attempt += 1}` })),
      listReleaseInstallExecutionEvents: vi.fn(async (executionID: string) => ({
        execution_id: executionID,
        events: [terminalEvent({ executionID, status: 'failed', code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE', retryable: false })],
        cursor: 1,
      })),
      getReleaseInstallExecution: vi.fn(async (executionID: string) => execution({
        execution_id: executionID,
        status: 'failed',
        failure_code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE',
        cursor: 1,
        terminal_at: '2026-08-23T00:00:02Z',
      })),
    });

    await h.coordinator.start(installCommand);
    await flushUntil(() => h.coordinator.projections()[0]?.failure?.recovery === 'erase_retained_data');
    await expect(h.coordinator.discardRetainedDataAndRetry(pluginInstanceID)).rejects.toThrow('connection lost');
    await h.coordinator.discardRetainedDataAndRetry(pluginInstanceID);

    expect(h.lifecycle.getIncompatibleRetainedDataRevision).toHaveBeenCalledOnce();
    expect(deleteIncompatibleRetainedData).toHaveBeenCalledTimes(2);
    expect(deleteIncompatibleRetainedData.mock.calls[0]?.[1]).toBe(4);
    expect(deleteIncompatibleRetainedData.mock.calls[1]?.[1]).toBe(4);
  });

  it('retries inventory projection without restarting the completed install', async () => {
    const h = harness();
    h.refreshInventory.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [] });

    await h.coordinator.start(installCommand);
    await flushUntil(() => h.coordinator.projections()[0]?.failure?.recovery === 'refresh_inventory');
    await h.coordinator.retry(pluginInstanceID);
    await flushUntil(() => h.completeApprovedInstall.mock.calls.length === 1);

    expect(h.installOfficialRelease).toHaveBeenCalledOnce();
    expect(h.refreshInventory).toHaveBeenCalledTimes(2);
  });

  it('retries inventory projection after resuming a completed install without a reviewed command', async () => {
    const completed = execution({
      status: 'completed',
      cursor: 1,
      terminal_at: new Date().toISOString(),
    });
    const h = harness({
      listReleaseInstallExecutions: vi.fn(async () => [completed]),
    });
    h.refreshInventory.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [] });

    await h.coordinator.resume();
    await flushUntil(() => h.coordinator.projections()[0]?.failure?.recovery === 'refresh_inventory');
    await h.coordinator.retry(pluginInstanceID);
    await flushUntil(() => h.completeApprovedInstall.mock.calls.length === 1);

    expect(h.installOfficialRelease).not.toHaveBeenCalled();
    expect(h.refreshInventory).toHaveBeenCalledTimes(2);
  });

  it('retries the terminal execution read without starting a second event loop', async () => {
    vi.useFakeTimers();
    try {
      const getReleaseInstallExecution = vi.fn()
        .mockRejectedValueOnce(new TypeError('connection lost'))
        .mockResolvedValueOnce(execution({
          status: 'completed',
          cursor: 1,
          terminal_at: '2026-08-23T00:00:02Z',
        }));
      const h = harness({ getReleaseInstallExecution });

      await h.coordinator.start(installCommand);
      await vi.runAllTimersAsync();

      expect(h.lifecycle.listReleaseInstallExecutionEvents).toHaveBeenCalledOnce();
      expect(getReleaseInstallExecution).toHaveBeenCalledTimes(2);
      expect(h.completeApprovedInstall).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition did not become true');
}
