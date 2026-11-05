import { afterEach, expect, it, vi } from 'vitest';
import { startPluginAutomaticUpdates } from './pluginAutomaticUpdates';
import { exampleInspection } from './examplePluginPackage.test-fixture';
import type { ReDevPluginRecord } from './pluginTypes';
const controllers: AbortController[] = [];
afterEach(() => { controllers.splice(0).forEach((controller) => controller.abort()); vi.useRealTimers(); });
function harness() {
  vi.useFakeTimers();
  const signal = new AbortController(); controllers.push(signal);
  const plugin = { plugin_instance_id: 'instance-1', management_revision: 3, automatic_updates: true, enable_state: 'enabled', package_hash: 'sha256:' + 'd'.repeat(64), source_provenance: { kind: 'package_url' } } as ReDevPluginRecord;
  const inspection = exampleInspection({ update_eligibility: { state: 'automatic_eligible', reason_codes: [], assessed_at: '2026-11-05T00:00:00Z' } });
  const lifecycle = { listInstalledPlugins: vi.fn(async () => [plugin]), inspectExternalPackage: vi.fn(async () => inspection), listInspectedInstalls: vi.fn(async (): Promise<import("@floegence/redevplugin-ui").PluginInspectedInstallOperation[]> => []) };
  const commit = vi.fn(async () => ({ plugin, operation: {} }) as never);
  const onReviewRequired = vi.fn();
  const onSettled = vi.fn(async () => undefined);
  startPluginAutomaticUpdates({ lifecycle, commit, onReviewRequired, onSettled, signal: signal.signal, initialDelay: 1, interval: 100 });
  return { plugin, inspection, lifecycle, commit, onReviewRequired, onSettled, signal };
}
it('uses the original-source inspection and same commit path once per candidate', async () => {
  const h = harness(); await vi.advanceTimersByTimeAsync(201);
  expect(h.lifecycle.inspectExternalPackage).toHaveBeenCalledWith({ sourceKind: 'installed_source', pluginInstanceID: 'instance-1', expectedManagementRevision: 3 }, expect.anything());
  expect(h.commit).toHaveBeenCalledExactlyOnceWith(h.inspection, h.signal.signal);
});
it('leaves changed capabilities for review', async () => {
  const h = harness(); h.inspection.update_eligibility.state = 'manual_only';
  await vi.advanceTimersByTimeAsync(201);
  expect(h.commit).not.toHaveBeenCalled(); expect(h.onReviewRequired).toHaveBeenCalledTimes(1);
});
it('never retries an uncertain write on the next scheduled check', async () => {
  const h = harness(); h.commit.mockRejectedValue(new Error('unknown'));
  await vi.advanceTimersByTimeAsync(301);
  expect(h.commit).toHaveBeenCalledTimes(1); expect(h.onSettled).toHaveBeenCalledTimes(1);
});
it('honors disabled preference and owner cancellation', async () => {
  const h = harness(); h.plugin.automatic_updates = false;
  await vi.advanceTimersByTimeAsync(1); expect(h.lifecycle.inspectExternalPackage).not.toHaveBeenCalled();
  h.signal.abort(); await vi.advanceTimersByTimeAsync(1000);
  expect(h.lifecycle.listInstalledPlugins).toHaveBeenCalledTimes(1);
});

it('does not resubmit an unknown operation after restarting the scheduler', async () => {
  const h = harness();
  h.lifecycle.listInspectedInstalls.mockResolvedValue([{ plugin_id: 'example.metrics', package_sha256: h.inspection.inspected_hashes.package_sha256, mutation_outcome: 'unknown', execution: { plugin_instance_id: 'instance-1', status: 'orphaned' } }] as never);
  await vi.advanceTimersByTimeAsync(201);
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.onSettled).toHaveBeenCalled();
});
it('requires review after a previous failed attempt at the same package', async () => {
  const h = harness();
  h.lifecycle.listInspectedInstalls.mockResolvedValue([{ plugin_id: 'example.metrics', package_sha256: h.inspection.inspected_hashes.package_sha256, mutation_outcome: 'not_committed', execution: { plugin_instance_id: 'instance-1', status: 'failed' } }] as never);
  await vi.advanceTimersByTimeAsync(201);
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.onReviewRequired).toHaveBeenCalledTimes(1);
});
