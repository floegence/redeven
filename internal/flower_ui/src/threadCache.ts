import type {
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';

export type ThreadView = Readonly<{
  thread: FlowerThreadSnapshot;
  version: number;
  connectionEpoch?: number;
}>;

type CacheEntry = {
  view: ThreadView;
  usedAt: number;
};

export type ThreadCache = {
  readonly selectedId: string | null;
  readonly summaries: ReadonlyMap<string, FlowerThreadSnapshot>;
  readonly views: ReadonlyMap<string, ThreadView>;
  select(id: string | null): ThreadCache;
  replaceSummary(summary: FlowerThreadSnapshot): ThreadCache;
  replaceSummaries(summaries: readonly FlowerThreadSnapshot[]): ThreadCache;
  replaceView(view: ThreadView): ThreadCache;
  updateThread(id: string, update: (thread: FlowerThreadSnapshot) => FlowerThreadSnapshot): ThreadCache;
  evict(id: string): ThreadCache;
};

const MAX_VIEWS = 12;

function summaryOnly(thread: FlowerThreadSnapshot): FlowerThreadSnapshot {
  const summary = { ...thread, messages: [] };
  delete summary.queued_turns;
  delete summary.model_io_status;
  delete summary.context_usage;
  delete summary.context_compactions;
  delete summary.timeline_decorations;
  delete summary.subagents;
  delete summary.approval_actions;
  delete summary.input_request;
  delete summary.error;
  return summary;
}

function createCache(
  selectedId: string | null,
  summaries: Map<string, FlowerThreadSnapshot>,
  views: Map<string, CacheEntry>,
  clock: number,
): ThreadCache {
  const touch = (id: string): Map<string, CacheEntry> => {
    const next = new Map(views);
    const entry = next.get(id);
    if (entry) next.set(id, { ...entry, usedAt: clock + 1 });
    return next;
  };
  return {
    selectedId,
    summaries,
    views: new Map([...views.entries()].map(([id, entry]) => [id, entry.view])),
    select(id) {
      const nextID = id == null || id.trim() === '' ? null : id.trim();
      return createCache(nextID, summaries, touch(nextID ?? ''), clock + 1);
    },
    replaceSummary(summary) {
      const id = summary.thread_id.trim();
      if (!id) return this;
      const next = new Map(summaries);
      // Summary state never carries or inherits detail content.
      next.set(id, summaryOnly(summary));
      return createCache(selectedId, next, views, clock + 1);
    },
    replaceSummaries(nextSummaries) {
      const next = new Map<string, FlowerThreadSnapshot>();
      for (const summary of nextSummaries) {
        const id = summary.thread_id.trim();
        if (id) next.set(id, summaryOnly(summary));
      }
      return createCache(selectedId, next, views, clock + 1);
    },
    replaceView(view) {
      const id = view.thread.thread_id.trim();
      if (!id) return this;
      const current = views.get(id);
      const nextEpoch = Math.max(0, Math.floor(Number(view.connectionEpoch) || 0));
      const currentEpoch = Math.max(0, Math.floor(Number(current?.view.connectionEpoch) || 0));
      if (current && (nextEpoch < currentEpoch || nextEpoch === currentEpoch && view.version < current.view.version)) return this;
      const next = new Map(views);
      next.set(id, { view, usedAt: clock + 1 });
      while (next.size > MAX_VIEWS) {
        const oldest = [...next.entries()].sort((left, right) => left[1].usedAt - right[1].usedAt)[0];
        if (!oldest) break;
        next.delete(oldest[0]);
      }
      const summary = new Map(summaries);
      summary.set(id, summaryOnly(view.thread));
      return createCache(selectedId, summary, next, clock + 1);
    },
    updateThread(id, update) {
      const threadID = id.trim();
      if (!threadID) return this;
      const nextSummaries = new Map(summaries);
      const currentSummary = nextSummaries.get(threadID);
      if (currentSummary) nextSummaries.set(threadID, summaryOnly(update(currentSummary)));
      if (!currentSummary) return this;
      // Summary mutations are intentionally scoped to the summary map. Detail
      // views can only change through replaceView/current-state snapshots.
      return createCache(selectedId, nextSummaries, views, clock + 1);
    },
    evict(id) {
      const nextSummaries = new Map(summaries);
      const nextViews = new Map(views);
      nextSummaries.delete(id);
      nextViews.delete(id);
      return createCache(selectedId === id ? null : selectedId, nextSummaries, nextViews, clock + 1);
    },
  };
}

export function createThreadCache(): ThreadCache {
  return createCache(null, new Map(), new Map(), 0);
}
