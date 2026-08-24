import type {
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';

export type ThreadView = Readonly<{
  thread: FlowerThreadSnapshot;
  version: number;
}>;

export type ThreadViewAcceptance = 'accepted' | 'unchanged' | 'stale';

export type ThreadViewReceiveResult = Readonly<{
  cache: ThreadCache;
  state: ThreadViewAcceptance;
  runtimeState: ThreadViewAcceptance;
  settingsState: ThreadViewAcceptance;
}>;

export function classifyThreadView(
  current: ThreadView | undefined,
  candidate: ThreadView,
): ThreadViewAcceptance {
  if (!current) return 'accepted';
  if (candidate.version > current.version) return 'accepted';
  if (candidate.version < current.version) return 'stale';
  return 'unchanged';
}

function classifyThreadSettings(
  current: ThreadView | undefined,
  candidate: ThreadView,
): ThreadViewAcceptance {
  if (!current) return 'accepted';
  const currentRevision = Math.max(0, Math.floor(Number(current.thread.settings_revision) || 0));
  const candidateRevision = Math.max(0, Math.floor(Number(candidate.thread.settings_revision) || 0));
  if (candidateRevision > currentRevision) return 'accepted';
  if (candidateRevision < currentRevision) return 'stale';
  return 'unchanged';
}

function mergeThreadSettings(
  runtime: FlowerThreadSnapshot,
  settings: FlowerThreadSnapshot,
): FlowerThreadSnapshot {
  return {
    ...runtime,
    model_id: settings.model_id,
    working_dir: settings.working_dir,
    pinned_at_ms: settings.pinned_at_ms,
    permission_type: settings.permission_type,
    reasoning_selection: settings.reasoning_selection,
    reasoning_capability: settings.reasoning_capability,
    settings_revision: settings.settings_revision,
  };
}

function aggregateAcceptance(
  runtimeState: ThreadViewAcceptance,
  settingsState: ThreadViewAcceptance,
): ThreadViewAcceptance {
  if (runtimeState === 'accepted' || settingsState === 'accepted') return 'accepted';
  if (runtimeState === 'unchanged' || settingsState === 'unchanged') return 'unchanged';
  return 'stale';
}

export function threadSnapshotRevision(thread: FlowerThreadSnapshot | undefined): number {
  if (!thread) return 0;
  return Math.max(
    0,
    Math.floor(Number(thread.updated_at_ms) || 0),
    Math.floor(Number(thread.read_status.snapshot.activity_revision) || 0),
    Math.floor(Number(thread.read_status.snapshot.last_message_at_unix_ms) || 0),
  );
}

function threadRuntimeStateKey(thread: FlowerThreadSnapshot): string {
  return [
    thread.status,
    thread.active_run_id?.trim() ?? '',
    thread.approval_pending ? '1' : '0',
    String(Math.max(0, Math.floor(Number(thread.approval_pending_count) || 0))),
  ].join('\x1f');
}

export function threadSummaryNeedsDetail(
  summary: FlowerThreadSnapshot | undefined,
  detail: FlowerThreadSnapshot | undefined,
): boolean {
  if (!summary) return false;
  if (!detail) return true;
  const summaryRevision = threadSnapshotRevision(summary);
  const detailRevision = threadSnapshotRevision(detail);
  if (summaryRevision > detailRevision) return true;
  if (summaryRevision < detailRevision) return false;
  if (terminalDetailNeedsRecovery(summary, detail)) return true;
  return threadRuntimeStateKey(summary) !== threadRuntimeStateKey(detail);
}

function terminalDetailNeedsRecovery(
  summary: FlowerThreadSnapshot,
  detail: FlowerThreadSnapshot,
): boolean {
  if (summary.status !== 'success' || detail.status !== 'success' || detail.error) return false;
  if (detail.messages.length === 0) return false;
  return !detail.messages.some((message) => (
    message.role === 'assistant'
      && (message.content.trim() !== '' || (message.blocks?.length ?? 0) > 0)
  ));
}

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
  receiveView(
    view: ThreadView,
    options?: Readonly<{ preserveSummary?: boolean }>,
  ): ThreadViewReceiveResult;
  updateDetailAdjuncts(id: string, update: (thread: FlowerThreadSnapshot) => FlowerThreadSnapshot): ThreadCache;
  updateSummaryAdjuncts(id: string, update: (thread: FlowerThreadSnapshot) => FlowerThreadSnapshot): ThreadCache;
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
    receiveView(view, options) {
      const id = view.thread.thread_id.trim();
      if (!id) return {
        cache: this,
        state: 'stale',
        runtimeState: 'stale',
        settingsState: 'stale',
      };
      const current = views.get(id)?.view;
      const runtimeState = classifyThreadView(current, view);
      const settingsState = classifyThreadSettings(current, view);
      const state = aggregateAcceptance(runtimeState, settingsState);
      if (state !== 'accepted') return { cache: this, state, runtimeState, settingsState };
      const runtimeView = current && runtimeState !== 'accepted' ? current : view;
      const settingsThread = current && settingsState !== 'accepted' ? current.thread : view.thread;
      const mergedView: ThreadView = {
        version: runtimeView.version,
        thread: mergeThreadSettings(runtimeView.thread, settingsThread),
      };
      const next = new Map(views);
      next.set(id, { view: mergedView, usedAt: clock + 1 });
      while (next.size > MAX_VIEWS) {
        const oldest = [...next.entries()].sort((left, right) => left[1].usedAt - right[1].usedAt)[0];
        if (!oldest) break;
        next.delete(oldest[0]);
      }
      const summary = new Map(summaries);
      if (!options?.preserveSummary) {
        summary.set(id, summaryOnly(mergedView.thread));
      } else if (settingsState === 'accepted') {
        const currentSummary = summary.get(id);
        if (currentSummary) summary.set(id, summaryOnly(mergeThreadSettings(currentSummary, settingsThread)));
      }
      return {
        cache: createCache(selectedId, summary, next, clock + 1),
        state,
        runtimeState,
        settingsState,
      };
    },
    updateDetailAdjuncts(id, update) {
      const threadID = id.trim();
      const current = views.get(threadID);
      if (!threadID || !current) return this;
      const next = new Map(views);
      next.set(threadID, {
        ...current,
        view: { ...current.view, thread: update(current.view.thread) },
        usedAt: clock + 1,
      });
      return createCache(selectedId, summaries, next, clock + 1);
    },
    updateSummaryAdjuncts(id, update) {
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
