import type { PluginLifecycleAPI } from './pluginApi';
import type { ExternalPluginCommitResult, ExternalPluginInspection } from './pluginTypes';

/** Product scheduling uses the current authenticated client and the platform lifecycle. */
export function startPluginAutomaticUpdates(options: {
  lifecycle: Pick<PluginLifecycleAPI, 'listInstalledPlugins' | 'inspectExternalPackage' | 'listInspectedInstalls'>;
  commit: (inspection: ExternalPluginInspection, signal: AbortSignal) => Promise<ExternalPluginCommitResult>;
  onReviewRequired: (pluginInstanceID: string) => void;
  onSettled: () => Promise<unknown>;
  signal: AbortSignal;
  initialDelay?: number;
  interval?: number;
}): () => void {
  const attempted = new Set<string>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { stopped = true; clearTimeout(timer); options.signal.removeEventListener('abort', stop); };
  const run = async () => {
    try {
      const plugins = await options.lifecycle.listInstalledPlugins({ signal: options.signal });
      // Durable owner-scoped receipts survive UI reloads and session renewal. A
      // lost response must never become a new automatic installation request.
      const receipts = await options.lifecycle.listInspectedInstalls({ signal: options.signal });
      const liveIDs = new Set(plugins.map((plugin) => `${plugin.plugin_instance_id}:${plugin.management_revision}:`));
      for (const key of attempted) if (![...liveIDs].some((prefix) => key.startsWith(prefix))) attempted.delete(key);
      for (const plugin of plugins) {
        if (stopped || options.signal.aborted) return;
        if (!plugin.automatic_updates || plugin.enable_state !== 'enabled' || plugin.source_provenance?.kind === 'package_upload') continue;
        try {
          const inspection = await options.lifecycle.inspectExternalPackage({
            sourceKind: 'installed_source', pluginInstanceID: plugin.plugin_instance_id,
            expectedManagementRevision: plugin.management_revision,
          }, { signal: options.signal });
          if (stopped || options.signal.aborted) return;
          if (inspection.inspected_hashes.package_sha256 === plugin.package_hash) continue;
          const key = `${plugin.plugin_instance_id}:${plugin.management_revision}:${inspection.inspected_hashes.package_sha256}`;
          if (attempted.has(key)) continue;
          const prior = receipts.filter((receipt) => receipt.execution.plugin_instance_id === plugin.plugin_instance_id);
          if (prior.some((receipt) => receipt.mutation_outcome === 'unknown' || !['completed', 'failed', 'canceled', 'orphaned'].includes(receipt.execution.status))) {
            await options.onSettled();
            continue;
          }
          attempted.add(key);
          if (prior.some((receipt) => receipt.package_sha256 === inspection.inspected_hashes.package_sha256)) {
            // A prior attempt requires explicit review, including a known failure.
            options.onReviewRequired(plugin.plugin_instance_id);
            continue;
          }
          if (inspection.update_eligibility.state !== 'automatic_eligible') {
            options.onReviewRequired(plugin.plugin_instance_id);
            continue;
          }
          await options.commit(inspection, options.signal);
          await options.onSettled();
        } catch {
          // A failed or uncertain mutation is recovered from its durable receipt.
          // Inspection/network failures can be checked at the next bounded interval.
          if (!stopped && !options.signal.aborted) await options.onSettled().catch(() => undefined);
        }
      }
    } catch { /* The next check uses the same authenticated owner. */ }
    finally {
      if (!stopped && !options.signal.aborted) timer = setTimeout(() => void run(), options.interval ?? 15 * 60_000);
    }
  };
  options.signal.addEventListener('abort', stop, { once: true });
  if (!options.signal.aborted) timer = setTimeout(() => void run(), options.initialDelay ?? 30_000);
  return stop;
}
