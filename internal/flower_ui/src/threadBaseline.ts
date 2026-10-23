import type { FlowerLiveStreamEnvelope, FlowerThreadSummary } from './contracts/flowerSurfaceContracts';
import { FlowerLiveSyncError } from './flowerLiveWire';
import type { ThreadCache } from './threadCache';

// Only membership is retained between pages; ThreadCache owns every summary.
// Prune old roots after completion, preserving conversations admitted locally
// while the baseline was loading and their ordered live updates were queued.
export function createFlowerThreadBaseline() {
  let initial: Set<string> | undefined;
  let seen: Set<string> | undefined;
  return {
    reset() { initial = undefined; seen = undefined; },
    apply(cache: ThreadCache, envelope: FlowerLiveStreamEnvelope, summaries: readonly FlowerThreadSummary[]): ThreadCache {
      if (envelope.kind === 'ready') {
        initial = new Set(cache.summaries.keys());
        seen = new Set();
      }
      if (envelope.baseline_complete !== undefined) {
        if (!seen || !initial) throw new FlowerLiveSyncError('Flower baseline page arrived without its initial boundary.');
        for (const summary of summaries) seen.add(summary.thread_id);
      }
      const merged = summaries.reduce((next, summary) => next.replaceSummary(summary), cache);
      if (envelope.baseline_complete !== true) return merged;
      const retained = [...merged.summaries.values()].filter(summary => seen!.has(summary.thread_id) || !initial!.has(summary.thread_id));
      initial = undefined; seen = undefined;
      return merged.resetRootSummaries(retained);
    },
  };
}
