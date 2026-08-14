import type { PluginEvent, PluginExecution } from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { createPluginInstallCoordinator } from './pluginInstallCoordinator';

const pluginInstanceID = 'plugini_redeven_official_containers';

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
    ...overrides,
  };
  const refreshInventory = vi.fn(async () => undefined);
  const coordinator = createPluginInstallCoordinator({
    lifecycle: lifecycle as never,
    refreshInventory,
    createRequestID: () => 'request-1',
    resolvePluginID: (candidate) => candidate === pluginInstanceID ? 'com.redeven.official.containers' : undefined,
  });
  return { coordinator, lifecycle, refreshInventory };
}

describe('plugin install execution coordinator', () => {
  it('submits one Host execution and removes presentation after authoritative inventory refresh', async () => {
    const { coordinator, lifecycle, refreshInventory } = harness();

    await coordinator.start('com.redeven.official.containers', pluginInstanceID);

    expect(lifecycle.installOfficialRelease).toHaveBeenCalledOnce();
    expect(refreshInventory).toHaveBeenCalledOnce();
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

    await coordinator.start('com.redeven.official.containers', pluginInstanceID);

    expect(coordinator.projections()).toEqual([
      expect.objectContaining({
        pluginInstanceID,
        observation: 'failed',
        execution: failed,
        events: [],
      }),
    ]);
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
      createRequestID: () => 'request-1',
      resolvePluginID: () => 'com.redeven.official.containers',
    });

    await coordinator.start('com.redeven.official.containers', pluginInstanceID);

    expect(coordinator.projections()[0]).toMatchObject({
      observation: 'refresh_failed',
      execution: { execution_id: 'release_install_1', status: 'completed' },
      events: [{ sequence: 1, kind: 'progress' }],
    });
  });
});
