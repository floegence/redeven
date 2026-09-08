import type {
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { mergeThreadTitle, threadTitleSnapshot, type ThreadTitleSnapshot } from './threadTitleSnapshot';

type ThreadDetail = Omit<FlowerThreadSnapshot, keyof ThreadTitleSnapshot>;
type ThreadDetailView = Readonly<{ thread: ThreadDetail; version: number }>;

function detailOnly(thread: ThreadDetail): ThreadDetail {
  const { title: _title, title_status: _status, title_generation: _generation, ...detail } = thread as FlowerThreadSnapshot;
  return detail;
}

function adjunctOnly(thread: ThreadDetail): ThreadDetail {
  if ('title' in thread || 'title_status' in thread || 'title_generation' in thread) {
    throw new Error('Flower contract error: adjunct updates cannot author titles.');
  }
  return thread;
}

export type ThreadView = Readonly<{
  thread: FlowerThreadSnapshot;
  version: number;
}>;

export type ThreadViewAcceptance = 'accepted' | 'unchanged' | 'stale';

export type ThreadViewReceiveResult = Readonly<{
  cache: ThreadCache;
  state: ThreadViewAcceptance;
  runtimeState: ThreadViewAcceptance;
  activityState: ThreadViewAcceptance;
  settingsState: ThreadViewAcceptance;
}>;

export function classifyThreadView(
  current: ThreadDetailView | undefined,
  candidate: ThreadDetailView,
): ThreadViewAcceptance {
  if (!current) return 'accepted';
  if (candidate.version > current.version) return 'accepted';
  if (candidate.version < current.version) return 'stale';
  return 'unchanged';
}

function classifyThreadSettings(
  current: ThreadDetailView | undefined,
  candidate: ThreadDetailView,
): ThreadViewAcceptance {
  if (!current) return 'accepted';
  const currentRevision = threadSettingsRevision(current.thread);
  const candidateRevision = threadSettingsRevision(candidate.thread);
  if (candidateRevision > currentRevision) return 'accepted';
  if (candidateRevision < currentRevision) return 'stale';
  return 'unchanged';
}

function classifyThreadActivity(
  current: ThreadDetailView | undefined,
  candidate: ThreadDetailView,
): ThreadViewAcceptance {
  if (!current) return 'accepted';
  const currentRevision = threadSnapshotRevision(current.thread);
  const candidateRevision = threadSnapshotRevision(candidate.thread);
  if (candidateRevision > currentRevision) return 'accepted';
  if (candidateRevision < currentRevision) return 'stale';
  return 'unchanged';
}

function mergeThreadSettings<T extends ThreadDetail>(
  runtime: T,
  settings: ThreadDetail,
): T {
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

function mergeThreadActivity<T extends ThreadDetail>(
  runtime: T,
  activity: ThreadDetail,
): T {
  return {
    ...runtime,
    updated_at_ms: activity.updated_at_ms,
    read_status: activity.read_status,
  };
}

function mergeNewerSummaryMetadata<T extends ThreadDetail>(
  base: T,
  candidate: ThreadDetail,
): T {
  const withActivity = threadSnapshotRevision(candidate) > threadSnapshotRevision(base)
    ? mergeThreadActivity(base, candidate)
    : base;
  const baseSettingsRevision = threadSettingsRevision(withActivity);
  const candidateSettingsRevision = threadSettingsRevision(candidate);
  return candidateSettingsRevision > baseSettingsRevision
    ? mergeThreadSettings(withActivity, candidate)
    : withActivity;
}

function aggregateAcceptance(
  runtimeState: ThreadViewAcceptance,
  activityState: ThreadViewAcceptance,
  settingsState: ThreadViewAcceptance,
  titleState: ThreadViewAcceptance,
): ThreadViewAcceptance {
  if (runtimeState === 'accepted' || activityState === 'accepted' || settingsState === 'accepted' || titleState === 'accepted') return 'accepted';
  if (runtimeState === 'unchanged' || activityState === 'unchanged' || settingsState === 'unchanged') return 'unchanged';
  return 'stale';
}

export function threadSnapshotRevision(thread: ThreadDetail | undefined): number {
  if (!thread) return 0;
  return Math.max(
    0,
    Math.floor(Number(thread.updated_at_ms) || 0),
    Math.floor(Number(thread.read_status.snapshot.activity_revision) || 0),
  );
}

export function threadSettingsRevision(thread: ThreadDetail | undefined): number {
  return Math.max(0, Math.floor(Number(thread?.settings_revision) || 0));
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
  const summarySettingsRevision = threadSettingsRevision(summary);
  const detailSettingsRevision = threadSettingsRevision(detail);
  if (summarySettingsRevision > detailSettingsRevision) return true;
  if (summaryRevision < detailRevision || summarySettingsRevision < detailSettingsRevision) return false;
  return threadRuntimeStateKey(summary) !== threadRuntimeStateKey(detail);
}

type CacheEntry = {
  view: ThreadDetailView;
  usedAt: number;
};

export type ThreadCache = {
  readonly selectedId: string | null;
  readonly summaries: ReadonlyMap<string, FlowerThreadSnapshot>;
  readonly views: ReadonlyMap<string, ThreadView>;
  select(id: string | null): ThreadCache;
  replaceSummary(summary: FlowerThreadSnapshot): ThreadCache;
  replaceSummaries(summaries: readonly FlowerThreadSnapshot[]): ThreadCache;
  resetRootSummaries(summaries: readonly FlowerThreadSnapshot[]): ThreadCache;
  receiveView(
    view: ThreadView,
    options?: Readonly<{ preserveSummary?: boolean }>,
  ): ThreadViewReceiveResult;
  receiveCurrent(view: ThreadDetailView, options?: Readonly<{ preserveSummary?: boolean }>): ThreadViewReceiveResult;
  updateDetailAdjuncts(id: string, update: (thread: ThreadDetail) => ThreadDetail): ThreadCache;
  updateSummaryAdjuncts(id: string, update: (thread: ThreadDetail) => ThreadDetail): ThreadCache;
  evict(id: string): ThreadCache;
};

const MAX_VIEWS = 12;

function summaryOnly(thread: FlowerThreadSnapshot): FlowerThreadSnapshot {
  const summary = { ...thread, messages: [] };
  delete summary.queued_turns;
  delete summary.restored_inputs;
  delete summary.context_usage;
  delete summary.context_compactions;
  delete summary.timeline_decorations;
  delete summary.subagents;
  delete summary.approval_actions;
  delete summary.input_request;
  delete summary.error;
  return summary;
}

function receiveSummary(
  current: FlowerThreadSnapshot | undefined,
  candidate: FlowerThreadSnapshot,
): FlowerThreadSnapshot {
  const title = mergeThreadTitle(current, candidate);
  if (!current) return summaryOnly({ ...candidate, ...title });
  const activityIsStale = threadSnapshotRevision(candidate) < threadSnapshotRevision(current);
  return summaryOnly({ ...(activityIsStale
    ? mergeNewerSummaryMetadata(current, candidate)
    : mergeNewerSummaryMetadata(candidate, current)), ...title });
}

function createCache(
  selectedId: string | null,
  summaries: Map<string, FlowerThreadSnapshot>,
  views: Map<string, CacheEntry>,
  clock: number,
): ThreadCache {
  const receive = (view: ThreadDetailView, title: ThreadTitleSnapshot | undefined, options?: Readonly<{ preserveSummary?: boolean }>): ThreadViewReceiveResult => {
    const id = view.thread.thread_id.trim();
    if (!id) return {
      cache,
      state: 'stale',
      runtimeState: 'stale',
      activityState: 'stale',
      settingsState: 'stale',
    };
    const current = views.get(id)?.view;
    const runtimeState = classifyThreadView(current, view);
    const activityState = classifyThreadActivity(current, view);
    const settingsState = classifyThreadSettings(current, view);
    const currentSummary = summaries.get(id);
    const acceptedTitle = title ? mergeThreadTitle(currentSummary, title) : threadTitleSnapshot(currentSummary ?? { title: '', title_status: 'unset', title_generation: 0 });
    const titleState = !currentSummary || acceptedTitle.title_generation !== currentSummary.title_generation
      || acceptedTitle.title_status !== currentSummary.title_status || acceptedTitle.title !== currentSummary.title ? 'accepted' : 'unchanged';
    const state = aggregateAcceptance(runtimeState, activityState, settingsState, titleState);
    if (state !== 'accepted') return {
      cache,
      state,
      runtimeState,
      activityState,
      settingsState,
    };
    const runtimeView = current && runtimeState !== 'accepted' ? current : view;
    const activityThread = current && activityState !== 'accepted' ? current.thread : view.thread;
    const settingsThread = current && settingsState !== 'accepted' ? current.thread : view.thread;
    const mergedView: ThreadDetailView = {
      version: runtimeView.version,
      thread: mergeThreadSettings(
        mergeThreadActivity(runtimeView.thread, activityThread),
        settingsThread,
      ),
    };
    const next = new Map(views);
    next.set(id, { view: mergedView, usedAt: clock + 1 });
    while (next.size > MAX_VIEWS) {
      const oldest = [...next.entries()].sort((left, right) => left[1].usedAt - right[1].usedAt)[0];
      if (!oldest) break;
      next.delete(oldest[0]);
    }
    const summary = new Map(summaries);
    const metadata = options?.preserveSummary && currentSummary
      ? mergeNewerSummaryMetadata(currentSummary, mergedView.thread)
      : mergeNewerSummaryMetadata(mergedView.thread, currentSummary ?? mergedView.thread);
    summary.set(id, summaryOnly({ ...metadata, ...acceptedTitle }));
    return {
      cache: createCache(selectedId, summary, next, clock + 1),
      state,
      runtimeState,
      activityState,
      settingsState,
    };
  };
  const touch = (id: string): Map<string, CacheEntry> => {
    const next = new Map(views);
    const entry = next.get(id);
    if (entry) next.set(id, { ...entry, usedAt: clock + 1 });
    return next;
  };
  const cache: ThreadCache = {
    selectedId,
    summaries,
    views: new Map([...views.entries()].flatMap(([id, entry]) => {
      const summary = summaries.get(id);
      return summary ? [[id, { ...entry.view, thread: { ...entry.view.thread, ...threadTitleSnapshot(summary) } }] as const] : [];
    })),
    select(id) {
      const nextID = id == null || id.trim() === '' ? null : id.trim();
      return createCache(nextID, summaries, touch(nextID ?? ''), clock + 1);
    },
    replaceSummary(summary) {
      const id = summary.thread_id.trim();
      if (!id) return this;
      const next = new Map(summaries);
      // Summary state never carries or inherits detail content.
      next.set(id, receiveSummary(summaries.get(id), summary));
      return createCache(selectedId, next, views, clock + 1);
    },
    replaceSummaries(nextSummaries) {
      const next = new Map<string, FlowerThreadSnapshot>();
      for (const summary of nextSummaries) {
        const id = summary.thread_id.trim();
        if (id) next.set(id, receiveSummary(summaries.get(id), summary));
      }
      return createCache(selectedId, next, views, clock + 1);
    },
    resetRootSummaries(nextSummaries) {
      const next = new Map<string, FlowerThreadSnapshot>();
      for (const summary of nextSummaries) {
        const id = summary.thread_id.trim();
        if (id) next.set(id, receiveSummary(summaries.get(id), summary));
      }
      const nextViews = new Map<string, CacheEntry>();
      for (const [id, view] of views) {
        if (next.has(id)) nextViews.set(id, view);
      }
      return createCache(selectedId && next.has(selectedId) ? selectedId : null, next, nextViews, clock + 1);
    },
    receiveView(view, options) {
      return receive({ ...view, thread: detailOnly(view.thread) }, threadTitleSnapshot(view.thread), options);
    },
    receiveCurrent(view, options) {
      return receive({ ...view, thread: detailOnly(view.thread) }, undefined, options);
    },
    updateDetailAdjuncts(id, update) {
      const threadID = id.trim();
      const current = views.get(threadID);
      if (!threadID || !current) return this;
      const next = new Map(views);
      next.set(threadID, {
        ...current,
        view: { ...current.view, thread: adjunctOnly(update(current.view.thread)) },
        usedAt: clock + 1,
      });
      return createCache(selectedId, summaries, next, clock + 1);
    },
    updateSummaryAdjuncts(id, update) {
      const threadID = id.trim();
      if (!threadID) return this;
      const nextSummaries = new Map(summaries);
      const currentSummary = nextSummaries.get(threadID);
      if (currentSummary) nextSummaries.set(threadID, summaryOnly({ ...adjunctOnly(update(detailOnly(currentSummary))), ...threadTitleSnapshot(currentSummary) }));
      if (!currentSummary) return this;
      // Adjunct updates never author titles or replace runtime detail.
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
  return cache;
}

export function createThreadCache(): ThreadCache {
  return createCache(null, new Map(), new Map(), 0);
}
