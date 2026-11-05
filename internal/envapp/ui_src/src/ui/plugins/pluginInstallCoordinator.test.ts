import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginInspectedInstallOperation } from '@floegence/redevplugin-ui';
import { createPluginInstallCoordinator } from './pluginInstallCoordinator';
import type { PluginInventoryProjection } from './pluginTypes';

function operation(overrides: Partial<PluginInspectedInstallOperation> = {}): PluginInspectedInstallOperation {
  return {
    request_id: 'request-1', inspection_id: 'inspection-1', package_sha256: 'sha256:' + 'a'.repeat(64), plugin_id: 'example.metrics', version: '1.0.0', mutation_outcome: 'not_committed',
    execution: { execution_id: 'execution-1', plugin_instance_id: 'instance-1', kind: 'operation', status: 'running', cursor: 0, cancelable: false, created_at: '2026-11-05T00:00:00Z', updated_at: new Date().toISOString() },
    ...overrides,
  };
}
const disposals: (() => void)[] = [];
afterEach(() => { disposals.splice(0).forEach((dispose) => dispose()); vi.useRealTimers(); });
function harness(receipt = operation()) {
  const lifecycle = {
    listInspectedInstalls: vi.fn(async () => [receipt]),
    getInspectedInstall: vi.fn(async () => receipt),
    listInstallExecutionEvents: vi.fn(async () => ({ execution_id: receipt.execution.execution_id, events: [], cursor: 0 })),
  };
  const refreshInventory = vi.fn(async (): Promise<PluginInventoryProjection> => ({ items: [] }));
  const completeApprovedInstall = vi.fn(async () => undefined);
  const coordinator = createPluginInstallCoordinator({ lifecycle, refreshInventory, completeApprovedInstall });
  disposals.push(coordinator.dispose);
  return { coordinator, lifecycle, refreshInventory, completeApprovedInstall };
}

describe('durable inspected install recovery', () => {
  it('discards inventory responses from an owner that has been replaced', async () => {
    const receipt = operation(); receipt.execution.status = 'completed'; receipt.mutation_outcome = 'committed';
    const h = harness(receipt);
    let finish!: (value: PluginInventoryProjection) => void;
    h.refreshInventory.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await h.coordinator.resume();
    h.coordinator.reset();
    finish({ items: [{ pluginInstanceID: 'instance-1' }] } as PluginInventoryProjection);
    await Promise.resolve();
    expect(h.completeApprovedInstall).not.toHaveBeenCalled();
    expect(h.coordinator.projections()).toEqual([]);
  });
  it('uses durable admission order when timestamps and opaque IDs disagree', async () => {
    vi.useFakeTimers();
    const older = operation(); older.execution.execution_id = 'z-old';
    const newer = operation({ request_id: 'request-2', execution: { ...older.execution, execution_id: 'a-new' } });
    const h = harness(); h.lifecycle.listInspectedInstalls.mockResolvedValue([older, newer]);
    await h.coordinator.resume();
    expect(h.coordinator.projections()[0]?.receipt?.request_id).toBe('request-2');
  });
  it('restores a first install without an inventory record and keeps one observer', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.coordinator.resume(); await Promise.resolve(); await h.coordinator.resume();
    expect(h.coordinator.projections()[0]).toMatchObject({ pluginID: 'example.metrics', pluginInstanceID: 'instance-1', observation: 'watching' });
    expect(h.lifecycle.listInstallExecutionEvents).toHaveBeenCalledTimes(1);
  });
  it('refreshes a committed mutation even when its execution reports failure', async () => {
    const receipt = operation(); receipt.execution.status = 'failed'; receipt.mutation_outcome = 'committed';
    const h = harness(receipt);
    await h.coordinator.resume(); await Promise.resolve();
    expect(h.refreshInventory).toHaveBeenCalledTimes(1);
    expect(h.coordinator.projections()).toEqual([]);
  });
  it('never turns unknown effects into a new installation', async () => {
    vi.useFakeTimers();
    const receipt = operation(); receipt.execution.status = 'orphaned'; receipt.mutation_outcome = 'unknown';
    const h = harness(receipt);
    await h.coordinator.resume(); await Promise.resolve();
    expect(h.coordinator.projections()[0]?.observation).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(251);
    expect(h.lifecycle.getInspectedInstall).toHaveBeenCalledWith('request-1', expect.anything());
    expect(h.refreshInventory).not.toHaveBeenCalled();
  });
  it('retries only inventory reconciliation after committed refresh failure', async () => {
    const receipt = operation(); receipt.execution.status = 'completed'; receipt.mutation_outcome = 'committed';
    const h = harness(receipt); h.refreshInventory.mockRejectedValueOnce(new Error('offline'));
    await h.coordinator.resume(); await Promise.resolve();
    expect(h.coordinator.projections()[0]?.failure?.recovery).toBe('refresh_inventory');
    await h.coordinator.retry('instance-1'); await Promise.resolve();
    expect(h.refreshInventory).toHaveBeenCalledTimes(2);
    expect(h.coordinator.projections()).toEqual([]);
  });
  it('shows a definite failure without authorizing replay after reload', async () => {
    const receipt = operation(); receipt.execution.status = 'failed'; receipt.execution.failure_code = 'PLUGIN_RETAINED_DATA_INCOMPATIBLE';
    const h = harness(receipt); await h.coordinator.resume();
    expect(h.coordinator.projections()[0]?.failure?.recovery).toBe('review_again');
    expect(h.refreshInventory).not.toHaveBeenCalled();
  });
  it('observes a new installation after the previous installation was forgotten', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.coordinator.resume(); h.coordinator.forget('instance-1');
    h.lifecycle.listInspectedInstalls.mockResolvedValue([operation({ request_id: 'reinstall' })]);
    await h.coordinator.resume();
    expect(h.coordinator.projections()[0]?.receipt?.request_id).toBe('reinstall');
  });
  it('does not restore uninstalled or forgotten operations', async () => {
    const h = harness(); await h.coordinator.resume(); h.coordinator.forget('instance-1'); h.lifecycle.listInstallExecutionEvents.mockClear(); await h.coordinator.resume();
    expect(h.coordinator.projections()).toEqual([]);
    expect(h.lifecycle.listInstallExecutionEvents).not.toHaveBeenCalled();
  });
});
